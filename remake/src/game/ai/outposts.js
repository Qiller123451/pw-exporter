// Outposts of the computer player: secondary bases with a crew and buildings of their own (goals/AiGoalBuildOutpost,
// AiGoalIslandSurveillance, AiGoalBuildArmy's attack outpost; Modules/AiModuleEconomy StartOutpost;
// docs/spec/ai_group6.md §2).
//
//   * startOutpost(pos, type): at most 5 per game - a start that fails counts too (EM:378, kept) - not in
//     "Single 06"; an enemy within 60 m of the place makes it ask for an attack there instead (CheckForEnemy).
//   * The crew: RessourceOutpost, AttackOutpost and OP_ResAll get the army of their name (settings tables; Hu and
//     Ninigi, which have none: 2 workers and 1-2 of their first infantry) for free, once (CheatMgr, BO:234-249);
//     EmptyOutpost (the trade outpost) takes 1-3 of the village's workers. Then 1-2 units of the pool join, and they
//     go there. The crew belongs to the outpost: its workers build there and gather within 60 m of it.
//   * The buildings: one request at a time, the first row of the type's list (ai.json outposts) the outpost lacks
//     (BuildIfNotExist per outpost: buildings within 60 m of it count).
//   * Fewer than 2 objects or no worker left: it starts again (the crew is not given a second time).
//   * On skirmish maps, when the trade route is ready or the village defends, the fighters of the outposts go home
//     (CheckNumUnitsInOutpost, BO:670-703).
//   * Island surveillance (every ~100 s; skirmish, epoch 2+, not a Turtle, not "Single 09"): the neutral stone
//     nearest the start location without own objects within 60 m gets an OP_ResAll outpost - one on the home island
//     (others need the transfer by ship: not done) - when nothing foreign is within 60 m, or 1-9 foreign objects of
//     which the first is an enemy's (then a suicide attack is asked for them too, IS:157-231).
//   * The attack outpost (BA:128-140): on skirmish maps from epoch 2, once, 45 % of the way to the enemy on the home
//     island [?engine GetPossibleAtkOutpostPosition]; every 10th think it wants its 3 rows (arena, farm, 2 towers).
//   * Campaign triggers start RessourceOutpost / AttackOutpost at their position (FM:918-921).
import * as DATA from './data.js';

const rnd = (n) => Math.floor(Math.random() * n);
const MAX_OUTPOSTS = 5, R_OUT = 60;
const SPAWNED = new Set(['RessourceOutpost', 'AttackOutpost', 'OP_ResAll']);
// BA:96-110: what an attack outpost wants besides its list
const ATK_EXTRA = {
  Hu: [['BLDG/hu_arena', '', 1], ['BLDG/hu_small_animal_farm', '', 1], ['BLDG/hu_large_tower', '', 2]],
  Aje: [['BLDG/aje_rodeo', '', 1], ['BLDG/aje_small_farm', 'medium_farm', 1], ['BLDG/aje_medium_tower', '', 2]],
  Ninigi: [['BLDG/ninigi_engineer', '', 1], ['BLDG/ninigi_animal_farm', '', 1], ['BLDG/ninigi_small_tower', '', 2]],
};

export const OutpostsAI = {
  outpostCrew() { return this.crew || (this.crew = new Map()); },          // unit -> outpost
  // EM.StartOutpost -> the outpost's id | null
  startOutpost(pos, type) {
    const W = this.W;
    if (this.levelName === 'Single 06') return null;
    this.outposts = this.outposts || [];
    if ((this.outpostStarts || 0) >= MAX_OUTPOSTS) return null;
    this.outpostStarts = (this.outpostStarts || 0) + 1;
    const foes = this.wallFoes(pos.x, pos.z, R_OUT);
    if (foes.length) {
      const S = this.S || this.census();
      const blds = foes.filter((e) => e.kind === 'building').length;
      this.requestAttack(S, blds * 2 > foes.length ? 'siege' : 'suicide', foes[0].owner || null, foes);
      return null;
    }
    const o = { id: (this.outposts.length ? Math.max(...this.outposts.map((x) => x.id)) : 0) + 1, type, pos: { x: pos.x, z: pos.z }, island: W.landIsland(pos.x, pos.z), state: 'building', spawned: false, t: W.time, n: 0 };
    this.outposts.push(o);
    return o.id;
  },
  outpostOf(e) {
    for (const o of this.outposts || []) if (Math.hypot(e.pos.x - o.pos.x, e.pos.z - o.pos.z) <= R_OUT) return o;
    return null;
  },
  outpostUnits(o) { const out = []; for (const [u, x] of this.outpostCrew()) if (x === o) { if (u.alive && u.owner === this.p) out.push(u); else this.crew.delete(u); } return out; },
  joinOutpost(o, units) { for (const u of units) { this.outpostCrew().set(u, o); this.claims.delete(u); } this.S = null; },
  leaveOutpost(units) { for (const u of units) this.outpostCrew().delete(u); this.S = null; },
  // the crew's workers for a building request of the outpost (economy.js realise)
  outpostWorkers(o) { return this.outpostUnits(o).filter((u) => u.isWorker && !u.inside); },
  outpostsThink(S) {
    const W = this.W, p = this.p;
    if (this.multimap && S.age >= 2) {
      if (this.gameType !== 'Defender' && this.gameType !== 'KingOfTheHill') this.islandSurveillance(S);   // (AM:64-66, IS:276)
      this.attackOutpostThink(S);
    }
    for (const o of this.outposts || []) {
      o.n++;
      const units = this.outpostUnits(o);
      // the fighters of the outposts on the home island go home (BO:188-197)
      if (this.multimap && (this.tradeReady || this.defending) && o.island === W.landIsland(S.home.x, S.home.z)) {
        const back = units.filter((u) => !u.isWorker && !/_cart$|trade_dino/.test(u.name));
        if (back.length) { this.leaveOutpost(back); this.sendHome(back); }
        if (this.defending) continue;
      }
      if (this.defending) continue;
      const foes = this.wallFoes(o.pos.x, o.pos.z, R_OUT);
      if (foes.length) { const blds = foes.filter((e) => e.kind === 'building').length; this.requestAttack(S, blds * 2 > foes.length ? 'siege' : 'suicide', foes[0].owner || null, foes); continue; }
      switch (o.state) {
        case 'building': {
          if (SPAWNED.has(o.type) && !o.spawned) {
            o.spawned = true;
            const army = DATA.army(p.tribe, this.cfg.valueTable || 'Dodo', o.type) || this.outpostFallback(S);
            const made = army ? this.spawnArmy(S, army, o.pos, true, o.type) : [];
            this.joinOutpost(o, made);
          } else if (!o.spawned) {
            o.spawned = true;
            const ws = [];
            for (let i = 0, n = 1 + rnd(3); i < n; i++) { const w = this.pickWorker(S, o.pos, ws); if (w && S.workers.length - ws.length > 3) ws.push(w); }
            this.joinOutpost(o, ws);
          }
          o.state = 'waiting';
          break;
        }
        case 'waiting': {
          const extra = this.queryPool(S, 1, 2, null, true) || [];
          this.joinOutpost(o, extra.slice(0, 1 + rnd(2)));
          const all = this.outpostUnits(o);
          if (o.island !== W.landIsland(S.home.x, S.home.z)) { o.state = 'supervising'; break; }   // (the transfer by ship: not done)
          for (const u of all) W.order([u], { type: u.isWorker ? 'move' : 'attackmove', x: o.pos.x + (Math.random() - 0.5) * 12, z: o.pos.z + (Math.random() - 0.5) * 12, auto: true });
          o.state = 'supervising';
          break;
        }
        case 'supervising': {
          const objs = W.buildings.filter((b) => b.alive && b.owner === p && Math.hypot(b.pos.x - o.pos.x, b.pos.z - o.pos.z) <= R_OUT);
          const ws = units.filter((u) => u.isWorker);
          if ((objs.length + units.length < 2 || !ws.length) && W.time - o.t > 120) { o.state = 'building'; break; }
          this.outpostRequestNext(S, o, objs);
          this.outpostWork(S, o, ws, objs);
          break;
        }
      }
    }
  },
  // Hu and Ninigi have no settings tables (the installation holds Aje's and SEAS's): 2 workers and 1-2 of the
  // tribe's first infantry at level 2, like Aje's rows (worker 1-2, spearman level 2 1-2)
  outpostFallback(S) {
    const t = this.p.tribe, D = this.D;
    const worker = { Hu: 'hu_worker', Aje: 'aje_worker', Ninigi: 'ninigi_worker', SEAS: 'seas_worker' }[t];
    const foot = { Hu: 'hu_warrior', Aje: 'aje_spearman', Ninigi: 'ninigi_warrior', SEAS: 'seas_warrior' }[t];
    const out = [{ min: 2, max: 2, alternatives: [{ cls: worker }] }];
    if (foot && D.exists(foot)) out.push({ min: 1, max: 2, alternatives: [{ cls: foot, level: 1 }] });
    return out;
  },
  // RequestNext: the first row the outpost lacks, one request at a time
  outpostRequestNext(S, o, objs) {
    if ((this.extra || []).some((e) => e.outpost === o && this.missing(S, e, e.R) > 0)) return;
    const rows = (DATA.outpost(o.type, this.p.tribe) || []).map((r) => [r.request, r.objFlag || '', r.count || 1]);
    if (o.type === 'AttackOutpost' && o.n % 10 === 0) rows.push(...(ATK_EXTRA[this.p.tribe] || []));
    for (const [request, flag, count] of rows) {
      const R = this.resolve(request, flag);
      if (!R || R.kind !== 'bldg') continue;
      const have = objs.filter((b) => b.name === R.cls).length;
      if (have >= count) continue;
      this.addOnTop(request, flag, { count, pos: o.pos, outpost: o });
      return;
    }
  },
  // the crew's workers: build what stands unfinished at the outpost, else gather within 60 m of it
  outpostWork(S, o, ws, objs) {
    const W = this.W;
    const open = objs.filter((b) => !b.built);
    for (const w of ws) {
      if (w.inside || w.task.type === 'build' || w.task.type === 'attack') continue;
      if (open.length) { W.order([w], { type: 'build', target: open[0], auto: true }); continue; }
      if (w.task.type === 'gather' && w.task.node && Math.hypot(w.task.node.pos.x - o.pos.x, w.task.node.pos.z - o.pos.z) <= R_OUT + 10) continue;
      for (const r of o.type === 'OP_ResAll' ? ['stone', 'wood', 'food'] : ['wood', 'stone', 'food']) {
        const n = W.nearestResource(o.pos.x, o.pos.z, r, R_OUT);
        if (n) { W.order([w], { type: 'gather', target: n, auto: true }); break; }
      }
    }
  },
  // AiGoalIslandSurveillance: stone outposts (IS:147-231)
  islandSurveillance(S) {
    const W = this.W;
    if (this.personality === 'Turtle' || this.levelName === 'Single 09' || !this.start) return;
    if (W.time < (this.isT || 0)) return;
    this.isT = W.time + (500 + 1 + rnd(W.players.length + 1)) * 0.2;
    if (!this.stoneSpots) {
      const st = W.resources.filter((n) => n.alive && n.res === 'stone' && !n.water);
      st.sort((a, b) => Math.hypot(a.pos.x - this.start.x, a.pos.z - this.start.z) - Math.hypot(b.pos.x - this.start.x, b.pos.z - this.start.z));
      this.stoneSpots = st.map((n) => ({ x: n.pos.x, z: n.pos.z }));
    }
    const home = W.landIsland(S.home.x, S.home.z);
    const near = (pt, f) => {
      const out = [];
      W.uHash.query(pt.x, pt.z, R_OUT, (u) => { if (u.alive && !u.inside && Math.hypot(u.pos.x - pt.x, u.pos.z - pt.z) <= R_OUT && f(u)) out.push(u); });
      W.bHash.query(pt.x, pt.z, R_OUT + 10, (b) => { if (b.alive && Math.hypot(b.pos.x - pt.x, b.pos.z - pt.z) <= R_OUT && f(b)) out.push(b); });
      return out;
    };
    for (const pt of this.stoneSpots) {
      if (near(pt, (e) => e.owner === this.p).length) continue;
      const foreign = near(pt, (e) => e.owner !== this.p && (e.kind === 'building' || /CHTR|ANML|VHCL/.test(e.cls || '')));
      const isle = W.landIsland(pt.x, pt.z);
      const kind = isle === home ? 'inner' : 'outer';
      if (kind === 'outer') continue;                     // (other islands need the transfer by ship)
      if (!foreign.length) {
        if ((this.outposts || []).some((o) => o.type === 'OP_ResAll' && o.island === isle)) continue;
        this.startOutpost(pt, 'OP_ResAll');
        return;
      }
      if (foreign.length < 10 && this.isEnemyEntity(foreign[0])) {
        this.requestAttack(S, 'suicide', foreign[0].owner, foreign);
        this.startOutpost(pt, 'OP_ResAll');
        return;
      }
    }
  },
  // AiGoalBuildArmy: the attack outpost (BA:128-140)
  attackOutpostThink(S) {
    const W = this.W;
    if (this.atkOutpost || this.personality === 'Turtle') return;
    const e = this.enemyHint(S), h = S.home;
    if (!e) return;
    const isle = W.landIsland(h.x, h.z);
    for (const f of [0.45, 0.4, 0.5, 0.35, 0.55]) {
      const x = h.x + (e.x - h.x) * f, z = h.z + (e.z - h.z) * f;
      if (W.landIsland(x, z) !== isle || !W.nav.isFree(x, z)) continue;
      this.atkOutpost = this.startOutpost({ x, z }, 'AttackOutpost') || -1;
      return;
    }
    this.atkOutpost = -1;
  },
};
