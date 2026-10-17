// The ambience (engine/atmo.js, CAtmoSoundMgr): the level's template, the state by ground material, camera height
// and daytime, the bed of the state, the switch after FadeDelay, the event playlist (most entries are silent pauses).
//   python3 tests/evaljs.py tests/atmo.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/multi_2_jun_001.ula"
const W = G.world, S = G.mapSource, A = G.audio, M = A.atmo, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
check('the level names its template (material_atmos)', /jungle/.test(S.atmos) && !!M.T && M.T.length === 36 && M.T.every(Boolean), [S.atmos, M.T && M.T.length]);
// the ground material: the map's 4 m materials, forest squares
const mats = new Set();
for (let x = -S.size / 2 + 40; x < S.size / 2 - 40; x += 32) for (let z = -S.size / 2 + 40; z < S.size / 2 - 40; z += 32) mats.add(S.soundMat(x, z));
check('the map\'s squares have their ground materials (and forest: 8)', mats.size >= 2 && [...mats].every((m) => m >= 0 && m <= 8), [...mats].sort());
// the state: material + 9 * (high + 2 * day)
check('the state of a material, height and daytime', M.constructor.state(3, true, false) === 12 && M.constructor.state(8, false, true) === 26 && M.constructor.state(1, true, true) === 28, null);
// playing: an AudioContext (headless: may stay suspended - the logic runs anyway)
A.init(); A.muted = false;
const plays = [];
const orig = A.playFile.bind(A);
A.playFile = (file, vol, pos, mh, ch, rate, pan) => { if (ch === 'atmo') plays.push([file, Math.round(vol), Math.round(pan * 100)]); return orig(file, vol, pos, mh, ch, rate, pan); };
const day = M.constructor.state(2, true, true), night = M.constructor.state(2, true, false), other = M.constructor.state(8, true, true);
let t = 0;
const tick = (st, sec) => { for (let k = 0; k < sec * 10; k++) { t += 0.1; M.update(0.1, st, t); } };
tick(day, 1);
check('the state plays (its bed: wav1 or the playlist\'s W entry)', M.cur === day, [M.cur, M.T[day].w[0]]);
tick(night, 0.05);
check('day to night switches at once', M.cur === night, M.cur);
tick(other, 0.2);
check('another material waits FadeDelay (0.5 s)', M.cur === night, M.cur);
tick(other, 0.5);
check('... then switches', M.cur === other, M.cur);
// the events: 600 s of the forest state - only entries with a volume are heard, at their volume and pan
plays.length = 0;
tick(other, 600);
const E = M.T[other].e, loud = E.filter((e) => e[8] > 0);
const files = new Set(loud.map((e) => M.T[other].w[e[0] - 1]));
check('events play, only the entries that have a volume', plays.length > 0 && plays.every((p) => files.has(p[0])), [plays.length, loud.length, E.length, plays.slice(0, 3)]);
check('at their volume and pan', plays.every((p) => p[1] >= 11 && p[1] <= 80 && Math.abs(p[2]) <= 80), plays.slice(0, 5));
A.playFile = orig;
M.start('No Atmos');
check('"No Atmos": silence', !M.T, null);
return out.join('\n');
