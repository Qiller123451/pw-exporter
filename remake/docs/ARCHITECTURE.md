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
│  │  ├─ particles.js        the models' own particle emitters (GSF chunk 2: fires, smoke, torches, spray, blood)
│  │  ├─ modelfx.js          effect models placed, attached or flying for a time (the game's effects are models)
│  │  ├─ weather.js          snow and rain of the level's weather program
│  │  ├─ audio.js            sound events, 3-D positioning, voice acknowledgements
│  │  ├─ atmo.js             the level's ambience (CAtmoSoundMgr): beds and events by ground, camera height, daytime
│  │  └─ music.js            the original's music manager: switches, playlists per level, combat / hometown
│  ├─ game/                  the simulation – no DOM, no rendering decisions
│  │  ├─ techtree.js         the original tech tree evaluated at runtime (StartTT + switched filters)
│  │  ├─ rules.js            typed queries on the tree: stats, weapons, actions, requirements
│  │  ├─ world.js            the World: entity lists, spawning, orders, the update loop
│  │  ├─ systems/            the rules, one file per topic (see below)
│  │  ├─ entities.js         Unit, Building, ResNode, Projectile
│  │  ├─ prop.js             stand-alone scenery: a campaign's addressed objects, healing wells
│  │  ├─ compose.js          multi-part objects from the composites table (gamedata.composites): turrets, riders, build-ups, drawbars/wagons, level flags
│  │  ├─ anim.js             animation controller with sound events
│  │  ├─ nav.js              walkability grid, clearance, A* path finding, gates, spatial hash
│  │  ├─ formation.js        where each unit of a group goes (front / rear by reach, centre by toughness)
│  │  ├─ player.js           resources, caps, population, pyramid counters, diplomacy
│  │  ├─ ai.js, ai/          the computer player: a port of the original's script AI (docs/COMPUTER_PLAYER.md)
│  │  ├─ wallmap.js          the engine's WallMap: 8 m tiles, shapes, lines, gates, part names, pf masks
│  │  ├─ buffs.js            the "ranged buffs" of a unit (BuffDecals): info window icons, ground decals
│  │  ├─ colors.js           the 8 original player colours (ACColors.txt) and party-material detection
│  │  ├─ mapgen.js           the random jungle skirmish map (trees, stones, bushes, animals, start positions)
│  │  ├─ skirmish.js         the skirmish setup: up to 8 slots, game type, teams, options, validation, start locations
│  │  ├─ pointbuy.js         the army budget: prices, presets, buying the start army, the computer players' armies
│  │  ├─ stats.js            the game's statistics: counters per player and the time line (from the world's events)
│  │  └─ maps/
│  │     ├─ ula.js           reader for original .ula maps (see docs/MAP_FORMAT.md of the toolkit)
│  │     ├─ forest.js        forest blocks of original maps: the trees of the 32 m forest squares (forest.json)
│  │     └─ source.js        "map source" interface: generated map or original map -> what buildWorld needs
│  └─ ui/                    everything the player sees and clicks
│     ├─ hud.js              resource bar, info window, command bar, flyouts, army pyramid (drag & drop)
│     ├─ input.js            mouse / keyboard, selection, orders, building placement, move targeting
│     ├─ feedback.js         world events -> sounds, messages, effects (UISndMgr rules)
│     ├─ gamefx.js           the game's own effects for world events: hits, deaths, spawns, level-ups (GAME_EFFECTS.md)
│     ├─ menu.js             title / campaign / pause / options / end screens (original menu art)
│     ├─ skirmish.js         the skirmish setup window: map, game options, the eight player slots
│     ├─ pointbuy.js         "My Army": the army pyramid, shop, resources and presets of the army budget
│     ├─ diplomacy.js        the diplomacy window: opinions of the other players, tribute
│     ├─ chat.js             the chat bar (Enter / Ctrl+Enter / Shift+Enter) and the history of the news lines
│     ├─ stats.js            the statistics screen: the tabs' tables and the time line graph
│     ├─ overlay.js          health bars, selection circles, markers
│     ├─ decals.js           the decals under units: hero rings, buff decals (PWClient's object decal list)
│     ├─ minimap.js          the minimap as the original's engine draws it (MINIMAP.md), its buttons
│     ├─ tooltip.js          the tooltips: help items, command bar lines, the window above the minimap (TOOLTIPS.md)
│     ├─ mappreview.js       map list, map info and the map's own preview picture in the skirmish menu
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
| moves_mirage.js | the MIRAGE mod's moves (added to `MOVES`; only its tech tree offers them), timed unit filters, jetpack flight, Babbage's exo suit, blinding storm, parasites (spec/moves_mirage.md, MIRAGE_BUGS.md) | MIRAGE Hero.usl, character.usl, Animal.usl, Vehicle.usl, mirage/Miracle.usl, Mirage.usl |
| buildings.js | behaviours by script class (`BEHAVIOURS`): gates, traps, resin field, nests, warp gate, fields, walls (falling stones) | Building.usl |
| landmarks.js | healing wells, lakes of healing / damage, the weather program | MiscObj.usl, task/FountainHeal.usl, WeatherMgr.usl |
| items.js | items (artefacts): item spawns, picking up, carrying (filters, effects), dropping | misc/Item.usl, misc/ItemSpawn.usl, task/PickUp.usl |
| finishing.js | finishing moves: the check at the blow, the pair of animations, the victim on the fighter's link | misc/FinishingMoveMgr.usl, task/FinishingMove.usl |
| wallwalk.js | walking on walls: the walkway, up and down, orders and fights from a wall, the fall (spec/walls_walk.md) | character.usl, FightingObj.usl, task/misc.usl, PWServer CActWallWalk |
| siege.js | ladders, the siege tower and siege brachiosaurus docked to a wall | task/DockWall.usl, Building.usl CLadder, Vehicle.usl |
| gameover.js | the end of a skirmish: who is out, the head quarter timer, the last team standing; Domination flags and timer, Defender | misc/GameOverMgr.usl, DominationFlag.usl |
| animals.js | wild animals: nests and their areas, flocks, babies growing up, roaming, sleep, feeding, hunting, threats, fleeing, the scare of a death | Animal.usl, Nest.usl, Flock.usl, ScareMap.usl, task/Feed.usl, Sleep.usl, Fight.usl |
| transport.js | bunker garrison, transports (land and ships: boarding and unloading at the shore, one passenger or all), passengers shooting from howdahs | TransportObj.usl, CBunker |
| naval.js | fishing boats and floating harbour fishing, sea mines, water turrets, torpedo turtle, submarine stealth, water targeting rules (see spec/naval.md) | Ship*.usl, Harbour.usl, Mine.usl |

Each file exports an object of methods that `world.js` copies onto `World.prototype`, so inside any system
`this` is the world and every other system's methods are available (`this.takeDmg`, `this.startGather` ...).

### Maps, water and navigation

`buildWorld` (main.js) builds the world from a *map source* (`maps/source.js`): either the random jungle map or an
original `.ula` file. On maps with water there are three walkability grids: `nav` (land; water deeper than 0.4 m
blocks), `waterNav` (ships; shallower than 1.5 m blocks) and an amphibious grid (either). `World.navFor(unit)`
picks the right one; buildings block all of them. Coastal buildings (harbours) snap so their dock point lies in
deep water (`construction.js → placement / coastalSnap`).

On original maps the land grid follows the map's own pathfinder grid (chunk `PaFi`, docs/MAP_FORMAT.md):
`World.markTerrain` blocks the 2 m cells the editor marked unwalkable - mountains, cliffs, the steep shore - and opens
the shallow fords it marked walkable (`steepCell` / `shoreCell`: harbours may stand on the shore, amphibians cross it).
Maps without such a grid - the sequel's and the random ones - block ground steeper than 32 degrees instead
(`maps/source.js slopeWalkable`: the largest rise over the edges and diagonals of a cell; their hills and dunes stay
walkable, their cliffs do not; `tests/cliffs.js`). A knockback throw stops where the unit could not walk. With the
mountains blocked, the passes matter: a big unit (spider walkers,
dinosaurs) that does not fit through one with its full clearance squeezes through as a small one, and an attacker
(attack-move, any move of a computer player) whose way an enemy gate shuts breaks it (`nav.find` breach, `Unit.setPath`,
`World.unitUpdate`; only enemy gates) - mission 13's SEAS attacks come through the player's skewer gates. The grid
labels its connected ground regions once the terrain is marked (`nav.labelRegions`): a goal in another region is
replaced by the nearest cell of the start's region instead of an A* search over the whole map, and a unit does not
search again for 3 s for a goal it found no way to (`Unit.noWay`). Coordinates: the original's map space is left-handed (x east, y south); the world
is `x = map x - w/2, z = map y - h/2`, headings `pi - rot`, models mirrored in x by the exporter (`maps/frame.js`).

### Ground look

The terrain shader (`engine/terrain.js`) blends the 8 ground materials of the map with relative height blending.
Each texture's detail decides where it shows through, so borders follow stones and tufts. Every texture is also
sampled at a second rotated scale mixed by noise, which hides the tile grid, and steep slopes are projected from
the side. Material borders are noise-warped in `maps/source.js`. On top, `engine/grass.js` scatters the original
grass clumps (`grassblades` atlas) over grassy materials near the camera. Options → Grass sets it to off, on or dense.

### Walls (docs/spec/walls.md, docs/spec/walls_engine.md)

`wallmap.js` is a 1:1 port of the engine's WallMap (reverse-engineered from PWServer / PWClient): 8 m tiles with a
16-bit word each (owner, race, class, gate, tower, blocked, built), heights in 2 m levels, the legal shapes and the
corner rule, lines as the engine's shortest path over placeable tiles (all or nothing), gates where GateFits allows
(any axis, the strongest class), towers standing on a piece, traps as lines. A piece shows the model parts BuildName
picks (the GSF part names, kept by `pwexport/gsf.py`) and blocks the nav grid with the model's pf boxes of its PFMask.
`G.placeWall` checks every tile first, then places them in order (first tile built, the rest queued). Clicking a
gate's wing selects the gate and damage to a wing hits it.

### On the walls, ladders, siege towers (docs/spec/walls_walk.md)

`systems/wallwalk.js`: the built pieces of the walkable wall classes (wallclassconfig "Walkable": hu_small_wall,
hu_re_enforced_wall, aje_clay_wall, ninigi_palisade; gamedata `walkableWalls`) form a walkway along their arms, 7.8 m
up. Characters go up an own walkable wall (right click: "use") with a jump from a free side of the piece (PWServer
CActWallWalk: "jump_wall"), walk along it from tile centre to tile centre (`u.onWall`, `u.wpath`; the height comes
from `World.groundY`), and any ground order takes them along the walkway and down first. On the wall: +50 ranged
protection (Defence_On_Wall), no knockback, they hold; melee fighters can't reach across the height (combat.js
`rangeZone`: the height rule and the line of sight of every blow), shooters gain range shooting down. A destroyed
piece drops the characters on it (height × 5 damage).

`systems/siege.js`: one siege object per piece (`W.sieges`). A Hu ladder (mods such as MIRAGE offer it) goes
against any wall piece on the side nearest the workers; finished, its owner's and allies' characters climb it onto
the walkway - an enemy's walkway is entered and left only that way - or over a wall without one. A siege tower told
to attack a wall docks to it (2 s); its passengers get out beyond the wall; a new order undocks it first. The siege
brachiosaurus docks the same way and is climbed like a ladder.

Tests `tests/wallwalk.js`, `tests/walls.js`.

### Items, finishing moves, buffs

* **Items** (`systems/items.js`; misc/Item.usl, ItemSpawn.usl, task/PickUp.usl): the level's item spawns put
  treasure chests on the map (Root/Items: MaxItems, no class twice; `generate_always` first). Characters, animals
  and vehicles carry one (right click: the "trade" cursor, `pickup` task, "pick_up"); while carried its tech tree
  filter is on for the carrier's player (`GlobalTT`) and its effect works (ShowWorld, RepairNoCost, MoreScalps,
  the ride cup's +50 % transport hit points); the carrier's death drops it (lost in deep water). The info window
  shows it in the item slot. Test `tests/items.js`.
* **Finishing moves** (`systems/finishing.js`; FinishingMoves.txt → gamedata `finishing`): a blow that would kill an
  enemy fighting back becomes a move of two animations; the victim dies at once and is carried on the fighter's
  link; the fighter can't be hurt until its animation ends.
* **Buffs** (`game/buffs.js`; buffdecals.txt → gamedata `buffs`): what acts on a unit (auras, bonus buckets, timed
  states, the wall) as the original's "BuffDecals": up to five icons in the info window by the file's order and the
  buff's visibility, and the ground decal of the first one (`ui/decals.js`: a tile of Effects/UnitDecals, 3 m; heroes
  stand on a ring of Effects/Selection in their player's colour - PWClient's object decal list, 0x481900).

### Moving harbours

The SEAS carrier and the Aje floating harbour are buildings that sail (`naval.js moveHarbour`): right-click moves
them, Shift+right-click sets the rally point. The carrier opens its front hull (`work_finished`) to release a unit.

### Wild animals

`systems/animals.js` runs the wild animals as the original's scripts do (Animal.usl, Nest.usl, Flock.usl,
ScareMap.usl, task/Feed.usl, task/Sleep.usl, Fight.usl CFlee / CAlarmed; docs/spec/units.md section 7):

* **Nests** (`addWildNest`, `wildNestsUpdate`): their action, safe and hotspot areas are the map's regions
  `<nest>_ActionArea` / `_SafeArea` / `_HotspotArea` (chunk Rgns: `maps/ula.js regions`; boxes and ovals; a nest
  without them gets circles of 20 and 10 m). A nest spawns while it has fewer than `spawn_max` animals (3 when the
  map leaves it out) and `spawn_amount` is not used up, one every `spawn_rate` s; `advance_time` pre-spawns the first
  ones with their ages. Nests whose safe areas overlap share a flock; the flock's centre moves every `agility` s (to
  the safe area at night) and gives the members their next walk targets; every 2 s members outside the action area
  are sent back. At most `WILD_CAP` wild animals live at once.
* **Babies** (`birth`, `growthUpdate`): a newborn has `strength = clamp(age / growup_duration, 0.2, 1)` of its hit
  points and damage and a share of its skulls; it stays in the safe area. Its size is the GSF's `growup` animation
  sampled at `1 - age / growup` (the model's root scale: grown in the first frame, newborn in the last).
* **The idle loop** (`roamUpdate`, every 6th idle tick): the next walk target, else in its sleeping time 4 of 10 times
  sleep, else when hungry (`repletion` s since its last meal) 2 of 10 times feed, else wait 5 .. 10 s. Feeding: to a
  tree (vegetarians; or grazing where it stands) or a carcass (hunters) of its area, 2 .. 6 bouts of 3 .. 10
  "feeding" loops, each taking its damage off a carcass and healing half of it. A hunter that killed a wild animal
  eats its carcass.
* **Hunters** (`aggressive` 1, not babies) attack what comes in their reach - a nest's animals only inside its action
  area, wild prey only when they know no food; an enemy near but out of reach they threaten ("menace", at most every
  10 s). Units holding ground threaten enemies in their alarm range the same way (`jans_anim_0 .. 2`), and after a
  won fight one warrior in four cheers (`victory_0 .. 2`).
* **Attacked** (`animalHurt`): the peaceful flee (`flee`: legs of 15 m, slower when hurt, tiring - fatigue recovers
  0.02 a second), neutral and hunters fight and call their kind when they are enough, else flee; a nest's baby calls
  the adults.
* **The scare of a death** (`addScare`): every animal that dies frightens the wild animals that are not hunters within
  60 m: they run off to twice that and avoid the place while it lasts (strength 360, 0.1 a second).

Tests `tests/wildlife.js`, `tests/nests.js`.

### Healing wells, lakes, weather

`systems/landmarks.js` (MiscObj.usl CFountain, CLakeOfDamage / CLakeOfHealing, task/FountainHeal.usl, the client's
WeatherMgr.usl):

* **Healing wells** (`W.wells`: props - `game/prop.js` - with `.well = {max, fill, refill}` from the object's
  `maxhitpoints`, `hitpoints`, `refill_dur`; missing ones are 100, 100, 120 as attribs_def.txt has them): over a
  well the right-click cursor of characters, animals, vehicles and ships is "healing" (the special cursor); the
  order sends them there at their walking pace (task `fountain`), within 30 m of it when the walk ends a unit gets
  what it lacks or what is left, and the well refills: every second a refill_dur-th of its store. A well can be
  selected: the info window shows what it holds. Its `fill_anim` plays when someone drinks.
* **Lakes of healing / damage** (`W.lakes`, from `DMGL` objects: `region_name`, `damage_per_tick`, `damage_types`):
  every 3 s every fighting object in the region (a region of the map: `W.regionOf`, campaign/regions.js) of the
  types (all if none) is healed, or damaged - its protection counts, passengers are spared.
* **Weather** (`W.weather`): the level's Root/WeatherData - tracks of Duration minutes, Type 1 snow / 2 rain,
  Intensity, WindDir, WindStrength - one after the other, looped or ending; the trigger `WTHR` (chgtype 1) skips
  to the next. `engine/weather.js` draws it in a box around the view (Options: "Weather"). Only mission 8 of the
  campaign has one (light snow, looped).
* Placed effects (CFX: heal areas, the holy forest) are shown; a heal glow saved on a unit (`fx_heal_passive`) is
  not. (Scenery without a type - sandbags, fishing nets, dust twisters - shows on campaign maps, whose objects come
  from the toolkit's export, not on skirmish maps: `maps/ula.js objects` finds objects by their type tag.)

Test `tests/landmarks.js`.

### Ambience

`engine/atmo.js` plays the level's ambience like the client's CAtmoSoundMgr (PWClient.exe 0x432d80 .. 0x436e9d):
the template of the level's `material_atmos` (Audio/AtmoTemplates/jungle.txt ...; "No Atmos": none; a generated map
its setting's), exported by `pipeline/build_sounds.py` (`atmo`). A template has 36 states `mat<M>:<H>:<D>`: M the
ground material of the 32 m square in the middle of the view (above 20 m) or under the camera - its most frequent
4 m ground material, 8 for a forest block with more than half of its trees (`maps/source.js soundMaterial`) - H the
camera more than 12 m above the ground (HeightBreakPoint), D day. Each state loops its bed (wav1; the playlist's
`W<n>` picks wav n) at its volume; a change of material waits 0.5 s (FadeDelay), of height or daytime not, then the
beds cross-fade. The event playlist plays one entry at a time: `E<wav>-<a>-<b>-<c>-<d>[-<e>-<f>-<g>-<h>]` = the wav
a .. b times, every c .. d seconds, at pan e .. f minus 100 and volume g .. h - entries without the last four have
volume 0: they are pauses. Then a random entry. The ambience has its own volume (Options: "Ambience"). Not ported:
the sound groups of Audio/soundeffects.txt (war drums when many fight) - which sounds count is not in the data.
Test `tests/atmo.js`.

### How animals look

A wild animal class (tech tree `Objects/World/ANML`, `Rules.isWildClass`) keeps its wild looks whoever owns it - the
sequel's outbreak, a captured animal: no saddle, no party colour, no riders (MIRAGE Animal.OnInit). Of its "misc"
parts (VIS_FLAG_ANML_MISC) it shows only those that belong to the beast - stegosaurus and kentrosaurus plates,
the mammoth's coat, the turtles' shells (MIRAGE FightingObj.ShowAnmlMiscFlag); the platforms and racks the models
carry for the tamed versions (brachiosaurus, parasaurolophus, ankylosaurus) stay hidden. Tamed animals show saddle
and colours; their misc parts follow Base Animal.usl (hidden on ankylosaurus, brachiosaurus and parasaurolophus
unless a catapult or gatling is mounted, on the lumber mammoth and arena animals). `game/compose.js` updateMask,
miscShown; test `tests/wild_looks.js`.

### Day and night

The original's clock (`CTimeMgr`, PWServer.exe: 144 virtual seconds for each second of the game, a day of 86400 = 10
minutes; day from 6:00 to 18:00, `ServerApp.usl` SetVirtualDayOffset 0.25 / SetVirtualNightOffset 0.75) starts at the
level's `Root/Base/StartTime` (12:00 when the level has none; the campaign's missions start between 6:00 and 18:00):
`World.dayTime()`, `isNight()`. Every finished building - and every ship - looks at it every 20 s and switches its
lights (`Building.usl` NIGHT_TIMER, `Ship.usl` TIMER_NIGHT: `SetRndInvMaskSingleFlagInv` 20 on at night, 17 off): the
GSF parts with attribute bit 20 (the warm pools of light under lamps and windows, their halos, the fireflies'
emitters) show at night, those with bit 17 by day (`engine/parts.js todOf`, `applyState` / `applyNight`; the glowing
halos are added to the picture: `props.js modelSprites(.., glow)`). The landscape's objects keep their night parts
off, as in the original (only buildings and ships switch them). The remake does not darken the map at night - the
lighting stays the same, as in the original; only the sequel's missions have nights of their own (`World.nightFn`,
darker), and the lights follow them. Wild animals sleep in their
sleeping time - the night, by day for a `nightactive` one (none in the game) - four of ten times they would look for
something to do (`Animal.usl` OnIdleTick, `CSleep`: to a place of their nest, 20 .. 59 loops of "rest";
`systems/animals.js startSleep`). Test `tests/night_lights.js`.

### Music

`engine/music.js` is the original's `MusicMgr.usl` on its own tables (`Audio/MusicMgr.txt`, `Audio/MusicTracks.txt`,
exported into `sounds.json` "music" by `pipeline/build_sounds.py`). Situations are switches, the highest one that is
on plays: MainMenu < Background < BackgroundLeveled < Hometown < Trigger < Opening < Combat. A game picks its playlist
by the level's name ("Single 05" -> `single_05`, "Tutorial"), else its setting's atmosphere file (`savanna.txt` ->
`savanna_txt`; a generated map by its setting), else `default`: an opening track played once (missions 5, 6, 11 ...),
background and combat tracks. Combat music comes after attacks on the player's objects at 3 places within 10 s (the
minimap's attack events, `ui/feedback.js`: one per 0.15 s of hits) and ends 10 s after the last one; each switch
fades as the table says (into combat 2 s, out of it 10 s). The hometown theme: the camera within 75 m of a home object
for 5 s - the original's query asks for the classes "fireplace" / "seas_headquaters", which no object has, so only
the Aje's resource collector brings it. The trigger action `MUSI` plays a track once or looped. The end of a game
changes nothing (`MusicMgr.OnGameEnd` has no caller): the level's music goes on behind the end screen; the menus play
the main theme. Test `tests/music.js`.

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
music) is converted from the original interface files. The layout is the original's (IngameScreen.usl): the army
pyramid on the left, the info window and the command bar at the bottom left, the minimap in the bottom right corner
with the tooltip window above it (docs/MINIMAP.md, docs/TOOLTIPS.md). Along the top as IngameScreen.usl puts them:
the group bar at x 11 (GroupBar.usl: a button per assigned control group and the next free one; a click selects
the group and stays pressed while the selection is the group, a right click assigns the selection, a double click
takes the camera there), the menu button at 235, the resource bar at 295, the quest, diplomacy and chat buttons at
720, 789 and 869 (`hud.slot`).

The mouse cursor shows what a right click would do (`input.js cursorFor`, GameInputController.usl GetAction on the
selection's CSelectionInfo, Game.usl CCursorMgr): harvest wood / stone / food on resources and free farm places,
attack - attack_walk out of reach, attack_area_weapon_invalid inside an area weapon's minimum range - and
attack_harvest (workers on wild animals), build on sites and damaged buildings, load on transports with room, trade
on another market for carts, the special cursor for healers on hurt units, "no" beyond the map's edge; the standard
cursor otherwise (also over open ground: "walk" only while a move is armed).

Autosave (IngameScreen.usl UpdateAutosaveTimer, Game.usl OnAutosave): every 5 .. 60 minutes of real time (Options,
10 by default, on by default) into the slot "Autosave", which the next one replaces; not while paused, in a menu or
during a cutscene - then at the next moment it can. F1 opens the help (`ui/helpbook.js`, HelpMenu.usl): the topics
of Texts/Help/index.txt and their files' help items with their pictures and links (`help.json`, built by
`pipeline/build_data.py help_book` with `pwexport.texts.help_doc`), on the item of what is under the mouse, being
placed or selected; the game pauses meanwhile.

Clicking (`input.js entityAt`): units by their screen rectangle first (the smallest wins), then whatever the mouse ray
meets first of the buildings' visible surfaces (`pickHit`; the models' flag-less hulls reach far beyond many SEAS
buildings) and of the resources (standing cylinders of the height of their kind). A building put down by a player
levels the ground under it and paints its ground materials with its object brush, and the plants and trees within
its radius go (`game/ground.js`, `main.js W.adaptTerrain / clearVegetation`, docs/TERRAIN_NOTES.md "Object brushes").
While a building is being placed, the placement grid shows which 2 m cells around it are free (green) or blocked
(red) (`input.js updatePlaceGrid`).

Controls are the original's (Scripts/Game/options/Keys.srf, GameInputController.usl; docs/spec/formations.md):
letters as on the key (like the original's virtual keys). Q / A / Y arm a row of the build or produce menu, X the
stances, E / D / C the special moves' rows (`hud.js armRow`: rows counted from the bottom, the digits 1 .. 0 then
press the row's buttons in their tech tree menu places); V attack, B move, W idle workers, H and T Z U I O P L K jump
to buildings, Space the last alert, Del / Shift+Del self-destruct, Ctrl+digit with nothing selected keeps a camera
view. The remake's own keys moved to keys the original leaves free: N attack-move, S stop, R rally point, Ctrl+U
level up, J quest log, Home centre, F5 / F8 quick save / load. The middle mouse button pans, Alt + left or middle +
right turns the camera. A right-click gives its order when the button goes up; dragged more than 2 m it draws the
formation arrow (`input.js dragArrow`, `game/formation.js`): the group lines up at the press point facing the arrow,
the longer the arrow the wider the ranks. Shift + right-click adds a waypoint, Ctrl + right-click patrols.

### Skirmish, army budget, diplomacy, chat, statistics (docs/spec/ui_groups7_9.md, docs/spec/pointbuy.md)

The skirmish setup (`ui/skirmish.js`, `game/skirmish.js`) is the original's pre-game window in skirmish mode: the
map (the list offers the maps of the chosen game type; `maps/index.json` carries each map's players and game types,
`pwexport/ula.py mp_header`), the options (game type, defender minutes, teams, points, warp gate, fog of war, locked
diplomacy, handicap, chosen head quarters) and eight slots (you, computer or closed: tribe, personality, level 0-9,
team, colour, handicap, head quarter), checked as PlayerListWindow.usl does. `main.js skirmishPlayers` makes the
players on their start locations with the map's objects of their slot; `createBrains` a TribeAI per computer slot.
`systems/gameover.js` ends the game (last player or team standing, Domination, Defender; the HUD's timers).

The army budget (`game/pointbuy.js`): with points every player starts with what it bought - the human with the
setup's preset or the army of the "My Army" page (`ui/pointbuy.js`: the pyramid with drag and drop, the arrows that
buy at a level, the resource buttons, the shop list, own presets), a computer player with its AiPBPreset tier.
Campaign missions with a budget open the army screen before they start (`menu.js campaignArmy`): the level's preset
fixed, the budget max(bonus points of the mission before, MinCredits).

In the running game the top bar has Diplomacy (skirmish) and Chat: `ui/diplomacy.js` sets my opinion of the others
(`W.changeOpinion`, told to everybody) and sends tribute (`W.tribute`: no storage limit for the receiver); the chat
(`ui/chat.js`) passes "AI<n>: help / food / wood / stone / gift" of a line to all to that computer player; its right
click shows the history of the news lines. `game/stats.js` counts per player from the world's events (`World.emit`)
and samples the time line every 10 s; the end screen (`menu.js end`) opens `ui/stats.js`.

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
  `regions.js`; `src/game/prop.js` (stand-alone scenery).
* `src/game/scripting.js` - World methods for mission actions (diplomacy, owner changes, spawn by class, delete,
  teleport, resources, tech filters, fog reveals).
* `src/game/player.js` - N players with a directed diplomacy table (hostile / neutral / friendly); skirmish keeps
  its two players and teams. `G.ai` only exists in skirmish; `G.brains` is the map of AI brains, `G.sees(p)` whose
  view the human player shares.
* `src/ui/menu.js` - title → Campaign (mission list, difficulty); `G.endMission(won, info)` ends a mission.
* `src/ui/mission.js` - the mission UI contract (a stub).

The interface for the trigger engine, the mission UI and the campaign AI is **docs/CAMPAIGN_RUNTIME.md**. Test:
`tests/campaign_load.js` (`&campaign=<n>`; missions 11 and 1 are in `tests/regress.sh`).

## Saved games (2026-10-11)

`src/game/save.js` writes the whole simulation as one JSON document and puts it back (`snapshot(G)`,
`restore(G, snap)`); `src/ui/saves.js` keeps saves in the browser (IndexedDB `pwr-saves`, gzip; one store for every
game data configuration) and as `.pwsave` files. Menu: Save game / Load game in game, Load game on the title screen;
F5 quick save, F8 quick load. A save made with another configuration (MIRAGE ...) loads on that configuration's page.

* **Saving** walks the object graph from a few roots (World, brains, Campaign, trigger engine, mission UI) and
  writes every object once into a table; references are table indices (shared objects and cycles survive). Per
  class `SPECS` say which fields are left out (drawn or derived: models, animations, rules read from the tech tree,
  lookup tables) or which are the only ones kept. What is drawn is never saved, and a function in the state is an
  error (`snap.problems`).
* **Delayed things are data.** `World.later(sec, kind, args)`, `World.periodicEffect(host, dur, every, kind, state)`
  and the trigger engine's `after(sec, kind, args, trigger)` name a handler in `src/game/delayed.js`
  (`DELAYED`, `PERIODIC`, `JOBS`; the systems register theirs: moves.js, combat.js, scripting.js,
  campaign/actions.js) instead of holding closures. The AI's guard and defence areas are `Pool` objects.
* **Loading** reloads the page with the saved game's start settings plus `cfg.load` (main.js `startGame`): the
  same game is set up again, which gives the terrain, landscape, resources and the campaign's records, regions,
  triggers and computer players again in a fixed order. These are the anchors (keys `player:1`, `res:<id>`,
  `rec:<map index>`, `trig:<guid>`, `cond:<guid>:<i>` ...). `restore` removes the fresh units and buildings, levels the
  ground as the game had (`W.groundLog`), fells and empties the used resources, then makes every saved object -
  anchors take the saved values, the rest is created (units and buildings through their constructors) - and
  rebuilds what is derived (tech trees, models and their look: carried goods, tools, camouflage, a gate's last
  animation, ruins and bodies; the registry's tables; the pathfinder grids are saved as they were; fog of war).
  A sequence or dialogue that was on show starts again (`TriggerEngine.resumeShows`).
* Entity ids stay the same (`nextEntityId` / `setNextEntityId`).

Test: `tests/save_load.py "<url options>" [seconds before] [seconds after]` plays, saves, loads the save in a fresh
page, compares the whole state object by object with the saved one (`tests/save_diff.js`) and plays on.
