import * as THREE from 'three';
import { applyFow, fowUniforms } from './terrain.js';

// Static props (trees, rocks, bushes, stone deposits) drawn with InstancedMesh.
// Each frame the camera moves, visible instances are packed to the front of the instance buffers
// (one draw call per model part, only visible instances are processed).
const R0 = new THREE.Matrix4().makeRotationX(-Math.PI / 2);   // model space is Z-up; glTF root rotates to Y-up

export const holeUniforms = {
  uHoles: { value: Array.from({ length: 16 }, () => new THREE.Vector4()) },
  uHoleCount: { value: 0 },
};

// see-through canopies: fragments between the camera and a unit are dithered away
export function applyHoles(material) {
  if (material.userData.holes) return;
  material.userData.holes = true;
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uHoles = holeUniforms.uHoles;
    sh.uniforms.uHoleCount = holeUniforms.uHoleCount;
    sh.vertexShader = 'varying vec3 vHoleW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      { vec4 hw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          hw = instanceMatrix * hw;
        #endif
        vHoleW = (modelMatrix * hw).xyz; }`);
    sh.fragmentShader = 'varying vec3 vHoleW;\nuniform vec4 uHoles[16];\nuniform int uHoleCount;\n' +
      sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      { float dith = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        for (int i = 0; i < 16; i++) { if (i >= uHoleCount) break;
          vec3 c = uHoles[i].xyz; vec3 d = normalize(cameraPosition - c); vec3 p = vHoleW - c; float t = dot(p, d);
          if (t > 1.5) { float r = uHoles[i].w; float f = clamp((r - length(p - d * t)) / (r * 0.45), 0.0, 1.0); if (f > dith) discard; } } }`);
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => key + '|holes';
}

export class PropField {
  constructor(scene) {
    this.scene = scene;
    this.kinds = new Map();   // model name -> {parts:[{geo,mat,matrix}], inst:[{m:Float32Array(16)|null, sphere}], meshes:[InstancedMesh]}
    this.dirty = true;
    this.frustum = new THREE.Frustum();
    this.pm = new THREE.Matrix4();
  }
  // tpl: loaded template (engine/assets loadModel). opts: {castShadow, holes}
  addKind(name, tpl, opts = {}) {
    if (this.kinds.has(name)) return this.kinds.get(name);
    tpl.scene.updateMatrixWorld(true);
    const parts = [];
    tpl.scene.traverse((o) => {
      if (o.isMesh && o.visible && !o.userData.sprite) {
        const mat = o.material;
        applyFow(mat);
        if (opts.holes) applyHoles(mat);
        parts.push({ geo: o.geometry, mat, matrix: o.matrixWorld.clone() });
      }
    });
    const box = new THREE.Box3().setFromObject(tpl.scene);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const k = { name, parts, inst: [], meshes: [], cap: 0, sphere, opts };
    this.kinds.set(name, k);
    return k;
  }
  // returns instance handle
  add(name, x, y, z, rotY, scale) {
    const k = this.kinds.get(name);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(scale, scale, scale));
    const inst = { m, sphere: new THREE.Sphere(new THREE.Vector3(x, y + k.sphere.center.y * scale, z), k.sphere.radius * scale + 4), alive: true };
    k.inst.push(inst);
    this.dirty = true;
    return { kind: k, inst };
  }
  remove(h) {
    if (!h) return;
    h.inst.alive = false;
    this.dirty = true;
  }
  build() {
    for (const k of this.kinds.values()) {
      if (k.meshes.length && k.cap >= k.inst.length) continue;
      for (const m of k.meshes) { this.scene.remove(m); m.dispose(); }
      k.meshes = [];
      k.cap = Math.max(16, k.inst.length);
      for (const p of k.parts) {
        const im = new THREE.InstancedMesh(p.geo, p.mat, k.cap);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false;
        im.castShadow = k.opts.castShadow !== false;
        im.receiveShadow = true;
        im.count = 0;
        im.userData.partMatrix = p.matrix;
        this.scene.add(im);
        k.meshes.push(im);
      }
    }
  }
  update(camera, force) {
    if (!force && !this.dirty && this._lastCam && this._lastCam.equals(camera.matrixWorld)) return;
    this._lastCam = camera.matrixWorld.clone();
    this.dirty = false;
    this.build();
    // widen the frustum test a little so shadows of just-offscreen props still appear
    this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.pm);
    const tmp = new THREE.Matrix4();
    for (const k of this.kinds.values()) {
      let n = 0;
      const vis = [];
      for (const it of k.inst) if (it.alive && this.frustum.intersectsSphere(it.sphere)) vis.push(it);
      k.meshes.forEach((im) => {
        const arr = im.instanceMatrix.array;
        const pm = im.userData.partMatrix;
        n = 0;
        for (const it of vis) { tmp.multiplyMatrices(it.m, pm); tmp.toArray(arr, n * 16); n++; }
        im.count = n;
        im.instanceMatrix.clearUpdateRanges();
        im.instanceMatrix.addUpdateRange(0, n * 16);
        im.instanceMatrix.needsUpdate = true;
      });
    }
  }
}

// ---------------------------------------------------------------- camera-facing foliage sprites
const SPRITE_VS = `
attribute vec4 aCenter;    // xyz = world centre, w = size
attribute vec4 aUv;        // uv rect
attribute vec2 aRot;       // rotation, tint
attribute float aAsp;      // width / height of the sprite (the atlas cell's aspect)
varying vec2 vUv;
varying float vTint;
varying vec3 vW;
void main() {
  vec4 mv = viewMatrix * vec4(aCenter.xyz, 1.0);
  float s = sin(aRot.x), c = cos(aRot.x);
  vec2 q = vec2(position.x * aAsp, position.y);
  vec2 p = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * aCenter.w;
  mv.xy += p;
  vUv = mix(aUv.xy, aUv.zw, vec2(position.x + 0.5, 0.5 - position.y));
  vTint = aRot.y;
  vW = aCenter.xyz;
  gl_Position = projectionMatrix * mv;
  #include <fog_vertex_sprite>
}`;
const SPRITE_FS = `
uniform sampler2D map;
uniform vec3 light;
uniform sampler2D fowTex;
uniform vec4 fowScale;
uniform float fowOn;
uniform vec4 uHoles[16];
uniform int uHoleCount;
varying vec2 vUv;
varying float vTint;
varying vec3 vW;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;
  float dith = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < 16; i++) { if (i >= uHoleCount) break;
    vec3 c = uHoles[i].xyz; vec3 d = normalize(cameraPosition - c); vec3 p = vW - c; float tt = dot(p, d);
    if (tt > 1.5) { float r = uHoles[i].w; float f = clamp((r - length(p - d * tt)) / (r * 0.45), 0.0, 1.0); if (f > dith) discard; } }
  vec3 col = t.rgb * light * (0.55 + 0.55 * vTint);
  if (fowOn > 0.5) {
    float fv = texture2D(fowTex, (vW.xz - fowScale.xy) * fowScale.zw).r;
    col *= smoothstep(0.0, 0.45, fv) * mix(0.55, 1.0, smoothstep(0.45, 0.9, fv));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
const SPRITE_DEPTH_FS = `
uniform sampler2D map;
varying vec2 vUv;
void main() { if (texture2D(map, vUv).a < 0.5) discard; gl_FragColor = vec4(1.0); }`;

THREE.ShaderChunk.fog_vertex_sprite = '#ifdef USE_FOG\n vFogDepth = - mv.z;\n#endif';

export class FoliageField {
  constructor(scene, chunk = 80) {
    this.scene = scene; this.chunk = chunk;
    this.groups = new Map();   // key tex|cx|cz -> {sprites:[], mesh}
    this.light = new THREE.Vector3(1, 1, 1);
    this.textures = new Map();
    this.detailDist = 150;
  }
  // sprites: list of {x,y,z,size,uv:[4],detail}. Detail sprites (the original's close-range LOD layer) are only drawn near the camera.
  // returns a handle to hide the sprites later
  add(tex, sprites) {
    if (!sprites.length) return null;
    const cx = Math.floor(sprites[0].x / this.chunk), cz = Math.floor(sprites[0].z / this.chunk);
    const key = tex.uuid + '|' + cx + '|' + cz;
    let g = this.groups.get(key);
    if (!g) { g = { tex, list: [], dlist: [], mesh: null, dmesh: null, cx, cz }; this.groups.set(key, g); this.textures.set(tex.uuid, tex); }
    const h = { g, start: g.list.length, count: 0, dstart: g.dlist.length, dcount: 0 };
    for (const s of sprites) { if (s.detail) { g.dlist.push(s); h.dcount++; } else { g.list.push(s); h.count++; } }
    return h;
  }
  hide(h) {
    if (!h) return;
    const z = (mesh, start, count) => {
      if (!mesh || !count) return;
      const a = mesh.geometry.attributes.aCenter;
      for (let i = start; i < start + count; i++) a.array[i * 4 + 3] = 0;
      a.clearUpdateRanges(); a.addUpdateRange(start * 4, count * 4); a.needsUpdate = true;
    };
    z(h.g.mesh, h.start, h.count);
    z(h.g.dmesh, h.dstart, h.dcount);
  }
  // show the detail layer only for chunks near the camera
  update(camPos) {
    const c = this.chunk, D2 = this.detailDist * this.detailDist;
    for (const g of this.groups.values()) {
      if (!g.dmesh) continue;
      const dx = (g.cx + 0.5) * c - camPos.x, dz = (g.cz + 0.5) * c - camPos.z;
      g.dmesh.visible = dx * dx + dz * dz < D2;
    }
  }
  build() {
    const quad = new THREE.PlaneGeometry(1, 1);
    for (const g of this.groups.values()) {
      g.mesh = g.list.length ? this.makeMesh(g, g.list, quad) : null;
      g.dmesh = g.dlist.length ? this.makeMesh(g, g.dlist, quad) : null;
    }
  }
  makeMesh(g, list, quad) {
    const n = list.length;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    const cen = new Float32Array(n * 4), uv = new Float32Array(n * 4), rot = new Float32Array(n * 2), asp = new Float32Array(n);
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    let maxS = 0;
    list.forEach((s, i) => {
      cen[i * 4] = s.x; cen[i * 4 + 1] = s.y; cen[i * 4 + 2] = s.z; cen[i * 4 + 3] = s.size;
      uv[i * 4] = s.uv[0]; uv[i * 4 + 1] = s.uv[1]; uv[i * 4 + 2] = s.uv[2]; uv[i * 4 + 3] = s.uv[3];
      rot[i * 2] = s.rot ?? Math.random() * 6.283; rot[i * 2 + 1] = s.tint ?? Math.random();
      asp[i] = s.aspect || 1;
      box.expandByPoint(v.set(s.x, s.y, s.z));
      maxS = Math.max(maxS, s.size);
    });
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(cen, 4));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 4));
    geo.setAttribute('aRot', new THREE.InstancedBufferAttribute(rot, 2));
    geo.setAttribute('aAsp', new THREE.InstancedBufferAttribute(asp, 1));
    geo.instanceCount = n;
    geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    geo.boundingSphere.radius += maxS;
    const mesh = new THREE.Mesh(geo, this.colorMat(g.tex));
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.customDepthMaterial = this.depthMat(g.tex);
    this.scene.add(mesh);
    return mesh;
  }
  colorMat(tex) {
    if (!this.colorMats) this.colorMats = new Map();
    let mat = this.colorMats.get(tex.uuid);
    if (!mat) {
      mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, light: { value: this.light } }]),
        vertexShader: '#include <fog_pars_vertex>\n' + SPRITE_VS, fragmentShader: SPRITE_FS, fog: true, side: THREE.DoubleSide,
      });
      mat.uniforms.map.value = tex;
      mat.uniforms.light.value = this.light;
      Object.assign(mat.uniforms, fowUniforms);
      mat.uniforms.uHoles = holeUniforms.uHoles;
      mat.uniforms.uHoleCount = holeUniforms.uHoleCount;
      this.colorMats.set(tex.uuid, mat);
    }
    return mat;
  }
  depthMat(tex) {
    if (!this.depthMats) this.depthMats = new Map();
    let m = this.depthMats.get(tex.uuid);
    if (!m) {
      m = new THREE.ShaderMaterial({ uniforms: { map: { value: tex } }, vertexShader: SPRITE_VS.replace('#include <fog_vertex_sprite>', ''), fragmentShader: SPRITE_DEPTH_FS, side: THREE.DoubleSide });
      this.depthMats.set(tex.uuid, m);
    }
    return m;
  }
}

// The drawn height of a GSF sprite is a quarter of its stored size (calibrated on objects of known size: the Dragon
// Clan barrels and paper lanterns, flowers, fruit; at the full size a barrel would stand 6.8 m tall).
export const SPRITE_SCALE = 0.25;

// Convert glTF-root extras.foliage of a tree template into world sprites for one placed instance.
export function treeSprites(extras, x, y, z, rotY, scale, opts = {}) {
  const out = new Map();   // tex uri -> sprites
  if (!extras || !extras.foliage) return out;
  const s = Math.sin(rotY), c = Math.cos(rotY);
  let top = 0.5;
  for (const f of extras.foliage) for (let i = 2; i < f.pts.length; i += 3) top = Math.max(top, f.pts[i]);
  for (const f of extras.foliage) {
    if (!f.tex || /particle/i.test(f.tex)) continue;     // no texture / particle emitters (butterflies etc.)
    const list = out.get(f.tex) || [];
    const p = f.pts;
    const lm = /_lod([0-9a-f]+)$/i.exec(f.mesh || '');
    const detail = lm ? !(parseInt(lm[1], 16) & 4) : false;   // not drawn at the original's LOD level 2 -> near-only layer
    const aspect = f.uv ? (f.uv[2] - f.uv[0]) / Math.max(1e-3, f.uv[3] - f.uv[1]) : 1;
    for (let i = 0; i < p.length; i += 3) {
      // Z-up model coords -> Y-up (x, z, -y), then yaw + scale
      const lx = p[i], ly = p[i + 2], lz = -p[i + 1];
      // ground cover (flowers, reeds, grass of the landscape objects): upright stalks standing on the ground,
      // the stored size is far too large for them
      const ground = opts.ground && ly < 0.5;
      const size = f.size * SPRITE_SCALE * scale;
      list.push({ x: x + (lx * c + lz * s) * scale, y: y + ly * scale + (ground ? size * 0.45 : 0), z: z + (-lx * s + lz * c) * scale, size, uv: f.uv, detail,
        aspect, rot: ground || aspect !== 1 ? (Math.random() - 0.5) * 0.25 : undefined,
        tint: Math.min(1, Math.max(0, ly / top)) * 0.8 + Math.random() * 0.2 });
    }
    out.set(f.tex, list);
  }
  return out;
}

// ---------------------------------------------------------------- sprites that belong to a model
// 2D parts of buildings, ships and machines (Dragon Clan paper lanterns, banners, torch flames): billboard chunks of
// the GSF that are not foliage. One mesh per billboard node, centres in the node's local space (instanced quad),
// facing the camera; it carries the node's attribute bits so engine/parts.js shows it in the same states as the
// meshes around it (construction stages, epochs, damage).
const LSPRITE_VS = `
attribute vec3 aCenter;
varying vec2 vUv;
varying vec3 vW;
uniform vec4 uvRect;
uniform vec2 size;
void main() {
  // sprites on the ground (grass, bushes around a building) stand on it instead of sinking in half
  vec3 c = aCenter;
  if (c.z < 0.3) c.z += size.y * 0.45;
  vec4 w = modelMatrix * vec4(c, 1.0);
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  float sc = length(modelMatrix[0].xyz);
  mv.xy += vec2(position.x * size.x, position.y * size.y) * sc;
  vUv = mix(uvRect.xy, uvRect.zw, vec2(position.x + 0.5, 0.5 - position.y));
  gl_Position = projectionMatrix * mv;
  #include <fog_vertex_sprite>
}`;
const LSPRITE_FS = `
uniform sampler2D map;
uniform vec3 light;
uniform sampler2D fowTex;
uniform vec4 fowScale;
uniform float fowOn;
varying vec2 vUv;
varying vec3 vW;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.5) discard;
  vec3 col = t.rgb * light;
  if (fowOn > 0.5) {
    float fv = texture2D(fowTex, (vW.xz - fowScale.xy) * fowScale.zw).r;
    col *= smoothstep(0.0, 0.45, fv) * mix(0.55, 1.0, smoothstep(0.45, 0.9, fv));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;
export const spriteLight = new THREE.Vector3(1, 1, 1);
let quadGeo = null;
// f: a root extras.foliage entry; map: the texture of the billboard's material
export function modelSprites(f, map) {
  if (!quadGeo) quadGeo = new THREE.PlaneGeometry(1, 1);
  const n = f.pts.length / 3;
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quadGeo.index;
  geo.setAttribute('position', quadGeo.attributes.position);
  geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(f.pts), 3));
  geo.instanceCount = n;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) box.expandByPoint(v.fromArray(f.pts, i * 3));
  const h = f.size * SPRITE_SCALE;
  geo.boundingBox = box.clone().expandByScalar(h);
  geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  geo.boundingSphere.radius += h;
  const [u0, v0, u1, v1] = f.uv;
  const aspect = (u1 - u0) / Math.max(1e-3, v1 - v0);
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      map: { value: map }, light: { value: spriteLight }, uvRect: { value: new THREE.Vector4(u0, v0, u1, v1) },
      size: { value: new THREE.Vector2(h * aspect, h) } }]),
    vertexShader: '#include <fog_pars_vertex>\n' + LSPRITE_VS, fragmentShader: LSPRITE_FS, fog: true, side: THREE.DoubleSide,
  });
  mat.uniforms.map.value = map;
  mat.uniforms.light.value = spriteLight;
  Object.assign(mat.uniforms, fowUniforms);
  mat.userData.fow = true;            // has its own fog of war (applyFow must not patch it)
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.sprite = true;
  mesh.castShadow = false;
  mesh.name = f.mesh + '_sprites';
  return mesh;
}
