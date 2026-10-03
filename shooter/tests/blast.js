// The Executioner's end (evaluated in the page; start with &class=executioner): when it is destroyed it folds down,
// then blows up - huge damage to the enemies around, none to the Gunner who takes over.
(() => {
  const P = G.player, E = G.enemies, out = {};
  G.mission.step = () => {};
  for (const e of E.list.slice()) if (e.alive) E.recycle(e);
  P.pos.set(-43, G.level.collision.groundAt(-43, -290, 500), -290); G.test.run(0.2);
  const B = P.def.deathBlast;
  const near = [5, 10, 16, 22].map((d) => E.spawn('rammer', P.pos.x + d, P.pos.y, P.pos.z));
  const far = E.spawn('rammer', P.pos.x + B.radius + 12, P.pos.y, P.pos.z);
  const hp0 = near.map((e) => e.hp);
  out.clipSeconds = +P.ch.anim.duration(P.def.death).toFixed(2);
  const other = Object.values(P.chars).find((c) => c !== P.ch), oh = other.health, oa = other.armor;
  P.hurt(1e6, null, true);
  out.dead = P.dead; out.blastIn = P.blast ? +P.blast.t.toFixed(2) : null; out.takeOverIn = +P.deathT.toFixed(2);
  let t = 0, blownAt = null;
  while (t < 6 && (P.dead || P.blast)) { G.test.run(0.1, () => { for (const e of E.list) e.cool = 9; }); t += 0.1; if (blownAt == null && !P.blast) blownAt = +t.toFixed(1); }
  out.blownAtSeconds = blownAt;
  out.damageByDistance = near.map((e, i) => `${[5, 10, 16, 22][i]} u: ${Math.round(hp0[i] - Math.max(0, e.hp))}${e.alive ? '' : ' (dead)'}`);
  out.outsideRadiusHurt = far.hp < far.maxHp;
  out.nowPlaying = P.active; out.gunnerLost = +(oh - other.health + oa - other.armor).toFixed(1); out.wreckVisible = P.chars.executioner.actor.obj.visible;
  return out;
})()
