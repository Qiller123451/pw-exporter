import * as THREE from 'three';


function radialTexture(stops, size = 64, noise = 0) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, c] of stops) g.addColorStop(o, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  if (noise) {
    const d = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < d.data.length; i += 4) d.data[i + 3] *= 1 - noise + noise * Math.random();
    ctx.putImageData(d, 0, 0);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX {
  constructor(scene, height) {
    this.height = height;
    this.scene = scene;
    this.tex = {
      glow: radialTexture([[0, 'rgba(255,255,230,1)'], [0.25, 'rgba(255,210,120,0.9)'], [0.6, 'rgba(255,120,30,0.35)'], [1, 'rgba(255,80,0,0)']]),
      fire: radialTexture([[0, 'rgba(255,230,160,1)'], [0.4, 'rgba(255,140,40,0.8)'], [1, 'rgba(160,40,0,0)']], 64, 0.35),
      smoke: radialTexture([[0, 'rgba(90,85,78,0.85)'], [0.5, 'rgba(110,104,96,0.5)'], [1, 'rgba(120,115,105,0)']], 64, 0.5),
      dust: radialTexture([[0, 'rgba(150,130,95,0.7)'], [0.6, 'rgba(150,130,95,0.3)'], [1, 'rgba(150,130,95,0)']], 64, 0.5),
      blood: radialTexture([[0, 'rgba(150,10,10,1)'], [0.6, 'rgba(110,0,0,0.8)'], [1, 'rgba(80,0,0,0)']]),
      spark: radialTexture([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,220,120,1)'], [1, 'rgba(255,150,0,0)']], 32),
      scorch: radialTexture([[0, 'rgba(20,14,8,0.85)'], [0.5, 'rgba(30,22,12,0.55)'], [1, 'rgba(30,22,12,0)']], 128, 0.3),
    };
    this.parts = [];
    this.pool = [];
    this.decals = [];
    this.decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shake = 0;
  }
  spawn(type, pos, o = {}) {
    let s = this.pool.pop();
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ depthWrite: false, transparent: true }));
      this.scene.add(s);
    }
    const additive = type === 'glow' || type === 'fire' || type === 'spark';
    s.material.map = this.tex[type];
    s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.color.set(o.color || 0xffffff);
    s.material.rotation = Math.random() * Math.PI * 2;
    s.material.needsUpdate = true;
    s.visible = true;
    s.position.copy(pos);
    s.renderOrder = additive ? 5 : 4;
    const p = {
      s, age: 0, life: o.life || 1, size0: o.size || 1, size1: o.size1 ?? (o.size || 1) * 2,
      vel: o.vel ? o.vel.clone() : new THREE.Vector3(), grav: o.grav || 0, drag: o.drag ?? 1.5, alpha: o.alpha ?? 1,
      spin: (Math.random() - 0.5) * (o.spin || 0),
    };
    s.scale.setScalar(p.size0);
    this.parts.push(p);
    return p;
  }
  rv(scale) { return new THREE.Vector3((Math.random() - 0.5) * scale, (Math.random() - 0.5) * scale, (Math.random() - 0.5) * scale); }

  explosion(pos, big = 1) {
    const p = pos.clone();
    this.spawn('glow', p.clone().add(new THREE.Vector3(0, 1, 0)), { size: 3 * big, size1: 9 * big, life: 0.28 });
    for (let i = 0; i < 9; i++) {
      this.spawn('fire', p.clone().add(this.rv(2 * big)).add(new THREE.Vector3(0, 1, 0)),
        { size: 2 * big, size1: 4.5 * big, life: 0.45 + Math.random() * 0.35, vel: this.rv(8 * big).add(new THREE.Vector3(0, 5 * big, 0)), drag: 3, spin: 3 });
    }
    for (let i = 0; i < 10; i++) {
      this.spawn('smoke', p.clone().add(this.rv(2.5 * big)).add(new THREE.Vector3(0, 1.5, 0)),
        { size: 2.5 * big, size1: 8 * big, life: 2 + Math.random() * 1.5, vel: this.rv(5 * big).add(new THREE.Vector3(0, 3 + Math.random() * 3, 0)), drag: 1.2, alpha: 0.8, spin: 1 });
    }
    for (let i = 0; i < 14; i++) {
      this.spawn('spark', p.clone().add(new THREE.Vector3(0, 0.5, 0)),
        { size: 0.35, size1: 0.1, life: 0.6 + Math.random() * 0.5, vel: this.rv(22).add(new THREE.Vector3(0, 12, 0)), grav: 30, drag: 0.5 });
    }
    for (let i = 0; i < 8; i++) {
      this.spawn('dust', p.clone().add(this.rv(3)).setY(p.y + 0.3), { size: 2, size1: 7, life: 1.6, vel: this.rv(10).setY(1), drag: 2, alpha: 0.7 });
    }
    this.decal(p, 5 * big);
  }
  muzzle(pos, dir) {
    dir = dir || new THREE.Vector3(0, 0.3, 0);
    this.spawn('glow', pos, { size: 1.2, size1: 2.4, life: 0.1 });
    for (let i = 0; i < 2; i++) {
      this.spawn('smoke', pos.clone(), { size: 0.8, size1: 3.5, life: 1.2, vel: dir.clone().multiplyScalar(6 + Math.random() * 4).add(this.rv(2)), drag: 2.5, alpha: 0.6 });
    }
  }
  trail(pos) {
    this.spawn('smoke', pos.clone(), { size: 0.35, size1: 1.4, life: 0.7, vel: this.rv(0.6), drag: 1, alpha: 0.45 });
  }
  blood(pos, n = 10) {
    for (let i = 0; i < n; i++) {
      this.spawn('blood', pos.clone().add(this.rv(1)), { size: 0.5, size1: 0.9, life: 0.7 + Math.random() * 0.4, vel: this.rv(8).add(new THREE.Vector3(0, 4, 0)), grav: 18, drag: 0.8 });
    }
  }
  dust(pos, size = 2) {
    for (let i = 0; i < 5; i++) {
      this.spawn('dust', pos.clone().add(this.rv(size)).setY(pos.y + 0.3), { size, size1: size * 3, life: 1.8, vel: this.rv(3).setY(0.8), drag: 2, alpha: 0.6 });
    }
  }
  decal(pos, size) {
    let d = this.decals.length >= 40 ? this.decals.shift() : null;
    if (!d) {
      d = { m: new THREE.Mesh(this.decalGeo, new THREE.MeshBasicMaterial({ map: this.tex.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })) };
      this.scene.add(d.m);
    }
    d.m.position.set(pos.x, this.height(pos.x, pos.z) + 0.08, pos.z);
    d.m.scale.setScalar(size);
    d.m.rotation.y = Math.random() * 6.28;
    d.age = 0;
    d.m.material.opacity = 1;
    this.decals.push(d);
  }
  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.s.visible = false;
        this.pool.push(p.s);
        this.parts[i] = this.parts[this.parts.length - 1];
        this.parts.pop();
        continue;
      }
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(p.size0 + (p.size1 - p.size0) * Math.sqrt(t));
      p.s.material.opacity = p.alpha * (1 - t) * Math.min(1, t * 12 + 0.2);
      p.s.material.rotation += p.spin * dt;
    }
    for (const d of this.decals) {
      d.age += dt;
      if (d.age > 25) d.m.material.opacity = Math.max(0, 1 - (d.age - 25) / 10);
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
}

// ------------------------------------------------------------------ synthesized sound
export class Sound {
  constructor() { this.ctx = null; this.muted = false; this.listener = new THREE.Vector3(); this.dist = 60; }
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { this.ctx = null; }
  }
  vol(pos) {
    if (!pos) return 1;
    const d = pos.distanceTo(this.listener);
    return Math.max(0, Math.min(1, 1.2 - d / (this.dist * 2.2)));
  }
  burst(v, dur, f0, f1, q = 0.7, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }
  tone(v, dur, f0, f1, type = 'sine', delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  play(name, pos) {
    if (!this.ctx || this.muted) return;
    const v = this.vol(pos);
    if (v <= 0.01) return;
    switch (name) {
      case 'cannon': this.burst(0.9 * v, 0.35, 3000, 200); this.tone(0.6 * v, 0.3, 140, 45); break;
      case 'boom': this.burst(1.0 * v, 1.2, 1400, 60, 0.5); this.tone(0.8 * v, 0.6, 90, 30); break;
      case 'bite': this.burst(0.4 * v, 0.12, 2500, 600, 2); break;
      case 'roar': {
        const big = pos && pos.big;
        this.tone(0.25 * v, 0.9, big ? 110 : 260, big ? 60 : 140, 'sawtooth');
        this.burst(0.35 * v, 0.9, big ? 900 : 2200, big ? 200 : 500, 3);
        break;
      }
      case 'die': this.tone(0.3 * v, 1.2, 220, 50, 'sawtooth'); this.burst(0.3 * v, 1.0, 1200, 100, 2); break;
      case 'click': this.tone(0.12, 0.05, 900, 600, 'square'); break;
      case 'ack': this.tone(0.1, 0.08, 500, 700, 'square'); this.tone(0.08, 0.08, 700, 900, 'square', 0.08); break;
      case 'metal': this.burst(0.5 * v, 0.25, 5000, 800, 6); break;
      case 'shot': this.burst(0.35 * v, 0.12, 6000, 900, 1.5); break;
      case 'bow': this.tone(0.08 * v, 0.12, 320, 180, 'triangle'); this.burst(0.12 * v, 0.1, 3000, 1500, 4); break;
      case 'hit': this.burst(0.5 * v, 0.5, 900, 120, 1); this.tone(0.3 * v, 0.4, 80, 40); break;
      case 'reinforce': this.tone(0.15, 0.2, 400, 400, 'triangle'); this.tone(0.15, 0.3, 600, 600, 'triangle', 0.2); break;
    }
  }
}
