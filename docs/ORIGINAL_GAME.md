# ParaWorld (2006): what the toolkit knows about the original game

ParaWorld is a real-time strategy game by SEK and Sunflowers from 2006 (ParaWorld © SEK / Sunflowers / Ubisoft). Everything in this toolkit was built from the game's own files: the data folders, the
scripts, and the two programs `PWServer.exe` and `PWClient.exe`. This page is the entry point to that knowledge. Each
topic gives the key facts in a few lines and links to the documents with the full detail.

* Documents in [`docs/`](.) describe the file formats the toolkit reads and writes.
* Documents in [`docs/original/`](original/) hold findings about the original that had no document before (most of
  them read in the programs' machine code).
* Documents in [`remake/docs/spec/`](../remake/docs/spec/) are the game's rules, taken from the server scripts for the
  remake; other files in [`remake/docs/`](../remake/docs/) mix the original's behaviour with the remake's design.

Evidence marks used across the documents: **[C]** read in the program code, **[S]** read in the server's code, **[E]**
read in the code and checked by running the program's own function in an emulator, **[D]** seen in the data, **[I]**
inferred, **`?`** / **[?engine]** not proven (native code the scripts only call). Script references are
`file:line` of the shipped scripts.

## Contents

1. [Conventions](#1-conventions)
2. [Installation and data folders](#2-installation-and-data-folders)
3. [Mods, add-ons and language packs](#3-mods-add-ons-and-language-packs)
4. [File formats](#4-file-formats)
5. [The programs: engine behaviour](#5-the-programs-engine-behaviour)
6. [The scripts, the tech tree and how rules are applied](#6-the-scripts-the-tech-tree-and-how-rules-are-applied)
7. [Game rules](#7-game-rules)
8. [The computer player](#8-the-computer-player)
9. [Campaign, triggers and cutscenes](#9-campaign-triggers-and-cutscenes)
10. [Interface](#10-interface)
11. [Effects, sound and music](#11-effects-sound-and-music)
12. [SEK's tools](#12-seks-tools)
13. [MIRAGE](#13-mirage)
14. [Where the documents disagree](#14-where-the-documents-disagree)

## 1. Conventions

* **Map space** is left-handed, the Direct3D way: x east, **y south** (y 0 = the north edge), z up, metres. Read with y
  north, maps come out mirrored. Models (GSF) use the same handedness. In a right-handed Y-up viewer (glTF) a map point
  (x, y, z) is (x − w/2, z, y − h/2) and a model point (x, y, z) is (−x, z, −y).
* **Rotations**: the engine multiplies row vectors, so a stored quaternion is applied as its **conjugate**. The heading
  of an upright map object is −2·atan2(qz, qw). Bone and link quaternions likewise.
* **Time**: animations run at 25 frames a second; cutscene keys are 1/50 s; the AI thinks in ticks of 0.2 s; the day
  clock runs 144 game seconds per real second (a day = 10 minutes).
* **Water**: the scripts know one water height, `ScapeMgr.GetSeaLevel()` (16 m on most maps).
* Details: [MAP_FORMAT.md](MAP_FORMAT.md) (map space, rotations), [GSF_FORMAT.md](GSF_FORMAT.md) (model space).

## 2. Installation and data folders

* `bin/` holds the two programs and the graphics option table `GfxOptionPropDB.txt`; `Data/` holds `Base`,
  `BoosterPack1`, `BoosterPack3`, mods (`MIRAGE`, `Wintermod` ...), `locale/<lang>` and `Info`.
* `Data/Base`: `Audio`, `Cursors`, `DialogScenes`, `GSF`, `Maps`, `Scripts` (`Server`, `Ai`, `Game`, `gfx`), `Sequences`,
  `Texts`, `Texture`, `UI`, `Video`. Languages of the original: cz de fr hu it pl ru uk zh (`uk` = English).
* The official game with the newest rules is Base + BoosterPack1; BoosterPack1 has no scripts of its own.
* → [original/DATA_FILES.md](original/DATA_FILES.md) (folder map, text formats, icon atlas), [EXPORTER.md](EXPORTER.md)
  §1 (pointing the toolkit at an installation).

## 3. Mods, add-ons and language packs

* Every add-on, mod and language pack is a `Data/Info/<id>.info` file: `id`, `requires`, `type` (add-on, locale,
  utility), `priority`, `tryfilereplace` (look in the mod's folder first) and `joindirscan` (join folder listings). The
  game starts a mod with `-enable <id>` and loads the chain of `requires` down to `BaseData`.
* A file comes from the **last** folder of the chain that has it; files are replaced whole, never merged. MIRAGE loads
  Base → BoosterPack3 → MIRAGE (without BoosterPack1).
* The game reads only the text folders its language pack (`Locale_<XX>.info`) lists.
* → [original/MODS_AND_MIRAGE.md](original/MODS_AND_MIRAGE.md), [WORKSHOP.md](WORKSHOP.md) (what a mod must contain),
  [DATA_PIPELINE.md](../remake/docs/DATA_PIPELINE.md) "Configurations".

## 4. File formats

### Models: GSF archives (`Data/<mod>/GSF/*.gsf`)

* Little endian, every offset self-relative (0x80000000 = none). Header 1 = table of contents (models, animations, walk
  sets, sound events, frame-event table, animation groups); header 2 = model infos, materials, chunks.
* A model is a list of chunks: meshes (13-bit quantised positions, a 511-entry normal table, UV bytes / 255 with v
  bottom-up), skeletons (bones by CRC-32 of their name, depth-first order), links (attachment points `HndR`, `Ride`,
  `we` ...), billboard clouds (tree foliage, a quarter of the stored size high), particle emitters, cloth, light volumes,
  speed lines, collision volumes; animation chunks for bones, meshes, emitters, billboards and speed lines.
* Each chunk has 32 attribute bits: bits 0-4 the LOD mask, the rest per model type (construction and damage stages,
  epochs, night lights, saddles, wounds ...).
* Animations: rotations are deltas in bone space; constant tracks have one key; loop marks split a clip into start,
  loop and end; walk sets name the clips for each speed, stop, turn and transition.
* Materials: attr1 bits 0x1 alpha test, 0x2 blend, 0x4 additive / self-lit, 0x8 environment map, 0x10 normal map,
  0x1000 player colour.
* → [GSF_FORMAT.md](GSF_FORMAT.md) (main description), [original/GSF_DETAILS.md](original/GSF_DETAILS.md) (every field,
  chunk kinds, walk set slots, extended UV, gate parts, data statistics), [GSF_REMAKE_FINDINGS.md](../remake/docs/GSF_REMAKE_FINDINGS.md),
  [COMPOSITES.md](COMPOSITES.md) (how the scripts put riders, turrets, build-ups and wagons together), the Blender add-on
  `blender/README.md` and `blender/docs/MANUAL.md` (editing archives; SEK's normal computation).

### Textures (`Data/<mod>/Texture/**`)

* Materials name `.tga` files; the game loads `<name>_(<size>).dds` in a size that `Texture/detailtable.txt` lists for
  that texture (`All_Trex dxt5 64 128 256 512 [-dontchange]`), picked by the texture quality setting.
* → [GSF_FORMAT.md](GSF_FORMAT.md) "Textures".

### Maps (`.ula`)

* zlib blocks of 256 KiB with CRC-32s around a chunk tree (`SURF`): level info with a 200 × 200 preview and the
  editor's description tree, terrain (heights 1/128 m on a 2 m grid, 8 ground materials on a 4 m grid), the path
  finder's walk grids (`PaFi`), regions, forest blocks, placed objects (`UOF2`), landscape decoration, and the campaign
  chunks.
* Forest blocks: 32 m squares; the 31 tree and undergrowth spots come from 32 layouts built into the programs, picked by
  `(2317·y + 13·x) % 4992`; nothing grows at or below 16 m.
* Ships are stored at the sea bed and lifted to the water when the map loads; part objects (captains, turret tops) are
  stored as objects of their own.
* → [MAP_FORMAT.md](MAP_FORMAT.md), Kaitai descriptions [`paraworld_ula.ksy`](../pwexport/data/ksy/paraworld_ula.ksy)
  and [`paraworld_surf.ksy`](../pwexport/data/ksy/paraworld_surf.ksy), engine addresses of the forest code in
  [original/EXECUTABLES.md](original/EXECUTABLES.md).

### Ground tiles (`Texture/Scape/<Setting>/ScapeTexture<Q>.dat`)

* Per detail level Q = 1..5 an atlas of pre-blended 4 m tiles: one per combination of the four corner materials (4
  variants) plus single, 2 × 2 and 4 × 4 variants of each material on a 32 × 32 macro map. Inner tile = TileSize − 2 ×
  MipMapBorder (62-68 px at Q5, depending on the set).
* Buildings level and paint the ground with their object brush (`Texture/Scape/ObjBrush/<gfx>.tga`: alpha = levelling,
  colour = ground material bits R, G, B → 4, 2, 1).
* → [TERRAIN_NOTES.md](../remake/docs/TERRAIN_NOTES.md), [original/SEK_TOOLS_AND_GROUND_TILES.md](original/SEK_TOOLS_AND_GROUND_TILES.md).

### Campaign data (map chunks `Trgr`, `Ques`, `Rgns`, `LInf`; `.dlg` files)

* Triggers: the editor's full description (`TRDM`: conditions and actions with their non-default parameters, folders)
  plus the compiled triggers; 23 condition and 44 action types occur. Quests, regions (rectangles and ovals), players,
  diplomacy, start armies and level variables come from the other chunks; dialogue scenes are property tree files.
* → [CAMPAIGN_FORMAT.md](CAMPAIGN_FORMAT.md), statistics of all 17 missions: [original/CAMPAIGN_DATA.md](original/CAMPAIGN_DATA.md).

### Cutscenes (`.seq`) and speech (`.lsd`)

* `.seq` = gzip of the client's archive stream: the sequence record, the camera cuts, global items (fades, wide-screen
  bars, sounds, particles, Bink films, texts, camera shakes, day time), the region whose objects are hidden, the actors
  with their items (animations, walks, recorded paths, turns, lip sync, attributes, links) and the cameras with spline
  keys. Fully decoded (all 104 Base files to the last byte).
* `.lsd` = gzip: fps (25), then per frame the phoneme ids and weights; the `.mp3` of the same name is the voice.
* → [SEQUENCE_FORMAT.md](SEQUENCE_FORMAT.md), [original/CUTSCENE_PLAYER.md](original/CUTSCENE_PLAYER.md),
  [original/LIP_SYNC.md](original/LIP_SYNC.md).

### Tree text files: tech tree, class lists, settings

* One format for all: `name { key = 'value' }` lines. The tech tree `_TechTree.ttree` (3.7 MB) has `StartTT`
  (TimeFactor, Resources, MiscValues, Modifications, Actions, Objects, Items) and `Filters`; the class lists
  (`Scripts/Server/classes/**/*.txt`) give every object its script class and model.
* → [original/DATA_FILES.md](original/DATA_FILES.md) §2.

### Texts and help

* `.ltf` text tables (`"key";"text"`, UTF-8), `.lmf` master tables with maximum lengths and translator comments, SEML
  help files (`\{helpitem -name <key> <Title>}` with tooltip short / medium / long), quest SEML files.
* → [original/DATA_FILES.md](original/DATA_FILES.md) §3, [CAMPAIGN_FORMAT.md](CAMPAIGN_FORMAT.md) §8,
  [TOOLTIPS.md](../remake/docs/TOOLTIPS.md).

### Interface art

* `UI/All_def.txt` maps icon names to rectangles of the HUD textures (`file` / `source` lines, size levels 0-30);
  cards in `UI/hud/cards`, menu art in `UI/menue`, cursors `Cursors/*.cur`.
* → [original/DATA_FILES.md](original/DATA_FILES.md) §4, [DATA_PIPELINE.md](../remake/docs/DATA_PIPELINE.md) §4.

### Sounds, music, films

* Most `.wav` files are IMA ADPCM; sound events are tables in `Scripts/Server/init/*.txt` (with `name = 'base'
  {overrides}` inheritance); animation sounds are in the GSF's sound table (start frame, volume, pitch, distances).
  Music: `Audio/MusicMgr.txt`, `MusicTracks.txt`; ambience: `Audio/AtmoTemplates/<setting>.txt`.
* Films are Bink (`.bik`) in the language packs' `Video` folders; `Data/Base/Video` has only placeholders.
* → [§11](#11-effects-sound-and-music), [original/GSF_DETAILS.md](original/GSF_DETAILS.md) §3,
  [original/CAMPAIGN_DATA.md](original/CAMPAIGN_DATA.md) "Dialogue voices and films".

## 5. The programs: engine behaviour

`PWServer.exe` runs the simulation and the server and AI scripts; `PWClient.exe` draws, plays sounds, runs the
interface scripts and the cutscene player. Much of the game is native code the scripts only call; what was read there:

| topic | key facts | document |
|---|---|---|
| script binding, AI interface | USL classes bound through glue objects (name table 0xae7898; methods numbered alphabetically from 3); `CAiInterface` methods; `SetModuleBehavior` writes the wrong player slot when headquarter ≠ slot (a patch exists); VM class masks (0xDB / 0xD9) hide the binding self-test classes | [original/EXECUTABLES.md](original/EXECUTABLES.md) |
| walls (WallMap) | 8 m tiles with a 16-bit word each, height levels of 2 m, legal shapes and the corner rule, wall lines as the shortest path over placeable tiles (all or nothing), gates where GateFits allows, part names chosen by BuildName; identical code in both programs (client = server − 0x25b640) | [walls_engine.md](../remake/docs/spec/walls_engine.md), [walls.md](../remake/docs/spec/walls.md) |
| walking on walls, ladders, siege towers | walkways 7.8 m up on the walkable wall classes, +50 ranged protection on a wall, docking of siege objects | [walls_walk.md](../remake/docs/spec/walls_walk.md) |
| forest blocks | 32 layouts × 31 spots in both programs; trees removed at or below 16 m; 5 LODs, billboards far away | [MAP_FORMAT.md](MAP_FORMAT.md) "Frst", [original/EXECUTABLES.md](original/EXECUTABLES.md) |
| particles | source 3 is native: the emitter vector is a velocity (x = disk radius, z = speed), 29 parameters, flag bits | [particles.md](../remake/docs/spec/particles.md) |
| shadows | only buildings and decoration cast at the lower levels; trees only at "Very High", which draws LOD 4 - whose billboard crowns leave no shadow, so trunks cast shadows and crowns do not | [original/RENDERING.md](original/RENDERING.md) §1 |
| fog | linear fog from the sky colour's alpha, the view's tilt and the view depth (piecewise curves) | [original/RENDERING.md](original/RENDERING.md) §2 |
| day clock | `CTimeMgr`: 144 virtual seconds per second, day 6:00-18:00; buildings and ships switch their light parts every 20 s | [original/RENDERING.md](original/RENDERING.md) §3, [ARCHITECTURE.md](../remake/docs/ARCHITECTURE.md) "Day and night" |
| vertex decoding | UV = byte / 255 (not / 256); the edge-of-texel light cones of the Norse buildings depend on it | [original/RENDERING.md](original/RENDERING.md) §4 |
| unit decals | one buff decal (6 × 6 m) under a unit, the buff with the lowest index in `buffdecals.txt`; no icons above units | [original/RENDERING.md](original/RENDERING.md) §5 |
| minimap | native `CMiniMap`: the playable area at 4 m cells, a diamond turned by the default camera, colours from `minimap_colors.tga` | [MINIMAP.md](../remake/docs/MINIMAP.md) |
| ambience | `CAtmoSoundMgr`: 36 states per template (ground material × camera height × day) with beds and random events | [ARCHITECTURE.md](../remake/docs/ARCHITECTURE.md) "Ambience" |
| cutscene player | the world is paused during a sequence; actors bound by GUID or by class; walks computed by the server in straight lines; camera splines (Catmull-Rom, Hermite with per-key tangents), camera shake, day time; the 25 Hz item clock | [SEQUENCE_FORMAT.md](SEQUENCE_FORMAT.md), [original/CUTSCENE_PLAYER.md](original/CUTSCENE_PLAYER.md) |
| lip sync | phonemes drive one bone (the jaw) through layers of the `faceanim` clip; the shipped clip has 2 frames, so only IY / IH / h / y move the jaw (4.8°) | [original/LIP_SYNC.md](original/LIP_SYNC.md) |
| AI mine positions | `CAiMineMgr`: a 20 m lattice in the main water, on a ring ~30 m outside a landing beach with a ≤ 400 m land path to the start; five at a time from the nearest shore | [original/AI_MINE_MANAGER.md](original/AI_MINE_MANAGER.md) |
| path finder | 2 m cells; the editor's walk grid (`PaFi`); layers for land, water, amphibious, per player and islands | [MAP_FORMAT.md](MAP_FORMAT.md) "PaFi", [original/AI_MINE_MANAGER.md](original/AI_MINE_MANAGER.md) §2 |
| object brushes | `AdaptTerrain` levels the ground with the brush's alpha and writes the material bits of its colour | [TERRAIN_NOTES.md](../remake/docs/TERRAIN_NOTES.md) "Object brushes" |
| effect events | `_dusttrail` frame events do nothing in the client; `_material_effect` only plays a sound | [original/EFFECTS_AND_EVENTS.md](original/EFFECTS_AND_EVENTS.md) §1 |

## 6. The scripts, the tech tree and how rules are applied

* The rules are script (USL, "UrsRel Script") plus the tech tree. Server scripts: `Data/Base/Scripts/Server`
  (`ServerApp.usl`; `classes/FightingObj/FightingObj.usl`, `classes/character/character.usl`,
  `classes/buildings/Building.usl`, `classes/task/*.usl`, `classes/misc/*.usl`, `classes/animals/*.usl` ...); the AI:
  `Data/Base/Scripts/Ai`; the client: `Data/Base/Scripts/Game` (`Game.usl`, `UI/*.usl`, `controller/*.usl`,
  `misc/Effects.usl`). BoosterPack1 overrides no script; MIRAGE brings its own.
* The tech tree is evaluated at run time: a player's tree = `StartTT` + the filters that are switched on (finished
  upgrades, existing buildings, unit level filters `Filters/<Tribe>/Upgrades/<class>/Lvl<k>`, epochs, auras, items).
  Some objects have a tree of their own ("local" upgrades: the Aje farm modes, the big tent, the Dragon Clan explode
  upgrade).
* Stat modifiers: `/Modifications/<tribe>/<TYPE>/<stat>/<caste>_rel` and `_abs` (caste `tec`, `nat` or `res`;
  buildings always `tec`), applied as `value × rel + abs`.
* Objects are created by class name; the class lists map a class to its script class and model; level and upgrade
  filters swap models (`hu_large_tower` → `hu_large_tower_upgrade`).
* The game compiles the script files `Scripts/Server/Server.ini` lists; a mod with scripts ships its own copy of the
  list (MIRAGE adds six files).
* Turrets, build-ups, gunners and riders are put on by the unit's script class (`OnInit`: `SetBuildUp`, `AddObj` to a
  link, `AddAdditionalBuildUp` + `AddObjCaptain` + `SetWeaponClass` + `SetAdditionalWeapon` for a turret that shoots by
  itself; the rider's seat is `GetCaptainLink`). A weapon build-up turns its first linked object only;
  `DestroyBuildUp` takes them all down. → [COMPOSITES.md](COMPOSITES.md), [WORKSHOP.md](WORKSHOP.md) "Add-ons".
* → [GAMEPLAY_RULES.md](../remake/docs/GAMEPLAY_RULES.md), [combat.md](../remake/docs/spec/combat.md) §0,
  [ARCHITECTURE.md](../remake/docs/ARCHITECTURE.md) "Rules from the tech tree", [COMPOSITES.md](COMPOSITES.md),
  [original/DATA_FILES.md](original/DATA_FILES.md) §2.

## 7. Game rules

All taken from the server scripts and the BoosterPack1 tech tree; native parts are marked `[?engine]` in the specs.

| topic | key facts | document |
|---|---|---|
| combat | damage = dmg × buffs × (1 + attack bonus vs. the victim's type) × (1 − protection %), protection = armour − armour piercing (melee) or ranged armour − armour piercing (projectiles), 0-99 %; at least 1 hit point; a per-victim damage cache; splash falls off linearly from `damage` to `enddamage`; cone weapons; poison ticks every 3 s; knockback by size difference; stances aggressive / defensive / stand ground; skulls go to the last damager | [combat.md](../remake/docs/spec/combat.md) |
| economy | storage caps from storehouses (at least 300); loops per load = trunc(K × time factor × free space / capacity); trees 6 chops of 1 s; fields never run out; trade with skulls (100 skulls → 100 food / 67 wood / 50 stone) and trade carts | [economy.md](../remake/docs/spec/economy.md) |
| units | no experience: levels are bought with skulls (25 / 50 / 100 / 300 a step); pyramid of 25 / 15 / 8 / 3 / 1 per level; transports (class 1 land, 2 ships); heroes; wild animal temperament, nests, flocks | [units.md](../remake/docs/spec/units.md) |
| buildings | the cost is paid at placement; build time × (0.1 + 0.9 × 0.8^(N−1)) for N workers; damage stages at 50 % and 25 %; repair; Aje dismantling, Dragon Clan self-destruct; gates open / closed / auto; traps; the warp gate (owner wins 10 minutes after it is finished) | [buildings.md](../remake/docs/spec/buildings.md) |
| water and ships | one sea level; harbours, fishing, transports, mines, torpedo turtle, moving harbours (SEAS carrier, Aje floating harbour) | [naval.md](../remake/docs/spec/naval.md) |
| special moves | every special move of the tribes and the heroes (Norsemen 18, Dustriders 14, Dragon Clan 12, heroes 12; SEAS has none in the BoosterPack1 tech tree); the tech tree's `duration` is the cooldown | [moves.md](../remake/docs/spec/moves.md) |
| formations and keys | the old `Formation_1..3` actions are dead; the live system is the right-drag formation arrow; the complete default key table (`Keys.srf`) | [formations.md](../remake/docs/spec/formations.md) |
| point buy ("My Army") | 52 pyramid slots; card cost per unit, slot and tribe; resources bought with points (rates food 1.0, wood 1.5, stone 2.0 a unit, rounded up per resource total); presets | [pointbuy.md](../remake/docs/spec/pointbuy.md) |
| game types | Domination (King of the Hill) flags and timer, Defender | [ai_gametypes.md](../remake/docs/spec/ai_gametypes.md), [ui_groups7_9.md](../remake/docs/spec/ui_groups7_9.md) |
| summary | the rules in one page | [GAMEPLAY_RULES.md](../remake/docs/GAMEPLAY_RULES.md) |

Tech tree values noted on the way: the SEAS epochs cost 200 / 200 / 200 (60 s) for epoch 2, 500 of each (90 s) for
epoch 3, 800 of each (120 s) for epoch 4 and 1000 of each (180 s) for epoch 5. The SEAS Black Widow (`seas_wehrspinne`)
is a level 3 unit that needs epoch 4, is built at the garage for 400 food, 300 wood, 200 stone in 50 s, has 2100 hit
points at level 3 and 2400 at level 4; its weapon does 200 damage at 25-55 m with 10 m splash and −75 % against
characters, animals, vehicles and ships.

## 8. The computer player

* A brain per AI player with a control module and four work modules (economy, fight, area, defence); goals and tasks;
  one tick = 0.2 s. Personalities: Dodo, Giraffe, Schnecke, Turtle, FightOnly, Mikrobe (asleep). Difficulty 0-9 (think
  waits, gifts, attack strength, gather and build speed).
* In the campaign every computer slot starts as `ai_Mikrobe`; triggers wake it and steer it (`AIBV`, `AIFT`, `AIDA`,
  `AILU`, `AIAM`).
* Native parts: the planner, the influence maps, the allocation; the sea mine positions (`CAiMineMgr`).
* → [ai.md](../remake/docs/spec/ai.md) (the study of the original), [ai_gametypes.md](../remake/docs/spec/ai_gametypes.md),
  [ai_group6.md](../remake/docs/spec/ai_group6.md) (walls, outposts, trade, ships, chat, items),
  [original/AI_MINE_MANAGER.md](original/AI_MINE_MANAGER.md), [original/EXECUTABLES.md](original/EXECUTABLES.md)
  (`CAiInterface`), [COMPUTER_PLAYER.md](../remake/docs/COMPUTER_PLAYER.md) (the remake's port).

## 9. Campaign, triggers and cutscenes

* 17 missions (tutorial + 16): 3257 triggers, 4064 conditions, 7988 actions, 134 quests, 1056 regions; order and unlock
  state in `Scripts/Server/settings/Campaigns.txt`.
* A trigger fires when its conditions (an optional boolean expression) hold; flags: once, enabled, random action,
  folder switched off, actions by difficulty. Object queries select objects by region, type, owner, class, name or
  group.
* Three kinds of story scenes: dialogue scenes (voice + news ticker), in-engine sequences (the world pauses), films.
  A sequence without `snap_actors_back` leaves its actors where it ends (mission 1's spearmen).
* → [triggers.md](../remake/docs/spec/triggers.md) (the rules of the trigger system and every mission),
  [CAMPAIGN_FORMAT.md](CAMPAIGN_FORMAT.md), [original/CAMPAIGN_DATA.md](original/CAMPAIGN_DATA.md),
  [SEQUENCE_FORMAT.md](SEQUENCE_FORMAT.md), [original/CUTSCENE_PLAYER.md](original/CUTSCENE_PLAYER.md),
  [CAMPAIGN_RUNTIME.md](../remake/docs/CAMPAIGN_RUNTIME.md) and [MISSION_UI.md](../remake/docs/MISSION_UI.md) (the
  remake's runtime, with the original's behaviour cited).

## 10. Interface

* The layout of `IngameScreen.usl`: army pyramid on the left (Tab opens and closes it), info window and command bar at
  the bottom left, minimap bottom right with the tooltip window above it, group bar, menu, resources, quest, diplomacy
  and chat buttons along the top.
* Tooltips are help items of the encyclopedia; the quest log pauses the game; dialogue lines show in the news ticker.
* Key table: `Scripts/Game/options/Keys.srf`; G / Ctrl+G (group configurations) are bound but never registered.
* → [original/INTERFACE.md](original/INTERFACE.md), [formations.md](../remake/docs/spec/formations.md) §B,
  [MINIMAP.md](../remake/docs/MINIMAP.md), [TOOLTIPS.md](../remake/docs/TOOLTIPS.md),
  [MISSION_UI.md](../remake/docs/MISSION_UI.md), [ui_groups7_9.md](../remake/docs/spec/ui_groups7_9.md),
  [pointbuy.md](../remake/docs/spec/pointbuy.md), [ARCHITECTURE.md](../remake/docs/ARCHITECTURE.md) "Interface".

## 11. Effects, sound and music

* Combat and feedback effects are client script classes (`Scripts/Game/misc/Effects.usl`) that show models of
  `all_effects.gsf` for a time; they are started by projectile impacts, server events and the GSF frame-event table.
  Material effects (weapon × material) are sound only: every GFX of `MaterialEffects.txt` is empty.
* Camera shakes: `ShakeCameraTheGundlachStyle(duration, strength, fade-out %, pos[, range])`, 0.03 m per strength
  point.
* A felled tree becomes a `_Timber` model (the whole tree) that plays one of its fall clips, and a stump.
* Music: situations as switches (MainMenu < Background < BackgroundLeveled < Hometown < Trigger < Opening < Combat),
  playlists per level; the hometown theme's query names classes no object has, so only the Aje collector triggers it;
  nothing changes at the end of a game. Ambience: [§5](#5-the-programs-engine-behaviour).
* Speech: dialogue voices through `dialogsounds.txt`; cutscene voices next to their `.lsd`; subtitles from
  `sequences_<lang>.ltf`.
* → [GAME_EFFECTS.md](../remake/docs/GAME_EFFECTS.md), [original/EFFECTS_AND_EVENTS.md](original/EFFECTS_AND_EVENTS.md),
  [particles.md](../remake/docs/spec/particles.md), [ARCHITECTURE.md](../remake/docs/ARCHITECTURE.md) "Music",
  "Ambience".

## 12. SEK's tools

* SEK's pipeline: 3ds Max plug-ins tag and export models to SEK's GOD format, GODConvert bakes ambient occlusion, a
  resource builder computes the rest; ScapeTextureCalc builds the ground tile sets. The object class property files that
  named the attribute bits per model type are not shipped. The level editor's scripts are a utility mod
  (`Data/Info/LevelEd.info`).
* → [original/SEK_TOOLS_AND_GROUND_TILES.md](original/SEK_TOOLS_AND_GROUND_TILES.md).

## 13. MIRAGE

* MIRAGE 2.6.7 (on top of BoosterPack3) has its own scripts, tech tree, models and texts: new units and buildings and
  special moves for every tribe (the SEAS among them); its tools write archives with small format quirks (empty chunk
  slots as 0).
* → [original/MODS_AND_MIRAGE.md](original/MODS_AND_MIRAGE.md), [moves_mirage.md](../remake/docs/spec/moves_mirage.md),
  [MIRAGE_BUGS.md](../remake/docs/MIRAGE_BUGS.md) (bugs in its scripts with the intended fix).

## 14. Where the documents disagree

Points where sources differ, and what the better evidence says.

| subject | one source | the other | better evidence |
|---|---|---|---|
| UV decoding | the Kaitai description and older notes: u, v = byte / 256 | [GSF_FORMAT.md](GSF_FORMAT.md): byte / 255 | the client's code divides by 255 ([original/RENDERING.md](original/RENDERING.md) §4) |
| triangle winding and handedness | the Kaitai description: right-handed, counter-clockwise | [GSF_FORMAT.md](GSF_FORMAT.md), [MAP_FORMAT.md](MAP_FORMAT.md): left-handed, clockwise as Direct3D | the same triangles either way; read right-handed the models come out mirrored (GSF_FORMAT.md "Mesh chunks"), and only the left-handed map reading puts right-hand weapons in the right hand |
| LOD mask | [GSF_REMAKE_FINDINGS.md](../remake/docs/GSF_REMAKE_FINDINGS.md), [DATA_PIPELINE.md](../remake/docs/DATA_PIPELINE.md): raw bits 0-8 | [GSF_FORMAT.md](GSF_FORMAT.md), SEK's tools, the Blender add-on: bits 0-4 | bits 0-4 (bits 5-8 are type-specific: Head / Body / Legs, PartyCol, Saddle ...) |
| walk set slots | [GSF_FORMAT.md](GSF_FORMAT.md) "Corrections 2026-10-01": 4-12 stops, 19 / 20 accelerate, 23 / 24 brake, 28 / 29 extra (`farm_anim_1`, `growup`) | [original/GSF_DETAILS.md](original/GSF_DETAILS.md): 4-15 stops, 19-21 accelerate, 22-24 brake, 28 = walk transition index, 29 `growup` | the later full survey of the slots |
| chunk guid | [GSF_FORMAT.md](GSF_FORMAT.md): CRC-32 of the lower-case name | CRC-32 of the name as written | checked on 13,408 named emitters |
| `skeleton_index` | the Kaitai description: index among the model's skeletons | the Blender add-on: a chunk-table index (can point at a cloth chunk) | the chunk-table reading, checked on every archive |
| attr1 0x4 on meshes | [GSF_FORMAT.md](GSF_FORMAT.md): "not plain additive" (0x104 on 2000+ wall and building submeshes) | later: drawn additive (lights, lava, fire, foam on 325 models) - "the earlier note was wrong" | not settled for the walls and buildings with 0x104; the client's blend mode was not traced |
| extended UV | /1024 with two high bits in the extra byte (fits rivers and lava) | no division by 1024 was found near the client's mesh decoders | open |
| ground tile border | [TERRAIN_NOTES.md](../remake/docs/TERRAIN_NOTES.md): 70 px = 64 + 3 px border | the `.dat` files: border 1-4, inner tile 56-68 px | the data ([original/SEK_TOOLS_AND_GROUND_TILES.md](original/SEK_TOOLS_AND_GROUND_TILES.md)) |
| camera shake parameters | [GAME_EFFECTS.md](../remake/docs/GAME_EFFECTS.md): (strength, count?, distance?, pos[, radius?]) | `GameCameraModule.usl:695`: (duration, strength, fade-out %, pos[, max range]) | the script's signature |
| `_dusttrail` | [GAME_EFFECTS.md](../remake/docs/GAME_EFFECTS.md): an engine debris particle | the client returns without doing anything | the client code ([original/EFFECTS_AND_EVENTS.md](original/EFFECTS_AND_EVENTS.md)) |
| G / Ctrl+G | [formations.md](../remake/docs/spec/formations.md): save / load group configurations | never registered as commands | the scripts ([original/INTERFACE.md](original/INTERFACE.md)) |
| buff decal size | [ARCHITECTURE.md](../remake/docs/ARCHITECTURE.md): "a tile of Effects/UnitDecals, 3 m" | 6 × 6 m | not settled (3 m may be the half size) |
| subtitle count | [SEQUENCE_FORMAT.md](SEQUENCE_FORMAT.md): 245 of 249 non-music LipSync items | 245 of 248 | the 249th item has an empty path |
| `SeqRegion` | an early reading: a rectangle and a list of object GUIDs | [SEQUENCE_FORMAT.md](SEQUENCE_FORMAT.md): a region record; the GUID list belongs to the actors | the full decoder |
| starting a mod | `Paraworld.exe -enable <id>` | `bin\PWClient.exe -enable <id>` | not checked which program reads the switch |
| archive counts | 61 archives of Base + BoosterPack1 (Kaitai check) | 57 archives (Blender round trip) | different file sets were counted |
| shadow model bit | the shadow research calls it "flag 20" (mask 0x80000) | raw bit 19 | the same bit, counted from 1 |
| gate bits 14 / 16 | the models carry them on visible door leaves | `Building.usl:2344` comments them as "bit for collision volumes in open / closed state" | both: the bits select parts per state |
