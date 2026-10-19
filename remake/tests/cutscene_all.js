// Every in-engine cutscene of a mission plays to its end without an error (ui/cutscene.js): the mission's own triggers
// are held back, each sequence with a timeline is played (fast) and then skipped ones' end state is applied.
//   python3 tests/evaljs.py tests/cutscene_all.js "&campaign=<n>"
const C = G.campaign, W = G.world, E = C.engine, M = G.mission, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
for (const t of E.triggers) t.startEnabled = false;
const errs = [];
const oe = console.warn;
console.warn = (...a) => { if (/cutscene/.test(String(a[0]))) errs.push(a.map(String).join(' ').slice(0, 200)); oe.apply(console, a); };
const seqs = Object.entries(C.data.sequences || {}).filter(([, s]) => s && s.play && !(s.videos || []).length);
let played = 0, lines = 0;
for (const [path, s] of seqs) {
  M.manual = false;
  E.playSequence({ path, quit: false, snapBack: true, snapActors: true, camera: null, fow: false, trigger: E.triggers[0] });
  G.step(1, 0.05);
  M.update(0.016);
  if (!(M.cine && M.cine.player)) { errs.push(s.id + ': did not start'); M.skipAll && M.skipAll(); continue; }
  const shown = new Set();
  for (let i = 0; i < 4000 && M.cine; i++) {
    M.update(0.1);
    if (G.seqCam) G.seqCam(0.1);
    const tx = M.cineEl.querySelector('.ctext').textContent;
    if (tx) shown.add(tx);
  }
  if (M.cine) { errs.push(s.id + ': did not end'); M.skip(); }
  played++;
  lines += shown.size;
  const want = (s.lines || []).length;
  if (shown.size < Math.min(want, 1)) errs.push(`${s.id}: no subtitle shown (${want} lines)`);
  G.step(1, 0.05);
}
console.warn = oe;
M.manual = true;
ok(seqs.length > 0, `${seqs.length} cutscenes with a timeline`, seqs.map(([, s]) => s.id));
ok(!errs.length && played === seqs.length, `all played to their end (${played}, ${lines} subtitles shown)`, errs.slice(0, 10));
ok(!G.paused && !M.cine, 'the game goes on afterwards');
return out.join('\n');
