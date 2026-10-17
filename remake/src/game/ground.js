// The ground levelling under a building a player puts down (the original's ScapeMgr.AdaptTerrain(gfx, pos, rot,
// coastal), ServerApp.usl: every building but walls and gates). Each building model has a ground brush,
// Texture/Scape/ObjBrush/<gfx>.tga (pipeline/build_terrain.py -> assets/terrain/objbrush.json): its alpha says how
// strongly the ground under every half metre is pulled to the building's floor height - fully under the house, a
// soft falloff around it - so it stands level instead of sinking into a slope or hovering over a dip. The building
// then stands at the new height (TP410 in ServerApp.usl). The brush's colour gives the ground material of every 4 m
// cell under it (brushCells): gravel under the building, earth around it, grass at the corners.
// docs/TERRAIN_NOTES.md "Object brushes".

export class GroundBrushes {
  // json = objbrush.json {metres_per_pixel, brushes: {gfx: {w, h, a: base64 alpha, m: base64 ground material}}}
  constructor(json) {
    this.mpp = (json && json.metres_per_pixel) || 0.5;
    this.raw = (json && json.brushes) || {};
    this.cache = new Map();
  }
  // {w, h, a: Uint8Array alpha, m: Uint8Array ground material 0..7 or null (row 0 = the model's -y side)} or null
  get(gfx) {
    const k = String(gfx || '').toLowerCase();
    if (this.cache.has(k)) return this.cache.get(k);
    const r = this.raw[k];
    const bytes = (b64) => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; };
    const b = r ? { w: r.w, h: r.h, a: bytes(r.a), m: r.m ? bytes(r.m) : null } : null;
    this.cache.set(k, b);
    return b;
  }
}

// brush alpha (0..1) at a point of the brush in metres from its centre (bilinear)
function sample(b, mpp, bx, bz) {
  const fx = bx / mpp + b.w / 2 - 0.5, fz = bz / mpp + b.h / 2 - 0.5;
  if (fx < -0.5 || fz < -0.5 || fx > b.w - 0.5 || fz > b.h - 0.5) return 0;
  const i = Math.max(0, Math.min(b.w - 2, Math.floor(fx))), j = Math.max(0, Math.min(b.h - 2, Math.floor(fz)));
  const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fz - j));
  const A = b.a, w = b.w;
  return ((A[j * w + i] * (1 - u) + A[j * w + i + 1] * u) * (1 - v) + (A[(j + 1) * w + i] * (1 - u) + A[(j + 1) * w + i + 1] * u) * v) / 255;
}

// level the height field hf (engine/terrain.js HeightField) under brush b at world (x, z), building heading `heading`.
// The model's axes (and the brush's: x, y with y = rows) lie along the world's x and z at heading pi (maps/frame.js).
// Returns the changed rectangle of height samples {i0, j0, i1, j1} or null.
export function levelGround(hf, b, mpp, x, z, heading) {
  if (!b) return null;
  const t = heading - Math.PI, c = Math.cos(t), s = Math.sin(t);
  const R = Math.hypot(b.w, b.h) * mpp / 2;
  const half = hf.size / 2, n = hf.n, cell = hf.cell;
  const i0 = Math.max(0, Math.floor((x - R + half) / cell)), i1 = Math.min(n - 1, Math.ceil((x + R + half) / cell));
  const j0 = Math.max(0, Math.floor((z - R + half) / cell)), j1 = Math.min(n - 1, Math.ceil((z + R + half) / cell));
  if (i1 < i0 || j1 < j0) return null;
  // the floor height: the ground under the fully levelled part of the brush (its middle), on average
  const W = [];
  let sum = 0, wsum = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const dx = i * cell - half - x, dz = j * cell - half - z;
    const a = sample(b, mpp, dx * c - dz * s, dx * s + dz * c);
    W.push(a);
    if (a > 0.9) { sum += hf.h[j * n + i]; wsum++; }
  }
  if (!W.some((a) => a > 0)) return null;
  const h0 = wsum ? sum / wsum : hf.at(x, z);
  let k = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++, k++) {
    const a = W[k];
    if (a > 0) hf.h[j * n + i] += (h0 - hf.h[j * n + i]) * a;
  }
  return { i0, j0, i1, j1 };
}

// The ground materials the brush gives the 4 m material cells under it (PWServer.exe AdaptTerrain: every cell whose
// centre lies on the brush takes the material of the pixel there - R, G, B above 127 = bits 2, 1, 0 of the material
// index, pwexport/scape.py brush_materials). cell(x, z) -> [i, j, cx, cz]: the cell of a point and its centre.
// Returns [[i, j, material]].
export function brushCells(b, mpp, x, z, heading, cell) {
  if (!b || !b.m) return [];
  const t = heading - Math.PI, c = Math.cos(t), s = Math.sin(t);
  const R = Math.hypot(b.w, b.h) * mpp / 2 + 4;
  const out = [], seen = new Set();
  for (let pz = z - R; pz <= z + R; pz += 2) for (let px = x - R; px <= x + R; px += 2) {
    const [i, j, cx, cz] = cell(px, pz), key = i + ',' + j;
    if (seen.has(key)) continue;
    seen.add(key);
    const dx = cx - x, dz = cz - z, bx = dx * c - dz * s, bz = dx * s + dz * c;
    const u = Math.floor(bx / mpp + b.w / 2), v = Math.floor(bz / mpp + b.h / 2);
    if (u < 0 || v < 0 || u >= b.w || v >= b.h) continue;
    out.push([i, j, b.m[v * b.w + u]]);
  }
  return out;
}
