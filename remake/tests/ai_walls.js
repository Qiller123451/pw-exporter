// The computer player's village wall (ai/walls.js): a ring of segments around the village from epoch 3, gates in the
// longer segments, towers at their start, Hu / Aje archers on the wall near a gate; workers are not shut in.
//   python3 tests/evaljs.py tests/ai_walls.js "&tribe=Aje&enemy=Hu&aid=6"   (the computer player: the enemy)
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
B.mapOptions.walls = true;
step(20);
let S = B.census(true);
ok(!B.walls, 'no wall in the first epochs');
for (const id of ['age_2', 'age_3']) { const a = B.acts(S.base).find((x) => x.id === id); if (a) W.completeUpgrade(S.base, a); }
for (const r of ['food', 'wood', 'stone']) p.res[r] = Math.max(p.res[r], 4000);
S = B.census(true);
ok(S.age >= 3, 'epoch 3', S.age);
let t = 0;
for (; t < 900 && !(B.walls && B.walls.ring && B.walls.ring.length && B.walls.ring.every((s) => s.done)); t += 30) { step(30); for (const r of ['food', 'wood', 'stone']) p.res[r] = Math.max(p.res[r], 2000); }
const R = B.walls;
ok(R && R.ring && R.ring.length > 0, 'a ring around the village', R && R.ring && R.ring.map((s) => s.tiles.length));
if (R && R.ring) {
  const built = R.ring.reduce((n, s) => n + s.pieces.filter((b) => b.alive && b.built).length, 0), all = R.ring.reduce((n, s) => n + s.tiles.length, 0);
  ok(built >= all * 0.8, `its pieces stand (${built} of ${all}, ${Math.round(t / 60)} min)`, R.ring.map((s) => s.done));
  ok(R.ring.every((s) => s.tiles.length <= 12), 'segments of at most 12 tiles');
  out.push('   the wall class ' + R.cls);
  step(120);
  const gates = W.buildings.filter((b) => b.alive && b.owner === p && b.def.wallKind === 'gate');
  const long = R.ring.filter((s) => s.gate).length;
  ok(gates.length >= Math.min(1, long), `gates in the long segments (${gates.length} gates, ${long} segments of 4+ tiles)`);
  ok(gates.every((g) => gates.every((h) => g === h || Math.hypot(g.pos.x - h.pos.x, g.pos.z - h.pos.z) >= 24)), 'no gate within 24 m of another');
  const towers = R.ring.filter((s) => s.tower).length;
  ok(towers >= 1 || !R.ring.some((s) => !s.hole && s.tiles.length >= 3), 'towers at the start of long segments', towers);
  // nobody shut in: every worker finds a way to the village centre
  S = B.census(true);
  const shut = S.workers.filter((w) => { if (w.inside || w.onWall) return false; const g = B.guardPoint(S); W.nav.find(w.pos.x, w.pos.z, g.x, g.z, 0.7, 30000, p); return !W.nav.found; });
  ok(shut.length === 0, 'no worker is shut in', shut.length);
  // archers on the wall near a gate (Hu and Aje; a walkable wall: hu_small_wall, hu_re_enforced_wall, aje_clay_wall).
  // The ring's class may not be walkable yet (it is the best the tech tree allows): a walkable piece near a gate then
  if ((p.tribe === 'Hu' || p.tribe === 'Aje') && gates.some((g) => g.built)) {
    const WM = W.wallMap, g = gates.find((x) => x.built), wcls = p.tribe === 'Hu' ? 'hu_small_wall' : 'aje_clay_wall';
    if (!(W.data.extra.walkableWalls || []).includes(R.cls)) {
      const [gi, gj] = WM.tileOf(g.pos.x, g.pos.z);
      let put = null;
      for (let r = 2; r <= 4 && !put; r++) for (let dj = -r; dj <= r && !put; dj++) for (let di = -r; di <= r && !put; di++) {
        const [x, z] = WM.centre(gi + di, gj + dj);
        if (Math.hypot(x - g.pos.x, z - g.pos.z) < 30 && W.canPlace(wcls, x, z, 0, p)) put = W.placeBuilding(wcls, p, x, z, 0, true);
      }
      out.push('   a walkable piece near the gate: ' + (put ? put.name : 'none'));
    }
    const arch = p.tribe === 'Hu' ? 'hu_archer' : 'aje_archer', gp = B.guardPoint(B.census(true));
    for (let i = 0; i < 3; i++) W.spawnUnit(arch, p, gp.x + i * 2, gp.z, Math.max(1, D.minLevel(arch, p)));
    R.wantArchers = true;
    for (let k = 0; k < 8 && !(R.archers || []).some((u) => u.onWall); k++) step(15);
    ok((R.archers || []).some((u) => u.onWall), 'archers stand on the wall near a gate', (R.archers || []).map((u) => [u.name, !!u.onWall, u.task.type]));
  }
}
if (err) ok(false, 'brain error ' + err);
return out.join('\n');
