// include: campaign_bot.js
// Mission 6 "Pirates and Hostages" played by script: the army fights its way west to the pirates' prison and breaks
// its buildings (the hostages are free: sequence sc_8080, quest "Freeing the Hostages"), then goes for the big
// pirate ship in the bay (sequence sc_8013, quest "The big Pirate Ship"); the film ms_8090 ends the mission. The
// ransom side quests are left alone.
//   python3 tests/evaljs.py tests/campaign_play_06.js "&campaign=6"            (&tribe=Hu: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported (all counted and reported).
const P1 = C.players[1], P6 = C.players[6];
const army = () => fighters();
const foe = (e) => army().length > 0 && army()[0].isEnemy(e) && !!e.owner;
const prison = (e) => e.kind === 'building' && e.owner === P6 && inRegion(e, 'prison_op') && !/palisade/.test(e.name);
const boss = (e) => e.owner === P1 && (/^pirate_boss/.test(e.name) || (e.kind === 'building' && inRegion(e, 'check_boss')));
const steps = [
  ['quest "Freeing the Hostages" from the start', () => {}, () => questState('L06MQ01') === 'open', 60],
  ['the army reaches the pirates\' prison and breaks its buildings: the hostages are free (sc_8080)', () => {
    const a = army();
    if (!(a[0] && hunt(a, (e) => foe(e) && e.kind === 'unit' && e.distTo(a[0]) < 25, 'army')) && !(inRegion(a[0], 'prison_op') && hunt(a, prison, 'army'))) goRegion(a, 'At the prison', 'army');
  }, () => questState('L06MQ01') === 'done', 2400],
  ['the big pirate ship in the bay is sunk (sc_8013)', () => { hunt(army(), boss, 'army') || goRegion(army(), 'check_boss', 'army'); }, () => questState('L06MQ02') === 'done', 1800],
  ['the film ms_8090 ends the mission', () => {}, () => G.over, 300],
];
runSteps(steps);
return report({ 2: 'S05: NS_8080 - All hostages are free delay', 3: 'Gb01: delay S03: 8013' }) + '\n   won: ' + JSON.stringify(G.endInfo);
