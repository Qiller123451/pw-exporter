// Checkpoint test (evaluated in the page; open it with ?from=<objective>, optionally &mission=assault).
// Returns where the mission stands right after it was taken up at that objective: the objective, the open zones, where
// the player is and whether he may be there, what of the earlier objectives' targets is still standing (nothing
// should), the troops - and after 20 s of the bot standing and shooting, that the game still runs.
// Also: which objectives are checkpoints, and that storing / reading one works.
(() => {
  const M = G.mission, P = G.player, Z = G.zones, list = G.missionObjectives, out = {};
  const Mission = M.constructor;
  out.checkpoints = list.map((o, i) => (o.checkpoint ? i + ': ' + o.text : null)).filter(Boolean);
  out.objective = M.index + ': ' + M.obj.text; out.resumed = M.resumed; out.banner = M.checkpoint;
  out.zonesOpen = Z.list.slice(0, Z.open + 1).map((z) => z.id).join(', ');
  out.player = [Math.round(P.pos.x), Math.round(P.pos.y), Math.round(P.pos.z)]; out.playerAllowed = Z.allowedAt(P.pos.x, P.pos.z); out.onNav = G.nav.nearest(P.pos.x, P.pos.z, P.pos.y, 1) >= 0;
  out.toGoal = Math.round(Math.hypot(P.pos.x - M.goalPos[0], P.pos.z - M.goalPos[1]));
  // targets of the objectives before: none may be left
  let left = 0; const save = M.targets;
  for (let i = 0; i < M.index; i++) if (list[i].type === 'destroy') { M.targets = []; for (const t of list[i].targets) if (t.near || t.zone) M.pickStanding(t); left += M.targets.length; }
  M.targets = save; out.earlierTargetsLeft = left;
  out.structures = G.enemies.structs; out.troops = G.allies ? G.allies.alive : 'none';
  out.health = Object.values(P.chars).map((c) => c.def.name + ' ' + Math.round(c.health) + '/' + c.def.health);
  // storing
  const key = 'pwshooter.checkpoint', old = localStorage.getItem(key), id = G.missionDef.id, cp = list.findIndex((o) => o.checkpoint);
  Mission.store(id, cp); out.storedReadsBack = Mission.stored(id) === cp; Mission.store(id, 3); out.nonCheckpointRefused = Mission.stored(id) === 0; Mission.store(id, 0); out.cleared = localStorage.getItem(key) === null;
  if (old != null) localStorage.setItem(key, old);
  const god = () => { for (const c of Object.values(P.chars)) { c.health = c.def.health; c.alive = true; } };
  const s = G.test.run(20, god);
  out.after20s = { objective: s.objective, state: s.state, enemies: s.alive, error: s.error };
  return out;
})()
