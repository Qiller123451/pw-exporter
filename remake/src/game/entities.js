import * as THREE from 'three';
import { AnimCtl } from './anim.js';
import { cloneModel } from '../engine/assets.js';
import { applyFow } from '../engine/terrain.js';
import { applyState } from '../engine/parts.js';
import { SPEED_FALLBACK } from './rules.js';
import { wallBoxes, DIRS } from './wallmap.js';
import { Composite, attach, activeParts, partGfx } from './compose.js';
import { newStatus } from './systems/effects.js';
import { LocalTree } from './techtree.js';

const TAU = Math.PI * 2;
export function wrap(a) { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; }
export function headingTo(dx, dz) { return Math.atan2(-dx, -dz); }
let NEXT_ID = 1;

// units that move on land and water (naval.md §3)
export const AMPHIBIOUS = /^(aje_transport_turtle|seas_hovercraft|seas_helicopter|ninigi_baryonyx|baryonyx|macrolemys)$/i;

export class Entity {
  constructor(world, kind, owner, x, z) {
    this.id = NEXT_ID++;
    this.world = world;
    this.kind = kind;
    this.owner = owner;          // Player or null (wild / neutral)
    this.pos = new THREE.Vector3(x, world.height(x, z), z);
    this.heading = 0;
    this.radius = 1;
    this.alive = true;
    this.obj = null;
    this.hp = 1; this.maxHp = 1;
    this.selected = false;
    this.st = newStatus();         // status effects, auras, camouflage, poison (systems/effects.js)
    this.cd = new Map();           // special move cooldowns: action id -> game time when ready again
    this.lastHitDone = -99;        // time of the last attack (the next is allowed after the weapon's duration)
    this.attackers = new Set();    // who hit us (targets we may fight back against)
    this.localTT = null;           // own tech tree for "local" upgrades (farm modes, big tent, defensive mode ...)
    this.anchor = new THREE.Vector2(x, z);   // post the unit returns to after automatic fights (m_vAggressionPos)
  }
  // the tree rules are read from: the owner's, or this object's own local tree
  rulesOwner() {
    if (!this.localTT) return this.owner;
    if (!this._ro) { const o = this.owner; this._ro = { tt: this.localTT, tribe: o.tribe, get debug() { return !!o.debug; } }; }
    return this._ro;
  }
  // derived combat values of a weapon (default: the weapon in hand), after the tribe's modifiers
  // the owner's party colour (0xRRGGBB) for tinting models, null = untinted
  get party() { return this.owner && this.owner.partyColor != null ? this.owner.partyColor : null; }
  cs(w) { w = w || this.weapon || (this.weapons && this.weapons.long); return w ? this.world.data.weaponStats(w, this.name, this.rulesOwner()) : null; }
  distTo(e) { return Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z); }
  edgeDist(e) {
    if (e.kind === 'building' && e.surfDist) return Math.max(0, e.surfDist(this.pos.x, this.pos.z) - (this.kind === 'building' ? 0 : this.radius));
    return Math.max(0, this.distTo(e) - this.radius - e.radius);
  }
  isEnemy(e) {
    if (!e || !e.alive || e === this) return false;
    if (!this.owner || !e.owner) return !!(this.owner || e.owner) && (e.kind === 'unit' || e.kind === 'building');  // wild vs player
    return this.owner.isEnemy(e.owner);
  }
}

// ======================================================================= units (characters, animals, vehicles)
export class Unit extends Entity {
  constructor(world, name, owner, x, z, level = 1, heading = 0, opts = {}) {
    super(world, 'unit', owner, x, z);
    const D = world.data;
    this.name = name;
    this.def = D.def(name, owner);
    this.cls = this.def.type;
    this.level = level;
    this.heading = heading;
    this.task = { type: 'idle' };
    this.path = [];
    this.vel = new THREE.Vector3();
    this.carry = null;            // {res, amount, look}
    // stance: 2 aggressive (default), 1 defensive (workers), 0 hold ground, 3 never fights on its own (poisoner)
    this.stance = /worker/.test(name) ? 1 : name === 'aje_poisoner' ? 3 : 2;
    this.wild = !owner;
    this.queue = [];              // producer units (Aje resource collector)
    this.lastHit = -99;
    this.home = new THREE.Vector2(x, z);
    this.illusion = !!opts.illusion;          // druid illusions: no moves, no levels, vanish after 60 s
    this.autonomous = !!opts.autonomous;      // kennel / nest animals: not controlled by the player
    this.naval = !!opts.swim || this.cls === 'SHIP';   // moves on the water grid (world.navFor)
    this.amphib = AMPHIBIOUS.test(name);                // land and water (transport turtle, hovercraft, baryonyx, macrolemys)
    if (this.amphib) this.naval = false;
    this.stationary = !!opts.stationary || /mineship_mine|water_turret/.test(name);   // mines, water turrets
    this.countsInPop = !(opts.illusion || opts.autonomous) && !/mineship_mine|water_turret|torpedo_turtle/.test(name);   // naval.md §2.3
    this.applyLevel(level, true);
  }
  get isWorker() { return !!this.def.can_harvest; }
  get canBuild() { return !!(this.def.can_build || this.def.can_harvest) && this.cls === 'CHTR'; }
  get isDropoff() { return this.def.delivery && this.def.delivery.length > 0; }
  get canWalk() { return (this.stats.maxspeed || this.stats.speed || 1) > 0 && !this.st.camo.has('entr'); }
  get cannotFight() { return !this.weapons.long || /resource_collector|_cart$|trade_dino|smokebomb|drums$|siegetower|hovercraft|transport_ship|transport_boat|fishing_boat|minelayer|corsair|mineship_mine|torpedo_turtle/.test(this.name); }
  applyLevel(level, initial) {
    const up = !initial && level > this.level;
    const ratio = initial ? 1 : this.hp / this.maxHp;
    this.level = level;
    this.readRules();
    this.hp = initial || up ? this.maxHp : Math.max(1, ratio * this.maxHp);   // a level up heals fully
    this.buildModel();
  }
  // (re)read class data, stats and weapons from the tech tree; called after level changes and tree changes
  readRules() {
    const D = this.world.data, O = this.rulesOwner();
    this.def = D.def(this.name, O);
    this.stats = D.statsAt(this.name, this.level, O);
    this.maxHp = this.stats.hp;
    this.weapons = D.weaponSet(this.name, this.level, O);
    if (!this.weapon || !this.weapons.all.includes(this.weapon)) this.weapon = this.weapons.long;
    this.fow = this.stats.fow || 30;
    this.ttVersion = O && O.tt ? O.tt.version : 0;
  }
  // the tech tree changed (upgrade, building, level filter): new values; hit point ratio kept, model swapped if needed
  refreshRules() {
    const ratio = this.hp / this.maxHp;
    const gfx = this.gfx;
    const w0 = this.weapons && this.weapons.long;
    this.readRules();
    this.hp = Math.max(1, Math.min(this.maxHp, ratio * this.maxHp));
    this._ro = null;
    const g = this.camoGfx || this.stats.gfx;
    if (g !== gfx) this.buildModel();
    else if (w0 !== this.weapons.long) this.attachWeapon(this.weapons.long);
    this.autoMovesCache = null;
  }
  // switch the weapon in hand (short / medium / long)
  useWeapon(w) {
    if (!w || this.weapon === w) return;
    this.weapon = w;
    const parts = w.parts && w.parts.length ? w.parts[0].gfx[0] : null;
    const held = this.heldWeapon && this.heldWeapon.parts && this.heldWeapon.parts[0] ? this.heldWeapon.parts[0].gfx[0] : null;
    if (parts && parts !== held) this.attachWeapon(w); else this.heldWeapon = w;
  }
  // Aje shaman camouflage: looks like a harmless jungle animal
  setCamoLook(on) { this.camoGfx = on ? 'parasaurolophus' : null; this.buildModel(); }
  buildModel() {
    const W = this.world;
    this.gfx = (this.camoGfx && W.template(this.camoGfx, true) ? this.camoGfx : null) || this.stats.gfx;
    if (!W.template(this.gfx, true) && W.data.classGfx(this.name)) this.gfx = W.data.classGfx(this.name);   // tech tree gfx missing: class file gfx
    if (!W.template(this.gfx, true) && W.standIns && W.standIns.get(this.name.toLowerCase())) this.gfx = W.standIns.get(this.name.toLowerCase());   // no model in the game data: the mission's stand-in
    const tpl = this.tpl = W.template(this.gfx);
    if (this.obj) { W.scene.remove(this.obj); this.anim && this.anim.dispose(); }
    if (this.comp) this.comp.dispose();
    const g = new THREE.Group();
    const m = cloneModel(tpl, this.party);
    g.add(m);
    this.model = m;
    this.obj = g;
    this.anim = new AnimCtl(m, tpl.clips);
    // animation sound events (footsteps, weapon swings, roars) from the GSF sound table
    const snd = (tpl.info && tpl.info.sounds) || W.templateInfo(tpl.info && tpl.info.anims)?.sounds;
    if (snd) this.anim.setEvents(snd, (ev) => W.animSound(this, ev));
    // collision radius from the template size
    if (!tpl.radius) {
      const box = new THREE.Box3().setFromObject(tpl.scene);
      const sx = box.max.x - box.min.x, sz = box.max.z - box.min.z;
      tpl.radius = Math.max(0.45, Math.min(Math.min(sx, sz) * 0.42, 6));
      tpl.height = Math.max(1.5, box.max.y - box.min.y);
    }
    this.radius = this.cls === 'CHTR' ? Math.min(tpl.radius, 0.7) : tpl.radius;
    this.height = tpl.height;
    // speeds from the model's walk animations
    const sp = (tpl.info && tpl.info.speeds) || {};
    const speedsTpl = sp.walk_1 ? sp : ((W.templateInfo(tpl.info && tpl.info.anims) || {}).speeds || {});
    const idx = this.def.type === 'ANML' && this.owner ? (this.stats.maxspeed || this.stats.speed || 1) : this.stats.speed || 1;   // owned animals always use maxspeed
    const idxMax = Math.max(idx, this.stats.maxspeed || idx);
    // the model's walk set (GSF): "defn" if it has one (the newer SEAS / hero walks walk_<n>_new), else "def"
    // (FightingObj.usl: m_xWalkSet = "defn" if HasWalkSet). Slots 1..3 = walk speeds.
    const ws = (tpl.info && tpl.info.walk) || {};
    const wn = (i) => ws[String(i)] || 'walk_' + i;
    this.walkAnim = this.anim.pick(wn(idx), 'walk_' + idx, wn(2), 'walk_2', 'walk_1') || null;
    this.runAnim = this.anim.pick(wn(idxMax), 'walk_' + idxMax, wn(idx), 'walk_2') || this.walkAnim;
    this.speed = speedsTpl['walk_' + idx] || SPEED_FALLBACK[idx] || 3;
    this.runSpeed = speedsTpl['walk_' + idxMax] || SPEED_FALLBACK[idxMax] || this.speed;
    this.animSpeed = speedsTpl[wn(idx)] || this.speed; this.runAnimSpeed = speedsTpl[wn(idxMax)] || this.runSpeed;
    if (this.wild) { this.walkAnim = this.anim.pick(wn(1), 'walk_1', this.walkAnim); this.speed = speedsTpl.walk_1 || 1.5; this.animSpeed = speedsTpl[wn(1)] || this.speed; }
    this.idleAnim = this.anim.pick(this.def.standanim, 'standanim', 'idle_0', 'stand');
    this.anim.play(this.idleAnim);
    // weapon parts on hand links
    this.attachWeapon(this.weapons.long);
    W.scene.add(g);
    this.syncObj();
    // build-ups, captain, collector wagon, render mask (saddle / party colour / armour / wounds)
    this.comp = new Composite(this);
    this.comp.build();
  }
  attachWeapon(w) {
    if (this.heldWeapon === w) return;
    this.heldWeapon = w;
    if (this.weaponObjs) for (const o of this.weaponObjs) o.removeFromParent();
    this.weaponObjs = [];
    if (!w || !w.parts) return;
    for (const p of w.parts) {
      const link = this.findLink(p.link);
      const gfx = p.gfx && p.gfx[0];
      if (!link || !gfx) continue;
      const tpl = this.world.template(gfx, true);
      if (!tpl) continue;
      const o = cloneModel(tpl, this.party);
      const inner = o.children[0];
      if (inner) inner.rotation.set(0, 0, 0);    // link frame is already the model's Z-up frame
      link.add(o);
      this.weaponObjs.push(o);
    }
  }
  attachTool(gfx, linkName = 'HndR') {
    if (this.toolObj && this.toolGfx === gfx) return;
    if (this.toolObj) { this.toolObj.removeFromParent(); this.toolObj = null; }
    this.toolGfx = gfx;
    if (!gfx) { if (this.weaponObjs && !this.carryObj) for (const o of this.weaponObjs) o.visible = true; return; }
    const link = this.findLink(linkName);
    const tpl = this.world.template(gfx, true);
    if (!link || !tpl) return;
    if (this.weaponObjs) for (const o of this.weaponObjs) o.visible = false;
    const o = cloneModel(tpl, this.party);
    if (o.children[0]) o.children[0].rotation.set(0, 0, 0);
    link.add(o);
    this.toolObj = o;
  }
  // carried resources (SetThing): wood / field harvest on the shoulder (walk set "sldr"), stone and food in the tribe's
  // container (walk set "cary": Hu pannier, Aje clay jug, Ninigi basket, SEAS backpack)
  // look = [link, gfx, walkset] from economy.carryLook()
  setCarry(res, amount, look) {
    const prevLook = this.carry && this.carry.look;
    this.carry = res && amount > 0 ? { res, amount, look: look || prevLook || null } : null;
    if (this.carryObj) { this.carryObj.removeFromParent(); this.carryObj = null; }
    if (!this.carry || !this.carry.look) { if (this.weaponObjs && !this.toolObj) for (const w of this.weaponObjs) w.visible = true; return; }
    const [link, gfx] = this.carry.look;
    const l = this.findLink(link);
    const tpl = this.world.template(gfx, true);
    if (!l || !tpl) return;
    const o = cloneModel(tpl, this.party);
    if (o.children[0]) o.children[0].rotation.set(0, 0, 0);
    l.add(o);
    this.carryObj = o;
    if (this.weaponObjs) for (const w of this.weaponObjs) w.visible = false;
  }
  // script visibility flag (SetRndInvMaskSingleFlagInv) on the unit's own parts
  setVisFlag(bit, on) {
    this.model.traverse((o) => { if (o.isMesh && o.userData.attr !== undefined && ((o.userData.attr >>> bit) & 1)) o.visible = on; });
  }
  walkSet() { return !this.carry ? '' : this.carry.look ? this.carry.look[2] : this.carry.res === 'wood' ? 'shoulder' : 'carry'; }
  standAnim() {
    const ws = this.walkSet();
    if (ws === 'shoulder') return this.anim.pick('shoulder_standanim') || this.idleAnim;
    if (ws === 'carry') return this.anim.pick('standing') || this.idleAnim;
    if (this.fightStandT > 0) return this.anim.pick(this.fightStand()) || this.idleAnim;
    return this.idleAnim;
  }
  // idle behaviour from IdleAnims.txt: weighted random choice of stand/idle animations, each for a few loops
  idleTick(dt) {
    if (this.busyAnim) return;
    if (this.carry || this.fightStandT > 0) { this.idleCur = null; this.anim.play(this.standAnim()); return; }
    const set = this.world.data.idleSet(this.name);
    if (!set) { this.anim.play(this.idleAnim); return; }
    this.idleLeft = (this.idleLeft || 0) - dt;
    if (this.idleCur && this.idleLeft > 0) { if (this.anim.curName !== this.idleCur) this.anim.play(this.idleCur); return; }
    const opts = set.filter((e) => this.anim.has(e[0]));
    if (!opts.length) { this.anim.play(this.idleAnim); return; }
    let r = Math.random() * opts.reduce((a, e) => a + e[3], 0), pick = opts[0];
    for (const e of opts) { r -= e[3]; if (r <= 0) { pick = e; break; } }
    const loops = pick[1] + Math.floor(Math.random() * (pick[2] - pick[1] + 1));
    this.idleCur = pick[0].toLowerCase();
    this.idleLeft = Math.max(0.5, loops * this.anim.duration(this.idleCur));
    this.anim.play(this.idleCur, { restart: this.anim.curName !== this.idleCur, fade: 0.25 });
  }
  // caste specific combat stance (res/nat/tec)
  fightStand() {
    const c = this.def.caste || (this.owner && this.owner.tribe === 'SEAS' ? 'tec' : 'nat');
    return c === 'tec' ? this.anim.pick('tec_fightpos_standanim', 'res_fight_standanim') : c === 'res' ? this.anim.pick('res_fight_standanim', 'nat_fight_standanim') : this.anim.pick('nat_fight_standanim', 'res_fight_standanim');
  }
  findLink(name) {
    if (!name) return null;
    if (!this._links) { this._links = {}; this.model.traverse((o) => { if (o.name.startsWith('link_')) this._links[o.name.slice(5)] = o; }); }
    return this._links[name] || null;
  }
  syncObj() {
    if (!this.obj) return;
    this.obj.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.obj.rotation.y = this.heading;
  }
  // -------------------------------------------------------- movement
  setPath(x, z) {
    const p = this.world.navFor(this).find(this.pos.x, this.pos.z, x, z, this.radius, 30000, this.owner);
    this.path = p || [];
    this.goal = [x, z];
    this.stuckT = 0; this.stuckFrom = this.pos.clone();
    return this.path.length > 0;
  }
  steer(dt, speed, arrive = 0.8) {
    if (!this.path.length) { this.vel.set(0, 0, 0); return 0; }
    let [tx, tz] = this.path[0];
    let dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
    const last = this.path.length === 1;
    if (d < (last ? arrive : Math.max(1.5, this.radius * 1.5))) {
      this.path.shift();
      if (!this.path.length) { this.vel.set(0, 0, 0); return 0; }
      [tx, tz] = this.path[0]; dx = tx - this.pos.x; dz = tz - this.pos.z; d = Math.hypot(dx, dz);
    }
    const want = headingTo(dx, dz);
    const diff = wrap(want - this.heading);
    const turn = (this.cls === 'CHTR' ? 9 : this.radius > 3 ? 1.6 : 3.2) * dt;
    this.heading = wrap(this.heading + Math.sign(diff) * Math.min(Math.abs(diff), turn));
    let sp = speed * Math.max(0.2, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
    if (last) sp = Math.min(sp, d * 2 + 0.6);
    // local avoidance: if the step would enter a blocked cell, slide along the obstacle
    const nav = this.world.navFor(this);
    let hx = -Math.sin(this.heading), hz = -Math.cos(this.heading);
    const look = Math.max(0.8, this.radius);
    if (!nav.isFree(this.pos.x + hx * look, this.pos.z + hz * look)) {
      for (const da of [0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
        const a = this.heading + da, ax = -Math.sin(a), az = -Math.cos(a);
        if (nav.isFree(this.pos.x + ax * look, this.pos.z + az * look)) { hx = ax; hz = az; break; }
      }
    }
    this.vel.set(hx * sp, 0, hz * sp);
    // hard collision with buildings / walls / blocked terrain: never step from a free cell into a blocked one;
    // slide along the obstacle on one axis instead (units already inside a blocked cell may walk out)
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    if (this.canWalkInto(nav, nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
    else if (this.canWalkInto(nav, nx, this.pos.z)) { this.pos.x = nx; this.vel.z = 0; }
    else if (this.canWalkInto(nav, this.pos.x, nz)) { this.pos.z = nz; this.vel.x = 0; }
    else this.vel.set(0, 0, 0);
    this.stuckT += dt;
    if (this.stuckT > 1.5) {
      if (this.pos.distanceTo(this.stuckFrom) < 0.6 && this.goal) {
        this.stuckN = (this.stuckN || 0) + 1;
        // repeatedly stuck: step to the nearest free cell first, then path again
        if (this.stuckN >= 2) { const c = nav.nearestFree(nav.idx(this.pos.x, this.pos.z), 6); const [fx, fz] = nav.center(c); if (nav.block[nav.idx(this.pos.x, this.pos.z)]) { this.pos.x = fx; this.pos.z = fz; } this.stuckN = 0; }
        const g = this.goal; this.setPath(g[0], g[1]);
      } else this.stuckN = 0;
      this.stuckT = 0; this.stuckFrom.copy(this.pos);
    }
    return sp;
  }
  // may this unit move to (x, z)? Blocked cells are off limits unless the unit already stands in one
  // (then any move is allowed so it can get out). Gates are checked per owner (nav.gateBlocks).
  canWalkInto(nav, x, z) {
    const k = nav.idx(x, z), cur = nav.idx(this.pos.x, this.pos.z);
    if (k === cur || nav.block[cur]) return true;
    if (nav.block[k]) return false;
    return !(nav.gateAt.size && nav.gateBlocks(k, this.owner));
  }
  face(x, z, dt, rate = 6) {
    const want = headingTo(x - this.pos.x, z - this.pos.z);
    const diff = wrap(want - this.heading);
    this.heading = wrap(this.heading + Math.sign(diff) * Math.min(Math.abs(diff), rate * dt));
    return Math.abs(diff);
  }
  moveAnim(sp, run) {
    if (sp > 0.15) {
      let a = run ? this.runAnim : this.walkAnim;
      const as = run ? this.runAnimSpeed : this.animSpeed;
      const ws = this.walkSet();
      if (ws) { const i = Math.min(3, Math.max(1, this.stats.speed || 2)); a = this.anim.pick(ws + '_walk_' + i, ws + '_walk_2', ws + '_walk_1') || a; }
      this.anim.play(a, { ts: Math.max(0.4, Math.min(1.8, sp / as)), cut: true });   // moving off: no end part of the last action first
    } else if (!this.busyAnim) this.anim.play(this.standAnim());
  }
}

// ======================================================================= buildings
// Footprint boxes from the GSF pathfinder table (type 1 = box: min corner + size in the model's Z-up space).
// Returns boxes as [cx, cz, hx, hz] in the building's local (three.js, Y-up) frame.
export function footBoxes(tpl) {
  if (tpl._boxes) return tpl._boxes;
  const pf = (tpl.info && tpl.info.pf) || (tpl.extras && tpl.extras.pf);
  let boxes = [];
  if (pf) for (const r of pf) if (r[0] === 1 && r[4] > 0.5 && r[5] > 0.5) boxes.push([r[1] + r[4] / 2, -(r[2] + r[5] / 2), r[4] / 2, r[5] / 2]);
  if (!boxes.length) {
    const foot = tpl.info && tpl.info.foot;
    if (foot) boxes = [[foot[0], foot[1], foot[2] * 0.9, foot[3] * 0.9]];
    else {
      const box = new THREE.Box3().setFromObject(tpl.scene);
      boxes = [[(box.max.x + box.min.x) / 2, (box.max.z + box.min.z) / 2, (box.max.x - box.min.x) / 2 * 0.9, (box.max.z - box.min.z) / 2 * 0.9]];
    }
  }
  tpl._boxes = boxes;
  return boxes;
}
// world-space footprint of a building template placed at (x, z) with rotation rot
// Wall pieces are hubs with arms in 8 directions (the engine's WallMap shows the arms towards connected
// neighbours). A straight segment uses the hub plus the east and west arms: 8 m long, on the 8 m wall grid.
export const WALL_BOXES = wallBoxes(0);      // a lone wall post (the arms come from the WallMap, see setArms)
export function placeFootprint(tpl, x, z, rot, margin = 0, boxesOverride = null) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const src = boxesOverride || footBoxes(tpl);
  const boxes = src.map(([bx, bz, hx, hz]) => [x + bx * c + bz * s, z - bx * s + bz * c, hx + margin, hz + margin]);
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [bx, bz, hx, hz] of src) { x0 = Math.min(x0, bx - hx); x1 = Math.max(x1, bx + hx); z0 = Math.min(z0, bz - hz); z1 = Math.max(z1, bz + hz); }
  const lcx = (x0 + x1) / 2, lcz = (z0 + z1) / 2;
  return { boxes, fx: x + lcx * c + lcz * s, fz: z - lcx * s + lcz * c, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, rot };
}

const CRANE_LINKS = ['Cr_1', 'Cr_2', 'Cr_3', 'Cr_4'];
export class Building extends Entity {
  constructor(world, name, owner, x, z, rot = 0, built = true) {
    super(world, 'building', owner, x, z);
    const D = world.data;
    this.name = name;
    this.def = D.def(name, owner);
    this.cls = 'BLDG';
    this.level = 1;
    this.stats = D.stats(name, 1, owner);
    this.maxHp = this.stats.hp;
    this.behaviour = world.behaviourOf ? world.behaviourOf(this) : null;
    this.rot = rot;
    this.progress = built ? 1 : 0;
    this.built = built;
    this.hp = built ? this.maxHp : 1;
    this.queue = [];
    this.rally = null;
    this.builders = new Set();
    this.weapons = D.weaponSet(name, 1, owner);
    this.weapon = this.weapons.long;
    this.fow = this.stats.fow || 40;
    this.cool = 0;
    this.workers = new Set();     // farm workers
    this.gfx = this.stats.gfx;
    this.ttVersion = owner && owner.tt ? owner.tt.version : 0;
    const tpl = this.tpl = world.template(this.stats.gfx, true);
    // wall pieces: hub + the arms towards connected neighbours (wallmap.js); they start as a lone post
    this.armMask = 0;
    const F = placeFootprint(tpl, x, z, rot, 0, this.def.wallKind === 'wall' ? wallBoxes(0, world.nav.cell) : null);
    this.boxes = F.boxes;
    this.hx = Math.max(2, F.hx); this.hz = Math.max(2, F.hz);
    const bb = new THREE.Box3().setFromObject(tpl.scene);
    this.ht = Math.max(3, Math.min(bb.max.y - bb.min.y, 30));
    this.fx = F.fx; this.fz = F.fz;
    this.radius = Math.max(this.hx, this.hz) * 0.85;
    // harbours: the land part stands at sea level + 1.5 (ServerApp.usl:1158)
    this.baseY = (gx, gz) => (this.def.coastal && world.waterLevel != null ? Math.max(world.height(gx, gz), world.waterLevel + 1.5) : world.height(gx, gz));
    this.pos.y = this.baseY(x, z);
    const m = cloneModel(tpl, this.party);
    this.model = m;
    this.obj = new THREE.Group();
    this.obj.add(m);
    m.traverse((o) => { if (o.isMesh) applyFow(o.material); });
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = rot;
    world.scene.add(this.obj);
    this.obj.updateMatrixWorld(true);
    this.anim = tpl.clips && tpl.clips.length ? new AnimCtl(m, tpl.clips) : null;
    if (this.anim && tpl.info && tpl.info.sounds) this.anim.setEvents(tpl.info.sounds, (ev) => world.animSound(this, ev));
    // nav cells of the footprint boxes; the pathfinder blocks them once construction level 1 is reached (BuildUpBuilding.usl)
    const cells = new Set();
    for (const [bx, bz, hx, hz] of this.boxes) for (const k of world.nav.rectCells(bx, bz, hx, hz, rot)) cells.add(k);
    this.cells = [...cells];
    this.origin = this.pos.clone();
    // footprint centre relative to the model origin, in the model's own frame (moving harbours keep it while sailing)
    { const c = Math.cos(rot), s = Math.sin(rot), ox = this.fx - x, oz = this.fz - z; this.fLocal = [ox * c - oz * s, ox * s + oz * c]; }
    this.pos.set(this.fx, this.baseY(this.fx, this.fz), this.fz);
    world.reserve(this.cells, 1);
    this.blocking = false;
    if (built) this.setBlocking(true);
    this.age = owner ? owner.epoch() : 1;
    this.dmgStage = 0;
    this.visKey = '';
    this.cranes = [];
    if (!built) this.addCranes();
    this.slots = this.linkSlots('Bl_');
    this.updateTurret();
    this.slotUse = new Map();
    this.workT = -99;
    this.updateVisual();
    this.idleAnim();
    if (this.behaviour && this.behaviour.init) this.behaviour.init(this, world);
  }
  // attached parts (composites table, game/compose.js): tower turrets (CTower.SetTurret: seas_turret at "we", the
  // rocket ramp's top + bird, the Hu ballista after hu_ballista_upgrade ...), the Hu harbour crane, the turtles under
  // the Aje floating harbour. Construction cranes are addCranes(). Rebuilt when the wanted set changes.
  updateTurret() {
    const W = this.world;
    const specs = W.data.composites(this.name).filter((s) => s.cond !== 'construction');
    const act = specs.length && this.owner ? activeParts(W, this, specs) : [];
    const key = act.map((s) => s.i + ':' + partGfx(W, s, this)).join(',') + '@' + (this.gfx || '');
    if (key === this.partsKey) return;
    this.partsKey = key;
    for (const p of this.parts || []) { p.obj.removeFromParent(); p.anim && p.anim.dispose(); }
    this.parts = []; this.turret = null;
    const made = new Map();
    for (const s of act) {
      const parent = s.pi >= 0 ? made.get(s.pi) : null;
      if (s.pi >= 0 && !parent) continue;
      const p = attach(W, parent ? parent.links[s.link] : this.findLink(s.link), partGfx(W, s, this), this.party);
      if (!p) continue;
      p.spec = s;
      made.set(s.i, p);
      this.parts.push(p);
      if (s.kind === 'turret' && s.pi < 0 && !this.turret) { this.turret = p; p.attackAnim = s.anim; }
      else if (p.anim && s.kind !== 'turret') { const a = p.anim.pick(s.anim, 'swim_1', 'standanim', 'idle'); if (a) p.anim.play(a); }
    }
  }
  // tech tree changed: new stats (hit points keep their ratio), possibly a new model (big tent, farm modes, walls)
  refreshRules() {
    this.updateTurret();
    const D = this.world.data, O = this.rulesOwner();
    this._ro = null;
    const ratio = this.hp / this.maxHp;
    this.def = D.def(this.name, O);
    this.stats = D.stats(this.name, 1, O);
    this.maxHp = this.stats.hp;
    this.hp = Math.max(1, Math.min(this.maxHp, ratio * this.maxHp));
    this.weapons = D.weaponSet(this.name, 1, O);
    this.weapon = this.weapons.long;
    this.fow = this.stats.fow || 40;
    this.ttVersion = O && O.tt ? O.tt.version : 0;
    if (this.stats.gfx && this.stats.gfx !== this.gfx) this.swapModel(this.stats.gfx);
  }
  swapModel(gfx) {
    const tpl = this.world.template(gfx, true);
    if (!tpl) return;
    this.gfx = gfx;
    this.tpl = tpl;
    this.removeCranes();
    this.model.removeFromParent();
    if (this.anim) this.anim.dispose();
    const m = cloneModel(tpl, this.party);
    m.traverse((o) => { if (o.isMesh) applyFow(o.material); });
    this.model = m;
    this.obj.add(m);
    this.obj.updateMatrixWorld(true);
    this._links = null;
    this.anim = tpl.clips && tpl.clips.length ? new AnimCtl(m, tpl.clips) : null;
    this.visKey = '';
    this.updateVisual();
    this.idleAnim();
    this.slots = this.linkSlots('Bl_');
    this.partsKey = null;
    this.updateTurret();
  }
  get isDropoff() { return this.built && this.def.delivery && this.def.delivery.length > 0; }
  setBlocking(on) {
    if (on && this.def.gate) return;               // gates never block; the pathfinder asks them (nav.gateBlocks)
    if (on === this.blocking) return;
    this.blocking = on;
    this.world.nav.mark(this.cells, on ? 1 : -1);
    if (this.world.waterNav) this.world.waterNav.mark(this.cells, on ? 1 : -1);   // harbours: ships sail around them
  }
  findLink(name) {
    if (!this._links) { this._links = {}; this.model.traverse((o) => { if (o.name.startsWith('link_')) this._links[o.name.slice(5)] = o; }); }
    return this._links[name] || null;
  }
  linkWorld(name, out = new THREE.Vector3()) {
    const l = this.findLink(name);
    if (!l) return null;
    this.obj.updateMatrixWorld(true);
    return l.getWorldPosition(out);
  }
  // builder positions (links Bl_0..Bl_9)
  linkSlots(prefix) {
    const out = [];
    for (let i = 0; i < 10; i++) { const p = this.linkWorld(prefix + i); if (p) out.push({ name: prefix + i, x: p.x, z: p.z }); }
    return out;
  }
  // nearest free builder link (CBuilding.OccupyLink)
  occupySlot(u) {
    let best = null, bd = 1e9;
    for (const s of this.slots) {
      const o = this.slotUse.get(s.name);
      if (o && o !== u && o.alive && o.task.building === this) continue;
      if (!this.world.nav.isFree(s.x, s.z) && this.blocking && this.world.nav.block[this.world.nav.idx(s.x, s.z)] > 1) continue;
      const d = Math.hypot(s.x - u.pos.x, s.z - u.pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) this.slotUse.set(best.name, u);
    return best;
  }
  freeSlot(u) { for (const [k, v] of this.slotUse) if (v === u) this.slotUse.delete(k); }
  // distance from a point to the footprint surface
  surfDist(x, z) {
    let best = 1e9;
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    for (const [bx, bz, hx, hz] of this.boxes) {
      const dx = x - bx, dz = z - bz;
      const lx = Math.abs(dx * c - dz * s) - hx, lz = Math.abs(dx * s + dz * c) - hz;
      const d = Math.hypot(Math.max(0, lx), Math.max(0, lz)) + Math.min(0, Math.max(lx, lz));
      if (d < best) best = d;
    }
    return best;
  }
  contains(x, z, m = 0) { return this.surfDist(x, z) < m; }
  addCranes() {
    const tribe = this.owner ? this.owner.tribe.toLowerCase() : 'seas';
    CRANE_LINKS.forEach((ln, i) => {
      const l = this.findLink(ln);
      if (!l) return;
      const tpl = this.world.template(`${tribe}_crane_0${i < 2 ? 1 : 2}`, true);
      if (!tpl) return;
      const o = cloneModel(tpl, this.party);
      if (o.children[0]) o.children[0].rotation.set(0, 0, 0);    // link frame is the model's Z-up frame
      l.add(o);
      o.traverse((q) => { if (q.isMesh) applyFow(q.material); });
      this.cranes.push({ obj: o, anim: tpl.clips && tpl.clips.length ? new AnimCtl(o, tpl.clips) : null });
    });
  }
  removeCranes() { for (const c of this.cranes) { c.obj.removeFromParent(); c.anim && c.anim.dispose(); } this.cranes = []; }
  constructLevel() { return this.built ? 4 : Math.min(3, Math.floor(this.progress * 4 + 1e-6)); }
  // FightingObj.UpdateDestructionFlags: <=50% hit points stage 1, <=25% stage 2 (finished buildings only)
  destructLevel() { if (!this.built) return 0; const r = this.hp / this.maxHp; return r <= 0.25 ? 2 : r <= 0.5 ? 1 : 0; }
  updateVisual() {
    const L = this.constructLevel(), dmg = this.destructLevel();
    if (this.owner) this.age = this.owner.epoch();
    if (this.def.wallKind === 'wall') {
      this.model.userData.armMask = this.armMask || 0;
      // stable geometry variants: the hub by tile, every arm by the edge to its neighbour (both halves match)
      const [ti, tj] = this.tile || [Math.round(this.pos.x / 8), Math.round(this.pos.z / 8)];
      const hsh = (a, b) => (((a * 73856093) ^ (b * 19349663)) >>> 0) % 9973;
      const pick = [hsh(ti, tj)];
      for (const [di, dj] of DIRS) pick.push(hsh(2 * ti + di, 2 * tj + dj));    // edge midpoint, same from both sides
      this.model.userData.variant = pick;
    }
    const key = L + '|' + dmg + '|' + this.age + '|' + (this.armMask || 0) + '|' + (this.model.userData.variant ? this.model.userData.variant[0] : 0);
    if (key === this.visKey) return;
    this.visKey = key;
    this.dmgStage = dmg;
    applyState(this.model, L, dmg, this.age);
    for (const p of this.parts || []) if (p.tpl.fourcc !== 'Char' && p.tpl.fourcc !== 'Anim') applyState(p.obj, L, dmg, 1);
    if (this.built && this.cranes.length) this.removeCranes();
    if (this.built) this.updateTurret();          // "when ready" parts
  }
  // animation: work loop while producing (Building.OnWork, 6 s timeout), work_finished afterwards
  idleAnim() {
    const a = this.anim;
    if (!a) return;
    if (a.has('standanim')) a.play('standanim');
    else if (a.has('idle')) a.play('idle');
    else if (a.cur) { a.cur.paused = true; }
  }
  onWork(t) {
    const a = this.anim;
    this.workT = t;
    if (!a) return;
    const w = a.pick('work', 'work_1');
    if (w && a.curName !== w) a.play(w, { fade: 0.3 });
    else if (w && a.cur) a.cur.paused = false;
  }
  updateAnim(dt, t) {
    const a = this.anim;
    if (a) {
      if (this.workT > 0 && t - this.workT > 6 && (a.curName === 'work' || a.curName === 'work_1')) {
        this.workT = -99;
        if (a.has('work_finished')) a.play('work_finished', { loop: false, onDone: () => this.idleAnim() });
        else this.idleAnim();
      }
      a.update(dt);
    }
    for (const p of this.parts || []) if (p.anim) p.anim.update(dt);
    for (const c of this.cranes) if (c.anim) {
      const busy = [...this.builders].some((w) => w.alive && w.task.building === this && w.task.phase === 'work');
      if (busy) { if (c.anim.curName !== 'build') c.anim.play('build'); else c.anim.cur.paused = false; } else if (c.anim.cur) c.anim.cur.paused = true;
      c.anim.update(dt);
    }
  }
  aimTurret(x, z, dt) {
    const t = this.turret;
    if (!t) return 0;
    const want = Math.atan2(-(x - this.pos.x), -(z - this.pos.z)) - this.rot;
    let diff = want - t.obj.rotation.z; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    t.obj.rotation.z += Math.sign(diff) * Math.min(Math.abs(diff), 2.5 * dt);
    return Math.abs(diff);
  }
  // moving harbours: move the model origin by (dx, dz) and turn it to rot; pos (footprint centre) follows
  slide(dx, dz, rot) {
    this.origin.x += dx; this.origin.z += dz; this.rot = rot;
    const c = Math.cos(rot), s = Math.sin(rot), [lx, lz] = this.fLocal;
    this.pos.set(this.origin.x + lx * c + lz * s, this.pos.y, this.origin.z - lx * s + lz * c);
    this.fx = this.pos.x; this.fz = this.pos.z;
    this.obj.position.set(this.origin.x, this.obj.position.y, this.origin.z);
    this.obj.rotation.y = rot;
    this.obj.updateMatrixWorld(true);
  }
  // footprint boxes and nav cells for the current position (after sailing)
  relocate() {
    const W = this.world;
    const F = placeFootprint(this.tpl, this.origin.x, this.origin.z, this.rot, 0, this.def.wallKind === 'wall' ? wallBoxes(this.armMask || 0, W.nav.cell) : null);
    this.boxes = F.boxes;
    const was = this.blocking;
    if (was) this.setBlocking(false);
    W.reserve(this.cells, -1);
    const cells = new Set();
    for (const [bx, bz, hx, hz] of this.boxes) for (const k of W.nav.rectCells(bx, bz, hx, hz, this.rot)) cells.add(k);
    this.cells = [...cells];
    W.reserve(this.cells, 1);
    if (was) this.setBlocking(true);
  }
  // wall pieces: show the arms of mask (bit d = direction d, wallmap.js) and block only along them
  setArms(mask) {
    if (this.def.wallKind !== 'wall' || mask === this.armMask) return;
    this.armMask = mask;
    this.model.userData.armMask = mask;
    this.relocate();
    this.updateVisual(true);
  }
  spawnAnim() { if (this.anim && this.anim.has('spawn')) this.anim.play('spawn', { loop: false, restart: true, onDone: () => this.idleAnim() }); }
  // a free spot next to the building, towards (tx, tz)
  exitPoint(tx, tz, nav = this.world.nav) {
    const W = this.world;
    const a = Math.atan2(tz - this.pos.z, tx - this.pos.x);
    for (let r = 2; r < 24; r += 1.5) {
      for (let k = 0; k < 16; k++) {
        const aa = a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.3;
        const R = this.radius + r;
        const x = this.pos.x + Math.cos(aa) * R, z = this.pos.z + Math.sin(aa) * R;
        if (nav.isFree(x, z) && this.surfDist(x, z) > 1) return [x, z];
      }
    }
    if (nav !== W.nav) { const c = nav.nearestFree(nav.idx(this.pos.x, this.pos.z), 40); const [x, z] = nav.center(c); return [x, z]; }
    return [this.pos.x + this.radius + 2, this.pos.z];
  }
  // where produced units appear (link Spwn), falling back to the exit point
  // ships appear at the harbour's dock (Do_1, naval.md §1.4) on the water grid
  spawnPoint(tx, tz, nav = this.world.nav) {
    for (const ln of nav === this.world.nav ? ['Spwn'] : ['Do_1', 'Spwn', 'Ex_1']) {
      const p = this.linkWorld(ln);
      if (p && nav.isFree(p.x, p.z)) return [p.x, p.z];
    }
    return this.exitPoint(tx, tz, nav);
  }
}

// ======================================================================= resource nodes (trees, timber, stone, bushes, corpses)
export class ResNode {
  constructor(world, type, res, x, z, amount, opts = {}) {
    this.id = NEXT_ID++;
    this.world = world;
    this.kind = 'res';
    this.type = type;        // tree | timber | stone | bush | corpse | farm
    this.res = res;          // wood | stone | food
    this.pos = new THREE.Vector3(x, world.height(x, z), z);
    this.amount = amount; this.max = amount;
    this.radius = opts.radius || 1.5;
    this.alive = true;
    this.workers = new Set();
    this.maxWorkers = opts.maxWorkers || 8;
    Object.assign(this, opts);
  }
}

// ======================================================================= projectiles
export class Projectile {
  constructor(world, from, target, weapon, owner, targetPos) {
    this.fixedAim = !!targetPos;
    this.ownerPlayer = owner ? owner.owner : null;
    this.world = world;
    this.from = from.clone();
    this.pos = from.clone();
    this.target = target;
    this.weapon = weapon;
    this.owner = owner;          // attacking entity
    this.aim = (targetPos || target.pos).clone();
    this.aim.y += target ? Math.min(2, (target.height || 2) * 0.5) : 0.5;
    const d = this.from.distanceTo(this.aim);
    this.T = Math.max(0.12, d / Math.max(10, weapon.bulletspeed || 40));
    this.t = 0;
    const id = (weapon.projectile || '').toLowerCase();
    this.arc = /arrow|spear|stone|wehrspinne|molotov|poison|barrel|spittle/.test(id) ? Math.min(0.3 * d, 12) : 0;
    this.obj = null;
    const tpl = weapon.projectile ? world.template(weapon.projectile, true) : null;
    if (tpl) { this.obj = cloneModel(tpl); world.scene.add(this.obj); }
    this.alive = true;
    this.up = new THREE.Vector3(0, 1, 0);
    this.prev = this.pos.clone();
  }
}
