// Helpers for the scripted campaign playthroughs (tests/campaign_play_NN.js start with "// include: campaign_bot.js",
// tests/evaljs.py puts this file in front). A playthrough is a list of steps [name, act each second, done, seconds
// allowed]; runSteps() drives them and report() prints the result. The helpers play with whatever tribe the mission
// runs with (game/campaign/tribes.js): own(cls) is the player's equivalent of a class the mission names.
//
// Cheats that keep a run short and deterministic (a player needs none of them), all counted in the report:
// heal the player's units, enemies near the player's fighters lose hit points (cheats()), a group that makes no
// progress towards a goal for 60 s is teleported (go()), resources topped up for a goal (topUp()).
const C = G.campaign, W = G.world, E = C.engine, D = C.debug, R = C.objects, Ru = G.data, me = G.me;
const out = [];
const ok = (c, m) => out.push(`${c ? 'ok' : 'FAIL'} ${m}`);
const info = (m) => out.push('   ' + m);
const stats = { teleports: 0, kills: 0, topUps: 0 };
const ui = { seq: [], dlg: [], quest: [] };
{
  const M = G.mission, ps = M.playSequence.bind(M), pd = M.playDialog.bind(M), qc = M.questChanged.bind(M);
  M.playSequence = (s, o, e) => { ui.seq.push((s ? s.id : '?') + '@' + Math.round(W.time)); return ps(s, o, e); };
  M.playDialog = (s, e) => { ui.dlg.push((s ? s.id : '?') + '@' + Math.round(W.time)); return pd(s, e); };
  M.questChanged = (q, c) => { ui.quest.push(q.name.slice(0, 16) + ':' + c + '@' + Math.round(W.time)); return qc(q, c); };
}
// ---------------------------------------------------------------- what is there
const own = (cls) => { const e = C.swap ? C.swap.equivalent(cls) : undefined; return e === undefined ? cls : e; };   // null: no equivalent
const mine = () => W.units.filter((u) => u.alive && u.owner === me && !u.parked && !u.inside);
const myBuildings = () => W.buildings.filter((b) => b.alive && b.owner === me);
const fighters = () => mine().filter((u) => !u.isWorker && !u.cannotFight);      // not the Aje resource collector, carts, transports ...
const workers = () => mine().filter((u) => u.isWorker);
const heroes = () => mine().filter((u) => u.def && u.def.unique);
const unit = (cls) => W.units.find((u) => u.alive && u.name === cls && u.owner === me) || null;
const building = (cls) => myBuildings().find((b) => b.name === own(cls)) || null;
const fired = (n) => D.fired(n) > 0;
const quest = (n) => D.quests().find((q) => q.name === n);
const questState = (n) => { const x = quest(n); return x ? (x.accomplished ? 'done' : x.unaccomplishable ? 'failed' : x.visible ? 'open' : 'hidden') : '?'; };
const regionC = (name) => { const r = C.regions.find(name); return r ? r.center() : null; };
const inRegion = (e, name) => { const r = C.regions.find(name); return !!r && r.contains(e.pos.x, e.pos.z); };
const named = (n) => { const r = R.byName(n); return r && r.entity && r.entity.alive ? r.entity : null; };
// ---------------------------------------------------------------- orders
const stuck = new Map();
// send units to a map point; a unit that does not get closer for 60 s is teleported there (reported)
function go(units, mx, my, key = 'all') {
  units = units.filter(Boolean);
  const [x, z] = C.toGame(mx, my);
  const far = units.filter((u) => Math.hypot(u.pos.x - x, u.pos.z - z) > 6);
  for (const u of far) {
    const d = Math.hypot(u.pos.x - x, u.pos.z - z);
    const s = stuck.get(u) || { d: 1e9, t: W.time, at: '' };
    const at = mx + ',' + my;
    if (s.at !== at || d < s.d - 2) { s.d = d; s.t = W.time; s.at = at; }
    stuck.set(u, s);
    if (W.time - s.t > 60) { C.teleport(u.rec || u, mx, my); stats.teleports++; info(`teleport (${key}: ${u.name}) to ${at} at ${Math.round(W.time)} s`); s.t = W.time; s.d = 0; continue; }
    const k = u.task;
    if (k.type === 'move' && Math.abs(k.x - x) < 1 && Math.abs(k.z - z) < 1) continue;
    W.order([u], { type: 'move', x: x + (u.id % 3 - 1) * 1.5, z: z + ((u.id >> 2) % 3 - 1) * 1.5 });
    u.task.x = x; u.task.z = z;
  }
  return !far.length;
}
const goRegion = (units, name, key) => { const c = regionC(name); if (!c) throw new Error('no region ' + name); const [mx, my] = C.toMap(c[0], c[1]); return go(units, Math.round(mx), Math.round(my), key); };
// go after the nearest living target that passes the filter (the cheat damage helps)
function hunt(units, filter, key) {
  units = units.filter(Boolean);
  let best = null, bd = 1e9;
  const c = units[0];
  if (!c) return false;
  for (const e of [...W.units, ...W.buildings]) {
    if (!e.alive || e.parked || e.inside || !filter(e)) continue;
    const d = Math.hypot(e.pos.x - c.pos.x, e.pos.z - c.pos.z);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return false;
  if (bd - (best.radius || 0) < 25) { for (const u of units) if (u.task.type !== 'attack' || u.task.target !== best) W.order([u], { type: 'attack', target: best }); return true; }
  const [mx, my] = C.toMap(best.pos.x, best.pos.z);
  go(units, Math.round(mx), Math.round(my), key);
  return true;
}
// the player's units are healed (and those of opts.friends kept above 80 %); enemies within 12 m of a fighter lose a
// fifth of their hit points per call (opts.spare(e): leave that one alone)
function cheats(opts = {}) {
  const M = mine();
  for (const u of M) u.hp = u.maxHp;
  for (const p of opts.friends || []) for (const u of W.units) if (u.alive && u.owner === p) u.hp = Math.max(u.hp, u.maxHp * 0.8);
  if (opts.noDamage) return;
  const F = M.filter((u) => !u.isWorker);
  if (!F.length) return;
  const near = (e) => F.some((u) => Math.hypot(u.pos.x - e.pos.x, u.pos.z - e.pos.z) < 12 + (e.radius || 0));
  for (const e of [...W.units, ...W.buildings]) {
    if (!e.alive || e.parked || e.inside || e.untargetable || e.invulnT > 0 || !F[0].isEnemy(e) || !near(e)) continue;
    if (!e.owner && e.kind === 'unit' && e.def && e.def.aggressive !== 1 && !/Smilodon|Dilophosaurus/.test(e.name)) continue;      // peaceful wildlife is left alone
    if (opts.spare && opts.spare(e)) continue;
    W.setHp(e, e.hp - e.maxHp * 0.2);
    if (!e.alive) stats.kills++;
  }
}
// ---------------------------------------------------------------- economy
// the action that makes class `cls` (a building, a unit, an upgrade id) for the player
function actionFor(cls, kind = 'Build') {
  const want = String(cls).toLowerCase();
  return Ru.actions(me).find((a) => a.kind === kind && (a.id.toLowerCase() === want || a.results.some((r) => String(r.obj).toLowerCase() === want))) || null;
}
// put up buildings of class cls (the player's equivalent) near map point (mx, my) with `workers` workers each until
// the player has `count` of them (standing or being built): true then, else the reason it cannot start (cost, req,
// place ...) or 'started'. region: only places inside that region
function build(cls, mx, my, { workers: n = 2, count = 1, region = null } = {}) {
  const c = own(cls);
  if (!c) return 'none';
  if (myBuildings().filter((b) => b.name === c && (!region || inRegion(b, region))).length >= count) return true;
  const a = actionFor(c);
  if (!a) return 'no action';
  const [x0, z0] = C.toGame(mx, my);
  for (let k = 0; k < 400; k++) {                // up to 206 m away: a crowded village leaves no room for a big one (another tribe's)
    const r = 6 + k * 0.5, ang = k * 2.4;
    // (turned a quarter when it does not fit as it is: a long building in a narrow place)
    let pl = W.placement(c, x0 + Math.cos(ang) * r, z0 + Math.sin(ang) * r, 0, me);
    if (!pl.ok && !pl.replace && !pl.existing) pl = W.placement(c, x0 + Math.cos(ang) * r, z0 + Math.sin(ang) * r, Math.PI / 2, me);
    if (!pl.ok || pl.replace || pl.existing) continue;
    if (region && !C.regions.find(region).contains(pl.x, pl.z)) continue;
    const ws = workers().sort((u, v) => Math.hypot(u.pos.x - pl.x, u.pos.z - pl.z) - Math.hypot(v.pos.x - pl.x, v.pos.z - pl.z)).slice(0, n);
    const b = W.startConstruction(me, a, pl.x, pl.z, pl.rot, ws);
    return typeof b === 'string' ? b : 'started';
  }
  // no room around the spot: the nearest free place anywhere the player may build (an 8 m grid over the map)
  if (!region) {
    const H = W.size / 2, cand = [];
    for (let x = -H + 16; x < H - 16; x += 8) for (let z = -H + 16; z < H - 16; z += 8) cand.push([Math.hypot(x - x0, z - z0), x, z]);
    cand.sort((p, q) => p[0] - q[0]);
    for (const [, x, z] of cand) {
      const pl = W.placement(c, x, z, 0, me);
      if (!pl.ok || pl.replace || pl.existing) continue;
      const ws = workers().sort((u, v) => Math.hypot(u.pos.x - pl.x, u.pos.z - pl.z) - Math.hypot(v.pos.x - pl.x, v.pos.z - pl.z)).slice(0, n);
      const b = W.startConstruction(me, a, pl.x, pl.z, pl.rot, ws);
      return typeof b === 'string' ? b : 'started';
    }
  }
  return 'place';
}
// queue n units / upgrades of class cls at whatever of the player's offers it (buildings, and units that produce:
// the Dustriders' resource collector); returns how many were queued. An upgrade that waits for buildings
// (the Dragon Clan's epochs need a lumber mill and a dojo) gets them built near the main building.
function produce(cls, n = 1, kind = 'Build') {
  const c = (own(cls) || cls).toLowerCase();
  let k = 0, blocked = null;
  for (const b of [...myBuildings(), ...mine().filter((u) => !u.isWorker)]) {
    if (b.kind === 'building' && !b.built) continue;
    for (const a of Ru.actionsOf(me, b)) {
      if (a.kind !== kind || a.cat === 'Build/BLDG' || !(a.id.toLowerCase() === c || a.results.some((r) => String(r.obj).toLowerCase() === c))) continue;
      const ck = Ru.check(me, a, b.kind === 'unit' ? b : null);
      if (ck === 'req' || ck === 'hidden') { blocked = a; continue; }        // hidden: shown only from the epoch it needs
      // an upgrade the player cannot pay yet that also costs skulls (the Dustriders' epochs): the skulls are topped
      // up (a cheat, counted) - a player would hunt for them
      if (kind === 'Upgrades' && a.cost.skulls > me.res.skulls) topUp({ skulls: a.cost.skulls });
      while (k < n && W.queueAction(b, a) === null) k++;
      if (k >= n) return k;
    }
  }
  // what it waits for: a building is put up, an epoch researched (the Dustriders' warriors come with epoch 2)
  if (!k && blocked) prerequisites(blocked, kind === 'Upgrades');
  // nothing the player has makes it: put up a building that does (the Norse barracks for warriors)
  if (!k && !blocked) {
    const a = Ru.actions(me).find((x) => x.kind === kind && x.cat !== 'Build/BLDG' && (x.id.toLowerCase() === c || x.results.some((r) => String(r.obj).toLowerCase() === c)));
    const at = a && a.locs.map((l) => l.at).find((n) => Ru.info(n) && Ru.info(n).type === 'BLDG');
    if (at) build(at, ...homeAt());
  }
  return k;
}
// what an action waits for: a building is put up, an epoch researched (the Dustriders' warriors and the Dragon
// Clan's second hammock come with epoch 2)
function prerequisites(a, noEpoch = false) {
  for (const m of Ru.missing(me, a)) {
    if (Ru.info(m) && Ru.info(m).type === 'BLDG') build(m, ...homeAt());
    else if (/^age_\d$/.test(m) && !noEpoch) produce(m, 1, 'Upgrades');
  }
}
// room for more units when the population limit is (nearly) reached: the Dragon Clan's hammocks at the fireplace
// (+5 each), the other tribes' houses (cottage, tent, barracks). true when something was started
function housing() {
  if (me.units + me.queuedUnits < me.maxUnits - 1) return false;
  let later = null;
  for (const b of myBuildings()) {
    if (!b.built) continue;
    for (const a of Ru.actionsOf(me, b)) {
      if (a.kind !== 'Upgrades' || !/hammock/.test(a.id)) continue;
      const ck = Ru.check(me, a, null);
      if (ck === null && W.queueAction(b, a) === null) return true;
      if ((ck === 'req' || ck === 'hidden') && !later) later = a;
    }
  }
  const h = own('hu_stone_cottage');
  if (!h) { if (later) prerequisites(later); return false; }       // the next hammock waits for an epoch
  // one house at a time: while one is going up, its builders stay on it (a new site every call took them away and
  // none was ever finished: mission 15's seven Dustrider tents)
  const site = myBuildings().find((b) => b.name === h && !b.built);
  if (site) {
    if (![...site.builders].some((w) => w.alive && w.task.type === 'build' && w.task.building === site)) {
      const ws = workers().sort((u, v) => u.distTo(site) - v.distTo(site)).slice(0, 2);
      if (ws.length) W.order(ws, { type: 'build', target: site });
    }
    return false;
  }
  return build(h, ...homeAt(), { count: myBuildings().filter((b) => b.name === h).length + 1 }) === 'started';
}
// the player's main building on the map (map coordinates), for placing buildings
function homeAt() {
  const h = myBuildings().find((b) => b.def && /CFireplace/.test(b.def.script || '')) || myBuildings()[0] || mine()[0];
  return h ? C.toMap(h.pos.x, h.pos.z).map(Math.round) : [0, 0];
}
// workers gather: gather('food') sends the idle ones to food; gather({ food: 300, wood: 300, stone: 300 }) sends idle
// workers and those gathering something already reached to what is still missing; gather() does that for a stock
// of 500 food, 400 wood, 300 stone (and keeps idle workers busy with what there is least of)
function gather(goal = { food: 500, wood: 400, stone: 300 }) {
  const only = typeof goal === 'string' ? goal : null, want = goal && !only ? goal : null;
  const need = (r) => (want ? (want[r] || 0) - me.res[r] : -me.res[r]);
  let order = only ? [only] : ['food', 'wood', 'stone'].filter((r) => !want || need(r) > 0).sort((a, b) => need(b) - need(a));
  if (!order.length) order = ['food', 'wood', 'stone'].sort((a, b) => me.res[a] - me.res[b]);
  for (const w of workers()) {
    const t = w.task;
    if (t.type !== 'idle' && !(want && t.type === 'gather' && need(t.res) <= 0 && need(order[0]) > 0)) continue;
    for (const r of order) {
      const n = W.nearestResource(w.pos.x, w.pos.z, r, 250);
      if (n) { W.order([w], { type: 'gather', target: n }); break; }
    }
  }
}
// promote one of the player's units (heroes first) a level; true when one was promoted
function promote() {
  if (!W.changeLevel) return false;               // (the mock world of campaign_play_mock.mjs has no levels)
  for (const u of [...heroes(), ...fighters()]) if (u.level < 5 && W.changeLevel(u, u.level + 1) === null) return true;
  return false;
}
// at least this much of each resource (a cheat, counted)
function topUp(res) {
  let any = false;
  for (const k in res) if (me.res[k] < res[k]) { me.res[k] = res[k]; any = true; }
  if (any) stats.topUps++;
}
// ---------------------------------------------------------------- camera (UNTT CAME conditions)
function camera(kind) {
  const c = G.rtscam;
  if (kind === 'scroll') { c.x += 4; c.z += 2; } else if (kind === 'zoom') { c.dist = (c.dist || 40) * 0.8; if (c.tDist != null) c.tDist = c.dist; } else if (kind === 'pan') c.yaw += 0.3;
}
// ---------------------------------------------------------------- running
const reached = [];
let failedAt = null;
// the Dustriders' mobile base the mission starts with waits for the player (campaign/setup.js freeMains): put it down
// where it would have stood, or the nearest free place
function placeFreeMains() {
  for (const u of [...(me.freeMains || [])]) {
    for (let k = 0; k < 400; k++) {
      const r = k * 0.5, ang = k * 2.4, x = u.pos.x + Math.cos(ang) * r, z = u.pos.z + Math.sin(ang) * r;
      if (C.placeFreeMain(u, x, z, 0)) break;
    }
  }
}
function runSteps(steps, opts = {}) {
  let err = null;
  placeFreeMains();
  try {
    for (let i = 0; i < steps.length; i++) {
      const [name, act, done, limit] = steps[i];
      const t0 = W.time;
      let okStep = false;
      while (W.time - t0 < limit && !G.over) {
        if (done()) { okStep = true; break; }
        try { act(); } catch (e) { if (!/null|undefined/.test(String(e))) throw e; }      // a unit the step needs is not there (yet)
        if (opts.cheats !== false) cheats(opts.cheatOpts || {});
        G.step(20, 0.05);
      }
      if (!okStep && done()) okStep = true;
      reached.push(okStep);
      ok(okStep, `${String(i + 1).padStart(2)}. ${name} (${Math.round(W.time - t0)} s, at ${Math.round(W.time)} s)`);
      if (!okStep) { failedAt = i; break; }
    }
  } catch (e) { err = e.stack || String(e); }
  ok(!err, 'no exception' + (err ? ': ' + err : ''));
  return reached.filter(Boolean).length;
}
function report(why = {}) {
  ok(C.errors.length === 0, `no action errors (${C.errors.length})`);
  const S = D.summary();
  ok(S.unknownConditions.length + S.unknownActions.length === 0, 'no unknown condition / action type');
  info(`tribe ${me.tribe}${C.swap ? ' (mission: ' + C.missionTribe + ')' : ''}; game time ${Math.round(W.time / 60)} min; teleports ${stats.teleports}; cheat kills ${stats.kills}; top-ups ${stats.topUps}`);
  info(`triggers fired ${S.firedTriggers} of ${S.triggers}, ${S.firings} firings, ${S.actions} actions, warnings ${C.warnings.length}`);
  info('quests: ' + D.quests().map((x) => x.name.slice(0, 18) + '=' + questState(x.name)).join(' '));
  info('sequences: ' + ui.seq.join(' '));
  info('player: ' + Object.entries(mine().reduce((m, u) => { m[u.name] = (m[u.name] || 0) + 1; return m; }, {})).map(([k, n]) => k + ' x' + n).join(', ') + '; buildings ' + myBuildings().map((b) => b.name).join(' ') + '; res ' + JSON.stringify(me.res));
  for (const e of C.errors.slice(0, 10)) info('error ' + JSON.stringify(e));
  for (const w of C.warnings.slice(0, 20)) info('warning ' + w);
  if (!G.over && failedAt != null) {
    info('log tail:\n' + D.print(30));
    info('units of the player: ' + mine().map((u) => `${u.name}@${C.toMap(u.pos.x, u.pos.z).map(Math.round)}:${u.task.type}`).join(' '));
    info('live triggers: ' + D.live().map((r) => r.name + '[' + r.conditions + ']').join(' | ').slice(0, 3000));
    const t = why[failedAt + 1];
    if (t) info('why ' + t + ': ' + JSON.stringify(D.why(t)));
  }
  return out.join('\n');
}
