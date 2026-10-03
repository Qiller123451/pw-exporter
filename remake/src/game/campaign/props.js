// Stand-alone scenery of a campaign map: every placed object that is not a unit or building of the tech tree but
// that a mission may address - arena gates, barricades, cages, city houses and walls, townsfolk, healing wells,
// items, effects. (The mass of anonymous landscape objects stays in the instanced prop field, engine/props.js.)
// A Prop can be shown / hidden (OBAP), play one of its model's animations (ACDO SetAnim), be deleted or replaced
// (DELO, REPL) and blocks the ground like the landscape objects do. It has no hit points.
import * as THREE from 'three';
import { AnimCtl } from '../anim.js';

export class Prop {
  // o: { model, x, z, y (null = on the ground), rot, q (stored map quaternion or null), block (bool), party (colour | null) }
  constructor(world, o) {
    this.world = world;
    this.kind = 'prop';
    this.model = o.model;
    this.pos = new THREE.Vector3(o.x, o.y != null ? o.y : world.height(o.x, o.z), o.z);
    this.rot = o.rot || 0;
    this.alive = true;
    this.visible = true;
    const tpl = this.tpl = world.template(o.model, true);
    const m = world.cloneModel(tpl, o.party != null ? o.party : null);
    this.obj = new THREE.Group();
    this.obj.add(m);
    m.traverse((n) => { if (n.isMesh) world.applyFow(n.material); });
    this.obj.position.copy(this.pos);
    // tilted pieces keep their whole stored orientation, like the landscape objects (engine/props.js add)
    if (o.q && (Math.abs(o.q[0]) > 1e-4 || Math.abs(o.q[1]) > 1e-4)) this.obj.quaternion.set(-o.q[0], -o.q[2], o.q[1], o.q[3]).normalize();
    else this.obj.rotation.y = this.rot;
    world.scene.add(this.obj);
    this.anim = tpl.clips && tpl.clips.length ? new AnimCtl(m, tpl.clips) : null;
    if (this.anim) { const a = this.anim.pick('standanim', 'idle', 'idle_0', 'stand'); if (a) this.anim.play(a); }
    // ground cells: the model's pathfinder boxes (GSF table, as buildings use them), else a circle like the
    // landscape objects of maps/source.js
    this.cells = [];
    if (o.block) {
      const pf = (tpl.info && tpl.info.pf) || (tpl.extras && tpl.extras.pf);
      const set = new Set();
      if (pf) for (const r of pf) if (r[0] === 1 && r[4] > 0.5 && r[5] > 0.5) {
        const bx = r[1] + r[4] / 2, bz = -(r[2] + r[5] / 2), c = Math.cos(this.rot), s = Math.sin(this.rot);
        for (const k of world.nav.rectCells(o.x + bx * c + bz * s, o.z - bx * s + bz * c, r[4] / 2, r[5] / 2, this.rot)) set.add(k);
      }
      if (!set.size && o.blockRadius > 0) for (const k of world.nav.markCircle(o.x, o.z, o.blockRadius, 0)) set.add(k);
      this.cells = [...set];
    }
    this.blocking = false;
    this.setBlocking(true);
  }
  setBlocking(on) {
    if (on === this.blocking || !this.cells.length) return;
    this.blocking = on;
    this.world.nav.mark(this.cells, on ? 1 : -1);
  }
  setVisible(on) {
    this.visible = !!on;
    this.obj.visible = this.visible;
    this.setBlocking(this.visible);              // scenery that "disappears" (OBAP 0) no longer stands in the way
  }
  // play an animation of the model: once (loops <= 1; it stays on its last frame, e.g. a gate that opened) or
  // looping. Returns false if the model has no such animation.
  playAnim(name, loops = 1) {
    if (!this.anim || !this.anim.has(name)) return false;
    this.anim.play(name, { loop: loops > 1, restart: true, fade: 0 });
    this.animT = 0;
    return true;
  }
  update(dt) { if (this.anim && this.visible) this.anim.update(dt); }
  remove() {
    if (!this.alive) return;
    this.alive = false;
    this.setBlocking(false);
    this.world.scene.remove(this.obj);
    if (this.anim) this.anim.dispose();
  }
}
