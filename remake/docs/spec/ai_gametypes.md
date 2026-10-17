# The computer player in Defender and King of the Hill (Domination)

Spec for porting the script AI's game-type branches into `remake/src/game/ai/`. Companion to `ai.md` (same file
abbreviations; section refs `§n` point there). Sources: `Data/Base/Scripts/Ai/**`, `Server/misc/GameOverMgr.usl`
(GOM), `Server/classes/misc/DominationFlag.usl` (DF), `DefenderObj.usl`, `KOTHMgr.usl`. **No overrides**:
`BoosterPack1`, `BoosterPack3`, `MIRAGE`, `Wintermod` have no `Scripts/Ai`; their Server copies touch neither game type.
Extra abbreviations: KH `goals/AiGoalKotH.usl`, SI `goals/AiGoalSiegeAttack.usl`, PV `goals/AiGoalPureViolenceAttack.usl`,
IS `goals/AiGoalIslandSurveillance.usl`, BT `goals/AiGoalBuildTowers.usl`, WC `goals/AiGoalWatercrossing.usl`.
`[?engine]` = native code decides, `[bug]` = original script bug (port faithfully unless noted).

---
## 1. How the AI knows the game type and its role

| Query | Implementation | Values |
|---|---|---|
| `CAiUtilityMgr.GetGameType(brain)` (UM:324-342) | **script** wrapper over the native `CAiSensor.GetMapType()` [?engine] | 0 `"Deathmatch"`, 1 `"KingOfTheHill"`, 2 `"Defender"`; anything else `""` |
| `IsDefenderPlayer(id)` (UM:61-79) | **pure script**: an object query `SetOwner(id) + SetClass("defender_object")`; true when ≥ 1 hit | independent of the game type |
| `GetKothSectors(brain, list)` (UM:17-58) | script: all objects of type `DOFL` (domination flags), invalid ones dropped, sorted by `-dist²` to the own start location | returns false when the map has no flag |

- Server side the same numbers come from `CSrvWrap.GetGame().GetType()` (GOM:151-156; `SavedGameType` in saves).
  That the sensor returns the same value (also after loading) is [?engine]. Campaign maps: presumably 0 [?engine].
- The server's defender is **the slot with head quarter 0** (GOM:807-846: `GetHeadQuater()==0`, timer
  `"GameOverMgr/Defender"`, ID = that owner, `GetDefenderTimer()` minutes). The AI instead asks "do I own a
  `defender_object`" - equal as long as the map gives the crystals to slot 0 (remake: `S.owned` objects go to
  `p.hq === o.owner`, main.js:642-648).
- Every module caches both at `Init` (CM:101-102, DM:139-140, EM:130, FM:74-75, AM:58, GV:66-67, DA:165-168,
  SI:27, AO:84, MOD:75, WC:72, IS:58): `defender_object`s must exist when the brain starts [?engine order]; a
  defender that loses all crystals stays "defender" for the rest of the game.
- `SetDefenderPlayOpinion` (UM:399-417: player 0 hostile to all, the rest friends) is **never called**.
- In non-Domination games the server deletes all flags at init (GOM:169-177); whether the AI's `Init` runs before
  that (PV:36, FM:75, DA:168 would then see flags) is [?engine]; harmless, see §4.6.
- `MOD.m_sGametype` (MOD:75) and `WC.m_sGameType` (WC:72) are read and never used.

## 2. Defender - the defending player (`GetGameType=="Defender" && IsDefenderPlayer`)

1. **Behaviour forced to `Schnecke`** (CM:292-294), whatever the slot said: `SetBehavior` loads
   `<Tribe>/Schnecke<Difficulty>.txt`, sub-strategy `S1..S4` (random; so DA's `m_iAttackType==5` "Turtle" branch
   can never hit), `village_level S2`, `aggressiveness 10`, `riskiness 10`, `upgrade_walls 1`, `upgrade_towers 1`,
   `close_start_location 1`, `attacks_risk_level 1.3`, `guard_village 1`, kindergarten on (CM:332-356, §2).
2. **No plan attacks**: every tribe/behaviour row is `none × 5` (DA:1018-1025, 1073-1080, 1108-1114, 1168-1175,
   1201-1208, 1236-1242, 1296-1302, 1330-1336, 1365-1371, 1423-1429, 1464-1470, 1498-1504). The DA flow (DA:1532-1630)
   still does, before the `none` return at DA:1548: the warp-gate hunt `siege_warpgate` (DA:1532), the one-time
   scouting when no enemy is known (`"none" != "blitz"`, DA:1536-1544), a pending pest patrol (DA:1546). Before
   that `CheckGetItem` (items, epoch < 3, DA:573-577). No ship, trap, guerilla or 11 % pyramid attack (after 1548).
   Behaviour `X` (campaign only) has no Defender branch.
3. **Guard point at the crystal** (GV:399-428, `CheckForDefenseObj` GV:985-1011): when the guard is not fighting
   (`m_bRetreat`), its position is the first non-zero of: enemy around the village → damaged own building → own
   warp gate → **defender object** → defence point → temple → `m_vGuardPos` → start location. The defender object
   = the **first own `defender_object` with `hitpoints < maxhitpoints`**, else the **last** one in the query list.
   Units are sent there with the usual GuardVillage orders (§7.2; guard range 30 m).
4. `_MN_MP_3_PINCER` without `hunt_animals`: a defender's guard ignores hostile wild animals (the alarm is marked
   succeeded at once, GV:455-461).
5. **Walls: none** - `BuildVillageWalls` is never activated in a Defender game, for anybody (DM:671-685). Towers:
   as normal (Schnecke: `upgrade_towers 1`, coverage at the tower's cell only, §7.4).
6. Economy / build lists: **unchanged** (BV has no game-type code). Market places: only `Deathmatch` (EM:527-537).
7. Island surveillance off (AM:64-66, IS:276); squads' ship crossing restricted (§4.5); `AttackObject` orders (§5).
8. Last 5 minutes (FM `CheckForTimers`, §4.4): the timer owner is the defender itself, so the query finds **its own**
   units/buildings within 60 m of the crystal and a `pyramid` attack is started on them [bug]. Effect [?engine]:
   `TakeAllYouHave` pulls the whole pool to the crystal; whether the "attack" on own objects does anything or fails
   at once is engine-side.

## 3. Defender - the attacking players (`"Defender" && !IsDefenderPlayer`)

1. **Attack plans** (by the zero-based epoch `m_iAge = GetCurrentAge()-1`, DA:621; tables DA:1010-1017 ...):

   | Behaviour | Hu | Aje | Ninigi | SEAS | Guerilla |
   |---|---|---|---|---|---|
   | D / Dodo | pyramid, siege ×4 (DA:1010) | same (1160) | same (1288) | same (1416) | 11 % (SEAS 0) |
   | G / Giraffe | none, suicide, siege ×3 (1065) | none, siege ×4 (1193) | none, siege ×4 (1322) | none, siege ×4 (1457) | 11 % (SEAS 0) |
   | S / Schnecke | none, none, siege ×3 (1115) | same (1243) | same (1372) | same (1505) | 11 % (SEAS 0) |

   No multimap/campaign split, no Turtle row. After the table the normal flow (§5.2) applies: 11 % → `pyramid`,
   difficulty 0/1 epoch-1 blitz rule, trap/guerilla/ship checks, `suicide`↔`violence` swap by target range.
2. **Whom / what**: unchanged `SearchForEnemies` (DA:1634-1722) - in practice the defender (the only hostile
   player; diplomacy is locked). Inside the squad `SortTargetList` puts **`defender_object` first** (after the walls
   that block the path; AO:1314-1316, 1345-1348, 1394-1397; not game-type specific) and gives it `/Attack`
   (AO:931, 940, 964, 977, 986).
3. **Siege** (`SiegeAttack`, FM:457-): army `"SiegeAttack_" + Max(Min(age,3),4)` = always **`SiegeAttack_4`**
   [bug, SI:152; all game types]. Only in the *no army table* branch (`GetUnits` fails) the pool query becomes
   **min 2, max 20 units** regardless of difficulty (SI:165-167; normal 1-5 / 2-12 / 3-20); the `waiting` branch
   keeps the difficulty numbers (SI:201-207). Only one siege at a time (FM:221-236 rejects the same strategy).
4. **No towers**: the `BuildTowers` goal is deactivated at init (DM:148-150). `UpdateDefensiveCoverage` still calls
   `BuildTower` directly (DM:815-821, BT:114-143; best class already known from BT:70) - whether tasks of a
   deactivated goal run is [?engine]; port as "no towers". No walls (DM:675).
5. Same as §2.6-2.7: unchanged economy, no market places, no island surveillance, ship crossing restricted.
6. Last 5 minutes of the defender timer (§4.4): `pyramid` on the defender's CHTR/ANML/VHCL/BLDG within 60 m of
   the **first** `defender_object` of the init-time list (FM:92-94, 1141-1146).

## 4. King of the Hill / Domination (`GetGameType=="KingOfTheHill"`)

### 4.1 `m_pxKotHGoal` = `CAiGoalKotH` (KH:1-170) - a leftover, effectively dead
- Owned by the fight module of **every** AI in every game type: `m_xGoalKotH.Init(brain, flags)`, added,
  activated, and handed to DA (`SetKotHGoal`, FM:87-90). `Init` (KH:62-91): think wait `W + r`, `m_iTeam` = CM team,
  `m_bAiKotHTriggerMode=false`; `Start` → `m_bSuccess = GetKothSectors(...)` (KH:95-99).
- `Think` (KH:115-158) returns unless `m_bSuccess && m_bAiKotHTriggerMode`. The trigger mode is only set by the FM
  command `EnableAiKotH <bool>`, which parses `asTokens[0]=="true"` (always `"EnableAiKotH"`) → **always false**
  [bug, FM:181-189]; nothing in the scripts sends it anyway. Its body works on `rgn_pos / rgn_radius /
  controlling_team` attributes of the old trigger-made `koth_sector` / `simple_koth_sector` objects (KOTHMgr.usl,
  ActionFactory:1730), not on `DOFL` flags. `GetDangerArea` (KH:162-168): `m_vFightingPos` is never set → false.
- **Live use**: only as the non-null switch for DA's KotH branch, plus `GetTeam()` whose value is unused (DA:868).

### 4.2 The real KotH logic: DA `CheckTacticalConditionsAndAct`, DA:866-941
Runs on every strategy think (`W + 20 + random%20` ticks, §1.2) after `CheckGetItem` and the `_MN_MP_4_MALICE`
special. `m_bKotH=true`; `m_xKotHList` = flags from DA `Init` (DA:168), **nearest to the own start location first**
(UM:41-55; `QSort` with `op_Greater = value <` on `-dist²`, DA:122-124 [?engine sort direction]). No flag → return.
For **every** valid flag, in list order, `m_vDisturbancePosition = flag pos`, `owner = flag.GetOwner()`:

| Flag owner | Look around (`SearchForDisturbance`, DA:703-812, skirmish maps only) | Request (`RequestAttack(list, flagPos, type)`) |
|---|---|---|
| **-1 (neutral)** | hostile wild ANML/NEST ≤ 90 m (if any: these); else for Dodo, Giraffe `m_iAge≥2`, Schnecke `m_iAge≥4`: enemy CHTR/VHCL/ANML/BLDG/NEST ≤ 60 m; else enemy towers ≤ 60 m; `DOFL` entries removed | if any wild animal with `anml_aggressive_type==1` was found **and epoch 1** (`GetCurrentAge()<2`) → `return` (skips the remaining flags this think); else **one flag on the map → `"KotH Pyramid"`, more → `"KotH Violence"`** |
| **enemy** (`IsEnemy`) | same search | any `BLDG` in the result (an enemy tower ≤ 60 m, or a building in the behaviour-gated query) → `"KotH Siege"`; else alternate `"KotH Suicide"` / `"KotH Violence"` by `m_iCount` (0 → Suicide, then 1 → Violence, back to 0; **one counter for all flags**, advanced even if the request is refused) |
| own / allied | - | nothing (`m_vOutpostPos` is set for own flags, never read) |

- Then **`return`** (DA:940): in KotH the AI makes **no plan attacks on bases, no scouting, no pest patrol (the
  flag stays set), no warp-gate hunt, no ship/trap/guerilla attacks**. Items (DA:575) still run.
- `RequestAttack` (DA:1740-1789): targets = the found list (may be empty), `SetPos(flagPos)`, island of the flag
  (or of target[0]); the `suicide/violence` range swap does not touch `"KotH *"`; empty list + flag pos is a valid
  request (position attack).
- Note: `m_iAge≥2` / `≥4` = epoch 3 / 5 (`ai.md` §5.4 says epoch 2 / 4 - off by one there).
- `SearchForDisturbance`'s second loop uses the stale `iC` of the first query (DA:762) [bug]: riders are not all
  filtered.

### 4.3 The fight module's side (FM:205-383)
- Gate as for any request (§6.1): **while the village defends only `pyramid`/`quick`/`getitem` pass - all
  `"KotH *"` are refused**; the same strategy string as a running attack is refused (`"KotH Pyramid"` is not
  exempt; so of several neutral flags only the first gets a `"KotH Violence"` while it runs); max 3 attacks; the
  warp-gate-hunt filter (FM:264-285) only bites when the list has targets.
- Strategy → goal, each with `SetKotH(true)`: `KotH Pyramid` → PyramidAttack (whole pool, `TakeAllYouHave`; no
  minimum / strength check in epoch 1, §6.3); `KotH Violence` → PureViolenceAttack with way points
  `GetWaypoints(flagPos, random%4)` (FM:358-359) = **the flag position itself** (DA:342-364: clusters are keyed by
  enemy start positions, never a flag); `KotH Suicide` → SuicideAttack (way points computed, unused, FM:371);
  `KotH Siege` → SiegeAttack. Squads/armies as §6.3 (`SuicideAttack_<epoch>` etc.).
- In the field (AO): with no targets the task is an *area attack*: `/AggressiveTarget` to the flag (AO:884-898),
  within 100 m again `/AggressiveTarget` on the spot, then `NoPathThenSendSiege`, then after 3 such counters the
  task ends (AO:907-925) → goal succeeds. `CheckForMissingTargets` (the 120 m search for new enemies when the list is
  empty) is **off in KotH** (AO:1449). `m_bKotH` passed to AO (GA:1209, AO:739-741) is never read.
- **"Holding" the flag** (GA:414-461, `Shut` with `m_bKotH`): units of the squad (allocator + MOD essentials)
  **within 30 m** (`Abs2S < 900`) of the attack position are **not returned** to the defence pool; the others are.
  The MOD re-collects all unlocked own units every 5th think (MOD:152-181, 1203-1219; ≈ 6-12 s), after which the
  village guard may call them home (§7.2) [?engine: whether a goal's units stay locked after Shut]. So a capture
  survives only if the units stand there long enough (flag area 20 m, tick 2 s, raise ≤ 10 s, DF/gameover.js);
  the AI re-requests only while the flag is neutral or enemy.
- `PV.m_bKotH = GetKothSectors(...)` (PV:36): **every** PureViolence attack on a map with flags has the holding rule.

### 4.4 The end-timer reaction, FM `CheckForTimers` (FM:1126-1180, called from FM `Think` FM:675-681)
- KotH: owner/pos of **flag[0]** (nearest own start, FM's own list FM:75); if owned, `seconds =
  GetTimeLeft("GameOverMgr/Domination", 0)`. Defender: owner/pos of `defender_object[0]` (all players' list at
  init, FM:92-94); `GetTimeLeft("GameOverMgr/Defender", owner)`. `GetTimeLeft` with no such timer = -1 [?engine].
- `0 ≤ seconds < 300` → query **owner = timer owner**, CHTR/ANML/VHCL/BLDG within **60 m** of that pos; any hit →
  a plain **`pyramid`** goal added **directly** (bypasses defending check, dedupe, max 3; counts in `m_axAttacks`).
- No enemy check [bug]: a flag[0] held by the AI or an ally (it is the domination timer of the holding team!)
  makes it "attack" its own / allied units; same for the defender (§2.8). Only for an enemy-held domination does it
  make sense (then flag[0]'s owner is the enemy team's).
- Repetition [bug]: `m_bTimerAttack` is cleared on every think where `GetAttackHasFinished()` (true unless a DA
  request is between Accepted and Succeeded/Failed), so a new pyramid is started on every FM think (`W + r` ticks)
  while the condition holds; the later ones find an empty pool [?engine: they fail].
- GOM timer IDs [bug]: the first domination timer has ID 0 (GOM:754, 765), but one created on a **team change**
  gets `SetID(iMostOwner)` and **no `SetOccupant`** (GOM:769-784) → the AI's lookup by occupant + ID 0 finds no
  timer afterwards [?engine], so the reaction works only for the first holding team (and owner 0's re-takes).
  Also GOM:728-732 never updates `iTmp` (the "most owner" is the last owner holding any flag).

### 4.5 Other KotH / Defender switches (both types)
- **IslandSurveillance off**: not activated (AM:64-66) and its `Think` returns (IS:276).
- **GeneralAttack ship crossing** (GA:232-258): a squad whose outpost is on the target's island uses ships only in
  `Single 08`; on skirmish water maps with a harbour, a non-Aje AI and an owned target it takes ships with 11 % -
  **not in KotH / Defender**. Targets on another island: ships always (all types).
- **AttackObject orders** (AO:854-858, 886-898, 929-945, 975-991): KotH/Defender use plain `/AggressiveTarget`
  instead of `/AggressiveTarget /AggrTNoAnml /Ai-Multi-PF` (squads also fight animals on the way, no multi-path
  finder); `/Attack` for neutral targets, walls, `defender_object`; campaign maps `/Walk` as before.
- Economy: market place manager only in `Deathmatch` (EM:527-537). Nothing else in EM/BV.

### 4.6 Not game-type dependent but relevant
`SortTargetList`'s defender-object rank (AO:1314); FM `Init` collects `defender_object`s on every map (FM:92-94);
`GetKothSectors` is true on any map that still has `DOFL`s. Fight module `Think`/`StartAttack` otherwise unchanged.

---
## 5. Port plan (remake)

Data the brain needs (read once at brain creation, like the scripts; `gameOverInit` runs before `createBrains`,
main.js:538-539):
- `ai.gameType` = `{deathmatch:'Deathmatch', domination:'KingOfTheHill', defender:'Defender'}[W.go?.mode] ||
  'Deathmatch'` (campaign/sequel: no `W.go`).
- `ai.isDefender` = some alive `W.buildings` with `name==='defender_object' && owner===p` (UM:61-79; equals
  `W.go.def.player === p` on the shipped maps); `ai.crystals()` = own/enemy `defender_object`s, live list.
- `ai.flags` = `W.go.flags` sorted by distance to `ai.start || S.home`, nearest first (UM:17-58); flag owner =
  `f.owner` (a Player or null), position `{x:f.x, z:f.z}`; timers `W.go.dom {team, owner, left, paused}`,
  `W.go.def {player, left}`.

| # | File / function | Change | Source |
|---|---|---|---|
| 1 | `brain.js` constructor (or `main.js createBrains`) | set `gameType`, `isDefender`; Defender + `isDefender` → behaviour `'Schnecke'` (override `o.behaviour`, also on later `setBehaviour` from the CTRL module) | CM:292 |
| 2 | `brain.js ctx()` + `data.js attackPlan` | add `defenderGame: gameType==='Defender', defender: isDefender` to `ctx()`; drop the forced `defenderGame:false` (data.js:166) so the extracted rows (`build_ai.py` ATOM 243-246) match; fallback without ai.json: §3.1 table / `none×5` | DA:968-1530 |
| 3 | `attack.js strategyThink` | Defender: as now (entry `none` returns after gate/scout/pest, already the order of DA:1532-1548). KotH: after `checkGetItem`, if `gameType==='KingOfTheHill'` → `kothThink(S)` and **return** (no scout, pest, warp gate, ship, plan) | DA:866-941 |
| 4 | `attack.js` new `kothThink(S)` | §4.2 table: per flag nearest first; `disturbance(S, pos)` = port of `SearchForDisturbance` (reuse `pestPatrol`'s 90 m wild-animal query + 60 m enemy query gated by personality/epoch + 60 m enemy towers); epoch-1 aggressive-animal abort; one flag → `'KotH Pyramid'`, else `'KotH Violence'`; enemy flag → `'KotH Siege'` if a building was found, else alternate `this.kothCount` Suicide/Violence | DA:866-941, 703-812 |
| 5 | `attack.js GOALS`, `requestAttack` | `'KotH Pyramid'→['pyramid',null]`, `'KotH Violence'→['pureviolence','PureViolenceAttack_']`, `'KotH Suicide'→['suicide','SuicideAttack_']`, `'KotH Siege'→['siege','SiegeAttack_']`; Attack gets `koth:true`, `pos=flag`, `targets=list` (may be empty), `enemy=flag owner or null`; no range swap for them; the existing gate already refuses them while `defending` and dedupes by `type` | FM:211-383 |
| 6 | `attack.js attackTargets / attackFight` | KotH attack with no target left: do not `end('done')` at once - attack-move to the flag, `end('done')` after ~3 fight thinks inside 100 m with nothing found (AO:907-925); **no fallback to `a.enemy`'s whole base** (CheckForMissingTargets off, AO:1449) - limit the search to the flag's 60 m | AO:884-925, 1449 |
| 7 | `attack.js Attack.end` / `sendHome` | if `a.koth` (or `goal==='pureviolence'` on a map with flags, PV:36): units within 30 m of `a.pos` are released but **not sent home**; the rest go home. Faithful: guard may recall them later; optional improvement: keep them claimed as a temporary defence area (`setDefenceArea('flag<i>', pos, 20, n)`) until the flag is ours | GA:414-461 |
| 8 | `attack.js targetRank` | `defender_object` → rank 0 (before warp gates) | AO:1314-1397 |
| 9 | `attack.js` armies | Siege army always `SiegeAttack_4` (faithful [bug]) or keep the epoch (deviation, note it); Defender attacker + no army table: pool query 2-20 | SI:152, 165 |
| 10 | `brain.js update` / `attack.js` new `timerThink(S)` (call on the fight think, `N.fight`) | §4.4: KotH: `G.dom && !paused && left<300`, holder = owner of nearest flag; Defender: `G.def.left<300`, pos = first crystal; targets = holder's units/buildings ≤ 60 m; start a `pyramid` Attack bypassing the gate. Recommended fixes (mark as deviations): only when the holder is an enemy; at most one running timer attack; defender AI instead pulls the pool to its crystal | FM:1126-1180 |
| 11 | `defense.js guardThink` / `guardPoint` | Defender + `isDefender`: guard point = first own damaged crystal, else the last crystal, after `hitAt` (damaged building) and before `guardPoint()` | GV:399-428, 985-1011 |
| 12 | `defense.js towerThink` | `gameType==='Defender' && !isDefender` → no towers | DM:148 |
| 13 | `walls.js wallsActive` | `&& gameType!=='Defender'` | DM:675 |
| 14 | `outposts.js outpostsThink` | skip `islandSurveillance` in Defender / KotH | AM:64, IS:276 |
| 15 | `trade.js` (active check, line 23) | `&& gameType==='Deathmatch'` | EM:530 |
| 16 | `naval.js` crossing for own squads | when ported: no same-island ship crossing in KotH / Defender | GA:247 |
| 17 | AO orders | KotH/Defender attack-moves may also engage wild animals (no `AggrTNoAnml`) - only if the remake's attack-move gets an "ignore animals" flag for Deathmatch | AO:854-991 |

Tests (`tests/ai_gametypes.js`, add to `tests/regress.sh`; pattern of `tests/ai_match.js` with `?aivai`):
- **Defender, AI defends** (hq 0): behaviour becomes Schnecke; `launched` holds no plan attack after 20 min (only
  `hunt`/`pest`); idle army stands within 30 m of the crystal; damaging crystal 2 of 2 moves the guard point there;
  no wall ring is planned (`wallsActive` false) even with `mapOptions.walls`.
- **Defender, AI attacks**: plan rows = §3.1 (unit-test `DATA.attackPlan` with `defenderGame/defender` for all
  tribe × letter); first squad's first target is the `defender_object`; no tower request ever; with
  `W.go.def.left=290` a pyramid attack starts against units near the crystal (and only one).
- **Domination**: one-flag map → requests `'KotH Pyramid'` while the flag is neutral, none while own; two flags →
  one `'KotH Violence'` at a time, nearest flag first; enemy-held flag with a tower ≤ 60 m → `'KotH Siege'`;
  alternation Suicide/Violence; no attack on an enemy base in 20 min; AI vs passive player captures all flags and
  the domination timer starts (`W.go.dom.team === ai.p.team`); `defending=true` blocks KotH requests.
- **Regression**: Deathmatch plans unchanged (`gameType` default), campaign brains (`W.go` undefined) unaffected.

## 6. What the remake does

`src/game/ai/gametypes.js` (`GameTypesAI`, mixed into `TribeAI`) with the hooks of §5: `gameTypeInit` (brain start:
`gameType` from `W.go.mode`, `isDefender` = owns a `defender_object`), `setBehaviour` (the defender: Schnecke),
`ctx()` → `data.js attackPlan` (the ai.json Defender rows; the fallback table of §3.1 without ai.json),
`attack.js strategyThink` → `kothThink` (§4.2) and return, the `KotH *` goals with `Attack.koth` (targets only
within 60 m of the flag; with none an area attack: to the flag, done after three empty looks within 100 m), the
30 m hold when such an attack ends (also PureViolence attacks in Domination), `targetRank` (the crystal first),
`SiegeAttack_4` for every siege, `defense.js` (the crystal guard point, no towers for the attackers), `walls.js`
(no walls in Defender), `outposts.js` (no island surveillance), `trade.js` (markets only in Deathmatch),
`timerThink` on the fight think (§4.4). Deviations: the timer attack only against an enemy holder, one at a time;
the ship crossing rule of §4.5 and the AO orders of §4.5 / #17 are not needed (the remake's attack-move has no
"ignore animals" flag and its crossing is ai/naval.js).

