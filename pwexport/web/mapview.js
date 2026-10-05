// The map viewer: a ParaWorld map (.ula) as the game shows it - terrain textured with the setting's 8 ground
// materials, the sea, every placed object with its model (instanced: one draw per model part) and the trees of the
// forest blocks.
// Coordinates: X east, Y up, -Z north, metres, origin at the map centre (the same as the map exports).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as P from './parts.js';
import { applyGsfMaterials } from './materials.js';

const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const modelCache = new Map();        // model name -> Promise<[{geometry, material}] baked static parts | null>

// object types -> marker colour (when models are off or missing)
const TYPE_COLORS = { SLOC: 0xffd34d, TREE: 0x3f8f3a, FRUI: 0xe0742a, STON: 0x9aa0a6, NEST: 0xc0392b, ANML: 0xa55a2a,
  BLDG: 0x5b8bd6, DCCO: 0x8a7a5a, DECO: 0x8a7a5a, VGTN: 0x6aa84f, ITEM: 0xd8c860, ITSP: 0xd8c860 };
export const PLAYER_COLORS = [0xffe880, 0xe15555, 0x73e5e5, 0x79a1f2, 0x79f279, 0x9966cc, 0xf279ca, 0xf2a179];

export class MapView {
  constructor(api) {
    this.api = api;                   // {get, raw}
    this.group = new THREE.Group();
    this.group.name = 'map';
    this.layers = { terrain: null, water: null, objects: new THREE.Group(), plants: new THREE.Group(), markers: new THREE.Group(),
      forest: new THREE.Group(), undergrowth: new THREE.Group() };
    this.group.add(this.layers.objects, this.layers.plants, this.layers.markers, this.layers.forest, this.layers.undergrowth);
    this.cancelled = false;
  }
  dispose() {
    this.cancelled = true;
    this.group.traverse((o) => { if (o.isMesh && o.userData.own) { o.geometry.dispose(); } });
    this.group.removeFromParent();
  }
  toWorld(x, y, z) { return new THREE.Vector3(x - this.info.w / 2, z, -(y - this.info.h / 2)); }

  // ground drawn with the game's tiles (true) or the blended material textures (false)
  setTiles(on) {
    this.tiles = on;
    if (this.layers.terrain && this.mats) this.layers.terrain.material = on && !this.groundFailed ? this.mats.tiles : this.mats.blend;
  }
  // ---------------------------------------------------------------- terrain
  // q = the game's ground detail 1 .. 5 (0 / undefined = the finest the installation has)
  async load(info, onProgress = () => {}, q = 0) {
    this.info = info;
    const step = Math.max(1, Math.ceil(Math.max(info.grid[0], info.grid[1]) / 768));   // at most ~768 x 768 vertices
    const [hb, mb] = await Promise.all([
      this.api.raw('/api/map/heights?id=' + encodeURIComponent(info.id) + '&step=' + step),
      this.api.raw('/api/map/mats?id=' + encodeURIComponent(info.id)),
    ]);
    const [nx, ny] = hb.grid, H = new Float32Array(hb.data);
    const [mx, my] = mb.grid, M = new Uint8Array(mb.data);
    this.H = { nx, ny, H, step: 2 * step };
    onProgress(0.1);
    const uvs = new Float32Array(nx * ny * 2);
    const pos = new Float32Array(nx * ny * 3), w0 = new Float32Array(nx * ny * 4), w1 = new Float32Array(nx * ny * 4);
    const cell = (cx, cy) => M[Math.min(my - 1, Math.max(0, cy)) * mx + Math.min(mx - 1, Math.max(0, cx))];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = i * 2 * step, y = j * 2 * step;
      pos[k * 3] = x - info.w / 2; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = -(y - info.h / 2);
      uvs[k * 2] = x / info.w; uvs[k * 2 + 1] = y / info.h;          // the baked ground: north at the image top
      // material weights: bilinear over the 4 m cell centres
      const fx = x / 4 - 0.5, fy = y / 4 - 0.5, cx = Math.floor(fx), cy = Math.floor(fy), u = fx - cx, v = fy - cy;
      const add = (m, wt) => { if (m < 4) w0[k * 4 + m] += wt; else w1[k * 4 + m - 4] += wt; };
      add(cell(cx, cy), (1 - u) * (1 - v)); add(cell(cx + 1, cy), u * (1 - v)); add(cell(cx, cy + 1), (1 - u) * v); add(cell(cx + 1, cy + 1), u * v);
    }
    const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let t = 0;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[t++] = a; idx[t++] = b; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = c;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('splat', new THREE.BufferAttribute(w0, 4));
    geo.setAttribute('splat2', new THREE.BufferAttribute(w1, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const tex = [];
    for (let k = 0; k < 8; k++) {
      const tx = texLoader.load('/api/ground?setting=' + encodeURIComponent(info.setting) + '&k=' + k);
      tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 4;
      tex.push(tx);
    }
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    mat.onBeforeCompile = (sh) => {
      for (let k = 0; k < 8; k++) sh.uniforms['t' + k] = { value: tex[k] };
      sh.vertexShader = 'attribute vec4 splat;\nattribute vec4 splat2;\nvarying vec4 vS;\nvarying vec4 vS2;\nvarying vec3 vW;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvS = splat; vS2 = splat2; vW = (modelMatrix * vec4(position, 1.0)).xyz;');
      const samples = [...Array(8).keys()].map((k) => `c += ${k < 4 ? 's.' + 'xyzw'[k] : 's2.' + 'xyzw'[k - 4]} * texture2D(t${k}, uv).rgb;`).join('\n');
      sh.fragmentShader = 'uniform sampler2D t0, t1, t2, t3, t4, t5, t6, t7;\nvarying vec4 vS;\nvarying vec4 vS2;\nvarying vec3 vW;\n' +
        sh.fragmentShader.replace('#include <map_fragment>', `
          float tot = max(0.001, dot(vS, vec4(1.0)) + dot(vS2, vec4(1.0)));
          vec4 s = vS / tot, s2 = vS2 / tot;
          vec2 uv = vW.xz / 32.0;                         // one texture (8 x 8 tiles of 4 m) = 32 m
          vec3 c = vec3(0.0);
          ${samples}
          diffuseColor.rgb *= c;`);
    };
    mat.customProgramCacheKey = () => 'pw-map-terrain';
    this.mats = { tiles: null, blend: mat };
    await this.loadGround(q);
    if (this.cancelled) return;
    const terrain = new THREE.Mesh(geo, this.tiles === false || this.groundFailed ? mat : this.mats.tiles);
    terrain.name = 'terrain'; terrain.receiveShadow = true; terrain.userData.own = true;
    this.layers.terrain = terrain;
    this.group.add(terrain);
    if (info.water > 0) {
      const wg = new THREE.PlaneGeometry(info.w, info.h).rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(wg, new THREE.MeshPhongMaterial({ color: 0x2a6a78, transparent: true, opacity: 0.62, shininess: 80, depthWrite: false }));
      water.position.y = info.water; water.name = 'water'; water.userData.own = true; water.renderOrder = 2;
      this.layers.water = water;
      this.group.add(water);
    }
    this.markers();
    onProgress(0.2);
  }

  // The game's look: every 4 m tile is one of the setting's pre-blended transition tiles. The server draws the
  // whole map that way into one picture (scape.bake; some seconds for a big map the first time) - at most 4 pixels
  // per metre, which is right from afar. Close up the shader takes the tiles straight from the game's atlas pages
  // instead (groundDetail), so the ground is as sharp as the chosen detail level is in the game.
  // Waits for the picture, so the "loading" spinner stays up instead of a black map; a picture that cannot be made
  // must not leave the map black either: then the blended materials are shown.
  async loadGround(q = 0) {
    const id = encodeURIComponent(this.info.id);
    const gi = await this.api.get('/api/map/groundinfo?id=' + id + (q ? '&q=' + q : '')).catch(() => ({ q: 0, qualities: [] }));
    if (this.cancelled) return;
    this.ground = gi;
    this.groundFailed = false;
    const gtex = await new Promise((done) => {
      const t = texLoader.load('/api/map/ground?id=' + id + (gi.q ? '&q=' + gi.q : ''), () => done(t), undefined, () => {
        console.warn('map ground texture failed to load');
        this.groundFailed = true;
        if (this.api.toast) this.api.toast('The ground picture of this map could not be made; showing the plain materials.');
        done(t);
      });
    });
    if (this.cancelled) return;
    gtex.colorSpace = THREE.SRGBColorSpace; gtex.anisotropy = 8;
    const old = this.mats.tiles;
    const tiles = new THREE.MeshLambertMaterial({ map: gtex });
    if (gi.q && gi.inner > gi.px && gi.pages <= 8 && !this.groundFailed) this.groundDetail(tiles, gi).catch((e) => console.warn('ground detail', e));
    this.mats.tiles = tiles;
    if (this.layers.terrain) this.setTiles(this.tiles !== false);
    if (old) { if (old.map) old.map.dispose(); (old.userData.textures || []).forEach((t) => t.dispose()); old.dispose(); }
  }

  // close-up ground: per fragment, the tile of the 4 m square it lies in (tile layout from the server, one texel
  // per tile) is looked up in the atlas pages. Texture gradients come from the unbroken map coordinates, so the
  // mip level is right across tile edges; it is kept within the tiles' mip-map border, and where the picture of
  // the whole map is as detailed as the screen needs (lod >= uLod), that picture is used.
  async groundDetail(mat, gi) {
    const info = this.info, id = encodeURIComponent(info.id);
    const tb = await this.api.raw('/api/map/tiles?id=' + id + '&q=' + gi.q);
    if (this.cancelled) return;
    const [nx, ny] = tb.grid, ids = new Uint16Array(tb.data), px = new Uint8Array(nx * ny * 4);
    for (let i = 0; i < nx * ny; i++) { px[i * 4] = ids[i] & 255; px[i * 4 + 1] = ids[i] >> 8; px[i * 4 + 3] = 255; }
    const idTex = new THREE.DataTexture(px, nx, ny, THREE.RGBAFormat, THREE.UnsignedByteType);
    idTex.magFilter = idTex.minFilter = THREE.NearestFilter; idTex.generateMipmaps = false; idTex.needsUpdate = true;
    const on = { value: 0 }, aniso = { value: 4 };
    let left = gi.pages;
    const pages = [];
    for (let n = 0; n < gi.pages; n++) {
      const t = texLoader.load(`/api/map/groundpage?id=${id}&q=${gi.q}&n=${n}&v=${encodeURIComponent(gi.ver)}`, () => { if (--left === 0) on.value = 1; });
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso.value;
      pages.push(t);
    }
    mat.userData.textures = [idTex, ...pages];
    mat.userData.aniso = aniso;
    mat.userData.detail = on;            // {value: 1} once the atlas pages are there (0 = the whole-map picture only)
    // mip levels of the atlas that stay inside a tile's border (b px: level log2(b) + 1), and the level at which the
    // whole-map picture (gi.px pixels per tile) has the same detail
    const safe = Math.log2(Math.max(1, gi.border)) + 1, swap = Math.min(Math.log2(gi.inner / gi.px), safe);
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { tIds: { value: idTex }, uOn: on, uAniso: aniso, uMap: { value: new THREE.Vector2(info.w, info.h) },
        uGrid: { value: new THREE.Vector2(nx, ny) }, uTile: { value: new THREE.Vector4(gi.tile / gi.page, gi.inner / gi.page, gi.border / gi.page, gi.page) },
        uPer: { value: gi.per_row }, uLod: { value: new THREE.Vector2(swap, safe) } });
      pages.forEach((t, n) => { sh.uniforms['pg' + n] = { value: t }; });
      sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;');
      const pick = pages.map((_, n) => `${n ? 'else ' : ''}${n < pages.length - 1 ? `if (pg == ${n}) ` : ''}det = textureGrad(pg${n}, uv, dx, dy).rgb;`).join('\n            ');
      sh.fragmentShader = `uniform sampler2D tIds;\nuniform sampler2D ${pages.map((_, n) => 'pg' + n).join(', ')};
        uniform float uOn; uniform float uAniso; uniform vec2 uMap; uniform vec2 uGrid; uniform vec4 uTile; uniform int uPer; uniform vec2 uLod;\nvarying vec3 vW;\n` +
        sh.fragmentShader.replace('#include <map_fragment>', `
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        if (uOn > 0.5) {
          vec2 mp = vec2(vW.x + uMap.x * 0.5, uMap.y * 0.5 - vW.z);      // map metres: x east, y north
          vec2 tc = mp / 4.0 + 0.5;                                       // tile i covers x = 4 i - 2 .. 4 i + 2
          vec2 gr = mp / 4.0 * uTile.y;                                   // atlas uv without the jumps at tile edges
          vec2 dx = dFdx(gr), dy = dFdy(gr);
          // seen at a slant the long axis of a pixel's footprint is covered by anisotropic filtering (up to uAniso
          // samples), so the mip level follows the short axis sooner - as the graphics card does it
          float pa = max(dot(dx, dx), dot(dy, dy)), pi = min(dot(dx, dx), dot(dy, dy));
          float lod = 0.5 * log2(max(pa / (uAniso * uAniso), pi) * uTile.w * uTile.w + 1e-12);
          float far = smoothstep(uLod.x - 1.0, uLod.x, lod);
          if (far < 0.999) {
            ivec2 ti = clamp(ivec2(floor(tc)), ivec2(0), ivec2(uGrid) - 1);
            vec2 fr = fract(tc);
            vec4 e = texelFetch(tIds, ti, 0);
            int tid = int(e.r * 255.0 + 0.5) + int(e.g * 255.0 + 0.5) * 256;
            int pg = tid / (uPer * uPer), cell = tid - pg * uPer * uPer;
            vec2 org = vec2(float(cell - (cell / uPer) * uPer), float(cell / uPer)) * uTile.x + uTile.z;
            vec2 uv = vec2(org.x + fr.x * uTile.y, 1.0 - (org.y + (1.0 - fr.y) * uTile.y));   // tile picture: top = north
            float k = min(1.0, exp2(uLod.y - lod));
            dx *= k; dy *= k;
            vec3 det;
            ${pick}
            sampledDiffuseColor.rgb = mix(det, sampledDiffuseColor.rgb, far);
          }
        }
        diffuseColor *= sampledDiffuseColor;`);
    };
    mat.customProgramCacheKey = () => 'pw-map-ground-' + gi.pages;
    mat.needsUpdate = true;
  }

  heightAt(x, y) {
    const { nx, ny, H, step } = this.H;
    const fx = Math.min(nx - 1.001, Math.max(0, x / step)), fy = Math.min(ny - 1.001, Math.max(0, y / step));
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const h = (a, b) => H[b * nx + a];
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
  }

  // ---------------------------------------------------------------- markers (start locations, every object as a pin)
  markers() {
    const g = this.layers.markers;
    const byType = new Map();
    for (const o of this.info.object_list) {
      if (!byType.has(o.type)) byType.set(o.type, []);
      byType.get(o.type).push(o);
    }
    const pin = new THREE.CylinderGeometry(0.6, 0.6, 6, 6).translate(0, 3, 0);
    const m4 = new THREE.Matrix4();
    for (const [type, list] of byType) {
      if (type === 'SLOC') continue;
      const im = new THREE.InstancedMesh(pin, new THREE.MeshLambertMaterial({ color: TYPE_COLORS[type] || 0xbbbbbb }), list.length);
      list.forEach((o, i) => { const p = this.toWorld(o.x, o.y, o.z); m4.makeTranslation(p.x, p.y, p.z); im.setMatrixAt(i, m4); });
      im.name = 'markers_' + type; im.userData.own = true;
      g.add(im);
    }
    // start locations: tall flag poles in the player colours, numbered
    const pole = new THREE.CylinderGeometry(0.8, 0.8, 40, 8).translate(0, 20, 0);
    this.info.object_list.filter((o) => o.type === 'SLOC').forEach((o, i) => {
      const n = /_(\d+)$/.exec(o.name);
      const k = n ? +n[1] : i;
      const c = PLAYER_COLORS[k % PLAYER_COLORS.length];
      const m = new THREE.Mesh(pole, new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 0.3 }));
      m.position.copy(this.toWorld(o.x, o.y, o.z)); m.userData.own = true; m.name = o.name;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: numberTexture(String(k + 1), c), depthTest: false }));
      sp.scale.set(18, 18, 1); sp.position.set(0, 50, 0); sp.renderOrder = 5;
      m.add(sp);
      this.layers.markers.add(m);
      this.layers.objects.add(m.clone());     // start locations stay visible with the models too
    });
  }

  // ---------------------------------------------------------------- models
  // the trees ('forest') or the undergrowth ('undergrowth') of the map's forest blocks as drawable objects
  // (info.forest: flat lists, pwexport/forest.py)
  forestList(which) {
    const f = this.info.forest || {}, out = [];
    if (which === 'forest') {
      const t = f.trees || [];
      for (let i = 0; i + 4 < t.length; i += 5) out.push({ model: f.tree_models[t[i + 4]], x: t[i], y: t[i + 1], z: t[i + 2], rot: t[i + 3], part_of: null });
    } else {
      const t = f.deco || [];
      for (let i = 0; i + 3 < t.length; i += 4) out.push({ model: f.deco_models[t[i + 3]], x: t[i], y: t[i + 1], z: t[i + 2], rot: 0, part_of: null });
    }
    return out;
  }

  async models(which = 'objects', onProgress = () => {}) {
    const woods = which === 'forest' || which === 'undergrowth';
    const list = woods ? this.forestList(which) : which === 'plants' ? this.info.plant_list : this.info.object_list.filter((o) => o.type !== 'SLOC');
    // forests are thousands of trees: the game draws the far ones simpler, the viewer picks one level of detail
    // for the whole forest by its size (0 = full detail)
    const lod = !woods ? 0 : list.length > 12000 ? 4 : list.length > 5000 ? 3 : list.length > 2000 ? 2 : 0;
    const g = this.layers[which];
    const byModel = new Map();
    let missing = 0;
    for (const o of list) {
      if (!o.model) { if (o.part_of === undefined) missing++; continue; }     // part_of: a captain / net of the transport there, not drawn on its own
      if (!byModel.has(o.model)) byModel.set(o.model, []);
      byModel.get(o.model).push(o);
    }
    const names = [...byModel.keys()];
    let done = 0;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    const work = async (name) => {
      const parts = await staticModel(this.api, name, lod);
      if (this.cancelled || !parts) return;
      const objs = byModel.get(name);
      for (const pt of parts) {
        // wall pieces (o.wall = {mask, pick} from pwexport/walls.py): only the arms towards neighbours, one variant
        const sel = pt.tag ? objs.filter((o) => wallShows(pt.tag, o.wall)) : objs;
        if (!sel.length) continue;
        const im = new THREE.InstancedMesh(pt.geometry, pt.material, sel.length);
        sel.forEach((o, i) => { setQuat(q, o); m4.compose(this.toWorld(o.x, o.y, o.z), q, s1); im.setMatrixAt(i, m4); });
        im.castShadow = false; im.receiveShadow = false; im.name = name;
        if (pt.material.userData.glow) im.renderOrder = 3;          // light effects after the water
        im.computeBoundingSphere();
        g.add(im);
      }
    };
    // a few at a time: the server converts models it has not seen yet
    const queue = names.slice();
    const lanes = [];
    for (let l = 0; l < 4; l++) lanes.push((async () => {
      while (queue.length && !this.cancelled) {
        const n = queue.shift();
        try { await work(n); } catch (e) { console.warn(n, e); }
        done++; onProgress(done / names.length, n);
      }
    })());
    await Promise.all(lanes);
    return { models: names.length, missing };
  }
}

// an object's orientation: the engine applies the stored quaternion (x, y, z, w; z up) as its conjugate (Direct3D
// row vectors, pwexport/ula.py); its axes are mapped like positions (x, y, z) -> (x, z, -y). Landscape pieces
// (plateaus, cliffs) are tilted to the slope, so the heading alone is not enough. o.rot = the heading (CCW, map).
const UP = new THREE.Vector3(0, 1, 0);
function setQuat(q, o) {
  if (o.q) q.set(-o.q[0], -o.q[2], o.q[1], o.q[3]).normalize();
  else q.setFromAxisAngle(UP, o.rot);
  return q;
}

function numberTexture(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#' + color.toString(16).padStart(6, '0'); x.beginPath(); x.arc(32, 32, 30, 0, 7); x.fill();
  x.fillStyle = '#111'; x.font = 'bold 38px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 32, 35);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// a model's default look as static geometry in its own root frame (Y up): skinned parts baked in their rest pose,
// helper / lod / effect parts left out (parts.js, the same rules as the model viewer)
function staticModel(api, name, lod = 0) {
  const key = lod ? name + '|lod' + lod : name;
  if (!modelCache.has(key)) modelCache.set(key, (async () => {
    const inf = await api.get('/api/model?name=' + encodeURIComponent(name));
    const gltf = await loader.loadAsync(inf.url);
    const root = applyGsfMaterials(gltf.scene);       // light effects are added, not painted (materials.js)
    const top = root.children[0];
    const fourcc = (top && top.userData && top.userData.fourcc) || '';
    const desc = P.describe(root, fourcc);
    const st = P.defaultState(desc);
    // the wanted level of detail, or the nearest coarser / finer one the model has
    if (lod && desc.lods.length) st.lod = desc.lods.filter((k) => k <= lod).pop() ?? desc.lods[0];
    P.apply(root, fourcc, st);
    root.updateMatrixWorld(true);
    // wall pieces: every part tagged with its arm and geometry variant, so each map piece shows only its own arms
    const tags = fourcc === 'Wall' ? wallTags(top) : null;
    const isWall = !!tags && new Set([...tags.values()].filter((t) => t[0] >= 0).map((t) => t[0])).size >= 4 && !/gate/i.test(name);
    const out = new Map();        // material|tag -> {mat, tag, geos}
    const v = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (let n = o; n; n = n.parent) if (!n.visible) return;
      const tag = isWall ? tags.get(o) : null;
      const g = new THREE.BufferGeometry();
      const src = o.geometry, pa = src.attributes.position, cnt = pa.count;
      const pos = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        if (o.isSkinnedMesh) o.getVertexPosition(i, v); else v.fromBufferAttribute(pa, i);
        v.applyMatrix4(o.matrixWorld);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
      }
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv);
      if (src.index) g.setIndex(src.index);
      g.computeVertexNormals();
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const key = mat.uuid + '|' + (tag ? tag.join(',') : '');
      if (!out.has(key)) out.set(key, { mat, tag, geos: [] });
      out.get(key).geos.push(g);
    });
    const parts = [];
    for (const { mat, tag, geos } of out.values()) {
      const g = geos.length === 1 ? geos[0] : mergeSimple(geos);
      if (g) parts.push({ geometry: g, material: mat, tag });
    }
    return parts;
  })().catch((e) => { console.warn('model', name, e); return null; }));
  return modelCache.get(key);
}

// [arm, variant, count] of every mesh of a wall model (arm -1 = hub post, 0..7 = E, NE, N ... in GSF space):
// the remake's tagWallArms / pwexport.walls.arm_tags. top = the glTF root node (GSF Z-up frame).
function wallTags(top) {
  const inv = new THREE.Matrix4().copy(top.matrixWorld).invert();
  const box = new THREE.Box3(), c = new THREE.Vector3(), m = new THREE.Matrix4();
  const nodeOf = (o) => { let n = o; while (n && n.userData.attr === undefined && n !== top) n = n.parent; return n && n.userData.attr !== undefined ? n : o; };
  const nodes = new Map();
  top.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const n = nodeOf(o);
    const la = (n.userData.attr >>> 0) & 0x1f;
    if (la && !(la & 1)) return;                // lower levels of detail
    if (!nodes.has(n)) nodes.set(n, { meshes: [], box: new THREE.Box3() });
    const e = nodes.get(n);
    e.meshes.push(o);
    e.box.union(box.copy(o.geometry.boundingBox).applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)));
  });
  const groups = new Map();
  for (const [n, e] of nodes) {
    e.box.getCenter(c);
    e.arm = Math.hypot(c.x, c.y) < 1.2 ? -1 : ((Math.round(Math.atan2(c.y, c.x) / (Math.PI / 4)) % 8) + 8) % 8;
    const r = (v) => Math.round(v * 2) / 2;
    const key = e.arm + '|' + ((n.userData.attr >>> 0) >>> 5) + '|' + [r(e.box.min.x), r(e.box.min.y), r(e.box.max.x), r(e.box.max.y)].join(',');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const out = new Map();
  for (const g of groups.values()) {
    g.sort((a, b) => a.box.max.z - b.box.max.z || a.box.min.z - b.box.min.z);
    g.forEach((e, k) => { for (const o of e.meshes) out.set(o, [e.arm, k, g.length]); });
  }
  return out;
}
function wallShows(tag, w) {
  const [arm, variant, count] = tag;
  const mask = w ? w.mask : 0xff, pick = w ? w.pick : null;
  if (arm >= 0 && !((mask >> arm) & 1)) return false;
  return count <= 1 || ((pick ? pick[arm + 1] : 0) % count) === variant;
}

function mergeSimple(geos) {
  let n = 0, ni = 0;
  for (const g of geos) { n += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = new Uint32Array(ni);
  let o = 0, oi = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, c * 3), o * 3);
    if (g.attributes.uv) for (let i = 0; i < c; i++) { uv[(o + i) * 2] = g.attributes.uv.getX(i); uv[(o + i) * 2 + 1] = g.attributes.uv.getY(i); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[oi + i] = g.index.getX(i) + o;
    else for (let i = 0; i < c; i++) idx[oi + i] = o + i;
    oi += g.index ? g.index.count : c; o += c;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  m.setIndex(new THREE.BufferAttribute(idx, 1));
  m.computeVertexNormals();
  return m;
}
