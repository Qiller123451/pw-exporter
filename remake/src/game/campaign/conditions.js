// The condition types of the campaign triggers (remake/docs/spec/triggers.md §4; original: Server/misc/
// ConditionFactory.usl = "CF"). A condition has a state 0 / 1 and tells its trigger when the state may have changed
// (inv() -> engine.invalidate). onEnabled() / onDisabled() are called when its trigger starts / stops listening.
//
// How each type hears about the world (the engine's channels, engine.js):
//   tick       TIME, RTME                    own countdown on game time
//   push       TRUE (on enable), TIMR (level timer ran out), SQEN, DSEN, QUES, CVAR (variables changed), CKGR (group
//              changed), DIPL, ISFG (attack event), WAYR (waypoint path finished), ITEM (item taken), PLDE (object lost)
//   objects    REGN, DEAD, DYIN, BLDG        re-evaluated when the set of objects changed (spawn, removal, owner,
//                                            group, appearance) - and, where a region is named, polled twice a
//                                            second because walking raises no event
//   poll       OBJP (0.25 s), PLYR, TECH (0.5 s), SGHT (2 s, as in the original), UNTT
import { compare, valueString, toInt, filePart } from './trigutil.js';

class Cond {
  constructor(E, t, type, p, i) { this.E = E; this.t = t; this.type = type; this.p = p; this.index = i; this.state = 0; this.live = false; this.init(); }
  init() {}
  onEnabled() {}
  onDisabled() {}
  inv() { this.E.invalidate(this.t); }
  // SetState + Invalidate
  set(s) { this.state = s ? 1 : 0; this.inv(); }
  // set and invalidate only if something changed (polled conditions: the poll itself is not an event)
  change(s) { s = s ? 1 : 0; if (s !== this.state) { this.state = s; this.inv(); } }
  sel(prefix = '') { return this.E.C.objects.select(this.p, prefix); }
  get vars() { return this.E.C.variables; }
  startPoll(every, first = every) { this.every = every; this.nextPoll = this.E.time + first; this.E.polled.add(this); }
  stopPoll() { this.E.polled.delete(this); }
  player(key = 'player_id') { return this.E.C.player(toInt(this.p[key])); }
  named() { const n = this.p.obj_name; return n != null && n !== '' && n !== 'NA'; }
  regional(prefix = '') { const r = this.p[prefix + 'rgn_guid']; return !!r && !this.E.C.regions.get(r).world; }
}
// an unknown type: never true (§ task 3)
class NONE extends Cond {}

// ------------------------------------------------------------------------------------------------ 4.1 time
// CF:81-232. One-shot countdown from the moment the trigger is enabled; a trigger that is not `once` restarts it
// after firing (= fires every `duration` seconds). reset = 0: a disabled timer keeps the time it had left.
class TIME extends Cond {
  init() { this.duration = Math.max(0, parseFloat(this.p.duration) || 0); this.left = null; this.reset = String(this.p.reset) !== '0'; this.show = String(this.p.show) === '1'; }
  onEnabled() {
    this.state = 0;
    if (this.left == null || this.reset || this.left <= 0) this.left = this.duration;
    this.E.ticking.add(this);
    if (this.show) this.E.C.timers.set(this.key(), { id: this.key(), left: this.left, total: this.duration, show: true, label: '', paused: false, cond: true, countup: String(this.p.countup) === '1' });
  }
  key() { return 'time:' + this.t.guid + ':' + this.index; }
  stop() { this.E.ticking.delete(this); if (this.show) this.E.C.timers.delete(this.key()); }
  onDisabled() { this.stop(); }
  tick(dt) {
    this.left -= dt;
    if (this.show) { const tm = this.E.C.timers.get(this.key()); if (tm) tm.left = Math.max(0, this.left); }
    if (this.left > 0) return;
    this.stop();
    this.left = null;
    this.state = 1;
    const once = this.t.once;
    this.inv();
    // CF:112-125: not once -> the timer starts again (and the state is 0 again after the evaluation)
    if (!once && this.t.live) this.onEnabled();
  }
  info() { return { left: this.left }; }
}
// CF:3741-3806: max(Min, random % Max) seconds
class RTME extends Cond {
  onEnabled() {
    this.state = 0;
    const min = toInt(this.p.Min), max = Math.max(1, toInt(this.p.Max));
    this.left = Math.max(min, Math.floor(this.E.random() * max));
    this.E.ticking.add(this);
  }
  onDisabled() { this.E.ticking.delete(this); }
  tick(dt) {
    this.left -= dt;
    if (this.left > 0) return;
    this.E.ticking.delete(this);
    this.state = 1;
    const once = this.t.once;
    this.inv();
    if (!once && this.t.live) this.onEnabled();
  }
  info() { return { left: this.left }; }
}
// CF:234-270: "fire as soon as this trigger is enabled"
class TRUE extends Cond { onEnabled() { this.state = 0; this.set(1); } }
// CF:272-324, ObjTime.usl:161-180: pushed when the level timer with this id runs out - also while the trigger is
// disabled (the state then stays 1). Nothing happens on enable.
class TIMR extends Cond {
  init() { this.id = String(this.p.timer_id == null || this.p.timer_id === '' ? '0' : this.p.timer_id); this.E.forever('timer', this); }
  onTimer(id) { if (id !== this.id) return; this.state = 0; this.set(1); }
}

// ------------------------------------------------------------------------------------------------ 4.2 objects
// CF:850-1033. Count test on the query result; "the whole group is in the region" for obj_type GROU.
class REGN extends Cond {
  init() { this.count = String(this.p.obj_count == null ? '' : this.p.obj_count); this.usesVars = this.count.includes('$('); this.result = []; this.sig = ''; this.group = this.p.obj_type === 'GROU'; }
  onEnabled() {
    const E = this.E;
    E.sub('objects', this);
    if (this.usesVars) E.sub('vars', this);
    if (this.regional()) this.startPoll(0.5, 0.25 + (this.t.index % 5) * 0.05);
    this.check(true);
  }
  onDisabled() { const E = this.E; E.unsub('objects', this); E.unsub('vars', this); this.stopPoll(); this.state = 0; }
  onObjects() { this.check(false); }
  onVars() { this.check(false); }
  poll() { this.check(false); }
  check(force) {
    const E = this.E, R = E.C.objects;
    let res, s;
    if (this.group) {
      // CF:873-917: every member of the group is among the result (the query runs without the type filter; by name
      // that is the group's members inside the region). An empty group or an empty result: the count test.
      const g = R.group(this.p.obj_guid) || R.group(this.p.obj_name);
      const members = g ? g.list().filter((m) => m.alive) : [];
      res = R.select({ ...this.p, obj_type: 'All' });
      if (members.length && res.length) { const set = new Set(res); s = members.every((m) => set.has(m)); } else s = compare(res.length, this.count, this.vars);
    } else {
      res = this.sel();
      s = compare(res.length, this.count, this.vars);
    }
    this.result = res;
    // the original evaluates on every push of the region; here: when the result set changed
    let sig = res.length + ':';
    if (res.length <= 24) for (const r of res) sig += (r.guid || r.name) + ',';
    const changed = sig !== this.sig || (s ? 1 : 0) !== this.state;
    this.sig = sig;
    this.state = s ? 1 : 0;
    if (force || changed) this.inv();
  }
  info() { return { count: this.result.length, test: this.count }; }
}
// CF:1349-1472 / 1478-1596. Both watch the objects the query finds; a deletion sets the state. DEAD is also true
// when a refresh finds nothing at all ("already dead or never existed") and false again when it finds something;
// DYIN stays 1 once set and is never true for an empty query. The remake has one moment for both: the death.
class DEAD extends Cond {
  init() { this.watch = new Set(); this.dying = false; }
  onEnabled() {
    const E = this.E;
    E.sub('removed', this); E.sub('objects', this);
    this.refresh();
    this.first = true;
    // the first "region push" of the original comes with the next object event: here the next step. A named region
    // is then polled (objects walk in and out without an event).
    this.startPoll(this.regional() ? 1 : 1e9, 0.05);
  }
  onDisabled() { const E = this.E; E.unsub('removed', this); E.unsub('objects', this); this.stopPoll(); }
  refresh() { this.watch = new Set(this.sel()); }
  onRemoved(rec) { if (this.watch.has(rec)) { this.watch.delete(rec); this.set(1); } }
  onObjects() { this.poll(); }
  poll() {
    this.refresh();
    if (this.dying) { if (this.state) this.inv(); return; }
    const s = this.watch.size ? 0 : 1;
    const first = this.first; this.first = false;
    if (s !== this.state || (first && s)) this.set(s);
  }
  info() { return { watching: this.watch.size }; }
}
class DYIN extends DEAD {
  init() { this.watch = new Set(); this.dying = true; }
  onRemoved(rec) { if (this.watch.has(rec)) { this.watch.delete(rec); this.set(1); } else if (this.state) this.inv(); }
}
// CF:1165-1343: an attribute of the objects of the query; the state follows the object that changed last (on enable
// all are checked in order, the last one wins). Attributes: hitpoints (with attrib_max = maxhitpoints: percent),
// level (0-based), GateState, CurTask.
class OBJP extends Cond {
  init() {
    const v = String(this.p.attrib_value == null ? '' : this.p.attrib_value).trim();
    const m = v.match(/^(<=|>=|<|>|==|=)?\s*(.*)$/);
    this.op = m[1] || '=='; this.val = m[2];
    this.attr = String(this.p.attrib_name || '').toLowerCase();
    this.max = String(this.p.attrib_max || '').toLowerCase();
    this.seen = new Map();
  }
  value(rec) {
    const e = rec.entity;
    switch (this.attr) {
      case 'hitpoints': {
        if (!e) return null;
        const hp = Math.max(0, Math.round(e.hp));
        if (this.max === 'maxhitpoints' && e.maxHp > 0) return Math.trunc(Math.max(0, e.hp) * 100 / e.maxHp);
        return hp;
      }
      case 'maxhitpoints': return e ? Math.round(e.maxHp) : null;
      case 'level': return e && e.kind === 'unit' ? e.level - 1 : null;
      case 'gatestate': return e && e.gateState != null ? e.gateState : null;
      case 'curtask': return e && e.task ? e.task.type : null;
      default: { const a = rec.data && rec.data.attr; return a && a[this.p.attrib_name] != null ? a[this.p.attrib_name] : null; }
    }
  }
  test(v) {
    if (typeof v === 'string' && !/^-?\d+$/.test(v)) return this.op === '==' || this.op === '=' ? v.toLowerCase() === String(this.val).toLowerCase() : false;
    const a = toInt(v), b = toInt(valueString(this.val, this.vars));
    switch (this.op) { case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; default: return a === b; }
  }
  onEnabled() { this.seen = new Map(); this.startPoll(0.25, 0); }
  onDisabled() { this.stopPoll(); }
  poll() {
    let s = this.state, any = false;
    for (const rec of this.sel()) {
      const v = this.value(rec);
      if (v == null) continue;
      if (this.seen.get(rec) === v) continue;
      this.seen.set(rec, v);
      s = this.test(v) ? 1 : 0; any = true;
    }
    // an object that died since the last look: its hit points went to 0 before it was deleted
    if (this.attr === 'hitpoints') for (const [rec, v] of this.seen) if (!rec.alive && v !== 0) { this.seen.set(rec, 0); s = this.test(0) ? 1 : 0; any = true; }
    if (!any) return;
    if (s !== this.state || s) this.set(s);
  }
}
// CF:2813-2977: an item of class item_class was taken by an object of the query (item_whatever = any item); also
// true on enable if such an object already carries one. A pulse.
class ITEM extends Cond {
  match(cls) { const want = String(this.p.item_class || 'item_whatever').toLowerCase(); return want === 'item_whatever' || want === String(cls).toLowerCase(); }
  onEnabled() {
    this.E.sub('item', this);
    this.state = 0;
    // already carried: true for the evaluation that ends the enabling (engine.listen), then 0 again
    for (const rec of this.sel()) if ((rec.items || []).some((c) => this.match(c))) { this.state = 1; this.pulseOnEnable = true; this.inv(); return; }
  }
  onDisabled() { this.E.unsub('item', this); }
  pulse() { this.state = 1; this.inv(); this.state = 0; }
  onItem(cls, rec) { if (this.match(cls) && this.sel().includes(rec)) this.pulse(); }
}
// CF:2983-3149: finished objects of `class` and `owner` in the query's region; optionally written to a variable
class BLDG extends Cond {
  init() { this.value = String(this.p.value == null ? '' : this.p.value); this.cls = String(this.p.class || '').toLowerCase(); this.owner = toInt(this.p.owner); this.n = -1; }
  onEnabled() { const E = this.E; E.sub('objects', this); if (this.value.includes('$(')) E.sub('vars', this); this.startPoll(1, 1); this.check(true); }
  onDisabled() { const E = this.E; E.unsub('objects', this); E.unsub('vars', this); this.stopPoll(); }
  onObjects() { this.check(false); }
  onVars() { this.check(false); }
  poll() { this.check(false); }
  count() {
    const C = this.E.C, R = C.objects, region = C.regions.get(this.p.rgn_guid);
    let n = 0;
    for (const r of R.all) {
      if (!r.alive || !r.entity || r.lc !== this.cls || r.slot !== this.owner) continue;
      const e = r.entity;
      if (e.kind === 'building' && !e.built) continue;         // CurTask != "BuildUpB"
      if (!R.inRegion(r, region)) continue;
      n++;
    }
    return n;
  }
  check(force) {
    const n = this.count(), E = this.E;
    const s = compare(n, this.value, this.vars) ? 1 : 0;
    const changed = n !== this.n || s !== this.state;
    this.n = n; this.state = s;
    if (changed && this.p.variable) { const V = E.C.variables; if (V.get(this.p.variable) !== String(n)) { V.set(this.p.variable, String(n)); E.varsChanged(); } }
    if (force || changed) this.inv();
  }
  info() { return { count: this.n }; }
}
// CF:3243-3326: polled every 2 s: an object of A sees an object of B (inside its sight range; the fog-of-war state
// of the players is ignored, §8 no. 9)
class SGHT extends Cond {
  onEnabled() { this.startPoll(2, 0); }
  onDisabled() { this.stopPoll(); }
  poll() {
    const R = this.E.C.objects, A = this.sel(''), B = this.sel('B_');
    let s = 0;
    outer: for (const a of A) {
      const e = a.entity;
      if (!e || e.parked) continue;
      const sight = (e.stats && e.stats.sight) || (e.def && e.def.sight) || 25;
      const [ax, az] = R.posOf(a);
      for (const b of B) {
        if (b === a || (b.entity && b.entity.parked)) continue;
        const [bx, bz] = R.posOf(b);
        if (Math.hypot(ax - bx, az - bz) <= sight + ((b.entity && b.entity.radius) || 0)) { s = 1; break outer; }
      }
    }
    this.change(s);
  }
}
// CF:3653-3739: at every attack event (victim, attacker): A contains the attacker and B the victim (membership
// test, §2.2: a group named in B does not match its members)
class ISFG extends Cond {
  init() { const o = this.p.B_obj_owner; this.owner = o == null || o === '' || toInt(o) < -1 ? null : toInt(o); this.last = -1; }
  onEnabled() { this.E.sub('attacked', this); }
  onDisabled() { this.E.unsub('attacked', this); }
  onAttacked(victim, attacker) {
    if (!victim || !attacker || !victim.rec || !attacker.rec) return;
    if (this.owner != null && victim.rec.slot !== this.owner) return;
    const R = this.E.C.objects;
    const s = R.matches(attacker.rec, this.p, '') && R.matches(victim.rec, this.p, 'B_') ? 1 : 0;
    if (s || s !== this.state) this.set(s);
  }
}
// CF:3328-3395: an object of the query reached the end of its waypoint path (WYPT mode 0). A pulse.
class WAYR extends Cond {
  onEnabled() { this.E.sub('wayr', this); this.state = 0; }
  onDisabled() { this.E.unsub('wayr', this); }
  onWaypoint(rec) { if (!rec || !this.sel().includes(rec)) return; this.state = 1; this.inv(); this.state = 0; }
}
// CF:3399-3508: member count of a group, on every change of the group and on enable
class CKGR extends Cond {
  init() { this.val = String(this.p.check_val == null ? '' : this.p.check_val); }
  group() { return this.E.C.objects.group(this.p.group_guid) || this.E.C.objects.group(this.p.group_name); }
  onEnabled() { const E = this.E; E.sub('group', this); if (this.val.includes('$(')) E.sub('vars', this); this.check(); }
  onDisabled() { const E = this.E; E.unsub('group', this); E.unsub('vars', this); }
  onGroup(g) { if (g === this.group()) this.check(); }
  onVars() { this.check(); }
  check() { const g = this.group(); if (!g) return; this.set(compare(g.size, this.val, this.vars)); }
  info() { const g = this.group(); return { size: g ? g.size : null }; }
}
// UniversalTutorialCondition.usl: the player did something in the interface. CAME camera moved (scroll / zoom /
// pan), TRMO a unit of B boarded a transporter of A, USEL a unit of the query is selected. Pulses.
class UNTT extends Cond {
  onEnabled() {
    const k = this.kind = String(this.p.condition_type || '').toUpperCase();
    this.state = 0;
    if (k === 'TRMO') this.E.sub('boarded', this);
    else if (k === 'CAME' || k === 'USEL') { this.cam = null; this.startPoll(0.3, 0.3); }
    else this.E.unknown('condition', 'UNTT ' + k);
  }
  onDisabled() { this.E.unsub('boarded', this); this.stopPoll(); }
  pulse() { this.state = 1; this.inv(); }
  onBoarded(u, t) { if (!u || !t || !u.rec || !t.rec) return; if (this.sel('').includes(t.rec) && this.sel('B_').includes(u.rec)) this.pulse(); }
  poll() {
    const G = this.E.G;
    if (this.kind === 'USEL') { if (G && G.sel) for (const e of G.sel) if (e.rec && this.sel().includes(e.rec)) { this.pulse(); return; } return; }
    const c = G && G.rtscam;
    if (!c) return;
    const now = [c.x, c.z, c.tDist != null ? c.tDist : c.dist, c.yaw];
    const was = this.cam; this.cam = now;
    if (!was) return;
    const ev = String(this.p.camera_event || '').toLowerCase();
    const moved = Math.hypot(now[0] - was[0], now[1] - was[1]) > 0.5, zoomed = Math.abs(now[2] - was[2]) > 0.5, turned = Math.abs(now[3] - was[3]) > 0.02;
    if (/zoom/.test(ev) ? zoomed : /pan|rot/.test(ev) ? turned : /scroll|move/.test(ev) ? moved : moved || zoomed || turned) this.pulse();
  }
}

// ------------------------------------------------------------------------------------------------ 4.3 players, level state
// CF:2455-2634: "==" compares the strings, everything else Compare(int(variable), operation + value)
class CVAR extends Cond {
  onEnabled() { this.E.sub('vars', this); this.check(); }
  onDisabled() { this.E.unsub('vars', this); }
  onVars() { this.check(); }
  check() {
    // local = 1: a level variable; else a variable of the player's profile (only the defined ones exist)
    const V = String(this.p.local) === '1' ? this.vars : this.E.profile, name = this.p.varname;
    if (!V.has(name)) return;                                   // an unknown variable leaves the state alone
    const v = String(V.get(name));
    let chk = String(this.p.value == null ? '' : this.p.value);
    if (chk[0] === '$') chk = valueString(chk, this.vars);
    const op = this.p.operation == null ? '' : String(this.p.operation);
    this.set(op === '==' ? v === chk : compare(toInt(v), op + chk, this.vars));
  }
  info() { return { value: this.vars.get(this.p.varname) }; }
}
// CF:2193-2296: 0 visible, 1 accomplished, 2 unaccomplishable, 3 none of them; once true it stops listening
class QUES extends Cond {
  onEnabled() { this.E.sub('quest', this); this.check(); }
  onDisabled() { this.E.unsub('quest', this); }
  onQuest() { this.check(); }
  check() {
    const q = this.E.quest(this.p), d = toInt(this.p.dest_state);
    if (!q) { this.set(0); return; }
    const ok = d === 0 ? !!q.visible : d === 1 ? !!q.accomplished : d === 2 ? !!q.unaccomplishable : d === 3 ? !q.accomplished && !q.unaccomplishable && !q.visible : false;
    if (ok) this.E.unsub('quest', this);
    this.set(ok);
  }
}
// CF:1039-1159: a player attribute against a count expression
class PLYR extends Cond {
  init() { this.val = String(this.p.attrib_value == null ? '' : this.p.attrib_value); }
  value() {
    const p = this.player();
    if (!p) return null;
    switch (String(this.p.attrib_name || '').toLowerCase()) {
      case 'food': return Math.floor(p.res.food); case 'wood': return Math.floor(p.res.wood); case 'stone': return Math.floor(p.res.stone);
      case 'iron': case 'skulls': return Math.floor(p.res.skulls);
      case 'units': return p.units;
      case 'max_food': case 'rescap_food': return p.caps.food; case 'max_wood': case 'rescap_wood': return p.caps.wood; case 'max_stone': case 'rescap_stone': return p.caps.stone;
      default: return null;
    }
  }
  onEnabled() { if (this.val.includes('$(')) this.E.sub('vars', this); this.startPoll(0.5, 0); }
  onDisabled() { this.E.unsub('vars', this); this.stopPoll(); }
  onVars() { this.poll(); }
  poll() { const v = this.value(); if (v == null) return; this.change(compare(v, this.val, this.vars)); }
}
// CF:330-405: the player's tech tree has the filter. Not checked on enable but on the player's next push.
class TECH extends Cond {
  onEnabled() { this.startPoll(0.5, 0.1); }
  onDisabled() { this.stopPoll(); }
  poll() {
    const p = this.player('player'), W = this.E.W;
    if (!p || !W.hasFilter) return;
    this.change(W.hasFilter(p, String(this.p.filter || '').replace(/^\//, '')));
  }
}
// CF:1701-2026: "the player is defeated": when it loses an object and has nothing left that counts in the unit
// limit (check_pyramid) and - check_producer: nothing that can produce units / check_bldgs: no building except
// walls, gates, traps / check_none: nothing more to check
class PLDE extends Cond {
  onEnabled() { this.E.sub('lost', this); }
  onDisabled() { this.E.unsub('lost', this); }
  onLost(e) {
    const p = this.player(), W = this.E.W;
    if (!p || !e || e.owner !== p) return;
    const flag = (k, d) => String(this.p[k] == null ? d : this.p[k]) === '1';
    const units = W.units.filter((u) => u.alive && u !== e && u.owner === p && !u.parked);
    const blds = W.buildings.filter((b) => b.alive && b !== e && b.owner === p);
    if (flag('check_pyramid', '1') && units.some((u) => u.countsInPop !== false)) return;
    if (flag('check_producer', '1')) {
      if (blds.some((b) => b.built !== false && this.produces(b)) || units.some((u) => this.produces(u))) return;
    } else if (flag('check_bldgs', '0')) {
      if (blds.some((b) => !(b.def && (b.def.wallKind || b.def.gate || /trap/.test(b.name))))) return;
    }
    this.set(1);
  }
  produces(e) {
    const D = this.E.G && this.E.G.data;
    try { if (D && D.actionsOf && e.rulesOwner) return D.actionsOf(e.rulesOwner(), e).some((a) => a.kind === 'Build' && /^(CHTR|ANML|VHCL|SHIP)$/.test(a.type)); } catch (x) { /* fall through */ }
    return e.kind === 'building' && !(e.def && (e.def.wallKind || e.def.gate));
  }
}
// CF:2637-2711: relation of plyr1 towards plyr2 (0 hostile, 1 neutral, 2 friendly)
class DIPL extends Cond {
  onEnabled() { this.E.sub('diplomacy', this); this.check(); }
  onDisabled() { this.E.unsub('diplomacy', this); }
  onDiplomacy() { this.check(); }
  check() {
    const C = this.E.C, a = C.player(toInt(this.p.plyr1)), b = C.player(toInt(this.p.plyr2));
    if (!a || !b) return;
    this.set(a.relation(b) === toInt(this.p.relation));
  }
}
// CF:2301-2380: subscribed for the whole level; true from the end of that sequence until the end of another one;
// enabling the trigger resets it
class SQEN extends Cond {
  init() { this.file = filePart(this.p.sequence_name); this.E.forever('sequence', this); }
  onEnabled() { this.set(0); }
  onSequence(file) { this.set(file === this.file); }
}
// CF:2382-2449: 1 when the dialogue scene has ended, for the rest of the level
class DSEN extends Cond {
  init() { this.file = filePart(this.p.dlgscene_name); this.E.forever('dialog', this); }
  onDialog(file) { if (file === this.file) this.set(1); }
}

export const CONDITIONS = { NONE, TIME, RTME, TRUE, TIMR, REGN, DEAD, DYIN, OBJP, ITEM, BLDG, SGHT, ISFG, WAYR, CKGR, UNTT, CVAR, QUES, PLYR, TECH, PLDE, DIPL, SQEN, DSEN };

// status of every condition type of triggers.md §4 in the remake (docs/CAMPAIGN_RUNTIME.md §11 prints this table)
export const CONDITION_STATUS = {
  TIME: ['implemented', 'countdown on game time; show = 1 puts it into G.campaign.timers (id "time:<trigger>:<n>")'],
  RTME: ['implemented', ''],
  TIMR: ['implemented', 'pushed also while its trigger is disabled'],
  TRUE: ['implemented', ''],
  REGN: ['implemented', 'evaluated on object events and twice a second for a named region; fires when the result set changes'],
  DEAD: ['implemented', 'at the moment of death / deletion; true for an empty query at the first check after enabling'],
  DYIN: ['implemented', 'same moment as DEAD (the remake has no separate "corpse gone" event)'],
  OBJP: ['implemented', 'polled 4 × per second: hitpoints (percent with attrib_max), level, GateState, CurTask'],
  ITEM: ['approximated', 'items are taken by walking up to an ItemSpawn object (engine.js items); no inventory'],
  BLDG: ['implemented', ''],
  SGHT: ['approximated', 'sight range of the A objects, polled every 2 s, the fog of war is ignored'],
  ISFG: ['implemented', 'on the world\'s "attacked" event (a hit), not on the order'],
  WAYR: ['implemented', ''],
  CKGR: ['implemented', ''],
  UNTT: ['approximated', 'CAME (camera polled), TRMO (boarded event), USEL (selection polled); other kinds never true'],
  CVAR: ['implemented', ''],
  QUES: ['implemented', ''],
  PLYR: ['implemented', 'polled: food, wood, stone, iron, units'],
  TECH: ['implemented', 'polled'],
  PLDE: ['approximated', 'checked when the player loses an object; "producer" = a building or unit with a unit action'],
  DIPL: ['implemented', ''],
  SQEN: ['implemented', ''],
  DSEN: ['implemented', ''],
};
