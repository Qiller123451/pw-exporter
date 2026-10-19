// The computer player's pest patrol (ai/attack.js requestPest, ai/gametypes.js disturbance; docs/spec/ai.md 5.4):
// what disturbs the spot decides the attack - hostile animals a "suicide" attack (not when the first one is an
// allosaurus class before epoch 4), else enemies (by personality and epoch) a "blitz", else enemy towers a "blitz" in
// the first two epochs and a "towersiege" later; nothing there: the request is dropped. A worker killed by an animal
// asks for one, and so do enemies at an item the AI wants from epoch 3.
//   python3 tests/evaljs.py tests/ai_pest.js "&tribe=Hu&enemy=Aje&aid=8&map=maps/Base/Multiplayer/multi_2_nor_002.ula"
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const B = (G.brains && G.brains.get ? G.brains.get(G.ai.id) : null) || G.aiBrain, p = B.p, me = G.me;
const step = (s) => { for (let i = 0; i < s; i += 5) { G.step(Math.min(100, (s - i) * 20), 0.05); if (G.fx) G.fx.update(5); } };
for (const u of W.units) if (u.alive && u.wild) W.kill(u, null);
W.wildNests.length = 0;
B.setBehaviour('Giraffe');
step(5);
let S = B.census(true);
const home = S.home;
ok(B.multimap, 'a skirmish map');
// a spot 70 m from the village, on its land
let spot = null;
for (let a = 0; a < 16 && !spot; a++) { const x = home.x + Math.cos(a / 16 * 6.283) * 70, z = home.z + Math.sin(a / 16 * 6.283) * 70; if (W.nav.isFree(x, z) && W.landIsland(x, z) === W.landIsland(home.x, home.z)) spot = { x, z }; }
ok(!!spot, 'a free spot 70 m from the village', spot);
const fighter = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_warrior' }[p.tribe];
for (let i = 0; i < 12; i++) W.spawnUnit(fighter, p, home.x + (i % 4) * 2 - 4, home.z + Math.floor(i / 4) * 2 + 8, 2);
for (const r of ['food', 'wood', 'stone']) p.res[r] = Math.max(p.res[r], 3000);
// the requests the strategy think makes (whether a squad then sets out is the attack's own business)
let req = [];
const ra = B.requestAttack.bind(B);
B.requestAttack = (S2, type, enemy, targets, pos, force) => { req.push({ type, targets, pos }); return ra(S2, type, enemy, targets, pos, force); };
const clear = () => { for (const a of B.attacks.slice()) a.end('test'); B.defending = false; B.scouted = true; req = []; };
const think = () => { S = B.census(true); B.strategyThink(S); return req.map((r) => r.type); };
const asked = (type, e) => req.find((r) => r.type === type && r.targets && r.targets.includes(e));
const wild = (name, n = 1) => [...Array(n)].map((_, i) => W.spawnUnit(name, null, spot.x + i * 3, spot.z + 3));
const hostile = ['Smilodon', 'Velociraptor', 'Allosaurus'].find((s) => W.data.exists(s) && W.data.def(s, null).aggressive > 0);
// 1. hostile animals: a suicide attack on them
clear();
const beasts = wild(hostile, 2);
B.requestPest(spot);
let types = think();
const a1 = asked('suicide', beasts[0]);
ok(!!a1, 'hostile animals at the spot: a "suicide" attack on them', [hostile, types]);
ok(a1 && Math.hypot(a1.pos.x - (beasts[0].pos.x + beasts[1].pos.x) / 2, a1.pos.z - (beasts[0].pos.z + beasts[1].pos.z) / 2) < 1, 'aimed at their centre', a1 && a1.pos);
ok(!!B.pest, 'the request stays (asked for again on the next thinks)');
for (const u of beasts) W.kill(u, null);
// 2. nothing there: the request is dropped
clear();
B.requestPest(spot);
types = think();
ok(!B.pest && !req.some((r) => r.targets && r.pos && Math.hypot(r.pos.x - spot.x, r.pos.z - spot.z) < 40), 'nothing at the spot: the request is dropped', types);
// 3. an allosaurus class first ("_allosaurus") before epoch 4: nothing
const allo = ['special_allosaurus', 'arena_allosaurus', 'aje_allosaurus'].find((s) => W.data.exists(s));
if (allo) {
  clear();
  const al = W.spawnUnit(allo, null, spot.x, spot.z);
  if (al) { al.wild = true; if (!(al.def.aggressive > 0)) al.def = { ...al.def, aggressive: 1 }; }
  B.requestPest(spot);
  types = think();
  ok(S.age <= 3 && !req.some((r) => r.targets && r.targets.includes(al)), `an allosaurus (${allo}) nearest to the village in epoch ${S.age}: no attack`, types);
  if (al) W.kill(al, null);
}
// 4. enemies there: a blitz (Dodo always)
clear();
B.setBehaviour('Dodo'); B.letter = 'D'; B.scouted = true;
const efighter = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_warrior' }[me.tribe];
const foes = [0, 1].map((i) => W.spawnUnit(efighter, me, spot.x + i * 2, spot.z - 2, 1));
B.requestPest(spot);
types = think();
ok(!!asked('blitz', foes[0]), 'enemies at the spot (Dodo): a "blitz"', types);
for (const u of foes) W.kill(u, null);
// 5. an enemy tower there: blitz in the first two epochs, towersiege later (Schnecke before epoch 5: towers only)
clear();
B.setBehaviour('Schnecke'); B.letter = 'S'; B.scouted = true;
const tcls = { Hu: 'hu_small_tower', Aje: 'aje_small_tower', Ninigi: 'ninigi_small_tower', SEAS: 'seas_turret_tower' }[me.tribe];
const tower = W.placeBuilding(tcls, me, spot.x + 6, spot.z + 6, 0, true);
B.requestPest(spot);
types = think();
const want = S.age <= 2 ? 'blitz' : 'towersiege';
ok(!!tower && !!asked(want, tower), `an enemy tower at the spot in epoch ${S.age}: "${want}"`, types);
const ta = B.attacks.find((a) => a.type === want);
ok(!ta || !!B.pest, 'the request stays while that attack runs');
if (ta) { ta.end('done'); ok(!B.pest, 'that attack done: the request is over'); }
// ... and in epoch 3 a "towersiege"
for (const id of ['age_2', 'age_3']) { const a = B.acts(S.base).find((x) => x.id === id); if (a) W.completeUpgrade(S.base, a); }
clear();
B.pest = null;
B.requestPest(spot);
types = think();
ok(S.age === 3 && !!tower && !!asked('towersiege', tower), `the same in epoch ${S.age}: "towersiege"`, types);
if (tower) W.kill(tower, null);
// 6. a worker killed by a wild animal asks for one there
clear();
B.pest = null;
const worker = W.units.find((u) => u.alive && u.owner === p && u.isWorker);
const killer = W.spawnUnit(hostile, null, spot.x, spot.z);
if (worker) { worker.pos.x = spot.x + 4; worker.pos.z = spot.z; W.kill(worker, killer); }
step(1);
ok(!!B.pest && Math.hypot(B.pest.x - spot.x, B.pest.z - spot.z) < 10, 'a worker killed by an animal: a pest patrol where it fell', B.pest);
if (killer) W.kill(killer, null);
// 7. enemies at an item it wants, from epoch 3: a pest patrol there
B.pest = null;
const d = B.itemDanger(spot, 60);
ok(d === null, 'no danger at the spot now');
const foe = W.spawnUnit(efighter, me, spot.x + 5, spot.z + 5, 1);
const d2 = B.itemDanger(spot, 60);
ok(!!d2 && Math.hypot(d2.x - foe.pos.x, d2.z - foe.pos.z) < 0.1, 'an enemy within 60 m of an item: danger, at that enemy', d2);
return out.join('\n');
