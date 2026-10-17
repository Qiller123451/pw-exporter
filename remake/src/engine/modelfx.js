// Effect models: the original game's effects are models from its GSF archives (almost all in all_effects.gsf)
// placed for a fixed time - their particle emitters do the drawing (engine/particles.js), some also play a clip
// "anim". This keeps the placed ones, moves the attached and flying ones along, and removes them when their time is up.
//
// Reference: Data/Base/Scripts/Game/misc/Effects.usl (classes CEffect: SetGFX, SetAnim("anim",1), SetDieInterval),
// docs/GAME_EFFECTS.md. The model names are case-insensitive (the GSF stores them in lower case).
import * as THREE from 'three';
import { AnimCtl } from '../game/anim.js';

export class ModelFx {
  // world: template(name, quiet), cloneModel(tpl, party), scene, time
  constructor(world) {
    this.W = world;
    this.list = [];               // { obj, anim, until, follow, link, offset, fly, key }
    this.keyed = new Map();       // key -> entry (effects that are switched off by name)
  }
  has(gfx) { return !!gfx && !!this.W.template(gfx.toLowerCase(), true); }
  // a model at a point for `life` seconds. opts: rot (THREE.Quaternion | yaw number), party (owner colour),
  // anim (clip to play, default "anim"; false: none), loop
  at(gfx, pos, life, opts = {}) {
    const e = this.make(gfx, life, opts);
    if (!e) return null;
    e.obj.position.copy(pos);
    if (opts.rot != null) { if (typeof opts.rot === 'number') e.obj.rotation.y = opts.rot; else e.obj.quaternion.copy(opts.rot); }
    this.W.scene.add(e.obj);
    return e;
  }
  // a model that follows an entity (AddFX + LinkAction): at its link `link` (the entity's position if it has none),
  // `offset` metres higher. opts.key: a name to stop it with (stop(key)); a new one with the same key replaces it.
  attach(ent, gfx, life, opts = {}) {
    if (!ent || !ent.obj) return null;
    if (opts.key) this.stop(opts.key);
    const e = this.make(gfx, life, opts);
    if (!e) return null;
    e.follow = ent; e.link = opts.link || null; e.offset = opts.offset || 0; e.key = opts.key || null;
    if (e.key) this.keyed.set(e.key, e);
    this.W.scene.add(e.obj);
    this.place(e);
    return e;
  }
  // a model flying from `from` to `to` in T seconds, then gone (the meteor's rock)
  fly(gfx, from, to, T, opts = {}) {
    const e = this.at(gfx, from, T, opts);
    if (e) e.fly = { from: from.clone(), to: to.clone(), t: 0, T };
    return e;
  }
  stop(key) { const e = this.keyed.get(key); if (e) { e.until = 0; this.keyed.delete(key); } }
  make(gfx, life, opts) {
    const tpl = gfx && this.W.template(gfx.toLowerCase(), true);
    if (!tpl) return null;
    const obj = this.W.cloneModel(tpl, opts.party ?? null);
    let anim = null;
    if (opts.anim !== false && tpl.clips && tpl.clips.length) {
      anim = new AnimCtl(obj, fxClips(tpl));
      const a = anim.pick(opts.anim || 'anim') || tpl.clips[0].name;
      anim.play(a, { loop: !!opts.loop, restart: true });
    }
    const e = { obj, anim, until: this.W.time + life };
    this.list.push(e);
    return e;
  }
  place(e) {
    const u = e.follow;
    if (!u.alive || !u.obj || u.inside) { e.until = 0; return; }
    const p = e.obj.position;
    const l = e.link && u.findLink ? u.findLink(e.link) : null;
    if (l) { l.updateWorldMatrix(true, false); l.getWorldPosition(p); } else p.copy(u.pos);
    p.y += e.offset;
    e.obj.visible = u.obj.visible;
  }
  update(dt) {
    if (!this.list.length) return;
    const t = this.W.time;
    for (const e of this.list) {
      if (e.until <= t) continue;
      if (e.follow) this.place(e);
      if (e.fly) { const f = e.fly; f.t += dt; e.obj.position.lerpVectors(f.from, f.to, Math.min(1, f.t / f.T)); e.obj.rotation.x += dt * 3; }
      if (e.anim) e.anim.update(dt);
    }
    if (this.list.some((e) => e.until <= t)) {
      for (const e of this.list) if (e.until <= t) { e.obj.removeFromParent(); if (e.anim) e.anim.dispose(); if (e.key && this.keyed.get(e.key) === e) this.keyed.delete(e.key); }
      this.list = this.list.filter((e) => e.until > t);
    }
  }
  clear() { for (const e of this.list) { e.obj.removeFromParent(); if (e.anim) e.anim.dispose(); } this.list = []; this.keyed.clear(); }
}
// the clips without the tracks of nodes the model doesn't have (the lower levels of detail are not converted:
// levelup_char_fx animates its _lod1 meshes too)
function fxClips(tpl) {
  if (tpl.fxClips) return tpl.fxClips;
  const names = new Set();
  tpl.scene.traverse((o) => names.add(o.name));
  const out = tpl.clips.map((c) => {
    const tr = c.tracks.filter((t) => names.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
    return tr.length === c.tracks.length ? c : new THREE.AnimationClip(c.name, c.duration, tr);
  });
  out.loops = tpl.clips.loops;
  return (tpl.fxClips = out);
}
