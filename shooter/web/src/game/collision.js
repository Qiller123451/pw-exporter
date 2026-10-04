// What is solid in the level: the terrain height field plus a "triangle soup" of every solid scenery model
// (houses, city walls, bridges, stairs, piers ...), sorted into a grid of square columns for fast look-ups.
//
//   const col = new CollisionWorld(size, heightFn, cell);
//   col.addModel(templateScene, instanceMatrix);  col.addCylinder(x, y, z, r, h);  col.build();
//
//   col.groundAt(x, z, yMax)            highest thing to stand on at (x, z) that is not above yMax (terrain or a
//                                       walkable triangle: floor, stair, bridge deck, roof). col.groundKind says which.
//   col.ceilingAt(x, z, y0, y1)         lowest triangle above y0 (up to y1), or Infinity
//   col.pushOut(p, r, y0, y1)           moves p.x / p.z out of walls for a body of radius r between heights y0..y1;
//                                       returns true if it touched something (col.pushNx / pushNz = last wall normal)
//   col.raycast(ox, oy, oz, dx, dy, dz, max)   distance to the first hit of a ray (direction normalised) or Infinity;
//                                       col.hit = {x, y, z, nx, ny, nz, ground}
//   col.clear(ax, ay, az, bx, by, bz)   is the straight line between two points free?
//
// A character is treated as an upright capsule: it stands on groundAt() and is pushed out of everything that is
// steeper than a ramp between its knees and its head. Units: metres; y is up.
import * as THREE from 'three';

const WALK_NY = 0.55;          // a triangle is ground when its normal points up at least this much (about 56 degrees)

export class CollisionWorld {
  constructor(size, heightFn, cell = 2) {
    this.size = size; this.half = size / 2; this.cell = cell;
    this.n = Math.ceil(size / cell);
    this.height = heightFn;
    this._soup = [];                 // triangles while models are added: x0,y0,z0, x1,y1,z1, x2,y2,z2 ...
    this.tri = null; this.nrm = null; this.count = 0;
    this.cellStart = null; this.cellTris = null; this.stamp = null; this.stampNo = 1;
    this.hit = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, ground: false };
    this.groundKind = 'terrain'; this.groundNy = 1;
    this.pushNx = 0; this.pushNz = 0;
  }

  // every visible mesh below `root`, moved by `matrix` (the instance's place in the world)
  // skip(mesh): leave these meshes out (the doors of the city gate, which open later)
  addModel(root, matrix, skip = null) {
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (!o.isMesh || !o.visible || o.userData.sprite || !o.geometry || !o.geometry.attributes.position) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mat && mat.userData && mat.userData.noCollide) return;
      if (skip && skip(o)) return;
      m.multiplyMatrices(matrix, o.matrixWorld);
      const pos = o.geometry.attributes.position, idx = o.geometry.index;
      const n = idx ? idx.count : pos.count;
      const out = this._soup;
      for (let i = 0; i + 2 < n; i += 3) {
        for (let k = 0; k < 3; k++) {
          const vi = idx ? idx.getX(i + k) : i + k;
          v.fromBufferAttribute(pos, vi).applyMatrix4(m);
          out.push(v.x, v.y, v.z);
        }
      }
    });
  }

  // more solid things after build() (buildings that are put up during the mission): call add...(), then append()
  begin() { this._soup = []; }
  append() {
    const add = this._soup, old = this.tri;
    const all = new Float32Array(old.length + add.length);
    all.set(old, 0); all.set(add, old.length);
    this._soup = all;
    this.build();
  }

  // an upright 6-sided post (tree trunks)
  addCylinder(x, y, z, r, h) {
    const out = this._soup, N = 6;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 6.2832, a1 = ((i + 1) / N) * 6.2832;
      const x0 = x + Math.cos(a0) * r, z0 = z + Math.sin(a0) * r, x1 = x + Math.cos(a1) * r, z1 = z + Math.sin(a1) * r;
      out.push(x0, y, z0, x1, y, z1, x1, y + h, z1, x0, y, z0, x1, y + h, z1, x0, y + h, z0);
    }
  }

  // an upright box given by its centre line: used for invisible walls
  addWall(x0, z0, x1, z1, y0, y1) {
    this._soup.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x0, y1, z0);
  }

  build() {
    const src = this._soup, count = Math.floor(src.length / 9);
    const tri = new Float32Array(count * 9), nrm = new Float32Array(count * 3);
    const n = this.n, cell = this.cell, half = this.half;
    const counts = new Uint32Array(n * n + 1);
    let kept = 0;
    const range = (t) => {
      const o = t * 9;
      const xa = Math.min(tri[o], tri[o + 3], tri[o + 6]), xb = Math.max(tri[o], tri[o + 3], tri[o + 6]);
      const za = Math.min(tri[o + 2], tri[o + 5], tri[o + 8]), zb = Math.max(tri[o + 2], tri[o + 5], tri[o + 8]);
      return [Math.max(0, Math.floor((xa + half) / cell)), Math.min(n - 1, Math.floor((xb + half) / cell)),
        Math.max(0, Math.floor((za + half) / cell)), Math.min(n - 1, Math.floor((zb + half) / cell))];
    };
    for (let t = 0; t < count; t++) {
      const s = t * 9, o = kept * 9;
      const ax = src[s], ay = src[s + 1], az = src[s + 2];
      const e1x = src[s + 3] - ax, e1y = src[s + 4] - ay, e1z = src[s + 5] - az;
      const e2x = src[s + 6] - ax, e2y = src[s + 7] - ay, e2z = src[s + 8] - az;
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-7) continue;                                       // degenerate
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 9; k++) tri[o + k] = src[s + k];
      nrm[kept * 3] = nx; nrm[kept * 3 + 1] = ny; nrm[kept * 3 + 2] = nz;
      const [i0, i1, j0, j1] = range(kept);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) counts[j * n + i + 1]++;
      kept++;
    }
    for (let c = 0; c < n * n; c++) counts[c + 1] += counts[c];
    const cellTris = new Uint32Array(counts[n * n]);
    const fill = counts.slice(0, n * n);
    for (let t = 0; t < kept; t++) {
      const [i0, i1, j0, j1] = range(t);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cellTris[fill[j * n + i]++] = t;
    }
    this.tri = tri.subarray(0, kept * 9); this.nrm = nrm.subarray(0, kept * 3); this.count = kept;
    this.cellStart = counts; this.cellTris = cellTris;
    this.stamp = new Uint32Array(kept);
    this._soup = null;
  }

  _cell(x, z) {
    const i = Math.floor((x + this.half) / this.cell), j = Math.floor((z + this.half) / this.cell);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }

  // height of triangle t at (x, z), or NaN when the point is not below / above it
  _yOn(t, x, z) {
    const T = this.tri, o = t * 9;
    const ax = T[o], az = T[o + 2], bx = T[o + 3], bz = T[o + 5], cx = T[o + 6], cz = T[o + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (d > -1e-9 && d < 1e-9) return NaN;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const w = 1 - u - v;
    if (u < -0.001 || v < -0.001 || w < -0.001) return NaN;
    return u * T[o + 1] + v * T[o + 4] + w * T[o + 7];
  }

  groundAt(x, z, yMax = Infinity) {
    let best = this.height(x, z);
    this.groundKind = 'terrain'; this.groundNy = 1;
    const c = this._cell(x, z);
    if (c < 0) return best;
    const N = this.nrm, L = this.cellTris;
    for (let k = this.cellStart[c], e = this.cellStart[c + 1]; k < e; k++) {
      const t = L[k], ny = N[t * 3 + 1];
      if (ny < WALK_NY && ny > -WALK_NY) continue;
      const y = this._yOn(t, x, z);
      if (y <= yMax && y > best) { best = y; this.groundKind = 'mesh'; this.groundNy = Math.abs(ny); }
    }
    return best;
  }

  ceilingAt(x, z, y0, y1) {
    const c = this._cell(x, z);
    let best = Infinity;
    if (c < 0) return best;
    const N = this.nrm, L = this.cellTris;
    for (let k = this.cellStart[c], e = this.cellStart[c + 1]; k < e; k++) {
      const t = L[k], ny = N[t * 3 + 1];
      if (ny < 0.3 && ny > -0.3) continue;
      const y = this._yOn(t, x, z);
      if (y > y0 && y < y1 && y < best) best = y;
    }
    return best;
  }

  // squared distance from point p to triangle t; the closest point is left in this._cx/_cy/_cz (Ericson, RTCD 5.1.5)
  _closest(t, px, py, pz) {
    const T = this.tri, o = t * 9;
    const ax = T[o], ay = T[o + 1], az = T[o + 2], bx = T[o + 3], by = T[o + 4], bz = T[o + 5], cx = T[o + 6], cy = T[o + 7], cz = T[o + 8];
    const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let qx, qy, qz;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; } else {
      const bpx = px - bx, bpy = py - by, bpz = pz - bz;
      const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
      if (d3 >= 0 && d4 <= d3) { qx = bx; qy = by; qz = bz; } else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + v * abx; qy = ay + v * aby; qz = az + v * abz; } else {
          const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
          const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
          if (d6 >= 0 && d5 <= d6) { qx = cx; qy = cy; qz = cz; } else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + w * acx; qy = ay + w * acy; qz = az + w * acz; } else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
                const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
                qx = bx + w * (cx - bx); qy = by + w * (cy - by); qz = bz + w * (cz - bz);
              } else {
                const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
                qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
              }
            }
          }
        }
      }
    }
    this._cx = qx; this._cy = qy; this._cz = qz;
    const dx = px - qx, dy = py - qy, dz = pz - qz;
    return dx * dx + dy * dy + dz * dz;
  }

  pushOut(p, r, y0, y1) {
    const n = this.n, cell = this.cell, half = this.half, T = this.tri, N = this.nrm, L = this.cellTris;
    let touched = false;
    // two balls: one at knee / hip height, one at the chest
    const ya = y0 + r, yb = Math.max(ya, y1 - r);
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      const i0 = Math.max(0, Math.floor((p.x - r + half) / cell)), i1 = Math.min(n - 1, Math.floor((p.x + r + half) / cell));
      const j0 = Math.max(0, Math.floor((p.z - r + half) / cell)), j1 = Math.min(n - 1, Math.floor((p.z + r + half) / cell));
      const stamp = ++this.stampNo;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = j * n + i;
        for (let k = this.cellStart[c], e = this.cellStart[c + 1]; k < e; k++) {
          const t = L[k];
          if (this.stamp[t] === stamp) continue;
          this.stamp[t] = stamp;
          const ny = N[t * 3 + 1];
          if (ny > WALK_NY || ny < -WALK_NY) continue;                  // floors and ceilings are not walls
          const o = t * 9;
          const lo = Math.min(T[o + 1], T[o + 4], T[o + 7]), hi = Math.max(T[o + 1], T[o + 4], T[o + 7]);
          if (hi < y0 || lo > y1) continue;
          for (let b = 0; b < 2; b++) {
            const py = b ? yb : ya;
            const d2 = this._closest(t, p.x, py, p.z);
            if (d2 >= r * r) continue;
            let dx = p.x - this._cx, dz = p.z - this._cz;
            let dl = Math.hypot(dx, dz);
            if (dl < 1e-5) { dx = N[t * 3]; dz = N[t * 3 + 2]; dl = Math.hypot(dx, dz) || 1; }
            // push sideways until the ball no longer overlaps (the ball may sit above / below the closest point)
            const dy = py - this._cy;
            const need = Math.sqrt(Math.max(0, r * r - dy * dy)) - dl;
            if (need <= 0) continue;
            p.x += (dx / dl) * need; p.z += (dz / dl) * need;
            this.pushNx = dx / dl; this.pushNz = dz / dl;
            moved = touched = true;
          }
        }
      }
      if (!moved) break;
    }
    return touched;
  }

  raycast(ox, oy, oz, dx, dy, dz, maxDist = 200) {
    const n = this.n, cell = this.cell, half = this.half, T = this.tri, L = this.cellTris;
    let best = maxDist, bestTri = -1;
    const stamp = ++this.stampNo;
    // walk the grid columns the ray passes over (2D DDA in x / z)
    let i = Math.floor((ox + half) / cell), j = Math.floor((oz + half) / cell);
    const si = dx > 0 ? 1 : -1, sj = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(cell / dx) : Infinity, tdz = dz !== 0 ? Math.abs(cell / dz) : Infinity;
    let tmx = dx !== 0 ? (((i + (dx > 0 ? 1 : 0)) * cell - half) - ox) / dx : Infinity;
    let tmz = dz !== 0 ? (((j + (dz > 0 ? 1 : 0)) * cell - half) - oz) / dz : Infinity;
    let tIn = 0;
    for (let guard = 0; guard < 2048; guard++) {
      if (i >= 0 && j >= 0 && i < n && j < n) {
        const c = j * n + i;
        for (let k = this.cellStart[c], e = this.cellStart[c + 1]; k < e; k++) {
          const t = L[k];
          if (this.stamp[t] === stamp) continue;
          this.stamp[t] = stamp;
          const o = t * 9;
          // Moeller-Trumbore, both sides
          const ax = T[o], ay = T[o + 1], az = T[o + 2];
          const e1x = T[o + 3] - ax, e1y = T[o + 4] - ay, e1z = T[o + 5] - az, e2x = T[o + 6] - ax, e2y = T[o + 7] - ay, e2z = T[o + 8] - az;
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
          const det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-9 && det < 1e-9) continue;
          const inv = 1 / det, sx = ox - ax, sy = oy - ay, sz = oz - az;
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const v = (dx * qx + dy * qy + dz * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (tt > 1e-4 && tt < best) { best = tt; bestTri = t; }
        }
      }
      const tOut = Math.min(tmx, tmz);
      if (tOut >= best || tOut >= maxDist) break;
      tIn = tOut;
      if (tmx < tmz) { i += si; tmx += tdx; } else { j += sj; tmz += tdz; }
      if ((i < 0 && si < 0) || (j < 0 && sj < 0) || (i >= n && si > 0) || (j >= n && sj > 0)) break;
    }
    // the terrain: march along the ray, then close in on the crossing
    let ground = false;
    const step = 1.0;
    let prev = 0;
    for (let t = step; ; t += step) {
      const tc = Math.min(t, best);
      if (oy + dy * tc < this.height(ox + dx * tc, oz + dz * tc)) {
        let a = prev, b = tc;
        for (let k = 0; k < 8; k++) { const m = (a + b) / 2; if (oy + dy * m < this.height(ox + dx * m, oz + dz * m)) b = m; else a = m; }
        best = b; bestTri = -1; ground = true;
        break;
      }
      if (tc >= best) break;
      prev = tc;
    }
    if (best >= maxDist) return Infinity;
    const h = this.hit;
    h.x = ox + dx * best; h.y = oy + dy * best; h.z = oz + dz * best; h.ground = ground;
    if (bestTri >= 0) {
      let nx = this.nrm[bestTri * 3], ny = this.nrm[bestTri * 3 + 1], nz = this.nrm[bestTri * 3 + 2];
      if (nx * dx + ny * dy + nz * dz > 0) { nx = -nx; ny = -ny; nz = -nz; }
      h.nx = nx; h.ny = ny; h.nz = nz;
    } else { h.nx = 0; h.ny = 1; h.nz = 0; }
    return best;
  }

  clear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    if (d < 1e-4) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d) === Infinity;
  }
}
