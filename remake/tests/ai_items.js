// The computer player and items (ai/items.js): a Hard computer player fetches a free item near its village in the
// first epochs and walks it home; an Easy one does not; a squad picks up what lies within 30 m of it.
//   python3 tests/evaljs.py tests/ai_items.js "&tribe=Hu&enemy=Aje&aid=8&map=maps/Base/Multiplayer/multi_2_nor_002.ula" (a map with items)
const W = G.world, D = G.data, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const B = (G.brains && G.brains.get ? G.brains.get(G.ai.id) : null) || G.aiBrain, p = B.p;
let err = null;
const upd = B.update.bind(B);
B.update = (dt) => { try { upd(dt); } catch (e) { if (!err) err = e.stack || String(e); } };
const step = (s) => { for (let i = 0; i < s; i += 5) { G.step(Math.min(100, (s - i) * 20), 0.05); if (G.fx) G.fx.update(5); } };
for (const u of W.units) if (u.alive && u.wild) W.kill(u, null);
W.wildNests.length = 0;
B.setBehaviour('Giraffe');
B.prm.noFight = false;
step(20);
let S = B.census(true);
const home = S.home;
// no other items: one 80 m from the village, on free ground
for (const it of W.items.slice()) { it.remove(); }
W.items.length = 0;
let spot = null;
for (let a = 0; a < 16 && !spot; a++) { const x = home.x + Math.cos(a / 16 * 6.283) * 80, z = home.z + Math.sin(a / 16 * 6.283) * 80; if (W.nav.isFree(x, z) && W.landIsland(x, z) === W.landIsland(home.x, home.z)) spot = [x, z]; }
ok(!!spot, 'a free spot 80 m from the village on its land', spot);
const it = W.placeItem('item_flowerpot_of_insanity', spot[0], spot[1]) || W.placeItem(W.items[0] && W.items[0].item.cls, spot[0], spot[1]);
ok(!!it, 'an item lies there');
// a runner in the pool
const runner = { Hu: 'hu_warrior', Aje: 'aje_spearman', Ninigi: 'ninigi_archer', SEAS: 'seas_warrior' }[p.tribe];
const gp = B.guardPoint(S);
W.spawnUnit(runner, p, gp.x, gp.z);
B.cls = 'Hard';
if (B.getItem && B.getItem.unit) B.release([B.getItem.unit]);
B.getItem = null;
S = B.census(true);
B.checkGetItem(S);
ok(B.getItem && B.getItem.item === it, 'Hard, epoch ' + S.age + ': it decides to fetch it (CheckGetItem)', B.getItem && B.getItem.phase);
let carrier = null;
for (let t = 0; t < 120 && !carrier; t += 2) { step(2); if (it.item.carrier && it.item.carrier.owner === p) carrier = it.item.carrier; }
ok(!!carrier && carrier.name === runner, 'a runner went and took it', carrier && carrier.name);
for (let t = 0; t < 120 && B.getItem; t += 2) step(2);
ok(!B.getItem && carrier && Math.hypot(carrier.pos.x - home.x, carrier.pos.z - home.z) < 45, 'and carried it home', carrier && Math.round(Math.hypot(carrier.pos.x - home.x, carrier.pos.z - home.z)));
// Easy: never
const it2 = W.placeItem('item_toolkit', spot[0], spot[1] + 4) || W.placeItem(it.item.cls, spot[0], spot[1] + 4);
B.cls = 'Easy'; B.getItem = null;
B.checkGetItem(B.census(true));
ok(!B.getItem, 'Easy: no item hunt');
// a squad on its way picks up what lies within 30 m
const sq = W.spawnUnit(runner, p, spot[0] + 15, spot[1] + 4);
B.squadPickup([sq]);
ok(sq.task.type === 'pickup' && sq.task.target === it2, 'a squad unit picks up an item 15 m away', sq.task.type);
if (err) ok(false, 'brain error ' + err);
return out.join('\n');
