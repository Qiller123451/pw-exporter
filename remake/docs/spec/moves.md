# Special moves & abilities — Hu, Aje, Ninigi, SEAS, Special heroes

Implementation spec for the JS remake. Everything here is from the original server scripts
(`Data/Base/Scripts/Server`, abbreviated **S/**) plus the BoosterPack1 tech tree (`techtree.json`, which is
the BP1 `_TechTree.ttree`). BP1 ships **no `.usl` overrides**, only class/techtree data, so all behaviour is Base script.
Client gating comes from `Data/Base/Scripts/Game` (**G/**). AI usage comes from `Data/Base/Scripts/Ai` (**A/**).

Conventions
- **Level**: scripts use a 0-based `m_iLevel`/attr `level` (0..4). The UI shows `level+1`. In this doc "L3" means the UI level 3 (index 2).
- **Costs**: tech-tree `rescosts.iron` is paid as **skulls** (S/misc/RequirementsMgr.usl:535). Written below as `F/W/S/Sk`.
- **Paths**: action ids are `/Actions/<Tribe>/Moves/<TYPE>/<id>`. The server dispatches by **substring** match on that path (see §1.1).
- `coll` = collision radius of the actor, `r(x)` = GetRadius of x. `Abs2` = 2D XY distance.
- A `?` in a table cell means that I could not verify the value in scripts. Each such case is listed in §7.

---------------------------------------------------------------------------------------------------

## 1. Engine rules shared by all moves

### 1.1 Triggering / dispatch
The client sends `HandleGamePlayCommand("Action", targetObj|null, pos, "<TT path>[ params]")`. Each class
tests `p_sMiscParams.Find(...)` in a fixed if/elseif chain and falls through to `super`:

| Class chain | Handler | Moves handled |
|---|---|---|
| CCharacter | S/classes/character/character.usl:2009-2160 | Resurrect, reveal, illusion, entrench, insects, fireworks, Tesla_DstrVhcl_0, Druid_HealAnml_0, termites, tornado, quicksand, lockpicking, Shotgun, Snipershot, jetpack, disguise, camouflage, oracle |
| CHero → CCharacter | S/classes/character/Hero.usl:524-588 | Babbage_Minigun_0, Mayor_Specialmove_0, warden_spec, Ada_DeathShoot, schliemann_deathshoot, schliemann_special_move_1, livingstone_special_move_1 (others fall through to CCharacter) |
| CFightingObj | S/classes/FightingObj/FightingObj.usl:8660-8728 | defensive_mode_on/off (substring `/defensive_mode`), generic Walk/Attack/Stop/Kill/AggroState/AggressiveTarget |
| Animal subclasses | S/classes/animals/Animal.usl (per class, see entries) | AlloScrunch, BrachioStomp, Mammoth_Trumpet, titan_paw, titan_shake_off, rhino_shake_off, doping, Hypnosis, trex_scrunch, trex_roar, barrage, enchain |
| CVehicle (harvester) | S/classes/FightingObj/TransportObj/Vehicle.usl:600 | lacerate |
| CImpResinField (BLDG) | S/classes/buildings/Building.usl:4590 | Burn |

Pre-filters that run in `CCharacter.HandleGamePlayCommand` before the chain (character.usl:1857-1884):
1. If the unit sits in a transporter and the command is forwarded, the transporter handles it.
2. **Illusions** (`m_bIllusion`) skip the whole character chain and go straight to CFightingObj, so they can walk and attack but cannot use moves.
3. Berserking or trapped units ignore everything except Kill/LevelUp.
4. **Aje camouflage** is cancelled by any command that is not `/Walk` or `/camouflage` (:1874). Hero.usl:526 cancels it on any command except `/Walk`.
5. A unit that is digging in or out (`GetEntrenched()==2`) ignores all commands (:1884).

A move whose path matches no branch does nothing. This is the case for `Hu_Multi_Arrow`, `Wild_Boar_Rage`,
`RamAttack` and `StegoBash` (these last three are handled passively or automatically).

### 1.2 Cooldown bookkeeping (`SpecialActionTimer`)
The tech-tree `duration` of a Moves action is its **cooldown in seconds**. It is not a cast time.
```
CheckSpecialActionTimer(path):                       // FightingObj.usl:3194
  locs = TT(unit-local)[path/locations/*]
  ok = any(loc.value contains unit.className  ||  loc.value.right(4) == unit.type)   // e.g. ".../CHTR"
  if !ok return false                                // unit class not a legal location => move unusable
  return path not in m_axActionObj                   // not on cooldown
AddSpecialActionTimer(path):                         // :3160
  if path already running return false
  d = TT(unit-local).GetValueR(path+"/duration", 5.0)   // no modifiers applied
  create one-shot timer (random id 300..349) for d seconds; store {path,start,d}
  attrib "SpecialActionCounters" = lines "hash|start|duration"; "SpecialActionNames" = lines of action names (UI+AI)
ResetSpecialActionTimer(path)                        // :3214  (cancel cooldown)
timer event -> UpdateSpecialActions() removes entry  // :2476, :3130
```
Rules for the remake:
- Cooldowns are per unit. They are keyed by the full TT path string, so the same path id under two tribes would be tracked separately.
- The location test is a **substring** match. `Aje/Moves/CHTR/Matrix` lists `/Objects/Hu/CHTR/hu_spearman`, so `aje_spearman` never passes. **Matrix therefore never fires in the original** (confirmed in both the Base and BP1 ttree). Keep this behaviour, or fix it deliberately.
- Most tasks call `StartSpecialActionTimer()` (Hero.usl:683: check, then add) only at the moment of effect, **after** walking and rotating. If the task is broken before then, no cooldown is spent.
- On resurrection, every Moves action of the new unit's type with duration>0 is put on cooldown (Resurrect.usl:385-395).

### 1.3 Conditions, levels, inventions, visibility (client-side gating)
The server does **not** re-check `conditions/level`, `inventobjects` or `caste` for user-issued moves. The command bar does that:
- A button is shown only if `visibility>0` (upgrade filters flip it: `op add/replace .../visibility 1`) and the unit's class is in `locations`.
- Level: `iMinLevel = conditions/level - 1`, and the button is enabled when `attr level >= iMinLevel` (G/UI/CommandBarEx/CmdButton.usl:278-322). So hero moves (`level=3`) need **L3**, and `level=0` means no requirement.
- Automatic moves re-check the invention on the server (`CRequirementsMgr.CheckInvention(unit, owner, name, tribe)`, which reads `/Objects/<Tribe>/InventObjects/<name>/invented == "1"` in the unit's TT; RequirementsMgr.usl:150).
- `AntiActions` filters (priority 10000, `op invisible`) hide actions when a map or game mode disables them.

### 1.4 Target type (`secondarycontroller`)
`secondarycontroller` lists the pickable target types (`VEC3` = ground position; `FGHT/BLDG/CHTR/ANML/VHCL/SHIP/NEST` = objects).
`secondarycontrollerowner` restricts target ownership (`Enemies`, `Neutrals`, `Owner`, `Allies`). It is enforced **client-side** in G/controller/SecondaryInputController.usl:176-190.
When `secondarycontroller` is `0` or missing, the move is instant and self-cast. Jetpack targets are limited to 100 m client-side (SecondaryInputController.usl:611).

### 1.5 Automatic moves (`m_axAutoSpecialMoves`)
Registered in constructors with a check callback and a start callback (character.usl:200-228; Animal.usl:64, 3102).
Fight.usl:421 and :505 call `CheckSpecialMoves(enemy)` on every hit opportunity while the unit is in combat range and not in a transport.
The **first** entry whose check passes **and** that passes `CheckSpecialActionTimer` starts, and that tick's normal hit is skipped.
Registration order for characters: Matrix, Quake, Roar, Twister, Kick, burst_arrow, multishot. For animals: Mammoth_Stampede, then (stegosaurus only) StegoBash.

### 1.6 Task conventions
All moves run as FSM tasks. Most follow this pattern:
`goto_target` (AdvanceAction / FollowEnemy, up to 3-4 retries) → `rotate` → effect (StartSpecialActionTimer, `SetUnStoppable(true)` so `Break()` returns false) → `finished` → `ReturnToFight()`.
`MemorizeCurrentFightState` saves the current fight so the unit resumes it afterwards.

### 1.7 Damage primitives (use exactly these)
| Primitive | Formula | Ref |
|---|---|---|
| `TakeDmg(att, f)` | normal weapon hit (attacker dmg, armor, bonuses; see combat spec) × f | FightingObj.usl:4040 |
| `TakeDirectDmg(d, ap=0)` | `Damage(d − d·clamp((rangedDef(+tmp) − ap)/100, 0, .99))` | :4554 |
| `TakeDirectMeleeDmg(d, ap=0)` | same, with melee `defense` | :4586 |
| `Damage(d)` | `hp -= max(ceil(d·m_fDefenseFactor), 1)`; ignored in god mode or level-up invulnerability | :4007 |
| `CAreaDamage(range,dmg,end,owner,pos[,size])` | targets: enemies of owner **plus neutrals (owner −1)**, types CHTR/SHIP/ANML/VHCL/BLDG/FGHT/NEST, not transported. `dist = Abs2(pos−t) − coll(t)`; skip if `dist ≥ range`. `factor = (1−end/dmg)·(range−dist)/range + end/dmg`. If the attacker object is known: `TakeDmg(att, factor)`; otherwise `TakeDirectDmg(dmg·factor)`. If size>0, throw units. | :9336-9492 |
| `GetPenetratedObjs(tgt, R, out, angleDeg)` | enemies + neutrals, `dist ≤ R + coll(self) + 2 + innerR(t)`, angle to (tgt−self) ≤ angleDeg/2 | :5892 |
| `Penetrate(enemy, angleDeg)` | `TakeDmg(self)` on all objects from GetPenetratedObjs(enemy.pos, attackRange, angle) | :5879 |
| knockback | `SetHitReactionTimer(delay, dir·force)` (characters only; dir is normalised with z+0.5) | :3943 |
| stun | `SetTrapped(seconds)` or `SetTrapped(handle)` (released by the source) | — |

### 1.8 How buffs are represented
1. **Effect flags** (ref-counted bitset, FightingObj.usl:841-864, SetEffectFlag :1753). The multipliers are applied in `CalcAttackBoni` (:7812) and `AddTemporaryDefenseBoni` (:7894):

| Flag | Effect on the flagged unit | Source |
|---|---|---|
| MAMMOTH_TRUMPET | damage ×0.8 (15 s timer) | Mammoth_Trumpet |
| TRICERATOPS_PAW | damage ×0.8 (15 s) | titan_paw |
| CHTR_WARCRY_3/4/5 | damage ×1.10 / ×1.15 / ×1.20 (highest one only) | warcry aura |
| AJE_WARPAINT_3/4/5 | damage ×0.90 / ×0.85 / ×0.80 (highest one only) | warpaint / mayor aura |
| WILDBOAR_RAGE | damage ×1.15 (**never set by any script**) | — |
| MEGALO_DRUMS | ×1.2 | Megaloceros (not a move) |
| NINIGI_CAULDRON | ×1.25 + enables `/Filters/Ninigi/Upgrades/ninigi_cauldron/change_weapons` | cauldron building |
| RHINO_PENNANT | defense +20 (non-Aje only) | rhino banner |
| AJE_CAMOUFLAGE | camouflage (see Aje camouflage) | camouflage |
| ADA_SLOWHAND, NO_ANIMAL_AGGRO, KLEEMANN_AURA, SKULL_PROTECTOR, KLEEMANN_DAMAGEBOOST | hero auras (§5) | heroes |
Order in CalcAttackBoni: all multipliers first, then `+ Σ BONUS_DAMAGE bucket` (flat).
2. **Temporary tech-tree filters.** `unit.GetTechTreeDef().EnableFilter(path)` / `DisableFilter` on the **unit-local** TT
(hero aura filters, defensive mode, wild boar rage, Kleemann sacrifice). A filter's `Modificators` (`add/replace/multiply/append`) change weapon or object values, and the unit then re-reads its stats (`OnTechTreeChange`).
3. **Bonus buckets.** Appending `/Objects/.../<stat>_<name>_bonus = N` to a unit's TT puts `N` into bucket DAMAGE / DEFENSE / RANGEDDEFENSE / RANGE / BLDGDAMAGE (FightingObj.usl:8110-8136). Values are flat.
4. **UI decals** only: the `BuffDecals` attrib string (`AddRangedBuff("more_damage")`, etc.; :1959). It has no gameplay effect.
5. **Camouflage layers** (ref-counted by type: `disg` ninja, `entr` entrench, `smok` smoker, `hero` Livingstone). `Reveal()` removes `disg` and `entr` (:1682). Enemies do not auto-target a unit with AJE_CAMOUFLAGE unless it is already their current enemy (:4815). A unit with `GetIsVanished()` is never auto-targeted.

---------------------------------------------------------------------------------------------------

## 2. Inventory

Moves actions in the tech tree (BP1):

| Tribe | Total Moves entries | Special (below) | Generic |
|---|---|---|---|
| Special (heroes) | 12 | **12** (11 CHTR + 1 ANML) | 0 |
| Hu | 70 | **18** | 52 |
| Aje | 67 | **14** | 53 |
| Ninigi | 63 | **12** | 51 |
| SEAS | 19 | **0** | 19 |

Generic entries (not special; covered by the unit/command specs): `Attack, Walk, AggressiveTarget, Stop, Kill,
Formation_1..3, AggroState_0..2` per CHTR/ANML/VHCL/SHIP; BLDG `Attack` (towers), `Kill`, `Open/Close/Auto` (gates),
`buy_wood/stone/food` (market, duration 0), Aje `BuildDown` and floating-harbour `Walk`. **SEAS has no special moves at all.**

Enabling upgrades (research costs, F/W/S/Sk, research time):
| Upgrade | Where | Cost | Req | Time |
|---|---|---|---|---|
| kick / roar / quake | hu_arena | 0/50/25/25 · 0/150/75/30 · 0/200/100/50 | age2 / age3 / age4 | 20/25/30 |
| warcry / oracle / insects / illusion | hu_temple | 0/100/100/100 · 200/60/0/25 · 100/60/0/50 · 150/0/40/30 | age2 / age3 / age3 / age4 | 30 |
| wild_boar_rage / rhino_shake_off | hu_small_animal_farm | 250/0/0/40 · 300/0/0/50 | age3 / — | 25/30 |
| mammoth_trumpet / mammoth_stampede | hu_small_animal_farm | 400/0/0/50 · 350/0/0/30 | big_animal_farm+age4 | 35 |
| paw / titan_shake_off | hu_small_animal_farm | 500/0/0/100 · 400/0/0/75 | big_animal_farm+age5 | 40 |
| warpaint / termites / camouflage | aje_temple | 0/100/150/75 · 200/50/0/30 · 150/0/40/25 | age3 | 30 |
| quicksand / tornado | aje_temple | 0/0/150/50 · 0/0/300/150 | age4 / age5 | 30/40 |
| twister / matrix | aje_rodeo | 0/150/75/30 · 0/200/100/50 | age2 / age3 | 25/30 |
| ram / stegosaurus_caudal_bash / brachiostomp | aje_small_farm | 300/0/200/50 · 250/0/0/30 · 400/0/0/50 | — | 40/25/35 |
| allosaurus_scrunch / trex_scrunch / trex_roar | aje_small_farm | 350/0/0/30 · 300/0/0/70 · 500/0/0/100 | age4 / age5 / age5 | 35/40/40 |
| disguise / lockpicking / fireworks | ninigi_temple | 0/100/50/50 · 0/0/200/25 · 0/75/50/30 | age4 / age3 / age3 | 30 |
| burst_arrow / multishot | ninigi_dojo | 0/150/75/30 · 0/200/100/50 | age2 / age4 | 25/30 |
| doping / barrage / enchain | ninigi_animal_farm | 400/0/0/50 · 0/400/250/100 · 0/500/0/75 | age4 / age5 / age5 | 35/40/40 |
| lacerate | ninigi_engineer | 0/350/200/30 | age4 | 35 |
| ship_regeneration | ninigi_harbour | 0/300/150/0 | schliemann_s4 | 30 |
Each upgrade filter sets `/Objects/<T>/InventObjects/<name>/invented=1`, removes its own action (`RemoveMe`) and makes the move visible where applicable.

---------------------------------------------------------------------------------------------------

## 3. Per-move entries

Column key: **At** = location class · **Req** = requirement · **CD** = cooldown (TT duration, s) · **Tgt** = target · **Trig** = user / auto / passive.

### 3.1 Hu (18)

| id | At | Req | CD | Tgt | Trig | Impl |
|---|---|---|---|---|---|---|
| Kick | hu_warrior | inv `kick` | 20 | current enemy | auto | character.usl:282-303, task/ResKick.usl:58-97 |
| Roar | hu_warrior | inv `roar` | 30 | self AoE | auto | character.usl:409-433, task/CharacterBash.usl |
| Quake | hu_warrior | inv `quake` | 40 | self AoE | auto | character.usl:328-349, CharacterBash |
| defensive_mode_on / _off | hu_warrior | — | 0 | toggle | user | FightingObj.usl:8722, 8491-8530 |
| Hu_Multi_Arrow | hu_archer | — | 60 | — | **unimplemented** | no handler (vis 0, no icon) |
| jetpack | hu_jetpack_warrior | — | 17 | VEC3 ≤100 m | user | character.usl:1619, task/Jetpack.usl |
| entrench | hu_undead_warrior | — | 30 | toggle | user | Entrench.usl (no such class is defined; dead) |
| reveal | hu_druid | find_traces+find_traps ability | 5 | self | user | character.usl:2049, :999-1033 |
| oracle | hu_druid | inv `oracle` | 120 | any pos/obj | user | character.usl:2148-2157 |
| insects | hu_druid | inv `insects` | 180 | BLDG (Neutral/Enemy) | user | character.usl:1737, task/Insects.usl, MiscObj.usl:1555 |
| illusion | hu_druid | inv `illusion` | 240 | self | user | character.usl:2055, :1690, :482 |
| Mammoth_Stampede | hu_mammoth | inv `mammoth_stampede` | 30 (**not used**) | auto | auto | Animal.usl:64, 159-230 |
| Mammoth_Trumpet | hu_mammoth | inv `mammoth_trumpet` | 60 | self AoE | user | Animal.usl:2539, 2501; ANMLSpec.usl:763-866 |
| Wild_Boar_Rage | hu_wild_boar | inv `wild_boar_rage` | 60 (unused) | — | passive | FightingObj.usl:5488-5511, Animal.usl:2761 |
| titan_paw | hu_triceratops (CTitanTriceratops) | inv `paw` | 60 | self AoE | user | Animal.usl:2845, 1037; ANMLSpec.usl:869 |
| titan_shake_off | hu_triceratops | inv `titan_shake_off` | 60 | self AoE | user | Animal.usl:2851; ANMLSpec.usl:1-178 |
| rhino_shake_off | hu_rhino | inv `rhino_shake_off` | 60 | self AoE | user | Animal.usl:3364 |

**Kick** (auto). Check: class hu_warrior, invention, a valid current enemy, `angleTo(enemy) ≤ 0.39 rad`, `IsInCombatRange(enemy)`.
```
AddSpecialActionTimer; anim "res_sm_kick"
enemy.TakeDmg(self, 2.0)                                 // double normal hit
if enemy is CHTR && !transported: knockback(delay .7, dirUp*10)
```
**Roar / Quake** (auto; the two are identical apart from range and cooldown). Trigger: ≥3 entries in the owner's enemy list within `coll+4` (Roar) or `coll+5` (Quake).
```
AddSpecialActionTimer; CharacterBash("res_sm_jump", R, timeOffset=1.2, spread=0.1)
  anim; wait 1.2 s
  for enemy CHTR (not transported) within R: knockback(0.1 + rnd(0..1)*0.1, dirUp*(1 + rnd(0..3.9)))
  CAreaDamage(R, dmg=self.GetDmg(), end=dmg, owner, self.pos)   // no attacker object => TakeDirectDmg(dmg), ranged-defense reduced
  wait rest of anim; ReturnToFight
```
**defensive_mode_on/off**: toggles the unit-local filter `/Filters/Hu/Upgrades/hu_warrior/hu_defensive_mode` (TT `results`, class local).
Filter effects: hu_warrior `maxspeed := 2`; `rangeddefense +50` on hu_axe_a..e; `defense +0`; swaps button visibility (on→0, off→1). FX `fx_defensive_mode` while on. No cooldown. The walk target is re-issued so that the speed change applies.

**jetpack**: class hu_jetpack_warrior; target ground point.
```
if |dest−pos| > 100: dest = GetAdoptedDest(pos, dest, |dest−pos|−100)
rotate; link gfx "Hu_Steam_Jet_Pack" at "Back"
StartSpecialActionTimer; unstoppable
accident chance 0% (m_iAccidentPossibility=0; would cost 30% current HP)
GetFreePos(dest) else abort; z = terrain height; RemoveFromWall; JetPackAction(dest)  // engine ballistic jump, anim "sm_jump_01"
```
**reveal**: `FindTracesAndTraps(path, self.pos, find_traces.radius (30))`. It fails for illusions and for units missing either ability.
```
CheckSpecialActionTimer else return; AddSpecialActionTimer; anim "res_guarding"
for enemy CHTR|BLDG within radius: if camouflaged -> Reveal(); if CTrap -> TrapFound(owner)
```
**oracle**: target position `p` (an object target uses its position).
`FindTracesAndTraps(path, p, 20.0)` (this starts the cooldown), then spawn `ShowFOW_Obj` at p with FOW 20 m that is deleted after 10 s. Blocked while in a transport.
AI: A/tasks/AiTaskOracleScouting.usl:97.

**insects**: target must be one of: hu_corn_field, hu_lumberjack_cottage, hu_fireplace, hu_warehouse, aje_bazaar, aje_slaughterhouse, aje_resource_collector,
ninigi_fireplace, ninigi_large_fireplace, ninigi_hunting_lodge, ninigi_paddy, ninigi_storehouse, ninigi_emporium (Insects.usl:13-25).
```
walk until dist ≤ 20 + r(self) + r(target)        // AdvanceAction(target, 20)
StartSpecialActionTimer; anim "nat_throw"
spawn InsectsObj (owner = TARGET's owner) at caster: after 1 s it flies ballistic to the target (speed 20, arc 3)
on landing: every 1 s: target owner food -= 20 (floor 0); stop when 180 s have passed, food hits 0, or the target is gone
```
**illusion**:
```
if Check: AddSpecialActionTimer; anim "heal_0" (if not transported)
repeat 3: offset=(4,0,0) rotated by rnd(0..3.13) rad; spawn same class, same owner, SetLevelClean(caster level)
  MakeIllusion(): lifetime 60 s then Die(); not in unit limit; attr illusion=1; cannot level; heal amount 0;
                  no special moves; no spirit on death (FightingObj.usl:5559)
```
Illusions otherwise fight like the real druid (normal HP and damage). The older `CIllusion` class (character.usl:3075) is not used by this move.

**Mammoth_Stampede** (auto). Check: class hu_mammoth, invention, not already raging, current enemy at a distance between 10 m and FOW range.
The action timer is **never added**; the TT duration of 30 is effectively the rage length.
```
StartRageTo: walkset "rage"; every 2 s for RAGE_DURATION=30 s:
  CAreaDamage(7, self.GetDmg(), end=10, owner, pos, sizeClass)   // falloff to 10 at the edge, throws units
  CHTR enemies within 7 m: knockback(0, left-or-right*10 (+z .5)), side chosen by angle sign
after 30 s: restore walkset; it can retrigger immediately
```
**Mammoth_Trumpet**: anim "trumpet". Every object in the enemy list within 30 m gets `SetTrumpetEffect()`, i.e. damage ×0.8 for 15 s (not buildings). The cooldown is added only if the task started.
**titan_paw**: anim "pawing". Enemies within 30 m get `SetPawEffect()`, i.e. damage ×0.8 for 15 s.
**titan_shake_off / rhino_shake_off**: `ShakeOff(anim, spread, offset)` with ("titan_rage", 1.8, 0.1) and ("sm_shake_off", 2.0, 0.4):
```
R = coll+5; anim; wait offset
CHTR enemies within R (not transported): knockback(offset + rnd*spread, dirUp*(3 + rnd(0..6.9)))
CAreaDamage(R, self.GetDmg(), self.GetDmg(), owner, pos, 0)  // flat, direct
```
**Wild_Boar_Rage** (passive, FightingObj.usl:5488): a boar with the invention (`SetRageUnit(true)`) at `hp*4 ≤ maxhp` enables the local filter
`/Filters/Hu/Upgrades/hu_wild_boar/wild_boar_rage`: `/Modifications/{Hu,Aje,Ninigi,SEAS,Special}/CHTR/Damage/{tec,res,nat}_rel ×1.5` and `Hu/ANML/Damage/tec_rel ×1.5`.
In effect the boar deals ×1.5 damage. The filter is disabled again when HP rises above 25%.

### 3.2 Aje (14)

| id | At | Req | CD | Tgt | Trig | Impl |
|---|---|---|---|---|---|---|
| Twister | aje_spearman | inv `twister` | 30 | self AoE | auto | character.usl:305-326 |
| Matrix | *hu_spearman* (TT bug) | inv `matrix` | 40 | self AoE | auto, **never fires** | character.usl:360-381 |
| Resurrect | aje_shaman | — | 20 | spirit (Owner/Allies) | user | character.usl:2010, 2215; task/Resurrect.usl |
| reveal | aje_shaman | abilities | 5 | self | user | as Hu reveal |
| termites | aje_shaman | inv `termites` | 60 | BLDG not own | user | character.usl:1749; Termites.usl; MiscObj.usl:1688 |
| camouflage | aje_shaman | inv `camouflage` | 15 (starts when camo ends) | self toggle | user | character.usl:2140, 531; FightingObj.usl:1850-1920 |
| quicksand | aje_shaman | inv `quicksand` | 90 | VEC3 or unit pos | user | QuicksandTask.usl; Building.usl:4725 |
| tornado | aje_shaman | inv `tornado` | 180 | VEC3 or unit pos | user | Tornado.usl; MiscObj.usl:1731 |
| AlloScrunch | aje_allosaurus | inv `allosaurus_scrunch` | 60 | current enemy | user | Animal.usl:1457-1511; ANMLSpec.usl:630 |
| RamAttack | aje_ankylosaurus | inv `ram` | 120 | — | passive weapon swap | Animal.usl:1628-1680 |
| BrachioStomp | aje_brachiosaurus | inv `brachiostomp` | 60 | self AoE | user | Animal.usl:1919-1953; ANMLSpec.usl:325 |
| StegoBash | aje_stegosaurus | inv `stegosaurus_caudal_bash` | 60 | self AoE | auto | Animal.usl:3102-3128 |
| trex_scrunch | aje_atroxosaurus (CAjeTrex) | inv `trex_scrunch` | 60 | self AoE | user | Animal.usl:4241 |
| trex_roar | aje_atroxosaurus | inv `trex_roar` | 60 | self AoE | user | Animal.usl:4247; ANMLSpec.usl:181 |

**Twister / Matrix** (auto): ≥3 enemies within `coll+4` (Twister) or `coll+6` (Matrix).
`CharacterBash("nat_sm_twister", coll+4, 0.6, 0.2)` / `("nat_sm_matrix", coll+6, 1.0, 0.6)`. The effect is the same as Roar (flat GetDmg AoE plus knockback).

**Resurrect**: command params `"<path> <spiritHandle>"`. The shaman must be off cooldown (checked at start).
```
walk to within 22 + r(spirit)  (AdvanceAction to 20)
if spirit already in resurrect mode -> abort; spirit.SetRessurectMode(true)
if !CheckUnits(spiritOwner, spiritLevel) -> abort                        // unit-limit slot at that level
reserve virtual unit (+1 virtual_units_<lvl>, pyramid card placeholder)
anim "praying_wall" (loop) for spirit.GetResurrectDuration() (engine value ?) + 1.5 s
Resurrect(): if the owner already has an NPC hero of that class -> fail
  spawn spirit.class at spirit pos/rot, owner=spirit owner, SetLevelClean(spirit level), restore spirit TT filters (except *_RemoveMe)
  put ALL of the unit's Moves (duration>0) on cooldown; register a hero with NPCMgr; delete spirit
StartSpecialActionTimer (20 s)
Break during channel: undo reservation, ResetSpecialActionTimer, release spirit
```
While camouflaged, starting any of Resurrect, termites or tornado cancels the camouflage.

**termites**: target must be a BLDG not owned by the caster. Walk into range `(20 + r(self) + 2·r(target))²` (the target radius is counted twice; a bug).
StartSpecialActionTimer, anim "termites". Spawn TermitesObj, which lands after 1 s and then deals `TakeDirectMeleeDmg(25, casterOwner)` to the building **every 1 s for 120 s** (3000 total before defense). It stops early if the building is gone.

**camouflage**: toggle. The dispatcher checks the cooldown; if already camouflaged it turns camouflage off, otherwise `EnableAjeCamouflage` (class aje_shaman, re-checks cooldown).
While on:
- GFX is swapped to the map's creep animal (level GenericData `CamCreep`, else by setting: Jungle→Parasaurolophus, Northland/Icewaste→Megaloceros, Savanna→Maiasauria, Ashvalley→Iguanodon).
- Equipment is hidden, attr `active_camouflage=1`, idle ticks are skipped.
- Enemies do not pick the unit as a new target.
- Cancelled by: any non-Walk command, taking any damage (`TakeDmg` start, FightingObj.usl:4041), or starting termites, tornado or resurrect.
When the flag drops: normal GFX again, and **then** `AddSpecialActionTimer(camouflage)` starts the 15 s cooldown. There is no maximum duration.

**quicksand**: target position ≤32 m from the shaman (walks to within 30 m first). StartSpecialActionTimer, anim "heal_0".
Spawns `Aje_Quicksand_Trap` (CQuicksand), which lasts **30 s** with radius **8 m**. CHTR/ANML/VHCL/SHIP of every other player (non-neutral; enemy-only filter flag ?) that are inside get `TerminateAction` and are held (`SetTrapped(trap)`) for **5 s** each, then released. The trap is invisible and not hitable.

**tornado**: target position ≤32 m (walk to within 30 m first). StartSpecialActionTimer, anim "tornado".
```
TornadoObj.Set(p): victims = (owner enemy list ∪ neutral CHTR/SHIP/ANML/VHCL/NEST/FGHT) with Abs2(t−p)−coll(t) ≤ 10
   (the victim set is fixed at creation; later arrivals are not affected)
  movable -> "movable" list, others (buildings etc.) -> "static"; all SetTrapped(tornado)
tick at t=0 and then every 1 s while (now−start) ≤ 10 s  (≈11 ticks):
  movable: TakeDirectMeleeDmg(clamp(curHP*0.05, 30, 200), owner)
  static : TakeDirectMeleeDmg(clamp(curHP*0.025, 30, 200), owner)
end: release all, delete
```
**AlloScrunch**: user-triggered, with no target picking. It uses the allosaurus' **current enemy**, which must be a non-own unit in combat range and within 0.39 rad in front.
StartSpecialActionTimer, anim "sm_scrunch", `enemy.TakeDmg(self, 2.0)`, CHTR knockback (0.7 s, dirUp·10).

**RamAttack** (passive): an aje_ankylosaurus with `ram` invented, no build-up, and a BLDG as current enemy switches its weapon to `aje_ankylosaurus_weapon_ram_<b..e>`
(damage 100/110/130/170 vs normal 50/60/80/120; same frequency 30, range 0.5) and sets attack direction π (butts backwards).
L1 gets the path suffix "" (a bug, so there is no ram weapon at L1). The TT move itself is inert.

**BrachioStomp**: DestroyTheWoods needs the invention and an off-cooldown timer. The dispatcher then adds the cooldown.
```
anim "stomp_harvest"; wait 1.8 s
every tree within 15 m of the brachio (forest mgr) -> replaced by a "<Setting>_Tree_0N_Timber" object falling away (chop anims)
for enemy in enemy list within 20 m:
  d = Abs2 distance; TakeDirectMeleeDmg(100 * d/20)       // INVERTED falloff: 0 at center, 100 at 20 m (sic)
  if size class 1..7 and not transported: knockback(0, dir*10, z .5)
```
**StegoBash** (auto): ≥**4** enemies within coll+5. `ShakeOff("sm_attack_back", 0.1, 1.4)` (see titan_shake_off).
**trex_scrunch**: `ShakeOff("trex_fm_2", 0.2, 2.0)`.
**trex_roar**: `StunningRoar("menace", 7.0, 0.8)`: after 0.8 s, every non-transported object in the enemy list within `coll+10` gets `SetTrapped(7 s)` and anim "standanim". There is no damage.

### 3.3 Ninigi (12)

| id | At | Req | CD | Tgt | Trig | Impl |
|---|---|---|---|---|---|---|
| entrench | ninigi_worker, archer, warrior, ninja, sumo, spearman, monk, icespearman, mortar, marksman | — | 30 (starts at dig-out) | toggle | user | character.usl:1713; task/Entrench.usl |
| reveal | ninigi_monk | abilities | 5 | self | user | as Hu |
| disguise | ninigi_ninja | inv `disguise`, caste res | 60 | self | **passive** (move stays vis 0) | FightingObj.usl:4516-4530; character.usl:1680 |
| lockpicking | ninigi_ninja | inv `lockpicking`, caste res | 30 (**never applied**) | enemy gate | user | character.usl:1799; LockPicking.usl |
| fireworks | ninigi_monk | inv `fireworks`, caste nat | 60 | self | user | FightingObj.usl:5744; Fireworks.usl |
| burst_arrow | ninigi_archer | inv `burst_arrow` | 40 | current enemy | auto | character.usl:250-280; ShootBurstArrow.usl; Product.usl:184 |
| multishot | ninigi_archer | inv `multishot` | 50 | current enemy | auto | character.usl:231-248; ShootMultiShot.usl; Product.usl:301 |
| Burn | ninigi_resin_field (BLDG) | — | 40 | self | user | Building.usl:4567-4719 |
| doping | ninigi_saltasaurus_archer | inv `doping` | 60 | self | user | Animal.usl:3424-3472 |
| barrage | ninigi_seismosaurus | inv `barrage` | 60 | self AoE | user | Animal.usl:4326-4333 |
| enchain | ninigi_seismosaurus | inv `enchain` | 60 | enemy CHTR/ANML/VHCL | user | Animal.usl:4334, 4346; ANMLSpec.usl:974 |
| lacerate | ninigi_harvester | inv `lacerate` | 60 | current enemy (needed) | user | Vehicle.usl:600-625; VHCLSpec.usl |

**entrench**: toggle.
```
state 0 -> (cooldown must be free) TerminateAction; task: anim "digandhide"; SetEntrenched(2) for 3 s (commands ignored)
        -> SetEntrenched(1): camouflage layer "entr", dynamic bbox, WaitAction(forever), no shadow, buff is_camouflaged, attr active_entrench
state 1 + command 'entrench' again OR any TakeDmg (character.usl:2628) -> dig out:
        StartSpecialActionTimer (30 s); SetEntrenched(2); anim "hideandstand" 3 s; SetEntrenched(0); restore 'disg' camo if any
```
The entrenched unit is hidden (camouflage) and does nothing else. `Reveal()` strips the `entr` layer but the unit stays dug in. Whether it can shoot while dug in is uncertain (it cannot move because of the infinite WaitAction). The Ninigi filter `no_entrench` can hide the move.

**disguise** (passive once `disguise` is invented; `CanDisguise()` = ninigi_ninja with the invention, or always for ninigi_muraeno_submarine):
- On spawn or invention: `SetAggressionState(1)` and camouflage layer `disg`, i.e. invisible to enemies (FX fx_ninja_disguise, attr active_disguise).
- Lost when the ninja attacks (`AttackEnemy` removes disg, character.usl:2395) or when revealed.
- Taking damage restarts a 10 s `CAMO_TIMER`. While it runs, re-camouflage is deferred. `EndFight` re-adds disg afterwards.
- LockPicking removes disg for its duration.
- The explicit move path (vis 0, so AI only) calls `StartDisguise`: 60 s cooldown, `SetDisguised(true)` (engine) and `SetCamouflage(true)`.

**lockpicking**: target must be a closed `CGate`. Walk to `4 + r(gate)` (wall-walk if the ninja is on a wall), remove disg, `AddHacker`,
play "potter" for **15 s** (character.usl:1806), then `gate.OpenViolently(false)`. The cooldown line is commented out, so **there is no cooldown**.

**fireworks**: class ninigi_monk. Anim "potter_ground". Spawn `ninigi_fireworks` (CFireWorkObj) at the monk position (1.5 m in front if on a wall): **FOW radius 100 m for 10 s** for the owner.
The monk then steps 3 m in −X and rotates. The cooldown starts when the task is created. `RANGE=150` is unused. No other effect was found in the scripts.

**burst_arrow** (auto): class ninigi_archer, invention, current enemy, and ≥3 enemies within `coll(enemy)+5` of the enemy.
Walk until in range (`attackRange+2+r(t)`, 3 retries), rotate, StartSpecialActionTimer, anim "tec_sm_burst_arrow".
It shoots `Aje_Burst_Arrow`; on impact `CAreaDamage(fighter, impactPos, 5 + coll(enemy), sizeClass)`, i.e. the archer's normal damage with a linear falloff from `damage` to `enddamage`, applied via TakeDmg.

**multishot** (auto): class ninigi_archer and invention only (no crowd check). AddSpecialActionTimer runs at **start**, not at the shot. Walk/rotate as for burst_arrow, anim "tec_sm_multishot".
The `Hu_Multi_Arrow` projectile shows 3 visual arrows (0°, ±5°) and immediately calls `Penetrate(enemy, 10°)`: every enemy or neutral in a 10° cone within attack range (+coll+2+inner radius) gets a normal `TakeDmg(self)`.
When the main projectile lands it deals normal damage to the target again (target is hit twice ?).

**Burn** (resin field, BLDG): with the cooldown free, AddSpecialActionTimer; GFX `ninigi_resin_field_fire`; lasts 30 s.
On the first 1 s tick it ignites every own finished `ninigi_resin_field` within 13 m (each uses its own cooldown). Every 1 s, enemy ANML/CHTR/VHCL/SHIP within the field's weapon `hitrange` get `TakeDmg(field)`.
After 30 s: back to normal GFX, then `StartDelayTimer(20)` (re-arm delay). The AI triggers this in A/goals/AiGoalGuardVillage.usl:1102.

**doping**: 7 s during which `Damage()` is ignored completely (invulnerable). FX `fx_saltasaurus_doping`.
**barrage**: `ShakeOff("idle_1", 2.0, 1.0, 350, 100, 25)`, i.e. R = coll+25, knockback plus `CAreaDamage(R, GetDmg, GetDmg)` flat.
**Quirk:** the custom 350/100 damage is stored but never used (ANMLSpec.usl:106 uses GetDmg). Plus FX `fx_ninigi_seismo_barrage` (2.8 s).
**enchain**: target unit. If not in combat range, FollowEnemy. The weapon build-up rotates to the target. Then StartSpecialActionTimer, `target.SetTrapped(20 s)`, trapped GFX `ninigi_seismo_trap` 20 s, `TerminateAction`. There is no damage.
**lacerate**: requires a current enemy. Anim "harvest"×2, wait 0.6 s; then every object from `GetPenetratedObjs(enemyPos, coll+4, 120°)` gets `TakeDirectMeleeDmg(200)`.

### 3.4 SEAS
No Moves actions besides generic ones. SEAS passives: seas_medic heal (§4) and transporters (§4).

### 3.5 Special / heroes (12). All have `conditions.level=3` (UI L3+). Blocked while in a transport.

| id | At | CD | Tgt | Impl |
|---|---|---|---|---|
| Shotgun | Cole_s0 | 60 | VEC3 or enemy obj | character.usl:2115, 1603; Shotgun.usl:1-386 |
| Snipershot | Bela_s0 | 60 | enemy obj | character.usl:2119, 1631; Throwdownshot.usl; Product.usl:252 |
| Tesla_DstrVhcl_0 | tesla_s0 | 40 | enemy VHCL | character.usl:2072, 383; DestroyVHCL.usl |
| Druid_HealAnml_0 | hermit_s0 | 180 | self | character.usl:2076, 397; HealANML.usl |
| Babbage_Minigun_0 | babbage_s0 | 60 | VEC3 or enemy obj | Hero.usl:540, 590; BabbageMinigun.usl |
| Mayor_Specialmove_0 | mayor_s0 | 60 | self | Hero.usl:549, 486; MayorSpecialMove.usl:1-157 |
| warden_spec | darwin_s0 | 60 | self | Hero.usl:553, 505; MayorSpecialMove.usl:159-294 |
| Ada_DeathShoot | lovelace_s0 | 180 | enemy FGHT/CHTR/ANML/VHCL/SHIP | Hero.usl:557, 603; Shotgun.usl:388-535; Product.usl:203 |
| schliemann_deathshoot | schliemann_s0 | 240 | same (vis 0, AI only) | same as Ada |
| schliemann_special_move_1 | schliemann_s0 | 120 | own CHTR/ANML/VHCL/SHIP | Hero.usl:565, 612, 619; MayorSpecialMove.usl:296-492 |
| livingstone_special_move_1 | livingstone_s0 | 120 | self | Hero.usl:569, 380-425 |
| Hypnosis | special_eusmilus | 60 | enemy ANML | Animal.usl:3957-3981; MickDundeeMove.usl |

**Shotgun** (Cole; range 15; collateral radius 8):
```
walk until dist ≤ r(t)+r(self)+r(t)+15 (or ≤ 20 from a ground point); link gfx "Cole_Shotgun"
collateral = enemies (CHTR/ANML/VHCL/NEST/BLDG/FGHT) within 8 m of target/ground point, excl. main + transported
StartSpecialActionTimer; anim "shotgun"; trigger "shotgun"
knockback: main (CHTR, smaller size class) 1.95 s, dir*9; collateral CHTR 1.95+rnd .15 s, dir*(6+rnd 0..3)
dmg(t) = clamp( (t is BLDG|NEST ? 10% : 50%) * curHP(t), 200, 2000 ); TakeDirectDmg(dmg, owner)  for main and each collateral
main target is then ordered to attack Cole (/AttackSrv)
```
**Snipershot** (Bela): approach until `IsInCombatRange(t, range 50)`, rotate, StartSpecialActionTimer, anim "throwdownshot".
It shoots `bela_special_arrow` (CSniperArrow): `TakeDirectDmg(clamp(50% curHP, 500, 2000), owner)`. If broken before firing, `ResetSpecialActionTimer`.

**Tesla_DstrVhcl_0**: the target must be a CVehicle. AdvanceAction to r(vehicle), StartSpecialActionTimer, anim "potter", then `TakeDirectMeleeDmg(999999.9)` (instant kill, only 99% defense could reduce it).
**Druid_HealAnml_0** (hermit): StartSpecialActionTimer; anim "heal_0"×5; FX `fx_hermite_heal` 10 s; then `FullHeal()` on every **own** ANML within 40 m.
**Babbage_Minigun_0**: approach until in combat range of the target or ground point, link "babbage_minigun" to the right hand, rotate, StartSpecialActionTimer.
It then fires **8 pulses** (loop anim "babbage_minigun" 4×). Each pulse: for every object in `GetPenetratedObjs(pos, 35, 30°)`:
`TakeDmg(self, clamp(30%·curHP, 150, 2000) / self.GetDmg() · 0.125)`, which totals about one clamp value per victim after armor.
The "finished" branch sets state "EndTask", which has no handler (ReturnToFight replaces the task).
**Mayor_Specialmove_0**: StartSpecialActionTimer, anim "res_sm_jump". Every non-transported object in the enemy list within **6 m**: `TakeDirectMeleeDmg(clamp(25% curHP, 300, 2000), owner)`; CHTR also get knockback (0.1–1.6 s, dir·1–4.9).
**warden_spec** (Darwin): StartSpecialActionTimer, anim "warden_spec". Own and allied CHTR/ANML/VHCL/SHIP within 20 m get `StartANMLImmunityTimer()`: **7 s** in which all damage from ANML attackers is 0 (FightingObj.usl:2229, 4046).
**Ada_DeathShoot / schliemann_deathshoot**: walk to ≤40 m (at most 10 advance attempts), rotate, StartSpecialActionTimer, anim "lovelace_musket".
It shoots `ada_special_arrow` (CAdaArrow): `TakeDirectDmg(clamp(90% curHP, 1500, 5500), ap=shooter.armorPiercing, owner)`.
**schliemann_special_move_1 (Sacrifice)**: the target must be an **own** unit. Approach to combat range 15, rotate, StartSpecialActionTimer, anim "aje_velo_strike_0".
After 0.9 s: `self.HealMe(target.curHP)`, `KleemanDamageBoostStart()`, target dies (DiePerHarakiri; counted as own kill).
Boost: 10 s filter `/Filters/Special/Upgrades/schliemann_s0/Sacrifice_Bonus`, which gives **damage ×2** on schliemann_flintlock_3..5 and schliemann_saber_3..5.
**livingstone_special_move_1 (Vanish)**: 10 s. AddCamouflageEffect("hero"), `SetIsVanished(true)` (not auto-targeted), FX fx_ninja_disguise. His aura damage-over-time and drain are suspended while vanished.
**Hypnosis** (special_eusmilus = Stina's cat; target ANML): approach to `r+r+10` (speed 4), StartSpecialActionTimer, anim "sm_01".
After 2.6 s the target plays "rest" and is `SetTrapped(20 s)`. The task ends at 3.4 s.

Not in the tech tree but reachable: `TeslaLvl16Task` (Hero.usl:544, campaign), `CSweepingBlow` (FightingObj.usl:5756; **never called**; 7.5 m, 100→10 dmg).

---------------------------------------------------------------------------------------------------

## 4. Passive / automatic abilities (`special_abilities` + upgrade-driven)

`m_xAbilities.AddAbilities(TT[objPath/special_abilities])` runs on every TT change (FightingObj.usl:8204). A block with `enabled=false` is ignored.

| Unit | Ability | Base values | Level filters (exclusive: `LvlN_Bonus` of the current level only, FightingObj.usl:3346, 3506) |
|---|---|---|---|
| hu_druid | heal r30, amount 5, mod .25; find_traces/traps r30 delay 2 | | L3 amount +15 (=20), L4 +20 (=25), L5 +25 (=30) |
| ninigi_monk | same as druid | | same (20/25/30) |
| seas_medic | heal r30 amount 5 mod .25; find_traces/traps | | L3 +5 (=10), L4 +10 (=15), L5 +15 (=20) |
| aje_shaman | find_traces/traps r30 delay 2 (**no heal**) | | — |
| hu_temple, aje_temple, ninigi_temple | heal r30 amount 5 mod .25 | | — |
| hu_harbour, aje_floating_harbour, ninigi_harbour | heal r40 amount 5 mod .25 | | — |
| hermit_s0 | ranged_heal r0 amount 0 mod 0; self_heal 2 | | L2..L5: ranged r+20, amount +4, mod +.3; self_heal +1/+2/+3/+4 (=3..6) |
| livingstone_s0 | drain_life 0.25; RangeEffect r20 OnEnemy | | L2+ enables RangeEffect |
| Cole, Stina, Bela, tesla, darwin, babbage, lovelace, schliemann, special_eusmilus | RangeEffect r20 (Bela +5 ⇒ 25), `enabled=false` at base | | L2+ `enabled=true` |
| Ninigi ships (fishing, transport, minelayer, fire, muraeno, rocket, corsair) | self_heal 2.0 | after `ship_regeneration` | — |

Semantics:
- **heal** (healer units): `HealAmount/s = amount·Mod(Healing,rel) + Mod(Healing,abs) + targetMaxHP·mod/100` (FightingObj.usl:3744).
  When idle, a healer with 1/7 chance per idle tick scans own and allied CHTR/ANML/VHCL/SHIP within **1.5×radius** for anyone hurt, then runs the `HealUnits` task (character.usl:1163, 1400).
  It walks to within the radius, loops anim "heal_0", and heals `elapsed·amount`. Other healers that are already healing are skipped. Fight.usl:298 also lets healers switch to healing during a fight.
- **heal** (buildings): every building-function tick, all friendly units within the radius get `dt·HealAmount` (Building.usl:785-805).
- **ranged_heal** (hermit): a 2 s timer heals friendly CHTR/ANML/VHCL/SHIP within the radius (excluding self) by `dt·(amount·HealRel + HealAbs + maxHP·mod/100)` (Hero.usl:442).
- **self_heal**: `HealMe(amount)` every 1 s (FightingObj.usl:8208, TIMER_SELFHEAL).
- **drain_life**: when a unit with this ability deals damage, it heals itself by `dmg·amount` (FightingObj.usl:4484).
- **find_traces / find_traps**: the passive idle scan calls stub functions that do nothing (character.usl:984-997). **Detection only happens through the `reveal` / `oracle` moves** (§3.1), which need both abilities.

Hero auras (RangeEffect region of `radius`, entered/left via region sink; Hero.usl:134-222, 324-339). The target filter is Friend, or Enemy when `OnEnemy`. Neutrals count as enemies for Schliemann, or when aggressive. Buildings are excluded.
| Hero | Effect on units in the aura |
|---|---|
| Cole_s0 | filter RangeEffect: `damage_cole_bonus=5` on hu_worker/warrior/jetpack_warrior/berserker/killer, aje_worker/warrior/rammer, ninigi_worker/warrior/ninja/sumo, giving a **flat +5 damage** |
| Stina_s0, special_eusmilus | `defense_stina_bonus=20` and `rangeddefense_stina_bonus=20` on hu_spearman, hu_pikeman, aje_spearman, ninigi_spearman, ninigi_icespearman |
| Bela_s0 (r25) | `range_bela_bonus=5` (+5 range) on archers/marksmen (hu_archer, hu_marksman, aje_archer, aje_thrower, ninigi_ninja, ninigi_archer, …; 11 classes) |
| babbage_s0 | BONUS_DAMAGE_BLDG bucket +20 (BUILDING_DAMAGE_BONUS, %) and filter-appended `damage_babbage_bonus` invent flags |
| lovelace_s0 (OnEnemy) | enemies' `/Modifications/*/WeaponDuration/*_rel ×1.2` (20% slower attacks); flag ADA_SLOWHAND |
| schliemann_s0 (OnEnemy) | enemies get flag KLEEMANN_AURA, which enables the filter on them: `Skulls/*_rel ×1.15` (they yield 15% more skulls) |
| darwin_s0 | friends get NO_ANIMAL_AGGRO (wild animals ignore them, Animal.usl:329) |
| livingstone_s0 (OnEnemy) | a 3 s timer: each visible enemy non-BLDG/NEST in the aura takes `TakeDmg(self, 10/self.GetDmg())` (about 10 per tick before armor). drain_life heals him 25% of that damage |
| tesla_s0 | enables `/Filters/Special/Upgrades/tesla_s0/RangeEffect`, which **does not exist**, so there is no effect (the buff icon says "faster_buildup") |

Upgrade-driven passives:
- **warcry** (Hu, hu_warrior, ExamineFlags periodic; character.usl:769-793, 831-878). A personal region with radius by warrior level: L3 10 m / L4 15 m / L5 20 m (none below L3).
  Friendly non-BLDG units in it (not the warrior itself) get WARCRY_3/4/5, i.e. damage ×1.10/1.15/1.20.
- **warpaint** (Aje, aje_warrior; also mayor_s0 at L2+ with radius 20 and tier 5). Same radii, applied to **enemies**: WARPAINT_3/4/5 gives damage ×0.90/0.85/0.80.
- **wild_boar_rage**, **ram**, **disguise**, **defensive mode**: see §3.
- **Kentrosaurus**: if an attack does 0 damage, TakeDmg reports 20 (Animal.usl:2816; this affects callers only).
- **Transport capacity** (`max_passengers`): hu_chariot 1, hu_rhino_transporter 2, hu_triceratops 4, hu_steam_tank 10, hu_transport_ship 10;
  aje_triceratops_archer 3, aje_transport_turtle 10; ninigi_saltasaurus_archer 3, ninigi_siegetower 5, ninigi_transport_boat 10;
  seas_triceratops_transporter 3, seas_hovercraft 10.
  Brachiosaurus and other build-up transporters get their capacity from build-up scripts, not from this field.

---------------------------------------------------------------------------------------------------

## 5. AI hints (A/)
- `AiTaskAttackObject.usl:1060-1100`: each unit keeps a list of special attacks and checks them every `m_iCheck` (10) ticks. After firing, the AI waits 60 ticks.
  - Global check (:337): unit level ≥ required, the action is not listed in `SpecialActionNames` (i.e. not on cooldown), and for animal/shaman moves the invent node count is > 0.
  - Local check (:367): for AoE moves (tornado, quicksand, Shotgun, Ada/Schliemann deathshoot, trumpet, scrunch, roar, stomp, doping, lacerate, barrage, enchain, minigun, warden, shake-offs, paw), it fires if non-BLDG enemies within 60 m have summed HP >500, or if further enemies are within 8 m (10 m for tornado) of the chosen one.
  - Snipershot: needs an enemy within 70 m with HP ≥500. Hypnosis: needs an ANML within 40 m with HP ≥500. Tesla: needs a VHCL target.
- Guerrilla goal: camouflage/disguise before a raid; termites / insects / lockpicking against eco buildings and gates; illusion when engaging (AiGoalGuerillaAttack.usl:185-399).
- Defend goal: Ninigi workers entrench when threatened (AiGoalDefendMode.usl:266). General attack: illusion and fireworks (AiGoalGeneralAttack.usl:1252-1268).
- Trap detection: druid/shaman/monk use `reveal` periodically (AiTaskAttackObject.usl:1579). Oracle scouting: AiTaskOracleScouting.usl:97.
- The AI difficulty duration multipliers in Action.usl:352-383 apply only to production/invent actions, **not** to move cooldowns.

---------------------------------------------------------------------------------------------------

## 6. Original quirks to reproduce (or consciously fix)
1. Matrix location is `hu_spearman`, so Matrix never triggers (§1.2).
2. Hu_Multi_Arrow (hu_archer) has no implementation. Wild_Boar_Rage, RamAttack and StegoBash TT entries are not user commands.
3. Mammoth_Stampede never sets its cooldown and can re-trigger right after its 30 s rage.
4. Lockpicking never starts its cooldown.
5. BrachioStomp damage increases with distance (0 at center, 100 at 20 m).
6. Barrage ignores its custom 350/100 damage and uses GetDmg().
7. Termites range check counts the target radius twice.
8. RamAttack weapon suffix is empty at L1 (the weapon path is invalid, so the normal weapon is probably used).
9. Tesla's aura filter is missing, so it has no effect. EFFECT_WILDBOAR_RAGE (+15%) is never set.
10. The Babbage minigun task ends in an unhandled "EndTask" state (harmless, since ReturnToFight replaces it).
11. Multishot adds its cooldown at start and probably hits the main target twice (cone Penetrate plus arrow impact).
12. Insect/termite/tornado/quicksand tasks start the cooldown before the final range re-check. If the caster fails the re-check, the cooldown is spent (Insects/Termites: timer then range check).

## 7. Uncertainties
- `Spirit.GetResurrectDuration()`, `JetPackAction`, `SetDisguised` and `CTrap` re-trapping are engine or C++ behaviour, not script.
- The exact quicksand victim filter (`m_bOnlyEnemies` default) is unverified; the scripts show "all non-owner players, no neutrals".
- The number of tornado ticks (10 or 11) depends on timer jitter. Use 11 ticks: t = 0, 1, …, 10.
- Babbage pulse timing depends on the length of the SLE animation loop.
- Whether entrenched units can attack from the hole is unclear. The script leaves them in an infinite WaitAction, so assume **no**.
- The per-tick interval of building heal (`DoBuildingFunction`) is set by the building timer and is not re-checked here. The heal is time-scaled (`dt`) either way.
