# ParaWorld Shooter - design notes

## What comes from where

| thing | source |
|---|---|
| map (heights, ground materials, 3176 placed objects) | `Data/Base/Maps/Cpn_single_001/single_05.ula`, read by `pw/game/maps/ula.js` |
| models, textures, animation clips | the remake's prepared data (`assets/models/*.glb`, `assets/tex`, `manifest.json`) |
| ground textures | `assets/terrain/<setting>/scape_0..7.jpg` (the map's setting is Cave1) |
| sounds | `Audio/Sound/**.wav` of the installation (IMA ADPCM, decoded by `pw/engine/audio.js`), index `assets/sounds.json` |
| particles | the game's atlases `particle_01.png`, `particle_08.png`, `gore.png`, `scorch.png` |

## Scale and coordinates

Models and maps use ParaWorld's unit: a soldier is ~4 u tall, units run 7 u/s in the original. Game coordinates:
x east, z south, y up, origin in the middle of the map (map file: x east, y north, origin in a corner).
An object with `rotation.y = h` faces `(-sin h, 0, -cos h)`.

## The level (level.js, collision.js)

Scenery objects (types DCCO, DECO, VGTN, TREE, BLDG ...) are drawn as instanced props, exactly as the remake does.
The whole city is ~430 000 triangles, so all instances are written once and always drawn.

Everything built that is bigger than clutter (footprint >= 2 u; not plants, chairs, lanterns) goes into the
**collision triangle soup**: ~650 000 triangles sorted into 2 u grid columns. Three queries carry the game:

* `groundAt(x, z, yMax)` - highest walkable surface not above `yMax`. A character asks with `yMax = feet + step
  height`, so an arch or roof overhead is ignored while stairs, bridges and roofs it stands on are found.
* `pushOut(p, r, y0, y1)` - moves a body out of every triangle steeper than a ramp between knee and head height.
* `raycast(...)` - bullets, the camera boom, line of sight (2D DDA over the columns + a march over the terrain).

## The swarm (nav.js, enemies.js, mission.js)

`NavGrid.build()` floods outwards from the player's start over 2 u cells, carrying the floor height along (so bridges,
stairs and arches come out right) and recording which neighbours can be stepped to. ~64 000 cells, about half a
second. Every 0.3 s `flowTo(player)` runs one Dijkstra over the cells within 260 u; each enemy just asks
`dir(x, z)` and adds a little separation from its neighbours. Close to the player they go straight at him.

Only `attackSlots` enemies strike at once; the others shuffle around the player. Spearmen and archers stop and
shoot when they have a line of sight. Damage makes enemies flinch, heavy blows knock them down or throw the body
through the air; nearly dead ones may reel ("dazed", red E ring) and can be executed.

The director (mission.js) spawns groups 55-120 u of *walking* distance from the player on spots the camera cannot
see, so enemies always arrive running out of side streets.

## The player (player.js, actors.js)

The ParaWorld characters only have a forward walk cycle. To run and shoot in any direction the body turns towards
the direction of travel (within 80 degrees of the aim; beyond that it faces the other way and the cycle plays
backwards) and the spine bones are twisted back towards the aim. `BodyAnim` splits every clip into a legs part and
an upper-body part (by bone), so the legs can run while the arms hold and fire the weapon. The firing clips are the
units' own (`seas_gunner_0`, `seas_flamethrower_0`, `seas_rocketman_0`, the Executioner's `attack_front_m_0`); the
flamethrower, rocket and jetpack clips are borrowed from those units - all humans share one skeleton.

Shots go where the middle of the screen points: a ray from the camera finds the aim point, the bullet then flies
from the muzzle to that point.

## Simulation

Fixed steps of 1/60 s (`Game.sim`), drawing once per frame. `timeScale` implements hit-stop and slow motion.
`game.test.run(seconds, fn)` advances the game without drawing - the tests use it (software WebGL is far too slow
to play in real time).

## Tests (tests/)

```
NODE_PATH=<node_modules with playwright> node tests/shot.mjs "http://127.0.0.1:8430/?test&autostart&quality=low" out.png tests/route.js
```
* `route.js` - the player walks to every objective along the nav grid (is the mission walkable?)
* `playthrough.js` - a bot plays the whole mission (`window.PLAY = {minutes, god}`)
* `stuck.js` - the player stands still at each objective while the swarm is spawned around: lists every enemy
  that stops moving on its way, with the scenery next to it, and how often enemies had to vault
  (`window.STUCK = {spots, seconds, mix, max, group}`)
* `spin.js` - the aim twist of the spine must not build up from frame to frame
* `loop.js` - the legs play the cycle part of the walk clip, no standstill while running
* `blast.js` - the destroyed Executioner blows up after its death clip: enemies in the radius hit, the Gunner not
* `protect.js` - the damage limiters (budget, armour gate, last stand) and how long standing still in a swarm of 60 lasts with and without them
* `targets.js` - every target of every destroy objective can be hit and destroyed; no look-alike of a target is left as scenery
* `claws.js` - the Executioner's claw swings follow each other without a pause, held or tapped at any rhythm
  (the swing is only half of it: what the player sees is when the claws come down. Measured as the forward reach of
  the claw tips over the clip: `attack_front_s_0` strikes at 0.6 s, `_s_2` at 0.9 s, `_s_3` winds back until 0.8 s and
  strikes at 1.3 s, `attack_front` never reaches forward at all - which is why the third swing uses `_s_3` started
  at 0.5 s (`at` in the combo) and all three now strike 0.3-0.45 s after the click)
* `dash.js` - dash length per character, no damage during it, the Executioner's ram hits everyone in the path once
* `allies.js` - (The Assault) what the troops do on their own: kills, losses, the swarm's size over a minute
* `ultimate.js` - the bombardment: how long, how many bombs, enemies hit, no damage to the player or the troops, cooldown
* `checkpoint.js` - taking the mission up at an objective (`?from=N`): zones, place, targets already gone, storing
* `range.js` - bullets hit inside the weapon's range and not beyond; a rocket goes off at its reach
* `water.js` - walking into a pond stops at knee depth, no rescue teleport; a jetpack jump may cross
* `numbers.js` - damage numbers: hits on one enemy in quick succession add up to one number, a kill shows the health
  that was left (not the overkill), head shots / fire / big hits have their own colour, the setting switches them off
* `wall.js` - the border of the open districts and the rubble hold the player; the gate lets him through once open
* `zones.js` + `zones_map.py` - the districts as computed, drawn as a map
* `aim.js` - every weapon's barrel points where the camera looks; the Executioner's button scheme

## How the swarm finds its way (and does not get stuck)

* The nav grid is made for bodies, not points (`nav.js`): a cell is walkable only if a body fits at its middle,
  the floor is level across the body (no rubble sticking up) and not a steep built surface; two cells are linked
  only if rays at the knee, the chest and both shoulders pass. Posts, trunks, barricades are walked around.
* `dir()` looks up to three cells ahead only while the straight line there is free.
* Enemies run straight at the player only within 22 u *and* with a clear line; otherwise along the flow field.
* The big dinosaurs use a second grid (`nav.wide()`: cells with room all round) and fall back to the normal one;
  against walls their body counts as at most `CFG.nav.maxBody` wide.
* Safety nets (`enemies.js`): no progress for a second with scenery in the way -> steer to the middle of the next
  path cell; a second time -> vault onto the path two cells on. No route at all for 6 s, far away and unseen ->
  the enemy is recycled and the wave sends a new one.
* Chairs, tables and sleepers are not solid (`CFG.collision.ignore`): they only jammed the paths.

## Aiming the guns

* The firing clips of the ParaWorld soldiers turn the whole unit (the hips) towards the target. Here the legs play
  the walk cycle and only the upper body plays the firing clip, so on its own the gun would point ~60-90 degrees
  off to the side. `BodyAnim.aim()` therefore turns the spine, after the animation, until the barrel points along
  the line from the gun to what the middle of the screen shows (`Player.animate`, weight `aimW`: on while a gun is
  held ready or fired, off while sprinting, during the knife swing and full-body clips).
* Barrel direction: for held weapons `CFG.weapons.*.barrel` in the weapon model's frame (found by a principal-axis
  fit of its vertices; the sign from playing the original full-body clip), for the Executioner the line through two
  forearm bones (`classes.executioner.barrel`). Shots, flames and rockets start at grip + barrel x `barrelLen`.
* `tests/aim.js` measures the difference between barrel and camera direction (now 2-4 degrees, was up to 90).
* Executioner: `aimToShoot` - no weapon switching; the claws on the left button, the minigun while the right
  button is held.
* First person: the Gunner's eye is placed relative to the gun grip (`fpGun`), so the weapon is always in the lower
  right corner; the Executioner keeps his body (`fpBody`), the eye rides on the head bone, the head is shrunk
  away and, without the gun up, the shoulders are turned so both arms are in the picture (`fpArms`).

## Districts (zones)

`zones.js`, `CFG.zones`. The city is cut into districts by lines across the streets ("cuts"). Every cell of the
nav grid gets its zone by flooding the streets from the zones' seed points up to the cut lines; a cell on a cut
belongs to the later of the two zones, everything that is not street to the nearest street's zone. Zones open in
the order of the list (`mission.objectives[].zone`).

* **The player** may only stand in cells of open zones (`Zones.allowedAt`, asked in `Player._physics` after every
  move, at any height - so the jetpack cannot leave either). Where a street crosses the border a lattice wall is
  drawn (one mesh of quads along the cell edges, shader fades it in near the player and rings where it is touched).
* **Rubble**: where a cut crosses a street ("gap") barricades are heaped along it; the map's own barricades within
  `gateRange` of a cut are handed over by `level.js` instead of going into the static city, so they can be removed.
  They are circles the player collides with. When both zones of a gap are open the rubble is blown away.
* **The city gate** is a cut of kind `'D'` (door): the gate model is placed on its own (not instanced, and from the
  unmerged model, because the static version merges the door wings into the walls), its door meshes are left out
  of the collision and hidden when the gate opens; while shut, the door cells are masked in the nav grid.
* **The Dustriders** are not bound by zones: their paths lead over the rubble and they vault it
  (`Zones.closedAt` -> `Enemy.vaultOut`), the big ones walk through. That keeps a large area for spawning out of
  sight even while the player is in a small district.
* Cuts marked `'P'` are the edge of the playing field and never open.
* Designing: `tests/zones.js` + `tests/zones_map.py` draw the result and list every gap with the zones on its two
  sides; `Zones.report.leaks` (also an error in the console and the log) names zones that are not separated. A
  leak is closed by extending a cut or adding one across the street that goes round it. `tests/wall.js` checks
  that the border and the rubble hold on foot, dashing and with the jetpack.
* The nav grid's `meshNy` had to go from 0.62 to 0.5: the ramps into the eastern quarter are steeper built
  surfaces, with 0.62 that whole quarter was unreachable.

## Objectives and targets

`mission.js`: `reach`, `kill`, `hold` (a clock that runs while the player is inside the marked band), `destroy`
(structures: tents, totems, canoes - enemies of kind `structure` that stand still and only take damage, so every
weapon works on them without special cases; the flamethrower does extra; the one hit last shows its health in the
bar at the top. The map's own tents and boats of those models are never placed as scenery - `mission.reserved`,
`level.mapTargets` - because a tent that looks like a target and takes no damage reads as a bug; objectives take
them over with `{type, map: true}`), `boss` (one or several). The marker and
`Mission.goalPos` follow the nearest target / boss.

## Missions

`missions.js`: a mission is `{id, title, blurb, map, zones, mission}` plus optional overrides of `look`, `nav`,
`swarm`, `allies`. `useMission(id)` copies it into `CFG` before anything is loaded, so every other file keeps
reading `CFG.map`, `CFG.zones`, `CFG.mission`. The Holy City mission is what `config.js` holds; `mission_assault.js`
is the second one. The page asks for the mission first (`Hud.missions`; a mission whose map file the installation
does not have is greyed out), `?mission=<id>` skips the question (restart keeps it; tests without it get the Holy
City).

What a map may need beyond the first one, all in the mission's own config:
* `mission.gfx` - classes shown with another model (`seas_carrier_fake` -> `seas_carrier`: a fan map's own classes).
* `zones.rubble` models are loaded even when the map has none of them (an intact city has no barricades).
* `zones.rubbleMax` - a border across open country is only the wall: no rubble in gaps wider than this.
* `mission.garrison` - `[{type, map: true}]`: every map object of a reserved model stands as a structure from the
  first moment (`Mission.garrison`): the towers, the boats in the harbour, the fountain. A destroy objective picks
  its targets among them with `{type, zone}` or `{type, near, within}`, never one in a district that is still shut.
* `objective.troops` / `rally` - a group of allies arriving at a place when the objective starts; `objective.allies`
  - how many troops this objective keeps up.

"Holy City defender" is the Holy City of campaign mission 5 moved by (-32, +368) and repaired (2148 of the old
map's 2235 scenery objects have a twin at that offset; what is missing are the barricades and the ruins), so the
city's districts are the first mission's cut lines shifted (`S()` in `mission_assault.js`) plus one street the ruins
used to block. The country outside is three zones divided by two straight lines across the whole map.

## The player's side (allies.js)

Only where `CFG.allies.count > 0`. An `Ally` is a model instance with one `AnimCtl`, like an enemy, and has the same
shape as the player where the enemies need one: `pos`, `vel`, `def {radius, height}`, `dead`, `hurt()`, `shove()`.

* **Where they go**: each has his own offset (`spread`) from the front point = the player's position + `lead`
  towards `Mission.goalPos`. Further than `slack` from it he runs there - straight when near and nothing is in the
  way, otherwise along the swarm's flow field (which leads to the player). So they need no path finding of their own.
* **Who they shoot**: the nearest enemy within the weapon's range with a free line (looked for ~2.5 times a second;
  living things before structures). Bullets are hit-scan with an `accuracy` chance, rockets are the player's
  projectile kind with their own enemies-only explosion (`Allies.blast`), flames a cone. Their damage carries
  `info.ally`, which keeps damage numbers, hit markers and the "own kills" counter for the player's own hits.
* **Who hunts them**: `Enemy.pickTarget` - twice a second an enemy takes the nearest ally within 26 u when that one
  is clearly nearer than the player; it goes for him only while it can run straight at him, otherwise back to the
  player along the flow field. The seven attack slots only limit attacks on the player. Projectiles of the enemies
  test `Allies.rayHit` too; fire bottles burn every ally in their splash.
* **Reinforcements** (`Allies.reinforce`): every `every` seconds up to `group` to fill up to `count`, at a place
  40-105 u of walking from the player that lies further from the objective than he is (so they come from behind),
  in an open zone, out of sight if possible.
* **Balance** (`tests/allies.js`: the player stands still, immortal, at "Hold the crossroads"): in 60 s the troops
  kill about 140 while 4 enemies a second arrive, lose 30 of 39, and the swarm grows to its limit - they slow the
  enemy down, they do not stop him.
* No friendly fire either way by construction: the player's weapons only ever query `G.enemies`, the enemies'
  attacks only the player and the allies.

## Turrets, catapults and their crews (addons)

`addAddon()` in `actors.js`: a model built onto another one at a link, with its own `AnimCtl` and a crew sitting on
the addon's own links - what the game's composites call a turret / build-up with `pi` riders. Used by the Black
Widow (`seas_wehrspinne` + `seas_wehrspinne_top` on `link_we`, driver `seas_rider_b` on the turret's `link_Dri1`)
and by the Ankylosaurus catapult (`ankylosaurus` + `aje_ankylosaurus_catapult` on `link_con`, crew `aje_rider_a` who
plays `aje_attack_ankylo` when it fires). `fire()` plays the addon's and the crew's clips; the shot leaves from
the addon's `link_Proj` / `link_unnamed`.

* **Black Widows** are a "special" ally type (`CFG.allies.special`): not in the mix until an objective names them
  (`arrive: 'widow'`), then `first` at once at the objective's `rally`, `perWave` with every later group, `max`
  alive. `prefers: 'structure'` puts towers first among their targets, `lead: 48` sends them well ahead of the
  player towards the objective, `vsStructure` multiplies their shell against structures.
* **Ankylosaurus catapults** are ordinary ranged enemies whose shot is a stone with splash (`ranged.stone`); four
  stand at the tower line as the objective's `guards`, more come with the waves (mix weight 0.2).

## What the models show (part flags)

The converted models keep the game's part flags (`pw/engine/parts.js`); the shooter uses them the way the game does:
* **Damage stages of buildings**: `Enemy.setLook()` -> `applyState(model, 4, stage, 1)` with stage 1 below 2/3 and
  2 below 1/3 of the health (tents, towers, gates, the fountain).
* **Ridden animals**: `applyMask(model, animalMask({owned, armor, hp}))` - saddle and harness for everything that
  carries a rider or has `owned: true` (the default look of a model is the wild animal), armour with `armor: true`,
  and the wound parts as the health drops.
* **Wall pieces** (`level.js`): a wall model is a post with eight arms. (Kind `Wall` in the data - but the Norse
  stone walls `hu_re_enforced_wall` / `hu_small_wall` are `Bldg` and built the same way: `isWallPiece`. Parts of
  such a model without any state flag are dropped: the palisade has two, lying flat beside every post.) Pieces on the 8 u wall grid get their own
  copy with `userData.armMask` from the neighbouring wall / tower / gate tiles (no arm across an L corner, none
  into a gate that stands on the grid); only the shown arms go into the collision. Rules: `claude/spec_walls.md`.
  * **The four "variants" of an arm are slopes, not looks.** Wall pieces stand at heights in 2 m steps (the `y`
    stored in the map) and never level the ground; every arm exists level (twice), 2 m lower and 2 m higher at its
    outer end (clay wall walkway: 4..4.8, 2..4.9, 4..6.9). `tagWallArms` (assets.js) sorts them into
    `userData.slope` -1 / 0 / 1, `applyState` shows the one in `root.userData.slope[arm]`. `level.js` sets it from
    the neighbour's height: 2 m apart the lower piece's arm rises, 4 m apart both meet in the middle. Picked at
    random (as before, and as the remake still does) every second joint had a step in it - "not connected at all".
  * A piece **under a tower keeps its arms** (the remake draws only the post: once the tower is shot down that is a
    post with a hole on both sides).
  * An **editor gate** (off the grid, on a tile corner between two pieces three tiles apart) that stands across a
    corner ends 5 m short of the posts: those get an arm towards it.

## Gates of the Dustriders' walls

`bonegate`: a structure with `wall: {half, thick}` - a line across the way instead of a circle
(`Enemies.pushFrom`), for the player, his troops and the enemies alike. It is not in the level's collision and not
masked in the nav grid, so paths lead through it: the Dustriders climb over (`Enemies.hopCells` marks the cells
under living gates, `Enemy.step` vaults there as over rubble). `locked` (set by the garrison entry) makes a
structure take no damage until an objective names its type as a target.

## Stomp, catapults on animals

`attack.stomp = {clip, time, hitAt, radius, damage, knock, chance}`: instead of the normal attack, always when three
or more of the player's side are within the radius - everybody around the feet is hit and thrown back
(Brachiosaurus `stomp`, T-Rex `attack_2`). `maxAlive` on an enemy type limits how many the waves may have at once.

## How the big ones attack

A bite that only reaches whoever stands still is no attack: at walking pace along the wide paths an Allosaurus never
caught a player who simply backed off. So (`enemies.js`, values in `config.js`):

* `charge` (speed): they run when the prey is more than 7 u out of reach; `direct` (straight at the target instead of
  the flow field) up to 48 u when nothing is in the way - the wide paths do not lead everywhere.
* `attack.start` / `attack.lunge`: the strike begins that far outside the reach and they close at lunge speed until
  the blow lands. Walking away does not save you, sprinting, the dash or the jetpack do.
* `attack.arc` (degrees): a sweep - everyone of the player's side in front of the jaws (behind, for the tail:
  `back`) is hit. `attack.turn`: how fast it can follow its target while striking.
* They need no attack slot, and the `elite` go for the player himself when he is within 45 u.
* `allies.vsBig` (0.35): what the rifles and flames of the SEAS line do to them (rockets and the Exo's fists: all).
  Twenty rifles had an Allosaurus down in ten seconds, before it had bitten anyone.
* `waves.heavy = {type: share of a wave}`: the big ones join the waves on a count (0.12 = one every eighth wave, the
  first with the third), never more than `maxAlive`, and from where the mission is heading - as 0.12 of 21 in the
  mix not one Brachiosaurus came in a whole fight, and one that came from behind died among the arriving troops.

## Structures that live

`turtle` (the transport turtle: `macrolemys_water` + the `aje_transport_turtle` shell on `link_con`, `owned`) plays
its idle clip and dies with `sink`; `catamaran` has a crew and `ranged` with a `clip`. Buildings that go up after an
objective (`objective.built`, `Mission.build`, `Level.place`): added to the collision afterwards
(`CollisionWorld.begin()` / `append()`), masked in the nav grid, rising out of the ground.

## Towers

A structure with `ranged` shoots (`Enemy.step`, structure branch): arrows from its `link_Proj` at the nearest of
the player's side in range and sight - but not from a district that is still shut. Structures with `solid` push
everybody on foot out of their footprint (`Enemies.solids`). They do not count against `swarm.max`
(`Enemies.fighting`).

## Gun towers of the base

`objective.built: {model: 'seas_turret_tower', addon: ['seas_turret', 'we'], gun: 'turret'}` - a building put up by
the mission whose turret is manned (`Mission._guns`, values in `CFG.allies.guns`): every 0.4 s it looks for the
nearest Dustrider in range and in sight (the ray starts `forward` outside the tower's own walls), turns the turret
on it (`turn` rad/s), and fires a `seas_turret_bullet` that bursts like the troops' rockets (`Allies.blast`: no harm
to the player's side, counts as the troops' kill). They cannot be destroyed.

The turret hangs on the tower's `link_we`, and **a link keeps the game's axes: z is up, y is not** (the model's own
root correction is taken off when it is put on a link). So it turns about its local z; about y it rolled over
sideways. `guns.turret.barrel` names the bone at the muzzle end, from which the direction the gun points is taken.

## Bombardment

`classes.gunner.ultimate`, key G, `Player.ultimate()` / `_bombing()` / `_bomb()`: for `time` seconds every `every`
seconds a bomb (the rocket model, falling from 75 u up in 0.6 s as a projectile of owner `'sky'`, which only the
level stops) on a point within `radius` of the Gunner - `aimed` of them on a random enemy in that circle. Each one
is an explosion that only asks `G.enemies.inRadius`. The cooldown runs for the Gunner even while the Executioner is
out. `tests/ultimate.js` measures it.

## Before the first frame (engine.warm)

Left alone, three.js uploads every texture and builds every shader in the first frame. On "Holy City defender" that
one frame took 16.5 s on an RTX 3090, the browser's watchdog took the graphics driver for hung and threw the WebGL
context away: a white picture with the HUD on it (the session log said `worst frame 16569 ms`, `GPU !! WebGL context
LOST`). Two things were behind it:
* every model file brings its own texture objects, so a sheet that 40 models share was uploaded 40 times (~600
  textures instead of ~150). `THREE.Cache.enabled` makes the loader return one image per file, and `warm()` gives
  all textures of one image the same `source`, which three.js turns into one texture on the card;
* `warm()` then uploads the textures a few at a time (`renderer.initTexture`, yielding to the browser in between),
  builds the shaders with `renderer.compileAsync` and draws one frame - all while the loading screen is up. The log
  line `WARM` has the numbers.
If the context is lost all the same, the page says so and offers to start again (`main.js`).

## Checkpoints

An objective with `checkpoint: true` (or `{at: [x, z]}`). `Mission.next()` stores `{mission, index}` in
`localStorage` when it starts; the end screen after a defeat, the pause screen and the start screen offer it, which
reloads the page with `?from=<index>`. `Mission.resume(from)` then opens the zones the earlier objectives had
opened (no effects), removes the garrison structures the earlier destroy objectives would have picked, and starts
at that objective; the player is put where the objective before it was (`Mission.place`), both characters fresh,
and a double group of troops arrives. Nothing else is saved - no health, no kills. A new start from the beginning
and the end of the mission clear it. `tests/checkpoint.js` (`?from=N`, any objective in test mode).

## The log

`web/src/game/log.js` + `server.py` (`Logs`): the page posts lines to `/api/log?sid=<session>` every 2 s (errors at
once, the last ones with `sendBeacon` on `pagehide`), the server appends them to
`<toolkit home>/shooter/logs/shooter-<time>-<sid>.log` immediately. Kinds: START, GPU, SETTING, LOADED, BEGIN, OBJECT,
BOSS, DOWN, PAUSE, END, BEAT (every 5 s while playing), ERROR / REJECTED / CONSOLE (with the game state), PAGE,
PAGE CLOSED, SERVER (the server's own notes: watchdog after 30 s of silence, its own exceptions).
New things worth logging: `G.log.add('KIND', text)`.

## Mounted bosses

`CFG.enemies.*.riders` = [model, link]: people on the animal's `link_Ride` / `Rid2` / `Rid3`, each with its own
AnimCtl (`ride_idle_0`, `ride_attack_front` when the animal attacks); the banner hangs on `link_flag` like a held
thing. This is what the game's `aje_allosaurus` composite is (rider `aje_rider_b` + `aje_animal_flag_0x`).

## Animation note

Walk clips of the game are start + cycle + stop in one clip; the cycle alone is `<name>#l`. `BodyAnim.legs` plays
that part (the whole clip looped drops into the standing pose once per cycle - `tests/loop.js`).


three.js' mixer writes a bone only when its animated value changed. Anything added to a bone after the mixer
(the aim twist in `BodyAnim.update`) must therefore be taken out again before the next mixer update, or it piles
up on still poses - that was the "spinning torso" bug.
* `bot.js` - stands and shoots the nearest enemy
* `shots.mjs` - a list of scripted situations, one screenshot each

URL switches: `?test` (no mouse capture needed), `&autostart`, `&class=executioner`, `&quality=low|medium|high`,
`&difficulty=easy|normal|hard`.

## Maps of the game's own making (mapgen.js, maps/)

A mission whose `map` is `gen:<name>` has no map file: `level.js` imports `maps/<name>.js` and calls `build()`, which
returns the same thing the map reader does (heights on the 2 m grid, a material per 4 m tile, water level, objects).
`MapGen` makes it from a description of the walkable country:

* `disc(x, z, r, h)` and `path([[x, z, h, r] ...])` are the **floors**. Everything else is mountain: at a distance
  `d` outside a floor the ground has risen by `(d / f) ^ p` of the way up to the mountains (`f` = width of the foot,
  `p` = 2.2: gentle and wooded at first, a wall further out; 1.7 and a narrow foot for a canyon). The mountains
  stand on the level of the floors near them (inverse-distance mean), so a plateau 40 m up has walls like a beach.
* Land ends `coast.reach` beyond the outermost floors; floors marked `sea` carve bays.
* `wall(model, corners, {gate})` puts pieces on the 8 u wall grid at heights in 2 m steps - what `level.js` needs
  to grow their arms. A wall must reach from mountain to mountain: the walkable foot of a wide place is ~30 m
  deeper than its floor (that is where the first wall of the pass could be walked round; it now stands where the
  canyon is narrow).
* `scatter({models, n, where})` for trees and rocks; `keep` circles (roads, squares, buildings) stay free.
* An object's `cls` may differ from its model (`CFG.mission.gfx` maps it): two kinds of gate share one model, the
  garrison tells them apart by `cls`.
* `md.textures`: the 8 ground textures, from any setting (Iron Winter: 5 of Northland, 3 of Icewaste).
* `tests/mapview.mjs` draws a generated map under Node (the module has no imports); `tests/views.mjs` takes several
  pictures of one loaded game.

* `lower(x, z, r, k)`: mountains within `r` reach only the share `k` of their height - the seaward cliffs of the
  fortress cape, so that the gunship looks into the yard. Never where a zone border depends on the height: the
  first try lowered them all round, and the ridge between the fortress and the lake could be walked over.

The player's border on such a map is the mountains, and three rules make it one:

* `physics.maxSlope` (mission) - bare terrain steeper than that cannot be walked up and one slides off it; no jump
  and no jetpack from there.
* `physics.leash` (metres) - `Zones.walkAt()`: never further than that from a cell of the nav grid, and never more
  than 5 m below it. The zones alone do not hold: a mountainside belongs to the zone at its foot, and where a
  plateau ends above a bay there is no mountain at all (the fortress yard's west edge: 56 m straight down to a
  shore nobody comes back from - the test bot found it).
* `nav: { drop: 1.1 }` - the city's nav grid lets walkers jump 6 m down a ledge; on a height field that makes every
  slope above a shore a one-way street, and part of the field. Here nothing is "walkable" that cannot be walked
  back.
* Whoever still hangs on a slope for two seconds without getting anywhere is put back where he last stood on
  ground of the field.

## Another enemy (faction)

A mission may bring its own enemy types (`enemies`, merged into `CFG.enemies`) with `faction: 'hu'`; `Enemies.load`
loads only the faction the mission names. `machine: true` on a type: sparks instead of blood, it blows up when it
dies, and the troops' rifles do little to it (as to the big beasts). `armour: 0.08` on a structure: every blow that
is not a `siege` blow counts for that share - the gate of the pass.

## Rides (rides.js)

`CFG.rides` (from the mission): things the player controls for a stretch. While one is mounted `Player.step /
animate / camera / hurt` are the ride's, and `Player.def` is its measures; everything else (enemies, allies, zones)
keeps looking at `Player.pos`.

* `kind: 'beast'` - goes where it faces, turns `turn` rad/s; tusks (cone), stamp (radius), charge (tramples, and
  rams structures it runs into: `kind: 'siege'`), trumpet (`Enemy.hold`). Walks over what is lower than its belly.
  Dead: the rider is thrown off; `Mission` brings another after 6 s while the objective still asks for it.
* `kind: 'gunship'` - `objective.flight = {speed, out, home, free | loop}`. With `free = {area, ceiling, floor,
  climb, boost}` (Iron Winter) it lifts off along `out` and is then flown by the player (`Gunship._free`): W A S D
  over the ground the way the camera looks, Space / C up and down, the body turns to where one looks and banks. It
  stays inside the polygon `area` (`Zones.fence()` draws the districts' energy wall round it, seen from 120 u),
  above the ground under it and ahead of it (`floor`) and under `ceiling`. `land()` (the targets are gone) builds a
  course home from where it is. With `loop` instead it flies on rails (Catmull-Rom courses sampled by distance,
  `Course`) - the first version; Kacper: "give the player control over the unit and not have it on a railroad".
  Guns fire along the camera's aim (`Player._aim`, `_bullet`). Dead: it spins down and the mission is lost (the
  checkpoint is at its start).
* `objective.ride = id` mounts (where the ride is `park`ed, or `rideAt`); the first objective without it dismounts.
  `mission.parked` puts a ride in the world from the start; `objective.arrives` lets one fly in during a hold.
* The HUD's three panels come from `ride.hud()`.

## Things that hang on other things (bone names)

Riders, flags and build-ups are added under a link of the model that carries them (`Actor.attach`, `addAddon`).
A clip finds its bones by name, searching the whole tree - and men and beasts share bone names (hashes of
"L Thigh" ...). The mammoth's walk therefore moved the legs of the man on its back, which come first in the tree,
and its own hind legs stood still. `actors.js` replaces `THREE.PropertyBinding.findNode`: subtrees marked
`userData.attached` are not searched (their own clips start at their own root and still find them).

## Gates: open or shut

A gate model has its leaves twice: plain meshes standing open (attribute bit 14) and skinned ones shut / swinging
(bits 15, 16; the `open` / `close` clips move those). `parts.js` puts that into the part signature (`hasDoors`,
`staticSig(a, doors)`), `applyState` shows one set - shut unless `root.userData.doorOpen`. Before, both were drawn
on every map. The city gate that is blown open (`Zones.setOpen`) switches to the open leaves.

## Ships that sail, shots on the move, several build-ups

* A structure with `sail: {speed, keep, wake, depth, turn, clip, bow}` (`Enemy.sail`) makes for whoever it shoots
  at until it lies `keep` off, over water at least `depth` deep, round headlands (first free heading of 0, ±0.5,
  ±1, ±1.5 rad). `bow`: the dragon boat's model looks along -z (π).
* `ranged.moving`: the build-up shoots while its carrier walks (steam tank, titan) instead of the carrier stopping.
* `addon` may be a list (the titan's two ballistas, links `con2` / `con3`): they fire in turn. What the game mounts
  on a unit is in `gamedata.json` → `composites` (`hu_steam_tank`, `hu_triceratops` ...).

## Music

`audio.playList(key, tracks)`: shuffled, cross-faded, no track twice in a row, missing files skipped.
`Game.music('fight' | 'boss' | 'ride')` picks the list from `CFG.tracks[CFG.music]`; `Mission.next` asks with every
objective.

## Weather (weather.js)

`CFG.weather.snow = {from, full}`: one cloud of points in a box around the camera, wrapped at the box's edges; how
much of it is drawn goes by the height of the ground under the camera.
