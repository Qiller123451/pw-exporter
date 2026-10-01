// SEAS carrier (run with tests/evaljs.py tests/carrier.js "&tribe=SEAS&enemy=Hu&map=maps/Base/Multiplayer/multi_2_jun_001.ula"):
// it sails where it is sent, re-blocks the water grid where it stops, opens its hull to release a unit.
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (s) => G.step(Math.ceil(s / 0.05));
for (const u of W.units) if (u.alive && u.wild) W.kill(u, null);
W.wildNests.length = 0;
for (const p of W.players) { p.res.food = p.res.wood = p.res.stone = 5000; p.caps.food = p.caps.wood = p.caps.stone = 1e5; }
const h = G.homeEntity();
let spot = null;
for (let r = 20; r < 300 && !spot; r += 8) for (let a = 0; a < 24 && !spot; a++) {
  const x = h.pos.x + Math.cos(a / 24 * 6.283) * r, z = h.pos.z + Math.sin(a / 24 * 6.283) * r;
  if (W.isWater(x, z, 1.5)) { const at = W.placement('seas_carrier', x, z, 0, me); if (at.ok) spot = at; }
}
check('carrier placed on the coast', !!spot, spot);
const b = W.placeBuilding('seas_carrier', me, spot.x, spot.z, spot.rot, true);
W.entityFilters(b, true); W.recomputeCaps(me);
check('is a moving harbour', W.isMovingHarbour(b), b.def.script);
// a destination in open water ~120 m away
let dest = null;
for (let r = 120; r > 40 && !dest; r -= 10) for (let a = 0; a < 32 && !dest; a++) {
  const x = b.pos.x + Math.cos(a / 32 * 6.283) * r, z = b.pos.z + Math.sin(a / 32 * 6.283) * r;
  if (W.isWater(x, z, 4) && W.waterNav.isFree(x, z)) dest = [x, z];
}
const p0 = b.pos.clone();
const why = W.moveHarbour(b, dest[0], dest[1]);
check('accepts a move order', !why, { why, dest });
run(3);
const moved3 = Math.hypot(b.pos.x - p0.x, b.pos.z - p0.z);
check('sails with its swim animation', moved3 > 3 && /swim/.test(b.anim && b.anim.curName), { moved3, anim: b.anim && b.anim.curName });
run(90);
const d = Math.hypot(b.pos.x - dest[0], b.pos.z - dest[1]);
check('arrives and stops', !b.sail && d < 12, { d, sailing: !!b.sail });
check('blocks the water grid where it stopped', b.blocking && !W.waterNav.isFree(b.pos.x, b.pos.z), { blocking: b.blocking });
check('model follows', Math.hypot(b.obj.position.x - b.origin.x, b.obj.position.z - b.origin.z) < 0.01);
// production: the hull opens, the unit appears after HULL_OPEN s and drives out the front
const act = G.producerActions(b).find((a) => a.kind === 'Build' && /hovercraft|submarine/.test(a.id));
check('has a ship/vehicle to build', !!act, act && act.id);
if (act) {
  const w2 = W.queueAction(b, act);
  const n0 = W.units.filter((u) => u.alive && u.owner === me).length;
  run(act.time + 0.5);
  const n1 = W.units.filter((u) => u.alive && u.owner === me).length;
  check('hull opens before the unit comes out', b.anim.curName === 'work_finished' && n1 === n0, { w2, anim: b.anim.curName, n0, n1, alive: b.alive, hp: b.hp | 0, q: b.queue.map((q) => [q.action.id, q.t.toFixed(1), q.total, q.hullT]), t: W.time.toFixed(1) });
  run(3);
  const u = W.units.find((x) => x.alive && x.owner === me && x.name === act.results[0].obj);
  check('unit released once the hull is open', !!u, act.results[0].obj);
  if (u) {
    const ex = b.linkWorld('Ex_1');
    run(15);
    check('unit drove out of the front', Math.hypot(u.pos.x - b.pos.x, u.pos.z - b.pos.z) > b.radius, { dist: Math.hypot(u.pos.x - b.pos.x, u.pos.z - b.pos.z), r: b.radius, task: u.task.type, tgt: u.task.target && u.task.target.name, cf: u.cannotFight, long: !!(u.weapons && u.weapons.long), ex: ex && [ex.x | 0, ex.z | 0] });
  }
}
return out.join('\n');
