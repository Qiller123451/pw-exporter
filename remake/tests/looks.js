// Looks and small rules (2026-10-01 report): run with
//   python3 tests/evaljs.py tests/looks.js "&tribe=Aje&enemy=Hu"
// add-on orientation, carried wood, 2D parts of buildings, tree sprite atlas cells, souls only with a shaman.
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const h = G.homeEntity();
const V = h.pos.constructor;
// world-space extent of an object (skinned vertices included)
const size = (o) => {
  if (!o) return null;
  o.updateMatrixWorld(true);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], v = new V();
  o.traverse((m) => { if (!m.isMesh || !m.visible || m.userData.sprite) return; const n = m.geometry.attributes.position.count;
    for (let i = 0; i < n; i += 3) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); ['x', 'y', 'z'].forEach((k, j) => { mn[j] = Math.min(mn[j], v[k]); mx[j] = Math.max(mx[j], v[k]); }); } });
  return mx.map((x, j) => +(x - mn[j]).toFixed(1));
};
// 1. the Norse ballista tower: the ballista lies flat on top (wider than tall), the cranes stand upright
const owner = me.tribe === 'Hu' ? me : G.ai && G.ai.tribe === 'Hu' ? G.ai : null;
const t = owner && W.placeBuilding('hu_large_tower', owner, h.pos.x + 40, h.pos.z + 30, 0, true);
if (t) {
  owner.tt.enable('Hu/Upgrades/hu_large_tower/hu_ballista_upgrade'); t.refreshRules(); G.step(4);
  const bal = (t.comp ? t.comp.parts : t.parts || []).find((p) => /balista/.test(p.spec.gfx));
  const s = bal && size(bal.obj);
  check('ballista lies flat (not tipped 90 degrees)', s && s[1] < Math.max(s[0], s[2]) * 0.6, s || (t.comp ? t.comp.parts : t.parts || []).map((p) => p.spec.gfx));
  const c = W.placeBuilding('hu_large_tower', owner, h.pos.x + 60, h.pos.z + 30, 0, false); G.step(4);
  const cs = c && c.cranes.map((k) => size(k.obj));
  check('construction cranes stand upright', cs && cs.length && cs.every((x) => x[1] > Math.max(x[0], x[2])), cs);
} else if (owner) check('ballista tower placed', false);
// 2. carried logs are drawn (product_wood_* must not get the foliage alpha cut-out)
const wood = W.template(W.productWood || 'product_wood_jun', true);
let woodOk = false;
if (wood) wood.scene.traverse((m) => { if (m.isMesh && !(m.material.alphaTest > 0)) woodOk = true; });
check('carried wood log is opaque', woodOk);
// 3. 2D parts of buildings: the Dragon Clan headquarters has its paper lanterns as sprites
const nh = W.template('ninigi_fireplace', true);
let sprites = 0;
if (nh) nh.scene.traverse((m) => { if (m.userData.sprite) sprites++; });
if (nh) check('ninigi headquarters has sprite parts (lanterns)', sprites > 0, sprites);
// 4. tree sprites use whole atlas cells (grids of 2^n cells; the old 8x8 reading cut images in half)
const tr = W.template('jungle_tree_med_06', true);
const cells = tr && tr.extras.foliage ? tr.extras.foliage.map((f) => f.uv) : [];
const whole = (u) => [0, 1, 2, 3].every((k) => Math.abs(u[k] * (1 / (k % 2 ? u[3] - u[1] : u[2] - u[0])) - Math.round(u[k] * (1 / (k % 2 ? u[3] - u[1] : u[2] - u[0])))) < 1e-6);
check('tree sprite cells are aligned', cells.length && cells.every(whole), cells);
// 5. souls of the fallen glimmer only for a player with a shaman (Resurrect)
let glows = 0;
const spawn = W.fx.spawn.bind(W.fx);
W.fx.spawn = (k, ...a) => { if (k === 'glow') glows++; return spawn(k, ...a); };
const kill = (u) => { u.hp = 0; if (W.kill) W.kill(u); };
const w1 = W.units.find((x) => x.alive && x.owner === me && x.isWorker);
kill(w1); G.step(40);
check('no soul light without a shaman', glows === 0 && W.spirits.length > 0, { glows, spirits: W.spirits.length });
if (me.tribe === 'Aje') {
  W.spawnUnit('aje_shaman', me, h.pos.x + 20, h.pos.z + 20, 1);
  glows = 0; G.step(40);
  check('soul light with a shaman', glows > 0, glows);
}
W.fx.spawn = spawn;
return out.join('\n');
