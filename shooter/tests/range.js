// Weapon range test (evaluated in the page): a held enemy is put straight ahead at several distances on open
// ground, the weapon fires at it for a second. Bullets must hit inside the weapon's `range` and not beyond it;
// a rocket goes off by itself at its `reach`.
(() => {
  const P = G.player, E = G.enemies, col = G.level.collision, out = {};
  G.mission.step = () => {};
  const god = () => { for (const c of Object.values(P.chars)) { c.health = c.def.health; c.alive = true; } };
  const clear = () => { for (const e of E.list.slice()) if (e.alive) E.recycle(e); };
  const shootAt = (dist, aim) => {
    clear();
    const f = { x: -Math.sin(P.yaw), z: -Math.cos(P.yaw) };
    const e = E.spawn('rammer', P.pos.x + f.x * dist, P.pos.y + 40, P.pos.z + f.z * dist);      // (in the air: nothing in between)
    e.hold(999); e.step = () => {}; const hp = e.hp;
    const cp = G.engine.camera.position;
    G.test.run(0.2, () => { god(); P.pitch = Math.atan2(e.pos.y + 2.5 - cp.y, Math.hypot(e.pos.x - cp.x, e.pos.z - cp.z)); });
    G.test.run(1.2, () => { god(); P.pitch = Math.atan2(e.pos.y + 2.5 - cp.y, Math.hypot(e.pos.x - cp.x, e.pos.z - cp.z)); if (aim) G.input.mouseDown(2); G.input.mouseDown(0); });
    G.input.mouseUp(0); G.input.mouseUp(2); G.test.run(2.2, god);
    return Math.round(hp - e.hp);
  };
  const w = P.weapon.def;
  if (P.active === 'gunner') {
    out.machineGun = { range: w.range, damageAt: {} };
    for (const d of [40, 90, 115, 200]) out.machineGun.damageAt[d] = shootAt(d);
    G.input.press('Digit3'); G.test.run(0.3, god); G.input.release('Digit3');
    const r = P.weapon.def;
    // where do rockets go off when nothing is in the way?
    let at = []; const ex = G.explode.bind(G); G.explode = (p, ...a) => { at.push(Math.round(p.distanceTo(P.pos))); return ex(p, ...a); };
    out.rocket = { reach: r.reach, damageAt: {} };
    for (const d of [80, 200]) out.rocket.damageAt[d] = shootAt(d);
    out.rocket.wentOffAt = at;
  } else {
    const mini = P.ch.weapons.find((x) => x.def.kind === 'bullet').def;
    out.minigun = { range: mini.range, damageAt: {} };
    for (const d of [40, 75, 100, 200]) out.minigun.damageAt[d] = shootAt(d, true);
  }
  out.error = G.error || null;
  return out;
})()
