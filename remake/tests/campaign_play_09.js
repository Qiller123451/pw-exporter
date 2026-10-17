// include: campaign_bot.js
// Mission 9 "Perilous Path" played by script: the heroes follow the path north to the bridge (sequence sc_3025, the
// bridge breaks), reach the Dragon Clan village (dialogue ds_3020) and beat the Barbarians attacking it (quest
// "Rescue Mission", sequence sc_3030: the village joins, quest "Survival of the Fittest"), fetch the three parts of
// the wreck from the Barbarian altars (quest "Hunting the Looters"), clear the airplane and put up a tower next to
// it (quest "The Bird of Steel", sequence sc_3033, quest "A dangerous Path"), then the workers build the launch ramp
// (quest "Prepare for Start"); the film ms_3040 ends the mission. The side quests are left alone.
//   python3 tests/evaljs.py tests/campaign_play_09.js "&campaign=9"            (&tribe=Hu: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported, resources are topped up for the tower (all counted and reported).
const P4 = C.players[4];
const three = () => ['Bela_s0', 'Cole_s0', 'special_eusmilus'].map(unit).filter(Boolean);
const army = () => fighters();
const foe = (e) => army().length > 0 && army()[0].isEnemy(e) && !!e.owner;
const grp = (name) => { const g = R.group(name); return g ? g.list().map((r) => r.entity).filter((e) => e && e.alive) : []; };
const attackers = () => ['04_attgroup01', '04_attgroup02', '04_attgroup03', '04_attgroup04'].flatMap(grp);
// on the way: fight what stands within 25 m of the first unit, else walk on
const march = (units, region, key) => { const a = units; if (!(a[0] && hunt(a, (e) => foe(e) && e.kind === 'unit' && e.distTo(a[0]) < 25, key))) goRegion(a, region, key); };
const part = (n) => Number(C.variables.get('parts0' + n + '_done')) === 1;
const pad = () => named('00_launchpad_01');
const tower = () => { const c = regionC('airplane'); return C.toMap(c[0], c[1]).map(Math.round); };
const steps = [
  ['the opening film ms_3010: quests "A dangerous Path" and "Survival of the Fittest"', () => {}, () => questState('L09MQ01') === 'open' && questState('L09MQ02') === 'open', 120],
  ['the heroes follow the path to the bridge: sequence sc_3025 (the bridge breaks)', () => march(three(), 'trigger_sc_3025', 'heroes'), () => fired('Ga01#pos_sc_3025'), 1200],
  ['the heroes reach the Dragon Clan village: dialogue ds_3020, quest "Rescue Mission"', () => march(three(), 'trigger_ds_3020', 'heroes'), () => questState('L09MQ03') === 'open', 1200],
  ['the Barbarians attacking the village are beaten: quest "Rescue Mission", sequence sc_3030, the village joins', () => {
    hunt(army(), (e) => attackers().includes(e), 'army') || goRegion(army(), 'trigger_ds_3020', 'army');
  }, () => questState('L09MQ03') === 'done' && questState('L09MQ02') === 'done', 1800],
  ['quest "Hunting the Looters"', () => gather(), () => questState('L09MQ04') === 'open', 60],
  ['the three parts of the wreck are fetched from the Barbarian altars', () => {
    gather();
    const n = [2, 3, 4].find((k) => !part(k));
    if (n) march(army(), 'trigger_parts_0' + n, 'army');
  }, () => questState('L09MQ04') === 'done', 3600],
  ['the airplane is cleared and a tower stands next to it: quest "The Bird of Steel", sequence sc_3033', () => {
    gather();
    const a = army();
    if (!(a[0] && hunt(a, (e) => e.owner === P4 && inRegion(e, 'airplane'), 'army'))) goRegion(a, 'airplane', 'army');
    const ws = workers().slice(0, 3);
    const r = build('ninigi_small_tower', ...tower(), { workers: 3, region: 'airplane' });
    if (r !== true && r !== 'started') { topUp({ wood: 400, stone: 400 }); goRegion(ws, 'airplane', 'workers'); }
  }, () => questState('L09MQ05') === 'done', 2400],
  ['the film sc_3033: quest "A dangerous Path" accomplished, the launch ramp is the player\'s', () => { const b = pad(); if (b) { const [mx, my] = C.toMap(b.pos.x, b.pos.z); go([...army(), ...workers()], Math.round(mx), Math.round(my), 'all'); } }, () => questState('L09MQ01') === 'done' && !!pad() && pad().owner === me, 300],
  ['the workers build the launch ramp while the army guards it: quest "Prepare for Start"', () => {
    const b = pad();
    if (!b) return;
    const a = army();
    if (!hunt(a, (e) => foe(e) && e.kind === 'unit' && e.distTo(b) < 90, 'army')) { const [mx, my] = C.toMap(b.pos.x, b.pos.z); go(a, Math.round(mx), Math.round(my), 'army'); }
    for (const w of workers()) if (!b.built && (w.task.type !== 'build' || w.task.building !== b)) W.order([w], { type: 'build', target: b });
  }, () => questState('L09MQ06') === 'done', 3000],
  ['the film ms_3040 ends the mission', () => {}, () => G.over, 300],
];
runSteps(steps);
return report({ 2: 'S01#sc_3025', 4: 'L03b#mq03_done', 6: 'L04b#mq04_done', 7: 'L05b#mq05_done', 9: 'L06b#mq06_done' }) + '\n   won: ' + JSON.stringify(G.endInfo) +
  '\n   variables: ' + ['parts_collected', 'mq03_done', 'mq05_done', 'mq06_done', 'reinforcements'].map((n) => n + '=' + C.variables.get(n)).join(' ');
