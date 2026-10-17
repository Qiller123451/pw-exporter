// Saved games: the whole simulation state as one JSON document, and a game loaded from it.
//
// Saving walks the object graph of the running game from a few roots (the world, the players' brains, the campaign
// and its trigger engine) and writes every object once into a table; references between objects become table
// indices, so shared objects stay shared and cycles are fine. What is drawn (three.js objects, animation mixers,
// sprites) is not saved: it is made again from the saved state. Functions are never saved - the delayed calls and
// effects of the simulation are data for that reason (game/delayed.js).
//
// Loading starts the same game as before from its start settings (map, tribes, mission, mod): terrain, landscape,
// resources, players, the campaign's records, triggers and regions, the computer players exist again. These are the
// "anchors": objects the setup makes in a fixed order, found again by a key (player:1, res:<id>, trig:<guid> ...).
// The units and buildings of the fresh setup are removed; then the saved objects are made - anchors take the saved
// values into their fresh object, everything else is created - and what is derived is rebuilt (models, tech trees,
// lookup tables, the pathfinder grids, the fog of war).
//
// Table entries: {o: {...}} plain object, {a: [...]} array, {m: [[k, v]]} Map, {s: [...]} Set,
// {t: 'Uint8Array', b: base64} typed array, {v3|v2|q: [...]} three.js vectors, {c: class, k: anchor key, f: {...}}
// instances. Values: JSON values, {$: i} reference, {$n: 'NaN'|'Infinity'|'-Infinity'}.
import * as THREE from 'three';
import { Unit, Building, ResNode, Projectile, nextEntityId, setNextEntityId } from './entities.js';
import { Player } from './player.js';
import { TechTree, LocalTree } from './techtree.js';
import { WallMap } from './wallmap.js';
import { Attack } from './ai/attack.js';
import { Pool } from './ai/defense.js';
import { TribeAI } from './ai/brain.js';
import { Rec, Group, Registry } from './campaign/registry.js';
import { Region, Regions } from './campaign/regions.js';
import { Prop } from './prop.js';
import { Area } from './systems/animals.js';
import { Stats } from './stats.js';
import { Campaign } from './campaign/setup.js';
import { TriggerEngine } from './campaign/engine.js';
import { MissionUI } from '../ui/mission.js';
import { Sequel, SAVED as SEQUEL_SAVED } from './sequel/runtime.js';

export const SAVE_VERSION = 1;

// ---------------------------------------------------------------------------------------------- what is saved
// Per class: skip (fields not saved: derived or drawn) or keep (only these fields are saved), plus how an instance
// is made again (make) and finished after its fields are set (revive). Anchored objects are found by key.
const DRAWN = ['obj', 'model', 'anim', 'comp', 'tpl', 'weaponObjs', 'toolObj', 'carryObj', 'ruin', '_links', '_ro', 'parts', 'turret', 'cranes',
  'slots', 'world', 'autoMovesCache', 'onScreen', 'still'];
const SPECS = [
  { cls: Unit, name: 'Unit', skip: [...DRAWN, 'def', 'stats', 'weapons', 'gfx', 'walkAnim', 'runAnim', 'speed', 'runSpeed', 'animSpeed', 'runAnimSpeed', 'idleAnim', 'height', 'radius', 'ttVersion', '_hk', 'heldWeapon', 'fow'],
    make: (f, X) => new Unit(X.W, f.name, X.ref(f.owner), X.num(f.pos, 'x'), X.num(f.pos, 'z'), f.level, f.heading, {}),
    revive: reviveUnit },
  { cls: Building, name: 'Building', skip: [...DRAWN, 'def', 'stats', 'weapons', 'behaviour', 'baseY', 'boxes', 'gfx', 'ttVersion', '_hk', 'visKey', 'dmgStage', 'partsKey', 'fxShown', 'ht', 'hx', 'hz', 'fLocal', 'fow', 'cls', 'dLinks'],
    make: (f, X) => new Building(X.W, f.name, X.ref(f.owner), X.num(f.origin, 'x'), X.num(f.origin, 'z'), f.rot, f.built),
    revive: reviveBuilding },
  { cls: ResNode, name: 'ResNode', skip: ['world', 'propHandle', 'spriteHandles', 'stumpHandle', 'timberHandle', '_hk'],
    make: (f, X) => new ResNode(X.W, f.type, f.res, X.num(f.pos, 'x'), X.num(f.pos, 'z'), f.amount, {}) },
  { cls: Projectile, name: 'Projectile', skip: ['world', 'obj'], make: () => Object.create(Projectile.prototype), revive: reviveProjectile },
  { cls: LocalTree, name: 'LocalTree', keep: ['parent', 'enabled'], make: (f, X) => new LocalTree(X.ref(f.parent)), revive: (t) => { t.parentVersion = -1; t.rebuild(); } },
  { cls: TechTree, name: 'TechTree', keep: ['enabled', 'tribe'], make: (f, X) => X.G.data.newTree(f.tribe), revive: (t) => { t.held = 0; t.dirty = false; t.rebuild(); } },
  { cls: Player, name: 'Player', skip: [] },
  { cls: WallMap, name: 'WallMap', skip: ['world'] },
  { cls: Attack, name: 'Attack', skip: [] },
  { cls: Pool, name: 'Pool', skip: [] },
  { cls: TribeAI, name: 'TribeAI', skip: ['G', 'W', 'D', 'S', '_res', '_resV', '_mix', '_mixKey', '_modes', '_hint', '_hintT', 'evI', 'evLast', 'cfg'] },
  { cls: Rec, name: 'Rec', skip: ['data'], make: () => Object.create(Rec.prototype) },
  { cls: Group, name: 'Group', skip: [], make: () => Object.create(Group.prototype) },
  { cls: Registry, name: 'Registry', keep: ['all', 'groups', 'counter'], revive: reviveRegistry },
  { cls: Region, name: 'Region', keep: ['enabled', 'shapes', 'version'], revive: (r) => r.rebox() },
  { cls: Regions, name: 'Regions', keep: ['version'] },
  { cls: Area, name: 'Area', skip: [] },                     // a wild nest's areas (systems/animals.js)
  { cls: Stats, name: 'Stats', keep: ['p', 'series', 'nextT'] },                      // the statistics (game/stats.js)
  { cls: Prop, name: 'Prop', skip: ['world', 'obj', 'anim', 'tpl', 'rec'], make: (f, X) => new Prop(X.W, X.plain(f.spec)), revive: reviveProp },
  { cls: Campaign, name: 'Campaign', keep: ['variables', 'timers', 'questionMarks', 'props', 'resourceRecs', 'evAt', 'boni', 'human', 'players', 'groups'] },
  { cls: TriggerEngine, name: 'TriggerEngine', skip: ['C', 'W', 'G', 'triggers', 'byGuid', 'byName', 'quests', 'profile', 'debug', 'random', 'queue', 'unknownTypes', 'stats', 'trace', 'log', 'fxObjs'] },
  { cls: MissionUI, name: 'MissionUI', keep: ['read', 'unread', 'bar', 'markers'] },
  { cls: Sequel, name: 'Sequel', keep: SEQUEL_SAVED, revive: (M) => { M.setNight(M.nightOn); M.started = true; } },
];
// anchored objects of classes that are not exported: by the prefix of their key
const KEY_SPECS = {
  world: { name: 'World', skip: ['scene', 'data', 'templates', 'height', 'fx', 'audio', 'props', 'foliage', 'fow', 'adaptTerrain', 'nightFn', 'clearVegetation', 'decorIndex', 'onEntity', 'nav', 'waterNav',
    'uHash', 'bHash', 'rHash', 'reserved', 'events', 'hooks', 'dead', 'standIns', '_amp', '_resCan', '_resBy', '_noModel', 'wetCell', 'steepCell', 'shoreCell', 'cloneModel', 'applyFow',
    'MOVES', 'THREE', 'size', 'play', 'playHalf', 'water', 'setting', 'wallGrid', 'productWood', 'regionOf', '_walkable', '_island'] },
  trig: { name: 'Trigger', skip: ['E', 'data', 'conds', 'actions', 'expr', 'index', 'guid', 'name', 'folder', 'once', 'random', 'byDifficulty', 'startEnabled', 'nodeOff'] },
  cond: { name: 'Cond', skip: ['E', 't', 'type', 'p', 'index'] },
};
const BY_CLASS = new Map(SPECS.map((s) => [s.cls, s]));
const BY_NAME = new Map(SPECS.map((s) => [s.name, s]));
const TYPED = { Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
// objects that are drawn, played or part of the page: never saved (a field holding one is left out)
const isDrawn = (v) => v instanceof THREE.Object3D || v instanceof THREE.Material || v instanceof THREE.Texture || v instanceof THREE.BufferGeometry ||
  v instanceof THREE.AnimationMixer || v instanceof THREE.AnimationClip || (typeof Node !== 'undefined' && v instanceof Node);

function specOf(o, key) {
  if (key) { const p = key.split(':')[0]; if (KEY_SPECS[p]) return KEY_SPECS[p]; }
  let c = o.constructor;
  while (c && c !== Object) { const s = BY_CLASS.get(c); if (s) return s; c = Object.getPrototypeOf(c); }
  return null;
}
function fieldsOf(o, spec) {
  if (spec.keep) return spec.keep.filter((k) => Object.prototype.hasOwnProperty.call(o, k));
  const skip = spec.skipSet || (spec.skipSet = new Set(spec.skip));
  return Object.keys(o).filter((k) => !skip.has(k));
}

// ---------------------------------------------------------------------------------------------- anchors
// the objects a fresh start of the same game makes again, by key
function anchors(G) {
  const A = new Map(), W = G.world;
  const put = (o, k) => { if (o && typeof o === 'object' && !A.has(o)) A.set(o, k); };
  put(W, 'world');
  if (W.wallMap) put(W.wallMap, 'wallmap');
  if (W.stats) put(W.stats, 'stats');
  for (const p of W.players) { put(p, 'player:' + p.id); if (p.tt) put(p.tt, 'tt:' + p.id); }
  for (const r of W.resources) put(r, 'res:' + r.id);
  if (G.brains) for (const [id, b] of G.brains) put(b, 'ai:' + id);
  const C = G.campaign;
  if (C) {
    put(C, 'campaign');
    put(C.objects, 'registry');
    put(C.regions, 'regions');
    if (C.regions) { put(C.regions.world, 'region:world'); C.regions.list.forEach((r, i) => put(r, 'region:' + i)); }
    for (const rec of C.objects ? C.objects.all : []) if (rec.index >= 0) { put(rec, 'rec:' + rec.index); if (rec.groupObj) put(rec.groupObj, 'group:' + rec.index); }
    for (const g of C.groups || []) if (g.rec && g.rec.index >= 0) put(g, 'group:' + g.rec.index);
    C.props.forEach((p) => { if (p.rec && p.rec.index >= 0) put(p, 'prop:' + p.rec.index); });
    const E = C.engine;
    if (E) {
      put(E, 'engine');
      for (const t of E.triggers) { put(t, 'trig:' + t.guid); t.conds.forEach((c, i) => put(c, 'cond:' + t.guid + ':' + i)); }
    }
  }
  // the map's healing wells (a campaign's are its props, anchored above)
  W.wells.forEach((w, i) => put(w, 'well:' + i));
  if (G.mission) put(G.mission, 'mission');
  if (G.sequel) put(G.sequel, 'sequel');
  return A;
}

// objects of the setup that may have left the lists (used-up resources, dead records): found by their id
function keyOf(v) {
  if (v instanceof ResNode) return 'res:' + v.id;
  if (v instanceof Rec && v.index >= 0) return 'rec:' + v.index;
  if (v instanceof Group && v.rec && v.rec.index >= 0) return 'group:' + v.rec.index;
  return null;
}

// ---------------------------------------------------------------------------------------------- saving
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

class Writer {
  constructor(G) { this.G = G; this.ids = new Map(); this.table = []; this.anchors = anchors(G); this.problems = []; this.path = []; }
  val(v, where) {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : { $n: String(v) };
    if (v === undefined) return undefined;
    if (typeof v === 'function') { this.problems.push('function at ' + where); return undefined; }
    if (typeof v !== 'object') return undefined;
    if (isDrawn(v)) return undefined;
    const i = this.ids.get(v);
    if (i !== undefined) return { $: i };
    return { $: this.add(v, where) };
  }
  add(v, where) {
    const i = this.table.length;
    this.ids.set(v, i);
    this.table.push(null);
    let e;
    if (Array.isArray(v)) e = { a: v.map((x, k) => { const y = this.val(x, where + '[' + k + ']'); return y === undefined ? null : y; }) };
    else if (v instanceof Map) e = { m: [...v].map(([k, x]) => [this.val(k, where + '.key'), this.val(x, where + '.' + String(k && k.id || k).slice(0, 30))]).filter(([k]) => k !== undefined) };
    else if (v instanceof Set) e = { s: [...v].map((x) => this.val(x, where + '{}')).filter((x) => x !== undefined) };
    else if (ArrayBuffer.isView(v)) e = { t: v.constructor.name, b: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    else if (v instanceof THREE.Vector3) e = { v3: [v.x, v.y, v.z] };
    else if (v instanceof THREE.Vector2) e = { v2: [v.x, v.y] };
    else if (v instanceof THREE.Quaternion) e = { q: [v.x, v.y, v.z, v.w] };
    else {
      const key = this.anchors.get(v) || keyOf(v);
      const proto = Object.getPrototypeOf(v);
      const plain = proto === Object.prototype || proto === null;
      const spec = plain && !key ? null : specOf(v, key);
      if (!plain && !spec) { this.problems.push(`object of class ${v.constructor && v.constructor.name} at ${where}`); e = { o: {} }; }
      else {
        const f = {};
        for (const k of spec ? fieldsOf(v, spec) : Object.keys(v)) { const y = this.val(v[k], where + '.' + k); if (y !== undefined) f[k] = y; }
        e = spec ? { c: spec.name, f } : { o: f };
        if (key) e.k = key;
      }
    }
    this.table[i] = e;
    return i;
  }
}

// the state of the running game: { version, cfg, mod, time, root, table, problems }
export function snapshot(G) {
  const W = G.world, C = G.campaign, w = new Writer(G);
  const nav = W.nav;
  const root = {
    world: W, brains: G.brains ? [...G.brains.values()] : [], campaign: C || null, engine: C ? C.engine : null, mission: C ? G.mission : null, sequel: G.sequel || null,
    me: G.me, ai: G.ai || null, nextId: nextEntityId(),
    quests: C ? (C.data.quests || []).map((q) => ({ visible: q.visible, accomplished: q.accomplished, unaccomplishable: q.unaccomplishable })) : null,
    nav: { block: nav.block, reserved: W.reserved, wblock: W.waterNav ? W.waterNav.block : null, gateAt: nav.gateAt },
    fow: G.fow ? G.fow.explored : null, reveals: G.reveals || [],
    cam: G.rtscam ? { x: G.rtscam.x, z: G.rtscam.z, yaw: G.rtscam.yaw, dist: G.rtscam.tDist } : null,
    sel: G.sel ? [...G.sel] : [],
  };
  const r = w.val(root, 'root');
  return { version: SAVE_VERSION, cfg: G.config, mod: G.dataConfig || null, time: W.time, campaignTime: C && C.engine ? C.engine.time : 0, root: r, table: w.table, problems: w.problems };
}

// ---------------------------------------------------------------------------------------------- loading
class Reader {
  constructor(G, snap) {
    this.G = G; this.W = G.world; this.snap = snap; this.T = snap.table;
    this.objs = new Array(this.T.length);
    this.anchors = new Map([...anchors(G)].map(([o, k]) => [k, o]));
    this.made = [];               // [object, spec, entry] in table order
    this.used = new Set();        // anchor keys the save has
  }
  num(ref, k) { const e = ref && this.T[ref.$]; return e && e.v3 ? e.v3[k === 'x' ? 0 : k === 'y' ? 1 : 2] : 0; }
  plain(ref) { return this.decode(ref); }
  ref(v) { return v && typeof v === 'object' && '$' in v ? this.obj(v.$) : this.decode(v); }
  decode(v) {
    if (v === null || typeof v !== 'object') return v;
    if ('$n' in v) return Number(v.$n);
    if ('$' in v) return this.obj(v.$);
    return v;
  }
  // the object of table entry i (made on first use)
  obj(i) {
    if (this.objs[i] !== undefined) return this.objs[i];
    const e = this.T[i];
    let o;
    if (e.a) o = [];
    else if (e.m) o = new Map();
    else if (e.s) o = new Set();
    else if (e.t) { const u = unb64(e.b); o = new TYPED[e.t](u.buffer, 0, u.byteLength / TYPED[e.t].BYTES_PER_ELEMENT); }
    else if (e.v3) o = new THREE.Vector3(...e.v3);
    else if (e.v2) o = new THREE.Vector2(...e.v2);
    else if (e.q) o = new THREE.Quaternion(...e.q);
    else if (e.o) o = {};
    else {
      const spec = e.k ? specOf(this.anchors.get(e.k) || {}, e.k) || BY_NAME.get(e.c) || KEY_SPECS[e.k.split(':')[0]] : BY_NAME.get(e.c);
      if (e.k) this.used.add(e.k);
      o = e.k ? this.anchors.get(e.k) : undefined;
      if (o === undefined) {
        if (!spec || (!spec.make && !spec.cls)) throw new Error(`saved ${e.c} ${e.k || ''} cannot be made again`);
        this.objs[i] = null;                // (a cycle through the arguments of make)
        o = spec.make ? spec.make(e.f, this) : Object.create(spec.cls.prototype);
      }
      this.made.push([o, spec, e]);
    }
    this.objs[i] = o;
    return o;
  }
  // fill every made object with its saved values
  fill() {
    for (let i = 0; i < this.T.length; i++) this.obj(i);
    for (let i = 0; i < this.T.length; i++) {
      const e = this.T[i], o = this.objs[i];
      if (e.a) { o.length = 0; for (const x of e.a) o.push(this.decode(x)); } else if (e.m) for (const [k, x] of e.m) o.set(this.decode(k), this.decode(x));
      else if (e.s) for (const x of e.s) o.add(this.decode(x));
      else if (e.o) for (const k in e.o) o[k] = this.decode(e.o[k]);
    }
    for (const [o, spec, e] of this.made) {
      // the fresh object's own values of saved fields that the save does not have are dropped
      if (spec) for (const k of spec.keep || Object.keys(o)) if (!(k in e.f) && (spec.keep || !(spec.skipSet || (spec.skipSet = new Set(spec.skip))).has(k))) {
        if (spec.keep) { if (Object.prototype.hasOwnProperty.call(o, k)) delete o[k]; } else delete o[k];
      }
      for (const k in e.f) o[k] = this.decode(e.f[k]);
    }
  }
}

// After a fresh start of the saved game (startGame with the saved cfg): put the saved state in place.
export function restore(G, snap) {
  if (!snap || snap.version !== SAVE_VERSION) throw new Error('not a saved game of this version');
  const W = G.world, C = G.campaign;
  // 1. the fresh setup's units, buildings and shots leave the world (their drawings too)
  for (const u of W.units) dispose(W, u);
  for (const b of W.buildings) { dispose(W, b); if (b.ruin) W.scene.remove(b.ruin); }
  for (const p of W.projectiles) if (p.obj) W.scene.remove(p.obj);
  W.units = []; W.buildings = []; W.projectiles = [];
  // the items the setup put down (the spawns choose at random) - those of the save come back with it; a campaign's
  // placed items are its props (anchored)
  for (const it of W.items) if (!(it.rec && it.rec.index >= 0)) it.remove();
  // 2. the ground as the game had levelled it (game/ground.js), before anything stands on it
  const X = new Reader(G, snap);
  const rootE = X.T[snap.root.$];
  const worldE = X.T[rootE.o.world.$];
  const log = worldE.f.groundLog ? X.decode(worldE.f.groundLog) : [];
  W.groundLog = [];
  if (W.adaptTerrain) for (const [gfx, x, z, rot] of log) W.adaptTerrain(gfx, x, z, rot);
  const veg = worldE.f.vegetationLog ? X.decode(worldE.f.vegetationLog) : [];
  W.vegetationLog = [];
  if (W.clearVegetation) for (const [x, z, r] of veg) W.clearVegetation(x, z, r);
  // 3. resources the game used up: felled and depleted as they were (their drawings)
  const savedRes = new Map();
  for (const e of X.T) if (e.c === 'ResNode' && e.k) savedRes.set(e.k, e.f);
  for (const r of W.resources) {
    const f = savedRes.get('res:' + r.id);
    const type = f ? f.type : r.type === 'tree' ? 'timber' : r.type, alive = f ? f.alive : false;
    if (r.type === 'tree' && type !== 'tree') W.fellTree(r);
    if (!alive && r.alive) W.depleteNode(r);
  }
  // 4. every saved object, made or found, with its saved values
  setNextEntityId(1e9);
  const root = X.ref(snap.root);
  X.fill();
  setNextEntityId(root.nextId);
  // 5. what is derived
  const order = ['TechTree', 'LocalTree', 'Player', 'ResNode', 'Building', 'Unit', 'Projectile', 'Prop', 'Region', 'Registry'];
  for (const name of order) for (const [o, spec] of X.made) if (spec && spec.name === name && spec.revive) spec.revive(o, X, W);
  for (const [o, spec] of X.made) if (spec && !order.includes(spec.name) && spec.revive) spec.revive(o, X, W);
  W.events = []; W.dead = [];
  W.uHash.map.clear(); W.bHash.map.clear(); W.rHash.map.clear();
  for (const u of W.units) if (u.alive && !u.inside && !u.parked) W.uHash.insert(u);
  for (const b of W.buildings) if (b.alive && !b.parked) W.bHash.insert(b);
  for (const r of W.resources) if (r.alive) W.rHash.insert(r);
  // the pathfinder grids as saved (buildings, felled trees, open gates, walls, props)
  const n = root.nav;
  W.nav.block.set(n.block); W.reserved.set(n.reserved);
  if (n.wblock && W.waterNav) W.waterNav.block.set(n.wblock);
  W.nav.gateAt = n.gateAt;
  W.nav.version++; if (W.waterNav) W.waterNav.version++;
  W._amp = null;
  if (G.fow && root.fow) G.fow.explored.set(root.fow);
  G.reveals = root.reveals || [];
  for (const p of W.players) W.recomputeCaps(p);
  // the campaign: quests, lookup tables, the trigger engine's listeners, what was on show
  if (C) {
    (C.data.quests || []).forEach((q, i) => Object.assign(q, root.quests[i] || {}));
    const E = C.engine;
    if (E) { E.attach(); E.resumeShows(); }
    if (G.mission) { for (const m of C.questionMarks) G.mission.questionMark(m); if (G.mission.refresh) G.mission.refresh(); }
  }
  // the brains: caches made anew
  for (const b of G.brains ? G.brains.values() : []) { b.S = null; b.evI = W.events.length; }
  if (root.cam && G.rtscam) Object.assign(G.rtscam, { x: root.cam.x, z: root.cam.z, yaw: root.cam.yaw, tDist: root.cam.dist, dist: root.cam.dist });
  G.sel = new Set((root.sel || []).filter((e) => e && e.alive));
  return { objects: X.T.length, missing: [...X.anchors.keys()].filter((k) => /^(trig|cond|rec|player)/.test(k) && !X.used.has(k)).length };
}

function dispose(W, e) {
  if (e.obj) W.scene.remove(e.obj);
  if (e.anim) e.anim.dispose();
  if (e.comp && e.comp.dispose) e.comp.dispose();
}

// ---------------------------------------------------------------------------------------------- revive
// a unit made from the save: its rules and model for the saved level, owner and look
function reviveUnit(u, X, W) {
  const hp = u.hp, weaponPath = u.weapon && u.weapon.path, gfx = u.gfx;
  u.weapon = null;
  u.readRules();
  u.weapon = (weaponPath && u.weapons.all.find((w) => w.path === weaponPath)) || u.weapons.long;
  if (u.camoGfx || u.stats.gfx !== gfx) { u.heldWeapon = null; u.buildModel(); }
  u.hp = hp;
  if (u.weapon !== u.weapons.long) u.attachWeapon(u.weapon);
  if (u.carry) u.setCarry(u.carry.res, u.carry.amount, u.carry.look);
  if (u.toolGfx) { const g = u.toolGfx; u.toolGfx = null; u.attachTool(g); }
  if (u.busyAnim) u.busyAnim = false;           // (the animation callbacks that end it are not saved)
  if (u.inside || u.parked || u.removed) u.obj.visible = false;
  if (!u.alive) {
    // a body: the end of its death animation
    const a = u.anim.pick('dying', 'die_simple', 'hit_die_simple');
    if (a) { u.anim.play(a, { loop: false, fade: 0 }); u.anim.update(u.anim.duration(a) + 0.1); }
    if (u.removed) W.scene.remove(u.obj);
  }
  u.syncObj();
}
function reviveBuilding(b, X, W) {
  const hp = b.hp;
  b.stats = W.data.stats(b.name, b.level || 1, b.rulesOwner ? b.rulesOwner() : b.owner);
  b.def = W.data.def(b.name, b.rulesOwner ? b.rulesOwner() : b.owner);
  if (b.refreshRules) b.refreshRules();
  b.hp = hp;
  b.behaviour = W.behaviourOf ? W.behaviourOf(b) : null;
  // wall pieces: their parts and pathfinder boxes from the WallMap again (wallmap.js update)
  if (b.def.wallKind === 'wall' && b.tile && W.wallMap && b.alive) { b.partsKey = null; b.pfMask = -1; W.wallMap.update(...b.tile); }
  if (b.relocate && (b.origin.x !== b.obj.position.x || b.origin.z !== b.obj.position.z || b.rot !== b.obj.rotation.y)) {
    b.obj.position.set(b.origin.x, b.obj.position.y, b.origin.z); b.obj.rotation.y = b.rot; b.obj.updateMatrixWorld(true);
  }
  if (!b.built && b.addCranes && !b.cranes.length) b.addCranes();
  if (b.built && b.cranes && b.cranes.length && b.removeCranes) b.removeCranes();
  if (b.lastAnim && b.anim && b.anim.has(b.lastAnim)) { b.anim.play(b.lastAnim, { loop: false, fade: 0 }); b.anim.update(b.anim.duration(b.lastAnim) + 0.1); } else if (b.idleAnim) b.idleAnim();
  b.updateVisual();
  if (b.parked) b.obj.visible = false;                // (a waiting main building: campaign/setup.js parkFreeMains)
  if (!b.alive) {
    W.scene.remove(b.obj);
    if (!b.removed && b.deadT <= 20) {
      b.ruin = b.built && !b.silentDeath && b.def.wallKind !== 'wall' ? W.ruinOf(b) : null;
      if (b.ruin && b.deadT > 8) b.ruin.position.y -= (b.deadT - 8);
    }
  }
}
function reviveProjectile(p, X, W) {
  const tpl = p.weapon && p.weapon.projectile ? W.template(p.weapon.projectile, true) : null;
  p.world = W;
  p.obj = null;
  if (tpl && p.alive) { p.obj = W.cloneModel(tpl); W.scene.add(p.obj); p.obj.position.copy(p.pos); }
}
function reviveProp(p) {
  if (!p.alive) { p.alive = true; p.blocking = false; p.remove(); return; }
  p.obj.visible = p.visible;
  if (p.lastAnim && p.anim && p.anim.has(p.lastAnim)) {
    p.anim.play(p.lastAnim, { loop: (p.lastLoops || 1) > 1, restart: true, fade: 0 });
    if ((p.lastLoops || 1) <= 1) p.anim.update(p.anim.duration(p.lastAnim) + 0.1);
  }
}
function reviveRegistry(R) {
  R.guids = new Map(); R.names = new Map(); R.handles = new Map(); R.indices = new Map();
  R.all = R.all.filter((r) => r.alive);
  for (const rec of R.all) {
    if (rec.guid) R.guids.set(rec.guid, rec);
    if (rec.name && !R.names.has(rec.name)) R.names.set(rec.name, rec);
    if (rec.handle) R.handles.set(rec.handle[0] + ':' + rec.handle[1], rec);
    if (rec.index >= 0) R.indices.set(rec.index, rec);
    if (rec.entity) rec.entity.rec = rec;
    if (rec.prop) rec.prop.rec = rec;
  }
  R.dirty = false;
}
