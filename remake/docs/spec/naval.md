# ParaWorld rules spec: water and naval gameplay

Source: original server scripts (UrsRel Script). Abbreviations used in references:
- `S:` = `Data/Base/Scripts/Server/classes/FightingObj/TransportObj/Ship.usl`
- `B:` = `classes/buildings/Building.usl`, `FO:` = `classes/FightingObj/FightingObj.usl`, `CH:` = `classes/character/character.usl`
- `TO:` = `classes/FightingObj/TransportObj/TransportObj.usl`, `V:` = `.../TransportObj/Vehicle.usl`, `AN:` = `classes/animals/Animal.usl`
- `T/<file>` = `classes/task/<file>`, `SA:` = `Server/ServerApp.usl`, `P:` = `classes/misc/Product.usl`, `R:` = `classes/misc/Resource.usl`
- `GIC:` = `Data/Base/Scripts/Game/controller/GameInputController.usl` (client)
- `TT` = `/home/claude/pwr/techtree.json` (`StartTT.Actions`, `StartTT.Objects`, `Filters`)

Units: metres, game seconds, costs food/wood/stone(/iron). `L1..L5` = unit level (internal index 0..4).
`[?engine]` = C++ behaviour the scripts only call. The scripts know only **one water height**: `ScapeMgr.GetSeaLevel()`.
Water/land is decided by comparing the terrain height with it. There is no depth table, no river level and no current.
This spec complements `units.md` §4 (transports), `buildings.md` (CHarbour heal), `economy.md` §4.6 and `combat.md`.
BoosterPack1 overrides no naval `.usl`.

---
## 0. Object → script class map

| Tribe | Object | Script class (file:line) | Notes |
|---|---|---|---|
| Hu | hu_harbour | CHarbour (`hu_buildings.txt:83`) | coastal; producer |
| Hu | hu_fishing_boat | CFishingBoat (`hu_products.txt:398`) | |
| Hu | hu_transport_ship | CTransportShip (`:434`) | |
| Hu | hu_dragon_boat / hu_ram_ship | CBigSizeShip (`:371`, `:416`) | plain ships, behaviour = TT weapon only |
| Hu | hu_steam_boat | CSteamShip (`:452`) + turret `hu_steam_boat_cannon` (CTaskBuildUp) | |
| Aje | aje_floating_harbour | CSwimmingHarbour (`aje_buildings.txt:38`) | coastal; moves; fishes |
| Aje | aje_transport_turtle | CTransportTurtle (`aje_products.txt:380`) | amphibious |
| Aje | aje_torpedo_turtle | CTorpedoTurtle (`:407`) | kamikaze |
| Aje | aje_cronosaurus | CAjeCronosaurus (`:425`) | water melee |
| Aje | aje_catamaran | CCatamaran (`:434`) | artillery |
| Ninigi | ninigi_harbour | CHarbour (`ninigi_buildings.txt:236`) | coastal; producer |
| Ninigi | ninigi_fishing_boat | CFishingBoat (`ninigi_products.txt:974`) | |
| Ninigi | ninigi_transport_boat | CTransportShip (`:992`) | |
| Ninigi | ninigi_fire_boat | CBigSizeShip (`:1010`) | plain |
| Ninigi | ninigi_muraeno_submarine | CMuraenoSubmarine (`:1037`), projectile CTorpedo | stealth |
| Ninigi | ninigi_corsair | CCorsair (`:1055`) | builds water turrets |
| Ninigi | ninigi_water_turret | CWaterTurret (`:1073`) + turret `ninigi_water_turret_cannon` | static |
| Ninigi | ninigi_minelayer | CMineLayer (`:1100`) | builds mines |
| Ninigi | ninigi_mineship_mine | CWaterMine (`:1118`) | (`ninigi_minelayer_mine` `:1127` is also CWaterMine, unused) |
| Ninigi | ninigi_rocket_boat | CRocketBoat (`:1145`) | artillery |
| SEAS | seas_carrier | CSeasCarrier (`seas_buildings.txt:38`) | coastal; moves; turret |
| SEAS | seas_submarine | CMediumSizeShip (`seas_products.txt:209`), projectile `seas_torpedo` CTorpedo | |
| SEAS | seas_hovercraft | CHoverCraft (`seas_products.txt:146`) | **VHCL**, amphibious |
| World | FishShoal_Tristychius | CFishShoal (`all_animals.txt:153`) | resource FRUI |
| World | Kronosaurus, Muraenosaurus, Placohelys, Dunkleosteus (icewaste) | CSwimmingAnimal | water-only |
| World | Macrolemys / Baryonyx | CMacrolemys / CBaryonyx | amphibious animals |
| World | Nest_Swimmer | CSwimmingNest (`all_animals.txt:138`) | spawns Muraenosaurus |
| Campaign | pirate_boss (+tail/sail/row/cannons), ninigi_small_pirate_ship (CCorsair) | `S:488-826` | not needed for skirmish |

Class tree: `CTransportObj → CShip → {CFishingBoat, CBigSizeShip(spray 3) → {CTransportShip, CSteamShip, CCatamaran, CRocketBoat, CMineLayer, CCorsair, CPirateBoss}, CMediumSizeShip(spray 2), CAmphibian → CTransportTurtle, CMuraenoSubmarine, CAjeCronosaurus, CWaterTurret, CTorpedoTurtle, CWaterMine}`. Harbours: `CBuilding → CHarbour → CSwimmingHarbour → CSeasCarrier`.

---
## 1. Harbours

### 1.1 Data (TT `Objects/<T>/BLDG/<cls>`, `Actions/<T>/Build/BLDG/<cls>`)

| Building | coastal | HP | FOW | speed | Build | Built by | Special |
|---|---|---|---|---|---|---|---|
| hu_harbour | 1 | 2500 | 45 | – | 0/75/0, 40 s | hu_worker | heal r40 |
| ninigi_harbour | 1 | 2500 | 40 | – | 0/75/0, 35 s | ninigi_worker | heal r40; upgrade `ship_regeneration` |
| aje_floating_harbour | 1 | 1500 (+0/100/300/600/1100 by level, `B:5885-5898`) | 40 | 1/1 | 0/75/0, 20 s | any Aje CHTR | heal r40; moves; fishes |
| seas_carrier | 1 | 3000 | 70 | 2/2 | 0/75/0, 40 s | seas_worker | moves; auto turret; **no heal** (no `heal` ability → radius −1) |

The rally-point helpers `<tribe>_rally_point_harbour` are also `coastal=1` (CRallyPoint, cosmetic).
No age requirement for any harbour. `ninigi_harbour` upgrade `ship_regeneration`: 0/300/150, 30 s, requires invention `schliemann_s4`.
It gives all Ninigi ships except the turret/mine the ability `self_heal amount 2` = **+2 HP every 1 s** (`FO:8207-8213`, `FO:2557`).

### 1.2 Coastal placement (`SA:1143-1166`)
1. `bCoastal = TT Objects/<T>/BLDG/<cls>/coastal != 0`.
2. If coastal: `ObjPlaceChecker.CheckGetCoastal(cls, clickPos) → (newPos, newRot)` [?engine]. On failure the placement is rejected (nothing paid).
3. On success the position **and rotation** are replaced by the snapped ones. `pos.z = seaLevel + 1.5` ("land part of harbour at this height").
4. The normal place check (`Check(...)`) is **skipped** for coastal objects. Payment and construction then follow `buildings.md` §1.2.
   Remake suggestion for `CheckGetCoastal`: search near the click for a footprint whose landward half is ground ≥ sea level and whose seaward half (with the `Do_*` dock links) is water, with rotation facing the water.
5. The floating harbour and carrier use the same snap (both are `coastal=1`). After that they are free swimmers.

### 1.3 CHarbour behaviour (`B:5115-5404`)
- `OnInit`: `m_bHealthBuilding=true`, `SetRallySite(true)`. The heal query type is replaced by **SHIP only** (`B:5145`). Attribute `fishDelivery=true` (`B:5149`). Ranged buff `owner_healing_harbour`.
- **Docks:** count the links `Do_1..Do_5` on the model, minimum 2 (`B:5152-5173`).
  `AddDockedShip`/`RemDockedShip` are **never called** anywhere, so every dock is always free.
  So "Harbour is full!" (`B:5260-5269`) never fires, `GetDockPos` always returns `Do_1`, and there is **no ship cap per harbour**.
- **Heal** (`B:779-805`, timer 2 s `B:453`): own + allied **SHIP** within `radius 40` get `dt·(5·M(Healing).rel + M(Healing).abs + 0.25 %·maxHP)` HP. This applies to hu/ninigi harbours and aje_floating_harbour. There is no ship repair task (`units.md` §1.8).
- **Hu crane:** a `hu_harbour_crane` is linked to `Cr_3` on ready and animates while producing. Cosmetic.
- `SetRallyPoint` (`B:5335-5350`): rejected with "Set RallyPoint on water!" if `pos.z > seaLevel`. Client (`GIC:273-293`): a `fishDelivery` building only accepts a rally click where `terrainHeight < seaLevel`, and non-harbours only accept land.
  Stored rally z = `max(terrain, sea)` (`FO:8942-8947`).
- **Ninigi harbour** can take the tribe-wide `Explode` invention (death explosion, `buildings.md`).

### 1.4 Ship production and spawn
1. The harbour runs the normal production queue (`Action`). CSwimmingHarbour/CSeasCarrier route `/Build/SHIP/aje*`, `/Build/SHIP/seas*`, `/Build/VHCL/seas*` to an invisible `CVirtualProduceUnit` (`B:5954-5964`). Costs are paid by `CheckConditionsAndPay` at queue time (`B:5451`).
2. At completion (`T/Action.usl:786-803`), the spawn pos is the actor's `Spwn` link. If the **actor is a SHIP** (minelayer, corsair), the `Proj` link is used instead. If the produced object type is `SHIP`, `pos.z = seaLevel`.
3. Start level = `results/0/flags/level − 1` (`T/Action.usl:813-822`). HP = TT hitpoints + current `LvlN_Bonus` (§2.1).
4. The new object gets event `CTheLite(actor)` (`T/Action.usl:945`). For a ship (`S:106-136`), if the actor is a CHarbour:
   1. Teleport to the first free dock (`Do_1`, see 1.3) with its rotation. If there is no link, use the harbour pos and rotation.
   2. If the harbour has a rally **target** and `NextJob(target)` accepts it (only fishing boats accept a FRUI target, `S:428-441`), start fishing.
   3. Otherwise `GoTo(rallyPos)` at default speed, or `GoTo(harbourPos)` if no rally point is set.
   The seas_hovercraft (VHCL) uses the generic rally behaviour. The torpedo turtle and mines/turrets ignore the rally (§2).

### 1.5 Moving harbours (CSwimmingHarbour `B:5773-5999`, CSeasCarrier `B:5663-5771`)
- `CanWalk=false`, `CanSwim=true`, attribute `MovingBuilding=true`. A right-click without Shift moves it, and Shift+click sets the rally point (`GIC:273`). It can only act once built (`m_bBuildingReady`).
- `DoesCountInUnitLimit()=true` (`B:5916`). On `Die()` it is deleted immediately (no rubble, `B:5921-5924`).
- **aje_floating_harbour:** `CanFight=false`. Four cosmetic `aje_floating_harbour_macrolemys` swim on `Cr_1..Cr_4`. It accepts `Fishing` (§4). No BuildDown.
- **seas_carrier:** `CanFight=true`, attribute `AttackBuilding`. On ready it builds a rotating auto-attack turret `seas_carrier_turret` (weapon `seas_carrier_weapon_a..e`: dmg 30/35/45/65/105, range 40, freq 30, projectile `seas_carrier_arrow`).
  When attacked it answers with `/AttackSrv` (`B:5719-5723`). Allied help shouts also wake carriers (`FO:6682-6690`).
  Produces seas_submarine, seas_hovercraft (0/80/0, 30 s) and seas_helicopter.

---
## 2. Ships

### 2.1 Production table (TT `Actions/<T>/Build/SHIP`; HP = `Objects/<T>/SHIP/<cls>/hitpoints` + `Filters/<T>/Upgrades/<cls>/LvlN_Bonus`, exclusive per level)

| Ship | Where | Cost f/w/s | Time | Req | Start L | HP L1/L2/L3/L4/L5 | spd def/max | FOW | Pass. | Skulls (start L) |
|---|---|---|---|---|---|---|---|---|---|---|
| hu_fishing_boat | hu_harbour | 0/50/0 | 10 | – | 1 | 250/350/550/850/1350 | 2/2 | 60 | – | 3 |
| hu_transport_ship | hu_harbour | 0/80/0 | 30 | age_2 | 1 | 500/600/800/1100/1600 | 3/3 | 50 | 10 | 10 |
| hu_dragon_boat | hu_harbour | 30/100/0 | 20 | age_2 | 2 | –/500/700/1000/1500 | 3/3 | 70 | – | 16 |
| hu_ram_ship | hu_harbour | 80/180/0 | 30 | age_3 | 2 | –/800/1000/1300/1800 | 3/3 | 70 | – | 22 |
| hu_steam_boat | hu_harbour | 70/200/100 | 50 | age_4 | 3 | –/–/1000/1300/1800 | 3/3 | 80 | – | 35 |
| aje_transport_turtle | floating harbour | 0/120/0 | 40 | age_2 | 1 | 500/600/800/1100/1600 | 2/2 | 50 | 10 | 15 |
| aje_torpedo_turtle | floating harbour | 25/25/0 | 20 | age_3 | – | 50 | 3/3 | 50 | – | 15 |
| aje_cronosaurus | floating harbour | 50/150/0 | 30 | age_2 | 2 | –/700/900/1200/1700 | 3/3 | 60 | – | 22 |
| aje_catamaran | floating harbour | 70/200/100 | 50 | age_4 | 3 | –/–/1000/1300/1800 | 3/3 | 80 | – | 35 |
| ninigi_fishing_boat | ninigi_harbour | 0/50/0 | 10 | – | 1 | 200/300/500/800/1300 | 2/2 | 60 | – | 3 |
| ninigi_transport_boat | ninigi_harbour | 0/80/0 | 30 | age_2 | 1 | 500/600/800/1100/1600 | 3/3 | 50 | 10 | 10 |
| ninigi_minelayer | ninigi_harbour | 60/80/0 | 30 | age_2 | 2 | –/400/600/900/1400 | 3/3 | 65 | – | 15 |
| ninigi_fire_boat | ninigi_harbour | 40/120/0 | 30 | age_2 | 2 | –/600/800/1100/1600 | 3/3 | 65 | – | 25 |
| ninigi_muraeno_submarine | ninigi_harbour | 120/140/0 | 40 | age_3 | 2 | –/500/700/1000/1500 | 3/3 | 50 | – | 25 |
| ninigi_rocket_boat | ninigi_harbour | 70/200/100 | 50 | age_4 | 3 | –/–/1100/1400/1900 | 3/3 | 80 | – | 35 |
| ninigi_corsair | ninigi_harbour | 70/200/100 | 35 | babbage_s4 | 3 | –/–/1500/1800/2300 | **4/4** | 60 | – | 30 |
| ninigi_mineship_mine | minelayer (target VEC3) | 0/50/50 | 5 | – | – | 500 | 0 | 25 | – | 20 |
| ninigi_water_turret | corsair (target VEC3) | 0/250/0 | 10 | – | – | 500 | 0 | 50 | – | 25 |
| seas_submarine | seas_carrier | 100/100/100 | 20 | age_2 | 2 | –/500/700/1000/1500 | 3/3 | 80 | – | 40 |
| seas_hovercraft (VHCL) | seas_carrier | 0/80/0 | 30 | – | 1 | 500/600/800/1100/1600 | 3/3 | 50 | 10 | 15 |

Speeds are gait indices; real m/s come from animations (`init/walkanimconfig.txt` sets `Ships2..4`) [?engine].
Hero bonus: lovelace_s0 `Chief_Bonus` halves `Build/SHIP` duration for Hu/Aje/Ninigi.
Ship items: `item_shipweapons` (+15 % ship dmg), `item_admirals_hat` (+15 % HP), `item_sextant`/`item_telescope` (+50 FOW).
Every CShip has a 1-slot item inventory (`S:206-209`). The `handicap_*` filters scale ship HP.

### 2.2 Weapons (TT `Objects/<T>/Weapons`; reload = 60/frequency s; `AB` = AttackBonus %)

| Ship | dmg by level (L1..L5) | range | min | freq | hitrange/end | Proj. | def / rdef | AB / notes |
|---|---|---|---|---|---|---|---|---|
| hu_dragon_boat | –/20/30/50/90 | 30 | 0 | 40 | – | CArrow | 10/20 | BLDG −50 |
| hu_ram_ship | –/60/70/90/130 | 0 (melee) | 0 | 20 | – | – | 15/50 | water melee (§6.3) |
| hu_steam_boat | –/–/150/170/210 | 60 | 20 | 20 | 5 / 150,225,338 | CArrow cannonball | 15/30 | CHTR/ANML/VHCL/SHIP −75; ap 99; siege priority |
| aje_transport_turtle | 10/15/25/45/85 | 0 | 0 | 20 | – | – | 30/50 | can bite (not water-melee: it can walk) |
| aje_cronosaurus | –/50/60/80/120 | 0 | 0 | 20 | – | – | 15/50 | water melee |
| aje_catamaran | –/–/140/160/200 | 65 | 20 | 20 | 6 / 140,210,315 | CLongRangeProjectile stone | 15/25 | −75 vs units/ships; ap 99; siege priority |
| aje_torpedo_turtle | 250 | – | – | – | 15 / 250 | – | 0/0 | explosion only (§2.6) |
| ninigi_fire_boat | –/25/35/55/95 | 15 | 0 | 30 | – | none (direct) | 10/20 | VHCL/BLDG −50 |
| ninigi_muraeno_submarine | –/70/80/100/140 | 30 | 0 | 15 | – | CTorpedo (invisible) | 0/50 | ap 99; torpedo targeting (§6.3) |
| ninigi_rocket_boat | –/–/50/60/70 ×3 | 65 | 20 | 20 | 7 / 50,75,113 | CArrow ×3 | 15/20 | −75 vs units/ships; siege priority |
| ninigi_water_turret | 50 | 30 | 0 | 30 | – | ninigi_arrow | 0/0 | turret rotates |
| ninigi_mineship_mine | 1000 | 10 | – | 60 | 15 / 1000 | – | 0/0 | explosion (§2.7) |
| seas_submarine | –/100/110/130/170 | 40 | 0 | 10 | – | CTorpedo `seas_torpedo` | 0/50 | ap 99; torpedo targeting |
| armour only | hu/ninigi transport: rdef 35; ninigi_minelayer: def 30; seas_hovercraft: rdef 25 | | | | | | | |

Fishing boats, transports, minelayer and corsair have `IsAbleToFight()=false` (`S:331`, `S:830`, `S:1245`, `S:1298`). The hovercraft has the same (`V:262`).

### 2.3 Common CShip rules (`S:1-323`)
- `OnInit` (`S:186-228`): `SetSwimming(true)`, `CanWalk=false`, `CanSwim=true`, type `SHIP`, size class 3, `AddUnit()`.
  Ships count toward the unit limit and pyramid, **except** water turret, torpedo turtle and water mine (`DoesCountInUnitLimit=false`).
  Ships are aggressive (stance 2) by default and use their TT weapon via the generic fight code (`S:144-184`, the special code is commented out).
- **Cannot board** anything: `BoardTransport` just walks to the position (`S:316-321`).
- **Death** (`S:248-271`):
  1. `DismountAll()` (to shore, `units.md` §4.3).
  2. Every passenger still aboard: `TerminateAction`, hide, `DieFastAndSilent` (no corpse, no skulls), with feedback `_NT_TransportUnitsDiedInShip`.
  3. Spawn `ShipCorpse` (CShipCorpse) with gfx `<gfx>_dest`, anim `destroy` (turtles/subs: `dying`), for **10 s**.
- **Damage immunities:** ships cannot be poisoned (`FO:4113`), have no blood/hit-reaction and update destruction flags by HP (`FO:5484`).
- **Kill reward:** if the killer's owner has invention `SHIP_res_back`, the build cost is granted to the killer (`FO:4494`, `combat.md` §1). Only `schliemann_s0/Chief_old_Bonus` grants it [?likely unused].
- **Help shouts:** own SHIPs respond to a help shout only when the enemy is itself a SHIP (`FO:6682-6684`).
- **Passengers never fight:** CHTR on a SHIP never attacks (`CH:2390`).

### 2.4 Fishing boats (CFishingBoat `S:326-443`)
- Attribute `fishingBoat=1`, `can_harvest=1`, inventory `ResInvCaps/food = 50` (food only, `S:24-93`). Cannot fight. Owns a hidden `Hu_Fishnet` object.
- Ordered by right-click on a fish shoal (client sends `Fishing` only for SHIPs with `fishingBoat` or the floating harbour, `GIC:670-679`). The algorithm is in §4.2.
- `GoTo` always hides the net (`S:423-426`).

### 2.5 Transports (CTransportShip `S:828-843`, CTransportTurtle `S:938-1043`)
- `transportclass=2`, closed build-up, 10 seats. Accepts CHTR, ANML and VHCL, but not other class-2 transports (`units.md` §4.1).
- **Boarding** (`misc/BoardingMgr.usl:77-90, 383-405`): the meeting point is `Pathfinder.GetShipBoardingPos(owner, firstPassengerPos, shipPos)` [?engine]. Amphibians use `GetAmphibianBoardingPos` instead.
  The ship sails there and has "arrived" within `collisionRadius+5`. Passengers have arrived within `2·(rP+rT)` (`BoardingMgr.usl:284-296`).
- **Unloading** (`T/UnboardShip.usl:59-128`, `TO:33-34, 913-972, 1473-1493`):
  1. Ship (non-amphibian): `GetShipBoardingPos(owner, clickPos, shipPos)` gives the shore meeting point. If none is found, abort.
  2. Sail there. When idle and the meeting point is ≤ **30 m** away (`m_fMaxPassengerDropRadius`), `DismountAll(clickPos)`. Otherwise walk again, up to 5 retries.
  3. Drop test while the transporter is in water: the virtual meeting point must be ≤ 30 m away. Otherwise the feedback is `_NT_TransportUnboardAtShore` / `_NT_TransportTooFarFromShore`.
  4. Each unit is placed at `GetFreePos` near the drop point. If the click is ≤ 10 m away it spreads to a random land point ±7 m with terrain z > sea+1 (50 tries).
  5. Amphibians and land transports skip step 1 and drive to the click directly.
- **Transport turtle** (amphibious, §3): it can also bite (weapon above). Death on land uses anim `dying_land`. The shell build-up shows destruction stages at ≤ 50 % and ≤ 25 % HP (`S:997-1030`).

### 2.6 Torpedo turtle (CTorpedoTurtle `S:1357-1550`) – autonomous kamikaze
Constants: lifetime **45 s**, scan every **2 s**, scan radius **100 m**, wander step 25 m.
1. On spawn it ignores rally and all commands except `/Kill` (`S:1530-1534`). It does not count toward the unit limit.
2. `CheckForNearbyEnemies` (`S:1430-1511`): take enemy-owned objects of type **SHIP** or **BLDG** within 100 m, nearest first.
   - A BLDG only qualifies if its class name contains `harbour` (hu/ninigi harbour, aje_floating_harbour; **not** seas_carrier), or it is a pirate-boss part or `PT_Citywall_Gate`.
   - The first match is the target. Mines and water turrets are SHIPs, so they qualify too.
3. If `dist2D(target) < rTarget + rSelf`, run `Explode(targetPos)` (step 5). Otherwise, if the target is new, `GoTo(targetPos)` at default speed and remember it.
4. On every walk end (not broken) without a target: pick a point 25 m ahead with a random yaw offset (`ChooseRandomDestination(25, 2)`: `(rand%4 − 2)·0.3` rad) and walk there.
   The 2 s timer re-checks only while a target is remembered.
5. **Explode:** anim `boom` + `CAreaDamage(self, "aje_torpedo_turtle_ammo", pos)`.
   That means hitrange 15, dmg 250, end 250, so **flat 250** (via `TakeDmg`, armour applies) to every enemy and neutral CHTR/SHIP/ANML/VHCL/BLDG/FGHT/NEST with `dist − collRadius < 15`. Transported units are excluded (`FO:9431-9492`). After the anim the turtle is deleted (no corpse, no skulls).
6. At 45 s the turtle dies normally (`Die()`, corpse, **no** explosion).

### 2.7 Minelayer and water mines (CMineLayer `S:1222-1275`, `T/PlaceWaterMine.usl:1-163`, CWaterMine `S:1552-1627`)
- The minelayer cannot fight and has a personal CVirtualProduceUnit. Its UI action `Build/SHIP/ninigi_mineship_mine` takes a ground target (VEC3).
- **Place task `WateMine`** (queued):
  1. Abort if the target is (0,0,0) or `terrainHeight(target) > seaLevel`.
  2. If any `ninigi_mineship_mine` or `ninigi_water_turret` is within **8 m** of the target, finish without placing.
  3. Walk to `target + dir·shipRadius` at max speed, then rotate to face **away** from the target (stern over the spot).
  4. Re-check step 2. Then the virtual unit runs the build action (pays 0/50/50, 5 s).
  5. When the action ends, `UpdateAggressionPos(here)` and finish.
- The mine spawns at the minelayer's `Proj` link with z = sea level. It cannot move (walk/swim/fly all false) and ignores attacks (`OnDefend` no-op).
- **Trigger:** a personal region of radius **10 m** around the mine. When an object enters and it is a **SHIP** of an enemy owner (`GetIsEnemy`), start a 0.5 s timer. Hovercraft (VHCL) and swimming animals do not trigger it.
- After 0.5 s the mine is deleted. **`Delete()` always runs `CAreaDamage(mine, pos)`** using the mine's weapon: hitrange **15**, dmg **1000**, end **1000**.
  That is a flat 1000 (armour applies) to all enemy and neutral CHTR/SHIP/ANML/VHCL/BLDG/FGHT/NEST within 15 m (minus collision radius), including land units on the shore. Transported units are excluded.
- **Destroyed mine:** `Die()` also starts the 0.5 s timer, so killing a mine (500 HP, 20 skulls) detonates it.
- [?] The mine also has an attack weapon (range 10, freq 60) and stance 2, so the generic scan might make it "attack". Remake: mines never attack, they only explode.

### 2.8 Corsair and water turret (CCorsair `S:1277-1330`, CWaterTurret `S:1332-1354`)
- **Corsair:** speed 4, cannot fight. Its build action `Build/SHIP/ninigi_water_turret` (0/250/0, 10 s, VEC3 target) runs task `WateTurr`. That task is identical to the mine task: same 8 m spacing check against mines and turrets, and the turret spawns at the corsair's `Proj` link.
  The corsair is built at ninigi_harbour with invention `babbage_s4`. Babbage L4/L5 filters make the action visible.
- **Water turret:** stationary (`IsAbleToWalk=false`, speed 0), HP 500, does not count toward the unit limit, rotating turret `ninigi_water_turret_cannon` (50 dmg, range 30).

### 2.9 Combat ships
- **hu_dragon_boat, ninigi_fire_boat:** plain CBigSizeShip ranged units. The fire boat has no projectile, so the hit is direct.
- **hu_ram_ship, aje_cronosaurus:** melee (range 0) and swim-only, so they are **water-melee** (§6.3). The cronosaurus rider sits on link `Ride`.
- **hu_steam_boat** (CSteamShip): weapon build-up `hu_steam_boat_cannon` (`TYPE_WEAPON`, rotates). `attackType=1` (siege target priority: towers > buildings > walls > units, `combat.md`).
- **aje_catamaran** (CCatamaran): `attackType=1`.
- **ninigi_rocket_boat** (CRocketBoat `S:1145-1200`):
  1. If the target (or ground point) is more than 45° (π/4) off the bow, rotate first; no shot.
  2. Otherwise fire **3 projectiles** from links `psh1..psh3`, with extra delays 1.0/1.1/1.2 s. Each one deals full weapon damage.
  3. `attackType=1`. It can attack ground.
- **ninigi_muraeno_submarine** (CMuraenoSubmarine `S:1045-1098`, `FO:4515-4530, 5938-5944`):
  1. Spawns with camouflage layer `disg` (invisible to enemies) and stance **1 (defensive)**.
  2. `AttackEnemy` removes `disg`. Its torpedoes are invisible.
  3. On `EndFight` it re-requests `disg`, which is applied when the 10 s `CAMO_TIMER` expires. Every hit taken restarts the 10 s timer (`FO:4507`).
  4. The reveal move only searches CHTR/BLDG (`CH:1011-1014`), so subs **cannot be revealed**.
- **seas_submarine:** plain CMediumSizeShip. Its camouflage is commented out (`FO:4525`). It shares the torpedo targeting rule.
- **CTorpedo projectile** (`P:980-1117`):
  - Moves at sea level at speed 8, re-aiming every 0.2 s with a max turn of 0.07 rad per tick.
  - Hits when within the target's collision radius (`OnImpact` = damage).
  - If it runs over terrain above sea level it sinks harmlessly (3 s). Lifetime 15 s, then it sinks.

---
## 3. Amphibious objects

| Object | Type | How | Water↔land effects |
|---|---|---|---|
| aje_transport_turtle | SHIP | CAmphibian: `CanWalk=true, CanSwim=true` (`S:880-936`) | gfx `Macrolemys_Water`/`_Land`, spray 2/0, death anim `dying`/`dying_land` |
| seas_hovercraft | VHCL | CVehicle + `SetCanSwim(true)` (`V:244-292`) | passengers die only if it dies **in water** (`V:267-290`) |
| seas_helicopter | VHCL | walk+swim (`V:702-706`) | ground-pathed, not flying |
| ninigi_baryonyx / Baryonyx | ANML | CBaryonyx `SetCanSwim(true)` (`AN:3494-3548`) | walk set `swim`, anim `swim_attack_front`, no threat anim in water, corpse plays `drown` |
| Macrolemys (wild) | ANML | CMacrolemys (`AN:3550-3612`) | gfx swap; dies in water → ShipCorpse `dying`, **no `_food` corpse** |

Decision logic:
1. `IsInWater()` [?engine] is re-evaluated on spawn, load, `SetPos` and at every action end (`S:892-912`). Transitions inside a walk call `OnAmphibianWaterLandTransition` [?engine].
   Remake: `inWater = terrainHeight(pos) < seaLevel`.
2. `IsAmphibian()` [?engine] ≈ `CanWalk && CanSwim`. It selects `CBoardAmphibianCoordinator` and lets unloading drive straight to the click (`T/UnboardShip.usl:77`).
3. The pathfinder may use land and water cells for amphibians [?engine]. The AI-only command `WaterOnly`/`UnWaterOnly` toggles `CanWalk` on the turtle (`S:982-990`).
4. A transporter in water uses the shore drop test (`TO:913`). On land it uses `IsFreePoint(pos)`.

No CHTR can swim. Land units never enter water except via transports/amphibians [?engine pathfinder].

---
## 4. Fish shoals and fishing

### 4.1 CFishShoal (`R:547-580`, `settings/Resources.txt:316`)
- Type `FRUI`, attribute `fish=1`, **value 2500 food**. z is forced to sea level. Anim `shoal`.
- `Mine(x)`: `value -= x`, returns the amount actually removed. Deleted when `value ≤ 0.5` (`R:88-110`). **No regeneration.**
- Workers' GetFood excludes `fish=1` (`economy.md` §4.3). Only fishing boats and the aje_floating_harbour can fish. The SEAS carrier is a CSwimmingHarbour, but the client never sends it `Fishing`.

### 4.2 Fishing task (`T/Fishing.usl`) – boat
1. `goto_fish`: walk to the shoal at default speed. Arrival is `dist2D ≤ 6`. If arrival fails, retry.
2. `rotate_to_target`: face the shoal.
3. `mine_fish`: `want = capacity − carried` (50 when empty). If 0, go to step 5. Otherwise throw the net and set `lastTick = now`.
4. `add_fish_to_inv`: `carried += shoal.Mine(want)`. The load is filled **instantly** (partly if the shoal has less).
5. `pickup_fish`: wait until `now − lastTick > 7 s`, then pick up the net. Effectively one 50-food load per 7 s fishing stop.
6. `goto_deliver`: the nearest own BLDG with `fishDelivery` that is not under construction (hu/ninigi harbour, floating harbour, carrier).
   For a CHarbour the target is its dock pos (`Do_1`). Sail to `(x, y, seaLevel)`. If there is no delivery building, end the task.
7. `drop_fishes`: when `dist2D ≤ 1.3·deliveryRadius`, `player.AddResource("food", carried)`. A remainder that does not fit (storage cap) stays aboard; retry every 2 s. Then go back to step 1.
8. If the shoal disappears: with cargo, deliver. Empty: search for the nearest `fish=1` FRUI within **400 m of the last delivery position**. If there is none, end the task.

### 4.3 Floating harbour fishing
- It moves to `shoalPos − dir·0.5·radius`. Each cycle it mines **10**, adds it straight to player food (rounded) and waits 5 s, so **2 food/s**.
- At the food cap it waits 5 s and retries.
- Bug: on overflow, `CheckInFood` adds the overflow part instead of the free room (`Fishing.usl:455-458`).
- When the shoal is empty it searches for the next one (400 m).

---
## 5. Swimming animals and nests

| Animal | Class | HP | aggressive | Weapon (dmg / range / freq) | speed | Skulls |
|---|---|---|---|---|---|---|
| Kronosaurus | CSwimmingAnimal | 2000 | 1 | 25 / 0.5 / 30 | 2/2 | 28 |
| Muraenosaurus | CSwimmingAnimal | 1000 | 1 | 15 / 0.5 / 40 | 2/2 | 16 |
| Dunkleosteus (icewaste) | CSwimmingAnimal | 2500 | 1 | 40 / 0.5 / 30 | 1/3 | 37 |
| Placohelys | CSwimmingAnimal | 100 | −1 (flees) | 20 / 0.5 / 50 | 2/2 | 11 |
| Macrolemys | CMacrolemys (amphibious) | 600 | 0 | 10 / 0.5 / 20 | 1/1 | 8 |

Rules:
1. CSwimmingAnimal: `CanWalk=false`, `CanSwim=true`. Its enemy search uses **only SHIP and BLDG** types of players (`AN:3485-3489`), so wild sea monsters hunt ships and attack harbours and shore buildings within reach. They ignore land units unless attacked.
2. Range 0.5 + swim-only = water melee. Targets are filtered by `terrainHeight(target) ≤ sea+1.7`, harbours always allowed (`FO:4792-4842`).
3. When attacked, a water-melee animal **flees** if `terrainHeight(attacker) > sea − 0.5` and the attacker is not a harbour (`AN:1257-1264`). So shore archers can shoot them without retaliation.
4. Otherwise the generic wild-animal logic applies: temperament, help, flee, growth, food corpse (`units.md` §7). Corpses `<cls>_food` exist (e.g. Kronosaurus_food), but they lie in water.
5. **Nest_Swimmer** (CSwimmingNest `Nest.usl:842-860`): z forced to sea level. spawn_type Muraenosaurus, spawn_amount 10, spawn_max 3, spawn_rate 0.5 (semantics in `units.md` §7.4). Spawned animals get z = `max(terrain, sea)` (`Nest.usl:255`).

---
## 6. Water rules and land–sea interaction

### 6.1 Height rules (all from `GetSeaLevel()`)
- Water point: `terrainHeight < seaLevel` (client rally, `GIC:276`). Mine/turret targets require `terrainHeight ≤ seaLevel` (`T/PlaceWaterMine.usl:44`).
- Ships, shoals, mines, swimming nests and harbour dock deliveries are placed at **z = seaLevel**. The harbour body is at sea+1.5.
- Unload spread: land = terrain z > sea+1 (`TO:1475-1493`). Items dropped where terrain < sea−0.5 vanish (`misc/Item.usl:296`).
- There is **no shallow-water rule** in the scripts. Which cells ships and land units may enter is pathfinder-side [?engine].
  Suggested remake rule: land units walk where `terrain ≥ sea − 0.5`, ships sail where `terrain ≤ sea − 1` (draught), amphibians use both.

### 6.2 Land units vs ships
1. No script rule stops any unit from **targeting** a ship. Ranged land units, towers and buildings with weapons shoot ships normally (types CHTR/ANML/VHCL/SHIP rank 0 in target priority).
2. Melee land units cannot reach a ship [?engine path fails]. The Fight task gives up after its follow counter (2 follows). The target goes onto a failed-enemy list (max 16) and the next enemy is picked (`T/Fight.usl:526-566`).
   Remake: melee units ignore targets in water.
3. Area damage (catapult splash, mines, torpedo turtle, Ninigi building explosion) hits ships like any unit. Units **inside** a transport are never hit (`FO:9460`).
4. Passengers on a ship cannot attack (`CH:2390`).

### 6.3 Sea units vs land (`FO:4792-4842`)
- **Water melee** = `!CanWalk && CanSwim && attackRange < 1` (ram ship, cronosaurus, sea monsters). A target is accepted only if `terrainHeight(target) ≤ sea + 1.7` or it is a CHarbour, unless the target attacked it first (it is in `m_xPotEnemies`).
- **Torpedo units** = `seas_submarine`, `ninigi_muraeno_submarine`. The same check uses the limit `sea − 0.5`, so they hit only water targets and harbours.
- All other ships (dragon boat 30 m, fire boat 15 m, artillery 60–65 m, carrier turret 40 m, water turret 30 m) attack land targets in range normally. Artillery has min range 20 and −75 % vs units, so it is meant for shore bombardment.

---
## 7. Implementation checklist (decision summary)
1. Harbour placement: coastal snap → z = sea+1.5 → no normal place check. Docks are unlimited in practice, and ships spawn at `Do_1` at sea level, then go to the water-only rally point.
2. Ships: swim-only, size 3, count toward pop (except turret/mine/torpedo turtle), heal +(5 + 0.25 %maxHP)/s within 40 m of own/allied hu/ninigi/aje harbours (2 s ticks). Ninigi ships get +2 HP/s after `ship_regeneration`.
3. On ship death: unload what can reach the shore, kill the rest silently, 10 s sinking corpse.
4. Fishing: 50-food loads, 7 s per stop, deliver to the nearest `fishDelivery` building. The floating harbour gives 2 food/s directly. Shoals: 2500 food, no regrowth.
5. Mines: 8 m spacing, 10 m trigger radius on enemy SHIP, 0.5 s fuse, 1000 flat to everything within 15 m. Killing a mine also detonates it.
6. Torpedo turtle: uncontrollable, 45 s life, hunts the nearest enemy ship or harbour within 100 m, 250 flat in 15 m.
7. Muraeno submarine: permanent stealth except while fighting (+10 s). It cannot be revealed.
8. Water-melee and torpedo units only target things at the waterline. Water-melee animals flee from land attackers.

## 8. Open questions [?engine]
- `CheckGetCoastal`, `GetShipBoardingPos`, `GetAmphibianBoardingPos`, `IsInWater`, `IsAmphibian`, and ship/land pathing cells (min depth).
- Actual sailing speeds per gait (`walkanimconfig.txt` `Ships2..4` plus animation lengths).
- Whether fog of war hides mines from enemies (no script code; the mine's FOW is 25).
- `spawn_rate` unit for Nest_Swimmer (see `units.md` §7.4).
