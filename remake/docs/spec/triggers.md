# Campaign triggers: how a mission runs

This spec describes the trigger system of the original single-player campaign so that the remake can run the 17
missions from the exported `pw-campaign/1` JSON (`python -m pwexport.campaign`, format in
`docs/CAMPAIGN_FORMAT.md`). It is taken from the original server scripts and from the data of the 17 campaign
maps (`Data/Base/Maps/Cpn_single_001/single_01 … 16.ula` and the tutorial `single_00.ula`).

Every statement is marked with its source:

* **[S]** = read in the scripts; `file:line` given. Paths are relative to `Data/Base/Scripts/`.
  `CF` = `Server/misc/ConditionFactory.usl`, `AF` = `Server/misc/ActionFactory.usl`,
  `SA` = `Server/ServerApp.usl`, `SL` = `Server/classes/misc/StartLocation.usl`,
  `OT` = `Server/classes/misc/ObjTime.usl`, `GO` = `Server/classes/misc/GroupObj.usl`,
  `FO` = `Server/classes/FightingObj/FightingObj.usl`, `DS` = `Game/UI/DialogScene.usl`,
  `QW` = `Game/UI/QuestWindow.usl`, `G` = `Game/Game.usl`, `CM` = `Game/mgr/CampaignMgr.usl`.
* **[D]** = counted in or deduced from the data of the 17 maps (numbers are over all maps; "n ×" = occurrences).
* **[G]** = a guess: the behaviour lives in the engine (C++), the scripts only show its interface. Every guess
  that matters is listed again in §8 with a recommended behaviour.

Numbers behind a type name are its occurrences in the 17 maps (all triggers, including the 312 the designers
switched off). Totals: **3257 triggers**, **4064 conditions of 23 types**, **7988 actions of 44 types**. 2945
triggers are compiled into the maps ("live" in the statistics of §1 - §6); 69 of those sit in folders that are
never activated, so 2876 can ever run (the "live" column of §7).

Where the JSON is meant, `trigger.flags.once` etc. are the field names of the export.

---

## 1. How triggers run

### 1.1 The model

A **trigger** has a list of conditions, a boolean expression over them, and a list of actions. The trigger
classes (`CTriggerMgr`, `CTrigger`, the folder nodes) are engine classes; the scripts implement every condition
and every action and talk to the trigger through a small interface (`Invalidate`, `IsEnabled`, `Enable`,
`IsOnce`, `FindTrigger`, `NumConditions / GetCondition`) [S: CF, AF]. From these and from the data the model is:

1. **State.** A trigger is `enabled` or not. Only an enabled trigger whose folder node is active (§1.5)
   listens: its conditions get `OnEnabled()` when it becomes active and `OnDisabled()` when it stops
   (e.g. a `TIME` starts its timer in `OnEnabled`, CF:130-165, and deletes it in `OnDisabled`, CF:167-182) [S].
2. **Conditions** hold a state 0 / 1 and call `Invalidate()` when it may have changed (§4).
3. **Evaluation.** `Invalidate()` evaluates the trigger's expression at once, with the current states of all
   its conditions. [S, indirect: `TIME`, `ITEM` and `WAYR` set their state to 1, call `Invalidate()` and reset the
   state in the next statement (CF:110-112, 2936-2941, 3365-3370), which only works if the evaluation is
   synchronous.]
4. **Firing.** If the expression is true the trigger fires: its actions run in their stored order (all of them;
   exceptions §1.4). The test is on the **level**, not on a rising edge: a trigger fires at every invalidation at
   which its expression is true [G]. With `once` this is not observable (the first firing switches the trigger
   off), and 2892 of the 2945 live triggers are `once`.
5. **`once`.** A trigger with the flag is disabled when it fires (before its actions run, see below). It is
   **not** used up: a later `TRIG` action enables it again and it works as before ([D] 239 once-triggers are
   enabled by two or more `TRIG` actions; the arena's "wave is dead → enable the next spawn" chain and all
   repeating attack waves are built this way).
6. **Order.** The actions of a firing trigger must not run inside the `Invalidate()` call of the condition:
   [D] the tutorial's `Gda07#chariot_not_ready` is `once`, has a `TIME 60` condition and its own action
   `TRIG(self, 1)` to loop; `TIME.OnPush` calls its own `OnDisabled()` (which deletes the timer) *after* `Invalidate()` has returned
   (CF:112-125) - if the actions ran inside `Invalidate()` this would kill the timer that the re-enable has just
   started, and the loop would stop after one round. So: **queue** the firing and run the
   actions when the condition's handler has returned [G].

Recommended implementation (covers everything the data needs):

```
invalidate(trigger):                       # called by a condition
    if !trigger.enabled or !trigger.nodeActive: return
    if !evaluate(trigger.expression): return
    if trigger.once: disable(trigger)      # conditions get onDisabled()
    fireQueue.push(trigger)

endOfStep():                               # after all game events of the step have been handled
    while fireQueue not empty:             # FIFO; actions may queue further triggers
        t = fireQueue.shift()
        run actions of t in order (§1.4)

enable(trigger):                           # level start for flag `enabled`, later by TRIG
    if trigger.enabled: return             # already on: nothing happens, running timers go on (§8 no. 3)
    trigger.enabled = true
    if trigger.nodeActive: for c in conditions: c.onEnabled()

disable(trigger):
    if !trigger.enabled: return
    trigger.enabled = false
    for c in conditions: c.onDisabled()
```

A non-once trigger stays enabled after firing; its conditions decide when it fires again (`TIME` and `RTME`
restart themselves, `TRUE` does not pulse again, level conditions re-fire on their next push).

### 1.2 Flags, expression

`trigger.flags` [D: correlations over all 3257 triggers; the bit values are in `docs/CAMPAIGN_FORMAT.md` §2]:

| flag | count | meaning |
|---|---|---|
| `enabled` | 1227 (971 live) | enabled when the level starts. All others wait for a `TRIG` action |
| `once` | 3198 | disabled when it fires (§1.1 no. 5) |
| `random` | 59 | fires **one** randomly chosen action instead of all (§1.4) |
| `by_difficulty` | 131 | each action runs only on its own difficulty (§1.4) |
| `node_off` | 78 | the trigger sits in a folder that starts inactive (§1.5) |
| `disabled` | 312 | switched off in the editor. Such a trigger was **not compiled** into the map's run-time data (`compiled: false`): it does not exist for the game. Ignore it completely; a `TRIG` aimed at it does nothing (20 ×) |

**Expression** (`trigger.expression`): condition numbers **1-based**, `&&`, `||`, `!`, parentheses, e.g.
`1 && (2 || 3) && !4`. [D] of the live triggers 2511 have an empty expression, 247 only `&&`, 141 only `||`, 44
mixed. Empty = "condition 1" for the 2501 single-condition triggers; three live triggers have two conditions
and an empty expression → treat an empty expression as the AND of all conditions [G]. The 11 live triggers
without any condition have no actions either (leftovers): never fire.

### 1.3 `TRIG`: enabling and disabling triggers

`TRIG` (2972 actions, a third of everything) `guid`, `state` — `CActionTrigActive`, AF:2203-2253 [S]:

```
t = TriggerMgr.FindTrigger(guid);  if (t == null) return        # not compiled / does not exist: nothing
bOn = (state == 1) || (state == 2 && !t.IsEnabled())            # 2 = toggle
t.Enable(bOn)
```

[D] `state` 1 = **enable** 2283 ×, missing (= 0) = **disable** 488 ×, 2 = toggle 4 ×. Enabling is how the
campaign sequences everything: a trigger's actions enable the next triggers, whose conditions start in that
moment (a `TIME 1` condition = "one second later", a `TRUE` condition = "now", §4.1). A trigger may enable itself
(4 ×, loops). Disabling an enabled trigger stops its conditions (timers are cancelled, region subscriptions
dropped); a trigger already queued for firing in the same step still fires [G].

### 1.4 Which actions run: `random`, difficulty

* Normal trigger: all actions, in order. Each action is independent - one that cannot do anything (object
  missing, empty query) is skipped and the rest still runs.
* `random` (59 triggers; [D] missions 11, 12, 16: "the spawned wave picks one of five patrol routes", "spawn at
  one of three gates"): exactly **one** action, chosen uniformly, runs per firing [G: the flag name is the
  editor's; the behaviour follows from the data - the actions of such triggers are alternatives of the same
  kind].
* Every action carries a `difficulty` (0 easy, 1 medium, 2 hard; default 1). In a trigger with `by_difficulty`
  (131) an action runs **only if its difficulty equals the current difficulty** of the campaign
  (`Base/CurrentDifficulty`, CM:131-139 [S]); the designers store the whole action list up to three times, once
  per difficulty ([D] e.g. arena `Gg01: Spawn Aje Group`: 5 actions for medium, 5 for easy, 5 for hard with
  different unit counts and timer lengths). In a trigger **without** the flag the difficulty of the actions is
  ignored and all run ([D] 6724 of 7442 live actions have difficulty 1 anyway). [D] all 127 live triggers that
  contain an action with difficulty ≠ 1 have the flag.
* `random` + `by_difficulty` together do not occur.

The AI strength per difficulty is separate: each AI player has `ai_difficulty {easy, medium, hard}` (defaults
1 / 4 / 8, CM:131-139) which the AI port uses as its level.

### 1.5 Folders (nodes) and `ACND`

The editor keeps triggers in a folder tree (`trigger.folder`, e.g. `Root/G: Gameplay/Ge: SQ03 - 3rd Tribute`;
`trigger_tree` in the JSON). At run time a folder is a **node** that can be active or inactive; a trigger only
works while it is enabled **and** all folders above it are active.

* `ACND` (22) `nodename`, `deststate` — `CActionNode`, AF:2869-2914 [S]:
  `node = TriggerMgr.FindNodeByName(nodename); TriggerMgr.SetNodeActive(node, deststate == 1, deststate == 0)`.
  `nodename` is the folder path with a trailing `/`. [D] 19 deactivate a folder (`deststate` 0: "this side quest
  is over, stop all its triggers" - mission 6 uses it 13 ×), 3 activate one (mission 8, the three "capture
  order" folders of the Kleemann escort).
* The same call switches the multiplayer victory rules: `SetNodeActive(sub, active, true)` for the children of
  the node `WinningConditions` (SA:233-247) [S]. The third argument therefore means "recursive / also the
  triggers below" [G].
* Triggers with `flags.node_off` (78) belong to folders that are inactive at level start. Only mission 8's
  capture-order folders (`Gda / Gdb / Gdc#capture_order_0n`, 6 triggers) are ever activated. The rest are dead:
  the arena's first, German-language version of the whole mission (`Root/Spielstart …`, 48 triggers), four
  patrol / attack folders of mission 12 (18), mission 9's `unused_Gg#bunker` (2) and mission 8's
  `unused_Gdd#blocked_stone` (4). They are in the JSON for completeness.
* Deactivating a node = every enabled trigger below it gets `OnDisabled` for its conditions and stops firing;
  its `enabled` flag is kept. Activating = the enabled triggers below start (`OnEnabled`), exactly like a `TRIG`
  enable [G].

Implementation: `nodeActive(trigger)` = no folder on its path is inactive. At load, mark every folder that
contains a `node_off` trigger directly as inactive (the flag is the only place the start state is stored; it is
per trigger, and all triggers of an inactive folder carry it [D]).

### 1.6 What does *not* exist in single player

* No built-in victory or defeat: `GameOverMgr` is only enabled for map type `multiplayer`
  (`Server/mgr/GameOverMgr.usl:95-103`) [S]. A mission ends only through `QUIT`, `SQNZ … quit = 1` (won) or
  `GAOV` (lost); "a hero died" is an ordinary trigger in every mission.
* No scripts per mission: there is no mission-specific code besides the triggers (the arena, the tutorial and the
  final Scorpio fight are all trigger-built). Objects with special behaviour (healing wells, cages, the Scorpio)
  are classes of the game, addressed by triggers through `ACDO`.

## 2. Object queries

Most conditions and actions select objects through the same parameter block, implemented by `CObjFinder`
(CF:407-758) and, for actions, `CActionObjFinder` (AF:167-222) [S]. A node can carry several queries, told apart
by a **prefix** on the parameter names: none (the subject, 3403 live uses), `dst_` (targets of `ACDO`, 652), `B_`
(second set of `SGHT` / `ISFG`, 115), `trgt_` (`COBJ`, `SPGR`, `CPLX`: where to create, 96), `sub_` (`TRSP`:
the passengers, 27). [D] 4293 queries in live triggers.

### 2.1 Parameters and the result (`MakeQuery`, CF:530-663)

| parameter | default | meaning |
|---|---|---|
| `rgn_guid` | `UniqueWorldRegion` | region the objects must be in. `UniqueWorldRegion`, an empty or an unknown GUID = the whole map (CF:455-458, 711-719). [D] 885 queries name a region, 3408 the world |
| `obj_name`, `obj_guid` | `NA` | one **named object** (or a group). If `obj_name` is not `NA` / empty, the query is "by name" and all filters below are ignored |
| `obj_type` | `All` | `|`-separated object types (`CHTR|ANML|VHCL|`; a trailing `|` is dropped): `CHTR` characters, `ANML` animals, `VHCL` vehicles, `SHIP`, `BLDG`, … (the 4-letter object types of the map). Contains `All` → no type filter |
| `obj_owner` | `-2` | owner player number; `-2` = any, `-1` = objects without owner |
| `obj_class` | `NA` | exact class name (`hu_worker`); `NA` / empty = any |
| `exclude_class` | – | `|`-separated classes to leave out (44 ×) |
| `char_tribe`, `char_caste`, `char_level` | `All`, `All`, `-1` | character filters. [D] never set in a live trigger: ignore |
| `from_condition` | `-1` | actions only, see §2.5 |

Result, in this order [S]:

1. **By name** (`obj_name` set; 1409 ×, 276 of them a group): find the object by `obj_guid`; if there is none,
   by its name (CF:535-539). Not found → empty result. If it is a group (type `GROU`), take its valid members
   instead (CF:543-551). Then **keep only those inside the region** (CF:556-562). Type, owner and class filters
   are *not* applied.
2. **By filter**: all objects in the region with
   * a type from `obj_type`, unless the string contains `All` anywhere - so `AllNC` (69 ×; the editor's "all,
     no characters"?) behaves exactly like `All` here (CF:568) [S];
   * owner = `obj_owner` unless `-2`; class = `obj_class` if set; class not in `exclude_class`;
   * if `obj_type` contains `All`: without objects of type `OTHR` and without food objects (corpses, fruit;
     CF:619-627) - "all" means "all real things";
   * without `CVirtualProduceUnit` (the placeholder object of a unit in production, CF:632-639);
   * a group object in the result is replaced by its members (CF:641-658).

   The `All` query returns everything that has an owner filter match - including buildings, trees (owner -1),
   resources. [D] with `obj_owner -2` and no class an `All` query is only used where the result does not matter
   (the unused `dst_` block of most `ACDO`).

The order of the result is the engine's (creation order [G]); only "first object" uses depend on it (`COBJ`
`pos_from_obj`, §5.3).

JSON: the export keeps the raw parameters in `node.p` and adds nothing; resolve `obj_guid` through
`doc.refs[guid]` = `[kind, name]` (kind `object`, `group`, `region`, `trigger`, `quest`, …). `doc.defaults`
holds the defaults per node type - **apply them to every node before use** (the editor stores only parameters
that differ from the default).

### 2.2 Membership test (`Contains`, CF:721-757)

`ISFG` (and nothing else in the campaign) asks "does this one object match the query" instead of running it:

* not in the region → no;
* by name: yes only if the object's GUID equals `obj_guid` or its name equals `obj_name` - a **group** named
  here does *not* match its members [S]. [D] 9 `ISFG` conditions name a group in `B_`; by the script they can
  never become true (the designers' "player attacked group X" never fires; §8 no. 12);
* by filter: the object's type must be one of the `|` tokens unless one token is exactly `All` (here `AllNC`
  is *not* a wildcard and matches nothing); then owner, class and `exclude_class` as above.

### 2.3 Count expressions (`CHelper.Compare`, CF:2754-2781)

`REGN.obj_count`, `BLDG.value`, `CKGR.check_val`, `PLYR.attrib_value` and `CVAR` compare an integer `a` with a
string:

| string starts with | test |
|---|---|
| `>=n` | `a >= n` |
| `>n` | `a > n` |
| `<=n` | `a <= n` |
| `<n` | `a < n` |
| `==n`, `=n` | `a == n` |
| `!=n` | `a != n` |
| a bare number `n`, or empty (= 0) | `a >= n` |

`n` may be `$(name)`: the current value of the level variable `name` (CF:2715-2744); the text between `$(` and
`)` is looked up in `Variables/<name>`, a missing variable gives 0. Only one `$(…)` per string, and it replaces
the whole string. A condition that uses `$(` re-evaluates whenever any level variable changes (§3).

### 2.4 Objects that are not on the map

[D] 157 references in triggers name an object (GUID + name) that the map does not contain:

* 37 have a stale GUID but the **name** exists (the object was deleted and placed again): they work through the
  name fallback of §2.1. The export resolves them (`refs[guid] = ["object", name, "by name"]`).
* 87, plus 33 entries of GUID lists (`ADGR`, `AIAM`, `AILU`), name objects that exist under no name (`"Cole_s0_0"` in the tutorial where the map has
  `Cole_s0_1`; `"livingstone_s0_7"`; the arena's `hc_colloseum_small_gate_n`; mission 9's bunker crew in a
  folder called `unused`). They are leftovers of deleted objects: the query finds nothing and the node does
  nothing (`doc.warnings` lists each). One consequence to keep: a `DEAD` condition on such an object is true as
  soon as it is checked ("never existed", §4.2).

Objects created at run time (`COBJ`, `SPGR`, `CPLX`, the start army) get an engine-generated name of the same
form as the editor's, `<class>_<n>` [G]. No live trigger depends on such a name: the campaign always addresses
run-time objects by class + owner (+ region), or through the **group** they were spawned into (§6.6). The remake
may name them freely.

### 2.5 `from_condition` and `trigger obj`

* `from_condition = i` (`i >= 0`; **0-based** condition index; AF:206-215) [S]: the action does not run its own
  query but takes the result objects of condition `i` of the same trigger, if that condition has a query
  (`m_xResultObjects` - filled by `REGN`: the objects that were in the region when it was last evaluated).
  [D] used once (mission 7: "the unit that entered the region walks on"). Implement for `REGN` only.
* The owner value `trigger obj` of `MPNG` (§5.2) = "the owner of each object of the query".

## 3. Level variables (`VARS`, `CVAR`, `$(name)`)

A level has named variables in its level info (`Variables/<name> { type, value }`; JSON `variables`:
`{name: {type, value}}`). [D] 260 are declared in the 17 maps, all of type `int`, 221 start at 0. Three are
maintained by the game itself and not used by the campaign: `_Internal_NumPlayers`, `_Internal_NeededDeadEnemies`
(`StartLocation.usl:159-166`), `_Internal_DeadEnemyCnt`.

* **VARS** action (327) `varname`, `operation` (`set` 168, `+` 139, `-` 19; also `*`, `/`), `value`, `local`
  (1; 0 = a variable of the player's profile, kept between missions - not used) — `CActionVars`, AF:3955-4114
  [S]. An unknown variable is created as `int` 0. `set` stores the value string as it is; the arithmetic
  operations convert both sides with the variable's type (`int`: integer arithmetic, a division by 0 changes
  nothing). Afterwards **every subscriber of the level variables is notified** (`NotifyVarsChange`): all `CVAR`
  conditions, and `REGN` / `PLYR` / `CKGR` conditions whose count expression contains `$(`, re-evaluate.
  [D] `value` is `1` (306 ×), `0`, `3`, and twice `=1` with operation `set`: that stores the string `"=1"`, which
  a `CVAR … == 1` never matches (a designer's slip; `int("=1")` is 0 for the numeric comparisons).
* **CVAR** condition: §4.3.
* `$(name)` inside a count expression (§2.3), in `CVAR.value` and in the info bar text (§6.4) is replaced by the
  variable's current value (`CHelper.GetValueString`, CF:2715-2744; an unknown name gives an empty string = 0).
* The `BLDG` condition can write its count into a variable (§4.2).

## 4. Conditions

A condition is an object with a **state** (0 or 1), created from its parameters when the level loads. The engine
calls `OnEnabled()` when the trigger (and the node, §1.5) becomes active, `OnDisabled()` when it stops, and the
condition calls `SetState(0|1)` + `Invalidate()` whenever something it has subscribed to pushes an event
(`OnPush`). `Invalidate()` makes the trigger re-evaluate its expression (§1.1). Two kinds result:

* **level conditions** keep their state (REGN, CVAR, QUES, BLDG, OBJP, PLYR, TECH, DIPL, SGHT, CKGR …): true as long
  as the thing they test holds;
* **pulse conditions** do `SetState(0); SetState(1); Invalidate()` on an event (TIME, TRUE, TIMR, RTME) or
  `SetState(1); Invalidate(); SetState(0)` (ITEM, WAYR): they are true at the moment of the event. TIME / TRUE /
  TIMR / RTME then *stay* 1 until the condition is enabled again or pulses again - which matters in expressions
  like `1 && 2` (a `TIME` that has run out stays true while the trigger waits for the second condition) [S].

Numbers after the name = occurrences in the 17 campaign maps. "query" = the object query block of §2 (prefix in
brackets when the parameters carry one). Parameters not listed are editor decoration. File references:
CF = `Server/misc/ConditionFactory.usl`.

### 4.1 Time

* **TIME** (1059) `duration` (seconds, float; missing = 0), `show` (0), `countup` (0), `reset` (default **1**),
  `repeat` (unused by the script) — CF:81-232 [S].
  `OnEnabled`: state 0, start a one-shot timer of the remaining time (`duration` on the first start or when
  `reset = 1`; with `reset = 0` a disabled timer keeps the time it had left, CF:167-175). When the timer fires
  (`OnPush`, CF:108-128): state 0 → 1, `Invalidate()`; then, if the trigger is **not** `once`, the timer restarts
  with the full duration (`OnEnabled()` again, which sets the state back to 0 after the trigger has been
  evaluated) — so a non-once trigger with a `TIME` condition fires **every `duration` seconds**; if the trigger is
  `once` the timer is deleted. `show = 1` (13 ×, tutorial and the countdown missions) shows a countdown on the
  client: `Counter Start <now> <duration> <remaining> <countup>` / `Counter Stop` (CF:145-149, 177-180); the HUD
  shows it as the mission clock. [D] 396 of 1059 are "1 second after the trigger was enabled" = the campaign's way
  to chain triggers; `duration` 0 (79 ×, parameter missing) fires on the next timer tick.
* **RTME** (37) `Min`, `Max` (seconds, int) — CF:3741-3806 [S]. `OnEnabled`: one-shot timer of
  `max(Min, random() % Max)` seconds: with probability `Min / Max` exactly `Min`, else uniform between `Min` and
  `Max - 1` ([D] `Max > Min` in all 37; "attack waves every 5-15 minutes"). On expiry: pulse (0 → 1,
  `Invalidate`), and if the trigger is not `once` the timer restarts with a new random time.
* **TIMR** (38) `timer_id` (0) — CF:272-324 [S]: pulses when the level timer with that id runs out (the `TIMR`
  *action* creates it, §6.3; `ObjTime.usl:161-180` walks all triggers and pushes every `CConditionTimer` with the
  same id). No own timer, nothing happens on enable.
* **TRUE** (561) no parameters — CF:234-270 [S]: pulses in `OnEnabled` (state 0 → 1, `Invalidate`). I.e. "fire as
  soon as this trigger is enabled": the body of a sub-routine that other triggers call with `TRIG`. A non-once
  trigger whose only condition is `TRUE` fires once per enabling (it does not loop: nothing invalidates it again).

### 4.2 Objects (all contain a query)

* **REGN** (701) query + `obj_count` — CF:850-1033 [S]. State = `Compare(number of objects the query returns,
  obj_count)` (§2.3: `>0` 424 ×, `<1` 171 ×, a bare number = `>=`). Evaluated when the condition is enabled (CF:789-801) and re-checked whenever the **region** of the
  query reports a change (an object entered or left it, was created or removed in it: the condition subscribes to
  the region, CF:804-812, and re-runs the query on every push, CF:818-821) and when a `$(variable)` used in
  `obj_count` changes (CF:920-936). 170 use `UniqueWorldRegion` = "does such an object exist at all" (e.g. "no unit
  of player 3 left": `obj_owner 3`, `CHTR|ANML|VHCL|`, `<1`).
  Special case (CF:873-917): if `obj_type` is exactly `GROU` and the object given by `obj_guid` is a group, the
  condition is true when **every member of the group** is among the query result (the query then runs with the
  type filter removed and - because `obj_name` is set - returns the group's members that are inside the region,
  §2.1 rule 1; so: "the whole group is in the region"); with an empty group it falls back to the count test.
  `OnDisabled` sets the state to 0.
* **DEAD** (121) query — CF:1349-1472 [S]. On enable the query runs once and the condition subscribes to the
  *deletion* of each object found (and to the region, to pick up objects that enter the query later). State: 1 as
  soon as **one** of them is deleted (`OBJCHNGE` push, CF:1430-1433) - it is an "any of" condition, [D] almost
  always used with a single named object (87 of 121) or a hero class. On a region push the subscriptions are
  refreshed and the state becomes 1 if the query finds nothing at all ("fire always if all objs are already dead
  or never existed", CF:1437-1442), else 0.
  "Deleted" = the object is removed from the world (the corpse has vanished / the building has collapsed).
* **DYIN** (72) query — CF:1478-1596 [S]. The same subscriptions; state 1 on the first deletion event and it then
  **stays 1** (CF:1558-1562); unlike `DEAD` it never becomes true because the query is empty. [G] the name
  suggests the event comes when the object starts dying; the script subscribes to the same `SubscribeObjDel`
  source as `DEAD`, so the remake may treat both as "object removed" (§8 no. 7); firing both at the moment of
  death (hit points 0) is the safer choice for heroes because `GAOV` triggers hang on them.
* **OBJP** (42) query + `attrib_name`, `attrib_value` (`<`, `>`, `=`, `<=`, `>=` + integer; no operator = `==`),
  `attrib_max` — CF:1165-1343 [S]. Subscribes to attribute changes of every object of the query. On a change of
  one object: value = the object's integer attribute `attrib_name`; if `attrib_max` is given and that attribute
  is > 0, value = `value * 100 / max` (integer percent). State = compare(value, number) **of the object that
  changed last** (it is not an "any" or "all" over the set; on enable all objects are checked in order and the
  last one wins, CF:1208-1216). [D] `hitpoints` (22; with `attrib_max = maxhitpoints` 17 × = percent, e.g. `<35`),
  `level` (16; 0-based: `>1` = level 3 or more), `GateState` (3), `CurTask` (1).
* **ITEM** (15) query + `item_class` — CF:2813-2977 [S]. Pulse when an item of class `item_class` is picked up
  (`ITEMTAKE` event of the item) by an object that the query returns (`item_whatever` = any taker). Also true on
  enable if an object of the query already carries an item (CF:2854-2869: it only looks at the first inventory
  slot). [D] query = player 0's units or a hero class.
* **BLDG** (120) query (only its region is used) + `class`, `owner` (0), `value` (count expression), `variable` —
  CF:2983-3149 [S]. Counts the objects **in the region** with class `class` and owner `owner` that are finished
  (`CurTask != "BuildUpB"`, registered with the building manager, not marked for deletion). State =
  `Compare(count, value)`. Re-evaluated on every "buildings changed" event of that owner (`BLDGCHG`:
  construction finished / destroyed) and on enable. If `variable` is set, the count is also written to that
  level variable (created as int if missing) and variable subscribers are notified (CF:3081-3103).
  [D] "player has built a `hu_arena`", "`aje_tesla_tower` >=3 in region".
* **SGHT** (52) query A + query B (`B_` prefix) — CF:3243-3326 [S]. Polled every 2 s (and once on enable): state =
  `ObjMgr.CheckVisibility(A objects, B objects)` - true when at least one object of A sees one of B [G: the engine
  function is not in the scripts; "sees" = B is inside the fog-of-war sight range of an A object]. Level
  condition.
* **ISFG** (66) query A + query B (`B_`) — CF:3653-3739 [S]. Subscribes to the "Attacked" event of the owner of B
  (`B_obj_owner`; all players if missing). On every attack event `(victim, attacker)`: state = `A.Contains(attacker)
  && B.Contains(victim)` (§2.2), then `Invalidate()`. So it is true at the moment **an A object attacks a B
  object** and false again at the next attack that does not match. [D] A = player 0's units (61 ×), B = an enemy
  group / owner: "the player has attacked …".
* **WAYR** (24) query — CF:3328-3395 [S]. Pulse when an object that the query returns reaches the **end of its
  waypoint path** (`OBJ_WYPT` event from the walk task of a `WYPT` action, §5.3).
* **CKGR** (59) `group_guid`, `check_val` (count expression) — CF:3399-3508 [S]. State = `Compare(member count of
  the group, check_val)`, evaluated on every `GROU_CHG` event of the group (members added, removed or died) and
  once on enable (`pxGroup^.Invalidate()` makes the group send its count). [D] `<1` 49 × = "the spawned group is
  dead".
* **UNTT** (5, tutorial only) `condition_type` (`CAME` camera moved: `camera_event` scroll / zoom / pan; `TRMO` a
  unit of query B mounted a transporter of query A; `USEL` a unit of the query was selected), `window_type`,
  `gameplay_command`, `selection_option`, `param`, `param2` — `UniversalTutorialCondition.usl` + engine class
  `IUniversalTriggerCondition` [S partly]: pulses when the player performs the UI action. The other condition
  types of this class (open a window, give a command) are not used by the shipped maps.

### 4.3 Players and level state

* **CVAR** (497) `varname`, `operation` (`==` 405, `>` 67, `<` 20, `=` 3, missing 2), `value`, `local` (1 = level
  variable, the only kind used) — CF:2455-2634 [S]. Level condition on a level variable (§3): `==` compares the
  two **strings**; any other operation goes through `Compare(int(variable), operation + value)` (so `=` is a
  numeric `==`, and a missing operation means `>=`). `value` may be `$(othervar)`. Re-evaluated when any level
  variable changes and on enable. An unknown variable leaves the state at 0.
* **QUES** (143) `quest_guid` (fallback `quest_name`), `dest_state` (0), `owner` (unused) — CF:2193-2296 [S]. True
  when the quest is: `0` visible · `1` accomplished · `2` unaccomplishable · `3` none of the three. Checked on
  enable and on every quest change; once true the condition stops listening (stays 1).
* **PLYR** (19) `player_id` (0), `attrib_name`, `attrib_value` — CF:1039-1159 [S]. State =
  `Compare(player attribute as int, attrib_value)`; re-checked on every change of the player's attributes.
  [D] `food`, `wood`, `stone`, `iron` (= skulls), `units`.
* **TECH** (47) `filter`, `player` (0) — CF:330-405 [S]. True while the player's tech tree has the filter
  `filter` (or `/` + `filter`). Re-checked on every push from the player (attributes / tech tree change), **not on
  enable** (`Initialize` only subscribes). [D] `Filters/<Tribe>/Upgrades/<main building>/age_N` = "the player
  has reached epoch N"; `Filters/Items/item_amulett1_filter` = "the item has been used".
* **PLDE** (45) `player_id` (0), `check_producer` (default 1), `check_bldgs` (0), `check_none` (0),
  `check_pyramid` (default 1) — CF:1701-2026 [S]. "The player is defeated." Whenever one of the player's
  objects (BLDG / ANML / VHCL / CHTR / SHIP) is deleted, a flag `canFire` is computed, and the condition becomes
  true when the player's `UnitLost` event arrives while the flag is set. The flag is true when, not counting the
  object just deleted,
  1. (`check_pyramid = 1`) the player has no object left that counts in the unit limit, **and**
  2. mode `check_producer = 1` (default): no object left that can produce units (a building or unit that is a
     `locations` entry of a `Build` action of its tribe, CF:1710-1757); mode `check_bldgs = 1` (when
     `check_producer = 0`): no building left except walls, gates and traps; mode `check_none = 1`: nothing more.
  [D] 22 have `check_pyramid = 0`; 12 use buildings mode ("the base is destroyed"), 4 `check_none` with pyramid
  = "all units dead".
* **DIPL** (13) `plyr1` (0), `plyr2` (0), `relation` (0) — CF:2637-2711 [S]. State =
  `DiplomacyMgr.GetRelation(plyr1, plyr2) == relation` (0 hostile, 1 neutral, 2 friendly, §5.4), checked on enable
  and whenever diplomacy changes (the `DIPL` action pushes all pending conditions, AF:3285-3296). [D] "player 1 /
  6 has become hostile to the player" (relation 0, the player attacked a neutral).
* **SQEN** (165) `sequence_name` — CF:2301-2380 [S]. When any sequence ends, the sequence source pushes its file
  name: state = (file part equal, case as stored), `Invalidate()`. So it is true from the end of that sequence
  until the end of the next, different one.
* **DSEN** (163) `dlgscene_name` — CF:2382-2449 [S]. State 1 when a dialogue scene with the same file name ends
  (never reset to 0).

Defined but not used by the campaign: `CHKO` (count objects by name prefix), `TSKA` (an object entered / left a
task), `TRIB` (tribute paid), `DGBL` (dimension gate built), `AIFE` (an AI attack has ended), `OBJC` (base class).

## 5. Actions

An action is created from its parameters when the level loads and executed (`OnPush`) when its trigger fires
(§1.4). Every action has the editor-only parameters `renderable` / `renderable_type` (ignore) and the stored
`difficulty` (§1.4; in the JSON it is `action.difficulty`, not in `p`). Numbers = occurrences in the 17 maps.
"query" = the object query of §2. AF = `Server/misc/ActionFactory.usl`. The actions are grouped by what the remake
needs for them:

| group | types |
|---|---|
| 5.1 flow | `TRIG` 2972, `DGSC` 380, `FDBK` 300, `SQNZ` 122, `GAOV` 39, `ACND` 22, `QUIT` 12, `BONI` 2 |
| 5.2 quests, markers, UI | `QUES` 346, `QMRK` 310, `MPNG` 299, `TIMR` 97, `PSND` 60, `INBA` 27 |
| 5.3 objects | `ACDO` 691, `SPGR` 408, `OBAP` 194, `WYPT` 158, `COBJ` 129, `DELO` 107, `OCPY` 79, `CPLX` 58, `ADGR` 54, `REPL` 53, `TRSP` 27, `UNIT` 8, `EFCT` 6 |
| 5.4 players, world | `VARS` 327 (§3), `RSRC` 52, `DIPL` 46, `SNFA` 44, `TECH` 40, `PLCP` 30, `BLSL` 19, `POPL` 8, `ARGN` 8, `MRGN` 1 |
| 5.5 fog of war | `SFOW` 145 |
| 5.6 AI | `AIFT` 101, `AIBV` 93, `AIAM` 44, `AIDA` 30, `AILU` 27, `AIRG` 13 |

### 5.1 Flow
* **QUIT** (12) `result` (`Exit_0`, unused): the mission is **won** - `GameOver Campaign Win` is sent to player 0
  (`CActionQuit`, AF:518-557) [S].
* **BONI** (2) `points`: adds to the level attribute `BoniTotal` (`CActionGiveBoni`, AF:562-608) [S].
* **TRIG** (2972) `guid`, `state` — `CActionTrigActive`, AF:2203-2253 [S]: §1.3.
* **ACND** (22) `nodename`, `deststate` — `CActionNode`, AF:2869-2914 [S]: §1.5.
* **GAOV** (39) `player_id` (0), `reason` (text key `_GAOV_…`) — `CActionGameOver`, AF:2466-2539 [S]: the
  mission is **lost**. The AI is told at once (`CAiInterface.GameOver(player, true)`); after a 4 second timer
  `GameOver Campaign Lose <reason>` is sent to the player (the client shows the defeat screen with the reason
  text). A second `GAOV` while the timer runs is ignored.
* **SQNZ** (122) `sequence` (path of a `.seq` below `Data/Base/Sequences`), `quit`, `reason`, `snap_cam_back`,
  `snap_actors_back`, `camera_data` (a position, or `0.0, 0.0, 0.0` = none), `disable_fow`, `fow_pos`,
  `fow_radius` — `CActionSequence`, AF:1976-2095 [S]: fills a `CSequenceInfo` and calls
  `CSrvWrap.StartSequence` - the sequence itself is played by the engine (§6.8). When it ends, every `SQEN`
  condition is pushed with the file name (§4.3); with `quit = 1` (10 ×) the mission is **won** when the sequence
  ends (`m_bQuitAfterSequence`). `disable_fow = 1` (93 ×) lifts the fog of war during the sequence; `fow_pos` +
  `fow_radius` name the area to reveal for it. `snap_cam_back` = the camera returns to where it was,
  `snap_actors_back` = the actors are put back where they stood. [D] **every mission ends through a sequence**
  (`SQEN` → `QUIT`, or `quit = 1`), so a runtime without cutscenes must still deliver the "sequence ended" event.
* **DGSC** (380) `scene` (path of a `.dlg` below `Data/Base/DialogScenes`) — `CActionDialogScene`, AF:2098-2139
  [S]: `CSrvWrap.StartDialogScene(scene)`; §6.5.
* **FDBK** (300) `msg_text`, `player_id` — `CActionFeedback`, AF:2144-2198 [S]: prints a system message, but only
  if the config value `Server/Trigger/EnableFDBK` is set (default false, AF:2168-2171). [D] all 300 are designer
  debug texts ("!!! PATROL 01A SPAWNED !!!", "4. Gruppe"): **ignore** (the exporter's text dump shows them
  because they document the designers' intent).

### 5.2 Quests, markers, UI

* **QUES** (346) `quest_guid` (fallback `quest_name`), `dest_state` (missing = 0), `owner` (unused) —
  `CActionQuest`, AF:2544-2642 [S]:
  `0` → accomplished = false, visible = true ("show the quest", 137 ×) · `1` → accomplished = true, visible =
  true, and the quest's bonus for the current difficulty (`bonus.easy / medium / hard` for
  `Base/CurrentDifficulty` 0 / 1 / 2) is added to the statistics (main or side quest points) and to the level
  attribute `BoniTotal` (139 ×) · `2` → unaccomplishable = true, visible = true ("failed", 70 ×) · `3` → visible
  = false (not used). §6.1.
* **MPNG** (299) minimap marker — `CActionMapPing`, AF:2919-3062 [S]. Parameters: `pos`, `owner` (`All`, a
  player number, `trigger obj`), `pos_objquery_flag`, query, `extended` (0), `add_remove` (0), `id`,
  `time_to_life` (default 5000), `num_repeats` (default 5), `ms_between` (default 500), `colortype` (default
  `FixedColor`; [D] `SPMainQuest` 165, `SPOptQuest` 92, `SPHint` 36, `Attack` 6), `fixedcolor` (`r:g:b`, default
  `255:0:0`). The marker position is `pos` if `pos_objquery_flag = 1` **and** `pos` is not `[0 0 0]`
  (AF:2941); otherwise one marker per object of the query at the object's position (AF:2992-3013). It is sent
  to the client(s) of `owner` (`All` = every player; `trigger obj` = the owner of each query object, or player
  0 for a fixed position) as
  `MiniMapEvent <pos> <colortype[:r:g:b]> <extended> <add> <id> <time_to_life> <num_repeats> <ms_between>`.
  `add_remove = 0` (or missing) **adds** the marker `id`, `1` **removes** it (145 ×: quest done). [D] quest
  markers are permanent (`time_to_life 0`, `num_repeats 0`: 272 ×) and are removed by a second `MPNG` with the
  same `id`; 13 blink (`4000` ms life, 30 repeats, 1000 ms apart). `extended = 1` (298 ×) = the big animated
  ring also shown in the 3D view [G].
* **QMRK** (310) `questionmark` (GUID of a `QMRK` object), `questionstate`, `questiontooltip` (text key) —
  `CActionQuestionMark`, AF:5894-5949 [S]: `SetState(state)` + `SetToolTip(key)`; §6.2.
* **INBA** (27) `text` — `CActionInfoBar`, AF:5351-5419 [S]: sets the level attribute `InfoBarText`; missing /
  empty (13 ×) clears it. §6.4.
* **TIMR** (97) `timer_id` (default 1), `event` (default `create`), `duration`, `show` (default 1), `repeat`,
  `tooltip` — `CActionTimer`, AF:6006-6106 [S]: §6.3.
* **PSND** (60) `soundname` (a sound event name), `soundtype` (3), `player` (missing = 0; -1 = all players),
  `position` — `CActionSound`, AF:4219-4274 [S]: `CSoundEvent.PlayAll / PlaySingle(name, type, pos[, player])`.
  [D] arena crowd (`lvl11_arena_cheer`, `…_boo`), Leighton's loudspeaker lines (`Setting_14_Leighton_n`).

### 5.3 Objects

All of these select their objects with a query (§2); "per object" means for every object the query returns, in
the query's order.

* **ACDO** (691) query (the actors) + `action`, `additional_params`, a second query with prefix `dst_` (the
  targets), `check_subj` — `CActionObjDo`, AF:1112-1692 [S]. For every actor `HandleAction(actor, targets)`. A
  **group** named in the query is expanded to its members (§2.1): every order goes to each member.
  `additional_params` is split at `|`. Actions used by the campaign (count):
  * `WalkAction` (135) `"[x y z] | speed"`: walk to the point (a unit inside a transporter is taken out first,
    AF:1186-1192); command `Action /Walk /Speed=<speed>` (AF:1424-1426). Speed: 1 slowest … 4 run ([D] 2 in almost
    all; speed table in moves.md). Both tokens are required, otherwise nothing happens (AF:1183).
  * `Aggressive Walk` (104) `"[x y z] | n"`: attack-move to the point (`Action /AggressiveTarget`, AF:1196-1197);
    the number is ignored. [D] 31 have a `dst_` query filled in - it is not used by this action.
  * `Attack` (108): the actor attacks the target of the `dst_` query **nearest to it** (`Action /Attack` with that
    object, AF:1440-1450); no target → nothing.
  * `SetPos` (75) `"[x y z] | n"`: teleport: break the current task, `SetPos` (AF:1207-1217).
  * `RotateTo` (11) `"[x y z] | n"`: break the task and turn to face the point (AF:1198-1206).
  * `SetAnim` (64) `"name | loops"`: break the task, play the animation `name` once, or `loops` times if
    `loops > 1` (AF:1452-1472). [D] `open | 1` / `close | 1` (52 ×) on scenery gates (arena gates `hc_…`,
    cages), `spawn_anim`, `potter | 5000` (a looping idle).
  * `Invulnerability` (54) `Enable` (31) / `Disable` (22) / `Timer: <seconds>` (1): `SetLDInvulnerable(true |
    false)` = the level designer's invulnerability flag; `Timer` makes the object invulnerable for that many
    seconds (`TriggerTimer`, AF:1496-1514). Split at `:`.
  * `AbortTask` (49): abort the current task (the unit stops and stands), AF:1482-1494.
  * `Stop` (1): `Action /Stop`.
  * `Kill` (31): `Action /Kill` - the object dies normally (death animation, `DEAD` / `DYIN` fire), AF:1474-1480.
  * `FullHeal` (3): hit points to maximum.
  * `Open Gate` (21) / `Close Gate` (14) / `Auto Gate` (1): gate command `Open` / `Close` / `Auto` (AF:1283-1297):
    open = stays open for everybody, close = stays closed, auto = opens for its owner's units.
  * `SetRallyPoint` (11) `"[x y z]"`: rally point of a building (ignored if the point is `[0 0 0]`).
  * `GiveItem` (7): the actor receives the first object of the `dst_` query as an item (`AddItem`), and that
    object is removed from the target list, so the next actor gets the next item (AF:1390-1395).
  * `BuildUp` (1): the actor (a worker) is ordered to build / finish the first building of the `dst_` query.
  * `JumpOffWall` (1): the actor leaves a wall.
  Defined, unused: `AdvanceAction`, `Coles Shotgun`, `Belas Throwdown-Shot`, `Disguise`, `oracle`, `entrench`,
  `lockpicking`, `TeslaLvl16Task`, `camouflage`, `LevelUp`, `Walk`, `FountainHeal`, `BoardTransporter`,
  `UnboardTransporter`, `AggroState`, `Notify`, `Hu Ladder`, `FeignDeath`, `RamAttack`, `BuildDown`, `Repair`,
  `AjeQuicksand`, `Whirlewind`.
* **WYPT** (158) query + `waypoints` (`x y z|x y z|…`, entries `0.0, 0.0, 0.0` are skipped), `patrolmode`
  (0), `walkspeed`, `straightwalk` (0), `ignorematerial` (0) — `CActionWaypoints`, AF:1769-1970 [S]. Every
  object (group members individually) gets `StartPatrol(waypoints, mode, speed, straight)`:
  mode 0 = walk the points once in order and stop (91 ×; reaching the last point sends `OBJ_WYPT` → `WAYR`
  condition, AF:33-39) · 1 = circular patrol 1 2 3 … n 1 2 … (47 ×) · 2 = back and forth 1 … n … 1 (20 ×)
  (AF:1771-1774). `straightwalk = 1` (29 ×, ships and flying objects): straight lines between the points instead
  of path finding. No waypoints → nothing.
* **COBJ** (129) `obj_name` (= the **class** to create), `obj_owner` (-1 = nobody), `obj_pos` (`x y z` or
  `x, y, z`), `obj_rot` (Euler angles in radians, only z = heading is used in the data), `obj_level` (0-based;
  missing = 0, -1 behaves as 0), `ignore_pyramid` (default 1), `pos_from_obj` (0) + query with prefix `trgt_`,
  `buildup` — `CActionCreateObj`, AF:745-896 [S]. Creates one object of the class at the position. With
  `pos_from_obj = 1` (8 ×) position and rotation are taken from the first object of the `trgt_` query (if any).
  With `ignore_pyramid = 0` (7 ×) nothing is created when the owner has no free unit slot of that level
  (`CheckUnits(owner, level)`). A fighting object gets the level (`SetLevelClean`), a building is finished at
  once (`SetReady`). The new object gets a generated name `<class>_<n>` (§2.4).
* **OCPY** (79) query + `new_owner` (missing = **0**, the human player; -1 = nobody), `chk_highlight`,
  `highlight_time` — `CActionOccupy`, AF:661-738 [S]. Sets the owner of every object. With `chk_highlight = 1`
  and `highlight_time > 0` the new owner's client highlights the object for that many seconds
  (`ocupy_unit <guid> <seconds>`, AF:695-699). [D] 54 give objects to player 0 ("the prisoners join you").
* **UNIT** (8) query + `attrib_name`, `attrib_mod` (`+n`, `-n`, `=n` or `n` = set) — `CActionUnit`, AF:227-328
  [S]: changes an integer attribute of every object and refreshes the unit. [D] only `hitpoints` (set to a value:
  wounded units, weakened bosses).
* **SPGR** (408) spawn a group — `CActionSpawnGroup`, AF:4766-5023 [S]. Parameters: `classes_0` (… `classes_4`;
  only `classes_0` occurs), `owner` (missing = **0**; -1 = nobody), `pos` (`x y z`), `group` (GUID of a `GROU`
  object), `checkpyramid` (0), `use_spawn_obj` (0), `spawn_delay` (seconds, 0), `num_stages` (5) + query (the
  spawn building).
  * `classes_n` = entries separated by `|`, each `<class>[§<buildup>] <level> <count>` (split at blanks). The
    level is **1-based** here (`level - 1`, never below 0, AF:4814-4818): `hu_warrior 2 3` = three warriors of
    level 2 (0-based 1). `§buildup` names the upgrade variant the object is created with (filter
    `/Filters/<tribe>/Upgrades/<class>/<buildup>`, e.g. `hu_wild_boar§wild_boar_rage`; 8 ×).
  * Without `use_spawn_obj`: every unit is created at `pos` (moved to the nearest free spot, AF:4922-4927), gets
    its level, looks for enemies at once, a building is finished at once, and each one is **added to the group**
    (AF:4949-4951).
  * With `use_spawn_obj = 1` (209 ×) the units come out of a building: the first object of the query is the
    source; an invisible `delayed_army_spawn` object gets one job per unit and creates **one unit every
    `spawn_delay` seconds** (the first immediately, after the source's `open` animation if it has one) at the
    source's link point `Spwn` (else its position); each new unit is added to the group, walks to the exit point
    (link `Ex_1`, else a free spot at the source) and then to `pos` (also set as the source's rally point);
    after the last job the source plays `close` (`MiscObj.usl:2291-2500`, AF:4862-4900, 4917-4920). If the query
    finds no source object, the units are created directly at `pos` as without a spawn object (AF:4867-4869,
    4917).
  * `checkpyramid = 1` (3 ×): a class is skipped when the owner already has the standard maximum of characters
    of that level (25 / 15 / 8 / 3 / 1, AF:4838-4842, counting only `CHTR` objects).
  [D] levels 2 (401 entries), 3 (225), 1 (189), 4 (42), 5 (10). 14 have no `owner` (= player 0: reinforcements
  for the player), 10 have no `pos` (they use a spawn object; `pos` `[0 0 0]` then means "stay at the exit").
* **CPLX** (58) create a transporter with passengers — `CActionComplexCreate`, AF:2644-2865 [S]. `obj_name`
  (class of the transporter), `obj_owner`, `obj_pos`, `cptlvl` (level of the transporter, 1-based), `passengers`,
  `buildup`, `ignore_pyramid` (default 1). The transporter is created at a free spot near `obj_pos` with level
  `cptlvl - 1`; 0.2 s later the passengers are created and mounted until it is full: `passengers` =
  `class/level[/(sub:level&sub:level…)]|…`, level 1-based; the optional third part lists passengers of a
  passenger that is itself a transporter (not used in the data). [D] `seas_hovercraft` 25, `hu_transport_ship`
  19, `aje_transport_turtle` 8, `ninigi_transport_boat` 6: the enemy landings.
* **REPL** (53) query + `new_obj` (class), `obj_level` (0-based, 0), `new_owner` (unused) —
  `CActionReplaceObj`, AF:4334-4406 [S]: only the **first** object of the query is deleted and an object of
  class `new_obj` is created at its position with its rotation and its **owner**; a fighting object gets
  `obj_level`. [D] barricades → `…_dest` (destroyed variant), `Stina_s0` → `special_eusmilus` (Stina mounts her
  sabre-tooth), bridges in / out.
* **DELO** (107) query + `maxobjs` (default -1) — `CActionDelObj`, AF:4276-4332 [S]: deletes the objects of the
  query without death animation (`Delete()`; `DEAD` / `DYIN` conditions on them fire); at most `maxobjs` of them
  if `maxobjs >= 0` - so `maxobjs = 0` (7 ×) deletes **nothing** [D: probably unintended].
* **ADGR** (54) query + `group` (GUID), `add_to_group_units` (GUIDs, one per line), `selector_enabled`
  (default 1) — `CActionAddToGroup`, AF:5026-5115 [S]: adds the query's objects (only if `selector_enabled = 1`)
  and the listed objects to the group. The listed GUIDs are resolved **when the level loads** (objects that do
  not exist then are dropped).
* **TRSP** (27) mount / dismount — `CActionTransportMounting`, AF:5117-5301 [S]. Query = the passengers
  ("objects"), query with prefix `sub_` = the transporters ("subjects"), plus the GUID lists `objects_units` /
  `subjects_units`, `enable_objsel` / `enable_subsel` (default 1: use the queries), `mount` (0).
  `mount = 1` (8 ×): every transporter that is not full takes the nearest passengers that are not mounted yet,
  as many as it has room for (`BoardTransport`: they walk to it and board); a bunker takes all characters.
  `mount = 0` (19 ×): every object of the first query that is a transporter (or bunker) **unloads all**
  passengers (`DismountAll`) - a transporter only if it is idle and carries more than one passenger; the first
  that does ends the action (AF:5240-5261).
* **EFCT** (6) `effect_path`, `loop_value`, `pos`, `rot`, `use_objquery` + query — `CActionEffect`, AF:6108-6182
  [S]: plays a particle effect `loop_value` times at `pos`, or at the first object of the query if
  `use_objquery = 1`. Decoration.
* **OBAP** (194) query + `flags` (missing = 0) — `CActionObjAppear`, AF:2258-2337 [S]. Bits: 1 visible · 2
  hitable (can be targeted / hit) · 4 selectable · 8 constructible · 16 destructible · 32 deconstructible · 64
  blocker (not applied, AF:2304-2305). **All** properties are set from the bits at once: `SetVisible`,
  `SetHitable`, `SetSelectable` (when cleared, the owner's client deselects the object), `SetConstructible`,
  `SetDeconstructible`, `SetDestructible`. [D] `0` (77 ×) = make the object disappear (invisible, not hitable,
  not selectable: this is how "removed" scenery, hidden reinforcements and used items are done) · `1` (92 ×) =
  visible only (scenery, effects) · `7` (15 ×) = a normal unit appears · `71`, `65`, `3`, `15` rare. Objects
  placed with `visible = false` in the map (JSON `objects[].visible`) wait for an `OBAP`.

### 5.4 Players, world

* **VARS** (327): §3.
* **RSRC** (52) `player_id` (0), and either `res_name` + `res_mod` (+ `res_cap`) or `res_rsrclist` =
  `name|mod|cap:name|mod|cap…` — `CActionRessource`, AF:334-511 [S]. `mod` = `+n`, `-n`, `=n`. With `cap = 1`
  the result is limited to the player's `max_<name>` (not for `iron`); a subtraction never goes below 0. Names:
  `food`, `wood`, `stone`, `iron` (= skulls). If the list is not empty the single parameters are ignored
  (AF:373, 414) - [D] the editor always writes the list too (51 of 52), all with cap 0.
* **TECH** (40) `filters` = lines `player|action|path` — `CActionTechTreePages`, AF:2343-2461 [S]: action `1`
  = `EnableFilter(path)`, `0` = `DisableFilter(path)` on the player's tech tree definition. Paths
  `/Filters/AntiActions/<Tribe>/Build/<TYPE>/<class>` or `…/Upgrades/<building>/<upgrade>`: an *enabled
  AntiAction* **forbids** the build / upgrade; disabling it allows it again ([D] trigger notes "allow mammoth
  units in techtree" disable AntiActions). The same paths are the players' start filters (`tech_filters`).
* **DIPL** (46) `changes` = lines `plyr1|relation|plyr2` — `CActionDiplomacy`, AF:3246-3334 [S]:
  `DiplomacyMgr.SetRelation(plyr1, plyr2, relation)` per line, i.e. **one direction per line** ([D] the
  designers write both directions: `0|2|4` + `4|2|0`). Relation values: **0 hostile, 1 neutral, 2 friendly** -
  from the level start code (§6.7) and [D] ("0|0|1 … cole arrives, war", "0|2|3 Norsemen become allies"); the
  constants `RELATION_FRIEND = 0 … RELATION_ENEMY = 2` in AF:3248-3250 are unused and misleading.
* **POPL** (8) `player_id` (0), `limit` — `CActionPopulationLimit`, AF:3069-3137 [S]: sets
  `PlayerSettings/Player_<n>/Restrictions/Chars/Population/Max` and sends the level info to the clients: the
  population limit (JSON `players[n].population_limit`).
* **BLSL** (19) `player_id` (0), `open_1 … open_5` — `CActionBlockSlots`, AF:3143-3241 [S]: sets
  `…/Restrictions/Chars/Level<i>/Max` = `open_i` for i = 1…5 (missing = **0** = no unit of that level allowed):
  the number of unit slots per level in the army pyramid (JSON `players[n].unit_limits`). [D] the first
  missions open the pyramid step by step: `25 / 15 / 8 / 0 / 0`.
* **PLCP** (30) `player` (0), `food`, `wood`, `stone` — `CActionPlayerCaps`, AF:5595-5650 [S]: sets the player
  attributes `rescap_food / rescap_wood / rescap_stone` and calls `UpdateResCaps()`: the storage limits. [D]
  used on AI players before `RSRC` gives them resources.
* **SNFA** (44) `player` (0), `neutral` — `CActionSetNeutForAnml`, AF:5520-5592 [S]: value 1 or 3 → the player
  is added to `CNest.ms_aiNeutralPlayer` (animals of nests do not pick this player's units as enemies,
  `Animal.usl:361`); 0 or 2 → removed. Value 2 or 3 additionally sets the player attribute `neutral_to_anmls`
  (the player's units do not attack wild animals on their own). [D] `3` 28 ×, `2` 11 ×, `1` 4 ×: AI players that
  must not be bothered by / waste units on the wildlife.
* **ARGN** (8) `rgn_guid`, `sub_idx`, `dest_state` — `CActionActivateRegion`, AF:5652-5706 [S]: enables
  (`dest_state = 1`) or disables a region, or - if `sub_idx >= 0` - its shape number `sub_idx` (0-based). A
  disabled shape does not contain anything. [D] all 8 enable shape 1 … 3 of a nest's action area ("free the
  velociraptors": the animals may now roam the extra areas); the JSON marks such shapes `enabled: false`.
* **MRGN** (1) `rgn_guid`, `pos` — `CActionMoveRegion`, AF:5470-5518 [S]: moves the region to the position.

### 5.5 Fog of war

* **SFOW** (145) `pos`, `radius` (metres), `duration` (seconds), `owner` (0) + query — `CActionShowFOW`,
  AF:901-1044 [S]. Creates an invisible `ShowFOW_Obj` owned by `owner` that reveals a circle of `radius`:
  at `pos`, or - if `pos` is `[0 0 0]` (79 ×) - one **per object of the query, linked to it** (it follows the
  object, AF:939-960). `duration > 0` removes it after that many seconds; otherwise (`-1`, 72 ×, or 0) it stays
  for the rest of the mission. [D] `owner` is 0 except twice (player 1, the arena's governor).

### 5.6 AI actions (intent only; what the computer player does with them belongs to the AI port, `ai.md`)

* **AIBV** (93) `player_id` (0), `behavior`, `module` (default `CTRL`) — `CActionAiBehavior`, AF:3536-3613 [S]:
  `CAiInterface.SetModuleBehavior(player, module, behavior)`: switch the AI player's personality. Every AI
  player starts as `Mikrobe` (asleep). [D] `Turtle` 32 (build and defend, never attack), `Dodo` 20, `Mikrobe` 19
  (back to sleep), `Giraffe` 14, `FightOnly` 5, `Schnecke` 3; always module `CTRL`.
* **AIFT** (101) `player_id`, `attack_type`, `position_edit`, `spawn_position`, `all_the_way`,
  `attack_with_all`, `ignore_locations`, `custom_attack`, `target_obj`, `ship`, `ship_land`, `attack_behavior`
  + query (the targets) — `CActionAiFight`, AF:4463-4641 [S]: order an attack. With no target object nothing
  happens. All 101 have `custom_attack = 1`: `CAiInterface.SetCustomAttack(player, "type/onTheWay/withAll/
  ignoreLoc/pos/targetOnly/ship/shipLand/spawnPos/:handle:handle…")`. Intent: the AI player sends the army
  named `attack_type` (a table of unit classes per tribe; `attack_with_all = 1`, 81 ×: the units are **spawned**
  for the attack at `spawn_position` / the producing buildings instead of taken from the base) via
  `position_edit` against the targets; `ship_land` (17 ×) = the army arrives in a transport ship.
* **AIDA** (30) `player_id`, `id`, `position` (`[x,y,z]`), `radius`, `max_units` — `CActionAiDefendArea`,
  AF:3700-3774 [S]: defence module command `AddDefenseArea <id> <pos> <radius> <max_units>`: keep up to
  `max_units` units as guards in that circle (missing `max_units` = 0 removes the area `id`, 14 ×).
* **AILU** (27) `player_id`, `lock` (default 1), `units` (GUIDs, one per line), `enable_objsel` + query —
  `CActionAiLockUnit`, AF:3780-3949 [S]: `CAiInterface.LockUnit / UnlockUnit(player, guids)`: locked units are
  not used by the AI (they keep standing where the designer put them, or follow trigger orders); `lock = 0`
  (6 ×) hands them back. The unit list is built when the level loads: the `units` GUIDs plus, if
  `enable_objsel` is true, the query result at load time.
* **AIAM** (44) `aggro_state`, `aggro_state_units` (GUIDs), `selector_enabled` (default 1) + query —
  `CActionAiAggressionMode`, AF:4647-4764 [S]: every object gets the command `/AggroState_<n>` =
  `SetAggressionState(n)` (`FightingObj.usl:7094-7101`, `8696-8701`; ignored by berserkers): 0 stand ground,
  1 defensive, 2 aggressive (units.md §1.1). [D] `2` 27 ×, `1` 8 ×, missing = 0 9 ×.
* **AIRG** (13) `player_id`, `all_players`, `map_name`, `region_name`, `add_edit`, `value` — `CActionAiRegion`,
  AF:3339-3529 [S]: sets a weight for a named region in one of the AI's influence maps
  (`AddEditRegionRessources / Economy`). [D] `village_level X3` = 100 on a region ("build here"), `Enemy` /
  `BuildModifier` / `DefensiveCoverage` = -1 ("ignore walls / buildings here"), `WOOD`, `FOOD` -1.
* `AICM` (call a module command), `AIKH` (king-of-the-hill areas): not used.

## 6. Subsystems the triggers drive

### 6.1 Quests

JSON `quests[]`: `guid`, `name` (`L11MQ01`), `main` (main or side quest), `group`, `headline`, `description`
(objectives and hints as plain text), `bonus {easy, medium, hard}`, and the start flags `visible`,
`accomplished`, `unaccomplishable`. [D] 134 quests (82 main, 52 side), none visible at level start.

* State = the three flags. `QUES` action (§5.2): 0 show · 1 accomplish · 2 fail · 3 hide. `QUES` condition
  (§4.3) tests them.
* Quest log (QW = `Game/UI/QuestWindow.usl`) [S]: quests are listed under their group; the group title is the
  text `_<group>` (JSON `group_title`), side quests go under `_SubQuestGroup`; the entry title is
  `_<name>_Headline` (QW:295, 476-492), the long text comes from `Texts/Quests/<LevelName>.seml#<name>`
  (QW:410-417; exported as `description`). Only visible quests are listed; accomplished ones are ticked,
  failed ones crossed out.
* On a state change the news ticker shows `_NT_QuestNew` / `_NT_QuestAccomplished` / `_NT_QuestUnaccomplishable`
  with the headline and plays `ui_quest_new` / `ui_quest_accomplished` / `ui_quest_unaccomplishable` [S].
* **Bonus**: accomplishing a quest adds `bonus[difficulty]` to the level attribute `BoniTotal` (AF:2581-2600;
  also the `BONI` action). At the end of a won mission the next mission's army budget becomes
  `Credits = max(BoniTotal, credits of that mission in Campaigns.txt)` (CM:145-181) [S]. [D] 30 quests give
  nothing, the others 100 … 2000 points, the same on all difficulties. The budget only matters for the
  missions with an army-building screen (§6.7).
* A mission is not won by its quests: a trigger tests the last main quest (or a sequence end) and runs `QUIT`.

### 6.2 Question marks

`QMRK` objects (JSON `question_marks[]`: `guid`, `name`, position, `state`) are the floating markers over
quest givers and goals (`Server/classes/misc/QuestionMark.usl:1-97`) [S]. [D] 117 on the 17 maps, all start
invisible.

| `questionstate` | n | shown as (gfx, looping animation `anim`) | [D] use |
|---|---|---|---|
| `STATE_INVISIBLE` | 124 | hidden | done / not yet |
| `QM_STATE_YELLOW` | 89 | `questionmark_yellow` | a quest can be picked up here |
| `QM_STATE_GREEN` | 70 | `questionmark_green` | quest running: bring it here / target |
| `EC_STATE_YELLOW` | 19 | `exclamation_yellow` | exclamation mark: something to see |
| `QM_STATE_RED` | 8 | `questionmark_red` | cannot be done (yet) |

The object is selectable and hitable (it can be clicked); `questiontooltip` is a text key shown as its tooltip
(attribute `QuestionMarkToolTip`). It has no game effect of its own: "the hero walks to the marker" is a `REGN`
condition on a region around it.

### 6.3 Level timers (`TIMR` action and condition)

A level timer is an object with an id (`OT:1-180`, `CActionTimer` AF:6030-6072) [S]:

* `event = create` (default): if no timer with `timer_id` exists it is created (tooltip = `tooltip`); then it
  is (re)started with `duration` seconds - creating an existing timer **restarts** it. `show = 1` puts a
  countdown with the tooltip on the HUD. `repeat` is passed on but `Start` stores `repeat = false` (OT:126), so
  every timer is one-shot.
* `pause` / `unpause`: stop the clock and continue with the remaining time (OT:87-117); ignored if the timer
  does not exist. Any other value (`kill`): delete the timer.
* When it runs out (OT:136-179): **every `TIMR` condition with the same id in every trigger** gets pushed
  (state 1 + `Invalidate`, §4.1) - also in triggers that are disabled at that moment (their state then stays 1,
  which matters if such a trigger is enabled later and has a second condition) - and the timer is deleted.
* A `TIMR` condition does nothing on enable: if the timer has already run out before the trigger was enabled,
  the trigger does not fire for it.

[D] 97 actions. The arena uses timer 0 as "the next wave comes after n seconds at the latest" (33 × `create`
with `show = 0`, each restarting the same timer); mission 15 runs eight timers for its pumping stations and
pauses / continues them (8 × each); missions 6 and 12 show countdowns (`show` default 1) and kill them when the
task is done.

### 6.4 Info bar (`INBA`)

One line of text at the top of the screen (the game's countdown / score window; `IngameScreen.usl:1019-1036`)
[S]. `text` = `key<TAB>arg1<TAB>arg2 …`: the localized news-ticker text `key`, in which `%1`, `%2` … are
replaced by the arguments; an argument `$(name)` is the current value of that level variable, and the line is
refreshed when the variable changes [G: the substitution happens in the engine]. Empty `text` removes the
line. [D] 14 texts, e.g. `_L02mammoth<TAB>$(mammoths_saved)<TAB>$(Mammoth_Max)` ("mammoths saved: n of m"),
`_L05supportpoints<TAB>$(sum_of_spots)<TAB>$(available_spots)`. The texts are in `doc.texts`.

### 6.5 Dialogue scenes (`DGSC`, `DSEN`)

JSON `dialogs[path]`: `actors` (name → `class`, `owner`, `icon`, `display`), `frames[]` (`actor`, `speaker`,
`text`, `audio`), `mentor`. [D] 378 scenes are referenced, 178 of them mentor hints.

Behaviour (DS = `Game/UI/DialogScene.usl`) [S]:

* Scenes are **queued** and played one at a time in the order of their `DGSC` actions (DS:19-45); the game
  goes on meanwhile (no pause, no camera move).
* A scene shows its frames one after the other: speaker portrait (`icon`) + speaker name + text in the
  dialogue box, the audio file plays. A frame lasts `max(length of the audio, 0.25 s × number of vowel groups
  of the text)` (DS:419-465) and the scene checks every 0.5 s whether the frame is over. Without audio use the
  text rule (≈ 0.25 s per syllable; add the engine's 3 s display tail [G]).
* The text also goes to the news ticker / message log. Sound and music are turned down while a frame speaks.
* When the last frame is over: `DSEN` conditions with that file name become true (§4.3) (DS:47-54, 153-155).
  [D] 163 `DSEN` conditions chain game events to the end of a dialogue - so a remake that does not show a scene
  must still end it (after its computed length, or at once).
* **Mentor** scenes (one actor `Mentor`, the adviser Babbage; files in a `mentor` folder): not shown when the
  player has switched off "show mentor texts" - except in the tutorial (DS:396-403). They still end (`DSEN`).
* Actors: `class` / `owner` / `region` say which object "speaks" (the camera does not go there; the game only
  uses it to put a speech marker on the unit [G]). `generate_name = true`: the speaker name is taken from the
  object found (its name up to the first `_`, key `_ds_ACTOR_<name>`, DS:382-390) instead of the actor's node
  name. The export resolves `display` from the node name; that is right for all heroes.

### 6.6 Groups

`GROU` objects (JSON `groups[]`: `guid`, `name`, `members` = GUIDs of the objects in it at level start) are
named sets of units (`GO` = `Server/classes/misc/GroupObj.usl`) [S]. [D] 155 groups; 148 start empty: they are
the containers that `SPGR` fills.

* Members: at most 140 (GO:7). A unit is in at most one group (`SetGroup`, GO:93). A group cannot contain a
  group (GO:85). `AddMember` / `RemMember` broadcast `GROU_CHG` with the new count (GO:72-76, 95, 125) → `CKGR`
  conditions (§4.2).
* A unit that dies is removed from its group (`FO:5628-5633`). So `CKGR group <1` = "all spawned units are
  dead". The check also runs when the condition is enabled, and an empty group *is* `<1`: a "wave is dead"
  trigger enabled before its wave was spawned fires at once. [D] the campaign enables such triggers after the
  spawn - later in the same action list (5 ×; the action order matters; those `SPGR`s use no spawn building,
  so their units are in the group at once) or from a later trigger (29 ×); 9 are enabled from the start and combined with a variable
  or region condition that holds them back.
* Naming a group in a query = its members (§2.1). `ADGR` adds / removes objects (§5.3). Orders given to a group
  by `ACDO` / `WYPT` go to each member (GO:160-231).
* Groups have no position or owner of their own that matters; the JSON `x, y` of a group is the editor icon.

### 6.7 The start of a level

What exists before the first trigger fires (SA:398-599, SL:170-737) [S]:

1. **Players** (JSON `players[0..7]`, `present`): slot type `human` → the player; `ai_Mikrobe` → a computer
   player whose AI sleeps until an `AIBV` wakes it (§5.6). Each has `tribe`, `team`, `color`, start `resources`,
   `tech_filters` (tech tree filters to enable at start, SA:527-535: this is how missions forbid buildings and
   units), `unit_limits` per level, `population_limit`, `ai_difficulty`.
2. **Diplomacy**: `players[i].diplomacy[j]` = relation of i towards j: `0` hostile, `1` neutral, `2` friendly
   (SA:539-551). It is directed; the campaign keeps it symmetric except where it wants "they attack you but
   you cannot attack them". `DIPL` changes it (§5.4). Slots beyond the stored string: neutral [G].
3. **Objects** of the map with their owner, level and flags (`objects[]`: `visible: false` objects are hidden
   until an `OBAP`; `invulnerable` see §8 no. 14).
4. **Start location** per present player (`players[i].start_location`: `x, y, z, rot`): the camera of the human
   player starts there, looking in direction `map.default_camera` (radians). At the start location the game
   creates (SL:316-737):
   * if `players[i].include_buildings` is set: the tribe's main building (`hu_fireplace`,
     `aje_resource_collector` - for Aje only for an AI player or when there is no army budget,
     `ninigi_fireplace`, `seas_headquarters`; SL:384-403);
   * unless the start location has `ignore_pointbuy`: the **start army** `players[i].start_army[]`
     (`{class, level, slot, preset}`, `level` 0-based; from the level's point-buy preset: slot 0-24 → level
     0, 25-39 → 1, 40-47 → 2, 48-50 → 3, 51 → 4; `Nature` / `Technics` / `Resource` slots are workers of that
     caste; `Stina_s0` becomes her mount class `special_eusmilus`; SL:482-575), placed around the start
     position;
   * the start resources (SL:604-623).
   On the missions whose player resources are `-1` (4, 5, 9, 11, 16; [D]) the original shows the **army
   building screen** before the mission: the player buys units with the credits earned so far
   (`BoniTotal`, §6.1) and the preset is only the default. A remake without that screen uses the preset army
   and 0 resources (§8 no. 10).
5. **Day time** `map.start_time`, weather, `map.black_start` (the screen starts black and a sequence or
   `fade_in` sequence opens it).
6. **Level variables** with their start values (§3), **quests** all hidden, **question marks** all invisible,
   **regions** with `enabled: false` shapes off (§5.4 `ARGN`).
7. Then every trigger with `flags.enabled` in an active folder gets enabled, in stored order (§1). The typical
   mission starts with `TIME 1` triggers named `Init…` that set AI behaviours, lock units, reveal fog and start
   the intro sequence.

### 6.8 Sequences (`SQNZ`, `SQEN`)

JSON `sequences[path]`: `duration` (seconds: the played part of the sequence's timeline, from its start and
end markers; [D] in-game scenes 8 - 100 s, films up to 7.7 minutes, `fade_in_01` one frame), `lines[]` (subtitles in
spoken order: `speaker`, `text`), `videos[]` (`hs_NNNN.bik` = a pre-rendered film), `speech[]`, `sounds[]`.
[D] 111 sequences are referenced; 9 of them have no file in the game at all (cut content; 2 of those are
started by live tutorial triggers).

Original behaviour: the engine plays the `.seq` timeline - camera path, scripted actors (the file brings its
own actor objects), speech, effects; or just a film for the `ms_…` sequences ([D] the 23 `ms_` sequences are files of 170 - 350 bytes, except one: just a video track). While it runs the player has no input (`G:1812-1858`), the fog of war is lifted
if `disable_fow`, and the simulation continues [G]. At the end (also when skipped with Escape) [S]:

* the camera returns to where it was (`snap_cam_back`) or jumps to `camera_data` with the default camera angle
  (G:1835-1853);
* with `quit = 1` the client reports `GameOver Campaign Win` (G:1854-1857) → mission won;
* every `SQEN` condition is pushed with the file name (§4.3).

For the remake (no `.seq` player): on `SQNZ` → block input, show the `lines` as subtitles (and the film if it
is available) for `duration` seconds or until skipped → apply the camera rule → fire the `SQEN` push → if `quit`
end the mission as won. A sequence with no file: length 0 (ends in the same step). Sequences queue like
dialogue scenes if one is already running [G]. [D] **every mission ends through a sequence**, and 165 `SQEN`
conditions continue the game after cutscenes - the end event is mandatory even if nothing is shown.

## 7. The missions

All numbers [D]. "live" = triggers that can ever run (compiled, not in a dead folder). "types" = different
condition / action types the live triggers use. The readable dump of every mission
(`python -m pwexport.campaign <map> --text out.txt`) lists each trigger with resolved names; read it next to
this section.

| # | title | map (m), setting | objects | live triggers | player | AI players | types c / a | quests / regions | dialogues / sequences |
|---|---|---|---|---|---|---|---|---|---|
| 0 | Tutorial | 1088×768 Northland | 1032 | 594 | Hu | 4 | 15 / 23 | 29 / 23 | 89 / 15 |
| 1 | Stranded | 1152×800 Northland | 1539 | 301 | Hu | 4 | 18 / 29 | 16 / 62 | 59 / 12 |
| 2 | Druid Island | 1056×1312 Northland | 668 | 137 | Hu | 4 | 14 / 27 | 7 / 59 | 25 / 4 |
| 3 | Amazon Island | 1248×1216 Savanna | 997 | 107 | Hu | 4 | 13 / 21 | 4 / 60 | 14 / 4 |
| 4 | The Dustriders | 1376×1344 Savanna | 1155 | 134 | Aje | 7 | 13 / 31 | 7 / 77 | 22 / 4 |
| 5 | The Holy City | 896×864 Cave1 | 3176 | 141 | Aje | 6 | 13 / 28 | 5 / 53 | 23 / 7 |
| 6 | Pirates and Hostages | 1568×960 Jungle | 788 | 114 | Aje | 7 | 15 / 28 | 5 / 81 | 19 / 7 |
| 7 | The Water Temple | 1472×1376 Savanna | 1836 | 176 | Aje | 7 | 17 / 32 | 9 / 129 | 19 / 4 |
| 8 | Valley of the Gods | 1088×1376 Icewaste | 1202 | 117 | Aje | 6 | 14 / 28 | 7 / 42 | 12 / 9 |
| 9 | Perilous Path | 1024×1280 Jungle | 1283 | 116 | Ninigi | 6 | 15 / 33 | 8 / 99 | 16 / 5 |
| 10 | The Prophet | 1024×1280 Jungle | 1620 | 128 | Ninigi | 6 | 14 / 23 | 4 / 60 | 13 / 4 |
| 11 | Arena | 512×480 Cave1 | 138 | 73 | Ninigi | 3 | 8 / 15 | 3 / 5 | 4 / 4 |
| 12 | Sea Battles | 1568×1376 Savanna | 1020 | 169 | Ninigi | 6 | 16 / 28 | 5 / 102 | 13 / 4 |
| 13 | The Rush | 1696×1408 Savanna | 981 | 167 | Ninigi | 7 | 18 / 27 | 9 / 64 | 20 / 5 |
| 14 | Prisoners | 1280×1376 Ashvalley | 979 | 141 | Hu | 7 | 13 / 19 | 6 / 71 | 13 / 6 |
| 15 | New World Order | 1248×1312 Ashvalley | 1715 | 161 | Hu | 7 | 13 / 27 | 5 / 64 | 9 / 12 |
| 16 | Showdown! | 1024×1024 Cave2 | 841 | 100 | Hu | 4 | 9 / 19 | 5 / 5 | 8 / 5 |

Common pattern of every mission: folders `I` (inits at second 1: fog, AI behaviours, locked units, start
positions), `S` (sequences), `G` (gameplay), `L` (quest log: one trigger each for show / accomplish / fail of
every quest, enabled by gameplay triggers), `M` (map pings), `Q` (question marks), `D` / `H` (dialogue, mentor
help), `X` (game over and level end). A hero's death is always a `DEAD` / `DYIN` → `GAOV` trigger.

### 7.1 Recommended order

1. **11 Arena** - by far the smallest: 138 objects on a 512×480 map, 73 live triggers, 8 condition and 15
   action types, no computer player (three AI slots only own the spawned waves), no economy, no buildings to
   produce in. It still exercises the whole core: trigger chains (`TIME`, `TRUE`, `TRIG`), spawning waves out of
   scenery gates into groups (`SPGR` 50 with `use_spawn_obj`), random patrol orders (`random` triggers with
   `WYPT`), the level timer, difficulty variants (`by_difficulty`), quests, `DEAD` → `GAOV`, sequence end →
   `QUIT`. Needs: the three heroes as start army (level 2), the arena animal classes (`arena_…`), healing wells
   (`FNTN` objects; a game class, not a trigger).
2. **1 Stranded** - adds most of the remaining vocabulary in one mission (12 further condition types, 17
   further action types; 301 live triggers) and is the real start of the story: Cole alone, then a few
   Norsemen, then the first base. The computer players only wake late (`Dodo`, `Giraffe`).
3. **2 Druid Island** - first normal start (heroes + workers + main building), first `AIFT` attack (1), sea
   landings by trigger (`CPLX` 6, `TRSP` 2), info bar counter.
4. **8 Valley of the Gods** - escort mission with groups (`CKGR` 11), folder switching (`ACND`), many scripted
   moves (`ACDO` 66), a real AI base to fight.
5. **5 The Holy City** - no new types; a hero-only city fight with 54 spawns and 35 `REPL`; the biggest map by
   objects (3176) = the performance test. First mission with the army-building screen (`-1` resources).
6. **4 The Dustriders**, **9 Perilous Path**, **10 The Prophet** - army missions with several AI bases; they add
   `WAYR`, `ARGN` and 17 `AIFT` attack orders: they need the AI port's custom attacks.
7. **3 Amazon Island**, **6 Pirates and Hostages** - base building under script control (`BLDG` 50 in mission
   3) and naval play (63 ships in mission 6).
8. **7, 12, 13, 14, 15** - the large late missions: eight players, AI defence areas (`AIDA` 28), 51 `AIFT`,
   landings, countdown timers.
9. **16 Showdown!** - small in vocabulary (9 / 19 types, no AI) but built around unique boss objects (the
   Scorpio with its panels, Babbit's suit, tower control buildings); can be pulled forward as soon as those
   classes exist.
10. **0 Tutorial** - last: 594 live triggers, 89 dialogues, and its `UNTT` conditions watch the original user
    interface (camera moved, unit selected, transporter boarded). Much of it teaches the original HUD.

### 7.2 Mission notes

For each: what happens · how it ends · what it needs beyond the common set (`TIME`, `TRUE`, `REGN`, `SQEN`,
`DSEN`, `CVAR`, `QUES`; `TRIG`, `DGSC`, `QUES`, `QMRK`, `MPNG`, `ACDO`, `VARS`, `SFOW`, `SQNZ`, `GAOV`).

**0 Tutorial** (Hu; SEAS training island). Four chapters taught by Ada: camera and moving, gathering and
building, fighting, heroes. Player starts with nothing; everything is handed out by triggers (`OCPY` 22,
`TECH` 18 filter switches, `BLSL` 10 build-slot locks). 350 `TRUE` conditions = sub-routines. Ends: `QUIT`.
Lost: hero dead, an "important building" destroyed. Special: `UNTT` (4), `ACDO` gates / `FullHeal`.

**1 Stranded** (Hu). Cole wakes alone on the coast, helps Norsemen against animals and barbarians, finds
Stina and Béla (sequences), gets a village and must destroy the barbarian main base. Player 3 "Norsemen" are
friendly villagers whose units and buildings are handed over (`OCPY` 9, `DIPL` 5); barbarians P1 `Dodo`, P2
`Giraffe`. Ends: `QUIT` after `ms_1120`. Lost: a hero dies (3 triggers), "mission failed" (4). Special:
`ITEM` pick-ups (7), `OBJP` (17: hit points of escorted units, hero level), `AIAM` 27 / `AILU` 8 to park AI
units, `UNIT`, `EFCT`, `REPL` 4, `ISFG` 6.

**2 Druid Island** (Hu). Save the holy mammoths from Dustrider hunters, defend the druid's grove, destroy the
Dustrider camp. Start: heroes + 3 workers + fireplace, 100 of each resource. P1 Dustriders `Giraffe` / `Turtle`
with one `SuicideAttack_2`; raids arrive by transport (`CPLX` 6, `TRSP` 2). Counter in the info bar
(`mammoths_saved`). `DYIN` 16 (mammoths and nests). Ends: `QUIT`. Special: `MRGN` (1), `ADGR` 4.

**3 Amazon Island** (Hu). Build up on a desert island, reach the Amazon temple, collect artefacts on the
neighbouring islands, take the fortress. 50 `BLDG` and 10 `TECH` conditions watch what the player builds and
which epoch he reached; the flying trader delivers goods (`ACDO WalkAction` 31 for the trader's routes). P1
fortress `Turtle` → `Dodo`; 8 `AIFT` (`BlitzAttack_1`, `SP2Attack_1`, `PureViolenceAttack_2`, `PyramidAttack`,
landings from the island player P4). 4 ships. Ends: `QUIT`.

**4 The Dustriders** (Aje; army screen). Lead a Dustrider war party south: free the trader, destroy four
barbarian camps, meet Livingstone (SEAS). 22 `SPGR` patrols, `AIFT RiderAttack_1/2/3` (5), `DELO` 15, tribute
side quests switched off by `ACND` (3). Ends: sequence `ms_2045` with `quit`. Special: `ACDO BuildUp`, `Kill`.

**5 The Holy City** (Aje; army screen, no base). The heroes cross the city to the temple while pirates and
ninjas attack: street fights from 54 spawn points, 35 `REPL` (residents / scenery swapped for other classes),
"support points" counter in the info bar, `RSRC` 8 rewards. AI only `FightOnly` and `Turtle`. 8 ships as
scenery in the harbour. Ends: `ms_2090` with `quit`. Special: `EFCT` 3, `POPL`.

**6 Pirates and Hostages** (Aje; base + fleet). Build a harbour, free hostages on pirate islands, sink the
pirate boss ship. 63 ships (36 of the roaming pirate fleet P5). `DEAD` 29 / `ACDO Kill` 28 (hostage cages),
`ISFG` 21 ("player attacked island n" → the pirates of that island turn hostile: `DIPL` 8), visible countdowns
(`TIMR` 18), side quests closed with `ACND` 13, `POPL` 6, `PLCP` 6. Ends: `ms_8090` with `quit`.

**7 The Water Temple** (Aje; heroes only at first, 8 players). Escape the Dustrider town, win Taslow's
followers, then defend and storm with a base. 129 regions, `REGN` 66. `DIPL` condition (4): attacking a
neutral makes him hostile. AI: `AIDA` 8 defence areas, `ARGN` 6 (nest areas released), 5 `AIFT`
(`L07_aje_easy / medium` landings, `AttackOutpost`), `COBJ` 12, `AIRG` 3. Ends: film `ms_2580` (`quit`), with a
`QUIT` on its end as well. Lost: hero dead, campaign failed.

**8 Valley of the Gods** (Aje; base). Escort the archaeologist Kleemann through the ice to Valhalla and
collect three keystones in a given order. `ACDO` 66 (walks, `SetPos`, `RotateTo` 11, gates), `CKGR` 11 for the
guard groups, the three "capture order" folders activated by `ACND` (§1.5), 9 sequences. P1 / P2 barbarian
bases `Dodo` / `Giraffe` / `Turtle`. Ends: `sc_3012` with `quit`. Lost: Kleemann or a hero dead.

**9 Perilous Path** (Ninigi; army screen, then a base). March through Dragon Clan land, rescue their village,
recapture plane parts from three barbarian settlements, build and defend the launch ramp. 9 ships; 18 `CPLX`
and 10 `TRSP` landings, `WAYR` 6, 21 groups, `ACDO Invulnerability` 23. Ends: `ms_3040` with `quit`. Lost:
ramp / village destroyed, hero dead.

**10 The Prophet** (Ninigi; small army, base later). Sneak past SEAS patrols (`SGHT` 10: "patrol sees the
player" raises the alarm), then break into the temple fortress. `ISFG` 9, `CKGR` 8, 10 `AIFT`
(`L10_distraction_med / hard`, `SuicideAttack_3`, `BlitzAttack_3`), `ARGN` 2. 63 `FDBK` debug texts. Ends:
`sc_3090` with `quit`.

**11 Arena** (Ninigi heroes, no base). After the film `ms_4010` three rounds: (1) seven animal waves
(Polacanthus, Gallimimus, Baryonyx, Smilodon, Stygimoloch, Triceratops, Allosaurus) come out of the colosseum
gates, each started by the level timer 0 (45 - 70 s after the previous one) whether or not the last wave is
dead; (2) when no animal of player 1 is left, nine squads of the governor's guards (players 1, 2, 3 = Aje,
Ninigi, Hu units; unit counts and the 50 - 105 s between squads by difficulty) and two mammoths; each squad
gets one of five random
patrol routes every few seconds (`random` triggers `Ga / Gb / Gc`, re-enabled after every spawn); (3) when
nothing of players 1 - 3 is left, sequence `sc_4009`, then one level-4 Atroxosaurus. When it is below 20 %
hit points (`OBJP`), film `ms_4015` plays, the boss is deleted, quest 3 is accomplished → `QUIT`. Lost: Cole,
Béla or Stina's Eusmilus dies. Crowd sounds (`PSND` 19) after each wave. 46 further triggers are the dead
first version (§1.5).

**12 Sea Battles** (Ninigi; base + fleet). Repair the telescope tower, build two harbours and four war ships
and reach epoch 3 within 15 minutes (visible `TIME` countdown, `BLDG` 9, `TECH`), then stop SEAS carriers:
more than four through = lost. 41 `SPGR` (carrier escorts, 20 `random` triggers choosing lanes), 14 `CPLX`,
`RTME` 8, `WYPT` 19 ship routes with `straightwalk`. Allies P4 Norsemen and P5 Dustriders as AI (`Turtle`).
Ends: `QUIT`. Lost: time, carriers, tower destroyed.

**13 The Rush** (Ninigi; big base, 39 buildings at start). Hold the Holy City wall against SEAS waves (33
`AIFT` with level-specific armies `L13_MB2_1 … MB3_3` from three bases), then counter-attack the
headquarters. Seven side quests (trader's landing strip, outposts, nests: `BLDG` → variable), `TIMR` 9,
`DSEN` 26, 40 variables. Ends: `ms_6020` with `quit`. Lost: the wall destroyed.

**14 Prisoners** (Hu; base). Hunt Leighton and free Ada from the SEAS prison; three side prisons whose inmates
join when the building falls (`DEAD` → `DIPL` 9: the prisoner players 4 - 6 turn against the SEAS, and
`ACDO Aggressive Walk` 30 sends them off), Leighton's loudspeaker lines (`PSND` 14), `ISFG`
15. Only 19 action types, AI only `Dodo` / `Turtle` / `Mikrobe`: the easiest of the late missions. Ends: `QUIT`.

**15 New World Order** (Hu; base + Taslow and Ada). Storm the SEAS fortress: capture and hold five pumping
stations against a countdown (`TIMR` 32 with pause / continue, `OBAP` 106 switching scenery states, `OCPY`
20), four SEAS bases with `AIDA` 20 defence areas and 18 `AIFT` (`L15_quick / melee / siege_attack` in easy /
normal / hard variants picked by `by_difficulty`). `CVAR` 120, `REGN` 76. Ends: `sc_7041` with `quit`. Lost:
time limit.

**16 Showdown!** (Hu; four heroes + Taslow as ally, army screen). Crater fight in four phases: survive,
destroy three SEAS production bases (104 `SPGR`: the bases keep spawning until their barracks fall; 19
`random` triggers), the Scorpio (`ACDO SetAnim`, `Attack` on its panels, `JumpOffWall`), Babbit. Tower control
side quest (`OCPY`). No computer player (`Mikrobe`). Ends: `QUIT` after `ms_7060`.

## 8. Open points

Things the scripts and the data do not settle (engine behaviour), with the behaviour recommended for the
remake. "Risk" = what goes wrong if the guess is wrong. The last column says what the remake's trigger engine
does (`remake/src/game/campaign/engine.js`, described in `remake/docs/CAMPAIGN_RUNTIME.md` §11).

Two findings while building the engine that §3 and §4.2 above do not have:

* **Profile variables are used**: `VARS` / `CVAR` without `local = 1` work on the variables of the player's profile
  (`Server/settings/ProfileVariables.txt`: `Tutorial_Started`, `Level_1_Started`, ...). The tutorial sets
  `Tutorial_Started`; mission 1 tests it seven times (the long intro `ms_1000_1010` and the mentor hints only if the
  tutorial was not played). The remake keeps them in the browser's `localStorage` (`pwr.campaign.profile`).
* **Evaluation while a trigger is being enabled**: when a trigger is enabled its conditions get `OnEnabled` one
  after the other, and most of them `Invalidate()` there. If the expression were evaluated at each of these calls
  (§1.1 no. 3), a re-enabled trigger would be judged with the old states of the conditions that have not woken yet:
  mission 15's pairs `M03a` (`ctrlpt02 == 0`, enables `M03b`) / `M03b` (`ctrlpt02 == 1`, enables `M03a`) would fire
  each other for ever. The engine must therefore evaluate once, after all conditions of the trigger have been
  enabled (or reset all states first). The remake does the former.
* **A region flag that is not "enabled"**: mission 8's `trigger_sc_3004` has the shape bit cleared that the export
  reads as "enabled", is tested by a live `REGN`, and no `ARGN` exists in that mission. The remake switches such
  shapes on (regions named by a trigger query and never touched by `ARGN`).
* **Nests must be destroyable**: missions 1 and 2 wait with `DEAD` / `DYIN` / `REGN <1` for a nest (`NEST` object) to
  be destroyed ("kill the Dilophosauruses and destroy their nest"). In the remake a mission's nests stand as
  ownerless objects with the hit points of their class.

| no. | question | recommended behaviour | risk if wrong | status in the remake |
|---|---|---|---|---|
| 1 | Does a trigger fire on the *level* of its expression (at every invalidation while true) or only on a rising edge? | Level (§1.1). Only matters for the 53 live non-once triggers; their conditions are pulses (`TIME`, `RTME`, `WAYR`) or one-shot (`TRUE`), so both readings give the same result except for a non-once trigger on a pure level condition (`REGN` …), which would fire on every push while true | low | Level, as recommended. A polled level condition (`REGN`, `PLYR`, `TECH`, `SGHT`, `BLDG`) invalidates only when its result changed, so a non-once trigger fires when the set of objects changes while the expression is true, not on every poll |
| 2 | When exactly do the actions run, and in which order when several triggers fire in one step? | Queue, run at the end of the step, first queued first (§1.1). Within a trigger: stored order | medium: `TRIG` chains assume "enable, then the enabled trigger's `TRUE` fires after my remaining actions" | Settled as recommended: `invalidate` evaluates at once, the firing is queued and runs at the end of the simulation slice, FIFO (`engine.js flush`) |
| 3 | `TRIG` enable on a trigger that is already enabled: are its conditions restarted? | No: nothing happens (running `TIME`s continue). A `once` trigger that has fired is disabled, so re-enabling it restarts everything | low | As recommended (`engine.enable`) |
| 4 | Empty expression with more than one condition (3 live triggers) | AND of all conditions | low | AND of all conditions; a trigger without conditions never fires |
| 5 | `SetNodeActive(node, active, third)`: meaning of the third argument; does activating a folder start the enabled triggers below it? | Third = apply to sub-folders too. Activating starts (`OnEnabled`) every enabled trigger below; deactivating stops them and keeps their enabled flag (§1.5) | low (only mission 8 activates, 19 uses deactivate) | Deactivating a folder covers everything below it, activating only the folder itself (sub-folders keep their own state); the enabled triggers below start / stop (`engine.setNode`) |
| 6 | Flags `random` and `by_difficulty`: exact engine rule | One uniformly random action per firing; only actions whose `difficulty` equals the current one (§1.4) | low (matches all data) | As recommended (`engine.pick`; `engine.random` is `Math.random`) |
| 7 | `DEAD` / `DYIN`: at which moment does the engine's "object deleted" event come - at death (hit points 0) or when the corpse is removed? | `DYIN` at the moment of death; `DEAD` when the object is gone (use the same moment if the remake has no corpse phase). Buildings: when destroyed | low: at most a few seconds' difference | One moment for both: the death (hit points 0) or the deletion. `DEAD` is also true when the query is empty at the first check after enabling |
| 8 | Order of the objects a query returns; intent of `AllNC` | Creation order. `AllNC` = `All` in queries, matches nothing in `ISFG` (§2.1, §2.2) | low | Creation order (the registry's list); `AllNC` as recommended |
| 9 | `SGHT`: `CheckVisibility(A, B)` | True if any B object is within the sight range of any A object (ignoring the fog-of-war state of the players), polled every 2 s | medium for mission 10's stealth part | As recommended (sight range of the A object, no fog-of-war test, every 2 s) |
| 10 | Missions with `-1` resources (4, 5, 9, 11, 16) open the army-building screen in the original | Start with the preset army (`start_army`) and 0 resources; add the screen later, budget = `BoniTotal` carried over (§6.1, §6.7) | none for playability; difficulty differs | Preset army; resources of -1 become the tribe's default stock (world setup). `BoniTotal` is counted (`G.campaign.boni`) but not carried over |
| 11 | Sequences: does the simulation run during a sequence; real length; a missing `.seq` | Simulation continues, player input off, length = `duration` (the file's start / end markers; `fade_in_01` is a single frame, 0.04 s), skippable; missing file = ends at once (§6.8) | medium: a fight continuing unseen during a long cutscene. If that shows, pause AI attacks / make heroes invulnerable during sequences | The mission UI pauses the simulation while a sequence shows (`ui/mission.js` contract), so nothing happens unseen; a sequence without a file ends at once; sequences queue |
| 12 | `ISFG` with a group as B (6 live) can never be true by the script | Follow the script (never fires). If a mission stalls on such a trigger (candidates: mission 6 island attacks), treat a group as its members | low | The script is followed (never fires) |
| 13 | Names of objects created at run time | Not needed (§2.4) | none | `<class>_<n>` |
| 14 | Object flag bits of the map (`selectable`, `hitable`, `invulnerable` in `objects[]`) | The export decodes them by correlation only. Use `visible` (certain); treat `invulnerable` as a hint; the certain source is `ACDO Invulnerability` | low | World setup: `visible` certain, the others applied as hints |
| 15 | `DELO` with `maxobjs = 0` | Deletes nothing (script loop bound); `-1` (default) deletes all | low | As recommended |
| 16 | Info bar: who replaces `$(var)` and when the line refreshes | Replace on every variable change (§6.4) | none | As recommended (`engine.varsChanged` refreshes the bar) |
| 17 | Relation of a player towards slots beyond its diplomacy string; towards itself | Neutral (1); itself friendly | none | As recommended (`Player.relation`) |
| 18 | `AIFT` army tables, AI behaviours (`Dodo`, `Giraffe`, `Turtle`, `FightOnly`, `Mikrobe`, `Schnecke`), `AIDA`, `AIRG` | Belongs to the AI port (`ai.md`). Minimum for a mission to work: `AIFT` with `attack_with_all = 1` spawns the named army at `spawn_position` and attack-moves it to the targets | high for missions 10, 13, 15 | `AIFT` / `AIBV` / `AIDA` / `AILU` / `AIRG` go to the brain interface of `ai.md` §13.1; `AIAM` to `world.setAggro` |
| 19 | `TIMR` expiry pushes conditions of disabled triggers too (state stays 1) | Follow the script (§6.3) | low | As recommended (`TIMR` conditions are subscribed for the whole level) |
| 20 | A trigger disabled by `TRIG` in the same step in which it was queued to fire | It still fires (it was true first) | low | It still fires (the queue holds it) |
| 21 | Length of a dialogue frame without audio | 0.25 s per vowel group of the text, minimum 2 s (§6.5) | none (pacing) | The mission UI's part (`playDialog`); the engine only needs its end |
| 22 | Time base of `TIME` / `TIMR` / `RTME` | Game time (scaled with game speed, stopped in pause) | none | Game time (the simulation slices) |
| 23 | Editor / binary leftovers: trigger flag bit `0x02` (always set), region flags, shape flag bits other than "enabled" | Ignore | none | Ignored |
