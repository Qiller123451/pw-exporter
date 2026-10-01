// Start / loop / end animations (the loop marks of the GSF animation chunks): a unit that walks plays the start part
// of its walk clip once, repeats the loop part, and plays the end part when it stops.
//   python3 tests/evaljs.py tests/sle.js "&tribe=Hu&enemy=Aje&debug"
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const withParts = W.units.filter((u) => u.anim && [...u.anim.byName.keys()].some((k) => k.endsWith('#l')));
check('models come with loop parts', withParts.length > 0, withParts.length + ' of ' + W.units.length);
const walkers = W.units.filter((u) => u.owner === me && u.anim && u.anim.has(u.walkAnim + '#l'));
check('own units with a start/loop/end walk clip', walkers.length > 0, [...new Set(W.units.filter((u) => u.owner === me).map((u) => u.name + ':' + u.walkAnim + ':' + (u.anim && u.anim.has(u.walkAnim + '#l'))))]);
const u = walkers.find((x) => x.anim.has(x.walkAnim + '#s') && x.anim.has(x.walkAnim + '#e')) || walkers[0];
if (u) {
  const seq = [];
  const note = () => { const k = u.anim.curName + ':' + u.anim.phase; if (seq[seq.length - 1] !== k) seq.push(k); };
  W.order([u], { type: 'move', x: u.pos.x + 60, z: u.pos.z + 10 });
  for (let i = 0; i < 400; i++) { G.step(1); note(); if (i > 40 && !u.path.length && u.anim.phase === '' ) break; }
  const s = seq.join(' > ');
  const w = u.walkAnim;
  check('walk: start part, then the loop', s.includes(w + ':s > ' + w + ':l') || (!u.anim.has(w + '#s') && s.includes(w + ':l')), s);
  check('stopping: the end part, then standing', !u.anim.has(w + '#e') || new RegExp(w + ':l > ' + w + ':e > [a-z0-9_]+:').test(s), s);
  check('whole clip still there for one-shot use', u.anim.duration(w) > u.anim.duration(w + '#l'), [u.anim.duration(w), u.anim.duration(w + '#l')]);
}
return out.join('\n');
