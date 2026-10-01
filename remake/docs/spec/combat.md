# ParaWorld combat rules: implementation spec

Source: `Data/Base/Scripts/Server` (BoosterPack1 has no `.usl` overrides; it only remaps classes).
Abbreviations: **FO** = `classes/FightingObj/FightingObj.usl`, **FT** = `classes/task/Fight.usl`,
**WM** = `classes/misc/WeaponMgr.usl`, **PR** = `classes/misc/Product.usl`, **BL** = `classes/buildings/Building.usl`,
**CH** = `classes/character/character.usl`. `A` = attacker, `V` = victim. "Engine" means native C++ code that the
scripts don't show; those parts are marked **(engine, uncertain)**.
Vector helpers: `Abs()` is 3D length, `Abs2()` is 2D (XY) length, `Abs2S()` is squared 2D length, and `AbsSquare()` is squared 3D length.

---
## 0. Stat derivation (per equipped weapon)  `UpdateWeapons` FO:7420-7573

When a weapon becomes current, the script sums the nodes `[currentWeapon, leftHand, armor]`. The shipped
tech tree has no slot 1 or slot 2 weapons, so in practice only the current weapon contributes.
```
dmg   = Σ damage        prot  = Σ defense        rprot = Σ rangeddefense
endD  = Σ enddamage     poison= Σ poison_damage   AP    = max armorpiercing   (data: only 0 or 99)
hitR  = max hitrange    range = max range         minR  = max minattackrange  ticks = max poison_tick_count
pen   = any penetration=="1"; penAngle = max penetration_angle; weaponSize = weapon.unit_size
if weapon has Projectile/0:  dmg = dmg*M("ranged_damage").rel + M("ranged_damage").abs
Dmg   = dmg*M("Damage").rel + M("Damage").abs                               (SetDmg; attrib shows ceil)
Prot  = clamp(prot *M("Defence").rel       + M("Defence").abs,       0, 99)
RProt = clamp(rprot*M("RangedDefence").rel + M("RangedDefence").abs, 0, 99)
if weapon == RightHand(primary): AttackRange = range*M("Range").rel + M("Range").abs
Duration = (60 / (frequency==0 ? 1 : frequency)) * M("WeaponDuration").rel + M("WeaponDuration").abs
Duration *= AICheat   // AI player slot Difficulty>=9 → 0.9, >=8 → 0.95, else 1   FO:7575
```
- `EndDmg` is **not** scaled by the Damage modifier (quirk). `MinDmg` is loaded but never used.
- Protection and ranged protection depend on the **current** weapon, so switching to a secondary weapon changes armour as well.
- Weapon results are cached per weapon path (`AddWeaponCache` and `ReloadWeaponCache`, FO:7596-7658).
- **Modifier lookup** `M(stat)`: tech-tree path `/Modifications/<unitTribe>/<TYPE>/<stat>/<col>_rel` (default 1) and
  `.../<col>_abs` (default 0).
  - Base objects always use `col="tec"` (FO:8395-8414, commented "boeser HACK").
  - Characters (CHTR) use their own caste `res|nat|tec` (CH:2640-2657). The caste comes from the `setcaste` command at
    production (CH:1994). Assume it equals `Objects/<Tribe>/CHTR/<class>/caste` (uncertain).
  - `settings/_Modifications.txt` is an unused template.
- Stats used: `Damage, ranged_damage, Defence, RangedDefence, Defence_<TYPE>, Range, WeaponDuration, Hitpoints,
  FOW, Skulls, Healing`.
- Max HP is computed by `GetTechTreeHitpoints` (FO:3718): `hp*M(Hitpoints).rel+abs`, then the class modifier
  `/Modifications/<Tribe>/<class>/Hitpoints/{rel,abs}`, then `+BonusSum(MAXHITPOINTS)`. When max HP changes, the
  current/max ratio is kept (FO:5415).

## 1. Damage formula

### 1.1 Hit scheduling: `TakeDmg(A, f=1, hitDelay=A.currentFightAnim.delay)` FO:4040-4109
```
if V has EFFECT_AJE_CAMOUFLAGE: V.TerminateAction(); clear camouflage
if A == null: return
if V.timer(ANML_IMMUNITY, 7 s) and A.type=="ANML": return                  (warden special)
V.UpdateFightFactors()          // V.DefenseFactor, V.AttackFactor = player attribs, default 1.0 (AI handicap)
if V.cache.attacker==A && V.cache.dmg>0 && !A.consumeWeaponChanged() && !V.consumeOwnWeaponChanged():
    dmg = V.cache.dmg                        // short-circuit &&: flags are only consumed when reached
else:
    if V is CCharacter and V.transportObj valid: return          // garrisoned or riding: immune (not on a cache hit!)
    raw = f * A.CalcAttackBoni(A.Dmg) * (1 + A.AttackBonus.get(V.type, V.class)/100)
    if V.type=="BLDG" && (b = A.BonusSum(DAMAGE_BLDG)) > 0:
        t = trunc(raw); raw *= 1 + b*0.01; if trunc(raw)==t: raw += 0.5
    AP = A.ArmorPiercing
    if A.Projectile == "":                    // melee, including penetration weapons (flamers, lances)
        pct = V.TempDef(max(0, V.Prot - AP))
            + V.DefenseBonus.get(A.type, A.class) * VM("Defence_"+A.type).rel + VM("Defence_"+A.type).abs
    else:                                     // any projectile weapon
        pct = V.TempRangedDef(max(0, V.RProt - AP))                // DefenseBonus is NOT applied
    dmg = (raw - raw*clamp(pct*0.01, 0, 0.99)) * A.AttackFactor
    V.cache = {A, dmg}
if A.class=="ninigi_icespearman": V.SetIced(2.5)                  // applied at swing time, see §4
schedule ProvideDmg(dmg, A, isProj = A.Projectile!="", A.PoisonDmg, A.PoisonTicks) after hitDelay
    (if hitDelay <= 0 it runs immediately); return 0
```
- `CBonus.get(type,class)` = `Type[type] + Class[class]`, summed over the weapon's `AttackBonus` / `DefenseBonus`
  nodes (FO:9314). In the data, AttackBonus only has Types `BLDG, VHCL, SHIP, CHTR, ANML` (percent, e.g. towers
  `BLDG:-50`), and DefenseBonus only has `Type/ANML`. The item AMULETT1 adds DefenseBonus `ANML +15` (FO:7767).
- **Damage cache quirk**: on a cache hit, the new factor `f` (splash falloff) and any buff changes are ignored until the
  cache is invalidated. Invalidation happens when either side changes weapon or boni (`ClearDamageCache` FO:4033, called by
  `UpdateWeaponBoni`, `ForceBoniUpdate`, and by the attacker switching weapon in `IsInCombatRange`), or when a different
  attacker hits V. To be 1:1, keep one cache slot per victim.

### 1.2 Attacker and defender temporary modifiers
```
CalcAttackBoni(d) FO:7812:  d *= 0.8 if MAMMOTH_TRUMPET; *= 0.8 if TRICERATOPS_PAW;
    *= 1.2|1.15|1.1 for WARCRY_5|4|3 (highest only); *= 0.8|0.85|0.9 for AJE_WARPAINT_5|4|3 (highest only);
    *= 1.15 WILDBOAR_RAGE; *= 1.2 MEGALO_DRUMS; *= 1.25 NINIGI_CAULDRON;  d += BonusSum(DAMAGE)
TempDef(p) FO:7894:       p + (tribe!="Aje" && RHINO_PENNANT ? 20 : 0) + BonusSum(DEFENSE)
TempRangedDef(p) FO:7952: p + BonusSum(RANGEDDEFENSE) + (OnWall ? MiscValues/<playerTribe>/Defence_On_Wall (=50) : 0)
Range bonus FO:7931:      GetAttackRange() += BonusSum(RANGE)
```
`BonusSum(t)` sums a bucket of item or ability boni (FO:1593). Trumpet and paw last 15 s (FO:9146, 9181).

### 1.3 Applying the hit: `ProvideDmg` FO:4324-4514
```
if isProj && V has EFFECT_ITEM_RING: dmg *= 0.5
if V has EFFECT_ITEM_AMULETT1:        dmg *= 0.5
if A is gone && !isProj: drop (melee swing cancelled when the attacker dies during the delay)
if V.invulCounter > 0 || V.LDInvulnerable: drop            (counter: finishing move; LD: TriggerTimer)
V.lastEnemy = A; if V's task is not CFlee: aggro activation + V.AddEnemy(A, defend=true)   (§8)
knockback check (§4); item OnHit; V.m_iLastDamage = A.owner
if A has ability "drain_life": A.HealMe(dmg * amount)
if V.hp - max(ceil(dmg),1) <= 0: refund V's build cost to A.owner if V is SHIP (A has SHIP_res_back) or
    BLDG / aje_resource_collector (A has BLDG_res_back), capped at max_<res>
if poisonDmg > 0 && ticks > 0: ProvidePoison(poisonDmg, ticks)
if V can't fight (Dmg==0): ShoutForHelp(false)
V.Damage(dmg)
```
### 1.4 HP subtraction: `Damage(d)` FO:4007-4017
```
if godMode || levelUpInvulnerable: return
hp -= max(ceil(d * V.DefenseFactor), 1)        // every hit deals at least 1 HP, as an integer
hp = max(hp, 0); if hp<=0 && !dead: OnKill(); UpdateHitpoints() → Die() if hp<=0
```
- `Damage` does **not** check the invulnerability counter. Poison ticks and reflects therefore ignore it.
- Wild boar (`RageUnit`) enables the `wild_boar_rage` filter while `hp*4 <= maxHp` (FO:5488).
- Direct damage bypasses bonuses and the AttackFactor:
  - `TakeDirectDmg(d, AP=0)` FO:4554: `Damage(d - d*clamp(TempRangedDef(RProt-AP)/100, 0, .99))`
    (note: there is no `max(0,…)` here).
  - `TakeDirectMeleeDmg` FO:4586 is the same using `TempDef(Prot-AP)`.
  - Both check invulnerability, but don't set `m_iLastDamage` unless a dealer overload is used.
- **Reflect**: in melee, `FT:468` calls `A.SetReaction(V.TakeDmg(A))`. If the return value is > 0, `A.Damage(x)`.
  Base `TakeDmg` returns 0. Overrides return:
  - Kentrosaurus: 20 (Animal.usl:2816).
  - `CNinigi_Defense_Skewer` wall and gate: 5 (BL:2151, 2177).
- **Walls** (BL:2266): damage is redirected to the parent gate if one exists. With the `hu_falling_stones` invention, a
  ready wall that is hit spawns `CAreaDamage(wall, wall.pos)` using the wall's own weapon. Cooldown = the wall's weapon duration.

## 2. Weapon choice, switching, and ranges

### 2.1 Available weapons: `GetStandardWeapons` WM:284
- Candidates are every node under `/Objects/<playerTribe>/Weapons` and `/Objects/<unitTribe>/Weapons` whose `Users`
  contains the class name and where `level-1 <= unit.level`. Unit level is 0..4; weapon `level` is 1..5.
- A weapon is ignored if damage, defense, rangeddefense, level and range are all 0.
- Inventory weapon items add the paths `path, path_l, path_m, path_s`.
- The `caste` field is ignored.

### 2.2 Primary (right-hand) selection: `GetBestWeapon` WM:226
Among non-`secondary` weapons, pick the one with the highest value. Ties keep the first one found (strict `<`).
Slot 0 = right hand, 1 = left hand, 2 = armour.
```
NoBoni(w) = (dmg+def+rdef) * (1+(range-minR)*0.1) * (60/max(freq,60)) * (1+(hitrange+enddmg)*0.1)   WM:627
VsEnemy(w,E) = (dmg*(1+AtkBonus(E)/100) + def*(1+DefBonus(E)/100) + rdef)
             * (1+(range-minR)*0.1) * (60/max(freq,1)) * (1+(hitrange+enddmg)*0.01)                 WM:586
```
- `NoBoni` is used on init, on level change, and in `UpdateAll`.
- `VsEnemy` is used when a fight is invoked against a target (`InvokeFightTask` FO:6435). Its result is cached
  **globally** (20-slot ring buffer), keyed by (weapon path, enemy TYPE). This picks the right-hand weapon but only
  loads it at the next range check (the right-hand weapon differs from the current one, so `UpdateWeapons` runs).
- Secondary weapons (`secondary=1`, WM:359) use `NoBoni`. The best one with `range<1` becomes **S** (short). The best
  one with `range>=1` becomes **M** (medium).
  - `SecRangeS/M` = that weapon's raw `range` (no modifiers), or -1000 if there is none.

### 2.3 Range zones: `IsInCombatRange` FO:5027-5156
```
radius   = (A.type=="CHTR") ? 2.0 : A.GetRadius();  if A has primary projectile: radius = 0
AttackR  = AttackRange + radius + BonusSum(RANGE)                               (GetAttackRange FO:7126)
SecS'    = SecRangeS + (CHTR?1.5:radius) + collR + 2 ;  SecM' likewise with SecRangeM
MinR'    = minattackrange(primary) + collR
if primary projectile: AttackR' = AttackR + collRInner(A); MinR' -= collRInner(V); cone = 0.5/AttackR
elif penetration && m_fAttackRange > 5: AttackR' = AttackR + collRInner(A)
else: AttackR' = AttackR + collR + 2;  (then if 0 < AttackR' < 4: AttackR' = 4)
if MinR > 0: SecM' = MinR'
zone = IsInCombatRangeAttackZone(V, SecS', SecM', AttackR', cone)   (engine, uncertain):
       0 = out, 1 = ≤SecS', 2 = ≤SecM', 3 = ≤AttackR'
```
- The distance to V is measured by the engine against V's "attack zones" (≈ edge; for buildings, the nearest zone).
  - The projectile cone gives about +0.5 m of range per metre of height advantage (`FALLOFFCONE_VAL=0.5`, FO:930)
    **(engine, uncertain)**.
  - As a fallback, use: 2D centre distance − V.collisionRadius ≤ threshold.
- **Height**: `heightOk = |zA-zV| < min(7, sizeZ of the lower unit)`. Non-projectile attackers need `heightOk`.
  Projectiles only need it for zones 1 and 2.
- **LOS**: required (engine `CheckLineOfSightFight`) unless zone 3 with a primary projectile, or either side is a building.
- A unit on an open transporter treats any zone other than 0 as 3.
- Zone results:
  - Zone 3: use the right-hand weapon; in range.
  - Zone 1: switch to S if `SecS'>0`; in range.
  - Zone 2 without a min range: switch to M; in range.
  - Zone 2 with a min range: `inMinRange=true`; **not** in range. On the first tick it only remembers the target. On
    later ticks with the same target it switches to S, but still returns false.
  - Every switch clears V's damage cache.
- Ground attack uses `IsInScapeCombatRange` (FO:5159): the same thresholds applied to the 2D distance to the point.

### 2.4 Attack loop: `CFight.USLOnTick` FT:228-600
- The FSM is disabled while an action runs (CH `OnActionStart`), so a tick effectively happens after each
  wait, advance or rotate action ends.
- Rate: the next attack is allowed when `now - lastHitDone > Duration` (FO:5777, strict). `lastHitDone` is stored on the
  unit, so a new target or task does **not** reset the cooldown. The very first attack is immediate.
- In range, in this order:
  1. `SetHitDone`.
  2. Auto special moves (`CheckSpecialMoves`).
  3. Finishing-move check (§7).
  4. `AttackEnemy`:
     - **Melee**: pick the next fight anim (a random non-combo anim, or its `followanim`). If the angle to the target is
       more than π/8, rotate using the attack anim as an overlay. The hit **still counts** and there is no wait action.
       Returns true, so Fight calls `TakeDmg(A)` with `hitDelay = anim.delay`. If the weapon has `hitrange > 0`
       (`DoesAreaDamage`), it spawns `CAreaDamage(A, V.pos)` instead. `*_poisoner` units then `Die()` (suicide).
     - **Projectile**: if the angle is more than π/4 (or π/16 with penetration), only rotate. Otherwise spawn the projectile.
     - **Penetration**: cone damage (§3.4).
     - Anim-loop ranged units (CH:2529 list) never skip the shot for rotation. On the first shot from rest, they add
       0.4 s (Bela 0.6 s) to both `Duration` and `shootdelay`.
  5. `WaitAction(Duration)` unless the unit rotated, is in a transport, or already has an action.
- **Out of range**:
  - If `inMinRange` and the target isn't the remembered min-range target: `ExamineEnemies(true,true)` (retarget).
  - Otherwise follow (§2.5). If the follow fails or the target is in the min range, end the task.
- **Target lost**: a dead, vanished, `IsGettingFinished` or unhittable target, or one no longer visible to the owner,
  ends the task. A hidden non-BLDG/NEST target in the FOW also ends it. If the victim is a wild ANML, the attacker then
  harvests or feeds.

### 2.5 Chasing and leash: `FollowEnemy` FO:5953-6117
```
if !canWalk || finishing: false;   if task is automatic && aggressionState <= 0: false
leash = 2*AlarmRange + AttackRange;    tooFar = |aggrPos - V|2D > leash;   away = |aggrPos - A|2D² > 2
approach = current==S ? SecRangeS' : current==M ? SecRangeM' : AttackRange-2 ;  if m_fAttackRange<1: approach=0
approach += (primary projectile ? collRInner : collR)
automatic:  if aggressionWalk: Advance(V, approach, maxSpeed, stopOnLost) → true   (no leash)
            elif state>0: if tooFar && !aggressionWalk: if away: walk back to aggrPos (defaultSpeed); false
                          elif |V-A|3D > leash-2: false
                          else Advance(V, approach, maxSpeed, maxRange=leash, root=aggrPos) → true
            elif away: walk back; false
user cmd:   Advance(V, approach, maxSpeed, firstStrike="first_strike_0" if the anim exists) → true   (no leash)
```
- `AlarmRange = clamp(AttackRange+8, 32, FOW)` (FO:7147).
- Characters call `EndFight` before chasing, which reverts them to the primary weapon (CH:2592).
- **Follow counter** (FT:527-582): starts at 3 for user commands and 2 for automatic ones, and resets whenever the
  target is in range. It is decremented after each failed follow. When it reaches ≤ 0:
  - Add the target to a failed list (max 16 entries; drop the 4 oldest).
  - Retarget to the best enemy within AlarmRange, excluding failed ones (§8 sort). The counter resets to 2.
  - If there is none, clear the failed list.
- If the counter is < 0 and the unit moved ≤ 1 m since the last tick: end the task.
- **First strike** (engine event `FrstStrk`, FO:2585): `V.TakeDmg(A, 1, timeToHit)`. This is extra damage during a
  user-ordered advance and does not set `lastHitDone` (engine timing uncertain).
- **Returning to post**: when idle, if `|pos-aggrPos|² ≥ 1.5·collR²`, the unit patrols back with
  `aggressionWalk=true` (FO:2390). A user-ordered fight moves `aggrPos` to where the fight ended (FT:613).

## 3. Projectiles and splash

### 3.1 Shot: `CArrow.Set` / `Shoot` PR:855-884, 618-755
- The projectile is created at the link `Proj`, or at the unit position plus 0.7×height (FO:7010).
- `Shoot` fires after `shootdelay` of the current fight anim. For bunkers this is multiplied by the extra-delay factor.
- Snapshot at shot time: `Dmg, EndDmg, HitRange, jitter, weaponSize, bulletspeed, bulletfalloff`.
- Aim point: `m_vTarget = V.pos`. If `jitter != 0`:
  ```
  RandomizePosInRadius(pos, r): L = (rand % int(r*20))/10 - r ;  θ = (rand % 314)/100 ;  pos += rotZ((L,0,0), θ)
  ```
  This gives a signed length in [-r, r) at 0.1 steps and an angle in [0, 3.14) — a uniform-ish point in the disc.
- The flight point is a random point inside V's nearest attack zone (engine `FindNearestAttackZone`, 2..100) for
  non-trap targets.
- Flight: engine `ProjectileMgr.SpawnProjectile(speed=bulletspeed, g=bulletfalloff, colDet=true)`. Impact happens
  after `m_fImpactDelay` **(engine: ballistic arc; approximate as horizontal distance / bulletspeed)**. Tracking is
  not modelled. **Damage does not depend on the flight path.**

### 3.2 Impact: `OnDoDmg` PR:535-573
- **`hitrange > 0` (area)**: `CAreaDamage` at `m_vTarget` (the jittered point, so it can miss V). It uses A's
  **current** stats at impact time. If A is dead, the stored values are used through `TakeDirectDmg`.
- **Single target**: if both A and V are still alive, `V.TakeDmg(A)`. This **always hits** (there is no miss roll), is
  computed from A's current weapon, and adds another delay of `A.currentAnim.delay` after impact (the towers' anims have
  delay 0). If A died in flight, `V.TakeDirectDmg(storedDmg[, AP])`. If V is gone, nothing happens.
- Build-up and siege weapons (`Set(...,buildUp)` PR:886): the start delay is always 0.75 s. They use
  `TakeDirectDmg(buildUp.dmg, buildUp.AP)`, with no AttackBonus, no AttackFactor, no poison, and no skull credit.
- `CArrow.CalcDamage` and `GetDmgWithBonus` (PR:579-592) are dead code.

### 3.3 Splash: `CAreaDamage.DoAreaDamage(R, dmg, endDmg)` FO:9431-9492
```
if R <= 0: R = 1
candidates = objects of type CHTR|SHIP|ANML|VHCL|BLDG|FGHT|NEST owned by A's enemies OR owner -1,
             within circle(center, R+20)            → no friendly or allied fire; neutral and wild are hit
for each V (skip V with transportObj):
    d = max(0, |V.pos - center|2D - V.collisionRadius);  if d >= R: skip
    e = (dmg != 0) ? endDmg/dmg : 0
    f = (1-e) * (R-d)/R + e                       // linear: 1.0 at the centre → e at the edge
    V.TakeDmg(A, f)  (full §1 pipeline incl. hit delay);  V.AddEnemy(A, defend=true)
    (without an attacker: V.TakeDirectDmg(dmg*f))
if weaponSize > 0: InvokeAreaThrow(center, victims, weaponSize)   (§4)
```
- For melee and projectile splash, `dmg = A.Dmg` (after modifiers) and `endDmg = A.EndDmg` (raw).
- The primary target is only hit if it is inside the circle.
- Special projectiles:
  - `CBurstArrow`: R = 5 + V.collisionRadius.
  - `CMultiArrow`: 3 visual arrows ±5° and `Penetrate(V, 10°)`.
  - `CAdaArrow`: `TakeDirectDmg(clamp(V.hp*0.9, 1500, 5500), A.AP, A.owner)`, delay 1.72 s.
  - `CSniperArrow`: `clamp(V.hp*0.5, 500, 2000)`, delay 2.0 s.

### 3.4 Penetration (cone) weapons: `Penetrate` / `GetPenetratedObjs` FO:5866-5936
- Candidates are enemies and owner -1 within `max(2*AttackRange, 1.5*dist)`.
- Hit if `|Vc - A|² ≤ (AttackRange + collR + 2 + collRInner(V))²` and the XY angle to the aim direction is
  ≤ `penetration_angle/2` degrees.
- Each hit V gets the full `TakeDmg(A)`, with melee defense since penetration weapons have no projectile.
- Used by flamers (15 m, 30°), lances, mammoths, and so on. Ground attack isn't allowed with penetration.

## 4. Status effects

**Poison** (FO:223-335, 4111-4140):
- Only applies when V is not BLDG, VHCL or SHIP.
- Tick = `poison_damage` (raw, not armour-reduced), applied through `Damage()`. That means ×DefenseFactor, `ceil`,
  a minimum of 1, and the invulnerability counter is ignored.
- A tick happens every **3.0 s** (first tick 3 s after application), `poison_tick_count` times.
- Stacking uses two slots, and only the primary slot deals damage:
  ```
  on apply(p, n): if primary.dmg <= p:  if primary.ticksLeft >= secondary.ticksLeft: secondary = copy(primary)
                                         primary = {p, n, cur=0}           // keeps primary's timer phase
                  elif secondary.ticksLeft <= n: secondary = {p, n, 0}
                  else: ignore
  on primary expiry: if secondary.ticksLeft <= 0: cure; else primary = copy(secondary) (new 3 s timer); secondary = none
  ```
  The secondary slot keeps ticking down silently in parallel.
- Poison kills credit `m_iLastDamage` with skulls. Data examples: `aje_poison_dagger_c` 20×100 ticks,
  `hu_undead_b` 10×10, `aje_molotov_b` 20×10.

**Knockback** (`ProvideDmg` FO:4383-4460):
- Only when `dmg ≥ 1`, the attacker is alive, V is not on a wall, V is a CHTR or ANML, and V is not in a transport.
- The check uses the attacker's object `unit_size` (`m_iSizeClass`) against V's `unit_size`: `diff = sizeA - sizeV`.
  Both must be > 0 and diff ≥ 3.

  | diff | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
  |---|---|---|---|---|---|---|---|
  | chance | .02 | .04 | .06 | .08 | .10 | .20 | .30 |
  | strength | 1.0 | 1.5 | 2.0 | 2.5 | 3.0 | 4.0 | 5.0 |

  Strength is then increased by `rand(0..20%)`.
- Game option `AlwaysThrowEnemy` forces the throw.
- Throw: after 0.4 s, `FallActionDest(pos + norm(norm(V-A)+z0.5)*strength, "hit_back", "getting_up")`. This is a stun
  lasting the fall and get-up anims (engine).
- **Splash throw** `InvokeAreaThrow` (FO:4239) uses the weapon's `unit_size` against the victim's. There is no chance
  roll. Strength by diff 3..9 is 2.0, 3.5, 4.0, 5.5, 6.0, 7.0, 8.0, then +rand(0..30%). It only applies to victims with
  a `hit_back` anim that are not already falling.

**Other effects**:
- **Iced**: `ninigi_icespearman` hits call `SetIced(2.5 s)`, meaning Trapped (no actions) plus the STONED flag; each hit
  refreshes it. Buildings are immune.
- **ANML immunity**: 7 s.
- **Level-up invulnerability**: 1.5 s, only if the unit has a `level_up` anim.
- **`TriggerTimer(s)`**: timed invulnerability.
- **Finishing-move invulnerability**: for the attacker, through the counter.
- **Ninja/Muraeno disguise**: getting hit resets a 10 s camouflage timer.
- **Entrenched characters**: getting hit leaves the entrenchment (CH:2626).
- **Hit reaction**: melee hits trigger overlay anims only (cosmetic).

## 5. Towers and bunkers

- **CTower** (BL:1404-1680) is a stationary `CFightingObj`. Towers are `aggressive=1` in the tech tree, so they scan
  as in §8.
  - `IsAbleToFight` is false while being built. Fighting also needs `m_bBuildingReady`.
  - `FollowEnemy` fails because towers can't walk, so an out-of-range target ends the task.
  - Firing:
    1. If there is a turret whose facing ≠ the target, `SecRotAction(turret, 0.8 s)`, `ResetHitDone()` and no shot.
       The next tick fires immediately.
    2. Otherwise `CreateProjectileAndShoot` plus the turret's attack anim.
  - Towers without a projectile never fire (`AttackEnemy` returns false).
  - Rate = weapon `Duration`, e.g. frequency 30 → 2 s.
  - Range = weapon range + collRInner (radius term = 0 for projectiles). There is no LOS check for buildings.
  - Target sort is standard (units first).
  - When damaged: `OnDefend`, then attack the attacker (`/AttackSrv`).
- **Subclasses** are cosmetic except where noted:
  - `CSeasTurretTower`, `CSeasMGTower`, `CSeasDefenseTower`, `CTeslaTower`: turret objects only.
  - `CNinigiSmallTower`: upgrade gfx.
  - `CRocketRamp`: bird anim. Its data has `aggressive=0`, so it only fires on command or retaliation; minattackrange 50.
  - `CSeasBigCannon`: never fires until `m_bActivated`.
- Data (`hu_*_tower`):
  - Small tower 50 dmg / 40 m, large tower 100 / 45 m, Tesla tower 200 / 60 m (frequency 20). All `AttackBonus BLDG -50`.
  - `bulletspeed` 50, `falloff` 8.
- **CBunker** (`hu_bunker`, BL:5519-5661):
  - Capacity `MAX_CHARS=4`, `transportclass=1`.
  - Garrisoned characters are hidden, can't be selected or targeted, and are immune (they have a transport object).
  - Each shot, if at least 1 character is inside, the bunker spawns **one arrow per garrisoned character**, arrow i
    (0-based) with delay `shootdelay*(1+0.1*i)`.
  - Every arrow uses the **bunker's** weapon (`hu_bunker_arrow`: 7 dmg, 40 m, frequency 30, `BLDG -50%`). The
    characters' own weapons are not used.
  - With 0 characters it still "fights" but never fires.
  - Death, `/Dismount` or `/DismountAll` eject the characters to a free position.
  - Entering (`EnterBunker.usl`:54-85): `Advance(bunker, 1.0)`, then enter when there is LOS and the 2D distance is
    < 12. Otherwise wait 0.8 s and retry, up to 5 retries.

## 6. Buildings, vehicles, healing

- Buildings take the same pipeline as units. Their type key is `"BLDG"` for `AttackBonus` / `Defence_BLDG`, and
  `BONUS_DAMAGE_BLDG` applies as in §1.1.
- Regular `CBuilding.AttackEnemy` returns false: non-tower buildings never deal damage. When hit, they call
  `ShoutForHelp` (walls don't).
- Buildings can't be poisoned or iced, and knockback doesn't apply. `Die()` on a building starts a 1 s explosion timer
  and then deletes it.
- Ninigi buildings with the `Explode` invention: `CAreaDamage(R=20, dmg=500, end=100, sizeClass=7)` on death.
- Target priority. The sort key depends on the attacker's `m_iAttackType`. Type 1 (siege) is set for CSteamRam,
  CFireCannon, CSteamShip, CRocketBoat and CAnkylosaurus.
  - Normal attackers: units (CHTR/ANML/VHCL/SHIP) 0, towers 1, other buildings 2, walls 3.
  - Siege attackers: towers 0, buildings 1, walls 2, units 3.
- **No passive regeneration.** `HandleHealing` is empty (FO:2169, CH:755). Healing sources:
  - Ability `self_heal`: `HealMe(amount)` every 1 s (FO:8207).
  - Healer units (task/HealUnits.usl): `HealMe(dt * GetHealingAmount)`.
  - Health buildings (BL:779): every 2 s, friends within the heal radius get `dt * GetHealingAmount`.
  - `GetHealingAmount = amount*M(Healing).rel + M(Healing).abs + target.maxHp*mod*0.01` (FO:3744).
  - Level-up full heal; `drain_life`; animal `Feed`.
  - Building `Repair` is a separate task.
  - `HealMe` clamps HP to maxHp.

## 7. Levels, skulls, finishing moves

- **Levels 0..4** (UI shows 1..5). Combat effects outside tech-tree filters:
  - Weapon availability (`level-1 <= unit level`). The weapon is re-picked on a level change.
  - Level up (`SetLevel` FO:3412): costs `CharLevels.txt` scalps (25/50/100/300) and does a full heal plus 1.5 s
    invulnerability.
  - Per-level unit caps (default 25/15/8/3/1 per level index, overridable in the map).
  - Level-4 non-heroes enable `Chief_Bonus` and `AllNonHeroes/Lvl5`.
  - Auras (CH:758-930, recomputed every 20 s by `ExamineFlags`):
    - `hu_warrior` Warcry (invention `warcry`) gives friends WARCRY_3/4/5. At levels 2/3/4 the radius is 10/15/20 and
      the attack multiplier is 1.1/1.15/1.2.
    - `aje_warrior` Warpaint (invention `warpaint`) gives enemies WARPAINT 0.9/0.85/0.8 at the same radii. `mayor_s0`
      at level ≥ 1 applies 0.8 at 20 m.
    - Aura regions are square `(r,r)` regions (engine).
  - The `CharXPGain` tables are not used in combat.
- **Skulls** (`OnKill` FO:3950):
  - Awarded once, to the player `m_iLastDamage` (owner of the most recent `ProvideDmg` attacker, never reset), if that
    player exists and ≠ V.owner.
  - `value = round(tt(objPath/scalps, default 5) * M(Skulls).rel + M(Skulls).abs)`.
  - Growing animals: `max(int(value*growFraction+0.5), 1)`.
  - The player adds `int(value*scalpsModifier+0.5)`; the modifier is from an item, default 1 (Player.usl:407).
  - Wild owner -1 gets nothing.
  - `TakeDirectDmg` without a dealer doesn't update `m_iLastDamage`, so the previous damager gets the credit.
- **Finishing moves** (FT:425-437, FO:7250, `task/FinishingMove.usl`, `settings/FinishingMoves.txt`):
  - When A is in range, not in a transport, and `V.hp <= ceil(V.cache.dmg || A.Dmg)`. Note: V's cache may come from
    another attacker.
  - A's class must have a move whose `Enemies` list contains V's class. `$Group` references expand from `Groups`.
  - A isn't already doing a move, V ≠ the last finishing victim, A has the move's `Link`, and **A and V must be each
    other's current enemy**.
  - Result: guaranteed kill. `V.OnKill()` (skulls) runs immediately, and V dies silently. A CHTR becomes a corpse; an
    ANML becomes `<class>_food`.
  - A plays a random anim pair, V is pulled to the link over `LinkDelay` (0.4 s), and A is invulnerable until the anim ends.

## 8. Target acquisition, stances, retaliation

- **Stances** (`m_iAggressionState`, set by `/AggroState_n`; ignored for berserkers and when the state is 3):
  - `2` aggressive (default): scans.
  - `1` defensive: no scan list, only attackers or help-defend; still chases within the leash.
  - `0` stand ground: never chases on automatic orders. It auto-engages only targets already in range (FO:6438).
  - `3`: `aje_poisoner` only, fixed; no scan and no help.
  - `-1`: no retaliation (`OnDefend` returns).
  - Units with `Dmg==0` report state 1.
- **Scan timers**:
  - If the tech tree has `aggressive==1`: `PREAGGRO` every 7 s × U(0.9,1.1). If an owner-enemy is within
    `max(AlarmRange, AttackRange)+50`, the `AGGRO` timer starts: every 3 s × U(0.9,1.1), and it runs
    `ExamineEnemies(false, fill = state∉{1,-1,3})`. Otherwise the AGGRO timer stops.
  - The `ALARM` timer (10 s) re-examines when not fighting.
  - Any hit also starts AGGRO.
- **FillEnemyList** (FO:4939):
  - Alarm list: owner-enemies within AlarmRange (2D).
  - Direct list: within `max(AttackRange, 30)`, sorted by distance.
  - Projectile users use a height cone from the projectile start position.
  - If there's no direct or potential enemy but an alarm enemy exists: `SetAlarmed` (threat anim), with no attack.
- **SortEnemyList** (FO:4785):
  - Candidates = direct list ∪ attackers (`m_xPotEnemies`) ∪ current enemy ∪ `OptimalTarget` attribute.
  - Drop: same owner, not hittable, vanished, AJE-camouflaged (unless current), walls (unless current or on the
    priority list), not visible to the owner, not enemy by diplomacy, neutral (owner -1) with `aggressive!=1` unless it
    attacked us.
  - Also drop targets farther than `2·AlarmRange+AttackRange` from `aggrPos`, unless on the priority list, the attacker
    is wild, or it's an aggression walk.
  - Water-melee units and submarines only take targets at sea level.
  - Sort ascending by
    `(isOptimal?0:100000) + typeRank*10000 + (inPriorityList?0:1000) + ((inRange&&isCurrent)?0:500) + listIndex`.
  - If the unit has a min range, targets in zone ≤ 2 go last, and are dropped if it has no S/M secondary weapon.
  - **Switching**: if already fighting and the best target ≠ current and is out of range, wait until it has been best
    for ≥ 2 s.
- **Retaliation**: when hit, `AddEnemy(A, defend)`. If not fighting (and state ≠ 3): examine and attack the best,
  normally A. Automatic orders never override a user-command task (`Fight` FO:6521).
- **Help shouts** (FO:6641):
  - When a unit starts an automatic fight (forced), each automatic attack (throttle 7 s, 3 s if damaged), and when a
    non-fighter is hit.
  - Same-owner CHTR/VHCL/ANML (plus SHIP if the enemy is a ship, plus SEAS carriers) within 1.1·AlarmRange respond
    after 0.1 s with `AddEnemy`. Excluded: units in user tasks, non-fighters, and defensive units when the shout isn't
    a defend call.
  - Wild animals alert the same class.
- **Attack-move** (`/AggressiveTarget`; also used for a ground click without splash or penetration):
  `aggressionWalk=true`, patrol to the point, chase anything with no leash. `/AggrTNoAnml` skips wild animals.
- **Berserker** (`hu_berserker`): automatic fights against non-building, non-wild, non-nest targets are promoted to
  user priority.

## 9. Open points (engine or uncertain)
1. Exact metric of `IsInCombatRangeAttackZone` (edge vs attack zones, and cone use) and `CheckLineOfSightFight`.
2. Projectile flight time and arc (`ProjectileMgr`, ballistic with g=`bulletfalloff`).
3. FSM tick frequency when no action is running. Assume every sim tick.
4. `FallAction` / Trapped durations are anim-driven.
5. The meaning of the third argument of `AddMyEnemiesToSearch` (in splash, `false`). Assumed: allies are not hit.
