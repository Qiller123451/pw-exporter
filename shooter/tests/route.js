// Route test (evaluated in the page): no enemies; the player walks to every objective along the nav flow field.
// Reports for each objective whether it was reached, how long it took, and where the walker got stuck.
(() => {
  const P = G.player, M = G.mission, out = [];
  const cfgObjs = (window.ROUTE && window.ROUTE.objectives) || G.missionObjectives || [];
  G.mission.obj = null;                                   // no waves
  if (G.zones) G.zones.setOpen(99, false);                // every district open: this test is about the streets
  const cls = (window.ROUTE && window.ROUTE.class) || 'gunner';
  if (P.active !== cls) { P.swapCd = 0; P.swap(); }
  const dir = { x: 0, z: 0 };
  for (const o of cfgObjs) {
    const y = G.level.collision.groundAt(o.pos[0], o.pos[1], 500);
    G.nav.flowTo(o.pos[0], y, o.pos[1], 2000);
    const c = G.nav.index(P.pos.x, P.pos.z);
    const rec = { text: o.text, target: [o.pos[0], +y.toFixed(1), o.pos[1]], onNav: G.nav.walkable(G.nav.index(o.pos[0], o.pos[1])), dist: Math.round(G.nav.distAt(G.nav.nearest(P.pos.x, P.pos.z, P.pos.y, 6))), reached: false, time: 0, stuck: [] };
    let still = 0, last = P.pos.clone();
    for (let t = 0; t < 150 && !rec.reached; t += 0.5) {
      G.test.run(0.5, (g) => {
        g.flowT = 1e9;                                    // keep this test's flow field (the game aims it at the player)
        G.nav.dir(P.pos.x, P.pos.z, dir);
        if (dir.x || dir.z) P.yaw = Math.atan2(-dir.x, -dir.z);
        g.input.press('KeyW');
      });
      rec.time = t + 0.5;
      if (Math.hypot(P.pos.x - o.pos[0], P.pos.z - o.pos[1]) < o.radius) rec.reached = true;
      if (P.pos.distanceTo(last) < 1.0) { still++; if (still === 4) { rec.stuck.push(P.pos.toArray().map(Math.round).join(',')); G.input.press('Space'); } if (still > 12) break; } else still = 0;
      last.copy(P.pos);
    }
    rec.end = P.pos.toArray().map(Math.round).join(',');
    out.push(rec);
    if (!rec.reached) { P.pos.set(o.pos[0], y, o.pos[1]); P.vel.set(0, 0, 0); P.onGround = true; }   // carry on from the objective
  }
  G.input.release('KeyW');
  return out;
})()
