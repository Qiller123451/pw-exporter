// include: campaign_bot.js
// (tests/save_campaign_flow.py, page 2: the loaded game goes on - the heroes reach the village)
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
['the heroes reach the Dragon Clan village: dialogue ds_3020, quest "Rescue Mission"', () => march(three(), 'trigger_ds_3020', 'heroes'), () => questState('L09MQ03') === 'open', 1200],
  ];
const far = runSteps(steps);
const st = (name) => { const L = grp(name); return { n: L.length, invul: L.filter((e) => e.invulnT > 0).length }; };
for (let s = 0; s < 10; s++) G.step(20, 0.05);
return JSON.stringify({ far, att: st('04_attgroup01'), def: st('05_defgroup01'), fired: ['Gd01#village_sighted', 'Gd02#village_diplomacy', 'Gd03a#spawn_attackforce'].map((n) => fired(n)), q: questState('L09MQ03') });
