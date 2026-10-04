// Bombardment test (evaluated in the page; ?mission=assault to have allies in it).
// The Gunner stands in a ring of enemies (and among his own troops, if the mission has any) and calls the
// bombardment. Returns: how long the bombs fell, how many, how many enemies were hit and killed, damage to the player
// and to the troops (must both be 0), the cooldown, and that the key does nothing while it runs down or for the
// Executioner.
(() => {
  const P = G.player, E = G.enemies, A = G.allies, U = P.ch.def.ultimate, out = {};
  G.mission.step = () => {};
  const god = () => {};
  for (const e of E.list.slice()) if (e.alive && !e.def.structure) E.recycle(e);
  // enemies that stand still (held) all around, 8 - 40 u away
  const list = [];
  for (let k = 0; k < 60; k++) { const a = k / 60 * 6.283, r = 8 + (k % 6) * 6; const c = G.nav.nearest(P.pos.x + Math.cos(a) * r, P.pos.z + Math.sin(a) * r, P.pos.y, 3); if (c < 0) continue; const e = E.spawn('rammer', G.nav.cx(c), G.nav.y[c], G.nav.cz(c)); if (e) { e.hold(999); list.push(e); } }
  const hp0 = list.reduce((s, e) => s + e.hp, 0);
  let hurtP = 0; const oh = P.hurt.bind(P); P.hurt = (a, f, r) => { hurtP += a; };
  const allies = A ? A.list.filter((a) => a.alive) : []; const ahp0 = allies.reduce((s, a) => s + a.hp, 0);
  for (const a of allies) a.hurt = function (x) { this.hp -= x; };          // (keep them alive enough to measure; count every hit)
  out.enemies = list.length; out.troopsNear = allies.filter((a) => a.pos.distanceTo(P.pos) < U.radius).length;
  out.config = `${U.time} s, radius ${U.radius}, one bomb every ${U.every} s, cooldown ${U.cooldown} s`;
  // call it
  let bombs = 0, first = null, last = null; const ob = P._bomb.bind(P); P._bomb = (p, B) => { bombs++; if (first == null) first = G.time; last = G.time; return ob(p, B); };
  const t0 = G.time;
  G.input.press('KeyG'); G.test.run(0.1); G.input.release('KeyG');
  out.started = !!P.bombing; out.cooldownAfterCall = Math.round(P.ch.ultCd);
  // a second press while it runs down does nothing
  G.test.run(1); G.input.press('KeyG'); G.test.run(0.1); G.input.release('KeyG');
  const cdMid = P.ch.ultCd;
  G.test.run(6);
  out.bombs = bombs; out.firstBombAfter = +(first - t0).toFixed(2); out.lastBombAfter = +(last - t0).toFixed(2);
  out.enemyDamage = Math.round(hp0 - list.reduce((s, e) => s + Math.max(0, e.hp), 0)); out.enemiesKilled = list.filter((e) => !e.alive).length; out.enemiesHit = list.filter((e) => !e.alive || e.hp < e.maxHp).length;
  out.damageToPlayer = Math.round(hurtP); out.damageToTroops = Math.round(ahp0 - allies.reduce((s, a) => s + a.hp, 0));
  out.secondPressIgnored = cdMid > U.cooldown - 2 && !!cdMid;
  out.cooldownLeft = Math.round(P.ch.ultCd);
  // after the cooldown it is there again
  P.ch.ultCd = 0.05; G.test.run(0.2); G.input.press('KeyG'); G.test.run(0.1); G.input.release('KeyG'); out.againAfterCooldown = !!P.bombing; P.bombing = null;
  // the Executioner has none
  G.input.press('Tab'); G.test.run(0.3); G.input.release('Tab'); P.swapCd = 0;
  out.executioner = { active: P.active, hasUltimate: !!P.ch.def.ultimate }; G.input.press('KeyG'); G.test.run(0.1); G.input.release('KeyG'); out.executioner.started = !!P.bombing;
  out.error = G.error || null;
  return out;
})()
