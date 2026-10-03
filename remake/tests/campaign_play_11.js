// Mission 11 "Arena" played to the end by script, the way a player would: the three heroes are ordered onto
// whatever enters the arena; the mission's own triggers do the rest (waves out of the gates on the level timer,
// the squads of the governor's guards with their random patrol routes, the boss, the final film, QUIT).
//   python3 tests/evaljs.py tests/campaign_play_11.js "&campaign=11"        (about 25 game minutes)
// Cheats that keep the test short and deterministic: the heroes are healed every second and what they fight loses
// 15 % of its hit points per second (the boss only down to 10 %: it has to be alive for its hit point condition).
const C = G.campaign, W = G.world, E = C.engine, D = C.debug, out = [];
const ok = (c, m) => out.push(`${c ? 'ok' : 'FAIL'} ${m}`);
const info = (m) => out.push('   ' + m);
// what the mission UI is asked for (works with the stub and with the real UI)
const ui = { seq: [], dlg: [], quest: [] };
{
  const M = G.mission, ps = M.playSequence.bind(M), pd = M.playDialog.bind(M), qc = M.questChanged.bind(M);
  M.playSequence = (s, o, e) => { ui.seq.push([s ? s.id : null, Math.round(W.time)]); return ps(s, o, e); };
  M.playDialog = (s, e) => { ui.dlg.push([s ? s.id : null, Math.round(W.time)]); return pd(s, e); };
  M.questChanged = (q, c) => { ui.quest.push(q.name + ':' + c); return qc(q, c); };
}
const me = G.me;
const heroes = () => W.units.filter((u) => u.alive && u.owner === me);
const foes = () => W.units.filter((u) => u.alive && u.owner && u.owner !== me && !u.parked && !u.inside);
const seen = new Map();            // enemy class -> first seen at (s)
const owners = new Set();
let maxFoes = 0, patrolled = 0, bossLevel = 0, bossMin = 1, err = null;
function drive() {
  const F = foes(), H = heroes();
  maxFoes = Math.max(maxFoes, F.length);
  for (const f of F) { if (!seen.has(f.name)) seen.set(f.name, Math.round(W.time)); owners.add(f.owner.id); if (E.patrols.has(f)) patrolled++; }
  for (const h of H) {
    h.hp = h.maxHp;
    const t = h.task.type === 'attack' && h.task.target && h.task.target.alive ? h.task.target : null;
    if (!t && F.length) { F.sort((a, b) => h.distTo(a) - h.distTo(b)); W.order([h], { type: 'attack', target: F[0] }); }
  }
  for (const f of F) {
    if (!H.some((h) => h.distTo(f) < 10 + f.radius)) continue;
    const boss = f.name === 'arena_atroxosaurus';
    if (boss) { bossLevel = f.level; bossMin = Math.min(bossMin, f.hp / f.maxHp); }
    const hp = f.hp - f.maxHp * 0.15;
    if (boss) { if (f.hp > f.maxHp * 0.1) W.setHp(f, Math.max(f.maxHp * 0.1, hp)); } else W.setHp(f, hp);
  }
}
const checks = {};
const at = (name, cond) => { if (!checks[name] && cond()) checks[name] = Math.round(W.time); };
try {
  for (let s = 0; s < 45 * 60 && !G.over; s++) {
    G.step(20, 0.05);
    if (G.fx && s % 5 === 0) G.fx.update(5);
    drive();
    at('timer', () => C.timers.has('0') && C.timers.get('0').show === false);
    at('q1', () => D.quests()[0].visible);
    at('q1done', () => D.quests()[0].accomplished);
    at('q2', () => D.quests()[1].visible);
    at('q2done', () => D.quests()[1].accomplished);
    at('q3', () => D.quests()[2].visible);
    at('boss', () => foes().some((f) => f.name === 'arena_atroxosaurus'));
  }
} catch (e) { err = e.stack || String(e); }
ok(!err, 'the mission ran without an exception' + (err ? ': ' + err : ''));
const fired = (n) => D.fired(n);
const first = (n) => { const e = E.log.find((l) => l.trigger === n); return e ? e.t : -1; };
// --- the story, in order
ok(ui.seq.length > 0 && ui.seq[0][0] === 'ms_4010' && ui.seq[0][1] <= 2, `the intro film ms_4010 is requested at the start (${JSON.stringify(ui.seq[0])})`);
ok(checks.q1 != null && checks.q1 <= 3, `quest 1 "In the Dinosaur Den" appears after the film (${checks.q1} s)`);
ok(checks.timer != null, 'the level timer 0 runs hidden (the next wave comes when it runs out)');
const animals = ['arena_polakanthus', 'arena_gallimimus', 'arena_baryonyx', 'arena_smilodon', 'arena_stygimoloch', 'arena_triceratops', 'arena_allosaurus'];
const times = animals.map((a) => (seen.has(a) ? seen.get(a) : -1));
ok(times.every((t, i) => t >= 0 && (i === 0 || t > times[i - 1])), `the seven animal waves come out of the gates in order (${animals.map((a, i) => a.slice(6, 10) + '@' + times[i]).join(' ')})`);
ok(times[1] - times[0] >= 45 && times[1] - times[0] <= 56, `wave 2 comes 50 s after wave 1 (TIMR; ${times[1] - times[0]} s)`);
ok(fired('Ga: Action_player1') >= 3 && patrolled > 0, `the random patrol trigger gives the animals routes (${fired('Ga: Action_player1')} firings)`);
ok(checks.q1done != null && checks.q2 != null && checks.q2 >= checks.q1done, `quest 1 accomplished (${checks.q1done} s), quest 2 "The Mayor's Life Guard" appears (${checks.q2} s)`);
ok(ui.dlg.some((d) => d[0] === 'ds_4014') && ui.dlg.some((d) => d[0] === 'ds_4012'), `dialogue scenes are requested (${ui.dlg.map((d) => d[0] + '@' + d[1]).join(' ')})`);
ok(owners.has(1) && owners.has(2) && owners.has(3), 'squads of all three guard players appear');
const squads = ['Gg01: Spawn Aje Group', 'Gg02: Spawn Ninigi Group', 'Gg03: Spawn Hu Group', 'Gg04: Spawn Aje Group', 'Gg05: Spawn Hu Group', 'Gh01: Spawn Aje Group'];
const st = squads.map(first);
ok(st.every((t, i) => t > 0 && (i === 0 || t > st[i - 1])), `the guard squads come in order (${st.map((t) => Math.round(t)).join(', ')} s)`);
ok(['aje_warrior', 'aje_spearman', 'aje_archer', 'aje_thrower', 'ninigi_sumo', 'ninigi_ninja', 'hu_pikeman', 'hu_chariot', 'hu_killer'].every((c) => seen.has(c)), 'the squads\' classes were created (models of three foreign tribes): ' + [...seen.keys()].filter((k) => !/^arena_/.test(k)).join(' '));
ok(fired('Gb: Action_player2LongDelay') >= 1 && fired('Gc: Action_player3Long Delay') >= 1, 'patrol routes for players 2 and 3');
ok(checks.q2done != null && checks.q3 != null, `quest 2 accomplished (${checks.q2done} s), quest 3 "The Final Challenge" appears (${checks.q3} s)`);
ok(ui.seq.some((s) => s[0] === 'sc_4009'), 'the boss sequence sc_4009 is requested');
ok(checks.boss != null && bossLevel === 4, `the level-4 Atroxosaurus enters (${checks.boss} s, level ${bossLevel})`);
ok(fired('Gh08: Atroxo Dead') === 1 && bossMin < 0.2, `OBJP: the boss below 20 % hit points (${(bossMin * 100).toFixed(0)} %)`);
ok(ui.seq.some((s) => s[0] === 'ms_4015'), 'the final film ms_4015 is requested');
ok(D.quests()[2].accomplished, 'quest 3 accomplished');
ok(!W.units.some((u) => u.alive && u.name === 'arena_atroxosaurus'), 'the boss is deleted after the film (DELO)');
ok(G.over && G.endInfo && G.endInfo.won === true, `QUIT: the mission is won (G.endMission(true)) after ${Math.round(W.time / 60)} game minutes`);
ok(C.boni === 6000, `bonus: 3 quests x 2000 (${C.boni})`);
ok(C.errors.length === 0, `no action errors (${C.errors.length})`);
const S = D.summary();
ok(S.unknownConditions.length + S.unknownActions.length === 0, 'no unknown condition / action type');
info(`triggers fired ${S.firedTriggers} of ${S.triggers}, ${S.firings} firings, ${S.actions} actions, most enemies at once ${maxFoes}, warnings ${C.warnings.length}`);
info('sequences ' + JSON.stringify(ui.seq) + ' quests ' + ui.quest.join(' '));
for (const e of C.errors.slice(0, 10)) info('error ' + JSON.stringify(e));
for (const w of C.warnings.slice(0, 20)) info('warning ' + w);
if (!G.over) {
  info('log tail:\n' + D.print(30));
  info('enemies left: ' + W.units.filter((u) => u.alive && u.owner && u.owner !== me).map((u) => `${u.name} p${u.owner.id} @${C.toMap(u.pos.x, u.pos.z).map(Math.round)} ${u.task.type}${u.parked ? ' parked' : ''}${u.inside ? ' inside ' + u.inside.name : ''} hp ${Math.round(u.hp)}`).join('; '));
  info('heroes: ' + heroes().map((u) => `${u.name} @${C.toMap(u.pos.x, u.pos.z).map(Math.round)} ${u.task.type} -> ${u.task.target ? u.task.target.name : ''}`).join('; '));
  info('live triggers: ' + D.live().map((r) => r.name + '[' + r.conditions + ']').join(' | '));
}
return out.join('\n');
