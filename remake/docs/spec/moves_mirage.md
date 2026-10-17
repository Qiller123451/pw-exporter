# MIRAGE special moves

Implementation spec for the JS remake, from the MIRAGE mod's server scripts (Data/MIRAGE/Scripts/Server) and its tech
tree. The remake's code is `src/game/systems/moves_mirage.js` (tests: `tests/mirage_moves.js`); where MIRAGE's scripts
have a bug the remake does what was meant - each case is in docs/MIRAGE_BUGS.md.

Not in the remake on purpose:

| Move | Why |
|---|---|
| Jumpjet_0 (Tesla), sand_trap_bfpw (Tarna), bfpw_kick / bfpw_quake / bfpw_roar (Dustrider warrior) | only in MIRAGE's "BfPW" game mode (`xenage/bfpw_filters`), which the remake doesn't have |
| FeignDeath, tree_camouflage, Hu_Multi_Arrow | switched off in MIRAGE itself: no handler, or never researchable |
| RamAttack | no handler: the ankylosaurus' ram is a weapon swap of the "ram" research |

What the remake does for the moves whose MIRAGE task scripts are not in the mod's files (marked `?` below): the
Base game's task with the parameters MIRAGE passes (ShakeOff: its damage and radius; MickDundee: the Base hypnosis;
mammoth_trumpet: the Base trumpet; jetleap: the Base jetpack jump, 100 m).

Part A covers the heroes, the Norsemen and the Dustriders, part B the Dragon Clan and the SEAS.

# Part A: heroes, Norsemen, Dustriders

Implementation spec for the JS remake, taken from the MIRAGE server scripts.
Abbreviations:
- **M/** = `Data/MIRAGE/Scripts/Server/classes`
- **B/** = `Data/Base/Scripts/Server/classes`
- **TT** = `Data/MIRAGE/Scripts/Server/settings/techtree/_TechTree.ttree` (line numbers)
- **Base spec** = `remake/docs/spec/moves.md`

Conventions follow the Base spec. Level `L3` means UI level 3 (script `GetLevel()==2`). Costs are written F/W/S/Sk, where TT `iron` is paid as skulls. `?` marks a value I could not verify; each one is listed in §5.

---------------------------------------------------------------------------------------------------

### A.0. Source coverage (read first)

MIRAGE ships only `classes/{FightingObj,animals,buildings,character,mirage,misc}` plus the techtree. **It does not ship its `classes/task/*.usl`, `misc/*` or `CMirageSrvMgr`.**
Several MIRAGE call sites use task `Init` signatures that differ from the Base tasks. This proves that MIRAGE has its own task versions, which are not in the dump:

| Task (factory name) | MIRAGE call | Base `Init` | Status |
|---|---|---|---|
| CResKick "ResKick" | `Init(h, enemy, path, true)` M/character/character.usl:432 | `Init(h, enemy)` B/task/ResKick.usl | **MIRAGE version missing** |
| CCharacterBash "ChtrBash" | `Init(h, anim, R, tOff, spread, path, true)` character.usl:460,488 | 5 args B/task/CharacterBash.usl:49 | **missing** |
| CQuicksandTask "QuickS" | `Init(h, pos, path, "Aje_Quicksand_Trap")` M/character/Hero.usl:1141 | 3 args B/task/QuicksandTask.usl:38 | **missing** |
| CShakeOff "ShakeOff" | 6/9-arg Init M/animals/Animal.usl:1203-1205 | 4 args B/task/ANMLSpec.usl:59 | **missing** |
| CMammothTrumpet "MTrumpet" | `Init(h, path)` Animal.usl:4016 | `Init(h)` ANMLSpec.usl:792 | **missing** |
| CJetpack "Jetpack" | `if(Init(h,pos,path))` (bool) character.usl:2380 | `proc void Init` and hu_jetpack_warrior only, B/task/Jetpack.usl:46-50 | **missing** |
| CSacrifice "Sacrific" | `Init(h, tgt, path)` Hero.usl:913 | same, but it calls `KleemanDamageBoostStart()` with 0 args. MIRAGE CHero only has `KleemanDamageBoostStart(real)` (Hero.usl:923) | **missing** |
| CMickDundeeMove "Dundee" | `Init(h, tgt, path)` Hero.usl:550 | same signature, but it casts the actor to `CAnimal` (B/task/MickDundeeMove.usl:64-67) | possibly Base, see entry |
| Fight task (calls `CheckSpecialMoves(enemy, onOpenTrp)`) | 2-arg M/FightingObj.usl:4166 | Base calls 1-arg | **missing** |

Where a task is missing, I give the call parameters exactly. I give the Base behaviour only as a fallback and mark it `?`.
New MIRAGE tasks **are** shipped in M/mirage/Miracle.usl: CPlunder, CJumpjet, CMeteor, CBlindingStorm, CMirageReanim, CReanimation, CSpecialJumpjet, CSpecialMinigun, CCustomTask.

---------------------------------------------------------------------------------------------------

### A.1. MIRAGE engine rules that differ from Base

### 1.1 Dispatch
`HandleGamePlayCommand` repacks its arguments and calls `ReactToGamePlayCommand(cmd, obj, pos, miscParams, bQ, bShift, bAILock)` (M/FightingObj.usl:14358-14393).
Each class tests `p_sMiscParams.Find(...)` in an if/elseif chain and then falls through to `super`. The chains for these moves are:

| Class | Lines | Moves (substring tested) |
|---|---|---|
| CHero | M/character/Hero.usl:753-872 | `/schliemann_sacrifice`, `/call_twins`, `/Jumpjet_0`, `/reanimation`, `/sand_trap_bfpw`, `MickDundee` |
| CHu | M/character/Hu.usl:163-190 | `jetfly_on`, `jetfly_off` |
| CCharacter | M/character/character.usl:2841-3207 | `/meteor` :3024, `/blinding_storm` :3095, `jetpack`\|`jetleap` :3147, `/tree_camouflage` :3170 |
| CSBaryonyx (Miyagi_s0) | M/mirage/Mirage.usl:329-346 | `/plunder` |
| CSpecialMobileSuit | Mirage.usl:710-739 | `Babbage_ExoJumpjet_0`, `Babbage_ExoMinigun_0`, `Babbage_ExoPiercing_0` |
| CMammoth | M/animals/Animal.usl:4062-4079 | `mammoth_trumpet` |
| CFightingObj | M/FightingObj.usl:11198 | `/MountThatUnit` |

Pre-filters, as in Base:
- Trapped units only accept Kill and LevelUp.
- Units in a transport only accept LevelUp and LeaveTransport.
- `GetEntrenched()==2` ignores all commands.
- CHero returns early if `m_bSuit||m_bAscend` (Hero.usl:757).
- Illusions skip the hero chain.
- Any command except `/Walk` or `/camouflage` cancels AJE_CAMOUFLAGE (character.usl:2861).

### 1.2 `CheckSpecialActionTimer(path[, skipVis])` (M/FightingObj.usl:4558-4595). The server now validates much more:
```
if !CheckMana(path) return false                 // only if server ManaEnabled (:2926); needs energy >= TT manacosts
node = unitTT.FindNode(path)
if (cond.level - 1) > GetLevel() return false    // CheckLevelCondition :15631 -> level gate IS enforced server-side
CheckTribes -> always true (:16756)
if !node.IsVisible() return false
if !skipVis && node.visibility != 1 return false // must be EXACTLY 1 (vis 2, 3, ... fails)
if node.disabled == 1 return false
location: any loc whose value contains className, or whose last 4 chars == GetType();
          if loc has `localflags`, one flag with value 1 must be named == m_sObjFlag
return path not on cooldown
```
The object variant `(path, obj, checkObj)` (:4524) also rejects `obj.class` listed in `secondaryexcludes`, or not listed in `secondaryclasses` when that list exists. If `checkObj` is set and obj is null, it returns false.

### 1.3 `AddSpecialActionTimer(path)` (:4497)
It calls `CheckManaAndPay(path)` first, so **mana is paid when the cooldown starts**. It then reads `duration` from the unit-local TT (default 5) and starts a one-shot timer.
`StartSpecialActionTimer` in tasks (Hero.usl:1536-1547) = Check + Add.
`ResetAllSpecialActionTimers` / `AddSpecialActionTimerPrecisely` (:4614) are used for cooldown transfers (Babbage, resurrection).

### 1.4 Automatic moves
`CheckSpecialMoves(enemy, onOpenTransporter)` (:4166) loops over `m_axAutoSpecialMoves` in registration order. The first entry where `check() && CheckSpecialActionTimer(path, skipVis=true)` passes starts. On an open transporter, only burst_arrow and multishot are allowed. The caller is the (missing) Fight task.
Character registration order (character.usl:229-258): Matrix, Quake, Roar, Twister, Kick, burst_arrow, multishot, **bfpw_kick, bfpw_quake, bfpw_roar**.

### 1.5 Client
The MIRAGE Game scripts are not shipped. The Base CommandBar shows an action only if `visibility == 1` (B/../Game/UI/CommandBarEx/CommandBar.usl:2190).

### 1.6 Global TT modifiers that touch these moves
| Filter | When | Effect on these moves |
|---|---|---|
| `/Filters/Special/Upgrades/lovelace_s0/Chief_Bonus` (TT 243995) | enabled on the player TT when Lovelace reaches script level 4 (UI L5) (FightingObj.usl:4932-4939) | duration ×0.5 for call_twins, plunder, MickDundee, Babbage_ExoMinigun_0, Babbage_ExoJumpjet_0, mammoth_trumpet, Wild_Boar_Rage, jetleap, meteor, RamAttack, FeignDeath, blinding_storm |
| `/Filters/Special/Upgrades/xenage/bfpw_filters` (TT 265915) | "BfPW" game mode; its activation code is not shipped `?` | plunder duration := 30; schliemann_sacrifice duration := 40; reanimation vis := 0; sand_trap_bfpw vis := 1; Jumpjet_0 vis := 1; invents `bfpw_kick/roar/quake` (Aje); Barry/Harry/Larry `can_build`/`can_harvest` := 0 |
| `/Filters/Hu/Upgrades/xenage/mana_enabled` / `/Filters/Aje/Upgrades/xenage/mana_enabled` | mana mode | meteor duration := 10 (TT 193177); blinding_storm duration := 10 (TT 171660) |
| `/Filters/Hu/Upgrades/xenage/flying_disabled` (TT 192682) | no-flyers setting | jetfly_on vis −1 and `disabled=1` |

---------------------------------------------------------------------------------------------------

### A.2. Summary

Trig: U = user, A = auto (fight tick), P = passive, – = no handler. CD = TT `duration` in seconds. Vis = initial TT visibility → what makes it 1.

| id | Unit (script class) | TT line | CD | Lvl | Tgt | Vis / enabler | Trig | Handler | Works? |
|---|---|---|---|---|---|---|---|---|---|
| plunder | Miyagi_s0 (CSBaryonyx, **ANML**) | 42915 | 120 (BfPW 30) | L3 | ANML/BLDG/CHTR/VHCL, enemy+neutral | 1 | U | Mirage.usl:336 → CPlunder Miracle.usl:1204 | yes |
| call_twins | Larry_s0 (CHero) | 43059 | 120 | L3 | self | 1 | U | Hero.usl:818 → :491 | yes |
| Jumpjet_0 | tesla_s0 (CHero) | 43098 | 40 | L3 | VEC3 | 0 → BfPW only | U | Hero.usl:822 → :989 → CJumpjet Miracle.usl:3855 | BfPW only |
| MickDundee | Stina_s0 (CHero) | 43159 | 60 | L3 | enemy ANML | 1 | U | Hero.usl:848 → :543 → CMickDundeeMove | `?` (§3.4) |
| reanimation | Tarna_s0 (CHero) | 43184 | 60 | L3 | SPRT/FOOD/MNST/VEC3 | 1 (BfPW → 0) | U | Hero.usl:826 → :1053 → CMirageReanim Miracle.usl:4206 | yes |
| sand_trap_bfpw | Tarna_s0 | 43210 | 30 | L3 | VEC3/FGHT/CHTR/ANML/VHCL | 0 → BfPW only | U | Hero.usl:832 → :1136 → CQuicksandTask (missing) | BfPW only |
| schliemann_sacrifice | schliemann_s0 | 43265 | 120 (BfPW 40) | L3 | own/allied CHTR/ANML/VHCL/SHIP, not self | 1 | U | Hero.usl:809 → :907 → CSacrifice (missing) | yes `?` |
| Babbage_ExoMinigun_0 | special_mobile_suit (CSpecialMobileSuit, VHCL) | 43418 | 120 | L3 | VEC3 or enemy object | 1 | U | Mirage.usl:725 → :756 → CSpecialMinigun Miracle.usl:7463 | yes |
| Babbage_ExoJumpjet_0 | special_mobile_suit | 43450 | 60 | L3 | VEC3 | 1 | U | Mirage.usl:721 → :741 → CSpecialJumpjet Miracle.usl:7316 | yes |
| mammoth_trumpet | hu_mammoth, hu_mammoth_lumber_upgrade (CMammoth) | 15125 | 30 | 0 | self | 0 → upgrade +1 | U | Animal.usl:4069 → :4012 → CMammothTrumpet (missing) | yes `?` |
| Wild_Boar_Rage | hu_wild_boar (CWildBoar) | 15241 | 15 | 0 | – | 0 (skipVis) | A + P | Animal.usl:4480-4501; FightingObj.usl:7387-7408 | yes |
| Hu_Multi_Arrow | hu_archer, hu_zombie_archer | 15891 | 60 | 0 | – | 0, no icon | – | none | **no-op** |
| jetfly_on / jetfly_off | hu_jetpack_warrior (CHu) | 15994 / 16015 | 1 (unused) | – | self | on: 0 → final_stage +1 | U toggle | Hu.usl:176-183, :71-112 | yes |
| jetleap | hu_jetpack_warrior, hu_archer, hu_berserker, hu_druid, hu_flamethrower, hu_killer, hu_marksman, hu_pikeman, hu_spearman, hu_warrior, hu_worker, hu_zombie_warrior | 16060 | 15 | – | VEC3 | −1 → Tesla L4/L5 `_tt` filter +2 | U | character.usl:3147 → :2375 → CJetpack (missing) | yes `?` |
| meteor | hu_druid (CHu) | 16198 | 90 (mana 10) | L3 | VEC3 or any obj (own/neutral/enemy) | 0 → upgrade | U | character.usl:3024 → :2635 → CMeteor Miracle.usl:3995 | yes |
| tree_camouflage | hu_druid | 16240 | 15 (never started) | L3 | ANML or VEC3 | 0 → upgrade; **the upgrade itself stays hidden** | U | character.usl:3170 → :813 | broken (§3.15) |
| BrachioStampede | aje_brachiosaurus (CBrachiosaurus), ObjFlag aje_brachiosaurus | 4883 | 30 | 0 | – | 0 (skipVis) | A | Animal.usl:2474, :2925-2943, :296-339 | yes |
| FeignDeath | 19 Aje ANML classes | 4924 | 30 | 0 | self | −2 → +1 = −1 | – | dispatcher commented out (Animal.usl:1162-1165, :3564-3567) | **no-op** |
| RamAttack | aje_ankylosaurus (CAnkylosaurus) | 5108 | 120 (unused) | 0 | – | 0 | P (weapon swap) | Animal.usl:2371-2420 | passive yes; TT action inert |
| blinding_storm | aje_shaman (CAje) | 5851 | 60 (mana 10) | L3 | VEC3 or any obj | 0 → upgrade | U | character.usl:3095 → :2694 → CBlindingStorm Miracle.usl:2022 | yes |
| bfpw_kick / bfpw_quake / bfpw_roar | aje_warrior (CAje) | 6162 / 6175 / 6188 | 20 / 40 / 30 | 0 | current enemy / self AoE | 0 (skipVis) | A | character.usl:413-495 | BfPW only |
| MountThatUnit | every ANML (location `/Objects/<T>/ANML`) | 4813 (Aje), 15063 (Hu), 25076, 35349 | – | – | CHTR/ANML/VHCL | 1 | U | FightingObj.usl:11198 → :11718 | yes |

Enabling upgrades (TT action → filter):

| Upgrade | Building | F/W/S/Sk | Requires | Time | Visibility of the upgrade button | Filter effect |
|---|---|---|---|---|---|---|
| mammoth_trumpet (TT 18668) | hu_small_animal_farm | 400/0/0/50 | hu_big_animal_farm + age_4 | 35 | −1, +1 hu_fireplace/age_4, +1 hu_big_animal_farm | invent `mammoth_trumpet`, `Moves/ANML/mammoth_trumpet/visibility +1` (TT 182344) |
| wild_boar_rage (18943) | hu_small_animal_farm | 250/0/0/40 | age_3 | 25 | 0, +1 age_3 | invent `wild_boar_rage` (182543) |
| meteor (19256) | hu_temple | 200/100/100/100 | age_5 | 30 | 0, +1 age_5 | invent `meteor`, `meteor/visibility := 1`; also removes SEAS `seas_meteor` (184802) |
| tree_camouflage (19295) | hu_temple | 150/0/40/25 | final_stage | 30 | 0, and age_3 *replaces* it with 0 → **never 1** | invent, `tree_camouflage/visibility := 1` (184840) |
| FeignDeath (9112) | aje_small_farm (localflag aje_small_farm) | 100/100/0/100 | age_5 | 40 | −2, +1 age_5, +1 aje_small_farm → **0, hidden**; BuildDown filter sets `disabled=1` | invent, `FeignDeath/visibility +1` (162035) |
| blinding_storm (9509) | aje_temple | 100/150/25/20 | age_3 | 35 | 0, +1 age_3 | invent, `blinding_storm/visibility +1`; removes SEAS `seas_blinding_storm` (163165) |
| brachiostomp (9073) | aje_small_farm (localflag aje_huge_farm) | 400/0/0/50 | – | 35 | −1, +1 age_3, +1 aje_huge_farm | invent `brachiostomp` **and `brachiostampede`** (161990) |
| ram (9154) | aje_small_farm (localflag aje_medium_farm) | 300/0/200/50 | – | 40 | −1, +1 age_2, +1 aje_medium_farm | invent `ram` (162064) |
| bfpw_kick/roar/quake | – | – | – | – | – | appended by `xenage/bfpw_filters` (TT 265944-265968) |

---------------------------------------------------------------------------------------------------

### A.3. Per-move entries

#### 3.1 plunder (Miyagi_s0)
**TT** `/Actions/Special/Moves/ANML/plunder` (TT 42915):
- code plunder_Moves_Special; duration 120; vis 1; level 3; icon `miyagi_special_move_1`.
- secondarycontroller ANML/BLDG/CHTR/VHCL; owner Enemies + Neutrals.
- `secondaryexcludes`: 50 animal species names (`Brachiosaurus`, `Mammoth`, …, `special_mobile_suit`). These are **not checked server-side**: the dispatcher uses the 1-arg Check (Mirage.usl:337).
- Duration filters: Chief_Bonus ×0.5; BfPW := 30 (TT 267639).

**Trigger** user, targeted. Mirage.usl:336: needs `CheckSpecialActionTimer(path) && obj != null && !inTransport`. `Plunder()` (:367) sets the AI lock and adds CPlunder (queued if shift).

**CPlunder** (Miracle.usl:1204-1380):
```
OnEnter: abort if actor/target null or !CheckSpecialActionTimer
goto_target: if !InRange: (on wall -> abort) AdvanceAction(target, 5.0, maxSpeed)
check_pos:   !InRange -> EndTask (no retry)     InRange: Abs2(t-a) <= 5 + r(a) + r(t)   (:1345)
rotate:      RotateAction toward target
plunder:     StartSpecialActionTimer else abort; unstoppable
             DoTaskAnim("plunder") -> the rider (captain) plays "victory_2" once (Mirage.usl:141)
             target.StealResis(actor.owner, actor, bStream)                         (FightingObj.usl:14750)
             items: while own inventory not full, move every CItem from the target inventory
                    (target.LoseItem -> actor.StealItem, CArtifactMgr re-registered, SC event 38)
             if bStream still true: targetOwner.IWasAttacked(target, actor)
             if target.class contains "_worker": target.CouldBeStolen(actor)        (character.usl:4588)
EndTask
```
`StealResis` runs on the **target** (FightingObj.usl:14750-14790):
```
lim = target TT <obj>/UpdateLimits
if lim missing: if target.IsTradeUnit(): f,w,s = 2 * GetLastResis() else return
else f,w,s = lim.max_food/max_wood/max_stone
each clamped to [0, victimPlayer stock]
x -= thief.AddResource(type, x, false)        // return value = amount NOT added? (?)
victim.AddFood/Wood/Stone(-x); feedback "_MIRAGE_NT_ResourcesStolen"; victim IWasAttacked; bStream=false
```
UpdateLimits (StartTT) that give non-zero loot:

| Target | Food/Wood/Stone |
|---|---|
| hu_fireplace, ninigi_fireplace, seas_headquarters, aje_resource_collector, aje_bazaar, seas_small_tent | 500/500/500 |
| hu_warehouse, ninigi_warehouse, aje_amazon_temple, seas_steelwork | 1000/1000/1000 |
| hu_lumberjack_cottage | 500/500/0 |
| hu_stone_quarry, ninigi_stone_quarry | 0/0/500 |
| ninigi_hunting_lodge | 500/0/0 |
| ninigi_lumbermill | 0/500/0 |
| pirate_boss_row/sail/tail | 1500/1500/1500 |
| hu_zeppelin, seas_zeppelin | 500/500/500 |

Everything else steals nothing (trade units: 2× their last load).
CouldBeStolen (worker conversion) applies only if the server option TechtreeSteal is on, the owner is in 0..7, and the plunderer has unit or supply room. It then calls SetOwner(thief), sends `ocupy_unit` and starts TIMER_GOT_STOLEN 1.5 s.
**Remake:** there is no damage, no level table and no FX.

#### 3.2 call_twins (Larry_s0)
**TT** (TT 43059): duration 120; vis 1; level 3; self (no secondarycontroller); icon `call_twins`. Chief_Bonus ×0.5.

**Trigger** user, instant. Hero.usl:818 checks `CheckSpecialActionTimer && !inTransport`. When queued it uses `StartCustomTask("CallTwins")`, which later calls `CallTwins(path, false)` (Miracle.usl:6218).

**Effect** (Hero.usl:491-541):
```
if !AddSpecialActionTimer(path) return            // cooldown starts immediately (no task)
SetAnim("follow_me", 1)
for (cls, off) in [("Barry_s0",(4,0,0)), ("Harry_s0",(6,0,0))]:
   off.RotZ((rand%314)/100)                        // random angle 0..3.13 rad (half circle)
   twin = CreateObj(cls, owner, pos+off, Larry.rot); twin.SetLevelClean(Larry.GetLevel())
   copy Larry's job: BuildUp->Build(same bldg) | GetFood->SearchFood | Harvest->SearchForest |
                     Mine->SearchStone | has cur enemy->MemorizeCurrentFightState+ReturnToFight |
                     else ExamineEnemies(false)
```
**Twins**: class CTwins (Mirage.usl:1187-1236; mirage_character.txt:2):
- gfx `trader_s0`; SetUnique; `DoesCountInUnitLimit()=false`.
- Lifetime **STAYTIME = 60 s** (:1189), then `Die()`, which deletes them (no corpse or spirit; dismount first).
- TT Barry_s0 (TT 111926): hp 400, speed 3, FOW 40, caste res, unit_size 6, can_build/can_harvest 1 (BfPW → 0).

#### 3.3 Jumpjet_0 (tesla_s0)
**TT** (TT 43098): duration 40; **vis 0**; level 3; VEC3; icon `hu_jetpack`.
The only visibility source is BfPW `mod_jumpjet_vis := 1` (TT 266724). The server requires vis == 1, so **outside BfPW the move is rejected**.

**Trigger** Hero.usl:822: `CheckSpecialActionTimer && !inTransport` → `HeroJumpjet` (:989; pos ≠ 0) → CJumpjet.

**CJumpjet** (Miracle.usl:3855-3993):
```
Init: actor must be tesla_s0 or babbage_s0
OnEnter: CheckSpecialActionTimer else abort; if |dest-pos| > 500: dest = GetAdoptedDest(pos,dest,len-500)   (max 500 m)
rotate_to_target: RotateAction
prepare_to_jump_3: CheckSpecialActionTimer else abort; GetFreePos(dest, 15) else abort; unstoppable
                   EquipJetpack(true) -> CProduct "jetpack_bag_on" (gfx Hu_Steam_Jet_Pack) linked at "Back"  (Hero.usl:1151)
                   AnimAction("jetpack", 0, true, false)
jump_to_target:    dest.z = terrain; SetSLEAnim("jetpack", 9999); RemoveFromWall; JetPackAction(dest)  // engine ballistic
land_1:            AnimAction("jetpack", 0, false, true)
land_2:            EquipJetpack(false); StartSpecialActionTimer (cooldown starts at landing); ShowWeapons
```
There is no damage and no landing effect.

#### 3.4 MickDundee (Stina_s0)
**TT** (TT 43159): duration 60; vis 1; level 3; target ANML, owner Enemies; icon `stina_special_move_1`. Chief_Bonus ×0.5.

**Trigger** Hero.usl:848: `Find("MickDundee")`. There is **no Check at dispatch**; the task checks in OnEnter. `MickDundee()` (:543) accepts only `obj.GetType()=="ANML"`, then creates CMickDundeeMove (factory "Dundee").

**Effect**: the MIRAGE task source is not shipped.
- Base CMickDundeeMove (B/task/MickDundeeMove.usl) casts the **actor** to `CAnimal` and ends at once when that fails. Used by Stina (a CHero), it would be a **no-op** `?`.
- The same task is used by `special_eusmilus` Hypnosis (Animal.usl:6507-6535).
- Base behaviour as the reference (`?`): approach to within `r+r+10` (speed 4), StartSpecialActionTimer, anim "sm_01". After 2.6 s the target loops "rest" and gets `SetTrapped(m_fDuration)` (20 s per the Base spec). The task ends at 3.4 s.
- Also note that Stina is normally spawned riding `special_eusmilus` (Building.usl:5100), and CHero ignores commands while transported (Hero.usl:772). So the button may only work while she is dismounted `?`.

#### 3.5 reanimation (Tarna_s0)
**TT** (TT 43184): code reanimation_Moves_Special; duration 60; manacosts 0; vis 1 (BfPW → 0); level 3; targets SPRT/FOOD/MNST/VEC3; icon `Tarna_resurrect_0`.

**Trigger** Hero.usl:826. Params = `"<path> <Type> <Identifier>"` (exactly 3 tokens), not in transport. `Reanimation()` (:1053):
- CheckSpecialActionTimer, else return.
- If the server option `UseOldSpirits` is false (the MIRAGE default `?`), Type must be Guid/Vec3/Pyco:
  - Pyco = handle int.
  - Guid = object; for a CFoodFood corpse, its spirit is used.
  - Vec3 = `"x_y_z"` (falls back to the click pos) → `GetBestSpiritToResurrect(pos, 60.0, true)`.
  - Creates **CMirageReanim(actor, spirit, path, enemiesToo=true, speedBonus=true)**.
- Otherwise the pool-mixer path creates CReanimation (Miracle.usl:5095). See the note below.

**CMirageReanim** (Miracle.usl:4206-4803):
```
Init: spirit must be a live CMrgSprt
  time factor: own spirit -> 0.80 (speed bonus) ; allied (relation 2) -> 1.0 ;
               enemy -> 1.0 but only if spirit.research age in 1..6 and <= caster player's age ("final"=6) else fail
  hero spirit whose hero the (new) owner already has -> fail
  duration D = spirit.GetResurrectDuration() * factor ; total = D + SAFETY_TIME 1.5
goto_target: AdvanceAction to 25 m of spirit (ground z)        InRange: dist <= 27 + r(spirit)  (or always, if server GlobalReanim)
rotate: abort if spirit already being resurrected/deactivated or hero dup; spirit.SetResurrectMode(true); rotate
resurrect: !InRange -> retry goto (max 4 tries); enemy spirit + not allied -> new owner = caster (owner change)
           CheckUnits(owner, level) and CheckSupply(...) else abort (mana paid back); CheckManaAndPay
           virtual unit/supply reserved; pyramid card created; anim "praying_wall" (loop 3); spirit.StartReanimation(D+1.5)
check: progress = 100*t/total; after D: SecureResurrector -> EndAnim (1.5 s, Break() refused)
EndAnim: Resurrect(): CreateObj(class, owner, spirit pos/rot) +12 m flying height for flyers, Reanimated(),
         SetLevelClean(level), TT filters restored, killer counts/aggro state restored,
         every cooldown it had at death restored (shifted by time dead), hero -> NPC registered
         if success: StartSpecialActionTimer (60 s cooldown starts AFTER the revive)
Leave without finishing: ResetSpecialActionTimer, spirit released
```
Resurrect durations come from the spirit: `reanim_time` default 25 s, `spirit_life` default 120 s (FightingObj.usl:12021).
Old path (CReanimation, `UseOldSpirits`):
- time factor 0.85 own, 1.0 ally, **3.0 enemy**.
- range 40 + `MiscValues/<tribe>/Shaman_Cast_Reanimation`. For Tarna (tribe Special) that value is 0 (TT 150521).
- anim "praying_wall", then "standanim".
- It calls `StartSpecialActionTimer` twice at the end (Miracle.usl:5337-5341).

#### 3.6 sand_trap_bfpw (Tarna_s0)
**TT** (TT 43210): duration 30; **vis 0** (BfPW → 1); level 3; targets VEC3/FGHT/CHTR/ANML/VHCL; icon `quicksand`; description `_deafening`.

**Trigger** Hero.usl:832: only CheckSpecialActionTimer (no transport check). The target is the clicked object's position or the ground point. `DeliverSandTrap` (:1136) requires class `Tarna_s0` and pos ≠ 0, then creates **CQuicksandTask(actor, pos, path, "Aje_Quicksand_Trap")**. The MIRAGE task is missing; walk range, anim and cooldown timing are `?` (Base: walk to ≤30 m, anim "heal_0", StartSpecialActionTimer).

**Spawned object** `Aje_Quicksand_Trap` → **CQuicksand** (M/buildings/Building.usl:7548-7605; aje_buildings.txt:146):
- LIFETIME **30 s**, RADIUS **10 m**, TRAPPED_TIME **7 s**.
- Query types CHTR/ANML/VHCL/SHIP; hidden; not hitable or selectable; buff `owner_hold_units`.
- On enter (CTrap.OnHoldTrap :7153): units whose current enemy is the trap are skipped. Characters (or the transport they are in) and walkable CTransportObj get `TerminateAction` + `SetTrappedHandle(trap)`. The trap reveals itself.
- Release after m_fDuration (7 s, CTrapEffect) → `UntrapHandle`. The enemy-only filter of the query is in CTrap `?`.

#### 3.7 schliemann_sacrifice (schliemann_s0)
**TT** (TT 43265): duration 120 (BfPW 40); vis 1; level 3; targets CHTR/ANML/VHCL/SHIP; owner **Owner + Allies**; `secondaryexcludes schliemann_s0`; icon `schliemann_special_move_1`.
The filter `/Filters/Aje/Upgrades/aje_cook_house/deathshot_visibility` (TT 154538, prio 10000) sets vis 0 and shows `schliemann_deathshoot` instead. Its activator is not in the shipped scripts `?`.

**Trigger** Hero.usl:809: `CheckSpecialActionTimer(path, obj, checkObj=true)`, so obj is required and the excludes are enforced; not in transport. `StartSacrifice` (:907) rejects self, then creates CSacrifice (missing MIRAGE version).

**Effect** (`?` = Base flow, B/task/MayorSpecialMove.usl:296-492): approach to combat range 15, rotate, StartSpecialActionTimer, anim "aje_velo_strike_0". After 0.9 s: HealMe(target HP), boost, then the target dies (DiePerHarakiri).
MIRAGE boost `KleemanDamageBoostStart(hp)` (Hero.usl:923-946, shipped):
```
HealMe(hp, false); EffectFlag KLEEMANN_DAMAGEBOOST on
timer TIMERID 18317 for max(5.0, hp/20) seconds            // KLEEMAN_DAMAGEBOOST_TIME=25 is unused (:20)
EnableFilter "/Filters/Special/Upgrades/schliemann_s0/Sacrifice_Bonus"; DoLevelUpAnim
end: flag off, UpdateGfx, DisableFilter, DoLevelDownAnim
```
Sacrifice_Bonus (TT 254069):
- damage **×3** on schliemann_flintlock_1..5 and schliemann_saber_1..5
- hitpoints **+2000**
- gfx := `schliemann_zombie`
- invents `Sacrifice_Bonus`

Whether `hp` is the victim's current HP is `?` (it was in Base).

#### 3.8 Babbage exo suit: Babbage_ExoMinigun_0 / Babbage_ExoJumpjet_0 (special_mobile_suit)
Context (Hero.usl:1169-1289, Mirage.usl:427-1095): babbage_s0 transforms when it gets `HandleAction("special_mechanization")`:
1. 12 s ascent: godmode, vanished, jetpack, rises 150 m.
2. It is replaced by `special_mobile_suit` (CSpecialMobileSuit, VHCL, size class 10). The suit descends (30 s fallback timer) in godmode and ignores commands while descending.
3. At the swap, the Babbage_Minigun_0 cooldown is copied onto ExoMinigun, and `Babbage_ExoPiercing_0` is put on cooldown.
4. When the suit "dies": "dying" anim, then Babbage respawns at **50% HP** with the `babbage_s0/mechanization` cooldown started. The ExoMinigun cooldown is copied back to Babbage_Minigun_0. If the suit dies in deep water (terrain + 5 < water), Babbage dies.

Suit RangeEffect aura: allies in radius get `BONUS_DAMAGE_BLDG +25%` (Mirage.usl:645-652).

**Babbage_ExoMinigun_0** (TT 43418): duration 120 (Chief ×0.5); vis 1; level 3; target VEC3 or FGHT/BLDG/CHTR/ANML/VHCL/SHIP/NEST, owner Enemies; icon `spmminigun`.
Trigger Mirage.usl:725: Check, not in transport → `SMSMinigun` (:756). CSpecialMinigun (Miracle.usl:7463-7683):
```
Init: needs a target or a ground pos; target owned by the caster -> reject
goto_target: not IsInCombatRange(target) / IsInScapeCombatRange(pos) -> AdvanceAction(.., suit.GetAttackRange(), maxSpeed)
rotate: not in range -> retry goto (max 4 tries); aim point = target pos (re-read here)
        RotateAction; ActivatePiercing(true, 15 s): filter /Filters/Special/Upgrades/xenage/PiercingThrough
             = armorpiercing := 100 on special_mobile_suit_weapon_a..e and special_mobile_suit_gun_a..e (TT 265675)
        StartSpecialActionTimer else abort; MemorizeCurrentFightState(target); unstoppable
throw (8 ticks: counter 0..6 then 7th -> finished, each tick also fires):
   SetSLEAnim("attack_ranged", 4, ...)
   for o in GetPenetratedObjs(aimPos, suit.GetAttackRange(), 30 deg):     // enemies+neutrals, not transported/on wall, hitable
       skip if suit.Disarmed()
       f = clamp(o.curHP * 0.60, 300, 3000) / suit.GetDmg() * 0.125
       o.TakeDmg(suit, projectile=true, f)          // ~ clamp/8 per pulse before armor (armor ignored while piercing)
finished: ActivatePiercing(false); ReturnToFight   (EndTask also turns piercing off)
```
Constants (:7466-7470): RANGE 35 (**unused**), ANGLE 30, DAMAGE_PERCENT 60, MIN 300, MAX 3000. The second `elseif "finished"` branch (:7651) is dead.
Projectile flag: targets inside a blinding storm take 0 (§3.19).

**Babbage_ExoJumpjet_0** (TT 43450): duration 60 (Chief ×0.5); vis 1; level 3; VEC3; icon `Babbage_Jumpjet_0`.
Trigger Mirage.usl:721 → `SMSJumpjet` (:741) → CSpecialJumpjet (Miracle.usl:7316-7461). Also usable by CSeasTerminator.
```
OnEnter: Check else abort; clamp dest to 300 m (GetAdoptedDest)
rotate -> GetFreePos(dest,15) else abort; Check else abort; unstoppable; AnimAction("jumpjet",0,true,false)
jump: dest.z = terrain; SetSLEAnim("jumpjet",9999); RemoveFromWall; JetPackAction(dest)
land_1: SetAnim("jumpjet",2); WaitAction(anim length)
land_2: StartSpecialActionTimer (cooldown starts at landing)
```
The suit is immune to SetIced during "SpecSuitJ" (Mirage.usl:1077). There is no damage.

#### 3.9 mammoth_trumpet (hu_mammoth, hu_mammoth_lumber_upgrade)
**TT** (TT 15125): code Mammoth_Trumpet_Moves_Hu; duration **30** (Chief ×0.5); vis 0 → +1 from upgrade; personal; level 0; self; icon `mammoth_trumpet`; uipos SPEC/UNIT/0.

**Trigger** CMammoth.ReactToGamePlayCommand (Animal.usl:4069): `Find("mammoth_trumpet")` && CheckSpecialActionTimer → `Trumpet()` (:4012) → CMammothTrumpet "MTrumpet" `Init(h, path)` (MIRAGE task missing).

**Effect** `?`. The MIRAGE scripts expose two effects that only the missing task can call:
- `SetTrumpetEffect()` (FightingObj.usl:11778): non-BLDG; EFFECT_MAMMOTH_TRUMPET for **15 s** (TIMER_MAMMOTH_TRUMPET). In CalcAttackBoni (:10019) the flagged unit's **damage ×0.8**.
- `SetRallyEffect(dur)` (:16232): unit-local filter `/Filters/Hu/Upgrades/xenage/rally` (TT 193237) = WeaponDuration ×0.85 for {Aje,Hu,Ninigi,SEAS,Special,World} × {ANML,CHTR(nat/res/tec),SHIP,VHCL}, i.e. ~18% faster attacks. Buff `higher_fighting_freq`; timer RALLY_TRUMP 40177.

Base reference: enemies within 30 m get SetTrumpetEffect; anim "trumpet". Whether MIRAGE also rallies allies, and the rally duration and radius, are `?`.

#### 3.10 Wild_Boar_Rage (hu_wild_boar)
**TT** (TT 15241): duration **15** (Chief ×0.5); vis 0; level 0; location hu_wild_boar; no icon. There is no user dispatcher. Two parts:

**(a) Auto rage attack**, registered in CWildBoar's constructor (Animal.usl:4478-4501). The check runs on fight ticks:
```
class == hu_wild_boar && CheckSpecialActionTimer(path, skipVis) && invention "wild_boar_rage"
&& >= 2 entries of the owner's enemy list within coll+5 m
start: ShakeOff("rage", interval 0.1, offset 1.4, damage 10, endDamage 10, range 8, path, bQ=false, skipVis=true, AILock=false)
```
CShakeOff 9-arg (MIRAGE) is missing. Base ShakeOff semantics (`?`): anim, wait `offset`, knock back CHTR enemies in range, `CAreaDamage(range, dmg, endDmg, owner, pos)` (here 8 m, flat 10 → TakeDirectDmg 10, ranged-armour reduced), then the cooldown (15 s) `?`.

**(b) Passive rage**. `UpdateRageUnit()` (Animal.usl:4503) sets `m_bIsRageUnit` when the invention exists. In `DoHPRelatedStuff` (FightingObj.usl:7387-7408):
- When `hp*(7/3) <= maxHp` (HP ≤ **42.86%**), it enables the unit-local filter `/Filters/Hu/Upgrades/xenage/wild_boar_rage` (TT 193642): `/Modifications/{Hu,Aje,Ninigi,SEAS,Special}/CHTR/Damage/{tec,res,nat}_rel` ×1.5 and `/Modifications/Hu/ANML/Damage/tec_rel` ×1.5. The boar deals ×1.5 damage (same as Base).
- When HP rises above the threshold, the filter is disabled.
- The Base threshold was 25%.

#### 3.11 Hu_Multi_Arrow (hu_archer, hu_zombie_archer)
TT 15891: duration 60, vis 0, level 0, **no icon/uiposition**. An AntiActions filter exists (TT 277889).
**No script references it** (grep finds no `Multi_Arrow` in any .usl). **Does nothing.**

#### 3.12 jetfly_on / jetfly_off (hu_jetpack_warrior)
**TT**:
- jetfly_on (TT 15994): duration 1; vis 0; uipos PROD/UMGR/2; icon `jetfly_on`.
- jetfly_off (TT 16015): duration 1; vis 0; uipos PROD/UMGR/3; icon `jetfly_off`.
- Visibility: hu_fireplace/`final_stage` sets jetfly_on +1 (TT 176198). The unit-local `xenage/jet_flying` filter sets on −1 / off +1 while flying (TT 193067). `xenage/flying_disabled` sets on −1 and `disabled=1`.
- **The server does not check the timer, visibility or level** (Hu.usl:176-183). The TT duration is never used.

**Trigger** CHu (Hu.usl:163-190). It ignores everything except Kill/LevelUp while `m_bJetChange` (rising or sinking).
- `jetfly_on`: not transported and current task ≠ "Jetpack" → `JetPackOn()`.
- `jetfly_off`: not in water, task ≠ "Jetpack", not transported → `JetPackOff()`.

**JetPackOn** (Hu.usl:71-98):
```
StopEverything; attr jet_flying=1; m_bJetChange=1; m_bJetFlying=1; SetCanWalk(0); SetCanFly(1)
ActivateJetpack(true) -> only if class hu_jetpack_warrior: EnableFilter /Filters/Hu/Upgrades/xenage/jet_flying  (FightingObj.usl:15159)
   filter: invent jetpack_on; standanim := sm_jump_01; flying_unit := true;
           weapons: remove hu_sword_a..e, add hu_jetpack_sky_wpn_a..e (slingshot, proj hu_slingshot_stone,
           dmg 10/20/30/50/90, range 30, freq 40, bulletspeed 30) ; parts gfx Hu_Steam_Jet_Pack_On at Back
timer TIMER_JETPACK_RISE 40046 = 3.5 s (then m_bJetChange=0, LinkGFX Back "Hu_Steam_Jet_Pack")
SetSLEAnim("sm_jump_01", 99999); CheckAirTicket (flying_unit attr)
CProduct "jetpack_bag_on" linked at "Back"
MoveAction(to max(terrain, sea) + FLYING_HEIGHT 13.0, speed 5.0); GetBestWeapon
```
While flying:
- Walk targets are lifted to +13 m without the pathfinder (Hu.usl:277-282). Advance goes straight to a point at attack range from the target (:264-275, :308-319). PickUp becomes GoTo.
- The unit is immune to SetIced and refuses BoardTransport (FightingObj.usl:11650).
- It is excluded from area throws and from the CSandTrap slow (flying check).
- Hu Kick/Quake/Roar checks return false.

**JetPackOff** (Hu.usl:100-112):
```
StopEverything; m_bJetChange=1; timer TIMER_JETPACK_SINK 40047 = 3.0 s
SetSLEAnim("sm_jump_01",15); SecondaryMoveAction(ground (>= sea level), 7.0)
on timer: flags off, ActivateJetpack(false), SetCanWalk(1), SetCanFly(0), attr jet_flying=0, delete bag,
          CheckAirTicket, GetBestWeapon
```

#### 3.13 jetleap (12 Hu infantry classes)
**TT** (TT 16060):
- code `jetpack_Moves_Hu`; duration **15** (Chief ×0.5); **vis −1**; VEC3; icon `hu_jetpack`; uipos SPEC/UFOC/1.
- Locations: hu_jetpack_warrior, hu_archer, hu_berserker, hu_druid, hu_flamethrower, hu_killer, hu_marksman, hu_pikeman, hu_spearman, hu_warrior, hu_worker, hu_zombie_warrior.
- Visibility: `/Filters/Special/Upgrades/tesla_s0/Lvl4_tt` and `Lvl5_tt` each **+2** (TT 261158, 261343) → 1.
- `_tt` level filters go to the **player** TT when Tesla reaches that level, and the previous level's filter is removed first (FightingObj.usl:4896-4931, :5106-5124), so vis stays exactly 1 at L4 and L5.
- The same filters set the old `/Actions/Hu/Moves/CHTR/jetpack` vis −2 and unlock hu_jetpack_warrior_2 etc.
- With the server option FreeSpecials, `_tt` filters are skipped at level-up (:4920) `?`.

**Trigger** character.usl:3147: `Find("jetpack") || Find("jetleap")`; `CheckSpecialActionTimer && !inTransport && !JetPackChange()` → `Jetpack(pos)` (:2375). This re-checks, needs pos ≠ 0, and creates CJetpack "Jetpack" with `Init(h, pos, path)` (MIRAGE task missing).

**Effect** `?`: the Base CJetpack (B/task/Jetpack.usl) only allows hu_jetpack_warrior, so MIRAGE must differ. Base flow as reference:
1. Clamp to 100 m.
2. Rotate, link "Hu_Steam_Jet_Pack" at Back.
3. StartSpecialActionTimer, unstoppable.
4. GetFreePos(dest), RemoveFromWall, `JetPackAction(dest)`, anim "sm_jump_01".

There is no damage.

#### 3.14 meteor (hu_druid)
**TT** (TT 16198):
- code meteor_Moves_Hu; duration **90** (Chief ×0.5; mana mode := 10); **manacosts 180**; vis 0 → 1 (upgrade); personal; level 3; inventobjects meteor.
- Targets VEC3/FGHT/BLDG/CHTR/ANML/VHCL/SHIP/NEST; owner Owner+Neutrals+Enemies; icon `meteor`; uipos SPEC/UFOC/2.

**Trigger** character.usl:3024: CheckSpecialActionTimer (incl. mana ≥180 if mana mode) → `MeteoriteImpact(obj, path, pos)` (:2635). It requires class hu_druid. The target is the object pos, else the ground point. Each live **illusion** of the druid also runs MeteoriteImpact; illusions go through the motions but spawn nothing. The task is always added **unqueued**.

**CMeteor** (Miracle.usl:3995-4204). MAGIC_RANGE 40, CMeteorite.IMPACT_RADIUS 30:
```
goto_target: InRange = Abs2(target-pos) <= 30+40+r(self) (=70+r); else AdvanceAction to 70 m of target point
check_pos: !InRange -> EndTask
rotate -> pray: anim "NS2010_poor_beg" (loop mode 3), re-set if it changes
check_time: !InRange -> EndTask (no return; see notes); after 7.0 s -> Meteorite
Meteorite: StartSpecialActionTimer (pays 180 mana) else abort; unstoppable
           dist <= 70+r always holds here -> druid WalkAction to target + dir*(70+r)   (walks back out to 70 m)
           not illusion: CreateObj("hu_meteorite", owner, druidPos + z65)  (CMeteorite, invisible PROD)
                         .Set(target, druid, owner)
```
**CMeteorite** (Mirage.usl:13490-13624):
```
Set: gfx "rolling_stone"; FALL_TIMER 40056 = 3.0 s
Fall: visible, speed lines; target.z -= 2.5; BallisticAction(target, 50.0, 3.0)  (engine; args = speed?/height? ?)
on landing (OnActionEnd):
  new CAreaDamage(druid, 30, MAX_DMG 250, MIN_DMG 250, owner, target, sizeClass 10, piercing 100)
     -> DoAreaDamageForAllAgain (FightingObj.usl:17708): ALL CHTR/SHIP/ANML/VHCL/BLDG/FGHT/NEST of ANY owner
        (own units included), not transported/on wall, hitable, Abs2(o-p)-coll(o) < 30
        o.TakeDirectDmg(250, armorPiercing 100, druid)  -> reduction = clamp(rangedDef - 100, 0, max)  => ~250 flat
     -> InvokeAreaThrow(size 10): throw targets with sizeClass 1..7 (diff 3..9) by 2.0..8.0 m (+0..30%),
        anim hit_back/getting_up, 5 s throw immunity; diff > 9 hits the switch default -> no throw
  FX to every human player: land -> "mrg\t0\t<pos>" + "mrg\t5\t<pos>" (ground z); water -> "mrg\t4\t<sea+2>";
       plus "meteor\t<pos>\t<0|1 water>"
  Delete
```
Units inside a blinding storm (`m_bDarkSwarm`) are **immune** (TakeDirectDmg skip, FightingObj.usl:6464).
Timeline: 7 s prayer + 3 s spawn delay + ballistic flight (`?` s).

#### 3.15 tree_camouflage (hu_druid)
**TT** (TT 16240):
- code tree_camouflage_Moves_Hu; duration 15; **manacosts 20**; vis 0 → 1 (upgrade); personal; level 3; inventobjects tree_camouflage.
- Targets ANML/VEC3; icon `camouflage`; desc `_aje_camouflage`.
- **The upgrade (TT 19295) has vis 0, and the only modifier *replaces* it with 0 (hu_fireplace/age_3, TT 175648). The research button never reaches 1, so the move cannot be unlocked in normal play.**

**Trigger** character.usl:3170: CheckSpecialActionTimer → `EnableHuCamouflage(path, obj, pos, bQ)` (:813). A queued command uses StartCustomTask with subject = clicked obj **or self** (Miracle.usl:6293).
```
class must be hu_druid
gfx = "" ; if obj == null: (pos==0 -> return) gfx = GetCamouflageTree() = "<LevelSetting>_Tree_0" + (1..4 random)  (FightingObj.usl:2784)
CheckManaAndPay(path) else return
attr fake_gfx = gfx; SetGFX(gfx); SetPlaceBlocker(true); SetCanWalk(false); SetCanFly(false); TaskDescription "dcamouflage"
```
Problems:
- **No cooldown is ever started** (no AddSpecialActionTimer).
- **No effect flag is set**, so it gives no stealth, unlike Aje camouflage.
- **No script reverts it.** The druid stays a tree that cannot walk.
- Clicking an ANML or queueing it → `obj != null`, so gfx stays `""` → `SetGFX("")`.

#### 3.16 BrachioStampede (aje_brachiosaurus)
**TT** (TT 4883): duration **30**; vis 0; level 0; location aje_brachiosaurus with **localflags aje_brachiosaurus=1**. This must match the unit's `m_sObjFlag`, so build-up variants are excluded. No icon. Invention `brachiostampede` comes from the aje_small_farm **brachiostomp** upgrade.

**Trigger** auto. It is registered in CBrachiosaurus's constructor (Animal.usl:2474-2479). Check (:2925):
```
class aje_brachiosaurus && !HasBuildUp && rage timer not running && invention brachiostampede
&& current enemy exists && 10 m <= |enemy-pos| (3D) <= FOW range
```
**Effect**:
- Start (:2937): repeating TIMER_RAGETO 7811 every **3.5 s**; walkset "rage".
- Each tick (`BrachioRageTo`, :296-332), for **BRACH_RAGE_DURATION 60 s**:
```
CAreaDamage(range 9.0, dmg = self.GetDmg(), end = GetDmg()/5, owner, pos, sizeClass)  // no attacker obj:
     enemies + neutrals, TakeDirectDmg(dmg*factor) with linear falloff to 20% at 9 m, then area throw
CHTR in owner's enemy list within 7.0 m: SetHitReactionTimer(0, side*10 with z .5)  (right if angle>=0 else left)
```
- Ends (`EndRageTo`, :334): at 60 s, **or on any `AttackEnemy` (:186), or on any `OnActionEnd` (:380)**. It then resets and immediately starts the 30 s cooldown and restores the walkset.
- Mammoth/rhino use the same code (Mammoth_Stampede): RageTo 7 m / end 10, RhinoRageTo 5.5 m / end 8, 2 s ticks, 30 s.

#### 3.17 FeignDeath (19 Aje ANML classes)
TT 4924: duration 30; **vis −2** (+1 from upgrade = −1). Locations: aje_resource_collector, dilophosaurus, ankylosaurus(+catapult), stegosaurus(+transporter), brachiosaurus (+catapult/transporter/siege/mobile_camp), velociraptor_handler, eusmilus, triceratops_archer, allosaurus, atroxosaurus, trade_dino, tyrannosaurus, catapult_rex.
- The dispatchers are **commented out** (Animal.usl:1162-1165, :3564-3567), and `FeignDeathTask` bodies are commented out (:1234-1274, :3581+).
- Only leftovers remain: walk or reveal break a running CFeignDeath (FightingObj.usl:2360, :8211).
- The upgrade button sums to vis 0 (§2).

**Does nothing.**

#### 3.18 RamAttack (aje_ankylosaurus)
TT 5108: duration 120, vis 0, no icon. **The action itself is inert** (no dispatcher). Passive behaviour comes from the `ram` invention (CAnkylosaurus, Animal.usl:2371-2420), re-evaluated on SetCurEnemy, on TT change of `/InventObjects/ram/` and in GetRightHandWeapon:
```
if class aje_ankylosaurus && !HasBuildUp && invented "ram" && curEnemy valid && curEnemy.type != "BLDG":
     weapon = /Objects/Aje/Weapons/aje_ankylosaurus_weapon_ram_<a..e by level 0..4>; SetAttackDirection(pi) (butts backwards)
else: restore normal weapon, attack direction 0
```
**MIRAGE inverts Base**: the ram is used against **non-buildings** (the `=="BLDG"` line is commented, :2373/:2386). The L1 suffix bug is fixed ("a").

Ram weapons (TT 47392-47611):

| | a | b | c | d | e |
|---|---|---|---|---|---|
| damage | 20 | 30 | 60 | 80 | 110 |

- Shared values: range 0.5, freq 30, armorpiercing 50, defense 35, rangeddefense 50 (BLDG +20).
- AttackBonus: ANML −25, CHTR −25, VHCL +25, BLDG −90.
- anim `sm_attack_back` (delay 0.7); fx_class Ram.
- Normal weapon for comparison: 40/50/60/80/120, unit_size 8, AP 0.

#### 3.19 blinding_storm (aje_shaman)
**TT** (TT 5851):
- code blinding_storm_Moves_Aje; duration **60** (Chief ×0.5; mana mode := 10); **manacosts 100**; vis 0 → +1 (upgrade); personal; level 3; inventobjects blinding_storm.
- Targets VEC3/FGHT/BLDG/CHTR/ANML/VHCL/SHIP/NEST (no owner restriction); icon `blinding_storm`; uipos SPEC/UFOC/0.

**Trigger** character.usl:3095: CheckSpecialActionTimer → `BlindingStorm(obj, path, pos)` (:2694). It requires class aje_shaman; the target is the object pos or ground; the task is unqueued.

**CBlindingStorm** (Miracle.usl:2022-2159):
```
goto_target: R = STORM_RADIUS 20 + MiscValues/Aje/Shaman_Cast_Storm (0; +10 with aje_temple "farsight", TT 163286)
             InRange: Abs2 <= 20 + 1 + r(self) + cast bonus ; else AdvanceAction to R of the point
check_pos: !InRange -> EndTask
summon: StartSpecialActionTimer (pays 100 mana) else abort; unstoppable; SetAnim("thanking",1)
        CreateObj("blinding_cloud", casterOwner, target)  -> CSandStorm, gfx fx_dust_twister, tribe World
```
**CSandStorm** (Mirage.usl:10019-10113):
- Constants: STORM_DURATION **15 s**, STORM_RADIUS **20 m** (personal region 20×20×20, flags 010b).
- Not hitable or selectable; ignores ignite and damage.
- Sound "FX_CBlinding_Storm" every 6 s (repeating, first at 6 s).
- Enter: **every CFightingObj, any owner incl. the caster's** (the enemy filter is commented out, :10066), gets `SetMirageFlag(MIRAGE_BLINDING_STORM)`, ref-counted (FightingObj.usl:12037, :12183-12200):
  - `m_bDarkSwarm = true`, buff "sandstorm".
  - Immune to projectile `TakeDmg` (:5810), `TakeDirectDmg` (:6464) and building/turret damage (:13540, :13614). It still takes normal melee TakeDmg.
  - `GetAttackRange()` returns **2.0** (:9222); ranged weapon max range forced to **1.0** (:10558, :10723), so it can only melee.
  - Build-ups (tower turrets etc.) whose parent is in the cloud get attack range 2.0 (BuildUpBase.usl:1193).
- Leave: flag off, buff off. If it had a current enemy and was in a fight, it re-issues `Fight`; else `ExamineEnemies(true, true)`.
- After 15 s: `Die()`. Whether objects still inside get LeaveCloud on deletion is `?` (region teardown).

#### 3.20 bfpw_kick / bfpw_quake / bfpw_roar (aje_warrior)
**TT**:
- bfpw_kick (TT 6162): duration 20.
- bfpw_quake (TT 6175): duration 40.
- bfpw_roar (TT 6188): duration 30.
- All: **no code, no icon**, vis 0 (checked with skipVis), level 0, location aje_warrior.
- Inventions `bfpw_kick/roar/quake` come only from `xenage/bfpw_filters`.

**Trigger** auto (character.usl:250-258 registration; checks :413-478):

| Move | Check | Start (missing task, args exact) |
|---|---|---|
| bfpw_kick | aje_warrior, timer, invention, current enemy valid, `GetAngleToR(enemy) <= 0.39`, `IsInCombatRange(enemy)` | `CResKick.Init(h, curEnemy, path, true)` |
| bfpw_quake | aje_warrior, timer, invention, **≥2** owner-enemy-list entries within coll+5 | `CCharacterBash.Init(h, "res_sm_jump", coll+5, 1.2, 0.1, path, true)` |
| bfpw_roar | same, ≥2 within coll+4 | `CCharacterBash.Init(h, "victory_2", coll+4, 1.2, 0.1, path, true)` |

Effect `?` (Base ResKick / CharacterBash):
- Kick: anim "res_sm_kick", `enemy.TakeDmg(self, 2.0)`, CHTR knockback 0.7 s dir·10.
- Bash: anim, wait 1.2 s, CHTR within R knocked back (0.1 + rnd·spread), then `CAreaDamage(R, GetDmg, GetDmg, owner, pos)`.
- MIRAGE passes the path and skipVis=true, presumably so the task starts the cooldown.

#### 3.21 MountThatUnit (ANML action, all tribes)
TT (Aje 4813, Hu 15063, Ninigi 25076, SEAS 35349):
- vis 1; location `/Objects/<Tribe>/ANML` (matches any ANML via the `Right(4)==type` rule); cat ACTN/0.
- Icon `actbtn_sym_mount_unit`, description `cb_mount_unit`; target CHTR/ANML/VHCL.
- No duration, owner list or level.

**Effect**: the command goes to the **animal** (the transporter). CFightingObj (FightingObj.usl:11198 → `MountThatUnit`, :11718) orders the clicked unit to board it:
```
unit null / not CFightingObj / IsLocked / BLDG / SHIP -> nothing
(portal-terminus and hu_bunker/seas_fortress variants: EnterPortal / EnterBunker)
else unit.BoardTransport(animal, pos, userCmd=true, params, goTo=false, bQ)
```
BoardTransport (FightingObj.usl:11623):
- Rejects when the unit is already transported, or when the owner differs. A different owner is allowed only if allied **and** the server option DiploLocked is on.
- Rejects jetpack-flying or flying units.
- The target must be a CTransportObj; a docked brachio → climb (character.usl:501).

It is the reverse of "click transporter with unit": select the mount, then click the rider. There is no cooldown.

---------------------------------------------------------------------------------------------------

### A.4. Remake notes (oddities, keep or fix deliberately)

1. **Exact `visibility == 1` gate on the server** (MIRAGE only):
   - Jumpjet_0 and sand_trap_bfpw work only in BfPW.
   - reanimation is blocked in BfPW.
   - jetleap needs the Tesla L4/L5 player filter.
   - FeignDeath and tree_camouflage can never be unlocked through the UI.
   - The auto moves (BrachioStampede, Wild_Boar_Rage, bfpw_*) bypass the gate with skipVis.
2. **Level gate is enforced server-side** in MIRAGE (`conditions/level - 1 <= GetLevel()`), unlike Base.
3. **Mana is deducted when the cooldown starts** (AddSpecialActionTimer), not at the click. Meteor 180, blinding_storm 100, tree_camouflage 20 (paid directly). It only applies with the ManaEnabled server option.
4. **Meteor hits everything**, own units and buildings included: 250 flat with 100 armour piercing in 30 m, plus size-class throws. Throws need a size-class difference of 3..9; a difference > 9 falls into the switch default and gives no throw (FightingObj.usl:6159-6171).
5. **Blinding storm affects all units of every owner** in 20 m: no projectile, direct or building damage, melee range only. It also makes them immune to meteor and other TakeDirectDmg sources.
6. BrachioStampede ends on **any** action end or attack. In practice it lasts until the brachio next swings or finishes a walk segment; the cooldown starts at the end.
7. CMeteor `check_time`: `if(!IsInRange()) EndTask();` has no `return` (Miracle.usl:4117-4119). Also the druid always walks back to 70+r m from the impact point after casting.
8. CSpecialMinigun: the `RANGE=35` constant is unused (the suit's own attack range is used), there is a duplicate dead `"finished"` branch, and it fires 8 pulses with damage recomputed from **current** HP each pulse.
9. call_twins spawns at a random angle in a half circle only (`rand%314/100` rad). The twins live 60 s and leave no corpse or spirit.
10. Old reanimation path (CReanimation) calls StartSpecialActionTimer twice (second call is a no-op because the timer exists).
11. Hu Kick/Quake/Roar checks in MIRAGE use `class != "hu_warrior" || class != "hu_jetpack_warrior"` (character.usl:329/386/578), which is always true, so **the Hu auto moves never fire**. The bfpw Aje copies use a correct single-class test.
12. plunder `secondaryexcludes` are species names and are not enforced on the server.
13. Hu `jetfly_on` works on any CHu that receives it, but the flight filter, sky weapons and `IsJetPackOn` behaviour hook only fully applies to hu_jetpack_warrior (`ActivateJetpack` class check).

### A.5. Unverified (`?`) list

- **Missing MIRAGE tasks (§0)**: ResKick, CharacterBash, QuicksandTask, ShakeOff, MammothTrumpet, Jetpack, Sacrifice, Fight. Their exact anims, timings, damage and cooldown placement are unknown. Values shown are the call arguments plus Base behaviour.
- MickDundee from Stina: whether MIRAGE has its own CMickDundeeMove, and whether it works while she is mounted.
- mammoth_trumpet: target set (enemies → SetTrumpetEffect, allies → SetRallyEffect?), radius and rally duration.
- sacrifice: the `hp` passed to KleemanDamageBoostStart, and whether allied targets really die/count.
- `AddResource` return semantics in StealResis (amount not added vs added).
- How `xenage/bfpw_filters` and `aje_cook_house/deathshot_visibility` get enabled (CMirageSrvMgr not shipped). The same applies to the server options UseOldSpirits, GlobalReanim, ManaEnabled, TechtreeSteal, FreeSpecials and DiploLocked.
- `BallisticAction(target, 50, 3)` parameter meaning, so the meteor flight time.
- CSandStorm/CSandTrap region teardown: whether flags are cleared on the cloud's death.
- Client FX mapping for `mrg` indices 0/4/5 (MIRAGE Game scripts are not shipped). MIRAGE ships no `particles.txt` override. The Base particles.txt has no meteor/blinding entries; only `Sandstorm` fx_sandstorm_01/02 (line 467), which is unrelated.


# Part B: Dragon Clan, SEAS

Implementation spec for the JS remake, taken from the MIRAGE server scripts.
- **M/** = `Data/MIRAGE/Scripts/Server/classes`
- **B/** = `Data/Base/Scripts/Server`
- **TT** = MIRAGE `settings/techtree/_TechTree.ttree`. `TT:n` is a line number in that file after latin1→utf8 conversion; the line count is unchanged.
- Costs are written `F/W/S/Sk`. TT `iron` is paid as skulls. An upgrade's `duration` is its research time.
- Levels are 0-based in scripts. "L3" means UI level 3, which is script index 2.
- A `?` marks a value I could not verify. See §5.

> **Important caveat.** The upload contains **no MIRAGE `classes/task/` folder**. MIRAGE calls task classes
> with signatures that the Base versions do not have. For example, it calls `CShakeOff.Init(..., dmg, endDmg, range, path, skipVis)`,
> but `B/classes/task/ANMLSpec.usl:57` only has `Init(h, anim, interval, offset)`. So `CShakeOff` (used by cyborg_tnt and
> triceratops_shake_off) and the Fight task (which calls auto-moves) are described from Base and marked `?`. Every other
> task used below is defined in `M/mirage/Miracle.usl` and is verified.

---------------------------------------------------------------------------------------------------

### B.1. MIRAGE engine rules that differ from Base

### 1.1 Dispatch
MIRAGE uses `ReactToGamePlayCommand(cmd, obj, pos, misc, bQ, bS, bA)`; this takes the place of `HandleGamePlayCommand`. Every class first drops the command if the unit is trapped
(except Kill/LevelUp) or is inside a transport (except LevelUp/LeaveTransport). It then substring-matches `misc` (the TT path):

| Class (unit) | Handler | Matches |
|---|---|---|
| CNinigiTriceratops (ninigi_triceratops) | M/mirage/Mirage.usl:3575-3592 | `"frightening"` |
| CParasaurolophus (ninigi_parasaurolophus_drums) | M/animals/Animal.usl:5022-5039 | `"song_of_valor"` |
| CCharacter (ninigi_monk = CNinigi, seas_medic = CSEAS) | M/character/character.usl:3079-3200 | `"/parasite"` (not illusions), `"/ceasefire"` (not illusions), `"/deplenish"`, `"/suicide"`, `"/deafening"`, `"/contamination"` |
| CSeasRex (seas_rex) | Mirage.usl:3822-3840 | `"cyborg_roar"`, then `"/cyborg_tnt"`. It **always** calls super afterwards, so `stimpack_rex` reaches CTransportObj |
| CTriceratops (seas_triceratops; also the transporter) | Animal.usl:4785-4806 | `"/triceratops_shake_off"`, `"/triceratops_tusk"` (only when `!HasBuildUp()`) |
| CSEAS (all SEAS infantry) | M/character/SEAS.usl:33-52 | `"/stimpack"` (also accepted while transported) |
| CTransportObj (polakanthus, triceratops_transporter, rex, mosasaurus) | M/FightingObj/TransportObj/TransportObj.usl:1617 | `"/stimpack"` |
| CSeasTerminator (seas_mobile_terminator) | Mirage.usl:6532-6553 | `"seas_jumpjet"` |
| CVehicle (all vehicles) | M/FightingObj/TransportObj/Vehicle.usl:69-89 | `"/exocutor_hand"`. Auto-moves are registered in the ctor (:7-18) |
| CLumberjack (seas_lumberjack[_minigun]) | Vehicle.usl:1037-1056 | `"explosives_rounds"`, then super (CVehicle) |

Class mapping (from the class .txt files): seas_triceratops and seas_triceratops_transporter use **CTriceratops**
(`M/misc/seas_products.txt:4,40`). `CSeasTriceratops` (Mirage.usl:4094) is a dead duplicate that no object uses.
seas_mobile_suit is plain **CVehicle**. ninigi_parasaurolophus_drums is CParasaurolophus. seas_polakanthus, seas_rex, seas_mosasaurus and seas_mobile_terminator
use CSeasPolakanthus, CSeasRex, CSeasMosasaurus and CSeasTerminator (mirage_products.txt).

### 1.2 Server-side gate `CheckSpecialActionTimer(path, skipVis=false)` (M/FightingObj/FightingObj.usl:4558-4595)
Base checks only location and cooldown on the server. MIRAGE checks **all** of the following:
```
if mana mode && TT[path/manacosts] > curMana: false            // CheckMana :12526
cond = TT[path/conditions]; if cond && cond.level-1 > unit.level: false   // CheckLevelCondition :15631
CheckTribes: always true (:16756)
if !node.IsVisible(): false              // AntiActions filters (op 'invisible', prio 10000) land here
if !skipVis && TT[path/visibility] != 1: false      // => hidden (not-yet-researched) moves are refused server-side
if TT[path/disabled]==1: false
location test (substring className, or right(4)==type; optional localflags) as in Base
not on cooldown
```
`AddSpecialActionTimer(path)` (:4497) first calls `CheckManaAndPay` (:12537). In mana mode this deducts `manacosts` and fails if there is not enough mana.
It then starts a cooldown of `TT(unit-local)[path/duration]` (default 5), so filter changes to `duration` are applied.
Mana mode is `m_bManaEnabled = CMirageSrvMgr.ManaEnabled()` (:2926), which is a server setting.

### 1.3 Auto moves
`CheckSpecialMoves(enemy, bOnOpenTrp)` (FightingObj.usl:4166) works like Base, but it calls `CheckSpecialActionTimer(path, skipVis=true)`.
Auto moves therefore work while their TT `visibility` is 0. The call sites are in the Fight task, which is not in the upload (`?`; B/ Fight.usl:421/505).

### 1.4 Cooldown modifiers (filters on `.../duration`)
| Filter | When | Effect |
|---|---|---|
| `/Filters/Special/Upgrades/lovelace_s0/Chief_Bonus` | player filter, enabled while hero lovelace_s0 is level index 4 (FightingObj.usl:4932-4937) | `duration ×0.5` for: song_of_valor, frightening, ceasefire, deplenish, triceratops_shake_off, triceratops_tusk, cyborg_roar, cyborg_tnt, **CHTR**/stimpack, parasite, suicide, contamination, deafening, exocutor_hand, explosives_rounds, seas_jumpjet (TT:244300-244475). Not affected: ANML/SHIP stimpack, stimpack_rex, bash_exo, kick_down |
| `/Filters/Ninigi/Upgrades/xenage/mana_enabled` (TT:210662) | mana game setting (the enabling code is not in the upload `?`) | ninigi_monk `mana_user=1`; durations replaced: ceasefire **20**, deplenish **10** (also fireworks 10) |
| `/Filters/SEAS/Upgrades/xenage/mana_enabled` (TT:231751) | same | seas_medic `mana_user=1`; contamination **10**, deafening **10**, parasite **20**, suicide **10** |
| `/Filters/SEAS/Upgrades/xenage/titans_disabled` (TT:232361) | "titans disabled" setting | cyborg_roar/cyborg_tnt moves **and** upgrades `visibility += -2` (hidden) |
| `/Filters/SEAS/Upgrades/xenage/titan_slots` (TT:232431) | "titan slots" setting | seas_rex `max_passengers=2`; `stimpack_rex visibility += 1` |
If mana_enabled and Chief_Bonus are both active, their order is `?`. Both have priority 10 vs `?`.

---------------------------------------------------------------------------------------------------

### B.2. Tech-tree summary

`Sc/Own` = `secondarycontroller` / `secondarycontrollerowner`. "self" means there is no secondarycontroller. All moves have `cat=SPEC`.
Each enabling upgrade's filter does three things: `append /Objects/<T>/InventObjects/<id>/invented=1`, `RemoveMe`, and `add .../Moves/<TYPE>/<id>/visibility 1`.

| id | TT path (line) | CD s | mana | cond.level | Sc / Own | vis | enabled by (building, cost F/W/S/Sk, req, research s) | icon (subcat/menupos) |
|---|---|---|---|---|---|---|---|---|
| frightening | Ninigi/Moves/ANML (TT:25232) | 30 | – | 0 | self | 0 | ninigi_animal_farm/frightening 400/100/0/50, age_4, 35 | frightening (UNIT/2) |
| song_of_valor | Ninigi/Moves/ANML (TT:25255) | 45 | – | 0 | self | 0 | ninigi_animal_farm/song_of_valor 0/200/150/15, age_3, 25 | song_of_valor (UNIT/3) |
| ceasefire | Ninigi/Moves/CHTR (TT:25907) | 90 | 100 | 3 | ANML,BLDG,CHTR,SHIP,VHCL / Owner,Allies | 0 | ninigi_temple/ceasefire 250/150/50/30, age_4, 30 (also removes SEAS `seas_jail_part_01/seas_ceasefire`) | ceasefire (UFOC/1) |
| deplenish | Ninigi/Moves/CHTR (TT:25944) | 60 | 75 | 3 | self | 0 | ninigi_temple/deplenish 200/100/50/15, age_5, 45 (also removes `seas_jail_part_01/seas_deplenish`) | deplenish (UNIT/4) |
| cyborg_roar | SEAS/Moves/ANML (TT:35396) | 60 | – | – | self | 0 | seas_garage/cyborg_roar 400/0/0/80, age_5, 40 | cyborg_roar (UNIT/0) |
| cyborg_tnt | SEAS/Moves/ANML (TT:35421) | 60 | – | – | self | 0 | seas_garage/cyborg_tnt 500/0/0/100, age_5, 40 | cyborg_tnt (UNIT/1) |
| stimpack (ANML) | SEAS/Moves/ANML (TT:35446) @ seas_polakanthus, seas_triceratops_transporter | 5 (unused) | – | 0 | self | 0 | seas_barracks/stimpack 100/100/100/50, age_2, 30 | stimpack (UNIT/2) |
| stimpack (CHTR) | SEAS/Moves/CHTR (TT:36139) @ seas_flamethrower, gunner, marksman, rocketman, warrior, spearman, sniper, mercenary | 5 (unused) | – | 0 | self | 0 | same upgrade | stimpack (UNIT/7) |
| stimpack (SHIP) | SEAS/Moves/SHIP (TT:36460) @ seas_mosasaurus | 5 (unused) | – | 0 | self | 0 | same upgrade | stimpack (UNIT/7) |
| stimpack_rex | SEAS/Moves/ANML (TT:35480) @ seas_rex, `code=stimpack_Moves_SEAS` | 5 (unused) | – | 0 | self | **−1** | stimpack upgrade (+1 → 0, still hidden) **plus** xenage titan_slots (+1 → 1) | stimpack (UNIT/2) |
| triceratops_shake_off | SEAS/Moves/ANML (TT:35505) | 30 | – | – | self | 0 | seas_garage/triceratops_shake_off 300/0/0/50, age_3, 25 | (UNIT/3) |
| triceratops_tusk | SEAS/Moves/ANML (TT:35530) | 60 | – | – | self (needs current enemy) | 0 | seas_garage/triceratops_tusk 350/0/0/40, age_4, 35 | (UNIT/4) |
| contamination | SEAS/Moves/CHTR (TT:36019) | 60 | 90 | 3 | ANML,CHTR / Neutrals,Enemies | 0 | seas_fortress/contamination 200/300/100/40, age_3, 40 | contamination (UFOC/0) |
| deafening | SEAS/Moves/CHTR (TT:36054) | 90 | 90 | 3 | self | 0 | seas_fortress/deafening 200/300/100/60, age_4, 40 | deafening (UNIT/5) |
| parasite | SEAS/Moves/CHTR (TT:36080) | 60 | 60 | 3 | ANML,CHTR,SHIP,VHCL / Neutrals,Enemies | 0 | seas_fortress/parasite 150/100/50/0, age_3, 20 | parasite (UFOC/1) |
| suicide | SEAS/Moves/CHTR (TT:36227) | 90 | 90 | **none** | CHTR,ANML,VHCL,SHIP / Owner | 0 | seas_fortress/suicide 300/200/100/70, age_3, 40 | suicide (UFOC/2) |
| seas_jumpjet | SEAS/Moves/VHCL (TT:36662) @ seas_mobile_terminator | 30 | – | none | VEC3 | **1** | always available | seas_jumpjet (HFOC/0) |
| bash_exo | SEAS/Moves/VHCL (TT:36681) @ seas_mobile_suit | 20 | – | 0 | auto | 0 (never shown) | invention `exo_bash`, **invented=1 from start** (TT:97684) | no icon/description |
| exocutor_hand | SEAS/Moves/VHCL (TT:36695) @ seas_lumberjack | 30 | – | 0 | self | 0 | seas_garage/exocutor_hand 0/200/250/50, age_4, 35 | exocutor_hand (UNIT/9) |
| explosives_rounds | SEAS/Moves/VHCL (TT:36721) @ seas_lumberjack_minigun | 60 | – | 0 | self, toggle | 0 | seas_garage/explosives_rounds 0/100/400/100, age_5, 40 | explosives_rounds (UNIT/10) |
| kick_down | SEAS/Moves/VHCL (TT:36747) @ seas_mobile_suit | 30 | – | 0 | auto | 0 (never shown) | invention `exo_kick`, invented=1 from start | no icon |

Every upgrade action listed above has `visibility=0` and is shown by age filters (for example `seas_headquarters/age_2` → stimpack upgrade, TT:218620).
Every move has an `AntiActions` entry (prio 10000, `op invisible`) under `/Filters/AntiActions/<T>/Moves/...` (TT:280184ff).
`personal='1'` is set on frightening, song_of_valor, deplenish, cyborg_roar, cyborg_tnt, triceratops_shake_off, triceratops_tusk, contamination, parasite, exocutor_hand and explosives_rounds. It is not set on ceasefire, any stimpack, deafening, suicide, seas_jumpjet, bash_exo or kick_down. Its meaning is `?`.

---------------------------------------------------------------------------------------------------

### B.3. Per-move entries

Timing convention: a task's next `USLOnTick` runs after the current action (`AnimAction`/`WaitAction`/walk) finishes. `SetAnim` does not block.
When the code below has no wait between two lines, both happen in the same tick.

#### 3.1 Ninigi

**frightening** (ninigi_triceratops). Manual, self-cast. Dispatch Mirage.usl:3582 → `CheckSpecialActionTimer` → task `CFrightening` (M/mirage/Miracle.usl:958-1059).
```
start_anim: StartSpecialActionTimer else end; MemorizeCurrentFightState; AnimAction("sm_shake_off")
calc_slow:  for o in OwnerEnemyList(owner).CopySorted(pos, 30.0): o.SetFrighteningEffect()   // :1020-1031 (any CFightingObj, incl. buildings)
finished:   ReturnToFight()
Break() = false (uninterruptible)
```
`SetFrighteningEffect()` (FightingObj.usl:16207): it deletes and re-creates `TIMER_FRIGHTENING` with **15 s**, so re-application refreshes the timer and does not stack.
It enables the unit-local filter `/Filters/Ninigi/Upgrades/xenage/frightening` (TT:210202, via `ActivateCustomFilterAndUpdate` :15430) and adds the decal `lower_fighting_rate`.
Filter: `/Modifications/{Aje,Hu,Ninigi,SEAS,Special,World}/{ANML,SHIP,VHCL}/WeaponDuration/tec_rel ×1.5` and `.../CHTR/WeaponDuration/{res,nat,tec}_rel ×1.5`.
In effect the target's **attack interval is ×1.5** (attacks about 33 % slower). On expiry (:3678-3681) the filter is disabled and the decal removed.

**song_of_valor** (ninigi_parasaurolophus_drums). Manual, self-cast. Animal.usl:5029 → `CSongOfValor` (Miracle.usl:1382-1487).
```
start_anim: StartSpecialActionTimer else end; DrumAnim(3) (wagon obj anim "attack_front", mode 3); AnimAction("menace")
calc_dope:  DrumAnim(1)
            q = ANML|CHTR|VHCL, owner = self + friends (AddMyFriendsToSearch), RegionCircle(pos, 30)
            for o in q: o.SetValorEffect(10.0)
            end   (no MemorizeCurrentFightState / ReturnToFight)
```
`SetValorEffect(d)` (FightingObj.usl:16225): refreshes `TIMER_VALOR` to d=**10 s**, enables `/Filters/Ninigi/Upgrades/xenage/valor` (TT:210947) and adds the decal `higher_fighting_rate`.
Filter: the same WeaponDuration paths as frightening, each **×0.9**, so attacks are about 10 % faster. The caster is included.
Unrelated passive: drums wagons also give `EFFECT_PARA_DRUMS` (damage ×1.2, FightingObj.usl:10051) to own and allied non-BLDG units in a 60×60 personal region (Animal.usl:4904, 4967-4988). This is **not** part of the move.

**ceasefire** (ninigi_monk, L3, mana 100). Manual, targeted on an own or allied unit or building (TT). character.usl:3087 → `PeaceGong` (:3230) → `CPeaceGong` (Miracle.usl:4955-5093).
```
PeaceGong: class must be ninigi_monk; CheckSpecialActionTimer; bFriend computed but NOT used (:3234) -> server accepts any owner
OnEnter: CheckSpecialActionTimer else end
goto_target: if !inRange: (on wall -> end) AdvanceAction(target, max(healingRadius,15))   // once, no retry
   inRange = Abs2(t-self) <= max(healingRadius,15) + r(self) + r(t)
perform_magic: SetAnim("affirming_intense", 3)   // looped
check_time: wait until 3.0 s elapsed (still breakable)
gong: SetUnStoppable; StartSpecialActionTimer (pays mana) else end
      target.SetPeaceTime(true, 10.0); CSoundEvent.PlayAll("FX_CPeace_Gong", pos=caster)
```
`SetPeaceTime(on, 10)` (FightingObj.usl:15191):
- It sets `m_bCeaseFire` and attr `peace_time`, adds the decal `peace_gong`, and adds FX `fx_stina_hypnosis_big` linked at +3 z for 10 s.
- It also starts timer `CEASE_FIRE` (expiry :3631 → `SetPeaceTime(false)`: decal removed, `PreCheckForEnemies()`).
- While active:
  - `Damage()`, `ChainDamage()` and `OneHitKilling()` do nothing (:5744, :14526, :14920).
  - Others drop the unit from enemy lists (:6586), and `Fight()` refuses it as a target (:8541).
  - `InvalidEnemy` and `InvalidFighter` are true (:15774, :15810), so its own build-up weapons do not fire (misc/BuildUpBase.usl:1457ff).

**deplenish** (ninigi_monk, L3, mana 75). Manual, **self-centred and instant**. character.usl:3099 → `CurseTransport(path)` (:2728) → `CDeplenish.Init(char, path)`, which starts in state `curse` (Miracle.usl:3551).
```
OnEnter: CheckSpecialActionTimer else end
curse: StartSpecialActionTimer (pays mana) else end
       for o in OwnerEnemyList(owner).CopySorted(pos, 30.0): if o is CTransportObj: o.SetUnboard(true, 15.0)
       CSoundEvent.PlayAll("FX_CUnboardCurse", pos=caster)
```
`SetUnboard(on, 15)` (FightingObj.usl:15222):
- It returns early if `transportclass < 1` (not a transporter) or the transporter sits in deep water (`terrainZ + 5 < seaLevel`).
- Otherwise it calls `Evacuate()` (all passengers dismount), adds the decal `deplenish` (:15239), sets attr `is_cursed=1`, adds FX `Deathping_Char_Fx` linked at +3 z for 15 s, and starts timer `UNBOARD_CURSE`.
- While `HasUnboardEffect()` is true, `OnMount` refuses passengers (TransportObj.usl:1313). Units ordered to board just walk to the click position (FightingObj.usl:11669).
- Expiry (:3633) removes the FX, the decal and `is_cursed`.

The states `perform_magic`/`check_time` (anim `heal_0`, 4 s) are unreachable. A commented-out targeted version (60 s curse) is at :3618-3672.

#### 3.2 SEAS: titans and dinos

**cyborg_roar** (seas_rex). Manual, self-cast. Mirage.usl:3829 → `CyborgRoar("roaring", time=7.0, offset=0.8, radius=12.0, mult=3.0, dur=10.0)` → `CCyborgRoar` (Miracle.usl:6-178).
```
start_anim: StartSpecialActionTimer else end; MemorizeCurrentFightState; SetAnim("roaring",1); len=animLength; WaitAction(0.8)
calc_bonus: q = ANML|CHTR|VHCL, owner = self + friends, RegionCircle(pos, 30.0)       // fZone=30, fDuration=15 hard-coded (:102)
            for o: o.SetCyborgEffect(true, 15.0); WaitAction(len-0.8)
finished: ReturnToFight
```
`SetCyborgEffect` (FightingObj.usl:15114): sets `m_bCyborgBonus` and refreshes timer `RALLY_ROAR` (15 s; expiry :3617).
In `CalcAttackBoni`, `m_bCyborgBonus` gives **damage ×1.5** (:10054), which also shows the generic `more_damage` decal. The rex buffs itself as well.
Unused: the parameters radius 12, mult 3.0 and dur 10 feed only state `do_deafening` (:126-152), which is never entered (line :125 is commented out).
That state would deal `TakeDirectMeleeDmg(dmg×3, AP 100)` and `SetDeafened(10 s)` to enemies within coll+12.

**cyborg_tnt** (seas_rex). Manual, self-cast. Mirage.usl:3833 → `ShakeOff("shake", interval 0.2, offset 0.1, dmg 100, endDmg 100, range 20, path, skipVis=false)` (Animal.usl:1197). The task is CShakeOff, and the MIRAGE version is **missing** (`?`).
Based on the Base CShakeOff (B/classes/task/ANMLSpec.usl:94-150) with these parameters:
```
R = coll + 20; SetAnim("shake",1); WaitAction(0.1)
CHTR enemies (OwnerEnemyList) within R, not transported: knockback(0.1 + rnd(0..0.99)*0.2, dirUp*(3 + rnd(0..6.9)))
CAreaDamage(R, D, D, owner, pos, 0)   // flat, no attacker => TakeDirectDmg (ranged def)   D = 100 (MIRAGE ?) | GetDmg() (Base ignores custom dmg)
wait rest of anim; ReturnToFight; unbreakable
```
When the cooldown starts is `?`. Base never starts it; the MIRAGE signature passes the path, so it presumably calls `StartSpecialActionTimer` in the task.
There is no FX besides the anim (`?`).

**triceratops_shake_off** (seas_triceratops). Manual, self-cast. Animal.usl:4792. It requires `!HasBuildUp()` and `CheckSpecialActionTimer`, then calls `ShakeOff("sm_shake_off", 2.0, 0.4, dmg 50, end 50, range 8, ...)`.
It is the same CShakeOff as cyborg_tnt (`?`): `R = coll+8`, wait 0.4, knockback spread 2.0, flat 50 (or GetDmg) direct damage.

**triceratops_tusk** (seas_triceratops). Manual, but it only fires while the unit is fighting. Animal.usl:4796 → `CheckHook` (:4808) → `StartHook` → `CTriceratopsHook` (Miracle.usl:1489-1605).
```
CheckHook: CheckInvention("triceratops_tusk"); CheckSpecialActionTimer; m_xCurEnemy valid and not own;
           IsInCombatRange(enemy); angleTo(enemy) <= 0.39 rad          // otherwise the click does nothing
OnEnter: CheckSpecialActionTimer && IsInCombatRange else end
start_anim: StartSpecialActionTimer; SetUnStoppable; MemorizeCurrentFightState(target); AnimAction("pawing")
            if target.GetOnWall(): end
            target.ClearDamageCache; target.TakeDmg(self, melee, factor 3.0, hitDelay=self.GetHitDelay(), AP 100); ClearDamageCache
            if target is CHTR && !transported: knockback(0.7, dirUp*10)
finished: ReturnToFight
```
`TakeDmg(...,AP)` (FightingObj.usl:5809) is a normal melee hit. Defense is `clamp(def,0,maxDef) − 100` → usually 0, so the hit is about **3× full damage, ignoring melee armor**.
The damage is applied at anim start (same tick).

**stimpack** (SEAS infantry, polakanthus/triceratops_transporter, mosasaurus; stimpack_rex on rex). Manual, self-cast.
- Infantry: SEAS.usl:44 → `CSEAS.Stimpack()` (:54-70).
- Carriers: TransportObj.usl:1617 → `CTransportObj.Stimpack()` (:2146-2155). The rex path `.../stimpack_rex` matches `"/stimpack"` through `super` (Mirage.usl:3839).
```
CSEAS.Stimpack: if class==seas_medic || m_bStimpack || hp <= 40: return
                DecraseHP(40)  (raw hp -= 40, no armor, :12410); InvokeGenericSCEvent(44, 5.0)
                StimUnit(true); timer TIMER_STIMPACK = 10 s
  on timer: StimUnit(false); InvokeGenericSCEvent(28, 2.0)
StimUnit(on) (FightingObj.usl:15265): toggle unit-local filter /Filters/SEAS/Upgrades/seas_laboratory/marine_stimpack (TT:221652):
                SEAS/CHTR/WeaponDuration/{nat,res,tec}_rel ×0.75    => attacks ~33% faster for 10 s
CTransportObj.Stimpack: return if transportclass==2 (?), trapped (unless ExcludeBuildUp), feign death, or itself transported
                for p in passengers: if p is CSEAS && (p has projectile || p.class==seas_flamethrower): p.Stimpack()
```
- **There is no cooldown or server gate.** Neither path calls `CheckSpecialActionTimer` or `AddSpecialActionTimer`, so the TT `duration=5` is never applied and the invention or visibility is never checked on the server.
- Re-use is limited only by `m_bStimpack` (10 s) and by HP > 40.
- The carrier never stims itself. It stims only ranged SEAS passengers; melee warriors/spearmen are skipped, but they can stim themselves.
- Client FX ids 44 and 28 are not in Base `Game.usl` (MIRAGE client not uploaded, `?`). The FX `aura_stimpack` is commented out.

#### 3.3 SEAS: medic (seas_medic, CSEAS → CCharacter)

**contamination** (L3, mana 90). Targeted: enemy or neutral ANML/CHTR. character.usl:3197 checks `obj != null && CheckSpecialActionTimer` → `Hemoplague(handle, ...)` (:2786, AILock, NewTaskFO) → `CHemoplague` (Miracle.usl:3711-3853).
```
Init: target type must be ANML or CHTR
OnEnter: CheckSpecialActionTimer else end
goto_target: if !inRange: (on wall -> end) AdvanceAction(target, 10)     inRange: dist <= 10 + r(self) + r(t)
throw: if !inRange: retry goto (end after 4 retries)
       else SetUnStoppable; StartSpecialActionTimer (pays mana) else end
            AnimAction("heal_0"); target.SetBloodInfection(true, 20.0)
```
`SetBloodInfection` (FightingObj.usl:14909) sets `m_bBloodInfect` for **20 s** (timer `TIMER_NO_HEALING`, expiry :3582). While it is set:
- **No healing**: `HealMe`, `FountainHeal`, `CureMe` and `SeasWellHeal` return early (:11553, :11597, :12584, :12639), and `GetNoHealing()` is true (:12240).
- **Poison and wound tick damage ×2** (`PoisonDamage` :14174, `WoundDamage` :14740).

There is no decal and no FX. Re-application refreshes the timer.

**deafening** (L3, mana 90). Self-centred, instant. character.usl:3193 → `DeafeningRoar(path, 15.0, bQ)` (:2758-2784).
```
if bQ (shift-queued): StartCustomTask("DeafeningRoar", path) -> later DeafeningRoar(path, m_fRealValue, false)  // radius = 0 (bug, see §4)
AddSpecialActionTimer (pays mana) else return
q = enemies + neutrals (owner -1), types CHTR|SHIP|ANML|VHCL|BLDG|FGHT, RegionCircle(self.pos, 15.0)
for o: o.SetDeafened(true, 15.0)
```
No anim, no FX and no sound.
`SetDeafened` (FightingObj.usl:15093) sets `m_bDeafened` for **15 s** (expiry :3641). While it is set:
- `CFightingObj.HandleGamePlayCommand` drops **every player command** except Kill, LevelUp, Dismount and `crash_rpg_levelup` (:14376). This includes buildings, which then cannot accept production orders `?`.
- `IsUnavailable()` is true (:14488).

The unit keeps fighting on its own AI.

**parasite** (L3, mana 60). Targeted: enemy or neutral ANML/CHTR/SHIP/VHCL. character.usl:3079 (`!m_bIllusion`, `CheckSpecialActionTimer`) → `GiveParasite` (:2664; class must be seas_medic; not queued) → `CParasites` (Miracle.usl:4805-4953).
```
Init: target type in {ANML,CHTR,SHIP,VHCL}
goto_target / throw as contamination but range 30:  inRange = dist <= 30 + r(self) + r(t); 4 retries
throw: SetUnStoppable; StartSpecialActionTimer (pays mana) else end
       p = CreateObj("seas_parasite" (class CParasite, gfx seas_bullet), owner=medic owner, pos=medic)
       AnimAction("tec_sm_cocktail"); p.Set(target); CSoundEvent.PlayAll("FX_CParasite", medic pos)
```
`CParasite` (Mirage.usl:14857-14960) is an unhittable, unselectable `PROD` object:
- `Set(host)`: calls `host.AddParasite` (FightingObj.usl:13923; several parasites per host are allowed), sets gfx `dummy`, links it to the host and sets **`SetFOW(host.GetFOWRange())`**. The medic's owner then **sees whatever the host sees** wherever it goes.
- After **60 s** (`TRACKER_TIMER`) the host gets the decal `parasite_host`, so the victim can see it.
- A life timer `TIMER_PARASITE_LIFE` = `ENERGY` = **480 s** is created but **never handled** (§4), so the parasite lives until the host is deleted. `Delete()` and `RecycledByUpgrade()` call `Removement()` on all parasites (:7589, :15381).

No damage.

**suicide** ("Sacrifice", no level condition, mana 90). Targeted: **own** CHTR/ANML/VHCL/SHIP. character.usl:3162 checks `CheckSpecialActionTimer && obj && !transported` → `StartSuicide` (:3278) → `CWalkingBomb` (Miracle.usl:1607-1776).
```
Init: target type in {ANML,CHTR,VHCL,SHIP} and target.owner == medic.owner (enforced)
OnEnter: CheckSpecialActionTimer else end
goto_target: if !IsInCombatRange(target, extra RANGE=3.0): AdvanceAction(target, 3.0, defaultSpeed)
rotate: if still out of range: retry (end after 4); RotateAction(face target)
        StartSpecialActionTimer (pays mana; cooldown starts here) else end; SetUnStoppable
equip_explosives: medic.EquipTargetWithExplosives()  // only if medic HasAnim("hu_wooden_lance_anim"): link "hu_cannonball" at HndR, SetAnim(that,1)
last_job: wait until 1.0 s (EQUIP_ANIMDELAY) elapsed; ShowWeapons; target.DarkRitual(10.0, sacrificer=Invalid)
```
`DarkRitual(10, x)` (FightingObj.usl:13445):
- Sets `m_bSuicide` → walk set becomes the "hump" (injured) set if the unit has one (:7417). Adds the decal `dark_ritual` and re-issues the current walk at max speed.
- Starts `TIMER_WALKING_BOMB` = **10 s**. The victim stays fully controllable in the meantime.
- On the timer (:3609) → `MakeThemPay()` (:13475):
```
CAreaDamage(Invalid, coll+30, dmg = 0.45*victim.maxHP, end = 0.25*victim.maxHP, owner, pos, sizeClass 10)  // ctor :17692 -> DoAreaDamageForAllAgain :17708
   per target: dist = Abs2 - coll(t); skip if >= R; factor = linear falloff (as Base); TakeDirectDmg(dmg*factor, AP 0) (ranged def); then area throw (size 10)
CreateCustomFX(0, pos)   // sends "mrg\t0\t<pos>" to human players (client FX 0, ?)
victim: hp=0, invisible, SetDead, Delete()   (no corpse/death anim; kill credit = victim's own owner)
```
Target query of `DoAreaDamageForAllAgain`: only `SetOwner(-1,true)` (the enemy/friend adds are commented out, :17715-17716). The author meant **everyone** (friendly fire). Whether the engine's `SetOwner(-1)` means "neutral only" or "any owner" is `?`.

#### 3.4 SEAS: vehicles

**seas_jumpjet** (seas_mobile_terminator; also CSpecialMobileSuit). Manual, ground target. Mirage.usl:6539 checks `CheckSpecialActionTimer && !transported` → `SMSJumpjet(pos)` (needs pos≠0) → `CSpecialJumpjet` "SpecSuitJ" (Miracle.usl:7316-7461).
```
OnEnter: CheckSpecialActionTimer else end; if |dest-pos| > 300: dest = GetAdoptedDest(pos, dest, |dest-pos|-300)  (B/misc/Task.usl:624)
rotate_to_target: RotateAction(face dest)
prepare_to_jump_3: GetFreePos(dest, 15) else end; CheckSpecialActionTimer else end; SetUnStoppable; AnimAction("jumpjet", mode 0, ...)
jump_to_target: dest.z = terrain; SetSLEAnim("jumpjet", 9999 loop); RemoveFromWall; JetPackAction(dest)  // engine ballistic flight
land_1: SetAnim("jumpjet", 2); WaitAction(animLength)
land_2: unstoppable off; StartSpecialActionTimer   // cooldown 30 s starts AFTER landing
```
No damage. Units being area-thrown skip their throw while this task runs (FightingObj.usl:6136).

**bash_exo** (seas_mobile_suit). **Automatic.** Registered first in the CVehicle ctor (Vehicle.usl:9-11).
```
CheckBash (:105): class == seas_mobile_suit; CheckSpecialActionTimer(path, skipVis); CheckInvention("exo_bash") (always 1);
                  >= 3 objects of OwnerEnemyList within coll+5
StartBash -> CExoBash.Init(range=coll+5, timeOffset=1.2, time=0.1, dmg=1.5*GetDmg(), end=1.25*GetDmg())  (Miracle.usl:6522-6684)
start_anim: StartSpecialActionTimer(skipVis) else end; MemorizeCurrentFightState; SetAnim("seas_mobile_suit_sm_0",1); WaitAction(1.2)
calc_dmg: CHTR enemies within R, not transported/on wall: knockback(0.1 + rnd*0.1, dirUp*(1 + rnd(0..3.9)))
          CAreaDamage(R, 1.5*dmg, 1.25*dmg, owner, pos)  // :17531 -> DoAreaDamage: enemies + neutrals, no attacker => TakeDirectDmg (ranged def)
          WaitAction(animLen - 1.2); finished: ReturnToFight; unbreakable
```

**kick_down** (seas_mobile_suit). **Automatic**, checked after bash_exo (Vehicle.usl:12-14).
```
CheckKick (:133): class seas_mobile_suit; CheckSpecialActionTimer(skipVis); CheckInvention("exo_kick") (always 1);
                  current enemy valid; angleTo <= 0.39 rad; IsInCombatRange(enemy)
CExoKick (Miracle.usl:6686-6793): StartSpecialActionTimer(skipVis); MemorizeCurrentFightState; AnimAction("seas_mobile_suit_fm_0")
   if !target.OnWall: target.TakeDmg(self, melee, factor 2.0)       // no hit delay, AP 0
   if CHTR && !transported && !onWall: knockback(0.7, dirUp*10)
   finished: ReturnToFight
```
Both auto moves rely on the Fight task calling `CheckSpecialMoves` for vehicles (`?`, task source missing).

**exocutor_hand** (seas_lumberjack). Manual, self-cast. Vehicle.usl:79 → `ExocutorHand` → `CMKHand` (Miracle.usl:7209-7314).
```
start_anim: StartSpecialActionTimer else end; AnimAction("lumberjack_sm_0")
intimidate: q = enemies + neutrals, CHTR|SHIP|ANML|VHCL|BLDG|FGHT, RegionCircle(pos, 50): o.Intimidate(self, 20.0)
            InvokeAreaThrow(pos, 10.0, owner, sizeClass 10)
Break(): TerminateAction, returns true (breakable during the anim)
```
- `Intimidate` (FightingObj.usl:15517) only stores `m_xIntimidate` for 20 s. `GetIntimidate()` is **never read**, so this has no gameplay effect.
- `InvokeAreaThrow(pos,10,owner,10)` (:6088/:6117) picks enemy and neutral **CHTR/ANML** within 10 m with size class > 0 and not throw-resistant. Then, for each, when the size difference `10 − size ≥ 3`:
  - Units that are transported, using a jetpack, flying, on a wall, in an active Jetpack/SpecSuitJ/PilotFly task, or already falling are skipped.
  - The others get `FallActionDest(pos + dir·str, "hit_back", "getting_up")`, `ToTheGround(3.0)` and throw immunity for 5 s.
  - `str` by size difference (:6160): 3→2.0, 4→3.5, 5→4.0, 6→5.5, 7→6.0, 8→7.0, 9→8.0 (≥9 → 8.0), plus `rnd(0..30 %)`.
- **No damage.**

**explosives_rounds** (seas_lumberjack_minigun). Manual **toggle**. Vehicle.usl:1046 → `CheckSpecialActionTimer` → `ActivateExplosiveRounds(!m_bExplosiveRounds)` (FightingObj.usl:15136; returns unless class is seas_lumberjack_minigun).
```
ON:  EnableFilter /Filters/SEAS/Upgrades/xenage/explosives_rounds; AddFX("titan_fire" (= gfx Fire_Molotov), -1) linked at "FIRE"
     repeating timer ID_EXPLOSIVES_ROUNDS every 1.0 s (:3619):
        self.Damage(15)                                   // through m_fDefenseFactor; can kill itself
        CAreaDamage(10, 100, 50, owner, self.pos)         // enemies+neutrals, falloff 100 -> 50, TakeDirectDmg (ranged def)
OFF: DisableFilter; RemoveFX("titan_fire"); stop timer; AddSpecialActionTimer -> cooldown 60 s starts only now
```
Filter `/Filters/SEAS/Upgrades/xenage/explosives_rounds` (TT:231006, priority 10000, unit-local):

| Change | Value |
|---|---|
| `/Modifications/SEAS/VHCL/{Defence,RangedDefence}/{nat,res,tec}_{abs,rel}` | replace 0 (drops all armor upgrades) |
| melee weapons `seas_lumberjack_minigun_weapon_s_a..e` | damage **+20**, defense/rangeddefense **0**, frequency **+10**, armorpiercing **20** |
| ranged weapons `..._l_a..e` | damage **+10**, defense/rangeddefense **0**, frequency **+5**, Projectile `seas_bullet`→**`seas_rocket`**, unit_size **10**, armorpiercing **10** |

Base weapon stats (level a..e = L1..5): ranged dmg 40/50/60/80/120, melee dmg 80/90/100/120/160, def/rdef 30, frequency l=50 / s=30, range l=30 / s=0.5.
There is no time limit; it stays on until toggled off or the unit dies.

---------------------------------------------------------------------------------------------------

### B.4. Quirks to reproduce or fix deliberately

1. **Stimpack has no cooldown or server checks.** The TT `duration=5` is cosmetic. Spam is limited only by the 10 s stim and HP>40. The medic is excluded in code even though it is not a TT location.
2. **stimpack_rex** stays hidden after the stimpack upgrade (−1+1=0). The "titan_slots" game setting is also needed to show it. The server does not care either way.
3. **Parasite never expires.** The `HandleEvent` second branch checks `TRACKER_TIMER` again where it should check `TIMER_PARASITE_LIFE` (Mirage.usl:4924). The intended lifetime is 480 s.
4. **Deafening queued with shift** runs `DeafeningRoar(path, m_fRealValue)`. The 4-arg `CCustomTask.Init` never sets `m_fRealValue` (Miracle.usl:6158), so the radius is 0 and nothing is hit, but mana and cooldown are still spent.
5. **Exocutor hand "intimidate" does nothing.** `GetIntimidate()` is never read, so only the 10 m knock-down remains.
6. **Ceasefire** server code does not enforce Owner/Allies (`bFriend` unused). The walk is a single `AdvanceAction` with no in-range recheck before the effect. It works on buildings.
7. **cyborg_roar** ignores its radius, multiplier and duration arguments (30 m / 15 s hard-coded). The enemy damage+deafen branch is dead code.
8. **CWalkingBomb** never sets the sacrificer. `xSacrificer` is Invalid and is only assigned `if(xSacrificer.IsValid())` (Miracle.usl:1733-1736). Kills go to the victim's owner.
9. **Suicide** victim friendly-fire depends on `SetOwner(-1,true)` semantics (§5). The equip anim exists only for units with `hu_wooden_lance_anim`, so seas_medic probably shows nothing.
10. **Deplenish** is self-centred, 30 m and 15 s. The TT and icon still look like the older targeted version (60 s). Transporters in deep water (terrain+5 < sea level) are immune, so ships at sea are unaffected.
11. **Frightening** expiry removes decal `lower_fighting_rate`, which is shared with `SetSedated`, so one can hide the other's icon. Re-cast refreshes the timer and does not stack. Valor and cyborg work the same way.
12. **Explosives rounds** cooldown starts at switch-off. While on, the unit burns 15 HP/s and loses all armor. AoE is centred on itself.
13. MIRAGE refuses hidden moves server-side (`visibility != 1`). Auto moves skip that check, which is why bash_exo and kick_down (vis 0, inventions pre-invented) work on every seas_mobile_suit from the start.
14. `CSeasTriceratops` (Mirage.usl:4094) duplicates the tric moves but is unused.

### B.5. Uncertainties
- `CShakeOff` (cyborg_tnt, triceratops_shake_off): the MIRAGE source is missing. I do not know whether the passed damage (100 / 50) replaces `GetDmg()`, where the cooldown starts, or whether there are FX.
- Fight-task call sites of `CheckSpecialMoves` for vehicles: the MIRAGE source is missing.
- `CObjQuery.SetOwner(-1,true)` used alone (suicide explosion): neutrals only, or all owners.
- `transportclass` values (stimpack carrier excludes `==2`).
- Client FX for `InvokeGenericSCEvent(44/28)` and `CreateCustomFX(0)` ("mrg" event): the MIRAGE client scripts are not uploaded.
- Who enables the `xenage/mana_enabled`, `titans_disabled` and `titan_slots` filters (server settings code is not in the upload). The order of mana_enabled vs Chief_Bonus on durations.
- Meaning of TT `personal='1'`.
- Whether deafened buildings really lose production commands (no CBuilding override of `HandleGamePlayCommand` was found, so this is likely).
