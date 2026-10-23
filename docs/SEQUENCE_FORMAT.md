# ParaWorld in-engine cutscenes (.seq)

The cutscenes of the campaign (`Data/Base/Sequences/<campaign>/<mission>/sc_*.seq`, the film wrappers `ms_*.seq`,
`fade_in_*.seq`; localised timing in `Data/locale/<lang>/Sequences/...`) are timelines played by the client's
sequencer. This document describes the file format and what the game does with it, as reverse-engineered from
`bin/PWClient.exe` (and `bin/PWServer.exe` for the server side). Addresses are virtual addresses (image base
0x400000). The decoder is `pwexport/seq.py` (`read_seq()`, schema `pw-seq/1`); it decodes all 104 Base files and the
localised copy (`pl/.../sc_2010.seq`) to their last byte.

    python3 -m pwexport.seq <file.seq | folder> [--json out.json] [--compact]
    python3 -m pwexport.seq --check <ParaWorld folder or Sequences folder>

Evidence marks: **[C]** read in the client's code, **[S]** read in the server's code, **[D]** seen in the data (all
105 files), **[I]** inferred (plausible, not traced to the end) - see the open points at the end.

## 1. Conventions

* Positions: map metres, x east, y south, z up - the same space as the map objects (`ula.py`, `campaign.py`); an
  actor's position equals its object's position on the map [D].
* Rotations: quaternions stored (x, y, z, w), applied the Direct3D way = `ula.rotation_matrix(q)`. `heading` in the
  JSON = `-2 atan2(qz, qw)` as for map objects.
* Cameras: with `ula.rotation_matrix(q)` the camera looks along its local **+Y** axis, local **+Z** is up (checked:
  the eye object's +Y points exactly at the camera's target object in every camera [D]). Field of view in
  **radians** (0.658 = 37.7° in nearly all cameras) [D]; it is the engine camera's FOV like the editor camera (fov
  0.785, aspect 1.3) - vertical, Direct3D style [I].
* Times: item `start` / `length` in seconds (f32). Path and camera key frames are u16 frames of **1/50 s**
  (`0x840670` = 50.0 divides them, e.g. 0x4ffb74, 0x437fd4) [C]. Animation frames are played at **25 frames/s** (the
  sequencer passes 25.0 = `0x41c80000` to the animation queue 0x7a9ef0) [C].
* GUIDs: 16 bytes (serialized as two 8-byte halves); the JSON uses the editor's 32-letter form (`triggers.guid_str`),
  so actor GUIDs compare directly with `objects[].guid` of a campaign JSON and with GUID strings inside the file
  (`ItemLink`).
* Strings: u32 length (including the closing 0) + bytes (0x412470); text as `ula.text()` (UTF-8, else cp1252).

## 2. Container and archive

`.seq` = gzip. Inside: the client's `CArc` stream (0x59e5a0 reads n raw bytes; mode 1 = read, 2 = write). The
file loader `0x530f70` opens `/Data/Base/Sequences/<file>` (message "can't open sequence file '%s'"), reads one
u32 (0 in every file) and ignores it, then calls `CSequence::Serialize` **0x52d3a0**. The loader stores the sequence
version in the archive (`[arc+0xc]`, 0x52d3e6); nested serializers test it (camera spline keys, §7).

All files are version 20, except `single_04/ms_2020.seq` and `pl/single_03/sc_2010.seq` (21; the client writes 21).

## 3. The sequence record (0x52d3a0)

| field | type | condition | notes |
|---|---|---|---|
| version | u32 | | 20 / 21 |
| name | string | | always empty |
| length | f64 | | +0xa8: length of the timeline (s) |
| start, end | f64, f64 | v > 0 | +0x90, +0x98: the part that is played; end 0 = whole timeline. `duration` = end - start |
| (legacy) | u32 | v == 2 | |
| camera track | §4 | | 0x52c5f0 |
| items | §5 | v >= 3 | 0x52c810, with the sequence's ItemDayTime |
| SeqRegion | §6 | v >= 7 | 0x57d660 |
| (legacy) | u8 | 8 <= v <= 18 | flag bit 1 |
| (legacy) | u8 | 11 <= v <= 13 | |
| audio_mode | u32 | v >= 14 | +0x128: 2 (one file: 1); 0x52a180 turns 2 into 1 in the game -> speech is played as a sound (§9.6) |
| (legacy) | u8 | 15 <= v <= 18 | |
| vec_b0 | f32 x3 | v >= 17 | +0xb0; zero except in two files (open point) |
| flags | u32 | v >= 19 | +0x7c. Bit 2 (4) `hide_region_objects` (0x52b931). Bit 3 (8) is set by the loader for v 19 / 20 (0x52d5e4) and selects the .mp3 speech path (0x510eab). Bits 0, 1 seen, meaning open |
| anchor | string class, GUID, f32 x3 pos, f32 x4 q | v >= 20 | an object the sequence finds by GUID or creates (0x52d6cb: 0x479620 / 0x47f740); empty in every file |
| actors | u32 n, (v >= 16) GUID list, n x §8 | | 0x52da29. The GUID list = the GUIDs of the actors' objects |
| cameras | u32 n, n x §7 | | 0x52e072 |
| editor camera | f32 x13 | v >= 12 | 0x6c09c0: eye, look-at, up, fov, aspect, near, far - the editor view when saved (not used to play) |

## 4. Camera track (0x52c5f0)

u32 version (1), u32 n, n x **ItemCamera** (`0x508b00`, serializer 0x508b80): item header (§5.1), u32 version 0,
GUID of the camera object (§7). Tags `Cam1`..`Cam4` = the editor row. At time t the camera of the cut whose
`[start, start + length)` contains t is shown [I: no gaps in the files; between cuts the last camera stays].
Every cut GUID resolves to a camera of the file [D: 427 of 427].

## 5. Global timeline items (0x52c810)

u32 version (1), u32 n, n x {u32 type, item}; then (version >= 1) one more ItemDayTime (no type id) = the
sequence's day time / weather (JSON `day_time`). The type selects the class (jump table 0x52caa4; the class names are
the `Urs.Client.<name>` strings that follow each class's vtable in .rdata):

| type | class | ctor / vtable / serializer | fields (JSON) |
|---|---|---|---|
| 1 | ItemDayTime | 0x50aaf0 / 0x85b228 / 0x50a950 | `time_of_day` (s after midnight), `weather {type, intensity %, draw}` (v >= 2/3/4; 0x4f7ce0/0x4f7d10/0x4f7d40 -> WeatherManager) |
| 2 | ItemCut | 0x50a490 / 0x85b010 / 0x50a3d0 | none. Start 0x50a570: a cut with length > 0 **skips** its time range (sequence offset +0xa0 and the client clock advance by the length) |
| 3 | (obsolete) | ItemText ctor | read like type 12 and deleted by the loader (0x52ca09); JSON `dropped: true` (no file has one) |
| 4 | ItemBmp | 0x507a00 / 0x85a970 / 0x507bb0 | `mode`, `path` (picture, `Sequence/4030/Scope.dds`), `params` (4 values, open) |
| 5 | ItemCamFX (tag `CaFX`) | 0x509da0 / 0x85afa0 / 0x508bd0 | camera shake: `mode`, `axis_mask` (bits 0..2), `shake[3] {amplitude, frequency, flag}`; per frame (0x508660) see §9.7 |
| 6 | ItemParticle | 0x5120b0 / 0x85c758 / 0x512000 | `path` (effect class `Particle/FX/...`), `pos`, `q` (v >= 1), `flags` (v >= 2). Fixed place, lives for the item length; no attachment |
| 7 | ItemFading | 0x50b6e0 / 0x85b778 / 0x50b5d0 | `direction`: 0 `in` = from black (0x523b30), 1 `out` = to black (0x523bf0); over the item length |
| 8 | ItemTimeFactor | 0x51a680 / 0x85f9e8 / 0x51a580 | `factor` (no file uses it) |
| 9 | ItemWideScreen | 0x51dcc0 / 0x860198 / 0x51dbb0 | `bars`: 0 `on` (0x523a00), 1 `off` (0x523a20); the filter animates over the item length |
| 10 | ItemLight | 0x50e1d0 / 0x85bdb0 / 0x50e320 | raw (no file uses it) |
| 11 | ItemBink | 0x506d60 / 0x85a730 / 0x506e70 | `file` (`hs_1000.bik`, played from `Video/%s` = Data/locale/<lang>/Video) |
| 12 | ItemText | 0x51a140 / 0x85f5a0 / 0x519620 | `mode`, `font` (Verdana), `size`, `text`, `x`, `y`, `p40 p44 p48` (the film captions) |
| 13 | ItemSound | 0x517bf0 / 0x85f2f8 / 0x517ce0 | `positional` (0 = 2D), `pos`, `path` (below `/Data/Base/Audio/`), `volume` %, `loop`. Started at `start` (0x517e60); slot 11 (0x5179f0) stops it [I: at the item end] |

Counts in the Base files [D]: Sound 862, Particle 188, Fading 172, Cut 93, WideScreen 82, CamFX 59, Bink 29,
DayTime 20 (+104 sequence day times), Text 3, Bmp 1.

### 5.1 Item header (CItem::Serialize 0x502170)

u32 version (1), GUID, f32 start, f32 length, (version >= 1) char[4] tag. Every item class then writes its own u32
version and its fields (ItemAttr / ItemFlags: the class version first, the header only when it is >= 1).

## 6. SeqRegion (0x57d660)

The same record as a map region (`triggers.regions`): u32 flags (0x43), GUID, name `SeqRegion`, u32 colour, u32 n +
n shapes {u32 type (low byte 1 rect / 2 oval, high byte flags), u32, f32 x, y, z, w, h, d}, (flags & 0x40) note.
When the sequence flag `hide_region_objects` is set (0x52b8a0 -> 0x52b931), the client hides the world objects inside
the region during the sequence, except the actors' own objects (buildings handled separately, 0x52ba7f) [C].

## 7. Cameras (SeqCamera 0x51e830, camera object 0x4791f0)

| field | type | notes |
|---|---|---|
| version | u32 | 3 |
| editor pos / q | f32 x3, x4 | the SeqCamera's own transform (an editor value; not the shot) |
| fov | f32 | v >= 1, radians |
| spline | | 0x43b220: f64 start offset (0), f64 end (-1 = computed: start + last key, 0x437fa0); position keys, rotation keys, fov keys |
| camera object | | 0x4791f0: u32 version 1, u32, name `NewCamera_<n>`, u32, **GUID** (what the cuts refer to), eye object, (v >= 1) target object |
| | u8 / u32 | v >= 2 / v >= 3 |

Eye / target object (0x56a720): u32, u32, u8, pos, q, name, GUID, u32, u32, u32, u8. JSON `eye {pos, q}`,
`target {pos}`.

Spline key (0x43b4e0): u16 frame (1/50 s, absolute timeline time), (archive version >= 4) u32 `interp`, f32 x3
`tcb`, (>= 18) f32 x3 `ease`; then the value (vec3 / quaternion / f32 fov).

**Evaluation** (checked by running the client's functions in an emulator against these formulas [E]). Key times
are timeline seconds; at or before the first key its value, after the last key the last value. Segment i (from key
i-1 to key i, `t_(i-1) < t <= t_i`) uses **key i's** `interp`; s = (t - t_(i-1)) / (t_i - t_(i-1)) (no time
remapping anywhere), P0 = v[i-1], P1 = v[i], Pm = v[max(i-2, 0)], P2 = v[min(i+1, n-1)], and
H(P0, P1, T0, T1, s) the cubic Hermite.

Position (0x438150, switch 0x438980): 1 linear; 2 cosine `(1 - cos(pi s)) / 2`; 3 smoothstep `3s² - 2s³`;
4 `H(P0, P1, c(P1 - Pm), c(P2 - P0), s)` with c = 0.5 (Catmull-Rom); 5 the same with c = key i's `tcb[0]` (0 = flat
tangents); 8 `H(P0, P1, a((P1 - P0) + b(P0 - Pm)), c((P1 - P0) + d(P2 - P1)), s)` with c = key i's `tcb[0]`, d = key
i's `ease[0]`, and a = key i-1's `tcb[1]`, b = key i-1's `ease[1]` when key i-1 is type 8, else 0.5 and 1 - i.e.
per-key in / out tangent scales and weights of the outer chord (`tcb[2]` and `ease[2]` are never read, `ease` is no
time remap and is read only here); any other type (6, 7, 9) = key i's value for the whole segment.
FOV (0x439cb0): types 1 - 5 as position (scalar), any other (8) = key i's value.
Rotation (0x4389a0): 1 = `(1 - s) q0 + s q1` (q1 negated when dot < 0), not normalized; 4 / 5 = the cardinal form
above element-wise on the rotation matrices of the four quaternions, re-orthonormalized keeping the up column
(z = norm(col2), x = norm(col1 × z), y = z × x); 6 slerp; 7 SQUAD with the tangents of 0x43b5e0 (s_i = q_i ·
exp(-(log(q_i⁻¹q_{i+1}) + log(q_i⁻¹q_{i-1})) / 4)); 8 / other = key i's turn.
The turn gives only the view direction: target = eye + 10 · f, f = (2(xy + zw), 1 - 2(x² + z²), 2(yz - wx)) of the
(unnormalized) quaternion = the local +y column; the view's up is always the world's (0, 0, 1), so any roll in the
keys is dropped (0x4788a0 / 0x4774b0) [C].
Data [D]: position keys type 4 875, 8 78, 1 54, 5 37, 3 1; rotation 4 864, 5 69, 1 43; fov 1 182, 4 7, 5 2. Of the
type-8 position keys 65 have tcb 0 / ease (1, 1) (they stop at the key: ease in / out), 11 the Catmull-Rom defaults.
Without keys the eye object's pos / q and the camera fov are the shot.

## 8. Actors (read path 0x52dc24)

| part | serializer | fields |
|---|---|---|
| object | 0x4fbc90 (v 2) | GUID, `name` (`queen_s0_1`), `class` (`queen_s0`), `type` (four-character code `CHTR`, `ANML`, `BLDG` ...), `attributes` (key/value: hitpoints, tribe, RallyPoint, unique_name, ...) |
| binding | 0x4fbf30 (sequence v >= 9) | `region` (always `UniqueWorldRegion`), `class`, `owner` (-1 = none), `level` (-1 = any), `name` ('' = any) |
| size | u32 | bytes of the actor block that follows (the decoder checks it) |
| actor block | 0x4ff540 (v 13) | u32 n + n x {u32 type, item} (§8.1); embedded ItemFlags (+0x2d0, the start flags) and ItemLink (+0x318); the binding again; u32 (+0x534); `state` 0x4febc0: pos, q, u32 x5 (255, object flags, part mask, scale 1.0, u32), `attachments` (models on link slots: `HndR` -> `cole_machete`, recursive 0x501000 / 0x500120 / 0x4feb10), u32 |

### 8.1 Actor items (jump table 0x5000f0; type = vtable slot 0x48)

| type | class | serializer | fields / what it does |
|---|---|---|---|
| 0 | ItemAnim | 0x5042a0 | `anim`, `repeat`, `first_frame`, `last_frame` (inclusive). Apply 0x5040e0 queues the frame range on the model (0x7a9ef0, 25 fps); `repeat` 0 holds the frames (`dying [0,32,32]` for 45 s); "invalid anim" when the model lacks it |
| 1 | ItemVisPath | 0x51ac60 | `path` (0x56fa60: u32 1, u32 mode, f64 start, f64 end, pos keys {u16 frame, vec3}, rot keys {u16 frame, quat}): a recorded motion / turn played on the actor |
| 2 | ItemAnimAct | 0x504f70 | `anim`, `loops`, `intro` (flag 1), `outro` (flag 2). Apply 0x504b00: with the clip's loop markers (+0x40 / +0x44): intro once, the loop part `loops` times, outro; without markers the whole clip `loops` times |
| 3 | ItemRotAct | 0x516f00 | `mode` (4), `angle` (radians): turn on the spot, computed by the server (below) |
| 4 | ItemWalkAct | 0x51c040 (v 3) | `single_target` (bit 0, never set), `walk_flag` (bit 1: on the terrain, §9.4), `walkset` (`def`, `hump`, `cary`, ...), `speed` (1..4), `path` (the waypoints as position keys) |
| 5 | ItemLipSync | 0x510b80 (v 2/3) | `lsd` path, (v >= 3) `is_key`; JSON adds `speech` (.mp3) and `subtitle_key`, `music` for SeqSounds/music |
| 6 | ItemLink | 0x510660 | `links [{op, slot, object}]` (op 2 attach / 1 detach [I]; object = GUID string) |
| 7 | ItemAttr | 0x505f20 | `attributes [{op, key, value}]` (empty in every file), `hidden`, `not_hitable`, `not_selectable`: 1 = yes, 0 = no, null = leave (0x5056a0: object byte +0x98 = 0 / 0xff, object flags 2 / 1) |
| 8 | ItemFlags | 0x50dd70 | `parts [{op, name, mask, mask2, state}]` (mesh parts `Head/Body/Legs`, `PartyCol/Saddle/Helmet/...`, `Night`), `set`, `p0c`, `p10` |
| 9 | ItemFaceExpr | 0x50b040 | `expression` (no Base file uses it) |
| 10 | ItemResetCloth | 0x516bb0 | none (unused) |
| 11 | ItemBeam | 0x5064f0 | `pos`, `q`: teleport (unused in the Base files) |

Counts [D]: AnimAct 1450, Attr 873, WalkAct 659, VisPath 485, LipSync 326, Anim 317, RotAct 19, Flags 16, Link 4.

## 9. Playing a sequence 1:1

### 9.1 Start
Trigger action `SQNZ` (ActionFactory.usl:1976-2050) fills a `CSequenceInfo` (file, quit, reason, snap_cam_back,
camera_data, snap_actors_back, disable_fow, fow_pos, fow_radius) and calls `CSrvWrap.StartSequence`.
Server 0x465b10: if a sequence is already running the new one is **queued** (0x465d70) and started when the running
one ends (0x465ca2); else the "sequence running" flag (app+0xfc34) is set, the FOW map is sent (0x465890) and the
start message (type 32, 0x7b5380) goes to the client [S]. Client: message 32 (dispatcher 0x454ed0) -> 0x501d40:
stores the info (0x8df370 ...), fades out (`Game/Sequence/FadeOutDuration`), then loads the file (0x5012c0 ->
0x52d3a0), fades in (`FadeInDuration`, 0x501220) and starts: `OnSequenceStart` to the scripts with the music
(`CMusicMgr`; `-silence-` when none) (0x501670) [C]. Game.usl:1813: input off (`CMainController.SetActive(false)`),
camera controller `EnterSequence`.

### 9.2 The simulation is paused
While the server's flag is set its main loop **skips the whole world update** (PWServer 0x42d5c3: the same branch as
the pause flag +0x1a9: timers 0xc668, world tick 0x44fe60, AI / others 0xef18, 0xf114, 0xef98, 0xfc40 are not
called) [S]. The client ignores the server's time messages (type 9) while app+0x2eae0 is set (set at 0x501d91; 0x454f53)
[C]. So no unit moves, fights or produces during a cutscene; the triggers' game time stands still; only the
sequence's own actors move (client side). Player input is off (above).

### 9.3 Actors
Load (0x52dc24): the actor's world object is looked up by **GUID** (0x479620); an object with flag bit 15 of +0x2e4
does not count. Else 0x52bea0 searches the world for an object of the binding's `class`, `owner` (owner -2 = any),
`level` (-1 = any, else attribute `level`), `name` ('' = any) - the region `UniqueWorldRegion` = the whole world -,
skipping objects that are GUID-bound actors of this sequence and objects already taken by another actor [C]. If
nothing is found a **temporary client object** of the actor's class is created (0x46d700; "Invalid Actor class",
"Actor '%s' has no GFX") and the actor is marked temporary (Actor ctor 0x500180, third argument) [C]; it exists only
on the client and goes away with the sequence [I]. At load the actor is set to its state for the timeline start
(0x5000c9 -> 0x4fe410) [C]; its stored `state` is that start pose [I].

End (0x501820): for every actor with a world object that is not temporary (+0x2c9 == 0 [I: the ctor's flag]): if `snap_actors_back`
(0x8df379) the pose it had before the sequence (actor +0x40 / +0x4c), **otherwise its current pose (where the
sequence left it)**; that pose is sent to the server (message 20, 0x542a90: GUID, pos, rotation) and set on the
client object (0x569fc0) [C]. The server applies it only while the sequence flag is set (0x44bb05: set position,
rotation, stop the current walk) [S]. So without snap_actors_back the actors stay at their end positions in the game.

### 9.4 Walks and turns
ItemWalkAct / ItemRotAct are not baked. When the sequence loads, each walk sends a request with the actor's class,
GUID, the waypoints, `walkset`, `speed` and the two flags to the server (0x51c440 -> 0x546c50) [C]. The server's
`CSeqEdActCalculator` (PWServer 0x464ed0, message sub-type 2 = walk, 0 = rotate) creates a temporary object of the
class at the first waypoint (no turn set) and builds the motion in one call (walk action 0x4a3180 -> 0x48dd70 ->
0x48beb0) [C]:
* **no path finding**: the waypoints are walked in straight lines (only bit 0, a single-target walk 0x4a3070, would
  ask the path finder; no file sets it), and nothing collides with other objects on the way;
* the speed level's fixed speed (0x489a90: 1.5, 5, 7, 10 m/s for levels 1 - 4) with the gait changes of
  `init/walkanimconfig.txt` (start S<n>, level changes T<ab>, loop L<n>) and, at the end, the stop clip
  (E<n> / end_s / end_m / end_l) whose length fits the remaining distance best (controller +0x2b0, set by every
  walk action) [C];
* bit 1 (`walk_flag`, 588 of 659 walks) puts every waypoint and every key of the result on the terrain (0x489fc0;
  objects with flag 0x10000 at least at the water level; motion flag 0x10 / 0x20, unpacked by
  VisualisationPath.cpp 0x7ada26); without it the waypoints keep their own heights (walls, decks, bridges) [C].
The result (position keys and the queue of walk clips, 25 fps) goes back to the client, which re-times each stored
waypoint to the moment the path passes closest to it and sets the item's length to the end of path and clips
(0x51d600) [C]. A failed walk ("walk action faild" / "WalkAction incomplete") is logged and gets no reply [C]; the
actor then presumably does not move [I].
The waypoint times in the files are therefore the editor's run of the same calculation: a runtime can move the actor
straight through the waypoints at those times with the walk clip of `speed` (the remake does; it has no gait
transition or stop clips anywhere).

The script trigger walk's `straightwalk` is something else: it only switches the unit's aggression walk off
(FightingObj.usl:2414), the walk and its path finding are the same.

### 9.5 Animations
ItemAnim / ItemAnimAct are queued on the actor's model at their start time (§8.1), 25 frames per second, frame
ranges / loop markers of the GSF clip. The queue entry has no blend time in the file; transitions are the engine's
animation queue [I]. Walk animations come from the walk calculation. Idle animations are off during sequences
(IdleAnimMgr:324-394).

### 9.6 Speech and subtitles
ItemLipSync start (0x510db0): unless the item is already over, the speech `<lsd path without "lsd">mp3`
(`/Data/Base/Audio/SeqSounds/Level_3/2010/2010_Tarna_01.mp3`; locale files replace `data/base` by
`data/locale/<lang>`) is played as a sound at volume 100 (0x4917f0) [C]. If `Game/GraphicOptions/ShowSequenceSubTitles`
(default 1) is on - or the sound could not be played - the subtitle is shown (0x5250a0): key = `"_seq_"` + the lsd
file name without `.lsd` (`_seq_2010_Tarna_01`), or the stored string when `is_key`; text from
`Data/locale/<lang>/Texts/sequences_<lang>.ltf` ("Key '%s' not found." otherwise) [C]. The table's keys are lower
case, the lookup ignores case [I] (245 of the 249 non-music LipSync items find their key; the others are 3 sound
effects and one item with an empty path) [D]. The
subtitle belongs to the item: from `start` for `length` [I]. The .lsd (gzip: f32 fps 25, u32 frames, visemes)
drives the mouth (CFaceAnimBuilder; [original/LIP_SYNC.md](original/LIP_SYNC.md)): each phoneme is a layer turning the jaw towards a frame
of the characters' `faceanim` clip by Data/Base/Sequences/Setup.ini (LipSyncSetup: phonemes -> frames 1-13, Blink 14,
Frown 15, expressions 16-19); the shipped clip has two frames, so only frame 1 (IY, IH, h, y) is ever drawn. LipSync items whose lsd lies in `SeqSounds/music/` (`NS_<id>.lsd`) are the
music track (77 items in 76 files) - they play the same way and have no subtitle.

### 9.7 Fades, widescreen, cuts, day time
Fading / WideScreen as in §5 (direction / bars over the item length). The client also fades out before loading and
in after (FadeOut/FadeInDuration). ItemCut skips its time range.

Global items run on 25 Hz frames (0x52a730): an item is started on frame round(start · 25), updated on each
following frame up to round((start + length) · 25) - 1 and stopped then; on the first tick of a play every item
before the played `start` is still started, updated and stopped once (so its day time applies) [C].

ItemCamFX (0x508660) [E], on the current cut's view camera (eye E, target T, up U = (0, 0, 1)), every frame while
`0 <= tl = t - start <= length` and `mode` is 0 (any other mode: no effect; all 59 shipped items have mode 0): for
k = 0, 1, 2 with bit k of `axis_mask`, a = amplitude (· (1 - tl / length) when `flag`: a linear fade-out),
v = a · sin(tl · frequency) (radians: frequency in rad/s), axis = normalize of [(T - E) × U, U, T - E][k] (side,
world up, view direction), E += v · axis and T += v · axis. Amplitudes are metres. The offset is added to the camera
rebuilt each frame (no accumulation). 57 items shake only vertically (mask 2), 0.03 .. 1 m.

ItemDayTime (0x50a8d0 / 0x50a930) [C]: its start sets the clock to `time_of_day` and switches the weather off (draw
off, intensity 0), then for type != 0 on with that type (1 snow, 2 rain) and intensity / 100; each update sets the
time again, so it is held for the item's length; afterwards the clock runs on from there (144 game s per s). Stop
does nothing and the sequence's end restores neither; the server's time messages are ignored during the sequence
and accepted again afterwards [C], which would put the client back on the server's time [I]. All 20 shipped items
are type 0 (they clear rain and snow). The sequence-level `day_time` is only started on a timeline rewind (the
editor), not in a game [C]; its data is editor-like (weather off, one garbage time) [D]. The remake holds the
scene's time over the paused world's and takes it off at the end.

### 9.8 End
When the played part (`start`..`end`) is over, the client (0x501820): `OnSequenceEnd` to the music manager,
restores its clock flag, syncs the actors (§9.3), restores the camera (snap_cam_back: a camera record kept by the
sequence object, 0x501a9a [I: the view at the start]; else `camera_data` -> Game.usl:1835-1853); showing the hidden
region objects again and the end report to the server were not traced [I].
Server 0x465bd0: clears the flag (the world runs again), script event `Evt_OnSequenceEnd` (-> `SQEN` conditions),
level-info calls 0x4140f0 / 0x4148f0 (fog of war [I]), a message to the client, then the next queued sequence [S]. `quit` -> GameOver Campaign Win (Game.usl:1854).

## 10. Open points

* `vec_b0` (+0xb0, two files non-zero), flag bits 0 and 1 of +0x7c, `audio_mode` 1 vs 2 beyond the speech switch.
* ItemBmp `params`, ItemText `p40/p44/p48` and the screen unit of `x`/`y`; what ItemCamFX `mode` != 0 was meant for.
* ItemFlags `state` values (0 / 1 / 2 = default / on / off?) and `mask2`; ItemLink `op` values; actor `state`
  fields p20, p30, p34, `p534`; the camera object's u32s.
* ItemVisPath interpolation (linear / slerp assumed).
* What the camera shows before the first cut, and whether the player can skip (the scripts' Escape / Space
  accelerators are commented out, Game.usl:1818-1824; a native skip was not looked for).
* Whether temporary actor objects are deleted at the end (expected); when the server next sends its time.
* Old file versions (sequence < 9, actor blocks < 13, items 0 / older) are decoded only as far as the branches
  were needed; no shipped file uses them.
