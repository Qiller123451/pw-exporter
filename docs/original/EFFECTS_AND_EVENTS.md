# Effect events, camera shakes, felled trees

How the client turns animation frame events and hit events into effects, how its camera shake works, and what happens
when a tree falls. The scripts' side of the effects (which class shows which model when) is in
[GAME_EFFECTS.md](../../remake/docs/GAME_EFFECTS.md); this file adds what was read in `bin/PWClient.exe` (image base
0x400000) and in the scripts for these topics.

## 1. Animation frame events (the GSF "dust trail" table)

Header 1 of a GSF archive has a table of effects started at a frame of an animation
([GSF_DETAILS.md](GSF_DETAILS.md) "Header 1"): model, animation, a name, the start frame and name / value pairs. The
name is a client script class (`CLevelUpFX`, `CCamShakeHarvestTrees`, `C*CharacterSpawnFX` ...) or `_dusttrail`.

* `all_characters.gsf`: 3199 entries, 2300 of them `_dusttrail` (on `hacking_dirt` / `hacking_stone`,
  `hit_front/back/left/right`, `scything`, `sowing`, `watering`, `jetpack`), with parameters `stonecount`,
  `bloodcount`, `corncount`, `ironcount`, `force`, `offset_y`, `offset_z`. The rest are script classes.
* `all_animals.gsf`: 16 entries, all script classes (`CBrachioWalking` = a camera shake, `CMammothRageFx` ...).
* No archive has footstep dust, and none has `_material_effect`.
* The scripts add `_dusttrail` too: `Effects.usl` `CBloodHit_01_01` and `CBuildingHit_01_01`. `Game.usl`
  `Evt_OnGenericSCEvent` id 37 adds `_material_effect`; the server sends event 37 to the attacker on every melee hit
  (`FightingObj.usl` ~4453).

### What the client does with them

The effect dispatcher at 0x4490d0:

* name == `"_material_effect"` → 0x449010: reads the attacker's attribute `CurEnemy`, then 0x448f90 → 0x448d50 plays the
  **sound** of `MaterialEffects.txt` for weapon × material (log line "Mat FX Snd").
* name == `"_dusttrail"` (case-insensitive compare) → **returns; nothing happens.** No string `bloodcount`,
  `stonecount`, `force` or `offset_z` exists in the program: nothing reads the dust trail parameters.
* any other name → the sound event `FX_<name>` plus the script effect class `<name>` (0x64cb30).

So the 2300 `_dusttrail` entries and the `_dusttrail` of the hit classes show nothing in the game.

### Material effects

`Data/Base/Scripts/Server/Init/MaterialEffects.txt`: 21 weapon materials × 7 target materials; every `GFX` is empty. The
native path only plays the `SFX`. A GFX would only be reachable from client scripts through
`CEffectMaterialMgr.GetMaterialEffectGFX` (binding 0x4dc9ca → 0x448c20); no shipped script calls it.

* Row = the attacker's weapon `fx_class` (`Equip_Slot_0/1/2`, picked by the range to the enemy; default
  `Proj_Wood_Small`, 0x46ba90). Column = the victim's `<ObjPath>/fx_class` (default `Ground`, 0x46c050); without a
  victim `Ground`, or `Water` where the terrain height is below 16 m.
* Script functions found in the client's name table and dispatchers:
  * `CObj.GetMaterialEffectGFX` / `GetMaterialEffectSFX(CClntHndl p_khrObject, vec3 p_vPos) : string` (0x46c3c0 /
    0x46c1d0; called on the attacker; pos.x < 0 = its own position).
  * `CEffectMaterialMgr.DoEffect(p_krsWpnMatClass, p_pxObject, pos)` (plays the SFX, 0x448d50),
    `GetEffectGFX` / `GetEffectSFX(string p_ksrWeapon, string p_ksrObject)` (0x448c20 / 0x448af0).
  * The victim from a script: the attacker's attribute `CurEnemy` (an int handle) →
    `CClientWrap.GetObjMgr().GetMirrorObjFromSrvHandle(int)`.
* Dust models that exist in `all_effects.gsf`: `fx_dust`, `fx_dust01`, `fx_dust_puff_sml/med/big`, `fx_dust_twister`,
  `fx_impact_01..07`.

A way to get dust and hit visuals without changing the program (not tried in the game): write effect classes in a
mod's `Effects.usl` (`SetPos` at the owner + an offset, `SetGFX("fx_dust_puff_sml")`, `SetDieInterval`), rename the
archives' `_dusttrail` entries to those class names (footstep dust = new entries on the walk animations at the
footfall frames), change the `_dusttrail` of `CBloodHit` / `CBuildingHit` the same way, and spawn a script effect next
to `_material_effect` for event 37 (optionally through `GetMaterialEffectGFX` after filling the GFX column).

## 2. Camera shakes (`Scripts/Game/controller/GameCameraModule.usl`)

`ShakeCameraTheGundlachStyle(real p_fDuration, int p_iStrength, real p_fFadeOut, vec3 p_vPos[, real p_fMaxRange])`
(GameCameraModule.usl:695-710; duration in seconds, fade-out in %, `maxRange` 60 when left out). A shake is dropped
when the camera's look-at point is farther than `maxRange` from `pos` (tested once, when it starts). Several shakes can run (a list, `UpdateShakes`).
Each one is at full strength until the last `fadeOut` % of its duration (game time), then falls to 0 in steps of
1 %. Amplitude a = 0.03 × strength metres; on odd ticks eye and
look-at move by (x / 2, y / 2, z) with x, y, z random in [−a, a] (z up), on even ticks back by (x, y, z). Distance d
from the look-at point to `pos`: full below 15 m, else × (1 − (d − 15) / 45), 0 beyond `maxRange`.

| effect class | duration / strength / fade-out % / range | started by |
|---|---|---|
| `CPlaceBuildingFX` | 1.0 / 5 / 100 / 60 | a building is placed; the mammoth's stomp (frame 52) |
| `CBrachioDying` | 1.0 / 40 / 75 / 60 | brachiosaurus `dying` frame 58 |
| `CBrachioWalking` | 0.5 / 5 / 75 / 30 | brachiosaurus `walk_1` frames 24, 38, 60, 84; `walk_2` 21, 37, 45, 57; `walk_left` / `walk_right` 24 |
| `CVehicleExplosion` | 0.5 / 5 / 100 / 60 | only the torpedo turtle's explosion |
| `CDestructionHit` | 0.5 / 5 / 100 / 30 | an object falls below 50 % and below 25 % hit points; the Scorpion |
| `CCamShakeHarvestTrees` | 1.0 / 5 / 100 / 20 | a felled tree, `chop_down` frame 40 (below) |

[GAME_EFFECTS.md](../../remake/docs/GAME_EFFECTS.md) lists the effect classes and their models (its reading of the
parameters as "strength, count?, distance?" is superseded by the signature above).

## 3. A tree falls

Script side (`Scripts/Server/classes/vegetation/vegetation.usl`, class `CTree`):

* A tree has 30 hit points. Each chop is `Hit(5)` (`Harvest.usl:665-672`): 6 chops of `WaitAction(1.0)`.
* While the tree has hit points, each chop sends the `Chop` event and the tree plays its `treeshake` animation
  (`CTree.Chop`, vegetation.usl:66-70; the tree models have this clip).
* At 0 hit points the `Bash` event calls `CTree.Fall(true)` (vegetation.usl:72-95): it creates `<ClassName>_Timber` at
  the tree's position with the tree's rotation, creates `<ClassName>_Stump` at the same place and deletes the tree.
* Forest-block trees go another way (`Harvest.usl` `CreateObjTree`, 234-290): they create
  `<Setting>_Tree_0<type+1>_Timber` (and `_Stump` for converted trees) with `RotZ(<the forest tree's rotation>)`.
* The brachiosaurus's wood harvest (`CBrachioHarvest`, `ANMLSpec.usl:480-545`) creates the timbers with rotation 0 and
  picks `chop_down_00..07` so that each tree falls **away** from the brachiosaurus:
  `iAnim = round(|angle(brachio − tree) relative to its facing − pi| / 2pi × 7.999 + 0.5) − 1`.

The log (`_Timber`, class `CWood`, `Resource.usl:197-245`):

* `OnInit` runs `SetAnim("chop_down_0" + (Random % 3 + 1), 1)`: the log plays `chop_down_01`, `_02` or `_03` once
  and holds the last frame. This also happens when a saved game is loaded (the call is outside the `!p_bLoad` branch).
* `SetPlaceBlocker(false)`, at most 5 workers, `CAiInterface.TreeRemoved`.
* **The timber model is the whole tree** - trunk, branches and the crown's foliage billboards - skinned to a 15-bone
  skeleton; `chop_down_0N` knocks it over. The leaves are skinned billboards on the crown bones, so they fall with the
  branches.
* There are 8 clips `chop_down_00..07` plus `chop_down`, each 61 frames (2.4 s at 25 fps). Clip N lands the crown at
  45° × N from the model's +x axis (checked on the end pose of `northland_tree_01_timber`: the clips land at −88, −132,
  −179, 134, 88, 43, −1 and −44°).
* Sound: `chop_down_0N` has `01_work/work_tree_fall1/2.wav` at 0.64 s.
* Effect: every timber model's dust trail table has `chop_down_0N` frame 40 → `CCamShakeHarvestTrees`
  (`Effects.usl:1628-1647`): position = log position + `(8, 0, 0).RotZ(−45° × digit)`, the digit being the last
  character of the current clip name; the offset is **not** turned by the log's own rotation (exact only for logs
  with rotation 0, such as the brachiosaurus's); rotation = the log's; model `Leave_Blast`, gone after 2.4 s; shake
  1.0 / 5 / 100 / 20.
* Afterwards the log stays as it fell (`CWood.OnMine` is empty, so the model does not shrink); it is deleted when its
  value reaches 0 (`CResource.SetValue`, `Resource.usl:94-103`). The value is 300 for `Jungle_Tree_01_Timber` and 150
  for `Jungle_Tree_Med_06_Timber` (`Resources.txt`).
* The stump is a plain `CVegetation` and stays for good; only placing a building removes it (`ForestMgr.RemoveStumps`
  / `PlaceObj` "Vegetation").
* The jungle's medium trees have their own `Jungle_Tree_Med_0N_Timber` and `_Stump` classes and models
  (`jungle_vegetation.txt:176-223`).

## 4. Sleep, hypnosis, trapped

* Stina's hypnosis (`Server/classes/task/MickDundeeMove.usl:99-109`): `SetSLEAnim("rest", iLoops, true, true,
  fDuration)` with `iLoops` raised until start + loops + end covers the duration, then `SetTrapped(duration)` and
  `AnimAction("rest", iLoops, true, true)`: the animal lies down, loops the lying part and gets up exactly when the
  trapped time ends.
* A wild animal's sleep (`task/Sleep.usl:62-67`): `AnimAction("rest", 20..59 loops, true, true)`.
* While trapped (`task/Trapped.usl:94-99, 152`) the unit has the `is_held` buff and the effect `Sleepping_Animal_Fx`
  linked to its `Head` link (`all_effects.txt:279`).
