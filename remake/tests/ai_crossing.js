// The computer player crosses the water (ai/naval.js): units on their way to another land board a transport, sail to
// water off the target's own shore (no enemy mine / tower near it) and land; the crew of an outpost on another land
// goes the same way (ai/outposts.js outpostTransfer).
//   python3 tests/evaljs.py tests/ai_crossing.js "&tribe=Aje&enemy=Hu&map=maps/Base/Multiplayer/multi_2_jun_001.ula"
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const ai = W.players.find((p) => p !== G.me), B = G.brains && G.brains.get(ai.id);
const run = (s) => { for (let i = 0; i < s * 10; i++) G.step(1, 0.1); };
ok(!!B && !!W.waterNav, 'a computer player on a water map');
if (!B) return out.join('\n');
run(1);
const S = B.census(true), home = W.landIsland(S.home.x, S.home.z);
// a piece of another land, 60 m and more from anything
let P = null;
const n = W.nav.n;
for (let k = 0; k < n * n && !P; k += 7) {
  const [x, z] = W.nav.center(k);
  const isl = W.landIsland(x, z);
  if (isl < 0 || isl === home || W.isWater(x, z, 0.4) || !W.nav.isFree(x, z)) continue;
  let big = 0;
  for (let j = 0; j < n * n; j += 97) if (W._island[j] === isl) big++;
  if (big > 20 && W.buildings.every((b) => Math.hypot(b.pos.x - x, b.pos.z - z) > 60)) P = { x, z, isl };
}
ok(!!P, 'the map has another land', P);
if (!P) return out.join('\n');
const L = B.landingFor(P);
ok(!!L && !W.waterNav.block[W.waterNav.idx(L.water.x, L.water.z)], 'the landing: water ships can reach', L);
let land = false;
for (let s = 4; s <= 14 && L; s += 2) { const dx = P.x - L.water.x, dz = P.z - L.water.z, d = Math.hypot(dx, dz); const qx = L.water.x + dx / d * s, qz = L.water.z + dz / d * s; if (!W.isWater(qx, qz, 0.4) && W.landIsland(qx, qz) === P.isl) land = true; }
ok(land, 'with the target\'s own land within 14 m towards it');
// a transport off the home shore and three warriors at home: the outpost crew's transfer
const cls = B.transportClass();
let sx = null, sz = null;
for (let r = 20; r < 400 && sx === null; r += 6) for (let a = 0; a < 32; a++) { const x = S.home.x + Math.cos(a / 32 * 6.283) * r, z = S.home.z + Math.sin(a / 32 * 6.283) * r; if (!W.waterNav.block[W.waterNav.idx(x, z)]) { sx = x; sz = z; break; } }
const ship = cls && sx !== null ? W.spawnUnit(cls, ai, sx, sz, 1, 0) : null;
ok(!!ship, 'a transport of the tribe', cls);
const foot = ['aje_warrior', 'aje_spearman'].find((c) => G.data.exists(c));
const us = [0, 1, 2].map((i) => W.spawnUnit(foot, ai, S.home.x + 6 + i * 2, S.home.z + 6, 2, 0)).filter(Boolean);
B.outpostTransfer(B.census(true), { pos: { x: P.x, z: P.z } }, us);
const a = B.attacks.find((x) => x.type === 'transfer');
ok(!!a && !!a.ferry, 'the crew of an outpost on another land crosses by ship', a && { state: a.state, ferry: !!a.ferry });
let t = 0;
const trace = [];
for (; t < 60 && !us.every((u) => !u.alive || (!u.inside && W.landIsland(u.pos.x, u.pos.z) === P.isl)); t++) { run(5); const F = a.ferry; if (t % 6 === 0) trace.push([t * 5, a.state, F && F.phase, F && F.ships.length, F && F.round, ship.alive && [Math.round(ship.pos.x), Math.round(ship.pos.z), ship.task.type, (ship.passengers || []).length], us.map((u) => u.task.type + (u.inside ? '*' : '')).join(',')]); }
out.push('   ' + JSON.stringify(trace));
ok(us.some((u) => u.alive) && us.every((u) => !u.alive || W.landIsland(u.pos.x, u.pos.z) === P.isl), 'they landed on that land', { s: t * 5, where: us.map((u) => [u.alive, W.landIsland(u.pos.x, u.pos.z), Math.round(Math.hypot(u.pos.x - P.x, u.pos.z - P.z))]) });
run(20);
ok(us.every((u) => !u.alive || W.landIsland(u.pos.x, u.pos.z) === P.isl), 'and stay there (not sent home)');
// a transport hit while the squad boards: everybody out at home, the crossing ends (WC:138 EmergencyUnboard)
const ship2 = W.spawnUnit(cls, ai, sx, sz, 1, 0);
const us2 = [0, 1].map((i) => W.spawnUnit(foot, ai, S.home.x + 6 + i * 2, S.home.z + 10, 2, 0)).filter(Boolean);
B.outpostTransfer(B.census(true), { pos: { x: P.x, z: P.z } }, us2);
const a2 = B.attacks.find((x) => x.type === 'transfer' && us2.every((u) => x.units.has(u)));
let k = 0;
for (; k < 40 && a2.ferry && a2.ferry.phase !== 'board'; k++) run(1);
run(3);
W.damage(ship2, 20, null);
for (k = 0; k < 20 && B.attacks.includes(a2); k++) run(1);
run(10);
ok(!B.attacks.includes(a2) && us2.every((u) => !u.inside && W.landIsland(u.pos.x, u.pos.z) === home), 'a transport attacked while boarding: everybody stays home', { left: !B.attacks.includes(a2), where: us2.map((u) => [u.inside ? 'in' : 'out', W.landIsland(u.pos.x, u.pos.z)]) });
return out.join('\n');
