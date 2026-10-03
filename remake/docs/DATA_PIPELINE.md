# Data pipeline: from the ParaWorld installation to the remake's game data

Everything the remake shows or plays comes from the player's own game folder (`Data/Base`, `Data/BoosterPack1`).
**No game file is part of the toolkit or its repository.** The first time the remake is started from the launcher,
`remake/pipeline` converts what the game needs (about 5 minutes on a desktop PC); the result lives in the toolkit's
data folder (`%APPDATA%\ParaWorldToolkit\remake\<installation id>\`, Linux/macOS
`~/.config/paraworld-toolkit/remake/...`).

**Builds are incremental.** `build.json` keeps a fingerprint per step (`pipeline/stamps.py`): the step's code (its
module and every toolkit module it imports, plus the data files they name) and the names, sizes and times of the game
folders it reads (`pipeline.STEPS`). A step runs again only when its fingerprint changed, a step it builds on ran
again (assets ← rules, models; sounds ← assets) or its output is missing. The converted models stay in `_conv`
between builds (`_conv/stamps.json` per archive: only changed archives are converted again; deleting the folder is
safe). The launcher's **Prepare** button builds what is out of date, ↻ builds everything; on the command line
`--force`. `pipeline.ASSET_VERSION` is only bumped to force a full rebuild everywhere.

**The game-file readers live in `pwexport`** (the Model & Map Exporter, see docs/EXPORTER.md of the toolkit): the GSF
converter (`gsf.py`), the tech tree / settings parser (`tree.py`), the texts (`texts.py`), the composites table of
attached parts (`composites.py`), GLB helpers and the walk-loop finder (`glb.py`), the ground materials
(`scape.py`), the map reader (`ula.py`). The pipeline imports them, so a fix made for the exporter reaches the game
with the next build, and the other way round.

```
Scripts/Server/settings/techtree/_TechTree.ttree ┐
Scripts/Server/classes/**/*.txt                  ├► rules    build_data.py      ──► techtree.json, gamedata.json
Scripts/Server/settings/Resources.txt, NPCList   │
Scripts/Game/misc/IdleAnims.txt, DefPresets.txt  ┘
Data/*/GSF/*.gsf                                 ──► models   convert_models.py  ──► _conv/<archive>/*.glb (scratch)
                                                 ──► assets   build_assets.py    ──► assets/models, assets/tex, manifest.json
UI/hud/**, UI/All_def.txt                        ──► ui       build_ui.py        ──► assets/ui/*.png, atlas.json
UI/menue/**                                      ──► menu     build_menu.py      ──► assets/ui/menu/*
Cursors/*.cur                                    ──► cursors  build_cursors.py   ──► assets/ui/cur/*.png, hotspots.json
Texture/Scape/<Setting>/**                       ──► terrain  build_terrain.py   ──► assets/terrain/**
Scripts/Server/init/*.txt                        ──► sounds   build_sounds.py    ──► assets/sounds.json
Scripts/Ai/**, _AI_ObjectData.txt, 4 Server .usl ──► ai       build_ai.py        ──► ai.json
vegetation/Forest_<Setting>.txt, bin/PWServer.exe ─► forest   build_forest.py    ──► forest.json
Audio/Sound/**/*.wav, Audio/Music/*.mp3, Maps/** ──► read straight from the game folder by the server
```

Run it by hand (all steps, or some):

```
python -m remake.pipeline "C:\Games\ParaWorld" "C:\temp\remake-data"            # everything
python -m remake.pipeline "C:\Games\ParaWorld" "C:\temp\remake-data" rules assets # exactly these steps (--force: all)
python remake/devserver.py --game "C:\Games\ParaWorld" --data "C:\temp\remake-data"   # play it on :8411
```

Every step module also runs alone (`python remake/pipeline/build_ui.py <Data folder> <output folder>`).

## How the server delivers the game

`toolkit/remake.py` maps the URLs below `/remake/` (the game only uses relative URLs):

| URL | file |
|---|---|
| `index.html`, `game.js` | `remake/game/` (the bundled code, `npm run build` or `build.sh`) |
| `gamedata.json`, `techtree.json`, `assets/**` | the built game data |
| `assets/snd/<path>` | `Data/<mod>/Audio/Sound/<path>` (most are IMA ADPCM wavs: `src/engine/audio.js decodeWav` decodes them – bit-exact with ffmpeg – since browsers can't) |
| `assets/music/<file>` | `Data/<mod>/Audio/Music/<file>` |
| `maps/index.json`, `maps/<pack>/<path>` | every `Data/<pack>/Maps/**/*.ula` |

Campaign missions are not part of the build: `campaign/index.json` (the missions in playing order with their
localised titles and descriptions - only each map's level info is read, a quarter of a second for all 17) and
`campaign/<pack>/<rel>.ula.json` (one mission's data, `pwexport.campaign`, docs/CAMPAIGN_FORMAT.md §10) are made on
first request by `toolkit/remake.py` (`campaign_file`, `campaign_index`) and cached in
`<built data>/campaign/pw-campaign_1/<language>/`. A mission file is rebuilt when the map or the exporter module is
newer than the cached file; the index after an hour.

## 1. Models (GSF → glTF)

`convert_models.py` converts every archive of the installation with `pwexport/gsf.py` (see GSF_FORMAT_NOTES.md and
docs/GSF_FORMAT.md of the toolkit). The converter reads constant animation tracks correctly (flag 0x01000000: one key),
applies the helper track to the bone the chunk names (+24), and exports the model's walk sets (`extras.walksets`;
units walk with the "defn" set when they have one, FightingObj.usl). Every mesh part is kept and tagged with its raw
attribute bits so the game can switch them:

| bits | meaning | used by |
|---|---|---|
| 0–8 | LOD mask (bit 0 = full detail) | assets.js keeps LOD0 only |
| 9–13 | epoch variants I–V | parts.js `applyState` |
| 18 | selection volume | input.js picking box (dropped from rendering) |
| 19 | shadow model | dropped |
| 20 | night lights (buildings) / wound (animals) | parts.js |
| 21–24 | construction levels 0–3 | parts.js |
| 25, 26 | finished / intact | parts.js |
| 27, 28 | damage stage 1 / 2 | parts.js |

Animal and vehicle flags (FightingObj.usl VIS_FLAG_*): 5 party colour, 6 saddle, 7 helmet, 8 armour,
9 standard, 10 armour saddle, 11 misc, 16 "activated" (medic kit), 20–27 wounds by hit point ratio.

**Billboards** (camera-facing sprites: tree foliage, Dragon Clan paper lanterns, barrels and sacks on buildings, grass
around them) are written twice: as crossed quads (for file formats without sprites) and as raw sprite data in the
root's `extras.foliage` ({mesh, tex, uv, size, attr, pts, bones}). The atlas cell is `+81` (index) in a grid of
`2^(+83)` columns × `2^(+82)` rows (the old 8 × 8 reading cut images in half: "messy" trees), the material is `+76`
(index into the model's used materials), the drawn height is a quarter of the stored size. The remake draws foliage
with the world-wide FoliageField and the 2D parts of buildings as sprite meshes that follow the building's part
states (`engine/props.js modelSprites`).

The pathfinder table of each model (boxes) becomes the building footprint (`extras.pf`), links (`Bl_0..9` builder
spots, `Cr_1..4` cranes, `D_01..16` damage effects, `Spwn` spawn point, `we` turret, `Ride`/`Dri1` riders,
`Db_1/Db_2` wagon) are exported as empty nodes named `link_<name>`, animation sound events as `extras.sounds`.

## 2. Asset collection

`build_assets.py` picks the models the game needs – every gfx the tech tree can produce for the four tribes (all
levels, captains, weapon parts, projectiles), every part of the composites table (riders, turrets, build-ups,
drawbars, flags, harbour cranes ...), the rally point flags, the map props and `pipeline/roster.json` extras – strips
unused animations, points all textures to one folder and writes `assets/manifest.json` (per model: file, animation
source, walk speeds, walk set (`walk`), footprint, sound events, seamless walk loops).

## 3. Rules data

`build_data.py` writes:

* `techtree.json` – `StartTT` and `Filters` of the newest official tech tree (BoosterPack 1), unchanged. The game
  evaluates it at runtime (src/game/techtree.js).
* `gamedata.json` – script class and class gfx of every object (`classes/**/*.txt`), resource values
  (`settings/Resources.txt`), the hero list, help texts (`locale/<uk or the first language>/Texts/Help`), idle
  animation sets (`IdleAnims.txt`), the multiplayer start presets (`DefPresets.txt`), the composites table, pyramid
  sizes and level costs.

## 4. Sounds, interface, terrain

* `sounddb.py` parses the sound configuration syntax (with `name = 'base' {overrides}` inheritance);
  `build_sounds.py` writes the event table with the wav paths of the installation.
* `build_ai.py` (step `ai`, no dependencies) reads the computer player's tables out of the AI scripts and settings:
  behaviours, the difficulty levels 0-9 and their handicaps, build orders, attack plans, army tables, unit mixes,
  level caps ... → `ai.json` (keys: spec/ai.md §12). The script tables are code (`if tribe == ... AddRequest(...)`),
  so the step has a small reader for if / elseif chains with literal arguments instead of typed-in numbers; mods
  and other installations give their own values. Inputs: `Scripts/Ai`, `Scripts/Server/settings/Techtree/
  _AI_ObjectData.txt`, `Scripts/Server/misc/Player.usl`, `RequirementsMgr.usl`, `classes/task/Action.usl`,
  `classes/FightingObj/FightingObj.usl` (official mods). A data folder built before the step existed gets its
  `ai.json` on first request (`toolkit/remake.py`), and the game plays without the file on built-in fallbacks.
  Alone: `python -m remake.pipeline.build_ai <Data folder> <output folder>`.
* `build_forest.py` (step `forest`, no dependencies) writes what the game needs to grow the forest blocks of
  original maps (toolkit docs/MAP_FORMAT.md "Frst"): the engine's 32 tree layouts, copied out of the installation's
  `bin/PWServer.exe` (or `PWClient.exe`) by `pwexport/forest.py`, and the tree and undergrowth kinds of every
  setting from `Scripts/Server/classes/vegetation/Forest_<Setting>.txt` → `forest.json`. Like `ai.json` it is made
  on first request for older data folders; without it (or without the program file) maps keep only their placed
  trees. Alone: `python -m remake.pipeline.build_forest <Data folder> <output folder>`.
* `build_ui.py` converts the HUD textures and the icon atlas; `build_menu.py` the menu art; `build_cursors.py` the
  cursors (ICO containers with an AND mask).
* `build_terrain.py`: the 8 ground materials of every setting from `Texture/Scape/<Setting>/ScapeTexture<Q>.dat` +
  `.dds` atlases (see TERRAIN_NOTES.md), the grass clump atlas and the sea's normal map.

## 5. Code

```
cd remake
npm install          # once: esbuild + three.js
npm run build        # src/ -> game/game.js, index.src.html -> game/index.html
```

## Animation fixes applied at build or load time

* `anim_loops.py` (run by `build_assets.py`): clips made of a start, a loop and an end part (the GSF animation chunk
  marks the loop: flag 0x1 at `+12`, first and last loop frame as int16 at `+16`) get
  `manifest.models[m].loops = {clip: [t0, t1]}`. The game cuts them into `<clip>#s`, `#l`, `#e`
  (`engine/assets.js splitLoops`) and `game/anim.js` plays start → loop … → end: a unit accelerates into its walk
  cycle and settles when it stops, an animal lies down, rests and gets up again.
* Borrowed animations (`anims` = another model's clips, e.g. level 4/5 characters, seas_warrior) are retargeted at load
  time: position tracks are shifted by (own rest offset − source rest offset), so the mesh keeps its own bone lengths
  (`engine/assets.js retarget`).
* Wall pieces: meshes are tagged with their arm direction (`tagWallArms`), see `game/wallmap.js`.
