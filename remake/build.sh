#!/bin/sh
# Bundle the remake with the esbuild binary next to this file (or the one from npm): src -> game/game.js
set -e
cd "$(dirname "$0")"
ESB=./esbuild; [ -x "$ESB" ] || ESB=node_modules/.bin/esbuild
"$ESB" src/main.js --bundle --format=iife --minify-whitespace --minify-syntax --target=es2020 --outfile=game/game.js --log-level=warning --define:__BUILD__=\"$(date +%Y%m%d%H%M)\" "$@"
# the sequel's maps for the exporter's map viewer (src/tools/sequel_maps.js): an ES module, three.js from the page
"$ESB" src/tools/sequel_maps.js --bundle --format=esm --external:three --external:'three/*' --minify-whitespace --minify-syntax --target=es2020 --outfile=game/sequelmaps.js --log-level=warning
cp index.src.html game/index.html
ls -la game/game.js
