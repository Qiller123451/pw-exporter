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
import { Assets, loadModel, cloneModel } from '../pw/engine/assets.js';
import { applyState } from '../pw/engine/parts.js';
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
  // (CFG.mission.gfx: classes this mission shows with another model - a fan map's own classes the data does not know)
  const GFX = (CFG.mission && CFG.mission.gfx) || {};
  const gfxOf = (cls) => { const c = lc(cls); const g = GFX[c] || gamedata.classgfx[c] || c; return has(g) ? g : has(c) ? c : null; };

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
  // + the rubble of the zone borders (a map with an intact city has none of its own)
  const rubble = ((CFG.zones && CFG.zones.rubble) || []).filter(has);
  const names = [...new Set([...objects.filter((o) => o.model).map((o) => o.model), ...rubble])];
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
  // the city gate once more with every part on its own (the static version above merges the doors into the walls)
  const doorTpl = CFG.zones && CFG.zones.door && templates.has(CFG.zones.door.model) ? await loadModel(CFG.zones.door.model) : null;

  // Wall pieces (palisades, clay walls): in the game a piece is a post with up to eight arms and shows only the arms
  // towards its neighbours on the 8 u wall grid (walls, towers, gates). Drawn whole, every piece is a star of all
  // its arms and all their variants - walls "all over the place". So: these models once more with their arms
  // tagged, and each piece gets its own copy with the right arms (below).
  const wallTpl = new Map();
  for (const n of names) { const t = templates.get(n); if (t && t.fourcc === 'Wall' && !/gate/.test(n)) wallTpl.set(n, await loadModel(n, { static: true, wallArms: true })); }
  const onGrid = (o) => Math.abs(((o.x % 8) + 8) % 8 - 4) < 0.3 && Math.abs(((o.z % 8) + 8) % 8 - 4) < 0.3 && Math.abs(Math.sin(o.rot || 0)) < 0.02 && Math.cos(o.rot || 0) > 0;
  const tileKey = (x, z) => Math.round((x - 4) / 8) + ',' + Math.round((z - 4) / 8);
  const joints = new Map();                                     // tile -> 'wall' | 'tower' | 'gate'
  const pieces = new Map();                                     // tile -> the wall piece standing there
  const oldGates = [];                                          // gates off the grid (the map editor's, see below)
  const isGate = (o) => /wall_gate|palisade_gate|fence_gate|skewer_gate/.test(o.cls || '');
  for (const o of objects) {
    if (!o.model) continue;
    if (!onGrid(o)) { if (isGate(o)) oldGates.push(o); continue; }
    const kind = wallTpl.has(o.model) ? 'wall' : /tower/.test(o.cls) && o.type === 'BLDG' ? 'tower' : isGate(o) ? 'gate' : null;
    if (kind === 'wall') pieces.set(tileKey(o.x, o.z), o);
    if (kind && (kind !== 'wall' || !joints.has(tileKey(o.x, o.z)))) joints.set(tileKey(o.x, o.z), kind);
  }
  const DIRS = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];      // 0 E, 1 NE, 2 N ... (north = -z)
  // -> [arm mask, slope of every arm]. A piece under a tower keeps its arms (the remake draws only the post there:
  // fine while the tower stands, a post with a hole on either side once it is shot down - and here they all are).
  // Slopes: the pieces stand at heights in 2 m steps (stored in the map), an arm is level or goes 2 m up or down to
  // its outer end; of two neighbours 2 m apart the lower one's arm rises, 4 m apart both meet in the middle.
  const armsOf = (o) => {
    const i = Math.round((o.x - 4) / 8), j = Math.round((o.z - 4) / 8), at = (a, b) => joints.get(a + ',' + b);
    let m = 0;
    const slope = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let d = 0; d < 8; d++) {
      const [di, dj] = DIRS[d], n = at(i + di, j + dj);
      // an editor gate stands on a tile corner between two pieces 3 tiles apart: its ends reach the posts when it
      // stands straight, across a corner they are 5 m short - an arm towards it
      if (d % 2 === 1 && oldGates.some((g) => Math.hypot(g.x - (o.x + 12 * di), g.z - (o.z + 12 * dj)) < 2)) { m |= 1 << d; continue; }
      if (!n || n === 'gate') continue;                         // (a gate's own model reaches over its wing tiles)
      if (d % 2 === 1 && (at(i + di, j) || at(i, j + dj))) continue;      // no arm across an L corner
      m |= 1 << d;
      const p = pieces.get((i + di) + ',' + (j + dj)), dy = p ? p.y - o.y : 0;
      slope[d] = dy > 3 ? 1 : dy < -3 ? -1 : dy > 1 ? 1 : 0;
    }
    return [m, slope];
  };
  const hash = (a, b) => { let h = (a * 73856093) ^ (b * 19349663); h = (h ^ (h >>> 13)) * 1274126177; return (h ^ (h >>> 16)) >>> 0; };

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
  // barricades near a zone border are not part of the static city: zones.js keeps them and blows them away later
  const cuts = (CFG.zones ? CFG.zones.cuts : []).map((c, k) => ({ k, x1: c[0], z1: c[1], x2: c[2], z2: c[3], perm: c[4] === 'P' })).filter((c) => !c.perm);
  const nearCut = (x, z) => {
    let best = -1, bd = CFG.zones ? CFG.zones.gateRange : 0;
    for (const c of cuts) {
      const dx = c.x2 - c.x1, dz = c.z2 - c.z1, t = Math.max(0, Math.min(1, ((x - c.x1) * dx + (z - c.z1) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(x - c.x1 - dx * t, z - c.z1 - dz * t);
      if (d < bd) { bd = d; best = c.k; }
    }
    return best;
  };
  const gateProps = [], mapTargets = [];
  let doorGate = null;
  for (const o of objects) {
    if (!o.model || !templates.has(o.model)) { o.model = null; continue; }
    const tpl = templates.get(o.model);
    const veg = o.type === 'VGTN' || o.type === 'TREE';
    const tree = veg && /tree|palm|acacia|koekerboom/.test(o.model);
    // trees stand on the ground, everything else at its stored height (bridges, roofs, things on tables)
    const y = o.type === 'TREE' ? height(o.x, o.z) : o.y;
    o.y = y;
    // things the mission lets the player destroy are not scenery: the mission puts them up itself (as targets), or
    // they would stand there looking the same and take no damage
    const RS = CFG.mission.reserved;
    // the map's boats: the game floats them, the map file stores them on the sea bed - placed like scenery they are
    // wrecks with only the sails out of the water, right beside the boats the mission wants sunk. Left out.
    if (o.type === 'SHIP' && !(RS && RS.test(o.model))) { o.model = null; o.solid = null; continue; }
    if (RS && RS.test(o.model)) { mapTargets.push({ model: o.model, cls: o.cls, x: o.x, y, z: o.z, rot: o.rot, ship: o.type === 'SHIP' }); o.solid = 'target'; continue; }
    if (wallTpl.has(o.model) && onGrid(o)) {
      const wt = wallTpl.get(o.model), w = cloneModel(wt);
      const i = Math.round((o.x - 4) / 8), j = Math.round((o.z - 4) / 8);
      [w.userData.armMask, w.userData.slope] = armsOf(o);
      // one geometry variant per piece: the post's own, and for every arm one that the neighbour's arm shares
      w.userData.variant = [hash(i, j), ...DIRS.map(([di, dj]) => hash(2 * i + di, 2 * j + dj))];
      applyState(w, 4, 0, 1);
      const mtx = new THREE.Matrix4().makeTranslation(o.x, y, o.z);
      collision.addModel(w, mtx);                               // (only the arms that are shown)
      w.position.set(o.x, y, o.z);
      w.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      scene.add(w);
      o.solid = 'wall'; o.arms = w.userData.armMask;
      continue;
    }
    props.addKind(o.model, tpl, { castShadow: !veg || tree });
    if (/barricade/.test(o.model)) {
      const cut = nearCut(o.x, o.z);
      if (cut >= 0) { gateProps.push({ model: o.model, x: o.x, y, z: o.z, rot: o.rot, q: o.q, cut }); o.solid = 'gate'; continue; }
    }
    // the city gate stands on its own (not instanced), so that its doors can be taken away when it is forced open
    const D = CFG.zones && CFG.zones.door;
    if (D && o.model === D.model && doorTpl) {
      const g = cloneModel(doorTpl);
      g.position.set(o.x, y, o.z);
      if (o.q) g.quaternion.set(-o.q[0], -o.q[2], o.q[1], o.q[3]).normalize(); else g.rotation.y = o.rot;
      g.updateMatrixWorld(true);
      const doors = [];
      g.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; if (D.closed.test(m.name) || (m.parent && D.closed.test(m.parent.name))) doors.push(m); } });
      scene.add(g);
      doorGate = { obj: g, doors, x: o.x, y, z: o.z };
      const isDoor = (m) => D.closed.test(m.name) || !!(m.parent && D.closed.test(m.parent.name));
      collision.addModel(doorTpl.scene, g.matrix, isDoor);  // (the doors: zones.js keeps everybody out while they are shut)
      o.solid = 'mesh';
      continue;
    }
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
  for (const m of rubble) if (templates.has(m)) props.addKind(m, templates.get(m), { castShadow: true });
  showAll(props);
  for (const [uri, list] of glows) scene.add(glowSprites(spriteTexture(uri), list));
  foliage.build();
  collision.build();

  // buildings put up during the mission (Mission.build): [{tpl, x, z, yaw, addon: {tpl, link}}] - drawn, solid, and
  // closed for the path finding. Returns the placed objects [{obj, x, y, z, r, h}].
  const place = (list, nav) => {
    const out = [];
    collision.begin();
    for (const b of list) {
      const obj = cloneModel(b.tpl);
      const y = b.y ?? height(b.x, b.z);
      obj.position.set(b.x, y, b.z); obj.rotation.y = (b.yaw || 0) * Math.PI / 180;
      obj.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
      obj.updateMatrixWorld(true);
      collision.addModel(b.tpl.scene, obj.matrix);
      if (b.addon) {
        let link = null;
        obj.traverse((o) => { if (o.name === 'link_' + b.addon.link) link = o; });
        if (link) { const a = cloneModel(b.addon.tpl); if (a.children[0]) a.children[0].rotation.set(0, 0, 0); a.traverse((m) => { if (m.isMesh) m.castShadow = true; }); link.add(a); }
      }
      scene.add(obj);
      const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()), r = Math.max(size.x, size.z) / 2;
      // no paths through it
      if (nav) {
        const mask = nav.mask || (nav.mask = new Uint8Array(nav.y.length));
        for (let dz = -r; dz <= r; dz += nav.cell) for (let dx = -r; dx <= r; dx += nav.cell) { if (dx * dx + dz * dz > r * r * 0.8) continue; const c = nav.index(b.x + dx, b.z + dz); if (c >= 0) mask[c] = 1; }
      }
      out.push({ obj, x: b.x, y, z: b.z, r, h: size.y });
    }
    collision.append();
    return out;
  };

  return {
    place,
    gateProps, doorGate, mapTargets,
    md, size, origin: [ox, oy], toGame, height, hf, water: md.water, terrain, waterMesh: water, objects, templates, props, foliage, collision,
    bounds: { x0: -ox + 8, x1: ox - 8, z0: -oy + 8, z1: oy - 8 },
    find: (re) => objects.filter((o) => re.test(o.cls) || re.test(o.name)),
    update(camera, time) {
      foliage.update(camera.position);
      if (water && water.material.uniforms.uTime) water.material.uniforms.uTime.value = time;
    },
  };
}
