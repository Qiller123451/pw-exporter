// Targets test (evaluated in the page): in every "destroy" objective each target can be hurt and destroyed by a
// plain bullet hit, and nothing that looks like a target is left standing as scenery.
(() => {
  const M = G.mission, P = G.player, out = { scenery: G.level.objects.filter((o) => o.model && G.missionReserved.test(o.model) && o.solid !== 'target').map((o) => o.model), objectives: [] };
  const god = () => { for (const c of Object.values(P.chars)) { c.health = c.def.health; c.alive = true; } P.invulnerable = 9; };
  for (let guard = 0; guard < 40 && M.obj; guard++) {
    const o = M.obj; god();
    if (o.type === 'destroy') {
      const rec = { text: o.text, targets: [] };
      for (const t of M.targets) {
        const hp = t.hp, zone = G.zones.zoneAt(t.pos.x, t.pos.z);
        // a ray from 20 u away at half height: does it hit this target, and does a bullet's damage arrive?
        const from = t.pos.clone(); from.x += 20; from.y += t.def.height * 0.4;
        const hit = G.enemies.raycast(from, { x: -1, y: 0, z: 0 }, 40, 0);
        t.damage(17, { kind: 'bullet', point: t.pos });
        rec.targets.push({ name: t.def.name, at: [Math.round(t.pos.x), Math.round(t.pos.z)], inOpenZone: zone <= G.zones.open, rayHitsIt: !!hit && hit.enemy === t, lost: Math.round(hp - t.hp) });
        t.damage(1e6, { kind: 'bullet' });
      }
      rec.allDestroyed = M.targets.every((t) => !t.alive);
      out.objectives.push(rec);
    }
    for (const b of M.bosses) if (b.alive) b.damage(1e7, {});
    if (o.type === 'kill') M.kills = o.count;
    if (o.type === 'hold') M.held = o.seconds;
    if (o.type === 'reach') P.pos.set(o.pos[0], G.level.collision.groundAt(o.pos[0], o.pos[1], 500), o.pos[1]);
    G.test.run(0.4);
    if (G.state !== 'play') break;
  }
  out.finished = M.done;
  return out;
})()
