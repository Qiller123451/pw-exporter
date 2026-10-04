// Allies test (evaluated in the page, ?mission=assault): how the SEAS troops do on their own.
//   window.ALLY = { objective: 5, seconds: 60 }
// The player stands still at the objective and does nothing (and cannot die). Returns per 10 s: enemies killed by
// the troops, troops lost and sent, enemies alive - the troops should hold a while but not win the fight alone.
(() => {
  const o = window.ALLY || {}, P = G.player, M = G.mission, A = G.allies, E = G.enemies;
  const god = () => { for (const c of Object.values(P.chars)) { c.health = c.def.health; c.alive = true; } };
  let n = 0;
  while (M.index < (o.objective ?? 5) && n++ < 60) { for (const t of M.targets) if (t.alive) t.damage(1e6, {}); for (const b of M.bosses) if (b.alive) b.damage(1e7, {}); const ob = M.obj; if (ob.type === 'kill') M.kills = ob.count; if (ob.type === 'hold') M.held = ob.seconds; if (ob.type === 'reach') P.pos.set(ob.pos[0], G.level.collision.groundAt(ob.pos[0], ob.pos[1], 500), ob.pos[1]); god(); G.test.run(0.4); }
  for (const e of E.list.slice()) if (e.alive && !e.def.structure) E.recycle(e);
  const ob = M.obj; P.pos.set(ob.pos[0], G.level.collision.groundAt(ob.pos[0], ob.pos[1], 500), ob.pos[1]);
  M.held = -1e9;                                              // (a hold objective must not end by itself)
  const rows = [], k0 = M.totalKills, l0 = A.lost, s0 = A.sent;
  let hurt = 0; const oh = P.hurt.bind(P); P.hurt = (a, f, r) => { hurt += a; return oh(a, f, r); };
  for (let t = 10; t <= (o.seconds || 60); t += 10) {
    G.test.run(10, god);
    rows.push({ t, killedByTroops: M.totalKills - k0, ownKills: M.ownKills, troopsLost: A.lost - l0, troopsSent: A.sent - s0, troopsAlive: A.alive, enemiesAlive: E.fighting, hitsOnPlayer: Math.round(hurt) });
  }
  const types = {}; for (const a of A.list) if (a.alive) types[a.type] = (types[a.type] || 0) + 1;
  const tg = { player: 0, ally: 0 }; for (const e of E.list) if (e.alive && !e.def.structure) tg[e.target ? 'ally' : 'player']++;
  return { objective: M.index, text: ob.text, rows, types, enemiesAfter: tg, error: G.error || null };
})()
