// include: campaign_bot.js
// Mission 3 "Amazon Island" played by script: the heroes make their way into the Amazon fortress and attack the
// temple; when it is down to 2000 hit points the Amazons give in (sequence sc_2010) and the mission is won. The
// workers keep the base going meanwhile.
//   python3 tests/evaljs.py tests/campaign_play_03.js "&campaign=3"            (&tribe=SEAS: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported (all counted and reported).
const temple = () => named('amazon_temple_5');
const templeAt = () => { const t = temple(); return t ? C.toMap(t.pos.x, t.pos.z).map(Math.round) : [587, 822]; };
const steps = [
  ['the opening film ms_2005: quest "The Amazon Temple"', () => gather(), () => questState('L03MQ01') === 'open', 120],
  ['the heroes reach the temple and attack it: quest accomplished, sequence sc_2010', () => {
    gather();
    const t = temple();
    if (t && fighters().some((u) => u.distTo(t) < 30)) { for (const u of fighters()) if (u.task.type !== 'attack' || u.task.target !== t) W.order([u], { type: 'attack', target: t }); }
    else go(fighters(), ...templeAt());
  }, () => questState('L03MQ01') === 'done', 2400],
  ['the film ends the mission (QUIT)', () => {}, () => G.over, 200],
];
runSteps(steps);
return report({ 2: '02_L03MQ01_acc_<-[La01]', 3: '02_win_game' }) + '\n   won: ' + JSON.stringify(G.endInfo);
