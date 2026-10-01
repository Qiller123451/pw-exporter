#!/bin/sh
# The whole regression set (needs the dev server on :8411: python remake/devserver.py --game <ParaWorld folder>). Summary in /tmp/regress.txt, logs in /tmp/regress_*.log
cd "$(dirname "$0")/.."    # the remake folder
R=/tmp/regress.txt; : > $R
run() { name=$1; shift; "$@" > /tmp/regress_$name.log 2>&1; ok=$(grep -c '^ok' /tmp/regress_$name.log); fail=$(grep -c 'FAIL\|PAGEERROR' /tmp/regress_$name.log); echo "$name ok=$ok fail=$fail" >> $R; }
node tests/rules_check.mjs > /tmp/regress_rules.log 2>&1; echo "rules exit=$? $(tail -1 /tmp/regress_rules.log)" >> $R
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
for t in "Hu&enemy=Aje" "SEAS&enemy=Ninigi" "Aje&enemy=Hu" "Ninigi&enemy=SEAS"; do run comp_${t%%&*} python3 tests/evaljs.py tests/composites.js "&tribe=$t"; done
echo done >> $R
