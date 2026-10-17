// The map's special places (game/systems/landmarks.js): healing wells (CFountain: the right click sends a unit, it
// drinks what it lacks, the well refills), lakes of healing and of damage (every 3 s, in a region of the map), the
// level's weather program (WeatherMgr: tracks one after the other, looped).
//   python3 tests/evaljs.py tests/landmarks.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/bfpw_highland.ula"         (a well)
//   python3 tests/evaljs.py tests/landmarks.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/earth_water_and_stone.ula" (lakes)
//   python3 tests/evaljs.py tests/landmarks.js "&campaign=8&notriggers"                                                 (snow; wells)
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (sec, dt = 0.25) => G.step(Math.ceil(sec / dt), dt);
const spawnNear = (name, x, z) => {
  for (let r = 0; r < 40; r += 2) for (let a = 0; a < 6.28; a += 0.5) {
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (W.nav.isFree(px, pz)) return W.spawnUnit(name, me, px, pz, 1);
  }
  return null;
};
const warrior = me.tribe === 'Aje' ? 'aje_warrior' : me.tribe === 'Ninigi' ? 'ninigi_warrior' : me.tribe === 'SEAS' ? 'seas_warrior' : 'hu_warrior';
const S = G.mapSource;

// ---- healing wells
if (W.wells.length) {
  const w = W.wells[0], cap = w.well.max;
  check('the map\'s wells are wells (their fill, size, refill time)', w.kind === 'well' && cap > 0 && w.well.fill === Math.min(cap, w.well.fill) && w.well.refill > 0 && w.radius > 0.5, [w.name, w.well]);
  // the right click: the cursor and the order
  const u = spawnNear(warrior, w.pos.x + 25, w.pos.z);
  G.select([u]);
  check('the cursor over a well for a character: healing', G.input.cursorFor(w, null, false) === 'healing', G.input.cursorFor(w, null, false));
  W.setHp(u, 10);
  G.input.orderOn(w, null, false);
  check('a right click on the well sends it there', u.task.type === 'fountain' && u.task.target === w, u.task.type);
  const before = w.well.fill;
  let t = 0;
  while (u.task.type === 'fountain' && t < 60) { run(0.5); t += 0.5; }
  const got = u.hp - 10;
  check('it walks to the well and drinks what it lacks', u.hp === u.maxHp && Math.hypot(u.pos.x - w.pos.x, u.pos.z - w.pos.z) < 30, [Math.round(u.hp), u.maxHp, t]);
  check('the well has that much less', Math.abs(before - w.well.fill - got) < 1.5, [before, Math.round(w.well.fill), Math.round(got)]);
  // the refill: a store's refill_dur-th a second
  const f0 = w.well.fill;
  run(2);
  check('it refills (1 / refill_dur of its store a second)', Math.abs(w.well.fill - Math.min(cap, f0 + 2 * cap / w.well.refill)) < cap / w.well.refill + 1, [Math.round(f0), Math.round(w.well.fill), w.well.refill]);
  // an empty well gives what it has
  w.well.fill = 5; w.well.refillT = null;
  W.setHp(u, u.maxHp - 50);
  W.order([u], { type: 'fountain', target: w });
  t = 0; while (u.task.type === 'fountain' && t < 30) { run(0.5); t += 0.5; }
  check('an almost empty well gives what is left', Math.abs(u.hp - (u.maxHp - 45)) < 1 && w.well.fill < 1, [Math.round(u.hp), u.maxHp, w.well.fill]);
  // selection: the info shows what it holds
  G.select([w]); G.hud.infoKey = null; G.hud.refreshInfo();
  const txt = G.hud.infoBody.textContent;
  check('a selected well shows what it holds', /\d+ \/ \d+/.test(txt), txt.slice(0, 80));
  // a building cannot drink
  const b = W.buildings.find((x) => x.alive && x.owner === me);
  check('a building cannot be sent to a well', !W.canUseWell(b, w), b && b.name);
  G.select([]);
}

// ---- lakes of healing / damage
if (W.lakes.length) {
  const hurt = W.lakes.find((l) => !l.heal), heal = W.lakes.find((l) => l.heal);
  check('the map\'s lakes and their regions', W.lakes.every((l) => !!W.regionOf(l.region)), W.lakes.map((l) => [l.name, l.region, !!W.regionOf(l.region)]));
  const inside = (l) => {
    const r = W.regionOf(l.region), b = r.bounds();
    for (let i = 0; i < 400; i++) { const x = b.x + (Math.random() - 0.5) * b.r * 1.4, z = b.z + (Math.random() - 0.5) * b.r * 1.4; if (r.contains(x, z) && W.nav.isFree(x, z)) return [x, z]; }
    return null;
  };
  for (const l of [hurt, heal].filter(Boolean)) {
    const p = inside(l);
    if (!p) { check(`a walkable place in ${l.name}`, false, l.region); continue; }
    const u = W.spawnUnit(warrior, me, p[0], p[1], 1);
    u.task = { type: 'hold' };
    if (l.heal) W.setHp(u, 50);
    const h0 = u.hp;
    run(3.3);
    if (l.heal) check('a lake of healing heals the units in it every 3 s', u.hp === Math.min(u.maxHp, h0 + l.amount), [h0, u.hp, l.amount]);
    else check('a lake of damage hurts the units in it every 3 s (their protection counts)', u.hp < h0 && u.hp >= h0 - l.amount, [h0, Math.round(u.hp * 10) / 10, l.amount]);
    const h1 = u.hp;
    u.pos.x += 400; u.syncObj(); W.uHash.move(u);
    run(3.3);
    check(`outside the region ${l.heal ? 'healing' : 'damage'} stops`, u.hp === h1, [h1, u.hp]);
    W.kill(u, null);
  }
}

// ---- weather
const prog = S.weather;
if (prog && prog.tracks.some((t) => t.type)) {
  check('the level\'s weather program', !!W.weather && W.weather.tracks.length === prog.tracks.length, prog);
  const now = W.weatherNow();
  check('the first track plays', now && now.type === prog.tracks[0].type && now.intensity === prog.tracks[0].intensity, now);
  run(prog.tracks[0].dur + 1, 1);
  check('after its duration the next one', W.weather.i === 1 % prog.tracks.length, W.weather.i);
  for (let i = 0; i < 30; i++) G.weather.update(W.weatherNow(), G.rtscam.target, 0.1);
  check('it snows (or rains) around the camera', (prog.tracks[0].type === 1 ? G.weather.snow : G.weather.rain).visible, [G.weather.snow.visible, G.weather.rain.visible]);
  const total = prog.tracks.reduce((a, t) => a + t.dur, 0);
  run(total, 1);
  check(prog.loop ? 'a looped program starts again' : 'the program ends', prog.loop ? !W.weather.over : W.weather.over, W.weather);
  W.nextWeatherTrack();
  check('the trigger WTHR (next track)', prog.loop ? W.weather.i >= 0 : W.weather.over, W.weather.i);
}
if (!W.wells.length && !W.lakes.length && !(prog && prog.tracks.some((t) => t.type))) check('the map has wells, lakes or weather', false, S.name);
return out.join('\n');
