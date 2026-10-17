// Outposts of the computer player (ai/outposts.js): a stone outpost with its crew and buildings, the island
// surveillance that starts one, the campaign's outpost attack types.
//   python3 tests/evaljs.py tests/ai_outpost.js "&tribe=Hu&enemy=Aje&aid=6"   (the computer player: the enemy)
const W = G.world, D = G.data, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const B = (G.brains && G.brains.get ? G.brains.get(G.ai.id) : null) || G.aiBrain, p = B.p;
let err = null;
const upd = B.update.bind(B);
B.update = (dt) => { try { upd(dt); } catch (e) { if (!err) err = e.stack || String(e); } };
const step = (s, dt = 0.1) => { for (let i = 0; i < s; i += 5) { G.step(Math.min(50, Math.round((s - i) / dt)), dt); if (G.fx) G.fx.update(5); } };
for (const u of W.units) if (u.alive && u.wild) W.kill(u, null);
W.wildNests.length = 0;
B.setBehaviour('Giraffe');
B.prm.noFight = true;
step(20);
let S = B.census(true);
const a2 = B.acts(S.base).find((x) => x.id === 'age_2'); if (a2) W.completeUpgrade(S.base, a2);
for (const r of ['food', 'wood', 'stone']) p.res[r] = Math.max(p.res[r], 3000);
S = B.census(true);
// a free place 90 m from the village
const home = S.home;
let spot = null;
for (let a = 0; a < 24 && !spot; a++) { const x = home.x + Math.cos(a / 24 * 6.283) * 90, z = home.z + Math.sin(a / 24 * 6.283) * 90; if (W.nav.isFree(x, z) && W.landIsland(x, z) === W.landIsland(home.x, home.z) && !B.wallFoes(x, z, 60).length) spot = { x, z }; }
ok(!!spot, 'a free place 90 m away', spot);
B.isT = 1e9; B.atkOutpost = -1;                      // (only the outpost of this test)
const id = B.startOutpost(spot, 'OP_ResAll');
ok(id > 0, 'an OP_ResAll outpost starts', id);
const o = B.outposts.find((x) => x.id === id);
let t = 0;
for (; t < 300 && !(o && W.buildings.some((b) => b.alive && b.owner === p && Math.hypot(b.pos.x - spot.x, b.pos.z - spot.z) <= 60)); t += 10) { step(10); for (const r of ['food', 'wood', 'stone']) p.res[r] = Math.max(p.res[r], 2000); }
const crew = B.outpostUnits(o);
ok(crew.length >= 2, 'its crew (spawned once, plus pool units)', crew.map((u) => u.name));
ok(crew.filter((u) => Math.hypot(u.pos.x - spot.x, u.pos.z - spot.z) < 40).length >= 1, 'the crew is there', crew.map((u) => Math.round(Math.hypot(u.pos.x - spot.x, u.pos.z - spot.z))));
const blds = W.buildings.filter((b) => b.alive && b.owner === p && Math.hypot(b.pos.x - spot.x, b.pos.z - spot.z) <= 60);
ok(blds.length >= 1, `a building of its list stands there (${Math.round(t)} s)`, blds.map((b) => [b.name, b.built]));
S = B.census(true);
ok(!crew.some((u) => S.pool.includes(u) || S.workers.includes(u)), 'the crew is not the village\'s');
// the campaign's outpost attack
const before = B.outposts.length;
const r = B.startAttack({ type: 'AttackOutpost', targets: [S.base], position: { x: spot.x + 20, z: spot.z } });
ok(r === null || B.outposts.length === before + 1, 'AttackOutpost of a trigger starts an outpost (or meets the limit)', r);
ok(B.outpostStarts <= 5, 'at most five outposts', B.outpostStarts);
if (err) ok(false, 'brain error ' + err);
return out.join('\n');
