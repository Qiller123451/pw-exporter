// The debug options of a game (game/cheats.js; ui/debugopts.js). Run with the options in the address:
// python3 tests/evaljs.py tests/debug_options.js '&tribe=Hu&enemy=Aje&spawn=Stegosaurus&cheats={"res":{"food":5000,"skulls":2000},"storage":6000,"pyramid":[null,null,null,null,6],"popMax":150,"noHousing":true,"gather":2,"speed":3,"me":{"startEpoch":3,"maxEpoch":4,"dmg":2,"def":4},"foe":{"startEpoch":2,"dmg":0.5},"ai":"passive"}'
// (URL-encoded in tests/regress.sh). Also ?spawn= and the debug tools' "Put down an object" (game/cheats.js spawnObject).
const W = G.world, me = G.me, ai = G.ai, D = G.data, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
check('the options are on', !!W.cheats && W.cheats.human === me.id, W.cheats);
check('start resources', me.res.food === 5000 && me.res.skulls === 2000, me.res);
check('storage limit', me.caps.food >= 6000 && me.caps.wood >= 6000, me.caps);
check('your start epoch', me.epoch() === 3, me.epoch());
check('the enemy\'s start epoch', ai.epoch() === 2, ai.epoch());
const age = (p, k) => D.actions(p).find((a) => a.kind === 'Upgrades' && a.id === 'age_' + k);
check('epoch V does not exist for you (highest IV)', D.check(me, age(me, 5)) === 'hidden' && D.check(me, age(me, 4)) !== 'hidden', [D.check(me, age(me, 5)), D.check(me, age(me, 4))]);
check('the enemy has no epoch limit', !ai.maxEpoch, ai.maxEpoch);
const pyr = W.pyramidFor(me);
check('pyramid: 6 places on level 5', pyr[4] === 6 && pyr[0] === 25, pyr);
check('unit limit without houses', me.maxUnits === 150 && me.popMax === 150, [me.maxUnits, me.popMax]);
// six units of level 5: room for them, and six cards in the pyramid's top row
const h = G.homeEntity();
const cls = W.units.find((u) => u.alive && u.owner === me && !u.isWorker)?.name || 'hu_warrior';
const top = [];
for (let i = 0; i < 6; i++) { const u = W.spawnUnit(D.exists('hu_berserk') ? 'hu_berserk' : cls, me, h.pos.x + 12 + i * 2, h.pos.z + 12, 5, 0); if (u) top.push(u); }
W.recomputeCaps(me);
check('six level-5 units', top.filter((u) => u.level === 5).length === 6 && me.atLevel[4] >= 6, { n: top.length, lv: top.map((u) => u.level), at: me.atLevel });
G.hud.pyrKey = null; G.hud.refreshPyramid();
const cards = [...G.hud.pyr.querySelectorAll('.pcard')].filter((d) => top.includes(d._u));
// (level 5 has one place in the pyramid: the extra ones go into its tab at the size of level-1 cards first, ui/hud.js slotRects)
check('six cards in the top tab, none beside the pyramid', cards.length === 6 && cards.every((d) => parseFloat(d.style.left) < 180), cards.map((d) => d.style.left + ' ' + d.style.top));
check('a 7th level-5 unit does not fit', me.slotFree(5, pyr) === 'level', me.slotFree(5, pyr));
// damage: yours ×2, the enemy's ×0.5, your defence ×4
const foe = W.spawnUnit(cls.replace(/^hu_/, 'aje_').replace('aje_berserk', 'aje_warrior'), ai, h.pos.x + 40, h.pos.z + 40, 1, 0) || W.units.find((u) => u.alive && u.owner === ai && u.kind === 'unit');
const mine = top[0];
const hp0 = foe.hp; W.damage(foe, 10, mine); const lostFoe = hp0 - foe.hp;
const hp1 = mine.hp; W.damage(mine, 40, foe); const lostMe = hp1 - mine.hp;
check('your damage ×2 to an enemy', lostFoe === 20 || (!foe.alive && hp0 <= 20), { lostFoe, hp0 });
check('enemy damage ×0.5 ÷ your defence 4', lostMe === 5, { lostMe });
const wild = W.units.find((u) => u.alive && !u.owner && u.kind === 'unit');
if (wild) { const w0 = wild.hp; W.damage(wild, 3, mine); check('wild animals are enemies', w0 - wild.hp === 6 || !wild.alive, w0 - wild.hp); }
// economy
const wood0 = me.res.wood; W.gain(me, 'wood', 10);
check('gathering ×2', me.res.wood - wood0 === 20, me.res.wood - wood0);
const ua = G.producerActions(h).find((a) => a.kind === 'Build');
check('training 3× as fast', ua && Math.abs(W.productionTime(ua, me) - W.productionTime(ua, { ...me, cheat: null }) / 3) < 0.01, ua && [W.productionTime(ua, me), ua.time]);
check('the computer trains as fast as usual', ua && Math.abs(W.productionTime(ua, ai) - W.productionTime(ua, { ...ai, cheat: null })) < 0.01);
// passive computer: no attack of its own
const brain = G.brains.get(ai.id);
const req = brain && brain.requestAttack(brain.state || {}, 'suicide', me, null, null, true);
check('a passive computer does not attack you', brain && req === null, typeof req);
// the debug tools of the in-game menu
G.menu.inGame = true; G.menu.main();
check('the menu has the debug tools', !!G.menu.win.querySelector('[data-a="debug"]'));
G.menu.debugTools();
const f0 = me.res.food; G.menu.win.querySelector('[data-a="res"]').click();
check('+1000 resources', me.res.food === f0 + 1000, me.res.food - f0);
G.menu.win.querySelector('[data-a="epoch"]').click();
check('next epoch (IV)', me.epoch() === 4, me.epoch());
G.menu.win.querySelector('[data-a="epoch"]').click();
check('not past the highest epoch', me.epoch() === 4, me.epoch());
// objects put down: ?spawn= at the start, the debug tools at the middle of the screen
const sp = (G.spawned || [])[0];
check('?spawn= put a wild stegosaurus down', sp && sp.name === 'Stegosaurus' && !sp.owner, sp && sp.name);
const n0 = W.units.filter((u) => u.alive && u.name === 'Allosaurus' && !u.owner).length;
G.menu.win.querySelector('#d_cls').value = 'Allosaurus';
G.menu.win.querySelector('#d_side').value = 'wild';
G.menu.win.querySelector('[data-a="spawn"]').click();
check('the debug tools put an allosaurus down', W.units.filter((u) => u.alive && u.name === 'Allosaurus' && !u.owner).length === n0 + 1, G.menu.win.querySelector('#d_did').textContent);
G.menu.win.querySelector('#d_cls').value = 'hu_barracks_doesnotexist';
G.menu.win.querySelector('[data-a="spawn"]').click();
check('an unknown class is refused', /no such object/.test(G.menu.win.querySelector('#d_did').textContent), G.menu.win.querySelector('#d_did').textContent);
G.menu.close();
G.hud.update(0.3);
check('the HUD says debug options', /Debug options/.test(G.hud.epochEl.textContent), G.hud.epochEl.textContent);
return out.join('\n');
