// The level: an original ParaWorld map turned into a place to run around in.
//
//   const level = await loadLevel(scene, { map: 'data/maps/Base/Cpn_single_001/single_05.ula' }, progress);
//   level.height(x, z)        terrain height (m)
//   level.collision           triangle soup of everything solid (collision.js): walls, houses, bridges, stairs
//   level.objects             every placed map object {type, cls, name, model, x, y, z, rot} in game coordinates
//   level.find(/hc_gate/)     objects by class name
//
// Coordinates: the game uses x east, z south, y up, with (0, 0) in the middle of the map (the map file has x east,
// y north, z up with the origin in a corner): game x = map x - ox, game z = oy - map y.
// The map reader, terrain shader, instanced props and foliage sprites are the remake's (src/pw/, copied from
// remake/src), so the level looks exactly like it does there.
import * as THREE from 'three';
import { parseUla } from '../pw/game/maps/ula.js';
import { HeightField, buildTerrain, fowUniforms, fbm } from '../pw/engine/terrain.js';
import { PropField, FoliageField, treeSprites, spriteLight } from '../pw/engine/props.js';
import { buildWater } from '../pw/engine/water.js';
import { Assets, loadModel } from '../pw/engine/assets.js';
import { CollisionWorld } from './collision.js';
import { glowSprites } from './fx.js';
import { CFG } from './config.js';

const lc = (s) => String(s || '').toLowerCase();
// map object types that are scenery (drawn as instanced props)
const SCENERY = new Set(['DCCO', 'DECO', 'VGTN', 'WOOD', 'TREE', 'BLDG', 'STON', 'FRUI', 'FNTN', 'SHIP']);
const NO_PROP = /^(startlocation|itemspawn|domination_flag|questmark|region|virtual_|ninigi_snare_trap)/;

// one texture per file for the foliage sprites
const spriteTex = new Map();
function spriteTexture(uri) {
  const file = String(uri || '').split('/').pop();
  if (!spriteTex.has(file)) {
    const t = new THREE.TextureLoader().load(Assets.base + 'tex/' + file);
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    spriteTex.set(file, t);
  }
  return spriteTex.get(file);
}

// The remake's PropField re-packs the visible instances whenever the camera moves (an RTS camera rarely does). Here
// the camera turns every frame and the whole city is only ~430 000 triangles, so every instance is written once and
// simply always drawn: no per-frame work, and shadows of things outside the view stay.
function showAll(props) {
  props.build();
  const tmp = new THREE.Matrix4();
  for (const k of props.kinds.values()) {
    for (const im of k.meshes) {
      const arr = im.instanceMatrix.array, pm = im.userData.partMatrix;
      let n = 0;
      for (const it of k.inst) { if (!it.alive) continue; tmp.multiplyMatrices(it.m, pm).toArray(arr, n * 16); n++; }
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
  }
}

export async function loadLevel(scene, cfg, progress = () => {}) {
  progress(0.02, 'Reading the map');
  const buf = await (await fetch(cfg.map)).arrayBuffer();
  const md = await parseUla(buf, cfg.map.split('/').pop());
  const gamedata = cfg.gamedata;
  const manifest = Assets.manifest.models;
  const has = (m) => !!(m && manifest[m]);
  const gfxOf = (cls) => { const c = lc(cls); const g = gamedata.classgfx[c] || c; return has(g) ? g : has(c) ? c : null; };

  // ---------------------------------------------------------------- ground
  const W2 = md.hx * 2, H2 = md.hy * 2;                        // terrain extent (m)
  const size = Math.ceil(Math.max(W2, H2) / 16) * 16;
  const ox = W2 / 2, oy = H2 / 2;
  const toGame = (mx, my) => [mx - ox, oy - my];
  const hx = md.hx, hy = md.hy, HS = md.heights;
  const mapHeight = (x, z) => {                                 // bilinear on the map's 2 m grid
    let fx = (x + ox) / 2, fy = (oy - z) / 2;
    fx = Math.max(0, Math.min(hx - 1.001, fx)); fy = Math.max(0, Math.min(hy - 1.001, fy));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const a = HS[j * hx + i], b = HS[j * hx + i + 1], c = HS[(j + 1) * hx + i], d = HS[(j + 1) * hx + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  const hf = new HeightField(size, 2, mapHeight);
  const height = (x, z) => hf.at(x, z);
  // ground materials on the map's 4 m grid -> 8 texture weights, with noisy borders (as in the remake)
  const mx = md.mx, my = md.my, MT = md.mats;
  const tap = (w, x, z, k) => {
    const fx = Math.max(0, Math.min(mx - 1.001, (x + ox) / 4 - 0.5)), fy = Math.max(0, Math.min(my - 1.001, (oy - z) / 4 - 0.5));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    w[MT[j * mx + i] & 7] += (1 - u) * (1 - v) * k; w[MT[j * mx + i + 1] & 7] += u * (1 - v) * k;
    w[MT[(j + 1) * mx + i] & 7] += (1 - u) * v * k; w[MT[(j + 1) * mx + i + 1] & 7] += u * v * k;
  };
  const splat = (x, z) => {
    const w = [0, 0, 0, 0, 0, 0, 0, 0];
    const wx = x + 3 * (fbm(x * 0.06 + 11.3, z * 0.06, 2, 2) - 0.5) * 2, wz = z + 3 * (fbm(x * 0.06, z * 0.06 + 7.1, 2, 2) - 0.5) * 2;
    tap(w, wx - 1.5, wz - 1.5, 0.25); tap(w, wx + 1.5, wz - 1.5, 0.25); tap(w, wx - 1.5, wz + 1.5, 0.25); tap(w, wx + 1.5, wz + 1.5, 0.25);
    return w;
  };
  progress(0.05, 'Building the ground');
  fowUniforms.fowOn.value = 0;                                  // no fog of war in this game
  const tl = new THREE.TextureLoader();
  const ld = (f) => tl.loadAsync(Assets.base + 'terrain/' + f).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; });
  const textures = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((k) => ld(`${md.setting}/scape_${k}.jpg`)));
  const terrain = await buildTerrain(hf, splat, textures, { scales: [0, 1, 2, 3, 4, 5, 6, 7].map(() => [1 / 24, 1 / 24]) });
  scene.add(terrain);
  let water = null;
  if (md.water != null) {
    let nm = null;
    try { nm = await tl.loadAsync(Assets.base + 'terrain/water_normal.png'); } catch (e) { nm = null; }
    water = buildWater(hf, md.water, nm);
    scene.add(water);
  }

  // ---------------------------------------------------------------- objects
  const objects = [];
  for (const o of md.objects) {
    const [x, z] = toGame(o.x, o.y);
    const model = SCENERY.has(o.type) ? gfxOf(o.cls) : null;
    objects.push({ type: o.type, cls: lc(o.cls), name: o.name, model: model && !NO_PROP.test(model) ? model : null, x, y: o.z, z, rot: o.rot, q: o.q, owner: o.owner, attr: o.attr });
  }
  const names = [...new Set(objects.filter((o) => o.model).map((o) => o.model))];
  const templates = new Map();
  let done = 0;
  const queue = names.slice();
  const worker = async () => {
    while (queue.length) {
      const n = queue.shift();
      try { templates.set(n, await loadModel(n, { static: true })); } catch (e) { console.warn('model failed', n, e); }
      progress(0.08 + 0.5 * (++done / names.length), `Loading the city ${done} / ${names.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);

  progress(0.6, 'Placing the city');
  const props = new PropField(scene);
  const foliage = new FoliageField(scene, 64);
  foliage.light.set(0.86, 0.9, 0.8);
  spriteLight.copy(foliage.light);
  const collision = new CollisionWorld(size, height, CFG.collision.cell);
  const glows = new Map();                                      // texture -> light sprites
  const GLOW = /lantern|watchtower|torch|lamp/;
  const boxes = new Map();                                      // model -> size of its bounding box
  const bboxOf = (name) => {
    if (!boxes.has(name)) boxes.set(name, new THREE.Box3().setFromObject(templates.get(name).scene).getSize(new THREE.Vector3()));
    return boxes.get(name);
  };
  for (const o of objects) {
    if (!o.model || !templates.has(o.model)) { o.model = null; continue; }
    const tpl = templates.get(o.model);
    const veg = o.type === 'VGTN' || o.type === 'TREE';
    const tree = veg && /tree|palm|acacia|koekerboom/.test(o.model);
    // trees stand on the ground, everything else at its stored height (bridges, roofs, things on tables)
    const y = o.type === 'TREE' ? height(o.x, o.z) : o.y;
    o.y = y;
    props.addKind(o.model, tpl, { castShadow: !veg || tree });
    const h = props.add(o.model, o.x, y, o.z, o.rot, 1, o.q);
    for (const [uri, list] of treeSprites(tpl.extras, o.x, y, o.z, o.rot, 1, { ground: !tree && !/deco/.test(o.model) })) {
      // the lights of lanterns and towers are glow sprites (drawn additively), everything else is leaves and flowers
      if (GLOW.test(o.model)) { const a = glows.get(uri) || []; a.push(...list); glows.set(uri, a); } else foliage.add(spriteTexture(uri), list);
    }
    // what is solid: everything built, but not small clutter (chairs, pots, lanterns) and not plants;
    // a tree is a thin trunk
    const b = bboxOf(o.model);
    o.size = [b.x, b.y, b.z];
    const foot = Math.max(b.x, b.z);
    if (tree) { collision.addCylinder(o.x, y, o.z, CFG.collision.trunkRadius, Math.min(b.y, 6)); o.solid = 'trunk'; }
    else if (!veg && !CFG.collision.ignore.test(o.model) && (foot >= CFG.collision.minFootprint || (b.y >= 1.2 && foot >= 1.2))) {
      collision.addModel(tpl.scene, h.inst.m);
      o.solid = 'mesh';
    }
  }
  showAll(props);
  for (const [uri, list] of glows) scene.add(glowSprites(spriteTexture(uri), list));
  foliage.build();
  collision.build();

  return {
    md, size, origin: [ox, oy], toGame, height, hf, water: md.water, terrain, waterMesh: water, objects, templates, props, foliage, collision,
    bounds: { x0: -ox + 8, x1: ox - 8, z0: -oy + 8, z1: oy - 8 },
    find: (re) => objects.filter((o) => re.test(o.cls) || re.test(o.name)),
    update(camera, time) {
      foliage.update(camera.position);
      if (water && water.material.uniforms.uTime) water.material.uniforms.uTime.value = time;
    },
  };
}
