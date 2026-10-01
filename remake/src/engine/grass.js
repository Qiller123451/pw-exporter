// Ground grass, like the original: clumps from the setting's grass atlas (Texture/Scape/<Setting>/grassblades_(0512).dds,
// 4 x 4 sprites -> assets/terrain/<Setting>/grass.png) scattered over the grassy ground materials around the camera.
//
// The ground is divided into tiles of TILE metres. Every tile gets the same clumps every time it is built (positions
// come from a hash of the tile coordinates), so nothing shimmers when the camera moves. Only the tiles within
// `radius` of the camera target are drawn; clumps shrink to nothing towards that edge, so they fade in smoothly.
//
//   const grass = new GrassLayer(scene, { texture, height: (x, z) => y, density: (x, z) => 0..1, water, light })
//   grass.update(cameraTarget, time)   // every frame (rebuilds only when the camera moved half a tile)
import * as THREE from 'three';
import { fowUniforms } from './terrain.js';

if (!THREE.ShaderChunk.fog_vertex_sprite) THREE.ShaderChunk.fog_vertex_sprite = '#ifdef USE_FOG\n vFogDepth = - mv.z;\n#endif';

const TILE = 16;            // m
const PER_TILE = 150;        // candidate clumps per tile (kept with probability = density)

const VS = `
attribute vec4 aPos;        // xyz = foot of the clump, w = height (m)
attribute vec2 aCell;       // atlas cell 0..15, tint 0..1
uniform vec3 uCam;          // camera target (for the fade at the edge)
uniform float uRadius, uTime;
varying vec2 vUv;
varying float vTint, vShade;
varying vec3 vW;
void main() {
  float d = length(aPos.xz - uCam.xz);
  float h = aPos.w * (1.0 - smoothstep(uRadius * 0.7, uRadius, d));
  // a camera-facing sprite standing on its foot (like the original's ground sprites): built in view space
  vec4 foot = viewMatrix * vec4(aPos.xyz, 1.0);
  float sway = sin(uTime * 1.7 + aPos.x * 0.35 + aPos.z * 0.21) * 0.10 * position.y * h;
  vec4 mv = foot + vec4(position.x * h * 1.7 + sway, position.y * h, 0.0, 0.0);
  vec3 p = aPos.xyz + vec3(0.0, position.y * h, 0.0);
  float cell = aCell.x;
  vec2 c = vec2(mod(cell, 4.0), floor(cell / 4.0));
  vUv = (c + vec2(position.x + 0.5, 1.0 - position.y)) / 4.0;
  vUv.y = 1.0 - vUv.y;
  vTint = aCell.y;
  vShade = 0.55 + 0.45 * position.y;          // darker at the roots
  vW = p;
  gl_Position = projectionMatrix * mv;
  #include <fog_vertex_sprite>
}`;
const FS = `
uniform sampler2D map;
uniform vec3 light;
uniform sampler2D fowTex;
uniform vec4 fowScale;
uniform float fowOn;
varying vec2 vUv;
varying float vTint, vShade;
varying vec3 vW;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.45) discard;
  vec3 col = t.rgb * light * vShade * (0.85 + 0.3 * vTint);
  if (fowOn > 0.5) {
    float fv = texture2D(fowTex, (vW.xz - fowScale.xy) * fowScale.zw).r;
    col *= smoothstep(0.0, 0.45, fv) * mix(0.55, 1.0, smoothstep(0.45, 0.9, fv));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

// deterministic random numbers for a tile
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class GrassLayer {
  constructor(scene, { texture, height, density, water = null, light, radius = 100, size = 1.5 }) {
    this.height = height; this.density = density; this.water = water; this.radius = radius; this.size = size;
    this.tiles = new Map();             // "i,j" -> Float32Array of [x, y, z, h, cell, tint] * n
    this.center = null;
    const quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    quad.translate(0, 0.5, 0);          // y 0..1: foot at the bottom
    const max = Math.ceil((2 * radius / TILE + 2) ** 2) * PER_TILE;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aCell = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aCell', this.aCell);
    geo.instanceCount = 0;
    this.max = max;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        map: { value: null }, light: { value: null }, uCam: { value: new THREE.Vector3() },
        uRadius: { value: radius }, uTime: { value: 0 },
      }]),
      vertexShader: '#include <fog_pars_vertex>\n' + VS, fragmentShader: FS, fog: true, side: THREE.DoubleSide,
    });
    this.mat.uniforms.map.value = texture;
    this.mat.uniforms.light.value = light || new THREE.Vector3(1, 1, 1);
    Object.assign(this.mat.uniforms, fowUniforms);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;     // the instances follow the camera; bounds are always "around the camera"
    this.mesh.name = 'grass';
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  tile(i, j) {
    const key = i + ',' + j;
    let t = this.tiles.get(key);
    if (t) return t;
    const r = rng((i * 73856093) ^ (j * 19349663));
    const out = [];
    for (let k = 0; k < PER_TILE; k++) {
      const x = (i + r()) * TILE, z = (j + r()) * TILE, keep = r(), cell = Math.floor(r() * 16), tint = r(), hs = r();
      const d = this.density(x, z);
      if (keep >= d) continue;
      const y = this.height(x, z);
      if (this.water != null && y < this.water + 0.3) continue;
      out.push(x, y - 0.05, z, this.size * (0.75 + 0.5 * hs), cell, tint);
    }
    t = new Float32Array(out);
    this.tiles.set(key, t);
    if (this.tiles.size > 4000) this.tiles.delete(this.tiles.keys().next().value);   // keep the cache bounded
    return t;
  }
  rebuild(cx, cz) {
    const R = this.radius, i0 = Math.floor((cx - R) / TILE), i1 = Math.floor((cx + R) / TILE);
    const j0 = Math.floor((cz - R) / TILE), j1 = Math.floor((cz + R) / TILE);
    const P = this.aPos.array, C = this.aCell.array;
    let n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = Math.max(0, Math.abs((i + 0.5) * TILE - cx) - TILE / 2), dz = Math.max(0, Math.abs((j + 0.5) * TILE - cz) - TILE / 2);
      if (dx * dx + dz * dz > R * R) continue;
      const t = this.tile(i, j);
      for (let k = 0; k < t.length && n < this.max; k += 6, n++) {
        P[n * 4] = t[k]; P[n * 4 + 1] = t[k + 1]; P[n * 4 + 2] = t[k + 2]; P[n * 4 + 3] = t[k + 3];
        C[n * 2] = t[k + 4]; C[n * 2 + 1] = t[k + 5];
      }
    }
    this.aPos.clearUpdateRanges(); this.aPos.addUpdateRange(0, n * 4); this.aPos.needsUpdate = true;
    this.aCell.clearUpdateRanges(); this.aCell.addUpdateRange(0, n * 2); this.aCell.needsUpdate = true;
    this.mesh.geometry.instanceCount = n;
    this.count = n;
  }
  update(target, time) {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uCam.value.copy(target);
    if (!this.center || Math.hypot(target.x - this.center.x, target.z - this.center.z) > TILE / 2) {
      this.center = { x: target.x, z: target.z };
      this.rebuild(target.x, target.z);
    }
  }
  // forget the cached tiles around (x, z) - or all of them - and rebuild (buildings placed or removed, settings)
  invalidate(x, z, r = 0) {
    if (x == null) this.tiles.clear();
    else {
      for (let j = Math.floor((z - r) / TILE); j <= Math.floor((z + r) / TILE); j++)
        for (let i = Math.floor((x - r) / TILE); i <= Math.floor((x + r) / TILE); i++) this.tiles.delete(i + ',' + j);
    }
    this.center = null;
  }
  set visible(v) { this.mesh.visible = v; }
  dispose() { this.mesh.parent?.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// how much grass grows on each ground material of a setting (0..1; the 8 materials of Texture/Scape/<Setting>,
// in the order of assets/terrain/<Setting>/scape_<k>.jpg). Chosen by looking at the ground textures: grass and
// meadow materials get grass, sand, rock, snow, ash and lava don't.
export const GRASS_DENSITY = {
  Jungle: [0.75, 0.04, 1.0, 0.3, 0.15, 0.0, 0.04, 0.04],
  Northland: [1.0, 0.05, 0.85, 0.3, 0.04, 0.1, 0.1, 0.0],
  Savanna: [0.12, 0.04, 1.0, 0.5, 0.0, 0.04, 0.04, 0.12],
  Icewaste: [0.0, 0.0, 0.8, 0.08, 0.0, 0.3, 0.0, 0.0],
  Ashvalley: [0.0, 0.1, 0.9, 0.2, 0.0, 0.05, 0.0, 0.0],
};
