# Scenarios

Five standalone missions in ParaWorld's own world, apart from both the original campaign and Containment. Each is
played as **any of the four tribes** - Norsemen, Dustriders, Dragon Clan or SEAS - chosen in the menu ("Scenarios" on
the title screen: the list, the briefing, the tribe, the difficulty; a tick marks the scenarios won, the briefing which
tribes won it). The enemies are always of the other tribes. They run with the game's normal rules and the data in use
(the base game's or MIRAGE's).

| # | Title | Setting | Play |
|---|---|---|---|
| 1 | The Great Hunt | Savanna, the Valley of Bones | **a race**: five legendary beasts keep to their lairs - Old Tusk (a mammoth with woolly rhinos), Threehorn (near your camp), Whitefang and his sabre-tooth pack (near the rivals'), Skyneck the brachiosaurus in the middle, the King of Teeth (a Tarbosaurus with raptors). The first tribe to bring down three wins; the blow that kills a beast decides whose it is. A rival tribe (a computer player, Schnecke) builds up on the far side and sends hunting parties at the beast nearest to it every 2:40-4:00, bigger each time. Each beast of yours gives 250 of every resource |
| 2 | The Last Pass | Northland, the Barrow Pass | **survival**: ten waves of the dead out of two barrows, through the only pass in the mountains (a countdown to each wave on the screen); undead warriors, then archers, then brutes, grave-cats with waves 3 and 7, a dead mammoth with wave 5, night falls before wave 8, the Barrow King (8x hit points) leads wave 10. Build between the waves |
| 3 | Fire Mountain | Ash Valley (the volcanic setting) | **king of the hill** against two tribes: whoever stands alone on the volcano's crown gains time (workers do not count; two sides there: contested); the first to 5:00 in all wins. The rivals (computer players) send most of their army up every 1:35-2:30. The mountain erupts every 40-65 s: the spots are marked red on the map 4 s before rocks of fire hit everybody there; every fourth eruption hits the crown itself |
| 4 | Two Banners | Northland, the Riverlands | **a choice**: two tribes at war across a river send envoys to your village (neutral to you until then). Walk your hero up to the envoy you will side with: that tribe becomes your ally, the other your enemy - destroy its main building (keeping your ally's standing is a bonus objective). Say nothing within the time limit (4:00 / 3:00 / 2:00) and both turn on you: destroy both |
| 5 | The Forge of Giants | Icewaste, the Frozen Reach | **a countdown**: a warlord (a Turtle computer player in a fortress with six towers) builds a Titan, fed by three guarded forges. The Titan walks after 15:00 (12:00 on hard); each forge destroyed sets it back 3:00 and leaves it weaker (hit points x3 plus x2 per forge still burning). Win by destroying the fortress - and the Titan, once it walks |

The player starts with the tribe's main building (the Dustriders: the resource collector), 6-8 workers, the tribe's
hero (Bela; Tarna with MIRAGE, else Cole; Miyagi with MIRAGE, else the Hermit; Ada Lovelace) and a few fighters, in
the second epoch. The hero speaks on the radio. A scenario is lost when the main building is gone and no worker is
left.

## How they are made

* `src/game/scenarios/missions.js` - the five scenarios: texts plus `make(tribe, difficulty)`, which gives the rest of
  the mission definition for the tribe played (map recipe, start, enemies, the classes the script uses). `KIT`: what
  each tribe fields (main building, worker, heroes, warrior / archer / spearman / beast / tower / temple / titan) -
  class lists, of which the first the data has *and* whose model the assets have is taken (`M.cls`). Helpers:
  `camp` (the player's start), `settle` (a computer player's settlement), `beast` / `guards` (creatures that keep to
  a place), `strike` (the volcano's rocks).
* They run on the sequel's mission runtime (`src/game/sequel/runtime.js`, `kind 'scenario'`, `M.tribe`): the same
  handlers, objectives, radio, markers and saved games. Additions to it: the roles `foe`, `foe2` and `ally`
  ({tribe, name, color, behaviour or ai: false, relation, res}); `def.looks` renames the standing roles (the dead are
  "The Dead"); `M.home(player)` (the main building or the collector); a mission's countdown in `state.clock` /
  `state.clockLabel`; class lists in `M.spawn` / `M.building` / the start. The computer players' behaviours: Giraffe,
  Dodo, Schnecke and Turtle play, Mikrobe only sleeps; a computer player that starts with an army sends it off at once
  (a "pyramid" attack), so the scenarios' rivals start with towers and workers only.
* The map recipes (`src/game/sequel/maps.js`) got the Ash Valley setting.
* `main.js`: `?scenario=N&tribe=Hu|Aje|Ninigi|SEAS&difficulty=D`, the end screen's Continue (the next scenario with the
  same tribe), save titles; `ui/menu.js scenarios()`; `ui/sequel_ui.js` (the briefing's header, no electricity or
  command powers in a scenario).

## Tests

`tests/scenario_flow.js` plays a scenario through by script as the given tribe (and scenario 4 both ways:
`&path=silence`), checking the start and every step of the story: in `regress.sh` with every scenario as every tribe.
