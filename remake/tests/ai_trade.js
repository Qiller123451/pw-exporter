// The computer player's trade route (ai/trade.js): a Schnecke with "markplace_outpost" builds a market at home and
// at an outpost 150-250 m away and sends carts between them.
//   python3 tests/evaljs.py tests/ai_trade.js "&tribe=Aje&enemy=Hu&aid=6"   (the computer player: the enemy)
const W = G.world, D = G.data, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const B = (G.brains && G.brains.get ? G.brains.get(G.ai.id) : null) || G.aiBrain, p = B.p;
let err = null;
const upd = B.update.bind(B);
B.update = (dt) => { try { upd(dt); } catch (e) { if (!err) err = e.stack || String(e); } };
const step = (s, dt = 0.1) => { for (let i = 0; i < s; i += 5) { G.step(Math.min(50, Math.round((s - i) / dt)), dt); if (G.fx) G.fx.update(5); } };
for (const u of W.units) if (u.alive && u.wild) W.kill(u, null);
W.wildNests.length = 0;
B.setBehaviour('Schnecke');
B.prm.noFight = true;
B.mapOptions.markplace_outpost = true;
step(20);
let S = B.census(true);
// (epoch 3: the Hu cart needs the market place research, which needs it)
for (const id of ['age_2', 'age_3']) { const a = B.acts(S.base).find((x) => x.id === id); if (a) W.completeUpgrade(S.base, a); }
B.isT = 1e9; B.atkOutpost = -1;
let t = 0;
const mk = { Hu: 'hu_warehouse', Aje: 'aje_bazaar', Ninigi: 'ninigi_warehouse' }[p.tribe], cart = { Hu: 'hu_cart', Aje: 'aje_trade_dino', Ninigi: 'ninigi_cart' }[p.tribe];
const trading = () => W.units.some((u) => u.alive && u.owner === p && u.name === cart && u.task.type === 'trade');
for (; t < 900 && !trading(); t += 15) { step(15); for (const r of ['food', 'wood', 'stone']) p.res[r] = Math.max(p.res[r], 2000); }
const T = B.trade;
ok(T && T.outpost, 'a trade outpost', T && T.state);
const ms = W.buildings.filter((b) => b.alive && b.owner === p && b.name === mk && b.built);
const far = ms.length >= 2 ? Math.max(...ms.map((a) => Math.max(...ms.map((b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z))))) : 0;
ok(ms.length >= 2 && far >= 120, `two markets apart (${Math.round(far)} m)`, ms.length);
ok(trading(), `a cart trades between them (${Math.round(t / 60)} min)`, W.units.filter((u) => u.alive && u.owner === p && u.name === cart).map((u) => u.task.type));
ok(B.tradeReady === true, 'the route is ready');
if (err) ok(false, 'brain error ' + err);
return out.join('\n');
