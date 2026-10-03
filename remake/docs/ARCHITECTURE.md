# ParaWorld Remake – architecture

A browser remake of ParaWorld (2006) built from the original game files. The rules come from the original tech tree
(`_TechTree.ttree`, BoosterPack 1 version) and the original server scripts (`Data/Base/Scripts/Server/**/*.usl`);
models, animations, textures, sounds and interface art are converted from the game data – on the player's computer,
from their own installation: the toolkit ships no game file (see DATA_PIPELINE.md).

```
remake/                      (part of the ParaWorld Toolkit; the launcher serves it under /remake/)
├─ src/                      game source (ES modules, bundled by esbuild into game/game.js)
│  ├─ main.js                start-up, world creation, the game API used by the interface, frame loop
│  ├─ engine/                rendering and assets – knows nothing about game rules
│  │  ├─ renderer.js         three.js renderer, RTS camera, shadows, resolution scaling
│  │  ├─ assets.js           manifest, glTF loading, template models, merging of static meshes
│  │  ├─ parts.js            GSF render flags: construction stages, damage stages, epochs, saddles, wounds
│  │  ├─ terrain.js          height field, terrain mesh and splat shader, fog of war
│  │  ├─ props.js            instanced trees and rocks, camera-facing foliage sprites (and ground sprites)
│  │  ├─ water.js            water surface: depth tint, ripples, fresnel, shore foam, fog of war
│  │  ├─ grass.js            ground grass: clumps of the setting's grass atlas around the camera
│  │  ├─ fx.js               particles (dust, blood, smoke, fire, explosions, glows)
│  │  └─ audio.js            sound events, 3-D positioning, voice acknowledgements, music
│  ├─ game/                  the simulation – no DOM, no rendering decisions
│  │  ├─ techtree.js         the original tech tree evaluated at runtime (StartTT + switched filters)
│  │  ├─ rules.js            typed queries on the tree: stats, weapons, actions, requirements
│  │  ├─ world.js            the World: entity lists, spawning, orders, the update loop
│  │  ├─ systems/            the rules, one file per topic (see below)
│  │  ├─ entities.js         Unit, Building, ResNode, Projectile
│  │  ├─ compose.js          multi-part objects from the composites table (gamedata.composites): turrets, riders, build-ups, drawbars/wagons, level flags
│  │  ├─ anim.js             animation controller with sound events
│  │  ├─ nav.js              walkability grid, clearance, A* path finding, gates, spatial hash
│  │  ├─ player.js           resources, caps, population, pyramid counters, diplomacy
│  │  ├─ ai.js, ai/          the computer player: a port of the original's script AI (docs/COMPUTER_PLAYER.md)
│  │  ├─ wallmap.js          the 8 m wall grid: wall pieces with arms per neighbour, lines, gates with wings
│  │  ├─ colors.js           the 8 original player colours (ACColors.txt) and party-material detection
│  │  ├─ mapgen.js           the random jungle skirmish map (trees, stones, bushes, animals, start positions)
│  │  └─ maps/
│  │     ├─ ula.js           reader for original .ula maps (see docs/MAP_FORMAT.md of the toolkit)
│  │     └─ source.js        "map source" interface: generated map or original map -> what buildWorld needs
│  └─ ui/                    everything the player sees and clicks
│     ├─ hud.js              resource bar, info window, command bar, flyouts, army pyramid (drag & drop)
│     ├─ input.js            mouse / keyboard, selection, orders, building placement, move targeting
│     ├─ feedback.js         world events -> sounds, messages, effects (UISndMgr rules)
│     ├─ menu.js             title / skirmish / pause / options / end screens (original menu art)
│     ├─ overlay.js          health bars, selection circles, markers, minimap
│     ├─ mappreview.js       map list, map info and minimap preview in the skirmish menu
│     ├─ diagnostics.js      black-screen / WebGL problems and script errors in an on-screen banner (click = copy)
│     └─ atlas.js            the HUD icon atlas
├─ pipeline/                 builds the game data from the installation (Python), see DATA_PIPELINE.md
├─ game/                     the bundled game: index.html + game.js (what the browser loads)
├─ tests/                    rule checks (node) and headless game tests (Chromium), see TESTING below
├─ docs/                     this documentation; docs/spec/*.md are the rules extracted from the original scripts
├─ index.src.html            page + CSS (copied to game/index.html)
├─ build.mjs / build.sh      bundle src/ -> game/ (npm run build)
└─ devserver.py              the remake alone on http://127.0.0.1:8411/ (tests)
```

Object model: classic object-oriented entities (`Unit`, `Building`, `ResNode`, `Projectile` in entities.js) that
keep their own state, and a `World` whose rules are split into *systems* (`game/systems/*.js`, mixed into the World
class) that act on the entity lists. It is not an entity-component-system: an entity's data lives on the entity
object, and behaviour shared by kinds of entities is in the systems, not in components.

## The simulation

`World.update(dt)` runs in fixed steps of at most 50 ms (main.js `simulate`):

1. delayed actions (`world.later`) and periodic effects (`periodicEffect`)
2. auras and timed states every second (`systems/effects.js`)
3. entities whose tech tree changed re-read their values (`refreshTick`)
4. every unit: its current task (`unitUpdate` → idle / move / attack / gather / build / heal / special / ...)
5. every building: construction, dismantling, production, tower fire, its script-class behaviour
6. projectiles, unit separation, spatial-hash updates, removal of dead objects

Everything the player should notice is emitted as an event (`world.emit('built', {...})`) and consumed once per
frame by `ui/feedback.js`. The simulation never touches the DOM.

### Systems (src/game/systems)

| file | contents | original scripts |
|---|---|---|
| effects.js | status object `e.st`, the aura table (`AURAS`), attack/defence buffs | FightingObj.usl effect flags, Hero.usl, Building.usl regions |
| combat.js | targets, range zones, the attack task, TakeDmg/ProvideDmg/Damage, splash, cone, poison, knockback, towers, bunkers, death, skulls | FightingObj.usl, Fight.usl, WeaponMgr.usl, Product.usl |
| economy.js | the gather task (wood, stone, food, fields, slaughterhouse), delivery, caps, market | Harvest.usl, Mine.usl, GetFood.usl, GetCorn.usl, GetUnlimited.usl |
| construction.js | placing, building up, repair, BuildDown, self destruction, ruins, wall lines | BuildUp.usl, BuildUpBuilding.usl, Repair.usl, BuildDownBuilding.usl |
| production.js | queues, player and local upgrades, heroes, army pyramid | Action.usl, RequirementsMgr.usl, NewPyramid.usl |
| healing.js | healer units, temples/harbours, hermit | HealUnits.usl, Building.usl |
| moves.js | special moves (`MOVES` table) and building commands | character.usl, Hero.usl, Animal.usl, task/*.usl |
| buildings.js | behaviours by script class (`BEHAVIOURS`): gates, traps, resin field, nests, warp gate, fields | Building.usl |
| animals.js | wild animals: roaming, hunting, fleeing, herds | Animal.usl, Nest.usl |
| transport.js | bunker garrison, transports (land and ships: boarding and unloading at the shore), passengers shooting from howdahs | TransportObj.usl, CBunker |
| naval.js | fishing boats and floating harbour fishing, sea mines, water turrets, torpedo turtle, submarine stealth, water targeting rules (see spec/naval.md) | Ship*.usl, Harbour.usl, Mine.usl |

Each file exports an object of methods that `world.js` copies onto `World.prototype`, so inside any system
`this` is the world and every other system's methods are available (`this.takeDmg`, `this.startGather` ...).

### Maps, water and navigation

`buildWorld` (main.js) builds the world from a *map source* (`maps/source.js`): either the random jungle map or an
original `.ula` file. On maps with water there are three walkability grids: `nav` (land; water deeper than 0.4 m
blocks), `waterNav` (ships; shallower than 1.5 m blocks) and an amphibious grid (either). `World.navFor(unit)`
picks the right one; buildings block all of them. Coastal buildings (harbours) snap so their dock point lies in
deep water (`construction.js → placement / coastalSnap`).

### Ground look

The terrain shader (`engine/terrain.js`) blends the 8 ground materials of the map with relative height blending.
Each texture's detail decides where it shows through, so borders follow stones and tufts. Every texture is also
sampled at a second rotated scale mixed by noise, which hides the tile grid, and steep slopes are projected from
the side. Material borders are noise-warped in `maps/source.js`. On top, `engine/grass.js` scatters the original
grass clumps (`grassblades` atlas) over grassy materials near the camera. Options → Grass sets it to off, on or dense.

### Walls (docs/spec/walls.md)

Walls, towers and traps use the wall placer: tiles on an 8 m grid, never rotated. A wall piece is a hub with up to 8
arms; `wallmap.js` decides which arms show (towards own walls, gates and towers; not across an L corner) and the
piece blocks the nav grid only along them. Lines are dragged (press–drag–release; Shift-release adds a corner, Ctrl
keeps the mode) and every piece is paid on its own. A gate goes into an own straight run, replaces one piece and takes
its neighbours as wings (clicking a wing selects the gate, damage to a wing hits the gate). Workers chain to the
nearest unfinished piece within 50 m.

### Moving harbours

The SEAS carrier and the Aje floating harbour are buildings that sail (`naval.js moveHarbour`): right-click moves
them, Shift+right-click sets the rally point. The carrier opens its front hull (`work_finished`) to release a unit.

### Wild animal nests

Nests of original maps respawn their animals like Nest.usl (`systems/animals.js → wildNestsUpdate`), with at most
`WILD_CAP` wild animals alive at once.

### Player colours

Materials flagged as party-coloured in the GSF (attribute bit 0x1000) are cloned per player and tinted with that
player's colour (`engine/assets.js → cloneModel(template, party)`). "No colour" leaves the original texture.

### Rules from the tech tree

`techtree.js` loads the original tree once (`TechTreeBase`) and gives every player a `TechTree`: the start values
plus the filters that are switched on (finished upgrades, existing buildings, unit level filters, auras). Objects can
also have their own `LocalTree` (farm modes, big tent, defensive mode ...). `rules.js` reads from whichever tree is
responsible (`entity.rulesOwner()`), memoised per tree version.

When a filter is switched, the tree is rebuilt; units and buildings notice the new version within half a second and
re-read their stats (hit points keep their ratio, models are swapped when the gfx changed).

### Entities

`Unit` and `Building` share `Entity`: position, owner, hit points, `st` (status), `cd` (move cooldowns), `anchor`
(the post a unit returns to after automatic fights). A unit's `task` object describes what it does now
(`{type: 'gather', node, phase: 'deliver', ...}`); the systems advance it. Models are cloned from templates loaded
by `engine/assets.js`; `compose.js` adds the attached parts the original scripts add, driven by the datamined
composites table (`pwexport/data/composites.json`, normalized into `gamedata.json` → `composites`):
each part has a model (or level / epoch variants), the link it hangs on, its parent part, its animation and a
condition (`always`, `ready`, `upgrade` (per-unit or player filter), `invent`, `buildup` / `unless` (which build-up is
mounted)). Units rebuild their parts when the wanted set changes (level up, upgrade, epoch); buildings
(`Building.updateTurret`) the same for tower turrets, the Hu harbour crane and the floating harbour's turtles.
Walk animations come from the model's walk set (`manifest.walk`, "defn" before "def").

### Interface

`main.js` exposes a small game API on the global `G` (`G.useAction`, `G.order`, `G.placeBuilding`, `G.changeLevel`,
`G.moveActions` ...) which `hud.js` and `input.js` call. Everything visible (icons, frames, cursors, fonts, sounds,
music) is converted from the original interface files.

## Testing

All game tests need the remake's dev server (`python remake/devserver.py --game <ParaWorld folder>` serves it on
http://127.0.0.1:8411/ with the game data the launcher built; `--data <folder>` for another build) and run from the
`remake` folder. `tests/regress.sh` runs the whole set (summary in /tmp/regress.txt).

* `node tests/rules_check.mjs` – rules layer checks against known original values (`PW_REMAKE_DATA` = the built
  game data folder).
* `python3 tests/sim.py "&tribe=Hu&enemy=Aje&aivai" 300,300` – loads the game headless (Chromium + SwiftShader),
  lets the AI play both sides and prints both players' state after each step (errors are reported as `err`).
* `tests/run_all.sh` – one AI-vs-AI game per tribe (logs in /tmp/sim_<tribe>.log).
* `python3 tests/scenarios.py "&tribe=Hu&enemy=Aje"` – scripted rule scenarios (special moves, auras, eggs ...).
* `python3 tests/evaljs.py tests/pathing.js|stuck.js|naval.js "<url options>"` – pathing through a ring of buildings,
  long AI games watching for stuck units, and the naval rules on a water map (`&map=maps/Base/Multiplayer/multi_2_jun_001.ula`).
* `python3 tests/evaljs.py tests/ai_match.js "&tribe=Hu&enemy=Aje&aivai&aib=Giraffe,Dodo&aid=4&minutes=25"` – the
  computer player against itself: a timeline per side (epochs, workers / army, attacks, kills) and sanity checks;
  `tests/ai_defence.js` (proportional defence, workers, wild animals) and `tests/ai_campaign.js` (the interface
  campaign triggers use: behaviours, scripted waves, defence areas, unit locks). See COMPUTER_PLAYER.md.
* `python3 tests/live.py` – the real frame loop with mouse selection.
* `python3 tests/evaljs.py tests/nests.js "&map=maps/Base/Multiplayer/the%20river.ula"` – nest respawning.
* `python3 tests/evaljs.py tests/maps_audit.js` – which objects of every listed map can be shown.
* `python3 tests/copy_error.py` – the error banner copies the full report to the clipboard.
* `python3 tests/evaljs.py tests/walls.js "&tribe=Hu&enemy=Aje&debug"` – wall grid, arms, corners, gates, towers.
* `python3 tests/evaljs.py tests/carrier.js "&tribe=SEAS&enemy=Hu&map=maps/Base/Multiplayer/multi_2_jun_001.ula"` – the carrier sails and unloads.
* `python3 tests/evaljs.py tests/debug_mode.js "&debug"` – debug mode (free, instant, no building requirements, epochs) and the menus that open on selection.
* `python3 tests/evaljs.py tests/looks.js "&tribe=Aje&enemy=Hu"` – attached parts upright, carried logs, 2D parts of
  buildings, tree sprite cells, souls only with a shaman.
* URL options: `?quick` start without the menu, `?tribe=Ninigi&enemy=SEAS`, `?seed=5`, `?reveal` (no fog),
  `?aivai` (the computer also plays your side), `?manual` (no frame loop; tests call `G.step`),
  `?map=maps/<path>.ula` (an original map), `?debug` (debug mode: free and instant for you), `?color=blue&aicolor=red` (player colours by id, `none` = untinted).

See also: [MAP_FORMAT.md](../../docs/MAP_FORMAT.md), [DATA_PIPELINE.md](DATA_PIPELINE.md), [GAMEPLAY_RULES.md](GAMEPLAY_RULES.md), [MODDING.md](MODDING.md) and the
extracted original rules in [spec/](spec/).


## Additions 2026-10-01

* **Attached parts** are data-driven (see above): the Triceratops titan's two ballistas with gunners, the ballista
  tower's ballista, mammoth / rhino build-ups, the Brachiosaurus' build-ups with their seats and flags, level flags.
* **Rally points** only for objects that produce units (`G.canRally`), drawn as the tribe's rally flag model
  (`<tribe>_rally_point`, `_harbour` on water; ui/overlay.js `updateFlags`).
* **Task icons** on the army pyramid cards (FightingObj.SetTaskDescription → PyramidCard.usl `card_task_*`):
  food / wood / stone, buildup, repair, fight, transport, idle (zzz, workers) / wait (others, after 2 s).
* **Towers attack wild animals** on order (`World.hostileTo`).
* **Walls**: one geometry variant per piece (the models carry 4 per arm and up to 11 hub posts; all of them stacked
  made the top jagged). The variant of an arm comes from the edge it shares with its neighbour and variants are
  sorted by height, so both halves of a segment match (`assets.js tagWallArms`, `parts.js applyState`). Pointing at
  a wall piece while placing a tower / trap / gate snaps to that piece's tile.

## Campaign missions (2026-10-02)

The original single player campaign runs from the mission data the toolkit exports (`pwexport.campaign`, schema
`pw-campaign/1`, served as `campaign/index.json` and `campaign/<pack>/<map>.ula.json`). The foundation is in:

* `src/game/campaign/setup.js` - `loadCampaign(id)`, class `Campaign` (= `G.campaign`): plans what the mission
  needs (models, which map objects it places itself), builds the players, objects, groups and start locations, and
  is the run-time context of the trigger engine; `registry.js` (objects by GUID / name / handle / group / query),
  `regions.js`, `props.js` (stand-alone scenery).
* `src/game/scripting.js` - World methods for mission actions (diplomacy, owner changes, spawn by class, delete,
  teleport, resources, tech filters, fog reveals).
* `src/game/player.js` - N players with a directed diplomacy table (hostile / neutral / friendly); skirmish keeps
  its two players and teams. `G.ai` only exists in skirmish; `G.brains` is the map of AI brains, `G.sees(p)` whose
  view the human player shares.
* `src/ui/menu.js` - title → Campaign (mission list, difficulty); `G.endMission(won, info)` ends a mission.
* `src/ui/mission.js` - the mission UI contract (a stub).

The interface for the trigger engine, the mission UI and the campaign AI is **docs/CAMPAIGN_RUNTIME.md**. Test:
`tests/campaign_load.js` (`&campaign=<n>`; missions 11 and 1 are in `tests/regress.sh`).
