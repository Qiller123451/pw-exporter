// The sequel campaign (docs/SEQUEL.md): a mission loads, its script runs a while without errors, and the missions
// with a signature mechanic have it played by script - 1: a stabilizer seals the rift, 3: a tranquilized dinosaur
// is carried to the pen, 5: the rocket lifts off when the count reaches zero, 6: a net holds Big Tooth for the darts,
// 7: London - the bridge over the river, the rift sealed, Taslov to the archive, Crane's landing, the steamer away.
// python3 tests/evaljs.py tests/sequel.js "&sequel=3"
const M = G.sequel, W = G.world, me = G.me, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
check('the mission is a sequel mission', !!M && M.started, M && { id: M.id, started: M.started });
if (!M) return out.join('\n');
check('it has objectives', M.objectives.length > 0, M.objectives.map((o) => o.id));
check('the player has an army', M.units('me').length >= 5, M.units('me').length);
check('the command powers are offered', !!G.sequelUI && Object.keys(M.def.powers || {}).length > 0);
// the base has its own stone and food (game/sequel/maps.js: every deposit of the mission's resources is placed)
const hq = W.buildings.find((b) => b.owner === me && b.name === 'seas_headquarters');
if (hq) {
  const near = (res) => W.resources.filter((r) => r.res === res && r.type !== 'tree' && Math.hypot(r.pos.x - hq.pos.x, r.pos.z - hq.pos.z) < 90).length;
  check('stone and food near the headquarters', near('stone') >= 3 && near('food') >= 3, { stone: near('stone'), food: near('food') });
}
// the sequel's classes have texts of their own (game/sequel/texts.js) and their machines and buildings cards of their own
// (pipeline/sequel_assets.py: assets/ui/atlas.json)
const own = ['sq_jeep', 'sq_power_pole', 'sq_shock_trooper', 'sq_tesla_coil', 'sq_rift'];
check('own texts', own.every((n) => /^\u2022/.test(G.data.text(n).medium || '') && G.data.text(n).long), own.filter((n) => !G.data.text(n).long));
const atlas = await (await fetch('assets/ui/atlas.json')).json();
check('own cards', own.every((n) => atlas[n]), own.filter((n) => !atlas[n]));
// what the campaign has brought in so far can be built, what later missions bring in not yet (missions.js unlocks)
const buildable = new Set();
for (const e of [...W.units, ...W.buildings]) if (e.owner === me && e.alive) for (const a of G.data.actionsOf(me, e)) if (a.kind === 'Build' && G.data.check(me, a) !== 'hidden') buildable.add(a.results[0].obj);
const mine = (M.def.unlocks || []).map((u) => (Array.isArray(u) ? u[0] : u));
check('this mission\'s new units and buildings can be built', mine.every((n) => buildable.has(n)), mine.filter((n) => !buildable.has(n)));
check('later missions\' cannot yet', [...M.locked].every((n) => !buildable.has(n)), [...M.locked].filter((n) => buildable.has(n)));
const errs = [];
const run = (n) => { try { G.step(n, 0.1); } catch (e) { errs.push(String(e.stack || e).slice(0, 300)); } };
run(300);
check('30 seconds pass without errors', !errs.length, errs.slice(0, 2));
check('the mission is not lost at once', !M.ended || M.ended.won, M.ended);

if (M.id === 1) {
  // a stabilizer by the rift seals it once the rift has opened (the army keeps the creatures off)
  run(600);
  const r = M.rifts[0];
  check('the rift by the mine opens', !!r && r.open, r && r.id);
  if (r) {
    const b = M.building('sq_stabilizer', 'me', r.x - 20, r.z + 14, 0);
    // (Colonel Halloran stays out of it: his death loses the mission and the game stops 3 s later - the failed runs
    // had the seal standing still at 46 - 47 of its 60 s, one passing run was lost at 157 s)
    for (const u of M.units('me', (u) => !u.isWorker && u.name !== 'sq_halloran')) W.teleport(u, r.x - 25 + Math.random() * 10, r.z + 20 + Math.random() * 10);
    for (let k = 0; k < 12 && r.open; k++) run(100);
    check('the stabilizer seals the rift', !r.open && b.alive, { seal: Math.round(r.seal), hp: Math.round(b.hp), ended: M.ended || null });
    // the townsfolk objective says how many were lost and how many are still out (runtime.js civStatus)
    const ev = M.objectives.find((o) => o.id === 'evac');
    check('the townsfolk line counts the lost and those still out', ev && /\d+ lost · \d+ still out/.test(ev.note || '') || (ev && ev.done), ev && ev.note);
    run(1600);
    check('the seal objective completes (also when the rift closed before it was given)', M.isDone('seal'), M.objectives.map((o) => o.id + (o.done ? '+' : '')));
  }
}
if (M.id === 3) {
  // tranquilizer marksmen put a dinosaur to sleep, the capture truck loads it and unloads it in the pen
  const dino = M.units('outbreak', (u) => u.cls === 'ANML')[0];
  const tq = M.units('me', (u) => u.name === 'sq_tranq'), truck = M.units('me', (u) => u.name === 'sq_capture_truck')[0];
  check('there are a dinosaur, marksmen and a truck', !!dino && tq.length > 0 && !!truck);
  if (dino && tq.length && truck) {
    for (const u of tq) W.teleport(u, dino.pos.x - 25, dino.pos.z + (Math.random() - 0.5) * 8);
    G.order(tq, { type: 'attack', target: dino });
    for (let k = 0; k < 30 && !(dino.sqTranq > W.time); k++) run(10);
    check('a dart tranquilizes it (the debuff, its icon)', dino.sqTranq > W.time && (W.data.extra.buffs || []).some((b) => b.attrib === 'sq_tranquilized'));
    // a killing blow from any weapon while tranquilized: asleep at 1 hit point
    W.damage(dino, dino.hp + 500, M.units('me', (u) => u.name !== 'sq_tranq' && u.cls === 'CHTR')[0] || null);
    check('a killing blow while tranquilized: asleep at 1 hit point', dino.alive && dino.hp === 1 && dino.sqAsleep > M.time, { hp: dino.hp });
    W.damage(dino, 50, null);
    check('asleep it stays at 1 hit point', dino.alive && dino.hp === 1);
    const other = M.units('outbreak', (u) => u.cls === 'ANML' && u !== dino && !(u.sqTranq > W.time))[0];
    if (other) { W.damage(other, other.hp + 500, null); check('without a dart a killing blow kills', !other.alive); }
    W.teleport(truck, dino.pos.x - 15, dino.pos.z);
    G.order([truck], { type: 'move', x: dino.pos.x, z: dino.pos.z });
    for (let k = 0; k < 30 && !M.cargo.length; k++) run(10);
    check('the truck loads it', M.cargo.length === 1);
    const pen = M.zones.pen;
    G.order([truck], { type: 'move', x: pen.x, z: pen.z });
    for (let k = 0; k < 120 && M.cargo.length; k++) run(10);
    check('it is unloaded in the pen and is ours', !M.cargo.length && dino.owner === me && M.counters.captured >= 1, { owner: dino.owner && dino.owner.name, captured: M.counters.captured });
  }
}
if (M.id === 6) {
  // an electrified net holds Big Tooth, and the darts then put it to sleep quickly
  const b = M.state.boss, tq = M.units('me', (u) => u.name === 'sq_tranq');
  const net = M.building('sq_electric_net', 'me', b.pos.x + 6, b.pos.z, 0);
  run(10);
  check('the net catches Big Tooth', b.sqStunned > M.time && net.sqZapT > M.time, { stunned: b.sqStunned, t: M.time });
  for (const u of tq) W.teleport(u, b.pos.x - 22, b.pos.z + (Math.random() - 0.5) * 8);
  G.order(tq, { type: 'attack', target: b });
  for (let k = 0; k < 15 && !(b.sqTranq > W.time); k++) run(10);
  const h0 = b.hp;
  M.damageHook(10, tq[0], b);
  check('held by the net a dart hits five times as hard', b.sqTranq > W.time && h0 - b.hp >= 50, { lost: h0 - b.hp });
  W.damage(b, b.hp + 1000, null);
  check('the killing blow puts it to sleep', b.alive && b.hp === 1 && b.sqAsleep > M.time, { hp: Math.round(b.hp) });
}
if (M.id === 5) {
  const pad = M.state.pad;
  check('the launch pad stands', !!pad && pad.alive);
  M.time = M.state.launch - 0.5;
  run(20);
  check('lift-off when the count reaches zero', M.state.won && M.isDone('pad'), M.objectives.map((o) => o.id + (o.done ? '+' : '')));
  run(150);
  check('the mission is won', !!M.ended && M.ended.won, M.ended);
}
if (M.id === 7) {
  // the city (art/sequel/london.py, houses.py; missions.js 7): the Society, the wheel turning, houses that block, the bridge
  const has = (m) => (G.props && G.props.kinds && G.props.kinds.has(m)) || false;
  const rows = ['14_1', '14_2', '14_3', '14_4', '21_1', '21_2', '21_3', '21_4', '21_5', '21_6', '28_1', '28_2', '28_3', '28_4'].filter((r) => has('sq_row' + r));
  const corners = ['dome', 'turret', 'curve', 'chamfer'].filter((c) => has('sq_corner_' + c));
  check('the Society, the wheel, the bridge and the houses stand (rows of every length, every corner)', ['sq_society', 'sq_wheel_frame', 'sq_bridge', 'sq_quay'].every(has)
    && ['14', '21', '28'].every((w) => rows.some((r) => r.startsWith(w))) && rows.length >= 10 && corners.length === 4,
  { missing: ['sq_society', 'sq_wheel_frame', 'sq_bridge', 'sq_quay'].filter((m) => !has(m)), rows, corners });
  const wheel = M.pieces.find((p) => p.id === 'wheel');
  G.sequelUI.effects(0);
  const o = G.sequelUI.pieceObjs && G.sequelUI.pieceObjs.get(wheel), a0 = o ? o.userData.inner.rotation.z : null;
  G.sequelUI.effects(1);
  check('the wheel\'s rim turns, high over the embankment', !!o && o.userData.inner.rotation.z !== a0 && o.position.y > 40, o && [o.userData.inner.rotation.z, o.position.y]);
  check('a house blocks the way (its walls: pf boxes)', !W.nav.isFree(-150, 36) && W.nav.isFree(-150, 20), [W.nav.isFree(-150, 36), W.nav.isFree(-150, 20)]);
  const path = W.nav.find(200, -40, 200, -246, 0.7, 60000, me);
  const P = (path || []).map((p) => (Array.isArray(p) ? p : [p.x, p.z]));
  check('the bridge carries the way over the river', !!path && P.every(([x, z]) => z > -95 || z < -205 || Math.abs(x - 200) < 8), path && P.length);
  check('the water is not walkable beside it', !W.nav.isFree(150, -150) && !W.nav.isFree(250, -150));
  // the tear by the wheel: a stabilizer seals it, Taslov goes in to the archive
  run(900);
  const r = M.rifts[0];
  check('the rift by the wheel opens', !!r && r.open, r && r.id);
  const t = M.state.taslov;
  if (r) {
    const b = M.building('sq_stabilizer', 'me', r.x, r.z + 26, 0);
    for (const u of M.units('me', (u) => !u.isWorker && u.name !== 'sq_halloran' && u.name !== 'sq_taslov')) W.teleport(u, r.x - 10 + Math.random() * 20, r.z + 12 + Math.random() * 10);
    for (let k = 0; k < 16 && r.open; k++) run(100);
    check('the stabilizer seals it', !r.open && M.isDone('rift'), { seal: Math.round(r.seal), hp: b && Math.round(b.hp) });
  }
  if (t && t.alive) W.teleport(t, 100, 22);
  for (let k = 0; k < 30 && !M.state.inside; k++) run(10);
  check('Taslov goes into the Society to the archive', !!M.state.inside && !t.alive, { inside: M.state.inside });
  check('the archive objective', M.objectives.some((x) => x.id === 'society'), M.objectives.map((x) => x.id));
  // Crane's landing at the river stairs: the boats come, his men come up; the army holds the back of the house
  for (const u of M.units('me', (u) => !u.isWorker && u.name !== 'sq_halloran')) W.teleport(u, 100 + (Math.random() - 0.5) * 30, -40 + Math.random() * 8);
  for (let k = 0; k < 40 && !M.state.landed; k++) run(20);
  check('Crane\'s men land at the stairs', !!M.state.landed && M.units('crane').length > 0, { landed: M.state.landed, crane: M.units('crane').length, pieces: M.pieces.map((p) => p.id) });
  // the townsfolk over the bridge (the test walks them there)
  for (const u of W.units) if (u.alive && u.owner === M.player('civilians')) { u.sqRescued = true; u.sqHiding = false; W.teleport(u, 200, -238); }
  run(40);
  check('the townsfolk are safe', M.isDone('evac'), M.objectives.map((x) => x.id + (x.done ? '+' : '')));
  M.state.archiveEnd = M.time + 1;
  run(30);
  check('Taslov is taken: the steamer sails', !!M.state.taken && M.isDone('society') && !!M.pieces.find((p) => p.id === 'steamer' && p.path), M.pieces.map((p) => p.id));
  for (let k = 0; k < 10 && !M.ended; k++) run(50);
  check('the mission is won', !!M.ended && M.ended.won, M.ended);
}
check('no errors', !errs.length, errs.slice(0, 2));
return out.join('\n');
