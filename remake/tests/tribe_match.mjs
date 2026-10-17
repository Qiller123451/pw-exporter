// The tribe converter's class matching (game/campaign/tribes.js TribeSwap.equivalent): the base game keeps the role
// table, a mod's new classes take roles they fit by name and data. Run:
//   PW_REMAKE_DATA=<data built for Base> [PW_REMAKE_MOD_DATA=<data built for MIRAGE>] node tests/tribe_match.mjs
import fs from 'fs';
import { Rules } from '../src/game/rules.js';
import { TribeSwap, ROLES, TRIBES } from '../src/game/campaign/tribes.js';

const out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
function load(dir) {
  const R = new Rules(JSON.parse(fs.readFileSync(dir + '/techtree.json')), JSON.parse(fs.readFileSync(dir + '/gamedata.json')));
  const man = JSON.parse(fs.readFileSync(dir + '/assets/manifest.json'));
  const swaps = new Map();
  const swap = (from, to) => { const k = from + to; if (!swaps.has(k)) swaps.set(k, new TribeSwap(R, from, to, { models: man.models })); return swaps.get(k); };
  return { R, swap };
}
const expect = (S, map) => {
  for (const [from, to, cls, want] of map) {
    const got = S(from, to).equivalent(cls);
    check(`${cls} -> ${want}`, got === want, got);
  }
};

const base = load(process.env.PW_REMAKE_DATA || '.');
// every role of the table stands in the base game but where a class of the same kind by name fits as well
const off = [], first = new Map();
for (const row of ROLES) for (let f = 1; f <= 4; f++) if (row[f] && !first.has(row[f])) first.set(row[f], [f, row]);   // a class's first role
for (const [cls, [f, row]] of first) for (let t = 1; t <= 4; t++) {
  if (f === t || !row[t]) continue;
  const got = base.swap(TRIBES[f - 1], TRIBES[t - 1]).equivalent(cls);
  if (got !== row[t]) off.push(`${cls} -> ${got} (table ${row[t]})`);
}
const allowed = (s) => /^seas_submarine -> ninigi_muraeno_submarine/.test(s);   // a submarine for a submarine
const real = off.filter((s) => !allowed(s));
check('base game: the table roles stand', real.length === 0, real);
expect(base.swap, [
  ['Aje', 'SEAS', 'aje_tent', 'seas_barracks'],
  ['Hu', 'SEAS', 'hu_spearman', 'seas_gunner'],
  ['Aje', 'SEAS', 'aje_resource_collector', 'seas_headquarters'],    // an animal in the table's role of a building
  ['Hu', 'Aje', 'hu_fireplace', 'aje_resource_collector'],
  ['Hu', 'Ninigi', 'hu_worker', 'ninigi_worker'],
  ['Hu', 'SEAS', 'hu_tavern', null],                                  // the SEAS have no tavern
  ['Hu', 'Aje', 'hu_jetpack_warrior', 'aje_warrior'],                 // outside the table: by name
  ['Ninigi', 'Hu', 'ninigi_telescope_tower_ruins', null],             // ruins are no tower
  ['Aje', 'Ninigi', 'aje_tracker_dino', 'ninigi_scout'],              // the trade dino is no tracker dino
]);

if (process.env.PW_REMAKE_MOD_DATA) {
  const mod = load(process.env.PW_REMAKE_MOD_DATA);
  expect(mod.swap, [
    ['Aje', 'SEAS', 'aje_tent', 'seas_small_tent'],                   // MIRAGE's SEAS tents
    ['Aje', 'SEAS', 'aje_clay_wall', 'seas_fence'],                    // MIRAGE's SEAS wall and spearmen name models
    ['Hu', 'SEAS', 'hu_spearman', 'seas_gunner'],                      // the game does not have
    ['Ninigi', 'SEAS', 'ninigi_teahouse', 'seas_pub'],
    ['Hu', 'SEAS', 'hu_tavern', 'seas_pub'],                          // a role empty in the base game
    ['Hu', 'SEAS', 'hu_cart', 'seas_trade_dino'],                     // the table's class is not in the mod
    ['Hu', 'SEAS', 'hu_fireplace', 'seas_headquarters'],
    ['Hu', 'SEAS', 'hu_worker', 'seas_worker'],
  ]);
}
console.log(out.join('\n'));
