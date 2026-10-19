// The Dragon Clan's mine belts (goals/AiGoalBuildMineBelts.usl; the positions: the server's CAiMineMgr and its shore
// map, PWServer.exe 0x458de0 / 0x4f0b20 / 0x4f0d50 / 0x4ecce0 - _notes/re_minemgr.md, docs/spec/ai.md §7.4).
//
//   * When: a Ninigi computer player on a multiplayer map with water (map option watermap), from epoch 2
//     (AiModuleDefenseDefault.usl:660-669). The goal thinks every 300 + difficulty ticks for Dodo, Giraffe and
//     Schnecke, else every 50 + difficulty ticks.
//   * A belt: one minelayer (an idle one, else trained at the harbour), 50 wood and 50 stone per mine; the five free
//     positions of the first shore that still has free ones are ordered at once (queued); when the layer is idle
//     again the next belt follows. A position is taken when any mine stands within 6 m of it.
//   * The positions are worked out once (the original: at level load, per start location): the largest body of
//     water (none if it covers less than 9.5 % of the map) eroded by 8 m gives a 20 m lattice; the home island's
//     coast is cut into clusters (joined within 120 m of a cluster's corner, at least 20 m long); a cluster whose
//     land path to the start location is at most 400 m is a shore; its mines are the lattice points nearest to the
//     ring 30-32 m out from it. Shores with the shortest path first.
//   The remake's land and ship grids do not overlap as the original's do (land units wade 0.4 m deep, ships need
//   1.5 m), so the island is the ground no ship can sail that holds the start location, the coast a strip two cells
//   wide of the water along it, and the path a distance over the island (its unwalkable parts count four times).
import { TICK } from './data.js';

const MINE = 'ninigi_mineship_mine', LAYER = 'ninigi_minelayer';
const IN_A_ROW = 5, MIN_WATER = 0.095, ERODE = 4, STEP = 10, MINBLOB = 10, SPAN = 60, MIN_EXTENT = 10, MAX_PATH = 400, RING = 15, TAKEN = 6;

// the shores and mine positions of a start location (cells of 2 m; i along x, j along z)
export function mineShores(W, sx, sz, dbg = null) {
  const L = W.nav, n = L.n, N = n * n, cs = L.cell, half = L.half;
  if (W.waterLevel == null || !W.waterNav) return [];
  const P = W.play;
  const water = new Uint8Array(N), inPlay = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const [x, z] = L.center(k);
    if (x < P.x0 + 2 || x > P.x1 - 2 || z < P.z0 + 2 || z > P.z1 - 2) continue;
    inPlay[k] = 1;
    if (W.waterLevel - W.height(x, z) >= 1.5) water[k] = 1;
  }
  const deepAny = water.slice();
  // the largest body of water (4-connected)
  const comp = new Int32Array(N).fill(-1), st = [];
  let best = -1, bestN = 0, id = 0;
  for (let k0 = 0; k0 < N; k0++) {
    if (!water[k0] || comp[k0] >= 0) continue;
    let cnt = 0; comp[k0] = id; st.push(k0);
    while (st.length) {
      const k = st.pop(), i = k % n; cnt++;
      for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) if (m >= 0 && m < N && water[m] && comp[m] < 0) { comp[m] = id; st.push(m); }
    }
    if (cnt > bestN) { bestN = cnt; best = id; }
    id++;
  }
  if (dbg) dbg.water = bestN / N;
  if (bestN / N < MIN_WATER) return [];
  for (let k = 0; k < N; k++) if (water[k] && comp[k] !== best) water[k] = 0;
  // the lattice: water at least 8 m from anything else, every 10th cell
  const lattice = [];
  for (let j = 0; j < n; j += STEP) for (let i = 0; i < n; i += STEP) {
    let ok = !!water[j * n + i];
    for (let dj = -ERODE; ok && dj <= ERODE; dj++) for (let di = -ERODE; di <= ERODE; di++) {
      if (di * di + dj * dj > ERODE * ERODE) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;            // (the map's edge does not erode)
      if (!water[b * n + a]) { ok = false; break; }
    }
    if (ok) lattice.push([i, j]);
  }
  if (dbg) dbg.lattice = lattice.length;
  // the home island: the ground (no water a ship could sail) connected to the start location; its distances from
  // the start (8-neighbour Dijkstra, metres; ground a land unit cannot walk - steep shore, shallows - counts four times)
  const s0 = L.idx(sx, sz);
  if (deepAny[s0]) return [];
  const ground = new Uint8Array(N);
  ground[s0] = 1; st.push(s0);
  while (st.length) {
    const k = st.pop(), i = k % n;
    for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) if (m >= 0 && m < N && !ground[m] && !deepAny[m] && inPlay[m]) { ground[m] = 1; st.push(m); }
  }
  const isl = W.landIsland(sx, sz), walk = (k) => isl >= 0 && W._island && W._island[k] === isl;
  const dist = new Float64Array(N).fill(Infinity);
  dist[s0] = 0;
  const heap = [[0, s0]];
  const push = (d, k) => { heap.push([d, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
  while (heap.length) {
    const [d, k] = pop();
    if (d > dist[k] || d > MAX_PATH) continue;
    const i = k % n, j = (k - i) / n;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const m = b * n + a;
      if (!ground[m]) continue;
      const nd = d + (di && dj ? cs * Math.SQRT2 : cs) * (walk(m) ? 1 : 4);
      if (nd < dist[m]) { dist[m] = nd; push(nd, m); }
    }
  }
  // the coast: a strip two cells wide of the main water along the island; specks under 10 cells dropped
  const coast = new Uint8Array(N);
  const nb4 = (k) => { const i = k % n; return [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n].filter((m) => m >= 0 && m < N); };
  for (let k = 0; k < N; k++) if (water[k] && nb4(k).some((m) => ground[m])) coast[k] = 1;
  for (let k = 0; k < N; k++) if (coast[k] === 1) for (const m of nb4(k)) if (water[m] && !coast[m]) coast[m] = 2;
  const seen = new Uint8Array(N);
  for (let k0 = 0; k0 < N; k0++) {
    if (!coast[k0] || seen[k0]) continue;
    const part = [k0]; seen[k0] = 1;
    for (let q = 0; q < part.length; q++) { const k = part[q], i = k % n; for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) if (m >= 0 && m < N && coast[m] && !seen[m]) { seen[m] = 1; part.push(m); } }
    if (part.length < MINBLOB) for (const k of part) coast[k] = 0;
  }
  // clusters: row by row, a cell joins the first cluster whose box corner is within 60 cells
  const clusters = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (!coast[j * n + i]) continue;
    let c = clusters.find((c) => Math.abs(i - c.minx) <= SPAN && Math.abs(j - c.miny) <= SPAN);
    if (!c) clusters.push(c = { minx: i, miny: j, maxx: i, maxy: j, pts: [] });
    c.pts.push([i, j]);
    c.minx = Math.min(c.minx, i); c.miny = Math.min(c.miny, j); c.maxx = Math.max(c.maxx, i); c.maxy = Math.max(c.maxy, j);
  }
  if (dbg) { dbg.island = isl; dbg.coast = coast.reduce((a, v) => a + (v > 0), 0); dbg.clusters = clusters.map((c) => [c.minx, c.miny, c.maxx, c.maxy, c.pts.length]); dbg.reach = dist.reduce((a, v) => a + (v < Infinity), 0); }
  const shores = [];
  for (const c of clusters) {
    if (c.maxx - c.minx < MIN_EXTENT && c.maxy - c.miny < MIN_EXTENT) continue;
    const mx = (c.minx + c.maxx) >> 1, my = (c.miny + c.maxy) >> 1;
    let rep = c.pts[0], bd = Infinity;
    for (const p of c.pts) { const d = Math.abs(p[0] - mx) + Math.abs(p[1] - my); if (d < bd) { bd = d; rep = p; } }
    // the land path from the shore to the start location
    let len = Infinity;
    for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
      const a = rep[0] + di, b = rep[1] + dj;
      if (a < 0 || b < 0 || a >= n || b >= n) continue;
      const d = dist[b * n + a] + Math.hypot(di, dj) * cs;
      if (d < len) len = d;
    }
    if (dbg) (dbg.len || (dbg.len = [])).push(Math.round(len));
    if (!(len <= MAX_PATH)) continue;
    // the ring 15-16 cells out from the cluster (chamfer distance in a window around it)
    const x0 = Math.max(0, c.minx - RING - 3), x1 = Math.min(n - 1, c.maxx + RING + 3), y0 = Math.max(0, c.miny - RING - 3), y1 = Math.min(n - 1, c.maxy + RING + 3);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, D = new Float32Array(w * h).fill(1e9);
    for (const [i, j] of c.pts) D[(j - y0) * w + (i - x0)] = 0;
    const R2 = Math.SQRT2;
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) {
      const k = b * w + a; let v = D[k];
      if (a > 0) v = Math.min(v, D[k - 1] + 1);
      if (b > 0) { v = Math.min(v, D[k - w] + 1); if (a > 0) v = Math.min(v, D[k - w - 1] + R2); if (a < w - 1) v = Math.min(v, D[k - w + 1] + R2); }
      D[k] = v;
    }
    for (let b = h - 1; b >= 0; b--) for (let a = w - 1; a >= 0; a--) {
      const k = b * w + a; let v = D[k];
      if (a < w - 1) v = Math.min(v, D[k + 1] + 1);
      if (b < h - 1) { v = Math.min(v, D[k + w] + 1); if (a < w - 1) v = Math.min(v, D[k + w + 1] + R2); if (a > 0) v = Math.min(v, D[k + w - 1] + R2); }
      D[k] = v;
    }
    const mines = [], key = new Set();
    for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) {
      const d = D[b * w + a], i = a + x0, j = b + y0;
      if (!(d > RING && d <= RING + 1.2) || !water[j * n + i]) continue;
      let lp = null, ld = 1e6;
      for (const q of lattice) { const e = (q[0] - i) * (q[0] - i) + (q[1] - j) * (q[1] - j); if (e < ld) { ld = e; lp = q; } }
      if (!lp || key.has(lp[0] * 100003 + lp[1])) continue;
      key.add(lp[0] * 100003 + lp[1]);
      mines.push({ x: lp[0] * cs - half, z: lp[1] * cs - half });
    }
    const [rx, rz] = [rep[0] * cs - half, rep[1] * cs - half];
    shores.push({ x: rx, z: rz, distance: len, mines });
  }
  return shores;
}

export const MinesAI = {
  // AiModuleDefenseDefault.Think: Ninigi on a multiplayer water map from epoch 2
  mineBeltsOn(S) {
    return this.multimap && this.mapOptions.watermap && !!this.W.waterNav && this.p.tribe === 'Ninigi' && S.age >= 2 && this.D.exists(LAYER);
  },
  mineWait() { return ((/^(Dodo|Giraffe|Schnecke)$/.test(this.personality) ? 300 : 50) + this.d) * TICK; },
  // CAiMineMgr.Init: every position of every shore, the shortest land path first
  minePositions() {
    if (this.minePos) return this.minePos;
    const st = this.start || (this.S && this.S.home);
    if (!st) return null;
    const shores = mineShores(this.W, st.x, st.z, this.mineDbg = {});
    const out = [];
    shores.forEach((s, si) => s.mines.forEach((m, j) => out.push({ x: m.x, z: m.z, shore: si, j, dist: s.distance, taken: false })));
    out.sort((a, b) => a.dist - b.dist || a.j - b.j);
    this.mineShoreList = shores;
    return (this.minePos = out);
  },
  // UpdateMinePositions + GetNextMineGroup: up to n free positions of the first shore with free ones
  nextMineGroup(n) {
    const W = this.W, list = this.minePositions() || [];
    const mines = W.units.filter((u) => u.alive && u.name === MINE);
    for (const m of list) m.taken = mines.some((u) => Math.hypot(u.pos.x - m.x, u.pos.z - m.z) <= TAKEN);
    let shore = -1;
    const out = [];
    for (const m of list) {
      if (out.length >= n) break;
      if (m.taken) continue;
      if (shore < 0) shore = m.shore;
      if (m.shore === shore) out.push(m);
    }
    return out;
  },
  mineAction(u) { return this.D.actionsOf(u.rulesOwner(), u).find((a) => a.results && a.results[0] && a.results[0].obj === MINE) || null; },
  // the goal's state machine (start -> ship -> resources -> placing -> next belt)
  mineBeltThink(S) {
    const W = this.W;
    const M = this.mineGoal || (this.mineGoal = { state: 'ship', layer: null, belts: 0 });
    if (M.layer && (!M.layer.alive || M.layer.owner !== this.p)) { this.claims.delete(M.layer); M.layer = null; M.state = 'ship'; }
    if (M.state === 'ship') {
      const u = S.fleet.find((x) => x.alive && x.name === LAYER && !this.claims.has(x) && !this.locked.has(x));
      if (u) { M.layer = u; this.claims.set(u, M); M.state = 'belt'; }
      else {
        const T = this.trainable(S, LAYER);
        if (T && T.producer && !T.producer.queue.some((q) => q.action === T.action) && this.armyCanPay(S, T.action.cost)) W.queueAction(T.producer, T.action);
        return;
      }
    }
    const u = M.layer;
    if (M.state === 'placing') {
      if (u.task.type === 'lay') return;
      M.state = 'belt'; M.belts++;
    }
    if (M.state === 'belt') {
      const a = this.mineAction(u);
      if (!a) return;
      const group = this.nextMineGroup(IN_A_ROW);
      if (!group.length) return;
      const cost = {};
      for (const [k, v] of Object.entries(a.cost || {})) cost[k] = v * group.length;
      if (!this.p.canAfford(cost)) return;            // (the original's resource allocator waits for it)
      let n = 0;
      for (const m of group) if (!W.layWaterThing(u, a, m.x, m.z, n > 0)) n++;
      if (n) M.state = 'placing';
    }
  },
};
