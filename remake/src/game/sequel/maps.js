// The sequel's maps (docs/SEQUEL.md): a MapSource (game/maps/source.js) made from a recipe - terrain shapes,
// ground textures of one of ParaWorld's settings, highways and streets, 1960s towns, farms and camps
// (art/sequel), the setting's trees and rocks, resources for the player's base.
//
// Recipe (game coordinates: x east, z south, metres; the playable square is size x size around (0, 0)):
//   seed, setting ('Savanna' | 'Northland' | 'Icewaste' | 'Jungle'), size, base (m), water (level or null)
//   noise:    [[scale, amplitude], ...]               rolling ground
//   features: [{type: 'hill' | 'mesa' | 'basin' | 'flat' | 'ridge' | 'river' | 'strip', ...}]
//             (strip: the ground along a path at height h, w wide - a causeway under a bridge)
//   ground:   [textureIndex, ...] of the setting's scape_0..7: [base, patches, rock, dirt (roads, towns), sand / shore, ...]
//   roads:    [{path: [[x, z], ...], width, kind: 'highway' | 'street' | 'dirt' | 'city' | 'pave'}]
//   places:   [{kind: 'town' | 'strip' | 'farm' | 'camp' | 'industry' | 'launch' | 'dam' | 'model' | 'block' | 'quay' |
//             'avenue' | 'lamps', x, z, rot, ...}]
//             (launch: pad false when the mission places the launch pad itself; model: y, scale; London (art/sequel/
//             london.py): block - x0, z0, x1, z1, sides ('nesw': the edges with houses); quay / avenue /
//             lamps - path, off (metres to the left of the path's direction, negative: right), step, steps (x of
//             the river stairs), gaps (x where a bridge meets the bank))
//   forests:  [{x, z, r, n, kind}]     rocks: [{x, z, r, n}]    resources: [{x, z, wood, stone, food}]
//   herds:    [{species, x, z, n}]
//   clear:    [[x, z, r], ...]     where nothing grows or stands (rifts, the mission's buildings, the player's base)
import * as THREE from 'three';
import { fbm, mulberry32, smoothstep } from '../../engine/terrain.js';
import { Assets } from '../../engine/assets.js';
import { treeOf } from '../maps/source.js';

const SETTINGS = {
  Savanna: { trees: /^savanna_(tree_0\d|umbrella_acacia_0\d|baobab_0\d|koekerboom_01)$/, shrubs: /^savanna_(shrub_0\d|groundbush_0\d|agave_0\d|grass_0\d)$|^sav_(smallrocks_0\d|flowers_0\d)$/,
    rocks: /^sav_(smallrocks_0\d|rock_sand_0\d|rock_terrace_stone_0\d)$/, stone: 'resource_stone_sav', bush: 'savanna_fruit_bush' },
  Northland: { trees: /^northland_(tree_0\d|birch_0\d|larch_0\d|oak_0\d|maple_0\d|poplar_0\d|beech_01)$/, shrubs: /^northland_(shrub_0\d|fern_0\d|juniper_0\d|flowers_0\d|blueberry_0\d)$/,
    rocks: /^northland_(stone_0\d|boulders_01|small_rock_0\d)$/, stone: 'resource_stone_nor', bush: 'northland_fruit_bush' },
  Icewaste: { trees: /^icewaste_(tree_0\d|birch_0\d|oak_0\d)$/, shrubs: /^icewaste_(bush_0\d|shrub_0\d_a|fern_0\d|juniper_0\d)$/,
    rocks: /^ice_(smallrock_0\d|middlerock_0\d|snow_middlerock_0\d)$/, stone: 'resource_stone_ice', bush: 'icewaste_fruit_bush' },
  // (the scenarios' fire mountain: game/scenarios/missions.js)
  Ashvalley: { trees: /^ash_(dragontree_0\d|joshua_tree_0\d)$/, shrubs: /^ash_(shrub_0\d|underwood_0\d|ashgrass_0\d)$/,
    rocks: /^ash_(stone_0\d|smallstones_0\d|basalt0[1-4])$/, stone: 'resource_stone_ash', bush: 'ashvalley_fruit_bush' },
  Jungle: { trees: /^jungle_(tree_0\d|tree_med_0\d)$/, shrubs: /^jungle_(bush_0\d|underwood_0\d|flowers_0\d)$/,
    rocks: /^jungle_smallrock_0\d$|^jung_middle_rock_0\d$/, stone: 'resource_stone_jun', bush: 'jungle_fruit_bush' },
};
const HOUSES = ['white', 'mint', 'pink', 'sky', 'butter', 'sage', 'cream'];
const CARS = ['cherry', 'aqua', 'butter', 'navy', 'sage', 'pink'];

// distance from p to a polyline, and the position along it
function polyDist(path, x, z) {
  let best = 1e9;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
    if (d < best) best = d;
  }
  return best;
}
// points every `step` metres along a polyline: [x, z, heading of the direction]
function along(path, step, offset = 0) {
  const out = [];
  let carry = offset;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    let s = carry;
    for (; s < L; s += step) out.push([ax + (bx - ax) * s / L, az + (bz - az) * s / L, Math.atan2(bx - ax, bz - az)]);
    carry = s - L;
  }
  return out;
}
const bell = (d, r) => (d >= r ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / r));
// heading that turns a model's front (-z) towards (dx, dz)
const face = (dx, dz) => Math.atan2(-dx, -dz);

// a London block (art/sequel/houses.py): rows of houses round the edges named by `sides` ('n' the edge at z0, 's' at
// z1, 'w' at x0, 'e' at x1), their fronts to the street, and a corner building where two of them meet. The models
// are 1.2 times life size: the rows are 16.8, 25.2 or 33.6 m along the street (two, three or four houses), 14.4 m
// deep and stand 8.4 m back from their front line (the area railings); a corner building is 16.8 m square. An edge
// is filled with rows of mixed lengths (each a different model from its neighbour) so that little is left over.
const ROWS = { 16.8: ['sq_row14_1', 'sq_row14_2', 'sq_row14_3', 'sq_row14_4'],
  25.2: ['sq_row21_1', 'sq_row21_2', 'sq_row21_3', 'sq_row21_4', 'sq_row21_5', 'sq_row21_6'],
  33.6: ['sq_row28_1', 'sq_row28_2', 'sq_row28_3', 'sq_row28_4'] };
const ROW_W = Object.keys(ROWS).map(Number), CORNER_W = 16.8, FRONT = 8.4;
const CORNERS = ['sq_corner_dome', 'sq_corner_turret', 'sq_corner_curve', 'sq_corner_chamfer'];
// the rows' lengths along an edge `len` long: of a few random fillings the one that leaves least over
function fillRows(len, pick) {
  let best = [], left = len;
  for (let t = 0; t < 16; t++) {
    const ws = [];
    let rest = len;
    for (;;) {
      const fit = ROW_W.filter((w) => w <= rest + 1e-6);
      if (!fit.length) break;
      const w = pick(fit);
      ws.push(w);
      rest -= w;
    }
    if (rest < left - 1e-6) { best = ws; left = rest; }
  }
  return { ws: best, left };
}
function londonBlock(p, put, pick) {
  const sides = p.sides || 'nesw';
  const E = { n: [[p.x0, p.z0], [p.x1, p.z0], [0, -1]], s: [[p.x1, p.z1], [p.x0, p.z1], [0, 1]], w: [[p.x0, p.z1], [p.x0, p.z0], [-1, 0]], e: [[p.x1, p.z0], [p.x1, p.z1], [1, 0]] };
  const order = 'nesw';
  // corners: where an edge meets the next one round the block
  const corner = (a, b) => sides.includes(a) && sides.includes(b);
  let last = null;
  const other = (list) => { const l = list.filter((n) => n !== last); return (last = pick(l.length ? l : list)); };
  for (let i = 0; i < 4; i++) {
    const k = order[i], nk = order[(i + 1) % 4];
    if (!sides.includes(k)) continue;
    const [[ax, az], [bx, bz], [nx, nz]] = E[k];
    const L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
    const c0 = corner(order[(i + 3) % 4], k), c1 = corner(k, nk);
    const s0 = c0 ? CORNER_W : 0, s1 = c1 ? CORNER_W : 0;
    const { ws, left } = fillRows(L - s0 - s1, pick);
    let t = s0 + left / 2;
    for (const w of ws) {
      put(other(ROWS[w]), ax + dx * (t + w / 2) - nx * FRONT, az + dz * (t + w / 2) - nz * FRONT, face(nx, nz), { r: 0, force: true });
      t += w;
    }
    if (c1) {
      // the corner building's corner looks out between this edge's normal and the next's
      const [, , [mx, mz]] = E[nk];
      const cx = bx - nx * CORNER_W / 2 - mx * CORNER_W / 2, cz = bz - nz * CORNER_W / 2 - mz * CORNER_W / 2;
      // the model's corner is at its local (+x, -z); a turn by rot shows local direction angle q at q - rot
      put(other(CORNERS), cx, cz, -Math.PI / 4 - Math.atan2(nz + mz, nx + mx), { r: 0, force: true });
    }
  }
}

// R: the mission's map recipe; D: the rules (the wood of the trees: maps/source.js treeOf)
export function sequelSource(R, D) {
  const rnd = mulberry32(R.seed || 7);
  const half = R.size / 2, world = R.size + 160;
  const S = SETTINGS[R.setting] || SETTINGS.Savanna;
  const roads = (R.roads || []).map((r) => ({ width: 8, kind: 'highway', ...r }));
  // (a London block's centre and reach: the ground under it is levelled and paved like a town's)
  const places = (R.places || []).map((p) => (p.kind === 'block' ? { ...p, x: (p.x0 + p.x1) / 2, z: (p.z0 + p.z1) / 2, r: Math.max(p.x1 - p.x0, p.z1 - p.z0) / 2 } : p));
  // ---------------------------------------------------------------- shape
  const coarse = (x, z) => {
    let h = R.base || 5;
    for (const [s, a] of R.noise || []) if (s < 0.01) h += (fbm(x * s, z * s, (R.seed || 7) + s * 1000, 4) - 0.5) * 2 * a;
    for (const f of R.features || []) {
      const d = f.path ? polyDist(f.path, x, z) : Math.hypot(x - f.x, z - f.z);
      if (f.type === 'hill') h += f.h * bell(d, f.r);
      else if (f.type === 'basin') h -= f.depth * bell(d, f.r);
      else if (f.type === 'mesa') { const rr = f.r * (1 + 0.12 * (fbm(x * 0.03, z * 0.03, 91, 3) - 0.5)); h += f.h * smoothstep(rr + (f.edge || 12), rr, d); }
      else if (f.type === 'ridge') h += f.h * bell(d, f.w);
      else if (f.type === 'river') h = h + (((R.water ?? 0) - (f.depth || 3)) - h) * smoothstep(f.w / 2 + (f.bank || 14), f.w / 2, d);
      else if (f.type === 'flat') h = h + ((f.h ?? h) - h) * smoothstep(f.r + (f.edge || 20), f.r, d);
      else if (f.type === 'strip') h = h + (f.h - h) * smoothstep(f.w / 2 + (f.edge || 1), f.w / 2, d);
    }
    return h;
  };
  const roadNear = (x, z) => { let k = 0; for (const r of roads) { const d = polyDist(r.path, x, z); k = Math.max(k, smoothstep(r.width / 2 + 10, r.width / 2 + 1, d)); } return k; };
  const placeNear = (x, z) => { let k = 0; for (const p of places) { if (p.x == null) continue; const d = Math.hypot(x - p.x, z - p.z); k = Math.max(k, smoothstep((p.r || 60) + 20, p.r || 60, d)); } return k; };
  const fine = (x, z) => { let h = 0; for (const [s, a] of R.noise || []) if (s >= 0.01) h += (fbm(x * s, z * s, (R.seed || 7) + s * 1000, 3) - 0.5) * 2 * a; return h; };
  const height = (x, z) => {
    let h = coarse(x, z) + fine(x, z) * (1 - Math.max(roadNear(x, z), placeNear(x, z)));
    const e = Math.max(Math.abs(x), Math.abs(z));
    h += smoothstep(half - 6, world / 2, e) * 26;            // the world's rim
    return h;
  };
  // ---------------------------------------------------------------- ground
  const G = R.ground || [0, 1, 4, 3, 6];
  const textures = G.map((i) => `${R.setting}/scape_${i}.jpg`);
  const N = textures.length > 4 ? 8 : 4;
  // the free slots: the setting's gravel, earth and grass that buildings put down paint (main.js W.adaptTerrain)
  for (const k of [5, 3, 2]) if (textures.length < N && !G.includes(k)) textures.push(`${R.setting}/scape_${k}.jpg`);
  while (textures.length < N) textures.push(textures[0]);
  const splat = (hf) => (x, z) => {
    const w = new Array(N).fill(0);
    w[0] = 1;
    const mix = (k, f) => { if (f <= 0 || k >= N) return; for (let i = 0; i < N; i++) w[i] *= 1 - f; w[k] += f; };
    mix(1, smoothstep(0.45, 0.62, fbm(x * 0.012, z * 0.012, 33, 4)));                                  // patches
    if (G.length > 5) mix(5, smoothstep(0.55, 0.7, fbm(x * 0.02 + 9, z * 0.02, 57, 3)));
    if (R.water != null) mix(4, smoothstep(R.water + 2.5, R.water + 0.6, hf.at(x, z)));                  // shore
    mix(3, Math.max(roadNear(x, z) * 0.9, placeNear(x, z) * 0.55));                                      // roads, towns
    mix(2, smoothstep(0.86, 0.72, hf.normalY(x, z)));                                                      // slopes
    return w;
  };
  // ---------------------------------------------------------------- objects
  const models = new Set();
  const M = Assets.manifest ? Assets.manifest.models : {};
  const listOf = (re) => Object.keys(M).filter((k) => re.test(k));
  const has = (m) => !!(m && M[m]);
  const treeModels = listOf(S.trees), shrubModels = listOf(S.shrubs), rockModels = listOf(S.rocks);
  const decor = [], trees = [], stones = [], bushes = [], animals = [];
  const taken = [];                                         // [x, z, r] of what stands (no overlaps)
  const free = (x, z, r) => Math.abs(x) < half - 8 && Math.abs(z) < half - 8 && taken.every(([a, b, rr]) => Math.hypot(x - a, z - b) > r + rr) &&
    (R.clear || []).every(([a, b, rr]) => Math.hypot(x - a, z - b) > r + rr) &&
    roads.every((rd) => polyDist(rd.path, x, z) > rd.width / 2 + r + 1);
  const put = (model, x, z, rot, opts = {}) => {
    const r = opts.r ?? 3;
    if (!opts.force && !free(x, z, r)) return false;
    if (!M[model]) return false;
    models.add(model);
    decor.push({ model, x, z, rot, scale: opts.scale || 1, block: opts.block !== false, ...(opts.y != null ? { y: opts.y } : {}) });
    taken.push([x, z, r]);
    return true;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  // on a road's surface (a promenade - 'pave' - takes lamps and trees: it is a pavement)
  const onStreet = (x, z, m = 0.6) => roads.some((rd) => rd.kind !== 'pave' && polyDist(rd.path, x, z) < rd.width / 2 + m);
  // a point at (lx, lz) of a place's local frame (its rot turns it)
  const local = (p, lx, lz) => { const c = Math.cos(p.rot || 0), s = Math.sin(p.rot || 0); return [p.x + lx * c + lz * s, p.z - lx * s + lz * c]; };
  // streets of the places first (they shape the ground and keep the lots free)
  for (const p of places) {
    if (p.kind === 'town') {
      const n = p.blocks || 2, L = (p.len || 140) / 2;
      for (let i = -n; i <= n; i++) roads.push({ path: [local(p, -L, i * 46), local(p, L, i * 46)], width: 7, kind: 'street' });
      roads.push({ path: [local(p, 0, -n * 46 - 10), local(p, 0, n * 46 + 10)], width: 7, kind: 'street' });
    }
  }
  for (const p of places) {
    const rot = p.rot || 0;
    const lot = (lx, lz, model, r, faceDx, faceDz, opts) => { const [x, z] = local(p, lx, lz); const c = Math.cos(rot), s = Math.sin(rot); return put(model, x, z, face(faceDx * c + faceDz * s, -faceDx * s + faceDz * c), { r, ...opts }); };
    if (p.kind === 'town') {
      const n = p.blocks || 2, L = (p.len || 140) / 2;
      for (let i = -n; i <= n; i++) {
        for (const side of [-1, 1]) {
          for (let lx = -L + 16; lx < L - 10; lx += 25) {     // (the houses are built 1.3x life size: art/sequel)
            if (Math.abs(lx) < 12) continue;
            if (rnd() < (p.empty || 0.15)) continue;
            const w = pick(HOUSES), two = rnd() < 0.35;
            lot(lx, i * 46 + side * 17, `sq_house_${two ? 'two' : 'ranch'}_${w}`, 9.5, 0, -side);
            if (rnd() < 0.6) lot(lx + 9, i * 46 + side * 8, `sq_car_${pick(['sedan', 'wagon', 'pickup'])}_${pick(CARS)}`, 2.6, 0, -side, { block: false });
            if (rnd() < 0.5) lot(lx - 5, i * 46 + side * 5.5, 'sq_mailbox', 0.5, 0, -side, { block: false });
          }
          for (let lx = -L + 6; lx < L; lx += 30) lot(lx, i * 46 + side * 5, 'sq_telephone_pole', 0.6, 0, 1);
        }
      }
      if (p.landmarks !== false) {
        lot(-L - 18, 0, 'sq_water_tower', 6, 1, 0);
        lot(10, -n * 46 - 26, 'sq_diner', 9, 0, 1);
        lot(-24, -n * 46 - 26, 'sq_gas_station', 13, 0, 1);
      }
    } else if (p.kind === 'strip') {
      lot(-30, 18, 'sq_gas_station', 13, 0, -1); lot(0, 16, 'sq_diner', 9, 0, -1); lot(26, 18, 'sq_billboard', 4, 0, -1, { block: false });
      for (let k = 0; k < (p.cars || 5); k++) lot(-12 + k * 6, 8 + (k % 2) * 3, `sq_car_${pick(['sedan', 'wagon', 'pickup'])}_${pick(CARS)}`, 2.4, rnd() - 0.5, -1, { block: false });
    } else if (p.kind === 'farm') {
      lot(0, 0, 'sq_barn', 11, 0, -1); lot(16, 6, 'sq_silo', 4, 0, -1); lot(-18, 4, 'sq_house_two_' + pick(HOUSES), 8, 0, -1);
      lot(-10, -14, `sq_car_pickup_${pick(CARS)}`, 2.6, 1, 0, { block: false });
      for (let k = -4; k <= 4; k++) lot(k * 4.2, -24, 'sq_picket_fence', 0.4, 0, -1, { block: false, force: true });
    } else if (p.kind === 'camp') {
      for (let k = 0; k < (p.tents || 4); k++) lot(-20 + k * 9, 20, 'sq_tent', 4, 0, -1);
      lot(22, 0, 'sq_quonset', 13, 1, 0); lot(-26, -10, 'sq_watchtower', 4, 0, -1);
      lot(0, -22, 'sq_checkpoint', 3, 0, -1); for (let k = 0; k < 3; k++) lot(-8 + k * 4, -16, 'sq_sandbags', 3, 0, -1, { block: true });
      lot(8, 10, 'sq_army_truck', 5, 1, 0, { block: false }); lot(14, 22, 'sq_drums', 1.5, 0, 1); lot(-8, 4, 'sq_crates', 2, 0, 1);
    } else if (p.kind === 'industry') {
      lot(0, 0, 'sq_power_station', 20, 0, -1);
      for (let k = -2; k <= 2; k++) lot(k * 14, 40, 'sq_pylon', 4, 0, 1);
    } else if (p.kind === 'launch') {
      if (p.pad !== false) lot(0, 0, 'sq_rocket', 14, 0, 1);      // (a mission that places the launch pad itself: pad false)
      lot(-40, 10, 'sq_quonset', 13, 1, 0); lot(30, -20, 'sq_radar', 4, 0, -1);
    } else if (p.kind === 'dam') {
      for (let k = -2; k <= 2; k++) lot(k * 40, 0, 'sq_dam', 22, 0, 1, { force: true });
    } else if (p.kind === 'model') {
      put(p.model, p.x, p.z, rot, { r: p.r ?? 5, force: true, block: p.block !== false, y: p.y, scale: p.scale });
    } else if (p.kind === 'block') londonBlock(p, put, pick);
    else if (p.kind === 'quay') {
      // the embankment wall along the river's edge, its front (the water side) to the river; river stairs where asked
      for (const [x, z, a] of along(p.path, p.step || 15.6, (p.step || 15.6) / 2)) {
        const nx = Math.cos(a), nz = -Math.sin(a), s = Math.sign(p.off);
        const qx = x + nx * p.off, qz = z + nz * p.off;
        if ((p.gaps || []).some((gx) => Math.abs(gx - qx) < 12)) continue;        // (a bridge's end)
        const stairs = (p.steps || []).some((sx) => Math.abs(sx - qx) < 8);
        put(stairs ? 'sq_quay_steps' : 'sq_quay', qx, qz, face(-nx * s, -nz * s), { r: 0, force: true, block: false, y: p.y });
      }
    } else if (p.kind === 'lamps') {
      for (const [x, z, a] of along(p.path, p.step || 24, p.start || 6)) {
        const lx = x + Math.cos(a) * p.off, lz = z - Math.sin(a) * p.off;
        if (onStreet(lx, lz)) continue;                    // (where a side street meets the one it lines)
        put(p.model || 'sq_lamp_london', lx, lz, a, { r: 0.4, force: true, block: false });
      }
    }
  }
  // poles along highways
  for (const r of roads) if (r.kind === 'highway' && r.poles !== false) for (const [x, z, a] of along(r.path, 36, 10)) put('sq_telephone_pole', x + Math.cos(a) * (r.width / 2 + 5), z - Math.sin(a) * (r.width / 2 + 5), a, { r: 0.6 });
  // forests (choppable trees), rocks and shrubs
  const tree = (x, z) => {
    if (!treeModels.length || !free(x, z, 2)) return false;
    const model = pick(treeModels);
    models.add(model);
    const t = treeOf(model, D, has);
    for (const m of [t.stump, t.timber]) if (m) models.add(m);
    trees.push({ ...t, model, x, z, rot: rnd() * 6.28, scale: 0.8 + rnd() * 0.5, inside: true });
    taken.push([x, z, 2]);
    return true;
  };
  for (const f of R.forests || []) for (let k = 0, made = 0; k < f.n * 4 && made < f.n; k++) {
    const a = rnd() * 6.283, d = Math.sqrt(rnd()) * f.r;
    if (tree(f.x + Math.cos(a) * d, f.z + Math.sin(a) * d)) made++;
  }
  for (const p of places) if (p.kind === 'avenue') for (const [x, z, a] of along(p.path, p.step || 14, p.start || 7)) tree(x + Math.cos(a) * p.off, z - Math.sin(a) * p.off);
  for (const f of R.rocks || []) for (let k = 0; k < f.n; k++) {
    const a = rnd() * 6.283, d = Math.sqrt(rnd()) * f.r;
    if (rockModels.length) put(pick(rockModels), f.x + Math.cos(a) * d, f.z + Math.sin(a) * d, rnd() * 6.28, { r: 3, scale: 0.8 + rnd() * 0.8 });
  }
  for (let k = 0; k < (R.shrubs ?? 260); k++) {
    const x = (rnd() * 2 - 1) * (half - 10), z = (rnd() * 2 - 1) * (half - 10);
    if (shrubModels.length && (R.water == null || coarse(x, z) > R.water + 0.5)) put(pick(shrubModels), x, z, rnd() * 6.28, { r: 1.2, block: false });
  }
  // a base's resources: every deposit and bush is placed (the ring widens while the base, the roads and the trees
  // leave no room), so a mission never starts without stone or food at hand
  const ring = (r, n, size, d0, d1, add) => {
    for (let k = 0, made = 0; k < n * 40 && made < n; k++) {
      const a = rnd() * 6.283, d = d0 + rnd() * (d1 + k * 0.5), x = r.x + 40 * (add.dx || 0) + Math.cos(a) * d, z = r.z + Math.sin(a) * d;
      if (free(x, z, size)) { add.push(x, z); taken.push([x, z, size]); made++; }
    }
  };
  for (const r of R.resources || []) {
    ring(r, r.stone || 0, 4, 6, 14, { push: (x, z) => { stones.push({ model: S.stone, x, z, rot: rnd() * 6.28, amount: 2000 }); models.add(S.stone); } });
    ring(r, r.food || 0, 2, 6, 16, { dx: r.dx, push: (x, z) => { bushes.push({ model: S.bush, x, z, rot: rnd() * 6.28, amount: 150 }); models.add(S.bush); } });
    // the trees too: all of them (the ring widens while the base, roads and water leave no room - the user found
    // some bases short of wood: mission 3 got 6 of its 14)
    for (let k = 0, made = 0; k < (r.wood || 0) * 40 && made < (r.wood || 0); k++) { const a = rnd() * 6.283, d = 18 + rnd() * (26 + k * 0.4); if (tree(r.x + Math.cos(a) * d, r.z + Math.sin(a) * d)) made++; }
  }
  for (const h of R.herds || []) for (let k = 0; k < h.n; k++) animals.push({ species: h.species, x: h.x + (rnd() - 0.5) * 20, z: h.z + (rnd() - 0.5) * 20, home: [h.x, h.z] });
  for (const a of animals) models.add(a.species.toLowerCase());
  ['product_wood_jun', 'product_stone_jun', 'jungle_tree_01_stump', 'jungle_tree_01_timber', 'jungle_tree_02_timber'].forEach((m) => models.add(m));
  return {
    kind: 'sequel', name: R.name || 'Sequel', setting: R.setting, size: world, meshCell: 2,
    play: { x0: -half, x1: half, z0: -half, z1: half }, water: R.water ?? null,
    height, textures, scales: textures.map(() => [1 / 22, 1 / 22]), splat,
    trees, decor, stones, bushes, fish: [], plants: [], animals, nests: [], starts: R.starts || [[0, 0]], bases: R.starts || [[0, 0]], models,
    skirt: true, roads, sequel: true,
  };
}

// is (x, z) on a road of the source? (no grass there: main.js)
export function onRoad(S, x, z) { return (S.roads || []).some((r) => polyDist(r.path, x, z) < r.width / 2 + 0.5); }

// the roads as meshes on the ground: asphalt with a dashed centre line (highways), plain asphalt (streets), dirt
// the road surfaces: a strip over the ground per road, its texture painted with the shoulders (art/sequel/roads.py:
// u across, v along, ROAD_LENGTH metres a repeat; the shoulders fade into the ground through the alpha)
const ROAD_TEX = { highway: [9.0, 1.6], street: [7.0, 1.0], dirt: [6.0, 1.4], city: [15.0, 0.3], pave: [24.0, 0.4] };      // texture's road width, shoulder
const ROAD_LENGTH = 48;
// (texBase: where the surfaces are served - the exporter's map viewer has them elsewhere: tools/sequel_maps.js)
export function roadMeshes(S, hf, applyFow, texBase = 'assets/tex/') {
  const group = new THREE.Group();
  const mats = {};
  const mat = (kind) => {
    if (!mats[kind]) {
      const t = new THREE.TextureLoader().load(`${texBase}sq_road_${kind}.png`);
      t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
      const m = new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false });
      m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
      if (applyFow) applyFow(m);
      mats[kind] = m;
    }
    return mats[kind];
  };
  const strip = (path, w, kind) => {
    const pts = [];
    for (const [x, z, a] of along(path, 2)) pts.push([x, z, a]);
    const last = path[path.length - 1], prev = path[path.length - 2];
    pts.push([last[0], last[1], Math.atan2(last[0] - prev[0], last[1] - prev[1])]);
    const pos = [], uv = [], idx = [];
    let k = 0, dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x, z, a] = pts[i], nx = Math.cos(a), nz = -Math.sin(a);
      if (i > 0) dist += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
      for (const s of [-1, 1]) {
        const px = x + nx * s * w / 2, pz = z + nz * s * w / 2;
        pos.push(px, hf.at(px, pz) + 0.08, pz);
        uv.push(s < 0 ? 0 : 1, dist / ROAD_LENGTH);
      }
      if (i > 0) idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
      k += 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat(kind));
    m.receiveShadow = true;
    m.renderOrder = kind === 'dirt' || kind === 'pave' ? 1 : kind === 'street' || kind === 'city' ? 2 : 3;      // where roads cross, the highway on top
    group.add(m);
  };
  for (const r of S.roads || []) {
    const kind = ROAD_TEX[r.kind] ? r.kind : 'highway';
    const [tw, sh] = ROAD_TEX[kind];
    strip(r.path, r.width * (tw + 2 * sh) / tw, kind);     // the texture's shoulders scale with the road
  }
  // where London streets meet, the carriageways run on through each other's pavements: asphalt patches over them
  // (a parallelogram P + s dA + t dB; u of the texture inside its carriageway)
  const patch = (P, dA, dB, s0, s1, t0, t1) => {
    if (s1 - s0 < 0.05 || t1 - t0 < 0.05) return;
    const ns = Math.max(1, Math.ceil((s1 - s0) / 2)), nt = Math.max(1, Math.ceil((t1 - t0) / 2));
    const pos = [], uv = [], idx = [];
    const [tw, sh] = ROAD_TEX.city, total = tw + 2 * sh;
    for (let j = 0; j <= nt; j++) for (let i = 0; i <= ns; i++) {
      const s = s0 + (s1 - s0) * i / ns, t = t0 + (t1 - t0) * j / nt;
      const x = P[0] + dA[0] * s + dB[0] * t, z = P[1] + dA[1] * s + dB[1] * t;
      pos.push(x, hf.at(x, z) + 0.09, z);
      uv.push(0.5 + Math.max(-0.25, Math.min(0.25, (s - (s0 + s1) / 2) / total)), t / ROAD_LENGTH);
    }
    for (let j = 0; j < nt; j++) for (let i = 0; i < ns; i++) {
      const a = j * (ns + 1) + i, b = a + ns + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat('city'));
    m.receiveShadow = true;
    m.renderOrder = 3;
    group.add(m);
  };
  for (const J of junctions((S.roads || []).filter((r) => r.kind === 'city'))) {
    const cA = J.a.width * CARRIAGE / 2 / J.sin, cB = J.b.width * CARRIAGE / 2 / J.sin;      // half carriageways, along
    const hA = J.a.width / 2 / J.sin, hB = J.b.width / 2 / J.sin;                           // the other's direction
    // A's carriageway across B's pavements (where A runs), B's across A's
    patch(J.P, J.dA, J.dB, -Math.min(J.backA, hB), Math.min(J.fwdA, hB), Math.max(-cA, -J.backB), Math.min(cA, J.fwdB));
    patch(J.P, J.dA, J.dB, Math.max(-cB, -J.backA), Math.min(cB, J.fwdA), -Math.min(J.backB, hA), Math.min(J.fwdB, hA));
  }
  return group;
}

const CARRIAGE = 9 / 15;        // the share of a London street that is roadway (art/sequel/roads.py CITY_ROAD)
// where two roads' centre lines cross or one ends on the other: the point, the directions there, how far each road
// runs on from it either way
export function junctions(roads) {
  const out = [];
  const segs = roads.map((r) => {
    const L = [0];
    for (let i = 1; i < r.path.length; i++) L.push(L[i - 1] + Math.hypot(r.path[i][0] - r.path[i - 1][0], r.path[i][1] - r.path[i - 1][1]));
    return L;
  });
  for (let i = 0; i < roads.length; i++) for (let j = i + 1; j < roads.length; j++) {
    const A = roads[i].path, B = roads[j].path;
    for (let a = 0; a + 1 < A.length; a++) for (let b = 0; b + 1 < B.length; b++) {
      const [ax, az] = A[a], [bx, bz] = B[b];
      const ux = A[a + 1][0] - ax, uz = A[a + 1][1] - az, vx = B[b + 1][0] - bx, vz = B[b + 1][1] - bz;
      const la = Math.hypot(ux, uz), lb = Math.hypot(vx, vz), den = ux * vz - uz * vx;
      if (!la || !lb || Math.abs(den) < 1e-6 * la * lb) continue;              // parallel
      const s = ((bx - ax) * vz - (bz - az) * vx) / den, t = ((bx - ax) * uz - (bz - az) * ux) / den;
      if (s * la < -0.5 || s * la > la + 0.5 || t * lb < -0.5 || t * lb > lb + 0.5) continue;
      const P = [ax + ux * s, az + uz * s];
      const at = segs[i][a] + Math.max(0, Math.min(la, s * la)), bt = segs[j][b] + Math.max(0, Math.min(lb, t * lb));
      out.push({ a: roads[i], b: roads[j], P, dA: [ux / la, uz / la], dB: [vx / lb, vz / lb], sin: Math.abs(den) / la / lb,
        backA: at, fwdA: segs[i][A.length - 1] - at, backB: bt, fwdB: segs[j][B.length - 1] - bt });
    }
  }
  return out;
}
