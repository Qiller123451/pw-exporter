// Visual effects: sprite particles from the game's own particle atlases, bullet tracers, ground decals, flash
// lights, camera shake.
//
//   particle_01.png  4 fire-ball frames (top row), smoke puffs, sparks, flares
//   particle_08.png  dust streaks, shock-wave rings, smoke blobs
//   gore.png         blood splats (top row), flying bits (bottom rows)
//   scorch.png       burn mark for the ground
// All atlases are used with (0, 0) in the top-left corner. Particles live in fixed-size pools (the oldest is
// overwritten), are simulated on the CPU and drawn as camera-facing quads in four draw calls.
import * as THREE from 'three';

const VS = `
attribute vec4 aPos;     // xyz centre, w size
attribute vec4 aUv;      // u0 v0 u1 v1
attribute vec4 aColor;
attribute float aRot;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
  float s = sin(aRot), c = cos(aRot);
  mv.xy += vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aPos.w;
  vUv = mix(aUv.xy, aUv.zw, vec2(position.x + 0.5, 0.5 - position.y));
  vColor = aColor;
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform sampler2D map;
varying vec2 vUv; varying vec4 vColor;
void main() {
  vec4 t = texture2D(map, vUv) * vColor;
  if (t.a < 0.004) discard;
  gl_FragColor = t;
  #include <colorspace_fragment>
}`;

// cells of the atlases: [u0, v0, u1, v1]
const cell = (x, y, w, h, n) => [x / n, y / n, (x + w) / n, (y + h) / n];
export const UV = {
  fire: [0, 1, 2, 3].map((i) => cell(i * 64, 0, 64, 64, 256)),
  smoke: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cell(i * 32, 64, 32, 32, 256)),
  smoke2: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cell(i * 32, 128, 32, 32, 256)),
  flare: [0, 1, 2].map((i) => cell(i * 32, 224, 32, 32, 256)),
  blood: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => cell(i * 64, 0, 64, 64, 512)),
  gib: [[0, 384], [64, 384], [128, 384], [192, 384], [256, 384], [0, 448], [64, 448], [128, 448], [192, 448]].map(([x, y]) => cell(x, y, 64, 64, 512)),
  ring: cell(0, 128, 128, 128, 256),
  dust: [0, 1, 2, 3].map((i) => cell(i * 28, 0, 28, 128, 256)),
  blob: [cell(192, 128, 64, 64, 256), cell(192, 192, 64, 64, 256)],
};

class Layer {
  constructor(scene, tex, blending, cap) {
    this.cap = cap; this.n = 0; this.head = 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.index = quad.index; g.setAttribute('position', quad.attributes.position);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aPos', this.aPos); g.setAttribute('aUv', this.aUv); g.setAttribute('aColor', this.aColor); g.setAttribute('aRot', this.aRot);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: tex } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending,
      premultipliedAlpha: false });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = blending === THREE.AdditiveBlending ? 11 : 10;
    scene.add(this.mesh);
    this.p = new Array(cap);                      // particle records
    for (let i = 0; i < cap; i++) this.p[i] = { life: 0 };
  }
  // o: {x,y,z, vx,vy,vz, g (gravity), drag, life, s0,s1 (size), rot, spin, c0:[r,g,b,a], c1:[..], uv | frames:[uv..], floor (bounce height fn)}
  add(o) {
    const q = this.p[this.head];
    this.head = (this.head + 1) % this.cap;
    q.x = o.x; q.y = o.y; q.z = o.z; q.vx = o.vx || 0; q.vy = o.vy || 0; q.vz = o.vz || 0;
    q.g = o.g || 0; q.drag = o.drag || 0; q.life = q.max = o.life || 1;
    q.s0 = o.s0 ?? 1; q.s1 = o.s1 ?? q.s0; q.rot = o.rot ?? Math.random() * 6.283; q.spin = o.spin || 0;
    q.c0 = o.c0 || [1, 1, 1, 1]; q.c1 = o.c1 || [q.c0[0], q.c0[1], q.c0[2], 0];
    q.uv = o.uv || null; q.frames = o.frames || null; q.floor = o.floor || null;
    return q;
  }
  update(dt) {
    const P = this.aPos.array, U = this.aUv.array, C = this.aColor.array, R = this.aRot.array;
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      const q = this.p[i];
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) continue;
      q.vy -= q.g * dt;
      if (q.drag) { const k = Math.max(0, 1 - q.drag * dt); q.vx *= k; q.vy *= k; q.vz *= k; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.floor) { const f = q.floor(q.x, q.z) + 0.15; if (q.y < f) { q.y = f; q.vy = Math.abs(q.vy) * 0.3; q.vx *= 0.5; q.vz *= 0.5; q.spin *= 0.4; if (q.vy < 1.5) { q.vy = 0; q.g = 0; q.vx = q.vz = 0; q.spin = 0; } } }
      q.rot += q.spin * dt;
      const t = 1 - q.life / q.max;
      const o = n * 4;
      P[o] = q.x; P[o + 1] = q.y; P[o + 2] = q.z; P[o + 3] = q.s0 + (q.s1 - q.s0) * t;
      const uv = q.frames ? q.frames[Math.min(q.frames.length - 1, Math.floor(t * q.frames.length))] : q.uv;
      U[o] = uv[0]; U[o + 1] = uv[1]; U[o + 2] = uv[2]; U[o + 3] = uv[3];
      for (let k = 0; k < 4; k++) C[o + k] = q.c0[k] + (q.c1[k] - q.c0[k]) * t;
      R[n] = q.rot;
      n++;
    }
    this.geo.instanceCount = n;
    if (n) { this.aPos.needsUpdate = this.aUv.needsUpdate = this.aColor.needsUpdate = this.aRot.needsUpdate = true; }
    this.n = n;
  }
}

// a fixed set of glowing sprites (lantern lights of the map): list of {x, y, z, size, uv}
export function glowSprites(tex, list, color = [1, 0.85, 0.55, 0.55]) {
  const quad = new THREE.PlaneGeometry(1, 1), n = list.length;
  const g = new THREE.InstancedBufferGeometry();
  g.index = quad.index; g.setAttribute('position', quad.attributes.position);
  const P = new Float32Array(n * 4), U = new Float32Array(n * 4), C = new Float32Array(n * 4), R = new Float32Array(n);
  list.forEach((s, i) => { P.set([s.x, s.y, s.z, s.size], i * 4); U.set(s.uv, i * 4); C.set(color, i * 4); });
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(P, 4)); g.setAttribute('aUv', new THREE.InstancedBufferAttribute(U, 4));
  g.setAttribute('aColor', new THREE.InstancedBufferAttribute(C, 4)); g.setAttribute('aRot', new THREE.InstancedBufferAttribute(R, 1));
  g.instanceCount = n;
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: { map: { value: tex } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.frustumCulled = false; m.renderOrder = 9;
  return m;
}

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class FX {
  // texBase: folder of the atlases; ground(x, z): height to bounce bits on
  constructor(scene, camera, texBase, ground) {
    this.scene = scene; this.camera = camera; this.ground = ground;
    const tl = new THREE.TextureLoader();
    const load = (f) => { const t = tl.load(texBase + f); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; return t; };
    const p01 = load('particle_01.png'), p08 = load('particle_08.png'), gore = load('gore.png');
    this.fire = new Layer(scene, p01, THREE.AdditiveBlending, 1500);
    this.smoke = new Layer(scene, p01, THREE.NormalBlending, 1200);
    this.gore = new Layer(scene, gore, THREE.NormalBlending, 900);
    this.misc = new Layer(scene, p08, THREE.AdditiveBlending, 300);
    this.layers = [this.smoke, this.gore, this.fire, this.misc];
    // tracers: stretched glowing boxes
    this.tracers = [];
    this.tracerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 96);
    this.tracerMesh.frustumCulled = false; this.tracerMesh.count = 0; this.tracerMesh.renderOrder = 12;
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.tracerMesh);
    // decals: quads lying on the ground (scorch marks, blood)
    this.decals = [];
    this.decalTex = { scorch: load('scorch.png'), gore };
    // flash lights
    this.lights = [];
    for (let i = 0; i < 4; i++) { const l = new THREE.PointLight(0xffaa55, 0, 60, 1.6); l.userData = { life: 0, max: 1, power: 0 }; scene.add(l); this.lights.push(l); }
    this.trauma = 0;                    // camera shake 0..1
    this.shakeOffset = new THREE.Vector3(); this.shakeRoll = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._c = new THREE.Color();
  }

  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  light(pos, color, power, life, dist = 60) {
    let l = this.lights[0];
    for (const x of this.lights) if (x.userData.life < l.userData.life) l = x;
    l.position.copy(pos); l.color.set(color); l.distance = dist;
    l.userData.life = l.userData.max = life; l.userData.power = power;
  }

  tracer(from, to, color = 0xffd27a, width = 0.09, speed = 520, len = 9) {
    const d = to.clone().sub(from), dist = d.length();
    if (dist < 0.5) return;
    this.tracers.push({ from: from.clone(), dir: d.divideScalar(dist), dist, t: 0, speed, len: Math.min(len, dist), color, width });
    if (this.tracers.length > 96) this.tracers.shift();
  }

  decal(kind, pos, size, life = 30, normal = null, uv = null, rot = Math.random() * 6.283) {
    const tex = this.decalTex[kind === 'blood' ? 'gore' : 'scorch'];
    const g = new THREE.PlaneGeometry(1, 1);
    if (uv) { const a = g.attributes.uv; for (let i = 0; i < 4; i++) a.setXY(i, a.getX(i) ? uv[2] : uv[0], a.getY(i) ? uv[1] : uv[3]); }
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      opacity: kind === 'blood' ? 0.85 : 0.9, color: kind === 'blood' ? 0xb0a0a0 : 0xffffff }));
    const n = normal || new THREE.Vector3(0, 1, 0);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    m.rotateZ(rot);
    m.position.copy(pos).addScaledVector(n, 0.06);
    m.scale.setScalar(size);
    m.renderOrder = 2;
    this.scene.add(m);
    this.decals.push({ m, life, max: life, base: m.material.opacity });
    if (this.decals.length > 90) { const d = this.decals.shift(); this.scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); }
  }

  // ---------------------------------------------------------------- recipes
  muzzle(pos, dir, scale = 1) {
    this.fire.add({ x: pos.x + dir.x * 0.4 * scale, y: pos.y + dir.y * 0.4 * scale, z: pos.z + dir.z * 0.4 * scale, life: 0.06, s0: 1.6 * scale, s1: 2.4 * scale, uv: pick(UV.fire), c0: [1, 0.85, 0.6, 1], c1: [1, 0.6, 0.2, 0] });
    this.fire.add({ x: pos.x + dir.x * 1.2 * scale, y: pos.y + dir.y * 1.2 * scale, z: pos.z + dir.z * 1.2 * scale, life: 0.05, s0: 1.0 * scale, s1: 1.4 * scale, uv: pick(UV.flare), c0: [1, 0.9, 0.7, 1] });
    this.light(pos, 0xffc070, 3.5 * scale, 0.07, 40);
  }
  shell(pos, right) {
    this.fire.add({ x: pos.x, y: pos.y, z: pos.z, vx: right.x * rnd(3, 5), vy: rnd(3, 5), vz: right.z * rnd(3, 5), g: 30, life: 0.9, s0: 0.2, s1: 0.16, uv: UV.flare[0], c0: [1, 0.8, 0.3, 1], c1: [1, 0.7, 0.2, 0.6], floor: this.ground });
  }
  // a bullet striking something: kind 'stone' | 'flesh' | 'metal'
  impact(pos, n, kind = 'stone') {
    if (kind === 'flesh') return this.blood(pos, n, 5);
    for (let i = 0; i < 4; i++) this.fire.add({ x: pos.x, y: pos.y, z: pos.z, vx: n.x * rnd(4, 12) + rnd(-5, 5), vy: n.y * rnd(4, 12) + rnd(0, 8), vz: n.z * rnd(4, 12) + rnd(-5, 5), g: 30, life: rnd(0.12, 0.3), s0: 0.22, s1: 0.05, uv: UV.flare[0], c0: [1, 0.8, 0.5, 1] });
    this.smoke.add({ x: pos.x + n.x * 0.3, y: pos.y + n.y * 0.3, z: pos.z + n.z * 0.3, vx: n.x * 2, vy: n.y * 2 + 1, vz: n.z * 2, drag: 2, life: rnd(0.4, 0.8), s0: 0.6, s1: 2.4, spin: rnd(-1, 1), uv: pick(UV.smoke), c0: kind === 'metal' ? [0.7, 0.7, 0.7, 0.5] : [0.85, 0.75, 0.6, 0.6] });
  }
  blood(pos, dir, n = 6, power = 1) {
    for (let i = 0; i < n; i++) {
      this.gore.add({ x: pos.x, y: pos.y, z: pos.z, vx: dir.x * rnd(2, 9) * power + rnd(-4, 4), vy: rnd(1, 9) * power, vz: dir.z * rnd(2, 9) * power + rnd(-4, 4), g: 26, drag: 0.5, life: rnd(0.35, 0.7),
        s0: rnd(0.5, 1.0), s1: rnd(1.4, 2.6), spin: rnd(-3, 3), uv: pick(UV.blood), c0: [0.9, 0.9, 0.9, 0.95] });
    }
  }
  bloodPool(pos, size = 3) {
    this.decal('blood', pos, size * rnd(0.8, 1.3), 25, null, pick(UV.blood.slice(3)));
  }
  gibs(pos, n = 6, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = rnd(4, 16) * power;
      this.gore.add({ x: pos.x, y: pos.y + rnd(0.5, 2.5), z: pos.z, vx: Math.cos(a) * s, vy: rnd(8, 22) * power, vz: Math.sin(a) * s, g: 38, life: rnd(2.5, 4.5), s0: rnd(0.7, 1.3), s1: 0.9,
        spin: rnd(-12, 12), uv: pick(UV.gib), c0: [1, 1, 1, 1], c1: [1, 1, 1, 0.9], floor: this.ground });
    }
  }
  dust(pos, size = 2, n = 5, color = [0.8, 0.7, 0.55, 0.55]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283;
      this.smoke.add({ x: pos.x + Math.cos(a) * size * 0.3, y: pos.y + 0.3, z: pos.z + Math.sin(a) * size * 0.3, vx: Math.cos(a) * size * 2, vy: rnd(0.5, 2.5), vz: Math.sin(a) * size * 2, drag: 2.5,
        life: rnd(0.6, 1.3), s0: size * 0.6, s1: size * 2.2, spin: rnd(-1, 1), uv: pick(UV.smoke2), c0: color });
    }
  }
  explosion(pos, radius = 9) {
    const k = radius / 9;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * 6.283, e = Math.random() * 1.2, s = rnd(2, 10) * k;
      this.fire.add({ x: pos.x, y: pos.y + 0.8, z: pos.z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + 2, vz: Math.sin(a) * Math.cos(e) * s, drag: 3, life: rnd(0.35, 0.65),
        s0: 3 * k, s1: rnd(7, 11) * k, spin: rnd(-2, 2), frames: UV.fire, c0: [1, 0.9, 0.7, 1], c1: [1, 0.35, 0.05, 0] });
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * 6.283, s = rnd(2, 9) * k;
      this.smoke.add({ x: pos.x, y: pos.y + 1, z: pos.z, vx: Math.cos(a) * s, vy: rnd(3, 9) * k, vz: Math.sin(a) * s, drag: 1.6, life: rnd(1.2, 2.6), s0: 3 * k, s1: rnd(9, 15) * k, spin: rnd(-0.8, 0.8),
        uv: pick(UV.smoke), c0: [0.25, 0.22, 0.2, 0.75] });
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * 6.283, e = rnd(0.1, 1.4), s = rnd(14, 38) * k;
      this.fire.add({ x: pos.x, y: pos.y + 0.6, z: pos.z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s, vz: Math.sin(a) * Math.cos(e) * s, g: 34, drag: 0.6, life: rnd(0.4, 1.1), s0: 0.45, s1: 0.1,
        uv: UV.flare[1], c0: [1, 0.75, 0.3, 1] });
    }
    this.misc.add({ x: pos.x, y: pos.y + 1.2, z: pos.z, life: 0.32, s0: 2, s1: radius * 3.2, rot: 0, uv: UV.ring, c0: [1, 0.85, 0.6, 0.9] });
    this.dust(pos, radius * 0.6, 8);
    this.light(new THREE.Vector3(pos.x, pos.y + 2, pos.z), 0xffa040, 14 * k, 0.35, radius * 8);
    const gy = this.ground(pos.x, pos.z);
    if (pos.y - gy < 3) this.decal('scorch', new THREE.Vector3(pos.x, gy, pos.z), radius * 1.4, 45);
    const d = this.camera.position.distanceTo(pos);
    this.shake(Math.max(0, 0.9 - d / (radius * 9)));
  }
  // one puff of the flame thrower's stream
  flame(pos, vel, size = 1) {
    this.fire.add({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x + rnd(-2, 2), vy: vel.y + rnd(-1, 2.5), vz: vel.z + rnd(-2, 2), drag: 1.5, g: -5, life: rnd(0.35, 0.6), s0: 1.1 * size, s1: rnd(3.5, 5.5) * size,
      spin: rnd(-3, 3), frames: UV.fire, c0: [1, 0.85, 0.5, 0.9], c1: [1, 0.25, 0.02, 0] });
    if (Math.random() < 0.25) this.smoke.add({ x: pos.x + vel.x * 0.25, y: pos.y + vel.y * 0.25 + 1, z: pos.z + vel.z * 0.25, vx: vel.x * 0.3, vy: 4, vz: vel.z * 0.3, drag: 1, life: rnd(0.8, 1.5), s0: 2, s1: 6,
      uv: pick(UV.smoke), c0: [0.12, 0.12, 0.12, 0.45] });
  }
  // flames on something that burns
  burn(pos, size = 1) {
    this.fire.add({ x: pos.x + rnd(-0.6, 0.6) * size, y: pos.y + rnd(0.5, 3) * size, z: pos.z + rnd(-0.6, 0.6) * size, vy: rnd(2, 5), life: rnd(0.25, 0.45), s0: 1.4 * size, s1: 2.4 * size,
      frames: UV.fire, c0: [1, 0.8, 0.45, 0.9], c1: [1, 0.3, 0.05, 0] });
  }
  jet(pos, vel) {
    this.fire.add({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x + rnd(-1, 1), vy: vel.y, vz: vel.z + rnd(-1, 1), life: 0.18, s0: 1.5, s1: 0.4, frames: UV.fire, c0: [0.7, 0.85, 1, 1], c1: [1, 0.5, 0.1, 0] });
    this.smoke.add({ x: pos.x, y: pos.y, z: pos.z, vx: vel.x * 0.4 + rnd(-1, 1), vy: vel.y * 0.4, vz: vel.z * 0.4 + rnd(-1, 1), drag: 2, life: rnd(0.5, 1.0), s0: 1, s1: 3.5, uv: pick(UV.smoke), c0: [0.8, 0.8, 0.8, 0.4] });
  }
  rocketTrail(pos) {
    this.fire.add({ x: pos.x, y: pos.y, z: pos.z, life: 0.12, s0: 1.3, s1: 0.5, uv: pick(UV.fire), c0: [1, 0.8, 0.5, 1] });
    this.smoke.add({ x: pos.x, y: pos.y, z: pos.z, vy: 0.6, drag: 1, life: rnd(0.7, 1.3), s0: 0.8, s1: 3.2, spin: rnd(-1, 1), uv: pick(UV.smoke), c0: [0.85, 0.85, 0.85, 0.5] });
  }
  ring(pos, radius, color = [1, 0.9, 0.7, 0.8]) {
    this.misc.add({ x: pos.x, y: pos.y + 0.6, z: pos.z, life: 0.3, s0: 1.5, s1: radius * 2.6, rot: Math.random() * 6.283, uv: UV.ring, c0: color });
  }
  sparks(pos, n = 10, speed = 14, color = [1, 0.8, 0.4, 1]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, e = rnd(-0.3, 1.3), s = rnd(0.4, 1) * speed;
      this.fire.add({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s, vz: Math.sin(a) * Math.cos(e) * s, g: 30, life: rnd(0.2, 0.55), s0: 0.3, s1: 0.06, uv: UV.flare[0], c0: color });
    }
  }

  update(dt, time) {
    for (const l of this.layers) l.update(dt);
    // tracers
    let n = 0;
    const up = new THREE.Vector3(0, 0, 1);
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt * t.speed;
      if (t.t - t.len > t.dist) { this.tracers.splice(i, 1); continue; }
      const a = Math.max(0, t.t - t.len), b = Math.min(t.dist, t.t);
      if (b <= a) continue;
      this._v.copy(t.from).addScaledVector(t.dir, (a + b) / 2);
      this._q.setFromUnitVectors(up, t.dir);
      this._m.compose(this._v, this._q, new THREE.Vector3(t.width, t.width, b - a));
      this.tracerMesh.setMatrixAt(n, this._m);
      this.tracerMesh.setColorAt(n, this._c.set(t.color));
      n++;
    }
    this.tracerMesh.count = n;
    if (n) { this.tracerMesh.instanceMatrix.needsUpdate = true; if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true; }
    for (const l of this.lights) {
      const u = l.userData;
      if (u.life > 0) { u.life -= dt; l.intensity = u.life > 0 ? u.power * (u.life / u.max) * 40 : 0; }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life -= dt;
      if (d.life <= 0) { this.scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); this.decals.splice(i, 1); } else if (d.life < 4) d.m.material.opacity = d.base * d.life / 4;
    }
    // camera shake: squared trauma, three noisy offsets
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const s = this.trauma * this.trauma;
    this.shakeOffset.set(Math.sin(time * 71.3) * s, Math.sin(time * 83.1 + 1.7) * s, Math.sin(time * 67.9 + 4.1) * s * 0.4);
    this.shakeRoll = Math.sin(time * 59.3 + 2.3) * s * 0.035;
  }
}
