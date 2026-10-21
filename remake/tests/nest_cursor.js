// A campaign map's nest (a building of nobody: campaign/setup.js isNest) shows the attack cursor and is attacked on a
// right click, as the wild animals are (GameInputController.usl GetAction: IsEnemy holds for objects of nobody).
//   python3 tests/evaljs.py tests/nest_cursor.js "&campaign=1&notriggers"
const W = G.world, me = G.me, I = G.input, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
G.fow.revealAll = true;
const nest = W.buildings.find((b) => b.alive && b.isNest);
const cole = W.units.find((u) => u.alive && u.owner === me && /^cole/i.test(u.name));
check('mission 1 has a nest and Cole', !!nest && !!cole, nest && nest.name);
if (nest && cole) {
  W.teleport(cole, nest.pos.x + 12, nest.pos.z + 12);
  G.select([cole]);
  const c = I.cursorFor(nest, { x: nest.pos.x, z: nest.pos.z });
  check('Cole on the nest: the attack cursor (attack_walk: out of reach)', c === 'attack' || c === 'attack_walk', c);
  I.orderOn(nest, null, false);
  check('a right click attacks it', cole.task && cole.task.type === 'attack' && cole.task.target === nest, cole.task && cole.task.type);
}
return out.join('\n');
