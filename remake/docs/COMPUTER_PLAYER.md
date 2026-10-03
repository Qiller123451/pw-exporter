# The computer player

`src/game/ai/` is a port of ParaWorld's script AI (`Data/Base/Scripts/Ai`, about 56 000 lines of script plus an
engine-side planner). The study of the original is [spec/ai.md](spec/ai.md); this file says how the remake's AI maps
onto it, which numbers it uses and what is approximated.

## Files

| File | Original | Does |
|---|---|---|
| `ai/brain.js` | `AiModuleControlDefault`, `AiImprovementMgr` (cheat manager) | `TribeAI`: think timers, difficulty and its handicaps, gifts, behaviours, module commands, unit locks, region maps, the census |
| `ai/data.js` | the settings files and the tables inside the scripts | lookups into `ai.json` (pipeline step `ai`) with a built-in fallback for every table |
| `ai/economy.js` | `AiModuleEconomyDefault`, `AiGoalBuildVillage`, `AiGoalCollectResources`, the engine planner | build list, realising requests, workers, gathering, housing, storage, repair, hunting, fishing, placement |
| `ai/army.js` | `AiGoalMinistryOfDefense`, `AiGoalKindergarten`, special moves of `AiTaskAttackObject` | the standing army by unit mix, level-ups, special moves |
| `ai/attack.js` | `AiGoalDisturbAttack`, `AiModuleFightDefault`, the attack goals, `AiTaskBuildSquad`, `AiTaskAttackObject`, `AiGoalSingleplayerAttack` | the strategist, `Attack` objects (squad → gather → walk → fight), scripted waves, landings, pest patrol, scout |
| `ai/defense.js` | `AiModuleDefenseDefault`, `AiGoalDefendOutpost`, `AiGoalGuardVillage`, `AiGoalDefendMode`, `AiGoalBuildTowers` | danger detection, defenders, worker cover, militia, guard point, towers, defence areas |
| `ai.js` | | keeps `import { TribeAI } from './game/ai.js'` working |

## How it plays

- **One tick is 0.2 s**; every module thinks on its own timer whose length depends on the difficulty's wait `W`
  (100 ticks at difficulty 0, 25 at 4, 10 at 9): the strategist every `W + 20..39` ticks, the build list is
  re-read every `6 × W` ticks, idle workers are picked up at once.
- **Personalities** (`behaviour`): *Dodo* attacks from the first minute with whatever it has and keeps nothing
  back; *Giraffe* starts in epoch 2; *Schnecke* in epoch 4; *Turtle* builds and defends but never attacks;
  *FightOnly* has no economy; *Mikrobe* sleeps (every campaign player starts like that). A skirmish opponent gets
  Dodo, Giraffe or Schnecke at random, as the original's "random" AI slot does.
- **No clock.** A strategy think takes the plan entry of its tribe, personality and epoch (e.g. Hu Dodo on a
  skirmish map: all-in, ranged squad, melee squad, ranged, melee), with an 11 % chance of an all-in instead.
  `suicide` and `violence` are swapped by what the enemy has (mostly ranged targets → the ranged army). The named
  squad is taken from the pool and trained (60-100 s limit), pool units join (1-5 on Easy, 2-12 on Medium, 3-20
  on Hard; a Giraffe sends half of its pool at most, a Schnecke a tenth), and the attack only leaves when its level
  score is at least `strength × the enemy's` (0.20 at difficulty 0 … 0.65 at 9). Up to three attacks run at once,
  none is started while the village is under attack, an attack ends after 20 minutes, there is no retreat:
  survivors return to the pool when nothing is left to attack.
- **Army.** One unit at a time is trained for the pool: pyramid levels in turn, inside a level the group of the
  tribe's unit mix whose share is furthest below its weight; 6 / 5 / 3 / 1 / 0 pyramid slots per level stay free
  for squads; at most 5 units per level in epoch 1.
- **Economy.** The first five unsatisfied entries of the build list are worked on at once; a request that cannot be
  paid yet reserves its cost (one that waits for skulls reserves only those); the epoch upgrade is just an entry of
  the list. Workers: one more whenever all are busy, up to 10-15 by difficulty class and epoch; the next worker's
  food is kept back from the army. Housing goes first at the population limit; nothing from the list is built at
  epoch 3+ while the village has fewer than 10 units that are not workers (skirmish).
- **Food and skulls.** When the bushes around the village are gone the workers hunt a harmless animal nearby
  themselves; otherwise a few fighters go for the nearest herd and the workers take the carcass (the scripts'
  `PickAnimalFood`). Skulls a request needs (the Aje pay for their epochs with them, heroes cost them) are hunted
  the same way (`GetScalps`): peaceful herds first, then neutral animals, then predators, nearest first, never
  next to or behind an Allosaurus. With nothing to hunt the cheat manager's food (5 / 20 / 10 by class) is given,
  as in the scripts.
- **Defence.** An enemy near a building or a worker of the village raises the alarm; defenders go by need (level
  score ≥ 1.5 × the attackers' + 2); workers near an attacker take cover (Hu: bunkers, Ninigi: dig in, others run
  to the main building) and return when it is gone; with no fighters at all the workers near a raider gang up on
  it. Wild animals raise no alarm unless they attack, and then at most two fighters go (none if the village has
  fewer than seven).

## Difficulty

Skirmish menu: **easy = 1, normal = 4, hard = 8** (the campaign's default slot difficulties; the original's lobby
has a 0-9 list per AI slot). Campaign maps pass their own value. `ai.json` → `difficulty.levels`:

| d | class | think wait `W` | gift per control think (skirmish) | attack strength | gather × | build / research time × | extra pyramid slots (+ population) | weapon cycle × | max workers by epoch |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Easy | 100 | - | 0.20 | 1 | 1 | - | 1 | 10 … 14 |
| 1 | Easy | 75 | - | 0.25 | 1 | 1 | - | 1 | 10 … 14 |
| 2 | Easy | 50 | 5 food, 5 wood | 0.30 | 1 | 1 | - | 1 | 10 … 14 |
| 3 | Medium | 30 | 20 food / wood / stone | 0.35 | 1 | 1 | - | 1 | 13, 14, 15 |
| 4 | Medium | 25 | 20 / 20 / 20 | 0.40 | 1 | 1 | - | 1 | 13, 14, 15 |
| 5 | Medium | 20 | 20 / 20 / 20 | 0.45 | 1.25 | 0.95 | - | 1 | 13, 14, 15 |
| 6 | Hard | 16 | 5 / 5 / 2 | 0.50 | 1.5 | 0.9 | - | 1 | 15 |
| 7 | Hard | 14 | 7 / 7 / 2, 1 skull | 0.55 | 1.75 | 0.8 | 2, 1, 1 (+4) | 1 | 15 |
| 8 | Hard | 12 | 10 / 10 / 5, 1 skull | 0.60 | 2.0 | 0.75 | 5, 3, 2 (+10) | 0.95 | 15 |
| 9 | Hard | 10 | 50 / 50 / 20, 5 skulls | 0.65 | 2.5 | 0.5 | 10, 10, 7, 1 (+28) | 0.9 | 15 |

- A control think comes every `max(W, 20) + 1..7` ticks (about every 5 s from difficulty 4 up). On campaign maps the
  gift is the script's number + 10 per resource. Easy also means: no level-ups, no heroes, no special upgrades.
- From difficulty 5 the damage the AI's units deal and take is scaled by "fight factors" that depend on map size
  and personality (at 9 on a large map a Dodo takes ×0.85, a Schnecke deals ×1.16); from 6 an AI that is an epoch
  behind a human enemy gets its next epoch for free (skirmish).
- In the first epoch of a skirmish, difficulty 0 and 1 replace the plan's attack by a small raid (`blitz`: a squad
  of 1-4 plus 1-2 pool units) on every sixth strategy think only: the first cannot leave before about two minutes
  at difficulty 1 (and needs its squad built first). From difficulty 2 a Dodo's epoch-1 "pyramid" has no minimum in
  the original (it sends single units from the first unit on), and in the later epochs one unit may go whenever
  the strength check passes (a weak enemy); the remake waits until four are there (two / three at difficulty
  0 / 1) in every epoch, so the first raid of a Dodo on *normal* sets out at about 1:15-1:40 with four level-1
  units and is repeated whenever four are together again, and the units trained after an all-in do not follow it
  one by one.
- The handicaps live on the `Player` (`player.aiMods = { gather, buildTime, researchTime, weaponTime, attack,
  defense, pyramid, unitLimit }`) and are read by the systems (economy `gain`, production `productionTime` /
  `pyramidFor`, construction, combat `attackDuration` / `takeDmg`).

## Interface (campaign triggers)

```js
new TribeAI(G, player, { difficulty = 5, behaviour = 'Mikrobe', mapOptions = {}, multimap = false, levelName })
new TribeAI(G, player, enemyPlayer, 'easy' | 'normal' | 'hard' | 0..9)   // skirmish: multimap, random personality
brain.setBehaviour(name, module = 'CTRL')     // AIBV; module ECON | FGHT | DFNS | AREA: a module command string
brain.setDifficulty(d)
brain.startAttack({ type, targets, position, attackOnTheWay, spawn, spawnPosition, ignoreLocations, targetOnly, ship, shipLand, behaviour })   // AIFT custom → id | null
brain.startAutoAttack({ targets, use })       // AIFT custom_attack = 0 → id | null
brain.setDefenceArea(id, { x, z }, radius, maxUnits)      // AIDA; maxUnits <= 0 removes it
brain.lockUnits(units, lock = true)           // AILU
brain.setRegionMap(mapName, region, value, add = true);  brain.regionValue(mapName, x, z)     // AIRG
brain.callModule(module, command)             // AICM
brain.update(dt)                              // nothing while paused (Mikrobe) - except running scripted waves
world.setAggro(units, state)                  // AIAM: 0 stand ground, 1 defensive (20 m), 2 aggressive, -1 passive
```
Positions are game coordinates `{x, z}`. `mapOptions`: `{ walls, markplace_outpost, harbour, warpgate,
hunt_animals, watermap }` (the map's AI options). `levelName` ('Single 04' ...) selects the level-specific rows
of the attack plan. `brain.launched` lists every attack that set out (`{ t, go, type, n, scripted, hunt, result }`),
`brain.attacks` the running ones. Test switches in the URL: `?aib=Dodo,Giraffe` (personality by player id),
`?aid=4` (difficulty), `?noaidata` (play on the built-in fallbacks).

## Approximated or not done

- **The planner** (engine code in the original) is one step of prerequisite resolution per think - a request whose
  building, farm mode or research is missing asks for that first - and a running resource reserve. Idle workers go
  to the resource the pending requests are shortest of (the original's planner locks workers per need; its fallback
  order stone, wood, food is used between equal needs), and every three seconds one gatherer changes over when a
  resource is short while another has more gatherers than its share (the original's workers fall back to the idle
  list whenever a tree or bush is used up; the remake's walk on to the next tree by themselves).
- **Anti-deadlock rules that are not in the scripts** (their villages live on the gifts, which difficulty 0 and 1
  do not get): one more field / greenhouse / slaughterhouse on top of the list when nothing is left to eat or all
  field places are taken while food is short (up to eight places); the standing army ignores the reserve only while
  it has fewer than 3 + epoch fighters or the village is under attack; a village with fewer than three workers
  that cannot pay a worker gets the cheat manager's food; when the main building is gone the worker action is
  taken from any other building that has it, or that building is asked for.
- **Squad sizes**: the tables give `min-max` per class and the engine picks; the remake takes
  `min + (max - min) × share(d)` (0 at difficulty 0, a third at 4, all at 9). Tribes whose settings folder is
  missing from the installation get unit mixes and squads derived from the tech tree.
- **Defence** is proportional instead of "everybody"; workers take cover one by one; the militia is the scripts'
  unused `CheckForWorkerSupport`. Towers are limited to 1 + epoch. Units of a squad that is still being put
  together defend the village too.
- **Attacks**: the squad forms at the guard point and marches together (whoever is more than 35 m ahead of the last
  one waits); survivors of an attack that is over walk back to the guard point; an attack that makes no progress
  for 90 s is called off, and so is one whose squad is dead while its reinforcements are still on their way.
- **Gifts** fill the stores but do not overflow them (the original call is engine code).
- **Hunting**: the scripts search their animal maps in rings around the start location; the remake ranks the
  animals within 170 m (food) / 220 m (skulls) by kind and distance and sizes the party by the animal (one or two
  for a peaceful one, hit points / 150 otherwise; nothing above 400 / 1000 hit points before / from epoch 3 for
  skulls). Hunters walk and attack their prey only (an attack-move would take on everything they pass).
- **Velociraptor handlers** have no raptors in the remake yet, so the Aje train spearmen in their place.
- **Not built / not done**: walls, mines, outposts, trade routes, ship attacks and transports for the AI's own
  squads, guerilla raids, trap detection, item pick-up, flank way points of the ranged army, calls for help,
  Defender and King of the Hill modes, point-buy presets, units spawned for late squads at difficulty 9.
  `RessourceOutpost` / `AttackOutpost` waves return null; `Item_Attack` runs as an ordinary wave.

## Measured (default skirmish map, 640 m, `tests/ai_match.js` and `_notes/tools/human.js`)

What a player who does nothing sees (opponent alone, 14 minutes; time of the first squad at the player's village,
its size, how far its units are apart on arrival):

| Opponent | easy (1) | normal (4) | hard (8) |
|---|---|---|---|
| Aje Dodo | 4:46, 2 units (a `blitz`), 11 m | 3:14, 4 + 4 + 4 units within a minute, 2-28 m | 3:06, three squads of 4 within 15 s |
| Hu Dodo | 13:17, 7 units, 6 m | 3:32, 3 units, 4 m | 3:20, three squads of 4 |
| Ninigi Dodo | 10:41, 6 + 2 units | 4:30, 4 units, then 4 more twice | 3:44, two squads of 4; 20 more set out at 8:38 |
| Hu / Ninigi Giraffe | 10:29 (4) / 12:39 (7) | 5:50 (10) / 11:07 (9) | 4:50 (10) / 5:36 (13) |
| SEAS Schnecke | none in 14 minutes | 13:47, 10 units | 13:55, 11 + 11 units |

Computer against computer, normal (difficulty 4), 30 minutes; `n@m:ss` = epoch reached at:

| Side | Epochs | Workers / army at 10 min | Peak army | Attacks of its plan (first) | Kills / lost | End |
|---|---|---|---|---|---|---|
| Hu Giraffe | 2@3:20 3@8:55 4@17:19 5@25:59 | 15 / 8 | 17 | 10 (4:20 all-in × 12) | 115 / 101 | undecided |
| Aje Dodo | 2@3:10 3@15:29 4@23:24 | 10 / 13 | 16 | 5 (1:36 all-in × 4) | 128 / 113 | |
| Aje Giraffe | 2@3:20 3@10:04 | 14 / 7 | 24 | 3 (3:54 all-in × 7) | 74 / 161 | losing (3 fighters left) |
| Ninigi Dodo | 2@4:25 3@10:44 4@17:39 5@25:09 | 14 / 11 | 22 | 8 (1:25 all-in × 5) | 172 / 65 | |
| Ninigi Giraffe | 2@4:25 3@12:54 4@22:29 | 14 / 4 | 20 | 5 (6:38 all-in × 4) | 91 / 159 | losing |
| SEAS Dodo | 2@3:25 3@7:10 4@23:24 | 15 / 10 | 13 | 12 (1:52 all-in × 5) | 171 / 88 | |
| SEAS Giraffe | 2@3:15 3@7:05 4@12:19 5@17:29 | 15 / 16 | 21 | 3 (10:06 melee squad × 12) | 111 / 14 | wins at 21:19 |
| Hu Dodo | 2@3:55 3@9:55 | 14 / 11 | 12 | 5 (1:33 all-in × 4) | 28 / 92 | |
| Hu Schnecke | 2@3:10 3@8:35 4@14:49 5@20:49 | 15 / 11 | 18 | 5 (14:58 all-in × 7) | 58 / 65 | undecided |
| Aje Turtle | 2@3:30 3@10:00 4@20:54 | 14 / 9 | 15 | 0 | 94 / 50 | |

A Giraffe at difficulty 1 / 4 / 8 against a Schnecke at 4 (30 minutes; these runs predate the last two changes -
the march rule for units that do not come along and the cache of farm modes; Hu 1 and 8 and Aje 8 were run again
afterwards with the same picture):

| Tribe | easy (1) | normal (4) | hard (8) |
|---|---|---|---|
| Hu | 2@7:10 3@17:14, peak army 12, defeated at 28:14 | 2@3:35 3@8:05 4@15:59 5@20:39, peak 26, undecided | 2@3:40 3@7:15 4@13:09 5@18:14, peak 36, wins at 28:39 |
| SEAS | 2@5:30 3@14:34, peak 11, one attack (17:56) | 2@3:10 3@7:10 4@11:44 5@17:34, peak 24, ahead (181 / 75 kills) | 2@3:15 3@6:10 4@8:50 5@13:19, peak 31, wins at 22:34 |
| Aje | 2@5:10, peak 9, defeated at 24:14 | 2@3:05 3@9:35 4@20:04, peak 24, losing | 2@2:45 3@7:35 4@12:09 5@20:29, peak 34, undecided (ahead in the rerun: 196 / 102 kills) |
| Ninigi | 2@8:15, peak 10, no attack, lost (1 unit left) | 2@4:15 3@10:59 4@18:54, peak 16, lost (1 unit left) | 2@3:45 3@8:40 4@14:09 5@20:44, peak 25, undecided |

- Hard reaches epoch 2 no sooner than normal: on skirmish maps the gift of the Hard class (10 / 10 / 5) is smaller
  than Medium's (20 each) and `age_2` is exempt from the time factor; from epoch 3 on it is clearly ahead.
- Almost every attack between two computer players at the same level ends with the squad dead: the strength check
  lets a squad go at 40 % of the enemy's unit levels (and an all-in with six units whatever the enemy has), towers
  and buildings are not counted, and the defender trains at home. That is the original's rule; the villages are
  worn down over time, not taken by one squad.
- Without `ai.json` (`?noaidata`): Hu Giraffe 2@3:00 3@7:40 4@15:59, Aje Dodo 2@4:25 3@10:54, no errors.
- Think cost: 0.4-0.9 ms per game second and brain (Aje at difficulty 8: 1.6) with 100-140 units on the map; the
  first search for an Aje farm mode costs a single step of 60-300 ms (once per farm class and unit).

## Tests

`tests/ai_match.js` (AI against AI, timelines), `tests/ai_defence.js`, `tests/ai_campaign.js`; all three are in
`tests/regress.sh`. In `?manual` mode nothing draws, so long matches call `G.fx.update` themselves.
