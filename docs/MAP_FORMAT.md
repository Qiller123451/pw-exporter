# ParaWorld map files (.ula)

Reverse engineered for the ParaWorld Toolkit from the 66 maps shipped with the game (multiplayer and campaign) and
community maps. The formal description is in Kaitai Struct: [`paraworld_ula.ksy`](../pwexport/data/ksy/paraworld_ula.ksy)
(container) and [`paraworld_surf.ksy`](../pwexport/data/ksy/paraworld_surf.ksy) (map data) – `tools/ksy_check.py`
checks them against real files. Readers: `pwexport/ula.py` (Python, the exporter's map viewer) and
`remake/src/game/maps/ula.js` (the remake).

All numbers are little endian. Map coordinates: x east 0..width, y north 0..height, z up, metres.

## Container

```
u32 2                         version
u32 total size of the unpacked data
u32 N                         block count
u32 crc32 of the 12 bytes above
u32 ?                         varies; not a CRC-32 of the header, the table or the data
N x { u32 unpacked size (262144 = 256 KiB, the last block less), u32 packed size, u32 1, u32 crc32(packed block) }
N zlib streams, back to back (the first at 20 + 16 * N)
```

Inflating the blocks and joining them gives the map data: a `SURF` chunk tree.

## Chunk trees (SURF, UOF2, ...)

Every node:

```
char[4] tag                   "SURF", "LInf", "obj", ... (padded with zeros)
u32     end                   offset of the first byte after this node and all its children
u16     flags                 0x02 = version follows, 0x08 = data size follows, 0x20 = data offset follows
u16     child count
[u32    version]              if flags & 0x02
[u32    data size]            if flags & 0x08
[u32    data offset]          if flags & 0x20
        children              (child count nodes, directly after the header)
```

Typical flags: `0x2a` a chunk with data (24-byte header), `0x02` a group (16 bytes), `0x28` data without version
(20 bytes), `0x00` an empty group (12 bytes). A data chunk can have children too. Offsets count from the first byte of
the tree (`SURF` = the start of the map data; nested trees count from their own start).

## SURF – the map

| Chunk | Contents |
|---|---|
| `LInf` | level info (below) |
| `Terr` | terrain (below) |
| `PaFi` | pathfinding grid |
| `Rgns` | named regions, e.g. each nest's `Nest_<kind>_<n>_ActionArea / SafeArea / HotspotArea / ToleranceArea` |
| `Frst` | forest blocks: 32 m squares of forest, with the state of their 15 trees and 16 undergrowth plants (below) |
| `Objs` | placed objects (below) |
| `GWFl` { `GrWa`, `Flck` } | |
| `IOMG` | landscape decoration instances (below) |
| `Trgr`, `Ques`, `DlgS`, `AI` | triggers, quests, dialogues, scripted AI of campaign maps: `u32 size` + a nested tree (`SURF`, `AIMM`). Decoded in [CAMPAIGN_FORMAT.md](CAMPAIGN_FORMAT.md) (as is the layout of `Rgns`) |

### LInf – level info

```
u32 count, count x { key, value }            key/value strings: MapSourceType, Version, Name, MapName, MapWidth,
                                              MapHeight, GameType, Setting, GTime, LevelFileName, credits ...
s32 slot ids [8]                              (-1 in every map seen)
8 x { u32 count, count x { key, value } }    player slots: type, ready, tribe, team, color, hp_value, headquater, name
u8  ?
picture: u32 width, u32 height, u32 pixel count, u32 byte count, u32 bytes per pixel, BGRA pixels (rows from the top)
                                              the 200 x 200 preview of the map list, drawn turned by 45 degrees
16 bytes ?
description tree: node = { u32 child count, string name, string value, children }
                                              Root / Base / {Version, LevelName, Author, Recommended_Players,
                                              Edit_Version, Description, MaxPlayers, DefaultCamera ...}
```

A string is `u32 length` (including the closing 0) and the characters. Old maps use Windows code page 1252, texts
typed into newer versions of the map editor are UTF-8 (`pwexport.ula.text` reads both); `\{br}` is a line break.

### Terr – terrain

```
u32 1
u32 width, u32 height        (metres)
u32 blocks x, u32 blocks y
u32 setting                   0 Northland, 1 Savanna, 2 Jungle, 3 Icewaste, 4 Ashvalley, 5 TestSet, 6 Cave1,
                              7 Cave2, 8 Cave3 (the level info's "Setting" names it too and wins)
f32 water level               (metres; 16 on most maps)
u32 ?, u8 ?
u32 count, u16 heights[count] 1/128 m per unit, 2 m grid, stored in 16x16 blocks (blocks row by row from the
                              south-west corner, samples row by row inside a block)
u32 count, u8  materials[count] 4 m grid, stored in 8x8 blocks the same way
```

Material values index the setting's 8 ground materials – the columns of the setting's
`Texture/Scape/<Setting>/ScapeTexture<Q>.dat` table (see `pwexport/scape.py`).

### Objs – placed objects

`u32 size` + a `UOF2` tree:

```
UOF2
├─ CMGR, HMGR                 class and handle managers
├─ OBJS                       one "obj" per placed object
│  └─ obj
│     ├─ clss                 string: class (Nest_Big_Carnivores, jungle_tree_01 ...)
│     ├─ base                 the object record (below)
│     └─ data
│        └─ gobj
│           ├─ gfx { name (string: the model), Link }
│           ├─ fsm { root, base, data, ... cur }   script state
│           ├─ attr           key/values: hitpoints (= amount of a resource), spawn_type, spawn_max, spawn_rate,
│           │                 advance_time (nests), tribe, skulls, RallyPoint ...
│           └─ tmrs           timers
└─ TOBJ
```

`base`:

```
char[4] type      SLOC start location, TREE, FRUI fruit bush / fish shoal, STON stone, NEST animal nest, ANML animal,
                  DCCO / DECO / VGTN decoration, BLDG building, CHTR character, VHCL, SHIP, ITEM / ITSP items,
                  WOOD wood pile, TRRT, MNIO, DOFL, PROD, QMRK, CFXE effects, COLL, GROU, FNTN, DMGL, FOOD
u8[4]   ?
u8      owner (255 = nobody)
f32     x, y, z
f32     rotation quaternion x, y, z, w   (applied as its conjugate, see below)
string  unique name (<class>_<n>)
u8[16]  guid
...     handle, visibility, flags, linked objects: CAMPAIGN_FORMAT.md §6
```

**Rotations.** The engine multiplies row vectors (Direct3D), so the stored quaternion turns a model the other way
round than the usual column-vector reading: apply its **conjugate** (-x, -y, -z, w). The heading of an upright object
(counter-clockwise from east, map x east / y north) is `-2 * atan2(z, w)`. In a Y-up world with X east and -Z north
(glTF) the rotation is the quaternion `(-x, -z, y, w)`. Evidence: gates only line up with their wall pieces this way,
harbours face the water, and tilted plateau pieces sink their skirts into the ground instead of floating above it
(the "hollow" terrain of the untilted / mirrored reading). `pwexport.ula.rotation_matrix(q)` gives the 3 x 3 matrix.

**Walls.** Wall pieces (model type `Wall`: palisades, clay walls, fences) are a hub with arms in eight directions and
several variants of every part. The map only stores the pieces; the engine (WallMap) shows the arms towards the
neighbouring pieces, towers and gates on the 8 m wall grid, and one variant of each. `pwexport/walls.py` does the same
for the map viewer and the map exports (the rules: `remake/docs/spec/walls.md`).

**Height of ships.** The stored `z` of a ship is not where the game shows it: of the 96 placed ships of the shipped
maps 88 are stored below the water level (at the sea bed under them, or at 0, e.g. the pirate ships of
`anvil_jungle`). The game puts ships on the water when the map loads. `pwexport.mapexport.object_height(map, obj,
index)` does that for objects of type `SHIP` and for models of type (FourCC) "Ship"; ships above the water (a
hovercraft on land) keep their height.

**Part objects.** Parts of composite objects are saved as objects of their own at their parent's position: type
`PROD` (captains, build-ups, turret tops), `TRRT`, `MNIO` (turrets, cranes), and untyped ones (`Hu_Fishnet`). Every
transport (234 on the shipped maps: ships, vehicles, ridden animals, a few buildings) has a `universal_captain`.
`TransportObj.usl` `LinkCaptainObj` links it to the class's captain link point and hides it when the class has none
(`GetCaptainLink` returns false: all boats; only the Kronosaurus has "Ride"). `mapexport.hidden_parts(map)` lists
the captains and the fishing nets so that viewers do not draw them as people and nets under the ships.

### Frst – forest blocks

The game has two kinds of vegetation: plants placed like any object (`Objs`, type `TREE` ...) and **forest blocks**.
The level editor's forest mode (Alt+F) marks 32 m squares of the map as forest; a square is far cheaper than its
trees as objects and does not count towards the editor's object limit. Mappers fill areas with blocks and soften
the edges with single trees. Some maps have no placed tree at all (the tutorial map `ausbildungslager`: 2,382
blocks, 35,730 trees); the shipped maps hold 20,579 blocks with 196,236 trees.

```
u32 width, u32 height         squares of 32 m = map size / 32, rounded down (the server refuses a size that differs
                              from the terrain's)
records, sorted by square:    u32 index (= y * width + x), 32 bytes
u32 0xffffffff                end (a chunk is at least 128 bytes: maps without forest have unused bytes after it)
```

A record's 32 bytes: byte 0 is unused (0), bytes 1..15 are the square's 15 **trees**, bytes 16..31 its 16
**undergrowth** plants ("deco"). Per item byte:

| Bits | Meaning |
|---|---|
| 0-4 | amount. The editor stores `floor(size * 6.2)` (size 2..5 from the layout, so 12..30), times 10/16 or 8/16 for spots near a side of the square where no forest block follows (6..18). The client only tests it for > 0 |
| 5-6 | state: 2 = standing, 1 = stump (trees), 0 = gone. A new block has state 2 everywhere |

Two kinds of blocks are found in maps: **trees + undergrowth** (all 31 items standing) and **undergrowth only** (the
15 trees gone, state 0 - e.g. the squares along the shore of `antarctica`).

**Where the items stand is not in the map.** The engine has 32 fixed layouts of 31 spots built in (the same table in
PWServer.exe and PWClient.exe, 32 x 624 bytes) and picks one per square from the square's position:

```
layout (624 bytes)   u32 31
                     f32 x[31], f32 y[31]     position inside the square, metres (0.6 .. 31.3)
                     f32 size[31]             2 .. 5
                     i32 random[31]           see below
                     i32 edge[31]             0 = inside, 1..4 = near one side of the square
layout of square (x, y) = word[(2317 * y + 13 * x) % 4992] & 31        the table itself read as 4992 u32 words
item position = (32 * x + layout.x[i], 32 * y + layout.y[i]), on the ground
tree i (0..14):        kind = ((random >> 1) & 0x3fffffff) % 5,  heading = -((random >> 4) & 7) * 45 degrees,  scale 1
undergrowth i (15..30): kind = random & 7, not turned
```

The kinds are the setting's `Scripts/Server/classes/vegetation/Forest_<Setting>.txt` (`Forest_Test.txt` for the
setting `TestSet`):

```
Tree0 .. Tree4 { Standard = model of the standing tree, Stump = stump model, Timber = timber model,
                 FallAnim = animation the timber plays when the tree falls, Size = '[x y z]' billboard size }
FakeTreeTexture  texture of the billboards that stand in for far trees
Deco0 .. Deco7 { Standard = model, Size }
```

On some maps (about 15 of the shipped 78) the stored amounts belong to another layout than the square's: the map
was resized or moved after its forest was painted. That does not matter - the game places by the square's
current position.

Rules of the engine (read from the program code):

* Nothing of a forest block stands at or below **16 m**, the water level: the server removes those trees when it
  loads the map, the client draws neither trees nor undergrowth there. Blocks may lie in the sea.
* The client draws a tree with its model near the camera (5 levels of detail by distance), beyond that as a
  billboard with `FakeTreeTexture`; undergrowth only at the nearest 3 levels.
* A worker chops a forest tree like any tree ("6 hits": `GetMaxHPFakeTrees`); the tree then becomes a
  `<Setting>_Tree_0<kind+1>_Timber` object next to its stump (`HarvesterTask.usl` `CreateObjTree`).

`pwexport/forest.py` reads all of this: `patterns(install)` finds the layout table in the game's own program file
(the toolkit ships no game data; without `bin/PWServer.exe` or `PWClient.exe` forests cannot be placed),
`config(install, setting)` the kinds, `items(map, patterns)` every tree and undergrowth plant, `objects(map,
install)` the same as map objects. `map.forest` holds the squares as stored. The map viewer shows the trees
("Forest blocks: trees", and the undergrowth on request), the 3D export and the CSV / JSON exports contain them.

### IOMG – landscape decoration instances

```
u32 ?, u32 blocks x, u32 blocks y
u32 class count, class names (strings)
u32 block count; per block: u32 n, n x 32 bytes { f32 x, y, z, f32 quaternion[4], u32 class }
```

Grass, ferns and small plants; the game draws them as ground sprites.

## How the remake uses a map

`remake/src/game/maps/source.js` turns the map into a *map source*, the same interface `mapgen.js` provides for random
maps: size, playable rectangle, water level, height function, ground textures and splat, trees, decor, stones,
bushes, fish, animals, starts and bases, and the set of models to load. The remake centres the map:

```
game x = map x - W/2
game z = H/2 - map y
rotation = -2 * atan2(qz, qw)        (props: the full quaternion, (-qx, -qz, qy, qw) in game space)
```

(the toolkit's map exports use the same centre, with -Z = north in the glTF convention.)

Forest blocks (`maps/forest.js`, the twin of `pwexport/forest.py`): every standing tree of a block becomes a tree of
the map source like a placed one - same models, stump, timber and wood. The layouts and the kinds per setting come
from `forest.json`, which the pipeline step "forest" builds from the player's installation.

Water: a cell deeper than 0.4 m blocks land units; ships need 1.5 m. Maps larger than 1400 m use a 4 m pathing cell.

The toolkit's server lists every map in the installation's `Data/<pack>/Maps/` folders (`Base`, `BoosterPack1`,
mods like `MIRAGE` ...) as `maps/<pack>/<path>.ula` in `maps/index.json`, so maps installed into the game the usual
way appear by themselves; "Open map file…" in the map picker loads a map from anywhere.
