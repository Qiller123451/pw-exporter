import * as THREE from 'three';
import { cloneModel } from '../engine/assets.js';
import { AnimCtl } from '../game/anim.js';
import { UnitDecals } from './decals.js';

// rally points are marked with the tribe's flag (tech tree <tribe>_rally_point / _rally_point_harbour on water)
const RALLY = { Hu: 'hu_rally_point', Aje: 'aje_rally_point', Ninigi: 'ninigi_rally_point', SEAS: 'seas_rally_point' };

// World-space selection rings + 2D overlay (health bars, drag box). The minimap: ui/minimap.js.
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
    this.decals = new UnitDecals(G);   // hero rings and buff decals under units (ui/decals.js)
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
    if (G.sees(e.owner)) return true;
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
      const own = e.owner === G.me, rel = e.owner && !own ? G.me.relation(e.owner) : 0;
      const col = own ? 0x7dff6a : e.owner ? (rel === 2 ? 0x6ab4ff : rel === 1 ? 0xf0e060 : 0xff4a3a) : e.kind === 'res' ? 0xffe070 : 0xffb050;
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
    // the formation arrow being drawn (right-drag): the places the units will take
    const fa = G.input.mouse.arrow;
    if (fa) for (const [x, z] of fa.slots) put(x, z, 0.9, 0x7dff6a, 0.85);
    this.updateFlags(dt);
    this.decals.update((e) => !!(e.obj && e.obj.visible));
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
    const hpCol = (e, f) => e.owner === G.me ? (f > 0.6 ? '#6fdc5a' : f > 0.3 ? '#e8c43a' : '#e4492f') : e.owner ? (G.me.isEnemy(e.owner) ? (f > 0.5 ? '#ff6a4a' : '#d42a1a') : G.me.isFriend(e.owner) ? '#6ab4ff' : '#e8dc6a') : '#ffae3a';
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
    if (m.arrow) {
      // the arrow (CFormPreview): from the press point to the cursor
      const H = G.world.height, a = m.arrow;
      const p0 = this.toScreen(new THREE.Vector3(a.x, H(a.x, a.z) + 0.4, a.z)), p1 = this.toScreen(new THREE.Vector3(a.tip[0], H(a.tip[0], a.tip[1]) + 0.4, a.tip[1]));
      if (p0.z < 1 && p1.z < 1) {
        const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x), hl = 16;
        ctx.strokeStyle = 'rgba(160,255,130,0.95)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p1.x - hl * Math.cos(ang - 0.45), p1.y - hl * Math.sin(ang - 0.45));
        ctx.moveTo(p1.x, p1.y); ctx.lineTo(p1.x - hl * Math.cos(ang + 0.45), p1.y - hl * Math.sin(ang + 0.45));
        ctx.stroke();
      }
    }
    if (m.dragging) {
      const x0 = Math.min(m.sx, m.x), y0 = Math.min(m.sy, m.y);
      ctx.strokeStyle = 'rgba(160,255,130,0.95)'; ctx.fillStyle = 'rgba(160,255,130,0.12)'; ctx.lineWidth = 1;
      ctx.fillRect(x0, y0, Math.abs(m.x - m.sx), Math.abs(m.y - m.sy));
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.abs(m.x - m.sx), Math.abs(m.y - m.sy));
    }
  }
}

// ---------------------------------------------------------------- minimap
