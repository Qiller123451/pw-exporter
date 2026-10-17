// The ground under a building put down in the game (game/ground.js, the original's AdaptTerrain with the buildings'
// Texture/Scape/ObjBrush brushes): the ground under the house ends up level, the building stands on it, the ground
// there takes the brush's material (gravel) and the plants around it go (W.clearVegetation). python3 tests/evaljs.py tests/ground.js "&tribe=Hu&enemy=Aje"
const W = G.world, H = (x, z) => W.height(x, z), me = G.me;
const spread = (x, z, r) => { let lo = 1e9, hi = -1e9; for (let a = 0; a < 6.28; a += 0.4) for (let d = 0; d <= r; d += r / 3) { const h = H(x + Math.cos(a) * d, z + Math.sin(a) * d); lo = Math.min(lo, h); hi = Math.max(hi, h); } return hi - lo; };
const wk = W.units.find((u) => u.alive && u.owner === me && u.isWorker);
const acts = G.data.actionsOf(wk.rulesOwner(), wk);
const act = acts.find((a) => a.cat === 'Build/BLDG' && /house|hut|cottage/i.test(a.results[0].obj) && !G.data.def(a.results[0].obj, me).wallKind);
if (!act) return 'FAIL no house to build: ' + acts.filter((a) => a.cat === 'Build/BLDG').map((a) => a.results[0].obj).join(' ');
const name = act.results[0].obj;
// a sloped free spot near the headquarters
const hq = W.buildings.find((b) => b.owner === me && b.def.script !== 'CWall');
let spot = null, best = 0;
for (let k = 0; k < 400 && !spot; k++) {
  const a = k * 2.39996, d = 30 + (k % 40) * 2;
  const x = hq.pos.x + Math.cos(a) * d, z = hq.pos.z + Math.sin(a) * d;
  const s = spread(x, z, 5);
  if (s > best && s < 3 && W.placement(name, x, z, 0, me).ok) { best = s; if (s > 0.6) spot = [x, z]; }
}
if (!spot) return 'FAIL no sloped spot (best ' + best.toFixed(2) + ')';
const [x, z] = spot, before = spread(x, z, 4);
const w0 = G.groundWeights(x, z).slice();
Object.assign(me.res, { food: 9999, wood: 9999, stone: 9999 });
const b = W.startConstruction(me, act, x, z, 0, []);
if (!b || typeof b === 'string') return 'FAIL not placed: ' + b;
const after = spread(b.pos.x, b.pos.z, 4);
const sits = Math.abs(b.pos.y - H(b.pos.x, b.pos.z));
const ok = after < before * 0.4 && after < 0.25 && sits < 0.05 && !!W.adaptTerrain;
const out = [(ok ? 'ok' : 'FAIL') + ' ground levelled under ' + name + ': spread ' + before.toFixed(2) + ' m -> ' + after.toFixed(2) + ' m, building ' + sits.toFixed(3) + ' m off the ground'];
// the ground material: the brush's middle is gravel (material 5) - the weight of its texture went up
const slot = G.groundSlot(5), w1 = G.groundWeights(x, z);          // (the map's texture for gravel, or the nearest)
out.push((slot >= 0 && w1[slot] > 0.5 && w1[slot] >= w0[slot] ? 'ok  ' : 'FAIL') + ' the ground under it is gravel  ' + JSON.stringify({ before: +(w0[slot] || 0).toFixed(2), after: +(w1[slot] || 0).toFixed(2) }));
// the plants: no decoration left within the building's radius
const R = Math.hypot(b.hx, b.hz), left = W.decorIndex.filter((e) => !e.gone && Math.hypot(e.x - x, e.z - z) < R - 0.5).length;
out.push((left === 0 && W.vegetationLog.length > 0 ? 'ok  ' : 'FAIL') + ' the plants around it are gone  ' + JSON.stringify({ left, radius: +R.toFixed(1) }));
return out.join('\n');
