// Forest blocks (docs/MAP_FORMAT.md "Frst"): the remake's reader (src/game/maps/forest.js) against the toolkit's
// (pwexport/forest.py) on real maps - same trees at the same spots.
//   node tests/forest_blocks.mjs <forest.json> <expected.json>
// expected.json = {map file: {path, trees, deco, sum: [x sum, y sum], first: [x, y, kind]}} written by
//   python -m pwexport.forest <game folder> <expected.json>
import fs from 'node:fs';
import { parseUla } from '../src/game/maps/ula.js';
import { setForestData, forestItems, forestKinds, hasForestData } from '../src/game/maps/forest.js';

const [, , forestJson, expectedJson] = process.argv;
const ok = (name, cond, info = '') => console.log(`${cond ? 'ok  ' : 'FAIL'} ${name} ${info}`);
setForestData(null);
ok('no data: no forest', !hasForestData() && forestKinds('Jungle') === null);
setForestData(JSON.parse(fs.readFileSync(forestJson, 'utf8')));
ok('forest.json loads', hasForestData());
const k = forestKinds('Jungle');
ok('kinds of a setting', k && k.trees.length === 5 && k.deco.length === 8 && /tree/i.test(k.trees[0].standard), k && k.trees[0].standard);
const exp = JSON.parse(fs.readFileSync(expectedJson, 'utf8'));
for (const [name, e] of Object.entries(exp)) {
  const buf = fs.readFileSync(e.path);
  const md = await parseUla(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name);
  const hx = md.hx, hy = md.hy, H = md.heights;
  const heightAt = (x, y) => {
    const fx = Math.max(0, Math.min(hx - 1.001, x / 2)), fy = Math.max(0, Math.min(hy - 1.001, y / 2));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    return (H[j * hx + i] * (1 - u) + H[j * hx + i + 1] * u) * (1 - v) + (H[(j + 1) * hx + i] * (1 - u) + H[(j + 1) * hx + i + 1] * u) * v;
  };
  const it = forestItems(md, heightAt);
  const sx = it.trees.reduce((a, t) => a + t.x, 0), sy = it.trees.reduce((a, t) => a + t.y, 0);
  const near = (a, b) => Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(b));
  ok(`${name}: blocks`, md.forest.blocks.length === e.blocks, `${md.forest.blocks.length} / ${e.blocks}`);
  ok(`${name}: trees and undergrowth`, it.trees.length === e.trees && it.deco.length === e.deco, `${it.trees.length} / ${e.trees}, ${it.deco.length} / ${e.deco}`);
  ok(`${name}: same spots`, near(sx, e.sum[0]) && near(sy, e.sum[1]));
  if (e.first) ok(`${name}: first tree`, near(it.trees[0].x, e.first[0]) && near(it.trees[0].y, e.first[1]) && it.trees[0].kind === e.first[2] && near(it.trees[0].rot, e.first[3]));
}
