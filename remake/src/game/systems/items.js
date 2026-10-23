// Items (artefacts): treasure chests lying on the map that a character, animal or vehicle picks up and carries; while
// carried they give their owner's tribe the bonuses of their tech tree filter.
//
// Reference: misc/Item.usl (CItem, CItemEffectInvoker, CRideCup), misc/ItemSpawn.usl (CItemSpawn, CItemMgr
// GenerateItems), task/PickUp.usl, FightingObj.usl PickUp / AddItem / RemoveItem / Delete, character.usl (an
// inventory of one item), GameInputController.usl (the "trade" cursor over an item, the right click), Info.usl (the
// item slot of the info window), Player.usl AddScalps (the scalps modifier).
//
// An item (W.items) is a Prop (game/prop.js) with .item = {cls, def, carrier}; def = the tech tree's
// Items/Objects/<class> {effect 0 on use, 1 while carried, 2 while not carried; GlobalTT (a filter of the carrier's
// player), LocalTT (of the carrier), EffectName (HealAll, ShowWorld, RepairNoCost, IgnoreSlope_<type>, MoreScalps),
// bonus}. Every item of the game is "while carried" (effect 1). A unit carries at most one (u.item).
// The map's item spawns (ItemSpawn objects: spawn_items, generate_always, random_item; the level's Root/Items/Pool
// and MaxItems) put the items on the map when the level starts.
import { Prop } from '../prop.js';

const REACH = 4;                                // PickUp.usl: arrived within 4 m
const CARRIERS = /^(CHTR|ANML|VHCL)$/;          // FightingObj.PickUp

export const Items = {
  // the tech tree's description of an item class
  itemDef(cls) {
    const n = this.data.itemNode ? this.data.itemNode(cls) : null;
    const v = (k, d) => (n && n[k] != null && n[k] !== '' ? n[k] : d);
    return { effect: +v('effect', 1), globalTT: v('GlobalTT', ''), localTT: v('LocalTT', ''), effectName: v('EffectName', ''), bonus: +v('bonus', 0), range: +v('range', 0) };
  },
  // an item lying at (x, z); prop = an existing Prop (a campaign's placed item) or null
  placeItem(cls, x, z, rot = 0, prop = null) {
    cls = String(cls).toLowerCase();
    if (!prop) {
      const model = this.itemModel(cls);
      if (!model) return null;
      prop = new Prop(this, { model, x, z, rot, block: false });
    }
    prop.kind = 'item';
    prop.name = cls;
    prop.id = 'item' + (this.itemSeq = (this.itemSeq || 0) + 1);
    prop.radius = 1;
    prop.item = { cls, carrier: null };
    this.items.push(prop);
    return prop;
  },
  itemModel(cls) {
    const g = this.data.classGfx ? this.data.classGfx(cls) : null;
    for (const m of [g, 'item_treasure_chest']) if (m && this.templates(m, true)) return m;
    return null;
  },
  canCarry(u) { return !!(u && u.alive && u.kind === 'unit' && CARRIERS.test(u.cls) && !u.inside); },
  // CItemMgr.GenerateItems: the spawns that always make an item first (in the map's order), then the others in a
  // random order, until the spawns made MaxItems items; no class twice among them (items placed on the map do not
  // count). spawns = [{x, z, rot, items: [class], always, random}]; pool = the level's item classes (a random spawn
  // without a list takes from it)
  generateItems(spawns, pool, max) {
    const used = [];
    const make = (s) => {
      let list = (s.items.length ? s.items : s.random ? pool : []).map((c) => String(c).toLowerCase()).filter((c) => !used.includes(c));
      if (!list.length) return;
      const cls = s.random ? list[Math.floor(Math.random() * list.length)] : list[0];
      if (this.placeItem(cls, s.x, s.z, s.rot || 0)) used.push(cls);
    };
    const rest = [];
    for (const s of spawns) { if (used.length >= max) return; if (s.always) make(s); else rest.push(s); }
    while (rest.length && used.length < max) make(rest.splice(Math.floor(Math.random() * rest.length), 1)[0]);
  },

  // ---------------------------------------------------------------- picking up (task 'pickup', PickUp.usl)
  pickupUpdate(u, dt) {
    const t = u.task, it = t.target;
    if (!it || !it.alive || it.item.carrier) { this.toIdle(u); return; }
    if (u.item) { this.emit('msg', { player: u.owner, key: '_NT_PickUpFailInvFull', text: 'Inventory full' }); this.toIdle(u); return; }
    const d = Math.hypot(it.pos.x - u.pos.x, it.pos.z - u.pos.z);
    if (t.phase === 'take') {
      if ((t.wait -= dt) > 0) return;
      this.takeItem(u, it);
      this.toIdle(u);
      u.anchor.set(u.pos.x, u.pos.z);
      return;
    }
    if (d > REACH) {
      if (!t.walking || (!u.path.length && (t.tries = (t.tries || 0) + 1) < 4)) { u.setPath(it.pos.x, it.pos.z); t.walking = true; }
      if (!u.path.length) { this.toIdle(u); return; }
      u.moveAnim(u.steer(dt, u.speed, 0.5));
      return;
    }
    // arrived: a character bends down ("pick_up"), then the item is its
    u.path = []; u.vel.set(0, 0, 0);
    t.phase = 'take';
    t.wait = 0;
    if (u.cls === 'CHTR' && u.anim.has('pick_up')) { u.anim.play('pick_up', { restart: true, loop: false }); u.busyAnim = true; t.wait = u.anim.duration('pick_up') || 1; }
  },
  // FightingObj.AddItem / CItem.OnTaken: the item goes into the unit's inventory and works
  takeItem(u, it) {
    if (!u.alive || u.item || it.item.carrier) return false;
    u.item = it;
    it.item.carrier = u;
    it.setVisible(false);
    u.busyAnim = false;
    this.itemEffects(it, u, true);
    this.emit('itemTaken', { unit: u, item: it });
    this.emit('msg', { player: u.owner, key: '_NT_Artefact_Gain', text: 'Artefact found', item: it.item.cls });
    return true;
  },
  // FightingObj.RemoveItem / CItem.OnDropped: the item falls where the unit stands - into deep water it is lost
  dropItem(u) {
    const it = u.item;
    if (!it) return null;
    u.item = null;
    it.item.carrier = null;
    this.itemEffects(it, u, false);
    this.emit('itemDropped', { unit: u, item: it });
    if (u.owner) this.emit('msg', { player: u.owner, key: '_NT_Artefact_Lost', text: 'Artefact lost', item: it.item.cls });
    const x = u.pos.x, z = u.pos.z, h = this.height(x, z);
    if (this.waterLevel != null && h < this.waterLevel - 0.5) { it.remove(); this.items = this.items.filter((i) => i !== it); return null; }
    it.pos.set(x, h, z);
    it.obj.position.copy(it.pos);
    it.setVisible(true);
    return it;
  },
  // the item's effect on (taken) or off (dropped): its filters and its effect (CItem.OnTaken / OnDropped,
  // CItemEffectInvoker). Items that work while not carried or on use (none in the game) do nothing here.
  itemEffects(it, u, on) {
    const def = this.itemDef(it.item.cls), p = u.owner;
    if (def.effect !== 1) return;
    const f = (path) => String(path || '').replace(/^\/?Filters\//, '');
    if (def.localTT) this.localFilter(u, f(def.localTT), on);
    if (def.globalTT && p && p.tt) { if (on) p.tt.enable(f(def.globalTT)); else p.tt.disable(f(def.globalTT)); }
    if (def.effectName) this.itemEffect(def.effectName, def, u, on);
    if (it.item.cls === 'item_ride_cup') this.rideCup(u, on);
  },
  itemEffect(name, def, u, on) {
    const p = u.owner;
    const k = name.lastIndexOf('_'), base = k >= 0 ? name.slice(0, k) : name, type = k >= 0 ? name.slice(k + 1) : '';
    switch (base) {
      // the carrier's player's characters all at full hit points
      case 'HealAll': if (on && p) for (const c of this.units) if (c.alive && c.owner === p && c.cls === 'CHTR') this.setHp(c, c.maxHp); break;
      // the whole map is seen for a moment (a ShowFOW_Obj of the map's size, gone after 0.1 s): explored
      case 'ShowWorld': if (on && p) this.revealArea(p, 0, 0, this.size, 0.1); break;
      // repairs cost the carrier's player nothing (character.usl ms_iRepairNoCost)
      case 'RepairNoCost': this.repairNoCost = on && p ? p : null; break;
      // units of the type walk any slope (SetIgnoreSlope): no unit of the game is stopped by a slope in the remake
      case 'IgnoreSlope': if (p) for (const c of this.units) if (c.alive && c.owner === p && c.cls === type) c.ignoreSlope = on; break;
      // the skulls the player gets are multiplied (Player.AddScalps)
      case 'MoreScalps': if (p) p.scalpMod = on ? def.bonus : 1; break;
      default: break;                   // (MIRAGE's item_spores names "BoomingEconomy": no such effect in the scripts)
    }
  },
  // CRideCup: while its carrier rides a transport (an animal, a vehicle) the transport has half its hit points more
  rideCup(u, on) {
    const t = u.inside;
    if (!t || t.kind !== 'unit') return;
    this.transportBonus(t, on && u.item && u.item.item.cls === 'item_ride_cup');
  },
  transportBonus(t, on) {
    if (!!t.rideCup === !!on) return;
    t.rideCup = !!on;
    const f = t.hp / t.maxHp;
    t.maxHp = t.stats.hp * (on ? 1.5 : 1) * (t.grow ?? 1);
    t.hp = Math.min(t.maxHp, f * t.maxHp);
  },
  // the scalps a player gets (Player.AddScalps: rounded, times the scalps modifier)
  addScalps(p, n) { const v = Math.floor(Math.round(n) * (p.scalpMod || 1) + 0.5); p.res.skulls += v; if (p.gained) p.gained.skulls += v; },
};
