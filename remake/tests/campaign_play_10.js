// include: campaign_bot.js
// Mission 10 "The Prophet" played by script: after the opening film sc_3080 the heroes and the archers make their way
// north through the jungle until the temple comes into sight (sequence sc_3070, quest "Stalking"), then fight through
// the SEAS base to the temple entrance (quest "No Trespassing"); the film sc_3090 ends the mission. The workers stay
// at the start. The side quests are left alone.
//   python3 tests/evaljs.py tests/campaign_play_10.js "&campaign=10"           (&tribe=Hu: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported (all counted and reported).
const three = () => ['Bela_s0', 'Cole_s0', 'special_eusmilus'].map(unit).filter(Boolean);
const army = () => fighters().filter((u) => u.name !== 'darwin_s0');
const foe = (e) => army().length > 0 && army()[0].isEnemy(e) && !!e.owner;
// on the way: fight what stands within 25 m of the first unit, else walk on
const march = (units, region, key) => { const a = units; if (!(a[0] && hunt(a, (e) => foe(e) && e.distTo(a[0]) < 25 && (e.kind === 'unit' || /tower|turret|gate|wall/.test(e.name)), key))) goRegion(a, region, key); };
const steps = [
  ['the opening film sc_3080: quest "Stalking"', () => {}, () => questState('L10MQ01') === 'open', 120],
  ['the army makes its way north until the temple comes into sight: sequence sc_3070, quest "Stalking"', () => march(army(), 'trigger_sc_3070', 'army'), () => questState('L10MQ01') === 'done', 2400],
  ['Béla, Cole and Stina fight through the SEAS base to the temple entrance: quest "No Trespassing"', () => {
    march(army().filter((u) => !three().includes(u)), 'trigger_temple', 'army');
    march(three(), 'trigger_temple', 'heroes');
  }, () => questState('L10MQ02') === 'done', 3000],
  ['the film sc_3090 ends the mission', () => {}, () => G.over, 300],
];
runSteps(steps);
return report({ 2: 'L01b#mq01_done', 3: 'L02b#mq02_done', 4: 'S04#sc_3090' }) + '\n   won: ' + JSON.stringify(G.endInfo) +
  '\n   variables: ' + ['alarm_set', 'mq02_done', 'player01_dead', 'player02_dead'].map((n) => n + '=' + C.variables.get(n)).join(' ');
