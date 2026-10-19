// The Dragon Clan computer player's mine belts (ai/mines.js; AiGoalBuildMineBelts.usl, the server's CAiMineMgr):
// the positions off the home island's coast, one minelayer laying a belt of five queued mines, the next belt on the
// next free positions.
//   python3 tests/evaljs.py tests/ai_mines.js "&tribe=Hu&enemy=Ninigi&map=maps/Base/Multiplayer/multi_2_jun_001.ula"
const W = G.world, me = G.me, ai = W.players.find((p) => p !== me && p.tribe === 'Ninigi'), out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (s) => { for (let i = 0; i < s * 20; i++) G.step(1, 0.05); };
const B = ai && G.brains && G.brains.get(ai.id);
ok(!!B && !!W.waterNav, 'a Ninigi computer player on a water map');
if (!B) return out.join('\n');
run(2);
const S = B.census();
const pos = B.minePositions() || [];
const st = B.start;
const shores = B.mineShoreList || [];
out.push('   ' + JSON.stringify(B.mineDbg));
ok(shores.length > 0 && pos.length >= 5, `shores of the home island with mine positions (${shores.length} shores, ${pos.length} positions)`, shores.map((s) => [Math.round(s.distance), s.mines.length]));
ok(pos.every((m) => W.isWater(m.x, m.z, 1.5)), 'every position is in deep water');
ok(pos.every((m) => Math.abs(((m.x + W.nav.half) / 20) % 1) < 1e-6 && Math.abs(((m.z + W.nav.half) / 20) % 1) < 1e-6), 'on the 20 m lattice');
ok(shores.every((s) => s.distance <= 400) && pos.every((m, i) => i === 0 || pos[i - 1].dist <= m.dist), 'shores at most 400 m by land from the start, the nearest first');
if (pos.length < 5) return out.join('\n');
const dmax = Math.max(...pos.map((m) => Math.hypot(m.x - st.x, m.z - st.z)));
ok(dmax < 520, 'all within reach of the village', Math.round(dmax));
// a minelayer of the AI, the goal's think by hand
for (const k of ['wood', 'stone']) { ai.res[k] = 3000; ai.caps[k] = 1e5; }
const p0 = pos[0];
const L = W.spawnUnit('ninigi_minelayer', ai, p0.x, p0.z, 1, 0);
ok(!!L, 'a minelayer');
const before = W.units.filter((u) => u.alive && u.name === 'ninigi_mineship_mine').length;
ok(B.mineBeltsOn({ age: 2 }) && !B.mineBeltsOn({ age: 1 }), 'the goal runs from epoch 2 on a multiplayer water map', B.mineWait());
B.mineBeltThink(B.census(true));
ok(B.mineGoal.layer === L && L.task.type === 'lay' && L.task.next.length === 4, 'the layer has a belt of five mines, four of them queued', { state: B.mineGoal.state, task: L.task.type, next: L.task.next && L.task.next.length, group: B.nextMineGroup(5).length });
if (L.task.type !== 'lay') return out.join('\n');
const first = [L.task, ...L.task.next].map((t) => [t.x, t.z]);
ok(first.every(([x, z]) => pos.some((m) => m.x === x && m.z === z && m.shore === pos[0].shore)), 'all five on the first shore');
for (let i = 0; i < 40 && L.task.type === 'lay'; i++) { for (const k of ['wood', 'stone']) ai.res[k] = Math.max(ai.res[k], 1000); run(5); }   // (the computer player spends what it has meanwhile)
// (each where it was meant to go, or the nearest free cell of the ship grid - a few metres - when that one is blocked)
const mines = W.units.filter((u) => u.alive && u.name === 'ninigi_mineship_mine' && u.owner === ai);
ok(mines.length - before >= 5 && first.every(([x, z]) => mines.some((m) => Math.hypot(m.pos.x - x, m.pos.z - z) < 6)), `the belt is laid (${mines.length - before} mines)`, first.map(([x, z]) => Math.round(Math.min(...mines.map((m) => Math.hypot(m.pos.x - x, m.pos.z - z))))));
B.mineBeltThink(B.census(true));
ok(B.mineGoal.state === 'belt' && L.task.type === 'idle' || ai.canAfford({ wood: 250, stone: 250 }), 'without 50 wood and 50 stone per mine the next belt waits', ai.res.wood);
for (const k of ['wood', 'stone']) ai.res[k] = 3000;
B.mineBeltThink(B.census(true));
const next = L.task.type === 'lay' ? [L.task, ...L.task.next] : [];
ok(B.mineGoal.belts === 1 && next.length > 0 && next.every((t) => !first.some(([x, z]) => x === t.x && z === t.z)), 'the next belt goes to the next free positions', { n: next.length, st: B.mineGoal.state, belts: B.mineGoal.belts, task: L.task.type, g: B.nextMineGroup(5).length, wood: ai.res.wood });
return out.join('\n');
