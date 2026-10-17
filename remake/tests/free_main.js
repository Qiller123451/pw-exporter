// The Dustriders' mobile base a campaign mission starts the player with (the map's, the start location's, the army's)
// waits instead of standing wherever it was put: a worker's build card puts it down - at once and for free
// (campaign/setup.js parkFreeMains / placeFreeMain, main.js freeMainActions, ui/input.js).
// Another tribe in a Dustriders' mission: the main building that stands in for the collector waits the same way.
//   python3 tests/evaljs.py tests/free_main.js "&campaign=8&tribe=Aje"
//   python3 tests/evaljs.py tests/free_main.js "&campaign=8&tribe=SEAS"
const W = G.world, C = G.campaign, me = G.me, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const w = W.units.find((u) => u.alive && u.owner === me && u.isWorker);
if (me.tribe !== 'Aje') {
  const b = (me.freeMains || [])[0];
  ok(b && b.kind === 'building' && b.parked && !b.obj.visible && !b.blocking, 'the start location\'s main building waits', b && b.name);
  ok(!W.buildings.some((x) => x.alive && x.owner === me && !x.parked && x.name === (b && b.name)), 'none stands in the world');
  G.sel.clear(); G.sel.add(w);
  const a = G.buildActions().find((x) => x.freeMain);
  ok(!!a && a.loc.icon && W.canQueue(me, a, w) === null, 'the worker has its build card', a && a.loc.icon);
  const res = { ...me.res };
  G.useAction(a, [...G.sel]);
  ok(G.input.mode === 'place' && G.input.ghost, 'placing it shows its ghost');
  let at = null;
  for (let k = 0; k < 400 && !at; k++) { const r = 10 + k * 0.5, ang = k * 2.4, x = w.pos.x + Math.cos(ang) * r, z = w.pos.z + Math.sin(ang) * r; if (C.freeMainOk(b, x, z, 0)) at = [x, z]; }
  const placed = at && G.placeFreeMain(a, at[0], at[1], 0);
  G.input.setMode(null);
  const nb = W.buildings.find((x) => x.alive && x.owner === me && x.name === b.name && !x.parked);
  ok(placed && nb && nb.built && nb.blocking && nb.obj.visible && Math.hypot(nb.pos.x - at[0], nb.pos.z - at[1]) < 8, 'put down ready where the player chose', at && at.map(Math.round));
  ok(!b.alive && nb && nb.rec && nb.rec.entity === nb, 'the waiting one is gone, the new one has its record');
  ok(['food', 'wood', 'stone', 'skulls'].every((r) => me.res[r] === res[r]), 'nothing paid');
  ok(!G.buildActions().some((x) => x.freeMain) && !me.freeMains.length, 'the card is gone');
  G.step(20, 0.1);
  ok(nb && W.nearestDropoff(w, 'wood') === nb, 'the workers deliver to it');
  return out.join('\n');
}
// (as the army screen's collector: created with the start, then the setup's parking)
W.spawn('aje_resource_collector', me, w.pos.x + 6, w.pos.z, {});
C.parkFreeMains();
const u = (me.freeMains || [])[0];
ok(u && u.parked && !u.obj.visible && !(u.comp && u.comp.wagon && u.comp.wagon.obj.visible), 'the mobile base waits, out of the world (wagon too)');
ok(W.nearestDropoff(w, 'wood') !== u, 'nobody delivers to it while it waits');
G.sel.clear(); G.sel.add(w);
const a = G.buildActions().find((x) => x.freeMain);
ok(!!a, 'the worker has its build card', a && a.id);
ok(a && W.canQueue(me, a, w) === null && Object.values(a.cost).every((v) => !v), 'free', a && a.cost);
const res = { ...me.res };
G.useAction(a, [...G.sel]);
ok(G.input.mode === 'place' && G.input.ghost, 'placing it shows its ghost');
let at = null;
for (let k = 0; k < 300 && !at; k++) { const r = 8 + k * 0.5, ang = k * 2.4, x = w.pos.x + Math.cos(ang) * r, z = w.pos.z + Math.sin(ang) * r; if (C.freeMainOk(u, x, z)) at = [x, z]; }
const placed = at && G.placeFreeMain(a, at[0], at[1], 0);
G.input.setMode(null);
ok(placed && !u.parked && u.obj.visible && Math.hypot(u.pos.x - at[0], u.pos.z - at[1]) < 0.5, 'put down at once where the player chose', at && at.map(Math.round));
ok(['food', 'wood', 'stone', 'skulls'].every((r) => me.res[r] === res[r]), 'nothing paid');
ok(!G.buildActions().some((x) => x.freeMain) && !me.freeMains.length, 'the card is gone');
G.step(20, 0.1);
ok(W.nearestDropoff(w, 'wood') === u, 'the workers deliver to it');
ok(!C.freeMainOk({ radius: 4 }, w.pos.x, w.pos.z), 'not on top of units');
return out.join('\n');
