import { Stats } from './stats.js';
import { WallMap } from './wallmap.js';
// The game simulation.
//
// World holds all entities (units, buildings, resource nodes, projectiles) and runs one simulation step at a time.
// The actual rules live in systems/ - each file adds methods to World:
//
//   systems/economy.js       gathering, delivery, fields, storage caps, market
//   systems/construction.js  placing and building, repair, dismantling, destruction
//   systems/production.js    training, upgrades (player-wide and local), heroes, army pyramid
//   systems/combat.js        targets, ranges, the damage formula, projectiles, poison, towers, death
//   systems/healing.js       healers and healing buildings
//   systems/effects.js       auras and timed states (warcry, trumpet, trapped, invulnerable ...)
//   systems/moves.js         special moves and building commands
//   systems/buildings.js     behaviour by building script class (gates, traps, nests, warp gate ...)
//   systems/animals.js       wild animals
//   systems/transport.js     bunkers and transports
//   scripting.js             what missions do to the world: diplomacy, owner changes, spawning by class name,
//                            deleting, teleporting, resources, tech filters, fog reveals (docs/CAMPAIGN_RUNTIME.md)
//
// Every step: timers -> units -> buildings -> projectiles -> collision -> cleanup. Things the player should
// hear or see are reported as events (world.events, consumed by ui/feedback.js).
import * as THREE from 'three';
import { AMPHIBIOUS, Unit, Building, ResNode } from './entities.js';
import { NavGrid, SpatialHash } from './nav.js';
import { DELAYED } from './delayed.js';
import { cloneModel } from '../engine/assets.js';
import { applyFow } from '../engine/terrain.js';
import { Effects, active } from './systems/effects.js';
import { Combat } from './systems/combat.js';
import { Economy } from './systems/economy.js';
import { Construction } from './systems/construction.js';
import { Production } from './systems/production.js';
import { Healing } from './systems/healing.js';
import { Moves, MOVES } from './systems/moves.js';
import { MirageMoves } from './systems/moves_mirage.js';
import { BuildingBehaviours } from './systems/buildings.js';
import { Animals } from './systems/animals.js';
import { Landmarks } from './systems/landmarks.js';
import { Items } from './systems/items.js';
import { Finishing } from './systems/finishing.js';
import { WallWalk } from './systems/wallwalk.js';
import { Siege } from './systems/siege.js';
import { GameOver } from './systems/gameover.js';
import { Naval } from './systems/naval.js';
import { Transport } from './systems/transport.js';
import { Scripting } from './scripting.js';
import { applyNight } from '../engine/parts.js';

const VIRTUAL_FACTOR = 144, DAY = 86400;      // CTimeMgr (PWServer.exe 0x7bcab0: factor 144.0, day length 86400.0)

// the wall class table (gamedata "wallClasses", pipeline/build_data.py wall_classes); older data: every wall-placer
// class by its kind, class 1
function wallClassTable(D) {
  const t = D && D.extra && D.extra.wallClasses;
  if (t && Object.keys(t).length) return t;
  const out = {}, T = { wall: 0, gate: 1, tower: 2, trap: 3 }, R = { Hu: 0, Aje: 1, Ninigi: 2, SEAS: 3 };
  if (D && D.index) for (const [name, ix] of D.index) {
    if (ix.type !== 'BLDG') continue;
    const d = D.def(name, null);
    if (d && d.wallKind in T) out[name.toLowerCase()] = d.wallKind === 'trap' ? [1, 0, 3] : [R[ix.tribe] ?? 0, 1, T[d.wallKind]];
  }
  return out;
}

export class World {
  // opts: scene, data (Rules), templates(name, soft), height(x, z), size, playHalf, fx, audio, props, foliage, fow,
  //       rules: { warpgate: bool, warpgateMinutes: number }
  constructor(opts) {
    Object.assign(this, opts);
    this.THREE = THREE;
    this.MOVES = MOVES;
    this.cloneModel = cloneModel;
    this.applyFow = applyFow;
    this.rules = opts.rules || {};
    this.time = 0;
    // the time of day (CTimeMgr: virtual seconds run 144 times as fast as the game's, a day is 86400 of them = 10
    // minutes; day from 6:00 to 18:00 - SetVirtualDayOffset(0.25), SetVirtualNightOffset(0.75); the level's start
    // time, 12:00 when it has none). nightFn: a mode with a night of its own (the sequel's missions)
    this.dayStart = opts.startTime != null ? opts.startTime : 12 * 3600;
    this.nightFn = null;
    this.players = [];
    this.units = []; this.buildings = []; this.resources = []; this.projectiles = [];
    this.uHash = new SpatialHash(12); this.bHash = new SpatialHash(16); this.rHash = new SpatialHash(12);
    this.nav = new NavGrid(this.size, 2);
    this.reserved = new Uint8Array(this.nav.n * this.nav.n);   // building footprints (also before they block the pathfinder)
    this.events = [];
    this.stats = new Stats(this);  // the game's statistics (game/stats.js): every event passes it
    this.dead = [];
    this.timers = [];              // later(): [time, kind, args]
    this.hooks = {};               // functions a game mode adds: damage(dmg, attacker, victim) -> true = handled; lethal(victim, attacker) -> true = it lives on at 1 hp; power(worker, plant, seconds)
    this.effects = [];             // periodicEffect()
    this.spirits = [];             // souls of fallen units (Aje shaman: Resurrect)
    this.watchers = [];            // {player, host, until}: a player sees what the host sees (MIRAGE parasite)
    this.wildNests = [];           // nests of original maps: respawn wild animals (systems/animals.js)
    this.wells = [];               // healing wells, lakes of healing / damage, the weather program (systems/landmarks.js)
    this.lakes = [];
    this.items = [];               // items (artefacts) on the map or carried (u.item): systems/items.js
    this.weather = null;
    this.regionOf = null;          // name -> the map's region (campaign/regions.js Region; set by the game's setup)
    this.reveals = [];             // revealArea(): fog of war circles given to players (scripting.js)
    this.standIns = new Map();     // class (lower case) -> model used when the class's own model does not exist
    this.onEntity = null;          // hook(entity): called for every unit / building created (campaign registry)
    this.wallMap = new WallMap(...(opts.wallGrid || [4, 4]));   // the 8 m wall grid (game/wallmap.js)
    this.wallMap.world = this;
    this.wallMap.classes = wallClassTable(opts.data);
    this.playHalf = opts.playHalf || this.size / 2;
    const h = this.playHalf;
    this.play = opts.play || { x0: -h, x1: h, z0: -h, z1: h };   // playable rectangle
    this.waterNav = null;                                       // ships / swimmers (markWater)
    this.setting = opts.setting || 'Jungle';                    // the map's landscape (Jungle, Northland, Savanna, Icewaste, Ashvalley)
    // the setting's wood log carried by workers (product_wood_jun / _nor / _sav / _ice / _ash)
    const key = { Jungle: 'jun', Northland: 'nor', Savanna: 'sav', Icewaste: 'ice', Ashvalley: 'ash' }[opts.setting || 'Jungle'];
    this.productWood = this.templates && this.templates('product_wood_' + key, true) ? 'product_wood_' + key : 'product_wood_jun';
  }
  // height a unit stands at: the ground, or the water surface for ships (swimming animals a little below it)
  groundY(u) {
    if (u.wallH != null) return u.wallH;                 // jumping on / off a wall, falling (systems/wallwalk.js)
    if (u.onWall) return this.wallY(u);                  // on a wall's walkway
    const g = this.height(u.pos.x, u.pos.z);
    if (this.waterLevel == null) return g;
    if (u.naval) return Math.max(g, this.waterLevel - (u.cls === 'SHIP' ? 0.1 : 0.5));
    if (u.amphib) return Math.max(g, this.waterLevel - 0.2);
    return g;
  }
  // the land a point belongs to (the computer player's "island", GetDynamicIslandIdForChar [?engine]): the connected
  // parts of the land grid where only the terrain counts - cliffs and water part them, buildings and trees don't.
  // -> a number (-1: in the sea / on a cliff with no land within 8 m)
  landIsland(x, z) {
    const nav = this.nav, n = nav.n;
    const bad = (k) => (this.steepCell && this.steepCell[k]) || (this.wetCell && this.wetCell[k]);
    if (!this._island) {
      const lab = new Int32Array(n * n).fill(-1);
      let id = 0;
      const st = [];
      for (let k0 = 0; k0 < n * n; k0++) {
        if (lab[k0] >= 0 || bad(k0)) continue;
        lab[k0] = id; st.push(k0);
        while (st.length) {
          const k = st.pop(), i = k % n, j = (k - i) / n;
          if (i > 0 && lab[k - 1] < 0 && !bad(k - 1)) { lab[k - 1] = id; st.push(k - 1); }
          if (i < n - 1 && lab[k + 1] < 0 && !bad(k + 1)) { lab[k + 1] = id; st.push(k + 1); }
          if (j > 0 && lab[k - n] < 0 && !bad(k - n)) { lab[k - n] = id; st.push(k - n); }
          if (j < n - 1 && lab[k + n] < 0 && !bad(k + n)) { lab[k + n] = id; st.push(k + n); }
        }
        id++;
      }
      this._island = lab;
    }
    const k = nav.idx(x, z);
    if (this._island[k] >= 0) return this._island[k];
    const i0 = k % n, j0 = (k - i0) / n;
    for (let r = 1; r <= 4; r++) for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const l = this._island[j * n + i];
      if (l >= 0) return l;
    }
    return -1;
  }
  // the navigation grid a unit moves on: ships and swimming animals sail the water grid, everything else walks
  navFor(u) {
    if (!u || !this.waterNav) return this.nav;
    if (u.amphib) return this.amphibNav();
    return u.naval ? this.waterNav : this.nav;
  }
  // amphibious units: a cell is passable if it is passable on land or on water (rebuilt at most every 2 s)
  amphibNav() {
    const L = this.nav, Wn = this.waterNav;
    let A = this._amp;
    if (!A) { A = this._amp = new NavGrid(this.size, 2); A.ampT = -99; A.gateAt = L.gateAt; }
    const key = L.version * 100003 + Wn.version;
    if (A.key !== key && this.time - A.ampT > 2) {
      const S = this.shoreCell;
      for (let k = 0; k < A.block.length; k++) A.block[k] = Math.min(S ? L.block[k] - S[k] : L.block[k], Wn.block[k]);
      A.key = key; A.ampT = this.time; A.version++;
    }
    return A;
  }
  // water of the original maps (level in m): land units can wade 0.4 m deep, ships need 1.5 m
  // original maps: land units walk where the map's pathfinder grid lets them (maps/ula.js pathing) - not over
  // mountains and cliffs, through shallow water up to about 0.6 m (fords) but not up the steep shore. steepCell marks
  // the dry cells it blocks (coastal buildings may stand on them, construction.js); the ford cells are no longer wet.
  // fords: the walk rule may open wet cells (an original map's own walk grid knows its fords); a slope rule may not -
  // the bed of the sequel's rivers is flat but under water
  markTerrain(walkable, fords = true) {
    const nav = this.nav, n = nav.n;
    this.steepCell = new Uint8Array(n * n);
    this.shoreCell = this.waterNav ? new Uint8Array(n * n) : null;     // steep cells at the waterline: amphibians go there
    for (let k = 0; k < n * n; k++) {
      const [x, z] = nav.center(k), ok = walkable(x, z);
      if (this.wetCell && this.wetCell[k]) {
        if (ok && fords) { nav.block[k]--; this.wetCell[k] = 0; }
      } else if (!ok) {
        nav.block[k]++; this.steepCell[k] = 1;
        if (this.shoreCell && this.height(x, z) < this.waterLevel + 2) this.shoreCell[k] = 1;
      }
    }
    nav.version++;
  }
  markWater(level) {
    this.waterLevel = level;
    const nav = this.nav, n = nav.n;
    const wn = this.waterNav = new NavGrid(this.size, 2);
    this.wetCell = new Uint8Array(n * n);                    // 1 = blocked for land units because of the water
    let wet = 0;
    for (let k = 0; k < n * n; k++) {
      const [x, z] = nav.center(k);
      const depth = level - this.height(x, z);
      if (depth > 0.4) { nav.block[k]++; this.wetCell[k] = 1; wet++; }
      if (depth < 1.5) wn.block[k]++;
      const P = this.play;
      if (x < P.x0 + 2 || x > P.x1 - 2 || z < P.z0 + 2 || z > P.z1 - 2) wn.block[k]++;
    }
    nav.version++; wn.version++;
    if (!wet) this.waterNav = null;
    return wet;
  }
  isWater(x, z, depth = 0.4) { return this.waterLevel != null && this.waterLevel - this.height(x, z) > depth; }
  // remove trees / bushes / decoration obstacles around a point (start locations of original maps)
  clearArea(x, z, r) {
    this.rHash.query(x, z, r + 4, (n) => {
      if (!n.alive || n.type === 'stone' || Math.hypot(n.pos.x - x, n.pos.z - z) > r) return;
      this.depleteNode(n);
    });
  }
  template(name, soft) { return this.templates(name, soft); }
  reserve(cells, d) { for (const k of cells) this.reserved[k] = Math.max(0, this.reserved[k] + d); }
  templateInfo(name) { if (!name) return null; const t = this.templates(name, true); return t ? t.info : null; }
  emit(type, data) { const e = { type, ...data }; this.events.push(e); this.stats.on(e); }
  // run DELAYED[kind](this, args) after `sec` game seconds (hit delays, knockbacks, delayed effects: game/delayed.js)
  later(sec, kind, args = {}) {
    if (!DELAYED[kind]) throw new Error('unknown delayed call ' + kind);
    if (sec <= 0) DELAYED[kind](this, args); else this.timers.push([this.time + sec, kind, args]);
  }
  // sound of an animation event, only for entities the player can see
  animSound(e, ev) {
    if (!this.audio || !e.obj || !e.obj.visible || e.onScreen === false) return;
    this.audio.animEvent(ev, e.pos);
  }

  // ------------------------------------------------------------------ spawning
  spawnUnit(name, owner, x, z, level, heading = 0, opts = {}) {
    if (!this.data.exists(name)) { console.warn('unknown unit', name); return null; }
    const def = this.data.def(name, owner);
    // unique heroes: a second one of the same class is not created (NPCMgr.AddNPC)
    if (owner && def.unique && owner.heroes.has(name)) return null;
    // a class whose model is not loaded (campaign maps load other tribes' classes on demand) is not created
    if (!this.unitModel(name, level, owner)) { if (!this._noModel) this._noModel = new Set(); if (!this._noModel.has(name)) { this._noModel.add(name); console.warn('no model for unit', name); } return null; }
    const zep = this.data.script(name) === 'CFlyingTraderObj';
    const nv = this.navFor({ naval: !!opts.swim || (this.data.info(name)?.type === 'SHIP' && !AMPHIBIOUS.test(name)), amphib: AMPHIBIOUS.test(name) });
    if (!zep && !nv.isFree(x, z)) { const c = nv.nearestFree(nv.idx(x, z)); [x, z] = nv.center(c); }
    const u = new Unit(this, name, owner, x, z, level || this.defaultLevel(name, owner), heading, zep ? { ...opts, temp: true } : opts);
    if (zep) this.makeZeppelin(u, opts.alt);
    u.pos.y = this.groundY(u); u.syncObj();          // ships and swimmers start on the water, not on the sea bed below
    this.units.push(u);
    this.uHash.insert(u);
    if (owner) {
      if (u.countsInPop) { owner.units++; owner.atLevel[u.level - 1]++; }
      if (def.unique) owner.heroes.add(name);
      this.entityFilters(u, true);
      this.recomputeCaps(owner);
      if (name === 'ninigi_ninja' && this.data.invented(owner, 'disguise', owner.tribe)) u.st.camo.add('disg');
      // Aje tracker dino (Animal.usl CTrackerDino): acts on its own, scouts forward, attacks enemies within 50 m, dies after 180 s
      if (this.data.script(name) === 'CTrackerDino') {
        u.autonomous = true; u.tracker = true; u.task = { type: 'roam' };
        this.later(180, 'expire', { u });
      }
    }
    if (this.onEntity) this.onEntity(u);
    return u;
  }
  defaultLevel(name, owner) { return this.data.minLevel(name, owner); }
  // the campaign trader's zeppelin (Vehicle.usl CFlyingTraderObj): flies, cannot be hit nor selected, takes no damage,
  // not in the unit limit; walks are straight flights to the point and its height at the order's speed (m/s, at most
  // its max speed: task/misc.usl:137-174), always playing "standanim". alt: its height above the sea (map z).
  makeZeppelin(u, alt) {
    u.zeppelin = true; u.flying = true; u.untargetable = true; u.unselectable = true; u.countsInPop = false;
    u.liftH = alt != null ? Math.max(0, alt - this.height(u.pos.x, u.pos.z)) : 0;
    u.pos.y = this.groundY(u) + u.liftH; u.syncObj();
  }

  // ------------------------------------------------------------------ tech tree filters driven by entities
  // (FightingObj.SetStartFilters / SetLevelFilter, BuildObjects of finished buildings, chief bonus at level 5)
  entityFilters(e, on) {
    const p = e.owner;
    if (!p || !p.tt || e.illusion) return;
    const d = e.def;
    const t = on ? (f) => p.tt.enable(f) : (f) => p.tt.disable(f);
    if (d && d.globalStartTT) t(d.globalStartTT.replace(/^\/?Filters\//, ''));
    if (e.kind === 'building' && e.built) t(`${d.tribe}/BuildObjects/${e.name}`);
    if (e.kind === 'unit') this.levelFilters(e, e.level, on);
  }
  levelFilters(u, level, on) {
    const p = u.owner;
    if (!p || !p.tt || !u.def) return;
    for (const f of this.data.levelFilters(u.name, level)) if (!f.includes('_Bonus')) (on ? p.tt.enable(f) : p.tt.disable(f));
    // level 5: the "chief" bonus of the class, heroes' included (FightingObj.usl SetLevelFilter; only the AllNonHeroes
    // filters skip heroes): Ada's faster production, Cole's tougher infantry, Taslow's building loot ...
    if (level === 5) {
      const f = `${u.def.tribe}/Upgrades/${u.name}/Chief_Bonus`;
      on ? p.tt.enable(f) : p.tt.disable(f);
    }
  }
  placeBuilding(name, owner, x, z, rot = 0, built = true) {
    if (!this.data.exists(name) || !this.templates((this.data.stats(name, 1, owner) || {}).gfx, true)) { console.warn('no model for building', name); return null; }
    const b = new Building(this, name, owner, x, z, rot, built);
    this.buildings.push(b);
    this.bHash.insert(b);
    this.emit('ground', { x: b.pos.x, z: b.pos.z, r: b.radius + 2 });   // ground cover (grass) under it goes away
    if (b.def.wallKind) this.wallMap.add(b);                            // walls, gates, towers, traps: the wall grid
    // the Aje's floating harbour counts in the unit limit and has a card in the pyramid from its site on
    // (CSwimmingHarbour.DoesCountInUnitLimit; Building.OnInit AddUnit)
    if (owner && b.countsInPop) { owner.units++; owner.atLevel[b.level - 1]++; }
    if (built) {
      this.entityFilters(b, true);
      this.recomputeCaps(owner);
      if (b.behaviour && b.behaviour.built) b.behaviour.built(b, this);
    }
    if (this.onEntity) this.onEntity(b);
    return b;
  }
  // a building a script puts down ready-made, like one built in the game: the ground levels to it and takes its
  // brush's materials, the plants under it go (systems/construction.js startConstruction; the sequel's starts)
  placeAdapted(name, owner, x, z, rot = 0, built = true) {
    const def = this.data.def(name, owner);
    if (this.adaptTerrain && def && !def.coastal && def.wallKind !== 'wall' && def.wallKind !== 'gate') {
      const st = this.data.stats(name, 1, owner);
      if (st && st.gfx) this.adaptTerrain(st.gfx, x, z, rot);
    }
    const b = this.placeBuilding(name, owner, x, z, rot, built);
    if (this.clearVegetation && b) this.clearVegetation(x, z, b.hx ? Math.hypot(b.hx, b.hz) : b.radius);
    return b;
  }
  addResource(type, res, x, z, amount, opts) {
    const r = new ResNode(this, type, res, x, z, amount, opts);
    this.resources.push(r);
    this.rHash.insert(r);
    return r;
  }
  entitiesOf(p) { return [...this.units.filter((u) => u.alive && u.owner === p), ...this.buildings.filter((b) => b.alive && b.owner === p)]; }
  // the game is won by player p (warp gate countdown); everybody else loses
  // the warp gate's countdown (OnFireWarpGateTimer): its owner and the owner's friends win, everybody else loses
  victory(p) { for (const o of this.players) { if (o === p || p.isFriend(o)) o.won = true; else o.defeated = true; } this.emit('victory', { player: p }); }

  // ------------------------------------------------------------------ orders (from the player or the AI)
  // o.type: move | attackmove | attack | stop | hold | gather | build | repair | deliver | heal | board | unload | fountain | pickup
  order(units, o) {
    for (const u of units) {
      if (!u.alive || u.kind !== 'unit' || u.autonomous || u.parked) continue;
      if (u.stationary && /move|gather|build|board|trade|repair|deliver/.test(o.type)) continue;   // mines / water turrets
      if (u.name === 'aje_torpedo_turtle' && o.type !== 'kill') continue;                          // obeys nothing but Kill
      if (u.inside) { if (o.type === 'unload') this.leaveTransport(u); continue; }
      if (active(u, 'trapped', this.time) && u.st.trapWhy === 'dig') continue;
      if (active(u, 'deaf', this.time) && o.type !== 'kill') continue;     // deafened: no orders (MIRAGE FO:14376)
      if (u.flyChange > this.time) continue;                               // rising / landing jetpack (MIRAGE Hu.usl:165)
      if (u.st.camo.has('entr')) this.digOut(u);
      if (u.st.camo.has('aje') && o.type !== 'move') this.setCamo(u, 'aje', false);
      // a finishing move plays to its end (FinishingMove.Break() = false): the order follows it
      if (u.finishing && u.task.type === 'finish') { u.task.next = o; continue; }
      this.releaseTask(u);
      u.busyAnim = false;
      // a new order drops the queued wall tiles (Q_Build: G.placeWall), unless it is the queue's own first step
      if (!o.keepBuildQueue) u.buildQueue = null;
      // jumping on or off a wall: the order comes after the landing; on a wall: systems/wallwalk.js
      if (u.wjump) { u.wjump.then = o; continue; }
      if (u.climbing) { u.task.then = o; continue; }
      if (u.onWall && this.wallOrder(u, o)) continue;
      // a docked siege vehicle undocks first (siege.js); its passengers still get out at once
      if ((u.docked || (u.task.type === 'dock' && u.task.phase === 'docking')) && o.type !== 'unload') { this.undock(u, o); continue; }
      const user = o.auto ? false : true;
      switch (o.type) {
        case 'move': case 'attackmove':
          u.task = { type: o.type, x: o.x, z: o.z, user, then: o.then || null, slow: !!o.slow, wp: o.wp || null, alt: o.alt ?? null, flySpeed: o.flySpeed || 0 };   // then: next order on arrival; slow: at walking pace (mission scripts); wp: the group walk (pullGroup)
          u.setPath(o.x, o.z);
          u.anchor.set(o.x, o.z);
          break;
        // to and fro between points, fighting what comes along (FightingObj AddPatrolPoint: Ctrl + right-click)
        case 'patrol': {
          const [x, z] = o.pts[o.i % o.pts.length];
          u.task = { type: 'attackmove', x, z, user, then: { ...o, i: o.i + 1 } };
          u.setPath(x, z);
          u.anchor.set(x, z);
          break;
        }
        case 'attack':
          if (o.target && o.target.kind === 'res') { this.startGather(u, o.target); break; }
          // a siege tower / brachiosaurus told to attack a wall docks to it (VH:511-514)
          if (this.canDock(u) && o.target && o.target.def && o.target.def.wallKind === 'wall') { this.dockOrder(u, o.target, user); break; }
          // an order to attack a neutral player's object makes both players hostile; a friend's object is never
          // attacked (FightingObj.usl:6594-6617). Automatic fights never get here with a non-hostile target.
          if (o.target && o.target.owner && u.owner && o.target.owner !== u.owner && !u.owner.isEnemy(o.target.owner)) {
            if (!this.attackAllowed(u, o.target)) break;
            this.declareWar(u.owner, o.target.owner);
          }
          u.task = { type: 'attack', target: o.target, user, forceAttack: !!o.force }; u.repathT = 0;
          break;
        case 'stop': u.task = { type: 'idle' }; u.path = []; u.anchor.set(u.pos.x, u.pos.z); break;
        case 'hold': u.task = { type: 'hold' }; u.path = []; u.anchor.set(u.pos.x, u.pos.z); break;
        case 'gather': u.task = { type: 'idle', user }; this.startGather(u, o.target); break;
        case 'build': u.task = { type: 'idle', user }; this.startBuild(u, o.target); break;
        case 'repair': u.task = { type: 'idle', user }; this.startRepair(u, o.target); break;
        case 'deliver': u.task = { type: 'gather', res: u.carry ? u.carry.res : 'food', phase: 'deliver', drop: o.target || null, user }; break;
        case 'heal': if (u.stats.heal) { u.task = { type: 'heal', target: o.target, user }; u.repathT = 0; } break;
        case 'board':
          if (o.target && o.target.docked && this.isSiegeBrachio(o.target)) { this.climbSiege(u, o.target, user); break; }   // up the docked brachiosaurus (CH:351)
          if (this.canBoard(u, o.target)) u.task = { type: 'board', target: o.target, user };
          break;
        case 'dock': this.dockOrder(u, o.target, user); break;
        case 'fountain': if (this.canUseWell(u, o.target)) u.task = { type: 'fountain', target: o.target, user }; break;
        case 'pickup': if (this.canCarry(u) && o.target && o.target.item) u.task = { type: 'pickup', target: o.target, user }; break;
        case 'use': this.useWall(u, o.target, user); break;                                  // up onto an own wall (wallwalk.js)
        case 'climb': this.climbSiege(u, o.target, user); break;                              // a ladder / docked tower (siege.js)
        case 'unload': if (u.passengers) this.unloadAll(u, false); break;
        case 'trade': this.startTrade(u, o.target); break;
        case 'rallyJob': u.task = { type: 'idle' }; this.rallyJob(u, o.x, o.z); break;      // a new worker at its rally point
      }
    }
  }
  // one step of the zeppelin's flight: straight to the point at the order's speed, its height going over to the
  // point's along the way; arrived within 1 m
  zeppelinStep(u, t, dt) {
    const max = (u.stats && (u.stats.maxspeed || u.stats.speed)) || 3;
    const sp = Math.min(max, t.flySpeed || max);
    if (t.alt != null && t.alt0 == null) { t.alt0 = this.height(u.pos.x, u.pos.z) + (u.liftH || 0); t.d0 = Math.max(1, Math.hypot(t.x - u.pos.x, t.z - u.pos.z)); }
    u.steer(dt, sp, 1);
    if (t.alt != null) {
      const d = Math.hypot(t.x - u.pos.x, t.z - u.pos.z), f = Math.min(1, Math.max(0, 1 - d / t.d0));
      u.liftH = Math.max(0, t.alt0 + (t.alt - t.alt0) * f - this.height(u.pos.x, u.pos.z));
    }
    if (u.idleAnim && u.anim.curName !== u.idleAnim) u.anim.play(u.idleAnim);
    if (!u.path.length) { const next = t.then; u.task = { type: 'idle' }; if (next) this.order([u], next); }
  }
  // a queued group walk: the first member to reach a waypoint takes every member of the same walk whose next walk is
  // the same one along at once - the stragglers cut the corner, nobody waits (FightingObj.usl:2033-2044 OnActionPreEnd,
  // misc.usl:187-199 Execute_Q_Walk, FO:8731-8746)
  pullGroup(done, next) {
    if (!done.wp || !next.wp || done.wp === next.wp) return;
    for (const v of this.units) {
      const t = v.task;
      if (!v.alive || v.inside || t.wp !== done.wp || (t.type !== 'move' && t.type !== 'attackmove') || !t.then || t.then.wp !== next.wp) continue;
      v.task = { type: 'idle' };
      this.order([v], t.then);
    }
  }
  // Shift + right-click: the order comes after the walks the unit has (HandleWalkCommand /Queued); false: it has none
  queueOrder(u, o) {
    let t = u.task;
    if (!u.alive || u.kind !== 'unit' || (t.type !== 'move' && t.type !== 'attackmove' && !(t.type === 'attack' && t.amove))) return false;
    while (t.then && t.then.type !== 'patrol') t = t.then;
    if (t.then) return false;
    t.then = o;
    return true;
  }
  // a task that gives up: what it held (a gathering slot, a building site, a field - also of a task waiting under a
  // wall walk) is let go first, or the slot stayed taken for the rest of the game
  toIdle(u) {
    this.releaseTask(u);
    const r = u.task.resume;
    if (r && typeof r === 'object' && r.type) { u.task = r; this.releaseTask(u); }
    u.task = { type: 'idle' };
    u.busyAnim = false;
  }
  // the states a unit keeps only while its task runs - on a wall, on a ladder, docked, dug in: ended when a script or
  // a transport takes the unit out of its task (teleport, parking, a new owner, boarding), or they stuck: a unit
  // hovering at the wall's height that no order moved any more
  dropStates(u) {
    if (u.onWall || u.wjump || u.climbing) { u.onWall = null; u.wjump = null; u.wpath = []; u.climbing = false; u.wallH = null; if (this.setOnWall) this.setOnWall(u, false); }
    if (u.docked || u.dockTile) { if (this.siegeGone) this.siegeGone(u); u.docked = null; u.dockTile = null; }
    if (u.st && u.st.camo && u.st.camo.has('entr') && this.setCamo) this.setCamo(u, 'entr', false);
  }
  releaseTask(u) {
    const t = u.task;
    if (t.type === 'cast') this.castCancel(u);
    if (t.node) t.node.workers.delete(u);
    if (t.building) { t.building.builders.delete(u); t.building.freeSlot(u); }
    if (t.farm) t.farm.workers.delete(u);
    u.attachTool(null);
    this.stopHealing(u);
  }

  // ------------------------------------------------------------------ per-unit update
  unitUpdate(u, dt) {
    if (!u.alive) return this.deadUnitUpdate(u, dt);
    if (u.parked) return;                          // taken out of the world by a mission (scripting.js setParked)
    if (u.inside) { this.passengerUpdate(u, dt); return; }
    if (u.tpl && u.tpl.fourcc === 'Ship') { this.nightCheck(u, dt); applyNight(u.model, u.night); }    // a ship's lamps
    if (u.invulnT > 0) u.invulnT -= dt;
    if (u.st.poison) this.poisonUpdate(u);
    if (u.fatigue > 0) this.fatigueUpdate(u, dt);                   // a wild animal that fled (systems/animals.js)
    if (u.pending) { u.pending.t -= dt; if (u.pending.t <= 0) { const p = u.pending; u.pending = null; this.fire(u, p.w, p.target); } }
    if (u.queue.length) this.productionUpdate(u, dt);
    // knockback slide / jetpack jump
    // (a throw ends at a cliff, a building or a closed gate: it does not carry the unit up or into it)
    if (u.knock) {
      const k = u.knock, s = Math.min(dt, k.t), nx = u.pos.x + k.vx * s, nz = u.pos.z + k.vz * s;
      if (u.flying || u.canWalkInto(this.navFor(u), nx, nz)) { u.pos.x = nx; u.pos.z = nz; k.t -= dt; } else k.t = 0;
      if (k.t <= 0) u.knock = null;
    }
    if (u.jumpFx) {
      const j = u.jumpFx; j.t += dt; const f = Math.min(1, j.t / j.T);
      u.pos.x = j.from.x + (j.to.x - j.from.x) * f; u.pos.z = j.from.z + (j.to.z - j.from.z) * f;
      u.jumpH = Math.sin(f * Math.PI) * Math.min(20, j.T * 8);
      if (f >= 1) { u.jumpFx = null; u.jumpH = 0; u.anchor.set(u.pos.x, u.pos.z); }
    }
    // rising / sinking (jetpack flight, Babbage going up, the exo suit coming down)
    if (u.lift) { const l = u.lift; l.t += dt; const f = Math.min(1, l.t / l.T); u.liftH = l.from + (l.to - l.from) * f; if (f >= 1) u.lift = null; }
    // trapped, frozen, stunned: no actions
    if (active(u, 'trapped', this.time)) { u.path = []; u.vel.set(0, 0, 0); this.animTick(u, dt); return; }
    if ((u.onWall || u.wjump || u.climbing) && this.wallPreUpdate(u, dt)) { this.animTick(u, dt); return; }
    if ((this.waterNav || u.naval) && this.navalUnitUpdate(u, dt)) { this.animTick(u, dt); return; }
    // however a finishing move ended (a teleport, parking ...), its protection ends with it (FinishingMove.USLOnLeave)
    if (u.finishing && u.task.type !== 'finish') { u.finishing = false; u.busyAnim = false; }
    // on a ladder without the climb (a hit made it fight - engage): down to the ground
    if (u.climbing && u.task.type !== 'climb' && this.wallFall) this.wallFall(u, false);
    const t = u.task;
    switch (t.type) {
      case 'heal': this.healUpdate(u, dt); break;
      case 'idle': case 'hold': this.idleUpdate(u, dt); break;
      case 'move': case 'attackmove': {
        // a gate of the enemy shuts the way (Unit.setPath): break it, then go on
        const bg = u.breach;
        if (bg && (!bg.alive || !u.world.nav.gateAt.size)) u.breach = null;
        else if (bg && bg.surfDist(u.pos.x, u.pos.z) < 10) {
          u.breach = null;
          u.task = { type: 'attack', target: bg, amove: [t.x, t.z], then: t.then, user: false, auto: true };
          break;
        }
        if (t.type === 'attackmove') {
          u.scanT = (u.scanT || 0) - dt;
          if (u.scanT <= 0) { u.scanT = 0.4; const e = this.findTarget(u, Math.max(30, this.alarmRange(u))); if (e) { u.task = { type: 'attack', target: e, amove: [t.x, t.z], then: t.then, user: false, auto: true }; break; } }
        }
        if (u.zeppelin) { this.zeppelinStep(u, t, dt); break; }
        const sp = u.steer(dt, u.task.user && !t.back && !t.slow ? u.runSpeed : u.speed, 0.8);
        u.moveAnim(sp, u.task.user && !t.slow && u.runSpeed > u.speed * 1.2);
        if (!u.path.length) { const next = t.then; u.task = { type: 'idle' }; if (next) { this.order([u], next); this.pullGroup(t, next); } }
        break;
      }
      case 'attack': this.attackUpdate(u, dt); break;
      case 'gather': this.gatherUpdate(u, dt); break;
      case 'build': this.buildUpdate(u, dt); break;
      case 'roam': this.roamUpdate(u, dt); break;
      case 'flee': this.fleeUpdate(u, dt); break;
      case 'special': this.specialUpdate(u, dt); break;
      case 'board': this.boardUpdate(u, dt); break;
      case 'fountain': this.fountainUpdate(u, dt); break;
      case 'pickup': this.pickupUpdate(u, dt); break;
      case 'wall': this.wallUpdate(u, dt); break;
      case 'climb': this.climbUpdate(u, dt); break;
      case 'dock': this.dockUpdate(u, dt); break;
      case 'finish': this.finishUpdate(u, dt); break;
      case 'trade': this.tradeUpdate(u, dt); break;
      case 'entrench': u.vel.set(0, 0, 0); break;
      case 'cast': this.castUpdate(u, dt); break;
    }
    this.animTick(u, dt);
  }
  // off-screen units: advance their animation only a few times per second
  animTick(u, dt) {
    u.animAcc = (u.animAcc || 0) + dt;
    if (u.onScreen !== false || u.animAcc > 0.3) { u.anim.update(u.animAcc); if (u.comp) u.comp.update(u.animAcc, u.task.type === 'attack'); u.animAcc = 0; }
  }
  // idle / hold ground: look for work according to the stance (character.usl idle loop, FightingObj aggro timers)
  idleUpdate(u, dt) {
    const t = u.task;
    u.vel.set(0, 0, 0);
    if (u.fightStandT > 0) u.fightStandT -= dt;
    u.idleTick(dt);
    if (u.wild || u.autonomous) { u.task = { type: 'roam' }; return; }
    if (u.name === 'ninigi_ninja' && !u.st.camo.has('disg') && this.time > (u.disgT || 0) && this.data.invented(u.rulesOwner(), 'disguise', u.owner.tribe, u)) u.st.camo.add('disg');
    if (t.victoryAt != null && this.time >= t.victoryAt) { t.victoryAt = null; this.victoryAnim(u); }
    u.scanT = (u.scanT || Math.random()) - dt;
    if (u.scanT > 0) return;
    u.scanT = 0.9 + Math.random() * 0.2;
    // healers look for someone to heal
    if (u.stats.heal && u.owner) {
      const o = this.healScan(u);
      if (o && (t.type === 'idle' || u.distTo(o) - o.radius <= u.stats.heal.radius)) { u.task = { type: 'heal', target: o, hold: t.type === 'hold' }; return; }
    }
    if (!u.weapons.long || u.cannotFight || u.stance === 3 || u.stance === -1) return;
    const cs = u.cs(u.weapons.long);
    if (u.stance === 1) {
      // defensive: fights back only - except units set to it by setAggro (AIAM state 1): they take on enemies
      // that come within 20 m of their post and return to it afterwards
      if (!u.guard20) return;
      const e1 = this.findTarget(u, 20 + u.radius, { filter: (x) => Math.hypot(x.pos.x - u.anchor.x, x.pos.z - u.anchor.y) <= 20 + (x.radius || 0) });
      if (e1) this.engage(u, e1, {});
      return;
    }
    const hold = t.type === 'hold' || u.stance === 0 || !!u.onWall;      // on a wall: no walk back to the post (FO:2393)
    const r = hold ? this.attackRangeOf(u, cs) + u.radius + 2 : Math.max(this.attackRangeOf(u, cs), 30);
    const e = this.findTarget(u, r, { leash: !hold, filter: hold ? (x) => this.rangeZone(u, x).zone > 0 : null });
    if (e) { this.engage(u, e, { hold }); return; }
    // an enemy within the alarm range but not taken on: alarmed (FightingObj.SetAlarmed, CAlarmed)
    const a = this.findTarget(u, this.alarmRange(u), {});
    if (a) this.alarmUnit(u, a);
  }
  // SetAlarmed / CAlarmed: the unit turns to the enemy and threatens it once - characters jans_anim_0 .. 2, animals
  // "menace" (not in the water) - again at most every 10 s
  alarmUnit(u, e) {
    if (this.time < (u.alarmT || 0) || u.busyAnim || u.inside) return;
    u.alarmT = this.time + 10;
    const name = u.cls === 'CHTR' ? 'jans_anim_' + Math.floor(Math.random() * 3) : u.swimming ? '' : 'menace';
    if (!name || !u.anim.has(name)) return;
    u.face(e.pos.x, e.pos.z, 1, 100);
    u.busyAnim = true;
    u.anim.play(name, { loop: false, restart: true, onDone: () => { u.busyAnim = false; } });
    this.later(Math.max(0.5, u.anim.duration(name)) + 0.2, 'animDone', { u, name });
  }
  // PlayRandomVictoryAnim: no enemy around - one time in four victory_0 .. 2
  victoryAnim(u) {
    if (u.busyAnim || this.findTarget(u, this.alarmRange(u), {})) return;
    if (Math.random() >= 0.25) return;
    const name = 'victory_' + Math.floor(Math.random() * 3);
    if (!u.anim.has(name)) return;
    const loops = 1 + Math.floor(Math.random() * 2), d = u.anim.duration(name);
    u.busyAnim = true;
    u.anim.play(name, { restart: true });
    this.later(Math.max(0.5, d * loops), 'animDone', { u, name });
  }
  deadUnitUpdate(u, dt) {
    u.deadT += dt;
    // a ship's wreck (combat.js shipWreck): its sink animation, then gone (CUniversalCorpse: 10 s)
    if (u.wreck) {
      const W = u.wreck;
      if (W.anim) W.anim.update(dt);
      if (u.deadT > 10 && !u.removed) { this.scene.remove(W.obj); if (W.anim) W.anim.dispose(); this.scene.remove(u.obj); if (u.comp) u.comp.dispose(); u.removed = true; }
      return;
    }
    u.anim.update(dt);
    if (u.finish) this.finishedUpdate(u);              // the victim of a finishing move (systems/finishing.js)
    const stay = u.corpseNode ? (u.corpseGone ? 0 : 1e9) : 12;
    if (u.corpseNode && u.corpseNode.alive) { u.corpseNode.rotT -= dt; if (u.corpseNode.rotT <= 0) this.depleteNode(u.corpseNode); }
    if (u.comp && u.comp.wagon) u.comp.syncWagon(0);
    if (u.silentDeath && !u.removed) { this.scene.remove(u.obj); if (u.comp) u.comp.dispose(); u.removed = true; return; }
    if (u.deadT > stay) { u.obj.position.y -= dt * 0.6; if (u.deadT > stay + 4) { this.scene.remove(u.obj); if (u.comp) u.comp.dispose(); u.removed = true; } }
  }

  // ------------------------------------------------------------------ per-building update
  // the time of day in seconds (0 .. 86400) and whether it is night (CTimeMgr.IsVirtualDay)
  dayTime() { return (((this.dayStart + this.time * VIRTUAL_FACTOR) % DAY) + DAY) % DAY; }
  isNight() {
    if (this.nightFn) return !!this.nightFn();
    const f = this.dayTime() / DAY;
    return f < 0.25 || f > 0.75;
  }
  // a finished building (Building.usl NIGHT_TIMER) or a ship (Ship.usl TIMER_NIGHT) looks at the time of day every
  // 20 s and switches its lights (parts.js applyNight); it starts with them off
  nightCheck(e, dt) {
    if ((e.nightT = (e.nightT || 0) + dt) < 20) return;
    e.nightT = 0;
    e.night = this.isNight();
  }
  buildingUpdate(b, dt) {
    if (!b.alive) {
      if (b.removed) return;
      b.deadT += dt;
      if (b.ruin) { if (b.deadT > 8) { b.ruin.position.y -= dt * 1.0; if (b.deadT > 20) { this.scene.remove(b.ruin); b.removed = true; } } }
      else { b.obj.position.y -= dt * b.ht * 0.25; if (b.deadT > 5) { this.scene.remove(b.obj); b.removed = true; } }
      return;
    }
    if (b.parked) return;
    b.updateAnim(dt, this.time);
    if (b.built) this.nightCheck(b, dt);
    b.updateVisual();
    this.damageFx(b, dt);
    if (!b.built) { this.constructionUpdate(b, dt); return; }
    this.productionUpdate(b, dt);
    this.towerUpdate(b, dt);
    if (this.waterNav) this.harbourUpdate(b, dt);
    if (b.behaviour && b.behaviour.update) b.behaviour.update(b, this, dt);
  }
  // smoke and fire at the damage links (D_01..D_16) of damaged buildings
  damageFx(b, dt) {
    if (!b.built || b.dmgStage === 0 || !this.fx) return;
    if (this.fow && !this.fow.visible(b.pos.x, b.pos.z)) return;
    b.fxT = (b.fxT || 0) - dt;
    if (b.fxT > 0) return;
    b.fxT = b.dmgStage === 2 ? 0.1 : 0.25;
    if (!b.dLinks) { b.dLinks = []; for (let i = 1; i <= 16; i++) { const p = b.linkWorld('D_' + String(i).padStart(2, '0')); if (p) b.dLinks.push(p); } }
    const n = b.dmgStage === 2 ? b.dLinks.length : Math.ceil(b.dLinks.length / 3);
    const p = n ? b.dLinks[Math.floor(Math.random() * n)].clone() : b.pos.clone().setY(b.pos.y + b.ht * 0.6);
    this.fx.spawn('smoke', p, { size: 1.5, size1: 6, life: 2.6, vel: new THREE.Vector3(Math.random() - 0.5, 2.5, Math.random() - 0.5), drag: 0.4, alpha: 0.55, spin: 0.5 });
    if (b.dmgStage === 2) this.fx.spawn('fire', p.clone(), { size: 1.6, size1: 0.5, life: 0.7, vel: new THREE.Vector3(0, 2.2, 0), drag: 1 });
  }
  // does player p have a unit that can resurrect (the Aje shaman's Resurrect move)? checked once a second
  canResurrect(p) {
    if (!p) return false;
    if (!this._resCan) this._resCan = new Map();
    const c = this._resCan.get(p);
    if (c && this.time - c.t < 1) return c.v;
    if (!this._resBy) this._resBy = new Map();      // unit name -> has Resurrect
    const has = (u) => {
      const k = u.name + '|' + (u.level || 1);
      if (!this._resBy.has(k)) this._resBy.set(k, this.movesOf(u).some((a) => a.id === 'Resurrect' || a.id === 'reanimation'));
      return this._resBy.get(k);
    };
    const v = this.units.some((u) => u.alive && u.owner === p && u.cls === 'CHTR' && has(u));
    this._resCan.set(p, { t: this.time, v });
    return v;
  }
  // spirits fade after 60 s; they glimmer while they last - only for players with a shaman to bring them back
  spiritTick(dt) {
    this.spiritFx = (this.spiritFx || 0) - dt;
    const fx = this.spiritFx <= 0;
    if (fx) this.spiritFx = 0.6;
    for (const s of this.spirits) {
      if (this.time > s.until) s.alive = false;
      else if (fx && this.fx && this.canResurrect(s.owner) && (!this.fow || this.fow.visible(s.pos.x, s.pos.z))) this.fx.spawn('glow', s.pos.clone().setY(s.pos.y + 1.2), { size: 1.2, size1: 2.4, life: 0.8, color: 0x9fd8ff });
    }
    this.spirits = this.spirits.filter((s) => s.alive);
  }
  // (p null: any player's spirit)
  nearestSpirit(p, x, z, r = 8) { let best = null, bd = r; for (const s of this.spirits) { if ((p && s.owner !== p) || !s.alive || s.busy) continue; const d = Math.hypot(s.pos.x - x, s.pos.z - z); if (d < bd) { bd = d; best = s; } } return best; }
  // an entity whose tree changed re-reads its values (checked every half second)
  refreshTick() {
    const changed = (e) => {
      const T = e.rulesOwner().tt;
      if (!T) return false;
      if (T.sync) T.sync();                  // local trees follow their owner's tree
      return T.version !== e.ttVersion;
    };
    for (const e of this.units) if (e.alive && e.owner && changed(e)) e.refreshRules();
    for (const e of this.buildings) if (e.alive && e.owner && changed(e)) { e.refreshRules(); this.recomputeCaps(e.owner); }
  }

  // ------------------------------------------------------------------ main update
  update(dt) {
    this.time += dt;
    // delayed actions
    if (this.timers.length) {
      const due = this.timers.filter((x) => x[0] <= this.time);
      if (due.length) { this.timers = this.timers.filter((x) => x[0] > this.time); for (const [, kind, args] of due) DELAYED[kind](this, args); }
    }
    this.effectsTick(dt);
    this.effectsUpdate();
    if (this.spirits.length) this.spiritTick(dt);
    if (this.wildNests.length) this.wildNestsUpdate(dt);
    if (this.wells.length) this.wellsUpdate(dt);
    if (this.lakes.length) this.lakesUpdate(dt);
    if (this.weather) this.weatherUpdate();
    if (this.go) this.gameOverUpdate(dt);              // the end of a skirmish (systems/gameover.js)
    this.stats.update();
    this.refreshT = (this.refreshT || 0) - dt;
    if (this.refreshT <= 0) { this.refreshT = 0.5; this.refreshTick(); }
    for (let i = 0; i < this.units.length; i++) this.unitUpdate(this.units[i], dt);
    for (let i = 0; i < this.buildings.length; i++) this.buildingUpdate(this.buildings[i], dt);
    for (const p of this.projectiles) this.projectileUpdate(p, dt);
    this.projectiles = this.projectiles.filter((p) => p.alive);
    this.separation(dt);
    for (const u of this.units) if (u.alive && !u.inside && !u.parked) { u.pos.y = this.groundY(u) + (u.jumpH || 0) + (u.liftH || 0); u.syncObj(); this.uHash.move(u); }
    if (this.units.some((u) => u.removed)) this.units = this.units.filter((u) => !u.removed);
    if (this.buildings.some((b) => b.removed)) this.buildings = this.buildings.filter((b) => !b.removed);
    if (this.resources.length > 50 && this.resources.some((r) => !r.alive)) this.resources = this.resources.filter((r) => r.alive);
  }
  // units push each other apart; nobody stands inside blocked cells or an enemy's closed gate
  separation(dt) {
    const us = this.units;
    const shift = (u, mx, mz) => {
      const nav = this.navFor(u);
      const x = u.pos.x + mx, z = u.pos.z + mz;
      if (u.canWalkInto(nav, x, z)) { u.pos.x = x; u.pos.z = z; }
      else if (u.canWalkInto(nav, x, u.pos.z)) u.pos.x = x;
      else if (u.canWalkInto(nav, u.pos.x, z)) u.pos.z = z;
    };
    for (const a of us) {
      if (!a.alive || a.inside || a.parked || a.flying || a.onWall || a.wjump || a.climbing) continue;   // (in the air, on a wall: over everything)
      this.uHash.query(a.pos.x, a.pos.z, a.radius + 6, (b) => {
        if (b === a || !b.alive || b.inside || b.id < a.id || !!b.naval !== !!a.naval || b.flying || b.onWall || b.wjump || b.climbing) return;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const min = (a.radius + b.radius) * 0.9;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6) return;
        const d = Math.sqrt(d2), push = min - d;
        // moving units yield to working/fighting ones
        const wa = a.vel.lengthSq() > 0.01 ? 1 : 0.35, wb = b.vel.lengthSq() > 0.01 ? 1 : 0.35;
        const ma = a.radius * a.radius, mb = b.radius * b.radius;
        const fa = (mb / (ma + mb)) * wa, fb = (ma / (ma + mb)) * wb;
        const s = fa + fb || 1;
        // pushes never move a unit into a building / closed gate (it would hover inside and look stuck)
        shift(a, -dx / d * push * fa / s, -dz / d * push * fa / s);
        shift(b, dx / d * push * fb / s, dz / d * push * fb / s);
      });
      const nav = this.navFor(a);
      const k0 = nav.idx(a.pos.x, a.pos.z);
      const blocked = nav.block[k0] || (nav.gateAt.size && nav.gateBlocks(k0, a.owner));
      if (blocked) {
        let c = nav.nearestFree(k0, 4);
        if (!nav.block[k0]) { const [gx, gz] = nav.center(k0); const g = nav.gateAt.get(k0); const ax = a.pos.x - (g ? g.pos.x : gx), az = a.pos.z - (g ? g.pos.z : gz); const L = Math.hypot(ax, az) || 1; a.pos.x += ax / L * 4 * dt; a.pos.z += az / L * 4 * dt; continue; }
        const [cx, cz] = nav.center(c);
        const dx = cx - a.pos.x, dz = cz - a.pos.z, d = Math.hypot(dx, dz);
        if (d > 0.01) { const k = Math.min(1, 6 * 0.016 / d + 0.05); a.pos.x += dx * k; a.pos.z += dz * k; }
      }
    }
  }
}
// install the systems
Object.assign(World.prototype, Effects, Combat, Economy, Construction, Production, Healing, Moves, MirageMoves, BuildingBehaviours, Animals, Landmarks, Items, Finishing, WallWalk, Siege, GameOver, Transport, Naval, Scripting);
