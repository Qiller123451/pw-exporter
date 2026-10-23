# The installation and its text data files

Where the game keeps its data and how its text files are written. The binary formats have their own documents:
models [GSF_FORMAT.md](../GSF_FORMAT.md) / [GSF_DETAILS.md](GSF_DETAILS.md), maps [MAP_FORMAT.md](../MAP_FORMAT.md),
mission data [CAMPAIGN_FORMAT.md](../CAMPAIGN_FORMAT.md), cutscenes [SEQUENCE_FORMAT.md](../SEQUENCE_FORMAT.md), ground
tiles [TERRAIN_NOTES.md](../../remake/docs/TERRAIN_NOTES.md).

## 1. Folders

```
bin/                    PWClient.exe, PWServer.exe, GfxOptionPropDB.txt (graphics option levels), autoconfigrules.txt,
                        defaultsettings.txt
Data/Info/*.info        add-ons, mods, language packs (MODS_AND_MIRAGE.md)
Data/Base/              the base game:
  Audio/                Sound/ (00_npc, 01_work, 02_battle, 04_step, 05_ui, 07_speech_acks, 08_machines, 09_buildings,
                        11_misc ...), Music/*.mp3, MusicMgr.txt, MusicTracks.txt, AtmoTemplates/<setting>.txt,
                        soundeffects.txt, SeqSounds/ (cutscene and dialogue speech: Level_<n>/..., Mentor/, music/)
  Cursors/              *.cur (ICO containers with an AND mask)
  DialogScenes/         <campaign>/<mission>/[mentor/]ds_*.dlg
  GSF/                  *.gsf model archives, _gsfs.txt (the list of archives the game loads)
  Maps/                 Base/Multiplayer, Cpn_single_001 ... (*.ula)
  Scripts/              Server/ (server scripts, settings, class lists, init tables), Ai/, Game/ (client scripts),
                        gfx/particle.usl
  Sequences/            <campaign>/<mission>/*.seq, Setup.ini (lip sync setup)
  Texts/                *.lmf master text tables, _ltflist.txt, Help/
  Texture/              *.dds in sub-folders (Animals, Buildings, Character, Effects, Items, Land, Misc, Scape, Sequence,
                        Vegetation ...), detailtable.txt
  UI/                   All_def.txt (icon atlas), hud/**, menue/**
  Video/                *.bik (placeholders; the films are in the language packs)
Data/BoosterPack1/      GSF, Scripts (class lists and tech tree, no .usl), Texture
Data/locale/<lang>/     Texts/*_<lang>.ltf, Texts/Help/*.SEML, Texts/Quests/<level>.SEML, Video/, Sequences/, Audio/SeqSounds/
Data/ursrel_data.txt    "Version: 1.05"
```

The languages of the original are `cz de fr hu it pl ru uk zh` (`uk` = English). Most sound files are IMA ADPCM
`.wav`.

## 2. Property tree text files

Tech tree, class lists, settings, dialogue scenes, `Campaigns.txt`, the `*_attrib_def.txt` files and `Setup.ini` share
one text format: one item per line, `name { … }` a node, `key = 'value'` an attribute, `key = 'value' {` a node with a
value ([CAMPAIGN_FORMAT.md](../CAMPAIGN_FORMAT.md) §8.1). The toolkit's `workshop/ttree.py` reads and writes these files
byte for byte; `pwexport/tree.py` parses them.

### The tech tree (`Scripts/Server/settings/Techtree/_TechTree.ttree`, 3.7 MB)

```
Root
├─ StartTT
│  ├─ TimeFactor      per tribe the work time factors (FOOD, STON, FRUI, WOOD)
│  ├─ Resources       per tribe the order of the resource slots (food, wood, stone, iron)
│  ├─ MiscValues      per tribe Defence_On_Wall (50), Trader_Bonus (1.0)
│  ├─ Modifications   per tribe and object type the stat modifiers (<stat>/<tec|nat|res>_<rel|abs>)
│  ├─ Actions         build, produce, upgrade and move actions: costs, duration, required age, locations (the building
│  │                  and the command bar place), descriptions
│  ├─ Objects         per tribe the object data (hit points, speed, FOW, unit_size, caste ...) and the weapons
│  └─ Items
└─ Filters            Special, Items, Aje, AntiActions, Hu, Ninigi, SEAS, World: switched on by upgrades, levels, epochs,
                      buildings and auras; a filter changes values of the tree
```

The newest official tech tree is BoosterPack1's. `_AI_ObjectData.txt` next to it holds the computer player's object
data; `settings/Special/_Special.ttree` exists as well. How the rules read the tree: [combat.md](../../remake/docs/spec/combat.md)
§0, [economy.md](../../remake/docs/spec/economy.md).

### Class lists (`Scripts/Server/classes/`)

`classes.txt` lists one file per tribe and setting (`all.txt`, `aje.txt`, `hu.txt`, `ninigi.txt`, `seas.txt`,
`ashvalley.txt` ... `cave3.txt`, `speciallocations.txt`, `sequence.txt`, `misc/test_objects.txt`); each of those lists
the files of its groups (`Buildings = 'buildings/hu_buildings.txt'`, `Walls`, `Character`, `Misc`, `Products`, `Tools`,
`Resource`); an entry gives an object's script class and model:

```
hu_fireplace {
    classattribs { classname = 'CFireplace'  gfx = 'hu_fireplace' }
    objectattribs { tribe = 'Hu' }
}
```

The object name the scripts create (`CreateObj(<class>)`) can differ from its model name (`ninigi_cart_wagon` uses the
model `ninigi_cart`, `aje_floating_harbour_macrolemys` uses `macrolemys_water` ...; [COMPOSITES.md](../COMPOSITES.md)).

### Other settings

* `Scripts/Server/settings/`: `Campaigns.txt` (mission order and unlock state: `Campaign/<id> = '<file>' { enabled,
  PB_Available, Credits, MinCredits }`), `Resources.txt` (resource values of trees, carcasses ...), `NPCList.txt`
  (heroes), `FinishingMoves.txt`, `CharLevels.txt`, `CharXPGain.txt` (not used in combat), `CharAttributes.txt`,
  `PointBuyCosts.txt`, `NewPointBuyCosts.txt`, `ProfileVariables.txt`, `<Tribe>/Resources.txt`, `_Modifications.txt`
  (an unused template).
* `Scripts/Server/init/`: sound tables (`name = 'base' {overrides}` inheritance), `dialogsounds.txt`,
  `MaterialEffects.txt`, `wallclassconfig.txt` ...; `Scripts/Server/classes/attribs_def.txt`: default object
  attributes.
* `Scripts/Server/misc/condition_attrib_def.txt`, `action_attrib_def.txt`: the defaults of the trigger parameters.
* `Scripts/Server/classes/vegetation/Forest_<Setting>.txt`: the forest blocks' trees and undergrowth.

## 3. Texts

* `Data/locale/<lang>/Texts/<table>_<lang>.ltf`: UTF-8 with BOM, one entry per line `"key";"text"`; the first line is
  `"Suit Localization File";"<lang> UTF8"`. Tables: `main`, `dialogscenes`, `sequences`, `questlog`, `newsticker`,
  `questions`, `gameoverreasons`, `playernames`, `mapnames`, `ainames`.
* `Data/Base/Texts/<table>.lmf`: the master tables, `"Suit Localization Master File";;;` then `"key";"English
  text";<maximum length>;"comment for the translator"`. `_ltflist.txt` lists them.
* `Texts/Help/*.SEML` (encyclopedia and tooltips): `\{helpitem -name <key> <Title>}` with `\{img /bunit:<class>
  -ralign}`, `\{tooltipshort}` (attribute line `%/class:bldg/vschtr:/vsanml:...%`), `\{tooltipmedium}` (bullet lines,
  `\{br}` line breaks), `\{tooltiplong}`; files carry `\{comment $File: //UrsRel/Main/... $}` headers from SEK's version
  control. How the tooltips are built from them: [TOOLTIPS.md](../../remake/docs/TOOLTIPS.md).
* `Texts/Quests/<LevelName>.SEML`: quest descriptions in `\{section -name <quest>}` … `\{/section}`.

## 4. Textures and the icon atlas

* Models name `.tga` files; the game loads `<name>_(<size, 4 digits>).dds` in a size that `Texture/detailtable.txt`
  allows ([GSF_FORMAT.md](../GSF_FORMAT.md) "Textures").
* `UI/All_def.txt` maps icon names to rectangles of the HUD textures: `file <tga>` lines, each followed by
  `source <name> <level> <x> <y> <w> <h> <offset x> <offset y>` lines. The header comment documents the levels:

  | level | size | use |
  |---|---|---|
  | 0, 1, 3 | | level 1, 2, 4 characters in the pyramid |
  | 2 | 37 × 36 | level 3 characters in the pyramid, item icons in the info window, command buttons, age icons |
  | 4 | 64 × 61 | level 5 characters in the pyramid, unit icons in the info window |
  | 5 | 53 × 59 ? | |
  | 9 | 16 × 16 | stat icons in the info window |
  | 15 | 42 × 21 | minimap buttons (zoom in and out) |
  | 16 | 32 × 545 | pyramid buttons |
  | 20, 21, 22 | | action menu: menu buttons, action buttons, left spacer |
  | 23 | 148 × 20 | point buy points display |
  | 24 | 16 × 16 | resource icons of the tooltip window |
  | 25-29 | | statistics screen: player list slot (170 × 25) and its ends, table column heads (299 × 26) and row end line |
  | 30 | 20 × 20 | `info_player_winner` |

  The unit and building cards are `UI/hud/cards/*.tga`.
