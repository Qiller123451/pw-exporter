# Walls, gates, towers on the wall grid — spec

How the original ParaWorld places palisades, walls, gates, towers and traps, and what the remake must change to match.
Rules are cited as `file:line`. `[?]` marks a rule the scripts do not show: the WallMap (`CWallMapCln` / `CWallMapSrv`,
`CalcWall`, `PreviewWall`, `GetGateConnectingWalls`, …) lives in the C++ engine. Where a rule is `[?]`, the evidence
is given and a recommended behaviour follows.

Abbreviations (all under `Data/Base/Scripts/`):

| short | file |
|---|---|
| PC | `Game/controller/PlaceController.usl` |
| CB | `Game/UI/CommandBarEx/CommandBar.usl` · CBt = `Game/UI/CommandBarEx/CmdButton.usl` |
| B | `Server/classes/buildings/Building.usl` |
| SA | `Server/ServerApp.usl` (class `CPlaceMgr` from line 966) |
| BU | `Server/classes/task/BuildUp.usl` · BUB = `BuildUpBuilding.usl` · RP = `Repair.usl` · DW = `DockWall.usl` |
| CH | `Server/classes/character/character.usl` · FO = `Server/classes/FightingObj/FightingObj.usl` |
| WCC | `Server/init/wallclassconfig.txt` (WCX = `wallclassconfig_ex.txt`) |
| ABG / ABW | `Ai/tasks/AiTaskBuildGate.usl` / `Ai/tasks/AiTaskBuildWalls.usl` |
| TT | `/home/claude/pwr/techtree.json` (`StartTT/...`) |

Other evidence used:
* **Map data.** 66 shipped `.ula` maps were parsed with the remake's `maps/ula.js`. There are 463 pre-placed wall tiles, 67 gates and about 300 towers.
* **Model data.** The `pf` pathfinder boxes and part geometry of the wall `.glb` files in `dist/assets/models`.

---

## 1. Object classes and wall classes

### 1.1 What uses the wall placer
The client uses the wall placement path for **every** object whose TT entry has `wall=1` (PC:135, PC:165-168). That covers more than walls:

| tribe | `wall=1` objects (TT `Objects/<T>/BLDG/*`) | script class |
|---|---|---|
| Hu | hu_palisade, hu_small_wall, hu_re_enforced_wall | CWall (`Server/classes/buildings/hu_walls.txt:2-55`) |
| Hu | hu_bunker, hu_small_tower, hu_large_tower | CBunker / CTower |
| Aje | aje_bone_palisade, aje_clay_wall | CWall (`aje_walls.txt`) |
| Aje | aje_small_tower, aje_medium_tower, aje_tesla_tower | CTower / CTeslaTower |
| Ninigi | ninigi_defense_skewer (CNinigi_Defense_Skewer ⊂ CWall), ninigi_palisade (CWall) | `ninigi_walls.txt` |
| Ninigi | ninigi_small_tower, ninigi_smoke_tower, ninigi_telescope_tower | CTower… |
| Ninigi | ninigi_pitfall, ninigi_snare_trap, ninigi_resin_field, ninigi_minefield, ninigi_poison_trap | CTrap subclasses |
| SEAS | seas_fence (CWall), seas_turret_tower | `seas_walls.txt` |

Gates have `gate=1` and `wall=0`: hu_palisade_gate, hu_small_wall_gate, hu_re_enforced_wall_gate, aje_bone_palisade_gate,
aje_clay_wall_gate, ninigi_defense_skewer_gate (CNinigi_Defense_Skewer_Gate ⊂ CGate), ninigi_palisade_gate, seas_gate
(all CGate). `hu_ladder` also has `gate=1` and uses the gate path through a hack (PC:488-498, §4.5).

The client tells towers apart by asking the WallMap for the class type `WC_Tower` (PC:149-150).

### 1.2 Wall class table (WCC, loaded by `InitWallClassMap`, SA:43)
Each tribe has "wall classes" that pair one wall, one gate and one tower (WCC:2-66, WCX:1-122):

| race | class 0 | class 1 | class 2 |
|---|---|---|---|
| Hu (Race_0) | hu_palisade / hu_palisade_gate / hu_bunker | hu_small_wall (walkable) / hu_small_wall_gate / hu_small_tower | hu_re_enforced_wall (walkable) / hu_re_enforced_wall_gate / hu_large_tower |
| Aje (Race_1) | aje_bone_palisade / aje_bone_palisade_gate / aje_small_tower | aje_clay_wall (walkable) / aje_clay_wall_gate / aje_medium_tower | — / — / aje_tesla_tower |
| Ninigi (Race_2) | ninigi_defense_skewer / _gate / ninigi_small_tower | ninigi_palisade (walkable) / ninigi_palisade_gate / ninigi_smoke_tower | — / — / ninigi_telescope_tower |
| SEAS (Race_3) | seas_fence / seas_gate / seas_turret_tower | | |
| Traps | ninigi_pitfall, snare_trap, resin_field, minefield, poison_trap (WCC:68-74) | | |

* `walkable = 1` walls can be walked on: units climb up by ladder, siege tower or brachiosaurus (DW:79-1107; `CH:1945-1951`: "Use" on an own wall walks onto it). The palisade-tier walls (hu_palisade, aje_bone_palisade, ninigi_defense_skewer, seas_fence) are not walkable.
* **[?] The engine probably uses the table to pair gates with walls.** A gate of class N would only fit a wall of class N, and towers of the same class would join a wall line. The scripts never read the table themselves.
* Hu wall upgrades (palisade → small wall → re_enforced) change the gfx of every existing segment and gate in place: `WallMap.WallClassChanged(obj, gfx)` (B:2296-2309, B:2458-2482). See `docs/spec/buildings.md` §1.9.

---

## 2. The wall grid

* **Tile pitch 8 m. Tile centres sit at `x ≡ 4, y ≡ 4 (mod 8)` in original map coordinates.**
  * All 463 pre-placed wall tiles in the shipped maps lie on this grid, and every one has rotation 0.
  * All ~300 towers lie on the same grid (mostly rotation 0).
  * Player-placed gates must also sit at `x%8==4 && y%8==4` (B:2384, §4).
* **Wall tiles never rotate.** A tile is a *hub* with up to 8 *arms*, one towards each of the 8 neighbour tiles (E, NE, N, NW, W, SW, S, SE). Each arm reaches the edge between tiles:
  * straight arms reach 4.09 m;
  * diagonal arms reach 5.73 m, which is half of 8√2 = 11.31 m.

  Measured from the parts of `hu_palisade`, `hu_small_wall` and `seas_fence`. Each arm has **4 geometry variants** and the hub has several post variants. [?] The engine probably picks one variant at random for variety, because the variants carry identical attribute bits.
* **Pathfinder boxes per arm.** The model's `pf` table has one box per arm. Box attribute bits 5-12 are the direction:

  | bit | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
  |---|---|---|---|---|---|---|---|---|
  | dir (GSF model space: x east, y north) | S | SE | E | NE | N | NW | W | SW |

  * Bit 15 is a 3.8 m hub box. Bit 14 is a 6.9 m hub box [?]; for walls its use is unknown.
  * Gates use the same bits as `COL_DIRECTION_MASK = bits 5..13` (B:2347), and the engine passes them to the pathfinder (B:2380-2381).

  This is how the engine makes a wall tile block only along its connected arms.
* **Direction numbering used by the engine** (ABG:292-305): 0 = SW (−,−), 1 = S, 2 = SE, 3 = E, 4 = NE, 5 = N, 6 = NW, 7 = W, which is counter-clockwise starting from SW.
* **Height and slopes.**
  * Walls and gates do *not* flatten the terrain: `AdaptTerrain` is skipped (SA:1327-1334).
  * After a terrain edit they are *not* re-snapped to the ground (SA:637-641).
  * The wall meshes reach about 12 m below their origin (part min z −11.9), as a foundation skirt that hides gaps on slopes.
  * The maximum slope is not known [?] (it is the engine's `CalcWall`).

---

## 3. Dragging a wall line (client, PC)

### 3.1 Input state machine
1. **Entering placement mode.** Clicking the build button calls `SetResNumPossible(n)` and then `SetClass(class, ttPath)` (CBt:1167-1168).
   * For `wall=1` objects no ghost model is created. The WallMap grid overlay is switched on (PC:165-168).
   * `n` = the number of segments the player can afford: `min over resources of floor(stock / cost)`, capped at 1000 (CB:2436-2461).
2. **Hover.** Until the left button goes down, the line start follows the cursor (PC:267-269).
   * Every frame `Render → AddWall()` runs `CalcWall(start, cursor)` (PC:84-94, PC:431-437).
   * Before the press, start equals cursor, so the preview is a **single tile** snapped under the cursor.
3. **LMB down** fixes the start point (`m_vPlacement`, `m_bPlaceBegin = true`, PC:234-236).
4. **Drag.** The line is recomputed on every mouse move: `CalcWall(-1, class, start, cursor, m_xWall, m_iNumTilesHold)` (PC:437).
5. **LMB up**:
   * **without Shift**: `PlaceWall(ctrl)` sends `CEvt_PlaceWall(tiles, selection, queued = ctrl)` (PC:270-277, PC:459-463). Placement mode ends unless **Ctrl** is held (PC:274).
   * **with Shift**: nothing is placed. The current tiles are frozen (`m_iNumTilesHold = NumTiles()`) and a new leg starts at the release point (PC:278-281). `m_bPlaceBegin` stays true, so the next leg follows the mouse without holding the button. The next plain release places the whole **polyline** in one go.
6. **RMB up** cancels (PC:240-242).
7. **Towers** (`WC_Tower`): Shift is turned into Ctrl (PC:225-227). There is no polyline; Shift keeps placing more towers.
8. There is **no rotation** in wall mode. Rotation (Shift+drag, 16 steps of 22.5°) only exists in the non-wall branch (PC:245-255, PC:329-349).

### 3.2 Preview
* `PreviewWall(tiles, gfx, green, n, yellow)` draws the line (PC:442). The first `n` affordable tiles are **green**; the tiles beyond what the player can pay for are **yellow**. `ShowPlacement` marks the cursor tile (PC:444).
* When `CalcWall` finds no valid line, the grid overlay is switched off and nothing is shown (PC:439). [?] Whether a blocked tile cuts the line short or invalidates all of it is decided inside `CalcWall`.
* There is a TODO in the code: "check resources for all tiles present" (PC:438).

### 3.3 Line shape [?]
`CalcWall` is engine code. What is known:
* Tiles are 8-connected (8 arm directions). A line is therefore made of straight (8 m) and diagonal (11.31 m) steps.
* The ObjBrush names `*_End`, `*_Mid`, `*_Diag`, `*_Gate` are the editor's piece kinds: end tile (1 neighbour), straight middle, diagonal, gate. They are not separate classes. One gfx contains all of them.
* Shipped maps contain mixed lines. Example from bfpw_highland: (180,292) → (188,300) → (188,308) is a diagonal step followed by a straight one.

**Recommendation:** snap start and end to tile centres, then rasterise with a Chebyshev DDA. That gives `max(|Δi|,|Δj|)+1` tiles, with diagonal and straight steps mixed as in Bresenham.

### 3.4 Server side
* The engine turns `CEvt_PlaceWall` into one `CPlaceMgr.PlaceObj(owner, class, pos, rot, workers, queued, bWall = true)` call per tile (SA:607-609, SA:1100). [?] Iteration order is probably start → end.
* Per tile:
  * There is **no place check**: the client's `CalcWall` result is trusted (SA:1160-1166).
  * `CheckConditionsAndPay` pays **the full cost of one segment** (SA:1304). Once the player is broke, the remaining tiles fail and are simply not created.
  * No terrain adaptation (SA:1327).
  * **Vegetation is removed**: DECO, BCRT (craters), VGTN and WOOD objects inside the tile radius, plus forest stumps (SA:1336-1357).
  * `BuildUp` starts. Every selected worker that can build gets `Build`, or `Q_Build` when Ctrl was held (SA:1361-1378). [?] With plain `Build` each new tile overrides the previous order, so the workers probably walk to the last tile created first and then chain (§6).
  * The tile joins a per-player list. 0.15 s after the last tile, `CalculateWalls` gives each tile a **BuildVector**: a stand point about 4 m out on the builders' side, rotated along the line (SA:987-1084, SA:1320-1324).
* Cost per segment, per tile (TT `Actions/<T>/Build/BLDG/<class>`):

| wall | f/w/s | build s | HP |
|---|---|---|---|
| hu_palisade | 0/20/20 | 10 | 6000 |
| hu_small_wall | 0/25/25 | 15 | 12000 |
| hu_re_enforced_wall | 0/30/30 | 20 | 18000 |
| aje_bone_palisade | 0/20/20 | 10 | 5000 |
| aje_clay_wall | 0/30/40 | 22 | 15000 |
| ninigi_defense_skewer | 0/25/15 | 10 | 4500 |
| ninigi_palisade | 0/40/30 | 22 | 15000 |
| seas_fence | 0/25/40 | 15 | 10000 |

* **Length limits.** The player is limited only by resources: `n` is capped at 1000 (CB:2436). The AI builds at most 10 tiles per batch (ABW:26).

---

## 4. Joining, docking and neighbour updates

* **Joining is per tile and automatic [?].** The WallMap decides which arms a tile shows, from the wall-map objects (walls, gates, towers, traps; `SetWallMapObj(true)` at B:2210, B:2408, B:1457, B:4299) in its 8 neighbour tiles. It sets the matching arm render flags and the pathfinder box mask.
  * When a tile is finished, re-owned or upgraded, the engine is told: `WallMap.SetReady` (B:2311-2321, B:2643-2647, B:1612-1615) and `WallClassChanged`.
  * Destruction also produces a WallMap event (`WCT_Destroyed`, CH:2166-2173). Units standing on the wall fall and take `height × 5` damage.
* Because a drag starts by snapping to a tile, starting or ending a line on an existing wall tile or tower makes the new line share that tile. In shipped maps 140 of ~300 towers sit **on the same tile as a wall object**: a tower is a joint inside a wall line.
* **[?] Corner rule.** In day77 every diagonal neighbour pair also has an orthogonal corner tile (43 of 43 cases). The engine must therefore avoid drawing a diagonal arm across an L corner. **Recommendation:** connect two diagonal neighbours only when neither of the two shared orthogonal tiles holds a wall-map object. Never draw two crossing diagonals.
* **"Docking" is not about joining walls.**
  * `DockWall.usl` covers siege objects attaching to a wall so units can climb it:
    * `CDockWall`: transport, siege tower and brachiosaurus dock at `WallMap.GetFreeDockPos` and add an extra wall entrance (DW:49-60, DW:156-296);
    * `CBuildLadder`: hu_ladder, 20 wood (DW:328-455);
    * climb and leave tasks.
  * `Vehicle.Dock2Wall` still has "TODO: check the wall is walkable" (Vehicle.usl:525-528).

---

## 5. Gates

### 5.1 Placement (client)
* A gate has a ghost model, but **rotation is disabled** (PC:330). The ghost is re-created on every mouse move (PC:354-358).
* Validity check: `CalcWall(-1, gateClass, cursor, cursor, m_xWall)`, a single-tile wall calculation at the cursor (PC:389-397). When found, `PreviewWall` draws the gate **snapped and oriented by the WallMap** in green. Otherwise the ghost turns red.
* LMB up sends `CEvt_PlaceWall(m_xWall, …)`, the same event as walls (PC:486-504). Placement mode stays active after a failed attempt (PC:259-262).
* Server: gates skip the place check and terrain adaptation, then pay the full gate cost (SA:1143, SA:1160, SA:1304, SA:1327).
* An old client snapped the gate to the 8 m grid and asked `WallMap.GetValidGatePos`. That code is commented out (PC:398-405, PC:570-574).

### 5.2 Gates go into an existing wall [?]
Evidence:
1. `hu_ladder` uses the gate path, and `WallMap.GetWall(m_xWall)` returns *the existing wall* under the gate calculation (PC:488-491).
2. A new gate looks up its left and right wall right away: `GetGateConnectingWalls(this, L, R)` (B:2393).
3. The AI builds the wall first, then asks `GetFirstValidGatePoint(class, wallDef)` *on that wall* (ABG:281-289) and keeps gates at least 24 m apart (ABG:136, ABG:308-327).
4. Map data: every tile-centred ("new") gate has its own tile free of walls and **wall tiles at ±8 m on both sides along its axis** (24 cases; diagonal gates have them at ±(8,8)).

**Rule:**
* The gate is placed on a tile of an own, straight wall run, with neighbours on two opposite sides (E–W, N–S, NE–SW or NW–SE).
* It **replaces that one wall tile** and takes the run's axis as its orientation. Diagonal gates are allowed.
* [?] The gate class probably has to match the wall class (WCC).
* [?] No refund is known for the replaced tile.

### 5.3 Gate geometry and wings
* A gate is centred on a tile: `bNewGate = x%8==4 && y%8==4` (B:2384).
  * Only such gates get the diagonal flags and wings (B:2385-2403).
  * Gates in old maps are centred on a tile *edge* or *corner* (x%8 or y%8 = 0) and span a 2-tile gap with walls at ±12 m. These are legacy editor gates without wings.
* **Model size.** Posts at ±5.6 m and end pieces at ±7.6…12 m, so the model is **24 m long** (`hu_palisade_gate`, `seas_gate`, `hu_small_wall_gate` pf boxes). A new gate visually covers its own tile and both wing tiles.
* **Diagonal gates.** `WallMap.IsGateDiagonal` → render flags 11 and 7 are hidden (B:2387-2389, constants B:2342-2343). This drops the two straight end pieces (pf bits 11 and 7 sit at x = ∓9.7). [?] The constant names OST/WEST are swapped relative to the model axis.
* **Wings.** L and R are the neighbouring wall tiles. Each calls `SetParentGate(gate)`, which makes it a *grouped child* of the gate, so clicking it selects the gate (B:2231-2237, B:2393-2401).
  * All damage a wing takes is forwarded to the gate (B:2266-2270).
  * A wall can have **up to 4 parent gates**, one per axis through its hub (B:2242).
  * Deleting the gate releases the wings (B:2363-2373).
  * Saved in chunk `Gaba` v3 (B:2446-2456).
* **Gate costs:**

| gate | f/w/s | build s | HP |
|---|---|---|---|
| hu_palisade_gate | 0/40/40 | 20 | 5500 |
| hu_small_wall_gate | 0/50/50 | 30 | 11000 |
| hu_re_enforced_wall_gate | 0/60/60 | 40 | 17000 |
| aje_bone_palisade_gate | 0/40/40 | 20 | 4500 |
| aje_clay_wall_gate | 0/60/80 | 35 | 14000 |
| ninigi_defense_skewer_gate | 0/50/30 | 20 | 4300 |
| ninigi_palisade_gate | 0/80/60 | 35 | 14000 |
| seas_gate | 0/50/80 | 25 | 9000 |

* Gate states, the auto gate and lockpicking are covered in `docs/spec/buildings.md` §2.2.

### 5.4 Towers and traps
* Towers and traps are placed through the same wall placer, snapped to tile centres with no rotation (§3.1).
* A tower may stand on a free tile or on an own wall tile. Map data shows both: 158 free, 140 on a wall tile.
* [?] Traps follow the same tile snapping; a tile holds one trap.

### 5.5 hu_ladder
Hu workers target an enemy wall with the hidden `hu_ladder` action. The client resolves the wall under the cursor through the gate calculation (PC:488-498). The server builds the ladder at a free dock position (DW:381-455). See buildings.md §2.4.

---

## 6. Building order, repair, terrain and other rules
* **Who builds.** Every selected builder gets Build or Q_Build per tile (SA:1363-1378).
  * A worker stands at the tile's BuildVector, or at the pathfinder's `GetWallAccessPos` when the straight line to it is blocked.
  * A tile is unreachable when the access point is farther than `max(1.5 × collision radius, 9 m)` (BU:225-239).
* **Chaining.** When a tile is done, the worker takes the **nearest unfinished wall or gate within 50 m of the worker's own position**, sorted by distance. It skips tiles it already finished or gave up on (BU:413-440).
  * Plain buildings, and probably towers, are not part of the chain [?]. `GetNextWalls` and `GetNextGates` are wall-map queries.
* **Repair** chains the same way, over own, ready, damaged walls and gates within 50 m (RP:394-420). Repairs start at `GetWallAccessPos` (RP:241-242).
* **Build time.** Each tile is a normal construction (BUB:139, BUB:384-391; formula in buildings.md §1.3).
* **Trees and units.** The server deletes small vegetation, logs (WOOD) and stumps inside each tile's radius (SA:1336-1357). [?] Whether `CalcWall` rejects tiles on standing trees, other buildings or units is engine code. **Recommendation:** treat trees, buildings, enemy units and resources as blocking a tile, as the normal place check does. Own units are pushed aside when construction starts (buildings.md §1.3).
* **Walls never leave a ruin model.** The corpse is skipped only for `CWall`; towers and gates do leave one (B:873).
* **Targeting.** Only `CWall` objects are ignored by auto-targeting unless prioritised (FO:4819). Towers rank first, CWall last (FO:752-772). Gates and traps count as normal buildings. A hit wall does not shout for help (B:336-340).
* **Placement materials** (SA:41-42, `SetMaterialFlagsNeg(4)`, `(7,true)`) exclude two terrain material classes for all placement [?]. Their meaning is not known.

---

## 7. Remake today (as of this spec)

| place | behaviour | original |
|---|---|---|
| `src/game/rules.js:85` | `def.wall = TT wall=1`, so towers and traps are "walls" | the TT flag only means "use the wall placer"; the segment class is CWall |
| `src/ui/input.js:332-338` | wall = two separate clicks (start, then end) | press-drag-release; Shift-release adds a corner; Ctrl keeps the mode; RMB cancels |
| `src/ui/input.js:397, 404-423` | one ghost model, rotated toward the cursor, no per-tile preview, no affordability colours | one preview per tile, green/yellow by `n`, grid overlay, no rotation |
| `construction.js:154-165` `wallLine` | `round(L/8)+1` points spread evenly along the raw line, any angle, no grid; spacing is not 8 m; each point rotated to the line | tiles on the 8 m grid (centres ≡4 mod 8), 8-connected, tiles never rotated |
| `construction.js:36-50` `canPlace` | a 7.8 × 3.2 box (`WALL_BOXES`, `entities.js:379`) rotated per point; existing walls block, so lines cannot share or join tiles | tile-based; joins existing tiles and towers |
| `main.js:481-492` `G.placeWall` | workers only on the first segment; stops at the first error | every builder ordered per tile (Build/Q_Build); unaffordable tiles skipped |
| `assets.js:62-81` `trimWallArms`, `main.js:101-111` | keeps the hub and the E/W arms (all 4 variants stacked); applied to **every `def.wall` gfx, including towers and traps** | arms shown per connected neighbour, 1 variant each; towers untouched |
| gates (`input.js:368-371`, `canPlace`) | free building with free rotation; wall cells block it, so a gate cannot be put into a wall | snaps into an own wall run, replaces one tile, oriented by the run, gets wings |
| `construction.js:245-247` `autoWork` | first unfinished `def.wall`/`def.gate` within 50 m of the *finished building* (array order) | nearest unfinished wall/gate within 50 m of the *worker*, sorted |
| `combat.js:23` `isWall` | `def.wall \|\| def.gate`: towers, traps and gates are skipped as auto-targets (`:101`) and do not shout (`:404`) | only CWall is skipped |
| `construction.js:346` ruins | no ruin for `def.wall`, so towers and traps get none either | no ruin only for CWall |

---

## 8. Changes the remake needs, function by function

1. **`rules.js` `def()` (:80-92).** Add `wallKind`:
   * `'wall'` for script CWall / CNinigi_Defense_Skewer;
   * `'gate'` for CGate and subclasses;
   * `'tower'` for the WCC tower list / CTower family;
   * `'trap'` for CTrap subclasses.

   Keep `wall` as "uses the wall placer". Add a `WALL_CLASSES` table from WCC (wall/gate/tower per tribe class, `walkable`).
2. **New `game/wallmap.js`.**
   * Grid helpers in *original* map coordinates. Tile centre `≡ 4 (mod 8)`; for original maps use `mx = gx + ox`, `my = oy − gz` from `maps/source.js:66-69`; for the generated map use any 8 m-aligned origin. Functions: `tileAt(x,z)`, `tileCentre(i,j)`.
   * `Map<tileKey, {wall, tower, gate, trap}>`.
   * `neighbours(tile)`.
   * `armMask(tile)`: 8 bits, with the corner rule from §4.
   * `rasterise(a, b)`: Chebyshev DDA.
   * `update(tile)`: recompute the masks of the tile and its 8 neighbours, refresh visuals and nav cells.
3. **`construction.js` `wallLine(p, action, x0,z0, x1,z1, held=[])`.** Snap both ends to tiles and rasterise. Append to `held` (polyline legs). For each tile:
   * an own wall of the same wall class already there → `{existing:true}` (no cost);
   * blocked (other building, tree, resource, enemy unit, outside map, unexplored) → `bad`;
   * otherwise `ok`.

   Mark tiles beyond `affordable = min floor(stock/cost)` as `yellow`. Return the tiles with `rot = 0`.
4. **`construction.js` `canPlace` / `footprint`.**
   * Wall tiles: nav cells = the hub box plus the arm boxes of the *current* arm mask, taken from the model `pf` table (bits 5-12 = S, SE, E, NE, N, NW, W, SW; bit 15 = hub). This replaces `WALL_BOXES` (`entities.js:377-379`).
   * Towers and traps: normal footprint, but snapped to the tile centre with rot 0. Allow them on an own wall tile.
5. **`construction.js` `startConstruction`.** Wall-placer objects: force the tile centre and rot 0, register in the WallMap, call `wallmap.update`. Remove trees, stumps and logs inside the tile radius (SA:1336-1357). Pay per tile and skip silently when the player cannot pay.
6. **New `construction.js` `placeGate(p, action, x, z, workers)`.**
   * Find the tile under the cursor. It must hold an own CWall (matching class [?]) whose neighbours on opposite sides along one axis are wall-map objects.
   * Remove that wall tile (no refund [?]), create the gate at the tile centre, rotation = axis (0/45/90/135°).
   * Set `gate.wings = [L, R]` and `wall.parentGates`. Forward wing damage to the gate (B:2266-2270). Make a wing click select the gate.
   * When the gate dies, clear `parentGates`.
   * Gate nav blocking: posts plus door box per state (pf bits 14/15/16); `nav.gateAt` stays as it is.
7. **`input.js` `modeClick` / mouse handlers (:326-339).**
   * Walls:
     * mousedown sets the start;
     * mousemove recomputes `wallLine` and shows one ghost per tile (green, yellow, red);
     * mouseup places, or with Shift adds a corner (`held = tiles`, start = release tile, keep following the mouse until the next click);
     * Ctrl keeps the mode;
     * right button cancels.
   * Towers: snap to the tile, no rotation, Shift acts like Ctrl.
   * Gates: snap with `placeGate`'s validity test, no rotation.
8. **`input.js` `makeGhost` / `updateGhost` (:386-423).** In wall mode, use a pool of tile ghosts built from the hub plus the arms of the mask they *would* have. Show a grid overlay if wanted. Skip `gh.rot` for every wall-placer object and every gate.
9. **`main.js` `G.placeWall` (:481-492).** Place the tiles in order (start → end), with the polyline held tiles first. Give every builder `build` on the first new tile; with Shift/Ctrl, queue each tile. Feedback: "Not enough resources" once when tiles are skipped.
10. **`assets.js` `trimWallArms` (:62-81) → `splitWallArms(root)`.**
    * Classify the meshes by angle into 8 arm groups plus the hub. Mesh centre farther than 1.2 m from the origin = arm; bin `atan2` to 45°.
    * Keep 1 of the 4 variants per arm, chosen by a hash of the tile.
    * At runtime toggle `arm[d].visible` from the mask.
    * Gates: hide the end pieces carrying flags 7/11 when diagonal (B:2388-2389).
11. **`main.js:101-111`.** Apply the arm splitting only to `wallKind === 'wall'` gfx, not to towers and traps.
12. **`entities.js` building (:424, :515).** For walls, read `boxes` from the WallMap mask and rebuild the nav cells on `wallmap.update`.
13. **`construction.js` `autoWork` (:245-247).** For wall and gate tiles, pick the *nearest* unfinished `wallKind ∈ {wall, gate}` within 50 m of **the worker**, excluding ones already done. Keep the old fallback for other buildings.
14. **`construction.js` `repairUpdate` (:265-270).** The same nearest-first rule for walls and gates within 50 m of the worker.
15. **`construction.js` `destroyed` (:346).** A ruin for everything except `wallKind === 'wall'`. Call `wallmap.update` around the tile. A dying gate releases its wings.
16. **`combat.js` `isWall` (:23).** `wallKind === 'wall'` only. Gates and traps rank as normal buildings; towers keep rank 1.
17. **Pre-placed walls from `.ula` maps** (`maps/source.js`). Register them in the WallMap when the map loads, so their arms connect. They already sit on the ≡4 grid with rot 0. Old edge-centred gates keep their stored position and have no wings.
18. **Out of scope / later:** walking on walkable walls, ladders, siege towers docking (DW), and falling damage when a wall dies under units (CH:2166-2173).
