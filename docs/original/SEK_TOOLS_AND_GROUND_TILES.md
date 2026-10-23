# SEK's tools, and the ground tile sets

Knowledge taken from partial sources of SEK's own tools that the toolkit's author has (only knowledge was taken; none
of their files are in the toolkit), and from the ground texture sets of the installation.

## 1. SEK's content pipeline

A developer described the pipeline as: (1) a 3ds Max plug-in tags the model and animation data; (2) a second plug-in
exports it to SEK's own object format, **GOD**; (3) the resource builder computes the rest ("GI"). The sources match
that:

| tool | what it does |
|---|---|
| 3ds Max 8 tools: the "KO" exporter / ResourceBuilder, EMU, OInK | export of models and animations; `ResourceBuilder.cpp` computes the normals (GSF_DETAILS.md §6) and still contains the old binary export as commented-out code |
| GODConvert | bakes the per-vertex ambient occlusion (`SHFakeCalc`, the "NormalLight" byte of 9 / 17-byte vertices) into GOD files |
| ScapeTextureCalc | builds `ScapeTexture<Q>.dat` and its `.dds` atlas pages (§3) |

The step that packs GOD files into `.gsf` archives is not in these sources.

### Object class property files (not shipped)

What the attribute bits 5-31 of a chunk mean was defined per model type (FourCC) in object-class "PropDB" files that
the 3ds Max tools read. They are not shipped with the game. Their format:

* `prop0` .. `prop31`: name, type (enum | mask), start bit, end bit, params, default;
* `ValidityRules`: `OneBitSet`, `Exclusive`, `IfSetASetB`;
* `LinkSet`.

SEK's tools number the bits raw (`1 << bit`); bits 0-4 are the LOD mask. The names in use come from the community's
table ([GSF_FORMAT.md](../GSF_FORMAT.md) "Chunk attributes").

## 2. The ground settings and their folders

A map's setting (`Terr` chunk, [MAP_FORMAT.md](../MAP_FORMAT.md)) selects the folder
`Data/<mod>/Texture/Scape/<Setting>/`. Every setting of the game has its own folder, including the ones only one map
uses:

| setting | folder | maps using it (counted on a copy of an installation) | notes |
|---|---|---|---|
| 0 Northland | `Northland` | 14 | |
| 1 Savanna | `Savanna` | 20 | |
| 2 Jungle | `Jungle` | 32 | |
| 3 Icewaste | `Icewaste` | 5 | |
| 4 Ashvalley | `Ashvalley` | 7 | |
| 5 TestSet | `TestSet` | | its forest file is `Forest_Test.txt` |
| 6 Cave1 | `Cave1` | 3 | |
| 7 Cave2 | `Cave2` | 1 (`single_16`, the volcano of the last campaign mission) | volcanic: basalt, lava, a brick floor with the SEAS fist |
| 8 Cave3 | `Cave3` | none | a flat beige placeholder set |

Besides the tile sets, every setting folder holds `grassblades_(…).dds` (a 4 × 4 atlas of grass clumps), `dirt_(…)`,
`noise_(…)`, `fog_(0256)`, sky textures and `minimap_colors.tga`
([TERRAIN_NOTES.md](../../remake/docs/TERRAIN_NOTES.md), [MINIMAP.md](../../remake/docs/MINIMAP.md)); the building
ground brushes are in `Texture/Scape/ObjBrush/`.

A mod replaces files, not folders: MIRAGE's `Texture/Scape/<Setting>` has only `dirt_(1024).dds` and
`grassblades_(1024).dds` and no `ScapeTexture*.dat`, so the tile sets still come from Base under MIRAGE.

## 3. ScapeTexture<Q>.dat

The format (gzip; tile table indexed by a 16-bit material descriptor, macro map, variant ranges) is in
[TERRAIN_NOTES.md](../../remake/docs/TERRAIN_NOTES.md). Additional findings:

* **Q = 1 .. 5 are the game's ground detail levels** (the texture quality setting); a tool should use the levels
  that are installed.
* Each `.dat` stores its tile size (TileSize) and its mip-map border (MipMapBorder). The usable inner tile is
  **TileSize − 2 × MipMapBorder** pixels (ScapeTextureCalc.cpp `m_iRawTileSize`; checked by the continuity of the
  seams). A tile covers 4 m of ground.
* Cave2, all five levels:

  | Q | TileSize / MipMapBorder | inner tile | atlas pages |
  |---|---|---|---|
  | 1 | 14 / 2 | 10 px | 1 page of 1024 px |
  | 2 | 24 / 2 | 20 px | 1 |
  | 3 | 40 / 2 | 36 px | 2 |
  | 4 | 48 / 4 | 40 px | 4 |
  | 5 | 70 / 4 | 62 px | 7 pages of 2048 px |

* The border differs between the sets at the same level. Q5: TileSize 70 with border 4 (inner 62) in Jungle, Ashvalley,
  Icewaste and Cave2; border 2 (inner 66) in Northland and Savanna; border 1 (inner 68) in Cave1; Cave3 has TileSize 64
  with border 4 (inner 56) and 6 pages. Jungle Q1: TileSize 14, border 3. So "64 px + 3 px border" is not a constant of
  the format.
* At Q5 the finest ground is 62-68 px per 4 m tile, about 16 px per metre.
* How the engine chooses among the variants of a transition tile is not known (the toolkit hashes the position).
* Orientation: a tile spans four material cell centres; the picture's top row lies towards map y 0 (north), and the
  macro map's rows run south with it - the only orientation in which the 2 × 2 and 4 × 4 groups join. Whether the whole
  picture is flipped north-south cannot be proven from the data.
