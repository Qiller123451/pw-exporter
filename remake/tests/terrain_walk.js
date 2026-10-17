// Walkable terrain of the original maps (the map's pathfinder grid, chunk PaFi: maps/ula.js pathing, World.markTerrain):
// the steep ground is blocked and paths of land units stay off it. python3 tests/evaljs.py tests/terrain_walk.js "&campaign=1"
const W = G.world, nav = W.nav, n = nav.n, H = W.height;
let steep = 0, slopeHigh = 0, slopeHighBlocked = 0;
for (let k = 0; k < n * n; k++) {
  if (W.steepCell && W.steepCell[k]) steep++;
  const [x, z] = nav.center(k);
  const s = Math.max(Math.abs(H(x + 1, z) - H(x - 1, z)), Math.abs(H(x, z + 1) - H(x, z - 1))) / 2;
  if (s > 0.8) { slopeHigh++; if (nav.block[k]) slopeHighBlocked++; }
}
// random paths between free cells: samples on blocked cells and the steepest climb along them
let rnd = 12345; const R = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
const free = []; for (let k = 0; k < n * n; k++) if (!nav.block[k]) free.push(k);
let paths = 0, bad = 0, worst = 0;
for (let t = 0; t < 150; t++) {
  const a = nav.center(free[Math.floor(R() * free.length)]), b = nav.center(free[Math.floor(R() * free.length)]);
  const p = nav.find(a[0], a[1], b[0], b[1], 0.7, 60000);
  if (!p) continue; paths++;
  let px = a[0], pz = a[1];
  for (const [qx, qz] of p) {
    const L = Math.hypot(qx - px, qz - pz);
    for (let s = 0; s <= L; s += 0.5) {
      const x = px + (qx - px) * s / (L || 1), z = pz + (qz - pz) * s / (L || 1);
      if (nav.block[nav.idx(x, z)]) bad++;
      worst = Math.max(worst, Math.abs(H(x + 0.5, z) - H(x - 0.5, z)), Math.abs(H(x, z + 0.5) - H(x, z - 0.5)));
    }
    px = qx; pz = qz;
  }
}
const share = slopeHighBlocked / Math.max(1, slopeHigh);
const ok = steep > 0 && share > 0.97 && paths > 100 && bad < 400;
return (ok ? 'ok' : 'FAIL') + ` terrain walk: ${steep} cells blocked by the map's grid, ${(share * 100).toFixed(1)} % of the cliff cells; ${paths} paths, ${bad} samples on blocked cells`;
