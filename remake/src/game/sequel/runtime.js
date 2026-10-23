// The sequel campaign at run time (docs/SEQUEL.md): G.sequel. It sets up a mission's players and start, runs its
// script (game/sequel/missions.js) and the sequel's own rules: rifts that spawn dinosaurs until a stabilizer seals
// them, civilians to evacuate, tranquilizers and capture trucks, night, command powers, objectives and the radio.
//
// A mission's state is data (saved games: game/save.js keeps the fields of SAVED); its code is in the mission
// definition, called by name: def.on[name](M, args) for timers (M.after) and events.
//
// The same runtime plays the scenarios (game/scenarios/missions.js, docs/SCENARIOS.md: cfg.scenario, kind
// 'scenario'): standalone missions in ParaWorld's own world, with the game's normal rules and data, played as any of
// the four tribes (cfg.tribe; M.tribe). Their definitions are made for the chosen tribe (def.make(tribe, difficulty))
// and may have other computer players: roles foe, foe2 and ally ({tribe, name, color, behaviour | ai: false}).
import * as THREE from 'three';
import { Player } from '../player.js';
import { MISSIONS, migrateSettings } from './missions.js';
import { SCENARIOS, SCENARIO_TRIBES, TRIBE_NAMES } from '../scenarios/missions.js';
import { CAST } from './cast.js';
import { sequelSource, roadMeshes } from './maps.js';
import { tagsOf, SEQUEL_CLASSES, SEQUEL_HEROES } from './rules.js';
import { SEQUEL_TEXTS } from './texts.js';
import { Grid, isPlant, isPole } from './power.js';
import { applyFow } from '../../engine/terrain.js';

export const SAVED = ['id', 'difficulty', 'time', 'state', 'objectives', 'timers', 'lines', 'said', 'rifts', 'zones', 'cp', 'cpEarned', 'powerReady', 'counters', 'passiveT',
  'started', 'ended', 'roles', 'nightOn', 'cargo', 'markers', 'evAt', 'plantSpots', 'raidT', 'civT', 'pieces'];
// how close to a rift a stabilizer must stand (centre to centre; the texts say 30 m)
export const RIFT_RANGE = 32;
// how long the "Tranquilized" debuff of a dart lasts (seconds; every dart starts it again)
export const TRANQ_SEC = 30;
// command powers: cost in command points, cooldown, what it does (Sequel.usePower)
export const POWERS = {
  recon: { name: 'Recon flight', cost: 2, cool: 40, target: true, text: 'Kiko flies over the area: it is revealed for 40 seconds.' },
  supply: { name: 'Supply drop', cost: 2, cool: 45, target: false, text: '+150 food, wood and stone.' },
  airdrop: { name: 'Airdrop', cost: 4, cool: 60, target: true, text: 'Four containment troopers parachute in.' },
  artillery: { name: 'Artillery', cost: 5, cool: 75, target: true, text: 'A barrage hits the area after 3 seconds.' },
};
const ROLE_IDS = { me: 0, outbreak: 1, civilians: 2, crane: 3, aje: 4, foe: 5, foe2: 6, ally: 7 };
const ROLE_LOOK = {
  me: { name: 'SEAS', color: 0x3a6ea8, party: 0x5a8ed8, team: 0 },
  outbreak: { name: 'The Outbreak', color: 0x9a3a20, party: null, team: 1 },
  civilians: { name: 'Civilians', color: 0xc8c0a0, party: null, team: 0 },
  crane: { name: 'Crane Industrial', color: 0x6a6a6a, party: 0x303030, team: 2 },
  aje: { name: 'Dustriders', color: 0xb07830, party: 0xd09040, team: 3 },
  // (the scenarios' other tribes; a def's role gives its tribe, name and colour)
  foe: { name: 'The Enemy', color: 0x9a2a2a, party: 0xc84040, team: 4 },
  foe2: { name: 'The Rivals', color: 0x6a3a9a, party: 0x8a5ac8, team: 5 },
  ally: { name: 'Allies', color: 0x3a9a5a, party: 0x5ac87a, team: 0 },
};
const EXTRA_ROLES = ['crane', 'aje', 'foe', 'foe2', 'ally'];

export class Sequel {
  constructor(G, cfg) {
    this.G = G;
    this.difficulty = cfg.difficulty == null ? 1 : +cfg.difficulty;
    this.kind = cfg.scenario != null ? 'scenario' : 'sequel';
    if (this.kind === 'scenario') {
      // a scenario: its definition made for the tribe played (the same again when a saved game is loaded)
      this.id = +cfg.scenario;
      this.tribe = SCENARIO_TRIBES.includes(cfg.tribe) ? cfg.tribe : SCENARIO_TRIBES[0];
      const sc = SCENARIOS.find((m) => m.id === this.id) || SCENARIOS[0];
      this.def = { ...sc, ...(sc.make ? sc.make(this.tribe, this.difficulty) : {}) };
    } else {
      this.id = +cfg.sequel;
      this.tribe = 'SEAS';
      this.def = MISSIONS.find((m) => m.id === this.id) || MISSIONS[0];
    }
    this.time = 0;
    this.state = {};                 // the mission's own data (missions.js)
    this.objectives = [];            // {id, text, done, failed, count, of, secondary, hidden}
    this.timers = [];                // [time, name, args]
    this.lines = [];                 // radio lines waiting: {who, text}
    this.said = [];                  // what was said (the log)
    this.rifts = [];                 // {id, e (the rift building), every, next, waves, wave, seal, sealTime, open, cap, target}
    this.zones = {};                 // name -> {x, z, r, kind}
    this.cp = 0; this.cpEarned = 0;  // command points
    this.powerReady = {};            // power -> game time it is ready again
    this.counters = {};              // evacuated, captured, lost civilians ...
    this.cargo = [];                 // [truck, dinosaur] being hauled
    this.markers = [];               // {x, z, color, label, until}
    this.pieces = [];                // the scene's moving set pieces (ui/sequel_ui.js draws them): see piece()
    this.started = false;            // the briefing was read
    this.ended = null;
    this.roles = {};                 // role -> player id
    this.nightOn = !!this.def.night;
    this.evAt = 0;
    this.diff = [0.75, 1, 1.35][this.difficulty] || 1;     // strength of the outbreak
    this.plantSpots = [];            // the maps' generating stations: [x, z, rot] (source -> build: abandoned plants)
    this.raidT = 150;                // the next raid of the outbreak on the power lines
    this.grid = new Grid(this);      // electricity (power.js; worked out again every step, not saved)
  }
  get W() { return this.G.world; }
  get me() { return this.G.me; }
  player(role) { const id = this.roles[role]; return id == null ? null : this.W.players.find((p) => p.id === id) || null; }

  // ---------------------------------------------------------------- set-up
  source() {
    // nothing grows where the mission puts its own things: the base, zones (and the rifts and sites of map.clear)
    const d = this.def, clear = [...(d.map.clear || []), ...(d.start.buildings || []).map(([, x, z]) => [x, z, 24]), ...(d.zones || []).map((z) => [z.x, z.z, z.r + 4])];
    const S = sequelSource({ ...d.map, clear, name: d.title }, this.G.data);
    // the generating stations of the map are buildings, not decoration: abandoned plants SEAS can take over
    this.plantSpots = S.decor.filter((x) => x.model === 'sq_power_station').map((x) => [x.x, x.z, x.rot || 0]);
    S.decor = S.decor.filter((x) => x.model !== 'sq_power_station');
    return S;
  }
  // the tribes whose models load (a scenario: all four - its script may put down anybody's units)
  tribes() { return this.kind === 'scenario' ? [...SCENARIO_TRIBES] : ['SEAS', ...(this.def.tribes || [])]; }
  // models the mission needs besides its map's: its machines, civilians, creatures
  models() {
    const out = new Set(['sq_pen', 'sq_windmill_rotor', 'sq_waterwheel', 'sq_searchlamp', 'aje_warpgate']);     // (the warp gate: the rifts' vortex, ui/sequel_ui.js)
    const D = this.G.data;
    for (const c of Object.keys(SEQUEL_CLASSES)) for (let l = 1; l <= 5; l++) { const s = D.stats(c, l, null); if (s && s.gfx) out.add(s.gfx.toLowerCase()); }
    for (const c of [...(this.def.creatures || []), 'Velociraptor', 'Deinonychus', 'Allosaurus']) {
      for (let l = 1; l <= 5; l++) { const s = D.stats(c, l, null); if (s && s.gfx) out.add(s.gfx.toLowerCase()); }
    }
    // the heroes, and classes of the original a mission places by script (def.models)
    for (const h of [...Object.keys(SEQUEL_HEROES), ...(this.def.models || [])]) { const s = D.stats(h, 1, null); if (s && s.gfx) out.add(s.gfx.toLowerCase()); }
    // the set pieces' models (def.pieces, and those the script brings in later: def.props)
    for (const m of [...(this.def.pieces || []).map((o) => o.model), ...(this.def.props || [])]) out.add(m);
    return out;
  }
  build(W, S) {
    const G = this.G, D = G.data, def = this.def;
    const roles = ['me', 'outbreak', 'civilians', ...EXTRA_ROLES.filter((r) => def[r])];
    W.players = roles.map((r) => {
      const o = { ...(typeof def[r] === 'object' ? def[r] : {}), ...((def.looks || {})[r] || {}) };      // (looks: other names for the standing roles)
      const L = { ...ROLE_LOOK[r], ...(r === 'me' && this.kind === 'scenario' ? { name: TRIBE_NAMES[this.tribe] } : {}), ...(o.name ? { name: o.name } : {}), ...(o.color != null ? { color: o.color, party: o.party ?? o.color } : {}) };
      const tribe = r === 'me' ? this.tribe : r === 'aje' ? 'Aje' : o.tribe || 'SEAS';
      const p = new Player(ROLE_IDS[r], tribe, { ai: r !== 'me', name: L.name, color: L.color, partyColor: L.party, team: L.team, rules: D });
      this.roles[r] = p.id;
      return p;
    });
    const me = W.players[0];
    me.debug = !!G.config.debug;
    Object.assign(me.res, def.res || { food: 400, wood: 400, stone: 300 });
    me.popMax = def.popMax || 52;
    // the civilians and the outbreak need no economy; everybody fights the outbreak
    for (const p of W.players) if (p !== me) Object.assign(p.res, { food: 5000, wood: 5000, stone: 5000 });
    // (a scenario's computer players may start with less: def.<role>.res)
    for (const r of EXTRA_ROLES) { const o = def[r], p = this.player(r); if (p && o && o.res) Object.assign(p.res, o.res); }
    if (def.aje && def.ajeFriendly) { const a = this.player('aje'); a.setRelation(me, 2); me.setRelation(a, 2); }
    // a scenario's other tribes may start at peace with the player (neutral: 1) - the script changes it
    for (const r of EXTRA_ROLES) { const o = def[r], p = this.player(r); if (p && o && o.relation != null) { p.setRelation(me, o.relation); me.setRelation(p, o.relation); } }
    // the roads on the ground
    const roads = roadMeshes(S, G.hf, applyFow);
    G.scene.add(roads);
    // the start
    for (const z of def.zones || []) this.zones[z.name] = { ...z };
    for (const [cls, x, z, rot] of def.start.buildings || []) { const b = W.placeAdapted(this.cls(cls), me, x, z, rot || 0, true); if (b) W.recomputeCaps(me); }
    // the epoch it starts in (the user: from mission 4 on epoch 2, from mission 7 on epoch 3; def.epoch overrides)
    const epoch = def.epoch ?? (this.kind === 'scenario' ? 1 : def.id >= 7 ? 3 : def.id >= 4 ? 2 : 1);
    const hq = this.home(me);
    for (let k = 2; hq && k <= epoch; k++) { const a = W.data.actions(me).find((x) => x.kind === 'Upgrades' && x.id === 'age_' + k); if (a) W.completeUpgrade(hq, a); }
    for (const [cls, x, z, n, lv] of def.start.units || []) this.spawn(cls, 'me', x, z, n || 1, { level: lv });
    W.recomputeCaps(me);
    this.startWork(me);
    if (this.nightOn) this.setNight(true);
    for (const o of def.pieces || []) this.piece(o.id, o.model, o.x, o.z, o.y, o.rot, o);
    this.call('setup');
    if ((def.unlocks || []).some((u) => !Array.isArray(u))) this.after(8, '_intro');     // what the mission brings in
    // the map's stations the mission did not place itself stand abandoned (the civilians' until SEAS gets there)
    const civ = this.player('civilians');
    for (const [x, z, rot] of this.plantSpots) {
      if (W.buildings.some((b) => b.alive && isPlant(b) && Math.hypot(b.pos.x - x, b.pos.z - z) < 20)) continue;
      W.placeAdapted('sq_power_station', civ, x, z, rot, true);
    }
    return me;
  }
  // the starting workers go to work at once (the user's wish), spread evenly over food, wood and stone - the nearest
  // source of each to the headquarters; a kind the map has none of near the base goes to the next kind
  // a player's main building (SEAS' headquarters, the Norsemen's and the Dragon Clan's fireplace) or the Dustriders'
  // resource collector (a unit): D.start's base
  home(p) {
    const W = this.W, base = (W.data.start(p.tribe) || {}).base || 'seas_headquarters';
    return W.buildings.find((b) => b.alive && b.owner === p && b.name === base) || W.units.find((u) => u.alive && u.owner === p && u.name === base) || null;
  }
  startWork(me) {
    const W = this.W, hq = this.home(me);
    const ws = W.units.filter((u) => u.alive && u.owner === me && u.isWorker);
    const at = hq ? hq.pos : ws[0] && ws[0].pos;
    if (!at) return;
    const RES = ['food', 'wood', 'stone'], src = {};
    for (const r of RES) src[r] = W.nearestResource(at.x, at.z, r, 120);
    const have = RES.filter((r) => src[r]);
    if (!have.length) return;
    ws.forEach((w, i) => W.order([w], { type: 'gather', target: src[have[i % have.length]] }));
  }
  // the computer players' brains (Crane, the Dustriders): campaign brains woken by the mission (missions.js)
  brains(TribeAI) {
    const out = new Map();
    for (const r of EXTRA_ROLES) {
      const p = this.player(r);
      if (!p || !this.def[r] || this.def[r].ai === false) continue;        // (ai false: only the mission's script moves them)
      const o = this.def[r] === true ? {} : this.def[r];
      out.set(p.id, new TribeAI(this.G, p, { difficulty: o.difficulty ?? [2, 5, 8][this.difficulty], behaviour: o.behaviour || 'Mikrobe', mapOptions: {}, multimap: false }));
    }
    return out;
  }
  camera() { return this.def.camera || (this.def.start.units && this.def.start.units[0] ? [this.def.start.units[0][1], this.def.start.units[0][2]] : [0, 0]); }

  // ---------------------------------------------------------------- the script
  call(name, args) {
    if (name === '_barrage') return this.barrage(args);           // (the runtime's own timers)
    if (name === '_intro') { for (const u of this.def.unlocks || []) if (!Array.isArray(u)) this.introduce(u); return undefined; }
    const fn = this.def.on && this.def.on[name];
    if (!fn) return undefined;
    try { return fn(this, args || {}); } catch (e) { console.error(`${this.kind} mission ${this.id}: ${name}`, e); return undefined; }
  }
  after(sec, name, args = {}) { this.timers.push([this.time + sec, name, args]); }
  say(who, text) { this.lines.push({ who, text }); }
  objective(id, text, opts = {}) {
    let o = this.objectives.find((x) => x.id === id);
    // civ: townsfolk to bring somewhere - the line shows how many were lost and how many are still out (civilianTick)
    if (!o) { o = { id, text, done: false, failed: false, count: 0, of: opts.of || 0, secondary: !!opts.secondary, civ: !!opts.civ, note: '' }; this.objectives.push(o); this.notify(`New objective: ${text}`); }
    else Object.assign(o, { text, of: opts.of ?? o.of });
    return o;
  }
  progress(id, count) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.done || o.failed) return;
    o.count = Math.min(count, o.of || count);
    if (o.of && o.count >= o.of) this.complete(id);
  }
  complete(id) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.done || o.failed) return;
    o.done = true;
    this.grant(o.secondary ? 2 : 3);
    this.notify(`Objective complete: ${o.text}`, 'good');
    this.call('done_' + id);
  }
  fail(id) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.done || o.failed) return;
    o.failed = true;
    this.notify(`Objective failed: ${o.text}`, 'bad');
    if (!o.secondary) this.lose(this.def.loseText || o.text);
  }
  isDone(id) { const o = this.objectives.find((x) => x.id === id); return !!o && o.done; }
  notify(text, kind) { if (this.G.hud) this.G.hud.message(text, kind); }
  // a unit or building the mission brings in (missions.js unlocks): on the radio, what it does (texts.js intro), and
  // a notice where it is built; quiet: the script has said it already
  introduce(name, quiet = false) {
    const t = SEQUEL_TEXTS[name] || {}, spec = SEQUEL_CLASSES[name] || {};
    if (!quiet && t.intro) this.say(t.intro[0], t.intro[1]);
    this.notify(`New: ${spec.desc || name} - ${t.where || 'in the build menu'}`, 'good');
  }
  grant(n) { this.cp += n; this.cpEarned += n; }
  mark(x, z, label, color = 0xffd040, sec = 1e9) { this.markers.push({ x, z, label, color, until: this.time + sec }); }
  unmark(label) { this.markers = this.markers.filter((m) => m.label !== label); }
  win(text) {
    if (this.ended) return;
    this.ended = { won: true, t: this.time };
    this.unlockNext();
    if (this.G.endMission) this.G.endMission(true, { text: text || this.def.winText || '', delay: 4 });
  }
  lose(text) {
    if (this.ended) return;
    this.ended = { won: false, t: this.time };
    if (this.G.endMission) this.G.endMission(false, { text: text || '', delay: 3 });
  }
  unlockNext() {
    const s = this.G.settings;
    if (!s) return;
    if (this.kind === 'scenario') {
      // the scenarios are all open; the menu marks which tribes won each
      s.scenario = s.scenario || { mission: this.id, tribe: this.tribe, difficulty: this.difficulty, won: {} };
      const w = (s.scenario.won = s.scenario.won || {})[this.id] = s.scenario.won[this.id] || [];
      if (!w.includes(this.tribe)) w.push(this.tribe);
      if (this.G.saveSettings) this.G.saveSettings(s);
      return;
    }
    s.sequel = s.sequel || {};
    migrateSettings(s.sequel);
    s.sequel.unlocked = Math.max(s.sequel.unlocked || 1, this.id + 1);
    if (this.G.saveSettings) this.G.saveSettings(s);
  }

  // ---------------------------------------------------------------- objects
  // n units of class cls for a role at (x, z) (in a small crowd); opts: level, target ([x, z] or entity: they attack
  // their way there), heading
  spawn(cls, role, x, z, n = 1, opts = {}) {
    const W = this.W, p = role ? this.player(role) : null;
    cls = this.cls(cls);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2.4, r = n > 1 ? 2 + Math.sqrt(i) * 2.2 : 0;
      // never below the class's own first level (MIRAGE's CBT-500 triceratops is made at level 3)
      const lv = Math.max(opts.level || 1, this.firstLevel(cls, p));
      const u = W.spawnUnit(cls, p, x + Math.cos(a) * r, z + Math.sin(a) * r, lv, opts.heading || 0, opts.unit || {});
      if (!u) continue;
      if (opts.target) u.sqTarget = opts.target;
      if (opts.tag) u.sqTag = opts.tag;
      if (role === 'outbreak' && this.diff !== 1) { u.maxHp *= this.diff; u.hp = u.maxHp; }
      out.push(u);
    }
    return out;
  }
  // the level a class is made at: its build action's (World.unitStartLevel: the result's level flag, the class's
  // first level) - a mission's start army is never below it
  firstLevel(cls, p) {
    if (!p || !p.tt) return 1;
    this.lvMemo = this.lvMemo || new Map();
    const k = p.id + '|' + cls;
    if (!this.lvMemo.has(k)) {
      const W = this.W, a = W.data.actions(p).find((x) => x.kind === 'Build' && x.results.some((r) => r.obj === cls));
      this.lvMemo.set(k, a ? W.unitStartLevel(a, p) : W.data.minLevel(cls, p));
    }
    return this.lvMemo.get(k);
  }
  // a pen of the player's: a square ring of fence pieces on the 8 m wall grid around a zone, with a gate in the
  // middle of the side facing (tx, tz) - the trucks drive in through it (AUTO: it opens for the player's units)
  pen(zone, tx, tz, fence = 'seas_fence', gate = 'seas_gate') {
    const W = this.W, M = W.wallMap, z = this.zones[zone], me = this.player('me');
    if (!M || !z) return [];
    const [ci, cj] = M.tileOf(z.x, z.z), N = Math.max(2, Math.ceil((z.r + 4) / 8));
    const sides = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    const [sx, sz] = sides.reduce((b, s) => (Math.hypot(z.x + s[0] * N * 8 - tx, z.z + s[1] * N * 8 - tz) < Math.hypot(z.x + b[0] * N * 8 - tx, z.z + b[1] * N * 8 - tz) ? s : b));
    const gi = ci + sx * N, gj = cj + sz * N, out = [];
    for (let j = cj - N; j <= cj + N; j++) for (let i = ci - N; i <= ci + N; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== N || (i === gi && j === gj)) continue;
      const [x, zz] = M.centre(i, j);
      const b = W.placeBuilding(fence, me, x, zz, 0, true);
      if (b) out.push(b);
    }
    const [x, zz] = M.centre(gi, gj);
    const d = sz ? 3 : 5;                 // along the side: east-west on a north / south side, else north-south
    const g = W.placeBuilding(gate, me, x, zz, M.gateRot(d), true);
    if (g) out.push(g);
    return out;
  }
  // a set piece: a model the scene moves (not a unit, nothing can touch it) - the big wheel's turning rim, a boat
  // casting off. y: its height (null: the ground's); spin: turns per second about its own z axis (the model's
  // front-back axis); path [[x, z], ...] it sails along at `speed` m/s, facing its way (the model's +x forward), then
  // the mission's handler arrived_<id> runs (remove: it is gone then)
  piece(id, model, x, z, y = null, rot = 0, o = {}) {
    this.pieces = this.pieces.filter((p) => p.id !== id);
    const p = { id, model, x, z, y, rot, spin: o.spin || 0, path: null, speed: 0, remove: false };
    this.pieces.push(p);
    return p;
  }
  sail(id, path, speed, remove = false) {
    const p = this.pieces.find((q) => q.id === id);
    if (p) Object.assign(p, { path: path.map((q) => [...q]), speed, remove });
  }
  piecesTick(dt) {
    for (const p of this.pieces.slice()) {
      if (!p.path || !p.path.length) continue;
      let step = p.speed * dt;
      while (step > 0 && p.path.length) {
        const [tx, tz] = p.path[0], dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        if (d > 0.01) p.rot = Math.atan2(-dz, dx);
        if (d <= step) { p.x = tx; p.z = tz; p.path.shift(); step -= d; } else { p.x += dx / d * step; p.z += dz / d * step; step = 0; }
      }
      if (!p.path.length) {
        p.path = null;
        if (p.remove) this.pieces = this.pieces.filter((q) => q !== p);
        this.call('arrived_' + p.id, { p });
      }
    }
  }
  // a class, or of a list the first the data has (the scenarios' units: the base game lacks some of MIRAGE's)
  // (and whose model the assets have: MIRAGE's data names a few models older exports lack)
  cls(c) {
    if (!Array.isArray(c)) return c;
    const D = this.W.data, ok = (n) => { if (!D.exists(n)) return false; const st = D.stats(n, D.minLevel(n, null) || 1, null); return !!(st && st.gfx && this.W.template(st.gfx, true)); };
    return c.find(ok) || c.find((n) => D.exists(n)) || c[0];
  }
  building(cls, role, x, z, rot = 0) {
    cls = this.cls(cls);
    const b = this.W.placeAdapted(cls, this.player(role), x, z, rot, true);      // (the ground levels to it)
    if (b && role === 'me') this.W.recomputeCaps(this.me);
    return b;
  }
  // a rift: spawns waves (lists of [class, count]) every `every` seconds while open; a stabilizer of the player within
  // 30 m seals it after sealTime seconds. guard: a radius - its creatures stay by it and take on only what comes within
  // that (the missions where the player goes to the rifts); a stabilizer being built by it they attack wherever
  rift(id, x, z, o = {}) {
    const W = this.W;
    const e = W.placeBuilding('sq_rift', this.player('outbreak'), x, z, 0, true);
    if (e) { W.setInvulnerable(e, true); e.untargetable = true; }
    const r = { id, e, x, z, every: o.every || 45, next: this.time + (o.first ?? 10), waves: o.waves || [[['Velociraptor', 3]]], wave: 0, seal: 0, sealTime: o.sealTime || 60, open: true, cap: o.cap || 18, target: o.target || null, guard: o.guard || 0, stab: null };
    this.rifts.push(r);
    this.mark(x, z, 'rift:' + id, 0x60e0ff);
    return r;
  }
  closeRift(r) {
    if (!r.open) return;
    r.open = false;
    if (r.e && r.e.alive) { this.W.setInvulnerable(r.e, false); this.W.removeEntity(r.e); }
    this.unmark('rift:' + r.id);
    this.grant(3);
    if (this.G.fx) this.G.fx.explosion(new THREE.Vector3(r.x, this.W.height(r.x, r.z) + 5, r.z), 2);
    this.notify('A rift has been sealed', 'good');
    this.call('riftClosed', { id: r.id });
  }
  units(role, filter) { const p = role ? this.player(role) : null; return this.W.units.filter((u) => u.alive && u.owner === p && (!filter || filter(u))); }
  near(x, z, r, role, filter) { return this.units(role, (u) => Math.hypot(u.pos.x - x, u.pos.z - z) <= r && (!filter || filter(u))); }
  inZone(name, role, filter) { const Z = this.zones[name]; return Z ? this.near(Z.x, Z.z, Z.r, role, filter) : []; }
  count(key, d = 1) { this.counters[key] = (this.counters[key] || 0) + d; return this.counters[key]; }
  // attack-move units to a point or a target
  send(units, target) {
    const t = Array.isArray(target) ? { x: target[0], z: target[1] } : target && target.pos ? target.pos : null;
    if (!t) return;
    for (const u of units) { u.sqTarget = Array.isArray(target) ? target : null; this.W.order([u], { type: 'attackmove', x: t.x, z: t.z, auto: true }); }
  }

  // ---------------------------------------------------------------- every step
  update(dt) {
    if (!this.started || this.ended) return;
    const W = this.W;
    this.time += dt;
    if (this.timers.length) {
      const due = this.timers.filter((t) => t[0] <= this.time);
      if (due.length) { this.timers = this.timers.filter((t) => t[0] > this.time); for (const [, name, args] of due) this.call(name, args); }
    }
    this.readEvents();
    this.piecesTick(dt);
    this.grid.update(dt);
    this.tickT = (this.tickT || 0) - dt;
    if (this.tickT <= 0) {
      this.tickT = 0.5;
      this.rifts.forEach((r) => this.riftTick(r, 0.5));
      this.stabTick();
      this.outbreakTick();
      this.civilianTick();
      this.captureTick();
      this.netTick();
      this.powerTick(0.5);
      this.nightTick();
      this.passiveT = (this.passiveT || 0) + 0.5;
      if (this.passiveT >= 75) { this.passiveT = 0; this.grant(1); }
      this.call('tick');
    }
    this.markers = this.markers.filter((m) => m.until > this.time);
  }
  readEvents() {
    const ev = this.W.events;
    for (; this.evAt < ev.length; this.evAt++) {
      const e = ev[this.evAt];
      if (e.type === 'died' || e.type === 'destroyed') {
        const x = e.entity;
        if (!x) continue;
        if (x.owner && x.owner === this.player('civilians') && x.kind === 'unit') { const n = this.count('civLost'); this.notify(`${this.def.civName || 'A townsperson'} was killed (${n} lost)`, 'bad'); }
        if (x.owner === this.player('outbreak') && x.kind === 'unit') { this.count('dinosKilled'); if ((x.stats.size || 0) >= 6) this.grant(1); }
        this.call('died', { e: x });
      }
    }
  }
  riftTick(r, dt) {
    if (!r.open) return;
    const W = this.W, me = this.me;
    // a finished stabilizer near it seals it
    if (!r.stab || !r.stab.alive || !r.stab.built) r.stab = W.buildings.find((b) => b.alive && b.built && b.owner === me && tagsOf(b.name).includes('stabilizer') && Math.hypot(b.pos.x - r.x, b.pos.z - r.z) < RIFT_RANGE) || null;
    // a stabilizer starts sealing it: the rift fights back at once (the user: rushing a rift in the last mission met
    // nothing - its first wave was minutes away and the surge slower than the seal), then a wave every third of the
    // seal time at most
    if (r.stab && !r.sealing) { r.sealing = true; r.next = this.time; this.notify('The rift fights back!', 'bad'); }
    if (!r.stab) r.sealing = false;
    if (r.stab) {
      r.seal += dt;
      if (r.seal >= r.sealTime) { this.closeRift(r); return; }
    } else r.seal = Math.max(0, r.seal - dt * 0.5);
    if (this.time < r.next) return;
    const alive = this.W.units.filter((u) => u.alive && u.sqRift === r.id).length;
    // a rift that is being sealed surges: waves come twice as fast, at least three during the seal, and the cap
    // does not hold them back
    r.next = this.time + (r.stab ? Math.min(r.every * 0.5, r.sealTime / 3) : r.every);
    if (alive >= r.cap && !r.stab) return;
    const wave = r.waves[Math.min(r.wave, r.waves.length - 1)];
    r.wave++;
    const target = r.stab ? r.stab : r.target;
    // what comes out is shown: a ping on the minimap, and word of the first wave
    this.mark(r.x, r.z, 'wave:' + r.id, 0xff5a3a, 8);
    if (r.wave === 1) this.notify('Creatures are coming through the rift', 'bad');
    for (const [cls, n] of wave) {
      const k = Math.max(1, Math.round(n * (this.difficulty === 0 ? 0.7 : this.difficulty === 2 ? 1.3 : 1)));
      const us = this.spawn(cls, 'outbreak', r.x + (Math.random() - 0.5) * 6, r.z + 8 + Math.random() * 4, k, { target: target && target.pos ? [target.pos.x, target.pos.z] : target });
      for (const u of us) { u.sqRift = r.id; if (r.guard && !target) u.sqHome = [r.x, r.z, r.guard]; }
    }
    if (this.G.fx) { this.G.fx.dust(new THREE.Vector3(r.x, W.height(r.x, r.z) + 2, r.z), 8); this.G.fx.explosion(new THREE.Vector3(r.x, W.height(r.x, r.z) + 4, r.z), 1); }
  }
  // a stabilizer just finished: whether it is close enough to a rift to seal it (else the player would wait in vain)
  stabTick() {
    for (const b of this.W.buildings) {
      if (!b.alive || !b.built || b.owner !== this.me || b.sqTold || !tagsOf(b.name).includes('stabilizer')) continue;
      b.sqTold = true;
      let best = null, bd = 1e9;
      for (const r of this.rifts) { if (!r.open) continue; const d = Math.hypot(b.pos.x - r.x, b.pos.z - r.z); if (d < bd) { bd = d; best = r; } }
      if (!best) this.notify('Rift Stabilizer ready - there is no open rift near it', 'bad');
      else if (bd < RIFT_RANGE) this.notify(`Rift Stabilizer ready - sealing the rift: keep it standing for ${Math.round(best.sealTime - best.seal)} s`, 'good');
      else this.notify(`Rift Stabilizer too far from the rift (${Math.round(bd)} m) - it must stand within ${RIFT_RANGE - 2} m of it`, 'bad');
    }
  }
  // the outbreak's creatures: to their target, else the nearest enemy, else the player's base
  outbreakTick() {
    const W = this.W, ob = this.player('outbreak');
    if (!ob) return;
    for (const u of W.units) {
      if (!u.alive || u.owner !== ob || u.sqAsleep > this.time || u.inside || u.parked) continue;
      if (u.task.type !== 'idle' && u.task.type !== 'roam') continue;
      if (u.st && u.st.t.trapped > W.time) continue;
      let t = u.sqTarget;
      if (t && !Array.isArray(t)) t = t.alive ? [t.pos.x, t.pos.z] : null;
      if (t && Math.hypot(u.pos.x - t[0], u.pos.z - t[1]) < 10) t = null;
      const H = !t && u.sqHome;
      if (H) {
        // a rift's guard: what comes within its radius of the rift, else back to it
        let best = null, bd = 1e9;
        for (const e of W.units) { if (!e.alive || !e.owner || e.owner === ob || e.inside || e.parked || Math.hypot(e.pos.x - H[0], e.pos.z - H[1]) > H[2]) continue; const d = Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z); if (d < bd) { bd = d; best = e; } }
        if (!best) for (const b of W.buildings) { if (!b.alive || !b.owner || b.owner === ob || Math.hypot(b.pos.x - H[0], b.pos.z - H[1]) > H[2]) continue; const d = Math.hypot(b.pos.x - u.pos.x, b.pos.z - u.pos.z); if (d < bd) { bd = d; best = b; } }
        if (best) W.order([u], { type: 'attackmove', x: best.pos.x, z: best.pos.z, auto: true });
        else if (Math.hypot(u.pos.x - H[0], u.pos.z - H[1]) > H[2] * 0.5) W.order([u], { type: 'move', x: H[0] + (Math.random() - 0.5) * 20, z: H[1] + (Math.random() - 0.5) * 20, auto: true });
        continue;
      }
      if (!t) {
        let best = null, bd = 160;
        for (const e of W.units) { if (!e.alive || !e.owner || e.owner === ob || e.inside || e.parked) continue; const d = Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z); if (d < bd) { bd = d; best = e; } }
        if (!best) for (const b of W.buildings) { if (!b.alive || !b.owner || b.owner === ob) continue; const d = Math.hypot(b.pos.x - u.pos.x, b.pos.z - u.pos.z); if (d < bd * 2) { bd = d / 2; best = b; } }
        if (best) t = [best.pos.x, best.pos.z];
      }
      if (t) W.order([u], { type: 'attackmove', x: t[0], z: t[1], auto: true });
    }
  }
  // civilians: run from creatures; a SEAS unit nearby leads them: they head for the nearest evacuation zone
  civilianTick() {
    const W = this.W, cv = this.player('civilians'), ob = this.player('outbreak');
    if (!cv) return;
    const evac = Object.values(this.zones).filter((z) => z.kind === 'evac');
    for (const u of W.units) {
      if (!u.alive || u.owner !== cv) continue;
      const zone = evac.find((z) => Math.hypot(u.pos.x - z.x, u.pos.z - z.z) <= z.r);
      if (zone && u.sqRescued) {
        W.removeEntity(u);
        const n = this.count('evacuated');
        this.call('evacuated', { n, zone: zone.name });
        continue;
      }
      let danger = null, dd = 22;
      W.uHash.query(u.pos.x, u.pos.z, 26, (o) => { if (o.alive && o.owner === ob) { const d = Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z); if (d < dd) { dd = d; danger = o; } } });
      if (!u.sqRescued) {
        let found = false;
        W.uHash.query(u.pos.x, u.pos.z, 14, (o) => { if (!found && o.alive && o.owner === this.me && o.kind === 'unit') found = true; });
        if (found) { u.sqRescued = true; u.sqHiding = false; u.untargetable = false; this.civT = this.time; this.call('rescued', { u }); }
      }
      if (danger && !u.sqRescued && !u.sqHiding) {
        const dx = u.pos.x - danger.pos.x, dz = u.pos.z - danger.pos.z, d = Math.hypot(dx, dz) || 1;
        W.order([u], { type: 'move', x: u.pos.x + dx / d * 18, z: u.pos.z + dz / d * 18, auto: true });
      } else if (u.sqRescued && evac.length && u.task.type === 'idle') {
        let z0 = evac[0], bd = 1e9;
        for (const z of evac) { const d = Math.hypot(u.pos.x - z.x, u.pos.z - z.z); if (d < bd) { bd = d; z0 = z; } }
        W.order([u], { type: 'move', x: z0.x + (Math.random() - 0.5) * z0.r, z: z0.z + (Math.random() - 0.5) * z0.r, auto: true });
      }
    }
    this.civStatus(cv);
  }
  // the townsfolk objectives (objective opts.civ): how many were lost and how many are still out, an objective that
  // can no longer be reached fails, and townsfolk nobody has found for a while are shown on the map
  civStatus(cv) {
    const out = this.W.units.filter((u) => u.alive && u.owner === cv);
    const lost = this.counters.civLost || 0, hiding = out.filter((u) => u.sqHiding);
    for (const o of this.objectives) {
      if (!o.civ || o.done || o.failed) continue;
      o.note = `${lost} lost · ${out.length} still out` + (hiding.length ? ` (${hiding.length} not found yet)` : '');
      if (o.of && o.count + out.length < o.of) {
        if (o.secondary) this.fail(o.id); else { o.failed = true; this.lose('Too many townsfolk were lost.'); }
      }
    }
    if (this.civT === undefined) this.civT = this.time;
    if (hiding.length && this.objectives.some((o) => o.civ && !o.done && !o.failed) && this.time - this.civT > 180) {
      this.civT = this.time;
      const spots = [];
      for (const u of hiding) if (!spots.some((p) => Math.hypot(p[0] - u.pos.x, p[1] - u.pos.z) < 30)) spots.push([u.pos.x, u.pos.z]);
      spots.forEach(([x, z], i) => this.mark(x, z, 'hiding:' + i, 0xfff0a0, 30));
      this.notify(`${hiding.length} townsfolk are still hiding - their places are marked on the map`);
    }
  }
  // tranquilized creatures sleep; a capture truck next to one loads it, at a pen it becomes the player's
  sleep(V, sec = 50) {
    const W = this.W;
    V.sqAsleep = this.time + sec;
    V.untargetable = true;
    W.trap(V, sec, 'asleep');
    W.releaseTask(V); V.task = { type: 'idle' }; V.path = [];
    // it lies down and keeps lying (the lying part of its rest clip loops: MickDundeeMove.usl:99-109, Sleep.usl:62-67)
    // until it gets up as the sleep ends (wakeTick)
    const a = V.anim && V.anim.pick('rest', 'sleep', 'idle_rest', 'dying', 'die_simple');
    if (a) { V.busyAnim = true; V.sqWaking = false; V.anim.play(a, /^(rest|sleep|idle_rest)$/.test(a) ? { restart: true, fade: 0.3 } : { loop: false, fade: 0.3 }); }
    // nobody goes on hitting a sleeper (its attackers turn to other work or the next enemy)
    for (const u of W.units) if (u.alive && u !== V && u.task && u.task.target === V) { W.releaseTask(u); u.task = { type: 'idle' }; u.path = []; }
    this.call('asleep', { u: V });
  }
  wake(V) {
    V.sqAsleep = 0; V.untargetable = false; V.busyAnim = false;
    if (V.st) V.st.t.trapped = 0;
    if (V.anim && V.idleAnim && !V.sqWaking) V.anim.play(V.idleAnim);
    V.sqWaking = false;
  }
  // a sleeper gets up the length of its rest clip's end part before the sleep is over (held where it lies till then)
  wakeTick(V) {
    if (V.sqWaking || !V.anim || !V.idleAnim) return;
    const e = V.anim.duration(V.anim.curName + '#e');
    if (e && V.sqAsleep - this.time <= e) { V.sqWaking = true; V.anim.play(V.idleAnim); }
  }
  // electrified nets: a creature of the outbreak that walks onto one is held 15 s (tranquilizers work 5x as fast on
  // it: damageHook); a net needs 30 s to charge again
  netTick() {
    const W = this.W, me = this.me, out = this.player('outbreak');
    for (const n of W.buildings) {
      if (!n.alive || !n.built || n.owner !== me || n.name !== 'sq_electric_net' || n.sqZapT > this.time) continue;
      const v = W.units.find((u) => u.alive && u.owner === out && u.cls === 'ANML' && !u.parked && !(u.sqAsleep > this.time) && Math.hypot(u.pos.x - n.pos.x, u.pos.z - n.pos.z) < 10);
      if (!v) continue;
      n.sqZapT = this.time + 30;
      W.trap(v, 15, 'net');
      v.sqStunned = this.time + 15;
      if (this.G.fx) this.G.fx.explosion(v.pos.clone(), 1);
      this.call('netted', { u: v, net: n });
    }
  }
  // electricity (power.js): abandoned stations are taken over when SEAS gets there; the outbreak raids the lines
  powerTick(dt) {
    const W = this.W, me = this.me, civ = this.player('civilians'), ob = this.player('outbreak');
    for (const b of W.buildings) {
      if (!b.alive || !isPlant(b) || b.owner !== civ) continue;
      if (!W.units.some((u) => u.alive && u.owner === me && !u.parked && Math.hypot(u.pos.x - b.pos.x, u.pos.z - b.pos.z) < 22)) continue;
      W.setOwner(b, me);
      this.notify('Generating station secured: put workers in it and run a power line to your base', 'good');
      this.mark(b.pos.x, b.pos.z, 'station', 0xffe070, 20);
      this.call('plantTaken', { b });
    }
    this.raidT -= dt;
    if (this.raidT > 0 || !ob) return;
    this.raidT = (120 + Math.random() * 60) / this.diff;
    const lines = W.buildings.filter((b) => b.alive && b.owner === me && (isPole(b) || isPlant(b)) && b.sqPowered);
    if (!lines.length) return;
    const t = lines[Math.floor(Math.random() * lines.length)];
    const raiders = W.units.filter((u) => u.alive && u.owner === ob && !u.parked && !(u.sqAsleep > this.time) && Math.hypot(u.pos.x - t.pos.x, u.pos.z - t.pos.z) < 160).slice(0, 3);
    if (!raiders.length) return;
    for (const u of raiders) { u.sqTarget = t; W.order([u], { type: 'attack', target: t, auto: true }); }
    this.mark(t.pos.x, t.pos.z, 'raid', 0xff5030, 12);
    if (!this.state.raidSaid) { this.state.raidSaid = true; this.say('kiko', 'Colonel, they\'re going for the power line! Something figured out where the hum comes from.'); }
  }
  captureTick() {
    const W = this.W, me = this.me;
    for (const u of W.units) if (u.sqAsleep && !u.parked) { if (u.sqAsleep <= this.time) this.wake(u); else this.wakeTick(u); }
    // the pens of the mission; where it has none, the garage or the headquarters takes the animal in
    let pens = Object.values(this.zones).filter((z) => z.kind === 'pen');
    if (!pens.length) pens = W.buildings.filter((b) => b.alive && b.built && b.owner === me && /^seas_(garage|headquarters)$/.test(b.name)).map((b) => ({ x: b.pos.x, z: b.pos.z, r: b.radius + 10 }));
    for (const t of W.units) {
      if (!t.alive || t.owner !== me || !tagsOf(t.name).includes('capture')) continue;
      const load = this.cargo.find((c) => c[0] === t);
      if (!load) {
        let best = null, bd = 9;
        W.uHash.query(t.pos.x, t.pos.z, 12, (o) => { if (o.alive && o.sqAsleep > this.time && !o.parked) { const d = Math.hypot(o.pos.x - t.pos.x, o.pos.z - t.pos.z) - o.radius; if (d < bd) { bd = d; best = o; } } });
        if (best) { W.setParked(best, true); this.cargo.push([t, best]); this.notify(`Loaded: ${W.data.text(best.name).name}`, 'good'); this.call('loaded', { u: best }); }
        continue;
      }
      const pen = pens.find((z) => Math.hypot(t.pos.x - z.x, t.pos.z - z.z) <= z.r + 4);
      if (pen) {
        const V = load[1];
        this.cargo.splice(this.cargo.indexOf(load), 1);
        W.setParked(V, false);
        W.teleport(V, pen.x + (Math.random() - 0.5) * pen.r, pen.z + (Math.random() - 0.5) * pen.r);
        this.wake(V);
        W.setOwner(V, me);
        V.sqRift = null; V.sqTarget = null;
        this.grant(2);
        const n = this.count('captured');
        this.notify(`Captured! (${n})`, 'good');
        this.call('captured', { u: V, n });
      }
    }
    // a truck that died drops its load where it was
    for (const c of [...this.cargo]) if (!c[0].alive) { this.cargo.splice(this.cargo.indexOf(c), 1); const V = c[1]; W.setParked(V, false); W.teleport(V, c[0].pos.x + 4, c[0].pos.z); this.wake(V); }
  }
  // the damage hook (World.hooks.damage): a tranquilizer dart puts the "Tranquilized" debuff on a creature for
  // TRANQ_SEC (every hit starts it again) and does its normal damage - five times that on a creature held by one of
  // Taslov's nets (mission 6). A blow that would kill a tranquilized creature, whoever strikes it, leaves it at 1 hit
  // point asleep instead (lethalHook), so the army can wear it down without killing it.
  damageHook(dmg, A, V) {
    if (!A || !V) return false;
    // a sleeper is left alone: no blow (darts, splash, a stray shot) reaches it
    if (V.sqAsleep > this.time) return true;
    const tags = tagsOf(A.name);
    if ((tags.includes('shock') || tags.includes('chain')) && !this.chaining) this.electric(dmg, A, V, tags);
    if (V.kind !== 'unit' || V.cls !== 'ANML' || !tags.includes('tranq')) return false;
    if (V.sqAsleep > this.time) return true;
    V.sqTranq = this.W.time + TRANQ_SEC;
    if (V.sqStunned > this.time) { this.W.damage(V, dmg * 5, A); return true; }
    return false;
  }
  // World.hooks.lethal: a tranquilized creature that would die falls asleep at 1 hit point (one asleep stays at 1)
  lethalHook(V) {
    if (V.kind !== 'unit') return false;
    if (V.sqAsleep > this.time) return true;
    if (!(V.sqTranq > this.W.time)) return false;
    V.sqTranq = 0;
    this.sleep(V);
    return true;
  }
  // the electric weapons (power.js): an arc to the target; shock stuns it for a moment, chain lightning jumps on to
  // two more enemies nearby (each jump weaker)
  electric(dmg, A, V, tags) {
    const W = this.W;
    this.arcs = this.arcs || [];
    const at = (e) => [e.pos.x, e.pos.y + (e.kind === 'building' ? e.ht * 0.8 : 1.6), e.pos.z];
    this.arcs.push({ a: at(A), b: at(V), t: 0.3 });
    if (tags.includes('shock') && V.kind === 'unit' && V.alive) { W.trap(V, 0.8, 'shock'); V.sqStunned = Math.max(V.sqStunned || 0, this.time + 0.8); }
    if (!tags.includes('chain') || !A.owner) return;
    this.chaining = true;
    try {
      const hit = new Set([V]);
      let prev = V, d = dmg;
      for (let k = 0; k < 2; k++) {
        d *= 0.6;
        let best = null, bd = 12;
        for (const u of W.units) {
          if (!u.alive || hit.has(u) || !u.owner || !A.owner.isEnemy(u.owner) || u.parked || u.inside) continue;
          const dd = Math.hypot(u.pos.x - prev.pos.x, u.pos.z - prev.pos.z);
          if (dd < bd) { bd = dd; best = u; }
        }
        if (!best) break;
        hit.add(best);
        this.arcs.push({ a: at(prev), b: at(best), t: 0.3 });
        W.damage(best, d, A);
        prev = best;
      }
    } finally { this.chaining = false; }
  }
  // ---------------------------------------------------------------- night
  // the night: a dark blue one, or the mission's own dusk (def.dusk: the sky's colour, the sun's and the sky light's
  // share of the day's, the sun's colour, floodlights [[x, height over the ground, z, colour, candela, reach]])
  setNight(on) {
    this.nightOn = on;
    const R = this.G.renderer;
    if (!R) return;
    if (!this.dayLight) this.dayLight = { sun: R.sun.intensity, hemi: R.hemi.intensity, bg: R.scene.background.getHex(), fog: R.scene.fog.color.getHex(), sunC: R.sun.color.getHex() };
    const L = this.dayLight;
    const N = { sky: 0x101828, sun: 0.2, sunColor: 0x8aa8ff, hemi: 0.34, ...(this.def.dusk || {}) };
    R.sun.intensity = on ? L.sun * N.sun : L.sun;
    R.sun.color.setHex(on ? N.sunColor : L.sunC);
    R.hemi.intensity = on ? L.hemi * N.hemi : L.hemi;
    if (typeof document !== 'undefined') document.body.classList.toggle('sqnight', on);
    R.scene.background.setHex(on ? N.sky : L.bg);
    R.scene.fog.color.setHex(on ? N.sky : L.fog);
    if (R.floodlights) R.floodlights(on && N.lights ? N.lights.map(([x, y, z, ...l]) => [x, this.W.height(x, z) + y, z, ...l]) : null);
    this.G.sightScale = on ? 0.6 : 1;
  }
  nightTick() {
    if (!this.nightOn) return;
    const W = this.W, ob = this.player('outbreak');
    for (const b of W.buildings) {
      if (!b.alive || !b.built || b.owner !== this.me || !tagsOf(b.name).includes('searchlight')) continue;
      W.uHash.query(b.pos.x, b.pos.z, 30, (o) => { if (o.alive && o.owner === ob && Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z) < 26) { W.trap(o, 0.5, 'dazzled'); if (o.st) o.st.revealT = W.time + 1; } });
    }
  }
  // extra sight for the fog of war at night: searchlights light 36 m (main.js updateFow)
  viewers() {
    const out = [];
    if (!this.nightOn) return out;
    for (const b of this.W.buildings) if (b.alive && b.built && b.owner === this.me && tagsOf(b.name).includes('searchlight')) out.push([b.pos.x, b.pos.z, 36 / (this.G.sightScale || 1)]);
    return out;
  }
  // ---------------------------------------------------------------- command powers
  powerState(id) {
    const P = POWERS[id];
    if (!P || (this.def.powers && !this.def.powers.includes(id))) return 'off';
    if ((this.powerReady[id] || 0) > this.time) return 'cooldown';
    if (this.cp < P.cost) return 'cost';
    return 'ready';
  }
  usePower(id, x, z) {
    const P = POWERS[id], W = this.W, me = this.me;
    if (this.powerState(id) !== 'ready') return false;
    this.cp -= P.cost;
    this.powerReady[id] = this.time + P.cool;
    if (id === 'recon') W.revealArea(me, x, z, 70, 40);
    else if (id === 'supply') { for (const r of ['food', 'wood', 'stone']) me.res[r] = Math.min(me.res[r] + 150, Math.max(me.caps[r] || 300, me.res[r] + 150)); }
    else if (id === 'airdrop') { const us = this.spawn('sq_trooper', 'me', x, z, 4, { level: 2 }); if (this.G.fx) for (const u of us) this.G.fx.dust(u.pos.clone(), 2); }
    else if (id === 'artillery') this.after(3, '_barrage', { x, z });
    this.notify(P.name, 'good');
    return true;
  }
  barrage({ x, z }) {
    const W = this.W, me = this.me;
    for (let i = 0; i < 6; i++) {
      const px = x + (Math.random() - 0.5) * 18, pz = z + (Math.random() - 0.5) * 18;
      const p = new THREE.Vector3(px, W.height(px, pz), pz);
      if (this.G.fx) this.G.fx.explosion(p, 1.4);
      W.areaDamage(null, p, 8, 260, 60, { owner: me, direct: true, size: 7 });
    }
    if (this.G.rtscam && this.G.rtscam.addShake) this.G.rtscam.addShake(1.0, 10, 100, this.G.rtscam.target, 60);   // (the sequel's own: a strength-10 shake)
  }
}
