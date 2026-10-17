# The game's effects: how the original picks and shows its combat and feedback effects

Researched 2026-10-13 from the game files only. `Data/` = `/mnt/user-data/uploads/Paraworld/Data`.
Shorthand: **E** = `Base/Scripts/Game/misc/Effects.usl`, **G** = `Base/Scripts/Game/Game.usl`,
**FO** = `Base/Scripts/Server/classes/FightingObj/FightingObj.usl`, **B** = `Base/Scripts/Server/classes/buildings/Building.usl`,
**AE** = `Base/Scripts/Server/classes/misc/all_effects.txt`. A `?` marks something not proven by the files.

## 0. Summary

* **Gameplay never reads `particles.txt`.** That file is only used by `CActionEffectObj` (the trigger and sequencer "play effect" action, `Server/classes/misc/MiscObj.usl:2617-2665`): it looks up a path, calls `SetGFX(value)` and `SetSLEAnim("anim",loops)`, and deletes the object after `length*loops` seconds (default 4.0). Every entry in it has `length = '4.0'`.
* Combat and feedback effects are **client-side script classes** (`class CXxx inherit CEffect` in E). Each one sets a position and rotation, calls `SetGFX("<model name>")`, sometimes calls `SetAnim("anim",1,frame)`, and calls `SetDieInterval(seconds)`. The gfx names are model names in the GSF archives (almost all of them in `Base/GSF/all_effects.gsf`). The lookup is case-insensitive (`?`: E uses e.g. `"Levelup_Char_Fx"`, while the GSF stores `levelup_char_fx`).
* Effect classes are started in three ways:
  1. **Projectile impact** (an engine event): `G:920 Evt_OnProjectileImpact` calls `CFXHelper.OnProjectileImpact` (E:27-162).
  2. **Server events**:
     * `InvokeGenericSCEvent(id, t)`: the client maps it in `G:953-1097` (table in §3).
     * `InvokeSCEvent(EID_HitReactionOVLAnim_*)`: the client maps it in `G:1099-1151` (melee blood and flash).
     * `AddFX("<fx object>", seconds)` (FO:3260-3290): this creates a server object from AE, which names its `gfx`.
  3. **Animation frame events stored in the GSF** (the "dusttrail table" of the GSF header): the effect class or `_dusttrail` starts at a given frame of a given animation (§4).
* **`fx_class` and `unit_size` do not choose any visual effect.**
  * `fx_class` (the weapon's, e.g. `Sword` or `Proj_Wood_Small`, and the target's material, e.g. `Unit`, `Wood`, `Metal`, `Stone`, `Bone`, `Ground`, `Water`) indexes `Server/init/MaterialEffects.txt`. That file has 21 weapon classes × 7 materials of `SFX`, and **all 147 `GFX` fields are empty**. So material effects are sound only.
  * `unit_size` is only used for knock-back (`FO:4294 CalcSizeClassThrow`, FO:7472/7664).
* No script reads `fx_class` (grep finds nothing). The engine consumes it: event 37 → `_material_effect`, see §1.3 (`?` for the exact engine lookup).

## 1. Hit effects

### 1.1 Projectile impact: `CFXHelper.OnProjectileImpact(projectile, target)` (E:27-162)

The name is built as `"hit_" + <where> + [tribe_] + <type>`. The chosen name is stored in `CExplosionMgr` (`Game/mgr/ExplosionMgr.usl:26-44`, keyed by the projectile object). Then:

* `CProjectileHit` (E:1665-1674) is spawned at the **projectile's position**. It uses the stored rotation and the gfx from the manager, and **lives 4.0 s**. If the manager has no entry, the fallback is `hit_water_blunt_big` (ExplosionMgr:34-36).
* If `bFlash`: `CProjectileFlash` (E:1676-1684) is also spawned at the projectile's position with gfx `fx_impact_proj_01` or `fx_impact_proj_02` (picked at random; `_03` is never used). It **lives 2.5 s**.

**Step 1: landscape key.** `GetTerrainSetting()` (E:49-62) gives:

| bits | key | particles.txt section |
|---|---|---|
| 0000b | `nor_` | `Land_Northland` |
| 0001b | `sav_` | `Land_Savanna` |
| 0010b | `jng_` | `Land_Jungle` |
| 0011b | `ice_` | `Land_Icewaste` |
| 0100b | `ash_` | `Land_Ashvalley` |
| anything else | `sav_` | |

* This is the **map's level setting**, not the terrain material under the impact.
* The server does the same mapping from the level attribute `Setting` (B:4905-4920): `Northland→nor`, `Savanna→sav`, `Jungle→jng`, `Icewaste→ice`, `Ashvalley→ash`, anything else → `sav`.
* Note: the remake uses the key `jun` for Jungle (`game/maps/source.js:120`). The effect names need `jng`.

**Step 2: projectile type.** `EvaluateProjectile(projectile.GetGraphicSetEntryName())` (E:164-274) is a **prefix match**: `name.Compare(prefix, len(prefix)) == 0`. It checks the prefixes in this order and the first match wins:

| prefix | type | prefix | type |
|---|---|---|---|
| ninigi_muraeno_submarine_arrow | sharp_med | seas_hq_big_cannon_projectile | big_bertha |
| tesla_revolvercrossbow_arrow | sharp_sml | schliemann_flintlock_arrow | sharp_sml |
| tesla_crazy_machine_arrow | explo_sml | bela_knickknackbow_arrow | sharp_sml |
| ninigi_rocket_boat_arrow | explo_big | ninigi_icespear_c/d/e_arrow | sharp_med |
| seas_wehrspinne_bullet | explo_big | aje_ammo_dilo_spittle | poison_sml |
| ninigi_shuriken_arrow | sharp_sml | lovelace_musket_arrow | sharp_sml |
| ninigi_spear_b/c/d/e_arrow | sharp_med | hu_dragon_boat_arrow | sharp_big |
| babbage_pistol_arrow | sharp_sml | ninigi_gatling_arrow | gatling |
| seas_carrier_bullet | sharp_med | ninigi_rb_projektil | explo_big |
| ninigi_mortar_arrow | explo_sml | ninigi_small_rocket | explo_med |
| hu_slingshot_stone | blunt_sml | seas_turret_bullet | gatling |
| druid_staff_arrow | sharp_med | hu_ballista_arrow | sharp_big |
| aje_spear_a/b/c/d/e_arrow | sharp_med | ninigi_cannonball | explo_big |
| hu_spear_b/c/d/e_arrow | sharp_med | aje_ammo_stone | **poison_big** |
| hu_cannonball | blunt_big | aje_ammo_dino | blunt_sml |
| ninigi_bullet | gatling | ninigi_rocket | explo_big |
| ninigi_arrow | sharp_sml | seas_torpedo | explo_big |
| aje_molotov | poison_med | seas_bullet | sharp_sml |
| seas_rocket | explo_med | aje_arrow | sharp_sml |
| hu_arrow | sharp_sml | hu_trunk | blunt_big |
| hu_bolt | sharp_sml | *(no match)* | **blunt_sml** |

There is no `blunt_med` and no plain-name `explo_*` that differs per weapon. The **size comes from the projectile, not from the target**.

Projectiles that actually exist in the techtrees and fall to the default `blunt_sml` (their gfx from `Server/classes/**/*.txt`):

* `all_sling_projectile`: the gfx of `hu_/aje_/ninigi_slingshot_stone`. The prefix `hu_slingshot_stone` therefore never matches a gfx name.
* `Gigantopithecus_Barrel`
* `seas_carrier_arrow`: the table checks `seas_carrier_bullet`.
* `seas_mg_projectile`
* `pirate_boss_arrow`
* `queen_lance_arrow`
* `lovelace_poison_arrow`
* MIRAGE: `ninigi_sordes_arrow`, `item_ammo_mammoth_killer`

`tesla_crazy_machine_arrow` uses the gfx `aje_ammo_dilo_spittle`, so it gives `poison_sml`. MIRAGE's `aje_explo_ammo_dino` also has the gfx `aje_ammo_dino`, so it gives `blunt_sml`.

**Step 3: where.** For a target that is not null (E:73-103), `xType = target.GetType()`:

| target type | prefix | flash | tribe suffix | special rule |
|---|---|---|---|---|
| `CHTR` (character) | `creature_` | yes | no | `bSmall = type != big_bertha` (see step 4) |
| `ANML`, `FGHT` | `creature_` | yes | no | |
| `VHCL` | `object_` | yes | yes | |
| `SHIP`, `BLDG` | `object_` | no | yes | |
| `NEST` | `land_<key>` | no | no | |
| any other type | `creature_` | no | no | |

* With a target, the rotation is `qRot = RotationX(-π/2) * projectile.GetRot()` (E:75-79).
* With no target (a ground shot, E:105-124): if the projectile is **not** gatling **and** `GetHeight(x,y) < GetSeaLevel()` at the projectile's XY, the prefix is `water_`. Otherwise it is `land_<key>`. Gatling bullets always use `land_`. The rotation stays at its default (`?` identity).

**Step 4: suffixes.**

* Tribe (E:126-135): only when the target is `VHCL`, `SHIP` or `BLDG` and the projectile is not gatling. The code reads the target's attribute `tribe`. If it is exactly `Hu`, `Aje`, `Ninigi` or `SEAS`, it appends the lower-case tribe plus `_`. Any other value (e.g. `Special`) gives no tribe, which falls back to the generic `hit_object_*`.
* Type: append the type from step 2.
* CHTR rule (E:138-141): if `bSmall` and the projectile is not gatling, the last 3 characters are replaced by `sml`. **Every non-gatling hit on a character is `_sml`** (`sharp_big` becomes `sharp_sml`). `big_bertha` is kept as it is.

So the reachable names are:

* `hit_creature_{sharp,blunt,explo,poison}_sml` (characters), `hit_creature_big_bertha`, `hit_creature_gatling`
* `hit_creature_<type>` (animals)
* `hit_object_{hu,aje,ninigi,seas}_<type>`, `hit_object_<type>`, `hit_object_gatling`
* `hit_land_{nor,sav,jng,ice,ash}_<type>`, `hit_land_<key>_gatling`
* `hit_water_<type>`

All of these exist in `Base/GSF/all_effects.gsf` except the ones listed in §6.

Dead code:

* `bGatlingLand` is always false: its assignment is commented out at E:88. So `CGatlingScapeHit` (E:364-420), which would place `hit_land_<key>_gatling` for 2.5 s and hide the effect on water, never runs.
* The `bWater` flags are unused.

### 1.2 Melee hits (not projectiles): blood and flash

Server: `FO:4382-4452`, in the `DamageAction` block of the take-damage code. The effect plays when all of these hold:

* an enemy exists
* the target is not on a wall
* the damage is `>= 1`
* the target was not thrown (no knock-back)
* the damage timer is **not** a projectile (`!m_axDmgTimer[i].IsProjectile()`)

Then:

* `dir = GetDirection(-(targetPos - attackerPos))`, giving front, back, left or right. The diagonals are commented out (FO:4441-4444).
* If the target type is not `BLDG`, `VHCL` or `SHIP` and the target is not trapped, the server calls `InvokeSCEvent(EID_HitReactionOVLAnim_<F|B|L|R>, 3.0)` (FO:4446-4450).
* In every case it calls `attacker.InvokeGenericSCEvent(37, 0.2)`. That is the "material effect" (FO:4452), see §1.3.

Client (`G:1099-1151`): each `EID_HitReactionOVLAnim_X` adds **`CBloodHit_X` + `CHitFlash_X`** to the target. The handler returns true, so the engine also continues its default handling (`?` the hit-reaction overlay animation `hit_front/back/left/right`; those animations carry the blood `_dusttrail` described in §4).

| class | target | position and rotation | gfx | life |
|---|---|---|---|---|
| `CBloodHit` (E:465-538) | `CHTR` | world position and rotation of link **`Blfa`** (fallback: object position, E:18-25). `Blfa` is in 244 places in `all_characters.gsf` and 8 in `all_animals.gsf` | **`hit_creature_sharp_sml`** | 2.0 s |
| `CBloodHit` | others (animals etc.) | local `(-sin(d)·0.5·size.x, -cos(d)·0.3·size.y, 3.0)`, rotated by `ownerRot·RotZ(r)` + owner position. `r = (rand%39)·0.01 − (π/16)/|v|²` (`Abs2S` = squared length `?`). Rotation `RotX(−π/2)·(ownerRot·RotZ(r)·RotZ(d))` | **`hit_creature_sharp_med`** | 2.0 s |
| `CHitFlash` (E:422-462) | same position rule (no extra X rotation for non-CHTR) | | `fx_impact_0N`, N = 1..6 at random (`fx_impact_07` never) | 2.5 s |

* d = F 0, B π, L π/2, R 1.5π. The classes for the unused diagonals are FL π/4, FR 1.75π, BL 0.75π, BR 1.25π (E:540-666).
* `CBloodHit` also plays the sound `<tribe>_<caste>_<level+1>_14` for characters. For units with the attribute `unique`, it uses `<class name up to the last _>_<level+1>_14` (E:513-528).

### 1.3 Material effect (sound only)

* Event 37 → client class `_material_effect` (G:1080-1083), added to the **attacker**.
* This is an engine built-in (leading underscore). It presumably looks up `MaterialEffects.txt[weapon fx_class][target material fx_class]` (`?`). `GFX` is empty everywhere, so nothing is drawn.
* Weapon classes: `Proj_Wood_Small, Proj_Metal_Small, Proj_Metal, Gatling, Proj_Wood_Large, Proj_Stone_Large, Axe, Sword, Spear, Hammer, Club, Lance, Ram, Explo_Small, Explo_Large, Poison_Small, Poison_Large, Claw, Mouth, Dino_Foot, Dino_Tail`.
* Materials: `Ground, Water, Unit, Metal, Wood, Bone, Stone`.

### 1.4 Area damage on buildings

* `CArrow.OnDoDmg` with area damage (`Server/classes/misc/Product.usl:548-551`) sends `InvokeSCEvent(EID_BuildingHit_01, 0.1, 0.0)` when the enemy is a `BLDG`.
* The client's `Evt_OnDefaultSCEvent` does not handle it.
* `?` It is probably mapped by the engine to `CBuildingHit_01_01` (E:670-705). That class draws an **invisible** `Blood_01`, adds a `_dusttrail` with `force = Game/Gore/BuildingHitForce` and direction (0,0,1), and lives 0.3 s.
* `CLandScapeHit` (E:707) is the same class. Neither is referenced anywhere in the scripts or GSF.

## 2. Explosions, destruction, dust, blood, fire, smoke

### 2.1 Used

| What | Trigger (file:line) | Client class (E line) | gfx | life | Extra |
|---|---|---|---|---|---|
| All projectile impacts (catapult, cannon, rocket, torpedo, dilo spittle, molotov ...) | §1.1 | CProjectileHit | `hit_*` | 4.0 | + flash |
| Building or ship crosses ≤50 % HP and ≤25 % HP (once per level) | `FO:3047-3071 UpdateDestructionFlags` → event 14; ships `Ship.usl:997-1025`; `CScorpionBoss` B:7084 | `CDestructionHit` (1372-1405) | `BLDG`: **`Explo_Logcannon_Building`**; others: `hit_object_<tribe>_blunt_big` (tribe lower-case; empty, `world` or `special` → `hu`) | 2.5 | camera shake (0.5, 5, 100, pos, 30) |
| Vehicle or torpedo turtle explodes | `Ship.usl:1543 CTorpedoTurtle.Explode` → event 15 | `CVehicleExplosion` (1168-1181) | **`Vehicle_Explosion`** (has `anim`) | 2.5 | shake (0.5, 5, 100) |
| Ninigi water mine / torpedo explodes | `Ship.usl:1617`, `Product.usl:1022/1086` (`CTorpedo`) → event 34 | `CExploNinigiWaterMine` (2235) | `mine_explo` | 2.5 | |
| Ninigi water mine dropped | `Ship.usl:1572` → event 33 | `CDropNinigiWaterMine` (2248) | `mine_drop` | 4.5 | |
| Minefield (`CMinefield` trap) goes off | `B:4905-4921` | server `AddFX` | `hit_land_<key>_explo_big` | 2.0 (server timer) | |
| SEAS rocketman / ninigi mortar fires | `FO:6929-6932` → event 36 | `CRocketLauncherSmoke` (2276-2289) | `fx_seas_rpg` at the link **`Proj`** | 2.5 | |
| Building dies | `FO:5577-5585`: `SetExploTimer` (1 s, FO:5603) → `B:988-990 Delete()` → `B:871-884` creates `BuildingCorpse` (only if ready, not a wall, not a VPU) | none | corpse gfx = `<building gfx>_dest`, plays the clip `destroy` (`B:6296-6298`). After 8 s it sinks (`MoveAction` to z = 0, B:6316-6319; `?` the 1.0 parameter is a speed) and is deleted when the move ends. The `_dest` model's own emitters and frame events give the dust and debris (e.g. `CHu_Temple_Dem_Fx`, §4) | | `ShouldStay` keeps some ruins (B:6251-6268) |
| Vehicle dies | `Vehicle.usl:38-58` | none | `VehicleCorpse` with `<gfx>_dest`, 10 s, clip from the corpse | | |
| Building upgrade or parts destroyed | `BuildUpBase.usl:349-360` | none | `<part gfx>_dest` + clip `destroy` (else `standanim`) | | |
| Character death | `character.usl:2281`, `FinishingMove.usl:165` → event 16 on the corpse | `CSmallAnimalDeathPingFX` (1017) | **`Deathping_Animal_Small_Fx`** (`anim`, owner colour via `SetOwner`) | 3.0 | |
| Animal death | `Animal.usl:945-952` (radius ≤3.5 → 16, ≤5.0 → 10, else 17) | Small, Med or Big `AnimalDeathPingFX` (985-1030) | `Deathping_Animal_{Small,Med,Big}_Fx` | 3.0 | |
| Carcass rots away | `Resource.usl:450-457` (`CDino_Food`; same radius thresholds → 18 / 6 / 19) | `C{Small,Med,Big}AnimalRottingFX` (868-907) | `Deathping_Animal_{Small,Med,Big}_Vanish_Fx` | 5.0 | |
| Poisoned unit | engine flag → `G:933-951` | `CPoisonEffect` (2196-2205), **linked** to the target while the flag is set | `fx_poison` (collision radius < 8) / `fx_poison_big` (≥ 8) | until the flag is cleared | only if the gfx `fx_poison` exists |
| Frozen unit (iced) | engine flag → `G:924-931` | `CIcedEffect` (2145-2194) | `fx_ice_freeze`, blend weight `clamp(radius/20)`, ramps 0 → w in 0.5 s, holds until 4.5 s, back to 0 at 5.0 s | 5.0 | |
| Tree falls (wood cutting) | GSF frame event on the tree's `chop_down[_00.._07]` (§4) | `CCamShakeHarvestTrees` (1628-1649) | **`Leave_Blast`** 8 m from the trunk, direction = suffix digit × 45° (`vOfs.RotZ(-N·π/4)`) | 2.4 | shake (1.0, 5, 100, pos, 20) |
| Ships moving | GSF events on `hu_ram_ship` `walk_1..3` | `CShipWaterSpray{Front,Back}` (2291-2331) | `spray_{front,back}_{1,2,3}` by `size.x`: >20 → 3, >10 → 2, else 1. At links `SpFr` / `SpBa` | 2.5 | |
| Wall drops stones | `B:2274` (`CWall.TakeDmg`) | server `AddFX` | `Hu_Wallstones_Fx` → gfx `Hu_Wallstones`, `anim`, turned towards the enemy | 0.8 | |
| Mammoth stomp | GSF `mammoth stomp` frame 52 | `CPlaceBuildingFX` | `Placeping_Building_Fx` | 1.55 | shake (1.0, 5, 100) |
| Brachiosaurus dies / walks | GSF `brachiosaurus dying` frame 58; `walk_1/2/left/right` frames | `CBrachioDying` (1047): `Placeping_Building_Fx` + shake (1.0, 40, 75). `CBrachioWalking` (1092): **invisible**, shake only | | 1.55 / 0.1 | |

Camera shake signature: `ShakeCameraTheGundlachStyle(strength, count?, distance?, pos[, radius?])` (`?` for the parameter meanings).

### 2.2 Defined but never started

These classes are not started by any script, GSF or class file. Only `Effects_snd.txt` names them.

* `CBigBuildingExplosion` (`Big_Explo_01_Fx`, 5 s, shake 1, 40, 75)
* `CAjeStoneImpact`
* `CMolotovFire` (`Fire_Black`, 10 s)
* `CMolotovImpact` (`Explo_Molotov`, 3 s)
* `CMedExplo01/02/Water`
* `CBallista*`, `CDragonship*`, `CLogcannon*`, `CRamshipExploWater`, `CSmokebombExplo`, `CSteamram*`, `CSteamship*`, `CSteamtank*`
* `CFirepotExplo*` (incl. the `Scape`, `Building`, `Animal`, `Ship` and `Vehicle` variants)
* `CRocketBoatExplo`
* `CBigScapeHit` / `CBigScapeHitBig`, which make the craters `Crater_Small` / `Crater_Big` (`AlignScape`, 15 s, random yaw for big) via `CCrater_*` (E:1723-1751)
* `CExploDiloSpittle`, `CExploWater`, `CExploLovelacePoisonArrow`
* `CAllosaurusDying`, `CAllosaurusWalking`, `CLevelDownFX`
* `CBloodHit_01_01` / `_02`
* `CMineFunken`

They are useful as tuned presets: gfx, life and shake values are all in E.

Event 13 maps to a class `CMolotovExplosion` that **does not exist** (E has `CMolotovImpact`), and nothing sends 13.

### 2.3 Not scripted at all

* **Fire and smoke on damaged buildings**: these come from model emitters toggled by the damage stage (`SetDestructLevel` 1 at ≤50 %, 2 at ≤25 %, FO:3047-3071). The remake already does this (`entities.js:638`, `parts.js`).
* **Construction dust**: the build-up models' billboards and emitters.
* **Walking or running dust**: nothing in the scripts. Brachiosaurus and allosaurus walking only shake the camera. `walkanimconfig.txt` has no effects. `?` Any walk dust is baked into model emitters.
* **Blood decals**: none.

## 3. Feedback effects

### 3.1 Generic SC event map (client `G:953-1097`)

| id | class | gfx (E line) | life | sent by |
|---|---|---|---|---|
| 0 | CAnimalSpawnFX | `Spawnping_Animal_Fx` (923) | 2.85 | `CTheLite.usl:166` (produced animal leaves the building) |
| 1 | CResCharacterSpawnFX | `Spawnping_Char_Res_Fx`, `anim` (748) | 1.2 | `CTheLite.usl:153` (caste `res`) |
| 2 | CNatCharacterSpawnFX | `Spawnping_Char_Nat_Fx`, `anim` (762) | 1.2 | `CTheLite.usl:155` (caste `nat`) |
| 3 | CTecCharacterSpawnFX | `Spawnping_Char_Tec_Fx`, `anim` (777) | 1.2 | `CTheLite.usl:157` (caste `tec`) |
| 4 | CPlaceBuildingFX | `Placeping_Building_Fx` + shake (1.0, 5, 100) (838) | 1.55 | `B:174` building placed (not while loading, not a VPU) |
| 5 | CBuildingReadyFX | `Readyping_Building_Fx`, `anim` (853) | 1.8 | `B:591` building finished |
| 6 / 18 / 19 | Med / Small / Big AnimalRotting | §2 | 5 | `Resource.usl` |
| 7 | CAnimalSleepingFX | `Sleepping_Animal_Fx` at pos + (0, 0, 1) (909) | 15 | `Sleep.usl:69` |
| 8 | CBuildingInventStartFX | `Confirmping_Invent_Fx` (937) | 1.5 | `Action.usl:449` (invention started) |
| 9 | CBuildingInventEndFX | `Readyping_Invent_Fx`, `anim`, owner colour (969) | 1.5 | `Action.usl:691` (invention or upgrade finished) |
| 39 | CAnimalUpgradePing | `fx_aje_convert_sml` (`ANML`) / `fx_aje_convert_big` (others), at link **`con`** (950) | 1.5 | `Action.usl:689` (Aje animal upgrade) |
| 10 / 16 / 17 | death pings | §2 | 3 | |
| 11 | CTrappedScaleState | blend clip `grow` of the trap object | 20 | `FO:2264` |
| 12 | CBrachioDying | | | (unused by the server) |
| 14 | CDestructionHit | §2 | | |
| 15 | CVehicleExplosion | §2 | | |
| 20 / 21 / 22 | CConcealStrip{Big,Med,Small} | `conceal_strip_{big,med,small}`, `anim` | 2.5 | commented out in `Resource.usl` |
| 23 | CHealingWellState | blend clip `fill_anim` | refill time | `MiscObj.usl:2255` (`CFountain`) |
| 24 | CBuildingOpenDoors | blend clip `open_gate` 0 → 1 (0.5 s) → 1 (4 s) → 0 (4.5 s) | 5 | `B:1920`, `B:2860`, `Action.usl:1023` (unit produced / trader) |
| 25 | `AnimalHelpCryGeneric` (no such class; sound only) | | | `FO:6733` |
| 32 | CLivingstoneVanish | `fx_impact_01` | 1.0 | `Hero.usl:394` |
| 33 / 34 | water mine | §2 | | |
| 35 | **CLevelUpFX_Transport** | `Levelup_Char_Fx` at pos + (0, 0, 0.75·size.z), `anim`, owner colour (807) | clip length | `FO:3544` DoLevelUpAnim (also for characters), `Animal.usl:2425` |
| 36 | CRocketLauncherSmoke | §2 | | |
| 37 | `_material_effect` | §1.3 | | |
| 38 | `CPickupItem` (no class in E; sound `FX_CPickupItem` only) | | | `FO:1523` item picked up |
| 40 | CDeathSound | sound `voice_<class>_die` only | | corpses (`MiscObj.usl:2064`, `Resource.usl:300`) |

Level-up in detail:

* `DoLevelUpAnim` (FO:3533-3546) plays the clip `level_up` (if the unit has one) and sends event 35.
* The `level_up` clip of every character also has the GSF frame event `CLevelUpFX` at frame 0 (§4). That gives `Levelup_Char_Fx` at the unit position, synchronised to the unit's current frame, with life = clip length − 0.5 s (E:792-805).
* So a character gets both effects.

### 3.2 Server `AddFX` objects (gfx from AE)

These live as long as the given seconds (−1 = until `RemoveFX`). `LinkAction(owner, link)` makes them follow the unit.

| fx object → gfx | when | file:line |
|---|---|---|
| `fx_heal_passive` | unit is being healed. Removed 2.5 s after the last heal | FO:9001-9013, FO:2554-2556 |
| `fx_heal_area` | temple (`CTemple`) once ready, permanent, linked | B:2794 |
| `fx_hermite_heal` | hermit heals an animal, 10 s | `HealANML.usl:51` |
| `fx_warcry` (2 s) + `fx_warcry_lite` (−1) | war-cry effect flags 2–4 | FO:1813-1853 |
| `fx_unique_pickup` | unit carries a unique item | FO:1501-1503 |
| `fx_ninja_disguise` | hero vanish | FO:1730, `Hero.usl:389` |
| `fx_defensive_mode` | defensive mode | FO:8513 |
| `Sleepping_Animal_Fx` | trapped animal | `Trapped.usl:95` |
| `fx_saltasaurus_doping`, `fx_ninigi_seismo_barrage` (2.8 s, `anim`) | animal specials | `Animal.usl:3441`, `:4329` |
| `trapped_effect` (gfx `ninigi_seismo_trap`, `CLifeTimeObj`) | trap | FO:2257 |

### 3.3 Order, rally and waypoint markers (client, not effects)

* **Ground ping on a right-click order**: `CClientWrap.GetScapeMgr().AddScapeFeedbackPing(pickpoint)`. This runs on every right-button-up with own units selected (`GameInputController.usl:1531`) and on every secondary command target (`SecondaryInputController.usl:539`; not for `JumpOffWall`). It is **engine-drawn**: no gfx name is in the scripts (`?` look).
* **Walk, patrol and mine targets of the selected units** (`MainController.usl:268-356`):
  * A ghost of model `<tribe>_WayPoint` (`hu/aje/ninigi/seas/special_waypoint` in `all_misc.gsf`; tribes `Special` and `SEAS` use `Hu`) per target position.
  * The number model `waypoint_NN` (01–16, `all_effects.gsf`) is linked at its link `Proj`.
  * For mine and turret targets the ghost is `ninigi_mineship_mine` / `ninigi_water_turret`, tinted green.
  * Refreshed when the selection or the attribute `WalkTargets` changes.
* **Rally point** (`MainController.usl:358-412`): ghost `<tribe>_rally_point` or `<tribe>_rally_point_harbour` (swimming, `standanim` loop). Lower-cased.

### 3.4 Not found in scripts

* Resurrection: `Resurrect.usl` has no FX.
* Unit selection: only UI and sounds.

## 4. Animation frame events in the GSF ("dusttrail table")

* Record: `model index u4`, `anim index u2` (**0-based position in that model's animation list**; verified, all 7,452 records resolve), `lstr name`, `u4 start_frame`, `u4 n`, then n × (`lstr key`, `lstr value`).
* The table is read from the GSF headers (all models of Base, BoosterPack1 and MIRAGE).

Base GSF summary (BoosterPack1 and MIRAGE copies carry the same entries):

| effect | model / anim (frame) |
|---|---|
| `CLevelUpFX` | every character, `level_up` (0); 235 models |
| `CTecCharacterSpawnFX` / `CRes…` / `CNat…` | characters, `waking` (1) (115 / 84 / 31 models) |
| `CTec_Sm_Burst_Arrow`, `CTec_Sm_Multishot_Fx` | `tec_sm_burst_arrow`, `tec_sm_multishot` (1) |
| `CRes_Sm_Jump_Fx`, `CRes_Sm_Kick_Fx`, `CSpecial_Matrix`, `CStina_Sm_0` | `res_sm_jump`, `res_sm_kick`, `nat_sm_matrix`, `stina_sm_0` (1) |
| `CCamShakeHarvestTrees` | all `*_timber` trees, `chop_down`, `chop_down_00..07` (frame 40 typ.) |
| `CBrachioWalking` | brachiosaurus `walk_1` (24, 38, 60, 84), `walk_2` (21, 37, 45, 57), `walk_left/right` (24) |
| `CBrachioDying` | brachiosaurus `dying` (58) |
| `CPlaceBuildingFX`, `CBBrachioHarvestFX`, `CMammothRageFx` | mammoth `stomp` (52), `stomp_harvest` (0), `rage_2` (11) |
| `CAllosaurus_Sm_Scrunch_Fx` | `sm_scrunch` (all_animals + savanna_animals) |
| `CShipWaterSpray{Front,Back}` | `hu_ram_ship` `walk_1/2/3` (1) |
| `CNinigiMetzlerHarvest` | `ninigi_harvester` `harvest` (10) → `ninigi_metzler_particle`, `anim`, 2.5 s |
| `CHu_Temple_Dem_Fx`, `CHu_Wall_Dem_Fx` | `hu_temple_dest`, `hu_small_wall_gate_dest` `destroy` (1) → `Hu_Temple_Dem_Fx` / `Hu_Wall_Dem_Fx`, `anim`, 4 s |
| **`Aje_Tent_Dem_Fx`** (no `C`; no such class, so nothing plays) | `aje_dimension_gate_dest` `destroy` (1) |

**`_dusttrail`** is an engine debris particle; its texture is probably `Base/Texture/Effects/dusttrail_fx_(0256).dds` (`?`). It is only on the 230 character models of `all_characters.gsf`, all with the same values:

| anim | frame | params |
|---|---|---|
| `hit_front/back/left/right` | 5 | `bloodcount 64, force 2.5, offset_y 1.5, offset_z 2.0` (blood spray of the hit reaction) |
| `hacking_dirt`, `hacking_stone`, `jetpack` | 25 | `stonecount 32, force 3.5, offset_y 0.5, offset_z 1.0` |
| `sowing` | 20 | `stonecount 32, force 2.0, offset_y 1.0, offset_z 2.0` |
| `scything` | 20 | `corncount 64, force 2.5, offset_y 1.0, offset_z 2.0` |
| `watering` | 20 | `ironcount 32, force 1.0, offset_y 1.5, offset_z 2.0` |

* There is **no `woodcount`**: chopping wood throws no scripted chips (`?` emitters on the tool models).
* `CBloodHit_01_01` (unused) shows the other keys the engine accepts: `offset_x`, `direction_x/y/z`.

## 5. Attachment, timing and parameters

* **Links used**:
  * `Blfa`: blood point on characters (and some animals)
  * `con`: Construct, on Aje animals
  * `Proj`: projectile point, for the rocket smoke and the waypoint number
  * `SpFr` / `SpBa`: ship spray
  * `Spwn`: building spawn point, used by the server only
* **Fallback when a link is missing**: the object position (E:18-25). The 4CC-to-name table is `Game/sequencer/links.txt`.
* **Default placement**: most classes use `SetPos(owner.GetPos()); SetRot(owner.GetRot())`. They are not linked, so the effect stays where it started.
* **Linked effects**: `CPoisonEffect` (`LinkTo`) and the server `AddFX` objects (`LinkAction`, optional offset).
* **One-shot**: every class has a `SetDieInterval`. That value is the lifetime; `particles.txt` `length` is not.
  * `SetAnim("anim", 1, 0)` plays the model clip once from frame 0.
  * `CLevelUpFX`, `CLevelDownFX` and `CBBrachioHarvestFX` start at the owner's current frame and use the owner's clip length (+/−0.5 s).
* **Scale**: no script scales an effect. Size variants are separate models (`_sml/_med/_big`, `spray_*_1..3`, poison big/small, convert big/small).
* **Owner colour**: `SetOwner(owner)` on level-up, invent-end, death pings and the Aje convert ping.
* **Sounds**: `Server/init/Effects_snd.txt` has `FX_<class>` keys (e.g. `FX_CVehicleExplosion`) and **`FX_<hit gfx name>`** keys (e.g. `FX_hit_land_nor_explo_big`, `FX_hit_object_hu_blunt_big`). So each impact gfx has its own sound set. `?` The engine plays them when the effect starts.
* **particles.txt sections** (sequencer only):
  * `Land_<Setting>` / `Creature` / `Object` / `Water`, each split into `Explosion` / `Blunt` / `Poison` / `Sharp` × `_big/_med/_sml`.
  * `Creature` has no `Blunt`. `Object` has only `hit_object_hu_explo_*` and the generic `hit_object_*`.
  * `FX` has `Blood`, `Weapon`, `Conceal`, `Crater`, `Dust`, `Heal`, `Impact`, `Sandstorm`, `Snow`, `Effects`, `Wake`.
  * There are no gatling, big_bertha or tribe variants. All are 4.0 s.

## 6. Missing or broken gfx names

Checked against the model names of every `.gsf` in Base, BoosterPack1 and MIRAGE (case-insensitive):

* `particles.txt`:
  * `fx_dust_cloud_01` → no model.
  * `fx_sandstorm_01_obj`, `fx_sandstorm_02_obj`, `fx_unique_pickup_obj` → missing. The models without `_obj` exist.
  * `fx_bow_wave_01` points at gfx `fx_blood_sprinkle_02`. That is a data error; the model `fx_bow_wave_01` exists.
* Reachable from `OnProjectileImpact` but missing:
  * `hit_land_nor_big_bertha`, `hit_land_sav_big_bertha`, `hit_land_jng_big_bertha`, `hit_land_ice_big_bertha`: only `ash` exists.
  * `hit_object_big_bertha`: the SEAS HQ cannon hitting a non-tribe building, ship or vehicle.
  * `hit_creature_big_bertha`, `hit_water_big_bertha` and `hit_object_<tribe>_big_bertha` exist.
* AE object `hit_big_bertha` → its gfx `hit_big_bertha` is missing (not used by scripts).
* MIRAGE `hu_buildings.txt:568` object `CHu_Temple_Dem_Fx` has gfx `CHu_Temple_Dem_Fx`, which is missing (the model is `Hu_Temple_Dem_Fx`).
* GSF event `Aje_Tent_Dem_Fx` (no class), and G:1009 `CMolotovExplosion` (no class); see above.
* Everything else that E, AE or `Hu_Wallstones` name exists, including `Leave_Blast`, `Fire_Black`, `Blood_01..06`, `spray_*`, `mine_*`, `fx_poison*`, `fx_ice_freeze`, `waypoint_01..16`, the `*_waypoint` models and the `*_rally_point*` models.
* Models with an `anim` clip in `all_effects.gsf`:
  * `big_explo_01/02_fx`, `deathping_animal_*_fx`, `levelup/leveldown_char_fx`, `readyping_building/invent_fx`, `spawnping_char_*_fx`, the `*_sm_*_fx` set, `explo_molotov`, `vehicle_explosion`, `med_explo_01/02`
  * `*_dem_fx`, `explo_firepot_01/02`, `fx_sandstorm_01/02`, `fx_snowdrift_02`, `fx_unique_pickup`, `fx_seas_rpg`, `fx_ninigi_seismo_barrage`, `fx_ice_freeze`
  * `fx_bela_snipershot` (`none`, `impact`)
  * All `hit_*` and `fx_impact_*` have no clip: they are emitters only, so the class's die interval ends them.
* Projectile models (`hu_arrow`, `aje_ammo_stone`, `hu_cannonball`, ...) have their own `impact` clip, which the projectile manager plays (`Product.usl:364 m_sImpactAnim="impact"`).

## 7. BoosterPack1 and MIRAGE

* **BoosterPack1**: no script changes to effects. It has only techtree, class and `UnitAcks` files. Its `all_animals.gsf` carries the same frame events, and its techtree has the same 55 projectiles as Base.
* **MIRAGE** ships **server scripts only** (no `Scripts/Game`), so the Base client tables above apply unchanged. Changes:
  * New `AddFX` objects (`mirage/mirage_misc.txt`):

    | object | gfx | when |
    |---|---|---|
    | `fx_motivate` / `fx_motivate_lite` | `fx_warcry` / `fx_warcry_lite` | |
    | `building_incapacitation_fx` | `Sleepping_Animal_Fx` | |
    | `insects_fx` | `Hu_Insects` | linked `NONE`, duration + 1 s |
    | `titan_fire` | `Fire_Molotov` | at link `FIRE`, `seas_lumberjack_minigun` explosive rounds |
    | `pre_teleport_fx` | `Special_Fx_0` | |

  * Re-used AE objects: `Downgrade_Animal_Fx` (demote / corruption, offset (0, 0, 3)), `Dismount_Char_Fx` (mirroring, offset (0, 0, 0.75)), `Confirmping_Build_Character_Fx` (evading), `fx_stina_hypnosis_big` (peace gong, (0, 0, 3)), `Deathping_Char_Fx` (unboard curse, (0, 0, 3)). Source: MIRAGE `FightingObj.usl:14560-14610, 15075-15250, 15500`.
  * The minefield no longer calls `AddFX("hit_land_<key>_explo_big")`. It sends event **27** instead. MIRAGE also sends events **26, 28, 31, 43, 44, 45** (`Mirage.usl`, `SEAS.usl`, `Aje.usl`, `Hero.usl`, MIRAGE `Building.usl:7428`, `FightingObj.usl:13442`). **None of these ids is handled by the Base client `Game.usl`**, so `?` they show nothing unless MIRAGE's own client (not in these files) handles them.
  * Base event 11 (trapped grow) is commented out in MIRAGE `FightingObj.usl`.
  * Its techtree adds the projectiles `aje_explo_ammo_dino`, `item_ammo_mammoth_killer`, `lovelace_poison_arrow`, `ninigi_rocket`, `ninigi_small_rocket`, `ninigi_sordes_arrow`, `pirate_ship_arrow` and `queen_lance_arrow`. See §1.1 for their hit types.

## 8. What to do in the remake (derived from the above)

1. On a projectile impact, compute the name with §1.1. In order:
   * target type
   * map-setting key (`jng`, not `jun`)
   * water test: terrain height < sea level at XY, not for gatling
   * tribe suffix for `VHCL`/`SHIP`/`BLDG`
   * characters forced to `_sml`

   Then spawn that model at the projectile position. It is particles only: let its emitters run and remove it after 4.0 s. Add `fx_impact_proj_0{1,2}` (2.5 s) for character, animal and vehicle targets. Fall back to `hit_water_blunt_big` or a generic name if the model is missing (§6).
2. On a melee hit (non-projectile, damage ≥ 1, target not a building, vehicle or ship, not trapped, not thrown), do all three:
   * `hit_creature_sharp_sml` at link `Blfa` (characters) or `hit_creature_sharp_med` at the offset in §1.2 (others), 2.0 s
   * `fx_impact_0[1-6]`, 2.5 s
   * the `hit_*` clip's blood debris
3. Level-up: `Levelup_Char_Fx` with its `anim` clip, owner-coloured, at the unit's feet (+0.75·height for transports and resting animals).
4. Spawn:
   * characters: `Spawnping_Char_{Res,Nat,Tec}_Fx` by caste, 1.2 s
   * animals: `Spawnping_Animal_Fx`, 2.85 s
5. Building placed: `Placeping_Building_Fx`, 1.55 s, with a camera shake. Building ready: `Readyping_Building_Fx`, 1.8 s. Invention: `Confirmping_Invent_Fx` / `Readyping_Invent_Fx`, 1.5 s.
6. Deaths:
   * `Deathping_Animal_{Small,Med,Big}_Fx`: radius ≤ 3.5 / ≤ 5 / else; characters always Small; 3 s
   * rotting: `*_Vanish_Fx`, 5 s
   * vehicle: `Vehicle_Explosion`, 2.5 s, plus its `_dest` corpse
   * building: `_dest` model with its `destroy` clip
   * building at the 50 % / 25 % thresholds: `Explo_Logcannon_Building`
7. Tree felled: `Leave_Blast` 8 m away in the fall direction (`chop_down_0N` → N·45°).
8. Orders: the ground ping is engine-drawn (no model). The waypoint ghosts `<tribe>_waypoint` + `waypoint_NN` and the rally ghosts `<tribe>_rally_point[_harbour]` are models.

## 9. In the remake

`src/ui/gamefx.js` (with `src/engine/modelfx.js` for the models) implements §8 1-7 for the world events of
`ui/feedback.js`: projectile hits (§1.1 names, flash on units), melee hits (blood + flash, `Blfa`), level-ups,
spawns, buildings placed / ready, inventions, deaths (pings, vehicle explosion), buildings and ships at 50 % / 25 %,
felled trees (`Leave_Blast`), poison and ice, and the Norse walls' falling stones (`Hu_Wallstones`). The pipeline
always exports these models (`pipeline/build_assets.py GAME_FX`); without them the remake's drawn effects
(`engine/fx.js`) stand in. Not done: the camera shakes are a short generic shake, the hit animations' blood debris
(`_dusttrail`), and the order / waypoint ghosts (the remake draws rings).
