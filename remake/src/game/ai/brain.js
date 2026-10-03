// The computer player: a port of the original's script AI (Data/Base/Scripts/Ai; docs/spec/ai.md, docs/COMPUTER_PLAYER.md).
//
// One TribeAI ("brain") per computer player. Like the original it is a set of modules that think on their own timers
// (one tick = 0.2 s, waits depend on the difficulty 0-9):
//   control   (this file)   difficulty and its handicaps, resource gifts, behaviours, module commands, unit locks
//   economy   (economy.js)  the build list (BuildVillage), realising requests, workers, gathering, housing, storage
//   army      (army.js)     the standing army by unit mix (MinistryOfDefense), level-ups (Kindergarten), special moves
//   fight     (attack.js)   the strategist (DisturbAttack) and the running attacks (attack goals, scripted waves)
//   defense   (defense.js)  danger detection, defenders, defend mode, guard point, towers, defence areas
// The tables come from ai.json (data.js); the brain plays by the rules: it pays for everything it builds, except
// what the original gives it for free (gifts and handicaps by difficulty, scripted waves of campaign triggers).
//
// Enemies are whoever `player.isEnemy(other)` says among `world.players` - up to 8 players, any relations.
import * as DATA from './data.js';
import { TICK, MENU_LEVELS } from './data.js';
import { Economy } from './economy.js';
import { Army } from './army.js';
import { Fight } from './attack.js';
import { Defense } from './defense.js';

const rnd = (n) => Math.floor(Math.random() * n);
const urlParam = (k) => { try { return new URLSearchParams(location.search).get(k); } catch (e) { return null; } };
const NOT_ARMY = /resource_collector|_cart$|trade_dino|hovercraft|transport|tracker_dino|kennel_eusmilus|fishing_boat/;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// module settings before any behaviour command
const PRM = { aggressiveness: 100, riskiness: 100, upgrade_walls: 0, upgrade_towers: 1, close_start_location: 0, attacks_risk_level: 1, guard_village: 1, army: null,
  highDefense: false, cancelAttacksRadius: -1, maxAge: 5 };

export class TribeAI {
  // new TribeAI(G, player, { difficulty = 5, behaviour = 'Mikrobe', mapOptions = {}, multimap = false, levelName })
  // legacy (skirmish): new TribeAI(G, player, enemyPlayer, 'easy' | 'normal' | 'hard' | 0..9)
  constructor(G, player, a, b) {
    this.G = G; this.W = G.world; this.D = G.data; this.p = player;
    if (G.aiData !== undefined) DATA.setAiData(urlParam('noaidata') !== null ? null : G.aiData);
    let o = a && typeof a === 'object' && !a.res ? a : null;
    if (!o) {
      // skirmish: the menu's easy / normal / hard, a random personality (ServerApp "ai_Random": Dodo, Giraffe or
      // Schnecke). Tests choose with ?aib=Dodo,Giraffe (by player id) and ?aid=4
      const pick = (v) => { if (v == null) return null; const l = String(v).split(','); return l[Math.min(player.id, l.length - 1)]; };
      const ud = pick(urlParam('aid'));
      o = { difficulty: ud != null && ud !== '' ? +ud : typeof b === 'number' ? b : MENU_LEVELS[b] ?? MENU_LEVELS.normal,
        behaviour: pick(urlParam('aib')) || ['Dodo', 'Giraffe', 'Schnecke'][rnd(3)], multimap: true,
        mapOptions: { harbour: !!this.W.waterNav, watermap: false, walls: false, markplace_outpost: false, warpgate: !!(this.W.rules && this.W.rules.warpgate), hunt_animals: true } };
    }
    this.multimap = !!o.multimap;
    this.mapOptions = { walls: false, markplace_outpost: false, harbour: false, warpgate: false, hunt_animals: false, watermap: false, ...(o.mapOptions || {}) };
    this.levelName = o.levelName || null;      // 'Single 04' ...: level-specific rows of the attack plan (optional)
    // state
    this.locked = new Set();                   // AILU: units the AI must not touch
    this.claims = new Map();                   // unit -> the attack / defence area that holds it
    this.attacks = [];                         // running attacks (attack.js Attack)
    this.launched = [];                        // log of every attack started: { t, type, n, scripted } (tests, statistics)
    this.areas = new Map();                    // AIDA: id -> { x, z, r, max, units:Set }
    this.regions = new Map();                  // AIRG: map name -> [{ region, value }]
    this.requests = [];                        // build list in realisation (economy.js)
    this.S = null;                             // census
    this.next = {};
    this.wait = {};
    this.attackSeq = 0;
    this.start = null;                         // the start location (fixed once the base is known)
    // what a brain that was never woken is (a sleeping campaign player can still be given waves and areas)
    this.prm = { ...PRM };
    this.letter = 'G'; this.tactic = 1; this.village = null; this.personality = 'Giraffe';
    this.economyOff = false; this.kindergarten = false; this.paused = true;
    this.setDifficulty(o.difficulty ?? 5);
    this.setBehaviour(o.behaviour || 'Mikrobe');
  }
  // legacy fields of the old AI (tests/sim.js)
  get attacking() { return this.attacks.some((a) => a.state === 'walk' || a.state === 'fight'); }
  get waves() { return this.launched.length; }

  // ------------------------------------------------------------------ difficulty (CM:159-187, §3)
  setDifficulty(d) {
    d = clamp(Math.round(+d || 0), 0, 9);
    const lv = this.lv = DATA.level(d);
    this.d = d; this.cls = lv.class;
    const W = lv.wait, r7 = 1 + rnd(7);
    // think waits in seconds (§1.2)
    this.wait = {
      control: (lv.controlWait + r7) * TICK,
      eco: ((this.cls === 'Easy' ? 30 : this.cls === 'Medium' ? 10 : 1) + r7) * TICK,
      build: Math.max(1, W) * TICK,
      collect: 0.6,
      fight: (W + r7) * TICK,
      strat: () => (W + 20 + rnd(20)) * TICK,
      mod: (5 + r7) * TICK,
      atk: Math.min(5, (W + 2) * TICK),          // the goal thinks every W + r ticks; orders are refreshed at most every 5 s
      defense: Math.min(4, (W + r7) * TICK),
      guard: (10 + r7) * TICK,
      kinder: DATA.kindergartenWait(this.cls),
      moves: 1.5,
    };
    const u = lv.unitLimit || { levels: [0, 0, 0, 0, 0], total: 0 };
    const old = this.p.aiMods || {};
    // research: Action.usl tests the path for "Actions/Upgrades/", which a tech tree path ("/Actions/<Tribe>/Upgrades/")
    // never contains - so the build factor applies to upgrades too (and nothing to age_2)
    this.p.aiMods = { gather: lv.gather || 1, buildTime: lv.buildTime || 1, researchTime: lv.buildTime || 1, weaponTime: lv.weaponDuration || 1,
      attack: old.attack || 1, defense: old.defense || 1, pyramid: u.levels.some((v) => v > 0) ? u.levels.slice() : null, unitLimit: u.total || 0 };
    if (this.W.recomputeCaps) this.W.recomputeCaps(this.p);
    const now = this.W.time;
    for (const k in this.wait) if (this.next[k] === undefined) this.next[k] = now + 0.5 + Math.random() * 2;
    this.next.strat = Math.max(this.next.strat, now + this.wait.strat());
  }

  // ------------------------------------------------------------------ behaviours (CM:285-552, §2)
  // AIBV: setBehaviour('Dodo' | 'Giraffe' | 'Schnecke' | 'Turtle' | 'FightOnly' | 'Mikrobe' | 'Singleplayer_L3_1' ...)
  // or a module command: setBehaviour('upgrade_walls 1', 'DFNS')
  setBehaviour(name, module = 'CTRL') {
    if (module && module !== 'CTRL') return this.command(module, name);
    const cfg = DATA.behaviour(name);
    if (!cfg) return false;
    this.behaviour = name;
    this.cfg = cfg;
    this.paused = !!cfg.paused;
    if (this.paused) return true;                     // Mikrobe: SetPaused(true), nothing else changes
    this.economyOff = !!cfg.economyOff;
    this.kindergarten = cfg.kindergarten !== false;
    this.personality = cfg.personality || name;       // Dodo | Giraffe | Schnecke | Turtle (fight factors, pest patrol)
    const n = 1 + rnd(cfg.variants || 1);
    const sub = String(cfg.subStrategy || 'G1').replace('{n}', n);
    const fill = (s) => String(s).replace('{sub}', sub).replace('{n}', n);
    const P = cfg.params || {};
    // defaults of a module that gets no command, then the behaviour's commands
    this.prm = { ...PRM };
    this.village = null;
    for (const k in P) this.command(null, k + (P[k] === true ? '' : ' ' + fill(P[k])));
    if (!P.tactics) this.setTactics(sub);
    if (cfg.brainWash) this.brainWash();
    return true;
  }
  setTactics(t) { t = String(t); if (t.length === 2) { this.letter = t[0]; this.tactic = +t[1] || 1; this.plan = null; } }
  // the engine's BrainWash: forget what was going on (requests, the plan's attacks; scripted waves go on)
  brainWash() {
    this.requests = [];
    this.buildList = null;
    for (const a of this.attacks.slice()) if (!a.scripted) a.end('brainwash');
    this.plan = null;
    this.scouted = false;
    this.firstAttack = 0;
  }
  // module command strings (the modules' SetBehavior / Call): ECON | FGHT | DFNS | AREA, or null = find the module
  command(module, cmd) {
    const t = String(cmd).trim().split(/\s+/);
    const v = t[1], num = parseFloat(v);
    const P = this.prm || (this.prm = {});
    switch (t[0]) {
      // economy (EM:450)
      case 'village_level': if (v === 'Deactivate') this.economyOff = true; else { this.village = v.length >= 2 ? v.slice(0, 2) : v + '1'; this.buildList = null; } return true;
      case 'max_age': P.maxAge = clamp(num || 5, 1, 5); return true;
      case 'disable_collect_resources': P.noCollect = true; return true;
      case 'reset_buildings': case 'forbid_building': case 'enable_user_interaction': return true;
      // fight (FM:132)
      case 'enable': return true;
      case 'disable': P.noFight = true; return true;
      case 'aggressiveness': P.aggressiveness = clamp(num, 0, 100); return true;
      case 'riskiness': P.riskiness = clamp(num, 0, 100); return true;
      case 'tactics': this.setTactics(v); return true;
      case 'EnableDisturbAttack': P.noFight = false; return true;
      // defense (DM:441, 608)
      case 'upgrade_walls': P.upgrade_walls = num; return true;
      case 'upgrade_towers': P.upgrade_towers = num; return true;
      case 'close_start_location': P.close_start_location = num; return true;
      case 'attacks_risk_level': P.attacks_risk_level = num; return true;
      case 'guard_village': P.guard_village = num; return true;
      case 'army': P.army = v || null; return true;
      case 'defend_place': { const c = String(v || '').split(/[_ ,]+/).map(Number); if (c.length >= 2 && Number.isFinite(c[0])) this.guardBase = this.mapToGame(c[0], c[1]); return true; }
      case 'AddDefenseArea': { const c = String(t[2] || '').replace(/[[\]{}]/g, '').split(/[_ ,]+/).map(Number); const g = this.mapToGame(c[0], c[1]); this.setDefenceArea(t[1], g, parseFloat(t[3]), parseInt(t[4], 10)); return true; }
      case 'HighDefenseMode': P.highDefense = v === 'true'; return true;
      case 'CancelAttacksInDefense': P.cancelAttacksRadius = num; return true;
      case 'deactivate_towers': P.upgrade_towers = 0; P.noTowers = true; return true;
      case 'deactivate_walls': P.upgrade_walls = 0; return true;
      case 'deactivate_unit_defence': P.noDefence = true; return true;
      case 'village_wall': P.villageWall = t.slice(1).join(' '); return true;       // stored: the AI builds no walls (COMPUTER_PLAYER.md)
    }
    return false;
  }
  // AICM {player_id, module, command}
  callModule(module, command) { return this.command(module, command); }
  // script positions are map coordinates (x east, y north); the game's are x = mapX - W/2, z = H/2 - mapY
  mapToGame(mx, my) { const s = this.W.size || 0; return { x: mx - s / 2, z: s / 2 - my }; }

  // ------------------------------------------------------------------ AILU / AIRG
  // externally locked units are never pooled, allocated or given orders by the AI
  lockUnits(units, lock = true) {
    for (const u of units || []) {
      if (!u) continue;
      if (lock) { this.locked.add(u); const c = this.claims.get(u); if (c && c.drop) c.drop(u); this.claims.delete(u); } else this.locked.delete(u);
    }
    this.S = null;
  }
  // region: { contains(x, z) } | { x0, z0, x1, z1 } | { x, z, r } | null (= the whole map)
  setRegionMap(mapName, region, value, add = true) {
    const l = this.regions.get(mapName) || [];
    if (!add) l.length = 0;
    l.push({ region, value: +value || 0 });
    this.regions.set(mapName, l);
  }
  regionValue(mapName, x, z) {
    let v = 0;
    for (const e of this.regions.get(mapName) || []) {
      const r = e.region;
      const inside = !r ? true : r.contains ? r.contains(x, z) : r.r !== undefined ? Math.hypot(x - r.x, z - r.z) <= r.r : x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
      if (inside) v += e.value;
    }
    return v;
  }

  // ------------------------------------------------------------------ census (what the brain owns right now)
  census(force) {
    const W = this.W, p = this.p, now = W.time;
    if (!force && this.S && now - this.S.t < 0.35) return this.S;
    const S = { t: now, units: [], blds: [], workers: [], idle: [], fighters: [], pool: [], fleet: [], heroes: [], count: new Map(), base: null, home: null, age: p.epoch() };
    const inc = (n) => S.count.set(n, (S.count.get(n) || 0) + 1);
    for (const b of W.buildings) if (b.alive && b.owner === p) { S.blds.push(b); inc(b.name); }
    for (const u of W.units) {
      if (!u.alive || u.owner !== p || u.autonomous || u.illusion) continue;
      S.units.push(u); inc(u.name);
      if (this.locked.has(u)) continue;
      if (u.naval) { if (!u.stationary) S.fleet.push(u); continue; }
      if (u.isWorker) { S.workers.push(u); if (u.task.type === 'idle' && !u.inside) S.idle.push(u); continue; }
      if (u.def.unique) S.heroes.push(u);
      if (u.cannotFight || u.stationary || u.isDropoff || NOT_ARMY.test(u.name)) continue;
      S.fighters.push(u);
      // (a unit that would not march with its squad is left out of the pool for five minutes)
      if (!u.inside && !this.claims.has(u) && !(u.aiStuckT && now - u.aiStuckT < 300)) S.pool.push(u);
    }
    for (const [u, c] of this.claims) if (!u.alive || u.owner !== p) { this.claims.delete(u); if (c && c.drop) c.drop(u); }
    S.base = S.blds.find((b) => b.def.script === 'CFireplace' && b.built) || S.units.find((u) => u.name === 'aje_resource_collector') || S.blds.find((b) => b.built && b.isDropoff)
      || S.blds.find((b) => b.built) || S.blds[0] || S.units[0] || null;
    if (S.base && !this.start) this.start = { x: S.base.pos.x, z: S.base.pos.z };
    S.home = S.base && S.base.kind === 'building' ? { x: S.base.pos.x, z: S.base.pos.z } : this.start || (S.base ? { x: S.base.pos.x, z: S.base.pos.z } : null);
    this.S = S;
    return S;
  }
  // ------------------------------------------------------------------ helpers shared by the modules
  enemies() { const p = this.p; return this.W.players.filter((o) => o !== p && !o.defeated && p.isEnemy(o)); }
  isEnemyEntity(e) { return !!(e && e.alive && e.owner && e.owner !== this.p && this.p.isEnemy(e.owner)); }
  acts(e) { return this.D.actionsOf(e.rulesOwner(), e); }
  // level score of units as the scripts count it (CompareLevel, CheckUnitLevel): the 1-based level, heroes + 2
  score(units) { let s = 0; for (const u of units) if (u.alive && u.kind === 'unit' && !u.isWorker) s += u.level + (u.def.unique ? 2 : 0); return s; }
  // where a player's village is: its main building, else the centre of its buildings, else any unit
  baseOf(o) {
    const W = this.W;
    let n = 0, x = 0, z = 0, main = null;
    for (const b of W.buildings) { if (!b.alive || b.owner !== o) continue; if (b.def.script === 'CFireplace' || b.def.script === 'CHeadquarters') main = main || b; if (!b.def.wallKind) { n++; x += b.pos.x; z += b.pos.z; } }
    if (main) return { x: main.pos.x, z: main.pos.z };
    if (n) return { x: x / n, z: z / n };
    const u = W.units.find((e) => e.alive && e.owner === o && !e.inside);
    return u ? { x: u.pos.x, z: u.pos.z } : null;
  }
  claim(units, owner) { for (const u of units) this.claims.set(u, owner); this.S = null; }
  release(units) { for (const u of units) this.claims.delete(u); this.S = null; }
  // context of table conditions (data.js matches / when)
  ctx() {
    const S = this.S || this.census(), M = this.mapOptions;
    return { tribe: this.p.tribe, letter: (this.village || this.letter + '1')[0], age: S.age, d: this.d, cls: this.cls, multimap: this.multimap, levelName: this.levelName, player: this.p.id,
      tactic: this.tactic, harbour: !!M.harbour && !!this.W.waterNav, watermap: !!M.watermap && !!this.W.waterNav, warpgate: !!M.warpgate,
      ownWarpgate: S.blds.some((b) => b.def.script === 'CWarpGate'), has: (c) => (S.count.get(c) || 0) > 0 };
  }

  // ------------------------------------------------------------------ the control think (CM:556-613, CH)
  controlThink() {
    const p = this.p, lv = this.lv;
    // gifts: every control think, not on the arena map (multi_arena_001)
    if (!/multi_arena_001/i.test(this.levelName || '')) {
      const g = DATA.gift(this.d, this.multimap);
      // SpawnResources is engine code; taken to fill the stores like any income (AddResource), not to overflow them
      for (const r in g) if (g[r]) p.res[r] = r === 'skulls' ? p.res[r] + g[r] : Math.max(p.res[r], Math.min(p.caps[r], p.res[r] + g[r]));
    }
    // fight factors from difficulty 5 (CH:1086-1169): damage dealt / taken by this player's units
    const m = p.aiMods;
    if (m) {
      let atk = 1, def = 1;
      if (this.d >= 5) {
        const a = (this.W.size || 512) / 16;            // AI map size in areas
        const mapV = clamp((((a - 16) / 8) * ((a - 16) / 8) - 1) / 20 + 0.3, 0.2, 0.6);
        def = clamp(1 - mapV * this.d * 0.2, 0.5, 2);
        atk = clamp(1 + mapV * this.d * 0.2 * 0.5, 0.5, 2);
        const k = this.personality === 'Dodo' ? [0.30, 0.05] : this.personality === 'Giraffe' ? [0.15, 0.15] : [0.03, 0.30];   // fog of war on
        def = 1 + (def - 1) * k[0]; atk = 1 + (atk - 1) * k[1];
      }
      const step = (cur, to) => clamp(to, cur - 0.05, cur + 0.025);
      m.attack = step(m.attack || 1, atk); m.defense = step(m.defense || 1, def);
    }
    // free epoch catch-up (BV:1326-1363): from difficulty 6 on skirmish maps, when a human enemy is an epoch ahead
    if (this.d >= 6 && this.multimap && !this.economyOff) {
      const S = this.census(), mine = S.age;
      const ahead = this.W.players.some((o) => o !== p && !o.ai && !o.defeated && o.epoch() > mine);
      if (ahead && mine < 5 && this.freeAge !== mine + 1 && S.base && S.base.queue && !S.base.queue.some((q) => /^age_/.test(q.action.id))) {
        const a = this.acts(S.base).find((x) => x.id === 'age_' + (mine + 1));
        if (a) { this.freeAge = mine + 1; S.base.queue.push({ action: a, t: 0, total: this.W.productionTime(a, p), level: 0 }); }   // " /AI_Help": no check, no cost
      }
    }
    void lv;
  }

  // ------------------------------------------------------------------ main loop
  update(dt) {
    const p = this.p, W = this.W;
    if (p.defeated) return;
    const now = W.time, N = this.next, Wt = this.wait;
    // running attacks (scripted waves also while the brain sleeps)
    if (this.attacks.length && now >= N.atk) { N.atk = now + Wt.atk; if (this.census().base) this.attacksThink(); }
    if (this.paused) return;
    this.readEvents();
    if (now >= N.control) { N.control = now + Wt.control; this.controlThink(); }
    let S = null;
    const cs = () => S || (S = this.census());
    if (!this.economyOff) {
      if (now >= N.build) { N.build = now + Wt.build; if (cs().base) this.buildThink(S); }
      if (now >= N.eco) { N.eco = now + Wt.eco; if (cs().base) this.economyThink(S); }
      if (now >= N.collect) { N.collect = now + Wt.collect; if (cs().base) this.collectThink(S); }
    }
    if (now >= N.defense) { N.defense = now + Wt.defense; if (cs().base) this.defenseThink(S); }
    if (now >= N.guard) { N.guard = now + Wt.guard; if (cs().base) this.guardThink(S); }
    if (now >= N.mod) { N.mod = now + Wt.mod; if (cs().base) this.armyThink(S); }
    if (now >= N.fight) { N.fight = now + Wt.fight; if (cs().base) this.xtraThink(S); }
    if (now >= N.strat) { N.strat = now + Wt.strat(); if (cs().base) this.strategyThink(S); }
    if (now >= N.kinder) { N.kinder = now + Math.max(2, Wt.kinder); if (cs().base) this.kindergartenThink(S); }
    if (now >= N.moves) { N.moves = now + Wt.moves; this.movesThink(cs()); }
  }
}
Object.assign(TribeAI.prototype, Economy, Army, Fight, Defense);
