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

  render() { this.renderer.render(this.scene, this.camera); }
}
