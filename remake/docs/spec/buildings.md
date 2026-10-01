# ParaWorld rules spec: special buildings & building mechanics

Source: original server scripts (UrsRel Script). Abbreviations used in references:
- `B:` = `Data/Base/Scripts/Server/classes/buildings/Building.usl`
- `FO:` = `classes/FightingObj/FightingObj.usl`, `CH:` = `classes/character/character.usl`
- `T/<file>` = `classes/task/<file>`, `SA:` = `ServerApp.usl`, `GO:` = `misc/GameOverMgr.usl`
- `TT` = `/home/claude/pwr/techtree.json` (`StartTT.Actions`, `StartTT.Objects`, `Filters`)

Units: distances are in world metres. Times are game seconds. Costs are listed as food/wood/stone(/iron).
Weapon rule used everywhere: `reload = 60 / weapon.frequency` s (frequency 0 counts as 1), see `FO:7491-7499`.
`TakeDmg(this)` means "the object hits the victim with its own techtree weapon": damage, armour and armour piercing all apply.
"Engine" means C++ behaviour the scripts only call. Those parts are approximations and are marked **(engine)**.

BoosterPack1 changes only one thing here: `aje_skull_protector` gets its real gfx (`aje_skull_protector`/`_dest`, it used to be the scarecrow model). Nothing else in the building scripts is overridden.

---
## 0. Object → script-class map (buildings of the 4 playable tribes)

| Class | Hu | Aje | Ninigi | SEAS |
|---|---|---|---|---|
| CFireplace (HQ) | hu_fireplace | – (HQ is the unit aje_resource_collector) | ninigi_fireplace | seas_headquarters |
| CBuilding (plain) | hu_stone_cottage | aje_tent | ninigi_telescope_tower | seas_laboratory |
| CLargeHouse | – | aje_big_tent (gfx only) | – | – |
| CRallyBuilding | hu_arena, hu_small_animal_farm(+big), hu_machine_maker, hu_weapons_smith | aje_small/medium/huge_farm, aje_rodeo, aje_weapons_builder | ninigi_dojo, ninigi_engineer, ninigi_weapon_maker, ninigi_animal_farm | seas_barracks, seas_garage |
| CLumbermill/CStonemason/CHuntingLodge/CNinigiLumbermill | hu_lumberjack_cottage, hu_stone_quarry | – | ninigi_lumbermill, ninigi_stone_quarry, ninigi_hunting_lodge | – |
| CWarehouse / CMarketplace | hu_warehouse / hu_marketplace | aje_bazaar | ninigi_warehouse | – |
| CGrowingField / CCornfield / CAjeUnlimitedBuilding | hu_corn_field (CCornfield) | aje_slaughterhouse | ninigi_paddy, ninigi_bamboofarm | seas_greenhouse |
| CTower | hu_small/medium/large_tower | aje_small_tower, aje_medium_tower | – | – |
| CTower subclasses | hu_bunker (CBunker) | aje_tesla_tower (CTeslaTower) | ninigi_small_tower (CNinigiSmallTower), ninigi_rocket_ramp (CRocketRamp) | seas_turret_tower (CSeasTurretTower) |
| CTemple | hu_temple | aje_temple | ninigi_temple | – |
| CNPCSeller (hero shop) | hu_tavern | aje_cook_house | ninigi_teahouse | – |
| CWall | hu_palisade, hu_small_wall, hu_re_enforced_wall | aje_bone_palisade, aje_clay_wall | ninigi_palisade | seas_fence |
| CGate | hu_palisade_gate, hu_small_wall_gate, hu_re_enforced_wall_gate | aje_bone_palisade_gate, aje_clay_wall_gate | ninigi_palisade_gate | seas_gate |
| CNinigi_Defense_Skewer(_Gate) | – | – | ninigi_defense_skewer(_gate) | – |
| CLadder | hu_ladder | – | – | – |
| CHarbour / CSwimmingHarbour / CSeasCarrier | hu_harbour | aje_floating_harbour (swimming) | ninigi_harbour | seas_carrier |
| CMagicCauldron | hu_magic_cauldron | – | – | – |
| CScareCrow | – | aje_scarecrow | – | – |
| CSkullProtector | – | aje_skull_protector | – | – |
| CCauldron | – | – | ninigi_cauldron | – |
| CKennel | hu_kennel | – | – | – |
| CNinigi_Dilophosaurus_Nest | – | – | ninigi_dilophosaurus_nest | – |
| CStealthBuilding | – | – | ninigi_smoke_tower | – |
| Traps | – | Aje_Quicksand_Trap (CQuicksand, spawned by a spell) | ninigi_pitfall (CPitfall), ninigi_minefield (CMinefield), ninigi_snare_trap (CSnareTrap), ninigi_poison_trap (CPoisonDung), ninigi_resin_field (CImpResinField) | – |
| CWarpGate | hu_warpgate | aje_warpgate | ninigi_warpgate | – |
| CLaunchPad | – | – | ninigi_telescope_tower_ruins, carrier_launch_pad (sl_carrier) | – |

Nothing uses `CHuTavern`, `CRecruitPool`, `CResinField`, `CResiner`, `CNonInventGrill` or `CSearchTraps` any more. They are legacy code (§12).
`*_dest` objects are plain `CGameObj` models used by the corpse (§1.6).

---
## 1. CBuilding (base): `B:7-1071`

### 1.1 Common init (`B:156-241`)
- Type `BLDG`, selectable, hittable. It cannot walk, swim or fly and is a place blocker. It uses a free-border blocker, except walls, gates and CNoFreeBorderBlockerBuilding.
- `m_bBuildingReady=false`. `SetMaxBuilders(10)`, but the cap is **not enforced** (the check is commented out, `T/BuildUpBuilding.usl:198`).
- `CScareMap.AddScareSource(pos, radius*2, 10)`: wild animals avoid buildings.
- Inventory has 6 slots. Buildings never count toward the unit limit (`DoesCountInUnitLimit=false`).
- FOW range is 0 while under construction. Once ready it is `Objects/<tribe>/BLDG/<class>/FOW` (default 25) (`B:342-349`).
- The night-mode timer toggles the lit/unlit gfx flags every 20 s (every 0.2 s in "party mode") (`B:459-466, 976-983`). Cosmetic.
- Buildings cannot be iced (`SetIced` is a no-op). They can only be "trapped" when ready.
- `AttackEnemy` returns false for plain buildings, so they do not defend themselves. When hit, a non-wall building calls `ShoutForHelp` (`B:336-340`).

### 1.2 Placement & payment (`SA:1100-1370`, `CH:1818`)
1. A worker receives `RaiseBuilding(pos, "rot!class")` → `CPlaceMgr.PlaceObj(owner, class, pos, rot, [worker], queued, bWall)`. `bWall` is true only for the class-name prefixes `hu_palisade`, `hu_small_wall` and `hu_re_enforced_wall`.
2. Coastal objects (`coastal=1`) snap to the coast. Non-wall, non-gate objects must pass the engine place check.
3. `CheckConditionsAndPay(owner, "/Actions/<tribe>/Build/BLDG/<class>")` checks the full cost and **pays it up front** at placement. It also checks tech requirements.
4. The object is created and `SetBuildAction(path)` is stored. Terrain is adapted and vegetation, stumps and craters inside `radius` are deleted.
5. `HandleGamePlayCommand("BuildUp")` → `BuildUp()` (§1.3). Every selected worker that `CanBuild()` gets `Build`/`Q_Build`. The others walk to the spot.
6. Walls: each segment is a separate object and is paid separately. `CalculateWalls` (0.15 s after the last placement, `SA:987`) gives every segment a `BuildVector`: a stand point about 4 m to the builder side of the wall, rotated per segment. Workers stand there to hammer.

### 1.3 Construction (`B:900-920`, `T/BuildUpBuilding.usl`, `T/BuildUp.usl`)
State machine of the building (`CBuildUpBuilding`, task "BuildUpB"):
```
BuildUp(path):
  ConstructLevel=0; attach crane gfx on links Cr_1..Cr_4 (<Tribe>_Crane_01/02, anim "none")
  attrib CurTask="BuildUp", CurProcess=0
  task.Init: D = TT Actions/<tribe>/Build/BLDG/<class>/duration (default 10)
             progress = CurProcess (resume), HP := 1
             apply "resultactions" filters of the build action (if any)
  OnEnter: push away units within building radius (non-CHTR or idle CHTR) to radius+1
  every tick (dt):
     N = #registered workers; if N==0 → no progress
     tf = min(worker.SelfTimeFactor)
     speed = 0.1 + 0.9 * 0.8^(N-1)            // 1:1.0 2:0.82 3:0.676 4:0.561 5:0.469 ...
     if Tesla (tesla_s0) of owner, level>=1 (=hero lvl2), within 20 m of the building edge: dt *= 2
     if Babbage (babbage_s0) of owner, level>=4 (=lvl5), anywhere:                  dt *= 2
     for each worker: AddProgress(100*dt / (D*N*tf*speed))  // total per tick = 100*dt/(D*tf*speed)
  AddProgress(p): progress+=p; HP += maxHP*p/100
     conLevel = floor(progress/25) (0..3); becomes a pathfinding blocker from level 1 (25 %)
     progress>=100 → SetReadyBuild()
```
- Build time is therefore `D * tf * (0.1 + 0.9*0.8^(N-1))`. It tends to `0.1*D` as N grows.
- Workers (`CBuildUp`): hide weapon and show `<tribe>_hammer`. Each worker occupies the least-used build link `Bl_0..Bl_9` nearest to it. Buildings without links use the wall BuildVector or a point 5 m out. The worker walks there (arrival tolerance 4 m), rotates, registers, then loops the anim `hammer`. When done it auto-continues on the next unfinished own wall or gate within 50 m, then `NextJob`.
- The first registered worker switches crane anim to "build". When the last one leaves it switches back to "none".
- `SetReady()` (`B:536-613`): removes cranes, `building_ready=1`, ConstructLevel 4, starts timers, becomes a PF blocker, player limit counts are added (`UpdateLimits/max_*`), FX event 5, idle anim.
- Idle anim priority: `standanim` (loop), then `work` (once), then `deliver` (once) (`B:752-770`).
- Work anim: `OnWork()` loops `work`. Stopped by a 6 s timeout (`WORK_ANIM_TIMEOUT`); `work_finished` plays on finish.
- `SetReadyBuild` also logs production and notifies `CGameOverMgr.OnReadyBuild` (HQ and warp gate, §9).

### 1.4 Damage stages (`FO:3047-3070`)
Only when construction is finished (level 4):
`HP% > 50 → destructLevel 0`, `≤50 → 1`, `≤25 → 2`. Entering a worse stage fires FX event 14 (fire/smoke). Towers copy the level to their turret.

### 1.5 Repair (`T/Repair.usl`, `B:6730-6866 CRepairDesc`, `B:1060`)
- The command is "Repair" on a building. If it is still in BuildUpB, the worker builds instead.
- Speed per worker: `HPps = 20 + 5*worker.level`. Several workers stack linearly (no diminishing formula).
- Cost: repairing the whole bar 0→max costs **50 % of the build cost** (wood, food and stone only; iron is never charged). Formula:
  - `costPerHP[r] = 0.5*buildCost[r] * (missingHP%/100) / missingHP = 0.5*buildCost[r]/maxHP`.
  - Fractions accumulate. Whole units are deducted as they reach ≥ 1.
  - If any charged resource reaches 0 the repair stops (the worker exits).
  - Build cost is taken from the owner's *player* tech tree at the first registration of the class (`CBuildingCost.Register`).
- The worker aborts at start if a needed resource is already ≤ 0 (feedback "_NT_ActionFailRsc").
- Walls: after one segment the worker continues with the next damaged own wall or gate within 50 m.
- Anim: `hammer` loop. Only players flagged "RepairNoCost" (a cheat or scenario) repair for free.

### 1.6 Destruction, corpse, "Kill" (`FO:5537-5606`, `B:871-884`, `B:6227-6327`)
```
Die():  CBLDGMgr remove; hp=0
        start TIMER_EXPLOSION (1.0 s); if Ninigi && building has invent "Explode" → explosion now (§1.8)
        SetDead(true)          // becomes non-targetable, nothing else happens for 1 s
TIMER_EXPLOSION → Delete():
        if class-specific CreateBuildingCorpse() returned false
           and not CWall and not CVirtualProduceUnit and building was READY:
              spawn BuildingCorpse(gfx=<gfx>+"_dest", anim "destroy", lifetime 8 s, keeps age)
        inventory items dropped (FO Delete)
Corpse: after 8 s it sinks: MoveAction to z=0 at speed 1.0, then deleted.
        Exceptions that stay forever: hcl13_gate, PT_Citywall_Gate_dest, seas_hq_* dest models.
```
- Unfinished buildings leave no corpse. Walls never leave a corpse; gates do.
- Towers leave an extra corpse for the turret (`B:1667`). Rocket ramp leaves 3 (turret, bird, base). Big cannon leaves 2.
- **Kill action** (`Moves/BLDG/Kill`, visible on every own building of Hu/Aje/Ninigi) → `DiePerHarakiri()` = `OnKill(); Die()`. No refund. A Ninigi building with Explode still explodes.
- `Delete` game command → immediate `Delete()` (corpse if ready, no refund). Probably the UI cancel for sites; unverified.
- **Kill reward** (`FO:4494-4500`): when a hit would kill a BLDG and the *attacker's* player has invent `BLDG_res_back`, the attacker gets the building's full build cost (capped by max storage). That invent comes from the Tesla or Livingstone "Chief" bonus.
- Units inside: only `CBunker` holds units (§3). It ejects them on death. Other buildings have no garrison.

### 1.7 BuildDown: Aje dismantling (`B:922-934`, `T/BuildDownBuilding.usl`)
Action `Actions/Aje/Moves/BLDG/BuildDown` (UI cat SPEC). Available on aje_tent, aje_rodeo, aje_small_tower, aje_bazaar, aje_slaughterhouse, aje_bone_palisade(+_gate), aje_temple, aje_medium_tower, aje_cook_house, aje_weapons_builder, aje_tesla_tower, aje_scarecrow, aje_clay_wall(+_gate), aje_small_farm, aje_skull_protector. It is **not** on floating harbour, warp gate or amazon_temple.
```
BuildDown(path): ignored if a BldDownB task already exists
  Init: enable filter /Filters/Aje/Upgrades/<class>/BuildDown (disables that building's production/upgrades,
        see list below); add a production-queue entry
  duration = 0.5 * build duration  (Actions/Aje/Build/BLDG/<class>/duration)
  tick: progress += 100*dt/duration → CurProcess
  progress>=100: GrantResources(owner) → **100 % refund** of the build action's rescosts (from the
        *default* tech tree, i.e. unmodified), each resource capped at player max_<res>;
        then DieFastAndSilent() (no Die(): no corpse, no explosion)
  Break/cancel: filter disabled, queue item removed, nothing refunded
```
- Refund uses `GetBuildAction()`. Mode or upgrade costs (farm modes, big tent) are **not** refunded.
- `all_buildings/BuildDown` filter hides the BuildDown button. Per-class filters while dismantling:
  - small_farm: all ANML builds, farm modes, dino abilities
  - tent: big_tent
  - weapons_builder: its units and upgrades
  - temple: shaman and spells
  - cook_house: all heroes
  - bazaar: trade_dino and buy_*
  - rodeo: its units and matrix/twister
- CTower variant (`B:1503-1515`) adds the task non-queued (`AddTask(...,false)`). A tower that is dismantling cannot fight (`B:1533`).
- Uncertain: the exact queue semantics of `AddTask(..,true)` vs `false`. Assume BuildDown waits behind queued production for normal buildings and starts immediately for towers.

### 1.8 Ninigi "Explode" (self-destruct upgrade) (`FO:5578-5584, 5620-5623`, `FO:9431`)
- The upgrade `Actions/Ninigi/Upgrades/ninigi_fireplace/Explode`: 60 s, 0f/100w/100s, result class **local**, so it is researched **per building**. The filter adds invent `Explode` to that building's local tree and removes the action.
- Available on: fireplace, lumbermill, hunting_lodge, stone_quarry, dojo, engineer, temple, animal_farm, warehouse, telescope_tower, teahouse, weapon_maker, harbour, paddy, bamboofarm.
- Effect: whenever such a building `Die()`s (destroyed or Kill command), `CAreaDamage(range=20, dmg=500, enddmg=100, owner, pos, sizeClass=7)` fires:
  - Targets are enemies of the owner plus neutral (owner −1), types CHTR/SHIP/ANML/VHCL/BLDG/FGHT/NEST. Units inside transports are excluded.
  - `d = max(0, dist - target.collisionRadius)`. A target is hit only if `d < 20`.
  - `factor = (1-100/500)*(20-d)/20 + 100/500`, so damage = 500 at the centre and 100 at the edge. It is applied as `TakeDirectDmg(500*factor)`, reduced by the target's ranged protection.
  - Then an area knockback ("throw") with size class 7: CHTR/ANML get `hit_back` falls.
- BuildDown does not apply (Ninigi have no BuildDown).

### 1.9 Model-changing upgrades (tech tree filters; gfx swap via `UpdateGfx`)
| Upgrade (action path) | Scope | Time | Cost f/w/s | Req | Effect |
|---|---|---|---|---|---|
| Aje/Upgrades/aje_small_farm/aje_small_farm, aje_medium_farm, aje_huge_farm | **local** (per farm) | 10/15/20 | 25/50/30 each | –/age_2/age_3 | Mutually exclusive "modes". Activating one deactivates the other two filters. Each sets the gfx (small/medium/huge farm model), the name, and which ANML builds and dino abilities are visible. A farm can switch between any modes (localflags). |
| Aje/Upgrades/aje_tent/aje_big_tent | local | 8 | 0/30/20 | age_2 | gfx `aje_big_tent`, max_units 5→10, hitpoints +200 |
| Hu/Upgrades/hu_palisade/hu_small_wall | player | 30 | 0/0/200 | age_3 | All hu_palisade(_gate) gfx → hu_small_wall(_gate). Build menu: palisade removed, small_wall shown. |
| Hu/Upgrades/hu_palisade/hu_re_enforced_wall | player | 40 | 0/0/300 | age_5 | small_wall(_gate) → re_enforced_wall(_gate) |
| Hu/Upgrades/hu_palisade/hu_falling_stones | player | 20 | 0/0/250 | mayor_s4 | Walls get weapon hu_falling_stones (§2.1) |
| Hu/Upgrades/hu_small_animal_farm/hu_big_animal_farm | player | 30 | 100/50/20 | age_3 | gfx swap |
| Hu/Upgrades/hu_weapons_smith/hu_weapons_smith_anvil | player | 20 | 0/0/100 | age_4 | gfx swap |
| Hu/Upgrades/hu_warehouse/hu_marketplace | player | 20 | 200/100/50 | age_3 | gfx swap, +1000 HP, enables buy_* |
| Hu/Upgrades/hu_bunker/hu_bunker_upgrade | player | 60 | 0/0/200 | age_3 | gfx; weapon +25 def/+25 rdef/+5 dmg/+5 range |
| Hu/Upgrades/hu_large_tower/hu_ballista_upgrade | player | 120 | 0/1000/1000 | age_5 | gfx; ballista turret; +1000 HP, +50 dmg, +5 range |
| Ninigi/Upgrades/ninigi_small_tower/tower_sordes_upgrade | – | – | – | – | turret `ninigi_small_tower_upgrade` (`B:1392`) |

Walls and gates (`B:2296-2309, 2458-2482`): when the gfx changes, `WallMap.WallClassChanged(obj, newGfx)` runs and the build action is reset, so the object resolves to the new class's tech-tree entry.
- It then gets the new class's HP: palisade 6000 → small wall 12000 → re_enforced 18000. Repair and refund also use the new class.
- **(engine, likely)**: the current HP% is probably kept.
- Gates re-apply their open or closed pose at the last frame (50, or 70 for `_palisade`).

### 1.10 Rally points, spawn and exit
- `SetRallySite(true)`: CRallyBuilding, CSmallestHouse, CLargeHouse, CFireplace, CTemple, CNPCSeller, CHarbour. CBunker sets it false.
- New units appear at link `Spwn` (`T/Action.usl:787`). CTheLite (`T/CTheLite.usl`) walks them to link `Ex_1` (fallback `pos + (0,1,0)*radius`), then to `GetRallyPosition(0)` (or stays at Ex_1).
- Units from a tavern use anim `tavern_spawn` if they have it.
- At the rally point a worker auto-starts on: a tree within 5 m, stone within 3 m, then fruit/food within 10 m.

---
## 2. Walls & gates

### 2.1 CWall (`B:2187-2323`)
- Flags: `IsWall`, `WallMapObj`, no free-border blocker. Units can stand and walk on walls (engine WallMap: `GetOnWall`, `WallWalkAction`).
- **Placement (engine)**: the client drags a line and the WallMap splits it into grid segments. Gates are centred on an 8 m grid (`pos.x%8==4 && pos.y%8==4`, `B:2384`). Diagonal gates get flags OST/WEST.
  - Segment length, corner and pillar pieces are chosen by the engine WallMap from the gfx set. They are not in the scripts. **Assume an 8 m grid** with straight and diagonal pieces.
- **Damage redirect**: a wall segment connected to a gate (a gate registers its left and right neighbour, up to 4 parent gates per wall) forwards *all* damage it takes to its first parent gate (`B:2266-2270`).
- **Falling stones** (Hu, after `hu_falling_stones`): when a ready wall is hit and has no reload timer, it does `CAreaDamage(this, pos)` with weapon `hu_falling_stones`: damage 500, enddamage 500, hitrange 20. It hits enemies within 20 m (minus collision radius) at a flat 500 each, reduced by armour through `TakeDmg`. FX `Hu_Wallstones_Fx` is rotated toward the attacker. Reload `60/6 = 10 s` (`STONES_RELOAD_TIMER`).
- Build or repair tasks chain across neighbouring walls (50 m search).
- Wall stats (TT): each segment is built and paid separately.

| object | f/w/s | build s | HP | req |
|---|---|---|---|---|
| hu_palisade | 0/20/20 | 10 | 6000 | – |
| hu_small_wall | 0/25/25 | 15 | 12000 | hu_small_wall |
| hu_re_enforced_wall | 0/30/30 | 20 | 18000 | hu_re_enforced_wall |
| aje_bone_palisade | 0/20/20 | 10 | 5000 | age_2 |
| aje_clay_wall | 0/30/40 | 22 | 15000 | mayor_s4 |
| ninigi_palisade | 0/40/30 | 22 | 15000 | mayor_s4 |
| ninigi_defense_skewer | 0/25/15 | 10 | 4500 | age_2 |
| seas_fence | 0/25/40 | 15 | 10000 | age_2 |

Gates:

| object | f/w/s | build s | HP |
|---|---|---|---|
| hu_palisade_gate | 0/40/40 | 20 | 5500 |
| hu_small_wall_gate | 0/50/50 | 30 | 11000 |
| hu_re_enforced_wall_gate | 0/60/60 | 40 | 17000 |
| aje_bone_palisade_gate | 0/40/40 | 20 | 4500 |
| aje_clay_wall_gate | 0/60/80 | 35 | 14000 |
| ninigi_palisade_gate | 0/80/60 | 35 | 14000 |
| ninigi_defense_skewer_gate | 0/50/30 | 20 | 4300 |
| seas_gate | 0/50/80 | 25 | 9000 |

### 2.2 CGate (`B:2332-2702`)
States: `OPEN=0, CLOSED=1, AUTO=2`. Attribute `GateState`.
```
after construction (SetReadyBuild): state = pre-set state (set via Open/Close/Auto while unfinished) else AUTO
Open():   if hackers → OpenViolently(own); if auto-timer running: stop it (gate already open) else anim "open";
          state=OPEN; pathfinder gate state GS_Open
Close():  blocked while BROKEN timer; anim "close" (skipped if previous state was AUTO with no pending timer);
          state=CLOSED; GS_Closed
Auto():   blocked while BROKEN; if state!=CLOSED anim "close"; state=AUTO; GS_Auto
OnAutoGatePassUnit()  [called by engine when a permitted unit passes an AUTO gate]:
          if timer running: restart it, else anim "open"; AUTO_GATE_TIMER = 8 s → anim "close"
OpenViolently(p_bOwn) [Ninigi ninja lockpicking]: if not already broken and not OPEN:
          formerState=state; BROKEN_TIMER = 30 s; Open()
          BROKEN_TIMER → if formerState==CLOSED → Close()   (AUTO is not restored! stays OPEN; engine quirk)
```
- Passability **(engine)**: OPEN lets everyone through. CLOSED lets nobody through. AUTO lets the owner and (presumably) allies through; enemies are blocked.
- Walls attached to a gate forward their damage to it (see 2.1). Deleting a gate detaches its walls.
- Anims: `open` / `close` (play once). Idle anim is suppressed.
- Lockpicking (`CH:~1800`, `T/LockPicking.usl`): only `ninigi_ninja`, anim `potter`, **15 s**, then `OpenViolently(false)`. It needs the `lockpicking` invent from ninigi_temple.
- Actions per tribe (TT `Moves/BLDG`):
  - Hu: Open, Close and **Auto** on all 3 gate types.
  - Aje: Open and Close only, on bone_palisade_gate and clay_wall_gate.
  - SEAS: Open and Close on seas_gate.
  - Ninigi: Open and Close whose locations point at `ninigi_defense_skewer` and `ninigi_palisade`, the *wall* classes. This looks like a data bug.
  - **Recommendation:** give every CGate Open/Close/Auto. Non-Hu gates start in AUTO anyway and have no Auto button.
- `CGateFOWVIsible`: a gate that stays visible in FOW (campaign only).

### 2.3 CNinigi_Defense_Skewer / _Gate (`B:2135-2185`)
These behave as a normal CWall or CGate. The only override: `TakeDmg(...)` returns 5.0 when the parent returned 0. `FO TakeDmg` always returns 0 and no script reads the return value, so this has **no scripted effect**. It was probably meant as 5 thorn damage to melee attackers. Uncertain; treat it as none unless the engine uses it.

### 2.4 CLadder (hu_ladder) (`B:2048-2133`, `T/DockWall.usl:328-455`)
- Hu only. Build action is hidden (vis −1): 0/20/0, 2 s, age_2, 1000 HP.
- Triggered by a worker action `/hu_ladder` on an (enemy) CWall → task `CBuildLadder`:
  - fails if the wall is already sieged;
  - `find_pos` = WallMap free dock position (up to 2 retries);
  - walks there carrying the prop "Hu_Clerk";
  - places the `hu_ladder` via PlaceObj (**pays 20 wood**), rotated toward the wall, docked to it;
  - the worker builds it.
- When ready, the ladder registers an extra wall entrance (engine WallMap). Characters climb up or down with anims `hu_high_ladder_climb_up` / `climb_down_ladder` and can then walk on the enemy wall. The ladder is removed from the entrance list when it is deleted.

---
## 3. CTower family (short: towers are combat buildings)
- CTower (`B:1404-1680`): has a turret child object on link `we` (or class-specific). It rotates the turret before firing (`SecRotAction 0.8`), shoots the tech-tree projectile, then plays the fight anim and the turret anim `attack_front`. It retaliates when attacked (`OnDefend → /AttackSrv`). It cannot fight while in BuildUpB or BldDownB. Turret HP attributes mirror the tower.
- `CBunker` (hu_bunker) (`B:5519-5661`): holds up to **4 CHTR** (`max_passengers=4`). Passengers are hidden and unselectable. On attack it fires **one projectile per passenger** (delays 1.0, 1.1, 1.2, 1.3 s) and nothing when empty. `/Dismount`, `/DismountAll`. On Die all passengers are ejected and walk to a free position.
- `CRocketRamp` (ninigi_rocket_ramp) (`B:1233-1324`):
  - Turret `ninigi_rb_top` on `RE_1`; an animated bird `ninigi_rb_bird` (random idle anims `ninigi_rb_bird_idle_001..004`, `ninigi_rb_bird_shoot` on attack).
  - Weapon: 400 dmg → 200 edge, hitrange 13, range 50–143, frequency 3 (**20 s reload**), AP 99.
  - Stats: age_5, 0/1500/1000, 160 s, **500 HP**.
- `CSeasBigCannon`: campaign only (activates on `AbortTask`). CSeasTurretTower/MG/Defense: SEAS turrets. CTeslaTower: turret `aje_tesla_tower_canon`, anim `gun_shoot`.

---
## 4. Aura / region buildings
All of these create a square "personal region" of ±R around the building when it becomes ready (`CreatePersonalRegion(name, (R,R,0), 010b)`) and get enter/leave callbacks. Nothing is active before construction finishes.

| Class | Object | R | Who | Effect | Req / cost / time / HP |
|---|---|---|---|---|---|
| CMagicCauldron `B:6001` | hu_magic_cauldron | 30 | friendly CHTR/ANML/VHCL | damage bonus +10 % of the unit's base dmg (BONUS_DAMAGE "Cauldron"); ranged buff `owner_more_damage` | hermit_s4; 50/50/50; 10 s; 1000 |
| CScareCrow `B:3612` | aje_scarecrow | 50 | **enemy ANML** | damage −20 % of base dmg ("ScareCrow") | hermit_s4; 50/50/50; 10 s; 1000 |
| CCauldron `B:3714` | ninigi_cauldron | 35 | friendly ninigi_archer, ninigi_marksman, aje_archer, hu_archer, hu_marksman, Bela_s0 | `EFFECT_NINIGI_CAULDRON`: attack damage ×1.25 (`FO:7856`); buff `owner_fire_arrows`. The fire-arrow projectile swap is a separate filter `ninigi_cauldron/change_weapons` (not scripted here). | hermit_s4; 0/20/10; 10 s; 1000 |
| CSkullProtector `B:6071` | aje_skull_protector | 30 | friendly units of every type incl. BLDG/NEST (not other skull protectors) | enables filter `aje_skull_protector/protect_skulls` on the unit: all `/Modifications/*/*/Skulls/*_rel ×0`, so killing it presumably gives the killer **0 skulls (XP)** (engine semantics) | schliemann_s4; 0/250/300; 50 s; 1000 |
| CStealthBuilding `B:1682` | ninigi_smoke_tower | 35 (range marker 37) | own **BLDG** only (not other smoke towers, warp gates, defender objects); also the tower turret | `EFFECT_SMOKER_INVIS` → camouflage layer "smok" + buff `is_invisible`. Enemies cannot see them until revealed (§6.2). Leaving removes it unless otherwise camouflaged. | age_4; 0/250/250; 120 s; 2000 |
| CTemple `B:2758` | hu/aje/ninigi_temple | heal radius 30 (TT `special_abilities/heal`) | friendly CHTR/ANML/VHCL (no ships) | every 2 s: `heal = dt * (5 + 0.25 % of target maxHP)` per second (`amount 5`, `mod 0.25`, times Healing modifiers). FX `fx_heal_area`, buff `owner_healing_temple` | see TT |
| CHarbour `B:5115` | harbours | heal radius 40 | friendly SHIP only | same heal formula; buff `owner_healing_harbour` | – |

Healing implementation: `DoBuildingFunction` (`B:779-804`), `FO:3728-3750`. The building does not need to be selected. It is circular: `RegionCircle(pos, radius)`.

### 4.1 CKennel (hu_kennel) / CNinigi_Dilophosaurus_Nest (`B:6137, 3325`, `classes/animals/Nest.usl`)
- When ready, it spawns an invisible linked `CNest` (`hu_kennel_nest` / `hu_dilopho_nest_spawn`). The nest's action area and safe area are both ±50 around the building.
- Nest attributes: `spawn_type` hu_kennel_eusmilus / ninigi_dilophosaurus, `spawn_max=2`, `spawn_rate=20` s, `spawn_amount=-1` (infinite), `spawn_grown=1` (adults), `spawn_uninfluenced=1` (they act autonomously, not player-controlled).
- Loop: while fewer than 2 are alive, spawn one every 20 s. When one dies the timer restarts. Animals that leave the area are walked back (checked every 2 s).
- When the building dies the nest dies.
- Stats: hu_kennel darwin_s4, 450/200/0, 35 s, 600 HP. Dilo nest darwin_s4, 250/120/0, 25 s, 500 HP.

---
## 5. Hero recruitment: CNPCSeller (hu_tavern, aje_cook_house, ninigi_teahouse) (`B:2807`, `misc/NPCMgr.usl`)
- The class only sets attribute `NPCSeller=true` and the rally site. Recruiting is an ordinary **Build/CHTR** production action at that building.
- Heroes: Cole_s0, Bela_s0, lovelace_s0, babbage_s0, mayor_s0, tesla_s0, darwin_s0, hermit_s0, livingstone_s0, schliemann_s0. Every hero costs **250 food + 25 iron**, **45 s**, no age requirement. The result object is `/Objects/Special/CHTR/<hero>` at level 1 (flags level 1).
- Uniqueness: `CNPCMgr` keeps a list per player. Valid NPCs are listed in `settings/NPCList.txt` (also queen_s0, special_eusmilus). When a hero is created and one of that class already exists for the player, it is **deleted**. `AntiActions/<tribe>/Build/CHTR/<hero>` makes the button invisible while the hero lives **(engine applies)**. After the hero dies it can be bought again.
- Ownership change also re-checks uniqueness.
- Spawn: `tavern_spawn` anim if present, then rally point (§1.10).
- Building stats: hu_tavern 0/300/100, 30 s, 1500 HP. aje_cook_house 0/300/100, 30 s, 800 HP. ninigi_teahouse 0/300/100, 30 s, 1000 HP. All are available from start (vis 1).

---
## 6. Traps: CTrap and subclasses (`B:3774-5104`)

### 6.1 Common machinery
```
OnInit: WallMapObj, IsTrap (engine: trap rendering/FOW rules), create CTrapQuery
SetReady: visibleMask = owner only (1<<owner); query.Enabled = m_bEnableOnReady (true)
CTrapQuery: oval region radius R bound to the trap; on every region change:
   candidates = objects in region of allowed types whose owner is an ENEMY of trap owner
               (never the owner, allies ignored), not in a transport,
               not in ignoreList, not currently trapped
   leftRegion: remove from ignoreList objects no longer inside
   if !oneTime || !alreadyReleased: for each candidate: CreateEffect → OnTrap(obj) must return true
        → TrapFound(obj.owner) (unhide for that player, unless trap is in smoke-tower camouflage)
        → if oneTime: alreadyReleased=true; stop after first victim
CTrapEffect (per victim): 1 s tick timer; OnTick(obj) each second;
   release when (now-start) >= m_fDuration or obj invalid → OnRelease(obj); obj → ignoreList
Die(): disable query, release all running effects (frees held units)
Activate(): ignoreList cleared, alreadyReleased=false, query enabled   (= re-arm)
OnReveal(): disable "smok" camouflage layer, visibleMask = all 8 players
OnHide():   re-enable "smok" layer (visibility mask itself is NOT reset; per the comment,
            engine hides traps again once they drop back into enemy FOW; uncertain)
OnHoldTrap(obj): (quicksand/snare) victim TerminateAction + SetTrapped(trap) → cannot move
            (task "Trapped", buff is_held, fx Sleepping_Animal_Fx); OnHoldRelease clears it
```
A victim is rejected if it is currently attacking the trap (`GetCurEnemy()==trap`). Pitfall and poison also reject units that cannot walk.
Traps are not pathfinding blockers (`SetPFBlocking` is a no-op). Workers building traps stand at least 9 m from the centre (`T/BuildUp.usl:230-231`).

### 6.2 Detection
- Active "reveal" move (`Moves/CHTR/reveal`) of **hu_druid, aje_shaman, ninigi_monk** (also seas_medic has the ability): radius **30**, cooldown **5 s** (action duration), anim `res_guarding`.
  - It reveals camouflaged enemy CHTR/BLDG (`Reveal()`) and calls `TrapFound(owner)` on enemy traps in range (`CH:999-1033`).
- A trap also becomes visible when it catches something (`TrapFound` / `OnReveal`).
- `SearchTraps.usl` is marked "NOT USED ANYMORE". Its old idea was a tec-caste radius of level × (10 day / 7 night). The passive idle trap search is stubbed (empty procs).

### 6.3 Per trap
| | ninigi_pitfall (CPitfall) | ninigi_minefield (CMinefield) | ninigi_snare_trap (CSnareTrap) | ninigi_poison_trap (CPoisonDung) | ninigi_resin_field (CImpResinField) | Aje_Quicksand_Trap (CQuicksand) |
|---|---|---|---|---|---|---|
| Trigger radius | 5 | 3 | 3 | 5 | – (manual) | 8 |
| Types | CHTR ANML VHCL SHIP (+default query types) | CHTR ANML VHCL SHIP | **CHTR only** | CHTR ANML VHCL FGHT SHIP | – | CHTR ANML VHCL SHIP |
| One-shot | yes | yes | yes | no (every enemy once per entry) | – | no |
| Effect | `TakeDmg(this)`: weapon ninigi_spiketrap_weapon **350** dmg; anim `attack_front` | `CAreaDamage(this,pos)`: weapon 350 centre → 200 at hitrange **10**, enemies+neutral, all unit types incl. BLDG; FX `hit_land_<setting>_explo_big` (the script constants 200/100/10 are unused) | Hold victim (hangs on link `we`, rotated 180°), **3 dmg/s** AP 99 via OnTick; anims trap `catching`→`hanging`, victim `all_snar_trap_catching`→`all_snar_trap_hanging`, release `all_snar_trap_end` | `TakeDmg(this)`: 15 dmg + poison 20 × 25 ticks (weapon ninigi_poison_trap); buff `owner_poison` | see 6.4 | Hold victim **5 s**; buff `owner_hold_units` |
| Duration of effect | 1 s | 1 s | until trap destroyed or victim dead (duration 9 999 999) | 1 s | – | 5 s each |
| Re-arm | after release: query off, **20 s** delay → anim `reload`, re-hide, re-arm | 20 s delay → re-hide, re-arm | release → 1 s delay → anim `bending`, re-hide, re-arm | always armed | – | – |
| Lifetime | ∞ | ∞ | ∞ | ∞ | ∞ | **30 s** then Die |
| Cost f/w/s, time, HP, req | 0/100/25, 20 s, 100, age_2 | 0/175/100, 30 s, 500, age_4 | 0/70/0, 15 s, 500, – | 200/100/0, 20 s, 500, tesla_s4 | 0/80/20, 10 s, 300, age_3 | spell (not built) |

- The snare trap plays `bending` when ready (armed pose).
- Quicksand is not hittable or selectable and is visible from creation. It is created by the Aje **aje_shaman** move `quicksand`: target point within 30 m (32 m in-range check), anim `heal_0`, cooldown 90 s. It needs temple upgrade `quicksand` (30 s, 0/0/150 + 50 iron, age_4) (`T/QuicksandTask.usl`).
- A trapped CHTR in a transport holds the transport instead (`B:4432-4442`). Walking transports can be held.

### 6.4 CImpResinField + "Burn" (`B:4567-4717`)
- Action `Moves/BLDG/Burn` on ninigi_resin_field. Its duration 40 is used as a **per-field cooldown of 40 s** (`CheckSpecialActionTimer` / `AddSpecialActionTimer`).
```
StartBurning(path): if cooldown free: start cooldown; if not already burning:
    gfx "ninigi_resin_field_fire"; OnReveal (visible to all)
    INFECT_TIMER every 1 s; BURN_TIMER 30 s
INFECT tick: first tick only → ignite own ninigi_resin_field within 13 m that are not under construction
             (each via its own StartBurning, subject to its own cooldown) = chain reaction
             every tick → DoDamage: enemies (ANML/CHTR/VHCL/SHIP; no buildings) within hitrange 6
             get TakeDmg(this) = ninigi_resinfield_weapon 50 dmg  → ~50/s (armour applies)
BURN_TIMER (30 s) → gfx back, timers off, 20 s delay → Activate → OnHide (hidden again)
```
- It never triggers by itself (its trap procs return false). It cannot fight or attack.

---
## 7. CWarpGate + CWarpMgr: the victory building (`B:6349-6682`, `GO:412-495`)
- Objects: hu_warpgate, aje_warpgate, ninigi_warpgate. age_5, **5000/5000/5000**, build duration **4470 s** (≈447 s with many builders, §1.3), 50 000 HP (FOW 25 or 30).
- **Only allowed if the level attribute `DimGateAvailable` is true.** Otherwise `CWarpMgr.Register` fails and the gate deletes itself immediately (resources are already paid; they are lost).
- **One per player**: a second placement is deleted.
- On placement it creates 8 `ShowFOW_Obj` (one per player slot) with FOW range 20. **Everybody sees the site** from the start. Feedback to all: "_NT_WarpGateStarted".
- When built: `standanim` + speed lines, "_NT_WarpGateFinished" to all. `GameOverMgr.OnReadyBuild` starts a per-player countdown `ObjTime` (icon "warpgate") of `Game/MPSettings/WarpGateTimer` minutes (**default 10 min**).
- Countdown expires → the owner and all their friends (diplomacy) are set to WIN. Every other alive player is KILLED.
- Gate destroyed (completed) → countdown killed, "_NT_WarpGateDestroyed". Unfinished gate destroyed → just unregistered (it can be rebuilt).
- `CWarpMgr` also has its own 600 s check. It broadcasts "WarpGate" for the scripted trigger condition `CConditionDimGate` (campaign/map triggers). The MP victory itself comes from GameOverMgr.

---
## 8. Other special classes
- **CFireplace** (HQ): on any `InventObjects/age_N` change it sets the building age and the player attribute `age` to the highest invented age (`B:247-288`). Its loss matters for the HQ game-over rule (hu_fireplace, ninigi_fireplace, seas_headquarters, and the Aje unit aje_resource_collector) (`GO:~218`).
- **CLaunchPad** (`B:6329`): pre-placed ruins. At game start (not in the editor) an unfinished one auto-starts its BuildUp. `ninigi_telescope_tower_ruins` starts at **49 %** progress. Players then finish it with workers (0/250/250, 285 s, 10 000 HP, FOW 200).
- **CVirtualProduceUnit** (`B:5406`): an invisible, unhittable helper "building" linked to a parent (a mobile production unit, a swimming harbour, a tower). `Action()` produces on behalf of the parent. It dies with the parent. It has no gameplay of its own; the remake can fold it into the parent.
- **CHarbour** (short): docks = links `Do_1..Do_5` (min 2), heals ships r40, `fishDelivery`, a Hu crane on `Cr_3` animates while working. **CSwimmingHarbour** (aje_floating_harbour): can swim (`Walk` action, `MovingBuilding`), 4 turtle models on `Cr_1..4`, bonus HP by level 0/100/300/600/1100. **CSeasCarrier**: swimming harbour with an auto-attacking turret. Not needed without water.
- **CUnlimitedBuilding / CGrowingField / CAjeUnlimitedBuilding** (economy): infinite resource buildings. Worker slots 2 (Aje slaughterhouse 4). `Mine()` returns the hit only for resources in `Objects/.../unlimited`. Not PF blockers. Details belong in the economy spec.
- **CDecoBuilding**: not hittable or selectable, ignores damage.
- **Aje "movable" buildings**: only aje_floating_harbour (swims). The "mobile camp" is a unit (aje_brachiosaurus_mobile_camp) that produces aje_worker. Everything else is static; Aje flexibility comes from BuildDown (§1.7).
- **Tribe character files** (`classes/character/Aje|Hu|Ninigi|SEAS.usl`) contain no building logic.
- **SEAS**: no BuildDown, Explode or Burn. Gates have Open/Close only. seas_headquarters is a CFireplace.

---
## 9. Trigger → behaviour index (tech-tree action ids)
| Action path | Objects | Handler |
|---|---|---|
| `Actions/<T>/Build/BLDG/<obj>` | all | `CPlaceMgr.PlaceObj` → `BuildUp` (§1.2–1.3) |
| `Actions/<T>/Moves/BLDG/Kill` | every own building (Hu/Aje/Ninigi) | `DiePerHarakiri` (§1.6) |
| `Actions/Aje/Moves/BLDG/BuildDown` | 17 Aje objects | `CBuildDownBuilding` (§1.7) |
| `Actions/Ninigi/Upgrades/ninigi_fireplace/Explode` | 15 Ninigi objects (local) | invent → area damage on Die (§1.8) |
| `Actions/Ninigi/Moves/BLDG/Burn` (duration 40 = cooldown) | ninigi_resin_field | `StartBurning` (§6.4) |
| `Actions/<T>/Moves/BLDG/Open` / `Close` | gates (see 2.2 for per-tribe quirks) | `CGate.Open/Close` |
| `Actions/Hu/Moves/BLDG/Auto` | Hu gates | `CGate.Auto` |
| `Actions/<T>/Moves/BLDG/Attack` | Hu: bunker, large/small tower; Aje: small/medium/tesla tower; Ninigi: small_tower, rocket_ramp; SEAS: turret_tower | CTower fight |
| `Actions/Aje/Moves/BLDG/Walk` | aje_floating_harbour | swimming harbour move |
| `Actions/Hu/Moves/BLDG/buy_wood/stone/food` | hu_warehouse after marketplace + age_3 | CWarehouse (economy spec) |
| `Actions/Aje/Upgrades/aje_small_farm/{aje_small,medium,huge}_farm` | aje_small_farm | local farm-mode filters (§1.9) |
| `Actions/Aje/Upgrades/aje_tent/aje_big_tent` | aje_tent | local (§1.9) |
| `Actions/Hu/Upgrades/hu_palisade/{hu_small_wall,hu_re_enforced_wall,hu_falling_stones}` | walls and gates | player filters (§1.9, 2.1) |
| `Actions/<T>/Build/CHTR/<hero>_s0` | tavern / cook_house / teahouse | hero hire (§5) |
| `Actions/<T>/Moves/CHTR/reveal` | druid / shaman / monk | trap and camouflage detection (§6.2) |
| `Actions/Aje/Moves/CHTR/quicksand` | aje_shaman | creates Aje_Quicksand_Trap (§6.3) |
| `Actions/Ninigi/Moves/CHTR/lockpicking` | ninigi_ninja | `OpenViolently` on gates (§2.2) |
| worker action `/hu_ladder` on a wall | Hu workers | `CBuildLadder` (§2.4) |

---
## 10. Timer/constant cheat-sheet
- Build: `T = D * minWorkerTF * (0.1 + 0.9*0.8^(N-1))`; Tesla lvl≥2 within 20 m ×2 speed; Babbage lvl5 ×2 speed.
- Repair: `(20 + 5*lvl)` HP/s per worker; full repair = 50 % of the build cost (w/f/s).
- BuildDown: 0.5 × build time, 100 % refund of the base build cost, capped by storage.
- Death → removal delay 1 s; corpse 8 s, then it sinks.
- Damage stages at 50 % and 25 % HP.
- Gate auto-close 8 s after the last pass; lockpick 15 s; forced open 30 s.
- Falling stones: 500 dmg, r20, reload 10 s.
- Explode: 500 → 100 dmg, r20, size class 7 knockback.
- Traps:
  - pitfall 350 dmg, r5, re-arm 20 s (+1 s);
  - mines 350 → 200 dmg, r3 trigger / 10 blast, re-arm 20 s;
  - snare 3/s, r3, CHTR only;
  - poison trap 15 dmg + poison 20 × 25 ticks, r5;
  - resin fire 50/s, r6, burns 30 s, chain range 13 m, cooldown 40 s, re-hide after 20 s;
  - quicksand r8, hold 5 s, lifetime 30 s.
- Auras: magic cauldron +10 % dmg r30; scarecrow −20 % enemy animal dmg r50; ninigi cauldron ×1.25 archer dmg r35; skull protector r30; smoke tower r35 (BLDG invisibility); temple heal r30 (harbour r40), `5 + 0.25 %maxHP` per s, applied every 2 s.
- Kennel / dilo nest: 2 animals, one every 20 s, area ±50.
- Heroes: 250 food + 25 iron, 45 s, one per class per player.
- Warp gate: DimGateAvailable only, one per player, 5000/5000/5000, countdown `WarpGateTimer` minutes (default 10) → the owner's team wins.

## 11. Open questions / uncertainties
1. Wall line segmentation (segment length, corner and pillar pieces) and gate passability for allies are engine (WallMap/pathfinder). Assume an 8 m grid, owner and allies pass AUTO gates, nobody passes CLOSED.
2. What happens to HP% on the wall gfx upgrade (engine `WallClassChanged`).
3. Trap re-hide after reveal depends on the engine `IsTrap` FOW handling.
4. The skull-protector effect (`Skulls/*_rel ×0`) is read by the engine: assume no skulls or XP are awarded for kills inside the aura.
5. The Ninigi Open/Close tech-tree locations point at wall classes (probably a data bug).
6. The skewer's "return 5.0" has no scripted effect.
7. Whether cancelling an unfinished site refunds anything is not in the scripts. The `Delete` command does not refund.

## 12. Legacy, unused code (for completeness)
- `CHuTavern` + `CRecruitPool` (`B:2904-3265`): a global pool of max 8 random characters, with one added every 120 s. Cost by level [50,150,300,500,1000] food, half of that in wood and stone. No object uses it.
- `CResiner` (converts wood), `CResinField` (empty), `CNonInventGrill`, `CSmallestHouse`/`CMediumHouse`, and `CSearchTraps`.
