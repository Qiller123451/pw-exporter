// include: campaign_bot.js
// Mission 0 "Tutorial" played by script, the way a player follows Ada and the mentor: camera lessons, the heroes to
// the marker, the Smilodon in the village, rebuilding the village (food, workers, stone quarry, forester's lodge,
// resources, repairs), Béla from the tavern, ... The mission's own triggers do everything else.
//   python3 tests/evaljs.py tests/campaign_play_00.js "&campaign=0"            (&tribe=SEAS: with another tribe)
const regionMap = (n) => C.toMap(...regionC(n)).map(Math.round);
const home = () => named('hu_fireplace_1') || myBuildings().find((b) => b.def && b.def.script === 'CFireplace') || myBuildings()[0];
const homeMap = () => { const h = home(); return h ? C.toMap(h.pos.x, h.pos.z).map(Math.round) : [711, 472]; };
const smilodon = (region) => (e) => /Smilodon/i.test(e.name) && e.kind === 'unit' && (!region || inRegion(e, region)) && !(e.invulnT > 0);
const workersTo = (n) => { const have = workers().length + [...myBuildings(), ...mine()].reduce((s, b) => s + (b.queue || []).filter((q) => /worker/.test(q.action.results[0].obj)).length, 0); if (have < n) produce('hu_worker', n - have); };
const woodNear = () => { const [x, z] = home() ? [home().pos.x, home().pos.z] : C.toGame(711, 472); const n = W.nearestResource(x, z, 'wood', 150); return n ? C.toMap(n.pos.x, n.pos.z).map(Math.round) : homeMap(); };
const repairs = () => { for (const n of ['hu_fireplace_1', 'hu_stone_cottage_2']) { const b = named(n); if (b && b.hp < b.maxHp) { const ws = workers().filter((w) => w.task.type !== 'repair').slice(0, 2); if (ws.length) W.order(ws, { type: 'repair', target: b }); } } };
const steps = [
  // ---- chapter 1
  ['the camera lessons: scroll, zoom, turn', () => camera(!fired('Gaa06#cam_is_moved') ? 'scroll' : !fired('Gaa11#cam_is_zoomed') ? 'zoom' : 'pan'), () => fired('Gaa16#cam_is_panned'), 400],
  ['the heroes are the player\'s and walk to the marker', () => goRegion(heroes(), 'First_Quest_Move'), () => fired('Gaa30#heros_moved'), 400],
  ['the Smilodon in the village is killed', () => { hunt(heroes(), smilodon('Smilodon_1_dead'), 'heroes') || goRegion(heroes(), 'Smilodon_1_dead'); }, () => fired('Gaa38#smilodon_dead'), 400],
  ['the heroes follow Ada: chapter 1 is over', () => goRegion(heroes(), 'End_Cap_1'), () => fired('Gaa44#Cap_End'), 400],
  // ---- chapter 2
  ['the workers harvest 90 food', () => gather('food'), () => fired('Gba06#Food_harvested'), 400],
  ['3 more workers', () => { workersTo(6); gather('food'); }, () => fired('Gba16#Worker_ready'), 400],
  ['a hero finds the stones', () => { goRegion([unit('Cole_s0')], 'Stone_sighted', 'cole'); gather(); }, () => fired('Gba23#Stone_found'), 400],
  ['a stone quarry next to the stones', () => { build('hu_stone_quarry', ...regionMap('Stone_sighted')); gather(); }, () => fired('Gba37#StoneQ_build'), 600],     // (another tribe: a bigger building, the stone from one pile 150 m away)
  ['a forester\'s lodge next to the woods', () => { build('hu_lumberjack_cottage', ...woodNear()); gather(); }, () => fired('Gba36#Forrester_build'), 400],
  ['300 food, wood and stone', () => { workersTo(9); gather({ food: 320, wood: 320, stone: 320 }); }, () => fired('Gba31#all_ready'), 1500],
  ['the town centre and the cottage are repaired', () => { repairs(); gather(); }, () => fired('Gba45#All_repaired'), 600],
  ['Béla is hired in the tavern', () => { if (!unit('Bela_s0')) produce('Bela_s0', 1); }, () => fired('Gba63#Bela_is_free'), 400],
  // ---- chapter 3
  ['two more cottages', () => { build('hu_stone_cottage', ...homeMap(), { count: 3 }); gather(); }, () => fired('Gca11#cottages_ready'), 900],
  ['epoch 2 in the town centre', () => { if (!fired('Gca15#age_2_reached')) produce('age_2', 1, 'Upgrades'); gather(); }, () => fired('Gca15#age_2_reached'), 900],
  ['a barracks', () => { build('hu_arena', ...homeMap()); gather(); }, () => fired('Gca19#barracks_build'), 600],
  ['4 spearmen', () => { const sp = own('hu_spearman'); const have = mine().filter((u) => u.name === sp).length + myBuildings().reduce((n, b) => n + b.queue.filter((q) => q.action.results[0].obj === sp).length, 0); if (have < 4) produce('hu_spearman', 4 - have); gather(); }, () => fired('Gca26#all_spearm_build'), 900],
  ['the heroes and spearmen find the nest', () => goRegion(fighters(), 'Smilodon_nest_seen'), () => fired('Gca33#Nest_found'), 600],
  ['the Smilodons and their nest are destroyed', () => { hunt(fighters(), (e) => smilodon()(e) || (e.isNest && inRegion(e, 'Smilodon_nest_seen')), 'all') || goRegion(fighters(), 'Smilodon_nest_seen'); }, () => fired('Gca39#Nest_Smilos_killed'), 600],
  ['a unit is promoted', () => promote(), () => fired('Gca49#level_uped'), 400],
  ['back to Ada at the second gate', () => goRegion(fighters(), 'Second_Gate'), () => fired('Gca44#by_ada'), 600],
  // ---- chapter 4
  ['an animal farm', () => { build('hu_small_animal_farm', ...homeMap()); gather(); }, () => fired('Gda05#farm_build'), 600],
  ['a chariot', () => { if (!unit(own('hu_chariot')) && !myBuildings().some((b) => b.queue.length)) produce('hu_chariot', 1); gather(); }, () => fired('Gda09#chariot_build'), 600],
  ['an archer', () => { if (!unit(own('hu_archer')) && !myBuildings().some((b) => b.queue.some((q) => q.action.results[0].obj === own('hu_archer')))) produce('hu_archer', 1); gather(); }, () => fired('Gda13#archer_build'), 600],
  ['the archer boards the chariot', () => { const a = unit(own('hu_archer')), c = unit(own('hu_chariot')); if (a && c && !a.inside && a.task.type !== 'board') W.order([a], { type: 'board', target: c }); }, () => fired('Gda14#archer_loaded'), 300],
  ['the thief: caught or escaped', () => { const c = unit(own('hu_chariot')); hunt([c], (e) => e.owner === C.players[3] && e.kind === 'unit', 'chariot'); }, () => fired('Gda21#thief_hunted') || fired('Gda20#thief_safe'), 400],
  ['10 fighters at the third gate', () => { const F = mine().filter((u) => !u.isWorker); if (F.length < 11 && !myBuildings().some((b) => b.queue.length)) { topUp({ food: 400, wood: 300 }); produce('hu_warrior', 2); } goRegion(F, 'Ready_for_last_fight'); gather(); }, () => fired('Gda26#open_gate_3'), 1200],
  // (walking there is not enough: the item is picked up with the right click's "pick up" order, systems/items.js)
  ['the artifact is picked up', () => {
    const it = R.byName('item_amulett1_2'), cole = unit('Cole_s0');
    const e = it && (it.prop || it.entity), item = e && e.item ? e : W.items && W.items.find((x) => x.item && x.item.cls === 'item_amulett1');
    if (!cole || !item || item.item.carrier) return;
    if (cole.task.type !== 'pickup') W.order([cole], { type: 'pickup', target: item });
  }, () => fired('Gda29#item_found'), 600],
  ['the attackers are beaten', () => { hunt(fighters(), (e) => e.owner === C.players[2] && e.kind === 'unit', 'all'); }, () => fired('Gda33_0#Check'), 900],
  ['the final sequence and QUIT', () => {}, () => G.over, 200],
];
runSteps(steps);
return report({ 1: 'Gaa16#cam_is_panned', 2: 'Gaa30#heros_moved', 3: 'Gaa38#smilodon_dead', 4: 'Gaa44#Cap_End', 5: 'Gba06#Food_harvested', 6: 'Gba16#Worker_ready',
  7: 'Gba23#Stone_found', 8: 'Gba37#StoneQ_build', 9: 'Gba36#Forrester_build', 10: 'Gba31#all_ready', 11: 'Gba45#All_repaired', 12: 'Gba63#Bela_is_free',
  13: 'Gca11#cottages_ready', 14: 'Gca15#age_2_reached', 15: 'Gca19#barracks_build', 16: 'Gca26#all_spearm_build', 17: 'Gca33#Nest_found', 18: 'Gca39#Nest_Smilos_killed',
  19: 'Gca49#level_uped', 20: 'Gca44#by_ada', 21: 'Gda05#farm_build', 22: 'Gda09#chariot_build', 23: 'Gda13#archer_build', 24: 'Gda14#archer_loaded', 26: 'Gda26#open_gate_3',
  27: 'Gda29#item_found', 28: 'Gda33_0#Check', 29: 'Ea01#Exit_Kap_2' }) + '\n   won: ' + JSON.stringify(G.endInfo);
