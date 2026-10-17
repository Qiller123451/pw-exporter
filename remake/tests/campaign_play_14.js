// include: campaign_bot.js
// Mission 14 "Prisoners" played by script: after the landing film (sc_6050 / _6050a / _6050b, quest "Hunt Leighton")
// the army walks inland until the first prison comes into sight (sequence sc_7042, quest "Ada's Liberation"), fights
// its way past the SEAS main base onto the way to the last prison (sequence sc_6105: Leighton flees, quest "Hunt
// Leighton" accomplished) and breaks the main prison where Ada is held (quest "Ada's Liberation"); the film ms_7020
// ends the mission. The side quests are left alone.
//   python3 tests/evaljs.py tests/campaign_play_14.js "&campaign=14"           (&tribe=Aje: with another tribe)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a unit
// that makes no progress for 60 s is teleported (all counted and reported).
const army = () => fighters();
const foe = (e) => !!e.owner && e.owner !== me && !me.isFriend(e.owner);
const jail = () => named('seas_jail_part_01_8');
// on the way: fight what stands within 25 m of the first unit (units, towers and turrets), else walk on
const march = (region) => {
  const a = army();
  if (!(a[0] && hunt(a, (e) => foe(e) && e.distTo(a[0]) < 25 && (e.kind === 'unit' || /turret|tower|bunker/.test(e.name)), 'army'))) goRegion(a, region, 'army');
};
const steps = [
  ['the landing film: quest "Hunt Leighton"', () => {}, () => questState('L14MQ01') === 'open', 120],
  ['the army walks inland until the first prison comes into sight: sequence sc_7042, quest "Ada\'s Liberation"', () => march('second_sequence'), () => questState('L14MQ02') === 'open', 1200],
  ['the army gets past the SEAS main base onto the way to the last prison: sequence sc_6105, quest "Hunt Leighton"', () => march('way_to_last_prison'), () => questState('L14MQ01') === 'done', 2400],
  ['the army breaks the main prison: quest "Ada\'s Liberation"', () => {
    const a = army(), j = jail();
    if (!a[0] || !j) return;
    if (!hunt(a, (e) => foe(e) && e.kind === 'unit' && e.distTo(a[0]) < 25, 'army')) hunt(a, (e) => e === j, 'army');
  }, () => questState('L14MQ02') === 'done', 2400],
  ['the film ms_7020 ends the mission', () => {}, () => G.over, 300],
];
runSteps(steps);
ok(!G.over || (G.endInfo && G.endInfo.won === true), 'QUIT: the mission is won');
return report({ 2: '03_ns_7042_must_free_Ada', 3: '02_ns_6105_leighton_flees', 4: '02_L14MQ02_acc_<-[Lb01]', 5: '01_win_level' }) + '\n   won: ' + JSON.stringify(G.endInfo);
