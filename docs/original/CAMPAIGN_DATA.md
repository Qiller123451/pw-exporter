# The original campaign: what the mission data contains

Numbers and observations from decoding all 17 missions of the original single-player campaign
(`Data/Base/Maps/Base/Cpn_single_001/single_00.ula`, the tutorial, and `Data/Base/Maps/Cpn_single_001/single_01 … 16.ula`)
with `python -m pwexport.campaign`. The format is in [CAMPAIGN_FORMAT.md](../CAMPAIGN_FORMAT.md), what the triggers do
in [triggers.md](../../remake/docs/spec/triggers.md) (§7 has a description of every mission), the cutscenes in
[SEQUENCE_FORMAT.md](../SEQUENCE_FORMAT.md) and [CUTSCENE_PLAYER.md](CUTSCENE_PLAYER.md).

## 1. The missions in numbers

| # | title | objects | groups | question marks | regions | quests | variables | triggers | live | off | in a dead folder | conditions | actions | dialogue scenes (files) | sequences (files) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Tutorial | 1032 | 4 | 20 | 23 | 29 | 11 | 607 | 594 | 13 | 0 | 640 | 1258 | 89 (20) | 15 (13) |
| 1 | Stranded | 1539 | 2 | 14 | 62 | 16 | 27 | 312 | 301 | 11 | 0 | 380 | 659 | 59 (31) | 12 (10) |
| 2 | Druid Island | 668 | 7 | 4 | 59 | 7 | 10 | 160 | 137 | 23 | 0 | 184 | 402 | 25 (16) | 4 (4) |
| 3 | Amazon Island | 997 | 2 | 4 | 60 | 4 | 7 | 115 | 107 | 8 | 0 | 198 | 231 | 14 (11) | 4 (4) |
| 4 | The Dustriders | 1155 | 11 | 7 | 77 | 7 | 6 | 170 | 134 | 36 | 0 | 178 | 311 | 22 (9) | 4 (3) |
| 5 | The Holy City | 3176 | 15 | 8 | 53 | 5 | 10 | 169 | 141 | 28 | 0 | 186 | 395 | 23 (16) | 7 (7) |
| 6 | Pirates and Hostages | 788 | 1 | 3 | 81 | 5 | 6 | 130 | 114 | 16 | 0 | 193 | 313 | 19 (10) | 7 (7) |
| 7 | The Water Temple | 1836 | 16 | 9 | 129 | 9 | 27 | 218 | 176 | 42 | 0 | 283 | 441 | 19 (13) | 4 (4) |
| 8 | Valley of the Gods | 1202 | 10 | 4 | 42 | 7 | 20 | 138 | 117 | 15 | 6 | 190 | 365 | 12 (12) | 9 (9) |
| 9 | Perilous Path | 1283 | 21 | 4 | 99 | 8 | 22 | 135 | 116 | 17 | 2 | 162 | 414 | 16 (11) | 5 (5) |
| 10 | The Prophet | 1620 | 8 | 2 | 60 | 4 | 16 | 149 | 128 | 21 | 0 | 213 | 413 | 13 (10) | 4 (4) |
| 11 | Arena | 138 | 19 | 0 | 5 | 3 | 4 | 131 | 73 | 12 | 46 | 157 | 519 | 4 (4) | 4 (3) |
| 12 | Sea Battles | 1020 | 8 | 7 | 102 | 5 | 10 | 213 | 169 | 29 | 15 | 222 | 534 | 13 (12) | 4 (4) |
| 13 | The Rush | 981 | 11 | 21 | 64 | 9 | 40 | 176 | 167 | 9 | 0 | 250 | 371 | 20 (15) | 5 (5) |
| 14 | Prisoners | 979 | 6 | 7 | 71 | 6 | 9 | 153 | 141 | 12 | 0 | 201 | 323 | 13 (7) | 6 (6) |
| 15 | New World Order | 1715 | 7 | 1 | 64 | 5 | 28 | 172 | 161 | 11 | 0 | 288 | 663 | 9 (8) | 12 (10) |
| 16 | Showdown! | 841 | 7 | 2 | 5 | 5 | 7 | 109 | 100 | 9 | 0 | 139 | 376 | 8 (0) | 5 (4) |
| | **total** | 20970 | 155 | 117 | 1056 | 134 | 260 | 3257 | 2876 | 312 | 69 | 4064 | 7988 | 378 | 111 |

"off" = switched off in the level editor (no compiled trigger); "in a dead folder" = compiled, but in a folder that is
inactive at the start - only 6 of them (mission 8) are ever switched on. Dialogue scenes and sequences count the
trigger actions that start one, with the number of different files in brackets (counted on one copy of the
installation, which lacked most of the mentor `.dlg` files: about 170 mentor scenes are the same boilerplate - one
actor `Mentor`, one frame - and their texts are in the text tables). The installation has 440 `.dlg` files under
`Data/Base/DialogScenes/Cpn_single_001/`; 104 `.seq` files exist, and 9 sequences that triggers name do not exist
([CAMPAIGN_FORMAT.md](../CAMPAIGN_FORMAT.md) §9).

### Node types (all triggers, also the switched-off ones)

23 condition types: TIME 1059, REGN 701, TRUE 561, CVAR 497, SQEN 165, DSEN 163, QUES 143, DEAD 121, BLDG 120, DYIN 72,
ISFG 66, CKGR 59, SGHT 52, TECH 47, PLDE 45, OBJP 42, TIMR 38, RTME 37, WAYR 24, PLYR 19, ITEM 15, DIPL 13, UNTT 5.

44 action types: TRIG 2972, ACDO 691, SPGR 408, DGSC 380, QUES 346, VARS 327, QMRK 310, FDBK 300, MPNG 299, OBAP 194,
WYPT 158, SFOW 145, COBJ 129, SQNZ 122, DELO 107, AIFT 101, TIMR 97, AIBV 93, OCPY 79, PSND 60, CPLX 58, ADGR 54, REPL 53,
RSRC 52, DIPL 46, SNFA 44, AIAM 44, TECH 40, GAOV 39, PLCP 30, AIDA 30, AILU 27, INBA 27, TRSP 27, ACND 22, BLSL 19, AIRG 13,
QUIT 12, UNIT 8, POPL 8, ARGN 8, EFCT 6, BONI 2, MRGN 1.

Per mission:

| # | conditions | actions |
|---|---|---|
| 0 | TRUE 351 TIME 161 REGN 34 DSEN 27 PLYR 14 SQEN 11 DYIN 8 CVAR 7 OBJP 6 BLDG 6 DEAD 5 UNTT 4 TECH 3 WAYR 2 TIMR 1 | TRIG 671 QMRK 100 DGSC 89 QUES 87 ACDO 86 MPNG 70 SQNZ 23 OCPY 22 WYPT 20 SFOW 19 TECH 19 BLSL 10 COBJ 9 VARS 8 RSRC 7 DELO 4 GAOV 3 TIMR 3 OBAP 3 ADGR 2 SNFA 1 QUIT 1 UNIT 1 |
| 1 | TIME 161 REGN 59 CVAR 38 TRUE 27 OBJP 17 DSEN 12 DEAD 11 BLDG 10 SQEN 9 TECH 8 DYIN 7 ITEM 7 ISFG 6 PLDE 3 SGHT 2 PLYR 1 UNTT 1 RTME 1 | TRIG 299 DGSC 60 ACDO 59 QUES 35 QMRK 34 VARS 32 AIAM 27 MPNG 18 SQNZ 11 SFOW 10 RSRC 10 OCPY 9 AILU 8 GAOV 7 OBAP 6 DIPL 5 UNIT 5 REPL 4 DELO 3 BLSL 3 EFCT 3 WYPT 2 AIBV 2 PLCP 2 TECH 1 QUIT 1 AIRG 1 COBJ 1 POPL 1 |
| 2 | REGN 35 TRUE 34 TIME 23 QUES 21 DYIN 16 BLDG 11 CVAR 9 SQEN 8 DSEN 7 RTME 6 ITEM 4 TECH 3 OBJP 3 PLDE 2 DEAD 2 | TRIG 173 ACDO 47 VARS 31 DGSC 25 QUES 16 AIFT 15 QMRK 13 OCPY 12 MPNG 10 SFOW 9 DELO 7 AIBV 6 CPLX 6 RSRC 5 SQNZ 4 ADGR 4 TECH 3 SPGR 3 GAOV 2 INBA 2 SNFA 2 TRSP 2 QUIT 1 COBJ 1 AIRG 1 PLCP 1 MRGN 1 |
| 3 | TIME 53 REGN 51 BLDG 50 TECH 12 QUES 10 PLDE 4 SQEN 4 RTME 4 CVAR 3 TRUE 3 DYIN 2 DSEN 1 OBJP 1 | TRIG 82 ACDO 39 DGSC 14 MPNG 13 AIBV 11 AIFT 9 TECH 8 QUES 8 VARS 8 QMRK 8 RSRC 7 SNFA 4 PLCP 4 SQNZ 4 INBA 4 AILU 2 WYPT 2 GAOV 1 QUIT 1 SFOW 1 DIPL 1 |
| 4 | TIME 66 REGN 40 QUES 20 DSEN 19 TRUE 5 BLDG 4 SGHT 4 CVAR 4 SQEN 4 DYIN 3 PLDE 3 TECH 2 CKGR 2 DEAD 2 | TRIG 115 SPGR 25 DGSC 22 QMRK 19 ACDO 19 DELO 16 QUES 15 MPNG 11 OBAP 9 SFOW 8 AIBV 7 AIFT 6 VARS 5 WYPT 4 TECH 3 ACND 3 AIAM 3 SQNZ 3 BLSL 3 INBA 2 OCPY 2 DIPL 2 AIRG 1 COBJ 1 AILU 1 GAOV 1 REPL 1 UNIT 1 SNFA 1 PLCP 1 RSRC 1 |
| 5 | TIME 65 REGN 34 QUES 27 CVAR 19 SQEN 13 DSEN 10 PLDE 4 CKGR 4 ISFG 4 SGHT 2 PLYR 2 TRUE 1 BLDG 1 | TRIG 106 SPGR 57 REPL 36 MPNG 24 DGSC 23 QMRK 21 ACDO 13 SFOW 13 QUES 12 RSRC 11 FDBK 9 VARS 9 DELO 9 INBA 7 SQNZ 7 AIBV 7 WYPT 5 AILU 5 OBAP 4 ADGR 3 COBJ 3 EFCT 3 GAOV 2 DIPL 2 OCPY 1 AIAM 1 POPL 1 PLCP 1 |
| 6 | TIME 44 QUES 30 DEAD 30 REGN 24 ISFG 21 DSEN 13 SQEN 8 SGHT 6 PLDE 5 CVAR 4 TECH 2 TRUE 2 BLDG 1 DYIN 1 DIPL 1 WAYR 1 | TRIG 70 ACDO 56 DGSC 19 TIMR 18 QUES 14 ACND 13 OBAP 12 QMRK 11 SFOW 10 FDBK 10 AIBV 10 MPNG 10 DIPL 9 VARS 8 SQNZ 7 POPL 6 PLCP 6 CPLX 6 DELO 5 WYPT 3 SPGR 2 TECH 1 AIRG 1 QUIT 1 ADGR 1 GAOV 1 AILU 1 SNFA 1 TRSP 1 |
| 7 | REGN 76 CVAR 48 TIME 45 SQEN 26 DSEN 18 DIPL 12 DEAD 11 BLDG 10 SGHT 9 TECH 6 PLDE 4 ISFG 4 WAYR 4 RTME 4 TRUE 3 ITEM 2 DYIN 1 | TRIG 109 FDBK 33 ACDO 33 QUES 27 VARS 23 QMRK 20 DGSC 18 OBAP 18 SFOW 13 MPNG 12 COBJ 12 AIDA 10 ADGR 9 AIRG 9 DIPL 8 SPGR 8 SNFA 7 AIFT 7 DELO 7 REPL 6 AIBV 6 CPLX 6 ARGN 6 WYPT 5 AIAM 5 SQNZ 4 OCPY 4 RSRC 4 GAOV 3 AILU 3 BLSL 3 TRSP 2 QUIT 1 |
| 8 | TIME 45 CVAR 40 REGN 34 SQEN 25 CKGR 18 DYIN 5 DSEN 5 SGHT 4 TRUE 4 ISFG 4 PLDE 2 TECH 1 OBJP 1 PLYR 1 WAYR 1 | TRIG 109 ACDO 75 VARS 34 QUES 18 QMRK 15 FDBK 14 DGSC 12 SFOW 12 SPGR 12 MPNG 12 SQNZ 9 ADGR 6 AIBV 5 WYPT 5 REPL 5 OBAP 3 ACND 3 COBJ 2 GAOV 2 PLCP 2 INBA 2 DELO 1 SNFA 1 TRSP 1 OCPY 1 RSRC 1 AILU 1 AIAM 1 AIFT 1 |
| 9 | CVAR 48 TIME 34 REGN 27 SQEN 8 DSEN 8 TRUE 7 WAYR 6 CKGR 4 DEAD 4 PLDE 4 SGHT 3 BLDG 3 RTME 3 OBJP 2 DYIN 1 | TRIG 104 ACDO 44 VARS 32 FDBK 23 QUES 22 WYPT 19 SPGR 19 CPLX 18 DGSC 16 OBAP 14 ADGR 12 MPNG 12 COBJ 10 TRSP 10 QMRK 9 DELO 8 SFOW 8 SQNZ 5 AIBV 4 GAOV 4 PLCP 3 OCPY 2 INBA 2 AIAM 2 TECH 2 AIFT 2 DIPL 2 REPL 1 RSRC 1 PSND 1 SNFA 1 UNIT 1 AILU 1 |
| 10 | CVAR 70 TIME 48 REGN 18 TRUE 16 SGHT 13 CKGR 10 ISFG 9 DYIN 9 SQEN 6 DSEN 4 OBJP 3 PLDE 3 BLDG 2 ITEM 2 | TRIG 151 FDBK 71 ACDO 25 VARS 25 SPGR 20 MPNG 20 DGSC 13 SFOW 12 COBJ 11 QUES 10 AIFT 10 WYPT 9 AIBV 6 DELO 6 QMRK 5 SNFA 5 SQNZ 4 PLCP 3 ARGN 2 OCPY 1 AILU 1 TECH 1 GAOV 1 DIPL 1 |
| 11 | TIME 71 REGN 48 TIMR 15 SQEN 8 DEAD 7 CKGR 3 CVAR 2 QUES 1 OBJP 1 TRUE 1 | TRIG 191 SPGR 70 ACDO 65 WYPT 40 TIMR 33 COBJ 30 FDBK 26 PSND 19 QUES 12 SQNZ 6 MPNG 6 SFOW 4 DGSC 4 VARS 3 QUIT 3 GAOV 2 BONI 2 OBAP 2 DELO 1 |
| 12 | TIME 121 REGN 24 TRUE 17 BLDG 14 RTME 10 CVAR 7 CKGR 5 SQEN 5 WAYR 5 DEAD 4 SGHT 3 OBJP 2 TIMR 2 TECH 1 QUES 1 PLDE 1 | TRIG 244 SPGR 65 FDBK 27 WYPT 26 CPLX 20 ACDO 19 QMRK 19 QUES 15 DGSC 13 MPNG 12 OBAP 10 TRSP 8 VARS 7 DIPL 7 SNFA 5 SFOW 5 DELO 5 AIBV 5 GAOV 4 SQNZ 4 AILU 3 ACND 3 TIMR 2 TECH 2 OCPY 1 QUIT 1 AIAM 1 INBA 1 |
| 13 | CVAR 65 DSEN 31 TIME 31 TRUE 24 REGN 23 DEAD 21 TIMR 12 CKGR 9 DYIN 8 SQEN 6 WAYR 5 SGHT 4 PLDE 3 TECH 3 BLDG 2 PLYR 1 OBJP 1 ISFG 1 | TRIG 106 VARS 33 AIFT 33 MPNG 25 DGSC 20 FDBK 18 WYPT 18 ACDO 17 QUES 17 SPGR 12 ADGR 10 AIBV 9 TIMR 9 QMRK 7 COBJ 6 SQNZ 5 INBA 5 SNFA 5 PLCP 3 GAOV 2 CPLX 2 SFOW 2 OBAP 2 TRSP 2 AIAM 1 RSRC 1 DELO 1 |
| 14 | REGN 61 TIME 46 TRUE 27 QUES 21 ISFG 15 DEAD 10 BLDG 6 SQEN 6 TECH 3 DSEN 2 PLDE 2 DYIN 1 OBJP 1 | TRIG 129 ACDO 52 DELO 23 QMRK 18 DGSC 15 PSND 14 QUES 12 MPNG 12 DIPL 9 SQNZ 7 SPGR 7 SNFA 6 AIBV 5 RSRC 4 SFOW 3 OBAP 3 AILU 1 QUIT 1 GAOV 1 COBJ 1 |
| 15 | CVAR 121 REGN 80 TRUE 16 TIME 16 RTME 9 SQEN 8 DYIN 8 TIMR 8 DSEN 6 PLDE 5 CKGR 4 TECH 3 SGHT 2 ISFG 2 | TRIG 164 OBAP 106 FDBK 69 VARS 49 COBJ 38 TIMR 32 MPNG 22 OCPY 20 AIDA 20 PSND 18 AIFT 18 ACDO 17 QUES 14 SFOW 14 SQNZ 14 DGSC 9 AIBV 8 ADGR 7 PLCP 4 SPGR 4 DELO 3 SNFA 3 QMRK 3 INBA 2 GAOV 2 AIAM 2 TRSP 1 |
| 16 | REGN 33 TIME 29 TRUE 23 DEAD 14 QUES 12 CVAR 12 SQEN 10 OBJP 4 DYIN 2 | TRIG 149 SPGR 104 ACDO 25 VARS 20 QUES 12 MPNG 10 DGSC 8 DELO 8 QMRK 8 PSND 8 SQNZ 5 OCPY 4 COBJ 4 OBAP 2 AIBV 2 SNFA 2 SFOW 2 GAOV 1 QUIT 1 AIAM 1 |

### Loose ends in the data (223 cases)

The designers left references that resolve to nothing; the game's queries then simply find nothing.

* 67 × `ACDO` names an object (by GUID) that is not on the map (deleted in the editor); 14 more find the object only by
  its name (the GUID is stale).
* 20 × `TRIG` switches a trigger that is switched off in the editor (not compiled): the action does nothing;
  9 × `TRIG` names a trigger that does not exist.
* 17 × `ADGR` (add to group) and 14 × `AIAM` list objects that are not on the map; 2 × `AILU` the same.
* 6 × `QUES` conditions name a quest that does not exist.
* 4 × a player's start location GUID is not an object of the map; 4 × `QMRK` names a question mark that is not one.
* 2 × `REGN` and 2 × `BLDG` conditions name a region that does not exist.
* Smaller numbers of stale references in `MPNG`, `SFOW`, `DELO`, `OBAP`, `DEAD`, `WYPT`, `DYIN`, `ISFG`, `REPL`,
  `OBJP`, `SGHT`.
* 3 tutorial mentor scenes have neither a file nor texts.

## 2. Observations per subject

### Gates on the campaign maps

Every gate placed on a campaign map sits on a tile edge or tile corner of the 8 m wall grid, not on a tile centre - for
example mission 1 (644, 384): x mod 8 = 4, y mod 8 = 0; (832, 432): 0 / 0; mission 13 the same. These are gates of the
old mode (a 2-tile gate centred on a tile edge), which survives only in old maps; the shipped game places new 1-tile
gates ([walls_engine.md](../../remake/docs/spec/walls_engine.md) §1.4, §5.1).

Mission 16: three `seas_endboss_gate` (owner player 4, GateState 0) and one `seas_hq_gate` (no owner, GateState 0).
`CGate.OnInit` / `SetReadyBuild` (`Building.usl:2332-2700`) open them (`Open()` → `SetAnim("open")`). The only gate
actions of the mission are three "Close Gate" in the trigger `01_close_gates_<-[S02]`, which `02_sc_7052_skorpion_quest`
enables after the quest L16MQ02 is accomplished (C_dead, V_dead, CV_dead > 1) and player 2's attack forces are dead:
the lock-in of the Scorpion arena. Nothing opens them again. In Base both classes are `CGate` (`seas_walls.txt`,
`seas_wwi.txt`); with MIRAGE's data `seas_endboss_gate` is listed without `gate = 1` and `seas_hq_gate` is a
`CGateFOWVIsible` (a subclass of `CGate` in `Building.usl`).

### Owner changes of walls and gates

Mission 1's trigger `bela_worker_ready` gives every building of any owner in the region `prison_complete_area` to the
player (`OCPY`): the Norse prison village with its palisades and 3 gates. Mission 13 gives the player 8 Dragon Clan
skewer walls and 3 gates at the start. The tutorial has no Norse walls, only 3 `tutorial_vikingpark_gate` of player 1,
which are never given away.

### The flying trader (missions 3, 4, 13)

The campaign's zeppelin is `FlyingTrader_Obj` (`CFlyingTraderObj`, `Vehicle.usl:852-890`): it cannot be hit or selected,
it flies, its `Damage()` is empty and it takes no population. A walk order moves it in a straight 3D line to (x, y, z) at
the order's speed (m/s, capped at `maxspeed` 3; MIRAGE 4); it has arrived within 1 m; it always plays `standanim`. It
starts at the height of its map object (z). `FlyingTrader_Obj_6` is the most-addressed object of all `ACDO` actions (31).
The multiplayer `CFlyingTrader` is switched off in the original.

### Spawn parameters

* `class§buildup` in a spawn's class list (direct path only): after the unit is created its filters are cleared and
  `/Filters/<tribe>/Upgrades/<class>/<buildup>` is switched on in the unit's own tree. Used in mission 2
  (ankylosaurus / stegosaurus, no effect), missions 4 and 14 (`hu_wild_boar§wild_boar_rage`: × 1.5 damage on weapons b-e,
  for good) and mission 12 (`special_eusmilus§global`, no such filter).
* `OCPY` `chk_highlight`: with `highlight_time` > 0 and a human new owner, a ring on the ground under the object
  (radius = the object's radius, 0.3 m line, steady) for floor(`highlight_time`) seconds of game time; deselecting the
  object ends it. The colour is not known.
* Details of `SPGR` (spawn a group: the source's `open` clip, `Spwn` and `Ex_1` links, rally point):
  [triggers.md](../../remake/docs/spec/triggers.md) §5.3.

### Time of day and weather

The missions start at the time `Root/Base/StartTime` gives: mission 0 at 6:00, mission 5 at 15:00, mission 11 at
18:00, mission 16 at 8:00, the others at 12:00 (no StartTime). Only mission 8 has a weather program (light snow, looped).

### Computer players

Every computer slot of every campaign map is `ai_Mikrobe` (asleep) until a trigger wakes it (`AIBV`); the slot's
difficulty comes from `AI_Difficulty_Easy / _Medium / _Hard` of the level info (details:
[ai.md](../../remake/docs/spec/ai.md) §1.3, §10). The Norsemen and the Dragon Clan have no army tables (`Units.txt`), so
in the campaign their computer players keep no standing army: they attack with the units the triggers give them and
the fight module's extra units ([COMPUTER_PLAYER.md](../../remake/docs/COMPUTER_PLAYER.md)).

### Dialogue voices and films

* A dialogue frame's `audio` is a sound event `ds_<scene>_<Actor>_<nn>` of `Scripts/Server/init/dialogsounds.txt`,
  whose wav path is `../SeqSounds/Level_<n>/<scene>_<Actor>_<nn>.mp3` (relative to `Audio/Sound`); mentor hints use
  `../SeqSounds/Mentor/L01B01.mp3` and so on.
* The pre-rendered films (`hs_*.bik`, `ns_*.bik`) are Bink videos in `Data/locale/<lang>/Video`; `Data/Base/Video` holds
  only placeholders of about 40 KB (4 seconds). `hs_1000.bik` (Polish pack: 2:30, 1024 × 768) is the opening of the
  campaign: a bird flies over a city, then the meeting in an office; none of that city is in the GSF archives (the
  `seq_*` archives hold only a city wall, gate, watchtowers and the telescope tower). `intro.bik` is the dinosaur battle.
  The client also knows `credits.bik`, `extro.bik`, `partner.bik`, `sek_logo.bik`, `sf_logo.bik`.
