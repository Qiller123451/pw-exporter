// Walkability grid + A* with string pulling. Cells hold a block counter (trees, stones, buildings).
// A clearance field (distance to the nearest blocked cell, in cells) lets big units (dinosaurs, vehicles)
// path only through gaps they fit through; it is rebuilt lazily whenever the grid changed.
const COARSE = 4;              // fine cells per side of a coarse block (coarseRoute)
const COARSE_MIN = 60;         // goals at least this many cells away (120 m) take the coarse route
const LEG = 10;                // blocks per leg (about 80 m)
const LEG_ITER = 6000;         // the fine search's limit per leg

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
  // ---- far goals: a coarse route, then short fine searches along it
  // One plain A* over the whole grid of a campaign map (736 x 736 cells) to a goal several hundred metres away opens
  // up to its limit of 30,000 cells and often ends short of the goal: 10-40 ms per unit, a stall of a second when an
  // army or an attack wave set off - and the units walked to the end of a partial way and searched again. Instead the
  // grid is cut into blocks of COARSE x COARSE cells; the free cells of a block that hang together form a node, nodes
  // whose cells touch across a block border are linked (so the nodes connect exactly as the cells do: a thin cliff
  // or wall inside a block splits it). A route is found over the nodes and the way searched in legs of about 80 m
  // between cells of the route's nodes. A leg that does not get through (a closed gate) gives up the coarse way: the
  // plain search runs as before. The nodes are rebuilt when the grid changed (buildings), on the next far search.
  buildCoarse() {
    const F = COARSE, n = this.n, cn = Math.ceil(n / F), b = this.block, N = n * n;
    if (!this.comp || this.comp.length !== N) this.comp = new Int32Array(N);
    const comp = this.comp.fill(-1);
    const rep = [], stack = [];
    let id = 0;
    for (let cj = 0; cj < cn; cj++) for (let ci = 0; ci < cn; ci++) {
      const i0 = ci * F, j0 = cj * F, i1 = Math.min(n, i0 + F), j1 = Math.min(n, j0 + F);
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
        const k0 = j * n + i;
        if (b[k0] || comp[k0] >= 0) continue;
        // one node: the free cells of this block reachable from k0 inside the block (diagonals as in find)
        comp[k0] = id; stack.length = 0; stack.push(k0);
        let sx = 0, sz = 0, cnt = 0;
        while (stack.length) {
          const c = stack.pop(), x = c % n, z = (c - x) / n;
          sx += x; sz += z; cnt++;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const x2 = x + di, z2 = z + dj;
            if (x2 < i0 || x2 >= i1 || z2 < j0 || z2 >= j1) continue;
            const k = z2 * n + x2;
            if (b[k] || comp[k] >= 0 || (di && dj && (b[z * n + x2] || b[z2 * n + x]))) continue;
            comp[k] = id; stack.push(k);
          }
        }
        rep.push(k0, sx / cnt, sz / cnt);     // a cell of the node, and its centre (for distances)
        id++;
      }
    }
    // links between nodes whose cells touch (right, down, and both diagonals below)
    const adj = Array.from({ length: id }, () => []);
    const link = (a, c) => { if (a === c) return; const l = adj[a]; if (!l.includes(c)) { l.push(c); adj[c].push(a); } };
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const k = z * n + x, a = comp[k];
      if (a < 0) continue;
      if (x + 1 < n && comp[k + 1] >= 0 && comp[k + 1] !== a) link(a, comp[k + 1]);
      if (z + 1 < n) {
        if (comp[k + n] >= 0 && comp[k + n] !== a) link(a, comp[k + n]);
        if (x + 1 < n && comp[k + n + 1] >= 0 && !b[k + 1] && !b[k + n] && comp[k + n + 1] !== a) link(a, comp[k + n + 1]);
        if (x > 0 && comp[k + n - 1] >= 0 && !b[k - 1] && !b[k + n] && comp[k + n - 1] !== a) link(a, comp[k + n - 1]);
      }
    }
    // the gates' cells (free in `block`, shut or open by the moment and the player): their nodes are tested per search
    const gates = new Map();
    for (const k of this.gateAt.keys()) { const c = comp[k]; if (c >= 0) { if (!gates.has(c)) gates.set(c, []); gates.get(c).push(k); } }
    this.cRep = rep; this.cAdj = adj; this.cN = id; this.cGates = gates; this.cGateN = this.gateAt.size;
    if (!this.cg || this.cg.length < id) {
      const M = Math.max(id, 16);
      this.cg = new Float32Array(M); this.cf = new Float32Array(M); this.cfrom = new Int32Array(M);
      this.cstamp = new Uint32Array(M); this.cclosed = new Uint32Array(M); this.cheap = new Int32Array(M * 8); this.ccur = 1;
    }
    this.coarseVersion = this.version;
  }
  // { cells, found }: the fine cells from s towards t (both fine cell indices) along a coarse route - found false: t
  // is out of reach, the cells end at the nearest reachable point - or null (the plain search instead); astar(s, t,
  // maxIter) is find's search
  coarseRoute(s, t, astar) {
    const n = this.n;
    const si = s % n, sj = Math.floor(s / n), ti = t % n, tj = Math.floor(t / n);
    if (Math.max(Math.abs(ti - si), Math.abs(tj - sj)) < COARSE_MIN) return null;
    if (this.coarseVersion !== this.version || !this.comp || this.cGateN !== this.gateAt.size) this.buildCoarse();
    const comp = this.comp, cs = comp[s], ct = comp[t];
    if (cs < 0 || ct < 0) return null;
    const rep = this.cRep, adj = this.cAdj, g = this.cg, f = this.cf, from = this.cfrom, heap = this.cheap, closed = this.cclosed;
    const tx = rep[ct * 3 + 1], tz = rep[ct * 3 + 2];
    const h = (c) => { const ax = rep[c * 3 + 1] - tx, az = rep[c * 3 + 2] - tz; return Math.sqrt(ax * ax + az * az); };
    const stamp = ++this.ccur;
    let hn = 0;
    const push = (c) => { let i = hn++; heap[i] = c; while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[heap[i]]) break; const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p; } };
    const pop = () => { const top = heap[0]; heap[0] = heap[--hn]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hn && f[heap[l]] < f[heap[m]]) m = l; if (r < hn && f[heap[r]] < f[heap[m]]) m = r; if (m === i) break; const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m; } return top; };
    this.cstamp[cs] = stamp; g[cs] = 0; f[cs] = h(cs); from[cs] = -1; push(cs);
    let found = false, best = cs, bestH = 1e9, gated = false;
    const gates = this.cGates, who = this.who;
    while (hn > 0) {
      const c = pop();
      if (closed[c] === stamp) continue;
      closed[c] = stamp;
      if (c === ct) { found = true; break; }
      const hc = f[c] - g[c];
      if (hc < bestH) { bestH = hc; best = c; }
      const cx = rep[c * 3 + 1], cz = rep[c * 3 + 2];
      for (const k of adj[c]) {
        if (closed[k] === stamp) continue;
        // a node with a gate that is shut for this player (a node split by a gate is taken as shut as a whole)
        const gl = gates.size ? gates.get(k) : null;
        if (gl && k !== ct && gl.some((q) => this.gateBlocks(q, who))) { gated = true; continue; }
        const ax = rep[k * 3 + 1] - cx, az = rep[k * 3 + 2] - cz, ng = g[c] + Math.sqrt(ax * ax + az * az);
        if (this.cstamp[k] !== stamp || ng < g[k]) { this.cstamp[k] = stamp; g[k] = ng; f[k] = ng + h(k) * 1.02; from[k] = c; push(k); }
        if (hn >= heap.length - 8) break;
      }
    }
    // the goal cannot be reached (the nodes connect as the cells do): the way leads to the reachable node nearest to
    // it - what the plain search would end at after opening all its 30,000 cells, at a fraction of the cost
    // (not when a gate was in the way: a node only partly a gate may still let one pass beside it - the plain search
    // decides then)
    const end = found ? ct : best;
    if (!found && (end === cs || gated)) return null;
    const route = [];
    for (let c = end; c !== -1; c = from[c]) route.push(c);
    route.reverse();
    // the legs: to a cell of every LEG-th node of the route, then to t
    const out = [];
    let cur = s;
    for (let r = LEG; r < route.length - LEG / 2; r += LEG) {
      const w = rep[route[r] * 3];
      if (w === cur) continue;
      const leg = astar(cur, w, LEG_ITER);
      if (!leg.found) return null;
      for (const c of leg.cells) out.push(c);
      cur = w;
    }
    const goal = found ? t : rep[end * 3];
    if (goal !== cur) {
      const last = astar(cur, goal, LEG_ITER * 2);
      if (!last.found) return null;
      for (const c of last.cells) out.push(c);
    }
    return { cells: out, found };
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
    // the fine search (A*) from cell s0 to t0: the cells after s0 up to t0 - or, when maxIter runs out, up to the cell
    // nearest t0 that it reached (found false)
    const astar = (s, t, maxIter) => {
      const stamp = ++this.cur;
      const { g, f, from, heap, closed } = this;
      const tcx = t % n, tcz = Math.floor(t / n);
      const h = (c) => { const dx = Math.abs(c % n - tcx), dz = Math.abs(Math.floor(c / n) - tcz); return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz); };
      let hn = 0;
      const push = (c) => { let i = hn++; heap[i] = c; while (i > 0) { const p = (i - 1) >> 1; if (f[heap[p]] <= f[heap[i]]) break; const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p; } };
      const pop = () => { const top = heap[0]; heap[0] = heap[--hn]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hn && f[heap[l]] < f[heap[m]]) m = l; if (r < hn && f[heap[r]] < f[heap[m]]) m = r; if (m === i) break; const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m; } return top; };
      this.stamp[s] = stamp; g[s] = 0; f[s] = h(s); from[s] = -1; push(s);
      let found = false, it = 0, best = s, bestH = 1e9;
      const W_H = 1.02;                         // (a heuristic a touch above the distance: fewer cells opened)
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
          if (this.stamp[k] !== stamp || ng < g[k]) { this.stamp[k] = stamp; g[k] = ng; f[k] = ng + h(k) * W_H; from[k] = c; push(k); }
        }
      }
      const end = found ? t : best;
      const cells = [];
      for (let c = end; c !== -1 && c !== s; c = from[c]) cells.push(c);
      cells.reverse();
      return { found, cells };
    };
    // far goals: a coarse route first, then short fine searches along it (coarseRoute); null = search the plain way
    const far = need === 1 && !breach ? this.coarseRoute(s, t, astar) : null;
    let cells, found;
    if (far) { cells = far.cells; found = far.found; } else { const r = astar(s, t, maxIter); cells = r.cells; found = r.found; }
    this.found = found;
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
