// include: campaign_bot.js
// Mission 5 "The Holy City" played by script: the three heroes cross the city to the temple, free the three
// support points from the pirates (rodeo, animal farm, then the weapon smith), and fight their way to the harbour.
//   python3 tests/evaljs.py tests/campaign_play_05.js "&campaign=5"         (node tests/campaign_play_mock.mjs 5: the trigger chain alone)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a
// unit that makes no progress for 60 s is teleported (all counted and reported).
const P1 = C.players[1], P2 = C.players[2], P3 = C.players[3];
const T = (prefix) => E.triggers.find((t) => t.name.startsWith(prefix));
const firedP = (prefix) => { const t = T(prefix); return !!t && t.fired > 0; };
const v = (n) => +C.variables.get(n) || 0;
const party = () => fighters();
const hostile = (e) => !!e.owner && party().length > 0 && party()[0].isEnemy(e) && e.kind === 'unit';
const grp = (name) => { const g = R.group(name); return g ? g.list().map((r) => r.entity).filter((e) => e && e.alive) : []; };
// a support point: the heroes clear its region of the pirates, then beat the second wave that comes for it
const spot = (k, region, name) => [
  [`support point ${k} (${name}): the pirates in it are beaten`, () => { hunt(party(), (e) => hostile(e) && inRegion(e, region), 'all') || goRegion(party(), region); }, () => v(`spot0${k}_cleared`) >= 1, 900],
  [`the pirates' second wave against support point ${k} is beaten`, () => { hunt(party(), (e) => grp(`2nd_pirates_spot_0${k}`).includes(e), 'all') || goRegion(party(), region); }, () => k === 2 ? v('sum_of_spots') >= 3 : firedP(k === 1 ? 'Gb05' : 'Gb09'), 900],
];
const steps = [
  ['quest "To the Temple" from the start', () => {}, () => quest('L05MQ01').visible, 20],
  ['the heroes cross the city to the temple: sequence sc_2055, quest "Pirates in the Holy City", the pirates take the support points', () => go(party(), 411, 363), () => quest('L05MQ01').accomplished && quest('L05MQ02').visible && firedP('Gb01: InitQuest'), 600],
  ...spot(1, 'Spot1_Rodeo', 'the rodeo'), ...spot(3, 'Spot3_AnimalFarm', 'the animal farm'),
  ['two support points freed: quest accomplished, the last fortification (weapon smith) opens', () => {}, () => quest('L05MQ02').accomplished, 60],
  ...spot(2, 'Spot2_WeaponsBuilder', 'the weapon smith'),
  ['the last fortification is freed: sequence sc_2049, quest "To the Harbour"', () => {}, () => quest('L05MQ04').accomplished && quest('L05MQ03').visible, 120],
  ['the way to the harbour is fought free: the pirates\' last defence falls', () => { hunt(party(), (e) => grp('patrol01').includes(e) || grp('patrol02').includes(e), 'all') || hunt(party(), (e) => hostile(e) && inRegion(e, 'harbour'), 'all') || goRegion(party(), 'harbour'); }, () => quest('L05MQ03').accomplished, 1800],
  ['the film ms_2090 ends the mission (SQNZ quit)', () => {}, () => G.over, 120],
];
const far = runSteps(steps);
if (far >= 11) ok(G.over && G.endInfo && G.endInfo.won === true && ['L05MQ01', 'L05MQ02', 'L05MQ04', 'L05MQ03'].every((n) => questState(n) === 'done'), 'the mission is won, the four main quests accomplished');
info('variables: ' + ['sum_of_spots', 'available_spots', 'spot01_cleared', 'spot02_cleared', 'spot03_cleared', 'Ninja_dead'].map((n) => n + '=' + C.variables.get(n)).join(' '));
return report();
