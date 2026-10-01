// The 3D view: a model and its add-ons, put together like the game does (a part hangs on a link node "link_<name>"
// of its parent part), animated, with orbit controls.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as P from './parts.js';

const loader = new GLTFLoader();
const cache = new Map();          // url -> Promise<gltf>

export function loadGltf(url) {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url).then((g) => {
    // original node names (GLTFLoader tidies names; the exporter needs them as written)
    const json = g.parser.json;
    for (const [obj, a] of g.parser.associations) if (a && a.nodes !== undefined && obj.userData) obj.userData.nodeName = json.nodes[a.nodes].name;
    return g;
  }));
  return cache.get(url);
}

export class Viewer {
  constructor(el) {
    this.el = el;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.bgDark = new THREE.Color(0x2b2f36); this.bgLight = new THREE.Color(0xc9d3dc);
    this.scene.background = this.bgDark;
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
    this.camera.position.set(8, 6, 12);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.2));
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(30, 50, 25); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun, sun.target);
    this.grid = new THREE.GridHelper(40, 40, 0x6c7a89, 0x3f4752);
    this.scene.add(this.grid);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.25 }));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.parts = [];                // {spec, gltf, obj, mixer, action, info, state}
    this.clock = new THREE.Clock();
    this.speed = 1; this.playing = true; this.loop = true;
    this.onTime = null;
    this.opts = { texture: true, cloth: true, links: false, coll: false, normals: false };
    this.overlays = [];             // helper objects of the toggles (links, collision volumes, normals)
    this.liveNormals = [];          // normal lines of skinned meshes, updated every frame
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    this.renderer.domElement.addEventListener('dblclick', (e) => this.focusAt(e));
    this.renderer.setAnimationLoop(() => this.tick());
  }
  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  clear() {
    if (this.mapGroup) { this.mapGroup.removeFromParent(); this.mapGroup = null; }
    for (const p of this.parts) { p.mixer && p.mixer.stopAllAction(); p.obj.removeFromParent(); }
    this.parts = [];
    if (this.skel) { this.skel.removeFromParent(); this.skel = null; }
    this.clearOverlays();
  }
  // parts: [{url, parent (index), link, anim, name}] -> loaded and attached; part 0 is the main model
  async show(parts, keepCamera = false) {
    const loaded = await Promise.all(parts.map((p) => loadGltf(p.url)));
    this.clear();
    parts.forEach((spec, i) => {
      const g = loaded[i];
      const obj = cloneScene(g.scene);
      const rootNode = obj.children[0];
      const fourcc = (rootNode && rootNode.userData && rootNode.userData.fourcc) || '';
      if (i === 0) this.root.add(obj);
      else {
        const host = this.parts[spec.parent || 0];
        let link = null;
        if (host) host.obj.traverse((o) => { if (!link && o.userData.nodeName === 'link_' + spec.link) link = o; });
        if (rootNode) rootNode.rotation.set(0, 0, 0);          // link frames are the GSF Z-up frame already
        if (rootNode && rootNode.userData.restSrc) rootNode.userData.restSrc.q.identity();   // ... also for 'rest pose'
        (link || (host ? host.obj : this.root)).add(obj);
      }
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      const info = P.describe(obj, fourcc);
      const part = { spec, gltf: g, obj, fourcc, info, state: spec.state || P.defaultState(info), mixer: new THREE.AnimationMixer(obj), action: null, clips: g.animations };
      part.sprites = makeSprites(obj, rootNode);
      this.parts.push(part);
      this.applyState(i);
    });
    if (this.party !== undefined) this.setParty(this.party);
    this.wire(this.wireOn);
    this.setTextures(this.opts.texture);
    if (!keepCamera) this.frame();
    this.buildOverlays();
    if (this.skelOn) this.bones(true);
    return this.parts;
  }
  // map viewer: no grid / shadow ground, sun without shadows (a whole map), sky colour
  mapMode(on) {
    this.isMap = on;
    this.grid.visible = !on && this.gridOn !== false; this.ground.visible = !on && this.gridOn !== false;
    this.sun.castShadow = !on;
    this.controls.maxPolarAngle = on ? Math.PI * 0.49 : Math.PI;
  }
  showGroup(g) {
    this.clear();
    this.mapGroup = g;
    this.root.add(g);
    this.wire(this.wireOn);
    // look at the map from the south-west, a bit from above
    const box = new THREE.Box3();
    g.traverse((o) => { if (o.name === 'terrain' || o.name === 'water') box.union(new THREE.Box3().setFromObject(o)); });
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const r = Math.max(sz.x, sz.z) * 0.62;
    this.camera.near = Math.max(0.5, r / 2000); this.camera.far = r * 20; this.camera.updateProjectionMatrix();
    this.camera.position.set(c.x - r * 0.5, c.y + r * 2.3, c.z + r * 2.0);
    this.controls.target.copy(c);
    this.sun.position.set(c.x + r, c.y + r * 2, c.z + r * 0.6); this.sun.target.position.copy(c);
  }
  applyState(i) {
    const p = this.parts[i];
    if (!p) return;
    p.hidden = P.apply(p.obj, p.fourcc, p.state);
    if (!this.opts.cloth) for (const n of P.flagged(p.obj)) if (n.userData.kind === 'cloth' && n.visible) { n.visible = false; if (n.userData.nodeName) p.hidden.push(n.userData.nodeName); }
    for (const s of p.sprites) s.group.visible = isShown(s.node);      // sprites follow their billboard node
  }
  // play an animation on part i (null = rest pose); main model: t0/t1 = seamless loop
  play(i, name, loop = null) {
    const p = this.parts[i];
    if (!p) return;
    p.mixer.stopAllAction();
    p.action = null; p.clipName = name || null; p.loopRange = null;
    if (!name) { p.obj.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.pose(); }); this.resetPose(p); return; }
    const clip = p.clips.find((c) => c.name === name);
    if (!clip) return;
    // a start + loop + end clip (loop = [t0, t1] of its loop part): the start plays once, then the loop repeats
    p.loopRange = loop && loop[1] - loop[0] > 0.04 ? loop : null;
    p.action = p.mixer.clipAction(clip);
    p.action.setLoop(this.loop || i > 0 ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    p.action.clampWhenFinished = true;
    p.action.play();
  }
  resetPose(p) {
    // back to the rest transforms of the glTF nodes
    const json = p.gltf.parser.json;
    p.obj.traverse((o) => {
      const a = p.gltf.parser.associations.get(o) || null;
      const src = o.userData.restSrc;
      if (src) { o.position.copy(src.p); o.quaternion.copy(src.q); o.scale.copy(src.s); }
    });
  }
  setLoop(on) { this.loop = on; const p = this.parts[0]; if (p && p.action) p.action.setLoop(on ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); }
  get duration() { const p = this.parts[0]; return p && p.action ? p.action.getClip().duration : 0; }
  get time() { const p = this.parts[0]; return p && p.action ? p.action.time : 0; }
  seek(t) {
    for (const p of this.parts) if (p.action) { p.action.time = p === this.parts[0] ? t : t % Math.max(1e-3, p.action.getClip().duration); p.mixer.update(0); }
  }
  tick() {
    const dt = Math.min(0.1, this.clock.getDelta());
    if (this.playing) for (const p of this.parts) {
      p.mixer.update(dt * this.speed);
      const r = p.loopRange;
      if (r && p.action && this.loop && p.action.time >= r[1]) { p.action.time = r[0] + ((p.action.time - r[1]) % (r[1] - r[0])); p.mixer.update(0); }
    }
    if (this.autoRotate) this.root.rotation.y += dt * 0.4;
    this.controls.update();
    if (this.skel) this.skel.update && this.skel.update();
    for (const f of this.liveNormals) f();
    this.renderer.render(this.scene, this.camera);
    if (this.onTime) this.onTime(this.time, this.duration);
  }
  frame() {
    if (this.mapGroup) return this.showGroup(this.mapGroup);
    const box = new THREE.Box3();
    this.root.updateMatrixWorld(true);
    this.root.traverse((o) => { if (o.isMesh && o.visible && isShown(o)) { const b = new THREE.Box3().setFromObject(o); if (!b.isEmpty()) box.union(b); } });
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 1, 0), new THREE.Vector3(2, 2, 2));
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const r = s.length() * 0.5 || 1;                       // bounding sphere
    const fov = THREE.MathUtils.degToRad(this.camera.fov / 2), fovH = Math.atan(Math.tan(fov) * this.camera.aspect);
    const d = r / Math.sin(Math.min(fov, fovH)) * 0.92;
    const dir = new THREE.Vector3(-0.75, 0.45, -1).normalize();   // GSF models look along -Z after the Z-up -> Y-up turn
    this.camera.position.copy(c).addScaledVector(dir, d);
    this.camera.near = Math.max(0.01, d / 200); this.camera.far = d * 50; this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    const g = Math.max(10, Math.ceil(r * 3 / 10) * 10);
    this.grid.scale.setScalar(g / 40);
    this.grid.position.y = box.min.y;
    this.ground.position.y = box.min.y - 0.01;
    this.sun.position.set(c.x + r * 2, c.y + r * 4, c.z + r * 1.5); this.sun.target.position.copy(c);
    const sc = this.sun.shadow.camera; sc.left = sc.bottom = -r * 2; sc.right = sc.top = r * 2; sc.near = 0.1; sc.far = r * 12; sc.updateProjectionMatrix();
  }
  focusAt(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const m = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(m, this.camera);
    const hit = ray.intersectObject(this.root, true).find((h) => isShown(h.object) && !h.object.userData.overlay && !h.object.isSprite);
    if (hit) this.controls.target.copy(hit.point);
  }
  setGrid(on) { this.gridOn = on; this.grid.visible = on && !this.isMap; this.ground.visible = on && !this.isMap; }
  setBackground(light) { this.scene.background = light ? this.bgLight : this.bgDark; }
  wire(on) { this.wireOn = !!on; this.root.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) m.wireframe = this.wireOn; }); }
  bones(on) {
    this.skelOn = !!on;
    if (this.skel) { this.skel.removeFromParent(); this.skel = null; }
    if (on && this.parts[0]) { this.skel = new THREE.SkeletonHelper(this.parts[0].obj); this.scene.add(this.skel); }
  }
  // player colour on the party-colour materials (GSF material flag 0x1000); null = the textures' own grey
  setParty(rgb) {
    this.party = rgb;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        const f = m.userData && m.userData.gsf_flags;
        if (!f || !(parseInt(String(f).split('/')[0], 16) & 0x1000)) continue;
        if (!m.userData.baseColor) m.userData.baseColor = m.color.clone();
        m.color.copy(m.userData.baseColor);
        if (rgb) m.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      }
    });
  }
  // the toolbar toggles: texture, cloth, links, collision volumes, normals
  setOpt(key, on) {
    this.opts[key] = !!on;
    if (key === 'texture') this.setTextures(on);
    else if (key === 'cloth') this.parts.forEach((_, i) => this.applyState(i));
    else this.buildOverlays();
  }
  setTextures(on) {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (!('origMap' in m.userData)) m.userData.origMap = m.map || null;
        const want = on ? m.userData.origMap : null;
        if (m.map !== want) { m.map = want; m.needsUpdate = true; }
      }
    });
  }
  clearOverlays() {
    for (const o of this.overlays) { o.removeFromParent(); o.traverse((x) => { if (x.geometry) x.geometry.dispose(); if (x.material) { if (x.material.map) x.material.map.dispose(); x.material.dispose(); } }); }
    this.overlays = []; this.liveNormals = [];
  }
  buildOverlays() {
    this.clearOverlays();
    if (this.mapGroup || !this.parts.length) return;
    const add = (parent, o) => { o.userData.overlay = true; o.traverse((x) => { x.userData.overlay = true; x.frustumCulled = false; }); parent.add(o); this.overlays.push(o); };
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.parts[0].obj.traverse((o) => { if (o.isMesh && isShown(o)) box.expandByObject(o); });
    const size = box.isEmpty() ? 2 : box.getSize(new THREE.Vector3()).length();
    for (const p of this.parts) {
      const rootNode = p.obj.children[0];
      if (!rootNode) continue;
      if (this.opts.links) {
        p.obj.traverse((o) => {
          const n = o.userData.nodeName;
          if (!n || !n.startsWith('link_') || o.userData.overlay) return;
          const s = 1 / Math.max(1e-6, o.getWorldScale(new THREE.Vector3()).x);
          const ax = new THREE.AxesHelper(size * 0.04 * s);
          ax.material.depthTest = false; ax.renderOrder = 10;
          const label = textSprite(n.slice(5), size * 0.025 * s);
          label.position.set(0, 0, size * 0.012 * s);
          ax.add(label);
          add(o, ax);
        });
      }
      if (this.opts.coll) {
        const pf = rootNode.userData.pf || [];
        const mat = new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true, opacity: 0.9 });
        for (const r of pf) {
          let geo, pos;
          if (r[0] === 1) { geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(Math.abs(r[4]), Math.abs(r[5]), Math.abs(r[6]))); pos = [r[1] + r[4] / 2, r[2] + r[5] / 2, r[3] + r[6] / 2]; }
          else if (r[0] === 0 && r[4] > 0) { geo = new THREE.WireframeGeometry(new THREE.SphereGeometry(r[4], 12, 8)); pos = [r[1], r[2], r[3]]; }   // centre, (r, r², 0)
          else if (r[0] === 2 && r[4] > 0) { geo = new THREE.WireframeGeometry(new THREE.CylinderGeometry(r[4], r[4], Math.max(0.01, r[6]), 12, 1, true).rotateX(Math.PI / 2)); pos = [r[1], r[2], r[3] + r[6] / 2]; }  // tube: bottom centre, (r, 0, h)
          else if (r[0] === 3) { geo = new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 12, 8).scale(Math.max(1e-3, r[4]), Math.max(1e-3, r[5]), Math.max(1e-3, r[6]))); pos = [r[1], r[2], r[3]]; }  // ellipsoid: centre, radii
          else continue;
          const l = new THREE.LineSegments(geo, mat); l.position.set(...pos); l.renderOrder = 9;
          add(rootNode, l);
        }
        // selection / pick volumes and flag-less hulls (the meshes the parts panel calls helpers)
        const inv = new THREE.Matrix4().copy(rootNode.matrixWorld).invert();
        const hmat = new THREE.LineBasicMaterial({ color: 0xff7a3d, depthTest: false, transparent: true, opacity: 0.8 });
        for (const n of P.flagged(p.obj)) {
          if (P.helper(n.userData.attr >>> 0, p.fourcc) !== 'pick' && !P.isHull(n)) continue;
          n.traverse((m) => {
            if (!m.isMesh || m.isSkinnedMesh) return;
            const l = new THREE.LineSegments(new THREE.WireframeGeometry(m.geometry), hmat);
            l.matrixAutoUpdate = false; l.matrix.multiplyMatrices(inv, m.matrixWorld); l.renderOrder = 9;
            add(rootNode, l);
          });
        }
      }
      if (this.opts.normals) {
        const mat = new THREE.LineBasicMaterial({ color: 0x3fb8ff });
        p.obj.traverse((m) => {
          if (!m.isMesh || m.userData.overlay || !m.geometry.attributes.normal) return;
          const mats = [].concat(m.material);
          if (mats.every((x) => x.visible === false)) return;
          const P_ = m.geometry.attributes.position, N = m.geometry.attributes.normal, cnt = P_.count;
          const arr = new Float32Array(cnt * 6);
          const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
          const line = new THREE.LineSegments(geo, mat);
          const len = size * 0.012;
          if (!m.isSkinnedMesh) {
            const s = 1 / Math.max(1e-6, m.getWorldScale(new THREE.Vector3()).x);
            for (let i = 0; i < cnt; i++) for (let k = 0; k < 3; k++) { const v = P_.getComponent(i, k); arr[i * 6 + k] = v; arr[i * 6 + 3 + k] = v + N.getComponent(i, k) * len * s; }
            add(m, line);
          } else {
            // skinned: follow the animation (world space, recomputed every frame)
            add(this.scene, line);
            const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
            const bs = 1 / Math.max(1e-6, m.getWorldScale(new THREE.Vector3()).x);
            const upd = () => {
              line.visible = isShown(m);
              if (!line.visible) return;
              for (let i = 0; i < cnt; i++) {
                a.fromBufferAttribute(P_, i); n.fromBufferAttribute(N, i);
                b.copy(a).addScaledVector(n, len * bs);
                m.applyBoneTransform(i, a); m.applyBoneTransform(i, b);
                a.applyMatrix4(m.matrixWorld); b.applyMatrix4(m.matrixWorld);
                arr[i * 6] = a.x; arr[i * 6 + 1] = a.y; arr[i * 6 + 2] = a.z; arr[i * 6 + 3] = b.x; arr[i * 6 + 4] = b.y; arr[i * 6 + 5] = b.z;
              }
              geo.attributes.position.needsUpdate = true;
            };
            upd();
            this.liveNormals.push(upd);
          }
        });
      }
    }
  }
  screenshot() { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
}

// Foliage billboards as the game draws them: camera-facing sprites (root extras.foliage: centres in model space, atlas
// cell, size = height, joint of every sprite). The crossed-quad meshes of the same billboards (what the static file
// formats get) stay in the scene for picking / export but are not drawn.
const SPRITE_SCALE = 0.25;   // drawn height = stored size / 4 (pwexport/gsf.py SPRITE_SCALE)
function makeSprites(obj, rootNode) {
  const out = [];
  const fol = rootNode && rootNode.userData && rootNode.userData.foliage;
  if (!fol || !fol.length) return out;
  const byName = new Map();
  obj.traverse((o) => { if (o.userData && o.userData.kind === 'foliage' && o.userData.nodeName) byName.set(o.userData.nodeName, o); });
  let skin = null;
  obj.traverse((o) => { if (!skin && o.isSkinnedMesh) skin = o.skeleton; });
  obj.updateMatrixWorld(true);
  const tmp = new THREE.Matrix4(), v = new THREE.Vector3();
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const f of fol) {
    const node = byName.get(f.mesh);
    if (!node) continue;
    let map = null;
    node.traverse((m) => { if (!map && m.isMesh) { const mt = [].concat(m.material)[0]; map = mt && mt.map; m.material = [].concat(m.material).map((x) => { const c = x.clone(); c.visible = false; return c; }); if (m.material.length === 1) m.material = m.material[0]; } });
    if (!map || /particle/i.test(f.tex || '')) continue;
    const [u0, v0, u1, v1] = f.uv;
    const tex = map.clone();
    tex.needsUpdate = true;
    tex.repeat.set(u1 - u0, -(v1 - v0));          // glTF textures: v = 0 at the image top (flipY false)
    tex.offset.set(u0, v1);
    const aspect = (u1 - u0) / Math.max(1e-3, v1 - v0) * (map.image ? map.image.width / map.image.height : 1);
    const group = new THREE.Group();
    group.name = f.mesh + '_sprites';
    let top = 0.5;
    for (let i = 2; i < f.pts.length; i += 3) top = Math.max(top, f.pts[i]);
    for (let i = 0, k = 0; i < f.pts.length; i += 3, k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5, rotation: aspect === 1 ? rnd() * 6.283 : (rnd() - 0.5) * 0.25 }));
      const shade = 0.55 + 0.45 * Math.min(1, Math.max(0, f.pts[i + 2] / top)) + rnd() * 0.1;
      sp.material.color.setScalar(Math.min(1, shade));
      const h = f.size * SPRITE_SCALE;
      v.set(f.pts[i], f.pts[i + 1], f.pts[i + 2] < 0.3 ? f.pts[i + 2] + h * 0.45 : f.pts[i + 2]);   // ground sprites stand on it
      const bone = skin && f.bones ? skin.bones[f.bones[k]] : null;
      if (bone) {
        // into the bone's frame (model space -> bone): follows the tree's sway / fall animations
        tmp.copy(bone.matrixWorld).invert().multiply(rootNode.matrixWorld);
        sp.position.copy(v.applyMatrix4(tmp));
        bone.add(sp);
      } else {
        sp.position.copy(v);
        group.add(sp);
      }
      sp.scale.set(h * aspect, h, 1);
      sp.userData.group = group;
      group.userData.members = (group.userData.members || []).concat(sp);
    }
    rootNode.add(group);
    out.push({ node, group });
  }
  // sprites hung on bones mirror their group's visibility
  for (const s of out) {
    const members = s.group.userData.members || [];
    Object.defineProperty(s.group, 'visible', {
      get() { return this._vis !== false; },
      set(x) { this._vis = x; for (const m of members) if (m.parent !== this) m.visible = x; },
      configurable: true,
    });
  }
  return out;
}

// a camera-facing text label (link names)
function textSprite(text, h) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = 'bold 28px sans-serif';
  const w = Math.ceil(g.measureText(text).width) + 12;
  c.width = w; c.height = 40;
  g.font = 'bold 28px sans-serif'; g.textBaseline = 'middle';
  g.fillStyle = 'rgba(20,24,30,0.7)'; g.fillRect(0, 0, w, 40);
  g.fillStyle = '#ffe680'; g.fillText(text, 6, 21);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(h * w / 40, h, 1); sp.renderOrder = 11; sp.center.set(0, 0);
  return sp;
}

function isShown(o) { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true; }

// a copy that keeps skinned meshes bound to their own bones (SkeletonUtils.clone semantics) + rest transforms
function cloneScene(src) {
  const map = new Map();
  const copy = src.clone(true);
  const a = [], b = [];
  src.traverse((o) => a.push(o)); copy.traverse((o) => b.push(o));
  a.forEach((o, i) => map.set(o, b[i]));
  a.forEach((o, i) => {
    const c = b[i];
    c.userData = { ...o.userData, restSrc: { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() } };
    if (o.isSkinnedMesh) {
      const bones = o.skeleton.bones.map((bn) => map.get(bn));
      c.bind(new THREE.Skeleton(bones, o.skeleton.boneInverses), o.bindMatrix);
    }
    if (o.isMesh) c.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });
  return copy;
}
