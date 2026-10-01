// Map nests (run with tests/evaljs.py tests/nests.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/the%20river.ula"):
// pre-spawned animals per advance_time, respawn every spawn_rate after members die, never above spawn_max.
const W = G.world, out = [];
const run = (sec) => G.step(Math.ceil(sec / 0.25), 0.25);
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
check('map has nests', W.wildNests.length > 0, W.wildNests.length);
const n = W.wildNests.find((x) => x.members.length >= 2 && x.amount !== 0);
check('nest pre-spawned animals', !!n && n.members.length > 0, n && { species: n.species, live: n.members.length, max: n.max, rate: n.rate });
if (n) {
  const before = n.members.length;
  for (const u of [...n.members]) W.kill(u, null);
  run(1.5);
  check('members gone', n.members.length === 0, n.members.length);
  run(n.rate + 2);
  check('one respawned after spawn_rate', n.members.length === 1, { live: n.members.length, rate: n.rate });
  run(n.rate * (n.max + 2));
  check('refills up to max, not beyond', n.members.length === n.max, { live: n.members.length, max: n.max, before });
  check('respawned animals live at the nest', n.members.every((u) => Math.hypot(u.home.x - n.x, u.home.y - n.z) < 1), null);
}
const wild = W.units.filter((u) => u.alive && u.wild).length;
check('wild animals within the cap', wild <= 260, wild);
return out.join('\n');
