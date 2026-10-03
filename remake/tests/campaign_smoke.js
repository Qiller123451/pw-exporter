// Smoke test of a campaign mission with its triggers: load, run some game minutes, report what the engine did.
//   python3 tests/evaljs.py tests/campaign_smoke.js "&campaign=<n>[&minutes=5]"
// Prints one SUMMARY line (JSON) for the per-mission table and ok / FAIL lines: nothing may throw, no condition or
// action type may be unknown, no action may raise an error.
const C = G.campaign, W = G.world, out = [];
const ok = (c, m) => out.push(`${c ? 'ok' : 'FAIL'} ${m}`);
const minutes = +(new URLSearchParams(location.search).get('minutes') || 5);
const E = C.engine, D = C.debug;
ok(!!E, 'the trigger engine exists');
let err = null, steps = 0;
const t0 = performance.now();
const mem0 = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0;
try {
  for (let s = 0; s < minutes * 60 && !G.over; s += 5) { G.step(100, 0.05); steps += 100; if (G.fx) G.fx.update(5); }
} catch (e) { err = e.stack || String(e); }
const ms = performance.now() - t0;
ok(!err, 'the simulation ran without an exception' + (err ? ': ' + err : ''));
const S = D.summary();
const unk = [...S.unknownConditions, ...S.unknownActions];
ok(!unk.length, 'no unknown condition / action type' + (unk.length ? ': ' + unk.join(', ') : ''));
ok(C.errors.length === 0, `no action errors (${C.errors.length})`);
ok(S.firedTriggers > 0, `triggers fired: ${S.firedTriggers} of ${S.triggers} (${S.firings} firings, ${S.actions} actions)`);
const M = G.mission;
const quests = D.quests().filter((q) => q.visible).map((q) => q.name + (q.accomplished ? '+' : q.unaccomplishable ? '!' : ''));
const noModel = C.warnings.filter((w) => /could not be created|no model|not created/.test(w));
const sum = {
  mission: C.id, title: C.map.title || C.map.name, minutes: Math.round(W.time / 60 * 10) / 10, triggers: S.triggers, fired: S.firedTriggers, firings: S.firings, actions: S.actions,
  warnings: C.warnings.length, errors: C.errors.length, unknown: unk, missingModels: noModel.length, quests, ended: S.ended ? (S.ended.won ? 'won' : 'lost') + '@' + Math.round(S.ended.t) : null,
  units: W.units.filter((u) => u.alive).length, buildings: W.buildings.filter((b) => b.alive).length, fullTribes: C.fullTribes, behaviours: [...G.brains.values()].map((b) => b.p.id + ':' + b.behaviour),
  heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0, heapStartMB: mem0, msPerGameSecond: Math.round(ms / Math.max(1, steps * 0.05)), polls: E.stats.polls,
};
out.push('SUMMARY ' + JSON.stringify(sum));
for (const e of C.errors.slice(0, 12)) out.push('   error: ' + JSON.stringify(e));
for (const w of C.warnings.slice(0, 40)) out.push('   warning: ' + w);
out.push('   log tail:\n' + D.print(25));
return out.join('\n');
