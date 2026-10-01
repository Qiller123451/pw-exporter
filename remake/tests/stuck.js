// Long AI-vs-AI run that watches for units stuck at buildings: a unit counts as stuck when it has a walking
// task (move / gather / build / deliver ...) and has not moved 0.5 m in 10 s. Run: evaljs.py tests/stuck.js "&aivai&tribe=X&enemy=Y"
const W = G.world, nav = W.nav;
const last = new Map(), still = new Map(), reports = [];
let blocked = 0;
for (let s = 0; s < 400 * 4; s++) {
  G.step(5, 0.05);
  for (const u of W.units) {
    if (!u.alive || u.inside || !u.owner) continue;
    if (nav.block[nav.idx(u.pos.x, u.pos.z)]) blocked++;
    const p = last.get(u);
    const walking = u.path && u.path.length > 0;
    if (p && walking && Math.hypot(u.pos.x - p[0], u.pos.z - p[1]) < 0.05) still.set(u, (still.get(u) || 0) + 0.25); else still.set(u, 0);
    last.set(u, [u.pos.x, u.pos.z]);
    if (still.get(u) === 10) {
      const b = W.buildings.filter((x) => x.alive).sort((a, c) => a.surfDist(u.pos.x, u.pos.z) - c.surfDist(u.pos.x, u.pos.z))[0];
      reports.push({ t: +W.time.toFixed(0), u: u.name, task: u.task.type + (u.task.phase ? '/' + u.task.phase : ''), near: b && b.name, dist: b && +b.surfDist(u.pos.x, u.pos.z).toFixed(1), path: u.path.length });
    }
  }
}
return JSON.stringify({ time: W.time, blocked, stuck: reports.length, reports: reports.slice(0, 25) });
