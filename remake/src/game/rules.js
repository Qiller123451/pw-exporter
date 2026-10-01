// Game rules derived from the (runtime) tech tree - see techtree.js - plus a few tables the original keeps in
// script files (script classes, resource values, the hero list; tools/build_data.py -> gamedata.json).
//
// Every query takes the owning player (or null for wild animals) because each player has its own tree:
// upgrades, level filters and buildings change the values while the game runs. Results are memoised per tree
// version, so reading stats every frame is cheap.
//
//   rules.def(name, owner)             class data (type, tribe, script class, flags, captain, delivery, ...)
//   rules.stats(name, level, owner)    per-level stats (hit points, sight, speed, gfx, limits, carry, abilities ...)
//   rules.weaponSet(name, lv, owner)   weapons a unit uses at a level {long, medium, short} (WeaponMgr.GetBestWeapon)
//   rules.weaponStats(w, name, owner)  a weapon's values after the tribe's /Modifications (FightingObj.UpdateWeapons)
//   rules.actionsAt(owner, at)         build / upgrade / move actions offered by a unit or building class
//   rules.check(owner, action, unit)   null if the action can be started, else a reason code
//
// Naming: "level" is always the pyramid row as shown to the player, 1..5 (the scripts use 0..4).
import { TechTreeBase, TechTree, num, bool, scalar, nodeAt, modsOf, applyMod, TRIBES } from './techtree.js';

export const RES = ['food', 'wood', 'stone'];
export const COSTS = ['food', 'wood', 'stone', 'skulls'];       // "iron" in the tech tree = skulls
export const TYPES = ['CHTR', 'ANML', 'VHCL', 'SHIP', 'BLDG', 'NEST'];
export const SPEED_FALLBACK = [0, 1.5, 5, 7, 10];
// units that prefer buildings as targets (SetAttackType(1): character.usl:614, Vehicle.usl, Ship.usl, Animal.usl)
const SIEGE = new Set(['aje_rammer', 'ninigi_mortar', 'hu_steam_ram', 'ninigi_firecannon', 'hu_steam_boat', 'aje_catamaran',
  'ninigi_rocket_boat', 'hu_mammoth_log_cannon', 'aje_ankylosaurus']);
// transport class 2 (carries characters, animals and vehicles): ships, hovercraft, transport turtle (TransportObj.usl:1076)
const TRANSPORT2 = new Set(['seas_hovercraft', 'aje_transport_turtle']);
const list = (n) => (n && typeof n === 'object' ? Object.entries(n).filter(([k]) => k !== '_value').map(([, v]) => v) : []);
const strs = (n) => list(n).map(scalar).filter((x) => typeof x === 'string');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Rules {
  constructor(ttJson, extra) {
    this.base = new TechTreeBase(ttJson);
    this.extra = extra || {};
    this.texts = this.extra.texts || {};
    this.scripts = this.extra.script || {};
    this.resourceValues = this.extra.resources || {};
    this.npc = new Set((this.extra.npc || []).map((n) => n.toLowerCase()));
    this.pyramid = this.extra.pyramid || [25, 15, 8, 3, 1];
    this.levelupSkulls = this.extra.levelup_skulls || [25, 50, 100, 300];
    this.world = new TechTree(this.base, 'World');
    // name -> { tribe, type, path } for every object class of StartTT
    this.index = new Map();
    // unit class -> [weapon path] (a weapon lists its users)
    this.users = new Map();
    const O = this.base.start.Objects;
    for (const tribe in O) {
      for (const type of TYPES) for (const name in O[tribe][type] || {}) {
        if (typeof O[tribe][type][name] === 'object' && !this.index.has(name)) this.index.set(name, { tribe, type, path: `/Objects/${tribe}/${type}/${name}` });
      }
      for (const w in O[tribe].Weapons || {}) {
        const node = O[tribe].Weapons[w];
        if (!node || typeof node !== 'object') continue;
        for (const u of strs(node.Users)) { if (!this.users.has(u)) this.users.set(u, []); this.users.get(u).push(`/Objects/${tribe}/Weapons/${w}`); }
      }
    }
  }
  tree(owner) { return owner && owner.tt ? owner.tt : this.world; }
  newTree(tribe) { return new TechTree(this.base, tribe); }
  info(name) { return this.index.get(name) || null; }
  exists(name) { return this.index.has(name); }
  // script class of an object ("CTower", "CGrowingField", ...; classes/**/*.txt)
  script(name) { return this.scripts[String(name).toLowerCase()] || null; }
  // the model named in the class file (used when the tech tree's gfx doesn't exist, e.g. hu_flamethrower)
  // attached parts of an object (riders, turrets, build-ups ...; game/compose.js), [] if none
  composites(name) { return (this.extra.composites || {})[String(name).toLowerCase()] || []; }
  classGfx(name) { return (this.extra.classgfx || {})[String(name).toLowerCase()] || null; }
  // food of a carcass "<class>_food" (settings/Resources.txt FOOD; default 100 - Resource.usl:61)
  corpseFood(name) { const v = (this.resourceValues.FOOD || {})[String(name).toLowerCase() + '_food']; return v > 0 ? v : 100; }
  resourceValue(section, name, d) { const v = (this.resourceValues[section] || {})[String(name).toLowerCase()]; return v > 0 ? v : d; }

  // ---------------------------------------------------------------- class data
  def(name, owner) {
    const T = this.tree(owner);
    return T.memo('def|' + name, () => {
      const ix = this.info(name);
      if (!ix) return null;
      const o = T.node(ix.path) || nodeAt(this.base.start, ix.path);
      if (!o) return null;
      const cap = scalar(o.captainclass);
      const flagList = (n) => (n && typeof n === 'object' ? Object.entries(n).filter(([k, v]) => k !== '_value' && scalar(v) === '1').map(([k]) => k) : []);
      const d = {
        name, tribe: ix.tribe, type: ix.type, class: ix.type, path: ix.path, desc: scalar(o.description),
        script: this.script(name),
        aggressive: num(scalar(o.aggressive)), can_build: num(scalar(o.can_build)), can_harvest: num(scalar(o.can_harvest)),
        maxworkers: num(scalar(o.maxworkers)), caste: scalar(o.caste) || null, standanim: scalar(o.standanim), fx: scalar(o.fx_class),
        wall: bool(scalar(o.wall)), gate: bool(scalar(o.gate)), coastal: bool(scalar(o.coastal)),
        wallKind: null,
        // resources an "unlimited" building produces (CUnlimitedBuilding: Objects/../unlimited/<res> = 1)
        unlimited: flagList(o.unlimited),
        maxPassengers: num(scalar(o.max_passengers)), buildupAutoattack: bool(scalar(o.buildup_autoattack)),
        delivery: flagList(o.delivery),
        captain: cap && cap !== '0' ? cap : null,
        startTT: scalar(o.StartTT) && scalar(o.StartTT) !== '0' ? scalar(o.StartTT) : null,
        globalStartTT: scalar(o.GlobalStartTT) && scalar(o.GlobalStartTT) !== '0' ? scalar(o.GlobalStartTT) : null,
        unique: this.npc.has(name.toLowerCase()),
        attackType: SIEGE.has(name) ? 1 : 0,
        levels: {},
      };
      // objects of the wall placer (TT wall=1) and gates: which kind of wall-map object (docs/spec/walls.md §1)
      if (d.gate && d.script !== 'CLadder') d.wallKind = 'gate';
      else if (d.wall) d.wallKind = /^(CWall|CNinigi_Defense_Skewer)$/.test(d.script) ? 'wall'
        : /Pitfall|SnareTrap|ResinField|Minefield|PoisonDung|Trap/.test(d.script) ? 'trap' : 'tower';
      d.transportClass = !d.maxPassengers ? 0 : (ix.type === 'SHIP' || TRANSPORT2.has(name)) ? 2 : 1;
      if (d.captain) { const c = this.info(d.captain); const cn = c && (T.node(c.path) || nodeAt(this.base.start, c.path)); d.captain_gfx = cn ? scalar(cn.gfx) : null; }
      for (let l = 1; l <= 5; l++) d.levels[l] = this.stats(name, l, owner);
      return d;
    });
  }
  // modifier column of a class: characters use their caste, everything else "tec" (FightingObj.usl:8395, character.usl:2640)
  column(name, owner) {
    const ix = this.info(name);
    if (!ix || ix.type !== 'CHTR') return 'tec';
    const o = this.tree(owner).node(ix.path) || nodeAt(this.base.start, ix.path);
    const c = o && scalar(o.caste);
    return c === 'res' || c === 'nat' || c === 'tec' ? c : 'tec';
  }
  // filters of a unit class at a level (FightingObj.SetLevelFilter: "Filters/<tribe>/Upgrades/<class>/Lvl<N>...")
  levelFilters(name, level) {
    if (level <= 1) return [];
    const ix = this.info(name);
    if (!ix) return [];
    return this.base.filtersUnder(`${ix.tribe}/Upgrades/${name}/Lvl${level}`);
  }
  // can a unit class exist at this level? (level 1 always; higher levels need their bonus filter)
  hasLevel(name, level) {
    if (level === 1) return true;
    return this.levelFilters(name, level).some((p) => p.includes('_Bonus'));
  }
  // the object node of a class at a level: player tree value + the unit's own "_Bonus" level filter
  levelNode(name, level, owner) {
    const T = this.tree(owner);
    return T.memo(`ln|${name}|${level}`, () => {
      const ix = this.info(name);
      if (!ix) return null;
      const o = T.node(ix.path) || nodeAt(this.base.start, ix.path);
      if (!o) return null;
      const bonus = this.levelFilters(name, level).filter((p) => p.includes('_Bonus'));
      if (!bonus.length) return o;
      // apply the bonus modificators that address this object to a private copy
      const parts = ix.path.split('/').filter(Boolean);
      const root = {}; let n = root;
      for (let i = 0; i < parts.length - 1; i++) n = n[parts[i]] = {};
      n[parts[parts.length - 1]] = structuredClone(o);
      for (const p of bonus) {
        const f = this.base.filter(p);
        for (const m of modsOf(f)) if (m.path.startsWith(ix.path + '/') || m.path === ix.path) applyMod(root, m);
        // LevelBonusData (a full snapshot) fills values the modificators don't touch
        if (f && f.LevelBonusData && !modsOf(f).length) Object.assign(n[parts[parts.length - 1]], structuredClone(f.LevelBonusData));
      }
      return n[parts[parts.length - 1]];
    });
  }
  // stats at a level (GetTechTreeHitpoints / UpdateFOW / GetScalpValue / GetResInvCap apply the tribe's /Modifications)
  stats(name, level, owner) {
    const T = this.tree(owner);
    return T.memo(`st|${name}|${level}`, () => {
      const ix = this.info(name);
      if (!ix) return null;
      const o = this.levelNode(name, level, owner);
      if (!o) return null;
      const exists = level === 1 ? num(scalar(o.hitpoints)) > 1 : this.hasLevel(name, level);
      const typ = ix.type, col = this.column(name, owner);
      const mtribe = ix.tribe === 'Special' || ix.tribe === 'World' ? T.tribe : ix.tribe;
      const mod = (stat, v) => T.modify(typ, stat, v, col, mtribe);
      const sa = o.special_abilities && typeof o.special_abilities === 'object' ? o.special_abilities : {};
      const on = (k) => sa[k] && typeof sa[k] === 'object' && scalar(sa[k].enabled) !== 'false' && scalar(sa[k].enabled) !== '0';
      const heal = on('heal') ? { radius: num(scalar(sa.heal.radius)), amount: num(scalar(sa.heal.amount)), mod: num(scalar(sa.heal.mod)) } : null;
      const lim = o.UpdateLimits || {}, inv = o.ResInvCaps || {};
      // hit points: tribe/type modifier, then the per-class modifier /Modifications/<tribe>/<class>/Hitpoints (FO:3718)
      let hp = exists ? mod('Hitpoints', num(scalar(o.hitpoints))) : 0;
      hp = hp * T.num(`/Modifications/${mtribe}/${name}/Hitpoints/rel`, 1) + T.num(`/Modifications/${mtribe}/${name}/Hitpoints/abs`, 0);
      const cap = (r) => Math.max(0, mod('ResInv', num(scalar(inv[r]), 5)));
      const abilities = {};
      for (const k in sa) if (on(k)) { const a = {}; for (const kk in sa[k]) if (kk !== '_value') a[kk] = num(scalar(sa[k][kk]), scalar(sa[k][kk])); abilities[k] = a; }
      return {
        exists, level, hp,
        fow: mod('FOW', num(scalar(o.FOW), 25)),
        speed: num(scalar(o.defaultspeed)), maxspeed: num(scalar(o.maxspeed)),
        tf: num(scalar(o.timefactor), 1), scalps: Math.round(mod('Skulls', num(scalar(o.scalps), 5))),
        gfx: scalar(o.gfx), size: num(scalar(o.unit_size)), captainlevel: num(scalar(o.captainlevel)),
        aggressive: num(scalar(o.aggressive)),
        carry: { food: cap('food'), wood: cap('wood'), stone: cap('stone') },
        limits: { max_units: num(scalar(lim.max_units)), max_food: num(scalar(lim.max_food)), max_wood: num(scalar(lim.max_wood)), max_stone: num(scalar(lim.max_stone)) },
        heal, healMod: { rel: T.modifier(typ, 'Healing', true, col, mtribe), abs: T.modifier(typ, 'Healing', false, col, mtribe) },
        abilities, maxworkers: num(scalar(o.maxworkers)), agility: num(scalar(o.agility)),
        maxPassengers: num(scalar(o.max_passengers)),
        captain: scalar(o.captainclass) && scalar(o.captainclass) !== '0' ? scalar(o.captainclass) : null,
      };
    });
  }
  // ---------------------------------------------------------------- weapons
  // raw weapon data (tech tree values, no modifiers)
  weapon(path, owner) {
    const T = this.tree(owner);
    return T.memo('w|' + path, () => {
      const w = T.node(path) || nodeAt(this.base.start, path);
      if (!w || typeof w !== 'object') return null;
      const bonus = (n) => {
        const out = {};
        const t = n && n.Type; if (t && typeof t === 'object') for (const k in t) if (k !== '_value') out[k] = num(scalar(t[k]));
        const c = n && n.Class; if (c && typeof c === 'object') for (const k in c) if (k !== '_value') out[k] = (out[k] || 0) + num(scalar(c[k]));
        return out;
      };
      const id = path.split('/').pop();
      return {
        id, path, level: num(scalar(w.level)), secondary: num(scalar(w.secondary)), slot: num(scalar(w.slot)),
        dmg: num(scalar(w.damage)), mindmg: num(scalar(w.mindamage)), enddmg: num(scalar(w.enddamage)), range: num(scalar(w.range)),
        minrange: num(scalar(w.minattackrange)), freq: num(scalar(w.frequency)), splash: num(scalar(w.hitrange)),
        def: num(scalar(w.defense)), rdef: num(scalar(w.rangeddefense)), ap: num(scalar(w.armorpiercing)),
        poison: num(scalar(w.poison_damage)), poisonTicks: num(scalar(w.poison_tick_count)), bulletspeed: num(scalar(w.bulletspeed)),
        falloff: num(scalar(w.bulletfalloff)), jitter: num(scalar(w.jitter)), size: num(scalar(w.unit_size)), caste: scalar(w.caste),
        penetration: bool(scalar(w.penetration)), penAngle: num(scalar(w.penetration_angle), 30), fx: scalar(w.fx_class),
        projectile: strs(w.Projectile)[0] || null, bonus: bonus(w.AttackBonus), defBonus: bonus(w.DefenseBonus),
        anims: list(w.Animations).filter((a) => a && typeof a === 'object').map((a) => ({ name: scalar(a), delay: num(scalar(a.delay)), shootdelay: num(scalar(a.shootdelay)), combo: num(scalar(a.combo)), follow: scalar(a.followanim) || null })),
        parts: list(w.Parts).filter((p) => p && typeof p === 'object').map((p) => ({ gfx: strs(p.Gfx), link: scalar(p.Links), kind: scalar(p) })),
      };
    });
  }
  // WeaponMgr.GetStandardWeapons + GetBestWeapon (WeaponMgr.usl:226-359):
  //   candidates: weapons whose Users list the class and whose level <= the unit's level (a weapon with all values 0 is ignored)
  //   primary ("long")  = best non-secondary weapon by NoBoni value (ties keep the first)
  //   short             = best secondary weapon with range < 1   (e.g. a spearman's dagger when enemies get too close)
  //   medium            = best secondary weapon with range >= 1
  weaponSet(name, level, owner) {
    const T = this.tree(owner);
    return T.memo(`ws|${name}|${level}`, () => {
      const set = { long: null, medium: null, short: null, all: [] };
      const cand = this.weaponPaths(name, owner).map((p) => this.weapon(p, owner)).filter((w) => w && !(w.dmg === 0 && w.def === 0 && w.rdef === 0 && w.level === 0 && w.range === 0));
      set.all = cand;
      const avail = cand.filter((w) => (w.level || 1) <= level);
      const noBoni = (w) => (w.dmg + w.def + w.rdef) * (1 + (w.range - w.minrange) * 0.1) * (60 / Math.max(w.freq, 60)) * (1 + (w.splash + w.enddmg) * 0.1);
      const best = (f) => { let b = null, bv = -1; for (const w of avail) { if (!f(w)) continue; const v = noBoni(w); if (v > bv) { bv = v; b = w; } } return b; };
      set.long = best((w) => !w.secondary);
      set.short = best((w) => w.secondary && w.range < 1);
      set.medium = best((w) => w.secondary && w.range >= 1);
      if (!set.long) set.long = set.medium || set.short;
      return set;
    });
  }
  // weapons whose "Users" list names this class. Filters can move a class to other weapons
  // (e.g. aje_ankylosaurus_catapult removes the unit from aje_ankylosaurus_weapon_b..e and adds it to the catapult weapons),
  // so the lists are read from the owner's current tree; the start tree's index is the fallback.
  weaponPaths(name, owner) {
    const T = this.tree(owner);
    if (!T || !T.node) return this.users.get(name) || [];
    const map = T.memo('weaponUsers', () => {
      const m = new Map();
      const O = T.node('/Objects') || {};
      // a tree only holds its own tribe, "Special" and "World": other tribes' weapons come from the start tree
      for (const [u, paths] of this.users) for (const p of paths) if (!O[p.split('/')[2]]) { if (!m.has(u)) m.set(u, []); m.get(u).push(p); }
      for (const tribe in O) {
        const W = O[tribe] && O[tribe].Weapons;
        if (!W || typeof W !== 'object') continue;
        for (const w in W) {
          const node = W[w];
          if (!node || typeof node !== 'object') continue;
          for (const u of strs(node.Users)) { if (!m.has(u)) m.set(u, []); m.get(u).push(`/Objects/${tribe}/Weapons/${w}`); }
        }
      }
      return m;
    });
    return map.get(name) || [];
  }
  // a weapon's values for a unit class after the tribe's modifiers (FightingObj.UpdateWeapons FO:7420):
  //   dmg   = (damage * ranged_damage for projectile weapons) * Damage       (rel/abs)
  //   prot  = clamp(defense * Defence, 0, 99)    rprot = clamp(rangeddefense * RangedDefence, 0, 99)
  //   range = range * Range                      dur   = 60 / frequency * WeaponDuration   (seconds between attacks)
  weaponStats(w, name, owner) {
    if (!w) return null;
    const T = this.tree(owner);
    return T.memo(`wst|${w.path}|${name}`, () => {
      const ix = this.info(name) || { type: 'CHTR', tribe: T.tribe };
      const col = this.column(name, owner);
      const tribe = ix.tribe === 'Special' || ix.tribe === 'World' ? T.tribe : ix.tribe;
      const m = (stat, v) => T.modify(ix.type, stat, v, col, tribe);
      let dmg = w.dmg;
      if (w.projectile) dmg = m('ranged_damage', dmg);
      dmg = m('Damage', dmg);
      return {
        w, dmg, endDmg: w.enddmg, ap: w.ap, splash: w.splash,
        prot: clamp(m('Defence', w.def), 0, 99), rprot: clamp(m('RangedDefence', w.rdef), 0, 99),
        range: m('Range', w.range), minRange: w.minrange,
        dur: m('WeaponDuration', 60 / (w.freq || 1)),
        poison: w.poison, poisonTicks: w.poisonTicks,
      };
    });
  }
  // victim's "Defence_<attackerType>" modifier (used with DefenseBonus in TakeDmg)
  defenceVs(name, owner, attackerType) {
    const T = this.tree(owner);
    const ix = this.info(name) || { type: 'CHTR' };
    const col = this.column(name, owner);
    return { rel: T.modifier(ix.type, 'Defence_' + attackerType, true, col), abs: T.modifier(ix.type, 'Defence_' + attackerType, false, col) };
  }
  // ---------------------------------------------------------------- actions
  // every action of the tribe: { id, kind: Build|Upgrades|Moves, cat, path, time, cost, req, breq, locs, results, visible, disabled }
  actions(owner) {
    const T = this.tree(owner);
    return T.memo('actions', () => {
      const out = [];
      for (const tribe of [T.tribe, 'Special']) {
        const A = T.node(`/Actions/${tribe}`);
        if (!A) continue;
        for (const kind of ['Build', 'Upgrades', 'Moves']) {
          for (const cat in A[kind] || {}) {
            for (const id in A[kind][cat] || {}) {
              const a = A[kind][cat][id];
              if (!a || typeof a !== 'object' || !a.locations) continue;
              out.push(this.parseAction(tribe, kind, cat, id, a));
            }
          }
        }
      }
      return out;
    });
  }
  parseAction(tribe, kind, cat, id, a) {
    const c = a.conditions || {};
    const rc = c.rescosts || {};
    const locs = list(a.locations).map((l) => (typeof l === 'string' ? { _value: l } : l)).filter((l) => l && typeof l === 'object').map((l) => ({
      at: (scalar(l) || '').split('/').pop(), ui: l.uiposition || null, icon: scalar(l.iconpath), desc: scalar(l.description),
      hidden: !!(l.uiposition && scalar(l.uiposition.menupos) === '-1'),     // menupos -1: not in any menu
      localflags: l.localflags && typeof l.localflags === 'object' ? Object.keys(l.localflags).filter((k) => k !== '_value') : null,
    }));
    const results = list(a.results).filter((r) => r && typeof r === 'object').map((r) => ({
      obj: (scalar(r) || '').split('/').pop(), path: scalar(r), type: scalar(r.type), cls: scalar(r.class) || 'player',
      level: r.flags ? num(scalar(r.flags.level), 0) : 0, rider: scalar(r.rider), resultActions: strs(r.resultactions) }));
    const sc = a.secondarycontroller;
    const target = sc && typeof sc === 'object' ? strs(sc) : scalar(sc) && scalar(sc) !== '0' ? String(scalar(sc)).split(/[ ,|]+/).filter(Boolean) : null;
    return {
      id, tribe, kind, cat: kind + '/' + cat, type: cat, path: `/Actions/${tribe}/${kind}/${cat}/${id}`,
      time: num(scalar(a.duration)), visible: num(scalar(a.visibility), 1) > 0, disabled: bool(scalar(a.disabled)),
      cost: { food: num(scalar(rc.food)), wood: num(scalar(rc.wood)), stone: num(scalar(rc.stone)), skulls: num(scalar(rc.iron)) },
      req: strs(c.inventobjects), breq: strs(c.buildobjects), levelReq: num(scalar(c.level), 0), casteReq: strs(c.caste),
      tribes: strs(c.tribe), locs, results,
      // target picking of moves: VEC3 (ground) and/or object types; "Enemies" / "Owner" ...
      target: target && target.length ? target : null,
      targetOwner: a.secondarycontrollerowner && typeof a.secondarycontrollerowner === 'object' ? strs(a.secondarycontrollerowner) : scalar(a.secondarycontrollerowner) ? [scalar(a.secondarycontrollerowner)] : null,
    };
  }
  // actions offered at a location class, each with its location entry as .loc
  actionsAt(owner, at) {
    const T = this.tree(owner);
    return T.memo('at|' + at, () => {
      const out = [];
      for (const a of this.actions(owner)) for (const l of a.locs) if (l.at === at && !l.hidden) out.push({ ...a, loc: l });
      return out;
    });
  }
  // actions an entity offers: its own class, plus the type-wide ones (location "/Objects/<tribe>/CHTR" etc.)
  actionsOf(owner, e) {
    const T = this.tree(owner);
    return T.memo('of|' + e.name, () => {
      const byClass = this.actionsAt(owner, e.name);
      const type = e.def ? e.def.type : e.cls;
      const byType = type ? this.actionsAt(owner, type) : [];
      const seen = new Set(byClass.map((a) => a.path));
      return [...byClass, ...byType.filter((a) => !seen.has(a.path))];
    });
  }
  // RequirementsMgr: null = ok, else 'hidden' | 'disabled' | 'req' | 'level'
  check(owner, a, unit = null) {
    if (!a.visible) return 'hidden';
    if (a.disabled) return 'disabled';
    const T = this.tree(owner);
    const t = a.tribe === 'Special' ? T.tribe : a.tribe;
    for (const r of a.req) if (!this.invented(owner, r, t, unit)) return 'req';
    // debug mode (player.js): no buildings needed either, e.g. the Dragon Clan epoch upgrade (lumber mill + dojo)
    if (!owner.debug) for (const r of a.breq) if (!T.built(r, t)) return 'req';
    if (unit && a.levelReq && unit.level < a.levelReq) return 'level';
    return null;
  }
  // invention check; "local" upgrades (e.g. Ninigi Explode, Aje farm modes) live on the building itself
  invented(owner, name, tribe, unit) {
    if (unit && unit.localInvents && unit.localInvents.has(name)) return true;
    return this.tree(owner).invented(name, tribe);
  }
  missing(owner, a, unit) {
    const T = this.tree(owner);
    const t = a.tribe === 'Special' ? T.tribe : a.tribe;
    return [...a.req.filter((r) => !this.invented(owner, r, t, unit)), ...(owner.debug ? [] : a.breq.filter((r) => !T.built(r, t)))];
  }
  startLevel(action) { let lv = 1; for (const r of action.results) if (r.level) lv = Math.max(lv, r.level); return lv; }

  // lowest level a class exists at (e.g. marksmen start at level 2)
  minLevel(name, owner) { for (let l = 1; l <= 5; l++) { const s = this.stats(name, l, owner); if (s && s.exists) return l; } return 1; }
  // nearest existing level's stats (the game never asks for a level the class doesn't have, but be forgiving)
  statsAt(name, level, owner) {
    for (let l = level; l >= 1; l--) { const s = this.stats(name, l, owner); if (s && s.exists) return s; }
    for (let l = level; l <= 5; l++) { const s = this.stats(name, l, owner); if (s && s.exists) return s; }
    return this.stats(name, 1, owner);
  }
  miscValue(owner, key, d) { const T = this.tree(owner); return T.num(`/MiscValues/${T.tribe}/${key}`, d); }
  // ---------------------------------------------------------------- misc
  text(name) {
    const t = this.texts[name] || this.texts[String(name).toLowerCase()];
    return t || { name: prettify(name), medium: '', long: '', vs: {} };
  }
  idleSet(name) { return (this.extra.idle || {})[name.toLowerCase()] || null; }
  start(tribe) { return (this.extra.start || {})[tribe]; }
  tribes() { return TRIBES; }
}

export function prettify(n) {
  return String(n).replace(/^(seas|aje|hu|ninigi)_/, '').replace(/_s\d$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
