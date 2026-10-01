// Rule scenarios run inside the game page (tests/scenarios.py injects this file and calls runScenarios()).
// Each scenario sets something up in a quiet corner of the map, advances the simulation and checks the result.
window.runScenarios = () => {
  const W = G.world, D = G.data, me = G.me, ai = G.ai;
  const out = [];
  const X = -40, Z = 40;           // a free spot near the centre of the map
  const clear = () => {
    for (const u of W.units) if (u.alive && Math.hypot(u.pos.x - X, u.pos.z - Z) < 70) { u.silentDeath = true; W.kill(u, null); }
    for (const b of W.buildings) if (b.alive && Math.hypot(b.pos.x - X, b.pos.z - Z) < 70) { b.silentDeath = true; W.kill(b, null); }
    G.step(4, 0.05);
  };
  const run = (secs) => { for (let i = 0; i < secs * 20; i++) G.step(1, 0.05); };
  const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
  const spawn = (n, p, dx = 0, dz = 0, lv) => W.spawnUnit(n, p, X + dx, Z + dz, lv);
  const give = (p) => { p.res.food = p.res.wood = p.res.stone = 5000; p.caps.food = p.caps.wood = p.caps.stone = 1e5; p.res.skulls = 1000; p.popMax = 52; };
  const has = (name) => { const st = D.stats(name, 1, null); return !!(st && W.template(st.gfx, true)); };
  const spot = (name, p) => { for (let k = 0; k < 400; k++) { const a = k * 2.4, r = 8 + k * 0.15; const x = X + Math.cos(a) * r, z = Z + Math.sin(a) * r; if (W.canPlace(name, x, z, 0, p)) return [x, z]; } return null; };
  const tryIt = (name, fn) => { try { fn(); } catch (e) { out.push('FAIL ' + name + ' threw ' + (e.stack || e).toString().split('\n').slice(0, 3).join(' | ')); } };
  give(me); give(ai);
  // the computer players must not interfere
  G.aiBrain.update = () => {}; if (G.meBrain) G.meBrain.update = () => {};

  // 1. damage formula: hu_warrior (axe 10 dmg) hits an aje_spearman; expected from the tech tree values
  tryIt('damage formula', () => {
    clear();
    if (!has('hu_warrior') || !has('aje_spearman')) { out.push('skip damage formula'); return; }
    const a = spawn('hu_warrior', me, 0, 0), v = spawn('aje_spearman', ai, 3, 0);
    a.stance = 3; v.stance = 3;
    const cs = a.cs(), vcs = v.cs();
    const w = a.weapons.long;
    const bonus = (w.bonus[v.cls] || 0) / 100;
    const pct = Math.max(0, vcs.prot - cs.ap);
    const expect = Math.max(1, Math.ceil(cs.dmg * (1 + bonus) * (1 - Math.min(0.99, pct / 100))));
    const hp0 = v.hp;
    W.takeDmg(a, v, 1, 0);
    check('melee damage = dmg*(1+bonus)*(1-prot%)', Math.abs((hp0 - v.hp) - expect) < 1e-6, { got: hp0 - v.hp, expect, dmg: cs.dmg, prot: vcs.prot });
  });
  // 2. a fight ends with a death and skulls for the killer
  tryIt('fight to the death', () => {
    clear();
    const mk = { Hu: 'hu_warrior', SEAS: 'seas_warrior', Aje: 'aje_spearman', Ninigi: 'ninigi_archer' }[me.tribe];
    const a = spawn(mk, me, 0, 0, 3), v = spawn(ai.tribe.toLowerCase() + '_worker', ai, 6, 0);
    v.stance = 3;
    const s0 = me.res.skulls;
    W.order([a], { type: 'attack', target: v });
    run(40);
    check('victim dies', !v.alive, { hp: v.hp, task: a.task.type });
    check('killer gets skulls', me.res.skulls > s0, { skulls: me.res.skulls - s0, scalps: v.stats.scalps });
  });
  // 3. projectile unit shoots from range
  tryIt('archer', () => {
    clear();
    const ar = { Hu: 'hu_archer', SEAS: 'seas_marksman', Aje: 'aje_archer', Ninigi: 'ninigi_archer' }[me.tribe];
    const a = spawn(ar, me, 0, 0, 2), v = spawn(ai.tribe.toLowerCase() + '_worker', ai, 20, 0);
    v.stance = 3;
    W.order([a], { type: 'attack', target: v });
    run(6);
    check('archer hits from distance', v.hp < v.maxHp && a.distTo(v) > 8, { hp: v.hp, dist: a.distTo(v) });
  });
  // 4. poison
  tryIt('poison', () => {
    clear();
    const v = spawn(me.tribe.toLowerCase() + '_worker', me, 0, 0);
    W.applyPoison(v, 10, 3, null);
    const hp0 = v.hp;
    run(10);
    check('3 poison ticks of 10', Math.round(hp0 - v.hp) === 30, { lost: hp0 - v.hp });
  });
  // 5. economy: a worker brings a full load of wood
  tryIt('gather wood', () => {
    clear();
    const hq = W.buildings.find((b) => b.alive && b.owner === me && b.isDropoff) || W.units.find((u) => u.alive && u.owner === me && u.isDropoff);
    const w = W.spawnUnit(me.tribe.toLowerCase() + '_worker', me, hq.pos.x + hq.radius + 3, hq.pos.z);
    me.caps.wood = 1e5;
    const n = W.nearestResource(w.pos.x, w.pos.z, 'wood', 200);
    me.res.wood = 0;
    const w0 = me.res.wood;
    W.order([w], { type: 'gather', target: n });
    let t = 0; while (me.res.wood === w0 && t < 240) { run(2); t += 2; }
    check('wood delivered', me.res.wood > w0, { got: me.res.wood - w0, secs: t, cap: W.carryCap(w, 'wood') });
    w.silentDeath = true; W.kill(w, null);
  });
  // 6. construction, repair, building filters
  tryIt('build', () => {
    clear();
    const w1 = spawn(me.tribe.toLowerCase() + '_worker', me, -6, 0), w2 = spawn(me.tribe.toLowerCase() + '_worker', me, -6, 3);
    const acts = D.actionsOf(w1.rulesOwner(), w1).filter((a) => a.cat === 'Build/BLDG' && D.check(me, a) === null);
    const a = acts.find((x) => x.time > 0 && x.time < 60 && !D.def(x.results[0].obj, me).wall);
    const sp = spot(a.results[0].obj, me);
    give(me);
    const b = sp ? W.startConstruction(me, a, sp[0], sp[1], 0, [w1, w2]) : 'nospot';
    check('site placed', b && typeof b !== 'string', { action: a.id, why: typeof b === 'string' ? b : '' });
    if (!b || typeof b === 'string') return;
    run(a.time * 1.2 + 20);
    check('built by two workers', b.built, { progress: b.progress, time: a.time });
    b.hp = b.maxHp * 0.5;
    const h0 = b.hp, wood0 = me.res.wood;
    W.order([w1], { type: 'repair', target: b });
    run(20);
    // 20 hp/s per level-1 worker once it arrived; resources are charged
    check('repaired at ~20 hp/s', b.hp - h0 > 20 * 12 && b.hp - h0 <= 20 * 20 + 1, { gained: Math.round(b.hp - h0) });
    check('repair costs resources', !!b.repairDebt, { debt: b.repairDebt });
  });
  // 7. production and an upgrade that changes values
  tryIt('upgrade changes stats', () => {
    const smith = D.actions(me).find((a) => a.id === 'res_weapon_upgrade_2') || D.actions(me).find((a) => a.kind === 'Upgrades' && /weapon_upgrade|damage_upgrade/.test(a.id));
    if (!smith) { out.push('skip upgrade (no weapon upgrade for ' + me.tribe + ')'); return; }
    const users = { res_weapon_upgrade_2: 'hu_warrior' };
    const u = spawn(users[smith.id] || me.tribe.toLowerCase() + '_worker', me, 0, 10, 3);
    const before = JSON.stringify(u.cs());
    W.completeUpgrade({ owner: me, name: 'x', localTT: null }, smith);
    run(1);
    check('upgrade enabled its filter', me.techs.has(smith.id), smith.id);
    if (smith.id === 'res_weapon_upgrade_2') check('axe damage x1.2', Math.abs(u.cs().dmg / JSON.parse(before).dmg - 1.2) < 0.01, { before: JSON.parse(before).dmg, after: u.cs().dmg });

  });
  // 8. all special moves: none of them throws (used by a fresh unit of each class that offers them)
  tryIt('moves', () => {
    clear();
    const bad = [];
    let n = 0;
    for (const [id, M] of Object.entries(W.MOVES)) {
      const a = [...D.actions(me), ...D.actions(ai)].find((x) => x.id === id && x.kind === 'Moves');
      if (!a) continue;
      const cls = a.locs.map((l) => l.at).find((c) => D.exists(c) && D.info(c).type !== 'BLDG' && has(c));
      if (!cls) continue;
      try {
        const u = W.spawnUnit(cls, me, X, Z, 5);
        if (!u) continue;
        const e = spawn(ai.tribe.toLowerCase() + '_worker', ai, 5, 0);
        e.stance = 3;
        u.task = { type: 'attack', target: e }; u.lastTarget = e;
        const t = M.target === 'own' ? spawn(me.tribe.toLowerCase() + '_worker', me, 3, 3) : M.target === 'building' || M.target === 'gate' ? null : M.target === 'animal' ? W.units.find((x) => x.alive && x.wild) : e;
        if (M.auto) M.run(W, u, e); else if (M.self) M.run(W, u, null, null); else if (t) M.run(W, u, t, t.pos); else if (M.target === 'ground') M.run(W, u, null, e.pos.clone());
        run(3);
        n++;
      } catch (err) { bad.push(id + ': ' + (err.message || err)); }
      clear();
    }
    check('special moves run without errors', bad.length === 0, { tested: n, bad });
  });
  // 9. bunker garrison shoots
  tryIt('bunker', () => {
    clear();
    if (!has('hu_bunker')) { out.push('skip bunker (Hu not loaded)'); return; }
    const b = W.placeBuilding('hu_bunker', me, X, Z, 0, true);
    const u = spawn(me.tribe.toLowerCase() + '_worker', me, 8, 0);
    W.order([u], { type: 'board', target: b });
    run(8);
    check('character entered the bunker', u.inside === b, { task: u.task.type });
    const e = spawn(ai.tribe.toLowerCase() + '_worker', ai, 25, 0);
    e.stance = 3;
    run(6);
    check('bunker shoots with a passenger', e.hp < e.maxHp, { hp: e.hp });
    W.unloadAll(b, false);
    check('passenger out again', !u.inside && u.obj.visible);
  });
  // 10. gate: closed blocks, auto lets the owner through
  tryIt('gate', () => {
    clear();
    const gn = { SEAS: 'seas_gate', Hu: 'hu_palisade_gate', Aje: 'aje_bone_palisade_gate', Ninigi: 'ninigi_palisade_gate' }[me.tribe];
    const g = W.placeBuilding(gn, me, X, Z, 0, true);
    const k = [...g.cells][0];
    W.setGate(g, 1);
    check('closed gate blocks everybody', W.nav.gateBlocks(k, me) && W.nav.gateBlocks(k, ai));
    W.setGate(g, 2);
    check('auto gate: owner passes, enemy not', !W.nav.gateBlocks(k, me) && W.nav.gateBlocks(k, ai));
  });
  // 11. trap
  tryIt('trap', () => {
    clear();
    if (!has('ninigi_pitfall')) { out.push('skip trap (Ninigi not loaded)'); return; }
    const t = W.placeBuilding('ninigi_pitfall', ai, X, Z, 0, true);
    const u = spawn('hu_warrior', me, 10, 0);
    check('trap hidden from the enemy', W.hiddenFrom(t, me));
    W.order([u], { type: 'move', x: X, z: Z });
    run(8);
    check('trap hurts the enemy', u.hp < u.maxHp || !u.alive, { hp: u.hp });
  });
  // 12. BuildDown refunds (Aje)
  tryIt('builddown', () => {
    clear();
    const aje = [me, ai].find((p) => p.tribe === 'Aje');
    if (!aje) { out.push('skip builddown (no Aje player)'); return; }
    aje.res.wood = 0; aje.caps.wood = 5000;
    const b = W.placeBuilding('aje_tent', aje, X, Z, 0, true);
    W.startBuildDown(b);
    run(30);
    check('tent dismantled and paid back', !b.alive && aje.res.wood > 0, { wood: aje.res.wood });
  });
  // 13. level up with skulls
  tryIt('level up', () => {
    clear();
    const u = spawn(me.tribe.toLowerCase() + '_worker', me, 0, 0, 1);
    const s0 = me.res.skulls;
    const why = W.levelUp(u);
    check('level up costs 25 skulls', why === null && u.level === 2 && s0 - me.res.skulls === 25, { why, level: u.level, paid: s0 - me.res.skulls });
  });
  // 14. healer
  tryIt('healer', () => {
    clear();
    if (!has('seas_medic')) { out.push('skip healer (SEAS not loaded)'); return; }
    const m = spawn('seas_medic', me, 0, 0, 3);
    const v = spawn('seas_warrior', me, 5, 0);
    v.hp = v.maxHp * 0.3;
    run(10);
    check('medic heals a wounded unit', v.hp > v.maxHp * 0.35, { hp: Math.round(v.hp), max: v.maxHp, medic: m.task.type });
  });

  // 15. automatic move: a warrior with "kick" invented kicks during a fight
  tryIt('auto move', () => {
    clear();
    if (me.tribe !== 'Hu') { out.push('skip kick (not Hu)'); return; }
    me.tt.enable('Hu/Upgrades/hu_arena/kick');
    const a = spawn('hu_warrior', me, 0, 0, 3), v = spawn(ai.tribe.toLowerCase() + '_worker', ai, 3, 0);
    v.stance = 3; v.maxHp = v.hp = 5000;
    W.order([a], { type: 'attack', target: v });
    run(12);
    check('Kick used (cooldown running)', (a.cd.get('Kick') || 0) > W.time, { cd: a.cd.get('Kick'), t: W.time });
  });
  // 16. local upgrade: a big tent houses 10 instead of 5
  tryIt('local upgrade', () => {
    clear();
    const aje = [me, ai].find((p) => p.tribe === 'Aje');
    if (!aje) { out.push('skip big tent (no Aje player)'); return; }
    const b = W.placeBuilding('aje_tent', aje, X, Z, 0, true);
    const b2 = W.placeBuilding('aje_tent', aje, X + 15, Z, 0, true);
    const mu0 = aje.maxUnits;
    const a = D.actions(aje).find((x) => x.id === 'aje_big_tent');
    W.completeUpgrade(b, a);
    run(1);
    check('big tent: +5 population, only this tent', aje.maxUnits - mu0 === 5 && b.stats.limits.max_units === 10 && b2.stats.limits.max_units === 5, { before: mu0, after: aje.maxUnits, gfx: b.gfx });
  });
  // 17. fields produce food
  tryIt('field', () => {
    clear();
    const fields = { Hu: 'hu_corn_field', Ninigi: 'ninigi_paddy', SEAS: 'seas_greenhouse', Aje: 'aje_slaughterhouse' };
    const f = fields[me.tribe];
    if (!has(f)) { out.push('skip field'); return; }
    const hq = W.buildings.find((b) => b.alive && b.owner === me && b.isDropoff && b.def.delivery.includes('food')) || W.units.find((u) => u.alive && u.owner === me && u.isDropoff);
    const sp = (() => { for (let k = 0; k < 300; k++) { const a = k * 2.4, r = 14 + k * 0.2; const x = hq.pos.x + Math.cos(a) * r, z = hq.pos.z + Math.sin(a) * r; if (W.canPlace(f, x, z, 0, me)) return [x, z]; } return null; })();
    const b = W.placeBuilding(f, me, sp[0], sp[1], 0, true);
    const w = W.spawnUnit(me.tribe.toLowerCase() + '_worker', me, sp[0] + 8, sp[1]);
    me.res.food = 0; me.caps.food = 1e5;
    W.order([w], { type: 'gather', target: b });
    run(90);
    check('field harvest delivered', me.res.food > 0, { food: me.res.food, task: w.task.type + '/' + w.task.phase });
  });
  // 18. unique hero
  tryIt('hero', () => {
    clear();
    if (!has('Cole_s0')) { out.push('skip hero'); return; }
    const h1 = spawn('Cole_s0', me, 0, 0), h2 = spawn('Cole_s0', me, 3, 0);
    check('only one Cole per player', !!h1 && !h2);
  });
  // 19. trade cart
  tryIt('trade', () => {
    clear();
    const wh = { Hu: 'hu_warehouse', Aje: 'aje_bazaar', Ninigi: 'ninigi_warehouse' }[me.tribe];
    const cart = { Hu: 'hu_cart', Aje: 'aje_trade_dino', Ninigi: 'ninigi_cart' }[me.tribe];
    if (!wh || !has(wh) || !has(cart)) { out.push('skip trade'); return; }
    const a = W.placeBuilding(wh, me, X - 30, Z, 0, true), b = W.placeBuilding(wh, me, X + 40, Z, 0, true);
    const c = spawn(cart, me, -25, 8);
    me.res.food = 0;
    const f0 = me.res.food;
    W.order([c], { type: 'trade', target: b });
    run(80);
    check('trade cart earns', me.res.food > f0, { got: Math.round(me.res.food - f0), task: c.task.type });
  });
  // 21. Aje catapult dino ammo hatches a velociraptor (CDinoAmmoEgg)
  tryIt('raptor egg', () => {
    clear();
    const P = me.tribe === 'Aje' ? me : ai.tribe === 'Aje' ? ai : null, E = P === me ? ai : me;
    if (!P || !has('aje_ankylosaurus')) { out.push('skip raptor egg (no Aje player)'); return; }
    const k = spawn('aje_ankylosaurus', P, 0, 0, 3);
    for (const a of D.actions(P).filter((a) => a.kind === 'Upgrades' && /catapult/.test(a.id))) W.completeUpgrade(k, a);
    k.refreshRules && k.refreshRules();
    const w = k.weapons && (k.weapons.long || k.weapons.main);
    const e = spawn(E.tribe.toLowerCase() + '_worker', E, 30, 0); e.stance = 0;
    const before = W.units.filter((u) => u.alive && u.name === 'aje_velociraptor').length;
    if (w && (w.projectile || '').toLowerCase() === 'aje_ammo_dino') { W.launch(k, k.pos.clone(), e, w, k.cs(w)); run(6); }
    const r = W.units.filter((u) => u.alive && u.name === 'aje_velociraptor');
    check('egg hatches a raptor for the shooter', r.length > before && r.every((x) => x.owner === P && x.autonomous), { projectile: w && w.projectile, raptors: r.length });
    for (const x of [k, e]) if (x.alive) { x.silentDeath = true; W.kill(x, null); }   // no further eggs
    run(31);
    check('raptor gone after 30 s', !W.units.some((u) => u.alive && u.name === 'aje_velociraptor'));
  });
  // 22. tracker dino: autonomous, dies after 180 s
  tryIt('tracker', () => {
    clear();
    const P = me.tribe === 'Aje' ? me : ai.tribe === 'Aje' ? ai : null;
    if (!P || !has('aje_tracker_dino')) { out.push('skip tracker (no Aje player)'); return; }
    const t = spawn('aje_tracker_dino', P, 0, 0);
    const p0 = t.pos.clone();
    run(10);
    check('tracker scouts on its own', t.autonomous && t.pos.distanceTo(p0) > 5, { moved: +t.pos.distanceTo(p0).toFixed(1), task: t.task.type });
    run(175);
    check('tracker expires after 180 s', !t.alive);
  });
  // 23. spirit + Aje shaman Resurrect
  tryIt('resurrect', () => {
    clear();
    const P = me.tribe === 'Aje' ? me : ai.tribe === 'Aje' ? ai : null;
    if (!P) { out.push('skip resurrect (no Aje player)'); return; }
    const v = spawn('aje_warrior', P, 6, 0, 2);
    const sh = spawn('aje_shaman', P, -6, 0, 2);
    v.silentDeath = false; W.kill(v, null); run(1);
    check('a spirit is left', W.spirits.some((s) => s.name === 'aje_warrior' && s.owner === P));
    const a = W.movesOf(sh).find((x) => x.id === 'Resurrect');
    for (const t of D.actions(P).filter((x) => x.kind === 'Upgrades' && /resurrect/i.test(x.id))) W.completeUpgrade(sh, t);
    const n0 = W.units.filter((u) => u.alive && u.name === 'aje_warrior' && u.owner === P).length;
    P.popMax = 200; P.maxUnits = 200;                // room in the population for the returning unit
    const why = a ? W.useMove(sh, a, null, v.pos.clone()) : 'no move';
    run(12);
    const back = W.units.filter((u) => u.alive && u.name === 'aje_warrior' && u.owner === P);
    check('shaman brings it back at its level', !why && back.length === n0 + 1 && back.some((u) => u.level === 2), { why, n: back.length, n0, lv: back.map((u) => u.level), spirits: W.spirits.length, task: sh.task.type, slot: P.slotFree(2, D.pyramid) });
  });
  // 24. ninja disguise drops on attack, returns 10 s later
  tryIt('disguise', () => {
    clear();
    const P = me.tribe === 'Ninigi' ? me : ai.tribe === 'Ninigi' ? ai : null, E = P === me ? ai : me;
    if (!P || !has('ninigi_ninja')) { out.push('skip disguise (no Ninigi player)'); return; }
    const inv = D.actions(P).find((a) => a.kind === 'Upgrades' && a.id === 'disguise');
    const tmp = W.placeBuilding('ninigi_temple', P, X + 40, Z + 40, 0, true);
    if (inv) W.completeUpgrade(tmp, inv);
    const n = spawn('ninigi_ninja', P, 0, 0, 2);
    check('ninja disguised', n.st.camo.has('disg'));
    const e = spawn(E.tribe.toLowerCase() + '_worker', E, 3, 0); e.stance = 0;
    W.order([n], { type: 'attack', target: e }); run(4);
    check('attacking reveals the ninja', !n.st.camo.has('disg'));
    W.order([n], { type: 'stop' }); if (e.alive) { e.silentDeath = true; W.kill(e, null); }
    run(12);
    check('disguise back after 10 s', n.st.camo.has('disg'));
  });
  // 20. warp gate countdown wins
  tryIt('warpgate', () => {
    clear();
    const wg = { Hu: 'hu_warpgate', Aje: 'aje_warpgate', Ninigi: 'ninigi_warpgate' }[me.tribe];
    if (!wg || !has(wg)) { out.push('skip warpgate'); return; }
    const b = W.placeBuilding(wg, me, X, Z, 0, true);
    check('countdown started', b.warpT > 0, { t: b.warpT });
    b.warpT = 1; run(2);
    check('owner wins', me.won === true && ai.defeated === true);
    me.won = false; ai.defeated = false; G.over = false;
    b.silentDeath = true; W.kill(b, null);
  });
  clear();
  return out.join('\n');
};
