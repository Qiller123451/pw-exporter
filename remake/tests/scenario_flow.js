// The scenarios (game/scenarios/missions.js, docs/SCENARIOS.md) played through by script, as any tribe: the
// player's side cannot be hurt, fights are won by killing what stands in the way, the hero is put where the story
// needs it - and each must end in a win. Also checks the start: the tribe's main building (or the Dustriders'
// collector), workers and hero, the enemies of other tribes.
// python3 tests/evaljs.py tests/scenario_flow.js "&scenario=N&tribe=Hu|Aje|Ninigi|SEAS"   (N 1-5; 4: &path=silence too)
const S = G.sequel, W = G.world, me = G.me, out = [];
const q = new URLSearchParams(location.search);
const sec = (s) => G.step(Math.max(1, Math.round(s * 20)));
const P = (r) => S.player(r);
const mine = (f) => W.units.filter((u) => u.alive && u.owner === me && (!f || f(u)));
const guard = () => { for (const u of mine()) if (!(u.invulnT > 0)) W.setInvulnerable(u, true); const h = S.home(me); if (h && !(h.invulnT > 0)) W.setInvulnerable(h, true); };
const kill = (list, by) => { for (const e of list) if (e && e.alive) { if (by) e.lastDamager = by; W.kill(e, null); } };
const units = (role, f) => W.units.filter((u) => u.alive && u.owner === P(role) && (!f || f(u)));
const tp = (u, x, z) => { if (u) W.teleport(u, x, z); };
const hero = () => mine((u) => u.name === S.state.heroCls)[0];
const objs = () => S.objectives.map((o) => o.id + (o.done ? '+' : o.failed ? 'x' : '')).join(',');
let ok = true;
const check = (what, c) => { out.push(`${what}: ${c ? 'ok' : 'FAIL'}`); if (!c) ok = false; };
const id = S.id;
check(`plays as ${S.tribe}`, me.tribe === S.tribe && S.kind === 'scenario');
check('main building', !!S.home(me));
check('hero', !!hero());
check('enemies of other tribes', ['foe', 'foe2'].every((r) => !P(r) || P(r).tribe !== me.tribe));
guard();

if (id === 1) {
  const st = S.state;
  sec(2);
  kill([st.beasts.find((b) => b.id === 'king').e], P('foe'));
  sec(1);
  check('a rival kill counts for them', st.theirs === 1);
  for (const b of st.beasts.filter((x) => x.id !== 'king').slice(0, 3)) { kill([b.e], me); sec(1); }
  check('three trophies', st.mine === 3);
  sec(10);
} else if (id === 2) {
  const st = S.state;
  for (let k = 0; k < 400 && !S.ended; k++) { kill(units('outbreak')); guard(); sec(5); }
  check('ten waves', st.wave === 10);
  check('the Barrow King came', !!st.king);
} else if (id === 3) {
  const st = S.state;
  for (let k = 0; k < 120 && !S.ended; k++) {
    for (const r of ['foe', 'foe2']) kill(units(r, (u) => Math.hypot(u.pos.x, u.pos.z) < 60));
    for (const u of mine((x) => !x.isWorker)) if (Math.hypot(u.pos.x, u.pos.z) > 15) tp(u, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    guard(); sec(5);
  }
  check('held the summit', st.held.me >= st.need);
  check('the mountain erupted', (st.rumbles || 0) >= 3);
} else if (id === 4) {
  const st = S.state;
  for (let k = 0; k < 60 && st.met !== 2; k++) sec(5);
  check('both envoys came', st.met === 2);
  if (q.get('path') === 'silence') {
    sec((st.deadline - S.time) + 2);
    check('silence: both enemies', st.chosen === 'none' && me.isEnemy(P('foe')) && me.isEnemy(P('foe2')));
    kill([st.homes.foe, st.homes.foe2]);
  } else {
    const e = st.envoys.foe2;
    tp(hero(), e.pos.x + 3, e.pos.z); sec(2);
    check('sided with the second', st.chosen === 'foe2' && me.isFriend(P('foe2')) && me.isEnemy(P('foe')));
    sec(70);
    kill([st.homes.foe]);
  }
  sec(12);
} else if (id === 5) {
  const st = S.state, t0 = st.titanAt;
  for (const f of st.forges) { kill([f.b]); sec(1); }
  check('forges set the Titan back', st.titanAt === t0 + 9 * 60 && S.isDone('forges'));
  st.titanAt = S.time + 1; sec(3);
  check('the Titan walks', !!st.titan && st.titan.alive && st.titan.maxHp > 0);
  kill([st.titan]); sec(2);
  kill([st.home]); sec(12);
}
check('won', !!S.ended && S.ended.won);
out.push(objs());
return (ok ? 'ok ' : 'FAIL ') + `scenario ${id} as ${S.tribe}: ` + out.join(' | ');
