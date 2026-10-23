// With MIRAGE both Executioners start at level 4 (the user's choice; MIRAGE's tech tree says 3): Rules.startLevel, and
// one trained in a garage comes out at 4. python3 tests/evaljs.py tests/executioner_level.js "&tribe=SEAS&enemy=Hu&cheats=..."
const me = G.me, W = G.world, D = G.data, out = [];
const mirage = D.extra && D.extra.mod === 'MIRAGE';
const acts = D.actions(me).filter((a) => a.kind === 'Build' && /^seas_lumberjack(_minigun)?(_boss)?$/.test(a.id));
for (const a of acts) out.push(`${a.id} -> ${D.startLevel(a)}`);
const lv = (id) => { const a = acts.find((x) => x.id === id); return a ? D.startLevel(a) : null; };
let ok = mirage ? lv('seas_lumberjack') === 4 && lv('seas_lumberjack_minigun') === 4 && (lv('seas_lumberjack_minigun_boss') ?? 5) === 5 : true;
// train one
const h = G.homeEntity();
let g = null;
for (let k = 0; k < 40 && !g; k++) { const a = k * 0.9, r = 25 + k * 2; g = W.placeBuilding('seas_garage', me, h.pos.x + Math.cos(a) * r, h.pos.z + Math.sin(a) * r, 0, true); }
if (g) {
  g.progress = 1; W.finishBuilding(g, []);
  const a = G.producerActions(g).find((x) => x.id === 'seas_lumberjack');
  const why = a ? W.queueAction(g, a) : 'no action';
  G.step(100);
  const u = W.units.find((x) => x.alive && x.owner === me && x.name === 'seas_lumberjack');
  out.push(`trained: ${why || 'queued'} -> ${u ? 'level ' + u.level : 'none'}`);
  if (mirage) ok = ok && !!u && u.level === 4;
}
return (ok ? 'ok ' : 'FAIL ') + out.join(' | ');
