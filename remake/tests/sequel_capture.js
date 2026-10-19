// The sequel's tranquilizers and capture trucks (game/sequel/runtime.js sleep / captureTick / damageHook, ui/input.js
// sequelClick): darts wear a creature down to sleep at 1 hit point; nobody attacks a sleeper and no blow reaches it;
// a right-click with a capture truck loads it, at the pen it becomes the player's. The sleeper keeps lying (the rest
// clip's lying part loops) and gets up as the sleep ends; the pen is a ring of fences with a gate the truck drives
// through.
//   python3 tests/evaljs.py tests/sequel_capture.js "&sequel=3"        (MIRAGE data: PWR_PORT of the sequel server)
const W = G.world, S = G.sequel, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const ob = S.player('outbreak');
let V = null;
let V2 = null;
const step = (n) => { for (const u of W.units) if (u.alive && u.owner === ob && u !== V && u !== V2) W.removeEntity(u); G.step(n, 0.1); };   // (no rift waves)
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
ok(V.anim.curName === 'rest' && V.anim.phase === 'l', 'and it keeps lying (the lying part of its rest clip loops)', [V.anim.curName, V.anim.phase]);
const fences = W.buildings.filter((b) => b.alive && b.owner === G.me && b.name === 'seas_fence'), gate = W.buildings.find((b) => b.alive && b.owner === G.me && b.name === 'seas_gate');
ok(fences.length >= 15 && !!gate && [...W.nav.gateAt.values()].includes(gate), 'the pen: a ring of fences with a gate', { fences: fences.length, gate: !!gate });
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
ok(V.owner === G.me && !V.parked && (S.counters.captured || 0) === 1 && Math.hypot(carrier.pos.x - gate.pos.x, carrier.pos.z - gate.pos.z) < 30, 'through the gate: at the pen it becomes the player\'s', { t, truck: [carrier.alive, Math.round(carrier.pos.x), Math.round(carrier.pos.z), carrier.task.type], pen: [pen.x, pen.z] });
// a sleeper gets up as its sleep ends
V2 = W.spawnUnit('Triceratops', ob, pen.x + 60, pen.z, 2);
S.sleep(V2, 8);
step(30);
ok(V2.anim.phase === 'l', 'a sleeper lies', V2.anim.phase);
for (t = 0; t < 12 && !V2.sqWaking; t++) step(5);
const getUp = V2.sqAsleep - S.time;
ok(V2.sqWaking && getUp > 0 && V2.anim.phase === 'e', 'it gets up before the sleep is over', +getUp.toFixed(1));
step(60);
ok(!V2.sqAsleep && V2.anim.curName !== 'rest', 'and is up again', V2.anim.curName);
return out.join('\n');
