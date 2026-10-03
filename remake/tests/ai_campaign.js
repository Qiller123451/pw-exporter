// The interface the campaign engine drives the computer player with (docs/spec/ai.md §13.1):
// behaviours (AIBV), scripted waves (AIFT), defence areas (AIDA), unit locks (AILU), region maps (AIRG), aggro (AIAM).
//   python3 tests/evaljs.py tests/ai_campaign.js "&tribe=Hu&enemy=Aje"            (add &map=... with water for the landing)
const W = G.world, D = G.data, out = [];
const ok = (c, m) => out.push(`${c ? 'ok' : 'FAIL'} ${m}`);
const info = (m) => out.push('   ' + m);
const old = (G.brains && G.brains.get ? G.brains.get(G.ai.id) : null) || G.aiBrain;
const TribeAI = old.constructor, p = G.ai, foe = G.me;
// the player's own brain (if any) sleeps; the opponent gets a campaign-style brain: asleep until a trigger wakes it
const mb = (G.brains && G.brains.get ? G.brains.get(G.me.id) : null) || G.meBrain;
if (mb) mb.setBehaviour('Mikrobe');
const B = new TribeAI(G, p, { difficulty: 4, behaviour: 'Mikrobe', mapOptions: { harbour: false }, multimap: false, levelName: 'Single 02' });
if (G.brains && G.brains.set) G.brains.set(p.id, B);
G.aiBrain = B;
let err = null;
const upd = B.update.bind(B);
B.update = (dt) => { try { upd(dt); } catch (e) { if (!err) err = e.stack || String(e); } };
const step = (s) => { for (let i = 0; i < s; i += 5) { G.step(Math.min(100, (s - i) * 20), 0.05); if (G.fx) G.fx.update(5); } };
const own = (pl) => W.buildings.filter((b) => b.alive && b.owner === pl);
const base = own(p)[0] || W.units.find((u) => u.alive && u.owner === p);
const fbase = own(foe)[0];
const home = { x: base.pos.x, z: base.pos.z };

// --- Mikrobe sleeps
const b0 = own(p).length, u0 = p.units;
step(60);
ok(B.paused && own(p).length === b0 && p.units + p.queuedUnits === u0, 'Mikrobe: the brain sleeps (nothing built, nobody trained)');
ok(W.units.filter((u) => u.alive && u.owner === p && u.isWorker).every((u) => u.task.type === 'idle'), 'Mikrobe: the workers stand still');

// a sleeping player can still be given a wave (campaign bases spawn their attacks while they are Mikrobe)
{
  const before = new Set(W.units);
  const idM = B.startAttack({ type: 'PyramidAttack', targets: own(foe).slice(0, 2) });
  ok(idM === null, 'Mikrobe: a pyramid attack without any fighter is refused');
  const idS = B.startAttack({ type: p.tribe === 'SEAS' ? 'L15_melee_attack_easy' : 'SuicideAttack_1', targets: own(foe).slice(0, 2), spawn: true, ignoreLocations: true, spawnPosition: { x: home.x + 15, z: home.z + 15 } });
  const made = W.units.filter((u) => !before.has(u) && u.owner === p);
  ok(idS != null && made.length > 0 && B.paused, `Mikrobe: a spawned wave works while the brain sleeps (${made.length} units)`);
  step(10);
  ok(made.some((u) => u.task.type === 'attackmove' || u.task.type === 'move' || u.task.type === 'attack'), 'Mikrobe: the wave is on its way');
  for (const a of B.attacks.slice()) a.end('test');
  for (const u of made) if (u.alive) { u.silentDeath = true; W.kill(u, null); }
  p.lost = 0;
}

// --- Turtle builds and defends, but never attacks
ok(B.setBehaviour('Turtle') === true && !B.paused && B.letter === 'S' && B.tactic === 5, 'AIBV Turtle wakes the brain (tactics S5)');
step(300);
let S = B.census(true);
ok(own(p).length > b0 + 2, `Turtle builds its village (${own(p).length} buildings, epoch ${p.epoch()}, ${S.workers.length} workers)`);
ok(S.workers.some((u) => u.task.type === 'gather') || ['food', 'wood', 'stone'].every((r) => p.res[r] >= p.caps[r] - 20), 'Turtle gathers (or its stores are full)');
ok(B.launched.filter((l) => !l.scripted && !l.hunt).length === 0, 'Turtle starts no attack of its own');
const fcls = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_marine' };
const guards = [];
for (let i = 0; i < 8; i++) { const u = W.spawnUnit(fcls[p.tribe], p, home.x + 14 + (i % 4) * 2, home.z + 14 + Math.floor(i / 4) * 2); if (u) guards.push(u); }
const raid = [];
for (let i = 0; i < 2; i++) { const u = W.spawnUnit(fcls[foe.tribe], foe, home.x - 14 - i * 2, home.z - 12); if (u) { u.stance = 0; raid.push(u); } }
step(8);
ok(!!B.alarm && B.guard && B.guard.units.size >= 2, `Turtle defends its village (${B.guard ? B.guard.units.size : 0} defenders on two raiders)`);
for (const u of raid) if (u.alive) W.kill(u, null);
step(10);

// --- AILU: locked units are left alone
const locked = guards.slice(0, 3).filter((u) => u.alive);
for (const u of locked) { W.order([u], { type: 'stop' }); }
B.lockUnits(locked, true);
const lp = locked.map((u) => [u.pos.x, u.pos.z]);
step(20);
S = B.census(true);
ok(locked.every((u) => !S.pool.includes(u) && !S.fighters.includes(u)), 'AILU: locked units are not in the pool');
ok(locked.every((u, i) => Math.hypot(u.pos.x - lp[i][0], u.pos.z - lp[i][1]) < 2 && u.task.type === 'idle'), 'AILU: locked units get no orders');

// --- AIDA: a defence area
const ap = { x: home.x + 40, z: home.z - 30 };
B.setDefenceArea('7', ap, 15, 3);
step(40);
const area = B.areas.get('7');
ok(area && area.units.size === 3, `AIDA: three guards are assigned (${area ? area.units.size : 0})`);
ok(area && [...area.units].every((u) => Math.hypot(u.pos.x - ap.x, u.pos.z - ap.z) < 26), 'AIDA: they stand in the area');
ok(area && [...area.units].every((u) => !locked.includes(u)), 'AIDA: locked units are not used');
const intr = W.spawnUnit(fcls[foe.tribe], foe, ap.x + 6, ap.z + 4);
intr.stance = 0;
step(20);
ok(!intr.alive || intr.hp < intr.maxHp || [...area.units].some((u) => u.task.type === 'attack'), 'AIDA: the guards fight an intruder');
if (intr.alive) W.kill(intr, null);
B.setDefenceArea('7', ap, 15, 0);
ok(!B.areas.has('7') && guards.every((u) => B.claims.get(u) !== area), 'AIDA: max_units 0 removes the area');

// --- AIFT: a spawned wave
const wave = { Hu: 'SuicideAttack_2', Aje: 'SuicideAttack_2', Ninigi: 'SuicideAttack_2', SEAS: 'L15_melee_attack_easy' }[p.tribe];
const targets = own(foe).slice(0, 6);
const before = new Set(W.units);
const pos = { x: fbase.pos.x + (home.x - fbase.pos.x) * 0.12, z: fbase.pos.z + (home.z - fbase.pos.z) * 0.12 };
const id = B.startAttack({ type: wave, targets, position: pos, attackOnTheWay: true, spawn: true, ignoreLocations: true, spawnPosition: { x: home.x + 20, z: home.z + 20 } });
const made = W.units.filter((u) => !before.has(u) && u.owner === p);
ok(id != null && made.length >= 3, `AIFT ${wave}: the wave is spawned (${made.length} units: ${Object.entries(made.reduce((m, u) => { const k = u.name + '@' + u.level; m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, v]) => v + ' ' + k).join(', ')})`);
ok(made.every((u) => B.claims.has(u)) && made.every((u) => !locked.includes(u)), 'AIFT: the wave is one attack; locked units are not in it');
const hp0 = targets.reduce((s, b) => s + b.hp, 0), k0 = p.kills;
let reached = false, fought = false, tsec = 0;
for (; tsec < 420 && !(reached && fought); tsec += 10) {
  step(10);
  if (made.some((u) => u.alive && Math.hypot(u.pos.x - pos.x, u.pos.z - pos.z) < 60)) reached = true;
  if (targets.reduce((s, b) => s + (b.alive ? b.hp : 0), 0) < hp0 || p.kills > k0 || made.some((u) => u.alive && u.task.type === 'attack')) fought = reached;
}
ok(reached, `AIFT: the wave reaches its way point (${tsec} s)`);
ok(fought, 'AIFT: and fights there');
// --- Mikrobe again: the brain sleeps, the wave goes on
B.setBehaviour('Mikrobe');
const b1 = own(p).length;
step(30);
ok(B.paused && own(p).length <= b1, 'AIBV Mikrobe puts the brain back to sleep');
ok(B.attacks.length === 0 || B.attacks.some((a) => a.scripted), 'a running wave is not cancelled by it');
ok(B.launched.filter((l) => !l.scripted && !l.hunt).length === 0, 'the plan itself still attacked nobody');
// --- a wave from the village (no spawn), the pyramid attack, the auto attack
B.setBehaviour('Turtle');
const free = guards.filter((u) => u.alive && !locked.includes(u));
const id2 = B.startAttack({ type: 'PyramidAttack', targets, position: pos });
const a2 = B.attacks.find((a) => a.id === id2);
ok(id2 != null && a2 && a2.units.size >= Math.min(1, free.length) && [...a2.units].every((u) => !locked.includes(u)), `AIFT PyramidAttack takes the pool (${a2 ? a2.units.size : 0} units), not the locked ones`);
if (a2) a2.end('test');
const id3 = B.startAutoAttack({ targets: targets.slice(0, 1) });
ok(free.length ? id3 != null : id3 == null, 'AIFT custom_attack 0: a squad from the pool');
for (const a of B.attacks.slice()) a.end('test');
ok(B.startAttack({ type: 'RessourceOutpost', targets, position: pos }) === null && B.startAttack({ type: wave, targets: [] }) === null, 'outposts and empty target lists are refused');
// --- AILU unlock, AIRG, AICM, AIAM
B.lockUnits(locked, false);
step(15);
S = B.census(true);
ok(locked.filter((u) => u.alive).every((u) => S.fighters.includes(u)), 'AILU unlock: the units are back');
B.setRegionMap('Enemy', { x: fbase.pos.x, z: fbase.pos.z, r: 30 }, -1);
B.setRegionMap('BuildModifier', { x0: home.x - 10, z0: home.z - 10, x1: home.x + 10, z1: home.z + 10 }, -5);
ok(B.regionValue('Enemy', fbase.pos.x + 5, fbase.pos.z) === -1 && B.regionValue('Enemy', fbase.pos.x + 80, fbase.pos.z) === 0 && B.regionValue('BuildModifier', home.x, home.z) === -5, 'AIRG: region values are stored and read');
ok(B.callModule('DFNS', 'HighDefenseMode true') && B.prm.highDefense === true && B.setBehaviour('upgrade_towers 0', 'DFNS') && B.prm.upgrade_towers === 0, 'AICM / module commands');
const some = guards.filter((u) => u.alive).slice(0, 2);
W.setAggro(some, 0);
ok(some.every((u) => u.stance === 0), 'AIAM: setAggro sets the stance');
W.setAggro(some, -1);
const g0 = some[0];
if (g0) {
  const e = W.spawnUnit(fcls[foe.tribe], foe, g0.pos.x + 3, g0.pos.z + 3);
  B.lockUnits(some, true);
  step(6);
  ok(g0.task.type !== 'attack', 'AIAM -1: a passive unit does not fight');
  if (e.alive) W.kill(e, null);
}
// --- landing (only on maps with water)
if (W.waterNav) {
  const before2 = new Set(W.units);
  const id4 = B.startAttack({ type: wave, targets, position: pos, spawn: true, ignoreLocations: true, shipLand: true, spawnPosition: home });
  const a4 = B.attacks.find((a) => a.id === id4);
  const m4 = W.units.filter((u) => !before2.has(u) && u.owner === p);
  ok(id4 != null && a4 && (a4.state === 'sail' || a4.state === 'walk'), `AIFT ship_land: the wave ${a4 && a4.state === 'sail' ? 'boards ' + (a4.ship || []).length + ' transport(s)' : 'walks (no water route)'} (${m4.length} units)`);
  let landed = false;
  for (let t = 0; t < 300 && !landed; t += 10) { step(10); landed = !a4 || a4.state !== 'sail'; }
  ok(landed && m4.filter((u) => u.alive && !u.naval).every((u) => !u.inside), 'AIFT ship_land: the wave lands and the transports are gone');
} else info('no water on this map: the landing is not tested');
ok(!err, 'no exception' + (err ? ' - ' + err.split('\n').slice(0, 3).join(' | ') : ''));
return out.join('\n');
