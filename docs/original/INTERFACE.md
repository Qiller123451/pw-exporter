# Interface details

Small findings about the original's interface scripts (`Data/Base/Scripts/Game`) that are not in the other documents.
The key layout and formations: [formations.md](../../remake/docs/spec/formations.md); the minimap:
[MINIMAP.md](../../remake/docs/MINIMAP.md); tooltips: [TOOLTIPS.md](../../remake/docs/TOOLTIPS.md); mission windows
(quest log, news ticker, dialogue box, timers): [MISSION_UI.md](../../remake/docs/MISSION_UI.md); diplomacy, chat,
statistics, point buy, skirmish setup: [ui_groups7_9.md](../../remake/docs/spec/ui_groups7_9.md),
[pointbuy.md](../../remake/docs/spec/pointbuy.md); layout of the HUD: [ARCHITECTURE.md](../../remake/docs/ARCHITECTURE.md)
"Interface".

## The army pyramid: open and closed

* `Keys.srf:35-36`: Tab = `SwitchPyramidForward`, Ctrl+Tab = `SwitchPyramidBackward`; both end in
  `CInGameScreen.TogglePyramidState` (`IngameScreen.usl:1293-1316`), which switches between open (`pyramid_open.tga`,
  177 × 545, sound `ui_pyramid_open`, cards can be dragged) and closed (`pyramid_closed.tga`, an 11 × 545 strip, sound
  `ui_pyramid_close`; the cards are probably hidden). The window is 181 × 548 at (32, screen height − 744). It starts
  open.
* The strip on its left (26 × 540, `IngameScreen.usl:117-216`): a left click calls `OnPyramidOpen`, a right click
  `OnPyramidClose` (both toggle). Right-click zones by height: all (y 0-79), change the sort method (80-140), sort level 2
  (142-235), level 1 (237-351), level 0 (353-543).

## Control group configurations

`Keys.srf:101-102` binds Ctrl+G = `SaveGroupConfig` and G = `LoadGroupConfig`, and `GameInputController.usl:1953-1961`
has procedures of these names (`CGroupMgr.SaveLevelConfig` / `LoadLevelConfig`, which write and read
`Interface/NumberedGroups/<level>`; `GroupMgr.usl:99` / `:46`). But no script registers the two commands: every other
accelerator command is registered with `pxDesktop^.SetCmd("<name>", <proc>)` (`GameInputController.usl:74-100`:
`SetGroup0..9`, `Spectator1..` ...), these two are not. So G and Ctrl+G do nothing in the shipped game.
([formations.md](../../remake/docs/spec/formations.md) §B describes the procedures as if they were reachable.)

## Queued group walks

When a group walks a queue of waypoints, the first member that reaches a waypoint pulls every member whose next task is
a `Walk2Pos` on to the same point (`FightingObj.usl:2033-2044`, `misc.usl:187-199`, `FightingObj.usl:8731-8746`). No
member waits for the others.

## Placing a building

While a building is placed, the client draws a grid of dots (`ObjPlaceChecker.EnableGridRendering`) around it, green
where the building fits and red where it does not. A building put down by a player levels and paints the ground with
its object brush and removes the plants and trees within its radius
([TERRAIN_NOTES.md](../../remake/docs/TERRAIN_NOTES.md) "Object brushes").
