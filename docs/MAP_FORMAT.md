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
| `Frst` | list of ids with 32-character obfuscated names (not forests: trees are placed objects) |
| `Objs` | placed objects (below) |
| `GWFl` { `GrWa`, `Flck` } | |
| `IOMG` | landscape decoration instances (below) |
| `Trgr`, `Ques`, `DlgS`, `AI` | triggers, quests, dialogues, scripted AI of campaign maps: `u32 size` + a nested tree (`SURF`, `AIMM`) |

### LInf – level info

```
u32 count, count x { key, value }            key/value strings: MapSourceType, Version, Name, MapName, MapWidth,
                                              MapHeight, GameType, Setting, GTime, LevelFileName, credits ...
s32 slot ids [8]                              (-1 in every map seen)
8 x { u32 count, count x { key, value } }    player slots: type, ready, tribe, team, color, hp_value, headquater, name
u8  ?
picture: u32 width, u32 height, u32 pixel count, u32 byte count, u32 bytes per pixel, RGBA pixels (rows from the top)
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
...     (fixed-size rest, not decoded)
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

Water: a cell deeper than 0.4 m blocks land units; ships need 1.5 m. Maps larger than 1400 m use a 4 m pathing cell.

The toolkit's server lists every map in the installation's `Data/<pack>/Maps/` folders (`Base`, `BoosterPack1`,
mods like `MIRAGE` ...) as `maps/<pack>/<path>.ula` in `maps/index.json`, so maps installed into the game the usual
way appear by themselves; "Open map file…" in the map picker loads a map from anywhere.
