// The wall grid ("WallMap" of the original engine; docs/spec/walls.md).
//
//   * Tiles are 8 m squares. In original map coordinates the tile centres sit at x ≡ 4, y ≡ 4 (mod 8); the grid origin
//     given to the constructor is one such centre in game coordinates.
//   * A tile holds at most one wall-map object: a wall piece, a gate, a tower or a trap (towers may replace the wall
//     piece of their tile and then act as a joint of the line).
//   * Wall pieces never rotate. A piece is a hub with up to 8 arms, one towards each neighbour tile; it shows the arms
//     towards connected neighbours (same owner; walls, gates and towers connect, traps don't). Two diagonal neighbours
//     only connect when neither of the two tiles of the corner between them is occupied (no arm across an L corner).
//   * Lines are 8-connected: straight (8 m) and diagonal (11.3 m) steps, rasterised like Bresenham (Chebyshev DDA).
//
// Directions, game coordinates (x east, z south):  0 E, 1 NE, 2 N, 3 NW, 4 W, 5 SW, 6 S, 7 SE
// (the same order as the arm bins of the wall models in GSF space: angle = d x 45 deg counter-clockwise from east).
export const TILE = 8;
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];

// collision boxes of a wall piece for an arm mask, in the piece's local frame ([cx, cz, hx, hz], rot is always 0).
// The nav grid blocks the cells whose centres lie inside a box, so the boxes are sized from the cell size: wide
// enough to catch a row of cells, and arms reach a bit past the tile edge so two arms always meet without a gap.
export function wallBoxes(mask, cell = 2) {
  const w = Math.max(1.1, cell * 0.55), reach = 4 + cell * 0.6;
  const out = [[0, 0, Math.max(1.6, w), Math.max(1.6, w)]];
  for (let d = 0; d < 8; d++) {
    if (!((mask >> d) & 1)) continue;
    const [dx, dz] = DIRS[d];
    if (d % 2 === 0) out.push([dx * reach / 2, dz * reach / 2, dx ? reach / 2 : w, dz ? reach / 2 : w]);
    else {
      // diagonal: overlapping squares along the diagonal up to the tile corner (5.66 m) and a bit beyond
      const L = 5.66 + cell * 0.6, n = Math.ceil(L / w);
      for (let k = 1; k <= n; k++) { const t = (k * L) / n / Math.SQRT2; out.push([dx * t, dz * t, w, w]); }
    }
  }
  return out;
}

export class WallMap {
  constructor(x0 = 4, z0 = 4) {
    this.x0 = x0; this.z0 = z0;            // centre of tile (0, 0)
    this.tiles = new Map();               // "i,j" -> {wall, gate, tower, trap}
  }
  tileOf(x, z) { return [Math.round((x - this.x0) / TILE), Math.round((z - this.z0) / TILE)]; }
  centre(i, j) { return [this.x0 + i * TILE, this.z0 + j * TILE]; }
  snap(x, z) { const [i, j] = this.tileOf(x, z); return this.centre(i, j); }
  key(i, j) { return i + ',' + j; }
  at(i, j) { return this.tiles.get(this.key(i, j)) || null; }
  // the object of a tile that a neighbouring wall connects to (walls, gates, towers - not traps)
  joint(i, j, owner) {
    const t = this.at(i, j);
    if (!t) return null;
    const o = t.gate || t.tower || t.wall;
    return o && o.alive && o.owner === owner ? o : null;
  }
  add(b) {
    const [i, j] = this.tileOf(b.origin ? b.origin.x : b.pos.x, b.origin ? b.origin.z : b.pos.z);
    b.tile = [i, j];
    const k = this.key(i, j);
    const t = this.tiles.get(k) || {};
    t[b.def.wallKind] = b;
    this.tiles.set(k, t);
    this.refresh(i, j);
  }
  remove(b) {
    if (!b.tile) return;
    const [i, j] = b.tile;
    const k = this.key(i, j), t = this.tiles.get(k);
    if (t && t[b.def.wallKind] === b) { delete t[b.def.wallKind]; if (!t.wall && !t.gate && !t.tower && !t.trap) this.tiles.delete(k); }
    b.tile = null;
    this.refresh(i, j);
  }
  // arm mask of the wall piece on tile (i, j)
  mask(i, j) {
    const t = this.at(i, j);
    const w = t && t.wall;
    if (!w || (t.tower || t.gate)) return 0;
    let m = 0;
    for (let d = 0; d < 8; d++) {
      const [di, dj] = DIRS[d];
      const n = this.joint(i + di, j + dj, w.owner);
      if (!n) continue;
      if (d % 2 === 1 && (this.joint(i + di, j, w.owner) || this.joint(i, j + dj, w.owner))) continue;   // L corner
      // a gate's model reaches over its two wing tiles: no arm into the gate
      if (n.def.wallKind === 'gate') continue;
      m |= 1 << d;
    }
    return m;
  }
  // a tile and its 8 neighbours changed: update the arms (looks and collision) of the wall pieces there
  refresh(i, j) {
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const t = this.at(i + di, j + dj);
      if (t && t.wall && t.wall.alive && t.wall.setArms) t.wall.setArms(this.mask(i + di, j + dj));
    }
  }
  // tiles of a straight/diagonal-mixed line from tile a to tile b (inclusive)
  line(a, b) {
    const [i0, j0] = a, [i1, j1] = b;
    const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0));
    const out = [];
    for (let k = 0; k <= n; k++) out.push([i0 + Math.round((i1 - i0) * (n ? k / n : 0)), j0 + Math.round((j1 - j0) * (n ? k / n : 0))]);
    return out;
  }
  // gate placement on tile (i, j): an own wall piece with wall-map objects on two opposite sides along one axis.
  // -> {axis: d (0..3), rot, wings: [L, R]} or null. Axes: 0 E-W, 1 NE-SW, 2 N-S, 3 NW-SE.
  gateFit(i, j, owner) {
    const t = this.at(i, j);
    if (!t || !t.wall || t.gate || t.tower || t.wall.owner !== owner) return null;
    for (const d of [0, 2, 1, 3]) {
      const [di, dj] = DIRS[d];
      const L = this.joint(i - di, j - dj, owner), R = this.joint(i + di, j + dj, owner);
      if (L && R && L.def.wallKind === 'wall' && R.def.wallKind === 'wall') {
        // the gate model's long axis is its local x: rot 0 = E-W, pi/2 = N-S, pi/4 = NE-SW, -pi/4 = NW-SE
        const rot = [0, Math.PI / 4, Math.PI / 2, -Math.PI / 4][d];
        return { axis: d, rot, wings: [L, R], wall: t.wall };
      }
    }
    return null;
  }
}
