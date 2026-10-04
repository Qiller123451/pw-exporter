// Renderer, sky, light and shadows.
//
// One sun with one shadow map that follows the player (static scenery and characters both cast into it), a hemisphere
// light for the shade, distance fog in the sky colour. Quality presets only change the shadow map and the pixel ratio.
import * as THREE from 'three';
import { CFG } from './config.js';

export class Engine {
  constructor(canvas, settings) {
    this.settings = settings;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!settings.test });
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    const sky = new THREE.Color(CFG.look.sky);
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, CFG.look.fogNear, CFG.look.fogFar);
    this.hemi = new THREE.HemisphereLight(CFG.look.hemiSky, CFG.look.hemiGround, CFG.look.hemi);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(CFG.look.sunColor, CFG.look.sun);
    this.sunDir = new THREE.Vector3(...CFG.look.sunDir).normalize();
    this.scene.add(this.sun, this.sun.target);
    this.camera = new THREE.PerspectiveCamera(CFG.camera.fov, 1, 0.25, 1800);
    this.scene.add(this.camera);                      // things attached to the camera (first-person weapon) get drawn
    this.applyQuality();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  applyQuality() {
    const q = CFG.quality[this.settings.quality] || CFG.quality.high;
    this.q = q;
    const r = this.renderer;
    r.shadowMap.enabled = q.shadow > 0;
    this.sun.castShadow = q.shadow > 0;
    if (q.shadow > 0) {
      const s = this.sun.shadow;
      s.mapSize.set(q.shadow, q.shadow);
      const R = q.shadowRange;
      Object.assign(s.camera, { left: -R, right: R, top: R, bottom: -R, near: 10, far: 700 });
      s.camera.updateProjectionMatrix();
      s.bias = -0.0004; s.normalBias = 0.06;
      if (s.map) { s.map.dispose(); s.map = null; }
    }
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.q ? this.q.pixelRatio : 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // keep the shadow map around the player; snapped to a coarse grid so the shadows don't crawl
  followSun(p) {
    const g = 4;
    const x = Math.round(p.x / g) * g, z = Math.round(p.z / g) * g;
    this.sun.target.position.set(x, p.y, z);
    this.sun.position.set(x + this.sunDir.x * 300, p.y + this.sunDir.y * 300, z + this.sunDir.z * 300);
    this.sun.target.updateMatrixWorld();
  }

  // Before the first picture: hand the textures to the graphics card a few at a time and let it build the shaders
  // in the background. Left to the first frame, all of that is one single job for the graphics driver - on the big
  // map it took 16 s, the browser took the driver for hung and threw the WebGL context away (white screen).
  // roots: more model trees whose textures will be needed (the enemies' and troops' templates).
  async warm(roots = [], progress = () => {}) {
    const r = this.renderer, gl = r.getContext(), texs = new Set(), out = { textures: 0, images: 0, texMs: 0, shaderMs: 0, frameMs: 0 };
    const KEYS = ['map', 'normalMap', 'alphaMap', 'emissiveMap', 'specularMap', 'aoMap', 'lightMap'];
    const take = (o) => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) {
        for (const k of KEYS) if (m[k] && m[k].isTexture) texs.add(m[k]);
        for (const u of Object.values(m.uniforms || {})) if (u && u.value && u.value.isTexture) texs.add(u.value);
      }
    };
    this.scene.traverse(take);
    for (const root of roots) if (root) root.traverse(take);
    const all = [...texs].filter((t) => t.image && (t.image.width || t.image.videoWidth) && t.image.complete !== false);
    // Every model file brings its own texture objects, also for a picture dozens of models share (the tribes'
    // texture sheets): with the loader's cache on (main.js) those are one and the same image, so they can share one
    // texture on the graphics card (three.js does that for textures with the same `source`). Without this the big
    // map put ~600 textures there instead of ~150.
    const seen = new Map(), list = [];
    for (const t of all) { const s = seen.get(t.image); if (s) t.source = s; else { seen.set(t.image, t.source); } list.push(t); }
    out.images = seen.size;
    const pause = () => new Promise((res) => setTimeout(res, 0));
    let t0 = performance.now(), tick = t0;
    for (const t of list) {
      try { r.initTexture(t); } catch (e) { /* a texture the renderer cannot take yet: the first frame will */ }
      out.textures++;
      if (performance.now() - tick > 40) { gl.flush(); progress(0.7 * out.textures / list.length, 'Preparing the graphics'); await pause(); tick = performance.now(); }
    }
    gl.finish();
    out.texMs = Math.round(performance.now() - t0);
    t0 = performance.now();
    progress(0.75, 'Preparing the graphics');
    try { await Promise.race([r.compileAsync(this.scene, this.camera), new Promise((res) => setTimeout(res, 90000))]); } catch (e) { /* older three: the first frame compiles */ }
    out.shaderMs = Math.round(performance.now() - t0);
    progress(0.95, 'Preparing the graphics');
    await pause();
    t0 = performance.now();
    this.render(); gl.finish();                          // what is left (the geometry, the shadow pass) goes with this frame
    out.frameMs = Math.round(performance.now() - t0);
    return out;
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
