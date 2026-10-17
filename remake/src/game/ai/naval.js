// The computer player at sea (docs/spec/ai_group6.md §4): attacks on the enemy's ships and harbours
// (goals/AiGoalAttackShips.usl, the strategist DA:951-958, 1534, 1884-1901) and squads that cross the water in
// transports (goals/AiGoalWatercrossing.usl, AiGoalGeneralAttack.usl:236-365, Modules/AiModuleArea.usl:248-272).
//
//   * Ship attack: on maps with water, from epoch 3, when an enemy owns a harbour and the AI knows enemy ships or
//     harbours, 6 % of the strategist's thinks (not in Single 01 / 02 / 10, Single 03 player 1) - before the plan's
//     entry. The squad: its idle warships, else the army ShipAttack_<epoch 2-4> trained at its harbour. The targets
//     nearest its start location first, ships before harbours (AS:101-110 meant that; the original's test makes
//     every building rank lower); within 40 m it fights; done, the ships go back to the harbour.
//   * Crossing (a squad's target on another land - World.landIsland - or, on skirmish water maps with harbours, one
//     attack in nine of a tribe other than Aje as a flank by sea; GA:236-262): ceil(n / 10) of its transports, idle
//     ones first, else trained at the harbour (2 minutes at most); the squad boards (BoardTransporter: the transport
//     comes to the shore near them; again every 7th think, 7 rounds at most), sails to the water off the enemy's
//     village and gets out at the shore within 30 m; then the attack goes on by land and the transports go home. At
//     most 5 crossings at once (AM:75). A transport lost while boarding: everybody out at home and the attack ends.
//   * Units left on another land (idle for 10 area thinks) are fetched home the same way (AM:140-210).
import * as DATA from './data.js';
import { Attack } from './attack.js';

const rnd = (n) => Math.floor(Math.random() * n);
const NO_SHIP_ATTACK = /^Single (01|02|10)$/;
const TRANSPORTS = ['hu_transport_ship', 'aje_transport_turtle', 'ninigi_transport_boat', 'seas_hovercraft'];
const HARBOUR = /harbour|seas_carrier/;
const MAX_CROSSINGS = 5;

export const NavalAI = {
  // ------------------------------------------------------------------ the ship attack
  // DisturbAttack: true when a ship attack was asked for (the strategist stops there)
  shipAttackCheck(S) {
    const W = this.W;
    if (!W.waterNav || S.age < 3 || NO_SHIP_ATTACK.test(this.levelName || '') || (this.levelName === 'Single 03' && this.p.id === 1)) return false;
    const targets = this.enemyNaval();
    if (!targets.some((e) => e.kind === 'building') || rnd(100) > 5) return false;
    return !!this.requestShipAttack(S, targets);
  },
  // enemy ships and harbours the AI can see
  enemyNaval() {
    const W = this.W, out = [];
    for (const u of W.units) if (u.alive && u.naval && !u.inside && this.isEnemyEntity(u) && !W.hiddenFrom(u, this.p)) out.push(u);
    for (const b of W.buildings) if (b.alive && this.isEnemyEntity(b) && HARBOUR.test(b.name)) out.push(b);
    return out;
  },
  requestShipAttack(S, targets) {
    const plan = this.attacks.filter((a) => !a.scripted && !a.hunt);
    if (this.defending || plan.some((a) => a.goal === 'ship') || plan.length >= 3) return null;
    const a = new Attack(this, { type: 'ship', goal: 'ship', armyName: 'ShipAttack_' + Math.max(2, Math.min(4, S.age)), enemy: targets[0].owner, targets });
    this.attacks.push(a);
    this.launched.push({ id: a.id, t: Math.round(this.W.time), type: 'ship', goal: 'ship', scripted: false, hunt: false, n: 0 });
    a.set('fleet');
    a.buildUntil = this.W.time + 120;
    this.shipAttackThink(S, a);
    return a.state === 'over' ? null : a;
  },
  isWarship(u) { return u.alive && u.naval && !u.stationary && !u.cannotFight && !(u.def && u.def.transportClass >= 2) && !/fishing/.test(u.name); },
  harbourOf(S) { return S.blds.find((b) => b.built && HARBOUR.test(b.name)) || null; },
  // AttackShips' Think: new -> (train) -> walk -> fight
  shipAttackThink(S, a) {
    const W = this.W;
    const ships = a.alive();
    if (a.state === 'fleet') {
      for (const u of S.fleet) if (this.isWarship(u) && !this.claims.has(u) && ships.length < 8) { a.add([u]); ships.push(u); }
      if (!ships.length && !a.ordered) {
        a.ordered = true;
        const army = DATA.army(this.p.tribe, this.cfg.valueTable || 'Dodo', a.armyName) || [];
        for (const e of army) for (let n = Math.max(1, e.min); n > 0; n--) {
          const T = this.trainable(S, e.alternatives[0].cls);
          if (T && T.producer && this.armyCanPay(S, T.action.cost)) W.queueAction(T.producer, T.action);
        }
      }
      if (!ships.length) { if (W.time > a.buildUntil) a.end('no ships'); return; }
      a.startCount = ships.length;
      const log = this.launched.find((l) => l.id === a.id);
      if (log) { log.n = ships.length; log.go = Math.round(W.time); }
      a.set('walk');
    }
    if (!ships.length) return a.end('dead');
    const st = this.start || S.home;
    a.targets = (a.targets || []).filter((e) => e.alive);
    if (!a.targets.length) a.targets = this.enemyNaval();
    // ships before buildings, the nearest to the start location first
    a.targets.sort((x, y) => (x.kind === 'building') - (y.kind === 'building') || Math.hypot(x.pos.x - st.x, x.pos.z - st.z) - Math.hypot(y.pos.x - st.x, y.pos.z - st.z));
    const tgt = a.targets[0];
    if (!tgt) {
      a.end('done');
      const h = this.harbourOf(S);
      if (h) W.order(ships, { type: 'move', x: h.pos.x, z: h.pos.z, auto: true });
      return;
    }
    const c = a.centre(ships);
    if (a.state === 'walk' && Math.hypot(c.x - tgt.pos.x, c.z - tgt.pos.z) > 40) {
      for (const u of ships) if (u.task.type !== 'attack') W.order([u], { type: 'attackmove', x: tgt.pos.x, z: tgt.pos.z, auto: true });
      return;
    }
    a.set('fight');
    for (const u of ships) if (!(u.task.type === 'attack' && u.task.target && u.task.target.alive)) W.order([u], { type: 'attack', target: tgt });
  },

  // ------------------------------------------------------------------ crossing the water
  // does a squad going to aim cross the water? (GA:236-262)
  needsCrossing(S, a, aim) {
    const W = this.W;
    if (!W.waterNav || a.goal === 'ship' || a.crossed) return false;
    const from = W.landIsland(S.home.x, S.home.z), to = W.landIsland(aim.x, aim.z);
    if (from >= 0 && to >= 0 && from !== to) return true;
    if (this.multimap && this.mapOptions.watermap && this.mapOptions.harbour && this.p.tribe !== 'Aje' && !a.scripted && !a.hunt && a.enemy && rnd(100) <= 10) return true;
    return false;
  },
  transportClass() {
    const D = this.D, p = this.p;
    for (const act of D.actions(p)) { const o = act.kind === 'Build' && act.results[0] && act.results[0].obj; if (!o) continue; const df = D.def(o, p); if (df && df.transportClass === 2 && D.info(o).type === 'SHIP') return o; }
    return TRANSPORTS.find((n) => D.exists(n) && n.startsWith(p.tribe.toLowerCase())) || null;
  },
  // the water off the enemy's shore nearest aim, and the landing on that shore -> {water: {x, z}} | null
  landingFor(aim) {
    const W = this.W, wn = W.waterNav;
    if (!wn) return null;
    const c = wn.nearestFree(wn.idx(aim.x, aim.z), 120);
    if (wn.block[c]) return null;
    const [x, z] = wn.center(c);
    return { water: { x, z } };
  },
  // the crossing of an attack: 'ferry' state (boarding, sailing, landing)
  startCrossing(S, a, us, aim) {
    const crossings = this.attacks.filter((x) => x.ferry && x.state === 'ferry').length;
    if (crossings >= MAX_CROSSINGS) return false;
    if (this.multimap && !this.mapOptions.harbour && this.W.landIsland(S.home.x, S.home.z) !== this.W.landIsland(aim.x, aim.z)) { a.end('no harbour'); return true; }
    const L = this.landingFor(aim);
    const cls = this.transportClass();
    if (!L || !cls) return false;
    a.ferry = { cls, land: L.water, aim, ships: [], round: 0, n: 0, t0: this.W.time, phase: 'ships' };
    a.set('ferry');
    this.ferryThink(S, a, us);
    return true;
  },
  ferryThink(S, a, us) {
    const W = this.W, F = a.ferry;
    F.n++;
    F.ships = F.ships.filter((s) => s.alive);
    const aboard = us.filter((u) => u.inside && F.ships.includes(u.inside));
    switch (F.phase) {
      case 'ships': {
        const need = Math.ceil(us.length / 10);
        for (const u of S.fleet) if (F.ships.length < need && u.name === F.cls && !this.claims.has(u) && !(u.passengers || []).length) { F.ships.push(u); this.claims.set(u, a); }
        if (F.ships.length < need && !F.ordered) {
          F.ordered = true;
          for (let i = F.ships.length; i < need; i++) { const T = this.trainable(S, F.cls); if (T && T.producer && this.armyCanPay(S, T.action.cost)) W.queueAction(T.producer, T.action); }
        }
        if (F.ships.length >= need || (F.ships.length && W.time - F.t0 > 120)) { F.phase = 'board'; F.round = 0; break; }
        if (W.time - F.t0 > 120) { this.ferryDone(a); return a.end('no transports'); }
        return;
      }
      case 'board': {
        if (F.lost) { this.ferryUnload(a); this.ferryDone(a); return a.end('transport lost'); }
        const out = us.filter((u) => !u.inside);
        if (!out.length) {
          F.phase = 'sail';
          W.order(F.ships, { type: 'move', x: F.land.x, z: F.land.z, auto: true });
          F.sailT = W.time;
          return;
        }
        if (F.n % 7 === 1) {
          if (++F.round > 7) { if (!aboard.length) { this.ferryDone(a); return a.end('boarding'); } F.phase = 'sail'; W.order(F.ships, { type: 'move', x: F.land.x, z: F.land.z, auto: true }); F.sailT = W.time; return; }
          // groups of ten per transport (WC:170-230)
          out.forEach((u, i) => { const s = F.ships[Math.floor((aboard.length + i) / 10) % F.ships.length]; if (s && W.canBoard(u, s)) W.order([u], { type: 'board', target: s, auto: true }); });
        }
        return;
      }
      case 'sail': {
        if (!F.ships.length) { const left = a.alive().filter((u) => !u.inside); if (!left.length) return a.end('dead'); a.crossed = true; return this.attackGo(S, a, left); }
        for (const s of F.ships) {
          const d = Math.hypot(s.pos.x - F.land.x, s.pos.z - F.land.z);
          if ((d < 32 || (s.task.type === 'idle' && d < 70) || W.time - F.sailT > 300) && (s.passengers || []).length) {
            if (W.shorePoint(s, 30)) W.unloadAll(s, false);
            else if (s.task.type === 'idle') W.order([s], { type: 'move', x: F.land.x + (Math.random() - 0.5) * 24, z: F.land.z + (Math.random() - 0.5) * 24, auto: true });
          }
        }
        if (F.ships.some((s) => (s.passengers || []).length)) return;
        const landed = a.alive().filter((u) => !u.inside);
        this.ferryDone(a);
        if (!landed.length) return a.end('dead');
        a.crossed = true;
        a.ferry = null;
        return this.attackGo(S, a, landed);
      }
    }
  },
  // everybody out at home (EmergencyUnboard, WC:347-377)
  ferryUnload(a) { for (const s of a.ferry.ships) if (s.alive && (s.passengers || []).length) this.W.unloadAll(s, false); },
  // the transports go back to the harbour, free again
  ferryDone(a) {
    const F = a.ferry;
    if (!F) return;
    const S = this.S || this.census();
    const h = this.harbourOf(S);
    for (const s of F.ships) { this.claims.delete(s); if (s.alive && h) this.W.order([s], { type: 'move', x: h.pos.x, z: h.pos.z, auto: true }); }
  },
  // a transport of a crossing died (readEvents)
  ferryLost(s) { for (const a of this.attacks) if (a.ferry && a.ferry.ships.includes(s) && a.ferry.phase === 'board') a.ferry.lost = true; },

  // ------------------------------------------------------------------ units left on another land (AM:140-210)
  strandedThink(S) {
    const W = this.W;
    if (!W.waterNav || !S.home) return;
    const home = W.landIsland(S.home.x, S.home.z);
    this.stranded = this.stranded || new Map();
    const far = [];
    for (const u of S.pool) {
      if (u.task.type !== 'idle' || u.inside || W.landIsland(u.pos.x, u.pos.z) === home) { this.stranded.delete(u); continue; }
      const n = (this.stranded.get(u) || 0) + 1;
      this.stranded.set(u, n);
      if (n > 10) far.push(u);
    }
    if (!far.length || this.attacks.some((a) => a.type === 'home')) return;
    const group = far.filter((u) => Math.hypot(u.pos.x - far[0].pos.x, u.pos.z - far[0].pos.z) < 128);
    const a = new Attack(this, { type: 'home', goal: 'quick', pos: S.home, hunt: true });
    this.attacks.push(a);
    this.launched.push({ id: a.id, t: Math.round(W.time), type: 'home', goal: 'quick', scripted: false, hunt: true, n: group.length });
    a.add(group);
    for (const u of group) this.stranded.delete(u);
    this.attackGo(S, a, group);
  },
};
