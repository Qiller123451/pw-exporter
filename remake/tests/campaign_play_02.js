// include: campaign_bot.js
// Mission 2 "Druid Island" played by script: the heroes leave the base, drive the poachers from the four mammoth
// caves (at least seven mammoths must be counted as saved), and destroy the Dustrider base in the north.
//   python3 tests/evaljs.py tests/campaign_play_02.js "&campaign=2"         (node tests/campaign_play_mock.mjs 2: the trigger chain alone)
// Cheats (campaign_bot.js): the player's units and the holy mammoths are healed, enemies near the player's
// fighters are worn down, a unit that makes no progress for 60 s is teleported (all counted and reported).
const P1 = C.players[1], P2 = C.players[2], P3 = C.players[3];
const T = (prefix) => E.triggers.find((t) => t.name.startsWith(prefix));
const firedP = (prefix) => { const t = T(prefix); return !!t && t.fired > 0; };
const v = (n) => +C.variables.get(n) || 0;
const foeIn = (region) => (e) => (e.owner === P1 || e.owner === P2) && inRegion(e, region);
const nest = (k) => [
  [`the way to mammoth cave ${k}: the poachers there attack the mammoths`, () => goRegion(fighters(), 'enter_nest_' + k), () => firedP(`01_attack_first_mammoth_nest_${k}`), 400],
  [`the poachers at cave ${k} are driven away and their buildings destroyed: the cave is saved`, () => { hunt(fighters(), foeIn('check_nest_' + k), 'all') || goRegion(fighters(), 'check_nest_' + k); }, () => firedP(`01_nest_${k}_saved`) || v('nests_saved') >= k, 900],
];
const steps = [
  ['the intro film ms_1090; quest "Help for the Arch Druid" is shown; the Dustriders\' computer player builds (Turtle)', () => {}, () => quest('L02MQ01_help_druid').visible && ui.seq.some((s) => /^ms_1090/.test(s)), 20],
  ['the heroes leave the base: quest "Mammoth Rescue" and the counter in the info bar', () => goRegion(fighters(), 'player_leave_base'), () => firedP('01_L02MQ02_vis') && quest('L02MQ02_retrieve_the_mammoths').visible, 300],
  ...nest(1), ...nest(2), ...nest(3), ...nest(4),
  ['seven mammoths are saved: quest accomplished, sequence sc_1082, the Dustriders land by turtle', () => {}, () => quest('L02MQ02_retrieve_the_mammoths').accomplished && firedP('01_L02MQ03_vis'), 60],
  ['the Dustrider base in the north is destroyed (all units and production buildings)', () => { hunt(fighters(), (e) => e.owner === P1, 'all') || goRegion(fighters(), 'dustrider_base'); }, () => firedP('02_L02MQ03_acc'), 2500],
  ['the final sequence sc_1089 and QUIT', () => {}, () => G.over, 60],
];
const mammoths = { friends: [P3] };
const far = runSteps(steps, { cheatOpts: mammoths });
if (far >= 2) ok(/Mammoth|\d+ ?\/ ?\d+/.test(E.infoBarShown || '') || far >= 11, `the info bar shows the mammoth counter ("${E.infoBarShown}")`);
if (far >= 1) ok(G.brains.get(1) && /Turtle|Giraffe|Schnecke/.test(G.brains.get(1).behaviour || ''), 'the Dustriders\' computer player was woken: ' + [...G.brains.values()].map((b) => b.p.id + ':' + b.behaviour).join(' '));
if (far >= 10) ok(v('nests_saved') === 4 && v('mammoths_saved') >= 7, `four caves saved, ${v('mammoths_saved')} mammoths counted (of ${v('Mammoth_Max')})`);
if (far >= 11) ok(questState('L02MQ02_retrieve_the_mammoths') === 'done' && ui.seq.some((s) => /^sc_1082/.test(s)), 'quest "Mammoth Rescue" accomplished, sequence sc_1082');
if (far >= 11) ok(firedP('02_spawn_turtle_to_second_harborplace') && W.units.some((u) => /transport_turtle/.test(u.name)), 'the landing parties were created (CPLX: transport turtles with passengers)');
if (far >= 13) ok(G.over && G.endInfo && G.endInfo.won === true && questState('L02MQ03_destroy_the_poachers') === 'done' && questState('L02MQ01_help_druid') === 'done', 'QUIT: the mission is won, all three main quests accomplished');
info('variables: ' + ['Mammoth_Max', 'mammoths_saved', 'nests_saved'].map((n) => n + '=' + C.variables.get(n)).join(' '));
return report() + '\n   brains: ' + [...G.brains.values()].map((b) => b.p.id + ':' + b.behaviour + (b.launched ? ' attacks ' + b.launched.length : '')).join(' ');
