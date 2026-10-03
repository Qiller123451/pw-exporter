// The action types of the campaign triggers (remake/docs/spec/triggers.md §5; original: Server/misc/
// ActionFactory.usl = "AF"). An action is a function (E, p, t, a): E = the TriggerEngine, p = its parameters with the
// editor's defaults applied, t = the firing trigger. Actions use the mission-level calls of the Campaign
// (setup.js: map coordinates, player slots) and the World scripting API (game/scripting.js); see
// docs/CAMPAIGN_RUNTIME.md. An action that finds nothing to work on does nothing; an exception is caught by the
// engine and recorded in G.campaign.errors.
import { toInt, valueString } from './trigutil.js';

const on = (v, d = false) => (v == null || v === '' ? d : v === true || v === '1' || v === 'true' || v === 1);
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const lines = (s) => String(s == null ? '' : s).split(/[\n;]+/).map((x) => x.trim()).filter((x) => x && x !== 'NA');
const guids = (s) => String(s == null ? '' : s).split(/[\s,;|]+/).filter((x) => x && x !== 'NA');
const STD_PYRAMID = [25, 15, 8, 3, 1];

// the objects of an action's query (§2); from_condition = i: the result of condition i of the same trigger (REGN)
function objs(E, p, t, prefix = '') {
  const fc = toInt(p[prefix + 'from_condition'] == null ? -1 : p[prefix + 'from_condition']);
  if (fc >= 0 && t && t.conds[fc] && Array.isArray(t.conds[fc].result)) return t.conds[fc].result.filter((r) => r.alive);
  return E.C.objects.select(p, prefix);
}
const ents = (list) => list.map((r) => r.entity).filter((e) => e && e.alive);
const units = (list) => ents(list).filter((e) => e.kind === 'unit');
const slotOf = (v, d) => (v == null || v === '' ? d : toInt(v));
const brain = (E, slot) => { const B = E.G && E.G.brains; return B && B.get ? B.get(slot) || null : null; };
const posOf = (E, rec) => E.C.objects.posOf(rec);

// --------------------------------------------------------------------------------------------- 5.3 ACDO
// AF:1112-1692. additional_params is split at '|'.
const DO = {
  // "[x y z] | speed": a plain walk; a unit inside a transporter gets out first (AF:1183-1192, 1424-1426)
  WalkAction(E, u, rec, prm) {
    const v = E.C.vec(prm[0]);
    if (!v || prm.length < 2 || !u || u.kind !== 'unit') return;
    if (u.inside && E.W.leaveTransport) E.W.leaveTransport(u);
    E.stopPatrol(u);
    E.W.order([u], { type: 'move', x: v.x, z: v.z, slow: num(prm[1], 2) < 3 });
  },
  // attack-move to the point (AF:1196-1197); the number and the dst query are not used
  'Aggressive Walk'(E, u, rec, prm) {
    const v = E.C.vec(prm[0]);
    if (!v || !u || u.kind !== 'unit') return;
    if (u.inside && E.W.leaveTransport) E.W.leaveTransport(u);
    E.stopPatrol(u);
    E.W.order([u], { type: 'attackmove', x: v.x, z: v.z });
  },
  // the target of the dst query nearest to the actor (AF:1440-1450)
  Attack(E, u, rec, prm, targets) {
    if (!u || u.kind !== 'unit') return;
    let best = null, bd = Infinity;
    for (const r of targets) {
      const e = r.entity;
      if (!e || !e.alive || e === u || e.parked) continue;
      const d = Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    E.stopPatrol(u);
    E.W.order([u], { type: 'attack', target: best });
  },
  // teleport (AF:1207-1217)
  SetPos(E, u, rec, prm) { const v = E.C.vec(prm[0]); if (!v) return; if (u) E.stopPatrol(u); E.C.teleport(rec, v.mx, v.my); E.touch(); },
  // break the task and face the point (AF:1198-1206)
  RotateTo(E, u, rec, prm) {
    const v = E.C.vec(prm[0]);
    if (!v || !u || u.kind !== 'unit') return;
    E.stopPatrol(u);
    E.W.order([u], { type: 'stop' });
    u.heading = Math.atan2(-(v.x - u.pos.x), -(v.z - u.pos.z));
    if (u.syncObj) u.syncObj();
  },
  // "name | loops" (AF:1452-1472): gates of the scenery (open / close), poses
  SetAnim(E, u, rec, prm) {
    const name = prm[0];
    if (!name) return;
    if (!E.C.playAnim(rec, name, Math.max(1, toInt(prm[1])))) { rec.animWanted = name; }
    // an opened scenery gate lets units through, a closed one blocks again
    if (rec.prop && rec.prop.setBlocking && /^(open|close)$/.test(name)) rec.prop.setBlocking(name === 'close');
  },
  // "Enable" | "Disable" | "Timer: seconds" (AF:1496-1514)
  Invulnerability(E, u, rec, prm) {
    if (!u) return;
    const [k, v] = String(prm[0] || '').split(':').map((s) => s.trim());
    if (/^timer/i.test(k)) E.W.setInvulnerable(u, true, num(v, 0)); else E.W.setInvulnerable(u, /^enable/i.test(k));
  },
  AbortTask(E, u) { if (u && u.kind === 'unit') { E.stopPatrol(u); E.W.order([u], { type: 'stop' }); } },
  Stop(E, u) { if (u && u.kind === 'unit') { E.stopPatrol(u); E.W.order([u], { type: 'stop' }); } },
  // a normal death (AF:1474-1480); scenery is just removed
  Kill(E, u, rec) { if (u) { if (u.parked) E.W.setParked(u, false); u.invulnT = 0; E.W.kill(u, null); } else E.C.remove(rec); },
  FullHeal(E, u) { if (u) E.W.setHp(u, u.maxHp); },
  'Open Gate'(E, u, rec) { gate(E, u, rec, 0); },
  'Close Gate'(E, u, rec) { gate(E, u, rec, 1); },
  'Auto Gate'(E, u, rec) { gate(E, u, rec, 2); },
  SetRallyPoint(E, u, rec, prm) { const v = E.C.vec(prm[0]); if (u && v && !v.zero) u.rally = [v.x, v.z]; },
  // the actor receives the first object of the dst query as an item; the next actor gets the next (AF:1390-1395).
  // The remake has no item objects: an item of the wanted class that somebody carries changes hands.
  GiveItem(E, u, rec, prm, targets, p) {
    const cls = String(p.dst_obj_class || '').toLowerCase();
    if (!/^item_/.test(cls)) return;
    for (const r of E.C.objects.all) { const i = (r.items || []).findIndex((c) => c.toLowerCase() === cls); if (i >= 0 && r !== rec) { r.items.splice(i, 1); E.giveItem(rec, cls, false); return; } }
  },
  // a worker is sent to build / finish the first building of the dst query
  BuildUp(E, u, rec, prm, targets) { const b = ents(targets).find((e) => e.kind === 'building'); if (u && b && u.kind === 'unit') E.W.order([u], { type: 'build', target: b }); },
  JumpOffWall() {},
};
function gate(E, u, rec, state) {
  if (u && u.kind === 'building' && u.def && u.def.gate && E.W.setGate) { E.W.setGate(u, state); return; }
  if (rec.prop) { E.C.playAnim(rec, state === 0 ? 'open' : 'close', 1); if (rec.prop.setBlocking) rec.prop.setBlocking(state !== 0); }
}

// --------------------------------------------------------------------------------------------- spawning
// "<class>[§<buildup>] <level> <count>|..." (level 1-based, AF:4814-4818)
function parseClasses(s) {
  const out = [];
  for (const e of String(s || '').split('|')) {
    const w = e.trim().split(/\s+/);
    if (!w[0]) continue;
    const [cls, buildup] = w[0].split('§');
    out.push({ cls, buildup: buildup || null, level: Math.max(1, toInt(w[1] || '1')), count: Math.max(1, w[2] == null ? 1 : toInt(w[2])) });
  }
  return out;
}
// the unit limit of the owner for one more unit of a (1-based) level: CheckUnits(owner, level)
function slotFree(E, owner, level) {
  if (!owner) return true;
  const pyr = owner.pyramid || (E.G && E.G.data && E.G.data.pyramid) || STD_PYRAMID;
  return (owner.atLevel[level - 1] || 0) < (pyr[level - 1] != null ? pyr[level - 1] : STD_PYRAMID[level - 1]);
}
// where a unit that comes out of a spawn building appears. The original creates it at the building's link point
// Spwn and lets it walk through Ex_1 to `pos` (MiscObj.usl:2291-2500); the remake has no link points: the unit
// appears on the line between the building and `pos`, as close to the building as free ground reaches from `pos`
// (so it is never put behind the building's wall, where it could not come out).
function exitPoint(E, src, target) {
  const W = E.W, [sx, sz] = posOf(E, src);
  const nav = W.nav;
  if (!nav || !nav.isFree) return target ? [target.x, target.z] : [sx, sz];
  if (!target) return W.freeSpot ? W.freeSpot(sx, sz, {}) : [sx, sz];
  let tx = target.x, tz = target.z;
  if (!nav.isFree(tx, tz) && W.freeSpot) [tx, tz] = W.freeSpot(tx, tz, {});
  const dx = sx - tx, dz = sz - tz, L = Math.hypot(dx, dz);
  let best = [tx, tz];
  for (let d = 1; d <= L; d += 1) {
    const x = tx + dx / L * d, z = tz + dz / L * d;
    if (!nav.isFree(x, z)) break;
    best = [x, z];
  }
  return best;
}
function spawnOne(E, cls, slot, x, z, level, group, t, exact) {
  const C = E.C, [mx, my] = C.toMap(x, z);
  const rec = C.spawn(cls, slot, mx, my, { level, group: group || undefined, exact });
  if (!rec) E.warn(`${t ? t.name : 'trigger'}: ${cls} could not be created`);
  return rec;
}

export const ACTIONS = {
  // ------------------------------------------------------------------------------------------- 5.1 flow
  // AF:2203-2253: 1 enable, 0 disable, 2 toggle; a trigger that does not exist (not compiled): nothing
  TRIG(E, p) {
    const t = E.byGuid.get(p.guid);
    if (!t) return;
    const s = toInt(p.state);
    if (s === 1 || (s === 2 && !t.enabled)) E.enable(t); else E.disable(t);
  },
  ACND(E, p) { E.setNode(p.nodename, toInt(p.deststate) === 1); },
  QUIT(E) { E.win(); },
  GAOV(E, p) { E.lose(p.reason); },
  BONI(E, p) { E.boni += toInt(p.points); E.C.boni = E.boni; },
  // debug texts of the designers: only shown with Server/Trigger/EnableFDBK (AF:2168-2171)
  FDBK(E, p, t) { if (E.trace && typeof console !== 'undefined') console.log('[FDBK]', t.name, p.msg_text); },
  SQNZ(E, p, t) {
    const C = E.C;
    E.playSequence({ path: p.sequence, quit: on(p.quit), reason: p.reason, snapBack: on(p.snap_cam_back), camera: C.vec(p.camera_data), fow: on(p.disable_fow), fowPos: C.vec(p.fow_pos), fowRadius: num(p.fow_radius, 30), trigger: t });
  },
  DGSC(E, p, t) { E.playDialog(p.scene, t); },

  // ------------------------------------------------------------------------------------------- 5.2 quests, markers, UI
  QUES(E, p) { E.setQuest(E.quest(p), toInt(p.dest_state)); },
  QMRK(E, p) { E.C.setQuestionMark(p.questionmark, p.questionstate || 'STATE_INVISIBLE', p.questiontooltip ? E.C.text(p.questiontooltip) : undefined); },
  // AF:2919-3062: a marker at `pos` (pos_objquery_flag = 1 and pos not zero) or one per object of the query
  MPNG(E, p, t) {
    const M = E.G && E.G.mission, C = E.C;
    const id = String(p.id == null ? '' : p.id);
    if (on(p.add_remove)) { E.markers.delete(id); if (M && M.removeMarker) M.removeMarker(id); return; }
    const owner = String(p.owner == null ? 'All' : p.owner);
    const human = C.human ? C.human.id : 0;
    const kind = p.colortype || 'FixedColor';
    const rgb = String(p.fixedcolor || '255:0:0').split(':').map((x) => toInt(x) & 255);
    const color = { SPMainQuest: 0xffd23c, SPOptQuest: 0x4cc3ff, SPHint: 0x6ee06e, Attack: 0xff3a2a }[kind] || ((rgb[0] << 16) | (rgb[1] << 8) | (rgb[2] || 0));
    const base = { id, color, kind, extended: on(p.extended), ttl: num(p.time_to_life, 5000) / 1000, repeats: toInt(p.num_repeats), interval: num(p.ms_between, 500) / 1000 };
    const v = C.vec(p.pos);
    const add = (m) => { E.markers.set(id, (E.markers.get(id) || 0) + 1); if (M && M.marker) M.marker(m); };
    if (on(p.pos_objquery_flag) && v && !v.zero) {
      if (owner === 'All' || owner === 'trigger obj' || toInt(owner) === human) add({ ...base, x: v.x, z: v.z, entity: null });
      return;
    }
    for (const rec of objs(E, p, t)) {
      if (owner === 'trigger obj' ? rec.slot !== human : owner !== 'All' && toInt(owner) !== human) continue;
      const [x, z] = posOf(E, rec);
      add({ ...base, x, z, entity: rec.entity || null });
    }
  },
  INBA(E, p) { E.setInfoBar(p.text); },
  // AF:6006-6106, §6.3
  TIMR(E, p) {
    const ev = String(p.event || 'create');
    E.timer(p.timer_id == null || p.timer_id === '' ? '1' : p.timer_id, ev, { duration: num(valueString(p.duration, E.C.variables), 0), show: on(p.show, true), label: p.tooltip ? E.C.text(p.tooltip) : '' });
  },
  PSND(E, p) {
    const A = E.G && E.G.audio;
    const pl = p.player == null || p.player === '' ? 0 : toInt(p.player);
    if (!A || !A.play || !(pl === -1 || pl === (E.C.human ? E.C.human.id : 0))) return;
    const v = E.C.vec(p.position);
    A.play(p.soundname, v && !v.zero && E.W.height ? { x: v.x, y: E.W.height(v.x, v.z), z: v.z } : null);
  },

  // ------------------------------------------------------------------------------------------- 5.3 objects
  ACDO(E, p, t) {
    const act = String(p.action || '').trim();
    const fn = DO[act];
    if (!fn) { E.unknown('action', 'ACDO ' + act); return; }
    const prm = String(p.additional_params == null ? '' : p.additional_params).split('|').map((s) => s.trim());
    const actors = objs(E, p, t).slice();
    // Invulnerability by region: the campaign protects "everything in the fight area" until its scene starts and
    // lifts it with the same region query. The remake's wild animals roam further than the original's (which keep
    // to their nest's area), so one that walked out in between would stay invulnerable for good - and "kill all
    // Smilodons" could never be fulfilled. A Disable therefore also reaches what the same region's Enable protected.
    if (act === 'Invulnerability' && E.C.regions.find(p.rgn_guid)) {
      const key = String(p.rgn_guid), on = /^(enable|timer)/i.test(prm[0] || '');
      if (on) for (const rec of actors) { if (rec.entity) rec.entity.invulnRegion = key; }
      else {
        const R = E.C.objects, seen = new Set(actors), q = { ...p, rgn_guid: 'UniqueWorldRegion' };
        for (const rec of R.all) if (rec.alive && rec.entity && rec.entity.invulnRegion === key && !seen.has(rec) && R.matches(rec, q, '')) actors.push(rec);
        for (const rec of actors) if (rec.entity) rec.entity.invulnRegion = null;
      }
    }
    const needTargets = act === 'Attack' || act === 'GiveItem' || act === 'BuildUp';
    const targets = needTargets ? objs(E, p, t, 'dst_') : [];
    if (!actors.length) return;
    for (const rec of actors) {
      const e = rec.entity && rec.entity.alive ? rec.entity : null;
      E.guard(t, 'ACDO ' + act, () => fn(E, e, rec, prm, targets, p));
    }
  },
  // AF:1769-1970: every object walks the points (map coordinates "x y z|..."; 0 0 0 entries are skipped)
  WYPT(E, p, t) {
    const C = E.C, pts = [];
    for (const s of String(p.waypoints || '').split('|')) { const v = C.vec(s); if (v && !v.zero) pts.push([v.x, v.z]); }
    if (!pts.length) return;
    const mode = toInt(p.patrolmode), speed = num(p.walkspeed, 2), straight = on(p.straightwalk);
    for (const u of units(objs(E, p, t))) E.startPatrol(u, pts, mode, speed, straight);
  },
  // AF:745-896: one object of class obj_name
  COBJ(E, p, t) {
    const C = E.C;
    let v = C.vec(p.obj_pos), rot = C.vec(p.obj_rot);
    let heading = rot ? rot.mz : num(p.obj_rot, 0);
    if (on(p.pos_from_obj)) {
      const r = objs(E, p, t, 'trgt_')[0];
      if (r) { const [x, z] = posOf(E, r); const [mx, my] = C.toMap(x, z); v = { x, z, mx, my }; heading = r.entity ? r.entity.heading || 0 : r.prop ? r.prop.rot || 0 : heading; }
    }
    if (!v) return;
    const slot = slotOf(p.obj_owner, -1), level0 = Math.max(0, toInt(p.obj_level));
    if (!on(p.ignore_pyramid, true) && !slotFree(E, C.player(slot), level0 + 1)) return;
    const rec = C.spawn(p.obj_name, slot, v.mx, v.my, { level0, rot: heading });
    if (!rec) E.warn(`${t.name}: COBJ ${p.obj_name} could not be created`);
  },
  // AF:661-738; new_owner missing = the human player
  OCPY(E, p, t) { const slot = slotOf(p.new_owner, 0); for (const rec of objs(E, p, t)) E.C.setOwner(rec, slot); E.touch(); },
  // AF:227-328: only hitpoints occurs
  UNIT(E, p, t) {
    const name = String(p.attrib_name || '').toLowerCase(), mod = String(p.attrib_mod == null ? '' : p.attrib_mod).trim();
    if (name !== 'hitpoints') { E.unknown('action', 'UNIT ' + p.attrib_name); return; }
    const n = parseFloat(mod.replace(/^[+=]/, '')) || 0;
    for (const e of ents(objs(E, p, t))) E.W.setHp(e, mod[0] === '+' || mod[0] === '-' ? e.hp + n : n);
  },
  // AF:4766-5023
  SPGR(E, p, t) {
    const C = E.C, W = E.W;
    const slot = slotOf(p.owner, 0), owner = C.player(slot);
    const group = C.objects.group(p.group);
    const v = C.vec(p.pos);
    const list = [];
    for (let i = 0; i < 5; i++) for (const e of parseClasses(p['classes_' + i])) {
      // checkpyramid: skip a class when the owner has the standard maximum of characters of that level (AF:4838-4842)
      if (on(p.checkpyramid) && owner && W.units) { const n = W.units.filter((u) => u.alive && u.owner === owner && u.cls === 'CHTR' && u.level === e.level).length; if (n >= STD_PYRAMID[e.level - 1]) continue; }
      for (let k = 0; k < e.count; k++) list.push(e);
    }
    if (!list.length) return;
    const src = on(p.use_spawn_obj) ? objs(E, p, t)[0] || null : null;
    if (!src) {
      if (!v) return;
      for (const e of list) spawnOne(E, e.cls, slot, v.x, v.z, e.level, group, t, false);
      return;
    }
    // out of a building: one unit every spawn_delay seconds, the first at once; each walks on to `pos`
    const delay = Math.max(0, num(p.spawn_delay, 0));
    const target = v && !v.zero ? v : null;
    DO.SetAnim(E, null, src, ['open', '1']);
    if (src.entity && src.entity.kind === 'building' && target) src.entity.rally = [target.x, target.z];
    list.forEach((e, i) => E.after(i * delay, () => {
      const [x, z] = src.alive ? exitPoint(E, src, target) : target ? [target.x, target.z] : posOf(E, src);
      const rec = spawnOne(E, e.cls, slot, x, z, e.level, group, t, false);
      const u = rec && rec.entity;
      if (u && u.kind === 'unit' && target) W.order([u], { type: 'move', x: target.x, z: target.z, auto: true });
    }, t));
    E.after((list.length - 1) * delay + 2.5, () => { if (src.alive) DO.SetAnim(E, null, src, ['close', '1']); }, t);
  },
  // AF:2644-2865: a transporter with passengers "class/level|..." (levels 1-based)
  CPLX(E, p, t) {
    const C = E.C, W = E.W, v = C.vec(p.obj_pos);
    if (!v) return;
    const slot = slotOf(p.obj_owner, -1);
    const lvl = Math.max(1, toInt(p.cptlvl || '1'));
    if (!on(p.ignore_pyramid, true) && !slotFree(E, C.player(slot), lvl)) return;
    const tr = C.spawn(p.obj_name, slot, v.mx, v.my, { level: lvl });
    if (!tr || !tr.entity) { E.warn(`${t.name}: CPLX ${p.obj_name} could not be created`); return; }
    E.after(0.2, () => {
      const T = tr.entity;
      if (!T || !T.alive) return;
      for (const e of String(p.passengers || '').split('|')) {
        const [cls, lv] = e.trim().split('/');
        if (!cls) continue;
        const cap = W.capacity ? W.capacity(T) : 0;
        if ((T.passengers || []).length >= cap) break;
        const [mx, my] = C.toMap(T.pos.x, T.pos.z);
        const r = C.spawn(cls, slot, mx, my, { level: Math.max(1, toInt(lv || '1')), exact: true });
        if (!r || !r.entity) { E.warn(`${t.name}: CPLX passenger ${cls} could not be created`); continue; }
        if (W.enterTransport && r.entity.kind === 'unit') W.enterTransport(r.entity, T);
      }
    }, t);
  },
  // AF:4334-4406: the FIRST object of the query becomes an object of class new_obj (same place, rotation, owner)
  REPL(E, p, t) {
    const C = E.C, rec = objs(E, p, t)[0];
    if (!rec) return;
    const [x, z] = posOf(E, rec), [mx, my] = C.toMap(x, z);
    const e = rec.entity, slot = rec.slot;
    const rot = e ? e.heading || 0 : rec.prop ? rec.prop.rot || 0 : 0;
    const y = rec.prop ? rec.prop.pos.y : null;
    const group = rec.group;
    C.remove(rec);
    const n = C.spawn(p.new_obj, slot, mx, my, { level0: Math.max(0, toInt(p.obj_level)), rot, exact: !e || e.kind !== 'unit', y });
    if (!n) E.warn(`${t.name}: REPL ${p.new_obj} could not be created`);
    else if (group) C.objects.addToGroup(group, n);
  },
  // AF:4276-4332: maxobjs >= 0 limits the number (0 deletes nothing)
  DELO(E, p, t) {
    const max = p.maxobjs == null || p.maxobjs === '' ? -1 : toInt(p.maxobjs);
    let n = 0;
    for (const rec of objs(E, p, t)) { if (max >= 0 && n >= max) break; E.C.remove(rec); n++; }
  },
  // AF:5026-5115
  ADGR(E, p, t) {
    const R = E.C.objects, g = R.group(p.group);
    if (!g) return;
    if (on(p.selector_enabled, true)) for (const rec of objs(E, p, t)) if (!rec.groupObj) R.addToGroup(g, rec);
    for (const id of guids(p.add_to_group_units)) { const rec = R.byGuid(id); if (rec) R.addToGroup(g, rec); }
  },
  // AF:5117-5301: mount = 1: transporters (sub_ query) take the nearest passengers (query); 0: transporters of the
  // first query unload
  TRSP(E, p, t) {
    const R = E.C.objects, W = E.W;
    const a = on(p.enable_objsel, true) ? objs(E, p, t) : [];
    for (const id of guids(p.objects_units)) { const r = R.byGuid(id); if (r) a.push(r); }
    if (on(p.mount)) {
      const b = on(p.enable_subsel, true) ? objs(E, p, t, 'sub_') : [];
      for (const id of guids(p.subjects_units)) { const r = R.byGuid(id); if (r) b.push(r); }
      const free = new Set(units(a).filter((u) => !u.inside));
      for (const T of ents(b)) {
        let room = (W.capacity ? W.capacity(T) : 0) - (T.passengers || []).length;
        if (room <= 0) continue;
        free.delete(T);
        const near = [...free].filter((u) => W.canBoard(u, T)).sort((x, y) => Math.hypot(x.pos.x - T.pos.x, x.pos.z - T.pos.z) - Math.hypot(y.pos.x - T.pos.x, y.pos.z - T.pos.z));
        for (const u of near) { if (room-- <= 0) break; free.delete(u); E.stopPatrol(u); W.order([u], { type: 'board', target: T }); }
      }
      return;
    }
    for (const T of ents(a)) if (T.passengers && T.passengers.length && W.unloadAll) { W.unloadAll(T, false); E.touch(); }
  },
  // a particle effect: decoration, not shown
  EFCT() {},
  // AF:2258-2337: all appearance bits at once
  OBAP(E, p, t) { const f = toInt(p.flags); for (const rec of objs(E, p, t)) E.C.setAppearance(rec, f); E.touch(); },

  // ------------------------------------------------------------------------------------------- 5.4 players, world
  // AF:3955-4114; local = 1: a level variable, else one of the player's profile
  VARS(E, p) {
    if (!p.varname) return;
    if (String(p.local) === '1') E.setVar(p.varname, String(p.operation || 'set'), p.value == null ? '' : p.value);
    else E.setProfileVar(p.varname, String(p.operation || 'set'), p.value == null ? '' : p.value);
  },
  // AF:334-511: the list "name|mod|cap:..." wins over the single parameters
  RSRC(E, p) {
    const pl = E.C.player(slotOf(p.player_id, 0));
    if (!pl) return;
    const list = String(p.res_rsrclist || '').split(':').map((s) => s.trim()).filter(Boolean);
    if (list.length) for (const e of list) { const [n, m, c] = e.split('|'); if (n && m != null) E.W.setResource(pl, n, m, on(c)); }
    else if (p.res_name) E.W.setResource(pl, p.res_name, p.res_mod == null ? '0' : p.res_mod, on(p.res_cap));
  },
  // AF:2343-2461: lines "player|1 enable / 0 disable|path"
  TECH(E, p) {
    for (const l of lines(p.filters)) {
      const [pl, act, path] = l.split('|');
      const P = E.C.player(toInt(pl));
      if (P && path) E.W.setFilter(P, path.trim(), toInt(act) === 1);
    }
  },
  // AF:3246-3334: lines "plyr1|relation|plyr2", one direction each
  DIPL(E, p) {
    for (const l of lines(p.changes)) {
      const [a, rel, b] = l.split('|').map((s) => toInt(s));
      const A = E.C.player(a), B = E.C.player(b);
      if (A && B && A !== B) E.W.setDiplomacy(A, B, rel, false);
    }
    // the world reports the change with its events; conditions should see it within this step too
    E.push('diplomacy', 'onDiplomacy', null);
  },
  POPL(E, p) { const P = E.C.player(slotOf(p.player_id, 0)); if (P) P.popMax = toInt(p.limit); },
  // AF:3143-3241: unit slots per level; a missing open_i = 0
  BLSL(E, p) { const P = E.C.player(slotOf(p.player_id, 0)); if (P) P.pyramid = [1, 2, 3, 4, 5].map((i) => toInt(p['open_' + i] || '0')); },
  PLCP(E, p) { const P = E.C.player(slotOf(p.player, 0)); if (P) E.W.setCaps(P, { food: p.food, wood: p.wood, stone: p.stone }); },
  SNFA(E, p) { const P = E.C.player(slotOf(p.player, 0)); if (P) P.animalsNeutral = toInt(p.neutral) & 3; },
  ARGN(E, p) { const r = E.C.regions.find(p.rgn_guid); if (r) { r.setEnabled(toInt(p.dest_state) === 1, p.sub_idx == null || p.sub_idx === '' ? -1 : toInt(p.sub_idx)); E.touch(); } },
  MRGN(E, p) { const r = E.C.regions.find(p.rgn_guid), v = E.C.vec(p.pos); if (r && v) { r.moveTo(v.x, v.z); E.touch(); } },

  // ------------------------------------------------------------------------------------------- 5.5 fog of war
  // AF:901-1044: a circle at pos, or - pos [0 0 0] - one per object of the query, following it
  SFOW(E, p, t) {
    const C = E.C, W = E.W, P = C.player(slotOf(p.owner, 0));
    if (!P || !W.revealArea) return;
    const v = C.vec(p.pos), r = num(p.radius, 20), d = num(p.duration, 0);
    if (v && !v.zero) { E.reveals.push(W.revealArea(P, v.x, v.z, r, d > 0 ? d : 0)); return; }
    for (const rec of objs(E, p, t)) {
      const [x, z] = posOf(E, rec);
      E.reveals.push(W.revealArea(P, x, z, r, d > 0 ? d : 0, rec.entity || null));
    }
  },

  // ------------------------------------------------------------------------------------------- 5.6 AI (docs/spec/ai.md §10, §13.1)
  AIBV(E, p, t) { const b = brain(E, slotOf(p.player_id, 0)); if (b) b.setBehaviour(p.behavior, p.module || 'CTRL'); else E.warn(`${t.name}: AIBV for player ${p.player_id}: no brain`); },
  AIFT(E, p, t) {
    const b = brain(E, slotOf(p.player_id, 0)), C = E.C;
    if (!b) { E.warn(`${t.name}: AIFT for player ${p.player_id}: no brain`); return; }
    const targets = ents(objs(E, p, t));
    if (!targets.length) return;
    const pos = (s) => { const v = C.vec(s); return v && !v.zero ? { x: v.x, z: v.z } : null; };
    if (!on(p.custom_attack)) { if (b.startAutoAttack) b.startAutoAttack({ targets }); return; }
    b.startAttack({ type: p.attack_type, targets, position: pos(p.position_edit), attackOnTheWay: on(p.all_the_way), spawn: on(p.attack_with_all), spawnPosition: pos(p.spawn_position),
      ignoreLocations: on(p.ignore_locations), targetOnly: on(p.target_obj), ship: on(p.ship), shipLand: on(p.ship_land), behaviour: p.attack_behavior || null });
  },
  AIDA(E, p, t) {
    const b = brain(E, slotOf(p.player_id, 0)), v = E.C.vec(p.position);
    if (!b || !b.setDefenceArea) return;
    b.setDefenceArea(String(p.id == null ? '' : p.id), v ? { x: v.x, z: v.z } : { x: 0, z: 0 }, num(p.radius, 0), toInt(p.max_units || '0'));
  },
  // the unit list is fixed when the level loads (AF:3780-3949); the query is run when the action fires here, which
  // also covers units that were spawned since
  AILU(E, p, t) {
    const b = brain(E, slotOf(p.player_id, 0)), R = E.C.objects;
    if (!b || !b.lockUnits) return;
    const list = on(p.enable_objsel, true) ? objs(E, p, t) : [];
    for (const id of guids(p.units)) { const r = R.byGuid(id); if (r) list.push(r); }
    b.lockUnits(units(list), on(p.lock, true));
  },
  // AF:4647-4764: /AggroState_<n> for every object
  AIAM(E, p, t) {
    const R = E.C.objects;
    const list = on(p.selector_enabled, true) ? objs(E, p, t) : [];
    for (const id of guids(p.aggro_state_units)) { const r = R.byGuid(id); if (r) list.push(r); }
    if (E.W.setAggro) E.W.setAggro(units(list), toInt(p.aggro_state || '0'));
  },
  AIRG(E, p) {
    const C = E.C, region = C.regions.find(p.region_name);
    const set = (b) => { if (b && b.setRegionMap) b.setRegionMap(p.map_name, region, num(p.value, 0), on(p.add_edit, true)); };
    if (on(p.all_players)) { for (const b of (E.G && E.G.brains ? E.G.brains.values() : [])) set(b); } else set(brain(E, slotOf(p.player_id, 0)));
  },
  AICM(E, p) { const b = brain(E, slotOf(p.player_id, 0)); if (b && b.callModule) b.callModule(p.module, p.command); },
};
ACTIONS.AIST = ACTIONS.AIBV;        // the old name (AF:3590)

// Before the models load (setup.js plan): what the triggers will create that the class scan of the parameters does
// not see - whole tribes for AI players that get a building behaviour (AIBV), the classes of AIFT army tables.
const BUILDING_BEHAVIOUR = /^(Dodo|Giraffe|Schnecke|Turtle|Singleplayer)/;
export function prescanActions(C, aiData) {
  const full = new Set(), classes = new Set();
  const players = C.data.players || [];
  const tribe = (slot) => { const p = players[slot]; return p && p.present ? p.tribe : null; };
  const defs = (C.data.defaults && C.data.defaults.actions) || {};
  for (const t of C.data.triggers || []) {
    if (t.compiled === false || (t.flags && t.flags.disabled)) continue;
    for (const a of t.actions || []) {
      const p = { ...defs[a.type], ...a.p };
      if (a.type === 'AIBV' || a.type === 'AIST') {
        const tr = tribe(slotOf(p.player_id, 0));
        if (tr && BUILDING_BEHAVIOUR.test(String(p.behavior || '')) && (!p.module || p.module === 'CTRL')) full.add(tr);
      } else if (a.type === 'AIFT') {
        const tr = tribe(slotOf(p.player_id, 0));
        if (!tr) continue;
        const T = aiData && aiData.armies && aiData.armies[tr];
        const army = T && ((T.Singleplayer && T.Singleplayer[p.attack_type]) || (T.Dodo && T.Dodo[p.attack_type]));
        if (army) { for (const e of army) for (const alt of e.alternatives || []) if (alt.cls) classes.add(alt.cls); if (on(p.ship_land)) full.add(tr); } else full.add(tr);
      }
    }
  }
  return { fullTribes: [...full], classes: [...classes] };
}

// status of every action type of triggers.md §5 in the remake (docs/CAMPAIGN_RUNTIME.md §11 prints this table)
export const ACTION_STATUS = {
  TRIG: ['implemented', ''], ACND: ['implemented', 'deactivate covers sub-folders, activate only the folder itself'],
  QUIT: ['implemented', 'G.endMission(true)'], GAOV: ['implemented', 'G.endMission(false) 4 s later with the reason text'],
  BONI: ['implemented', 'G.campaign.boni (not carried to the next mission: there is no army screen)'],
  FDBK: ['ignored', 'designer debug texts, off in the original too; printed with &trace'],
  SQNZ: ['implemented', 'G.mission.playSequence; end event, camera_data, quit'], DGSC: ['implemented', 'G.mission.playDialog; DSEN on its end'],
  QUES: ['implemented', ''], QMRK: ['implemented', 'state and tooltip (G.campaign.setQuestionMark)'], MPNG: ['implemented', 'G.mission.marker / removeMarker; only markers for the human player'],
  INBA: ['implemented', 'refreshed when a variable changes'], TIMR: ['implemented', 'create / pause / unpause / kill'], PSND: ['implemented', 'G.audio.play if the sound event exists'],
  ACDO: ['implemented', 'WalkAction, Aggressive Walk, Attack, SetPos, RotateTo, SetAnim, Invulnerability, AbortTask, Stop, Kill, FullHeal, Open / Close / Auto Gate, SetRallyPoint, BuildUp; GiveItem approximated; JumpOffWall ignored'],
  WYPT: ['approximated', 'patrol driver in the engine (once / circle / back and forth); fighters walk as an attack-move; straightwalk ignored (path finding)'],
  COBJ: ['implemented', ''], OCPY: ['implemented', 'highlight ignored'], UNIT: ['implemented', 'hitpoints only (all that occurs)'],
  SPGR: ['approximated', 'units leave a spawn building on the line towards `pos` (no link points); §buildup variants ignored'],
  CPLX: ['implemented', ''], REPL: ['implemented', ''], DELO: ['implemented', ''], ADGR: ['implemented', ''],
  TRSP: ['approximated', 'mount: board orders to the nearest passengers; dismount: every transporter of the query unloads'],
  EFCT: ['ignored', 'particle effect (decoration)'], OBAP: ['implemented', 'visible / hitable / selectable; the other bits are kept on the record'],
  VARS: ['implemented', ''], RSRC: ['implemented', ''], TECH: ['implemented', ''], DIPL: ['implemented', ''], POPL: ['implemented', ''], BLSL: ['implemented', ''],
  PLCP: ['implemented', ''], SNFA: ['implemented', ''], ARGN: ['implemented', ''], MRGN: ['implemented', ''], SFOW: ['implemented', ''],
  AIBV: ['implemented', 'brain.setBehaviour'], AIFT: ['implemented', 'brain.startAttack / startAutoAttack'], AIDA: ['implemented', 'brain.setDefenceArea'],
  AILU: ['implemented', 'brain.lockUnits; the query runs when the action fires'], AIAM: ['implemented', 'world.setAggro'], AIRG: ['implemented', 'brain.setRegionMap'], AICM: ['implemented', 'brain.callModule (unused by the campaign)'],
};
