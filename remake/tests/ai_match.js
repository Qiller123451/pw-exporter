// The computer player against itself (?aivai): a timeline per side and a few sanity checks.
//   python3 tests/evaljs.py tests/ai_match.js "&tribe=Hu&enemy=Aje&aivai&aib=Giraffe,Giraffe&aid=4&minutes=25"
// aib = behaviour per player id (Dodo | Giraffe | Schnecke | Turtle), aid = difficulty 0-9 per player id,
// minutes = game time to play, noaidata = play without ai.json (built-in fallbacks).
const Q = new URLSearchParams(location.search);
const minutes = +(Q.get('minutes') || 25);
const W = G.world;
const out = [];
const brains = (G.brains ? [...(G.brains.values ? G.brains.values() : Object.values(G.brains))] : [G.meBrain, G.aiBrain]).filter(Boolean);
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const sides = brains.map((b) => ({ b, p: b.p, epochs: [], peak: 0, at10: null, idleSamples: 0, samples: 0, ms: 0, maxMs: 0, err: null, wPeak: 0, builds: new Set() }));
for (const s of sides) {
  const orig = s.b.update.bind(s.b);
  s.b.update = (dt) => { const t = performance.now(); try { orig(dt); } catch (e) { if (!s.err) s.err = e.stack || String(e); } const d = performance.now() - t; s.ms += d; if (d > s.maxMs) s.maxMs = d; };
}
let err = null, t = 0;
const t0 = performance.now();
try {
  for (; t < minutes * 60; t += 5) {
    G.step(100, 0.05);
    if (G.fx && G.fx.update) G.fx.update(5);              // ?manual never draws: particles would pile up
    for (const s of sides) {
      const S = s.b.census(true);
      const ep = s.p.epoch();
      while (s.epochs.length < ep - 1) s.epochs.push(W.time);
      s.peak = Math.max(s.peak, S.fighters.length);
      s.wPeak = Math.max(s.wPeak, S.workers.length);
      for (const b of S.blds) s.builds.add(b.name);
      s.samples++;
      if (S.idle.length > 3 && ['food', 'wood', 'stone'].some((r) => s.p.res[r] < s.p.caps[r] - 20)) s.idleSamples++;      // idle with full stores is fine
      if (s.at10 === null && W.time >= 600) s.at10 = [S.workers.length, S.fighters.length];
    }
    if (sides.some((s) => s.p.defeated) || G.over) break;
    if (t % 60 === 0) await new Promise((r) => setTimeout(r, 0));
  }
} catch (e) { err = e.stack || String(e); }
const real = (performance.now() - t0) / 1000;
const end = W.time;
for (const s of sides) {
  const b = s.b, p = s.p, L = b.launched || [];
  const plan = L.filter((l) => !l.scripted && !l.hunt && l.go !== undefined).sort((x, y) => x.go - y.go);
  const first = plan[0];
  const S = b.census(true);
  const name = `${p.tribe} ${b.behaviour} d${b.d}`;
  out.push(`${name}: epochs ${s.epochs.map((x, i) => `${i + 2}@${mmss(x)}`).join(' ') || 'none'} | at 10 min workers/army ${s.at10 ? s.at10.join('/') : '-'} | now ${S.workers.length}/${S.fighters.length} peak army ${s.peak} workers ${s.wPeak}`
    + ` | attacks ${plan.length}${first ? ` (first ${mmss(first.go ?? first.t)} ${first.type} x${first.n})` : ''} | kills/lost ${p.kills}/${p.lost} | ${p.defeated ? 'DEFEATED ' + mmss(end) : 'alive'} | res ${['food', 'wood', 'stone', 'skulls'].map((r) => Math.round(p.res[r])).join('/')}`
    + ` | ai ${(s.ms / Math.max(1, end)).toFixed(2)} ms per game s (max step ${s.maxMs.toFixed(0)} ms) | units ${S.units.length} buildings ${S.blds.length}`);
  out.push(`   attacks: ${L.filter((l) => !l.hunt).sort((x, y) => (x.go ?? x.t) - (y.go ?? y.t)).map((l) => (l.go === undefined ? `${mmss(l.t)} ${l.type} (squad forming)` : `${mmss(l.go)} ${l.type}x${l.n}${l.result ? '>' + l.result : ''}`)).join(', ')}`);
  out.push(`   buildings: ${[...s.builds].join(' ')}`);
  const ok = (c, m) => out.push(`${c ? 'ok' : 'FAIL'} ${name}: ${m}`);
  ok(!s.err, 'no exception' + (s.err ? ' - ' + s.err.split('\n').slice(0, 3).join(' | ') : ''));
  if (b.behaviour !== 'Mikrobe') {
    const lim = b.d >= 3 ? 15 : 22;
    if (end >= lim * 60 && !p.defeated) ok(s.epochs.length >= 1 && s.epochs[0] <= lim * 60, `epoch 2 within ${lim} minutes (${s.epochs.length ? mmss(s.epochs[0]) : 'never'})`);
    if (/Dodo|Giraffe/.test(b.behaviour) && end >= 20 * 60 && !p.defeated && b.d >= 3) ok(plan.length > 0, `an attack within 20 minutes (${plan.length})`);
    if (/Turtle/.test(b.behaviour)) ok(plan.length === 0, 'a Turtle never attacks');
    ok(s.idleSamples <= s.samples * 0.25, `workers are not idle for long (${s.idleSamples} of ${s.samples} samples with more than 3 idle)`);
    ok(s.ms / Math.max(1, end) < 4, `think cost ${(s.ms / Math.max(1, end)).toFixed(2)} ms per game second`);
  }
}
out.push(`${err ? 'FAIL' : 'ok'} simulation ${err ? err.split('\n').slice(0, 4).join(' | ') : 'ran'}: ${mmss(end)} game time in ${real.toFixed(0)} s, ${W.units.length} units, scene ${G.scene ? G.scene.children.length : '?'}`);
return out.join('\n');
