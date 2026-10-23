# Rendering: shadows, fog, time of day, texture coordinates, decals

What was read in `bin/PWClient.exe` (and `PWServer.exe` for the clock) about how the original draws its world, plus
the settings files of `bin/`. Addresses: image base 0x400000, PWClient.exe unless "PWServer" is written. Tags: **[C]**
read in the code, **[D]** checked on the data, **[I]** inferred.

## 1. Shadows

### Graphics option levels (`bin/GfxOptionPropDB.txt`)

The "Shadow" option writes these values (`Pest/Config/ShadowRenderer/...`) into the profile's `Settings.cfg` when it is
chosen in the options menu:

| level | Enable | Complexity | MaxDistance / FadeDistance | AllObjShadows | BigObjShadows | ObjHighDetail | ObjShadowed | ScapeShadow |
|---|---|---|---|---|---|---|---|---|
| Shadow_0 | 0 | 0 | 0 / 0 | 0 | 0 | 0 | 0 | 0 |
| Shadow_1 | 0 | 1 | 180 / 180 | 0 | 0 | 0 | 0 | 0 |
| Shadow_2 | 1 | 1 | 180 / 180 | 0 | 0 | 0 | 0 | 1 |
| Shadow_3 | 1 | 1 | 180 / 180 | 0 | 0 | 0 | 1 | 1 |
| Shadow_4 | 1 | 1 | 180 / 180 | 0 | 1 | 0 | 1 | 1 |
| Shadow_5 ("Very High") | 1 | 0 | 220 / 220 | 1 | 1 | 1 | 1 | 1 |

All levels: `bDifferentObjectAndScapeShadowColor = 1`, `DepthBias = -0.5`, `AABBGrow = 0.0`; Shadow_5 adds
`fShadowFadeStart = 90`, `fShadowFadeEnd = 180`.

### Which objects cast a shadow [C]

* The shadow pass is the loop at 0x482765-0x482a42. Without `AllObjShadows` only buildings (BLDG) and decoration (DCCO)
  cast, plus animals and vehicles (ANML / VHCL) with `BigObjShadows`. Trees (TREE / VGTN) and forest blocks (0x6fa318)
  cast only with `AllObjShadows = 1`, which only Shadow_5 sets.
* Single objects are drawn at **level of detail 4** in the shadow pass (`push 4` at 0x482a1b).
* Which chunks: with `ObjHighDetail = 0` the model's mesh chunk with attribute bit 19 (`ShadowModel`; raw mask 0x80000,
  with all LOD bits) is drawn, if it has one (0x6c5320, 0x4717c7, 0x45c72f). That chunk is a hand-made low-poly shadow
  stand-in (for a tree: the volume of crown and trunk, opaque material). Forests set the include mask 0x80000
  unconditionally (0x6f7dce / 0x6f804a), so forest models without such a stand-in cast nothing. With
  `ObjHighDetail = 1` the LOD chunks are drawn and the bits 19 / 20 are excluded.
* Shadow_5 sets `AllObjShadows = 1` together with `ObjHighDetail = 1`, so trees cast with their LOD-4 chunks. The jungle
  trees' LOD-4 crown is billboards only (chunk type 1 / 0x80000001). Billboards are sent to the depth pass (vertex
  shader 0xB + pixel shader 4, 0x6a9be2) but leave nothing [C that they are sent; I why]. A probable cause [I]: vertex
  shader 0xB takes the billboard axes c44-c46 from the camera projection m00 (device +0x49b0, 0x6aa6c3); the light
  matrix multiply is skipped at 0x6aa829.
* `bSkipBillcloudShadow` (`[0xa40424]`) never fires, because `[edi+0xe1]` is only ever written as 0 (0x6e6a38).
  `bBillCloudShadowed` only picks the shadow-**receiving** billboard shader (vertex shader 0xA + pixel shader 5 /
  0x17). The shader tables are at 0x9771e8 / 0x977248.
* Shadow stand-ins in the data [D]: `jungle_tree_01..05` and 160 of the 278 vegetation models with billboards have the
  bit-19 chunk. `jungle_tree_med_*`, the beach palms and the fan palms have none; their LOD-4 meshes have alpha-tested
  foliage cards (`jng_medium_*`, attr1 = 1).

**Result in the game:** the trunks of trees cast shadows, the leaf crowns do not.

A configuration change that should make trees cast the stand-in's solid crown shadow (not tested in the game): in
`bin/GfxOptionPropDB.txt`, Shadow_5, `Pest/Config/ShadowRenderer/ObjHighDetail = '0'` (optionally also
`AllObjShadows = '1'` in Shadow_4), then choose the shadow level again in the options. Side effects: buildings then cast
their bit-19 shadow models, as on levels 2-4; forest trees without a stand-in cast nothing; no dappled leaf shadows.
Fixing the billboard depth path itself would need new code in the program (there is no free 20-byte run of `int3` in
.text for it).

## 2. Fog

The sky renderer (0x730720-0x730a15) switches linear fog on every frame and sets:

* a = sky colour alpha / 255 (0x727d80; depends on the time of day and the weather),
* k = 1 + 4 × (1 − dot(horizontal(viewDir), viewDir)) (1 looking level, more when the camera looks down),
* VD = the view depth (sky +0x134, probably the config value `ViewDepth`, default 150),
* end = 2 × B(a) × k × VD, start = min(2.5 × A(a) × k × VD, end), with the piecewise linear curves
  A: (0, 0.8) (0.1, 0.2) (1, 0.01) (2, 0.8) and B: (0, 0.99) (0.1, 0.51) (1, 0.3) (2, 0.99).

The values go to Direct3D `FOGSTART` / `FOGEND` (LIGHTRND +0x24 / +0x28, fog enable +0x32; 0x723330). Particles fade
out between them (0x705191). Without fog the defaults are 100000 / 200000. The fog colour was not traced.

## 3. Time of day

`CTimeMgr` (PWServer 0x7bcab0, PWClient 0x5745f0): virtual time = (now − start) × 144.0; a day is 86400.0 virtual
seconds = 10 real minutes; `ServerApp.usl` sets the day offset 0.25 and the night offset 0.75, so day is 6:00-18:00.
A level starts at `Root/Base/StartTime` of its level info (12:00 when it has none; in the campaign mission 0 starts at
6:00, mission 5 at 15:00, mission 11 at 18:00, mission 16 at 8:00, the others at 12:00). The client clock:
[CUTSCENE_PLAYER.md](CUTSCENE_PLAYER.md) §6.

Only finished buildings and ships switch their lights (every 20 s: `Building.usl` NIGHT_TIMER, `Ship.usl`
TIMER_NIGHT; GSF parts with attribute bit 20 at night, bit 17 by day); no darkening of the scene by night was found in
the client. Details: [ARCHITECTURE.md](../../remake/docs/ARCHITECTURE.md) "Day and night".

## 4. Texture coordinates and the light cones

The client decodes a mesh vertex's UV bytes as `u = byte6 / 255`, `v = 1 − byte7 / 255` (0x7369e7-0x736a14,
0x736a50-0x736a89, 0x73d7f5-0x73d831: `movzx byte [edx+6]; fild; fmul [0x887658]` with 1/255, and `fsubr [1.0]` for v)
[C]. Reading them as /256 shifts every UV by up to byte/65280 - about 2 texels at the far edge of a 512 texture - and
breaks texture lookups that sit exactly on an edge:

* The light ring of the Norse large tower (`hu_large_tower`, mesh `hu_large_tower_mesh71_lod1f_f308000`, attribute
  0x0610001f = night only (bit 20), finished, intact; material `hu_lvl_2_a`, flags 0x104 / 0) is an 8-sided flared
  skirt of 32 vertices from radius 2.3 m at z 14.6 out to 5.0 m at z 12.9 around the roof. All its UVs point at one
  texel column: u byte 144 → 144/255 = 0.5647 (289.1 px of 512), v at rows 484 (inner rings) and 498 (outer rings). x
  288-296, y 480-497 of the texture is a warm light strip in a black box that fades to black at the bottom, with bright
  beige stone right of x 287. With /255 the ring samples inside the strip and fades out to black at its outer edge (a
  soft halo); with /256 (u = 0.5625 = x 288.0) bilinear filtering mixes stone and strip half and half (a hard beige
  shell).
* Other Norse light cones start at u = 288 the same way: `hu_small_tower` mesh 49, `hu_bunker(_upgrade)`,
  `hu_fireplace`, `hu_harbour` mesh 187, `hu_machine_maker`, `hu_weapons_smith(_anvil)`, `hu_lumberjack_cottage`,
  `hu_tavern`.
* The night lantern billboard `hu_large_tower_foliage73_lod1f` uses an additive glow sprite whose atlas cell
  [0.25, 0.375, 0.375, 0.5] lies exactly on cell borders (neighbouring texels bleed into a faint rectangle when drawn
  without an inset) - not checked against the original.
* Whether the original's blending for 0x104 materials is exactly One / One was not checked. 325 Base models have
  additive (attr1 0x4) submeshes, mostly 0x104: lights, lava, fire, trails, river foam, Ashvalley embers.

Extended UV (9-byte vertices with mesh flag 0x08, rivers and lava): [GSF_DETAILS.md](GSF_DETAILS.md).

## 5. Decals under units (buff decals)

The original draws **no icons above units**. A unit's buffs show in two ways:

* **One ground decal** under characters, animals, heroes and vehicles (`CObjMgr::Render` 0x481b06; the object decal
  list 0x481900): of its buffs that have a tile in `buffdecals.txt`, the one with the lowest index in the file; if the
  viewer may not see that one, nothing (there is no fallback to the next). The decal is 6 × 6 m, axis-aligned, on the
  terrain + 0.2 m, a tile of `Effects/UnitDecals` (4 × 4 tiles). Buffs without a tile never get a decal. Buildings and
  ships get none. Heroes stand on a ring of `Effects/Selection` in their player's colour.
* Up to five 16-pixel icons in the info window (`Info.usl:313-430, 1501-1535`): all entries including those without a
  tile, sorted by their index in the file; with several objects selected, the buffs of the first object of the highest
  level.
* Visibility of a buff: the owner always; otherwise 1 = everybody, 2 = enemies, 3 = allies, 0 = owner only.
* Which buffs exist: hero owner buffs are set whenever the hero's `special_abilities` change (`Hero.usl:300-321`) and are
  never removed; Darwin has his own `no_animal_aggro` (`Hero.usl:61`); buildings give owner buffs: the temple
  `owner_healing_temple`, the harbour `owner_healing_harbour`, the poison dung `owner_poison`, the quicksand and snare
  traps `owner_hold_units`. The wall's defence bonus does not show as `more_defense`; Livingstone's vanish does not show
  `is_camouflaged`.
* MIRAGE has its own `buffdecals.txt` (66 entries) and its own `UnitDecals` texture.

## 6. Objects that are effects

* The campaign's question marks: the "?" is a particle of `particle_06`; the speed-line mesh of the question mark model
  is a pick hull.
* Additive parts of effect decorations (the healing aura `fx_heal_area`, `fx_holy_forest`, the lava glow
  `ash_lava_glow_01`) carry the selection-volume bit (18) as well, but are drawn.
* The rays of `fx_heal_area` stand upright because their particles have the "sprite turned along its flight" flag
  (0x20000000) ([particles.md](../../remake/docs/spec/particles.md)).
