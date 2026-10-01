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
  `attr1 & 0xF` = alpha mode (1 = alpha test, 2 = blend, …); `0x10` = uses a normal map; `0x1000` = player colour.
- Model info (84 bytes): fourcc (Char/Anim/Bldg/…), name ptr, chunk table ptr + count, used-material table,
  bbox at `+52`, per-model animation table ptr `+76` + count `+80`.
- Per-model animation k → list of (anim chunk ptr, frame count). **new:** entry j belongs to chunk j of the
  model (skeleton or animated mesh), and null means that chunk has no animation.
- Animation chunks are heavily shared between models (all_characters: 1269 unique chunks, 85779 references).

## Chunk attributes (visibility flags)
- Flag number i has mask `1 << (8*(i//8+1) - i%8 - 1)`.
- LOD0..LOD4 = masks 0x01, 0x02, 0x04, 0x08, 0x10.
- 21 = selection volume; 20 = shadow model (Bldg/Deko/Fiel/Ship) or tree impostor (Vgtn); 19 = night-only.
- Buildings: 29 = construction flags in use, 30 = finished (con4); 27/28 = damage states.
- Anim (tamed animals): 0/1/13/14/15/16–19/28–31 = helmet, saddle, armour, standard, limb/body armour.
- Ress: 13 = full resource (res6), others are depletion stages.

## Mesh chunks
- Types: 0 static, 0x80000000 skinned, 0x20000000 "simple skinned" (the whole chunk is bound to one bone set),
  9 / 0x80000009 / 0x20000009 cloth (same header, 36 bytes of cloth data before the bbox, 60-byte submeshes).
- `+12` 4x4 row-major matrix (D3D, row vectors). Positions are quantised inside the **chunk** bbox.
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

## Billboards (1, 0x80000001) — partly understood
- Static: bbox `+104`, count `+128`, vertex ptr `+132`, stride `+136` (5-byte vertices, position only).
  Skinned: everything 4 bytes later. Positions are relative to the chunk matrix.
- `+80` bytes [mode, atlas cell, span x, span y] on an 8×8 atlas grid (matches jungle trees; uncertain for others).
  `+88` sprite size (float).

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
  texture on buildings and build-ups are effect sprites (smoke, dust), not geometry.
- **Flag-less low-poly hulls** (≤ 24 vertices, no flags at all, > 8 units) are whole-object pick/collision volumes.
