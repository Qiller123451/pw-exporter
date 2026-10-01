# Data pipeline: from the ParaWorld installation to the remake's game data

Everything the remake shows or plays comes from the player's own game folder (`Data/Base`, `Data/BoosterPack1`).
**No game file is part of the toolkit or its repository.** The first time the remake is started from the launcher,
`remake/pipeline` converts what the game needs (about 5 minutes on a desktop PC, once); the result lives in the
toolkit's data folder (`%APPDATA%\ParaWorldToolkit\remake\<installation id>\`, Linux/macOS
`~/.config/paraworld-toolkit/remake/...`).

**Later builds only redo what is out of date.** `build.json` records a fingerprint for every step; a step runs again
only when

* the game files it reads changed (names, sizes and times of the folders in the diagram below),
* its code changed: the step's module and every toolkit module it imports (`pwexport/gsf.py` for the models,
  `pwexport/tree.py` for the rules ...), found by following the imports, plus the data files they name
  (`roster.json`, `composites.json`) – see `pipeline/stamps.py`,
* a step it builds on ran again (assets after rules or models, sounds after assets), or its output was deleted.

The model conversion keeps its output in `_conv` (`_conv/stamps.json`) and converts only the archives that changed;
a change to the textures or to the converter converts all of them. `_conv` can be deleted to save disk space (the
next build that needs it converts everything again). A code change needs no version bump; `pipeline.ASSET_VERSION`
is only for forcing a full rebuild on every installation. The launcher's ↻ button and `--force` build everything.

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
Data/*/GSF/*.gsf                                 ──► models   convert_models.py  ──► _conv/<archive>/*.glb (kept)
                                                 ──► assets   build_assets.py    ──► assets/models, assets/tex, manifest.json
UI/hud/**, UI/All_def.txt                        ──► ui       build_ui.py        ──► assets/ui/*.png, atlas.json
UI/menue/**                                      ──► menu     build_menu.py      ──► assets/ui/menu/*
Cursors/*.cur                                    ──► cursors  build_cursors.py   ──► assets/ui/cur/*.png, hotspots.json
Texture/Scape/<Setting>/**                       ──► terrain  build_terrain.py   ──► assets/terrain/**
Scripts/Server/init/*.txt                        ──► sounds   build_sounds.py    ──► assets/sounds.json
Audio/Sound/**/*.wav, Audio/Music/*.mp3, Maps/** ──► read straight from the game folder by the server
```

Run it by hand (all steps, or some):

```
python -m remake.pipeline "C:\Games\ParaWorld" "C:\temp\remake-data"            # what is out of date
python -m remake.pipeline "C:\Games\ParaWorld" "C:\temp\remake-data" --force    # everything
python -m remake.pipeline "C:\Games\ParaWorld" "C:\temp\remake-data" rules assets # exactly these steps
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

* `anim_loops.py` (run by `build_assets.py`): walk clips made as "start + loop + stop" (the stand pose at both ends,
  e.g. the SEAS Black widow, many dinosaurs) get `manifest.models[m].loops = {clip: [t0, t1]}`; the game plays only
  the loop (`engine/assets.js loopPart`).
* Borrowed animations (`anims` = another model's clips, e.g. level 4/5 characters, seas_warrior) are retargeted at load
  time: position tracks are shifted by (own rest offset − source rest offset), so the mesh keeps its own bone lengths
  (`engine/assets.js retarget`).
* Wall pieces: meshes are tagged with their arm direction (`tagWallArms`), see `game/wallmap.js`.
