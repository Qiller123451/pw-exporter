import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { isPartyMaterial } from '../game/colors.js';
import { staticSig, hasDoors, helperPart, isDynamicKind, animalMask, applyMask, applyState } from './parts.js';
import { modelSprites } from './props.js';

// Loads converted ParaWorld models on demand and hands out clones.
// Materials are swapped to cheap Lambert materials, and skinned pieces that share a skeleton+material are merged.

const loader = new GLTFLoader();
const texCache = new Map();
export const Assets = {
  manifest: null,
  templates: new Map(),     // name -> Promise<{scene, clips, info}>
  clipCache: new Map(),     // anim source -> clips
  base: 'assets/',
  maxAniso: 4,
};

export async function initAssets(base = 'assets/') {
  Assets.base = base;
  Assets.manifest = await (await fetch(base + 'manifest.json')).json();
}

function toLambert(m, fourcc = '') {
  if (m.isMeshLambertMaterial || m.isShaderMaterial) return m;
  const l = new THREE.MeshLambertMaterial({
    map: m.map, normalMap: m.normalMap || null, color: m.color, transparent: m.transparent, alphaTest: m.alphaTest,
    side: m.side, depthWrite: m.depthWrite, opacity: m.opacity, vertexColors: m.vertexColors,
  });
  if (l.map) l.map.anisotropy = Assets.maxAniso;
  // vegetation textures carry cut-out alpha even where the source material was flagged opaque
  // (only plants: animal skins like jng_deinonychus_a keep other data in alpha and must stay opaque, and so do the
  // carried wood logs product_wood_* - Misc models cut from the bark area of jng_large_b, alpha 0 there)
  const src = String((m.userData && m.userData.gsf_texture) || '');
  if (/^jng_/i.test(m.name || '') && /^(Vgtn|Deko|Ress)$/.test(fourcc) && !/^animals[\\/]/i.test(src) && !l.transparent && !(l.alphaTest > 0)) { l.alphaTest = 0.5; l.side = THREE.DoubleSide; }
  l.name = m.name;
  // GSF material flags; bit 0x1000 marks party-colour materials (tinted with the owner's colour, see tintParty)
  l.userData.gsf_flags = m.userData && m.userData.gsf_flags;
  l.userData.party = isPartyMaterial(m);
  return l;
}

function mergeSkinned(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const key = o.skeleton.uuid + '|' + o.material.uuid + '|' + Object.keys(o.geometry.attributes).sort().join(',') + '|' + (o.geometry.index ? 1 : 0) + '|' + (o.userData.attr >>> 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const g = mergeGeometries(list.map((m) => m.geometry), false);
    if (!g) continue;
    list[0].geometry = g;
    for (let i = 1; i < list.length; i++) list[i].removeFromParent();
  }
}

// Wall pieces are hubs with arms in 8 directions (docs/spec/walls.md §2): the engine shows the arms towards connected
// neighbours. Every mesh gets userData.arm = direction 0..7 (0 E, 1 NE, 2 N ... counter-clockwise, GSF space
// x east / y north) or -1 for the hub; the building shows the arms of its mask (parts.js applyState).
export function tagWallArms(root) {
  // Each part of a wall model belongs to the hub (centre post, arm -1) or to one of 8 arms (45 degree bins, GSF model
  // space). The models carry several geometry variants of every piece (palisade arms of different heights, 11 hub
  // posts) with identical flags; the engine shows one of them per tile, never all of them stacked (that made the wall
  // top jagged). Variants = parts of the same arm, state flags and footprint; part.userData.variant / .vcount, the tile
  // picks with root.userData.variant (applyState).
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const box = new THREE.Box3(), c = new THREE.Vector3(), m = new THREE.Matrix4();
  // the glTF node a mesh belongs to (multi-material nodes are a group of meshes)
  const nodeOf = (o) => { let n = o; while (n && n.userData.attr === undefined && n !== root) n = n.parent; return n && n.userData.attr !== undefined ? n : o; };
  const nodes = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const n = nodeOf(o);
    if (!nodes.has(n)) nodes.set(n, { meshes: [], box: new THREE.Box3() });
    const e = nodes.get(n);
    e.meshes.push(o);
    e.box.union(box.copy(o.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  const groups = new Map();
  for (const [n, e] of nodes) {
    // a part without any state flag is not a piece of the wall (the palisade has two: something flat on the
    // ground beside every post)
    if (n.userData.attr !== undefined && !((n.userData.attr >>> 0) >>> 5)) { for (const o of e.meshes) o.removeFromParent(); continue; }
    e.box.getCenter(c);
    const arm = Math.hypot(c.x, c.y) < 1.2 ? -1 : ((Math.round(Math.atan2(c.y, c.x) / (Math.PI / 4)) % 8) + 8) % 8;
    const r = (v) => Math.round(v * 2) / 2;
    const key = arm + '|' + ((n.userData.attr >>> 0) >>> 5) + '|' + [r(e.box.min.x), r(e.box.min.y), r(e.box.max.x), r(e.box.max.y)].join(',');
    if (!groups.has(key)) groups.set(key, []);
    e.arm = arm;
    groups.get(key).push(e);
  }
  // The variants of an arm are not looks but slopes: wall pieces stand at heights in 2 m steps and never level the
  // ground, so every arm comes level, 2 m lower and 2 m higher at its outer end (clay wall: walkway 4..4.8, 2..4.9,
  // 4..6.9) and the engine takes the one that meets the neighbour's piece. userData.slope = -1 / 0 / 1 (measured
  // against the commonest height of the group), userData.slopes = bit mask of the slopes the group has, and
  // variant / vcount count only the pieces of the same slope (two level ones: a free choice).
  for (const g of groups.values()) {
    if (g.length < 2) { for (const o of g[0].meshes) { o.userData.arm = g[0].arm; o.userData.variant = 0; o.userData.vcount = 1; } continue; }
    const mid = (e) => Math.round((e.box.min.z + e.box.max.z) * 2) / 2;
    const count = new Map();
    for (const e of g) count.set(mid(e), (count.get(mid(e)) || 0) + 1);
    const sorted = [...count.keys()].sort((a, b) => a - b);
    let ref = sorted[Math.floor((sorted.length - 1) / 2)];
    for (const k of sorted) if (count.get(k) > count.get(ref)) ref = k;
    let have = 0;
    const by = new Map();
    for (const e of g) {
      e.slope = Math.max(-1, Math.min(1, Math.round((mid(e) - ref) / 2)));
      have |= 1 << (e.slope + 1);
      if (!by.has(e.slope)) by.set(e.slope, []);
      by.get(e.slope).push(e);
    }
    for (const [sl, list] of by) list.forEach((e, k) => {
      for (const o of e.meshes) { o.userData.arm = e.arm; o.userData.slope = sl; o.userData.slopes = have; o.userData.variant = k; o.userData.vcount = list.length; }
    });
  }
}

function mergeStatic(root, animatedNodes, doors) {
  // static (non skinned, non animated) meshes: merge per material and part signature into the root's frame
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  const moving = (o) => { for (let n = o; n && n !== root; n = n.parent) if (animatedNodes.has(n.name)) return true; return false; };
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.userData.sprite) return;
    if (animatedNodes.size && moving(o)) { if (o.userData.attr !== undefined) { const sg = staticSig(o.userData.attr >>> 0, doors); if (sg !== 0x1fff) o.userData.sig = sg; } return; }
    const sig = o.userData.attr !== undefined ? staticSig(o.userData.attr >>> 0, doors) : 0x1fff;
    const k = o.material.uuid + '|' + Object.keys(o.geometry.attributes).sort().join(',') + '|' + (o.geometry.index ? 1 : 0) + '|' + sig + '|' + (o.userData.arm ?? '') + '|' + (o.userData.slope !== undefined || o.userData.vcount > 1 ? (o.userData.slope ?? '') + ':' + o.userData.variant + '/' + o.userData.vcount : '');
    o.userData.sigTmp = sig;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  });
  for (const list of groups.values()) {
    const sig = list[0].userData.sigTmp;
    if (list.length < 2) { if (sig !== 0x1fff) list[0].userData.sig = sig; continue; }
    const geos = list.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      return g;
    });
    const g = mergeGeometries(geos, false);
    if (!g) continue;
    const mesh = new THREE.Mesh(g, list[0].material);
    mesh.name = list[0].name;
    mesh.castShadow = true; mesh.receiveShadow = true;
    if (sig !== 0x1fff) mesh.userData.sig = sig;
    if (list[0].userData.arm !== undefined) mesh.userData.arm = list[0].userData.arm;
    if (list[0].userData.vcount > 1) { mesh.userData.variant = list[0].userData.variant; mesh.userData.vcount = list[0].userData.vcount; }
    if (list[0].userData.slope !== undefined) { mesh.userData.slope = list[0].userData.slope; mesh.userData.slopes = list[0].userData.slopes; mesh.userData.variant = list[0].userData.variant; mesh.userData.vcount = list[0].userData.vcount; }
    root.add(mesh);
    for (const m of list) m.removeFromParent();
  }
}

export function modelInfo(name) {
  return Assets.manifest.models[name.toLowerCase()] || null;
}

// Load (once) and prepare a template. opts.static: merge all meshes (props/buildings without animation)
export function loadModel(name, opts = {}) {
  const key = name.toLowerCase() + (opts.static ? '#s' : '') + (opts.wallArms ? '#w' : '');
  if (Assets.templates.has(key)) return Assets.templates.get(key);
  const info = modelInfo(name);
  if (!info) return Promise.reject(new Error('unknown model ' + name));
  const p = new Promise((res, rej) => {
    loader.load(Assets.base + 'models/' + name.toLowerCase() + '.glb', async (gltf) => {
      const scene = gltf.scene;
      const mats = new Map();
      const fourcc0 = (scene.children[0] && scene.children[0].userData && scene.children[0].userData.fourcc) || '';
      scene.traverse((o) => {
        if (o.isMesh) {
          if (/_foliage/.test(o.name) || /_foliage/.test(o.parent?.name || '')) { o.userData.isFoliageMesh = true; }
          const arr = Array.isArray(o.material) ? o.material : [o.material];
          const out = arr.map((m) => { if (!mats.has(m.uuid)) mats.set(m.uuid, toLambert(m, fourcc0)); return mats.get(m.uuid); });
          o.material = Array.isArray(o.material) ? out : out[0];
          o.castShadow = true; o.receiveShadow = true;
        }
      });
      const root0 = scene.children[0];
      const fourcc = (root0 && root0.userData && root0.userData.fourcc) || '';
      // attribute of every mesh (glTF node extras -> userData; multi-primitive nodes put the meshes one level down)
      scene.traverse((o) => {
        if (!o.isMesh) return;
        let n = o;
        while (n && n.userData.attr === undefined) n = n.parent;
        if (n) o.userData.attr = n.userData.attr >>> 0;
      });
      scene.updateMatrixWorld(true);
      const fol = [];
      const pick = new THREE.Box3();
      scene.traverse((o) => {
        if (o.userData.isFoliageMesh) { fol.push(o); return; }
        if (!o.isMesh) return;
        if (o.userData.attr !== undefined) {
          let h = helperPart(o.userData.attr, fourcc);
          // flag-less low-poly hulls (whole-object pick/collision volumes)
          if (!h && !(o.userData.attr >>> 5) && !o.isSkinnedMesh && o.geometry.attributes.position.count <= 24) {
            const bb = new THREE.Box3().setFromObject(o);
            if (Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) > 8) h = 'pick';
          }
          if (h === 'pick') pick.expandByObject(o);
          if (h) fol.push(o);
          return;
        }
        // older exports without attributes: pick volumes / parked parts by shape
        if (!o.isSkinnedMesh) {
          o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox;
          const n = o.geometry.attributes.position.count;
          const big = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
          if (/_f0$/.test(o.name) && n <= 24 && big > 8) fol.push(o);
          else if (bb.min.z > 40 || bb.min.y > 40) fol.push(o);
        }
      });
      // billboards of buildings / ships / machines (lanterns, banners): camera-facing sprite meshes in their place.
      // Trees and other vegetation keep theirs in the world-wide foliage field (props.js FoliageField).
      if (!/^(Vgtn|Ress|Deko)$/.test(fourcc)) {
        const ex0 = (scene.children[0] && scene.children[0].userData) || {};
        const byName = new Map(((ex0.foliage) || []).map((f) => [f.mesh, f]));
        for (const o of fol) {
          if (!o.userData.isFoliageMesh) continue;
          let n = o;
          while (n && n.userData.attr === undefined && n.parent) n = n.parent;
          const nodeName = (n && n.name) || o.name;
          const f = byName.get(nodeName) || byName.get(o.name) || [...byName.values()].find((x) => nodeName.startsWith(x.mesh));
          if (!f || !f.pts || !f.pts.length || /particle/i.test(f.tex || '') || o.isSkinnedMesh) continue;
          const attr = n && n.userData.attr !== undefined ? n.userData.attr >>> 0 : 0;
          if (helperPart(attr, fourcc)) continue;
          const map = o.material && o.material.map;
          if (!map) continue;
          const sp = modelSprites(f, map);
          sp.userData.attr = attr;
          sp.position.copy(n.position); sp.quaternion.copy(n.quaternion); sp.scale.copy(n.scale);
          (n.parent || scene).add(sp);
        }
      }
      for (const o of fol) o.removeFromParent();
      mergeSkinned(scene);
      const doors = hasDoors(scene);                 // a gate: leaves open and leaves shut (parts.js)
      if (opts.wallArms) tagWallArms(scene.children[0] || scene);
      if (opts.static) {
        const animatedNodes = new Set();
        for (const c of gltf.animations) for (const t of c.tracks) animatedNodes.add(t.name.slice(0, t.name.lastIndexOf('.')));
        mergeStatic(scene.children[0] || scene, animatedNodes, doors);
      }
      if (!isDynamicKind(fourcc)) scene.traverse((o) => {
        if (o.isMesh && o.userData.sig === undefined && o.userData.attr !== undefined) { const sg = staticSig(o.userData.attr >>> 0, doors); if (sg !== 0x1fff) o.userData.sig = sg; }
      });
      // default look: finished, intact, first epoch / wild animal
      if (fourcc === 'Anim' || fourcc === 'Vehi') applyMask(scene, animalMask({ owned: fourcc === 'Vehi' }));
      else if (fourcc === 'Char') applyMask(scene, 1 << 16);      // VIS_FLAG_CHTR_ACTIVATED parts (healer kit) start hidden
      else applyState(scene, 4, 0, 1);
      let clips = gltf.animations;
      // clips made of a start, a loop and an end part (the loop marks of the GSF animation chunks, manifest
      // models[m].loops = {clip: [t0, t1]}): the parts as extra clips "<name>#s", "<name>#l", "<name>#e" - AnimCtl
      // plays the start once, repeats the loop and plays the end when the action stops, like the original engine.
      let loops = info.loops || null;
      if (loops) clips = splitLoops(clips, loops);
      if (info.anims) {
        try { const src = await loadModel(info.anims); clips = retarget(src.clips, src.scene, scene); loops = src.clips.loops || null; } catch (e) { clips = []; loops = null; }
      }
      clips.loops = loops;
      const root = scene.children[0];
      const extras = (root && root.userData) || {};
      res({ scene, clips, info, extras, fourcc, pick: pick.isEmpty() ? null : pick, name: name.toLowerCase() });
    }, undefined, rej);
  });
  Assets.templates.set(key, p);
  return p;
}

// party: the owner's colour as 0xRRGGBB (null = untinted). Party-colour materials are swapped for a tinted copy.
export function cloneModel(tpl, party = null) {
  const s = SkeletonUtils.clone(tpl.scene);
  s.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
  if (party != null) tintParty(s, party);
  return s;
}

// Party colour (original: materials with GSF flag 0x1000 are multiplied by the player's colour; the texture areas
// they use are greyscale). One tinted copy per material and colour is shared by every model of that player.
const tinted = new Map();
export function tintParty(root, party) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      if (!m || !m.userData.party) return m;
      const base = m.userData.untinted || m;
      if (party == null) return base;
      const key = base.uuid + '|' + party;
      let t = tinted.get(key);
      if (!t) {
        t = base.clone();
        t.color.setHex(party);                      // sRGB hex -> linear (ColorManagement)
        t.userData.untinted = base;
        // keep shader patches (fog of war, holes) of the template material
        t.onBeforeCompile = base.onBeforeCompile;
        t.customProgramCacheKey = base.customProgramCacheKey;
        tinted.set(key, t);
      }
      return t;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}

export async function loadTexture(url, srgb = true) {
  if (texCache.has(url)) return texCache.get(url);
  const p = new THREE.TextureLoader().loadAsync(url).then((t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Assets.maxAniso;
    return t;
  });
  texCache.set(url, p);
  return p;
}

// find a clip by name (case-insensitive)
// Borrowed animations (a model that animates with another model's clips, e.g. level 4/5 characters with the level 1
// clips, seas_warrior with livingstone's): the bones have the same names but other rest offsets (a bulkier body).
// Position tracks are moved by (own rest offset - source rest offset), so every bone keeps its own length and only
// the motion is taken over - the engine's shared animation sets work that way. Without it the mesh is stretched
// onto the source skeleton.
export function retarget(clips, srcScene, dstScene) {
  const rest = (root) => { const m = new Map(); root.traverse((o) => { if (o.name) m.set(o.name, o.position); }); return m; };
  const a = rest(srcScene), b = rest(dstScene);
  const delta = new Map();
  for (const [n, pb] of b) { const pa = a.get(n); if (pa && pa.distanceToSquared(pb) > 1e-8) delta.set(n, [pb.x - pa.x, pb.y - pa.y, pb.z - pa.z]); }
  if (!delta.size) return clips;
  return clips.map((c) => {
    let changed = false;
    const tracks = c.tracks.map((tr) => {
      const dot = tr.name.lastIndexOf('.');
      if (tr.name.slice(dot + 1) !== 'position') return tr;
      const d = delta.get(tr.name.slice(0, dot));
      if (!d) return tr;
      changed = true;
      const v = tr.values.slice();
      for (let i = 0; i < v.length; i += 3) { v[i] += d[0]; v[i + 1] += d[1]; v[i + 2] += d[2]; }
      return new tr.constructor(tr.name, tr.times, v, tr.getInterpolation());
    });
    return changed ? new THREE.AnimationClip(c.name, c.duration, tracks) : c;
  });
}
// Clips made as start + loop + end: cut into their parts (see loadModel). Parts shorter than a frame are left out.
function clipPart(clip, name, t0, t1) {
  const tracks = clip.tracks.map((tr) => {
    const T = tr.times, V = tr.values, n = V.length / T.length;
    const at = (t) => { const ip = tr.createInterpolant(); return Array.from(ip.evaluate(t)); };
    const times = [0], values = [...at(t0)];
    for (let i = 0; i < T.length; i++) if (T[i] > t0 + 1e-4 && T[i] < t1 - 1e-4) { times.push(T[i] - t0); for (let k = 0; k < n; k++) values.push(V[i * n + k]); }
    times.push(t1 - t0); values.push(...at(t1));
    return new tr.constructor(tr.name, times, values, tr.getInterpolation());
  });
  return new THREE.AnimationClip(name, t1 - t0, tracks);
}
function splitLoops(clips, loops) {
  const out = clips.slice();
  for (const c of clips) {
    const lp = loops[c.name];
    if (!lp || lp[1] - lp[0] < 0.05 || lp[1] > c.duration + 0.02) continue;
    const t1 = Math.min(lp[1], c.duration);
    out.push(clipPart(c, c.name + '#l', lp[0], t1));
    if (lp[0] > 0.05) out.push(clipPart(c, c.name + '#s', 0, lp[0]));
    if (c.duration - t1 > 0.05) out.push(clipPart(c, c.name + '#e', t1, c.duration));
  }
  return out;
}
export function findClip(clips, name) {
  if (!name) return null;
  const n = name.toLowerCase();
  return clips.find((c) => c.name.toLowerCase() === n) || null;
}
