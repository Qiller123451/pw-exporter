# ParaWorld campaign data: mission scripting in the map files

What a single-player mission consists of, where it is stored, and the JSON that `pwexport.campaign` makes of it.
The container (`.ula`, chunk trees, strings) is described in [MAP_FORMAT.md](MAP_FORMAT.md); this file covers the
chunks that only matter for missions. What the triggers *do* is specified in
[`remake/docs/spec/triggers.md`](../remake/docs/spec/triggers.md).

Reader: `pwexport/triggers.py` (Trgr, Ques, Rgns, property trees), `pwexport/ula.py` (level info, objects),
`pwexport/campaign.py` (everything joined, texts resolved, references checked).

```
python -m pwexport.campaign <map.ula> [--install <game folder>] [--lang uk] [--json out.json] [--text out.txt] [--compact]
python -m pwexport.campaign --install <game folder> --all <dir>      # every mission: single_NN.json + .txt
```

Checked against the 17 maps of the original campaign (`Data/Base/Maps/Cpn_single_001/single_01 … 16.ula`, the
tutorial `Data/Base/Maps/Base/Cpn_single_001/single_00.ula`): 3257 triggers, 4064 conditions, 7988 actions, 134
quests, 1056 regions parse without a byte left over.

## 1. Where things are

| what | where |
|---|---|
| triggers | map chunk `Trgr` (§2) |
| quests | map chunk `Ques` (§3) |
| regions | map chunk `Rgns` (§4) |
| players, diplomacy, start army, level variables, day time | map chunk `LInf`, description tree (§5) |
| objects with GUID, handle, visibility; groups; question marks | map chunk `Objs` (§6) |
| (nothing) | map chunks `DlgS`, `AI` (§7) |
| dialogue scenes | `Data/Base/DialogScenes/<path>.dlg` (§8) |
| cutscenes | `Data/Base/Sequences/<path>.seq` (§9) |
| all texts | `Data/locale/<lang>/Texts/*.ltf`, `Texts/Quests/<level>.seml` (§8) |
| order and unlock state of the missions | `Data/Base/Scripts/Server/settings/Campaigns.txt` (property tree: `Campaign/<id> = '<file>' { enabled, PB_Available, Credits, MinCredits }`) |
| parameter defaults of conditions / actions | `Data/Base/Scripts/Server/misc/condition_attrib_def.txt`, `action_attrib_def.txt` (§2.4) |

Conventions: little endian. `str` = `u32 length` (including the closing 0) + bytes (cp1252, newer texts UTF-8).
`guid` = 16 bytes. In every *parameter string* a GUID is written as 32 letters `a`..`p`, one letter per nibble,
low nibble first (byte `0xad` → `nk`); the exporter uses that form everywhere. A *handle* = `u16 index, u16
serial`.

## 2. `Trgr` - triggers

`u32 size` + a chunk tree `SURF { TRDM, TRIG × n }`.

* `TRDM` = the level editor's description of **all** triggers (complete, with comments and folders). This is
  what the exporter reads.
* `TRIG` = one compiled trigger each, the form the game loads. Only triggers that are not switched off have one
  (2945 of 3257). Its content repeats the description in binary; the exporter only takes what the description
  lacks (§2.3).

### 2.1 TRDM

```
u32 count
count × trigger:
    guid
    u32  flags
    str  name
    str  description           the designer's comment
    str  expression            "1 && (2 || 3)", condition numbers 1-based; mostly empty
    u32  nConditions, nConditions × node
    u32  nActions,    nActions    × node
folder tree (one root folder)

node:
    char[4] type               "TIME", "REGN", "SPGR" ... (23 condition types, 44 action types occur)
    str  note                  comment
    str  name                  label shown in the editor
    u32  n, n × { str key, str value }      the parameters; only those that differ from the default

folder:
    u16  0x00CD
    str  name
    u32  n, n × guid           triggers directly in this folder
    u32  nChildren, nChildren × folder
    u16  0x00DC
```

Flags:

| bit | name in the JSON | meaning |
|---|---|---|
| `0x00000002` | – | set on every trigger (unknown) |
| `0x00000004` | `once` | disabled when it fires |
| `0x00000008` | `enabled` | enabled at level start |
| `0x00000010` | `disabled` | switched off in the editor; exactly the triggers without a compiled `TRIG` (312) |
| `0x00000020` | `random` | one random action per firing |
| `0x00000040` | `node_off` | its folder is inactive at level start (78; all triggers of such a folder carry it) |
| `0x00000080` | `by_difficulty` | actions are filtered by their difficulty (all 127 live triggers with a non-default action difficulty have it) |
| `0x00000200` | – | only in the compiled `BASE`: "compiled" |
| `0x80000000` | – | always set |

All parameter values are strings: numbers (`"12.5"`), vectors (`"[x y z]"`, sometimes `"x, y, z"` or
`"x y z"`), GUIDs, `|`-separated lists (`"CHTR|ANML|"`), newline-separated GUID lists, tab-separated texts. The
exporter keeps them unchanged in `p`.

### 2.2 Folder paths

The folder tree gives each trigger its path (`Root/G: Gameplay/Ge: SQ03 - 3rd Tribute`; one empty trigger of
mission 7 is in no folder). The `ACND` action
addresses folders by this path plus a trailing `/`.

### 2.3 Compiled TRIG

```
TRIG   data: u32 index
├─ BASE   guid, u32 flags (= description flags | 0x200), str expression, str name
├─ COND   data: str class name ("CConditionTime" ...)
│  ├─ BASE     str name, ...
│  └─ <type>   the condition's own Save() data
└─ ACTN   data: str class name
   ├─ BASE     (version 2) str name, u32 difficulty (0 easy, 1 medium, 2 hard), ...
   └─ <type>   the action's own Save() data
```

The type chunk's tag is the node type, except for a few classes: `ACDO`→`OBDO`, `SQNZ`→`SEQU`, `RSRC`→`RES_`,
`WYPT`→`WAYP`, `OBAP`→`OAPR`, `TECH`→`TTRE`, `OCPY`→`OCUP`, `DELO`→`<Fou`. The per-type payloads are **not
decoded**: they are the parameters again, with the defaults filled in (written by the script classes' `Save`
procedures in `ConditionFactory.usl` / `ActionFactory.usl`, from which their layout could be derived).
The exporter uses the compiled form for three things: `compiled: true/false` per trigger, its `index`, and the
`difficulty` of each action (the description omits it when it is the default).

### 2.4 Parameter defaults

The editor stores only parameters that differ from their default; the game compiles the triggers with the
defaults of the two `*_attrib_def.txt` files (property trees, §8.1: per node type the attributes with `type` and
`default`; a type nested inside another inherits its attributes, e.g. every condition with an object query
inherits `OBJC`). Checked: 957 of 958 compiled `TIME` conditions carry `reset = 1`, the default, although the
description has no `reset`. `triggers.attrib_defaults(text)` reads the files; the JSON carries them as
`defaults`.

## 3. `Ques` - quests

`u32 size` + `SURF { QMGR }`:

```
u32 count
count × { u32 0, guid, u32 n, n × { u32 0, u32 0, str key, str value } }
```

Keys: `name` (`L11MQ01`), `group`, `mainquest` (1 / 0), `visible`, `accomplished`, `unaccomplishable` (start
state, all 0 in the campaign), `boni_easy`, `boni_middle`, `boni_hard`, `headline`, `description`,
`additionalInfo` (text keys or text), `image_path`, `image_selected`.

## 4. `Rgns` - regions

Not a chunk tree:

```
u32 version (4)
u32 nHandles, nHandles × handle          the region manager's handle table
u32 count
count × region:
    u32  flags                 0x43 normal; 0xc3 / 0x53 / 0xd3 occur (nest areas ...) - meaning unknown
    guid
    str  name
    u32  colour                editor display colour
    u32  nShapes
    nShapes × { u32 kind, u32 -1, f32 x, y, z, f32 w, h, f32 d }
    str  note
folder tree:  folder = { str name, guid, u32 n, n × guid (regions), u32 nChildren, children }
```

A shape: `kind & 0xff` = 1 rectangle, 2 oval (the ellipse inscribed in the box). `x, y` is the **minimum
corner**, `w, h` the full size, in map metres (checked: a nest's safe area created with radius 10 around the nest
is stored as position − 10, size 20). `z` / `d` = height range (not used by the scripts). `kind >> 24` holds
flags: `0xe0` on normal shapes; `0xc0`, `0x80`, `0x60` occur - bit `0x20` is exported as `enabled` (a guess that
fits the `ARGN` action enabling exactly the shapes that lack it). A region with several shapes is their union.
The world region (`UniqueWorldRegion` in trigger parameters) is not stored.

The folder tree lists more GUIDs than there are regions (mission 16: 176 entries, 5 regions): the rest belong to
regions that objects create when the level runs (nest areas …) and that are not stored here. The JSON's
`region_tree` keeps only stored regions.

`triggers.in_shape(shape, x, y)` is the containment test.

## 5. `LInf` - level info (mission part)

Layout: [MAP_FORMAT.md](MAP_FORMAT.md). The description tree (`node = u32 children, str name, str value`) holds
the mission setup; `Map.info_tree` returns it nested:

```
Root
├─ Base              LevelName, Description (text key), Author, MaxPlayers, MapType (singleplayer), StartTime "h:m",
│                    DefaultCamera (radians), Tutorial, material_atmos, BlackStart, DimGate_Available, Difficulty
├─ PlayerSettings
│  └─ Player_<n>
│     ├─ PlayerName (text key), SPCredits
│     ├─ Restrictions
│     │  ├─ Base         DefTeam, DefPlayer (human | ai_Mikrobe), DefColor, Tribes "Hu:" (+ child Default),
│     │  │               AI_Difficulty_Easy / _Medium / _Hard, GfxPrefix, ShowStatistics
│     │  ├─ Chars        Level1 … Level5 { Min, Max, MaxStart }, Population { Max }, Heroes, Infantry, Cavalry
│     │  ├─ Resources    food, stone, wood, iron (a tribe sub-node overrides)
│     │  └─ TTDef        children = tech tree filter paths to enable at start
│     ├─ Diplomacy       "10001111": character j = relation towards player j (0 hostile, 1 neutral, 2 friendly)
│     ├─ PointBuyPreset  <slot> = class | Nature | Technics | Resource; BlockedSlots; <Tribe> { <slot> = class }
│     ├─ StartLocations  children named by the GUID of a SLOC object
│     └─ IncludeBuildings
├─ Variables         <name> { type, value }           the level variables
├─ AIOptions         walls, markplace_outpost, harbour, warpgate, hunt_animals, watermap
├─ WeatherData       Name, Loop, Tracks
├─ Items             Pool, MaxItems
└─ ClientSettings    0 / Camera { Eye, LookAt }
```

Point-buy slots are the cells of the army pyramid: slot 0-24 = level 1, 25-39 = level 2, 40-47 = level 3, 48-50 =
level 4, 51 = level 5 (`StartLocation.usl:482-575`).

## 6. `Objs` - what missions need from the object records

The `base` record of an object (MAP_FORMAT.md) continues after the name:

```
u8[16]  guid
handle  (u16 index, u16 serial)      its slot in the handle manager; groups list their members by handle
u8      visible                      0xff / 0
u32     flags2
17 × { guid, u8 kind }               kind 1 = a linked object (a wall piece and its tower, a transporter and its build-ups)
```

and `u32 flags` sits at bytes 4..8 of the record (before the owner). Decoded by correlation only: bit 0
selectable, bit 1 hitable, bit 31 set on objects the designers protect (exported as `invulnerable`; the script's
real flag `m_bLDInvulnerable` lives in the object's `FOba` data chunk, which is not decoded).

Object data chunks used:

* `GROU` (group objects, type `GROU`): `u32 n`, `n × handle` = the members.
* `qmrk` (question marks, type `QMRK`): `u32 state` (0 invisible, 1 red, 2 green, 3 yellow question mark, 4
  yellow exclamation mark; all 0 in the campaign).
* `gobj/attr`: key / values, among them `level`, `hitpoints`, `maxhitpoints`, and for start locations (`SLOC`)
  `ignore_pointbuy`, `include_building`, `is_sequence`, `seq_filename`.

Other data chunks (`FOba`, `Bldg`, `ChrS`, `Hero`, `TOba`, `nest`, …) are the saved state of the script
classes and are not decoded.

## 7. `DlgS`, `AI`

Present in every campaign map and empty: `DlgS` is 128 bytes (`u32 0` and what looks like stale memory), `AI` is
`u32 size` + an `AIMM` header and stale bytes. Dialogue scenes are files (§8), the computer players are driven by
the `AI…` trigger actions.

## 8. Dialogue scenes and texts

### 8.1 `.dlg` - property tree text

The game's property tree format, one item per line (also used by `Campaigns.txt` and the `*_attrib_def.txt`):

```
Root {
	Actors {
		Cole {
			class = 'Cole_s0'
			owner = '0'
			def_icon = 'cole'
			generate_name = 'false'
		}
		Warrior { class = 'hu_warrior'  owner = '3'  region = 'dilo_fight_area'  def_icon = 'hu_warrior' ... }
	}
	Frames {
		Frame_0 {
			actor = 'Cole'
			audio = 'ds_1020_Cole_01'
		}
	}
	Soundpath = ''
}
```

`name { … }` is a node, `key = 'value'` an attribute, `key = 'value' {` a node with a value. A few shipped files
have a stray quote in a key (`stina' = ''`); `triggers.propdb` reads line by line to survive that.

An actor names the object that speaks (by `class`, optional `owner`, `region`, `tribe`, `caste`, `level`); a
frame is one spoken line. The text of a frame is the text-table entry `_<scene>_<FrameName>`
(`_ds_1020_Frame_0`), the speaker's name `_ds_ACTOR_<actor>` (`Game/UI/DialogScene.usl:382-390`). Mentor hints
(`…/mentor/ds_L<nn>B<nn>.dlg`) all have the single actor `Mentor` (class `babbage_s0`).

### 8.2 Text tables

* `Data/locale/<lang>/Texts/*.ltf`: lines `"key";"text"` (UTF-8 with BOM). Relevant tables: `dialogscenes`,
  `sequences`, `questlog`, `newsticker`, `questions` (question mark tooltips), `gameoverreasons`, `playernames`,
  `mapnames`, `ainames`.
* `Texts/Quests/<LevelName>.seml`: quest descriptions; `\{section -name <quest>}` … `\{/section}`, `\{p}` =
  paragraph.
* `Data/Base/Texts/*.lmf` are the master tables (key; English text; maximum length; comment) - the exporter's
  last resort.

Languages present in the original: `cz de fr hu it pl ru uk zh` (`uk` = English).

## 9. `.seq` - sequences (partly decoded)

gzip-compressed binary:

```
u32 0, u32 version (20, one file 21), u32 1, u8 0
f64 timeline length (s)        the editor's ruler: 25, 50, 250 …
f64 start marker (s)           0, or the first frame to play
f64 end marker (s)             where the sequence ends = its real length (for a film: the video's length)
u32 1 …
tracks: u32 kind, u32 1, guid, f32 start, f32 length, str name, …
        kinds seen: 6 camera, 7 particle / event, 0x0b "Bink" (a film: str file name `hs_NNNN.bik`), 0x0c text,
        0x0d sound (str path)
whole actor objects (the same records as in a map), a region record "SeqRegion"
```

Decoded and exported: the three times, the film names (`*.bik`), speech and sound file names. **Not decoded**:
the tracks' key frames (camera paths, actor movements, animations) and the embedded objects - a sequence cannot
be replayed from the export. The subtitle lines are not in the file: they are the `sequences` text-table
entries `_seq_<number>_<speaker>_<nn>` in table order (number = the digits of the file name, plus those of the
films it shows).

9 sequences that triggers name do not exist in the game (`sc_0112`, `sc_0217`, `sc_1070`, `sc_1072`, `ns_2040`,
`ms_4020`, `sc_7031`, `sc_7037`, `sc_7053`).

## 10. The JSON document (`pw-campaign/1`)

`campaign.campaign(map_path, install=None, lang='uk')` returns a dict; the CLI writes it as JSON. Positions are
map metres (x east, y north, z up), angles radians, GUIDs the 32-letter form. Top level:

| key | content |
|---|---|
| `schema` | `"pw-campaign/1"` |
| `lang` | language of the resolved texts |
| `map` | the mission's frame (10.1) |
| `players` | 8 slots (10.2) |
| `objects` | every placed object except groups and question marks (10.3) |
| `groups`, `question_marks` | (10.3) |
| `regions`, `region_tree` | (10.4) |
| `quests` | (10.5) |
| `variables` | `{name: {type, value}}` level variables at start |
| `triggers`, `trigger_tree` | (10.6) |
| `defaults` | `{conditions: {type: {param: default}}, actions: {…}}` - apply to every node before use |
| `texts` | `{key: text}` every text key the mission refers to (quest texts, game-over reasons, info bar and ticker lines, tooltips, player names) |
| `dialogs`, `sequences` | by path as written in the trigger parameter (10.7) |
| `refs` | `{guid: [kind, name]}` for every GUID a trigger parameter contains: kind `trigger`, `quest`, `region`, or the object type (`CHTR`, `BLDG`, `GROU`, `QMRK` …); a third element `"by name"` = the GUID is stale and the object was found by its name; kind `missing` = no such object (the node finds nothing) |
| `counts` | `objects, triggers, compiled_triggers, conditions, actions, quests, regions, groups, question_marks` |
| `warnings` | everything that did not resolve, as sentences |

### 10.1 `map`

`name` (level name, `Single 11`), `file`, `title`, `description` (resolved), `description_key`, `author`,
`setting` (terrain set), `w`, `h` (metres), `water` (sea level), `game_type`, `map_type`, `tutorial`,
`max_players`, `difficulty`, `start_time {raw, hour, minute}`, `default_camera` (radians), `camera {eye,
look_at}`, `black_start`, `dim_gate`, `atmos`, `credits`, `weather {name, loop, tracks[]}`, `items {max,
pool[]}`, `ai_options {walls, markplace_outpost, harbour, warpgate, hunt_animals, watermap}`.

### 10.2 `players[i]`

| field | meaning |
|---|---|
| `id` | slot 0-7; 0 is the human player in every mission |
| `present` | the slot is used |
| `type`, `control` | `human` / `ai`; `control` = the raw value (`human`, `ai_Mikrobe`) |
| `tribe`, `tribes` | `Hu`, `Aje`, `Ninigi`, `SEAS` (empty = none) |
| `name`, `name_key` | display name |
| `team`, `color` | |
| `gfx_prefix` | model variant prefix (`pirates` …) |
| `resources {food, wood, stone, iron}` | start resources; `-1` = from the army-building screen |
| `credits` | `SPCredits` |
| `diplomacy[j]`, `diplomacy_raw` | relation towards player j: 0 hostile, 1 neutral, 2 friendly |
| `population_limit`, `unit_limits[5] {min, max, max_start}` | per pyramid level (null = standard) |
| `ai_difficulty {easy, medium, hard}` | AI strength per campaign difficulty |
| `tech_filters[]` | tech tree filter paths enabled at start |
| `allowed_units {infantry, cavalry}`, `heroes` | per tribe: what the army-building screen offers |
| `point_buy {preset, tribes, blocked_slots}` | raw army preset (slot → class) |
| `start_army[] {slot, level, class, preset}` | the preset resolved for the player's tribe; `level` 0-based |
| `include_buildings` | create the tribe's main building at the start location |
| `start_location {guid, name, index, x, y, z, rot, ignore_pointbuy, include_building, is_sequence, seq_filename}` | the `SLOC` object used (null if none) |
| `start_locations[]` | GUIDs listed in the level info |

### 10.3 `objects[]`, `groups[]`, `question_marks[]`

Object: `index` (position in the map's object list), `guid`, `name` (unique, `<class>_<n>`), `class`, `type`
(4 letters), `owner` (null = nobody), `x, y, z`, `rot` (heading, counter-clockwise from east), `q` (quaternion as
stored), `level` (0-based), `hp`, `max_hp` (if stored), `visible`, `flags`, `selectable`, `hitable`,
`invulnerable` (§6: by correlation), `gfx` (model name), `handle [index, serial]`, `attr` (the object's
attribute table, raw).

Group: `guid`, `name`, `index`, `x, y, z` (editor icon), `members[]` (GUIDs). Question mark: `guid`, `name`,
`index`, `x, y, z`, `state` (`STATE_INVISIBLE` …).

### 10.4 `regions[]`

`guid`, `name`, `flags`, `color`, `note`, `bbox [x0, y0, x1, y1]`, `shapes[] {type: rect | oval, enabled, flags,
x, y, z, w, h}` (`x, y` = minimum corner, `w, h` = size; an oval is the ellipse inscribed in that box). `region_tree` = `{name, guid, regions[guid], folders[]}`.

### 10.5 `quests[]`

`guid`, `name`, `group`, `main`, `bonus {easy, medium, hard}`, `visible`, `accomplished`, `unaccomplishable`,
`headline`, `description`, `info`, `group_title` (resolved texts), `key_headline`, `key_description`,
`key_group`, `attr` (raw key / values).

### 10.6 `triggers[]`

| field | meaning |
|---|---|
| `guid`, `name`, `description` | |
| `folder` | path in the editor's folder tree |
| `compiled` | false = switched off in the editor: does not exist at run time |
| `index` | number of the compiled trigger (null if not compiled) |
| `flags {once, enabled, disabled, random, node_off, by_difficulty, raw}` | §2.1 |
| `expression` | boolean expression over the condition numbers (1-based); empty = all |
| `conditions[] {type, note, name, p}` | `p` = the stored parameters (strings) |
| `actions[] {type, note, name, difficulty, p}` | `difficulty` 0 / 1 / 2 from the compiled trigger (null if not compiled) |

`trigger_tree` = `{name, triggers[guid], folders[]}`.

### 10.7 `dialogs{}`, `sequences{}`

Dialogue: `path`, `id`, `file` (the `.dlg` was found), `mentor`, `sound_path`, `actors {name: {class, owner, icon,
generate_name, name_key, display, [region, tribe, caste, level, name]}}`, `frames[] {name, actor, speaker, key,
text, audio}`. Without the file the frames come from the text table alone (no speakers, except mentor scenes).

Sequence: `path`, `id`, `file`, `duration` (seconds played = end − start marker), `timeline`, `start`, `end`,
`ids[]` (text numbers), `lines[] {key, speaker, text}`, `videos[]`, `speech[]`, `sounds[]`. Without the file:
`duration` null, lines from the text table.

### 10.8 The text dump

`--text` writes the same data for reading: players, quests with their texts, variables, used regions, then every
trigger by folder with flags, expression, conditions and actions in words (objects, regions, quests and triggers
by name; dialogue lines and subtitles quoted), and the warnings.
