// Mission 16's gates (seas_endboss_gate: the SEAS gate's rig x 1.25, borrowing its clips): open at the start, and
// their doors sink all the way (the borrowed motion scaled with the rig: engine/assets.js retarget).
//   python3 tests/evaljs.py tests/gates_m16.js "&campaign=16&notriggers"
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const amp = (n) => { const t = W.template(n, true); if (!t) return 0; const c = t.clips.find((x) => x.name.toLowerCase() === 'open'); let m = 0; for (const tr of c.tracks) if (tr.name.endsWith('.position')) { const v = tr.values; for (let i = 3; i < v.length; i += 3) m = Math.max(m, Math.hypot(v[i] - v[0], v[i + 1] - v[1], v[i + 2] - v[2])); } return m; };
const a = amp('seas_gate'), b = amp('seas_endboss_gate');
ok(a > 0 && Math.abs(b / a - 1.25) < 0.01, 'the big gates\' doors move 1.25 x as far as a SEAS gate\'s', [+a.toFixed(2), +b.toFixed(2)]);
const gs = W.buildings.filter((x) => /endboss_gate|hq_gate/.test(x.name));
ok(gs.length === 4 && gs.every((g) => g.gateState === 0 && [...W.nav.gateAt.values()].includes(g)), 'all four gates are open and passable', gs.map((g) => [g.name, g.gateState]));
return out.join('\n');
