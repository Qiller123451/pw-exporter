// The computer player's village wall: a ring of wall segments around the village, a gate in every longer segment,
// a tower at the start of the long ones, archers on the wall near a gate (goals/AiGoalBuildVillageWalls.usl,
// tasks/AiTaskBuildWalls / BuildGate / BuildTowers.usl; docs/spec/ai_group6.md §1).
//
//   * Active from epoch 3 when the map allows walls (AIOptions "walls"), the behaviour closes its start location
//     (close_start_location 1: Giraffe, Schnecke, Turtle) and the level is not "Single 02" (DM:672-685, VW:733).
//   * The class: the best of the tribe's wall list the tech tree lets it build (VW:310-360; the mayor makes the Aje
//     and Ninigi build their walkable walls); none: their prerequisites are researched (UpgradeWalls); after the
//     first wall the next class is prepared (upgrade_walls 1). Standing walls are never replaced.
//   * The ring [?engine: the original's WallPlacer plans it]: the convex hull of the village's buildings (not walls,
//     towers, fields; within 100 m of the start location) 12 m out, on the wall grid; tiles the wall can't stand on
//     leave holes. Its runs are the segments (at most 12 tiles). A segment of 4+ tiles gets its gate in the middle
//     of a straight stretch (built as a wall piece first: the remake's gates replace one); a shorter one keeps a
//     hole of one tile (PutHoleInWall).
//   * One segment at a time, in batches of what the resources pay (< 1 -> 3, at most 10 tiles, TBW:264-294); an
//     enemy within 60 m of its start makes it ask for an attack there instead (UM:615-702). 1-2 workers build; the
//     others of the batch are chained (construction.js autoWork); 60 s without progress: other workers.
//   * Gates: at most 10, none within 24 m of another (TBG:136); 5 failures drop one. SEAS: the gate class
//     "seas_fence_gate" does not exist, so SEAS walls get no gates (VW:568-571, kept).
//   * A finished segment of 24 m or more without a hole: the tribe's small tower on its first tile (at most 2
//     building at a time; 10 failures: no tower there).
//   * Archers on the wall: when the first gate is started, Hu and Aje want 3 archers; once a gate stands they go up
//     the nearest walkable own wall piece within 36 m of it and hold (VW:796-866 - the original centres the search on
//     a position it never sets and never sends them: the intent is done here), at most 10 sendings.
const WALLS = { Hu: ['hu_palisade', 'hu_small_wall', 'hu_re_enforced_wall'], Aje: ['aje_bone_palisade', 'aje_clay_wall'], Ninigi: ['ninigi_defense_skewer', 'ninigi_palisade'], SEAS: ['seas_fence'] };
const TOWER = { Hu: 'hu_small_tower', Aje: 'aje_small_tower', Ninigi: 'ninigi_small_tower', SEAS: 'seas_turret_tower' };
const ARCHERS = { Hu: 'hu_archer', Aje: 'aje_archer' };
const MAX_GATES = 10, BATCH = 10, SEG_MAX = 12, MARGIN = 12;

export const WallsAI = {
  wallsActive(S) {
    return !!(this.mapOptions.walls && !this.economyOff && S.age >= 3 && this.levelName !== 'Single 02' && this.prm.close_start_location && !this.prm.noWalls && S.home &&
      this.gameType !== 'Defender');                                          // no walls in a Defender game (DM:675)
  },
  wallAct(cls) { const R = cls && this.resolve('BLDG/' + cls, ''); return R && R.kind === 'bldg' && R.cls === cls ? R.action : null; },
  // UpdateBestWallClass: the best class the tech tree lets it build -> class name | null
  bestWallClass(S) {
    const list = WALLS[this.p.tribe] || [];
    if (S.units.some((u) => u.name === 'mayor_s0' && u.level >= 3)) {         // (VW:320-326)
      const forced = { Aje: 'aje_clay_wall', Ninigi: 'ninigi_palisade' }[this.p.tribe];
      if (forced && this.wallAct(forced)) return forced;
    }
    for (let i = list.length - 1; i >= 0; i--) { const a = this.wallAct(list[i]); if (a && this.D.check(this.p, a) === null) return list[i]; }
    return null;
  },
  // the ring around the village -> [{tiles: [[i, j]], gate: [i, j] | null, hole: [i, j] | null}]
  planRing(S, cls) {
    const W = this.W, WM = W.wallMap, h = S.home, pts = [];
    for (const b of S.blds) {
      if (b.def.wallKind || W.isFarm(b) || Math.hypot(b.pos.x - h.x, b.pos.z - h.z) > 100) continue;
      const r = Math.max(b.radius || 4, 4) + MARGIN;
      for (let k = 0; k < 8; k++) pts.push([b.pos.x + Math.cos(k * Math.PI / 4) * r, b.pos.z + Math.sin(k * Math.PI / 4) * r]);
    }
    if (pts.length < 3) return [];
    // the convex hull (monotone chain)
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let k = pts.length - 1; k >= 0; k--) { const q = pts[k]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    const hull = lo.slice(0, -1).concat(hi.slice(0, -1));
    // the hull's edges on the wall grid
    const ring = [];
    for (let k = 0; k < hull.length; k++) {
      const a = WM.tileOf(...hull[k]), b = WM.tileOf(...hull[(k + 1) % hull.length]);
      for (const t of WM.line(a, b)) { const L = ring[ring.length - 1]; if (!L || L[0] !== t[0] || L[1] !== t[1]) ring.push(t); }
    }
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
    // the runs of tiles a wall can stand on (an own piece of the class counts), starting after a hole
    const ok = ring.map(([i, j]) => { const [x, z] = WM.centre(i, j), at = W.placement(cls, x, z, 0, this.p); return !!(at.ok || at.existing); });
    let s0 = ok.indexOf(false);
    const runs = [];
    let cur = [];
    const n = ring.length;
    for (let k = 0; k < n; k++) {
      const idx = s0 < 0 ? k : (s0 + 1 + k) % n;
      if (ok[idx]) { cur.push(ring[idx]); if (cur.length >= SEG_MAX) { runs.push(cur); cur = []; } } else if (cur.length) { runs.push(cur); cur = []; }
    }
    if (cur.length) runs.push(cur);
    const segs = runs.map((tiles) => {
      const seg = { tiles, gate: null, hole: null, pieces: [], done: false, tower: null, towerFails: 0, gateFails: 0 };
      if (tiles.length >= 4) {
        // the gate: the middle of a straight stretch (gateFit needs a piece on either side along one axis)
        const mid = Math.floor(tiles.length / 2);
        for (let d = 0; d < tiles.length - 2 && !seg.gate; d++) for (const m of [mid + d, mid - d]) {
          if (m < 1 || m >= tiles.length - 1 || seg.gate) continue;
          const a = tiles[m - 1], b = tiles[m], c = tiles[m + 1];
          if (b[0] - a[0] === c[0] - b[0] && b[1] - a[1] === c[1] - b[1]) seg.gate = b;
        }
      }
      return seg;
    });
    // gates at least 24 m apart (TBG); a segment without a gate keeps a hole: the walls close every corner, so the
    // ring must not shut the village in
    const kept = [];
    for (const seg of segs) {
      if (seg.gate) {
        const [x, z] = WM.centre(...seg.gate);
        if (kept.some(([a, b]) => Math.hypot(a - x, b - z) < 24)) { seg.hole = seg.gate; seg.gate = null; } else kept.push([x, z]);
      }
      if (!seg.gate && !seg.hole && seg.tiles.length > 1) seg.hole = seg.tiles[Math.floor(seg.tiles.length / 2)];
      if (seg.hole) seg.tiles = seg.tiles.filter((t) => t !== seg.hole);
    }
    return segs;
  },
  // a gate that cannot be built: its tile becomes a hole (the own piece there is pulled down)
  wallGateGiveUp(seg) {
    const WM = this.W.wallMap, t = WM.at(...seg.gate), b = t && t.wall;
    if (b && b.alive && b.owner === this.p) this.W.selfDestruct(b);
    seg.hole = seg.gate; seg.tiles = seg.tiles.filter((x) => x !== seg.gate); seg.gate = null;
  },
  wallsThink(S) {
    if (!this.wallsActive(S)) return;
    const W = this.W, p = this.p, WM = W.wallMap;
    const R = this.walls || (this.walls = { ring: null, cls: null, gates: 0, archers: [], sends: 0, wantArchers: false, upgraded: false });
    const cls = this.bestWallClass(S);
    if (!cls) { const a = this.wallAct((WALLS[p.tribe] || [])[0]); if (a) this.prerequisites(S, a, null); return; }
    if (!R.ring || (R.cls !== cls && R.ring.every((s) => s.done))) { R.ring = this.planRing(S, cls); R.cls = cls; }
    // the next class once a wall stands (upgrade_walls 1, VW:764)
    if (this.prm.upgrade_walls && !R.upgraded && R.ring.some((s) => s.pieces.some((b) => b.built))) {
      const list = WALLS[p.tribe] || [], next = list[list.indexOf(cls) + 1];
      const a = next && this.wallAct(next);
      if (a && this.D.check(p, a)) this.prerequisites(S, a, null);
      R.upgraded = true;
    }
    const act = this.wallAct(cls);
    const seg = R.ring.find((s) => !s.done);
    if (seg && act) this.wallSegmentThink(S, R, seg, act);
    for (const s of R.ring) if (s.done) { this.wallGateThink(S, R, s, cls); this.wallTowerThink(S, R, s); }
    this.wallArchersThink(S, R);
  },
  // TBW: build the segment in batches; done when every tile has a finished piece
  wallSegmentThink(S, R, seg, act) {
    const W = this.W, p = this.p, WM = W.wallMap;
    const pieceAt = ([i, j]) => { const t = WM.at(i, j); return t && (t.wall || t.gate || t.tower) && (t.wall || t.gate || t.tower).owner === p ? (t.wall || t.gate || t.tower) : null; };
    seg.pieces = seg.tiles.map(pieceAt).filter(Boolean);
    const open = seg.pieces.filter((b) => !b.built);
    if (seg.pieces.length === seg.tiles.length && !open.length) { seg.done = true; return; }
    if (open.length) {
      // builders: 1-2 workers on the nearest unfinished piece; 60 s without progress -> others
      const prog = open.reduce((s, b) => s + b.progress, 0) + seg.pieces.length;
      if (seg.prog === undefined || prog > seg.prog + 1e-3) { seg.prog = prog; seg.progT = W.time; }
      const busy = S.workers.filter((w) => w.task.type === 'build' && open.includes(w.task.building));
      if (busy.length < (S.workers.length >= 8 ? 2 : 1) || W.time - seg.progT > 60) {
        if (W.time - seg.progT > 60) seg.progT = W.time;
        const w = this.pickWorker(S, open[0].pos, busy);
        if (w) W.order([w], { type: 'build', target: open.reduce((a, b) => (Math.hypot(b.pos.x - w.pos.x, b.pos.z - w.pos.z) < Math.hypot(a.pos.x - w.pos.x, a.pos.z - w.pos.z) ? b : a)), auto: true });
      }
      return;
    }
    // a new batch: the tiles still without a piece
    const todo = seg.tiles.filter((t) => !pieceAt(t));
    const [sx, sz] = WM.centre(...todo[0]);
    const foes = this.wallFoes(sx, sz, 60);
    if (foes.length) {
      // CheckForEnemy: an attack on them instead (siege for mostly buildings, else suicide)
      const blds = foes.filter((e) => e.kind === 'building').length;
      this.requestAttack(S, blds * 2 > foes.length ? 'siege' : 'suicide', foes[0].owner || null, foes);
      return;
    }
    const cost = act.cost;
    let n = Math.min(...['food', 'wood', 'stone'].filter((r) => cost[r] > 0).map((r) => Math.floor((p.res[r] || 0) / cost[r])));
    if (!Number.isFinite(n)) n = BATCH;
    if (n < 1) n = 3;
    n = Math.min(BATCH, n);
    let placed = 0;
    for (const t of todo.slice(0, n)) {
      const [x, z] = WM.centre(...t);
      const b = W.startConstruction(p, act, x, z, 0, []);
      if (typeof b === 'string') { if (b === 'cost') break; continue; }
      placed++;
    }
    if (!placed && todo.length) { seg.fails = (seg.fails || 0) + 1; if (seg.fails > 5) { seg.tiles = seg.tiles.filter((t) => pieceAt(t)); seg.done = !seg.tiles.length || seg.tiles.every((t) => pieceAt(t) && pieceAt(t).built); } }
    seg.prog = undefined;
  },
  // enemy units (not workers), buildings, ships, hostile wild animals and nests within r (UM:615-702)
  wallFoes(x, z, r) {
    const W = this.W, out = [];
    for (const u of W.units) if (u.alive && !u.inside && Math.hypot(u.pos.x - x, u.pos.z - z) <= r && ((this.isEnemyEntity(u) && !u.isWorker) || (this.multimap && u.wild && u.def.aggressive === 1))) out.push(u);
    for (const b of W.buildings) if (this.isEnemyEntity(b) && Math.hypot(b.pos.x - x, b.pos.z - z) <= r) out.push(b);
    return out;
  },
  // TBG: the gate of a finished segment
  wallGateThink(S, R, seg, cls) {
    const W = this.W, p = this.p, WM = W.wallMap;
    if (!seg.gate || seg.gateObj || R.gates >= MAX_GATES) return;
    if (seg.gateFails >= 5) { this.wallGateGiveUp(seg); return; }
    const act = this.wallAct(cls + '_gate');
    if (!act || this.D.check(p, act)) { seg.gateFails = 5; return; }            // (SEAS: no such class)
    const [x, z] = WM.centre(...seg.gate);
    if (W.buildings.some((b) => b.alive && b.owner === p && b.def.wallKind === 'gate' && Math.hypot(b.pos.x - x, b.pos.z - z) < 24)) { seg.gateFails = 5; return; }
    if (!this.canPay(act.cost, p.res)) return;
    const w = this.pickWorker(S, { x, z }, []);
    const b = W.startConstruction(p, act, x, z, 0, w ? [w] : []);
    if (typeof b === 'string') { if (b !== 'cost') seg.gateFails++; return; }
    seg.gateObj = b;
    R.gates++;
    if (!R.wantArchers && ARCHERS[p.tribe]) { R.wantArchers = true; this.addOnTop(ARCHERS[p.tribe], '', { count: (S.count.get(ARCHERS[p.tribe]) || 0) + 3 }); }
  },
  // TBT: a tower on the first tile of a long finished segment without a hole
  wallTowerThink(S, R, seg) {
    const W = this.W, p = this.p, WM = W.wallMap;
    if (seg.tower || seg.hole || seg.tiles.length < 3 || seg.towerFails >= 10) return;
    if (R.ring.filter((s) => s.tower && s.tower.alive && !s.tower.built).length >= 2) return;
    const act = this.wallAct(TOWER[p.tribe]);
    if (!act || this.D.check(p, act) || !this.canPay(act.cost, p.res)) return;
    const [x, z] = WM.centre(...seg.tiles[0]);
    const w = this.pickWorker(S, { x, z }, []);
    const b = W.startConstruction(p, act, x, z, 0, w ? [w] : []);
    if (typeof b === 'string') { seg.towerFails++; return; }
    seg.tower = b;
  },
  // the archers on the wall near a gate
  wallArchersThink(S, R) {
    const W = this.W, p = this.p, cls = ARCHERS[p.tribe];
    if (!cls || !R.wantArchers) return;
    R.archers = R.archers.filter((u) => u.alive && u.owner === p);
    for (const u of S.pool) if (R.archers.length < 3 && u.name === cls && !this.claims.has(u)) { R.archers.push(u); this.claim([u], R); }
    const gates = R.ring.map((s) => s.gateObj).filter((g) => g && g.alive && g.built);
    if (!gates.length || S.age < 3 || R.sends >= 10) return;
    const off = R.archers.filter((u) => !u.onWall && u.task.type !== 'wall' && !u.inside);
    if (!off.length) return;
    let piece = null, bd = 36;
    for (const g of gates) for (const b of W.buildings) {
      if (b.owner !== p || !W.walkableWall(b)) continue;
      const d = Math.hypot(b.pos.x - g.pos.x, b.pos.z - g.pos.z);
      if (d <= bd) { bd = d; piece = b; }
    }
    if (!piece) return;
    W.order(off, { type: 'use', target: piece, auto: true });
    W.setAggro(off, 0);
    R.sends++;
  },
};
