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
//   defaultCamera  the level's camera angle (radians, the map's DefaultCamera; the game's default 0.785)
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
//   origin      original maps: [ox, oy] with game x = map x - ox, game z = map y - oy (the game's map space is
//               left-handed: x east, y SOUTH, z up - docs/MAP_FORMAT.md; three.js is right-handed with -z north)
// Game coordinates: x east, z south, y up, (0, 0) = centre of the world.
import { MAP, MAX_PLAYERS, setPlayers, heightFn, splatFn, generate } from '../mapgen.js';
import { fbm } from '../../engine/terrain.js';
import { forestItems, forestKinds } from './forest.js';
import { weatherProgram } from '../systems/landmarks.js';
import { mapHeading } from './frame.js';

// ---------------------------------------------------------------- the random jungle map
export function generatedSource(cfg) {
  setPlayers(cfg.slots ? cfg.slots.filter((s) => s.type !== 'closed').length : 2);
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
    trees: gen.trees.map((t) => {
      const big = !/_med_/.test(t.model), num = t.model.slice(-2);
      return { ...t, stump: big ? `jungle_tree_${num}_stump` : 'jungle_tree_01_stump', timber: null, big };
    }),
    decor: gen.decor, stones: gen.stones.map((s) => ({ ...s, model: 'resource_stone_jun', amount: 2000 })),
    bushes: gen.bushes.map((b) => ({ ...b, model: 'jungle_fruit_bush', amount: 150 })),
    fish: [], plants: [],
    animals: gen.animals, starts: MAP.bases, bases: MAP.bases, models,
    startSlots: MAP.bases.map((b, i) => i), mp: { maxPlayers: MAX_PLAYERS, gameTypes: ['Deathmatch'], lastManStanding: false, multiplayer: true, defenderTimer: 0, slots: {} }, owned: [], flags: [],
    skirt: true,
  };
}

// the level's items (Root/Items: Pool - the item classes a random spawn takes from - and MaxItems)
function itemPool(tree) {
  const sub = (n, name) => (n && n.subs || []).find((s) => s.name === name);
  const it = sub(tree, 'Items');
  return { pool: ((sub(it, 'Pool') || {}).subs || []).map((s) => s.name.toLowerCase()), max: +((sub(it, 'MaxItems') || {}).value) || 0 };
}
// the ground material of the ambience (engine/atmo.js) at game (x, z): the 32 m square's most frequent 4 m ground
// material (0 .. 7; outside the map 2), 8 where the square is a forest block with more than half of its 15 trees
// standing (PWClient.exe CAtmoSoundMgr 0x4331b0, 0x6d87e0, 0x6d3e00; the map's forest as it was saved)
function soundMaterial(md, ox, oy) {
  const MT = md.mats, mx = md.mx, my = md.my, forest = new Set();
  if (md.forest) for (const b of md.forest.blocks) { let n = 0; for (let k = 0; k < 15; k++) if ((b.b[k] & 0x60) === 0x40) n++; if (n / 15 > 0.5) forest.add(b.y * 100000 + b.x); }
  return (x, z) => {
    const ci = Math.floor((x + ox) / 32), cj = Math.floor((z + oy) / 32);
    if (forest.has(cj * 100000 + ci)) return 8;
    if (!MT || ci < 0 || cj < 0 || ci * 8 >= mx || cj * 8 >= my) return 2;
    const n = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const a = ci * 8 + i, b = cj * 8 + j;
      n[a < mx && b < my ? MT[b * mx + a] & 7 : 2]++;
    }
    let best = 0;
    for (let k = 1; k < 8; k++) if (n[k] > n[best]) best = k;
    return best;
  };
}

// ---------------------------------------------------------------- original maps
const lc = (s) => String(s || '').toLowerCase();

// big landscape pieces that units can't walk through
const SOLID = /rock|plateau|cliff|mountain|stone(?!_jun)|ruin|pillar|wall|temple|monument|archway|statue|head|coffin|stoneglobe|waterfall|berg|basalt|arc0|wreck|crater|dead_tree|log/;
const NO_PROP = /^(startlocation|itemspawn|domination_flag|questmark|region)/;

// a choppable tree of a model: the wood it gives (settings/Resources.txt, WOOD "<model>_timber": 300 for most trees,
// 150 the medium jungle trees and larches, 100 bamboo and dead trees, 250 beach palms, 400 the Ash Valley trees, 500 the
// beech; 300 for a model without an entry), its stump and fallen-trunk models, and whether it is a big one
// maps without the editor's pathfinder grid (the sequel's, the random ones): land units walk where the ground is
// not steeper than maxDeg - the largest rise over the edges and diagonals of the 2 m cell around (x, z). The original
// editor's grid is close to a 22 degree rule (docs/MAP_FORMAT.md "PaFi"); the made maps have gentle hills and dunes
// meant to be walked and cliffs of 40 degrees and more, so their rule is 32 degrees.
export const MAX_SLOPE = 32;
export function slopeWalkable(height, maxDeg = MAX_SLOPE) {
  const lim = Math.tan(maxDeg * Math.PI / 180);
  return (x, z) => {
    const a = height(x - 1, z - 1), b = height(x + 1, z - 1), c = height(x + 1, z + 1), d = height(x - 1, z + 1);
    const m = Math.max(Math.abs(a - b), Math.abs(b - c), Math.abs(c - d), Math.abs(d - a)) / 2;
    return Math.max(m, Math.abs(a - c) / 2.83, Math.abs(b - d) / 2.83) <= lim;
  };
}

// Root/Base (MaxPlayers, GameType "Deathmatch|Domination|", LastManStanding, MapType, DefenderTimer) and per start slot
// Root/PlayerSettings/Player_<n>/Restrictions (Base/Tribes "Hu:Aje:", DefTeam, Resources/<res>, Chars/Population/Max)
export function mpSettings(md) {
  const d = md.description || {}, base = (k) => d['Root/Base/' + k];
  const slots = {};
  for (const k in d) {
    const m = /^Root\/PlayerSettings\/Player_(\d+)\/(.+)$/.exec(k);
    if (!m) continue;
    const sl = slots[m[1]] || (slots[m[1]] = { tribes: null, team: null, res: {}, popMax: null });
    const v = d[k], key = m[2];
    if (key === 'Restrictions/Base/Tribes') sl.tribes = String(v).split(':').filter(Boolean);
    else if (key === 'Restrictions/Base/DefTeam') sl.team = +v || null;
    else if (key === 'Restrictions/Chars/Population/Max') sl.popMax = +v || null;
    else { const r = /^Restrictions\/Resources\/(food|wood|stone|iron)$/.exec(key); if (r) sl.res[r[1] === 'iron' ? 'skulls' : r[1]] = +v || 0; }
  }
  return {
    maxPlayers: +base('MaxPlayers') || md.maxPlayers || 2,
    gameTypes: String(base('GameType') || 'Deathmatch|').split('|').filter(Boolean),
    lastManStanding: String(base('LastManStanding')) === '1',
    multiplayer: String(base('MapType') || 'multiplayer') === 'multiplayer',
    defenderTimer: +base('DefenderTimer') || 0,
    slots,
  };
}

function aiOptions(desc) {
  const out = {};
  for (const k in desc || {}) { const m = /^Root\/AIOptions\/(\w+)$/.exec(k); if (m) out[m[1]] = String(desc[k]) === '1'; }
  return Object.keys(out).length ? out : null;
}

export function treeOf(g, D, has) {
  return {
    wood: (D && D.resourceValue && D.resourceValue('WOOD', g + '_timber')) || 300,
    stump: has(g + '_stump') ? g + '_stump' : null, timber: has(g + '_timber') ? g + '_timber' : null,
    big: !/_med_|bamboo|dead/.test(g),
  };
}

// D = Rules (tech tree + class data), md = parsed map (maps/ula.js), cfg = skirmish setup
export function originalSource(md, D, cfg, manifest) {
  const W2 = md.hx * 2, H2 = md.hy * 2;                    // terrain extent (m)
  const size = Math.ceil(Math.max(W2, H2) / 16) * 16;
  const ox = W2 / 2, oy = H2 / 2;
  const toGame = (mx, my) => [mx - ox, my - oy];
  const has = (m) => !!(m && manifest[m]);
  const gfxOf = (cls) => { const c = lc(cls); const g = D.classGfx(c) || c; return has(g) ? g : has(c) ? c : null; };
  const scriptOf = (cls) => D.script(lc(cls)) || '';

  // heights: bilinear on the 2 m grid
  const hx = md.hx, hy = md.hy, HS = md.heights;
  const height = (x, z) => {
    let fx = (x + ox) / 2, fy = (z + oy) / 2;
    fx = Math.max(0, Math.min(hx - 1.001, fx)); fy = Math.max(0, Math.min(hy - 1.001, fy));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const a = HS[j * hx + i], b = HS[j * hx + i + 1], c = HS[(j + 1) * hx + i], d = HS[(j + 1) * hx + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  // ground materials on the 4 m grid -> 8 weights. The lookup point is shifted by a smooth noise (up to ~3 m) and
  // four taps are averaged, so material borders are irregular and round instead of following the 4 m grid.
  const mx = md.mx, my = md.my, MT = md.mats;
  const tap = (w, x, z, k) => {
    const fx = Math.max(0, Math.min(mx - 1.001, (x + ox) / 4 - 0.5)), fy = Math.max(0, Math.min(my - 1.001, (z + oy) / 4 - 0.5));
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

  const trees = [], decor = [], stones = [], bushes = [], fish = [], animals = [], starts = [], nests = [], wells = [], lakes = [], items = [], itemSpawns = [];
  const owned = [], flags = [];          // skirmish: the players' objects of the map (by start slot), domination flags
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
        const t = treeOf(g, D, has);
        trees.push({ ...t, model: use(g), x, z, rot: mapHeading(o.rot), scale: 1, inside: inside(x, z, 2), stump: use(t.stump), timber: use(t.timber) });
        break;
      }
      case 'STON': if (g) stones.push({ model: use(g), x, z, rot: mapHeading(o.rot), amount: +o.attr.hitpoints || 2000 }); break;
      case 'FRUI':
        if (script === 'CFishShoal' || /fish/i.test(cls)) fish.push({ model: g ? use(g) : null, x, z, amount: Math.min(+o.attr.hitpoints || 1000, 2500) });
        else if (g) bushes.push({ model: use(g), x, z, rot: mapHeading(o.rot), amount: +o.attr.hitpoints || 150 });
        break;
      case 'NEST': {
        // Nest.usl: on the level's start ceil(advance_time / spawn_rate) animals (by spawn_max and spawn_amount) were
        // born before - one spawn_rate after the other - and stand somewhere in the nest's action area; then one every
        // spawn_rate s while fewer than spawn_max live (systems/animals.js wildNestsUpdate). The nest's areas are the
        // map's regions "<nest>_ActionArea", "_SafeArea" and "_HotspotArea".
        const sp = o.attr.spawn_type || (D.extra.nests || {})[lc(cls)] || null;
        if (!sp || !D.exists(sp)) break;
        const max = o.attr.spawn_max == null || o.attr.spawn_max === '' ? 3 : Math.max(0, +o.attr.spawn_max);
        const rate = Math.max(5, +o.attr.spawn_rate || 60);
        const amount = o.attr.spawn_amount == null || o.attr.spawn_amount === '' ? -1 : +o.attr.spawn_amount;
        const advance = +o.attr.advance_time || 0;
        let n = advance > 0 && amount !== 0 ? Math.min(max, Math.ceil(advance / rate)) : 0;
        if (amount >= 0) n = Math.min(n, amount);
        const swim = /swim/i.test(cls) || script === 'CSwimmingNest';
        const area = (suffix) => {
          const r = (md.regions || []).find((g) => g.name === o.name + suffix);
          return r ? r.shapes.filter((q) => q.enabled !== false).map((q) => { const [x0, z0] = toGame(q.x, q.y); return { oval: q.oval, x0, z0, x1: x0 + q.w, z1: z0 + q.h }; }) : null;
        };
        const table = String(o.attr.hotspot_timetable || '').split('\n').map((l) => l.split('\t').map(Number)).filter((e) => e.length >= 3 && e.every(Number.isFinite));
        const nest = { name: o.name, species: sp, x, z, max, rate, amount: amount < 0 ? -1 : amount - n, swim,
          grown: +o.attr.spawn_grown === 1, areas: { action: area('_ActionArea'), safe: area('_SafeArea'), hotspot: area('_HotspotArea') || [] }, table, start: [] };
        for (let k = 0; k < n; k++) nest.start.push({ species: sp, swim, born: -advance + k * rate });
        nests.push(nest);
        use(lc(D.stats(sp, 1, null)?.gfx));
        break;
      }
      case 'ANML': if (o.owner == null && D.exists(cls)) { animals.push({ species: cls, x, z, home: [x, z] }); use(lc(D.stats(cls, 1, null)?.gfx)); } break;
      case 'DCCO': case 'DECO': case 'VGTN': case 'WOOD':
        if (g && !NO_PROP.test(g)) decor.push({ model: use(g), x, z, rot: mapHeading(o.rot), q: o.q, scale: 1, block: o.type === 'DCCO' || SOLID.test(g), y: o.z, sprites: true });
        break;
      // healing wells (CFountain) and lakes of healing / damage (CLakeOf*: invisible, a region of the map): the
      // game's setup makes them (systems/landmarks.js)
      case 'FNTN': if (g) wells.push({ model: use(g), cls, x, z, y: o.z, rot: mapHeading(o.rot), q: o.q, attr: o.attr }); break;
      case 'DMGL':
        lakes.push({ name: o.name, region: o.attr.region_name || '', heal: script === 'CLakeOfHealing', amount: +o.attr.damage_per_tick || 0, types: o.attr.damage_types || '' });
        break;
      // placed effects (CFX: the heal areas, the holy forest). A heal glow that was on a unit when the map was saved
      // (fx_heal_passive: FightingObj.HealMe, gone 2.5 s later) is not shown. (Plain scenery without a type - CGameObj:
      // sandbags, fishing nets - is not found by maps/ula.js objects, which looks for the type tag.)
      // items (artefacts) lying on the map, and the spawns that put the level's items there (systems/items.js)
      case 'ITEM': items.push({ cls: lc(cls), x, z, rot: mapHeading(o.rot) }); use('item_treasure_chest'); break;
      case 'ITSP':
        itemSpawns.push({ x, z, rot: mapHeading(o.rot), items: String(o.attr.spawn_items || '').split('|').map((c) => c.trim()).filter(Boolean),
          always: o.attr.generate_always === '1' || o.attr.generate_always === 'true', random: o.attr.random_item === '1' || o.attr.random_item === 'true' });
        use('item_treasure_chest');
        break;
      case 'CFXE':
        if (g && !NO_PROP.test(g) && !/^fx_heal_passive$/.test(g)) decor.push({ model: use(g), x, z, rot: mapHeading(o.rot), q: o.q, scale: 1, block: SOLID.test(g), y: o.z, sprites: true });
        break;
      // the domination flags (DOFL; GameOverMgr: only in the Domination game type - game/systems/gameover.js)
      case 'DOFL': flags.push({ name: o.name, cls: lc(cls), model: use(g || 'domination_flag'), x, z, rot: mapHeading(o.rot) }); break;
      // a skirmish map's buildings and units of a start slot (the defender's fortress ...): the player on that start
      // location gets them (ServerApp: the owner is the head quarter index); those of no player stay nobody's
      // (houses, fences, a pirate ship: owner null)
      case 'BLDG': case 'CHTR': case 'VHCL': case 'SHIP':
        if (!skip && D.exists(cls)) { owned.push({ type: o.type, cls: lc(cls), x, z, rot: mapHeading(o.rot), owner: o.owner ?? null, level: (o.level || 0) + 1, attr: o.attr || {} }); use(lc(D.stats(cls, 1, null)?.gfx)); }
        // a class the tech tree does not know (the editor's houses, Darwin's tree house): its model as scenery, as
        // the campaign shows them (campaign/setup.js); the engine's helpers (Virtual_Produce_Unit) stay invisible
        else if (!skip && g && !/^virtual_produce_unit$/i.test(cls) && !NO_PROP.test(g)) decor.push({ model: use(g), x, z, rot: mapHeading(o.rot), q: o.q, scale: 1, block: true, y: o.z, sprites: true });
        break;
      default: break;                                       // units / buildings of campaign maps, item spawns
    }
  }
  // landscape decoration instances (IOMG): plants, rocks, plateaus
  for (const p of md.plants) {
    const g = gfxOf(p.name);
    if (!g || NO_PROP.test(g)) continue;
    const [x, z] = toGame(p.x, p.y);
    decor.push({ model: use(g), x, z, rot: mapHeading(p.rot), scale: 1, block: SOLID.test(g), y: p.z, sprites: true });
  }
  // forest blocks (maps/forest.js): the trees and undergrowth of the map's 32 m forest squares. A forest tree is a
  // tree like the placed ones - the original turns it into a <Setting>_Tree_0N_Timber object when it is chopped.
  const kinds = forestKinds(md.settingName || md.setting);
  if (kinds && md.forest && md.forest.blocks.length && !(cfg && cfg.noForest)) {
    const fi = forestItems(md, (mx_, my_) => height(mx_ - ox, my_ - oy));
    const tk = kinds.trees.map((k) => {
      const g = k && gfxOf(k.standard);
      if (!g) return null;
      const t = treeOf(g, D, has), stump = k.stump && gfxOf(k.stump), timber = k.timber && gfxOf(k.timber);
      return { ...t, model: use(g), stump: use(stump || t.stump), timber: use(timber || t.timber) };
    });
    for (const t of fi.trees) {
      const k = tk[t.kind];
      if (!k) continue;
      const [x, z] = toGame(t.x, t.y);
      trees.push({ model: k.model, x, z, rot: mapHeading(t.rot), scale: 1, wood: k.wood, inside: inside(x, z, 2), stump: k.stump, timber: k.timber, big: k.big, forest: true });
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
    // wall grid: tile centres at map x ≡ 4, y ≡ 4 (mod 8) -> game x = mx - ox, z = my - oy (docs/spec/walls.md §2)
    wallGrid: [(((4 - ox) % 8) + 8) % 8, (((4 - oy) % 8) + 8) % 8],
    size, meshCell: size > 1400 ? 4 : 2, play, water: md.water,
    origin: [ox, oy],                 // map (x, y) -> game (x - ox, y - oy)
    height,
    // can the terrain at game (x, z) be walked on (the map's pathfinder grid, maps/ula.js pathing); null = not known
    walkable: md.walk ? (x, z) => {
      const i = Math.floor((x + ox) / 2), j = Math.floor((z + oy) / 2), g = md.walk;
      return i >= 0 && j >= 0 && i < g.w && j < g.h && g.cells[j * g.w + i] === 1;
    } : null,
    textures: [0, 1, 2, 3, 4, 5, 6, 7].map((k) => `${md.setting}/scape_${k}.jpg`), scales: [0, 1, 2, 3, 4, 5, 6, 7].map(() => [1 / 24, 1 / 24]),
    splat, defaultCamera: md.defaultCamera, startTime: md.startTime,
    // the names the music picks its playlist by (engine/music.js): Root/Base/LevelName and material_atmos
    levelName: (md.description && md.description.LevelName) || md.name, atmos: (md.description && md.description.material_atmos) || '',
    // what the level tells the computer players (Root/AIOptions: walls, harbour, watermap, hunt_animals ...)
    aiOptions: aiOptions(md.description),
    trees, decor, stones, bushes, fish, plants: [], animals, nests, starts: starts.map((s) => [s.x, s.z]), bases, models, skirt: false,
    // healing wells, lakes, the map's regions (map coordinates: campaign/regions.js) and its weather program
    wells, lakes, regions: md.regions || [], weather: weatherProgram(md.infoTree),
    items, itemSpawns, itemPool: itemPool(md.infoTree),
    // skirmish: the start slots (the HQ index of each start location), the map's multiplayer settings, the players'
    // objects and the domination flags
    startSlots: starts.map((s) => s.slot), mp: mpSettings(md), owned, flags,
    soundMat: soundMaterial(md, ox, oy),
    noise: (x, z) => fbm(x * 0.05, z * 0.05, 3, 2),
  };
}
