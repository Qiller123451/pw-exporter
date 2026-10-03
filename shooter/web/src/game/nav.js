// Where can the swarm walk, and which way is the player?
//
// NavGrid: a grid of 2 m cells. build() floods outwards from seed points across everything a walker can reach:
// each cell stores the height of its floor (terrain, bridge deck, stair ...) and which of its four neighbours can be
// stepped to (no wall in between, no step higher than a walker can climb; dropping down a ledge works one way).
// "Can be stepped to" is tested for a body, not a point: a walker's body must fit at the cell's centre and rays at
// both shoulders must pass from cell to cell, so lantern posts, palm trunks, barricades and rubble are walked
// around instead of into.
// Because the flood carries the floor height along, bridges, stairs and arches come out right: a cell under an
// arch is the street, a cell on a bridge is the deck.
//
// flowTo(x, y, z): shortest-path distances from every cell near the target (Dijkstra, 8 directions).
// dir(x, z, out): the direction a walker at (x, z) should move to get closer - the whole swarm shares one field,
// which is what makes hundreds of enemies cheap.
const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];

export class NavGrid {
  constructor(col, size, o = {}) {
    this.col = col; this.size = size; this.half = size / 2;
    this.cell = o.cell || 2;
    this.n = Math.ceil(size / this.cell);
    this.step = o.step || 1.1;             // highest step a walker climbs
    this.drop = o.drop || 6;               // highest ledge a walker jumps down
    this.bodyH = o.height || 3.6;          // room a walker needs above the floor
    this.water = o.water ?? -Infinity;     // floors below this are under water
    this.minNy = o.minNy || 0.62;          // steepest terrain a walker climbs
    this.meshNy = o.meshNy ?? 0.62;        // steepest built surface (rubble, roofs) a walker climbs
    this.even = o.even ?? 0.6;             // how far from the middle the floor must be level (x radius); 0 = off
    this.radius = o.radius || 0.8;         // half the width of a walker
    this._p = { x: 0, y: 0, z: 0 };
    const N = this.n * this.n;
    this.y = new Float32Array(N).fill(NaN);
    this.links = new Uint8Array(N);        // bit d: can step to neighbour d (0 east, 1 south, 2 west, 3 north)
    this.dist = new Float32Array(N).fill(Infinity);
    this.stamp = new Uint32Array(N); this.stampNo = 0;
    this.cells = 0;
  }
  index(x, z) {
    const i = Math.floor((x + this.half) / this.cell), j = Math.floor((z + this.half) / this.cell);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }
  cx(c) { return (c % this.n + 0.5) * this.cell - this.half; }
  cz(c) { return (Math.floor(c / this.n) + 0.5) * this.cell - this.half; }
  walkable(c) { return c >= 0 && this.y[c] === this.y[c]; }

  // is there a floor to stand on at (x, z) for a walker coming from height y? returns its height or NaN
  _floor(x, z, y) {
    const col = this.col;
    const g = col.groundAt(x, z, y + this.step);
    if (g < this.water - 0.4) return NaN;
    if (g < y - this.drop) return NaN;
    if (col.groundKind === 'terrain') {
      // slope of the terrain here
      const e = 1, h = col.height;
      const sx = (h(x + e, z) - h(x - e, z)) / (2 * e), sz = (h(x, z + e) - h(x, z - e)) / (2 * e);
      if (1 / Math.sqrt(1 + sx * sx + sz * sz) < this.minNy) return NaN;
    } else if (col.groundNy < this.meshNy) return NaN;         // a steep face of rubble, a roof ...
    if (col.ceilingAt(x, z, g + 0.6, g + this.bodyH) !== Infinity) return NaN;
    // level enough for a body: nothing next to the middle sticks up higher than a step (rubble, barricades)
    const r = this.radius * this.even;
    if (r > 0) for (let k = 0; k < 4; k++) if (col.groundAt(x + DX[k] * r, z + DZ[k] * r, g + this.step + 1.5) > g + this.step) return NaN;
    // does a body fit here? (the same test the walkers are moved with: enemies.js pushOut)
    const p = this._p; p.x = x; p.z = z;
    if (col.pushOut(p, this.radius, g + 1.2, g + this.bodyH) && Math.hypot(p.x - x, p.z - z) > 0.45) return NaN;
    return g;
  }

  build(seeds, bounds) {
    const n = this.n, col = this.col, Y = this.y;
    const queue = new Int32Array(n * n);
    let qh = 0, qt = 0;
    for (const s of seeds) {
      const c = this.index(s.x, s.z);
      if (c < 0 || Y[c] === Y[c]) continue;
      const g = this._floor(this.cx(c), this.cz(c), s.y);
      if (g !== g) continue;
      Y[c] = g; queue[qt++] = c;
    }
    while (qh < qt) {
      const c = queue[qh++];
      const x = this.cx(c), z = this.cz(c), y = Y[c];
      const i = c % n, j = (c - i) / n;
      for (let d = 0; d < 4; d++) {
        const ni = i + DX[d], nj = j + DZ[d];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nx = x + DX[d] * this.cell, nz = z + DZ[d] * this.cell;
        if (bounds && (nx < bounds.x0 || nx > bounds.x1 || nz < bounds.z0 || nz > bounds.z1)) continue;
        const nc = nj * n + ni;
        let g = Y[nc];
        const known = g === g;
        if (!known) { g = this._floor(nx, nz, y); if (g !== g) continue; } else if (g > y + this.step || g < y - this.drop) continue;
        if (g > y + this.step) continue;
        // nothing solid between the two cells at knee and at chest height
        const hi = Math.max(y, g);
        if (!col.clear(x, hi + 1.3, z, nx, hi + 1.3, nz) || !col.clear(x, hi + 2.9, z, nx, hi + 2.9, nz)) continue;
        // ... and at both shoulders (sideways of the line of travel)
        const sx = -DZ[d] * this.radius * 0.8, sz = DX[d] * this.radius * 0.8;
        if (!col.clear(x + sx, hi + 2.0, z + sz, nx + sx, hi + 2.0, nz + sz) || !col.clear(x - sx, hi + 2.0, z - sz, nx - sx, hi + 2.0, nz - sz)) continue;
        this.links[c] |= 1 << d;
        if (!known) { Y[nc] = g; queue[qt++] = nc; }
      }
    }
    this.cells = qt;
    return qt;
  }

  // A second grid for wide bodies (the big dinosaurs): the same floors, but only cells that are at least `cells`
  // cells away from anything that is not walkable.
  wide(cells) {
    const n = this.n, N = n * n, g = new NavGrid(this.col, this.size, { cell: this.cell });
    const far = new Uint8Array(N);                 // distance to the nearest unwalkable cell (chamfer, capped)
    for (let c = 0; c < N; c++) far[c] = this.walkable(c) && (this.links[c] === 15) ? 255 : this.walkable(c) ? 1 : 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < N; k++) {
        const c = pass ? N - 1 - k : k, i = c % n, j = (c - i) / n;
        if (!far[c]) continue;
        let m = far[c];
        const a = pass ? (i + 1 < n ? far[c + 1] : 0) : (i > 0 ? far[c - 1] : 0), b = pass ? (j + 1 < n ? far[c + n] : 0) : (j > 0 ? far[c - n] : 0);
        if (a + 1 < m) m = a + 1;
        if (b + 1 < m) m = b + 1;
        far[c] = m;
      }
    }
    let count = 0;
    for (let c = 0; c < N; c++) if (far[c] > cells) { g.y[c] = this.y[c]; count++; }
    for (let c = 0; c < N; c++) {
      if (!(far[c] > cells)) continue;
      let l = this.links[c];
      for (let d = 0; d < 4; d++) if ((l & (1 << d)) && !(far[c + DX[d] + DZ[d] * n] > cells)) l &= ~(1 << d);
      g.links[c] = l;
    }
    g.cells = count;
    return g;
  }

  // can a walker go in a straight line from cell a to cell b (a few cells apart)? every cell crossed on the way
  // must be stepped to from the one before
  _lineOk(a, b) {
    const n = this.n, L = this.links;
    const ai = a % n, aj = (a - ai) / n, bi = b % n, bj = (b - bi) / n;
    const steps = Math.max(Math.abs(bi - ai), Math.abs(bj - aj)) * 2;
    let ci = ai, cj = aj;
    for (let k = 1; k <= steps; k++) {
      const i = Math.round(ai + (bi - ai) * k / steps), j = Math.round(aj + (bj - aj) * k / steps);
      if (i === ci && j === cj) continue;
      const c = cj * n + ci, di = i - ci, dj = j - cj;
      const dA = di > 0 ? 0 : di < 0 ? 2 : -1, dB = dj > 0 ? 1 : dj < 0 ? 3 : -1;
      if (dA >= 0 && dB >= 0) {
        // diagonal: both ways round the corner must be open
        const ca = c + DX[dA], cb = c + DZ[dB] * n;
        if (!(L[c] & (1 << dA)) || !(L[c] & (1 << dB)) || !(L[ca] & (1 << dB)) || !(L[cb] & (1 << dA))) return false;
      } else if (!(L[c] & (1 << (dA >= 0 ? dA : dB)))) return false;
      ci = i; cj = j;
    }
    return true;
  }

  // nearest walkable cell to a point (searching outwards up to `r` cells), or -1
  nearest(x, z, y = null, r = 6) {
    const c0 = this.index(x, z);
    if (c0 < 0) return -1;
    if (this.walkable(c0) && (y == null || Math.abs(this.y[c0] - y) < 4)) return c0;
    const n = this.n, i0 = c0 % n, j0 = (c0 - i0) / n;
    let best = -1, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const c = j * n + i;
      if (!this.walkable(c)) continue;
      const d = di * di + dj * dj + (y == null ? 0 : Math.abs(this.y[c] - y) * 0.5);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  // distances to the target for every cell within `range` metres of walking
  flowTo(x, y, z, range = 260) {
    const target = this.nearest(x, z, y, 8);
    if (target < 0) return false;
    this.target = target;
    const n = this.n, D = this.dist, S = this.stamp, L = this.links, no = ++this.stampNo;
    // binary heap of [dist, cell]
    const hd = this._hd || (this._hd = new Float32Array(1 << 17)), hc = this._hc || (this._hc = new Int32Array(1 << 17));
    let size = 0;
    const push = (d, c) => {
      if (size >= hd.length) return;
      let k = size++;
      while (k > 0) { const p = (k - 1) >> 1; if (hd[p] <= d) break; hd[k] = hd[p]; hc[k] = hc[p]; k = p; }
      hd[k] = d; hc[k] = c;
    };
    const pop = () => {
      const c = hc[0];
      const d = hd[--size], cc = hc[size];
      let k = 0;
      for (;;) {
        let ch = 2 * k + 1;
        if (ch >= size) break;
        if (ch + 1 < size && hd[ch + 1] < hd[ch]) ch++;
        if (hd[ch] >= d) break;
        hd[k] = hd[ch]; hc[k] = hc[ch]; k = ch;
      }
      hd[k] = d; hc[k] = cc;
      return c;
    };
    D[target] = 0; S[target] = no; push(0, target);
    const cell = this.cell, diag = cell * 1.4142;
    while (size) {
      const d0 = hd[0];
      const c = pop();
      if (d0 > D[c] + 1e-3) continue;
      if (d0 > range) break;
      // expand backwards from the target: which cells p can step to c? (links are one-way at ledges)
      const i = c % n, j = (c - i) / n;
      for (let d = 0; d < 4; d++) {
        const pi = i - DX[d], pj = j - DZ[d];
        if (pi < 0 || pj < 0 || pi >= n || pj >= n) continue;
        const p = pj * n + pi;
        if (L[p] & (1 << d)) {
          const nd = d0 + cell;
          if (S[p] !== no || nd < D[p]) { D[p] = nd; S[p] = no; push(nd, p); }
        }
        // diagonal move (d, then d2 = the next direction): both corners of the square must be passable too
        const d2 = (d + 1) & 3;
        const qi = pi - DX[d2], qj = pj - DZ[d2];
        if (qi < 0 || qj < 0 || qi >= n || qj >= n) continue;
        const q = qj * n + qi;                       // q -> c is the diagonal
        const qa = q + DX[d] + DZ[d] * n, qb = q + DX[d2] + DZ[d2] * n;
        if (!(L[q] & (1 << d)) || !(L[q] & (1 << d2)) || !(L[qa] & (1 << d2)) || !(L[qb] & (1 << d))) continue;
        const ndd = d0 + diag;
        if (S[q] !== no || ndd < D[q]) { D[q] = ndd; S[q] = no; push(ndd, q); }
      }
    }
    return true;
  }
  distAt(c) { return c >= 0 && this.stamp[c] === this.stampNo ? this.dist[c] : Infinity; }

  // direction of travel at (x, z): towards the best neighbour, looking two cells ahead for smoother paths.
  // returns the distance left (Infinity when the place is not connected to the target)
  dir(x, z, out, hops = 3) {
    let c = this.index(x, z);
    if (c < 0 || !this.walkable(c) || this.distAt(c) === Infinity) { c = this.nearest(x, z, null, 3); if (c < 0 || this.distAt(c) === Infinity) { out.x = out.z = 0; return Infinity; } }
    const d0 = this.distAt(c);
    // up to `hops` cells ahead along the path, as long as the straight line there is free (no cutting corners
    // through what the path walks around)
    let cur = c, at = c;
    for (let hop = 0; hop < hops; hop++) {
      const nx = this._next(at);
      if (nx < 0) break;
      at = nx;
      if (hop === 0 || this._lineOk(c, at)) cur = at;
    }
    let dx = this.cx(cur) - x, dz = this.cz(cur) - z;
    if (cur === c) { out.x = out.z = 0; return d0; }
    out.cell = cur;
    const l = Math.hypot(dx, dz) || 1;
    out.x = dx / l; out.z = dz / l;
    return d0;
  }
  _next(c) {
    const n = this.n, L = this.links;
    let best = -1, bd = this.distAt(c);
    for (let d = 0; d < 4; d++) {
      if (!(L[c] & (1 << d))) continue;
      const a = c + DX[d] + DZ[d] * n;
      const da = this.distAt(a);
      if (da < bd) { bd = da; best = a; }
      const d2 = (d + 1) & 3;
      if (!(L[c] & (1 << d2))) continue;
      const b2 = c + DX[d2] + DZ[d2] * n;
      if (!(L[a] & (1 << d2)) || !(L[b2] & (1 << d))) continue;
      const q = a + DX[d2] + DZ[d2] * n;
      const dq = this.distAt(q);
      if (dq < bd) { bd = dq; best = q; }
    }
    return best;
  }
  // a random walkable cell whose walking distance to the target lies in [d0, d1]; tries a few times
  pickAtDistance(d0, d1, tries = 60, test = null) {
    const n = this.n;
    const ti = this.target % n, tj = Math.floor(this.target / n);
    const r = Math.ceil(d1 / this.cell);
    for (let k = 0; k < tries; k++) {
      const i = ti + Math.round((Math.random() * 2 - 1) * r), j = tj + Math.round((Math.random() * 2 - 1) * r);
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const c = j * n + i;
      const d = this.distAt(c);
      if (d >= d0 && d <= d1 && this.walkable(c) && (!test || test(c))) return c;
    }
    return -1;
  }
}
