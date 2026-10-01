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
//
// Every step: timers -> units -> buildings -> projectiles -> collision -> cleanup. Things the player should
// hear or see are reported as events (world.events, consumed by ui/feedback.js).
import * as THREE from 'three';
import { AMPHIBIOUS, Unit, Building, ResNode } from './entities.js';
import { NavGrid, SpatialHash } from './nav.js';
import { cloneModel } from '../engine/assets.js';
import { applyFow } from '../engine/terrain.js';
import { Effects, active } from './systems/effects.js';
import { Combat } from './systems/combat.js';
import { Economy } from './systems/economy.js';
import { Construction } from './systems/construction.js';
import { Production } from './systems/production.js';
import { Healing } from './systems/healing.js';
import { Moves, MOVES } from './systems/moves.js';
import { BuildingBehaviours } from './systems/buildings.js';
import { Animals } from './systems/animals.js';
import { Naval } from './systems/naval.js';
import { Transport } from './systems/transport.js';

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
    this.players = [];
    this.units = []; this.buildings = []; this.resources = []; this.projectiles = [];
    this.uHash = new SpatialHash(12); this.bHash = new SpatialHash(16); this.rHash = new SpatialHash(12);
    this.nav = new NavGrid(this.size, 2);
    this.reserved = new Uint8Array(this.nav.n * this.nav.n);   // building footprints (also before they block the pathfinder)
    this.events = [];
    this.dead = [];
    this.timers = [];              // later(): [time, fn]
    this.effects = [];             // periodicEffect()
    this.spirits = [];             // souls of fallen units (Aje shaman: Resurrect)
    this.wildNests = [];           // nests of original maps: respawn wild animals (systems/animals.js)
    this.wallMap = new WallMap(...(opts.wallGrid || [4, 4]));   // the 8 m wall grid (game/wallmap.js)
    this.playHalf = opts.playHalf || this.size / 2;
    const h = this.playHalf;
    this.play = opts.play || { x0: -h, x1: h, z0: -h, z1: h };   // playable rectangle
    this.waterNav = null;                                       // ships / swimmers (markWater)
    // the setting's wood log carried by workers (product_wood_jun / _nor / _sav / _ice / _ash)
    const key = { Jungle: 'jun', Northland: 'nor', Savanna: 'sav', Icewaste: 'ice', Ashvalley: 'ash' }[opts.setting || 'Jungle'];
    this.productWood = this.templates && this.templates('product_wood_' + key, true) ? 'product_wood_' + key : 'product_wood_jun';
  }
  // height a unit stands at: the ground, or the water surface for ships (swimming animals a little below it)
  groundY(u) {
    const g = this.height(u.pos.x, u.pos.z);
    if (this.waterLevel == null) return g;
    if (u.naval) return Math.max(g, this.waterLevel - (u.cls === 'SHIP' ? 0.1 : 0.5));
    if (u.amphib) return Math.max(g, this.waterLevel - 0.2);
    return g;
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
      for (let k = 0; k < A.block.length; k++) A.block[k] = Math.min(L.block[k], Wn.block[k]);
      A.key = key; A.ampT = this.time; A.version++;
    }
    return A;
  }
  // water of the original maps (level in m): land units can wade 0.4 m deep, ships need 1.5 m
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
  emit(type, data) { this.events.push({ type, ...data }); }
  // run fn after `sec` game seconds (hit delays, knockbacks, delayed effects)
  later(sec, fn) { if (sec <= 0) { fn(); return; } this.timers.push([this.time + sec, fn]); }
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
    const nv = this.navFor({ naval: !!opts.swim || (this.data.info(name)?.type === 'SHIP' && !AMPHIBIOUS.test(name)), amphib: AMPHIBIOUS.test(name) });
    if (!nv.isFree(x, z)) { const c = nv.nearestFree(nv.idx(x, z)); [x, z] = nv.center(c); }
    const u = new Unit(this, name, owner, x, z, level || this.defaultLevel(name, owner), heading, opts);
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
        this.later(180, () => { if (u.alive) this.kill(u, null); });
      }
    }
    return u;
  }
  defaultLevel(name, owner) { return this.data.minLevel(name, owner); }

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
    if (level === 5 && !u.def.unique) {
      const f = `${u.def.tribe}/Upgrades/${u.name}/Chief_Bonus`;
      on ? p.tt.enable(f) : p.tt.disable(f);
    }
  }
  placeBuilding(name, owner, x, z, rot = 0, built = true) {
    const b = new Building(this, name, owner, x, z, rot, built);
    this.buildings.push(b);
    this.bHash.insert(b);
    this.emit('ground', { x: b.pos.x, z: b.pos.z, r: b.radius + 2 });   // ground cover (grass) under it goes away
    if (b.def.wallKind) this.wallMap.add(b);                            // walls, gates, towers, traps: the wall grid
    if (built) {
      this.entityFilters(b, true);
      this.recomputeCaps(owner);
      if (b.behaviour && b.behaviour.built) b.behaviour.built(b, this);
    }
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
  victory(p) { p.won = true; for (const o of this.players) if (!p.isFriend(o)) o.defeated = true; this.emit('victory', { player: p }); }

  // ------------------------------------------------------------------ orders (from the player or the AI)
  // o.type: move | attackmove | attack | stop | hold | gather | build | repair | deliver | heal | board | unload
  order(units, o) {
    for (const u of units) {
      if (!u.alive || u.kind !== 'unit' || u.autonomous) continue;
      if (u.stationary && /move|gather|build|board|trade|repair|deliver/.test(o.type)) continue;   // mines / water turrets
      if (u.name === 'aje_torpedo_turtle' && o.type !== 'kill') continue;                          // obeys nothing but Kill
      if (u.inside) { if (o.type === 'unload') this.leaveTransport(u); continue; }
      if (active(u, 'trapped', this.time) && u.st.trapWhy === 'dig') continue;
      if (u.st.camo.has('entr')) this.digOut(u);
      if (u.st.camo.has('aje') && o.type !== 'move') this.setCamo(u, 'aje', false);
      this.releaseTask(u);
      u.busyAnim = false;
      const user = o.auto ? false : true;
      switch (o.type) {
        case 'move': case 'attackmove':
          u.task = { type: o.type, x: o.x, z: o.z, user, then: o.then || null };   // then: next order on arrival
          u.setPath(o.x, o.z);
          u.anchor.set(o.x, o.z);
          break;
        case 'attack':
          if (o.target && o.target.kind === 'res') { this.startGather(u, o.target); break; }
          u.task = { type: 'attack', target: o.target, user, forceAttack: !!o.force }; u.repathT = 0;
          break;
        case 'stop': u.task = { type: 'idle' }; u.path = []; u.anchor.set(u.pos.x, u.pos.z); break;
        case 'hold': u.task = { type: 'hold' }; u.path = []; u.anchor.set(u.pos.x, u.pos.z); break;
        case 'gather': u.task = { type: 'idle', user }; this.startGather(u, o.target); break;
        case 'build': u.task = { type: 'idle', user }; this.startBuild(u, o.target); break;
        case 'repair': u.task = { type: 'idle', user }; this.startRepair(u, o.target); break;
        case 'deliver': u.task = { type: 'gather', res: u.carry ? u.carry.res : 'food', phase: 'deliver', drop: o.target || null, user }; break;
        case 'heal': if (u.stats.heal) { u.task = { type: 'heal', target: o.target, user }; u.repathT = 0; } break;
        case 'board': if (this.canBoard(u, o.target)) u.task = { type: 'board', target: o.target, user }; break;
        case 'unload': if (u.passengers) this.unloadAll(u, false); break;
        case 'trade': this.startTrade(u, o.target); break;
      }
    }
  }
  releaseTask(u) {
    const t = u.task;
    if (t.node) t.node.workers.delete(u);
    if (t.building) { t.building.builders.delete(u); t.building.freeSlot(u); }
    if (t.farm) t.farm.workers.delete(u);
    u.attachTool(null);
    this.stopHealing(u);
  }

  // ------------------------------------------------------------------ per-unit update
  unitUpdate(u, dt) {
    if (!u.alive) return this.deadUnitUpdate(u, dt);
    if (u.inside) { this.passengerUpdate(u, dt); return; }
    if (u.invulnT > 0) u.invulnT -= dt;
    if (u.st.poison) this.poisonUpdate(u);
    if (u.pending) { u.pending.t -= dt; if (u.pending.t <= 0) { const p = u.pending; u.pending = null; this.fire(u, p.w, p.target); } }
    if (u.queue.length) this.productionUpdate(u, dt);
    // knockback slide / jetpack jump
    if (u.knock) { const k = u.knock; const s = Math.min(dt, k.t); u.pos.x += k.vx * s; u.pos.z += k.vz * s; k.t -= dt; if (k.t <= 0) u.knock = null; }
    if (u.jumpFx) {
      const j = u.jumpFx; j.t += dt; const f = Math.min(1, j.t / j.T);
      u.pos.x = j.from.x + (j.to.x - j.from.x) * f; u.pos.z = j.from.z + (j.to.z - j.from.z) * f;
      u.jumpH = Math.sin(f * Math.PI) * Math.min(20, j.T * 8);
      if (f >= 1) { u.jumpFx = null; u.jumpH = 0; u.anchor.set(u.pos.x, u.pos.z); }
    }
    // trapped, frozen, stunned: no actions
    if (active(u, 'trapped', this.time)) { u.path = []; u.vel.set(0, 0, 0); this.animTick(u, dt); return; }
    if ((this.waterNav || u.naval) && this.navalUnitUpdate(u, dt)) { this.animTick(u, dt); return; }
    const t = u.task;
    switch (t.type) {
      case 'heal': this.healUpdate(u, dt); break;
      case 'idle': case 'hold': this.idleUpdate(u, dt); break;
      case 'move': case 'attackmove': {
        if (t.type === 'attackmove') {
          u.scanT = (u.scanT || 0) - dt;
          if (u.scanT <= 0) { u.scanT = 0.4; const e = this.findTarget(u, Math.max(30, this.alarmRange(u))); if (e) { u.task = { type: 'attack', target: e, amove: [t.x, t.z], user: false, auto: true }; break; } }
        }
        const sp = u.steer(dt, u.task.user && !t.back ? u.runSpeed : u.speed, 0.8);
        u.moveAnim(sp, u.task.user && u.runSpeed > u.speed * 1.2);
        if (!u.path.length) { const next = t.then; u.task = { type: 'idle' }; if (next) this.order([u], next); }
        break;
      }
      case 'attack': this.attackUpdate(u, dt); break;
      case 'gather': this.gatherUpdate(u, dt); break;
      case 'build': this.buildUpdate(u, dt); break;
      case 'roam': this.roamUpdate(u, dt); break;
      case 'flee': this.fleeUpdate(u, dt); break;
      case 'special': this.specialUpdate(u, dt); break;
      case 'board': this.boardUpdate(u, dt); break;
      case 'trade': this.tradeUpdate(u, dt); break;
      case 'entrench': u.vel.set(0, 0, 0); break;
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
    u.scanT = (u.scanT || Math.random()) - dt;
    if (u.scanT > 0) return;
    u.scanT = 0.9 + Math.random() * 0.2;
    // healers look for someone to heal
    if (u.stats.heal && u.owner) {
      const o = this.healScan(u);
      if (o && (t.type === 'idle' || u.distTo(o) - o.radius <= u.stats.heal.radius)) { u.task = { type: 'heal', target: o, hold: t.type === 'hold' }; return; }
    }
    if (!u.weapons.long || u.cannotFight || u.stance === 3 || u.stance === 1) return;
    const cs = u.cs(u.weapons.long);
    const hold = t.type === 'hold' || u.stance === 0;
    const r = hold ? this.attackRangeOf(u, cs) + u.radius + 2 : Math.max(this.attackRangeOf(u, cs), 30);
    const e = this.findTarget(u, r, { leash: !hold, filter: hold ? (x) => this.rangeZone(u, x).zone > 0 : null });
    if (e) this.engage(u, e, { hold });
  }
  deadUnitUpdate(u, dt) {
    u.deadT += dt;
    u.anim.update(dt);
    const stay = u.corpseNode ? (u.corpseGone ? 0 : 1e9) : 12;
    if (u.corpseNode && u.corpseNode.alive) { u.corpseNode.rotT -= dt; if (u.corpseNode.rotT <= 0) this.depleteNode(u.corpseNode); }
    if (u.comp && u.comp.wagon) u.comp.syncWagon(0);
    if (u.silentDeath && !u.removed) { this.scene.remove(u.obj); if (u.comp) u.comp.dispose(); u.removed = true; return; }
    if (u.deadT > stay) { u.obj.position.y -= dt * 0.6; if (u.deadT > stay + 4) { this.scene.remove(u.obj); if (u.comp) u.comp.dispose(); u.removed = true; } }
  }

  // ------------------------------------------------------------------ per-building update
  buildingUpdate(b, dt) {
    if (!b.alive) {
      if (b.removed) return;
      b.deadT += dt;
      if (b.ruin) { if (b.deadT > 8) { b.ruin.position.y -= dt * 1.0; if (b.deadT > 20) { this.scene.remove(b.ruin); b.removed = true; } } }
      else { b.obj.position.y -= dt * b.ht * 0.25; if (b.deadT > 5) { this.scene.remove(b.obj); b.removed = true; } }
      return;
    }
    b.updateAnim(dt, this.time);
    b.updateVisual();
    this.damageFx(b, dt);
    if (!b.built) { this.constructionUpdate(b, dt); return; }
    if (b.dismantling) { this.buildDownUpdate(b, dt); return; }
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
      if (!this._resBy.has(k)) this._resBy.set(k, this.movesOf(u).some((a) => a.id === 'Resurrect'));
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
  nearestSpirit(p, x, z, r = 8) { let best = null, bd = r; for (const s of this.spirits) { if (s.owner !== p || !s.alive) continue; const d = Math.hypot(s.pos.x - x, s.pos.z - z); if (d < bd) { bd = d; best = s; } } return best; }
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
      if (due.length) { this.timers = this.timers.filter((x) => x[0] > this.time); for (const [, fn] of due) fn(); }
    }
    this.effectsTick(dt);
    this.effectsUpdate();
    if (this.spirits.length) this.spiritTick(dt);
    if (this.wildNests.length) this.wildNestsUpdate(dt);
    this.refreshT = (this.refreshT || 0) - dt;
    if (this.refreshT <= 0) { this.refreshT = 0.5; this.refreshTick(); }
    for (let i = 0; i < this.units.length; i++) this.unitUpdate(this.units[i], dt);
    for (let i = 0; i < this.buildings.length; i++) this.buildingUpdate(this.buildings[i], dt);
    for (const p of this.projectiles) this.projectileUpdate(p, dt);
    this.projectiles = this.projectiles.filter((p) => p.alive);
    this.separation(dt);
    for (const u of this.units) if (u.alive && !u.inside) { u.pos.y = this.groundY(u) + (u.jumpH || 0); u.syncObj(); this.uHash.move(u); }
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
      if (!a.alive || a.inside) continue;
      this.uHash.query(a.pos.x, a.pos.z, a.radius + 6, (b) => {
        if (b === a || !b.alive || b.inside || b.id < a.id || !!b.naval !== !!a.naval) return;
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
Object.assign(World.prototype, Effects, Combat, Economy, Construction, Production, Healing, Moves, BuildingBehaviours, Animals, Transport, Naval);
