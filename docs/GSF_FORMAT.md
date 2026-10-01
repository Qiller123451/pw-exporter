# ParaWorld .gsf format — notes from the Blender converter

These notes cover the parts that `paraworld_gsf.py` needed. They build on Zidell's GSF notes and arceusVen1's
Paraworld_gsf_viewer (kaitai `gsf.ksy`). Items marked **new** were worked out while building the converter
and checked by rendering the results.

## General
- Little endian. Every offset is a **self-relative** int32: target = field position + value. `0x80000000` = null.
- File: `"GSF\0"`, version 0, u32 offset of header 2 (usually 0x10000). Header 1 is the table of contents: model
  names, animation names, sound, dust-trail and walk-set tables.
- **new:** header 1 walk-set entries are 42 variable-length indices. One byte each, or two bytes
  (`((b0 & 0x7f) << 8) | b1`) when the first byte is ≥ 0x80. After the indices comes a 4-char name. Character archives need this
  because they have more than 128 animations.

## Header 2
- `+16` model info table ptr, `+20` count; `+24` anim info ptr, `+28` count; `+32` material count, `+36` materials ptr.
- Material (24 bytes): attr1, attr2, texture name ptr, normal-map name ptr, env-map name ptr, 0.
  attr1: `0x1` alpha test, `0x2` alpha blend, `0x4` additive (particles, gore), `0x8` environment map, `0x10` normal
  map, `0x100` probably no z-write (particles), `0x200` probably two-sided, `0x1000` player colour, `0x4000` probably
  specular (attr2 = 0xF). attr2: bits 0–3 specular / environment strength, bits 4–7 normal-map strength.
  (SEK's exporter source: flags, flags2, texture, bump if MF_Bump, env if MF_Environment.)
- Model info (84 bytes): fourcc (Char/Anim/Bldg/…), name ptr, chunk table ptr + count, used-material table,
  bbox at `+52`, per-model animation table ptr `+76` + count `+80`.
- Per-model animation k → list of (anim chunk ptr, frame count). **new:** entry j belongs to chunk j of the
  model (skeleton or animated mesh), and null means that chunk has no animation.
- Animation chunks are heavily shared between models (all_characters: 1269 unique chunks, 85779 references).

## Chunk attributes (visibility flags)
Every mesh / billboard chunk carries a u32 attribute word. The engine draws a chunk when its bits fit the object's
current render mask (bits that must be set, bits that must be clear). **Bits 0–4 are the LoD mask** (bit k = drawn at
level of detail k) for every model type; what bits 5–31 mean depends on the model type (FourCC) and was defined per
type in SEK's object class files (not shipped; the 3ds Max tools read them). SEK's tools number the bits **raw**
(`1 << bit`); the community table (Paraworld_gsf_viewer `docs/gsf/flags.jpg`, "Bit1..Bit32") counts every byte from
its top bit, so its BitN is raw bit `8*((N-1)//8) + 7 - (N-1)%8` (and `gsf.py BIT(i)` uses that old numbering).

| raw bit | Char | Ress | Bldg / Fiel | Wall | Deko | Vehi / Ship | Misc | Anim | Vgtn | RIVR |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | Head | res_1 | AnimateConStart | AnimateConStart | Sequence | ram_low | Misc_Step0 | PartyCol | | |
| 6 | Body | res_2 | AnimateConEnd | AnimateConEnd | | ram_high | Misc_Step1 | Saddle | | |
| 7 | Legs | res_3 | ? (cloth) | | | | Misc_Step2 | Helmet | | |
| 8 | | res_4 | ? (con flag) | | | | | Armor | | |
| 9–13 | | res_5, res_6 (9, 10) | Age 1–5 (Bldg) | ? | ? (sequence steps) | | | Standarte, Armorsaddle, Misc (9–11) | | |
| 18 | SelVol | SelVol | SelVol | ? (drawn) | SelVol | SelVol (Vehi) | SelVol | SelVol | SelVol | SelVol |
| 19 | | | ShadowModel | ? (shadow) | ShadowModel | ShadowModel | ShadowModel | | TreeBillboard | |
| 20 | | | Night | | Night | Night (Ship) | Night | arm_li | | |
| 21–24 | | | Con 0–3 | Con 0–3 | (Con) | (Con 0–3, Ship) | ? (hu_ruin_ws) | arm_re, leg_li, leg_re, bauch_li | | 21 UseWaterShader |
| 25 | | | Con 4 (finished) | Con 4 | | Con 4 (Ship) | ? | bauch_re | | |
| 26 | | | UseConFlags (shown intact) | same | | same (Ship) | ? | head | | |
| 27 / 28 | | | Dest 1 / Dest 2 | Dest 1 / 2 | | Dest 1 / 2 (Ship) | ? | tail / – | | |

Towe (not used by the shipped models): Zinnen_1–9 at bits 5–13. Fiel adds bit 9 (hu_corn_field). Full table with
the unknowns: `pwexport/web/parts.js FLAGS` (shown in the exporter's Visibility section).

**Collision table** (model info `+44` / `+48`, 32-byte records `[u32 type][3f pos][3f size][u32 attr]`, the "walk
collision" list of SEK's exporter; attr = the record's visibility bits): type 0 sphere (centre, r, r², 0), 1 box
(min corner, size; never rotated), 2 tube (bottom centre, r, 0, height), 3 ellipsoid (centre, radii).

## Mesh chunks
- Types: 0 static, 0x80000000 skinned, 0x20000000 "simple skinned" (the whole chunk is bound to one bone set),
  9 / 0x80000009 / 0x20000009 cloth (same header, 36 bytes of cloth data before the bbox, 60-byte submeshes).
- `+12` 4x4 row-major matrix (D3D, row vectors). Positions are quantised inside the **chunk** bbox.
- Vertex strides 9 and 17 add one byte of baked ambient occlusion ("NormalLight", 1..255, computed by SEK's
  resource builder from 511 rays and the mesh's convexity) after the 8 / 16 bytes below.
- Vertex (8 bytes): bits 0–38 = 3×13-bit position (value/8191 inside bbox), bits 39–47 = index into a 511-entry
  unit-normal table, byte 6 = u×256, byte 7 = v×256. **v runs bottom-up** (OpenGL style): for glTF/top-down
  images use v = 1 − byte7/256. (Checked against atlas features: nuts, valve wheels and skin charts line up exactly.) 16-byte vertices add 4 bone indices (255 = none) and 4 u8 weights.
- Triangles: u16 triplets, counter-clockwise when viewed from the side the normals point to (right-handed).
- Submesh material index → model's used-material list → global material.

## Skeleton chunk (type 5) — **new** parts
- `+16` first bone (60 bytes), `+76` bind-pose ptr, `+80` bone count, then the other bones every 60 bytes from `+92`.
- Bone: guid (= crc32 of the lower-case name, e.g. crc32("root") = 0x16F4F95B), flags, pos[3], scale[3],
  quat[4] (xyzw), child count, **pointer to the first child — children are stored next to each other**, child count.
- Quaternions are D3D style: for column vectors use the **conjugate**. Rest local transform = T(pos)·R(conj q).
  The rest scale is **not** part of the bind pose (ignore it).
- Bind poses: one row-major inverse bind matrix per bone, in **depth-first** bone order.
  Vertex bone indices and animation track indices use this same depth-first order.

## Skeletal animation chunk (0x40000005) — **new**
- `+12` flags: 0x80000000 always; 0x1 loop marks (`+16` int16 first and last frame of the loop part, -1 = none: the clip is start + loop + end, the
  engine plays the start once, repeats the loop and plays the end when the action stops); 0x2 no single
  root track (`+25` = 0xFF); 0x4 root height (`+20` float); probably 0x8 fix root z, 0x10 absolute root. `+48` = the
  loop's speed in m/s (allosaurus walk_1/2/3: 1.5 / 5 / 7). The root layout's 3 "unused" floats are the root's
  velocity per frame. Animations are made at 25 fps. (From SEK's 3ds Max exporter source, checked on the data.)
- `+25` root-track layout (0: 40 bytes/frame = quat, pos, 3 unused floats; 1: 52 bytes = … + scale; 2: quat only),
  `+28` root track ptr, `+32` track tree ptr, `+36` count, `+40` frame count, `+44` 3 floats (walk distances).
- Track node (16 bytes): u32 attr = [depth-first bone index, type, child count, ?], data ptr, children ptr, child count.
  Type 2 = quat per frame (16 B), 3 = quat + x-offset (20 B), 4 = quat + x-offset + scale (32 B), 0 = no data.
- Track rotations are **deltas in bone space**: local = T(rest pos [+x-offset]) · R(conj rest q) · R(conj track q).
- The root track animates the skeleton root bone the same way. Its position is an offset added to the rest position,
  in model space.
- A few frames hold NaN or zero quaternions; replace them with the nearest valid frame.
- Checked: walk cycles move the feet mainly along the forward axis; death animations end lying on the ground.
  The other composition orders fail both checks.

## Object animation chunk (0x40000003) — **new**
- Animates a mesh chunk (buildings, vehicles). `+64` key table (n × [pos3, quat4], absolute; quat conjugated as
  above), `+72` u16 per-frame key index, `+76` frame count. Alternative layout: `+52` 4x4 matrix per frame.
- 0x40000002 = particle emitter animation (not converted).

## Links (0xB, 0x8000000B)
- pos[3], quat[4], 4-char name (`HndR`, `HndL`, `Shld`, `Back`, `Ride`, …). The skinned version adds a skeleton index and 4 bone
  ids/weights. Position is in model (bind) space.

## Billboards (1, 0x80000001)
- `+4` attribute flags (the LOD mask in bits 0–4 works like a mesh's: tree foliage comes in sets for LOD 0–1, 2, 3
  and 4), `+12` chunk matrix (16 floats).
- `+76` u32: the **material** – an index into the model's used materials (the sprite atlas texture).
- `+80` u8 ?, `+81` u8 **atlas cell index**, `+82` u8 **log2 of the rows**, `+83` u8 **log2 of the columns**: the atlas
  is split into 2^cols × 2^rows equal cells, numbered row by row (2,2 = 4 × 4; 3,3 = 8 × 8; 4,4 = 16 × 16; 3,2 = 4
  columns × 8 rows). Checked against the alpha channel of every atlas: ~96 % of the cells read this way have
  transparent borders (the rest are effect sprites of buildings).
- `+88` sprite size (float); the game draws a sprite **a quarter of that** high (calibrated on objects of known size:
  Dragon Clan barrels and paper lanterns, flowers, fruit).
- Static: bbox `+104`, count `+128`, vertex ptr `+132`, stride `+136`. Skinned: everything 4 bytes later.
  Vertex: 5 bytes = 3 × 13-bit position in the bbox (relative to the chunk matrix); skinned sprites (stride 13): byte
  5 = the bone (joint index, as mesh vertices), bytes 6–9 = 0xFFFFFFFF (colour?).

## Corrections 2026-10-01 (found while building the Model Exporter; pwexport/gsf.py VERSION 2026.10.3)
- **Walk-set indices are 1-based positions in the model's animation list** (0 = slot unused). Slots: 0–2 walk
  speeds 1–3, 4–12 stops (`walk_<n>_end_<s|m|l>`), 16/17 turn on the spot, 19/20 accelerate, 23/24 brake, 25/26 walk
  turning left/right, 28/29 extra (`farm_anim_1`, `growup`). Set names: `def`, `defn` (SEAS soldiers and heroes:
  `walk_<n>_new`), `hump` (seriously injured animals), carrying sets. FightingObj.usl uses "defn" when the model has
  it, else "def". Exported as root `extras.walksets`.
- **Constant tracks:** track attr byte 3 bit 0 (mask 0x01000000) = the track has **one key** (not one per frame).
  Reading a key per frame ran into the next tracks' data: necks, heads and fingers got wild rotations. (Byte 2 of
  the attr is the number of extra child entries; the data block is keys × stride + 4 floats per child.)
- **Helper ("root") track bone:** the chunk byte at `+24` is the **depth-first index of the bone** the helper track
  drives – 0 (the root) for creatures, but e.g. 1 = the lighthouse lamp of hu_harbour, 15 = the fan of
  seas_greenhouse, 2–12 = neck/head for animal turn and head-turn animations. 0xFF with layout 0xFF = no helper.
- **Billboards** get their own attribute flags (`extras.attr`, kind `foliage`); billboards with a `particle_*`
  texture on buildings and build-ups are effect sprites (smoke, dust), not geometry. (VERSION 2026.10.5: atlas cell,
  material and size corrected, see above; static exports get two vertical quads per sprite, turned by a per-sprite
  angle, instead of three axis-aligned ones.)
- **Flag-less low-poly hulls** (≤ 24 vertices, no flags at all, > 8 units) are whole-object pick/collision volumes.
