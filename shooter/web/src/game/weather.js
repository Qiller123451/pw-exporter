// Weather: falling snow where the country is high enough (CFG.weather.snow = {from, full, count, size, fall}).
//
// One cloud of points in a box around the camera; every flake falls and drifts, and one that leaves the box comes
// in again on the other side, so the box can follow the camera without the snow jumping. How thick it snows goes
// by the height of the ground under the camera: nothing below `from`, all of it above `full` - on the beach of
// "Iron Winter" the sky is clear, in the pass the first flakes come down, at the frozen lake it snows.
import * as THREE from 'three';
import { CFG } from './config.js';

export class Weather {
  constructor(game) {
    this.g = game;
    const S = this.S = { count: 1600, box: 70, height: 46, size: 0.5, fall: 7, drift: 2.2, ...((CFG.weather && CFG.weather.snow) || {}) };
    const n = S.count, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = (Math.random() - 0.5) * S.box; pos[i * 3 + 1] = Math.random() * S.height; pos[i * 3 + 2] = (Math.random() - 0.5) * S.box; seed[i] = Math.random() * 6.283; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.seed = seed;
    // a soft round flake
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    this.mat = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(c), size: S.size, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true, fog: true });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 12; this.points.visible = false;
    game.scene.add(this.points);
    this.amount = 0; this.t = 0;
  }
  update(cam, dt) {
    const S = this.S, G = this.g, p = cam.position;
    // how much: by the ground under the camera
    const h = G.level.height(p.x, p.z), want = Math.max(0, Math.min(1, (h - S.from) / Math.max(1, S.full - S.from)));
    this.amount += (want - this.amount) * Math.min(1, dt * 0.6);
    this.points.visible = this.amount > 0.02;
    if (!this.points.visible) return;
    this.mat.opacity = 0.85 * this.amount;
    this.t += dt;
    const a = this.points.geometry.attributes.position, arr = a.array, half = S.box / 2, n = Math.floor(S.count * Math.min(1, 0.25 + this.amount));
    this.points.geometry.setDrawRange(0, n);
    // the box is centred on the camera; the flakes keep their place in the world while they are inside it
    const cx = p.x, cy = p.y - S.height * 0.4, cz = p.z;
    for (let i = 0; i < n; i++) {
      const k = i * 3, s = this.seed[i];
      let x = arr[k] + (Math.sin(this.t * 0.7 + s) * S.drift + 1.5) * dt, y = arr[k + 1] - S.fall * (0.7 + 0.6 * ((s * 7.3) % 1)) * dt, z = arr[k + 2] + Math.cos(this.t * 0.5 + s * 1.7) * S.drift * dt;
      if (x - cx > half) x -= S.box; else if (x - cx < -half) x += S.box;
      if (z - cz > half) z -= S.box; else if (z - cz < -half) z += S.box;
      if (y < cy) y += S.height; else if (y - cy > S.height) y -= S.height;
      arr[k] = x; arr[k + 1] = y; arr[k + 2] = z;
    }
    a.needsUpdate = true;
  }
}
