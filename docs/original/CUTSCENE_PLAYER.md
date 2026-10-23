# Cutscenes: how the client plays them (details)

[SEQUENCE_FORMAT.md](../SEQUENCE_FORMAT.md) describes the `.seq` format and how the game plays a sequence. This file
adds the details of the client's player that are not there: the order of work in a frame, the 25 Hz item clock, the
camera shake and spline code, the day-time item, the server's walk calculation, and what the shipped sequences contain.
Lip sync has its own file: [LIP_SYNC.md](LIP_SYNC.md).

Addresses are PWClient.exe unless "PWServer" is written (image base 0x400000). Tags: **[C]** read in the code, **[E]**
read in the code and checked by running the client's own function in an emulator against the formula on random
inputs, **[D]** the 105 `.seq` files (104 Base + one Polish copy), **[I]** inferred.

## 1. The three kinds of story scenes

| kind | started by | file | what it is |
|---|---|---|---|
| dialogue scene | trigger action `DGSC scene=` (end: condition `DSEN`) | `Data/Base/DialogScenes/<campaign>/<mission>/[mentor/]ds_*.dlg` (property tree: Actors, Frames {actor, audio}) | voice and text shown through the news ticker (`DialogScene.usl`: its own window is invisible, `NewsTicker` `PushDialogScene`); the voice is the sound event `ds_*` of `Scripts/Server/init/dialogsounds.txt` → `Audio/SeqSounds/Level_<n>/<scene>_<Actor>_<nn>.mp3`. No camera, no animation |
| in-engine sequence | `SQNZ sequence= reason quit snap_cam_back camera_data snap_actors_back disable_fow fow_pos fow_radius` (ActionFactory.usl:1976-2050 → `CSrvWrap.StartSequence(CSequenceInfo)`); end: condition `SQEN` | `Data/Base/Sequences/<campaign>/<mission>/sc_*.seq` (and `8043.seq`) | the real cutscenes, played by the client's native sequencer (`Urs.Client.Sequence`, `SeqCamera`, `CSeqTrackCtrl`) |
| film | the same `SQNZ` | `ms_*.seq`, `fade_in_*.seq` (326-595 bytes) | a timeline whose only item is a Bink film (`hs_*.bik`, from `Data/locale/<lang>/Video`) or a fade |

Game side (`Scripts/Game/Game.usl:1813-1855`): `Evt_OnSequenceStart` → the main controller is switched off (no player
input), the camera controller `EnterSequence`, music switch "Sequence" (`MusicMgr` `OnSequenceStart` plays the
sequence's sound track), the history and quest windows and the menu are blocked (`IngameScreen.usl:438, 791, 955`),
idle animations are off (`IdleAnimMgr:324-394`). `Evt_OnSequenceEnd`: `LeaveSequence`; when `camera_data` is not empty
the camera is reset to the level's `DefaultCamera` angle and aimed at `camera_data`; `quit` → the campaign mission is
won. Options: `Game/GraphicOptions/ShowSequenceSubTitles` (default on), `Game/Sequence/FadeInDuration` /
`FadeOutDuration`. Client strings of the screen filters: `CFXSeqFilterWideScreen`, `Fade`, `Bitmap`, `SubTitle`
(`FONT_SubTitle`, `COL_SubTitleText`), `"SubTitleOverlay:"`.

## 2. What the shipped sequences contain [D]

* Inside the gzip a file starts `u32 0` (ignored by the loader), `u32 20` (version), `u32 1` + `u8 0` (the empty name
  string), then the f64 timeline length, start and end.
* Every timeline item starts with `u32 type, u32 version (1), GUID (16), f32 start s, f32 length s, char[4] tag`. The
  tag is the editor's row name: `Cam1`..`Cam4`, `Cut`, `Evt1`, `Snd3`, `Prt2`, `LipS`, `Bink`, `def`, `AEvt`, `Head` ...
* Sounds name paths below `Audio`: footsteps (`Sound/04_step/step_unit2.wav`), scene sounds
  (`Sound/99_sequences/seq_2010_hu_angry.wav`), ambience loops. Particles name effect classes (`Particle/FX/Blood/...`).
* Of the 104 Base files 78 have actors and 76 have camera objects. They use 113 different animation names:
  `seq_talk_01..14`, `seq_talk_stand_00x_anim`, `seq_standanim`, `all_look_left/right`, `all_talk_N`, `point`,
  `affirming_*`, `talking_N`, one-off `NS<id>_*` animations, and object animations (the gate machine, the telescope
  tower ...). These clips are in `all_characters.gsf`.
* Actors carry attachments such as `HndR` → `cole_machete`, `HndL` → `cole_machete_lefthand`, `stina_whip`.
* Localised copies: `Data/locale/<lang>/Sequences/...` (the Polish `sc_2010.seq` differs in 80,000 bytes: the timing of
  that language's speech) and `Data/locale/<lang>/Audio/SeqSounds/...`; `Data/Info/Locale_<LANG>.info` puts them over
  `data/base` (`tryfilereplace`). With the English pack (`uk`) the Base files are the ones used.

### Subtitles in the data

The subtitles are the LipSync items: the key is `"_seq_"` + the `.lsd` file name without `.lsd` (0x5110fd), looked up
in `Data/locale/<lang>/Texts/sequences_<lang>.ltf`. Of the 248 LipSync items in the 111 sequences the triggers name,
245 find their key; the 3 without are sound effects (`2049_sfx_explosion_small`, `seq_3033_boat_landing`,
`seq_3025_explosion_bridge`).

The `.lsd` names often do not follow the sequence's file name, so the text table cannot be matched by the file name:
`sc_2583a/b/c` speak `_seq_2583_kleemann_01` ...; `sc_6050a/b` `_seq_6050_*`; `sc_7030_a..e`
`_seq_single_15_cole_10` ...; `sc_1040` also uses `1039_*`; `sc_1089` `1100_*`; `sc_8005` `8015_*`; `sc_4027`
`4028_*`; `sc_7041` `7040_*`; `sc_7050` / `sc_7052` `single_16_*`, `add_*`, `7053_*`; `sc_0418` `0417_*`; `sc_3012`
`add_*`. The other way round, `sc_0410`, `sc_0412` and `sc_2057` have lines in the text table but no LipSync item. 39
of the 111 sequences have no line under their own number; 22 of those do speak (keys from their lsd names), the rest
(`sc_1058_a/b`, `sc_0326`, `sc_8017`, `8043`, `sc_4080/4080a/4081`, `sc_3080a`, `sc_4009`, `sc_2009`, `sc_1098` ...)
are pure action and camera scenes.

### Sequences that leave units where they end

A sequence started without `snap_actors_back` leaves its actors at their end positions (SEQUENCE_FORMAT.md §9.3).
Of the 17 missions' `SQNZ` actions without `snap_actors_back = 1` whose sequence moves units by more than 4 m:

| mission | sequence | effect |
|---|---|---|
| 0 | `sc_0103` (Ada, a worker) | the designers move both with `SetPos` afterwards |
| 1 | `sc_1040` | the four freed spearmen walk to Stina and stay there (below) |
| 3, 8, 10, 15 | `sc_2010`, `sc_3012`, `sc_3090`, `sc_7041` | each ends the mission (`quit = 1`, or `SQEN` → `QUIT`), so the end positions do not matter |
| 11 | `sc_4009` | the T-rex actors exist only in the sequence (no map object) |

Mission 1 "Stranded": Cole frees the four prisoner spearmen `hu_spearman_14..17` (player 3 → player 0, trigger
`player_0_in_ready`, `OCPY`). At the region `stina_start`, GC02 → GC03 starts S02 = `sc_1040.seq` without
`snap_actors_back`. In it the spearmen walk from (384..388, 499..504) down past the rocks to Stina and end at
`hu_spearman_16` (405.6, 546.6), `_14` (404.8, 544.0), `_17` (403.7, 538.3), `_15` (404.0, 540.5) (Stina stands at
406.6, 541.8); Cole and four warriors only step about 14 m forward to y 505-511; a rock rolls to (385.5, 516.8) and
stones fall at (386-397, 516-522) (sound `seq_1040_stonesfall.wav`). After it GC04 makes the rock
`northland_small_rock_02_3` visible and solid (`OBAP` flags = 65), orders the spearmen to attack the Smilodons and
enables the mentor hint H28 ("Stina is going to have to complete this assignment with just her Spearman to help her.
Cole can't get to her in time."). The designers' switched-off backup trigger `Trigger_003` also teleports the spearmen
to (388.1, 527.6). So the scene itself is what moves the spearmen to Stina's side of the rock.

## 3. The client's frame and the 25 Hz item clock [C]

A client frame (0x453be7 .. 0x453d36), in this order:

1. the day clock ticks (0x574650: time of day = (now − base) × speed, then the sky is updated);
2. every camera object evaluates its splines and rebuilds its view camera (0x478e40 → 0x4788a0 → 0x4774b0: view eye =
   eye object position, view target = target object position; the view's up is never written there and stays the
   `CCamera` default (0, 0, 1), constructor 0x6c05c0);
3. the sequence ticks (0x52a320 → 0x52ab60): global items (0x52a730), actors, choice of the cut;
4. the frame is drawn with the current cut's view camera (0x52a470 → 0x6a55c0).

Global item clock 0x52a730(t): `cur = floor(t × 25 + 0.5)`; nothing happens unless cur is past the last processed frame.
For every 25 Hz frame f = last + 1 .. cur and every item with `sf = round(start × 25) ≤ f ≤ ef = round((start +
length) × 25)`: if the item has not started (last < sf): Start (vtable +0x24), then Update (+0x28, t); else if f + 1 ≤ ef:
Update(t); else Stop (+0x2c). Consequences:

* Update gets the same real `t` for every 25 Hz step of one drawn frame (catch-up), and is not called on drawn frames
  where no new 25 Hz frame began.
* On the first tick after Play (Play first seeks to `start` = +0x90, 0x52b030), last = −1, so every item lying wholly
  before the played start is still started, updated and stopped in that tick (e.g. `sc_0410`: an ItemDayTime at 0..1 s,
  the played part starts at 5.16 s - its day time is applied).
* Time going backwards ("rewind": last > cur) starts the sequence-level day time (track +0x10) and resets (+0x20) all
  items. Only the editor does that (dirty flag 0x10 of seq +0x78, set by 0x529da0 only while not playing).

## 4. ItemCamFX - the camera shake (per frame 0x508660) [E]

Fields (serializer 0x508bd0, constructor 0x509da0): +0x30 `mode` u32, +0x34 `axis_mask` u32, three `shake[k]` at
+0x38 / +0x44 / +0x50 = {f32 amplitude, f32 frequency, u8 flag} (0x509f60). Constructor defaults: mode 0, mask 3, each
axis {1.0, 10.0, flag 1}. The editor's presets (vertical only, flag 0): Preset1 {0.15, 12}, Preset2 {0.1, 22},
Preset3 {0.3, 5}.

```
cam = view camera of the current cut (0x52a470)        // eye E, target T, up U = (0,0,1)
tl  = t - item.start
if tl < 0 or tl > item.length: return
if item.mode != 0: return                              // any other mode: no effect at all (0x5086ae)
u = tl / item.length
for k in 0, 1, 2:
    if not (axis_mask >> k) & 1: continue
    a = shake[k].amplitude
    if shake[k].flag: a = a * (1 - u)                  // linear fade to 0 at the item's end; no fade-in
    v = a * sin(tl * shake[k].frequency)               // radians: frequency in rad/s (10 = 1.59 Hz)
    D = T - E
    axis = normalize([cross(D, U), U, D][k])           // a zero vector stays zero (0x409710)
    E += v * axis;  T += v * axis                      // eye AND target move: the view direction stays
```

* Axis 0 = the horizontal side axis normalize(D × up) = normalize((D.y, −D.x, 0)) in map coordinates (x east, y south,
  z up): with the camera looking north (D = (0, −1, 0)) it is (−1, 0, 0) = west = screen left. Axis 1 = world up,
  axis 2 = the view direction. All in world space; amplitudes are metres.
* The offset is added to the view camera rebuilt each frame, so it does not accumulate - but it is applied once per
  25 Hz step: at 60 frames per second the shake shows on about 25 drawn frames a second (the others show the unshaken
  camera), and a drawn frame that crosses k steps gets k × v.
* Update runs on the 25 Hz frames sf .. ef − 1; Stop (0x508980) does nothing.
* Data: 59 items, all mode 0; axis mask 2 (vertical only) in 57, mask 7 in two (`sc_6105`: {0.25, 5, 1} on all axes).
  Vertical amplitude 0.03 .. 1.0 m, frequency 0.8 .. 50 rad/s, flag 1 in 45 items, flag 0 in 14.

## 5. Camera splines (SeqCamera and the camera object)

Key in memory: +0 u16 frame, +4 interp, +8 tcb[3], +0x14 ease[3], +0x20 value (vec3: 44 bytes a key, quaternion 48,
f32 fov 36). Key time = spline start + frame / 50; spline start = the sequence's start clock (0x522450 → 0x43b200), so
key times are timeline seconds.

Segment search (position 0x43b980, rotation 0x43ba70, fov 0x43bb60) [E]: `t == start` → the value of key 0; otherwise
the first i with `t(i−1) < t ≤ t(i)` (t(−1) = spline start); i == 0 → key 0's value (held before the first key); t past
the last key → "not found", and the camera code (0x4788a0, t ≥ spline end = start + last key time) sets the **last**
key's value (0x4380a0 position, 0x4380e0 rotation, 0x438120 fov). The formulas per interpolation type are in
SEQUENCE_FORMAT.md §7; the cardinal types write 0.5 into key i's tcb[0] before use (type 4), type 9 is the constant type
the loader gives an automatic key.

Missing tracks [C]: SeqCamera 0x522450 gives an empty position / rotation / fov track one key (time 0, interp 9 =
constant) holding the SeqCamera's own (editor) position / rotation / fov. In every file the editor position and
rotation equal the eye object's when a track is empty [D].

Data [D] (105 files, 762 cameras, 179 with neither position nor rotation keys):

| track | keys by interp | segments (keys i ≥ 1) by interp |
|---|---|---|
| position | 4: 875, 8: 78, 5: 37, 1: 54, 3: 1 | 4: 384, 8: 51, 5: 22, 1: 31, 3: 1 |
| rotation | 4: 864, 5: 69, 1: 43 | 4: 385, 5: 39, 1: 20 |
| fov | 1: 182, 4: 7, 5: 2 | 1: 47, 4: 5, 5: 1 |

`ease` is (0, 0, 0) or (1, 1, 0) only: not zero in 174 position, 116 rotation and 9 fov keys (it matters only on
position keys of type 8). Type-8 position keys (33 files: the tutorial and missions 1-16): tcb (0, 0, 0) + ease (1, 1,
0) in 65 of 78 (flat tangents at the key: the camera eases in and out), tcb (0.5, 0.5, 0) + ease (1, 1, 0) in 11
(Catmull-Rom), tcb (0, 1, 0) + ease 0 in 2. The usual tcb is (0.5, 0.5, 0); tcb[0] = 0 appears on type 5 keys (flat).
SQUAD (rotation type 7) and slerp (type 6) are not used by any file.

## 6. ItemDayTime (vtable 0x85b228)

Fields: +0x30 `time_of_day` f32 (seconds after midnight), +0x34 weather type, +0x38 intensity %, +0x3c draw (u8).
The constructor 0x50aaf0 takes the current clock time, type 0, intensity 25, draw 1.

Start 0x50a8d0 [C]:

```
DayClock.SetTime(time_of_day)      // 0x5742f0: tod (+0x28) = T; base (+0x10) = now - T / speed (+0x18)
Weather.Draw(false)                // 0x4f7ce0 -> 0x7220a0 (the WeatherManager's "Draw" also needs the ini option)
Weather.Intensity(0)               // 0x4f7d40 -> +0x40 = 0
if type != 0:
    Weather.Draw(draw); Weather.Type(type)   // +0x24; 1 snow, 2 rain
    Weather.Intensity(intensity / 100)
```

So type 0 does not leave the weather alone: it switches rain and snow off. All 20 shipped items are type 0 /
intensity 25 / draw 1.

Update 0x50a930 (each 25 Hz step while active) calls `DayClock.SetTime(time_of_day)` again: the time of day is held for
the item's length (the clock tick at the top of the next frame adds one frame of dt × speed before it is reset; the sky
is drawn after the reset, 0x48e280 reads +0x28). Stop (+0x2c) and slot +0x34 do nothing (0x7d1f80 `ret 4`): nothing is
saved or restored. Afterwards the clock runs on from `time_of_day` at its normal speed: tod = (now − base) × speed, speed
144 game seconds per real second by default (a day of 86400 s = 10 real minutes; defaults at 0x574610), values the
server may change through its time message; ticked every client frame while the global timer factor is > 0 (0x574650).

At the end of the sequence (0x501820 / 0x52a970) there is no SetTime and no weather call: the earlier time of day and
weather are **not** restored by the sequence. (Play 0x52b030 saves the time of day before its seek to `start` and puts
it back afterwards, only because the seek moves the global clock - before any item runs.) The server's time message
(type 9 → 0x5744e0, which rewrites the clock's base and speed and the global timer) is ignored during the sequence
(app +0x2eae0, 0x454f53) and accepted again afterwards; since the server's world and clock were paused, the next such
message would put the client back on the server's time of day [I: when the server sends it was not traced].

The sequence-level `day_time` (the extra ItemDayTime after the item list, track +0x10) is started only on a rewind
(0x52a77a), i.e. in the editor; a normal play only moves forward from frame −1 and never applies it [C for the play
path; I that nothing sets the dirty flag at load]. The data agrees: all 104 are weather type 1 / intensity 0 / draw off
with editor-like times, one has a garbage time (1.6e12).

## 7. Walks: the server's calculation (PWServer.exe)

`ItemWalkAct` items are not stored as finished motion; the server computes them when the sequence loads
(SEQUENCE_FORMAT.md §9.4). Details:

* Flag bit 1 (`walk_flag`) → walk action +0x41 → 0x48dd70 argument 4 → 0x48beb0 argument 5 → 0x48a120 argument 4 →
  0x489fc0 per waypoint: z = terrain height (0x8dde00); objects with flag 0x10000 at least at the water level. At the end
  of 0x48beb0 (0x48d7f3) motion flag 0x10 (object +0x1c8) makes the client's path unpacking (VisualisationPath.cpp,
  0x7ada26) take every key's z from the terrain (0x20: at least the water level); z is then not packed (0x7ad9d5) [C].
  No path finding and no collisions [C].
* The controller field +0x2b0 comes from 0x48dd70's 8th argument (1 from every walk action: 0x4a3c82, 0x4a3d50,
  0x49ed2a, 0x4a4eb3; only 0x40da35 may pass 0), read at 0x48c338 / 0x48cf63 and cleared for the flags 0x8000 + 0x10000.
  It adds, after the last segment, a stop clip among E<n> and `end_s` / `end_m` / `end_l` (codes 20-31) whose stopping
  distance (animation speed × frames / 25) fits the rest best (0x48d1c7-0x48d688), then a final key [C].
* `CSeqEdActCalculator` walk: 0x4a3180(obj, path, speed level, walk set, walk_flag, 0); speed factor 1.0 for every
  waypoint (0x46511c); +0x40 = 0: no path finder (a single-target walk, 0x4a3070, sets +0x40 = 1 → 0x4a2d70) [C]. Start,
  then 3 × Tick + path finder step 0x4583c0, which needs state +0x28 == 2; the motion is built at once in 0x48beb0
  (position keys + animation queue 0x48e080, 25 fps) [C]. No movement per frame and no collision with units was found [I].
* Gaits: +0x288 requested speed level, +0x290 current, +0x28c = from × 5 + to, an index into `walkanimconfig.txt`'s 5 × 5
  table; animation codes (0x48a7d0): Id 0, S1-4 1-4, E1-4 5-8, L1-4 9-12, T12 / T23 / T34 13-15, T21 / T32 / T43 16-18.
  The level speeds are hard-coded at 0x489a90: 1.5, 5, 7, 10 m/s; a segment's time ≈ distance / (level speed × factor)
  (0x48ce96) [I].
* The temporary object is created at 0x44a7d0 and placed at the first waypoint (0x4a9ac0), without a turn [C].
* On failure ("walk action faild" / "WalkAction incomplete") the action and the object are deleted and nothing is sent
  back [C]; only the success branch replies (0x46528e).
* Client, on the reply (0x51d600): with bit 0 the stored keys are replaced by the path's first and last key; otherwise
  each stored waypoint key is re-timed to the moment (in 0.04 s steps) the path passes closest in x, y; the path goes to
  +0xc8, the animations to +0xa0 / +0xc0; the item's length = max(end of path, end of animations) [C]. Without a reply
  +0xc8 stays empty and no fallback was found [I].
* The trigger walk's `straightwalk` (ActionFactory.usl:1811 → StartPatrol → FightingObj.usl:2414) only sets
  `m_bAggressionWalk = !straight`; the `GoTo` is the same [C].
