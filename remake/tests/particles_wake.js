// Emitters that spray per metre moved (emit_per_meter: ship wakes, arrow trails) and lie flat on the water (flag
// 0x40000000): a SEAS carrier's bow and side waves stay off while it lies still and spray while it sails
// (engine/particles.js, docs/spec/particles.md).
//   python3 tests/evaljs.py tests/particles_wake.js "&tribe=SEAS&enemy=Hu&map=maps/Base/Multiplayer/multi_2_jun_001.ula"
const W = G.world, me = G.me, P = G.particles, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const h = G.homeEntity();
let at = null;
for (let r = 20; r < 400 && !at; r += 10) for (let a = 0; a < 6.28 && !at; a += 0.3) { const x = h.pos.x + Math.cos(a) * r, z = h.pos.z + Math.sin(a) * r; if (W.waterNav && W.waterNav.isFree(x, z) && W.waterNav.isFree(x + 30, z) && W.waterNav.isFree(x + 15, z)) at = [x, z]; }
check('open water near the start', !!at, at && at.map(Math.round));
const s = at && W.spawn('seas_carrier', me, at[0], at[1], {});
check('a carrier', !!s, s && s.name);
const frames = (n) => { for (let i = 0; i < n; i++) { G.step(1, 0.05); G.rtscam.x = s.pos.x; G.rtscam.z = s.pos.z; G.rtscam.update(0.05); G.camera.updateMatrixWorld(); W.scene.updateMatrixWorld(); P.update(0.05, G.camera, G.rtscam.target, 1); } };
const mine = () => P.emitters.filter((x) => x.node && x.P.emit_per_meter > 0 && (() => { for (let o = x.node; o; o = o.parent) if (o === s.obj) return true; return false; })());
const live = () => mine().reduce((n, x) => n + x.parts.filter((p) => p.vis).length, 0);
if (s) {
  frames(60);
  check('its wake emitters', mine().length > 0, mine().map((x) => x.node.name));
  check('no wake while it lies still', live() === 0, live());
  // (sailing by hand, 0.3 m a frame: the wake does not depend on the pathfinder)
  let most = 0;
  for (let i = 0; i < 80; i++) {
    s.obj.position.x += 0.3; s.obj.updateMatrixWorld(true);
    G.camera.updateMatrixWorld(); P.update(0.05, G.camera, G.rtscam.target, 1);
    most = Math.max(most, live());
  }
  check('a wake while it sails', most > 0, { most });
  check('the waves lie flat on the water', mine().some((x) => x.F & 0x40000000));
}
return out.join('\n');
