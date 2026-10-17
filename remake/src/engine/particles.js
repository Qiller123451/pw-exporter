import * as THREE from 'three';
import { Assets, loadTexture } from './assets.js';

// The particle emitters of the models (GSF chunk type 2: fires, smoke, sparks, the spray of waterfalls ...).
// The converter writes one node per emitter with its data in the extras (pwexport/gsf.py parse_particle, glTF node
// extras {kind: 'particles', attr, emitter: {scale, max, spread, tiles, params}}). An emitter sprays sprites of a
// texture atlas inside its volume (scale: half sizes along its own axes); they fall or rise with "gravitation" (m/s²,
// positive = down), grow by "size_increase" (size units, added over the life; "size_inc_exp" bends the curve: a guess)
// over their life, fade in and out, turn and play the atlas cells
// tile_start .. tile_start + tile_last. "max" sprites live at a time (a new one every life_time / max seconds).
// The game draws a sprite a quarter of "size" high (measured on the billboards, docs/GSF_FORMAT.md).
//
// Emitters are tracked when a model is cloned (assets.js cloneModel -> track) or placed as a landscape object
// (props.js -> addStatic). Only emitters near the camera spray; a hidden node (building state, epoch, damage stage:
// parts.js applyState) or a detached model sprays nothing. A weapon's flash sprays only while its wielder attacks.

const RANGE = 160;              // m from the camera target
const MAX_PER_BATCH = 4000;
// what the graphics card is asked to fill per frame, in screen areas (sprites close to the camera cover it all;
// thousands of them made a graphics card reset - Windows stops a GPU that takes seconds for a frame), and the
// largest sprite as a share of the screen height
const LEVELS = { low: { fill: 3, sprites: 800 }, on: { fill: 8, sprites: 3000 }, high: { fill: 16, sprites: 6000 } };
const MAX_SHARE = 0.5;
// attribute bit 16 on the emitters of weapons (the turrets' and guns' muzzle flashes and shells, the gatlings', the
// flamers', the staffs' rays): they spray while their wielder attacks (an attack or shoot clip plays). On models that
// do not attack (ruins, gates) the bit means something else and is ignored.
const FIRING = 1 << 16;
const ATTACK = /attack|shoot/;

// Sprites are quads (one instance each): as wide as their atlas cell is to its height, hung at the cell's pivot
// (the atlas record's pivot x / y + 127: -127 .. 127 from the cell's middle to its edge, the rays of the healing aura
// stand on their foot) and turned to the camera - or, for emitters with flag bit 29 (UPRIGHT: the light rays of
// fx_heal_area, the roots' and monoliths' rays), standing upright and only turned about the vertical axis.
const UPRIGHT = 1 << 29;
const VERT = `
attribute vec2 corner;
attribute vec3 aPos; attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute vec2 aTile; attribute float aRot;
attribute vec3 aPivot;        // pivot x, pivot y (-1 .. 1, y down), upright (0 / 1)
uniform float uScale; uniform float uMaxPx; uniform float uAspect;
varying float vAlpha; varying vec3 vColor; varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  float d = max(0.5, -mv.z);
  float h = min(aSize, uMaxPx * d / uScale), w = h * uAspect;      // never larger than the largest share of the screen
  vec2 q = vec2((corner.x - aPivot.x * 0.5) * w, (corner.y + aPivot.y * 0.5) * h);
  if (aPivot.z > 0.5) {
    vec3 r = vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]);
    r = length(r) > 1e-4 ? normalize(r) : vec3(1.0, 0.0, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(aPos + r * q.x + vec3(0.0, q.y, 0.0), 1.0);
  } else {
    float s = sin(aRot), k = cos(aRot);
    mv.xy += vec2(k * q.x - s * q.y, s * q.x + k * q.y);
    gl_Position = projectionMatrix * mv;
  }
  vAlpha = aAlpha; vColor = aColor;
  vUv = vec2(aTile.x + corner.x + 0.5, aTile.y + 0.5 - corner.y);
}`;
const FRAG = `
uniform sampler2D map; uniform vec2 uGrid; uniform float uAdd;
varying float vAlpha; varying vec3 vColor; varying vec2 vUv;
void main() {
  vec4 t = texture2D(map, vec2(vUv.x / uGrid.x, 1.0 - vUv.y / uGrid.y));
  // additive sprites (fire, sparks) are drawn on black and added by their colour: the texture's alpha is not used
  // (the flames of gore.tga have alpha 0)
  if (uAdd > 0.5 && max(t.r, max(t.g, t.b)) < 0.01) discard;
  float a = (uAdd > 0.5 ? 1.0 : t.a) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(t.rgb * vColor, a);
}`;

// one draw call per texture, atlas grid and blending
class Batch {
  constructor(scene, tex, grid, additive) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const n = MAX_PER_BATCH;
    this.pos = new Float32Array(n * 3); this.size = new Float32Array(n); this.alpha = new Float32Array(n);
    this.color = new Float32Array(n * 3); this.tile = new Float32Array(n * 2); this.rot = new Float32Array(n); this.pivot = new Float32Array(n * 3);
    const at = (arr, k) => new THREE.InstancedBufferAttribute(arr, k).setUsage(THREE.DynamicDrawUsage);
    this.attrs = { aPos: at(this.pos, 3), aSize: at(this.size, 1), aAlpha: at(this.alpha, 1), aColor: at(this.color, 3), aTile: at(this.tile, 2), aRot: at(this.rot, 1), aPivot: at(this.pivot, 3) };
    for (const k in this.attrs) g.setAttribute(k, this.attrs[k]);
    g.instanceCount = 0;
    // a cell's width to its height (rays.png: 16 x 2 cells of 16 x 128 px)
    const img = tex.image || {}, aspect = img.width && img.height ? (img.width / grid[0]) / (img.height / grid[1]) : 1;
    this.uniforms = { map: { value: tex }, uGrid: { value: new THREE.Vector2(grid[0], grid[1]) }, uScale: { value: 500 }, uMaxPx: { value: 256 }, uAdd: { value: additive ? 1 : 0 }, uAspect: { value: aspect } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 6 : 5;
    scene.add(this.mesh);
    this.n = 0;
  }
  push(p, a, x) {
    if (this.n >= MAX_PER_BATCH) return;
    const i = this.n++;
    this.pos[i * 3] = p.p.x; this.pos[i * 3 + 1] = p.p.y; this.pos[i * 3 + 2] = p.p.z;
    this.size[i] = p.size; this.alpha[i] = a; this.rot[i] = p.rot;
    this.color[i * 3] = p.c[0]; this.color[i * 3 + 1] = p.c[1]; this.color[i * 3 + 2] = p.c[2];
    this.tile[i * 2] = p.tx; this.tile[i * 2 + 1] = p.ty;
    this.pivot[i * 3] = x.pivot[0]; this.pivot[i * 3 + 1] = x.pivot[1]; this.pivot[i * 3 + 2] = x.upright ? 1 : 0;
  }
  flush() {
    for (const k in this.attrs) {
      const at = this.attrs[k];
      at.clearUpdateRanges(); at.addUpdateRange(0, this.n * at.itemSize); at.needsUpdate = true;
    }
    this.mesh.geometry.instanceCount = this.n;
    this.n = 0;
  }
}

const rnd = (v) => (Math.random() * 2 - 1) * v;
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Sphere();

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.emitters = [];          // {node | matrix, e, attr, parts, acc, batch}
    this.batches = new Map();
    this.frustum = new THREE.Frustum();
    this.enabled = true;
    this.level = 'on';           // Options "Particle effects": off | low | on | high (LEVELS)
    this.seen = null;            // (x, z) => false: a place the player has not explored (fog of war) sprays nothing
  }
  // the emitter nodes of a model (template or clone)
  static nodes(root) {
    const out = [];
    root.traverse((o) => { if (o.userData.kind === 'particles' && o.userData.emitter) out.push(o); });
    return out;
  }
  // a cloned model: its emitters follow their nodes
  track(root) {
    for (const node of Particles.nodes(root)) this.add({ node, root });
  }
  // a landscape object (props.js): emitters of the template placed with the instance matrix; returns the handle
  addStatic(tplRoot, matrix) {
    tplRoot.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(tplRoot.matrixWorld).invert();
    const list = [];
    for (const node of Particles.nodes(tplRoot)) {
      let shown = true;
      for (let o = node; o; o = o.parent) if (!o.visible) shown = false;
      if (!shown) continue;                                   // another state or epoch of the object
      const m = new THREE.Matrix4().multiplyMatrices(matrix, new THREE.Matrix4().multiplyMatrices(inv, node.matrixWorld));
      const x = this.add({ matrix: m, ud: node.userData });
      x.name = (tplRoot.name || '') + '/' + node.name;           // (diagnostics)
      list.push(x);
    }
    return list;
  }
  removeStatic(list) { for (const x of list || []) x.dead = true; }
  add(x) {
    const ud = x.node ? x.node.userData : x.ud;
    const attr = (ud.attr >>> 0) || 0;
    if ((attr & 0x1f) && !(attr & 1)) return x;                 // a lower level of detail
    // night-only lights (fireflies at the lamps): a building's or ship's emitter shows with its node (parts.js
    // applyNight); a landscape object's never (addStatic: the template's night parts are hidden)
    const e = ud.emitter;
    const T = (e.tiles && e.tiles[0]) || {};
    if (!T.tex) return x;
    const P = e.params || {};
    Object.assign(x, { e, P, T, parts: [], acc: Math.random(), idle: 0, anims: e.anims ? new Set(e.anims.map((a) => a.toLowerCase())) : null, fire: !!(attr & FIRING) && !!x.node,
      pivot: [((T.mid_x ?? 127) - 127) / 127, ((T.mid_y ?? 127) - 127) / 127], upright: !!((P.flags >>> 0) & UPRIGHT) });
    if (x.anims && !x.node) return x;                          // a landscape object plays no animation
    this.emitters.push(x);
    return x;
  }
  batch(T) {
    const grid = [1 << (T.tiles_w_log2 || 0), 1 << (T.tiles_h_log2 || 0)];
    const key = T.tex + '|' + grid + '|' + !!T.additive;
    let b = this.batches.get(key);
    if (b) return b;
    b = { pending: true, b: null };
    this.batches.set(key, b);
    const url = new URL(T.tex, new URL(Assets.base + 'models/', location.href)).href;
    loadTexture(url).then((tex) => { b.b = new Batch(this.scene, tex, grid, !!T.additive); }).catch(() => { b.failed = true; });
    return b;
  }
  // is a tracked node part of the scene and shown?
  static shown(node) {
    for (let o = node; o; o = o.parent) {
      if (!o.visible) return false;
      if (o.isScene) return true;
    }
    return false;
  }
  // pixelRatio: the renderer's (point sizes are in drawing buffer pixels)
  update(dt, camera, target, pixelRatio = 1) {
    const L = LEVELS[this.level];
    if (!this.enabled || !L) { for (const b of this.batches.values()) if (b.b) b.b.flush(); return; }
    const pm = _m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(pm);
    const scale = (camera.isPerspectiveCamera ? window.innerHeight / (2 * Math.tan((camera.fov * Math.PI) / 360)) : 500) * pixelRatio;
    const H = window.innerHeight * pixelRatio, maxPx = H * MAX_SHARE;
    const budget = { area: L.fill * H * window.innerWidth * pixelRatio, n: L.sprites };
    const eye = camera.position;
    const keep = [];
    for (const x of this.emitters) {
      if (x.dead) continue;
      const M = x.node ? x.node.matrixWorld : x.matrix;
      _v.setFromMatrixPosition(M);
      // far from the camera with nothing in flight: only a look every 2 s whether its model is still in the scene
      // (thousands of emitters - torches, chimneys, the fires of every damage stage - most of them far away)
      if (!x.parts.length && _v.distanceTo(target) > RANGE) {
        if ((x.chkT = (x.chkT || 0) - dt) <= 0) { x.chkT = 2; if (x.node && !Particles.attached(x.node)) continue; }
        keep.push(x);
        continue;
      }
      let on = true;
      if (x.node) {
        const shown = Particles.shown(x.node);
        if (!shown) { x.idle += dt; if (x.idle > 10 && !x.parts.length && !Particles.attached(x.node)) continue; on = false; } else x.idle = 0;
      }
      keep.push(x);
      if (on && this.seen && !this.seen(_v.x, _v.z)) on = false;
      if (on && x.anims && !Particles.playing(x)) on = false;
      if (on && x.fire && !Particles.firing(x)) on = false;
      if (!x.parts.length && (!on || _v.distanceTo(target) > RANGE || !this.frustum.intersectsSphere(_s.set(_v, 15)))) continue;
      const near = on && _v.distanceTo(target) <= RANGE;
      this.step(x, dt, M, near);
      const b = this.batch(x.T);
      if (!b.b) continue;
      for (const p of x.parts) {
        if (budget.n <= 0 || budget.area <= 0) break;
        const px = Math.min(maxPx, p.size * scale / Math.max(0.5, p.p.distanceTo(eye)));
        budget.n--; budget.area -= px * px;
        b.b.push(p, p.a, x);
      }
    }
    this.emitters = keep;
    this.drawn = L.sprites - budget.n;
    for (const b of this.batches.values()) if (b.b) { b.b.uniforms.uScale.value = scale; b.b.uniforms.uMaxPx.value = maxPx; b.b.flush(); }
  }
  // an emitter that animations drive (extras anims: a finishing move's blood, a sinking ship's smoke): is one of
  // them playing on its model?
  static playing(x) {
    if (x.ctl === undefined) { x.ctl = null; for (let o = x.node; o && !x.ctl; o = o.parent) x.ctl = o.userData.animCtl || null; }
    const n = x.ctl && x.ctl.curName;
    return !!n && x.anims.has(n.replace(/#[sle]$/, ''));
  }
  // a weapon emitter: is the nearest model above it that can attack (the turret, the gunner) attacking?
  static firing(x) {
    if (x.wielder === undefined) {
      x.wielder = null;
      for (let o = x.node; o && !x.wielder; o = o.parent) {
        const c = o.userData.animCtl;
        if (c && [...c.byName.keys()].some((k) => ATTACK.test(k))) x.wielder = c;
      }
    }
    const c = x.wielder;
    return !c || (!!c.cur && c.cur.isRunning() && ATTACK.test(c.curName || ''));
  }
  static attached(node) { for (let o = node; o; o = o.parent) if (o.isScene) return true; return false; }
  // move the living sprites, start new ones
  step(x, dt, M, emit) {
    const P = x.P, T = x.T, e = x.e;
    const life = Math.max(0.1, P.life_time || 1);
    const ws = Math.cbrt(Math.abs(M.determinant())) || 1;                 // the model's scale in the world
    const grav = (P.gravitation || 0) * ws, drag = P.drag || 0;
    for (const p of x.parts) {
      p.age += dt;
      p.v.y -= grav * dt;
      if (drag) p.v.multiplyScalar(Math.max(0, 1 - drag * dt));
      p.p.addScaledVector(p.v, dt);
      p.rot += p.rs * dt;
    }
    x.parts = x.parts.filter((p) => p.age < p.life);
    if (emit) {
      x.acc += dt * Math.max(1, e.max || 1) / life;
      while (x.acc >= 1) {
        x.acc -= 1;
        if (x.parts.length >= (e.max || 1)) { x.acc = 0; break; }
        x.parts.push(this.spawn(x, M, ws, life));
      }
    }
    const n = (T.tile_last || 0) + 1, gw = 1 << (T.tiles_w_log2 || 0);
    for (const p of x.parts) {
      const t = p.age / p.life;
      p.size = Math.max(0.05 * p.s0, p.s0 + (P.size_increase || 0) * p.k * Math.pow(t, Math.pow(2, P.size_inc_exp || 0)));
      let a = p.a0;
      const fi = P.fade_in || 0, fo = P.fade_out || 0;
      if (fi > 0 && t < fi) a *= t / fi;
      if (fo > 0 && t > 1 - fo) a *= (1 - t) / fo;
      p.a = a;
      const f = (T.tile_start || 0) + (n > 1 ? Math.floor(t * n * Math.max(1, P.tile_anim_speed || 1)) % n : 0);
      p.tx = f % gw; p.ty = Math.floor(f / gw);
    }
  }
  spawn(x, M, ws, life) {
    const P = x.P, s = x.e.scale || [0, 0, 0];
    // a point of the emitting volume (glTF node frame: the GSF axes of the emitter)
    const p = new THREE.Vector3(rnd(s[0]), rnd(s[1]), rnd(s[2])).applyMatrix4(M);
    const sp = P.speed_var || 0;
    const v = new THREE.Vector3(rnd(1), rnd(1), rnd(1)).normalize().multiplyScalar(sp * Math.random() * ws);
    const sv = P.size_var || 0;
    const cv = (k) => Math.min(1, Math.max(0, ((P['color_' + k] ?? 255) + rnd(P['color_var_' + k] || 0)) / 255));
    return {
      p, v, age: 0, life: life * (1 + rnd(P.life_time_var || 0)),
      s0: Math.max(0.05, ((P.size || 1) / 4) * ws * Math.max(0.2, 1 + rnd(sv / 2))), k: ws / 4,     // size units -> m
      a0: (P.alpha ?? 255) / 255, c: [cv('r'), cv('g'), cv('b')],
      rot: Math.random() * Math.PI * 2, rs: rnd(P.rotate || 0), size: 0, a: 0, tx: 0, ty: 0,
    };
  }
}
