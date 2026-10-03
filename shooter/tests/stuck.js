// Where does the swarm get stuck? The player stands (invulnerable, not shooting) at a few places of the city while
// groups of Dustriders are spawned around; every enemy that is chasing but has not moved 2 u in 4 s, away from the
// player, is reported with the scenery next to it.
//   window.STUCK = { spots: [[x, z], ...], seconds: 40, mix: {warrior: 1} }
(() => {
  const o = window.STUCK || {};
  const P = G.player, E = G.enemies, M = G.mission, col = G.level.collision;
  if (G.zones) G.zones.setOpen(99, false);                    // every district open: this is about the streets
  const spots = o.spots || G.missionObjectives.filter((q) => q.type === 'reach' || q.type === 'hold').map((q) => q.pos);
  const mix = o.mix || { warrior: 3, spearman: 2, archer: 1, raptor: 2, assassin: 1, rammer: 1, thrower: 1, dilo: 1 };
  const out = [];
  M.step = () => {};                                         // no mission logic: only what this test spawns
  for (const [sx, sz] of spots) {
    for (const e of E.list.slice()) if (e.alive) { e.hp = 0; e.die({ kind: 'test' }, P.pos.clone().set(0, 0, 0)); }
    G.test.run(0.5);
    P.pos.set(sx, col.groundAt(sx, sz, 500), sz); P.vel.set(0, 0, 0);
    G.flowT = 0;
    const track = new Map(), stuck = new Map();
    const v0 = E.vaults || 0; E.vaultLog = [];
    let spawned = 0;
    const each = (g, t) => {
      for (const c of Object.values(P.chars)) { c.health = c.def.health; c.alive = true; }
      P.invulnerable = 5;
      if (Math.floor(t * 30) % 60 === 0 && E.alive < (o.max || 70)) spawned += M.spawnGroup(o.group || 12, mix);
      if (Math.floor(t * 30) % 30 !== 0) return;
      for (const e of E.list) {
        if (!e.alive) continue;
        let r = track.get(e);
        if (!r) track.set(e, r = { x: e.pos.x, z: e.pos.z, t: g.time });
        const far = Math.hypot(e.pos.x - P.pos.x, e.pos.z - P.pos.z);
        if (Math.hypot(e.pos.x - r.x, e.pos.z - r.z) > 2 || e.state !== 'chase' || far < 14 || (e.def.ranged && e.def.ranged.keep && far < e.def.ranged.keep + 3)) { r.x = e.pos.x; r.z = e.pos.z; r.t = g.time; continue; }
        if (g.time - r.t > 4 && !stuck.has(e)) stuck.set(e, { kind: e.kind || e.def.name, x: +e.pos.x.toFixed(1), y: +e.pos.y.toFixed(1), z: +e.pos.z.toFixed(1), far: Math.round(far) });
      }
    };
    G.test.run(o.seconds || 40, each);
    const list = [...stuck.values()];
    for (const s of list) {
      s.near = G.level.objects.filter((q) => q.model && Math.hypot(q.x - s.x, q.z - s.z) < 7).map((q) => `${q.model}${q.solid ? '' : '(soft)'}@${Math.hypot(q.x - s.x, q.z - s.z).toFixed(1)}`).slice(0, 8);
    }
    out.push({ spot: [sx, sz], cells: G.nav.cells, wideCells: G.navBig ? G.navBig.cells : 0, vaults: (E.vaults || 0) - v0, vaultAt: E.vaultLog.map((v) => v.join(' ')), spawned, alive: E.alive, stuck: list.length, list: list.slice(0, 25) });
  }
  return out;
})()
