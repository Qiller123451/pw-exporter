// Walls on the 8 m grid (run with tests/evaljs.py tests/walls.js "&tribe=Hu&enemy=Aje&debug"; docs/spec/walls.md):
// lines, arms, corners, gaps, joining, gates with wings, towers as joints, units through gates.
const W = G.world, me = G.me, WM = W.wallMap, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (s) => G.step(Math.ceil(s / 0.05));
for (const u of W.units) if (u.alive && u.wild) W.kill(u, null);
W.wildNests.length = 0;
try {
const pal = G.buildActions().find((a) => a.results[0].obj === 'hu_palisade');
const gateA = G.data.actions(me).find((a) => a.results[0].obj === 'hu_palisade_gate');
const age2 = G.producerActions(G.homeEntity()).find((a) => a.id === 'age_2');
if (age2) { W.queueAction(G.homeEntity(), age2); G.step(10); }
const towerA = G.data.actions(me).find((a) => /^hu_(small_tower|bunker)$/.test(a.results[0].obj) && !G.data.check(me, a));
check('actions exist', !!pal && !!gateA && !!towerA, [pal && pal.id, gateA && gateA.id, towerA && towerA.id]);
const h = G.homeEntity();
// a clear spot 60 m from the HQ
// a clear area near the HQ: every tile the test uses must be placeable
const USED = [];
for (let i = 0; i <= 4; i++) USED.push([i, 0]);
for (let j = 1; j <= 3; j++) USED.push([4, j]);
for (let k = 0; k <= 4; k++) USED.push([-6 + k, 6 - k]);
for (const d of [[2, -2], [2, 2], [2, -1], [2, 1]]) USED.push(d);
let ci = null, cj = null;
for (let r = 60; r < 400 && ci === null; r += 16) for (let a = 0; a < 16 && ci === null; a++) {
  const [i0, j0] = WM.tileOf(h.pos.x + Math.cos(a / 16 * 6.283) * r, h.pos.z + Math.sin(a / 16 * 6.283) * r);
  let ok = true;
  for (const [i, j] of USED) if (ok) { const [x, z] = WM.centre(i0 + i, j0 + j); if (!W.canPlace('hu_palisade', x, z, 0, me)) ok = false; }
  if (ok) { ci = i0; cj = j0; }
}
out.push('area ' + ci + ',' + cj);
const T = (i, j) => WM.centre(ci + i, cj + j);
const place = (a, b, held = []) => { const [x0, z0] = T(...a), [x1, z1] = T(...b); const tiles = W.wallLine(me, pal, x0, z0, x1, z1, held); return { tiles, n: G.placeWall(pal, tiles, []) }; };
const at = (i, j) => WM.at(ci + i, cj + j);
const mask = (i, j) => { const t = at(i, j); return t && t.wall ? t.wall.armMask : -1; };
// 1. straight line of 5 tiles W-E
const r1 = place([0, 0], [4, 0]);
check('straight line: 5 pieces on the grid, never rotated', r1.n === 5 && [0, 1, 2, 3, 4].every((i) => at(i, 0) && at(i, 0).wall && at(i, 0).wall.rot === 0), { n: r1.n, states: r1.tiles.map((t) => t.state) });
check('arms: ends one arm, middle E+W', mask(0, 0) === 1 && mask(4, 0) === 16 && mask(2, 0) === 17, [mask(0, 0), mask(2, 0), mask(4, 0)]);
// no gaps: the points between pieces are blocked
const gaps = [0, 1, 2, 3].filter((i) => { const [x, z] = T(i, 0); return W.nav.isFree(x + 4, z); });
check('no gaps between pieces', gaps.length === 0, gaps);
// 2. an L: from the east end south 3 tiles
const r2 = place([4, 0], [4, 3]);
check('joins the existing end (no new piece there)', r2.tiles[0].state === 'have' && r2.n === 3, r2.tiles.map((t) => t.state));
check('corner piece W+S, no diagonal across the corner', mask(4, 0) === (16 | 64), mask(4, 0));
// 3. a diagonal line
const r3 = place([-6, 6], [-2, 2]);
check('diagonal line', r3.n === 5 && mask(-4, 4) === ((1 << 1) | (1 << 5)), { n: r3.n, m: mask(-4, 4) });
// 4. a gate into the straight run
const [gx, gz] = T(2, 0);
const pg = W.placement('hu_palisade_gate', gx, gz, 0, me);
check('gate fits on a straight run, oriented E-W', pg.ok && pg.rot === 0, { ok: pg.ok, rot: pg.rot });
const gate = W.startConstruction(me, gateA, gx, gz, 0, []);
check('gate placed', typeof gate !== 'string', typeof gate === 'string' ? gate : 'ok');
check('gate replaces the piece, neighbours become its wings', gate && gate.def && gate.def.wallKind === 'gate' && !at(2, 0).wall && at(2, 0).gate === gate && gate.wings.length === 2 && gate.wings.every((w) => w.parentGate === gate), { gate: !!gate.def });
check('wings show no arm into the gate', !(mask(1, 0) & 1) && !(mask(3, 0) & 16), [mask(1, 0), mask(3, 0)]);
const wing = gate.wings[0], ghp = gate.hp;
W.damage(wing, 100, null);
check('damage to a wing goes to the gate', gate.hp === ghp - 100 && wing.hp === wing.maxHp, { gate: gate.hp, wing: wing.hp });
const pg2 = W.placement('hu_palisade_gate', ...T(0, 0), 0, me);
check('no gate on an end piece', !pg2.ok);
const pgN = W.placement('hu_palisade_gate', ...T(4, 2), 0, me);
check('a gate on a N-S run turns 90 degrees', pgN.ok && Math.abs(pgN.rot - Math.PI / 2) < 1e-6, pgN.rot);
// 5. own units walk through the open gate (north -> south), not through the wall
const [nx, nz] = T(2, -2), [sx, sz] = T(2, 2);
const path = W.nav.find(nx, nz, sx, sz, 0.7, 30000, me);
check('a path through the gate', !!path && path.length > 0 && path.length < 6, path && path.length);
// 6. a tower on a wall piece is a joint
const [tx, tz] = T(4, 2);
const pt = W.placement(towerA.results[0].obj, tx + 1.3, tz - 2.2, 0.7, me);
check('tower snaps to the tile, no rotation, may replace an own piece', pt.ok && pt.x === tx && pt.z === tz && pt.rot === 0 && !!pt.replace, { ok: pt.ok, rot: pt.rot, rep: !!pt.replace });
const tw = W.startConstruction(me, towerA, tx, tz, 0, []);
check('tower placed', typeof tw !== 'string', typeof tw === 'string' ? tw : [!!at(4, 2).tower, !!at(4, 2).wall, at(4, 2).tower === tw]);
check('tower joins the line (pieces keep their arms to it)', at(4, 2).tower === tw && !at(4, 2).wall && (mask(4, 1) & 64) && (mask(4, 3) & 4), [mask(4, 1), mask(4, 3)]);
// 7. a destroyed piece: neighbours drop their arm, no ruin
const victim = at(0, 0) && at(0, 0).wall;   // west end (wing? no: wing is tile 1)
W.kill(victim, null);
check('destroyed piece: no ruin, freed tile', !victim.ruin && !at(0, 0), { ruin: !!victim.ruin });
// 8. towers are not "walls" for targeting
check('wallKind', G.data.def('hu_small_tower', me).wallKind === 'tower' && G.data.def('hu_palisade', me).wallKind === 'wall' && G.data.def('hu_palisade_gate', me).wallKind === 'gate', null);
} catch (e) { out.push('ERROR ' + e.message + ' ' + (e.stack || '').split('\n')[1]); }
return out.join('\n');
