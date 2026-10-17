// The computer player in Defender and Domination games (ai/gametypes.js, docs/spec/ai_gametypes.md).
//   python3 tests/evaljs.py tests/ai_gametypes.js "&players=Hu,Aje&mode=domination&map=maps/Base/Base/Multiplayer/death_valley.ula"
//   python3 tests/evaljs.py tests/ai_gametypes.js "&players=Hu,Aje&mode=defender&hq=1,0&map=maps/Base/Base/Multiplayer/die_zitadelle.ula"   (the AI defends)
//   python3 tests/evaljs.py tests/ai_gametypes.js "&players=Hu,Aje&mode=defender&hq=0,1&map=maps/Base/Base/Multiplayer/die_zitadelle.ula"   (the AI attacks)
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const step = (s, dt = 0.1) => { for (let i = 0; i < s; i += 5) { G.step(Math.min(50, Math.round((s - i) / dt)), dt); if (G.fx) G.fx.update(5); } };
const me = G.me, ai = W.players.find((p) => p.ai), B = G.brains.get(ai.id);
const fighter = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_warrior' };
step(3);
let S = B.census(true);
const army = (n) => { for (let i = 0; i < n; i++) W.spawnUnit(fighter[ai.tribe], ai, S.home.x + (i % 4) * 2 - 4, S.home.z + Math.floor(i / 4) * 2 + 8, 2); S = B.census(true); };
if (W.rules.mode === 'domination') {
  ok(B.gameType === 'KingOfTheHill', 'the brain knows the game type', B.gameType);
  const flags = B.kothFlags(S);
  ok(flags.length >= 1 && flags.every((f, i) => i === 0 || Math.hypot(f.x - S.home.x, f.z - S.home.z) >= Math.hypot(flags[i - 1].x - S.home.x, flags[i - 1].z - S.home.z)), 'the flags, the nearest first', flags.length);
  army(8);
  B.defending = false; B.attacks.length = 0;
  B.strategyThink(S);
  const types = B.attacks.map((a) => a.type);
  ok(types.length >= 1 && types.every((t) => /^KotH /.test(t)) && types[0] === (flags.length === 1 ? 'KotH Pyramid' : 'KotH Violence'), 'neutral flags: a KotH attack on the nearest, nothing else', types);
  ok(B.attacks.every((a) => a.koth && a.pos), 'its attacks go to a flag');
  B.defending = true;
  const n0 = B.attacks.length;
  B.kothThink(S);
  ok(B.attacks.length === n0, 'while the village defends: no KotH attack');
  B.defending = false;
  for (const a of B.attacks.slice()) a.end('test');
  // an enemy flag with an enemy building near it: a siege
  const f = flags[0];
  f.owner = me;
  W.placeBuilding({ Hu: 'hu_small_tower', Aje: 'aje_small_tower', Ninigi: 'ninigi_small_tower', SEAS: 'seas_small_tower' }[me.tribe] || 'hu_small_tower', me, f.x + 15, f.z + 15, 0, true);
  B.kothThink(S);
  ok(B.attacks.some((a) => a.type === 'KotH Siege' && a.pos.x === f.x), 'an enemy flag with a tower near it: KotH Siege', B.attacks.map((a) => a.type));
  // the attack is over: who stands at the flag stays
  const a = B.attacks.find((x) => x.koth);
  if (a) {
    const near = S.pool.slice(0, 2);
    for (const u of near) { u.pos.x = a.pos.x + 3; u.pos.z = a.pos.z + 3; }
    a.add(near);
    a.end('done');
    ok(near.every((u) => u.task.type !== 'attackmove' || Math.hypot(u.task.x - a.pos.x, u.task.z - a.pos.z) < 30), 'units within 30 m of the flag are not sent home');
  }
  // the last 5 minutes of the enemy's domination timer: a pyramid attack on its units at the nearest flag
  for (const x of B.attacks.slice()) x.end('test');
  W.spawnUnit(fighter[me.tribe], me, f.x + 2, f.z, 2);
  W.go.dom = { team: me.team, owner: me, left: 200, paused: false };
  B.timerThink(B.census(true));
  ok(B.attacks.some((x) => x.timer && x.goal === 'pyramid'), 'the enemy\'s timer under 5 minutes: a pyramid attack at the flag');
  const k = B.attacks.length;
  B.timerThink(B.census(true));
  ok(B.attacks.length === k, 'only one at a time');
} else if (B.isDefender) {
  ok(B.gameType === 'Defender' && B.behaviour === 'Schnecke', 'the defender plays Schnecke', [B.gameType, B.behaviour]);
  B.plan = null;
  B.strategyThink(S);
  const plan = B.plan;
  ok(plan && plan.attacks.every((x) => x === 'none'), 'no plan attacks', plan && plan.attacks);
  const crystals = W.buildings.filter((b) => b.alive && b.name === 'defender_object' && b.owner === ai);
  ok(crystals.length >= 1, 'it owns the crystals', crystals.length);
  const g0 = B.crystalGuard(), last = crystals[crystals.length - 1];
  ok(g0 && Math.hypot(g0.x - last.pos.x, g0.z - last.pos.z) < 1, 'its guard point: the last crystal');
  if (crystals.length > 1) {
    crystals[0].hp = crystals[0].maxHp * 0.6;
    const g1 = B.crystalGuard();
    ok(Math.hypot(g1.x - crystals[0].pos.x, g1.z - crystals[0].pos.z) < 1, 'a damaged crystal: the guard goes there');
  }
  B.mapOptions.walls = true;
  ok(!B.wallsActive({ ...S, age: 4 }), 'no walls in a Defender game');
  B.setBehaviour('Dodo');
  ok(B.behaviour === 'Schnecke', 'a new behaviour: still Schnecke');
} else {
  ok(B.gameType === 'Defender' && !B.isDefender, 'the attacker');
  B.plan = null;
  B.strategyThink(S);
  // (DA:1010-1505: Dodo pyramid + siege x 4, Giraffe none + siege x 4 - Hu: suicide in epoch 2 -, Schnecke none, none, siege x 3)
  ok(B.plan && B.plan.attacks.slice(2).every((x) => x === 'siege') && B.plan.attacks.every((x) => /^(none|siege|pyramid|suicide)$/.test(x)), 'its plan: sieges', [B.letter, B.plan && B.plan.attacks]);
  const crystal = W.buildings.find((b) => b.alive && b.name === 'defender_object');
  const t = B.attackTargets({ enemy: me, targets: null, koth: false }, { x: S.home.x, z: S.home.z });
  ok(t === crystal || (t && t.name === 'defender_object'), 'the crystal is the first target', t && t.name);
  const n = (B.extra || []).length;
  B.towerThink(S);
  ok((B.extra || []).length === n, 'no towers');
  // the last 5 minutes of the defender timer: a pyramid attack on the defender's units at the crystal
  army(6);
  W.spawnUnit(fighter[me.tribe], me, crystal.pos.x + 4, crystal.pos.z, 2);
  W.go.def.left = 250;
  B.timerThink(B.census(true));
  ok(B.attacks.some((x) => x.timer), 'the defender timer under 5 minutes: a pyramid attack on the crystal\'s defenders');
}
return out.join('\n');
