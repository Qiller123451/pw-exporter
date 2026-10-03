// The standing army of the computer player (CAiGoalMinistryOfDefense: one unit request at a time, chosen by the
// tribe's unit mix per epoch and pyramid level), level-ups (CAiGoalKindergarten) and special moves in a fight
// (CAiTaskAttackObject). docs/spec/ai.md §4.6, §8.5. TribeAI methods; S = the census.
import * as DATA from './data.js';

const NOT_ARMY = /worker|resource_collector|_cart$|trade_dino|hovercraft|transport|tracker_dino|kennel|fishing_boat|scout$|smokebomb|drums$|siegetower/;
const RESERVED = [6, 5, 3, 1, 0];           // pyramid slots per level the standing army leaves free (MOD:129)
const COSTS = ['food', 'wood', 'stone', 'skulls'];

export const Army = {
  // A class of the tables the remake cannot field yet -> what the AI trains instead. The velociraptor handler's
  // raptors (CVelociraptorHandler / CKamikazeVelociraptor) are not in the game yet, and the handler alone is
  // harmless: the Aje train the spearman of their rodeo in his place. Remove when the raptors exist.
  fieldable(cls) {
    if (this.D.script(cls) !== 'CVelociraptorHandler') return cls;
    const alt = cls.replace('velociraptor_handler', 'spearman');
    return this.D.exists(alt) ? alt : cls;
  },
  // the unit mix of a tribe without a Units.txt: what its buildings can train in this epoch, grouped by the level a
  // unit starts at; units of the current epoch weigh double
  derivedMix(S) {
    const p = this.p, D = this.D, key = S.age + '|' + (p.tt ? p.tt.version : 0);
    if (this._mix && this._mixKey === key) return this._mix;
    const mix = {};
    for (const a of D.actions(p)) {
      if (a.kind !== 'Build' || a.cat === 'Build/BLDG' || !a.results[0]) continue;
      const cls = a.results[0].obj, def = D.def(cls, p), info = D.info(cls);
      if (!def || !info || info.type === 'SHIP' || def.unique || def.can_harvest || NOT_ARMY.test(cls)) continue;
      const ws = D.weaponSet(cls, D.minLevel(cls, p), p);
      if (!ws || !ws.long) continue;
      let ep = 1, ok = true;
      for (const r of a.req) { const m = /^age_(\d)$/.exec(r); if (m) ep = Math.max(ep, +m[1]); else if (!D.invented(p, r, a.tribe === 'Special' ? p.tribe : a.tribe)) ok = false; }
      if (!ok || ep > S.age) continue;
      const lv = Math.max(D.startLevel(a), D.minLevel(cls, p));
      (mix['Level_' + lv] = mix['Level_' + lv] || []).push({ weight: ep === S.age ? 2 : 1, units: [{ cls }] });
    }
    this._mix = mix; this._mixKey = key;
    return mix;
  },
  // may the army spend this now? Requests of the build list that wait for resources come first, except while the
  // army is a bare home guard (fewer than 3 + epoch fighters), during an alarm, and for a Dodo in its first epoch
  // (who lives off its raids). The next worker always comes first.
  armyCanPay(S, cost) {
    const p = this.p, R = this.reserve || {};
    const free = (this.alarm && !this.alarm.animal) || S.fighters.length < 3 + S.age || (this.personality === 'Dodo' && S.age <= 1) || this.economyOff;
    const wk = this.workerCost && !this.defendMode ? this.workerCost : null;
    for (const r of COSTS) { const c = cost[r] || 0; if (c > 0 && p.res[r] - c < Math.max(free ? 0 : R[r] || 0, wk ? wk[r] || 0 : 0)) return false; }
    return true;
  },
  // the action and a producer for a unit class -> { action, producer } | { action, why } | null
  trainable(S, cls) {
    const p = this.p, W = this.W;
    const R = this.resolve('CHTR/' + cls, '');
    if (!R || R.kind !== 'unit') return null;
    let why = 'none';
    for (const pr of this.producersOf(S, R.action).sort((a, b) => a.queue.length - b.queue.length)) {
      if (pr.queue.length >= 2) { why = 'busy'; continue; }
      const la = this.localAction(pr, R.action);
      const w = W.canQueue(p, la, pr);
      if (w === null) return { action: la, producer: pr };
      why = w;
      if (w === 'req') this.prerequisites(S, R.action, pr);
    }
    return { action: R.action, why };
  },

  // ------------------------------------------------------------------ MinistryOfDefense.Think (MOD:1048-1253)
  armyThink(S) {
    const p = this.p, W = this.W;
    if (this.prm.noDefence) return;
    // the unit just trained moves up to the level the mix wants it at, when skulls allow
    this.promote(S);
    const j = this.modJob;
    if (j) { if (j.producer.alive && j.producer.queue.includes(j.item) && W.time - j.t < 120) return; this.modJob = null; }
    const mix = DATA.unitMix(p.tribe, S.age) || this.derivedMix(S);
    const pyr = W.pyramidFor ? W.pyramidFor(p) : this.D.pyramid;
    const reserved = this.prm.highDefense ? [0, 0, 0, 0, 0] : RESERVED;
    const lords = new Set(S.heroes.filter((h) => h.level >= 5).map((h) => h.name));        // GetAvailableNPCs
    const free = (lv) => pyr[lv - 1] - p.atLevel[lv - 1] - p.queuedAtLevel[lv - 1] - reserved[lv - 1];
    this.unitNeed = null;
    let noPlace = null;
    for (let k = 0; k < 5; k++) {
      this.modLevel = ((this.modLevel === undefined ? -1 : this.modLevel) + 1) % 5;
      const lv = this.modLevel + 1;
      const groups = mix['Level_' + lv];
      if (!groups || !groups.length) continue;
      if (S.age === 1 && S.pool.reduce((n, u) => n + (u.level === lv ? 1 : 0), 0) >= 5) continue;      // MOD:1087
      // the group whose share of the pool is furthest below its weight
      const cand = [];
      let wSum = 0, nSum = 0;
      for (const g of groups) {
        let cls = null, flag = null, n = 0;
        for (const u of g.units) {
          const uc = this.fieldable(u.cls);
          n += S.pool.reduce((c, x) => c + (x.name === uc && x.level <= lv ? 1 : 0), 0);
          if (u.npc && !lords.has(u.npc)) continue;
          cls = uc; flag = u.objFlag || null;
        }
        if (!cls) continue;
        cand.push({ cls, flag, n, w: g.weight || 1 });
        wSum += g.weight || 1; nSum += n;
      }
      cand.sort((a, b) => (a.n / (nSum || 1) - a.w / wSum) - (b.n / (nSum || 1) - b.w / wSum));
      for (const c of cand) {
        const T = this.trainable(S, c.cls);
        if (T && !T.producer && T.why === 'none' && !noPlace) noPlace = T.action;
        if (!T || !T.producer) continue;
        const sl = W.unitStartLevel(T.action, p);
        if (free(sl) <= 0) continue;
        this.unitNeed = T.action.cost;
        if (!this.armyCanPay(S, T.action.cost)) return;                 // wait for the resources (the allocator)
        if (W.queueAction(T.producer, T.action) !== null) continue;
        this.modJob = { producer: T.producer, item: T.producer.queue[T.producer.queue.length - 1], t: W.time, cls: c.cls, level: lv, flag: c.flag };
        this.wantLevel = this.wantLevel || new Map();
        this.wantLevel.set(c.cls, Math.max(lv, this.wantLevel.get(c.cls) || 0));
        if (c.flag) { this.wantFlag = this.wantFlag || new Map(); this.wantFlag.set(c.cls, c.flag); }
        if (!T.producer.rally && S.home) { const g = this.guardPoint(S); T.producer.rally = [g.x, g.z]; }
        return;
      }
    }
    // nothing of the mix can be trained and a unit of it has no place to come from: that building is asked for
    // (the planner's solution for a unit includes the building it is made at)
    if (noPlace && !this.economyOff) {
      const at = noPlace.locs.map((l) => l.at).find((n) => this.D.info(n) && this.D.info(n).type === 'BLDG');
      if (at && !S.blds.some((b) => b.name === at)) this.addOnTop('BLDG/' + at);
    }
  },
  // RequestXtraUnits (FM:569-607): with resources to spare (more than 200 food, 200 wood and 100 stone that no
  // request waits for) one more unit is trained on every fight think - the best the village can make, wherever the
  // pyramid has room (the reserved slots of the standing army do not apply). Not for the SEAS, not at difficulty 0-1.
  xtraThink(S) {
    const p = this.p, W = this.W, R = this.reserve || {};
    if (p.tribe === 'SEAS' || this.d <= 1 || this.prm.noDefence || this.economyOff) return;
    if (p.res.stone - (R.stone || 0) <= 100 || p.res.wood - (R.wood || 0) <= 200 || p.res.food - (R.food || 0) <= 200) return;
    const mix = DATA.unitMix(p.tribe, S.age) || this.derivedMix(S);
    for (let lv = 5; lv >= 1; lv--) {
      const groups = (mix['Level_' + lv] || []).slice().sort(() => Math.random() - 0.5);
      for (const g of groups) {
        const u = g.units.filter((x) => !x.npc)[0];
        if (!u) continue;
        const T = this.trainable(S, this.fieldable(u.cls));
        if (!T || !T.producer || T.producer.queue.length) continue;
        const c = T.action.cost;
        if (['food', 'wood', 'stone', 'skulls'].some((r) => (c[r] || 0) > 0 && p.res[r] - c[r] < (R[r] || 0))) continue;
        if (W.queueAction(T.producer, T.action) === null) return;
      }
    }
  },
  // level a pool unit up to the level its mix row names, and give variants their upgrade (the ObjFlag)
  promote(S) {
    const p = this.p, W = this.W;
    if (this.wantFlag && this.wantFlag.size) {
      for (const u of S.pool) {
        const f = this.wantFlag.get(u.name);
        if (!f || u.aiFlag || u.queue.length) continue;
        const a = this.acts(u).find((x) => x.kind === 'Upgrades' && x.id === f);
        u.aiFlag = f;
        if (a && W.canQueue(p, a, u) === null && this.armyCanPay(S, a.cost)) W.queueAction(u, a);
      }
    }
    if (this.cls === 'Easy') return;
    const spare = p.res.skulls - ((this.reserve && this.reserve.skulls) || 0);
    if (spare < this.D.levelupSkulls[0]) return;
    let best = null;
    if (this.wantLevel) for (const u of S.pool) {
      const want = this.wantLevel.get(u.name);
      if (!want || u.level >= want || u.task.type === 'attack') continue;
      if (!best || u.level < best.level) best = u;
    }
    // a full pyramid row: one of its fighters moves up (inside the Kindergarten's ceilings) and makes room below
    if (!best) {
      const pyr = W.pyramidFor ? W.pyramidFor(p) : this.D.pyramid;
      for (let lv = 1; lv <= 4 && !best; lv++) {
        if (p.atLevel[lv - 1] + p.queuedAtLevel[lv - 1] < pyr[lv - 1] || p.atLevel[lv] + p.queuedAtLevel[lv] >= pyr[lv]) continue;
        best = S.pool.find((u) => u.level === lv && !u.def.unique && u.task.type !== 'attack' && W.canHaveLevel(u, lv + 1) && DATA.mayLevel(u.name, lv)) || null;
      }
    }
    if (best && W.skullCost(best.level, best.level + 1) <= spare) W.levelUp(best);
  },

  // ------------------------------------------------------------------ Kindergarten (KG:95-155): never on Easy
  // badly hurt fighters (30 % hit points or less) and heroes are levelled up - a level-up heals - within the
  // per-class ceilings, when the skulls are there
  kindergartenThink(S) {
    const p = this.p, W = this.W;
    if (this.cls === 'Easy' || !this.kindergarten) return;
    const skulls = p.res.skulls - ((this.reserve && this.reserve.skulls) || 0);
    if (skulls < this.D.levelupSkulls[0]) return;
    const kids = [...S.fighters].sort((a, b) => a.level - b.level);
    for (const u of kids) {
      if (u.level >= 5 || u.inside || this.locked.has(u)) continue;
      const t = u.task.type;
      if (t !== 'idle' && t !== 'attack' && t !== 'hold') continue;
      const hero = u.def.unique;
      if (!(u.hp / u.maxHp <= 0.3 || (hero && u.hp / u.maxHp < 0.6))) continue;
      if (W.skullCost(u.level, u.level + 1) > skulls) continue;
      if (!hero && !DATA.mayLevel(u.name, u.level)) continue;
      if (W.levelUp(u) === null) return;
    }
  },

  // ------------------------------------------------------------------ special moves (AO:337-560)
  // self-cast ones when the enemies around are worth it (summed hit points > 500 within 60 m), targeted ones on the
  // unit's current target
  movesThink(S) {
    const W = this.W;
    if (this.cls === 'Easy' && this.multimap) return;
    let n = 0;
    for (const u of S.fighters) {
      if (u.task.type !== 'attack' || !u.task.target || !u.task.target.alive || this.locked.has(u)) continue;
      if (++n > 40) break;
      const mv = W.movesOf(u);
      if (!mv.length) continue;
      for (const a of mv) {
        const M = W.MOVES && W.MOVES[a.id];
        if (!M || M.auto || M.noCooldown || W.moveCheck(u, a)) continue;
        if (M.self) {
          let hp = 0;
          W.uHash.query(u.pos.x, u.pos.z, 60, (e) => { if (e.alive && this.isEnemyEntity(e)) hp += e.hp; });
          if (hp > 500 && Math.random() < 0.5) W.useMove(u, a);
        } else if (M.target === 'enemy' || M.target === 'ground') W.useMove(u, a, u.task.target, u.task.target.pos);
        break;
      }
    }
  },
};
