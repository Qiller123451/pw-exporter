import * as THREE from 'three';

// The selection circles of the original game, drawn ON the ground and merged where they overlap.
//
// The look comes from Effects/Selection.tga (Texture/Effects/Selection_(0256).dds). Its top strip (rows 8-11) is the
// circle's line: 4 texels across - black, colour, colour, black - in 9 segments of 28 texels: grey (objects without
// an owner), then PlayerColor0..7 (yellow, red, cyan, blue, green, purple, pink, orange). Each segment has a full
// half (alpha 255, selected) and a faint half (alpha 106, used here for the hover ring). The engine lays the line on
// the ground; where the circles of several selected objects overlap, only the outline of their union is drawn (the
// parts of a circle inside another circle are left out), so a selected group reads as one connected shape.
//
// How: every group of circles that should merge (one colour, one kind) is cut into tiles of TILE metres on the
// terrain's own grid. Each tile is a small mesh on exactly the terrain's vertices (same triangle split as the
// height field), so it lies on the drawn ground; its shader takes the circles that reach the tile and draws the band
// just inside the boundary of their union: d = min over circles of (distance to centre - radius); the line is where
// -w < d < 0. polygonOffset keeps it above the coplanar terrain; depth test on, so buildings and units in front hide
// it as in the original.

/** RGB of the line per segment of the strip: [0] no owner, [1 + slot] PlayerColor<slot> */
export const RING_RGB = [[165, 170, 181], [255, 170, 0], [189, 0, 0], [16, 203, 173], [49, 101, 206], [0, 162, 0], [93, 0, 154], [222, 0, 140], [239, 69, 0]];
/** the faint half of a segment (alpha 106 of 255): hover */
export const RING_FAINT = 106 / 255;

/** the line's colour for an owner: its party colour slot, else its UI colour ("No colour"), else grey */
export function ringRgb(owner) {
  if (!owner) return RING_RGB[0];
  if (owner.colorSlot != null && owner.colorSlot >= 0 && RING_RGB[1 + owner.colorSlot]) return RING_RGB[1 + owner.colorSlot];
  const c = owner.color ?? 0x9a9a9a;
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/** wild animals (no owner), Scripts/Game/misc/ACColors.txt "dark": color8 AnimalFriendly (peaceful animals and
 *  those that only fight back: tech tree aggressive -1 / 0), color10 AnimalHostile (hunters: aggressive 1).
 *  (color9 AnimalNeutral 224 232 51 is in the table too; when the engine uses it is not known - not used here.) */
export const ANIMAL_FRIENDLY = [109, 220, 77], ANIMAL_NEUTRAL = [224, 232, 51], ANIMAL_HOSTILE = [224, 97, 43];

/** the line's colour for an object: its owner's (ringRgb); a wild animal by how it behaves; else grey */
export function ringRgbOf(e) {
  if (e && !e.owner && e.cls === 'ANML') return (e.def && e.def.aggressive) === 1 ? ANIMAL_HOSTILE : ANIMAL_FRIENDLY;
  return ringRgb(e && e.owner);
}

/** width of the line (m) for a circle of radius r: ~11 % of a unit's circle, ~3 % of a big building's (measured on
 *  the original's screenshots) */
export const ringWidth = (r) => Math.max(0.08, Math.min(0.45, 0.11 * Math.sqrt(r)));

const MAXC = 64;          // circles one tile's shader takes
const TILE = 16;          // tile size in metres (rounded to whole terrain cells)

const VS = `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position + vec3(0.0, 0.03, 0.0), 1.0);
}`;
const FS = `
uniform vec4 circ[${MAXC}];   // x, z, radius, line width
uniform int n_circ;
uniform vec3 col;
uniform float alpha;
varying vec2 vXZ;
void main() {
  float d = 1e9, w = 0.1;
  for (int i = 0; i < ${MAXC}; i++) {
    if (i >= n_circ) break;
    vec4 c = circ[i];
    float di = length(vXZ - c.xy) - c.z;
    if (di < d) { d = di; w = c.w; }
  }
  w = max(w, fwidth(d) * 3.0);                       // never thinner than ~3 pixels (far camera)
  float u = (1.0 + d / w) * 4.0 - 0.5;               // texel across the strip: 0 black, 1-2 colour, 3 black
  float a = clamp(min(u + 1.0, 4.0 - u), 0.0, 1.0);  // (bilinear fade to the transparent rows around the strip)
  if (a <= 0.0) discard;
  float b = clamp(min(u, 3.0 - u), 0.0, 1.0);
  gl_FragColor = vec4(col * b, a * alpha);
  #include <colorspace_fragment>
}`;

export class GroundRings {
  constructor(G) {
    this.G = G;
    this.groups = new Map();   // key -> {rgb, alpha, list: [x, z, r, w]...}
    this.pool = [];
    this.used = 0;
  }
  /** a circle for this frame. Circles of one key merge; key defaults to colour + alpha. w: line width (m) */
  add(x, z, r, rgb, alpha = 1, key = null, w = null) {
    if (!(r > 0)) return;
    const k = key ?? rgb.join(',') + '/' + alpha.toFixed(3);
    let g = this.groups.get(k);
    if (!g) this.groups.set(k, g = { rgb, alpha, list: [] });
    g.list.push(x, z, r, w ?? ringWidth(r));
  }
  mesh() {
    let m = this.pool[this.used];
    if (!m) {
      const circ = []; for (let i = 0; i < MAXC; i++) circ.push(new THREE.Vector4());
      const mat = new THREE.ShaderMaterial({
        vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false,
        uniforms: { circ: { value: circ }, n_circ: { value: 0 }, col: { value: new THREE.Color() }, alpha: { value: 1 } },
      });
      m = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      m.renderOrder = 6;
      m.frustumCulled = false;
      m.userData.dims = '';
      this.G.scene.add(m);
      this.pool.push(m);
    }
    this.used++;
    m.visible = true;
    return m;
  }
  // the mesh on terrain vertices i0..i1, j0..j1 (inclusive)
  lay(m, i0, j0, i1, j1) {
    const hf = this.G.hf, n = hf.n, e = hf.cell, half = hf.size / 2, H = hf.h;
    const wl = this.G.world.waterLevel;
    const nx = i1 - i0 + 1, nz = j1 - j0 + 1, geo = m.geometry;
    const dims = nx + 'x' + nz;
    if (m.userData.dims !== dims) {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nx * nz * 3), 3));
      const idx = [];
      // two triangles per cell split along (i, j+1) - (i+1, j), as the terrain (HeightField.at)
      for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = (j + 1) * nx + i, c = b + 1, d = a + 1;
        idx.push(a, b, d, b, c, d);
      }
      geo.setIndex(idx);
      m.userData.dims = dims;
    }
    const pos = geo.attributes.position.array;
    let k = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      let h = H[j * n + i];
      if (wl != null && h < wl) h = wl + 0.02;              // on the water surface (ships, shores)
      pos[k++] = i * e - half; pos[k++] = h; pos[k++] = j * e - half;
    }
    geo.attributes.position.needsUpdate = true;
  }
  /** draws this frame's circles and forgets them */
  flush() {
    this.used = 0;
    const hf = this.G.hf;
    if (hf) {
      const n = hf.n, e = hf.cell, half = hf.size / 2, T = Math.max(1, Math.round(TILE / e));
      const cellOf = (v) => Math.floor((v + half) / e);
      for (const g of this.groups.values()) {
        const L = g.list, tiles = new Map();
        for (let c = 0; c < L.length; c += 4) {
          const reach = L[c + 2] + L[c + 3] * 0.2 + 0.05;
          const ci0 = Math.max(0, cellOf(L[c] - reach)), ci1 = Math.min(n - 2, cellOf(L[c] + reach));
          const cj0 = Math.max(0, cellOf(L[c + 1] - reach)), cj1 = Math.min(n - 2, cellOf(L[c + 1] + reach));
          if (ci1 < ci0 || cj1 < cj0) continue;
          for (let tj = Math.floor(cj0 / T); tj <= Math.floor(cj1 / T); tj++) for (let ti = Math.floor(ci0 / T); ti <= Math.floor(ci1 / T); ti++) {
            const key = ti + ',' + tj;
            let t = tiles.get(key);
            if (!t) tiles.set(key, t = { ti, tj, i0: 1e9, j0: 1e9, i1: -1, j1: -1, c: [] });
            // the cells of this tile the circle reaches
            t.i0 = Math.min(t.i0, Math.max(ci0, ti * T)); t.i1 = Math.max(t.i1, Math.min(ci1, ti * T + T - 1));
            t.j0 = Math.min(t.j0, Math.max(cj0, tj * T)); t.j1 = Math.max(t.j1, Math.min(cj1, tj * T + T - 1));
            t.c.push(c);
          }
        }
        for (const t of tiles.values()) {
          const m = this.mesh(), u = m.material.uniforms, cnt = Math.min(MAXC, t.c.length);
          for (let q = 0; q < cnt; q++) { const c = t.c[q]; u.circ.value[q].set(L[c], L[c + 1], L[c + 2], L[c + 3]); }
          u.n_circ.value = cnt;
          u.col.value.setRGB(g.rgb[0] / 255, g.rgb[1] / 255, g.rgb[2] / 255, THREE.SRGBColorSpace);
          u.alpha.value = g.alpha;
          this.lay(m, t.i0, t.j0, t.i1 + 1, t.j1 + 1);      // cells i0..i1 -> vertices i0..i1+1
        }
      }
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
    this.groups.clear();
  }
}

// ---------------------------------------------------------------- health bars (Selection.tga, rows 32-47)
/** the health gradient (rows 32-39, 64 texels: red at 0 % .. green at 100 %), every 8th texel */
const GRAD = [[255, 29, 0], [255, 56, 0], [255, 105, 0], [255, 162, 0], [255, 201, 0], [222, 203, 0], [140, 203, 0], [66, 199, 0], [24, 199, 0]];
export function hpGradient(f) {
  const x = Math.max(0, Math.min(1, f)) * (GRAD.length - 1), i = Math.min(GRAD.length - 2, Math.floor(x)), t = x - i;
  const a = GRAD[i], b = GRAD[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}
/** the swatches under it (rows 40-47, 8 texels each): bar background (black, alpha 191), yellow, light blue */
export const BAR_BACK = 'rgba(0,0,0,0.75)', BAR_BUILD = 'rgb(247,243,90)', BAR_QUEUE = 'rgb(139,192,238)';
/** the level emblems: 32 x 32 cells from (74, 32), level 1..5 */
export const EMBLEM = (level) => [74 + 32 * (Math.max(1, Math.min(5, level)) - 1), 32, 32, 32];
