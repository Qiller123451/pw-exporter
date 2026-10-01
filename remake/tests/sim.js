// Injected into the page by tests/sim.py: runs the simulation headless and reports the state of both players.
window.simReport = (secs) => {
  const W = G.world;
  const t0 = performance.now();
  let err = null;
  try { for (let i = 0; i < secs * 20; i++) G.step(1, 0.05); } catch (e) { err = e.stack || String(e); }
  const ms = performance.now() - t0;
  const sum = (p) => {
    const us = W.units.filter((u) => u.alive && u.owner === p), bs = W.buildings.filter((b) => b.alive && b.owner === p);
    const cnt = {}; for (const u of us) { const k = u.name + (u.level > 1 ? '@' + u.level : '') + ':' + u.task.type; cnt[k] = (cnt[k] || 0) + 1; }
    return { res: Object.fromEntries(Object.entries(p.res).map(([k, v]) => [k, Math.round(v)])), caps: p.caps, pop: p.units + '/' + p.maxUnits, epoch: p.epoch(),
      techs: [...p.techs].join(' '), kills: p.kills, lost: p.lost, defeated: p.defeated,
      units: cnt, blds: bs.map((b) => b.name + (b.built ? '' : '(' + Math.round(b.progress * 100) + '%)') + (b.queue.length ? '[' + b.queue.map((q) => q.action.id).join(',') + ']' : '') + (b.hp < b.maxHp ? ' ' + Math.round(b.hp / b.maxHp * 100) + '%hp' : '')) };
  };
  const wild = W.units.filter((u) => u.alive && !u.owner).length;
  return JSON.stringify({ time: Math.round(W.time), simMsPerGameSec: +(ms / secs).toFixed(1), err, me: sum(G.me), ai: sum(G.ai), wild,
    aiAttacking: G.aiBrain.attacking, waves: G.aiBrain.waves, projectiles: W.projectiles.length, events: W.events.length }, null, 1);
};
