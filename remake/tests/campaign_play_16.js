// include: campaign_bot.js
// Mission 16 "Showdown!" played by script: after the opening film sc_7050 (quests "Survival" and "Stampede") the
// heroes break the barracks and garages of the three SEAS bases and beat their troops (quest "Stampede", sequence
// sc_7052: the Scorpio wakes up, quest "The Scorpion"), destroy the Scorpio (sequence sc_7054, quest "Exo Enforcer")
// and then Babbit's combat suit (quests "Exo Enforcer" and "Survival"); the film ms_7060 ends the mission. The side
// quest is left alone.
//   python3 tests/evaljs.py tests/campaign_play_16.js "&campaign=16"           (&tribe=Aje: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported (all counted and reported).
const P2 = C.players[2];
const army = () => fighters();
const foe = (e) => !!e.owner && e.owner !== me && !me.isFriend(e.owner);
const near = (e, a) => e.distTo(a[0]) < 25;
const base = (e) => e.owner === P2 && e.kind === 'building' && /seas_(barracks|garage)/.test(e.name);
const troops = (e) => e.owner === P2 && e.kind === 'unit';
// fight what is close first, then the step's target
const fight = (target) => () => { const a = army(); if (a[0] && !hunt(a, (e) => foe(e) && e.kind === 'unit' && near(e, a), 'army')) hunt(a, target, 'army'); };
const steps = [
  ['the opening film sc_7050: quests "Survival" and "Stampede"', () => {}, () => questState('L16MQ02') === 'open', 120],
  ['the barracks and garages of the three SEAS bases are broken: quest "Stampede"', fight(base), () => questState('L16MQ02') === 'done', 2400],
  ['the last SEAS troops are beaten: sequence sc_7052, quest "The Scorpion"', fight(troops), () => questState('L16MQ03') === 'open', 900],
  ['the Scorpio is destroyed: sequence sc_7054, quest "Exo Enforcer"', fight((e) => e.name === 'scorpion' || /^scorpion_panel/.test(e.name)), () => questState('L16MQ04') === 'open', 1800],
  ['Babbit\'s combat suit is beaten: quests "Exo Enforcer" and "Survival"', fight((e) => e.name === 'babbage_mobile_suit'), () => questState('L16MQ04') === 'done' && questState('L16MQ01') === 'done', 1200],
  ['the film ms_7060 ends the mission', () => {}, () => G.over, 600],
];
runSteps(steps);
ok(!G.over || (G.endInfo && G.endInfo.won === true), 'QUIT: the mission is won');
return report({ 2: '02_L16MQ02_acc_<-[Lb01]', 3: '02_sc_7052_skorpion_quest_<-[Lb02]', 4: '02_L16MQ03_acc_<-[Lc01]', 5: '02_L16MQ04_acc_<-[Ld01]', 6: '02_win_level' }) + '\n   won: ' + JSON.stringify(G.endInfo) +
  '\n   variables: ' + ['C_dead', 'V_dead', 'CV_dead', 'conquered_towers'].map((n) => n + '=' + C.variables.get(n)).join(' ');
