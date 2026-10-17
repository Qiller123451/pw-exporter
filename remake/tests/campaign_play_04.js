// include: campaign_bot.js
// Mission 4 "The Dustriders" played by script: the village holds out against the animal attacks while the heroes and
// the Dustrider warriors march north-east, break into the Barbarians' main base (quest "Back on Earth"), beat its
// last line of defence or reach the harbour behind it (quest "Barbarian Main Base") - the film ms_2045 ends the
// mission. The side quests are left alone.
//   python3 tests/evaljs.py tests/campaign_play_04.js "&campaign=4"            (&tribe=Hu: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported (all counted and reported).
const T = (prefix) => E.triggers.find((t) => t.name.startsWith(prefix));
const firedP = (prefix) => { const t = T(prefix); return !!t && t.fired > 0; };
const grp = (name) => { const g = R.group(name); return g ? g.list().map((r) => r.entity).filter((e) => e && e.alive) : []; };
const army = () => fighters().filter((u) => u.cls === 'CHTR' || u.cls === 'ANML');
const foe = (e) => army().length > 0 && army()[0].isEnemy(e) && !!e.owner;
// on the way: fight what stands within 30 m of the army, else walk on
const march = (region) => () => { const a = army(); if (!(a[0] && hunt(a, (e) => foe(e) && e.distTo(a[0]) < 30, 'army'))) goRegion(a, region, 'army'); };
const steps = [
  ['quest "Back on Earth" from the start', () => {}, () => questState('L04MQ01') === 'open', 30],
  ['the army breaks into the Barbarian main base: quest "Back on Earth" accomplished, the last line of defence appears', march('inside_mainbase'), () => firedP('Gb06'), 2400],
  ['the last line of defence is beaten (or the harbour reached): quest "Barbarian Main Base" accomplished', () => { hunt(army(), (e) => grp('last_defense_line').includes(e), 'army') || march('near_the_harbour')(); }, () => questState('L04MQ02') === 'done', 1200],
  ['the film ms_2045 ends the mission', () => {}, () => G.over, 200],
];
runSteps(steps);
ok(!(steps.length > reached.filter(Boolean).length) || (G.over && G.endInfo && G.endInfo.won === true && questState('L04MQ01') === 'done'), 'QUIT: the mission is won, "Back on Earth" accomplished');
return report({ 2: 'Gb06: Entered the mainbase', 3: 'Lb02: SetAccomplished' }) + '\n   won: ' + JSON.stringify(G.endInfo);
