// The sequel's tranquilizers and capture trucks (game/sequel/runtime.js sleep / captureTick / damageHook, ui/input.js
// sequelClick): darts wear a creature down to sleep at 1 hit point; nobody attacks a sleeper and no blow reaches it;
// a right-click with a capture truck loads it, at the pen it becomes the player's.
//   python3 tests/evaljs.py tests/sequel_capture.js "&sequel=3"        (MIRAGE data: PWR_PORT of the sequel server)
const W = G.world, S = G.sequel, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const ob = S.player('outbreak');
let V = null;
const step = (n) => { for (const u of W.units) if (u.alive && u.owner === ob && u !== V) W.removeEntity(u); G.step(n, 0.1); };   // (no rift waves)
const tr = W.units.filter((u) => u.alive && u.owner === G.me && u.name === 'sq_tranq');
const trucks = W.units.filter((u) => u.alive && u.owner === G.me && /capture/.test(u.name)), truck = trucks[0];
for (const x of trucks) W.teleport(x, x.pos.x - 70, x.pos.z + 40);          // out of the fight
V = W.spawnUnit('Triceratops', ob, tr[0].pos.x + 30, tr[0].pos.z, 2);
W.order(tr, { type: 'attack', target: V });
let t = 0;
for (; t < 120 && !(V.sqAsleep > S.time); t++) step(10);
ok(V.alive && V.sqAsleep > S.time && V.hp === 1, 'the darts put it to sleep at 1 hit point', { s: t, hp: V.hp });
step(20);
const on = W.units.filter((u) => u.alive && u !== V && u.task && u.task.target === V);
ok(!on.length, 'nobody attacks the sleeper', on.map((u) => [u.name, u.owner && u.owner.name, u.task.type]));
const hp = V.hp; W.damage(V, 500, tr[0]);
ok(V.alive && V.hp === hp, 'no blow reaches it');
G.sel.clear(); G.sel.add(truck);
G.input.orderOn(V, { x: V.pos.x, z: V.pos.z }, false);
for (t = 0; t < 60 && !S.cargo.length; t++) step(10);
ok(S.cargo.length === 1 && V.parked, 'the capture truck right-clicked on it loads it', t);
const pen = Object.values(S.zones).find((z) => z.kind === 'pen');
const carrier = S.cargo.length ? S.cargo[0][0] : truck;
W.order([carrier], { type: 'move', x: pen.x, z: pen.z });
for (t = 0; t < 120 && V.owner !== G.me; t++) step(10);
ok(V.owner === G.me && !V.parked && (S.counters.captured || 0) === 1, 'at the pen it becomes the player\'s', { t, truck: [carrier.alive, Math.round(carrier.pos.x), Math.round(carrier.pos.z), carrier.task.type], pen: [pen.x, pen.z] });
return out.join('\n');
