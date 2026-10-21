// Mission 16's gates (seas_endboss_gate: the SEAS gate's rig x 1.25, borrowing its clips): open at the start, and
// their doors sink all the way (the borrowed motion scaled with the rig: engine/assets.js retarget).
// The player's units walk out of the start through each of the three big gates. With MIRAGE's data too (its tech tree
// lists seas_endboss_gate without the gate flag, and seas_hq_gate has its own CGate class: both stood shut as scenery).
//   python3 tests/evaljs.py tests/gates_m16.js "&campaign=16&notriggers"     (MIRAGE: PWR_PORT=<MIRAGE server>)
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const amp = (n) => { const t = W.template(n, true); if (!t) return 0; const c = t.clips.find((x) => x.name.toLowerCase() === 'open'); let m = 0; for (const tr of c.tracks) if (tr.name.endsWith('.position')) { const v = tr.values; for (let i = 3; i < v.length; i += 3) m = Math.max(m, Math.hypot(v[i] - v[0], v[i + 1] - v[1], v[i + 2] - v[2])); } return m; };
const a = amp('seas_gate'), b = amp('seas_endboss_gate');
ok(a > 0 && Math.abs(b / a - 1.25) < 0.01, 'the big gates\' doors move 1.25 x as far as a SEAS gate\'s', [+a.toFixed(2), +b.toFixed(2)]);
const gs = W.buildings.filter((x) => /endboss_gate|hq_gate/.test(x.name));
ok(gs.length === 4 && gs.every((g) => g.gateState === 0 && [...W.nav.gateAt.values()].includes(g)), 'all four gates are open and passable', gs.map((g) => [g.name, g.gateState]));
// walk out: one of the player's units to a point 25 m beyond each big gate (from the start, 503 509)
const C = G.campaign, me = G.me;
const u = W.units.find((x) => x.alive && x.owner === me && !x.def.unique) || W.units.find((x) => x.alive && x.owner === me);
const start = C.toGame(503, 509);
const reached = [];
for (const g of gs.filter((x) => /endboss/.test(x.name))) {
  W.teleport(u, start[0], start[1], 0);
  const dx = g.pos.x - start[0], dz = g.pos.z - start[1], d = Math.hypot(dx, dz);
  const tx = g.pos.x + dx / d * 25, tz = g.pos.z + dz / d * 25;
  W.order([u], { type: 'move', x: tx, z: tz });
  for (let k = 0; k < 60 && Math.hypot(u.pos.x - tx, u.pos.z - tz) > 4; k++) G.step(20, 0.05);
  // how far past the gate it got, along the way out (the points 25 m on can be rock: it stops nearby)
  const past = ((u.pos.x - g.pos.x) * dx + (u.pos.z - g.pos.z) * dz) / d;
  reached.push([C.toMap(g.pos.x, g.pos.z).map(Math.round), Math.round(past)]);
}
ok(u && reached.length === 3 && reached.every((r) => r[1] >= 8), 'a unit of the player walks out of the start through each big gate (metres past it)', reached);
return out.join('\n');
