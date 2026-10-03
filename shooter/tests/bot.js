// Test bot (evaluated in the page by tests/shot.mjs): aims at the nearest enemy and holds the trigger.
// window.BOT = { seconds, weapon, class, move } may be set by the test before this file is evaluated.
(() => {
  const o = window.BOT || {};
  const P = G.player, log = [];
  if (o.class && P.active !== o.class) { P.swapCd = 0; P.swap(); }
  if (o.weapon != null) P.setWeapon(o.weapon);
  const aim = (g) => {
    let best = null, bd = 1e9;
    for (const e of g.enemies.list) { if (!e.alive) continue; const d = e.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = e; } }
    if (!best) { g.input.mouseUp(0); return; }
    // aim through the camera (it sits over the shoulder, not in the head)
    const cp = G.engine.camera.position;
    const dx = best.pos.x - cp.x, dz = best.pos.z - cp.z, dy = best.pos.y + best.def.height * (o.head ? 0.9 : 0.6) - cp.y;
    P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    if (bd < (o.range || 150)) g.input.mouseDown(0); else g.input.mouseUp(0);
    if (o.execute && g.enemies.executable(P.pos, { x: -Math.sin(P.yaw), z: -Math.cos(P.yaw) }, 9)) g.input.press('KeyE');
    if (o.move) { g.input.press('KeyW'); } 
  };
  const total = o.seconds || 20;
  for (let t = 0; t < total; t += 5) { const s = G.test.run(Math.min(5, total - t), aim); log.push(s); if (s.error || s.state !== 'play') break; }
  const states = {};
  for (const e of G.enemies.list) states[e.type + ':' + e.state] = (states[e.type + ':' + e.state] || 0) + 1;
  return { log: log.map((s) => `t=${s.time} pos=${s.pos.map(Math.round)} hp=${s.health} ar=${s.armor} ${s.weapon}:${s.ammo} alive=${s.alive} bodies=${s.bodies} kills=${s.kills} obj=${s.objective} ${s.state}${s.dead ? ' DEAD' : ''} ${s.error || ''}`),
    states, stats: P.stats, error: G.error || null };
})()
