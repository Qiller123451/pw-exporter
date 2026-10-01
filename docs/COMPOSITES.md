> Notes from the datamining run that produced `pwexport/data/composites.json` (see `tools/datamine/`). Paths such as `/tmp/pwout4` refer to the machine it ran on.

# Composite objects in ParaWorld: how the scripts put them together

Files:
- `composites.json`: tech tree object name (lowercase) maps to a list of attached parts.
- `object_gfx.json`: tech tree object maps to its gfx. It also gives the class and class gfx, and the gfx that filters swap in by level or upgrade (for example `hu_large_tower` becomes `hu_large_tower_upgrade`).
- `gen/gen.py` regenerates both files. Its inputs are the `classes.json`, `glblinks.json` and `gfxfilters.json` files next to it. Every `source` is looked up by pattern, so the line numbers are exact. All paths are relative to `Data/`. BoosterPack1 has no `.usl` files, so all the logic is in `Base/Scripts`. The tech tree data is the BP1 `_TechTree.ttree`, taken from `/home/claude/pwr/techtree.json`.

## Fields in each entry
| field | meaning |
|---|---|
| `gfx` | Model name in lowercase, the same as the `/tmp/pwout4/*/<gfx>.glb` file name. Scripts call `CreateObj(<class>)`. Those class names were resolved through the class `.txt` files, because some differ from the gfx. Examples: `ninigi_cart_wagon` uses `ninigi_cart`, `aje_trade_dino_buildup` uses `aje_trade_dino`, `seas_triceratops_transporter_buildup` uses `seas_triceratops_transporter`, `Aje_Muraeno_Submarine_Bell` uses `aje_muraeno_submarine`, and `aje_floating_harbour_macrolemys` uses `macrolemys_water`. |
| `link` / `parent` | The link node on the parent. `parent` is `''` for the unit's own model. Otherwise it is the gfx of the part the model hangs on. |
| `kind` | turret, buildup, drawbar, wagon, rider, weapon, tool, container or other. Level flags, cranes, spray FX, harbour turtles and the rocket bird are `other`. |
| `variants` + `variant_rule` | Other models chosen by epoch, level or random variation. For riders, `variants[i]` is the model at unit level i+1. |
| `anim`, `attack_anim`, `flex_link` | The animation the part plays, and `FlexLinkAction` (trailer-like links with a delay). |
| `link_check` | `ok` means the link was found on the parent GLB. For the models listed under "GSF only" below, it says the link was read from the GSF instead. |
| `glb_missing` | The part has no GLB in `/tmp/pwout4`. |
| `guess` | Set only where the script does not fully determine the case. |

## How the engine assembles parts
1. **Build-ups** (`misc/BuildUpBase.usl`). `CBuildUpBase.AddObj(obj, link)` links an object to the carrier with `LinkAction`. `AddObjFlex(obj, link, delay, parent)` links it to *another part* instead, with `FlexLinkAction` (anim `walk_1`). That second form is used for drawbar → wagon. The first object added is the *primary* part, and:
   - the captain uses the primary part when `GetCaptainLink` returns `bIsBuildUpLink=true`,
   - the level flag uses the primary part's `flag` link,
   - the projectile uses its `psh1`.
2. **Captains** (`TransportObj.usl` `CreateCaptain` / `LinkCaptainObj`, and `CCaptain.UpdateGfx`).
   - A `universal_captain` takes the gfx of the tech tree `captainclass`, with the last character replaced by `level+1` if that gfx exists.
   - The captain also gets the parts of the **last** weapon, in tech tree order, whose `Users` include the captainclass and whose level is ≤ unit level. This weapon is not the best one.
   - Each class's `GetCaptainLink` chooses the link and the idle/attack animations. When it returns false, the captain is hidden. This is the case for all ships except `aje_cronosaurus`, and for `ninigi_firecannon`, `ninigi_siegetower`, the `CVehicle` mobile suits, the lumberjacks, the hovercraft, `aje_trade_dino`, `ninigi_cart` and `hu_kennel_eusmilus`.
3. **Turrets** (`buildings/Building.usl` `CTower.SetTurret`) are linked at `m_xTurretLink`. The default is `Proj`; subclasses use `we` or `RE_1`. On attack they rotate and play `attack_front` (`gun_shoot` for the tesla tower).
4. **Level flags** (`TransportObj.usl` `CheckLevelFlag`): `<tribe>_animal_flag_0<level+1>` at the `flag` link of the primary build-up part, or of the unit itself. SEAS has no flag graphic, so SEAS units get no flag.
5. **Character weapons** (`character.usl` `UpdateWeaponsGfx`): the Parts of the best right-hand weapon, the left-hand weapon and the armor. An empty `Links` defaults to `HndR`. Weapons of level 1 and 2 pick a random class postfix: `''`, `_2` or `_3` for level 1, and `''` or `_2` for level 2 (`WeaponMgr.usl`).
6. **Worker tools and carried items** come from the task scripts (`Harvest`, `Mine`, `GetFood`, `GetCorn`, `GetUnlimited`, `BuildUp`, `Repair` and `DockWall/CBuildLadder`). These are short-lived `SetLinkGFX` calls.

## What was found (see the JSON for every case)
- **Vehicle build-ups.**
  - `hu_steam_tank`: `hu_rhino_ballista_buildup_top` and `_bottom` at `we`; captain at the top's `Dri1`.
  - `ninigi_firecannon`: `ninigi_firecannon_top` at `we`.
  - `seas_wehrspinne`: `seas_wehrspinne_top` at `we`; captain at the top's `Dri1`.
- **Animal build-ups.**
  - `hu_rhino_ballista`: top and bottom at `we`.
  - `hu_mammoth_log_cannon`: top and bottom at `con`. The bottom plays `build_down` and `build_up`.
  - `hu_mammoth_lumber_upgrade`: buildup at `we`. Wood or stone stock sits on the buildup's `psh1`.
  - Transporters at `con`: `hu_rhino_transporter`, `hu_triceratops` (titan), `seas_triceratops_transporter`, `aje_triceratops_archer`, `ninigi_saltasaurus_archer`, `aje_stegosaurus` (captain at `Dri5`) and `aje_brachiosaurus`.
  - Other `con` parts: `aje_trade_dino_buildup`, `seas_triceratops_resource_collector_buildup`, `ninigi_parasaurolophus_gatling_obj` and the seismosaurus launcher.
- **Titan triceratops and seismosaurus** have extra weapon build-ups at `con2` and `con3`, each with its own gunner. The titan uses two ballista tops; the seismosaurus uses two gatlings.
- **Drawbars and wagons.**
  - `aje_resource_collector`: wagon `_a`.. `_e` by epoch.
  - `ninigi_cart`, `hu_chariot` (trailer) and `ninigi_parasaurolophus_drums` (drumwagon).
  - In all four, the drawbar sits at `Db_1` and the wagon flex-links at the drawbar's `Db_2`.
  - `aje_velociraptor_handler`: the captain himself is flex-linked at the raptor's `Db_1`.
- **Ships.**
  - `hu_steam_boat_cannon`, `ninigi_water_turret_cannon` and `seas_carrier_turret` at `we`.
  - The turtle shell and the muraeno bell at `con`.
  - Pirate boss parts at `psh1`, `psh2` and `psh3`.
  - Spray FX at `SpBa` and `SpFr`.
  - The fishnet is placed at `Dri1` but not linked.
- **Buildings.**
  - `seas_turret`, `seas_hq_machinegun_nest_top`, `seas_hq_defense_turret_top` and `aje_tesla_tower_canon` at `we`.
  - `ninigi_rb_top` at `RE_1`, with `ninigi_rb_bird` at the top's `we`.
  - `ninigi_small_tower_upgrade` at `we`, after `tower_sordes_upgrade`.
  - `Hu_Large_Tower_Upgrade_Balista` at `we`, after `hu_ballista_upgrade`.
  - `seas_hq_big_cannon_rotator` at `we`, and its `seas_hq_big_cannon_cannon` at the rotator's `we` after activation.
  - `hu_harbour_crane` at `Cr_3`.
  - The floating harbour carries 4 turtles at `Cr_1`..`Cr_4`.
  - Construction cranes `<tribe>_crane_01/02` at `Cr_1..4` while a building is under construction.
- **Aje T-rex (`aje_atroxosaurus`)** has three riders: `Ride`, `Rid2` and `Rid3`.

## Link check against the GLBs
- Every link the scripts use exists on the parent model.
- **GSF only.** Seven models are not in `/tmp/pwout4` because their archives were not converted: `seas_hq_*` (archive `seas_wwi`) and `pirate_boss*` (archive `sl_pirate_outpost`). Their links were read straight from the GSF with `tools/converter/paraworld_gsf.py`, and they match the scripts.
  - `pirate_boss` itself has **no mesh**. Its 8 chunks are only links: psh1, psh2, psh3, Fm01, Fm03, Proj, we and Dri1. The visible boat is entirely its parts.
- **Mismatch 1: `hu_large_tower`.** The base GLB has no `we`. The turret only fits on `hu_large_tower_upgrade`, which is the gfx the same upgrade filter swaps in. Its `parent` is set to `hu_large_tower_upgrade`.
- **Mismatch 2: rocket ramp ghost.** The client placement ghost hack (`Game/controller/PlaceController.usl:183`) links "rb_top" at `Proj`. `ninigi_rocket_ramp` has no `Proj`. The server uses `RE_1`.
- **Mismatch 3: `hu_flamethrower`.** Its tech tree gfx `flamethrower_s2` (and the s3..s5 level filters) exists nowhere. This looks like an unused or leftover unit.
- **Mismatch 4: Saltasaurus.** It has no `Ride` link. This is harmless, because `ninigi_saltasaurus_archer` always uses the transporter's `Dri1`.
- **Differences from our `compose.js`.** In the scripts, `seas_mobile_suit` and `seas_mobile_suit_flamethrower` are plain `CVehicle`, so **no captain is shown**, and their GLBs have no `Ride` link either. Also, the fallback to `Ride` in compose.js would wrongly put riders on ships.

## Uncertain points and limits
- **`anim`** for the turrets is an attack animation, played only when attacking. Idle is the default pose. The extra T-rex riders at `Rid2`/`Rid3` get no animation from the script.
- **Rider level variants.** These fall back to the plain gfx when `<base><digit>` has no GLB. The game checks `FindGraphicSetEntry`, which should be the same test. Example: `hu_archer_s1.glb` is missing, so the level-1 archer captain shows `hu_archer_s2`.
- **Projectiles.**
  - Arrows, catapult stones and similar are shown at `Proj`/`psh1` only around a shot (`ProjectileOn`/`ProjectileOff`). They are not listed, except the reloaded rockets of `ninigi_rocket_boat` (guess: the gfx is whatever projectile the current weapon uses).
- **Sources not checked or not converted (guesses).**
  - `product_wood_<setting>` uses the abbreviations Sav, Jun, Nor, Ice and Ash, which were not checked against the level files. The vegetation archives are not converted.
  - `hu_corn`: its archive (`hu_resource`) is not converted.
- **Spray FX** (`spray_*`) are particle CFX objects, not meshes.
- **Who uses a task** was inferred from tech tree Actions in a few places:
  - jetpack → hu_jetpack_warrior (confirmed)
  - Shotgun → Cole_s0 (confirmed)
  - Babbage_Minigun_0 → babbage_s0 (confirmed)
  - hu_ladder → hu_worker (guess)
- **Fruit basket for Ninigi.** `GetFood` first sets `ninigi_basket`@`Back` for Ninigi. `USLOnEnter` then overrides it with `Hu_Seed_Basket`@`HndL`, and the JSON lists that override.
- **Optional build-ups** are mutually exclusive. They come from a per-unit upgrade that sets a tech tree flag, which leads to `HandleAction`:
  - `aje_brachiosaurus`: mobile_camp, catapult, transporter, siege
  - `aje_ankylosaurus`: catapult
  - `aje_stegosaurus`: transporter
- **Render-mask flags are not separate models.** These are mesh parts switched on or off inside one model:
  - saddle, armor and misc on animals
  - `VIS_FLAG_VHCL_RAM_HIGH/LOW` on the rhino ballista
  - the drums helmet on `hu_scout`
  - the mammoth armor

  They appear only as `mask` or `note` text.
- **Passengers of open transporters.** They are linked in order to the free `Dri0..Dri9` links of the primary build-up part, skipping the links reserved with `AddIgnoreLink`. They are dynamic, so they are given only as notes.
