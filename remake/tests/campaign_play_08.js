// include: campaign_bot.js
// Mission 8 "Valley of the Gods" played by script: the heroes escort the archaeologist Kleemann (schliemann_s0) to
// the three keystones (their guards must be dead first), beat the undead that then come out of Valhalla's gate,
// walk into Valhalla and through its guardians to the final fight.
//   python3 tests/evaljs.py tests/campaign_play_08.js "&campaign=8"         (node tests/campaign_play_mock.mjs 8: the trigger chain alone)
// Cheats (campaign_bot.js): the player's units are healed, enemies near the player's fighters are worn down, a
// unit that makes no progress for 60 s is teleported (all counted and reported).
const P1 = C.players[1], P2 = C.players[2], P3 = C.players[3];
const T = (prefix) => E.triggers.find((t) => t.name.startsWith(prefix));
const firedP = (prefix) => { const t = T(prefix); return !!t && t.fired > 0; };
const v = (n) => +C.variables.get(n) || 0;
const party = () => fighters();
const grp = (name) => { const g = R.group(name); return g ? g.list().map((r) => r.entity).filter((e) => e && e.alive) : []; };
const inGroup = (name) => { const s = new Set(grp(name)); return (e) => s.has(e); };
const stone = (k, at) => [
  [`the guards of keystone ${k} are beaten`, () => { hunt(party(), inGroup('stoneguards0' + k), 'all') || go(party(), at[0], at[1]); }, () => grp('stoneguards0' + k).length === 0, 900],
  [`Kleemann is brought to keystone ${k}: the crystal is activated`, () => go(party(), at[0], at[1]), () => v('keystone_0' + k) === 1, 400],
];
const steps = [
  ['the opening sequence sc_2590; quests "Opening the Gate I" and "Protective Escort"', () => {}, () => quest('L08MQ01').visible && quest('L08MQ02').visible, 30],
  ...stone(1, [282, 886]),
  ['sequence sc_2583a, quest 1 done, quest "Opening the Gate II" with the crystal counter', () => {}, () => quest('L08MQ01').accomplished && quest('L08MQ03').visible, 30],
  ...stone(2, [652, 867]), ...stone(3, [211, 438]),
  ['all three crystals: sequence sc_2585, the undead march out of Valhalla (quest "Counting the Undead")', () => {}, () => quest('L08MQ03').accomplished && quest('L08MQ04').visible && grp('undead01').length > 0, 40],
  ['the four undead groups are destroyed', () => { hunt(party(), (e) => ['undead01', 'undead02', 'undead03', 'undead04'].some((g) => grp(g).includes(e)), 'all'); }, () => v('undead_defeated') === 1, 1500],
  ['heroes and Kleemann gather before the gate: sequence sc_3004, the base is left behind', () => go(party(), 441, 418), () => firedP('G03#occupy_playerbase') && quest('L08MQ05').visible, 500],
  ['the undead behind the gate are beaten: sequence sc_3005, Kleemann walks off', () => { hunt(party(), inGroup('undead05'), 'all') || go(party(), 730, 330); }, () => firedP('S05#sc_3005') && ui.seq.some((s) => /^sc_3005/.test(s)), 900],
  ['the guardians of Valhalla are beaten (sequence sc_3009)', () => { hunt(party(), (e) => e.owner === P3 && inRegion(e, 'showdown'), 'all') || go(party(), 791, 265); }, () => firedP('Gg05a#init_schliemann'), 900],
  ['Kleemann, turned into an undead, is defeated: the final sequence sc_3012 wins the mission', () => { hunt(party(), (e) => e.name === 'schliemann_zombie', 'all') || go(party(), 791, 265); }, () => G.over, 600],
];
const far = runSteps(steps);
if (far >= 4) ok(E.inactive.size < 7 && D.list('order_0').some((r) => r.nodeActive), 'ACND activated one of the three "capture order" folders: ' + D.list('order_0').filter((r) => r.nodeActive).map((r) => r.name).join(', '));
if (far >= 9) ok(questState('L08MQ03') === 'done' && v('keystones') === 3, 'three crystals counted, quest "Opening the Gate II" accomplished');
if (far >= 13) ok(G.over && G.endInfo && G.endInfo.won === true && questState('L08MQ06') === 'done' && questState('L08MQ05') === 'done' && questState('L08MQ02') === 'done', 'SQNZ quit: the mission is won; escort, journey and revelations accomplished');
return report();
