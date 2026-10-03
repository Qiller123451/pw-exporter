#!/bin/sh
# Smoke test of every campaign mission with its triggers: load, run 5 game minutes, one table row per mission.
#   PW_REMAKE_DATA=<built data> PWR_PORT=8411 PWR_TMP=<dir> sh tests/campaign_smoke_all.sh [missions ...]
# Logs: $PWR_TMP/smoke_NN.log; the table: $PWR_TMP/smoke.md (python3 tests/campaign_smoke_table.py $PWR_TMP)
cd "$(dirname "$0")/.."
T=${PWR_TMP:-/tmp}; M=${PWR_MINUTES:-5}
[ $# -gt 0 ] || set -- 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16
for n in "$@"; do
  f=$T/smoke_$(printf %02d $n).log
  timeout 1800 python3 tests/evaljs.py tests/campaign_smoke.js "&campaign=$n&minutes=$M" > $f 2>&1 || echo "FAIL mission $n: timeout or crash" >> $f
  echo "mission $n ok=$(grep -c '^ok' $f) fail=$(grep -c 'FAIL\|PAGEERROR' $f)"
done
python3 tests/campaign_smoke_table.py $T > $T/smoke.md; cat $T/smoke.md
