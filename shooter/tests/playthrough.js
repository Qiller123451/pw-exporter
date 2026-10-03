// Play-through bot (evaluated in the page by tests/shot.mjs): plays the mission from start to end.
//   window.PLAY = { minutes: 12, god: true }   may be set before this file is evaluated.
// The bot walks along its own flow field to "reach" objectives, shoots the nearest enemy through the camera, picks
// the weapon for the situation, executes reeling enemies, swaps characters when hurt and uses the jetpack when stuck.
// Returns a log line per 10 game seconds, the objective times and the final state.
(async () => {
  const { NavGrid } = await import('/src/game/nav.js');
  const o = window.PLAY || {};
  const P = G.player, M = G.mission, E = G.enemies;
  const nav = new NavGrid(G.level.collision, G.level.size, { cell: G.nav.cell });
  nav.y = G.nav.y; nav.links = G.nav.links;                // same streets, own distance field
  const dir = { x: 0, z: 0 };
  let flowFor = -1, stuck = 0, last = P.pos.clone(), lastT = 0;
  const times = [], log = [];
  let objIndex = M.index, objStart = 0;
  const bot = (g, t) => {
    if (o.god) { for (const c of Object.values(P.chars)) { c.health = c.def.health; c.alive = true; } }
    if (M.index !== objIndex) { times.push({ objective: objIndex, seconds: +(g.time - objStart).toFixed(0), kills: M.totalKills }); objIndex = M.index; objStart = g.time; }
    const ob = M.obj;
    if (!ob || P.dead) return;
    const I = g.input;
    // nearest enemy (the boss first when it is close)
    let best = null, bd = 1e9, near = 0;
    for (const e of E.list) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(P.pos) - (e.def.elite ? 20 : 0);
      if (d < 18) near++;
      if (d < bd) { bd = d; best = e; }
    }
    const c = P.ch;
    // character and weapon
    if (!o.noSwap && c.health < c.def.health * 0.35 && P.swapCd <= 0) { const other = Object.values(P.chars).find((x) => x !== c && x.alive && x.health > x.def.health * 0.4); if (other) I.press('Tab'); }
    if (best) {
      const d = best.pos.distanceTo(P.pos);
      let w = 0;
      if (P.active === 'gunner') w = best.def.elite && c.weapons[2].ammo > 0 ? 2 : near >= 3 && c.weapons[1].ammo > 15 ? 1 : d > 25 && near < 2 && c.weapons[2].ammo > 2 ? 2 : 0;
      else w = d < 11 ? 0 : 1;
      if (c.def.aimToShoot) { if (w === 1) I.mouseDown(2); else I.mouseUp(2); }      // minigun = hold the aim button
      else if (w !== c.wi) I.press('Digit' + (w + 1));
      const cp = g.engine.camera.position;
      const dx = best.pos.x - cp.x, dz = best.pos.z - cp.z, dy = best.pos.y + best.def.height * 0.6 - cp.y;
      P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      if (d < 110 && (d < 30 || best.los())) I.mouseDown(0); else I.mouseUp(0);
      if (E.executable(P.pos, { x: -Math.sin(P.yaw), z: -Math.cos(P.yaw) }, 9)) I.press('KeyE');
      if (P.active === 'gunner' && d < 4.5 && near > 2 && Math.random() < 0.05) I.press('KeyF');
    } else I.mouseUp(0);
    // movement
    I.release('KeyW'); I.release('KeyS');
    const far = Math.hypot(P.pos.x - ob.pos[0], P.pos.z - ob.pos[1]);
    if (ob.type === 'reach' || far > ob.radius * 0.6 || (best && bd > 60)) {
      const tx = ob.type === 'reach' || far > ob.radius * 0.6 || !best ? ob.pos[0] : best.pos.x, tz = ob.type === 'reach' || far > ob.radius * 0.6 || !best ? ob.pos[1] : best.pos.z;
      if (flowFor !== M.index * 1000 + (best && bd > 60 && ob.type !== 'reach' && far <= ob.radius * 0.6 ? 1 : 0) || g.time - lastT > 2) {
        flowFor = M.index * 1000 + (best && bd > 60 && ob.type !== 'reach' && far <= ob.radius * 0.6 ? 1 : 0); lastT = g.time;
        nav.flowTo(tx, null, tz, 3000);
      }
      nav.dir(P.pos.x, P.pos.z, dir);
      if (dir.x || dir.z) {
        // walk along the flow while still aiming at the enemy: turn the keys, not the view, when there is a target
        if (!best || bd > 45) { P.yaw = Math.atan2(-dir.x, -dir.z); I.press('KeyW'); I.release('KeyA'); I.release('KeyD'); }
        else {
          const f = { x: -Math.sin(P.yaw), z: -Math.cos(P.yaw) }, r = { x: -f.z, z: f.x };
          const a = dir.x * f.x + dir.z * f.z, b = dir.x * r.x + dir.z * r.z;
          if (a > 0.3) I.press('KeyW'); else if (a < -0.3) I.press('KeyS');
          if (b > 0.3) { I.press('KeyD'); I.release('KeyA'); } else if (b < -0.3) { I.press('KeyA'); I.release('KeyD'); } else { I.release('KeyA'); I.release('KeyD'); }
        }
      }
      // stuck: jetpack over it
      if (Math.floor(t * 30) % 30 === 0) { if (P.pos.distanceTo(last) < 2) { stuck++; if (stuck >= 2) { I.press('KeyQ'); stuck = 0; } } else stuck = 0; last.copy(P.pos); }
    } else { I.release('KeyA'); I.release('KeyD'); }
  };
  const total = (o.minutes || 10) * 60;
  for (let t = 0; t < total; t += 10) {
    const s = G.test.run(10, bot);
    log.push(`t=${s.time} obj=${s.objective} ${s.class} pos=${s.pos.map(Math.round)} hp=${s.health} ar=${s.armor} ${s.weapon}:${s.ammo} alive=${s.alive} kills=${s.kills} ${s.state}${s.dead ? ' DEAD' : ''}${s.error ? ' ERR ' + s.error : ''}`);
    if (s.error || s.state !== 'play') break;
    await new Promise((r) => setTimeout(r, 0));
  }
  return { log, times, stats: P.stats, final: G.test.state(), mission: { done: M.done, kills: M.totalKills, time: Math.round(M.time) }, error: G.error || null };
})()
