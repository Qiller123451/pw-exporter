// Every mission of the sequel (game/sequel/missions.js 1-11, missions_1966.js 12-16) played through by script: the
// player's side cannot be hurt, the fights are won by killing what stands in the way, the heroes and townsfolk are
// put where the story needs them - and each mission must end in a win. With the sequel's art missing (a test
// install), &stubart=1. env PWR_PORT=<MIRAGE server> python3 tests/evaljs.py tests/sequel_flow.js "&sequel=N&stubart=1" (N 1-16)
const S = G.sequel, W = G.world, me = G.me, out = [];
const sec = (s) => G.step(Math.round(s * 20));
const P = (r) => S.player(r);
const mine = (f) => W.units.filter((u) => u.alive && u.owner === me && (!f || f(u)));
const guard = () => { for (const u of mine()) if (!(u.invulnT > 0)) W.setInvulnerable(u, true); };
const kill = (list) => { for (const e of list) if (e && e.alive) W.kill(e, null); };
const foes = (role, f) => W.units.filter((u) => u.alive && u.owner === P(role) && (!f || f(u)));
const hero = (n) => mine((u) => u.name === n)[0];
const tp = (u, x, z) => { if (u) W.teleport(u, x, z); };
const objs = () => S.objectives.map((o) => o.id + (o.done ? '+' : o.failed ? 'x' : '')).join(',');
let ok = true;
const check = (what, c) => { out.push(`${what}: ${c ? 'ok' : 'FAIL'}`); if (!c) ok = false; };
const id = S.id;
guard();
// helpers for the townsfolk, rifts and captures
const civs = (f) => W.units.filter((u) => u.alive && u.owner === P('civilians') && (!f || f(u)));
const evac = (zone, n = 99) => { const Z = S.zones[zone]; for (const u of civs().slice(0, n)) { u.sqRescued = true; u.sqHiding = false; u.untargetable = false; W.teleport(u, Z.x + Math.random() * 4, Z.z + Math.random() * 4); } sec(2); };
const seal = (r) => { const b = W.placeBuilding('sq_stabilizer', me, r.x + 12, r.z + 6, 0, true); if (b) W.setInvulnerable(b, true); return b; };
const capture = (V, pen) => {
  if (!V || !V.alive) return false;
  S.sleep(V); const t = S.spawn('sq_capture_truck', 'me', V.pos.x + 4, V.pos.z, 1)[0]; guard(); sec(1);
  W.teleport(t, pen.x, pen.z); sec(1.5); return true;
};
const clearOut = () => { kill(foes('outbreak')); };

if (id === 1) {
  evac('buses', S.state.need + 2);
  sec(155);
  check('rift and Taslov', S.rifts.length === 1 && !!hero('sq_taslov'));
  seal(S.rifts[0]); for (let k = 0; k < 16 && S.rifts[0].open; k++) { clearOut(); sec(5); }
  check('rift sealed', !S.rifts[0].open);
  sec(15);
} else if (id === 2) {
  W.setInvulnerable(S.state.station, true);
  for (let k = 0; k < 75 && !S.ended; k++) { clearOut(); sec(10); }
} else if (id === 3) {
  const pen = S.zones.pen;
  for (let k = 0; k < 40 && !S.isDone('capture'); k++) {
    const V = foes('outbreak', (u) => /ceratops|Styraco/.test(u.name) && !u.parked)[0];
    if (V) capture(V, pen); else sec(10);
    for (const u of foes('outbreak', (q) => !q.parked && !(q.sqAsleep > S.time) && !/ceratops|Styraco/.test(q.name))) W.kill(u, null);
  }
  check('captured', S.isDone('capture'));
  sec(12);
} else if (id === 4) {
  for (const r of S.rifts) seal(r);
  for (let k = 0; k < 20 && S.rifts.some((r) => r.open); k++) { clearOut(); sec(5); }
  check('rifts sealed', S.rifts.every((r) => !r.open));
  sec(12);
} else if (id === 5) {
  W.setInvulnerable(S.state.pad, true);
  for (let k = 0; k < 95 && !S.ended; k++) { clearOut(); sec(10); }
} else if (id === 6) {
  sec(3);
  check('caught', capture(S.state.boss, S.zones.pen));
  sec(12);
} else if (id === 7) {
  evac('bridge');
  seal(S.rifts[0]); for (let k = 0; k < 18 && S.rifts[0].open; k++) { clearOut(); sec(5); }
  check('rift sealed', !S.rifts[0].open);
  tp(S.state.taslov, 100, 13); sec(2);
  check('Taslov in the archive', !!S.state.inside);
  for (let k = 0; k < 50 && !S.ended; k++) { kill(foes('crane')); clearOut(); sec(5); }
  check('Taslov taken (the story)', !!S.state.taken);
} else if (id === 8) {
  tp(hero('sq_halloran'), 188, -172); sec(2);
  check('Taslov freed', S.isDone('taslov'));
  kill([S.state.hq]); sec(15);
} else if (id === 9) {
  tp(hero('sq_halloran'), 150, -150); sec(2);
  check('met Tala', S.isDone('meet'));
  W.setInvulnerable(S.state.ajeHq, true);
  kill([S.state.craneHq]); sec(15);
} else if (id === 10) {
  const t = hero('sq_taslov');
  tp(t, 158, -150); sec(2);
  check('at the temple', S.isDone('temple'));
  for (let k = 0; k < 40 && !S.isDone('core'); k++) { clearOut(); kill(foes('crane')); tp(t, 158, -150); sec(5); }
  check('core', S.isDone('core'));
  tp(t, -205, 205); sec(12);
} else if (id === 11) {
  W.setInvulnerable(S.state.machine, true);
  for (let k = 0; k < 125 && !S.ended; k++) { clearOut(); kill(foes('crane')); sec(10); }
} else if (id === 12) {
  const st = S.state, n0 = mine().length;
  for (const d of st.districts) {
    kill(d.us);
    for (const h of ['sq_halloran', 'sq_booker', 'sq_tala']) tp(hero(h), d.x + Math.random() * 6, d.z + Math.random() * 6);
    if (d.tame) { sec(2); tp(hero('sq_booker'), 160, -118); }
    sec(3); guard();
  }
  check('districts', S.isDone('districts'));
  check('holdouts joined', mine().length >= n0 + 5 + 3 + 3 + 2);
  check('triceratops tamed', mine((u) => u.name === 'Triceratops').length === 2);
  check('Old Scar objective', S.objectives.some((o) => o.id === 'scar'));
  kill([st.boss]); sec(15);
} else if (id === 13) {
  const st = S.state;
  for (let k = 0; k < 120 && !S.ended; k++) {
    kill(foes('outbreak')); kill(foes('crane')); kill(W.buildings.filter((b) => b.alive && b.owner === P('crane')));
    const lead = st.trucks.find((t) => t.alive);
    if (lead) for (const u of mine((q) => q.name !== 'sq_cargo_truck')) if (Math.hypot(u.pos.x - lead.pos.x, u.pos.z - lead.pos.z) > 30) tp(u, lead.pos.x + 8, lead.pos.z + 8);
    guard(); sec(5);
  }
  check('trucks delivered', st.delivered >= st.need);
  out.push(`delivered ${st.delivered}, legs to ${st.lead}`);
} else if (id === 14) {
  const st = S.state;
  sec(5);
  check('three engines', st.sites.every((s) => s.engine && s.engine.alive));
  const w = st.sites[0];
  kill([w.engine]); sec(3);
  check('rift shut with its engine', !w.rift.open);
  sec(130);
  check('engine raised again while the station runs', w.raised === 2 && w.rift.open);
  kill([st.station]); sec(3);
  check('station down: all engines dark', S.isDone('engines') && st.sites.every((s) => !s.rift.open && !(s.engine && s.engine.alive)));
  kill([st.hq]); sec(15);
} else if (id === 15) {
  const st = S.state;
  for (const k of st.cages) {
    kill(S.near(k.x, k.z, 40, 'crane'));
    tp(hero('sq_tala'), k.x + 4, k.z + 4);
    sec(2);
  }
  check('cages opened', S.isDone('cages'));
  check('riders joined', mine((u) => /^aje_/.test(u.name)).length >= 15);
  sec(4 * 60 - S.time + 5);
  check('a wave came through the engine', st.waves >= 1);
  kill([st.engine]); sec(2);
  check('engine objective', S.isDone('engine'));
  kill([st.hq]); sec(15);
} else if (id === 16) {
  const st = S.state;
  W.setInvulnerable(st.door, true);
  sec(160);
  check('the Door hijacked', st.wild && st.wild.open);
  sec(8 * 60 - S.time + 3);
  check('Behemoth shielded', st.boss && st.boss.invulnT > 0);
  out.push(`caravans ${st.caravans}, arrived ${st.arrived}`);
  kill(st.masts); sec(3);
  check('masts down', S.isDone('masts') && !st.wild.open && !st.boss.invulnT);
  kill([st.boss]); sec(2);
  check('Crane out of the wreck', st.crane && st.crane.alive);
  if (st.crane) W.setInvulnerable(st.crane, true);
  tp(hero('sq_halloran'), st.crane.pos.x + 3, st.crane.pos.z); sec(2);
  check('Crane taken', S.isDone('crane'));
  sec(15);
}
check('won', !!S.ended && S.ended.won);
out.push(objs());
return (ok ? 'ok ' : 'FAIL ') + `sequel ${id}: ` + out.join(' | ');
