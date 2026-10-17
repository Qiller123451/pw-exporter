// The army budget (game/pointbuy.js, ui/pointbuy.js): prices, presets, buying and selling, moving cards, resources
// with the original's rounding, the computer players' armies, the start of a 1000 points game, the "My Army" page
// of the skirmish setup and the army screen of a campaign mission.
//   python3 tests/evaljs.py tests/pointbuy.js "&players=Hu,Aje,Ninigi&teams=1,2,2&points=1000&levels=5,5"
const W = G.world, D = G.data, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const PB = G.pointBuy, me = G.me;
ok(PB && PB.ready, 'the price list is in the game data');
// prices: NewPointBuyCosts.txt (BoosterPack1's)
ok(PB.price('hu_worker', 1, 'Hu') === 60 && PB.price('hu_warrior', 5, 'Hu') === 2000 && PB.price('hu_spearman', 1, 'Hu') === 0, 'unit prices by level (0 = not at that level)');
ok(PB.price('Bela_s0', 3, 'Aje') === 2000 && PB.price('special_eusmilus', 1, 'Hu') === 600, 'heroes: the same for every tribe, Stina rides her sabre-tooth');
ok(PB.resCost('wood', 1, 'Hu') === 2 && PB.resCost('wood', 2, 'Hu') === 3 && PB.resCost('stone', 7, 'Hu') === 14 && PB.resFor('wood', 10, 'Hu') === 6, 'resources: ceil(rate x amount), floor(points / rate)');
// presets: exactly the budget, Standard first; SEAS gets a made-up one
const pre = PB.presets('Hu', 1000);
ok(pre.length === 3 && pre[0].kind === 'standard' && pre.some((p) => p.kind === 'boomer') && pre.some((p) => p.kind === 'rusher'), 'Hu at 1000: Standard, Boomer, Rusher', pre.map((p) => p.kind));
const seas = PB.presets('SEAS', 1000);
ok(seas.length === 1 && Object.keys(seas[0].units).length === 3, 'SEAS: a made-up Standard (three workers, the rest resources)', seas[0].res);
// every default preset costs exactly its budget + the 30 point gift
const t1000 = PB.total(1000, 'Hu');
const std = PB.load(PB.preset('Hu', 1000, 'standard'), 'Hu', t1000);
ok(t1000 === 1030 && PB.cost(std, 'Hu') === 1030 && PB.left(std, t1000, 'Hu') === 0, 'the Standard preset uses all 1030 points', PB.cost(std, 'Hu'));
ok(std.res.food >= 30 && std.min.food === 30, 'multiplayer: at least 30 food, never sold below');
// Aje: the resource collector card in slot 24, fixed; its price is part of the points
const aje = PB.load(PB.preset('Aje', 1000, 'standard'), 'Aje', PB.total(1000, 'Aje'));
ok(aje.cards[24] === 'aje_resource_collector' && aje.fixed[24] === 1 && PB.total(1000, 'Aje') === 1280, 'Aje: the collector card (slot 24, fixed), 250 points more');
// buying, selling, moving
const a = PB.clear('Hu');
ok(Object.keys(a.cards).length === 0 && a.res.food === 30, 'Clear: no cards, 30 food');
const s1 = PB.buy(a, 'hu_warrior', 2, t1000, 'Hu');
ok(s1 === 25 && a.cards[25] === 'hu_warrior' && PB.left(a, t1000, 'Hu') === 1030 - 30 - 150, 'buy at level 2: the first free slot of the row, 150 points', PB.left(a, t1000, 'Hu'));
ok(PB.buy(a, 'hu_spearman', 1, t1000, 'Hu') === null, 'no price at that level: not bought');
const h = PB.buyLowest(a, 'Bela_s0', t1000, 'Hu');
ok(h === 0 && PB.buyLowest(a, 'Bela_s0', t1000, 'Hu') === null, 'a hero: once (double click: the lowest level)');
ok(PB.canMove(a, 25, 40, t1000, 'Hu') && !PB.canMove(a, 25, 51, t1000, 'Hu'), 'moving up: only when the points allow it');
PB.move(a, 25, 40);
ok(a.cards[40] === 'hu_warrior' && !(25 in a.cards), 'moved to level 3');
PB.sell(a, 40);
ok(!(40 in a.cards), 'sold: the points are back');
const before = PB.left(a, t1000, 'Hu');
PB.addRes(a, 'wood', 1000, t1000, 'Hu');
ok(PB.left(a, t1000, 'Hu') >= 0 && PB.left(a, t1000, 'Hu') < 2 && a.res.wood === Math.floor(before / 1.5), 'buying wood: as much as the points pay', [a.res.wood, PB.left(a, t1000, 'Hu')]);
PB.addRes(a, 'food', -1000, t1000, 'Hu');
ok(a.res.food === 30, 'selling food: not below 30');
// the computer players' armies (AiPBPreset files)
const ai = PB.aiPreset('Aje', 1000, 'G1', 8);
ok(ai && Object.values(ai.units).includes('Stina_s0'), 'Aje, Giraffe G1, hard, 1000 points: its file\'s tier', ai && ai.units);
const gen = PB.aiPreset('Ninigi', 3000, 'D2', 4);
ok(gen && Object.values(gen.units).every((c) => !/^(warrior|scout)$/.test(c)), 'the generic files\' warrior / scout: the tribe\'s own units', gen && Object.values(gen.units));
// the game's start: 1000 points
const units = (p) => W.units.filter((u) => u.alive && u.owner === p);
ok(units(me).length === Object.keys(std.cards).length && me.res.food === std.res.food && me.res.wood === std.res.wood, 'you start with the Standard army and its resources', [units(me).length, me.res]);
for (const p of W.players.filter((x) => x.ai)) ok(units(p).length >= 2 && !p.pbStart, `${p.name}: its bought army (${units(p).length} units)`, units(p).map((u) => u.name));
// the skirmish setup: the army column and the "My Army" page
G.menu.skirmish();
await new Promise((r) => setTimeout(r, 300));
const row = document.querySelector('#k_slots tr[data-i="0"]');
ok(row && row.querySelector('select[data-f="preset"]') && row.querySelector('[data-army]'), 'your row: the army preset and the "My Army" button');
G.settings.skirmishSetup.points = 1000; G.settings.skirmishSetup.slots[0].tribe = 'Hu';
G.menu.skirmish();
await new Promise((r) => setTimeout(r, 200));
document.querySelector('#k_slots [data-army]').click();
await new Promise((r) => setTimeout(r, 200));
const page = document.querySelector('.pbpage');
ok(page && page.querySelectorAll('.pyramid .pcard').length === Object.keys(std.cards).length && /of 1000 points/.test(page.querySelector('.pbgauge').textContent), 'My Army: the preset\'s cards, "0 of 1000 points"', page && page.querySelector('.pbgauge').textContent);
ok(page.querySelectorAll('.pblist .pbitem').length > 3 && page.querySelectorAll('.pbarrow').length === 5, 'the shop list and the five arrows');
page.querySelector('[data-a="clear"]').click();
await new Promise((r) => setTimeout(r, 50));
ok(document.querySelectorAll('.pbpage .pyramid .pcard').length === 0 && /1000 of 1000/.test(document.querySelector('.pbgauge').textContent), 'Clear', document.querySelector('.pbgauge').textContent);
const it = [...document.querySelectorAll('.pblist .pbitem')][0];
it.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
await new Promise((r) => setTimeout(r, 50));
ok(document.querySelectorAll('.pbpage .pyramid .pcard').length === 1, 'a double click buys the first unit');
document.querySelector('[data-a="done"]').click();
await new Promise((r) => setTimeout(r, 200));
const sl = G.settings.skirmishSetup.slots[0];
ok(sl.preset === 'custom' && Object.keys(sl.army.cards).length === 1 && sl.armyPoints === 1000, 'Done: the setup keeps your own army', sl.army && sl.army.cards);
// a campaign mission's army screen: mission 4 (Aje: Cole, Stina, Bela fixed; resources locked)
const idx = await (await fetch('campaign/index.json')).json();
const m4 = idx.find((m) => m.id === 4);
let started = null;
await G.menu.campaignArmy(m4, { campaign: 4, difficulty: 1, tribe: '' }, () => {}, (c) => { started = c; });
await new Promise((r) => setTimeout(r, 200));
const cards = document.querySelectorAll('.pbpage .pyramid .pcard.fixed');
ok(cards.length === 3 && !document.querySelector('[data-a="clear"]') && document.querySelector('[data-a="defaults"]'), 'mission 4: the three heroes, fixed; Default, no Clear', cards.length);
ok([...document.querySelectorAll('.pbr b')].every((b) => b.classList.contains('off')), 'its resources are locked (-1 in the level)');
document.querySelector('[data-a="done"]').click();
ok(started && started.army && Object.keys(started.army.cards).length === 3 && started.campaign === 4, 'Done starts the mission with that army');
return out.join('\n');
