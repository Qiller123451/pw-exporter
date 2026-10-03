// Campaign world setup (run with tests/evaljs.py tests/campaign_load.js "&campaign=11", any mission 0-16):
// the players and their diplomacy, every placed object against the mission data, names / GUIDs / groups / regions,
// the object query, the World scripting API, and 30 s of simulation without the skirmish end rule.
const W = G.world, C = G.campaign, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
if (!C) { check('campaign loaded', false, G.error || 'G.campaign missing'); return out.join('\n'); }
const D = C.data, R = C.objects;
const UNIT = new Set(['CHTR', 'ANML', 'VHCL', 'SHIP']);
try {
check('mission ' + C.id + ' ' + C.map.title, C.id === G.config.campaign && !!C.map.title, { difficulty: C.difficulty, counts: C.counts });

// ---------------------------------------------------------------- players
const present = D.players.filter((p) => p.present);
check('players of the data', W.players.length === present.length && present.every((p) => C.players[p.id] && C.players[p.id].tribe === (p.tribe || '')), W.players.map((p) => p.id + ':' + p.tribe));
check('human player is G.me, no G.ai', G.me === C.human && G.me === C.players[present.find((p) => p.type === 'human').id] && G.ai === null && !G.me.ai, G.me.name);
check('brains: one sleeping brain per computer slot', G.brains instanceof Map && G.aiBrain == null && !G.brains.has(G.me.id) && [...G.brains.values()].every((b) => b.paused), G.brains.size);
let relBad = 0;
for (const a of present) for (const b of present) if (a !== b && C.players[a.id].relation(C.players[b.id]) !== a.diplomacy[b.id]) relBad++;
check('diplomacy matrix as in the data (one direction per pair)', relBad === 0, relBad);
const hostile = present.filter((p) => p.id !== G.me.id && G.me.isEnemy(C.players[p.id])).length, neutral = present.filter((p) => p.id !== G.me.id && G.me.isNeutral(C.players[p.id])).length;
check('relations of the human player', hostile + neutral + present.filter((p) => p.id !== G.me.id && G.me.isFriend(C.players[p.id])).length === present.length - 1, { hostile, neutral });
check('limits of the level', present.every((p) => { const P = C.players[p.id]; return (p.population_limit ? P.popMax === p.population_limit : P.popMax === 52) && (P.pyramid || G.data.pyramid).every((v, i) => v === (p.unit_limits[i].max != null ? p.unit_limits[i].max : G.data.pyramid[i])); }));
check('start tech filters enabled', present.every((p) => p.tech_filters.every((f) => !G.data.base.filter(f) || W.hasFilter(C.players[p.id], f))), present.map((p) => p.tech_filters.length));

// ---------------------------------------------------------------- objects against the data
const missing = new Set(C.warnings.filter((w) => /no model|not created|not loaded/.test(w) && !/shown as/.test(w)).map((w) => w.split(/[ :]/)[0]));
const exp = { CHTR: 0, ANML: 0, VHCL: 0, SHIP: 0, BLDG: 0 }, got = { CHTR: 0, ANML: 0, VHCL: 0, SHIP: 0, BLDG: 0 };
let unplaced = [], wrongOwner = 0, wrongLevel = 0, far = 0;
for (const o of D.objects) {
  const rule = C.ruleClass(o.class), ix = rule && G.data.info(rule);
  const isUnit = ix && UNIT.has(ix.type) && UNIT.has(o.type), isB = ix && ix.type === 'BLDG' && o.type === 'BLDG' && o.owner != null && C.players[o.owner];
  if (!isUnit && !isB) continue;
  if (missing.has(o.class)) continue;
  exp[o.type]++;
  const rec = R.byGuid(o.guid);
  const e = rec && rec.entity;
  if (!e || !e.alive) { unplaced.push(o.name); continue; }
  got[o.type]++;
  if ((e.owner ? e.owner.id : null) !== (o.owner != null && C.players[o.owner] ? o.owner : null)) wrongOwner++;
  if (isUnit && e.level !== Math.max((o.level || 0) + 1, G.data.minLevel(rule, e.owner)) && G.data.stats(rule, (o.level || 0) + 1, e.owner).exists) wrongLevel++;
  const [x, z] = C.toGame(o.x, o.y);
  if (!e.inside && Math.hypot((isB ? e.origin.x : e.pos.x) - x, (isB ? e.origin.z : e.pos.z) - z) > (isB ? 0.5 : 30)) far++;
}
for (const t in exp) check(`placed ${t}`, exp[t] === got[t], { data: exp[t], world: got[t] });
check('every unit / building of the data has its object', unplaced.length === 0, unplaced.slice(0, 8));
check('owners, levels, positions as in the data', wrongOwner === 0 && wrongLevel === 0 && far === 0, { wrongOwner, wrongLevel, far });
const propsExp = C.plans.filter((p) => p.kind === 'prop').length;
check('scenery objects (props)', C.counts.props + C.warnings.filter((w) => /model not loaded/.test(w)).length >= propsExp && C.props.length === C.counts.props, { props: C.counts.props, planned: propsExp });
check('nothing unknown: only missing models are reported', C.warnings.every((w) => /no model|not loaded|not created|^data:/.test(w)), C.warnings);
const hidden = D.objects.filter((o) => o.visible === false && R.byGuid(o.guid) && (R.byGuid(o.guid).entity || R.byGuid(o.guid).prop));
check('objects hidden in the data are out of the world', hidden.every((o) => { const r = R.byGuid(o.guid); return !r.visible && (r.entity ? r.entity.parked : !r.prop.obj.visible); }), hidden.length);

// ---------------------------------------------------------------- names, GUIDs, handles, groups
let refBad = [], refN = 0;
for (const g in D.refs) {
  const [kind, name] = D.refs[g];
  if (['trigger', 'quest', 'region', 'missing', 'QMRK'].includes(kind)) continue;
  const o = D.objects.find((x) => x.guid === g) || D.objects.find((x) => x.name === name);
  if (!o || missing.has(o.class) || C.plans.find((p) => p.o === o).kind === 'part') continue;
  refN++;
  const rec = R.byGuid(g) || R.byName(name);
  if (!rec || rec !== R.get(rec.name) || (o.handle && R.byHandle(o.handle[0], o.handle[1]) !== rec) || R.byIndex(o.index) !== rec) refBad.push(name);
}
check('objects named by triggers resolve (GUID, name, handle, index)', refBad.length === 0, { refs: refN, bad: refBad.slice(0, 6) });
check('groups', C.groups.length === D.groups.length && D.groups.every((g) => { const G2 = R.group(g.guid); return G2 && G2.name === g.name && R.group(g.name) && G2.size === g.members.filter((m) => R.byGuid(m)).length; }), C.groups.length);
check('question marks', C.questionMarks.length === D.question_marks.length && C.questionMarks.every((q) => q.state === 'STATE_INVISIBLE' || !!q.state), C.questionMarks.length);
check('level variables', C.variables.size === Object.keys(D.variables).length && C.variables.has('_Internal_NumPlayers'), C.variables.size);
const anyUnit = W.units.find((u) => u.alive && u.rec);
check('every world entity has a record', W.units.every((u) => !u.alive || (u.rec && R.of(u) === u.rec)) && W.buildings.every((b) => !b.alive || b.rec), anyUnit && anyUnit.rec.name);

// ---------------------------------------------------------------- regions
check('regions', C.regions.list.length === D.regions.length && C.regions.get('UniqueWorldRegion').world && C.regions.get('nope').contains(1e6, 0), D.regions.length);
let rgBad = 0, rgN = 0;
for (const r of C.regions.list) {
  const s = r.shapes.find((x) => x.enabled);
  if (!s) { const d = r.data.shapes[0]; if (d && r.contains(...C.toGame(d.x + d.w / 2, d.y + d.h / 2))) rgBad++; continue; }
  rgN++;
  const [cx, cz] = C.toGame(s.x + s.w / 2, s.y + s.h / 2), [fx, fz] = C.toGame(r.bbox[0] - 5, r.bbox[1] - 5);
  const [ex, ez] = C.toGame(s.x + s.w * 0.02, s.y + s.h * 0.02);          // a corner: inside a rectangle, outside an oval
  const single = r.shapes.filter((x) => x.enabled).length === 1;        // (in a union another shape may cover the corner)
  if (!r.contains(cx, cz) || r.contains(fx, fz) || (single && r.contains(ex, ez) !== !s.oval) || !C.regions.at(cx, cz).includes(r) || C.regions.find(r.guid) !== r || C.regions.get(r.name) == null) rgBad++;
}
check('region point tests (centre in, outside out, oval corners out)', rgBad === 0, { tested: rgN, bad: rgBad });
if (C.regions.list.length) {
  const r = C.regions.list.find((x) => x.shapes.some((s) => s.enabled)) || C.regions.list[0], s0 = r.shapes.find((s) => s.enabled);
  const c = s0 ? C.toGame(s0.x + s0.w / 2, s0.y + s0.h / 2) : null;
  r.setEnabled(false); const off = c ? r.contains(c[0], c[1]) : false; r.setEnabled(true);
  check('region switched off contains nothing', !off && (!c || r.contains(c[0], c[1])), r.name);
}
const m2g = C.toGame(100, 50), g2m = C.toMap(m2g[0], m2g[1]), v = C.vec('[100 50 7]');
check('coordinates map <-> game', Math.abs(g2m[0] - 100) < 1e-6 && Math.abs(g2m[1] - 50) < 1e-6 && v.x === m2g[0] && v.z === m2g[1] && C.vec('0, 0, 0').zero && C.vec('x') === null, m2g);

// ---------------------------------------------------------------- start location, start army, camera
const hp = D.players[G.me.id], sl = C.startLocations[G.me.id];
check('start location and camera of the human player', !hp.start_location || (sl && Math.abs(G.rtscam.x - sl.x) < 1 && Math.abs(G.rtscam.z - sl.z) < 1), sl && [Math.round(sl.x), Math.round(sl.z)]);
if (hp.start_location && !hp.start_location.ignore_pointbuy && hp.start_army.length) {
  const want = {}, have = {};
  for (const a of hp.start_army) want[a.class] = (want[a.class] || 0) + 1;
  for (const u of W.units) if (u.alive && u.owner === G.me && !u.rec.data && want[u.name]) have[u.name] = (have[u.name] || 0) + 1;
  const uniq = (c) => (G.data.def(c, G.me) || {}).unique;
  check('start army around the start location', Object.keys(want).every((c) => missing.has(c) || have[c] === want[c] || (uniq(c) && W.units.some((u) => u.alive && u.owner === G.me && u.name === c))), { want, have });
}
check('own units are visible, the fog is up', W.units.filter((u) => u.alive && u.owner === G.me && !u.parked && !u.inside).every((u) => u.obj.visible) && typeof G.sees === 'function' && G.sees(G.me), null);

// ---------------------------------------------------------------- the object query (triggers.md §2)
const mine = R.select({ obj_type: 'CHTR|ANML|VHCL|', obj_owner: String(G.me.id) });
check('select by type and owner', mine.length === W.units.filter((u) => u.alive && u.owner === G.me && !u.parked && ['CHTR', 'ANML', 'VHCL'].includes(u.cls)).length + W.units.filter((u) => u.alive && u.owner === G.me && u.parked && ['CHTR', 'ANML', 'VHCL'].includes(u.cls)).length && mine.every((r) => r.slot === G.me.id), mine.length);
const one = mine[0] || R.all.find((r) => r.entity);
if (one) {
  const byName = R.select({ obj_name: one.name, obj_guid: one.guid || 'NA', obj_type: 'BLDG|', obj_owner: '5' });
  check('select by name ignores the filters', byName.length === 1 && byName[0] === one, one.name);
  const [ox, oz] = R.posOf(one);
  const here = C.regions.at(ox, oz)[0];
  if (here) check('select in a region', R.select({ obj_class: one.cls, rgn_guid: here.guid }).includes(one) && R.inRegion(one, here), here.name);
  check('class filter, exclude_class, matches()', R.select({ obj_class: one.cls, obj_owner: String(one.slot) }).includes(one) && !R.select({ obj_owner: String(one.slot), exclude_class: one.cls + '|' }).includes(one) && R.matches(one, { obj_class: one.cls }) && !R.matches(one, { obj_type: 'AllNC|' }) && R.matches(one, { obj_type: 'All|' }), one.cls);
}
check('All without owner and class = units and buildings', R.select({}).every((r) => !!r.entity), R.select({}).length);
const grp = C.groups[0];
if (grp && one) {
  const was = one.group;
  R.addToGroup(grp, one);
  const sel = R.select({ obj_name: grp.name, obj_guid: grp.guid });
  check('a group named in a query = its members', sel.includes(one) && one.group === grp && !R.matches(one, { obj_name: grp.name, obj_guid: grp.guid }), grp.name);
  R.removeFromGroup(one); if (was) R.addToGroup(was, one);
}

// ---------------------------------------------------------------- World scripting API
const events = [];
const offs = ['spawned', 'removed', 'owner', 'group', 'diplomacy'].map((t) => [t, C.on(t, (a) => events.push(t))]);
const other = W.players.find((p) => p !== G.me);
const cls = ({ Hu: 'hu_worker', Aje: 'aje_worker', Ninigi: 'ninigi_worker', SEAS: 'seas_worker' })[G.me.tribe] || 'hu_worker';
const [mx, my] = C.toMap(sl ? sl.x + 6 : 0, sl ? sl.z + 6 : 0);
const rec = C.spawn(cls, G.me.id, mx, my, { level0: 0, name: 'test_worker', group: grp });
check('spawn by class for a player', !!rec && rec.entity && rec.entity.alive && rec.entity.owner === G.me && R.byName('test_worker') === rec && rec.type === 'CHTR' && (!grp || rec.group === grp), rec && rec.name);
if (rec) {
  const u = rec.entity, units0 = G.me.units;
  check('run-time names <class>_<n>', /_\d+$/.test(C.spawn(cls, G.me.id, mx + 2, my, {}).name), R.all[R.all.length - 1].name);
  W.setHp(u, 7); W.setInvulnerable(u, true);
  W.takeDirectDmg(u, 50, 0, null, true, null);
  const inv = u.hp === 7;
  W.setInvulnerable(u, false); W.takeDirectDmg(u, 2, 0, null, true, null);
  check('setHp, setInvulnerable', inv && u.hp < 7 && u.alive, u.hp);
  check('setLevel', W.setLevel(u, 2) && (u.level === 2 || !G.data.stats(cls, 2, G.me).exists) && u.hp === u.maxHp, u.level);
  const [tx, tz] = C.toGame(mx + 10, my + 4);
  C.teleport(rec, mx + 10, my + 4);
  check('teleport', Math.hypot(u.pos.x - tx, u.pos.z - tz) < 12 && u.task.type === 'idle', [Math.round(u.pos.x - tx), Math.round(u.pos.z - tz)]);
  if (other) {
    C.setOwner(rec, other.id); G.step(1, 0.05);
    check('setOwner', u.owner === other && rec.slot === other.id && G.me.units === units0 && events.includes('owner') && u.alive, other.name);
    // diplomacy: nobody attacks a neutral or friendly player on its own; an attack order on a neutral means war
    W.setDiplomacy(G.me, other, 1, true);
    const mineU = C.spawn(cls, G.me.id, mx + 12, my + 4, {}).entity;
    check('neutral: not an enemy, order allowed', !mineU.isEnemy(u) && !W.canTarget(mineU, u) && W.attackAllowed(mineU, u) && G.me.isNeutral(other), null);
    W.setDiplomacy(G.me, other, 2, false);
    W.order([mineU], { type: 'attack', target: u });
    check('friend: an attack order is refused', !W.attackAllowed(mineU, u) && mineU.task.type !== 'attack' && G.me.isFriend(other) && other.isNeutral(G.me), mineU.task.type);
    W.setDiplomacy(G.me, other, 1, true);
    W.order([mineU], { type: 'attack', target: u });
    const tt = mineU.task.type;
    G.step(1, 0.05);                                 // world events reach the campaign's listeners with the next step
    check('attack order on a neutral: both hostile', G.me.isEnemy(other) && other.isEnemy(G.me) && tt === 'attack' && events.includes('diplomacy'), tt);
    W.order([mineU], { type: 'stop' });
    C.remove(mineU.rec);
  }
  const lostBefore = (u.owner || G.me).lost;
  C.setAppearance(rec, 0);
  check('setAppearance 0: out of the world', u.parked && !rec.visible && u.untargetable && u.alive, null);
  C.setAppearance(rec, 7);
  check('setAppearance 7: back', !u.parked && rec.visible && !u.untargetable, null);
  C.remove(rec); G.step(1, 0.05);
  check('remove: gone without death', !u.alive && !rec.alive && R.byName('test_worker') === null && !R.all.includes(rec) && events.includes('removed') && (u.owner || G.me).lost === lostBefore && (!grp || !grp.members.has(rec)), null);
}
const res0 = { ...G.me.res };
W.setResource(G.me, 'food', '+50'); W.setResource(G.me, 'wood', '=10'); W.setResource(G.me, 'stone', '-99999'); W.setResource(G.me, 'iron', '25');
check('setResource + = - and iron', G.me.res.food === res0.food + 50 && G.me.res.wood === 10 && G.me.res.stone === 0 && G.me.res.skulls === 25, G.me.res);
W.setCaps(G.me, { food: 1234, wood: 99, stone: 5 }); W.recomputeCaps(G.me);
W.setResource(G.me, 'wood', '+500', true);
check('setCaps fixes the storage', G.me.caps.food === 1234 && G.me.caps.stone === 5 && G.me.capsFixed && G.me.res.wood === 99, G.me.caps);
const filt = '/Filters/AntiActions/Hu/Build/CHTR/hu_archer';
const had = W.hasFilter(G.me, filt);
W.setFilter(G.me, filt, true); const on = W.hasFilter(G.me, filt); W.setFilter(G.me, filt, false);
check('setFilter / hasFilter', had || (on && !W.hasFilter(G.me, filt)), { had, on });
if (had) W.setFilter(G.me, filt, true);
const h = W.revealArea(G.me, 40, 40, 25, 0);
const seen = W.revealsFor(G.sees).some((r) => r[0] === 40 && r[2] === 25);
W.hideArea(h);
check('revealArea / hideArea', seen && !W.revealsFor(G.sees).some((r) => r[0] === 40 && r[2] === 25), null);
for (const [t, fn] of offs) C.off(t, fn);

// ---------------------------------------------------------------- 30 s of simulation, no skirmish end rule, mission end
let err = null;
try { G.step(120, 0.25); } catch (e) { err = String((e && e.stack) || e).slice(0, 400); }
check('30 s of simulation', !err && !G.error && W.time > 29, err || Math.round(W.time));
check('no skirmish end rule: the mission goes on', !G.over && W.players.every((p) => !p.won), null);
check('mission UI stub and campaign hooks', !!G.mission && typeof G.mission.tick === 'function' && C.timers instanceof Map && typeof C.needClass === 'function' && C.needClass(cls), null);
G.endMission(true, { text: 'done', delay: 0 });
check('G.endMission ends the mission', G.over && G.endInfo.won && G.menuOpen && (C.id === 16 ? !C.next() : C.next().id === C.id + 1) && /Victory/.test(document.querySelector('.pwwin').textContent) && (C.id === 16 || /Next mission/.test(document.querySelector('.pwwin').textContent)), C.next() && C.next().id);
} catch (e) { check('the test ran without an exception', false, String((e && e.stack) || e).slice(0, 500)); }
return out.join('\n') + '\nwarnings: ' + JSON.stringify(C.warnings) + '\ncounts: ' + JSON.stringify(C.counts);
