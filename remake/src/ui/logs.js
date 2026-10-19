// Felled trees (vegetation.usl CTree.Fall, Resource.usl CWood): the log is the whole tree - trunk, branches and the
// crown's leaves on a small skeleton - and falls over with one of its chop_down_0N clips (held on the last frame).
// The leaves are bound to the bones (the exporter's skinned foliage), so they fall with the branches. Its model's
// sound table times the crash; at frame 40 CCamShakeHarvestTrees (Effects.usl:1628-1647) blows a cloud of leaves
// 8 m out in the clip's direction (-45 deg x its digit, the log's own yaw not counted - as in the original) and shakes
// the camera. The log stays as it fell until its wood is used up (the 'timbergone' event).
import * as THREE from 'three';
import { cloneModel } from '../engine/assets.js';
import { modelSprites, spriteTexture } from '../engine/props.js';
import { AnimCtl } from '../game/anim.js';

const LEAF_FRAME = 40 / 25;

export class FallenTrees {
  constructor(G) {
    this.G = G;
    this.logs = new Map();          // node -> {obj, anim, t, clip}
    this.lastT = null;
  }
  fell(node) {
    const G = this.G, W = G.world;
    if (this.logs.has(node) || !node.timberKind) return;
    const tpl = W.template(node.timberKind, true);
    if (!tpl) return;
    const obj = cloneModel(tpl);
    obj.position.copy(node.pos);
    obj.rotation.y = node.logRot != null ? node.logRot : node.rot || 0;
    obj.scale.setScalar(node.scale || 1);
    this.leaves(obj, tpl);
    G.scene.add(obj);
    const anim = tpl.clips && tpl.clips.length ? new AnimCtl(obj, tpl.clips) : null;
    const clip = anim && anim.has(node.fallClip) ? node.fallClip : anim && anim.pick('chop_down_01', 'chop_down');
    const L = { obj, anim, clip, t: 0, leafDone: !anim || !!node.fallen, node };
    if (anim && clip) {
      anim.play(clip, { loop: false });
      // a log loaded from a saved game lies as it fell
      if (node.fallen) { anim.update(60); L.done = true; }
      else {
        const snd = tpl.info && tpl.info.sounds;
        if (snd) anim.setEvents(snd, (ev) => { if (this.seen(node)) W.audio && W.audio.animEvent(ev, node.pos); });
      }
    }
    node.fallen = true;
    this.logs.set(node, L);
  }
  // the crown's leaves: per bone one sprite mesh in the bone's space (points from the bind pose)
  leaves(obj, tpl) {
    const fol = (tpl.extras && tpl.extras.foliage) || [];
    let skel = null;
    obj.traverse((o) => { if (!skel && o.isSkinnedMesh) skel = o.skeleton; });
    const v = new THREE.Vector3();
    for (const f of fol) {
      if (!f.tex || !f.pts || /particle/i.test(f.tex)) continue;
      const map = spriteTexture(f.tex);
      const groups = new Map();
      for (let i = 0; i < f.pts.length / 3; i++) {
        const b = f.skinned && f.bones && skel ? f.bones[i] : -1;
        if (!groups.has(b)) groups.set(b, []);
        v.fromArray(f.pts, i * 3);
        if (b >= 0 && skel.boneInverses[b]) v.applyMatrix4(skel.boneInverses[b]);
        groups.get(b).push(v.x, v.y, v.z);
      }
      for (const [b, pts] of groups) {
        const m = modelSprites({ ...f, pts }, map);
        const parent = b >= 0 && skel.bones[b] ? skel.bones[b] : obj.children[0] || obj;
        parent.add(m);
      }
    }
  }
  seen(node) { const G = this.G; return !!(G.fow && G.fow.visible(node.pos.x, node.pos.z)); }
  gone(node) {
    const L = this.logs.get(node);
    if (!L) return;
    L.obj.removeFromParent();
    if (L.anim) L.anim.dispose();
    this.logs.delete(node);
  }
  update() {
    const W = this.G.world, now = W.time;
    const dt = this.lastT == null ? 0 : Math.max(0, Math.min(0.5, now - this.lastT));
    this.lastT = now;
    if (!dt) return;
    for (const L of this.logs.values()) {
      if (L.done || !L.anim) continue;
      L.t += dt;
      L.anim.update(dt);
      if (!L.leafDone && L.t >= LEAF_FRAME) { L.leafDone = true; this.leafBlast(L); }
      if (L.t > 3) L.done = true;
    }
  }
  // CCamShakeHarvestTrees: pos + (8, 0, 0) turned by -45 deg x the clip's digit (map space; x east, y south ->
  // the remake's x, z)
  leafBlast(L) {
    const G = this.G, W = G.world, d = +String(L.clip).slice(-1) || 0, a = d * Math.PI / 4;
    const p = L.node.pos.clone().add(new THREE.Vector3(Math.cos(a) * 8, 0, Math.sin(a) * 8));
    p.y = W.height(p.x, p.z);
    if (G.feedback && this.seen(L.node)) G.feedback.gfx.leafBlast(p);
  }
}
