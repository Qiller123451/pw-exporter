// The trigger engine of the campaign: makes a mission play. Specification: remake/docs/spec/triggers.md (§1 how
// triggers run, §3 variables, §6 subsystems); the world it works on: docs/CAMPAIGN_RUNTIME.md. The conditions are in
// conditions.js, the actions in actions.js; this file is the core:
//
//   * trigger records with their flags (once, enabled, random, by_difficulty), folders (ACND) and the boolean
//     expression over the conditions;
//   * invalidate() -> evaluate at once -> queue the firing -> the actions run at the end of the step (§1.1);
//   * how conditions hear about the world: channels they subscribe to while their trigger listens (`sub`), a tick
//     list (TIME, RTME), a poll list (things without an event: positions, attributes) and one "objects changed"
//     version that every spawn / removal / owner / group change bumps;
//   * level variables, level timers, quests, the sequence and dialogue queues, waypoint patrols, items, delayed jobs;
//   * the debug helpers (G.campaign.debug) and the firing log.
//
// The engine never throws into the game loop: every action and every condition callback is guarded; what went
// wrong is collected in G.campaign.errors ([trigger, node type, message]) and G.campaign.warnings.
import { valueString, toInt, compare, compileExpression, filePart } from './trigutil.js';
import { CONDITIONS, CONDITION_STATUS } from './conditions.js';
import { ACTIONS, ACTION_STATUS, prescanActions } from './actions.js';

export { valueString, toInt, compare, compileExpression, filePart };

const PROFILE_DEFAULTS = { Games_Started: '0', Kill_Counter: '0', Other_Stuff: '', Tutorial_Started: '0', Level_1_Started: '0' };
// nodes with their defaults applied (the editor stores only what differs, §2.1)
function params(defs, node) { return { ...(defs && defs[node.type]), ...(node.p || {}) }; }

class Trigger {
  constructor(E, d, index) {
    this.E = E; this.data = d; this.index = index;
    this.guid = d.guid; this.name = d.name; this.folder = d.folder || 'Root';
    const f = d.flags || {};
    this.once = !!f.once; this.random = !!f.random; this.byDifficulty = !!f.by_difficulty;
    this.startEnabled = !!f.enabled; this.nodeOff = !!f.node_off;
    this.enabled = false;             // the flag TRIG switches
    this.nodeActive = true;           // no folder above it is inactive
    this.live = false;                // enabled && nodeActive: its conditions listen
    this.fired = 0; this.lastFired = -1; this.queued = 0; this.enabling = false; this.dirty = false;
    const defs = E.C.data.defaults || {};
    this.conds = (d.conditions || []).map((n, i) => {
      const K = CONDITIONS[n.type];
      if (!K) E.unknown('condition', n.type);
      return new (K || CONDITIONS.NONE)(E, this, n.type, params(defs.conditions, n), i);
    });
    this.actions = (d.actions || []).map((n) => ({ type: n.type, difficulty: n.difficulty == null ? 1 : +n.difficulty, p: params(defs.actions, n), note: n.note || n.name || '' }));
    try { this.expr = compileExpression(d.expression, this.conds.length); } catch (e) { E.error(this, 'expression', e); this.expr = () => false; }
  }
  evaluate() { return this.expr(this.conds); }
}

export class TriggerEngine {
  // C = the Campaign (setup.js). Created at the end of Campaign.build(); starts with the first simulation slice.
  constructor(C) {
    this.C = C; this.G = C.G; this.W = C.world;
    this.time = 0;
    this.started = false;
    this.queue = [];                    // triggers whose expression became true: their actions run at the end of the step
    this.log = [];                      // firings: { t, trigger, actions: [types] }
    this.trace = false;
    this.random = Math.random;          // tests replace it
    this.boni = 0;                      // BoniTotal: quest bonuses + BONI
    this.subs = new Map();              // channel -> Set<condition> (only conditions of listening triggers)
    this.always = new Map();            // channel -> [conditions] subscribed for the whole level (TIMR, SQEN, DSEN)
    this.ticking = new Set();           // conditions with tick(dt)
    this.polled = new Set();            // conditions with poll(): { nextPoll }
    this.objVersion = 0; this.objSeen = 0;      // "the set of objects changed" (spawn, removal, owner, group, appearance)
    this.jobs = [];                     // delayed work on game time: [time, fn, trigger name]
    this.patrols = new Map();           // unit -> patrol (WYPT)
    this.items = [];                    // items lying on the map (ItemSpawn objects)
    this.wells = [];                    // healing wells (FNTN objects)
    this.seqQueue = []; this.seqRunning = null; this.lastSequence = '';
    this.dialogsEnded = new Set();
    this.reveals = [];
    this.infoBar = null;                // { key, args } of the last INBA
    this.markers = new Map();           // id -> count (what MPNG added)
    this.overT = -1;                    // GAOV: seconds left until the defeat screen
    this.unknownTypes = { condition: new Set(), action: new Set() };
    this.stats = { fired: 0, actions: 0, polls: 0 };
    C.errors = C.errors || [];
    C.boni = 0;
    C.engine = this;
    try { if (typeof location !== 'undefined' && /[?&]trace\b/.test(location.search)) this.trace = true; } catch (e) { /* node */ }
    // ---- triggers (not compiled = does not exist for the game, §1.2)
    this.triggers = [];
    this.byGuid = new Map(); this.byName = new Map();
    (C.data.triggers || []).forEach((d, i) => {
      if (d.compiled === false || (d.flags && d.flags.disabled)) return;
      const t = new Trigger(this, d, i);
      this.triggers.push(t);
      this.byGuid.set(t.guid, t);
      if (!this.byName.has(t.name)) this.byName.set(t.name, t);
    });
    // ---- folders: a folder that directly holds a node_off trigger starts inactive (§1.5)
    this.inactive = new Set();
    for (const t of this.triggers) if (t.nodeOff) this.inactive.add(t.folder);
    for (const t of this.triggers) t.nodeActive = this.folderActive(t.folder);
    // ---- quests by guid / name
    this.quests = new Map();
    for (const q of C.data.quests || []) { this.quests.set(q.guid, q); if (!this.quests.has(q.name)) this.quests.set(q.name, q); }
    this.profile = this.loadProfile();
    this.debug = this.makeDebug();
    C.debug = this.debug;
  }

  // ------------------------------------------------------------------------------------------- diagnostics
  unknown(kind, type) {
    const s = this.unknownTypes[kind];
    if (s.has(type)) return;
    s.add(type);
    this.C.warn(`trigger ${kind} type ${type} is not implemented (${kind === 'condition' ? 'never true' : 'does nothing'})`);
  }
  warn(msg) { this.C.warn(msg); }
  error(t, type, e) {
    const msg = e && e.message ? e.message : String(e);
    const L = this.C.errors;
    if (L.length < 500) L.push([t ? t.name : '-', type, msg]);
    if (this.trace && typeof console !== 'undefined') console.warn('[trigger error]', t ? t.name : '-', type, e && e.stack ? e.stack : msg);
  }
  guard(t, type, fn) { try { return fn(); } catch (e) { this.error(t, type, e); return undefined; } }

  // ------------------------------------------------------------------------------------------- subscriptions
  sub(ch, c) { let s = this.subs.get(ch); if (!s) this.subs.set(ch, s = new Set()); s.add(c); }
  unsub(ch, c) { const s = this.subs.get(ch); if (s) s.delete(c); }
  forever(ch, c) { let s = this.always.get(ch); if (!s) this.always.set(ch, s = []); s.push(c); }
  // call c[method](...args) on every subscriber of a channel
  push(ch, method, ...args) {
    const s = this.subs.get(ch);
    if (s && s.size) for (const c of [...s]) if (c.t.live) this.guard(c.t, c.type, () => c[method](...args));
    const a = this.always.get(ch);
    if (a) for (const c of a) this.guard(c.t, c.type, () => c[method](...args));
  }
  touch() { this.objVersion++; }

  // one more trigger at run time, in the format of the mission data ({ name, guid, folder, flags, expression,
  // conditions: [{type, p}], actions: [{type, p, difficulty}] }): tests and experiments (G.campaign.debug.add)
  add(d) {
    const t = new Trigger(this, { guid: d.guid || 'added:' + (this.triggers.length + 1), folder: 'Root', flags: {}, ...d }, this.triggers.length);
    this.triggers.push(t);
    this.byGuid.set(t.guid, t);
    this.byName.set(t.name, t);
    t.nodeActive = this.folderActive(t.folder);
    if (this.started && t.startEnabled) this.enable(t);
    return t;
  }

  // ------------------------------------------------------------------------------------------- start
  start() {
    if (this.started) return;
    this.started = true;
    const C = this.C;
    this.W = C.world; this.G = C.G;
    // world -> conditions
    C.on('spawned', () => this.touch());
    C.on('removed', (rec) => { this.touch(); this.push('removed', 'onRemoved', rec); });
    C.on('owner', () => this.touch());
    C.on('group', (g, rec, added) => { this.touch(); this.push('group', 'onGroup', g, rec, added); });
    C.on('diplomacy', (e) => this.push('diplomacy', 'onDiplomacy', e));
    C.on('event', (e) => this.worldEvent(e));
    this.initItems();
    this.initWells();
    this.fixRegions();
    // ---- §6.7 no. 7: every trigger with the flag `enabled` in an active folder is enabled, in stored order
    for (const t of this.triggers) if (t.startEnabled) this.enable(t);
  }
  // A region that a trigger query names must be able to contain something. The data marks some shapes "not enabled"
  // (docs/CAMPAIGN_FORMAT.md §4: a flag bit decoded by correlation with the nests' extra areas that ARGN opens);
  // mission 8's `trigger_sc_3004` has that bit cleared, is tested by a live REGN and no ARGN ever touches it - in
  // the original the mission goes on there, so the bit cannot mean "disabled" for it. Such shapes are switched on.
  fixRegions() {
    const R = this.C.regions, argn = new Set(), used = new Set();
    for (const t of this.triggers) {
      for (const a of t.actions) if (a.type === 'ARGN' || a.type === 'MRGN') argn.add(a.p.rgn_guid);
      for (const n of [...t.conds, ...t.actions]) for (const k in n.p) if (k.endsWith('rgn_guid') && n.type !== 'ARGN') used.add(n.p[k]);
    }
    this.regionsFixed = [];
    for (const g of used) {
      const r = R.find(g);
      if (!r || r.world || argn.has(g) || argn.has(r.name) || !r.shapes.some((sh) => !sh.enabled)) continue;
      r.shapes.forEach((sh, i) => { if (!sh.enabled) r.setEnabled(true, i); });
      this.regionsFixed.push(r.name);
    }
  }
  worldEvent(e) {
    switch (e.type) {
      case 'attacked': this.push('attacked', 'onAttacked', e.entity, e.by); break;
      case 'built': this.touch(); break;
      case 'boarded': this.push('boarded', 'onBoarded', e.unit, e.transport); break;
      case 'died': case 'destroyed': this.push('lost', 'onLost', e.entity); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------------------------------- core (§1.1)
  folderActive(folder) {
    if (!this.inactive.size) return true;
    let f = folder;
    for (;;) {
      if (this.inactive.has(f)) return false;
      const i = f.lastIndexOf('/');
      if (i < 0) return true;
      f = f.slice(0, i);
    }
  }
  find(ref) { return ref && typeof ref === 'object' ? ref : this.byGuid.get(ref) || this.byName.get(ref) || null; }
  // start / stop listening. While a trigger is being enabled its conditions wake one after the other (OnEnabled);
  // the expression is evaluated ONCE when all of them have their fresh state, not at each condition's Invalidate:
  // otherwise a re-enabled trigger sees the stale states of the conditions that have not woken yet and fires at once
  // (mission 15's map ping pairs M0xa / M0xb would re-enable each other for ever).
  listen(t, on) {
    if (t.live === on) return;
    t.live = on;
    if (on) { t.enabling = true; t.dirty = false; }
    for (const c of t.conds) { c.live = on; this.guard(t, c.type, () => (on ? c.onEnabled() : c.onDisabled())); if (t.live !== on) break; }
    if (!on) return;
    t.enabling = false;
    if (t.live && t.dirty) this.invalidate(t);
    for (const c of t.conds) if (c.pulseOnEnable) { c.pulseOnEnable = false; c.state = 0; }
  }
  // TRIG state 1 / level start. Already on: nothing happens, running timers go on (§8 no. 3)
  enable(t) {
    if (!t || t.enabled) return;
    t.enabled = true;
    if (t.nodeActive) this.listen(t, true);
  }
  disable(t) {
    if (!t || !t.enabled) return;
    t.enabled = false;
    this.listen(t, false);
  }
  // called by a condition whose state may have changed: evaluate now, fire at the end of the step
  invalidate(t) {
    if (!t.live) return;
    if (t.enabling) { t.dirty = true; return; }
    if (!t.evaluate()) return;
    if (t.once) this.disable(t);
    t.queued++;
    this.queue.push(t);
  }
  // ACND (§1.5): deactivating covers the folders below, activating only this folder
  setNode(path, active) {
    path = String(path || '').replace(/\/+$/, '');
    if (!path) return;
    if (active) this.inactive.delete(path); else this.inactive.add(path);
    for (const t of this.triggers) {
      if (t.folder !== path && !t.folder.startsWith(path + '/')) continue;
      const a = this.folderActive(t.folder);
      if (a === t.nodeActive) continue;
      t.nodeActive = a;
      this.listen(t, a && t.enabled);
    }
  }
  flush() {
    let n = 0;
    while (this.queue.length) {
      if (++n > 5000) { this.error(this.queue[0], 'loop', 'more than 5000 firings in one step: queue dropped'); this.queue.length = 0; break; }
      const t = this.queue.shift();
      t.queued--;
      this.fire(t);
    }
  }
  // which actions of a firing run (§1.4)
  pick(t) {
    let list = t.actions;
    if (t.byDifficulty) list = list.filter((a) => a.difficulty === this.C.difficulty);
    if (t.random && list.length) list = [list[Math.min(list.length - 1, Math.floor(this.random() * list.length))]];
    return list;
  }
  fire(t, forced = false) {
    const list = this.pick(t);
    t.fired++; t.lastFired = this.time;
    this.stats.fired++;
    const entry = { t: Math.round(this.time * 100) / 100, trigger: t.name, actions: list.map((a) => a.type) };
    if (forced) entry.forced = true;
    this.log.push(entry);
    if (this.log.length > 6000) this.log.splice(0, 1000);
    if (this.trace && typeof console !== 'undefined') console.log(`[trigger ${entry.t.toFixed(1)}s] ${t.name}: ${entry.actions.join(' ') || '-'}`);
    for (const a of list) this.run(t, a);
  }
  run(t, a) {
    const fn = ACTIONS[a.type];
    this.stats.actions++;
    if (!fn) { this.unknown('action', a.type); return; }
    try { fn(this, a.p, t, a); } catch (e) { this.error(t, a.type, e); }
  }
  // delayed work on game time (spawn queues, the 4 s before the defeat screen)
  after(seconds, fn, t = null) { this.jobs.push([this.time + Math.max(0, seconds), fn, t]); }

  // ------------------------------------------------------------------------------------------- per simulation slice
  update(dt) {
    if (!this.started) this.start();
    const G = this.G;
    if (G && G.over && this.overT < 0) return;           // the mission has ended
    this.time += dt;
    // delayed jobs
    if (this.jobs.length) {
      const due = [];
      this.jobs = this.jobs.filter((j) => (j[0] <= this.time ? (due.push(j), false) : true));
      for (const j of due) this.guard(j[2], 'job', j[1]);
    }
    if (this.overT >= 0) { this.overT -= dt; if (this.overT <= 0) { this.overT = -1; this.endNow(); } return; }
    // level timers (§6.3)
    const T = this.C.timers;
    if (T.size) for (const tm of [...T.values()]) {
      if (tm.paused || tm.cond) continue;
      tm.left -= dt;
      if (tm.left <= 0) { T.delete(tm.id); this.push('timer', 'onTimer', String(tm.id)); }
    }
    for (const c of [...this.ticking]) if (c.t.live) this.guard(c.t, c.type, () => c.tick(dt));
    // "objects changed" and the polled conditions
    const changed = this.objVersion !== this.objSeen;
    this.objSeen = this.objVersion;
    if (changed) this.push('objects', 'onObjects');
    if (this.polled.size) for (const c of [...this.polled]) {
      if (!c.t.live || c.nextPoll > this.time) continue;
      c.nextPoll = this.time + c.every;
      this.stats.polls++;
      this.guard(c.t, c.type, () => c.poll());
    }
    if (this.patrols.size) this.patrolTick(dt);
    if (this.items.length) this.itemTick(dt);
    if (this.wells.length) this.wellTick(dt);
    this.sequenceTick();
    this.flush();
  }

  // ------------------------------------------------------------------------------------------- variables (§3)
  getVar(name) { const v = this.C.variables.get(name); return v == null ? '' : v; }
  // Variables of the player's profile (VARS / CVAR with local != 1): kept between missions. Only the names of
  // Server/settings/ProfileVariables.txt exist (ActionFactory.usl:4049-4062); the campaign uses Tutorial_Started
  // (the tutorial sets it; mission 1 then plays the short intro) and Level_1_Started.
  loadProfile() {
    const P = new Map(Object.entries(PROFILE_DEFAULTS));
    try { const j = JSON.parse(localStorage.getItem('pwr.campaign.profile') || '{}'); for (const k in j) if (P.has(k)) P.set(k, String(j[k])); } catch (e) { /* no storage */ }
    return P;
  }
  setProfileVar(name, op, value) {
    const P = this.profile;
    if (!P.has(name)) return;
    const val = valueString(value, this.C.variables);
    if (op === 'set' || op === '=' || !op) P.set(name, String(val));
    else { const a = toInt(P.get(name)), b = toInt(val); P.set(name, String(op === '+' ? a + b : op === '-' ? a - b : op === '*' ? a * b : op === '/' && b !== 0 ? Math.trunc(a / b) : a)); }
    try { localStorage.setItem('pwr.campaign.profile', JSON.stringify(Object.fromEntries(P))); } catch (e) { /* no storage */ }
    this.varsChanged();
  }
  // VARS: set stores the string as it is; + - * / are integer arithmetic (a division by 0 changes nothing)
  setVar(name, op, value) {
    const V = this.C.variables;
    if (!V.has(name)) V.set(name, '0');
    const val = valueString(value, V);
    if (op === 'set' || op === '=' || !op) V.set(name, String(val));
    else {
      const a = toInt(V.get(name)), b = toInt(val);
      let r = a;
      if (op === '+') r = a + b; else if (op === '-') r = a - b; else if (op === '*') r = a * b; else if (op === '/') { if (b !== 0) r = Math.trunc(a / b); }
      V.set(name, String(r));
    }
    this.varsChanged();
  }
  varsChanged() {
    this.push('vars', 'onVars');
    if (this.infoBar) this.showInfoBar();
  }
  // INBA (§6.4): "key<TAB>arg1<TAB>arg2": %1, %2 of the text are the arguments; $(name) = a variable
  setInfoBar(text) {
    text = String(text || '');
    this.infoBar = text ? text : null;
    this.showInfoBar();
  }
  infoBarText() {
    if (!this.infoBar) return '';
    const parts = this.infoBar.split('\t');
    let s = this.C.text(parts[0]);
    const args = parts.slice(1).map((a) => valueString(a, this.C.variables));
    s = s.replace(/%(\d)/g, (m, d) => (args[+d - 1] != null ? args[+d - 1] : m));
    return s;
  }
  showInfoBar() { const M = this.G && this.G.mission; this.infoBarShown = this.infoBarText(); if (M && M.infoBar) this.guard(null, 'INBA', () => M.infoBar(this.infoBarShown)); }

  // ------------------------------------------------------------------------------------------- quests (§6.1)
  quest(p) { return this.quests.get(p.quest_guid) || this.quests.get(p.quest_name) || null; }
  // dest_state: 0 show, 1 accomplished, 2 unaccomplishable, 3 hide (ActionFactory.usl:2544-2642)
  setQuest(q, state) {
    if (!q) return;
    const M = this.G && this.G.mission;
    let change = null;
    if (state === 0) { q.accomplished = false; q.visible = true; change = 'shown'; }
    else if (state === 1) {
      if (!q.accomplished) { const b = q.bonus || {}; const v = +b[['easy', 'medium', 'hard'][this.C.difficulty]] || 0; this.boni += v; this.C.boni = this.boni; }
      q.accomplished = true; q.visible = true; change = 'done';
    } else if (state === 2) { q.unaccomplishable = true; q.visible = true; change = 'failed'; }
    else if (state === 3) { q.visible = false; change = 'hidden'; }
    if (!change) return;
    if (M && M.questChanged) this.guard(null, 'QUES', () => M.questChanged(q, change));
    this.push('quest', 'onQuest', q);
  }

  // ------------------------------------------------------------------------------------------- level timers (§6.3)
  timer(id, event, o = {}) {
    const T = this.C.timers;
    id = String(id);
    const tm = T.get(id);
    if (event === 'create') {
      // creating an existing timer restarts it (ActionFactory.usl:6030-6072)
      T.set(id, { id, left: Math.max(0, +o.duration || 0), total: Math.max(0, +o.duration || 0), show: !!o.show, label: o.label || (tm ? tm.label : ''), paused: false });
    } else if (event === 'pause') { if (tm) tm.paused = true; }
    else if (event === 'unpause') { if (tm) tm.paused = false; }
    else T.delete(id);                       // "kill" and anything else
  }

  // ------------------------------------------------------------------------------------------- sequences, dialogues
  // SQNZ: queued; the mission UI shows it (ui/mission.js playSequence) and calls back when it is over or skipped.
  // Then: the camera rule, the SQEN push (§4.3), quit = the mission is won (§5.1).
  playSequence(o) { this.seqQueue.push(o); }
  sequenceTick() {
    if (this.seqRunning || !this.seqQueue.length) return;
    const M = this.G && this.G.mission;
    if (M && M.busy && M.busy()) return;
    const o = this.seqQueue.shift();
    this.seqRunning = o;
    const C = this.C, seq = (C.data.sequences || {})[o.path] || this.findByFile(C.data.sequences, o.path);
    const W = this.W;
    // disable_fow: the area named by the action is shown for the sequence
    let reveal = null;
    if (o.fow && o.fowPos && !o.fowPos.zero && W && W.revealArea) reveal = W.revealArea(C.human, o.fowPos.x, o.fowPos.z, o.fowRadius || 30, 0);
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      this.seqRunning = null;
      if (reveal) W.hideArea(reveal);
      // camera: back where it was (the UI's part, snapBack) or to camera_data (Game.usl:1835-1853)
      const cam = this.G && this.G.rtscam;
      if (cam && o.camera && !o.camera.zero && !o.snapBack) { cam.x = o.camera.x; cam.z = o.camera.z; }
      this.lastSequence = filePart(o.path);
      this.sequencesEnded = (this.sequencesEnded || 0) + 1;
      this.push('sequence', 'onSequence', this.lastSequence);
      if (o.quit) this.win();
    };
    const opts = { camera: o.camera && !o.camera.zero ? { x: o.camera.x, z: o.camera.z } : null, snapBack: !!o.snapBack, title: seq && seq.id ? seq.id : filePart(o.path) };
    // a sequence without a file ends at once (§6.8)
    if (!M || !M.playSequence || !seq || seq.file === false) { end(); return; }
    this.guard(o.trigger, 'SQNZ', () => M.playSequence(seq || null, opts, () => this.guard(o.trigger, 'SQNZ', end)));
  }
  findByFile(table, path) {
    const f = filePart(path);
    for (const k in table || {}) if (filePart(k) === f) return table[k];
    return null;
  }
  // DGSC: the UI queues the scene; the game goes on. DSEN conditions hear its end.
  playDialog(path, t) {
    const C = this.C, M = this.G && this.G.mission;
    const scene = (C.data.dialogs || {})[path] || this.findByFile(C.data.dialogs, path);
    let done = false;
    const end = () => { if (done) return; done = true; const f = filePart(path); this.dialogsEnded.add(f); this.push('dialog', 'onDialog', f); };
    if (!M || !M.playDialog) { this.after(0, end, t); return; }
    this.guard(t, 'DGSC', () => M.playDialog(scene || { id: filePart(path).replace(/\.dlg$/, ''), path, actors: {}, frames: [], mentor: /\/mentor\//i.test(path) }, () => this.guard(t, 'DGSC', end)));
  }

  // ------------------------------------------------------------------------------------------- the end of a mission
  win(text) {
    const G = this.G;
    this.won = true;
    this.ended = { won: true, t: this.time };
    if (G && G.endMission) G.endMission(true, { text: text || '' });
  }
  // GAOV: the defeat screen 4 s later (ActionFactory.usl:2466-2539); a second GAOV meanwhile is ignored
  lose(reasonKey) {
    if (this.overT >= 0 || this.ended) return;
    this.ended = { won: false, t: this.time, reason: reasonKey };
    this.loseText = reasonKey ? this.C.text(reasonKey) : '';
    this.overT = 4;
    for (const b of (this.G && this.G.brains ? this.G.brains.values() : [])) if (b.gameOver) this.guard(null, 'GAOV', () => b.gameOver(true));
  }
  endNow() { const G = this.G; if (G && G.endMission) G.endMission(false, { text: this.loseText || '', delay: 0 }); }

  // ------------------------------------------------------------------------------------------- waypoints (WYPT, §5.3)
  // mode 0: once (the end sends OBJ_WYPT -> WAYR conditions), 1: circle, 2: back and forth. The walk is an
  // attack-move for fighters (a patrol fights what it meets and then goes on), a plain move for everything else.
  startPatrol(u, pts, mode, speed, straight) {
    if (!u || !u.alive || u.kind !== 'unit' || !pts.length) return;
    const p = { u, pts, mode, speed, straight, i: 0, dir: 1, tries: 0, wait: 0 };
    this.patrols.set(u, p);
    this.patrolGo(p);
  }
  patrolGo(p) {
    const u = p.u, [x, z] = p.pts[p.i];
    const fight = !u.cannotFight && u.stance !== 3 && u.stance !== -1 && !!u.owner;
    if (u.inside && this.W.leaveTransport) this.W.leaveTransport(u);
    this.W.order([u], { type: fight ? 'attackmove' : 'move', x, z, auto: p.speed < 3, slow: p.speed < 3 });
    if (u.task) u.task.patrol = p;
    p.task = u.task;
  }
  patrolTick(dt) {
    this.patrolT = (this.patrolT || 0) - dt;
    if (this.patrolT > 0) return;
    this.patrolT = 0.25;
    for (const p of [...this.patrols.values()]) {
      const u = p.u, k = u.task;
      if (!u.alive || this.patrols.get(u) !== p) { if (this.patrols.get(u) === p) this.patrols.delete(u); continue; }
      if (u.parked || u.inside) continue;
      const [x, z] = p.pts[p.i];
      if (k && (k.type === 'move' || k.type === 'attackmove')) {
        if (k.patrol === p) continue;
        if (Math.abs(k.x - x) < 0.6 && Math.abs(k.z - z) < 0.6) { k.patrol = p; continue; }       // back on the way after a fight
        if (k.back) continue;                                                                     // walking back to its post
        this.patrols.delete(u); continue;                                                         // somebody else gave an order
      }
      if (k && k.type === 'attack') { if (k.user) this.patrols.delete(u); continue; }             // fighting on the way
      if (!k || (k.type !== 'idle' && k.type !== 'hold' && k.type !== 'roam')) { this.patrols.delete(u); continue; }
      const d = Math.hypot(u.pos.x - x, u.pos.z - z);
      if (d > 4 + (u.radius || 0) && p.tries < 3) { p.tries++; this.patrolGo(p); continue; }       // interrupted or blocked: again
      p.tries = 0;
      // the point is reached (or cannot be): next
      const n = p.pts.length;
      if (p.mode === 0) {
        if (p.i >= n - 1) { this.patrols.delete(u); this.push('wayr', 'onWaypoint', u.rec || null); continue; }
        p.i++;
      } else if (p.mode === 1) p.i = (p.i + 1) % n;
      else { if (n > 1) { if (p.i + p.dir < 0 || p.i + p.dir >= n) p.dir = -p.dir; p.i += p.dir; } }
      if (n === 1 && p.mode !== 0) continue;
      this.patrolGo(p);
    }
  }
  stopPatrol(u) { this.patrols.delete(u); }

  // ------------------------------------------------------------------------------------------- items (ITEM, GiveItem)
  // The world has no inventory. What the missions need: an ItemSpawn object holds an item (attribute spawn_items);
  // a character of the human player that walks up to it takes it (Rec.items), which is what ITEM conditions wait for;
  // the item counts as used at once (its tech tree filter Filters/Items/<class>_filter, which TECH conditions test).
  initItems() {
    const C = this.C;
    for (const rec of C.objects.all) {
      const a = rec.data && rec.data.attr;
      if (rec.type !== 'ITSP' || !a || !a.spawn_items) continue;
      const cls = String(a.spawn_items).split('|').map((s) => s.trim()).filter(Boolean);
      if (cls.length) this.items.push({ rec, classes: cls, pos: C.objects.posOf(rec) });
    }
  }
  itemTick(dt) {
    this.itemT = (this.itemT || 0) - dt;
    if (this.itemT > 0) return;
    this.itemT = 0.5;
    const C = this.C, W = this.W, me = C.human;
    if (!me || !W.units) return;
    for (const it of this.items.slice()) {
      if (!it.rec.alive || it.rec.visible === false) continue;
      const [x, z] = it.pos;
      let taker = null;
      for (const u of W.units) {
        if (!u.alive || u.owner !== me || u.cls !== 'CHTR' || u.parked || u.inside) continue;
        if (Math.hypot(u.pos.x - x, u.pos.z - z) <= 3 + (u.radius || 0)) { taker = u; break; }
      }
      if (!taker || !taker.rec) continue;
      this.items.splice(this.items.indexOf(it), 1);
      for (const cls of it.classes) this.giveItem(taker.rec, cls, true);
      C.remove(it.rec);
    }
  }
  // ------------------------------------------------------------------------------------------- healing wells (FNTN)
  // CFountain (MiscObj.usl:2115-2260): a well holds `maxhitpoints` of healing and refills completely in `refill_dur`
  // seconds. In the original a unit is sent to it (right click, task FountainHeal) and gets what it lacks, or what
  // is left, when it arrives. The remake has no such order: a hurt unit of the human player that stands idle next
  // to a well drinks.
  initWells() {
    const C = this.C;
    for (const rec of C.objects.all) {
      if (rec.type !== 'FNTN' || !rec.data) continue;
      const a = rec.data.attr || {};
      const max = +a.maxhitpoints || 1200;
      this.wells.push({ rec, max, fill: a.hitpoints != null ? Math.min(max, +a.hitpoints || 0) : max, refill: Math.max(1, +a.refill_dur || 180), pos: C.objects.posOf(rec) });
    }
  }
  wellTick(dt) {
    this.wellT = (this.wellT || 0) - dt;
    if (this.wellT > 0) return;
    const step = 0.5 - this.wellT; this.wellT = 0.5;
    const W = this.W, me = this.C.human;
    for (const w of this.wells) {
      if (!w.rec.alive) continue;
      if (w.fill < w.max) w.fill = Math.min(w.max, w.fill + step / w.refill * w.max);       // Refill(): linear
      if (w.fill < 1 || !W.units || w.rec.visible === false) continue;
      const [x, z] = w.pos;
      for (const u of W.units) {
        if (!u.alive || u.owner !== me || u.parked || u.inside || u.hp >= u.maxHp - 0.5) continue;
        if (u.task && u.task.type !== 'idle' && u.task.type !== 'hold') continue;
        if (Math.hypot(u.pos.x - x, u.pos.z - z) > 6 + (u.radius || 0)) continue;
        const need = u.maxHp - u.hp, give = Math.min(need, w.fill);                          // ObjArrived()
        W.setHp(u, u.hp + give);
        w.fill -= give;
        this.wellsUsed = (this.wellsUsed || 0) + 1;
        if (w.fill < 1) break;
      }
    }
  }

  giveItem(rec, cls, picked) {
    rec.items = rec.items || [];
    rec.items.push(cls);
    const p = rec.owner, W = this.W;
    if (picked && p && W.setFilter) W.setFilter(p, 'Filters/Items/' + cls + '_filter', true);
    if (picked) {
      const G = this.G;
      if (G && G.hud && G.hud.message && p === this.C.human) this.guard(null, 'ITEM', () => G.hud.message(`${rec.cls.replace(/_s\d+$/, '')} found ${cls.replace(/^item_/, '').replace(/_/g, ' ')}`, 'good'));
      this.push('item', 'onItem', cls, rec);
    }
  }

  // ------------------------------------------------------------------------------------------- debug (G.campaign.debug)
  makeDebug() {
    const E = this;
    const row = (t) => ({ name: t.name, folder: t.folder, enabled: t.enabled, live: t.live, nodeActive: t.nodeActive, once: t.once, fired: t.fired, lastFired: t.lastFired, conditions: t.conds.map((c) => `${c.type}=${c.state}`).join(' '), expression: t.data.expression || '', actions: t.actions.map((a) => a.type).join(' ') });
    return {
      engine: E,
      // list('Gf') / list(/regex/) / list((row) => row.live): the triggers with their state
      list(f) {
        let l = E.triggers.map(row);
        if (typeof f === 'string') l = l.filter((r) => r.name.includes(f) || r.folder.includes(f));
        else if (f instanceof RegExp) l = l.filter((r) => f.test(r.name));
        else if (typeof f === 'function') l = l.filter(f);
        return l;
      },
      live() { return this.list((r) => r.live); },
      trigger(name) { const t = E.find(name); return t ? { ...row(t), conds: t.conds.map((c) => ({ type: c.type, state: c.state, p: c.p, info: c.info ? c.info() : undefined })), acts: t.actions } : null; },
      // why does a trigger (not) fire: every condition with its state, parameters, and - for object conditions - what
      // its query finds now (name, class, owner, map position, hidden / inside)
      why(name) {
        const t = E.find(name);
        if (!t) return null;
        const C = E.C, R = C.objects;
        const desc = (r) => { const [x, z] = R.posOf(r), m = C.toMap(x, z).map(Math.round), e = r.entity; return `${r.name}(${r.cls} p${r.slot} @${m}${e && e.parked ? ' hidden' : ''}${e && e.inside ? ' inside' : ''}${e && !e.alive ? ' DEAD' : ''})`; };
        const P = (p) => Object.entries(p).filter(([k, v]) => !/^(char_|renderable|from_condition|B_char_)/.test(k) && v !== 'NA' && v !== '-2' && v !== 'All' && v !== 'UniqueWorldRegion').map(([k, v]) => k + '=' + (/rgn_guid$/.test(k) ? C.regions.get(v).name : v)).join(' ');
        return { name: t.name, enabled: t.enabled, live: t.live, fired: t.fired, expression: t.data.expression || '(all)', value: t.evaluate(),
          conditions: t.conds.map((c, i) => { const o = { n: i + 1, type: c.type, state: c.state, p: P(c.p) }; if (c.info) o.info = c.info(); if (/^(REGN|DEAD|DYIN|OBJP|WAYR|ITEM|SGHT|ISFG)$/.test(c.type)) { const l = c.sel(); o.found = l.length; o.objects = l.slice(0, 12).map(desc); } return o; }) };
      },
      // run a trigger's actions now, whatever its conditions say
      fire(name) { const t = E.find(name); if (!t) return false; if (t.once) E.disable(t); E.fire(t, true); E.flush(); return true; },
      enable(name, on = true) { const t = E.find(name); if (!t) return false; if (on) E.enable(t); else E.disable(t); E.flush(); return true; },
      setVar(name, value) { E.setVar(name, 'set', String(value)); E.flush(); return E.getVar(name); },
      vars() { return Object.fromEntries(E.C.variables); },
      // quest('L11MQ01', 1): 0 show, 1 accomplished, 2 failed, 3 hide
      quest(name, state = 1) { const q = E.quests.get(name); if (!q) return false; E.setQuest(q, state); E.flush(); return true; },
      quests() { return (E.C.data.quests || []).map((q) => ({ name: q.name, main: q.main, visible: !!q.visible, accomplished: !!q.accomplished, unaccomplishable: !!q.unaccomplishable, headline: q.headline })); },
      // the last n firings: [{ t, trigger, actions }]
      log(n = 50) { return E.log.slice(-n); },
      print(n = 50) { return E.log.slice(-n).map((e) => `${String(e.t.toFixed(1)).padStart(7)}  ${e.trigger}: ${e.actions.join(' ')}`).join('\n'); },
      fired(name) { const t = E.find(name); return t ? t.fired : -1; },
      trace(on = true) { E.trace = !!on; return E.trace; },
      add(def) { const t = E.add(def); E.flush(); return t.name; },
      timers() { return [...E.C.timers.values()].map((t) => ({ ...t, cond: undefined })); },
      // numbers for the tests' tables
      summary() {
        return { time: Math.round(E.time), triggers: E.triggers.length, live: E.triggers.filter((t) => t.live).length, firedTriggers: E.triggers.filter((t) => t.fired).length, firings: E.stats.fired, actions: E.stats.actions,
          warnings: E.C.warnings.length, errors: E.C.errors.length, unknownConditions: [...E.unknownTypes.condition], unknownActions: [...E.unknownTypes.action], ended: E.ended || null, boni: E.boni };
      },
      status() { return { conditions: CONDITION_STATUS, actions: ACTION_STATUS }; },
    };
  }
}

// What a mission's triggers will need that must be known before the models load (setup.js plan()): the classes of
// AIFT army tables, whole tribes for AI players that are woken with a building behaviour.
export function prescan(C, aiData) { return prescanActions(C, aiData); }
