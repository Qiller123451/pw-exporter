// Damage limiter test (evaluated in the page): the budget, the armour gate and the last stand (CFG.protect).
// Also: how long each character survives standing still in a swarm of 60, with and without the limiters.
(async () => {
  const { CFG } = await import('/src/game/config.js');
  const P = G.player, E = G.enemies, I = G.input, out = {};
  G.mission.step = () => {};
  const reset = (id) => {
    if (P.dead) { P.dead = false; }
    if (P.active !== id) { P.ch.actor.obj.visible = false; P.active = id; P.ch.actor.obj.visible = true; }
    for (const c of Object.values(P.chars)) { c.alive = true; c.health = c.def.health; c.armor = c.def.armor * c.def.armorPip; c.budget = undefined; }
    P.invulnerable = 0; P.blast = null; P.ch.anim.unlock();
    for (const e of E.list.slice()) if (e.alive) E.recycle(e);
    P.pos.set(-43, G.level.collision.groundAt(-43, -290, 500), -290); P.vel.set(0, 0, 0);
    G.test.run(0.1);
  };
  const full = () => P.ch.def.health + P.ch.def.armor * P.ch.def.armorPip, now = () => P.ch.health + P.ch.armor;
  // 1. one enormous hit from full: only one armour segment goes
  reset('gunner');
  P.hurt(5000, null);
  out.hugeHitFromFull = { lost: Math.round(full() - now()), dead: P.dead, segment: P.def.armorPip };
  // 2. 40 hits of 20 per second for 3 s: the budget
  reset('gunner');
  const before = now();
  G.test.run(3, () => { P.invulnerable = 0; for (let k = 0; k < 2; k++) P.hurt(20, null); });
  out.hammered3s = { lost: Math.round(before - now()), allowed: Math.round((CFG.protect.budget.burst + 3 * CFG.protect.budget.perSecond) * P.def.health), dead: P.dead };
  // 3. last stand: no armour, 60 % health, a killing blow -> 1 health; the next one after the immunity kills
  reset('gunner');
  P.ch.armor = 0; P.ch.health = 60; P.ch.budget = 1e9;
  P.hurt(500, null);
  out.lastStand = { health: P.ch.health, dead: P.dead, immune: +P.invulnerable.toFixed(1) };
  G.test.run(CFG.protect.lastStand.time + 0.5); P.ch.budget = 1e9; P.hurt(500, null);
  out.afterLastStand = { dead: P.dead };
  // 4. standing still in a swarm
  const survive = (id, on) => {
    const saved = CFG.protect; if (!on) CFG.protect = null;
    reset(id);
    for (let k = 0; k < 60; k++) { const a = k / 60 * 6.283, r = 14 + (k % 5) * 3; E.spawn(['warrior', 'spearman', 'raptor', 'assassin', 'rammer'][k % 5], P.pos.x + Math.cos(a) * r, P.pos.y, P.pos.z + Math.sin(a) * r); }
    let t = 0;
    while (!P.dead && t < 60) { G.test.run(0.5); t += 0.5; }
    CFG.protect = saved;
    return P.dead ? t : '> 60';
  };
  for (const id of ['gunner', 'executioner']) out['swarm60_' + id] = { secondsWithout: survive(id, false), secondsWith: survive(id, true) };
  return out;
})()
