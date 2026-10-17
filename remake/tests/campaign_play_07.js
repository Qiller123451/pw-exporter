// include: campaign_bot.js
// Mission 7 "The Water Temple" played by script: Cole, Béla and Stina flee from the pirates to Taslow's house
// (question mark 1: the film ms_2560, Taslow joins, quest "The Chase" accomplished), take Taslow to the Water Temple
// (sequence sc_2567, quest "The Water Temple"), then beat the SEAS' Black Widows and their hovercraft convoy (quest
// "Spider Attack"); the film ms_2580 ends the mission. The side quests are left alone.
//   python3 tests/evaljs.py tests/campaign_play_07.js "&campaign=7"            (&tribe=Hu: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported (all counted and reported).
const P3 = C.players[3];
const four = () => ['Cole_s0', 'Bela_s0', 'special_eusmilus', 'tesla_s0'].map(unit).filter(Boolean);
const army = () => fighters();
const seas = (e) => e.owner === P3 && /seas_wehrspinne|seas_hovercraft/.test(e.name) && !e.inside;
const steps = [
  ['quest "The Chase" from the start', () => {}, () => questState('L07MQ01') === 'open', 30],
  ['the heroes reach Taslow\'s house (question mark 1): film ms_2560, Taslow joins', () => goRegion(four(), 'qm1', 'heroes'), () => questState('L07MQ01') === 'done' && !!unit('tesla_s0'), 2400],
  ['Cole, Béla, Stina and Taslow reach the Water Temple: sequence sc_2567, quest "The Water Temple"', () => goRegion(four(), 'water sanctuary', 'heroes'), () => questState('L07MQ02') === 'done', 2400],
  ['the Black Widows and the hovercraft convoy of the SEAS are beaten: quest "Spider Attack"', () => { hunt(army(), seas, 'army'); }, () => questState('L07MQ03') === 'done', 3000],
  ['the film ms_2580 ends the mission', () => {}, () => G.over, 300],
];
runSteps(steps);
return report({ 2: 'Qab01: green ?', 3: 'Ie07: fire NS2567', 4: 'Lc02: L07MQ03 - set acc' }) + '\n   won: ' + JSON.stringify(G.endInfo) +
  '\n   variables: ' + ['all Wehrspinnen disembarked', 'Wehrspinnen zerstört', 'WehrspinnenConvoi destroyed', 'fire NS2567'].map((n) => n + '=' + C.variables.get(n)).join(' ');
