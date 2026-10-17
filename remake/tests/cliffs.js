// Cliffs (World.markTerrain): land units do not walk up cliffs - on the original maps the cells the editor's
// pathfinder grid blocks, on maps without one (the sequel's, the random ones) ground steeper than the slope rule
// (maps/source.js slopeWalkable). Run with
//   PWR_PORT=8412 python3 tests/evaljs.py tests/cliffs.js "&sequel=2"     python3 tests/evaljs.py tests/cliffs.js "&campaign=13&notriggers"
// Units are sent to points on the steepest ground near the base; while they walk none ever stands on a blocked cell
// they did not start in, and the steepest ground under them stays below the limit.
const W = G.world, nav = W.nav, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const steep = (x, z) => {
  const h = [W.height(x - 1, z - 1), W.height(x + 1, z - 1), W.height(x + 1, z + 1), W.height(x - 1, z + 1)];
  let m = 0;
  for (let i = 0; i < 4; i++) m = Math.max(m, Math.abs(h[i] - h[(i + 1) % 4]) / 2);
  m = Math.max(m, Math.abs(h[0] - h[2]) / 2.83, Math.abs(h[1] - h[3]) / 2.83);
  return Math.atan(m) * 180 / Math.PI;
};
const h = G.homeEntity();
check('steep cells blocked (' + (G.mapSource.walkable ? "the map's pathfinder grid" : 'the slope rule') + ')', W.steepCell && W.steepCell.some((v) => v), { kind: G.mapSource.kind, steep: W.steepCell.reduce((a, v) => a + v, 0) });
// the steepest cells within 120 m of the base
const cand = [];
for (let k = 0; k < nav.n * nav.n; k++) {
  const [x, z] = nav.center(k);
  if (Math.hypot(x - h.pos.x, z - h.pos.z) > 120 || !W.steepCell[k]) continue;
  cand.push([steep(x, z), x, z]);
}
cand.sort((a, b) => b[0] - a[0]);
check('cliffs near the base', cand.length > 20, cand.length);
if (cand.length <= 20) return out.join('\n');
const units = W.units.filter((u) => u.owner === me && u.alive && !u.flying && !u.naval && u.cls === 'CHTR').slice(0, 6);
const goals = cand.filter((c, i) => i % Math.max(1, Math.floor(cand.length / 6)) === 0).slice(0, units.length);
units.forEach((u, i) => { const g = goals[i % goals.length]; W.order([u], { type: 'move', x: g[1], z: g[2] }); });
const start = new Map(units.map((u) => [u, nav.idx(u.pos.x, u.pos.z)]));
let worst = 0, onBlocked = 0;
for (let t = 0; t < 600; t++) {
  G.step(0.05);
  for (const u of units) {
    if (!u.alive) continue;
    const k = nav.idx(u.pos.x, u.pos.z);
    if (W.steepCell[k] && k !== start.get(u)) onBlocked++;
    worst = Math.max(worst, steep(u.pos.x, u.pos.z));
  }
}
check('no unit walks onto a cliff cell', onBlocked === 0, onBlocked);
check('the ground under them stays below the limit (+ a cell\'s margin)', worst < 40, Math.round(worst));
check('they walked (round the cliffs or to their foot)', units.filter((u) => nav.idx(u.pos.x, u.pos.z) !== start.get(u)).length >= units.length / 2, units.map((u) => [Math.round(u.pos.x), Math.round(u.pos.z)]));
return out.join('\n');
