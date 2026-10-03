// The trigger engine in the real game: python3 tests/evaljs.py tests/campaign_engine.js "&campaign=11"
// The arena's own triggers are held back (only its game-over trigger stays); the test adds triggers of its own
// (G.campaign.debug.add, the format of the mission data) that work on the real world: real regions of the map,
// units spawned out of the arena's gates, hit points, deaths, owners, waypoints, fog reveals - and at the end a
// hero dies and the mission's own trigger must end the game (GAOV). The pure semantics (expressions, flags,
// variables, timers) are also covered without a browser by tests/campaign_engine.mjs.
const C = G.campaign, W = G.world, E = C.engine, D = C.debug, R = C.objects, out = [];
const ok = (c, m) => out.push(`${c ? 'ok' : 'FAIL'} ${m}`);
const info = (m) => out.push('   ' + m);
const run = (s) => { for (let i = 0; i < s; i += 1) { G.step(Math.round(Math.min(1, s - i) * 20), 0.05); } };
const v = (n) => C.variables.get(n);
let nid = 0;
const add = (name, flags, conditions, actions, extra = {}) => D.add({ name, guid: extra.guid || 'test' + (++nid), folder: extra.folder || 'Root', expression: extra.expression || '',
  flags: { once: true, enabled: true, random: false, by_difficulty: false, node_off: false, ...flags },
  conditions: conditions.map((c) => ({ type: c[0], p: c[0] === 'CVAR' ? { local: '1', ...c[1] } : c[1] || {} })), actions: actions.map((a) => ({ type: a[0], p: a[1] || {}, difficulty: a[2] == null ? 1 : a[2] })) });
const vars = (n, op = '+', value = '1') => ['VARS', { varname: n, operation: op, value, local: '1' }];
let err = null;
try {
  // ---- hold the mission back: nothing of the arena starts, except "a hero died"
  ok(!E.started && E.triggers.length === 119, `the engine holds the mission's ${E.triggers.length} compiled triggers and has not started yet`);
  for (const t of E.triggers) if (t.name !== 'Xa: GameOver') t.startEnabled = false;
  const me = G.me, heroes = W.units.filter((u) => u.alive && u.owner === me);
  for (const h of heroes) W.setInvulnerable(h, true);
  W.setAggro(heroes, -1);                       // the heroes stand by: they must not kill the test's units
  run(2);
  ok(E.started && D.live().length === 1 && E.stats.fired === 0, 'only the game-over trigger listens; nothing has fired');
  ok(heroes.length === 3 && heroes.map((h) => h.name).sort().join() === 'Bela_s0,Cole_s0,special_eusmilus', 'the three heroes of the start army: ' + heroes.map((h) => h.name + ' L' + h.level).join(', '));

  // ---- flags, once, re-enable, TIME, TRUE
  add('t once', {}, [['TIME', { duration: '1' }]], [vars('once')]);
  add('t every', { once: false }, [['TIME', { duration: '1' }]], [vars('every')]);
  add('t loop', {}, [['TIME', { duration: '2' }]], [vars('loop'), ['TRIG', { guid: 'loop', state: '1' }]], { guid: 'loop' });
  add('t sub', { enabled: false }, [['TRUE']], [vars('sub')], { guid: 'sub' });
  add('t call', { once: false }, [['TIME', { duration: '1.5' }]], [['TRIG', { guid: 'sub', state: '1' }]]);
  run(6.2);
  ok(v('once') === '1' && v('every') === '6', `once: one firing; without once a TIME trigger fires every period (${v('once')}, ${v('every')})`);
  ok(v('loop') === '3' && v('sub') === '4', `re-enabling: a self-enabling once trigger loops (${v('loop')}), a TRUE sub-routine runs per call (${v('sub')})`);
  // ---- random, by_difficulty
  add('t rnd', { once: false, random: true }, [['TIME', { duration: '0.1' }]], ['a', 'b', 'c', 'd'].map((n) => vars('r_' + n)));
  add('t diff', { by_difficulty: true }, [['TIME', { duration: '1' }]], [vars('d_easy', '+', '1'), vars('d_med', '+', '1'), vars('d_hard', '+', '1')].map((a, i) => [a[0], a[1], [0, 1, 2][i]]));
  run(10.5);
  const rn = ['a', 'b', 'c', 'd'].map((n) => +v('r_' + n) || 0), rs = rn.reduce((x, y) => x + y, 0);
  ok(rs >= 95 && rs <= 106 && rn.every((n) => n > 5), `random: one action per firing, every alternative comes up (${rn.join(' ')} in ${rs} firings)`);
  ok(C.difficulty === 1 && v('d_med') === '1' && v('d_easy') === undefined && v('d_hard') === undefined, 'by_difficulty: only the actions of the current difficulty (medium) run');
  D.enable('t rnd', false); D.enable('t every', false); D.enable('t call', false); D.enable('t loop', false);

  // ---- variables, count expressions, timers
  add('t vars', {}, [['TIME', { duration: '0.5' }]], [vars('n', 'set', '7'), vars('n', '*', '3'), vars('n', '-', '1'), vars('n', '/', '4'), vars('lim', 'set', '5'), ['TIMR', { timer_id: '9', duration: '3', show: '1', tooltip: 'Test timer' }]]);
  add('t cvar', {}, [['CVAR', { varname: 'n', operation: '==', value: '$(lim)' }]], [vars('cvar_ok', 'set', '1')]);
  add('t cvar2', {}, [['CVAR', { varname: 'n', operation: '>', value: '4' }], ['CVAR', { varname: 'n', operation: '<', value: '5' }]], [vars('cvar_bad', 'set', '1')], { expression: '1 && 2' });
  add('t timr', {}, [['TIMR', { timer_id: '9' }]], [vars('timer_ok', 'set', '1')]);
  run(1);
  ok(v('n') === '5' && v('cvar_ok') === '1' && v('cvar_bad') === undefined, `VARS arithmetic 7*3-1/4 = ${v('n')}; CVAR == $(lim); an expression that is false does not fire`);
  const tm = C.timers.get('9');
  ok(tm && tm.show === true && tm.label === 'Test timer' && tm.left > 2 && tm.left < 3, 'TIMR: G.campaign.timers has the visible timer with its label');
  run(3);
  ok(v('timer_ok') === '1' && !C.timers.has('9'), 'the TIMR condition fires when the timer has run out');

  // ---- object queries and regions on the real map: a wave out of a real gate into a group
  const gate = R.byName('hc_colloseum_a2_a_0'), grp = C.groups[0];
  ok(!!gate && !!gate.prop && !!grp, `the map's gate object and group exist (${gate && gate.name}, ${grp && grp.name})`);
  const reg = C.regions.find('Gate_1');
  ok(!!reg && reg.contains(...C.toGame(229, 205)), 'region Gate_1 of the map');
  const u0 = W.units.length;
  add('t spawn', {}, [['TIME', { duration: '0.5' }]], [['SPGR', { group: grp.guid, classes_0: 'arena_gallimimus 1 2|aje_warrior 2 2|', owner: '1', pos: '229 205 38', use_spawn_obj: '1', spawn_delay: '1', obj_name: gate.name, obj_guid: gate.guid }], ['TRIG', { guid: 'wave', state: '1' }]]);
  add('t wave dead', { enabled: false }, [['CKGR', { group_guid: grp.guid, check_val: '<1' }], ['TIME', { duration: '4' }]], [vars('wave_dead', 'set', '1')], { guid: 'wave', expression: '1 && 2' });
  add('t in gate', {}, [['REGN', { rgn_guid: reg.guid, obj_type: 'CHTR|ANML|', obj_owner: '1', obj_count: '>=4' }]], [vars('in_gate', 'set', '1')]);
  add('t cls', {}, [['REGN', { obj_type: 'ANML|', obj_owner: '1', obj_class: 'arena_gallimimus', obj_count: '==2' }]], [vars('two_galli', 'set', '1')]);
  add('t none', {}, [['REGN', { obj_type: 'CHTR|', obj_owner: '1', obj_count: '<1' }], ['CVAR', { varname: 'in_gate', operation: '==', value: '1' }]], [vars('no_chtr', 'set', '1')], { expression: '1 && 2' });
  run(1.2);
  const n1 = W.units.length - u0;
  ok(n1 >= 1 && n1 <= 2, `SPGR with a spawn building: the units come out one by one (${n1} after 0.7 s)`);
  run(4);
  const wave = grp.list().map((r) => r.entity);
  ok(wave.length === 4 && wave.every((u) => u.owner === C.players[1]) && wave.filter((u) => u.name === 'aje_warrior').every((u) => u.level === 2), `the wave of 4 is in the group, owned by player 1, levels as asked (${wave.map((u) => u.name + ' L' + u.level).join(', ')})`);
  ok(v('wave_dead') === undefined, '"wave is dead" (CKGR <1 && TIME) does not fire while the wave lives');
  W.setAggro(wave, -1);
  run(20);
  ok(wave.every((u) => reg.contains(u.pos.x, u.pos.z)) && v('in_gate') === '1', 'the wave walked from the gate to the SPGR position; REGN in a region with type and owner filter');
  ok(v('two_galli') === '1' && v('no_chtr') === undefined, 'REGN by class on the whole map; "<1" is false while units exist');
  // ---- OBJP, WYPT / WAYR, OCPY, SFOW, ACDO
  const w1 = wave.find((u) => u.name === 'aje_warrior'), g1 = wave.find((u) => u.name === 'arena_gallimimus');
  add('t hp', {}, [['OBJP', { obj_type: 'CHTR|', obj_owner: '1', obj_class: 'aje_warrior', attrib_name: 'hitpoints', attrib_value: '<50', attrib_max: 'maxhitpoints' }]], [vars('hurt', 'set', '1')]);
  add('t patrol', {}, [['TIME', { duration: '0.2' }]], [['WYPT', { obj_type: 'ANML|', obj_owner: '1', obj_class: 'arena_gallimimus', waypoints: '240 215 38|250 225 38|', patrolmode: '0', walkspeed: '3' }], ['AIAM', { obj_owner: '1', aggro_state: '-1' }]]);
  add('t wayr', { once: false }, [['WAYR', { obj_type: 'ANML|', obj_owner: '1' }]], [vars('arrived')]);
  for (const u of wave) W.setAggro([u], -1);
  run(0.5);
  ok(E.patrols.size === 2 && g1.task.type !== 'idle', 'WYPT: both animals are on their route');
  W.setHp(w1, w1.maxHp * 0.4);
  run(25);
  const [ex, ez] = C.toGame(250, 225);
  ok(v('arrived') === '2' && Math.hypot(g1.pos.x - ex, g1.pos.z - ez) < 8, `WYPT mode 0: the route is walked once, WAYR fires for each unit (${v('arrived')})`);
  ok(v('hurt') === '1', 'OBJP: hit points below 50 %');
  const rev0 = W.reveals.length;
  add('t join', {}, [['TIME', { duration: '0.2' }]], [['OCPY', { obj_type: 'ANML|', obj_owner: '1', obj_class: 'arena_gallimimus' }], ['SFOW', { pos: '[0 0 0]', obj_type: 'ANML|', obj_class: 'arena_gallimimus', radius: '20', duration: '5' }],
    ['ACDO', { obj_name: gate.name, obj_guid: gate.guid, action: 'SetAnim', additional_params: 'open | 1' }], ['ACDO', { obj_type: 'CHTR|', obj_owner: '1', action: 'WalkAction', additional_params: '[256 240 38] | 2' }],
    ['ACDO', { obj_class: 'Cole_s0', obj_owner: '0', action: 'SetPos', additional_params: '[280 250 38] | 2' }], ['UNIT', { obj_class: 'Bela_s0', attrib_name: 'hitpoints', attrib_mod: '=33' }]]);
  run(1);
  const cole = heroes.find((h) => h.name === 'Cole_s0'), bela = heroes.find((h) => h.name === 'Bela_s0');
  ok(g1.owner === me && wave.filter((u) => u.owner === me).length === 2, 'OCPY without new_owner gives the objects to the human player');
  ok(W.reveals.length === rev0 + 2 && W.reveals[W.reveals.length - 1].follow, 'SFOW with pos [0 0 0]: one reveal per object, following it');
  const [cx, cz] = C.toGame(280, 250);
  ok(Math.hypot(cole.pos.x - cx, cole.pos.z - cz) < 3 && Math.round(bela.hp) === 33, 'ACDO SetPos teleports Cole; UNIT sets hit points');
  ok(w1.task.type === 'move' && w1.task.slow === true, 'ACDO WalkAction with speed 2 walks');
  // ---- DEAD / DYIN, REPL, DELO
  add('t dead', {}, [['DEAD', { obj_type: 'CHTR|', obj_owner: '1', obj_class: 'aje_warrior' }]], [vars('dead')]);
  add('t dying', {}, [['DYIN', { obj_name: w1.rec.name, obj_guid: 'x' }]], [vars('dying')]);
  add('t ghost', {}, [['DEAD', { obj_name: 'hc_colloseum_small_gate_7', obj_guid: 'gfhalkgddhcfjnbbjjifaaoagkcfmjgm' }]], [vars('ghost')]);
  run(0.5);
  ok(v('ghost') === '1' && v('dead') === undefined, 'DEAD on an object the map does not have is true at once; on living objects it waits');
  W.kill(w1, null);
  run(0.3);
  ok(v('dead') === '1' && v('dying') === '1', 'DEAD (by class) and DYIN (by name) fire when the unit dies');
  add('t repl', {}, [['TIME', { duration: '0.2' }]], [['REPL', { obj_type: 'CHTR|', obj_owner: '1', obj_class: 'aje_warrior', new_obj: 'aje_spearman', obj_level: '2' }], ['DELO', { obj_type: 'ANML|', obj_owner: '0', obj_class: 'arena_gallimimus', maxobjs: '1' }]]);
  run(0.5);
  const sp = W.units.find((u) => u.alive && u.name === 'aje_spearman');
  ok(sp && sp.level === 3 && sp.owner === C.players[1] && !W.units.some((u) => u.alive && u.name === 'aje_warrior'), 'REPL: the warrior became a level-3 spearman of the same owner');
  ok(W.units.filter((u) => u.alive && u.name === 'arena_gallimimus').length === 1, 'DELO with maxobjs 1 deletes one object');
  run(4);
  ok(v('wave_dead') === undefined, 'the group still has members (the replacement joined it)');
  W.kill(sp, null); for (const u of W.units) if (u.alive && u.name === 'arena_gallimimus') C.remove(u);
  run(1);
  ok(v('wave_dead') === '1' && grp.size === 0 && v('no_chtr') === '1', 'CKGR <1: the group is empty after the last member died; REGN <1 for the owner');
  // ---- a healing well of the arena: a hurt hero standing next to it is healed out of the well's store
  {
    const well = E.wells[0], [wx, wy] = C.toMap(well.pos[0], well.pos[1]);
    W.setHp(bela, 33);
    C.teleport(bela, wx + 3, wy + 2);
    run(1.5);
    ok(E.wells.length === 3 && bela.hp === bela.maxHp && well.fill < well.max && well.fill > well.max - bela.maxHp, `healing well: Béla is healed (${Math.round(bela.hp)} hp), the well has ${Math.round(well.fill)} of ${well.max} left and refills in ${well.refill} s`);
  }
  // ---- debug helpers
  ok(D.list('t once').length === 1 && D.trigger('t once').fired === 1 && D.log(5).length === 5 && typeof D.print(3) === 'string', 'debug: list / trigger / log / print');
  D.setVar('n', 99); D.quest('L11MQ01', 0);
  ok(v('n') === '99' && D.quests()[0].visible === true, 'debug: setVar, quest');
  ok(D.fire('t once') && v('once') === '2', 'debug: fire a trigger by name');
  ok(C.errors.length === 0 && D.summary().unknownActions.length === 0, `no errors, no unknown types (${JSON.stringify(C.errors.slice(0, 3))})`);

  // ---- the mission's own trigger: a hero dies -> GAOV -> defeat after 4 s
  for (const h of heroes) W.setInvulnerable(h, false);
  W.kill(cole, null);
  run(1);
  ok(!G.over && D.fired('Xa: GameOver') === 1, 'DEAD on the hero class: the mission\'s game-over trigger fired; the defeat screen is not up yet');
  run(4);
  ok(G.over && G.endInfo && G.endInfo.won === false && /hero/i.test(G.endInfo.text), `GAOV: G.endMission(false, "${G.endInfo && G.endInfo.text}") 4 s later`);
} catch (e) { err = e.stack || String(e); }
ok(!err, 'no exception' + (err ? ': ' + err : ''));
for (const e of C.errors.slice(0, 8)) info('error ' + JSON.stringify(e));
return out.join('\n');
