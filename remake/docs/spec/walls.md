# Walls, gates, towers on the wall grid — spec

How the original ParaWorld places palisades, walls, gates, towers and traps, and what the remake must change to match.
Rules are cited as `file:line`. The WallMap itself (`CWallMapCln` / `CWallMapSrv`, `CalcWall`, `PreviewWall`,
`GetGateConnectingWalls`, …) lives in the C++ engine; it has been reverse-engineered from PWServer.exe / PWClient.exe
in **`walls_engine.md`** (cited as WE §n) and is ported 1:1 in `src/game/wallmap.js`. Where this spec once guessed
(`[?]`), the engine's rule now stands in its place.

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
* **The engine reads the table as name → (race, class 1-3, type)** (WE §1.3). Pieces of one owner and one race connect whatever their class; a gate takes the strongest class of its own tile and its wings (and that class's gate and price, WE §5.2); towers are no joints (WE §6.1).
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

  Measured from the parts of `hu_palisade`, `hu_small_wall` and `seas_fence`. The pieces are **named parts** (WE §3.3-3.4): a hub (`x0` diagonal, `x1` straight, `x2` generic, `x03`…`x47` the 135° bends) and one piece per direction `<d><a-f>` (arm end one level lower / same / higher, closed side, the free end of an `x2`). The engine builds the list of names from the connections (BuildName) and shows exactly those parts; the letters A–P after a name are the construction and damage states, not random variants.
* **Pathfinder boxes per arm.** The model's `pf` table has one box per arm. Box attribute bits 5-12 are the direction:

  | bit | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
  |---|---|---|---|---|---|---|---|---|
  | dir (GSF model space: x east, y south, like the map) | N | NE | E | SE | S | SW | W | NW |

  * Bit 15 is a 3.8 m hub box (always on). Bit 14 is a 6.9 m hub box: end pieces, lone posts and irregular junctions (WE §7). An L corner also blocks the diagonal between its arms, although no arm is drawn there.
  * Gates use the same bits as `COL_DIRECTION_MASK = bits 5..13` (B:2347), and the engine passes them to the pathfinder (B:2380-2381).

  This is how the engine makes a wall tile block only along its connected arms.
* **Direction numbering used by the engine** (ABG:292-305): 0 = NW (−,−), 1 = N, 2 = NE, 3 = E, 4 = SE, 5 = S, 6 = SW, 7 = W (map y runs south), which is clockwise starting from NW as seen from above.
* **Height and slopes.**
  * Walls and gates do *not* flatten the terrain: `AdaptTerrain` is skipped (SA:1327-1334).
  * After a terrain edit they are *not* re-snapped to the ground (SA:637-641).
  * The wall meshes reach about 12 m below their origin (part min z −11.9), as a foundation skirt that hides gaps on slopes.
  * Heights are quantised to 2 m levels; every wall-map object stands at its tile's level, and an arm end may lie at most one level above or below its piece (WE §4). A steeper step is no legal connection, so the tile cannot be placed.

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
* When `CalcWall` finds no valid line, the grid overlay is switched off and nothing is shown (PC:439). A line is **all or nothing**: a blocked end, or no way around an obstacle, gives no line at all (WE §2.3).
* There is a TODO in the code: "check resources for all tiles present" (PC:438).

### 3.3 Line shape
`CalcWall` (WE §2.3-2.6) scans the obstacles around the line (trees within 2.83 m or more than three within 9.9 m,
buildings, stones, solid scenery), then finds the **shortest path** from the start tile to the end tile over
placeable tiles (straight step 1, diagonal 1.414), only moving towards the end, with the provisional wall written in
as it goes, so that every tile on the way keeps a legal shape. The result is 8-connected and may bend around
obstacles; a 45° bend between a straight and a diagonal step is a legal 135° piece. Shipped maps show such mixed
lines (bfpw_highland: (180,292) → (188,300) → (188,308)).

### 3.4 Server side
* The engine first checks every tile of the list again (Placeable, in order; one failure places nothing), then turns `CEvt_PlaceWall` into one `CPlaceMgr.PlaceObj(owner, class, pos, rot, workers, queued, bWall = true)` call per new tile, start → end (SA:607-609, SA:1100, WE §8.3).
* Per tile:
  * There is **no place check**: the client's `CalcWall` result is trusted (SA:1160-1166).
  * `CheckConditionsAndPay` pays **the full cost of one segment** (SA:1304). Once the player is broke, the remaining tiles fail and are simply not created.
  * No terrain adaptation (SA:1327).
  * **Vegetation is removed**: DECO, BCRT (craters), VGTN and WOOD objects inside the tile radius, plus forest stumps (SA:1336-1357).
  * `BuildUp` starts. Every selected worker that can build gets `Build` on the first tile (`Q_Build` when Ctrl was held) and `Q_Build` on every later tile, in list order (SA:1361-1378, WE §8.3).
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

* **Joining is per tile and automatic** (WE §3). The WallMap decides which arms a tile shows, from the wall-map objects (walls, gates, towers, traps; `SetWallMapObj(true)` at B:2210, B:2408, B:1457, B:4299) in its 8 neighbour tiles. It sets the matching arm render flags and the pathfinder box mask.
  * When a tile is finished, re-owned or upgraded, the engine is told: `WallMap.SetReady` (B:2311-2321, B:2643-2647, B:1612-1615) and `WallClassChanged`.
  * Destruction also produces a WallMap event (`WCT_Destroyed`, CH:2166-2173). Units standing on the wall fall and take `height × 5` damage.
* Because a drag starts by snapping to a tile, starting or ending a line on an existing wall tile makes the new line share that tile. In shipped maps 140 of ~300 towers sit **on the same tile as a wall piece**: the tower stands on the piece, which keeps its arms; a tower alone is no joint (WE §6.1).
* **Corner rule** (WE §3.1). A diagonal arm is dropped when a straight neighbour next to it is connected, so an L corner never also draws the diagonal. Only the shapes end, straight, right angle, T, 135° bend and cross are legal, plus irregular flat junctions drawn with the generic hub; anything else makes the tile unplaceable.
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

### 5.2 Where a gate fits (WE §5)
* A gate stands on one tile (the shipped `NewGates` setting): the tile is empty or holds an own wall piece, and the
  tiles on both sides along an axis d hold **wall pieces** (of any owner; not gates). The axes are tried in the order
  d = 0..7 (NW–SE, N–S, NE–SW, E–W, …) and the first that fits wins.
* The flank tiles must be empty (a straight gate: the two perpendicular neighbours; a diagonal gate: the four
  straight neighbours), and the two wing tiles must lie at most two levels apart.
* The gate takes the **strongest class** of its tile and its wings, with that class's gate and price.
* It replaces the wall piece on its tile; its flank tiles stay blocked for wall-map objects while it stands.
* The model's local x runs along d. The AI keeps gates at least 24 m apart (ABG:136, ABG:308-327).

### 5.3 Gate geometry and wings
* A gate is centred on a tile: `bNewGate = x%8==4 && y%8==4` (B:2384).
  * Only such gates get the diagonal flags and wings (B:2385-2403).
  * Gates in old maps are centred on a tile *edge* or *corner* (x%8 or y%8 = 0) and span a 2-tile gap with walls at ±12 m. These are legacy editor gates without wings.
* **Model size.** Posts at ±5.6 m and end pieces at ±7.6…12 m, so the model is **24 m long** (`hu_palisade_gate`, `seas_gate`, `hu_small_wall_gate` pf boxes). A new gate visually covers its own tile and both wing tiles.
* **Diagonal gates.** `SetRndInvMaskSingleFlagInv(7 / 11, IsGateDiagonal)` (B:2387-2389, constants B:2342-2343): the two end pieces (render flags 7 and 11, at x = ∓9.7) show **only on a diagonal gate**, where they bridge the longer way to the wings (WE §5.4).
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
* A tower may stand on a free tile or on an own wall piece, which stays under it. Map data shows both: 158 free, 140 on a wall tile. Towers are one tile, never a line; not on gates or towers, and not below 16 m (WE §6.1).
* Traps are dragged as lines through the same path finder; a tile holds one trap, trap tiles block walls, and an enemy's (hidden) trap does not block an own trap (WE §6.2).

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
* **Trees and units.** The server deletes small vegetation, logs (WOOD) and stumps inside each tile's radius (SA:1336-1357). `CalcWall`'s obstacle scan blocks a tile with a standing tree within 2.83 m, more than three trees within 9.9 m, or its centre inside another object (WE §2.6). Units do not block; own units are pushed aside when construction starts (buildings.md §1.3).
* **Walls never leave a ruin model.** The corpse is skipped only for `CWall`; towers and gates do leave one (B:873).
* **Targeting.** Only `CWall` objects are ignored by auto-targeting unless prioritised (FO:4819). Towers rank first, CWall last (FO:752-772). Gates and traps count as normal buildings. A hit wall does not shout for help (B:336-340).
* **Placement materials** (SA:41-42, `SetMaterialFlagsNeg(4)`, `(7,true)`) exclude two terrain material classes for all placement [?]. Their meaning is not known.

---

## 7. The remake

| place | what |
|---|---|
| `src/game/wallmap.js` | the engine's WallMap, function by function (walls_engine.md §10) |
| `src/game/systems/construction.js` `placement`, `wallLine`, `startConstruction` | single tiles, lines, gates (class, wings, flank blocking), towers on pieces; no terrain adaptation for wall-map objects |
| `src/main.js` `G.placeWall` | the server's PlaceWall: all tiles checked, then placed in order; first tile Build, the rest queued |
| `src/ui/input.js` `wallPreview` | press–drag–release, Shift legs, Ctrl stays; tile ghosts with their parts: green (affordable / own), yellow (too dear), cyan (a gate would fit) |
| `src/game/entities.js` `setParts`, `wallPfBoxes`, `setGateEnds` | a piece's part list, nav boxes from the model's pf boxes, a gate's end pieces |
| `src/engine/parts.js` `applyState` | shows exactly the parts of the list (state letters by construction / damage) |
| `pwexport/gsf.py` | names the wall meshes by part |
| `src/game/systems/wallwalk.js`, `siege.js`, `ai/walls.js` | walking on walls, ladders, siege towers, the computer player's ring (walls_walk.md) |
| `tests/walls.js`, `wallwalk.js`, `ai_walls.js` | the rules above |
