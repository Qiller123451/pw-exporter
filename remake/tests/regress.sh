#!/bin/sh
# The whole regression set (needs the dev server on :8411: python remake/devserver.py --game <ParaWorld folder>). Summary in /tmp/regress.txt, logs in $T/regress_*.log
cd "$(dirname "$0")/.."    # the remake folder
T=${PWR_TMP:-/tmp}; R=$T/regress.txt; : > $R
run() { name=$1; shift; "$@" > $T/regress_$name.log 2>&1; ok=$(grep -c '^ok' $T/regress_$name.log); fail=$(grep -c 'FAIL\|PAGEERROR' $T/regress_$name.log); echo "$name ok=$ok fail=$fail" >> $R; }
node tests/rules_check.mjs > $T/regress_rules.log 2>&1; echo "rules exit=$? $(tail -1 $T/regress_rules.log)" >> $R
for pair in "Hu Aje" "Aje Ninigi" "Ninigi SEAS" "SEAS Hu"; do set -- $pair; run scen_$1 python3 tests/scenarios.py "&tribe=$1&enemy=$2"; done
run naval python3 tests/evaljs.py tests/naval.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/multi_2_jun_001.ula"
run carrier python3 tests/evaljs.py tests/carrier.js "&tribe=SEAS&enemy=Hu&map=maps/Base/Multiplayer/multi_2_jun_001.ula"
run nests python3 tests/evaljs.py tests/nests.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/the%20river.ula"
run debug python3 tests/evaljs.py tests/debug_mode.js "&tribe=Hu&enemy=Aje&debug"
run debug_ninigi python3 tests/evaljs.py tests/debug_mode.js "&tribe=Ninigi&enemy=Aje&debug"
run looks_aje python3 tests/evaljs.py tests/looks.js "&tribe=Aje&enemy=Hu"
run looks_ninigi python3 tests/evaljs.py tests/looks.js "&tribe=Ninigi&enemy=Hu"
run walls python3 tests/evaljs.py tests/walls.js "&tribe=Hu&enemy=Aje&debug"
run pathing python3 tests/evaljs.py tests/pathing.js
run rally python3 tests/evaljs.py tests/rally_task.js "&tribe=Hu&enemy=Aje&debug"
run sle python3 tests/evaljs.py tests/sle.js "&tribe=Hu&enemy=Aje&debug"
for t in "Hu&enemy=Aje" "SEAS&enemy=Ninigi" "Aje&enemy=Hu" "Ninigi&enemy=SEAS"; do run comp_${t%%&*} python3 tests/evaljs.py tests/composites.js "&tribe=$t"; done
# campaign world setup: the arena (heroes only, 3 computer players) and mission 1 (villages, walls, 4 players)
run campaign_11 python3 tests/evaljs.py tests/campaign_load.js "&campaign=11&notriggers&allmissions"
run campaign_01 python3 tests/evaljs.py tests/campaign_load.js "&campaign=1&notriggers&allmissions"
# the trigger engine (docs/CAMPAIGN_RUNTIME.md §11): its semantics against a mock world (node) and in the game, then
# missions 11 and 1 played through by script (first their trigger chains against the mock world, then in the game)
run engine_node node tests/campaign_engine.mjs
run play_mock_11 node tests/campaign_play_mock.mjs 11
run play_mock_01 node tests/campaign_play_mock.mjs 1
for n in 2 5 8; do run play_mock_0$n node tests/campaign_play_mock.mjs $n; done
run bot_mock node tests/campaign_bot_mock.mjs
run engine python3 tests/evaljs.py tests/campaign_engine.js "&campaign=11"
run play_11 python3 tests/evaljs.py tests/campaign_play_11.js "&campaign=11"
run play_01 python3 tests/evaljs.py tests/campaign_play_01.js "&campaign=1"
# the mission UI driven through its contract with the data of mission 1 (quests, ticker, dialogues, cutscenes, markers ...)
run mission_ui python3 tests/evaljs.py tests/mission_ui.js "&campaign=1&notriggers"
# the computer player: a match against itself, its defence, and the campaign interface (COMPUTER_PLAYER.md)
aitest() { timeout 1500 python3 tests/evaljs.py "$@" || echo "FAIL $1: timeout or crash"; }
run ai_match aitest tests/ai_match.js "&tribe=Hu&enemy=Aje&aivai&aib=Giraffe,Dodo&aid=4&minutes=25"
run ai_defence aitest tests/ai_defence.js "&tribe=Hu&enemy=Aje&aid=4"
run ai_campaign aitest tests/ai_campaign.js "&tribe=Hu&enemy=Aje"
echo done >> $R
