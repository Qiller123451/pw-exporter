// "Dragon Fire": an island of the Dragon Clan, made by the game (mapgen.js) - no map file is read.
//
// From a jungle beach in the south up to a temple on a volcano in the north:
//   z = +400   the landing beach, a line of sharpened stakes across the way up
//   z = +200   the rice terraces: paddies on three levels, mine fields between them, fire cannons on the upper dike
//   z =    0   the bamboo forest: a winding canyon, the nests of the Dilophosaurs in a clearing
//   z = -108   the palisade of the town
//   z = -230   the town (y 40): dojo, weapon maker, engineers' workshop, tea house
//   x = +300   east of it, down at the water: the harbour and its bay
//   z = -400   the stairs up the volcano, under the rocket ramps - ash instead of jungle from here on
//   z = -550   the temple court (y 74), the dragon gate behind it, a crater full of lava beside it
// Heights: the sea lies at 10, the beach at 12, the terraces at 18..23, the town at 40, the court at 74.
import { MapGen, fbm, noise, sstep } from '../mapgen.js';

export const TEXTURES = ['Jungle/scape_2.jpg', 'Jungle/scape_6.jpg', 'Jungle/scape_3.jpg', 'Jungle/scape_5.jpg', 'Jungle/scape_4.jpg',
  'Ashvalley/scape_4.jpg', 'Ashvalley/scape_1.jpg', 'Ashvalley/scape_7.jpg'];
const GRASS = 0, SAND = 1, EARTH = 2, PAVING = 3, ROCK = 4, BLACK = 5, ASH = 6, LAVA = 7;

// places the mission file names too
export const P = {
  beach: [30, 392], stakes: [12, 292], paddies: [0, 226], dike: [38, 150], grove: [160, -8], townGate: [100, -108],
  town: [60, -230], harbour: [300, -258], stairs: [-96, -350], court: [62, -540], dragonGate: [40, -604], crater: [236, -604],
};

// the canyon through the bamboo, the way down to the harbour and the stairs up the volcano: [x, z, height, half width]
const GROVE = [[72, 96, 24, 25], [106, 62, 27, 20], [150, 22, 30, 20], [158, -36, 33, 22], [120, -80, 36, 20], [100, -112, 38, 21], [92, -142, 40, 25]];
const QUAY = [[188, -236, 40, 24], [224, -220, 32, 21], [258, -228, 22, 21], [286, -248, 13.5, 28]];
const STAIRS = [[-66, -292, 42, 22], [-104, -340, 48, 20], [-92, -398, 55, 20], [-42, -438, 62, 20], [14, -468, 69, 21], [40, -492, 73, 24]];

export function build() {
  const g = new MapGen({ size: 1408, water: 10, sea: 2, seed: 23, mountain: { base: 22, height: 64, scale: 1 / 150, detail: 8 }, coast: { reach: 150, vary: 65, slope: 60 } });
  // ---------------------------------------------------------------- the country
  g.disc(30, 612, 150, 5.5, { f: 70, p: 1.3, sea: true, rough: 0.3 });          // the bay of the landing
  g.disc(30, 400, 90, 11.8, { f: 75, rough: 0.35, tag: 'beach' });
  g.path([[30, 345, 13, 42], [20, 312, 15.5, 38], [10, 284, 18, 38]], { f: 55, tag: 'landing' });
  g.disc(0, 232, 78, 18, { f: 70, rough: 0.25, tag: 'paddies' });
  g.disc(-86, 178, 56, 20.5, { f: 60, rough: 0.25, tag: 'paddies' });
  g.disc(36, 160, 58, 23, { f: 60, rough: 0.25, tag: 'paddies' });
  g.path(GROVE, { f: 36, p: 1.7, rough: 0.6, tag: 'grove' });
  g.disc(164, -8, 40, 31.5, { f: 40, p: 1.8, rough: 0.5, tag: 'grove' });
  g.disc(60, -230, 90, 40, { f: 60, p: 2.2, rough: 0.25, tag: 'town' });
  g.disc(-30, -240, 58, 40, { f: 55, p: 2.2, rough: 0.25, tag: 'town' });
  g.disc(140, -236, 54, 40, { f: 55, p: 2.2, rough: 0.25, tag: 'town' });
  g.path(QUAY, { f: 36, p: 1.7, tag: 'quay' });
  g.disc(304, -262, 46, 12.2, { f: 50, rough: 0.3, tag: 'harbour' });
  g.disc(474, -300, 140, 4.5, { f: 50, p: 1.4, sea: true, rough: 0.3 });        // the bay of the harbour
  g.path(STAIRS, { f: 34, p: 1.7, rough: 0.5, tag: 'stairs' });
  g.disc(-142, -322, 27, 50, { f: 30, p: 1.8, rough: 0.3, tag: 'ledge' });      // the ledges of the rocket ramps
  g.disc(-132, -418, 27, 57, { f: 30, p: 1.8, rough: 0.3, tag: 'ledge' });
  g.disc(-34, -388, 25, 58, { f: 30, p: 1.8, rough: 0.3, tag: 'ledge' });
  g.disc(70, -550, 88, 74, { f: 40, p: 2.6, rough: 0.2, tag: 'court' });
  g.disc(-20, -590, 48, 74, { f: 40, p: 2.6, rough: 0.2, tag: 'court' });
  g.disc(236, -604, 42, 62, { f: 12, p: 3, rough: 0.1, tag: 'crater' });        // the crater: nobody gets there
  g.lower(230, -600, 100, 0.3);
  g.shape();

  // ---------------------------------------------------------------- the ground
  const S = g.seed;
  // the ash line: the volcano is black from the stairs upwards (and further down the nearer one is to its top)
  const ashAt = (x, z) => 44 + 60 * sstep(-330, -150, z) + (fbm(x / 37, z / 37, S + 60, 3) - 0.5) * 12;
  g.paint((x, z, h, sl, cover) => {
    const n = fbm(x / 37, z / 37, S + 60, 3), ash = ashAt(x, z);
    if (h < g.water + 1.6) return SAND;
    if (h > ash) {
      // lava runs down the flanks, high up and where it is steep
      if (h > ash + 26 && sl > 0.5 && fbm(x / 21, z / 60, S + 63, 2) > 0.62) return LAVA;
      if (sl > 0.6) return BLACK;
      return noise(x / 13, z / 13, S + 62) > 0.55 ? BLACK : ASH;
    }
    if (sl > 0.62) return ROCK;
    if (sl > 0.42 && noise(x / 9, z / 9, S + 61) > 0.42) return ROCK;
    if (h > ash - 6) return noise(x / 11, z / 11, S + 64) > 0.5 ? ASH : GRASS;
    if (h < g.water + 3.2 && n > 0.3) return SAND;
    return n > 0.66 && cover > 0.5 ? EARTH : GRASS;
  });
  const ROAD = [[30, 420], [30, 345], [12, 292], [4, 250], [20, 200], [40, 150], ...GROVE.map((p) => [p[0], p[1]]), [70, -190], [60, -230]];
  const QROAD = [[60, -230], [140, -236], ...QUAY.map((p) => [p[0], p[1]]), [304, -262]];
  const SROAD = [[60, -230], [-30, -246], ...STAIRS.map((p) => [p[0], p[1]]), [62, -540]];
  g.road(ROAD, 7, EARTH); g.road(QROAD, 6, EARTH); g.road(SROAD, 6, PAVING);
  g.road([[4, 250], [-40, 214], [-86, 178]], 5, EARTH);
  g.spot(60, -230, 34, PAVING);
  g.spot(62, -548, 50, PAVING);
  g.spot(236, -604, 40, LAVA);
  const keepRoad = (pts, r) => { for (let k = 0; k + 1 < pts.length; k++) { const a = pts[k], b = pts[k + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t <= len; t += 6) g.keep.push([a[0] + (b[0] - a[0]) * t / len, a[1] + (b[1] - a[1]) * t / len, r]); } };
  keepRoad(ROAD, 9); keepRoad(QROAD, 8); keepRoad(SROAD, 8); keepRoad([[4, 250], [-40, 214], [-86, 178]], 6);
  // open ground nothing grows on: the landing, the town square, the quay, the court, the crater
  g.keep.push([30, 420, 24], [60, -230, 32], [304, -262, 30], [62, -548, 52], [236, -604, 60], [164, -8, 22]);

  objects(g, ashAt);
  return g.data({ setting: 'Jungle', settingName: 'Jungle', name: 'Dragon Fire', textures: TEXTURES });
}

function objects(g, ashAt) {
  const B = (model, x, z, yaw, flat = 12, o = {}) => g.put(model, x, z, yaw, { flat, r: flat + 3, ...o });
  const D = (model, x, z, yaw = 0, r = 3, o = {}) => g.put(model, x, z, yaw, { type: 'DCCO', r, ...o });
  const T = (x, z, tag) => B('ninigi_small_tower', x, z, 0, 6, { tag });                 // a watchtower
  // ... and one with the rocket launcher on top (the map calls it ninigi_rocket_tower: mission.gfx gives the model)
  const RT = (x, z, tag) => B('ninigi_small_tower', x, z, 0, 6, { tag, cls: 'ninigi_rocket_tower' });
  const SMOKE = (x, z, tag) => B('ninigi_smoke_tower', x, z, 0, 6, { tag });
  const MINE = (x, z) => g.put('ninigi_minefield', x, z, (x * 37 + z * 11) % 360, { r: 5, tag: 'mine' });
  // ---------------------------------------------------------------- the beach: the SEAS landing
  D('seas_hovercraft', -16, 482, 10, 9, { y: g.water - 0.9 });
  D('seas_hovercraft', 66, 486, -14, 9, { y: g.water - 0.9 });
  D('seas_hovercraft', 124, 502, -40, 9, { y: g.water - 0.9 });
  g.put('seas_carrier', -130, 640, 60, { type: 'BLDG', y: g.water - 1.2, r: 0 });
  g.put('seas_carrier', 220, 668, -25, { type: 'BLDG', y: g.water - 1.2, r: 0 });
  D('seas_small_tent', -6, 414, 30, 7); D('seas_small_tent', 62, 418, -20, 7); D('seas_rally_point', 26, 410, 0, 4);
  // the Dragon Clan's watch on the shore, and the stakes across the way up
  T(-30, 346, 'beach'); T(88, 342, 'beach');
  B('ninigi_smoke_tower', 34, 330, 0, 6, { tag: 'beach' });
  D('ninigi_cauldron', 8, 336, 0, 2); D('ninigi_cauldron', 58, 338, 0, 2); D('ninigi_cart', 70, 322, 40, 3); D('campfire', -4, 322, 0, 3);
  g.wall('ninigi_defense_skewer', [[-44, 292], [76, 292]], { gate: { model: 'ninigi_defense_skewer_gate', at: [12, 292], tag: 'gate1' }, tag: 'stakes' });
  T(-20, 276, 'stakes'); T(44, 276, 'stakes');
  // a corsair lies in the bay
  g.put('ninigi_corsair', -96, 528, 120, { type: 'SHIP', y: g.water - 0.3, r: 0, tag: 'bay' });

  // ---------------------------------------------------------------- the rice terraces
  // paddies in blocks beside the road, on every level
  const paddies = (x0, z0, nx, nz, yaw) => { for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) B('ninigi_paddy', x0 + i * 11, z0 + j * 11, yaw, 5, { r: 6, tag: 'paddy' }); };
  paddies(-58, 232, 4, 3, 0); paddies(28, 228, 3, 3, 0); paddies(-116, 160, 3, 3, 0); paddies(-76, 204, 2, 1, 0); paddies(56, 172, 2, 2, 0);
  B('ninigi_bamboofarm', -44, 196, 20, 10); B('ninigi_hunting_lodge', -112, 206, 100, 9); B('ninigi_lumbermill', 64, 208, 250, 10);
  D('ninigi_cart', -10, 216, 70, 3); D('ninigi_cart', -70, 186, 200, 3); D('ninigi_cauldron', 14, 196, 0, 2); D('ninigi_basket', -30, 250, 0, 1); D('ninigi_basket', 44, 262, 0, 1);
  // mine fields: on the road and where one would walk round the paddies
  for (const [x, z] of [[6, 268], [-10, 256], [22, 254], [2, 240], [18, 214], [-22, 222], [30, 190], [8, 182], [-44, 178], [-64, 168], [46, 196], [26, 166], [52, 140], [70, 124], [54, 112]]) MINE(x, z);
  // the fire cannons on the upper dike, and their watch
  B('ninigi_firecannon', 14, 136, 180, 5, { r: 7, tag: 'dike' }); B('ninigi_firecannon', 64, 150, 180, 5, { r: 7, tag: 'dike' });
  RT(-6, 150, 'dike'); RT(84, 170, 'dike'); T(-112, 186, 'paddies');
  SMOKE(38, 138, 'dike');                              // the cannons stand in its smoke

  // ---------------------------------------------------------------- the bamboo forest
  for (const [x, z] of [[176, 8], [186, -18], [164, -34], [144, -6]]) B('ninigi_dilophosaurus_nest', x, z, (x * 7) % 360, 5, { r: 7, tag: 'grove' });
  D('ninigi_snare_trap', 132, 40, 0, 2); D('ninigi_snare_trap', 150, -52, 90, 2); D('ninigi_poison_trap', 112, 54, 0, 3); D('ninigi_poison_trap', 136, -62, 0, 3);
  for (const [x, z] of [[98, 70], [118, 50], [140, 30], [160, -44], [140, -62], [116, -92]]) MINE(x, z);
  D('skeleton_01', 158, 4, 40, 2); D('ninigi_cauldron', 170, -8, 0, 2);

  // ---------------------------------------------------------------- the palisade of the town
  g.wall('ninigi_palisade', [[60, -108], [140, -108]], { gate: { model: 'ninigi_palisade_gate', at: [100, -108], tag: 'gate2' }, tag: 'palisade' });
  RT(74, -126, 'palisade'); RT(126, -126, 'palisade');
  SMOKE(100, -134, 'palisade');

  // ---------------------------------------------------------------- the town
  B('ninigi_fireplace', 60, -272, 180, 13, { tag: 'town' });
  B('ninigi_dojo', -8, -214, 90, 11, { tag: 'town' });
  B('ninigi_weapon_maker', 122, -196, 270, 12, { tag: 'town' });
  B('ninigi_engineer', 148, -268, 300, 12, { tag: 'town' });
  B('ninigi_teahouse', 8, -278, 60, 12, { tag: 'town' });
  B('ninigi_emporium', -44, -262, 90, 13);
  B('ninigi_animal_farm', -56, -206, 120, 13);
  B('ninigi_stone_quarry', 104, -288, 200, 11);
  B('ninigi_telescope_tower', 30, -176, 0, 6, { tag: 'town' });
  RT(-70, -238, 'town'); T(172, -214, 'town'); RT(96, -306, 'town');
  for (const [x, z] of [[40, -214], [80, -214], [40, -246], [80, -246]]) D('hc_lantern_01', x, z, 0, 1);
  D('ninigi_cauldron', 52, -206, 0, 2); D('ninigi_cauldron', 70, -254, 0, 2); D('ninigi_cart', 100, -236, 30, 3); D('ninigi_cart', 22, -236, 200, 3);
  D('ninigi_drumwagon', 60, -230, 20, 4); D('campfire', -20, -250, 0, 3); D('campfire', 130, -232, 0, 3);
  paddies(-74, -288, 2, 2, 0);

  // ---------------------------------------------------------------- the harbour
  B('ninigi_harbour', 322, -272, 90, 10, { tag: 'harbour', y: g.water + 0.6 });
  RT(280, -228, 'harbour'); T(298, -300, 'harbour');
  D('ninigi_cart', 292, -266, 100, 3); D('ninigi_cauldron', 300, -246, 0, 2); D('ninigi_basket', 310, -252, 0, 1);
  for (const [x, z, a] of [[396, -236, 250], [424, -300, 280]]) g.put('ninigi_rocket_boat', x, z, a, { type: 'SHIP', y: g.water - 0.3, r: 0, tag: 'fleet' });
  g.put('ninigi_corsair', 400, -356, 300, { type: 'SHIP', y: g.water - 0.3, r: 0, tag: 'fleet' });
  for (const [x, z] of [[368, -212], [372, -322]]) g.put('ninigi_water_turret', x, z, 270, { type: 'SHIP', y: g.water - 0.2, r: 0, tag: 'fleet' });
  g.put('ninigi_fishing_boat', 358, -262, 200, { type: 'DCCO', y: g.water - 0.2, r: 0 });

  // ---------------------------------------------------------------- the stairs up the volcano
  B('ninigi_rocket_ramp', -150, -322, 0, 6, { r: 8, tag: 'ramp' });
  B('ninigi_rocket_ramp', -140, -420, 0, 6, { r: 8, tag: 'ramp' });
  B('ninigi_rocket_ramp', -30, -382, 0, 6, { r: 8, tag: 'ramp' });
  T(-80, -318, 'stairs'); RT(-70, -412, 'stairs'); RT(0, -448, 'stairs');
  SMOKE(-100, -368, 'stairs');
  for (const [x, z] of [[-90, -322], [-108, -362], [-96, -384], [-66, -420], [-22, -450]]) MINE(x, z);
  D('hc_lantern_01', -70, -300, 0, 1); D('hc_lantern_01', -108, -350, 0, 1); D('hc_lantern_01', -86, -404, 0, 1); D('hc_lantern_01', -36, -444, 0, 1); D('hc_lantern_01', 20, -474, 0, 1);

  // ---------------------------------------------------------------- the temple court
  B('ninigi_temple', 96, -566, 250, 14, { tag: 'court' });
  B('ninigi_warpgate', 40, -610, 0, 20, { tag: 'dragongate' });
  B('ninigi_telescope_tower', -40, -574, 0, 6, { tag: 'court' });
  B('ninigi_smoke_tower', 4, -520, 0, 6, { tag: 'court' }); B('ninigi_smoke_tower', 122, -510, 0, 6, { tag: 'court' });
  for (const [x, z] of [[28, -510], [132, -548], [-44, -612]]) T(x, z, 'court');
  for (const [x, z] of [[96, -498], [124, -606], [-14, -556]]) RT(x, z, 'court');
  B('ninigi_teahouse', -6, -610, 20, 12); B('ninigi_dojo', 132, -584, 280, 11, { tag: 'court2' });
  for (let k = 0; k < 8; k++) { const an = (k + 0.5) / 8 * Math.PI * 2; D('hc_lantern_01', 62 + Math.cos(an) * 30, -548 + Math.sin(an) * 30, 0, 1); }
  D('ninigi_cauldron', 50, -590, 0, 2); D('ninigi_cauldron', 30, -590, 0, 2); D('campfire', 20, -540, 0, 3); D('campfire', 100, -530, 0, 3);

  // ---------------------------------------------------------------- what grows and lies about
  const S = g.seed, wood = (x, z) => sstep(0.4, 0.6, fbm(x / 70, z / 70, S + 90, 3));
  const green = (x, z, h) => h < ashAt(x, z) - 5, burnt = (x, z, h) => h > ashAt(x, z) - 2;
  // bamboo: thick along the canyon, in groves elsewhere
  const bamboo = (x, z) => Math.max(sstep(190, 60, Math.hypot(x - 130, z + 10)), 0.5 * sstep(0.6, 0.72, fbm(x / 50, z / 50, S + 91, 2)));
  g.scatter({ type: 'TREE', n: 2600, tries: 200, gap: 2.4, keep: 2.2, models: [['jungle_bamboo_01', 3], ['jungle_bamboo_02', 3], ['jungle_bamboo_03', 2]],
    where: (x, z, h, sl, c) => (green(x, z, h) && sl < 0.6 && h > g.water + 2.5 ? (c > 0.97 ? 0.1 : 1) * bamboo(x, z) : 0) });
  g.scatter({ type: 'TREE', n: 3000, tries: 160, gap: 3.4, keep: 2.8, models: [['jungle_tree_01', 2], ['jungle_tree_02', 2], ['jungle_tree_03', 2], ['jungle_tree_04', 2], ['jungle_tree_05', 2], ['jungle_tree_med_01', 2], ['jungle_tree_med_02', 2], ['jungle_tree_med_03', 2], 'jungle_tree_med_04', 'jungle_tree_med_05', 'jungle_tree_med_06', 'jungle_tree_med_07'],
    where: (x, z, h, sl, c) => (green(x, z, h) && sl < 0.62 && h > g.water + 3 ? (c > 0.97 ? 0.06 * wood(x, z) : 0.3 + 0.7 * wood(x, z)) * (1 - 0.8 * bamboo(x, z)) : 0) });
  g.scatter({ type: 'TREE', n: 260, gap: 4, keep: 3, models: ['jungle_beachpalm_01', 'jungle_beachpalm_02', 'jungle_beachpalm_03'], where: (x, z, h, sl) => (h > g.water + 0.8 && h < g.water + 5 && sl < 0.4 ? 0.7 : 0) });
  // the volcano: dragon trees and what the ash has left (not ash_dragontree_03: its model carries a hull, a red box)
  g.scatter({ type: 'TREE', n: 900, gap: 4, keep: 3, models: [['ash_dragontree_01', 2], ['ash_dragontree_02', 2], 'ashvalley_tree_01', 'ashvalley_tree_02', 'ashvalley_tree_03', 'ashvalley_tree_05', 'ashvalley_tree_07', 'ashvalley_tree_09', 'ashvalley_tree_11', 'jungle_dead_tree_01'],
    where: (x, z, h, sl, c) => (burnt(x, z, h) && sl < 0.6 ? (c > 0.97 ? 0.04 : 0.35 * (0.3 + wood(x, z))) * (h > 112 ? 0.15 : 1) : 0) });
  // rocks
  g.scatter({ n: 300, gap: 7, keep: 6, models: ['jungle_mushroom_rock_01', 'jungle_mushroom_rock_02', 'jungle_mushroom_rock_03', 'jungle_mushroom_rock_04', 'jungle_plateau_01', 'jungle_plateau_03', 'jungle_plateau_05', 'jungle_plateau_08', 'jungle_cliff_01', 'jungle_beachrock_01', 'jungle_beachrock_03'],
    where: (x, z, h, sl, c) => (green(x, z, h) && c > 0.05 && c < 0.75 && sl > 0.35 ? 0.6 : 0) });
  g.scatter({ n: 110, gap: 7, keep: 6, models: ['jungle_beachrock_01', 'jungle_beachrock_03', 'jungle_smallrock_03', 'jungle_smallrock_06'], where: (x, z, h, sl, c) => (burnt(x, z, h) && c > 0.05 && c < 0.75 && sl > 0.35 ? 0.6 : 0) });
  g.scatter({ n: 600, gap: 2.5, keep: 1.5, models: ['jungle_smallrock_01', 'jungle_smallrock_02', 'jungle_smallrock_03', 'jungle_smallrock_04', 'jungle_smallrock_05', 'jungle_smallrock_06', 'jungle_smallrock_07', 'jungle_smallrock_08', 'jungle_beachrock_02', 'jungle_beachrock_04'],
    where: (x, z, h, sl, c) => (c > 0.4 && c < 0.99 ? 0.4 : c >= 0.99 ? 0.05 : 0.02) });
  // undergrowth, flowers, reeds
  g.scatter({ type: 'VGTN', n: 2600, tries: 160, gap: 1.2, keep: 0.6, models: [['jungle_bush_01', 2], ['jungle_bush_02', 2], ['jungle_bush_03', 2], 'jungle_bush_04', 'jungle_bush_05', 'jungle_bush_06', 'jungle_bush_07', 'jungle_bush_08', ['jungle_underwood_01', 3], ['jungle_underwood_02', 3], ['jungle_underwood_03', 2], 'jungle_underwood_04', 'jungle_underwood_05', ['jungle_flowers_01', 2], ['jungle_flowers_02', 2], 'jungle_flowers_03', 'jungle_flowers_04', 'jungle_fruit_bush'],
    where: (x, z, h, sl) => (green(x, z, h) && sl < 0.7 && h > g.water + 1.8 ? 0.25 + 0.6 * wood(x + 300, z) : 0) });
  g.scatter({ type: 'VGTN', n: 500, gap: 1.2, keep: 0.6, models: ['jungle_mountain_bush_01', 'jungle_mountain_bush_02', 'jungle_mountain_bush_03', 'ashvalley_fruit_bush'],
    where: (x, z, h, sl) => (!green(x, z, h) && sl < 0.6 ? 0.25 * (0.3 + wood(x + 300, z)) : 0) });
  g.scatter({ type: 'VGTN', n: 600, gap: 1, keep: 0.5, above: -0.5, models: ['jungle_reed_01', 'jungle_reed_02', 'jungle_reed_03', 'jungle_beachgrass_01', 'jungle_beachgrass_02', 'jungle_beachgrass_03', 'jungle_wildrice_01', 'jungle_wildrice_02'], where: (x, z, h) => (h < g.water + 1.4 ? 0.8 : 0) });
}
