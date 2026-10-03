// Economy module of the computer player: the build list (CAiGoalBuildVillage), realising its requests (the engine's
// planner, replaced by one step of prerequisite resolution and a running resource reserve), workers
// (CAiModuleEconomyDefault), gathering (CAiGoalCollectResources), housing, storage, repair, hunting and fishing.
// docs/spec/ai.md §4. All functions are TribeAI methods (brain.js); S = the census.
import * as DATA from './data.js';
import { LocalTree } from '../techtree.js';

const RES = ['food', 'wood', 'stone'];
const COSTS = ['food', 'wood', 'stone', 'skulls'];
// list entries that name objects the tech tree calls differently
const ALIAS = { hu_large_animal_farm: 'hu_big_animal_farm' };
const HOUSING = /stone_cottage|_fireplace|_tent|headquarters|resource_collector/;      // BV:1166: still built at the unit limit
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pos2 = (e) => ({ x: e.pos.x, z: e.pos.z });
// distance of a point from the segment a-b
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

export const Economy = {
  // ------------------------------------------------------------------ requests -> actions
  // "BLDG/hu_arena" | "CHTR/Cole_s0" | "age_2" | "hu_stone_cottage" (a partial name, GetNodeInstanceFromPartialName)
  // -> { kind: 'bldg' | 'unit' | 'upgrade', action, cls, flag: the upgrade an ObjFlag names } | null
  resolve(name, objFlag) {
    const p = this.p, D = this.D, v = p.tt ? p.tt.version : 0;
    if (!this._res || this._resV !== v) { this._res = new Map(); this._resV = v; }
    const key = name + '|' + (objFlag || '');
    if (this._res.has(key)) return this._res.get(key);
    const acts = D.actions(p);
    const typ = name.includes('/') ? name.split('/')[0] : null;
    let tail = name.split('/').pop();
    const obj = (x) => x.kind === 'Build' && x.results[0] ? x.results[0].obj : null;
    const find = (t) => (typ && acts.find((x) => obj(x) === t)) || acts.find((x) => x.kind !== 'Moves' && x.id === t) || acts.find((x) => obj(x) === t)
      || (!typ && acts.find((x) => obj(x) && obj(x).endsWith(t))) || null;
    let a = find(tail);
    if (!a && ALIAS[tail]) a = find(tail = ALIAS[tail]);
    let out = null;
    if (a) {
      const cls = obj(a);
      const flag = objFlag && objFlag !== cls ? acts.find((x) => x.kind === 'Upgrades' && x.id === objFlag) || null : null;
      out = { kind: a.kind === 'Upgrades' ? 'upgrade' : a.cat === 'Build/BLDG' ? 'bldg' : 'unit', action: a, cls, flag };
    }
    this._res.set(key, out);
    return out;
  },
  // own entities that offer an action right now
  producersOf(S, a) {
    const at = new Set(a.locs.map((l) => l.at));
    const out = [];
    for (const b of S.blds) if (b.built && !b.dismantling && at.has(b.name)) out.push(b);
    for (const u of S.units) if (u.queue && (at.has(u.name) || (at.has(u.cls) && u.isWorker)) && !u.inside) out.push(u);
    return out.filter((e) => this.acts(e).some((x) => x.path === a.path));
  },
  // the action as an entity offers it: a building with a mode of its own (local tree) sees other values
  localAction(e, a) { return this.acts(e).find((x) => x.path === a.path) || a; },
  // does a building carry the upgrade an ObjFlag names (Aje farm modes, the big tent)?
  hasFlag(e, f) {
    if (!f) return true;
    if (e.aiFlag === f.id || (e.queue && e.queue.some((q) => q.action.id === f.id))) return true;
    const local = f.results.filter((r) => r.cls === 'local');
    if (!local.length) return this.p.techs.has(f.id);
    return !!e.localTT && local.every((r) => e.localTT.has((r.path || '').replace(/^\/?Filters\//, '')));
  },
  // how many more of a list entry are wanted (0 = satisfied)
  missing(S, e, R) {
    const p = this.p, W = this.W, a = R.action;
    if (R.kind === 'upgrade') return p.techs.has(a.id) || W.anyQueued(p, a.id) ? 0 : 1;
    if (!e.unique) return e.done ? 0 : 1;
    let have = 0;
    if (R.kind === 'bldg') {
      // with an ObjFlag only the buildings that carry it count (and the ones still being built)
      for (const b of S.blds) if (b.name === R.cls && (!b.built || this.hasFlag(b, R.flag))) have++;
    } else {
      have = S.count.get(R.cls) || 0;
      for (const x of [...S.blds, ...S.units]) if (x.queue) for (const q of x.queue) if (q.action.path === a.path) have++;
    }
    return Math.max(0, e.count - have);
  },
  canPay(cost, avail) { return this.p.debug || COSTS.every((r) => (cost[r] || 0) <= 0 || (avail[r] || 0) >= cost[r]); },
  spend(cost, avail) { for (const r of COSTS) avail[r] = (avail[r] || 0) - (cost[r] || 0); },

  // ------------------------------------------------------------------ the build list (BV:417-1232)
  buildThink(S) {
    this.buildN = (this.buildN || 0) + 1;
    if (this.buildList && this.buildN % 6 !== 0 && this.requests.length) return;     // BV:1210: every 6th think
    this.updateBuildList(S);
  },
  atUnitLimit(S) {
    const p = this.p;
    const cap = p.popMax + (p.aiMods ? p.aiMods.unitLimit || 0 : 0);
    return p.units + p.queuedUnits >= p.maxUnits && p.maxUnits < cap;
  },
  updateBuildList(S) {
    const ctx = this.ctx();
    let list = [];
    // CheckNumFightingUnits (BV:432, 1388): from the third epoch nothing is built with fewer than ten characters,
    // animals and vehicles that are not workers (carts and collectors count)
    const hold = this.multimap && S.age >= 3 && S.units.length - S.workers.length - S.fleet.length < 10;
    this.unitLimit = this.atUnitLimit(S);
    if (!hold || !DATA.hasAiData()) {
      list = DATA.buildList(ctx).filter((e) => !(/^age_(\d)$/.test(e.request) && +e.request.slice(4) > (this.prm.maxAge || 5)));
      // heroes: every 5th update, from epoch 3, not on Easy (UpdateSpecialBuildList)
      if (this.multimap && this.kindergarten && this.cls !== 'Easy' && S.age >= 3) {
        this.heroN = (this.heroN || 0) + 1;
        if (this.heroN >= 5 || !this.heroSet) { this.heroN = 0; this.heroSet = 1 + Math.floor(Math.random() * 3); }
        for (const h of DATA.heroRequests(this.heroSet)) if (!S.heroes.some((u) => u.name === h.request.split('/').pop())) list.push(h);
      }
      // one more warship whenever an enemy has more (CheckForEnemyShips), on water maps
      if (this.multimap && ctx.watermap) {
        const war = (u) => u.alive && u.naval && !u.cannotFight && !u.stationary;
        const mine = S.fleet.filter(war).length;
        let most = 0;
        for (const o of this.enemies()) most = Math.max(most, this.W.units.filter((u) => u.owner === o && war(u)).length);
        if (mine < most) for (const r of DATA.counterShips(ctx)) list.push({ ...r, count: mine + 1 });
      }
    }
    // resolvable, unsatisfied entries in script order
    const out = [];
    for (const e of list) {
      const R = this.resolve(e.request, e.objFlag);
      if (!R) continue;
      if (R.kind === 'unit' && this.D.info(R.cls) && this.D.info(R.cls).type === 'SHIP' && !this.W.waterNav) continue;
      if (R.kind === 'bldg' && this.D.def(R.cls, this.p) && this.D.def(R.cls, this.p).coastal && !this.W.waterNav) continue;
      if (R.kind === 'bldg' && this.D.script(R.cls) === 'CWarpGate' && !(this.W.rules && this.W.rules.warpgate)) continue;
      out.push({ ...e, R, failed: 0 });
    }
    this.buildList = out;
    this.pickRequests(S);
  },
  // the first five unsatisfied entries are in realisation (RequestNext(5)); failed ones wait for the next list
  pickRequests(S) {
    const keep = (this.extra || []).filter((e) => this.missing(S, e, e.R) > 0 && this.W.time - e.t < 180);
    this.extra = keep;
    const out = [];
    for (const e of this.buildList || []) {
      if (out.length >= 5) break;
      if (e.failed > 2 || this.missing(S, e, e.R) <= 0) continue;
      out.push(e);
    }
    this.requests = out;
  },
  // a request on top of the list: housing, storage, prerequisites
  addOnTop(request, objFlag = '', opts = {}) {
    const R = this.resolve(request, objFlag);
    if (!R) return false;
    this.extra = this.extra || [];
    if (this.extra.some((e) => e.R.action.path === R.action.path)) return true;
    if (this.extra.length >= 4) return false;
    this.extra.push({ request, objFlag, count: opts.count || 1, unique: opts.unique !== false, R, failed: 0, t: this.W.time, done: false });
    return true;
  },

  // ------------------------------------------------------------------ realising (EM:523-652)
  economyThink(S) {
    const p = this.p, W = this.W;
    const avail = { ...p.res };
    const reserve = { food: 0, wood: 0, stone: 0, skulls: 0 };
    this.keepBuilders(S);
    this.workerThink(S, avail);
    this.housingThink(S);
    this.pickRequests(S);
    const pending = S.blds.filter((b) => !b.built).length;
    let started = 0;
    const all = [...(this.extra || []), ...this.requests];
    for (const e of all) {
      const R = e.R;
      // at the unit limit only housing and research go on (BV:1165)
      if (this.unitLimit && !(R.kind === 'upgrade' || e.housing || HOUSING.test(R.cls || ''))) continue;
      const why = this.realise(S, e, avail, pending + started);
      if (why === 'started') { started++; if (!e.unique) e.done = true; this.spend(R.action.cost, avail); continue; }
      if (why === 'cost') {
        // the planner locks the resources of a request it cannot pay yet: later requests and the army leave them.
        // A request that waits for skulls (a hero, an Aje epoch) locks only those: skulls come from fighting, and
        // food that nobody may touch until then would stop the army that is to earn them.
        const c = (e.flagNow || R.action).cost;
        const skulls = (c.skulls || 0) > p.res.skulls;
        reserve.skulls += c.skulls || 0;
        if (!skulls) for (const r of RES) { const need = Math.max(0, (c[r] || 0)); reserve[r] += need; avail[r] = Math.max(0, (avail[r] || 0) - need); }
        this.storageThink(S, c);
      } else if (why === 'fail') e.failed++;
      e.flagNow = null;
    }
    this.reserve = reserve;
    this.repairThink(S);
    if (W.waterNav) this.fishingThink(S);
    this.foodThink(S);
    this.skullThink(S);
  },
  // -> 'started' | 'cost' | 'wait' | 'fail'
  realise(S, e, avail, building) {
    const p = this.p, W = this.W, D = this.D, R = e.R, a = R.action;
    if (R.kind === 'bldg') {
      // an ObjFlag on an existing building: research its mode (Aje farm modes, the big tent)
      if (R.flag) {
        // a building of the class without a mode of its own yet takes this one (a mode replaces the other modes)
        const free = S.blds.filter((x) => x.name === R.cls && !x.aiFlag && !this.hasFlag(x, R.flag));
        const b = free.find((x) => x.built && !x.queue.length);
        if (b) {
          const why = W.canQueue(p, R.flag, b);
          if (why === null && this.canPay(R.flag.cost, avail)) { W.queueAction(b, R.flag); b.aiFlag = R.flag.id; this.spend(R.flag.cost, avail); return 'wait'; }
          if (why === null || why === 'cost') { e.flagNow = R.flag; return 'cost'; }
          if (why === 'done') { b.aiFlag = R.flag.id; return 'wait'; }
          return 'wait';
        }
        if (free.length) return 'wait';
      }
      if (S.blds.some((x) => x.name === R.cls && !x.built)) return 'wait';       // one of a kind at a time
      if (building >= 3) return 'wait';
      const why = D.check(p, a);
      if (why) return this.prerequisites(S, a, null) ? 'wait' : 'fail';
      if (!this.canPay(a.cost, avail)) return 'cost';
      const spot = this.findSpot(S, R.cls, a, e.pos);
      if (!spot) return 'fail';
      const ws = [];
      const n = S.workers.length >= 9 ? 3 : S.workers.length >= 5 ? 2 : 1;
      for (let i = 0; i < n; i++) { const w = this.pickWorker(S, { x: spot[0], z: spot[1] }, ws); if (w) ws.push(w); }
      if (!ws.length) return 'wait';
      const b = W.startConstruction(p, a, spot[0], spot[1], spot[2], ws);
      if (typeof b === 'string') return b === 'cost' ? 'cost' : 'fail';
      S.blds.push(b);
      return 'started';
    }
    const prods = this.producersOf(S, a);
    if (!prods.length) {
      // nobody offers it yet: wait for the building it is made at, or ask for that building (one step of the planner)
      if (S.blds.some((x) => !x.built && a.locs.some((l) => l.at === x.name))) return 'wait';
      const at = a.locs.map((l) => l.at).find((n) => D.info(n) && D.info(n).type === 'BLDG');
      return at && this.addOnTop('BLDG/' + at) ? 'wait' : 'fail';
    }
    let cost = false, req = null;
    for (const pr of prods.sort((x, y) => x.queue.length - y.queue.length)) {
      if (pr.queue.length >= (R.kind === 'unit' ? 2 : 1)) continue;
      const la = this.localAction(pr, a);
      const why = W.canQueue(p, la, pr);
      if (why === null) {
        if (!this.canPay(la.cost, avail)) { cost = true; continue; }
        if (W.queueAction(pr, la) === null) return 'started';
      } else if (why === 'cost') cost = true;
      else if (why === 'req') req = pr;
      else if (why === 'done' || why === 'unique') return 'wait';
      else if (why === 'housing' || why === 'level') return 'wait';
    }
    if (cost) return 'cost';
    if (req) return this.prerequisites(S, a, req) ? 'wait' : 'fail';
    return 'wait';
  },
  // what an action still needs: research it / build it first. -> false when nothing can be done about it
  prerequisites(S, a, producer) {
    const p = this.p, D = this.D;
    const owner = producer && producer.rulesOwner ? producer.rulesOwner() : p;
    let any = false;
    // not offered in the building's present mode (a plain Aje farm offers no animal): choose the mode that offers it
    if (producer && producer.kind === 'building' && /hidden|disabled/.test(D.check(owner, this.localAction(producer, a), producer) || '')) {
      const m = this.modeFor(producer, a);
      if (!m) return false;
      if (producer.aiFlag && producer.aiFlag !== m.id) {
        // this one has another mode: another building of the class takes it, or one more is built for it
        const S2 = this.S || S;
        const other = S2.blds.find((x) => x.name === producer.name && (!x.aiFlag || x.aiFlag === m.id) && x !== producer);
        if (other) return other.built && !other.aiFlag ? this.prerequisites(S, a, other) : true;
        return S2.blds.filter((x) => x.name === producer.name).length < 4 && this.addOnTop('BLDG/' + producer.name, '', { unique: false });
      }
      if (producer.queue.length) return true;
      const why = this.W.canQueue(p, m, producer);
      if (why === null) { this.W.queueAction(producer, m); producer.aiFlag = m.id; return true; }
      return why === 'cost';
    }
    for (const m of D.missing(owner, a, producer)) {
      if (/^age_\d$/.test(m)) { any = true; continue; }                 // the epoch comes from the list
      if (/_s\d$/.test(m)) continue;                                   // a hero at level 5: nothing to request
      if (producer) {
        // a mode of the producing building itself (Aje farm: small / medium / huge)
        const lo = this.acts(producer).find((x) => x.kind === 'Upgrades' && x.id === m);
        if (lo && lo.results.some((r) => r.cls === 'local')) {
          if (producer.aiFlag && producer.aiFlag !== m) continue;        // it has another mode: the list brings more farms
          if (producer.queue.length) { any = true; continue; }
          const why = this.W.canQueue(p, lo, producer);
          if (why === null) { this.W.queueAction(producer, lo); producer.aiFlag = m; any = true; continue; }
          if (why === 'cost') { any = true; continue; }
          continue;
        }
      }
      if (D.info(m) && D.info(m).type === 'BLDG') { if (this.addOnTop('BLDG/' + m)) any = true; continue; }
      if (this.resolve(m, '') && this.addOnTop(m)) any = true;
    }
    return any;
  },

  // the local upgrade ("mode") of a building class that makes it offer an action: tried on a copy of the player's
  // tree, once per class and action
  modeFor(b, a) {
    const p = this.p, D = this.D;
    // (which mode offers an action does not change during a game: a hit is kept for good; a miss is tried again
    // when the tree has changed, at most every 30 s - trying costs a copy of the tree per mode)
    const key = b.name + '|' + a.path, v = p.tt ? p.tt.version : 0;
    this._modes = this._modes || new Map();
    const c = this._modes.get(key);
    if (c && (c.hit || c.v === v || this.W.time - c.t < 30)) return c.hit;
    let hit = null;
    for (const m of this.acts(b)) {
      if (m.kind !== 'Upgrades' || !m.results.some((r) => r.cls === 'local' && r.type !== 'deactivate')) continue;
      const T = new LocalTree(p.tt);
      for (const r of m.results) if (r.cls === 'local' && r.type !== 'deactivate') T.enable((r.path || '').replace(/^\/?Filters\//, ''));
      const a2 = D.actions({ tt: T, tribe: p.tribe }).find((x) => x.path === a.path);
      if (a2 && a2.visible && !a2.disabled) { hit = m; break; }
    }
    this._modes.set(key, { hit, v, t: this.W.time });
    return hit;
  },
  // skulls a waiting request needs (the Aje pay for epochs with them): a few fighters hunt wild animals (the fight
  // module's "skulls" attack, CAiTaskGetScalps)
  skullThink(S) {
    const p = this.p, W = this.W;
    // not only the request that waits for resources: every request in realisation (the Aje's second epoch costs
    // skulls, and the village has none until somebody hunts)
    let need = (this.reserve && this.reserve.skulls) || 0;
    for (const e of this.requests) need = Math.max(need, e.R.action.cost.skulls || 0);
    if (need <= p.res.skulls || W.time - (this.skullT || -99) < 12) return;
    this.skullT = W.time;
    // a squad, not single hunters (GetScalps: the army modifier is 3 before epoch 3, FM:412); the nearest harmless
    // herd first (the task looks through its "friendly animal" map before the others)
    const prey = this.prey(S, 220, S.age < 3 ? 400 : 1000, true);
    if (!prey.length) return;
    const n = Math.max(S.age < 3 ? 3 : 2, this.hunters(prey[0]));
    this.hunt(S, 'skulls', prey.slice(0, prey[0].def.aggressive < 0 ? 3 : 4), n, n + 2);
  },

  // ------------------------------------------------------------------ workers (EM:626-651, DMo:118)
  workerThink(S, avail) {
    const p = this.p, W = this.W, D = this.D;
    this.workerCost = null;
    if (this.defendMode) return;
    const cap = DATA.maxWorkers(this.cls, S.age);
    const isWorker = (a) => a.kind === 'Build' && a.results[0] && D.def(a.results[0].obj, p) && D.def(a.results[0].obj, p).can_harvest && !/SHIP/.test(a.cat);
    let base = S.base && S.base.queue ? S.base : null;
    let wa = base ? this.acts(base).find(isWorker) : null;
    if (!wa) {
      // the main building is gone: any other place that trains workers, else that building is asked for first
      const any = D.actions(p).find(isWorker);
      if (!any) return;
      base = this.producersOf(S, any)[0] || null;
      if (!base) {
        // (the Aje's workers come from their collector animal, which a small farm makes)
        const at = any.locs.map((l) => l.at).find((n) => D.info(n) && this.resolve(n, ''));
        if (at && !S.blds.some((b) => b.name === at)) this.addOnTop((D.info(at).type === 'BLDG' ? 'BLDG/' : '') + at);
        return;
      }
      wa = this.localAction(base, any);
    }
    let queued = 0;
    for (const q of base.queue) if (q.action.path === wa.path) queued++;
    // the army leaves this much for the next worker while the village has fewer than the epoch allows
    if (S.workers.length + queued < cap) this.workerCost = wa.cost;
    // one more whenever every worker is busy (AllWorkersLocked), up to the cap of the epoch
    if (S.workers.length + queued >= cap || queued >= 1 || S.idle.length > 1) return;
    if (W.canQueue(p, wa, base) === null && this.canPay(wa.cost, avail)) { W.queueAction(base, wa); this.spend(wa.cost, avail); }
  },
  // the cheapest building that raises the population limit, on top of the list (CheckForUnitLimit, BV:1424)
  housingThink(S) {
    const p = this.p, D = this.D;
    this.unitLimit = this.atUnitLimit(S);
    const room = p.maxUnits - p.units - p.queuedUnits;
    const cap = p.popMax + (p.aiMods ? p.aiMods.unitLimit || 0 : 0);
    if (room >= 2 || p.maxUnits >= cap) return;
    if (S.blds.some((b) => !b.built && b.stats.limits.max_units > 0)) return;
    if ((this.extra || []).some((e) => e.housing)) return;
    const mark = () => { const e = this.extra[this.extra.length - 1]; if (e) e.housing = true; };
    for (const h of DATA.housing(p.tribe)) {
      const R = this.resolve(h.request, h.objFlag);
      if (!R || R.kind !== 'bldg' || D.check(p, R.action)) continue;
      if (this.addOnTop(h.request, '', { unique: false })) { mark(); return; }
    }
    const worker = S.workers[0];
    if (!worker) return;
    const houses = this.acts(worker).filter((a) => { if (a.cat !== 'Build/BLDG') return false; const s = D.stats(a.results[0].obj, 1, p); return s && s.limits.max_units > 0 && D.check(p, a) === null; });
    houses.sort((a, b) => (a.cost.wood + a.cost.stone + a.cost.food) - (b.cost.wood + b.cost.stone + b.cost.food));
    if (houses[0] && this.addOnTop('BLDG/' + houses[0].results[0].obj, '', { unique: false })) mark();
  },
  // a request that costs more than the storage holds: more storage first (RequestMoreResourceBuilding, BV:1455)
  storageThink(S, cost) {
    const p = this.p, D = this.D;
    const r = RES.find((x) => (cost[x] || 0) > p.caps[x]);
    if (!r || S.blds.some((b) => !b.built && b.stats.limits['max_' + r] > 0)) return;
    const key = 'max_' + r;
    let best = null, bc = 1e9;
    for (const a of D.actions(p)) {
      if (a.kind !== 'Build' || !a.results[0] || D.check(p, a) === 'req') continue;
      const s = D.stats(a.results[0].obj, 1, p);
      if (!s || !(s.limits[key] > 0)) continue;
      const c = a.cost.food + a.cost.wood + a.cost.stone + (a.cost.skulls || 0) * 3;
      if (RES.some((x) => (a.cost[x] || 0) > p.caps[x])) continue;
      if (c < bc) { bc = c; best = a; }
    }
    if (best) this.addOnTop((best.cat === 'Build/BLDG' ? 'BLDG/' : 'ANML/') + best.results[0].obj, '', { unique: false });
  },

  // ------------------------------------------------------------------ builders, repair
  pickWorker(S, pos, exclude = []) {
    let best = null, bd = 1e9;
    for (const w of S.workers) {
      if (exclude.includes(w) || w.inside || w.task.type === 'build' || w.task.type === 'attack' || w.task.type === 'entrench' || w.task.type === 'board') continue;
      const d = Math.hypot(w.pos.x - pos.x, w.pos.z - pos.z) + (w.task.type === 'idle' ? -30 : 0) + (w.carry && w.carry.amount > 0 ? 25 : 0);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  },
  keepBuilders(S) {
    const W = this.W;
    for (const b of S.blds) {
      if (b.built) continue;
      const active = [...b.builders].filter((u) => u.alive && u.task.type === 'build' && u.task.building === b);
      if (active.length < (S.workers.length >= 8 ? 2 : 1)) { const w = this.pickWorker(S, b.pos, active); if (w) W.order([w], { type: 'build', target: b, auto: true }); }
    }
  },
  repairThink(S) {
    if (this.alarm) return;
    const W = this.W;
    for (const b of S.blds) {
      if (!b.built || b.hp >= b.maxHp * 0.6 || b.builders.size || W.time - (b.lastHit || -99) < 10) continue;
      const w = this.pickWorker(S, b.pos, []);
      if (w) W.order([w], { type: 'repair', target: b, auto: true });
      break;
    }
  },

  // ------------------------------------------------------------------ gathering (CR:408-453)
  collectThink(S) {
    const p = this.p, W = this.W;
    if (this.prm.noCollect) return;
    const cnt = { food: 0, wood: 0, stone: 0 };
    for (const w of S.workers) {
      if (w.task.type !== 'gather') continue;
      cnt[w.task.res] = (cnt[w.task.res] || 0) + 1;
      // waiting at a full storehouse: back to the idle workers
      if (w.task.fullT > 2) { cnt[w.task.res]--; W.releaseTask(w); w.task = { type: 'idle' }; w.path = []; S.idle.push(w); }
    }
    // what the pending requests and the next unit need (the planner's resource needs)
    const need = { food: 60, wood: 40, stone: 30 };
    const R = this.reserve || {};
    for (const r of RES) need[r] += (R[r] || 0) + (this.unitNeed ? this.unitNeed[r] || 0 : 0);
    for (const e of this.requests) for (const r of RES) need[r] += (e.R.action.cost[r] || 0) * 0.5;
    if (!S.idle.length) return this.rebalance(S, cnt, need);
    for (const w of S.idle) {
      if (w.inside || this.locked.has(w)) continue;
      // idle workers take what is short; equal needs in the script's order stone, wood, food
      let best = null, bs = -1;
      for (const r of ['stone', 'wood', 'food']) {
        if (p.res[r] >= p.caps[r] - 20) continue;
        const short = Math.max(0, need[r] - p.res[r]);
        const s = (1 + short / 40) / (cnt[r] + 1);
        if (s > bs + 1e-9) { bs = s; best = r; }
      }
      if (!best) continue;
      const order = [best, ...['stone', 'wood', 'food'].filter((r) => r !== best && p.res[r] < p.caps[r] - 20)];
      for (const r of order) { if (this.assign(S, w, r)) { cnt[r]++; break; } if (r === 'food' && r === best) this.moreFarms(S); }
    }
  },
  // The original's workers come back to the idle list whenever their tree, rock or bush is used up, and are then
  // sent to what is short (CR:408). The remake's workers go on to the next tree by themselves, so the brain moves
  // one over (every few seconds) when a resource is short while another has more gatherers than its share.
  rebalance(S, cnt, need) {
    const p = this.p, now = this.W.time;
    if (now - (this.swapT || -9) < 3) return;
    this.noSrc = this.noSrc || {};
    const w8 = {};
    let sum = 0, n = 0;
    for (const r of RES) {
      const dead = p.res[r] >= p.caps[r] - 20 || now - (this.noSrc[r] || -99) < 20;
      w8[r] = dead ? 0 : 1 + Math.min(7, Math.max(0, need[r] - p.res[r]) / 100);
      sum += w8[r]; n += cnt[r] || 0;
    }
    if (!sum || n < 2) return;
    let to = null, from = null, lack = 0.99, over = 0.49;
    for (const r of RES) {
      const want = n * w8[r] / sum, d = want - (cnt[r] || 0);
      if (d > lack) { lack = d; to = r; }
      if (-d > over && cnt[r] > 0) { over = -d; from = r; }
    }
    if (!to || !from) return;
    let best = null;
    for (const w of S.workers) if (w.task.type === 'gather' && w.task.res === from && !this.locked.has(w) && (!best || (w.carry ? w.carry.amount : 0) < (best.carry ? best.carry.amount : 0))) best = w;
    if (!best) return;
    this.swapT = now;
    if (!this.assign(S, best, to)) { this.noSrc[to] = now; if (to === 'food') this.moreFarms(S); }
  },
  assign(S, w, res) {
    const W = this.W, h = S.home;
    // fields / slaughterhouses first (they never run out), then the nearest node
    if (res === 'food' || res === 'wood') {
      const farm = S.blds.find((b) => b.built && W.isFarm(b) && b.def.unlimited.includes(res) && b.workers.size < W.farmSlots(b));
      if (farm) { W.order([w], { type: 'gather', target: farm, auto: true }); return true; }
    }
    const ok = (n) => this.regionValue(res === 'wood' ? 'WOOD' : res === 'stone' ? 'STON' : 'FOOD', n.pos.x, n.pos.z) >= 0 && !this.dangerAt(n.pos.x, n.pos.z);
    // food: the carcass of the animal the hunters just killed, wherever it lies
    const kill = res === 'food' && this.foodPrey && !this.foodPrey.alive ? this.foodPrey.corpseNode : null;
    const n = W.nearestResource(h.x, h.z, res, 90, null, ok) || (kill && kill.alive && kill.amount > 0 && kill.workers.size < kill.maxWorkers && ok(kill) ? kill : null)
      || W.nearestResource(w.pos.x, w.pos.z, res, 170, null, ok);
    if (!n) return false;
    W.order([w], { type: 'gather', target: n, auto: true });
    // a new stone site gets a tower (CR:365-393)
    if (res === 'stone' && (!this.stoneSite || d2(this.stoneSite, pos2(n)) > 40)) { this.stoneSite = pos2(n); if (d2(pos2(n), h) > 45) this.towerAt = pos2(n); }
    return true;
  },
  // enemy fighters near a spot (CheckForEnemy, UM:615): workers are not sent there
  dangerAt(x, z) {
    let hit = false;
    this.W.uHash.query(x, z, 30, (u) => { if (!hit && u.alive && u.owner && u.owner !== this.p && this.p.isEnemy(u.owner) && !u.isWorker && Math.hypot(u.pos.x - x, u.pos.z - z) < 30) hit = true; });
    return hit;
  },
  // Wild animals worth hunting from the village, best first: like the scripts' search (ComputeBestAreaInBestAiMap:
  // rings around the start location; peaceful herds before neutral animals before hunters), the nearest first inside
  // a kind. Never next to a big predator or to enemy fighters (CheckForEnemy).
  prey(S, range, maxHp = 1e9, skulls = false) {
    const W = this.W, h = S.home, out = [];
    const beasts = [];
    for (const u of W.units) if (u.alive && u.wild && !u.naval && u.def.aggressive > 0 && u.maxHp >= 1500) beasts.push(u);
    for (const u of W.units) {
      if (!u.alive || !u.wild || u.naval || u.maxHp > maxHp) continue;
      const d = Math.hypot(u.pos.x - h.x, u.pos.z - h.z);
      if (d > range || this.regionValue('FOOD', u.pos.x, u.pos.z) < 0) continue;
      if (beasts.some((x) => segDist(x.pos.x, x.pos.z, h.x, h.z, u.pos.x, u.pos.z) < 60) || this.dangerAt(u.pos.x, u.pos.z)) continue;     // on the hunters' way
      const kind = u.def.aggressive < 0 ? 0 : u.def.aggressive > 0 ? 2 : 1;
      const v = kind * 120 + d + u.maxHp * 0.03 - (skulls ? Math.min(40, (u.stats.scalps || 0) * 2) : Math.min(60, this.D.corpseFood(u.name) * 0.05));
      out.push([v, u]);
    }
    return out.sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  },
  // Nothing left to eat around the village, or every place at its fields is taken while food is what it lacks: one
  // more field / greenhouse / slaughterhouse on top of the list, up to eight places. (Not in the scripts: the lists
  // name one to three such buildings and the villages live on the gifts and on hunting beyond that.)
  moreFarms(S) {
    const p = this.p, D = this.D, W = this.W;
    const farms = S.blds.filter((b) => W.isFarm(b) && b.def.unlimited.includes('food'));
    if (farms.some((b) => !b.built) || farms.reduce((n, b) => n + W.farmSlots(b), 0) >= 8) return false;
    const a = D.actions(p).filter((x) => x.cat === 'Build/BLDG' && x.results[0] && (D.def(x.results[0].obj, p).unlimited || []).includes('food') && D.check(p, x) === null)
      .sort((x, y) => (x.cost.food + x.cost.wood + x.cost.stone) - (y.cost.food + y.cost.wood + y.cost.stone))[0];
    return !!a && this.addOnTop('BLDG/' + a.results[0].obj, '', { unique: false });
  },
  // how many hunters an animal takes: a peaceful one runs, the others fight back (and call their herd)
  hunters(u) { return u.def.aggressive < 0 ? (u.maxHp > 300 ? 2 : 1) : Math.max(2, Math.min(6, Math.ceil(u.maxHp / 150))); },
  // SpawnResources("food", 10) of the cheat manager: what the scripts fall back to when there is nothing to eat
  cheatFood() {
    const p = this.p, n = this.multimap ? (this.cls === 'Easy' ? 5 : this.cls === 'Medium' ? 20 : 10) : 20;
    p.res.food = Math.max(p.res.food, Math.min(p.caps.food, p.res.food + n));
  },
  // No food left around the village (CAiTaskPickAnimalFood): the workers hunt a harmless animal nearby themselves
  // (the task's own game command on the animal); otherwise the fight module is asked for a "quick" attack on the
  // nearest animals and the workers take the carcass. With nothing to hunt, and on campaign maps, the cheat manager
  // gives a little food instead. The market sells food for skulls.
  foodThink(S) {
    const p = this.p, W = this.W, h = S.home;
    if (W.time - (this.huntT || -99) < 12) return;
    // a village that cannot even pay a worker any more is helped whatever lies around it (not in the scripts, where
    // such a village is simply dead: without it the easy levels, which get no gifts, can lock up for good)
    if (S.workers.length < 3 && this.workerCost && p.res.food < (this.workerCost.food || 0)) { this.huntT = W.time; this.cheatFood(); return; }
    if (p.res.food >= 250) return;
    const corpse = this.foodPrey && !this.foodPrey.alive ? this.foodPrey.corpseNode : null;
    if (corpse && corpse.alive && corpse.amount > 0) return;                                           // still eating
    if (S.blds.some((b) => W.isFarm(b) && b.def.unlimited.includes('food'))) return;
    if (W.nearestResource(h.x, h.z, 'food', 90, null, (n) => !this.dangerAt(n.pos.x, n.pos.z))) return;
    this.huntT = W.time;
    this.moreFarms(S);
    if (this.alarm && !this.alarm.animal) { this.cheatFood(); return; }             // nobody leaves the village now
    const market = S.blds.find((b) => b.built && this.acts(b).some((a) => a.id === 'buy_food' && this.D.check(b.rulesOwner(), a, b) === null));
    if (market && p.res.skulls >= 100 + ((this.reserve && this.reserve.skulls) || 0)) { W.useMove(market, this.acts(market).find((a) => a.id === 'buy_food')); return; }
    if (this.attacks.some((x) => x.type === 'food') || (this.foodPrey && this.foodPrey.alive && W.time - (this.workerHuntT || -99) < 45)) return;     // hunters are out
    // the last hunt brought nothing (the hunters died, the animal got away): the cheat manager's food
    if (this.foodPrey && (this.foodPrey.alive || !corpse)) this.cheatFood();
    const prey = this.multimap ? this.prey(S, 170, S.age < 3 ? 700 : 3000) : [];
    this.foodPrey = prey[0] || null;
    if (!prey.length) { this.cheatFood(); return; }
    const a = prey[0];
    // the workers themselves, when the animal is harmless and close
    const near = Math.hypot(a.pos.x - h.x, a.pos.z - h.z) < 120;
    if (near && !this.alarm && a.maxHp < 300 && !(a.def.aggressive > 0)) {
      const w = S.workers.filter((x) => !x.inside && x.task.type !== 'build' && !(this.militiaSet && this.militiaSet.has(x)))
        .sort((x, y) => (x.task.type === 'idle' ? 0 : 1) - (y.task.type === 'idle' ? 0 : 1) || Math.hypot(x.pos.x - a.pos.x, x.pos.z - a.pos.z) - Math.hypot(y.pos.x - a.pos.x, y.pos.z - a.pos.z)).slice(0, 3);
      if (w.length >= 2) { W.order(w, { type: 'attack', target: a }); this.workerHuntT = W.time; return; }
    }
    const n = this.hunters(a);
    if (!this.hunt(S, 'food', prey.slice(0, 1), n, n + 2)) this.cheatFood();
  },
  // idle fishing boats back to the nearest shoal
  fishingThink(S) {
    const W = this.W;
    const fish = Object.assign(() => true, { water: true });
    for (const b of S.fleet) if (/fishing_boat/.test(b.name) && b.task.type === 'idle') { const n = W.nearestResource(b.pos.x, b.pos.z, 'food', 400, null, fish); if (n) W.startFishing(b, n); }
  },

  // ------------------------------------------------------------------ placement
  // storehouses next to their resource, towers where the defence wants them (else towards the enemy), harbours on
  // the coast near the fish, the rest around the base; never inside a region the map forbids (BuildModifier < 0)
  findSpot(S, name, a, at) {
    const W = this.W, p = this.p;
    let hx = S.home.x, hz = S.home.z;
    const e = this.enemyHint(S);
    const toE = Math.atan2(e.z - hz, e.x - hx);
    const def = this.D.def(name, p);
    const tower = !!(def && (def.script || '').match(/Tower|Bunker/));
    const deliv = def && def.delivery.length && def.delivery.length < 3 ? def.delivery : null;
    if (def && def.coastal) {
      const fish = Object.assign(() => true, { water: true });
      const shoal = W.nearestResource(hx, hz, 'food', 260, null, fish);
      const tx = shoal ? shoal.pos.x : e.x, tz = shoal ? shoal.pos.z : e.z;
      for (let k = 0; k <= 14; k++) {
        const f = k / 14, x = hx + (tx - hx) * f, z = hz + (tz - hz) * f;
        if (!W.isWater(x, z, 1.5)) continue;
        const pl = W.placement(name, x, z, 0, p);
        if (pl.ok) return [pl.x, pl.z, pl.rot];
      }
      return null;
    }
    let near = null;
    if (at) near = at;
    else if (tower && this.towerAt) { near = this.towerAt; }
    if (deliv && !near) {
      const n = W.nearestResource(hx, hz, deliv.includes('wood') ? 'wood' : deliv.includes('stone') ? 'stone' : 'food', 90);
      if (n) { hx = (hx + n.pos.x * 2) / 3; hz = (hz + n.pos.z * 2) / 3; }
    }
    if (near) { hx = near.x; hz = near.z; }
    for (let k = 0; k < 90; k++) {
      const r = (deliv || near ? 6 : 18) + (k / 90) * 45 + Math.random() * 6;
      const ang = near ? Math.random() * 6.283 : tower ? toE + (Math.random() - 0.5) * 1.4 : deliv ? Math.random() * 6.283 : toE + Math.PI * (0.35 + Math.random() * 1.3) * (Math.random() < 0.5 ? 1 : -1);
      const x = Math.round(hx + Math.cos(ang) * r), z = Math.round(hz + Math.sin(ang) * r);
      if (this.regions.size && this.regionValue('BuildModifier', x, z) < 0) continue;
      const rot = Math.round((toE + Math.PI / 2) / (Math.PI / 2)) * (Math.PI / 2);
      // placement() = where it really goes (wall-grid snapping for towers / traps)
      const pl = W.placement(name, x, z, rot, p);
      if (pl.ok && !pl.replace && !pl.existing) { if (tower && near === this.towerAt) this.towerAt = null; return [pl.x, pl.z, pl.rot]; }
    }
    return null;
  },
  // roughly where the enemy is (for facing buildings and the guard point): the nearest enemy village
  enemyHint(S) {
    const now = this.W.time;
    if (this._hint && now - this._hintT < 10) return this._hint;
    let best = null, bd = 1e9;
    for (const o of this.enemies()) { const b = this.baseOf(o); if (!b) continue; const d = d2(b, S.home); if (d < bd) { bd = d; best = b; } }
    this._hint = best || { x: 0, z: 0 }; this._hintT = now;
    return this._hint;
  },
};
