// Mission 5 "The Holy City" played by script: the three heroes cross the city to the temple, free the three
// support points from the pirates (rodeo, animal farm, then the weapon smith), and fight their way to the harbour.
//   python3 tests/evaljs.py tests/campaign_play_05.js "&campaign=5"         (node tests/campaign_play_mock.mjs 5: the trigger chain alone)
// Cheats: the player's units are healed every second; enemy units and buildings within 14 m of a player's fighter
// lose a fifth of their hit points per second; a group that makes no progress for 60 s is teleported (reported).
const C = G.campaign, W = G.world, E = C.engine, D = C.debug, R = C.objects, out = [];
const ok = (c, m) => out.push(`${c ? 'ok' : 'FAIL'} ${m}`);
const info = (m) => out.push('   ' + m);
const ui = { seq: [], dlg: [], quest: [] };
{
  const M = G.mission, ps = M.playSequence.bind(M), pd = M.playDialog.bind(M), qc = M.questChanged.bind(M);
  M.playSequence = (s, o, e) => { ui.seq.push((s ? s.id : '?') + '@' + Math.round(W.time)); return ps(s, o, e); };
  M.playDialog = (s, e) => { ui.dlg.push((s ? s.id : '?') + '@' + Math.round(W.time)); return pd(s, e); };
  M.questChanged = (q, c) => { ui.quest.push(q.name.replace(/^L05/, '').slice(0, 12) + ':' + c + '@' + Math.round(W.time)); return qc(q, c); };
}
const me = G.me, P1 = C.players[1], P2 = C.players[2], P3 = C.players[3];
const mine = () => W.units.filter((u) => u.alive && u.owner === me && !u.parked && !u.inside);
const fighters = () => mine().filter((u) => !u.isWorker);
const unit = (cls) => W.units.find((u) => u.alive && u.name === cls && u.owner === me) || null;
const fired = (n) => D.fired(n) > 0;
const quest = (n) => D.quests().find((q) => q.name === n);
const regionC = (name) => { const r = C.regions.find(name); return r ? r.center() : null; };
const inRegion = (u, name) => { const r = C.regions.find(name); return !!r && r.contains(u.pos.x, u.pos.z); };
let teleports = 0, kills = 0;
const stuck = new Map();
// send units to a map point; a group that does not get closer for 60 s is teleported (reported)
function go(units, mx, my, key = 'all') {
  const [x, z] = C.toGame(mx, my);
  const far = units.filter((u) => Math.hypot(u.pos.x - x, u.pos.z - z) > 6);
  if (!far.length) return true;
  const d = Math.min(...far.map((u) => Math.hypot(u.pos.x - x, u.pos.z - z)));
  const s = stuck.get(key) || { d: 1e9, t: W.time, at: '' };
  const at = mx + ',' + my;
  if (s.at !== at || d < s.d - 2) { s.d = d; s.t = W.time; s.at = at; }
  stuck.set(key, s);
  if (W.time - s.t > 60) { for (const u of far) C.teleport(u, mx, my); teleports++; info(`teleport (${key}) to ${at} at ${Math.round(W.time)} s`); s.t = W.time; s.d = 0; return true; }
  for (const u of far) {
    const k = u.task;
    if (k.type === 'move' && Math.abs(k.x - x) < 1 && Math.abs(k.z - z) < 1) continue;
    W.order([u], { type: 'move', x: x + (u.id % 3 - 1) * 1.5, z: z + ((u.id >> 2) % 3 - 1) * 1.5 });
    u.task.x = x; u.task.z = z;
  }
  return false;
}
// go after the nearest living target of a kind (the cheat damage does the rest)
function hunt(units, filter, key) {
  let best = null, bd = 1e9;
  const c = units[0];
  if (!c) return false;
  for (const e of [...W.units, ...W.buildings]) {
    if (!e.alive || e.parked || e.inside || !filter(e)) continue;
    const d = Math.hypot(e.pos.x - c.pos.x, e.pos.z - c.pos.z);
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return false;
  const [mx, my] = C.toMap(best.pos.x, best.pos.z);
  go(units, Math.round(mx), Math.round(my), key);
  return true;
}
function cheats() {
  const M = mine();
  for (const u of M) u.hp = u.maxHp;
  const F = M.filter((u) => !u.isWorker);
  if (!F.length) return;
  const near = (e) => F.some((u) => Math.hypot(u.pos.x - e.pos.x, u.pos.z - e.pos.z) < 14 + (e.radius || 0));
  for (const e of [...W.units, ...W.buildings]) {
    if (!e.alive || e.parked || e.inside || e.untargetable || e.invulnT > 0 || !e.owner || !F[0].isEnemy(e) || !near(e)) continue;
    W.setHp(e, e.hp - e.maxHp * 0.2);
    if (!e.alive) kills++;
  }
}
const T = (prefix) => E.triggers.find((t) => t.name.startsWith(prefix));
const firedP = (prefix) => { const t = T(prefix); return !!t && t.fired > 0; };
const v = (n) => +C.variables.get(n) || 0;
const party = () => fighters();
const hostile = (e) => !!e.owner && party().length > 0 && party()[0].isEnemy(e) && e.kind === 'unit';
let tour = 0;
// fight what is hostile; if nothing is, visit the given places in turn (15 s each)
const clear = (places) => () => { if (hunt(party(), hostile, 'all')) return; const p = places[Math.floor(W.time / 15) % places.length]; go(party(), p[0], p[1]); tour++; };
const steps = [
  ['quest "To the Temple" from the start', () => {}, () => quest('L05MQ01').visible, 20],
  ['the heroes cross the city to the temple: sequence sc_2055, quest "Pirates in the Holy City", the pirates take the support points', () => go(party(), 411, 363), () => quest('L05MQ01').accomplished && quest('L05MQ02').visible && firedP('Gb01: InitQuest'), 600],
  ['two support points (rodeo, animal farm) are freed from the pirates', clear([[139, 591], [558, 356], [139, 591], [558, 356]]), () => v('sum_of_spots') >= 2 && quest('L05MQ02').accomplished, 2400],
  ['the last fortification (weapon smith) is freed: sequence sc_2049', clear([[502, 439]]), () => v('sum_of_spots') >= 3 && quest('L05MQ04').accomplished && quest('L05MQ03').visible, 1800],
  ['the way to the harbour is fought free: the pirates\' last defence falls', clear([[453, 640], [520, 620]]), () => quest('L05MQ03').accomplished, 1800],
  ['the film ms_2090 ends the mission (SQNZ quit)', clear([[453, 640]]), () => G.over, 120],
];
const reached = [];
let err = null, stepAt = 0;
try {
  for (const [name, act, done, limit] of steps) {
    const t0 = W.time;
    let okStep = false;
    while (W.time - t0 < limit && !G.over) {
      if (done()) { okStep = true; break; }
      try { act(); } catch (e) { if (!/null|undefined/.test(String(e))) throw e; }      // a hero the step needs is not there (yet)
      cheats();
      G.step(20, 0.05);
      if (G.fx && Math.round(W.time) % 5 === 0) G.fx.update(5);
    }
    if (!okStep && done()) okStep = true;
    reached.push(okStep);
    ok(okStep, `${String(stepAt + 1).padStart(2)}. ${name} (${Math.round(W.time - t0)} s, at ${Math.round(W.time)} s)`);
    stepAt++;
    if (!okStep) break;
  }
} catch (e) { err = e.stack || String(e); }
ok(!err, 'no exception' + (err ? ': ' + err : ''));
const q = (n) => { const x = quest(n); return x ? (x.accomplished ? 'done' : x.unaccomplishable ? 'failed' : x.visible ? 'open' : 'hidden') : '?'; };
const far = reached.filter(Boolean).length;
info(`reached step ${far} of ${steps.length}; game time ${Math.round(W.time / 60)} min; teleports ${teleports}; cheat kills ${kills}`);
if (far >= 6) ok(G.over && G.endInfo && G.endInfo.won === true && ['L05MQ01', 'L05MQ02', 'L05MQ04', 'L05MQ03'].every((n) => q(n) === 'done'), 'the mission is won, the four main quests accomplished');
ok(C.errors.length === 0, `no action errors (${C.errors.length})`);
const S = D.summary();
ok(S.unknownConditions.length + S.unknownActions.length === 0, 'no unknown condition / action type');
info(`triggers fired ${S.firedTriggers} of ${S.triggers}, ${S.firings} firings, ${S.actions} actions, warnings ${C.warnings.length}, boni ${C.boni}`);
info('quests: ' + D.quests().map((x) => x.name.replace(/^L05/, '') + '=' + q(x.name)).join(' '));
info('sequences: ' + ui.seq.join(' '));
info('dialogues: ' + ui.dlg.length + ' (' + ui.dlg.slice(0, 40).join(' ') + ')');
info('variables: ' + ['sum_of_spots', 'available_spots', 'spot01_cleared', 'spot02_cleared', 'spot03_cleared', 'Ninja_dead'].map((n) => n + '=' + C.variables.get(n)).join(' '));
info('brains: ' + [...G.brains.values()].map((b) => b.p.id + ':' + b.behaviour).join(' '));
for (const e of C.errors.slice(0, 10)) info('error ' + JSON.stringify(e));
for (const w of C.warnings.slice(0, 30)) info('warning ' + w);
if (!G.over) {
  info('log tail:\n' + D.print(40));
  info('units of the player: ' + mine().map((u) => `${u.name}@${C.toMap(u.pos.x, u.pos.z).map(Math.round)}:${u.task.type}`).join(' '));
  info('hostile units: ' + W.units.filter((e) => e.alive && hostile(e)).slice(0, 30).map((u) => `${u.name} p${u.owner.id}@${C.toMap(u.pos.x, u.pos.z).map(Math.round)}${u.parked ? ' hidden' : ''}`).join(' '));
  info('live triggers: ' + D.live().map((r) => r.name + '[' + r.conditions + ']').join(' | ').slice(0, 3000));
}
return out.join('\n');
