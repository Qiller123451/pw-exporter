// A big unit standing where its clearance does not fit (a black widow at the foot of a dune in mission 4) walks the
// narrow way to the start of its path instead of walking on the spot (entities.js setPath lead).
// python3 tests/evaljs.py tests/big_unit_start.js "&campaign=4&tribe=SEAS&difficulty=1"
const me = G.me, W = G.world;
const u = W.spawnUnit('seas_wehrspinne', me, 352.0, 436.0, 3, 0);
if (!u) return 'FAIL no widow';
u.invulnT = 1e9; u.stance = 3;
const p0 = u.pos.clone();
G.order([u], { type: 'move', x: u.pos.x + 30, z: u.pos.z + 20 });
G.step(200);
const d = u.pos.distanceTo(p0);
return (d > 5 ? 'ok ' : 'FAIL ') + `the widow moved ${d.toFixed(1)} m in 10 s (radius ${u.radius.toFixed(1)})`;
