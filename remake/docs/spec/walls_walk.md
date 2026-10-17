# Walking on walls, ladders, siege towers, falling — spec

How the original lets characters climb onto and walk along walls, attack from them and fall off them, plus the siege
objects that dock to a wall (hu_ladder, ninigi_siegetower, the Aje siege brachiosaurus). This continues
`docs/spec/walls.md` §18 ("out of scope / later").

Rules are cited as `file:line`. **[?engine]** marks behaviour inside the C++ engine (WallMap, pathfinder, action
system) that the scripts only call. The evidence is given and a recommendation follows.

Abbreviations (all under `Data/Base/Scripts/`; the ones also used in walls.md keep their meaning):

| short | file |
|---|---|
| DW | `Server/classes/task/DockWall.usl` (CDockInfo, CDockWall, CBuildLadder, CClimbLadder, CClimbBrachio, CClimbSiegeTower, CLeaveSiegeTower) |
| MS | `Server/classes/task/misc.usl` (CWalkToPos, CWalkToObj, CJumpOffWall, CFollowEnemy) |
| CH | `Server/classes/character/character.usl` · FO = `Server/classes/FightingObj/FightingObj.usl` |
| B | `Server/classes/buildings/Building.usl` · VH = `Server/classes/FightingObj/TransportObj/Vehicle.usl` · AN = `Server/classes/animals/Animal.usl` |
| AF | `Server/misc/ActionFactory.usl` · TK = `Server/misc/Task.usl` |
| T/x | `Server/classes/task/x.usl` |
| WCC / WCX | `Server/init/wallclassconfig.txt` / `wallclassconfig_ex.txt` |
| TTR | `Server/settings/Techtree/_TechTree.ttree` (line numbers of the raw file; BoosterPack1 carries an identical copy for the values used here) |
| GIC / SIC / PC | `Game/controller/GameInputController.usl` / `SecondaryInputController.usl` / `PlaceController.usl` |

BoosterPack1 has no `.usl` files. Only `init/UnitAcks.txt`, the tech tree and class lists are overridden, and none of
those touch these rules.

Model measurements come from the exported `.glb` files (`hu_ladder`, `ninigi_siegetower`, `aje_brachiosaurus_siege`,
wall pieces). Model axes: x and y are horizontal, z is up.

---

## 1. Who walks on which walls, and how they get up

### 1.1 Walkable walls
* WCC flags four wall classes `walkable = '1'` (WCC:9-11, 16-18, 30-32, 49-51; WCX:17, 28, 50, 80):
  * **hu_small_wall** and **hu_re_enforced_wall** (Hu classes 1 and 2);
  * **aje_clay_wall** (Aje class 1);
  * **ninigi_palisade** (Ninigi class 1).
* Not walkable: hu_palisade, aje_bone_palisade, ninigi_defense_skewer and seas_fence. **SEAS has no walkable wall.**
* The client keeps the same list as "usable buildings": a right-click on one of these walls means *use*, not repair,
  unless the wall is damaged and Shift is held (GIC:826-836, 847).
* WCC also has a `Sieges { Class_0 = 'hu_ladder' }` block (WCC:75-77). It registers the ladder as a WallMap siege
  object [?engine].
* **Hu wall upgrades.** An upgrade re-skins every existing hu_palisade segment through
  `WallMap.WallClassChanged(obj, gfx)` (B:2296-2309). [?engine] The WallMap probably re-derives `walkable` from the new
  gfx. **Recommendation:** walkability follows the current gfx class, so an upgraded palisade becomes walkable.
* **Wall-top height.**
  * The scripts never state it. Every model points to about **7.6-7.9 m above the wall origin**:
    * the ladder top link `Wo_2` is at z 7.61, 4.27 m out from the foot `Wo_1` (z 0);
    * the siege-tower climb ends at `pos.z + 7.8` (DW:914);
    * the wall pathfinder boxes run from z −3.34 to +7.87 (all four walkable walls, and hu_palisade).
  * **Use `WALL_TOP = 7.8` m above the tile's ground height.** Walls do not adapt the terrain (walls.md §2), so take
    the height at the tile centre.

### 1.2 Who may go up
* **Only characters (CHTR).**
  * `CCharacter.OnInit` calls `SetCanUseSiege(true)` (CH:640). The only other script call is `SetCanUseSiege(false)`
    for the tracker dino (AN:3771).
  * Every climb task casts the climber to `CCharacter` and ends otherwise (DW:523-526, 699-702, 902-905).
  * The fall handler exists only in CCharacter (CH:2165-2174).
* Animals, vehicles and ships never stand on a wall. Mounted riders are ANML, so they cannot go up either.
* No size or class limit appears in the scripts: workers, heroes and soldiers alike. Siege towers carry transport
  class 1, which is characters only (VH:467).

### 1.3 Ways onto a wall

| way | trigger | task | result |
|---|---|---|---|
| **own walkable wall** | right-click own wall → `"Use"` (GIC:841, 888; CH:1945-1952). The AI does the same (`Ai/goals/AiGoalBuildVillageWalls.usl:796-840`) | `GoTo(wall.pos, …, bOnWall = true)` → `CWalkToPos` → `WallWalkAction(pos, bToGround = false, …)` (MS:167-169) | the unit walks to the wall and climbs it [?engine] |
| **`/UseAttack` on any CWall** | CH:2127-2130 (server only; the client's `xUse` list is never filled, GIC:699-735) | same GoTo with `bOnWall = true` | unused in practice |
| **ladder** (own) | right-click own `hu_ladder` → `"ClimbLadder"` (GIC:852-853) → `StartLadderClimb(ladder, up, jumpOff = false)` (CH:2007-2008) | `CClimbLadder` (§4.4) | ends on the wall top |
| **docked siege brachiosaurus** | "board" order on a docked brachio → `StartBrachioClimb(b, up, jumpOff = false)` (CH:351-357) | `CClimbBrachio` (§5.3) | ends on the wall top |
| **pathfinder through an entrance** | a wall walk whose path uses a docked ladder or brachio → the dock's move callback `Climb(actor, bUp)` (B:2093-2098, AN:1715-1722) [?engine] | `CClimbLadder` / `CClimbBrachio` as a **sub-task**; the walk action is paused and resumed (DW:516-520, 599-603) | up or down, then the walk continues |
| **ground path over a sieged wall** | [?engine] probably the pathfinder (`GetWallSiege`, DW:386) calling `CCharacter.DoStartSiegeClimb(siege)` (CH:467-476) | ladder → `StartLadderClimb(…, up, jumpOff = true)`; brachio → `StartBrachioClimb(…, true, true)`; siege tower → `StartSiegeClimb` | the unit crosses the wall and lands **4 m beyond the wall centre** on the far side (§4.4, §5.2) |

* **Own walls without a ladder [?engine].**
  * "Use" works with no siege object, and the gate and tower models have no stair links.
  * The character file has the anims `palisade_climb_up`, `palisade_climb_down`, `palisade_climb_back` and
    `hu_palisade_climb_up_<caste>` / `_climb_back_<caste>` (strings in `GSF/all_characters.gsf`).
  * **Recommendation:**
    * Own (and allied [?]) walkable walls can be climbed at any free edge of a wall tile, with the climb anims, in about 2 s.
    * Enemy walls can be entered only through an *additional entrance*: a ladder or a docked brachio. A siege tower
      only gets units over the wall (§5.2).

### 1.4 Ways off a wall
* **Any ground order.** Move, gather, deliver, build, attack a ground target and so on.
  * Every task that moves a unit checks `GetOnWall()`. If set, it calls `WallWalkAction(dest, bToGround = true, …)`
    or `AdvanceWallAction(target, params, bTargetOnGround = true, …)` instead of `WalkAction` / `AdvanceAction`
    (list in §2.3).
  * The engine walks the unit along the wall to an exit and down [?engine]: back down a ladder or brachio through its
    callback with `bUp = false`, or down at an own wall [?].
* **`JumpOffWall`.**
  * Command `"Action" … "/JumpOffWall"` → `CJumpOffWall` (CH:1653-1660, CH:2136-2137, TK:152-153, MS:453-553):
    1. `rotate`: `RotateAction` toward the destination.
    2. `jump`: `RemoveFromWall()`, then `JumpAction("jump_wall", p, rot, 0.0, 20.0)`, where `p` = own position + 5 m
       toward the destination, at ground height, then `GetFreePos` (MS:499-506).
    3. Wait for the action to end, then `WalkAction(dest)`.
  * The task cannot be broken while airborne (MS:544-546).
  * **No fall damage** is applied.
  * The tech tree has **no** JumpOffWall action, so players never get a button. Only triggers (AF:1318-1321) and the
    client hack (SIC:537-540) know it. **Recommendation:** keep it as a trigger and script action only.
* **Jetpack** (`T/Jetpack.usl:115`): `RemoveFromWall()` before `JetPackAction`.
* **The wall dies**: the units fall (§6).

---

## 2. Movement and orders while on a wall

### 2.1 Engine primitives (signatures from the call sites)

| call | meaning (from use) |
|---|---|
| `GetOnWall()` / `SetOnWall(b)` | Engine flag. `FO.SetOnWall` (FO:1979-1982) and `CH.SetOnWall` (CH:2225-2228) only add a refresh of the defence attributes (§3.1). Who sets it: [?engine], when the unit reaches or leaves the wall-top walk area. |
| `WallWalkAction(dest, bToGround, speed, bUsePF [, bHeightAdapt, walkSet, false])` | Walk with the wall graph. `bToGround = true` means the destination is on the ground (leave the wall), `false` means it is on the wall (CWalkToPos passes `!m_bOnWall`, MS:167-169). The 4-argument form is used by most tasks. |
| `AdvanceWallAction(target, CAdvanceActionParams, bTargetOnGround, bFlag)` | Like `AdvanceAction`, but routed over walls. The third argument is always `!target.GetOnWall()` or `true`. The fourth is passed inconsistently (`bNoUserCommand` FO:6024, `!bNoUserCommand` FO:6081, `m_bUserCommand` MS:733, `false` for economy tasks) [?engine]. |
| `RemoveFromWall()` | Clears the on-wall state before a jump (MS:526, Jetpack:115). |
| `WallMap.GetFreeDockPos(owner, ref pos, from)` | Free dock spot on the wall nearest `from`; `pos` starts at the wall centre (DW:179, DW:398) [?engine]. |
| `WallMap.AddAdditionalEntrance(docker, wall, entryPosObj, cb)` / `RemoveAdditionalEntrance(docker, wall)` | Registers or removes an entrance; `cb(actor, bUp)` starts the climb (DW:49-62). |
| `Pathfinder.GetWallSiege(wall)` | The siege object docked to this wall, or null (DW:386). |

### 2.2 Order handling
* **Plain move.** `GoTo(pos, …, bOnWall = false)` → `CWalkToPos` → when the unit is on a wall:
  `WallWalkAction(pos, true, …)` (MS:166-169). The unit walks off the wall to the ground point.
* **The gate re-path check** (open gates within 10 m) is skipped on a wall (MS:238).
* **CWalkToObj** wall-walks to a free spot at the target (MS:373-376).
* **Move toward an enemy** (FO `FollowEnemy` FO:6012-6087, task CFollowEnemy MS:669-741):
  * Attacker on a wall → `AdvanceWallAction(enemy, …, bTargetOnGround = !enemy.onWall)`. It walks along the wall,
    and down when the enemy is on the ground.
  * Attacker on the ground, enemy on a wall:
    * **ranged attacker** (`GetProjectile()` not empty) → normal `AdvanceAction`; it shoots from the ground (FO:6078-6079, MS:730-732);
    * **melee attacker** → `AdvanceWallAction(enemy, …, false)`; it looks for a way up [?engine]. Without an entrance
      it cannot reach the enemy, and the hit test fails anyway (§3.2).
  * Return-to-post walks use `WallWalkAction(aggrPos, true, …)` (FO:6033, 6062, 6107; MS:692, 717, 741).
* **Idle behaviour on a wall:**
  * `CheckPatrol` returns at once, so the unit does not walk back to its aggression position (FO:2393).
  * `"/GoAway"` (make room) is ignored (FO:8656-8659).
  * The level-up anim and its 2.5 s invulnerability are skipped (FO:3534, CH:950).
* **Death on a wall.** The corpse gets the die anim `hit_rotate_s` (CH:2310-2311), unless it was a self-kill or the
  unit has no die anim.

### 2.3 Tasks that check `GetOnWall`

| file:line | when on a wall |
|---|---|
| T/BuildUp:253 · T/Repair:261 · T/Mine:246 · T/MineTask:209 · T/Harvest:591, 604, 800 · T/HarvesterTask:458, 478, 681, 790 · T/GetFood:288 · T/GetCorn:183 · T/Patrol:125 · T/DropItem:105 · T/PickUp:83 (CHTR only) · T/LockPicking:90 · BoardingMgr:298 | `WallWalkAction(target, true, speed, false)` instead of `WalkAction` |
| T/DeliverResources:95 · T/Mine:420 · T/GetFood:433 · T/GetCorn:290 · T/Harvest:959 · T/HarvesterTask:884 · T/GetUnlimited:160, 227 · T/MineTask:279 | `AdvanceWallAction(target, p, true, false)` instead of `AdvanceAction` |
| T/HealUnits:221-225 | healer on a wall: `AdvanceWallAction(patient, p, !patient.onWall, user)` |
| T/Termites:89 · T/Insects:102 · T/QuicksandTask:81 · T/Tornado:91 · T/Resurrect:125 · T/ShootBurningArrow:92 · T/MayorSpecialMove:402 · T/BabbageMinigun:117, 124 | out of range → **the task ends**; the caster does not walk |
| T/Shotgun:155, 170 · T/Throwdownshot:88 · T/MickDundeeMove:80 | "movable in fight" units do not advance from a wall; the move ends |
| T/Fireworks:65-77 | state `point_wall`: the fireworks object spawns 1.5 m in front of the monk |
| DW:408-409 | a ladder builder on a wall wall-walks with walk set `sldr` |
| DW:556, 590, 737, 797, 940, 968 | the climb tasks skip their walk-to-entry when already on a wall, and end at the top instead of jumping down |
| FO:4383 | no knockback for a victim on a wall |
| FO:7959-7961 | the ranged defence bonus (§3.1) |

---

## 3. Combat

### 3.1 Defence bonus
* `AddTemporaryRangedDefenseBoni(p)` adds `MiscValues/<playerTribe>/Defence_On_Wall` when the unit is on a wall
  (FO:7952-7961).
  * The value is **50 for Hu, Aje and Ninigi** (TTR:55-66).
  * **SEAS has no entry, so the bonus is 0.** The lookup uses the *player's* tribe (`GetPlayerTribeName`).
* The bonus applies only to **ranged protection**:
  * projectile hits: `fDefense = dmg × clamp((RProt − AP + bonus) / 100, 0, 0.99)` (FO:4073-4077);
  * `TakeDirectDmg` (FO:4554-4559).

  Melee hits and `TakeDirectMeleeDmg` use `AddTemporaryDefenseBoni`, which has **no wall term** (FO:7894-7929).
* `SetOnWall` refreshes the shown `TmpDefenseBoni` / ranged attributes and the buffs `more_defense` / `less_defense`
  (FO:1981, CH:2227).
* Armour-piercing weapons (AP 99) ignore it in practice: the bonus is added *after* `max(0, RProt − AP)`.
  A unit with RProt 10 hit by AP 99 still gets 0 + 50 = 50 %.
* No attack, damage or range bonus exists for units on a wall.

### 3.2 Who can hit whom (`IsInCombatRange`, FO:5027-5135; combat.md §1.4)
* **Height test:** `heightOk = |zA − zV| < min(7, sizeZ of the lower unit)` (FO:5080-5094).
  * With the wall top at about 7.8 m, `heightOk` is **false** for every pair where one unit stands on a wall and the
    other on the ground.
  * Two units on the same wall pass.
* **Projectile users** (`bPrimProj`) are tested even without `heightOk`, and in zone 3 (primary range) they hit
  (FO:5096, 5116-5121). Their short and medium secondary weapons need `heightOk` (FO:5123).
* **So: melee units can never fight across the wall height in either direction. Archers, throwers, guns and towers
  can.** Penetration weapons with range > 5 also count as "primary projectile" (FO:5070-5072).
* **LOS** (`CheckLineOfSightFight`) is required except in zone 3 with a primary projectile, or when either side is a
  building (FO:5105-5110). Ranged fire from or to a wall therefore needs no LOS test.
* **Range from height** [?engine]:
  * the projectile fall-off cone `FALLOFFCONE_VAL / attackRange` (`0.5`, FO:930, FO:7030-7035) is passed to the engine
    zone test;
  * per the constant's comment it gives **+0.5 m range per metre of height advantage**. A shooter on a wall therefore
    gets about +3.9 m against ground targets.
  * **Recommendation:** `range += 0.5 × max(0, zA − zV)`.
* **Projectiles** start at the `Proj` link or at `pos + 0.7 × height` (combat.md §3). They need no special case,
  because the shooter's position already includes the wall height.
* **Knockback** never affects a unit on a wall (FO:4383). Area throws in MIRAGE skip it too (moves_mirage.md:1015).

---

## 4. Ladders (hu_ladder, class CLadder)

### 4.1 Data
* **Action** `Actions/Hu/Build/BLDG/hu_ladder` (TTR:9717-9756):
  * location hu_worker; result `/Objects/Hu/BLDG/hu_ladder`;
  * **duration 2 s**, **0 f / 20 w / 0 s / 0 i**, requires **age_2**;
  * `visibility -1`. The `age_2` filter adds +1 (TTR:109500-109504), and AntiActions hides the button
    (TTR:105000-105008).
* **Object** (TTR:38364-38400): **1000 HP**, FOW 35, timefactor 2, `gate = 1`, `wall = 0`, fx_class Wood.
  It has a destroyed model `hu_ladder_dest`.
* **Model links:**
  * `Wo_1` = foot (0, −0.36, 0);
  * `Wo_2` = top (0, 4.27, 7.61) → climb length ≈ 8.9 m;
  * `Bl_*` links for building props.

### 4.2 Building a ladder (`CBuildLadder`, DW:328-455)
* **Order.**
  * Client: the build button goes through the placer's gate path. The WallMap picks the wall under the cursor, and the
    client sends `"Action", wall, pos, "/Actions/Hu/Build/BLDG/hu_ladder"` (PC:486-498, SIC:360-372).
  * Server: `/hu_ladder` on a `CWall` → `BuildLadder(wall)` (CH:2040-2044, CH:1644-1651).
  * The task is added as a user command, **not queued**.
  * The task is created as "BldLddr" (TK:154-155) but names itself "BuildUp" (DW:340).
* **Every tick:** if wall or worker is gone → end. If `GetWallSiege(wall)` is not null (the wall already has a siege
  object) → end (DW:385-391). **One siege object per wall tile.**
* **States:**
  1. `find_pos`:
     * `buildPos = wall.pos`, then `GetFreeDockPos(owner, buildPos, worker.pos)` (result ignored);
     * stand point `curDest = GetFreePos(buildPos)`;
     * `findCnt++` (DW:395-402).
  2. `goto_wall`:
     * the worker carries the prop `Hu_Clerk` on link `HndR` (removed again on leave, DW:404-406, 449-454);
     * walk with walk set `sldr` (`WallWalkAction` if on a wall) at max speed (DW:407-412).
  3. `place_ladder`:
     * More than **2 m** from the stand point → `find_pos` again, at most 3 tries (`findCnt > 2` → end) (DW:415-421).
     * A ladder of the global "pending ladder" list exists (`CLadder.GetLadderBuildUp(-1)`, B:2065-2073) → the worker
       gets `Q_Build` on it (DW:423-425).
       **Quirk:** the list is static and every entry uses command id −1, so any unfinished ladder of any player
       qualifies. **Remake:** look only for an unfinished own ladder at *this* wall.
     * Otherwise `PlaceMgr.PlaceObj(owner, "hu_ladder", buildPos, rot 0, [worker], queued = true, wall-path = true)`.
       This **pays 20 wood** and skips the place check (walls.md §3.4). Then (DW:427-441):
       * register the ladder in the pending list;
       * rotate it to face the wall (`FromXYDir(wall − buildPos)`);
       * `dockInfo.SetDocked(true, wall)`.
     * End. The placed object starts construction with the worker as builder (2 s base duration, buildings.md §1.3).
* **`SetReady`** (B:2100-2104):
  * `SetDockedDocker(true, ladder)` → `AddAdditionalEntrance(ladder, wall, Wo_1 in object space, Climb)` (DW:49-57);
  * unregister from the pending list.
* **`Delete`** → `RemoveAdditionalEntrance` (B:2106-2109).
* The trigger action `"Hu Ladder"` (AF:1372-1377) sends `/hu_ladder` with a **null** object. CH:2041 needs a `CWall`,
  so the action does nothing (dead).

### 4.3 Lifetime, destruction, ownership
* **No timer:** the ladder stays until destroyed. It is an ordinary building: attackable, repairable, 1000 HP.
  The CWall "ignore unless prioritised" targeting rule does not apply to it.
* **Owner** = the builder's player.
  * The client offers "ClimbLadder" only on **own** ladders (GIC:838-853). An enemy right-click attacks it.
  * The entrance is registered per docker. [?engine] Whether enemies may path through it is unknown.
  * **Recommendation:** owner and allies use it; enemies destroy it.
* **The wall dies.** CLadder has no handler. [?engine] The WallMap drops the entrance with the wall.
  **Recommendation:** remove the entrance; the ladder object stays as a leftover until destroyed.

### 4.4 Climbing (`CClimbLadder`, DW:458-631)
* **Start.** It pauses the current action. Each state waits until no secondary action is running (DW:516-528).
* **Positions** (DW:530-552, 611-629):
  * `entry = Wo_1` (world), `top = Wo_2` (world);
  * `n = normalize(wall.pos − ladder.pos)`;
  * `exit = wall.pos + 4·n` at ground height.
  * `frontSide = dist²(worker, wall − n) < dist²(worker, wall + n)`, i.e. the worker is on the ladder's side.
  * From the far side (`!frontSide`): `climbForward = false`, `entry = exit`, `exit = Wo_1`, and `top` takes the xy of
    the new entry.
* **States:**
  1. `trip`: anim `trip` (3 loops), `SecondaryMoveAction(entry, 5.0)` (DW:554-562). The walk-to-entry branch is
     disabled by `if(false&&…)`.
  2. `rotate`: `SecondaryRotateAction(ladder.rot (+180° when !forward))`.
  3. `move`: SLE anim `climb_down_ladder` when forward, `hu_high_ladder_climb_up` when backward (sic, swapped names),
     then `SecondaryMoveAction(top, 3.65 m/s)`. About 2.4 s for the 8.9 m ladder (DW:571-583).
  4. Then either:
     * `jumpOff`: already on the wall → end. Otherwise `JumpAction("climb_up_ladder", GetFreePos(exit), rot, 0.0, 20.0)`:
       the unit lands on the far side of the wall (DW:588-593).
     * not `jumpOff`: `trip_end` (anim `trip`, move to `top` at 5.0) → end. The unit is now on the wall [?engine sets OnWall].
* **Callers:**
  * `ClimbLadder` command and `CLadder.Climb` callback: `jumpOff = false` (CH:2007-2008, B:2093-2098);
  * `DoStartSiegeClimb`: `jumpOff = true` (CH:468-469).
* **Climbing down** (`bUp = false` from the callback) uses the same task. `m_bClimbUp` is stored but never read; the
  direction comes only from `frontSide`.

---

## 5. Siege towers and the siege brachiosaurus

### 5.1 Data
* **ninigi_siegetower** (class `CSiegeTower`, `Server/classes/misc/ninigi_products.txt:155-158`):
  * built at ninigi_engineer: **50 f / 100 w**, **20 s**, `age_2`, spawns at level 2 (TTR:21447-21487);
  * visible from age_2 (TTR:126131-126135);
  * level-2 stats **1800 HP**, `max_passengers = 5`, speed 2, scalps 35, captain `ninigi_rider_a`
    (TTR:134476-134540);
  * cannot fight (VH:506-508), `SetNoAutoMove`, transport class 1, build-up `TYPE_TRANSPORTER` (VH:458-469);
  * model links `psh1` (0, 0, 12.1) and `psh2` (0, 0.44, 12.18), unused by the scripts for this class.
* **Siege brachiosaurus** = aje_brachiosaurus with build-up `TYPE_SIEGE` and the linked object
  `aje_brachiosaurus_siege` (AN:1839-1849):
  * the brachio cannot fight in this mode; the rider sits on link `Ride` (AN:1858-1862);
  * built at a huge farm for **1200 f / 300 w / 120 s, 50 s**, spawned at level 3 (TTR:13189-13235);
  * or converted from a brachio for 0 / 150 / 150 (TTR:15157-15230);
  * entry links `psh1` (bottom) and `psh2` (top) on the siege object (DW:19-35).

### 5.2 Docking (`CDockWall`, DW:79-326)
* **Siege tower order:**
  * `Fight(target)` on a `CWall` docks instead of attacking (VH:511-514). Right-clicking an enemy wall therefore docks.
  * `"Dock"` (right-click an own building with VHCL/ANML selected, GIC:869-871, 892-893) also docks (VH:546-551).
  * `Dock2Wall`: needs `IsAbleToWalk`; a bot command does not replace a user command (VH:525-543).
    **"TODO: check the wall is walkable"** (VH:528): any CWall is accepted.
* **Brachio order.** `Dock2Wall`/`InvokeDock` exist (AN:1892-1916) but no script calls them [?engine]. When the docked
  wall is deleted, `OnDockedWallDeleted` → `BreakSiege` (AN:1887-1889). While docked it ignores `/GoAway`
  (AN:1957-1959).
* **States** (DW:156-295):
  1. `find_pos`:
     * `dest = GetFreeDockPos(owner, wall.pos, docker.pos)`; failure → end;
     * a brachio stands **2 m further back** (DW:183-188).
  2. `goto_wall`: `WalkAction(dest, maxSpeed)`.
  3. `rotate_to_wall`:
     * more than **2 m** off (dist² > 4) → retry, at most 3 finds;
     * otherwise face the wall. The brachio uses `RotateAction`; the siege tower uses `RotateAction` **+180°**, so its
       back faces the wall; others `SetRot`.
  4. `dock_wall` (DW:220-246):
     * the tower plays `opengate_moveup`, or `opengate` against palisades (class contains "palisade" but not
       "ninigi_palisade") and defense skewers, i.e. the low non-walkable walls;
     * the brachio plays SLE `siege` and its siege object `siege_down`.
  5. `docking`: after **2.0 s**, `SetDockedDocker(true)` → `AddAdditionalEntrance`. Failure → undock; success →
     `docked` (DW:247-259).
  6. `docked`: the task's FSM is disabled, so it no longer ticks (DW:260-262).
  7. `undock_wall`: reverse anims (tower `SetAnim(anim, 2)`, brachio `siege` reversed, then `siege_up`), then
     `undocking` for **2.0 s** → `RemoveAdditionalEntrance` → end (DW:263-291).
* **Break** (a new order): docked → re-enable and undock first (returns false, so the new order waits). While
  docking or undocking it waits (DW:300-316).
* **The wall object disappears** → `undock_wall` (DW:168-172).
* **Siege-tower entrance quirk.**
  * `GetEntryPos` handles only ladders (`Wo_1`) and transports with a `TYPE_SIEGE` build-up (`psh1`).
  * For CSiegeTower it returns false, so the entrance is registered at (0, 0, 0) with no callback (DW:20-22, 53-57).
  * The tower's dock callback is never set. Climbing it goes through `DoStartSiegeClimb` [?engine].

### 5.3 Using a docked siege object
* **Siege tower: over the wall** (`CClimbSiegeTower`, DW:846-1009):
  * `entry = tower.pos`, `top = entry + (0, 0, 7.8)`, `exit = wall.pos + 4·n` (ground).
  * Forward: `top2 = (exit.xy, top.z)`.
  * Sequence:
    1. walk to the entry when more than 5 m away (speed 2);
    2. rotate (tower rot +180°);
    3. `trip` → entry at 5.0;
    4. anim `climb_down_ladder` → top at 3.65 (≈ 2.1 s);
    5. SLE `walk_2` → top2 at 3.65;
    6. if on a wall → end; else `JumpAction("climb_up_ladder", GetFreePos(exit), …, 0, 20)`.
  * Result: the unit **crosses the wall and lands 4 m past the wall centre**.
  * Backward branch quirk: `m_vExit` is read before it is set (DW:923).
* **Siege tower: dismount** (`/Dismount` while docked → `SiegeDismount` → `CLeaveSiegeTower`, VH:552-575,
  DW:1011-1107):
  * the passenger is removed from the tower and, after three empty placeholder states (about 3 ticks), **set**
    (`SetPos`, no animation) at `wall.pos + n·wall.radius` on the ground, then `GetFreePos`;
  * this puts it on the **far side** of the wall, not on top;
  * `/AttackSrv` is ignored while docked (VH:555-556).
* **Brachio** (`CClimbBrachio`, DW:633-844):
  * `entry = psh1`, `top = psh2`, `exit = wall.pos + 4·n`.
  * Boarding a docked brachio climbs with `jumpOff = false`: anim `climb_up_brachio` (or `climb_down_brachio`) to
    `top` at 3.65, then on to `top2` above the exit. The unit stays up if the engine flags it on the wall.
  * With `jumpOff = true` (crossing): one move `entry → exit`:
    * forward: anim `brachio_siege_up`, lasting **3.0 s** (speed = distance / 3.0);
    * backward: anim `brachio_siege_back`, lasting **3.6 s**.
  * `m_vTop2.GetX() >= 0` serves as a "set" marker (DW:754, 776). This fails for negative coordinates; the remake
    should use a flag.

---

## 6. A wall dies with units on it
* The engine sends a WallMap event `WCT_Destroyed` to the characters on the destroyed segment [?engine: which units
  and how far]. `CCharacter.HandleEvent` (CH:2165-2174) then:
  1. `TaskMgr.Break()`: the current order is dropped.
  2. `FallAction({0, 0, −0.35}, "hit_front", "getting_up")`.
  3. `TakeDirectMeleeDmg((pos.z − groundHeight) × 5)`, computed at the moment of the event, i.e. from the wall top.
     The damage is reduced by **melee** protection: `dmg × (1 − clamp(TempDef(Prot − 0) / 100, 0, 0.99))`
     (FO:4586-4592). The on-wall bonus does not apply here because it is ranged-only.
  * With a 7.8 m wall that is **39 raw damage**.
  * Invulnerable units take none (FO:4587).
  * The code's own ToDo (CH:2168) says the damage should come on landing. The script applies it at once.
* **Ladder / brachio / siege tower** on the dead wall: §4.3, AN:1887 and DW:168-172 (the dock is released).
* **Units on other segments** of the same line stay up. [?engine] The walk graph splits at the gap.
  **Recommendation:** a unit whose tile no longer connects to any exit stays put and can still use `JumpOffWall`.
  Orders to the ground then fail.
* **Gates and towers dying** do not send the event (only CWall is a walkable wall).

---

## 7. AI (references only)
* The AI never builds ladders or docks siege objects:
  * the siege-tower and siege-brachio branches are commented out (`Ai/goals/AiGoalSingleplayerAttack.usl:860, 930`;
    `Ai/misc/AiUtilityMgr.usl:860, 932`; `Ai/misc/AiImprovementMgr.usl:545, 615, 916, 988`);
  * the remake already lists `ninigi_siegetower` as not-army (`src/game/ai/army.js:6`).
* Attacks break *through* walls that block the path instead of climbing them (`Ai/tasks/AiTaskAttackObject.usl:803-851`).
* **Defence:**
  * `AiGoalBuildVillageWalls.UnitsOnWalls` (`Ai/goals/AiGoalBuildVillageWalls.usl:796-840`), from age 3 when the
    village has a gate:
    * finds a wall within 36 m of the gate;
    * if it is hu_small_wall, hu_re_enforced_wall or aje_clay_wall, sends up to 10 batches of its requested archers
      there with `"Use"` and sets their aggro state to 0.
  * The archers come from `RequestUnits`: 3 hu_archer or aje_archer (same file :843-866).
  * Ninigi are never sent, and the class query uses the wrong index (`m_asWallClasses[i]`, :812).

---

## 8. Implementation plan for the remake

### 8.1 How walls work today (orientation)
* `rules.js:133-136` gives `def.wallKind` ∈ `wall | gate | tower | trap`. `hu_ladder` (CLadder, `gate = 1`) gets
  `null` and is an ordinary building.
* `wallmap.js` keeps the 8 m tile grid (`tiles: "i,j" → {wall, gate, tower, trap}`) and the arm masks (`mask`, with the
  L-corner rule). It calls `wall.setArms` → `entities.js:755-770`, which re-stamps the nav cells from `wallBoxes(mask)`.
* `nav.js` has one ground `NavGrid` (a block counter per 2 m cell plus `gateAt`). `world.navFor(u)` (`world.js:104`)
  already chooses between the land, water and amphibious grids.
* Unit height is `world.groundY(u)` each frame (`world.js:96-102`, `world.js:589`).
* Transports (`systems/transport.js`): ninigi_siegetower is a plain closed class-1 transport with 5 seats.
* Combat (`systems/combat.js:61-82` `rangeZone`) has **no height test**. `tempRangedDef` (`systems/effects.js:48`) has
  no wall term.

### 8.2 Data
* `rules.js`:
  * `def.walkable = true` for the WCC walkable classes. Read WCC, or hard-code the 4 names (§1.1); for upgraded Hu
    walls, take it from the current gfx;
  * `def.wallKind = 'siege'` for `CLadder`;
  * `def.dockable = true` for `CSiegeTower`, and for the brachio while it has the siege build-up.
* Constants:
  * `WALL_TOP = 7.8`, `FALL_DMG_PER_M = 5`;
  * `DEF_ON_WALL = {Hu: 50, Aje: 50, Ninigi: 50}` (from TT `MiscValues`);
  * dock timings 2.0 s / 2.0 s;
  * climb speeds 5.0 (trip) and 3.65 (climb), jump speed 20;
  * ladder exit `4 m` past the wall centre;
  * ladder/tower stand-point tolerance 2 m, 3 tries.

### 8.3 Unit state
* `u.onWall = null | {tile: [i, j]}`.
* `u.climb = {kind: 'ladder' | 'tower' | 'brachio' | 'own', phase, from, to, t}` while climbing. The unit is
  untargetable by melee and cannot be ordered until the climb ends (as in the original's paused action).
* Save these in `save.js` next to the task.

### 8.4 The wall-top graph (new, in `wallmap.js`)
* **Nodes:** walkable wall tiles (`t.wall && t.wall.def.walkable && built`). [?] Leave towers and gates out:
  the walkway stops at them.
* **Edges:** the tile's arm mask (`mask(i, j)`), i.e. the same connections that are drawn.
* **Positions:** tile centres, plus arm midpoints for smooth diagonal steps. The height is the ground height at the
  tile centre + `WALL_TOP`.
* **Entrances:** `entrances: Map<tileKey, [{x, z, kind, obj}]>`.
  * `own`: every edge of an own walkable tile; the ground stand point is 4 m from the centre, perpendicular to the
    tile's arms.
  * `ladder`: the ladder's foot `Wo_1`.
  * `brachio`: `psh1`.
  * Ladder and brachio entrances are added on dock / `SetReady` and removed on delete or undock.
* **`wallPath(u, from, to)`:** BFS/A* over tiles. Add a combined ground + wall search: ground A* to an entrance, a
  climb edge (cost ≈ 2 s × speed), the wall graph, a climb edge down, then ground A*. Keep it simple: try every
  entrance within 60 m of start and goal.
* **`groundY(u)`** (`world.js:96`): `u.onWall ? tileTopY : ground`.

### 8.5 Functions to change
1. **`world.order` / `unitUpdate`** (`world.js:265-395`). Add these orders:
   * `use` on an own walkable wall: path to an own entrance, climb, walk to the tile;
   * `climbLadder` on an own ladder;
   * `jumpOffWall`, for scripts only.

   For every move-like order of a unit with `u.onWall`, route through `wallPath` with `toGround = true`. That covers
   move, gather, build, repair, deliver, heal and pick up (§2.3, first two rows).
2. **`entities.js setPath / steer`** (`:288-375`). When on a wall, follow tile waypoints and skip the nav-grid
   collision. Ground units must never step onto wall cells, as today.
3. **Special moves** (`systems/moves.js`). For the 8 tasks of §2.3 row 4, end the move instead of walking when the
   caster is on a wall. For shotgun, throwdown shot and Mick Dundee, do not advance.
4. **`combat.js rangeZone` / `inRange`.**
   * Add `heightOk = |Δy| < min(7, lowerUnit.sizeZ)`. Without it only the primary projectile zone 3 (or penetration
     with range > 5) counts.
   * Add the +0.5 m range per metre of height advantage for projectiles.
   * `FollowEnemy`: a melee unit whose target is on a wall paths via `wallPath` (only through entrances it may use).
     A ranged unit shoots from where it is.
5. **`effects.js tempRangedDef`** (`:48`): `+ (e.onWall ? DEF_ON_WALL[e.owner.tribe] || 0 : 0)`.
   `combat.js` knockback (`:455`): skip it when `V.onWall`.
6. **AI aggression** (`combat.js` leash / `CheckPatrol` equivalent): no return walk while on a wall. `goAway` is
   ignored.
7. **`construction.js`.** A new `placeLadder(worker, wall)`:
   * fail if the wall tile already has a siege object;
   * dock spot = the tile edge nearest the worker, 4 m out (stand-in for `GetFreeDockPos` [?engine]);
   * pay 20 wood; create `hu_ladder` facing the wall; give the worker the `build` order.

   `finishBuilding` on a ladder → `wallmap.addEntrance`. `buildingDestroyed` on a ladder → `removeEntrance`.
8. **`construction.js buildingDestroyed`** (`:434`) for a walkable wall:
   * for each unit with `onWall.tile` on that tile: drop its task, play `hit_front` → `getting_up`, set
     `u.onWall = null` (y falls to the ground), and apply
     `meleeDirect(u, (y − ground) × 5)` (combat.js `directDamage`, melee protection);
   * remove that tile's entrances; undock siege objects there (2 s undock).
9. **`transport.js`** for the siege tower:
   * `dockWall(tower, wall)` follows the §5.2 state machine;
   * the `attack` order on a CWall becomes dock;
   * `/Dismount` while docked → place the passenger at `wall.pos + n·wall.radius` on the far side (`leaveSiegeTower`);
   * a ground path that crosses a docked wall may use the tower (§5.3) when the unit is next to it.

   Brachio siege mode: the same dock machine. Boarding a docked brachio → brachio climb.
10. **`ui/input.js`.**
    * Right-click own walkable wall with characters → `use`. Own ladder → `climbLadder`. Wall with a siege tower →
      dock. Enemy wall with workers in ladder mode → `placeLadder`.
    * Show `hu_ladder` in the Hu worker build menu from age 2 (gate-style cursor snap to the wall tile under the mouse).
11. **Visuals.**
    * Characters on walls render at `tileTopY`.
    * Climb anims: `climb_down_ladder`, `hu_high_ladder_climb_up`, `climb_up_ladder` (jump), `trip`,
      `climb_up_brachio`, `climb_down_brachio`, `brachio_siege_up`, `brachio_siege_back`, `jump_wall`,
      `palisade_climb_up` / `_down` for own walls [?].
    * Siege tower `opengate_moveup` / `opengate`; brachio `siege` + `siege_down` / `siege_up`.
    * Corpse anim on a wall: `hit_rotate_s`.

### 8.6 What the remake does (`src/game/systems/wallwalk.js`, `siege.js`)
* **PWServer.exe `CActWallWalk`** answers question 1 below: the engine's wall walk gets a unit on and off a wall with a
  jump action, anim `jump_wall` (string `?jump_wall`, 0x4a4c74), speed 20. The remake: a character sent up an own
  walkable wall walks to a free side of the piece (4.5 m from its centre, a side without an arm) and jumps up
  (`jump_wall`, ~1.2 s); down the same way (`jump_of_wall`).
* Walkable classes come from `wallclassconfig_ex.txt` (the file the engine reads) → gamedata `walkableWalls`.
* The walkway: built walkable pieces, connected along their arm masks; towers and gates are not part of it. Height
  `WALL_TOP` 7.8 m over the ground at the tile centre, blended between neighbouring centres. Units walk straight
  from centre to centre (no nav grid on the walkway); they are left out of the push-apart of the ground units.
* Orders while on the walkway (`wallOrder`): stop / hold stay up; `use` on a piece of the same walkway walks there;
  `attack` fights from the wall (a target out of reach on the same walkway is followed along it; on an order of the
  player the unit goes down after a ground target; an automatic fight ends); anything else goes down first — to
  the piece with a free side (own walls) or a ladder of the unit's side that leaves the shortest walk — then the
  order. A ground task started while up (a resumed job) does the same and starts again below.
* Combat: `rangeZone` has the height rule (`heightOk`, zone 3 for primary projectiles only, also when one is
  closer than the secondary range — the original's would not shoot there) and +0.5 m range per metre shooting
  down; the line of sight for blows (`fightLos`: the walk grid's blocked cells between the two, the cells at either
  unit not counted; not for zone 3 projectiles, buildings, units on walls). `canTarget` skips targets across the
  height for fighters without a way up. A melee unit after a target on a wall goes up its own wall or a ladder of
  its side, else gives up. Defence_On_Wall in `tempRangedDef` (and the `more_defense` buff); no knockback; no walk
  back to the post (`endAttack`); idle units on a wall hold.
* Ladders: `hu_ladder` placement through the wall placer path (`placement` → `ladderPlacement`: the side nearest
  the selected workers, 5.3 m out so the top Wo_2 lands on the walkway, turned by its Wo_2 link; no place check,
  not blocking, no terrain adaption); the climb anims as named (`hu_high_ladder_climb_up`, `climb_down_ladder`,
  `trip`, `climb_up_ladder` for the jump over a wall without walkway) — not the original's swapped ones. Owner and
  allies use it. The pending-ladder list quirk, the dead trigger and the `x >= 0` markers are not copied.
* Siege tower: attack / dock order on a wall piece → `dock` task (find a free side, walk, turn its back to the
  wall, `opengate_moveup` / `opengate`, 2 s); passengers unloaded while docked land on the far side; a new order
  undocks first (`closegate`, 2 s). The crossing climb `CClimbSiegeTower` (started by the engine's path finder) is
  not done. Siege brachiosaurus: the same dock (facing the wall, `siege_down` / `siege_up` of its build-up), and an
  entrance like a ladder (board order on it → climb psh1 → psh2 → walkway).
* The fall: `buildingDestroyed` of a wall piece → `wallPieceGone`: the characters on its tile fall (`hit_front`,
  `getting_up`) with (height × 5) melee-protected damage; a piece replaced by a gate or tower drops them unhurt.
  Its ladder or docked vehicle loses its hold (the vehicle undocks). Death on a wall: `hit_rotate_s`.
* Not done: the AI's archers on walls (`UnitsOnWalls`, with the AI walls of group 6), `JumpOffWall` (trigger only),
  the Hu wall upgrade re-skin (`WallClassChanged`: the remake has no wall upgrades), the 1.4 m ring of PWClient's
  decal list for units with a list at +0x29c (meaning unknown).

### 8.7 Open questions [?engine]
1. How units get onto **own** walls without a siege object (§1.3). The recommendation is the climb anims at any edge.
2. Whether allies and enemies may use another player's ladder entrance.
3. Whether gates and towers are part of the walkway.
4. Exactly which units receive `WCT_Destroyed`. Assumed: the units on the destroyed tile.
5. When the engine calls `SetOnWall(true)` after a climb. Assumed: when the climb's last move ends on a walkable tile.
6. Who calls `CCharacter.DoStartSiegeClimb` and `CBrachiosaurus.Dock2Wall`. Assumed: the pathfinder for ground paths
   crossing a sieged wall, and the attack or dock order for the brachio, like the siege tower.
