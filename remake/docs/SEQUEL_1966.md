# ParaWorld: Containment - the second chapter, "1966" (missions 12-16)

Five missions after Containment (`src/game/sequel/missions_1966.js`, added to `MISSIONS` after mission 11, so the
numbering of 1-11 and the saved settings stay as they are; the menu shows a "1966" heading over mission 12).

A year after the rifts were closed, Crane is back. He wrecks the train that carries his old menagerie to the federal
pens, tries to take the parts of Taslov's Door, opens rifts of his own with copied Gate machines at Lake Mead, sets
up a camp in Tala's home valley on the other side, and at last tries to take the Door itself on the day it opens to
the world.

| # | Title | Place, date | Play |
|---|---|---|---|
| 12 | Main Street | Pueblo, Colorado, April 1966 | **no base, nothing to build**: Halloran, Booker and Tala (level 3) clear a town district by district - the freight depot, Old Town, Main Street, the grain elevator. Each cleared district's holdouts come out and join: Capt. Ruiz's Guard squad (4 troopers and a medic), Deputy Alvarez's 3 marksmen, Cpl. Kowalski's walker and 2 jeeps, and two tame triceratops in a stock car that only Booker can calm (anybody else gets near, nothing happens; Booker walks up, they join). Clearing a district heals everybody. Packs from the stockyards hunt the heroes every 2-3 minutes; with all four districts clear, Old Scar (a one-eyed Atroxosaurus boss) and her pack wait in the stockyards. Townsfolk to the buses as a secondary. Powers: recon and artillery only |
| 13 | The Long Haul | Raton Pass, New Mexico, May 1966 (night, dawn on the last leg) | **convoy escort**: five Convoy Trucks drive the road over the pass by themselves - three long switchbacks between ridges - and stop when creatures or Crane's men are within 30 m of a truck, a tower of his within 50 m, or no escort is within 45 m. Ambushes by how far the front truck has come: raptors off the ridge, a pack at the bend, Crane's roadblock (two towers and a post) on the second leg, cats at the tail, walkers from behind and a Carnotaurus ahead, rocket teams on the last ridge, raptors by the depot. 3 of 5 trucks must arrive (4 on hard). No base; airdrop, recon, artillery |
| 14 | Power Play | Lake Mead, Nevada, June 1966 | **base against base** (Crane: the Turtle computer player): three Rift Engines hold rifts open that send their waves at the player's base. A smashed engine closes its rift - and Crane's engineers raise it again two minutes later while his generating station by the lake stands, unless a SEAS unit holds the site (within 40 m). The station's fall silences all of them at once. Then his headquarters |
| 15 | The Other Side | The Valley of Smoke, ParaWorld, July 1966 | through the Door into Tala's valley: keep the Dustriders' village (its great beast) alive while Crane's men march out of his engine every 2-3 minutes (from minute 4); open his three cages (guarded, a tower each: a SEAS unit at the cage with none of Crane's men within 24 m) - the freed riders, 3 warriors and 2 archers at level 3 each, **join the player**; break the engine, burn the camp. The King of Teeth (a Tarbosaurus) comes for the weakest at minute 10 |
| 16 | Open Door | Copper Basin, Nevada, August 1966 | the finale: keep the Door (Taslov's Gate machine) standing. Four caravans of Dustriders come through it and walk to their camp with the first SEAS unit that reaches them (6/8/10 must arrive: secondary). At 2:30 Crane's three Relay Masts on the mesas hijack the Door - it spits creatures; columns of his men at 4 and 11 minutes; at 8 minutes the Behemoth (a giant spider walker) walks in from the south, **unhurtable while any mast stands**. All masts down: the Door is Taslov's again and the Behemoth's shield drops. Broken, Crane climbs out of the wreck and runs for the Door - a hero (Halloran, Booker or Tala) who reaches him arrests him (if he gets through, the mission is lost; if he is killed, it is won all the same) |

## New things in the rules and the runtime

* Classes (`rules.js`, texts in `texts.js`): `sq_old_scar` (Atroxosaurus, hit points x4.2, a boss), `sq_cargo_truck`
  (the convoy's truck: the Army truck model, slow, unarmed, `build: false`), `sq_rift_engine` (Crane's Gate copy),
  `sq_relay_mast` (the radar model), `sq_behemoth` (spider walker, hit points x7, a boss).
* Cast (`cast.js`): Capt. Ruiz (`guard`), Deputy Alvarez (`deputy`), Cpl. Kowalski (`driver`).
* `def.civName`: what the notice calls a civilian who was killed ("A Dustrider" in 16; default "A townsperson").
* Crane's people under `crane: {ai: false}` (13, 15, 16) are sent with `M.send` - the outbreak's `target` drives only
  the outbreak's creatures.
* Helpers of the chapter's script: `guards` (creatures that keep to a place: `sqHome`), `post` (Crane's men at a
  place), `heal` (the medics after a district), `scaleTick` (bosses drawn bigger), `more` (one more on hard, one less
  on easy).
* `?stubart=1` (main.js `tpl`): a model the assets lack stands in as another one - for testing the sequel on an
  install without its art.

## Tests

`tests/sequel_flow.js` plays every mission 1-16 through by script (the player's side cannot be hurt; fights won by
killing what stands in the way; heroes and townsfolk put where the story needs them) and checks each step of the
story and the win: `env PWR_PORT=<MIRAGE server> python3 tests/evaljs.py tests/sequel_flow.js "&sequel=N"`
(in `regress.sh`).

Balance was checked by simulated play without the script's help: in 12 the three heroes attack-moving as one blob
clear it on easy, on normal lose some of the joiners and need the artillery for Old Scar, and on hard lose Halloran
on Main Street (a real player pulls her back); in 13 an escort split between the front and the tail brings 4-5
trucks through in about 8 minutes on normal and easy; left alone, 15's village falls around minute 10.
