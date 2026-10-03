# The original computer player (script AI) and its port

Working spec of ParaWorld's AI as far as the remake's port (`remake/src/game/ai/`) needs it. Source: the game's
scripts `Data/Base/Scripts/Ai/**` and the Server scripts they call. Sections 3, 5.1-5.2, 6.5 and 10-13 are the
recovered text of the first study (lost in a machine reset, verified again where the port relies on it); the rest
was re-read for the port. `ai.json` (§12) carries the tables, so numbers quoted here are examples, not the source.

File abbreviations: CM `Modules/AiModuleControlDefault.usl`, EM `Modules/AiModuleEconomyDefault.usl`, FM
`Modules/AiModuleFightDefault.usl`, DM `Modules/AiModuleDefenseDefault.usl`, AM `Modules/AiModuleAreaDefault.usl`,
BV `goals/AiGoalBuildVillage.usl`, DA `goals/AiGoalDisturbAttack.usl`, GA `goals/AiGoalGeneralAttack.usl`,
MOD `goals/AiGoalMinistryOfDefense.usl`, GV `goals/AiGoalGuardVillage.usl`, DMo `goals/AiGoalDefendMode.usl`,
KG `goals/AiGoalKindergarten.usl`, CR `goals/AiGoalCollectResources.usl`, SP `goals/AiGoalSingleplayerAttack.usl`,
PY / SU / PV / BL / ST / QU / RI / SI = the Pyramid / Suicide / PureViolence / Blitz / Stealth / Quick / Rider /
Siege attack goals, AO `tasks/AiTaskAttackObject.usl`, BS `tasks/AiTaskBuildSquad.usl`, CH `misc/AiImprovementMgr.usl`
(the "cheat manager"), UM `misc/AiUtilityMgr.usl`, AF `Server/.../ActionFactory` (trigger actions).

---
## 1. Structure and think timing

### 1.1 Brain, modules, goals, tasks
- The engine (`CAiBrain`, planner, sensor, influence maps, allocation manager: all native code, §11) owns one brain
  per AI player. `CAiMgr.OnAiBrainCreated` (AiMgr.usl:55-98) gives it a pyramid object and the **control module**
  `CAiModuleControlDefault`, which adds the four work modules (CM:81-84): **economy** (EM), **fight** (FM),
  **area** (AM: scouting) and **defense** (DM), plus the cheat manager (CH) and the hero manager.
- Modules own **goals** (long-lived: BuildVillage, CollectResources, RepairBuildings, DisturbAttack, Kindergarten,
  GuardVillage, DefendMode, MinistryOfDefense, one goal per running attack ...); goals own **tasks** (BuildSquad,
  AttackObject, SitOn = mount transports, Timer ...). Every module / goal has `Think()` called every
  `SetThinkWait(n)` ticks.
- **One tick = 0.2 s** (the timers below only make sense with it: the attack limit `Set(0, 1200)` is "20 minutes"
  in the script's own comment, GA:943 - that timer counts seconds; think waits count ticks).

### 1.2 Think waits (ticks; `W` = the difficulty's wait, §3; `r(n)` = 1 + random % n, fixed at init)
| Who | Wait | Source |
|---|---|---|
| control module (gifts, fight factors, chat) | d ≤ 5: `W + r(7)`; d ≥ 6: `20 + r(7)` | CM:159-187 |
| economy module (realise requests, one more worker when all are busy) | `W + r + 20`; after `Activate()`: Easy 30 + r, Medium 10 + r, Hard 1 + r | EM:135, 231-244 |
| BuildVillage (build list) | `W`; the list itself is rebuilt on every 6th think | BV:112, 1206-1232 |
| CollectResources (idle workers) | 1 | CR:60 |
| fight module (starts requested attacks, extra units) | `W + r` | FM:68 |
| DisturbAttack (strategy) | `W + 20 + random % 20` | DA:186-208 |
| MinistryOfDefense (standing army) | `5 + r` | MOD:80 |
| an attack goal | `W + r(players + 1)`; Siege `10 + r`; PureViolence switches to 30 while it walks | PY:28, SI:33, PV:172 |
| GeneralAttack base | `5 + r + d` | GA:91 |

With W = 100 / 25 / 10 (d = 0 / 4 / 9) the strategy thinks every 24-28 s / 9-13 s / 6-10 s, the build list is
refreshed every 2 min / 30 s / 12 s, idle workers are picked up at once at every difficulty.

### 1.3 Creation and the player types
- `ServerApp.usl:440-487` creates `CAiPlayer(type)` per slot: `ai_Dodo` 2, `ai_Giraffe` 6, `ai_Schnecke` 10,
  `ai_Mikrobe` and `closed` 14 (`ai_Random` picks Dodo / Giraffe / Schnecke by the `AI/Personalities` bit mask;
  the `_easy/_medium/_hard` types 3-5, 7-9, 11-13 exist but nothing selects them).
- The engine passes the brain a type string of 9 lines: `type, tribe, team, name, difficulty, assist, eco, def, fig`
  (AiMgr.usl:58-72). `behaviour = type.Mid(3)` ("ai_Dodo" → "Dodo"), then `SetBehavior(behaviour)`,
  `SetDifficulty(difficulty)`, `SetTeam(team)` (AiMgr.usl:82-97).
- **Skirmish:** the lobby has a 0-9 difficulty drop list per AI slot (`Game/UI/PlayerInfoSlot.usl:106-117`).
- **Campaign:** every AI slot of every campaign map is `ai_Mikrobe` (dormant); triggers wake it with `AIBV`
  (section 10). The slot difficulty comes from the map: `PlayerSettings/Player_N/Restrictions/Base/
  AI_Difficulty_Easy|Medium|Hard` (defaults 1 / 4 / 8), picked by the campaign difficulty
  (`Game/mgr/CampaignMgr.usl:132-139`). Shipped values are e.g. `1,3,5`, `2,4,6`, `3,5,8`, `4,6,8`.
- **AI assist** (skirmish option, the AI helps a human): `AIAssistEco_0 / Def_0 / Fig_0` switch a part off,
  `_1` on; any `_1` disables cheats and the Kindergarten and forces difficulty 9 (CM:516-549). Not needed for the remake.

---
## 2. Behaviours (`SetBehavior`, CM:285-552)

A behaviour is a bundle of module commands. `ai.json` → `behaviours` (the commands as written, `{n}` = the random
sub-type 1-4, `{sub}` = the sub-strategy).

| Behaviour | Village (`village_level`) | Tactics | Aggr. / risk | Walls / towers / close start | Risk level | Notes |
|---|---|---|---|---|---|---|
| **Dodo** | `D1`-`D4` (random) | `D1`-`D4` | 100 / 100 | 0 / 1 / 0 | 1.0 | BrainWash; value table `Dodo<Class>.txt`; Kindergarten on |
| **Giraffe** | `G1` | `G1`-`G4` | 50 / 50 | 1 / 1 / 1 | 1.0 | BrainWash; table `Giraffe<Class>.txt` |
| **Schnecke** | `S2` | `S1`-`S4` | 10 / 10 | 1 / 1 / 1 | 1.3 | BrainWash; table `Schnecke<Class>.txt` |
| **Turtle** | `S2` | `S5` | 10 / 10 | 1 / 1 / 1 | 1.3 | the Schnecke that never attacks (tactic 5 = an all-`none` plan, §5.1) |
| **FightOnly** | - (economy module shut down) | `D2` | 100 / 100 | 0 / 0 / 0 | 1.0 | no BrainWash, behaviour type "Dodo" |
| **Mikrobe** | - | - | - | - | - | `SetPaused(true)`: the brain sleeps; nothing else changes |
| `Singleplayer_L3_1..3`, `_L8_1..2` | `X1`-`X3` | `X1`-`X3` | 100 (L8_1: 20) / 100 | per level | 1.0 / 1.3 | table `Singleplayer.txt`, guard armies `Level_3_Guards1` ...; unused by the shipped campaign (§10.1) |
| `AIAssistEco/Def/Fig_0/1` | | | | | | skirmish "AI assist"; not needed |

- The value table named `<Behaviour><Class>.txt` (`DodoEasy.txt` ...) does not exist in the game files - only
  `Dodo.txt`, `Giraffe.txt`, `Schnecke.txt`, `Singleplayer.txt` per tribe: the engine's `LoadValueTable` falls back
  (engine code; taken to be the file without the class).
- The two letters matter in two places: the **village type** (first letter = the build list's behaviour letter, BV:421)
  and the **tactics** (letter + number = the attack plan's behaviour letter and tactic, DA:425-430).
- Defender game mode forces `Schnecke` on the defender; the arena map forces `Dodo` (CM:292-298). On campaign maps
  the cheat manager is always enabled (CM:300).

Module commands (the strings of `SetBehavior`; `AICM` uses `Call`):

| Module | Commands |
|---|---|
| ECON (EM:450-482) | `village_level <type>|Deactivate`, `max_age <n>`, `forbid_building <class>`, `reset_buildings`, `disable_collect_resources`, `enable_user_interaction` |
| FGHT (FM:132-193) | `enable`, `disable`, `aggressiveness <0-100>` (> 50 activates DisturbAttack), `riskiness <0-100>`, `tactics <L><n>`, `EnableDisturbAttack`, `EnableAiKotH <bool>` |
| DFNS (DM:441-573) | `upgrade_walls 0|1`, `upgrade_towers 0|1`, `close_start_location 0|1`, `attacks_risk_level <f>` (≤ 0 switches the enemy detector off), `guard_village 0|1`, `army [<name>]`, `defend_place <x_y_z>` (guard base, radius 60), `AddDefenseArea <id> <pos> <radius> <max>`, `HighDefenseMode <bool>` (no reserved pyramid slots, §4.6), `CancelAttacksInDefense <radius>`, `deactivate_towers`, `deactivate_walls`, `deactivate_unit_defence` |
| DFNS `Call` (DM:608-654) | `village_wall 1 <region>`, `village_wall 2 <min> <max> <region>` |

---

## 3. Difficulty

`SetDifficulty(d)` (CM:159-187), `d` = the slot difficulty 0-9. Two derived values are used everywhere:
the **class** (`GetDifficulty()`: Easy / Medium / Hard) and the **wait** (`GetDifficultyInt()`, think-wait base).
`GetOldDifficultyInt()` is `d` itself. `ai.json` → `difficulty.levels`.

| d | class | wait `W` | gift per control think (food / wood / stone / skulls) | attack strength | gather × | build time × | research time × | unit limit + (levels 1-5; total) | weapon cycle × |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Easy | 100 | - | 0.20 | 1 | 1 | 1 | - | 1 |
| 1 | Easy | 75 | - | 0.25 | 1 | 1 | 1 | - | 1 |
| 2 | Easy | 50 | 1 / 1 / 0 / 0 | 0.30 | 1 | 1 | 1 | - | 1 |
| 3 | Medium | 30 | 2 / 2 / 1 / 0 | 0.35 | 1 | 1 | 1 | - | 1 |
| 4 | Medium | 25 | 3 / 3 / 1 / 0 | 0.40 | 1 | 1 | 1 | - | 1 |
| 5 | Medium | 20 | 4 / 4 / 1 / 0 | 0.45 | 1.25 | 0.95 | 0.95 | - | 1 |
| 6 | Hard | 16 | 5 / 5 / 2 / 0 | 0.50 | 1.5 | 0.9 | 0.9 | - | 1 |
| 7 | Hard | 14 | 7 / 7 / 2 / 1 | 0.55 | 1.75 | 0.8 | 0.7 | 2,1,1,0,0; +4 | 1 |
| 8 | Hard | 12 | 10 / 10 / 5 / 1 | 0.60 | 2.0 | 0.75 | 0.6 | 5,3,2,0,0; +10 | 0.95 |
| 9 | Hard | 10 | 50 / 50 / 20 / 5 | 0.65 | 2.5 | 0.5 | 0.4 | 10,10,7,1,0; +28 | 0.9 |

- **Gift** (CM:573-613, CH:309-352): every control think (20-107 ticks, 1.2) for every AI player except player 0,
  not in AI-assist, not on `multi_arena_001`. The table shows the *arguments*; the amount actually given is
  - **campaign / non-skirmish map: argument + 10** for food, wood and stone, skulls as listed ("special SP
    scripting", CH:341-348). Difficulty 4 thus gets 13 / 13 / 11 every ~5 s (= +156 food and wood per minute).
  - skirmish map, class Easy: 5 per listed resource; Medium: 20 per listed resource (skulls 3); Hard: as listed.
  - Resource "iron" in the scripts = skulls.
- **Attack strength** (`m_fAttackStrength`): an attack is cancelled as "Enemy is too strong!" unless
  `own level score ≥ strength × enemy level score` (6.2). Same table in Suicide, PureViolence, Blitz, Rider,
  Siege, Stealth, Guerilla, DetectTraps; QuickAttack and SpecialSEAS start at 0.1 / 0.2 and stop at 0.6.
  Level overrides: `Single 02` 0.2 (Suicide, PureViolence, Blitz, Siege), `Single 09` 0.2 and `Single 10` 0.3 (Blitz).
- **Gather ×**: `CAiPlayer.AddResource` multiplies everything an AI player's workers deliver
  (`Server/misc/Player.usl:599-617`).
- **Build / research time ×**: every production, construction and research action of an AI player except `age_2`
  (`Server/classes/task/Action.usl:346-382`; "research" = paths that contain `Actions/Upgrades/` or
  `Actions/Invent/` - which no tech tree path does (`/Actions/<Tribe>/Upgrades/...`), so in the shipped game the
  **build factor applies to research as well** and the research column is dead; §13.2).
- **Unit limit +**: more pyramid slots per level and a higher population cap (`Server/misc/RequirementsMgr.usl:213-241`).
- **Weapon cycle ×**: shorter attack interval for all AI units (`FightingObj.usl:7498, 7575-7591`; combat.md §0).
- **Fight factors** (CH:1086-1169, each control think while cheats are on, only `d ≥ 5`):
  ```
  mapV = clamp((((W-16)/8) * ((H-16)/8) - 1) / 20 + 0.3, 0.2, 0.6)      W, H = AI map size (bigger map = more help)
  def  = clamp(1 - mapV * d*0.2, 0.5, 2)      atk = clamp(1 + mapV * d*0.2 * 0.5, 0.5, 2)
  fog of war on : Dodo def→1+(def-1)*0.30, atk→1+(atk-1)*0.05   Giraffe 0.15 / 0.15   Schnecke 0.03 / 0.30
  fog of war off: Dodo 0.50 / 0.05                              Giraffe 0.75 / 0.75   Schnecke 0.05 / 0.50
  per think the factors move at most -0.05 / +0.025 towards the target
  ```
  `def` multiplies damage *taken*, `atk` damage *dealt* by the player's units (combat.md §1: `AttackFactor`,
  `DefenseFactor`). Example d = 9, large map, fog on: Dodo takes ×0.85 and deals ×1.03; Schnecke ×0.985 / ×1.16.
  For `d < 5` both are forced to 1.
- **Free epoch catch-up** (`d ≥ 6`, skirmish maps, BV:1326-1363): when a *human* player's main building is in a
  later epoch than the AI's, the AI starts its next `age_N` upgrade with the suffix ` /AI_Help`, which makes
  `CheckConditionsAndPay` return true without checking or paying anything
  (`RequirementsMgr.usl:373-377`). Once per epoch step.
- **Cheat-spawned units** (`CAiCheatMgr.SpawnUnit`, CH:115-285): **only on skirmish maps and only at d = 9.** A squad
  that is not complete after the BuildSquad timeout (300 ticks = 60 s on Hard) gets its missing units created for
  free next to the producing building (which must exist, be finished and have ≥ 5 HP), within the pyramid limit
  plus 5 / 2 / 1 / 1 / 0 extra slots per level, workers only below 15. In the campaign the cheat manager never
  spawns (`if(!m_bMultimap) return`); campaign waves are created by `AIFT` itself (6.5).
- **Class-dependent values**: worker cap per epoch (4.1), squad sizes (6.3), Kindergarten (8.5), item
  hunting (8.4), tech choices (4.4), hero training (4.5), scouting (8.1).

---
## 4. Economy

### 4.1 Workers
- Cap per epoch 1-5 (EM:423-446, `ai.json` → `difficulty.maxWorkersPerAge`): Easy 10 / 11 / 12 / 13 / 14, Medium
  13 / 14 / 15 / 15 / 15, Hard 15 throughout. On skirmish maps workers beyond 15 are killed (`/Kill`, EM:672-694).
- One more worker is requested whenever every worker is allocated (`AllWorkersLocked`, EM:626-639), until the cap.
- Defend mode sets the cap to 0 while it lasts (DMo:118-144, §7.3).

### 4.2 The build list (BuildVillage)
- `Think` every `W` ticks; on every 6th think (BV:1210): `RequestMoreResourceBuilding`, the free epoch catch-up
  (§3), `UpdateBuildList`, `RequestNext(5)`.
- `UpdateBuildList` (BV:417-1126) rebuilds the list from the hard-coded table by tribe, village letter and epoch
  (`ai.json` → `buildOrders`, 347 rows; conditions: `m_bHarbour`, `m_bWatermap`, `m_bMapWarpgate`,
  `m_sDifficulty=="Hard"`, `m_iDifficulty>=7`), then `CheckForFightUpgrades` (`fightUpgrades`, 90 rows: not for
  village letter G before epoch 4, BV:1629).
  An entry `AddRequest(name, count, unique)` is only added when the object exists in the tech tree and, for
  unique entries, fewer than `count` instances exist (BV:259-284).
- On skirmish maps, before the table (BV:427-443):
  - `CheckForEnemyShips`: fewer own warships than the strongest enemy fleet → one more (`counterShips`).
  - `CheckForUnitLimit` (BV:1424-1451): units + queued ≥ `max_units` and `max_units < 52` → a housing request **on
    top** (`housing`: Hu stone cottage, Aje big tent / tent, Ninigi fireplace, SEAS headquarters) and **nothing else**.
  - `CheckNumFightingUnits` (BV:1389-1420): fewer than 10 non-worker units and epoch ≥ 3 → **no list at all**.
  - every 5th update: the hero requests (`heroRequests`: one of three sets of three heroes; not on Easy, from
    epoch 3, BV:296-342).
- `RequestNext(5)` (BV:1130-1202): only the **first five entries** are looked at; a unique one is requested when
  instances + pending < count. At the unit limit only cottages / fireplaces / tents / headquarters / collectors and
  research pass (BV:1165-1170). SEAS: at most 2 carriers, 3 greenhouses.
- A request that succeeds or fails is removed and `RequestNext(5)` runs again; failed ones come back with the next
  list (BV:1250-1281).
- `CheckForFireplace` (BV:1285-1322): no main building → the list is cleared once and the main building goes on top
  (Aje: plus a small animal farm).
- `RequestMoreResourceBuilding` (BV:1455-1541, `storage`): a resource at its storage cap → one more of its
  storehouse while the tech tree allows more instances, else a warehouse (Aje: a resource collector).

### 4.3 Realising requests (engine)
The economy module hands requests to "target realisation" goals; the engine's planner (`CAiSolution`, needs,
allocation: §11) turns an object into the chain of actions, resources and workers it needs and locks them. Not
visible in the scripts: priorities between the five running requests, how the resource needs steer the workers.
Visible: `SetTotalProductionSpeed(70)` (CM:87); units "suicided" into animals do not exist in the scripts read.

### 4.4 Gathering (CollectResources, CR:408-453)
Every tick each idle, unallocated worker: **stone** while stone < cap (needs a stone drop site, a rock in reach
and no enemy at the rock, CR:337-404), else **wood** while below the cap, else **food** (a field / slaughterhouse /
paddy / greenhouse with a free slot first, then bushes). The first time a new stone site is used a tower is
requested there (`DM.BuildTower`: unless 6 towers stand within 30 m) and the tribe's stone storehouse (Hu / Ninigi
quarry, Aje bazaar, SEAS steelwork). Idle fishing boats go to the nearest shoal; the Aje harbour gets two
Cronosaurus as guards.

### 4.5 Heroes, upgrades
Heroes: §4.2. Upgrades come only from the list (`fightUpgrades`: weapon / armour research from difficulty 3,
special moves from Medium when the unit class exists, tribe specials on Hard); nothing is researched at random.

### 4.6 The standing army (MinistryOfDefense)
- Think every `5 + r` ticks; **one unit request at a time** (MOD:1203-1253).
- The pool = every own CHTR / ANML / VHCL on the home island that is not a worker, collector, cart, trade dino,
  hovercraft, transport turtle, raptor / tracker dino, kennel animal, rider, ship, and not allocated or locked
  (`IsAllowedUnit`, MOD:777-857); refreshed every 5th think.
- `ComputeNextBestUnitSolution` (MOD:1048-1199): levels 0-4 round robin, one per think. A level is skipped when
  `Units.txt` has no row for `Age_<epoch>/Level_<n>`, in epoch 1 when the pool already holds 5 units of the
  level, or when the pyramid has no slot left after the **reserved slots 6 / 5 / 3 / 1 / 0** per level
  (`HighDefenseMode`: none reserved, MOD:122-135). Inside a level every group `GroupN = '<weight>'` counts its pool
  units; the unit of a group is its last alternative whose hero (`cls = '<hero>'`) is absent or owned at level 5;
  the group with the smallest `share - weight / Σweights` is trained.
- `ai.json` → `unitMix` (the script always loads `<Tribe>/Units.txt`; `UnitsEasy / Medium / Hard.txt` are never
  read, MOD:96). Aje example, epoch 1: only velociraptor handlers (level 1); epoch 2, level 2: warrior 3,
  spearman 2, ankylosaurus (catapult) 3, stegosaurus 2, shaman 2.
- `QueryUnits(min, max, bad, heroes, targets)` (MOD:503-609) hands pool units to an attack: fails when the pool is
  smaller than `min`; "bad" units first (classes that are not in the current mix any more) up to the share `bad`,
  then good units, preferring the classes `CompareValue.txt` lists against the targets' type (`efficient`).
- Fight module, every think (FM:569-607, not SEAS, not difficulty 0-1): with more than 100 stone, 200 wood and 200
  food unallocated, one extra unit of the engine's choice (`SelectBestProdUnit`) is requested.

### 4.7 Point buy
`OnCreatePointBuyPreset` (CM:149-155) names `<Tribe>/AiPBPreset<sub-strategy><Class>.txt` (`pointBuy`): the start
units and resources by credits. Engine-side selection; skirmish in the remake starts without point buy.

## 5. Strategy: when and what to attack (`DisturbAttack`)

`Think` (DA:551-589) every `W + 20..39` ticks: check for an enemy warp gate, items (8.4), then
`CheckTacticalConditionsAndAct` (DA:816-1630).

### 5.1 The attack plan
`asAttacks[epoch - 1]` from a hard-coded table by tribe, behaviour letter, game type and map kind
(`ai.json` → `attackPlans`, 66 rows). "skirmish" = `GetMultimap()`, "campaign" = any other map.

| Tribe, behaviour | Map | Epoch 1 | 2 | 3 | 4 | 5 | Guerilla |
|---|---|---|---|---|---|---|---|
| Hu D | skirmish | pyramid | violence | suicide | violence | suicide | 11 % |
| Hu D | campaign | blitz | suicide | violence | suicide | violence | |
| Hu G | skirmish | none | suicide | violence | suicide | violence | 11 % |
| Hu G | campaign | scout | suicide | violence | suicide | violence | |
| Hu S | skirmish | none | none | none | suicide | violence | 11 % |
| Hu S | campaign | scout | none | violence | suicide | violence | |
| Aje D | skirmish | pyramid | suicide | violence | suicide | violence | 11 % |
| Aje D | campaign | none | suicide | violence | suicide | violence | |
| Aje G | skirmish | none | suicide | suicide | violence | violence | 11 % |
| Aje G | campaign | **none × 5** (bug: the list is appended to the 5 defaults instead of replacing them, DA:1187-1191) | | | | | |
| Aje S | skirmish | none | none | none | suicide | violence | 11 % |
| Aje S | campaign | scout | none | none | suicide | violence | |
| Ninigi D | skirmish | pyramid | stealth | violence | suicide | violence | 11 % |
| Ninigi D | campaign | blitz | suicide | stealth | suicide | violence | |
| Ninigi G | skirmish | none | stealth | suicide | suicide | violence | 11 % |
| Ninigi G | campaign | scout | stealth | suicide | suicide | violence | |
| Ninigi S | skirmish | none | none | none | suicide | violence | 11 % |
| Ninigi S | campaign | scout | none | violence | suicide | violence | |
| SEAS D | any | pyramid | suicide | violence | suicide | violence | |
| SEAS G | skirmish | none | none | violence | suicide | violence | |
| SEAS G | campaign | none | suicide | violence | suicide | violence | |
| SEAS S | skirmish | none | none | none | suicide | violence | |
| SEAS S | campaign | scout | none | violence | suicide | violence | |
| any S with tactic 5 (**Turtle**) | any | none × 5 | | | | | |
| X tactic 1 | any | Hu: none × 5; others: scout × 5 | | | | | |
| X other tactic | any | Hu, Aje: suicide × 5; Ninigi, SEAS: violence × 5 | | | | | |

Defender game mode: the defender never attacks; attackers use `pyramid|none, siege × 4` (D), `none, siege × 4` (G;
Hu: `none, suicide, siege × 3`), `none, none, siege × 3` (S). Level-specific rows: `Single 04` player 6 blitz × 5,
player 5 rider × 5; `Single 01` player 1 blitz × 5; `Single 09` Hu Giraffe player 1 `none, blitz × 4`;
`Single 10` SEAS D `pyramid, blitz × 4`, G blitz × 5 (and 11 % `SpecialSEASAttack`).

### 5.2 From plan entry to request (DA:1532-1630), in this order
1. Warp-gate hunt active → request `siege_warpgate` on the gate (5.5).
2. Ship attack: enemy ships or a harbour are known, epoch ≥ 3, an enemy owns a harbour, 6 % chance →
   `ship` on them (never in `Single 01`, `02`, `10`, `Single 03` player 1).
3. **Scouting**, once per game: if no pest patrol and no ship attack is pending and the entry is `scout`, or no
   enemy is known and the entry is not `blitz` → `RequestExploration` and return (8.1).
4. A pending pest patrol is requested (5.4).
5. Entry `none` → return.
6. **11 % of the time the entry becomes `pyramid`** (all-in, 6.4).
7. Difficulty 0 and 1, epoch 1, skirmish: only every 6th think a `blitz`, otherwise nothing.
8. `scout` entries do nothing in `Single 09`, `13`, `14`, `15`.
9. Trap check: if the enemy tribe is Ninigi → `traps` (DetectTraps) on the first think after an epoch change,
   else with 11 % (epoch 5) or 4 % probability.
10. Else guerilla: with the table's probability, if the tribe's sabotage move is researched (Hu `insects`, Aje
    `termites`, Ninigi `lockpicking`).
11. Else the entry itself. In `RequestAttack` (DA:1740-1789) **`suicide` and `violence` are swapped by the target
    list**: more targets with attack range ≥ 10 than not → `violence`, otherwise `suicide`.

### 5.3 Whom
- Enemy base positions: for every player the largest cluster of buildings (`FindEnemyMainBase`, CM:768-827).
- `SearchForEnemies` (DA:1634-1722): the enemy to attack is chosen by `GetValidStartLocationToAttack` (DA:368-421)
  with a strategy `m_iAttackStrategy = random % 6`, drawn anew every 20 thinks (DA:581-585): 0 a random enemy, 1-2
  the weakest (`CheckUnitLevel`: Σ (level + 1) of its non-worker units, heroes + 2; workers / main buildings only
  when it has no fighters), 3-4 a human enemy (else the weakest), 5 the human who attacked last (else a human).
  Enemies = players the AI's diplomacy opinion of is 0 (hostile).
- The target list is everything that player owns (CHTR, ANML, VHCL, BLDG, SHIP, NEST) except riders; ships and
  harbours go to the ship list; objects in areas whose `Enemy` region-map value is > 0 are skipped (§9); sorted by
  that map's value ("center_of_threat"); the attack position is the first target's.

### 5.4 Pest patrol
`RequestPestPatrol(deathPos)` (DA:689-699, skirmish maps only) is called where a wild animal killed one of the
AI's units; the next strategy think runs `SearchForDisturbance` (DA:703-812) around that spot: hostile animals and
nests within 90 m → a `suicide` attack on them (not against an allosaurus or a nest before epoch 4); else enemy
units / buildings within 60 m (Dodo always, Giraffe from epoch 2, Schnecke from epoch 4) → `blitz`; else enemy
towers within 60 m → `blitz` in epoch 1, `towersiege` later.

### 5.5 Warp gate, items, King of the Hill
- An enemy warp gate under construction starts the "warp gate hunt": `siege_warpgate` requests on it before
  anything else (DA:249-333, 1532); attacks on other players are refused meanwhile (FM:264-285).
- `CheckGetItem` (DA:633-681): before epoch 3 a `getitem` attack fetches map items (§8.4).
- King of the Hill maps replace the plan by attacks on the flag sectors (DA:866-941). Not ported.

---
## 6. Attacks

### 6.1 The fight module's gate (FM:205-565)
`RequestAttack` queues an attack info; `Think` (every `W + r` ticks) starts each with `StartAttack`:
- while the village **defends** (§7) only `pyramid`, `quick` and `getitem` pass (FM:211-215);
- a request equal to a running attack, or of the **same strategy** as a running one (except `pyramid`), is ignored;
- at most **3 attacks** at once (`m_iMaxAttacks`, FM:42, 238);
- a new `siege` replaces a running `siege`; on campaign maps `auto` / "" becomes `quick` (FM:262).
- Strategy → goal: `blitz` Blitz, `rider` Rider, `quick` Quick, `auto` AttackGroup, `pyramid` Pyramid, `traps`
  DetectTraps, `siege` / `towersiege` / `siege_warpgate` Siege, `guerilla` Guerilla (order `insects` / `termites` /
  `lockpicking`), `violence` PureViolence (with flank way points), `stealth` Stealth, `suicide` and anything else
  Suicide, `skulls` GetScalps (army modifier 3 / 2 / 1 by epoch), `ship` AttackShips.

### 6.2 Strength check (`CompareLevel`, SU:244-308, PY:193-262)
Level score = Σ (level index + 1) over units; targets count CHTR / ANML / VHCL / SHIP that are not workers. The
attack is cancelled ("Enemy is to strong!") when `strength(d) × enemy score > own score` (§3 table). Pyramid:
always passes in epoch 1; later it also passes when the squad has at least `m_iShouldHave` units (2, 3, 4 ... 10
by difficulty, `difficulty.levels[d].pyramidAttackUnits`).

### 6.3 Squads (the goals' `Think`, GA:559-593, BS)
All goals share the states `new → waiting → transfering → sit_on → fighting` (SU:99-240):
- `new`: `GetUnits("<Army>_<epoch>")` builds the engine "solution" for the army row of the tribe's value table
  (`ai.json` → `armies[tribe][table][army]`: rows `UnitsN = 'min-max' { class [level, ObjFlag] ... }`); from
  difficulty 4 heroes are added; units of the wanted classes are taken out of the pool first
  (`QueryEssentialsFromDefensePool`); the rest is requested by a BuildSquad task. How many of `min-max` the engine
  asks for is not in the scripts.
- BuildSquad timeout: 500 / 400 / 300 ticks (100 / 80 / 60 s) by class (BS:98-104); when it runs out the
  allocation "is not possible" and the attack fails (at difficulty 9 on skirmish maps the missing units are
  spawned, §3).
- `waiting`, squad complete: pool units join by `QueryUnits(min, max, bad, 2 heroes)` (`difficulty.squad`): Suicide,
  PureViolence (+ 2 × epoch), Stealth, Siege, Guerilla 1-5 / 2-12 / 3-20 by class; Blitz 1-2 / 2-4 / 3-6; Quick
  1-2; Rider 1-5 / 2-12 / 3-20; Singleplayer 1-4 / 1-6 / 2-8. Fewer than `min` in the pool → the attack fails. Then
  the strength check.
- No army table (or `GetUnits` fails): the attack is made of pool units alone, same numbers (SU:116-151).
- `transfering` / `sit_on`: island transfer and mounting transports / riders (40 ticks).
- **Pyramid** (PY:117-190): takes the whole pool (`TakeAllYouHave`), no squad. In epoch 1 there is no minimum and no
  strength check at all (PY:198): a Dodo at difficulty 2-9 on a skirmish map sends whatever the pool holds - even a
  single unit - at every strategy think from the start (every 14-18 s at difficulty 2, 9-13 s at 4, 6-10 s at 9),
  up to three such attacks at once. Difficulty 0 and 1 never do this in epoch 1: their plan entry is replaced by a
  `blitz` (squad `BlitzAttack_1` + 1-2 pool units) on every 6th think (§5.2 step 7), i.e. not before 2:15-2:40 game
  time at difficulty 1 plus the time to build the squad and walk.
- `Start` sets the termination timer: 1200 s (GA:943); on time-out the attack fails. There is **no retreat**
  (`ShouldRetreat` is commented out, GA:1370-1410); PureViolence has a `retreat` state for its way-point walk only.

### 6.4 The fighting state (GA:971-1060, 1343-1365)
Every think: dead fighters are dropped (none left → "all fighters are dead!"); a squad that had **more than 5**
fighters asks for **2** reinforcements of the last living class whenever one dies (`OnLostUnit`, GA:1496-1573: from
the outpost nearest to the fight, else the village); `CheckCompletion` ends the attack when its AttackObject task
is done; enemies within 30 m of the first fighter (plus hostile animals within 60 m for squads of 10+ on skirmish
maps) become the new target list. Target values per goal: buildings and collectors -2 (they come last), the last
enemy +0.1, neutral animals that do not attack the squad are ignored.

### 6.5 Trigger attacks (`AIFT`, `SingleplayerAttack`)
`CActionAiFight.OnPush` (AF:4534-4581) resolves the target objects with the action's object query (`obj_type`,
`obj_owner`, `obj_class`, `rgn_guid` ...); with no match nothing happens.
- `custom_attack = 0` → `SetTriggerAttack`: an `auto` request with the usable arms from the editor flags
  (FM:776-817). On campaign maps `auto` becomes `quick` in the request but still runs as an AttackGroup
  (FM:262, 553-563). **Unused by the shipped campaign.**
- `custom_attack = 1` → `SetCustomAttack(player, "type/onTheWay/spawn/ignoreLoc/pos/targetOnly/ship/shipLand/spawnPos/handles")`
  (AF:4558-4570, FM:821-974). Parameter mapping (note the editor names):

  | Trigger parameter | Meaning in the script |
  |---|---|
  | `attack_type` | army name, or `PyramidAttack`, `RessourceOutpost`, `AttackOutpost`, `Item_Attack` |
  | `all_the_way` | `m_bAttackOnWay`: also fight enemies met on the way (within 30 m) |
  | `attack_with_all` | **spawn**: the units are created for the attack instead of taken from the village |
  | `ignore_locations` | spawn without needing the producing building |
  | `position_edit` "x y z" | the way point the squad walks to; for outposts the outpost position |
  | `target_obj` | attack only the listed targets |
  | `ship` | a ship attack (`AttackShips` goal, army = `attack_type`, ships spawn at `spawn_position` or the harbour) |
  | `ship_land` | landing: the squad is spawned in a transport at `spawn_position`, sails to `position_edit`, unloads, the transport is killed, then fights |
  | `spawn_position` "x y z" | where spawned units appear ((0,0,0) = the start location) |
  | `attack_behavior` | **ignored at runtime** (declared in `action_attrib_def.txt:353`, never read): the editor's choice of army table |

- Dispatch: `PyramidAttack` → Pyramid goal on the targets; `ship` → AttackShips; `RessourceOutpost` /
  `AttackOutpost` → `Economy.StartOutpost(island, position_edit, type)` (8.2); `Item_Attack` → fetch the first
  target that is an item; everything else → **SingleplayerAttack** with priority 1000.
- `SingleplayerAttack` (`goals/AiGoalSingleplayerAttack.usl:145-369`):
  - *spawn*: `FindUnits` creates every unit of the army with `MakeUnit` (`:528-662`): if `ignore_locations` is off
    the class must be buildable and its producing building must exist near the spawn position, be finished and have
    ≥ 5 HP (then the unit appears at that building); it gets its variant upgrade and level (the table's `level`, else
    `GetProperLevel(class)` → `ai.json` → `spawnLevels`), is added to the pyramid and walks 10 m to "spawn out".
    `Single 04` never spawns `hu_mammoth_log_cannon`, `Single 06` never `ninigi_firecannon`. **Spawning is free and
    ignores the population cap.**
  - *not spawn*: `GetUnits(army)` as in 6.3 plus 1-4 / 1-6 / 2-8 pool units.
  - then `fighting_walk`: go to the way point (attack-move on skirmish maps, plain walk in the campaign, 6.6); within
    40 m of it → `fighting_fight`. Army `Attack_Neutral` retargets neutral animals within 100 m of the attack position.
  - target value: building -0.5, neutral animal not attacking the squad -99999.
- Not blocked by the 3-attack limit or the defend check: `SetCustomAttack` adds its goal directly.

### 6.6 The squad in the field (`AttackObject` task, AO:757-1030)
- `StartAttack` sets the actors' aggression state to 2 (AO:764) and gives **one order to the whole group**:
  `/AggressiveTarget` (attack-move) to the attack position or the first target on skirmish maps, `/Walk` on campaign
  maps unless `all_the_way` (AO:880-896, 934-989); buildings, walls and neutral animals get `/Attack`.
- `SortTargetList` (AO:1240-1438): targets nearest-first inside these classes, in this order: defender object,
  warp gates, **heroes, vehicles, animals, soldiers, workers, military buildings** (arena, animal farm, machine
  maker, weapons, engineer), **main building, other buildings, towers, walls** (4 pieces, then the rest), ships.
  With no path to the targets the walls that block it come first and a siege squad is requested
  (`NoPathThenSendSiege`, AO:1173-1238).
- `Think` (AO:1041-1146): when the current target dies the order is given again for the next; special moves are
  checked per unit on their own timers: a move is used when the enemy hit points within 60 m sum to more than
  500 (or a single target has 500+), per-move global conditions (invention, level) and local ones (AO:337-560).
- Trapped actors attack the trap (AO:1561-1606); items near the squad are picked up.

---
## 7. Defence

### 7.1 Danger detection (DefendOutpost, one per defence pool; think `W + r`)
`SearchForEnemy` (DefendOutpost:71-174): danger map = (the influence of own buildings, thresholded and blurred)² ×
the enemy presence map × `-risk` (`attacks_risk_level`: 1.0, Schnecke / Turtle 1.3). The most dangerous area with
a value ≥ 1 gives the enemy units there (wild animals when there are none) to the pool's GuardVillage as an attack
"GuardVillage"; enemy ships there request a `ship` attack. If non-animal enemies stand within **45 m of the start
location** → `ActivateDefendMode`.

### 7.2 The village guard (GuardVillage, think `10 + r`)
- All pool units belong to its unit supervisor (the MOD's pool); base = start location, base range 60 m
  (`CalculateGuardRange` every 5th think: the farthest own building + 30 m), guard range 30 m.
- `UpdateGuardPos` (GV:365-594): with an alarm inside the base range the guard position is the centre of the
  targets (disguised, entrenched, invisible and swimming ones are dropped), and - unless the targets are wild
  animals - the defence module is set **defending** and defend mode is switched on. **Fewer than 7 fighters ignore
  hostile wild animals** (GV:530-539). All fighters get `/AggressiveTarget` to the guard position (`/Attack` for
  animals and walls), re-sent every 3rd think.
- Without an alarm the guard position is the first of: an enemy near the village, a damaged building, the own warp
  gate, the defender object, a defence point, the temple, the configured guard position, the start location
  (GV:399-428).
- `CryForHelp`: a chat message to allied players (not in level 15).
- Defending also blocks new attacks (§6.1); `CancelAttacksInDefense <r>` additionally cancels running attacks
  within `r` of the start location (DM:576-589).

### 7.3 Defend mode (DMo)
`SetDefendMode(true)`: the workers within 100 m of the base are locked, the worker cap is set to 0, Hu workers enter
bunkers within 100 m (4 per bunker, nearest first), Ninigi workers `entrench`; others are released again. `false`
undoes it (`/DismountAll`, entrench off, cap back).

### 7.4 Towers, walls, mines
- `UpdateDefensiveCoverage` every 10th defence think (DM:752-823): the defence map gets every tower's damage within
  `range × 1.2` (Giraffe / Schnecke: at the tower's cell only), the building map minus it gives the most important
  uncovered area → `BuildTower` there (best tower class of the tribe). Regions with `DefensiveCoverage` values
  shift it (§9). Not for attackers in Defender games.
- Village walls (`BuildVillageWalls`, 899 lines + the engine's wall placer): activated at epoch 3 when the map
  option `walls` is set, not in `Single 02` or Defender games (DM:671-685); `upgrade_walls`, `close_start_location`
  steer it. Not ported.
- Ninigi on water maps: mine belts from epoch 2 (DM:660-669). Not ported.
- Aggressive animal clusters near the home island are marked as path-finding blockers (DM:704-747).

---
## 8. Scouting, water, items, level-ups

### 8.1 Scouting
`RequestExploration` (DA:1726-1736) → area module → GeneralScouting goal: once per game, when the plan entry is
`scout` or no enemy is known (§5.2 step 3); an Oracle scouting task uses the Hu druid's oracle.

### 8.2 Water, outposts
Watercrossing goal (945 lines): transports for squads whose targets are on another island; IslandSurveillance;
BuildOutpost (`outposts` in `ai.json`: `RessourceOutpost`, `AttackOutpost`, `OP_ResAll`, `OP_AttackAll` build
lists per tribe); the market manager's trade route (Schnecke, Deathmatch, epoch 2+, map option `markplace_outpost`,
EM:527-537). Not ported, except the landing of scripted waves (§6.5).

### 8.3 Ships
Warships come from the build list (`m_bWatermap`) and `CheckForEnemyShips` (§4.2); ship attacks: §5.2 step 2.

### 8.4 Items
`CheckGetItem` / GetItem goal / ItemAttack: map items are fetched by a small squad (`FindItem_1`). Not ported.

### 8.5 Level-ups (Kindergarten, KG:49-155, 255-)
Think every 500 / 100 / 10 ticks by class; **never on Easy**, not with AI assist. "Children" are the units of
attack goals (not Suicide / Quick / auto) and of the village guard. A child at level 1-4 whose task is Idle or
Fight and whose hit points are **≤ 30 %** (or the "fortune cookie" unit the fight module names) gets one level if
skulls can be allocated and `CheckIfMaxLevelIsReached` allows: heroes always; else per class a number of free
levels and a chance for the next (`ai.json` → `levelCaps`: e.g. warrior free to level 3, then 26 %; worker 4 %
at level 1).

---
## 9. Region maps and map AI options

- Map AI options (the sensor's `GetWalls / GetMarketplace / GetHarbour / GetMapWarpgate / GetHuntAnimal /
  GetWatermap`, CM:105-110; the map file's `ai_options`): `walls` (village walls may be built), `markplace_outpost`
  (trade route), `harbour` (harbour + fishing in the list), `warpgate`, `hunt_animals`, `watermap` (warships, mine
  belts). `GetMultimap` = skirmish map (campaign maps: false).
- `AIRG {player_id | all_players, map_name, region_name, value, add_edit}` paints a value into a named AI map over
  a region. Maps read by the scripts: `Enemy` (target search skips areas with a value > 0, DA:1689-1690; the
  editor labels the action the other way round), `InflBuild` / `DefensiveCoverage` (danger and tower placement),
  `BuildModifier` (building placement), the resource maps `WOOD`, `FOOD`, `STON`, `FRUI`, `Fish`. Shipped: 13 uses.

## 10. Trigger actions in the campaign

Survey of the 16 shipped campaign maps (`Maps/Cpn_single_001/single_01..16.ula`): 93 `AIBV`, 101 `AIFT`, 44
`AIAM`, 30 `AIDA`, 27 `AILU`, 13 `AIRG`.

### 10.1 `AIBV` (player_id, behavior[, module])
Behaviours used: **Dodo, Giraffe, Schnecke, Turtle, Mikrobe, FightOnly** (never `Singleplayer*`, never a module).
Typical script: a base sleeps as Mikrobe → `Turtle` when the player gets near (it builds and defends, never
attacks) → `Dodo` / `Giraffe` when it should start attacking → `Mikrobe` again when the story is done.

### 10.2 `AIFT`
All 101 are custom attacks; 84 spawn their units (`attack_with_all`). Attack types used: `SP2Attack_1`,
`SuicideAttack_2/3`, `PureViolenceAttack_2/3`, `BlitzAttack_1/3`, `RiderAttack_1/2/3`, `AttackOutpost`,
`PyramidAttack`, `L07_aje_easy/medium`, `L10_distraction_med/hard`, `L13_MB2_1..3`, `L13_MB3_1..3`,
`L15_quick/melee/siege_attack[_easy|_hard]`. Landings (`ship_land`): `BlitzAttack_1` in level 3,
`L07_aje_*` in level 7, the `L15_melee/siege` waves in level 15. One ship attack (level 3).
Example: `{player_id 1, attack_type SP2Attack_1, all_the_way 1, custom_attack 1, position_edit "480.4 996.5 29.25",
spawn_position "0.0 0.0 0.0", obj_owner 0, obj_type All|, rgn_guid UniqueWorldRegion}`.

### 10.3 `AIDA` (player_id, id, position "[x,y,z]", radius, max_units)
→ DFNS `AddDefenseArea id pos radius max` (AF:3731-3745, DM:522-537): a defence pool (7.1, 7.2) with that many
units guarding the disc; `max_units` ≤ 0 or missing removes pool `id`. Shipped radii 10-250, sizes 5-20.

### 10.4 `AILU` (player_id, lock, units | object query with `enable_objsel`)
→ `CAiInterface.LockUnit / UnlockUnit(player, guids)` (AF:3876-3890): an **external lock** in the allocation
manager. Locked units are invisible to the AI: the MOD does not pool them (MOD:174), squads and tasks cannot
allocate them, CollectResources skips locked workers. The level script (or the unit's own aggro) controls them.
`lock` defaults to true; `lock = 0` gives them back (they join the pool on the next refresh).

### 10.5 `AIAM` (aggro_state, object query or a unit list)
→ every matched object gets the command `/AggroState_<n>` → `FightingObj.SetAggressionState(n)` (AF:4700-4723,
`FightingObj.usl:1058-1061, 7094-7101, 8696-8701`; berserkers ignore it, state 3 is frozen):
`0` stand ground, `1` defensive (follows an enemy inside a 20 m circle, then returns), `2` aggressive (follows until
death), `-1` passive. Independent of the AI; shipped values 2 (27 ×) and 1 (8 ×), the rest carry no state. The AI itself sets 2 for squads
when they start (AO:764), 2 / 1 for fighters / supporters when an attack ends (GA:417-418), 0 for wall archers.

### 10.6 Others
`AICM` (call module, 2.) is unused in the shipped campaign. `AIST` is the old name of `AIBV` (AF:3590).

---
## 11. What the engine hides, and what to do instead

| Engine part | Used for | Replacement in the remake |
|---|---|---|
| planner (`CAiSolution`, needs, allocation) | turning list entries into actions, reserving resources and units | iterate the list; `canQueue` / `canAfford`; a `locked` set per AI |
| influence maps | danger detection, placement, tower spots, resource spots | distance checks around buildings; a coarse 8 m grid is enough for towers |
| `MakeDefinedSolution` count choice | squad sizes | 6.3 suggestion |
| wall placer | wall ring and gates | `W.wallLine` on a ring / region outline |
| outposts, islands, transfers | forward bases, landings | nav-component ids as islands; `board` / `unload` orders |
| `SelectBestProdUnit`, `GetPossibleAtkOutpostPosition` | extra unit, forward base spot | the unit-mix rule; midpoint to the enemy on own island |
| point-buy preset selection, `LoadValueTable` fallback | start units, army table | 4.7, 2. |
| `BrainWash`, `SetPaused` | behaviour switch | reset the AI's state machines; a `paused` flag |

---
## 12. `ai.json` (written by `remake/pipeline/build_ai.py`)

```
python -m remake.pipeline.build_ai <Data folder> <output folder>      → <output>/ai.json   (~330 KB)
```
Pipeline step `ai` (`pipeline/__init__.py` STEPS; no dependencies). Inputs: `Scripts/Ai`,
`Scripts/Server/settings/Techtree/_AI_ObjectData.txt`, `Scripts/Server/misc/Player.usl`,
`Scripts/Server/misc/RequirementsMgr.usl`, `Scripts/Server/classes/task/Action.usl`,
`Scripts/Server/classes/FightingObj/FightingObj.usl`, read from the official mods (Base, BoosterPack1: the newest
copy wins). A data folder built before the step existed gets the file on first request (`toolkit/remake.py`).
The game loads it in `loadCore` (`G.aiData`); without it `src/game/ai/data.js` uses its built-in fallbacks.

| Key | Content | From |
|---|---|---|
| `source` | mods and tribe settings folders read | |
| `behaviours` | name → `{economy[], fight[], defense[], area[], params{}, valueTable, subStrategy, variants, paused, economyOff, brainWash, personality, kindergarten}` | CM `SetBehavior` |
| `difficulty.levels` | `"0".."9"` → `{class, wait, controlWait, gift{}, attackStrength, quickAttackStrength, pyramidAttackUnits, gather, buildTime, researchTime, unitLimit{levels[], total}, weaponDuration}` | CM, attack goals, Server scripts |
| `difficulty.gift` | `{skirmish: {Easy{}, Medium{}}, campaignAdd}`: what a gift really is (§3) | CH `SpawnResources` |
| `difficulty.maxWorkersPerAge`, `difficulty.squad`, `difficulty.squadTimeout`, `difficulty.kindergartenWait` | worker caps; pool units min / max / bad share per goal and class (+ the goal's army name); BuildSquad timeout and Kindergarten wait in ticks | EM, attack goals, BS, KG |
| `armies` | tribe → table (`Dodo`, `Giraffe`, `Schnecke`, `Singleplayer`) → army → `[{min, max, alternatives[{cls, level, objFlag}], group?}]` | `settings/<Tribe>/*.txt` |
| `unitMix` | tribe → variant (`default`, `Easy` ...) → `Age_n` → `Level_n` → `[{weight, units[{cls, npc, nonchar, objFlag}]}]` | `Units*.txt` |
| `pointBuy` | `generic` or tribe → preset (file name without `AiPBPreset`, e.g. `D1Easy`) → credits → `{chars[], resources{food, wood, stone, iron}}` | `AiPBPreset*.txt` |
| `efficient` | target type → unit classes | `CompareValue.txt` |
| `objectData` | object → `{type, tribe, boni{CHTR, ANML, VHCL, BLDG}, skulls[5], threat}` (336 objects; boni 1-3 = the help-text effectiveness class, skulls = kill reward per level) | `_AI_ObjectData.txt` |
| `buildOrders`, `fightUpgrades`, `heroRequests`, `housing`, `counterShips`, `storage` | `{request, objFlag, count, unique, onTop, tribe, behaviour, minAge / age, when[], not[], line}` in script order (`heroRequests`: `set` 1-3) | BV |
| `attackPlans` | `{tribe, behaviour, multimap, defenderGame, defender, level, notLevel, player, tactic, when[], not[], attacks[5], guerilla, appended, line}` | DA |
| `outposts` | type → tribe → `[{request, count, when}]` | BuildOutpost `RequestNext` |
| `levelCaps` | class → `{free, last: [level, chance %]}` (levels as script indices 0-4) | Kindergarten |
| `spawnLevels` | class → level index of a spawned unit | CH `GetProperLevel` |

The script tables are read with a small conditional-call extractor (`walk()` / `rows()`: if / elseif chains with
literal arguments). A row's conditions become fields where the extractor knows them (`tribe`, `behaviour`,
`minAge`, `age`, `multimap`, `level` ...); the rest stays in `when` as raw script conditions (`m_bHarbour`,
`m_bWatermap`, `m_sDifficulty=="Hard"`, `m_iDifficulty>=7`, `has:<class>` = the player owns such a unit); `not`
lists the conditions of the earlier branches of the same if-chains, none of which may hold. `data.js` `matches()`
evaluates them; a raw condition it does not know does not hold.

---
## 13. Gap analysis: the remake's `TribeAI` (`remake/src/game/ai.js`) against the original

How it is used today: `main.js:364` creates one `new TribeAI(G, aiPlayer, humanPlayer, 'easy'|'normal'|'hard')` and
calls `update(dt)`. One hand-written build plan per tribe (`PLANS`), a worker target, timed attack waves.

Ordered by how much a player notices. "Sketch" refers to the World API: `W.order(units, {type})`,
`W.queueAction(producer, action)`, `W.canQueue`, `W.startConstruction(p, action, x, z, rot, workers)`,
`W.placement(name, x, z, rot, p)`, `W.wallLine`, `W.spawnUnit`, `W.levelUp`, `W.useMove`, `W.nearestResource`,
`u.stance`, `W.later`.

1. **When and how it attacks.** Remake: a clock (`firstAttack` 420-900 s, then every 150-240 s) and a head count
   (`wave + waves × waveGrow`), everything walks to the enemy base. Original: no clock. A strategy think every 6-28 s
   picks the entry of the tribe / behaviour / epoch table (5.1), builds the named squad (6.3) and launches only if
   `own score ≥ strength(d) × enemy score` (6.2); Dodo raids from epoch 1 with whatever it has (`pyramid`),
   Schnecke waits for epoch 4, Turtle never attacks; up to 3 attacks at once.
   *Sketch:* `strategyThink()` on its own timer `(W + 20 + rand 20) × 0.2 s`; `plan = ai.attackPlans` row →
   `this.requestAttack(type, targets)`; an `Attack` object per running attack with states
   `gather → (board) → fight`, a `units` set removed from `this.pool`, the 1200 s timer, and reinforcement of 2 when
   a squad > 5 loses a unit. Score = Σ `u.level` over non-workers (the remake's level is 1-based = index + 1).
2. **Army composition.** Remake: every military building queues its highest-level option 60 % of the time, else
   random. Original: the standing army follows per-epoch weights per pyramid level (4.6), and each attack type has
   its own unit list (melee `SuicideAttack_n`, ranged `PureViolenceAttack_n`, siege with catapults and rams,
   raptor / dilophosaurus raids); ranged-heavy enemies get the ranged army and vice versa (5.2 step 11).
   *Sketch:* `trainNext()` = the MOD rule over `ai.unitMix[tribe].default['Age_' + epoch]`, one request at a time,
   finding the producer with `actsOf(building).find(a => a.results[0].obj === cls)`; squads from
   `ai.armies[tribe][table][name]` first from the pool, the rest queued, with the 60-100 s timeout.
3. **Difficulty.** Remake: 3 levels change think time, wave size, worker count. Original: 0-9 with reaction time
   (think waits 10-100 ticks), resource gifts every think, gather × up to 2.5, build / research time × down to
   0.5 / 0.4, extra pyramid slots, faster weapons, damage factors, free epoch catch-up (3.). The campaign sets
   it per player and per campaign difficulty (1.3).
   *Sketch:* `new TribeAI(G, p, { difficulty: 0..9 })`; `p.aiGather`, `p.aiBuildTime`, `p.aiResearchTime`,
   `p.aiWeaponTime`, `p.attackFactor`, `p.defenseFactor`, pyramid bonus on the Player, read by economy.js
   (`deliver`), production.js / construction.js (durations), combat.js (cycle, damage); gifts in `controlThink()`
   with `p.res[r] += n` (not capped: the engine call is `SpawnResources`).
4. **Defence.** Remake: any enemy within 65 m → the whole army attack-moves to it; a single tower from the plan; no
   walls; workers keep working. Original: the idle army stands at a guard point and patrols to damaged buildings;
   alarm only where enemy presence overlaps own buildings (range = farthest building + 30); workers hide in
   bunkers (Hu) / entrench (Ninigi) and worker training stops; allies are asked for help; towers are built where
   buildings are uncovered and at every new stone mine, never next to enemies; a wall ring with gates from epoch 3
   (Giraffe, Schnecke, Turtle); attacks are refused while defending; attackers too few to matter (< 7 defenders vs
   hostile animals) are ignored.
   *Sketch:* `guardThink()` with `guardPos` priority list (7.2) and `W.order(pool, {type:'attackmove'})` only when
   the point changes; `defendMode(on)` using the bunker `board` order / entrench move; `towerThink()` every 10
   defence thinks: for each own building without a tower within `range × 1.2`, `W.placement(bestTower, ...)` near it.
5. **Economy rules.** Remake: up to 26 workers by ratio (food 40-45 %, wood 32-35 %, stone 20-28 %), own build plan,
   epoch when workers and army counts are met and `time > epoch × 180`. Original: at most 15 workers (10-14 on
   Easy), idle workers take stone, then wood, then food while below the storage cap, the build order of 4.2 with 5
   concurrent requests, the epoch upgrade is simply the next list entry (no timer), nothing is built at epoch ≥ 3
   while the AI has fewer than 10 fighters, housing has absolute priority at the population cap, a storage building
   is added when a resource is capped, upgrades come from the list (4.4), not at random.
   *Sketch:* replace `PLANS` by `ai.buildOrders` filtered by tribe / behaviour letter / `minAge` / map options;
   `request(entry)` dispatches on the prefix (`BLDG/` → `startConstruction`, others → `queueAction` at the producer
   that offers it); keep the remake's `findSpot` (it already does the resource-site and tower placement).
6. **Campaign control is missing.** No dormant state, no behaviour switch, no scripted waves, defence areas, unit
   locks or region flags. Without these no campaign map plays (section 10). *Sketch:* the interface below.
7. **Water, outposts, trade.** Remake: a harbour and 3 fishing boats. Original: warships from epoch 2 on water maps
   and one more whenever the enemy has more, transports for attacks across water and landings (`ship_land`),
   ship attacks on harbours, a resource outpost at the nearest free stone deposit, a forward attack outpost,
   Schnecke's trade route. *Sketch:* `islandOf(pos)` from the nav components; a `Transfer` state in `Attack` using
   the existing `board` / `unload` orders; `Outpost` = position + crew + mini build list.
8. **Unit handling details.** Target order (6.6: heroes, vehicles, animals, soldiers, workers, military buildings,
   main building, houses, towers, walls) instead of plain attack-move; blocked by walls → attack the blocking pieces
   and send a siege squad; "pest patrol" to where a worker died (5.4); level-ups only for units at ≤ 30 % HP and
   heroes, with per-class ceilings, never on Easy (8.5) (remake: whenever skulls allow, highest level first); special
   moves on the 500 HP rule (the remake has an approximation); item pick-up; one scout early on; heroes trained
   from epoch 3 on Medium / Hard (remake avoids heroes 80 % of the time); enemy choice among several enemies (5.3:
   the remake knows a single `enemy`); units suicided into animals to free pyramid slots (4.3).

Things the remake does that the original does **not**: timed first attack, hunting for skulls on purpose, buying
food at the market, retreat home after a wave (the original has no retreat at all: survivors simply return to the
pool when the targets are gone or the 20 minute timer ends).

### 13.1 Proposed interface for campaign-driven AI
One brain per AI player (`G.brains[player.id]`), created paused for campaign maps. Trigger actions map 1:1:

```js
class TribeAI {
  constructor(G, player, { difficulty = 5, behaviour = 'Mikrobe', mapOptions = {}, multimap = false }) {}

  // AIBV {player_id, behavior, module?}
  setBehaviour(name, module = 'CTRL') {}
  //   CTRL: 'Dodo' | 'Giraffe' | 'Schnecke' | 'Turtle' | 'FightOnly' | 'Mikrobe' | 'Singleplayer_L3_1' ...
  //         → this.cfg = ai.behaviours[name]; paused = cfg.paused; economyOff = cfg.economyOff;
  //           reset attacks and build list (BrainWash); plan letter / tactic from cfg.params
  //   ECON | FGHT | DFNS | AREA: the module command strings of section 2 ('upgrade_walls 1', 'HighDefenseMode true' ...)

  // AIFT custom_attack = 1
  startAttack({
    type,                   // army name | 'PyramidAttack' | 'RessourceOutpost' | 'AttackOutpost' | 'Item_Attack'
    targets,                // entities the action's object query matched (required, non-empty)
    position = null,        // position_edit: way point / outpost position
    attackOnTheWay = false, // all_the_way
    spawn = false,          // attack_with_all: create the units (W.spawnUnit) instead of using the pool
    spawnPosition = null,   // spawn_position; null = start location
    ignoreLocations = false,// ignore_locations: spawn without the producing building
    targetOnly = false,     // target_obj
    ship = false,           // ship: naval attack
    shipLand = false,       // ship_land: spawn in a transport at spawnPosition, land at position
    behaviour = null,       // attack_behavior: accepted and ignored (documentation only)
  }) {}                     // → Attack id; bypasses the 3-attack limit and the defending check

  // AIFT custom_attack = 0 (unused by the shipped campaign): counter-picked squad against the targets
  startAutoAttack({ targets, use = { ranged: true, melee: true, infantry: true, cavalry: true, vehicles: true, ships: false } }) {}

  // AIDA {player_id, id, position, radius, max_units}; maxUnits <= 0 removes the area
  setDefenceArea(id, { x, z }, radius, maxUnits) {}

  // AILU {player_id, lock, units}: externally locked units are never pooled, allocated or given orders by the AI
  lockUnits(units, lock = true) {}

  // AIRG {player_id | all_players, map_name, region_name, value, add_edit}
  setRegionMap(mapName, region, value, add = true) {}
  //   stores {map → [{region, value}]}; consulted by: walls ('village_level X3'), towers ('DefensiveCoverage'),
  //   placement ('BuildModifier'), gathering ('WOOD' | 'FOOD' | 'STON' | 'FRUI' | 'Fish'), targeting ('Enemy')

  // AICM {player_id, module, command}: 'DFNS', 'village_wall 1 <region>' | 'village_wall 2 <min> <max> <region>'
  callModule(module, command) {}

  update(dt) {}             // no-op while paused (Mikrobe)
}

// AIAM is not an AI method: it sets the units' own stance.
//   World.setAggro(units, state)  →  for (const u of units) if (u.stance !== 3) u.stance = state;   // 0 | 1 | 2 | -1
```

### 13.2 Status in the remake (the port: `remake/src/game/ai/`)

| Gap (13.) | Status | Where |
|---|---|---|
| 1. attacks without a clock | **ported**: strategy think on `W + 20..39` ticks, the plan row by tribe / behaviour / epoch, the 11 % all-in, the difficulty 0-1 rule of epoch 1, the fight module's gate (3 attacks, no doubles, none while defending), squads, strength check, 20 minute limit, reinforcements, no retreat. Different: an all-in waits for four units in every epoch (two / three at difficulty 0 / 1; the scripts send single units in epoch 1 and whenever the strength check passes); squads form at the guard point and march together; survivors walk home; an attack without progress for 90 s, or whose squad is dead while reinforcements are still walking, is called off | `attack.js` |
| 2. army composition | **ported**: the MOD rule over `unitMix`; squads from `armies`; melee / ranged swap by the targets. Tribes without tables: mixes and squads derived from the tech tree | `army.js`, `attack.js` |
| 3. difficulty 0-9 | **ported**: think waits, gifts, gather ×, build time ×, pyramid and population bonus, weapon cycle ×, fight factors, free epoch catch-up. Not: units spawned for late squads at difficulty 9 | `brain.js`, `Player.aiMods` in the systems |
| 4. defence | **approximated**: alarm where enemies stand near own buildings, defenders by threat (not the whole pool), workers take cover (bunkers / entrench / run) when an attacker is near them, workers fight when there are no fighters (the scripts' unused `CheckForWorkerSupport`), guard point, towers for uncovered buildings and new stone sites; units that shoot at the village from beyond the alarm distance count as threats; squads still forming defend too. Not: walls, mines, calls for help | `defense.js` |
| 5. economy | **ported / approximated**: the build list with 5 requests, housing, storage, worker caps, list upgrades and heroes, hold at epoch 3+ below 10 non-worker units, hunting for food and skulls (`PickAnimalFood`, `GetScalps`) with the cheat manager's food as the fallback. The planner is one step of prerequisite resolution with a running resource reserve; workers are spread by what the requests need and moved over when a resource runs short. Added against deadlocks (not in the scripts): extra food buildings when the food places are full, cheat food for a village without workers | `economy.js` |
| 6. campaign control | **ported**: §13.1 | `brain.js`, `attack.js`, `defense.js` |
| 7. water, outposts, trade | landing of scripted waves, harbour + fishing boats, warships from the list. Not: transports for own squads, ship attacks, outposts, trade route | |
| 8. unit handling | target order of 6.6, pest patrol, level-ups (Kindergarten + the mix's levels), special moves (500 HP rule), one scout, heroes from the list. Not: items, wall breaking with siege squads, trap detection, guerilla | |

Findings while porting (data and scripts):
- **Research time factor is dead code**: `Action.usl:354` looks for `"Actions/Upgrades/"` in the action path, but paths
  are `/Actions/<Tribe>/Upgrades/...`; so the "build" factor applies to research too. The port uses the build factor.
- `UnitsEasy / Medium / Hard.txt` and `<Behaviour><Class>.txt` are never loaded / do not exist (§2, §4.6).
- List entries `BLDG/hu_medium_animal_farm`, `BLDG/hu_large_animal_farm`, `aje_animal_defense_upgrade_1..3` name
  objects the tech tree does not have (the large farm is mapped to the upgrade `hu_big_animal_farm`, the others are
  skipped). `BLDG/hu_marketplace` is an upgrade at the warehouse. `CHTR/special_eusmilus` is an `ANML`.
- The Aje's second epoch costs 10 skulls and their epoch-1 mix is the velociraptor handler alone, made at a small
  farm that is not in the epoch-1 list of the Giraffe and Schnecke villages: the planner builds the farm for the
  unit, and the first skulls come from hunting (`skulls` attack) - both are engine-side and re-created in the port.
- A plain Aje farm offers no animal until one of its local modes is researched (list entries carry the mode as
  `ObjFlag`; for other requests the port finds the mode by trying each on a copy of the tree).
- `CheckForWorkerSupport` (GV:1142) and `ShouldRetreat` (GA:1370) are never called / commented out.
- `SpawnResources` (gifts) is engine code: whether it respects the storage cap is not visible; the port caps it.
- The control think gives skulls ("iron") only at difficulty 7-9 (the `Medium: iron 3` branch of `SpawnResources` is
  never reached by it); `GetScalps` adds 5 only at difficulty 9. An Aje village below 7 gets every skull by hunting.
- `PickAnimalFood` sends the workers to the food object themselves and asks the fight module for a `quick` attack
  only when its food map is empty around the village; when nothing is found it calls `SpawnResources("food", 10)`.
- `CheckNumFightingUnits` (BV:1388) counts every character, animal and vehicle whose class name has no `_worker`
  (collectors and carts count), not fighters.
- The pyramid attack's `CompareLevel` (PY:193) counts unit levels only - no buildings, no towers, no workers -
  and is skipped in epoch 1; with `m_iShouldHave` units (2 at difficulty 0 … 10 at 8-9) the attack leaves whatever
  the enemy has. A Medium village therefore throws its whole pool at the enemy as soon as six units stand in it.
- The SEAS list names one greenhouse (two places), the Hu and Ninigi lists three fields, the Aje list one
  slaughterhouse from epoch 3: the villages are meant to live on the gifts (200 food a minute at difficulty 3-5).
