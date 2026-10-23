# The ParaWorld Remake - documentation

The remake is ParaWorld (2006) rebuilt for the browser from the player's own installation: the rules come from the
game's tech tree and server scripts, the models, sounds, maps and interface art are converted from its files on the
player's computer. It plays the original campaign (with any tribe, with or without a mod such as MIRAGE), skirmishes
on the original and on generated maps, and a campaign of its own, *Containment (1964)*.

This page says where to find what. The original game itself - its files, programs and rules as far as the project
found out - is described in [docs/ORIGINAL_GAME.md](../../docs/ORIGINAL_GAME.md).

## Playing it

- The toolkit's launcher (`Start ParaWorld Toolkit.bat`, `start.sh`) prepares the game data the first time and opens
  the remake at `/remake/`. A mod configuration is played at `/remake/mod/<id>/`; the campaign menu's **Game data**
  switches.
- Controls, menus, the help: in the game (Menu → Controls, Help). The original's key layout:
  [spec/formations.md](spec/formations.md).
- [DEBUG_OPTIONS.md](DEBUG_OPTIONS.md): the debug options before a game (resources, epochs, pyramid places, damage and
  defence, the whole map visible ...) and the debug tools in it.
- New units, buildings, animals and decorations: the toolkit's Workshop ([docs/WORKSHOP.md](../../docs/WORKSHOP.md))
  makes them as a mod, which the remake plays as a game configuration.

## How it is built

| Document | What it covers |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | the source tree file by file, the simulation (world, systems, entities), drawing a frame, the interface, saved games, testing |
| [DATA_PIPELINE.md](DATA_PIPELINE.md) | from the installation to the game data: the build steps, what each reads and writes, incremental builds, mod configurations |
| [GAMEPLAY_RULES.md](GAMEPLAY_RULES.md) | the rules as implemented, with the numbers |
| [MODDING.md](MODDING.md) | changing numbers, adding moves, auras, building behaviours in the remake's code |
| [CAMPAIGN_RUNTIME.md](CAMPAIGN_RUNTIME.md) | how a mission runs: setup from the mission data, the trigger engine, playing with another tribe, mission status |
| [MISSION_UI.md](MISSION_UI.md) | quest log, news ticker, dialogue scenes, cutscenes, timers |
| [COMPUTER_PLAYER.md](COMPUTER_PLAYER.md) | the computer player: the port of the original's script AI, its modules, difficulty, measurements |
| [GAME_EFFECTS.md](GAME_EFFECTS.md) | which effect the game shows for hits, deaths, spawns, level-ups, and how |
| [MINIMAP.md](MINIMAP.md), [TOOLTIPS.md](TOOLTIPS.md) | the minimap and the tooltips as the original draws them |
| [TERRAIN_NOTES.md](TERRAIN_NOTES.md) | the ground texture atlases |
| [GSF_FORMAT_NOTES.md](GSF_FORMAT_NOTES.md), [GSF_REMAKE_FINDINGS.md](GSF_REMAKE_FINDINGS.md) | model format notes from the remake's side (the format itself: [docs/GSF_FORMAT.md](../../docs/GSF_FORMAT.md)) |
| [MIRAGE_BUGS.md](MIRAGE_BUGS.md) | bugs of the MIRAGE mod found while porting it |
| [SEQUEL.md](SEQUEL.md) | *Containment (1964)*: story, missions, classes, maps, models |

## The original's rules, as ported (spec/)

Each file states the original's behaviour with the script lines it comes from, then how the remake does it.

| Topic | Documents |
|---|---|
| Fighting | [combat.md](spec/combat.md) (damage formula, weapons, ranges, splash, projectiles), [moves.md](spec/moves.md) and [moves_mirage.md](spec/moves_mirage.md) (special moves), [formations.md](spec/formations.md) |
| Economy and units | [economy.md](spec/economy.md), [units.md](spec/units.md) (workers, animals, heroes, levels), [buildings.md](spec/buildings.md), [naval.md](spec/naval.md), [pointbuy.md](spec/pointbuy.md) |
| Walls | [walls.md](spec/walls.md), [walls_engine.md](spec/walls_engine.md) (the engine's WallMap), [walls_walk.md](spec/walls_walk.md) (walking on walls, ladders, siege towers) |
| Computer player | [ai.md](spec/ai.md), [ai_group6.md](spec/ai_group6.md), [ai_gametypes.md](spec/ai_gametypes.md) |
| Campaign | [triggers.md](spec/triggers.md) |
| Interface | [ui_groups7_9.md](spec/ui_groups7_9.md) (diplomacy, chat, statistics, end screen, skirmish setup) |
| Effects | [particles.md](spec/particles.md) (the models' particle emitters, from PWClient.exe) |

## The code

```
remake/
├─ src/main.js        start-up, the world of a game, the game API the interface uses, the frame loop
├─ src/engine/        drawing and sound: renderer, terrain, water, models and their parts, particles, effects, audio
├─ src/game/          the simulation (no DOM): tech tree, rules, world, entities, systems/, ai/, campaign/, maps/,
│                     sequel/, saved games, the debug options (cheats.js)
├─ src/ui/            what the player sees and clicks: HUD, input, menus, mission UI, minimap, chat, diplomacy
├─ pipeline/          Python: the game data from an installation (python -m remake.pipeline)
├─ game/              the built game: index.html, game.js (sh build.sh), sequelmaps.js
├─ art/sequel/        the sequel's own models (Blender scripts, CC0 materials)
├─ tests/             regress.sh and its tests (below)
└─ devserver.py       the remake alone on :8411 (python remake/devserver.py --game <ParaWorld>)
```

[ARCHITECTURE.md](ARCHITECTURE.md) lists every file with its job; each source file starts with a comment that says
what it does and which original script or document it follows.

## Tests

`sh tests/regress.sh` runs the whole set (about 120 runs, several hours on the software renderer) against the dev server;
`python3 tests/evaljs.py tests/<name>.js "<url options>"` runs one test in a headless browser and prints `ok` / `FAIL`
lines. The URL options start any game directly: `&tribe=Hu&enemy=Aje`, `&campaign=8&tribe=SEAS`, `&sequel=3`,
`&map=maps/...ula`, `&debug`, `&cheats=<json>`, `&spawn=<class>`. [ARCHITECTURE.md](ARCHITECTURE.md) "Testing" has
the details.
