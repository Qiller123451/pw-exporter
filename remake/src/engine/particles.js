import * as THREE from 'three';
import { Assets, loadTexture } from './assets.js';

// The particle emitters of the models (GSF chunk type 2: fires, smoke, sparks, the spray of waterfalls, hits ...).
// The converter writes one node per emitter with its data in the extras (pwexport/gsf.py parse_particle, glTF node
// extras {kind: 'particles', attr, emitter: {scale, max, spread, tiles, params}}).
//
// Particle source 3, ported from PWClient.exe (docs/spec/particles.md; InitPart 0x709740, ProcPart 0x707e30,
// Process 0x704a10). The emitter's vector ("scale" in the file) is its velocity: particles start on a disk of radius
// x in the emitter's plane (sphere, hemisphere, ring by flag) and fly off with 0.7 z along its axis, tilted outwards
// by "spread"; drag, then gravitation (world units, positive = down), centre suction; size grows by size_increase
// per second; fade_in / fade_out are shares of the life; flag 0x80 starts all particles together (a burst). The
// particles live in the emitter's frame (they move with their model) unless flag 0x80000 puts them in the world.
// The game draws a sprite a quarter of "size" high.
//
// Emitters are tracked when a model is cloned (assets.js cloneModel -> track) or placed as a landscape object
// (props.js -> addStatic). Only emitters near the camera spray; a hidden node (building state, epoch, damage stage:
// parts.js applyState) or a detached model sprays nothing. A weapon's flash sprays only while its wielder attacks.

const RANGE = 160;              // m from the camera target
const SRC_OFFSET = 120, SRC_DIST = 100;     // config ParticleSrcOffset / ParticleSrcDist (Rendering, 0x7096ba)
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

// flags of particle source 3 (parameter "flags"; docs/spec/particles.md)
const F = {
  SPHERE: 0x1, SPHERE_VEL: 0x2, KEEP_POS: 0x4, KEEP_ROT: 0x8, KEEP_SIZE: 0x10, KEEP_TILE: 0x20, RADIAL_VEL: 0x40,
  BURST: 0x80, TILE_FWD: 0x100, RING: 0x200, TILE_BACK: 0x400, TILE_PING: 0x800, TILE_PONG: 0x1000, KEEP_COLOR: 0x2000,
  FADE_ALPHA: 0x4000, FADE_BOTH: 0x8000, RADIAL_H: 0x10000, UP_ONLY: 0x20000, BELOW: 0x40000, WORLD: 0x80000,
  SUCK_ORIGIN: 0x200000, ROT_ORIGIN: 0x400000, HEMI: 0x800000, NO_SPREAD: 0x1000000, STILL: 0x2000000, LOCAL_GRAV: 0x4000000, EDGE_SPEED: 0x8000000,
  NO_Y: 0x10000000, ALONG_VEL: 0x20000000, GROUND: 0x40000000,
};
// Sprites are quads (one instance each): as wide as their atlas cell is to its height, hung at the cell's pivot
// (the atlas record's pivot x / y + 127: -127 .. 127 from the cell's middle to its edge, the rays of the healing aura
// stand on their foot) and turned to the camera. Flag ALONG_VEL turns a sprite so that it points the way it flies on
// the screen (sparks, the rising rays of the healing aura).
const VERT = `
attribute vec2 corner;
attribute vec3 aPos; attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute vec2 aTile; attribute float aRot;
attribute vec3 aPivot;        // pivot x, pivot y (-1 .. 1, y down), flat on the ground (0 / 1)
uniform float uScale; uniform float uMaxPx; uniform float uAspect;
varying float vAlpha; varying vec3 vColor; varying vec2 vUv;
void main() {
  vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
  float d = max(0.5, -mv.z);
  float h = min(aSize, uMaxPx * d / uScale), w = h * uAspect;      // never larger than the largest share of the screen
  vec2 q = vec2((corner.x - aPivot.x * 0.5) * w, (corner.y + aPivot.y * 0.5) * h);
  if (aPivot.z > 0.5) {
    // flag 0x40000000: a square lying flat on the world's ground plane at the particle's height, turned by aRot
    // (renderer 0x7053b3: half-diagonal size / 8 = aSize / 2)
    float side = aSize * 0.7071;
    vec2 g = vec2((corner.x - aPivot.x * 0.5) * side, (corner.y + aPivot.y * 0.5) * side);
    float s = sin(aRot), k = cos(aRot);
    vec3 fwd = vec3(s, 0.0, k), rgt = vec3(k, 0.0, -s);
    gl_Position = projectionMatrix * viewMatrix * vec4(aPos + rgt * g.x + fwd * g.y, 1.0);
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
  push(d, x) {
    if (this.n >= MAX_PER_BATCH) return;
    const i = this.n++;
    this.pos[i * 3] = d.w.x; this.pos[i * 3 + 1] = d.w.y; this.pos[i * 3 + 2] = d.w.z;
    this.size[i] = d.size; this.alpha[i] = d.a; this.rot[i] = d.rot;
    this.color[i * 3] = d.c[0]; this.color[i * 3 + 1] = d.c[1]; this.color[i * 3 + 2] = d.c[2];
    this.tile[i * 2] = d.tx; this.tile[i * 2 + 1] = d.ty;
    this.pivot[i * 3] = x.pivot[0]; this.pivot[i * 3 + 1] = x.pivot[1]; this.pivot[i * 3 + 2] = x.F & F.GROUND ? 1 : 0;
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

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _s = new THREE.Sphere(), _w = new THREE.Vector3(), _d = new THREE.Vector3();
const _g = new THREE.Vector3(), _q = new THREE.Quaternion(), _n3 = new THREE.Matrix3(), _view = new THREE.Matrix3();
const _draw = { w: _w, size: 0, a: 0, c: [1, 1, 1], tx: 0, ty: 0, rot: 0 };

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.emitters = [];          // {node | matrix, e, attr, parts, acc, batch}
    this.dormant = [];           // emitters whose node is hidden (wake)
    this.wakeAt = 0;
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
  // the dormant emitters (their node hidden by its model's state: the fires of the other damage stages and epochs,
  // the parts of wall pieces they don't show - thousands on a map with walls): looked at in slices, a fifteenth of
  // them per frame - back to the active list when the node shows again, gone when its model left the scene
  wake() {
    const D = this.dormant, n = D.length;
    if (!n) return;
    const k = Math.min(n, Math.max(400, Math.ceil(n / 15)));
    for (let c = 0; c < k && D.length; c++) {
      if (this.wakeAt >= D.length) this.wakeAt = 0;
      const i = this.wakeAt, x = D[i];
      const out = () => { D[i] = D[D.length - 1]; D.pop(); };
      if (x.dead || !Particles.attached(x.node)) { out(); continue; }
      if (x.node.visible) { out(); this.emitters.push(x); continue; }
      this.wakeAt++;
    }
  }
  // a clone that sprays nothing (the building placement preview): its emitters are dropped at once - a fan or a
  // flame of the finished building would otherwise turn on where the preview stood (and keep its particles there)
  untrack(root) {
    const nodes = new Set(Particles.nodes(root));
    for (const x of [...this.emitters, ...this.dormant]) if (x.node && nodes.has(x.node)) { x.dead = true; x.parts.length = 0; }
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
    const fl = (P.flags >>> 0) || 0, sc = e.scale || [0, 0, 0], X = Math.max(sc[0], 0.01), sp = e.spread || 0;
    Object.assign(x, { e, P, T, F: fl, parts: [], started: false, idle: 0, anims: e.anims ? new Set(e.anims.map((a) => a.toLowerCase())) : null, fire: !!(attr & FIRING) && !!x.node,
      pivot: [((T.mid_x ?? 127) - 127) / 127, ((T.mid_y ?? 127) - 127) / 127],
      // the outward tilt of the default velocity (constructor 0x707d06); a spread of -pi/2 or less: none
      k: sp > -Math.PI / 2 ? Math.hypot(0.7 * sc[2], X) * Math.sin(sp) / X : null,
      cnt: (T.tile_last || 0) + 1, gw: 1 << (T.tiles_w_log2 || 0) });
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
    const fog = this.scene.fog && this.scene.fog.isFog ? this.scene.fog : null;
    // the load of the last frame (0x706b9f): above half the limit the sources hold back
    const last = this.drawn || 0, lim = L.sprites;
    this.load = last >= lim / 2 ? 1 - Math.min(1, Math.max(0, (last / lim - 0.75) * 4)) : 1;
    this.wake();
    // (the emitters kept are moved up in place: a new list each frame was a good part of the frame's garbage)
    const list = this.emitters;
    let kept = 0, i = 0;
    try {
      for (; i < list.length; i++) {
        const x = list[i];
        if (x.dead) continue;
        // a node its model's state hides (the fires of the other damage stages, the other epochs, the parts of a wall
        // piece it does not show - most of the thousands): nothing to do but a look every 2 s whether the model is
        // still in the scene
        if (x.node && !x.node.visible && !x.parts.length) { this.dormant.push(x); continue; }
        const M = x.node ? x.node.matrixWorld : x.matrix;
        _v.setFromMatrixPosition(M);
        // far from the camera with nothing in flight: only a look every 2 s whether its model is still in the scene
        // (thousands of emitters - torches, chimneys, the fires of every damage stage - most of them far away)
        if (!x.parts.length && _v.distanceTo(target) > RANGE) {
          if ((x.chkT = (x.chkT || 0) - dt) <= 0) { x.chkT = 2; if (x.node && !Particles.attached(x.node)) continue; }
          list[kept++] = x;
          continue;
        }
        let on = true;
        if (x.node) {
          const shown = Particles.shown(x.node);
          if (!shown) { x.idle += dt; if (x.idle > 10 && !x.parts.length && !Particles.attached(x.node)) continue; on = false; } else x.idle = 0;
        }
        list[kept++] = x;
        if (on && this.seen && !this.seen(_v.x, _v.z)) on = false;
        if (on && x.anims && !Particles.playing(x)) on = false;
        if (on && x.fire && !Particles.firing(x)) on = false;
        if (!x.parts.length && (!on || _v.distanceTo(target) > RANGE || !this.frustum.intersectsSphere(_s.set(_v, 15)))) continue;
        const near = on && _v.distanceTo(target) <= RANGE;
        // the source's level of detail (0x703e40): every slot within ParticleSrcOffset (120 m) of the camera, then
        // fewer over ParticleSrcDist (100 m), fewer still when the frame is full (load)
        const max = Math.max(1, x.e.max || 1);
        if (x.root) _g.setFromMatrixPosition(x.root.matrixWorld); else _g.setFromMatrixPosition(M);
        const dl = _g.distanceTo(eye) - SRC_OFFSET;
        x.lod = dl >= SRC_DIST ? 0 : dl <= 0 ? max : Math.min(max, Math.floor(max * (1 - dl / SRC_DIST) * this.load) + 2);
        this.step(x, dt, M, near);
        const b = this.batch(x.T);
        if (!b.b) continue;
        const ws = Math.cbrt(Math.abs(M.determinant())) || 1;
        if (x.F & F.ALONG_VEL) _view.setFromMatrix4(camera.matrixWorldInverse);
        _n3.setFromMatrix4(M);
        for (const p of x.parts) {
          if (!p.vis || p.size < 0.0001) continue;
          if (budget.n <= 0 || budget.area <= 0) break;
          if (p.world) _w.copy(p.p); else _w.copy(p.p).applyMatrix4(M);
          // fading into the scene's fog (0x705191: the renderer's linear fog start / end), gone beyond its end
          const de = _w.distanceTo(eye);
          let fade = 1;
          if (fog && de > fog.near) { if (de >= fog.far) continue; fade = (fog.far - de) / (fog.far - fog.near); }
          const size = p.size / 4 * ws;                                  // (a quarter of "size" high)
          const px = Math.min(maxPx, size * scale / Math.max(0.5, de));
          budget.n--; budget.area -= px * px;
          let rot = p.rot;
          if (x.F & F.ALONG_VEL) {
            // pointing the way it flies on the screen (0x707e30: the screen angle of pos -> pos + v, plus "rotate"); a
            // ground quad: the heading on the ground. A source that turns its particles (src_rot_speed): that motion.
            _d.copy(x.P.src_rot_speed ? p.dv : p.v); if (!p.world) _d.applyMatrix3(_n3);
            if (x.F & F.GROUND) rot = (_d.x || _d.z ? Math.atan2(_d.x, _d.z) : 0) + (x.P.rotate || 0);
            else { _d.applyMatrix3(_view); rot = (_d.x || _d.y ? Math.atan2(-_d.x, _d.y) : 0) + (x.P.rotate || 0); }
          }
          _draw.size = size; _draw.a = p.a * fade; _draw.c = p.c; _draw.tx = p.tx; _draw.ty = p.ty; _draw.rot = rot;
          b.b.push(_draw, x);
        }
      }
    } finally {
      if (i < list.length) for (let j = i; j < list.length; j++) list[kept++] = list[j];      // (an error: the rest kept as is)
      list.length = kept;
    }
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
  // one frame of a source (Process 0x704a10): every particle slot moves (ProcPart); a dead one starts again (InitPart)
  // when the source may emit, else it stays hidden. emit: the source is shown and near the camera.
  step(x, dt, M, emit) {
    dt = Math.min(1, dt);
    if (dt < 0.001) return;
    const P = x.P, max = Math.max(1, x.e.max || 1), fl = x.F;
    // the emitter's movement since the last frame, in its own frame (SetMatrix 0x703f70: moveDelta), and the
    // model's speed in the world (srcVel, for particles that live in the world)
    _w.setFromMatrixPosition(M);
    if (!x.lastW) x.lastW = _w.clone();
    x.md = x.md || new THREE.Vector3();
    x.md.copy(_w).sub(x.lastW).applyMatrix3(_n3.setFromMatrix4(M).invert());
    if (fl & F.WORLD) {
      const v = _d.copy(_w).sub(x.lastW).divideScalar(dt), f = 12.5 * dt;
      x.sv = x.sv || new THREE.Vector3();
      if (dt >= 0.5) x.sv.set(0, 0, 0); else if (f < 1) x.sv.multiplyScalar(1 - f).addScaledVector(v, f); else x.sv.copy(v);
    }
    x.lastW.copy(_w);
    let can = emit;
    // no spray while the emitter is below its model's origin unless flag 0x40000 (Process 0x704a91), for emitters an
    // animation moves (gsf.py: particle animation keys): the SEAS turret's muzzle flashes rest inside the tower and
    // flicker at the barrel, the keys alternating between it and a place inside the turret (the node's translation
    // is in the model's own z-up frame when it hangs from the model's root)
    if (can && x.anims && !(fl & 0x40000) && x.node && x.node.parent && x.node.parent.userData.fourcc && x.node.position.z < 0) can = false;
    if (P.emit_timer > 0) {
      can = false;
      x.timer = (x.timer || 0) + dt;
      if (x.timer >= P.emit_timer) { can = emit; x.timer = P.emit_timer_var ? Math.random() * P.emit_timer_var * P.emit_timer : 0; }
    }
    // the first look: every slot starts (a continuous source at random ages, a burst all at once)
    if (!x.started) {
      if (!emit) return;
      x.started = true;
      x.parts = [];
      for (let i = 0; i < max; i++) {
        const p = { p: new THREE.Vector3(), v: new THREE.Vector3(), dv: new THREE.Vector3(), inh: new THREE.Vector3(), c: [1, 1, 1], base: [1, 1, 1] };
        this.init(x, p, false, M);
        if (P.emit_per_meter > 0) { p.vis = false; p.emitted = false; }    // (constructor 0x707dbe)
        x.parts.push(p);
      }
      x.carry = 0;
      x.live = x.parts.filter((p) => p.vis).length;
      return;
    }
    this.gravity(x, M, dt);
    // emit_per_meter: one particle per so many metres the emitter moved (ship wakes, arrow trails)
    const mpp = P.emit_per_meter > 0 ? 1 / P.emit_per_meter : 0;
    let dist = mpp ? x.md.length() + (x.carry || 0) : 0;
    const lod = x.lod ?? max;
    for (let i = 0; i < x.parts.length; i++) {
      const p = x.parts[i];
      const ok = can && i < lod && (!mpp || dist >= mpp);
      let re = false;
      if (!this.proc(x, p, dt)) { this.init(x, p, true, M); re = true; if (!ok) { p.vis = false; p.emitted = false; } }
      if ((fl & F.BURST) && ok && !p.emitted) { this.init(x, p, false, M); re = true; }
      if (ok && re && mpp) dist -= mpp;
      if (!re) this.look(x, p);
    }
    if (mpp) x.carry = dist % mpp;
    x.live = 0;
    for (const p of x.parts) if (p.vis) x.live++;
    // nothing left in flight and nothing to emit: it starts afresh when it may emit again
    if (!x.live && !emit) { x.started = false; x.parts = []; }
  }
  // gravitation for this frame in the particles' frame: world down (three.js -y), or the emitter's own -z
  gravity(x, M, dt) {
    const g = x.P.gravitation || 0;
    x.gv = null;
    if (!g) return;
    if (x.F & F.LOCAL_GRAV) { x.gv = _g.set(0, 0, -g * dt).clone(); return; }
    x.gv = new THREE.Vector3(0, -g * dt, 0);
    x.gvw = x.gv.clone();                                   // (world-space particles)
    x.gv.applyMatrix3(_n3.setFromMatrix4(M).invert());
  }
  // ProcPart: age, motion, then the look; false = its life is over
  proc(x, p, dt) {
    const P = x.P, fl = x.F;
    if (p.life > 0) {
      p.age += dt;
      if (p.age >= p.life) { p.age %= p.life; p.vis = false; return false; }
    }
    if (!(fl & F.STILL)) {
      if (P.drag) p.v.multiplyScalar(1 - Math.min(1, P.drag * dt));
      if (x.gv) p.v.add(p.world && !(fl & F.LOCAL_GRAV) ? x.gvw : x.gv);
      if (P.center_suck) {
        _d.set(0, 0, 0).sub(p.p);                            // (towards the emitter: its origin in its own frame)
        if (P.suck_vel > 0) _d.addScaledVector(p.v, -P.suck_vel);
        p.v.addScaledVector(_d, P.center_suck * dt);
      }
      if (P.src_rot_speed) {
        // turning about the emitter's axis (0x7080cb): R = -theta about z; about the emitter E + 2e - R e (to first order
        // +theta, slowly spiralling out), about the model's origin R pos (here: the emitter's - no model uses it)
        const th = -P.src_rot_speed * dt, c = Math.cos(th), sn = Math.sin(th), px = p.p.x, py = p.p.y;
        const rx = c * px - sn * py, ry = sn * px + c * py;
        const nx = fl & F.ROT_ORIGIN ? rx : 2 * px - rx, ny = fl & F.ROT_ORIGIN ? ry : 2 * py - ry;
        p.dv.set(nx - px, ny - py, 0);
        p.p.x = nx; p.p.y = ny;
      }
      p.p.addScaledVector(p.v, dt);
      if (p.world) { p.inh.multiplyScalar(1 - Math.min(1, 0.5 * dt)); p.p.addScaledVector(p.inh, dt); }
    }
    if (P.rotate > 0) { const s = (P.rotate + p.rv * (P.rotation_var || 0)) * dt; p.rot += p.rot > 0 ? s : -s; if (p.rot > 6.2832) p.rot -= 6.2832; else if (p.rot < -6.2832) p.rot += 6.2832; }
    if (P.size_increase) p.size += dt * P.size_increase * (P.size_inc_exp ? Math.pow(p.age, P.size_inc_exp) : 1);
    return true;
  }
  // fade and tile of a particle (the end of ProcPart / InitPart)
  look(x, p) {
    const P = x.P, fl = x.F, life = p.life;
    let a = 1;
    if (P.fade_in > 0 && p.age < P.fade_in * life) a = p.age / (P.fade_in * life);
    if (P.fade_out > 0 && p.age > life - P.fade_out * life) a = (life - p.age) / (P.fade_out * life);
    a = Math.max(0, Math.min(1, a));
    const al = (P.alpha ?? 255) / 255;
    const fa = fl & (F.FADE_BOTH | F.FADE_ALPHA), fc = !(fl & F.FADE_ALPHA) || (fl & F.FADE_BOTH);
    p.a = fa ? al * a : al;
    for (let k = 0; k < 3; k++) p.c[k] = fc ? p.base[k] * a : p.base[k];
    const n = x.cnt;
    let f = p.tile0;
    if (n > 1 && life > 0) {
      const t = Math.floor((P.tile_anim_speed ?? 1) * p.age * n / life);
      if (fl & F.TILE_FWD) f = t % n;
      else if (fl & F.TILE_BACK) f = n - 1 - (t % n);
      else if (fl & (F.TILE_PING | F.TILE_PONG)) { const m = t % (2 * n), q = m < n ? m : 2 * n - 1 - m; f = fl & F.TILE_PING ? q : n - 1 - q; }
    }
    f += x.T.tile_start || 0;
    p.tx = f % x.gw; p.ty = Math.floor(f / x.gw);
  }
  // InitPart: where it starts and how it flies (in the emitter's frame: x, y its plane, z its axis)
  init(x, p, re, M) {
    const P = x.P, fl = x.F, sc = x.e.scale || [0, 0, 0];
    p.vis = true; p.emitted = true;
    const w = Math.random() * Math.PI * 2, u = Math.random(), r = Math.sqrt(u) * sc[0];
    const sx = Math.sin(w) * r, cy = Math.cos(w) * r;
    let A = 0, B = 0, C = 0;
    if ((fl & F.SPHERE_VEL) || ((fl & 0x810041) && !(fl & F.KEEP_POS))) { A = sx; B = cy; C = (Math.random() < 0.5 ? -1 : 1) * Math.random() * Math.sqrt(1 - u) * sc[0]; }
    if (!(re && (fl & F.KEEP_POS))) {
      if (fl & F.SPHERE) p.p.set(A, B, C);
      else if (fl & F.HEMI) p.p.set(A, B, Math.abs(C));
      else if (fl & F.RING) { const l = Math.hypot(sx, cy) || 1; p.p.set(sx / l * sc[0], cy / l * sc[0], 0); }
      else p.p.set(sx, cy, 0);
      // EmitPos 0x703ac0: somewhere along the way the emitter moved this frame
      if (x.md && !(fl & F.NO_SPREAD)) p.p.addScaledVector(x.md, -Math.random());
      p.world = false;
    }
    // the "unturned" velocities are along the model's axes: into the emitter's frame with its inverse turn
    const unturned = () => { if (x.node) p.v.applyQuaternion(_q.copy(x.node.quaternion).invert()); };
    if (fl & F.RADIAL_H) { p.v.set(A, B, 0); if (p.v.lengthSq()) p.v.normalize(); p.v.multiplyScalar(sc[2]); unturned(); }
    else if (fl & F.RADIAL_VEL) { p.v.set(A, B, C); if ((fl & F.UP_ONLY) && p.v.z < 0) p.v.z = -p.v.z; if (p.v.lengthSq()) p.v.normalize(); p.v.multiplyScalar(sc[2]); unturned(); }
    else if (fl & F.SPHERE_VEL) { p.v.set(A, B, C).multiplyScalar(0.7 * sc[2] / Math.max(sc[0], 1e-4)); if ((fl & F.UP_ONLY) && p.v.z < 0) p.v.z = -p.v.z; unturned(); }
    else {
      let hx = sx, hy = cy;
      if (fl & F.NO_Y) hy = 0;
      if ((fl & F.EDGE_SPEED) && r > 0) { hx *= sc[0] / r; hy *= sc[0] / r; }
      if (x.k != null) { hx *= x.k; hy *= x.k; }
      p.v.set(hx, hy, 0.7 * sc[2]);
    }
    const life = Math.max(0, P.life_time || 0);
    p.life = life * (P.life_time_var > 0 ? 1 - Math.random() * P.life_time_var : 1);
    if (fl & F.BURST) p.age = 0; else if (!re) p.age = Math.random() * p.life;
    if (!(re && (fl & F.KEEP_TILE))) p.tile0 = (fl & (F.TILE_FWD | F.TILE_PING)) ? 0 : (fl & (F.TILE_BACK | F.TILE_PONG)) ? x.cnt - 1 : Math.floor(Math.random() * x.cnt);
    if (!(re && (fl & F.KEEP_SIZE))) p.size = (P.size || 1) * (1 + (P.size_var ? Math.random() * P.size_var : 0));
    if (!(re && (fl & F.KEEP_COLOR))) for (const [k, c] of [[0, 'r'], [1, 'g'], [2, 'b']]) {
      const vr = P['color_var_' + c] | 0;
      p.base[k] = Math.max(0, (P['color_' + c] ?? 255) - (vr > 0 ? Math.floor(Math.random() * 32768) % vr : 0)) / 255;
    }
    if (P.speed_var > 0) p.v.multiplyScalar(1 + Math.random() * P.speed_var);
    if (fl & F.WORLD) { p.p.applyMatrix4(M); p.v.applyMatrix3(_n3.setFromMatrix4(M)); p.world = true; if (x.sv) p.inh.copy(x.sv).multiplyScalar(0.5); else p.inh.set(0, 0, 0); }
    p.rv = Math.random();
    if (!P.rotate) p.rot = 0;
    else if (!(re && (fl & F.KEEP_ROT))) p.rot = P.emit_rot_inc ? (x.rotAcc = (x.rotAcc || 0) + P.emit_rot_inc * Math.PI / 180) : (Math.random() - 0.5) * 2 * Math.PI;
    this.look(x, p);
  }
}
