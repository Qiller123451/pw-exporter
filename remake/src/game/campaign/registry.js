// The object registry of a campaign mission: every object the triggers can address has a record (Rec) here -
// the placed units, buildings and scenery of the map, the groups, and everything created at run time (start army,
// produced units, spawned groups). Triggers address objects by GUID, by name, by handle (group member lists), by
// class + owner + type, and by region (remake/docs/spec/triggers.md §2); select() implements that parameter block.
//
// A record outlives its object: when the object dies or is deleted, rec.alive becomes false and the record leaves
// the lookup tables ("an object that is not found" = dead, as the DEAD condition needs it).
import { Regions } from './regions.js';

const UNIT_TYPES = new Set(['CHTR', 'ANML', 'VHCL', 'SHIP']);
// object types an "All" query never returns (ConditionFactory.usl:619-627: no OTHR, no food objects), plus the
// editor's helper objects that are not things of the world
const NOT_REAL = new Set(['OTHR', 'FOOD', 'FRUI', 'SLOC', 'WYPT', 'QMRK', 'GROU', 'ITSP', 'DMGL', 'CFXE', 'COLL', '']);

export class Rec {
  // o: { guid, name, cls, type, index, handle, slot, x, y, data }
  constructor(o) {
    this.guid = o.guid || null;
    this.name = o.name;
    this.cls = o.cls;                           // class as written in the data (Cole_s0, hu_worker)
    this.lc = String(o.cls || '').toLowerCase();
    this.type = o.type || '';                   // CHTR | ANML | VHCL | SHIP | BLDG | DCCO | GROU | ...
    this.index = o.index != null ? o.index : -1;         // position in the map's object list (-1: created at run time)
    this.handle = o.handle || null;             // [index, serial] of the original handle manager
    this.data = o.data || null;                 // the JSON object (placed objects)
    this.entity = null;                         // world Unit / Building (rec.entity.rec === rec)
    this.prop = null;                           // campaign/props.js Prop (scenery, items, non-tech-tree objects)
    this.groupObj = null;                       // type GROU: its Group
    this.group = null;                          // the Group this object is a member of (at most one, GroupObj.usl:93)
    this.alive = true;
    this.placed = true;                         // false: in the data but not in the world (model missing, hidden helper)
    this.visible = true; this.hitable = true; this.selectable = true;      // OBAP flags
    this._slot = o.slot != null ? o.slot : -1;
    this._x = o.x || 0; this._y = o.y || 0;     // map coordinates of objects without a world object
  }
  // owner slot: 0-7, -1 = nobody
  get slot() { const e = this.entity; return e ? (e.owner ? e.owner.id : -1) : this._slot; }
  get owner() { return this.entity ? this.entity.owner : null; }
  get isUnit() { return UNIT_TYPES.has(this.type); }
  // 0-based level as the triggers count it
  get level0() { return this.entity && this.entity.kind === 'unit' ? this.entity.level - 1 : 0; }
}

export class Group {
  constructor(rec) { this.rec = rec; this.guid = rec.guid; this.name = rec.name; this.members = new Set(); }
  get size() { return this.members.size; }
  list() { return [...this.members]; }
}

export class Registry {
  // C = the Campaign (coordinates, events); regions = Regions
  constructor(C, regions) {
    this.C = C;
    this.regions = regions;
    this.all = [];                              // live records in creation order (the order queries return)
    this.guids = new Map(); this.names = new Map(); this.handles = new Map(); this.indices = new Map();
    this.groups = [];
    this.counter = new Map();                   // run-time names: class -> next number
    this.dirty = false;
  }
  // ------------------------------------------------------------------ records
  add(rec) {
    rec.listed = true;
    this.all.push(rec);
    if (rec.guid) this.guids.set(rec.guid, rec);
    if (rec.name && !this.names.has(rec.name)) this.names.set(rec.name, rec);
    if (rec.handle) this.handles.set(rec.handle[0] + ':' + rec.handle[1], rec);
    if (rec.index >= 0) this.indices.set(rec.index, rec);
    return rec;
  }
  // a new name of the form the editor uses: <class>_<n>, n from 0, skipping names that exist
  newName(cls) {
    let n = this.counter.get(cls) || 0;
    while (this.names.has(cls + '_' + n)) n++;
    this.counter.set(cls, n + 1);
    return cls + '_' + n;
  }
  // record of a world entity created at run time (called for every unit / building the world creates)
  adopt(e, o = {}) {
    if (e.rec) return e.rec;
    const cls = o.cls || e.name;
    const rec = new Rec({ guid: o.guid, name: o.name || this.newName(cls), cls, type: o.type || (e.kind === 'building' ? 'BLDG' : e.cls), index: o.index, handle: o.handle, data: o.data });
    rec.entity = e; e.rec = rec;
    return this.add(rec);
  }
  // the object is gone (died, destroyed, deleted): out of the tables and out of its group
  drop(rec) {
    if (!rec || !rec.alive) return;
    rec.alive = false;
    if (rec.guid && this.guids.get(rec.guid) === rec) this.guids.delete(rec.guid);
    if (this.names.get(rec.name) === rec) this.names.delete(rec.name);
    if (rec.handle) this.handles.delete(rec.handle[0] + ':' + rec.handle[1]);
    if (rec.index >= 0) this.indices.delete(rec.index);
    this.dirty = true;
    if (rec.group) this.removeFromGroup(rec);
    this.C.emit('removed', rec);
  }
  // drop() only marks; the list is compacted here (once per step) so that loops over `all` stay valid
  compact() { if (this.dirty) { this.all = this.all.filter((r) => r.alive); this.dirty = false; } }

  // ------------------------------------------------------------------ lookups (live objects only)
  byGuid(g) { return (g && this.guids.get(g)) || null; }
  byName(n) { return (n && this.names.get(n)) || null; }
  byHandle(index, serial) { return this.handles.get(index + ':' + serial) || null; }
  byIndex(i) { return this.indices.get(i) || null; }
  of(entity) { return (entity && entity.rec) || null; }
  // a record from whatever names it: a Rec, a world entity, a GUID or a name
  get(ref) {
    if (!ref) return null;
    if (ref instanceof Rec) return ref.alive ? ref : null;
    if (typeof ref === 'object') return ref.rec && ref.rec.alive ? ref.rec : null;
    return this.byGuid(ref) || this.byName(ref);
  }
  // a Group by Group, Rec, GUID or name
  group(ref) {
    if (ref instanceof Group) return ref;
    const r = this.get(ref);
    return r && r.groupObj ? r.groupObj : null;
  }
  // ------------------------------------------------------------------ groups (GroupObj.usl)
  addToGroup(g, rec) {
    g = this.group(g); rec = this.get(rec);
    if (!g || !rec || rec.groupObj || rec.group === g) return false;       // a group cannot contain a group (GO:85)
    if (g.members.size >= 140) return false;                                // GO:7
    if (rec.group) this.removeFromGroup(rec);                               // a unit is in at most one group (GO:93)
    g.members.add(rec); rec.group = g;
    this.C.emit('group', g, rec, true);
    return true;
  }
  removeFromGroup(rec) {
    const g = rec && rec.group;
    if (!g) return false;
    g.members.delete(rec); rec.group = null;
    this.C.emit('group', g, rec, false);
    return true;
  }

  // ------------------------------------------------------------------ queries
  // position of a record in game coordinates [x, z] (a passenger is where its transport is)
  posOf(rec) {
    const e = rec.entity;
    if (e) { const p = e.inside && e.inside.pos ? e.inside.pos : e.pos; return [p.x, p.z]; }
    if (rec.prop) return [rec.prop.pos.x, rec.prop.pos.z];
    return this.C.toGame(rec._x, rec._y);
  }
  inRegion(rec, region) {
    if (!region || region.world) return true;
    const [x, z] = this.posOf(rec);
    return region.contains(x, z);
  }
  // generic filter: { region (Region | guid | name), types (array | Set of 4-letter types), owner (slot, -1 nobody,
  // undefined any), cls, exclude (array of classes), filter(rec) }. Classes compare without case.
  query(q = {}) {
    const region = q.region ? (typeof q.region === 'string' ? this.regions.get(q.region) : q.region) : null;
    const types = q.types ? (q.types instanceof Set ? q.types : new Set(q.types)) : null;
    const cls = q.cls ? String(q.cls).toLowerCase() : null;
    const ex = q.exclude && q.exclude.length ? new Set(q.exclude.map((c) => String(c).toLowerCase())) : null;
    const out = [];
    for (const r of this.all) {
      if (!r.alive || !r.placed) continue;
      if (r.entity && r.entity.alive === false) continue;     // dying: its "died" event is handled at the end of the slice
      if (types && !types.has(r.type)) continue;
      if (q.owner !== undefined && q.owner !== null && r.slot !== q.owner) continue;
      if (cls && r.lc !== cls) continue;
      if (ex && ex.has(r.lc)) continue;
      if (q.filter && !q.filter(r)) continue;
      if (region && !this.inRegion(r, region)) continue;
      out.push(r);
    }
    return out;
  }
  // the object-query parameter block of conditions and actions (triggers.md §2.1; CObjFinder.MakeQuery,
  // ConditionFactory.usl:530-663). p = the node's parameters (defaults need not be applied), prefix = '' | 'dst_' |
  // 'B_' | 'trgt_' | 'sub_'. Returns live records in creation order; groups are replaced by their members.
  select(p, prefix = '') {
    const g = (k, d) => { const v = p[prefix + k]; return v == null || v === '' ? d : String(v); };
    const region = this.regions.get(g('rgn_guid', ''));
    const name = g('obj_name', 'NA');
    if (name !== 'NA') {
      // by name: GUID first, then the name (CF:535-539); a group = its members (CF:543-551); only the region filters
      const rec = this.byGuid(g('obj_guid', 'NA')) || this.byName(name);
      if (!rec) return [];
      const list = rec.groupObj ? rec.groupObj.list().filter((m) => m.alive) : [rec];
      return region.world ? list : list.filter((r) => this.inRegion(r, region));
    }
    const ts = g('obj_type', 'All');
    const all = ts.includes('All');              // CF:568 Find("All"): "AllNC" counts as All
    const types = all ? null : new Set(ts.split('|').filter(Boolean));
    const owner = parseInt(g('obj_owner', '-2'), 10);
    const cls = g('obj_class', 'NA');
    const ex = g('exclude_class', '').split('|').map((s) => s.trim()).filter((s) => s && s !== 'NA');
    const anyOwner = !(owner >= -1), anyClass = cls === 'NA';
    const res = this.query({
      region, types, owner: anyOwner ? undefined : owner, cls: anyClass ? null : cls, exclude: ex,
      // "All" = all real things (CF:619-639). Without an owner and a class it would return every piece of scenery of
      // the region; no trigger means that (triggers.md §2.1), so such a query is limited to units and buildings.
      filter: all ? (anyOwner && anyClass ? (r) => !!r.entity : (r) => !NOT_REAL.has(r.type)) : null,
    });
    const out = [];
    for (const r of res) { if (r.groupObj) { for (const m of r.groupObj.members) if (m.alive) out.push(m); } else out.push(r); }
    return out;
  }
  // "does this one object match the query" (CObjFinder.Contains, CF:721-757; used by ISFG): a group named in the
  // query does NOT match its members, and "AllNC" is no wildcard here (triggers.md §2.2)
  matches(ref, p, prefix = '') {
    const rec = this.get(ref);
    if (!rec) return false;
    const g = (k, d) => { const v = p[prefix + k]; return v == null || v === '' ? d : String(v); };
    if (!this.inRegion(rec, this.regions.get(g('rgn_guid', '')))) return false;
    const name = g('obj_name', 'NA');
    if (name !== 'NA') return rec.guid === g('obj_guid', 'NA') || rec.name === name;
    const types = g('obj_type', 'All').split('|').filter(Boolean);
    if (!types.includes('All') && !types.includes(rec.type)) return false;
    const owner = parseInt(g('obj_owner', '-2'), 10);
    if (owner >= -1 && rec.slot !== owner) return false;
    const cls = g('obj_class', 'NA');
    if (cls !== 'NA' && rec.lc !== cls.toLowerCase()) return false;
    const ex = g('exclude_class', '').split('|').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return !ex.includes(rec.lc);
  }
}
export { Regions };
