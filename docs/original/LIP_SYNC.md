# Lip sync and face animation in cutscenes

How the cutscene player moves the speakers' mouths. Read in `bin/PWClient.exe` (image base 0x400000), checked on every
`.gsf` archive (76 archives: Base, BoosterPack1, BoosterPack3, MIRAGE, Wintermod, locale copies),
`Data/Base/Sequences/Setup.ini` (823 bytes) and the sample `Data/Base/Audio/SeqSounds/Level_1/1040/1040_Cole_01.lsd`
("Stina? You okay?"). The rest of the cutscene format: [SEQUENCE_FORMAT.md](../SEQUENCE_FORMAT.md) (item type 5,
ItemLipSync) and [CUTSCENE_PLAYER.md](CUTSCENE_PLAYER.md).

Tags: **[C]** read in the code, **[D]** checked on the data, **[I]** inference.

## 1. In short

* Lip sync drives **one bone, the jaw**, through additive animation layers. There are no morph targets, no texture
  swap and no clip per viseme. The poses are the frames of the GSF clip **`faceanim`**. "ImageAnimMap" is only the old
  name of the per-actor phoneme-to-frame table (`LipSyncDesc`) [C].
* `Setup.ini` (node `LipSyncSetup`) assumes a `faceanim` of **20 frames**: phonemes on frames 0..13, Blink 14,
  Frown 15, Happy / Sad / Angry / Amazed 16..19. **Every shipped `faceanim` has 2 frames** [D].
* The client **drops any layer whose frame is ≥ the clip's frame count**. It does not clamp, wrap or read garbage: the
  layer packer skips it (0x6e60b4-0x6e60ba: `if (slot.frame >= slot.nframes) skip`; the same at 0x6ed114-0x6ed11e) [C].
* **So the game shows** only the phonemes on frame 1 (**IY, IH, h, y**) moving the jaw. They add up to +4.8° × (sum of
  their weights) about the jaw's local z: a small upward (closing) twitch. Frame 0 (`'x'` = id 0) is the identity
  pose and shows nothing. Frames 2..13 (every other phoneme), Blink (14), Frown (15) and the expressions (16..19) are
  built and keyed, then **never drawn**. Lip sync in the original is almost invisible; the mouth mostly holds the
  body clip's jaw angle (about −12° in most clips, −15° in `seq_talk_*`) [C/D/I].

## 2. Where the data is

| what | where | evidence |
|---|---|---|
| jaw poses | GSF clip `faceanim` of each model (an entry of the model's animation table, 12 bytes) | name lookup 0x4fb9f7 / 0x510a11; entry = model resource +0x4c (self-relative) + idx × 12 (0x4fbab0) [C] |
| `faceanim` content | chunk 0x40000005, 2 frames, flags 0x80000004, helper bone byte (+24) = 18, root layout (+25) = 2 (quaternion only), no track tree. Frame 0 = identity, frame 1 = q(−0.0017, −0.0007, 0.0419, 0.9991) = 4.8° about local z | [D] |
| which models | **230** models of `all_characters.gsf` (identical in Base, BoosterPack3, MIRAGE, Wintermod). 229 hold the clip in chunk slot 0, `hu_marksman_s3` in slot 1. All share one 2-frame chunk and the same 47-bone biped (depth-first bone 18 = guid 0x8924f02c = the jaw). No other archive has a clip whose name contains face, blink or lip | [D] |
| speech timing | `.lsd` (gzip), path in the ItemLipSync item | §3 |
| phoneme → frame, expressions, random blinks | property tree `Root/LipSyncSetup` in `/Data/Base/Sequences/Setup.ini`, loaded into sequence +0xc0 | loader 0x52b2e0, actor constructor 0x50032a → parser 0x7ad2c0 [C] |

Jaw geometry (`cole_s0`) [D]: front = +y (`HndL` at +x, `HndR` at −x, so +x = the model's left). At rest the lower
lip (z 3.792) is 0.019 below the upper lip (z 3.811); both rows use texture row v = 0.227. Frame 1 lifts the chin by
0.026, which closes the lips. Body clips: about −12° (chin 0.058 lower), screams (`react_*_fm`) down to −50°. So a
negative angle opens the mouth, and frame 1 = "lips shut".

## 3. The .lsd format (exact) [C 0x510c30 / 0x7ab6c0 / 0x7ab4a0 / 0x7a9f30, D]

gzip of:

```
f32  fps            (25.0)
u32  n_records
n_records × { u32 frame, u32 n, n × { u32 phoneme_id, f32 weight } }
```

* Records are sparse (silent frames are left out); the weights of one record add up to ≤ 1; entries with weight 0 mark
  the end of a fade.
* Key time = item start + frame / fps (0x7aaf79). The item's length = last frame / **25.0** (hard-coded, 0x510d41).
* Phoneme ids (name table 0x7acc70; an unknown name, e.g. Setup.ini's `'x'`, maps to 0 = silence):

| id | ph | id | ph | id | ph | id | ph |
|---|---|---|---|---|---|---|---|
| 0 | (silence / unknown) | 10 | EY | 20 | m | 30 | t |
| 1 | IY | 11 | AY | 21 | n | 31 | k |
| 2 | IH | 12 | OY | 22 | NG | 32 | z |
| 3 | EH | 13 | AW | 23 | CH | 33 | ZH |
| 4 | AE | 14 | OW | 24 | j | 34 | v |
| 5 | AH | 15 | l | 25 | DH | 35 | f |
| 6 | UW | 16 | r | 26 | b | 36 | TH |
| 7 | UH | 17 | y | 27 | d | 37 | s |
| 8 | AA | 18 | w | 28 | g | 38 | SH |
| 9 | AO | 19 | ER | 29 | p | 39 | h |

The speech itself is the `.mp3` with the same name next to the `.lsd`; the subtitle key is `"_seq_"` + the file name
without `.lsd` ([SEQUENCE_FORMAT.md](../SEQUENCE_FORMAT.md) §9.6).

## 4. LipSyncDesc and the shipped Setup.ini

LipSyncDesc (actor +0x384; constructor 0x500f40, parser 0x7ad2c0):

* `+0x000` 40 × {i32 frame = −1, f32 = 1.0}, one per phoneme id.
* `+0x140` 9 × {i32 frame, f32 strength}: Happy 0, Sad 1, Angry 2, Amazed 3, FaceExpr1..5 4..8 (Norm = −1). The value is
  written `"<frame>[,<strength>]"` (0x7ad150); strength 1.0 when left out.
* `+0x188` Timing {BlendRangeMin, BlendRangeNorm, Step} (defaults 0.2 / 0.35 / 0.1; each must be ≥ 0.01, 0x7a96d0).
  The node sits inside `Expressions`.
* `+0x194` randoms, 32 bytes each: {name, i32 Frame, f32 BlendStr, u32 AllowedExpr, f32 BlendIn, f32 BlendOut, f32
  DistMin, f32 DistMax}. AllowedExpr has bit (e & 31) per expression, so Norm (−1) = bit 31 (0x7adaca). A random is
  valid (0x7a9710) if Frame ≥ 0, BlendStr ≥ 0.01, BlendIn and BlendOut ≥ 0.01, DistMin and DistMax ≥ 0.1, DistMax ≥
  DistMin and the mask is not 0.

The shipped `Setup.ini` (`Root/LipSyncSetup`) resolved to ids:

| frame | phonemes (ids) | drawn with the 2-frame clip? |
|---|---|---|
| 0 | `x` → 0 (silence) | yes, but the identity pose (no visible effect) |
| 1 | IY 1, IH 2, h 39, y 17 | **yes: jaw +4.8° × w** |
| 2 | EH 3, AE 4, EY 10, AY 11 | no (skipped) |
| 3 | AH 5, AA 8, AO 9 | no |
| 4 | UH 7, UW 6 | no |
| 5 | AW 13 | no |
| 6 | OY 12, OW 14, SH 38 | no |
| 7 | w 18 | no |
| 8 | m 20 | no |
| 9 | b 26, p 29 | no |
| 10 | v 34, f 35 | no |
| 11 | r 16, ER 19, n 21, NG 22, g 28, k 31, l 15 | no |
| 12 | CH 23, z 32, ZH 33, TH 36, s 37, j 24 | no |
| 13 | DH 25, t 30, d 27 | no |
| 14 | random **Blink**: BlendStr 1, BlendIn 0.08, BlendOut 0.12, gap 0.5..2.0 s, allowed Norm / Happy / Amazed | no |
| 15 | random **Frown**: BlendStr 1, BlendIn 0.1, BlendOut 0.2, gap 1.0..3.0 s, allowed Norm / Happy | no |
| 16..19 | Happy, Sad, Angry, Amazed (strength 1.0); Timing 0.2 / 0.35 / 0.1 | no (and no Base sequence has an ItemFaceExpr) |

All 40 ids (0..39) are mapped exactly once. If an id were listed twice, the parser would keep the last mapping
(0x7ad429).

## 5. Building the layers (CFaceAnimBuilder, actor +0x52c = {desc, analyzer = actor +0x520})

Analyzer (vtable 0x8591b8): vf1 = sequence start (seq +0x80), vf2 = sequence length (seq +0xa8; 0 → nothing is built),
vf3 `GetExpressionAt(t)` (0x4fb120) = the `expression` (+0x30) of the first ItemFaceExpr (item type 9) of the actor
with start ≤ t ≤ start + length, else **−1 = Norm**.

Face controller = animinfo +0x10 (animinfo = gfx object +0x260). Tracks are 36 bytes (0x7aa020): first and last frame =
the desc frame, fps 25, play mode 1, and a weight curve {mode 0 = linear; keys {f32 t, f32 w}}; the curve holds its first
/ last value outside the keys (0x69e0d0). For each track 0x6c6980 adds a 24-byte slot to animinfo +4: {+0 the clip's
per-chunk animation pointers, +8 **nframes = least common multiple of the clip's chunk frame counts (0x6c50f0) = 2**,
+0xc frame, +0x10 flags, +0x14 weight}. 0x6c6980 checks only that the clip entry exists and is not empty, **not the
frame range** [C].

* **BuildLipSync** 0x7aadb0 (per ItemLipSync, 0x510afc): one track per phoneme with a frame ≠ −1. Each entry of an lsd
  record gives a key (item start + frame / fps, w).
* **BuildExpressions** 0x7aa950 (from CalcFaceAnims 0x4fb9f0, run by the actor's set-state 0x4fe410): one track per
  expression with a frame ≠ −1. It samples GetExpressionAt every Step seconds over the sequence; on a change it ramps the
  old expression from its strength to 0 and the new one from 0 to its strength, over BlendRangeMin / BlendRangeNorm. If
  the expression is always Norm, nothing changes and no keys are written.
* **BuildRandoms** 0x7aaff0 (also from CalcFaceAnims): per valid random, t = DistMin + U × (DistMax − DistMin). While t <
  sequence length: if bit(GetExpressionAt(seq start + t)) is in AllowedExpr, keys (max(t − BlendIn, 0), 0),
  (t, BlendStr), (t + BlendOut, 0). Then t += DistMin + U × (DistMax − DistMin), allowed or not. U in [0, 1) comes from
  the client's global Mersenne Twister (object 0x8e0ea8, 0x432c60, two draws → float mantissa), shared with other
  client randomness, so the schedule cannot be reproduced exactly.

## 6. Each frame [C]

1. 0x7aa860 → 0x7a9ad0: for each track w = curve(t). The slot is active if w > 0.005; slot.frame = the track's frame
   (0x7a97b0 returns offset 0 for a 1-frame range). Out-of-range frames are not clamped here.
2. Layer packing 0x6e6090 (and 0x6ed0f0): for each active slot, **skip it if w ≤ 0.01 or frame ≥ nframes**; otherwise
   append {clip chunk, w, frame, flags} to the pose job (+0x4038, count +0x4034), **at most 8 layers**. Skipped slots do
   not use up a layer.
3. Pose 0x75ca2a+: for the bone the layer's helper track drives (depth-first 18), L = that layer's quaternion at
   `frame`, L^w = slerp(identity, L, w) (0x759940), and the bone's current track rotation becomes C ⊗ L^w (Hamilton,
   0x75cb02-0x75cbdd; C = the body clip's jaw track value, or the identity). It is then composed with the rest pose as
   usual. Several layers chain; all turn about the same axis, so the angle is 4.8° × (sum of the active frame-1
   weights).

On the sample: IY rises to 0.87 (frames 4-6) and again to 0.90 (frames 37-38), y reaches 0.45 (frames 23-25), so the jaw
lifts by up to about 4° on "Sti-", "you" and "-kay". All other sounds and the blinks give nothing. The last record
leaves IY at 0.207 and the curve holds it, so the jaw stays lifted by about 1° after the line until the next keys.

## 7. Reproducing it

* At load, per actor that has `faceanim` (nframes = 2): expression tracks (always Norm in the shipped sequences, so
  none), random tracks as in BuildRandoms (any random generator will do), and lip-sync tracks from the lsd records
  (only phonemes the Setup.ini maps).
* Per frame at sequence time t: w of every track by linear interpolation of its keys, holding the end values; keep the
  tracks with w > 0.01 **and** frame < nframes, at most 8, in creation order; after the body animation has set the
  jaw's track rotation C, C ← C ⊗ slerp(I, faceanim[frame], w) for each kept track; then compose with the rest pose.
  With the shipped data only frame 1 (IY, IH, h, y) does anything.
* The designers evidently meant a 20-frame face clip (0 rest, 1-13 visemes, 14 blink, 15 frown, 16-19 expressions)
  [I]. Only frames 0 and 1 exist; anything more needs new poses (jaw angles per viseme frame, and eyelid / brow bones
  the skeleton does not have).

## 8. Open points

* The exact choice between BlendRangeMin and BlendRangeNorm in BuildExpressions (0x7aabd5-0x7aad3d); the shipped data
  does not use it.
* The multiply order of the layer against the rest pose after 0x75c87d (irrelevant for a rotation about the jaw axis).
* The bone name of guid 0x8924f02c (common names did not match its CRC-32).
* `Sequences/first_sequence.sif` and `sequence_1090.sif` (found next to Setup.ini) were not looked at.
