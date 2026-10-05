// "Iron Winter" - the map of mission 3, made by the game (mapgen.js), not read from a ParaWorld map file.
//
// A northern island. The SEAS land on the south beach, fight through a Norse fishing village, take the war
// mammoths of the pens east of it, break the gate of the pass, climb through the snow to a frozen lake, are
// flown round the cape by helicopter and storm the fortress of the rune gate on the northern cliffs.
//
//   z = -500   north cape: the fortress (y 56) above the sea, its harbour in the cove below
//   z = -215   the frozen lake (y 60)
//   z = -130.. the pass: a canyon climbing from the village (y 22) into the snow
//   z = 80     the wall of the pass
//   z = 185    the village (y 20), the mammoth pens east of it (x 270)
//   z = 285    the palisade above the beach
//   z = 385    the landing beach (y 11.6), the sea (10) south of it
//
// Ground materials (the level loads this list instead of one setting's set):
//   0 grass  1 shingle  2 trodden earth  3 paving  4 rock  5 snow  6 frozen grass  7 snowy rock
import { MapGen, fbm, noise, sstep } from '../mapgen.js';

export const TEXTURES = ['Northland/scape_0.jpg', 'Northland/scape_1.jpg', 'Northland/scape_6.jpg', 'Northland/scape_5.jpg', 'Northland/scape_4.jpg',
  'Icewaste/scape_0.jpg', 'Icewaste/scape_2.jpg', 'Icewaste/scape_7.jpg'];
const GRASS = 0, SHINGLE = 1, EARTH = 2, PAVING = 3, ROCK = 4, SNOW = 5, FROST = 6, SNOWROCK = 7;

// places the mission file names too
export const P = {
  beach: [0, 385], palisade: [4, 284], village: [-4, 190], pens: [270, 176], passGate: [-28, 60],
  ambush: [-116, -30], lake: [130, -215], causeway: [48, -292], fortGate: [20, -308], fortress: [-44, -412], runeGate: [-52, -438],
};

export function build() {
  const g = new MapGen({ size: 1408, water: 10, sea: 2, seed: 11, mountain: { base: 22, height: 62, scale: 1 / 160, detail: 8 }, coast: { reach: 150, vary: 65, slope: 60 } });
  // ---------------------------------------------------------------- the country
  g.disc(0, 578, 150, 5.5, { f: 70, p: 1.3, sea: true, rough: 0.3 });           // the bay
  g.disc(0, 385, 92, 11.8, { f: 75, rough: 0.35, tag: 'beach' });
  g.path([[0, 335, 13, 44], [2, 300, 15.5, 40], [2, 268, 18, 40]], { f: 55, tag: 'landing' });
  g.disc(-6, 190, 96, 20, { f: 80, rough: 0.3, tag: 'village' });
  g.disc(78, 168, 58, 20, { f: 70, rough: 0.3, tag: 'village' });
  g.disc(-92, 158, 54, 20, { f: 70, rough: 0.3, tag: 'village' });
  g.path([[110, 170, 20, 26], [172, 158, 21.5, 23], [218, 168, 23, 24]], { f: 50, tag: 'lane' });
  g.disc(272, 176, 62, 23, { f: 70, rough: 0.3, tag: 'pens' });
  g.path(PASS.map((p, k) => [p[0], p[1], p[2], [30, 23, 20, 20, 22, 20, 22, 26][k]]), { f: 36, p: 1.7, rough: 0.6, tag: 'pass' });
  g.disc(-116, -30, 38, 36.5, { f: 40, p: 1.8, rough: 0.5, tag: 'pass' });
  g.disc(130, -215, 86, 60, { f: 40, p: 2.6, rough: 0.12, tag: 'lake' });
  g.path([[78, -272, 60, 22], [22, -308, 58, 19], [0, -352, 56, 21]], { f: 36, p: 1.7, tag: 'causeway' });
  g.disc(-44, -420, 82, 56, { f: 40, p: 2.6, rough: 0.2, tag: 'fort' });
  g.disc(34, -422, 54, 56, { f: 40, p: 2.6, rough: 0.2, tag: 'fort' });
  g.disc(-122, -428, 50, 56, { f: 40, p: 2.6, rough: 0.2, tag: 'fort' });
  g.disc(-20, -622, 105, 4.5, { f: 40, p: 1.5, sea: true, rough: 0.3 });        // the cove under the cape
  g.disc(-330, -480, 120, 4.5, { f: 40, p: 1.5, sea: true, rough: 0.3 });       // ... and the sea west and east of it: the fortress stands on a cape
  g.disc(250, -520, 120, 4.5, { f: 40, p: 1.5, sea: true, rough: 0.3 });
  // the cliffs towards the sea are low (the ridge towards the lake keeps its height: only the gate leads in)
  g.lower(-40, -560, 150, 0.45); g.lower(-240, -460, 110, 0.45); g.lower(165, -495, 110, 0.45);
  g.shape();

  // ---------------------------------------------------------------- the ground
  const S = g.seed;
  // the snow line: high above the village, down at the floor of the pass further north
  const snowAt = (x, z) => 46 + 30 * sstep(-120, 230, z) + (fbm(x / 37, z / 37, S + 60, 3) - 0.5) * 10;
  g.paint((x, z, h, sl, cover) => {
    const n = fbm(x / 37, z / 37, S + 60, 3), snowline = snowAt(x, z);
    if (h < g.water + 1.6) return SHINGLE;
    if (sl > 0.62) return h > snowline + 6 ? SNOWROCK : ROCK;
    if (sl > 0.42 && noise(x / 9, z / 9, S + 61) > 0.42) return h > snowline + 4 ? SNOWROCK : ROCK;
    if (h > snowline + 5) return SNOW;
    if (h > snowline - 8) return h > snowline ? (noise(x / 15, z / 15, S + 62) > 0.3 ? SNOW : FROST) : FROST;
    if (h < g.water + 3.2 && n > 0.35) return SHINGLE;
    return n > 0.64 && cover > 0.5 ? SHINGLE : GRASS;
  });
  // roads: trodden earth from the beach through the village and up the pass; paving in the village and the fortress
  const ROAD = [[0, 420], [0, 335], [2, 284], [0, 240], [-4, 190], [-10, 125], ...PASS.slice(1).map((p) => [p[0], p[1]]), [110, -190]];
  g.road(ROAD, 7, EARTH);
  g.road([[-4, 190], [60, 180], [110, 170], [172, 158], [218, 168], [262, 176]], 6, EARTH);
  g.road([[78, -272], [22, -308], [0, -352], [-24, -392], [-48, -440]], 7, EARTH);
  g.spot(-4, 190, 30, PAVING);
  g.spot(-48, -432, 44, PAVING);
  g.spot(272, 176, 34, EARTH);
  const keepRoad = (pts, r) => { for (let k = 0; k + 1 < pts.length; k++) { const a = pts[k], b = pts[k + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t <= len; t += 6) g.keep.push([a[0] + (b[0] - a[0]) * t / len, a[1] + (b[1] - a[1]) * t / len, r]); } };
  keepRoad(ROAD, 9); keepRoad([[-4, 190], [60, 180], [110, 170], [172, 158], [218, 168], [262, 176]], 8); keepRoad([[78, -272], [22, -308], [0, -352], [-24, -392], [-48, -440]], 9);
  // open ground nothing grows on: the village square, the pens, the middle of the lake, the fortress yard
  g.keep.push([-4, 190, 30], [262, 180, 30], [130, -215, 62], [-48, -430, 50], [0, 408, 22]);

  objects(g, snowAt);
  return finish(g);
}

// the pass, from the village up to the lake: [x, z, height]
const PASS = [[-10, 125, 20], [-12, 86, 22], [-38, 42, 26], [-106, -2, 33], [-120, -58, 40], [-62, -110, 47], [18, -130, 54], [72, -162, 60]];

function objects(g, snowAt) {
  const B = (model, x, z, yaw, flat = 16, o = {}) => g.put(model, x, z, yaw, { flat, r: flat + 3, ...o });
  const D = (model, x, z, yaw = 0, r = 3, o = {}) => g.put(model, x, z, yaw, { type: 'DCCO', r, ...o });
  // ---------------------------------------------------------------- the beach: the SEAS landing
  D('seas_hovercraft', -44, 449, 10, 9, { y: g.water - 0.9 });
  D('seas_hovercraft', 40, 452, -14, 9, { y: g.water - 0.9 });
  D('seas_hovercraft', 96, 470, -40, 9, { y: g.water - 0.9 });
  g.put('seas_carrier', -150, 600, 60, { type: 'BLDG', y: g.water - 1.2, r: 0 });
  g.put('seas_carrier', 190, 640, -25, { type: 'BLDG', y: g.water - 1.2, r: 0 });
  D('seas_small_tent', -36, 400, 30, 7); D('seas_small_tent', 30, 404, -20, 7); D('seas_rally_point', -6, 398, 0, 4);
  // the Norsemen's watch on the shore
  B('hu_small_tower', -58, 336, 0, 8, { tag: 'beach' }); B('hu_small_tower', 62, 332, 0, 8, { tag: 'beach' });
  for (const [x, z, a] of [[-30, 352, 80], [-18, 349, 95], [14, 348, 85], [28, 351, 100], [44, 356, 70], [-46, 357, 110]]) D('hu_fence_big_0' + (1 + ((x + 60) >> 3) % 3), x, z, a, 3);
  D('hu_cart', 30, 320, 40, 3); D('campfire', -20, 318, 0, 3); D('woodlog', -26, 322, 30, 2); D('woodlog', -15, 312, 100, 2);
  // the palisade across the way up from the beach
  g.wall('hu_palisade', [[-68, 284], [76, 284]], { gate: { model: 'hu_palisade_gate', at: [4, 284], tag: 'gate1' }, tag: 'palisade' });
  B('hu_small_tower', -30, 300, 0, 8, { tag: 'palisade' }); B('hu_small_tower', 38, 300, 0, 8, { tag: 'palisade' });

  // ---------------------------------------------------------------- the village
  D('hu_statue', -4, 190, 0, 5);
  B('hu_tavern', -62, 232, 250, 19, { tag: 'village' });
  B('hu_warehouse', -66, 176, 270, 19);
  B('hu_stone_cottage', -118, 196, 300, 15);
  B('hu_stone_cottage', -112, 142, 240, 15);
  B('hu_kennel', -46, 132, 200, 11, { tag: 'village' });
  B('hu_weapons_smith', 52, 148, 120, 17, { tag: 'village' });
  B('hu_marketplace', 66, 226, 90, 24);
  B('hu_stone_cottage', 122, 148, 100, 15);
  B('hu_lumberjack_cottage', 124, 206, 60, 12);
  B('hu_stone_cottage', 28, 246, 170, 15); B('hu_stone_cottage', -146, 152, 90, 15); B('hu_stone_cottage', 98, 118, 20, 15);
  B('hu_corn_field', 96, 252, 0, 9); B('hu_corn_field', 118, 244, 0, 9);
  B('hu_large_tower', -52, 256, 0, 9, { tag: 'village' }); B('hu_large_tower', 30, 116, 0, 9, { tag: 'village' });
  D('hu_cart', 14, 206, 70, 3); D('hu_cart', -24, 160, 200, 3); D('campfire', 18, 176, 0, 3); D('campfire', -92, 172, 0, 3);
  for (const [x, z, a] of [[84, 196, 0], [90, 196, 0], [96, 196, 0], [102, 196, 0], [-88, 216, 90], [-88, 210, 90], [-30, 226, 0], [-24, 226, 0]]) D('hu_fence_0' + (1 + (Math.abs(x) >> 2) % 5), x, z, a, 2);
  D('woodlog', 108, 214, 20, 2); D('woodlog', 112, 218, 60, 2); D('skeleton_01', -130, 168, 40, 2);

  // ---------------------------------------------------------------- the mammoth pens
  B('hu_big_animal_farm', 306, 152, 200, 18, { tag: 'pens' });
  B('hu_small_animal_farm', 300, 208, 300, 18, { tag: 'pens' });
  B('hu_small_tower', 232, 142, 0, 8, { tag: 'pens' });
  // the pen: carts, logs and fodder around the trodden ground
  D('hu_cart', 286, 178, 120, 3); D('woodlog', 278, 196, 40, 2); D('woodlog', 250, 152, 80, 2); D('hu_cart', 252, 204, 30, 3);
  D('hu_cart', 236, 196, 300, 3); D('woodlog', 244, 206, 0, 2); D('campfire', 240, 158, 0, 3);

  // ---------------------------------------------------------------- the wall of the pass
  g.wall('hu_re_enforced_wall', [[-68, 60], [12, 60]], { gate: { model: 'hu_re_enforced_wall_gate', at: [-28, 60], tag: 'gate2' }, tag: 'passwall' });
  B('hu_large_tower_upgrade', -58, 76, 0, 9, { tag: 'passwall' }); B('hu_large_tower_upgrade', 4, 76, 0, 9, { tag: 'passwall' });

  // ---------------------------------------------------------------- the pass
  D('northland_ruinwall_tower', -138, -34, 30, 9); D('northland_ruinwall_01', -128, -12, 10, 5); D('northland_ruinwall_03', -100, -46, 100, 5);
  D('northland_megalith_01', -108, -18, 0, 4); D('northland_megalith_01', -124, -40, 70, 4); D('northland_stonetomb_01', -96, -28, 20, 4);
  B('hu_small_tower', -92, -92, 0, 8, { tag: 'pass' }); B('hu_small_tower', 28, -112, 0, 8, { tag: 'pass' });
  D('northland_skeleton', -60, 20, 30, 3); D('hu_cart', -70, -100, 10, 3);

  // ---------------------------------------------------------------- the frozen lake
  for (const [x, z, m, a] of [[70, -230, 'ice_iceberg_01', 0], [196, -196, 'ice_iceberg_02', 40], [150, -292, 'ice_iceberg_01', 200], [96, -168, 'ice_berg_icicle_01', 0], [188, -256, 'ice_berg_icicle_02', 90], [176, -150, 'ice_pikes', 0], [84, -262, 'ice_pikes', 60]]) D(m, x, z, a, 9);
  D('northland_stonecircle_01', 122, -196, 0, 14);
  D('seas_rally_point', 150, -236, 0, 4, { tag: 'lz' });

  // ---------------------------------------------------------------- the fortress
  g.wall('hu_re_enforced_wall', [[-12, -308], [60, -308]], { gate: { model: 'hu_re_enforced_wall_gate', cls: 'fort_wall_gate', at: [20, -308], tag: 'gate3' }, tag: 'fortwall' });
  for (const [x, z] of [[-14, -326], [50, -330], [76, -416], [52, -464], [-36, -494], [-112, -472], [-162, -430], [-124, -386]]) B('hu_large_tower_upgrade', x, z, 0, 9, { tag: 'fort' });
  B('hu_temple', 26, -424, 90, 20, { tag: 'fort' });
  B('hu_bunker', -112, -424, 270, 18, { tag: 'fort' });
  B('hu_machine_maker', -6, -386, 180, 19);
  B('hu_arena', -84, -386, 180, 18);
  B('hu_warpgate', -52, -468, 0, 26, { tag: 'runegate' });
  D('rune_gate_groundplate', -52, -434, 0, 12, { dy: 0.05 });
  for (const [x, z, m] of [[-78, -446, 'valhalla_small_monolit'], [-26, -446, 'valhalla_small_monolit'], [-84, -422, 'rune_blue'], [-20, -422, 'rune_red'], [-66, -414, 'rune_red_small'], [-38, -414, 'rune_blue_small']]) D(m, x, z, 0, 4);
  D('hu_statue_02', -22, -366, 0, 5); D('hu_statue_02', 26, -366, 0, 5);
  // the ring of standing stones round the plate of the rune gate, and what else the garrison has put up
  for (let k = 0; k < 10; k++) { const an = (k + 0.5) / 10 * Math.PI * 2, x = -52 + Math.cos(an) * 24, z = -434 + Math.sin(an) * 24; if (z < -420 || Math.abs(x + 52) > 12) D(k % 2 ? 'northland_obelisk_02' : 'northland_obelisk_04', x, z, k * 36, 3); }
  D('valhalla_tower_01', -96, -474, 0, 8); D('valhalla_tower_01', -8, -474, 180, 8);
  B('hu_stone_cottage', 62, -388, 200, 15); B('hu_stone_cottage', -150, -398, 100, 15); B('hu_warehouse', 68, -446, 250, 18);
  D('campfire', -30, -392, 0, 3); D('campfire', -70, -404, 0, 3); D('hu_cart', 10, -372, 40, 3); D('hu_cart', -60, -372, 200, 3); D('woodlog', 44, -372, 0, 2);
  // the harbour in the cove: the dragon boats
  for (const [x, z, a] of [[-70, -582, 40], [-10, -596, 0], [52, -578, -50]]) g.put('hu_dragon_boat', x, z, a, { type: 'SHIP', y: g.water - 0.4, r: 0, tag: 'boats' });
  g.put('hu_dragon_boat', -128, 494, 120, { type: 'SHIP', y: g.water - 0.4, r: 0, tag: 'bay' });

  // ---------------------------------------------------------------- what grows and lies about
  const low = (x, z, h) => h < snowAt(x, z) - 6, high = (x, z, h) => h > snowAt(x, z) - 2;
  const S = g.seed, wood = (x, z) => sstep(0.42, 0.62, fbm(x / 70, z / 70, S + 90, 3));
  // forests on the gentler mountain sides and at the edges of the floors, clearings in between
  g.scatter({ type: 'TREE', n: 3200, tries: 160, gap: 3.2, keep: 2.6, models: [['northland_tree_01', 3], ['northland_tree_02', 3], ['northland_tree_03', 2], ['northland_tree_04', 2], ['northland_tree_05', 2], ['northland_larch_01', 2], ['northland_larch_02', 2], 'northland_birch_01', 'northland_birch_02', 'northland_beech_01', 'northland_oak_02', 'northland_maple_02', 'northland_poplar_01'],
    where: (x, z, h, sl, c) => (low(x, z, h) && sl < 0.62 && h > g.water + 2.5 ? (c > 0.97 ? 0.08 * wood(x, z) : 0.3 + 0.7 * wood(x, z)) : 0) });
  g.scatter({ type: 'TREE', n: 2200, gap: 3.4, keep: 2.8, models: [['icewaste_tree_01', 3], ['icewaste_tree_02', 3], ['icewaste_tree_03', 2], ['icewaste_tree_04', 2], ['icewaste_tree_05', 2], 'icewaste_dead_tree_01', 'icewaste_birch_01', 'icewaste_oak_01'],
    where: (x, z, h, sl, c) => (!low(x, z, h) && sl < 0.7 ? (c > 0.97 ? 0.05 * wood(x, z) : (0.15 + 0.6 * wood(x, z)) * (h > 105 ? 0.2 : 1)) : 0) });
  g.scatter({ type: 'TREE', n: 110, gap: 3, keep: 2.2, models: ['northland_dead_tree_01', 'northland_dead_tree_02', 'northland_dead_tree_03'], where: (x, z, h, sl, c) => (sl < 0.6 && c > 0.3 && c < 0.95 ? 0.3 : 0) });
  // rocks: big ones at the foot of the mountains, stones everywhere
  g.scatter({ n: 260, gap: 7, keep: 6, models: ['northland_stone_01', 'northland_stone_02', 'northland_stone_03', 'northland_stone_04', 'northland_stone_05', 'northland_stone_06', 'northland_boulders_01', 'northland_plateau_01', 'northland_plateau_03', 'northland_small_mountain_01', 'northland_small_mountain_02'],
    where: (x, z, h, sl, c) => (low(x, z, h) && c > 0.05 && c < 0.75 && sl > 0.35 ? 0.6 : 0) });
  g.scatter({ n: 240, gap: 7, keep: 6, models: ['ice_snow_middlerock_01', 'ice_snow_middlerock_02', 'ice_snow_middlerock_03', 'ice_middlerock_01', 'ice_stone_01', 'ice_stone_02', 'ice_plateau_01', 'ice_smallrock_01', 'ice_smallrock_02'],
    where: (x, z, h, sl, c) => (!low(x, z, h) && c > 0.05 && c < 0.75 && sl > 0.35 ? 0.6 : 0) });
  g.scatter({ n: 520, gap: 2.5, keep: 1.5, models: ['northland_stones_01', 'northland_stones_02', 'northland_stones_03', 'northland_stones_04', 'northland_stones_05', 'northland_stones_06', 'northland_small_rock_01', 'northland_small_rock_02', 'northland_small_rock_03', 'northland_smallstones_01', 'northland_smallstones_02', 'northland_smallstones_03'],
    where: (x, z, h, sl, c) => (c > 0.4 && c < 0.99 ? 0.4 : c >= 0.99 ? 0.06 : 0.02) });
  g.scatter({ n: 160, gap: 3, keep: 2, models: ['ice_stalagmites_01', 'ice_stalagmites_02', 'ice_pikes'], where: (x, z, h, sl, c) => (high(x, z, h) && c > 0.3 && c < 0.9 ? 0.5 : 0) });
  // undergrowth and flowers
  g.scatter({ type: 'VGTN', n: 2200, tries: 160, gap: 1.2, keep: 0.6, models: [['northland_shrub_01', 2], ['northland_shrub_02', 2], ['northland_shrub_03', 2], ['northland_juniper_01', 2], ['northland_juniper_02', 2], 'northland_juniper_03', 'northland_juniper_04', ['northland_fern_01', 3], ['northland_fern_02', 3], 'northland_blueberry_01', ['northland_flowers_01', 2], ['northland_flowers_02', 2], 'northland_gentian_01', 'northland_lichen_01', 'northland_moss_01'],
    where: (x, z, h, sl, c) => (low(x, z, h) && sl < 0.7 && h > g.water + 1.8 ? 0.25 + 0.6 * wood(x + 300, z) : 0) });
  g.scatter({ type: 'VGTN', n: 900, gap: 1.2, keep: 0.6, models: ['icewaste_bush_01', 'icewaste_bush_02', 'icewaste_bush_03', 'icewaste_juniper_01', 'icewaste_shrub_01_a', 'icewaste_shrub_02_a'],
    where: (x, z, h, sl, c) => (!low(x, z, h) && sl < 0.6 ? 0.3 * (0.3 + wood(x + 300, z)) : 0) });
  g.scatter({ type: 'VGTN', n: 500, gap: 1, keep: 0.5, above: -0.5, models: ['northland_beach_reed_01', 'northland_beach_reed_02', 'northland_reed_01'], where: (x, z, h) => (h < g.water + 1.2 ? 0.8 : 0) });
  // ice on the sea round the cape
  g.scatter({ n: 90, gap: 16, keep: 12, wet: 'only', above: -1.2, y: g.water - 0.9, models: ['ice_floe_01', 'ice_floe_02', 'ice_floe_03', 'ice_broken_floe_01', ['ice_iceberg_01', 0.4], ['ice_iceberg_02', 0.4]], area: [-600, -696, 600, -350],
    where: (x, z, h) => (h < g.water - 2 ? 0.6 : 0), tag: 'ice' });
}

function finish(g) {
  return g.data({ setting: 'Northland', settingName: 'Northland', name: 'Iron Winter', textures: TEXTURES });
}
