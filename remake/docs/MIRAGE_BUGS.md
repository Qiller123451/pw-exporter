# MIRAGE: bugs found while porting its special moves

Found in MIRAGE 2.6.7's server scripts (`Data/MIRAGE/Scripts/Server`) and tech tree while porting its moves to the
remake (docs/spec/moves_mirage.md). Line numbers are of the files in the mod as installed. "Remake" says what the
remake does; "fixed" means it does what the code was evidently meant to do.

MIRAGE's own task scripts (`classes/task/*.usl`) and its game client scripts are not in the mod's files, so moves that
run through those tasks could only be checked as far as the calls into them.

## Bugs with a clear fix (fixed in the remake)

| # | Where | What happens | Remake |
|---|---|---|---|
| 1 | `classes/character/character.usl:329, 386, 578` (Kick / Quake / Roar checks) | `GetClassName()!="hu_warrior" \|\| GetClassName()!="hu_jetpack_warrior"` is always true, so the check returns false and the Norsemen's automatic Kick, Quake and Roar never fire. The Dustrider copies (`bfpw_*`, :413-478) test one class and work. | fixed: `&&`; the moves fire as in the official game |
| 2 | `classes/mirage/Mirage.usl:4924` (`CParasite.HandleEvent`) | The second branch tests `TRACKER_TIMER` again instead of `TIMER_PARASITE_LIFE`, so the parasite never expires; the medic's player sees with the host until it dies. | fixed: the parasite ends after 480 s (`ENERGY`) |
| 3 | `classes/character/SEAS.usl:44-70` (`CSEAS.Stimpack`), `FightingObj/TransportObj/TransportObj.usl:1617, 2146` | No `CheckSpecialActionTimer` / `AddSpecialActionTimer`: the tech tree's 5 s cooldown is never applied and the server never checks that the stimpack was researched. Only the 10 s effect and the 40 hit points limit it. | fixed: 5 s cooldown, and only once researched |
| 4 | `classes/character/character.usl:2758-2784` (`DeafeningRoar`), `mirage/Miracle.usl:6158` (`CCustomTask.Init`) | Queued with Shift, the deafening runs later as `DeafeningRoar(path, m_fRealValue)`, but the 4-argument `Init` never sets `m_fRealValue`: radius 0, nobody is deafened, mana and cooldown are spent. | fixed: always 15 m |
| 5 | `classes/character/character.usl:3230-3234` (`PeaceGong`) | `bFriend` is computed but not used, so the monk's peace gong can be cast on enemies (their units and buildings become invulnerable and untargetable). The tech tree allows Owner/Allies only. | fixed: own and allied targets only |
| 6 | `classes/character/Hero.usl:543-550` (`MickDundee`) | Stina's move starts `CMickDundeeMove`; the Base task casts its actor to `CAnimal` and ends at once when that fails - Stina is a hero, so (unless MIRAGE's own version of the task differs) the move does nothing. Stina also normally rides her cat, and heroes ignore commands while carried (Hero.usl:772). | fixed: Stina hypnotises the enemy animal (asleep for 20 s, as the eusmilus' Hypnosis) |
| 7 | tech tree, Stina's model (`Objects/Special/CHTR/Stina_s0` gfx `Stina_s1` .. `Stina_s4`) | Those models are in none of the mod's or the game's GSF archives; only `stina_s0` exists. | the remake draws `stina_s0` (the class file's model) |

## Bugs and leftovers the remake keeps as they are (no clear intended behaviour)

| # | Where | What happens |
|---|---|---|
| 8 | `mirage/Miracle.usl:6-178` (`CCyborgRoar`) | `CyborgRoar("roaring", 7.0, 0.8, radius 12, mult 3.0, dur 10)`: radius, multiplier and duration are not used (30 m and 15 s are hard-coded at :102); the state `do_deafening` (enemies within 12 m: 3x melee damage, armour piercing 100, deafened 10 s) is never entered (:125 commented out). |
| 9 | `mirage/Miracle.usl:7209-7314` (`CMKHand`), `FightingObj.usl:15517` | The exocutor hand "intimidates" everything within 50 m for 20 s, but `GetIntimidate()` is never read: only the 10 m knock-down has an effect. |
| 10 | `mirage/Miracle.usl:1733-1736` (`CWalkingBomb`) | The sacrificer is never set (`xSacrificer` stays invalid), so the walking bomb's kills count for the victim's owner. |
| 11 | `FightingObj.usl:17708-17716` (`DoAreaDamageForAllAgain`, used by the walking bomb and the meteor) | The query only calls `SetOwner(-1, true)`; the enemy/friend lines are commented out. If `-1` means "any owner" both hit the caster's own side too (the remake does so); if it means "neutral only" they hit almost nothing. |
| 12 | tech tree `Actions/SEAS/Moves/ANML/stimpack_rex` | Visibility -1, +1 from the stimpack research = 0: the button stays hidden unless the "titan slots" setting adds another +1. |
| 13 | tech tree `Filters/Hu/Upgrades/hu_fireplace/age_3` `mod_vis_upgrade_tree_camouflage` (op `replace`, value 0) | The druid's tree camouflage can never be researched. The move itself (`character.usl:813 EnableHuCamouflage`) also starts no cooldown, sets no stealth flag, has nothing that turns it off (the druid stays a tree that can't walk), and clicked on an animal it sets the model "". The remake leaves it out. |
| 14 | `classes/animals/Animal.usl:1162-1165, 3564-3567, 1234-1274` (FeignDeath) | The dispatchers and the task are commented out, and the research's visibility sums to -1 (-2 +1). Leftovers: walking or a reveal still break a `CFeignDeath` (FightingObj.usl:2360, 8211). |
| 15 | tech tree `Actions/Hu/Moves/CHTR/Hu_Multi_Arrow` | No script refers to it. |
| 16 | `mirage/Miracle.usl:4117-4119` (`CMeteor`, state `check_time`) | `if(!IsInRange()) EndTask();` has no `return`. After the cast the druid always walks back to 70 m from the impact. |
| 17 | `mirage/Miracle.usl:7466-7470, 7651` (`CSpecialMinigun`) | `RANGE = 35` is unused (the suit's attack range is used); a second `elseif "finished"` branch can't be reached. |
| 18 | `classes/character/Hero.usl:491-541` (`CallTwins`) | The twins appear at a random angle of `(rand % 314) / 100` radians: always on one side of Larry (a half circle). |
| 19 | `mirage/Miracle.usl:5337-5341` (`CReanimation`, the old spirits) | `StartSpecialActionTimer` is called twice (the second call does nothing). |
| 20 | tech tree `plunder` `secondaryexcludes` | 50 species names, but the dispatcher (`Mirage.usl:337`) uses the one-argument check, so they are not enforced. |
| 21 | tech tree `deplenish` | The action and its icon still describe the older targeted curse (60 s); the code is a self-centred 30 m / 15 s curse (a commented-out targeted version is at character.usl:3618-3672). |
| 22 | `FightingObj.usl:15191` (`SetPeaceTime`), `:15222` (`SetUnboard`), `TransportObj.usl` (jetpack) | Effect models that exist in no GSF: `fx_stina_hypnosis_big` (peace gong), `Deathping_Char_Fx` (unboard curse), `Hu_Steam_Jet_Pack` / `Hu_Steam_Jet_Pack_On` (jetpack bag; only `hu_steam_jet_pack_off` exists). MIRAGE `hu_buildings.txt:568` gives `CHu_Temple_Dem_Fx` the gfx `CHu_Temple_Dem_Fx` (the model is `Hu_Temple_Dem_Fx`). |
| 23 | MIRAGE server events 26, 27, 28, 31, 43, 44, 45 (`InvokeGenericSCEvent`; e.g. the minefield's explosion, the stimpack) | The Base client (`Scripts/Game/Game.usl:953-1097`) handles none of them, so unless MIRAGE ships a client of its own they show nothing. |
