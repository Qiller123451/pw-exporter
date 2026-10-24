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
import { mapHeading } from '../maps/frame.js';
import { Registry, Rec, Group } from './registry.js';
import { Prop } from '../prop.js';
import { AMPHIBIOUS } from '../entities.js';
import { TriggerEngine, prescan } from './engine.js';
import { TribeSwap, TRIBES, tribeOfClass } from './tribes.js';
import { PointBuy } from '../pointbuy.js';

const UNIT_TYPES = new Set(['CHTR', 'ANML', 'VHCL', 'SHIP']);
// the landscape of the map: left to maps/source.js (instanced, resources, nests) unless a mission addresses the object
const LANDSCAPE = new Set(['TREE', 'VGTN', 'WOOD', 'STON', 'FRUI', 'DCCO', 'DECO', 'NEST']);
// parts of other objects that the remake assembles itself (game/compose.js): riders, build-ups, turrets, cranes
const RESOURCES = new Set(['TREE', 'WOOD', 'STON', 'FRUI', 'NEST']);
const PARTS = new Set(['PROD', 'TRRT', 'MNIO']);
// helper objects of the editor / the scripts: a record, nothing in the world
const HELPERS = new Set(['SLOC', 'WYPT', 'GROU', 'QMRK', 'OTHR', 'DMGL', 'COLL', 'FOOD', 'ITSP']);
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
  // G = the game object; loaded = loadCampaign(); cfg = { campaign, difficulty, tribe (optional: the player's tribe
  // instead of the mission's, tribes.js), army (optional: bought on the army screen, game/pointbuy.js) }
  constructor(G, loaded, cfg) {
    this.G = G;
    this.index = loaded.index; this.entry = loaded.entry;
    this.data = loaded.data;
    this.id = loaded.entry.id;
    this.difficulty = Math.max(0, Math.min(2, cfg.difficulty == null ? 1 : +cfg.difficulty));    // 0 easy, 1 medium, 2 hard
    // 3 Nightmare (the remake's own): the map, its triggers and AI levels as hard, the computer players' raids with
    // the remake's bigger squads (ai/attack.js extraSquads)
    this.nightmare = +cfg.difficulty === 3;
    this.chosenTribe = TRIBES.includes(cfg.tribe) ? cfg.tribe : null;
    this.army = cfg.army && cfg.army.cards ? cfg.army : null;               // the human's start army and resources
    this.swap = null;                            // TribeSwap when the player plays another tribe than the mission's
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
    this.resourceRecs = [];                      // records of addressed trees, stones, bushes (rec.node: the resource)
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
  // map (x east, y south; metres from the map's north-west corner) <-> game (x east, z south, origin = centre)
  toGame(mx, my) { return [mx - this.ox, my - this.oy]; }
  toMap(x, z) { return [x + this.ox, z + this.oy]; }
  // "[x y z]", "x y z" or "x, y, z" of a trigger parameter -> { x, z (game), mx, my, mz (map), zero } or null
  vec(s) {
    const m = String(s == null ? '' : s).match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi);
    if (!m || m.length < 2) return null;
    const mx = +m[0], my = +m[1], mz = m.length > 2 ? +m[2] : 0;
    const [x, z] = this.toGame(mx, my);
    return { x, z, mx, my, mz, zero: mx === 0 && my === 0 && mz === 0 };
  }
  // heading of the map data (objects[].rot, the z angle of obj_rot) -> the world's heading (rotation about y):
  // maps/source.js mapHeading
  heading(rot) { return mapHeading(rot); }
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
  // the mount whose captain (rider) class is `cls`, for a rider class that cannot stand on its own (its tech tree
  // object has a placeholder 1 hit point), else null
  mountOf(cls) {
    const D = this.D, s = D.stats(cls, 1, null);
    if (!s || !(s.hp <= 1)) return null;
    if (!this.mounts) {
      this.mounts = new Map();
      for (const k of D.index.keys()) { const st = D.stats(k, 1, null); if (st && st.captain && !this.mounts.has(st.captain.toLowerCase())) this.mounts.set(st.captain.toLowerCase(), k); }
    }
    return this.mounts.get(String(cls).toLowerCase()) || null;
  }
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
  // the classes of the objects an OCPY action gives the player by name (mission 12's telescope tower ruin): the
  // player is given that very object, whatever tribe it was chosen to play
  givenClasses() {
    const byName = new Map((this.data.objects || []).map((o) => [o.name, String(o.class || '').toLowerCase()]));
    const out = new Set();
    for (const t of this.data.triggers || []) for (const a of t.actions || []) if (a.type === 'OCPY' && byName.has(a.p.obj_name)) out.add(byName.get(a.p.obj_name));
    return out;
  }
  // does a condition of the mission ask for the player's objects of this tribe's classes? Mission 14 lets the
  // player bring the Norsemen, the Dustriders or the Dragon Clan and asks which tribe's workers it has
  asksFor(tribe) {
    const slot = String(this.humanSlot);
    for (const t of this.data.triggers || []) {
      for (const c of t.conditions || []) if (String(c.p.obj_owner) === slot && tribeOfClass(c.p.obj_class || '') === tribe) return true;
    }
    return false;
  }
  // D = Rules, manifest = asset manifest models. Classifies every placed object and collects models and skip names.
  plan(D, manifest) {
    this.D = D; this.manifest = manifest;
    const data = this.data;
    const human = data.players.find((p) => p.present && p.type === 'human') || data.players.find((p) => p.present);
    this.humanSlot = human ? human.id : 0;
    this.missionTribe = human ? human.tribe || '' : '';
    if (this.chosenTribe && this.missionTribe && this.chosenTribe !== this.missionTribe) this.swap = new TribeSwap(D, this.missionTribe, this.chosenTribe, { given: this.givenClasses(), native: this.asksFor(this.chosenTribe), models: manifest });
    this.humanTribe = this.swap ? this.chosenTribe : this.missionTribe;
    this.tribes = [...new Set(data.players.filter((p) => p.present && p.tribe).map((p) => (p === human ? this.humanTribe : p.tribe)))];
    this.fullTribes = this.humanTribe ? [this.humanTribe] : [];
    // what the triggers name: classes (models loaded, scenery made addressable) and objects
    const named = this.namedByTriggers();
    this.namedClasses = new Set();
    for (const w of named) { if (this.ruleClass(w) || manifest[w.toLowerCase()]) { this.namedClasses.add(w.toLowerCase()); this.needClass(w); } }
    // the effects the triggers play (EFCT): the models of the particle database
    const pdb = D.extra.particles || {};
    for (const t of data.triggers || []) for (const a of t.actions || []) {
      const fx = a.type === 'EFCT' && pdb[String(a.p.effect_path || '').replace(/^\/+|\/+$/g, '').toLowerCase()];
      if (fx) this.needClass(fx[0]);
    }
    // what the triggers will create that no parameter names (engine.js prescan): the whole tribe of an AI player that
    // gets a building behaviour (AIBV Dodo / Giraffe / Schnecke / Turtle), the classes of the AIFT army tables
    const pre = prescan(this, this.G.aiData || null);
    for (const t of pre.fullTribes) if (!this.fullTribes.includes(t)) this.fullTribes.push(t);
    for (const c of pre.classes) this.needClass(c);
    const refs = data.refs || {};
    const refNames = new Set();
    for (const g in refs) if (refs[g][1]) refNames.add(refs[g][1]);
    for (const o of data.objects) {
      const lc = String(o.class).toLowerCase();
      const pl = { o, kind: 'none' };
      this.plans.push(pl);
      let rule = this.ruleClass(o.class), type = o.type || '';
      // the player's objects become the chosen tribe's (tribes.js); the type of an equivalent can differ (the
      // Dustriders' resource collector is an animal, the Norsemen's fireplace a building)
      if (rule && o.owner === this.humanSlot && (UNIT_TYPES.has(type) || type === 'BLDG')) {
        const to = this.ownClass(rule);
        if (to !== rule) { rule = to; type = D.info(to).type; pl.swapped = true; }
      }
      const ix = rule ? D.info(rule) : null;
      // scenery a mission addresses (by GUID, name or class), hides or gives to a player stands on its own
      const addressed = !!refs[o.guid] || refNames.has(o.name) || named.has(o.name) || this.namedClasses.has(lc) || o.visible === false || (o.owner != null && !RESOURCES.has(type));
      // (placed effects - CFX - show like scenery; a heal glow saved with a unit is not one: FightingObj.HealMe)
      if (HELPERS.has(type) || lc === 'virtual_produce_unit' || (type === 'CFXE' && lc === 'fx_heal_passive')) { pl.kind = 'helper'; this.skip.add(o.name); continue; }
      if (PARTS.has(type)) { pl.kind = 'part'; this.skip.add(o.name); continue; }
      // the rider of a ridden animal saved as an object of its own (is_riding, transporter_guid: MIRAGE mission 7's
      // aje_velociraptor_handler_char_4 on aje_velociraptor_handler_4) is part of its mount, which shows it already;
      // alone it would stand with no hit points (its class is a 1-HP placeholder)
      if (rule && (o.attr || {}).is_riding === '1' && (o.attr || {}).transporter_guid && this.mountOf(rule)) { pl.kind = 'part'; this.skip.add(o.name); continue; }
      if (ix && UNIT_TYPES.has(ix.type) && UNIT_TYPES.has(type)) {
        pl.kind = 'unit'; pl.cls = rule; this.skip.add(o.name);
        this.classModels(rule);
        continue;
      }
      // (and the gates of nobody - mission 16's seas_hq_gate: a CGate opens and closes whoever owns it)
      if (ix && ix.type === 'BLDG' && type === 'BLDG' && ((o.owner != null && data.players[o.owner] && data.players[o.owner].present) || (o.owner == null && D.isA(rule, 'CGate')))) {
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
      // trees, stones and fruit bushes a mission addresses (the tutorial highlights the bushes with OCPY) stay
      // resources of the map source; their record follows the resource node (build: rec.node). Hidden ones stay
      // scenery that can be shown later (OBAP).
      if (RESOURCES.has(type) && type !== 'NEST' && o.visible !== false) { pl.kind = 'resource'; continue; }
      // everything else is scenery of its own: needs a model
      this.skip.add(o.name);
      const model = this.modelOf(o, manifest);
      if (!model) { pl.kind = 'missing'; continue; }
      pl.kind = 'prop'; pl.model = model;
      this.need.add(model);
    }
    // the chests of the items the item spawns make (systems/items.js)
    if (data.objects.some((o) => o.type === 'ITSP')) this.need.add('item_treasure_chest');
    // start locations: main buildings and start armies
    for (const p of data.players) {
      if (!p.present) continue;
      const tribe = p === human ? this.humanTribe : p.tribe;
      if (p.include_buildings && MAIN_BUILDING[tribe]) this.classModels(MAIN_BUILDING[tribe]);
      if (p === human && this.army) for (const c of Object.values(this.army.cards)) this.classModels(new PointBuy(this.D).resolve(c, tribe).cls);
      else for (const a of p.start_army || []) { const c = p === human ? this.ownClass(a.class) : a.class; this.classModels(c); const r = this.ruleClass(c), m = r && this.mountOf(r); if (m) this.classModels(m); }
    }
    return this;
  }
  // the class an object of the human player gets: with another tribe chosen, the equivalent of that tribe
  ownClass(cls) { const r = this.ruleClass(cls); return this.swap && r ? this.swap.cls(r) : r || cls; }
  // a tech tree filter path for player p (the player's filters translated to the chosen tribe; null = none)
  filterFor(p, path) { return this.swap && p === this.human ? this.swap.filter(path) : path; }
  // models to load on top of the full tribes and the map's landscape
  models() { return this.need; }

  // ------------------------------------------------------------------ build (from main.js buildWorld)
  // W = the World, S = the map source (maps/source.js). Returns the human player.
  build(W, S) {
    const G = this.G, D = this.D, data = this.data;
    this.world = W;
    this.ox = S.origin[0]; this.oy = S.origin[1];
    this.regions = new Regions(data.regions, (mx, my) => this.toGame(mx, my), (x, z) => this.toMap(x, z));
    this.world.regions = this.regions;             // (named regions the buildings' behaviours use: the Scorpion's attacks)
    this.objects = new Registry(this, this.regions);
    // ---- players (triggers.md §6.7 no. 1, 2; ServerApp.usl:398-599)
    const list = [];
    for (const pd of data.players) {
      if (!pd.present) continue;
      const c = PLAYER_COLORS[pd.color] || null;
      const me = pd.id === this.humanSlot;
      const p = new Player(pd.id, (me ? this.humanTribe : pd.tribe) || '', {
        ai: !me, name: pd.name || ('Player ' + pd.id), team: pd.team,
        color: c ? hex(c.dark) : me ? NEUTRAL_UI.me : 0x9a9a9a, partyColor: c ? hex(c.light) : null, colorSlot: c ? pd.color : -1,
        rules: D, diplomacy: pd.diplomacy,
      });
      p.slot = pd.id; p.data = pd;
      // played with another tribe: buildings of the mission's tribe the player is given keep their own actions
      // where the chosen tribe has nothing of that role (the tavern for the SEAS, rules.js actionsOf)
      if (me && this.swap) p.foreignActions = true;
      // army pyramid and population limit of the level (Restrictions/Chars; Player.usl:281, RequirementsMgr.usl:186)
      const lim = (pd.unit_limits || []).map((u, i) => (u && u.max != null ? u.max : D.pyramid[i]));
      if (lim.length === 5 && lim.some((v, i) => v !== D.pyramid[i])) p.pyramid = lim;
      if (pd.population_limit != null && pd.population_limit > 0) p.popMax = pd.population_limit;
      this.players[pd.id] = p;
      list.push(p);
    }
    W.players = list;
    this.human = this.players[this.humanSlot];
    // debug option "no mission bans" (game/cheats.js): the level's AntiActions do not reach the human (scripting.js setFilter)
    const ch = G.config && G.config.cheats;
    if (this.human && ch && ch.on && ch.unlock) this.human.unlockAll = true;
    for (const p of list) p.tt.suspend();
    // tech tree filters of the level: mostly AntiActions = what the mission forbids (ServerApp.usl:527-535)
    for (const p of list) {
      const fs = p.data.tech_filters || [];
      for (const g of this.swap && p === this.human ? this.swap.filters(fs) : fs) if (g) W.setFilter(p, g, true);
    }
    // MIRAGE adds filters by level name (MirageSrvMgr.HardcodeTTFilters, for every player). As MIRAGE ships it, only its
    // first branch takes effect: the tutorial and missions 1 and 2 ban Larry and Tarna for every tribe and the tutorial
    // gets the Norse ladder; the checks for later missions (old_school_stats, tesla tower, roguemask ...) are nested
    // inside that branch and never run - followed here as the game plays.
    const key = this.entry && this.entry.key;
    if (this.D.extra && this.D.extra.mod === 'MIRAGE' && (key === 'tutorial' || key === 'single_01' || key === 'single_02')) {
      const extra = [];
      for (const h of ['Larry_s0', 'Tarna_s0']) for (const t of ['Hu', 'Aje', 'Ninigi', 'SEAS']) extra.push(`/Filters/AntiActions/${t}/Build/CHTR/${h}`);
      if (key === 'tutorial') extra.push('/Filters/Hu/Build/BLDG/hu_ladder');
      for (const p of list) for (const g of extra) W.setFilter(p, g, true);
    }
    // stand-ins for classes without a model
    for (const pl of this.plans) if (pl.cls) { const si = this.standInModel(pl.cls); if (si) W.standIns.set(pl.cls.toLowerCase(), si); }
    for (const w of this.namedClasses) { const r = this.ruleClass(w); const si = r && this.standInModel(r); if (si) W.standIns.set(r.toLowerCase(), si); }

    // ---- records for every object, in the order of the data
    W.onEntity = (e) => this.entityCreated(e);
    for (const pl of this.plans) {
      const o = pl.o;
      const rec = pl.rec = new Rec({ guid: o.guid, name: o.name, cls: pl.swapped ? pl.cls : o.class, type: pl.swapped ? this.D.info(pl.cls).type : o.type || '', index: o.index, handle: o.handle, slot: o.owner == null ? -1 : o.owner, x: o.x, y: o.y, data: o });
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
      else if (pl.kind === 'resource') {
        const [x, z] = this.toGame(o.x, o.y);
        rec.node = W.resources.find((n) => n.alive && Math.abs(n.pos.x - x) < 1.5 && Math.abs(n.pos.z - z) < 1.5) || null;
        rec.placed = !!rec.node;
        if (rec.node) this.resourceRecs.push(rec); else this.miss(o.class, 'no resource of the map');
      }
      else if (pl.kind === 'prop' && o.type === 'FNTN' && rec.prop) W.addWell(rec.prop, o.attr, o.class);     // healing wells
      else if (pl.kind === 'prop' && o.type === 'ITEM' && rec.prop) W.placeItem(o.class, rec.prop.pos.x, rec.prop.pos.z, rec.prop.rot, rec.prop);  // items
      else if (pl.kind === 'helper' && o.type === 'DMGL') {
        // lakes of healing / damage (systems/landmarks.js): a region of the map
        const a = o.attr || {};
        W.addLake({ name: o.name, region: a.region_name || '', heal: D.isA(o.class, 'CLakeOfHealing'), amount: +a.damage_per_tick || 0, types: a.damage_types || '' });
      }
      else if (pl.kind === 'helper' && o.type === 'OTHR' && /^showfow/i.test(o.class) && this.players[o.owner]) {
        // a placed ShowFOW_Obj: its owner sees the place (the radius is not in the data: 20 m, a guess)
        const [x, z] = this.toGame(o.x, o.y);
        rec.reveal = W.revealArea(this.players[o.owner], x, z, 20, 0);
      }
    }
    // the items the level's item spawns make (CItemMgr.GenerateItems; the level's Root/Items: S.itemPool)
    const spawns = this.plans.filter((pl) => pl.o.type === 'ITSP').map(({ o }) => {
      const a = o.attr || {}, [x, z] = this.toGame(o.x, o.y), yes = (v) => v === '1' || v === 'true';
      return { x, z, rot: this.heading(o.rot), items: String(a.spawn_items || '').split('|').map((c) => c.trim()).filter(Boolean), always: yes(a.generate_always), random: yes(a.random_item) };
    });
    if (spawns.length && S.itemPool) W.generateItems(spawns, S.itemPool.pool, S.itemPool.max);
    // (the items they made are objects of the mission: the triggers find them by class - GiveItem, ITEM)
    for (const it of W.items) if (!it.rec) { const rec = new Rec({ name: this.objects.newName(it.name), cls: it.name, type: 'ITEM' }); rec.prop = it; it.rec = rec; this.objects.add(rec); }
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
    // the Dustriders' mobile base the player starts with (the map's, the start location's, the army's) is not driven
    // in from wherever it was put: it waits, and a worker puts it down where the player wants - at once and for
    // free (the user's choice; placeFreeMain)
    this.parkFreeMains();
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
  // the human's mobile bases (at the start: the map's, the start location's, the army's) wait for a worker. A mission
  // made for the Dustriders but played by another tribe: the main building that stands in for the collector (the
  // start location's, a map's collector converted) waits the same way.
  parkFreeMains() {
    const W = this.world, p = this.human;
    if (!p) return;
    p.freeMains = p.freeMains || [];
    const park = (e) => { if (e && e.alive && e.owner === p && !e.parked && !p.freeMains.includes(e)) { W.setParked(e, true); p.freeMains.push(e); } };
    for (const u of W.units) if (u.name === 'aje_resource_collector') park(u);
    if (this.missionTribe !== 'Aje') return;
    for (const e of [...W.units, ...W.buildings]) if (e.startMain) park(e);
    for (const pl of this.plans) if (pl.swapped && pl.rec && this.ruleClass(pl.o.class) === 'aje_resource_collector') park(pl.rec.entity);
  }
  // put down a waiting main (freeMains) at (x, z), turned rot: true when the ground there is free. A building is
  // made anew there, ready (its record - a map object's - moves to it); a unit is moved.
  placeFreeMain(u, x, z, rot = 0) {
    const W = this.world, p = this.human, list = p ? p.freeMains || [] : [];
    if (!u || !list.includes(u) || !u.alive || !this.freeMainOk(u, x, z, rot)) return false;
    list.splice(list.indexOf(u), 1);
    if (u.kind === 'building') {
      const rec = u.rec || null;
      u.rec = null;
      const at = W.placement(u.name, x, z, rot, p);
      W.removeEntity(u);
      this.pending = rec;
      const b = W.placeAdapted(u.name, p, at.x, at.z, at.rot, true);
      this.pending = null;
      if (b && rec) b.rec = rec;
      if (this.engine && this.engine.touch) this.engine.touch();
      return !!b;
    }
    W.teleport(u, x, z);
    u.heading = rot; if (u.obj) u.obj.rotation.y = rot;
    W.setParked(u, false);
    if (u.obj) u.obj.visible = true;
    if (this.engine && this.engine.touch) this.engine.touch();
    return true;
  }
  // may it stand there: walkable land the player has seen, free of anything else
  freeMainOk(u, x, z, rot = 0) {
    const W = this.world, nav = W.nav, r = (u.radius || 4) + 1;
    if (W.fow && W.fow.explored_ && !W.fow.explored_(x, z)) return false;
    if (u.kind === 'building') return !!W.placement(u.name, x, z, rot, this.human).ok;   // (the building rules)
    for (let dz = -r; dz <= r; dz += 1) for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dz * dz > r * r) continue;
      if (!nav.isFree(x + dx, z + dz)) return false;
    }
    let busy = false;
    W.uHash.query(x, z, r + 6, (o) => { if (!busy && o.alive && o !== u && !o.parked && Math.hypot(o.pos.x - x, o.pos.z - z) < r + (o.radius || 1)) busy = true; });
    return !busy;
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
    // the flag bits are decoded by correlation only (CAMPAIGN_FORMAT.md §6): `visible` is certain, the others hints.
    // `invulnerable` (bit 31) is not applied: it is also set on trees, question marks and groups, mission 9 makes its
    // flagged objects invulnerable by trigger, and mission 1's prison guard hu_warrior_68 has it but must be killed.
    // Invulnerability comes from the triggers (ACDO Invulnerability) only.
    const flags = (o.visible === false ? 0 : 1) | (o.hitable === false ? 0 : 2) | (o.selectable === false ? 0 : 4);
    if (flags !== 7) this.setAppearance(rec, flags);
  }
  placeBuilding(pl) {
    const o = pl.o, W = this.world, a = o.attr || {};
    const [x, z] = this.toGame(o.x, o.y);
    this.pending = pl.rec;
    // building_ready "0" = a construction site (the zeppelin wreck of mission 4). Without the attribute and with 0 hit
    // points the building was never put up (the launch ramp of mission 9, "Order your workers to build the ramp!")
    const ready = a.building_ready != null ? a.building_ready !== '0' : a.hitpoints == null || +a.hitpoints > 0;
    const owner = this.players[o.owner], same = String(pl.cls).toLowerCase() === String(o.class).toLowerCase();
    // (walls, gates, towers and traps of every tribe share the 8 m wall grid: the equivalent stands in the same place)
    const at = same || this.onWallGrid(pl.cls, owner) ? { x, z, rot: this.heading(o.rot) } : this.fit(pl.cls, owner, x, z, this.heading(o.rot));
    const b = W.placeBuilding(pl.cls, owner, at.x, at.z, at.rot, ready);
    this.pending = null;
    if (!b) { this.counts.missing++; this.miss(o.class, 'no model'); return; }
    if (b.def.gate && a.GateState != null && W.setGate) W.setGate(b, +a.GateState);     // 0 open, 1 closed, 2 automatic
    // CLaunchPad.OnPostLoad: the Dragon Clan's telescope tower ruins (mission 12) are sites already half built
    if (!ready && String(o.class).toLowerCase() === 'ninigi_telescope_tower_ruins' && W.addProgress) W.addProgress(b, 0.49);
    this.counts.buildings++;
    this.applyState(pl, b);
  }
  onWallGrid(cls, owner) { const d = this.world.data.def(cls, owner); return !!(d && d.wallKind); }
  // a building of another tribe's class (tribes.js) can be bigger than the one the map was made for, and harbours snap
  // to the coast: the nearest place where it fits (else where it was)
  fit(cls, owner, x, z, rot) {
    const W = this.world;
    for (let k = 0; k < 160; k++) {
      const r = k ? 1 + k * 0.25 : 0, a = k * 2.4;
      const pl = W.placement(cls, x + Math.cos(a) * r, z + Math.sin(a) * r, rot, owner);
      if (pl.ok && !pl.replace && !pl.existing) return { x: pl.x, z: pl.z, rot: pl.rot };
    }
    return { x, z, rot };
  }
  placeUnit(pl) {
    const o = pl.o, W = this.world;
    const [x, z] = this.toGame(o.x, o.y);
    const owner = o.owner != null ? this.players[o.owner] || null : null;
    this.pending = pl.rec;
    const u = W.spawn(pl.cls, owner, x, z, { level: Math.max((o.level || 0) + 1, this.D.minLevel(pl.cls, owner)), heading: this.heading(o.rot), unit: { alt: o.z } });   // (alt: the zeppelin's height)
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
    const block = !NO_BLOCK.test(lc) && (o.type === 'DCCO' || o.type === 'BLDG' || o.type === 'FNTN' || SOLID.test(lc));
    const owner = o.owner != null ? this.players[o.owner] : null;
    // scenery keeps its stored height; ship models (wrecks, moored boats, mines: model type "Ship") are stored at the
    // sea bed and float at the water level, as the game puts them when it loads the map
    let y = landscape || o.type === 'BLDG' || !o.type ? o.z : null;
    if (W.templates(pl.model, true).fourcc === 'Ship' && W.waterLevel != null && (y != null ? y : W.height(x, z)) < W.waterLevel) y = W.waterLevel;
    const prop = new Prop(W, { model: pl.model, x, z, y, rot: this.heading(o.rot), q: o.q, block, blockRadius: block ? Math.min(24, this.modelRadius(pl.model) * 0.7) : 0, party: owner ? owner.partyColor : null });
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
      // Aje: the resource collector only for a computer player (or without an army budget), SL:386-390 - a human
      // buys it with the army. A mission made for another tribe has no collector in its army: then it stands here.
      const cls = MAIN_BUILDING[p.tribe], bought = p.tribe === 'Aje' && !p.ai && !(this.swap && p === this.human);
      const e = bought ? null : W.spawn(cls, p, x, z, { heading });
      if (e && p === this.human) e.startMain = true;            // (parkFreeMains)
      if (e) stand = e.radius;
      else if (!bought) this.miss(cls, 'start building not created');
    }
    if (sl.ignore_pointbuy) return;
    // the army screen's army (SL:482-623 with the result the menu wrote, GIW:430-431)
    if (p === this.human && this.army) {
      new PointBuy(D).place(W, p, this.army, x, z, { stand: 0.99 * stand + 1.5, face: heading });
      p.res.skulls = Math.max(0, (pd.resources || {}).iron || 0);
      return;
    }
    (pd.start_army || []).forEach((a, i) => {
      // SL:545-556: workers stand in three groups by caste around the start, heroes and soldiers anywhere around it
      const ang = a.caste === 'tec' ? 2.094 : a.caste === 'nat' || a.preset === 'Stina_s0' ? 4.189 : a.caste === 'res' ? 0 : (i * 2.399) % 6.283;
      const r = 0.99 * stand + 1.5 + (i % 3) * 1.2;
      const gx = x + Math.cos(ang + 0.785) * r, gz = z - Math.sin(ang + 0.785) * r;
      let rule = this.ruleClass(p === this.human ? this.ownClass(a.class) : a.class);
      // an army slot that names a rider (MIRAGE mission 7: aje_velociraptor_handler_char - the pyramid shows the
      // rider) is the animal it rides; on its own the rider has no hit points (a 1-HP placeholder: NaN / 0)
      if (rule) rule = this.mountOf(rule) || rule;
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
          if (!rec || rec.entity !== e.entity) break;          // converted meanwhile (convert): the record lives on
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
    // a used up resource the triggers address is gone (DEAD)
    if (this.resourceRecs.length && this.resourceRecs.some((r) => !r.node.alive)) {
      for (const r of this.resourceRecs) if (!r.node.alive) this.objects.drop(r);
      this.resourceRecs = this.resourceRecs.filter((r) => r.node.alive);
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
    const rule = this.ruleClass(owner && owner === this.human ? this.ownClass(cls) : cls);
    let rec = null;
    if (rule) {
      const ix = D.info(rule);
      // (an amphibious transport - the hovercraft - may stand on the water: mission 7's hard Wehrspinne convoy was put
      // on the shore 58 m from its place, outside the region its waypoint order looks in, and never set off)
      if (ix.type !== 'BLDG' && !opts.exact) [x, z] = W.freeSpot(x, z, AMPHIBIOUS.test(rule) ? { unit: { amphib: true } } : { water: ix.type === 'SHIP' });
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
    if (rec.entity && p && p === this.human && this.ownClass(rec.entity.name) !== rec.entity.name) return this.convert(rec, p);
    if (rec.entity) return this.world.setOwner(rec.entity, p);          // 'owner' is emitted from the world event
    rec._slot = p ? p.id : -1;
    this.emit('owner', rec, from, p);
    return true;
  }
  // an object given to the player in a mission played with another tribe becomes the chosen tribe's (tribes.js):
  // the same record (name, groups) gets a new world object of the equivalent class in the same place (a building where
  // it fits: fit; walls, gates, towers, traps exactly, a gate with its state), with the same share of hit points and
  // level; 'owner' is emitted as for OCPY
  convert(rec, p) {
    const W = this.world, e = rec.entity, from = e.owner, to = this.ownClass(e.name);
    const bld = e.kind === 'building', x = bld && e.origin ? e.origin.x : e.pos.x, z = bld && e.origin ? e.origin.z : e.pos.z, rot = bld ? e.rot || 0 : e.heading || 0;
    const ix = this.D.info(to), ratio = e.hp / e.maxHp, gateState = e.def.gate ? e.gateState : null;
    const level = e.kind === 'unit' ? e.level : undefined, built = e.kind !== 'building' || e.built;
    if (this.G.sel) this.G.sel.delete(e);
    W.removeEntity(e);
    rec.entity = null;
    rec.setClass(to, ix.type);
    this.pending = rec;
    const at = ix.type === 'BLDG' && !this.onWallGrid(to, p) ? this.fit(to, p, x, z, rot) : { x, z, rot };
    const n = W.spawn(to, p, at.x, at.z, { level: level != null ? Math.max(level, this.D.minLevel(to, p)) : undefined, heading: at.rot, built });
    this.pending = null;
    if (!n) { this.warn(`${to}: could not be created for the player (model not loaded?)`); this.objects.drop(rec); return false; }
    n.hp = Math.max(1, Math.round(n.maxHp * ratio));
    if (gateState != null && n.def.gate && W.setGate) W.setGate(n, gateState);
    if (n.kind === 'building') n.updateVisual();
    else n.home.set(n.pos.x, n.pos.z);
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
    if (e.kind === 'unit') { this.world.releaseTask(e); this.world.dropStates(e); e.task = { type: 'idle' }; e.path = []; e.busyAnim = true; }
    let left = Math.max(1, Math.round(loops) || 1);
    if (e.kind === 'building') e.lastAnim = name;          // its last pose (a gate that opened) in a saved game
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
