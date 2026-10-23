# GSF archives: details beyond GSF_FORMAT.md

[GSF_FORMAT.md](../GSF_FORMAT.md) is the main description of the model archives. This file adds what was found
afterwards: the full field layout written as a Kaitai Struct description (checked to cover every byte of the game's
archives), the findings of the Blender add-on's round trips (`blender/README.md` in the toolkit), and the field names
of SEK's own exporter source. Field names from SEK's exporter come from `ResourceBuilder.cpp`, which still contains the
old binary export (the `TGODComp*` structs) as commented-out code; that gave the layouts of particles, billboards,
light volumes, cloth colliders, speed lines, lights and animations.

## 1. How it was checked

* **Kaitai Struct** (kaitai-struct-compiler 0.10, a debug build that records the byte range of every field): the 61
  archives of Base and BoosterPack1 (290,524,792 bytes) have **0 bytes not covered, 0 overlaps, 0 errors**. Of all 75
  archives looked at (with BoosterPack3, MIRAGE, Wintermod), 2,960 bytes were not covered, all in 4 archives edited by
  MIRAGE's tools; `MIRAGE/GSF/mirage_animals.gsf` has two models (`atroxosaurud`, `saltasaurud`) with dangling chunk
  pointers, so a parser runs into garbage counts there. The decoded values (materials, table of contents, walk sets,
  vertices, triangles, skeletons and bind matrices, links, billboards, track keys) are identical to the toolkit's
  `pwexport/gsf.py` on all Base and BoosterPack1 archives.
* **Blender add-on** core: the 57 archives of Base + BoosterPack1 (290 MB) read → write → read with zero
  differences, and every value the writer derives (counts, offsets, the skeleton count below) equals the file's.

## 2. Chunk kinds

The first u32 of a chunk is its type: bits 0-7 the kind, 0x80000000 = skinned per vertex (or the component hangs on
bones), 0x20000000 = the whole component is bound to one bone set, 0x40000000 = animation data of that kind.

| kind | chunk | animation chunk |
|---|---|---|
| 0x00 | mesh | 0x40000003 mesh animation |
| 0x01 | billboard cloud (`BillCloud`) | 0x40000001 billboard animation (used by three animations of the game) |
| 0x02 | particle emitter | 0x40000002 emitter path |
| 0x05 | skeleton | 0x40000005 bone animation |
| 0x08 | light (one chunk in the whole game: `aje_scarecrow`) | |
| 0x09 | cloth | |
| 0x0A | `PhysColl`: a collision volume for a cloth | |
| 0x0B | link (attachment point) | |
| 0x0D | `LightVol`: an ellipsoid that shades billboards (the community called it "selection volume") | |
| 0x0E | speed line (trail behind weapons, projectiles) | 0x4000000E speed line path |

SEK's exporter sorts a model's chunks: skeletons, cloth colliders, particle emitters, links, light volumes, cloth, then
everything else by name. About 180 chunks of type 0x40000003 carry vertex / UV morph frames (mesh frames).

## 3. File header and header 1 (the table of contents)

```
"GSF\0", u32 0 (version), u32 offset of header 2
header 1:
  lstr  archive name (without extension)
  u32 n, n × model:   lstr name, u32 index into header 2's model infos,
                      u32 n, n × animation { lstr name, u32 index into the model's animation table,
                                             u32 n, n × u32 sound index, u32 animation groups (bit set) },
                      u32 n, n × walk set (42 slots + 4-character name)
  u32 n, n × sound:   lstr .wav path below Audio, u32 start frame, u32 volume %, f32 speed (pitch),
                      f32 (0 in every sound looked at), f32 min fade distance, f32 max fade distance,
                      f32 max hearing distance, lstr sound group (usually empty; sounds of one group are alternatives)
  u32 n, n × effect:  u32 model info index, u16 model animation index, lstr name, u32 start frame,
                      u32 n, n × { lstr key, lstr value }        (the "dust trail" table, EFFECTS_AND_EVENTS.md)
  u32 n, n × lstr     animation group names: "idle", "walk", "fight", "work" (character archives only, else none)
  u32 n, n × lstr     walk transition set names ("Animals1", "Ships3", "Hu_SteamTank" ...)
padding up to header 2
```

* **Header 2's offset** = the end of the table of contents rounded up to a multiple of 0x10000 (usually 0x10000;
  more in `all_characters` and `all_animals`).
* The animation group bit set: bit k = the animation belongs to group k: 1 idle, 2 walk, 4 fight, 8 work (5 = a fight
  stand animation that is also an idle one); 0 in archives without the group table. (Older notes called it
  "unk_idle_mgr".)
* The three sound distances were named by their values (5-15, 55-99, the last always max + 1) - *probably*.
* The game reads only header 1 to know which models and animations an archive has.

### Walk set slots

42 slots; each is a 1-based position in the model's animation list (0 = unused), one byte, or two bytes
(`((b0 & 0x7f) << 8) | b1`) when the first has its top bit set. Set names: `def`, `defn` (the newer walks of SEAS
soldiers and heroes; the scripts use it when the model has it), `hump` (badly hurt animals), `swim`, `rage`, `cary` /
`sldr` (carrying), `hrdm`, `seq1`.

| slots | animations found there |
|---|---|
| 0-3 | `walk_1` .. `walk_4` (speeds; also `hump_1`, `swim_1`, `walk_1_new`, `carry_walk_1` ...) |
| 4-15 | `walk_<speed>_end_s` / `_m` / `_l` for speeds 1-4 (stopping after a short, medium, long step) |
| 16, 17 | `standrotate_right` / `standing_turn_right`, `standrotate_left` / `standing_turn_left` |
| 18 | never used |
| 19-21 | `accel_1_2`, `accel_2_3`, `accel_3_4` |
| 22-24 | `brake_4_3`, `brake_3_2`, `brake_2_1` |
| 25, 26 | `rotate_left` / `walk_left`, `rotate_right` / `walk_right` (walking in a curve) |
| 27 | `riding_layers` |
| 28 | **not an animation**: 1-based index into the walk transition table of header 1 |
| 29-33 | `growup`, `sail_up`, `sail_down`, `standanim`, `walk_to_swim_2` |
| 34-41 | `hit_reaction_fa`, `_la`, `_ra`, `_ba`, `_fb`, `_lb`, `_rb`, `_bb` |

## 4. Header 2

```
u32 0, u32 model count, u32 animation count, u32 0
ptr model infos, u32 count (= model count), ptr animation infos, u32 count (= animation count)
materials header: u32 count, ptr materials, u32 capacity (1000, or 0)
```

* Only `count` materials exist; the rest of the reserved list (capacity − count records of 24 bytes) are empty records
  (zeros and three "none" offsets). An archive written by a mod tool (MIRAGE's `seas_laboratory`) had material records
  past the header's count that its models use.
* **Material list** ("fallback table" of the community notes), per model and per animation with mesh frames:
  `ptr back to header 2, ptr back to the materials header, ptr indices, u32 count, u32 1`; submeshes, billboards and
  emitters index this list, its entries index header 2's materials.
* **Animation info** (28 bytes, one per source animation file; the models do not use this table): fourcc (or four zero
  bytes), ptr name (the helper object of the source scene: `Helper01`, `KOHelper01`), ptr + count of animation chunks,
  ptr material list (the animation's mesh-frame materials), u32 1, u32 frame count.

### Model info (84 bytes)

| offset | field |
|---|---|
| +0 | fourcc: `Char`, `Anim` (animals), `Bldg`, `Wall`, `Fiel`, `Ship`, `Vehi`, `Deko`, `Misc`, `Ress`, `Vgtn`, `RIVR` |
| +4 | ptr name |
| +8, +12 | ptr chunk table, chunk count |
| +16 | ptr material list |
| +20 | u32, always 1 |
| +24, +26 | u16 first particle emitter index (0 when none), u16 count |
| +28, +30 | u16 first link index (0xFFFF when none), u16 count |
| +32 | u8: 1 on models with billboard or particle chunks (exact) |
| +33 | u8 number of skeleton chunks (rule below) |
| +34 | u8 number of cloth collider chunks |
| +35 | u8 number of cloth chunks |
| +36 | u8 first light volume index (255 when none) |
| +37 | u8 light volume count |
| +38 | u8 speed line count |
| +39 | u8 0 |
| +40 | ptr, always none (probably the way points of SEK's exporter, which no shipped model has) |
| +44, +48 | ptr collision table ("WalkColl" of the exporter), count |
| +52 | bounding box |
| +76, +80 | ptr animation table, count (12 bytes an entry: ptr back to the model info, ptr + count of chunk animation references) |

* `num_skeleton_chunks` = the number of chunks in {skeleton chunks} ∪ {chunks any `skeleton_index` refers to} (checked
  on every archive).
* A collision volume (32 bytes) counts only in the states its attribute bits belong to, like a mesh chunk. Boxes are
  what units walk around (building footprints), spheres what projectiles hit.

## 5. Common chunk fields

* **guid** = CRC-32 of the component's name in the source scene **as written** (checked on 13,408 particle emitters,
  the only chunks that also store their name; 4,200 of those names have upper-case letters). The same in every chunk
  type. (GSF_FORMAT.md's "crc32 of the lower-case name" holds for the bones named in lower case, such as "root".)
* **skeleton_index** of a skinned chunk is a **chunk-table index**: it points at a skeleton, or at a cloth chunk that
  drives the component (the BoosterPack1 floating corpses and barrels, `excavation_camp_*`, `ship_chain`). A skeleton
  chunk's own `skeleton_index` is its own chunk index.
* **Bone references** of a component that hangs on bones (`skin_ref`): u8 bone[4] in depth-first order (255 = unused),
  u8 weight[4] (255 = 1.0).

## 6. Mesh and cloth chunks

```
attributes, guid, 4×4 matrix, u32 flags, [u32 skeleton index], [skin_ref when the whole mesh hangs on bones],
ptr mesh data, then u32 NormalLight parameters (mesh) or 32 bytes of cloth data (cloth), then the mesh data
mesh data (44 bytes, also one frame of a mesh animation): bounding box, u32 n + ptr submeshes, u32 n + ptr submesh
    material indices (u16 each: submesh k uses entry k, an index into the model's material list)
submesh (56 bytes, 60 in cloth): bounding box, u32 vertex count, u32 triangle count, [u32 cloth triple count],
    ptr vertices, ptr triangles, u32 triangle count, [u32 vertex size 8, 9, 16 or 17 - not in cloth],
    ptr + count extra data, [u32 vertex size 8 or 16 - cloth only]
```

* **Mesh flags** (+76 of the chunk): 0x08 extended UV, 0x10 baked light (both add a 9th / 17th vertex byte; the extra
  byte exists exactly when `flags & 0x18`), 0x20 wrapped UV (with extended UV); 0x02 is set on nearly every mesh; 0x01,
  0x04, 0x40, 0x80, 0x100 are not understood (the exporter also knows "camera normals", "sort alpha" and "bake skin").
  `NormalLight != 0` coincides with flag 0x10.
* **NormalLight** (u32): the packed parameters (method and three factors) from which SEK's resource builder computed
  the per-vertex ambient occlusion byte (1..255); 0 = none. About 25,400-26,000 submeshes have the byte.
* **Extended UV** (flag 0x08, 81 submeshes: `*_river_*`, `ash_lava_river_*`, `seas_hq_gate_lava_*`,
  `hc_temple_basin_*`, `hc_drain_*`, `scorpion_controller` ...): byte 8 holds two more bits per coordinate (u: bits
  0-1, v: bits 2-3): `uv = (high × 256 + byte) / 1024`. Checks: river v across the width becomes 0.33 … 0.66, centred on
  the opaque band of the water texture's alpha (opaque middle, clear banks); lava v lands in the lava half of
  `ash_specloc_a`. Without it rivers look clear in the middle and `ash_lava_river_01` shows the whole atlas. (Telling
  the two 9-byte kinds apart by the second u32 before the mesh's bounding box - 0 for extended UV - gives the same
  result as the flag.) The client's decoders were not seen dividing by 1024 (see the open points).
* **Extra data** of a submesh: on submeshes whose material has a normal map (attr1 & 0x10) one u16 per vertex,
  probably the packed tangent (not decoded; older notes called it "light data"). In cloth: records of 3 vertex
  indices, not understood (probably where the cloth is held).
* **Cloth data** (32 bytes): u32 number of the cloth within the model, ptr (always none) + count, ptr + count of
  point list a, ptr + count of point list b, s32 −1 (0, 1 or 3 on the six cloths that have the two point lists). Only
  six models (the floating corpses and barrels of BoosterPack1) have the point lists: one vector per vertex, probably
  unquantised positions and normals.
* **Normals as SEK's exporter made them** (`ResourceBuilder.cpp`): face normal = (v0 − v1) × (v0 − v2), not
  normalised (bigger faces weigh more; a degenerate face gives (1, 0, 0)); a corner's normal = the sum over the faces at
  the vertex that share a smoothing-group bit with it, normalised; then the nearest of the 511 table vectors. Area
  weighting reproduces 94 % of the stored indices, angle weighting 70 %.
* Odd geometry in the game data: triangles with a repeated vertex index, sliver triangles whose corners have identical
  data, a submesh material index of 65535.

## 7. Billboard cloud chunk

```
attributes, guid, 4×4 matrix (+12), u32 material (+76, index into the model's material list),
u8 last cell (+80: number of cells used − 1), u8 first cell (+81), u8 log2 rows (+82), u8 log2 columns (+83),
u8 DimmVar % (+84), u8 ColorVar % (+85), u8 BaseLight 0-255 (+86), u8 DimmScale % (+87),
f32 size (+88; drawn a quarter of this high), u8 SizeVar % (+92), u8 pivot y (+93), u8 pivot x (+94),
u8 flags (+95: 0x01 no waving in the wind, 0x02 has a light volume), f32 randomize (+96),
u8 border width, u8 border left, u16 light volume chunk index (+102; 0xFFFF = none),
[u32 skeleton index when skinned], bounding box, u32 count, ptr points, u32 point size (5, or 13 skinned)
```

A light volume index appears in 2,489 billboard chunks. A billboard point is 3 × 13-bit position (+1 unused bit) and,
when skinned, 4 bone indices and 4 weights.

## 8. Particle emitter chunk

`attributes, guid, u32 source type (bits 0-30; bit 31 = heat haze), pos, quaternion, vec3 velocity ("scale"), u32
maximum particles, [skeleton index, skin_ref], f32 spread, ptr name, ptr + count atlas tiles, ptr + count parameters`.

* The parameters belong to the script particle source class `CParticleSource_<type>`; their definitions were in a file
  of SEK's tools (`Particle.txt`) that is not shipped. Type 3's list has grown at its end over time: 0-29 parameters,
  older exports have fewer.
* The emitter's name block has `num_chars = −1`; some emitters have no name.
* Atlas tile record (9 bytes, "TextureInfo"): material index, log2 columns, log2 rows, first cell, cells − 1 (an
  animated sprite plays first .. first + n), border width (`TileLimitR − TileLimitL`, 255 = the whole cell), border left
  (`TileLimitL`), pivot x + 127, pivot y + 127.
* Flags parameter of source 3 (read in PWClient.exe): 0x1 start in a sphere, 0x2 velocity from a random sphere point,
  0x40 / 0x10000 radial velocity, 0x80 burst (all particles start together), 0x100 / 0x400 / 0x800 / 0x1000 tile
  animation, 0x200 ring edge, 0x4000 fade alpha only, 0x8000 fade colour and alpha, 0x20000 never downwards, 0x80000
  particles live in the world, 0x800000 upper half sphere, 0x2000000 no motion, 0x4000000 gravity along the
  emitter's −z, 0x20000000 sprite turned along its flight, 0x40000000 flat on the ground. How the client uses them:
  [particles.md](../../remake/docs/spec/particles.md).

## 9. Skeleton, links, volumes, speed lines, light

* **Skeleton chunk**: attributes, guid, skeleton index (= its own chunk index), root bone (60 bytes), ptr bind poses,
  u32 bone count, u32 bone count, u32 0. Bone flags: 0, or 1 on a few bones (probably the "extended bone setup" of
  SEK's exporter). In the game a bone's children always lie on its local +x axis (checked on allosaurus, stegosaurus,
  `cole_s0`, macrolemys).
* **Link names** in use: `HndR`, `HndL` (hands), `Shld`, `Back`, `Ride` / `Dri1` (riders), `Proj` (projectile start),
  `Spwn` (spawn point), `Ex_1` (exit), `Bl_0-9` (builder spots), `Cr_1-4` (cranes), `D_01-16` (damage fire and smoke),
  `we` (weapon build-up), `Db_1`, `Db_2` (drawbar and wagon), `Rid2`, `Rid3`, `flag`, `con`, `psh1..3`, `SpBa`, `SpFr`.
  Scripts sometimes write a five-letter name (`"Rider"`): only the first four letters count.
* **Light volume** (`LightVol`): attributes, guid, u32 shape (an ellipsoid in every shipped model), pos, radii,
  [skeleton index, skin_ref]. It shades the billboards that refer to it (a tree's crown).
* **Cloth collider** (`PhysColl`): attributes, guid, shape (sphere or tube in the shipped models; position and size as
  in the collision table), s32 cloth chunk index (−1 = not assigned), u32 0 or 1, [skeleton index, skin_ref].
* **Speed line**: attributes, guid, pos, quaternion, f32 size, f32 length, u8 alpha (255 − the exporter's value; 255 =
  opaque), atlas tile record, [skeleton index, skin_ref]. Its path comes from a speed line animation (positions per
  frame).
* **Light** (only `aje_scarecrow`): attributes, guid, pos, 3 × u32, f32, u32 colour - a guess from that one chunk and the
  exporter's fields (position, colours, range, attenuation).
* Components with no LOD bit at all: 73 meshes (`pteranodon_boden`, `aje_small_farm` ...), 3 cloths, 52 light volumes,
  5 skeletons, 4 billboards, 3 emitters. Most components are on all five LODs; common partial sets are LOD 0 only, 0-1,
  0-2, 4 only and 3-4.

## 10. Animations

### Bone animation (0x40000005)

```
attributes, guid (checksum of the root bone's name), u32 flags, s16 loop start, s16 loop end (−1 without loop marks),
f32 root height (z of the root bone at the first frame; −1 without flag 0x04),
root track node (16 bytes, embedded at +24), u32 frame count, vec3 root distance
```

* Flags: 0x80000000 always, 0x01 loop marks, 0x02 dummy root (bone and format of the root node are 0xFF), 0x04 root
  height, 0x08 fixed root, 0x10 absolute root.
* Root distance: the distance the root moves; for walk cycles y is the speed of the loop part in m/s (allosaurus
  `walk_1/2/3` = 1.5 / 5 / 7).
* Loop marks split a clip into start, loop and end: Corythosaurus `walk_1` has 81 frames with the loop 10-60, i.e.
  start 0-10, loop 10-60, end 60-80. Walks, idles, rest, feeding and work loops (`hacking`, `chop_tree` ...) have such
  marks (2,682 clips in 134 of the 2,735 models the remake converts). Animals also have separate transition clips
  (`accel_1_2`, `brake_2_1`, `walk_N_end_s/_m/_l`; walk set slots 4-24).
* Track node (16 bytes): u8 depth-first bone index, u8 format, u8 child count, u8 flags, ptr keys, ptr children, u32
  child count. Formats (SEK's names): `AFF_Root` 0 (40 bytes a key: quaternion, position, velocity per frame),
  `AFF_RootSc` 1 (52: + scale), `AFF_Simple` 2 (16: quaternion), `AFF_Trans` 3 (20: + offset along the bone's x),
  `AFF_TransSca` 4 (32: + scale); 255 none. Node flags: 0x01 **constant** - one key, and it is only a rotation (16
  bytes) **whatever the format**; 0x02 **no keys** - the node is only there for its children.
* Root nodes: 14 root tracks are constant (one 4-float rotation key) and are used by 1,421 model animations of
  `all_characters` (e.g. the archers' `rotate_left`); 3 root tracks have no keys (`domination_flag` up / down,
  `ninigi_siegetower` `move_up`).
* Track tree: a node's parent is the nearest animated ancestor bone in 98.3 % of the chunks; the rest are chunks shared
  between different skeletons, so a track's stored parent must be kept.
* 13 tracks animate the scale down to 0 to hide parts: `react_dilo_fm_0` and `chop_1` of Cole, Stina, the queen and the
  Aje archers, and `ninigi_water_turret` `attack_front`. A converter must not invert such matrices.

### Mesh animation (0x40000003)

`attributes, guid, bounding box, u32 flags (mesh flags of the frames: 0x08 extended UV, 0x20 wrapped UV), u32 mesh
count, ptr + count u16 mesh index per frame, ptr + count matrices (per frame, replacing the chunk's matrix), u32 key
count, ptr + count keys (28 bytes: absolute position + quaternion in model space), ptr + count u16 key index per
frame, ptr + count meshes (44-byte mesh data, a different mesh per frame: vertex animation), ptr material list` (none
without mesh frames).

### Other animation chunks

* Billboard animation (0x40000001): like the mesh animation, with clouds (36 bytes: bounding box, count, ptr points,
  point size) instead of meshes.
* Emitter path (0x40000002): attributes, guid, u32 flags (1 = positions), ptr + count positions.
* Speed line path (0x4000000E): attributes, guid, ptr + count positions.

## 11. Gates: open and closed parts

`Building.usl` `CGate`: `VIS_FLAG_OPEN_BIT = 14` and `VIS_FLAG_CLOSED_BIT = 16` (commented as the bits for the
collision volumes in the open / closed state). `OnInit` hides the bit-14 parts and shows the bit-16 parts
(`SetRndInvMaskSingleFlagInv(14, false)`, `(16, true)`, Building.usl:2405-2406); the doors then move by the `open` /
`close` animations of the skinned leaves. Only the level editor, which cannot play animations, shows bit 14 for an
open gate (`SetLEGfxFlags`: state 0 → 14 on 16 off, 1 → 14 off 16 on, 2 → both on).

In the models the skinned leaves carry bits 15 + 16 (`hu_palisade_gate` meshes 102 / 106 and their damage variants 87 /
91, 96 / 100); the static leaves modelled standing open (turned about 100°) carry bit 14 only (meshes 103 / 108, 88 /
92, 97). Gate models with bit-14 parts: `hu_palisade` 5, `hu_small_wall` 6, `hu_re_enforced_wall` 8,
`aje_bone_palisade` 8, `aje_clay_wall` 5, `ninigi_palisade` 8, `pt_citywall` 6, `hcl13` 6, `water_sanctuary_d1/d2/d4/d5`
6, `valhalla` 2, `rune` 2 parts. None: `seas_gate`, `seas_endboss_gate`, `ninigi_defense_skewer_gate`.

`seas_endboss_gate` has no animations of its own: it is the `seas_gate` rig scaled by 1.25 (every bone's rest position
× 1.25) and uses `seas_gate`'s clips, whose doors open by **translating** bones (open: bone `95f6b20c` 14.57 → 3.49).

Wall pieces are hubs with arms; the parts are named by CRC-32 of `x0` … `x47` and `<d><a-h>` with the state letter
A-P: [walls_engine.md](../../remake/docs/spec/walls_engine.md) §3.

## 12. Open points

* The u16 per vertex on normal-mapped submeshes (probably the tangent) is not decoded; cloth data is little
  understood.
* Extended UV: the /1024 reading fits the data (rivers, lava), but the client's mesh decoder at 0x73d7f5 was seen using
  `byte / 255 × scale + offset` from a per-chunk table, and no division by 1024 was found near the mesh decoders - not
  yet checked against the engine.
* The light chunk (one in the game) is understood only partly.
