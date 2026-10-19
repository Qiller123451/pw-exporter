// Felled trees (vegetation.usl CTree.Fall, Resource.usl CWood; ui/logs.js): the stump stays, the log - the whole tree
// with its leaves on the bones - falls over with chop_down_01..03 and lies as it fell until its wood is used up; a
// brachio's stomp fells the trees away from it.
//   python3 tests/evaljs.py tests/tree_fall.js ""          (the random jungle map)
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const ev = () => G.feedback.handle(W.events.splice(0));      // (what the frame loop does)
const step = (s) => { for (let i = 0; i < s * 20; i++) { G.step(1, 0.05); ev(); G.logs.update(); } };
const trees = W.resources.filter((r) => r.alive && r.type === 'tree' && r.timberKind);
ok(trees.length > 10, 'trees with a log model', trees.length);
const n = trees[0];
W.fellTree(n); ev();
const L = G.logs.logs.get(n);
ok(!!L && /^chop_down_0[123]$/.test(L.clip) && n.stumpHandle, 'felled: the stump stays, the log falls with chop_down_01..03', L && L.clip);
const sprites = [];
L.obj.traverse((o) => { if (o.userData.sprite) sprites.push(o); });
ok(sprites.length > 0 && sprites.every((s) => s.parent && s.parent.isBone), 'its leaves hang on the bones', sprites.length);
// the bones of a log: the one farthest from the stump is the crown's
const bones = (L) => { const a = []; L.obj.updateMatrixWorld(true); L.obj.traverse((o) => { if (o.isBone) a.push(o.getWorldPosition(o.position.clone())); }); return a; };
const top = (L) => Math.max(...bones(L).map((p) => p.y)) - L.node.pos.y;
const crown = (L) => bones(L).sort((a, b) => Math.hypot(b.x - L.node.pos.x, b.z - L.node.pos.z) - Math.hypot(a.x - L.node.pos.x, a.z - L.node.pos.z))[0];
const h0 = top(L);
step(3);
const h1 = top(L);
ok(h0 > 4 && h1 < h0 * 0.5, 'it falls over (height of the log before / after)', [+h0.toFixed(1), +h1.toFixed(1)]);
const leafY = sprites.map((s) => s.getWorldPosition(s.position.clone()).y - n.pos.y);
ok(Math.max(...leafY) < h0 * 0.6, 'the leaves came down with it', +Math.max(...leafY).toFixed(1));
W.depleteNode(n); ev();
ok(!G.logs.logs.has(n) && !L.obj.parent, 'a log used up is gone');
// a brachio's stomp: away from it
const m = trees[1], c = { x: m.pos.x - 5, z: m.pos.z };
W.fellTreesAround(c, 6); ev();
ok(m.fallClip === 'chop_down_00' && m.logRot === Math.PI, 'the stomp fells it away from the brachio (east: clip 00, the log at map rotation 0)', [m.fallClip, m.logRot]);
step(3);
const L2 = G.logs.logs.get(m), cr = crown(L2), cx = cr.x;
ok(cx > m.pos.x + 2 && Math.abs(cr.z - m.pos.z) < Math.abs(cx - m.pos.x), 'and its crown lies east of the stump', +(cx - m.pos.x).toFixed(1));
return out.join('\n');
