// The trigger engine's semantics, without a browser: node tests/campaign_engine.mjs [folder with single_NN.json]
// Part 1 runs small hand-made missions against a mock world (tests/campaign_mock.mjs): flags, once / re-enable,
// random, by_difficulty, folders, expressions, count expressions, variables, timers, regions, DEAD / DYIN, groups,
// quests, sequences and dialogues, game over, unknown types. Part 2 (only if the mission dumps are there, e.g.
// _notes/cpn or PW_CPN=<folder>) loads every real mission into the mock world, runs two game minutes and reports
// what the engine did - no condition or action type may be unknown or throw.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeGame, mission, trig, guid } from './campaign_mock.mjs';
import { compare, valueString, compileExpression } from '../src/game/campaign/trigutil.js';

let fails = 0;
const ok = (c, m) => { if (!c) fails++; console.log(`${c ? 'ok' : 'FAIL'} ${m}`); };
const fired = (G, n) => G.campaign.debug.fired(n);
const V = (o) => new Map(Object.entries(o));

// ---------------------------------------------------------------------------------------------- helpers
{
  const v = V({ a: '5', 'two words': '7' });
  ok(compare(3, '>2', v) && !compare(2, '>2', v) && compare(2, '>=2', v) && compare(1, '<2', v) && compare(2, '<=2', v) && compare(2, '==2', v) && compare(2, '=2', v) && compare(3, '!=2', v), 'count expressions: > >= < <= == = !=');
  ok(compare(2, '2', v) && compare(3, '2', v) && !compare(1, '2', v) && compare(0, '', v), 'count expressions: a bare number and the empty string mean >=');
  ok(compare(5, '==$(a)', v) && compare(8, '>$(two words)', v) && compare(0, '<1$(nothing)', v) === false && valueString('$(nothing)', v) === '', '$(variable) in a count expression (unknown = 0)');
  const c = (s, st) => compileExpression(s, st.length)(st.map((x) => ({ state: x })));
  ok(c('1 && (2 || 3) && !4', [1, 0, 1, 0]) && !c('1 && (2 || 3) && !4', [1, 0, 1, 1]) && !c('1 && (2 || 3) && !4', [1, 0, 0, 0]) && c('1 || 2 && 3', [1, 0, 0]) && !c('', [1, 0]) && c('', [1, 1]) && !c('', []), 'expressions: && || ! ( ), precedence, empty = AND of all, none = never');
}

// ---------------------------------------------------------------------------------------------- flags, once, TRIG
{
  const self = guid('t'), b = guid('t'), c = guid('t'), chain = guid('t'), never = guid('t'), tog = guid('t');
  const G = makeGame(mission({ variables: { n: { type: 'int', value: '0' } }, triggers: [
    trig('once', {}, [['TIME', { duration: '2' }]], [['VARS', { varname: 'once', operation: '+', value: '1' }]]),
    trig('every', { once: false }, [['TIME', { duration: '2' }]], [['VARS', { varname: 'every', operation: '+', value: '1' }]]),
    trig('loop', {}, [['TIME', { duration: '3' }]], [['VARS', { varname: 'loop', operation: '+', value: '1' }], ['TRIG', { guid: self, state: '1' }]], { guid: self }),
    trig('start', {}, [['TIME', { duration: '1' }]], [['TRIG', { guid: b, state: '1' }], ['VARS', { varname: 'order', operation: 'set', value: 'start' }], ['TRIG', { guid: never, state: '1' }], ['TRIG', { guid: 'no such trigger', state: '1' }]]),
    trig('sub', { enabled: false }, [['TRUE']], [['VARS', { varname: 'order', operation: 'set', value: 'sub' }], ['VARS', { varname: 'sub', operation: '+', value: '1' }], ['TRIG', { guid: chain, state: '1' }]], { guid: b }),
    trig('chain', { enabled: false }, [['TIME', { duration: '1' }]], [['VARS', { varname: 'chain', operation: '+', value: '1' }]], { guid: chain }),
    trig('not compiled', {}, [['TIME', { duration: '1' }]], [['VARS', { varname: 'bad', operation: '+', value: '1' }]], { guid: never, compiled: false }),
    trig('again', { once: false }, [['TIME', { duration: '4' }]], [['TRIG', { guid: b, state: '1' }]]),
    trig('long', {}, [['TIME', { duration: '5' }]], [['VARS', { varname: 'long', operation: '+', value: '1' }]], { guid: c }),
    trig('poke', {}, [['TIME', { duration: '3' }]], [['TRIG', { guid: c, state: '1' }]]),
    trig('stopped', {}, [['TIME', { duration: '6' }]], [['VARS', { varname: 'stopped', operation: '+', value: '1' }]], { guid: tog }),
    trig('stopper', {}, [['TIME', { duration: '1' }]], [['TRIG', { guid: tog }]]),
    trig('empty', {}, [], [['VARS', { varname: 'empty', operation: '+', value: '1' }]]),
  ] }));
  const v = (n) => G.campaign.variables.get(n);
  G.run(1.5);
  ok(v('order') === 'sub' && v('sub') === '1', 'TRIG enables a TRUE trigger: it fires after the remaining actions of the enabling trigger');
  G.run(1);
  ok(v('once') === '1' && v('every') === '1' && v('chain') === '1', 'TIME: fires after its duration; a TIME 1 chain link one second after it was enabled');
  G.run(8);       // t = 10.5
  ok(v('once') === '1' && v('every') === '5', `once fires one time, a trigger without once and a TIME condition every period (${v('every')} in 10.5 s)`);
  ok(v('loop') === '3', `a once trigger that re-enables itself loops (${v('loop')} rounds of 3 s)`);
  ok(v('sub') === '3', `a once trigger is not used up: every TRIG enable makes it fire again (${v('sub')})`);
  ok(v('long') === '1' && fired(G, 'long') === 1, 'TRIG enable on an enabled trigger does not restart its timer');
  ok(v('bad') === undefined && fired(G, 'not compiled') === -1, 'a trigger that was not compiled does not exist; TRIG at it or at an unknown guid does nothing');
  ok(v('stopped') === undefined, 'TRIG without state disables: the timer is cancelled');
  ok(v('empty') === undefined, 'a trigger without conditions never fires');
  ok(G.campaign.errors.length === 0, 'no errors ' + JSON.stringify(G.campaign.errors));
}

// ---------------------------------------------------------------------------------------------- random, by_difficulty
{
  const acts = ['a', 'b', 'c', 'd', 'e'].map((n) => ['VARS', { varname: n, operation: '+', value: '1' }]);
  const G = makeGame(mission({ triggers: [trig('rnd', { once: false, random: true }, [['TIME', { duration: '1' }]], acts)] }));
  let s = 7;
  G.campaign.engine.random = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  G.run(200.5);
  const n = ['a', 'b', 'c', 'd', 'e'].map((k) => +G.campaign.variables.get(k) || 0);
  ok(n.reduce((x, y) => x + y, 0) === 200 && n.every((x) => x > 20), `random: exactly one action per firing, all of them come up (${n})`);
  for (const d of [0, 1, 2]) {
    const H = makeGame(mission({ triggers: [
      trig('diff', { by_difficulty: true }, [['TIME', { duration: '1' }]], [['VARS', { varname: 'm', operation: '+', value: '1' }, 1], ['VARS', { varname: 'e', operation: '+', value: '1' }, 0], ['VARS', { varname: 'h', operation: '+', value: '1' }, 2], ['VARS', { varname: 'h', operation: '+', value: '1' }, 2]]),
      trig('all', {}, [['TIME', { duration: '1' }]], [['VARS', { varname: 'x', operation: '+', value: '1' }, 0], ['VARS', { varname: 'x', operation: '+', value: '1' }, 2]]),
    ] }), { difficulty: d });
    H.run(2);
    const g = (k) => H.campaign.variables.get(k) || '0';
    ok(g('e') === (d === 0 ? '1' : '0') && g('m') === (d === 1 ? '1' : '0') && g('h') === (d === 2 ? '2' : '0') && g('x') === '2', `by_difficulty on difficulty ${d}: only its own actions; without the flag all actions run`);
  }
}

// ---------------------------------------------------------------------------------------------- folders (ACND)
{
  const G = makeGame(mission({ triggers: [
    trig('off', { node_off: true }, [['TIME', { duration: '1' }]], [['VARS', { varname: 'off', operation: '+', value: '1' }]], { folder: 'Root/A/Order 1' }),
    trig('sub', { once: false }, [['TIME', { duration: '1' }]], [['VARS', { varname: 'sub', operation: '+', value: '1' }]], { folder: 'Root/B/Side quest/deep' }),
    trig('other', { once: false }, [['TIME', { duration: '1' }]], [['VARS', { varname: 'other', operation: '+', value: '1' }]], { folder: 'Root/B/Side quest 2' }),
    trig('switch on', {}, [['TIME', { duration: '5' }]], [['ACND', { nodename: 'Root/A/Order 1/', deststate: '1' }]]),
    trig('switch off', {}, [['TIME', { duration: '3.5' }]], [['ACND', { nodename: 'Root/B/Side quest/' }]]),
  ] }));
  const v = (n) => G.campaign.variables.get(n);
  G.run(4.5);
  ok(v('off') === undefined, 'a trigger in a folder that starts inactive (node_off) does not run');
  ok(v('sub') === '3' && v('other') === '4', `ACND deststate 0 stops the triggers below the folder, not its neighbours (${v('sub')}, ${v('other')})`);
  G.run(2);
  ok(v('off') === '1', 'ACND deststate 1 starts the enabled triggers of the folder');
  ok(v('sub') === '3', 'a deactivated folder stays off');
}

// ---------------------------------------------------------------------------------------------- variables, CVAR
{
  const G = makeGame(mission({ variables: { a: { type: 'int', value: '0' }, lim: { type: 'int', value: '3' }, slip: { type: 'int', value: '0' } }, triggers: [
    trig('count', { once: false }, [['TIME', { duration: '1' }]], [['VARS', { varname: 'a', operation: '+', value: '1' }]]),
    trig('eq2', {}, [['CVAR', { varname: 'a', operation: '==', value: '2' }]], [['VARS', { varname: 'eq2', operation: 'set', value: '$(a)' }]]),
    trig('gt', {}, [['CVAR', { varname: 'a', operation: '>', value: '$(lim)' }]], [['VARS', { varname: 'gt', operation: 'set', value: '$(a)' }]]),
    trig('noop', {}, [['CVAR', { varname: 'a', value: '5' }]], [['VARS', { varname: 'ge', operation: 'set', value: '$(a)' }], ['VARS', { varname: 'm', operation: 'set', value: '7' }], ['VARS', { varname: 'm', operation: '*', value: '3' }], ['VARS', { varname: 'm', operation: '-', value: '1' }], ['VARS', { varname: 'm', operation: '/', value: '3' }], ['VARS', { varname: 'm', operation: '/', value: '0' }], ['VARS', { varname: 'slip', operation: 'set', value: '=1' }]]),
    trig('slip', {}, [['CVAR', { varname: 'slip', operation: '==', value: '1' }]], [['VARS', { varname: 'slipped', operation: 'set', value: '1' }]]),
    trig('unknown', {}, [['CVAR', { varname: 'does not exist', operation: '<', value: '1' }]], [['VARS', { varname: 'unk', operation: 'set', value: '1' }]]),
    trig('lt', {}, [['CVAR', { varname: 'a', operation: '<', value: '1' }]], [['VARS', { varname: 'lt', operation: 'set', value: 'yes' }]]),
  ] }));
  const v = (n) => G.campaign.variables.get(n);
  G.run(0.2);
  ok(v('lt') === 'yes', 'CVAR is evaluated when its trigger is enabled');
  G.run(6);
  ok(v('eq2') === '2' && v('gt') === '4' && v('ge') === '5', `CVAR ==, > $(other variable), no operation = >= (${v('eq2')}, ${v('gt')}, ${v('ge')})`);
  ok(v('m') === '6', `VARS set * - / as integers, a division by 0 changes nothing (${v('m')})`);
  ok(v('slip') === '=1' && v('slipped') === undefined, 'VARS set stores the string as it is ("=1" never equals 1)');
  ok(v('unk') === undefined, 'CVAR on an unknown variable is never true');
}

// ---------------------------------------------------------------------------------------------- profile variables
{
  const G = makeGame(mission({ triggers: [
    trig('first time', {}, [['CVAR', { varname: 'Tutorial_Started', operation: '<', value: '1', local: undefined }]], [['VARS', { varname: 'long_intro', operation: 'set', value: '1' }], ['VARS', { varname: 'Tutorial_Started', operation: '+', value: '1', local: undefined }], ['VARS', { varname: 'Not_A_Profile_Variable', operation: 'set', value: '1', local: undefined }]]),
    trig('seen', {}, [['CVAR', { varname: 'Tutorial_Started', operation: '>', value: '0', local: undefined }]], [['VARS', { varname: 'short_intro', operation: 'set', value: '1' }]]),
    trig('unknown', {}, [['CVAR', { varname: 'Not_A_Profile_Variable', operation: '<', value: '5', local: undefined }]], [['VARS', { varname: 'bad', operation: 'set', value: '1' }]]),
  ] }));
  G.run(0.5);
  const v = (n) => G.campaign.variables.get(n);
  ok(v('long_intro') === '1' && v('short_intro') === '1' && G.campaign.engine.profile.get('Tutorial_Started') === '1' && !G.campaign.variables.has('Tutorial_Started'), 'VARS / CVAR without local = 1 work on the profile variables (Tutorial_Started), not on the level\'s');
  ok(v('bad') === undefined && !G.campaign.engine.profile.has('Not_A_Profile_Variable'), 'a profile variable that is not defined does not exist');
}

// ---------------------------------------------------------------------------------------------- timers (TIMR)
{
  const late = guid('t');
  const G = makeGame(mission({ triggers: [
    trig('make', {}, [['TIME', { duration: '1' }]], [['TIMR', { timer_id: '0', duration: '10', show: '0' }], ['TIMR', { timer_id: '5', duration: '20', tooltip: '_tip' }], ['TIMR', { timer_id: '6', duration: '4' }]]),
    trig('restart', {}, [['TIME', { duration: '6' }]], [['TIMR', { timer_id: '0', duration: '10', show: '0' }]]),
    trig('pause', {}, [['TIME', { duration: '3' }]], [['TIMR', { timer_id: '5', event: 'pause' }]]),
    trig('go on', {}, [['TIME', { duration: '13' }]], [['TIMR', { timer_id: '5', event: 'unpause' }]]),
    trig('kill', {}, [['TIME', { duration: '2' }]], [['TIMR', { timer_id: '6', event: 'kill' }]]),
    trig('t0', { once: false }, [['TIMR', { timer_id: '0' }]], [['VARS', { varname: 't0', operation: 'set', value: 'x' }]]),
    trig('t5', {}, [['TIMR', { timer_id: '5' }]], [['VARS', { varname: 't5', operation: 'set', value: 'x' }]]),
    trig('t6', {}, [['TIMR', { timer_id: '6' }]], [['VARS', { varname: 't6', operation: 'set', value: 'x' }]]),
    trig('late', { enabled: false }, [['TIMR', { timer_id: '0' }], ['CVAR', { varname: 'go', operation: '==', value: '1' }]], [['VARS', { varname: 'late', operation: 'set', value: 'x' }]], { guid: late, expression: '1 && 2' }),
    trig('later', {}, [['TIME', { duration: '18' }]], [['TRIG', { guid: late, state: '1' }], ['VARS', { varname: 'go', operation: 'set', value: '1' }]]),
  ], texts: { _tip: 'Time left' } }), {});
  const v = (n) => G.campaign.variables.get(n), T = G.campaign.timers;
  G.run(1.5);
  ok(T.size === 3 && T.get('5').show && T.get('5').label === 'Time left' && !T.get('0').show && Math.abs(T.get('0').left - 9.5) < 0.2, 'TIMR create: G.campaign.timers has { id, left, show, label, paused }');
  G.run(9.6);      // 11.1
  ok(v('t0') === undefined && T.has('0'), 'creating an existing timer restarts it');
  ok(!T.has('6') && v('t6') === undefined, 'kill deletes a timer without firing');
  G.run(5.5);      // 16.6
  ok(v('t0') === 'x' && !T.has('0'), 'the TIMR condition fires when its timer runs out; the timer is deleted');
  G.run(4.5);      // 21.1: timer 5 was paused from 3 to 13 -> runs out at 31
  ok(v('t5') === undefined && T.has('5') && Math.abs(T.get('5').left - 9.9) < 0.3, `pause / unpause keep the remaining time (${T.get('5') && T.get('5').left.toFixed(1)} s left)`);
  ok(v('late') === 'x', 'a TIMR condition is pushed while its trigger is disabled: the state stays 1');
  G.run(11);
  ok(v('t5') === 'x', 'a paused timer runs out later');
}

// ---------------------------------------------------------------------------------------------- regions, object queries, DEAD / DYIN, groups
{
  const rg = guid('r'), grp = guid('o'), hero = guid('o'), w1 = guid('o'), cage = guid('o'), wave = guid('t'), dead = guid('t');
  const G = makeGame(mission({
    regions: [{ guid: rg, name: 'goal', shapes: [{ type: 'rect', x: 300, y: 300, w: 40, h: 40 }] }],
    objects: [
      { guid: hero, name: 'Cole_s0_0', class: 'Cole_s0', type: 'CHTR', owner: 0, x: 100, y: 100, level: 1 },
      { guid: w1, name: 'hu_warrior_1', class: 'hu_warrior', type: 'CHTR', owner: 0, x: 104, y: 100 },
      { guid: guid('o'), name: 'aje_warrior_0', class: 'aje_warrior', type: 'CHTR', owner: 1, x: 310, y: 310 },
      { guid: cage, name: 'cage_0', class: 'hu_cage', type: 'DCCO', x: 200, y: 200 },
    ],
    groups: [{ guid: grp, name: 'GroupObject_0', members: [] }],
    triggers: [
      trig('hero in', {}, [['REGN', { rgn_guid: rg, obj_type: 'CHTR|', obj_owner: '0', obj_class: 'Cole_s0', obj_count: '>0' }]], [['VARS', { varname: 'in', operation: 'set', value: '1' }]]),
      trig('enemy gone', {}, [['REGN', { rgn_guid: rg, obj_type: 'CHTR|ANML|', obj_owner: '1', obj_count: '<1' }]], [['VARS', { varname: 'clear', operation: 'set', value: '1' }]]),
      trig('none left', {}, [['REGN', { obj_type: 'CHTR|', obj_owner: '2', obj_count: '<1' }], ['TIME', { duration: '3' }]], [['VARS', { varname: 'p2', operation: 'set', value: '1' }]], { expression: '1 && 2' }),
      trig('two', {}, [['REGN', { obj_owner: '0', obj_type: 'CHTR|', obj_count: '2' }]], [['VARS', { varname: 'two', operation: 'set', value: '1' }]]),
      trig('spawn', {}, [['TIME', { duration: '2' }]], [['SPGR', { group: grp, classes_0: 'aje_warrior 2 3|aje_archer 1 1|', owner: '1', pos: '50 50 0' }], ['TRIG', { guid: wave, state: '1' }], ['COBJ', { obj_name: 'aje_spearman', obj_owner: '1', obj_pos: '60, 60, 0', obj_level: '2' }]]),
      trig('wave dead', { enabled: false }, [['CKGR', { group_guid: grp, check_val: '<1' }]], [['VARS', { varname: 'wave', operation: 'set', value: '1' }]], { guid: wave }),
      trig('early wave check', {}, [['CKGR', { group_guid: grp, check_val: '<1' }]], [['VARS', { varname: 'early', operation: 'set', value: '1' }]]),
      trig('hero dead', {}, [['DEAD', { obj_type: 'CHTR|', obj_owner: '0', obj_class: 'Cole_s0' }]], [['GAOV', { reason: '_GAOV_hero' }]], { guid: dead }),
      trig('ghost dead', {}, [['DEAD', { obj_name: 'was_deleted_7', obj_guid: 'nope' }]], [['VARS', { varname: 'ghost', operation: 'set', value: '1' }]]),
      trig('ghost dying', {}, [['DYIN', { obj_name: 'was_deleted_7', obj_guid: 'nope' }]], [['VARS', { varname: 'ghost2', operation: 'set', value: '1' }]]),
      trig('warrior dying', {}, [['DYIN', { obj_name: 'hu_warrior_1', obj_guid: w1 }]], [['VARS', { varname: 'wdead', operation: 'set', value: '1' }]]),
      trig('cage gone', {}, [['DEAD', { obj_name: 'cage_0', obj_guid: cage }]], [['VARS', { varname: 'cage', operation: 'set', value: '1' }]]),
      trig('hp', {}, [['OBJP', { obj_class: 'Cole_s0', obj_owner: '0', attrib_name: 'hitpoints', attrib_value: '<35', attrib_max: 'maxhitpoints' }]], [['VARS', { varname: 'hurt', operation: 'set', value: '1' }]]),
      trig('lvl', {}, [['OBJP', { obj_class: 'Cole_s0', obj_owner: '0', attrib_name: 'level', attrib_value: '>1' }]], [['VARS', { varname: 'lvl', operation: 'set', value: '1' }]]),
      trig('walk on', {}, [['REGN', { rgn_guid: rg, obj_type: 'CHTR|', obj_owner: '0', obj_count: '>0' }]], [['ACDO', { from_condition: '0', action: 'WalkAction', additional_params: '[400 400 0] | 2' }]]),
    ],
    texts: { _GAOV_hero: 'A hero is dead!' },
  }));
  const C = G.campaign, W = G.world, v = (n) => C.variables.get(n), R = C.objects;
  const cole = R.byGuid(hero).entity;
  G.run(1);
  ok(v('early') === '1', 'CKGR <1 on an empty group is true as soon as it is enabled');
  ok(v('ghost') === '1' && v('ghost2') === undefined, 'DEAD on an object that never existed is true at once, DYIN never');
  ok(v('two') === '1' && v('in') === undefined && v('clear') === undefined && v('p2') === undefined, 'REGN: a bare count means >=; region and owner filters hold');
  G.run(3);
  ok(v('p2') === '1', 'REGN on the whole map ("no unit of player 2") combined with a TIME that has run out');
  ok(R.group(grp).size === 4 && W.units.filter((u) => u.owner === C.players[1]).length === 6, `SPGR creates the units into the group (${R.group(grp).size}), COBJ one more`);
  const made = R.group(grp).list();
  ok(made.filter((r) => r.entity.level === 2).length === 3 && made.filter((r) => r.entity.level === 1).length === 1 && W.units.find((u) => u.name === 'aje_spearman').level === 3, 'levels: SPGR 1-based, COBJ 0-based');
  ok(v('wave') === undefined, 'the "wave is dead" trigger enabled after the spawn waits');
  W.order([cole], { type: 'move', x: 320 - 256, z: 256 - 320 });
  G.run(60);
  ok(v('in') === '1', 'REGN: the hero walked into the region');
  ok(cole.goal && Math.abs(cole.goal[0] - 144) < 1 && Math.abs(cole.goal[1] + 144) < 1, 'from_condition: the action works on the objects its REGN condition found');
  for (const r of made) W.kill(r.entity);
  W.kill(W.units.find((u) => u.name === 'aje_warrior' && u.alive));
  G.run(1);
  ok(v('wave') === '1' && R.group(grp).size === 0, 'CKGR <1: the spawned group is dead (dead members leave the group)');
  ok(v('clear') === '1', 'REGN <1: no enemy left in the region');
  cole.hp = 30; cole.level = 3;
  G.run(0.5);
  ok(v('hurt') === '1' && v('lvl') === '1', 'OBJP: hit points in percent (attrib_max) and the 0-based level');
  C.remove(cage); W.kill(R.byGuid(w1).entity);
  G.run(0.2);
  ok(v('cage') === '1' && v('wdead') === '1', 'DEAD fires for deleted scenery, DYIN for a named unit that died');
  ok(!G.over, 'nobody lost yet');
  W.kill(cole);
  G.run(1);
  ok(!G.over && C.engine.ended && C.engine.ended.won === false, 'DEAD on the hero class -> GAOV: the defeat comes 4 s later');
  G.run(4);
  ok(G.over && G.endInfo.won === false && G.endInfo.text === 'A hero is dead!', 'GAOV: G.endMission(false) with the reason text');
  ok(C.errors.length === 0, 'no errors ' + JSON.stringify(C.errors));
}

// ---------------------------------------------------------------------------------------------- quests, sequences, dialogues, UI, players
{
  const q1 = guid('q'), q2 = guid('q'), qm = guid('o');
  const G = makeGame(mission({
    quests: [{ guid: q1, name: 'MQ01', main: true, bonus: { easy: 100, medium: 200, hard: 300 }, visible: false, accomplished: false, unaccomplishable: false, headline: 'First' },
      { guid: q2, name: 'SQ01', main: false, bonus: { easy: 1, medium: 2, hard: 3 }, visible: false, accomplished: false, unaccomplishable: false, headline: 'Side' }],
    question_marks: [{ guid: qm, name: 'questionmark_0', x: 10, y: 10 }],
    variables: { saved: { type: 'int', value: '2' }, max: { type: 'int', value: '6' } },
    sequences: { 'Cpn/x/intro.seq': { id: 'intro', file: true, lines: [{ speaker: 'cole', text: 'Hello' }], duration: 5 }, 'Cpn/x/outro.seq': { id: 'outro', file: true, lines: [], duration: 5 } },
    dialogs: { 'Cpn/x/ds_1.dlg': { id: 'ds_1', actors: {}, frames: [{ actor: 'Cole', text: 'Hi', speaker: 'Cole' }] } },
    texts: { _bar: 'Mammoths saved: %1 of %2', _tt: 'Talk to him' },
    triggers: [
      trig('intro', {}, [['TIME', { duration: '1' }]], [['SQNZ', { sequence: 'Cpn/x/intro.seq', snap_cam_back: '1' }]]),
      trig('after intro', {}, [['SQEN', { sequence_name: 'cpn/X/Intro.seq' }]], [['QUES', { quest_guid: q1, dest_state: '0' }], ['DGSC', { scene: 'Cpn/x/ds_1.dlg' }], ['QMRK', { questionmark: qm, questionstate: 'QM_STATE_YELLOW', questiontooltip: '_tt' }],
        ['MPNG', { pos: '[100 100 0]', pos_objquery_flag: '1', owner: 'All', id: '0007', colortype: 'SPMainQuest', time_to_life: '0', num_repeats: '0', extended: '1' }], ['INBA', { text: '_bar\t$(saved)\t$(max)' }],
        ['RSRC', { res_rsrclist: 'food|=500|0:wood|+50|0:iron|=5|0' }], ['PLCP', { player: '1', food: '2000', wood: '2000', stone: '2000' }], ['DIPL', { changes: '0|2|2\n2|2|0\n' }], ['BLSL', { open_1: '25', open_2: '15' }], ['POPL', { limit: '30' }], ['SNFA', { player: '1', neutral: '3' }],
        ['TECH', { filters: '0|1|/Filters/AntiActions/Hu/Build/CHTR/hu_archer\n0|1|/Filters/X\n0|0|/Filters/X\n' }], ['AIBV', { player_id: '1', behavior: 'Turtle' }], ['PSND', { soundname: 'cheer', player: '-1' }], ['FDBK', { msg_text: 'debug' }], ['WHAT', {}], ['ACDO', { action: 'Dance' }], ['OCPY', { obj_owner: '7', new_owner: 'x' }]]),
      trig('after dialog', {}, [['DSEN', { dlgscene_name: 'Cpn/x/ds_1.dlg' }]], [['VARS', { varname: 'saved', operation: '+', value: '1' }], ['QUES', { quest_guid: q1, dest_state: '1' }], ['QUES', { quest_name: 'SQ01', dest_state: '2' }]]),
      trig('q done', {}, [['QUES', { quest_guid: q1, dest_state: '1' }], ['QUES', { quest_guid: q2, dest_state: '2' }], ['WHO', {}]], [['MPNG', { id: '0007', add_remove: '1' }], ['INBA', {}], ['SQNZ', { sequence: 'Cpn/x/missing.seq' }], ['SQNZ', { sequence: 'Cpn/x/outro.seq', quit: '1' }]], { expression: '(1 && 2) || 3' }),
      trig('allied', {}, [['DIPL', { plyr1: '2', plyr2: '0', relation: '2' }]], [['VARS', { varname: 'allied', operation: 'set', value: '1' }]]),
      trig('rich', {}, [['PLYR', { attrib_name: 'food', attrib_value: '>=500' }]], [['VARS', { varname: 'rich', operation: 'set', value: '1' }]]),
      trig('tech', {}, [['TECH', { filter: 'Filters/AntiActions/Hu/Build/CHTR/hu_archer' }]], [['VARS', { varname: 'tech', operation: 'set', value: '1' }]]),
    ],
  }));
  const C = G.campaign, v = (n) => C.variables.get(n), M = G.mission, p0 = C.players[0];
  M.hold = true;
  G.run(2);
  ok(M.queue.length === 1 && M.log[0][0] === 'sequence' && M.log[0][1] === 'intro' && M.log[0][2].snapBack === true, 'SQNZ asks the mission UI for the sequence');
  ok(!C.data.quests[0].visible, 'nothing goes on before the sequence has ended');
  M.skipAll(); G.run(0.2);
  ok(C.data.quests[0].visible && M.log.some((l) => l[0] === 'quest' && l[1] === 'MQ01' && l[2] === 'shown'), 'SQEN (compared by file name, without case) -> QUES show -> questChanged');
  ok(M.log.some((l) => l[0] === 'dialog' && l[1] === 'ds_1'), 'DGSC asks the mission UI for the scene');
  ok(C.questionMarks[0].state === 'QM_STATE_YELLOW' && C.questionMarks[0].tooltip === 'Talk to him', 'QMRK sets state and tooltip');
  ok(M.markers.length === 1 && M.markers[0].id === '0007' && M.markers[0].kind === 'SPMainQuest' && M.markers[0].ttl === 0 && Math.abs(M.markers[0].x + 156) < 1e-6, 'MPNG adds a marker (game coordinates)');
  ok(M.bar === 'Mammoths saved: 2 of 6', `INBA: text with variables (${M.bar})`);
  ok(p0.res.food === 500 && p0.res.wood === 50 && p0.res.skulls === 5 && C.players[1].caps.food === 2000, 'RSRC list and PLCP');
  ok(p0.pyramid.join() === '25,15,0,0,0' && p0.popMax === 30 && C.players[1].animalsNeutral === 3, 'BLSL, POPL, SNFA');
  ok(p0.filters.has('AntiActions/Hu/Build/CHTR/hu_archer') && !p0.filters.has('X'), 'TECH enables and disables filters');
  ok(G.brains.get(1).behaviour === 'Turtle' && G.audio.played.includes('cheer'), 'AIBV reaches the brain, PSND the audio');
  G.run(1);
  ok(v('allied') === '1' && v('rich') === '1' && v('tech') === '1', 'DIPL, PLYR and TECH conditions');
  ok(C.warnings.some((w) => /WHAT/.test(w)) && C.warnings.some((w) => /WHO/.test(w)) && C.warnings.some((w) => /ACDO Dance/.test(w)) && C.errors.length === 0, 'unknown condition / action types: one warning each, nothing thrown');
  M.skipAll(); G.run(0.2);
  ok(v('saved') === '3' && M.bar === '', 'DSEN after the dialogue; INBA without text clears the bar');
  ok(C.data.quests[0].accomplished && C.data.quests[1].unaccomplishable && C.boni === 200, `QUES accomplished adds the bonus of the difficulty (${C.boni})`);
  ok(M.markers.length === 0, 'MPNG add_remove = 1 removes the marker');
  ok(M.queue.length === 1 && M.log.filter((l) => l[0] === 'sequence').length === 2 && !G.over, 'a sequence without a file ends at once; the next one waits for the UI');
  M.skipAll(); G.run(0.2);
  ok(G.over && G.endInfo.won === true, 'SQNZ quit = 1: the mission is won when the sequence ends');
}

// ---------------------------------------------------------------------------------------------- waypoints, orders, owners
{
  const g1 = guid('o'), u1 = guid('o'), u2 = guid('o'), u3 = guid('o'), gate = guid('o');
  const G = makeGame(mission({
    objects: [
      { guid: u1, name: 'aje_warrior_0', class: 'aje_warrior', type: 'CHTR', owner: 1, x: 100, y: 100 },
      { guid: u2, name: 'aje_warrior_1', class: 'aje_warrior', type: 'CHTR', owner: 1, x: 100, y: 110 },
      { guid: u3, name: 'hu_worker_0', class: 'hu_worker', type: 'CHTR', owner: 2, x: 300, y: 300, visible: false },
      { guid: gate, name: 'gate_0', class: 'hc_gate', type: 'DCCO', x: 200, y: 200 },
    ],
    groups: [{ guid: g1, name: 'GroupObject_0', members: [u1, u2] }],
    triggers: [
      trig('patrol', {}, [['TIME', { duration: '1' }]], [['WYPT', { obj_name: 'GroupObject_0', obj_guid: g1, waypoints: '120 100 0|120 120 0|0.0, 0.0, 0.0|100 120 0|', patrolmode: '0', walkspeed: '3' }]]),
      trig('arrived', { once: false }, [['WAYR', { obj_type: 'CHTR|', obj_owner: '1' }]], [['VARS', { varname: 'arrived', operation: '+', value: '1' }]]),
      trig('join', {}, [['TIME', { duration: '2' }]], [['OBAP', { obj_name: 'hu_worker_0', obj_guid: u3, flags: '7' }], ['OCPY', { obj_name: 'hu_worker_0', obj_guid: u3 }], ['ACDO', { obj_name: 'gate_0', obj_guid: gate, action: 'SetAnim', additional_params: 'open | 1' }],
        ['SFOW', { pos: '[0 0 0]', obj_name: 'hu_worker_0', obj_guid: u3, radius: '30', duration: '-1' }], ['SFOW', { pos: '[10 10 0]', radius: '50', duration: '20' }]]),
      trig('swap', {}, [['TIME', { duration: '30' }]], [['REPL', { obj_name: 'aje_warrior_0', obj_guid: u1, new_obj: 'aje_archer', obj_level: '1' }], ['DELO', { obj_owner: '1', obj_class: 'aje_warrior' }], ['ACDO', { obj_class: 'aje_archer', obj_owner: '1', action: 'SetPos', additional_params: '[300 300 0] | 2' }]]),
    ],
  }));
  const C = G.campaign, W = G.world, v = (n) => C.variables.get(n), R = C.objects;
  const a = R.byGuid(u1).entity, w = R.byGuid(u3).entity;
  G.run(1.5);
  ok(a.goal && Math.abs(a.goal[0] - (120 - 256)) < 1e-6 && a.task.type === 'attackmove', 'WYPT sends every member of the group to the first point');
  G.run(1);
  ok(w.owner === C.players[0] && !w.parked && R.byGuid(u3).visible, 'OBAP 7 + OCPY (no new_owner = the human player): a hidden unit appears and joins');
  ok(C.anims.some((x) => x[0] === 'gate_0' && x[1] === 'open'), 'ACDO SetAnim on scenery');
  ok(W.reveals.length === 2 && W.reveals[0].follow === w && W.reveals[1].s === 20, 'SFOW: a reveal that follows the object, and one at a position for 20 s');
  G.run(20);
  ok(v('arrived') === '2' && Math.abs(a.pos.x - (100 - 256)) < 1 && Math.abs(a.pos.z - (256 - 120)) < 1, `WYPT mode 0 walks the points once (zero entries skipped) and WAYR fires per unit (${v('arrived')})`);
  G.run(8);
  const arch = W.units.find((u) => u.alive && u.name === 'aje_archer');
  ok(arch && arch.level === 2 && arch.owner === C.players[1] && Math.abs(arch.pos.x - 44) < 1 && !W.units.some((u) => u.alive && u.name === 'aje_warrior'), 'REPL keeps place and owner, DELO deletes, SetPos teleports');
  ok(C.errors.length === 0, 'no errors ' + JSON.stringify(C.errors));
}

// ---------------------------------------------------------------------------------------------- the real missions (if the dumps are there)
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = process.argv[2] || process.env.PW_CPN || path.join(here, '..', '..', '_notes', 'cpn');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^single_\d+\.json$/.test(f)).sort() : [];
  if (!files.length) console.log('   (no mission dumps in ' + dir + ': part 2 skipped)');
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    let G, err = null;
    const t0 = Date.now();
    try { G = makeGame(data, { id: +f.match(/\d+/)[0] }); G.run(120); } catch (e) { err = e; }
    if (err) { ok(false, `${f}: ${err.stack || err}`); continue; }
    const C = G.campaign, S = C.debug.summary();
    const unk = [...S.unknownConditions, ...S.unknownActions];
    ok(!unk.length && !C.errors.length, `${f}: ${S.triggers} triggers, ${S.firedTriggers} fired in 2 min (${S.firings} firings, ${S.actions} actions), unknown types: ${unk.join(' ') || '-'}, errors: ${C.errors.length}, ${Date.now() - t0} ms`);
    for (const e of C.errors.slice(0, 5)) console.log('     error:', JSON.stringify(e));
  }
}
// ---------------------------------------------------------------------------------------------- the Arena to the end (mock world)
{
  const here = path.dirname(fileURLToPath(import.meta.url));
  const f = path.join(process.argv[2] || process.env.PW_CPN || path.join(here, '..', '..', '_notes', 'cpn'), 'single_11.json');
  if (fs.existsSync(f)) {
    const G = makeGame(JSON.parse(fs.readFileSync(f, 'utf8')), { id: 11 });
    const C = G.campaign, W = G.world, me = C.players[0], born = new Map();
    // the "player": everything that entered the arena dies 5 s later; the boss is only brought below 20 %
    for (let s = 0; s < 3000 && !G.over; s++) {
      G.run(1);
      for (const u of W.units) {
        if (!u.alive || !u.owner || u.owner === me) continue;
        if (!born.has(u)) born.set(u, W.time);
        if (W.time - born.get(u) < 5) continue;
        if (u.name === 'arena_atroxosaurus') { if (u.hp > 15) u.hp = 15; } else W.kill(u);
      }
    }
    const seq = G.mission.log.filter((l) => l[0] === 'sequence').map((l) => l[1]).join(' ');
    ok(G.over && G.endInfo.won === true && C.debug.quests().every((q) => q.accomplished) && seq === 'ms_4010 sc_4009 ms_4015' && C.boni === 6000 && C.errors.length === 0,
      `mission 11 in the mock world: all waves, three quests, sequences ${seq}, QUIT after ${Math.round(W.time / 60)} game minutes (${C.debug.summary().firedTriggers} triggers fired)`);
  }
}
console.log(fails ? `FAILED: ${fails}` : 'all ok');
process.exit(fails ? 1 : 0);
