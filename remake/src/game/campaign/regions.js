// Regions of a campaign map (map chunk Rgns, docs/CAMPAIGN_FORMAT.md §4 and §10.4): named unions of rectangles and
// ovals in MAP coordinates (x east, y north; a shape = minimum corner + size, an oval = the ellipse inscribed in the
// box). Triggers test "is this object in the region" (REGN, every object query) and switch regions or single shapes
// on and off (ARGN) or move them (MRGN).
//
// All tests here take GAME coordinates (x, z) like everything else at run time; the conversion is done inside.

export class Region {
  constructor(d, regions) {
    this.regions = regions;
    this.guid = d.guid; this.name = d.name;
    this.data = d;
    this.enabled = true;                         // ARGN with sub_idx -1
    this.world = false;
    this.shapes = (d.shapes || []).map((s) => ({ oval: s.type === 'oval', enabled: s.enabled !== false, x: s.x, y: s.y, w: s.w, h: s.h }));
    this.version = 0;                            // bumped by setEnabled / moveTo (conditions may cache on it)
    this.rebox();
  }
  rebox() {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const s of this.shapes) if (s.enabled) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + s.w); y1 = Math.max(y1, s.y + s.h); }
    this.bbox = [x0, y0, x1, y1];
  }
  // map coordinates
  containsMap(mx, my) {
    if (!this.enabled) return false;
    const b = this.bbox;
    if (mx < b[0] || my < b[1] || mx > b[2] || my > b[3]) return false;
    for (const s of this.shapes) {
      if (!s.enabled || mx < s.x || my < s.y || mx > s.x + s.w || my > s.y + s.h) continue;
      if (!s.oval) return true;
      const u = (mx - s.x) / s.w * 2 - 1, v = (my - s.y) / s.h * 2 - 1;
      if (u * u + v * v <= 1) return true;
    }
    return false;
  }
  // game coordinates
  contains(x, z) { const [mx, my] = this.regions.toMap(x, z); return this.containsMap(mx, my); }
  // centre of the enabled shapes' bounding box, game coordinates [x, z] (null for an empty / disabled region)
  center() {
    const b = this.bbox;
    if (b[0] > b[2]) return null;
    return this.regions.toGame((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  }
  // bounding circle in game coordinates: { x, z, r } (for spatial queries)
  bounds() {
    const b = this.bbox;
    if (b[0] > b[2]) return null;
    const [x, z] = this.regions.toGame((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    return { x, z, r: Math.hypot(b[2] - b[0], b[3] - b[1]) / 2 };
  }
  // ARGN: the whole region (shape < 0 or undefined) or one shape (0-based)
  setEnabled(on, shape = -1) {
    if (shape == null || shape < 0) this.enabled = !!on;
    else if (this.shapes[shape]) this.shapes[shape].enabled = !!on;
    this.rebox(); this.version++; this.regions.version++;
  }
  // MRGN: move the region so that its bounding box is centred on the game point (x, z)
  moveTo(x, z) {
    const b = this.bbox;
    if (b[0] > b[2]) return;
    const [mx, my] = this.regions.toMap(x, z);
    const dx = mx - (b[0] + b[2]) / 2, dy = my - (b[1] + b[3]) / 2;
    for (const s of this.shapes) { s.x += dx; s.y += dy; }
    this.rebox(); this.version++; this.regions.version++;
  }
}

// the whole map (trigger parameter "UniqueWorldRegion", an empty or an unknown GUID: ConditionFactory.usl:455-458)
class WorldRegion extends Region {
  constructor(regions) { super({ guid: 'UniqueWorldRegion', name: 'UniqueWorldRegion', shapes: [] }, regions); this.world = true; }
  containsMap() { return true; }
  contains() { return true; }
  center() { return [0, 0]; }
  bounds() { return null; }
  setEnabled() {}
  moveTo() {}
}

export class Regions {
  // list = the JSON's regions[]; toGame(mx, my) -> [x, z]; toMap(x, z) -> [mx, my]
  constructor(list, toGame, toMap) {
    this.toGame = toGame; this.toMap = toMap;
    this.version = 0;
    this.world = new WorldRegion(this);
    this.list = (list || []).map((d) => new Region(d, this));
    this.byGuid = new Map(); this.byName = new Map();
    for (const r of this.list) { this.byGuid.set(r.guid, r); if (!this.byName.has(r.name)) this.byName.set(r.name, r); }
  }
  // by GUID or name; null if there is none
  find(ref) { return ref instanceof Region ? ref : this.byGuid.get(ref) || this.byName.get(ref) || null; }
  // as the trigger parameters mean it: unknown, empty or "UniqueWorldRegion" = the whole map
  get(ref) { return this.find(ref) || this.world; }
  // the regions containing the game point (x, z)
  at(x, z) { const [mx, my] = this.toMap(x, z); return this.list.filter((r) => r.containsMap(mx, my)); }
}
