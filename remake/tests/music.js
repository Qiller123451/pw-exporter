// The music manager (engine/music.js, the original's MusicMgr.usl on Audio/MusicMgr.txt + MusicTracks.txt):
// the level's playlist, the opening track, combat after attacks at 3 places, back after 10 s without one, the
// trigger action's track, the hometown theme (only the Aje's resource collector is found by the original's query).
//   python3 tests/evaljs.py tests/music.js "&campaign=5"
//   python3 tests/evaljs.py tests/music.js "&tribe=Aje&enemy=Hu"
const W = G.world, M = G.audio.mus, D = M.data, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
// the mission's own fights (the campaign's enemies attack while the test runs) are kept out: the test's attacks go
// through attack(), the feedback section lets the hits through
const attack = M.attack.bind(M);
M.attack = () => {};
const run = (sec, dt = 0.25) => { for (let t = 0; t < sec; t += dt) { G.step(1, dt); M.update(W.time, G.audio.listener, () => []); } };
check('the tables of MusicMgr.txt / MusicTracks.txt are loaded', !!(D.playlists && D.playlists.default && D.playlists.single_05 && D.tracks['01_maintheme']), Object.keys(D.playlists || {}).length);
const want = G.campaign ? D.playlists['single_' + String(G.campaign.id).padStart(2, '0')] : D.playlists[(G.mapSource.setting || '').toLowerCase() + '_txt'] || D.playlists.default;
check('the level\'s playlist (LevelName, else the setting\'s atmosphere, else default)', M.level === want, G.mapSource.levelName);
M.update(W.time);
const st = M.state();
// (a track whose file is missing ends at once: the cloud copy of the game has 8 of the 51)
if (want.Opening) check('a playlist with an opening plays it first', want.Opening.includes(M.S('Opening').track) && (st.playing === 'Opening' || M.S('Opening').el.failed), [M.S('Opening').track, st]);
else check('the background plays', st.playing === 'Background' && want.Background.includes(st.track), st);
// the opening ends -> the background
if (want.Opening) { M.S('Opening').el = { ended: true }; M.update(W.time); check('after the opening the background', M.state().playing === 'Background' && want.Background.includes(M.state().track), M.state()); }
// two attacks are no battle, the third place is
attack(1, 1, W.time); attack(1, 1, W.time); attack(5, 5, W.time); M.update(W.time);
check('attacks at 2 places: no combat music', M.state().playing === 'Background', M.state());
attack(9, 9, W.time); M.update(W.time);
check('at 3 places within 10 s: combat music', want.Combat ? M.state().playing === 'Combat' && want.Combat.includes(M.state().track) : M.state().track === '-silence-', M.state());
run(5);
check('5 s later still combat', M.state().playing === 'Combat', M.state());
run(6);
check('10 s without an attack: the background again', M.state().playing === 'Background', M.state());
// the hits on the player's objects reach it as the minimap's attack events (ui/feedback.js: one per 0.15 s)
{
  const mine = W.units.filter((u) => u.alive && u.owner === G.me).slice(0, 3), F = G.feedback;
  F.audio = F.audio || G.audio;
  M.attack = attack;
  const n0 = M.attacks.length;
  for (const u of mine) { F.handle([{ type: 'attacked', entity: u }]); F.hitsT -= 1; F.handle([]); u.pos.x += 0.01; }
  check('hits on own units count as attack places', M.attacks.length > n0, [n0, M.attacks.length]);
  const enemy = W.units.find((u) => u.alive && u.owner !== G.me && u.owner && !G.me.isFriend(u.owner));
  M.attacks = [];
  if (enemy) { F.handle([{ type: 'attacked', entity: enemy, by: mine[0] }]); F.hitsT -= 1; F.handle([]); check('hits of own units on others do not (FeedbackEventMgr: the attacked object\'s owner)', M.attacks.length === 0, M.attacks.length); }
  for (const u of mine) u.pos.x -= 0.01;
}
M.attack = () => {};
M.attacks = []; run(11);
// the trigger action MUSI (CActionMusic), once
M.trigger('24_location_temple', false); M.update(W.time);
check('the trigger action\'s track plays', M.state().playing === 'Trigger' && M.state().track === '24_location_temple', M.state());
M.S('Trigger').el = { ended: true }; M.update(W.time);
check('and when it ends the background again', M.state().playing === 'Background', M.state());
// the hometown theme: the listener near a home object of the player for more than 5 s
const L = { x: 0, z: 0 };
M.update(W.time, L, () => [{ x: 10, z: 10 }]);
run(1);
for (let t = 0; t < 6.5; t += 0.25) { G.step(1, 0.25); M.update(W.time, L, () => [{ x: 10, z: 10 }]); }
const tr = (D.switches.Hometown.tracks || {})[M.tribe] || [];
check('near home for 5 s: the tribe\'s theme', M.state().playing === 'Hometown' && tr.includes(M.state().track), [M.tribe, M.state()]);
for (let t = 0; t < 6.5; t += 0.25) { G.step(1, 0.25); M.update(W.time, L, () => []); }
check('away for 5 s: the background', M.state().playing === 'Background', M.state());
// the game's own query: only the Aje's resource collector
const homes = W.units.filter((u) => u.alive && u.owner === G.me && u.name === 'aje_resource_collector').length + W.buildings.filter((b) => b.alive && b.owner === G.me && /^(fireplace|seas_headquaters)$/.test(b.name)).length;
const collectors = W.units.filter((u) => u.alive && u.owner === G.me && u.name === 'aje_resource_collector').length;
check('home objects of the original\'s query (Aje: the resource collectors; the others none)', G.me.tribe === 'Aje' ? homes === collectors : homes === 0, [G.me.tribe, homes]);
// the end of the game: its music goes on
if (!G.campaign) { const before = M.state().track; G.endMission(true); M.update(W.time); check('after the end the level\'s music goes on', M.state().track === before, M.state()); }
return out.join('\n');
