// Walking on walls, ladders, the siege tower (game/systems/wallwalk.js, siege.js; docs/spec/walls_walk.md):
// up an own walkable wall, along the walkway, the ranged protection, who can hit whom across the height, down again,
// the fall when the piece dies, a ladder against an enemy's wall, a siege tower docked to it.
//   python3 tests/evaljs.py tests/wallwalk.js "&tribe=Hu&enemy=Ninigi&debug"
const W = G.world, me = G.me, WM = W.wallMap, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (s) => G.step(Math.ceil(s / 0.05));
const until = (f, s) => { for (let t = 0; t < s; t += 0.25) { if (f()) return t; run(0.25); } return -1; };
for (const u of W.units) if (u.alive && u.wild) W.kill(u, null);
W.wildNests.length = 0;
const foe = W.players.find((p) => p !== me && me.isEnemy(p));
const FW = { Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', Hu: 'hu_warrior', SEAS: 'seas_warrior' }[foe.tribe], FWALL = { Aje: 'aje_clay_wall', Ninigi: 'ninigi_palisade', Hu: 'hu_small_wall' }[foe.tribe] || 'ninigi_palisade';
try {
const h = G.homeEntity();
// a clear area: a row of 6 tiles (own wall), 3 tiles further a row of 3 (the enemy's wall), free ground around
let ci = null, cj = null;
for (let r = 60; r < 400 && ci === null; r += 16) for (let a = 0; a < 16 && ci === null; a++) {
  const [i0, j0] = WM.tileOf(h.pos.x + Math.cos(a / 16 * 6.283) * r, h.pos.z + Math.sin(a / 16 * 6.283) * r);
  let ok = true;
  for (const [i, j] of [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [-2, 2], [2, 5], [3, 5], [4, 5], [2, 2], [3, 3], [4, 3], [5, 1], [1, 2], [2, 3]]) { if (!ok) break; const [x, z] = WM.centre(i0 + i, j0 + j); if (!W.canPlace('hu_small_wall', x, z, 0, me) || Math.abs(W.height(x, z) - W.height(...WM.centre(i0, j0))) > 5) ok = false; }
  if (ok) { ci = i0; cj = j0; }
}
out.push('area ' + ci + ',' + cj);
const T = (i, j) => WM.centre(ci + i, cj + j);
const pieces = [];
for (let i = 0; i < 6; i++) pieces.push(W.placeBuilding('hu_small_wall', me, ...T(i, 0), 0, true));
const pal = W.placeBuilding('hu_palisade', me, ...T(-2, 2), 0, true);
check('hu_small_wall is walkable, hu_palisade is not', W.walkableWall(pieces[2]) && !W.walkableWall(pal), (W.data.extra.walkableWalls || []).join(','));
check('the walkway: the pieces connect along their arms', (W.wallRoute([ci, cj], [ci + 5, cj]) || []).length === 6, (W.wallRoute([ci, cj], [ci + 5, cj]) || []).length);
const spawn = (name, x, z, owner = me) => { const c = W.nav.nearestFree(W.nav.idx(x, z), 8); const [fx, fz] = W.nav.center(c); return W.spawnUnit(name, owner, fx, fz, Math.max(1, W.data.minLevel(name, owner))); };
// ---- up
const [ax, az] = T(2, 2);
const archer = spawn('hu_archer', ax, az);
G.select([archer]);
G.input.orderOn(pieces[2], null, false);
check('a right click on the own wall: "use"', archer.task.type === 'wall' && archer.task.phase === 'up', archer.task.type);
let t = until(() => archer.onWall && !archer.wjump, 20);
const top = W.wallTop(ci + 2, cj);
check('the archer jumps up onto the walkway', t >= 0 && archer.onWall.i === ci + 2 && Math.abs(archer.pos.y - top) < 0.6, { t, y: +archer.pos.y.toFixed(2), top: +top.toFixed(2) });
check('on the wall: Defence_On_Wall ranged protection (50)', archer.wallDef === 50, archer.wallDef);
// ---- along
W.order([archer], { type: 'use', target: pieces[5] });
t = until(() => archer.onWall && archer.onWall.i === ci + 5 && !archer.wpath.length, 15);
check('along the walkway to another piece', t >= 0 && Math.abs(archer.pos.y - W.wallTop(ci + 5, cj)) < 0.6, { t, tile: archer.onWall });
// ---- who can hit whom
const [ex, ez] = T(5, 1);
const foeW = spawn(FW, ex + 1, ez, foe);
check('the archer on the wall shoots down at the warrior (zone 3)', W.rangeZone(archer, foeW).zone === 3, W.rangeZone(archer, foeW).zone);
check('the warrior can\'t reach the archer (the height) and does not take it as a target', W.rangeZone(foeW, archer).zone === 0 && W.rangeZone(foeW, archer).high && !W.canTarget(foeW, archer), [W.rangeZone(foeW, archer).zone, !!W.rangeZone(foeW, archer).high]);
foeW.invulnT = 1e9;
run(3);
check('it shoots from the wall and stays up there', archer.onWall && archer.task.type === 'attack' && archer.task.target === foeW, archer.task.type);
W.kill(foeW, null);
// ---- down
const [gx, gz] = T(4, 3);
W.order([archer], { type: 'move', x: gx, z: gz });
t = until(() => !archer.onWall && !archer.wjump && archer.task.type === 'idle', 25);
check('a ground order: along the walkway, a jump down, then the walk', t >= 0 && Math.hypot(archer.pos.x - gx, archer.pos.z - gz) < 3 && Math.abs(archer.pos.y - W.height(archer.pos.x, archer.pos.z)) < 0.3, { t, d: Math.hypot(archer.pos.x - gx, archer.pos.z - gz).toFixed(1) });
// ---- the fall
const war = spawn('hu_warrior', ...T(1, 2));
W.order([war], { type: 'use', target: pieces[1] });
until(() => war.onWall && !war.wjump, 20);
const hp0 = war.hp;
W.kill(pieces[1], null);
run(2);
check('the piece under it dies: it falls and is hurt', !war.onWall && war.alive && war.hp < hp0 && Math.abs(war.pos.y - W.height(war.pos.x, war.pos.z)) < 0.3, { lost: +(hp0 - war.hp).toFixed(1) });
// ---- a ladder against the enemy's wall
const enemyWall = [];
for (let i = 2; i < 5; i++) enemyWall.push(W.placeBuilding(FWALL, foe, ...T(i, 5), 0, true));
const [lx, lz] = T(3, 3);
const at = W.placement('hu_ladder', ...T(3, 5), 0, me, [lx, lz]);
check('a ladder goes to the side of the enemy\'s piece nearest the workers', at.ok && at.dock && at.dock[1] === cj + 5 && at.z < T(3, 5)[1], at);
const lad = W.placeBuilding('hu_ladder', me, at.x, at.z, at.rot, true);
W.ladderPlaced(lad, at.dock);
const E = W.siegeEntry(lad);
check('its foot on the ground, its top up at the wall', E.top.y - E.foot.y > 6 && Math.hypot(E.top.x - T(3, 5)[0], E.top.z - T(3, 5)[1]) < Math.hypot(E.foot.x - T(3, 5)[0], E.foot.z - T(3, 5)[1]), { foot: [E.foot.x, E.foot.z].map((v) => +v.toFixed(1)), top: [E.top.x, E.top.y, E.top.z].map((v) => +v.toFixed(1)) });
check('one siege object per piece', !W.placement('hu_ladder', ...T(3, 5), 0, me, [lx, lz]).ok, null);
const climber = spawn('hu_warrior', lx, lz);
G.select([climber]);
G.input.orderOn(lad, null, false);
check('a right click on the own ladder: "climb"', climber.task.type === 'climb', climber.task.type);
t = until(() => climber.onWall && !climber.climbing, 30);
check('up the ladder onto the enemy\'s walkway', t >= 0 && climber.onWall.j === cj + 5 && Math.abs(climber.pos.y - W.wallTop(climber.onWall.i, climber.onWall.j)) < 0.6, { t, tile: climber.onWall });
W.order([climber], { type: 'move', x: lx + 4, z: lz });
t = until(() => !climber.onWall && !climber.climbing && !climber.wjump && climber.task.type === 'idle', 30);
check('an enemy\'s wall: down only by the ladder', t >= 0 && Math.hypot(climber.pos.x - (lx + 4), climber.pos.z - lz) < 3, { t, d: Math.hypot(climber.pos.x - (lx + 4), climber.pos.z - lz).toFixed(1) });
// ---- a siege tower
W.kill(lad, null);
const tower = spawn('ninigi_siegetower', ...T(2, 3));
if (tower) {
  W.order([tower], { type: 'attack', target: enemyWall[0] });
  check('the siege tower told to attack a wall docks to it', tower.task.type === 'dock', tower.task.type);
  t = until(() => !!tower.docked, 40);
  check('docked after the walk and 2 s', t >= 0 && W.siegeAt(...enemyWall[0].tile) === tower, t);
  const pax = spawn('hu_warrior', tower.pos.x + 4, tower.pos.z);
  W.enterTransport(pax, tower);
  W.unloadAll(tower, false);
  const [wx, wz] = T(2, 5);
  const side = (x, z) => Math.sign(z - wz);
  check('its passengers get out on the far side of the wall', !pax.inside && side(pax.pos.x, pax.pos.z) !== side(tower.pos.x, tower.pos.z), { pax: [pax.pos.x, pax.pos.z].map(Math.round), tower: [tower.pos.x, tower.pos.z].map(Math.round) });
  W.order([tower], { type: 'move', x: tower.pos.x, z: tower.pos.z - 10 });
  check('a new order: it undocks first', tower.task.type === 'dock' && tower.task.phase === 'undock' && !tower.docked && !W.siegeAt(...enemyWall[0].tile), tower.task.phase);
  t = until(() => tower.task.type === 'move', 5);
  check('then the order', t >= 0, t);
}
} catch (e) { out.push('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')); }
return out.join('\n');
