// Flight test (evaluated in the page by tests/shot.mjs, ?mission=frost): the gunship.
//   window.FLIGHT = { objective: 14, seconds: 260, god: true }
// Skips to the objective that is flown, lets a bot fly to the nearest target, aim the guns at it and fire, and returns every
// 15 s where the machine is (leg of the course, height above the ground), what it has taken and what is left -
// and at the end that it has landed and the player is on foot inside the fortress.
(() => {
  const o = window.FLIGHT || {}, P = G.player, M = G.mission, I = G.input, out = { rows: [] };
  const god = () => { for (const c of Object.values(P.chars)) { c.health = c.def.health; c.alive = true; } if (o.god !== false && P.ride && !P.ride.dead) P.ride.hp = P.ride.def.health; };
  for (let n = 0; M.index < (o.objective ?? 14) && n < 60; n++) {
    for (const t of M.targets) if (t.alive) { t.locked = false; t.damage(1e7, { kind: 'siege' }); } for (const b of M.bosses) if (b.alive) b.damage(1e7, {});
    const ob = M.obj; if (ob.type === 'kill') M.kills = ob.count; if (ob.type === 'hold') M.held = ob.seconds; if (ob.type === 'reach') P.pos.set(ob.pos[0], G.level.collision.groundAt(ob.pos[0], ob.pos[1], 500), ob.pos[1]);
    god(); G.test.run(0.4);
  }
  const R = P.ride;
  out.objective = M.index; out.ride = R ? R.id : null; out.targets = M.targets.length;
  if (!R || !R.fly) return out;
  let t = 0, last = -99, clear = 1e9, taken = 0, hits = 0;
  const hurt = R.hurt.bind(R); R.hurt = (a, f) => { taken += a; hits++; return hurt(a, f); };
  const flying = M.index;
  G.test.run(o.seconds || 260, () => {
    god(); t += 1 / 30;
    if (!P.ride || M.index !== flying) return;
    const tg = M.targets.filter((q) => q.alive).sort((a, b) => a.pos.distanceTo(P.pos) - b.pos.distanceTo(P.pos))[0];
    if (tg) {
      const cp = G.engine.camera.position, dx = tg.pos.x - cp.x, dz = tg.pos.z - cp.z, dy = tg.pos.y + tg.def.height * 0.5 - cp.y, d = tg.pos.distanceTo(P.pos);
      P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      if (d < 190) I.mouseDown(0); else I.mouseUp(0);
      if (d < 240) I.mouseDown(2); else I.mouseUp(2);
      // free flight (W A S D, Space, C): towards the target, circle it at 60..110, 35 above it
      for (const k of ['KeyW', 'KeyS', 'KeyD', 'Space', 'KeyC']) I.release(k);
      if (R.leg === 'free') { if (d > 110) I.press('KeyW'); else if (d < 60) I.press('KeyS'); I.press('KeyD'); if (P.pos.y < tg.pos.y + 30) I.press('Space'); else if (P.pos.y > tg.pos.y + 45) I.press('KeyC'); }
    } else { I.mouseUp(0); I.mouseUp(2); for (const k of ['KeyW', 'KeyS', 'KeyD', 'Space', 'KeyC']) I.release(k); }
    if (R.leg !== 'home' && R.leg !== 'out') clear = Math.min(clear, P.pos.y - Math.max(G.level.height(P.pos.x, P.pos.z), G.level.water));
    if (t - last >= 15) { last = t; out.rows.push(`t=${t.toFixed(0)} ${R.leg} ${Math.round(R.s)} at ${Math.round(P.pos.x)},${Math.round(P.pos.y)},${Math.round(P.pos.z)} hp ${Math.round(R.hp)} hit ${hits}x ${Math.round(taken)} left ${M.targets.filter((q) => q.alive).length}`); }
  });
  I.mouseUp(0); I.mouseUp(2);
  out.lowestOverGround = +clear.toFixed(1); out.hits = hits; out.damageTaken = Math.round(taken);
  out.after = { objective: M.index, ride: P.ride ? P.ride.id : null, landed: R.landed, pos: [Math.round(P.pos.x), Math.round(P.pos.z)], onFoot: !P.ride && P.ch.actor.obj.visible, dead: P.dead };
  out.error = G.error || null;
  return out;
})()
