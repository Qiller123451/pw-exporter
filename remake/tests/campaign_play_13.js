// include: campaign_bot.js
// Mission 13 "The Rush" played by script: after the opening film sc_4070 (quest "Hold the Fort") the base grows and
// trains an army that waits in two squads in front of the city wall on the SEAS' ways and fights what comes near;
// the big SEAS attack after 45 minutes is beaten (quest "Hold the Fort" accomplished). Then the army marches to the
// SEAS main base and breaks its headquarters (quest "Counter Attack"); the film ms_6020 ends the mission. The side
// quests are left alone.
//   python3 tests/evaljs.py tests/campaign_play_13.js "&campaign=13"           (&tribe=Hu: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported (all counted and reported).
const army = () => fighters().filter((u) => u.name !== 'darwin_s0');
const foe = (e) => !!e.owner && e.owner !== me && !me.isFriend(e.owner);
const hq = () => named('seas_headquarters_7');
// three squads in front of the city wall, where the SEAS' attack paths end (CBL_Aab04b and the outposts' routes come
// down at x 763, 820 and 907; the wall runs on to x 980) and at its west end (x 570 .. 660: the cliffs west of the
// gate keep the first outpost's attackers on that side, map PaFi grid)
const POSTS = [[636, 322], [800, 370], [930, 370]];
const WALLS = () => W.buildings.filter((b) => b.alive && /^hcl13_(city_wall|gate)/.test(b.name));
function base() {
  gather({ food: 600, wood: 500, stone: 300 });
  housing();
  if (workers().length < 12) produce('ninigi_worker', 1);
  if (army().length < 30) { produce('ninigi_warrior', 1); produce('ninigi_archer', 1); }
}
const guard = () => {
  const a = army(), walls = WALLS();
  POSTS.forEach(([mx, my], i) => {
    const squad = a.filter((u, k) => k % POSTS.length === i), [x, z] = C.toGame(mx, my);
    // whatever comes near the post or the wall pieces nearest to it; the middle squad also covers the base
    const near = (w) => { const wx = C.toMap(w.pos.x, w.pos.z)[0]; return POSTS.reduce((b, p, k) => (Math.abs(p[0] - wx) < Math.abs(POSTS[b][0] - wx) ? k : b), 0); };
    const mine = walls.filter((w) => near(w) === i);
    const own = i === 1 ? [...myBuildings(), ...workers()] : [];
    const close = (e) => Math.hypot(e.pos.x - x, e.pos.z - z) < 90 || mine.some((w) => w.distTo(e) < 50) || own.some((b) => b.distTo(e) < 40);
    if (!hunt(squad, (e) => foe(e) && e.kind === 'unit' && close(e), 'squad' + i)) go(squad, mx, my, 'squad' + i);
  });
};
const steps = [
  ['the opening film sc_4070: quest "Hold the Fort"', () => gather(), () => questState('L13MQ01') === 'open', 120],
  ['the army waits in front of the gate until the big SEAS attack is beaten: quest "Hold the Fort"', () => { base(); guard(); }, () => questState('L13MQ01') === 'done', 4200],
  ['quest "Counter Attack"', () => { base(); guard(); }, () => questState('L13MQ02') === 'open', 600],
  ['the army breaks the SEAS headquarters on the plateau: quest "Counter Attack"', () => {
    base();
    const a = army(), h = hq();
    if (!a[0] || !h) return;
    if (!hunt(a, (e) => foe(e) && e.kind === 'unit' && e.distTo(a[0]) < 25, 'army')) hunt(a, (e) => e === h, 'army');
  }, () => questState('L13MQ02') === 'done', 3000],
  ['the film ms_6020 ends the mission', () => {}, () => G.over, 300],
];
runSteps(steps);
ok(!G.over || (G.endInfo && G.endInfo.won === true), 'QUIT: the mission is won');
for (const g of ['team_mainbase', 'team_outpost01', 'team_outpost02', 'team_outpost03']) {
  const G_ = R.group(g), m = G_ ? G_.list().map((r) => r.entity).filter((e) => e && e.alive) : [];
  info(`group ${g}: ${m.length} alive ` + m.slice(0, 4).map((e) => `${e.name}@${C.toMap(e.pos.x, e.pos.z).map(Math.round)}:${e.task.type}${e.patrol ? '(wp)' : ''}`).join(' '));
}
info('city wall pieces left: ' + WALLS().length + ' of 20 (lost: ' + ['hcl13_gate_3', ...Array.from({ length: 19 }, (_, i) => 'hcl13_city_wall_' + (74 + i))].filter((n) => !named(n)).join(' ') + ')');
return report({ 2: 'CBL_Ge02#defeated', 4: 'Lb02: L13MQ02 - set acc', 5: 'S02: HS 6020' }) + '\n   won: ' + JSON.stringify(G.endInfo) +
  '\n   variables: ' + ['init_main_attack', 'main_attack_done', 'team_mainbase_def', 'team_outpost01_def', 'team_outpost02_def', 'team_outpost03_def'].map((n) => n + '=' + C.variables.get(n)).join(' ');
