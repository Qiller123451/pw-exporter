// A storehouse with a "deliver" animation plays it when a worker delivers there (FightingObj.AcceptDeliveries /
// CAcceptDeliveries; Entity.onDelivery): one run, a loop more for every further delivery while it plays (at most 5).
//   python3 tests/evaljs.py tests/deliver_anim.js "&tribe=Hu&enemy=Aje"
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const h = G.homeEntity();
let b = null;
for (let k = 0; k < 400 && !b; k++) { const a = k * 2.4, r = 20 + k * 0.1, x = h.pos.x + Math.cos(a) * r, z = h.pos.z + Math.sin(a) * r; if (W.canPlace('hu_lumberjack_cottage', x, z, 0, me)) b = W.placeBuilding('hu_lumberjack_cottage', me, x, z, 0, true); }
check('a lumberjack cottage with a deliver animation', !!b && b.anim && b.anim.has('deliver'), b && b.name);
// a worker brings wood
const w = W.units.find((u) => u.alive && u.owner === me && u.isWorker);
w.setCarry('wood', 10);
w.task = { type: 'gather', res: 'wood', phase: 'deliver', drop: b };
w.pos.set(b.pos.x + b.radius + 1, w.pos.y, b.pos.z); w.path = [];
let saw = false;
for (let i = 0; i < 80 && !saw; i++) { G.step(1, 0.05); b.updateAnim(0.05, W.time); if (b.anim.curName === 'deliver') saw = true; }
check('the delivery starts its deliver animation', saw && !w.carry, [b.anim.curName, w.carry]);
const T = b.deliverT;
b.onDelivery(); b.onDelivery();
check('two more deliveries add two loops', b.deliverN === 2 && b.deliverT > T, [b.deliverN, T, b.deliverT]);
for (let i = 0; i < 9; i++) b.onDelivery();
check('at most 5 more', b.deliverN === 5, b.deliverN);
for (let i = 0; i < 400 && b.deliverT > 0; i++) b.updateAnim(0.05, W.time);
check('then it ends', b.deliverT <= 0 && (b.anim.curName !== 'deliver' || b.anim.phase === 'e'), [b.anim.curName, b.anim.phase]);
return out.join('\n');
