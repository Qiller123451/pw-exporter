// Pathing stress test (run with tests/evaljs.py): a ring of buildings, units ordered through it in both
// directions. Reports how many arrive, how many end up stuck, and how many stand inside blocked cells.
const W = G.world, me = G.me, nav = W.nav;
const h = G.homeEntity();
const X = h.pos.x + 60, Z = h.pos.z + 60;
for (const p of W.players) { p.res.food = p.res.wood = p.res.stone = 1e5; p.popMax = p.maxUnits = 200; }
const tribe = me.tribe.toLowerCase();
const blds = { hu: ['hu_stone_cottage', 'hu_warehouse', 'hu_arena', 'hu_lumberjack_cottage'], aje: ['aje_tent', 'aje_temple', 'aje_small_farm', 'aje_rodeo'],
  ninigi: ['ninigi_fireplace', 'ninigi_dojo', 'ninigi_lumbermill', 'ninigi_temple'], seas: ['seas_small_tent', 'seas_barracks', 'seas_warehouse', 'seas_garage'] }[tribe];
let placed = 0;
// a dense block of buildings around (X, Z): each one at the nearest free spot of a spiral
for (let i = 0; i < 10; i++) {
  const n = blds[i % blds.length];
  if (!W.data.exists(n)) continue;
  for (let k = 0; k < 600; k++) {
    const a = k * 2.4, r = 2 + k * 0.08, x = X + Math.cos(a) * r, z = Z + Math.sin(a) * r;
    let ok = false; try { ok = W.canPlace(n, x, z, 0, me); } catch (e) { break; }
    if (ok) { W.placeBuilding(n, me, x, z, 0, true); placed++; break; }
  }
}
const units = [];
const kinds = [tribe + '_worker', W.data.exists(tribe + '_warrior') ? tribe + '_warrior' : tribe + '_worker'];
for (let i = 0; i < 24; i++) {
  const side = i % 2 ? 1 : -1;
  const u = W.spawnUnit(kinds[i % 2], me, X + side * 40 + (i % 4) * 2, Z - 6 + (i % 6) * 2);
  u.target = [X - side * 40, Z + ((i % 5) - 2) * 3];
  units.push(u);
}
for (const u of units) W.order([u], { type: 'move', x: u.target[0], z: u.target[1] });
const track = new Map(units.map((u) => [u, { last: u.pos.clone(), still: 0 }]));
let inBlocked = 0;
for (let s = 0; s < 60 * 20; s++) {
  G.step(1, 0.05);
  if (s % 20 === 0) for (const u of units) {
    const t = track.get(u);
    if (u.task.type === 'move' && u.pos.distanceTo(t.last) < 0.3) t.still++; else t.still = 0;
    t.last.copy(u.pos);
    if (nav.block[nav.idx(u.pos.x, u.pos.z)]) inBlocked++;
  }
}
const arrived = units.filter((u) => Math.hypot(u.pos.x - u.target[0], u.pos.z - u.target[1]) < 6).length;
const stuck = units.filter((u) => track.get(u).still >= 5).map((u) => [u.name, +u.pos.x.toFixed(1) - X, +u.pos.z.toFixed(1) - Z, u.task.type, u.path.length]);
const blockedNow = units.filter((u) => nav.block[nav.idx(u.pos.x, u.pos.z)]).length;
const far = units.filter((u) => Math.hypot(u.pos.x - u.target[0], u.pos.z - u.target[1]) >= 6).map((u) => [+Math.hypot(u.pos.x - u.target[0], u.pos.z - u.target[1]).toFixed(1), u.task.type, u.path.length]);
return JSON.stringify({ far, placed, arrived, total: units.length, stuck, blockedNow, inBlockedSamples: inBlocked });
