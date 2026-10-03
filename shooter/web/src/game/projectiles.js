// Things that fly: the player's rockets, the Dustriders' spears and arrows.
// Each one is a small model moving along its velocity (with optional gravity); every step the stretch it covered is
// tested against the level (collision ray), the enemies (player shots) or the player (enemy shots).
import * as THREE from 'three';
import { cloneModel } from '../pw/engine/assets.js';

export class Projectiles {
  constructor(game) {
    this.g = game;
    this.list = [];
    this._d = new THREE.Vector3();
  }
  // o: {tpl (model template or null), pos, vel, gravity, life, owner: 'player' | 'enemy', radius, onHit(hit), trail}
  fire(o) {
    let obj = null;
    if (o.tpl) {
      obj = cloneModel(o.tpl);
      obj.traverse((m) => { if (m.isMesh) m.castShadow = false; });
      this.g.scene.add(obj);
    }
    const p = { obj, pos: o.pos.clone(), vel: o.vel.clone(), gravity: o.gravity || 0, life: o.life || 6, owner: o.owner, radius: o.radius || 0.3, onHit: o.onHit, trail: o.trail || null, t: 0 };
    this.list.push(p);
    this._place(p);
    return p;
  }
  _place(p) {
    if (!p.obj) return;
    p.obj.position.copy(p.pos);
    // the models' tips point along the object's +z (checked with an arrow in flight): look where it flies
    const v = p.vel;
    p.obj.lookAt(p.pos.x + v.x, p.pos.y + v.y, p.pos.z + v.z);
  }
  step(dt) {
    const G = this.g, col = G.level.collision;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt; p.t += dt;
      p.vel.y -= p.gravity * dt;
      const d = this._d.copy(p.vel).multiplyScalar(dt), len = d.length();
      let hit = null;
      if (len > 1e-5) {
        d.divideScalar(len);
        let t = col.raycast(p.pos.x, p.pos.y, p.pos.z, d.x, d.y, d.z, len);
        if (t !== Infinity) hit = { kind: 'world', t, x: col.hit.x, y: col.hit.y, z: col.hit.z, n: new THREE.Vector3(col.hit.nx, col.hit.ny, col.hit.nz) };
        if (p.owner === 'player') {
          const e = G.enemies.raycast(p.pos, d, hit ? hit.t : len, p.radius);
          if (e) hit = { kind: 'enemy', enemy: e.enemy, t: e.t, x: p.pos.x + d.x * e.t, y: p.pos.y + d.y * e.t, z: p.pos.z + d.z * e.t, n: d.clone().negate() };
        } else {
          const t2 = G.player.rayHit(p.pos, d, hit ? hit.t : len, p.radius);
          if (t2 !== Infinity) hit = { kind: 'player', t: t2, x: p.pos.x + d.x * t2, y: p.pos.y + d.y * t2, z: p.pos.z + d.z * t2, n: d.clone().negate() };
        }
      }
      if (hit || p.life <= 0) {
        if (hit) { p.pos.set(hit.x, hit.y, hit.z); if (p.onHit) p.onHit(hit, p); }
        if (p.obj) {
          // spears and arrows stay stuck in the ground for a moment
          if (hit && hit.kind === 'world' && p.owner === 'enemy') { p.obj.position.copy(p.pos); const o = p.obj; setTimeout(() => o.removeFromParent(), 4000); } else p.obj.removeFromParent();
        }
        this.list.splice(i, 1);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      if (p.trail) p.trail(p);
      this._place(p);
    }
  }
  clear() { for (const p of this.list) if (p.obj) p.obj.removeFromParent(); this.list.length = 0; }
}
