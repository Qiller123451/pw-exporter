// Naval checks on an original map with water (run with tests/evaljs.py ... "&map=maps/Base/Multiplayer/multi_2_jun_001.ula"):
// coastal harbour placement, ship production at the dock, fishing, transport boarding/unloading, mines.
const W = G.world, me = G.me, ai = W.players.find((p) => p !== me), D = G.data;
const out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
for (const p of W.players) { p.res.food = p.res.wood = p.res.stone = 5000; p.caps.food = p.caps.wood = p.caps.stone = 1e5; p.popMax = p.maxUnits = 200; p.res.skulls = 2000; }
const run = (s) => { for (let i = 0; i < s * 20; i++) G.step(1, 0.05); };
check('map has water', !!W.waterNav, { level: W.waterLevel });
const t = me.tribe.toLowerCase();
const hName = { hu: 'hu_harbour', ninigi: 'ninigi_harbour', aje: 'aje_floating_harbour', seas: 'seas_carrier' }[t];
// find the shore nearest to the HQ
const h = G.homeEntity();
let spot = null;
for (let r = 20; r < 300 && !spot; r += 8) for (let a = 0; a < 24 && !spot; a++) {
  const x = h.pos.x + Math.cos(a / 24 * 6.283) * r, z = h.pos.z + Math.sin(a / 24 * 6.283) * r;
  if (W.isWater(x, z, 1.5)) { const at = W.placement(hName, x, z, 0, me); if (at.ok) spot = at; }
}
check('harbour snaps to the coast', !!spot, spot);
if (!spot) return out.join('\n');
const hb = W.placeBuilding(hName, me, spot.x, spot.z, spot.rot, true);
W.entityFilters(hb, true); W.recomputeCaps(me);
// produce a fishing boat
const fa = D.actions(me).find((a) => a.kind === 'Build' && /fishing_boat/.test(a.id));
if (fa) {
  const why = W.queueAction(hb, fa);
  run(fa.time + 2);
  const boat = W.units.find((u) => u.alive && u.owner === me && /fishing_boat/.test(u.name));
  check('fishing boat built on the water', !!boat && W.isWater(boat.pos.x, boat.pos.z, 1), { why, pos: boat && [boat.pos.x | 0, boat.pos.z | 0] });
  const fish = W.resources.filter((n) => n.alive && n.water).sort((a, b) => Math.hypot(a.pos.x - hb.pos.x, a.pos.z - hb.pos.z) - Math.hypot(b.pos.x - hb.pos.x, b.pos.z - hb.pos.z))[0];
  if (boat && fish) {
    me.res.food = 0;                                         // room in the storage
    const f0 = me.res.food;
    W.order([boat], { type: 'gather', target: fish });
    run(120);
    check('fishing delivers food at the harbour', me.res.food > f0, { got: Math.round(me.res.food - f0), task: boat.task.type, phase: boat.task.phase, dist: Math.round(Math.hypot(fish.pos.x - hb.pos.x, fish.pos.z - hb.pos.z)) });
  } else check('fish shoal near the harbour', false, { fish: !!fish });
}
// transport ship
for (const id of ['age_2']) { const ag = D.actions(me).find((a) => a.kind === 'Upgrades' && a.id === id); if (ag) W.completeUpgrade(G.homeEntity(), ag); }
const ta = D.actions(me).find((a) => a.kind === 'Build' && /transport_(ship|boat|turtle)/.test(a.id));   // after age 2 (visibility filter)
if (ta) {
  const why = W.queueAction(hb, ta);
  run(ta.time + 2);
  const ship = W.units.find((u) => u.alive && u.owner === me && /transport/.test(u.name));
  check('transport ship built', !!ship, { why });
  if (ship) {
    const wk = W.units.filter((u) => u.alive && u.owner === me && u.cls === 'CHTR').slice(0, 2);
    W.order(wk, { type: 'board', target: ship });
    run(60);
    check('workers boarded the ship', wk.every((u) => u.inside === ship), wk.map((u) => [u.task.type, Math.round(Math.hypot(u.pos.x - ship.pos.x, u.pos.z - ship.pos.z))]));
    W.order([ship], { type: 'unload' });
    run(1);
    check('unloaded onto land', wk.every((u) => !u.inside && !W.isWater(u.pos.x, u.pos.z, 0.4)), wk.map((u) => [!!u.inside, u.pos.x | 0, u.pos.z | 0]));
  }
}
// Ninigi: minelayer lays a mine; an enemy ship sailing over it sets it off
const ml = D.actions(me).find((a) => a.kind === 'Build' && a.id === 'ninigi_minelayer');
if (ml) {
  W.queueAction(hb, ml); run(ml.time + 2);
  const layer = W.units.find((u) => u.alive && u.owner === me && u.name === 'ninigi_minelayer');
  const mineA = D.actions(me).find((a) => a.id === 'ninigi_mineship_mine');
  let spotM = null;
  for (let r = 10; r < 80 && !spotM; r += 4) for (let a = 0; a < 16 && !spotM; a++) { const x = layer.pos.x + Math.cos(a) * r, z = layer.pos.z + Math.sin(a) * r; if (W.isWater(x, z, 2)) spotM = [x, z]; }
  const why = layer && mineA && spotM ? W.layWaterThing(layer, mineA, spotM[0], spotM[1]) : 'no layer';
  run(25);
  const mine = W.units.find((u) => u.alive && u.name === 'ninigi_mineship_mine');
  check('minelayer laid a mine', !!mine, { why });
  if (layer && mineA && G.input) { me.res.food = me.res.wood = me.res.stone = 2000; const msgs = []; const hm = G.hud.message; G.hud.message = (m) => msgs.push(m); G.useAction(mineA, [layer]); G.hud.message = hm; check('mine button asks for a spot', G.input.mode === 'lay', { mode: G.input.mode, msgs, kind: layer.kind, naval: layer.naval, obj: mineA.results[0] }); G.input.setMode(null); }
  if (mine && ai.tribe !== 'SEAS') {   // SEAS have no SHIP (the hovercraft is a vehicle and doesn't trigger mines)
    const enemyShip = W.spawnUnit({ Hu: 'hu_fishing_boat', Aje: 'aje_transport_turtle', Ninigi: 'ninigi_fishing_boat' }[ai.tribe], ai, mine.pos.x + 20, mine.pos.z);
    W.order([enemyShip], { type: 'move', x: mine.pos.x, z: mine.pos.z });
    const hp0 = enemyShip.hp;
    run(15);
    check('mine blew up the enemy ship', !mine.alive && (!enemyShip.alive || enemyShip.hp < hp0), { mine: mine.alive, ship: enemyShip.alive, hp: enemyShip.hp });
  }
}
// harbours appear in the build menu on water maps
if (G.buildActions) check('harbour in the build menu', G.buildActions().some((a) => a.results[0].obj === hName), G.buildActions().map((a) => a.id).filter((x) => /harb|carrier/.test(x)));
// ships can be attacked by archers, not by melee
const arch = W.spawnUnit(ai.tribe.toLowerCase() + '_archer', ai, hb.pos.x, hb.pos.z + 30);
const boat2 = W.units.find((u) => u.alive && u.owner === me && u.naval);
if (boat2 && arch) check('ranged land units may target ships', W.canTarget(arch, boat2));
const war = W.spawnUnit(ai.tribe.toLowerCase() + '_warrior', ai, hb.pos.x, hb.pos.z + 30);
if (boat2 && war) check('melee land units ignore ships', !W.canTarget(war, boat2));
return out.join('\n');
