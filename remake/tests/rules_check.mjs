// Sanity checks of the rules layer against known original values (node tests/rules_check.mjs)
import fs from 'fs';
import { Rules } from '../src/game/rules.js';
const R = new Rules(JSON.parse(fs.readFileSync((process.env.PW_REMAKE_DATA || '.') + '/techtree.json')), JSON.parse(fs.readFileSync((process.env.PW_REMAKE_DATA || '.') + '/gamedata.json')));
let fail = 0;
const eq = (name, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) fail++; console.log(ok ? 'ok  ' : 'FAIL', name, JSON.stringify(a), ok ? '' : '!= ' + JSON.stringify(b)); };
const P = (t) => ({ tribe: t, tt: R.newTree(t) });
const hu = P('Hu'), aje = P('Aje'), nin = P('Ninigi'), seas = P('SEAS');
eq('hu_warrior L1 weapon', R.weaponSet('hu_warrior', 1, hu).long.id, 'hu_axe_a');
eq('hu_warrior L3 weapon', R.weaponSet('hu_warrior', 3, hu).long.id, 'hu_axe_c');
eq('slaughterhouse unlimited', R.def('aje_slaughterhouse', aje).unlimited, ['food']);
eq('bamboofarm unlimited', R.def('ninigi_bamboofarm', nin).unlimited, ['wood']);
eq('bunker script', R.def('hu_bunker', hu).script, 'CBunker');
eq('hero unique', R.def('Cole_s0', hu).unique, true);
eq('triceratops food', R.corpseFood('Triceratops'), 2000);
eq('hu_worker carry', R.stats('hu_worker', 1, hu).carry, { food: 20, wood: 20, stone: 20 });
eq('seas_worker tf', R.stats('seas_worker', 1, seas).tf, 2);
const ws = R.weaponStats(R.weaponSet('hu_archer', 2, hu).long, 'hu_archer', hu);
console.log('hu_archer L1', ws && { dmg: ws.dmg, range: ws.range, dur: ws.dur, rprot: ws.rprot });
for (const t of [hu, aje, nin, seas]) {
  const blds = R.actions(t).filter((a) => a.cat === 'Build/BLDG' && a.visible && a.locs.some((l) => !l.hidden));
  console.log(t.tribe, 'buildable', blds.length, blds.map((a) => a.id).join(' '));
  const moves = R.actions(t).filter((a) => a.kind === 'Moves');
  console.log(t.tribe, 'moves', moves.length);
}
const tv = R.actions(hu).find((a) => a.id === 'Cole_s0');
console.log('Cole action', tv && { cost: tv.cost, time: tv.time, locs: tv.locs.map((l) => l.at) });
const sg = R.actions(hu).find((a) => a.id === 'Shotgun');
console.log('Shotgun', sg && { target: sg.target, owner: sg.targetOwner, time: sg.time, lv: sg.levelReq, locs: sg.locs.map((l) => l.at) });
process.exit(fail ? 1 : 0);
