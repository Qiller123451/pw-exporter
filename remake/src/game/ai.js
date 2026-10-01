// Computer opponent for any tribe: economy, construction, epochs, research, army, attack waves.
//
// The AI plays by the same rules as the player: it only uses actions the tech tree offers it, pays for everything
// and never sees more than it should. It is data driven - which building houses units, stores resources or trains
// soldiers is read from the tech tree - so it plays every tribe. The per-tribe PLANS below only give it a build
// order to follow; edit them to change its style.
//
// Difficulty ('easy' | 'normal' | 'hard') changes how fast it thinks, how big its army gets before attacking and
// when the first attack comes.

// build order per tribe: [building, minimum epoch, how many] (housing and storehouses are added when needed)
export const PLANS = {
  Hu: [['hu_lumberjack_cottage', 1, 1], ['hu_stone_quarry', 1, 1], ['hu_arena', 1, 1], ['hu_small_animal_farm', 1, 1],
    ['hu_corn_field', 2, 2], ['hu_small_tower', 2, 1], ['hu_weapons_smith', 2, 1], ['hu_warehouse', 2, 1], ['hu_temple', 3, 1],
    ['hu_machine_maker', 3, 1], ['hu_arena', 3, 2], ['hu_tavern', 3, 1], ['hu_corn_field', 3, 3], ['hu_large_tower', 4, 1]],
  Aje: [['aje_rodeo', 1, 1], ['aje_small_farm', 1, 1], ['aje_temple', 2, 1], ['aje_small_tower', 2, 1],
    ['aje_slaughterhouse', 3, 2], ['aje_weapons_builder', 3, 1], ['aje_rodeo', 3, 2], ['aje_bazaar', 3, 1], ['aje_cook_house', 3, 1],
    ['aje_medium_tower', 4, 1], ['aje_small_farm', 4, 2]],
  Ninigi: [['ninigi_lumbermill', 1, 1], ['ninigi_stone_quarry', 1, 1], ['ninigi_hunting_lodge', 1, 1], ['ninigi_dojo', 1, 1],
    ['ninigi_small_tower', 1, 1], ['ninigi_engineer', 2, 1], ['ninigi_animal_farm', 2, 1], ['ninigi_temple', 2, 1], ['ninigi_paddy', 2, 2],
    ['ninigi_weapon_maker', 3, 1], ['ninigi_warehouse', 3, 1], ['ninigi_teahouse', 3, 1], ['ninigi_dojo', 3, 2], ['ninigi_bamboofarm', 4, 1]],
  SEAS: [['seas_barracks', 1, 1], ['seas_steelwork', 1, 1], ['seas_garage', 1, 1], ['seas_greenhouse', 2, 2],
    ['seas_turret_tower', 2, 1], ['seas_barracks', 2, 2], ['seas_greenhouse', 3, 3], ['seas_garage', 3, 2]],
};
const DIFF = {
  easy: { think: 2.0, firstAttack: 900, wave: 5, waveGrow: 2, workers: 0.7 },
  normal: { think: 1.0, firstAttack: 600, wave: 7, waveGrow: 3, workers: 1 },
  hard: { think: 0.6, firstAttack: 420, wave: 9, waveGrow: 4, workers: 1.2 },
};
const RES = ['food', 'wood', 'stone'];

export class TribeAI {
  constructor(G, player, enemy, level = 'normal') {
    this.G = G; this.W = G.world; this.D = G.data;
    this.p = player; this.enemy = enemy;
    this.cfg = DIFF[level] || DIFF.normal;
    this.t = 0;
    this.waves = 0;
    this.nextAttack = this.cfg.firstAttack;
    this.attacking = false;
    this.home = null;
    this.plan = PLANS[player.tribe] || [];
  }
  // ------------------------------------------------------------------ helpers
  mine() {
    const W = this.W, p = this.p;
    const units = W.units.filter((u) => u.alive && u.owner === p && !u.autonomous);
    const blds = W.buildings.filter((b) => b.alive && b.owner === p);
    const base = blds.find((b) => b.def.script === 'CFireplace' && b.built) || units.find((u) => u.name === 'aje_resource_collector') || blds.find((b) => b.built) || units[0];
    return {
      units, blds, base,
      workers: units.filter((u) => u.isWorker && !u.naval),
      army: units.filter((u) => !u.isWorker && !u.cannotFight && !u.inside && !u.naval && !u.stationary),
      fleet: units.filter((u) => u.naval && !u.stationary),
    };
  }
  count(blds, name, builtOnly) { return blds.filter((b) => b.name === name && (!builtOnly || b.built)).length; }
  acts(e) { return this.D.actionsOf(e.rulesOwner(), e); }
  buildActions() {
    const w = this.W.units.find((u) => u.alive && u.owner === this.p && u.isWorker);
    return w ? this.acts(w).filter((a) => a.cat === 'Build/BLDG') : [];
  }
  saving(cost) {
    // hold resources back when an epoch upgrade is close
    if (!this.savingFor) return false;
    const s = this.savingFor.cost;
    for (const r of RES) if ((cost[r] || 0) > 0 && this.p.res[r] - cost[r] < s[r]) return true;
    return false;
  }
  enemyBase() {
    const e = this.enemy;
    const b = this.W.buildings.find((x) => x.alive && x.owner === e && x.def.script === 'CFireplace') || this.W.buildings.find((x) => x.alive && x.owner === e);
    if (b) return [b.pos.x, b.pos.z];
    const u = this.W.units.find((x) => x.alive && x.owner === e);
    return u ? [u.pos.x, u.pos.z] : [0, 0];
  }
  rallyPoint() {
    const [hx, hz] = this.home;
    const [ex, ez] = this.enemyBase();
    const a = Math.atan2(ez - hz, ex - hx);
    return [hx + Math.cos(a) * 32, hz + Math.sin(a) * 32];
  }

  // ------------------------------------------------------------------ main loop
  update(dt) {
    this.t += dt;
    if (this.t < this.cfg.think) return;
    this.t = 0;
    const p = this.p;
    if (p.defeated) return;
    const M = this.mine();
    if (!M.base) return;
    this.home = [M.base.pos.x, M.base.pos.z];
    this.research(M);
    this.economy(M);
    this.construction(M);
    if (this.W.waterNav) this.naval(M);
    this.military(M);
    this.levelUps(M);
    this.moves(M);
  }

  // ------------------------------------------------------------------ economy
  economy(M) {
    const p = this.p, W = this.W;
    const ep = p.epoch();
    const want = Math.round(Math.min(26, 8 + ep * 4) * this.cfg.workers);
    // workers from the base (fireplace / headquarters / resource collector)
    const wa = this.acts(M.base).find((a) => a.kind === 'Build' && a.results[0] && this.D.def(a.results[0].obj, p) && this.D.def(a.results[0].obj, p).can_harvest);
    const queued = M.base.queue ? M.base.queue.filter((q) => q.action === wa || (wa && q.action.id === wa.id)).length : 0;
    if (wa && M.workers.length + queued < want && M.base.queue.length < 2) W.queueAction(M.base, wa);
    // food: when bushes near the base are gone, hunt animals (workers then take the carcasses) or buy food with skulls
    if (p.res.food < 150 && !W.nearestResource(this.home[0], this.home[1], 'food', 90)) {
      this.huntForSkulls(M, true);
      const market = M.blds.find((b) => b.built && this.acts(b).some((a) => a.id === 'buy_food' && this.D.check(b.rulesOwner(), a, b) === null));
      if (market && p.res.skulls >= 100 + (this.savingFor ? this.savingFor.cost.skulls || 0 : 0)) W.useMove(market, this.acts(market).find((a) => a.id === 'buy_food'));
    }
    // pull a worker off a resource whose storage is full
    this.rebT = (this.rebT || 0) + 1;
    if (this.rebT >= 8) {
      this.rebT = 0;
      for (const r of RES) {
        if (p.res[r] < p.caps[r] - 30) continue;
        const w = M.workers.find((x) => x.task.type === 'gather' && x.task.res === r && !(x.carry && x.carry.amount > 0));
        if (w) { W.releaseTask(w); w.task = { type: 'idle' }; }
      }
    }
    // distribute idle workers by a target ratio
    const cnt = { food: 0, wood: 0, stone: 0 };
    for (const w of M.workers) if (w.task.type === 'gather') cnt[w.task.res]++;
    const ratio = ep === 1 ? { food: 0.45, wood: 0.35, stone: 0.2 } : { food: 0.4, wood: 0.32, stone: 0.28 };
    for (const w of M.workers) {
      if (w.task.type !== 'idle') continue;
      let best = 'food', bd = -1e9;
      const n = M.workers.length;
      for (const r of RES) {
        const d = ratio[r] * n - cnt[r] - (p.res[r] >= p.caps[r] - 20 ? 99 : 0);
        if (d > bd) { bd = d; best = r; }
      }
      if (!this.assign(w, best, M)) for (const r of RES) if (r !== best && p.res[r] < p.caps[r] - 30 && this.assign(w, r, M)) { best = r; break; }
      cnt[best]++;
    }
  }
  assign(w, res, M) {
    const W = this.W;
    const [hx, hz] = this.home;
    if (res === 'food') {
      // fields / slaughterhouses first (they never run out), then bushes and carcasses
      const farm = M.blds.find((b) => b.built && W.isFarm(b) && b.def.unlimited.includes('food') && b.workers.size < W.farmSlots(b));
      if (farm) { W.order([w], { type: 'gather', target: farm, auto: true }); return true; }
    }
    if (res === 'wood') {
      const farm = M.blds.find((b) => b.built && W.isFarm(b) && b.def.unlimited.includes('wood') && b.workers.size < W.farmSlots(b));
      if (farm) { W.order([w], { type: 'gather', target: farm, auto: true }); return true; }
    }
    const n = W.nearestResource(hx, hz, res, 90) || W.nearestResource(w.pos.x, w.pos.z, res, 170);
    if (n) { W.order([w], { type: 'gather', target: n, auto: true }); return true; }
    return false;
  }

  // ------------------------------------------------------------------ water (original maps with a coast)
  // a harbour near fish shoals close to the base, up to three fishing boats, idle boats back to fishing
  naval(M) {
    const p = this.p, W = this.W, [hx, hz] = this.home;
    const fishF = Object.assign(() => true, { water: true });
    const shoal = W.nearestResource(hx, hz, 'food', 220, null, fishF);
    if (!shoal) return;
    const harbours = M.blds.filter((b) => b.def.coastal && !/rally_point/.test(b.name));
    if (!harbours.length) {
      if (M.workers.length < 8 || M.blds.some((b) => !b.built)) return;
      const a = this.buildActions().find((x) => this.D.def(x.results[0].obj, p)?.coastal && !/rally_point/.test(x.id) && this.D.check(p, x) === null);
      if (!a || !p.canAfford(a.cost) || this.saving(a.cost)) return;
      // the coast between the base and the shoal
      for (let k = 0; k <= 10; k++) {
        const f = k / 10, x = hx + (shoal.pos.x - hx) * f, z = hz + (shoal.pos.z - hz) * f;
        if (!W.isWater(x, z, 1.5)) continue;
        const at = W.placement(a.results[0].obj, x, z, 0, p);
        if (!at.ok) continue;
        const ws = [this.pickWorker(M, { x: at.x, z: at.z }, [])].filter(Boolean);
        if (ws.length) W.startConstruction(p, a, at.x, at.z, at.rot, ws);
        return;
      }
      return;
    }
    const hb = harbours.find((b) => b.built);
    if (!hb) return;
    const boats = M.fleet.filter((u) => /fishing_boat/.test(u.name));
    const fa = this.acts(hb).find((a) => a.kind === 'Build' && /fishing_boat/.test(a.id));
    const queued = hb.queue.filter((q) => fa && q.action.id === fa.id).length;
    if (fa && boats.length + queued < 3 && !hb.queue.length && p.canAfford(fa.cost) && !this.saving(fa.cost)) W.queueAction(hb, fa);
    for (const b of boats) if (b.task.type === 'idle') { const n = W.nearestResource(b.pos.x, b.pos.z, 'food', 400, null, fishF); if (n) W.startFishing(b, n); }
  }

  // ------------------------------------------------------------------ buildings
  construction(M) {
    const p = this.p, W = this.W;
    const acts = this.buildActions();
    const act = (id) => acts.find((a) => a.id === id || (a.results[0] && a.results[0].obj === id && a.id === id));
    const pending = M.blds.filter((b) => !b.built);
    const ep = p.epoch();
    // keep builders on unfinished buildings
    for (const b of pending) {
      const active = [...b.builders].filter((u) => u.alive && u.task.type === 'build' && u.task.building === b);
      if (active.length < 2) { const w = this.pickWorker(M, b.pos, active); if (w) W.order([w], { type: 'build', target: b, auto: true }); }
    }
    // repair damaged buildings when nothing threatens them
    if (!this.threat) for (const b of M.blds) if (b.built && b.hp < b.maxHp * 0.6 && !b.builders.size) { const w = this.pickWorker(M, b.pos, []); if (w) W.order([w], { type: 'repair', target: b, auto: true }); break; }
    const want = [];
    // housing: the cheapest building that raises the population limit
    const room = p.maxUnits - p.units - p.queuedUnits;
    if (room < 4 && p.maxUnits < p.popMax && !pending.some((b) => b.stats.limits.max_units > 0)) {
      const houses = acts.filter((a) => { const o = a.results[0] && a.results[0].obj; const s = o && this.D.stats(o, 1, p); return s && s.limits.max_units > 0 && this.D.check(p, a) === null; });
      houses.sort((a, b) => (a.cost.wood + a.cost.stone) - (b.cost.wood + b.cost.stone));
      if (houses[0]) want.push(houses[0].id);
    }
    // storage: raise the cap before the next epoch upgrade needs more than it
    const age = this.nextAge(M);
    if (age && RES.some((r) => (age.cost[r] || 0) > p.caps[r]) && !pending.length) {
      const st = acts.filter((a) => { const o = a.results[0] && a.results[0].obj; const s = o && this.D.stats(o, 1, p); return s && (s.limits.max_food + s.limits.max_wood + s.limits.max_stone) > 900 && this.D.check(p, a) === null; });
      if (st[0] && this.count(M.blds, st[0].results[0].obj) < 2) want.push(st[0].id);
    }
    if (pending.length < 2) {
      const counts = {};
      for (const [id, e, n] of this.plan) {
        if (ep < e) continue;
        counts[id] = Math.max(counts[id] || 0, n);
      }
      for (const id in counts) if (this.count(M.blds, id) < counts[id]) want.push(id);
    }
    for (const id of want) {
      const a = act(id);
      if (!a || this.D.check(p, a) || !p.canAfford(a.cost)) continue;
      if (want.indexOf(id) > 0 && this.saving(a.cost)) continue;     // housing (first) is never delayed
      const name = a.results[0].obj;
      const spot = this.findSpot(name, a, M);
      if (!spot) continue;
      const ws = [];
      for (let i = 0; i < 3; i++) { const w = this.pickWorker(M, { x: spot[0], z: spot[1] }, ws); if (w) ws.push(w); }
      if (!ws.length) continue;
      const r = W.startConstruction(p, a, spot[0], spot[1], spot[2], ws);
      if (typeof r !== 'string') break;
    }
  }
  pickWorker(M, pos, exclude = []) {
    let best = null, bd = 1e9;
    for (const w of M.workers) {
      if (exclude.includes(w) || w.task.type === 'build' || (w.carry && w.carry.amount > 0) || w.task.type === 'attack') continue;
      const d = Math.hypot(w.pos.x - pos.x, w.pos.z - pos.z) + (w.task.type === 'idle' ? -30 : 0);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
  // storehouses go next to their resource, towers towards the enemy, the rest around the base
  findSpot(name, a, M) {
    const W = this.W;
    let [hx, hz] = this.home;
    const e = this.enemyBase();
    const toE = Math.atan2(e[1] - hz, e[0] - hx);
    const def = this.D.def(name, this.p);
    const forward = !!(def && (def.script || '').match(/Tower|Bunker/));
    const deliv = def && def.delivery.length && def.delivery.length < 3 ? def.delivery : null;
    if (deliv) {
      const n = W.nearestResource(hx, hz, deliv.includes('wood') ? 'wood' : deliv.includes('stone') ? 'stone' : 'food', 90);
      if (n) { hx = (hx + n.pos.x * 2) / 3; hz = (hz + n.pos.z * 2) / 3; }
    }
    for (let k = 0; k < 90; k++) {
      const r = (deliv ? 6 : 18) + (k / 90) * 45 + Math.random() * 6;
      const ang = forward ? toE + (Math.random() - 0.5) * 1.4 : deliv ? Math.random() * 6.283 : toE + Math.PI * (0.35 + Math.random() * 1.3) * (Math.random() < 0.5 ? 1 : -1);
      const x = Math.round(hx + Math.cos(ang) * r), z = Math.round(hz + Math.sin(ang) * r);
      const rot = Math.round((toE + Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2);
      // placement() = where it really goes (wall-grid snapping for towers / traps, coastal snapping)
      const at = W.placement(name, x, z, rot, this.p);
      if (at.ok && !at.replace && !at.existing) return [at.x, at.z, at.rot];
    }
    return null;
  }

  // ------------------------------------------------------------------ research
  nextAge(M) {
    const ep = this.p.epoch();
    return ep < 5 ? this.acts(M.base).find((a) => a.id === 'age_' + (ep + 1)) || null : null;
  }
  research(M) {
    const p = this.p, W = this.W, base = M.base;
    this.savingFor = null;
    const ep = p.epoch();
    const age = this.nextAge(M);
    const minWorkers = Math.min([0, 10, 14, 17, 19][ep] * this.cfg.workers, Math.max(6, p.maxUnits - M.army.length - 2));
    const minArmy = [0, 3, 6, 9, 12][ep];
    const fits = age && RES.every((r) => (age.cost[r] || 0) <= p.caps[r]);
    const rich = age && RES.every((r) => p.res[r] >= (age.cost[r] || 0) * 1.5);
    if (age && fits && !base.queue.some((q) => /^age_/.test(q.action.id)) && (rich || (M.workers.length >= minWorkers && M.army.length >= minArmy)) && W.time > ep * 180) {
      if (W.canQueue(p, age, base) === null) W.queueAction(base, age);
      else if (this.D.check(p, age, base) === null) this.savingFor = age;
    }
    // epochs that cost skulls (Aje): hunt wild animals for them
    if (age && (age.cost.skulls || 0) > p.res.skulls && !this.attacking) this.huntForSkulls(M);
    // Aje: more resource collectors = more storage and population
    if (p.tribe === 'Aje' && ep >= 2) {
      const cols = M.units.filter((u) => u.name === 'aje_resource_collector').length;
      if (cols < 2 || (!fits && cols < 4)) {
        const farm = M.blds.find((b) => b.name === 'aje_small_farm' && b.built && !b.queue.length);
        const a = farm && this.acts(farm).find((x) => x.results[0] && x.results[0].obj === 'aje_resource_collector');
        if (a && W.canQueue(p, a, farm) === null) W.queueAction(farm, a);
      }
    }
    // cheap upgrades at idle buildings: tools, capacities, weapons (never while saving for an epoch)
    if (this.savingFor) return;
    for (const b of [...M.blds.filter((x) => x.built), ...M.units.filter((u) => u.queue)]) {
      if (b.queue.length) continue;
      const ups = this.acts(b).filter((a) => a.kind === 'Upgrades' && !/^age_/.test(a.id) && W.canQueue(p, a, b) === null);
      // local farm modes: an Aje farm picks the medium/huge mode to unlock its animals
      const mode = ups.find((a) => /aje_(medium|huge)_farm/.test(a.id));
      const pick = mode || ups.find((a) => (a.cost.skulls || 0) === 0 && a.id !== 'Explode' && (a.cost.food + a.cost.wood + a.cost.stone) < 600 && M.workers.length > 10);
      if (pick && Math.random() < 0.35) { W.queueAction(b, pick); break; }
    }
  }

  // ------------------------------------------------------------------ army
  military(M) {
    const p = this.p, W = this.W;
    const workersLow = M.workers.length < 6;
    // production at every building that trains fighters
    for (const b of M.blds) {
      if (!b.built || b.queue.length >= 2) continue;
      const opts = this.acts(b).filter((a) => a.kind === 'Build' && a.cat !== 'Build/BLDG' && a.results[0] && W.canQueue(p, a, b) === null && !this.saving(a.cost))
        .filter((a) => { const d = this.D.def(a.results[0].obj, p); return d && !d.can_harvest && d.type !== 'SHIP' && !/resource_collector|_cart$|trade_dino/.test(a.results[0].obj) && !(d.unique && Math.random() < 0.8); });
      if (!opts.length || (workersLow && M.army.length >= 4)) continue;
      opts.sort((x, y) => this.D.startLevel(y) - this.D.startLevel(x));
      const pick = Math.random() < 0.6 ? opts[0] : opts[Math.floor(Math.random() * opts.length)];
      W.queueAction(b, pick);
      if (!b.rally) b.rally = this.rallyPoint();
    }
    const [hx, hz] = this.home;
    // defend: enemies near the base
    let threat = null;
    for (const u of W.units) {
      if (!u.alive || u.owner !== this.enemy || u.inside) continue;
      if (Math.hypot(u.pos.x - hx, u.pos.z - hz) < 65) { threat = u; break; }
    }
    if (!threat) for (const b of M.blds) if (b.lastAttacker && b.lastAttacker.alive && b.lastAttacker.owner === this.enemy && W.time - b.lastHit < 5) { threat = b.lastAttacker; break; }
    this.threat = threat;
    const idleArmy = M.army.filter((u) => u.task.type === 'idle' || u.task.type === 'hold');
    if (threat) {
      const def = this.attacking ? M.army.filter((u) => Math.hypot(u.pos.x - hx, u.pos.z - hz) < 90) : M.army;
      for (const u of def) if (u.task.type !== 'attack') W.order([u], { type: 'attackmove', x: threat.pos.x, z: threat.pos.z, auto: true });
      return;
    }
    // attack waves
    const size = this.cfg.wave + this.waves * this.cfg.waveGrow;
    if (!this.attacking && W.time > this.nextAttack && M.army.length >= Math.min(size, 24)) {
      this.attacking = true;
      this.waves++;
      this.G.onAiAttack && this.G.onAiAttack();
      const [ex, ez] = this.enemyBase();
      const force = [...M.army].sort((a, b) => b.maxHp * b.level - a.maxHp * a.level).slice(0, size + 4);
      W.order(force, { type: 'attackmove', x: ex, z: ez, auto: true });
      return;
    }
    if (this.attacking) {
      const away = M.army.filter((u) => Math.hypot(u.pos.x - hx, u.pos.z - hz) > 80);
      if (away.length < 3) {
        this.attacking = false;
        this.nextAttack = W.time + 150 + Math.random() * 90;
        const [rx, rz] = this.rallyPoint();
        W.order(away, { type: 'move', x: rx, z: rz, auto: true });
      } else {
        const [ex, ez] = this.enemyBase();
        for (const u of away) if (u.task.type === 'idle') W.order([u], { type: 'attackmove', x: ex, z: ez, auto: true });
      }
    } else {
      const [rx, rz] = this.rallyPoint();
      for (const u of idleArmy) if (Math.hypot(u.pos.x - rx, u.pos.z - rz) > 20) W.order([u], { type: 'move', x: rx + (Math.random() - 0.5) * 12, z: rz + (Math.random() - 0.5) * 12, auto: true });
    }
  }
  // send a few idle fighters after the nearest wild animal (skulls for epochs / levels)
  huntForSkulls(M, food) {
    const W = this.W;
    if (W.time - (this.huntT || -99) < (food ? 30 : 20)) return;
    this.huntT = W.time;
    const [hx, hz] = this.home;
    let prey = null, bd = 160;
    for (const u of W.units) {
      if (!u.alive || !u.wild) continue;
      const d = Math.hypot(u.pos.x - hx, u.pos.z - hz) + (u.def.aggressive > 0 ? 40 : 0) + u.maxHp * 0.02 - (food ? this.D.corpseFood(u.name) * 0.02 : 0);
      if (d < bd) { bd = d; prey = u; }
    }
    if (!prey) return;
    const hunters = M.army.filter((u) => u.task.type === 'idle' || u.task.type === 'move').slice(0, 5);
    if (hunters.length >= 2) W.order(hunters, { type: 'attack', target: prey, auto: true });
  }
  levelUps(M) {
    const p = this.p;
    if (p.res.skulls < this.D.levelupSkulls[0] + (this.savingFor ? this.savingFor.cost.skulls || 0 : 0)) return;
    const cands = M.army.filter((u) => u.level < 5).sort((a, b) => b.level - a.level || b.maxHp - a.maxHp);
    for (const u of cands) if (this.W.levelUp(u) === null) return;
  }
  // special moves: self-cast ones when enemies are close (AiTaskAttackObject: summed enemy hit points > 500 within 60 m)
  moves(M) {
    const W = this.W;
    for (const u of M.army) {
      if (u.task.type !== 'attack' || !u.task.target) continue;
      for (const a of W.movesOf(u)) {
        if (W.moveCheck(u, a)) continue;
        const M2 = W.MOVES && W.MOVES[a.id];
        if (!M2 || M2.auto || M2.noCooldown) continue;
        if (M2.self) { if (Math.random() < 0.3) W.useMove(u, a); }
        else if (M2.target === 'enemy' || M2.target === 'ground') W.useMove(u, a, u.task.target, u.task.target.pos);
        break;
      }
    }
  }
}
