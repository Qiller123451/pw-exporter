// Particle emitters of the models (engine/particles.js, GSF chunk type 2): run with
//   python3 tests/evaljs.py tests/particles.js "&tribe=Hu&enemy=Aje"
// the main building's fires spray sprites near the camera (only those of its epoch), the fill budget holds, nothing
// is sprayed far from the camera, emitters that animations drive (a finishing move's blood) spray only while one of
// them plays, a removed model's emitters are dropped.
const W = G.world, out = [], P = G.particles;
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const h = G.homeEntity();
const frames = (n) => { for (let i = 0; i < n; i++) { G.step(1, 0.05); G.renderOnce(); } };
const live = () => P.emitters.reduce((s, x) => s + x.parts.length, 0);
const drawn = () => [...P.batches.values()].reduce((s, b) => s + (b.b ? b.b.mesh.geometry.instanceCount : 0), 0);
check('the particle system runs', !!P);
// look at the main building from close by
G.rtscam.target.set(h.pos.x, h.pos.y, h.pos.z); if (G.rtscam.dist != null) G.rtscam.dist = 40;
frames(5);
const mine = P.emitters.filter((x) => x.node && (() => { for (let o = x.node; o; o = o.parent) if (o === h.obj) return true; return false; })());
check('the main building has emitters', mine.length > 0, { building: h.name, emitters: mine.length, all: P.emitters.length });
await new Promise((r) => setTimeout(r, 1500));                  // the sprite textures load
frames(60);
const shown = mine.filter((x) => x.parts.length);
check('some of its emitters spray (the current epoch\'s)', shown.length > 0 && shown.length <= mine.length, { spraying: shown.length, of: mine.length });
check('sprites are drawn', drawn() > 0, { live: live(), drawn: drawn(), batches: P.batches.size });
const p0 = shown[0] && shown[0].parts[0];
check('a sprite has a size, a colour and a life', !!p0 && p0.size > 0 && p0.life > 0 && p0.c.length === 3, p0 && { size: +p0.size.toFixed(2), life: +p0.life.toFixed(2), a: +p0.a.toFixed(2) });
// the fill budget (Options "Particle effects"): a sprite grows by adding size_increase, not by multiplying; at
// most so many sprites and so much screen area a frame; off draws nothing
check('sprites stay a sensible size', P.emitters.every((x) => x.parts.every((p) => p.size < 80)), Math.max(...P.emitters.flatMap((x) => x.parts.map((p) => p.size))));
P.level = 'off'; frames(2);
check('"off" draws no sprite', drawn() === 0, drawn());
P.level = 'low'; frames(30);
check('"low" keeps to its budget', drawn() > 0 && drawn() <= 800, drawn());
P.level = 'on';
// far away: nothing new is sprayed
const far = W.size ? W.size / 2 : 500;
const away = G.rtscam.target.clone().set(h.pos.x + far, h.pos.y, h.pos.z + far);
for (let i = 0; i < 20; i++) P.update(0.5, G.camera, away);
check('far from the camera the emitters rest', mine.every((x) => !x.parts.length), mine.map((x) => x.parts.length).filter(Boolean).length);
// emitters that animations drive (GSF chunk 0x40000002: extras anims): idle units do not bleed
const drv = P.emitters.filter((x) => x.anims && x.node);
check('animation-driven emitters exist', drv.length > 0, { n: drv.length, anims: drv.length && [...drv[0].anims] });
check('they spray only while their animation plays', drv.every((x) => !x.parts.length || P.constructor.playing(x)), drv.filter((x) => x.parts.length).length);
// a hit's sparks (fx_impact_01: emitter vector 0.61, 0.61, 26.5 - a velocity, not a 26 m tall volume) burst out
// from the hit and stop (drag 8): no pillar of light above the unit (user report 2026-10-17)
{
  const at = h.pos.clone(); at.x += 12; at.y = W.height(at.x, at.z) + 1.5;
  const fx = G.mfx.at('fx_impact_01', at, 2.5);
  if (fx) fx.obj.updateMatrixWorld(true);
  for (let i = 0; i < 4; i++) P.update(0.05, G.camera, G.rtscam.target);
  const sp = P.emitters.find((x) => x.node && /sparks/.test(x.node.name) && (() => { for (let o = x.node; o; o = o.parent) if (o === (fx && (fx.obj || fx.root || fx))) return true; return false; })())
    || P.emitters.filter((x) => x.node && /fx_sparks/.test(x.node.name)).pop();
  const pts = sp ? sp.parts.filter((q) => q.vis).map((q) => q.p.clone().applyMatrix4(sp.node.matrixWorld)) : [];
  const up = Math.max(...pts.map((q) => q.y - at.y)), wide = Math.max(...pts.map((q) => Math.hypot(q.x - at.x, q.z - at.z)));
  check('a hit\'s sparks burst around it, not up in a column', pts.length > 10 && up < 4 && wide > 0.3, { n: pts.length, up: +up.toFixed(2), wide: +wide.toFixed(2) });
}
// a model that leaves the scene: its emitters are dropped after a while
const n0 = P.emitters.length;
W.scene.remove(h.obj);
for (let i = 0; i < 30; i++) P.update(0.5, G.camera, G.rtscam.target);
check('a removed model\'s emitters are dropped', P.emitters.length < n0, { before: n0, after: P.emitters.length });
W.scene.add(h.obj);
return out.join('\n');
