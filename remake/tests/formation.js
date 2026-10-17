// Group walks in formation (game/formation.js, ui/input.js moveGroup / the right-drag arrow): ranged units behind,
// close combat in front, workers at the back; the arrow sets the facing.   python3 tests/evaljs.py tests/formation.js "&tribe=Hu&enemy=Aje"
const W = G.world, me = G.me, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (s) => { for (let i = 0; i < s * 20; i++) G.step(1, 0.05); };
G.aiBrain.update = () => {}; if (G.meBrain) G.meBrain.update = () => {};
const X = -40, Z = 40;
for (const u of W.units) if (u.alive && u.owner !== me && Math.hypot(u.pos.x - X, u.pos.z - Z) < 120) W.removeEntity(u);   // (the wild animals there)
const mk = (n, i) => W.spawnUnit(n, me, X + (i % 4) * 2, Z + Math.floor(i / 4) * 2);
const units = [...[0, 1, 2, 3].map((i) => mk('hu_warrior', i)), ...[4, 5, 6, 7].map((i) => mk('hu_archer', i)), mk('hu_worker', 8)];
for (const u of units) u.stance = 3;
const tx = X + 40, tz = Z;
G.input.moveGroup(units, tx, tz, 'move');             // facing from the group to the point: +x
run(25);
const ahead = (u) => u.pos.x - tx;                    // along the facing
const war = units.filter((u) => u.name === 'hu_warrior'), arc = units.filter((u) => u.name === 'hu_archer'), wk = units.find((u) => u.name === 'hu_worker');
const avg = (l) => l.reduce((s, u) => s + ahead(u), 0) / l.length;
check('everybody arrived', units.every((u) => Math.hypot(u.pos.x - tx, u.pos.z - tz) < 12), units.map((u) => Math.round(Math.hypot(u.pos.x - tx, u.pos.z - tz))));
check('close combat in front of the archers', avg(war) > avg(arc), { warriors: avg(war), archers: avg(arc) });
check('the worker at the back', ahead(wk) <= Math.min(...arc.map(ahead)) + 0.5, { worker: ahead(wk) });
// the arrow: facing -z from a press point; spacing grows with its length
const m = G.input.mouse;
G.select(units);
m.rg = { x: X, z: Z + 20 }; m.rdown = true;
G.input.dragArrow = G.input.dragArrow.bind(G.input);
const gp = G.input.groundPoint; G.input.groundPoint = () => ({ x: X, z: Z + 20 - 30 });
G.input.dragArrow(0, 0);
const a = m.arrow;
check('a drag of more than 2 m makes an arrow', !!a && a.slots.length === units.length, a && { len: a.len, spacing: a.spacing });
G.input.groundPoint = () => ({ x: X, z: Z + 20 - 6 }); G.input.dragArrow(0, 0);
const short = m.arrow.spacing;
check('a short arrow: close ranks', short < a.spacing, { short, long: a.spacing });
G.input.groundPoint = () => ({ x: X, z: Z + 20 - 30 }); G.input.dragArrow(0, 0);
G.input.onUp({ button: 2, shiftKey: false, ctrlKey: false });
G.input.groundPoint = gp;
run(25);
const f = (u) => -(u.pos.z - (Z + 20));               // the arrow points to -z
const avg2 = (l) => l.reduce((s, u) => s + f(u), 0) / l.length;
check('the group lines up at the press point facing the arrow', avg2(war) > avg2(arc) && units.every((u) => Math.hypot(u.pos.x - X, u.pos.z - Z - 20) < 20), { warriors: avg2(war), archers: avg2(arc) });
// Shift: a waypoint after the walk; Ctrl: patrol
const u = war[0];
W.order([u], { type: 'move', x: X, z: Z });
check('Shift + right-click queues', W.queueOrder(u, { type: 'move', x: X + 10, z: Z }) && u.task.then && u.task.then.x === X + 10);
W.order([u], { type: 'patrol', pts: [[u.pos.x, u.pos.z], [X + 15, Z]], i: 1 });
run(20);
check('patrol goes to and fro', u.task.type === 'attackmove' && u.task.then && u.task.then.type === 'patrol', u.task.type);
return out.join('\n');
