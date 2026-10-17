// The weather of a level (the client's FXWeather, fed by CWeatherMgr: game/systems/landmarks.js weatherNow):
// snow (type 1) or rain (type 2), with an intensity (how many flakes or drops: "Very Light Snow" is 2) and a wind
// (direction in degrees counter-clockwise from north - WeatherMgr: east 270, west 90 - strength 0 .. 120).
//
// One cloud in a box around the point the camera looks at; a flake that leaves the box comes in again on the other
// side, so the box follows the camera without the weather jumping. Snow: soft round flakes that drift; rain:
// streaks along the fall. The options' "Weather" switches it off (CClientWrap.SetGfxComponentLOD 7).
import * as THREE from 'three';

const BOX = 110, HEIGHT = 70, MAX = 9000, PER_INTENSITY = 280;

function flakeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.45, 'rgba(255,255,255,0.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export class Weather {
  constructor(scene) {
    this.scene = scene;
    this.enabled = true;
    const pos = new Float32Array(MAX * 3);
    this.seed = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) { pos[i * 3] = (Math.random() - 0.5) * BOX; pos[i * 3 + 1] = Math.random() * HEIGHT; pos[i * 3 + 2] = (Math.random() - 0.5) * BOX; this.seed[i] = Math.random(); }
    // snow: points
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snowMat = new THREE.PointsMaterial({ map: flakeTexture(), size: 0.85, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true });
    this.snow = new THREE.Points(g, this.snowMat);
    // rain: line segments (top and bottom of each drop)
    const lp = new Float32Array(MAX * 6);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xbfd0e0, transparent: true, opacity: 0.45, depthWrite: false });
    this.rain = new THREE.LineSegments(lg, this.rainMat);
    for (const o of [this.snow, this.rain]) { o.frustumCulled = false; o.renderOrder = 12; o.visible = false; scene.add(o); }
    this.pos = pos;
    this.t = 0;
    this.amount = 0;            // fades in and out (0 .. 1)
    this.kind = 0;
  }
  // w = World.weatherNow() (null: none); at = the point the camera looks at
  update(w, at, dt) {
    const want = this.enabled && w && w.intensity > 0 ? 1 : 0;
    if (w && w.type) this.kind = w.type;
    this.amount += (want - this.amount) * Math.min(1, dt);
    const show = this.amount > 0.01;
    this.snow.visible = show && this.kind === 1;
    this.rain.visible = show && this.kind === 2;
    if (!show) return;
    this.t += dt;
    const n = Math.min(MAX, Math.round((w ? w.intensity : 4) * PER_INTENSITY * this.amount));
    const rad = ((w ? w.wind : 0) * Math.PI) / 180, str = (w ? w.strength : 0) / 10;
    const wx = -Math.sin(rad) * str, wz = -Math.cos(rad) * str;        // north is -z
    const snow = this.kind === 1, fall = snow ? 2.2 : 26;
    const P = this.pos, half = BOX / 2, cx = at.x, cy = at.y - 6, cz = at.z;
    for (let i = 0; i < n; i++) {
      const k = i * 3, s = this.seed[i];
      let x = P[k], y = P[k + 1], z = P[k + 2];
      if (snow) { x += (wx + Math.sin(this.t * 0.8 + s * 40) * 0.6) * dt; z += (wz + Math.cos(this.t * 0.6 + s * 30) * 0.6) * dt; }
      else { x += wx * dt; z += wz * dt; }
      y -= fall * (0.8 + 0.4 * s) * dt;
      if (x - cx > half) x -= BOX; else if (x - cx < -half) x += BOX;
      if (z - cz > half) z -= BOX; else if (z - cz < -half) z += BOX;
      if (y < cy) y += HEIGHT; else if (y - cy > HEIGHT) y -= HEIGHT;
      P[k] = x; P[k + 1] = y; P[k + 2] = z;
    }
    if (snow) {
      this.snow.geometry.attributes.position.needsUpdate = true;
      this.snow.geometry.setDrawRange(0, n);
      this.snowMat.opacity = 0.9 * this.amount;
    } else {
      const L = this.rain.geometry.attributes.position.array, len = 1.4;
      const sx = wx / fall * len, sz = wz / fall * len;
      for (let i = 0; i < n; i++) {
        const k = i * 3, j = i * 6;
        L[j] = P[k]; L[j + 1] = P[k + 1]; L[j + 2] = P[k + 2];
        L[j + 3] = P[k] - sx; L[j + 4] = P[k + 1] + len; L[j + 5] = P[k + 2] - sz;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.geometry.setDrawRange(0, n * 2);
      this.rainMat.opacity = 0.45 * this.amount;
    }
  }
  dispose() {
    for (const o of [this.snow, this.rain]) { this.scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
    if (this.snowMat.map) this.snowMat.map.dispose();
  }
}
