import * as THREE from 'three';
import { cloneModel } from '../engine/assets.js';
import { AnimCtl } from '../game/anim.js';

// rally points are marked with the tribe's flag (tech tree <tribe>_rally_point / _rally_point_harbour on water)
const RALLY = { Hu: 'hu_rally_point', Aje: 'aje_rally_point', Ninigi: 'ninigi_rally_point', SEAS: 'seas_rally_point' };

// World-space selection rings + 2D overlay (health bars, drag box) + minimap.
const ringGeo = new THREE.RingGeometry(0.88, 1.0, 48).rotateX(-Math.PI / 2);
const ringGeoBig = new THREE.RingGeometry(0.965, 1.0, 64).rotateX(-Math.PI / 2);

export class Overlay {
  constructor(G) {
    this.G = G;
    this.rings = [];
    this.markers = [];
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'overlay';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.v = new THREE.Vector3();
    this.flags = new Map();     // building -> {name, obj, anim}
  }
  // the rally flag of every selected own producer
  updateFlags(dt) {
    const G = this.G, W = G.world;
    const want = new Set();
    for (const e of G.sel) if (e.alive && e.rally && G.canRally(e)) want.add(e);
    for (const [e, f] of this.flags) {
      if (want.has(e)) continue;
      f.obj.removeFromParent(); f.anim && f.anim.dispose && f.anim.dispose();
      this.flags.delete(e);
    }
    for (const e of want) {
      const [x, z] = e.rally;
      const water = W.isWater(x, z, 0.4);
      const name = RALLY[e.owner.tribe] && RALLY[e.owner.tribe] + (water ? '_harbour' : '');
      let f = this.flags.get(e);
      if (!f || f.name !== name) {
        if (f) { f.obj.removeFromParent(); this.flags.delete(e); }
        const tpl = name && W.template(name, true);
        if (!tpl) continue;
        const obj = cloneModel(tpl, e.party);
        G.scene.add(obj);
        const anim = tpl.clips && tpl.clips.length ? new AnimCtl(obj, tpl.clips) : null;
        if (anim) anim.play(anim.pick('standanim', 'idle', 'work') || tpl.clips[0].name);
        f = { name, obj, anim };
        this.flags.set(e, f);
      }
      f.obj.position.set(x, water ? W.waterLevel : W.height(x, z), z);
      if (f.anim) f.anim.update(dt);
    }
  }
  resize() { this.canvas.width = window.innerWidth; this.canvas.height = window.innerHeight; }
  ring(i) {
    if (!this.rings[i]) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false }));
      m.renderOrder = 20;
      this.G.scene.add(m);
      this.rings[i] = m;
    }
    this.rings[i].visible = true;
    return this.rings[i];
  }
  marker(x, z, color) { this.markers.push({ x, z, t: 0, color }); }
  toScreen(p) {
    this.v.copy(p).project(this.G.camera);
    return { x: (this.v.x + 1) / 2 * window.innerWidth, y: (1 - this.v.y) / 2 * window.innerHeight, z: this.v.z };
  }
  visibleToMe(e) {
    const G = this.G;
    if (e.owner === G.me) return true;
    return G.fow.visible(e.pos.x, e.pos.z);
  }
  update(dt) {
    const G = this.G, H = G.world.height;
    let n = 0;
    const put = (x, z, r, color, op = 0.9) => {
      const m = this.ring(n++);
      m.position.set(x, H(x, z) + 0.35, z);
      m.scale.setScalar(r);
      m.geometry = r > 4 ? ringGeoBig : ringGeo;
      m.material.color.setHex(color);
      m.material.opacity = op;
    };
    for (const e of G.sel) {
      if (!e.alive) continue;
      const own = e.owner === G.me;
      const col = own ? 0x7dff6a : e.owner ? 0xff4a3a : e.kind === 'res' ? 0xffe070 : 0xffb050;
      put(e.pos.x, e.pos.z, (e.kind === 'building' ? e.radius * 1.05 : e.radius * 1.25 + 0.2), col);
    }
    const tg = new Set();
    for (const e of G.sel) if (e.alive && e.owner === G.me && e.task && e.task.type === 'attack' && e.task.target && e.task.target.alive && !e.task.auto) tg.add(e.task.target);
    for (const t of tg) put(t.pos.x, t.pos.z, t.radius * 1.4 + 0.3 * Math.sin(G.world.time * 8), 0xff3a2a, 0.8);
    const h = G.input.hover;
    if (h && h.alive && !G.sel.has(h) && (h.kind !== 'unit' || this.visibleToMe(h))) put(h.pos.x, h.pos.z, h.kind === 'building' ? h.radius * 1.05 : h.radius * 1.25 + 0.2, h.owner === G.me ? 0xd8ffcf : h.owner ? 0xff8a70 : 0xffe0a0, 0.55);
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      if (m.t > 0.7) { this.markers.splice(i, 1); continue; }
      put(m.x, m.z, 3.5 * (1 - m.t / 0.7) + 0.5, m.color, 1 - m.t / 0.7);
    }
    this.updateFlags(dt);
    for (const e of G.sel) if (e.alive && e.rally && G.canRally(e) && !this.flags.has(e)) put(e.rally[0], e.rally[1], 1.2 + 0.2 * Math.sin(G.world.time * 5), 0xffe070, 0.9);
    for (let i = n; i < this.rings.length; i++) this.rings[i].visible = false;
    this.draw();
  }
  draw() {
    const G = this.G, ctx = this.ctx, W = this.canvas.width, Hh = this.canvas.height;
    ctx.clearRect(0, 0, W, Hh);
    const cam = G.camera.position;
    const hover = G.input.hover;
    const bar = (e, f, col, yOff) => {
      const p = e.pos.clone(); p.y += (e.kind === 'building' ? e.ht : e.height) + yOff;
      const s = this.toScreen(p);
      if (s.z > 1 || s.x < -60 || s.y < -60 || s.x > W + 60 || s.y > Hh + 60) return;
      const dist = cam.distanceTo(e.pos);
      const bw = Math.max(20, Math.min(90, (e.kind === 'building' ? 5200 : 2400) / dist * Math.min(2, Math.max(0.7, e.radius))));
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(s.x - bw / 2 - 1, s.y - 1, bw + 2, 6);
      ctx.fillStyle = col;
      ctx.fillRect(s.x - bw / 2, s.y, bw * Math.max(0, Math.min(1, f)), 4);
      return s;
    };
    const hpCol = (e, f) => e.owner === G.me ? (f > 0.6 ? '#6fdc5a' : f > 0.3 ? '#e8c43a' : '#e4492f') : e.owner ? (f > 0.5 ? '#ff6a4a' : '#d42a1a') : '#ffae3a';
    const draw = (e) => {
      if (!e.alive || e.kind === 'res') return;
      const show = G.sel.has(e) || e === hover || e.hp < e.maxHp - 0.5 || G.input.keys.AltLeft;
      if (!show || !this.visibleToMe(e)) return;
      const f = e.hp / e.maxHp;
      bar(e, f, hpCol(e, f), 1.0);
      if (e.kind === 'building' && !e.built && e.owner === G.me) bar(e, e.progress, '#e0c060', 2.6);
      else if (e.queue && e.queue.length && e.owner === G.me && G.sel.has(e)) bar(e, e.queue[0].t / e.queue[0].total, '#60b0ff', 2.6);
    };
    for (const u of G.world.units) draw(u);
    for (const b of G.world.buildings) draw(b);
    const m = G.input.mouse;
    if (m.dragging) {
      const x0 = Math.min(m.sx, m.x), y0 = Math.min(m.sy, m.y);
      ctx.strokeStyle = 'rgba(160,255,130,0.95)'; ctx.fillStyle = 'rgba(160,255,130,0.12)'; ctx.lineWidth = 1;
      ctx.fillRect(x0, y0, Math.abs(m.x - m.sx), Math.abs(m.y - m.sy));
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.abs(m.x - m.sx), Math.abs(m.y - m.sy));
    }
  }
}

// ---------------------------------------------------------------- minimap
export class Minimap {
  constructor(G, canvas, half) {
    this.G = G; this.canvas = canvas; this.half = half;
    this.ctx = canvas.getContext('2d');
    this.S = canvas.width;
    this.bg = document.createElement('canvas'); this.bg.width = this.bg.height = this.S;
    this.fogC = document.createElement('canvas');
    this.t = 0;
  }
  w2m(x, z) { return [(x + this.half) / (2 * this.half) * this.S, (z + this.half) / (2 * this.half) * this.S]; }
  m2w(mx, my) { return [mx / this.S * 2 * this.half - this.half, my / this.S * 2 * this.half - this.half]; }
  // colors: minimap colour of each ground texture (4 or 8), water: sea level or null
  buildBackground(splat, height, trees, colors, water = null) {
    const S = this.S, ctx = this.bg.getContext('2d');
    const img = ctx.createImageData(S, S);
    const cols = colors && colors.length ? colors : [[88, 128, 52], [140, 142, 70], [130, 104, 70], [118, 112, 102]];
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const [x, z] = this.m2w(i + 0.5, j + 0.5);
      const w = splat(x, z);
      let sum = 0; for (let c = 0; c < cols.length; c++) sum += w[c] || 0;
      sum = sum || 1;
      const hL = height(x - 2, z), hR = height(x + 2, z), hU = height(x, z - 2), h0 = height(x, z);
      const shade = 1 + (hL - hR) * 0.06 + (hU - h0) * 0.03;
      const k = (j * S + i) * 4;
      for (let c = 0; c < 3; c++) {
        let v = 0;
        for (let m = 0; m < cols.length; m++) v += cols[m][c] * (w[m] || 0);
        img.data[k + c] = Math.max(0, Math.min(255, v / sum * shade));
      }
      if (water != null && h0 < water - 0.3) {             // sea: blue, darker where deep
        const d = Math.min(1, (water - h0) / 10);
        img.data[k] = 40 - 25 * d; img.data[k + 1] = 105 - 50 * d; img.data[k + 2] = 140 - 40 * d;
      }
      img.data[k + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(28,52,20,0.8)';
    for (const t of trees) { const [mx, my] = this.w2m(t.x, t.z); ctx.fillRect(mx - 1, my - 1, 2.2, 2.2); }
  }
  update(dt, force) {
    this.t -= dt;
    if (this.t > 0 && !force) return;
    this.t = 0.25;
    const G = this.G, ctx = this.ctx, S = this.S;
    ctx.drawImage(this.bg, 0, 0);
    // stones
    ctx.fillStyle = '#c8c4b8';
    for (const r of G.world.resources) if (r.alive && r.type === 'stone' && G.fow.explored_(r.pos.x, r.pos.z)) { const [x, y] = this.w2m(r.pos.x, r.pos.z); ctx.fillRect(x - 2, y - 2, 4, 4); }
    // fog of war
    const f = G.fow, n = f.n;
    if (this.fogC.width !== n) { this.fogC.width = this.fogC.height = n; this.fogImg = this.fogC.getContext('2d').createImageData(n, n); }
    if (!f.revealAll) {
      const d = this.fogImg.data;
      for (let i = 0; i < n * n; i++) d[i * 4 + 3] = f.vis[i] ? 0 : f.explored[i] ? 110 : 225;
      this.fogC.getContext('2d').putImageData(this.fogImg, 0, 0);
      const scale = S / (2 * this.half) * f.cell;           // minimap px per fog cell
      const off = (f.size / 2 - this.half) / f.cell * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogC, -off, -off, n * scale, n * scale);
    }
    // entities
    const me = G.me;
    for (const b of G.world.buildings) {
      if (!b.alive) continue;
      if (b.owner !== me && !f.explored_(b.pos.x, b.pos.z)) continue;
      const [x, y] = this.w2m(b.pos.x, b.pos.z);
      const r = Math.max(3, b.radius / (2 * this.half) * S * 1.2);
      ctx.fillStyle = '#000'; ctx.fillRect(x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2);
      ctx.fillStyle = '#' + b.owner.color.toString(16).padStart(6, '0'); ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    for (const u of G.world.units) {
      if (!u.alive) continue;
      if (u.owner !== me && !f.visible(u.pos.x, u.pos.z)) continue;
      const [x, y] = this.w2m(u.pos.x, u.pos.z);
      ctx.fillStyle = u.owner ? '#' + u.owner.color.toString(16).padStart(6, '0') : '#ffc040';
      const r = u.radius > 2 ? 2.5 : 1.6;
      ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    // alert pings
    for (const p of G.pings || []) {
      const [x, y] = this.w2m(p.x, p.z);
      const k = (G.world.time - p.t) / 3;
      if (k > 1) continue;
      ctx.strokeStyle = `rgba(255,60,40,${1 - k})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4 + k * 14, 0, Math.PI * 2); ctx.stroke();
    }
    // camera view
    const corners = G.input.viewCorners();
    if (corners) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach(([wx, wz], i) => { const [x, y] = this.w2m(wx, wz); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath(); ctx.stroke();
    }
  }
}
