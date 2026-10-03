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
