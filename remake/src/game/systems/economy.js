// Economy: gathering wood, stone and food, fields and other "unlimited" buildings, delivery, storage,
// buying resources with skulls.
//
// Reference: docs/spec/economy.md (Harvest.usl, Mine.usl, GetFood.usl, GetCorn.usl, GetUnlimited.usl,
// DeliverResources.usl, Building.usl CWarehouse).
//
// Time for one load (the core formula of all gather tasks):
//   loops = trunc(K * TF * space / capacity)      space = free carrying capacity (a full load when empty)
//   K  = 5 wood, 5 stone, 3 bushes and carcasses, 5 fields and slaughterhouses
//   TF = worker time factor ("timefactor", 0 -> 2.0): wood uses only the worker's, stone/food x NODE_TF,
//        fields x the building's time factor
// Each loop is one play of the work animation, so the real duration comes from the original animation lengths.
import { RES } from '../rules.js';

export const NODE_TF = 2.0;            // TimeFactor/STON|FOOD|FRUI as read by the scripts (falls back to 2.0 - see spec 3.2)
const K = { wood: 5, stone: 5, food: 3, field: 5, unlimited: 5 };
const SLOTS = { CGrowingField: 2, CCornfield: 2, CUnlimitedBuilding: 2, CAjeUnlimitedBuilding: 4 };
// what a worker carries (SetThing, Harvest.usl:90): stone and food in the tribe's container
const CONTAINER = { Hu: ['Back', 'hu_pannier'], Aje: ['HndR', 'aje_clay_jug'], Ninigi: ['HndR', 'ninigi_basket'], SEAS: ['Back', 'seas_backpack'] };
// skulls -> resources at the market: 100 skulls buy 100 food / 67 wood / 50 stone (NewPointBuyCosts.txt)
export const BUY_RATE = { food: 1.0, wood: 1.5, stone: 2.0 };
const selfTF = (e) => (e && e.stats && e.stats.tf > 0 ? e.stats.tf : 2.0);
const tribeOf = (u) => (u.owner ? u.owner.tribe : u.def.tribe);
const tool = (u, kind) => `${tribeOf(u).toLowerCase()}_${kind}`;

export const Economy = {
  carryCap(u, res) {
    // harvester vehicles and the lumber mammoth: a whole log per trip, 150 stone (20 for the SEAS walker) - HarvesterTask.usl
    if (u.cls !== 'CHTR') return res === 'wood' ? 1e6 : u.name === 'seas_mechanical_walker' ? 20 : 150;
    const c = u.stats.carry || {}; return c[res] || c.food || 20;
  },
  // slots of a field / slaughterhouse
  farmSlots(b) { return SLOTS[b.def.script] || b.def.maxworkers || 2; },
  isFarm(b) { return b && b.kind === 'building' && b.def.unlimited && b.def.unlimited.length > 0; },
  // what the worker's carrying looks like: container name + link
  carryLook(u, res, fromField) {
    if (fromField) return ['HndR', 'hu_corn', 'shoulder'];
    if (res === 'wood') return ['HndR', this.productWood || 'product_wood_jun', 'shoulder'];
    const c = CONTAINER[tribeOf(u)] || CONTAINER.SEAS;
    return [c[0], c[1], 'carry'];
  },

  // ------------------------------------------------------------------ orders
  startGather(u, node) {
    if (!u.isWorker || !node || !node.alive) return;
    // fish shoals: fishing boats only; fishing boats: fish shoals only (naval.md §4)
    if (node.water || u.naval) { if (node.water && this.startFishing) this.startFishing(u, node); return; }
    // vehicles and animals only harvest wood and stone (GetFood ends at once for them)
    if (u.cls !== 'CHTR' && (node.kind === 'building' || node.res === 'food')) return;
    if (node.kind === 'building') {
      if (!this.isFarm(node) || !node.built || node.owner !== u.owner) return;
      if (node.workers.size >= this.farmSlots(node) && !node.workers.has(u)) {
        // field full: try another ready field of the same kind within 50 m (GetCorn.usl)
        const other = this.buildings.find((b) => b !== node && b.alive && b.built && b.owner === u.owner && b.name === node.name && b.workers.size < this.farmSlots(b) && b.distTo(node) < 50);
        if (!other) return;
        node = other;
      }
      node.workers.add(u);
      u.task = { type: 'gather', farm: node, res: node.def.unlimited[0], phase: 'go', work: 0, user: u.task.user };
      const [fx, fz] = this.approachPoint(u, node);
      u.setPath(fx, fz);
      return;
    }
    node.workers.add(u);
    u.task = { type: 'gather', node, res: node.res, phase: 'go', work: 0, user: u.task.user, hunt: node.hunt || u.task.hunt };
    u.setPath(node.pos.x, node.pos.z);
  },

  // ------------------------------------------------------------------ the gather task
  gatherUpdate(u, dt) {
    const t = u.task;
    switch (t.phase) {
      case 'go': return this.gatherGo(u, t, dt);
      case 'chop': return this.gatherChop(u, t, dt);
      case 'work': return this.gatherWork(u, t, dt);
      case 'pickup': case 'putdown': return this.gatherWait(u, t, dt);
      case 'deliver': return this.gatherDeliver(u, t, dt);
    }
  },
  gatherGo(u, t, dt) {
    const target = t.node || t.farm;
    if (!target || !target.alive || (t.node && t.node.amount <= 0) || (t.farm && !t.farm.built)) return this.findNextNode(u);
    const near = t.node ? u.distTo(target) <= t.node.radius + u.radius + 0.8 : u.edgeDist(target) <= 1.5 || target.contains(u.pos.x, u.pos.z, 0.5);
    if (near || !u.path.length) { this.beginWork(u, t); return; }
    const sp = u.steer(dt, u.speed);
    u.moveAnim(sp);
  },
  // arrived: work out how many loops this load takes
  beginWork(u, t) {
    u.path = []; u.vel.set(0, 0, 0);
    t.work = 0; t.loopsDone = 0;
    const node = t.node, farm = t.farm;
    const res = t.res;
    const cap = this.carryCap(u, res);
    const have = u.carry && u.carry.res === res ? u.carry.amount : 0;
    if (u.carry && u.carry.res !== res) u.setCarry(null);
    const space = Math.max(0, cap - have);
    t.space = space;
    if (u.cls !== 'CHTR') {
      // vehicles: one cut fells a tree, one "take" loads the log; one mining animation per load of stone
      if (node && node.type === 'tree') this.fellTree(node);
      t.loops = 1; t.phase = 'work'; t.space = res === 'wood' ? node.amount : space;
      return;
    }
    if (node && node.type === 'tree') { t.phase = 'chop'; return; }
    let k, tf;
    if (farm) {
      const unlimited = farm.def.script === 'CAjeUnlimitedBuilding' || farm.def.script === 'CUnlimitedBuilding';
      k = unlimited ? K.unlimited : K.field; tf = selfTF(u) * selfTF(farm);
      t.farmKind = unlimited ? 'unlimited' : 'field';
      // the slaughterhouse credits the whole load first, then plays its animation (GetUnlimited.usl bash_food)
      if (unlimited) { u.setCarry(res, cap, this.carryLook(u, res, true)); }
    } else if (res === 'wood') { k = K.wood; tf = selfTF(u); }
    else if (res === 'stone') { k = K.stone; tf = selfTF(u) * NODE_TF; }
    else { k = K.food; tf = selfTF(u) * NODE_TF; }
    t.loops = Math.max(1, Math.trunc(k * tf * space / Math.max(1, cap)));
    t.phase = 'work';
  },
  // felling a standing tree: 6 chops of 1 s (trees have 30 hp, a chop takes 5) - Harvest.usl:654
  gatherChop(u, t, dt) {
    const node = t.node;
    if (!node || !node.alive) return this.findNextNode(u);
    if (node.type !== 'tree') { this.beginWork(u, t); return; }
    u.face(node.pos.x, node.pos.z, dt);
    u.attachTool(tool(u, 'axe'));
    u.anim.play(u.anim.pick('chop_tree', 'hacking', 'chop_0'), {});
    node.chop = (node.chop || 0) + dt;
    if (node.chop >= 6) { this.fellTree(node); this.beginWork(u, t); }
  },
  gatherWork(u, t, dt) {
    const node = t.node, farm = t.farm;
    if (node && (!node.alive || node.amount <= 0)) return this.findNextNode(u);
    if (farm && (!farm.alive || !farm.built)) return this.findNextNode(u);
    const tgt = node || farm;
    if (node) u.face(tgt.pos.x, tgt.pos.z, dt);
    const res = t.res;
    let clip;
    if (u.cls !== 'CHTR') clip = u.anim.pick('harvest', 'work_0', 'attack_front', 'standanim');
    else if (farm && t.farmKind === 'unlimited') { clip = u.anim.pick('potter_ground', 'harvesting_bush'); u.attachTool(null); }
    else if (farm) {
      // fields: "sowing" with the seed basket for the first quarter of the grow cycle, then "scything" with the sickle
      const sow = (farm.growStep || 0) < 25;
      clip = u.anim.pick(sow ? 'sowing' : 'scything', 'harvesting_bush', 'raking', 'hacking');
      u.attachTool(sow ? 'hu_seed_basket' : 'hu_sickle', sow ? 'HndL' : 'HndR');
    } else if (res === 'wood') { clip = u.anim.pick('hacking_dirt', 'hacking', 'chop_tree'); u.attachTool(tool(u, 'axe')); }
    else if (res === 'stone') { clip = u.anim.pick('hacking_stone', 'hacking'); u.attachTool(tool(u, 'pick')); }
    else if (node.type === 'corpse') { clip = u.anim.pick('potter_ground', 'harvesting_bush'); u.attachTool(null); }
    else { clip = u.anim.pick('harvesting_bush', 'potter'); u.attachTool('hu_seed_basket', 'HndL'); }
    u.anim.play(clip);
    const loopT = Math.max(0.5, u.anim.duration(clip) || 1.2);
    t.work += dt;
    // fields credit their harvest in chunks of 2..5 loops and advance the field's grow animation (GetCorn.usl)
    if (farm && t.farmKind === 'field') {
      const cap = this.carryCap(u, res);
      const step = cap / (K.field * selfTF(u) * selfTF(farm));
      const done = Math.floor(t.work / loopT);
      if (done > t.loopsDone) {
        t.loopsDone = done;
        farm.growStep = ((farm.growStep || 0) + 1) % 100;
        if (farm.anim && farm.anim.has('grow')) farm.anim.play('grow', { loop: false, restart: true });
        const have = u.carry && u.carry.res === res ? u.carry.amount : 0;
        const add = Math.min(step, cap - have);
        if (add > 0) u.carry = { res, amount: have + add, look: u.carry && u.carry.look };
        if (have + add < cap - 1e-6) return;
        u.setCarry(res, cap, this.carryLook(u, res, true));
        return this.pickUp(u, t, res, true);
      }
      return;
    }
    if (t.work < t.loops * loopT) return;
    // a full load
    if (farm) return this.pickUp(u, t, res, true);
    let amt = t.space;
    amt = Math.min(amt, node.amount);
    node.amount -= amt;
    if (node.type === 'corpse') node.rotT = 120;      // every harvest resets the rot timer (Resource.usl)
    if (node.amount <= 0.5) this.depleteNode(node);
    const have = u.carry && u.carry.res === res ? u.carry.amount : 0;
    u.setCarry(res, have + amt, this.carryLook(u, res, false));
    this.pickUp(u, t, res, false);
  },
  // shoulder_pick_up (wood, fields) / pick_up (stone, food), then off to the storehouse
  pickUp(u, t, res, fromField) {
    u.attachTool(null);
    if (u.cls !== 'CHTR') { t.phase = 'deliver'; t.drop = null; return; }
    const pu = u.anim.pick(res === 'wood' || fromField ? 'shoulder_pick_up' : 'pick_up', 'pick_up');
    t.phase = 'pickup'; t.drop = null; t.waitT = pu ? Math.min(1.6, u.anim.duration(pu)) : 0;
    if (res !== 'wood' && !fromField) t.waitT = Math.min(t.waitT, 0.6);
    if (pu) { u.busyAnim = true; u.anim.play(pu, { loop: false, restart: true, fade: 0.15, onDone: () => { u.busyAnim = false; } }); }
  },
  gatherWait(u, t, dt) {
    t.waitT -= dt;
    if (t.waitT > 0) return;
    u.busyAnim = false;
    if (t.phase === 'pickup') { t.phase = 'deliver'; return; }
    // after putting the load down: back to the same node / field, or look for the next one
    if (t.farm && t.farm.alive) { t.phase = 'go'; const [fx, fz] = this.approachPoint(u, t.farm); u.setPath(fx, fz); return; }
    const back = t.node && t.node.alive && t.node.amount > 0 ? t.node : null;
    if (back) { t.phase = 'go'; u.setPath(back.pos.x, back.pos.z); return; }
    this.findNextNode(u);
  },
  gatherDeliver(u, t, dt) {
    if (!u.carry) { t.phase = 'go'; return; }
    if (!t.drop || !t.drop.alive || !t.drop.isDropoff) {
      t.drop = this.nearestDropoff(u, u.carry.res);
      if (!t.drop) { u.vel.set(0, 0, 0); if (!u.busyAnim) u.anim.play(u.standAnim()); t.noDropT = (t.noDropT || 0) + dt; if (t.noDropT > 3) { u.task = { type: 'idle' }; } return; }
      const [x, z] = this.approachPoint(u, t.drop);
      u.setPath(x, z);
    }
    if (u.edgeDist(t.drop) < 2.2 || (!u.path.length && u.edgeDist(t.drop) < 5)) {
      const res = u.carry.res;
      const left = this.gain(u.owner, res, u.carry.amount);
      if (left >= u.carry.amount - 1e-6) {
        // storage full: wait at the storehouse and try again every 2 s (Harvest.usl:1002)
        u.path = []; u.vel.set(0, 0, 0);
        if (!u.busyAnim) u.anim.play(u.standAnim());
        t.fullT = (t.fullT || 0) + dt;
        if (!t.fullMsg) { t.fullMsg = true; this.emit('storagefull', { player: u.owner, res, unit: u }); }
        return;
      }
      t.fullT = 0; t.fullMsg = false;
      if (left > 0) { u.carry.amount = left; return; }
      if (t.drop.onDelivery) t.drop.onDelivery(u);
      u.setCarry(null);
      this.emit('delivered', { unit: u, res });
      const pd = u.cls !== 'CHTR' ? null : u.anim.pick(res === 'wood' || t.farm ? 'shoulder_put_down' : 'put_down', 'belly_put_down', 'put_down');
      t.phase = 'putdown'; t.waitT = pd ? Math.min(1.2, u.anim.duration(pd)) : 0; u.path = []; u.vel.set(0, 0, 0);
      if (res !== 'wood' && !t.farm) t.waitT = Math.min(t.waitT, 0.6);
      if (pd) { u.busyAnim = true; u.anim.play(pd, { loop: false, restart: true, fade: 0.15, onDone: () => { u.busyAnim = false; } }); }
      return;
    }
    if (t.drop.kind === 'unit' && !u.path.length) { const [x, z] = this.approachPoint(u, t.drop); u.setPath(x, z); }
    const sp = u.steer(dt, u.speed);
    u.moveAnim(sp);
  },
  // a load reaches the storehouse: a computer player's gather factor (CAiPlayer.AddResource, Player.usl:600) multiplies
  // it; -> the part of the load that did not fit (a remainder below one unit is dropped)
  gain(p, res, amount) {
    const g = p.aiMods ? p.aiMods.gather || 1 : 1;
    if (g === 1) return p.deliver(res, amount, this.time);
    const left = p.deliver(res, amount * g, this.time);
    return left < 1 ? 0 : left / g;
  },
  // search radius: wood 64 m around the last tree, stone 100 m, food 50 m (the scripts' search_for_jobs)
  findNextNode(u) {
    const t = u.task;
    const res = t.res;
    const from = t.node ? t.node.pos : t.farm ? t.farm.pos : u.pos;
    if (t.node) t.node.workers.delete(u);
    if (t.farm) {
      if (t.farm.alive && t.farm.built) { t.phase = 'go'; return; }
      t.farm.workers.delete(u); t.farm = null;
    }
    const radius = res === 'stone' ? 100 : res === 'wood' ? 64 : 50;
    let n = this.nearestResource(from.x, from.z, res, radius, t.node);
    // hunting chain (GetFood.usl:478): out of carcasses -> attack the next animal of the same kind within 50 m
    if (!n && res === 'food' && t.hunt) {
      const prey = this.nearestAnimal(from.x, from.z, t.hunt, 50);
      if (prey && !(u.carry && u.carry.amount > 0)) { this.releaseTask(u); u.task = { type: 'attack', target: prey, user: true, huntFood: true }; return; }
    }
    if (!n && res === 'food') n = this.nearestResource(from.x, from.z, 'food', 50, t.node, (x) => x.type !== 'corpse');
    if (u.carry && u.carry.amount > 0) { t.phase = 'deliver'; t.drop = null; t.node = n; if (n) n.workers.add(u); return; }
    if (t.phase === 'putdown' || t.phase === 'pickup') u.busyAnim = false;
    if (n) { this.startGather(u, n); return; }
    u.task = { type: 'idle' };
    u.attachTool(null);
  },
  nearestResource(x, z, res, r, exclude, filter) {
    let best = null, bd = r;
    this.rHash.query(x, z, r, (n) => {
      if (!n.alive || n.res !== res || n === exclude || n.amount <= 0) return;
      if (!!n.water !== !!(filter && filter.water)) return;          // fish shoals only for boats (filter.water)
      if (n.workers.size >= n.maxWorkers) return;
      if (filter && !filter(n)) return;
      const d = Math.hypot(n.pos.x - x, n.pos.z - z) + n.workers.size * 3;
      if (d < bd) { bd = d; best = n; }
    });
    return best;
  },
  nearestAnimal(x, z, name, r) {
    let best = null, bd = r;
    this.uHash.query(x, z, r, (a) => { if (!a.alive || !a.wild || a.name !== name) return; const d = Math.hypot(a.pos.x - x, a.pos.z - z); if (d < bd) { bd = d; best = a; } });
    return best;
  },
  // storehouses that accept this resource (buildings under construction don't)
  nearestDropoff(u, res) {
    let best = null, bd = 1e9;
    const test = (e) => {
      if (!e.alive || !e.owner || !u.owner || !u.owner.isFriend(e.owner) || !e.isDropoff || !e.def.delivery.includes(res)) return;
      const d = u.distTo(e);
      if (d < bd) { bd = d; best = e; }
    };
    for (const b of this.buildings) test(b);
    for (const x of this.units) if (x.isDropoff) test(x);
    return best;
  },
  // trees: standing tree -> timber log after 6 chops (vegetation.usl)
  fellTree(node) {
    if (node.type !== 'tree') return;
    node.type = 'timber';
    node.chop = 0;
    this.props.remove(node.propHandle);
    if (node.spriteHandles) for (const h of node.spriteHandles) this.foliage.hide(h);
    this.nav.mark(node.cells || [], -1);
    node.cells = [];
    node.radius = 2.2;
    node.maxWorkers = 5;               // at most 5 workers on one log (Resource.usl:212)
    if (node.stumpKind) node.stumpHandle = this.props.add(node.stumpKind, node.pos.x, node.pos.y, node.pos.z, node.rot || 0, node.scale || 1);
    if (node.timberKind) node.timberHandle = this.props.add(node.timberKind, node.pos.x, node.pos.y, node.pos.z, node.rot || 0, node.scale || 1);
    this.emit('treefall', { node });
  },
  depleteNode(node) {
    if (!node.alive) return;
    node.alive = false;
    this.rHash.remove(node);
    if (node.propHandle) this.props.remove(node.propHandle);
    if (node.timberHandle) this.props.remove(node.timberHandle);
    if (node.spriteHandles) for (const h of node.spriteHandles) this.foliage.hide(h);
    if (node.cells && node.cells.length) this.nav.mark(node.cells, -1);
    if (node.corpseOf) node.corpseOf.corpseGone = true;
    for (const w of node.workers) if (w.alive && w.task.node === node && w.task.phase !== 'deliver') this.findNextNode(w);
  },
  // storage and population limits (Player.UpdateLimits): sum of finished limit buildings, at least 300 per resource
  recomputeCaps(p) {
    if (!p) return;
    let mu = 0; const caps = { food: 0, wood: 0, stone: 0 };
    const add = (e) => {
      const L = e.stats.limits || {};
      mu += L.max_units || 0;
      caps.food += L.max_food || 0; caps.wood += L.max_wood || 0; caps.stone += L.max_stone || 0;
    };
    for (const b of this.buildings) if (b.alive && b.owner === p && b.built) add(b);
    for (const u of this.units) if (u.alive && u.owner === p && u.stats.limits && (u.stats.limits.max_units || u.stats.limits.max_food)) add(u);
    p.maxUnits = Math.max(0, Math.min(p.popMax, mu + (p.aiMods ? p.aiMods.unitLimit || 0 : 0)));
    if (p.capsFixed) return;                       // storage limits set by a mission (world.setCaps)
    const before = { ...p.caps };
    for (const r of RES) p.caps[r] = Math.max(300, caps[r]);
    // losing a storehouse cuts the stock down to the new limit
    for (const r of RES) if (p.caps[r] < before[r] && p.res[r] > p.caps[r]) p.res[r] = p.caps[r];
  },
  // ------------------------------------------------------------------ trade carts (Trade.usl)
  // A cart shuttles between two of its owner's trade buildings; each arrival pays the building's owner
  //   win = max(1, 5 * (distance / 50) ^ 1.32)  ->  win food, win / 1.5 wood, win / 2 stone
  isTradeBuilding(b) { return b && b.kind === 'building' && b.built && b.alive && /CWarehouse|CMarketplace/.test(b.def.script || ''); },
  startTrade(u, target) {
    const home = this.buildings.filter((b) => this.isTradeBuilding(b) && b.owner === u.owner).sort((a, b) => a.distTo(u) - b.distTo(u))[0];
    if (!home) return false;
    if (!target || target === home) target = this.buildings.filter((b) => this.isTradeBuilding(b) && b !== home && b.owner && u.owner.isFriend(b.owner)).sort((a, b) => b.distTo(home) - a.distTo(home))[0];
    if (!target) return false;
    u.task = { type: 'trade', from: home, to: target, user: true };
    const [x, z] = this.approachPoint(u, target); u.setPath(x, z);
    return true;
  },
  tradeUpdate(u, dt) {
    const t = u.task;
    if (!this.isTradeBuilding(t.to) || !this.isTradeBuilding(t.from)) { u.task = { type: 'idle' }; return; }
    if (u.edgeDist(t.to) > 3 && u.path.length) { const sp = u.steer(dt, u.speed); u.moveAnim(sp); return; }
    if (u.edgeDist(t.to) > 8) { const [x, z] = this.approachPoint(u, t.to); u.setPath(x, z); if (!u.path.length) u.task = { type: 'idle' }; return; }
    const D = Math.hypot(t.to.pos.x - t.from.pos.x, t.to.pos.z - t.from.pos.z);
    const win = Math.max(1, 5 * Math.pow(D / 50, 1.3219));
    const p = t.to.owner;
    for (const [r, k] of [['food', 1], ['wood', 1.5], ['stone', 2]]) p.deliver(r, win / k, this.time);
    this.emit('traded', { unit: u, amount: win, building: t.to });
    [t.from, t.to] = [t.to, t.from];
    const [x, z] = this.approachPoint(u, t.to); u.setPath(x, z);
  },
  // CWarehouse.Buy: up to 100 skulls -> resources (limited by free storage, counted in skulls)
  buyResource(p, res) {
    if (p.res.skulls <= 0) return 'skulls';
    if (p.res[res] >= p.caps[res]) return 'storage';
    const amount = Math.min(100, p.res.skulls, p.caps[res] - p.res[res]);
    p.res[res] += Math.round(amount / BUY_RATE[res]);
    p.res.skulls -= amount;
    return null;
  },
};
