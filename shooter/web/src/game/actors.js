// Characters made from ParaWorld models: a model instance with its attachment points, things in its hands, and
// animation. Two animation drivers:
//   * AnimCtl (src/pw/game/anim.js, the remake's)  - one clip at a time; used by the enemies
//   * BodyAnim (below) - legs and upper body play different clips, plus an aim twist of the spine; used by the player
//
// Model conventions (GSF models as converted by the toolkit): the scene's first child is the model root, rotated from
// the model's Z-up space to Y-up; nodes named link_<Name> are attachment points (HndR / HndL hands, Shld shield,
// Back, Proj muzzle ...); an object at rotation.y = h faces (-sin h, -cos h), i.e. north (-z) at 0.
import * as THREE from 'three';
import { loadModel, cloneModel, retarget } from '../pw/engine/assets.js';
import { AnimCtl } from '../pw/game/anim.js';

export const forward = (yaw, out = new THREE.Vector3()) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
export const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };

// ---------------------------------------------------------------- templates
const templates = new Map();
// load a model for use as a character (animated: nothing merged) and remember it
export async function loadActor(name) {
  const key = name.toLowerCase();
  if (!templates.has(key)) templates.set(key, loadModel(key));
  return templates.get(key);
}
export function linksOf(root) {
  const out = {};
  root.traverse((o) => { if (o.name && o.name.startsWith('link_')) out[o.name.slice(5)] = o; });
  return out;
}

// a model instance standing at `obj` (a group at the feet)
export class Actor {
  constructor(tpl, opts = {}) {
    this.tpl = tpl;
    this.obj = new THREE.Group();
    this.model = cloneModel(tpl, opts.party ?? null);
    this.obj.add(this.model);
    this.links = linksOf(this.model);
    this.held = new Map();           // link name -> attached object
    const pad = opts.cullRadius || 0;
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = opts.castShadow !== false; o.receiveShadow = false;
      // skinned meshes are culled by a sphere around the bind pose: make it roomy instead of never culling
      if (o.isSkinnedMesh && pad) { o.frustumCulled = true; o.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, pad * 0.5), pad); }
    });
  }
  // put a model into a hand (or on the back); gfx = null removes it
  attach(link, tpl) {
    const old = this.held.get(link);
    if (old) { old.removeFromParent(); this.held.delete(link); }
    const l = this.links[link];
    if (!l || !tpl) return null;
    const o = cloneModel(tpl);
    if (o.children[0]) o.children[0].rotation.set(0, 0, 0);     // the link's frame is already the model's Z-up frame
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } });
    l.add(o);
    this.held.set(link, o);
    return o;
  }
  // world position of a link (falls back to a point in front of the chest)
  linkPos(link, out, fallbackY = 3) {
    const l = this.links[link];
    if (l) return l.getWorldPosition(out);
    return out.copy(this.obj.position).setY(this.obj.position.y + fallbackY);
  }
}

// Something built onto a model with its own animation and crew - a turret, a catapult:
//   addon = {model, link, clip, crew: [[model, link on the addon, idle clip, clip when it fires]]}
// Returns {obj, links, fire(), update(dt), muzzle(out)} (or null); fire() plays the addon's and the crew's clips once.
export function addAddon(actor, A, templates) {
  const t = templates.get(A.model), obj = t && actor.attach(A.link, t);
  if (!obj) return null;
  const links = linksOf(obj), anim = new AnimCtl(obj, t.clips), crew = [];
  for (const [m, link, idle, atk] of A.crew || []) {
    const ct = templates.get(m), l = links[link];
    if (!ct || !l) continue;
    const o = cloneModel(ct);
    if (o.children[0]) o.children[0].rotation.set(0, 0, 0);
    o.traverse((x) => { if (x.isMesh) { x.castShadow = true; x.frustumCulled = false; } });
    l.add(o);
    const an = new AnimCtl(o, ct.clips), c = an.pick(idle, 'standanim');
    if (c) an.play(c, { loop: true });
    crew.push({ an, idle: c, atk });
  }
  return {
    obj, links,
    fire() {
      if (anim.has(A.clip)) anim.play(A.clip, { loop: false, restart: true, fade: 0.05 });
      for (const c of crew) if (c.atk && c.an.has(c.atk)) c.an.play(c.atk, { loop: false, restart: true, fade: 0.1, onDone: () => { if (c.idle) c.an.play(c.idle, { loop: true }); } });
    },
    update(dt) { anim.update(dt); for (const c of crew) c.an.update(dt); },
    muzzle(out) { const l = links[A.muzzle || 'Proj'] || links.unnamed; return l ? l.getWorldPosition(out) : obj.getWorldPosition(out).setY(out.y + 1); },
  };
}

// clips of another model that has the same skeleton, fitted to this model's proportions
export function borrowClips(dstTpl, srcTpl, names) {
  const want = new Set(names.map((n) => n.toLowerCase()));
  const src = srcTpl.clips.filter((c) => want.has(c.name.toLowerCase().split('#')[0]));
  return retarget(src, srcTpl.scene, dstTpl.scene);
}

export { AnimCtl };

// ---------------------------------------------------------------- legs + upper body
// The legs (root and leg bones) play one clip, the upper body (everything below `upperRoot`) another one, so a
// character can run and shoot at the same time. Without an upper clip the upper body follows the legs' clip.
// full() plays one clip on the whole body once (jump, death, finisher) and holds both layers until it ends.
export class BodyAnim {
  constructor(root, clips, upperRoot) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = new Map();
    for (const c of clips) if (!this.clips.has(c.name.toLowerCase())) this.clips.set(c.name.toLowerCase(), c);
    this.loops = clips.loops || {};
    // names of the upper-body nodes
    this.upper = new Set();
    let ur = null;
    root.traverse((o) => { if (o.name === upperRoot) ur = o; });
    if (ur) ur.traverse((o) => { if (o.name) this.upper.add(o.name); });
    this.spine = []; this.extra = []; this.post = []; this.spineBase = []; this.twisted = false;
    this.parts = new Map();          // clip name -> {lo, up} sub clips
    this.lo = { act: null, name: null }; this.up = { act: null, name: null, own: false };
    this.locked = false; this.onDone = null;
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.lo.act && this.locked) { this.locked = false; const cb = this.onDone; this.onDone = null; if (cb) cb(); }
      else if (e.action === this.up.act && this.up.own) { const cb = this.up.onDone; this.up.onDone = null; if (!this.up.hold) this.upperClip(null, { fade: 0.18 }); if (cb) cb(); }
    });
    this._q = new THREE.Quaternion(); this._pq = new THREE.Quaternion(); this._r = new THREE.Quaternion();
  }
  addClips(clips) { for (const c of clips) if (!this.clips.has(c.name.toLowerCase())) this.clips.set(c.name.toLowerCase(), c); }
  has(name) { return !!name && this.clips.has(name.toLowerCase()); }
  pick(...names) { for (const n of names) if (this.has(n)) return n.toLowerCase(); return null; }
  duration(name) { const c = name && this.clips.get(name.toLowerCase()); return c ? c.duration : 0; }
  // bones the aim twist is spread over (from the hips upwards), by name
  setSpine(names) {
    this.spine = [];
    for (const n of names) { let b = null; this.root.traverse((o) => { if (o.name === n) b = o; }); if (b) this.spine.push(b); }
    this._post();
  }
  // more bones that are turned after the animation (see turn())
  setExtra(names) {
    this.extra = [];
    for (const n of names) { let b = null; this.root.traverse((o) => { if (o.name === n) b = o; }); if (b) this.extra.push(b); }
    this._post();
  }
  _post() {
    this.post = [...this.spine, ...(this.extra || [])];
    this.spineBase = this.post.map((b) => b.quaternion.clone());
    this.twisted = false;
  }
  // turn one of the extra bones about a world axis: call after update()
  turn(i, axis, angle) {
    const b = this.extra && this.extra[i];
    if (!b || Math.abs(angle) < 1e-4) return;
    this.root.updateMatrixWorld(true);
    this._r.setFromAxisAngle(axis, angle);
    b.parent.getWorldQuaternion(this._pq);
    b.quaternion.premultiply(this._pq).premultiply(this._r).premultiply(this._pq.invert());
    this.twisted = true;
  }
  _parts(name) {
    const n = name.toLowerCase();
    let p = this.parts.get(n);
    if (!p) {
      const c = this.clips.get(n);
      if (!c) return null;
      const lo = [], up = [];
      for (const t of c.tracks) (this.upper.has(t.name.slice(0, t.name.lastIndexOf('.'))) ? up : lo).push(t);
      p = { lo: new THREE.AnimationClip(c.name + '|lo', c.duration, lo), up: new THREE.AnimationClip(c.name + '|up', c.duration, up) };
      this.parts.set(n, p);
    }
    return p;
  }
  _start(slot, clip, name, o) {
    const a = this.mixer.clipAction(clip);
    const loop = o.loop !== false;
    if (slot.act === a && !o.restart) { a.timeScale = o.ts ?? 1; return a; }
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    a.clampWhenFinished = !loop;
    a.enabled = true; a.setEffectiveWeight(1);
    a.timeScale = o.ts ?? 1;
    if (o.at) a.time = o.at;
    a.play();
    const fade = o.fade ?? 0.15;
    if (slot.act && slot.act !== a) { if (fade > 0) a.crossFadeFrom(slot.act, fade, false); else slot.act.stop(); }
    slot.act = a; slot.name = name.toLowerCase();
    return a;
  }
  // legs: a looping clip (walk, stand); ts = playback speed (negative = backwards)
  // (a walk clip of the game is start + cycle + stop in one; its cycle alone is the clip "<name>#l": that one loops)
  legs(name, o = {}) {
    if (this.locked) return;
    if (name && this.has(name + '#l')) name += '#l';
    const p = name && this._parts(name);
    if (!p) return;
    this._start(this.lo, p.lo, name, o);
    if (!this.up.own) this._start(this.up, p.up, name, { ...o, at: this.lo.act.time });
  }
  // upper body: a clip of its own (shooting, striking), or null to follow the legs again
  // o.hold: stay on the last frame instead of returning to the legs' clip
  upperClip(name, o = {}) {
    if (this.locked) return null;
    if (!name) {
      this.up.own = false; this.up.onDone = null;
      const p = this.lo.name && this._parts(this.lo.name);
      if (p) this._start(this.up, p.up, this.lo.name, { fade: o.fade ?? 0.15, ts: this.lo.act.timeScale, at: this.lo.act.time, restart: true });
      return null;
    }
    const p = this._parts(name);
    if (!p) return null;
    this.up.own = true; this.up.onDone = o.onDone || null; this.up.hold = !!o.hold;
    return this._start(this.up, p.up, name, o);
  }
  upperName() { return this.up.own ? this.up.name : null; }
  // the whole body, once
  full(name, o = {}) {
    const p = name && this._parts(name);
    if (!p) { if (o.onDone) o.onDone(); return false; }
    this.locked = false;
    this.up.own = false; this.up.onDone = null;
    this._start(this.lo, p.lo, name, { loop: !!o.loop, restart: true, fade: o.fade ?? 0.1, ts: o.ts, at: o.at });
    this._start(this.up, p.up, name, { loop: !!o.loop, restart: true, fade: o.fade ?? 0.1, ts: o.ts, at: o.at });
    this.locked = !o.loop && !o.free;
    this.onDone = o.onDone || null;
    return true;
  }
  unlock() { this.locked = false; this.onDone = null; }
  // dt: seconds; twist: how far the upper body is turned from the legs (radians, + = left); pitch: looking up (+) / down
  update(dt, twist = 0, pitch = 0) {
    if (!this.up.own && this.up.act && this.lo.act) { this.up.act.time = this.lo.act.time; this.up.act.timeScale = this.lo.act.timeScale; }
    // The mixer only writes a bone when its animated value changed since the last frame, so on a still pose (idle,
    // a held last frame, the paused game) last frame's aim twist would still be in the spine bones and the new one
    // would be added on top - the torso would wind round and round. So: take the twist out again, let the mixer
    // write, remember what it wrote (the plain animated pose), and only then turn the spine.
    const n = this.spine.length, post = this.post || this.spine;
    if (this.twisted) for (let i = 0; i < post.length; i++) post[i].quaternion.copy(this.spineBase[i]);
    this.mixer.update(dt);
    for (let i = 0; i < post.length; i++) this.spineBase[i].copy(post[i].quaternion);
    this.twisted = false;
    if (!n || (Math.abs(twist) < 1e-3 && Math.abs(pitch) < 1e-3)) return;
    this.twisted = true;
    this._turnSpine(twist, pitch);
  }
  _turnSpine(twist, pitch) {
    const n = this.spine.length;
    // turn each spine bone in world space: yaw about the up axis, pitch about the character's right axis
    this.root.updateMatrixWorld(true);
    const body = this.root.getWorldQuaternion(this._q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(body);
    this._r.setFromAxisAngle(new THREE.Vector3(0, 1, 0), twist / n);
    const rp = new THREE.Quaternion().setFromAxisAngle(right.applyAxisAngle(new THREE.Vector3(0, 1, 0), twist), pitch / n);
    this._r.premultiply(rp);
    for (const b of this.spine) {
      b.parent.getWorldQuaternion(this._pq);
      // local' = P^-1 * R * P * local
      b.quaternion.premultiply(this._pq).premultiply(this._r).premultiply(this._pq.invert());
      b.updateMatrixWorld(true);
    }
  }
  // Point something the upper body carries (a gun barrel) along `want` (world direction): call after update().
  // dirOf(out) gives the direction it points now. The turn is shared among the spine bones (a twist of the whole
  // torso, not a kink in one place); the last bone takes whatever is left, so the result is exact. w: 0 .. 1.
  aim(dirOf, want, w = 1) {
    const n = this.spine.length;
    if (!n || w <= 0) return;
    const cur = this._cur || (this._cur = new THREE.Vector3()), goal = this._goal || (this._goal = new THREE.Vector3());
    const q = this._aq || (this._aq = new THREE.Quaternion());
    for (let i = 0; i < n; i++) {
      this.root.updateMatrixWorld(true);
      dirOf(cur);
      if (i === 0) { q.setFromUnitVectors(cur, want); this._r.identity().slerp(q, w); goal.copy(cur).applyQuaternion(this._r); }
      q.setFromUnitVectors(cur, goal);
      this._r.identity().slerp(q, 1 / (n - i));
      const b = this.spine[i];
      b.parent.getWorldQuaternion(this._pq);
      b.quaternion.premultiply(this._pq).premultiply(this._r).premultiply(this._pq.invert());
    }
    this.root.updateMatrixWorld(true);
    this.twisted = true;
  }
}
