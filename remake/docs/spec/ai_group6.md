# AI group 6 — walls, outposts, trade, ships, chat, items (gap analysis and plan; done: see COMPUTER_PLAYER.md)

Compares the original script AI with the remake's port and plans the missing parts. Companion to
[ai.md](ai.md) (the study of the original) and [../COMPUTER_PLAYER.md](../COMPUTER_PLAYER.md) (the port).

**Sources.** Original: `Data/Base/Scripts/Ai/` (the path is `Scripts/Ai`, not `Scripts/Server/Ai`). BoosterPack1,
BoosterPack3, MIRAGE and Wintermod have **no AI scripts**: MIRAGE only adds `Scripts/Server/settings/techtree/_AI_ObjectData.txt`.
The settings folders of this installation hold only `Aje/` and `SEAS/`. The Hu and Ninigi army tables (`EmptyOutpost`,
`OP_ResAll`, `FindItem_1`, `ShipAttack_n` …) are missing, so the remake needs fallbacks for them (as it already has for
squads, `attack.js fallbackArmy`).

**Conventions.** One tick = 0.2 s. `W` = `CM.GetDifficultyInt()`, the control wait: 100/75/50 (Easy), 30/25/20
(Medium), 16/14/12/10 (Hard) (CM:164-180). Nearly every goal thinks every `W + iType` ticks, where
`iType = 1 + rnd(numPlayers + 1)`. `[?engine]` = C++ code the scripts call but do not show.

Abbreviations (files under `Scripts/Ai/` unless noted):

| short | file | short | file |
|---|---|---|---|
| VW | goals/AiGoalBuildVillageWalls.usl | TBW / TBG / TBT | tasks/AiTaskBuildWalls / BuildGate / BuildTowers.usl |
| GBT | goals/AiGoalBuildTowers.usl | KE | goals/AiGoalKillEnclosedWorker.usl |
| DM / CM / EM / FM / AM | Modules/AiModuleDefense / Control / Economy / Fight / Area Default.usl | UM | misc/AiUtilityMgr.usl |
| BO | goals/AiGoalBuildOutpost.usl | IS | goals/AiGoalIslandSurveillance.usl |
| BA | goals/AiGoalBuildArmy.usl | MP | goals/AiGoalManageMarketPlaces.usl |
| AS | goals/AiGoalAttackShips.usl | WC | goals/AiGoalWatercrossing.usl |
| GA | goals/AiGoalGeneralAttack.usl | DA | goals/AiGoalDisturbAttack.usl |
| DO | goals/AiGoalDefendOutpost.usl | GV | goals/AiGoalGuardVillage.usl |
| CS | goals/AiGoalCoopSupportAttack.usl | MB | goals/AiGoalBuildMineBelts.usl |
| GI / IA | goals/AiGoalGetItem.usl / AiGoalItemAttack.usl | AO | tasks/AiTaskAttackObject.usl |
| ChW / DiW | `Scripts/Game/UI/ChatWindow.usl` / `DiplomacyWindow.usl` | NT | `locale/uk/Texts/newsticker_uk.ltf` |

## 0. Summary

| # | Feature | Original entry points | Remake today | Gap |
|---|---|---|---|---|
| 1 | Village walls, gates, towers, archers on walls | DM:671-685 → VW (+TBW, TBG, TBT), KE | none: `brain.command` only stores `upgrade_walls`, `close_start_location`, `village_wall` | **large** |
| 2 | Outposts | IS (`OP_ResAll`), BA (`AttackOutpost`), MP (`EmptyOutpost`), FM:918 (campaign) → EM:377 → BO | none: `startAttack` returns null for the outpost types | **large** |
| 3 | Trade | EM:527-537 → MP (Schnecke, deathmatch) | trade carts exist (`systems/economy.js`); the AI never uses them | **medium** (needs 2) |
| 4 | Ships / naval | DA:1534 → AS; GA:236-365 → AM → WC; MB; IS touries | harbour, fishing, counter-warships, spawned landings of scripted waves | **large** |
| 5 | Chat with allies | GV:615-633 (CryForHelp); CM:614-731 (answers to "AIn:" requests) | no chat input, no tribute; `msg` events + `hud.message` exist | **medium** (mostly UI) |
| 6 | Items | DA:574, 633-681 → GI; AO:1056, 1496-1526; FM:923-940 → IA | item system and the `pickup` order exist; the AI never picks anything up | **small** |

---
## 1. Village walls, gates, towers, archers on walls

### 1a. Original
**Activation**
- DM.Think (DM:672-685) adds the VillageWalls goal once, with priority 100, when all of these hold:
  - the epoch is ≥ 3;
  - the level is not `Single 02`;
  - the game type is not `Defender`;
  - the map's AI option `walls` is set (`m_bWalls = Sensor.GetWalls()`, DM:141).
- The goal thinks every `W + iType + 50` ticks (VW:91-95), about 12-30 s.
- The goal only builds a ring when `m_bCloseStartLocation` is set (VW:733), that is, with the behaviour command
  `close_start_location 1`:
  - **Giraffe, Schnecke and Turtle set it, together with `upgrade_walls 1`** (CM:346-348, 372-374, 423-425).
  - Dodo, FightOnly and all `Singleplayer_*` behaviours set it to 0 (CM:321-323, 400-402, 449-509).
  - A Dodo builds no walls at all, except through the module call `village_wall 2 <min> <max> <region>`
    (DM:626-641), which no shipped campaign uses.
- `AIAssistDef_0` turns walls off: `EnableWallplacer(false)` and `deactivate_walls` (CM:526-528).

**Wall classes and upgrades** (VW:97-117, 310-424)
- The class lists, worst to best:
  - Hu: palisade, small_wall, re_enforced_wall;
  - Aje: bone_palisade, clay_wall;
  - Ninigi: defense_skewer, palisade;
  - SEAS: fence.
- `UpdateBestWallClass` picks the highest class whose tech-tree solution is *possible and visible*.
- If the NPC `mayor_s0` (level 3 or 4) is owned, Aje are forced to clay_wall and Ninigi to palisade (VW:320-326).
- With no buildable class, `UpgradeWalls()` asks the economy to *prepare* class 0, i.e. research its
  prerequisites (VW:402-424, `SetPrepare(true)` [?engine]).
- After the first wall is built, and if `upgrade_walls 1`, it asks to prepare the next class (VW:764-765).
- Walls that already stand are never replaced. Only new segments use the better class.

**Ring planning (engine)**
1. On the first `BuildWallsAroundPlace` with epoch ≥ 3 and `WallPlacer.CanBuildWall()`:
   `WallPlacer.Update()`, then all pending wall tasks are killed (VW:265-272).
2. The ring centre is the centre of the area with the highest `InflBuild` value, or of `Infl` if that is ≤ 0
   (VW:734-751).
3. `Sensor.FindWallNear(class, player, centre, min 1, max 10000)` returns one *wall definition*: a start-end segment
   of the ring around the village (VW:280) [?engine: the placer decides the ring shape, its distance from the
   buildings, and its segmentation].
4. When a village-wall task ends, the next segment is requested at once (VW:527-531).
   - `m_bHasClosedStartLocation` is never set, so the goal asks until `FindWallNear` returns null.
   - On a null it sets the centre to -1, and the next think recomputes the centre and tries again.

**Segment task (TBW)**
- Think wait: 30 / 20 / 10 + r ticks by class (TBW:101-110).
- Batch size = min over the resources of floor(unlocked stock / cost per tile). A batch below 1 becomes 3, and the
  cap is 10 tiles (TBW:264-294). Resources stay locked per batch.
- Start (TBW:315-338):
  - It allocates workers: `TryAllocate(sol, outpost 0, 10, true)` [?engine: up to 10 subjects?].
  - It runs `UM.CheckForEnemy(start of segment)` (UM:615-702). If an enemy unit, building or ship of an enemy
    player is within 60 m of the start, or (on skirmish maps) a hostile wild animal or nest, it requests an
    attack on them and aborts:
    - `siege` if they are mostly buildings, else `suicide`;
    - with risk 100 and `AT_NotPresent`.
- `BuildWallOnLine(wallDef, class, workers, maxTiles)` places the tiles [?engine].
  - -1 means the segment is complete: `OnWallCompleted`.
  - 0 means nothing was placed. The task then aborts and restarts.
- Checkpoints wait for each worker's `BuildUp` (60 s) and then `Idle`. The task is done when every worker is idle.
  Then it starts again for the rest of the segment.

**After a segment** (VW:442-531)
- Gate info: a gate info is added when all three hold:
  - the segment has no gate info yet;
  - fewer than 10 gates exist;
  - the segment has ≥ 4 tiles.
- Otherwise, if `GetBestHolePoint` finds a spot and `NeedHoles` is true, `PutHoleInWall(pos)` leaves a gap
  [?engine]. This is what keeps the village from being sealed.
- Tower: if the segment is ≥ 24 m long and no hole was made, a TBT is started at the segment's **start point**.
  - Class: `<tribe>_small_tower` (SEAS: `seas_turret_tower`).
  - At most 2 tower tasks run at a time (`m_iCountTowerTask <= 1`).
- `CreateNewGates` (VW:644-693) runs every think. It adds gate infos for finished walls whose tile count equals their
  possible tile count (fully built), or puts holes as above.

**Gates (TBG)**
- The class is `GetBestGateClass() = best wall class + "_gate"` (VW:334-360).
  - **For SEAS this is `seas_fence_gate`, which does not exist.** `GateClassNameExists` therefore fails and the gate
    infos are dropped (VW:568-571), so **SEAS never builds gates**.
  - The `"seas_gate"` overrides at VW:463 (which compares against `"seas"` and never matches) and VW:670 only write
    a local variable that is not used.
- The position is `GetFirstValidGatePoint(class, wallDef)` [?engine].
- The task aborts if an own gate stands within 24 m of `pos + offset(dir, 4 m)` (TBG:136, 308-327).
- It allocates workers (TBG:143), then `PlaceGate(workers, class, pos, dir)` (TBG:190).
- It waits for the new object (checkpoint 0). Idle allocated workers get `Build` on the gate, and a checkpoint
  waits up to 120 s for `CurTask != BuildUpB` (TBG:211-245).
- Retries (VW:542-616):
  - a gate whose `Start()` fails 5 times is dropped;
  - a gate whose started task aborts is restarted at most twice (`m_iMaxGateRetryCount = 2`).
- Gate limits:
  - 10 gates at most (`m_iMaxGateCount`, VW:128-130); reaching it drops all pending gate infos;
  - a dead gate lowers the count (VW:695-708).

**Towers at wall ends (TBT, also used by GBT and MP)**
- The task first runs `CheckForEnemy(target)`, with the same request-and-abort rule as above (TBT:110, 139).
- It allocates workers through the target's outpost (`ComputeOutpostId`, TBT:118).
- It requires the worker and the target to be on the same island (TBT:145).
- `BuildTowerNear(target, class, workers, maxDist)` [?engine]. `m_fMaxDist` is 48 for GBT and **never set** for VW / MP.
- After 10 failures the cell's `DefensiveCoverage` is set to 10000, so no further tower is wanted there (TBT:165-178).
- Builders get `/Stop` when done (TBT:225).

**UnitsOnWalls** (VW:796-840) and **RequestUnits** (VW:844-867)
- Archer request:
  - When the first gate task starts and `m_iArchers < 1` (VW:564-566), it requests archers once per game
    (`m_iArchers` is never reset): **3 `hu_archer` at level index 1 (level 2), or 3 `aje_archer` at level 1**.
    Ninigi and SEAS get none.
  - The economy trains them (`SetWantUnits`). `EvtRequestSucceeded` stores them in `m_xUnits` and
    `ExternalLock`s them (VW:871-887), so they leave the pool.
- Each think, if all of these hold:
  - ≥ 1 gate finished (`m_iGateCount > 0`);
  - epoch ≥ 3;
  - `m_bSend` (set true at the end of every think, false once a gate task starts or after a send);
- then for each valid unit `i`:
  - it queries own walls of class `m_asWallClasses[i]` within **36 m of `m_vGatePos`**;
  - if the first hit is `hu_small_wall` or `hu_re_enforced_wall` (Hu) or `aje_clay_wall` (Aje), every unit gets the
    game command `"Use"` on that wall piece, and the aggro state is set to **0 (stand ground)**;
  - at most 10 send rounds (`m_iUnitSendCount < 10`).
- **Bugs (do not copy blindly):**
  - `m_vGatePos` is declared (VW:35) but **never assigned**. The query is always centred on (0,0,0), the map corner,
    so in practice the archers are never sent.
  - The class index uses the unit index `i` instead of `j` (VW:812). For unit 0 (the Hu palisade, the Aje bone
    palisade) it never finds a walkable wall, and for i ≥ class count it reads out of range.
  - The inner `j` loop (VW:811-813) does nothing useful.
  - The intent is clear: three archers stand on a walkable wall near a gate.

**Enclosed workers** (KE)
- Every `100 + iType` ticks, a worker the engine reports as `IsEnclosed` is killed (`/Kill`, KE:176-222, 277).
  Exception: its last work object is still damaged or unfinished.
- This is the original's safety net against walls that trap workers. Recommended for the remake only as an
  "unstick" fallback (see 1c).

**Dead or unused code**
- `BuildWallAroundRegion` / `BuildVillageWalls(region)` return true and do nothing (VW:214-222), so `village_wall 1`
  is a no-op.
- `BlockPassAt`, `CAiGoalBuildBlockingWalls` (`BlockPass` returns false) and `CAiGoalBuildStrategicWalls` are never
  instantiated.
- TBW's cheat refill (`SpawnResources` 100 / 200 wood and stone when nothing could be placed, TBW:378-387) compares
  `m_sDifficulty` (the strings "30", "20", "10") with "Medium" / "Hard", so it never fires.
- TBW `AddCheckpoint(this, i, …)` uses the loop variable after the loop (TBW:398-400). All the BuildUp checkpoints get
  the same id, and the first one counts as "idle" [?engine effect].

### 1b. Remake today
- **Wall grid and placement.**
  - `game/wallmap.js` holds the 8 m tiles, joints and `gateFit(i, j, owner)` (straight own run → rot + wings).
  - `systems/construction.js`:
    - `placement()` snaps walls, towers and traps to tile centres, lets towers replace own wall pieces, and fits gates
      into own runs;
    - `wallLine(p, action, x0, z0, x1, z1)` returns tiles with state `have | ok | cost | bad`;
    - `startConstruction(p, action, x, z, rot, workers)` pays per tile;
    - `autoWork()`: a builder walks on to the nearest unfinished own wall or gate within 50 m.
  - `main.js G.placeWall` is the human path (it uses `G.me` and HUD messages). The AI must call `wallLine` and
    `startConstruction` directly.
- **Walking on walls.** `systems/wallwalk.js useWall(u, w)`, also reachable as the order `{type: 'use', target: wall}`
  (world.js:329). Walkable classes: hu_small_wall, hu_re_enforced_wall, aje_clay_wall, ninigi_palisade.
  `combat.js setAggro(units, 0)` exists.
- **Towers.** `ai/defense.js towerThink`: towers for uncovered buildings, with a limit of 1 + epoch.
- **Behaviour commands.** `brain.js command()` stores `upgrade_walls`, `close_start_location` and `village_wall` in
  `prm` and ignores them (brain.js:164-177). `mapOptions.walls` defaults to false and comes from the map's AIOptions.
- **Missing:** everything in 1a (ring, segments, gates, wall-end towers, wall upgrades, archers on walls,
  enclosure fallback).
- **Pitfalls for a port:**
  - `economy.realise` builds only one unfinished building of a class at a time (economy.js:209) and at most 3
    foundations at once (economy.js:210). Walls must not go through `realise`.
  - `keepBuilders` pulls workers to *every* unfinished own building (economy.js:409-416), so wall foundations would
    drain the economy.

### 1c. Plan
**New mixin `src/game/ai/walls.js`**, added to `TribeAI` like the others (brain.js:327).
- **Timer.** `wait.walls = (W + 50 + 1..n) * TICK`, `next.walls`. Call `wallsThink(S)` in `update()` after `guard`.
- **Active** when all hold:
  - `mapOptions.walls`, `!economyOff`, `S.age >= 3`;
  - `levelName !== 'Single 02'`, not a defender-mode player;
  - `prm.close_start_location`, and `!prm.noWalls` (set by `deactivate_walls`; today that command only sets
    `upgrade_walls = 0`).
- **Data** (constants in walls.js, from VW:97-115):
  `WALLS = {Hu: ['hu_palisade', 'hu_small_wall', 'hu_re_enforced_wall'], Aje: [...], Ninigi: [...], SEAS: ['seas_fence']}`.
  - Gate = class + `_gate`. Keep the SEAS quirk: no gates. Flag it as `FAITHFUL_SEAS_NO_GATE = true`.
  - Tower = `<tribe>_small_tower` / `seas_turret_tower`.
  - Archers: `{Hu: ['hu_archer', 2], Aje: ['aje_archer', 1]}`.
- **`bestWallClass()`**: the highest list entry whose Build action passes `D.check(p, a) === null`. Mayor override as
  VW:320.
- **`upgradeWalls()`**: if the next class is blocked only by research, call
  `this.prerequisites(S, action, null)` (economy.js:250). Do this once a wall exists and `prm.upgrade_walls`.
- **`planRing(S)`** replaces the engine placer `[?engine]`, so document it as an approximation:
  1. Centre = `S.home`.
  2. Take the own buildings that are not walls, towers or fields, plus any building within 60 m of the centre.
  3. Ring = convex hull of their footprints + a 12 m margin (≥ 2 tiles beyond the outermost building), clipped to
     the play area.
  4. Rasterise the hull edges with `wallMap.line()` into tiles. Drop tiles where `placement(cls)` is `bad`, which
     leaves gaps at water, cliffs and resources: those are natural holes.
  5. Split the result into **segments** of contiguous tiles, ≤ 10 tiles per build batch (TBW:26).
  6. Keep at least one **hole of 1 tile per segment ≥ 4 tiles** where the gate will go: the middle tile of the
     longest straight run, so `gateFit` succeeds later. A segment < 4 tiles keeps a 1-tile hole instead (the
     `PutHoleInWall` analogue).
  7. Store `this.ring = { cls, segs: [{tiles, built, gateTile, gate, tower}] }`.
  8. Re-plan when the class changes (new segments only) or when > 30 % of the planned tiles are blocked by new
     buildings.
- **`wallSegmentThink(S)`**: one active segment at a time, like the original's single chain.
  1. `CheckForEnemy` analogue: `this.dangerAt(start, 60)`, which today has radius 30 and must take a radius
     argument, plus hostile wild animals.
     If there is danger: `requestAttack(S, mostlyBuildings ? 'siege' : 'suicide', owner, targets)` and skip.
  2. Batch = min over resources of floor((`p.res[r]` − reserve) / cost), < 1 → 3, cap 10.
  3. For each tile in the batch: `W.startConstruction(p, act, x, z, 0, [])`. Pay per tile and stop at `'cost'`.
  4. Order 1-3 workers (`pickWorker`, as in realise) to `build` the first piece. `autoWork` chains the rest.
  5. Track the pieces in `seg.pieces`. Workers on wall foundations are claimed so `keepBuilders` skips walls
     (add `b.def.wallKind` to its skip test). An idle claimed worker is released.
  6. **Timeout**: no progress for 60 s releases the workers and retries (TBW checkpoint 60 s).
- **Gates.** When a segment is fully built, has ≥ 4 tiles and fewer than 10 gates exist:
  - if the gate tile is still a hole, first place a wall piece there, then the gate on it: the remake's gates
    replace a wall tile;
  - before that, check that no own gate stands within 24 m (TBG:136);
  - place with `W.startConstruction(p, gateAct, x, z, 0, workers)`. `placement()` calls `gateFit`;
  - retries: 5 failed placements drop the gate, 2 restarts of a stalled one;
  - a gate still unfinished after 120 s counts as done-unfinished (TBG:258-262).
- **Wall-end tower.** For a finished segment ≥ 24 m long (3+ tiles) without a hole, place the tribe's small tower on
  the segment's **first tile**. A tower may replace an own wall piece (`placement().replace`).
  - At most 2 such towers are being built at a time.
  - Do not count them against `towerThink`'s 1 + epoch limit, or count them, which is a tuning choice; the original
    has no global limit.
  - 10 failures on a spot set `regionValue('DefensiveCoverage')`, i.e. add a region entry `{x, z, r: 8}` with 10000.
- **Archers on walls.**
  - Request: on the first started gate, if Hu or Aje, push an `extra` request `CHTR/<archer>` × 3 at that level.
    `addOnTop` needs a level and a count option; or train directly via `trainable()` like `attack.js`.
    New units of that class are claimed into a `this.wallGuard` Pool, which keeps them out of `guardThink` and
    attacks.
  - Send: when a gate is finished and the epoch is ≥ 3, take the nearest **walkable** own wall piece within 36 m of
    that gate's centre (the evident intent; Ninigi excluded because they get no archers). Then
    `W.order(units, {type: 'use', target: piece})` and `W.setAggro(units, 0)`. Re-send at most 10 times in total.
  - Option `AI_WALL_ARCHERS_LITERAL` (default **off**): reproduce the original exactly, i.e. never send (VW:815). The
    default is to implement the intent; record the choice in COMPUTER_PLAYER.md.
- **Enclosure fallback** (KE). Every 20 s, for own workers whose nav region (`nav.labelRegions` on the *walls-blocking*
  grid) differs from the region of `S.home`, and that have no unfinished work object, the original kills them.
  Recommended: first try ordering them to build a gate on the nearest own wall tile. Kill only with
  `AI_KILL_ENCLOSED = true`, which is faithful.
- **Tests.** Add `tests/ai_walls.js`:
  - a Giraffe at epoch 3 with `walls: true` gets a ring of segments ≤ 10 tiles, ≥ 1 gate per segment ≥ 4 tiles, no
    worker enclosed, and towers at segment starts;
  - SEAS has no gates;
  - Hu archers stand on `hu_small_wall` near a gate.
- **Size:** ~350-450 lines of JavaScript plus small changes in brain.js (timer, `deactivate_walls`) and economy.js
  (`keepBuilders`, the `dangerAt` radius).

---
## 2. Outposts (secondary bases)

### 2a. Original
An outpost is an engine object `[?engine]` with an id: `Sensor.CreateOutpost(pos, id)`, `GetOutpost(id).GetObjects()`,
`ComputeOutpostId(pos)`, `Transfer(units, fromId, toId)`, and per-outpost instance counts in the planner. Id 0 is the
main base.

**Who starts outposts** (all through `EM.StartOutpost(island, pos, type)`, EM:370-390)
- `EM.StartOutpost` creates a BuildOutpost goal (priority 5) every time it is called, **even when the start fails**.
  A failed goal still takes one of the **5 slots** (`m_kiMaxOutposts`, EM:33, 378, 387-388). This is a bug: failed
  starts use up the cap.
- **IS (area module, always active except Defender / KotH, priority 50, AM:61-66).**
  - It thinks every `500 + iType` ticks, about 100 s (IS:65).
  - It applies only on skirmish maps, never for a Turtle or in `Single 09`, and from epoch 2 on (IS:147-151).
  - At Init it lists the neutral stone deposits sorted by distance to the start location (IS:75-79). On
    `_MN_MP_8_AJUBA` the first entry is the healing well (IS:81-90).
  - For each deposit, in order:
    - if own objects stand within 60 m, skip;
    - if no foreign object (ANML / CHTR / VHCL / BLDG / NEST) is within 60 m, start an outpost **`OP_ResAll`**
      there. The limit is **one on the home island and one on another island** (`m_iNumOutposts`,
      `m_iNumOuterOutposts`, IS:191-211). Only one outpost is started per think;
    - if 1-9 foreign objects are within 60 m and the first belongs to an enemy, request a `suicide` attack on them
      **and** start the outpost anyway (IS:213-226). The 2-per-type limit does not apply to this branch. Each such
      call eats an EM slot.
  - The check `m_iDifficulty < 3` (IS:150) compares the wait `W` (≥ 10), so it is always false. `m_bBusy` is never
    set.
- **BA, the attack outpost (economy goal, think `1 + iType` ticks).**
  - On skirmish maps from epoch 2, while it has no outpost id: `Sensor.GetPossibleAtkOutpostPosition(pos)`
    [?engine], then `StartOutpost(island, pos, "AttackOutpost")` (BA:128-140).
  - Once it has an id, every 10th think it requests at that outpost (BA:96-110):
    - Hu: arena 1, small_animal_farm 1, large_tower 2;
    - Aje: rodeo 1, small_farm (ObjFlag medium_farm) 1, medium_tower 2;
    - Ninigi: engineer 1, animal_farm 1, small_tower 2;
    - SEAS: nothing.
  - These are non-unique, and the count is less what that outpost already has or has queued.
- **MP (trade)** starts `"EmptyOutpost"` at the market spot (section 3).
- **Campaign.** `AIFT attack_type RessourceOutpost | AttackOutpost` → `StartOutpost(islandOf(position_edit), position_edit, type)`
  (FM:918-921), never in `Single 06` (BO:111). One shipped AIFT uses `AttackOutpost` (ai.md §10.2).

**BuildOutpost goal** (BO; think `W + iType + 25` ticks, BO:77)
- `StartOutpost` (BO:109-123) needs `CheckForEnemy(pos)`, the 60 m rule of section 1. Then `CreateOutpost`, and the
  state becomes `building`.
- The crew is the army table named by the type (`MakeDefinedSolution(type)`, BO:443). For example, Aje Dodo
  (settings/Aje/Dodo.txt:540-683):
  - `OP_ResAll`: worker 1-2, resource_collector 1, spearman (level 2) 1-2;
  - `AttackOutpost`: worker 2-3, spearman (level 2) 2-6;
  - `RessourceOutpost`: worker 2-4, spearman 2-3, resource_collector 1;
  - `EmptyOutpost`: worker 1-3.
- Think (BO:182-349):
  - On skirmish maps, if the trade route is ready (`EM.GetOutpostReady`) **or** the village defends:
    `CheckNumUnitsInOutpost` recalls every non-worker, non-cart unit of the outposts on the home island to the main
    base. They are transferred to id 0 and get `/AgressiveTarget` to the start location (BO:670-703). Then it
    returns.
  - Nothing happens while defending, or while an enemy is near the outpost (`CheckForEnemy`, which also requests
    the attack).
  - `building`:
    - For `RessourceOutpost`, `AttackOutpost` and `OP_ResAll`, the **missing crew is spawned for free once**
      (`CheatMgr.SpawnUnitOnLevel`, BO:234-249, 353-388).
    - For other types (`EmptyOutpost`), the allocator takes existing units, or trains them (`Start(false)` then
      `Start(true)`).
    - Then `RequestNext()` while no building request is pending.
  - `waiting`: when the crew is complete, add 1-2 units from the pool (`MOD.QueryUnits(1, 2)` at every difficulty,
    BO:273-281).
    - Same island: `Transfer(units, 0, outpostId)` and `/Walk` to the outpost position; they are locked; the state
      becomes `supervising`.
    - Otherwise `RequestTransfer` (by ship, section 4) and the state becomes `transfering`. On success, fighters get
      `/AggressiveTarget` and workers `/Walk` to the position (BO:756-781).
  - `supervising`: if the outpost has fewer than 2 objects or no worker, back to `building` (BO:335-347).
- **`RequestNext`** (BO:449-641): **one request at a time**, the *first entry the outpost does not have yet*
  (`BuildIfNotExist` per outpost id), with the count shown:

| type | Hu | Aje | Ninigi | SEAS |
|---|---|---|---|---|
| RessourceOutpost | small_tower 2, stone_quarry, lumberjack_cottage, bunker | small_tower 2, resource_collector | small_tower 2, stone_quarry, lumbermill, hunting_lodge | turret_tower 2, steelwork |
| AttackOutpost | small_tower 2, small_farm, arena | small_tower 2, small_farm, arena | small_tower 2, **`ninigi_smal_farm` (typo → skipped)**, arena | turret_tower 2, barracks |
| OP_ResAll | small_tower 1, stone_quarry, lumberjack_cottage | **small_tower is overwritten by bazaar** (BO:557-559): only the bazaar, and nothing if it exists | small_tower 1, stone_quarry, lumbermill, hunting_lodge | turret_tower 1, steelwork |
| OP_AttackAll | small/large_tower 3 (epoch < 4 / ≥ 4) | small/medium_tower 3 | small_tower 3 | turret_tower 3 |
| EmptyOutpost | — | — | — | — |

- `OP_AttackAll` is never requested anywhere, so it is dead.
- `ai.json outposts` (build_ai.py:625) already holds these rows. Their order is the "first missing" order.
- **Reinforcement from the attack outpost** (GA:1497-1551, `OnLostUnit`). When a unit of an attack dies and the
  attack outpost is nearer to the fighters than the base, every production building of that outpost queues the lost
  class directly (`/Actions/<T>/Build/<FourCC>/<cls>`).
  - **Bug:** the first building of the list is skipped (`if(j==0) continue`).
- **Not outpost-related despite the name:** `DefendOutpost` is the danger detector of each defence pool (main pool /
  AIDA areas), already ported in defense.js.

### 2b. Remake today
- `attack.js startAttack` returns null for `RessourceOutpost` / `AttackOutpost` (attack.js:481).
- `DATA.outpost(type, tribe)` exists (data.js:210) but is unused. The army tables for Aje and SEAS are in `ai.json`
  (`DATA.army(tribe, table, name)`).
- `findSpot(S, name, a, at)` and the request field `e.pos` already support placing near a given point
  (economy.js:213, 595).
- There is no outpost entity, no per-outpost counts and no crew handling. `nav.labelRegions()` exists but nothing
  calls it.

### 2c. Plan
**New mixin `src/game/ai/outposts.js`**
- **State.** `this.outposts = []`, each `{ id, type, pos, island, state: 'building' | 'waiting' | 'transfer' | 'supervising', crew: Pool, spawned, reqT, failed }`.
  - Membership of a building or unit = the nearest outpost within 60 m of it [?engine `ComputeOutpostId`].
    Id 0 = home.
  - `outpostCount(o, cls)` counts own buildings (built or not) within 60 m.
- **`startOutpost(island, pos, type)`.**
  - Cap 5 (EM:378). Faithfully, failed starts also count. Make this `FAITHFUL_FAILED_OUTPOST_COUNTS = true`.
  - Refuse in `Single 06`.
  - `checkForEnemy(pos, 60)`: request `siege` / `suicide` as in section 1 and fail.
- **Think** on its own timer, `(W + 25 + iType) * TICK`, in `update()` next to `xtraThink`:
  - **Recall** (BO:188): `multimap && (this.tradeReady || this.defending)` → non-workers of home-island outposts:
    release them and `sendHome`.
  - **building**:
    - For the spawned types (`RessourceOutpost`, `AttackOutpost`, `OP_ResAll`), once: `spawnArmy(S, army, pos, true)`
      (attack.js:522; the units appear for free like the cheat manager's). The army is `DATA.army(tribe, <behaviour
      table>, type)`, else a fallback of 2 workers + 1-2 of the cheapest fighter for Hu / Ninigi.
    - Otherwise take or train workers like `attack.js` squads do.
    - Claim the crew into `o.crew`, then go to `waiting`.
  - **waiting**: add 1-2 pool units (`queryPool(S, 1, 2)`). If `islandOf(pos) === islandOf(S.home)`, order an
    attack-move (fighters) or move (workers) to `pos` and go to `supervising`. Else start a transfer (section 4).
  - **supervising**:
    - `requestNext(o)`: the first row of `DATA.outpost(type, tribe)` with `outpostCount < count` →
      `addOnTop(row.request, row.objFlag, { count: row.count, unique: true, pos: o.pos, outpost: o.id })`.
      `addOnTop` must accept `pos` and copy it to `e.pos`, and `missing()` must count per outpost when `e.outpost` is
      set.
    - **Builders**: `pickWorker` prefers `o.crew` workers for requests with `e.outpost`.
    - Fewer than 2 objects or no worker → back to `building`.
  - Crew workers do not go to `collectThink`'s home assignment. Instead they gather the nearest resource within 60 m
    of `o.pos` (OP_ResAll is a stone outpost; the quarry / bazaar is its drop-off).
- **IS port (`islandSurveillance(S)`)**, every `(500 + iType)` ticks:
  - Conditions as in IS:147-151. The difficulty test is dead: drop it, or keep `true`.
  - At first call, the list of stone resource nodes (`W.resources` with stone) sorted by distance to `this.start`.
  - The rules of IS:157-231 with `uHash` / `bHash` queries of 60 m.
- **BA port.** Once on skirmish maps at epoch ≥ 2:
  - `attackOutpostPos(S)` [?engine `GetPossibleAtkOutpostPosition`]. Recommended: on the home island, the point 45 %
    of the way from `S.home` to `enemyHint(S)`, then the nearest `findSpot`-able free spot. This needs an island test
    and `checkForEnemy`.
  - `startOutpost(..., 'AttackOutpost')`.
  - Then every 10th think, the 3-row tribe list of BA:96-110 as `addOnTop(..., { pos, outpost, unique: false, count })`.
- **OnLostUnit.** In `attack.js`, on an attack unit's death (`readEvents` died, owner = this, claimed by an `Attack`):
  - if the attack outpost is nearer to the squad centre than `S.home`, `W.queueAction` the dead class at that
    outpost's producers;
  - skipping the first producer is optional: `FAITHFUL_SKIP_FIRST = false`, a bug not worth copying.
- **Campaign.** `startAttack({type: 'RessourceOutpost' | 'AttackOutpost', position})` →
  `startOutpost(islandOf(position), position, type)`, which returns the outpost id. Remove the `return null` at
  attack.js:481.
- **Islands.** `islandOf(x, z)` labels connected land *ignoring buildings*. That needs a terrain-only blocked layer:
  `labelRegions` on `this.W.nav.block` would also split at walls and buildings.
  - Compute once per map from `W.isWater` and steep cells. If `nav` has a static layer, reuse it; check.
  - Cache it on `W.islands`. Section 4 needs the same thing.
- **Size:** ~300 lines plus changes to economy.js (`addOnTop` pos / outpost, `missing` per outpost, `pickWorker`
  preference) and attack.js (outpost dispatch, OnLostUnit).

---
## 3. Trade (carts, trade dinos)

### 3a. Original
- **Activation** (EM:527-537): skirmish map && behaviour **Schnecke** && game type **Deathmatch** && epoch ≥ 2 && map
  option `markplace_outpost` (`m_bMarketplace = Sensor.GetMarketplace()`, EM:136) → `MarketPlaceMgr.Activate()`
  (priority 11).
  - `m_sBehavior` is read once at EM.Init (EM:132). It is "Schnecke" only if the module is initialised again after
    `SetBehavior` [?engine: probably `BrainWash` re-inits the modules; CM:303 sets the type before `BrainWash`].
- Turtle (behaviour type "Turtle") and Giraffe never trade. Classes (MP:106-118):

| tribe | market | cart |
|---|---|---|
| Hu | hu_warehouse | hu_cart |
| Aje | aje_bazaar | aje_trade_dino |
| Ninigi | ninigi_warehouse | ninigi_cart |
| SEAS | seas_steelwork | "" (none) |

  SEAS has no cart class, so it builds the markets but never trades.
- **Think** every `50 + iType` ticks, about 10 s (MP:76). State machine (MP:690-752):
  - `Planning` → `ModifyOrCreateAcceptableOutpost`:
    1. **reuse** an outpost (id ≥ 1) whose route passes `CheckRoute` (MP:315-333);
    2. else find a spot (MP:337-410): first the **stone deposits** at 150-250 m from the start location (excluding
       those within 150 m); then the AI-map maximum of a radial gradient 0.2→1.0 between 150 and 250 m, masked by
       no enemy area (dilated 2 areas), no hostile-animal area (dilated 1) and buildable (`Build × BuildModifier`);
    3. each candidate needs `CheckRoute` (MP:279-311):
       - air line between 150 and 250 m;
       - `CalcPath` ends within 8 m of the spot;
       - path length ≤ 350 m;
       - every **security point** along the path, every 60 m beyond 60 m from the start, not in an enemy or
         hostile-animal area (MP:178-218). Points with an own small tower within 68 m are skipped (MP:261-267);
    4. on success, `StartOutpost(island, pos, "EmptyOutpost")` (section 2: 1-3 workers + 1-2 pool units walk there).
  - On failure → `Impossible`: re-Init and retry next think, then deactivate after 5 tries (MP:723-730).
  - `Building` / `Trading`:
    - `UpdateTowerRequests` once (`m_bDone`): a TBT of the tribe's small tower at **every security point** (MP:452-483);
    - `UpdateMarketPlaceRequests`: one market at the base and one at the outpost, if missing (priority 0.666 marks
      them, MP:525-580). The state is `Trading` once both stand.
  - `Trading`:
    - every 3rd think (`ms_iMarketCartTimerInit = 3`, about 30-40 s) `RequestMarketCart`: allocate one existing cart,
      else train one (`Start(false)` then `Start(true)` [?engine]). **There is no upper limit** on carts besides that
      rate and the population.
    - `CheckForCartCompletion` (MP:584-654): a newly allocated cart gets `Dock` on the outpost market and goes to a
      supervisor (locked). Every think, each idle cart docks at the market **farther from it** (the other end of the
      route). The cart's own script then shuttles [?engine / Trade.usl].
    - As soon as one cart exists, `SetOutpostReady(true)`. This also triggers the outpost-crew recall of section 2.
  - `CheckBuildingHitpoints` (MP:793-818): if the outpost market is damaged and not under construction → request a
    `quick` attack at its position. **Bug:** the target list is an empty `xList`, so the attack has a position but no
    targets.
- **Dead or unused:**
  - `CAiGoalUseMarketplace` (empty Think);
  - `CAiGoalMarketPlaceAttack` (enemy carts as targets; strategy "MarketPlace" is never requested, FM:396);
  - `m_bCartRequestPending`.
- **Not trade:** the economy's `buy_food` (skulls → food at the market) is already ported (economy.js:566).

### 3b. Remake today
- `systems/economy.js`:
  - `startTrade(u, target)` / `tradeUpdate`: a cart shuttles between its home market and a *friendly* market;
  - each arrival pays the receiving market's owner `max(1, 5 × (d/50)^1.32)` of food, wood and stone;
  - CWarehouse or CMarketplace scripts (hu / ninigi warehouse, aje_bazaar);
  - the order is `{type: 'trade', target}` (world.js:332).
- `seas_steelwork` (CSeasSteelwork) is not a trade building in the remake, which matches SEAS having no cart.
- AI: carts are excluded from the army (`NOT_ARMY`, brain.js:23); `mapOptions.markplace_outpost` exists. Nothing else.

### 3c. Plan
**Part of `outposts.js`** (it needs the outpost), or `ai/trade.js`:
- **Activate** in `economyThink` when all hold:
  - `multimap`, `personality === 'Schnecke'` (do not copy the init-order doubt);
  - skirmish (= deathmatch), `S.age >= 2`, `mapOptions.markplace_outpost`, the tribe ≠ SEAS.
  - Keeping SEAS faithful means building markets that never trade, which is pointless. Recommendation: skip SEAS and
    note it.
- **Timer** `(50 + iType)` ticks.
- **`planTradeRoute(S)`**:
  1. Candidates: existing outposts, then stone nodes at 150-250 m from `this.start`, then a ring of sample points
     (every 20 m, radius 150-250) that `findSpot` accepts, scored by the 0.2→1.0 radial gradient.
  2. Reject a candidate if `dangerAt` (enemy) or a hostile animal is within 32 m (1 area) or 64 m (2 areas)
     `[?engine area size]`.
  3. `routeOK(p)`:
     - `W.nav.find(start → p)` exists and ends within 8 m;
     - length ≤ 350 m;
     - security points every 60 m along the path beyond 60 m from the start, each free of enemies / hostile animals
       within 32-64 m;
     - store the points.
  4. On success, `startOutpost(island, p, 'EmptyOutpost')` and remember `this.trade = { outpost, secPoints, towersDone, carts: Pool }`.
  5. Five failures → give up.
- **Building**:
  - once, for each security point without an own tower within 68 m: an `addOnTop('BLDG/' + smallTower, '', {pos: pt, unique: false})`;
  - one market at home and one at the outpost (`addOnTop` with `pos` / `outpost`).
- **Trading**:
  - every 3rd think, if no cart is queued: an existing unclaimed cart, else queue one at the market
    (`trainable(S, cartCls)`);
  - new or idle carts: `W.order([cart], {type: 'trade', target: fartherMarket})`;
  - set `this.tradeReady = true` once a cart exists (it drives the outpost recall of section 2).
- `checkMarketHp`: if the outpost market is damaged, `requestAttack(S, 'quick', null, enemiesWithin(market, 30), market.pos)`.
  This fills the targets the original forgot.
- **Optional, documented:** cap carts at about 6. The original has no cap, but the remake's income per cart is real
  and unbounded growth starves the army.
- **Size:** ~150-200 lines.

---
## 4. Ships and naval play

### 4a. Original
**Already in the economy** (ported):
- harbour and fishing boats from the build list (`m_bHarbour`);
- `CheckForEnemyShips` counter warships (`m_bWatermap`);
- fishing (CollectResources:219-281, 442-461 → `TaskFishFish`).

**Ship attack, the strategist** (DA:951-958, 1534, 1569-1571, 1616-1617, 1884-1901)
- `SearchForEnemies` collects enemy SHIPs and enemy `*_harbour` buildings into a ship list (DA:1684-1685).
- `bShipAttack = shipsKnown && epoch ≥ 3 (m_iAge = epoch-1 > 1) && an enemy owns a harbour (hu_harbour, ninigi_harbour, aje_floating_harbour, seas_carrier) && rnd(100) ≤ 5`.
  This is a 6 % chance per strategist think. It is cleared for `Single 01`, `Single 02`, `Single 10` and
  `Single 03` player 1.
- If true it takes precedence over traps, guerilla and the plan entry: `RequestAttack(ships, shipPos, "ship")`.
  The FM gate applies: no doubles, at most 3 attacks, none while defending (FM:205-241).

**AttackShips goal** (AS; think `W + iType`)
- Army `ShipAttack_<clamp(epoch, 2, 4)>` (AS:81-82). For example Aje: cronosaurus 1-2 (+ more in 3 / 4). SEAS 3:
  submarine 1-3, helicopter 0-3.
- Rally at the own harbour (`FindHarbourPos`: hu_harbour / aje_floating_harbour / ninigi_harbour / seas_carrier,
  UM:188-228).
- Enemy query: harbours and all naval classes of the four tribes (AS:51-77), sorted by distance to the start location.
  - Value tweak (AS:101-110): meant to make harbours less attractive than ships.
  - **Bug:** `(no "_harbour") || (no "_carrier")` is always true, so *every* building gets −2.
- States `new → waiting → fighting_walk → fighting_fight` (AS:137-289):
  - walk until within 40 m of the first enemy (`AbsSquare ≤ 1600`), with `attackOnWay`;
  - on completion, the fighters `/Walk` back to the harbour (+0.5 m), else to a beach spot of the home island
    (`FindBeachSpot`: the best `Coast` area near the start location, AS:330-357).
- Also requested:
  - by WC when all transports were destroyed during unboarding, with targets = all enemies (WC:541-561);
  - by campaign AIFT with `ship = 1` (FM:426-427, 908).
- `CheckTargetHeight` cancels when the target is higher than the first fighter's range. It is called before the units
  exist (AS:146), so it reads an empty list.
- Ship class typo: `ninigi_mine_layer` (AS:61); the class is `ninigi_minelayer` (MB:346).

**Transfers across water** (GA:236-365 → AM:248-272 → WC)
- GA decides `bShip` when the attack starts (GA:236-262):
  - the target island ≠ the island of the attacking outpost → ship;
  - same island, on a skirmish water map with the `harbour` option, not KotH / Defender, an enemy owner, **tribe ≠
    Aje** → ship with 11 % (`rnd(100) ≤ 10`): an amphibious flank;
  - level overrides: `Single 08` p2 never, p1 50 %; `Single 06` p1 / p2 never; `Single 01` never;
    `Single 09` p3 with ship → fail; `Single 15` p1 / p2 ship → fail, p3 / p4 land → fail.
  - On skirmish maps, ship && no `harbour` option → the attack fails.
- The landing spot (GA:330-356): the best `InflBuild` area (or `Infl`) + 0.2, × `Coast`, on the target island; else
  the enemy position. It sends `RequestTransfer` with the squad as passengers.
- AM accepts at most **5 crossings at once** (AM:75, 248-272). The rest are rejected.
- **WC** (think `10 + iType`, WC:80):
  - Ships (WC:634-690): **ceil(passengers / 10)** transports (`hu_transport_ship`, `aje_transport_turtle`,
    `ninigi_transport_boat`, `seas_hovercraft` as VHCL), plus *optional* protectors of the same count (`hu_dragon_boat`,
    `aje_cronosaurus`, `ninigi_fire_boat`, `seas_submarine`). They rally at the harbour.
  - Allocation: existing ships first, then trained ones (WC:714-721). If both fail and the tribe is SEAS, the
    hovercraft is built for free (`/AI_Help`, WC:737-751), and the transfer still fails this time.
  - `Board()` (WC:170-230): passengers in groups of 10 per transport (`/BoardTransporter`), removed from the pool.
  - Boarding: `GetCurPassengerCount` (`passengers_onboard`). If not all are on board, `Board()` again every 7th think;
    after 7 such rounds the transfer fails (WC:437-469).
  - Losing a transport while boarding → `EmergencyUnboard`: stop, unload at the home beach (WC:347-377).
  - `Unboard` (WC:294-331): the landing position is the level's table (`GetShipLandingPos` → below), or the engine's
    `GetShipLandingPos(enemyOwner)` / `GetShipBoardingPos` [?engine]. Ships `/AggressiveTarget` to it; within 32 m
    (`Abs2S ≤ 1024`) → `/PrepareUnboard` (WC:478-487).
  - Unboarding: all unloaded → success. Ships `/Walk` back to the harbour (−1.5 m), protectors attack-move there,
    and both are unlocked. If ships are idle with passengers for > 3 thinks → re-board, at most 2 retries
    (WC:522-627).
  - Level landing positions (WC:242-290, original map coordinates):
    - `Single 06` p4: (1207,563), (1255,338), (1245,466); p3: (1112,582);
    - `Single 08` p1: (530,1122);
    - `Single 09` p1: (472,1042), (482,819); p2 unboards at (482,819) (WC:233-237);
    - `Single 14` p2: (546.2,843.2), (555.6,788.5);
    - `Single 15` p3: (328.7,953.3); p4: (774.9,1005.7).
  - **Dead:** the `waypoint` state with hard-coded coordinates (WC:490-520, never entered); `CheckForMines`
    (WC:787-812) builds an attack info and never requests it; `UpdateProtectorPos` (empty).
- Campaign `ship_land` uses `SetCustomTransfer` with a spawned ship and protector (SP:459, AM:287-296).
- **Stranded units ("touries")** (AM:140-210): own units idle on another island for > 5 area thinks are collected
  (units within 128 m) and shipped home after > 10 thinks without change.

**Defence and ships** (DO:112-126, 178-206)
- If ships of an enemy are in the most dangerous area, `GetEnemyShipTargets` builds a `ship` attack info once and
  **never requests it** (dead).
- Quirk: when enemy units **and** ships are both in that area, the defence think returns without defending.
  This is faithful but harmful; recommended not to copy.

**Mine belts** (MB; Ninigi)
- They apply on skirmish water maps from epoch 2 (DM:660-669). Think `300 + W` ticks.
- A `ninigi_minelayer` (`SeaMineLayer` solution) lays groups of `ninigi_mineship_mine` at positions from the engine's
  `CAiMineMgr` [?engine], paying wood and stone per mine.

### 4b. Remake today
- Census: `S.fleet` holds own ships; ships are not in the pool (brain.js:223).
- `updateBuildList` adds counter warships (economy.js:109-117). `fishingThink` (economy.js:586).
- `findSpot` puts harbours on the coast towards the fish (economy.js:603-614).
- `attack.js`:
  - `embark` / `attackSail` (attack.js:556-595) handle **scripted `ship_land` only**: transports are *spawned* at
    the water nearest the spawn point, units `enterTransport`, sail to the landing cell, `unloadAll` at
    `shorePoint`, and the transports are killed silently;
  - `ship: true` waves run as land waves (attack.js:498);
  - plan attacks never cross water;
  - defence ignores naval units (defense.js:78).
- `systems/transport.js` has `capacity`, `canBoard`, `shorePoint`, `enterTransport`, `leaveTransport`, `unloadAll`,
  the `board` order and the passenger update. `systems/naval.js` has fishing, harbours, mines and naval targeting.
- **Missing:** the ship attack (strategist + goal), transfers of plan attacks and outpost crews, the 11 % amphibious
  flank, the stranded-unit return, the level landing tables, mine belts.

### 4c. Plan
- **Islands** (shared with section 2): `W.islands` = terrain-only connected land components; `islandOf(pos)`. Ships
  stay on `W.waterNav`.
- **Ship attack** (`attack.js`):
  - add `ship: ['ship', 'ShipAttack_']` to `GOALS`. The army name is `ShipAttack_` + clamp(age, 2, 4), *not*
    `min(5, age)`, so it needs a special case in `requestAttack`;
  - in `strategyThink`, before the plan entry: if `W.waterNav && S.age >= 3`, an enemy owns a harbour, the known
    enemy ships / harbours list is not empty, `rnd(100) <= 5`, and the level is not in the excluded list →
    `requestAttack(S, 'ship', owner, shipsAndHarbours)` and return;
  - a new Attack path for `goal === 'ship'`:
    - the squad comes from `S.fleet` warships (claim them), else the ships are trained at the harbour (`trainable`);
    - gather at the harbour's `dockPoint`;
    - attack the targets nearest the start location first; ships ignore land units;
    - in `attackTargets`, take buildings last (the evident intent of AS:104), plus an optional faithful flag;
    - "near" = 40 m;
    - when done, ships move back to the harbour.
  - Ships need `u.naval` handling in `attackWalk` and `attackFight`: use the `waterNav` path, and keep them out of
    `sendHome`'s land guard point.
  - Campaign: `startAttack({ship: true})` → this goal with `armyName = type` and spawning at `spawnPosition` or the
    harbour (AS:145-178).
- **Transfers for plan attacks and outposts** (new state `transfer` in `Attack`, generalising `embark`):
  1. At `attackGo`: if `islandOf(target) !== islandOf(S.home)` → transfer. Else if `multimap && watermap &&
     mapOptions.harbour && tribe !== 'Aje' && rnd(100) <= 10` → transfer. Level overrides as GA:236-290.
     Ship needed but no `harbour` map option on a skirmish map → `end('no harbour')`.
  2. Need `ceil(n / 10)` transports (`transportClass === 2`, the class list of WC:646-655) and optionally as many
     protectors. Take own idle ones, else queue them at the harbour (wait up to the squad timeout). SEAS with neither:
     a free hovercraft via `W.spawnUnit` at the harbour (WC:748), then fail this attempt.
  3. Gather the passengers at the harbour `dockPoint` and order `board` per transport (10 each). Every 7th think
     re-order the stragglers; after 7 rounds `end('boarding')`. A transport lost while boarding → unload at the home
     beach and end.
  4. Landing: `landingPoint(targetIsland, enemyPos)`: the level table (below), else the coast cell of the target
     island nearest the enemy base that `shorePoint` accepts. Sail; within 32 m → `unloadAll`.
  5. Then the normal `walk` / `fight`. Transports and protectors go back to the harbour. No silent kill: unlike the
     scripted `embark`, these ships are real.
  6. All transports destroyed while unloading → `requestAttack(S, 'ship', null, enemiesNear(landing))`.
  7. At most 5 transfers at once (AM:75).
- **Level landing table.** `LANDINGS = {'Single 06': {4: [...], 3: [...]}, ...}` in data.js, converted with
  `brain.mapToGame`.
- **Stranded units.** Every area think (`W + iType`), own pool units on another island idle for > 10 thinks →
  transfer home.
- **Defence.** Keep ignoring ships in `defenseThink`. Optionally request a `ship` attack on ships within 30 m of the
  village (the evident intent of DO:188-202). Do not copy the "units + ships → no defence" quirk.
- **Mine belts.** Optional and low priority: Ninigi on skirmish water maps from epoch 2, every `300 + W` ticks.
  - With a `ninigi_minelayer` and the wood / stone for 3-5 mines, lay a row 20-30 m off the own coast towards the
    nearest enemy base: `W.layWaterThing`, which exists in naval.js:267.
  - The engine's `CAiMineMgr` positions are unknown `[?engine]`.
- **Size:** ~400-500 lines (ship goal ~120, transfer ~220, islands ~60, the rest small).

---
## 5. Chat with allied players

### 5a. Original
The AI sends messages **only** through `Sensor.SendChatMsg(key[\targ], timeoutMs, pos, toPlayer)` [?engine: shown as
a newsticker or chat line for that player, with `pos` probably as a ping]. **There are no taunts and no
"attack together" messages in the scripts.** Everything is help-related.

**Proactive: `CryForHelp`** (GV:615-633, called at GV:696-716)
- Conditions:
  - skirmish map;
  - main defence pool;
  - the village defends (`IsDefending`);
  - attackers > 3 and own defenders ≤ attackers;
  - **no wild animal** among the attackers;
  - not `Single 15`;
  - the cooldown timer `m_iHelpCallTimer` is 0. It is reset to 10 GV thinks, and GV thinks every `10 + iType`
    ticks, so about 20-35 s.
- It sends `_NT_AI_HELPBASEATTACKED` (7500 ms, `pos = m_vBasePos`) to every player whose relation to it is
  **friendly (2)**, human or AI.

**Reactive: requests from players** (CM:614-731)
- Input: `CEvt_AiGenericStringEvent("<sender> AI<n>: <words>")`. `<n>` = the AI's **player id**, `GetWantedAi`
  (CM:745-765) accepts AI1-AI7. It comes from:
  - the chat window, when the line starts with `AI1:` … `AI7:` (ChW:147-153);
  - the diplomacy window: *send tribute* → `"AI<id>: Gift <type> <n>"` (DiW:72-87); *request tribute* →
    `"AI<id>: <Type> <n>"` (DiW:96-110).
- Handling (only the addressed AI answers; the amount in the text is ignored):

| word (3rd token) | condition | AI does | reply key |
|---|---|---|---|
| any other text | — | Eliza chatbot answer (`CAiEliza.Process`, engine-native, no data file in Data/) [?engine], sent if it differs from the last answer, 10 000 ms | free text |
| `Gift` | any sender | — | `_NT_AI_THANKSFORHELP` |
| `Help`/`help` | sender not an enemy, pool > 3 units, not defending, an enemy in the danger map within 5 AI areas of the sender's start location (FM:978-1015) | `InitiateCoopSupportAttack` (FM:1020-1059): CS goal at priority 10⁶ with up to **4 / 6 / 8** pool units (Easy / Medium / Hard, min 0, fBad 1.0 / 0.99 / 0.99, CS:94-108); transfer by ship if needed; targets prefer units, buildings −2, wild animals only if they attack the group | `_NT_AI_CONFIRMHELP\t<units sent>`, else `_NT_AI_CANTHELP` |
| `Food`/`Wood`/`Stone` (either case) | sender not an enemy; unlocked stock ≥ 100 | `GiveResourcesTo(sender, 100 of it)` | `_NT_AI_SEND{FOOD,WOOD,STON}\t100` / `_NT_AI_CANTSEND…` |
| `Iron`/`iron` (skulls) | — | **nothing** (no branch) | none |
| any request | sender is an enemy | — | `_NT_AI_DENIEHELPENEMY` |

- English texts (NT:35-52; German in `locale/de`):
  - `_NT_AI_HELPBASEATTACKED` "Help! My Base is attacked by a superiority!"
  - `_NT_AI_THANKSFORHELP` "Thank you. I have received your help!"
  - `_NT_AI_CONFIRMHELP` "Hold tight, I will send you a support squad with %1 units immediately!"
  - `_NT_AI_CANTHELP` "Sorry, I can't help you at the moment!"
  - `_NT_AI_DENIEHELPENEMY` "Sorry, I can't help you. You are my enemy!"
  - `_NT_AI_SEND{FOOD,WOOD,STON}` "I am sending you %1 food / wood / stone!"
  - `_NT_AI_CANTSEND{FOOD,WOOD,STON}` "Sorry, I can't send you any <res>. Haven't got enough myself."
- **Unused keys:** `_NT_AI_NEEDRESSOURCES` "Help! I need %1 %2! …" (the AI never asks for resources),
  `_NT_AI_SENDIRON` and `_NT_AI_CANTSENDIRON`, and `_NT_AI_RESSOURCE_*` (used only by the client's request UI, DiW:112-115).

### 5b. Remake today
- No chat window: `hud.js` only positions a `chat` button (hud.js:108-110). No diplomacy or tribute window.
- `W.emit('msg', {player, key, text, kind})` → `feedback.js ticker()` → `G.hud.message` (feedback.js:25-30, 82). `%1`
  is only filled with an item name.
- `D.ui(key)` reads the imported `.ltf` strings. `build_data.py:224-236` imports every `*_uk.ltf` except
  sequences / dialogscenes, so `newsticker_uk.ltf` and the `_NT_AI_*` keys should be in `extra.ui`; check.
- Diplomacy: `player.relation / isFriend / isEnemy` (player.js:41-56); skirmish teams; no resource-giving function.
- AI: nothing. COMPUTER_PLAYER.md lists "calls for help" as not done.

### 5c. Plan
**New mixin `src/game/ai/chat.js`** plus small UI work.
- **`say(toPlayer, key, arg)`** → `W.emit('msg', {player: toPlayer, key, text: fallbackEnglish, arg, kind: 'ai', from: this.p})`.
  - In `feedback.ticker`, replace `%1` with `e.arg` when given, and prefix the sender's name (`from.name + ': '`) as
    a chat line.
  - Keep the original's per-message timeout (7.5 s) as the HUD message duration.
- **`cryForHelp(S)`**, from `defenseThink`:
  - when `multimap && this.defending && threats.length > 3 && guard.units.size <= threats.length`, no animal
    threats, and `levelName !== 'Single 15'`;
  - cooldown `10 × (10 + iType) × TICK` s;
  - `say(o, '_NT_AI_HELPBASEATTACKED')` to every `o` with `p.isFriend(o)`, `o !== p` and not defeated, with a minimap
    ping at `S.home` if the minimap supports pings.
- **`onPlayerRequest(from, text)`**, the public API for the UI and tests (the CM:614-731 table):
  - `'help'`: `queryPool(S, 0, {Easy: 4, Medium: 6, Hard: 8}[cls])` after keeping 3 (`S.pool.length > 3`, not
    `this.defending`). Targets = enemies within ~80 m of the sender's `baseOf` `[?engine: 5 AI areas]`; none →
    CANTHELP. Else a new `Attack({goal: 'quick', type: 'coop', targets, scripted: false, hunt: true})`, so it is not
    counted against the 3 plan attacks (the CS goal has priority 10⁶). With section 4, cross water if needed.
    Reply CONFIRMHELP with the units actually taken.
  - `'food' | 'wood' | 'stone'`: if `p.res[r] - (this.reserve[r] || 0) >= 100` → `p.res[r] -= 100; from.res[r] = min(cap, +100)`
    (add `W.giveResources(from, to, res, n)` with the cap rules), reply SEND…, else CANTSEND….
  - `'gift'`: THANKSFORHELP.
  - `'iron'`: no reply (faithful). Optional `AI_ANSWER_SKULLS`: use the existing SENDIRON / CANTSENDIRON keys with 100 skulls.
  - Enemy sender (for help, food, wood or stone) → DENIEHELPENEMY.
  - Anything else: Eliza is engine-native and not portable `[?engine]`. Recommended: no answer, or one fixed line;
    document it.
- **UI** (`src/ui/chat.js`, new, small): the HUD `chat` button / Enter opens an input.
  - A line `AI<n>: <word>` is routed to `G.ai[n].onPlayerRequest(G.me, word)`; other lines just echo.
  - Optional diplomacy buttons ("send 100 / request 100" per allied AI) produce the same strings (DiW:72-115).
- **Size:** ~120 lines of AI code + ~80 lines of UI.

---
## 6. Picking up items (artefacts)

### 6a. Original
**`CheckGetItem`** (DA:633-681), called every strategist think (DA:574-575)
- Conditions: no warp-gate hunt; not `_MN_MP_2_COLDBLOOD`; **epochs 1-3** (`m_iAge = epoch − 1 < 3`; ai.md §5.5
  says "before epoch 3", which is off by one); skirmish maps only.
- Candidates: neutral ITEMs (owner −1) on the **home island** (`GetDynamicIslandIdForChar`), nearest to the start
  location.
- By difficulty class:
  - Easy: never;
  - Medium: with chance 1/15 per think;
  - Hard: every think.
  - Then `RequestAttack([item], pos, "getitem")`. The FM gate allows `getitem` even while defending and refuses a
    second one (FM:205-232).

**GetItem goal** (GI; think `30 + iType` ticks, about 6-8 s)
- `new` (GI:93-117): take **one** own `hu_warrior`, `aje_spearman`, `ninigi_archer` or `seas_warrior` with an empty
  inventory from the pool (`MOD.QueryUnits(1, 1)`). Else `build` → the army `FindItem_1` (Aje: 1 aje_spearman), with
  essentials taken from the defence pool.
  - `CheckPathToBuildPlace` (GI:228-274): its result is ignored. Side effect: if the path is shorter than 60 m and
    passes threats → pest patrol at the worst point.
- `running` (GI:151-170): if an enemy unit, building, nest or a *visible hostile* wild animal is within 60 m of the
  item → fail. From epoch 3 it also requests a pest patrol there (GI:278-321). Else it sends `PickUp` to each fighter.
- `checking` (GI:172-199):
  - a fighter whose `inventory_item_name` equals the item → `running_back`;
  - after 15 counter steps (one per fighter per think) with an empty inventory and Idle → `running_back` too, i.e.
    gives up;
  - after more than 30 thinks → `running` again (re-issue `PickUp`).
- `running_back` / `is_home`: `/Walk` to the start location, succeed within 30 m (`Abs2S < 900`).

**Opportunistic pickup** (AO:1056, 1496-1526)
- On skirmish maps, every think of *any* attack task: the first actor with an empty inventory picks up the first
  neutral ITEM within **30 m** of it (`PickUp`).

**Campaign `Item_Attack`** (FM:923-940 → IA)
- The target is the first trigger object that carries an item (`inventory_item_name` not empty). The attack uses the
  army `Item_Attack` (Aje: 2-4 velociraptor_handler; SEAS: 2-4 warrior).
- It fights to completion (IA:177-196), then searches for ITEMs within **64 m** of the squad centre (IA:197-221),
  `PickUp`, checks for up to 10 thinks, re-searches, then walks home (IA:222-260).
- Not used by the shipped campaign (ai.md §10.2 survey).

### 6b. Remake today
- `systems/items.js`: items are Props in `W.items` with `.item = {cls, carrier}`. `W.order([u], {type: 'pickup', target: item})`
  (world.js:328, `canCarry`). Carrying gives the bonuses. Pickup within 4 m; a full inventory → `msg`. `u.item` =
  the carried item.
- AI: nothing. `startAttack({type: 'Item_Attack'})` runs as an ordinary wave (COMPUTER_PLAYER.md:146).

### 6c. Plan
In **`attack.js`** (or a small `ai/items.js`):
- **`checkGetItem(S)`** at the top of `strategyThink`, before the warp-gate check:
  - when `multimap && !gateHunt && levelName !== '_MN_MP_2_COLDBLOOD' && S.age <= 3 && cls !== 'Easy'`;
  - Medium only with `rnd(15) === 0`;
  - item = the nearest `W.items` entry with `!it.item.carrier` and `islandOf(it.pos) === islandOf(S.home)`;
  - then `requestItem(S, item)`, refused if an item attack is running.
- **`Attack` goal `getitem`** (bypasses the defending refusal, like `quick`):
  - `new`: one unclaimed pool unit of the tribe's runner class (`ITEM_RUNNER = {Hu: 'hu_warrior', Aje: 'aje_spearman', Ninigi: 'ninigi_archer', SEAS: 'seas_warrior'}`)
    with `!u.item`. Else order `FindItem_1` (`DATA.army(tribe, table, 'FindItem_1')`, fallback: 1 runner) through
    the existing squad path.
  - `running`: `checkForEnemy(item.pos, 60)` including visible hostile wild animals → `end('danger')`, plus
    `this.pest = item.pos` from epoch 3. Else `W.order(units, {type: 'pickup', target: item})`.
  - `checking`, every `(30 + iType)` ticks:
    - a unit carries this item → go home;
    - the item is carried by someone else or gone → end;
    - a unit is idle without an item after the 15-step counter → go home;
    - more than 30 checks → `running`.
  - Home: move to `this.start`; done within 30 m. Then release the unit, which keeps the item and its bonus.
- **Opportunistic pickup** in `attackFight` / `attackWalk` (every atk think, multimap only): the first squad unit with
  `!u.item && W.canCarry(u)` and a free item within 30 m → `pickup` order. Then let it rejoin: it keeps its claim.
- **Campaign `Item_Attack`**:
  - targets = the first trigger object with `u.item`;
  - the squad is `DATA.army(..., 'Item_Attack')` (fallback: a scripted army);
  - after the target dies: free items within 64 m of the squad centre → pickup, up to 10 checks, then walk home.
    This replaces "runs as an ordinary wave".
- **Size:** ~100-150 lines.

---
## 7. Order of work, shared pieces, tests
1. **Shared helpers first** (brain.js / economy.js):
   - `islandOf()` on terrain-only components;
   - `checkForEnemy(pos, 60)`, which returns the threats and requests `siege` / `suicide` (UM:615-702);
   - `addOnTop` with `pos`, `outpost`, `count`, `level`;
   - `missing()` per outpost;
   - `keepBuilders` skips wall foundations;
   - `W.giveResources`.
2. Items (section 6): small, self-contained, and it tests the new `checkForEnemy`.
3. Walls (section 1): independent of islands.
4. Outposts (section 2), then trade (section 3).
5. Naval transfers and ship attacks (section 4). Outposts on other islands depend on it, so land-only outposts come
   first.
6. Chat (section 5): the AI side can land any time. The UI is separate.

**Faithfulness flags to document in COMPUTER_PLAYER.md** (default in brackets):
- `AI_WALL_ARCHERS_LITERAL` [off];
- `FAITHFUL_SEAS_NO_GATE` [on];
- `AI_KILL_ENCLOSED` [off: unstick instead];
- `FAITHFUL_FAILED_OUTPOST_COUNTS` [on];
- OnLostUnit skip-first [off];
- trade cart cap [6, the original has none];
- defence "units + ships → skip" quirk [off];
- `AI_ANSWER_SKULLS` [off];
- Eliza [not ported].

**Tests to add**, all into `tests/regress.sh`:
- `tests/ai_walls.js`: section 1c.
- `tests/ai_outpost.js`:
  - a Giraffe at epoch 2 on a map with free stone at 120-200 m gets an `OP_ResAll` outpost with a tower and a quarry
    at the stone;
  - the campaign `AttackOutpost` returns an id.
- `tests/ai_trade.js`: a Schnecke with `markplace_outpost` builds 2 markets ≥ 150 m apart, towers along the route,
  and ≥ 1 cart that trades within 10 minutes.
- `tests/ai_naval.js`: a two-island map; a plan attack crosses with ceil(n/10) transports; a ship attack happens at
  epoch ≥ 3 against an enemy harbour (force the 6 % with a seeded `Math.random`).
- `tests/ai_items.js`: a Hard AI at epoch 1 fetches an item 80 m away, and Easy does not.
