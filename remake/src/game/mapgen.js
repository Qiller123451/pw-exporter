import { mulberry32, fbm, smoothstep } from '../engine/terrain.js';

// Jungle skirmish map: SEAS in the south-west, Dustriders in the north-east, wild dinosaurs in between.
export const MAP = {
  size: 480,          // playable square
  world: 640,         // rendered terrain (border forest beyond the playable area)
  bases: [[-150, 150], [150, -150]],
};

export function heightFn(x, z) {
  let h = 3.2 * Math.sin(x * 0.013 + 0.7) * Math.cos(z * 0.017 - 0.4) + 1.6 * Math.sin(x * 0.037 + z * 0.029 + 2.1);
  h += (fbm(x * 0.011, z * 0.011, 7, 4) - 0.5) * 12;
  for (const [bx, bz] of MAP.bases) {
    const d = Math.hypot(x - bx, z - bz);
    const k = smoothstep(40, 80, d);
    h = 1.5 + (h - 1.5) * k;
  }
  const e = Math.max(Math.abs(x), Math.abs(z));
  h += smoothstep(MAP.size / 2 - 10, MAP.world / 2, e) * 22;
  return h;
}

export function forestDensity(x, z) {
  let d = fbm(x * 0.009 + 3.1, z * 0.009 - 1.7, 3, 4);
  d = (d - 0.38) * 2.1;
  for (const [bx, bz] of MAP.bases) d -= (1 - smoothstep(45, 85, Math.hypot(x - bx, z - bz))) * 1.6;
  // a lightly wooded corridor between the bases
  const t = ((x - MAP.bases[0][0]) * (MAP.bases[1][0] - MAP.bases[0][0]) + (z - MAP.bases[0][1]) * (MAP.bases[1][1] - MAP.bases[0][1])) /
    ((MAP.bases[1][0] - MAP.bases[0][0]) ** 2 + (MAP.bases[1][1] - MAP.bases[0][1]) ** 2);
  const px = MAP.bases[0][0] + t * (MAP.bases[1][0] - MAP.bases[0][0]), pz = MAP.bases[0][1] + t * (MAP.bases[1][1] - MAP.bases[0][1]);
  const wig = Math.sin(t * 9) * 30;
  d -= (1 - smoothstep(10, 26, Math.hypot(x - px - wig * 0.7, z - pz - wig * 0.7))) * 0.8;
  const e = Math.max(Math.abs(x), Math.abs(z));
  d += smoothstep(MAP.size / 2 - 24, MAP.size / 2 + 4, e) * 1.4;
  return d;
}

// ground material weights [green grass, yellow grass, dirt, rock]
export function splatFn(hf) {
  return (x, z) => {
    const n = fbm(x * 0.02, z * 0.02, 11, 3), n2 = fbm(x * 0.05 + 7, z * 0.05, 5, 2);
    let green = 0.6 + (n - 0.5) * 1.6, yellow = 0.4 - (n - 0.5) * 1.6, dirt = 0, rock = 0;
    for (const [bx, bz] of MAP.bases) dirt += (1 - smoothstep(18, 42, Math.hypot(x - bx, z - bz) + (n2 - 0.5) * 20)) * 1.4;
    const fd = forestDensity(x, z);
    dirt += smoothstep(0.55, 1.1, fd) * 0.35 * n2;
    const e = 1.5;
    const sl = Math.hypot(hf.at(x + e, z) - hf.at(x - e, z), hf.at(x, z + e) - hf.at(x, z - e)) / (2 * e);
    rock = smoothstep(0.35, 0.7, sl) * 2;
    green = Math.max(0, green); yellow = Math.max(0, yellow);
    return [green, yellow, Math.max(0, dirt), rock];
  };
}

// Place trees, decor, stones, bushes and animals. Returns placement lists.
export function generate(seed = 1234) {
  const rnd = mulberry32(seed);
  const trees = [], decor = [], stones = [], bushes = [], animals = [];
  const occ = new Map();
  const key = (x, z) => ((Math.floor(x / 6) + 1000) * 4000 + Math.floor(z / 6) + 1000);
  const near = (x, z, d) => {
    const cx = Math.floor(x / 6), cz = Math.floor(z / 6), k = Math.ceil(d / 6);
    for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) {
      const l = occ.get((cx + i + 1000) * 4000 + cz + j + 1000);
      if (l) for (const p of l) if (Math.hypot(p[0] - x, p[1] - z) < d) return true;
    }
    return false;
  };
  const mark = (x, z) => { const k = key(x, z); if (!occ.has(k)) occ.set(k, []); occ.get(k).push([x, z]); };
  const H = MAP.size / 2, WH = MAP.world / 2 - 30;
  // keep base areas clear
  for (const [bx, bz] of MAP.bases) for (let a = 0; a < 30; a++) mark(bx + Math.cos(a) * 10, bz + Math.sin(a) * 10);
  const bigTrees = ['jungle_tree_01', 'jungle_tree_02', 'jungle_tree_03', 'jungle_tree_04', 'jungle_tree_05'];
  const medTrees = ['jungle_tree_med_01', 'jungle_tree_med_02', 'jungle_tree_med_03', 'jungle_tree_med_04', 'jungle_tree_med_05', 'jungle_tree_med_06'];
  for (let i = 0; i < 60000; i++) {
    const x = (rnd() * 2 - 1) * (H + 40), z = (rnd() * 2 - 1) * (H + 40);
    const d = forestDensity(x, z);
    const p = smoothstep(0.35, 0.75, d);
    if (rnd() > p * 0.28) continue;
    const minD = 6.5 - 1.5 * smoothstep(0.7, 1.2, d);
    if (near(x, z, minD)) continue;
    mark(x, z);
    const big = rnd() < 0.62;
    const model = big ? bigTrees[Math.floor(rnd() * bigTrees.length)] : medTrees[Math.floor(rnd() * medTrees.length)];
    trees.push({ model, x, z, rot: rnd() * 6.283, scale: 0.85 + rnd() * 0.3, wood: big ? 300 : 150, inside: Math.max(Math.abs(x), Math.abs(z)) < H - 4 });
  }
  // stones: 3 per base + neutral ones
  const stoneAt = (x, z) => { if (!near(x, z, 10)) { mark(x, z); stones.push({ x, z, rot: rnd() * 6.28 }); return true; } return false; };
  for (const [bx, bz] of MAP.bases) {
    let n = 0;
    for (let k = 0; k < 200 && n < 3; k++) { const a = rnd() * 6.28, r = 38 + rnd() * 14; if (stoneAt(bx + Math.cos(a) * r, bz + Math.sin(a) * r)) n++; }
  }
  for (let k = 0, n = 0; k < 400 && n < 8; k++) {
    const x = (rnd() * 2 - 1) * (H - 40), z = (rnd() * 2 - 1) * (H - 40);
    if (MAP.bases.some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 90)) continue;
    if (stoneAt(x, z)) n++;
  }
  // fruit bushes: groups near bases and in meadows
  const bushGroup = (cx, cz, n) => {
    for (let k = 0, m = 0; k < 60 && m < n; k++) {
      const x = cx + (rnd() - 0.5) * 16, z = cz + (rnd() - 0.5) * 16;
      if (near(x, z, 3.5)) continue;
      mark(x, z); bushes.push({ x, z, rot: rnd() * 6.28 }); m++;
    }
  };
  for (const [bx, bz] of MAP.bases) {
    for (let g = 0; g < 2; g++) { const a = rnd() * 6.28, r = 30 + rnd() * 12; bushGroup(bx + Math.cos(a) * r, bz + Math.sin(a) * r, 5); }
  }
  for (let g = 0; g < 7; g++) {
    const x = (rnd() * 2 - 1) * (H - 50), z = (rnd() * 2 - 1) * (H - 50);
    if (MAP.bases.some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 80) || forestDensity(x, z) > 0.4) continue;
    bushGroup(x, z, 4);
  }
  // decor: undergrowth along forest edges, flowers and rocks in meadows
  const edge = ['jungle_bush_01', 'jungle_bush_02', 'jungle_bush_03', 'jungle_bush_04'];
  const meadow = ['jungle_flowers_01', 'jungle_flowers_02', 'jungle_reed_01'];
  const rocks = ['jungle_smallrock_01', 'jungle_smallrock_03', 'jungle_smallrock_05', 'jung_middle_rock_01'];
  for (let i = 0; i < 9000; i++) {
    const x = (rnd() * 2 - 1) * WH, z = (rnd() * 2 - 1) * WH;
    const d = forestDensity(x, z);
    if (MAP.bases.some(([bx, bz]) => Math.hypot(x - bx, z - bz) < 34)) continue;
    const pe = smoothstep(0.1, 0.45, d) * (1 - smoothstep(0.9, 1.3, d));
    const r = rnd();
    if (r < pe * 0.09) { if (!near(x, z, 3)) decor.push({ model: edge[Math.floor(rnd() * edge.length)], x, z, rot: rnd() * 6.28, scale: 0.6 + rnd() * 0.35, block: false }); }
    else if (r < pe * 0.09 + (1 - smoothstep(0, 0.3, d)) * 0.06) decor.push({ model: meadow[Math.floor(rnd() * meadow.length)], x, z, rot: rnd() * 6.28, scale: 0.8 + rnd() * 0.5, block: false });
    else if (r > 0.9985 && !near(x, z, 6)) { mark(x, z); decor.push({ model: rocks[Math.floor(rnd() * rocks.length)], x, z, rot: rnd() * 6.28, scale: 0.7 + rnd() * 0.5, block: true }); }
  }
  // wild animals: [species, count range, spawn rule]
  const herds = [
    ['Corythosaurus', 3, 5, 6], ['Tsintaosaurus', 3, 4, 4], ['Parasaurolophus', 2, 4, 4], ['Psittacosaurus', 3, 5, 3],
    ['Triceratops', 1, 2, 3], ['Stegosaurus', 1, 2, 2], ['Ankylosaurus', 1, 2, 2],
    ['Velociraptor', 3, 4, 3], ['Deinonychus', 2, 3, 2], ['Dilophosaurus', 2, 3, 3], ['Allosaurus', 1, 1, 2], ['Spinosaurus', 1, 1, 1],
  ];
  for (const [sp, lo, hi, groups] of herds) {
    const danger = ['Velociraptor', 'Deinonychus', 'Dilophosaurus', 'Allosaurus', 'Spinosaurus'].includes(sp);
    for (let g = 0; g < groups; g++) {
      let x = 0, z = 0, ok = false;
      for (let k = 0; k < 200; k++) {
        x = (rnd() * 2 - 1) * (H - 30); z = (rnd() * 2 - 1) * (H - 30);
        const bd = Math.min(...MAP.bases.map(([bx, bz]) => Math.hypot(x - bx, z - bz)));
        if (bd < (danger ? 150 : 110)) continue;          // herds roam ~30 m around home: keep them clear of the bases
        if (forestDensity(x, z) > 0.35) continue;
        ok = true; break;
      }
      if (!ok) continue;
      const n = lo + Math.floor(rnd() * (hi - lo + 1));
      for (let i = 0; i < n; i++) animals.push({ species: sp, x: x + (rnd() - 0.5) * 12, z: z + (rnd() - 0.5) * 12, home: [x, z] });
    }
  }
  return { trees, decor, stones, bushes, animals };
}
