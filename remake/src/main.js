import { colorById, hex, NEUTRAL_UI, PLAYER_COLORS } from './game/colors.js';
import { resolveSetup, defaultSetup } from './game/skirmish.js';
import { Chat } from './ui/chat.js';
import { diplomacyWindow } from './ui/diplomacy.js';
import { PointBuy } from './game/pointbuy.js';
import { watchRenderer, loopError, report, reportError, setReportContext, watchGlobalErrors } from './ui/diagnostics.js';
import * as THREE from 'three';
import { Renderer, RTSCamera } from './engine/renderer.js';
import { initAssets, loadModel, Assets, cloneModel } from './engine/assets.js';
import { HeightField, buildTerrain, FogOfWar, refreshTerrain, refreshSplat } from './engine/terrain.js';
import { GroundBrushes, levelGround, brushCells } from './game/ground.js';
import { PropField, FoliageField, treeSprites, holeUniforms, spriteLight, spriteTexture } from './engine/props.js';
import { FX } from './engine/fx.js';
import { Particles } from './engine/particles.js';
import { Weather } from './engine/weather.js';
import { Atmo } from './engine/atmo.js';
import { Audio } from './engine/audio.js';
import { HOME_CLASS } from './engine/music.js';
import { Feedback } from './ui/feedback.js';
import { FallenTrees } from './ui/logs.js';
import { GAME_FX_MODEL } from './ui/gamefx.js';
import { ModelFx } from './engine/modelfx.js';
import { MIRAGE_FX_MODELS } from './game/systems/moves_mirage.js';
import { Rules } from './game/rules.js';
import { World } from './game/world.js';
import { Player } from './game/player.js';
import { generatedSource, originalSource, slopeWalkable } from './game/maps/source.js';
import { parseUla } from './game/maps/ula.js';
import { pfCells } from './game/prop.js';
import { setForestData } from './game/maps/forest.js';
import { buildWater } from './engine/water.js';
import { GrassLayer, GRASS_DENSITY } from './engine/grass.js';
import { TribeAI } from './game/ai.js';
import { initAtlas, preloadAtlasImages, setCardNames, iconFor } from './ui/atlas.js';
import { HUD } from './ui/hud.js';
import { Input } from './ui/input.js';
import { Overlay } from './ui/overlay.js';
import { Minimap, minimapButtons } from './ui/minimap.js';
import { Menu, loadSettings, saveSettings, TRIBE_INFO, CONFIG_MOD } from './ui/menu.js';
import { snapshot, restore } from './game/save.js';
import { Sequel } from './game/sequel/runtime.js';
import { sequelData, SEQUEL_MOD } from './game/sequel/rules.js';
import { lockedBefore, LAST_MISSION, SEQUEL_ORDER, renumbered } from './game/sequel/missions.js';
import { onRoad } from './game/sequel/maps.js';
import { SequelUI } from './ui/sequel_ui.js';
import { SCENARIOS } from './game/scenarios/missions.js';
import { listSaves, putSave, getSave, deleteSave, exportSave, importSave, quickId } from './ui/saves.js';
import { Campaign, loadCampaign } from './game/campaign/setup.js';
import { Regions } from './game/campaign/regions.js';
import { MissionUI } from './ui/mission.js';
import { applyCheats, configCheats, spawnModels, spawnObject } from './game/cheats.js';

const params = new URLSearchParams(location.search);
const MANUAL = params.has('manual');
// what a copied error report carries besides the error itself
const BUILD = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';
setReportContext(() => {
  const c = G.config || {};
  return [`build ${BUILD}`, `browser ${navigator.userAgent}`, `gpu ${G.gpu || '?'}`,
    (c.campaign != null ? `campaign mission ${c.campaign}, difficulty ${c.difficulty}${c.tribe ? ', tribe ' + c.tribe : ''}, ` : `game: ${c.me || '?'} vs ${c.ai || '?'}, map ${c.map || 'random jungle'}${c.map ? '' : ', seed ' + c.seed}, `) +
    `time ${G.world ? G.world.time.toFixed(1) + ' s' : '-'}, units ${G.world ? G.world.units.length : '-'}`,
    // what the graphics card had to draw in the last frame (a context loss: which part was too much)
    G.renderer ? `frame: ${G.renderer.renderer.info.render.calls} draws, ${G.renderer.renderer.info.render.triangles} triangles, ` +
      `${G.renderer.renderer.info.memory.textures} textures, ${(G.renderer.renderer.info.programs || []).length} shaders, ` +
      `${G.particles ? G.particles.drawn || 0 : 0} sprites (particles ${G.settings.particles || 'on'}), pixel ratio ${G.renderer.renderer.getPixelRatio()}, ` +
      `shadows ${G.settings.shadows}, ${window.innerWidth}x${window.innerHeight}` : ''].filter(Boolean).join('\n');
});
if (!MANUAL) watchGlobalErrors();
const REASON = {
  req: 'Requirements not met', cost: 'Not enough resources', housing: 'Population limit reached – build more housing',
  level: 'No free slot at this level of the army pyramid', full: 'Production queue is full', done: 'Already researched',
  place: 'Cannot build here', skulls: 'Not enough skulls', max: 'Already at the highest level',
  down: 'A unit keeps the level it has reached',
  cooldown: 'Still recharging', unique: 'You already have this hero', target: 'Choose a target', storage: 'Storage is full',
  busy: 'Busy', illusion: 'Illusions cannot do that', hidden: 'Not available', disabled: 'Not available',
};
const EPOCH = ['', 'I', 'II', 'III', 'IV', 'V'];

const G = window.G = {
  build: BUILD,                    // the version the menus show (ui/menu.js versionLine)
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
    // the computer player's tables (pipeline step "ai"); a data folder without it: the AI uses its built-in fallbacks
    fetch('ai.json').then((r) => (r.ok ? r.json() : null)).then((j) => { G.aiData = j; }).catch(() => { G.aiData = null; }),
    // tree layouts of forest blocks (pipeline step "forest"); without it original maps have only their placed trees
    fetch('forest.json').then((r) => (r.ok ? r.json() : null)).then(setForestData).catch(() => setForestData(null)),
  ]);
  G.data = new Rules(tt, json);
  G.raw = { tt, json };                           // (the sequel campaign reads its own rules from them: game/sequel/rules.js)
  setCardNames((name) => { const d = G.data.exists(name) ? G.data.def(name, null) : null; return d && d.desc ? String(d.desc).replace(/^_/, '') : null; });
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
  // the parts the tribes' objects and the map's own objects attach (game/compose.js), also from map archives: the
  // machine gun nest's gun seas_hq_machinegun_nest_top (campaign headquarters; MIRAGE builds the nest)
  for (const [name, ix] of D.index) {
    const s1 = D.stats(name, 1, null), gfx = String((s1 && s1.gfx) || D.classGfx(name) || '').toLowerCase();
    if (!tribes.includes(ix.tribe) && !need.has(gfx)) continue;
    for (const s of D.composites(name)) for (const g of [s.gfx, ...(s.variants || [])]) if (g && M[g.toLowerCase()]) want.add(g.toLowerCase());
  }
  // a class whose tech tree model doesn't exist is drawn with its class file's model (unitModel): load that one
  // (MIRAGE's Stina: Stina_s2 .. s5 -> stina_s0, which the campaign maps also use)
  for (const [name, ix] of D.index) {
    if (ix.tribe === 'World' || skip.some((p) => name.toLowerCase().startsWith(p))) continue;
    const cg = D.classGfx(name);
    if (!cg || !M[cg] || want.has(cg)) continue;
    for (let l = 1; l <= 5; l++) { const s = D.stats(name, l, null); if (s && s.gfx && !M[s.gfx.toLowerCase()]) { want.add(cg); break; } }
  }
  for (const n of [...want]) if (M[n].anims) want.add(M[n].anims.toLowerCase());
  // keep the anim packs other tribes' units borrow (e.g. seas_worker animates with hu_worker_s1)
  const animated = new Set();
  for (const [name, ix] of D.index) {
    if (ix.type === 'BLDG') continue;
    for (let l = 1; l <= 5; l++) { const s = D.stats(name, l, null); if (s && s.gfx) animated.add(s.gfx.toLowerCase()); }
  }
  for (const k in M) { const a = M[k].anims; if (a) animated.add(a.toLowerCase()); if (/_rider_|_crane_|collector_[a-e]$|_rally_point/.test(k)) animated.add(k); }
  // wall pieces: arms tagged by direction (assets.js tagWallArms; towers and traps are not wall pieces)
  const walls = new Set(), gates = new Set();
  for (const [name, ix] of D.index) if (ix.type === 'BLDG') {
    const d = D.def(name, null);
    if (d && d.wallKind === 'wall') for (let l = 1; l <= 5; l++) { const s = D.stats(name, l, null); if (s && s.gfx) walls.add(s.gfx.toLowerCase()); }
    if (d && d.wallKind === 'gate') for (let l = 1; l <= 5; l++) { const s = D.stats(name, l, null); if (s && s.gfx) gates.add(s.gfx.toLowerCase()); }
  }
  const names = [...want].filter((n) => M[n]);
  G.templates = G.templates || new Map();
  let done = 0;
  const queue = names.filter((n) => !G.templates.has(n));
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift();
      try { G.templates.set(n, await loadModel(n, { static: !animated.has(n), wallArms: walls.has(n) || /^(hu_small_wall|hu_re_enforced_wall)$/.test(n), gate: gates.has(n) })); } catch (e) { console.warn('model failed', n, e); }
      done++;
      progress(0.05 + 0.8 * done / names.length, `Loading models ${done} / ${names.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
}
function tpl(name, soft) {
  let t = name && G.templates.get(name.toLowerCase());
  // ?stubart: a model the assets lack stands in as the SEAS turret tower's (testing the sequel without its art)
  if (!t && name && params.has('stubart')) t = G.templates.get(/^sq_|_b$/.test(name.toLowerCase()) ? 'seas_turret_tower' : '') || [...G.templates.values()].find((x) => x && x.info) || null;
  if (!t && !soft) throw new Error('missing model ' + name);
  return t || null;
}

// ---------------------------------------------------------------------------- world setup

// the setting's minimap colour table (pipeline/build_terrain.py: Texture/Scape/<Setting>/minimap_colors.tga, 6 rows of
// 21 colours); null with game data built before it (the minimap then stays empty until "Rebuild game data")
async function minimapTable(S) {
  try {
    const t = (await (await fetch(`assets/terrain/${S.setting}/setting.json`)).json()).minimap;
    return Array.isArray(t) && t.length === 6 && t[0].length >= 15 ? t : null;
  } catch (e) { return null; }
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
  // the map's ground materials, and over them the 4 m cells the ground brush of a building put down painted
  // (W.adaptTerrain): a painted cell counts as its material, blended with its neighbours like the map's own cells
  const baseSplat = S.splat(hf), painted = new Map(), half = S.size / 2;
  const cellOf = (x, z) => { const i = Math.floor((x + half) / 4), j = Math.floor((z + half) / 4); return [i, j, i * 4 + 2 - half, j * 4 + 2 - half]; };
  const splat = (x, z) => {
    const base = baseSplat(x, z);
    if (!painted.size) return base;
    const fx = (x + half) / 4 - 0.5, fz = (z + half) / 4 - 0.5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    let w = null, rest = 0;
    for (const [ci, cj, k] of [[i, j, (1 - u) * (1 - v)], [i + 1, j, u * (1 - v)], [i, j + 1, (1 - u) * v], [i + 1, j + 1, u * v]]) {
      const m = painted.get(ci * 65536 + cj);
      if (m == null) { rest += k; continue; }
      w = w || new Array(base.length).fill(0);
      w[m] += k;
    }
    if (!w) return base;
    for (let k = 0; k < base.length; k++) w[k] += base[k] * rest;
    return w;
  };
  // the terrain texture showing ground material k of the setting (scape_<k>.jpg), else the nearest kind of ground
  const GROUND_NEAR = { 5: [6, 3, 4, 1], 3: [5, 6, 1], 2: [0], 6: [5, 3], 4: [5, 7], 0: [2], 1: [3, 5], 7: [4, 5] };
  const slotOf = (k) => {
    for (const m of [k, ...(GROUND_NEAR[k] || [])]) { const i = S.textures.findIndex((t) => t.split('/').pop() === `scape_${m}.jpg`); if (i >= 0) return i; }
    return null;
  };
  G.groundWeights = splat;                         // (tests: the ground materials at a point)
  G.groundSlot = slotOf;                           // (tests)
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
  if (params.has('reveal') || (cfg.slots && cfg.fog === false)) G.fow.revealAll = true;     // (the setup's "Disable fog of war": FOWEnabled)
  G.props = new PropField(scene);
  G.particles = new Particles(scene);
  G.props.particles = G.particles;
  Assets.onClone = (root) => G.particles.track(root);
  G.particles.seen = (x, z) => G.fow.explored_(x, z);
  G.particles.level = G.settings.particles || 'on';
  G.foliage = new FoliageField(scene, 64);
  G.foliage.light.set(0.86, 0.9, 0.8);
  spriteLight.copy(G.foliage.light);              // 2D parts of buildings (lanterns) lit like the foliage
  G.fx = new FX(scene, height);
  G.weather = new Weather(scene);                 // snow and rain of the level's weather program (engine/weather.js)
  G.weather.enabled = G.settings.weather !== false;
  G.audio.muted = !G.settings.sound;
  G.feedback = new Feedback(G);
  G.logs = new FallenTrees(G);
  const P = S.play;
  const W = G.world = new World({
    scene, data: G.data, templates: tpl, height, size: S.size, play: P, wallGrid: S.wallGrid,
    playHalf: Math.min(P.x1 - P.x0, P.z1 - P.z0) / 2, water: S.water, setting: S.setting, startTime: S.startTime,
    fx: G.fx, audio: G.audio, props: G.props, foliage: G.foliage, fow: G.fow,
    // campaign missions have no built-in victory: no warp gate rule either (GameOverMgr.usl:95-103, multiplayer only)
    rules: { warpgate: !G.campaign && !G.sequel && cfg.warpgate !== false, warpgateMinutes: cfg.warpgateMinutes || 10,
      multiplayer: !G.campaign && !G.sequel,
      // the skirmish setup's game type and diplomacy lock (game/skirmish.js, systems/gameover.js)
      mode: cfg.slots ? cfg.mode || 'deathmatch' : 'deathmatch', defenderMin: cfg.defenderMin || 45, diplomacyLocked: !!(cfg.slots && (cfg.lockDiplomacy || cfg.mode === 'domination' || cfg.mode === 'defender')) },          // a multiplayer level (CLevelInfo.IsMultiplayer): the skirmish maps
  });
  G.mfx = new ModelFx(W);                          // the game's effect models (engine/modelfx.js, ui/gamefx.js)
  // a unit put into production (anybody's): its model's shaders are compiled now, in the background, not in the frame
  // it first shows - a new kind of unit cost that frame tens of milliseconds (a stall when a computer player started
  // training, when a Stinger was done; the D3D shader compiler under Chrome on Windows is slow)
  const warmed = new Set();
  W.prewarm = (name, owner) => {
    const st = G.data.stats(name, 1, owner), gfx = (st && st.gfx) || G.data.classGfx(name);
    if (!gfx || warmed.has(gfx)) return;
    warmed.add(gfx);
    const tpl = W.template(gfx, true), R = G.renderer && G.renderer.renderer;
    if (!tpl || !R || !R.compileAsync) return;
    const m = cloneModel(tpl, owner && owner.partyColor != null ? owner.partyColor : null);
    G.particles.untrack(m);
    R.compileAsync(m, G.camera, G.scene).catch(() => {});
  };
  // keep units inside the playable area and out of the water (ships use their own grid, see nav.water)
  const nav = W.nav;
  for (let j = 0; j < nav.n; j++) for (let i = 0; i < nav.n; i++) {
    const [x, z] = nav.center(j * nav.n + i);
    if (x < P.x0 + 2 || x > P.x1 - 2 || z < P.z0 + 2 || z > P.z1 - 2) nav.block[j * nav.n + i]++;
  }
  W.mapKind = S.kind;                              // (the wall map's height rules: wallmap.js heightAt)
  W.mapWalkGrid = !!S.walkable;                    // an original map's walk grid (scenery without pf boxes: prop.js)
  if (S.water != null) W.markWater(S.water);
  // where land units can walk: the map's pathfinder grid, else a slope rule (maps/source.js slopeWalkable: the
  // sequel's cliffs and the random maps' mountains)
  W.markTerrain(S.walkable || slopeWalkable((x, z) => W.height(x, z), S.maxSlope), !!S.walkable);
  nav.labelRegions();                              // before anything is built (nav.js: goals across mountains)
  if (W.waterNav) W.waterNav.labelRegions();
  // AdaptTerrain: under a building put down in the game the ground is levelled and takes the brush's materials
  // (game/ground.js)
  const brushes = new GroundBrushes(await fetch('assets/terrain/objbrush.json').then((r) => r.json()).catch(() => null));
  W.groundLog = [];                                // what was done, in order (a saved game does it again: game/save.js)
  W.adaptTerrain = (gfx, x, z, rot) => {
    const b = brushes.get(gfx);
    if (!b) return false;
    const r = levelGround(hf, b, brushes.mpp, x, z, rot);
    if (r) refreshTerrain(terrain, hf, r);
    let paintedAny = false;
    for (const [i, j, m] of brushCells(b, brushes.mpp, x, z, rot, cellOf)) {
      const k = slotOf(m);
      if (k != null) { painted.set(i * 65536 + j, k); paintedAny = true; }
    }
    const R = Math.hypot(b.w, b.h) * brushes.mpp / 2 + 8;
    if (paintedAny) refreshSplat(terrain, hf, splat, x - R, z - R, x + R, z + R);
    W.groundLog.push([gfx, x, z, rot]);
    W.emit('ground', { x, z, r: R });               // the grass follows the new ground
    return true;
  };

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
        const lx = -f.pts[i], ly = f.pts[i + 2], lz = -f.pts[i + 1];       // GSF -> world: (-x, z, -y)
        const k = Math.floor(brnd() * 2);
        list.push({ x: x + lx * c + lz * s, y: y + ly + (fruit ? 0.1 : 0), z: z - lx * s + lz * c, size: fruit ? 0.55 + brnd() * 0.3 : f.size * 0.55,
          uv: fruit ? FRUIT[k] : LEAF[k], detail: fruit ? false : i % 2 === 1, tint: fruit ? 0.9 : 0.35 + Math.min(1, ly / 2) * 0.5 + brnd() * 0.15 });
      }
    }
    // leaves first, then fruit (drawn on top within the chunk)
    list.sort((a, b) => (a.size < 1 ? 1 : 0) - (b.size < 1 ? 1 : 0));
    return [G.foliage.add(miscTex, list)];
  };
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
    const timber = t.timber && tpl(t.timber, true) ? t.timber : null;     // (the falling log: ui/logs.js)
    W.addResource('tree', 'wood', t.x, t.z, t.wood, {
      radius: big ? 1.5 : 1.1, propHandle: ph2, spriteHandles: sh, cells, stumpKind: stump, timberKind: timber,
      rot: t.rot, scale: t.scale, name: t.model, maxWorkers: 4,
    });
  }
  // undergrowth: camera-facing leaf sprites (same technique as the tree canopies)
  const bushTex = spriteTexture('jng_small_a.png');
  const BUSH_CELLS = [[0, 0.25, 0.25, 0.5], [0.25, 0.25, 0.5, 0.5], [0.5, 0.25, 0.75, 0.5], [0, 0.5, 0.25, 0.75], [0.25, 0.5, 0.5, 0.75], [0, 0, 0.25, 0.25], [0.25, 0, 0.5, 0.25]];
  // the map's plants and decoration, for W.clearVegetation: {x, z, prop, sprites, cells}
  const decorList = W.decorIndex = [];
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
      decorList.push({ x: d.x, z: d.z, sprites: [G.foliage.add(bushTex, list)] });
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
      decorList.push({ x: d.x, z: d.z, sprites: [G.foliage.add(miscTex, list)] });
      continue;
    }
    if (!tpl(d.model, true)) continue;
    kind(d.model, { castShadow: d.block || /bush|underwood|tree/.test(d.model), holes: /tree|palm/.test(d.model) });
    const prop = G.props.add(d.model, d.x, y, d.z, d.rot, d.scale, d.q);
    const sprites = addSprites(d.model, d.x, y, d.z, d.rot, d.scale, { ground: !/tree|palm|bamboo|deco/.test(d.model) });
    // what stands in the way: the model's pathfinder boxes; a model without any blocks nothing on an original map
    // (the engine has nothing to block with; the map's walk grid holds the rest - an ice arch is walked under), a
    // circle on the remake's own maps
    let cells = null;
    if (d.block) {
      cells = pfCells(nav, tpl(d.model, true), d.x, d.z, d.rot, d.scale);
      if (cells) nav.mark(cells, 1);
      else if (!S.walkable) cells = nav.markCircle(d.x, d.z, Math.min(24, radiusOf(d.model) * d.scale * 0.7));
    }
    // the sequel's houses, cars and camps stand where the story put them (not plants)
    if (!/^sq_/.test(d.model)) decorList.push({ x: d.x, z: d.z, prop, sprites, cells });
  }
  // a building put down: the decoration, plants, trees and stumps within its radius go (ServerApp.usl PlaceObj,
  // object types DECO, VGTN, WOOD and ForestMgr.RemoveStumps); fruit bushes and stones stay
  W.vegetationLog = [];
  W.clearVegetation = (x, z, r) => {
    for (const e of decorList) {
      if (e.gone || Math.hypot(e.x - x, e.z - z) > r) continue;
      e.gone = true;
      if (e.prop) G.props.remove(e.prop);
      for (const h of e.sprites || []) G.foliage.hide(h);
      if (e.cells) nav.mark(e.cells, -1);
    }
    for (const n of W.resources) {
      if ((n.type !== 'tree' && n.type !== 'timber') || Math.hypot(n.pos.x - x, n.pos.z - z) > r) continue;
      if (n.alive) W.depleteNode(n);
      if (n.stumpHandle) { G.props.remove(n.stumpHandle); n.stumpHandle = null; }
    }
    W.vegetationLog.push([x, z, r]);
  };
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
  const homes = [];
  if (G.campaign) {
    // a campaign mission: the players, objects, groups and start locations of the mission data (game/campaign/setup.js)
    G.me = G.campaign.build(W, S);
    G.ai = null;                                  // there is no single opponent: W.players, diplomacy per pair
  } else if (G.sequel) {
    G.me = G.sequel.build(W, S);                  // a mission of the sequel campaign (game/sequel/runtime.js)
    W.nightFn = () => G.sequel.nightOn;           // its own nights (the buildings' lights follow them)
    G.ai = null;
  } else {
  // party colours: chosen in the skirmish menu (or "none" = untinted models); the minimap uses the dark variant
  const pc = (id, fallback) => { const c = colorById(id); return { color: c ? hex(c.dark) : fallback, partyColor: c ? hex(c.light) : null, colorSlot: c ? PLAYER_COLORS.indexOf(c) : -1 }; };
  if (cfg.slots) homes.push(...skirmishPlayers(cfg, S, pc));          // the skirmish setup (game/skirmish.js): up to 8 players
  else {
  const me = G.me = new Player(0, cfg.me, { ...pc(cfg.meColor, NEUTRAL_UI.me), name: TRIBE_INFO[cfg.me].name, rules: D });
  const ai = G.ai = new Player(1, cfg.ai, { ai: true, ...pc(cfg.aiColor, NEUTRAL_UI.ai), name: TRIBE_INFO[cfg.ai].name, rules: D });
  W.players = [me, ai];
  me.debug = !!cfg.debug;                         // debug mode: free and instant (game/player.js)
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
  }
  }
  const wildAt = (a) => {
    if (a.swim && !W.waterNav) return null;
    const u = W.spawnUnit(a.species, null, a.x, a.z, undefined, Math.random() * 6.28, a.swim ? { swim: true } : {});
    if (u) u.home.set(a.home[0], a.home[1]);
    return u;
  };
  for (const a of S.animals) wildAt(a);
  // nests of original maps keep respawning their animals
  // (Nest.OnPostLoad Advance_Population: the animals born before the start stand somewhere in the action area)
  for (const n of S.nests || []) {
    if (n.swim && !W.waterNav) continue;
    const nest = W.addWildNest({ ...n, members: [] });
    for (const a of n.start) {
      const p = W.nestPoint(nest, false, true) || [n.x, n.z];
      const u = wildAt({ ...a, x: p[0], z: p[1], home: [n.x, n.z] });
      if (!u) continue;
      W.joinNest(nest, u, a.born);
      W.flockAdd(nest.flock, u);
    }
    nest.alive = nest.members.length;
    W.updateFlockPos(nest);
  }
  if (G.campaign) G.campaign.wildlifeReady();
  // healing wells, lakes of healing / damage, the weather program (game/systems/landmarks.js): a campaign's wells and
  // lakes are objects of its mission (campaign/setup.js); the lakes' regions are the map's
  W.regionOf = mapRegions(G, S);
  if (!G.campaign) { for (const w of S.wells || []) W.placeWell(w); for (const l of S.lakes || []) W.addLake(l); }
  // the level's items (artefacts): placed ones, then what the item spawns make (systems/items.js; a campaign's own:
  // campaign/setup.js)
  if (!G.campaign && !G.sequel) {
    for (const i of S.items || []) W.placeItem(i.cls, i.x, i.z, i.rot);
    if (S.itemSpawns && S.itemSpawns.length) W.generateItems(S.itemSpawns, S.itemPool.pool, S.itemPool.max);
  }
  // the debug options chosen before the start (game/cheats.js; ui/debugopts.js)
  applyCheats(G, configCheats(cfg));
  W.startWeather(S.weather);
  // the end of the game (GameOverMgr: skirmish maps only): its game type, flags, defender
  if (!G.campaign && !G.sequel) W.gameOverInit(S, cfg);
  createBrains(cfg);

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
          if (d <= 0.01 || hf.normalY(x, z) < 0.8 || !W.nav.isFree(x, z) || inBuilding(x, z) || (S.sequel && onRoad(S, x, z))) return 0;
          return d * (G.settings.grass === 'dense' ? 1 : 0.55);
        },
      });
      G.grass.visible = G.settings.grass !== 'off';
    } catch (e) { console.warn('no grass:', e.message); G.grass = null; }
  }

  // ---------------------------------------------------------------- camera, UI
  G.rtscam = new RTSCamera(G.camera, height, S.size / 2 - 8);
  if (G.campaign) {
    // the camera starts at the human player's start location, looking along the level's default camera angle
    // (StartLocation.usl:352-361 "start_pos"; the angle's zero direction is a guess, see docs/CAMPAIGN_RUNTIME.md)
    const sl = G.campaign.startLocations[G.me.id], own = G.homeEntity();
    G.rtscam.x = sl ? sl.x : own ? own.pos.x : 0; G.rtscam.z = sl ? sl.z : own ? own.pos.z : 0;
    G.rtscam.yaw = Math.PI / 2 - (G.campaign.map.default_camera || 0.785);   // the eye's azimuth in map space (y south: game/maps/frame.js)
  } else if (G.sequel) { const [cx, cz] = G.sequel.camera(); G.rtscam.x = cx; G.rtscam.z = cz; G.rtscam.yaw = 0; }
  else {
    // the level's default camera angle (an original map's DefaultCamera; 0.785 = the game's default), as in the campaign
    const hq = homes[0]; G.rtscam.x = hq.pos.x; G.rtscam.z = hq.pos.z;
    G.rtscam.yaw = Math.PI / 2 - (S.defaultCamera != null ? S.defaultCamera : 0.785);
  }
  G.rtscam.update(0.016);
  G.overlay = new Overlay(G);
  G.input = new Input(G);
  G.hud = new HUD(G);
  G.chat = new Chat(G);
  G.hud.buildTopButtons();
  G.minimap = new Minimap(G, G.hud.mmCanvas, S, await minimapTable(S));
  G.minimap.buildBackground(height, S.water);
  minimapButtons(G, G.hud.mmWin, G.minimap, (b, key) => G.hud.showTip(b, G.hud.keyTip(key)));
  G.hud.perfEl.classList.toggle('hidden', !G.settings.perf);
  updateFow(true);
}

// The players of a skirmish setup (game/skirmish.js): each on its start location with the tribe's start (base, three
// workers, resources: the predefined set "_pb_locked"; a point-buy army: game/pointbuy.js), its team, colour and
// handicap (the tech tree's /Filters/Special/Upgrades/handicap/handicap_<hp>: hit points of everything but SEAS),
// the map's population limit of its start slot, and the map's objects of that slot (the defender's fortress ...).
// -> the start buildings (homes). G.me = the human, G.ai = the first computer player (older callers).
function skirmishPlayers(cfg, S, pc) {
  const W = G.world, D = G.data, homes = [];
  const PB = G.pointBuy = new PointBuy(D, G.aiData);
  const list = G.resolved || resolveSetup(cfg, S);
  G.setup = { ...cfg, resolved: list };
  W.players = [];
  const count = (t) => list.filter((o) => o.tribe === t).length;
  list.forEach((s, id) => {
    const name = TRIBE_INFO[s.tribe].name + (count(s.tribe) > 1 ? ' ' + (list.filter((o, k) => o.tribe === s.tribe && k <= id).length) : '');
    const fallback = PLAYER_COLORS[id % PLAYER_COLORS.length] ? hex(PLAYER_COLORS[id % PLAYER_COLORS.length].dark) : NEUTRAL_UI.ai;
    const p = new Player(id, s.tribe, { ...pc(s.color, fallback), name, rules: D, ai: s.type === 'ai', team: s.team });
    p.hq = s.hq; p.slot = s;
    W.players.push(p);
  });
  G.me = W.players[list.findIndex((s) => s.type === 'human')] || W.players[0];
  G.ai = W.players.find((p) => p.ai) || null;
  G.me.debug = !!cfg.debug;
  list.forEach((s, id) => {
    const p = W.players[id];
    if (cfg.handicap && s.hp && s.hp !== 100 && p.tt) p.tt.enable(`Special/Upgrades/handicap/handicap_${s.hp}`);
    const ms = S.mp && S.mp.slots[s.hq];
    if (ms && ms.popMax) p.popMax = ms.popMax;
    const [bx, bz] = s.pos;
    const st = D.start(p.tribe);
    Object.assign(p.res, st.res);
    W.clearArea(bx, bz, 16);
    const face = Math.atan2(-bx, -bz);
    const bought = cfg.points >= 0 && PB.ready;
    // the main building; the Aje resource collector of a human player with an army budget is a card of the bought
    // army (StartLocation.usl:386-390)
    let base = null;
    if (!(bought && s.type === 'human' && p.tribe === 'Aje')) {
      if (D.info(st.base).type === 'BLDG') base = W.placeBuilding(st.base, p, bx, bz, Math.round(face / (Math.PI / 4)) * (Math.PI / 4), true);
      else base = W.spawnUnit(st.base, p, bx, bz, 1, face);
    }
    const stand = base ? base.radius : 3;
    if (!bought) st.units.forEach((u, k) => { const a = face + Math.PI + (k - 1) * 0.5, r = stand + 5; W.spawnUnit(u, p, bx + Math.sin(a) * r, bz + Math.cos(a) * r, 1, face); });
    else if (s.type === 'human') {
      // the army of the setup's "My Army" page (ui/pointbuy.js), else the chosen default preset for the budget
      const total = PB.total(cfg.points, p.tribe);
      const army = s.army && s.armyTribe === p.tribe && s.armyPoints === cfg.points ? s.army : PB.load(PB.preset(p.tribe, cfg.points, s.preset || 'standard'), p.tribe, total);
      const made = PB.place(W, p, army, bx, bz, { stand, face, total, check: true });
      if (!base) base = made.find((u) => u.name === 'aje_resource_collector') || made[0] || null;
    } else p.pbStart = { credits: cfg.points, x: bx, z: bz, stand, face };        // bought when its brain starts (createBrains)
    if (base) homes.push(base);
  });
  // the map's objects of the start slots (a slot nobody plays: not placed), and those of nobody
  for (const o of S.owned || []) {
    const p = o.owner == null ? null : W.players.find((q) => q.hq === o.owner);
    if (o.owner != null && !p) continue;
    try {
      if (o.type === 'BLDG') W.placeBuilding(o.cls, p, o.x, o.z, o.rot, o.attr.building_ready !== '0');
      else W.spawn(o.cls, p, o.x, o.z, { level: Math.max(o.level, D.minLevel(o.cls, p)), heading: o.rot });
    } catch (e) { console.warn('map object not placed:', o.cls, e.message); }
  }
  for (const p of W.players) W.recomputeCaps(p);
  return homes;
}
// The computer players' brains: G.brains = Map<player id, brain>, each updated once per simulation slice.
// Skirmish: one TribeAI for the opponent (G.aiBrain; with ?aivai a second one plays the human side, G.meBrain).
function createBrains(cfg) {
  G.brains = new Map();
  G.aiBrain = null; G.meBrain = null;
  if (G.sequel) { G.brains = G.sequel.brains(TribeAI); return; }
  if (G.campaign) {
    // every AI slot of a campaign map sleeps ('ai_Mikrobe') until a trigger wakes it (AIBV); its difficulty is the
    // map's AI_Difficulty_Easy|Medium|Hard for the chosen campaign difficulty (CampaignMgr.usl:132-139).
    // Classes a brain will produce must be announced with G.campaign.needClass(cls) before the models load
    // (or the tribe added to G.campaign.fullTribes), see docs/CAMPAIGN_RUNTIME.md "Models".
    // Raids as the original makes them (pool units only where a tribe has no army tables), the remake's bigger
    // squads on Nightmare only.
    const C = G.campaign, key = ['easy', 'medium', 'hard'][C.difficulty] || 'medium';
    const levelName = 'Single ' + String(C.id).padStart(2, '0');
    for (const pl of C.players) {
      const d = pl && pl.data;
      if (!pl || pl === G.me || !d || !/^ai_/.test(d.control || '')) continue;
      const diff = d.ai_difficulty && d.ai_difficulty[key] != null ? d.ai_difficulty[key] : [1, 4, 8][C.difficulty] ?? 4;
      G.brains.set(pl.id, new TribeAI(G, pl, { difficulty: diff, behaviour: d.control.slice(3) || 'Mikrobe', mapOptions: (C.data.map && C.data.map.ai_options) || {}, multimap: false, levelName, extraSquads: !!C.nightmare }));
    }
    return;
  }
  if (cfg.slots) {
    // a skirmish setup: one brain per computer slot, its level and personality (ServerApp.usl:454-488)
    for (const p of G.world.players) {
      if (!p.ai) continue;
      const b = new TribeAI(G, p, { difficulty: p.slot.level, behaviour: p.slot.behaviour, multimap: true,
        mapOptions: { harbour: !!G.world.waterNav, watermap: !!G.world.waterNav, walls: false, markplace_outpost: false, hunt_animals: true, ...((G.mapSource && G.mapSource.aiOptions) || {}), warpgate: !!G.world.rules.warpgate } });
      G.brains.set(p.id, b);
      // its army for the budget: the AiPBPreset of its sub-strategy and difficulty (AIC:148-155, game/pointbuy.js)
      const st = p.pbStart;
      if (st) {
        const PB = G.pointBuy, pre = PB.aiPreset(p.tribe, st.credits, b.sub || 'G1', p.slot.level) || PB.preset(p.tribe, st.credits, 'standard');
        PB.place(G.world, p, PB.load(pre, p.tribe, -1, { buildings: false, mp: false }), st.x, st.z, { stand: st.stand, face: st.face });
        delete p.pbStart;
      }
      if (!G.aiBrain) G.aiBrain = b;
    }
    if (params.has('aivai')) { G.meBrain = new TribeAI(G, G.me, { difficulty: 5, behaviour: 'Giraffe', multimap: true, mapOptions: {} }); G.brains.set(G.me.id, G.meBrain); }
    return;
  }
  G.aiBrain = new TribeAI(G, G.ai, G.me, cfg.aiLevel);
  G.brains.set(G.ai.id, G.aiBrain);
  // test mode: the computer plays both sides (?aivai)
  if (params.has('aivai')) { G.meBrain = new TribeAI(G, G.me, G.ai, cfg.aiLevel); G.brains.set(G.me.id, G.meBrain); }
}
// tests: a computer player's brain for the human player (the scripted campaign playthroughs let it build the base)
G.playForMe = (opts) => { G.meBrain = new TribeAI(G, G.me, opts); G.brains.set(G.me.id, G.meBrain); return G.meBrain; };
// does the human player see what player p sees? Own things always; in a campaign also those of players who are
// friends in both directions (shared vision of allies: a guess, the fog of war is the engine's)
// the minimap's ping button (MiniMap2.usl: CGameWrap.SendMapPing; the player and the allies see it)
G.mapPing = (x, z) => {
  if (G.minimap) G.minimap.marker('Ping', x, z, G.minimap.ownerColor(G.me, 2));
  G.audio && G.audio.playFirst && G.audio.playFirst(['ui_minimap_ping_delivered']);
};
G.sees = (p) => !!p && (p === G.me || (!!G.campaign && G.me.isFriend(p) && p.isFriend(G.me)));

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
  let w = [...G.sel].find((u) => u.alive && u.owner === G.me && u.canBuild) || G.world.units.find((u) => u.alive && u.owner === G.me && u.isWorker && u.canBuild);
  if (!w) return [];
  // Taslow builds what the player's workers build (CommandBar.usl GetAvailableActions: "HACK!!! tesla can build stuff
  // too" - the class tesla_s0 is looked up as <tribe>_worker; the sequel's Taslov is a copy of him: Rules.kind)
  if (G.data.kind(w.name) === 'tesla_s0') { const o = w.rulesOwner(); w = { name: `${G.data.tree(o).tribe.toLowerCase()}_worker`, kind: 'unit', cls: 'CHTR', def: { type: 'CHTR' }, owner: w.owner, rulesOwner: () => o }; }
  // harbours only on maps with water
  const acts = G.data.actionsOf(w.rulesOwner(), w).filter((a) => a.cat === 'Build/BLDG' && a.visible && !a.disabled && (G.world.waterNav || !G.data.def(a.results[0].obj, G.me)?.coastal));
  return [...freeMainActions(), ...acts];
};
// the mobile base a campaign mission starts the Dustriders with (another tribe: the main building in its place) waits
// until a worker puts it down (campaign/setup.js freeMains): a build card of its own, free and at once
function freeMainActions() {
  const list = (G.me && G.me.freeMains || []).filter((u) => u.alive && u.parked);
  if (!list.length) return [];
  const real = G.data.actions(G.me).find((a) => a.results && a.results[0] && a.results[0].obj === list[0].name) || null;
  const loc = real && real.loc ? real.loc : {};
  return [{ ...(real || {}), id: 'free_main', kind: 'Build', cat: 'Build/BLDG', freeMain: list[0], visible: true, disabled: false, cost: {},
    req: [], breq: [], results: [{ obj: list[0].name }], loc: { ...loc, icon: loc.icon || iconFor(list[0].name) || 'aje_resource_collector_1', ui: { ...(loc.ui || {}), subcat: 'ECON', menupos: '0' } } }];
}
G.placeFreeMain = (a, x, z, rot) => {
  const C = G.campaign;
  if (!C || !a.freeMain || !C.placeFreeMain(a.freeMain, x, z, rot)) { G.hud.message(REASON.place || 'Cannot be placed here', 'bad'); G.feedback.error(); return false; }
  G.feedback.ui('UI_click');
  return true;
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
  if (a.freeMain) { G.input.setMode('place', a); return; }
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
// a wall line (tiles from G.world.wallLine) as the server places it (PlaceWall 0x490920): every tile is checked
// first, in order, with the earlier ones written (one failing tile: nothing is placed); then the new tiles in list
// order, existing ones skipped, until one cannot be paid. Every builder gets the first tile (queued with Ctrl) and
// every later tile queued (Q_Build).
G.placeWall = (action, tiles, workers, queued = false) => {
  const W = G.world, WM = W.wallMap, w = tiles && tiles.wall;
  if (!tiles || !w) return 0;
  const me = WM.ownerId(G.me);
  WM.begin();
  WM.scanObstacles(Math.min(...tiles.map((t) => t.i)) - 3, Math.min(...tiles.map((t) => t.j)) - 3, Math.max(...tiles.map((t) => t.i)) + 3, Math.max(...tiles.map((t) => t.j)) + 3);
  let bad = false;
  for (const t of tiles) {
    if (t.state === 'have') { if (!WM.hasOwn(t.i, t.j, me, w.race, w.type === 3 ? 3 : 0)) { bad = true; break; } continue; }
    if (!WM.placeable(t.i, t.j, me, w.race, w.cls, w.type)) { bad = true; break; }
    WM.write(t.i, t.j, me, w.race, w.cls, w.type);
  }
  WM.restore();
  if (bad) { G.hud.message(REASON.place || 'Cannot be placed here', 'bad'); G.feedback.error(); return 0; }
  let n = 0, why = null;
  const placed = [];
  for (const t of tiles) {
    if (t.state === 'have') continue;
    const b = W.startConstruction(G.me, action, t.x, t.z, 0, []);
    if (typeof b === 'string') { why = b; break; }
    placed.push(b);
    n++;
  }
  if (placed.length && workers.length) {
    const ws = workers.filter((u) => u.alive);
    // queued: after the piece the worker is building now (a worker doing anything else starts at once)
    if (queued) for (const u of ws) {
      const q = [...(u.buildQueue || []), ...placed];
      if (u.task.type === 'build') u.buildQueue = q;
      else { W.order([u], { type: 'build', target: q[0] }); u.buildQueue = q.slice(1); }
    }
    else { W.order(ws, { type: 'build', target: placed[0] }); for (const u of ws) u.buildQueue = placed.slice(1); }
    G.feedback.ordered('build', ws);
  }
  if (!n && why) { G.hud.message(REASON[why] || why, 'bad'); G.feedback.error(); }
  else if (why === 'cost') G.hud.message(REASON.cost, 'bad');
  else if (n && !workers.length) G.hud.message('Select workers and right-click the foundation to build it');
  return n;
};
G.changeLevel = (u, lv) => {
  const why = G.world.changeLevel(u, lv);
  if (why && why !== 'same') { G.hud.message(REASON[why] || why, 'bad'); G.feedback.error(); }
  else if (!why) G.feedback.ui('ui_click_pyramid');
};
G.levelUp = (u) => {
  const why = G.world.levelUp(u);
  if (why) G.hud.message(REASON[why] || why, 'bad');
};
G.order = (units, o) => G.world.order(units, o);
// Del: the first selected (Kill), Shift+Del: all of them (KillAll)
G.killSelected = (n = Infinity) => {
  for (const e of [...G.sel].filter((x) => x.alive && x.owner === G.me && x.kind !== 'res').slice(0, n)) { if (e.kind === 'building') G.world.selfDestruct(e); else G.world.kill(e, null); }
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
  if (G.input) G.input.selectionChanged();
  if (G.hud.menu && ![...G.sel].some((e) => e.owner === G.me)) G.hud.menu = null;
  if (G.sel.size && !silent) G.feedback.selected([...G.sel]);
};
G.centerOn = (e) => { if (e) { G.rtscam.x = e.pos.x; G.rtscam.z = e.pos.z; } };
G.homeEntity = () => G.world.buildings.find((b) => b.alive && b.owner === G.me) || G.world.units.find((u) => u.alive && u.owner === G.me);
G.openMenu = () => G.menu.main();
G.diplomacy = () => diplomacyWindow(G);
G.closeMenu = () => G.menu.close();
G.setPaused = (p) => { G.paused = p; document.body.classList.toggle('paused', p && !G.menuOpen); };
G.togglePause = () => { G.setPaused(!G.paused); G.hud.message(G.paused ? 'Paused' : 'Resumed'); };
G.togglePerf = () => { G.settings.perf = !G.settings.perf; saveSettings(G.settings); G.hud.perfEl.classList.toggle('hidden', !G.settings.perf); };
// how: 'next' (the next one, the camera goes there), 'add' (to the selection), 'all' (every idle worker)
G.selectIdleWorker = (how = 'next') => {
  const idle = G.world.units.filter((u) => u.alive && u.owner === G.me && u.isWorker && u.task.type === 'idle');
  if (!idle.length) { G.hud.message('No idle workers'); return; }
  if (how === 'all') { G.select(idle); return; }
  G.idleIdx = ((G.idleIdx || 0) + 1) % idle.length;
  const u = idle[G.idleIdx];
  if (how === 'add') { G.sel.add(u); G.selChanged(); return; }
  G.select([u]); G.centerOn(u);
};
// game speed by key (Keys.srf AccTime / DecTime / ResetTime): the steps of the Options' game speed
const SPEEDS = [0.5, 1, 1.5, 2];
G.setSpeed = (key) => {
  const i = SPEEDS.indexOf(G.settings.speed || 1);
  const v = key === 'NumpadMultiply' ? 1 : SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 1 : i) + (key === 'NumpadAdd' ? 1 : -1)))];
  G.settings.speed = v; saveSettings(G.settings);
  G.hud.message(`Game speed ${v === 1 ? 'normal' : '×' + v}`);
};

// ---------------------------------------------------------------------------- per-frame systems
function updateFow(force) {
  const viewers = [];
  if (G.reveals) G.reveals = G.reveals.filter((r) => r.until > G.world.time);
  const sees = G.sees;
  const k = G.sightScale || 1;                   // night (the sequel campaign: game/sequel/runtime.js)
  for (const u of G.world.units) if (u.alive && !u.parked && sees(u.owner)) viewers.push([u.pos.x, u.pos.z, u.fow * k]);
  // a building sees once it is finished (Building.usl UpdateFOW: a site's range is 0 - its workers see it)
  for (const b of G.world.buildings) if (b.alive && !b.parked && b.built && sees(b.owner)) viewers.push([b.pos.x, b.pos.z, b.fow * k]);
  if (G.sequel) for (const v of G.sequel.viewers()) viewers.push(v);
  for (const r of G.reveals || []) viewers.push([r.x, r.z, r.r]);        // oracle / fireworks
  for (const w of G.world.watchers) if (w.host.alive && sees(w.player)) viewers.push([w.host.pos.x, w.host.pos.z, w.host.fow * k]);   // MIRAGE parasites
  if (G.world.reveals.length) for (const r of G.world.revealsFor(sees)) viewers.push(r);     // missions (world.revealArea)
  G.fow.update(viewers);
  // hide what the player can't see
  for (const u of G.world.units) {
    if (!u.obj) continue;
    if (u.inside || u.parked) { u.obj.visible = false; continue; }
    if (u.wreck) { u.obj.visible = false; u.wreck.obj.visible = sees(u.owner) || G.fow.explored_(u.pos.x, u.pos.z); continue; }      // (a ship's wreck stands in for it)
    if (sees(u.owner)) { u.obj.visible = true; continue; }
    u.obj.visible = !u.alive ? u.obj.visible && G.fow.visible(u.pos.x, u.pos.z) || u.deadT > 0 && G.fow.explored_(u.pos.x, u.pos.z) : G.fow.visible(u.pos.x, u.pos.z) && !G.world.hiddenFrom(u, G.me);
  }
  for (const b of G.world.buildings) if (b.owner !== G.me) { const v = !b.parked && G.fow.explored_(b.pos.x, b.pos.z) && !(b.alive && G.world.hiddenFrom(b, G.me)); b.obj.visible = v; if (b.ruin) b.ruin.visible = v; }
  for (const p of G.world.projectiles) if (p.obj) p.obj.visible = G.fow.visible(p.pos.x, p.pos.z);
}

const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sph = new THREE.Sphere();
// onScreen: in the camera's view (animations play, sounds are heard). A model is drawn - and casts its shadow - only
// when it or its shadow can be in the view: the skinned models are never culled by three.js (assets.js cloneModel:
// their bounds are the bind pose), so every unit and animated building of the map was drawn twice (with its shadow)
// in every frame wherever it stood
const SHADOW_REACH = 0.8;                          // a shadow's length per metre of height (the sun: renderer.js sunOffset)
function cullUnits() {
  G.camera.updateMatrixWorld();              // (a cutscene's shot was set this frame: lookAt does not update the matrices)
  pm.multiplyMatrices(G.camera.projectionMatrix, G.camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(pm);
  for (const u of G.world.units) {
    sph.center.copy(u.pos); sph.center.y += u.height * 0.5; sph.radius = Math.max(u.radius, u.height) + 1;
    u.onScreen = frustum.intersectsSphere(sph);
    if (u.model) {
      // (at least 12 m around: the smoke and fire of a unit just outside keep drifting into the view)
      if (!u.onScreen) sph.radius += Math.max(12, u.height * SHADOW_REACH);
      u.model.visible = u.onScreen || frustum.intersectsSphere(sph);
    }
  }
  for (const b of G.world.buildings) {
    const h = b.ht || 10;
    sph.center.copy(b.pos); sph.center.y += h * 0.5; sph.radius = Math.max((b.radius || 5) + 12, Math.hypot(b.radius || 5, h * 0.5) + 2);
    b.onScreen = frustum.intersectsSphere(sph);
    if (b.model) {
      if (!b.onScreen) sph.radius += h * SHADOW_REACH;
      b.model.visible = b.onScreen || frustum.intersectsSphere(sph);
    }
  }
}

// three.js recomputes the world matrix of every object in the scene before each render: 69,000 objects in a big
// mission (a clay wall piece alone is 826 - all its arms and variants), most of them parts that never move. A building
// that does not move or animate where the player can see it (or its shadow) keeps its matrices until its position,
// turn or look changes; a unit out of sight and out of the shadow area is not updated until it comes back. Such an
// object is skipped by the scene's update (stillUpdate) - three.js itself walks every child even of an object whose
// matrixWorldAutoUpdate is off.
const STILL_R = 140;                               // the shadow area around the camera target (renderer.js: 105 / 130)
const animating = (a) => !!(a && a.cur && !a.cur.paused && a.cur.isRunning());
function stillUpdate(force) { if (!this.still || force) THREE.Object3D.prototype.updateMatrixWorld.call(this, force); }
function setStill(o, still) {
  if (o.updateMatrixWorld !== stillUpdate) o.updateMatrixWorld = stillUpdate;
  if (still && !o.still) o.updateMatrixWorld(true);         // up to date once more as it stops
  o.still = still;
}
function freezeStill() {
  const W = G.world, t = G.rtscam.target;
  // an object whose own matrix is recomputed forces its whole subtree: the scene and the entity containers
  // (identity, never moved) keep theirs
  if (G.scene.matrixAutoUpdate) {
    for (const o of [G.scene, ...G.scene.children]) if (o.isScene || (o.isGroup && o.position.lengthSq() === 0 && o.quaternion.w === 1 && o.scale.x === 1)) { o.updateMatrix(); o.matrixAutoUpdate = false; }
  }
  const near = (p, r) => Math.abs(p.x - t.x) < STILL_R + r && Math.abs(p.z - t.z) < STILL_R + r;
  for (const u of W.units) if (u.obj) setStill(u.obj, u.onScreen === false && !near(u.pos, u.radius));
  for (const b of W.buildings) {
    const o = b.obj;
    if (!o) continue;
    const seen = b.onScreen || near(b.pos, b.radius);
    // (o.userData.live: a part that moves by itself - the sequel's windmill rotors, water wheels, searchlight lamps)
    if (seen && (!b.built || b.turret || b.cranes.length || o.userData.live || animating(b.anim) || (b.parts || []).some((p) => animating(p.anim)))) { setStill(o, false); continue; }
    // (the pose of the last animation: one that ran while nobody looked - a gate opened by the mission far away -
    // still has to show its end)
    const a = b.anim, cur = a && a.cur, run = !!cur && animating(a);
    const pn = cur ? a.curName : '', pt = cur && !run ? Math.round(cur.time * 100) : 0, pw = cur && !run ? Math.round(cur.getEffectiveWeight() * 100) : 0;
    // a change (moved, other parts, another pose): drawn live this round, frozen once it holds (the new pose may
    // only be applied by the next animation update). (Compared field by field: a key string per building and frame
    // was garbage for the collector.)
    const k = o.userData.stillKey || (o.userData.stillKey = {});
    if (k.x !== o.position.x || k.y !== o.position.y || k.z !== o.position.z || k.r !== o.rotation.y || k.s !== o.scale.x || k.v !== b.visKey || k.pn !== pn || k.pt !== pt || k.pw !== pw) {
      k.x = o.position.x; k.y = o.position.y; k.z = o.position.z; k.r = o.rotation.y; k.s = o.scale.x; k.v = b.visKey; k.pn = pn; k.pt = pt; k.pw = pw;
      setStill(o, false);
      continue;
    }
    setStill(o, true);
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
  if (G.campaign) G.campaign.evAt = 0;     // its read position in the list (game/campaign/setup.js update): the list starts again
  if (G.sequel) G.sequel.evAt = 0;
}

let endT = 0;
// a player is out when nothing that could rebuild is left (no building, no worker, no Aje collector);
// the warp gate countdown (systems/buildings.js) ends the game directly
function checkEnd(dt) {
  endT -= dt;
  // a campaign mission ends only when its triggers say so (G.endMission): no built-in victory or defeat
  // (GameOverMgr.usl:95-103 enables the rule for multiplayer maps only)
  if (endT > 0 || G.over || G.campaign || G.sequel) return;
  endT = 1;
  const W = G.world;
  // (who is out, who wins: game/systems/gameover.js, run with the world)
  const lost = G.me.defeated, won = G.me.won;
  if (!lost && !won) return;
  G.over = true;
  const t = Math.floor(W.time);
  setTimeout(() => G.menu.end(won && !lost, { time: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, kills: G.me.kills, lost: G.me.lost, epoch: EPOCH[G.me.epoch()], enemy: G.ai.name }), 1500);
}

let fowT = 0;
function simulate(dt) {
  const W = G.world;
  let left = dt;
  while (left > 1e-4) {
    const s = Math.min(0.05, left);
    W.update(s);
    for (const b of G.brains.values()) b.update(s);
    if (G.campaign) G.campaign.update(s);
    if (G.sequel) G.sequel.update(s);
    if (G.mission) G.mission.tick(s);
    left -= s;
  }
  handleEvents();
  checkEnd(dt);
  fowT -= dt;
  if (fowT <= 0) { fowT = 0.2; updateFow(); }
}

// the player's home objects, for the music's Hometown switch (engine/music.js)
function homes() {
  const name = HOME_CLASS[G.me.tribe], W = G.world, out = [];
  if (name) for (const e of [...W.buildings, ...W.units]) if (e.alive && e.owner === G.me && e.name === name) out.push(e.pos);
  return out;
}
// the ambience's state (engine/atmo.js): the ground material in the middle of the view (above 20 m) or under the
// camera, the camera more than 12 m above the ground, day or night
function atmoState() {
  const S = G.mapSource, W = G.world, cam = G.camera.position, t = G.rtscam.target;
  const above = cam.y - W.height(cam.x, cam.z);
  const p = above > 20 ? t : cam;
  return Atmo.state(S.soundMat ? S.soundMat(p.x, p.z) : 2, above > 12, !W.isNight());
}
// one frame of presentation. Each step is guarded: an error in one (e.g. the minimap) must not stop the others,
// and the player sees the error text instead of a frozen black screen (ui/diagnostics.js).
const DRAW_STEPS = [
  ['input', (dt) => G.input.update(dt)],
  ['camera', (dt) => (G.seqCam ? G.seqCam(dt) : G.rtscam.update(dt))],      // (a cutscene's shot: ui/cutscene.js)
  ['culling', () => { cullUnits(); updateHoles(); freezeStill(); }],
  ['props', () => { G.props.update(G.camera); G.foliage.update(G.camera.position); if (G.grass && G.grass.mesh.visible) G.grass.update(G.rtscam.target, performance.now() / 1000); }],
  ['sun', () => G.renderer.followSun(G.rtscam.target)],
  ['effects', (dt) => { G.fx.update(dt); G.mfx.update(dt); G.weather.update(G.seqWeather !== undefined ? G.seqWeather : G.world.weatherNow(), G.rtscam.target, dt); }],
  ['audio', (dt) => { G.audio.listener.copy(G.rtscam.target); G.audio.yaw = G.rtscam.yaw; G.audio.mus.update(G.world.time, G.audio.listener, homes); G.audio.atmo.update(dt, atmoState(), G.world.time); }],
  ['overlay', (dt) => G.overlay.update(dt)],
  ['logs', () => G.logs && G.logs.update()],
  ['hud', (dt) => G.hud.update(dt)],
  ['minimap', (dt) => G.minimap.update(dt)],
  ['mission', (dt) => { if (G.mission) G.mission.update(dt); if (G.sequelUI) G.sequelUI.update(dt); }],
];
// where a frame's time goes (the performance overlay, F9): ms per step, smoothed
const prof = G.prof = {};
const timed = (name, t0) => { const t = performance.now(); prof[name] = (prof[name] || 0) * 0.95 + (t - t0) * 0.05; return t; };
function draw(dt, now) {
  let t = performance.now();
  for (const [name, fn] of DRAW_STEPS) { try { fn(dt); } catch (e) { loopError(name, e); } t = timed(name, t); }
  try { G.renderer.render(now); } catch (e) { loopError('render', e); }
  t = timed('render', t);
  // the model emitters after the render: their nodes' world matrices are those just drawn (new sprites are shown
  // from the next frame)
  try { G.particles.update(dt, G.camera, G.rtscam.target, G.renderer.renderer.getPixelRatio()); } catch (e) { loopError('particles', e); }
  timed('particles', t);
}

// Autosave (IngameScreen.usl UpdateAutosaveTimer, Game.usl OnTick / OnAutosave): every 5 .. 60 minutes of real time
// (options, 10 by default) the game goes into the slot "Autosave" - not while it is paused or a cutscene runs, then at
// the next moment it can
let autosaveAt = 0, autosaveDue = false;
function autosave(now) {
  const s = G.settings;
  if (!G.ready || G.over || G.loading || s.autosave === false) { autosaveAt = 0; return; }
  const every = Math.min(60, Math.max(5, s.autosaveMin || 10)) * 60000;
  if (!autosaveAt) autosaveAt = now + every;
  if (now >= autosaveAt) { autosaveDue = true; autosaveAt = now + every; }
  if (!autosaveDue || G.paused || G.menuOpen || (G.mission && G.mission.busy())) return;
  autosaveDue = false;
  G.saveGame('Autosave', { id: 'autosave', silent: true })
    .then(() => G.hud.message(G.data.ui('_NT_SavingGame', 'Saving game ...'), 'good'))
    .catch((e) => console.warn('autosave', e));
}

G.autosaveDue = () => { autosaveDue = true; autosave(performance.now()); };          // (tests: the frame loop's step)

let last = 0;
function frame(now) {
  if (G.exited) return;
  requestAnimationFrame(frame);
  if (!G.renderer.shouldRender(now)) return;
  const dt = Math.min(0.1, (now - (last || now)) / 1000);
  last = now;
  const t0 = performance.now();
  if (!G.paused) { try { simulate(dt * (G.settings.speed || 1)); } catch (e) { loopError('simulation', e); } }
  timed('simulation', t0);
  draw(dt, now);
  timed('frame', t0);
  autosave(now);
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
G.drawNow = (dt = 0.05) => draw(dt, performance.now());          // (tests: one frame drawn in ?manual mode)
G.renderOnce = () => { draw(0.016, performance.now()); };
G.updateFow = () => updateFow(true);      // the mission UI refreshes the fog when a cutscene starts (the game stands still then)

// ---------------------------------------------------------------------------- start-up
// ?manual / ?quick start straight into a skirmish (tests); ?tribe=Hu&enemy=Ninigi pick the tribes.
// "Restart" and "Play again" reload the page with the skirmish stored in sessionStorage.
function quickConfig() {
  // ?campaign=<mission 0-16>[&difficulty=0|1|2][&tribe=Hu|Aje|Ninigi|SEAS]: a campaign mission (tribe: played with that tribe)
  // ?sequel=<mission 1-11>[&difficulty=0|1|2]: a mission of the sequel campaign (docs/SEQUEL.md)
  if (params.has('sequel')) return { sequel: +params.get('sequel'), difficulty: params.has('difficulty') ? +params.get('difficulty') : 1, debug: params.has('debug') && params.get('debug') !== '0' };
  // ?scenario=<1-5>&tribe=<Hu|Aje|Ninigi|SEAS>[&difficulty=0|1|2]: a scenario (docs/SCENARIOS.md)
  if (params.has('scenario')) return { scenario: +params.get('scenario'), tribe: params.get('tribe') || 'Hu', difficulty: params.has('difficulty') ? +params.get('difficulty') : 1, debug: params.has('debug') && params.get('debug') !== '0' };
  if (params.has('campaign')) return { campaign: +params.get('campaign'), difficulty: params.has('difficulty') ? +params.get('difficulty') : 1, tribe: params.get('tribe') || '', debug: params.has('debug') && params.get('debug') !== '0' };
  const k = { ...G.settings.skirmish };
  if (params.has('tribe')) k.me = params.get('tribe');
  if (params.has('enemy')) k.ai = params.get('enemy');
  if (params.has('seed')) k.seed = +params.get('seed');
  if (params.has('color')) k.meColor = params.get('color');
  if (params.has('map')) k.map = params.get('map');
  if (params.has('aicolor')) k.aiColor = params.get('aicolor');
  if (params.has('debug')) k.debug = params.get('debug') !== '0';
  // a skirmish of up to 8 (game/skirmish.js): ?players=Hu,Aje,Ninigi,SEAS (the first is yours) [&teams=1,2,1,2]
  // [&levels=5,5,5] [&aib=Dodo,Schnecke] [&hq=0,2,1,3: chosen start locations] [&mode=domination|defender] [&fog=0] [&points=1000]
  if (params.has('players')) {
    const setup = defaultSetup(k), list = params.get('players').split(','), arr = (n) => (params.get(n) || '').split(',').filter((x) => x !== '');
    setup.slots.forEach((sl, i) => {
      if (i >= list.length) { sl.type = 'closed'; return; }
      sl.type = i === 0 ? 'human' : 'ai'; sl.tribe = list[i];
      if (arr('teams')[i]) sl.team = +arr('teams')[i];
      if (arr('levels')[i - 1]) sl.level = +arr('levels')[i - 1];
      // &aib=Dodo,Giraffe: the computer players' personalities (by AI slot)
      const pers = { Dodo: 'Offensive', Giraffe: 'Balanced', Schnecke: 'Defensive', Mikrobe: 'Passive' }[arr('aib')[i - 1]];
      if (pers) sl.personality = pers;
      if (arr('hq')[i]) { sl.hq = +arr('hq')[i]; setup.chooseHQ = true; }
    });
    setup.teams = Math.max(...setup.slots.filter((x) => x.type !== 'closed').map((x) => x.team));
    if (params.has('mode')) setup.mode = params.get('mode');
    if (params.has('fog')) setup.fog = params.get('fog') !== '0';
    setup.points = params.has('points') ? +params.get('points') : -1;
    return setup;
  }
  return k;
}
function applySettings(s) {
  G.audio.muted = !s.sound;
  Object.assign(G.audio.vol, { master: s.volMaster, sfx: s.volSfx, voice: s.volVoice, music: s.volMusic, atmo: s.volAtmo ?? 0.8 });
  G.audio.applyVolumes();
  if (G.renderer) { G.renderer.setShadows(s.shadows); G.renderer.resize(); }
  if (G.grass) { G.grass.visible = s.grass !== 'off'; G.grass.invalidate(); }
  if (G.particles) G.particles.level = s.particles || 'on';
  if (G.weather) G.weather.enabled = s.weather !== false;
  if (G.hud) { G.hud.scale(); G.hud.perfEl.classList.toggle('hidden', !s.perf); }
}
// ---------------------------------------------------------------------------- maps
// cfg.map: '' = random jungle, 'maps/<folder>/<file>.ula' = a map served next to the game (server.ps1 serves the
// game's Data/Base/Maps folder there), 'file:' = a map file the player picked (kept in sessionStorage for restarts)
// a region of the map by name (lakes): the campaign's regions, else those of the original map (maps/ula.js regions)
function mapRegions(G, S) {
  if (G.campaign) return (n) => G.campaign.regions.find(n);
  if (!S.regions || !S.regions.length || !S.origin) return () => null;
  const [ox, oy] = S.origin;
  const R = new Regions(S.regions.map((r) => ({ guid: r.name, name: r.name, shapes: r.shapes.map((q) => ({ type: q.oval ? 'oval' : 'rect', enabled: q.enabled, x: q.x, y: q.y, w: q.w, h: q.h })) })),
    (mx, my) => [mx - ox, my - oy], (x, z) => [x + ox, z + oy]);
  return (n) => R.find(n);
}
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
  // ?spawn=<class>,<class>: their models too (put down after the start: the Workshop's "try it in the remake")
  if (params.has('spawn')) for (const g of spawnModels(G.data, params.get('spawn').split(',').filter(Boolean))) need.add(g);
  for (const sp of new Set([...S.animals, ...(S.nests || [])].map((a) => a.species))) {
    for (let l = 1; l <= 5; l++) { const s = G.data.stats(sp, l, null); if (s && s.gfx) need.add(s.gfx.toLowerCase()); }   // gfx can change per level
    const cg = G.data.classGfx(sp);           // the class file's model when the tech tree gfx doesn't exist (Tsintaosaurus -> iguanodon)
    if (cg) need.add(cg);
  }
  const key = { Jungle: 'jun', Northland: 'nor', Savanna: 'sav', Icewaste: 'ice', Ashvalley: 'ash' }[S.setting] || 'jun';
  need.add('fx_heal_area');                       // (the temples' healing glow: entities.js READY_FX)
  need.add('fx_heal_passive');                    // (a unit being healed: ui/feedback.js healGlow)
  need.add('fx_unique_pickup');                   // (a unit carrying an item: ui/feedback.js itemGlow)
  for (const n of Object.keys(Assets.manifest.models)) if (GAME_FX_MODEL.test(n)) need.add(n);   // (the game's effects: ui/gamefx.js)
  for (const n of MIRAGE_FX_MODELS) need.add(n);  // (MIRAGE's moves: game/systems/moves_mirage.js)
  for (const n of ['product_wood_jun', 'product_stone_jun', `product_wood_${key}`, `product_stone_${key}`, 'jungle_tree_01_stump', 'jungle_tree_01_timber', 'jungle_tree_02_timber', 'jungle_fruit_bush']) need.add(n);
  return need;
}
async function startGame(cfg) {
  try {
    // ?cheats=<json>: debug options (game/cheats.js; tests)
    if (params.has('cheats') && !cfg.cheats) { try { cfg = { ...cfg, cheats: { on: true, ...JSON.parse(params.get('cheats')) } }; } catch (e) { console.warn('?cheats: ' + e.message); } }
    G.config = cfg;
    loadEl.classList.remove('done');
    loadEl.style.display = '';
    // a saved game (cfg.load = its slot): the game it was started as, then the saved state on top (game/save.js)
    let saved = null;
    if (cfg.load) {
      progress(0.02, 'Reading the saved game…');
      saved = (await getSave(cfg.load)).snap;
      G.loading = true;
      if (saved.mapfile) try { sessionStorage.setItem('pwr.mapfile', saved.mapfile); } catch (e) { /* ignore */ }
      cfg = G.config = { ...cfg };
      delete cfg.load;
    }
    let S;
    if (cfg.sequel != null) {
      // the sequel campaign (docs/SEQUEL.md): its own classes in the tech tree, its own maps and mission scripts, on
      // the MIRAGE mod's data (ui/menu.js switches to it)
      if (Menu.dataMod(G) !== SEQUEL_MOD) throw new Error(`ParaWorld: Containment is played with the ${SEQUEL_MOD} mod's game data (this page has ${Menu.dataMod(G) || 'the official game'}'s): start it from the menu`);
      progress(0.03, 'Preparing the mission…');
      const ch = configCheats(cfg);
      const locked = ch && ch.unlock ? new Set() : lockedBefore(cfg.sequel);              // what later missions bring in (debug option "no mission bans": nothing)
      const d = sequelData(G.raw.tt, G.raw.json, locked);
      G.data = new Rules(d.tt, d.extra);
      G.campaign = null;
      cfg.sqOrder = SEQUEL_ORDER;                   // (the missions' numbering: a saved game keeps it, G.loadSaved)
      G.sequel = new Sequel(G, cfg);
      G.sequel.locked = locked;
      S = G.sequel.source();
      const need = mapModels(S);
      for (const m of G.sequel.models()) need.add(m);
      await loadModels(G.sequel.tribes(), need);
    } else if (cfg.scenario != null) {
      // a scenario (docs/SCENARIOS.md): the sequel's mission runtime with the game's own rules and data, played as
      // any tribe (game/scenarios/missions.js)
      progress(0.03, 'Preparing the scenario…');
      G.campaign = null;
      G.sequel = new Sequel(G, cfg);
      G.sequel.locked = new Set();
      S = G.sequel.source();
      const need = mapModels(S);
      for (const m of G.sequel.models()) need.add(m);
      await loadModels(G.sequel.tribes(), need);
    } else if (cfg.campaign != null) {
      // a campaign mission (game/campaign/setup.js): its map's landscape + the world of the mission data
      progress(0.03, 'Reading the mission…');
      const C = G.campaign = new Campaign(G, await loadCampaign(cfg.campaign), cfg).plan(G.data, Assets.manifest.models);
      S = await mapSource({ map: C.entry.map, skipObjects: C.skip });
      const need = mapModels(S);
      for (const m of C.models()) need.add(m);
      await loadModels(C.fullTribes, need);
    } else {
      G.campaign = null;
      S = await mapSource(cfg);
      // a skirmish setup: random tribes and start locations are drawn now (their models load)
      G.resolved = cfg.slots ? resolveSetup(cfg, S) : null;
      await loadModels(G.resolved ? [...new Set(G.resolved.map((s) => s.tribe))] : [cfg.me, cfg.ai], mapModels(S));
    }
    await buildWorld(cfg, S);
    if (G.campaign) G.mission = new MissionUI(G);
    if (G.sequel) {
      G.sequelUI = new SequelUI(G, G.sequel);
      G.world.hooks.damage = (d, A, V) => G.sequel.damageHook(d, A, V);
      G.world.hooks.lethal = (V, A) => G.sequel.lethalHook(V, A);       // tranquilized creatures sleep instead of dying
      G.world.hooks.power = (u, b, sec) => G.sequel.grid.credit(u, b, sec);       // electricity (game/sequel/power.js)
    }
    if (saved) {
      progress(0.98, 'Loading the saved game…');
      const oldFlags = G.world.go ? G.world.go.flags : [];
      const r = restore(G, saved);
      if (G.sequel) G.sequel.id = +cfg.sequel;          // (the mission's number as the game started it: renumbered saves)
      // the domination flags' models (not saved: systems/gameover.js)
      for (const f of oldFlags) if (f.look && f.look.obj) f.look.obj.removeFromParent();
      if (G.world.go) for (const f of G.world.go.flags) G.world.flagLook(f);
      console.log('loaded a saved game:', r);
      for (const u of G.world.units) if (u.alive && u.item) G.feedback.itemGlow(u, true);   // (the carriers' glow)
      G.rtscam.update(0.016);
      updateFow(true);
      G.selChanged();
      G.loading = false;
    }
    progress(1, 'Ready');
    loadEl.classList.add('done');
    setTimeout(() => { loadEl.style.display = 'none'; }, 600);
    G.menu.inGame = true;
    if (G.sequelUI && !saved) G.sequelUI.briefing();
    if (saved) G.hud.message('Game loaded', 'good');
    else if (G.sequel) G.hud.message(G.sequel.def.title, 'good');
    else if (G.campaign) { if (!G.mission || G.mission.manual) G.hud.message(G.campaign.map.title || G.campaign.map.name, 'good'); }     // else: the title card (ui/mission.js)
    else G.hud.message(`Build up your settlement and defeat the ${G.ai.name}.`, 'good');
    // the level's playlist; a generated map goes by its setting's atmosphere file ("jungle.txt")
    G.audio.mus.startGame({ levelName: S.levelName || '', atmos: S.atmos || `${String(S.setting || '').toLowerCase()}.txt`, tribe: G.me.tribe || cfg.me });
    G.audio.atmo.start(S.kind === 'original' ? S.atmos : `${String(S.setting || 'jungle').toLowerCase()}.txt`);   // ("No Atmos": none)
    // ?spawn=<class>,...[&spawnside=me|foe|wild][&spawnlevel=n]: those objects beside your start (the Workshop)
    if (params.has('spawn') && !saved) {
      const h = G.homeEntity(), side = params.get('spawnside') || '', lv = +params.get('spawnlevel') || 1;
      params.get('spawn').split(',').filter(Boolean).forEach((n, i) => {
        const ix = G.data.info(n), a = i * 1.3 + 0.6, r = (h ? h.radius || 3 : 3) + (ix && ix.type === 'BLDG' ? 22 : 9);
        const x = (h ? h.pos.x : 0) + Math.cos(a) * r, z = (h ? h.pos.z : 0) + Math.sin(a) * r;
        const got = spawnObject(G, n, side || (ix && ix.tribe === 'World' ? 'wild' : 'me'), x, z, lv);
        if (typeof got === 'string') G.hud.message(got, 'bad');
        else { G.hud.message(`${G.data.text(n, got.owner).name || n} is here`, 'good'); G.spawned = (G.spawned || []).concat(got); }
      });
      if (G.spawned && G.spawned[0]) G.centerOn(G.spawned[0]);
    }
    if (!MANUAL) requestAnimationFrame(frame);
    G.ready = true;
  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    loadTxt.textContent = 'Error: ' + e.message;
    G.error = e.message;
    reportError('start-up', e);
  }
}
// The end of a campaign mission, called by the trigger engine (QUIT / SQNZ quit = won, GAOV = lost):
// info = { text (the reason line, already resolved), delay (seconds before the end screen, default 1.5), points (bonus points, optional) }
G.endMission = (won, info = {}) => {
  if (G.over) return;
  G.over = true;
  const W = G.world, t = Math.floor(W.time), C = G.campaign;
  const show = () => G.menu.end(!!won, {
    time: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, kills: G.me.kills, lost: G.me.lost, epoch: EPOCH[G.me.epoch()],
    mission: C ? { title: C.map.title || C.map.name, text: info.text || '', next: won && C.next() ? C.next() : null, difficulty: C.nightmare ? 3 : C.difficulty, points: info.points }
      : G.sequel && G.sequel.kind === 'scenario' ? { sequel: true, scenario: true, tribe: G.sequel.tribe, title: G.sequel.def.title, text: info.text || '', next: won && G.sequel.id < SCENARIOS.length ? { id: G.sequel.id + 1 } : null, difficulty: G.sequel.difficulty }
      : G.sequel ? { sequel: true, title: G.sequel.def.title, text: info.text || '', next: won && G.sequel.id < LAST_MISSION ? { id: G.sequel.id + 1 } : null, difficulty: G.sequel.difficulty } : null,
    text: info.text || '',
  });
  G.endInfo = { won: !!won, text: info.text || '', points: info.points };
  // the next mission's army budget: the bonus points earned here, never less than before (CampaignMgr.usl:145-183)
  const next = won && C && C.next();
  if (next) {
    const k = G.settings.campaign, cr = k.credits || (k.credits = {});
    cr[next.id] = Math.max(cr[next.id] || 0, C.boni || 0);
    saveSettings(G.settings);
  }
  if (MANUAL || info.delay === 0) show(); else setTimeout(show, (info.delay == null ? 1.5 : info.delay) * 1000);
};
// ---------------------------------------------------------------- saved games (game/save.js, ui/saves.js)
G.saveSettings = saveSettings;
G.saveTitle = () => {
  if (G.sequel && G.sequel.kind === 'scenario') return `Scenario ${G.sequel.id}: ${G.sequel.def.title} (${G.sequel.tribe})`;
  if (G.sequel) return `Containment ${G.sequel.id}: ${G.sequel.def.title}`;
  const C = G.campaign;
  if (C) return C.map.title || C.map.name || 'Mission ' + C.id;
  return `${G.me.name} against ${G.ai ? G.ai.name : 'the computer'}`;
};
// save the running game in a slot (opts.id: replace that save; opts.quick: the quick save slot)
G.saveGame = async (name, opts = {}) => {
  if (!G.world || !G.ready) throw new Error('no game is running');
  if (G.over) throw new Error('the game is over');
  updateFow(true);                             // the explored map as of now (a loaded game draws it at once)
  const snap = snapshot(G);
  if (snap.problems.length) console.warn('saved game: left out', snap.problems.slice(0, 30));
  if (String(G.config.map || '').startsWith('file:')) try { snap.mapfile = sessionStorage.getItem('pwr.mapfile'); } catch (e) { /* ignore */ }
  const meta = await putSave({ id: opts.id || undefined, quick: !!opts.quick, name, title: G.saveTitle(), gameTime: G.world.time, mod: CONFIG_MOD, cfg: G.config }, snap);
  if (!opts.silent) G.hud.message(opts.quick ? 'Quick saved' : `Saved "${name}"`, 'good');
  return meta;
};
// load a saved game: the page starts again with the game it was (in its game data configuration) and restores it
G.loadSaved = async (meta) => {
  const cfg = { ...meta.cfg, load: meta.id };
  if (cfg.sequel) { cfg.sequel = renumbered(cfg.sequel, cfg.sqOrder); cfg.sqOrder = SEQUEL_ORDER; }   // (a save of the old numbering)
  if ((meta.mod || '') !== CONFIG_MOD) return G.menu.openConfig(meta.mod || '', cfg);
  try { sessionStorage.setItem('pwr.autostart', JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  location.reload();
};
G.saveState = () => { updateFow(true); return snapshot(G); };             // (tests)
G.quickSave = () => { if (!G.over) G.saveGame('Quick save', { quick: true }).catch((e) => G.hud.message('Not saved: ' + e.message, 'bad')); };
G.quickLoad = async () => {
  const q = (await listSaves()).find((m) => m.id === quickId);
  if (!q) { G.hud.message('There is no quick save yet', 'bad'); return; }
  G.loadSaved(q);
};

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
      // "Next mission": the page reloads into the given mission like a restart
      startCampaign: (cfg) => { try { sessionStorage.setItem('pwr.autostart', JSON.stringify(cfg)); } catch (e) { /* ignore */ } location.reload(); },
      restart: () => { try { sessionStorage.setItem('pwr.autostart', JSON.stringify(G.config)); } catch (e) { /* ignore */ } location.reload(); },
      quit: () => { try { sessionStorage.removeItem('pwr.autostart'); } catch (e) { /* ignore */ } location.reload(); },
      exit: exitGame,
      applySettings, sound: (n) => G.feedback ? G.feedback.ui(n) : G.audio.play(n),
      saves: listSaves, save: (name, id) => G.saveGame(name, { id }), load: (meta) => G.loadSaved(meta), saveName: () => G.saveTitle(),
      deleteSave, exportSave, importSave,
    });
    applySettings(G.settings);
    // the browser only allows audio after a user gesture
    const unlock = () => { G.audio.init(); G.audio.applyVolumes(); G.audio.mus.update(0); G.audio.mus.resume(); window.removeEventListener('pointerdown', unlock); };
    window.addEventListener('pointerdown', unlock);
    let auto = null;
    try { auto = JSON.parse(sessionStorage.getItem('pwr.autostart') || 'null'); sessionStorage.removeItem('pwr.autostart'); } catch (e) { auto = null; }
    if (MANUAL || params.has('quick')) auto = quickConfig();
    // ?load=<slot>: a saved game (tests)
    if (params.has('load')) { const doc = await getSave(params.get('load')); auto = { ...doc.meta.cfg, load: params.get('load') }; }
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
