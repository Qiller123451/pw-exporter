import * as THREE from 'three';

// Renderer, lights, RTS camera and the performance budget (frame cap, resolution scale, throttled shadows).
export class Renderer {
  constructor(canvas, settings) {
    this.settings = settings;
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: settings.antialias, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = settings.shadows !== 'off';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fb8c8);
    this.scene.fog = new THREE.Fog(0x9fb8c8, 260, 620);
    this.camera = new THREE.PerspectiveCamera(40, 1, 2, 1400);
    this.hemi = new THREE.HemisphereLight(0xe6eef2, 0x5a5236, 1.25);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 2.3);
    this.sunOffset = new THREE.Vector3(-90, 150, 60);
    this.sun.castShadow = this.renderer.shadowMap.enabled;
    this.applyShadowQuality();
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.frame = 0;
    this.lastRender = 0;
    this.stats = { fps: 0, ms: 0, cpu: 0, calls: 0, tris: 0, frames: 0, acc: 0 };
    this.shadowDirty = true;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  applyShadowQuality() {
    const q = this.settings.shadows;
    const size = q === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(size, size);
    const r = q === 'high' ? 130 : 105;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 10, far: 500 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }
  setShadows(q) {
    this.settings.shadows = q;
    const on = q !== 'off';
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.applyShadowQuality();
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  }
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 2) * (this.settings.resScale || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  // returns true if a frame should be drawn now (frame cap)
  shouldRender(now) {
    const cap = this.settings.fpsCap;
    if (!cap) return true;
    const minDt = 1000 / cap - 1.5;
    if (now - this.lastRender < minDt) return false;
    return true;
  }
  render(now) {
    this.frame++;
    // shadows: re-render the shadow map every 2nd frame (every frame on 'high')
    if (this.renderer.shadowMap.enabled) {
      const every = this.settings.shadows === 'high' ? 1 : 2;
      if (this.shadowDirty || this.frame % every === 0) { this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; }
    }
    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    const t1 = performance.now();
    const s = this.stats;
    s.frames++;
    s.acc += now - (this.lastRender || now);
    s.cpu = (s.cpu || 0) * 0.9 + (t1 - t0) * 0.1;
    if (s.acc >= 500) { s.fps = Math.round(s.frames * 1000 / s.acc); s.frames = 0; s.acc = 0; }
    s.calls = this.renderer.info.render.calls;
    s.tris = this.renderer.info.render.triangles;
    this.lastRender = now;
  }
  followSun(target) {
    // snap the light to a coarse grid so the shadow map doesn't shimmer while the camera pans
    const g = 4;
    const tx = Math.round(target.x / g) * g, tz = Math.round(target.z / g) * g;
    this.sun.position.set(tx + this.sunOffset.x, target.y + this.sunOffset.y, tz + this.sunOffset.z);
    this.sun.target.position.set(tx, target.y, tz);
    this.sun.target.updateMatrixWorld();
  }
}

// ParaWorld-style RTS camera: pan, zoom (pitch follows zoom), rotate.
export class RTSCamera {
  constructor(camera, heightAt, bounds) {
    this.camera = camera;
    this.heightAt = heightAt;
    this.bounds = bounds;
    this.x = 0; this.z = 0; this.yaw = 0;
    this.dist = 70; this.tDist = 70;
    this.min = 25; this.max = 150;
    this.shake = 0;
  }
  pan(dx, dz) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.x += dx * c - dz * s;
    this.z += -dx * s - dz * c;
  }
  update(dt) {
    const b = this.bounds;
    this.x = Math.max(-b, Math.min(b, this.x));
    this.z = Math.max(-b, Math.min(b, this.z));
    this.dist += (this.tDist - this.dist) * Math.min(1, dt * 10);
    const t = (this.dist - this.min) / (this.max - this.min);
    const pitch = 0.72 + 0.36 * t;
    const h = this.heightAt(this.x, this.z);
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.camera.position.set(this.x + s * Math.cos(pitch) * this.dist, h + Math.sin(pitch) * this.dist, this.z + c * Math.cos(pitch) * this.dist);
    if (this.shake > 0) {
      const k = this.shake;
      this.camera.position.x += (Math.random() - 0.5) * k; this.camera.position.y += (Math.random() - 0.5) * k;
      this.shake = Math.max(0, this.shake - dt * 2);
    }
    this.camera.lookAt(this.x, h, this.z);
    this.camera.updateMatrixWorld();
    this.target = new THREE.Vector3(this.x, h, this.z);
  }
}
