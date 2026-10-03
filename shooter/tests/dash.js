// Dash test (evaluated in the page): how far each character dashes, that nothing hurts during the dash, and that the
// Executioner's dash rams: every enemy in its path is hit exactly once.
(() => {
  const P = G.player, E = G.enemies, I = G.input, out = {};
  G.mission.step = () => {};
  for (const id of ['gunner', 'executioner']) {
    if (P.active !== id) { P.swapCd = 0; I.press('Tab'); G.test.run(0.3); }
    const def = P.def;
    for (const e of E.list.slice()) if (e.alive) E.recycle(e);
    P.pos.set(-43, G.level.collision.groundAt(-43, -290, 500), -290); P.vel.set(0, 0, 0); P.yaw = 0; P.ch.dashCd = 0; P.busy = 0;
    G.test.run(0.3);
    // five warriors in a row along the dash, one far off to the side
    const row = [4, 6.5, 9, 11.5, 14].map((d) => E.spawn('warrior', P.pos.x + (d % 2 ? 0.6 : -0.6), P.pos.y, P.pos.z - d));
    const aside = E.spawn('warrior', P.pos.x + 12, P.pos.y, P.pos.z - 7);
    const hp0 = row.map((e) => e.hp), z0 = P.pos.z, h0 = P.ch.health, a0 = P.ch.armor;
    I.press('ControlLeft');
    let hurtTries = 0, vulnerableSteps = 0, steps = 0;
    G.test.run(def.dash.time + 0.02, () => { if (P.dashT > 0) { steps++; if (P.invulnerable <= 0) vulnerableSteps++; P.hurt(50, null); hurtTries++; } });
    out[id] = {
      configured: `${def.dash.speed} u/s for ${def.dash.time} s = ${(def.dash.speed * def.dash.time).toFixed(1)} u`,
      moved: +(z0 - P.pos.z).toFixed(1),
      damageTakenFromHitsDuringDash: +(h0 - P.ch.health + a0 - P.ch.armor).toFixed(1), hitsTried: hurtTries, stepsNotImmune: vulnerableSteps,
      enemiesInPathHit: row.filter((e, i) => e.hp < hp0[i] || !e.alive).length + ' of ' + row.length,
      damageEach: row.map((e, i) => Math.round(hp0[i] - Math.max(0, e.hp))), killed: row.filter((e) => !e.alive).length,
      bystanderHit: aside.hp < aside.maxHp,
    };
    G.test.run(0.5);
  }
  return out;
})()
