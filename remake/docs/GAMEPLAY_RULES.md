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
  storehouse cuts the stock to the new cap.
* Population: sum of `max_units` of the housing (fireplace 5 / 15, stone cottage 8, tent 5 → big tent 10,
  collector 6, SEAS HQ 30, barracks and garage 25 each), at most 52. Every unit counts as one.
* Army pyramid: 25 / 15 / 8 / 3 / 1 slots on levels 1–5. Levels are bought with skulls: 25, 50, 100, 300 per step
  (a jump sums them); moving down is free; dropping a card on another swaps the two (the lower one pays).
  Level up heals fully and makes the unit invulnerable for 2.5 s (characters) / 1.5 s.
* Skulls: killing gives the victim's `scalps` (default 5, tech tree modifiers apply) to the player who damaged it
  last. Units inside a skull protector's aura give none; Schliemann's aura raises it by 15 %.
* Buying: 100 skulls → 100 food / 67 wood / 50 stone at the Norsemen market (warehouse upgrade), the Dustrider
  bazaar and the Dragon Clan warehouse.

## Gathering (systems/economy.js)

* Loops per load = trunc(K × TF × free space / capacity) plays of the work animation.
  K = 5 wood, 5 stone, 3 bushes and carcasses, 5 fields; TF = worker time factor (SEAS 2.0, others 1.0, Aje tool
  upgrades ×0.75 each), ×2 for stone and food, × the field's time factor on fields.
* Trees fall after 6 chops of 1 s; a log takes 5 workers at most. Nothing regrows.
* Carcasses of wild animals hold the species' food value (settings/Resources.txt) and rot 120 s after the last
  harvest. Running out of carcasses, a worker attacks the next animal of the same kind within 50 m.
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
* Aje BuildDown: half the build time, then the build cost comes back. Self destruction ("Kill") gives nothing back.
  Ninigi buildings with the Explode upgrade blow up when destroyed (500 → 100 damage in 20 m).
* Walls are placed as lines of 8 m segments, each paid separately. Gates are OPEN / CLOSED / AUTO (opens for the
  owner's units and closes 8 s later); a ninja can pick the lock (open for 30 s).
* The warp gate (epoch V, 5000 of everything, skirmish option): when finished its owner wins after 10 minutes
  unless it is destroyed.

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
  never chases. Automatic fights are leashed to the unit's post (2 × alarm range + attack range); orders of the
  player are never overridden. Hit units call their neighbours for help.
* Towers shoot at units first, then towers, buildings, walls; siege units (rams, mortars, catapults) prefer
  buildings. The Norsemen bunker shoots one arrow per garrisoned character (max 4).
* Healers heal amount + 0.25 % max hit points per second; temples heal everyone in 30 m. No passive regeneration.

## Special moves (systems/moves.js)

Every special move of the four tribes and the heroes is in the `MOVES` table with the original effect: automatic
ones (Kick, Roar, Quake, Twister, burst arrow, multi-shot, stampede, tail bash) replace a normal hit when their
condition holds; the others are used from the star menu, many need a target. The tech tree `duration` is the
cooldown. Original quirks are kept (Matrix never fires, BrachioStomp hurts more at the edge, lockpicking has no
cooldown).

## Auras (systems/effects.js)

Warcry, warpaint, drums, pennant, magic cauldron, scarecrow, Ninigi cauldron, skull protector, smoke tower /
smoke bomb invisibility and all hero auras are rows of the `AURAS` table, recomputed every second.

## Approximations

* Range zones use distance to the victim's surface instead of the engine's attack zones; line of sight is not
  checked for attacks.
* Projectile flight time = distance / bullet speed on a simple arc.
* The engine's WallMap is replaced by straight 8 m segment lines; units can't walk on walls, ladders and siege
  towers only act as transports.
* Transports: passengers of open transports (howdahs) shoot from the animal's back; closed ones carry them hidden.
* Ships and harbours are not available (the jungle map has no coast).
* The flying trader is not implemented. Trade carts use the farthest own/allied market as their route.
* A spirit lasts 60 s (the original's lifetime is engine-side); the resurrect prayer takes 6.5 s + 1.5 s.

## Faction specials (summary)

| Mechanic | Where | Rule |
|---|---|---|
| Raptor egg | combat.js `projectileUpdate` | `aje_ankylosaurus_catapult_dino` ammo (`aje_ammo_dino`) hatches an autonomous `aje_velociraptor` for the shooter at the impact point; it hunts for 30 s, then disappears (CDinoAmmoEgg) |
| Tracker dino | world.js `spawnUnit`, animals.js `trackerUpdate` | `aje_tracker_dino` acts on its own, scouts ahead, attacks enemies within 50 m (checked every 2 s), dies after 180 s (CTrackerDino) |
| Spirits | combat.js `unitDied`, world.js `spiritTick` | every owned character / animal leaves a spirit except heroes, illusions and summoned units |
| Resurrect | moves.js `Resurrect` | Aje shaman walks to 20 m, reserves a pyramid slot at the spirit's level, prays, and the unit returns at that level |
| Ninja disguise | combat.js `fire` / `onHurt`, world.js idle | after `disguise` is researched the ninja is disguised; attacking or being hit drops it, it returns 10 s after the last fight |
| Weapon swaps | rules.js `weaponPaths` | filters that move a class between weapons' `Users` lists (the ankylosaurus catapult) are read from the owner's live tree |
