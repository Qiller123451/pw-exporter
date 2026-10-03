// Mission 2 "Druid Island" played by script: the heroes leave the base, drive the poachers from the four mammoth
// caves (at least seven mammoths must be counted as saved), and destroy the Dustrider base in the north.
//   python3 tests/evaljs.py tests/campaign_play_02.js "&campaign=2"         (node tests/campaign_play_mock.mjs 2: the trigger chain alone)
// Cheats: the player's units and the mammoths are healed every second; units and buildings of the two Dustrider
// players within 14 m of a player's fighter lose a fifth of their hit points per second; a group that makes no
// progress for 60 s is teleported (counted and reported).
const C = G.campaign, W = G.world, E = C.engine, D = C.debug, R = C.objects, out = [];
const ok = (c, m) => out.push(`${c ? 'ok' : 'FAIL'} ${m}`);
const info = (m) => out.push('   ' + m);
const ui = { seq: [], dlg: [], quest: [] };
{
  const M = G.mission, ps = M.playSequence.bind(M), pd = M.playDialog.bind(M), qc = M.questChanged.bind(M);
  M.playSequence = (s, o, e) => { ui.seq.push((s ? s.id : '?') + '@' + Math.round(W.time)); return ps(s, o, e); };
  M.playDialog = (s, e) => { ui.dlg.push((s ? s.id : '?') + '@' + Math.round(W.time)); return pd(s, e); };
  M.questChanged = (q, c) => { ui.quest.push(q.name.replace(/^L02/, '').slice(0, 12) + ':' + c + '@' + Math.round(W.time)); return qc(q, c); };
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
  // the holy mammoths are kept alive (the test is about the triggers, not about being fast enough)
  for (const u of W.units) if (u.alive && u.name === 'Mammoth') u.hp = u.maxHp;
  const F = M.filter((u) => !u.isWorker);
  if (!F.length) return;
  const near = (e) => F.some((u) => Math.hypot(u.pos.x - e.pos.x, u.pos.z - e.pos.z) < 14 + (e.radius || 0));
  for (const e of [...W.units, ...W.buildings]) {
    if (!e.alive || e.parked || e.inside || e.untargetable || e.invulnT > 0 || !(e.owner === P1 || e.owner === P2) || !near(e)) continue;
    W.setHp(e, e.hp - e.maxHp * 0.2);
    if (!e.alive) kills++;
  }
}
const T = (prefix) => E.triggers.find((t) => t.name.startsWith(prefix));
const firedP = (prefix) => { const t = T(prefix); return !!t && t.fired > 0; };
const v = (n) => +C.variables.get(n) || 0;
const heroes = () => fighters();
const foeIn = (region) => (e) => (e.owner === P1 || e.owner === P2) && inRegion(e, region);
const nest = (k, at) => [
  [`the way to mammoth cave ${k}: the poachers there attack the mammoths`, () => go(heroes(), at[0], at[1]), () => firedP(`01_attack_first_mammoth_nest_${k}`), 400],
  [`the poachers at cave ${k} are driven away and their buildings destroyed: the cave is saved`, () => { hunt(heroes(), foeIn('check_nest_' + k), 'all') || go(heroes(), ...C.toMap(...regionC('check_nest_' + k)).map(Math.round)); }, () => firedP(`01_nest_${k}_saved`), 600],
];
const steps = [
  ['the intro film ms_1090; quest "Help for the Arch Druid" is shown; the Dustriders\' computer player builds (Turtle)', () => {}, () => quest('L02MQ01_help_druid').visible && ui.seq.some((s) => /^ms_1090/.test(s)), 20],
  ['the heroes leave the base: quest "Mammoth Rescue" and the counter in the info bar', () => go(heroes(), 546, 831), () => firedP('01_L02MQ02_vis') && quest('L02MQ02_retrieve_the_mammoths').visible, 300],
  ...nest(1, [520, 786]), ...nest(2, [381, 590]), ...nest(3, [424, 474]), ...nest(4, [627, 546]),
  ['seven mammoths are saved: quest accomplished, sequence sc_1082, the Dustriders land by turtle', () => {}, () => quest('L02MQ02_retrieve_the_mammoths').accomplished && firedP('01_L02MQ03_vis'), 60],
  ['the Dustrider base in the north is destroyed (all units and production buildings)', () => { hunt(heroes(), (e) => e.owner === P1, 'all') || go(heroes(), 664, 298); }, () => firedP('02_L02MQ03_acc'), 2500],
  ['the final sequence sc_1089 and QUIT', () => {}, () => G.over, 60],
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
if (far >= 2) ok(/Mammoth|\d+ ?\/ ?\d+/.test(E.infoBarShown || '') || far >= 11, `the info bar shows the mammoth counter ("${E.infoBarShown}")`);
if (far >= 1) ok(G.brains.get(1) && /Turtle|Giraffe|Schnecke/.test(G.brains.get(1).behaviour || ''), 'the Dustriders\' computer player was woken: ' + [...G.brains.values()].map((b) => b.p.id + ':' + b.behaviour).join(' '));
if (far >= 10) ok(v('nests_saved') === 4 && v('mammoths_saved') >= 7, `four caves saved, ${v('mammoths_saved')} mammoths counted (of ${v('Mammoth_Max')})`);
if (far >= 11) ok(q('L02MQ02_retrieve_the_mammoths') === 'done' && ui.seq.some((s) => /^sc_1082/.test(s)), 'quest "Mammoth Rescue" accomplished, sequence sc_1082');
if (far >= 11) ok(firedP('02_spawn_turtle_to_second_harborplace') && W.units.some((u) => /transport_turtle/.test(u.name)), 'the landing parties were created (CPLX: transport turtles with passengers)');
if (far >= 13) ok(G.over && G.endInfo && G.endInfo.won === true && q('L02MQ03_destroy_the_poachers') === 'done' && q('L02MQ01_help_druid') === 'done', 'QUIT: the mission is won, all three main quests accomplished');
ok(C.errors.length === 0, `no action errors (${C.errors.length})`);
const S = D.summary();
ok(S.unknownConditions.length + S.unknownActions.length === 0, 'no unknown condition / action type');
info(`triggers fired ${S.firedTriggers} of ${S.triggers}, ${S.firings} firings, ${S.actions} actions, warnings ${C.warnings.length}, boni ${C.boni}`);
info('quests: ' + D.quests().map((x) => x.name.replace(/^L02/, '').slice(0, 14) + '=' + q(x.name)).join(' '));
info('sequences: ' + ui.seq.join(' '));
info('dialogues: ' + ui.dlg.length + ' (' + ui.dlg.slice(0, 40).join(' ') + ')');
info('variables: ' + ['Mammoth_Max', 'mammoths_saved', 'nests_saved'].map((n) => n + '=' + C.variables.get(n)).join(' '));
info('brains: ' + [...G.brains.values()].map((b) => b.p.id + ':' + b.behaviour + (b.launched ? ' attacks ' + b.launched.length : '')).join(' '));
for (const e of C.errors.slice(0, 10)) info('error ' + JSON.stringify(e));
for (const w of C.warnings.slice(0, 30)) info('warning ' + w);
if (!G.over) {
  info('log tail:\n' + D.print(40));
  info('units of the player: ' + mine().map((u) => `${u.name}@${C.toMap(u.pos.x, u.pos.z).map(Math.round)}:${u.task.type}`).join(' '));
  info('live triggers: ' + D.live().map((r) => r.name + '[' + r.conditions + ']').join(' | ').slice(0, 3000));
}
return out.join('\n');
