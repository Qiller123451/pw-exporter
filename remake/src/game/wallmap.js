// The wall grid: a port of the engine's WallMap ("URS.Shared.WallMap", the same code in PWServer.exe and
// PWClient.exe; reverse-engineered in _notes/walls_re.md, docs/spec/walls.md). Addresses are PWServer's.
//
//   * Tiles are 8 m squares (tile = trunc(map x / 8), centres at 4 mod 8 of the map). Every tile holds one 16-bit
//     word (0x7dcb70): owner, race, wall class, gate flag, tower class, a blocked bit, built bits, the dock entrance
//     bits - and a separate trap bit. Wall pieces never rotate; every wall-map object stands at the tile centre at a
//     height quantised to 2 m ("level": 0x7dc7f0).
//   * Directions d (engine tables 0xa89560 / 0xa89580; game x east, z south = map y):
//       d 0 NW (-1,-1)  1 N (0,-1)  2 NE (1,-1)  3 E (1,0)  4 SE (1,1)  5 S (0,1)  6 SW (-1,1)  7 W (-1,0)
//     odd d = straight, even d = diagonal, opposite = (d + 4) & 7.
//   * A line between two points is not a straight raster but the engine's shortest path over placeable tiles
//     (FindPath 0x7e0730) - all or nothing.
//   * A wall piece's look is a list of model parts chosen by name (BuildName 0x7df930): a hub (x0 diagonal family,
//     x1 straight family, x2 generic, x03..x47 the 135 degree bends) and one piece per direction ("3b": towards E,
//     arm end on the same level; a / c one level lower / higher; d a closed side; e / f arm / closed side of an x2).
//   * Pathfinding: each wall piece blocks with its model's pf boxes whose direction / hub bits are in its mask
//     (PFMask 0x7de2e0).
export const TILE = 8;
// engine directions
export const DX = [-1, 0, 1, 1, 1, 0, -1, -1];
export const DZ = [-1, -1, -1, 0, 1, 1, 1, 0];
// the remake's older direction order, kept for the wall walking and siege code (r: 0 E, 1 NE, 2 N, 3 NW, 4 W, 5 SW,
// 6 S, 7 SE): r = (3 - d) & 7. WallMap.mask() returns arm bits in this order.
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
export const dToR = (d) => (3 - d) & 7;
// object types of the wall class table (wallclassconfig_ex.txt; the client adds WC_Siege 4)
export const WT = { WALL: 0, GATE: 1, TOWER: 2, TRAP: 3, SIEGE: 4, ENTRANCE: 5 };
export const RACE = { Hu: 0, Aje: 1, Ninigi: 2, SEAS: 3 };
const NONE = -10;
// the shipped default of the setting "Server/NewGates": gates are one tile, centred on a tile (0x7e2090)
const NEW_GATES = true;
// DAT_00aed570 (16; never written): start and end of a line must not be under it - 1
const SEA_LEVEL = 16;

// the word of a tile (§1.2)
const OWNER = 0xf, RACE_SHIFT = 4, CLASS_MASK = 0x180, GATE_BIT = 0x200, TOWER_MASK = 0xc00, BLOCKED = 0x1000;
const occupied = (v) => (v & 0x8d80) !== 0;
const isWall = (v) => (v & CLASS_MASK) !== 0 && !(v & GATE_BIT);
const isGate = (v) => (v & CLASS_MASK) !== 0 && !!(v & GATE_BIT);
const towerOf = (v) => (v & TOWER_MASK) >> 10;
const ownerOf = (v) => { const o = v & OWNER; return o === 0xf ? -1 : o; };
const raceOf = (v) => (v >> RACE_SHIFT) & 7;
const classOf = (v) => (v & CLASS_MASK) >> 7;
const EMPTY = 0xf;                     // a tile without anything: owner none

// round to nearest, ties to even (the FPU's default rounding, "6.7553994e15" trick)
function roundEven(v) {
  const f = Math.floor(v), r = v - f;
  if (r > 0.5) return f + 1;
  if (r < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

// Shape of a connection set (0x7dc3d0): -1 invalid, 0 end / lone / irregular flat, 1 straight, 2 right angle,
// 3 T, 4 135 degree bend, 5 cross
function shape(rel) {
  let c = 0, f = -1, flat = true;
  for (let d = 0; d < 8; d++) {
    if (rel[d] === NONE) continue;
    if (rel[d] < -1 || rel[d] > 1) return -1;
    if (rel[d] !== 0) flat = false;
    if (f < 0) f = d;
    c++;
  }
  const on = (d) => rel[d & 7] !== NONE;
  if (c <= 1) return 0;
  if (c === 2) {
    if (on(f + 1) || on(f + 7)) return -1;
    if (on(f + 4)) return 1;
    if (on(f + 2) || on(f + 6)) return 2;
    if (on(f + 3) || on(f + 5)) return 4;
  }
  if (c === 3) {
    if ((on(f + 2) && on(f + 4)) || (on(f + 4) && on(f + 6)) || (on(f + 2) && on(f + 6))) return 3;
    if ((on(f + 2) && on(f + 5)) || (on(f + 6) && on(f + 3)) || (on(f + 3) && on(f + 5))) return 0;
  }
  if (c === 4 && on(f + 2) && on(f + 4) && on(f + 6)) return 5;
  return flat ? 0 : -1;
}
// a diagonal arm only stays when neither straight direction next to it is connected (0x7dc350)
function cornerRule(rel) {
  for (const s of [1, 3, 5, 7]) if (rel[s] !== NONE) { rel[s - 1] = NONE; rel[(s + 1) & 7] = NONE; }
}
// regular patterns of BuildName / PFMask (count c, first connected f)
function regular(rel) {
  let c = 0, f = -1;
  for (let d = 0; d < 8; d++) if (rel[d] !== NONE) { if (f < 0) f = d; c++; }
  const on = (d) => rel[d & 7] !== NONE;
  if (c === 2) return true;
  if (c === 3) return (on(f + 2) && on(f + 4)) || (on(f + 4) && on(f + 6)) || (on(f + 2) && on(f + 6));
  if (c === 4) return on(f + 2) && on(f + 4) && on(f + 6);
  return false;
}

// BuildName (0x7df930): the model part components of a wall piece for its connections, [] = not drawable
export function buildName(rel) {
  let c = 0, f = -1, flat = true;
  for (let d = 0; d < 8; d++) {
    if (rel[d] === NONE) continue;
    if (rel[d] < -1 || rel[d] > 1) return [];
    if (rel[d] !== 0) flat = false;
    if (f < 0) f = d;
    c++;
  }
  const on = (d) => rel[d & 7] !== NONE;
  const L = (d) => String.fromCharCode(98 + rel[d & 7]);          // a / b / c
  const P = () => { const out = [f % 2 === 0 ? 'x0' : 'x1']; for (const k of [0, 2, 4, 6]) { const d = (f + k) & 7; out.push(on(d) ? d + L(d) : d + 'd'); } return out; };
  const x2 = (conn, open) => { const out = ['x2']; for (let d = 0; d < 8; d++) out.push(on(d) ? d + conn(d) : d + open); return out; };
  if (c === 0) return ['x2', '0f', '1f', '2f', '3f', '4f', '5f', '6f', '7f'];
  if (c === 1) return flat ? x2(() => 'e', 'f') : P();
  if (c === 2) {
    if (on(f + 1) || on(f + 7)) return [];                         // "sharp corner"
    if (on(f + 4) || on(f + 2) || on(f + 6)) return P();
    const b = on(f + 3) ? (f + 3) & 7 : (f + 5) & 7, a = Math.min(f, b), z = Math.max(f, b);
    return ['x' + a + z, a + L(a), z + L(z)];
  }
  if (c === 3) {
    if ((on(f + 2) && on(f + 4)) || (on(f + 4) && on(f + 6)) || (on(f + 2) && on(f + 6))) return P();
    return x2((d) => L(d), 'd');
  }
  if (c === 4) {
    if (on(f + 2) && on(f + 4) && on(f + 6)) return P();
    return flat ? x2(() => 'e', 'f') : [];                         // "four neighbours present but not flat"
  }
  return [];
}

export class WallMap {
  // (x0, z0): the centre of tile (0, 0) in game coordinates (maps/source.js wallGrid); the world gives the ground
  // height, the bounds and the obstacles (World sets this.world)
  constructor(x0 = 4, z0 = 4) {
    this.x0 = x0; this.z0 = z0;
    this.tiles = new Map();          // key -> {wall, gate, tower, trap} objects of the tile
    this.words = new Map();          // key -> tile word
    this.traps = new Set();          // keys with the trap bit
    this.undo = null;                // [key, word, trap] records of a temporary change
    this.world = null;
    this.classes = null;             // class name -> [race, class, type] (wallclassconfig_ex.txt)
  }
  // ---------------------------------------------------------------- grid
  tileOf(x, z) { return [Math.floor((x - this.x0 + 4) / TILE), Math.floor((z - this.z0 + 4) / TILE)]; }
  centre(i, j) { return [this.x0 + i * TILE, this.z0 + j * TILE]; }
  snap(x, z) { const [i, j] = this.tileOf(x, z); return this.centre(i, j); }
  key(i, j) { return (i + 32768) * 65536 + (j + 32768); }
  at(i, j) { return this.tiles.get(this.key(i, j)) || null; }
  // the map (0x7e2010: (scape size + 7) >> 3 tiles): the tiles whose square lies inside the world
  onMap(i, j) {
    const W = this.world;
    if (!W) return true;
    const h = W.size / 2, [cx, cz] = this.centre(i, j);
    return cx - 4 >= -h && cx + 4 <= h && cz - 4 >= -h && cz + 4 <= h;
  }
  word(i, j) { const v = this.words.get(this.key(i, j)); return v === undefined ? EMPTY : v; }
  trap(i, j) { return this.traps.has(this.key(i, j)); }
  setWord(i, j, v) { const k = this.key(i, j); if (this.undo) this.record(k); if (v === EMPTY) this.words.delete(k); else this.words.set(k, v); }
  setTrap(i, j, on) { const k = this.key(i, j); if (this.undo) this.record(k); if (on) this.traps.add(k); else this.traps.delete(k); }
  // temporary changes (0x7e1950 / 0x7e1970 / 0x7e19d0)
  begin() { if (!this.undo) this.undo = new Map(); }
  record(k) { if (!this.undo.has(k)) this.undo.set(k, [this.words.get(k), this.traps.has(k)]); }
  restore() {
    if (!this.undo) return;
    for (const [k, [v, t]] of this.undo) { if (v === undefined) this.words.delete(k); else this.words.set(k, v); if (t) this.traps.add(k); else this.traps.delete(k); }
    this.undo = null;
  }
  // ---------------------------------------------------------------- heights (0x7dc7f0, 0x7dc860)
  // the engine's absolute heights (sea level 16 m; the original maps keep them). The remake's own maps lie lower:
  // their heights are lifted so that the sea (or, without one, the ground) sits where the engine expects it
  heightAt(x, z) {
    const W = this.world;
    if (!W) return 30;
    if (this.hOff === undefined) this.hOff = W.waterLevel != null ? SEA_LEVEL - W.waterLevel : (W.mapKind === 'original' ? 0 : 30);
    return W.height(x, z) + this.hOff;
  }
  level(i, j) { const [x, z] = this.centre(i, j); return roundEven((this.heightAt(x, z) - 1.7) / 2) + 1; }
  // the arm end in direction d: the middle of the tile edge (straight) or the tile corner (diagonal)
  edgeLevel(i, j, d) { const [x, z] = this.centre(i, j); return roundEven((this.heightAt(x + DX[d] * 4, z + DZ[d] * 4) - 1.7) / 2) + 1; }
  // where every wall-map object stands (0x7dd040 with flag 1): the tile centre at 2 x level
  zOf(i, j) { return 2 * this.level(i, j) - (this.hOff || 0); }
  // ---------------------------------------------------------------- class table (0x7de880)
  classOf(name, tribe) {
    const lc = String(name || '').toLowerCase();
    if (this.classes && this.classes[lc]) return this.classes[lc];
    return null;
  }
  raceOf(owner) { return owner && owner.tribe in RACE ? RACE[owner.tribe] : -1; }
  ownerId(owner) { return owner && owner.id != null ? owner.id & 0xf : -1; }
  // ---------------------------------------------------------------- writing a tile (0x7dcb70 / 0x7dcc40)
  write(i, j, owner, race, cls, type) {
    let v = this.word(i, j);
    const base = (v & 0xff80) | ((race & 7) << RACE_SHIFT) | (owner & OWNER);
    if (type === WT.TRAP) { v = base | BLOCKED; this.setTrap(i, j, true); }
    else if (type === WT.ENTRANCE) v = base | 0xe000;
    else if (type === WT.TOWER) v = (base & ~TOWER_MASK) | ((cls & 3) << 10);
    else v = (base & 0xfc7f) | ((cls & 3) << 7) | ((type & 1) << 9);
    this.setWord(i, j, v);
  }
  clearPart(i, j, type) {
    let v = this.word(i, j);
    if (type === WT.TOWER) v &= ~(TOWER_MASK | 0x4000);
    else if (type === WT.TRAP) { v &= ~BLOCKED; this.setTrap(i, j, false); }
    else if (type === WT.ENTRANCE) v &= ~0xe000;
    else v &= ~(CLASS_MASK | GATE_BIT | 0x2000);
    if (!(v & 0x1d80)) v = (v & ~OWNER) | 0xf;
    if ((v & ~(OWNER | (7 << RACE_SHIFT))) === 0 && (v & OWNER) === 0xf) v = EMPTY;
    this.setWord(i, j, v);
  }
  setBlocked(i, j, on) { const v = this.word(i, j); this.setWord(i, j, on ? v | BLOCKED : v & ~BLOCKED); }
  // ---------------------------------------------------------------- the rules
  // HasOwn (0x7dcd20)
  hasOwn(i, j, owner, race, type) {
    if (!this.onMap(i, j)) return false;
    const v = this.word(i, j);
    if (type === WT.TRAP) return this.trap(i, j);
    if (!occupied(v)) return false;
    const mine = (owner === -1 || ownerOf(v) === owner) && (race === -1 || raceOf(v) === race);
    if (type === WT.TOWER) return towerOf(v) !== 0 && mine;
    if (type === WT.GATE || type === WT.SIEGE) return !towerOf(v) && mine;
    return (isWall(v) || isGate(v)) && mine;
  }
  // Blocked (0x7dced0)
  blocked(i, j, owner, race, type) {
    if (!this.onMap(i, j)) return true;
    const v = this.word(i, j);
    if (type === WT.TRAP && this.trap(i, j)) return !!(v & BLOCKED) && ownerOf(v) === owner;     // an enemy trap is hidden
    if (v & BLOCKED) return true;
    if (type === WT.GATE) { if (towerOf(v) || isGate(v)) return true; if (!isWall(v) && !NEW_GATES) return true; }
    if (type === WT.SIEGE) { if (towerOf(v) || isGate(v) || !isWall(v)) return true; }
    if (!occupied(v)) return false;
    if (type === WT.TRAP) return true;
    if (type === WT.TOWER && (isGate(v) || towerOf(v))) return true;
    if (type === WT.WALL && isGate(v) && NEW_GATES) return true;
    return !((ownerOf(v) === owner || owner === -1) && (raceOf(v) === race || race === -1));
  }
  // TileValid (0x7dc920): not both cross-shaped windows of 2 m cells completely unbuildable (the remake: the
  // terrain's unwalkable and wet cells)
  tileValid(i, j) {
    const W = this.world;
    if (!W || !W.nav) return true;
    const bad = W.steepCell, wet = W.wetCell, nav = W.nav;
    if (!bad && !wet) return true;
    const [cx, cz] = this.centre(i, j);
    const set = (a, b) => { const k = nav.idx(cx - 4 + a * 2 + 1, cz - 4 + b * 2 + 1); return k < 0 || (bad && bad[k]) || (wet && wet[k]); };
    let w1 = true, w2 = true;
    for (let a = 1; a < 4 && w1; a++) for (let b = 0; b < 5 && w1; b++) if (!set(a, b)) w1 = false;
    for (let a = 0; a < 5 && w2; a++) for (let b = 1; b < 4 && w2; b++) if (!set(a, b)) w2 = false;
    return !(w1 && w2);
  }
  // standing trees within r (the forest layer count 0x8db7d0: distance^2 < 2 r^2 + 0.1)
  trees(x, z, r) {
    const W = this.world;
    if (!W || !W.rHash) return 0;
    const R2 = 2 * r * r + 0.1;
    let n = 0;
    W.rHash.query(x, z, Math.sqrt(R2) + 1, (t) => { if (t.alive && t.type === 'tree' && (t.pos.x - x) ** 2 + (t.pos.z - z) ** 2 < R2) n++; });
    return n;
  }
  // Connections (0x7dd250): rel[d] = NONE or the arm end's height step in levels; null = invalid tile
  connections(i, j, owner, race, type) {
    const rel = new Array(8).fill(NONE);
    if (!this.tileValid(i, j)) return null;
    const L = this.level(i, j);
    if (L <= 6) return null;
    for (let d = 0; d < 8; d++) if (this.hasOwn(i + DX[d], j + DZ[d], owner, race, type)) rel[d] = this.edgeLevel(i, j, d) - L;
    cornerRule(rel);
    // an end piece that faces bad ground: a flat arm runs on into it
    let c = 0, f = -1;
    for (let d = 0; d < 8; d++) if (rel[d] !== NONE) { if (f < 0) f = d; c++; }
    if (c === 1) {
      const o = (f + 4) & 7, he = this.edgeLevel(i, j, o) - L;
      const i2 = i + 2 * DX[o], j2 = j + 2 * DZ[o], h2 = this.level(i2, j2) - L;
      const [x2, z2] = this.centre(i2, j2);
      const good = Math.abs(he) < 2 && Math.abs(h2) < 3 && Math.abs(h2 - he) < 2 && this.tileValid(i2, j2) && this.trees(x2, z2, 10) < 1;
      if (!good) rel[o] = 0;
    }
    return shape(rel) === -1 ? null : rel;
  }
  // ShapeOK (0x7dd500)
  shapeOK(i, j, owner, race, type) {
    if (!this.onMap(i, j)) return false;
    if (type === WT.TOWER && 2 * this.level(i, j) < 16) return false;
    const v = this.word(i, j);
    const own = (owner === -1 || ownerOf(v) === owner) && (race === -1 || raceOf(v) === race) && (v & 0xd80);
    if (!own && !this.trap(i, j)) return true;
    return this.connections(i, j, ownerOf(v), raceOf(v), type) !== null;
  }
  // Placeable (0x7de030): the tile written for a moment, then the shape of it and of its 8 neighbours
  placeable(i, j, owner, race, cls, type) {
    if (!this.onMap(i, j) || this.blocked(i, j, owner, race, type)) return false;
    const k = this.key(i, j), v = this.words.get(k), t = this.traps.has(k);
    this.write(i, j, owner, race, cls, type);
    let ok = this.shapeOK(i, j, owner, race, type);
    for (let d = 0; ok && d < 8; d++) ok = this.shapeOK(i + DX[d], j + DZ[d], owner, race, type);
    // (put the word back without touching an undo list)
    if (v === undefined) this.words.delete(k); else this.words.set(k, v);
    if (t) this.traps.add(k); else this.traps.delete(k);
    return ok;
  }
  // the obstacle scan (0x7e2400) over tiles [i0..i1] x [j0..j1], temporary (inside begin() / restore()):
  // a tile is blocked by a standing tree within 2.83 m, more than 3 within 9.9 m, or when its centre lies inside an
  // object that is no wall-map object (buildings, stones, fruit bushes, solid scenery) - or a trap
  scanObstacles(i0, j0, i1, j1) {
    const W = this.world;
    if (!W) return;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (!this.onMap(i, j) || (this.word(i, j) & BLOCKED)) continue;
      const [x, z] = this.centre(i, j);
      let b = this.trees(x, z, 2) > 0 || this.trees(x, z, 7) > 3;
      if (!b) b = this.objectAt(x, z);
      if (b) this.setBlocked(i, j, true);
    }
  }
  // is the point inside an object that is no wall-map object (or is a trap)?
  objectAt(x, z) {
    const W = this.world;
    let hit = false;
    if (W.bHash) W.bHash.query(x, z, 40, (b) => {
      if (hit || !b.alive || (b.def.wallKind && b.def.wallKind !== 'trap')) return;
      if (W.inBoxes && b.boxes && W.inBoxes(b.boxes, b.rot, x, z, 0)) hit = true;
    });
    if (!hit && W.rHash) W.rHash.query(x, z, 12, (n) => { if (!hit && n.alive && n.type !== 'tree' && n.type !== 'timber' && Math.hypot(n.pos.x - x, n.pos.z - z) < Math.max(1, n.radius || 1)) hit = true; });
    if (!hit && W.nav) {
      const k = W.nav.idx(x, z);
      // solid scenery (rocks, ruins, the campaign's props): its cells in the nav grid
      if (k >= 0 && W.sceneryCell && W.sceneryCell(k)) hit = true;
    }
    return hit;
  }
  // ---------------------------------------------------------------- CalcWall (0x7e26c0)
  // owner: a player (or null = any); name: the class to place; start / end: game points; hold: the tiles of the
  // frozen legs of a Shift polyline (wall.tiles). -> {race, cls, type, tiles: [{i, j, existing, gateOK}]} or null
  calcWall(owner, name, sx, sz, ex, ez, held = []) {
    const c = this.classOf(name);
    if (!c) return null;
    const [race, cls, type] = c;
    const me = this.ownerId(owner);
    const [si, sj] = this.tileOf(sx, sz);
    if (!this.onMap(si, sj) || this.heightAt(sx, sz) < SEA_LEVEL - 1) return null;   // ("start under water")
    const wall = { race, cls, type, tiles: held.map((t) => ({ ...t })) };
    if (type === WT.GATE) return this.calcGate(me, race, cls, si, sj, wall, name);
    const [ei, ej] = this.tileOf(ex, ez);
    if (type !== WT.TOWER) { if (!this.onMap(ei, ej) || this.heightAt(ex, ez) < SEA_LEVEL - 1) return null; }
    const i0 = Math.min(si, ei) - 3, i1 = Math.max(si, ei) + 3, j0 = Math.min(sj, ej) - 3, j1 = Math.max(sj, ej) + 3;
    this.begin();
    this.scanObstacles(i0, j0, i1, j1);
    for (const t of wall.tiles) {
      if (!this.placeable(t.i, t.j, me, race, cls, type)) { this.restore(); return null; }
      this.write(t.i, t.j, me, race, cls, type);
    }
    if (!this.placeable(si, sj, me, race, cls, type)) { this.restore(); return null; }
    if (type === WT.TOWER) {
      this.restore();
      return { ...wall, tiles: [...wall.tiles.filter((t) => t.i !== si || t.j !== sj), { i: si, j: sj, existing: this.hasOwn(si, sj, me, race, WT.TOWER), gateOK: false }] };
    }
    let list;
    if (si === ei && sj === ej) list = [[si, sj]];
    else list = this.findPath(si, sj, ei, ej, me, race, cls, type);
    this.restore();
    if (!list) return null;
    const seen = new Set(wall.tiles.map((t) => t.i + ',' + t.j));
    for (const [i, j] of list) {
      const ex2 = this.hasOwn(i, j, me, race, type === WT.TRAP ? WT.TRAP : WT.WALL);
      const k = i + ',' + j;
      if (seen.has(k)) { const t = wall.tiles.find((x) => x.i === i && x.j === j); t.existing = ex2; continue; }
      seen.add(k);
      wall.tiles.push({ i, j, existing: ex2, gateOK: false });
    }
    // where a gate could go later (the client's hint, CalcWall (C)0x4f8950): the client writes the line as race 0,
    // class 1 and asks GateFits for race 0 - whatever the tribe (writing the tribe's own race made Blocked() refuse
    // every tile of an Aje / Ninigi / SEAS line: no cyan tiles for them)
    if (type === WT.WALL && wall.tiles.length > 2) {
      this.begin();
      for (const t of wall.tiles) this.write(t.i, t.j, me, 0, 1, WT.WALL);
      for (let k = 1; k < wall.tiles.length - 1; k++) {
        const a = wall.tiles[k - 1], t = wall.tiles[k], d = this.dirIndex(t.i - a.i, t.j - a.j);
        if (d >= 0) t.gateOK = this.gateFits(t.i, t.j, d, -1, 0);
      }
      this.restore();
    }
    return wall;
  }
  dirIndex(dx, dz) { for (let d = 0; d < 8; d++) if (DX[d] === dx && DZ[d] === dz) return d; return -1; }
  // FindPath (0x7e0730): a shortest path (straight 1, diagonal 1.414) towards the end, over placeable tiles with the
  // provisional wall written in, traced back from the end (the lowest direction index wins ties)
  findPath(si, sj, ei, ej, me, race, cls, type) {
    const spanX = Math.abs(ei - si);
    const m = si === ei && sj === ej ? 1 : Math.max(5, Math.min(10, Math.trunc(spanX / 4)));
    let wi0 = Math.min(si, ei) - m, wi1 = Math.max(si, ei) + m, wj0 = Math.min(sj, ej) - m, wj1 = Math.max(sj, ej) + m;
    while (wi0 < wi1 && !this.onMap(wi0, sj) && !this.onMap(wi0, ej)) wi0++;
    while (wi1 > wi0 && !this.onMap(wi1, sj) && !this.onMap(wi1, ej)) wi1--;
    while (wj0 < wj1 && !this.onMap(si, wj0) && !this.onMap(ei, wj0)) wj0++;
    while (wj1 > wj0 && !this.onMap(si, wj1) && !this.onMap(ei, wj1)) wj1--;
    const ww = wi1 - wi0 + 1, wh = wj1 - wj0 + 1;
    const inW = (i, j) => i >= wi0 && i <= wi1 && j >= wj0 && j <= wj1;
    const idx = (i, j) => (j - wj0) * ww + (i - wi0);
    const F = Math.fround, BIG = F(1e7), BLK = F(2e7), DIAG = F(1.414);
    const cost = new Float32Array(ww * wh);
    const P = (i, j) => this.placeable(i, j, me, race, cls, type);
    for (let j = wj0; j <= wj1; j++) for (let i = wi0; i <= wi1; i++) cost[idx(i, j)] = P(i, j) ? BIG : BLK;
    if (cost[idx(si, sj)] === BLK || cost[idx(ei, ej)] === BLK) return null;
    const sxs = Math.sign(ei - si), sys = Math.sign(ej - sj);
    const allow = DX.map((dx, d) => (sxs !== 0 && dx === sxs) || (sys !== 0 && DZ[d] === sys));
    cost[idx(si, sj)] = 1;
    const queue = [[si, sj]];
    let head = 0, budget = Math.min((ww + wh) * 50, 2500);
    const writeT = (i, j) => this.write(i, j, me, race, cls, type);
    while (head < queue.length && queue.length - head < ww * wh && budget-- > 0) {
      const [ci, cj] = queue[head++];
      // look-ahead: the provisional wall from cur back to the start
      this.begin();
      const outer = this.undo;
      this.undo = new Map();
      writeT(ci, cj);
      let pi = ci, pj = cj, steps = 0;
      while ((pi !== si || pj !== sj) && steps++ < budget) {
        let best = BIG, ni = null, nj = null;
        for (let d = 0; d < 8; d++) {
          if (!allow[(d + 4) & 7]) continue;
          const i = pi + DX[d], j = pj + DZ[d];
          if (inW(i, j) && cost[idx(i, j)] < best && P(i, j)) { best = cost[idx(i, j)]; ni = i; nj = j; }
        }
        if (ni === null) break;
        pi = ni; pj = nj; writeT(pi, pj);
      }
      for (let d = 0; d < 8; d++) {
        if (!allow[d]) continue;
        const i = ci + DX[d], j = cj + DZ[d];
        if (!inW(i, j) || cost[idx(i, j)] >= BLK) continue;
        const c = F(cost[idx(ci, cj)] + (d % 2 ? 1 : DIAG));
        if (c < cost[idx(i, j)] && P(i, j)) { cost[idx(i, j)] = c; queue.push([i, j]); }
      }
      // undo the look-ahead (only its own writes)
      const mine = this.undo;
      this.undo = outer;
      for (const [k, [v, t]] of mine) { if (v === undefined) this.words.delete(k); else this.words.set(k, v); if (t) this.traps.add(k); else this.traps.delete(k); }
    }
    if (cost[idx(ei, ej)] >= BIG) return null;
    // the trace from the end, building the path as it goes
    const path = [[ei, ej]];
    const outer = this.undo;
    this.undo = new Map();
    writeT(ei, ej);
    let pi = ei, pj = ej;
    for (let k = 1; k <= 1000 && (pi !== si || pj !== sj); k++) {
      let best = BLK, ni = null, nj = null;
      for (let d = 0; d < 8; d++) {
        const i = pi + DX[d], j = pj + DZ[d];
        if (inW(i, j) && P(i, j) && cost[idx(i, j)] < best) { best = cost[idx(i, j)]; ni = i; nj = j; }
      }
      if (ni === null) break;
      pi = ni; pj = nj; path.push([pi, pj]); writeT(pi, pj);
    }
    const mine = this.undo;
    this.undo = outer;
    for (const [k, [v, t]] of mine) { if (v === undefined) this.words.delete(k); else this.words.set(k, v); if (t) this.traps.add(k); else this.traps.delete(k); }
    if (pi !== si || pj !== sj) return null;
    return path.reverse();
  }
  // ---------------------------------------------------------------- gates (0x7dd600, 0x7e26c0 gate branch)
  // GateFits: the gate tile empty or an own wall piece; wall pieces (any owner, not gates) on both sides along d;
  // the flank tiles free; the two wing tiles at most 2 levels apart
  gateFits(i, j, d, owner, race) {
    if (this.blocked(i, j, owner, race, WT.GATE)) return false;
    const ai = i + DX[d], aj = j + DZ[d], bi = i - DX[d], bj = j - DZ[d];
    if (!isWall(this.word(ai, aj)) || !isWall(this.word(bi, bj))) return false;
    const flank = d % 2 ? [d + 2, d + 6] : [d + 1, d + 3, d + 5, d + 7];
    for (const f of flank) if (occupied(this.word(i + DX[f & 7], j + DZ[f & 7]))) return false;
    if (Math.abs(this.level(ai, aj) - this.level(bi, bj)) > 2) return false;
    return true;
  }
  calcGate(me, race, cls, i, j, wall, name) {
    let d = 0;
    for (; d < 8; d++) if (this.gateFits(i, j, d, me, race)) break;
    if (d === 8) return null;
    // a gate takes the stronger wall class of its tiles
    const c = Math.max(cls, classOf(this.word(i, j)), classOf(this.word(i + DX[d], j + DZ[d])));
    return { race, cls: c, type: WT.GATE, d, tiles: [{ i, j, existing: true, gateOK: false }, { i: i + DX[d], j: j + DZ[d], existing: true, gateOK: false }] };
  }
  // the gate's rotation for axis d: the model's local x runs along d (the engine's -(d+5) pi/4 in its left-handed
  // map space; the remake turns about +y with x east, z south)
  gateRot(d) { return -Math.atan2(DZ[d], DX[d]); }
  // the wall pieces at both ends of a gate (GetGateConnectingWalls 0x491150)
  gateWings(i, j, d) {
    const out = [];
    for (const s of [1, -1]) { const t = this.at(i + s * DX[d], j + s * DZ[d]); if (t && t.wall && t.wall.alive) out.push(t.wall); }
    return out;
  }
  // the gate on tile (i, j) (old name, kept for callers): {axis, d, rot, wings, wall}
  gateFit(i, j, owner) {
    const me = this.ownerId(owner), race = this.raceOf(owner);
    for (let d = 0; d < 8; d++) if (this.gateFits(i, j, d, me, race)) {
      const t = this.at(i, j);
      return { d, axis: d & 3, rot: this.gateRot(d), wings: this.gateWings(i, j, d), wall: t && t.wall && t.wall.alive ? t.wall : null };
    }
    return null;
  }
  // ---------------------------------------------------------------- objects on the map (AddObj 0x7de950, RemoveObj 0x7dee80)
  // an old two-tile gate (the campaign maps: on a tile edge or corner, walls_re.md §1.4) -> [tile A, tile B, d] with
  // B = A + d, or null for a gate centred on a tile
  oldGateTiles(b, d) {
    const x = b.origin ? b.origin.x : b.pos.x, z = b.origin ? b.origin.z : b.pos.z;
    const [ci, cj] = this.tileOf(x, z), [cx, cz] = this.centre(ci, cj);
    if (Math.hypot(x - cx, z - cz) < 1) return null;
    let best = null, bd = 1;
    for (const e of [d, (d + 4) & 7, (d + 2) & 7, (d + 6) & 7, (d + 1) & 7, (d + 3) & 7, (d + 5) & 7, (d + 7) & 7]) {
      const ax = x - 4 * DX[e], az = z - 4 * DZ[e], [ai, aj] = this.tileOf(ax, az), [tx, tz] = this.centre(ai, aj);
      const err = Math.hypot(ax - tx, az - tz);
      if (err < bd - 1e-6) { bd = err; best = [[ai, aj], [ai + DX[e], aj + DZ[e]], e]; }
    }
    return best;
  }
  add(b) {
    const c = this.classOf(b.name);
    let [i, j] = this.tileOf(b.origin ? b.origin.x : b.pos.x, b.origin ? b.origin.z : b.pos.z);
    const old = b.def.wallKind === 'gate' ? this.oldGateTiles(b, b.gateD != null ? b.gateD : this.gateDOf(b)) : null;
    if (old) { [i, j] = old[0]; b.gateD = old[2]; b.tile2 = old[1]; }
    b.tile = [i, j];
    const k = this.key(i, j);
    const t = this.tiles.get(k) || {};
    t[b.def.wallKind] = b;
    this.tiles.set(k, t);
    const type = c ? c[2] : { wall: WT.WALL, gate: WT.GATE, tower: WT.TOWER, trap: WT.TRAP }[b.def.wallKind];
    const cls = c ? c[1] : 1, race = c && type !== WT.TRAP ? c[0] : this.raceOf(b.owner);
    if (type === undefined) return;
    b.wallType = type;
    this.write(i, j, this.ownerId(b.owner), race, cls, type);
    if (old) {
      // the second tile of an old gate: a gate too (the pair rule gives the walls on both sides their arms into it),
      // no flank blocking
      const [i2, j2] = old[1], k2 = this.key(i2, j2), t2 = this.tiles.get(k2) || {};
      t2.gate = b; this.tiles.set(k2, t2);
      this.write(i2, j2, this.ownerId(b.owner), race, cls, type);
      if (b.built) this.setReady(b);
      this.refresh(i, j, type, b);
      this.refresh(i2, j2, type, b);
      return;
    }
    if (b.built) this.setReady(b);
    // a gate centred on a tile: its flank tiles are blocked for good
    if (type === WT.GATE) {
      const d = b.gateD != null ? b.gateD : this.gateDOf(b);
      b.gateD = d;
      for (const f of d % 2 ? [d + 2, d + 6] : [d + 1, d + 3, d + 5, d + 7]) this.setBlocked(i + DX[f & 7], j + DZ[f & 7], true);
    }
    this.refresh(i, j, type, b);
  }
  remove(b) {
    if (!b.tile) return;
    if (b.tile2) {
      const [i2, j2] = b.tile2, k2 = this.key(i2, j2), t2 = this.tiles.get(k2);
      if (t2 && t2.gate === b) { delete t2.gate; if (!t2.wall && !t2.gate && !t2.tower && !t2.trap) this.tiles.delete(k2); }
      if (b.wallType !== undefined) this.clearPart(i2, j2, b.wallType);
      b.tile2 = null;
      this.refresh(i2, j2, b.wallType, b);
      const [i, j] = b.tile, k = this.key(i, j), t = this.tiles.get(k);
      if (t && t.gate === b) { delete t.gate; if (!t.wall && !t.gate && !t.tower && !t.trap) this.tiles.delete(k); }
      if (b.wallType !== undefined) this.clearPart(i, j, b.wallType);
      b.tile = null;
      this.refresh(i, j, b.wallType, b);
      return;
    }
    const [i, j] = b.tile;
    const k = this.key(i, j), t = this.tiles.get(k);
    if (t && t[b.def.wallKind] === b) { delete t[b.def.wallKind]; if (!t.wall && !t.gate && !t.tower && !t.trap) this.tiles.delete(k); }
    const type = b.wallType;
    if (type !== undefined) {
      // the tile keeps what else stands on it (a tower on a wall piece, the wall piece under a tower)
      this.clearPart(i, j, type);
      if (type === WT.GATE && b.gateD != null) { const d = b.gateD; for (const f of d % 2 ? [d + 2, d + 6] : [d + 1, d + 3, d + 5, d + 7]) this.setBlocked(i + DX[f & 7], j + DZ[f & 7], false); }
    }
    b.tile = null;
    this.refresh(i, j, type, b);
  }
  gateDOf(b) {
    // d from the gate's rotation: its local x along d
    const a = b.rot || 0, x = Math.cos(a), z = -Math.sin(a);
    const d = this.dirIndex(Math.round(x), Math.round(z));
    return d >= 0 ? d : 3;
  }
  setReady(b) {
    for (const tl of [b.tile, b.tile2]) {
      if (!tl) continue;
      const [i, j] = tl, v = this.word(i, j);
      if (b.wallType === WT.TOWER) this.setWord(i, j, v | 0x4000);
      else if (b.wallType === WT.WALL || b.wallType === WT.GATE) this.setWord(i, j, v | 0x2000 | (b.wallType === WT.GATE ? 0x4000 : 0));
    }
  }
  // a tile changed: the wall pieces there and on its own neighbours get their parts and blocking again
  // (towers do not refresh their neighbours: 0x7dce10)
  refresh(i, j, type = WT.WALL, b = null) {
    this.update(i, j);
    if (type === WT.TOWER) return;
    const v = this.word(i, j), owner = b ? this.ownerId(b.owner) : ownerOf(v), race = b && b.wallType !== WT.TRAP ? raceOf(v) : -1;
    for (let d = 0; d < 8; d++) {
      const ni = i + DX[d], nj = j + DZ[d], nv = this.word(ni, nj);
      if ((isWall(nv) || isGate(nv)) && (owner === -1 || ownerOf(nv) === owner)) this.update(ni, nj);
    }
    if (type === WT.GATE && b && b.gateD != null) {
      const ci = i + DX[b.gateD], cj = j + DZ[b.gateD];
      for (let d = 0; d < 8; d++) { const ni = ci + DX[d], nj = cj + DZ[d], nv = this.word(ni, nj); if (isWall(nv) || isGate(nv)) this.update(ni, nj); }
    }
  }
  // the tile update: a wall piece's parts and pathfinder mask, a gate's end pieces
  update(i, j) {
    const t = this.at(i, j);
    if (!t) return;
    if (t.wall && t.wall.alive && t.wall.setParts) t.wall.setParts(this.partsOf(i, j), this.pfMask(i, j), this.mask(i, j));
    if (t.gate && t.gate.alive && t.gate.setGateEnds) t.gate.setGateEnds((t.gate.gateD ?? 3) % 2 === 0);
  }
  // the visual connections of the wall piece on (i, j) (GfxName 0x7e1730): the part list
  partsOf(i, j) {
    const rel = this.visualRel(i, j);
    return rel ? buildName(rel) : [];
  }
  visualRel(i, j) {
    const v = this.word(i, j);
    if (!(isWall(v) || isGate(v))) return null;
    const rel = this.connections(i, j, ownerOf(v), raceOf(v), WT.WALL);
    if (!rel) return null;
    if (NEW_GATES) for (let d = 0; d < 8; d++) {
      const ni = i + DX[d], nj = j + DZ[d];
      if (!isGate(this.word(ni, nj))) continue;
      let pair = false;
      for (let e = 0; e < 8 && !pair; e++) if (isGate(this.word(ni + DX[e], nj + DZ[e]))) pair = true;
      if (!pair) rel[d] = NONE;
    }
    return rel;
  }
  // PFMask (0x7de2e0): the pf box bits of a wall piece - arm d -> bit 5 + ((d + 7) & 7), bit 15 the small hub box,
  // bit 14 the big one (end pieces, lone posts, irregular junctions); an L corner also closes the diagonal between
  // its arms. An illegal tile blocks nothing.
  pfMask(i, j) {
    const v = this.word(i, j);
    if (!(isWall(v) || isGate(v))) return 0;
    const rel = this.visualRel(i, j);           // (no box into a one-tile gate: its posts close the gap, the passage stays free)
    if (!rel) return 0;
    const pf = new Array(8).fill(NONE);
    for (let d = 0; d < 8; d++) {
      if (rel[d] !== NONE) pf[d] = rel[d];
      else if (rel[(d + 7) & 7] !== NONE && rel[(d + 1) & 7] !== NONE) pf[d] = 0;
    }
    let m = 0;
    for (let d = 0; d < 8; d++) if (pf[d] !== NONE) m |= 1 << ((d + 7) & 7);
    return (m | (regular(pf) ? 0x400 : 0x600)) << 5;
  }
  // the arm bits of the wall piece on (i, j) in the old direction order (wall walking, ladders, the AI)
  mask(i, j) {
    const rel = this.visualRel(i, j);
    if (!rel) return 0;
    let m = 0;
    for (let d = 0; d < 8; d++) if (rel[d] !== NONE && this.hasOwn(i + DX[d], j + DZ[d], -1, -1, WT.WALL)) m |= 1 << dToR(d);
    return m;
  }
  // the object a neighbouring wall piece connects to (walls and gates of the owner; a tower only through the wall
  // piece under it)
  joint(i, j, owner) {
    const t = this.at(i, j);
    if (!t) return null;
    const o = t.gate || t.wall;
    return o && o.alive && o.owner === owner ? o : null;
  }
  // the old straight raster (the AI's ring plans): a Chebyshev DDA from tile a to tile b
  line(a, b) {
    const [i0, j0] = a, [i1, j1] = b;
    const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0));
    const out = [];
    for (let k = 0; k <= n; k++) out.push([i0 + Math.round((i1 - i0) * (n ? k / n : 0)), j0 + Math.round((j1 - j0) * (n ? k / n : 0))]);
    return out;
  }
}
