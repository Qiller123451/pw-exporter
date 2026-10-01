# Unit behaviours (non-combat-formula): Hu, Aje, Ninigi, SEAS and heroes

This spec is taken from the original server scripts. Unless noted, the paths are relative to `Data/Base/Scripts/Server/classes/`.

- `FO` = `FightingObj/FightingObj.usl`
- `CH` = `character/character.usl`
- `TO` = `FightingObj/TransportObj/TransportObj.usl`
- `AN` = `animals/Animal.usl`
- `BU` = `misc/BuildUpBase.usl`

BoosterPack1 overrides no `.usl` behaviour. It only adds classes such as `hu_avatar` (a `CHu`), BP1 wild animals, and a tech tree, so numbers may differ there.

Tech-tree values come from `/home/claude/pwr/techtree.json`. This spec complements `claude/rules_spec.md` (the combat formula, economy, and pyramid basics) and corrects it where noted.

Conventions:
- **Level:** "level" means the internal index 0..4, which is pyramid row L1..L5.
- **Distances:** in metres.
- **Timers:** jitter "×J" means ×U(0.9, 1.1), taken from `0.9 + MTRandF(0.2)`.
- **Uncertainty:** `[?]` marks points that are uncertain or engine-side (C++, not in the scripts).

---

## 1. Stances, auto-attack and idle

### 1.1 Aggression states (`m_iAggressionState`, FO:1058, 7084-7101)

| val | UI | Auto-acquire targets | Defend when hit | Answer "attack" help calls | Chase on auto-fight | Notes |
|---|---|---|---|---|---|---|
| 0 | stance_0 "stand ground" | yes, but `InvokeFightTask` drops any target not already in combat range (FO:6438-6445) | only if in range | yes | **no** (FO:5964) | |
| 1 | stance_1 "defensive" | **no** (the scan runs with fill=false, FO:2488/2500, CH:1111) | yes (`AddEnemy(defend=true)`, FO:4622) | only "defend" calls (FO:6706) | yes, leashed | Default for every class name containing `worker` (CH:609-613) |
| 2 | stance_2 "aggressive" | yes | yes | yes | yes, leashed (§1.4) | Default for everything else |
| 3 | (none) | no | **no** (`AddEnemy` is skipped, FO:4622) | no | – | Only `aje_poisoner` (FO:2781). It is sticky, because `SetAggressionState` ignores all changes once the state is 3 (FO:7095) |
| -1 | (none) | no | no (`OnDefend` returns, FO:4608) | no | – | Deco animals |

Rules:
- `GetAggressionState()` returns 1 for anything with `damage==0` (FO:7085). `IsAbleToFight` = `GetDmg()>0` (FO:6384).
- UI command `Action "/AggroState_N"` (N=0..2) sets the state. The berserker ignores it (FO:8696-8701).
- On a transporter the state is propagated to all passengers and weapon build-ups (TO:781-798).
- Wild animals are forced to 2 (AN:112-113).
- `ninigi_ninja` with `disguise` invented is set to 1 but is then overwritten to 2 by the worker/else branch (CH:605-613). Treat it as 2.

### 1.2 Ranges (FO:7126-7148)

- `attackRange = weaponRange + r`. Here r = 2.0 for CHTR and `GetRadius()` for other types, but r = 0 if the weapon shoots projectiles. Temporary range bonuses are added on top.
- `alarmRange = clamp(attackRange + 8, 32, FOWRange)`. It is recomputed whenever the attack range is set.
- The scan (FO:4939-5007) builds two lists:
  - The **direct list** holds enemies within `max(attackRange, 30)`.
  - The **alarm list** holds enemies within `alarmRange`.
  - For projectile units both lists are cones built with `CopySortedCone`, using the projectile fall-off. For others it is a 2-D circle.
  - `darwin_s0` removes wild ANML from both lists.

### 1.3 Scan pipeline (timers)

```
OnInit: UpdateAggressive()                           FO:6772
  if TT(aggressive)==1: repeat PREAGGRO every 7s×J  (all player units have aggressive=1)
  if owner==-1: SetAggressive(true)
PREAGGRO tick -> PreCheckForEnemies()                FO:4630
  R = max(alarmRange, attackRange) + 50
  if an enemy is within R: start AGGRO (repeat 3s×J), unless on a closed transporter (FO:6803-6811)
  else: delete AGGRO
  if no enemy is within FOWRange: SetAlarmed(false)
AGGRO tick -> ExamineEnemies(alarm=false, fill = state∉{1,-1,3})   FO:2487
Idle (CH:1104-1123): after a Fight ends, each idle tick has a 1/4 chance to run
  ExamineEnemies(false, fill = state∉{1,-1}).
```

`ExamineEnemies` (FO:4679-4782):
1. Candidates = direct list ∪ `m_xPotEnemies` (units that attacked me or were reported by help calls) ∪ current enemy ∪ the `OptimalTarget` attrib.
2. If there are no candidates and the alarm list is non-empty, call `SetAlarmed(true, first)` and stop.
   - Alarmed: if idle, run the `Alarmed` task: turn to face the target if the angle is > 22.5°, then play `GetThreatAnim()`.
     - Characters use `jans_anim_{0..2}` (random).
     - Others use `menace`.
     - A Baryonyx in water plays nothing.
   - Start `TIMER_ALARM` (10 s, one-shot). When it fires and the unit is not in `Fight`, it re-scans with alarm=true (FO:6828-6857, 2498-2501). No threat task is started on a closed transporter (CH:740).
3. `SortEnemyList` (FO:4785) filters, then sorts ascending by `value` (FO:740-798):
   - **Skipped targets:**
     - marked for delete, unhittable, vanished, or own-owner
     - Aje-camouflaged (unless it is the current enemy)
     - **walls, unless it is the current enemy** (or on the priority list)
     - invisible to my owner, or not a diplomatic enemy
   - **Wild targets (owner -1):**
     - Skipped unless their tech-tree `aggressive==1` or they attacked me.
     - Skipped if my Aggression-walk has the `AggrTNoAnml` flag set.
   - **Leash filter:** skipped if `|aggrPos − enemy|² > (2·alarm + attackRange)²`. It isn't applied when I am a wild animal, on an aggression walk, or the target is on the priority list.
   - **Swimming melee and torpedo units** (`seas_submarine`, `ninigi_muraeno_submarine`) skip land targets above sea+1.7. For torpedo units the limit is sea−0.5. Harbours are always allowed.
   - `value = (prio?0:100000) + type·10000 + (inPrioList?0:1000) + (inRange&&isCurrent?0:500) + originalIndex`.
     - For normal attackers, type is: unit (CHTR/ANML/VHCL/SHIP/FIGHT)=0, tower=1, building=2, wall=3, other=99.
     - For `attackType==1` ("siege"), type is: tower=0, building=1, wall=2, units=3.
   - If the unit has a min range, targets inside it are moved to the end of the list. They are kept only if the unit has a secondary `_s`/`_m` weapon (FO:4890-4924).
4. **Target switch hysteresis:** if I already fight X, the best target is not X, and it is not in combat range, wait until the same condition has held for 2 s (FO:4747-4766).
5. `OnAttack(target)` → `OnDefend` → `Action "/AttackSrv"` → `Fight(target, pos, user=false)`.

**Attack type 1 units** (`SetAttackType(1)`):
- `aje_rammer`, `ninigi_mortar` (CH:614)
- `hu_steam_ram` (Vehicle.usl:130)
- `ninigi_firecannon` (Vehicle.usl:239)
- `hu_steam_boat` (Ship.usl:856), `aje_catamaran` (Ship.usl:873), `ninigi_rocket_boat` (Ship.usl:1137)
- `hu_mammoth_log_cannon` (AN:2411)
- `aje_brachiosaurus` catapult build-up (AN:1808). The Ankylosaurus *without* its catapult is also type 1 (AN:1537); the catapult resets it to 0 (AN:1582).

This is a **priority only**: rams still attack units when no building is available. The scripts contain no hard "buildings only" rule `[?]`. A target filter may still exist in weapon data.

### 1.4 Automatic fights: accept, chase and leash

`Fight(target, pos, user)` (FO:6498):
- **Berserker:** a fight against a "berserk target" (anything except BLDG, wild ANML and NEST, FO:6487) is promoted to a user command. The berserker ignores all other orders except Kill and LevelUp (CH:1869-1872).
- A non-user fight never replaces a running user task (FO:6521).
- If the target is feigning death, a non-user fight is dropped.
- A passenger on a **closed** transporter forwards the order to its transporter. If the transporter is itself inside another transporter, the order is dropped (FO:6556-6570).
- Attacking a friend is refused in single player. In multiplayer it switches both players to enemies (FO:6594-6619).

`FollowEnemy` for a **non-user** task (FO:5953-6117):
- `aggrRange = 2·alarmRange + attackRange`.
- State ≤ 0: no movement.
- State 1 or 2:
  - If the enemy is farther than `aggrRange` from `m_vAggressionPos`, walk back to aggrPos at `defaultspeed` and give up.
  - If the enemy is more than `aggrRange−2` from me, give up.
  - Otherwise advance with `maxspeed`, `m_fMaxRange=aggrRange` and root = aggrPos.
- On an aggression walk (A-move or patrol): advance without a leash.
- **User-commanded** fights advance without a leash, at max speed, using the `first_strike_0` anim if present (CH:548).

`m_vAggressionPos` is the anchor. It is updated:
- by every GoTo target, SetPos, stop, board and unboard
- at the end of a repair or a special task (`UpdateAggressionPos`)
- for wild animals, at the enemy position while they are chasing (AN:152-157)

### 1.5 Help calls (FO:6641-6722, 2563-2572)

`ShoutForHelp(forced)` is triggered in three ways:
- **At a non-user fight start:** forced (Fight.usl:217).
- **On each non-user hit cycle:** not forced (Fight.usl:329).
- **When a unit that cannot fight takes damage** (FO:4510).

Rules:
- **Rate limit:** 7 s between shouts, or 3 s while hurt, unless forced.
- **No shout** if my current task is a user command.
- **Recipients:**
  - own CHTR, VHCL and ANML within `1.1·alarmRange`, plus SHIP if the enemy is a ship
  - for SEAS, own `seas_carrier` buildings
  - for wild animals, the same class only
- Payload: the enemy (the first "defend" enemy if there is one, else the first attacked enemy, else the current enemy) and a `defend` flag.
- **A recipient is skipped** if any of these holds:
  - it is already shouting
  - it cannot fight
  - it is busy with a user task
  - the call is not "defend" and the recipient's state is 1
- **The recipient's own filter** ignores the call if:
  - its state is -1 or 3
  - the enemy is its own
  - it is camouflaged
  - its class contains `_worker`
- **Accepted calls:** after 0.1 s the recipient calls `AddEnemy(enemy, defend)`. If it is a healer with someone to heal, it heals instead (FO:2526-2540).

### 1.6 Reaction to being hit (FO:4324-4514, 4040-4109)

- **Passengers are immune:** a CHTR with a valid transport object takes **0 damage** (FO:4056). Attacks on a rider or passenger are redirected by the Fight task to the outermost transporter (Fight.usl:354-361).
- **The hit is registered** unless the victim is fleeing: `AddEnemy(attacker, defend=true)`. The pre-aggro timer is promoted to aggro, and the victim auto-fights back unless its state is 3 or -1.
  - Character special case (CH:2635): during the first 2 s of idle after a `Walk2Pos`, a non-berserker ignores hits from non-berserk targets (buildings, wild animals, nests), unless it is on an aggression walk.
- **Other effects of a hit:**
  - It breaks Aje camouflage.
  - It makes an entrenched unit dig out (CH:2628).
  - It resets the Ninja/Muraeno disguise timer to 10 s.
  - It notifies the player (`IWasAttacked`).
- **Invulnerability:** damage is ignored while level-up invulnerable, in god mode, or while `TIMER_INVUL` runs.
- **Knockback** (size-class based) applies only to characters and animals that are not in a transport (FO:4392-4418).
- **Wall collapse:** a unit standing on a destroyed wall falls and takes `5·height` damage (CH:2166-2174).

### 1.7 Character idle loop (CH:1036-1168; the base is FO:2886)

```
enter idle: t0 = now, timer = -1
tick:
  if timer==-1: set idle anim (unless in a transport), timer = (lastTask=="Fight") ? 0 : 100
                if lastTask=="Walk2Pos": doNotDefend = !berserker
  if Aje-camouflaged: return
  if now-t0 > 2: attrib CurTask="Idle", doNotDefend=false
  timer==0 (post-fight):   with 1/4 chance per tick: if ExamineEnemies(...) -> return
                           else if idle < 4 s: play the victory anim, unless the unit is a worker or
                           in a transport: 25% "victory_{0..2}" (1-2 loops), else WaitAction(1)
                           after 4 s: timer=100
  timer==100: healers (heal radius>0): with 1/7 chance, if an injured friendly unit
              (CHTR/ANML/VHCL/SHIP, own or allied) is within 1.5·healRadius -> HealUnits task
  CheckPatrol():  (FO:2390)
    if there is no patrol and dist(pos, aggrPos) ≥ collisionRadius·sqrt(1.5): walk back to aggrPos (defaultspeed)
    with 1/50 chance per tick, if overlapping another unit, step 1 m in a random direction
```

- The trap/trace search states 1-3 exist but are unreachable, because nothing sets `timer=1` for characters.
- Owned animals and vehicles use the `TO:428` idle: CurTask/description only, plus `CheckPatrol`.
- After each finished action, the idle anim or the passenger loop anim `standanim` is restored (CH:560-592).

### 1.8 Workers

- **Stance:** they start in state 1, so they never auto-attack but do fight back. All four tribes' workers have a club weapon, e.g. `hu_club_a..e` 4/6/9/14/20.
- They never answer help calls (`_worker` filter) and never play victory anims.
- **Kills:** if a worker kills a **wild animal** during a *user* fight (not in a transport), it automatically starts `GetFood` on the `<class>_food` corpse within 50 m (Fight.usl:335-346, CH:1500-1509, 2190-2199).
- There are no flee rules for characters: `Flee` is only used by animals.
- `can_build=1` is also set for **all Aje military CHTR**, so they can build and repair.
- `can_harvest` is set only for workers, `hu_mammoth_lumber_upgrade`, `ninigi_harvester` and fishing boats.
- **Repair** (`task/Repair.usl`):
  - It works **only on buildings**: the cast fails for vehicles and the task ends at once (Repair.usl:110-115, 202).
  - Rate: `20 + 5·level` HP per second (Repair.usl:159-162).
  - Resource drain per tick: `max(round(cost/(buildDuration·TF·1.1)),1)`.
  - When a repair finishes, the worker looks for the next damaged own building within 50 m. On walls, it chains through damaged walls and gates within 50 m.
  - **No unit, vehicle or ship repair exists in the scripts.** Only healers (who also heal VHCL/SHIP) and the Hermit's animal heal can restore them.

---

## 2. Levels, skulls, pyramid, population

- **No XP.** `CharLevels.txt` XP_min/XP_max are all 0, and `CharXPGain.txt` is loaded (misc/Player.usl:103) but never read.
- **Levels are bought with skulls,** stored in the player attribute `iron` (RequirementsMgr.usl:534-536).
- **Kill reward:**
  - `scalps(victim) = round(TT scalps (default 5) · Mod("Skulls") + ModAbs)` (FO:4531).
  - The killer's player gets `round(scalps · scalpsModifier(=1.0))` (Player.usl:407-413), once per victim, and only if the last damager is not the owner (FO:3950-3968).
  - Wild and grown animals scale scalps by growth: `max(round(scalps·age/growup),1)` (AN:650-667).
- **Level-up** (`SetLevel`, FO:3412-3493). All of the following must hold:
  1. The target level is in 0..4.
  2. `count(own CHTR/ANML/VHCL/SHIP with level==target && unit_count) + virtual_units_target < max[target]`, where max = 25/15/8/3/1. Maps can override it with `PlayerSettings/Player_N/Restrictions/Chars/LevelK/Max`.
  3. Skulls ≥ Σ foodcost for each level step. The costs are **25, 50, 100, 300** (CharLevels `scalps`, Player.usl:90-101), and multi-step jumps sum them.
  4. Then `SetLevelClean` runs:
     - It swaps the `Filters/<Tribe>/Upgrades/<class>/Lvl<k>` filters (not cumulative: only the current level's `LvlN_Bonus` is active).
     - For non-heroes it swaps `AllNonHeroes/Lvl<k>`. At level 4 it enables `<class>/Chief_Bonus` on the player tree.
     - It sets inventory size 1 and `formation_x = 1 − level/5` (0 for `unique`).
  5. If the level went up: play the `level_up` anim, FullHeal, and reset the destruct level.
- **Invulnerability during level-up:** **2.5 s** for characters (CH:948-964; rules_spec's 1.5 s is the FightingObj base, FO:3533). There is no anim or invulnerability on walls, in closed transports, or while trapped. On an open transporter only the anim plays.
- **Start level of a produced unit** = `results/*/flags/level − 1` of the build action, falling back to `captainlevel − 1` (RequirementsMgr.usl:563-585, Action.usl:269-278).
- **Per-level tech-tree deltas:** e.g. Aje CHTR `unit_size` +1..+4 and `captainlevel` −k. `captainlevel` is irrelevant after spawning.
- **Population** (Player.usl:236-291, RequirementsMgr.usl:172-316):
  - `max_units = clamp(Σ UpdateLimits/max_units of own limit-objects, 0, PopMax)`, where PopMax = 52 or the map `Population/Max`.
  - **Houses:**
    - Hu: `hu_fireplace` 5, `hu_stone_cottage` 8
    - Aje: `aje_tent` 5, `aje_resource_collector` 6 (a mobile animal)
    - Ninigi: `ninigi_fireplace` 15
    - SEAS: `seas_headquarters` 30, `seas_barracks` 25, `seas_garage` 25
  - Queuing needs `units_all + Σvirtual < min(max_units, PopMax)`, and the level slot rule above.
  - **Count = number of objects** where `DoesCountInUnitLimit()` holds, whatever their size:
    - Buildings, illusions, `CKamikazeVelociraptor`, `CTrackerDino`, `CKennelEusmilus` and `CNinigiDilophosaurus` return false.
    - Water turret, torpedo turtle, water mine and the flying trader also return false.
  - **AI bonus** (difficulty 7/8/9): +2/+1/+1, +5/+3/+2 and +10/+10/+7/+1 slots on L1..L4, and +4/+10/+28 population.
- **No worker cap** exists beyond the L1 row (25) and population. `maxworkers` in the tech tree is a per-building worker slot count.

---

## 3. Heroes (`character/Hero.usl`, `misc/NPCMgr.usl`)

- **Classes:** all are `CHero`: `Cole_s0`, `Bela_s0`, `Stina_s0`, `tesla_s0`, `darwin_s0`, `babbage_s0`, `lovelace_s0`, `livingstone_s0`, `schliemann_s0`, `mayor_s0`, `hermit_s0`, `trader_s0`. `special_eusmilus` is handled like a hero (a unique `CEusmilus`).
- **Unique per player:** on creation (and on owner change) `CNPCMgr.AddNPC` fails if the player already owns that class, and the new object is **deleted immediately** (Hero.usl:64-66, 86-92, NPCMgr.usl:90-114).
- **Tavern production:**
  - Heroes are sold at taverns (e.g. `hu_tavern`: 250 food + 25 skulls, 45 s), spawning at level 0 (flags level 1).
  - While one hero is queued, `<hero>_RemoveMe` disables **all** tavern hero builds (see the `_RemoveMe` filters in the tech tree, and Action.usl:405-430).
  - `[?]` Whether the buttons return after completion depends on the engine: `ResetFilters` (Action.usl:217) runs on cancel.
- **Pyramid:** heroes are `unique=1`, so they sit in the formation centre (`formation_x=0`) but still count in the pyramid and population.
- **Owner-level auras** (`AddRangedBuff`, Hero.usl:299-322):
  - Cole → `owner_cole`, Bela → `owner_bela`, Tesla → faster build-up, Darwin → no animal aggro, Hermit → healing.
  - Lovelace → enemies attack slower, Babbage → more building damage, Stina, Schliemann and Livingstone each have their own.
  - The `RangeEffect` ability (e.g. Cole radius 20, disabled by default) enables filter `/Filters/Special/Upgrades/<hero>/RangeEffect` on friends (or on enemies if `OnEnemy`) inside a personal region.
  - Special cases:
    - **Darwin:** wild animals ignore units in range.
    - **Babbage:** +20% building damage.
    - **Livingstone:** "drain_life" on units in range, plus a 10 damage tick every 3 s on units in range (Hero.usl:9-14, 427-440).
    - **Schliemann:** Kleemann aura.
    - **Lovelace:** "slowhand".
- **Death:**
  - Every owned CHTR and ANML leaves a **spirit** when it dies, except illusions (FO:5554-5575). `CHero` and `special_eusmilus` leave one **only in multiplayer**, so in single player they cannot be revived.
  - **Revival:** `aje_shaman` `Resurrect` (cooldown 20 s, Resurrect.usl):
    1. Walk to within 20 m, then check range ≤ 22 + spirit radius.
    2. Lock the spirit, and reserve a virtual pyramid slot at the spirit's level (`CheckUnits`).
    3. Play `praying_wall` for the spirit's resurrect duration `[?engine]`, then wait 1.5 s.
    4. Recreate the unit with its level and all saved TT filters (minus `_RemoveMe`).
  - A hero is **not** revived if the player already has that class again (Resurrect.usl:340-341).
- **Specials:**
  - `hermit_s0` "Druid_HealAnml_0" (cooldown 180 s): fully heals every own ANML within 40 m (HealANML.usl:50-67).
  - `tesla_s0` "Tesla_DstrVhcl_0" (cooldown 40 s): walks to a VHCL, plays `potter`, and deals 999999 direct damage (DestroyVHCL.usl:53-66).
  - `Stina_s0` rides: SetPos and Delete are forwarded to its mount (Hero.usl:465-484).
  - `mayor_s0` always has warpaint radius 20 (CH:808-809).

---

## 4. Transports

### 4.1 Classes and capacity

`transportclass` attribute:
- **0** = not a transport.
- **1** = land transport. It accepts **CHTR only** (TO:1076).
- **2** = ships, `CHoverCraft` and `CTransportTurtle`. They accept CHTR, ANML and VHCL, but not other class-2 transports (TO:1079).

A unit can board only if `transportclass(target) > transportclass(self)` (FO:9069). Ships can never board (Ship.usl:316-321).

**Build-up types** (BU:105-113):
- `TRANSPORTER` (closed): passengers are hidden and linked with no link point.
- `TRANSPORTER_OPEN`: passengers stay visible on links `Dri0..Dri9`, filled in order and skipping ignored links such as `Dri1`, which the captain uses (BU:541-581).
- `WEAPON_TRANSPORTER`: closed, plus a turret.

| class | script class | max_passengers | build-up | notes |
|---|---|---|---|---|
| hu_chariot | CMegaloceros | 1 | open + captain archer (`hu_archer` weapons) | |
| hu_rhino_transporter | CWoolly_Rhino | 2 | open + captain archer | |
| hu_triceratops ("titan") | CTitanTriceratops | 4 | open + 2 auto ballista turrets (`hu_titan_ballista`) | |
| hu_steam_tank | CSteamTank | 10 | weapon transporter, auto ballista | class 1 |
| hu_transport_ship | CTransportShip | 10 | closed | class 2, cannot fight |
| aje_triceratops_archer | CTriceratops | 3 | open + captain `aje_archer` | |
| aje_brachiosaurus (transporter upgrade) | CBrachiosaurus | 4 | open + captain `aje_archer` | captainclass → `aje_archer` |
| aje_stegosaurus (transporter upgrade) | CStegosaurus | 4 | open + captain archer on `Dri5` | |
| aje_transport_turtle | CTransportTurtle | 10 | closed, amphibious | class 2 |
| ninigi_saltasaurus_archer | CSaltasaurus | 3 | open + captain `ninigi_archer` | |
| ninigi_siegetower | CSiegeTower | 5 | closed | class 1; docks to walls |
| ninigi_transport_boat | CTransportShip | 10 | closed | class 2 |
| seas_triceratops_transporter | CTriceratops | 3 | open + captain `seas_marksman` | |
| seas_hovercraft | CHoverCraft | 10 | closed | class 2; walks and swims; cannot fight |

- **Seat accounting** (TO:681-711):
  - `NumPassengers = passengers + pending + blocked + pendingBlocked`.
  - A transporter used as a passenger needs `1 + its own passengers` seats (TO:1121).
  - Reducing `max_passengers`, e.g. by removing an upgrade, ejects the surplus (TO:1152-1174).

### 4.2 Boarding (FightingObj:9044, task/BoardTransport.usl, misc/BoardingMgr.usl)

- **Board order:** requires same owner, a valid class relation, `NumFreeSeats ≥ NeededSpace` and not already inside a transport. Otherwise the unit just walks to the clicked position.
- A character targeting a **docked** brachio climbs it instead (CH:351-358).
- **`BoardingMgr`** ticks every 0.5 s with one coordinator per transporter:
  - **Land:** the meeting point = the transporter's current position. The transporter gets task `BoardTra` (user) and stops.
  - **Ship:** the meeting point = pathfinder `GetShipBoardingPos`. For amphibians it is `GetAmphibianBoardingPos`.
  - The transporter moves to the free position nearest the meeting point, and is "arrived" within its radius + 5 (at max speed).
  - Each passenger walks at max speed until it is within `2·(rPassenger + rTransporter)` (2-D) of the meeting point.
  - When both have arrived: `/AddPassenger` → `OnMount`.
  - If there are no passengers left, or the transporter disappears, the tasks break. Pathfinding failure aborts.

### 4.3 Unboarding and death

- **`/DismountAll`, or `PrepareUnboard(pos)`** for ships (UnboardShip.usl:59-128):
  1. The ship moves to the nearest shore boarding position. For land transporters and amphibians it moves to pos directly.
  2. It retries up to 5 times.
  3. Unloading is allowed only if the meeting point is within **30 m** (`m_fMaxPassengerDropRadius`). Otherwise the feedback is `_NT_TransportUnboardAtShore` or `…TooFarFromShore`.
- **Land dismount check:** `IsFreePoint(transporterPos)` `[?]` (probably true unless the terrain blocks it).
- **Placing units:**
  - Each unit goes to `GetFreePos` within 10 m of the drop point.
  - If the final target is more than 10 m away (`m_fPassengerSpreadRadius`), the group walks there. Otherwise each unit walks to a random land point ±7 m around the drop point with z > sea+1 (50 tries), at max speed (TO:976-1005, 1200-1237, 1473-1493).
- **Transporter death** (TO:1519-1533):
  - All passengers are dismounted where possible. Failed entries are dropped from the list `[?]`, which leaves them in limbo, so the remake should place them.
  - The captain object is deleted.
  - **Ships** (Ship.usl:248-271) and a **hovercraft in water** (Vehicle.usl:267-290) try `DismountAll`. Every passenger still aboard dies silently (`DieFastAndSilent`, no corpse and no skulls), with feedback `_NT_TransportUnitsDiedIn{Ship,Vehicle}`.
- **Owner change** of a transporter converts its passengers, except heroes and `special_eusmilus`, who are dismounted (TO:840-865).
- **Passenger death:** a dying passenger is force-dismounted at its position first (FO:5539-5544).

### 4.4 Passengers fighting

- **Closed transport:** passengers cannot act. Attack orders are forwarded to the transporter. Passengers get no aggro timer (FO:6806) and take no damage.
- **Ship:** a CHTR on a SHIP never attacks (CH:2390).
- **Open transport:** passengers keep their own scan and auto-attack (aggro timer allowed). Special rules:
  - `IsInCombatRange` treats **any** non-zero range zone as the primary zone (FO:5111-5113), so passengers always shoot with their primary (long) weapon.
  - `FollowEnemy` returns false (CH:2594), so they never leave.
  - When the transporter attacks under a user command, each passenger with a projectile weapon takes the transporter's target (`AttackTransportersTarget`, CH:1170-1179, TO:883-890).
  - The open transporter's `Fight` also calls `Fight` on every passenger (BU:531-538).
- **Weapon build-ups (turrets and captain archers)** (BU:613+, 972-1140):
  - Each has its own region of `attackRange + collisionRadius + 20`.
  - It auto-fights on the transporter's aggro tick when the stance is not 1/-1.
  - Its weapon = the best tech-tree weapon whose `Users` contain `weaponClass`, with weapon level ≤ the parent's level.
  - "Additional" weapons (the captain archer on dino howdahs, the titan and seismo gatlings) fire even while the parent fights.
  - Primary turrets (steam tank, rhino ballista, wehrspinne, firecannon, log cannon, gatling paraso) wait while the parent is in `Fight`.
  - Build-ups with `SetCanSwitchAttackMode` (`seas_wehrspinne`, `hu_mammoth_log_cannon`) must deploy before shooting. The anims are `attack_front` forward/back, or `rest` + `build_down`/`build_up`.

### 4.5 Siege

- **`CSiegeTower` (ninigi_siegetower, cannot fight)** and **brachio `siege` build-up:**
  - Attacking or using a **wall** starts `DockWall` (DockWall.usl): approach, `siege` / `siege_down` anim, 2 s dock time.
  - Passengers then climb (`ClimbSiegeTower`, `ClimbBrachio`) onto the wall.
  - `/Dismount` while docked makes the character leave through the tower (Vehicle.usl:546-575).
  - A docked brachio ignores `/GoAway`.

---

## 5. Mounted units and captains

- **Captains are decoration only.** They have no HP, can't be targeted, and never dismount.
  - `captainclass` (`hu_rider_a`, `aje_rider_b`, …) names a `CDeleteMeDummy` class that is deleted on construction (MiscObj.usl:2521). Only its `gfx` and its weapon parts are used.
  - The captain is a `universal_captain` (`CCaptain`, TO:1692-1823). It is linked at `Ride` (default, anim `ride_idle_0`, attack anim `ride_attack_front`) or at a build-up link `Dri1`/`Dri5`.
  - Its gfx = captain gfx with the last digit replaced by `level+1` (Stina uses `level`). Its weapon gfx = the best non-secondary weapon of the captain class with weapon level ≤ level+1.
- **Damage:** the mount alone takes all damage. Attacks on a passenger are redirected to the mount (Fight.usl:354-361), and passengers are immune (FO:4056).
- **Weapons:** the mount uses the mount's weapons. The captain only animates (`DoCaptainAttackAnim` on open transporters). The exception is "captain archer" build-ups (§4.4), whose weapon is `weaponClass`.
- **Killing:** when the mount dies, the captain is deleted with it. An animal leaves a `<class>_food` corpse (§7.6), and the rider leaves nothing.
- `aje_velociraptor_handler` flex-links its captain on `Db_1` and swaps the walk anim `all_walk_<speed>_loop` (AN:1999-2032).

---

## 6. Vehicle and animal special behaviour

- **Size:** vehicles force `m_iSizeClass=10` and ships 3 (Vehicle.usl:27, Ship.usl:195). Other units use tech-tree `unit_size`.
- **Minimum ranges** (tech-tree `minattackrange`, in m): `hu_mammoth_log_cannon` 30, `hu_steam_boat` 20, aje ankylo catapult 20, brachio catapult 30, `aje_catamaran` 20, `ninigi_firecannon` 35, `ninigi_rocket_boat` 20, `ninigi_seismosaurus` d/e 20, `seas_wehrspinne` 25.
  - A target inside `minRange + collisionRadius` is not attackable with the primary weapon. The unit switches to its `_s` weapon if it has one, otherwise it waits or picks another target (FO:5099-5145).
- **Flying:** none of the four tribes has a flying combat unit.
  - `seas_helicopter` (CSeasHelicopter) is **walk + swim** only (Vehicle.usl:702-706), so it is amphibious but still ground-pathed.
  - `CAnurognathus` (wild) and `CFlyingTraderObj` are the only `CanFly` objects.
  - `hu_jetpack_warrior` has an active jump: range ≤ 100 m, cooldown 17 s, accident chance 0% (Jetpack.usl:6-8). It can jump off walls.
- **Amphibious:** `aje_transport_turtle` (swaps gfx `Macrolemys_Land`/`_Water`; command `WaterOnly` disables walking), `seas_hovercraft`, `ninigi_baryonyx` (walk set `swim` and attack `swim_attack_front` in water; it drowns on death).
- **Resource collectors:**
  - `aje_resource_collector` (CIguanodon):
    - It cannot fight (AN:2132-2137) and is a delivery point for food, wood, stone and skulls.
    - It adds pop +6 and storage +500 each (+500 ×3 bazaar upgrades).
    - It trains Aje CHTR through a personal produce unit, has a rally point, and its wagon gfx follows the age (a..e).
    - Its killer gets "grant resources" like a building (FO:4499).
  - `seas_triceratops_resource_collector` only gets a fake build-up and has no delivery or limits in the tech tree. Its build action is made invisible by `AntiActions`, so it is **cut content**.
- **Harvester vehicles:** `ninigi_harvester` harvests wood (150), follows lumber-mill jobs, and has `lacerate` (cooldown 60 s). `hu_mammoth_lumber_upgrade` harvests wood and stone (150).
  - `seas_mechanical_walker` has harvest/mine/food tasks with a 20 carry cap in the script, but tech-tree `can_harvest=0` `[?]`.
- **Other units:**
  - `ninigi_smokebomb_thrower` cannot fight. It makes own CHTR/ANML/VHCL within 15 m invisible (buff `is_invisible`, Vehicle.usl:354-424).
  - `ninigi_parasaurolophus_drums` cannot fight. It gives the "more damage" drum effect to friendly fighters within 50 m. `hu_scout` does the same within 20 m once `drums` is invented.
  - `hu_rhino` gives `owner_more_defense` within 20 m once `pennant` is invented.
  - `hu_warrior`:
    - Warcry at level 2/3/4 affects friends within radius 10/15/20.
    - `defensive_mode` toggle: maxspeed 2, +50 ranged defence on axes, FX `fx_defensive_mode`.
    - `roar` knocks back when 3 or more enemies are within collisionR+4 (auto special).
  - `aje_warrior` warpaint debuffs enemies within 10/15/20 by level.
  - `aje_spearman` "matrix" triggers when 3 or more enemies are within collisionR+6.
  - `hu_mammoth` stampede: auto-starts when the target is 10 m..FOW away. It runs with walk set `rage` for 30 s and deals area damage (7 m) every 2 s.
- **Active animal skills** (task/ANMLSpec.usl; cooldowns from the tech tree):
  - `hu_mammoth` Trumpet: 30 m, buff lasts 15 s (FO:9150), cooldown 60 s.
  - `hu_triceratops` Paw (buff 15 s, cooldown 60 s) and shake-off `titan_rage` (cooldown 60 s).
  - `hu_rhino` shake-off (cooldown 60 s). Shake-off does area damage of collisionR+5 with knockback.
  - `aje_allosaurus` Scrunch: 2× damage, target must be within 0.39 rad in front, cooldown 60 s.
  - `aje_stegosaurus` tail bash: auto-triggers when 4 or more enemies are within collisionR+5, cooldown 60 s.
  - `aje_brachiosaurus` Stomp: fells trees within 15 m and deals 100→0 damage over 20 m, cooldown 60 s.
  - `aje_atroxosaurus` scrunch and roar: stun 7 s within collisionR+10, cooldown 60 s each.
  - `ninigi_saltasaurus_archer` doping: invulnerable for 7 s, cooldown 60 s.
  - `ninigi_seismosaurus` barrage: 350→100 damage in 25 m. Enchain lasts 20 s. Cooldown 60 s each.
  - `special_eusmilus` Hypnosis (cooldown 60 s).
- **Kamikaze / temporary units:** none of these count toward population.
  - `aje_velociraptor`: spawned by the handler's egg projectile when it lands on land (misc/Product.usl:139-160). It lives 30 s and is autonomous (ignores all orders except auto-attack). When deleted it turns neutral (owner -1).
  - `aje_tracker_dino`: lives 180 s. It auto-scouts unexplored FOW (§6.1). It attacks the nearest enemy within 100 m, checking on each idle tick and every 2 s while it has a target. When idle with no enemy, it wanders 25 m ahead.
  - `hu_kennel_eusmilus`: autonomous, spawns at level 1.
  - `ninigi_dilophosaurus`: autonomous.
- **Entrench** (all Ninigi CHTR plus `hu_undead_warrior`; cooldown 30 s; Entrench.usl):
  1. Dig in: `digandhide`, 3 s, commands blocked.
  2. Entrenched: camouflage `entr`, dynamic bounding box, buff `is_camouflaged`, frozen.
  3. Dig out (`hideandstand`, 3 s, blocked) happens on any new command or on taking damage. The cooldown starts at dig-out.
- **Patrol** (FO:2330-2430; `task/Patrol.usl` is fully commented out):
  - A walk with `/Patrol` appends waypoints. The first click adds the current target or position plus the click.
  - Clicking within 5 m of the last point moves that point. Clicking within 6 m of the first point closes the loop (mode 1 circular). Otherwise mode 2 (ping-pong: 1 2 3 2 1…).
  - Patrol walks are aggression walks, so the unit fights without a leash and resumes afterwards.
  - Any user task stops the patrol.
  - A-move (`/AggressiveTarget`) = a one-point patrol of mode 0.

### 6.1 AutoScout (task/AutoScout.usl; used by the tracker dino)

```
step = FOWRange; build grid points (i·step, j·step) for i,j ≥ 1 that have a free position within FOW/2 and lie on the same island
repeat after each finished walk: drop the points whose FOW state != 0 (unexplored)
       sort by |start−p| + |scout−p| ascending; walk to the first at max speed with aggressionWalk=true
end when no points are left
```

---

## 7. Wild animals

### 7.1 Temperament (tech tree `Objects/World/ANML/<cls>`)

- **`aggressive`:** -1 = peaceful (always flees), 0 = neutral, 1 = hunter.
- **`maxhelpers`:** how many helpers it may rely on.
- **`repletion`:** seconds of fullness after eating.
- **`agility`:** seconds between roaming re-targets. The default is 15 without a nest (AN:850-857). For a nest, it is the flock-move period, default 30 (Nest.usl:821-829).
- **`density`:** used for flock size.
- **`growup_duration`**, and `nightactive` (all 0, so every animal sleeps at night).

Examples:
- Allosaurus: 1/1/420/30.
- Velociraptor: 1/5/420/5.
- Triceratops: 0/2/600/120.
- Brachiosaurus: 0/0/600/120.
- Parasaurolophus: -1/0/540/60.
- Mammoth: 0/2/540/60.
- Smilodon: 1/1/480/60.

Enemy search:
- **Wild animals only search** CHTR, FGHT, ANML, VHCL and BLDG of players 0..7, plus other wild animals **only while they have no food cache** (AN:680-702, 423). `CSwimmingAnimal` searches SHIP and BLDG instead.
- **Excluded from the search:** their own class, their own flock, `darwin_s0`, units with `EFFECT_NO_ANIMAL_AGGRO`, and, when nested, anything outside the nest action area, camouflaged units, or units not visible to all players.
- **Hunting other wild animals** (AN:431-452): with `need = floor(timeToKillEnemy/timeToBeKilled)`, drop the target if `2·maxhelpers < need` or `nearbySameClass < 2·need`.
- Babies do not pre-scan.

### 7.2 Reaction when attacked (AN:1202-1276)

- If already fighting: nothing new.
- **aggressive=-1:** flee.
- **aggressive=0:**
  - Flee if the attacker is wild and `maxhelpers < need`, or if the available same-class animals within sight are fewer than `need`.
  - Otherwise alert all same-class animals within sight (`2·max(alarm, attack, FOW)`), which then join.
- **aggressive=1:** the same, with thresholds ×2.
- **Nested animals:** flee if the attacker is outside the nest action area. Babies being attacked make every adult nest member that can see them attack.
- **Water-only melee animals:** flee from targets on land.
- **Flee task** (Fight.usl:955-1150):
  - It runs up to 8 legs of 15 m away from the enemy, or to a random nest point. It ends when the enemy is out of combat range and more than 40 m away.
  - Speed = `max(1, maxspeed + k)`, with k = −1/−2/−3 below 90/80/60% HP. Below 60% "weight" it uses the hump walk set.
  - Fatigue +walked/(factor·55) per leg. At fatigue 1 the flee stops. Fatigue recovers 0.02 per second.
- **Kill scare:** every death creates a scare source of 60 m (duration 360) that non-aggressive animals avoid when roaming or feeding (AN:1284-1343).

### 7.3 Idle loop for wild or autonomous animals (AN:843-889)

```
every 6th idle tick:
  if a queued next walk target exists: go there (unscared, nest/flock-valid) at defaultspeed
  elif night (IsVirtualDay == nightactive) and rand>0.6: Sleep task
       (walk to a nest point, then "rest" for 20..59 loops)
  elif hungry (time since last meal ≥ repletion) and rand>0.8 and FindFood(): Feed task
  else WaitAction(5..10 s)
the agility timer (no nest) picks the next target: a random point ±30 m (babies ±5 m) that is nest/flock-acceptable
```

- **Food cache** (refresh every 60 s for herbivores and 30 s for carnivores): TREE/VGTN for non-aggressive animals and FOOD corpses for hunters. The search area is the nest area (safe area for babies) or 50 m.
- **Feed task:** walk to the food (give up if the 2-D distance is > 25 `[?]`). Then do 2..6 bouts of 3..10 `feeding` loops. Each loop mines `dmg` from a food object and heals half of it.
- **After killing a wild animal** a wild hunter feeds on `<victim>_food` within 20 m (AN:1062-1076).
- `IsVegetarian = aggressive != 1`.

### 7.4 Nests, respawn and flock

Nest attributes: `spawn_type`, `spawn_amount` (-1 = infinite), `spawn_max`, `spawn_rate` (seconds), `advance_time`, `spawn_grown`, `spawn_uninfluenced`.

- **Regions:** action area 20 m and safe area 10 m (ovals, editor-editable), plus hotspots with a daytime table (60% chance) (Nest.usl:137-150, 545-562).
- **Spawning:**
  - While `animals < spawn_max` and `spawn_amount != 0`, spawn one every `spawn_rate` s. This timer is restarted whenever a member dies (Nest.usl:715-734, 801-819).
  - Newborns are babies (see growth) unless `spawn_grown`, which backdates birth by 2 days.
  - On the first game load, `advance_time` pre-spawns `ceil(advance/rate)` animals, capped by max and amount.
- **Flock:** nests whose safe areas overlap share a flock.
  - `flockSize = 2·max(density,5)·sqrt(n/π)`. A position is accepted if it is within `2·flockSize` (Flock.usl:71-77) or the nest's flock size.
  - Every 2 s, members outside the action area are sent back.
  - The flock centre moves every `agility` s (to the safe area at night).
- **Growth:** `strength = clamp((now−birth)/growup, 0.2, 1)` scales max HP and damage (AN:629-647, 1110-1116). Babies stay in the safe area.

### 7.5 Owned animals

- They use normal unit logic. `GetDefaultSpeed()` returns **maxspeed** for owned animals (AN:561-566), so owned animals always move at full speed.
- An owned animal with `ActAutonomous` accepts only `AttackSrv`.

### 7.6 Corpse food

On death, an animal spawns `<class>_food` (a CDino_Food). Its `value` comes from `settings/Resources.txt`, `FOOD` section, scaled by `curGrownHP/maxHP`.

- **Wild examples:** Triceratops 2000, Brachiosaurus/Apatosaurus/Diplodocus/Amargasaurus 1800, Saltasaurus 1600, Spinosaurus 1500, Atroxosaurus/Gigantosaurus 1000, Stegosaurus 900, Mammoth/Kentrosaurus/Polakanthus/Pentaceratops/Styracosaurus/Achelousaurus/Dunkleosteus 800, Allosaurus/Tarbosaurus/Woolly_Rhino/Kronosaurus 700, Carcharodontosaurus/Panoplosaurus 650, Iguanodon/Parasaurolophus/Macrolemys/Muraenosaurus/Carnotaurus/Edmontosaurus/Corythosaurus/Lambeosaurus/Maiasauria 600, Tsintaosaurus 550, Ankylosaurus 500, Baryonyx/Dilophosaurus/Megaloceros/Wild_Boar/Eusmilus 450, Smilodon 440, Stygimoloch 420, Gallimimus 400, Placohelys 200, Deinonychus/Oviraptor 150, Velociraptor 100, Psittacosaurus 50, Lemur/Sloth 5, Gigantopithecus 5000.
- **Player animals:** hu_triceratops/aje_triceratops_archer/seas_triceratops* 2000, aje_brachiosaurus 1000, ninigi_seismosaurus/saltasaurus_archer 1800, hu_mammoth* 500, aje_atroxosaurus 500, aje_allosaurus 400, hu_rhino* 300, aje_stegosaurus 300, aje_transport_turtle 300, aje_ankylosaurus 200, special_eusmilus/aje_eusmilus 150, hu_eusmilus 110, aje_resource_collector/aje_dilophosaurus/aje_trade_dino 100, hu_wild_boar 80, ninigi_parasaurolophus* 70, and 50 for scouts, chariots, raptors and ninigi carts.

---

## 8. Movement

- **Speed classes:** `defaultspeed`/`maxspeed` are integer gait indices 1..4. Real m/s come from the animations `[?engine]`.
  - `init/walkanimconfig.txt` defines the gait transition tables per set (`Animals1..4`, `Ships2..4`, `Hu_SteamTank`, `Walk1Only`). Rows = current gait 0..4, columns = requested gait, with codes Id/E#/S#/L#/T## `[?]`.
- **Which speed is used:**
  - User walk command: **maxspeed**, unless there is `/Speed=n` (FO:8821-8864).
  - Attack approach, boarding, flee, unload spread and harvester: maxspeed.
  - Automatic moves (return to aggrPos, patrol default, repair, wild roaming): `GetDefaultSpeed() = clamp(defaultspeed + ΣBONUS_DEFAULTSPEED, 1, maxspeed)` (FO:7687-7690).
  - Most CHTR have 3/3. Heavy dinos, vehicles and siege have 2/2. Scouts, eusmilus, raptors and the helicopter have 4/4. `hu_undead_warrior` has 1/1.
  - `maxspeed` changes (e.g. defensive mode) abort the current walk (FO:7671-7682).
- **Terrain:** walks pass `bUseMaterial=true` and height adaption to the engine `[?]`. There are no script-side terrain speed modifiers, and `SetIgnoreSlope(true)` is set only for Livingstone.
- **Walls:** units on walls use `WallWalkAction`. The unit's ranged defence gets a wall bonus (see rules_spec).
- **Formations:** attributes `formation_x`/`formation_y` are consumed by the engine.
  - x (centre↔side) = `1 − level/5` (heroes 0), or from HP: `1 − min(HP·100/(100−def)/3000, 1)` (FO:3685-3686). Whichever ran last wins.
  - y (front↔back) = TT `formation_pos` if ≥ 0 (workers 1, druid/shaman/monk/medic 0.2, transport ship 1), else `clamp((range+1)/75 − dmg/10000, 0, 1)`.
  - `SetCaste` would set y = −0.5/0/0.5 for tec/nat/res, but it uses the *previous* caste (CH:692-704 bug).
- **Collision:** `unit_size` → size class, used for knockback and formation. The flocking boid is registered for CHTR and transports.

---

## 9. Class table (four tribes; classes with behaviour beyond the default)

All CHTR default to a plain script class (`CHu`, `CAje`, `CNinigi`, `CSEAS`, or `CCharacter` for flamethrowers). Their special behaviour is keyed on the class name inside `CCharacter`.

| class | script class | behaviour (see §) |
|---|---|---|
| *_worker (4 tribes) | CHu/CAje/CNinigi/CSEAS | stance 1, no help calls or victory anims, auto GetFood after wild kills, build/harvest/repair (§1.8) |
| hu_warrior | CHu | warcry aura L2-4, roar (auto), defensive_mode toggle |
| hu_berserker | CHu | berserk: unbreakable fights, stance locked (§1.4) |
| hu_jetpack_warrior | CHu | Jetpack jump (§6) |
| hu_druid / aje_shaman / ninigi_monk / seas_medic | CHu/CAje/CNinigi/CSEAS | healer idle scan (§1.7); find traces/traps; shaman: camouflage, Resurrect (§3) |
| hu_undead_warrior / hu_undead_killer / hu_berserk_statue_* | CUndeadWarrior / CHuUndead / CHuStatue | map-scripted: wait (`HangArnd`, unhittable) until activated, then join player 3 |
| aje_poisoner | CAje | stance 3 permanently (no auto-attack, no auto-defend) |
| aje_rammer | CAje | attack type 1 (buildings first) |
| aje_spearman | CAje | "matrix" auto special (≥3 enemies within 6 m) |
| aje_warrior | CAje | warpaint enemy debuff aura L2-4 |
| ninigi_* CHTR | CNinigi | Entrench (§6) |
| ninigi_ninja | CNinigi | disguise/camouflage (10 s re-hide timer); left-hand projectile link |
| ninigi_mortar | CNinigi | attack type 1 |
| ninigi_icespearman | CNinigi | hits freeze targets for 2.5 s |
| *_rider_a/b, ninigi_drumwagon_rider | CDeleteMeDummy | captain gfx only (§5) |
| hu_scout | CMegaloceros | drums aura 20 m when invented |
| hu_chariot | CMegaloceros | open transport, 1 seat + archer captain |
| hu_rhino / _transporter / _ballista | CWoolly_Rhino | pennant aura; open transport (2) + archer; auto ballista turret; shake-off |
| hu_mammoth / _lumber_upgrade / _log_cannon | CMammoth | trumpet, stampede; wood/stone harvester; deployable log cannon (min 30 m, attack type 1) |
| hu_triceratops | CTitanTriceratops | open transport 4, 2 auto ballistas, paw, shake-off |
| hu_eusmilus / aje_eusmilus / ninigi_eusmilus | CEusmilus/CAnimal | mount; ninigi rider shoots a bow |
| hu_kennel_eusmilus | CKennelEusmilus | autonomous, no captain, not in pop |
| hu_wild_boar | CWildBoar | rage unit when `wild_boar_rage` invented |
| hu_kentrosaurus | CKentrosaurus | normal (armour gfx) |
| hu_steam_ram | CSteamRam | attack type 1 |
| hu_steam_tank | CSteamTank | closed transport 10 + auto ballista |
| hu_cart / aje_trade_dino / ninigi_cart | CTradeCart/CTradeDino | trade transporters, cannot fight |
| hu_mobile_suit, seas_mobile_suit(_flamethrower), seas_lumberjack | CVehicle | plain vehicles |
| aje_resource_collector | CIguanodon | mobile HQ, drop-off, pop 6, trains units, cannot fight |
| aje_velociraptor | CKamikazeVelociraptor | 30 s autonomous summon |
| aje_velociraptor_handler | CVelociraptorHandler | fires egg projectiles that hatch raptors |
| aje_tracker_dino | CTrackerDino | 180 s autonomous scout/hunter |
| aje_ankylosaurus | CAnkylosaurus | ram weapon vs buildings (`ram` invented); catapult upgrade (min 20 m) |
| aje_stegosaurus | CStegosaurus | tail bash (auto); transporter upgrade (4 + archer) |
| aje_brachiosaurus | CBrachiosaurus | upgrades: mobile camp (auto turret, rally/produce), catapult (min 30, type 1), transporter (4 + archer), siege (docks walls); stomp |
| aje_allosaurus | CAllosaurus | scrunch |
| aje_atroxosaurus | CAjeTrex | two extra captains; scrunch, stun roar |
| aje_triceratops_archer / seas_triceratops_transporter | CTriceratops | open transport 3 + archer/marksman captain |
| aje_transport_turtle | CTransportTurtle | amphibious closed transport 10 |
| ninigi_baryonyx | CBaryonyx | amphibious walk sets |
| ninigi_parasaurolophus_drums / _gatling | CParasaurolophus | 50 m damage aura, cannot fight / auto gatling turret |
| ninigi_saltasaurus_archer | CSaltasaurus | open transport 3 + archer; doping (7 s invulnerable) |
| ninigi_seismosaurus | CSeismosaurus | launcher turret + 2 auto gatlings; barrage, enchain |
| ninigi_dilophosaurus | CNinigiDilophosaurus | autonomous, not in pop |
| ninigi_smokebomb_thrower | CSmokeThrower | invisibility field 15 m, cannot fight |
| ninigi_siegetower | CSiegeTower | wall-docking transport 5 |
| ninigi_harvester | CHarvester | wood harvester, lacerate |
| ninigi_firecannon | CFireCannon | rotating turret, min 35, type 1 |
| ninigi_flamethrower_trike | CFlameThrower | captain `flamebuggy_standanim` |
| seas_mechanical_walker | CMechWalker | work anims, carry 20 `[?]` |
| seas_wehrspinne | CWehrspinne | deploy-to-fire turret, min 25 |
| seas_lumberjack_minigun | CLumberjack | rotate-to-fire special |
| seas_hovercraft | CHoverCraft | amphibious closed transport 10; passengers die if it sinks in water |
| seas_helicopter | CSeasHelicopter | walk + swim (not flying) |
| seas_submarine / ninigi_muraeno_submarine | CMediumSizeShip / CMuraenoSubmarine | torpedo targeting (water only); Muraeno disguises |
| heroes, special_eusmilus | CHero / CEusmilus | §3 |

---

## 10. Open questions / engine-side

1. The real m/s per gait and the terrain material slowdowns come from the engine and animations.
2. The spirit lifetime and the resurrect duration (`CSpirit`) are engine-side.
3. Transporter death when `OnDismount` fails (TO:1521-1525) may leave passengers hidden. The recommendation is to force-place them.
4. Whether tavern hero buttons come back after a hero is produced (the `_RemoveMe` persistence).
5. The idle tick frequency. Script logic uses per-tick probabilities (1/4, 1/7, 1/50, every 6th tick for wild animals). `[?]` Assume a 100 ms tick.
