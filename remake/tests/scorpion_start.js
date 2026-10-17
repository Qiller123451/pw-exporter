// Mission 16 at the start (Building.usl CScorpionBoss.OnInit): the Scorpion sleeps crouched in its huts (first frame of
// "stand_up") until the mission wakes it, then stands up and fights; the gates the map stores open show open even
// when they opened far from the camera (main.js freezeStill: the pose of a finished animation).
//   python3 tests/evaljs.py tests/scorpion_start.js "&campaign=16&notriggers"
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const s = W.buildings.find((b) => b.alive && b.def.script === 'CScorpionBoss');
G.step(20, 0.1);
ok(s && s.anim.curName === 'stand_up' && s.anim.cur.time === 0 && s.anim.cur.timeScale === 0, 'asleep: the first frame of standing up', s && [s.anim.curName, s.anim.cur.time]);
ok(s.untargetable, 'it cannot be hit while asleep');
const gates = W.buildings.filter((b) => b.alive && b.def.wallKind === 'gate');
ok(gates.length >= 4 && gates.every((g) => g.gateState === 0), 'the gates are open', gates.map((g) => g.gateState));
// far from the camera: the open gate's frozen pose is its last frame
G.rtscam.x = 2000; G.rtscam.z = 2000;
for (let k = 0; k < 6; k++) { G.step(10, 0.1); if (G.renderOnce) G.renderOnce(); }
const g = gates.find((x) => x.anim && x.anim.curName === 'open');
let stale = null;
if (g) {
  const T = G.THREE, n = []; g.obj.traverse((o) => { if (o.isBone) n.push(o); });
  const b = n.find((o) => o.position.lengthSq() > 1) || n[0];
  const m = new T.Matrix4(); const chain = []; let o = b; while (o) { chain.unshift(o); o = o.parent; }
  for (const c of chain) { c.updateMatrix(); m.multiply(c.matrix); }
  stale = new T.Vector3().setFromMatrixPosition(b.matrixWorld).distanceTo(new T.Vector3().setFromMatrixPosition(m));
}
ok(g && stale < 0.01, 'an open gate far away is drawn in its open pose', stale);
s.behaviour.activate(s, W);
const seq = [];
for (let k = 0; k < 14; k++) { G.step(10, 0.1); seq.push(s.anim.curName); }
ok(seq[0] === 'stand_up' && seq.includes('standanim'), 'woken: it stands up, then the fight', [...new Set(seq)]);
return out.join('\n');
