// A map made by the game itself instead of read from a ParaWorld map file.
//
// The level loader (level.js) wants what the map reader (pw/game/maps/ula.js) returns: heights on a 2 m grid, one of
// 8 ground materials per 4 m tile, a water level and a list of placed objects. MapGen makes exactly that from a
// description of the walkable country:
//
//   const g = new MapGen({ size: 1280, water: 10, seed: 7 });
//   g.disc(x, z, radius, height, { f: 30 })            a flat place
//   g.path([[x, z, height, radius], ...], { f: 28 })   a valley / road through the points (heights run along it)
//   g.shape()                                          -> the heights: floors where the discs and paths are,
//                                                         mountains everywhere else, the sea around the land
//   g.paint(fn) / g.road(...)                          ground materials
//   g.put(model, x, z, yawDeg, { type, dy })           one object, standing on the ground
//   g.wall(model, [[x, z], ...], { gate })             a line of wall pieces on the game's 8 u wall grid
//   g.scatter({ models, n, where })                    trees, rocks, bushes - where the country is free
//   g.data()                                           -> the map data for level.js
//
// All coordinates are the game's (x east, z south, y up, origin in the middle); data() turns them into the map
// file's (x east, y north, origin in a corner). Everything is deterministic (seeded), so the map is the same every
// time and tests can name places.
//
// No imports: the module also runs under Node (tests/mapview.mjs draws the map as a picture).

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (i, j, s) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// value noise 0..1 and its sums
export function noise(x, z, s = 0) {
  const i = Math.floor(x), j = Math.floor(z), u = x - i, v = z - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
  const p = hash(i, j, s), q = hash(i + 1, j, s), r = hash(i, j + 1, s), t = hash(i + 1, j + 1, s);
  return (p + (q - p) * a) * (1 - b) + (r + (t - r) * a) * b;
}
export function fbm(x, z, s = 0, oct = 4) {
  let sum = 0, amp = 0.5, f = 1, n = 0;
  for (let k = 0; k < oct; k++) { sum += amp * noise(x * f, z * f, s + k * 17); n += amp; amp *= 0.5; f *= 2.03; }
  return sum / n;
}
// ridges: sharp crests, 0..1
export function ridged(x, z, s = 0, oct = 4) {
  let sum = 0, amp = 0.5, f = 1, n = 0;
  for (let k = 0; k < oct; k++) { const v = 1 - Math.abs(noise(x * f, z * f, s + k * 31) * 2 - 1); sum += amp * v * v; n += amp; amp *= 0.5; f *= 2.1; }
  return sum / n;
}
export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;

export class MapGen {
  // size: edge of the square map (m, a multiple of 32); water: sea level; sea: height of the sea bed
  constructor(o = {}) {
    this.size = o.size || 1024; this.half = this.size / 2;
    this.water = o.water ?? 10; this.sea = o.sea ?? 2; this.seed = o.seed ?? 1;
    this.n = this.size / 2;                       // heights per row (2 m grid)
    this.m = this.size / 4;                       // material tiles per row (4 m grid)
    this.prims = []; this.lows = [];
    this.objects = [];
    this.keep = [];                               // circles nothing is scattered into: [x, z, r]
    this.rand = rng(this.seed * 7919 + 13);
    // mountains: how far they stand above the floors next to them, and how rough they are
    this.mountain = { base: 24, height: 58, scale: 1 / 150, detail: 9, ...(o.mountain || {}) };
    // the coast: land reaches this far beyond the outermost floors (+- noise)
    this.coast = { reach: 100, vary: 60, slope: 50, ...(o.coast || {}) };
  }

  // ---------------------------------------------------------------- the walkable country
  // o: f = width of the foot of the mountains around it, p = its shape (1 = an even slope, 3 = flat, then a wall), rough = unevenness (m), sea = part of the sea bed (a bay: does
  // not count as land for the coast), tag = a name (materials, tests)
  // mountains within r of this point reach only the share k of their height (full within r / 2): a cape, not a bowl
  lower(x, z, r, k) { this.lows.push({ x, z, r, k }); }
  disc(x, z, r, h, o = {}) { const p = { kind: 'disc', x, z, r, h, f: 60, p: 2.2, rough: 0.5, ...o }; this.prims.push(p); return p; }
  path(pts, o = {}) {
    const p = { kind: 'path', pts: pts.map((q) => ({ x: q[0], z: q[1], h: q[2], r: q[3] })), f: 50, p: 2.2, rough: 0.5, ...o };
    this.prims.push(p);
    return p;
  }
  // distance from (x, z) to the edge of a primitive (negative inside) and its floor height there -> [d, h]
  _dist(p, x, z) {
    if (p.kind === 'disc') return [Math.hypot(x - p.x, z - p.z) - p.r, p.h];
    let bd = 1e9, bh = 0;
    for (let k = 0; k + 1 < p.pts.length; k++) {
      const a = p.pts[k], b = p.pts[k + 1], dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t) - lerp(a.r, b.r, t);
      if (d < bd) { bd = d; bh = lerp(a.h, b.h, t); }
    }
    return [bd, bh];
  }
  // the country at one point, before it is sampled: {h, cover (1 on a floor, 0 in the mountains), land (0 = sea)}
  sample(x, z) {
    let fw = 0, fh = 0, cover = 0, gw = 0, gh = 0, dland = 1e9, rough = 0, low = 1;
    for (const p of this.prims) {
      const [d, h] = this._dist(p, x, z);
      // the foot of the mountains: gentle at the floor, steeper and steeper further out (f = its width, p = how late it rises)
      const w = d <= 0 ? 1 : d >= p.f ? 0 : 1 - Math.pow(d / p.f, p.p);
      if (w > 0) { const w2 = w * w; fw += w2; fh += w2 * h; rough += w2 * p.rough; if (w > cover) cover = w; }
      if (!p.sea) {
        const g = 1 / ((Math.max(0, d) + 24) ** 2); gw += g; gh += g * h;
        if (d < dland) dland = d;
      }
    }
    const M = this.mountain, C = this.coast, s = this.seed;
    const floor = fw > 0 ? fh / fw : 0;
    // mountains stand on the level of the floors around them
    const rd = ridged(x * M.scale, z * M.scale, s + 3, 4);
    const big = fbm(x * M.scale * 0.45, z * M.scale * 0.45, s + 9, 2);
    for (const q of this.lows) low = Math.min(low, lerp(q.k, 1, sstep(q.r * 0.5, q.r, Math.hypot(x - q.x, z - q.z))));
    const mount = (gw > 0 ? gh / gw : 0) + (M.base + M.height * (0.25 + 0.75 * rd) * (0.55 + 0.9 * big)) * low + M.detail * (fbm(x / 23, z / 23, s + 5, 3) - 0.5);
    let h = lerp(mount, floor, cover);
    if (cover > 0) h += (fw > 0 ? rough / fw : 0) * cover * ((fbm(x / 9, z / 9, s + 21, 3) - 0.5) * 2 + (fbm(x / 47, z / 47, s + 23, 2) - 0.5) * 2.4);
    // the sea around the land
    const reach = C.reach + C.vary * (fbm(x / 170, z / 170, s + 41, 3) - 0.5) * 2;
    const land = 1 - sstep(reach - C.slope, reach, dland);
    h = lerp(this.sea + 3 * fbm(x / 60, z / 60, s + 43, 2), h, land);
    return { h, cover, land, floor, dland };
  }
  // sample everything: heights, slopes
  shape() {
    const n = this.n, H = this.heights = new Float32Array(n * n), C = this.cover = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const s = this.sample(i * 2 - this.half, j * 2 - this.half);
      H[j * n + i] = Math.max(0.5, s.h); C[j * n + i] = s.cover;
    }
    this.mats = new Uint8Array(this.m * this.m);
    // the box round the land (scatter() only looks there)
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let j = 0; j < n; j += 2) for (let i = 0; i < n; i += 2) if (H[j * n + i] > this.water) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); z0 = Math.min(z0, j); z1 = Math.max(z1, j); }
    this.landBox = [x0 * 2 - this.half, z0 * 2 - this.half, x1 * 2 - this.half, z1 * 2 - this.half];
    return this;
  }
  // height of the ground (bilinear on the 2 m grid), the same as the level will have
  h(x, z) {
    const n = this.n, H = this.heights;
    let fx = (x + this.half) / 2, fz = (z + this.half) / 2;
    fx = Math.max(0, Math.min(n - 1.001, fx)); fz = Math.max(0, Math.min(n - 1.001, fz));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (H[j * n + i] * (1 - u) + H[j * n + i + 1] * u) * (1 - v) + (H[(j + 1) * n + i] * (1 - u) + H[(j + 1) * n + i + 1] * u) * v;
  }
  // steepness: rise per metre
  slope(x, z, d = 2) { return Math.hypot(this.h(x + d, z) - this.h(x - d, z), this.h(x, z + d) - this.h(x, z - d)) / (2 * d); }
  coverAt(x, z) { const n = this.n, i = Math.max(0, Math.min(n - 1, Math.round((x + this.half) / 2))), j = Math.max(0, Math.min(n - 1, Math.round((z + this.half) / 2))); return this.cover[j * n + i]; }
  // level a round place to the height it has in the middle (for a building), with a soft edge
  level(x, z, r, edge = 6, h = null) {
    const n = this.n, H = this.heights, y = h ?? this.h(x, z);
    const i0 = Math.max(0, Math.floor((x - r - edge + this.half) / 2)), i1 = Math.min(n - 1, Math.ceil((x + r + edge + this.half) / 2));
    const j0 = Math.max(0, Math.floor((z - r - edge + this.half) / 2)), j1 = Math.min(n - 1, Math.ceil((z + r + edge + this.half) / 2));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * 2 - this.half - x, j * 2 - this.half - z), w = 1 - sstep(r, r + edge, d);
      if (w > 0) H[j * n + i] = lerp(H[j * n + i], y, w);
    }
    return y;
  }

  // ---------------------------------------------------------------- ground materials (0..7)
  // fn(x, z, h, slope, cover) -> material for every 4 m tile
  paint(fn) {
    const m = this.m;
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const x = i * 4 + 2 - this.half, z = j * 4 + 2 - this.half;
      const v = fn(x, z, this.h(x, z), this.slope(x, z, 3), this.coverAt(x, z), this.mats[j * m + i]);
      if (v != null) this.mats[j * m + i] = v;
    }
    return this;
  }
  // a material along a line of points, `w` wide (ragged edges)
  road(pts, w, mat) {
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = 0; t <= len; t += 2) {
        const x = lerp(a[0], b[0], t / len), z = lerp(a[1], b[1], t / len);
        const ww = w * (0.75 + 0.5 * noise(x / 13, z / 13, this.seed + 77));
        for (let dz = -ww; dz <= ww; dz += 4) for (let dx = -ww; dx <= ww; dx += 4) if (dx * dx + dz * dz <= ww * ww) this.setMat(x + dx, z + dz, mat);
      }
    }
    return this;
  }
  spot(x, z, r, mat) { for (let dz = -r; dz <= r; dz += 4) for (let dx = -r; dx <= r; dx += 4) if (dx * dx + dz * dz <= r * r) this.setMat(x + dx, z + dz, mat); return this; }
  setMat(x, z, mat) {
    const i = Math.floor((x + this.half) / 4), j = Math.floor((z + this.half) / 4);
    if (i >= 0 && j >= 0 && i < this.m && j < this.m) this.mats[j * this.m + i] = mat;
  }
  matAt(x, z) { const i = Math.max(0, Math.min(this.m - 1, Math.floor((x + this.half) / 4))), j = Math.max(0, Math.min(this.m - 1, Math.floor((z + this.half) / 4))); return this.mats[j * this.m + i]; }

  // ---------------------------------------------------------------- objects
  // yaw in degrees: 0 faces north (-z), 90 west. o: type (the map's object type: BLDG, DCCO, VGTN, TREE ...),
  // y (absolute height) or dy (above the ground), r (nothing is scattered within this distance), flat (level the
  // ground under it, radius)
  put(model, x, z, yaw = 0, o = {}) {
    if (o.flat) this.level(x, z, o.flat, o.edge ?? 6);
    const y = o.y ?? this.h(x, z) + (o.dy || 0);
    // (cls: the map's class name where it is not the model's - the mission tells such objects apart, level.js
    // draws them with CFG.mission.gfx[cls])
    const obj = { type: o.type || 'BLDG', cls: o.cls || model, x, z, y, rot: yaw * DEG, tag: o.tag || null };
    this.objects.push(obj);
    if (o.r !== 0) this.keep.push([x, z, o.r ?? 4]);
    return obj;
  }
  free(x, z, r = 0) { for (const k of this.keep) if ((x - k[0]) ** 2 + (z - k[1]) ** 2 < (k[2] + r) ** 2) return false; return true; }
  // The game's walls: pieces on the 8 u grid (centres at 4 + 8k) that grow arms towards their neighbours, standing
  // at heights in 2 m steps. pts: corner points (snapped to the grid); gate: {model, at: index of the piece it
  // replaces (counted along the line) or a point [x, z]}; towers: [{model, at}] standing on a piece.
  // -> the pieces [{x, z, y, kind}]
  wall(model, pts, o = {}) {
    const tile = (v) => Math.round((v - 4) / 8), out = [], seen = new Set();
    for (let k = 0; k + 1 < pts.length; k++) {
      const i0 = tile(pts[k][0]), j0 = tile(pts[k][1]), i1 = tile(pts[k + 1][0]), j1 = tile(pts[k + 1][1]);
      const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0));
      for (let s = 0; s <= n; s++) {
        const i = i0 + Math.round((i1 - i0) * (n ? s / n : 0)), j = j0 + Math.round((j1 - j0) * (n ? s / n : 0));
        if (seen.has(i + ',' + j)) continue;
        seen.add(i + ',' + j);
        out.push({ i, j, x: i * 8 + 4, z: j * 8 + 4 });
      }
    }
    const near = (at) => (Array.isArray(at) ? out.reduce((b, p, k) => (Math.hypot(p.x - at[0], p.z - at[1]) < Math.hypot(out[b].x - at[0], out[b].z - at[1]) ? k : b), 0) : at);
    const gates = [].concat(o.gate || []).map((g) => ({ ...g, k: near(g.at) }));
    const towers = (o.towers || []).map((t) => ({ ...t, k: near(t.at) }));
    out.forEach((p, k) => {
      p.y = Math.round(this.h(p.x, p.z) / 2) * 2;
      const g = gates.find((q) => q.k === k);
      if (g) {
        // the gate takes the place of the piece; it lies along the line (its long side is its x axis)
        const a = out[Math.max(0, k - 1)], b = out[Math.min(out.length - 1, k + 1)];
        const along = Math.atan2(b.z - a.z, b.x - a.x);                    // direction of the wall line
        p.kind = 'gate';
        p.obj = this.put(g.model, p.x, p.z, -along / DEG, { y: p.y, r: 14, tag: g.tag || 'gate', cls: g.cls });
        return;
      }
      p.kind = 'wall';
      p.obj = this.put(model, p.x, p.z, 0, { y: p.y, r: 5, tag: o.tag || 'wall' });
      const t = towers.find((q) => q.k === k);
      if (t) { p.tower = this.put(t.model, p.x, p.z, t.yaw || 0, { y: p.y, r: 9, tag: t.tag || 'tower' }); }
    });
    return out;
  }
  // Scatter objects where the country is free. o: models (picked at random; an entry may be [model, weight]),
  // n (how many; gives up after n x tries attempts), y (a fixed height instead of the ground), where(x, z, h, slope, cover) -> chance 0..1, gap (to everything placed so far), keep (radius nothing
  // else may come into afterwards), type, area [x0, z0, x1, z1], yaw (false = always 0)
  scatter(o) {
    const R = this.rand, A = o.area || this.landBox;
    const models = o.models.map((m) => (Array.isArray(m) ? m : [m, 1])), total = models.reduce((s, m) => s + m[1], 0);
    let made = 0;
    for (let k = 0; k < o.n * (o.tries || 40) && made < o.n; k++) {
      const x = lerp(A[0], A[2], R()), z = lerp(A[1], A[3], R());
      const h = this.h(x, z);
      if (h < this.water + (o.above ?? 0.6)) { if (!o.wet) continue; } else if (o.wet === 'only') continue;
      const p = o.where ? o.where(x, z, h, this.slope(x, z, 3), this.coverAt(x, z)) : 1;
      if (!(R() < p) || !this.free(x, z, o.gap ?? 1.5)) continue;
      let r = R() * total, model = models[0][0];
      for (const m of models) { r -= m[1]; if (r <= 0) { model = m[0]; break; } }
      this.put(model, x, z, o.yaw === false ? 0 : R() * 360, { type: o.type || 'DCCO', r: o.keep ?? 1.2, dy: o.dy || 0, y: o.y, tag: o.tag || null });
      made++;
    }
    return made;
  }

  // ---------------------------------------------------------------- the map data
  data(extra = {}) {
    const n = this.n, m = this.m, half = this.half;
    // the map file's rows run north -> the game's z runs south: flip
    const heights = new Float32Array(n * n), mats = new Uint8Array(m * m);
    for (let j = 0; j < n; j++) heights.set(this.heights.subarray(j * n, j * n + n), (n - 1 - j) * n);
    for (let j = 0; j < m; j++) mats.set(this.mats.subarray(j * m, j * m + m), (m - 1 - j) * m);
    // (the level reads a height at map y = half - z; with the flip row jj = n - 1 - j holds z = j * 2 - half, i.e.
    // map y = (n - 1 - j) * 2 = half * 2 - 2 - (z + half): 2 m off - shift the rows by one so that both agree)
    const hs = new Float32Array(n * n);
    for (let j = 0; j < n; j++) hs.set(heights.subarray(Math.max(0, j - 1) * n, Math.max(0, j - 1) * n + n), j * n);
    const ms = mats;
    const objects = this.objects.map((o, k) => ({ type: o.type, name: o.cls + '_' + k, cls: o.cls, x: o.x + half, y: half - o.z, z: o.y, rot: o.rot, owner: null, attr: {}, tag: o.tag }));
    return { w: this.size, h: this.size, hx: n, hy: n, heights: hs, mx: m, my: m, mats: ms, water: this.water, objects, plants: [], forest: null, info: {}, generated: true, ...extra };
  }
}
