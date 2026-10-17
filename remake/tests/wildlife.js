// Wild animals as Animal.usl / Nest.usl run them (systems/animals.js): the nests' areas from the map's regions, a
// newborn grows up (hit points, size), hungry animals feed, a peaceful animal flees when hit, a death scares the
// peaceful ones around, a hunter attacks a player's unit in its nest's area and threatens one near it.
//   python3 tests/evaljs.py tests/wildlife.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/the%20river.ula"
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (sec, dt = 0.25) => G.step(Math.ceil(sec / dt), dt);
const S = G.mapSource;
check('the map\'s regions are read: the nests\' areas', S.regions.length > 0 && W.wildNests.some((n) => S.regions.some((r) => r.name === n.name + '_ActionArea')) && W.wildNests.every((n) => !n.action.empty && !n.safe.empty), [S.regions.length, W.wildNests.length]);
// a newborn: a nest whose members all died spawns a baby after spawn_rate
const n = W.wildNests.find((x) => W.data.def(x.species, null).growup > 0 && x.amount !== 0);
for (const u of [...n.members]) { u.invulnT = 0; W.kill(u, null); }
run(n.rate + 2);
const baby = n.members[0];
check('a nest spawns a newborn', !!baby && W.isBaby(baby), baby && { name: baby.name, born: baby.born, growup: baby.growup });
if (baby) {
  const full = baby.stats.hp;
  check('a newborn has a share of the hit points (at least 20 %)', Math.abs(baby.maxHp - full * 0.2) < 1, [baby.maxHp, full]);
  check('and is smaller', baby.obj.scale.x < 0.9, baby.obj.scale.x);
  check('it stays in the safe area', W.positionOk(baby, n.x, n.z) && !W.positionOk(baby, n.x + 40, n.z), null);
  run(baby.growup / 2);
  check('half grown: half the hit points', Math.abs(baby.maxHp / full - 0.5) < 0.1, baby.maxHp / full);
  run(baby.growup / 2 + 5);
  check('grown up', !W.isBaby(baby) && baby.maxHp === full && Math.abs(baby.obj.scale.x - 1) < 1e-6, [baby.maxHp, full, baby.obj.scale.x]);
}
// hunger: an animal long without a meal feeds (vegetarians on trees or where they stand)
// (by day: in their sleeping time four of ten idle ticks put them to sleep first - and the sleep check comes before the
// hunger one, so at night an animal never starts to feed; a day lasts 150 s here, the clock is kept at noon)
const noon = () => { W.dayStart = (12 * 3600 - W.time * 144) % 86400; };
const veg = W.units.find((u) => u.alive && u.wild && W.vegetarian(u) && u.def.repletion > 0 && u.task.type === 'roam');
if (veg) {
  veg.fedT = -1e6; veg.task = { type: 'roam' };
  let fed = false;
  for (let i = 0; i < 600 && !fed; i++) { noon(); run(0.5); if (veg.task.phase === 'feed') fed = true; }
  check('a hungry animal feeds', fed, veg.name);
}
// a peaceful animal flees when it is hit
const h = G.homeEntity();
const peace = W.spawnUnit(['Parasaurolophus', 'Psittacosaurus', 'Gallimimus'].find((s) => W.data.exists(s) && W.data.def(s, null).aggressive < 0), null, h.pos.x + 60, h.pos.z + 60);
const w = W.spawnUnit('hu_warrior', me, h.pos.x + 63, h.pos.z + 60, 1);
if (peace) {
  W.takeDmg(w, peace, 1);
  run(0.5);
  check('a peaceful animal flees when hit', peace.task.type === 'flee', peace.task.type);
  run(20);
  check('it ran away', Math.hypot(peace.pos.x - w.pos.x, peace.pos.z - w.pos.z) > 15, Math.round(Math.hypot(peace.pos.x - w.pos.x, peace.pos.z - w.pos.z)));
  check('and is tired', peace.fatigue > 0, peace.fatigue);
}
// the scare of a death: the peaceful animals within 60 m run off
const p2 = W.spawnUnit(peace ? peace.name : 'Parasaurolophus', null, h.pos.x + 90, h.pos.z + 90);
const victim = W.spawnUnit('Iguanodon', null, h.pos.x + 100, h.pos.z + 90);
if (p2 && victim) {
  p2.task = { type: 'roam' };
  victim.invulnT = 0; W.kill(victim, null);
  run(0.3);
  check('a death scares the peaceful animals near it', p2.task.type === 'roam' && p2.task.phase === 'walk' && p2.task.run, p2.task);
  const to = p2.task.to;
  check('away from the place, out to twice the scare radius', to && Math.hypot(to[0] - victim.pos.x, to[1] - victim.pos.z) > 100, to && Math.round(Math.hypot(to[0] - victim.pos.x, to[1] - victim.pos.z)));
}
// a hunter of a nest attacks a player's unit inside the nest's action area, not one outside it
const hn = W.wildNests.find((x) => W.data.def(x.species, null).aggressive === 1 && x.members.some((u) => u.alive && !W.isBaby(u)));
if (hn) {
  const hunter = hn.members.find((u) => u.alive && !W.isBaby(u));
  for (const o of hn.members) if (o !== hunter) { o.invulnT = 0; W.kill(o, null); }
  hunter.task = { type: 'roam' }; hunter.pos.set(hn.x, hunter.pos.y, hn.z);
  const far = W.spawnUnit('hu_warrior', me, hn.x + 45, hn.z, 1);
  run(4);
  check('a hunter leaves a unit outside its nest\'s area alone', hunter.task.type === 'roam' && hunter.task.target !== far, hunter.task.type);
  const near = W.spawnUnit('hu_warrior', me, hn.x + 8, hn.z, 1);
  run(4);
  check('it attacks one inside', hunter.task.type === 'attack' && hunter.task.target === near, hunter.task.type);
}
// a hunter with an enemy near but out of its reach threatens it ("menace"); a unit with an enemy in its alarm range
// that it does not take on (hold ground) threatens it too (jans_anim_0 .. 2)
{
  const a = W.units.find((u) => u.alive && u.wild && u.def.aggressive === 1 && !u.wildNest && u.anim.has('menace')) || W.spawnUnit('Allosaurus', null, h.pos.x - 80, h.pos.z - 80);
  a.task = { type: 'roam' }; a.wildNest = null;
  const t = W.spawnUnit('hu_warrior', me, a.pos.x + Math.max(31, W.alarmRange(a) - 1), a.pos.z, 1);
  a.scanT = 0; a.alarmT = 0;
  W.preCheckEnemies(a, 0.01);
  check('a hunter threatens an enemy in its alarm range', a.task.phase === 'threat' || a.task.type === 'attack', [a.task.type, a.task.phase, W.alarmRange(a)]);
  const g = W.spawnUnit('hu_warrior', me, h.pos.x + 12, h.pos.z, 1);
  const foe = W.spawnUnit('aje_warrior', W.players.find((p) => p !== me && !me.isFriend(p)), g.pos.x + 31, g.pos.z, 1);
  foe.pos.x = g.pos.x + 31; foe.pos.z = g.pos.z; foe.task = { type: 'hold' }; W.uHash.move(foe);
  g.task = { type: 'hold' }; g.stance = 0; g.scanT = 1e-6; g.alarmT = 0;
  W.idleUpdate(g, 0.01);
  check('a unit holding ground threatens an enemy it does not take on', /^jans_anim_/.test(g.anim.curName || ''), g.anim.curName);
  foe.invulnT = 0; W.kill(foe, null);
}
// after a fight with no enemy left a warrior sometimes cheers (victory_0 .. 2: one time in four)
{
  let cheered = 0;
  for (let i = 0; i < 40; i++) {
    const v = W.spawnUnit('hu_warrior', me, h.pos.x - 60 - i * 3, h.pos.z - 60, 1);
    const prey = W.spawnUnit('aje_warrior', W.players.find((p) => p !== me && !me.isFriend(p)), v.pos.x + 1, v.pos.z, 1);
    v.task = { type: 'attack', target: prey }; prey.invulnT = 0; W.kill(prey, null);
    W.endAttack(v);
    W.time += 1; W.idleUpdate(v, 0.01); W.time -= 1;
    if (/^victory_/.test(v.anim.curName || '')) cheered++;
    v.invulnT = 0; W.kill(v, null);
  }
  check('after a won fight one in four cheers', cheered > 3 && cheered < 20, cheered);
}
return out.join('\n');
