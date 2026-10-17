// Day and night (World.dayTime / isNight: the original's CTimeMgr - 144 virtual seconds a second, a day of 86400 = 10
// minutes, night from 18:00 to 6:00, the level's start time) and the buildings' lights (parts.js todOf /
// applyNight: night parts on, day-only parts off; checked every 20 s like Building.usl NIGHT_TIMER); the wild
// animals asleep at night.
//   python3 tests/evaljs.py tests/night_lights.js "&tribe=Hu&enemy=Aje"
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const lit = (b) => { let on = 0, all = 0; b.model.traverse((o) => { if (o.userData.tod === 'night') { all++; let v = true; for (let p = o; p && p !== b.model.parent; p = p.parent) if (!p.visible) v = false; if (v) on++; } }); return [on, all]; };
const run = (sec, dt = 0.25) => G.step(Math.ceil(sec / dt), dt);
const hh = (t) => `${Math.floor(t / 3600)}:${String(Math.floor(t % 3600 / 60)).padStart(2, '0')}`;
// a campaign mission starts at its level's StartTime (Root/Base/StartTime: mission 5 at 15:00, 11 at 18:00)
const want = G.campaign ? G.campaign.data.map.start_time.hour * 3600 + G.campaign.data.map.start_time.minute * 60 : 12 * 3600;
check('the level starts at its start time (a random map at 12:00)', Math.abs(W.dayTime() - want - W.time * 144) < 144 * 2, [hh(W.dayTime()), hh(want)]);
if (G.campaign) return out.join('\n');
// a building with night lights, finished
const h = G.homeEntity();
const name = ['hu_stone_cottage', 'hu_lumberjack_cottage', 'hu_marketplace'].find((n) => W.data.exists(n));
let b = null;
for (let k = 0; k < 400 && !b; k++) { const a = k * 2.4, r = 20 + k * 0.1, x = h.pos.x + Math.cos(a) * r, z = h.pos.z + Math.sin(a) * r; if (W.canPlace(name, x, z, 0, me)) b = W.placeBuilding(name, me, x, z, 0, true); }
check('a building with night lights', !!b && lit(b)[1] > 0, b && [b.name, lit(b)]);
run(25);
check('by day its lights are off', lit(b)[0] === 0, lit(b));
// to 18:00 and 20 s more (its check every 20 s)
const toNight = ((18 * 3600 - W.dayTime()) / 144) + 1;
run(toNight + 21);
check('after 18:00 it is night', W.isNight(), hh(W.dayTime()));
check('at night its lights are on (within 20 s)', lit(b)[0] === lit(b)[1] && lit(b)[0] > 0, lit(b));
// the wild animals sleep at night (Animal.usl OnIdleTick / CSleep: "rest" at a place of their nest)
run(60);
const wild = W.units.filter((u) => u.alive && u.wild && u.anim.has('rest'));
const asleep = wild.filter((u) => u.task.type === 'roam' && u.task.phase === 'sleep');
check('at night wild animals sleep', !wild.length || asleep.length > 0, [asleep.length, wild.length]);
run((12 * 3600 / 144) + 21);
check('after 6:00 day again, the lights off', !W.isNight() && lit(b)[0] === 0, [hh(W.dayTime()), lit(b)]);
// by day no animal falls asleep (the ones asleep since the night sleep to the end of their loops)
const morning = new Set(W.units.filter((u) => u.alive && u.wild && u.task.phase === 'sleep'));
run(120);
const fresh = W.units.filter((u) => u.alive && u.wild && u.task.phase === 'sleep' && !morning.has(u) && !u.def.nightactive);
check('by day no animal falls asleep', !W.isNight() && fresh.length === 0, [hh(W.dayTime()), fresh.length, morning.size]);
return out.join('\n');
