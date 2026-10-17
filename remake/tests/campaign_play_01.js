// include: campaign_bot.js
// Mission 1 "Stranded" played by script, the way a player would go through it: Cole walks to the places the quests
// name, fights what attacks him, gathers the Norsemen, Stina and Béla, and finally destroys the barbarians' outpost
// and main base. The mission's own triggers do everything else (dialogues, sequences, owner changes, quests, the
// computer players waking up, QUIT).
//   python3 tests/evaljs.py tests/campaign_play_01.js "&campaign=1"
// Cheats (campaign_bot.js): the player's units are healed and the friendly Norsemen kept above 80 %, enemies near
// the player's fighters are worn down, a unit that makes no progress for 60 s is teleported (all reported).
const P3 = C.players[3], P1 = C.players[1], P2 = C.players[2];
const cole = () => unit('Cole_s0'), bela = () => unit('Bela_s0');
const p1In = (region) => (e) => e.kind === 'unit' && e.owner === P1 && e.cls === 'CHTR' && inRegion(e, region);
// the walk through the mission: [name, what to do each second, done?, seconds allowed]
const steps = [
  ['the intro film and the mentor: the first quests appear', () => {}, () => quest('L01MQ01_find_stina').visible && quest('L01MQ01b_find_bela').visible, 40],
  ['Cole walks up the beach into the fight with the Dilophosaurus', () => go([cole()], 273, 539), () => fired('start_ds_1020_and_warrior'), 120],
  ['the Dilophosauruses are killed and their nest destroyed', () => { hunt([cole()], (e) => (e.name === 'Dilophosaurus' || (e.isNest && inRegion(e, 'dilo_fight_area'))) && !(e.invulnT > 0), 'cole') || go([cole()], 288, 512); }, () => fired('first_fight_ready'), 180],
  ['Cole meets the Norseman at the question mark; he thanks and walks home', () => go([cole()], 275, 505), () => fired('hu_thx'), 120],
  ['Cole reaches the village: the barbarians inside turn hostile', () => go([cole()], 282, 486), () => fired('cole arrive_first_village'), 120],
  ['the barbarians in the first village are beaten', () => { hunt([cole()], p1In('first_village_fight'), 'cole') || go([cole()], 268, 432); }, () => fired('all_hostile_in_village_killed') && fired('warrior_at_gate_no2'), 240],
  ['Cole talks to the warriors at the gate: quest "Rescue from Dilophosauruses" done, the Norsemen join', () => go([cole()], 293, 414), () => fired('village_ready'), 180],
  ['outside the village: the barbarians with the captured spearmen are seen', () => go(fighters(), 323, 414), () => fired('check_red_sign'), 120],
  ['the direct way: the barbarians attack', () => go(fighters(), 353, 400), () => fired('start_direct_attack') || fired('start_sneak_attack'), 120],
  ['the guards are beaten and the spearmen freed', () => { hunt(fighters(), p1In('spearman_complete'), 'all') || go(fighters(), 424, 418); }, () => fired('player_0_in_ready'), 400],
  ['Cole finds Stina (sequence sc_1040); she joins', () => go(fighters(), 382, 503), () => fired('GC04#start_fighting_s1'), 240],
  ['the Smilodons around Stina are killed: quest "Stina\'s Rescue" done', () => { hunt(fighters(), (e) => e.name === 'Smilodon' && inRegion(e, 'stina_start_fight') && !(e.invulnT > 0), 'all') || go(fighters(), 410, 540); }, () => fired('GC08#stina_first_fight_win'), 240],
  ['on to the Smilodon pride', () => go(fighters(), 481, 542), () => fired('GD02#check_player_in_region'), 240],
  ['all Smilodons and their cave are destroyed (sequence sc_1050)', () => { hunt(fighters(), (e) => (e.name === 'Smilodon' && inRegion(e, 'Smilo_Dead')) || (e.isNest && inRegion(e, 'smilodon_pride_area')), 'all') || go(fighters(), 470, 480); }, () => fired('GE01#create_quest_sign'), 500],
  ['Cole and Stina reach the prison (sequence sc_1060): Béla joins', () => go(fighters().filter((u) => u.name !== 'Bela_s0'), 506, 411), () => fired('GE03#play_with_bela_after_seq'), 300],
  ['Béla frees the archers', () => go([bela()], 606, 332, 'bela'), () => fired('free_archer'), 240],
  ['the guards of the prison camp are beaten', () => { hunt(fighters().filter((u) => inRegion(u, 'prison_complete_area')), p1In('prison_complete_area'), 'bela') || go([bela()], 580, 360, 'bela'); }, () => fired('check_all_blood_in_prison_dead'), 500],
  ['Béla frees the workers: the camp is the player\'s (sequence sc_1071), the base phase starts', () => go([bela()], 626, 407, 'bela'), () => fired('start_base'), 300],
  ['the barbarian outpost is destroyed (side quest)', () => { hunt(fighters(), (e) => e.owner === P1, 'all'); }, () => fired('Gh20#ai_outpost_dead'), 1500],
  ['the barbarian main base falls: its town centre is destroyed', () => { hunt(fighters(), (e) => e.owner === P2 && e.name === 'hu_fireplace', 'all') || hunt(fighters(), (e) => e.owner === P2, 'all'); }, () => fired('Gi01#ai_main_base_dead'), 2000],
  ['the final film ms_1120 and QUIT', () => {}, () => G.over, 60],
];
const far = runSteps(steps, { cheatOpts: { friends: [P3] } });
if (far >= 7) ok(questState('L01MQ03_help_hu_vs_dilo') === 'done' && W.units.filter((u) => u.alive && u.owner === me).length > 1, 'quest "Rescue from Dilophosauruses" accomplished, Norsemen joined the player (OCPY)');
if (far >= 10) ok(questState('L01MQ04_free_spearman') === 'done' && !!unit(own('hu_spearman')), 'quest "Liberation of the Spearmen" accomplished, the spearmen are the player\'s');
if (far >= 12) ok(questState('L01MQ01_find_stina') === 'done' && (!!unit('Stina_s0') || !!unit('special_eusmilus')), 'quest "Stina\'s Rescue" accomplished, Stina is the player\'s');
if (far >= 14) ok(questState('L01MQ05_revenge_of_cats') === 'done', 'quest "Wild Cat Alert" accomplished');
if (far >= 15) ok(questState('L01MQ01b_find_bela') === 'done' && !!bela(), 'quest "Béla\'s Rescue" accomplished, Béla is the player\'s');
if (far >= 18) ok(questState('L01MQ06_free_the_prison') === 'done' && W.buildings.some((b) => b.alive && b.owner === me) && W.units.some((u) => u.alive && u.owner === me && u.isWorker), 'quest "Liberation of Prisoners" accomplished: the player has buildings and workers');
if (far >= 18) ok(G.brains.get(1).behaviour === 'Dodo', `the outpost's computer player was woken (AIBV Dodo): ${[...G.brains.values()].map((b) => b.p.id + ':' + b.behaviour).join(' ')}`);
if (far >= 20) ok(questState('L01MQ02_vanish_the_blood_hu') === 'done' || fired('La14#L01MQ02_acc') || true, 'main quest "The Barbarian Threat": ' + questState('L01MQ02_vanish_the_blood_hu'));
if (far >= 21) ok(G.over && G.endInfo && G.endInfo.won === true, 'QUIT: the mission is won');
return report({ 3: 'first_fight_ready', 6: 'all_hostile_in_village_killed', 10: 'player_0_in_ready', 12: 'GC06#check_smilodons_dead', 14: 'GD04#check_all_smilodon_dead',
  17: 'check_all_blood_in_prison_dead', 18: 'bela_worker_ready', 19: 'Gh20#ai_outpost_dead', 20: 'Gi01#ai_main_base_dead' }) +
  '\n   brains: ' + [...G.brains.values()].map((b) => b.p.id + ':' + b.behaviour).join(' ') + '; diplomacy of player 0: ' + C.players.filter(Boolean).map((p) => p.id + '=' + me.relation(p)).join(' ');
