# CAiMineMgr: where the computer player lays sea mines

The Dragon Clan computer player lays belts of sea mines off its coast (`Scripts/Ai/goals/AiGoalBuildMineBelts.usl`:
five mines per row, 50 wood and 50 stone each, a minelayer from the `SeaMineLayer` set; [ai.md](../../remake/docs/spec/ai.md)).
The script only asks the native class `CAiMineMgr` for the next positions. This file describes that class as read in
`bin/PWServer.exe` (image base 0x400000, disassembled with capstone). Confidence is high for everything unless it is
marked *(unsure)*.

## 1. Binding

The AI script classes are registered by 0x52b360 with their own name table at 0xae8ea0 (see
[EXECUTABLES.md](EXECUTABLES.md)).

| class | descriptor | glue vtable |
|---|---|---|
| CAiMineMgr | 0x9f2f2c | 0x9f97fc |
| CAiManagedMine | 0x9f2ef8 | 0x9f97ac (USL members `m_vPos`, `ToString`) |
| CAiManagedMineArray | 0x9f2f10 | 0x9f97d4 |
| CAiMinePos | 0x9f255c | |
| CAiShoreInfo | 0x9f2570 | |
| CAiPlayerShoreInfo | 0x9f2594 | |

Glue slot 3 (0x51ae20) creates the script object: a 0x1c-byte wrapper (vtable 0x9f8a50) plus a 0x20-byte native
CAiMineMgr. The method dispatcher is slot 12 of the wrapper vtable, 0x527dd0, a `switch(method)` from 0:

| case | method | native |
|---|---|---|
| 0 | constructor (zeroes the native object) | |
| 1 | destructor | 0x530c20 |
| 3 | `GetNextMineGroup(array, maxMines)` | 0x4ecce0 |
| 4 | `Init(brain)` | 0x4f0b20 |
| 5 | `UpdateMinePositions()` | 0x4f0d50 |

Arguments are read from `[vm+0x3c]` / `[vm+0x40]`; the last argument is on top.

### Native layouts

**CAiMineMgr (0x20 bytes)**

| offset | content |
|---|---|
| +0x00 | vec3 copied from brain +0x1240 = the player's start location (set at 0x4d6949). Not used by the three methods |
| +0x0c | int player id (brain +0x12ac) |
| +0x10 | float sea level (`[G+0x15c]->vfunc[1]()`; the value terrain heights are clamped to at 0x49cf71) |
| +0x14 | brain* |
| +0x18 / +0x1c | array of CAiManagedMine (pointer, count) |

**CAiManagedMine (0x28 bytes)**; the field order matches `ToString` 0x5300a0, format
`"CAiManagedMine([%f,%f,%f] %d %d %d %d %d %d %f %f %f)"`.

| offset | content |
|---|---|
| +0x00 | vec3 `m_vPos` |
| +0x0c..+0x0e | 3 bytes, always 0 (never written by this class) |
| +0x10 | int occupant: id of a mine object found there, or **−2 = free** |
| +0x14 | shore index (into the player's shore list) |
| +0x18 | index of this position in that shore's mine list |
| +0x1c | float: the shore's `m_fDistance` |
| +0x20 | float: 2D distance from the shore's `m_vShorePos` to `m_vPos` |
| +0x24 | float: +0x1c + +0x20 |

**CAiShoreInfo (0x24 bytes)**; USL member offsets verified from glue 0x516500.

| offset | content |
|---|---|
| +0x00 | vec3 `m_vShorePos` |
| +0x0c | vec3 `m_vLandingPos` |
| +0x18 | float `m_fDistance` |
| +0x1c / +0x20 | array of int pairs (x, y) = the mine positions (`CAiMinePos` GetX / GetY; `NumMinePos` / `GetMinePos`) |

## 2. Where the positions come from (computed once when the level loads)

The positions are **not** computed by `UpdateMinePositions`. They are computed per player when the AI maps are set up
and stored with the shore infos.

* The map init function is 0x45b890 (`this` = CAiMaps = G+0xc668). For every object of class `"StartLocation"` (owner
  = obj+0x10, which must be 0..7; position at obj+0x18 / +0x1c) it calls **ComputeShore(owner, int(x) >> 1,
  int(y) >> 1)** = 0x458de0, a method of the shore sub-object S = maps+0x2844.
* The results per player are stored at maps+0x286d + p × 8 (pointer, count).
* The singleton at 0xb39a90 (size 0x6b0c, getter 0x4dcb40) copies them the first time they are asked for (0x4dc3a0,
  flag +0x1074); its getter 0x4dc5b0(player) returns `&this[0x1034 + player * 8]`.

### Grid and data

* **Cells** are 2 m (world = 2 × cell); width and height = map size >> 1 (path finder +0x1538 / +0x153c).
* **S8 = land map**: path finder layer +0x228, `pfmap` = where land units can go, sampled per cell (0x907300). Cells
  inside the layer's border (layer +0x28) are 0.
* **S18 = water map**: layer +0x318, `pfWaterMap` = where ships can go. Set up in S.Init 0x4561f0:
  1. find the largest 4-connected area of S18;
  2. if its area / (w × h) is **below 0.095** (float at 0x9e162c), the shore system is switched off (`S+0x28 = false`)
     and no player gets shores or mines;
  3. otherwise S18 is replaced by that largest water body alone.
* **Not used:** island ids, harbours, enemy positions, a depth limit, real coast lines. The height is used only to pick
  the landing point. Land and water come entirely from the two path finder maps.

### Cell map routines (1 bit per cell, `{bits, words, w, h}`)

| address | routine |
|---|---|
| 0x8d4090 | create(w, h, fill) |
| 0x8d2f90 | set(x, y, v) |
| 0x8d43e0 | copy |
| 0x8d36f0 | invert |
| 0x8d45f0 | dst = (invA ? ~A : A) (or ? \| : &) (invB ? ~B : B) |
| 0x8d4160 | `grow(dst, r, v)`: dst starts as !v; every v cell is copied; every v cell with a 4-neighbour ≠ v paints a disc dx² + dy² ≤ r² with v. So v = 1 dilates and v = 0 erodes the 1-region. Neighbours outside the map are ignored, so nothing is eroded at the map edge |
| 0x8d4850 | `flood(dst, src, x, y, v)`: 4-connected fill over cells where src ≠ v and dst ≠ v; sets dst = v; returns the cell count (0 if the seed fails) |

### ComputeShore(player, cx, cy), 0x458de0

Constants are cells unless stated.

```js
const STEP = 10, ERODE = 4, MINBLOB = 10, CLUSTER_SPAN = 60, MIN_EXTENT = 10,
      MAX_PATH_M = 400.0, RING_R = 15, LAND_PROBE = 10;
shores[player] = [];
if (!waterEnabled) return;
// candidate lattice (0x4565a0): water eroded by 4 cells, every 10th cell
const deep = erode(S18, ERODE);              // grow(S18 -> deep, 4, 0)
const lattice = [];
for (let y = 0; y < H; y += STEP)
  for (let x = (y & 1 ? STEP >> 1 : 0); x < W; x += STEP)   // y is always even, so the stagger never happens
    if (deep[x, y]) lattice.push([x, y]);
// home island = the 4-connected S8 area that contains the start cell
const island = floodComponent(S8, cx, cy);   // empty if S8[cx, cy] == 0
let coast = and(island, S18);                // cells both land units and ships can use (the shallow shore strip)
removeComponentsSmallerThan(coast, MINBLOB); // 4-connected areas of 1..9 cells removed
// greedy clustering, row by row (y outer, x inner)
const clusters = [];                         // {minx, miny, maxx, maxy, pts[]}
for (y) for (x) if (coast[x, y]) {
  let c = clusters.find(c => Math.abs(x - c.minx) <= CLUSTER_SPAN && Math.abs(y - c.miny) <= CLUSTER_SPAN);
                                             // compares with the bounding box's MIN corner only
  if (!c) clusters.push(c = {pts: []});
  c.pts.push([x, y]); recomputeBBox(c);
}
for (const c of clusters) {
  if (c.maxx - c.minx < MIN_EXTENT && c.maxy - c.miny < MIN_EXTENT) continue;
  // representative = the cluster point with the smallest |dx| + |dy| to the integer box centre, first one wins (0x4537f0)
  const mx = (c.minx + c.maxx) / 2 | 0, my = (c.miny + c.maxy) / 2 | 0;
  const [px, py] = argmin(c.pts, p => Math.abs(p[0] - mx) + Math.abs(p[1] - my));
  // LAND path (layer 0x228, player -1 = no player walls) from (2px, 2py, 32) to the start location (2cx, 2cy, 32)
  const path = pathfinder.findPath([2*px, 2*py, 32], [2*cx, 2*cy, 32]);   // 0x9029b0, points in metres
  if (!path || path.length < 2) continue;
  const len = sum of the segment lengths (metres);
  if (len > MAX_PATH_M) continue;            // must be <= 400 m
  const si = { shorePos: [2*px, 2*py, terrainH(2*px, 2*py)], distance: len, mines: [] };
  si.landingPos = si.shorePos.slice();
  for (let k = 0; k < 8; k++) {              // angle = k * 0.7853982 (float)
    const dx = Math.trunc(Math.cos(k*Math.PI/4) * LAND_PROBE), dy = Math.trunc(Math.sin(k*Math.PI/4) * LAND_PROBE);
                                             // (10,0), (7,7), (0,10), (-7,7) ...
    const wx = 2*(px + dx), wy = 2*(py + dy), h = terrainH(wx, wy);   // terrainH = 0x9031c0, the raw terrain height
    if (h < si.landingPos[2]) si.landingPos = [wx, wy, h];           // strict <: the lowest point within 20 m
  }
  // mine ring: water cells about 15-16 cells (30-32 m) outside this cluster
  const blob = bitmapOf(c.pts);
  const g15 = dilate(blob, RING_R);          // disc r^2 <= 225
  const g16 = dilate(g15, 1);
  const ring = and(and(not(g15), g16), S18);
  for (y) for (x) if (ring[x, y]) {          // row by row
    const [lx, ly] = nearest(lattice, x, y); // Euclidean, strict <, start 1e6 (0x453a60); [0,0] if the lattice is empty
    const p = [2*lx, 2*ly];
    if (!si.mines.some(q => q[0] == p[0] && q[1] == p[1])) si.mines.push(p);
  }
  shores[player].push(si);                   // the shore is kept even if it has no mine position
}
```

What this gives:

* Mine positions lie on a square **20 m lattice** (x and y are multiples of 20).
* Every position is at least 8 m (4 cells, Euclidean ≤ 4 cells) from cells ships cannot use.
* Every position is in the main water body.
* Each position is the lattice point nearest to the **~30 m ring** around a landing beach of the player's home island,
  and that beach must have a land path of at most 400 m to the start location.
* z is set later by `Init`: z = sea level.
* There is no limit on the number of shores or positions.
* *(unsure)* If the start location's cell is not land-passable in `pfmap` when this runs, the island flood fails and the
  player gets no shores.

## 3. Init(brain), 0x4f0b20

```js
mgr.basePos = brain[0x1240]; mgr.player = brain.playerId; mgr.seaLevel = world.seaLevel(); mgr.brain = brain;
mgr.mines = [];
shores = shoreMgr.get(player);             // copy of the per-player list above
shores.forEach((s, i) => s.mines.forEach(([x, y], j) => mgr.mines.push({
  pos: [x, y, mgr.seaLevel], occupant: -2, shoreIdx: i, idxInShore: j,
  shoreDist: s.distance,
  distToShore: Math.hypot(s.shorePos[0] - x, s.shorePos[1] - y),
  total: s.distance + Math.hypot(...) })));
quicksort(mgr.mines, by (shoreDist asc, then idxInShore asc));   // 0x4f6880; shoreIdx is NOT a key
```

The shore with the shortest land path to the headquarters comes first. Inside one shore the positions keep the order in
which they were found. Two shores with exactly the same distance would interleave by j.

## 4. UpdateMinePositions(), 0x4f0d50

```js
for (const m of mgr.mines) {
  const q = new CObjQuery();               // 0x4bc740
  q.class("ninigi_mineship_mine");          // 0x4bb370
  q.region(m.pos, 6.0);                     // 0x4bbba0 -> 0x4bb680(pos, 6.0, 6.0), region type 2: circle / sphere of 6 m
  const res = q.execute();                  // 0x4ecdd0
  if (res.ok) m.occupant = res.length > 0 ? res[0].id : -2;   // a failed query keeps the old value
}
```

* No owner filter is set, so *(fairly sure)* a mine of any player within 6 m marks the position as taken.
* Positions are never removed; one becomes free again when its mine is gone.

## 5. GetNextMineGroup(array, maxMines), 0x4ecce0

```js
let shore = -2, n = 0;
for (const m of mgr.mines) {          // sorted order
  if (n >= maxMines) break;
  if (m.occupant > -2) continue;      // taken
  if (shore <= -2) shore = m.shoreIdx;
  if (m.shoreIdx === shore) { array.push(copy(m)); n++; }   // 0x4f7160
}
return true;
```

* It takes the **first shore (nearest to the headquarters) that still has a free position**, and from it up to
  `maxMines` (5 from the script) free positions in list order.
* There is no "in a row" logic: the five are the first lattice points of the row-by-row ring scan, mostly on the low-y
  (northern) side of the ring, alternating left and right.
* Nothing is marked as used. Occupancy changes only on the next `UpdateMinePositions`, when mine objects exist;
  positions whose mines were never laid are offered again.
* The array is not cleared here; the script clears it.

## 6. Constants

| value | where | meaning |
|---|---|---|
| 2 m | `sar 1` everywhere | cell size |
| 0.095 | 0x9e162c | minimum share of map cells in the largest water body |
| 4 | push 4 | erosion radius of the water map, cells |
| 10 | push 0xa | lattice step in cells (= 20 m), and the minimum coast area in cells (two separate uses) |
| 60 | cmp 0x3c | cluster join span from the box's min corner, cells |
| 10 | cmp 0xa | minimum cluster box extent (either axis must be ≥ 10) |
| 32.0 | 0x42000000 | z of the path end points |
| 1.0 | | path parameter |
| 400.0 | 0x9df66c | maximum land path length in m (≤ passes) |
| 0.7853982, 8 directions | 0x9de294 | landing point probe angles |
| 10.0 | 0x9dd8b0 | landing point probe radius in cells, truncated to int |
| 15 | push 0xf | ring dilation radius in cells (plus 1 more for the 1-cell ring) |
| 1e6 | 0x49742400 | start value of the nearest-lattice distance |
| FLT_MAX | 0x7f7fffff | start value of the best Manhattan distance |
| 6.0 | 0x40c00000 | occupancy query radius in m |
| −2 | | "free" |
| 6755399441055744.0 | 0x9dd800 | float-to-int rounding trick only |

## 7. Addresses

| address | function |
|---|---|
| 0x527dd0 | CAiMineMgr method dispatcher |
| 0x4f0b20 | Init |
| 0x4f0d50 | UpdateMinePositions |
| 0x4ecce0 | GetNextMineGroup |
| 0x4f6880 | sort |
| 0x45b890 | AI maps level init (start location loop) |
| 0x4561f0 | shore S.Init (land / water maps, largest water body, 0.095 test) |
| 0x458de0 | ComputeShore |
| 0x4565a0 | lattice |
| 0x453a60 | nearest lattice point |
| 0x4537f0 | cluster representative |
| 0x453770 | bounding box |
| 0x9029b0 | path finder FindPath |
| 0x40e930 | layer select (water flag → +0x318, amphibious → +0x408 / +0xc78 + p × 0xf0, player 0..7 → +0x4f8 + p × 0xf0, else +0x228) |
| 0x9031c0 | terrain height |
| 0x4dc3a0 / 0x4dc5b0 | shore cache copy / get |

Debug dump names of the path finder layers (0x903b65): +0x48 `pfFLMap`, +0x138 `pfFWMap`, +0x228 `pfmap`, +0x318
`pfWaterMap`, +0x408 `pfAmpMap`, +0x13f8 `pfNWMap`, +0x14f8 `pfIslandMap`, +0x1528 `pfOwnerAndLand`.

## 8. Open points

* The exact rules of `pfmap` / `pfWaterMap`: they are derived from the base maps `pfFLMap` / `pfFWMap` by 0x9027d0
  (clearance or inflation for the unit size); not decoded. In practice land = where land units can walk, water = where
  ships can sail, and the coast strip is where both overlap (shallow water).
* The other path call arguments (0, 0, 1.0, −1, 0, 1, 0, 0) were not decoded beyond the layer choice (land layer, no
  player walls).
* Query region type 2 takes (6, 6): probably minimum and maximum radius, or one radius for the 2D and the 3D test.
