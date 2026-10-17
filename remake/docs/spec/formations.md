# ParaWorld: formations and the original keyboard layout (spec)

Sources: the original game scripts under `/mnt/user-data/uploads/Paraworld/Data`. Abbreviations used in the
references below:

- `BG/` = `Data/Base/Scripts/Game/` (client)
- `BS/` = `Data/Base/Scripts/Server/` (server)
- `TT` = `BS/settings/Techtree/_TechTree.ttree`
- `MS/` = `Data/MIRAGE/Scripts/Server/`
- `FO` = `BS/classes/FightingObj/FightingObj.usl`
- `GIC` = `BG/controller/GameInputController.usl`
- `CB` = `BG/UI/CommandBarEx/CommandBar.usl`

What the data ships:

- **Client scripts and `Keys.srf` exist only in Base.** MIRAGE, BoosterPack1 and BoosterPack3 ship only
  `Scripts/Server/**`, so the Base client is the effective one.
- MIRAGE's ReadMe describes client hotkey changes, but the files that would carry them are not in this
  installation (§B.9).
- `?` marks anything that is not verifiable from the scripts. Mostly that is engine (C++) behaviour.

---

## A. Formations

### A.1 Summary: two separate systems

| | (1) Old "Formation_1/2/3" system | (2) Formation arrow (right-drag), what the shipped game uses |
|---|---|---|
| UI | Tech-tree actions `Formation_1..3` + keys NUMPAD1..3 | Right mouse button held and dragged on the ground; the engine draws a preview (`CFormPreview`) |
| Parameters | `/PosJitter /Formation=<standard_0..3\|defensive>` | `/FrmDir=<rad> /FrmSpc=<spacing>` |
| Layout | Engine, from distribution pictures `standard_N.tga` / `defensive.tga` weighted by range/armor/speed/HP | Engine, from per-unit attributes `formation_x` (centre↔side) and `formation_y` (front↔back) `?` |
| State in the shipped game | **Dead**: unreachable and has no assets (§A.2) | **Live**; help text in `locale/uk/Texts/Help/H_general.seml:190` |

Help text (`H_general.seml:190`, verbatim):

> "When giving a group their marching orders an arrow can be drawn instead of using the usual right-click. The
> group will then fall in facing the tip of the arrow. Depending upon how long the arrow has been made the troops
> will assume either a close or open formation. Ranged weapons are placed in the rear and close combat units to
> the fore."

### A.2 Formation_1 / Formation_2 / Formation_3 (dead in the shipped game)

**Tech tree.** Each `/Actions/<Hu|Aje|Ninigi>/Moves/<CHTR|ANML|VHCL|SHIP>/Formation_1..3` node has:

- `visibility='1'`
- `description='_formation_N'`
- `iconpath='Formation_N'`
- `uiposition{page=0, place=0, menupos=0}` **with no `cat`**

Example: `TT:9894-9934` (Hu/CHTR). The same holds in the BP1, BP3 and MIRAGE tech trees: 0 Formation entries
have a `cat`.

**The actions never reach the command bar.** The command bar collects actions per category and skips any
location whose `uiposition.cat` is not the requested category (`CB:2192-2198`, `CB:2280-2283`). So no button is
ever built for them.

**Assets are missing.**

- There is no `_formation_N` text in `locale/*/Texts`.
- There is no `Formation_N` / `actmenu_Formation_N` bitmap in `Base/UI/All_def.txt`.
- `formations.txt` references `standard_0..3.tga` and `defensive.tga`, but they are not shipped.
  `BS/misc/formations/` contains only `formations.txt`.

**Client logic** (`BG/mgr/FormationMgr.usl`):

```
m_sFormation = "standard_0"; m_iWidth = 0                       // ctor :6-9 (client-global singleton, NOT per group)
Form(sel, type, pickPoint, dir):                                // :33-56
  if !IsFormationAvailable() && type != -1: return              // :35-37
  type 0 (Formation1): m_iWidth = clamp(m_iWidth-1, 0, 3); m_sFormation = "standard_"+m_iWidth   // narrower
  type 1 (Formation2): m_iWidth = clamp(m_iWidth+1, 0, 3); m_sFormation = "standard_"+m_iWidth   // wider
  type 2 (Formation3): m_sFormation = "defensive"
  send "Action" to all selected at pickPoint: "/Walk /PosJitter /Formation="+m_sFormation         // :56
IsFormationAvailable(): TT "/Objects/<tribe>/InventObjects/Formations/invented" != 0             // :20-27
```

- `Game.usl:2572-2588` defines `Formation1/2/3()`. They call `Form(sel, 0|1|2, scapePickPoint, {0,1,0})`.
- `Keys.srf:104-106` binds `NUMPAD1/2/3 → Formation1/2/3`.
- **These commands are never registered.** There is no `SetCmd("Formation1", …)` in `Game.usl:136-206`, and all
  other accelerators are wired that way. So NUMPAD1-3 do nothing `?`. This is engine behaviour for
  unregistered commands; the scripts show no binding.
- **Even when called, `Form` returns at once.** No tech tree defines `InventObjects/Formations`: `TT` has 0
  occurrences of `Formations`, and nothing in BP1, BP3 or MIRAGE adds it. So `IsFormationAvailable()` is
  always false.
- `NewPyramid.usl:61` declares `m_iFormations_State`, but it is unused.

**What survives:** `/PosJitter /Formation=standard_0` is still appended to every right-click attack order:

- `GIC:466`, `GIC:728` (`/Attack`), `GIC:733` (`/UseAttack`)
- the commented-out blocks at `GIC:803`, `:807`, `:932` and `:970`

The script server never parses `/Formation` or `/PosJitter` (grep of `BS/` and `MS/`: 0 hits). Engine use `?`.

**`formations.txt`** (`BS/misc/formations/formations.txt:1-23`), for completeness:

- Each line: `name pic rangeW armorW speedW hpW stagger normalize`.
- The weights map to the picture's channels: R = range, G = armor, B = speed, A = hitpoints. A black alpha
  channel is "no man's land".
- All 5 entries (`standard_0..3`, `defensive`): weights 0.6 / 0.2 / 0.1 / 0.1, stagger 0, normalize 1.
- The engine reads per-unit values through these script callbacks:

| Callback | Returns | Where |
|---|---|---|
| `OnGetFormationInfoAttackRange()` | `GetAttackRange()` | `FO:2661` |
| `OnGetFormationInfoHitpoints()` | `m_fHitpoints` | `FO:2668` |
| `OnGetFormationInfoSpeed()` | `GetMaxSpeed()` | `FO:2675` |
| `OnGetFormationInfoArmor()` | `(level/100) * GetProtection()` | `character.usl:682` |

- Without the pictures this layout cannot be rebuilt. **Recommendation: do not implement Formation_1..3.** The
  remake already ignores them (`game/systems/moves.js genericMove`, `main.js` GENERIC filters them out of the menu).

### A.3 The live system: group walk orders (client side)

**Right mouse button down** (`GIC:1474-1491`):

- Store `m_vRightHitPos` (ground pick point) and `m_xRightHitObj` (hit object).
- Set `m_bRightDrag = true`.

**Mouse move while right-dragging** (`GIC:1495-1510`):

- When the pick point moves **more than 2.0 world units** from the press point (`AbsSquare() > 4.0`, `:1499`),
  the preview starts:
  - `SetActive(true)`, `SetOrigin(pressPoint)`, `SetTarget(pressPoint)`
  - `SetSubjectCount(selection.NumEntries())`
- After that, every move calls `SetTarget(currentPickPoint)`.

**Right mouse button up** (`GIC:1513-1630`):

- The preview is hidden.
- **The order is issued at the press point** (`vPickpoint = m_vRightHitPos`, `:1523`), not at the release point.
- With nothing hit (or only the selected unit itself), it calls `HandleNone(pressPoint, autoHarvest=true,
  aggressive=false, shift, ctrl, alt)` (`:1551`). Hits on own/allied/enemy objects go to their own handlers.
- `AbortKeyboardShortcuts()` (`:1534`) disarms any armed command-bar row (§B.4).

**`HandleNone`** (`GIC:198-365`), the walk branch:

- Buildings get `SetRallyPoint`. So does a rally site when Shift is held (`:273`).
- Swimmers correct the pick point to sea level (`:288-311`).
- Everything else goes into one list (`xLActionWalkList`) and gets **one command for the whole list**:

```
params = "/Walk "                                   // :332
if aggressive: params = "/AggressiveTarget "       // :333-335  (never true from mouse paths; see below)
if ctrl:  params += " /Patrol"                      // :338-340  Ctrl+right-click = add patrol point
if shift: params += " /Queued"                      // :342-344  Shift+right-click = queue waypoint
if FormPreview.GetSubjectCount() > 0:               // :347  i.e. the arrow was drawn
    dir = FormPreview.GetDirection()                // engine
    params += " /FrmDir=" + atan2(dir.x, dir.y)    // :351-353  (atan2(x,y): heading from +Y toward +X)
    params += " /FrmSpc=" + FormPreview.GetSpacing() // :354  (engine; grows with arrow length per help text ?)
CEvt_GamePlayCommand.Send(walkList, "Action", invalid, pickPoint, params)   // :357, one call, all units
FormPreview.SetSubjectCount(0)                      // :358
```

- `HandleNone` also builds a per-unit random offset of ±sqrt(N) (`fShifting`, `:202`, `:265-268`), but **it is
  never applied**. It is only used in commented-out sends (`:374-376`). Every unit gets the same target point.
  Distributing the units is entirely up to the engine's group walk `?`.
- Other callers of `HandleNone` (no arrow is possible on these paths):
  - minimap right-click: `MainController.usl:59-61`, `CameraController.usl:235-238`
  - right-clicks on own transporters, buildings and so on: `GIC:1614`, `:1619`

**Command-bar orders** (`SecondaryInputController.usl:503-508`):

- These are the Walk, AggressiveTarget and Attack buttons, or the keys **V** and **B** (§B.4), followed by a
  left-click on the target.
- They **always** carry a formation:

```
vDir = selection.GetPos() - pickPoint               // vector from target back to the group centre
params += " /FrmDir=" + atan2(vDir.x, vDir.y) + " /FrmSpc=2.7807"
```

- So the default spacing constant is **2.7807**.
- The FrmDir sign convention is unresolved `?`. The arrow preview direction (origin→tip?) and this
  (group−target) vector look opposite. Either the engine interprets FrmDir as "back" or `GetDirection()` returns
  origin−target. The help text only says "facing the tip of the arrow".

### A.4 Server side: what each unit does with a group walk

`FO:8600` `HandleGamePlayCommand("Action", …, "/Walk …")` calls `HandleWalkCommand(pos, params)` (`FO:8821-8866`):

- `UpdateAggressionPos(pos)`: the **click point** becomes the unit's guard position (`:8830`).
- It parses `/Queued`, `/Patrol`, `/NoPF`, `/NoHeightAdapt`, `/Speed=n`, `/UseMaterial=`.
- **It ignores `FrmDir`, `FrmSpc`, `Formation` and `PosJitter`.**
- Default speed = `GetMaxSpeed()` (`:8824`).
- Patrol: `AddPatrolPoint(pos, speed)`. Otherwise: `GoTo(pos, true, speed, usePF, heightAdapt, false, queued,
  useMaterial)`.
- **Formation-slot placement is therefore engine work** (`CGroupWalk`, `GetCurrentGroupWalk()`,
  `IsGroupWalkPending()`; `FO:2035`, `:2085`; `Animal.usl:275`, `:828`) `?`.

`CWalkToPos.InvokeWalkAction` (`BS/classes/task/misc.usl:146-183`):

- `m_iSpeed = min(m_iSpeed, GetMaxSpeed())` (`:149-154`). Each unit walks at its **own** max speed.
- **No script-side speed matching to the slowest unit.** Whether the engine group walk does it is `?`.
- The commented `GroupWalkAction(m_vPos)` (`:178`) suggests an engine group-walk path.

On success (`misc.usl:272-276`): `UpdateAggressionPos(GetPos())`. The guard point becomes the **slot the unit
actually reached**, not the click point.

**Queued waypoints stay together as a group** (`FO:2033-2044`, `misc.usl:185-199`, `FO:8731-8746`):

- When a member finishes a walk without being interrupted, it saves the member list of its group walk
  (`m_xGropWalkMembersTmp`).
- When it enters its next `CWalkToPos`, it sends `Execute_Q_Walk(initiatorId, members, pos)`.
- Every other member whose *next* task is a `CWalkToPos` to the same point drops its current walk
  (`StopCurTask`).
- **Result: the whole group starts the next waypoint together**, as soon as the first member arrives. The engine
  then lays out the new group walk again.

**Per-unit formation attributes** (consumed by the engine and by the client preview `?`; `attribs_def.txt:134-141`,
flag `own`):

- `formation_x` (centre 0 ↔ side 1)
  - `UpdateFormationAttribs()` (`FO:3668-3701`; `MS/…/FightingObj.usl:5308-5334` in MIRAGE):

    ```
    effHP = 100*maxHP / (100 - protection)          // MIRAGE: / clamp(100-protection, 1, 100)
    x = 1 - min(effHP / 3000, 1)                    // tougher units → x near 0 (centre)
    ```

  - `SetLevelClean` (`FO:3496-3501`): `x = 0` for `unique` (heroes), else `x = 1 - level/5` (level 0..4).
  - Whichever ran last wins. `UpdateFormationAttribs` runs on every weapon/bonus/mod/HP/attribute change
    (`FO:8196-8198`).
- `formation_y` (front 0 ↔ back 1)

  ```
  y = (attackRange + 1)/75 - damage/10000
  if TT <obj>/formation_pos >= 0: y = formation_pos
  y = clamp(y, 0, 1)
  ```

  - The data overrides `y` with `formation_pos` (`TT`; −1 = use the formula):

    | Units | `formation_pos` |
    |---|---|
    | hu_worker, aje_worker, ninigi_worker, seas_worker, hu_transport_ship | 1.0 (rear) |
    | hu_druid, aje_shaman, ninigi_monk, seas_medic | 0.2 |
    | hu_jetpack_warrior, ninigi_icespearman, Stina_s0 | 0.0 (front) |
    | MIRAGE also: apprentice, pilot_lvl1 | 0.0 |
    | MIRAGE also: novice_lvl4 | 0.2 |

  - Typical results: melee (range ≈ 2) → y ≈ 0.04 (front). A 30 m archer → y ≈ 0.41. A 60 m catapult →
    y ≈ 0.81 (rear). This matches the help text "ranged in the rear, close combat to the fore".
- `SetCaste` (`character.usl:690-706`; MIRAGE `:995-1011`) would set y to −0.5 / 0 / 0.5 for tec / nat / res.
  It tests the **old** caste (bug), and the next `UpdateFormationAttribs` overwrites it anyway.

### A.5 Interaction with stances / aggro

- Stances are `AggroState_0/1/2` (MIRAGE adds `_3`), `cat='STNC'`, `menupos` 0/1/2(/3). They are handled in
  `FO:8696-8701`: `SetAggressionState(n)`, not for berserkers.
- Meaning, from the comment at `FO:1058-1061` and the help text:
  - 0 = stand ground
  - 1 = defensive (follows the enemy within a 20 m circle)
  - 2 = aggressive (follows until death)
  - state 3 is sticky: `SetAggressionState` returns early (`FO:7095`)
  - MIRAGE adds 3 = Passive (MIRAGE ReadMe:1130)
- **Formations do not change the stance, and the stance does not change the formation.** The only coupling is
  the guard position:
  - At order time: click point (`FO:8830`).
  - After arrival: the unit's own slot (`misc.usl:272-276`). A stand-ground or defensive unit then guards its
    slot.
- Aggressive move (`/AggressiveTarget`, `FO:8702-8716`):
  - Breaks the current task.
  - `UpdateAggressionPos(pos)`, `m_bAggressionWalk = true`.
  - `StartPatrol([pos], 0, GetDefaultSpeed())`. Note: **default speed, not max speed**.
  - It gets FrmDir/FrmSpc only through the command-bar route (§A.3). No mouse path sets
    `HandleNone(aggressive=true)`.
- Attack orders (`/Attack`) carry only the dead `/Formation=standard_0` parameter (§A.2). No arrow.

### A.6 Algorithm to implement in the remake (faithful where known; engine parts marked `?`)

1. **Right-click without drag** (pick point moved ≤ 2.0 units):
   - One group walk order to the clicked point, no FrmDir.
   - Engine default layout `?`.
   - Suggestion: use the same slot layout as an arrow with direction = group centre → target and spacing
     2.7807 (the command-bar default).
2. **Right-drag more than 2.0 units:**
   - Show an arrow from the press point to the cursor.
   - On release, order the walk **at the press point**, facing the arrow direction.
   - Spacing grows with arrow length `?` (engine). Suggestion: `spacing = clamp(len / k, 2.0, 6.0)` with
     2.7807 at the "short" end.
3. **Slot assignment:**
   - Sort units by `formation_y` (low = front row) and then by `formation_x` (low = centre).
   - Fill rows from the front, perpendicular to the facing; the front row gets the lowest y.
   - The exact row width is engine work `?`.
4. **Speed:** each unit uses its own `maxspeed` (script fact). Matching the speed to the slowest unit is not in
   the scripts `?` (optional).
5. **Queued (Shift) waypoints:** when the first member reaches waypoint *k*, all members whose next waypoint is
   *k+1* abandon *k* and re-form toward *k+1*.
6. **Ctrl+right-click:** add a patrol point (`/Patrol`) instead of walking.
7. **Guard position:**
   - Set it to the click point when the order is given.
   - On arrival, set it to the unit's own position.
8. **Persistence:** none. FrmDir and FrmSpc are per order. The client keeps nothing per group (the only
   formation state is the dead global `CFormationMgr.m_sFormation`).

---

## B. The original keyboard layout

### B.1 Loading

- `Game.usl:136-206` `InitCommands()` registers each command name with `m_pxDesktop^.SetCmd(name, proc)`.
- It then loads the accelerator table: first the user file `CClientWrap.GetUserSettingsDir()+"Keys.srf"`; if that
  fails, `options/Keys` (= `BG/options/Keys.srf`) (`Game.usl:204-206`).
- `Keys.srf` format: `Accelerator = '<KEY>, <MOD>, <Command>'` inside `Root{GameUI{…}}`.
  - `MOD` is one of `NONE`, `CONTROL`, `SHIFT`, `ALT`, `CONTROL|SHIFT`.
  - KEY names are Windows virtual-key names.
- Other modules register commands too:
  - groups and spectators: `GIC:74-106`
  - command bar: `CB:1466-1509`
- Other in-game accelerators, added in code:
  - `GameMenu.usl:46` `ESCAPE → Exit` (close the menu)
  - `HelpMenu.usl:59` `ESCAPE → Back`
  - `QuestWindow.usl:119` `ESCAPE → Exit`
  - `EnhancedLoadSaveDialog.usl:19-20` `RETURN → Submit`, `ESCAPE → Exit`
  - `MainMenu.usl:88-90` `UP` / `DOWN` / `RETURN`
- There is no key-rebinding UI. `OptionsMenu.usl` has only a scroll-speed slider (`:846`, `:896-897`).
- The locale files contain no key-name texts (only Ctrl/Shift mentions in point-buy tooltips).

### B.2 Complete default table (`BG/options/Keys.srf`, line numbers; handler location)

**General / debug**

| Key | Command | Effect | Handler |
|---|---|---|---|
| F1 | ShowHelp | open the help window (modal) | `Game.usl:310` |
| F2 | LinkCameraToPath | camera follows the first selected unit (FollowGameCamera) | `Game.usl:335` |
| F3 | FreeCamera | back to the normal game camera | `Game.usl:359` |
| Ctrl+Shift+F5 | ReloadGraphicSets | debug | `Game.usl` |
| Ctrl+Shift+C | Special | debug: toggles the MainController state | `Game.usl:213` |
| Delete | Kill | self-destruct the **first** selected own object | `Game.usl:2508` |
| Shift+Delete | KillAll | self-destruct **all** selected own objects, clear the selection | `Game.usl:2494` |
| Esc | CmdBar_Accel_Abort | disarm the armed command-bar row; enabled only while armed (§B.4) | `CB:1684` |
| Esc | Exit | stop a running sequence, else open the game menu | `Game.usl:1949-1965` |
| Alt+C / Alt+S | SwitchClientShell / SwitchServerShell | debug consoles | — |
| Backspace | HideUI | toggle the interface | `Game.usl:2457` |
| Ctrl+Shift+R | ToggleRangeMarkersAttack | show attack ranges | `Game.usl:2562` |
| Ctrl+Shift+X | ReloadSoundMapping | debug | — |
| Ctrl+Shift+S | SaveLevelAs | editor/debug `?` | — |
| Ctrl+S | Quicksave | `Quicksave.ula`; SP only unless config `Game/ButtonSaveMultiplayerEnable` | `Game.usl:2590` |
| Ctrl+Shift+M | RenderRegions | debug | — |
| Ctrl+Shift+O | ShowObjectNames | debug | — |

**Time** (`Keys.srf:17-21`)

| Key | Command | Effect |
|---|---|---|
| Numpad + (`ADD`) | AccTime | `GameSpeedIncr()` (`Game.usl:2520`) |
| Numpad / (`DIV`) | StopTime | `TogglePause()` (`Game.usl:2540`) |
| Numpad − (`SUB`) | DecTime | `GameSpeedDecr()` (`Game.usl:2530`) |
| Numpad * (`MUL`) | ResetTime | `GameSpeedReset()` (`Game.usl:2535`) |
| Pause | TacticalPause | `TogglePause()` (`Game.usl:2545`) |

**Camera keys** (`Keys.srf:23-25`, plus code)

| Key | Command | Effect |
|---|---|---|
| PageUp | ZoomOut | `Game.usl:274` |
| PageDown | ZoomIn | `Game.usl:265` |
| End | ResetCameraToDefaultView | `Game.usl:292` |
| Arrow keys | (hard-coded VK 37-40) | scroll (`GameCameraModule.usl:207-231`); speed = option "Client/ScrollSpeed" |

**Camera mouse** (`GameCameraModule.usl:431-527`)

- Middle drag = **pan** (`:445-453`).
- Middle + right drag = **rotate and tilt** (`:446-448`).
- Alt + right drag = pan (`:441`).
- Alt + left drag = rotate and tilt (`:442`).
- Wheel = zoom (`:510`).
- Screen-edge scrolling (`:507`).
- Releasing a mouse button can snap back to the default view if "snap back" is on (`:417-424`).

**Chat** (`Keys.srf:27-29`)

| Key | Command |
|---|---|
| Enter (`RETURN`) | ChatToAll |
| Ctrl+Enter | ChatToAllies |
| Shift+Enter | ChatToEnemies |

**Selection** (`Keys.srf:31-38`)

| Key | Command | Effect |
|---|---|---|
| W | PickIdleWorker | next idle worker (by pyramid slot id), camera jumps to it (`Game.usl:2233-2318`) |
| Shift+W | AddIdleWorker | add the next idle worker |
| Ctrl+W | AllIdleWorker | all idle workers |
| Ctrl+A | AllUnitsOnScreen | own CHTR+ANML+VHCL on screen; no ships or buildings (`Game.usl:2039`) |
| Tab | SwitchPyramidForward | cycle the army-controller (pyramid) view state (`Game.usl:2025`) |
| Ctrl+Tab | SwitchPyramidBackward | cycle it backwards (`Game.usl:2032`) |
| H | JumpToHQ | select the nearest finished HQ and centre the camera; when an HQ is already selected, cycle to the next HQ (`Game.usl:2320-2410`) |
| Space | JumpToLastEvent | camera to the player attribute `lastevent` (`Game.usl:2012`) |

**Command-bar grid** (`Keys.srf:43-67`): see §B.4.

| Key | Command |
|---|---|
| Q / A / Y | CmdBar_Accel_R02 / R01 / R00 |
| X | CmdBar_Accel_R10 |
| E / D / C | CmdBar_Accel_R22 / R21 / R20 |
| V / B / N / M | CmdBar_Accel_R30 / R40 / R50 / R60 |
| 1..9, 0 | CmdBar_Accel_1..0 (only while a row is armed) |

**Control groups** (`Keys.srf:69-89`; `GIC:1919-1941`, `:1974-2006`; `GroupMgr.usl:222-…`)

- **Ctrl+0..9 (`SetGroup`):** store the selection in group N.
  - With an **empty selection** it stores a *camera view marker* (eye and look-at) and clears the group.
- **0..9 (`Group`):** select group N.
  - Pressing the same digit again within **300 ms** (`GIC:1983`) centres the camera on the group centre.
  - If the group is empty, the camera jumps to the stored view marker instead.
  - 10 groups (0-9). Shift+digit has no binding.

**Spectator** (`Keys.srf:91-99`)

- Alt+1..8 and Alt+0 = Spectator: view as player N−1 (`GIC:1943-1966`). Alt+0 → index −1 `?`. There is no
  Alt+9.

**Group configs** (`Keys.srf:101-102`)

- Ctrl+G = SaveGroupConfig: write the groups and view markers per level to settings
  `Interface/NumberedGroups/<level>` (`GroupMgr.usl:99`).
- G = LoadGroupConfig (`GroupMgr.usl:46`). It prints "Shortcuts loaded/saved."

**Formations** (`Keys.srf:104-106`)

- Numpad 1 / 2 / 3 = Formation1 / 2 / 3: narrower / wider / defensive. **Dead** (§A.2).

**Building pick** (`Keys.srf:113-120`). Each selects the next own finished building of the class, by distance
from the camera look-at; it skips buildings already selected and pings the minimap. Handler:
`PickNextFromObjQuery`, `Game.usl:2070-2117`.

| Key | Command | Classes |
|---|---|---|
| T | PickNextHQ | hu_fireplace, aje_resource_collector, ninigi_fireplace, seas_headquarters |
| Z | PickNextBarracks | hu_arena, aje_rodeo, ninigi_dojo |
| U | PickNextFarm | hu_small_animal_farm, aje_small_farm, ninigi_animal_farm |
| I | PickNextMachineMaker | hu_machine_maker, ninigi_engineer |
| O | PickNextHarbour | hu_harbour, aje_floating_harbour, ninigi_harbour |
| P | PickNextTemple | hu_temple, aje_temple, ninigi_temple |
| L | PickNextWeaponSmith | hu_weapons_smith, aje_weapons_builder, ninigi_weapon_maker |
| K | PickNextTavern | hu_tavern, aje_cook_house, ninigi_teahouse |

Note: SEAS has entries only for T and H (no seas_barracks and so on). Z/U/I/O/P/L/K find nothing for SEAS.

**Registered but unbound:** ToggleCaptureVideo, DumpLayout, AutoZoomToggle, CameraMatrixMove, ShowSoundMonitor,
SwitchProfiler, SwitchServerProfiler, CmdBar_Accel_R11 / R12. The comments say "S" / "W" (`CB:1476-1478`), but
`Keys.srf` does not bind them.

**Not bound at all:** Stop, Aggressive move, Level up, Rally point, Patrol, Repair, Unload. These are mouse or
button only.

### B.3 Layout note: German QWERTZ geometry

The table was written for a German keyboard. The scripts' comments are in German, and the geometry only makes
sense on QWERTZ:

- `Q / A / Y` is the left column of the letter block (on QWERTZ, Y is bottom-left).
- `E / D / C` is the third column.
- `V B N M` is the bottom row.
- `T Z U I O P` is the top row, consecutive on QWERTZ (on QWERTY, Z is bottom-left).

The UK locale ships no `Keys.srf` of its own, so English players got the same virtual-key letters `?`.

**For the remake, bind by `KeyboardEvent.code` (physical position) using the QWERTZ geometry:**

| Command | Physical key (`e.code`) |
|---|---|
| R02 / R01 / R00 | KeyQ / KeyA / **KeyZ** (the QWERTZ "Y") |
| PickNextBarracks | **KeyY** (the QWERTZ "Z") |
| everything else | the same letter |

Label the keys from `navigator.keyboard.getLayoutMap()` where it is available.

### B.4 How hotkeys reach command-bar buttons (two-step, context dependent)

**Step 1: arm a row.** A letter selects (column, row) and opens the flyout (`CB:1560-1606`, procs `:1654-1684`):

| Key | (col,row) | Flyout | Row → category (top to bottom in the flyout) |
|---|---|---|---|
| Q | (0,2) | BUIL if the selection can build (priority), else PROD | BUIL: **Q = ECON** (economy) · PROD Aje: Q = UMGR · PROD others: Q = — (nothing) |
| A | (0,1) | same | BUIL: **A = COMB** (military) · PROD Aje: A = UPGR · PROD others: **A = UPGR** (upgrades) |
| Y | (0,0) | same | BUIL: **Y = DEFE** (defence) · PROD Aje: Y = UNIT · PROD others: **Y = UNIT** (units) |
| X | (1,0) | STNC (stances) | single row: digits 1/2/3 (/4 MIRAGE) = AggroState_0 hold / 1 defensive / 2 aggressive (/3 passive) |
| E | (2,2) | SPEC (special moves) | the 3rd category, if one exists (e.g. subcat `UPGR` = Aje BuildDown) |
| D | (2,1) | SPEC | hero specials (subcat `UNIT`: Shotgun, Snipershot, Babbage_Minigun …) |
| C | (2,0) | SPEC | normal unit specials (no subcat) |
| V | (3,0) | — | presses the **Attack** action button directly (then click a target) |
| B | (4,0) | — | presses the **Walk to** action button directly (then click the ground) |
| N, M | (5,0),(6,0) | — | no branch handles them: they only disarm (no-op) |

Category order comes from `SetCategory`:

- BUIL: `0 ECON, 1 COMB, 2 DEFE` (`CB:1288-1291`)
- PROD Aje: `0 UMGR, 1 UPGR, 2 UNIT` (`:1292-1296`)
- PROD others: `0 UPGR, 1 UNIT` (`:1297-1299`)
- SPEC: `0 "UNIT", 1 ""`, plus a 3rd category created by the first other subcat (`:1301-1304`;
  `Flyout.usl:308-327`)

**Row index → category.** A row index counts **from the bottom**: `category = usedCategories − row − 1`
(`Flyout.usl:200-232`). So the bottom key (Y / C) is always the bottom row, and the top key (Q / E) addresses
row 3 only when 3 categories are in use.

Arming rules:

- It requires a non-empty selection (`CB:1563`).
- The flyout opens or switches (`ToggleFlyoutWnd`).
- If the addressed row has 0 buttons, nothing is armed (`:1601-1603`).
- While armed, the row's category icon is highlighted and each button shows its digit (`Flyout.usl:400-455`).

**Step 2: a digit presses a button in the armed row.**

- `1..9, 0` → `Accel_K1..K0` → button index 0..9 of that row (`CB:1670-1679`, `:1613-1631`).
- Only enabled, non-disabled buttons are clicked.
- The accelerators `CmdBar_Accel_1..0` and `CmdBar_Accel_Abort` are **disabled by default** (`CB:1504-1514`).
  `EnableCommandShortCuts(true)` enables them while a row is armed (`:1686-1700`).
- While armed, the digits do **not** select groups. Esc disarms. Any digit press, a right-click
  (`GIC:1534` → `AbortKeyboardShortcuts`, `GIC:120-133`) or a flyout clear (`Flyout.usl:329-343`) also
  disarms.
- Both `CmdBar_Accel_1` and `Group1` are bound to '1'. The CmdBar entries come first in `Keys.srf`. The scripts
  imply that the first *enabled* match wins `?`.

**Button index within a row** (`Flyout.CCategoryEntry.Sort`, `Flyout.usl:54-134`):

- `uiposition.menupos` (default 0 when absent; `CmdButton.usl:765`) is a **fixed slot index**.
  - If two buttons claim the same slot, the earlier one is hidden, unless config
    `Game/CommandBar/ShowConflictingButtons` is set (`Flyout.usl:79-87`).
- Buttons with `menupos = −1` fill the first free slots in order.
- `−2` appends at the end.
- The digit label on a button = `menupos + 1`; 10 shows as "0"; above 10 no label (`CmdButton.usl:766-778`).
- Up to 12 slots per displayed row (`MAX_SLOTS_PER_ROW=12`), 24 per category, 3 categories (`Flyout.usl:11-14`).
  Digits reach only slots 0..9. `Accel_KA` / `KB` for slots 10 and 11 exist (`CB:1680-1681`) but are not
  registered (commented out, `CB:1499-1500`).

### B.5 Mouse and modifiers (for completeness)

**Left button**

| Input | Effect |
|---|---|
| Click / drag-box | select |
| Shift + click or box | add (union; Shift never removes) |
| Ctrl + click or box | toggle |

Source: `GIC:1669-1800`.

**Double-click** on an own object (`GIC:1353-1466`) selects visible, selectable objects of the same owner on
screen:

| Input | Selects |
|---|---|
| Double-click | same **class**. Characters must also match "in a transporter or not"; buildings must also match `ObjFlag` and the captain flag |
| Ctrl + double-click | same **type** (CHTR / ANML / …) |
| Shift + double-click | **all** of that owner's objects on screen |
| Double-click a hero | all heroes |

**Right button**

| Input | Effect |
|---|---|
| Click | context order (`GIC:1474-1630`) |
| Drag | formation arrow (§A.3) |
| Shift | queue (`/Queued`); on rally sites it sets the rally point |
| Ctrl | patrol point (`/Patrol`) |
| Click on the minimap | walk order (`MainController.usl:59`) |

**Placing buildings:** holding Ctrl places several of the same type (help `H_general.seml:66`).

### B.6 Original defaults by function (quick reference)

| Function | Keys |
|---|---|
| Command-bar build / produce rows | Q, A, Y (QWERTZ left column) + 1-0 |
| Stance menu | X, then 1 hold / 2 defensive / 3 aggressive |
| Special moves rows | E, D, C + 1-0 |
| Attack (targeted) · Move (targeted) | V · B |
| Control groups | Ctrl+0-9 set (empty = camera bookmark), 0-9 select, double tap (≤300 ms) centres |
| Idle worker | W / Shift+W / Ctrl+W |
| Units on screen | Ctrl+A |
| Jump to HQ · last event | H · Space |
| Next building | T HQ, Z barracks, U farm, I machine maker, O harbour, P temple, L weapon smith, K tavern |
| Pyramid | Tab / Ctrl+Tab |
| Pause | Pause, Numpad / |
| Game speed | Numpad + / − / * |
| Camera | arrows, PgUp/PgDn zoom, End reset, F2 follow unit, F3 free |
| Chat | Enter / Ctrl+Enter / Shift+Enter |
| Menu · help · hide UI | Esc · F1 · Backspace |
| Self-destruct | Del (first selected), Shift+Del (all) |
| Quick save | Ctrl+S |
| Group configs | Ctrl+G save, G load |

### B.7 Tech-tree `uiposition` of the move actions (Base `TT`)

| Action (`/Actions/<tribe>/Moves/<TYPE>/…`) | cat | menupos | Bar location / key |
|---|---|---|---|
| Attack, Walk, AggressiveTarget, Stop | ACTN | 0 | fixed action buttons (`CB:919-990`); keys V (Attack), B (Walk) |
| Kill, Formation_1..3 | — | 0 | Kill = action button `kill` (FLAG_SHOW_KILLBTN); Formations: never shown |
| AggroState_0 / 1 / 2 (MIRAGE: + _3) | STNC | 0 / 1 / 2 (/3) | X then 1 / 2 / 3 (/4) |
| Special moves | SPEC | per action; subcat `UNIT` = heroes (11), `UPGR` (16, Aje BuildDown), none (normal) | C / D / E rows |
| Gate Open / Close / Auto, BLDG Attack | BGLB | — | action buttons on gates / attacking buildings |

### B.8 MIRAGE notes (from `MIRAGE/ReadMe.txt`; MIRAGE client files are NOT in this data, unverified)

- Default hotkey for the Special actions submenu changed from 'A' to 'E' (`ReadMe:1663`). This implies a MIRAGE
  client layout that differs from Base `?`.
- Ctrl+F2 selects all fighting land units; Ctrl+F4 selects all fighting ships (`:1664-1665`).
- Shift+F4 toggles the help window (`:1678`).
- Ctrl+Shift+S auto scout (`:1193`).
- Optional WASD camera instead of the arrow keys (`:1714`).
- "Dot and comma ('.' ',') don't serve camera functions anymore … inherited by PgUp/PgDn (in free style zooming
  mode)" (`:1650`). So '.' and ',' had camera functions in some build `?`; nothing in the Base scripts binds them.
- Per-unit hotkeys file "Shortcuts.txt" (`:167`, `:174`): not present.

---

## C. In the remake

Implemented as §A.6 and §C.3 of the research suggested (`ui/input.js onKey / dragArrow / moveGroup`, `ui/hud.js
armRow`, `game/formation.js`), with these choices:

- Letters are read as on the key (`KeyboardEvent.key`, like the original's virtual keys), not by position; other
  layouts fall back to the key's position.
- The remake's own keys moved to keys the original leaves free: N attack-move, S stop, R rally point, Ctrl+U level
  up, J quest log, Home centre on the selection, F5 / F8 quick save / load, F9 performance overlay, F10 menu,
  "." idle worker, Shift+digit adds a group. Q / E no longer turn the camera.
- The SEAS (not playable in the original) also get building jumps by role: Z barracks, U and I the garage, O the carrier.
- Spacing of the arrow: as wide as the arrow is long (at least 2.7807 m, at most 8 m) - the engine's formula is not in
  the scripts. Rows: ceil(sqrt(1.6 n)) units wide.
- Not done: Formation_1..3 (dead in the original), Tab (the pyramid is always shown), G / Ctrl+G group configs,
  chat keys, the debug keys; a queued group does not wait for its first member at each waypoint.
