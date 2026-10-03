// Campaign world setup: turns a mission's data (pwexport.campaign JSON, schema pw-campaign/1, docs/CAMPAIGN_FORMAT.md
// §10) into a running world - the players with their diplomacy, every placed object with owner, level, hit points
// and flags, the regions, groups, question marks and start locations - and is the run-time context the trigger
// engine works on (G.campaign). The interface is described in remake/docs/CAMPAIGN_RUNTIME.md; what a mission
// start consists of in the original is in remake/docs/spec/triggers.md §6.7.
//
// Order of a campaign start (main.js startGame):
//   loadCampaign(id)            fetch the index and the mission JSON
//   new Campaign(G, ...)        plan(): classify the objects, collect the models the mission needs
//   map source, loadModels      the map's landscape (maps/source.js leaves out what the campaign places itself)
//   build(world, source)        players, objects, groups, start locations (called from buildWorld)
//   update(dt)                  every simulation slice: registry upkeep, events for the trigger engine
import { Player } from '../player.js';
import { PLAYER_COLORS, hex, NEUTRAL_UI } from '../colors.js';
import { Regions } from './regions.js';
import { Registry, Rec, Group } from './registry.js';
import { Prop } from './props.js';
import { TriggerEngine, prescan } from './engine.js';

const UNIT_TYPES = new Set(['CHTR', 'ANML', 'VHCL', 'SHIP']);
// the landscape of the map: left to maps/source.js (instanced, resources, nests) unless a mission addresses the object
const LANDSCAPE = new Set(['TREE', 'VGTN', 'WOOD', 'STON', 'FRUI', 'DCCO', 'DECO', 'NEST']);
// parts of other objects that the remake assembles itself (game/compose.js): riders, build-ups, turrets, cranes
const RESOURCES = new Set(['TREE', 'WOOD', 'STON', 'FRUI', 'NEST']);
const PARTS = new Set(['PROD', 'TRRT', 'MNIO']);
// helper objects of the editor / the scripts: a record, nothing in the world
const HELPERS = new Set(['SLOC', 'WYPT', 'GROU', 'QMRK', 'OTHR', 'DMGL', 'CFXE', 'COLL', 'FOOD']);
// big scenery that units cannot walk through (the rule of maps/source.js for landscape objects)
const SOLID = /rock|plateau|cliff|mountain|stone(?!_jun)|ruin|pillar|wall|temple|monument|archway|statue|head|coffin|stoneglobe|berg|basalt|arc0|wreck|crater|dead_tree|log|house|barricade|cage|gate|blocker|tower|hut|jail/;
const NO_BLOCK = /bridge|river|stream|lava|waterfall|flag|fx_|smoke|flame|decal|pile_of_goods|_dest$/;
const MAIN_BUILDING = { Hu: 'hu_fireplace', Aje: 'aje_resource_collector', Ninigi: 'ninigi_fireplace', SEAS: 'seas_headquarters' };
// classes that exist in the rules but have no model in the game data: what stands in for them
const STAND_IN = { stina_s0: 'special_eusmilus' };          // Stina rides her sabre-tooth (StartLocation.usl:517-519)
const STAND_IN_CHTR = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_warrior', Special: 'hu_warrior' };
const QM_STATES = ['STATE_INVISIBLE', 'QM_STATE_RED', 'QM_STATE_GREEN', 'QM_STATE_YELLOW', 'EC_STATE_YELLOW'];

// fetch the campaign index and one mission: { index, entry, data }
export async function loadCampaign(id) {
  const ir = await fetch('campaign/index.json');
  if (!ir.ok) throw new Error('The campaign missions were not found in the game installation.');
  const index = await ir.json();
  const entry = index.find((e) => e.id === +id);
  if (!entry) throw new Error('There is no campaign mission ' + id + '.');
  const r = await fetch(entry.data.split('/').map(encodeURIComponent).join('/'));
  if (!r.ok) throw new Error('The data of mission ' + id + ' could not be read (' + r.status + ').');
  const data = await r.json();
  if (!/^pw-campaign\/1/.test(data.schema || '')) throw new Error('Unknown mission data format: ' + data.schema);
  return { index, entry, data };
}

export class Campaign {
  // G = the game object; loaded = loadCampaign(); cfg = { campaign, difficulty }
  constructor(G, loaded, cfg) {
    this.G = G;
    this.index = loaded.index; this.entry = loaded.entry;
    this.data = loaded.data;
    this.id = loaded.entry.id;
    this.difficulty = Math.max(0, Math.min(2, cfg.difficulty == null ? 1 : +cfg.difficulty));    // 0 easy, 1 medium, 2 hard
    this.map = this.data.map;
    this.players = [null, null, null, null, null, null, null, null];     // Player per slot
    this.human = null;                           // = G.me
    this.objects = null;                         // Registry
    this.regions = null;                         // Regions
    this.groups = [];                            // Group[] (also objects.group(ref))
    this.questionMarks = [];                     // { guid, name, x, z, state, tooltip, rec }
    this.startLocations = [null, null, null, null, null, null, null, null];   // { x, z, heading, data } per slot
    this.variables = new Map();                  // level variables: name -> value (string, as in the data; all are ints)
    for (const k in this.data.variables || {}) this.variables.set(k, String(this.data.variables[k].value));
    this.timers = new Map();                     // owned by the trigger engine (ui/mission.js reads it)
    this.props = [];                             // stand-alone scenery (props.js)
    this.warnings = [];                          // what could not be placed, as sentences
    this.counts = { units: 0, buildings: 0, props: 0, landscape: 0, parts: 0, helpers: 0, missing: 0 };
    this.tribes = [];                            // tribes of the present players
    this.fullTribes = [];                        // tribes whose models are loaded completely (the human player's)
    this.listeners = new Map();
    this.need = new Set();                       // models to load (plan, needClass)
    this.skip = new Set();                       // names of map objects the landscape source must leave out
    this.plans = [];                             // per JSON object: { o, kind, ... }
    this.missing = new Map();                    // class -> [count, reason]
    this.evAt = 0;
    this.ready = false;
  }

  // ------------------------------------------------------------------ events
  // on(type, fn): 'spawned' (rec) · 'removed' (rec) · 'group' (group, rec, added) · 'owner' (rec, from, to) ·
  // 'diplomacy' ({a, b, rel, mutual}) · 'questionmark' (mark) · 'event' (world event object, every one)
  on(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); return fn; }
  off(type, fn) { const l = this.listeners.get(type); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  emit(type, ...args) { const l = this.listeners.get(type); if (l) for (const fn of l.slice()) fn(...args); }

  // ------------------------------------------------------------------ coordinates
  // map (x east, y north; metres from the map's south-west corner) <-> game (x east, z south, origin = centre)
  toGame(mx, my) { return [mx - this.ox, this.oy - my]; }
  toMap(x, z) { return [x + this.ox, this.oy - z]; }
  // "[x y z]", "x y z" or "x, y, z" of a trigger parameter -> { x, z (game), mx, my, mz (map), zero } or null
  vec(s) {
    const m = String(s == null ? '' : s).match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi);
    if (!m || m.length < 2) return null;
    const mx = +m[0], my = +m[1], mz = m.length > 2 ? +m[2] : 0;
    const [x, z] = this.toGame(mx, my);
    return { x, z, mx, my, mz, zero: mx === 0 && my === 0 && mz === 0 };
  }
  // heading of the map data (objects[].rot, the z angle of obj_rot) -> the world's heading (rotation about y)
  heading(rot) { return +rot || 0; }
  player(slot) { return slot >= 0 && slot < 8 ? this.players[slot] : null; }
  text(key) { const t = this.data.texts || {}; return key in t ? t[key] : key; }
  warn(msg) { if (!this.warnings.includes(msg)) this.warnings.push(msg); }
  miss(cls, reason) { const e = this.missing.get(cls) || [0, reason]; e[0]++; this.missing.set(cls, e); }

  // ------------------------------------------------------------------ plan (before the models load)
  modelOf(o, M) {
    const g = String(o.gfx || '').toLowerCase(), lc = String(o.class || '').toLowerCase(), cg = this.D.classGfx(lc);
    return M[g] ? g : M[lc] ? lc : cg && M[cg] ? cg : null;
  }
  // exact class name of the rules for a class written in any case
  ruleClass(cls) {
    if (this.D.exists(cls)) return cls;
    if (!this.lcIndex) { this.lcIndex = new Map(); for (const k of this.D.index.keys()) this.lcIndex.set(k.toLowerCase(), k); }
    return this.lcIndex.get(String(cls).toLowerCase()) || null;
  }
  // every model a rule class can show: its looks per level, weapons, projectiles, riders and build-ups
  classModels(cls, out = this.need) {
    const D = this.D, M = this.manifest;
    const add = (n) => { n = n && String(n).toLowerCase(); if (n && M[n]) out.add(n); };
    const name = this.ruleClass(cls);
    if (!name) return false;
    const ix = D.info(name);
    for (let l = 1; l <= 5; l++) {
      const s = D.stats(name, l, null);
      if (!s || (l > 1 && !s.exists)) continue;
      add(s.gfx); if (ix.type === 'BLDG') add(s.gfx + '_dest');
      if (ix.type === 'BLDG') break;
      const ws = D.weaponSet(name, l, null);
      for (const w of ws.all || []) { add(w.projectile); for (const p of w.parts || []) for (const g of p.gfx || []) add(g); }
    }
    if (ix.type === 'BLDG') { const ws = D.weaponSet(name, 1, null); for (const w of ws.all || []) add(w.projectile); }
    add(D.classGfx(name));
    for (const s of D.composites(name)) {
      add(s.gfx); for (const v of s.variants || []) add(v);
      if (s.kind === 'rider' && /\d$/.test(s.gfx || '')) for (let l = 1; l <= 5; l++) add(s.gfx.slice(0, -1) + l);
    }
    const d = D.def(name, null);
    if (d && d.captain_gfx) { add(d.captain_gfx); if (/\d$/.test(d.captain_gfx)) for (let l = 1; l <= 5; l++) add(d.captain_gfx.slice(0, -1) + l); }
    if (ix.tribe && ix.tribe !== 'World' && ix.tribe !== 'Special') {
      const t = ix.tribe.toLowerCase();
      for (let l = 1; l <= 5; l++) add(`${t}_animal_flag_0${l}`);
      if (d && (d.can_build || d.can_harvest)) for (const n of M ? Object.keys(M) : []) if (n.startsWith(t + '_') && /_(hammer|axe|pickaxe|pick|sickle|saw|basket|pannier|jug|backpack|tool)/.test(n)) out.add(n);
    }
    const si = this.standInModel(name);
    if (si) add(si);
    return true;
  }
  // model standing in for a rule class without a model of its own (null if it has one or nothing fits)
  standInModel(name) {
    const D = this.D, M = this.manifest, ix = D.info(name);
    const s = D.stats(name, 1, null);
    const has = (g) => !!(g && M[String(g).toLowerCase()]);
    if (!ix || has(s && s.gfx) || has(D.classGfx(name))) return null;
    const alt = STAND_IN[name.toLowerCase()] || (ix.type === 'CHTR' ? STAND_IN_CHTR[ix.tribe] : null);
    const g = alt && D.stats(alt, 1, null);
    return g && has(g.gfx) ? String(g.gfx).toLowerCase() : null;
  }
  // a class the mission will create later (trigger spawns, AI production): its models are loaded with the mission.
  // Call it before the models load (the AI and the trigger engine do so from their constructors' scans); afterwards
  // it only reports whether the class can be created now.
  needClass(cls) {
    const name = this.ruleClass(cls);
    if (this.ready) {
      if (name) return this.D.info(name).type === 'BLDG' ? !!this.G.world.templates((this.D.stats(name, 1, null) || {}).gfx, true) : !!this.G.world.unitModel(name, undefined, null);
      return !!this.G.world.templates(String(cls).toLowerCase(), true);
    }
    if (name) return this.classModels(name);
    const lc = String(cls).toLowerCase();
    if (this.manifest[lc]) { this.need.add(lc); if (this.manifest[lc + '_dest']) this.need.add(lc + '_dest'); return true; }
    return false;
  }
  // every word of every trigger parameter that names a class or a model: what the mission may create or address
  namedByTriggers() {
    const out = new Set();
    for (const t of this.data.triggers || []) {
      if (t.compiled === false) continue;
      for (const n of [...(t.conditions || []), ...(t.actions || [])]) {
        for (const k in n.p) {
          const v = n.p[k];
          if (typeof v !== 'string' || v.length < 3 || /^(guid|rgn_guid|.*_guid|pos|obj_pos|waypoints|msg_text|text)$/.test(k)) continue;
          for (const w of v.split(/[|\s,;:/§&()[\]]+/)) if (w.length > 2 && !/^[-\d.]+$/.test(w)) out.add(w);
        }
      }
    }
    return out;
  }
  // D = Rules, manifest = asset manifest models. Classifies every placed object and collects models and skip names.
  plan(D, manifest) {
    this.D = D; this.manifest = manifest;
    const data = this.data;
    const human = data.players.find((p) => p.present && p.type === 'human') || data.players.find((p) => p.present);
    this.humanSlot = human ? human.id : 0;
    this.tribes = [...new Set(data.players.filter((p) => p.present && p.tribe).map((p) => p.tribe))];
    this.fullTribes = human && human.tribe ? [human.tribe] : [];
    // what the triggers name: classes (models loaded, scenery made addressable) and objects
    const named = this.namedByTriggers();
    this.namedClasses = new Set();
    for (const w of named) { if (this.ruleClass(w) || manifest[w.toLowerCase()]) { this.namedClasses.add(w.toLowerCase()); this.needClass(w); } }
    // what the triggers will create that no parameter names (engine.js prescan): the whole tribe of an AI player that
    // gets a building behaviour (AIBV Dodo / Giraffe / Schnecke / Turtle), the classes of the AIFT army tables
    const pre = prescan(this, this.G.aiData || null);
    for (const t of pre.fullTribes) if (!this.fullTribes.includes(t)) this.fullTribes.push(t);
    for (const c of pre.classes) this.needClass(c);
    const refs = data.refs || {};
    const refNames = new Set();
    for (const g in refs) if (refs[g][1]) refNames.add(refs[g][1]);
    for (const o of data.objects) {
      const type = o.type || '', lc = String(o.class).toLowerCase();
      const pl = { o, kind: 'none' };
      this.plans.push(pl);
      const rule = this.ruleClass(o.class), ix = rule ? D.info(rule) : null;
      // scenery a mission addresses (by GUID, name or class), hides or gives to a player stands on its own
      const addressed = !!refs[o.guid] || refNames.has(o.name) || named.has(o.name) || this.namedClasses.has(lc) || o.visible === false || (o.owner != null && !RESOURCES.has(type));
      if (HELPERS.has(type) || lc === 'virtual_produce_unit') { pl.kind = 'helper'; this.skip.add(o.name); continue; }
      if (PARTS.has(type)) { pl.kind = 'part'; this.skip.add(o.name); continue; }
      if (ix && UNIT_TYPES.has(ix.type) && UNIT_TYPES.has(type)) {
        pl.kind = 'unit'; pl.cls = rule; this.skip.add(o.name);
        this.classModels(rule);
        continue;
      }
      if (ix && ix.type === 'BLDG' && type === 'BLDG' && o.owner != null && data.players[o.owner] && data.players[o.owner].present) {
        pl.kind = 'building'; pl.cls = rule; this.skip.add(o.name);
        this.classModels(rule);
        continue;
      }
      if (type === 'NEST' && ix) {
        // wild nests: the spawner is the map source's (maps/source.js); the nest itself stands as an object that can
        // be attacked and destroyed (wildlifeReady) - missions wait for that with DEAD / DYIN
        pl.kind = 'nest'; pl.cls = rule;
        const g = String((D.stats(rule, 1, null) || {}).gfx || '').toLowerCase();
        if (g && manifest[g]) { this.need.add(g); if (manifest[g + '_dest']) this.need.add(g + '_dest'); }
        continue;
      }
      if (LANDSCAPE.has(type) && !addressed) { pl.kind = 'landscape'; continue; }
      // everything else is scenery of its own: needs a model
      this.skip.add(o.name);
      const model = this.modelOf(o, manifest);
      if (!model) { pl.kind = 'missing'; continue; }
      pl.kind = 'prop'; pl.model = model;
      this.need.add(model);
    }
    // start locations: main buildings and start armies
    for (const p of data.players) {
      if (!p.present) continue;
      if (p.include_buildings && MAIN_BUILDING[p.tribe]) this.classModels(MAIN_BUILDING[p.tribe]);
      for (const a of p.start_army || []) this.classModels(a.class);
    }
    return this;
  }
  // models to load on top of the full tribes and the map's landscape
  models() { return this.need; }

  // ------------------------------------------------------------------ build (from main.js buildWorld)
  // W = the World, S = the map source (maps/source.js). Returns the human player.
  build(W, S) {
    const G = this.G, D = this.D, data = this.data;
    this.world = W;
    this.ox = S.origin[0]; this.oy = S.origin[1];
    this.regions = new Regions(data.regions, (mx, my) => this.toGame(mx, my), (x, z) => this.toMap(x, z));
    this.objects = new Registry(this, this.regions);
    // ---- players (triggers.md §6.7 no. 1, 2; ServerApp.usl:398-599)
    const list = [];
    for (const pd of data.players) {
      if (!pd.present) continue;
      const c = PLAYER_COLORS[pd.color] || null;
      const me = pd.id === this.humanSlot;
      const p = new Player(pd.id, pd.tribe || '', {
        ai: !me, name: pd.name || ('Player ' + pd.id), team: pd.team,
        color: c ? hex(c.dark) : me ? NEUTRAL_UI.me : 0x9a9a9a, partyColor: c ? hex(c.light) : null,
        rules: D, diplomacy: pd.diplomacy,
      });
      p.slot = pd.id; p.data = pd;
      // army pyramid and population limit of the level (Restrictions/Chars; Player.usl:281, RequirementsMgr.usl:186)
      const lim = (pd.unit_limits || []).map((u, i) => (u && u.max != null ? u.max : D.pyramid[i]));
      if (lim.length === 5 && lim.some((v, i) => v !== D.pyramid[i])) p.pyramid = lim;
      if (pd.population_limit != null && pd.population_limit > 0) p.popMax = pd.population_limit;
      this.players[pd.id] = p;
      list.push(p);
    }
    W.players = list;
    this.human = this.players[this.humanSlot];
    for (const p of list) p.tt.suspend();
    // tech tree filters of the level: mostly AntiActions = what the mission forbids (ServerApp.usl:527-535)
    for (const p of list) for (const f of p.data.tech_filters || []) W.setFilter(p, f, true);
    // stand-ins for classes without a model
    for (const pl of this.plans) if (pl.cls) { const si = this.standInModel(pl.cls); if (si) W.standIns.set(pl.cls.toLowerCase(), si); }
    for (const w of this.namedClasses) { const r = this.ruleClass(w); const si = r && this.standInModel(r); if (si) W.standIns.set(r.toLowerCase(), si); }

    // ---- records for every object, in the order of the data
    W.onEntity = (e) => this.entityCreated(e);
    for (const pl of this.plans) {
      const o = pl.o;
      const rec = pl.rec = new Rec({ guid: o.guid, name: o.name, cls: o.class, type: o.type || '', index: o.index, handle: o.handle, slot: o.owner == null ? -1 : o.owner, x: o.x, y: o.y, data: o });
      rec.placed = false;
      if (pl.kind === 'landscape' || pl.kind === 'part') { this.counts[pl.kind === 'part' ? 'parts' : 'landscape']++; continue; }      // not addressable: no entry in the tables
      this.objects.add(rec);
      if (pl.kind === 'helper') this.counts.helpers++;
    }
    for (const g of data.groups || []) {
      let rec = this.objects.byGuid(g.guid);
      if (!rec) rec = this.objects.add(new Rec({ guid: g.guid, name: g.name, cls: 'GroupObject', type: 'GROU', index: g.index }));
      rec.placed = true;
      rec.groupObj = new Group(rec);
      this.groups.push(rec.groupObj);
    }
    // ---- buildings first (units then find free ground), then units, then scenery
    for (const pl of this.plans) if (pl.kind === 'building') this.placeBuilding(pl);
    for (const pl of this.plans) if (pl.kind === 'unit') this.placeUnit(pl);
    for (const pl of this.plans) if (pl.kind === 'prop') this.placeProp(pl);
    for (const pl of this.plans) {
      const o = pl.o, rec = pl.rec;
      if (pl.kind === 'missing') { this.counts.missing++; this.miss(o.class, 'no model'); }
      else if (pl.kind === 'nest') rec.placed = true;       // rec.nest: linked in wildlifeReady()
      else if (pl.kind === 'helper' && o.type === 'OTHR' && /^showfow/i.test(o.class) && this.players[o.owner]) {
        // a placed ShowFOW_Obj: its owner sees the place (the radius is not in the data: 20 m, a guess)
        const [x, z] = this.toGame(o.x, o.y);
        rec.reveal = W.revealArea(this.players[o.owner], x, z, 20, 0);
      }
    }
    // passengers that start inside a transport (attributes transporter_guid / passenger_guids)
    for (const pl of this.plans) {
      const o = pl.o, a = o.attr || {};
      if (pl.kind !== 'unit' || !pl.rec.entity) continue;
      if (a.transporter_guid) this.embark(pl.rec, this.objects.byGuid(a.transporter_guid));
      if (a.passenger_guids) for (const g of String(a.passenger_guids).split(/\s+/)) if (g) this.embark(this.objects.byGuid(g), pl.rec);
    }
    // ---- groups, question marks
    for (const g of data.groups || []) {
      const grp = this.objects.group(g.guid);
      for (const m of g.members || []) { const r = this.objects.byGuid(m); if (r && r.placed) this.objects.addToGroup(grp, r); }
    }
    for (const q of data.question_marks || []) {
      const [x, z] = this.toGame(q.x, q.y);
      const rec = this.objects.byGuid(q.guid);
      this.questionMarks.push({ guid: q.guid, name: q.name, x, z, state: q.state || 'STATE_INVISIBLE', tooltip: '', rec });
    }
    // ---- start locations: main building, start army, start resources (StartLocation.usl:316-737)
    for (const p of list) this.startLocation(p);
    for (const p of list) { p.tt.resume(); W.recomputeCaps(p); }
    for (const [cls, [n, why]] of this.missing) this.warn(`${cls}${n > 1 ? ' ×' + n : ''}: ${why}`);
    for (const w of data.warnings || []) if (/^player \d+: start location/.test(w)) this.warn('data: ' + w);
    if (this.human) this.human.debug = !!(G.config && G.config.debug);
    this.ready = true;
    // the trigger engine (engine.js): starts with the first simulation slice. ?notriggers: only the world (tests)
    this.errors = [];
    let off = false;
    try { off = /[?&]notriggers\b/.test(location.search); } catch (e) { /* no page */ }
    this.engine = off ? null : new TriggerEngine(this);
    return this.human;
  }
  // the map's wild animals and nests exist now (main.js creates them after the players): nests get their record,
  // and the nest itself becomes an ownerless object with hit points (Nest.usl: 500): destroying it ends the
  // spawning, and DEAD / DYIN conditions on it fire. Nobody attacks a nest without an order (combat.js findTarget).
  wildlifeReady() {
    const W = this.world;
    for (const pl of this.plans) if (pl.kind === 'nest') {
      const o = pl.o, rec = pl.rec, [x, z] = this.toGame(o.x, o.y);
      rec.nest = W.wildNests.find((n) => Math.hypot(n.x - x, n.z - z) < 1) || null;
      const gfx = (this.D.stats(pl.cls, 1, null) || {}).gfx;
      if (!gfx || !W.templates(gfx, true)) continue;
      let b = null;
      this.pending = rec;
      try { b = W.placeBuilding(pl.cls, null, x, z, this.heading(o.rot), true); } catch (e) { this.warn(`${o.class}: nest not created (${e.message})`); }
      this.pending = null;
      if (!b) continue;
      b.isNest = true;
      this.applyState(pl, b);
    }
  }
  // the world created a unit or building: give it a record (W.onEntity)
  entityCreated(e) {
    let rec = this.pending;
    this.pending = null;
    if (rec) { rec.entity = e; e.rec = rec; rec.placed = true; if (!rec.listed) this.objects.add(rec); } else rec = this.objects.adopt(e);
    this.emit('spawned', rec);
  }
  // hit points and flags of a placed object
  applyState(pl, e) {
    const o = pl.o, W = this.world, rec = pl.rec;
    if (o.max_hp > 0 && o.hp > 0 && o.hp < o.max_hp) { e.hp = Math.max(1, Math.round(e.maxHp * o.hp / o.max_hp)); if (e.kind === 'building') e.updateVisual(); }
    // the flag bits are decoded by correlation only (CAMPAIGN_FORMAT.md §6): `visible` is certain, the others hints
    if (o.invulnerable) W.setInvulnerable(e, true);
    const flags = (o.visible === false ? 0 : 1) | (o.hitable === false ? 0 : 2) | (o.selectable === false ? 0 : 4);
    if (flags !== 7) this.setAppearance(rec, flags);
  }
  placeBuilding(pl) {
    const o = pl.o, W = this.world, a = o.attr || {};
    const [x, z] = this.toGame(o.x, o.y);
    this.pending = pl.rec;
    const b = W.placeBuilding(pl.cls, this.players[o.owner], x, z, this.heading(o.rot), a.building_ready !== '0');
    this.pending = null;
    if (!b) { this.counts.missing++; this.miss(o.class, 'no model'); return; }
    if (b.def.gate && a.GateState != null && W.setGate) W.setGate(b, +a.GateState);     // 0 open, 1 closed, 2 automatic
    this.counts.buildings++;
    this.applyState(pl, b);
  }
  placeUnit(pl) {
    const o = pl.o, W = this.world;
    const [x, z] = this.toGame(o.x, o.y);
    const owner = o.owner != null ? this.players[o.owner] || null : null;
    this.pending = pl.rec;
    const u = W.spawn(pl.cls, owner, x, z, { level: Math.max((o.level || 0) + 1, this.D.minLevel(pl.cls, owner)), heading: this.heading(o.rot) });
    this.pending = null;
    if (!u) { this.counts.missing++; this.miss(o.class, this.manifestHas(pl.cls) ? 'not created' : 'no model'); return; }
    if (W.standIns.get(pl.cls.toLowerCase()) && u.gfx === W.standIns.get(pl.cls.toLowerCase())) this.miss(o.class, 'no model, shown as ' + u.gfx);
    u.home.set(u.pos.x, u.pos.z);
    this.counts.units++;
    this.applyState(pl, u);
  }
  manifestHas(cls) { const s = this.D.stats(cls, 1, null); return !!(s && this.manifest[String(s.gfx).toLowerCase()]); }
  placeProp(pl) {
    const o = pl.o, W = this.world;
    if (!W.templates(pl.model, true)) { this.counts.missing++; this.miss(o.class, 'model not loaded'); return; }
    const [x, z] = this.toGame(o.x, o.y);
    const lc = pl.model;
    const landscape = LANDSCAPE.has(o.type || '');
    const block = !NO_BLOCK.test(lc) && (o.type === 'DCCO' || o.type === 'BLDG' || SOLID.test(lc));
    const owner = o.owner != null ? this.players[o.owner] : null;
    const prop = new Prop(W, { model: pl.model, x, z, y: landscape || o.type === 'BLDG' || !o.type ? o.z : null, rot: this.heading(o.rot), q: o.q, block, blockRadius: block ? Math.min(24, this.modelRadius(pl.model) * 0.7) : 0, party: owner ? owner.partyColor : null });
    prop.rec = pl.rec;
    pl.rec.prop = prop; pl.rec.placed = true;
    this.props.push(prop);
    this.counts.props++;
    if (o.visible === false) { pl.rec.visible = false; prop.setVisible(false); }
  }
  modelRadius(model) {
    const t = this.world.templates(model, true);
    if (!t) return 0;
    if (t.propR == null) { const b = new this.world.THREE.Box3().setFromObject(t.scene); t.propR = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2; }
    return t.propR;
  }
  embark(passenger, transport) {
    const W = this.world, u = passenger && passenger.entity, t = transport && transport.entity;
    if (!u || !t || u.inside || u === t || !u.alive || !t.alive || !W.enterTransport) return;
    if (u.parked) return;
    W.enterTransport(u, t);
  }
  // StartLocation.usl CreateLocation: the tribe's main building (IncludeBuildings), the start army of the level's
  // point-buy preset (unless the start location says ignore_pointbuy) and the start resources
  startLocation(p) {
    const W = this.world, D = this.D, pd = p.data, sl = pd.start_location;
    if (!sl) return;
    const [x, z] = this.toGame(sl.x, sl.y);
    const heading = this.heading(sl.rot);
    this.startLocations[p.id] = { x, z, heading, data: sl };
    if (sl.is_sequence && sl.seq_filename) return;            // SL:337-347: the sequence creates the start instead
    let stand = 3;
    if (pd.include_buildings && MAIN_BUILDING[p.tribe]) {
      // Aje: the resource collector only for a computer player (or without an army budget), SL:386-390
      const cls = MAIN_BUILDING[p.tribe];
      const e = p.tribe === 'Aje' && !p.ai ? null : W.spawn(cls, p, x, z, { heading });
      if (e) stand = e.radius;
      else if (!(p.tribe === 'Aje' && !p.ai)) this.miss(cls, 'start building not created');
    }
    if (sl.ignore_pointbuy) return;
    (pd.start_army || []).forEach((a, i) => {
      // SL:545-556: workers stand in three groups by caste around the start, heroes and soldiers anywhere around it
      const ang = a.caste === 'tec' ? 2.094 : a.caste === 'nat' || a.preset === 'Stina_s0' ? 4.189 : a.caste === 'res' ? 0 : (i * 2.399) % 6.283;
      const r = 0.99 * stand + 1.5 + (i % 3) * 1.2;
      const gx = x + Math.cos(ang + 0.785) * r, gz = z - Math.sin(ang + 0.785) * r;
      const rule = this.ruleClass(a.class);
      const u = rule ? W.spawn(rule, p, gx, gz, { level: Math.max((a.level || 0) + 1, D.minLevel(rule, p)), heading }) : null;
      if (!u) this.miss(a.class, 'start army unit not created');
    });
    // SL:604-623. -1 = "bought on the army screen" (missions 4, 5, 9, 11, 16): the tribe's default stock instead (a guess)
    const res = pd.resources || {}, def = (D.start(p.tribe) || {}).res || {};
    for (const [k, r] of [['food', 'food'], ['wood', 'wood'], ['stone', 'stone'], ['iron', 'skulls']]) {
      const v = res[k];
      p.res[r] = v == null ? 0 : v < 0 ? (def[r] || 0) : v;
    }
  }

  // ------------------------------------------------------------------ per simulation slice
  update(dt) {
    const W = this.world, ev = W.events;
    if (ev.length < this.evAt) this.evAt = 0;
    for (; this.evAt < ev.length; this.evAt++) {
      const e = ev[this.evAt];
      this.emit('event', e);
      switch (e.type) {
        case 'died': case 'destroyed': case 'removed': {
          const rec = e.entity && e.entity.rec;
          if (!rec) break;
          // a destroyed nest spawns no more animals
          if (rec.nest) { rec.nest.amount = 0; W.wildNests = W.wildNests.filter((n) => n !== rec.nest); }
          this.objects.drop(rec);
          break;
        }
        case 'owner': if (e.entity.rec) this.emit('owner', e.entity.rec, e.from, e.to); break;
        case 'diplomacy': this.emit('diplomacy', e); break;
        default: break;
      }
    }
    this.objects.compact();
    for (const p of this.props) if (p.anim) p.update(dt);
    if (this.props.some((p) => !p.alive)) this.props = this.props.filter((p) => p.alive);
    // the triggers: after the events of this slice have reached the listeners (docs/CAMPAIGN_RUNTIME.md §11)
    if (this.engine) this.engine.update(dt);
  }

  // ------------------------------------------------------------------ what missions do (map coordinates, slots, 0-based levels)
  // create an object of class `cls` for player slot `slot` (-1 = nobody) at map position (mx, my): a unit or
  // building of the rules, else a piece of scenery with that model. opts: level0 (0-based) | level (1-based),
  // rot (map heading), name, group (Group | guid | name), exact (do not look for a free spot). Returns its Rec.
  spawn(cls, slot, mx, my, opts = {}) {
    const W = this.world, D = this.D;
    let [x, z] = this.toGame(mx, my);
    const owner = this.player(slot);
    const rule = this.ruleClass(cls);
    let rec = null;
    if (rule) {
      const ix = D.info(rule);
      if (ix.type !== 'BLDG' && !opts.exact) [x, z] = W.freeSpot(x, z, { water: ix.type === 'SHIP' });
      const level = opts.level != null ? opts.level : opts.level0 != null ? Math.max(0, opts.level0) + 1 : undefined;
      if (ix.type === 'BLDG' && !owner) rec = this.spawnProp(rule, slot, x, z, opts);
      else {
        const pre = new Rec({ name: opts.name || this.objects.newName(cls), cls: rule, type: ix.type === 'BLDG' ? 'BLDG' : ix.type });
        this.pending = pre;
        const e = W.spawn(rule, owner, x, z, { level: level != null ? Math.max(level, D.minLevel(rule, owner)) : undefined, heading: this.heading(opts.rot), built: opts.built });
        this.pending = null;
        if (!e) { this.warn(`${cls}: could not be created (model not loaded?)`); return null; }
        rec = pre;
        if (e.kind === 'unit') e.home.set(e.pos.x, e.pos.z);
      }
    } else rec = this.spawnProp(cls, slot, x, z, opts);
    if (rec && opts.group) this.objects.addToGroup(opts.group, rec);
    return rec;
  }
  spawnProp(cls, slot, x, z, opts = {}) {
    const W = this.world, lc = String(cls).toLowerCase();
    const model = W.templates(lc, true) ? lc : this.D.classGfx(lc) && W.templates(this.D.classGfx(lc), true) ? this.D.classGfx(lc) : null;
    if (!model) { this.warn(`${cls}: could not be created (no model)`); return null; }
    const owner = this.player(slot);
    const block = !NO_BLOCK.test(model) && SOLID.test(model);
    const prop = new Prop(W, { model, x, z, y: opts.y != null ? opts.y : null, rot: this.heading(opts.rot), block, blockRadius: block ? Math.min(24, this.modelRadius(model) * 0.7) : 0, party: owner ? owner.partyColor : null });
    const rec = new Rec({ name: opts.name || this.objects.newName(cls), cls, type: opts.type || 'DCCO', slot: slot == null ? -1 : slot });
    rec.prop = prop; prop.rec = rec;
    this.props.push(prop);
    this.objects.add(rec);
    this.emit('spawned', rec);
    return rec;
  }
  // delete an object without death (DELO, REPL): gone at once; 'removed' is emitted
  remove(ref) {
    const rec = this.objects.get(ref);
    if (!rec) return false;
    if (rec.entity) { this.world.removeEntity(rec.entity); const G = this.G; if (G.sel) G.sel.delete(rec.entity); }
    if (rec.prop) rec.prop.remove();
    if (rec.reveal) this.world.hideArea(rec.reveal);
    this.objects.drop(rec);
    return true;
  }
  // OCPY: new owner slot (-1 = nobody)
  setOwner(ref, slot) {
    const rec = this.objects.get(ref);
    if (!rec) return false;
    const p = this.player(slot), from = rec.owner;
    if (rec.entity) return this.world.setOwner(rec.entity, p);          // 'owner' is emitted from the world event
    rec._slot = p ? p.id : -1;
    this.emit('owner', rec, from, p);
    return true;
  }
  // ACDO SetPos: map position, optional map heading
  teleport(ref, mx, my, rot) {
    const rec = this.objects.get(ref);
    if (!rec) return false;
    const [x, z] = this.toGame(mx, my);
    if (rec.entity) return this.world.teleport(rec.entity, x, z, rot != null ? this.heading(rot) : undefined);
    if (rec.prop) { rec.prop.pos.set(x, this.world.height(x, z), z); rec.prop.obj.position.copy(rec.prop.pos); if (rot != null) rec.prop.obj.rotation.y = this.heading(rot); return true; }
    rec._x = mx; rec._y = my;
    return true;
  }
  // OBAP: flags = 1 visible | 2 hitable | 4 selectable (| 8 constructible | 16 destructible | 32 deconstructible:
  // kept on the record only). An object without the visible flag is out of the world until it gets it back.
  setAppearance(ref, flags) {
    const rec = this.objects.get(ref);
    if (!rec) return false;
    rec.flags = flags;
    rec.visible = !!(flags & 1); rec.hitable = !!(flags & 2); rec.selectable = !!(flags & 4);
    const e = rec.entity;
    if (e) {
      this.world.setParked(e, !rec.visible);
      e.untargetable = !rec.hitable;
      e.unselectable = !rec.selectable;
      if (!rec.selectable && this.G.sel && this.G.sel.delete(e) && this.G.selChanged) this.G.selChanged(true);
    }
    if (rec.prop) rec.prop.setVisible(rec.visible);
    return true;
  }
  // only the visible flag
  setVisible(ref, on) { const rec = this.objects.get(ref); if (!rec) return false; const f = rec.flags != null ? rec.flags : 7; return this.setAppearance(rec, on ? f | 1 : f & ~1); }
  // ACDO SetAnim: play an animation of the object's model `loops` times (<= 1: once). false if it has none
  playAnim(ref, name, loops = 1) {
    const rec = this.objects.get(ref);
    if (!rec) return false;
    if (rec.prop) return rec.prop.playAnim(name, loops);
    const e = rec.entity;
    if (!e || !e.anim || !e.anim.has(name)) return false;
    if (e.kind === 'unit') { this.world.releaseTask(e); e.task = { type: 'idle' }; e.path = []; e.busyAnim = true; }
    let left = Math.max(1, Math.round(loops) || 1);
    const again = () => { if (--left > 0 && e.alive) e.anim.play(name, { loop: false, restart: true, onDone: again }); else if (e.kind === 'unit') e.busyAnim = false; else if (e.idleAnim && !/open|close/.test(name)) e.idleAnim(); };
    e.anim.play(name, { loop: false, restart: true, onDone: again });
    return true;
  }
  // QMRK: state = 'STATE_INVISIBLE' | 'QM_STATE_RED' | 'QM_STATE_GREEN' | 'QM_STATE_YELLOW' | 'EC_STATE_YELLOW' (or 0-4)
  setQuestionMark(ref, state, tooltip) {
    const m = this.questionMarks.find((q) => q.guid === ref || q.name === ref || q === ref);
    if (!m) return false;
    m.state = typeof state === 'number' ? QM_STATES[state] || 'STATE_INVISIBLE' : state;
    if (tooltip != null) m.tooltip = tooltip;
    this.emit('questionmark', m);
    return true;
  }
  // the index entry of the mission after this one (null after the last)
  next() { const i = this.index.findIndex((e) => e.id === this.id); return i >= 0 && i + 1 < this.index.length ? this.index[i + 1] : null; }
}
export { Rec, Group, Registry, Regions, Prop };
