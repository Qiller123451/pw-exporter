// The small controls of the original (2026-10-18): Tab opens / closes the army pyramid (IngameScreen.usl
// TogglePyramidState), a queued group walk goes on when its first member reaches a waypoint (FightingObj.usl
// Execute_Q_Walk), and the camera shakes per event with the original's values (GameCameraModule.usl, Effects.usl).
//   python3 tests/evaljs.py tests/controls.js "&tribe=Hu&enemy=Aje"
const W = G.world, me = G.me, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
// 1. Tab
G.hud.refreshPyramid && G.hud.refreshPyramid();
const cards = () => [...G.hud.pyr.querySelectorAll('.pcard')].filter((c) => c.offsetParent !== null).length;
const c0 = cards();
key('Tab');
const closed = G.hud.pyr.classList.contains('closed'), c1 = cards(), w1 = G.hud.pyr.getBoundingClientRect().width;
key('Tab');
ok(c0 > 0 && closed && c1 === 0 && w1 < 20 && !G.hud.pyr.classList.contains('closed') && cards() === c0, 'Tab closes the pyramid to its strip and opens it again', { c0, c1, w1: Math.round(w1) });
// 2. queued group walk
const h = G.homeEntity();
const us = [0, 1, 2].map((i) => W.spawn('hu_warrior', me, h.pos.x + 30 + i * 2, h.pos.z + 20 + (i === 2 ? 25 : 0), {}));
G.sel.clear(); for (const u of us) G.sel.add(u);
G.input.moveGroup(us, h.pos.x + 45, h.pos.z + 20, 'move', {});
G.input.moveGroup(us, h.pos.x + 45, h.pos.z + 55, 'move', { queue: true });
const straggler = us[2];
let pulled = false;
for (let i = 0; i < 200 && !pulled; i++) { G.step(1, 0.05); if (straggler.task.type === 'move' && straggler.task.z > h.pos.z + 50) pulled = true; }
const dFirst = Math.min(...us.slice(0, 2).map((u) => Math.hypot(u.pos.x - (h.pos.x + 45), u.pos.z - (h.pos.z + 20))));
const dStr = Math.hypot(straggler.pos.x - (h.pos.x + 45), straggler.pos.z - (h.pos.z + 20));
ok(pulled && dStr > 3, 'the straggler heads on to the next waypoint once the first is at this one', { pulled, straggler: +dStr.toFixed(1), first: +dFirst.toFixed(1) });
// 3. camera shakes
const cam = G.rtscam;
cam.x = h.pos.x; cam.z = h.pos.z; cam.update(0.016);
cam.shakes = [];
G.feedback.gfx.camShake('CPlaceBuildingFX', h.pos);
ok(cam.shakes.length === 1 && cam.shakes[0].dur === 1 && cam.shakes[0].s === 5, 'placing a building: a 1 s shake of strength 5', cam.shakes[0]);
cam.shakes = [];
G.feedback.gfx.camShake('CCamShakeHarvestTrees', { x: h.pos.x + 25, y: h.pos.y, z: h.pos.z });
ok(cam.shakes.length === 0, 'a tree falling 25 m away: out of its 20 m range');
cam.shakes = [];
G.feedback.gfx.camShake('CBrachioDying', { x: h.pos.x + 37.5, y: h.pos.y, z: h.pos.z });
ok(cam.shakes.length === 1 && Math.abs(cam.shakes[0].s - 20) < 0.5, 'further away a shake is weaker (37.5 m: half of 40)', cam.shakes[0] && +cam.shakes[0].s.toFixed(1));
cam.shakes = [];
const before = cam.camera.position.clone();
G.feedback.gfx.camShake('CBrachioDying', h.pos);
let moved = 0;
for (let i = 0; i < 6; i++) { cam.update(0.05); cam.update(0.0001); }
for (let i = 0; i < 4; i++) { cam.update(0.05); if (cam.camera.position.distanceTo(before) > 0.01) moved++; }
ok(moved > 0, 'a shake moves the camera');
for (let i = 0; i < 40; i++) cam.update(0.05);
ok(cam.shakes.length === 0, 'and ends after its time');
// a brachiosaurus walking: footfall shakes from its walk animation
const br = W.spawn('aje_brachiosaurus', me, h.pos.x + 10, h.pos.z + 10, {});
let shakes = 0;
const orig = cam.addShake.bind(cam); cam.addShake = (...a) => { shakes++; return orig(...a); };
if (br) { br.task = { type: 'idle' }; G.order([br], { type: 'move', x: h.pos.x + 10, z: h.pos.z + 60 }); for (let i = 0; i < 80; i++) { G.step(1, 0.05); br.anim.update(0); } }
cam.addShake = orig;
ok(br && shakes > 0, 'a walking brachiosaurus shakes the camera with its footfalls', { shakes, anim: br && br.anim.curName });
return out.join('\n');
