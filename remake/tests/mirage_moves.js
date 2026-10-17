// MIRAGE's special moves (game/systems/moves_mirage.js), played with MIRAGE's data (server on :8412):
//   PWR_PORT=8412 python3 tests/evaljs.py tests/mirage_moves.js "&tribe=SEAS&enemy=Hu"   (each tribe once: regress.sh)
// Each case sets the move's units up in a quiet corner, uses the move and checks what it did. The player's own
// tribe's moves and the heroes' are tested; FOE is a fighter of the computer player's tribe.
const W = G.world, D = G.data, me = G.me, ai = G.ai;
const out = [];
const X = -40, Z = 40;
const clear = () => {
  for (const u of W.units) if (u.alive && Math.hypot(u.pos.x - X, u.pos.z - Z) < 90) W.removeEntity(u);
  for (const b of W.buildings) if (b.alive && Math.hypot(b.pos.x - X, b.pos.z - Z) < 90) W.removeEntity(b);
  W.spirits.length = 0;
};
const run = (secs) => { for (let i = 0; i < secs * 20; i++) G.step(1, 0.05); };
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const FOE = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_warrior' }[ai.tribe];
const OWN = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_warrior' }[me.tribe];
const has = (n) => { const st = D.stats(n, 1, null); return !!(st && (W.template(st.gfx, true) || W.template(D.classGfx(n) || '', true))); };
const spawn = (n, p, dx = 0, dz = 0, lv) => W.spawnUnit(n, p, X + dx, Z + dz, lv);
const act = (u, id) => D.actions(u.rulesOwner()).find((a) => a.id === id && a.kind === 'Moves') || { id, kind: 'Moves', time: 30, locs: [] };
const use = (u, id, t, pos) => W.MOVES[id].self ? W.MOVES[id].run(W, u, null, null) : (u.task = { type: 'special', move: W.MOVES[id], action: act(u, id), target: t || null, pos: pos || null }, true);
const tribeOf = (n) => (D.info(n) || {}).tribe;
const tryIt = (name, need, fn) => {
  const other = need.find((n) => n !== FOE && n !== OWN && ['Hu', 'Aje', 'Ninigi', 'SEAS'].includes(tribeOf(n)) && tribeOf(n) !== me.tribe);
  if (other) return;                       // another tribe's move: tested on its own page
  if (!need.every(has)) { out.push('skip ' + name + ' (no model: ' + need.filter((n) => !has(n)).join(', ') + ')'); return; }
  try { clear(); fn(); } catch (e) { out.push('FAIL ' + name + ' threw ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); }
};
for (const p of [me, ai]) { p.res.food = p.res.wood = p.res.stone = 5000; p.caps.food = p.caps.wood = p.caps.stone = 1e5; p.res.skulls = 1000; p.popMax = 60; }
G.aiBrain.update = () => {}; if (G.meBrain) G.meBrain.update = () => {};
W.declareWar && W.declareWar(me, ai);

// every move of MIRAGE's tech tree is implemented or left out on purpose
const LEFT_OUT = new Set(['Jumpjet_0', 'sand_trap_bfpw', 'bfpw_kick', 'bfpw_quake', 'bfpw_roar', 'FeignDeath', 'tree_camouflage', 'Hu_Multi_Arrow', 'RamAttack']);
const GENERIC = /^(AggressiveTarget|Formation_\d|Kill|Open|Close|Auto|buy_\w+|BuildDown|Burn|set_destination|AggroState_\d|Walk|Attack|Stop|Hold)$/;
const missing = [...new Set(D.actions(me).filter((a) => a.kind === 'Moves' && !W.MOVES[a.id] && !LEFT_OUT.has(a.id) && !GENERIC.test(a.id)).map((a) => a.id))];
check('every move is implemented', missing.length === 0 || missing.every((id) => /set_destination/.test(id)), missing);

tryIt('plunder steals the target building\'s limits', ['Miyagi_s0'], () => {
  const m = spawn('Miyagi_s0', me, 0, 0, 3);
  const hq = { Hu: 'hu_fireplace', Aje: 'aje_resource_collector', Ninigi: 'ninigi_fireplace', SEAS: 'seas_headquarters' }[ai.tribe];
  const b = ai.tribe === 'Aje' ? spawn(hq, ai, 20, 0) : W.placeBuilding(hq, ai, X + 20, Z, 0, true);
  me.res.food = me.res.wood = me.res.stone = 0;          // (room in the storage: what doesn't fit isn't taken)
  ai.res.food = ai.res.wood = ai.res.stone = 400;
  const f0 = me.res.food, af0 = ai.res.food;
  use(m, 'plunder', b); run(15);
  check('plunder: resources moved', me.res.food > f0 && ai.res.food < af0, { got: me.res.food - f0, lost: af0 - ai.res.food });
});
tryIt('call_twins', ['Larry_s0'], () => {
  const l = spawn('Larry_s0', me, 0, 0, 3);
  const n0 = W.units.filter((u) => u.alive && /^(Barry|Harry)_s0$/.test(u.name)).length;
  const pop0 = me.units;
  use(l, 'call_twins'); run(1);
  const tw = W.units.filter((u) => u.alive && /^(Barry|Harry)_s0$/.test(u.name));
  check('twins come', tw.length - n0 === 2, tw.map((u) => u.name));
  check('twins are not in the unit count', me.units === pop0, { before: pop0, after: me.units });
  run(61);
  check('twins leave after 60 s', W.units.filter((u) => u.alive && /^(Barry|Harry)_s0$/.test(u.name)).length === n0);
});
tryIt('MickDundee hypnotises an animal', ['Stina_s0'], () => {
  const an = { Hu: 'hu_rhino', Aje: 'aje_stegosaurus', Ninigi: 'ninigi_saltasaurus', SEAS: 'seas_triceratops' }[ai.tribe];
  if (!has(an)) { out.push('skip MickDundee (no ' + an + ')'); return; }
  const s = spawn('Stina_s0', me, 0, 0, 3), a = spawn(an, ai, 8, 0);
  a.stance = 3;
  use(s, 'MickDundee', a); run(5);
  check('animal trapped', (a.st.t.trapped || 0) > W.time + 10, { trapped: a.st.t.trapped - W.time });
});
tryIt('reanimation', ['Tarna_s0', FOE], () => {
  const t = spawn('Tarna_s0', me, 0, 0, 3), v = spawn(FOE, ai, 10, 0);
  W.kill(v, null);
  const s = W.spirits.find((x) => x.name === FOE);
  check('a spirit is left', !!s);
  if (!s) return;
  const why = W.useMove(t, act(t, 'reanimation'), null, s.pos.clone());
  run(3);
  check('Tarna prays', t.task.type === 'cast', { why, task: t.task.type });
  run(27);
  const r = W.units.find((u) => u.alive && u.name === FOE && u.owner === me);
  check('the enemy\'s warrior comes back as hers', !!r && !s.alive, { task: t.task.type });
  check('cooldown after the revival', t.cd.get('reanimation') > W.time);
});
tryIt('schliemann_sacrifice', ['schliemann_s0', OWN], () => {
  const h = spawn('schliemann_s0', me, 0, 0, 3), v = spawn(OWN, me, 3, 0, 3);
  h.hp = 100;
  use(h, 'schliemann_sacrifice', v); run(4);
  check('victim dies, Schliemann heals and is boosted', !v.alive && h.hp > 100 && h.localTT && h.localTT.has('Special/Upgrades/schliemann_s0/Sacrifice_Bonus'), { hp: h.hp });
});
tryIt('Babbage mechanization -> exo suit -> back', ['babbage_s0'], () => {
  const b = spawn('babbage_s0', me, 0, 0, 4);
  W.mechanize(b); run(13);
  const s = W.units.find((u) => u.alive && u.name === 'special_mobile_suit' && u.owner === me);
  check('the suit comes down', !!s && !b.alive, { babbage: b.alive });
  if (!s) return;
  run(11);
  check('the suit has landed', !s.lift && (s.liftH || 0) === 0);
  const e = spawn(FOE, ai, 15, 0); e.stance = 3;
  const hp0 = e.hp;
  use(s, 'Babbage_ExoMinigun_0', e); run(8);
  check('exo minigun hurts', e.hp < hp0 || !e.alive, { hp: e.hp, hp0 });
  W.kill(s, null); run(4);
  const b2 = W.units.find((u) => u.alive && u.name === 'babbage_s0' && u.owner === me);
  check('Babbage climbs out with half his hit points', !!b2 && Math.abs(b2.hp - b2.maxHp / 2) < 1, b2 && { hp: b2.hp, max: b2.maxHp });
});
tryIt('jetpack flight', ['hu_jetpack_warrior', FOE], () => {
  const j = spawn('hu_jetpack_warrior', me, 0, 0, 3), m = spawn(FOE, ai, 3, 0);
  use(j, 'jetfly_on'); run(4);
  check('flies 13 m up', j.flying && Math.abs(j.liftH - 13) < 0.1, { lift: j.liftH });
  check('melee can\'t reach it', !W.canTarget(m, j));
  W.order([j], { type: 'move', x: X + 40, z: Z }); run(25);
  check('flies straight to the point', Math.hypot(j.pos.x - X - 40, j.pos.z - Z) < 3, { x: j.pos.x - X, z: j.pos.z - Z });
  use(j, 'jetfly_off'); run(4);
  check('lands', !j.flying && (j.liftH || 0) < 0.1);
});
tryIt('meteor', ['hu_druid', FOE], () => {
  const d = spawn('hu_druid', me, 0, 0, 3), v = spawn(FOE, ai, 40, 0), own = spawn('hu_warrior', me, 42, 0);
  v.stance = own.stance = 3;
  const a = v.hp, b = own.hp;
  use(d, 'meteor', null, v.pos.clone()); run(14);
  check('everyone near the impact is hit', v.hp < a && own.hp < b, { enemy: a - v.hp, own: b - own.hp });
});
tryIt('blinding storm', ['aje_shaman', FOE], () => {
  const s = spawn('aje_shaman', me, 0, 0, 3), v = spawn(FOE, ai, 15, 0);
  v.stance = 3;
  use(s, 'blinding_storm', null, v.pos.clone()); run(4);
  check('a unit in the cloud is stormed', W.activeState(v, 'storm'));
  const hp0 = v.hp;
  W.takeDirectDmg(v, 100, 0, me, true);
  check('no direct damage in the storm', v.hp === hp0);
  run(14);
  check('the storm ends', !W.activeState(v, 'storm'));
});
tryIt('Brachio stampede', ['aje_brachiosaurus', FOE], () => {
  const b = spawn('aje_brachiosaurus', me, 0, 0, 3), v = spawn(FOE, ai, 30, 0);
  D.invented = ((f) => (o, n, ...r) => n === 'brachiostampede' || f.call(D, o, n, ...r))(D.invented);
  W.order([b], { type: 'attack', target: v }); run(3);
  check('the brachiosaurus charges', b.rageT > 0 || b.cd.get('BrachioStampede') > W.time, { rage: b.rageT });
});
tryIt('frightening', ['ninigi_triceratops', FOE], () => {
  const t = spawn('ninigi_triceratops', me, 0, 0, 3), v = spawn(FOE, ai, 10, 0);
  t.stance = v.stance = 3;
  const d0 = W.attackDuration(v, v.cs());
  use(t, 'frightening'); run(1);
  const d1 = W.attackDuration(v, v.cs());
  check('enemies attack x1.5 slower', Math.abs(d1 / d0 - 1.5) < 0.01, { d0, d1 });
  run(16);
  check('for 15 s', Math.abs(W.attackDuration(v, v.cs()) - d0) < 1e-6);
});
tryIt('song of valor', ['ninigi_parasaurolophus_drums', 'ninigi_archer'], () => {
  const t = spawn('ninigi_parasaurolophus_drums', me, 0, 0, 3), v = spawn('ninigi_archer', me, 8, 0);
  const d0 = W.attackDuration(v, v.cs());
  use(t, 'song_of_valor'); run(1);
  check('friends attack x0.9', Math.abs(W.attackDuration(v, v.cs()) / d0 - 0.9) < 0.01);
});
tryIt('ceasefire', ['ninigi_monk', 'ninigi_archer', FOE], () => {
  const m = spawn('ninigi_monk', me, 0, 0, 3), f = spawn('ninigi_archer', me, 6, 0), e = spawn(FOE, ai, 20, 0);
  use(m, 'ceasefire', f); run(5);
  check('the friend is under the peace gong', W.activeState(f, 'peace'));
  check('enemies can\'t target it', !W.canTarget(e, f));
  const hp0 = f.hp; W.takeDmg(e, f, 1, 0); run(1);
  check('it takes no damage', f.hp === hp0);
});
tryIt('deplenish', ['ninigi_monk'], () => {
  const tc = { Hu: 'hu_rhino_transporter', Aje: 'aje_stegosaurus', Ninigi: 'ninigi_saltasaurus_archer', SEAS: 'seas_triceratops_transporter' }[ai.tribe];
  if (!has(tc)) { out.push('skip deplenish (no ' + tc + ')'); return; }
  const m = spawn('ninigi_monk', me, 0, 0, 3), t = spawn(tc, ai, 15, 0), p = spawn(FOE, ai, 17, 0);
  W.enterTransport(p, t);
  use(m, 'deplenish'); run(1);
  check('passengers out', !p.inside && (t.passengers || []).length === 0);
  check('no boarding for 15 s', !W.canBoard(p, t));
});
tryIt('cyborg roar', ['seas_rex', 'seas_warrior'], () => {
  const r = spawn('seas_rex', me, 0, 0, 3), w = spawn('seas_warrior', me, 8, 0);
  use(r, 'cyborg_roar'); run(2);
  check('friends deal x1.5', W.activeState(w, 'cyborg') && W.activeState(r, 'cyborg'));
});
tryIt('triceratops tusk', ['seas_triceratops', FOE], () => {
  const t = spawn('seas_triceratops', me, 0, 0, 3), v = spawn(FOE, ai, 4, 0, 3);
  v.stance = 3;
  t.task = { type: 'attack', target: v, user: true }; t.heading = Math.atan2(-(v.pos.x - t.pos.x), -(v.pos.z - t.pos.z));
  const hp0 = v.hp;
  const ok = W.MOVES.triceratops_tusk.run(W, t);
  run(1);
  check('x3 damage ignoring armour', ok && hp0 - v.hp >= 3 * t.cs().dmg * 0.95, { dmg: hp0 - v.hp, weapon: t.cs().dmg });
});
tryIt('stimpack', ['seas_gunner'], () => {
  const g = spawn('seas_gunner', me, 0, 0, 3);
  const d0 = W.attackDuration(g, g.cs()), hp0 = g.hp;
  const why = use(g, 'stimpack');
  check('-40 hp, x0.75 attack time', why && g.hp === hp0 - 40 && Math.abs(W.attackDuration(g, g.cs()) / d0 - 0.75) < 0.01, { hp: hp0 - g.hp });
  check('not twice at once', !W.MOVES.stimpack.run(W, g));
});
tryIt('contamination', ['seas_medic', FOE], () => {
  const m = spawn('seas_medic', me, 0, 0, 3), v = spawn(FOE, ai, 6, 0);
  v.stance = 3;
  use(m, 'contamination', v); run(3);
  check('no healing', W.activeState(v, 'noHeal'));
});
tryIt('deafening', ['seas_medic', FOE], () => {
  const m = spawn('seas_medic', me, 0, 0, 3), v = spawn(FOE, ai, 6, 0);
  use(m, 'deafening');
  W.order([v], { type: 'move', x: X + 30, z: Z });
  check('deaf units take no orders', v.task.type !== 'move');
});
tryIt('parasite', ['seas_medic', FOE], () => {
  const m = spawn('seas_medic', me, 0, 0, 3), v = spawn(FOE, ai, 20, 0);
  v.stance = 3;
  use(m, 'parasite', v); run(3);
  check('her player sees with the host', W.watchers.some((w) => w.host === v && w.player === me && w.until > W.time + 400));
});
tryIt('walking bomb', ['seas_medic', 'seas_warrior', FOE], () => {
  const m = spawn('seas_medic', me, 0, 0, 3), b = spawn('seas_warrior', me, 2, 0), v = spawn(FOE, ai, 15, 0);
  v.stance = 3; b.stance = 3;
  const hp0 = v.hp;
  use(m, 'suicide', b); run(13);
  check('the bomb explodes', !b.alive && v.hp < hp0, { hit: hp0 - v.hp });
});
tryIt('exo suit bash and kick', ['seas_mobile_suit', FOE], () => {
  const s = spawn('seas_mobile_suit', me, 0, 0, 3);
  const vs = [0, 1, 2].map((i) => spawn(FOE, ai, 2 + i, 1.5));
  W.order([s], { type: 'attack', target: vs[0] }); run(4);
  check('the suit uses an automatic move', s.cd.get('bash_exo') > W.time || s.cd.get('kick_down') > W.time, [s.cd.get('bash_exo'), s.cd.get('kick_down')]);
});
tryIt('exocutor hand', ['seas_lumberjack', FOE], () => {
  const l = spawn('seas_lumberjack', me, 0, 0, 3), v = spawn(FOE, ai, 4, 0);
  const p0 = v.pos.clone();
  use(l, 'exocutor_hand'); run(2);
  check('throws small enemies', v.pos.distanceTo(p0) > 1.5, { moved: v.pos.distanceTo(p0) });
});
tryIt('explosive rounds', ['seas_lumberjack_minigun', FOE], () => {
  const l = spawn('seas_lumberjack_minigun', me, 0, 0, 3), v = spawn(FOE, ai, 6, 0);
  v.stance = 3; l.stance = 3;
  const hp0 = l.hp, vh = v.hp;
  use(l, 'explosives_rounds'); run(3.2);
  check('burns itself and the enemies around', l.hp < hp0 && v.hp < vh, { self: hp0 - l.hp, enemy: vh - v.hp });
  use(l, 'explosives_rounds');
  check('switched off: cooldown', !l.rounds && l.cd.get('explosives_rounds') > W.time + 50);
});
tryIt('mount that unit', ['seas_triceratops_transporter', 'seas_warrior'], () => {
  const t = spawn('seas_triceratops_transporter', me, 0, 0, 3), w = spawn('seas_warrior', me, 6, 0);
  use(t, 'MountThatUnit', w); run(6);
  check('the unit gets on the animal', w.inside === t || (t.passengers || []).includes(w), { task: w.task.type });
});
tryIt('wild boar rage (MIRAGE: <= 3/7 hit points)', ['hu_wild_boar'], () => {
  const b = spawn('hu_wild_boar', me, 0, 0, 3);
  D.invented = ((f) => (o, n, ...r) => n === 'wild_boar_rage' || f.call(D, o, n, ...r))(D.invented);
  b.hp = b.maxHp * 0.4; run(1.5);
  check('the rage filter is on', !!(b.localTT && b.localTT.has('Hu/Upgrades/xenage/wild_boar_rage')));
});
return me.tribe + ' vs ' + ai.tribe + '\n' + out.join('\n');
