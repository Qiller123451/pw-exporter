#!/bin/sh
# The whole regression set (needs the dev server on :8411: python remake/devserver.py --game <ParaWorld folder>, and
# for the sequel one with MIRAGE's data on :8412 (SEQ_PORT): python remake/devserver.py 8412 --game <...> --mod MIRAGE;
# the rules check reads the built data from $PW_REMAKE_DATA, default $T/rbuild). Summary in /tmp/regress.txt, logs in
# $T/regress_*.log
cd "$(dirname "$0")/.."    # the remake folder
T=${PWR_TMP:-/tmp}; R=$T/regress.txt; : > $R
run() { name=$1; shift; "$@" > $T/regress_$name.log 2>&1; rc=$?; ok=$(grep -c '^ok' $T/regress_$name.log); fail=$(grep -c 'FAIL\|PAGEERROR' $T/regress_$name.log); [ $rc -ne 0 ] && [ $fail -eq 0 ] && fail="1 (exit $rc)"; echo "$name ok=$ok fail=$fail" >> $R; }
PW_REMAKE_DATA=${PW_REMAKE_DATA:-$T/rbuild} node tests/rules_check.mjs > $T/regress_rules.log 2>&1; echo "rules exit=$? $(tail -1 $T/regress_rules.log)" >> $R
for pair in "Hu Aje" "Aje Ninigi" "Ninigi SEAS" "SEAS Hu"; do set -- $pair; run scen_$1 python3 tests/scenarios.py "&tribe=$1&enemy=$2"; done
run naval python3 tests/evaljs.py tests/naval.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/multi_2_jun_001.ula"
run carrier python3 tests/evaljs.py tests/carrier.js "&tribe=SEAS&enemy=Hu&map=maps/Base/Multiplayer/multi_2_jun_001.ula"
run nests python3 tests/evaljs.py tests/nests.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/the%20river.ula"
# wild animals (systems/animals.js): babies, hunger, fleeing, the scare of a death, hunters, threats
run wildlife python3 tests/evaljs.py tests/wildlife.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/the%20river.ula"
run debug python3 tests/evaljs.py tests/debug_mode.js "&tribe=Hu&enemy=Aje&debug"
run debug_ninigi python3 tests/evaljs.py tests/debug_mode.js "&tribe=Ninigi&enemy=Aje&debug"
run looks_aje python3 tests/evaljs.py tests/looks.js "&tribe=Aje&enemy=Hu"
run looks_ninigi python3 tests/evaljs.py tests/looks.js "&tribe=Ninigi&enemy=Hu"
run walls python3 tests/evaljs.py tests/walls.js "&tribe=Hu&enemy=Aje&debug"
# scenery blocks with its pf boxes only (mission 8's ice arch is walked under); mission 16's sleeping Scorpion and open gates
run scenery_block python3 tests/evaljs.py tests/scenery_block.js "&campaign=8&tribe=Ninigi"
run scorpion_start python3 tests/evaljs.py tests/scorpion_start.js "&campaign=16&notriggers"
# the Dustriders' mobile base of a mission start waits for a worker to put it down, free and at once
run free_main python3 tests/evaljs.py tests/free_main.js "&campaign=8&tribe=Aje"
run free_main_seas python3 tests/evaljs.py tests/free_main.js "&campaign=8&tribe=SEAS"
run pathing python3 tests/evaljs.py tests/pathing.js
# cliffs: the original maps' pathfinder grid, the slope rule of the sequel's maps (tests/cliffs.js)
run cliffs python3 tests/evaljs.py tests/cliffs.js "&campaign=13&notriggers"
run cliffs_sequel env PWR_PORT=${SEQ_PORT:-8412} python3 tests/evaljs.py tests/cliffs.js "&sequel=2"
# the original maps' walkable terrain (chunk PaFi), the ground levelling under new buildings (ObjBrush), the click range
# of buildings, the handedness of the models (right hands on the right: maps/frame.js) and attackers breaking gates
run terrain_walk python3 tests/evaljs.py tests/terrain_walk.js "&campaign=1"
run ground python3 tests/evaljs.py tests/ground.js "&tribe=Hu&enemy=Aje"
run pick python3 tests/evaljs.py tests/pick.js "&tribe=SEAS&enemy=Hu"
run handedness python3 tests/evaljs.py tests/handedness.js "&tribe=Hu&enemy=Aje"
run breach python3 tests/evaljs.py tests/breach.js "&campaign=13&notriggers"
run rally python3 tests/evaljs.py tests/rally_task.js "&tribe=Hu&enemy=Aje&debug"
# heroes that can build repair (Tesla), weapon effects only while shooting (the SEAS turret's muzzle flashes)
run hero_repair python3 tests/evaljs.py tests/hero_repair.js "&tribe=Hu&enemy=Aje"
run weapon_fx python3 tests/evaljs.py tests/weapon_fx.js "&tribe=SEAS&enemy=Hu"
run sle python3 tests/evaljs.py tests/sle.js "&tribe=Hu&enemy=Aje&debug"
for t in "Hu&enemy=Aje" "SEAS&enemy=Ninigi" "Aje&enemy=Hu" "Ninigi&enemy=SEAS"; do run comp_${t%%&*} python3 tests/evaljs.py tests/composites.js "&tribe=$t"; done
# day and night: the buildings' lights (tests/night_lights.js); the sequel's classes show their own texts
run night_lights python3 tests/evaljs.py tests/night_lights.js "&tribe=Hu&enemy=Aje"
run night_start python3 tests/evaljs.py tests/night_lights.js "&campaign=11&notriggers"
# the music manager (engine/music.js, MusicMgr.usl): playlists, opening, combat, hometown, trigger music
run music python3 tests/evaljs.py tests/music.js "&tribe=Hu&enemy=Aje"
run music_cpn python3 tests/evaljs.py tests/music.js "&campaign=5"
# a storehouse plays its deliver animation on deliveries (Entity.onDelivery)
run deliver_anim python3 tests/evaljs.py tests/deliver_anim.js "&tribe=Hu&enemy=Aje"
# the floating harbour in the unit limit and the pyramid; the right-click cursors; autosave; the help (F1)
run pyramid_harbour python3 tests/evaljs.py tests/pyramid_harbour.js "&tribe=Aje&enemy=Hu"
run cursors python3 tests/evaljs.py tests/cursors.js "&tribe=Hu&enemy=Aje"
run autosave python3 tests/evaljs.py tests/autosave.js "&tribe=Hu&enemy=Aje"
run helpbook python3 tests/evaljs.py tests/helpbook.js "&tribe=Hu&enemy=Aje"
# healing wells, lakes of healing / damage, the weather (systems/landmarks.js); the ambience (engine/atmo.js)
run wells python3 tests/evaljs.py tests/landmarks.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/bfpw_highland.ula"
run lakes python3 tests/evaljs.py tests/landmarks.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/earth_water_and_stone.ula"
run weather python3 tests/evaljs.py tests/landmarks.js "&campaign=8&notriggers"
run atmo python3 tests/evaljs.py tests/atmo.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/multi_2_jun_001.ula"
# items, finishing moves, buffs; on the walls, ladders, siege towers (systems/items.js, finishing.js, wallwalk.js, siege.js)
run items python3 tests/evaljs.py tests/items.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/multi_2_nor_002.ula"
run finishing_buffs python3 tests/evaljs.py tests/finishing_buffs.js "&tribe=Hu&enemy=Aje&debug"
run wallwalk python3 tests/evaljs.py tests/wallwalk.js "&tribe=Hu&enemy=Ninigi&debug"
run sequel_texts env PWR_PORT=${SEQ_PORT:-8412} python3 tests/evaljs.py tests/sequel_texts.js "&sequel=10"
# MIRAGE's towers with the guns they put on when finished (pwexport/modparts.py: SetReady)
run comp_mirage env PWR_PORT=${SEQ_PORT:-8412} python3 tests/evaljs.py tests/composites.js "&tribe=SEAS&enemy=Hu"
# forest blocks (docs/MAP_FORMAT.md "Frst"): the remake's reader against the toolkit's on real maps (needs PW_GAME = the
# ParaWorld folder and PW_REMAKE_DATA = the built data), then the tutorial map, whose only wood is its forest blocks
if [ -n "$PW_GAME" ]; then (cd .. && python3 -m pwexport.forest "$PW_GAME" $T/forest_expected.json > $T/regress_forest_py.log 2>&1); run forest_reader node tests/forest_blocks.mjs ${PW_REMAKE_DATA:-.}/forest.json $T/forest_expected.json; fi
run forest python3 tests/evaljs.py tests/forest.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/ausbildungslager.ula"
# campaign world setup: the arena (heroes only, 3 computer players) and mission 1 (villages, walls, 4 players)
run campaign_11 python3 tests/evaljs.py tests/campaign_load.js "&campaign=11&notriggers&allmissions"
run campaign_01 python3 tests/evaljs.py tests/campaign_load.js "&campaign=1&notriggers&allmissions"
# the tribe converter's class matching (PW_REMAKE_MOD_DATA: data built for a mod, e.g. MIRAGE, checks its new classes too)
run tribe_match node tests/tribe_match.mjs
# the trigger engine (docs/CAMPAIGN_RUNTIME.md §11): its semantics against a mock world (node) and in the game, then
# missions 11 and 1 played through by script (first their trigger chains against the mock world, then in the game)
run engine_node node tests/campaign_engine.mjs
run play_mock_11 node tests/campaign_play_mock.mjs 11
# the playthroughs without an economy (no gathering or building) also walk their trigger chains in the mock world
for n in 1 2 4 5 6 8 10 14 16; do run play_mock_$n node tests/campaign_play_mock.mjs $n; done
run bot_mock node tests/campaign_bot_mock.mjs
run engine python3 tests/evaljs.py tests/campaign_engine.js "&campaign=11"
run play_11 python3 tests/evaljs.py tests/campaign_play_11.js "&campaign=11"
run play_01 python3 tests/evaljs.py tests/campaign_play_01.js "&campaign=1"
# played with another tribe (game/campaign/tribes.js) and the tutorial
run play_01_ninigi python3 tests/evaljs.py tests/campaign_play_01.js "&campaign=1&tribe=Ninigi"
run play_00 python3 tests/evaljs.py tests/campaign_play_00.js "&campaign=0"
run play_00_seas python3 tests/evaljs.py tests/campaign_play_00.js "&campaign=0&tribe=SEAS"
# two short missions with other tribes (the longer playthroughs, campaign_play_02 ... _13, are run by hand)
run play_07_hu python3 tests/evaljs.py tests/campaign_play_07.js "&campaign=7&tribe=Hu"
run play_10_aje python3 tests/evaljs.py tests/campaign_play_10.js "&campaign=10&tribe=Aje"
# missions played with another tribe (game/campaign/tribes.js): the player's objects converted by role
run tribes_04 python3 tests/evaljs.py tests/campaign_tribes.js "&campaign=4&tribe=Hu&allmissions"
run tribes_13 python3 tests/evaljs.py tests/campaign_tribes.js "&campaign=13&tribe=SEAS&allmissions"
# every menu card and portrait has its picture (ui/atlas.js; a mod's UI is layered over Base's: pipeline/build_ui.py)
run icons_seas python3 tests/evaljs.py tests/icons.js "&tribe=SEAS&enemy=Ninigi"
run icons_03_seas python3 tests/evaljs.py tests/icons.js "&campaign=3&tribe=SEAS"
# buildings swapped for the chosen tribe's (they can be bigger) still do not overlap
run fit_12_seas python3 tests/evaljs.py tests/campaign_fit.js "&campaign=12&tribe=SEAS"
# saved games (game/save.js): a skirmish and a campaign mission saved, loaded in a fresh page and compared
run save_skirmish python3 tests/save_load.py "&tribe=Aje&enemy=Hu&aivai" 300 30
run save_campaign_13 python3 tests/save_load.py "&campaign=13" 120 30
# a skirmish of four in two teams with diplomacy, tribute, chat, statistics and the end screen; the game types; the
# army budget with "My Army" and a campaign mission's army screen; a 4-player game saved and loaded
run skirmish4 python3 tests/evaljs.py tests/skirmish4.js "&players=Hu,Aje,Ninigi,SEAS&teams=1,2,1,2&levels=5,5,5"
run skirmish_dom python3 tests/evaljs.py tests/skirmish_modes.js "&players=Hu,Aje&mode=domination&map=maps/Base/Base/Multiplayer/death_valley.ula"
run skirmish_def python3 tests/evaljs.py tests/skirmish_modes.js "&players=Hu,Aje,Ninigi&mode=defender&hq=0,1,2&map=maps/Base/Base/Multiplayer/die_zitadelle.ula"
run pointbuy python3 tests/evaljs.py tests/pointbuy.js "&players=Hu,Aje,Ninigi&teams=1,2,2&points=1000&levels=5,5"
run save_skirmish4 python3 tests/save_load.py "&players=Hu,Aje,Ninigi&teams=1,2,2&points=1000&aivai" 150 20
# the sequel campaign (docs/SEQUEL.md): every mission loads and runs; 1, 3, 5 and 6 play their mechanic by script
SQ="env PWR_PORT=${SEQ_PORT:-8412}"            # (the sequel is played with MIRAGE's data: game/sequel/rules.js SEQUEL_MOD)
for n in 1 2 3 4 5 6 7 8 9 10; do run sequel_$n $SQ python3 tests/evaljs.py tests/sequel.js "&sequel=$n"; done
run save_sequel_3 $SQ python3 tests/save_load.py "&sequel=3" 120 30
run sequel_power $SQ python3 tests/evaljs.py tests/sequel_power.js "&sequel=2"
run sequel_capture $SQ python3 tests/evaljs.py tests/sequel_capture.js "&sequel=3"
# what heroes give by level (aura, special move, chief bonus, tooltip lines), the originals and the sequel's copies
run hero_levels python3 tests/evaljs.py tests/hero_levels.js "&tribe=Hu&enemy=Aje"
run hero_levels_sequel $SQ python3 tests/evaljs.py tests/hero_levels.js "&sequel=1"
# transporters: the passengers on the animal's back and in the passengers' menu; the temples' healing aura
run passengers python3 tests/evaljs.py tests/passengers.js "&tribe=Hu&enemy=Aje"
run passengers_seas $SQ python3 tests/evaljs.py tests/passengers.js "&tribe=SEAS&enemy=Hu"
run heal_aura python3 tests/evaljs.py tests/heal_aura.js "&tribe=Hu&enemy=Aje"
run wild_looks python3 tests/evaljs.py tests/wild_looks.js "&tribe=Hu&enemy=Aje"
run falling_stones python3 tests/evaljs.py tests/falling_stones.js "&tribe=Hu&enemy=Aje"
run hotkeys python3 tests/evaljs.py tests/hotkeys.js "&tribe=Hu&enemy=Aje"
run formation python3 tests/evaljs.py tests/formation.js "&tribe=Hu&enemy=Aje"
run tooltips_minimap python3 tests/evaljs.py tests/tooltips_minimap.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/the%20river.ula"
run trigger_effects python3 tests/evaljs.py tests/trigger_effects.js "&campaign=1"
# MIRAGE's special moves (game/systems/moves_mirage.js), each tribe's and the heroes', with MIRAGE's data
for pair in "Hu SEAS" "Aje Hu" "Ninigi SEAS" "SEAS Hu"; do set -- $pair; run mirage_moves_$1 $SQ python3 tests/evaljs.py tests/mirage_moves.js "&tribe=$1&enemy=$2"; done
# the story films (needs <data>/assets/video/hs_3010.webm, pwexport/video.py) and the particle emitters of the models
run films python3 tests/evaljs.py tests/films.js "&campaign=9"
run particles python3 tests/evaljs.py tests/particles.js "&tribe=Hu&enemy=Aje"
# the mission UI driven through its contract with the data of mission 1 (quests, ticker, dialogues, cutscenes, markers ...)
run mission_ui python3 tests/evaljs.py tests/mission_ui.js "&campaign=1&notriggers"
# the computer player: a match against itself, its defence, and the campaign interface (COMPUTER_PLAYER.md)
aitest() { timeout 1500 python3 tests/evaljs.py "$@" || echo "FAIL $1: timeout or crash"; }
run ai_match aitest tests/ai_match.js "&tribe=Hu&enemy=Aje&aivai&aib=Giraffe,Dodo&aid=4&minutes=25"
run ai_defence aitest tests/ai_defence.js "&tribe=Hu&enemy=Aje&aid=4"
run ai_campaign aitest tests/ai_campaign.js "&tribe=Hu&enemy=Aje"
# the computer player's walls, outposts, trade, items, chat (ai/walls.js, outposts.js, trade.js, items.js, chat.js)
run ai_walls aitest tests/ai_walls.js "&tribe=Aje&enemy=Hu&aid=6"
run ai_outpost aitest tests/ai_outpost.js "&tribe=Hu&enemy=Aje&aid=6"
run ai_outpost_hu aitest tests/ai_outpost.js "&tribe=Aje&enemy=Hu&aid=6"
run ai_trade aitest tests/ai_trade.js "&tribe=Aje&enemy=Hu&aid=6"
run ai_items aitest tests/ai_items.js "&tribe=Hu&enemy=Aje&aid=8&map=maps/Base/Multiplayer/multi_2_nor_002.ula"
run ai_chat aitest tests/ai_chat.js "&tribe=Hu&enemy=Aje&aid=6"
# the computer player in Domination and Defender games (ai/gametypes.js)
run ai_koth aitest tests/ai_gametypes.js "&players=Hu,Aje&mode=domination&map=maps/Base/Base/Multiplayer/death_valley.ula"
run ai_defender aitest tests/ai_gametypes.js "&players=Hu,Aje&mode=defender&hq=1,0&map=maps/Base/Base/Multiplayer/die_zitadelle.ula"
run ai_attacker aitest tests/ai_gametypes.js "&players=Hu,Aje&mode=defender&hq=0,1&map=maps/Base/Base/Multiplayer/die_zitadelle.ula"
echo done >> $R
