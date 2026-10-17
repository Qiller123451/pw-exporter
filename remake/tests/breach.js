// Attackers break through the enemy's gates that shut their way (nav.find breach, Unit.setPath, World unit update):
// mission 13's SEAS spider walkers sent from their base to the front of the city wall attack the player's skewer
// gate in the pass (the cliffs of the map's walk grid leave no way round). python3 tests/evaljs.py tests/breach.js "&campaign=13&notriggers"
const C = G.campaign, W = G.world, nav = W.nav;
const out = [];
const [gx, gz] = C.toGame(800, 370), [sx, sz] = C.toGame(830, 735);
const hq = C.objects.byName('seas_headquarters_7'), seas = hq && hq.entity ? hq.entity.owner : null;
const sp = seas ? [0, 1].map((k) => W.spawn("seas_wehrspinne", seas, sx + k * 16, sz)).filter(Boolean) : [];
const plain = nav.find(sx, sz, gx, gz, 0.7, 200000, seas), plainFound = nav.found;
const b = nav.find(sx, sz, gx, gz, 0.7, 200000, seas, true);
out.push(`${!plainFound && nav.found && b && b.gate ? 'ok' : 'FAIL'} the way from the SEAS base is shut by ${b && b.gate ? b.gate.name : 'nothing'} (plain path found: ${plainFound})`);
W.order(sp, { type: 'attackmove', x: gx, z: gz });
let hit = null;
for (let s = 0; s < 240 && !hit; s++) {
  G.step(20, 0.05);
  const a = sp.find((u) => u.alive && u.task.type === 'attack' && u.task.target && /gate/.test(u.task.target.name));
  if (a) hit = a.task.target;
}
out.push(`${hit ? 'ok' : 'FAIL'} the spider walkers attack ${hit ? hit.name : 'no gate'} (${sp.length} sent, ${Math.round(W.time)} s)`);
return out.join('\n');
