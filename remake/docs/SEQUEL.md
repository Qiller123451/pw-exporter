# ParaWorld: Containment - the sequel campaign (design)

A new campaign of eleven missions for the remake, written for it (not converted from the original). The premise: the
original game ends with the fabric between the worlds torn; in this campaign the tear reaches our world. It is
1964, and dinosaurs come through rifts all over North America. The player commands SEAS - in this story the
Strategic Extradimensional Anomaly Service, the government agency that grew out of the remains of Babbit's
society, its machines and its tamed dinosaurs - and has to contain the outbreak.

Everything here is the sequel's own: its rules may differ from the original campaign's (the brief: "what if
ParaWorld got a new game in 2026"). The original campaign and the skirmish keep the original's rules.

It is played with the **MIRAGE** mod's game data (`game/sequel/rules.js SEQUEL_MOD`): MIRAGE's SEAS - its extra units
and buildings, its hero bonuses that cover SEAS, its hero tooltips. The menu switches to the MIRAGE configuration
(building its data the first time) when the campaign starts from another one, and says so when MIRAGE is not
installed; the game refuses other data (`gamedata.json` "mod").

## Cast

* **Colonel Margaret "Peg" Halloran** - SEAS field commander, the player's hero. Steady, dry, ex-Army engineer.
* **Dr. Lev Taslov** - rift physicist, grandson of the inventor Taslov of the first game. Builds the Stabilizers.
* **Sergeant Elijah "Eli" Booker** - handler of the tamed-dinosaur corps; rides a triceratops.
* **Kiko Arakawa** - SEAS helicopter pilot and scout; the voice on the radio.
* **Augustus Crane** - a former SEAS director who believes the rifts are an opportunity: dinosaurs as weapons,
  ParaWorld as a colony. Runs a private army ("Crane Industrial Security").
* **Tala** - a Dustrider war leader whose band was pulled through a rift; first enemy, then ally.

In the game the heroes are copies of the first game's (Halloran of Ada, Taslov of Taslow, Booker of Cole, Tala of
Stina, Crane of Babbit) and keep what those give by level in MIRAGE: aura from level 2, special move from level 3,
chief bonus at level 5 (MIRAGE's cover SEAS: Booker's aura gives SEAS infantry melee damage, Halloran's chief bonus
halves SEAS production times ...).

## Missions

| # | Title | Place, date | Play |
|---|---|---|---|
| 1 | The Copper Basin Rift | Copper Basin, Nevada, June 1964 | find the hiding townsfolk and walk them to the buses; a rift opens by the mine, Taslov arrives, a Stabilizer seals it |
| 2 | Lights Out | Black Canyon Generating Station, night | hold the power station until dawn (12 min) against two rifts; searchlights dazzle |
| 3 | Stampede on Route 66 | Arizona | tranquilize the horned herd and haul it to the pen; no more than six may reach the town |
| 4 | The Bayou | Atchafalaya Basin, Louisiana | three rifts across the water, swimming creatures, a village to evacuate |
| 5 | Countdown at the Cape | Cape Canaveral, Florida | protect Launch Complex 34 for a 15 min count; the rocket lifts off |
| 6 | Big Tooth | Bellingham, Washington | a giant Gigantosaurus: build electrified nets, stun it, put it to sleep, capture it (or kill it) |
| 7 | The Society | London, the Victoria Embankment, Bonfire Night 1964 (night) | the city of the original's opening film: get the townsfolk over the iron bridge, bring Taslov to the tear by the great wheel and seal it, hold the Society while he reads Babbit's archive against Crane's landing from the river; Crane's steamer takes Taslov away |
| 8 | Crane's Ark | Kuskokwim Mountains, Alaska | storm Crane's base, free Taslov from the jail, release the menagerie, destroy the HQ |
| 9 | The Dustriders | Monument Valley, Arizona | find Tala's Aje camp (they ally when met), destroy Crane's hunter base |
| 10 | Through the Rift | ParaWorld | bring Taslov to the temple of the Gate, hold it 3 min, get back to the rift |
| 11 | Containment | Copper Basin again | the Gate machine charges for 20 min; four rifts and Crane's last assaults; epilogue |

"The Society" came in as mission 7 (the user's wish, 2026-10-21: "recreate the buildings of the opening film's city
and make a map of it for the sequel"): the later missions moved up by one. Settings and saved games of the earlier
numbering are moved over (`missions.js SEQUEL_ORDER, renumbered, migrateSettings`; a game's config carries `sqOrder`).

## What each mission brings in

The sequel's own units and buildings come one mission at a time (`missions.js unlocks`); before its mission a class
cannot be built (`lockedBefore`: its build action is left out of the tree). The mission picker and the briefing list
what is new, and a few seconds into the mission the radio says what each new thing does and where it is built
(`texts.js intro`, `Sequel.introduce`) - the Stabilizer when the first rift opens.

| # | New |
|---|---|
| 1 | Containment Trooper, Gun Emplacement, Rift Stabilizer |
| 2 | Power Pole, Diesel Generator, Wind Charger, Searchlight Tower, Shock Trooper (electricity) |
| 3 | Tranquilizer Marksman, Capture Truck, Recon Jeep |
| 4 | Water Wheel, Radar Station |
| 5 | Flak Halftrack |
| 6 | Electrified Net, Tesla Coil |
| 8 | Arc Halftrack |

## Rifts, townsfolk, searchlights

* **Rifts** (`Sequel.rift`, `riftTick`): a wave every `every` seconds while open (at most `cap` of its creatures
  alive); each wave pings the minimap and shakes the rift (the first one is announced). A finished Rift Stabilizer
  within 32 m of the rift's centre (`RIFT_RANGE`; the texts say 30 m) seals it in `sealTime` s (60 by default), the
  rift surging meanwhile - waves twice as fast, sent at the stabilizer. While one is placed, rings on the ground show
  each open rift's reach (green when the ghost is inside); when it is finished the notice says whether it is in
  reach (`stabTick`). Sealing shows as lightning from the stabilizer into the shrinking rift and a bar under the
  objectives; without a stabilizer the progress falls back at half speed.
* **Pace** (the user: "like the original's normal"): the original campaign's defence missions send their first real
  attack minutes after the start (13 The Rush: 10 min, 15: 4-6 min, 3: 8-13 min, 7: 5-7 min after epoch 2), then one
  every 2-6 minutes, growing; difficulty changes how many come, not when. The defence missions 2, 5 and 10 therefore
  open their rifts after about four minutes of build-up (`first` 240-360 s), send a wave every two minutes or so
  (`every` 120-140 s; 75-100 s in the last phase), and start the troopers and marksmen by what they defend
  (`BASE(..., { guard })`): left alone they hold the first wave and fall around minute 10, with the army there and
  the barracks training they last to the end or nearly - the rest is the player's building.
* **Townsfolk** (`civilianTick`, `civStatus`): they hide in the houses until a SEAS unit comes within 14 m, then
  walk to the evacuation zone, fleeing creatures on the way. An objective given with `civ: true` shows how many were
  lost and how many are still out (and not yet found); each death is announced; when too few are left to reach the
  number the objective fails (a primary one loses the mission). After 3 min without anyone found the places of those
  still hiding are marked on the map.
* **Tranquilizers and capture trucks** (`damageHook`, `lethalHook`, `sleep`, `captureTick`; `ui/input.js`
  `sequelClick`): a dart puts the "Tranquilized" debuff on a creature for 30 s; a blow that would kill it then, from
  any weapon, leaves it asleep at 1 hit point for 50 s. A sleeper is left alone: whoever was attacking it stops, a
  right-click on it is no attack order, and no blow reaches it (darts, splash, stray shots). A capture truck within
  9 m of a sleeper loads it (a right-click on the sleeper drives the selected trucks there); at a pen of the mission -
  or, where there is none, at the player's garage or headquarters - the animal becomes the player's. A truck that
  dies drops its load awake. Test: `tests/sequel_capture.js`.
* **Searchlights** (`nightTick`, `viewers`; drawn by `SequelUI.searchlight`): at night a searchlight dazzles the
  creatures within 26 m and lights 36 m for the fog of war; its lamp (its own model, `sq_searchlamp`) turns with a
  beam that reaches down to a lit spot 17 m out sweeping around the tower, and the ground around it glows.

## Power

Electricity is the sequel's fifth resource (only the sequel has it; the original campaign and the skirmish keep
four). It is stockpiled like skulls (no storage limit) and spent on the electric things.

* **Plants** (`game/sequel/power.js` PLANTS): the generating stations of the maps (an abandoned one becomes SEAS'
  when a SEAS unit gets there; mission 2's is SEAS' from the start), diesel generators and water wheels (built on a
  shore) need workers - a worker's job at the plant like a field's (`systems/economy.js`, `farmKind 'power'`),
  credited through `World.hooks.power`; wind chargers turn by themselves.
  Per worker per second: station 1.2 (6 workers), generator 0.5 (2), water wheel 0.8 (2, +0.15 without); wind
  charger 0.35.
* **Lines**: a plant delivers only while a chain of power poles, each at most 40 m from the next, connects it to a
  hub (the headquarters or a field command post). The game draws the wires; a destroyed pole cuts off everything
  behind it, and the outbreak raids the lines now and then. The HUD shows the stock, the rate of the connected
  plants and the plants cut off.
* **Spent on**: Shock Trooper (barracks: every hit stuns for 0.8 s), Arc Halftrack (garage: lightning that jumps to
  two more enemies), Tesla Coil (a tower with jumping lightning), Electrified Nets, Searchlight Towers.
* Missions: mission 2 introduces it (power the base from the Black Canyon station); the generators and wind chargers
  can be built from then on. Test: `tests/sequel_power.js`.

## World

1960s North America: towns of ranch and two-storey houses, diners, gas stations, water towers, telephone poles,
highways, cars, school buses, army camps and trucks, a generating station, a dam, a launch site - and SEAS' own
machines. Dinosaurs, SEAS units and ParaWorld's landscape come from the original game.

London (mission 7) is the city of the original campaign's opening film (`Data/locale/<lang>/Video/hs_1000.bik`: a
bird flies over the city at night, along the river past the great wheel to Babbit's Society, then the meeting in his
office). None of it is in the game's data - the film was rendered from models that were not shipped (the `seq_*`
archives hold only a city wall, gates, watchtowers and the telescope tower) - so the city was modelled anew after the
film's frames (`art/sequel/london.py`):

* terraces of three town houses in five fronts (cream stucco with porticos, Portland stone, London stock brick, red
  brick, grey stone): four storeys, a slate mansard with dormers, chimney stacks, steps over the area railings;
  corner houses with a rounded corner under a dome (the film's);
* the Society, measured on the film (a camera and the proportions fitted together to points marked on the frame at
  33.8 s - the domes' tops, the towers' cornices and corners, the door, the cornice, a dormer's top - and checked on
  the frame at 26.8 s): five bays of sandstone on every side, banded pilasters, pedimented windows below, paired
  round-arched windows above (the great arched window over the door), a pink frieze, a slate mansard with a dormer
  under a curved gable over every bay and a hipped roof above, four slim corner towers standing out from both walls,
  two storeys over the eaves, with pediments, a drum with blind arches and a tall dome; the forecourt wall of brick
  piers and railings with a hedge;
* the great wheel (an A-frame and a rim with 32 lit capsules that turns: a set piece), its landing pier with the
  orange roof, the iron suspension bridge, the embankment wall with river stairs and lamps, stalls, a passenger boat,
  a lighter and a tug.

The film's dusk (mission 7's `dusk`, `Sequel.setNight`): a blue-grey cloudy sky instead of the dark night, more sun
and sky light than a night's, warm floodlights (point lights: `Renderer.floodlights`) on the Society's front and on
the embankment by the wheel and the bridge.

The map (`maps.js`): the river across it with embankment walls (`quay`), paved promenades and tree-lined verges
(`avenue`), London streets (road kind `city`: asphalt, kerbs, flagged pavements; `pave` the promenades), blocks of
terraces round their edges with corner houses (`block`), the bridge on a causeway (`strip`) so units walk over it.
The houses block along their walls: a model's pathfinder boxes come with it (`kit.set_pf`). Where London streets
meet (`junctions`), asphalt patches carry each carriageway through the other's pavements; lamps are not put down on
a street's surface (where a side street meets the one they line).

The exporter's map viewer shows every mission's map (`src/tools/sequel_maps.js`: the same `sequelSource` run in the
viewer, bundled by `build.sh` into `game/sequelmaps.js`; docs/EXPORTER.md "Maps").

## Models

The sequel's models are made in Blender by code (`art/sequel`: `kit.py` the tools, `town.py`, `vehicles.py`,
`works.py` the models, `build.py` the catalogue) from CC0 materials of ambientCG and Poly Haven (`materials.json`,
downloaded by `fetch.py`). Each model is baked into one texture the way ParaWorld's carry theirs, the shading painted
in and lit by the game:

* the materials' colour, with grime near the ground, rain streaks down the walls and slow value variation;
* ambient occlusion, and a short occlusion for dark seams and contact lines;
* the painterly pass (`kit.paint_over`): photo grain smoothed into brushy patches (a Kuwahara filter), light from
  above (upward faces lighter), edges picked out lighter and here and there chipped to rust, blotches of colour;
* warmer, more saturated and contrastier (`kit.grade`); lit signs and lamps also into an emissive texture.

Buildings and vehicles are built 1.3 times life size (ParaWorld's proportions next to its units); the SEAS machines
carry the owner's colour (a second material with the GSF party flag). The built models are kept in the repository
(`art/sequel/built`, about 85 models), so the game data needs neither Blender nor the materials: the pipeline step
"sequel" (`pipeline/sequel_assets.py`) copies them into the data. To change one: `pip install bpy==4.2.0`
(Python 3.11), `python3 -m remake.art.sequel.fetch`, edit, `python3 -m remake.art.sequel.build [names]`, and
`python3 -m remake.art.sequel.preview <built folder> out.png <names>` for a picture.

The machines and buildings have cards of their own (build menu, selection, army pyramid): `icons.py` renders them
from the built models the way the SEAS cards look (front left above, on SEAS' rust-red ground) into
`built/ui/sq_cards.jpg` (`python3 -m remake.art.sequel.build cards`); the step "sequel" adds them to the card atlas.
The units that keep an original model keep its card - the Shock Trooper and the Tranquilizer Marksman with a mark of
their own (a bolt, a dart), drawn by the step from the converted cards. Every class has its own texts
(`src/game/sequel/texts.js`: the tooltip's points and description).

## Implementation

* `src/game/sequel/rules.js` - the sequel's classes (`sq_*`), made from the original's (stats, weapons, scripts) with
  new models and settings; the heroes.
* `src/game/sequel/texts.js` - what the interface says of them.
* `src/game/sequel/maps.js` - the maps are recipes (height features, roads, towns and other places, forests,
  resources) turned into a map source; asphalt roads are meshes over the terrain.
* `src/game/sequel/runtime.js` - `Sequel`: objectives, radio lines, rifts, civilians, capture, night, powers, the
  damage hook for tranquilizers and electric weapons; it is saved with the game (`SAVED`).
  Tranquilizers: a dart puts the "Tranquilized" debuff on a creature for 30 s (`TRANQ_SEC`, every dart starts it
  again; an icon of the info window) and does its normal damage, five times that on a creature held by a net. A blow
  that would kill a tranquilized creature - from any weapon - leaves it asleep at 1 hit point instead
  (`World.hooks.lethal`, `systems/combat.js damage`); asleep it can't be targeted and stays at 1 hit point.
* Taslov (a copy of the original's Taslow, `tesla_s0`) builds like the player's workers: the build menu shows for
  anything that can build, and his class is looked up as `<tribe>_worker` (CommandBar.usl "tesla can build stuff too").
* Workers at a power plant show the power symbol on their pyramid card (the original has no task layer for it).
* `src/game/sequel/power.js` - electricity: plants, pole lines, the grid.
* `src/game/sequel/missions.js` - the eleven missions: map, start, and a script of named handlers (`setup`, `tick`, ...)
  called by the runtime's timers (`M.after(seconds, name)`), so a saved game resumes them. Set pieces
  (`M.piece(id, model, x, z, y, rot, {spin})`, `M.sail(id, path, speed, remove)`; `def.pieces`, `def.props` the
  models to load): models the scene moves that nothing can touch - London's wheel rim, Crane's boats; the handler
  `arrived_<id>` runs when one reaches the end of its path. `crane: {ai: false}`: Crane's people move only by the
  script (no computer player).
* `src/game/sequel/cast.js` - names, colours and portraits (cards of the game's portrait atlas: the heroes' own, SEAS
  soldiers' and other characters' faces); `src/ui/sequel_ui.js` - briefing, objectives, radio,
  powers, timer, effects (rift glow and sealing, searchlight lamps, beams and lit ground, the rocket), minimap markers.
  The objectives and the powers (electricity, command points, the power buttons two a row) sit in the HUD's right
  column under the menu buttons, the radio where the campaign's dialogue box is (bottom left, right of the army
  pyramid; docs/MISSION_UI.md) - the left side is the pyramid's.
* Menu: "Containment (1964)" on the title screen; finishing a mission unlocks the next (`settings.sequel.unlocked`).
  URL: `?sequel=N&difficulty=D`.
* Tests: `tests/sequel.js` (every mission loads and runs, has stone and food by the base, own texts and cards;
  1, 3, 5, 6 play their mechanic), `tests/save_load.py
  "&sequel=3"`.
