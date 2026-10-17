# Gameplay rules as implemented

The remake follows the original rules as far as the scripts and the tech tree show them. Numbers are not typed into
the code: they are read from the tech tree at runtime, so every upgrade, level filter and hero aura of the original
works through the same data. Where the original logic lives in the C++ engine (not visible in the scripts), the
remake uses a documented approximation (marked *approx.*). The full extracted rules with file/line references are in
[spec/](spec/).

## Players, resources, population

* Start (multiplayer default preset): the tribe's base – Norsemen fireplace, Dragon Clan fireplace, SEAS
  headquarters or the Dustrider resource collector (a walking storehouse) – three workers, 200 food, 150 wood,
  100 stone.
* Storage: each resource is capped at the sum of the finished storehouses' limits, at least 300. Losing a
  storehouse cuts the stock to the new cap. Income is rounded to the nearest whole unit (`CPlayer.AddResource`).
* Population: sum of `max_units` of the housing (fireplace 5 / 15, stone cottage 8, tent 5 → big tent 10,
  collector 6, SEAS HQ 30, barracks and garage 25 each), at most 52. Every unit counts as one, and so does the Aje
  floating harbour from its site on (CSwimmingHarbour.DoesCountInUnitLimit) - it has a card on the pyramid's first
  row that can't be levelled.
* Army pyramid: 25 / 15 / 8 / 3 / 1 slots on levels 1–5. Levels are bought with skulls: 25, 50, 100, 300 per step
  (a jump sums them); moving down is free; dropping a card on another swaps the two (the lower one pays).
  Level up heals fully and makes the unit invulnerable for 2.5 s (characters) / 1.5 s - when it has a level-up
  animation and is neither in a transport nor trapped.
* Skulls: killing gives the victim's `scalps` (default 5, tech tree modifiers apply) to the player who damaged it
  last. Units inside a skull protector's aura give none; Schliemann's aura raises it by 15 %.
* Buying: 100 skulls → 100 food / 67 wood / 50 stone at the Norsemen market (warehouse upgrade), the Dustrider
  bazaar and the Dragon Clan warehouse.

## Gathering (systems/economy.js)

* Loops per load = trunc(K × TF × free space / capacity) plays of the work animation.
  K = 5 wood, 5 stone, 3 bushes and carcasses, 5 fields; TF = worker time factor (SEAS 2.0, others 1.0, Aje tool
  upgrades ×0.75 each), ×2 for stone and food, × the field's time factor on fields.
* Trees fall after 6 chops of 1 s; a log takes 5 workers at most. Nothing regrows. The wood of a tree is its
  type's (settings/Resources.txt WOOD "<tree>_timber"): 300 most trees, 150 the medium jungle trees and larches, 100
  bamboo and dead trees, 250 beach palms, 400 the Ash Valley trees, 500 the beech (maps/source.js treeOf; the
  sequel's maps too). Stone deposits hold 2000, fruit bushes 150 (a map's object can set its own).
* Carcasses of wild animals hold the species' food value (settings/Resources.txt) and rot 120 s after the last
  harvest. Running out of carcasses, a worker attacks the next animal of the same kind within 50 m.
* Wild animals eat: hunters the carcasses of their area, the others trees or grass; feeding heals them by half the
  damage of their weapon a loop and takes it off the carcass. A nest's young have a fifth of the hit points and damage
  when born and grow to the full in the species' growup time (and give a share of the skulls); a death frightens
  the peaceful animals within 60 m (ARCHITECTURE.md "Wild animals").
* Fields (corn field, paddy, bamboo farm → wood, greenhouse) take 2 workers and never run out; the harvest is
  credited in chunks of 2–5 loops ("sowing", later "scything"). The Aje slaughterhouse takes 4 workers and
  credits the full load before its animation.
* Workers carry wood on the shoulder and stone/food in the tribe's container (pannier, clay jug, basket, backpack);
  when the storage is full they wait at the storehouse.

## Building (systems/construction.js)

* The whole cost is paid when the site is placed. Build time = duration × slowest worker's time factor ×
  (0.1 + 0.9 × 0.8^(N−1)) for N workers; Tesla (level 2+, within 20 m) and Babbage (level 5) double the speed.
* Sites block paths from 25 % progress; the four construction stages, cranes (animated while workers hammer) and the
  hit points follow the progress. Damage stages at 50 % and 25 % hit points (smoke, fire at the D_ links).
* Repair: 20 + 5 × level hit points per second per worker; a full repair costs 50 % of the build cost.
* Aje BuildDown: an item of the building's queue (CBuildDownBuilding): it waits behind what was queued before it,
  takes the building's other actions away from the moment it is queued, and a click on it in the queue cancels it;
  half the build time, then the build cost comes back. Self destruction ("Kill") gives nothing back,
  not even for an unfinished site. Traps, fields and the slaughterhouse do not block paths (their `SetPFBlocking`
  is empty: `CTrap`, `CGrowingField`, `CAjeUnlimitedBuilding`, by the script class chain `gamedata.json
  classParents`).
  Ninigi buildings with the Explode upgrade blow up when destroyed (500 → 100 damage in 20 m).
* Walls are placed as lines of 8 m segments, each paid separately. Gates are OPEN / CLOSED / AUTO (opens for the
  owner's units and closes 8 s later); a ninja can pick the lock (open for 30 s).
* The warp gate (epoch V, 5000 of everything, skirmish option): when finished its owner wins after 10 minutes
  unless it is destroyed. A map's warp gate object goes when the option is off; with it, every player sees 20 m
  around it.
* Workers sent from a building with a rally point start the job there (CTheLite: a tree within 5 m, stone 3 m,
  fruit or food 10 m, a site or damaged building 10 m). A worker that finishes a building goes on by
  `NextJob`: walls to the next segment, farms to their field, quarry / lumber camp / hunting lodge to the nearest
  stone (100 m) / wood (64 m) / animal (100 m), (MIRAGE) storehouses to a resource they take within 40 m, else
  repairs or helps on the nearest site within 50 m.

## Production and upgrades (systems/production.js)

* Queues hold 6 items; population and pyramid slots are reserved while queued.
* Upgrades switch tech tree filters: "player" results for the whole tribe, "local" ones only for the building
  that researched them (Aje farm modes, big tent, Ninigi Explode).
* Heroes are hired at the tavern / cook house / teahouse (250 food, 25 skulls, 45 s); one of each per player.

## Combat (systems/combat.js)

* Weapons: the best weapon allowed at the unit's level; short / medium secondary weapons are used when enemies come
  close (a spearman's dagger); weapons with a minimum range can't hit close targets.
* Damage per hit = dmg × buffs × (1 + attack bonus vs. the victim's type) × (1 − protection %), protection =
  armour − armour piercing (melee) or ranged armour − armour piercing (projectiles), clamped to 0–99 %; at least
  1 hit point. Area weapons fall off linearly from `damage` to `enddamage`; cone weapons (flamethrowers) hit
  everything in the cone. No friendly fire.
* Poison ticks every 3 s; only the strongest of two poisons hurts. Big units sometimes knock small ones back.
* Stances: aggressive (default) attacks anything in sight; defensive (workers) only fights back; hold ground
  never chases. A unit fighting on its own looks for a better target every 3 s (± 10 %, Fight.usl TIMER_AGGRO), and
  takes one out of its reach only after it has stayed the better choice for 2 s. A worker whose hunted prey dies
  gathers its carcass. Minimum ranges count from the centres plus the fighter's radius, minus the target's. Automatic fights are leashed to the unit's post (2 × alarm range + attack range); orders of the
  player are never overridden. Hit units call their neighbours for help.
* Towers shoot at units first, then towers, buildings, walls; siege units (rams, mortars, catapults) prefer
  buildings. The Norsemen bunker shoots one arrow per garrisoned character (max 4), each after the projectile delay
  × (1 + 0.1 × its number) (CBunker.AttackEnemy).
* Healers heal amount + 0.25 % max hit points per second; temples heal everyone in 30 m. No passive regeneration.
  A finished temple (MIRAGE: also the SEAS fortress) shows the healing aura `fx_heal_area` (Building.usl
  CTemple.SetReady AddFX; game/entities.js READY_FX): its light rays and dots, drawn additively (GSF material flag 0x4).

## Special moves (systems/moves.js)

Every special move of the four tribes and the heroes is in the `MOVES` table with the original effect: automatic
ones (Kick, Roar, Quake, Twister, burst arrow, multi-shot, stampede, tail bash) replace a normal hit when their
condition holds; the others are used from the star menu, many need a target. The tech tree `duration` is the
cooldown. Original quirks are kept (Matrix never fires, BrachioStomp hurts more at the edge, lockpicking has no
cooldown). The burst arrow falls to its end damage at the edge; a stampede ends with its first hit and throws the
enemies near it 10 m aside; the wild boar's rage is MIRAGE's only.

## Auras (systems/effects.js)

Warcry, warpaint, drums, pennant, magic cauldron, scarecrow, Ninigi cauldron, skull protector, smoke tower /
smoke bomb invisibility and all hero auras are rows of the `AURAS` table, recomputed every second. Auras on enemies
count wild animals only when they are aggressive (Schliemann's: all of them); Livingstone drains
`10 / weapon damage` of a hit from enemies his owner can see.

Heroes by level: stats from the level filters, the aura from level 2, the special move from level 3, and at level 5
the class's `Chief_Bonus` filter (heroes' included, like every unit's): in the official game Ada halves production
times, Cole gives infantry +100 hit points, Stina animals armour, Taslow the build cost of destroyed enemy buildings,
Babbit faster construction. The auras are read from the data (`effects.js heroEffect`): the hero's RangeEffect
ability (radius, on enemies or friends) and its RangeEffect filter (bonus entries per class, attack slowdown, skull
value), so a mod's heroes do what they do there - MIRAGE's give SEAS units bonuses too, over 30 m; the scripts'
constants (building damage bonus, Livingstone's drain) come from the configuration's Hero.usl
(`gamedata.json hero_consts`). The tooltips list these level lines the way the original does (`ui/hud.js infoHtml`). Copies of a class
(the sequel's heroes) follow their original's scripted rules (`Rules.kind`). Production times are scaled by the
tribe's `/Modifications/<tribe>/Build/<type>/duration`.

## Approximations

* Range zones use distance to the victim's surface instead of the engine's attack zones; line of sight is not
  checked for attacks.
* Projectile flight time = distance / bullet speed on a simple arc.
* The engine's WallMap is replaced by straight 8 m segment lines; units can't walk on walls, ladders and siege
  towers only act as transports.
* Transports: passengers of open transports (howdahs) shoot from the animal's back, where they are shown on the
  build-up's free "Dri" links (game/compose.js `syncPassengers`, CBuildUpTransporterOpen); closed ones carry them
  hidden. The passengers' menu (CommandBar "slots") shows a card per passenger - a click lets that one out - and the
  empty places.
* Ships and harbours work on maps with water (systems/naval.js, docs/spec/naval.md); the random jungle has no coast.
* Trade (Trade.usl): a cart's home is the trade building that made it. Sent to a friendly trade building (the
  Dock order) it shuttles between the two; at each end the market's owner gets 5 × (distance / 50)^1.3219 of every
  resource (no price divisor: the flying trader's manager is switched off in the original, `CFlyingTraderMgr.OnInit`),
  and the market reached becomes its home. A new cart waits for its order.
* A spirit lasts 60 s (the original's lifetime is engine-side); the resurrect prayer takes 6.5 s + 1.5 s.

## Faction specials (summary)

| Mechanic | Where | Rule |
|---|---|---|
| Raptor egg | combat.js `projectileUpdate` | `aje_ankylosaurus_catapult_dino` ammo (`aje_ammo_dino`) hatches an autonomous `aje_velociraptor` for the shooter at the impact point; it hunts for 30 s, then disappears (CDinoAmmoEgg) |
| Tracker dino | world.js `spawnUnit`, animals.js `trackerUpdate` | `aje_tracker_dino` acts on its own, scouts ahead, attacks enemies within 50 m (checked every 2 s), dies after 180 s (CTrackerDino) |
| Spirits | combat.js `unitDied`, world.js `spiritTick` | every owned character / animal leaves a spirit except illusions and summoned units; heroes (and the eusmilus) only on multiplayer levels |
| Resurrect | moves.js `Resurrect` | Aje shaman walks to 20 m, reserves a pyramid slot at the spirit's level, prays, and the unit returns at that level |
| Ninja disguise | combat.js `fire` / `onHurt`, world.js idle | after `disguise` is researched the ninja is disguised; attacking or being hit drops it, it returns 10 s after the last fight |
| Weapon swaps | rules.js `weaponPaths` | filters that move a class between weapons' `Users` lists (the ankylosaurus catapult) are read from the owner's live tree |
