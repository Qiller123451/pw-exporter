# Changing and extending the game

Most changes need no code: the numbers come from the original tech tree (`techtree.json`). For new behaviour, every
rule lives in a small table or system file.

## Change numbers (costs, hit points, damage, build times ...)

Edit the tech tree and rebuild `techtree.json` (`python -m remake.pipeline <game> <data folder> rules`), or change
`techtree.json` in the built game data folder directly:

* object values: `StartTT.Objects.<Tribe>.<CHTR|ANML|VHCL|BLDG>.<class>` – `hitpoints`, `FOW`, `defaultspeed`,
  `UpdateLimits` (housing / storage), `ResInvCaps` (carrying), `timefactor`, `scalps`, `special_abilities`
* weapons: `StartTT.Objects.<Tribe>.Weapons.<id>` – `damage`, `range`, `frequency` (hits per minute),
  `defense`, `rangeddefense`, `armorpiercing`, `hitrange` (splash), `AttackBonus`, `Users` (which classes carry it)
* actions: `StartTT.Actions.<Tribe>.<Build|Upgrades|Moves>.<category>.<id>` – `duration`, `conditions.rescosts`
  (`iron` = skulls), `conditions.inventobjects` (requirements), `locations` (where it is offered)
* upgrades: `Filters.<Tribe>.Upgrades.<location>.<id>.Modificators` – `{op: add|multiply|replace|append|remove,
  path, value}`

## Add a special move

1. The action must exist in the tech tree (`Actions/<Tribe>/Moves/CHTR/<id>` with `locations` and `duration`).
2. Add an entry to `MOVES` in `src/game/systems/moves.js`:

```js
my_move: {
  target: 'enemy', range: 20,              // or  self: true   /   auto: (W, u, enemy) => condition
  run(W, u, target, pos) {                 // return false if it could not be used (no cooldown then)
    W.takeDirectDmg(target, 300, 0, u.owner, true, u);
    return true;
  },
},
```

Helpers: `W.takeDmg` (normal weapon hit), `W.takeDirectDmg`, `W.areaDamage`, `W.penetrate`, `W.knockback`,
`W.trap` (stun), `W.periodicEffect`, `W.later`, `W.reveal`, `W.setCamo`, `W.localFilter` (temporary filter).

## Add an aura

Add a row to `AURAS` in `src/game/systems/effects.js`, keyed by the source class:

```js
my_banner: { who: 'friend', radius: () => 25, when: (s, w) => true, match: (u) => u.kind === 'unit',
             apply: (u) => { u.st.bonus.DEFENSE += 10; } },
```

Buckets: `DAMAGE`, `DEFENSE`, `RANGEDDEFENSE`, `RANGE`, `BLDGDAMAGE`; multipliers go into `u.st.aura` and are
read in `attackBoni` / `tempDef`.

## Give a building class behaviour

Add an entry to `BEHAVIOURS` in `src/game/systems/buildings.js`, keyed by the script class from
`classes/buildings/*_buildings.txt` (see `gamedata.json → script`):

```js
CMyShrine: {
  built(b, W) { b.charge = 0; },
  update(b, W, dt) { if ((b.charge += dt) > 30) { b.charge = 0; W.reveal(b.owner, b.pos, 40, 10, true); } },
  destroyed(b, W) {},
},
```

## Teach the AI

The computer player (`src/game/ai/`, docs/COMPUTER_PLAYER.md) plays from the original's own tables, which the
pipeline extracts into `ai.json`: build orders per tribe and personality, attack plans, army tables, unit mixes,
the difficulty levels. A mod that changes the game's AI scripts or `Scripts/Ai/settings/**` changes the remake's
AI after the `ai` step ran again. Without `ai.json` (or for a tribe whose settings folder is missing) the fallbacks
in `ai/data.js` are used: `PLANS` holds a build order per tribe (`[building, epoch, count]`), unit mixes and
squads are derived from the tech tree. What a list entry needs first (its building, a farm mode, an epoch) is
worked out from the tech tree, so new units and buildings need no AI code.

## Maps

Original and community maps (`.ula`) are played as they are. Every `Data/<pack>/Maps` folder of the game
(Base, BoosterPacks, mods) is listed, and loose maps go into `Remake/Maps/` (sub-folders are fine). "Open map
file…" in the map picker loads a map from anywhere. The file format is in
[MAP_FORMAT.md](../../docs/MAP_FORMAT.md). How map objects become game objects (which class is a wood tree, which decor blocks
movement, how nests spawn) is in `src/game/maps/source.js`. Grass density per ground material is in
`src/engine/grass.js → GRASS_DENSITY`. The random map is `src/game/mapgen.js`.

## New models, sounds, interface art

See [DATA_PIPELINE.md](DATA_PIPELINE.md). Extra models the tech tree doesn't reference go into
`remake/pipeline/roster.json → extra_models`.

## Check your change

`node tests/rules_check.mjs` and `python3 tests/sim.py "&tribe=<Tribe>&enemy=<Tribe>&aivai" 300,300` (with the
dev server running: `python remake/devserver.py --game <ParaWorld folder>`; set `PW_REMAKE_DATA` to the built game
data folder for the node tests).
