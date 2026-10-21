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
  // lamps of a scene that light what stands near them (a mission's floodlights): [[x, y, z, colour, candela,
  // reach]]; null takes them away
  floodlights(list) {
    for (const l of this.floods || []) this.scene.remove(l);
    this.floods = (list || []).map(([x, y, z, color, cd, reach]) => {
      const l = new THREE.PointLight(color, cd, reach, 2);
      l.position.set(x, y, z);
      this.scene.add(l);
      return l;
    });
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
    this.shakes = [];          // camera shakes (addShake)
    this.shakeOn = false;
  }
  // a camera shake (GameCameraModule.usl ShakeCameraTheGundlachStyle): duration s, strength, fade-out % of the
  // duration, the event's position, its range (60). Dropped beyond the range from the point the camera looks at; full
  // strength within 15 m, then less down to nothing at 60 m.
  addShake(dur, strength, fade, pos, range = 60) {
    const c = this.target;
    const d = c && pos ? Math.hypot(pos.x - c.x, (pos.y ?? c.y) - c.y, pos.z - c.z) : 0;
    if (d > range) return;
    const f = d < 15 ? 1 : Math.max(0, 1 - (d - 15) / 45);
    if (f > 0 && dur > 0) this.shakes.push({ t: 0, dur, s: strength * f, fade: Math.min(100, Math.max(1, fade)) / 100 });
  }
  // the shakes' strength now (full until the last fade-out share of their time, then down to 0), and their ageing
  shakeStrength(dt) {
    let S = 0;
    for (const k of this.shakes) {
      k.t += dt;
      const q = Math.min(1, k.t / k.dur);
      S += q < 1 - k.fade ? k.s : k.s * Math.max(0, (1 - q) / k.fade);
    }
    if (this.shakes.length) this.shakes = this.shakes.filter((k) => k.t < k.dur);
    return S;
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
    // shaking: every other frame the eye and the point it looks at move together by a random step - up and down by
    // up to 0.03 m per strength, sideways half of that - and back the next frame (GameCameraModule.usl:714-749)
    const S = this.shakes.length ? this.shakeStrength(dt) : 0;
    let ox = 0, oy = 0, oz = 0;
    this.shakeOn = !this.shakeOn;
    if (S > 0 && this.shakeOn) {
      const a = 0.03 * S, r = () => Math.random() * 2 - 1;
      ox = r() * a / 2; oz = r() * a / 2; oy = r() * a;
      this.camera.position.x += ox; this.camera.position.y += oy; this.camera.position.z += oz;
    }
    this.camera.lookAt(this.x + ox, h + oy, this.z + oz);
    this.camera.updateMatrixWorld();
    this.target = new THREE.Vector3(this.x, h, this.z);
  }
}
