# The engine's WallMap — reverse-engineered rules (ported 1:1 in `src/game/wallmap.js`)

Status: complete first pass (2026-10-17). Every rule cites PWServer.exe virtual addresses (image base 0x400000).
The WallMap core is shared code ("URS.Shared.WallMap", string 0xa897b0) that exists byte-identically in both
executables: **client address = server address − 0x25b640** for the whole range 0x7dc000–0x7e3000
(e.g. CalcWall core 0x7e26c0 ↔ (C)0x587080, placeable 0x7de030 ↔ (C)0x5829f0, gfx name 0x7e1730 ↔ (C)0x5860f0).
(C) marks PWClient.exe addresses. Confidence tags: **[certain]** read directly from code, **[likely]** strong
inference, **[unknown]** not resolved.

Method: Ghidra headless decompilation of PWServer.exe and PWClient.exe, cross-checked against the disassembly where
the decompiler hid `this` or dropped blocks. Model facts from the GSF archives via `pwexport/gsf.py` (part GUID =
crc32 of the part name). The game rules that do not live in the engine are in `walls.md`.

---------------------------------------------------------------------------------------------------------------

## 0. Conventions used below

**Map coordinates.** World positions are the original map's (x, y) in metres, y pointing "south" (the same axes as
GSF model space; a wall object always has rotation 0). The remake's (x, z) equal map (x − ox, y − oy).

**Tile directions** (tables 0xa89560 = dx, 0xa89580 = dy; duplicated at 0xa8971c/0xa896fc):

| d | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| (dx,dy) | (−1,−1) | (0,−1) | (1,−1) | (1,0) | (1,1) | (0,1) | (−1,1) | (−1,0) |
| compass (y south) | NW | N | NE | E | SE | S | SW | W |

Odd d = straight, even d = diagonal; opposite = (d+4)&7. dirIndex(dx,dy) = 0x7dc0c0 (−1 if not a neighbour step).
Remake `wallmap.js` DIRS index r = (3 − d) & 7 (r 0 = E … 7 = SE).

**Height level** (0x7dc7f0): `level(i,j) = roundEven((H(cx,cy) − 1.7) / 2) + 1` with (cx,cy) the tile centre and
H the terrain height (0x8dde00). roundEven = FPU round-to-nearest-even (the 6.7553994e15 trick).
**Edge level** (0x7dc860): the same formula at the point `((i + (dx+1)/2)·8, (j + (dy+1)/2)·8)`, i.e. the middle of
the tile edge (straight d) or the tile corner (diagonal d) in direction d.
**Quantised z** of a tile: `2·level(i,j)` (0x7dd040 with flag 1). Everything the WallMap creates stands at this z.

---------------------------------------------------------------------------------------------------------------

## 1. The tile grid

### 1.1 Geometry [certain]
- Tile size 8 m, origin (0,0), no offset: `tile = (trunc(x/8), trunc(y/8))` (0x7dc120; truncation toward 0, maps
  have x,y ≥ 0). Tile centre = `((i+0.5)·8, (j+0.5)·8)` → centres at 4 mod 8 (0x7dd040).
- Map size: `w = (scapeWidth + 7) >> 3`, `h = (scapeHeight + 7) >> 3` taken from scape+0x38/+0x3c; 640×640 if no
  scape (0x7e2010). Tile coordinates are stored as int16 in the CWall list.
- The outermost ring of tiles is unusable for every wall-map object: the shape test of every neighbour must succeed
  and an off-map neighbour fails it (0x7dd500 returns false off map, called for all 8 neighbours in 0x7de030).

### 1.2 What a tile stores [certain] (ushort array at WallMap+0x20, written by 0x7dcb70)
```
bits 0-3   owner (signed 4 bit; 0xF = none, set when the tile becomes empty: 0x7dcc40)
bits 4-6   race (0 Hu, 1 Aje, 2 Ninigi, 3 SEAS = Race_n of wallclassconfig_ex.txt)
bits 7-8   wall class 1..3 (0 = no wall piece)          "wall piece present"  = bits7-8 != 0
bit  9     the wall piece is a gate                     isGate(v)  = (v&0x180) && (v&0x200)   0x48e7a0
                                                        isWall(v)  = (v&0x180) && !(v&0x200)  0x48e780
bits 10-11 tower class (0 = none)
bit  12    BLOCKED (obstacle scan, trap, gate flank)
bit  13    wall/gate built ("SetReady"; reused as a temp marker by the client preview)
bit  14    tower/gate built (same)
bit  15    additional entrance (siege dock; type 5 writes bits 13-15 = 0xE000, 0x4941c0 push 5 → 0x7dcb70)
occupied(v) = v & 0x8d80                                                               0x48e760
```
Plus a 1-bit-per-tile **trap bitset** (WallMap+0x28, size +0x2c; set by 0x40e020, cleared by 0x7e2f10).

Write rules of 0x7dcb70(i,j, owner, race, class, type):
```
base = (v & 0xff80) | (race&7)<<4 | (owner&0xf)
type 3 trap : v = base | 0x1000 ; trapbit = 1
type 5 entr.: v = base | 0xE000
type 2 tower: v = base with bits10-11 = class            (wall bits 7-9 are KEPT → a tower can sit on a wall piece)
type 0/1/4  : v = (base & 0xfc7f) | (class&3)<<7 | (type&1)<<9    (gate flag = type 1)
```
Removal 0x7dcc40: clears only the part of the given type/class (tower bits / wall+gate bits / trap / entrance), then
sets owner = 0xF if nothing of 0x1d80 remains.

### 1.3 Object types and the class table [certain]
`wallclassconfig_ex.txt` is loaded by InitWallClassMap (0x4900c0 → 0x7df5d0): for race 0..3, class 0..5, key
`Race_%d/Class_%d/%s` with %s ∈ {Wall, Gate, Tower, Trap} (name table 0xaee494); value "****" = empty. `/Walkable`
is read for Wall and Tower entries. Lookup by object class name 0x7de880 → (race, class, type) with
type 0 Wall, 1 Gate, 2 Tower, 3 Trap (for traps the result is race := class index, class := 0). The client enum adds
WC_Siege = 4 (hu_ladder) and WC_Invalid (strings (C)0x84e2d4-0x84e308). Name back-lookup 0x7df350(race,class,type).
In wallclassconfig_ex the useful classes are numbered 1..3 (Class_0 is empty), so tile class bits 1..3 are the
config class numbers (Hu: 1 palisade, 2 small wall, 3 re-enforced).

### 1.4 Global flag NewGates [certain]
WallMap+0x38 = setting "Server/NewGates", default 1 (ctor 0x7e2090, 0x805070(key,1,…)). Script `IsNewGates`.
With NewGates (the shipped default) a gate is a single tile centred on a tile; the old mode (2-tile gate centred on
a tile edge) only survives in old maps. Everything below assumes NewGates = 1 unless stated.

---------------------------------------------------------------------------------------------------------------

## 2. CalcWall

### 2.1 Script entry (client) [certain]
`CWallMapCln.CalcWall(owner, class, vStart, vEnd, ref CWall, numTilesHold=0)` = (C)0x4f8950 (5-arg form
(C)0x4f8eb0 passes hold 0). Dispatcher (C)0x4ccab5 cases 4/5.
```
if vStart.x < 1 → log "CalcWall Start Point invalid"; return false      (x==0 means "no pick")
if vEnd.x   < 1 → log "CalcWall End Point invalid";   return false
owner = local player id (client vtbl+0x4c), unless no game player (vtbl+0x10()==0) → keep the script's owner (-1)
ok = CalcWallCore(owner, class, vStart, vEnd, wall, hold)                (C)0x587080 = 0x7e26c0
if ok && wall.count > 2:                                                  // "gate possible" hints
   beginTemp(); for each tile t: record(t); write(t, owner, race 0, class 1, type 0)
   for i in 1 .. count-2: d = dirIndex(tile[i]-tile[i-1]); if d>=0: tile[i].gateOK = GateFits(tile[i], d, -1, 0)
   restore()
return ok
```
The server's AI uses the same core (0x4efb80 "CAiSensor::BuildWallOnline").

### 2.2 CWall record [certain]
```
byte  header = race | class<<3 | type<<6
ptr   tiles  (6 bytes each: int16 x, int16 y, byte existing, byte gateOK)
int   count
```
`NumTiles` = count; `ClearLast(n)` 0x4f75f0 keeps count−n; `AddTile(x,y,flag)` 0x494e70 updates the flag if the
coordinate is already listed, else appends (so a polyline never lists a tile twice).

### 2.3 CalcWallCore(owner, className, start, end, wall, hold) — 0x7e26c0 [certain]
```
hold = min(hold, wall.count)
(race, class, type) = lookup(className)  else log "Given class (%s) not found as wall class"; return false
(si,sj) = tile(start);   if off map → "start not on map"; false
if H(start) < seaLevel − 1 → "start under water"; false        (seaLevel = DAT_00aed570, default 16)

if type == GATE:                                                       → §5.1
if type == SIEGE (4):  d = SiegeDir(si,sj); if d<0 false               → §6.4
      wall.header = race & 7            // sic: class and type bits stay 0 (0x7e2834)
      ClearLast(count-hold); Add(si,sj,1); Add(si+dx[d], sj+dy[d], 1); return true
(ei,ej) = tile(end);     if off map → "end not on map"; false
if H(end) < seaLevel − 1 → "end under water"; false

box = bbox((si,sj),(ei,ej)) grown by 3, clamped
beginTemp()                                   0x7e1950
ScanObstacles(box)                            0x7e2400  (§2.6; temporary, undone at the end)
for k in 0 .. hold-1:                         // the frozen legs of a Shift polyline
    t = wall.tiles[k]
    if !Placeable(t, owner, race, class, type) → "can't place here (%d,%d)"; restore(); false
    record(t); write(t, owner, race, class, type)            // the held legs now exist for the new leg
if !Placeable(start) → restore(); false
if type == TOWER:
    restore(); header = race | class<<3 | 2<<6; ClearLast(count-hold)
    Add(si, sj, existing = HasOwn(si,sj, owner, race, TOWER)); return true
list = []
if start == end: list = [start]
else:
    if Blocked(end) → only a log "end point is blocked ..." (the search below fails anyway)
    if !FindPath(start, end, owner, race, class, type, list) → restore(); false        (§2.4)
restore()
header = race | class<<3 | type<<6;  ClearLast(count - hold)
for t in list: Add(t, existing = HasOwn(t, owner, race, type))     0x7dcd20
return true
```
Note on SIEGE: the hu_ladder hack in PlaceController only uses `GetWall(m_xWall)` on that result, so the odd
header does not matter.
seaLevel: DAT_00aed570 lives in .data with the value 16.0 and no store to it exists in PWServer (only reads), so
the "under water" test is effectively `H ≥ 15 m` [likely]; the client uses (C)DAT_008e07e0 the same way.

So **a line is all-or-nothing**: if no path exists, CalcWall returns false and the client hides the preview and
the grid (PlaceController AddWall: `EnableGridRendering(bFound)`); there are no partial/red tiles.

`HasOwn(t, owner, race, type)` (0x7dcd20) = tile occupied (0x8d80) and
- type 0 wall: tile is a wall or a gate piece (any class), owner and race equal (−1 = any);
- type 1/4: no tower on it and owner/race equal; type 2: tile has a tower; type 3: trap bit set (owner not checked).
The `existing` flag makes the server skip that tile (no object, no cost) — dragging over own walls of another class
keeps them as they are.

### 2.4 FindPath(start, end) — 0x7e0730 [certain]
Not Bresenham: a cone-restricted shortest path (straight cost 1, diagonal 1.414) over placeable tiles, computed
with a FIFO label-correcting search, then traced back from the end.
```
// window
spanX = |ex - sx|                       // NB: only the x span is used
m = start==end ? 1 : clamp(trunc(spanX/4), 5, 10)
W = [min(sx,ex)-m, max(sx,ex)+m] x [min(sy,ey)-m, max(sy,ey)+m], clamped to the map; ww, wh = its size
backup the window's tile words and trap bits
cost[c] = Placeable(c) ? 1e7 : 2e7      for every window cell (evaluated once, before the search)
if cost[start] == 2e7 or cost[end] == 2e7 → fail
// allowed directions: "towards the end" in at least one axis
sxs = sign(ex-sx), sys = sign(ey-sy)
allow[d] = (sxs!=0 && dx[d]==sxs) || (sys!=0 && dy[d]==sys)          (bytes esp+0x4c..0x53, 0x7e0ac7)
cost[start] = 1.0; queue = [start]
budget = min((ww+wh)*50, 2500)
while queue not empty and queue.length < ww*wh and budget-- > 0:
    cur = queue.shift()                                      // FIFO
    // look-ahead: temporarily build the provisional wall from cur back to start
    tmp = [cur]; write(cur, owner, race, class, type)
    p = cur; steps = 0
    while p != start and steps++ < budget:
        best = 1e7; pick = none
        for d in 0..7 with allow[(d+4)&7]:                   // reverse directions
            n = p + dir[d]; if n in W and cost[n] < best and Placeable(n): best = cost[n]; pick = n
        if none: break
        p = pick; tmp.push(p); write(p, ...)
    // relax
    for d in 0..7 with allow[d]:
        n = cur + dir[d]; if n not in W or cost[n] >= 2e7: continue
        c = cost[cur] + (d odd ? 1.0 : 1.414)               // float32, 0x3fb4fdf4 = 1.41400003
        if c < cost[n] and Placeable(n): cost[n] = c; queue.push(n)
    restore the tmp tiles from the backup
if cost[end] >= 1e7 → restore window, fail
// trace back from the end, building the path as it goes
path = [end]; write(end); p = end
for k in 1..1000 while p != start:
    best = 2e7; pick = none
    for d in 0..7:                                           // all 8, no cone
        n = p + dir[d]; if n in W and Placeable(n) and cost[n] < best: best = cost[n]; pick = n
    p = pick; path.push(p); write(p)
restore the whole window from the backup
out = reverse(path)                                          // start … end  (0x7e135f)
```
Consequences for a 1:1 port:
- Ties are broken by the lowest direction index d (strict `<`), and the trace starts at the end. With octile costs
  the trace prefers the neighbour closest to the start, so **the diagonal steps sit at the END of the line and the
  straight steps at the start** (start (0,0) → end (5,2): (0,0),(1,0),(2,0),(3,0),(4,1),(5,2)).
- Because Placeable() is evaluated with the provisional wall in place, the slope/shape rules (§3) can force
  detours; the result can be longer than the octile distance or fail.
- Moves "sideways" are allowed (e.g. end due east: dirs NE, E, SE), so the path may leave the start/end box; the
  obstacle scan of §2.6 only covers box±3.

### 2.5 Placeable(i,j, owner, race, class, type) — 0x7de030 [certain]
```
if off map or Blocked(i,j, owner, race, type): false
save tile word and trap bit; write(i,j, owner, race, class, type)          // try it
ok = ShapeOK(i,j, owner, race, type) && for all 8 neighbours n: ShapeOK(n, owner, race, type)
restore tile word and trap bit
return ok
```
**Blocked(i,j, owner, race, type)** — 0x7dced0:
```
off map → true
v = tile
if type==TRAP && trapbit:  return (v&0x1000) && owner(v)==owner     // an enemy trap does not block (hidden)
if v & 0x1000: true                                                // obstacle / trap / gate flank
if type==GATE:  if tower(v) or isGate(v): true;  if !isWall(v) && !NewGates: true
if type==SIEGE: if tower(v) or isGate(v) or !isWall(v): true
if !occupied(v): false
if type==TRAP:  true
if type==TOWER: if isGate(v) or tower(v): true
if type==WALL:  if isGate(v) && NewGates: true                     // lines never run through a new gate
return !( (owner(v)==owner || owner==-1) && (race(v)==race || race==-1) )   // only own objects may be shared
```
**ShapeOK(t, owner, race, type)** — 0x7dd500:
```
off map → false
if type==TOWER && 2*level(t) < 16 → false            // tower: own tile and all 8 neighbours need z ≥ 16 m
if !(own(t) [owner, race match and v&0xd80]) && !trapbit(t) → true     // other tiles are not checked
return Connections(t, owner(t), race(t), type, rel) != invalid         // 0x7dd250, §3.1
```

### 2.6 Obstacle scan — 0x7e2400 (temporary, recorded in the undo list) [certain]
For every tile in the box that does not already carry bit 12:
```
p = centre with quantised z
blocked = Trees(p, 2.0) > 0 || Trees(p, 7.0) > 3                    // 0x8db7d0
set/clear bit 12 accordingly
```
`Trees(p, r)` (0x8db7d0) counts standing forest trees of the scape forest layer (32 m blocks, entry byte
`(b & 0x60) == 0x40 && (b & 0x1f) != 0`) in the blocks overlapping [p−r, p+r]² whose distance² < 2r² + 0.1
(effective radius r·√2: 2.83 m and 9.9 m).
Then every object returned by the place checker for the box (0x4487e0: objects with flag bit 18 of obj+0xc whose
bounds intersect) that is **not** a wall-map class, or is a trap, blocks every tile whose **centre lies inside the
object's 2D oriented bounding box** (0x7f0630 → 0x7e1a90). Wall-map objects (walls, gates, towers) do not block
here; they are handled by the tile words. Units are not in that list [likely].

Additional permanent invalidity: `TileValid(t)` (0x7dc920, used by §3.1) rejects a tile when both cross-shaped
windows of 2 m cells — x∈[4i+1,4i+4)×y∈[4j,4j+5) and x∈[4i,4i+5)×y∈[4j+1,4j+4) — are completely set in the
level's 2 m cell bitmap (global 0xb39888 +0x1510, reached through CObjPlaceCheckerSrv vtbl slot 7 = 0x445ab0).
Which terrain property that bitmap holds is **[unknown]** (most likely the static blocked/unbuildable cells).

---------------------------------------------------------------------------------------------------------------

## 3. Connections ("arms")

### 3.1 Connection analysis — Connections(i,j, owner, race, type, rel[8]) 0x7dd250 [certain]
rel[d] = −10 means "no arm"; otherwise the arm's height step in levels.
```
rel[*] = -10
if !TileValid(i,j): invalid
L = level(i,j); if L <= 6: invalid                    // z <= 12 m: never
for d in 0..7:
    if HasOwn(i+dx, j+dy, owner, race, type):        // 0x7dcd20, type = the type being checked (0 for visuals)
        rel[d] = edgeLevel(i,j,d) - L
CornerRule(rel)                                        // 0x7dc350
// end piece: one connection f → maybe a virtual flat arm on the open side
if count(rel) == 1:
    o  = (f+4)&7
    he = edgeLevel(i,j,o) - L
    (i2,j2) = (i + 2dx[o], j + 2dy[o]);  h2 = level(i2,j2) - L
    good = |he| < 2 && |h2| < 3 && |h2 - he| < 2 && TileValid(i2,j2) && Trees(centre(i2,j2), 10.0) < 1
    if !good: rel[o] = 0                               // the wall runs on into the obstacle/slope
return Shape(rel) != -1                                // 0x7dc3d0
```
**CornerRule** (0x7dc350): for every straight direction s ∈ {1,3,5,7} with rel[s] ≠ −10, set rel[s−1] and rel[s+1]
to −10. A diagonal arm only survives when neither adjacent straight direction of **this** tile has a connection.
(That is the "no arm across an L corner" rule; after it at most 4 arms remain.)

**Shape(rel)** (0x7dc3d0) → −1 invalid, else a code:
```
for every connected d: if rel[d] < -1 or rel[d] > 1 → -1           // arm end more than one level (2 m) off
flat = all connected rel == 0;  c = count;  f = first connected d
c 0/1                     → 0
c 2: f+1 or f+7           → -1 (cannot happen after the corner rule)
     f+4 → 1 (straight)   f+2/f+6 → 2 (right angle)   f+3/f+5 → 4 (135°)
c 3: {f,f+2,f+4},{f,f+4,f+6},{f,f+2,f+6} → 3 (T); {f,f+2,f+5},{f,f+6,f+3},{f,f+3,f+5} → 0
c 4: {f,f+2,f+4,f+6} → 5 (cross)
otherwise → flat ? 0 : -1
```
HasOwn for the visual/pathfinder analysis (type 0) means: neighbour tile is a wall piece or gate of the **same owner
and same race** (any class). A **tower standing on an empty tile has no wall bits and does not connect**; a tower
standing on a wall piece connects through that piece. Different owners never connect. Traps never connect to walls.

### 3.2 Visual connections of a wall piece — 0x7e1730 / (C)0x5860f0 [certain]
```
GfxName(i,j, owner, race):
  v = tile; if !(isWall(v) or isGate(v)) or owner/race mismatch: ""
  Connections(i,j, owner, race, WALL, rel)
  if NewGates:
     for d in 0..7: n = neighbour d
        if isGate(n) and none of n's 8 neighbours is a gate: rel[d] = -10     // no arm into a 1-tile gate
  return BuildName(rel)                                   // 0x7df930
```
### 3.3 BuildName(rel) — 0x7df930 [certain]
Produces a dot-separated list of part names. `L(d)` = `'b' + rel[d]` → `a` (arm end one level lower), `b` (level),
`c` (one level higher). Formats: ".%d%c", ".%dd", ".%de", ".%df", hubs "x0","x1","x2","x%d%d" (strings
0xa8969c-0xa896f8).
```
if any connected |rel| > 1: ""
c = count, f = first connected, flat = all connected rel 0
P(f) = (f even ? "x0" : "x1") + for d in f, f+2, f+4, f+6: (connected ? ".{d}{L(d)}" : ".{d}d")
c 0: "x2.0f.1f.2f.3f.4f.5f.6f.7f"                       (lone post)
c 1: flat ? "x2" + for d 0..7 (connected ? ".{d}e" : ".{d}f")  :  P(f)
c 2: f+1/f+7 → "" (log "sharp corner");  f+4, f+2, f+6 → P(f)
     f+3 / f+5 → "x{a}{b}" + ".{a}{L(a)}" + ".{b}{L(b)}"   (a<b the two dirs: x03 x05 x14 x16 x25 x27 x36 x47)
c 3: the three regular patterns of §3.1 → P(f); otherwise "x2" + for d 0..7 (connected ? ".{d}{L(d)}" : ".{d}d")
c 4: {f,f+2,f+4,f+6} → P(f); else flat ? "x2"+e/f as for c 1 : "" (log "four neighbours present but not flat")
c ≥ 5: ""
```
So: hub **x1** = straight family (E–W line, L corner of straights, T or cross of straights), **x0** = diagonal
family, **x03…x47** = 135° bends, **x2** = generic flat hub (lone post, flat end piece, irregular junctions);
**d** = closed side piece of an x0/x1 hub, **e/f** = arm / closed side of an x2 hub.

### 3.4 How the name becomes geometry — (C)0x4f9100 [certain]
```
name = GfxName(...)
log "Component %d %d -> %s"
obj.partMask.clearAll()                                   (C)0x46c8a0
for comp in name.split('.'):                              e.g. "x1", "3b", "7b", "1d", "5d"
    for v in 0..15:                                       // 'A'..'P'
        id = fourcc(comp + chr('A'+v), space padded to 4) // "%s%c", "%s%c ", "%s%c  " (C)0x8df30c
        k = partIndex(id); if k >= 0: obj.partMask.set(k)  (C)0x4f8230, table built by (C)0x4f8c50
```
**All** variants A..P of every named component are switched on. They are not alternatives: the variants of one
component carry different state flags (GSF attr), e.g. hu_small_wall `3b`: A 0x0042c001f (flags 29,21,20,18),
B 0x05cc001f, C 0x050c001f (construction stages: flag 29 without 30), D 0x0600001f (finished, flags 30+29),
E 0x0a00001f / F 0x1200001f (damage stages, flags 28/27), G–J chunk type 2 (destroyed stages). The normal
build-stage / damage flag filter then shows exactly one of them. **There is no random choice and no hash.**
Part GUID = crc32 of the 3/4-char name without padding (e.g. crc32("3bD")).

Part geometry (hu_small_wall, finished D variants, GSF model space): straight arm `3b` x 0..4 (to the tile edge),
z −8.1..9.2; `3a` reaches 2 m lower (z −10.1), `3c` 2 m higher (11.2); diagonal `4b` reaches the tile corner
(5.98); `3d` is a short stub (x ≤ 2.1); `3f` x ≤ 3.1; hubs x0 ±5.7, x1 ±4.0. Model part d points to tile
neighbour d in model axes (verified: `1b` spans y −4..0, `5b` y 0..4.3, `7b` x −4.3..0, `0b` (−5,−5)). Palisade-tier
models (hu_palisade) have no d/f parts: closed sides show nothing.

### 3.5 When arms are recomputed [certain]
Server and client keep their own WallMap; both are updated by object events:
- **AddObj** 0x7de950 (ObjChNew 0x445b84; WallClassChanged): write the tile (§1.2), then vtbl+0x0c(tile),
  vtbl+4(tile) ("tile update") and vtbl+4 on each of the 8 neighbours that is an own (same owner+race) wall or gate
  (0x7dce10; not done when the added object is a tower). For a gate also the neighbours of tile+d.
- **RemoveObj** 0x7dee80 (ObjChDel 0x445bd0): vtbl+0x10(tile, obj), clear the tile part (0x7dcc40), then vtbl+4
  on the tile and its own wall/gate neighbours (same rules).
- Client vtbl+4 = (C)0x4f93a0: gate tile → gate end-piece flags (§5.4); wall tile → find the wall object at the
  tile centre (distance² ≤ 0.5) and apply §3.4.
- Server vtbl+4 = 0x493940: wall-walk bookkeeping, object/tile consistency (§5.3), and the pathfinder mask (§7).
- Terrain change event (EventSink_CWallMap_TerrainChanges, handler 0x7e2120): every occupied tile in the changed
  32 m blocks (±1 tile) gets vtbl+8 → 0x490f10 → 0x7df3a0, which re-positions the objects (§4). Arms are not
  recomputed on terrain change [certain: no vtbl+4 there].
- SetReady (0x48f880) only sets bits 13/14 (no refresh).

---------------------------------------------------------------------------------------------------------------

## 4. Heights [certain]
- A wall-map object stands at the tile centre with **z = 2·level** (quantised to 2 m; level formula in §0). Server
  PlaceWall uses 0x7dd040(i,j,1) for every tile type (0x490920); the client preview uses it too except for traps
  (real ground height, (C)0x4f9af0 `param_3 != 3`).
- There is no tilt. Each arm is one of three pre-modelled pieces: `a` / `b` / `c` for an arm end one level lower /
  level / one level higher than the hub, where "arm end" is the edge-midpoint (straight) or tile corner (diagonal)
  in that direction (0x7dc860). Two neighbours share the same edge point, so their arms meet at the same height.
- **Slope limit**: every connected arm needs |edgeLevel − level| ≤ 1 (Shape, §3.1) — about ±(1…3) m terrain
  difference over 4 m (straight) or 5.66 m (diagonal) after rounding; violating it makes the tile (and therefore
  the whole line) unplaceable. Junctions with ≥ 3 arms that are not the regular T/cross patterns need all arms
  level. Absolute limits: level > 6 (z > 12 m) for any checked tile; towers need 2·level ≥ 16 on their tile and all
  8 neighbours; start and end points need terrain ≥ seaLevel − 1.
- Gates: the two wing tiles' levels may differ by at most 2 (§5.1).
- On a terrain change the server re-snaps walls, towers and gates (0x7df3a0): walls/towers to 0x7dd040(i,j,1);
  **gates to 0x7dd0f0(i,j,d,1), i.e. the old 2-tile gate position on the tile edge — also for new 1-tile gates**
  (tile computed from pos − 0.5·dir). This looks like an engine bug [certain about the code; whether the event fires
  for in-game AdaptTerrain is unknown]. Traps and sieges are skipped.

---------------------------------------------------------------------------------------------------------------

## 5. Gates

### 5.1 Where a gate fits — GateFits(i,j, d, owner, race) 0x7dd600, NewGates branch 0x7ddb59 [certain]
```
if Blocked(i,j, owner, race, GATE): false        // empty tile or own wall piece; not tower/gate/blocked
A = (i+dx[d], j+dy[d]);  B = (i-dx[d], j-dy[d])
if !isWall(A) or !isWall(B): false               // wing tiles: wall pieces (not gates), ANY owner/class
if d odd  (straight gate): tiles (d+2) and (d+6) of (i,j) must be unoccupied (no wall/tower/entrance)
if d even (diagonal gate): tiles (d+1),(d+3),(d+5),(d+7) of (i,j) must be unoccupied
if |level(A) - level(B)| > 2: false
true
```
The gate tile itself need not hold a wall piece. (Old mode, 0x7dd63d…: two tiles (i,j),(i+d) that both must be own
walls with walls beyond on both sides, same class, straight shape and height limits on both tiles.)

### 5.2 CalcWall for a gate (0x7e26c0 gate branch) [certain]
The script calls `CalcWall(-1, gateClass, cursor, cursor)`.
```
(i,j) = tile(cursor)
d0 = dirIndex(trunc((centre - cursor)/4)) → always (0,0) → -1 → 0     // the search always starts at d = 0
for d = 0..7: if GateFits(i,j,d, owner, race): break      else return false
class = max(gateClass, wallClassBits(i,j), wallClassBits(i+dx,j+dy))   // a gate takes the stronger wall class
header = race | class<<3 | 1<<6
ClearLast(count-hold); Add(i,j,1); Add(i+dx[d], j+dy[d], 1)          // 2 tiles: gate tile + one wing
```
Because d and d+4 test the same axis, the first fitting axis wins in the order **NW–SE diagonal, N–S, NE–SW diagonal,
E–W**. The class rule means a palisade gate dropped into a small wall becomes `hu_small_wall_gate` (and the server
charges that class's price).

### 5.3 Server placement and what happens to the replaced piece [certain unless noted]
PlaceWall gate branch (0x490920): needs exactly 2 tiles ("gate subclass but not 2 tiles"), d = dir(tile1−tile0),
re-checks GateFits ("can't place gate here"), then `PlaceObj(owner, gateName, centre(tile0) with quantised z,
rot = (0,0, −(d+5)·π/4), workers, queued, bWall=1)` (0x42c470 → script CPlaceMgr.PlaceObj, which skips the place
check and AdaptTerrain because bWall). Rotation per first-fit axis: d0 → 3π/4, d1 → π/2, d2 → π/4, d3 → 0
(model local x = gate axis; d is recovered as `(round(rot/(−π/4)) + 11) & 7`, 0x491150/0x7dc060).
On AddObj of a centred gate (x%8==4 && y%8==4) with NewGates (0x7de950):
- the tile gets the gate flag + class;
- **flank tiles get the permanent blocked bit**: straight gate → tiles d+2, d+6; diagonal → d+1, d+3, d+5, d+7
  (cleared again in RemoveObj 0x7dee80). Nothing can be built across the passage.
- the server tile update (0x493940) finds any non-gate wall-map object standing at the gate tile centre
  (distance² ≤ 0.5) and calls its script hook 0x8a (0x4aa0f0; **most likely Delete**) → the old wall piece under
  the gate disappears (no refund in this path). [likely]

### 5.4 Wings, diagonal flag, model pieces [certain]
- `GetGateConnectingWalls(gate, L, R)` (0x491150): d from the rotation; L = first wall object found by
  GetNextWalls at gate.pos + 8·(dx[d],dy[d]) within 1 m, R = at gate.pos − 8·(dx[d],dy[d]). The script makes them
  grouped children (Building.usl CGate.OnInit). Wings are the adjacent tiles along the gate axis.
- `IsGateDiagonal` (0x7dc060) = d even.
- Walls draw **no arm into a 1-tile gate** (§3.2); the gate model spans the gap itself.
- Render flags 7 and 11 (`VIS_FLAG_WEST_BIT`/`VIS_FLAG_OST_BIT`) select the gate's end pieces (plain attr bits 0x80
  and 0x800: hu_palisade_gate meshes at x ≈ +7 and −7, pf boxes x 7.6..12 and −11.9..−7.5). The object's render
  mask (obj[5]) is an INVISIBLE mask; `SetRndInvMaskSingleFlagInv(bit, visible)` (client (C)0x4764d0:
  visible → clear bit, else set). Client tile update (C)0x4f93a0, ghost (C)0x4f9f70 and the script all pass
  visible = isDiagonal: **diagonal gates show the end pieces** (their wing hubs are 11.3 m away), straight gates hide
  them (wing hub at 8 m, posts already reach ±7.75). For an old 2-tile gate the client sets the two flags from
  the tiles beyond its ends ((C)0x4f93a0 with helper (C)0x4f8110; details not needed for new gates) [unknown].

### 5.5 Client gate preview [certain]
PlaceController.CheckPlacebility (gate): `CalcWall(-1, class, p, p)`; found → `PreviewWall(wall, class, green)`:
(C)0x4f9f70 writes only tile 0 for new gates, creates the gate ghost at the tile centre (quantised z), rotation
−(d+5)·π/4, colour A, end-piece flags as above. Not found → ghost red at the cursor. `GetValidGatePos` is
commented out in the scripts and not needed.

---------------------------------------------------------------------------------------------------------------

## 6. Towers, traps, sieges, entrances

### 6.1 Towers [certain]
- One tile (`tower subclass but not 1 tiles`), at the cursor tile; no line.
- Placeable on an empty tile or on an **own wall piece of the same race** (not on a gate or tower). The wall piece
  stays: the tile keeps its wall bits and gets tower bits (0x7dcb70 type 2). The server links the two objects
  (0x493940 → 0x4aa3b0 sets the tower handle in the wall piece, flag obj+0x90 bit 0; meaning [unknown]).
- A tower on its own does not connect to neighbouring walls (§3.1). To make a tower a joint, the wall line must run
  through the tower tile (allowed: Blocked() lets a wall share an own tower tile, `existing`=0 so a wall piece is
  created there). Adding/removing a tower does not refresh neighbours (0x7dce10 returns 0 for type 2).
- Tower tile and its 8 neighbours need z ≥ 16 m (§2.5).
- Script: CTower.SetReady → WallMap.SetReady → bit 14.

### 6.2 Traps [certain]
- Traps use the same line placer (TT wall=1): CalcWall with type 3 computes a path like a wall line; each tile
  becomes one trap.
- A trap tile gets bit 12 (blocked for everything else) + the trap bit; owner/race overwritten.
- Placing a trap on a tile with an enemy trap is allowed (Blocked type 3); on any wall/tower tile it is not.
- Traps "connect" to adjacent trap tiles for the slope/shape test (HasOwn type 3 = trap bit), so trap lines obey
  the same ±1 level rule. Traps are excluded from object re-snap and from the PF mask; the preview places them on
  the real ground.

### 6.3 Obstacle objects vs. wall-map objects
Everything not in the wall class table (and traps) blocks tiles through its OBB during CalcWall (§2.6).

### 6.4 Siege (hu_ladder, WC_Siege) — SiegeDir 0x7dddd0 [certain]
Target tile: a wall piece (not gate) without tower and not blocked (0x1c00 == 0), any owner. Connections =
neighbours that are occupied and have no tower (rel 0); CornerRule; shape must be 0, 1 or 4; result = first
connected direction d. CalcWall returns [tile, tile+d].

### 6.5 Additional entrances (siege docks) — AddAdditionalEntrance 0x4941c0 / Remove 0x494610
Write type 5 (bits 13-15) on the dock tile; used by the wall-walk system (walls_walk.md), counts as occupied.

---------------------------------------------------------------------------------------------------------------

## 7. Pathfinder blocking [certain]
Only wall pieces (not gates, towers, traps) get a computed blocker mask. Server tile update 0x493940, for a wall
tile: `mask = PFMask(i,j, owner, race)` (0x7de2e0) → `wallObj.SetPFBlockerMask(mask << 5)` (0x452b90) → pathfinder
refresh (0x4582b0) when the object is registered.
```
PFMask(i,j):
  if !(isWall or isGate) or owner/race mismatch: 0
  if !Connections(i,j, owner, race, WALL, rel): log "(%d,%d) tile not legal"; return 0     // NO blocking at all
  pf[d] = rel[d] if connected
          else 0 if rel[d-1] and rel[d+1] both connected         // fill the gap between two arms 90° apart
          else -10
  m = OR over pf[d] connected of 1 << ((d+7)&7)
  n = count(pf connected)
  regular = n==2 or (n==3 and pattern {f,f+2,f+4}|{f,f+4,f+6}|{f,f+2,f+6}) or (n==4 and {f,f+2,f+4,f+6})
  return m | (regular ? 0x400 : 0x600)
```
After the shift: arm d → pf bit `5 + ((d+7)&7)` (d1 N → bit 5, d2 NE → 6, d3 E → 7, d4 SE → 8, d5 S → 9,
d6 SW → 10, d7 W → 11, d0 NW → 12), bit 15 = small hub box (3.8 m, always), bit 14 = big hub box (6.9 m; end
pieces, lone posts, irregular junctions). These are exactly the direction bits of the model "pf" boxes (e.g.
hu_palisade box 0x1e00003f has bit 5 and spans y −7.96..2.97). How the pathfinder combines mask and box bits is not
in the wall code [likely: a box is active when its direction/hub bit is in the mask]. Note the gap-fill rule: an L
corner of two straights also blocks the diagonal between them (no squeezing through the corner), although no
diagonal arm is drawn there.
Gates: the script registers `GetPFBlockerMask() & COL_DIRECTION_MASK` with the pathfinder (Building.usl:2380); the
wall map never sets a gate's mask.

---------------------------------------------------------------------------------------------------------------

## 8. Preview, grid and what the server re-checks

### 8.1 PreviewWall(wall, gfx, colorA, numA, colorB) — (C)0x4f9f70 [certain]
```
checks: gate needs 2 tiles, tower 1 tile
beginTemp()
for each tile k (for a new gate only tile 0):
    record; write(tile, me, race, class, type)
    r = (type is TOWER or TRAP) ? 0 : 1
    for every tile n within r of it (3x3 or 1x1) that is an own same-race wall-map object (v&0xd80) or has the trap bit:
        if n == tile: n.bit14 = 1              // "this is a new piece"
        n.bit13 = 1                            // "needs a ghost"
if type != SIEGE:
    for every map tile with bit13:            // the new tiles AND their existing own neighbours
        idx = index in wall list (-1 for existing neighbours)
        colour = colorB
        if idx+1 <= numA: colour = colorA ; if type == WALL && idx >= 0 && tile[idx].gateOK: colour = 0xFF00FFFF
        ghost = TileGhost(tile, type, gfx, colour)                      (C)0x4f9af0
        clear bits 13/14
gate: one gate ghost (centre, rot −(d+5)π/4, colour A, end-piece flags)
siege: one ladder ghost at the wall tile, oriented by d, offset 8 m along it
restore()
```
- The first `numA` list entries are green (colour A), later ones yellow (colour B). numA counts list entries, so
  `existing` tiles also use up affordable slots in the preview (the script has a TODO about this).
- Existing own neighbours whose arms change are re-drawn as green ghosts with their future arms.
- Affordable wall tiles where a gate could later be inserted (gateOK, §2.1) get colour 0xFF00FFFF (cyan in the
  usual D3DCOLOR ARGB packing [likely]).
- TileGhost: position = tile centre, quantised z (traps: ground z); the new piece uses the `gfx` class, neighbours
  their own class; the ghost's parts are set with §3.4; for neighbours it copies the existing object's state flags.
  New 1-tile gate tiles get no tile ghost.

### 8.2 ShowPlacement(wall, pickpoint) — (C)0x4f8300
Grid overlay of the 3×3 tiles around the cursor tile: with the planned wall temporarily written and the obstacle
scan done (±3), each of the 9 tiles stores Placeable() for the grid colours. Errors "pos not on map",
"pos under water"; nothing for gates.

### 8.3 What the server re-checks — PlaceWall 0x490920 (event handler 0x44b61b; AI 0x4efb80) [certain]
- The server does **not** re-run CalcWall. It trusts the tile list and header (race/class/type → class name via
  0x7df350) but re-validates:
  - gate: GateFits for tile0/d;
  - otherwise: obstacle scan over the tiles' bbox ±3, then for each tile in order: if `existing` and not
    HasOwn → "got upgrade tile … no tile to upgrade"; if !Placeable → "can't place here" → **nothing is placed**;
    else temp-write it (so later tiles see earlier ones). Afterwards everything is restored.
- Then for each tile in list order (held legs first, then start → end): skip `existing` tiles; else
  `PlaceObj(owner, class, centre with quantised z, rot 0, workers, queued_k, bWall=1)` where **queued_0 = the
  player's Ctrl flag and queued_k = true for every later index k ≥ 1** (also when index 0 was an existing tile).
  The first failing PlaceObj (e.g. resources) stops the loop ("tile not placed").
- Script side per tile (ServerApp.usl:1100-1378): CheckConditionsAndPay (one tile's price), vegetation removal,
  Build/Q_Build orders, BuildVector timer.

---------------------------------------------------------------------------------------------------------------

## 9. Class upgrades and destruction [certain]
- `WallClassChanged(obj, newClass)` (0x48f3b0): `obj.SetClass(newClass)` (0x4aa180: class index at obj+0x94,
  notify 0x800000) then AddObj(obj) (0x7de950): the tile's class bits are rewritten in place (7dcb70 overwrites
  bits 7-9 / 10-11), the tile and its own neighbours get a tile update (new gfx, new PF mask). Position, tile and
  `existing` status are unchanged. Called from CWall/CGate.UpdateGfx before SetGFX.
- Destruction/removal: RemoveObj (0x7dee80) clears the tile part, unblocks gate flanks, refreshes the tile and its
  own wall/gate neighbours (they lose the arm towards it, PF masks shrink). Wall-walk events (WCT_Destroyed etc.,
  CWallMapSrv.ms_xWallEventClass) are emitted by the walk system (not covered here).
- SetReady (0x48f880, script CWall/CGate/CTower.SetReady and CWall.SetOwner): tile bit 13 for walls/gates, bit 14
  for towers/gates; for gates also on tile+d (with NewGates that is the wing wall tile — harmless quirk).

---------------------------------------------------------------------------------------------------------------

## 10. The port (remake)

`src/game/wallmap.js` follows the engine function by function; the remake-side glue:

| engine | remake |
|---|---|
| tile word, trap bit, write / clear / blocked bit | `WallMap.word / trap / write / clearPart / setBlocked` (a `Map` of words; empty tiles are not stored) |
| undo begin / record / restore | `begin / record / restore` (FindPath's look-ahead keeps its own nested list) |
| level / edge level / z | `level / edgeLevel / zOf`. The original maps keep their absolute heights; the remake's own maps are lifted so that the sea (or, without one, the ground) sits where the engine expects it (`heightAt`, `hOff`) |
| TileValid | `tileValid`: the 2 m cross windows over the nav grid's steep and wet cells |
| HasOwn / Blocked / ShapeOK / Placeable / Connections / CornerRule / Shape | same names |
| obstacle scan, tree count | `scanObstacles / trees / objectAt` (trees from the resource hash; buildings by their boxes; stones, bushes; solid scenery cells) |
| CalcWall / FindPath / GateFits | `calcWall / findPath / gateFits / calcGate` |
| BuildName / GfxName / PFMask | `buildName / partsOf (visualRel) / pfMask` |
| AddObj / RemoveObj / SetReady / tile update | `add / remove / setReady / refresh / update` |
| the server's PlaceWall (validate all tiles, then place; first tile Build, later tiles Q_Build) | `main.js G.placeWall` |
| the client's PreviewWall (tile ghosts, green / yellow, gate hints) | `ui/input.js wallPreview` |

* **Parts.** `pwexport/gsf.py` names every wall mesh by its part (crc32 of `x0`…`x47` and `<d><a-h>` with the state
  letter A–P) and writes it as the node's `part`; `engine/assets.js` keeps the component on the merged meshes and
  `engine/parts.js applyState` shows exactly the meshes whose component is in the piece's part list. The construction
  and damage states choose among the letters as for every other building.
* **Frame.** Wall pieces stand as the map's rotation 0 (`entities.js WALL_ROT` = `mapHeading(0)`), so the model's
  parts, pf boxes and look are the engine's own: part `3b` points east. (Until 2026-10-20 they stood turned by 0 -
  half a turn round - with the part names swapped back by (d + 4) & 7: the arms met, but every piece was mirrored, the
  stone side and the decoration on the wrong side; mission 1's walls.)
* **Pathfinding.** A wall piece's nav cells are the model's own `pf` boxes whose direction / hub bit is in its PFMask
  (`entities.js wallPfBoxes`); when its mask changes, units standing in the new boxes step out.
* **Old callers.** `WallMap.mask(i, j)` still returns the visual arms in the old direction order (r = (3 − d) & 7) for
  wall walking, ladders, the siege tower and the computer player; `line(a, b)` is the old raster for the computer
  player's ring plan (the ring is then built tile by tile through the same rules).

---------------------------------------------------------------------------------------------------------------

## 11. Address index (PWServer unless (C))
| function | address |
|---|---|
| CWallMap ctor / resize / SetWorld | 0x7e2090 / 0x7e2010 / 0x7dca90 |
| pos→tile / tile centre / edge pos | 0x7dc120 / 0x7dd040 / 0x7dd0f0 |
| level / edge level / TileValid | 0x7dc7f0 / 0x7dc860 / 0x7dc920 |
| write tile / clear tile / set blocked bit | 0x7dcb70 / 0x7dcc40 / 0x7dce80 |
| HasOwn / Blocked / ShapeOK / Placeable | 0x7dcd20 / 0x7dced0 / 0x7dd500 / 0x7de030 |
| Connections / CornerRule / Shape | 0x7dd250 / 0x7dc350 / 0x7dc3d0 |
| GateFits / SiegeDir | 0x7dd600 / 0x7dddd0 |
| class lookup / name / config load | 0x7de880 / 0x7df350 / 0x7df5d0 (InitWallClassMap 0x4900c0) |
| CalcWall core / FindPath / obstacle scan / OBB raster | 0x7e26c0 / 0x7e0730 / 0x7e2400 / 0x7e1a90 |
| tree count (forest layer) | 0x8db7d0 |
| undo begin / record / restore | 0x7e1950 / 0x7e1970 / 0x7e19d0 |
| GfxName / BuildName | 0x7e1730 ((C)0x5860f0) / 0x7df930 |
| PFMask | 0x7de2e0 |
| AddObj / RemoveObj / object re-snap / terrain sink | 0x7de950 / 0x7dee80 / 0x7df3a0 / 0x7e2120 |
| IsGateDiagonal | 0x7dc060 |
| CWallMapSrv vtbl 0x9eadd0: tile update / re-snap / remove-notify / tower link | 0x493940 / 0x490f10 / 0x4947e0 / 0x48e950 |
| CWallMapSrv methods (dispatcher 0x482539) | AddAdditionalEntrance 0x4941c0, GetFreeDockPos 0x48f3e0, GetGateConnectingWalls 0x491150, GetNextWalls 0x490ff0, InitWallClassMap 0x4900c0, RemoveAdditionalEntrance 0x494610, SetReady 0x48f880, WallClassChanged 0x48f3b0 |
| server PlaceWall / event caller / AI caller | 0x490920 / 0x44b61b / 0x4efb80 |
| script PlaceObj glue | 0x42c470 |
| (C) CalcWall / PreviewWall / ShowPlacement / dispatcher | 0x4f8950 / 0x4f9f70 / 0x4f8300 / 0x4ccab5 |
| (C) tile update (vtbl+4) / part apply / tile ghost / part table | 0x4f93a0 / 0x4f9100 / 0x4f9af0 / 0x4f8c50, 0x4f8230 |
| (C) render-mask flag setter | 0x4764d0 |
