# Terrain texture atlases (Texture/Scape/<Setting>/ScapeTexture<Q>.dat)

SEK built these sets with its ScapeTextureCalc tool (source seen 2026-10-01, not part of the toolkit): per quality
level Q (1 low: one 1024² atlas of 14 px tiles; 5 high: seven 2048² atlases of 70 px tiles = 64 px + 3 px border) it
packs the variants of the setting's 8 ground materials and every pre-blended transition between them. Reader:
`pwexport/scape.py read_dat` (layout in its docstring, verified on every set of the game).

The `.dat` (gzip): page count, page file names (`.tga`, the game loads the `.dds`), tile size, page size, mip-map
border setting, then **u16 tile[65536]** indexed by a 16-bit "MatDesc", then per material the tile ranges of its
single / double (2 × 2) / quad (4 × 4) variants, a 32 × 32 **macro map** and 32 empty slope-list words, and 1024
unknown bytes. Tile i = atlas i // (k·k), row (i % k²) // k, column i % k with k = page / tile; tile 0 is magenta.

MatDesc: bits 14–15 type. **3 = transition**: bits 0–2, 3–5, 6–8, 9–11 the materials at the tile's top-left,
top-right, bottom-left and bottom-right corner, bits 12–13 one of 4 variants (the tool blended the corner materials
through blend masks; with fewer materials it made fewer variants and the table reuses them). **0 / 1 / 2 = one
material** (bits 0–2) at macro-map position x = bits 4–8, y = bits 9–13 as a single / double / quad tile; the macro
map entry holds the single variant (bits 0–7), the double variant (8–15) with its tile x / y (24 / 25, bit 30 = part
of a double) and the quad variant (16–23) with its tile x / y (26–27 / 28–29, bit 31 = part of a quad). So a pure
area repeats every 32 tiles (128 m) and rocks, bushes and patches spanning 2 × 2 or 4 × 4 tiles stay whole.

How a map uses it (`scape.bake`, map exports and the exporter's map view "Ground tiles of the game"): a 4 m tile spans
the square between four material cell centres and takes the transition tile of their four materials; the tile
picture's top is north and the macro map's rows run southwards (the only orientation in which the 2 × 2 / 4 × 4
groups join; north vs. south of the whole picture is not provable from the data). The variant of a transition tile
is a hash of the position (the engine's choice is not known). `material_textures` lays out the first 8 × 8 macro
map cells of each material: the seamless material textures of the exporter's blended view and the remake.

Not used yet: the remake still blends the material textures in its shader instead of drawing the transition tiles;
the 1024 bytes at the end of the file.

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
