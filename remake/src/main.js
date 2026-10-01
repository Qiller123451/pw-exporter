import { colorById, hex, NEUTRAL_UI } from './game/colors.js';
import { watchRenderer, loopError, report, reportError, setReportContext, watchGlobalErrors } from './ui/diagnostics.js';
import * as THREE from 'three';
import { Renderer, RTSCamera } from './engine/renderer.js';
import { initAssets, loadModel, Assets } from './engine/assets.js';
import { HeightField, buildTerrain, FogOfWar } from './engine/terrain.js';
import { PropField, FoliageField, treeSprites, holeUniforms, spriteLight } from './engine/props.js';
import { FX } from './engine/fx.js';
import { Audio } from './engine/audio.js';
import { Feedback } from './ui/feedback.js';
import { Rules } from './game/rules.js';
import { World } from './game/world.js';
import { Player } from './game/player.js';
import { generatedSource, originalSource } from './game/maps/source.js';
import { parseUla } from './game/maps/ula.js';
import { buildWater } from './engine/water.js';
import { GrassLayer, GRASS_DENSITY } from './engine/grass.js';
import { TribeAI } from './game/ai.js';
import { initAtlas, preloadAtlasImages } from './ui/atlas.js';
import { HUD } from './ui/hud.js';
import { Input } from './ui/input.js';
import { Overlay, Minimap } from './ui/overlay.js';
import { Menu, loadSettings, saveSettings, TRIBE_INFO } from './ui/menu.js';

const params = new URLSearchParams(location.search);
const MANUAL = params.has('manual');
// what a copied error report carries besides the error itself
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';
setReportContext(() => {
  const c = G.config || {};
  return [`build ${BUILD}`, `browser ${navigator.userAgent}`, `gpu ${G.gpu || '?'}`,
    `game: ${c.me || '?'} vs ${c.ai || '?'}, map ${c.map || 'random jungle'}${c.map ? '' : ', seed ' + c.seed}, ` +
    `time ${G.world ? G.world.time.toFixed(1) + ' s' : '-'}, units ${G.world ? G.world.units.length : '-'}`].join('\n');
});
if (!MANUAL) watchGlobalErrors();
const REASON = {
  req: 'Requirements not met', cost: 'Not enough resources', housing: 'Population limit reached – build more housing',
  level: 'No free slot at this level of the army pyramid', full: 'Production queue is full', done: 'Already researched',
  place: 'Cannot build here', skulls: 'Not enough skulls', max: 'Already at the highest level',
  cooldown: 'Still recharging', unique: 'You already have this hero', target: 'Choose a target', storage: 'Storage is full',
  busy: 'Busy', illusion: 'Illusions cannot do that', hidden: 'Not available', disabled: 'Not available',
};
const EPOCH = ['', 'I', 'II', 'III', 'IV', 'V'];

const G = window.G = {
  THREE,
  settings: loadSettings(),
  sel: new Set(),
  paused: false,
  menuOpen: false,
  pings: [],
  over: false,
};

// ---------------------------------------------------------------------------- loading
const loadEl = document.getElementById('loading');
const loadBar = document.getElementById('loadbar');
const loadTxt = document.getElementById('loadtxt');
function progress(k, text) { loadBar.style.width = Math.round(k * 100) + '%'; if (text) loadTxt.textContent = text; }

// core data: rules (tech tree), extra tables, asset manifest, HUD atlas, sound events
async function loadCore() {
  progress(0.02, 'Reading game data…');
  G.audio = new Audio('assets/');
  const [json, tt] = await Promise.all([
    fetch('gamedata.json').then((r) => r.json()), fetch('techtree.json').then((r) => r.json()),
    initAssets('assets/'), initAtlas('assets/ui/'), G.audio.load(),
  ]);
  G.data = new Rules(tt, json);
  await preloadAtlasImages();
  Input.loadCursors('assets/ui/');
}
// models of the chosen tribes (plus heroes, animals, props and everything shared), with their animation sources
const TRIBE_PREFIX = { Hu: 'hu_', Aje: 'aje_', Ninigi: 'ninigi_', SEAS: 'seas_' };
// Map objects (landscape archives: trees, rocks, plants, ruins, campaign buildings - flagged "map" in the manifest by
// tools/build_assets.py) and the wild animals are only loaded when the map uses them (need = MapSource.models).
const LANDSCAPE = /^(jungle|northland|savanna|icewaste|ashvalley|cave\d)_(vegetation|landobj)$|^seas_temple_ruins$/;   // manifests without the flag
async function loadModels(tribes, need = new Set()) {
  const skip = Object.entries(TRIBE_PREFIX).filter(([t]) => !tribes.includes(t)).map(([, p]) => p);
  const M = Assets.manifest.models;
  const D = G.data;
  const wild = new Set();
  for (const [name, ix] of D.index) if (ix.tribe === 'World' && ix.type === 'ANML') { const s = D.stats(name, 1, null); if (s && s.gfx) wild.add(s.gfx.toLowerCase()); }
  // ... except models the tribes use themselves (e.g. a tribe's mount that is also a wild species)
  for (const [name, ix] of D.index) {
    if (ix.tribe === 'World') continue;
    for (let l = 1; l <= 5; l++) { const s = D.stats(name, l, null); if (s && s.gfx) wild.delete(s.gfx.toLowerCase()); }
    const cg = D.classGfx(name); if (cg) wild.delete(cg);
  }
  const optional = (n) => M[n].map || LANDSCAPE.test(M[n].arch) || wild.has(n);
  const want = new Set(Object.keys(M).filter((n) => !skip.some((p) => n.startsWith(p)) && (!optional(n) || need.has(n))));
  for (const n of need) if (M[n]) want.add(n);
  for (const n of [...want]) if (M[n].anims) want.add(M[n].anims.toLowerCase());
  // keep the anim packs other tribes' units borrow (e.g. seas_worker animates with hu_worker_s1)
  const animated = new Set();
  for (const [name, ix] of D.index) {
    if (ix.type === 'BLDG') continue;
    for (let l = 1; l <= 5; l++) { const s = D.stats(name, l, null); if (s && s.gfx) animated.add(s.gfx.toLowerCase()); }
  }
  for (const k in M) { const a = M[k].anims; if (a) animated.add(a.toLowerCase()); if (/_rider_|_crane_|collector_[a-e]$|_rally_point/.test(k)) animated.add(k); }
  // wall pieces: arms tagged by direction (assets.js tagWallArms; towers and traps are not wall pieces)
  const walls = new Set();
  for (const [name, ix] of D.index) if (ix.type === 'BLDG') {
    const d = D.def(name, null);
    if (d && d.wallKind === 'wall') for (let l = 1; l <= 5; l++) { const s = D.stats(name, l, null); if (s && s.gfx) walls.add(s.gfx.toLowerCase()); }
  }
  const names = [...want].filter((n) => M[n]);
  G.templates = G.templates || new Map();
  let done = 0;
  const queue = names.filter((n) => !G.templates.has(n));
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift();
      try { G.templates.set(n, await loadModel(n, { static: !animated.has(n), wallArms: walls.has(n) || /^(hu_small_wall|hu_re_enforced_wall)$/.test(n) })); } catch (e) { console.warn('model failed', n, e); }
      done++;
      progress(0.05 + 0.8 * done / names.length, `Loading models ${done} / ${names.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
}
function tpl(name, soft) {
  const t = name && G.templates.get(name.toLowerCase());
  if (!t && !soft) throw new Error('missing model ' + name);
  return t || null;
}

// ---------------------------------------------------------------------------- world setup
const spriteTex = new Map();
function spriteTexture(uri) {
  const file = String(uri || '').split('/').pop();
  if (spriteTex.has(file)) return spriteTex.get(file);
  const t = new THREE.TextureLoader().load('assets/tex/' + file);
  t.flipY = false;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  spriteTex.set(file, t);
  return t;
}

// minimap colour of each ground texture: the setting's averages (tools/build_terrain.py) or the source's own
async function minimapColors(S) {
  if (S.minimapColors) return S.minimapColors;
  try { return (await (await fetch(`assets/terrain/${S.setting}/setting.json`)).json()).minimap; } catch (e) { return null; }
}
// Build the world from a map source (game/maps/source.js): terrain, water, landscape objects, resources.
async function buildWorld(cfg, S) {
  progress(0.87, `Building ${S.name}…`);
  const canvas = document.getElementById('game');
  G.canvas = canvas;
  G.mapSource = S;
  const R = G.renderer = new Renderer(canvas, G.settings);
  G.gpu = watchRenderer(R.renderer);
  const scene = G.scene = R.scene;
  G.camera = R.camera;
  const hf = G.hf = new HeightField(S.size, S.meshCell, S.height);
  const height = (x, z) => hf.at(x, z);
  const tl = new THREE.TextureLoader();
  const ld = (f) => tl.loadAsync('assets/terrain/' + f).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; });
  // ground textures rebuilt from the original scape atlases (tools/build_terrain.py)
  let terrainTex, scales = S.scales;
  try { terrainTex = await Promise.all(S.textures.map(ld)); } catch (e) {
    terrainTex = await Promise.all((S.fallbackTextures || ['grass_green.jpg', 'grass_yellow.jpg', 'dirt.jpg', 'rock.jpg']).map(ld)); scales = undefined;
  }
  const splat = S.splat(hf);
  const terrain = await buildTerrain(hf, splat, terrainTex, { scales });
  scene.add(terrain);
  if (S.skirt) {
    // ground skirt beyond the map edge
    const shape = new THREE.Shape([new THREE.Vector2(-3000, -3000), new THREE.Vector2(3000, -3000), new THREE.Vector2(3000, 3000), new THREE.Vector2(-3000, 3000)]);
    const e = S.size / 2 - 2;
    shape.holes.push(new THREE.Path([new THREE.Vector2(-e, -e), new THREE.Vector2(-e, e), new THREE.Vector2(e, e), new THREE.Vector2(e, -e)]));
    const skirt = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2c3f1c }));
    skirt.position.y = height(e, 0) - 1;
    scene.add(skirt);
  }
  if (S.water != null) {
    let nm = null;
    try { nm = await tl.loadAsync('assets/terrain/water_normal.png'); } catch (e) { nm = null; }
    G.water = buildWater(hf, S.water, nm);
    scene.add(G.water);
  }

  G.fow = new FogOfWar(S.size, 4);
  if (params.has('reveal')) G.fow.revealAll = true;
  G.props = new PropField(scene);
  G.foliage = new FoliageField(scene, 64);
  G.foliage.light.set(0.86, 0.9, 0.8);
  spriteLight.copy(G.foliage.light);              // 2D parts of buildings (lanterns) lit like the foliage
  G.fx = new FX(scene, height);
  G.audio.muted = !G.settings.sound;
  G.feedback = new Feedback(G);
  const P = S.play;
  const W = G.world = new World({
    scene, data: G.data, templates: tpl, height, size: S.size, play: P, wallGrid: S.wallGrid,
    playHalf: Math.min(P.x1 - P.x0, P.z1 - P.z0) / 2, water: S.water, setting: S.setting,
    fx: G.fx, audio: G.audio, props: G.props, foliage: G.foliage, fow: G.fow,
    rules: { warpgate: cfg.warpgate !== false, warpgateMinutes: cfg.warpgateMinutes || 10 },
  });
  // keep units inside the playable area and out of the water (ships use their own grid, see nav.water)
  const nav = W.nav;
  for (let j = 0; j < nav.n; j++) for (let i = 0; i < nav.n; i++) {
    const [x, z] = nav.center(j * nav.n + i);
    if (x < P.x0 + 2 || x > P.x1 - 2 || z < P.z0 + 2 || z > P.z1 - 2) nav.block[j * nav.n + i]++;
  }
  if (S.water != null) W.markWater(S.water);

  // ---------------------------------------------------------------- map content
  const kinds = new Set();
  const kind = (name, opts) => { if (!kinds.has(name)) { kinds.add(name); G.props.addKind(name, tpl(name), opts); } return name; };
  const bboxR = new Map();
  const radiusOf = (name) => {
    if (!bboxR.has(name)) { const b = new THREE.Box3().setFromObject(tpl(name).scene); bboxR.set(name, Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2); }
    return bboxR.get(name);
  };
  const brnd = (() => { let a = 99; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const addSprites = (model, x, y, z, rot, scale, opts) => {
    const handles = [];
    const t = tpl(model, true);
    if (!t) return handles;
    for (const [uri, list] of treeSprites(t.extras, x, y, z, rot, scale, opts)) handles.push(G.foliage.add(spriteTexture(uri), list));
    return handles;
  };
  // fruit bush: the original sprite layers (leaves + fruit) drawn from jng_misc_a
  const miscTex = spriteTexture('jng_misc_a.png');
  const LEAF = [[0.5, 0.5, 0.75, 0.75], [0.75, 0.5, 1, 0.75]], FRUIT = [[0.75, 0.125, 0.875, 0.25], [0.875, 0.125, 1, 0.25]];
  const fruitBushSprites = (x, y, z, rot) => {
    const ex = tpl('jungle_fruit_bush').extras;
    const s = Math.sin(rot), c = Math.cos(rot), list = [];
    for (const f of (ex && ex.foliage) || []) {
      const fruit = f.size <= 2.01;
      for (let i = 0; i < f.pts.length; i += 3) {
        const lx = f.pts[i], ly = f.pts[i + 2], lz = -f.pts[i + 1];
        const k = Math.floor(brnd() * 2);
        list.push({ x: x + lx * c + lz * s, y: y + ly + (fruit ? 0.1 : 0), z: z - lx * s + lz * c, size: fruit ? 0.55 + brnd() * 0.3 : f.size * 0.55,
          uv: fruit ? FRUIT[k] : LEAF[k], detail: fruit ? false : i % 2 === 1, tint: fruit ? 0.9 : 0.35 + Math.min(1, ly / 2) * 0.5 + brnd() * 0.15 });
      }
    }
    // leaves first, then fruit (drawn on top within the chunk)
    list.sort((a, b) => (a.size < 1 ? 1 : 0) - (b.size < 1 ? 1 : 0));
    return [G.foliage.add(miscTex, list)];
  };
  const timbers = ['jungle_tree_01_timber', 'jungle_tree_02_timber'].filter((n) => tpl(n, true));
  for (const t of S.trees) {
    if (!tpl(t.model, true)) continue;
    const y = height(t.x, t.z);
    kind(t.model, { holes: true });
    const ph2 = G.props.add(t.model, t.x, y, t.z, t.rot, t.scale);
    const sh = addSprites(t.model, t.x, y, t.z, t.rot, t.scale);
    const big = t.big !== false;
    const cells = nav.markCircle(t.x, t.z, (big ? 1.6 : 1.1) * t.scale);
    if (!t.inside) continue;
    const stump = t.stump && tpl(t.stump, true) ? kind(t.stump, {}) : tpl('jungle_tree_01_stump', true) ? kind('jungle_tree_01_stump', {}) : null;
    const tm = t.timber && tpl(t.timber, true) ? t.timber : timbers.length ? timbers[Math.floor(brnd() * timbers.length)] : null;
    const timber = tm ? kind(tm, {}) : null;
    W.addResource('tree', 'wood', t.x, t.z, t.wood, {
      radius: big ? 1.5 : 1.1, propHandle: ph2, spriteHandles: sh, cells, stumpKind: stump, timberKind: timber,
      rot: t.rot, scale: big ? t.scale : t.scale * 0.65, name: t.model, maxWorkers: 4,
    });
  }
  // undergrowth: camera-facing leaf sprites (same technique as the tree canopies)
  const bushTex = spriteTexture('jng_small_a.png');
  const BUSH_CELLS = [[0, 0.25, 0.25, 0.5], [0.25, 0.25, 0.5, 0.5], [0.5, 0.25, 0.75, 0.5], [0, 0.5, 0.25, 0.75], [0.25, 0.5, 0.5, 0.75], [0, 0, 0.25, 0.25], [0.25, 0, 0.5, 0.25]];
  for (const d of S.decor) {
    const y = d.y != null ? d.y : height(d.x, d.z);
    if (/^jungle_(bush_|underwood_|mountain_bush)/.test(d.model)) {
      const n = 6 + Math.floor(brnd() * 6), sc = d.scale * 1.3, list = [];
      const pal = Math.floor(brnd() * 3);    // leaves / ferns / mixed
      for (let i = 0; i < n; i++) {
        const a = brnd() * 6.283, r = brnd() * 1.5 * sc, hy = 0.35 + brnd() * 1.1 * sc;
        const cell = pal === 0 ? BUSH_CELLS[3 + Math.floor(brnd() * 2)] : pal === 1 ? BUSH_CELLS[Math.floor(brnd() * 3)] : BUSH_CELLS[Math.floor(brnd() * BUSH_CELLS.length)];
        list.push({ x: d.x + Math.cos(a) * r, y: y + hy, z: d.z + Math.sin(a) * r, size: (1.3 + brnd() * 1.1) * sc, uv: cell, detail: i >= 5, tint: Math.min(1, hy / (1.5 * sc)) * 0.7 + brnd() * 0.25 });
      }
      G.foliage.add(bushTex, list);
      continue;
    }
    if (/^jungle_(flowers|reed|wildrice|beachgrass)/.test(d.model)) {
      const FLOW = [[0.75, 0.25, 0.875, 0.375], [0.875, 0.25, 1, 0.375], [0.75, 0.375, 0.875, 0.5], [0.875, 0.375, 1, 0.5], [0.75, 0, 0.875, 0.125], [0.875, 0, 1, 0.125]];
      const list = [];
      const kindF = Math.floor(brnd() * 3);
      for (let i = 0; i < 3; i++) {
        const a = brnd() * 6.283, r = brnd() * 0.9;
        list.push({ x: d.x + Math.cos(a) * r, y: y + 0.45, z: d.z + Math.sin(a) * r, size: 1.4 + brnd() * 0.6, uv: LEAF[Math.floor(brnd() * 2)], detail: true, tint: 0.3 + brnd() * 0.2 });
      }
      for (let i = 0; i < 5; i++) {
        const a = brnd() * 6.283, r = brnd() * 1.1;
        list.push({ x: d.x + Math.cos(a) * r, y: y + 0.6 + brnd() * 0.4, z: d.z + Math.sin(a) * r, size: 0.6 + brnd() * 0.35, uv: FLOW[kindF * 2 + Math.floor(brnd() * 2)], detail: true, tint: 0.85 });
      }
      G.foliage.add(miscTex, list);
      continue;
    }
    if (!tpl(d.model, true)) continue;
    kind(d.model, { castShadow: d.block || /bush|underwood|tree/.test(d.model), holes: /tree|palm/.test(d.model) });
    G.props.add(d.model, d.x, y, d.z, d.rot, d.scale);
    addSprites(d.model, d.x, y, d.z, d.rot, d.scale, { ground: !/tree|palm|bamboo|deco/.test(d.model) });
    if (d.block) nav.markCircle(d.x, d.z, Math.min(24, radiusOf(d.model) * d.scale * 0.7));
  }
  for (const s of S.stones) {
    if (!tpl(s.model, true)) continue;
    const y = height(s.x, s.z);
    kind(s.model, {});
    const h = G.props.add(s.model, s.x, y, s.z, s.rot, 1);
    const r = Math.max(2, radiusOf(s.model) * 0.8);
    const cells = nav.markCircle(s.x, s.z, r * 0.85);
    W.addResource('stone', 'stone', s.x, s.z, s.amount || 2000, { radius: r, propHandle: h, cells, name: s.model, maxWorkers: 8 });
  }
  for (const b of S.bushes) {
    if (!tpl(b.model, true)) continue;
    const y = height(b.x, b.z);
    kind(b.model, {});
    const h = G.props.add(b.model, b.x, y, b.z, b.rot, 1);
    const sh = b.model === 'jungle_fruit_bush' ? fruitBushSprites(b.x, y, b.z, b.rot) : addSprites(b.model, b.x, y, b.z, b.rot, 1);
    const r = Math.max(1.2, radiusOf(b.model) * 0.7);
    const cells = nav.markCircle(b.x, b.z, r * 0.6);
    W.addResource('bush', 'food', b.x, b.z, b.amount || 150, { radius: r, propHandle: h, spriteHandles: sh, cells, name: b.model, maxWorkers: 4 });
  }
  // fish shoals: food in the water (fishing boats); shown as ripples in the water
  for (const f of S.fish) {
    const m = f.model && tpl(f.model, true) ? kind(f.model, {}) : null;
    const h = m ? G.props.add(m, f.x, S.water != null ? S.water - 0.3 : height(f.x, f.z), f.z, Math.random() * 6.28, 1) : null;
    W.addResource('fish', 'food', f.x, f.z, f.amount || 1000, { radius: 3, water: true, name: f.model || 'fish', propHandle: h, maxWorkers: 2 });
  }
  G.props.build();
  G.foliage.build();

  // ---------------------------------------------------------------- players
  // Start as in the original multiplayer default (StartLocation.usl + Game/misc/DefPresets.txt "_pb_locked"):
  // the tribe's base (fireplace / headquarters / resource collector), three workers, 200 food, 150 wood, 100 stone.
  const D = G.data;
  // party colours: chosen in the skirmish menu (or "none" = untinted models); the minimap uses the dark variant
  const pc = (id, fallback) => { const c = colorById(id); return { color: c ? hex(c.dark) : fallback, partyColor: c ? hex(c.light) : null }; };
  const me = G.me = new Player(0, cfg.me, { ...pc(cfg.meColor, NEUTRAL_UI.me), name: TRIBE_INFO[cfg.me].name, rules: D });
  const ai = G.ai = new Player(1, cfg.ai, { ai: true, ...pc(cfg.aiColor, NEUTRAL_UI.ai), name: TRIBE_INFO[cfg.ai].name, rules: D });
  W.players = [me, ai];
  me.debug = !!cfg.debug;                         // debug mode: free and instant (game/player.js)
  const homes = [];
  S.bases.forEach(([bx, bz], i) => {
    const p = W.players[i];
    const st = D.start(p.tribe);
    Object.assign(p.res, st.res);
    W.clearArea(bx, bz, 16);                     // original maps: no tree inside the start building
    const face = Math.atan2(-bx, -bz);          // look towards the map centre
    let base;
    if (D.info(st.base).type === 'BLDG') base = W.placeBuilding(st.base, p, bx, bz, Math.round(face / (Math.PI / 4)) * (Math.PI / 4), true);
    else base = W.spawnUnit(st.base, p, bx, bz, 1, face);
    homes.push(base);
    st.units.forEach((u, k) => {
      const a = face + Math.PI + (k - 1) * 0.5, r = base.radius + 5;
      W.spawnUnit(u, p, base.pos.x + Math.sin(a) * r, base.pos.z + Math.cos(a) * r, 1, face);
    });
    W.recomputeCaps(p);
  });
  const wildAt = (a) => {
    if (a.swim && !W.waterNav) return null;
    const u = W.spawnUnit(a.species, null, a.x, a.z, undefined, Math.random() * 6.28, a.swim ? { swim: true } : {});
    if (u) u.home.set(a.home[0], a.home[1]);
    return u;
  };
  for (const a of S.animals) wildAt(a);
  // nests of original maps keep respawning their animals
  for (const n of S.nests || []) {
    if (n.swim && !W.waterNav) continue;
    W.addWildNest({ ...n, members: n.start.map(wildAt).filter(Boolean) });
  }
  G.aiBrain = new TribeAI(G, ai, me, cfg.aiLevel);
  // test mode: the computer plays both sides (?aivai)
  if (params.has('aivai')) G.meBrain = new TribeAI(G, me, ai, cfg.aiLevel);
  const hq = homes[0];

  // ---------------------------------------------------------------- ground grass (engine/grass.js)
  // density per ground material x the map's material weights; none inside buildings, on blocked cells or cliffs
  const dens = S.kind === 'generated' ? [1.0, 0.75, 0.3, 0.15] : GRASS_DENSITY[S.setting];
  if (dens) {
    try {
      const gtex = await tl.loadAsync(`assets/terrain/${S.setting}/grass.png`);
      const inBuilding = (x, z) => { let hit = false; W.bHash.query(x, z, 30, (b) => { if (!hit && b.alive && Math.hypot(b.pos.x - x, b.pos.z - z) < b.radius * 0.95 + 0.5) hit = true; }); return hit; };
      G.grass = new GrassLayer(scene, {
        texture: gtex, height, water: S.water, light: G.foliage.light,
        density: (x, z) => {
          const w = splat(x, z);
          let d = 0, t = 0;
          for (let k = 0; k < w.length; k++) { d += w[k] * (dens[k] || 0); t += w[k]; }
          d = t > 0 ? d / t : 0;
          if (d <= 0.01 || hf.normalY(x, z) < 0.8 || !W.nav.isFree(x, z) || inBuilding(x, z)) return 0;
          return d * (G.settings.grass === 'dense' ? 1 : 0.55);
        },
      });
      G.grass.visible = G.settings.grass !== 'off';
    } catch (e) { console.warn('no grass:', e.message); G.grass = null; }
  }

  // ---------------------------------------------------------------- camera, UI
  G.rtscam = new RTSCamera(G.camera, height, S.size / 2 - 8);
  G.rtscam.x = hq.pos.x + 12; G.rtscam.z = hq.pos.z - 10; G.rtscam.yaw = 0;
  G.rtscam.update(0.016);
  G.overlay = new Overlay(G);
  G.input = new Input(G);
  G.hud = new HUD(G);
  G.minimap = new Minimap(G, G.hud.mmCanvas, S.size / 2);
  G.minimap.buildBackground(splat, height, S.trees.filter((t) => t.inside), await minimapColors(S), S.water);
  G.hud.perfEl.classList.toggle('hidden', !G.settings.perf);
  updateFow(true);
}

// ---------------------------------------------------------------------------- game API used by the HUD / input
// actions offered by an entity (tech tree /Actions/<tribe>/.../locations); hidden ones (visibility 0) are left out
G.producerActions = (e) => {
  if (!e || !e.alive || !e.owner || (e.kind === 'building' && !e.built)) return [];
  return G.data.actionsOf(e.rulesOwner(), e).filter((a) => a.cat !== 'Build/BLDG' && a.kind !== 'Moves' && a.visible && !a.disabled);
};
// rally points: only for what produces units (barracks, harbours, mobile camps ...) and the moving harbours -
// towers, walls, farms and the like have none
G.canRally = (e) => !!e && e.alive && e.owner === G.me && (
  (G.world.isMovingHarbour && G.world.isMovingHarbour(e) && e.built) ||
  G.producerActions(e).some((a) => a.kind === 'Build' && /^(CHTR|ANML|VHCL|SHIP)$/.test(a.type)));
// buildings the selected workers (or any worker of the player) can construct
G.buildActions = () => {
  const w = [...G.sel].find((u) => u.alive && u.owner === G.me && u.canBuild) || G.world.units.find((u) => u.alive && u.owner === G.me && u.isWorker);
  if (!w) return [];
  // harbours only on maps with water
  return G.data.actionsOf(w.rulesOwner(), w).filter((a) => a.cat === 'Build/BLDG' && a.visible && !a.disabled && (G.world.waterNav || !G.data.def(a.results[0].obj, G.me)?.coastal));
};
// special moves and building commands of the selection (generic commands have their own buttons)
const GENERIC = /^(Attack|Walk|Stop|Kill|AggressiveTarget|AggroState_\d|Formation_\d)$/;
G.moveActions = (sel) => {
  const seen = new Map();
  for (const e of sel) {
    if (!e.alive || e.owner !== G.me || (e.kind === 'building' && !e.built)) continue;
    for (const a of G.world.movesOf(e)) if (!GENERIC.test(a.id) && a.visible && !seen.has(a.id)) seen.set(a.id, a);
  }
  return [...seen.values()];
};
const casters = (sel, a) => sel.filter((e) => e.alive && e.owner === G.me && G.world.movesOf(e).some((x) => x.id === a.id));
G.moveState = (sel, a) => {
  let why = 'req';
  for (const e of casters(sel, a)) { const w = G.world.MOVES[a.id] ? G.world.moveCheck(e, a) : G.data.check(e.rulesOwner(), a, e); if (!w) return null; if (why === 'req' || w === 'cooldown') why = w; }
  return why;
};
G.moveCooldown = (sel, a) => Math.min(...casters(sel, a).map((e) => G.world.cooldownLeft(e, a)), 1e9);
G.reason = (why) => REASON[why] || why;
G.queueCount = (e, a) => (e && e.queue ? e.queue.filter((q) => q.action.id === a.id).length : 0);
G.useAction = (a, sel, ev) => {
  G.feedback.ui('UI_click');
  if (a.kind === 'Moves') {
    const list = casters(sel, a);
    let res = 'req';
    for (const e of list) {
      const why = G.world.useMove(e, a, null, null);
      if (why === 'target') { G.input.setMode('target', a); G.hud.message(`${G.data.text(a.id).name}: choose a target`); return; }
      if (!why) { res = null; if (!G.world.MOVES[a.id] || !G.world.MOVES[a.id].self || a.id === 'Burn') continue; break; }
      res = why;
    }
    if (res) G.hud.message(REASON[res] || res, 'bad');
    return;
  }
  if (a.cat === 'Build/BLDG') {
    if (G.data.check(G.me, a)) return G.hud.message(REASON.req, 'bad');
    if (!G.me.canAfford(a.cost)) return G.hud.message(REASON.cost, 'bad');
    G.input.setMode('place', a);
    return;
  }
  const prod = sel[0];
  if (!prod) return;
  // minelayer / corsair: mines and water turrets are built at a point in the water (choose it with the mouse)
  if (prod.kind === 'unit' && prod.naval && /mineship_mine|water_turret/.test(a.results[0]?.obj || '')) {
    const why = G.data.check(prod.rulesOwner(), a, prod) || (G.me.canAfford(a.cost) ? null : 'cost');
    if (why) return G.hud.message(REASON[why] || why, 'bad');
    G.input.setMode('lay', a);
    G.hud.message(`${G.data.text(a.results[0].obj).name || a.id}: choose a spot in deep water`);
    return;
  }
  const n = ev && ev.shiftKey ? 5 : 1;
  for (let i = 0; i < n; i++) {
    const why = G.world.queueAction(prod, a);
    if (why) { if (i === 0) G.hud.message(REASON[why] || why, 'bad'); break; }
  }
};
G.unqueue = (e, a) => {
  if (!e || !e.queue) return;
  for (let i = e.queue.length - 1; i >= 0; i--) if (e.queue[i].action.id === a.id) { G.world.cancelQueue(e, i); return; }
};
G.placeBuilding = (action, x, z, rot, workers) => {
  const r = G.world.startConstruction(G.me, action, x, z, rot, workers);
  if (typeof r === 'string') { G.hud.message(REASON[r] || r, 'bad'); G.feedback.error(); return false; }
  if (r.built) return true;                       // debug mode: finished at once
  if (workers.length) G.feedback.ordered('build', workers);
  if (!workers.length) G.hud.message('Select workers and right-click the foundation to build it');
  return true;
};
// a wall line (tiles from G.world.wallLine): every new piece is placed and paid on its own, in line order, as far
// as the resources go (ServerApp.usl:1304). The builders start at the first new piece and then take the nearest
// unfinished piece within 50 m (construction.js autoWork). Returns the number of pieces placed.
G.placeWall = (action, tiles, workers) => {
  let n = 0, why = null, first = null;
  for (const t of tiles) {
    if (t.state !== 'ok' && t.state !== 'cost') continue;
    const b = G.world.startConstruction(G.me, action, t.x, t.z, 0, []);
    if (typeof b === 'string') { why = why || b; if (b === 'cost') break; continue; }
    if (!first) first = b;
    n++;
  }
  if (first && workers.length) { G.world.order(workers, { type: 'build', target: first }); G.feedback.ordered('build', workers); }
  if (!n && why) { G.hud.message(REASON[why] || why, 'bad'); G.feedback.error(); }
  else if (why === 'cost') G.hud.message(REASON.cost, 'bad');
  else if (n && !workers.length) G.hud.message('Select workers and right-click the foundation to build it');
  return n;
};
G.changeLevel = (u, lv, other) => {
  const why = G.world.changeLevel(u, lv, other);
  if (why && why !== 'same') { G.hud.message(REASON[why] || why, 'bad'); G.feedback.error(); }
  else if (!why) G.feedback.ui('ui_click_pyramid');
};
G.levelUp = (u) => {
  const why = G.world.levelUp(u);
  if (why) G.hud.message(REASON[why] || why, 'bad');
};
G.order = (units, o) => G.world.order(units, o);
G.killSelected = () => {
  for (const e of [...G.sel]) if (e.alive && e.owner === G.me && e.kind !== 'res') { if (e.kind === 'building') G.world.selfDestruct(e); else G.world.kill(e, null); }
};
G.select = (list) => {
  G.sel.clear();
  const own = list.filter((e) => e.owner === G.me);
  for (const e of (own.length ? own : list.slice(0, 1))) G.sel.add(e);
  G.selChanged();
};
G.deselect = (e) => { G.sel.delete(e); G.selChanged(); };
G.toggleSelect = (e) => { if (G.sel.has(e)) G.sel.delete(e); else G.sel.add(e); G.selChanged(); };
G.selChanged = (silent) => {
  G.hud.hoverT = 0;
  if (G.hud.menu && ![...G.sel].some((e) => e.owner === G.me)) G.hud.menu = null;
  if (G.sel.size && !silent) G.feedback.selected([...G.sel]);
};
G.centerOn = (e) => { if (e) { G.rtscam.x = e.pos.x; G.rtscam.z = e.pos.z; } };
G.homeEntity = () => G.world.buildings.find((b) => b.alive && b.owner === G.me) || G.world.units.find((u) => u.alive && u.owner === G.me);
G.openMenu = () => G.menu.main();
G.closeMenu = () => G.menu.close();
G.setPaused = (p) => { G.paused = p; document.body.classList.toggle('paused', p && !G.menuOpen); };
G.togglePause = () => { G.setPaused(!G.paused); G.hud.message(G.paused ? 'Paused' : 'Resumed'); };
G.togglePerf = () => { G.settings.perf = !G.settings.perf; saveSettings(G.settings); G.hud.perfEl.classList.toggle('hidden', !G.settings.perf); };
G.selectIdleWorker = () => {
  const idle = G.world.units.filter((u) => u.alive && u.owner === G.me && u.isWorker && u.task.type === 'idle');
  if (!idle.length) { G.hud.message('No idle workers'); return; }
  G.idleIdx = ((G.idleIdx || 0) + 1) % idle.length;
  const u = idle[G.idleIdx];
  G.select([u]); G.centerOn(u);
};

// ---------------------------------------------------------------------------- per-frame systems
function updateFow(force) {
  const viewers = [];
  if (G.reveals) G.reveals = G.reveals.filter((r) => r.until > G.world.time);
  for (const u of G.world.units) if (u.alive && u.owner === G.me) viewers.push([u.pos.x, u.pos.z, u.fow]);
  for (const b of G.world.buildings) if (b.alive && b.owner === G.me) viewers.push([b.pos.x, b.pos.z, b.built ? b.fow : 12]);
  for (const r of G.reveals || []) viewers.push([r.x, r.z, r.r]);        // oracle / fireworks
  G.fow.update(viewers);
  // hide what the player can't see
  for (const u of G.world.units) {
    if (!u.obj) continue;
    if (u.inside) { u.obj.visible = false; continue; }
    if (u.owner === G.me) { u.obj.visible = true; continue; }
    u.obj.visible = !u.alive ? u.obj.visible && G.fow.visible(u.pos.x, u.pos.z) || u.deadT > 0 && G.fow.explored_(u.pos.x, u.pos.z) : G.fow.visible(u.pos.x, u.pos.z) && !G.world.hiddenFrom(u, G.me);
  }
  for (const b of G.world.buildings) if (b.owner !== G.me) { const v = G.fow.explored_(b.pos.x, b.pos.z) && !(b.alive && G.world.hiddenFrom(b, G.me)); b.obj.visible = v; if (b.ruin) b.ruin.visible = v; }
  for (const p of G.world.projectiles) if (p.obj) p.obj.visible = G.fow.visible(p.pos.x, p.pos.z);
}

const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();
function cullUnits() {
  pm.multiplyMatrices(G.camera.projectionMatrix, G.camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(pm);
  for (const u of G.world.units) {
    sph.center.copy(u.pos); sph.center.y += u.height * 0.5; sph.radius = Math.max(u.radius, u.height) + 1;
    u.onScreen = frustum.intersectsSphere(sph);
  }
}

function updateHoles() {
  const arr = holeUniforms.uHoles.value;
  const cam = G.rtscam;
  const cands = [];
  for (const u of G.world.units) {
    if (!u.alive || !u.onScreen || !u.obj.visible) continue;
    const d = Math.hypot(u.pos.x - cam.x, u.pos.z - cam.z);
    cands.push([d - (G.sel.has(u) ? 1000 : 0) - (u.owner === G.me ? 200 : 0), u]);
  }
  cands.sort((a, b) => a[0] - b[0]);
  let n = 0;
  for (const [, u] of cands) {
    if (n >= 16) break;
    arr[n++].set(u.pos.x, u.pos.y + u.height * 0.5, u.pos.z, Math.max(2.4, Math.min(7, u.height * 0.75)));
  }
  holeUniforms.uHoleCount.value = n;
}

function handleEvents() {
  // a building appeared / disappeared: the grass there is rebuilt
  if (G.grass) for (const e of G.world.events) if (e.type === 'ground') G.grass.invalidate(e.x, e.z, e.r);
  G.feedback.handle(G.world.events);
  G.world.events.length = 0;
}

let endT = 0;
// a player is out when nothing that could rebuild is left (no building, no worker, no Aje collector);
// the warp gate countdown (systems/buildings.js) ends the game directly
function checkEnd(dt) {
  endT -= dt;
  if (endT > 0 || G.over) return;
  endT = 1;
  const W = G.world;
  for (const p of W.players) {
    if (p.defeated) continue;
    const alive = W.buildings.some((b) => b.alive && b.owner === p) || W.units.some((u) => u.alive && u.owner === p && ((u.isWorker && !u.naval) || u.isDropoff));
    if (!alive) p.defeated = true;
  }
  const lost = G.me.defeated, won = G.me.won || W.players.every((p) => p === G.me || p.defeated || G.me.isFriend(p));
  if (!lost && !won) return;
  G.over = true;
  const t = Math.floor(W.time);
  G.audio.playMusic(won && !lost ? 'victory' : 'defeat');
  setTimeout(() => G.menu.end(won && !lost, { time: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, kills: G.me.kills, lost: G.me.lost, epoch: EPOCH[G.me.epoch()], enemy: G.ai.name }), 1500);
}

let fowT = 0;
function simulate(dt) {
  const W = G.world;
  let left = dt;
  while (left > 1e-4) {
    const s = Math.min(0.05, left);
    W.update(s);
    G.aiBrain.update(s);
    if (G.meBrain) G.meBrain.update(s);
    left -= s;
  }
  handleEvents();
  checkEnd(dt);
  fowT -= dt;
  if (fowT <= 0) { fowT = 0.2; updateFow(); }
}

// one frame of presentation. Each step is guarded: an error in one (e.g. the minimap) must not stop the others,
// and the player sees the error text instead of a frozen black screen (ui/diagnostics.js).
const DRAW_STEPS = [
  ['input', (dt) => G.input.update(dt)],
  ['camera', (dt) => G.rtscam.update(dt)],
  ['culling', () => { cullUnits(); updateHoles(); }],
  ['props', () => { G.props.update(G.camera); G.foliage.update(G.camera.position); if (G.grass && G.grass.mesh.visible) G.grass.update(G.rtscam.target, performance.now() / 1000); }],
  ['sun', () => G.renderer.followSun(G.rtscam.target)],
  ['effects', (dt) => G.fx.update(dt)],
  ['audio', () => { G.audio.listener.copy(G.rtscam.target); G.audio.yaw = G.rtscam.yaw; if (!G.over) G.audio.updateMusic(G.world.time, G.me.tribe); }],
  ['overlay', (dt) => G.overlay.update(dt)],
  ['hud', (dt) => G.hud.update(dt)],
  ['minimap', (dt) => G.minimap.update(dt)],
];
function draw(dt, now) {
  for (const [name, fn] of DRAW_STEPS) { try { fn(dt); } catch (e) { loopError(name, e); } }
  try { G.renderer.render(now); } catch (e) { loopError('render', e); }
}

let last = 0;
function frame(now) {
  if (G.exited) return;
  requestAnimationFrame(frame);
  if (!G.renderer.shouldRender(now)) return;
  const dt = Math.min(0.1, (now - (last || now)) / 1000);
  last = now;
  if (!G.paused) { try { simulate(dt * (G.settings.speed || 1)); } catch (e) { loopError('simulation', e); } }
  draw(dt, now);
  // 8 s after the start: check the game really runs (simulation time, fog of war, camera) - shows what's wrong
  if (!G.selfChecked && (G.frames = (G.frames || 0) + 1) > 30 && now - (G.startedAt || (G.startedAt = now)) > 8000) {
    G.selfChecked = true;
    const f = G.fow, seen = f && f.explored ? f.explored.reduce((a, v) => a + (v ? 1 : 0), 0) : -1;
    const cam = G.camera.position;
    if (G.world.time < 1 && !G.paused) report('stall', `The simulation is not advancing (game time ${G.world.time.toFixed(2)} s after ${G.frames} frames).`);
    if (seen === 0) report('fog', 'The fog of war shows nothing explored - the world will look black.');
    if (![cam.x, cam.y, cam.z].every(Number.isFinite)) report('cam', 'The camera position is invalid (NaN).');
    console.info('[selfcheck]', JSON.stringify({ t: G.world.time, frames: G.frames, explored: seen, cam: [cam.x, cam.y, cam.z], gpu: G.gpu, size: [innerWidth, innerHeight, devicePixelRatio] }));
  }
  // 50 frames in a row slower than 10 fps: the browser is probably rendering without the graphics card
  G.slowFrames = dt >= 0.1 ? (G.slowFrames || 0) + 1 : 0;
  if (G.slowFrames === 50) report('slow', `The game runs very slowly here (graphics: ${G.gpu || 'unknown'}). Lower "Resolution" and "Shadows" in Options, and check that the browser uses the graphics card.`);
}

// test harness (headless screenshots): ?manual
G.step = (n = 1, dt = 0.05) => { for (let i = 0; i < n; i++) simulate(dt); };
G.renderOnce = () => { draw(0.016, performance.now()); };

// ---------------------------------------------------------------------------- start-up
// ?manual / ?quick start straight into a skirmish (tests); ?tribe=Hu&enemy=Ninigi pick the tribes.
// "Restart" and "Play again" reload the page with the skirmish stored in sessionStorage.
function quickConfig() {
  const k = { ...G.settings.skirmish };
  if (params.has('tribe')) k.me = params.get('tribe');
  if (params.has('enemy')) k.ai = params.get('enemy');
  if (params.has('seed')) k.seed = +params.get('seed');
  if (params.has('color')) k.meColor = params.get('color');
  if (params.has('map')) k.map = params.get('map');
  if (params.has('aicolor')) k.aiColor = params.get('aicolor');
  if (params.has('debug')) k.debug = params.get('debug') !== '0';
  return k;
}
function applySettings(s) {
  G.audio.muted = !s.sound;
  Object.assign(G.audio.vol, { master: s.volMaster, sfx: s.volSfx, voice: s.volVoice, music: s.volMusic });
  G.audio.applyVolumes();
  if (G.renderer) { G.renderer.setShadows(s.shadows); G.renderer.resize(); }
  if (G.grass) { G.grass.visible = s.grass !== 'off'; G.grass.invalidate(); }
  if (G.hud) { G.hud.scale(); G.hud.perfEl.classList.toggle('hidden', !s.perf); }
}
// ---------------------------------------------------------------------------- maps
// cfg.map: '' = random jungle, 'maps/<folder>/<file>.ula' = a map served next to the game (server.ps1 serves the
// game's Data/Base/Maps folder there), 'file:' = a map file the player picked (kept in sessionStorage for restarts)
async function mapSource(cfg) {
  if (!cfg.map) return generatedSource(cfg);
  progress(0.03, 'Reading the map…');
  let buf;
  if (cfg.map === 'file:') {
    const b64 = sessionStorage.getItem('pwr.mapfile');
    if (!b64) throw new Error('The map file is no longer available - pick it again in the skirmish menu.');
    buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  } else {
    const r = await fetch(cfg.map.split('/').map(encodeURIComponent).join('/'));
    if (!r.ok) throw new Error('Map not found: ' + cfg.map);
    buf = await r.arrayBuffer();
  }
  const md = await parseUla(buf, cfg.mapName || cfg.map.split('/').pop());
  return originalSource(md, G.data, cfg, Assets.manifest.models);
}
// for tools and tests (tests/maps_audit.js): read any map the way the game does
G.mapTools = { parseUla, originalSource, models: () => Assets.manifest.models };
// models a map needs on top of the tribes' ones: its landscape objects, its animals, the carried wood/stone look
function mapModels(S) {
  const need = new Set(S.models);
  for (const sp of new Set([...S.animals, ...(S.nests || [])].map((a) => a.species))) {
    for (let l = 1; l <= 5; l++) { const s = G.data.stats(sp, l, null); if (s && s.gfx) need.add(s.gfx.toLowerCase()); }   // gfx can change per level
    const cg = G.data.classGfx(sp);           // the class file's model when the tech tree gfx doesn't exist (Tsintaosaurus -> iguanodon)
    if (cg) need.add(cg);
  }
  const key = { Jungle: 'jun', Northland: 'nor', Savanna: 'sav', Icewaste: 'ice', Ashvalley: 'ash' }[S.setting] || 'jun';
  for (const n of ['product_wood_jun', 'product_stone_jun', `product_wood_${key}`, `product_stone_${key}`, 'jungle_tree_01_stump', 'jungle_tree_01_timber', 'jungle_tree_02_timber', 'jungle_fruit_bush']) need.add(n);
  return need;
}
async function startGame(cfg) {
  try {
    G.config = cfg;
    loadEl.classList.remove('done');
    loadEl.style.display = '';
    const S = await mapSource(cfg);
    await loadModels([cfg.me, cfg.ai], mapModels(S));
    await buildWorld(cfg, S);
    progress(1, 'Ready');
    loadEl.classList.add('done');
    setTimeout(() => { loadEl.style.display = 'none'; }, 600);
    G.menu.inGame = true;
    G.hud.message(`Build up your settlement and defeat the ${G.ai.name}.`, 'good');
    G.audio.playMusic('background', cfg.me);
    if (!MANUAL) requestAnimationFrame(frame);
    G.ready = true;
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    loadTxt.textContent = 'Error: ' + e.message;
    G.error = e.message;
    reportError('start-up', e);
  }
}
// "Exit game": silence everything, stop the local server (server.ps1 /__quit) and close the window.
// Browsers only let a page close a window it opened itself / an app window; otherwise a closing screen stays.
function exitGame() {
  try { G.audio.shutdown(); } catch (e) { /* ignore */ }
  G.paused = true; G.over = true; G.exited = true;
  fetch('__quit').catch(() => {});
  document.body.innerHTML = '<div style="position:fixed;inset:0;background:#000;color:#e8d0a0;display:flex;align-items:center;' +
    'justify-content:center;font:20px Trebuchet MS,sans-serif;text-align:center">The game has been closed.<br><br>You can close this window now.</div>';
  setTimeout(() => window.close(), 150);
}
async function boot() {
  try {
    await loadCore();
    G.menu = new Menu(G, {
      start: (cfg) => startGame(cfg),
      restart: () => { try { sessionStorage.setItem('pwr.autostart', JSON.stringify(G.config)); } catch (e) { /* ignore */ } location.reload(); },
      quit: () => { try { sessionStorage.removeItem('pwr.autostart'); } catch (e) { /* ignore */ } location.reload(); },
      exit: exitGame,
      applySettings, sound: (n) => G.feedback ? G.feedback.ui(n) : G.audio.play(n),
    });
    applySettings(G.settings);
    // the browser only allows audio after a user gesture
    const unlock = () => { G.audio.init(); G.audio.applyVolumes(); if (!G.ready) G.audio.playMusic('menu'); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);
    let auto = null;
    try { auto = JSON.parse(sessionStorage.getItem('pwr.autostart') || 'null'); sessionStorage.removeItem('pwr.autostart'); } catch (e) { auto = null; }
    if (MANUAL || params.has('quick')) auto = quickConfig();
    if (auto) { await startGame(auto); return; }
    progress(1, '');
    loadEl.style.display = 'none';
    G.menu.title();
    G.titleReady = true;
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    loadTxt.textContent = 'Error: ' + e.message;
    G.error = e.message;
    reportError('loading', e);
  }
}
boot();
