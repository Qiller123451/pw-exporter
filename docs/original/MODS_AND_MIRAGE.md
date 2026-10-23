# Mods, language packs and the MIRAGE mod

How the game loads add-ons, mods and language packs (`Data/Info/*.info`), and what was found about the mods that were
looked at, above all MIRAGE. How the toolkit uses this: [EXPORTER.md](../EXPORTER.md) "Mods",
[WORKSHOP.md](../WORKSHOP.md), [DATA_PIPELINE.md](../../remake/docs/DATA_PIPELINE.md) "Configurations".

## 1. Data/Info/*.info

Every add-on, mod and language pack is described by a text file in `Data/Info`. The game is started with a mod by
`-enable <id>` on the command line (the toolkit's notes give both `Paraworld.exe -enable <id>` and
`bin\PWClient.exe -enable <id>`). Lines:

| key | meaning |
|---|---|
| `id` | the name the mod is enabled by (`BaseLocale.info` has the id `BaseData`) |
| `requires` | the id it builds on; the chain ends at `BaseData` |
| `type` | `add-on`, `locale` or `utility` |
| `info`, `version` | display name and version |
| `priority` | a number (BaseData 100, LevelEd 110, BoosterPack1 / 3 30, MIRAGE / Wintermod / ReColor / UIfor4K 20, locales 15) |
| `tryfilereplace <pattern> <from> <to>` | for paths matching the pattern, look for the file in `<to>` instead of `<from>` |
| `joindirscan <pattern> <dir> <mod dir>` | folder listings of `<dir>` also list `<mod dir>` (maps, campaign maps, dialogue scenes, sequences) |

The files of the installation looked at:

| id | requires | type | version | replaces |
|---|---|---|---|---|
| BaseData (`BaseLocale.info`) | | | 1.0 | |
| BoosterPack1 | BaseData | add-on | 1.0 RC1 | `data/base/` → `data/BoosterPack1/`; joins its campaign and multiplayer maps, dialogue scenes, sequences |
| BoosterPack3 | BaseData | add-on | 1.0 RC1 | `data/base/` → `data/BoosterPack3/`; joins the same folders |
| LevelEd | BaseData | utility | 1.0 RC1 | `data/base/scripts/leveled` → `data/leveled/scripts`, `data/base/ui/leveleditor` → `data/leveled/ui` |
| Locale_UK / Locale_DE | BaseData | locale | 1.0 | `data/base/` → `data/locale/<xx>/`, `data/BoosterPack3/locale/<xx>/`, `data/MIRAGE/locale/<xx>/` |
| MIRAGE | BoosterPack3 | add-on | 2.6.7 | `data/base/` and `data/boosterpack3/` → `data/MIRAGE/`, `data/leveled/` → `data/MIRAGE/leveled/`; joins campaign and multiplayer maps |
| Wintermod | BoosterPack3 | locale ("for multiplayer compatibility") | 1.7 | `data/base/` → `data/Wintermod/` |
| ReColor | BoosterPack3 | locale ("for multiplayer compatibility") | 1.1 | `data/base/` → `data/ReColor/` |
| Paragames | BoosterPack3 | add-on | 0.1 Alpha | `data/base/` → `data/Paragames/` |
| UIfor4K | MIRAGE | locale | 1.0 | `data/base/` and `data/MIRAGE/` → `data/UIfor4K/` |

`Data/ursrel_data.txt` holds `Version: 1.05`.

Consequences:

* A file is taken from the **last** folder of the chain that has it. MIRAGE loads Base → BoosterPack3 → MIRAGE;
  **BoosterPack1 is not in that chain**. The "official game" with the newest tech tree is Base + BoosterPack1.
* Replacement is **per file**, not per folder: a mod that ships one file of a folder still gets the others from the
  folders before it (MIRAGE's `Texture/Scape/<Setting>` has two textures and no `ScapeTexture*.dat`). A file the mod
  changes is a full copy (MIRAGE ships its own tech tree); nothing is merged per entry.
* Texts: the game reads only the text folders its language pack lists, which is why the language packs name the
  BoosterPack3 and MIRAGE locale folders; a later folder's file replaces the same file of an earlier one, not single
  keys. A mod that brings new texts needs a line in `Locale_<XX>.info` (MIRAGE's installer adds its own and keeps a
  backup of the file).
* Texture sizes: a larger `.dds` on disk that `Texture/detailtable.txt` does not list (Wintermod ships `_(1024)`
  copies) is not loaded ([GSF_FORMAT.md](../GSF_FORMAT.md) "Textures").

### BoosterPack1

BoosterPack1 has no `.usl` scripts: all behaviour is Base's. It ships class and tech tree data: its `_TechTree.ttree`
is the newest official one, it changes `aje_buildings.txt` (the gfx of `aje_skull_protector`) and
`NewPointBuyCosts.txt` (the Resources block is the same). Units in the toolkit's catalog per configuration: Base 324,
BoosterPack1 339, BoosterPack3 339, MIRAGE 495.

## 2. MIRAGE

MIRAGE 2.6.7 (`Data/MIRAGE`, requires BoosterPack3) brings its own server scripts (`Data/MIRAGE/Scripts/Server`), tech
tree, models, textures and texts. Its special moves are specified in [moves_mirage.md](../../remake/docs/spec/moves_mirage.md),
its script bugs are listed in [MIRAGE_BUGS.md](../../remake/docs/MIRAGE_BUGS.md); its key layout notes are in
[formations.md](../../remake/docs/spec/formations.md) §B.8. Other findings:

**Archives written by MIRAGE's tools**

* `mirage_animals.gsf` (`atroxosaurud`, `saltasaurud`) and `seas_products.gsf` (`seas_mechanical_walker`) store empty
  slots of a model's chunk table as offset 0 instead of 0x80000000 (0 would point at the field itself: read it as
  none). The two animal models also have dangling chunk pointers.
* MIRAGE's `seas_laboratory` uses material records beyond the count in the materials header.
* 4 archives edited by MIRAGE's tools contain 2,960 bytes that belong to no field.

**Objects**

* The "CBR Titan" is the object `seas_rex`, script class `CSeasRex` (`mirage/Mirage.usl`), model `arena_tred`.
* MIRAGE links parts with offsets: `AddObjCustomized(object, "Ride", {3.04, -1.15, -1.21})` (offsets in the link's
  frame; not checked in the running game). Its machine gun nest (`seas_mg_nest`, `CSeasMgNest`) calls
  `SetTurret("seas_hq_machinegun_nest_top")` in `SetReady`, not in `OnInit`; so do the small cannon, the shore cannon and
  the great cannon (rotator + cannon).
* The warp gate `hs_warpgate` (`seasified_buildings.txt`) has no model in the files looked at.
* The `CBT-500` is built at the garage from epoch 3 (MIRAGE's `age_3` adds its visibility). MIRAGE builds the gunner in
  the laboratory (hidden variants of the build action).
* Wild animal looks: a wild animal class keeps its wild looks whoever owns it (MIRAGE `Animal.OnInit`: no saddle, no
  party colour, no riders); of the "misc" parts only those that belong to the beast show (`ShowAnmlMiscFlag`:
  stegosaurus, kentrosaurus, mammoth, macrolemys / macrolemyd).
* The wild boar's rage uses the filter `Hu/Upgrades/xenage/wild_boar_rage` at hit points ≤ 3/7.
* The flying trader's speed is capped at 4 (Base: 3).
* MIRAGE has its own `Forest_Savanna.txt` (other forest trees), its own `buffdecals.txt` (66 entries) and
  `UnitDecals` texture, its own object brushes ("objbrushes ... for landscape smoothing at building placement" in its
  ReadMe), 5 cursors and its own heroes' cards.
* MIRAGE's help texts contain `%/lvl1:` markup in the tooltip attributes.
* Mods such as MIRAGE offer the Hu ladder (`hu_ladder`) to players.

## 3. Other mods

* Wintermod and ReColor declare `type locale`, with the comment "type = locale for multiplayer compatibility".
* `UIfor4K` builds on MIRAGE and replaces interface files of Base and MIRAGE.
* ReColor, Paragames and UIfor4K were not looked at in detail.
