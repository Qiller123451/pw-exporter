import * as THREE from 'three';
import { cloneModel, toLinkFrame } from '../engine/assets.js';
import { applyFow } from '../engine/terrain.js';
import { animalMask, applyMask, applyState, woundStage, VIS } from '../engine/parts.js';

import { AnimCtl } from './anim.js';

// the gear an invention shows on a tamed animal: class -> [[invention, render flags, hides the plain saddle]]
// (Base Animal.usl UpdateGfxFlags: allosaurus / brachiosaurus / stegosaurus / kentrosaurus armour; the mammoth's and
// rhino's armour with the armoured saddle instead of the saddle; animal blades = the helmet of mammoth, boar and rhino;
// the megaloceros' drums and the rhino's pennant)
const GEAR = {
  aje_allosaurus: [['aje_allosaurus_armor', [VIS.ARMOR]]],
  aje_brachiosaurus: [['aje_brachiosaurus_armor', [VIS.ARMOR]]],
  aje_stegosaurus: [['aje_stegosaurus_armor', [VIS.ARMOR]]],
  hu_kentrosaurus: [['hu_kentrosaurus_armor', [VIS.ARMOR]]],
  hu_mammoth: [['animal_blades', [VIS.HELMET]], ['hu_mammoth_armor', [VIS.ARMOR, VIS.ARMORSADDLE], true]],
  hu_wild_boar: [['animal_blades', [VIS.HELMET]]],
  hu_scout: [['drums', [VIS.HELMET]]],
  hu_rhino: [['pennant', [VIS.STANDARTE]], ['animal_blades', [VIS.HELMET]], ['hu_rhino_armor', [VIS.ARMOR, VIS.ARMORSADDLE], true]],
};
// units that set up on the spot to shoot (BuildUpBase.usl CBuildUpWeapon SwitchToAttackMode / SwitchToWalkMode,
// Animal.usl CMammoth): the log cannon mammoth lies down ("rest", held) while its support frame lowers ("build_down"
// of the bottom part, 1.5 s busy), the gun on top turns to the target and plays "attack_front" once a shot; to move
// again it gets up (rest backwards) and the frame rises ("build_up", 1 s busy)
const DEPLOY = {
  hu_mammoth_log_cannon: { rest: 'rest', frame: 'hu_mammoth_log_cannon_buildup_bottom', gun: 'hu_mammoth_log_cannon_buildup_top', down: 1.5, up: 1.0 },
};

// Multi-part objects as the original scripts assemble them, driven by the datamined table
// ModelExporter/pwexport/data/composites.json (normalized by pwexport/composites.py into gamedata.json "composites"):
//   seas_wehrspinne:        turret seas_wehrspinne_top at "we" (turns to the target), gunner at the top's "Dri1"
//   hu_triceratops (titan): two ballista tops at "con2"/"con3" with a gunner each, transporter build-up at "con"
//   aje_resource_collector: drawbar at "Db_1", wagon aje_resource_collector_<a..e> (by epoch) trailing at "Db_2"
//   ridden animals:         captain (tech tree captainclass) at "Ride", level flag <tribe>_animal_flag_0<level> at "flag"
//   brachiosaurus etc.:     optional build-ups after a per-unit upgrade, with their own rider / flag links
//   open transporters:      the passengers ride on the build-up at its links Dri0..Dri9 that no part of the table uses
//                           (BuildUpBase.usl CBuildUpTransporterOpen.UpdateLinkedObjs: LinkAction to "Dri<i>" in
//                           link order, the captain's link ignored, playing TransportObj.GetPassengerLoopAnim
//                           "standanim"); closed transporters (TYPE_TRANSPORTER: ships, vehicles) hide them
// Every part: {kind, gfx, variants, by, link, pi (parent part, -1 = the unit), anim, attack_anim, cond, arg, flex}.
// Weapons, worker tools and carried goods are handled by the unit itself (entities.js / economy.js).

// wild animals whose "misc" parts belong to the beast (MIRAGE FightingObj.ShowAnmlMiscFlag)
const WILD_MISC = /^(stegosaurus|kentrosaurus|mammoth|macrolemy[sd]_(land|water))$/i;

export function linksOf(root) {
  const out = {};
  root.traverse((o) => { if (o.name && o.name.startsWith('link_')) out[o.name.slice(5)] = o; });
  return out;
}

// attach a model to a link node (link frames are the models' native Z-up frames)
export function attach(world, link, gfx, party = null) {
  if (!link || !gfx) return null;
  const tpl = world.template(gfx.toLowerCase(), true);
  if (!tpl) return null;
  const obj = cloneModel(tpl, party);
  toLinkFrame(obj);
  obj.traverse((o) => { if (o.isMesh) applyFow(o.material); });
  link.add(obj);
  const anim = tpl.clips && tpl.clips.length ? new AnimCtl(obj, tpl.clips) : null;
  return { obj, anim, tpl, links: linksOf(obj) };
}

// is a filter (upgrade) switched on for this unit (its own upgrades) or its owner?
function upgradeOn(e, path) {
  if (!path) return false;
  if (e.localTT && e.localTT.has(path)) return true;
  return !!(e.owner && e.owner.tt && e.owner.tt.has(path));
}

// which model of a part to show: by unit level / epoch, riders by CCaptain.UpdateGfx ("<gfx minus last char><level>"
// if such a model exists), else the part's own model
export function partGfx(world, spec, e) {
  const v = spec.variants || [];
  if (spec.by === 'level' && v.length) return v[Math.max(0, Math.min(v.length - 1, (e.level || 1) - 1))];
  if (spec.by === 'epoch' && v.length) return v[Math.max(0, Math.min(v.length - 1, (e.owner ? e.owner.epoch() : 1) - 1))];
  if (spec.kind === 'rider' && /\d$/.test(spec.gfx)) {
    const lv = spec.gfx.slice(0, -1) + (e.level || 1);
    if (world.template(lv, true)) return lv;
  }
  return spec.gfx;
}

// the parts an entity shows right now (conditions of the table), in parent-before-child order
export function activeParts(world, e, specs, opts = {}) {
  const on = new Set();
  const ok = (s) => {
    switch (s.cond) {
      case 'always': return true;
      case 'ready': return e.kind !== 'building' || !!e.built;
      case 'construction': return !!opts.construction;
      case 'upgrade': return upgradeOn(e, s.arg);
      case 'invent': return !!(e.owner && world.data.invented(e.rulesOwner ? e.rulesOwner() : e.owner, s.arg, e.owner.tribe, e));
      default: return false;      // activation, special: driven elsewhere or not at all
    }
  };
  // build-ups first: other parts depend on which one is mounted
  for (const s of specs) if (s.kind === 'buildup' && ok(s)) on.add(s.i);
  const out = [];
  for (const s of specs) {
    let yes;
    if (s.kind === 'buildup') yes = on.has(s.i);
    else if (s.cond === 'buildup') yes = (s.arg || []).some((i) => on.has(i));
    else if (s.cond === 'unless') yes = !(s.arg || []).some((i) => on.has(i));
    else yes = ok(s);
    if (yes && s.pi >= 0 && !out.some((p) => p.i === s.pi)) yes = false;    // parent not shown
    if (yes) out.push(s);
  }
  return out;
}

export class Composite {
  constructor(unit) {
    this.u = unit;
    this.parts = [];          // attached parts (rider, turrets, build-ups, flags ...): {spec, obj, anim, tpl, links}
    this.top = null;          // first turret: aims at the target, shots leave from its Proj link (combat.muzzle)
    this.turrets = [];
    this.rider = null;
    this.wagon = null;        // trailer following the drawbar's hitch (FlexLinkAction)
    this.bar = null;
    this.maskKey = '';
    this.key = '';
    this.seats = [];          // open transporters: the free passenger links of the build-up
    this.riding = [];         // the passengers shown on them: {obj, anim, pas}
    this.paxKey = '';
  }
  dispose() {
    this.clearRiding();
    this.seats = [];
    for (const p of this.parts) { p.obj.removeFromParent(); p.anim && p.anim.dispose(); }
    if (this.wagon) { this.wagon.obj.removeFromParent(); this.wagon.anim && this.wagon.anim.dispose(); }
    this.parts = []; this.turrets = []; this.top = this.rider = this.wagon = this.bar = null;
    this.key = '';
  }
  specs() { return this.u.owner && !this.wild() ? this.u.world.data.composites(this.u.name) : []; }
  wild() { return this.u.cls === 'ANML' && this.u.world.data.isWildClass(this.u.name); }
  // signature of what should be shown: rebuilt when it changes (level up, upgrade, epoch)
  wanted() {
    const u = this.u, W = u.world;
    const act = activeParts(W, u, this.specs());
    return { act, key: act.map((s) => s.i + ':' + partGfx(W, s, u)).join(',') };
  }
  build() {
    const u = this.u, W = u.world;
    this.dispose();
    const { act, key } = this.wanted();
    this.key = key;
    const links = linksOf(u.model);
    const made = new Map();
    for (const s of act) {
      const gfx = partGfx(W, s, u);
      const parent = s.pi >= 0 ? made.get(s.pi) : null;
      if (s.pi >= 0 && !parent) continue;
      if (s.flex) { this.makeWagon(s, gfx, parent || { links, obj: u.model }); continue; }
      const link = parent ? parent.links[s.link] : links[s.link];
      const p = attach(W, link, gfx, u.party);
      if (!p) continue;
      p.spec = s;
      made.set(s.i, p);
      this.parts.push(p);
      if (s.kind === 'turret') { this.turrets.push(p); if (!this.top) this.top = p; }
      if (s.kind === 'drawbar' && !this.bar) this.bar = p;
      if (s.kind === 'rider') {
        if (!this.rider) this.rider = p;
        p.idle = s.anim || 'ride_idle_0';
        p.attack = s.attack_anim || (p.idle === 'ride_idle_0' ? 'ride_attack_front' : null);
      }
      const dep = DEPLOY[u.name];
      if (dep && p.anim && (gfx === dep.frame || gfx === dep.gun)) {
        // the frame and the gun hold a pose (first frame: folded up, gun at rest) - their clips are no idle loops
        p.dep = gfx === dep.frame ? 'frame' : 'gun';
        this.hold(p, p.dep === 'frame' ? 'build_down' : 'attack_front', u.deploy && u.deploy.state !== 'walk' && p.dep === 'frame');
      } else if (p.anim) {
        const a = p.anim.pick(s.anim, s.kind === 'rider' ? 'ride_idle_0' : null, s.kind === 'rider' ? 'balista_stand' : null, 'standanim');
        if (a && s.kind !== 'turret') p.anim.play(a);
      }
    }
    this.dep = DEPLOY[u.name] || null;
    if (this.dep && !u.deploy) u.deploy = { state: 'walk', until: 0 };
    if (this.dep && u.deploy.state !== 'walk') {          // (a new model while set up: lying again)
      const a = u.anim.play(this.dep.rest, { loop: false, restart: true, fade: 0 });
      if (a) a.time = a.getClip().duration;
      u.busyAnim = true;
    }
    // the passengers' seats: the build-up's Dri links in their order, but those its own parts (the captain) take
    const bu = this.parts.find((p) => p.spec.kind === 'buildup');
    if (bu) {
      const used = new Set(act.filter((s) => s.pi === bu.spec.i).map((s) => s.link));
      this.seats = Object.keys(bu.links).filter((k) => /^Dri\d$/.test(k) && !used.has(k)).sort().map((k) => bu.links[k]);
    }
    this.updateMask(true);
  }
  clearRiding() {
    for (const r of this.riding) { r.obj.removeFromParent(); r.anim && r.anim.dispose(); }
    this.riding = []; this.paxKey = '';
  }
  // the passengers of an open transporter on their seats (a model of each, playing its stand clip; the shooting
  // clip while it shoots from up there: transport.js passengerUpdate)
  syncPassengers(dt) {
    const u = this.u, W = u.world;
    const pax = this.seats.length ? (u.passengers || []).filter((p) => p.alive && p.gfx).slice(0, this.seats.length) : [];
    const key = pax.map((p) => p.id + ':' + p.gfx).join(',');
    if (key !== this.paxKey) {
      this.clearRiding();
      this.paxKey = key;
      pax.forEach((p, i) => {
        const r = attach(W, this.seats[i], p.gfx, p.party);
        if (!r) return;
        r.pas = p;
        r.stand = r.anim && r.anim.pick('standanim', 'idle_0', 'stand');
        r.shoot = r.anim && r.anim.pick('bow_1', 'shoot_1', 'throw_1', 'attack_front', 'attack_1');
        if (r.stand) r.anim.play(r.stand);
        this.riding.push(r);
      });
    }
    for (const r of this.riding) {
      if (!r.anim) continue;
      const want = r.shoot && W.time - (r.pas.lastHitDone ?? -1e9) < 0.8 ? r.shoot : r.stand;
      if (want && r.anim.curName !== want) r.anim.play(want, want === r.shoot ? { loop: false, fade: 0.1 } : undefined);
      r.anim.update(dt);
    }
  }
  // trailers (collector wagon, carts, drum wagon) follow the drawbar like a trailer instead of hanging on a link
  makeWagon(spec, gfx, parent) {
    const u = this.u, W = u.world;
    const tpl = W.template(gfx, true);
    if (!tpl || !parent) return;
    const obj = cloneModel(tpl, u.party);
    obj.traverse((o) => { if (o.isMesh) applyFow(o.material); });
    W.scene.add(obj);
    this.wagon = { obj, anim: tpl.clips && tpl.clips.length ? new AnimCtl(obj, tpl.clips) : null, rear: null, len: 5.5, hitch: parent.links[spec.link] || parent.obj };
    this.syncWagon(0);
  }
  syncWagon(dt) {
    const w = this.wagon, u = this.u;
    if (!w) return;
    const hitch = new THREE.Vector3();
    u.obj.updateMatrixWorld(true);
    w.hitch.getWorldPosition(hitch);
    if (!w.rear) w.rear = new THREE.Vector3(hitch.x + Math.sin(u.heading) * w.len, 0, hitch.z + Math.cos(u.heading) * w.len);
    const dx = hitch.x - w.rear.x, dz = hitch.z - w.rear.z, d = Math.hypot(dx, dz) || 1;
    w.rear.x = hitch.x - dx / d * w.len; w.rear.z = hitch.z - dz / d * w.len;
    const h = Math.atan2(-dx, -dz);
    w.obj.position.set(hitch.x, u.world.height(hitch.x, hitch.z), hitch.z);
    w.obj.rotation.y = h;
    w.obj.visible = u.obj.visible;
    if (w.anim) {
      // not every trailer has a "walk_1" clip (some epoch variants of the collector wagon only have others):
      // take the walk clip it has, or leave it still
      if (w.walk === undefined) w.walk = w.anim.pick('walk_1', 'walk_2', 'walk_3', 'walk_0') || [...w.anim.byName.keys()].find((n) => n.includes('walk') && !n.includes('#')) || null;
      const moving = u.vel.lengthSq() > 0.05;
      if (moving && w.walk) w.anim.play(w.walk, { ts: Math.min(2, Math.sqrt(u.vel.lengthSq()) / 2.5) });
      else if (w.anim.cur) w.anim.cur.timeScale = 0;
      w.anim.update(dt);
    }
  }
  // render mask of the animal/vehicle itself: saddle and party colour when owned, armour inventions, wounds
  updateMask(force) {
    const u = this.u;
    const fourcc = u.tpl.fourcc;
    if (fourcc !== 'Anim' && fourcc !== 'Vehi') return;
    const p = u.owner;
    const hr = u.alive ? u.hp / u.maxHp : 1;
    const wild = this.wild(), owned = !!p && !wild;
    // the gear inventions show on the animal (Animal.usl UpdateGfxFlags of each class)
    const gear = [];
    let noSaddle = false;
    const rule = owned && p.tt ? GEAR[u.name] : null;
    if (rule) for (const [inv, bits, saddleOff] of rule) if (p.tt.invented(inv)) { gear.push(...bits); if (saddleOff) noSaddle = true; }
    const key = (owned ? 1 : 0) + '|' + gear.join(',') + '|' + woundStage(hr);
    if (key === this.maskKey && !force) return;
    this.maskKey = key;
    applyMask(u.model, animalMask({ owned, gear, noSaddle, hp: hr, misc: this.miscShown(wild) }));
    if (owned && !u.partyTinted) {
      u.partyTinted = true;
      const col = new THREE.Color(p.color);
      u.model.traverse((o) => {
        if (!o.isMesh || !((o.userData.attr >>> 5) & 1)) return;
        o.material = o.material.clone();
        o.material.color = o.material.color.clone().multiply(col).multiplyScalar(1.6);
      });
    }
    for (const q of this.parts) if (q.tpl.fourcc !== 'Char' && q.tpl.fourcc !== 'Anim') applyState(q.obj, 4, 0, 1);
  }
  // the animal's "misc" parts (VIS_FLAG_ANML_MISC): on a wild animal only what is part of the beast itself - the plates,
  // shells, the mammoth's coat (MIRAGE FightingObj.ShowAnmlMiscFlag); the platforms and racks of the others are tack.
  // Tamed ones (Base Animal.usl OnInit): hidden on ankylosaurus, brachiosaurus and parasaurolophus unless they carry
  // a weapon build-up (catapult, gatling), on the lumber mammoth and on arena animals
  miscShown(wild) {
    const u = this.u;
    if (wild) return WILD_MISC.test(u.gfx || u.name);
    if (u.name === 'hu_mammoth_lumber_upgrade' || (u.def && u.def.script) === 'CArenaAnimal') return false;
    if (/^C(Ankylosaurus|Brachiosaurus|Parasaurolophus)$/.test((u.def && u.def.script) || '')) return this.parts.some((p) => /catapult|gatling/.test(p.spec.gfx));
    return true;
  }
  // a part's clip held at its first or last frame
  hold(p, clip, end) {
    const a = p.anim && p.anim.play(clip, { loop: false, restart: true, fade: 0 });
    if (!a) return;
    a.time = end ? a.getClip().duration : 0;
    a.paused = !end;
  }
  part(kind) { return this.parts.find((p) => p.dep === kind) || null; }
  // set up to shoot: false while it is still setting up (the unit waits); the state lives on the unit (saved games)
  deployReady(time) {
    const u = this.u, d = u.deploy;
    if (!this.dep || !d) return true;
    if (d.state === 'attack') return true;
    if (d.state === 'down') { if (time < d.until) return false; d.state = 'attack'; return true; }
    d.state = 'down'; d.until = time + this.dep.down;
    u.busyAnim = true;
    u.anim.play(this.dep.rest, { loop: false, restart: true, fade: 0.15 });
    const f = this.part('frame');
    if (f) { const a = f.anim.play('build_down', { loop: false, restart: true, fade: 0 }); if (a) a.paused = false; }
    return false;
  }
  // before it moves: get up again; true while it is still getting up
  holdMove(time) {
    const u = this.u, d = u.deploy;
    if (!this.dep || !d || d.state === 'walk') return false;
    if (d.state === 'up') {
      if (time < d.until) return true;
      d.state = 'walk'; u.busyAnim = false;
      return false;
    }
    d.state = 'up'; d.until = time + this.dep.up;
    u.busyAnim = true;
    const a = u.anim.play(this.dep.rest, { loop: false, restart: true, fade: 0.1 });
    if (a) { const len = a.getClip().duration; a.timeScale = -len / Math.max(0.5, this.dep.up); a.time = len; }
    const f = this.part('frame');
    if (f) { const b = f.anim.play('build_up', { loop: false, restart: true, fade: 0 }); if (b) b.paused = false; }
    const g = this.part('gun');
    if (g) g.obj.rotation.z = 0;                              // (ResetRotation)
    return true;
  }
  // set up: the gun turns to the target (CanRotate); returns its error
  aimGun(x, z, dt) {
    const g = this.part('gun');
    if (!g) return 0;
    const u = this.u, p = new THREE.Vector3(); g.obj.getWorldPosition(p);
    const want = Math.atan2(-(x - p.x), -(z - p.z)) - u.heading;
    const cur = -g.obj.rotation.z;
    let diff = want - cur; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    g.obj.rotation.z = -(cur + Math.sign(diff) * Math.min(Math.abs(diff), 1.5 * dt));
    return Math.abs(diff) - Math.min(Math.abs(diff), 1.5 * dt);
  }
  // a shot: the gun's recoil clip once
  fired() { const g = this.part('gun'); if (g) { const a = g.anim.play('attack_front', { loop: false, restart: true, fade: 0 }); if (a) a.paused = false; } }
  // turn the turrets towards a world point (relative to the carrier's heading); returns the first turret's error
  aim(x, z, dt) {
    if (!this.turrets.length) return 0;
    const u = this.u;
    let first = null;
    for (const t of this.turrets) {
      t.obj.updateMatrixWorld(true);
      const p = new THREE.Vector3(); t.obj.getWorldPosition(p);
      const want = Math.atan2(-(x - p.x), -(z - p.z)) - u.heading;
      const cur = -t.obj.rotation.z;           // the link's z turns the other way in the world (mirrored root, game/maps/frame.js)
      let diff = want - cur; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      t.obj.rotation.z = -(cur + Math.sign(diff) * Math.min(Math.abs(diff), 3 * dt));
      if (first === null) first = Math.abs(diff);
    }
    return first;
  }
  update(dt, attacking) {
    // got up again: free to move and idle (compose.js DEPLOY)
    const d = this.dep && this.u.deploy;
    if (d && d.state === 'up' && this.u.world.time >= d.until) { d.state = 'walk'; this.u.busyAnim = false; this.u.anim.play(this.u.idleAnim); }
    for (const p of this.parts) {
      if (p.anim) p.anim.update(dt);
      if (p.spec.kind === 'rider' && p.anim && p.attack) {
        const want = attacking ? p.attack : p.idle;
        if (p.anim.curName !== want && p.anim.has(want)) p.anim.play(want);
      }
    }
    this.checkT = (this.checkT || 0) - dt;
    if (this.checkT <= 0) {           // level up / upgrade / new epoch: rebuild when the wanted parts change
      this.checkT = 1;
      if (this.wanted().key !== this.key) this.build();
    }
    this.syncWagon(dt);
    if (this.seats.length || this.riding.length) this.syncPassengers(dt);
    this.updateMask(false);
  }
}
