# ParaWorld economy: implementation spec

Extracted from the original server scripts (UrsRel Script Language) and the runtime tech tree (`/home/claude/pwr/techtree.json`, `StartTT` + `Filters`).
Paths are relative to `Data/Base/Scripts/Server/` (written `S/`). BoosterPack1 only overrides `aje_buildings.txt` (gfx of aje_skull_protector, no economy change) and `NewPointBuyCosts.txt` (the Resources block is identical).

Legend: **[C++]** = logic lives in the engine and cannot be seen. **[?]** = inferred or uncertain. Everything else is a literal reading of the script.

---

## 1. Resources, player attributes, caps

- Player resources are the attributes `food`, `wood`, `stone` and `iron` (= skulls). Hidden unused ones: `resin`, `bone`, `hide`.
- Resource table per tribe (tech tree `Resources/<Tribe>`): Hu `food, stone, wood, iron`. Aje, Ninigi and SEAS: `food, wood, stone, iron`. The order only matters for indexing.
- Node type → player resource (`settings/<Tribe>/Resources.txt`, identical for all 4 tribes): `WOOD→wood`, `STON→stone`, `FOOD→food` (carcasses), `FRUI→food` (bushes and fish).
- `rescap_food/wood/stone` defaults to **300** (`misc/player_attrib_def.txt:4-15`). Maps can change it through a trigger action (`misc/ActionFactory.usl:5616`).

### 1.1 Storage limits (`misc/Player.usl:236-307`)
```
onBuildingReady(b) / onResourceAnimalInit(b): limitBuildings.add(b); UpdateLimits(cut=false)
onOwnerChange: remove + UpdateLimits(false)
onDestroyed(b): limitBuildings.remove(b); UpdateLimits(cut=true, affected = keys where b.UpdateLimits[key] > 0)
UpdateLimits(cut, affected):
  sum[k] = Σ over limitBuildings of techtree(obj)/UpdateLimits/k      // k in max_food,max_wood,max_stone,max_units
  max_units = clamp(sum.max_units, 0, PopulationMax)                    // PopulationMax = map PlayerSettings/.../Restrictions/Chars/Population/Max, default 52
  for r in food,wood,stone:
     max_r = max(sum.max_r, rescap_r)                                    // floor 300
     if cut && ("max_"+r) in affected && player[r] > max_r: player[r] = max_r
```
- A tech-tree change to any `/UpdateLimits/max_*` path calls `UpdateLimits(false)` (`classes/buildings/Building.usl:631-648`). `max_iron` is never computed, so skulls have no script-side cap. The warehouse's `max_iron=1000` is dead data.
- Buildings count only once `SetReady()` has run (construction finished) (`Building.usl:597-600`). The Aje collector counts from spawn (`classes/animals/Animal.usl:3666-3687`).

### 1.2 Depositing (`classes/character/character.usl:2995-3046`, `Player.usl:329-353`)
```
CheckInResInvAllPossible(depot): for each res r with inv[r] > 0 and depot.attr[r+"Delivery"]: CheckInResInv(r)
CheckInResInv(r): rest = player.AddResource(r, inv[r]); inv[r] = rest; return rest != original
AddResource(r, v, orig=v):
  if cur >= max: return min(v, orig)                  // nothing accepted, the load stays in the worker
  rest = (cur + v <= max) ? 0 : v - (max - cur)
  rest = min(orig, rest); player[r] += int(v - rest)   // truncated toward zero; the fraction is lost
```
- **AI bonus** (`Player.usl:601-618`, CAiPlayer only): delivered value × {difficulty 5: 1.25, 6: 1.5, 7: 1.75, 8: 2.0, 9: 2.5}. The overflow is computed against the un-multiplied original.
- If nothing is accepted (storage full), every gather task loops `WaitAction(2.0 s)` at the depot and retries (e.g. `Harvest.usl:1002`, `Mine.usl:476`, `GetFood.usl:569`, `GetCorn.usl:327`).
- Delivery flags come from the tech tree `Objects/.../delivery/{food,wood,stone,iron,...}` → building attributes `<res>Delivery` (`classes/FightingObj/FightingObj.usl:2606-2634`).
- Depots play a `deliver` anim on each check-in (`CAcceptDeliveries`, `task/AcceptDeliveries.usl:54-95`). This is cosmetic: `deliver` loops `1 + queued`, with at most 5 queued.
- Depot search (all tasks): own buildings (plus allied ones via `AddOtherFriendsToSearch`) with `<res>Delivery=true`, excluding any with `CurTask=="BuildUpB"` (under construction). Sorted by distance. The nearest one that passes `CheckMaxAutoprodDist` [C++] wins, or the only remaining one.

### 1.3 Population (see also rules_spec)
- `max_units` is as above. Recruit check: `units + virtual_units >= max_units` → refused (`Building.usl:3108-3111`, `misc/RequirementsMgr.usl:173-297`).
- The level pyramid defaults to 25/15/8/3/1. AI difficulty 7/8/9 adds +4/+10/+28 to max units (`RequirementsMgr.usl:188-240`).

### 1.4 Starting position (`classes/misc/StartLocation.usl:384-403, 604-637`)
- Hu gets `hu_fireplace`, Ninigi `ninigi_fireplace` and SEAS `seas_headquarters`, all pre-built (`SetReady`). Aje gets an `aje_resource_collector`, but only for AI players or when credits == -1. Otherwise the player buys it with points.
- Starting food/wood/stone/iron come from the map or point-buy (`PlayerSettings/Player_N/Restrictions/Resources[/Hu]`). There are no script defaults.
- Point-buy cost per resource unit (`settings/NewPointBuyCosts.txt:599-624`): food 1.0, wood 1.5, stone 2.0, iron 100.
- Multiplayer anti-cheat: `usedCredits > available(+collector +30)`, or food < 30, → all resources are set to 0 and the player gets 1 worker (plus a collector for Aje).

---

## 2. Resource nodes (`classes/misc/Resource.usl`, `settings/Resources.txt`)

| Node (type) | Class | Value | Notes |
|---|---|---|---|
| Trees → `<Tree>_Timber` log (WOOD) | CWood | Ashvalley 400. Icewaste, Northland, Savanna 300. Jungle 300, Jungle_Tree_Med 150, Beachpalm 250, Jungle Bamboo/Dead 100. Northland Larch 150, Beech 500 | `Resources.txt:2-266`. **Max 5 workers per log** (`Resource.usl:212, 223-230`) |
| `Resource_Stone[_Ash/_Ice/_Jun/_Nor/_Sav/_Cave1-3]` (STON) | CStone | 2000 | `Resources.txt:268-296` |
| `<Setting>_Fruit_Bush`, `Nest_Anurognathus_Fruit_Bush` (FRUI) | CFruit_Food | 150 | `Resources.txt:297-315` |
| `FishShoal_Tristychius` (FRUI, attr `fish=1`) | CFishShoal | 2500 | `Resources.txt:316` |
| `<animal>_food` carcass (FOOD) | CDino_Food | per species, e.g. Triceratops 2000, Brachio 1800, Mammoth 800, Stego 900, Allosaurus 700, Iguanodon 600, Wild_Boar 450, Deinonychus 150, Psittacosaurus 50, Lemur/Sloth 5. Owned units: hu_mammoth 500, aje_resource_collector 100, … | `Resources.txt:320-624`. An entry that is missing → 100 (`Resource.usl:61-65`) |

- `SetValue(v)`: `value = max(v, 0)`. `hitpoints = round(value)`. The node is **deleted once value ≤ 0.5** (`Resource.usl:88-97`).
- `Mine(x)` returns the amount actually removed (`Resource.usl:104-110`).
- **No regrowth** anywhere, and no replanting. Stumps (`<Tree>_Stump`) are decoration.
- Visual stages for stone and bushes: `VIS_FLAG_RSRC_STATE1..6` at value thresholds 0/100/250/500/750/1000 (`Resource.usl:15-21, 118-131`).
- **Trees** (`classes/vegetation/vegetation.usl:33-55`): the TREE object has 30 HP. Each chop hits for 5 → **6 hits**. Forest "fake" trees use `ForestMgr.GetMaxHPFakeTrees()` [C++]; the comment says "6 hits to chop a tree". At 0 HP the tree is replaced by `<Tree>_Timber` (CWood, anim `chop_down_0{1..3}` random) plus `<Tree>_Stump`.
- **Carcasses** (`Resource.usl:277-319, 440-488`):
  - Rot timer: 120 s for wild kills (owner −1). 8 s for owned kills, which also become non-hitable and non-selectable, so they can't be harvested.
  - Every `Mine()` resets the timer to 120 s.
  - Once rotting (the timer fired), `Mine()` returns 0 and the corpse sinks: MoveAction down by 1.3 × height, over height/5 s.
- **Wild animals eat bushes** (`task/Feed.usl:134-159`): each `feeding` loop does `Mine(animal.dmg)` on the CFood target and heals the animal by `mined/2`. There are 2..6 bouts × 3..10 loops.

---

## 3. Carry capacity and time factor

### 3.1 Worker carry capacity (`character.usl:2364-2377, 2734-2748`)
```
cap[r] = ResInvCaps[r] (default 5 if missing) * Mod(ResInv, rel) + Mod(ResInv, abs) + Σ BONUS_MAXRESINV
Mod path = /Modifications/<Tribe>/CHTR/ResInv/<caste>_{rel|abs}   (worker caste = "res"; defaults rel 1, abs 0)
```
| Worker | Base food/wood/stone | Level bonus (Filters `…/<worker>/LvlN_Bonus`, add to ResInvCaps) | Building upgrades |
|---|---|---|---|
| hu_worker | 20/20/20 | L2 +5, L3 +10, L4 +15, L5 +20 | hu_lumberjack_cottage `wood_inventory_upgrade_1..4` +5 wood each (stone 100/125/150/200; age 2..5). `food_inventory_upgrade_1..4` +5 food each (wood 100/125/150/200). hu_stone_quarry `resource_inventory_upgrade[_2.._4]` +5 stone each (wood 100/125/150/200). All take 20 s |
| aje_worker | 20/20/20 | none | none. Aje speed up instead (3.2) |
| ninigi_worker | 20/20/20 | L2 +10, L3 +20, L4 +30, L5 +40 | lumbermill `ninigi_pannier_wood_1..4`, hunting_lodge `ninigi_pannier_food_1..4`, stone_quarry `ninigi_pannier_stone_1..4`: +5 each. Costs are the same as Hu; each needs the previous one |
| seas_worker | 20/20/20 | L2 +5, L3 +10, L4 +15, L5 +20 | none |

- [?] Level filters are assumed to **replace** each other (only the current level's filter is active), giving hu/seas 20/25/30/35/40 and ninigi 20/30/40/50/60. If the engine stacks them, the totals would instead be 20/25/35/50/70.
- Item `item_pannier` (filter `Items/item_pannier_filter`) adds +10 abs to `ResInv` for castes tec/res/nat of Hu, Aje and Ninigi. [?] It's active while the item is held.
- **Load accounting quirk:** `ResInvAdd` does not clamp. The tasks always add exactly the free space, so a load always equals `cap − current`.

### 3.2 Time factor (`character.usl:2230-2250`, `FightingObj.usl:3766-3772`)
```
SelfTF(obj)  = techtree(obj)/timefactor; if <= 0 → 2.0
GetTimeFactor(target):
  if target invalid:            return SelfTF(worker)
  if target is CFightingObj:    return SelfTF(worker) * SelfTF(target)          // buildings
  else:                         return SelfTF(worker) * TT("TimeFactor/"+target.type, 2.0)   // STON/FOOD/FRUI nodes
```
- Worker SelfTF: hu 1.0, aje 1.0, ninigi 1.0, **seas 2.0**.
- `aje_resource_tool_upgrade_1..4` (at aje_resource_collector; costs 100/100, 125/125, 150/150, 200/200 wood/stone; age 2..5; each requires the previous; 25 s) each multiply `aje_worker/timefactor` by **0.75**. That gives 0.75, 0.5625, 0.4219, 0.3164.
- Buildings: hu_corn_field 0 (→2.0), ninigi_paddy 2.0, ninigi_bamboofarm 0 (→2.0), seas_greenhouse 2.0, aje_slaughterhouse 0 (→2.0).
- [?] **Node TF:** the script reads `TimeFactor/STON` etc., but the tech tree stores these under `TimeFactor/<Tribe>/STON` (= 1.0). As written, the lookup should miss and fall back to **2.0**. The existing remake uses 2.0 (rules_spec "[inferred]"). Keep it a config constant: `NODE_TF = 2.0` (literal) vs 1.0 (if the engine resolves tribe paths).
- **Wood is special:** `CHarvest` never sets `m_xHarvestSite`, so wood uses SelfTF only (`Harvest.usl:839`).

### 3.3 Loops per load (the core formula)
```
step       = cap[firstRes] / (K * TF)                  // "number of loops per full charge" = K
numLoops   = F2I(space / step) = F2I(K * TF * space / cap)       // F2I = truncate [?]
time/load  = numLoops * animLoopSeconds(anim) + walking + fixed pick-up/put-down
amount     = space (whole free capacity, credited in one go)
```
| Activity | Task | K | TF | Anim (looped) | Credited | Empty-load loops, Hu/Ninigi/Aje/SEAS |
|---|---|---|---|---|---|---|
| Wood (log) | CHarvest | 5 | self | `hacking_dirt` | after the loops | 5 / 5 / 5→3,2,2,1 / 10 |
| Stone | CMine | 5 | self × NODE_TF | `hacking_stone` | after the loops | 10 / 10 / 10→7,5,4,3 / 20 (NODE_TF=2) |
| Bush / carcass | CGetFood | 3 | self × NODE_TF | `harvesting_bush` (bush) or `potter_ground` | after the loops | 6 / 6 / 6→4,3,2,1 / 12 |
| Field / greenhouse | CGetCorn | 5 | self × bldgTF | `sowing` / `scything`, in chunks of 2..5 | per chunk, before its anim | ≈10(+1) / 10 / – / 20 |
| Slaughterhouse | CGetUnlimited | 5 | self × bldgTF | `potter_ground` | **before** the anim | – / – / 10→7,5,4,3 / – |

- Loop seconds come from the anim clips in the GSF files, not from the scripts.
- [?] `AnimAction(anim, 0, …)` (possible when K·TF < 1) is engine-defined. Treat it as a single play.

---

## 4. Gathering tasks (state machines)

Common to all: the worker hides its weapons. Search helpers skip positions that failed before: at most 10 bad targets (`MAX_INVALID_TARGETS`), 15 walk failures → exit. `CheckMaxAutoprodDist` [C++] limits the auto-search radius from the depot. The carried prop is set by tribe (`SetThing`, `Harvest.usl:90-108`): Hu `hu_pannier`@Back, Aje `aje_clay_jug`@HndR, Ninigi `ninigi_basket`@HndR, SEAS `seas_backpack`@Back. The wait anim is `standing`.

### 4.1 Wood, CHarvest (`task/Harvest.usl`)
1. `goto_chop[_forest]` → walk to a free spot at the tree. The tool `<tribe>_axe` (from the class-name prefix) is linked to HndR.
2. `rotate_to_tree` → arrival radius 8 m.
3. `chop_tree`: `SetSLEAnim("chop_tree", 9999, loop)`. Each tick: `WaitAction(1.0 s)`; tree HP −5 (real tree events `Chop` → the tree plays `treeshake`, `Bash` → falls). **6 s per tree** (`Harvest.usl:654-695`).
4. `search_for_jobs`: the nearest WOOD log within **64 m** of the job position that accepts a worker (≤5). Otherwise the next forest tree within 64 m, preferring a short delivery path, with |Δz| ≤ 10 m. Otherwise a TREE object within 64 m. Otherwise end (`Harvest.usl:696-792`).
5. `goto_harvest`/`rotate_to_log` (8 m) → `harvest_log`: `AnimAction("hacking_dirt", numLoops)` (K=5) → `add_forest_to_inv`: `log.Mine(space)` → `AnimAction("shoulder_pick_up")`, link `Product_Wood_<Set>` (the first 3 letters of the map setting, e.g. `Product_Wood_Jun`) to HndR (`Harvest.usl:838-904`).
6. `goto_deliver`: AdvanceAction with walk-set **`sldr`** (shoulder carry). Arrival = depot radius × 2.
7. `drop_trees` → `put_log_down`: `AnimAction("shoulder_put_down")` → back to the same log/tree, or search again. The idle stance while waiting is `shoulder_standanim`.
- If no depot is reachable: `standanim` + `WaitAction(3 s)`, one retry, then end.

### 4.2 Stone, CMine (`task/Mine.usl`)
- Tool `<tribe>_pick`. Arrival 4 m. `mine_stone`: `AnimAction("hacking_stone", numLoops)` (K=5, `Mine.usl:278-299`). Then `stone.Mine(space)`, and the node's visual flags update.
- `pickup_stones`: `SetAnim("pick_up")`, then wait **0.3 s** (the carried prop appears at 0.2 s) (`Mine.usl:125-127, 212-224, 360-364`).
- Deliver: walk-set **`cary`**, arrival 4 m. `SetAnim("put_down")`, wait 0.3 s (the prop is removed at 0.2 s).
- Next stone: the nearest visible STON within **100 m of the last depot position**.

### 4.3 Food, CGetFood (`task/GetFood.usl`)
- Target FOOD (carcass) or FRUI (bush; fish shoals are excluded via `fish≠1`). Arrival 4 m. K=**3** (`GetFood.usl:318`).
- Anim: `harvesting_bush` + `Hu_Seed_Basket`@HndL only if `className == <Setting>+"_Fruit_Bush"`. Otherwise (carcasses, and lowercase `ashvalley_fruit_bush` [?]) `potter_ground` (`GetFood.usl:184, 340-346`).
- Then `food.Mine(space)`. `pick_up` for 0.3 s, deliver with walk-set `cary`, `put_down` for 0.3 s (`GetFood.usl:190-192`).
- **Hunting chain** (`GetFood.usl:157-165, 478-497`): if the first target was a wild carcass (owner −1, `aggressive == −1`), `huntClass` is remembered. When no FOOD is left within **50 m**, the worker auto-issues `/Attack` on the nearest living non-baby animal of that class within 50 m. Otherwise it falls back to FRUI within 50 m.
- Search order within 50 m of the last job: FOOD → hunt → FRUI → deliver the leftovers → end.
- Only `CCharacter`s can run this task. Vehicles given GetFood (e.g. `seas_mechanical_walker`, `Vehicle.usl:210-219`) end immediately (the USLOnEnter type check `CHTR`) [bug, reproduce as "cannot gather food"].

### 4.4 Fields, CGetCorn (`task/GetCorn.usl`), used for any **CGrowingField**
- Register with the field, which has **2 slots** (`m_iMaxWorker = 2`, `Building.usl:3488`). If it's full, try another ready `CCornfield` within 50 m, otherwise end.
- The worker stands at a random point within ±2 m of the field centre. Arrival = field radius.
```
step = cap[res] / (5 * SelfTF(worker) * SelfTF(field))
cycle: loops = 2 + rand()%4; if step*loops > space: loops = int(space/step) + 1
       worker.inv += min(step*loops, space)            // field.Mine returns hit unchanged; 0 while under construction
       field.SetAnim("grow", frame=growStep); growStep++ (wraps to 0 after 100)
       anim = growStep < 25 ? ("sowing", link Hu_Seed_Basket@HndL) : ("scything", link Hu_Sickle@HndR); AnimAction(anim, loops)
full → AnimAction("shoulder_pick_up"), link Hu_Corn@HndR → depot (walk-set sldr, arrival 4 m) → SetAnim("shoulder_put_down") → return
```
- The field **never depletes, decays or needs replanting**. `growStep` is purely visual and shared by both workers.
- CCornfield (hu_corn_field) additionally shows a scarecrow flag while a worker is registered.
- The field's `unlimited/<res>` node decides the resource: paddy/corn/greenhouse → food, bamboofarm → **wood**.

### 4.5 Unlimited buildings, CGetUnlimited (`task/GetUnlimited.usl`), for other `UnlimitedBuilding==1`
- Dispatch (`character.usl:1955-1964`): a CGrowingField → GetCorn. Class `Ninigi_Resin_Field` → ShootBurningArrow. An `UnlimitedBuilding` attribute → GetUnlimited.
- Slots: CUnlimitedBuilding 2, **CAjeUnlimitedBuilding 4** (`Building.usl:3453-3466`). Arrival < 1.29 × radius.
- `bash_food`: **the full space is added to the inventory immediately**, then `AnimAction("potter_ground", F2I(5*TF))` → `AnimAction("pick_up")`. Prop `Hu_Corn`@HndR. Walk-set `sldr`. `AnimAction("put_down")`.
- Wait stance: `shoulder_standanim` + 2 s when storage is full.
- Task init requires `can_build` (`GetUnlimited.usl:62`). The command dispatch requires `can_harvest`.
- `CResiner` (converts player wood 1:1 into the carried resource, `Building.usl:3678-3712`) is **not used by any object**.

### 4.6 Fishing (`task/Fishing.usl`, brief)
- **Boats** (`hu_fishing_boat`, `ninigi_fishing_boat`, ResInvCaps food 50):
  - Sail to the shoal (arrival XY < 6 m), then `ThrowNet` and `shoal.Mine(space)`.
  - Stay until **7 s** after the net was thrown, then `PickUpNet`.
  - Sail to the nearest `fishDelivery` building (harbour dock pos) and check in.
- **aje_floating_harbour** (CSwimmingHarbour):
  - Every cycle `shoal.Mine(10)` → added directly to player food (capped) → `WaitAction(5 s)`. That's **2 food/s**.
  - Bug to reproduce: on overflow, `CheckInFood` adds the *excess* part rather than the room (`Fishing.usl:455-458`).
  - Next shoal: the nearest within 400 m.

### 4.7 Harvester vehicles (`task/HarvesterTask.usl`, `task/MineTask.usl`)
- Allowed only for `CHarvester`, `CMammoth` with `can_harvest`, and `CMechWalker` (`HarvesterTask.usl:408`, `MineTask.usl:144`).
- **Wood:**
  - One `DoCutAnim` fells any tree instantly (`Hit(100000)`, `HarvesterTask.usl:526-561`).
  - `DoTakeAnim` then takes **the whole log in one trip**: `SetResInv(log.Mine(value+1))`, with **no cap** (`:765`).
  - Delivery goes to the nearest `woodDelivery`. Arrival is the ring < radius × 1.256893.
  - Wood only; the resource list comes from the node table.
  - Stock gfx: `hu_mammoth_lumber_upgrade_wood` for ninigi_harvester/mammoth, otherwise `<Setting>_Tree_01`.
- **Stone** (MineTask): one `DoMineAnim` → `stone.Mine(GetResInvCap())` → deliver to `stoneDelivery`, then `WaitAction(1 s)`.
  - Cap = `m_fResInvCap`: default **150** (`FightingObj/TransportObj/TransportObj.usl:195`), mech walker **20** (`Vehicle.usl:177`).
  - Next stone: the first STON within 100 m of the last depot.

| Object | Class | Wood | Stone | Anims (cut / take / mine) |
|---|---|---|---|---|
| ninigi_harvester | CHarvester | whole log | – | `harvest` / `attack_front` / – (`Vehicle.usl:674-680`) |
| hu_mammoth_lumber_upgrade | CMammoth (`can_harvest=1`) | whole log | 150 | none / none / `attack_front` (`Animal.usl:2458`) |
| seas_mechanical_walker | CMechWalker | whole log | 20 | `work_0` / none / `work_0`. Food fails (4.3) |
| seas_lumberjack / _minigun | CVehicle / CLumberjack | no economy role | | |
| seas_triceratops_resource_collector | CTriceratops | no delivery flags, inert | | |

- `ninigi_harvester`: `NextJob` on a ready `hu_lumberjack_cottage`/`ninigi_lumbermill` → auto-harvest around itself (`Vehicle.usl:638-672`).
- The tech tree `ResInvCaps` of these vehicles (150 wood/stone, walker 50/50/50) is **not read** by the scripts.

### 4.8 Misc tasks
- `DeliverResources` (`task/DeliverResources.usl`): a manual "use" on a depot while carrying → walk until < 1.3 × radius → check in → `AnimAction("belly_put_down")` → end.
- `PickUp` (`task/PickUp.usl`): an item pick-up (inventory, not resources). Walk to within 0.9 m, `pick_up`. Fails with `_NT_PickUpFailInvFull` if the inventory is full.
- `ResKick` (`task/ResKick.usl`): the "kick" invention (a special action, `character.usl:285-300`). Anim `res_sm_kick`, 2 damage, knockback 0.7 s at 10 m/s (+0.5 up). Combat, not economy.

---

## 5. Buildings

### 5.1 Economy class → object map (from `classes/buildings/*_buildings.txt`)
| Script class | Hu | Aje | Ninigi | SEAS | Behaviour |
|---|---|---|---|---|---|
| CFireplace (CRallyBuilding) | hu_fireplace | – | ninigi_fireplace | seas_headquarters | main depot, rally, age visuals |
| CLumbermill | hu_lumberjack_cottage | – | – | – | QuickHarvest, depot |
| CStonemason | hu_stone_quarry | – | ninigi_stone_quarry | – | depot |
| CHuntingLodge | – | – | ninigi_hunting_lodge | – | depot |
| CNinigiLumbermill | – | – | ninigi_lumbermill | – | depot |
| CWarehouse | hu_warehouse | aje_bazaar | ninigi_warehouse | – | depot, `TradeBuilding=1`, buy_* |
| CMarketplace (CWarehouse) | hu_marketplace (not in the tech tree) | – | – | – | same as warehouse |
| CSeasSteelwork | – | – | – | seas_steelwork | depot |
| CCornfield (CGrowingField) | hu_corn_field | – | – | – | GetCorn, 2 workers |
| CGrowingField | – | – | ninigi_paddy, ninigi_bamboofarm | seas_greenhouse | GetCorn, 2 workers |
| CAjeUnlimitedBuilding | – | aje_slaughterhouse | – | – | GetUnlimited, 4 workers |
| CSwimmingHarbour | – | aje_floating_harbour | – | – | fishing 10 food / 5 s |
| CLargeHouse | – | aje_big_tent | – | – | rally site only |
| CBuilding (plain) | hu_stone_cottage | aje_tent | – | – | housing via UpdateLimits |
| CRallyBuilding | hu_small/big_animal_farm | aje_small/medium/huge_farm | ninigi_animal_farm | – | unit producers (not gatherable) |
| CResiner, CSmallestHouse, CMediumHouse | – | – | – | – | **unused** (the comments name planned houses) |

- The tech tree's `maxworkers` (greenhouse 4, corn/paddy/bamboo 2, slaughterhouse 4) is **not read**. The slot count is the hardcoded class value, so **seas_greenhouse = 2** (see 7).

### 5.2 Depot, storage and housing data (tech tree `delivery` / `UpdateLimits`)
| Object | Delivers | max_food/wood/stone | max_units | Upgrades |
|---|---|---|---|---|
| hu_fireplace | f w s | 300/300/300 | 5 | |
| hu_lumberjack_cottage | f w | 300/300/– | | |
| hu_stone_quarry | s | –/–/300 | | |
| hu_warehouse | f w s | 1000 each | | hu_capacity_1..3: +500 each (100f/50w/25s, 40 s, age 3/4/5, chained). hu_marketplace: 200f/100w/50s, 20 s, age 3 |
| hu_stone_cottage | – | – | 8 | |
| aje_resource_collector | f w s iron | 500 each | 6 | at aje_bazaar: aje_capacity_1..3 add +500 each **to every collector** (same costs as Hu) |
| aje_bazaar | f w s | 0 | | |
| aje_tent | – | – | 5 (10 after aje_big_tent: 30w/20s, 8 s, age 2) | |
| ninigi_fireplace | f w s | 300 each | 15 (+5 ninigi_hammock_1: 200 w, 30 s, age 2) | |
| ninigi_lumbermill / hunting_lodge / stone_quarry | w / f / s | 500 of its resource | | |
| ninigi_warehouse | f w s | 1000 each | | ninigi_capacity_1..3 +500 each (level 1 has no age requirement) |
| seas_headquarters | f w s | 1000 each | 30 | |
| seas_steelwork | f w s | 2000 each | | |
| seas_barracks / seas_garage | – | – | 25 / 25 | |

- **Aje resource collector** (`aje_resource_collector`, class CIguanodon, `Animal.usl:2037-2190`):
  - A mobile depot and "HQ" that counts as a limit building (storage 500 and 6 units).
  - Its delivery flags are moved onto the linked wagon `aje_resource_collector_a` (workers drop at the wagon object).
  - It **cannot fight** (`IsAbleToFight=false`). It is registered as a building in CBLDGMgr.
  - Its gfx changes with the epoch (`_a.._e`).
  - Built at aje_small_farm for 150 wood, 15 s. It also hosts the epoch upgrades and the tool upgrades.
  - If it dies while the killer has `BLDG_res_back`, the killer gets the collector's build cost (`FightingObj.usl:4494-4500`).
- Loot and refunds (`FightingObj.usl:4151-4187`): `GrantResources` adds the object's build-action `rescosts` (capped at max) to a player. It fires when a building/ship is destroyed by a player with the invention `BLDG_res_back`/`SHIP_res_back`, and on voluntary demolition (`task/BuildDownBuilding.usl:132`, a full refund to the owner).

---

## 6. Trade

### 6.1 Buying with skulls (`Building.usl:1958-2008, 2032-2044`)
- Command `Action` with `buy_food|buy_wood|buy_stone` on a CWarehouse → `Buy(res, 100)`:
```
if skulls <= 0: fail "_NT_BldgFailNotEnoughSkulls"
amount = min(100, skulls)
if cur[res] >= max[res]: fail "_NT_BldgFailRscCap"
amount = min(amount, max[res] - cur[res])             // capped in *skull* units (quirk)
player[res] += round(amount / rate[res]); skulls -= amount
rate = NewPointBuyCosts Resources/<Tribe>: food 1.0, wood 1.5, stone 2.0   // loaded from Base path at OnInit
```
- 100 skulls → **100 food / 67 wood / 50 stone**. The rates are **fixed**: there is no price drift. `CTradingOrder` (`Building.usl:1855-1860`) is dead code.
- Availability (tech tree `Moves/BLDG/buy_*`): Hu at hu_warehouse after `hu_marketplace` + age 3. Aje at aje_bazaar, Ninigi at ninigi_warehouse, both with no requirement. SEAS has none.

### 6.2 Trade carts (`task/Trade.usl`, `TransportObj.usl:1552-1689`)
- Units (all cost 500 food, 150 wood, 100 stone, 25 s, 150 HP, speed 2, can't fight):
  - `hu_cart` (CTradeCart, at hu_warehouse, needs hu_marketplace).
  - `aje_trade_dino` (CTradeDino, at aje_bazaar).
  - `ninigi_cart` (CTradeDino, at ninigi_warehouse).
- Home = the nearest own `TradeBuilding` (any finished CWarehouse). The target must be a friendly TradeBuilding different from home.
- Each leg: walk to the target's link `Ex_1` (fallback: 20 m in front). Arrival = XY distance² < 64 (8 m).
```
D   = XY distance between home.Ex_1 and target.Ex_1        // Vec.Abs2() — treated as 2D length [?]
win = max(1, 5 * 2.5 ^ (log2(D / 50)))  ==  max(1, 5 * (D/50)^1.3219)
for r in Resources/<targetOwnerTribe>: targetOwner.AddResource(r, win / price[r])
price: food 1.0, wood 1.5, stone 2.0, iron 4.0 (iron is never credited: AddResource only books food/wood/stone)
then home := target, target := old home; loop forever
```
- Examples: D = 50 m → 5 food, 3.3 wood, 2.5 stone. 100 m → 12.5 / 8.3 / 6.25. 200 m → 31 / 21 / 16. 400 m → 78 / 52 / 39.
- Credited to the **owner of the building arrived at**. The AI multiplier applies. Storage caps apply.
- [?] `Abs2` is read as the XY length: `Abs2S` is the squared one (`misc/ScareMap.usl:29`). This matches the designer comment "at B=50 m A=5, doubling → ×C=2.5". If it were the squared distance, the gains would be absurdly large.
- **Flying trader** (`CFlyingTrader`, `task/FlyingTrade.usl`, `misc/MiscObj.usl:958-1360`): warehouse registration is commented out (`Building.usl:1877-1880, 1951-1954`), and `SetResourcePrice` is never called. It is effectively **dead**, so prices stay at their base values. The 60 s deflation timer (±0.01 per tick) has no effect.
- `MiscValues/<Tribe>/Trader_Bonus = 1.0` is not referenced by any script.

---

## 7. Open questions and remake notes
1. Anim loop lengths (`hacking_dirt`, `hacking_stone`, `harvesting_bush`, `potter_ground`, `sowing`, `scything`, `chop_tree`, pick-up and put-down) must be read from the GSF anims. They drive all gather rates.
2. `NODE_TF` for stone and food: literal 2.0 vs tribe-table 1.0 (3.2).
3. Level-bonus stacking for worker capacity (3.1).
4. The Math.F2I rounding mode, and the behaviour of 0-loop anims.
5. Greenhouse slots: the script hardcodes 2, while the tech tree says 4. The current remake reads `maxworkers` from data (4). For 1:1, use 2.
6. The existing remake (`src/game/world.js:277-284`) uses `floor(K × workerTF)` with K = wood 5, stone 10, farms/food 6. That matches the script for wood, stone (with NODE_TF 2) and bushes/corpses (3 × 2). **Farms differ.** The script uses `5 × SelfTF(bldg) = 10` per worker TF, which gives **20 loops** for seas_worker at seas_greenhouse (the remake gives 12). For aje_worker at aje_slaughterhouse the script gives **10 × 0.75ⁿ** (the remake gives 6 × 0.75ⁿ). The slaughterhouse also credits the load *before* its animation.
