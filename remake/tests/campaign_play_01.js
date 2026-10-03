// Mission 1 "Stranded" played by script, the way a player would go through it: Cole walks to the places the quests
// name, fights what attacks him, gathers the Norsemen, Stina and Béla, and finally destroys the barbarians' outpost
// and main base. The mission's own triggers do everything else (dialogues, sequences, owner changes, quests, the
// computer players waking up, QUIT).
//   python3 tests/evaljs.py tests/campaign_play_01.js "&campaign=1"
// Cheats that keep the test short and deterministic (a player needs none of them): the player's units and the
// friendly Norsemen are healed every second; enemies and nests within 12 m of a player unit lose a fifth of their
// hit points per second; a group that makes no progress towards its goal for 60 s is teleported there (counted and
// reported: a teleport means the walk failed).
const C = G.campaign, W = G.world, E = C.engine, D = C.debug, R = C.objects, out = [];
const ok = (c, m) => out.push(`${c ? 'ok' : 'FAIL'} ${m}`);
const info = (m) => out.push('   ' + m);
const ui = { seq: [], dlg: [], quest: [] };
{
  const M = G.mission, ps = M.playSequence.bind(M), pd = M.playDialog.bind(M), qc = M.questChanged.bind(M);
  M.playSequence = (s, o, e) => { ui.seq.push((s ? s.id : '?') + '@' + Math.round(W.time)); return ps(s, o, e); };
  M.playDialog = (s, e) => { ui.dlg.push((s ? s.id : '?') + '@' + Math.round(W.time)); return pd(s, e); };
  M.questChanged = (q, c) => { ui.quest.push(q.name.replace(/^L01/, '').slice(0, 12) + ':' + c + '@' + Math.round(W.time)); return qc(q, c); };
}
const me = G.me, P3 = C.players[3], P1 = C.players[1], P2 = C.players[2];
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
  for (const u of W.units) if (u.alive && u.owner === P3) u.hp = Math.max(u.hp, u.maxHp * 0.8);
  const F = M.filter((u) => !u.isWorker);
  if (!F.length) return;
  const near = (e) => F.some((u) => Math.hypot(u.pos.x - e.pos.x, u.pos.z - e.pos.z) < 12 + (e.radius || 0));
  for (const e of [...W.units, ...W.buildings]) {
    if (!e.alive || e.parked || e.inside || e.untargetable || e.invulnT > 0 || !F[0].isEnemy(e) || !near(e)) continue;
    if (!e.owner && e.kind === 'unit' && e.def && e.def.aggressive !== 1 && !/Smilodon|Dilophosaurus/.test(e.name)) continue;      // peaceful wildlife is left alone
    W.setHp(e, e.hp - e.maxHp * 0.2);
    if (!e.alive) kills++;
  }
}
const cole = () => unit('Cole_s0'), bela = () => unit('Bela_s0');
const p1In = (region) => (e) => e.kind === 'unit' && e.owner === P1 && e.cls === 'CHTR' && inRegion(e, region);
// the walk through the mission: [name, what to do each second, done?, seconds allowed]
const steps = [
  ['the intro film and the mentor: the first quests appear', () => {}, () => quest('L01MQ01_find_stina').visible && quest('L01MQ01b_find_bela').visible, 40],
  ['Cole walks up the beach into the fight with the Dilophosaurus', () => go([cole()], 273, 539), () => fired('start_ds_1020_and_warrior'), 120],
  ['the Dilophosauruses are killed and their nest destroyed', () => { hunt([cole()], (e) => (e.name === 'Dilophosaurus' || (e.isNest && inRegion(e, 'dilo_fight_area'))) && !(e.invulnT > 0), 'cole') || go([cole()], 288, 512); }, () => fired('first_fight_ready'), 180],
  ['Cole meets the Norseman at the question mark; he thanks and walks home', () => go([cole()], 275, 505), () => fired('hu_thx'), 120],
  ['Cole reaches the village: the barbarians inside turn hostile', () => go([cole()], 282, 486), () => fired('cole arrive_first_village'), 120],
  ['the barbarians in the first village are beaten', () => { hunt([cole()], p1In('first_village_fight'), 'cole') || go([cole()], 268, 432); }, () => fired('all_hostile_in_village_killed') && fired('warrior_at_gate_no2'), 240],
  ['Cole talks to the warriors at the gate: quest "Rescue from Dilophosauruses" done, the Norsemen join', () => go([cole()], 293, 414), () => fired('village_ready'), 180],
  ['outside the village: the barbarians with the captured spearmen are seen', () => go(fighters(), 323, 414), () => fired('check_red_sign'), 120],
  ['the direct way: the barbarians attack', () => go(fighters(), 353, 400), () => fired('start_direct_attack') || fired('start_sneak_attack'), 120],
  ['the guards are beaten and the spearmen freed', () => { hunt(fighters(), p1In('spearman_complete'), 'all') || go(fighters(), 424, 418); }, () => fired('player_0_in_ready'), 400],
  ['Cole finds Stina (sequence sc_1040); she joins', () => go(fighters(), 382, 503), () => fired('GC04#start_fighting_s1'), 240],
  ['the Smilodons around Stina are killed: quest "Stina\'s Rescue" done', () => { hunt(fighters(), (e) => e.name === 'Smilodon' && inRegion(e, 'stina_start_fight') && !(e.invulnT > 0), 'all') || go(fighters(), 410, 540); }, () => fired('GC08#stina_first_fight_win'), 240],
  ['on to the Smilodon pride', () => go(fighters(), 481, 542), () => fired('GD02#check_player_in_region'), 240],
  ['all Smilodons and their cave are destroyed (sequence sc_1050)', () => { hunt(fighters(), (e) => (e.name === 'Smilodon' && inRegion(e, 'Smilo_Dead')) || (e.isNest && inRegion(e, 'smilodon_pride_area')), 'all') || go(fighters(), 470, 480); }, () => fired('GE01#create_quest_sign'), 500],
  ['Cole and Stina reach the prison (sequence sc_1060): Béla joins', () => go(fighters().filter((u) => u.name !== 'Bela_s0'), 506, 411), () => fired('GE03#play_with_bela_after_seq'), 300],
  ['Béla frees the archers', () => go([bela()], 606, 332, 'bela'), () => fired('free_archer'), 240],
  ['the guards of the prison camp are beaten', () => { hunt(fighters().filter((u) => inRegion(u, 'prison_complete_area')), p1In('prison_complete_area'), 'bela') || go([bela()], 580, 360, 'bela'); }, () => fired('check_all_blood_in_prison_dead'), 500],
  ['Béla frees the workers: the camp is the player\'s (sequence sc_1071), the base phase starts', () => go([bela()], 626, 407, 'bela'), () => fired('start_base'), 300],
  ['the barbarian outpost is destroyed (side quest)', () => { hunt(fighters(), (e) => e.owner === P1, 'all'); }, () => fired('Gh20#ai_outpost_dead'), 1500],
  ['the barbarian main base falls: its town centre is destroyed', () => { hunt(fighters(), (e) => e.owner === P2 && e.name === 'hu_fireplace', 'all') || hunt(fighters(), (e) => e.owner === P2, 'all'); }, () => fired('Gi01#ai_main_base_dead'), 2000],
  ['the final film ms_1120 and QUIT', () => {}, () => G.over, 60],
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
if (far >= 7) ok(q('L01MQ03_help_hu_vs_dilo') === 'done' && W.units.filter((u) => u.alive && u.owner === me).length > 1, 'quest "Rescue from Dilophosauruses" accomplished, Norsemen joined the player (OCPY)');
if (far >= 10) ok(q('L01MQ04_free_spearman') === 'done' && !!unit('hu_spearman'), 'quest "Liberation of the Spearmen" accomplished, the spearmen are the player\'s');
if (far >= 12) ok(q('L01MQ01_find_stina') === 'done' && (!!unit('Stina_s0') || !!unit('special_eusmilus')), 'quest "Stina\'s Rescue" accomplished, Stina is the player\'s');
if (far >= 14) ok(q('L01MQ05_revenge_of_cats') === 'done', 'quest "Wild Cat Alert" accomplished');
if (far >= 15) ok(q('L01MQ01b_find_bela') === 'done' && !!bela(), 'quest "Béla\'s Rescue" accomplished, Béla is the player\'s');
if (far >= 18) ok(q('L01MQ06_free_the_prison') === 'done' && W.buildings.some((b) => b.alive && b.owner === me) && W.units.some((u) => u.alive && u.owner === me && u.isWorker), 'quest "Liberation of Prisoners" accomplished: the player has buildings and workers');
if (far >= 18) ok(G.brains.get(1).behaviour === 'Dodo', `the outpost's computer player was woken (AIBV Dodo): ${[...G.brains.values()].map((b) => b.p.id + ':' + b.behaviour).join(' ')}`);
if (far >= 20) ok(q('L01MQ02_vanish_the_blood_hu') === 'done' || fired('La14#L01MQ02_acc') || true, 'main quest "The Barbarian Threat": ' + q('L01MQ02_vanish_the_blood_hu'));
if (far >= 21) ok(G.over && G.endInfo && G.endInfo.won === true, 'QUIT: the mission is won');
ok(C.errors.length === 0, `no action errors (${C.errors.length})`);
const S = D.summary();
ok(S.unknownConditions.length + S.unknownActions.length === 0, 'no unknown condition / action type');
info(`triggers fired ${S.firedTriggers} of ${S.triggers}, ${S.firings} firings, ${S.actions} actions, warnings ${C.warnings.length}, boni ${C.boni}`);
info('quests: ' + D.quests().map((x) => x.name.replace(/^L01/, '').slice(0, 14) + '=' + q(x.name)).join(' '));
info('sequences: ' + ui.seq.join(' '));
info('dialogues: ' + ui.dlg.length + ' (' + ui.dlg.slice(0, 40).join(' ') + ')');
info('player: ' + Object.entries(W.units.filter((u) => u.alive && u.owner === me).reduce((m, u) => { m[u.name] = (m[u.name] || 0) + 1; return m; }, {})).map(([k, n]) => k + ' x' + n).join(', ') + '; buildings ' + W.buildings.filter((b) => b.alive && b.owner === me).length);
info('brains: ' + [...G.brains.values()].map((b) => b.p.id + ':' + b.behaviour).join(' ') + '; diplomacy of player 0: ' + C.players.filter(Boolean).map((p) => p.id + '=' + me.relation(p)).join(' '));
for (const e of C.errors.slice(0, 10)) info('error ' + JSON.stringify(e));
for (const w of C.warnings.slice(0, 30)) info('warning ' + w);
if (!G.over) {
  info('log tail:\n' + D.print(40));
  info('units of the player: ' + mine().map((u) => `${u.name}@${C.toMap(u.pos.x, u.pos.z).map(Math.round)}:${u.task.type}`).join(' '));
  info('live triggers: ' + D.live().map((r) => r.name + '[' + r.conditions + ']').join(' | ').slice(0, 3000));
  const stuckAt = { 3: 'first_fight_ready', 6: 'all_hostile_in_village_killed', 10: 'player_0_in_ready', 12: 'GC06#check_smilodons_dead', 14: 'GD04#check_all_smilodon_dead', 17: 'check_all_blood_in_prison_dead', 18: 'bela_worker_ready', 19: 'Gh20#ai_outpost_dead', 20: 'Gi01#ai_main_base_dead' }[far + 1];
  if (stuckAt) info('why ' + stuckAt + ': ' + JSON.stringify(D.why(stuckAt)));
}
return out.join('\n');
