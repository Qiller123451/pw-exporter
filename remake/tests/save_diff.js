// Two snapshots of game/save.js compared object by object from their roots (tests/save_load.py): the paths where
// they differ (at most 40). Table order may differ; references are followed in parallel.
// fields a load may change: an animation that ran when the game was saved has ended
const VOLATILE = new Set(['busyAnim', '_idleSince']);       // (_idleSince: the HUD's idle marker, set when a frame is drawn)
function diff(A, B) {
  const out = [], seen = new Set();
  const entry = (S, v) => (v && typeof v === 'object' && '$' in v ? S.table[v.$] : null);
  const show = (v) => JSON.stringify(v === undefined ? null : v).slice(0, 90);
  const say = (path, x, y) => { if (out.length < 40) out.push(path + ': ' + show(x) + ' != ' + show(y)); };
  function cmp(x, y, path) {
    if (out.length >= 40) return;
    const ex = entry(A, x), ey = entry(B, y);
    if (ex || ey) {
      if (!ex || !ey) { say(path, ex ? 'object' : x, ey ? 'object' : y); return; }
      const k = x.$ + ':' + y.$;
      if (seen.has(k)) return;
      seen.add(k);
      cmpEntry(ex, ey, path);
      return;
    }
    if (typeof x === 'number' && typeof y === 'number') { if (Math.abs(x - y) > 1e-6 * Math.max(1, Math.abs(x))) say(path, x, y); return; }
    if (JSON.stringify(x) !== JSON.stringify(y)) say(path, x, y);
  }
  function cmpList(a, b, path) {
    if (a.length !== b.length) say(path + '.length', a.length, b.length);
    for (let i = 0; i < Math.min(a.length, b.length); i++) cmp(a[i], b[i], path + '[' + i + ']');
  }
  function cmpEntry(a, b, path) {
    if (a.c !== b.c) { say(path + ' class', a.c, b.c); return; }
    if (a.a || b.a) return cmpList(a.a || [], b.a || [], path);
    if (a.s || b.s) return cmpList(a.s || [], b.s || [], path);
    if (a.m || b.m) {
      const ma = a.m || [], mb = b.m || [];
      if (ma.length !== mb.length) say(path + '.size', ma.length, mb.length);
      for (let i = 0; i < Math.min(ma.length, mb.length); i++) { cmp(ma[i][0], mb[i][0], path + '.key' + i); cmp(ma[i][1], mb[i][1], path + '.' + (typeof ma[i][0] === 'string' ? ma[i][0] : i)); }
      return;
    }
    for (const k of ['t', 'b', 'v3', 'v2', 'q']) if (a[k] !== undefined || b[k] !== undefined) { cmp(a[k], b[k], path + '.' + k); }
    if (a.t || a.v3 || a.v2 || a.q) return;
    const fa = a.f || a.o || {}, fb = b.f || b.o || {};
    for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) if (!VOLATILE.has(k)) cmp(fa[k], fb[k], path + '.' + k);
  }
  cmp(A.root, B.root, 'root');
  return { diffs: out.length, first: out };
}
