// A minimal stand-in for the game around the trigger engine (node, no browser): a Campaign with the real object
// registry and regions, a world that only keeps positions, owners and hit points, a mission UI that records what it
// is asked. Used by tests/campaign_engine.mjs; the real thing is src/game/campaign/setup.js + the World.
import { Registry, Rec, Group } from '../src/game/campaign/registry.js';
import { Regions } from '../src/game/campaign/regions.js';
import { TriggerEngine } from '../src/game/campaign/engine.js';

const UNIT_TYPES = new Set(['CHTR', 'ANML', 'VHCL', 'SHIP']);

class MockPlayer {
  constructor(id, d = {}) {
    this.id = id; this.slot = id; this.tribe = d.tribe || 'Hu'; this.data = d; this.ai = id !== 0;
    this.rel = (d.diplomacy || []).slice(); this.res = { food: 0, wood: 0, stone: 0, skulls: 0 }; this.caps = { food: 300, wood: 300, stone: 300 };
    this.units = 0; this.atLevel = [0, 0, 0, 0, 0]; this.popMax = 52; this.pyramid = null; this.filters = new Set(); this.animalsNeutral = 0;
  }
  relation(p) { if (p === this) return 2; const r = this.rel[p.id]; return r == null ? 1 : r; }
  setRelation(p, r) { this.rel[p.id] = r; }
  isEnemy(p) { return this.relation(p) === 0; }
  isFriend(p) { return this.relation(p) === 2; }
}

class MockWorld {
  constructor(C) { this.C = C; this.time = 0; this.units = []; this.buildings = []; this.events = []; this.orders = []; this.reveals = []; this.nextId = 1; }
  emit(type, data) { this.events.push({ type, ...data }); }
  make(cls, type, owner, x, z, level = 1) {
    const kind = type === 'BLDG' ? 'building' : 'unit';
    const e = { id: this.nextId++, kind, name: cls, cls: type, owner, alive: true, pos: { x, y: 0, z }, hp: 100, maxHp: 100, level, radius: 1, heading: 0, task: { type: 'idle' }, built: true, stance: 2, countsInPop: true, passengers: null, stats: { sight: 25 },
      invulnT: 0, isWorker: /_worker$/.test(cls), path: [], def: { aggressive: /Dilo|Smilodon|raptor|Allo|Tyranno|Bary|arena_/i.test(cls) ? 1 : 0, gate: /gate/.test(cls) },
      // the world's rule: players' relations; the wild against everybody who has an owner
      isEnemy(o) { if (!o || !o.alive || o === this) return false; if (!this.owner || !o.owner) return !!(this.owner || o.owner); return this.owner.isEnemy(o.owner); },
      distTo(o) { return Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z); } };
    (kind === 'unit' ? this.units : this.buildings).push(e);
    if (owner && kind === 'unit') { owner.units++; owner.atLevel[level - 1]++; }
    if (this.onEntity) this.onEntity(e);
    return e;
  }
  order(units, o) { for (const u of units) { if (!u.alive || u.parked) continue; this.orders.push([u, o]); u.task = o.type === 'stop' ? { type: 'idle' } : { ...o }; u.chase = o.type === 'attack' ? o.target : null; if (o.type === 'move' || o.type === 'attackmove') u.goal = [o.x, o.z]; else if (o.type === 'stop') u.goal = null; } }
  kill(e) { if (!e.alive) return; e.alive = false; e.hp = 0; if (e.owner && e.kind === 'unit') { e.owner.units--; e.owner.atLevel[e.level - 1]--; } this.emit(e.kind === 'unit' ? 'died' : 'destroyed', { entity: e }); }
  removeEntity(e) { if (!e.alive) return; e.alive = false; this.emit('removed', { entity: e }); }
  setHp(e, hp) { if (hp <= 0) this.kill(e); else e.hp = Math.min(e.maxHp, hp); }
  setOwner(e, p) { const from = e.owner; e.owner = p; this.emit('owner', { entity: e, from, to: p }); return true; }
  setInvulnerable(e, v) { e.invulnerable = !!v; e.invulnT = v ? 1e12 : 0; }
  setParked(e, v) { e.parked = !!v; }
  teleport(e, x, z) { e.pos.x = x; e.pos.z = z; e.task = { type: 'idle' }; return true; }
  setDiplomacy(a, b, rel) { a.setRelation(b, rel); this.emit('diplomacy', { a, b, rel }); }
  setResource(p, res, mod) { const r = res === 'iron' ? 'skulls' : res; const m = String(mod), n = parseInt(m.replace(/^[+=]/, ''), 10) || 0; p.res[r] = Math.max(0, m[0] === '+' || m[0] === '-' ? p.res[r] + n : n); }
  setCaps(p, c) { for (const k in c) if (c[k] != null) p.caps[k] = +c[k]; }
  setFilter(p, path, v) { const f = String(path).replace(/^\/?Filters\//, ''); if (v) p.filters.add(f); else p.filters.delete(f); }
  hasFilter(p, path) { return p.filters.has(String(path).replace(/^\/?Filters\//, '')); }
  revealArea(p, x, z, r, s, follow) { const h = { p, x, z, r, s, follow, alive: true }; this.reveals.push(h); return h; }
  hideArea(h) { h.alive = false; }
  setAggro(units, s) { for (const u of units) u.stance = s; }
  setGate(b, s) { b.gateState = s; }
  capacity(t) { return t.cap || 0; }
  canBoard(u, t) { return u.owner === t.owner; }
  enterTransport(u, t) { (t.passengers = t.passengers || []).push(u); u.inside = t; this.emit('boarded', { unit: u, transport: t }); }
  unloadAll(t) { for (const u of t.passengers || []) u.inside = null; t.passengers = []; }
  leaveTransport(u) { const t = u.inside; if (t) t.passengers = t.passengers.filter((x) => x !== u); u.inside = null; }
  height() { return 0; }
  // walking: units move 6 m/s towards their goal
  update(dt) {
    this.time += dt;
    for (const u of this.units) {
      // an attack order: walk up to the target (the mock has no fights)
      if (u.alive && u.chase) { if (u.chase.alive) { const d = Math.hypot(u.chase.pos.x - u.pos.x, u.chase.pos.z - u.pos.z); u.goal = d > 4 ? [u.chase.pos.x, u.chase.pos.z] : null; } else { u.chase = null; u.goal = null; u.task = { type: 'idle' }; } }
      if (!u.alive || !u.goal || u.parked) continue;
      const dx = u.goal[0] - u.pos.x, dz = u.goal[1] - u.pos.z, d = Math.hypot(dx, dz), s = 6 * dt;
      if (d <= s) { u.pos.x = u.goal[0]; u.pos.z = u.goal[1]; u.goal = null; if (!u.chase) u.task = { type: 'idle' }; } else { u.pos.x += dx / d * s; u.pos.z += dz / d * s; }
    }
  }
}

class MockUI {
  constructor() { this.log = []; this.queue = []; this.markers = []; this.bar = ''; this.hold = false; }
  questChanged(q, change) { this.log.push(['quest', q.name, change]); }
  infoBar(t) { this.bar = t; }
  marker(m) { this.markers.push(m); }
  removeMarker(id) { this.markers = this.markers.filter((m) => m.id !== id); }
  playDialog(scene, onEnd) { this.log.push(['dialog', scene && scene.id]); this.queue.push({ kind: 'dialog', onEnd }); }
  playSequence(seq, opts, onEnd) { this.log.push(['sequence', seq ? seq.id : null, opts]); this.queue.push({ kind: 'sequence', onEnd }); }
  busy() { return this.queue.some((q) => q.kind === 'sequence'); }
  tick() { if (!this.hold) this.skipAll(); }
  skipAll() { const q = this.queue; this.queue = []; for (const e of q) e.onEnd(); }
}

class MockBrain {
  constructor(p) { this.p = p; this.calls = []; }
  setBehaviour(n, m) { this.calls.push(['behaviour', n, m]); this.behaviour = n; return true; }
  startAttack(o) { this.calls.push(['attack', o.type, o.targets.length, o]); return 1; }
  startAutoAttack(o) { this.calls.push(['auto', o.targets.length]); return 1; }
  setDefenceArea(...a) { this.calls.push(['area', ...a]); }
  lockUnits(u, l) { this.calls.push(['lock', u.length, l]); }
  setRegionMap(...a) { this.calls.push(['region', ...a]); }
  callModule(...a) { this.calls.push(['module', ...a]); }
  update() {}
}

// data = a mission JSON (pw-campaign/1). opts: { difficulty, place: false = no objects in the world }
export function makeGame(data, opts = {}) {
  const size = [data.map && data.map.width ? data.map.width : 512, data.map && data.map.height ? data.map.height : 512];
  const G = { over: false, ended: [], brains: new Map(), mission: new MockUI(), audio: { played: [], play(n) { this.played.push(n); } }, config: {}, rtscam: { x: 0, z: 0, yaw: 0, dist: 70 }, sel: new Set() };
  G.endMission = (won, info = {}) => { if (G.over) return; G.over = true; G.endInfo = { won: !!won, text: info.text || '' }; G.ended.push(G.endInfo); };
  const C = {
    G, data, id: opts.id || 0, difficulty: opts.difficulty == null ? 1 : opts.difficulty, map: data.map || {},
    players: [null, null, null, null, null, null, null, null], groups: [], questionMarks: [], variables: new Map(), timers: new Map(), warnings: [], errors: [], props: [],
    listeners: new Map(), ox: size[0] / 2, oy: size[1] / 2, evAt: 0,
    on(t, fn) { if (!this.listeners.has(t)) this.listeners.set(t, []); this.listeners.get(t).push(fn); return fn; },
    off(t, fn) { const l = this.listeners.get(t); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(t, ...a) { const l = this.listeners.get(t); if (l) for (const fn of l.slice()) fn(...a); },
    toGame(mx, my) { return [mx - this.ox, this.oy - my]; },
    toMap(x, z) { return [x + this.ox, this.oy - z]; },
    vec(s) {
      const m = String(s == null ? '' : s).match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi);
      if (!m || m.length < 2) return null;
      const mx = +m[0], my = +m[1], mz = m.length > 2 ? +m[2] : 0;
      const [x, z] = this.toGame(mx, my);
      return { x, z, mx, my, mz, zero: mx === 0 && my === 0 && mz === 0 };
    },
    heading(r) { return +r || 0; },
    player(s) { return s >= 0 && s < 8 ? this.players[s] : null; },
    text(k) { const t = data.texts || {}; return k in t ? t[k] : k; },
    warn(m) { if (!this.warnings.includes(m)) this.warnings.push(m); },
    typeOf(cls) { const l = String(cls).toLowerCase(); return opts.types && opts.types[l] ? opts.types[l] : /^hc_|gate|cage|barricade|stone|debris|bridge|wall|tree|item|flag|fx_/.test(l) ? 'DCCO' : /fireplace|tower|house|hut|tent|barracks|farm|harbour|headquarters|temple|pit|camp$|collector|bunker/.test(l) ? 'BLDG' : /saurus|raptor|mammoth|smilodon|eusmilus|rhino|boar|dino|ceratops|pteranodon|turtle|wolf|bear|tiger|gallimimus|baryonyx|stygimoloch|polakanthus/.test(l) ? 'ANML' : /ship|boat|hovercraft|carrier/.test(l) ? 'SHIP' : 'CHTR'; },
    spawn(cls, slot, mx, my, o = {}) {
      const type = this.typeOf(cls), [x, z] = this.toGame(mx, my);
      let rec;
      if (type === 'DCCO' || (type === 'BLDG' && !this.player(slot))) {
        rec = new Rec({ name: o.name || this.objects.newName(cls), cls, type: 'DCCO', slot: slot == null ? -1 : slot, x: mx, y: my });
        this.objects.add(rec); this.emit('spawned', rec);
      } else {
        const pre = new Rec({ name: o.name || this.objects.newName(cls), cls, type });
        this.pending = pre;
        this.world.make(cls, type, this.player(slot), x, z, o.level != null ? o.level : o.level0 != null ? o.level0 + 1 : 1);
        this.pending = null;
        rec = pre;
      }
      if (rec && o.group) this.objects.addToGroup(o.group, rec);
      return rec;
    },
    remove(ref) { const rec = this.objects.get(ref); if (!rec) return false; if (rec.entity) { rec.entity.alive = false; } this.objects.drop(rec); return true; },
    setOwner(ref, slot) { const rec = this.objects.get(ref); if (!rec) return false; const p = this.player(slot); if (rec.entity) { const from = rec.entity.owner; rec.entity.owner = p; this.emit('owner', rec, from, p); return true; } const from = rec.owner; rec._slot = p ? p.id : -1; this.emit('owner', rec, from, p); return true; },
    teleport(ref, mx, my) { const rec = this.objects.get(ref); if (!rec) return false; const [x, z] = this.toGame(mx, my); if (rec.entity) { rec.entity.pos.x = x; rec.entity.pos.z = z; rec.entity.goal = null; rec.entity.task = { type: 'idle' }; } else { rec._x = mx; rec._y = my; } return true; },
    setAppearance(ref, f) { const rec = this.objects.get(ref); if (!rec) return false; rec.flags = f; rec.visible = !!(f & 1); rec.hitable = !!(f & 2); rec.selectable = !!(f & 4); if (rec.entity) rec.entity.parked = !rec.visible; return true; },
    playAnim(ref, name) { const rec = this.objects.get(ref); if (!rec) return false; rec.anim = name; (this.anims = this.anims || []).push([rec.name, name]); return true; },
    setQuestionMark(ref, state, tip) { const m = this.questionMarks.find((q) => q.guid === ref || q.name === ref); if (!m) return false; m.state = state; if (tip != null) m.tooltip = tip; return true; },
    update(dt) {
      const ev = this.world.events;
      for (; this.evAt < ev.length; this.evAt++) {
        const e = ev[this.evAt];
        this.emit('event', e);
        if ((e.type === 'died' || e.type === 'destroyed' || e.type === 'removed') && e.entity && e.entity.rec) this.objects.drop(e.entity.rec);
        else if (e.type === 'owner' && e.entity.rec) this.emit('owner', e.entity.rec, e.from, e.to);
        else if (e.type === 'diplomacy') this.emit('diplomacy', e);
      }
      this.objects.compact();
      if (this.engine) this.engine.update(dt);
    },
  };
  for (const k in data.variables || {}) C.variables.set(k, String(data.variables[k].value));
  const W = C.world = new MockWorld(C);
  G.world = W; G.campaign = C;
  C.regions = new Regions(data.regions || [], (mx, my) => C.toGame(mx, my), (x, z) => C.toMap(x, z));
  C.objects = new Registry(C, C.regions);
  for (const pd of data.players || []) if (pd.present !== false) { C.players[pd.id] = new MockPlayer(pd.id, pd); if (pd.id !== 0) G.brains.set(pd.id, new MockBrain(C.players[pd.id])); }
  C.human = C.players[0];
  W.onEntity = (e) => { let rec = C.pending; C.pending = null; if (rec) { rec.entity = e; e.rec = rec; if (!rec.listed) C.objects.add(rec); } else rec = C.objects.adopt(e); C.emit('spawned', rec); };
  // objects of the data: units and buildings become world entities, everything else a record
  const PARTS = new Set(['PROD', 'TRRT', 'MNIO']), HELPERS = new Set(['SLOC', 'WYPT', 'GROU', 'QMRK', 'OTHR', 'DMGL', 'CFXE', 'COLL', 'FOOD']);
  for (const o of data.objects || []) {
    if (PARTS.has(o.type)) continue;                 // riders, turrets: parts of other objects, no record (setup.js)
    const rec = new Rec({ guid: o.guid, name: o.name, cls: o.class, type: o.type || '', index: o.index, handle: o.handle, slot: o.owner == null ? -1 : o.owner, x: o.x, y: o.y, data: o });
    if (HELPERS.has(o.type) || /^virtual_produce_unit$/i.test(o.class)) { rec.placed = false; C.objects.add(rec); continue; }
    if (opts.place !== false && (UNIT_TYPES.has(o.type) || (o.type === 'BLDG' && o.owner != null && C.players[o.owner]))) {
      const [x, z] = C.toGame(o.x, o.y);
      C.pending = rec;
      const e = W.make(o.class, o.type, o.owner != null ? C.players[o.owner] || null : null, x, z, (o.level || 0) + 1);
      C.pending = null;
      if (o.max_hp > 0) { e.maxHp = o.max_hp; e.hp = o.hp > 0 ? Math.min(o.hp, o.max_hp) : o.max_hp; } else { e.maxHp = e.hp = o.type === 'BLDG' ? 3000 : 500; }
      if (o.visible === false) { e.parked = true; rec.visible = false; }
    } else if (opts.place !== false && o.type === 'NEST') {
      // a nest: an ownerless object with hit points (setup.js wildlifeReady) and its first animals (maps/source.js)
      const [x, z] = C.toGame(o.x, o.y), a = o.attr || {};
      C.pending = rec;
      const e = W.make(o.class, 'BLDG', null, x, z, 1);
      C.pending = null;
      rec.type = 'NEST'; e.isNest = true; e.maxHp = 500; e.hp = +a.hitpoints || 500;
      if (o.visible === false) { e.parked = true; rec.visible = false; }
      const sp = a.spawn_type, max = Math.max(1, Math.min(10, +a.spawn_max || 3)), amount = a.spawn_amount == null || a.spawn_amount === '' ? -1 : +a.spawn_amount;
      if (sp) for (let k = 0, n = amount >= 0 ? Math.min(max, amount) : max; k < n; k++) W.make(sp, 'ANML', null, x + 4 + k * 2, z + 3, 1);
    } else C.objects.add(rec);
  }
  for (const g of data.groups || []) {
    let rec = C.objects.byGuid(g.guid);
    if (!rec) rec = C.objects.add(new Rec({ guid: g.guid, name: g.name, cls: 'GroupObject', type: 'GROU' }));
    rec.groupObj = new Group(rec); C.groups.push(rec.groupObj);
    for (const m of g.members || []) { const r = C.objects.byGuid(m); if (r) C.objects.addToGroup(rec.groupObj, r); }
  }
  for (const q of data.question_marks || []) C.questionMarks.push({ guid: q.guid, name: q.name, state: q.state || 'STATE_INVISIBLE', tooltip: '' });
  // start armies (the heroes of the arena ...)
  const MAIN = { Hu: 'hu_fireplace', Aje: 'aje_resource_collector', Ninigi: 'ninigi_fireplace', SEAS: 'seas_headquarters' };
  for (const pd of data.players || []) if (pd.present !== false && pd.start_location && opts.place !== false) {
    const sl = pd.start_location;
    if (pd.include_buildings && MAIN[pd.tribe] && !(pd.tribe === 'Aje' && pd.id === 0)) { const [x, z] = C.toGame(sl.x, sl.y); W.make(MAIN[pd.tribe], 'BLDG', C.players[pd.id], x, z, 1); }
    if (!sl.ignore_pointbuy) for (const a of pd.start_army || []) C.spawn(a.class, pd.id, sl.x, sl.y, { level0: a.level || 0 });
  }
  C.engine = new TriggerEngine(C);
  // advance the game: seconds in 50 ms slices (the order of main.js simulate)
  G.step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) { W.update(dt); C.update(dt); G.mission.tick(dt); } };
  G.me = C.human;
  G.run = (seconds, dt = 0.05) => { const n = Math.round(seconds / dt); for (let i = 0; i < n; i++) { W.update(dt); C.update(dt); G.mission.tick(dt); } };
  return G;
}

// build a small mission JSON for tests: trig(name, {flags}, conditions, actions)
let gid = 0;
export const guid = (p = 'g') => p + String(++gid).padStart(6, '0');
export function mission(o = {}) {
  return {
    schema: 'pw-campaign/1', map: { width: 512, height: 512 }, players: o.players || [{ id: 0, present: true, tribe: 'Hu', type: 'human', diplomacy: [2, 0, 0, 1] }, { id: 1, present: true, tribe: 'Aje', diplomacy: [0, 2, 1, 1] }, { id: 2, present: true, tribe: 'Hu', diplomacy: [0, 1, 2, 1] }],
    objects: o.objects || [], groups: o.groups || [], question_marks: o.question_marks || [], regions: o.regions || [], quests: o.quests || [], variables: o.variables || {}, triggers: o.triggers || [],
    defaults: o.defaults || { conditions: { TIME: { duration: '0', reset: '1', show: '0' }, PLDE: { check_bldgs: '0', check_producer: '1', check_none: '0', check_pyramid: '1' } }, actions: { TIMR: { timer_id: '1', event: 'create', show: '1' }, DELO: { maxobjs: '-1' }, AILU: { lock: '1', enable_objsel: 'true' }, ADGR: { selector_enabled: '1' }, AIAM: { selector_enabled: '1' }, TRSP: { enable_objsel: '1', enable_subsel: '1', mount: '0' }, COBJ: { ignore_pyramid: '1' }, CPLX: { ignore_pyramid: '1' } } },
    texts: o.texts || {}, dialogs: o.dialogs || {}, sequences: o.sequences || {}, refs: {},
  };
}
export function trig(name, flags, conditions, actions, extra = {}) {
  const f = { once: true, enabled: true, disabled: false, random: false, node_off: false, by_difficulty: false, ...flags };
  return { guid: extra.guid || guid('t'), name, folder: extra.folder || 'Root', compiled: extra.compiled !== false, flags: f, expression: extra.expression || '',
    conditions: conditions.map((c) => ({ type: c[0], p: c[0] === 'CVAR' ? { local: '1', ...c[1] } : c[1] || {} })), actions: actions.map((a) => ({ type: a[0], p: a[0] === 'VARS' ? { local: '1', ...a[1] } : a[1] || {}, difficulty: a[2] == null ? 1 : a[2] })) };
}
