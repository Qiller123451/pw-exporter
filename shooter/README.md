# ParaWorld Shooter

A third-person action game made with the models, maps, animations and sounds of your own ParaWorld installation:
you fight through the Holy City (campaign mission 5) against swarms of Dustriders, as the SEAS **Gunner** or the
**Executioner MKII**, and can swap between the two at any time.

![The Gunner at the city gate](../docs/screenshots/20_shooter.png)

Nothing of the game is stored here. The shooter uses the game data the ParaWorld Toolkit prepares for the remake
(converted models, textures, ground textures) and reads maps and sounds straight from the game folder.

## Start

1. Start the ParaWorld Toolkit once, choose the game folder and press **Prepare the game data** in the Remake card
   (only needed the first time, or after the toolkit asks for it again).
2. Double-click **Start ParaWorld Shooter.bat** in the toolkit folder (or run `python -m shooter`).
   The game opens in the browser at http://127.0.0.1:8430/ - use Chrome or Edge.
3. Pick who goes in first and play. Close the black window to stop the game's server.

`python -m shooter --help` lists the options (`--port`, `--game <ParaWorld folder>`, `--data <prepared data>`,
`--no-browser`).

## The mission

The whole city is the battlefield, one district after the other: the Dustrider camp before the walls, the gate
square, the harbour, the lower city, the western terrace, the triumphal arch, the eastern quarter, the fountain
plaza and the temple forecourt. Seventeen objectives lead through them: burn the war camp, sink the canoes at the
pier, topple the skull totems, hold the terrace for a minute, hunt down the Allosaurus riders, burn the chieftains'
tents, and at the end the T-Rex titan.

A district that is not open yet is shut off: rubble lies across its streets and a faint energy wall shows where
the border is (it also stops a jetpack jump). When the objective that opens it starts, the rubble is blown away.
The Dustriders are not held back - they come over the barricades.

When the Executioner is destroyed the suit folds down and then blows up: huge damage to every enemy around it,
none to the Gunner who takes over.

A swarm cannot kill you in an instant (`protect` in `config.js`): only so much damage gets through per second
however many strike, one hit never breaks more than one armour segment and never goes through the armour, a broken
armour gives a moment of immunity, and a blow that would kill you from above a quarter of your health leaves you
at 1 with a second to get away ("last stand").

| | |
|---|---|
| ![Flamethrower](../docs/screenshots/21_shooter_flamethrower.png) | ![Executioner MKII: claws](../docs/screenshots/22_shooter_executioner.png) |
| ![The T-Rex titan](../docs/screenshots/23_shooter_boss.png) | ![Rubble and the border wall of a closed district](../docs/screenshots/24_shooter_border.png) |

## Controls

| key | action |
|---|---|
| W A S D, mouse | move, aim |
| left mouse button | Gunner: fire. Executioner: claw combo |
| right mouse button | Gunner: aim down the sights. Executioner: raise the minigun - the left button then fires it |
| 1 2 3, mouse wheel | change weapon (Gunner) |
| Tab | swap Gunner / Executioner MKII |
| Q | jetpack jump (press F in the air: dive into the ground) |
| Space, Shift, Ctrl (or C) | jump, sprint, dash. Nothing hurts you during a dash; the Executioner's lasts a full second (27 units, four times the Gunner's) and rams: every enemy in the way is hit and thrown aside |
| F | knife (Gunner) |
| E | execute a reeling enemy (red "E" ring): restores a segment of armour |
| R | reload |
| V, X | first / third person, camera over the other shoulder |
| Esc | pause, settings |

Every hit shows the damage it did as a number over the enemy (white; yellow for a head shot, orange for fire,
large for a heavy blow; a burst on one enemy adds up to one number). "Damage numbers" in the settings switches them off.

**Gunner** - machine gun, flamethrower, rocket launcher. **Executioner MKII** - claws (three-hit combo, each swing
cleaves everything in front) or minigun (pierces one enemy). Armour (blue) soaks up damage first; it only comes
back slowly on its own, but at once by executing enemies. Health (red) returns after every completed objective,
and a fallen character comes back then. If both fall, the mission is lost.

## How it is built

Plain browser code, no build step: edit a file below `shooter/web/src`, reload the page.

```
shooter/
  server.py            local web server: game code, three.js (the exporter's copy), prepared data, maps, sounds
  web/index.html, style.css
  web/src/main.js      start-up, frame loop, glue
  web/src/game/
    config.js          EVERY number worth tuning: characters, weapons, enemies, the mission, look, difficulty
    level.js           the map as a level: ground, city, water, what is solid
    collision.js       triangle soup + terrain: ground height, walls, rays
    nav.js             where the swarm can walk, and the flow field that leads it to the player
    player.js          movement, jetpack, weapons, claws, executions, damage, camera
    actors.js          model instances, attachment points, legs / upper-body animation
    enemies.js         the swarm's state machines, queries (rays, cones, radius)
    projectiles.js     rockets, spears, arrows
    mission.js         objectives (reach, kill, hold, destroy, boss) and the spawn director
    zones.js           the districts: which is open, the border wall, the rubble in the gaps
    log.js             the session log
    fx.js              particles (the game's own particle textures), tracers, decals, camera shake
    hud.js, input.js, engine.js
  web/src/pw/          files shared with the remake (map reader, terrain shader, model loader, audio) - see pw/README.md
  tests/               headless checks (need Node, Playwright and a Chromium): shot.mjs, shots.mjs, bot.js,
                       route.js, playthrough.js, stuck.js, spin.js, aim.js, loop.js, wall.js, dash.js, blast.js, protect.js, targets.js, claws.js, numbers.js,
                       zones.js + zones_map.py (draws the districts)
  docs/DESIGN.md       how the parts work and why
```

Units: ParaWorld's own ("u"): a soldier is about 4 u tall. See the top of `config.js`.

## If the game crashes or the window closes

Everything the game does is written to a log file while it runs:
`%APPDATA%\ParaWorldToolkit\shooter\logs\shooter-<date>-<time>-<session>.log` (the black server window, the pause
screen and the start screen show the exact path). It holds the start (browser, graphics card, settings), every
objective and boss, every error with the state of the game, and a line of numbers every 5 seconds (position, health,
enemies, frames per second, worst frame, memory). How it ends tells what happened:

* `PAGE CLOSED ... keys held: ...` - the browser closed or reloaded the page in an orderly way (a shortcut such as
  Ctrl+W, the close button, Alt+F4). The dash is on Ctrl, so dashing while running forward is Ctrl+W, the browser's
  "close tab" - a web page cannot switch that off, but the game asks before leaving a running mission: answer
  "Cancel" / "Stay". C dashes too, without that.
* `SERVER !! nothing heard from the game page for 30 s` with no PAGE CLOSED before it - the browser crashed, froze or
  was killed; the last `BEAT` lines show what was going on (memory, frame times, `GPU !! WebGL context LOST`).
* `ERROR` / `CONSOLE` lines - a bug in the game; the text is the place in the code.

After a session that did not close normally the start screen points to its log. `?nolog` in the address switches
the log off. The newest 30 files are kept.
