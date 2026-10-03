// Fight module of the computer player: the strategist (CAiGoalDisturbAttack: which attack, when, on whom), the
// attacks themselves (the attack goals with their squads: CAiGoalGeneralAttack and its children, CAiTaskBuildSquad,
// CAiTaskAttackObject) and the scripted waves of campaign triggers (CAiGoalSingleplayerAttack).
// docs/spec/ai.md §5, §6. `Fight` = TribeAI methods; S = the census.
import * as DATA from './data.js';

const rnd = (n) => Math.floor(Math.random() * n);
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// the attack goal behind a plan entry and the army it asks for (FM:287-563, the goals' Think)
const GOALS = {
  suicide: ['suicide', 'SuicideAttack_'], violence: ['pureviolence', 'PureViolenceAttack_'], blitz: ['blitz', 'BlitzAttack_'], stealth: ['stealth', 'StealthAttack_'],
  rider: ['rider', 'RiderAttack_'], siege: ['siege', 'SiegeAttack_'], towersiege: ['siege', 'SiegeAttack_'], siege_warpgate: ['siege', 'SiegeAttack_'],
  guerilla: ['guerilla', 'SuicideAttack_'], traps: ['suicide', 'SuicideAttack_'], quick: ['quick', 'Quick'], pyramid: ['pyramid', null],
};
const MAX_ATTACKS = 3;                 // FM:42
const SHARE = [0, 0.08, 0.17, 0.25, 0.33, 0.42, 0.55, 0.7, 0.85, 1];       // of an army row's min-max span, by difficulty
const TIME_LIMIT = 1200;               // "attack must be finished in 20 minutes" (GA:943)
// target classes in the order a squad takes them on (AO:1240-1438), nearest first inside a class
function targetRank(e) {
  if (e.kind === 'unit') {
    if (e.def.unique) return 2;
    if (e.cls === 'VHCL') return 3;
    if (e.cls === 'ANML') return 4;
    if (e.isWorker) return 6;
    return e.cls === 'SHIP' ? 13 : 5;
  }
  const n = e.name, s = e.def.script || '';
  if (s === 'CWarpGate') return 1;
  if (e.def.wallKind === 'wall' || e.def.wallKind === 'gate' || e.def.wallKind === 'trap') return 11;
  if (e.def.wallKind === 'tower' || (e.weapons && e.weapons.long && e.weapons.long.projectile)) return 10;
  if (/_arena|_animal_farm|_machine|_weapons|_engineer|barracks|garage|rodeo|dojo/.test(n)) return 7;
  if (s === 'CFireplace' || /headquarters|resource_collector/.test(n)) return 8;
  return 9;
}

// One running attack: its units and its state.
//   new -> build (the squad is trained, with a timeout) -> gather (at the edge of the village) -> [sail] -> walk
//   (together) -> fight (targets in class order) -> over: survivors go back to the pool. There is no retreat.
export class Attack {
  constructor(ai, o) {
    this.ai = ai;
    this.id = ++ai.attackSeq;
    this.type = o.type;                         // plan entry or army name
    this.goal = o.goal;                         // pyramid | suicide | pureviolence | blitz | stealth | rider | siege | quick | singleplayer | pest
    this.armyName = o.armyName || null;
    this.enemy = o.enemy || null;               // the player it goes against (plan attacks)
    this.targets = o.targets ? o.targets.slice() : null;      // explicit targets (pest patrol, scripted waves)
    this.pos = o.pos || null;                   // way point / attack position
    this.scripted = !!o.scripted;
    this.hunt = !!o.hunt;                       // pest patrol, hunting for food / skulls: not one of the plan's three attacks
    this.onTheWay = o.onTheWay !== undefined ? !!o.onTheWay : true;
    this.targetOnly = !!o.targetOnly;
    this.spawned = !!o.spawned;
    this.units = new Set();
    this.orders = [];                           // classes still to train: { cls, level, flag, job }
    this.reinforce = [];
    this.state = 'new';
    this.t0 = ai.W.time;
    this.stateT = this.t0;
    this.result = null;
    this.startCount = 0;
    this.ship = null;                           // landing: the transports
  }
  drop(u) { this.units.delete(u); }
  alive() { const out = []; for (const u of this.units) if (u.alive && u.owner === this.ai.p) out.push(u); else this.units.delete(u); return out; }
  add(units) { for (const u of units) this.units.add(u); this.ai.claim(units, this); }
  centre(units) { let x = 0, z = 0; for (const u of units) { x += u.pos.x; z += u.pos.z; } const n = units.length || 1; return { x: x / n, z: z / n }; }
  set(state) { this.state = state; this.stateT = this.ai.W.time; }
  end(result) {
    if (this.state === 'over') return;
    this.result = result;
    this.state = 'over';
    const ai = this.ai, us = this.alive();
    ai.release(us);
    for (const u of us) if (u.stance !== 3) u.stance = 2;               // fighters aggressive again (GA:417)
    // back to the pool = back to the village guard (GuardVillage orders its pool to the guard position): without
    // this the survivors would walk on to wherever the attack was going. Scripted waves stay where they are.
    if (!this.scripted && result !== 'brainwash') ai.sendHome(us);
    if (this.ship) for (const s of this.ship) if (s.alive) { s.silentDeath = true; ai.W.kill(s, null); }
    const i = ai.attacks.indexOf(this);
    if (i >= 0) ai.attacks.splice(i, 1);
    const log = ai.launched.find((l) => l.id === this.id);
    // a request that never set out (no units, enemy too strong, squad not built) is not an attack
    if (log && log.go === undefined) ai.launched.splice(ai.launched.indexOf(log), 1);
    else if (log) { log.result = result; log.end = Math.round(ai.W.time); }
    if (!this.scripted && !this.hunt) ai.attackEnded(this, result);
  }
}

export const Fight = {
  // ------------------------------------------------------------------ the strategist (DA:551-589, 816-1630)
  strategyThink(S) {
    if (this.prm.noFight) return;
    const age = S.age;
    this.stratN = (this.stratN || 0) + 1;
    if (this.attackStrategy === undefined || this.stratN % 20 === 0) this.attackStrategy = rnd(6);       // DA:581
    if (!this.plan) this.plan = DATA.attackPlan({ ...this.ctx(), letter: this.letter });
    let entry = this.plan.attacks[Math.min(5, age) - 1] || 'none';
    const enemy = this.pickEnemy(S);
    // an enemy warp gate is hunted before anything else (DA:1532)
    const gate = this.multimap ? this.W.buildings.find((b) => b.alive && b.def.script === 'CWarpGate' && !b.disabled && this.isEnemyEntity(b)) : null;
    if (gate) this.requestAttack(S, 'siege_warpgate', gate.owner, [gate]);
    // scouting, once: a "scout" entry, or nobody to attack yet (DA:1536)
    if (!this.scouted && !this.pest && (entry === 'scout' || (!enemy && entry !== 'blitz')) && this.levelName !== 'Single 09') {
      this.sendScout(S);
      this.scouted = true;
      return;
    }
    if (this.pest) this.pestPatrol(S);
    if (entry === 'none') return;
    if (rnd(100) <= 10) entry = 'pyramid';                              // 11 %: everything it has (DA:1550)
    // difficulty 0 and 1 in the first epoch of a skirmish: only every sixth think, and then a small raid (DA:1552)
    if ((this.d === 0 || this.d === 1) && age === 1 && this.multimap) {
      if ((this.firstAttack || 0) >= 5) { entry = 'blitz'; this.firstAttack = 0; } else entry = 'none';
      this.firstAttack = (this.firstAttack || 0) + 1;
    }
    if (entry === 'none' || entry === 'scout' || !enemy) return;
    // guerilla raids, trap detection and ship attacks are not ported: the entry itself is requested
    this.requestAttack(S, entry, enemy);
  },
  // whom to attack (GetValidStartLocationToAttack, DA:368-421): by a strategy drawn anew every 20 thinks -
  // 0 anybody, 1-2 the weakest, 3-4 a human, 5 the human who attacked last
  pickEnemy(S) {
    const list = this.enemies().filter((o) => this.baseOf(o));
    if (!list.length) return null;
    const W = this.W;
    const strength = (o) => {                                           // CheckUnitLevel (DA:2048)
      let s = 0, workers = 0;
      for (const u of W.units) if (u.alive && u.owner === o && !u.naval) { if (u.isWorker) workers++; else s += u.level + (u.def.unique ? 2 : 0); }
      return s || workers || 1;
    };
    const weakest = (l) => l.reduce((b, o) => (strength(o) < strength(b) ? o : b), l[0]);
    const humans = list.filter((o) => !o.ai);
    const st = this.attackStrategy || 0;
    if (st === 0) return list[rnd(list.length)];
    if (st <= 2) return weakest(list);
    if (st === 5 && this.lastAttacker && list.includes(this.lastAttacker) && !this.lastAttacker.ai) return this.lastAttacker;
    return humans.length ? humans[humans.length - 1] : weakest(list);
  },
  // the fight module's gate (FM:205-241) and the goal for a plan entry
  requestAttack(S, type, enemy, targets = null, pos = null) {
    // melee or ranged army? By the range of what is to be attacked (CheckTargetTypeOfEnemy, DA:1857)
    if ((type === 'suicide' || type === 'violence') && enemy) {
      let long = 0, short = 0;
      const test = (e) => { if (!e.alive || e.owner !== enemy) return; const cs = e.weapons && e.weapons.long && e.cs ? e.cs(e.weapons.long) : null; if (cs && cs.range >= 10) long++; else short++; };
      for (const u of this.W.units) test(u);
      for (const b of this.W.buildings) test(b);
      type = long > short ? 'violence' : 'suicide';
    }
    const plan = this.attacks.filter((a) => !a.scripted && !a.hunt);
    if (this.defending && type !== 'pyramid' && type !== 'quick') return null;          // no attack while the village is under attack
    if (type !== 'pyramid' && plan.some((a) => a.type === type)) return null;            // "repeating attack request ignored"
    if (plan.length >= MAX_ATTACKS) return null;                                         // "maximum attack count reached"
    const g = GOALS[type] || GOALS.suicide;
    const a = new Attack(this, { type, goal: g[0], armyName: g[1] ? g[1] + (g[1].endsWith('_') ? Math.min(5, S.age) : '') : null, enemy, targets, pos });
    return this.launch(S, a);
  },
  launch(S, a) {
    this.attacks.push(a);
    this.launched.push({ id: a.id, t: Math.round(this.W.time), type: a.type, goal: a.goal, scripted: a.scripted, hunt: a.hunt, n: 0 });
    this.attackThink(S, a);
    return a.state === 'over' ? null : a;
  },
  attackEnded() {},
  // units that are not fighting walk (attack-move) to the guard point
  sendHome(units) {
    const S = this.S || this.census();
    if (!S.home || !units.length) return;
    const g = this.guardPoint(S);
    const far = units.filter((u) => u.alive && !u.inside && u.task.type !== 'attack' && Math.hypot(u.pos.x - g.x, u.pos.z - g.z) > 30);
    for (const u of far) u.aiWait = false;
    if (far.length) this.W.order(far, { type: 'attackmove', x: g.x, z: g.z, auto: true });
  },
  // ------------------------------------------------------------------ squads
  // how many of an army row to take: the engine's choice inside min-max is unknown; a share that grows with the
  // difficulty is used (0: the minimum, 9: the maximum)
  squadCount(e) { return Math.max(e.min ? 1 : 0, Math.floor(e.min + (e.max - e.min) * SHARE[this.d] + 1e-6)); },
  // an army for a tribe whose table is missing: units of the derived mix
  fallbackArmy(S, name, fixed = false) {
    const mix = this.derivedMix(S);
    const m = /(\d)\s*$/.exec(name || '');
    const tier = m ? +m[1] : S.age;
    const all = [];
    for (const k of Object.keys(mix).sort()) for (const g of mix[k]) all.push(g.units[0].cls);
    if (!all.length) return null;
    const ranged = /Violence|ranged|siege/i.test(name || '');
    const isR = (c) => { const ws = this.D.weaponSet(c, this.D.minLevel(c, this.p), this.p); return !!(ws && ws.long && ws.long.projectile); };
    const pref = all.filter((c) => isR(c) === ranged);
    const list = (pref.length ? pref : all).slice(-3).reverse();
    // rows like the shipped tables' ("1-4" in the first epoch, "1-6" later); a scripted wave gets fixed numbers
    const n = Math.ceil((2 + 2 * tier) / list.length);
    return list.map((cls) => ({ min: fixed ? n : 1, max: fixed ? n : tier <= 1 ? 4 : 6, alternatives: [{ cls }] }));
  },
  // the pool units an attack adds to its squad: "bad" ones first (not in the unit mix any more: used up), then the
  // lowest levels (MOD.QueryUnits). -> null when fewer than min are there
  queryPool(S, min, max, exclude, all = false) {
    const pool = S.pool.filter((u) => !this.claims.has(u) && !(exclude && exclude.has(u)) && !u.def.unique);
    if (pool.length < min) return null;
    // how much of the pool an attack may take: the behaviour's "riskiness" (Dodo 100, Giraffe 50, Schnecke 10 %).
    // The scripts only store that number; here it keeps a home guard for the careful personalities
    const risk = Math.max(0.1, Math.min(1, (this.prm.riskiness === undefined ? 100 : this.prm.riskiness) / 100));
    if (!all) max = Math.min(max, Math.max(min, Math.ceil(pool.length * risk)));
    const mix = DATA.unitMix(this.p.tribe, S.age) || this.derivedMix(S);
    const good = new Set();
    for (const k in mix) for (const g of mix[k]) for (const u of g.units) good.add(u.cls);
    pool.sort((a, b) => (good.has(a.name) ? 1 : 0) - (good.has(b.name) ? 1 : 0) || a.level - b.level);
    return pool.slice(0, Math.max(min, max));
  },
  // "Enemy is too strong!" unless own level score >= strength x enemy level score (the goals' CompareLevel)
  strongEnough(a, units, strength) {
    if (!a.enemy) return true;
    let them = 0;
    for (const u of this.W.units) if (u.alive && u.owner === a.enemy && !u.isWorker && !u.naval) them += u.level;
    return this.score(units) >= strength * them;
  },

  // ------------------------------------------------------------------ the attack goals' Think
  attacksThink() {
    const S = this.S || this.census();
    for (const a of this.attacks.slice()) this.attackThink(S, a);
  },
  attackThink(S, a) {
    const W = this.W, now = W.time;
    if (a.state === 'over') return;
    if (now - a.t0 > TIME_LIMIT) return a.end('timeout');
    const us = a.alive();
    switch (a.state) {
      case 'new': return this.attackNew(S, a);
      case 'build': return this.attackBuild(S, a, us);
      case 'gather': {
        if (!us.length) return a.end('dead');
        const g = a.rally;
        const near = us.filter((u) => d2({ x: u.pos.x, z: u.pos.z }, g) < 24).length;
        if (near >= Math.ceil(us.length * 0.8) || now - a.stateT > 40) return this.attackGo(S, a, us);
        for (const u of us) if (u.task.type === 'idle' && d2({ x: u.pos.x, z: u.pos.z }, g) > 14) W.order([u], { type: 'move', x: g.x + (Math.random() - 0.5) * 10, z: g.z + (Math.random() - 0.5) * 10, auto: true });
        return;
      }
      case 'sail': return this.attackSail(S, a, us);
      case 'walk': return this.attackWalk(S, a, us);
      case 'fight': return this.attackFight(S, a, us);
    }
  },
  attackNew(S, a) {
    const lv = this.lv, sq = DATA.squad(a.goal, this.cls);
    if (a.goal === 'pyramid') {
      // everything the pool has (PY:101-137). In the first epoch the script lets any number go, one by one as they
      // leave the barracks, and later whatever passes the strength check - a single unit against a weak enemy.
      // Here a raid waits for four (two / three at difficulty 0 / 1: the script's "should have" count of the later
      // epochs, capped at what a first-epoch pool holds) and goes together, in every epoch: without that the units
      // trained after an all-in follow it one by one
      const units = S.pool.filter((u) => !u.def.unique || S.age > 1);
      const need = !a.scripted ? Math.min(4, lv.pyramidAttackUnits || 4) : 1;
      if (units.length < need) return a.end('no units');
      if (S.age > 1 && !a.scripted && !this.strongEnough(a, units, lv.attackStrength) && units.length < (lv.pyramidAttackUnits || 10)) return a.end('too strong');
      a.add(units);
      return this.attackGather(S, a);
    }
    const table = this.cfg.valueTable || 'Dodo';
    // a tribe without any army table (its settings folder is missing): a squad from the tech tree instead
    const army = a.armyName ? DATA.army(this.p.tribe, table, a.armyName) || (DATA.hasArmies(this.p.tribe) || a.goal === 'quick' ? null : this.fallbackArmy(S, a.armyName)) : null;
    if (!army) {
      // no army table (GetUnits fails): pool units only (SU:116-151)
      const extra = a.goal === 'pureviolence' ? S.age * 2 : 0;
      const units = this.queryPool(S, Math.max(1, sq.min), sq.max + extra);
      if (!units) return a.end('no units');
      if (!this.strongEnough(a, units, lv.attackStrength)) return a.end('too strong');
      a.add(units);
      return this.attackGather(S, a);
    }
    // the squad: pool units of the wanted classes first (QueryEssentialsFromDefensePool), the rest is trained
    const taken = new Set();
    for (const e of army) {
      let n = this.squadCount(e);
      for (const alt of e.alternatives) {
        for (const u of S.pool) { if (n <= 0) break; if (u.name === alt.cls && !taken.has(u) && !this.claims.has(u)) { taken.add(u); n--; } }
      }
      const alt = e.alternatives.find((x) => this.resolve('CHTR/' + x.cls, '')) || e.alternatives[0];
      for (; n > 0; n--) a.orders.push({ cls: this.fieldable(alt.cls), level: alt.level !== undefined ? alt.level + 1 : 0, flag: alt.objFlag || null, job: null });
    }
    a.add([...taken]);
    this.sendHome([...taken]);                    // the squad forms at the guard point
    a.buildUntil = this.W.time + DATA.squadTimeout(this.cls);
    a.set('build');
    return this.attackBuild(S, a, a.alive());
  },
  // BuildSquad: train what is missing; when the squad stands, pool units join and the strength is checked
  attackBuild(S, a, us) {
    const W = this.W, p = this.p, lv = this.lv, sq = DATA.squad(a.goal, this.cls);
    for (const o of a.orders) {
      if (o.done) continue;
      if (o.job) {
        if (o.job.producer.alive && o.job.producer.queue.includes(o.job.item)) continue;
        // it left the queue: the new unit of that class joins
        const u = S.pool.find((x) => x.name === o.cls && !this.claims.has(x));
        if (u) { a.add([u]); o.done = true; if (o.level > u.level && W.skullCost(u.level, o.level) <= p.res.skulls) W.changeLevel(u, o.level); } else o.job = null;
        continue;
      }
      const T = this.trainable(S, o.cls);
      if (!T || !T.producer) { if (!T || T.why === 'none' || T.why === 'req') o.fail = (o.fail || 0) + 1; continue; }
      if (!this.armyCanPay(S, T.action.cost)) { this.unitNeed = T.action.cost; continue; }
      if (W.queueAction(T.producer, T.action) === null) o.job = { producer: T.producer, item: T.producer.queue[T.producer.queue.length - 1] };
    }
    const open = a.orders.filter((o) => !o.done);
    const late = W.time > a.buildUntil;
    if (open.length && !late) return;
    us = a.alive();
    // timeout with an incomplete squad: "squad allocation failed" - unless most of it is there
    if (open.length && us.length < Math.max(1, Math.ceil((us.length + open.length) * 0.6))) return a.end('squad failed');
    for (const o of open) if (o.job && o.job.producer.alive) { const i = o.job.producer.queue.indexOf(o.job.item); if (i > 0) W.cancelQueue(o.job.producer, i); }
    a.orders = [];
    if (!a.scripted || !a.spawned) {
      const min = a.goal === 'singleplayer' ? 0 : sq.min;
      const more = this.queryPool(S, min, sq.max + (a.goal === 'pureviolence' ? S.age * 2 : 0), a.units);
      if (!more) return a.end('no pool units');
      if (!a.scripted && !this.strongEnough(a, [...us, ...more], lv.attackStrength)) return a.end('too strong');
      a.add(more);
    }
    return this.attackGather(S, a);
  },
  attackGather(S, a) {
    const us = a.alive();
    if (!us.length) return a.end('no units');
    a.startCount = us.length;
    a.core = us.slice();                                                  // the squad that sets out (reinforcements come later)
    const log = this.launched.find((l) => l.id === a.id);
    if (log) { log.n = us.length; log.go = Math.round(this.W.time); }
    for (const u of us) if (u.stance !== 3) u.stance = 2;                 // SetAggroState(actors, 2) (AO:764)
    if (!a.scripted && !a.hunt && this.G.onAiAttack) this.G.onAiAttack(this.p, a);
    const g = this.guardPoint(S);
    a.rally = g;
    const far = us.filter((u) => d2({ x: u.pos.x, z: u.pos.z }, g) > 24);
    if (far.length <= us.length * 0.2) return this.attackGo(S, a, us);
    this.W.order(far, { type: 'move', x: g.x, z: g.z, auto: true });
    a.set('gather');
  },
  // where an attack goes: the way point, the explicit targets, or the enemy's village
  attackAim(a) {
    if (a.pos) return a.pos;
    if (a.targets) { const t = a.targets.find((e) => e.alive); if (t) return { x: t.pos.x, z: t.pos.z }; }
    return a.enemy ? this.baseOf(a.enemy) : null;
  },
  attackGo(S, a, us) {
    const aim = this.attackAim(a);
    if (!aim) return a.end('no target');
    a.aim = aim;
    a.set('walk');
    // skirmish squads attack-move; campaign waves walk unless told to fight on the way (AO:880-896)
    // (hunters walk: an attack-move would take on every animal they pass)
    a.amove = !a.hunt && (this.multimap || a.onTheWay || !a.scripted);
    this.W.order(us, { type: a.amove ? 'attackmove' : 'move', x: aim.x, z: aim.z, auto: true });
  },
  // the squad marches together: whoever is far ahead of the last one waits for it
  attackWalk(S, a, us) {
    const W = this.W;
    if (!us.length) return a.end('dead');
    const aim = a.aim;
    const dist = (u) => Math.hypot(u.pos.x - aim.x, u.pos.z - aim.z);
    let lead = 1e9, tail = 0, fighting = 0;
    for (const u of us.slice()) {
      const d = dist(u), t = u.task.type;
      // a unit that does not come along (it cannot get there, it sits in a building, it is busy with something
      // else) leaves the squad after 45 s instead of keeping everybody waiting for it
      if (u.aiBest === undefined || u.aiAtk !== a.id || d < u.aiBest - 4 || t === 'attack' || u.aiWait) { u.aiBest = Math.min(d, u.aiAtk === a.id && u.aiBest !== undefined ? u.aiBest : d); u.aiAtk = a.id; u.aiBestT = W.time; }
      else if (W.time - u.aiBestT > 45 && us.length > 1) { a.drop(u); this.release([u]); us.splice(us.indexOf(u), 1); u.aiStuckT = W.time; continue; }
      lead = Math.min(lead, d); tail = Math.max(tail, d); if (t === 'attack') fighting++;
    }
    // no progress for a minute and a half (a unit that cannot get there): the attack is over, the units go home
    if (a.bestLead === undefined || lead < a.bestLead - 8 || fighting) { a.bestLead = fighting ? lead + 8 : lead; a.bestT = W.time; } else if (W.time - a.bestT > 90 && !a.scripted) return a.end('stuck');
    const arrive = a.scripted && a.pos ? 40 : 55;
    if (lead < arrive || (fighting >= Math.max(1, us.length * 0.3) && lead < 110)) { a.set('fight'); return this.attackFight(S, a, us); }
    const spread = tail - lead;
    for (const u of us) {
      const t = u.task.type;
      if (t === 'attack') continue;
      const d = dist(u);
      if (spread > 35 && d < tail - 35 && now(W) - a.stateT > 4) { if (t !== 'hold') W.order([u], { type: 'hold' }); u.aiWait = true; continue; }
      if (t === 'idle' || t === 'hold' || u.aiWait) { u.aiWait = false; if (u.stance !== 3) u.stance = 2; W.order([u], { type: a.amove ? 'attackmove' : 'move', x: aim.x, z: aim.z, auto: true }); }
    }
  },
  // the targets of an attack in the order of AO:1240, best first: [entity...] (at most a handful are needed)
  attackTargets(a, c) {
    const W = this.W;
    let best = null, bv = 1e18;
    const test = (e) => {
      if (!e.alive || e.inside || e.untargetable) return;
      if (e.kind === 'unit' && (e.naval || W.hiddenFrom(e, this.p))) return;
      if (this.regions.size && this.regionValue('Enemy', e.pos.x, e.pos.z) < 0) return;
      const v = targetRank(e) * 1e5 + Math.hypot(e.pos.x - c.x, e.pos.z - c.z);
      if (v < bv) { bv = v; best = e; }
    };
    if (a.targets) {
      a.targets = a.targets.filter((e) => e.alive);
      for (const e of a.targets) test(e);
      if (best || a.targetOnly || a.hunt) return best;
    }
    if (a.enemy) {
      for (const u of W.units) if (u.owner === a.enemy) test(u);
      for (const b of W.buildings) if (b.owner === a.enemy) test(b);
    } else if (a.scripted) {
      // a wave whose listed targets are gone goes on against whatever enemy is near the attack position
      const q = (e) => { if (this.isEnemyEntity(e) && Math.hypot(e.pos.x - c.x, e.pos.z - c.z) < 60) test(e); };
      W.uHash.query(c.x, c.z, 60, q); W.bHash.query(c.x, c.z, 70, q);
    }
    return best;
  },
  attackFight(S, a, us) {
    const W = this.W;
    if (!us.length) return a.end('dead');
    // the squad itself is dead and only late reinforcements are on their way: they turn round
    if (a.core && !a.core.some((u) => u.alive) && !a.scripted) return a.end('dead');
    // reinforcements: a squad of more than five that loses a unit asks for two more of its kind (GA:1036-1043)
    if (!a.scripted && !a.hunt && a.startCount > 5 && us.length < (a.lastCount || a.startCount) && a.reinforce.length < 4) {
      const cls = us.find((u) => u.cls !== 'VHCL');
      if (cls) for (let i = 0; i < 2; i++) { const T = this.trainable(S, cls.name); if (T && T.producer && this.armyCanPay(S, T.action.cost) && W.queueAction(T.producer, T.action) === null) a.reinforce.push({ cls: cls.name, producer: T.producer, item: T.producer.queue[T.producer.queue.length - 1] }); }
    }
    a.lastCount = us.length;
    for (const r of a.reinforce.slice()) {
      if (r.producer.alive && r.producer.queue.includes(r.item)) continue;
      a.reinforce.splice(a.reinforce.indexOf(r), 1);
      const u = S.pool.find((x) => x.name === r.cls && !this.claims.has(x));
      if (u) { a.add([u]); us.push(u); }
    }
    const c = a.centre(us);
    const tgt = this.attackTargets(a, c);
    if (!tgt) return a.end('done');
    const building = tgt.kind === 'building';
    for (const u of us) {
      const t = u.task.type;
      if (t === 'attack' && u.task.target && u.task.target.alive) continue;
      if (u.aiTgt === tgt && (t === 'attackmove' || t === 'move') && W.time - (u.aiTgtT || 0) < 12) continue;
      u.aiTgt = tgt; u.aiTgtT = W.time; u.aiWait = false;
      const d = Math.hypot(u.pos.x - tgt.pos.x, u.pos.z - tgt.pos.z);
      // buildings are attacked directly once the squad stands in front of them; everything else by attack-move
      if ((building && d < 45) || a.hunt) W.order([u], { type: 'attack', target: tgt });
      else W.order([u], { type: 'attackmove', x: tgt.pos.x, z: tgt.pos.z, auto: true });
    }
  },

  // ------------------------------------------------------------------ pest patrol (DA:689-812) and the scout
  // where a wild animal killed a worker: a squad clears the hostile animals around the spot
  pestPatrol(S) {
    const W = this.W, at = this.pest;
    this.pest = null;
    if (!this.multimap) return;
    const prey = [];
    W.uHash.query(at.x, at.z, 90, (u) => { if (u.alive && u.wild && !u.naval && (u.def.aggressive > 0 || (u.attackers && u.attackers.size)) && Math.hypot(u.pos.x - at.x, u.pos.z - at.z) < 90) prey.push(u); });
    if (!prey.length) return;
    if (S.age <= 3 && prey.some((u) => /allosaurus|tyranno|_rex/i.test(u.name))) return;        // too big before epoch 4
    this.hunt(S, 'pest', prey, 2, Math.max(4, prey.length * 3));
  },
  // a small squad of pool units against wild animals (pest patrol, food, skulls): one of each kind at a time
  hunt(S, type, prey, min, max) {
    if (this.attacks.some((a) => a.type === type)) return true;
    const units = this.queryPool(S, min, max, null, true);
    if (!units) return false;
    const a = new Attack(this, { type, goal: 'quick', targets: prey, hunt: true });
    this.attacks.push(a);
    this.launched.push({ id: a.id, t: Math.round(this.W.time), type, goal: 'quick', scripted: false, hunt: true, n: 0 });
    a.add(units);
    this.attackGo(S, a, a.alive());
    if (a.state !== 'over') { a.startCount = units.length; const log = this.launched.find((l) => l.id === a.id); if (log) { log.n = units.length; log.go = Math.round(this.W.time); } }
    return a.state !== 'over';
  },
  // RequestExploration: one fast unit runs to the enemy's village and back
  sendScout(S) {
    const enemy = this.enemies().map((o) => this.baseOf(o)).filter(Boolean)[0];
    if (!enemy || !S.home) return false;
    const u = S.pool.slice().sort((a, b) => b.speed - a.speed)[0];
    if (!u) return false;
    const a = Math.atan2(S.home.z - enemy.z, S.home.x - enemy.x);
    this.W.order([u], { type: 'move', x: enemy.x + Math.cos(a) * 45, z: enemy.z + Math.sin(a) * 45, auto: true, then: { type: 'move', x: S.home.x, z: S.home.z, auto: true } });
    return true;
  },

  // ------------------------------------------------------------------ campaign triggers (AIFT, §6.5)
  // custom_attack = 1. Bypasses the three-attack limit and the defending check. -> the attack's id | null
  startAttack({ type, targets, position = null, attackOnTheWay = false, spawn = false, spawnPosition = null, ignoreLocations = false, targetOnly = false, ship = false, shipLand = false, behaviour = null } = {}) {
    void behaviour;                                      // attack_behavior: the editor's hint, never read by the game
    targets = (targets || []).filter((e) => e && e.alive);
    if (!targets.length) return null;
    if (type === 'RessourceOutpost' || type === 'AttackOutpost') return null;         // outposts are not ported
    const S = this.census(true);
    if (!S.base) return null;                            // nothing left of this player
    if (type === 'PyramidAttack') {
      const a = new Attack(this, { type, goal: 'pyramid', targets, pos: position, scripted: true, onTheWay: attackOnTheWay, targetOnly });
      return this.launch(S, a) ? a.id : null;
    }
    const a = new Attack(this, { type, goal: 'singleplayer', armyName: type, targets, pos: position, scripted: true, onTheWay: attackOnTheWay, targetOnly, spawned: spawn });
    const army = DATA.army(this.p.tribe, 'Singleplayer', type) || this.fallbackArmy(S, type, true);
    if (!army) return null;
    this.attacks.push(a);
    this.launched.push({ id: a.id, t: Math.round(this.W.time), type, goal: a.goal, scripted: true, n: 0 });
    if (spawn) {
      const made = this.spawnArmy(S, army, spawnPosition || this.start || S.home, ignoreLocations, type);
      if (!made.length) { a.end('no units'); return null; }
      a.add(made);
      if (shipLand && position && this.embark(a, made, spawnPosition || this.start || S.home, position)) { a.startCount = made.length; a.set('sail'); return a.id; }
      void ship;                                         // a ship attack runs as the same wave (no naval goal)
      a.startCount = made.length;
      const log = this.launched.find((l) => l.id === a.id);
      if (log) { log.n = made.length; log.go = Math.round(this.W.time); }
      this.attackGo(S, a, made);
      return a.state === 'over' ? null : a.id;
    }
    // from the village: the army's units out of the pool, the rest trained, plus a few pool units (SP:145-369)
    const taken = new Set();
    for (const e of army) {
      let n = this.squadCount(e);
      for (const alt of e.alternatives) for (const u of S.pool) { if (n <= 0) break; if (u.name === alt.cls && !taken.has(u) && !this.claims.has(u)) { taken.add(u); n--; } }
      const alt = e.alternatives[0];
      for (; n > 0; n--) a.orders.push({ cls: this.fieldable(alt.cls), level: alt.level !== undefined ? alt.level + 1 : 0, flag: alt.objFlag || null, job: null });
    }
    a.add([...taken]);
    this.sendHome([...taken]);
    a.buildUntil = this.W.time + DATA.squadTimeout(this.cls);
    a.set('build');
    this.attackBuild(S, a, a.alive());
    return a.state === 'over' ? null : a.id;
  },
  // MakeUnit (SP:528-662): the units of an army appear for free and outside the population limit; without
  // ignore_locations each class needs its finished producing building, and appears there
  spawnArmy(S, army, at, ignoreLocations, name) {
    const W = this.W, D = this.D, p = this.p, out = [];
    let k = 0;
    for (const e of army) {
      const alt = e.alternatives.find((x) => D.exists(x.cls)) || null;
      if (!alt) continue;
      if (/Single 04/.test(this.levelName || '') && alt.cls === 'hu_mammoth_log_cannon') continue;
      if (/Single 06/.test(this.levelName || '') && alt.cls === 'ninigi_firecannon') continue;
      let where = at;
      if (!ignoreLocations) {
        const R = this.resolve('CHTR/' + alt.cls, '');
        const b = R && this.producersOf(S, R.action).filter((x) => x.kind === 'building' && x.hp >= 5).sort((x, y) => d2({ x: x.pos.x, z: x.pos.z }, at) - d2({ x: y.pos.x, z: y.pos.z }, at))[0];
        if (!b) continue;
        where = { x: b.pos.x, z: b.pos.z, r: b.radius + 3 };
      }
      const n = this.scriptedCount(e);
      for (let i = 0; i < n; i++) {
        let lv = alt.level !== undefined ? alt.level + 1 : DATA.spawnLevel(alt.cls) || D.minLevel(alt.cls, p);
        while (lv > 1 && !(D.stats(alt.cls, lv, p) && D.stats(alt.cls, lv, p).exists)) lv--;
        lv = Math.max(lv, D.minLevel(alt.cls, p));
        const ang = k * 2.4, r = (where.r || 3) + 2 + Math.sqrt(k) * 2.2; k++;
        const info = D.info(alt.cls);
        if (info && info.type === 'SHIP' && !W.waterNav) continue;
        const u = W.spawnUnit(alt.cls, p, where.x + Math.cos(ang) * r, where.z + Math.sin(ang) * r, lv, 0);
        if (!u) continue;
        if (alt.objFlag && alt.objFlag !== alt.cls) { const up = this.acts(u).find((x) => x.kind === 'Upgrades' && x.id === alt.objFlag); if (up) W.completeUpgrade(u, up); }
        out.push(u);
      }
    }
    void name;
    return out;
  },
  // a scripted wave is as big as its table says: the fixed number, else by the campaign difficulty of the slot
  scriptedCount(e) { return e.min === e.max ? e.min : this.squadCount(e); },
  // landing (ship_land): the wave boards transports at the water nearest to the spawn position and sails to the
  // landing point; -> false when there is no water or no transport class (the wave then walks)
  embark(a, units, from, to) {
    const W = this.W, D = this.D, p = this.p;
    if (!W.waterNav) return false;
    const wn = W.waterNav;
    let cls = null;
    for (const act of D.actions(p)) { const o = act.kind === 'Build' && act.results[0] && act.results[0].obj; if (!o) continue; const df = D.def(o, p); if (df && df.transportClass === 2 && D.info(o).type === 'SHIP') { cls = o; break; } }
    if (!cls) cls = ['hu_transport_ship', 'aje_transport_turtle', 'ninigi_transport_boat', 'seas_hovercraft'].find((n) => D.exists(n) && n.startsWith(p.tribe.toLowerCase()));
    if (!cls) return false;
    const c0 = wn.nearestFree(wn.idx(from.x, from.z), 60), c1 = wn.nearestFree(wn.idx(to.x, to.z), 40);
    if (wn.block[c0] || wn.block[c1]) return false;
    const [sx, sz] = wn.center(c0), [tx, tz] = wn.center(c1);
    a.ship = [];
    a.land = { x: tx, z: tz };
    let ship = null;
    for (const u of units) {
      if (!ship || (ship.passengers || []).length >= W.capacity(ship)) {
        ship = W.spawnUnit(cls, p, sx + a.ship.length * 6, sz, 1, 0);
        if (!ship) return a.ship.length > 0;
        a.ship.push(ship);
        this.claims.set(ship, a);
      }
      if (W.canBoard(u, ship)) W.enterTransport(u, ship);
    }
    W.order(a.ship, { type: 'move', x: tx, z: tz, auto: true });
    return true;
  },
  attackSail(S, a, us) {
    const W = this.W;
    const ships = (a.ship || []).filter((s) => s.alive);
    if (!ships.length) { a.ship = null; return us.some((u) => !u.inside) ? this.attackGo(S, a, us.filter((u) => !u.inside)) : a.end('dead'); }
    for (const s of ships) {
      const d = Math.hypot(s.pos.x - a.land.x, s.pos.z - a.land.z);
      if (d < 18 || (s.task.type === 'idle' && d < 60) || W.time - a.stateT > 240) {
        if (W.shorePoint(s, 30)) { W.unloadAll(s, false); s.silentDeath = true; this.claims.delete(s); W.kill(s, null); } else if (s.task.type === 'idle') W.order([s], { type: 'move', x: a.land.x + (Math.random() - 0.5) * 20, z: a.land.z + (Math.random() - 0.5) * 20, auto: true });
      }
    }
    if (!(a.ship || []).some((s) => s.alive)) { a.ship = null; const out = a.alive().filter((u) => !u.inside); if (!out.length) return a.end('dead'); this.attackGo(S, a, out); }
  },
  // custom_attack = 0: a squad picked against the targets from the arms the trigger allows. -> id | null
  startAutoAttack({ targets, use = { ranged: true, melee: true, infantry: true, cavalry: true, vehicles: true, ships: false } } = {}) {
    targets = (targets || []).filter((e) => e && e.alive);
    if (!targets.length) return null;
    const S = this.census(true);
    if (!S.base) return null;
    const isRanged = (u) => !!(u.weapons.long && u.weapons.long.projectile);
    const ok = (u) => (isRanged(u) ? use.ranged !== false : use.melee !== false) && (u.cls === 'CHTR' ? use.infantry !== false : u.cls === 'ANML' ? use.cavalry !== false : use.vehicles !== false);
    const pool = S.pool.filter(ok).sort((x, y) => y.level - x.level);
    let need = 2;
    for (const e of targets) if (e.kind === 'unit' && !e.isWorker) need += e.level * 1.2;
    const units = [];
    let sc = 0;
    for (const u of pool) { if (sc >= need && units.length >= 2) break; units.push(u); sc += u.level; }
    if (!units.length) return null;
    const a = new Attack(this, { type: 'auto', goal: 'quick', targets, scripted: true, onTheWay: true });
    this.attacks.push(a);
    this.launched.push({ id: a.id, t: Math.round(this.W.time), type: 'auto', goal: 'quick', scripted: true, n: units.length });
    a.add(units);
    this.attackGather(S, a);
    return a.state === 'over' ? null : a.id;
  },
};
const now = (W) => W.time;
