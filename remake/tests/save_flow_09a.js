// include: campaign_bot.js
// (tests/save_campaign_flow.py, page 1: mission 9 up to the broken bridge, then saved)
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
  ];
const far = runSteps(steps);
for (let s = 0; s < 6; s++) G.step(20, 0.05);
const E0 = C.engine; const cnt = { Et: Math.round(E0.time), Wt: Math.round(W.time), en: E0.triggers.filter((t) => t.enabled).length, fired: E0.triggers.filter((t) => t.fired > 0).length, n: E0.triggers.length, gd02: (E0.triggers.find((t) => t.name.startsWith('Gd02#')) || {}).enabled };
const meta = await G.saveGame('m9 bridge');
const st = (name) => { const L = grp(name); return { n: L.length, invul: L.filter((e) => e.invulnT > 0).length }; };
return JSON.stringify({ cnt, far, id: meta && meta.id, att: st('04_attgroup01'), def: st('05_defgroup01'), fired: ['Gd01#village_sighted', 'Gd02#village_diplomacy'].map((n) => fired(n)) });
