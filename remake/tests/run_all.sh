#!/bin/sh
# AI-vs-AI games for every tribe; logs in /tmp/sim_<tribe>.log (needs the dev server on :8411: python remake/devserver.py --game <ParaWorld folder>)
cd "$(dirname "$0")/.."    # the remake folder
for pair in "Hu Aje" "Aje Ninigi" "Ninigi SEAS" "SEAS Hu"; do
  set -- $pair
  timeout 1500 python3 tests/sim.py "&tribe=$1&enemy=$2&aivai&seed=${3:-1234}" ${STEPS:-300,300,300,300} > /tmp/sim_$1.log 2>&1
done
echo done > /tmp/sim_done
