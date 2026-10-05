// Ride test (evaluated in the page by tests/shot.mjs, ?mission=frost): the war mammoth.
//   window.RIDE = { objective: 7 }
// Skips to the objective that is done on the mammoth, checks that the player sits on it, rides it to every target
// (the ballista towers, the gate of the pass - which nothing but a siege blow hurts) and strikes; returns what was
// destroyed and how long it took, and that the player is on foot again when the next objective begins.
(() => {
  const o = window.RIDE || {}, P = G.player, M = G.mission, I = G.input, out = { steps: [] };
  const god = () => { for (const c of Object.values(P.chars)) { c.health = c.def.health; c.alive = true; } if (P.ride && !P.ride.dead) P.ride.hp = P.ride.def.health; };
  for (let n = 0; M.index < (o.objective ?? 7) && n < 60; n++) {
    for (const t of M.targets) if (t.alive) { t.locked = false; t.damage(1e7, { kind: 'siege' }); } for (const b of M.bosses) if (b.alive) b.damage(1e7, {});
    const ob = M.obj; if (ob.type === 'kill') M.kills = ob.count; if (ob.type === 'hold') M.held = ob.seconds; if (ob.type === 'reach') P.pos.set(ob.pos[0], G.level.collision.groundAt(ob.pos[0], ob.pos[1], 500), ob.pos[1]);
    god(); G.test.run(0.4);
  }
  out.objective = M.index; out.ride = P.ride ? P.ride.id : null; out.targets = M.targets.map((t) => t.type);
  // a gun does next to nothing to the gate: try it (as the Gunner's bullets would)
  const gate = M.targets.find((t) => t.def.armour);
  if (gate) { const hp = gate.hp; gate.damage(100, { kind: 'bullet' }); out.bullet100 = +(hp - gate.hp).toFixed(1); gate.damage(100, { kind: 'siege' }); out.siege100 = +(hp - gate.hp - out.bullet100).toFixed(1); }
  const t0 = G.time;
  // out of the pens along the lane and through the village (window.RIDE.via = [[x, z] ...]), at the charge
  for (const [x, z] of o.via || [[218, 168], [172, 158], [110, 170], [20, 150], [-10, 120]]) {
    for (let k = 0; k < 20 && P.ride && Math.hypot(x - P.pos.x, z - P.pos.z) > 14; k++) G.test.run(0.5, () => { god(); P.yaw = Math.atan2(-(x - P.pos.x), -(z - P.pos.z)); P.pitch = -0.1; I.press('KeyW'); I.press('ShiftLeft'); });
    out.steps.push(`t=${(G.time - t0).toFixed(0)} via ${x},${z}: at ${Math.round(P.pos.x)},${Math.round(P.pos.z)}`);
  }
  for (let k = 0; k < 40 && P.ride; k++) {
    const tg = M.targets.filter((q) => q.alive).sort((a, b) => a.pos.distanceTo(P.pos) - b.pos.distanceTo(P.pos))[0];
    if (!tg) break;
    G.test.run(3, () => {
      god(); if (!P.ride) return;
      const dx = tg.pos.x - P.pos.x, dz = tg.pos.z - P.pos.z, d = Math.hypot(dx, dz) - tg.def.radius - P.ride.def.radius;
      P.yaw = Math.atan2(-dx, -dz); P.pitch = -0.1;
      if (d > 3) I.press('KeyW'); else I.release('KeyW');
      if (d > 30) I.press('ShiftLeft'); else I.release('ShiftLeft');
      if (d < 8) I.mouseDown(0); else I.mouseUp(0);
    });
    out.steps.push(`t=${(G.time - t0).toFixed(0)} at ${Math.round(P.pos.x)},${Math.round(P.pos.z)} left ${M.targets.filter((q) => q.alive).map((q) => q.type + ':' + Math.round(q.hp)).join(' ')}`);
  }
  for (const k of ['KeyW', 'ShiftLeft']) I.release(k); I.mouseUp(0);
  G.test.run(1, god);
  out.seconds = +(G.time - t0).toFixed(0); out.after = { objective: M.index, ride: P.ride ? P.ride.id : null, onFoot: !P.ride && P.ch.actor.obj.visible, zoneOk: G.zones.allowedAt(P.pos.x, P.pos.z) };
  out.error = G.error || null;
  return out;
})()
