# Campaign runtime: the world a mission runs in

This is the interface between the **campaign world setup** (done: `src/game/campaign/`, `src/game/scripting.js`)
and what is built on top of it: the **trigger engine** (conditions and actions of `docs/spec/triggers.md`), the
**mission UI** (`src/ui/mission.js`, see `docs/MISSION_UI.md`) and the **campaign AI brains**. Read this file first; the
mission data itself is described in `docs/CAMPAIGN_FORMAT.md` §10 (schema `pw-campaign/1`) of the toolkit.

§1 - §10 describe the world setup: it turns the mission data into a running world and offers the calls a trigger
action needs. §11 describes the trigger engine that makes the mission play (`src/game/campaign/engine.js`,
`conditions.js`, `actions.js`), §12 its tests.

## 1. Starting a mission

| what | how |
|---|---|
| config | `{ campaign: <mission id 0-16>, difficulty: 0 | 1 | 2 }` (easy, medium, hard) instead of the skirmish config |
| URL (tests) | `index.html?manual&campaign=11&difficulty=1` (also `&reveal`, `&debug`) |
| menu | title → Campaign → mission list (localised titles and descriptions) → difficulty → Start mission |
| restart / next | `sessionStorage 'pwr.autostart'` holds the config, the page reloads (as for skirmish). "Next mission" on the end screen starts `G.campaign.next()` |
| data | `campaign/index.json` → `[{ id, key, map, data, name, title, description, tribe, point_buy }]` in playing order (`Campaigns.txt`); `campaign/<pack>/<rel>.ula.json` = the mission JSON. Served by `toolkit/remake.py` (`campaign_file`, `campaign_index`), cached under `<built data>/campaign/pw-campaign_1/<lang>/`; a mission file is rebuilt when the map or `pwexport/campaign.py` is newer |

Order of a start (`main.js startGame`): `loadCampaign(id)` → `new Campaign(G, loaded, cfg).plan(rules, manifest)` →
map source (the landscape, without the objects the campaign places itself: `cfg.skipObjects`) → `loadModels` →
`buildWorld` → `G.campaign.build(world, source)` (players, objects, groups, start locations) → wild animals and
nests of the map → `createBrains(cfg)` → camera, HUD → `G.mission = new MissionUI(G)` → `G.ready`.

Per simulation slice (`simulate`, 50 ms steps): `world.update(s)` → every brain of `G.brains` → `G.campaign.update(s)`
→ `G.mission.tick(s)`. **The trigger engine runs at the end of `G.campaign.update(s)`** (`C.engine.update(s)`: the world
events of the slice have been forwarded to the campaign's listeners by then). Per drawn frame: `G.mission.update(dt)`.

What a mission does **not** have: `G.ai` is `null` (there is no single opponent), no skirmish win / lose rule
(`checkEnd` returns at once), no warp gate rule, no "defeat the …" message.

### Ending a mission

```js
G.endMission(won, { text, delay })     // text: the resolved reason line; delay: seconds before the end screen (1.5; 0 = at once)
```
Sets `G.over`, plays the victory / defeat music and opens the end screen ("Next mission" when won and there is one,
"Play again" / "Try again", "Main menu"). `G.endInfo = { won, text }` afterwards. A second call does nothing.

### AI brains

`G.brains` is a `Map<player id, brain>`; every brain gets `update(s)` per simulation slice. `createBrains(cfg)` in
`main.js` makes them: skirmish keeps `G.aiBrain = new TribeAI(G, G.ai, G.me, cfg.aiLevel)` (and `G.meBrain` with
`?aivai`); for a campaign the function has a marked place (`>>> CAMPAIGN BRAINS`) and creates none today - the AI
slots of a mission (`player.ai === true`) are to get one each, asleep until `AIBV`.

## 2. `G.campaign` (class `Campaign`, `src/game/campaign/setup.js`)

| field | content |
|---|---|
| `data` | the mission JSON (`players`, `objects`, `groups`, `regions`, `quests`, `variables`, `triggers`, `defaults`, `texts`, `dialogs`, `sequences`, `refs` …) |
| `id`, `difficulty` | mission number 0-16; 0 easy, 1 medium, 2 hard |
| `map` | `data.map` (title, description, `default_camera`, `black_start`, `start_time` …) |
| `index`, `entry` | the campaign index and this mission's entry |
| `players[8]` | `Player` per slot, `null` for a slot that is not present. `player(slot)` = the same with a range check |
| `human` | the human player (`=== G.me`), slot 0 in every mission |
| `objects` | the `Registry` (§3) |
| `regions` | `Regions` (§4) |
| `groups` | `Group[]` (also `objects.group(ref)`) |
| `questionMarks` | `[{ guid, name, x, z (game), state, tooltip, rec }]`; all start `STATE_INVISIBLE` |
| `startLocations[8]` | `{ x, z, heading, data }` per slot (game coordinates), `null` without one |
| `variables` | `Map<name, string>` - the level variables with their start values (all are ints) |
| `timers` | `Map`, empty: owned by the trigger engine, read by the mission UI (contract in `src/ui/mission.js`) |
| `props` | the stand-alone scenery objects (`Prop[]`) |
| `warnings[]` | what could not be placed, as sentences (`"seas_jail_part_01 ×5: no model"`) |
| `counts` | `{ units, buildings, props, landscape, parts, helpers, missing }` of the placed objects |
| `tribes`, `fullTribes` | tribes of the present players; tribes whose models are loaded completely (§7) |
| `world` | the `World` |

Coordinates. Mission data is in **map** coordinates (x east, y north, metres from the south-west corner, z up);
the world runs in **game** coordinates (x east, **z south**, origin = map centre, y up).

```js
C.toGame(mx, my) -> [x, z]            C.toMap(x, z) -> [mx, my]
C.vec('[x y z]' | 'x y z' | 'x, y, z') -> { x, z, mx, my, mz, zero } | null     // zero: "[0 0 0]" = "no position" in many actions
C.heading(rot) -> heading              // objects[].rot and the z angle of obj_rot are used as they are
C.text(key) -> string                  // data.texts lookup, the key itself if unknown
```
Levels: the data counts levels from 0 (`objects[].level`, `COBJ obj_level`, `start_army[].level`), the world from 1
(`unit.level`). `SPGR classes_n` and `CPLX` are already 1-based in the data. `rec.level0` gives the 0-based level.

Events (`C.on(type, fn)` returns `fn`, `C.off(type, fn)`):

| type | arguments | when |
|---|---|---|
| `spawned` | `rec` | a unit, building or prop came into the world (placed, trained, built, spawned) |
| `removed` | `rec` | an object died, was destroyed or deleted; `rec.alive` is already `false`, it has left its group |
| `group` | `group, rec, added` | group membership changed (`GROU_CHG`) |
| `owner` | `rec, from, to` | the owner changed (`Player` or `null`) |
| `diplomacy` | `{ a, b, rel, mutual, attacked }` | a relation changed (`attacked`: by an attack order on a neutral) |
| `questionmark` | `mark` | `setQuestionMark` |
| `event` | the world event | **every** event of `world.events` (`died`, `destroyed`, `built`, `trained`, `attacked`, `levelup`, `boarded` …), once, in order |

World events reach the listeners in `C.update(s)`, i.e. at the end of the simulation slice in which they happened.
`removed` for a death comes with the `died` / `destroyed` event of that slice (the moment of death, not when the
corpse is gone).

Mission-level calls (map coordinates, player **slots**, records):

```js
C.spawn(cls, slot, mx, my, { level0 | level, rot, name, group, exact, built }) -> Rec | null
    // a unit or building of the rules for player `slot` (-1 = nobody), else scenery with that model.
    // Units go to the nearest free spot unless `exact`. `group`: Group | guid | name to join.
C.remove(ref)                    // delete without death (DELO, REPL): no animation, corpse, skulls or loss
C.setOwner(ref, slot)            // OCPY; -1 = nobody
C.teleport(ref, mx, my, rot?)    // ACDO SetPos
C.setAppearance(ref, flags)      // OBAP: 1 visible | 2 hitable | 4 selectable (8, 16, 32 are kept on rec.flags only)
C.setVisible(ref, on)            // only the visible bit
C.playAnim(ref, name, loops)     // ACDO SetAnim; false if the model has no such animation
C.setQuestionMark(ref, state, tooltip)   // state name or 0-4
C.needClass(cls) -> bool         // see §7
C.next() -> index entry | null
```
`ref` = a `Rec`, a world entity, a GUID or a name.

An object without the visible flag is **parked**: not drawn, not found by anybody, not hit, not selectable, and it
does nothing (`world.setParked`). This is how the missions keep reinforcements and scenery that "appear" later.

## 3. The object registry (`G.campaign.objects`, `registry.js`)

Every object a trigger can address has a record:

```js
Rec {
  guid, name, cls, lc (class in lower case), type,     // type: CHTR | ANML | VHCL | SHIP | BLDG | DCCO | GROU | SLOC | NEST …
  index, handle [index, serial], data,                 // of the map (index -1, data null: created at run time)
  entity,        // world Unit / Building or null       (entity.rec is the way back)
  prop,          // Prop (scenery) or null
  groupObj,      // type GROU: its Group
  group,         // the Group it is a member of, or null
  nest,          // type NEST: the world's nest object (world.wildNests) or null
  alive, placed, // placed false: in the data but not in the world (helper objects, missing model)
  visible, hitable, selectable, flags,
  slot,          // owner slot 0-7, -1 nobody (live)      owner -> Player | null
  level0, isUnit
}
```

* Placed objects keep the map's GUID, name, handle and index. Objects created at run time (start army, trained
  units, spawns, the map's wild animals) get a record automatically (`world.onEntity`), named `<class>_<n>` with
  `n` from 0, skipping names that exist (`Cole_s0_0`).
* A record leaves the tables when its object dies or is deleted (`alive = false`): `byGuid` of a dead object is
  `null` - "not found = dead", as the `DEAD` condition needs it. Objects that were never on the map are never found.
* **Not** in the registry: the anonymous landscape (trees, stones, bushes, plain decoration that no trigger names,
  hides or owns - it stays in the instanced prop field and the resource system) and parts of other objects
  (`PROD`, `TRRT`, `MNIO`: riders, build-ups, turrets, cranes - the remake assembles those itself).

Lookups (live objects only): `byGuid(g)`, `byName(n)`, `byHandle(index, serial)`, `byIndex(i)`, `of(entity)`,
`get(ref)` (Rec | entity | GUID | name), `group(ref)` → `Group`; `all` = the live records in creation order.

Groups: `Group { guid, name, rec, members: Set<Rec>, size, list() }`; `addToGroup(group, rec)` (a unit is in at
most one group, a group holds at most 140, never a group), `removeFromGroup(rec)`; a dead member leaves by itself.
Both emit `group`.

Queries:

```js
R.query({ region, types, owner, cls, exclude, filter })   // generic: Region | guid | name; Set | array of types; slot; class; classes; fn(rec)
R.select(params, prefix = '')     // the object-query block of triggers.md §2.1: rgn_guid, obj_name / obj_guid, obj_type,
                                  // obj_owner, obj_class, exclude_class with the node's prefix ('', 'dst_', 'B_', 'trgt_', 'sub_')
R.matches(ref, params, prefix)    // §2.2 "does this one object match" (ISFG): a group does not match its members, AllNC matches nothing
R.inRegion(rec, region)   R.posOf(rec) -> [x, z]
```
`select` needs no defaults applied: missing parameters mean `UniqueWorldRegion`, `NA`, `All`, `-2`. Rules it
implements (script citations in the code): by name → GUID, then name; a group = its live members; only the region
filters. By filter → type list (`All` anywhere in the string = no type filter, so `AllNC` = `All`), owner (`-1` =
nobody), class, `exclude_class`; groups in the result are replaced by their members. Classes compare without case.
One choice of the remake: an `All` query with **no owner and no class** returns only units and buildings (in the
original it would return every object of the region; no live trigger uses such a result). With an owner or a
class, `All` covers everything "real" (not `OTHR`, food, start locations, waypoints, question marks, effects).
A passenger counts as standing where its transport is.

## 4. Regions (`G.campaign.regions`, `regions.js`)

```js
regions.get(ref)        // GUID or name; unknown, empty or 'UniqueWorldRegion' -> the world region (contains everything)
regions.find(ref)       // null if there is none
regions.at(x, z)        // Region[] containing the game point
regions.list, regions.world, regions.version      // version: bumped whenever a region changes

region.contains(x, z)        // game coordinates; false while the region (or every shape) is disabled
region.containsMap(mx, my)
region.center() -> [x, z] | null       region.bounds() -> { x, z, r } | null
region.setEnabled(on, shape = -1)      // ARGN: the whole region, or one shape (0-based)
region.moveTo(x, z)                    // MRGN
region.guid, .name, .data, .shapes [{ oval, enabled, x, y, w, h }] (map), .enabled, .world, .version
```
Shapes that the data marks `enabled: false` start disabled (the extra areas of nests that `ARGN` opens).

## 5. Players and diplomacy (`src/game/player.js`)

Campaign players are ordinary `Player` objects (`id` = slot) with the level's settings:

| field / method | meaning |
|---|---|
| `relation(p)` | this player's relation **towards** `p`: `0` hostile, `1` neutral, `2` friendly. One direction per pair (`players[i].diplomacy[j]`); itself friendly; a slot the table does not cover neutral. Skirmish: no table, teams decide |
| `setRelation(p, rel)` | one direction (use `world.setDiplomacy`, which also reports the change) |
| `isFriend(p)`, `isEnemy(p)`, `isNeutral(p)` | `relation(p) === 2 / 0 / 1` |
| `ai`, `human` | computer slot / the human player |
| `pyramid` | `[l1..l5]` unit slots per level if the level restricts them (`unit_limits`, `BLSL`), else `null` = 25 / 15 / 8 / 3 / 1 |
| `popMax` | population limit (`population_limit`, `POPL`), default 52 |
| `capsFixed` | storage limits were set by a mission (`world.setCaps`): buildings no longer change `caps` |
| `animalsNeutral` | `SNFA` bits: `1` = wild animals leave this player's objects alone, `2` = its units do not attack wild animals on their own. Whoever was attacked fights back |
| `data` | the JSON player (`ai_difficulty`, `tech_filters`, `start_army`, `credits` …), `slot` |
| `tt.suspend()` / `tt.resume()` | batch tech tree rebuilds (used while a mission is set up; use it around mass changes) |

What the diplomacy does (from the original scripts):

* **Automatic fights** - idle scanning, attack-move, towers, traps, mines, retaliation targets, area damage, cone
  weapons, harmful auras - only touch players the attacker's owner is **hostile towards** (`GetIsEnemy(mine,
  theirs)`, `FightingObj.usl:4849-4853`) and ownerless objects (wild animals that are aggressive or attacked us).
  A neutral or friendly player's objects are never auto-attacked, and nobody fights back on its own against a
  player it is not hostile towards (the same test covers the attackers a unit remembers). The relation is
  directed: if A is hostile towards B but B neutral towards A, A's units attack and B's do not defend themselves -
  which is why the campaign keeps the relations symmetric and writes both directions in every `DIPL`.
* **An attack order** (`world.order(units, { type: 'attack', target })`, the player's Attack command, an `ACDO
  Attack`) on an object of a player who is not hostile: refused if either player is a **friend** of the other;
  otherwise **both become hostile** (`FightingObj.usl:6594-6617`) and the attack starts. `world.attackAllowed(u,
  t)` tells which. A plain right click only attacks hostile targets; the Attack command (A) takes neutral ones.
* **Friends** (`relation === 2`): healers heal them, workers deliver to their storehouses, automatic gates open for
  them, helpful auras reach them. Only players who are friends **in both directions** share their view with the
  human player (`G.sees(p)`; a guess, the fog of war is the engine's).
* Colours in the interface: own green, hostile red, neutral yellow, friendly blue (selection rings, health bars);
  the minimap and the models use the players' party colours of the level (`players[i].color` = `PlayerColor0..7`).

## 6. World API for mission actions (`src/game/scripting.js`, mixed into `World`)

Game coordinates, `Player` objects (or `null` = nobody), 1-based levels.

```js
// diplomacy
world.setDiplomacy(a, b, rel, mutual = false)      // DIPL: a's relation towards b; mutual = both directions
world.attackAllowed(u, t) -> bool                  // may u be ordered to attack t (neutral yes, friend never)
world.declareWar(a, b)                             // both hostile (what an attack order on a neutral does)

// objects
world.spawn(cls, owner, x, z, { level, heading, built }) -> Unit | Building | null
        // by class name; null for an unknown class, a model that is not loaded, a second unique hero.
        // an ownerless non-animal unit just stands (stance 3, not wild)
world.freeSpot(x, z, { water, unit, radius }) -> [x, z]
world.removeEntity(e)                              // no death: no animation, corpse, spirit, skulls, loss. Emits 'removed'
world.setOwner(e, p)                               // population, pyramid, heroes, filters, storage, party colour follow. Emits 'owner'
world.setHp(e, hp)                                 // absolute, clamped to 1..max; <= 0 kills (normal death)
world.setInvulnerable(e, on, seconds = 0)          // ACDO Invulnerability Enable / Disable / Timer
world.setLevel(u, level)                           // SetLevelClean: no skulls, no level-up effect, full hit points
world.teleport(u, x, z, heading?)                  // ends the current order, leaves a transport
world.setParked(e, parked)                         // out of / back into the world (C.setAppearance uses it)
world.unitModel(name, level, owner) -> model | null

// players
world.setResource(p, res, mod, cap = false)        // RSRC: res food | wood | stone | iron (= skulls); mod '+n' | '-n' | '=n' | 'n'
world.setCaps(p, { food, wood, stone })            // PLCP; sets p.capsFixed
world.setFilter(p, path, on)                       // TECH and start filters: '/Filters/AntiActions/Hu/Build/CHTR/hu_archer'
world.hasFilter(p, path)
p.popMax = n;  p.pyramid = [25, 15, 8, 0, 0];  p.animalsNeutral = bits      // POPL, BLSL, SNFA: plain fields

// fog of war
world.revealArea(p, x, z, r, seconds = 0, follow = null) -> handle   // SFOW; seconds <= 0: until hideArea; follow: an entity
world.hideArea(handle)
```
`setFilter` is on / off without counting (enable twice + disable once = off), independent of the filters that
buildings and upgrades switch. An enabled *AntiAction* forbids the build or upgrade it names.

Already in the world and useful for actions: `world.order(units, { type: 'move' | 'attackmove' | 'attack' | 'stop' |
'hold' | 'board' | 'unload' …, x, z, target })`, `world.kill(e, null)` (normal death), `world.setGate(b, 0 open | 1
closed | 2 automatic)`, `world.enterTransport(u, t)` / `world.unloadAll(t)`, `world.later(seconds, fn)`,
`building.rally = [x, z]`, `world.emit(type, data)`.

Entity flags a mission can set directly: `e.untargetable` (not hitable), `e.unselectable`, `e.parked`.

## 7. Models

Loading four whole tribes into one page gets the browser killed (out of memory on missions 12-13). So a mission
loads **only the human player's tribe completely** (`C.fullTribes`) plus, class by class, what it places and what
its triggers name:

* every placed unit / building class of another tribe, with its looks per level, weapons, projectiles, riders,
  build-ups and ruins;
* every word of every trigger parameter that is a class of the rules or a model name (spawn lists, `COBJ`,
  `REPL`, `CPLX` passengers, class filters …) - `Campaign.namedByTriggers()`;
* the start armies and start buildings.

Anything else of a foreign tribe is **not loaded**: `world.spawnUnit` / `placeBuilding` return `null` with one
console warning for a class without a loaded model. A campaign AI that produces classes the mission does not name
must announce them **before the models load** - `G.campaign.needClass(cls)` (callable from the moment
`G.campaign` exists, i.e. between `plan()` and `loadModels`) - or add its tribe to `G.campaign.fullTribes`.
After loading, `needClass(cls)` only reports whether the class can be created.

Classes that exist in the rules but have no model in the game data get a stand-in so that the object exists for
the triggers (`world.standIns`): `Stina_s0` → her sabre-tooth (`special_eusmilus`, which is what the start army
creates anyway, `StartLocation.usl:517`); other characters → the tribe's warrior. Buildings, vehicles and ships
without a model are not placed (listed in `C.warnings`).

## 8. What the setup does at start (triggers.md §6.7)

1. **Players**: one `Player` per present slot with tribe, name, team, party colour, diplomacy row, pyramid
   limits, population limit; the level's tech filters are enabled (`tech_filters`). The human player is slot 0.
2. **Objects** in the order of the data: buildings (finished unless `building_ready = 0`; gate state from
   `GateState`), units (level = data level + 1, hit points in the data's ratio, heading), passengers put into
   their transports (`transporter_guid`, `passenger_guids`), scenery as props. Flags: `visible: false` → parked;
   `hitable` / `selectable` false → `untargetable` / `unselectable`; `invulnerable` → `setInvulnerable` (these
   three are decoded by correlation only, see CAMPAIGN_FORMAT.md §6 - treat as hints).
3. **Groups** with their members, **question marks**, **regions**, **variables**.
4. **Start location** of every present player (`StartLocation.usl:316-737`): the tribe's main building if the
   player's `include_buildings` is set (Aje: the resource collector only for a computer player); the start army
   (`start_army`, 0-based levels, `Stina_s0` already replaced by `special_eusmilus`) and the start resources -
   both only if the start location is not `ignore_pointbuy`, as in the script. Resources of `-1` (the missions
   with the army screen) become the tribe's default stock.
5. The **camera** at the human player's start location, yaw = `map.default_camera + π/2`.

Left to the trigger engine / mission UI: the level's `black_start`, day time, quests, question mark display,
everything in `triggers[]`.

## 9. Known gaps and guesses

* **Guesses** (engine behaviour the scripts do not show): shared vision only with mutual friends; camera yaw =
  `default_camera + π/2` (the angle taken as the azimuth of the eye, counter-clockwise from east); `-1` start
  resources = the tribe's default stock; a placed `ShowFOW_Obj` reveals 20 m; `GateState` 0 / 1 / 2 = open /
  closed / automatic; the object flag bits (`hitable`, `selectable`, `invulnerable`) are applied as given.
* **Start resources** are only set for players whose start location is not `ignore_pointbuy` (script); some AI
  slots with resources in the data therefore start with 0 (mission 1 slot 1, mission 10 slot 4, mission 12 slots
  1-3) - their triggers give them resources (`PLCP` + `RSRC`).
* **Scenery** (props) has no hit points and cannot be attacked: ownerless or non-tech-tree buildings (city walls,
  the Valhalla gate, cages), townsfolk, healing wells (they heal: §11.1), item spawns (the chest model; the item
  is taken by walking up to it: §11.1). Props block the ground by their model's pathfinder boxes, else by a circle like landscape objects; the
  map's own path grid is not read, bridges are not walkable.
* **Nests** (`NEST`) are the map's respawning animal nests (`world.wildNests`, `rec.nest`). In a mission the nest
  itself also stands as an ownerless object with the hit points of its class (`rec.entity`, `entity.isNest`): it
  can be attacked on an order (nobody attacks it on his own), destroying it ends the spawning and makes `DEAD` /
  `DYIN` conditions on it fire ("destroy their nest"). A nest the map hides (`visible: false`) cannot be attacked.
  Damage regions (`DMGL`), effects (`CFXE`), waypoints (`WYPT`) and collision helpers are records only.
* **Question marks** keep their state only (their models are not in the built assets).
* **`gfx_prefix`** of a player (`amazons`, `pirates`: model variants) is ignored.
* **Upgraded building forms** placed in the data (`aje_big_tent`, `hu_big_animal_farm` …) have no class in the
  tech tree; they are placed as props.
* A foreign tribe's worker owned by a player has no build menu (actions come from the player's own tribe).
* Waypoints / patrols, sequences, dialogues, timers, the info bar and minimap markers are the trigger engine's
  (§11) and the mission UI's.

## 10. Tests

* `tests/campaign_load.js` - `python3 tests/evaljs.py tests/campaign_load.js "&campaign=<n>"`: players and diplomacy,
  every placed unit / building against the data, names / GUIDs / handles / groups, regions, the object query, the
  scripting API, 30 s of simulation, `G.endMission`. Missions 11 and 1 run in `tests/regress.sh`.
* `tests/campaign_menu.py [mission]` - the player's path: title → Campaign → mission → start, "Play again", "Next
  mission", the defeat screen.
* All 17 missions: `_notes/campaign_runtime/all_missions.sh` (logs in `_notes/campaign_runtime/all/`), the table of
  what could not be placed: `_notes/campaign_runtime/all_missions.md` (`table.py`). Everything listed there is a
  model that the built assets do not contain.

## 11. The trigger engine (`engine.js`, `conditions.js`, `actions.js`, `trigutil.js`)

`G.campaign.engine` (class `TriggerEngine`) is created at the end of `Campaign.build()` and starts with the first
simulation slice (`?notriggers` in the URL: no engine, only the world). It implements `docs/spec/triggers.md`; the
citations of the original scripts are in the code.

### 11.1 Structure

| part | content |
|---|---|
| `Trigger` | one per **compiled** trigger of the data (`compiled: false` / `flags.disabled` = does not exist): `once`, `random`, `byDifficulty`, `enabled` (what `TRIG` switches), `nodeActive` (no folder above it is inactive), `live` (= both: its conditions listen), `conds[]`, `actions[]` (parameters with `data.defaults` applied), `expr` (compiled expression; empty = AND of all, no condition = never), `fired` |
| `invalidate(t)` | called by a condition: evaluates the expression **at once**; if true and `once` the trigger is disabled; the firing is **queued** |
| `listen(t, on)` | enabling (`TRIG`, level start, folder activated): the conditions wake in order (`onEnabled`); the expression is evaluated **once when all of them have their fresh state**, not at each condition's `Invalidate` - a re-enabled trigger would otherwise see stale states of the conditions that have not woken yet (mission 15's ping pairs `M0xa` / `M0xb` re-enabled each other for ever). Disabling calls `onDisabled` (timers stop, subscriptions end) |
| `flush()` | end of the step: the queued triggers run their actions in order (FIFO; actions may queue more - a `TRIG` enable makes a `TRUE` trigger fire in the same step, after the remaining actions of the enabling trigger). More than 5000 firings in one step = a loop: the queue is dropped and recorded as an error |
| `pick(t)` | which actions run: all; `by_difficulty`: those of the current difficulty; `random`: one of them (`engine.random`, replaceable) |
| folders | `inactive: Set<path>`; a folder that directly holds a `node_off` trigger starts inactive; `setNode(path, active)` (`ACND`): deactivating covers everything below, activating only that folder |
| variables | `G.campaign.variables` (`Map<name, string>`); `setVar(name, op, value)` (`set + - * /`, integer arithmetic), `$(name)` substitution (`trigutil.js valueString`, `compare` = the count expressions) |
| profile variables | `VARS` / `CVAR` without `local = 1` work on `engine.profile` (the names of the original's `ProfileVariables.txt`: `Tutorial_Started`, `Level_1_Started` …), kept between missions in `localStorage` `pwr.campaign.profile`. Mission 1 plays its long intro and the mentor hints only while `Tutorial_Started` is 0 |
| regions | at start, a region that a trigger query names, that has shapes marked "not enabled" and that no `ARGN` touches gets them switched on (`engine.regionsFixed`): mission 8's `trigger_sc_3004` is such a region and the mission goes on through it |
| level timers | `G.campaign.timers: Map<id, { id, left, total, show, label, paused }>` (`TIMR` action). A `TIME` condition with `show = 1` adds `{ id: 'time:<trigger guid>:<n>', cond: true, countup }` while it runs |
| quests | the flags `visible / accomplished / unaccomplishable` of `data.quests[]` are kept up to date; `G.mission.questChanged(quest, 'shown' | 'done' | 'failed' | 'hidden')`; `G.campaign.boni` = quest bonuses + `BONI` |
| sequences | `SQNZ` queues; one at a time via `G.mission.playSequence(seq, { camera, snapBack, title }, onEnd)`; on its end: the fog reveal of `disable_fow` is removed, the camera goes to `camera_data` (unless `snap_cam_back`), `SQEN` conditions are pushed, `quit` wins the mission. A sequence the data does not have ends at once |
| dialogues | `DGSC` → `G.mission.playDialog(scene, onEnd)`; `DSEN` on its end. Mentor scenes whose file was not exported get an empty scene `{ id, path, frames: [], mentor: true }` |
| end | `QUIT` / `SQNZ quit` → `G.endMission(true)`; `GAOV` → `G.endMission(false, { text })` 4 s later (the engine stops firing triggers during these 4 s and after the end) |
| patrols | `WYPT`: `engine.patrols: Map<unit, { pts, mode, i }>`, checked 4 × per second: the unit is sent to the next point when it stands idle at the current one; a unit that fights on the way goes on afterwards; an order from elsewhere (player, `ACDO`) ends the patrol; mode 0 ends with the `WAYR` push |
| items | the world has no inventory. `ItemSpawn` objects (`attr.spawn_items`) are items lying on the map: a character of the human player within 3 m takes it (`rec.items`), the `ITEM` conditions hear it, the item's tech tree filter `Filters/Items/<class>_filter` is enabled at once (what `TECH` conditions test as "item used") |
| healing wells | `FNTN` objects (`engine.wells`: `{ rec, max, fill, refill }` from `maxhitpoints`, `hitpoints`, `refill_dur`; `MiscObj.usl` `CFountain`): a hurt unit of the human player that stands idle within 6 m gets what it lacks, or what the well has left; the well refills completely in `refill` seconds. The original sends a unit to the well with an order; the remake has none |
| delayed work | `engine.after(seconds, fn)` on game time (spawn queues, `CPLX` passengers) |

`G.campaign.errors` = `[trigger name, node type, message]` of everything that threw (an action, a condition callback):
one bad node never stops a mission. Unknown types are listed once in `G.campaign.warnings` (a condition is then never
true, an action does nothing).

### 11.2 How conditions hear about the world

Nothing is polled every tick. A condition subscribes to channels while its trigger is `live`:

| channel | pushed when | conditions |
|---|---|---|
| tick list | every slice (a countdown) | `TIME`, `RTME` |
| `timer` | a level timer ran out (also to conditions of disabled triggers) | `TIMR` |
| `sequence`, `dialog` | a sequence / dialogue scene ended (whole level, also while disabled) | `SQEN`, `DSEN` |
| `vars` | any variable changed | `CVAR`; `REGN`, `BLDG`, `CKGR`, `PLYR` whose count expression has `$(` |
| `quest`, `diplomacy`, `group` | quest state, relation, group membership changed | `QUES`, `DIPL`, `CKGR` |
| `removed`, `lost` | an object died / was deleted | `DEAD`, `DYIN`; `PLDE` |
| `attacked`, `boarded`, `wayr`, `item` | world event `attacked` (a hit) / `boarded`, end of a waypoint path, item taken | `ISFG`, `UNTT TRMO`, `WAYR`, `ITEM` |
| `objects` | once per slice in which the **set of objects** changed (spawn, removal, owner, group, `OBAP`, `SetPos`, region switched; `engine.touch()`) | `REGN`, `DEAD`, `DYIN`, `BLDG` |
| poll list | own interval: `REGN` / `DEAD` / `DYIN` on a **named region** 0.5 - 1 s (walking raises no event), `OBJP` 0.25 s, `PLYR` / `TECH` 0.5 s, `BLDG` 1 s, `SGHT` 2 s (as in the original), `UNTT CAME / USEL` 0.3 s | |

A polled level condition invalidates its trigger only when its result changed (state, or for `REGN` the set of
objects found), so a trigger without `once` does not fire on every poll. Cost: missions with 300 triggers have
20 - 60 polled conditions alive at a time; a query is one pass over the live records (1500 on the big maps).

### 11.3 Debug helpers (`G.campaign.debug`, browser console and tests)

```js
D.list('Gf' | /regex/ | (row) => bool)   // triggers with state: { name, folder, enabled, live, nodeActive, once, fired, lastFired, conditions: 'TIME=0 REGN=1', expression, actions }
D.live()                                 // the listening ones
D.trigger(name | guid)                   // one trigger with its conditions (parameters, state, info) and actions
D.why(name)                              // why it does (not) fire: every condition with state, parameters and the objects its query finds now
D.fire(name)                             // run its actions now, whatever the conditions say
D.enable(name, on = true)                // TRIG
D.setVar(name, value)   D.vars()
D.quest(name, state = 1)   D.quests()    // 0 show, 1 accomplished, 2 failed, 3 hide
D.log(n = 50)   D.print(n = 50)          // the last firings: { t, trigger, actions: [types] } / as text
D.fired(name)   D.timers()   D.summary() // counts: triggers, firings, actions, warnings, errors, unknown types, ended
D.add(def)                               // a trigger at run time, in the format of the mission data
D.trace(on)                              // log every firing to the console; the URL option &trace does it from the start (and prints FDBK texts)
D.status()                               // { conditions, actions }: the status table below
```

### 11.4 Status of the condition types (triggers.md §4)

| type | status | notes |
|---|---|---|
| `TIME` | implemented | countdown on game time; show = 1 puts it into G.campaign.timers (id "time:<trigger>:<n>") |
| `RTME` | implemented |  |
| `TIMR` | implemented | pushed also while its trigger is disabled |
| `TRUE` | implemented |  |
| `REGN` | implemented | evaluated on object events and twice a second for a named region; fires when the result set changes |
| `DEAD` | implemented | at the moment of death / deletion; true for an empty query at the first check after enabling |
| `DYIN` | implemented | same moment as DEAD (the remake has no separate "corpse gone" event) |
| `OBJP` | implemented | polled 4 × per second: hitpoints (percent with attrib_max), level, GateState, CurTask |
| `ITEM` | approximated | items are taken by walking up to an ItemSpawn object (engine.js items); no inventory |
| `BLDG` | implemented |  |
| `SGHT` | approximated | sight range of the A objects, polled every 2 s, the fog of war is ignored |
| `ISFG` | implemented | on the world's "attacked" event (a hit), not on the order |
| `WAYR` | implemented |  |
| `CKGR` | implemented |  |
| `UNTT` | approximated | CAME (camera polled), TRMO (boarded event), USEL (selection polled); other kinds never true |
| `CVAR` | implemented |  |
| `QUES` | implemented |  |
| `PLYR` | implemented | polled: food, wood, stone, iron, units |
| `TECH` | implemented | polled |
| `PLDE` | approximated | checked when the player loses an object; "producer" = a building or unit with a unit action |
| `DIPL` | implemented |  |
| `SQEN` | implemented |  |
| `DSEN` | implemented |  |

Not used by the campaign and not implemented (never true, one warning): `CHKO`, `TSKA`, `TRIB`, `DGBL`, `AIFE`, `OBJC`.

### 11.5 Status of the action types (triggers.md §5)

| type | status | notes |
|---|---|---|
| `TRIG` | implemented |  |
| `ACND` | implemented | deactivate covers sub-folders, activate only the folder itself |
| `QUIT` | implemented | G.endMission(true) |
| `GAOV` | implemented | G.endMission(false) 4 s later with the reason text |
| `BONI` | implemented | G.campaign.boni (not carried to the next mission: there is no army screen) |
| `FDBK` | ignored | designer debug texts, off in the original too; printed with &trace |
| `SQNZ` | implemented | G.mission.playSequence; end event, camera_data, quit |
| `DGSC` | implemented | G.mission.playDialog; DSEN on its end |
| `QUES` | implemented |  |
| `QMRK` | implemented | state and tooltip (G.campaign.setQuestionMark) |
| `MPNG` | implemented | G.mission.marker / removeMarker; only markers for the human player |
| `INBA` | implemented | refreshed when a variable changes |
| `TIMR` | implemented | create / pause / unpause / kill |
| `PSND` | implemented | G.audio.play if the sound event exists |
| `ACDO` | implemented | WalkAction, Aggressive Walk, Attack, SetPos, RotateTo, SetAnim, Invulnerability, AbortTask, Stop, Kill, FullHeal, Open / Close / Auto Gate, SetRallyPoint, BuildUp; GiveItem approximated; JumpOffWall ignored |
| `WYPT` | approximated | patrol driver in the engine (once / circle / back and forth); fighters walk as an attack-move; straightwalk ignored (path finding) |
| `COBJ` | implemented |  |
| `OCPY` | implemented | highlight ignored |
| `UNIT` | implemented | hitpoints only (all that occurs) |
| `SPGR` | approximated | units leave a spawn building on the line towards `pos` (no link points); §buildup variants ignored |
| `CPLX` | implemented |  |
| `REPL` | implemented |  |
| `DELO` | implemented |  |
| `ADGR` | implemented |  |
| `TRSP` | approximated | mount: board orders to the nearest passengers; dismount: every transporter of the query unloads |
| `EFCT` | ignored | particle effect (decoration) |
| `OBAP` | implemented | visible / hitable / selectable; the other bits are kept on the record |
| `VARS` | implemented |  |
| `RSRC` | implemented |  |
| `TECH` | implemented |  |
| `DIPL` | implemented |  |
| `POPL` | implemented |  |
| `BLSL` | implemented |  |
| `PLCP` | implemented |  |
| `SNFA` | implemented |  |
| `ARGN` | implemented |  |
| `MRGN` | implemented |  |
| `SFOW` | implemented |  |
| `AIBV` | implemented | brain.setBehaviour |
| `AIFT` | implemented | brain.startAttack / startAutoAttack |
| `AIDA` | implemented | brain.setDefenceArea |
| `AILU` | implemented | brain.lockUnits; the query runs when the action fires |
| `AIAM` | implemented | world.setAggro |
| `AIRG` | implemented | brain.setRegionMap |
| `AICM` | implemented | brain.callModule (unused by the campaign) |

Two rules of the engine that go beyond the scripts: an `ACDO Invulnerability Disable` with a region also reaches
the objects that the same region's `Enable` protected earlier and that have walked out since (the remake's wild
animals roam further than the original's; "kill all Smilodons" could otherwise never be fulfilled); a spawned unit
that comes out of a spawn building appears on the line between the building and `pos`, as close to the building as
free ground reaches from `pos` (never behind the building's wall).

Approximations a player can notice: units leaving a spawn building appear in front of it (no walk out of the
gate's tunnel); `§buildup` variants of spawned classes are not applied; particle effects (`EFCT`) and the
highlight of handed-over units (`OCPY chk_highlight`) are not shown; items are taken by walking over them and work
at once (no inventory).

### 11.6 Models the triggers need

`prescan()` (`actions.js prescanActions`, called from `Campaign.plan()` before the models load) adds to what §7
collects:

* the **whole tribe** of an AI player that a trigger wakes with a building behaviour (`AIBV` `Dodo`, `Giraffe`,
  `Schnecke`, `Turtle`, `Singleplayer…`) → `C.fullTribes`;
* the classes of the **army table** of every `AIFT` (`G.aiData.armies[tribe].Singleplayer / Dodo [attack_type]`) →
  `needClass`; a tribe without tables in the installation (the brain then derives its waves from the tech tree) and
  a tribe that lands by ship (`ship_land`: its transport) are loaded whole.

Everything a trigger names in a parameter (spawn lists, `COBJ`, `REPL`, `CPLX` passengers, class filters) was
already collected by `namedByTriggers()`. A class without a loaded model is never an error: `C.spawn` returns
`null` and the engine adds a warning (`<trigger>: <class> could not be created`).

## 12. Tests of the trigger engine

| test | what |
|---|---|
| `node tests/campaign_engine.mjs [folder]` | the semantics without a browser, against a mock world (`tests/campaign_mock.mjs`: the real registry and regions, a world that keeps positions, owners, hit points): expressions, count expressions, flags, once / re-enable, `TRIG`, random, by_difficulty, folders, level and profile variables, timers, regions, `DEAD` / `DYIN`, groups, `OBJP`, `from_condition`, quests, sequences, dialogues, markers, info bar, players, waypoints, owners, unknown types. Part 2 loads every mission dump it finds (`_notes/cpn/single_NN.json` or `PW_CPN`) and runs two game minutes: no unknown type, no error |
| `tests/campaign_engine.js "&campaign=11"` | the same semantics in the real game: the arena's triggers are held back, test triggers (`D.add`) spawn a wave out of a real gate into a group, test real regions, hit points, deaths, owners, patrols, reveals; at the end a hero dies and the mission's own trigger ends the game (`GAOV`) |
| `tests/campaign_play_11.js "&campaign=11"` | the Arena played to the end by script (heroes ordered onto what enters): 7 animal waves on the level timer, 9 guard squads with random patrols, the boss, both films, `QUIT` |
| `tests/campaign_play_01.js "&campaign=1"` | Stranded played step by step (21 steps from the beach to the barbarians' main base) |
| `tests/campaign_smoke.js "&campaign=<n>&minutes=5"`, `tests/campaign_smoke_all.sh` | every mission: load, run 5 game minutes, one `SUMMARY` line (triggers fired, warnings, errors, unknown types, memory); `tests/campaign_smoke_table.py <dir>` makes the table |

`tests/campaign_load.js` (the world setup, §10) runs with `&notriggers` in `tests/regress.sh`; the engine tests and
the two playthroughs are part of the regression.

## 13. Mission status (what the Campaign menu offers)

The menu lists every mission of the installation and greys out those that are not adapted yet
(`Menu.MISSIONS` in `src/ui/menu.js`; adding `?allmissions` to the address unlocks all of them for testing).

| mission | menu | state (2026-10-03) |
|---|---|---|
| 11 Arena | open | played to the end by the scripted test (`tests/campaign_play_11.js`): 7 waves, guard squads, the boss, both sequences, `QUIT` |
| 1 Stranded | open, marked "preview" | the scripted test reaches step 16 of 21 (five quests accomplished: the Norsemen, the spearmen, Stina, the wild cats, Béla); it stops at "the guards of the prison camp are beaten" - not yet analysed whether the game or the test bot is at fault |
| 2, 5, 8 | greyed out | their trigger chains run to `QUIT` against the mock world (`tests/campaign_play_mock.mjs`); not yet played in the game |
| 0, 3, 4, 6, 7, 9, 10, 12 - 16 | greyed out | load and run (world setup test of all 17); no playthrough yet. Missing models per mission: §9 and `_notes` of the work tree |

What is still open for all missions: no savegames; scenery buildings without hit points; stand-in models for a few
campaign-only classes; cutscenes are shown as subtitles with a camera move, not as the original animation; the army
building screen before missions 4, 5, 9, 11, 16 does not exist (the preset army is used).
