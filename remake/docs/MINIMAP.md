# The minimap

How the original draws its minimap, and how the remake does it (`src/ui/minimap.js`). The original's minimap is a
native class of the game's engine (`CMiniMap` in `bin/PWClient.exe`); the scripts (`Scripts/Game/UI/MiniMap2.usl`,
`IngameScreen.usl`, `OptionsMenu.usl`, `controller/GameCameraModule.usl`, `Server/misc/FeedbackEventMgr.usl`) only
set it up, so most of what follows was read from the engine's machine code. Marked "?" where that is inferred.

## Window and area

* The minimap window is `hud/minimap_background.tga` (270 x 270) in the **bottom right corner** of the screen
  (`IngameScreen.usl:260`); the info window is at the bottom left, the tooltip window directly above the minimap.
* The map control is 230 x 230 px at (30, 32) in the window. It shows a 256 x 256 texture: the background picture
  `hud/minimap_rotmap.tga` (gold ring, square frame, a dark grid) and, in its square 46 .. 210, the map.
* The map is the **playable area only**: the terrain minus 128 m on every side, one cell per 4 m (the grid of the
  ground materials). The longer side fills the 164 texels, the shorter one is centred.

## Orientation

* A **diamond**: the texture is turned so that the level's default camera direction (`Base/DefaultCamera` of the map,
  the game's default 0.785) points up, snapped to the nearest diagonal. In remake terms the angle is the camera's yaw
  snapped to the nearest odd multiple of 45 degrees.
* Option **"Rotate Minimap"** (off by default): it follows the camera continuously, the view direction always up.
* The remake's skirmish camera now starts at the map's `DefaultCamera` too (0.785 for the random map), as the
  campaign's always did, so the camera and the diamond agree.
* Zoom: two buttons, 1 .. 7 (`MiniMap2.usl:185-195`); the remake zooms about the camera's point.

## Ground

Not a picture of the painted ground. Each setting has a colour table, `Texture/Scape/<Setting>/minimap_colors.tga`
(21 x 6, kept by the engine as ARGB4444: 4 bits a channel). The pipeline step "terrain" writes it into
`assets/terrain/<Setting>/setting.json` ("minimap").

| row | use |
|---|---|
| 0 | ground, water, forest, resources, items - visible |
| 1 / 2 | buildings / units: relation colours (columns 0-3) and the player colours (columns 12 + colour slot) |
| 3 | row 0 for explored but not visible cells (half transparent) |
| 4 / 5 | rows 1 / 2 dimmed |

* Relief: `s = ((h north - h south) + (h west - h east)) / 2` from the neighbouring cells; column 0 below -3, 1 below
  -0.1, 3 above 0.1, 4 above 3, else 2. The light comes from the north-west.
* Water: within 0.5 m below the water level column 10 (shallow), deeper column 11.
* Forest: column 12 over the ground on cells with a tree within 4 m (the remake: the standing trees).
* Fog of war: unexplored cells are left out (the background's dark grid shows), explored ones use row 3, visible ones
  row 0.

## Dots

* Square texels, turned with the map. Sizes (the engine's): units 1, buildings 1.2, resources 1.5, stones 2.5,
  game-mode objects 2.5, items 1.
  The remake draws them bigger (the user found them hard to see): units 3 texels, buildings at least 4 or their
  footprint (up to 12), both with a dark rim; resources 3, stones 5.
* Units and buildings with an owner only: **wild animals are not drawn**. Buildings are the owner's colour lightened
  (`c * 150/256 + white * 106/256`), units the plain colour. Option **"Use Player Colors"** (on by default): the
  player colours of the table by colour slot (yellow ffcc00, red ff0000, cyan 00cca9, blue 0055ff, green 00dd00,
  purple 9b00d2, pink e4008c, orange ff6600); off: own green (selected bright green), allies blue, everyone else red.
  A remake player without a party colour keeps its interface colour.
* Buildings seen once and now in the fog stay as dimmed dots; units only while visible.
* Resources (stone, fruit, carcasses, fish, felled trees, nests) are half transparent white dots.

## Camera and markers

* The camera's ground footprint: white lines, turned with the map.
* Markers (`MiniMap2.usl:205-269`): `Attack` red, size 80, 3.2 s at 1.3 pulses a second - the hits on the player's
  objects within 0.15 s gathered into one marker at their middle, on every attack (`FeedbackEventMgr.usl:72-103`);
  `Finished` blue (100, 100, 255) when production or research is done and when a building-jump key selects one;
  the player's own map pings. The warning message and sound stay limited to one every 10 s
  (`Player.usl WARN_UNDER_ATTACK_TIME`). The marker pictures (`minimap_ping*.tga`) are not in the game's files: the
  remake draws a pulsing square. The campaign's quest markers keep their own look (MISSION_UI.md).

## Buttons and mouse

| button | place in the window | does |
|---|---|---|
| landscape | 8, 225 | ground on / off (forest and dots stay) |
| resources | 38, 225 | resources and forest on / off |
| map ping | 226, 49 | the next left click on the minimap or the ground pings that point |
| zoom + / - | 219, 219 / 219, 240 | zoom 1 .. 7 |

The art is `hud/minimap_buttons.tga`, the tooltips the help items `mm_show_landscape` ... Left button: the camera
jumps there (dragging keeps moving it), also while an order waits for its target. Right button, on release: the
order of a right-click on bare ground - walk or sail, a building's rally point, Shift queues - never gathering.

## Not drawn (as in the original)

Rally points, heroes as symbols, question marks, single trees, wild animals.
