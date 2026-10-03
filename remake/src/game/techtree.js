// The original tech tree, evaluated at runtime.
//
// ParaWorld keeps (almost) all rules in Scripts/Server/settings/Techtree/_TechTree.ttree:
//   StartTT  - the initial values: /Objects/<Tribe>/<Type>/<class>, /Actions/<Tribe>/Build|Upgrades|Moves/...,
//              /Modifications/<Tribe>/<Type>/<Stat>/{tec,res,nat}_{rel,abs}
//   Filters  - named sets of "Modificators" { op, path, value } that are switched on and off by the game:
//              Filters/<Tribe>/Upgrades/<location>/<action>   when an upgrade/invention completes
//              Filters/<Tribe>/BuildObjects/<building>        while a building of that class exists
//              Filters/<Tribe>/Upgrades/<class>/Lvl<N>_...    level filters of units (FightingObj.SetLevelFilter):
//                   names containing "_Bonus" apply to the unit itself, the others to its owner
//              Filters/<Tribe>/Upgrades/<class>/Chief_Bonus   while that unit is at level 5 ("chief")
// A player's tree = StartTT + its enabled filters (applied in priority order). The tree is rebuilt whenever a
// filter is switched, and everything else reads its values from it (see rules.js).
//
// Values are kept as the original strings; use num()/bool() to read them.

export const TRIBES = ['Hu', 'Aje', 'Ninigi', 'SEAS'];
export const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };
export const bool = (v) => v === true || v === '1' || v === 'true' || v === 1;

const split = (path) => path.split('/').filter(Boolean);
// nested lookup
export function nodeAt(root, path) {
  let n = root;
  for (const k of split(path)) { if (n == null || typeof n !== 'object') return undefined; n = n[k]; }
  return n;
}
function parentOf(root, parts, create) {
  let n = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (n[k] == null || typeof n[k] !== 'object') { if (!create) return null; n[k] = n[k] == null ? {} : { _value: n[k] }; }
    n = n[k];
  }
  return n;
}
// scalar value of a node (a node with children keeps its own value in _value)
export function scalar(v) { return v != null && typeof v === 'object' ? v._value : v; }

// apply one modificator to a tree (StartTT-shaped object whose top level holds Objects/Actions/Modifications)
export function applyMod(root, mod) {
  const parts = split(mod.path || '');
  if (!parts.length) return;
  const last = parts[parts.length - 1];
  const op = mod.op;
  if (op === 'remove') { const p = parentOf(root, parts, false); if (p) delete p[last]; return; }
  if (op === 'invisible') {       // AntiActions: hide an action
    const p = parentOf(root, parts, false);
    if (p && p[last] && typeof p[last] === 'object') p[last].visibility = '0';
    return;
  }
  const p = parentOf(root, parts, true);
  const cur = p[last];
  const val = mod.value;
  const setScalar = (x) => { if (cur != null && typeof cur === 'object') cur._value = String(x); else p[last] = String(x); };
  switch (op) {
    case 'add': setScalar(num(scalar(cur)) + num(scalar(val))); break;
    case 'multiply': setScalar(num(scalar(cur), 0) * num(scalar(val), 1)); break;
    case 'replace':
    case 'append':
    default:
      if (val != null && typeof val === 'object') p[last] = structuredClone(val);
      else setScalar(val);
  }
}

// every modificator of a filter node, in declaration order
export function modsOf(filter) {
  const m = filter && filter.Modificators;
  if (!m) return [];
  return Object.values(m).filter((x) => x && typeof x === 'object' && x.path);
}

// Shared, read-only original data
export class TechTreeBase {
  constructor(json) {
    this.start = json.StartTT;
    this.filters = json.Filters;
  }
  filter(path) { return nodeAt(this.filters, path.replace(/^\/?Filters\//, '')); }
  // all filter paths under a prefix (e.g. "Hu/Upgrades/hu_warrior/Lvl3")
  filtersUnder(prefix) {
    const parts = split(prefix.replace(/^\/?Filters\//, ''));
    const head = parts.slice(0, -1).join('/'), tail = parts[parts.length - 1];
    const parent = nodeAt(this.filters, head);
    if (!parent || typeof parent !== 'object') return [];
    return Object.keys(parent).filter((k) => k.startsWith(tail)).map((k) => head + '/' + k);
  }
}

// One player's tree (or the neutral "World" tree for wild animals)
export class TechTree {
  constructor(base, tribe) {
    this.base = base;
    this.tribe = tribe;
    this.enabled = new Map();      // filter path -> count (a building filter stays on while any such building exists)
    this.version = 0;
    this.listeners = [];
    this.rebuild();
  }
  onChange(fn) { this.listeners.push(fn); }
  // the subtrees a player can ever read: own tribe, the heroes ("Special"), the wild world
  rebuild() {
    const S = this.base.start;
    const pick = (sec) => {
      const out = {};
      for (const t of [this.tribe, 'Special', 'World']) if (S[sec] && S[sec][t]) out[t] = structuredClone(S[sec][t]);
      return out;
    };
    this.root = { Objects: pick('Objects'), Actions: pick('Actions'), Modifications: pick('Modifications'), MiscValues: pick('MiscValues'), TimeFactor: pick('TimeFactor') };
    const list = [...this.allEnabled()].map((p) => [p, this.base.filter(p)]).filter(([, f]) => f);
    list.sort((a, b) => num(a[1].priority, 0) - num(b[1].priority, 0));
    for (const [, f] of list) for (const m of modsOf(f)) if (this.relevant(m.path)) applyMod(this.root, m);
    this.version++;
    this.cache = new Map();
    for (const fn of this.listeners) fn(this);
  }
  allEnabled() { return this.enabled.keys(); }
  relevant(path) { const p = split(path); return p.length >= 2 && (p[1] === this.tribe || p[1] === 'Special' || p[1] === 'World'); }
  enable(path) {
    const n = this.enabled.get(path) || 0;
    this.enabled.set(path, n + 1);
    if (!n && this.base.filter(path)) this.changed();
  }
  disable(path) {
    const n = this.enabled.get(path) || 0;
    if (!n) return;
    if (n === 1) { this.enabled.delete(path); if (this.base.filter(path)) this.changed(); } else this.enabled.set(path, n - 1);
  }
  // batch: between suspend() and resume() filter switches do not rebuild the tree (a campaign map places hundreds of
  // buildings and levelled units per player at once); resume() rebuilds once if anything changed. Calls nest.
  changed() { if (this.held) this.dirty = true; else this.rebuild(); }
  suspend() { this.held = (this.held || 0) + 1; }
  resume() { if (this.held && --this.held === 0 && this.dirty) { this.dirty = false; this.rebuild(); } }
  has(path) { return this.enabled.has(path); }
  node(path) { return nodeAt(this.root, path); }
  get(path, d) { const v = scalar(this.node(path)); return v === undefined ? d : v; }
  num(path, d = 0) { return num(this.get(path), d); }
  bool(path) { return bool(this.get(path)); }
  // RequirementsMgr.CheckInvention
  invented(name, tribe = this.tribe) { return this.get(`/Objects/${tribe}/InventObjects/${name}/invented`) === '1'; }
  built(name, tribe = this.tribe) { return this.get(`/Objects/${tribe}/BuildObjects/${name}/build`) === '1'; }
  // memoised derived values, invalidated on every rebuild
  memo(key, fn) { if (!this.cache.has(key)) this.cache.set(key, fn()); return this.cache.get(key); }
  // GetTechTreeModifier: /Modifications/<tribe>/<TYPE>/<stat>/<caste>_{rel|abs}
  // Buildings, animals and vehicles always read the "tec" column; characters read their own caste (res/nat/tec).
  modifier(type, stat, relative, col = 'tec', tribe = this.tribe) {
    return this.num(`/Modifications/${tribe}/${type}/${stat}/${col}_${relative ? 'rel' : 'abs'}`, relative ? 1 : 0);
  }
  // value * rel + abs in one call
  modify(type, stat, v, col = 'tec', tribe = this.tribe) {
    return v * this.modifier(type, stat, true, col, tribe) + this.modifier(type, stat, false, col, tribe);
  }
}

// A tree of its own for one object (the original's "unit-local" tech tree): the owner's tree plus filters that
// were enabled for this object only - e.g. the Aje farm modes, the big tent, the Ninigi "Explode" upgrade.
// It follows the owner's tree: whenever that changes, this one is rebuilt on the next read.
export class LocalTree extends TechTree {
  constructor(parent) {
    super(parent.base, parent.tribe);
    this.parent = parent;
    this.parentVersion = -1;
    this.sync();
  }
  allEnabled() { const s = new Set(this.parent ? this.parent.enabled.keys() : []); for (const k of this.enabled.keys()) s.add(k); return s; }
  sync() { if (this.parent && this.parentVersion !== this.parent.version) { this.parentVersion = this.parent.version; this.rebuild(); } }
  node(path) { this.sync(); return super.node(path); }
  memo(key, fn) { this.sync(); return super.memo(key, fn); }
  get tt() { return this; }
}
