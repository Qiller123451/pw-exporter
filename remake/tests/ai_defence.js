// The computer player's defence: proportional response, workers stay out of it, wild animals raise no alarm.
//   python3 tests/evaljs.py tests/ai_defence.js "&tribe=Hu&enemy=Aje&aid=4"
const W = G.world, D = G.data, out = [];
const ok = (c, m) => out.push(`${c ? 'ok' : 'FAIL'} ${m}`);
const info = (m) => out.push('   ' + m);
const B = (G.brains && G.brains.get ? G.brains.get(G.ai.id) : null) || G.aiBrain, p = B.p, foe = G.me;
let err = null;
const upd = B.update.bind(B);
B.update = (dt) => { try { upd(dt); } catch (e) { if (!err) err = e.stack || String(e); } };
const step = (s) => { for (let i = 0; i < s; i += 5) { G.step(Math.min(100, (s - i) * 20), 0.05); if (G.fx) G.fx.update(5); } };
B.setBehaviour('Giraffe');
B.prm.noFight = true;                                   // no attacks of its own during the test
step(45);
let S = B.census(true);
const home = S.home;
const fighter = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_marine' }[p.tribe] || 'hu_warrior';
const raider = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_marine' }[foe.tribe] || 'hu_warrior';
const fcls = D.exists(fighter) ? fighter : D.actions(p).find((a) => a.kind === 'Build' && a.cat !== 'Build/BLDG' && a.results[0] && !D.def(a.results[0].obj, p).can_harvest).results[0].obj;
const gp = B.guardPoint(S);
const mine = [];
for (let i = 0; i < 16; i++) { const u = W.spawnUnit(fcls, p, gp.x + (i % 4) * 2, gp.z + Math.floor(i / 4) * 2); if (u) mine.push(u); }
step(10);
S = B.census(true);
const army = S.fighters.length;
ok(army >= 16, `the village has ${army} fighters`);
// --- three raiders at a building of the village
const tgt = S.blds.find((b) => b.built && b !== S.base) || S.base;
const spawnRaid = (n) => { const l = []; for (let i = 0; i < n; i++) { const u = W.spawnUnit(D.exists(raider) ? raider : fcls, foe, tgt.pos.x + 12 + (i % 4) * 1.5, tgt.pos.z + 10 + Math.floor(i / 4) * 1.5); if (u) { u.stance = 0; l.push(u); } } return l; };
let raid = spawnRaid(3);
step(8);
S = B.census(true);
let g = B.guard ? B.guard.units.size : 0;
ok(!!B.alarm && !B.alarm.animal, 'three raiders in the village raise the alarm');
ok(g >= 3 && g <= 9, `three raiders bring a few defenders, not the army (${g} of ${army})`);
ok(B.defending === true, 'the village counts as defending');
ok(B.requestAttack(S, 'suicide', foe) === null, 'no attack is started while defending');
ok(!B.militiaSet || B.militiaSet.size === 0, 'no worker is ordered to fight');
const wf = S.workers.filter((w) => w.task.type === 'attack').length;
info(`workers fighting on their own (hit by a raider): ${wf}; workers hiding: ${B.hidden ? B.hidden.size : 0}`);
for (const u of raid) if (u.alive) W.kill(u, null);
step(12);
ok(!B.alarm && (!B.guard || B.guard.units.size === 0) && !B.defending, 'the alarm ends with the raiders');
// --- twelve raiders
raid = spawnRaid(12);
step(8);
S = B.census(true);
g = B.guard ? B.guard.units.size : 0;
ok(g >= 9 && B.score(B.guard.units) >= 12 * 1.5, `twelve raiders bring most of the army (${g} of ${S.fighters.length}, level score ${B.score(B.guard.units)})`);
ok(!B.militiaSet || B.militiaSet.size === 0, 'still no worker is ordered to fight');
for (const u of raid) if (u.alive) W.kill(u, null);
step(12);
// --- a peaceful wild animal walks in
S = B.census(true);
const wild = W.units.filter((u) => u.alive && u.wild && !u.naval);
const calm = wild.find((u) => !(u.def.aggressive > 0)), fierce = wild.find((u) => u.def.aggressive > 0);
if (calm) {
  const a = W.spawnUnit(calm.name, null, tgt.pos.x + 10, tgt.pos.z + 10);
  if (a) a.home.set(tgt.pos.x + 10, tgt.pos.z + 10);
  step(10);
  ok(!B.alarm && (!B.guard || B.guard.units.size === 0), `a peaceful ${calm.name} in the village: no alarm`);
  if (a && a.alive) { a.silentDeath = true; W.kill(a, null); }
} else info('no peaceful animal on this map');
if (fierce) {
  const a = W.spawnUnit(fierce.name, null, tgt.pos.x + 9, tgt.pos.z + 9);
  if (a) a.home.set(tgt.pos.x + 9, tgt.pos.z + 9);
  step(10);
  S = B.census(true);
  g = B.guard ? B.guard.units.size : 0;
  const busy = S.fighters.filter((u) => u.task.type === 'attack' && u.task.target === a).length;
  ok(g <= 2, `an aggressive ${fierce.name}: at most two defenders are sent (${g}), no general alarm (defending: ${B.defending})`);
  ok(B.defending !== true, 'a wild animal does not put the village into defence');
  info(`fighters on the animal including the ones that joined on their own: ${busy}`);
  if (a && a.alive) { a.silentDeath = true; W.kill(a, null); }
} else info('no aggressive animal on this map');
step(8);
// --- a village without fighters: the workers near a raider gang up on it
for (const u of B.census(true).fighters) { u.silentDeath = true; W.kill(u, null); }
step(2);
S = B.census(true);
const w0 = S.workers[0];
if (w0 && S.workers.length >= 6) {
  const r = W.spawnUnit(D.exists(raider) ? raider : fcls, foe, w0.pos.x + 6, w0.pos.z + 6);
  r.stance = 2;
  step(6);
  ok(B.militiaSet && B.militiaSet.size >= 1, `without fighters the workers defend the village (${B.militiaSet ? B.militiaSet.size : 0} on one raider)`);
  step(30);
  ok(!r.alive || r.hp < r.maxHp, 'the raider is hurt or dead');
  if (r.alive) W.kill(r, null);
  step(8);
  ok(!B.militiaSet || B.militiaSet.size === 0, 'and they go back to work afterwards');
} else info('too few workers for the militia check');
ok(!err, 'no exception' + (err ? ' - ' + err.split('\n').slice(0, 3).join(' | ') : ''));
return out.join('\n');
