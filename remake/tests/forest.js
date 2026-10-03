// Forest blocks in the game (run with tests/evaljs.py tests/forest.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/ausbildungslager.ula"):
// the tutorial map has no placed tree at all - its wood is the forest blocks (docs/MAP_FORMAT.md "Frst").
const W = G.world, S = G.mapSource, out = [];
const run = (sec) => G.step(Math.ceil(sec / 0.25), 0.25);
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const ft = S.trees.filter((t) => t.forest);
check('map source has the forest trees', ft.length > 30000 && ft.length === S.trees.length, { forest: ft.length, all: S.trees.length });
check('five kinds of trees with stump and timber', new Set(ft.map((t) => t.model)).size === 5 && ft.every((t) => t.stump && t.timber && t.wood > 0),
  [...new Set(ft.map((t) => t.model))]);
check('undergrowth of the blocks', S.decor.filter((d) => d.forest).length > 30000, S.decor.filter((d) => d.forest).length);
const res = [...(W.resources.values ? W.resources.values() : W.resources)].filter((r) => r.type === 'tree' && r.alive);
check('forest trees are wood in the world', res.length > 30000, res.length);
check('none under water', ft.every((t) => S.height(t.x, t.z) > 16), null);
// a worker chops the forest
const me = G.me;
const w = W.units.find((u) => u.alive && u.owner === me && u.isWorker);
if (w) {
  const n = W.nearestResource(w.pos.x, w.pos.z, 'wood', 400);
  check('a tree within reach of the base', !!n, n && Math.round(Math.hypot(n.pos.x - w.pos.x, n.pos.z - w.pos.z)));
  if (n) {
    me.caps.wood = 1e5; me.res.wood = 0;
    W.order([w], { type: 'gather', target: n });
    let t = 0; while (me.res.wood === 0 && t < 300) { run(2); t += 2; }
    check('wood from the forest delivered', me.res.wood > 0, { got: me.res.wood, secs: t });
  }
} else check('player has a worker', false);
const t0 = performance.now(); run(10); const ms = (performance.now() - t0) / 40;
check('simulation step stays fast with 35 000 trees', ms < 25, Math.round(ms * 10) / 10 + ' ms per step');
return out.join('\n');
