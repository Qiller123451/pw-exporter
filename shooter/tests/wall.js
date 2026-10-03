// Border test (evaluated in the page): the districts that are not open must hold the player in - on foot, dashing
// and with the jetpack - and let him through once they are open; the rubble in a shut gap must be solid.
(() => {
  const P = G.player, Z = G.zones, I = G.input, out = {};
  for (const w of G.mission.obj.waves ? [1] : []) G.mission.obj = { ...G.mission.obj, waves: null };       // no enemies in the way
  const god = () => { for (const c of Object.values(P.chars)) { c.health = c.def.health; c.jet = c.def.jet.charges; } };
  let outside = 0;
  const run = (s, keys) => { for (const k of keys) I.press(k); G.test.run(s, () => { god(); for (const k of keys) if (k === 'KeyQ' || k === 'KeyC') I.press(k); if (!Z.allowedAt(P.pos.x, P.pos.z)) outside++; }); for (const k of keys) I.release(k); };
  // 1. the gate is shut: south is the wall
  P.yaw = Math.PI; run(4, ['KeyW']); out.walkedIntoGate = { z: +P.pos.z.toFixed(1), zone: Z.zoneAt(P.pos.x, P.pos.z) };
  P.pos.set(-43, P.pos.y, -262); run(3, ['KeyW', 'KeyQ']); out.jetIntoGate = { z: +P.pos.z.toFixed(1), y: +P.pos.y.toFixed(1), zone: Z.zoneAt(P.pos.x, P.pos.z) };
  P.pos.set(-43, P.pos.y, -262); run(2, ['KeyW', 'KeyC']); out.dashIntoGate = { z: +P.pos.z.toFixed(1), zone: Z.zoneAt(P.pos.x, P.pos.z) };
  // the edge of the field in the west
  P.pos.set(-120, G.level.collision.groundAt(-120, -290, 500), -290); P.yaw = Math.PI / 2; run(4, ['KeyW', 'KeyQ']); out.westEdge = { x: +P.pos.x.toFixed(1), zone: Z.zoneAt(P.pos.x, P.pos.z) };
  // 2. the camp burnt: the gate opens
  for (const t of G.mission.targets) t.damage(1e6, {});
  G.test.run(0.5); G.mission.obj = { ...G.mission.obj, waves: null };
  P.pos.set(-43, G.level.collision.groundAt(-43, -262, 500), -262); P.vel.set(0, 0, 0); P.yaw = Math.PI; run(4.5, ['KeyW']);
  out.throughGate = { z: +P.pos.z.toFixed(1), zone: Z.zoneAt(P.pos.x, P.pos.z), open: Z.open, doorsHidden: G.level.doorGate ? G.level.doorGate.doors.every((m) => !m.visible) : null };
  // 3. the rubble at the south exit of the gate square is solid, and behind it is the wall
  P.pos.set(-45, G.level.collision.groundAt(-45, -205, 500), -205); P.vel.set(0, 0, 0); P.yaw = Math.PI; run(3, ['KeyW']);
  out.intoRubble = { z: +P.pos.z.toFixed(1), zone: Z.zoneAt(P.pos.x, P.pos.z) };
  P.pos.set(-45, G.level.collision.groundAt(-45, -205, 500), -205); run(3, ['KeyW', 'KeyQ']);
  out.jetOverRubble = { z: +P.pos.z.toFixed(1), zone: Z.zoneAt(P.pos.x, P.pos.z) };
  out.stepsOutside = outside;
  out.ok = outside === 0 && out.walkedIntoGate.z < -247 && out.jetIntoGate.z < -247 && out.throughGate.z > -235 && out.intoRubble.z < -190 && out.jetOverRubble.z < -186;
  return out;
})()
