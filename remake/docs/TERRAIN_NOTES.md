# Terrain texture atlases (Texture/Scape/<Setting>/ScapeTexture<Q>.dat) – findings so far

Community tip: the `.dat` files describe how the tiles of `ScapeTexture<Q>_<n>.dds` are combined, one set per
quality level (Q = 1 low: one 1024² atlas; Q = 5 high: seven 2048² atlases).

What is known (Jungle, Q = 5):

* The `.dat` file is gzip-compressed. Decompressed:
  * `u32 7` (version?), `u32 7` (number of atlases), then 7 strings (`u32 length` + zero-terminated name,
    e.g. `ScapeTexture5_0000.tga`),
  * `u32 70` – tile size in pixels (64 px + 3 px border on each side), `u32 2048` – atlas size, `u32 4`,
  * 6144 rows of 8 × u16 (rows come in identical pairs), then a second table (4236 rows of 8 × u16) whose values
    grow in steps of 658 per column and 76 per row, ending in a large permutation-like block.
* Atlases: 29 × 29 tiles of 70 px, tile index i → atlas i / 841, row (i % 841) / 29, column (i % 841) % 29.
  Tile 0 is magenta (invalid). The top rows hold "pure" materials in long runs (grass, sand with rocks, lush
  grass, red dirt, rock, sand, cracked earth ...), the rest are pre-blended transition tiles.
* In the first table, column k of every row always points into the tile range of material k (e.g. column 0:
  grass tiles, column 1: sand-with-rocks tiles 89..), so a row looks like "one variant tile for each of the 8
  materials" – probably chosen by position to avoid repetition.

Used by the remake: `pipeline/build_terrain.py` (reading with `pwexport/scape.py`) takes each material's variant tiles (the value set of table column k,
weighted by how often the table picks them), strips the 3 px borders and lays 8 × 8 random variants into
`assets/terrain/scape_<k>.jpg`. The variants of a material tile seamlessly, so these are the original ground
textures. The splat shader (src/engine/terrain.js) blends materials 2 (lush grass), 0 (dry grass), 3 (red earth)
and 4 (rock with moss) at ~3 m per tile. Jungle materials: 0 dry grass, 1 sand with rocks, 2 lush grass,
3 red earth, 4 mossy rock, 5 pale sand, 6 sand patches, 7 cracked earth.

Not yet decoded: how a map cell's material combination selects a transition tile (second table); the remake blends
materials in the shader instead of using the pre-blended transition tiles.

## Grass, detail and cave sets (2026-10-01)

Every setting folder (`Texture/Scape/<Setting>/`) also holds:

* `grassblades_(0064..0512).dds`: a 4 × 4 atlas of grass-clump sprites with alpha (green tufts in Jungle, straw in
  Northland, small plants in Savanna ...). The original scatters them over the ground. The remake does the same with
  `engine/grass.js`; `pipeline/build_terrain.py` (reading with `pwexport/scape.py`) exports the atlas as `assets/terrain/<Setting>/grass.png`. Which
  materials get grass is a hand-made table (`GRASS_DENSITY`), chosen by looking at the ground textures. Where the
  original keeps that information is not decoded yet; the `.dat` second table is a candidate.
* `dirt_(…).dds` (grey gravel detail), `noise_(…).dds` (4 × 4 noise cells), `fog_(0256).dds` (cloud puffs),
  `skygradient*.tga` and `skymask01_*.dds` (sky), `minimap_colors.tga`. These are not used yet.
* `ObjBrush/*.tga` (one level up): ground stamps under each building type, not used yet.

Settings 5–8 in the map header are TestSet, Cave1, Cave2 and Cave3. Only Cave1 is built; Cave2 and Cave3 fall back
to it, and TestSet falls back to Jungle. Cave1 has no grass atlas.

Ground blending in the remake: relative height blending (each texture's brightness above or below its own
average), a second rotated texture scale mixed by noise, side projection on slopes, and noise-warped material
lookups (`maps/source.js`).
