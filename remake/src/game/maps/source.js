// Map sources: everything the game needs to build a world, from either
//   * the random jungle generator (game/mapgen.js) - the original "skirmish" map of the remake, or
//   * an original ParaWorld map file (.ula, see maps/ula.js) - multiplayer, campaign and community maps.
//
// A MapSource is a plain object:
//   name, setting ('Jungle' | 'Northland' | 'Savanna' | 'Icewaste' | 'Ashvalley')
//   size        side of the square world in metres (terrain, navigation grid and fog of war cover it)
//   meshCell    terrain mesh resolution (m)
//   play        playable rectangle {x0, x1, z0, z1} - units and buildings stay inside
//   water       water level (m) or null
//   height(x,z) terrain height in metres
//   textures    ground texture files (4 or 8), scales [[sx, sz], ...]
//   splat(hf)   -> (x, z) => weights (array of textures.length)
//   minimapColor(x, z) -> [r, g, b]
//   trees[]     {model, x, z, rot, scale, wood, inside, stump, timber}
//   decor[]     {model, x, z, rot, q, scale, block, sprites}  (block = obstacle for units; q = stored map quaternion:
//               tilted landscape pieces such as plateaus and cliffs)
//   stones[]    {model, x, z, rot, amount}
//   bushes[]    {model, x, z, rot, amount}
//   fish[]      {model, x, z, amount}         (food in the water, for fishing boats)
//   animals[]   {species, x, z, home:[x, z], swim}            single animals placed on the map
//   nests[]     {species, x, z, max, rate, amount, swim, start[]}  respawning nests (start = pre-spawned animals)
//   starts[]    [x, z] start locations; bases[] = the two used by this skirmish
//   models      Set of model names the map needs (loaded on top of the tribes' models)
//   origin      original maps: [ox, oy] with game x = map x - ox, game z = oy - map y
// Game coordinates: x east, z south, y up, (0, 0) = centre of the world.
import { MAP, heightFn, splatFn, generate } from '../mapgen.js';
import { fbm } from '../../engine/terrain.js';
import { forestItems, forestKinds } from './forest.js';

// ---------------------------------------------------------------- the random jungle map
export function generatedSource(cfg) {
  const gen = generate(cfg.seed || 1234);
  const h = MAP.size / 2;
  const models = new Set();
  for (const t of gen.trees) { models.add(t.model); }
  for (const d of gen.decor) models.add(d.model);
  ['resource_stone_jun', 'jungle_fruit_bush', 'jungle_tree_01_stump', 'jungle_tree_01_timber', 'jungle_tree_02_timber',
    ...[1, 2, 3, 4, 5].map((n) => `jungle_tree_0${n}_stump`)].forEach((m) => models.add(m));
  for (const a of gen.animals) models.add(a.species.toLowerCase());
  return {
    kind: 'generated', name: 'Jungle (random)', setting: 'Jungle',
    size: MAP.world, meshCell: 2, play: { x0: -h, x1: h, z0: -h, z1: h }, water: null,
    height: heightFn,
    textures: ['scape_2.jpg', 'scape_0.jpg', 'scape_3.jpg', 'scape_4.jpg'], scales: [0, 1, 2, 3].map(() => [1 / 24, 1 / 24]),
    fallbackTextures: ['grass_green.jpg', 'grass_yellow.jpg', 'dirt.jpg', 'rock.jpg'],
    splat: splatFn,
    minimapColors: [[88, 128, 52], [140, 142, 70], [130, 104, 70], [118, 112, 102]],
    trees: gen.trees.map((t) => {
      const big = !/_med_/.test(t.model), num = t.model.slice(-2);
      return { ...t, stump: big ? `jungle_tree_${num}_stump` : 'jungle_tree_01_stump', timber: null, big };
    }),
    decor: gen.decor, stones: gen.stones.map((s) => ({ ...s, model: 'resource_stone_jun', amount: 2000 })),
    bushes: gen.bushes.map((b) => ({ ...b, model: 'jungle_fruit_bush', amount: 150 })),
    fish: [], plants: [],
    animals: gen.animals, starts: MAP.bases, bases: MAP.bases, models,
    skirt: true,
  };
}

// ---------------------------------------------------------------- original maps
const lc = (s) => String(s || '').toLowerCase();
// big landscape pieces that units can't walk through
const SOLID = /rock|plateau|cliff|mountain|stone(?!_jun)|ruin|pillar|wall|temple|monument|archway|statue|head|coffin|stoneglobe|waterfall|berg|basalt|arc0|wreck|crater|dead_tree|log/;
const NO_PROP = /^(startlocation|itemspawn|domination_flag|questmark|region)/;

// D = Rules (tech tree + class data), md = parsed map (maps/ula.js), cfg = skirmish setup
export function originalSource(md, D, cfg, manifest) {
  const W2 = md.hx * 2, H2 = md.hy * 2;                    // terrain extent (m)
  const size = Math.ceil(Math.max(W2, H2) / 16) * 16;
  const ox = W2 / 2, oy = H2 / 2;
  const toGame = (mx, my) => [mx - ox, oy - my];
  const has = (m) => !!(m && manifest[m]);
  const gfxOf = (cls) => { const c = lc(cls); const g = D.classGfx(c) || c; return has(g) ? g : has(c) ? c : null; };
  const scriptOf = (cls) => D.script(lc(cls)) || '';

  // heights: bilinear on the 2 m grid
  const hx = md.hx, hy = md.hy, HS = md.heights;
  const height = (x, z) => {
    let fx = (x + ox) / 2, fy = (oy - z) / 2;
    fx = Math.max(0, Math.min(hx - 1.001, fx)); fy = Math.max(0, Math.min(hy - 1.001, fy));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const a = HS[j * hx + i], b = HS[j * hx + i + 1], c = HS[(j + 1) * hx + i], d = HS[(j + 1) * hx + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  // ground materials on the 4 m grid -> 8 weights. The lookup point is shifted by a smooth noise (up to ~3 m) and
  // four taps are averaged, so material borders are irregular and round instead of following the 4 m grid.
  const mx = md.mx, my = md.my, MT = md.mats;
  const tap = (w, x, z, k) => {
    const fx = Math.max(0, Math.min(mx - 1.001, (x + ox) / 4 - 0.5)), fy = Math.max(0, Math.min(my - 1.001, (oy - z) / 4 - 0.5));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    w[MT[j * mx + i] & 7] += (1 - u) * (1 - v) * k; w[MT[j * mx + i + 1] & 7] += u * (1 - v) * k;
    w[MT[(j + 1) * mx + i] & 7] += (1 - u) * v * k; w[MT[(j + 1) * mx + i + 1] & 7] += u * v * k;
  };
  const splat = () => (x, z) => {
    const w = [0, 0, 0, 0, 0, 0, 0, 0];
    const wx = x + 3 * (fbm(x * 0.06 + 11.3, z * 0.06, 2, 2) - 0.5) * 2, wz = z + 3 * (fbm(x * 0.06, z * 0.06 + 7.1, 2, 2) - 0.5) * 2;
    tap(w, wx - 1.5, wz - 1.5, 0.25); tap(w, wx + 1.5, wz - 1.5, 0.25); tap(w, wx - 1.5, wz + 1.5, 0.25); tap(w, wx + 1.5, wz + 1.5, 0.25);
    return w;
  };
  // playable area: the map minus a 32 m frame (the original keeps the border unwalkable)
  const play = { x0: -ox + 32, x1: ox - 32, z0: -oy + 32, z1: oy - 32 };
  const inside = (x, z, m = 0) => x > play.x0 + m && x < play.x1 - m && z > play.z0 + m && z < play.z1 - m;
  const models = new Set();
  const use = (m) => { if (m) models.add(m); return m; };
  const settingKey = { Jungle: 'jun', Northland: 'nor', Savanna: 'sav', Icewaste: 'ice', Ashvalley: 'ash' }[md.setting] || 'jun';

  const trees = [], decor = [], stones = [], bushes = [], fish = [], animals = [], starts = [], nests = [];
  const woodOf = (g) => D.resourceValue ? (D.resourceValue('WOOD', g + '_timber') || 300) : 300;
  // campaign missions place their units, buildings and addressed scenery themselves (game/campaign/setup.js)
  const skip = cfg && cfg.skipObjects ? cfg.skipObjects : null;
  for (const o of md.objects) {
    if (skip && skip.has(o.name)) continue;
    const [x, z] = toGame(o.x, o.y);
    const cls = o.cls, script = scriptOf(cls), g = gfxOf(cls);
    switch (o.type) {
      case 'SLOC': starts.push({ x, z, slot: o.owner ?? starts.length }); break;
      case 'TREE': {
        if (!g) break;
        const stump = has(g + '_stump') ? g + '_stump' : null, timber = has(g + '_timber') ? g + '_timber' : null;
        trees.push({ model: use(g), x, z, rot: o.rot, scale: 1, wood: woodOf(g), inside: inside(x, z, 2), stump: use(stump), timber: use(timber), big: !/_med_|bamboo|dead/.test(g) });
        break;
      }
      case 'STON': if (g) stones.push({ model: use(g), x, z, rot: o.rot, amount: +o.attr.hitpoints || 2000 }); break;
      case 'FRUI':
        if (script === 'CFishShoal' || /fish/i.test(cls)) fish.push({ model: g ? use(g) : null, x, z, amount: Math.min(+o.attr.hitpoints || 1000, 2500) });
        else if (g) bushes.push({ model: use(g), x, z, rot: o.rot, amount: +o.attr.hitpoints || 150 });
        break;
      case 'NEST': {
        // Nest.usl: pre-spawn ceil(advance_time / spawn_rate) animals (capped by spawn_max and spawn_amount), then
        // one every spawn_rate s while fewer than spawn_max live (systems/animals.js wildNestsUpdate)
        const sp = o.attr.spawn_type || (D.extra.nests || {})[lc(cls)] || null;
        if (!sp || !D.exists(sp)) break;
        const max = Math.max(1, Math.min(10, +o.attr.spawn_max || 3));
        const rate = Math.max(5, +o.attr.spawn_rate || 60);
        const amount = o.attr.spawn_amount == null || o.attr.spawn_amount === '' ? -1 : +o.attr.spawn_amount;
        const advance = o.attr.advance_time == null ? rate * max : +o.attr.advance_time;
        let n = Math.min(max, Math.ceil(advance / rate));
        if (amount >= 0) n = Math.min(n, amount);
        const swim = /swim/i.test(cls) || script === 'CSwimmingNest';
        const nest = { species: sp, x, z, max, rate, amount: amount < 0 ? -1 : amount - n, swim, start: [] };
        for (let k = 0; k < n; k++) {
          const a = (k / Math.max(1, n)) * 6.283, r = 4 + (k % 3) * 3;
          nest.start.push({ species: sp, x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, home: [x, z], swim });
        }
        nests.push(nest);
        use(lc(D.stats(sp, 1, null)?.gfx));
        break;
      }
      case 'ANML': if (o.owner == null && D.exists(cls)) { animals.push({ species: cls, x, z, home: [x, z] }); use(lc(D.stats(cls, 1, null)?.gfx)); } break;
      case 'DCCO': case 'DECO': case 'VGTN': case 'WOOD':
        if (g && !NO_PROP.test(g)) decor.push({ model: use(g), x, z, rot: o.rot, q: o.q, scale: 1, block: o.type === 'DCCO' || SOLID.test(g), y: o.z, sprites: true });
        break;
      default: break;                                       // units / buildings of campaign maps, item spawns, flags
    }
  }
  // landscape decoration instances (IOMG): plants, rocks, plateaus
  for (const p of md.plants) {
    const g = gfxOf(p.name);
    if (!g || NO_PROP.test(g)) continue;
    const [x, z] = toGame(p.x, p.y);
    decor.push({ model: use(g), x, z, rot: p.rot, scale: 1, block: SOLID.test(g), y: p.z, sprites: true });
  }
  // forest blocks (maps/forest.js): the trees and undergrowth of the map's 32 m forest squares. A forest tree is a
  // tree like the placed ones - the original turns it into a <Setting>_Tree_0N_Timber object when it is chopped.
  const kinds = forestKinds(md.settingName || md.setting);
  if (kinds && md.forest && md.forest.blocks.length && !(cfg && cfg.noForest)) {
    const fi = forestItems(md, (mx_, my_) => height(mx_ - ox, oy - my_));
    const tk = kinds.trees.map((k) => {
      const g = k && gfxOf(k.standard);
      if (!g) return null;
      const stump = k.stump && gfxOf(k.stump), timber = k.timber && gfxOf(k.timber);
      return { model: use(g), stump: use(stump || (has(g + '_stump') ? g + '_stump' : null)), timber: use(timber || (has(g + '_timber') ? g + '_timber' : null)),
        wood: woodOf(g), big: !/_med_|bamboo|dead/.test(g) };
    });
    for (const t of fi.trees) {
      const k = tk[t.kind];
      if (!k) continue;
      const [x, z] = toGame(t.x, t.y);
      trees.push({ model: k.model, x, z, rot: t.rot, scale: 1, wood: k.wood, inside: inside(x, z, 2), stump: k.stump, timber: k.timber, big: k.big, forest: true });
    }
    const dk = kinds.deco.map((n) => { const g = n && gfxOf(n); return g && !NO_PROP.test(g) ? use(g) : null; });
    for (const d of fi.deco) {
      const g = dk[d.kind];
      if (!g) continue;
      const [x, z] = toGame(d.x, d.y);
      decor.push({ model: g, x, z, rot: 0, scale: 1, block: false, sprites: true, forest: true });
    }
  }
  // resources need their depleted look
  for (const s of [`product_stone_${settingKey}`]) if (has(s)) use(s);
  // two start locations for the skirmish: the pair farthest apart
  let best = [0, 1], bd = -1;
  for (let i = 0; i < starts.length; i++) for (let j = i + 1; j < starts.length; j++) {
    const d = Math.hypot(starts[i].x - starts[j].x, starts[i].z - starts[j].z);
    if (d > bd) { bd = d; best = [i, j]; }
  }
  if (starts.length < 2) { starts.length = 0; starts.push({ x: -W2 / 4, z: H2 / 4 }, { x: W2 / 4, z: -H2 / 4 }); }
  const bases = best.map((k) => [starts[k].x, starts[k].z]);
  return {
    kind: 'original', name: md.name, setting: md.setting, info: md.info, file: md.file,
    // wall grid: tile centres at map x ≡ 4, y ≡ 4 (mod 8) -> game x = mx - ox, z = oy - my (docs/spec/walls.md §2)
    wallGrid: [(((4 - ox) % 8) + 8) % 8, (((oy - 4) % 8) + 8) % 8],
    size, meshCell: size > 1400 ? 4 : 2, play, water: md.water,
    origin: [ox, oy],                 // map (x, y) -> game (x - ox, oy - y)
    height,
    textures: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => `${md.setting}/scape_${k}.jpg`), scales: [0, 1, 2, 3, 4, 5, 6, 7].map(() => [1 / 24, 1 / 24]),
    splat, minimapColors: null,
    trees, decor, stones, bushes, fish, plants: [], animals, nests, starts: starts.map((s) => [s.x, s.z]), bases, models, skirt: false,
    noise: (x, z) => fbm(x * 0.05, z * 0.05, 3, 2),
  };
}
