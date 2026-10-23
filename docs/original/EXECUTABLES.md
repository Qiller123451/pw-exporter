# PWServer.exe and PWClient.exe: findings from the program code

ParaWorld runs as two programs in `bin/`: `PWServer.exe` (the simulation; it runs the server scripts
`Data/Base/Scripts/Server` and the computer player `Data/Base/Scripts/Ai`) and `PWClient.exe` (drawing, sound, the
interface and its scripts `Data/Base/Scripts/Game`, the cutscene player). Much of what the game does is native code
that the scripts only call. This file collects what was read in the two programs and points to the documents that
describe each subsystem in full.

Addresses are virtual addresses with the image base 0x400000. "(C)" marks a PWClient.exe address; addresses without
a mark are PWServer.exe. Tags used across these documents: **[C]** read in the code, **[E]** read in the code and
checked by running the program's own function in an x86 emulator (unicorn) against the formula, **[D]** seen in the
data, **[I]** inferred.

## The files

| | PWServer.exe | PWClient.exe |
|---|---|---|
| size | 7,634,944 bytes | |
| image base | 0x400000 | 0x400000 |
| .rdata | VA 0x9dd000 = file offset 0x5dd000 | VA 0x83a000 = file offset 0x43a000 |
| .data | VA 0xae3000 = file offset 0x6e3000 | |

Tools that worked: Ghidra 11.4.2 (headless decompilation), capstone, `objdump -d -M intel` (binutils reads the
PE files as pei-i386), unicorn to run single functions.

Code shared by both programs:

* The WallMap (`URS.Shared.WallMap`, string 0xa897b0) is byte-identical in both: **client address = server address −
  0x25b640** for the whole range 0x7dc000–0x7e3000 ([walls_engine.md](../../remake/docs/spec/walls_engine.md)).
* The 32 forest layouts (32 × 624 bytes) are the same table in both programs (server copy at 0xaf8808).
* Client class names are the strings `Urs.Client.<name>` that follow each class's vtable in .rdata.

## How script classes are bound to native code

The script language (USL, "UrsRel Script") calls native classes through glue objects.

* Name table: an array of `char*` at 0xae7898 (1124 entries; entry 549 = `"CAiInterface"`).
* Registration 0x4846f0: per USL class a 0x40-byte glue object with its own vtable, registered by
  0x855cf0(vm, obj, descriptor).
* Descriptor = a token stream: if `byte & 1`, value = (u16 little endian) >> 1 (two bytes), else value = byte >> 1;
  name index = value / 2.
* Glue vtable slot 1 = the dispatcher, a `switch(method)` with the methods numbered from 3 **in alphabetical order**.
  The VM's argument stack has its base at `[esi+0x3c]` and its top at `[esi+0x40]`; arguments are in reverse order (the
  last one on top). 0x83e120 converts a script value to a string.
* The AI classes use a second registration, 0x52b360, with their **own name table at 0xae8ea0** (set as `[vm+0x403c]`).
  In this group glue slot 1 is a stub; slot 3 creates the script object, and the method dispatcher is slot 12 of the
  wrapper's vtable, a `switch(method)` that starts at 0 (0 = constructor, 1 = destructor, then the methods). Example:
  `CAiMineMgr` ([AI_MINE_MANAGER.md](AI_MINE_MANAGER.md)).

### Script VM class groups

Creating a script VM takes a bit mask of native class groups (0x84ad10, (C)0x64cbb0).

| program | VM | mask | where the byte is |
|---|---|---|---|
| PWServer | game | 0xDB | `push` at 0x4320d4 (file offset 0x320D5) |
| PWServer | AI | 0xDB | 0x4dca1f (file offset 0xDCA20) |
| PWClient | | 0xD9 | 0x442126 (file 0x42127) and 0x452a11 (file 0x52A12) |

Bit 0x20 = the USL binding self-tests (`Fred`, `CWrapTest`, `CMaskTest`, `CTestSingleton` ...; names at 0xaf12f4,
registration 0x8b6e80). Bit 0x04 is never set either. Setting 0x20 in the mask byte (0xDB → 0xFB, 0xD9 → 0xF9) makes
the test classes available to the scripts.

## CAiInterface

Descriptor 0x9e33b0, vtable 0x9ea1c4, dispatcher 0x47adc0. Methods (numbers = the dispatcher's case values):

| # | method | # | method |
|---|---|---|---|
| 3 | AddEditRegionEconomy | 14 | PlayerWin |
| 4 | AddEditRegionRessources | 15 | RemRegionEconomy |
| 5 | BlockPyramidSlots | 16 | RemRegionRessources |
| 6 | CallModule | 17 | SetAggressionMode |
| 7 | CheckAIDead | 18 | SetCustomAttack |
| 8 | DumpIslMap | 19 | SetFightModuleAttack |
| 9 | GameOver | 20 | SetModuleBehavior |
| 10 | IsAiPlayer | 21 | SetPyramidPopLimit |
| 11 | LockUnit | 22 | TreeRemoved |
| 12 | OnAiStringEvt | 23 | UnlockUnit |
| 13 | PlayerLose | | |

### SetModuleBehavior(int player, bitset modId, string behavior), 0x402560

1. GetModule 0x401f30: brain = 0x50f6e0(player); modId 0 = control (brain +0x128c), 1 = economy (+0x1290), 2 = fight
   (+0x1294), 3 = area (+0x1298), 4 = defense (+0x129c); any other value → null → returns false.
2. If `behavior` is Mikrobe, Schnecke, Giraffe, Dodo, Turtle or FightOnly, or contains "Singleplayer": the player
   settings entry (0x466c60; slot +0x28 + player × 32, or +0x128 for player < 0) gets the property `type` =
   `"ai_" + behavior` (0x7a05e0).
3. Returns `CAiModule::SetBehavior` 0x4e5e90, which calls script method 0x12 (`SetBehavior`) of the module's USL object
   through 0x84b260 (native virtual vtbl+0x10 when there is no script).

The personalities themselves are script: `Data/Base/Scripts/Ai/Modules/AiModuleControlDefault.usl` `SetBehavior`
(Dodo, Schnecke, Giraffe, Mikrobe = brain `SetPaused(true)`, FightOnly, Turtle, `Singleplayer_L3_1..3` / `_L8_1..2`,
`AIAssist*`; [ai.md](../../remake/docs/spec/ai.md) §2). Passive / defensive / offensive is **not** this function: unit
aggression is `SetAggressionMode` (method 17, trigger `AIAM`: −1 passive, 0 stand ground, 1 defensive, 2 aggressive).

### A bug: SetModuleBehavior writes the wrong player slot

The player settings entries (slots 0..7, 32 bytes each) carry a `headquater` property (read by 0x7a0c80; 0x7a0d20 tests
`type == "invalid"`). The AI manager (loop at 0x4df950) creates the brains by headquarter, so `entry[id]` in step 2
above is the wrong entry when a player's headquarter is not its slot: a human slot can get type `"ai_X"`, and the
server's client check (0x405a3e: a type starting with `"ai_"` is not human) then drops that client.

A patch was written (tested in the emulator only, not in the game): at 0x40260f `call 0x9dcb20; nop; nop`, with a
routine at 0x9dcb20 (padding at the end of .text; .text VirtualSize raised to 0x5dbb70) that picks the valid slot whose
`headquater` equals the id, and otherwise skips the write (`jmp 0x402657`).

## Address index by subsystem

| subsystem | addresses | full description |
|---|---|---|
| WallMap (walls, gates, towers, traps) | CalcWall core 0x7e26c0 / (C)0x587080, FindPath 0x7e0730, Placeable 0x7de030, GateFits 0x7dd600 ... | [walls_engine.md](../../remake/docs/spec/walls_engine.md) §11 |
| forest blocks (server) | `CForestSrvMgr` load 0x410be0 (string "Forest map corrupted!" 0x9dd9d8, used at 0x410e5c); `Frst` reader 0x8dc5e0, writer 0x8db430; constructor 0x8dc720 (copies the layout table from 0xaf8808); layout lookup 0x8db3a0; amount / state getters 0x8db240 / 0x8db270; block creation with the edge factors from 0x8db6f0; GetTreeType 0x410320, GetTreeRotZ 0x41057f, GetTreePos 0x40fcb0; tree count of the forest layer 0x8db7d0 | [MAP_FORMAT.md](../MAP_FORMAT.md) "Frst" |
| forest blocks (client) | block draw (C)0x6f9ee0 (per item: state, height > 16 m, distance LOD, tree or undergrowth); tree model draw (C)0x6f7a80 (rotation −k × 0.785, scale 5.0 × 0.2); undergrowth draw (C)0x6f7e80 | |
| terrain | height 0x8dde00; raw terrain height 0x9031c0; AdaptTerrain (object brushes) 0x8e1830 → material cells 0x8e0570 | [TERRAIN_NOTES.md](../../remake/docs/TERRAIN_NOTES.md) |
| path finder | FindPath 0x9029b0; layer select 0x40e930; layers derived from the base maps by 0x9027d0; map dump names 0x903b65 | [AI_MINE_MANAGER.md](AI_MINE_MANAGER.md) |
| 1-bit cell maps | create 0x8d4090, set 0x8d2f90, copy 0x8d43e0, invert 0x8d36f0, combine 0x8d45f0, grow / erode 0x8d4160, flood 0x8d4850 | [AI_MINE_MANAGER.md](AI_MINE_MANAGER.md) |
| AI interface, script binding | above | |
| AI mine positions | CAiMineMgr dispatcher 0x527dd0, ComputeShore 0x458de0 | [AI_MINE_MANAGER.md](AI_MINE_MANAGER.md) |
| day clock | `CTimeMgr` 0x7bcab0, (C)0x5745f0; client clock tick (C)0x574650, SetTime (C)0x5742f0, defaults (C)0x574610, server time message (C)0x5744e0 | [RENDERING.md](RENDERING.md) |
| sequences (cutscenes) | loader (C)0x530f70, `CSequence::Serialize` (C)0x52d3a0, server start 0x465b10, world update skipped at 0x42d5c3, walk calculator `CSeqEdActCalculator` 0x464ed0 | [SEQUENCE_FORMAT.md](../SEQUENCE_FORMAT.md), [CUTSCENE_PLAYER.md](CUTSCENE_PLAYER.md) |
| lip sync | Setup.ini loader (C)0x52b2e0, LipSyncDesc parser (C)0x7ad2c0, BuildLipSync (C)0x7aadb0, layer packing (C)0x6e6090 | [LIP_SYNC.md](LIP_SYNC.md) |
| particle source 3 | InitPart (C)0x709740, ProcPart (C)0x707e30, Process (C)0x704a10 | [particles.md](../../remake/docs/spec/particles.md) |
| mesh vertex decoding | UV = byte / 255 at (C)0x7369e7-0x736a14, 0x736a50-0x736a89, 0x73d7f5-0x73d831 (1/255 at (C)0x887658) | [GSF_FORMAT.md](../GSF_FORMAT.md), [RENDERING.md](RENDERING.md) |
| effect events | dispatcher (C)0x4490d0, material effect (C)0x449010 | [EFFECTS_AND_EVENTS.md](EFFECTS_AND_EVENTS.md) |
| shadows | shadow pass loop (C)0x482765-0x482a42 | [RENDERING.md](RENDERING.md) |
| sky and fog | sky renderer (C)0x730720-0x730a15, fog values (C)0x723330 | [RENDERING.md](RENDERING.md) |
| unit decals | object decal list (C)0x481900, `CObjMgr::Render` (C)0x481b06 | [RENDERING.md](RENDERING.md) |
| ambience | `CAtmoSoundMgr` (C)0x432d80 .. 0x436e9d | [ARCHITECTURE.md](../../remake/docs/ARCHITECTURE.md) "Ambience" |
| minimap | `CMiniMap` | [MINIMAP.md](../../remake/docs/MINIMAP.md) |
