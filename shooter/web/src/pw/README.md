# pw/ - code shared with the remake

Copies of files from `remake/src` (same relative paths), so the shooter draws ParaWorld maps and models exactly like
the remake does. To refresh them after the remake changed, copy the files again and re-apply the changes listed here.

| file | from | changes |
|---|---|---|
| engine/assets.js | remake/src/engine/assets.js | `retarget` is exported (animations borrowed from other models) |
| engine/parts.js, props.js, terrain.js, water.js, audio.js | remake/src/engine/ | none |
| game/anim.js, colors.js | remake/src/game/ | none |
| game/maps/ula.js, forest.js | remake/src/game/maps/ | none |
