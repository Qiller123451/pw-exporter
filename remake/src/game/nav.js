// Walkability grid + A* with string pulling. Cells hold a block counter (trees, stones, buildings).
// A clearance field (distance to the nearest blocked cell, in cells) lets big units (dinosaurs, vehicles)
// path only through gaps they fit through; it is rebuilt lazily whenever the grid changed.
export class NavGrid {
  constructor(size, cell = 2) {
    this.size = size; this.cell = cell; this.half = size / 2;
    this.n = Math.round(size / cell);
    const N = this.n * this.n;
    this.block = new Uint8Array(N);
    this.g = new Float32Array(N); this.f = new Float32Array(N);
    this.from = new Int32Array(N); this.stamp = new Uint32Array(N); this.closed = new Uint32Array(N);
    this.heap = new Int32Array(N * 4);
    this.cur = 1;
    const n = this.n;
    for (let i = 0; i < n; i++) { this.block[i]++; this.block[(n - 1) * n + i]++; this.block[i * n]++; this.block[i * n + n - 1]++; }
    this.version = 0;
    this.clear = new Uint8Array(N);     // clearance in cells (0 = blocked)
    this.clearVersion = -1;
    // gate cells (never in `block`): passable for everybody when open, for the owner's team in AUTO mode, never when closed
    this.gateAt = new Map();
    this.who = null;                     // the player a path is searched for (set by find)
  }
  gateBlocks(k, who) {
    const g = this.gateAt.get(k);
    if (!g || !g.alive || !g.built) return false;
    if (g.gateState === 0 || g.brokenT > 0) return false;          // open
    if (g.gateState === 2) return !(who && g.owner && g.owner.isFriend(who));   // auto
    return true;                                                    // closed
  }
  // two-pass chamfer distance transform (8-neighbourhood, capped at 255)
  updateClearance() {
    if (this.clearVersion === this.version) return;
    this.clearVersion = this.version;
    const n = this.n, c = this.clear, b = this.block;
    for (let k = 0; k < n * n; k++) c[k] = b[k] ? 0 : 255;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i; if (!c[k]) continue;
      let v = c[k];
      if (i > 0) v = Math.min(v, c[k - 1] + 1);
      if (j > 0) { v = Math.min(v, c[k - n] + 1); if (i > 0) v = Math.min(v, c[k - n - 1] + 1); if (i < n - 1) v = Math.min(v, c[k - n + 1] + 1); }
      c[k] = v;
    }
    for (let j = n - 1; j >= 0; j--) for (let i = n - 1; i >= 0; i--) {
      const k = j * n + i; if (!c[k]) continue;
      let v = c[k];
      if (i < n - 1) v = Math.min(v, c[k + 1] + 1);
      if (j < n - 1) { v = Math.min(v, c[k + n] + 1); if (i < n - 1) v = Math.min(v, c[k + n + 1] + 1); if (i > 0) v = Math.min(v, c[k + n - 1] + 1); }
      c[k] = v;
    }
  }
  // regions of the ground that are connected (8-neighbourhood, diagonals like find), labelled once the terrain is
  // marked (mountains, water, map border) and before anything is built: a goal in another region is unreachable
  // whatever stands there, so find() heads for the nearest cell of the start's region instead of searching in vain
  labelRegions() {
    const n = this.n, B = this.block, R = this.region = new Int32Array(n * n).fill(-1), st = new Int32Array(n * n);
    let label = 0;
    for (let k0 = 0; k0 < n * n; k0++) {
      if (B[k0] || R[k0] >= 0) continue;
      let top = 0; st[top++] = k0; R[k0] = label;
      while (top) {
        const c = st[--top], ci = c % n, cj = (c - ci) / n;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const k = j * n + i;
          if (B[k] || R[k] >= 0 || (di && dj && (B[cj * n + i] || B[j * n + ci]))) continue;
          R[k] = label; st[top++] = k;
        }
      }
      label++;
    }
    this.regions = label;
  }
  // nearest free cell of region reg around cell c (ring search), or -1
  nearestInRegion(c, reg, maxR = 80) {
    const n = this.n, ci = c % n, cj = Math.floor(c / n), R = this.region;
    for (let r = 0; r < maxR; r++) {
      let best = -1, bd = 1e9;
      for (let j = cj - r; j <= cj + r; j++) {
        if (j < 0 || j >= n) continue;
        const step = j === cj - r || j === cj + r ? 1 : 2 * r;
        for (let i = ci - r; i <= ci + r; i += step || 1) {
          if (i < 0 || i >= n) continue;
          const k = j * n + i;
          if (R[k] === reg && !this.block[k]) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = k; } }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  // cells a unit of radius r needs between its centre and the nearest obstacle
  need(r) { return Math.max(1, Math.ceil(r / this.cell - 0.25)); }
  fits(k, need) { return this.clear[k] >= need; }
  idx(x, z) {
    const i = Math.min(this.n - 1, Math.max(0, Math.floor((x + this.half) / this.cell)));
    const j = Math.min(this.n - 1, Math.max(0, Math.floor((z + this.half) / this.cell)));
    return j * this.n + i;
  }
  center(c) { return [((c % this.n) + 0.5) * this.cell - this.half, (Math.floor(c / this.n) + 0.5) * this.cell - this.half]; }
  // circle footprint
  markCircle(x, z, r, d = 1) {
    const cells = [];
    const i0 = Math.max(0, Math.floor((x - r + this.half) / this.cell)), i1 = Math.min(this.n - 1, Math.floor((x + r + this.half) / this.cell));
    const j0 = Math.max(0, Math.floor((z - r + this.half) / this.cell)), j1 = Math.min(this.n - 1, Math.floor((z + r + this.half) / this.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = (i + 0.5) * this.cell - this.half, cz = (j + 0.5) * this.cell - this.half;
      if ((cx - x) ** 2 + (cz - z) ** 2 < r * r) { const k = j * this.n + i; this.block[k] = Math.max(0, this.block[k] + d); cells.push(k); }
    }
    this.version++;
    return cells;
  }
  // oriented rectangle footprint (half extents hx, hz, rotation rot)
  rectCells(x, z, hx, hz, rot) {
    const cells = [];
    const c = Math.cos(rot), s = Math.sin(rot);
    const R = Math.hypot(hx, hz);
    const i0 = Math.max(0, Math.floor((x - R + this.half) / this.cell)), i1 = Math.min(this.n - 1, Math.floor((x + R + this.half) / this.cell));
    const j0 = Math.max(0, Math.floor((z - R + this.half) / this.cell)), j1 = Math.min(this.n - 1, Math.floor((z + R + this.half) / this.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = (i + 0.5) * this.cell - this.half - x, dz = (j + 0.5) * this.cell - this.half - z;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) <= hx && Math.abs(lz) <= hz) cells.push(j * this.n + i);
    }
    return cells;
  }
  mark(cells, d) { for (const k of cells) this.block[k] = Math.max(0, this.block[k] + d); this.version++; }
  free(cells) { for (const k of cells) if (this.block[k]) return false; return true; }
  isFree(x, z) {
    if (Math.abs(x) >= this.half - this.cell || Math.abs(z) >= this.half - this.cell) return false;
    return !this.block[this.idx(x, z)];
  }
  nearestFree(c, maxR = 40) {
    if (!this.block[c]) return c;
    const n = this.n, ci = c % n, cj = Math.floor(c / n);
    for (let r = 1; r < maxR; r++) {
      let best = -1, bd = 1e9;
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const k = j * n + i;
        if (!this.block[k]) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = k; } }
      }
      if (best >= 0) return best;
    }
    return c;
  }
  los(x0, z0, x1, z1, need = 1) {
    const d = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.ceil(d / (this.cell * 0.5));
    if (need > 1) this.updateClearance();
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const k = this.idx(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (need > 1 ? this.clear[k] < need : this.block[k]) return false;
      if (this.gateAt.size && this.gateBlocks(k, this.who)) return false;
    }
    return true;
  }
  // nearest cell with enough clearance
  nearestFit(c, need, maxR = 30) {
    if (need <= 1) return this.nearestFree(c, maxR);
    this.updateClearance();
    if (this.clear[c] >= need) return c;
    const n = this.n, ci = c % n, cj = Math.floor(c / n);
    for (let r = 1; r < maxR; r++) {
      let best = -1, bd = 1e9;
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        if (i < 0 || j < 0 || i >= n || j >= n || Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        const k = j * n + i;
        if (this.clear[k] >= need) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = k; } }
      }
      if (best >= 0) return best;
    }
    return this.nearestFree(c, maxR);
  }
  // path from (sx,sz) to (tx,tz) for a unit of the given radius; returns [[x,z],...] or null
  // breach: closed gates of the enemy count as passable at a high cost - an attacker whose way they block attacks
  // the first of them (World unitUpdate); the result then has .gate. this.found: the goal was reached.
  find(sx, sz, tx, tz, radius = 0.7, maxIter = 30000, who = null, breach = false) {
    const n = this.n;
    const need = this.need(radius);
    if (need > 1) this.updateClearance();
    this.who = who;
    this.found = false;
    const gates = this.gateAt.size > 0;
    const ok0 = need > 1 ? (k) => this.clear[k] >= need : (k) => !this.block[k];
    // only an enemy's gate is broken; a closed gate of one's own side or of a neutral stays shut
    const enemyGate = (k) => { const g = this.gateAt.get(k); return !!g && this.gateBlocks(k, who) && !!who && !!g.owner && who.isEnemy(g.owner); };
    const ok = gates ? (breach ? (k) => ok0(k) && (!this.gateBlocks(k, who) || enemyGate(k)) : (k) => ok0(k) && !this.gateBlocks(k, who)) : ok0;
    const toll = gates && breach ? (k) => (enemyGate(k) ? 25 : 0) : () => 0;
    const sIdx = this.idx(sx, sz);
    const s = ok(sIdx) ? sIdx : this.nearestFit(sIdx, need, 8);
    let tIdx = this.idx(tx, tz);
    // a goal the start's ground region does not reach (across mountains or water): the nearest point that it does
    const R = this.region;
    if (R && R[s] >= 0) {
      const tr = R[this.block[tIdx] ? this.nearestFree(tIdx, 6) : tIdx];
      if (tr !== R[s]) { const k = this.nearestInRegion(tIdx, R[s]); if (k >= 0) { tIdx = k; tx = this.center(k)[0]; tz = this.center(k)[1]; } }
    }
    const tb = !ok(tIdx);
    const t = tb ? this.nearestFit(tIdx, need) : tIdx;
    if (!tb && ok(sIdx) && this.los(sx, sz, tx, tz, need)) { this.found = true; return [[tx, tz]]; }
    if (s === t) { this.found = true; return [tb ? this.center(t) : [tx, tz]]; }
    const stamp = ++this.cur;
    const { g, f, from, heap, closed, block } = this;
    const tcx = t % n, tcz = Math.floor(t / n);
    const h = (c) => { const dx = Math.abs(c % n - tcx), dz = Math.abs(Math.floor(c / n) - tcz); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
    let hn = 0;
    const push = (c) => { let i = hn++; heap[i] = c; while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[heap[i]]) break; const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p; } };
    const pop = () => { const top = heap[0]; heap[0] = heap[--hn]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hn && f[heap[l]] < f[heap[m]]) m = l; if (r < hn && f[heap[r]] < f[heap[m]]) m = r; if (m === i) break; const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m; } return top; };
    this.stamp[s] = stamp; g[s] = 0; f[s] = h(s); from[s] = -1; push(s);
    let found = false, it = 0, best = s, bestH = 1e9;
    while (hn > 0 && it++ < maxIter) {
      const c = pop();
      if (closed[c] === stamp) continue;
      closed[c] = stamp;
      if (c === t) { found = true; break; }
      const hc = f[c] - g[c];
      if (hc < bestH) { bestH = hc; best = c; }
      const ci = c % n, cj = (c - ci) / n;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        if (!di && !dj) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const k = j * n + i;
        if (!ok(k) || closed[k] === stamp) continue;
        if (di && dj && (!ok(cj * n + i) || !ok(j * n + ci))) continue;
        const ng = g[c] + (di && dj ? 1.41421 : 1) + toll(k);
        if (this.stamp[k] !== stamp || ng < g[k]) { this.stamp[k] = stamp; g[k] = ng; f[k] = ng + h(k) * 1.02; from[k] = c; push(k); }
      }
    }
    const end = found ? t : best;
    this.found = found;
    const cells = [];
    for (let c = end; c !== -1 && c !== s; c = from[c]) cells.push(c);
    cells.reverse();
    const gk = breach ? cells.find((c) => enemyGate(c)) : undefined;
    const pts = cells.map((c) => this.center(c));
    if (found && !tb && pts.length) pts[pts.length - 1] = [tx, tz];
    const out = [];
    let ax = sx, az = sz, i = 0;
    while (i < pts.length) {
      let j = Math.min(pts.length - 1, i + 40);
      while (j > i && !this.los(ax, az, pts[j][0], pts[j][1], need)) j--;
      out.push(pts[j]);
      [ax, az] = pts[j];
      i = j + 1;
    }
    if (gk !== undefined && out.length) out.gate = this.gateAt.get(gk);
    return out.length ? out : null;
  }
}

// Spatial hash for entity queries
export class SpatialHash {
  constructor(cell = 12) { this.cell = cell; this.map = new Map(); }
  key(x, z) { return ((Math.floor(x / this.cell) + 4096) << 13) | (Math.floor(z / this.cell) + 4096); }
  insert(e) { const k = this.key(e.pos.x, e.pos.z); e._hk = k; let l = this.map.get(k); if (!l) { l = []; this.map.set(k, l); } l.push(e); }
  remove(e) { const l = this.map.get(e._hk); if (l) { const i = l.indexOf(e); if (i >= 0) { l[i] = l[l.length - 1]; l.pop(); } } e._hk = undefined; }
  move(e) { const k = this.key(e.pos.x, e.pos.z); if (k !== e._hk) { this.remove(e); this.insert(e); } }
  query(x, z, r, fn) {
    const c = this.cell;
    const i0 = Math.floor((x - r) / c), i1 = Math.floor((x + r) / c), j0 = Math.floor((z - r) / c), j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = this.map.get(((i + 4096) << 13) | (j + 4096));
      if (l) for (let q = 0; q < l.length; q++) fn(l[q]);
    }
  }
}
