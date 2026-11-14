import * as THREE from 'three';
import { cloneModel } from '../engine/assets.js';
import { AnimCtl } from '../game/anim.js';
import { UnitDecals } from './decals.js';
import { GroundRings, ringRgbOf, RING_FAINT, hpGradient, BAR_BACK, BAR_BUILD, BAR_QUEUE, EMBLEM } from './groundrings.js';
import { UIA } from './atlas.js';

// rally points are marked with the tribe's flag (tech tree <tribe>_rally_point / _rally_point_harbour on water)
const RALLY = { Hu: 'hu_rally_point', Aje: 'aje_rally_point', Ninigi: 'ninigi_rally_point', SEAS: 'seas_rally_point' };

// The selection circles (on the ground, merged where they overlap: ui/groundrings.js) + 2D overlay (health bars, drag
// box). The minimap: ui/minimap.js.
//
// Colours as in the original: a circle is drawn in its owner's party colour (the player colour chosen at the start;
// wild animals green (peaceful) or orange-red (hunters) as ACColors.txt, other objects without an owner grey), the
// hover circle in the faint version of it. Health bars are thin lines: a unit's over its head with its level emblem at
// the left end, a building's low across the front of its circle (both measured on screenshots of the original).
// Their colour is an option, as the original's "alternative hitpoint bar colouring" (OptionsMenu.usl
// AlternativeColoringPFHP): settings.hpBarColors 'health' (default) = the original's health gradient (red .. green),
// 'player' = the owner's colour (lightened; wild animals their circle colour), the empty part dark.
export class Overlay {
  constructor(G) {
    this.G = G;
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
    this.ground = new GroundRings(G);
    // Effects/Selection.tga whole (assets/ui/selection.png, made by the data pipeline's ui step): the level emblems.
    // Missing (data prepared before it existed): bars without emblems.
    this.sheet = new Image();
    this.sheet.onerror = () => { this.sheet = null; };
    this.sheet.src = (UIA.base || 'assets/ui/') + 'selection.png';
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
  // the radius of an object's circle
  ringR(e) { return e.kind === 'building' ? e.radius * 1.05 : (e.radius || 1) * 1.25 + 0.2; }
  update(dt) {
    const G = this.G, R = this.ground;
    for (const e of G.sel) {
      if (!e.alive) continue;
      const rgb = ringRgbOf(e);
      R.add(e.pos.x, e.pos.z, this.ringR(e), rgb, 1, 'sel/' + rgb.join(','));
    }
    // objects a mission handed over (OCPY chk_highlight): a steady thin ring of the object's radius until the time is
    // up; selecting and deselecting it ends it as in the original
    const HL = G.world.highlights;
    if (HL) for (const [e, until] of HL) {
      const sel = G.sel.has(e);
      if (!e.alive || e.owner !== G.me || G.world.time >= until || (e._hlSel && !sel)) { HL.delete(e); continue; }
      if (sel) { e._hlSel = true; continue; }
      R.add(e.pos.x, e.pos.z, Math.max(0.5, e.radius || 1), [125, 255, 106], 0.9, 'hl', 0.3);
    }
    const tg = new Set();
    for (const e of G.sel) if (e.alive && e.owner === G.me && e.task && e.task.type === 'attack' && e.task.target && e.task.target.alive && !e.task.auto) tg.add(e.task.target);
    for (const t of tg) R.add(t.pos.x, t.pos.z, t.radius * 1.4 + 0.3 * Math.sin(G.world.time * 8), [255, 58, 42], 0.8, 'target');
    const h = G.input.hover;
    if (h && h.alive && !G.sel.has(h) && (h.kind !== 'unit' || this.visibleToMe(h))) R.add(h.pos.x, h.pos.z, this.ringR(h), ringRgbOf(h), RING_FAINT, 'hover');
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      if (m.t > 0.7) { this.markers.splice(i, 1); continue; }
      R.add(m.x, m.z, 3.5 * (1 - m.t / 0.7) + 0.5, [(m.color >> 16) & 255, (m.color >> 8) & 255, m.color & 255], 1 - m.t / 0.7, 'marker' + i);
    }
    // the formation arrow being drawn (right-drag): the places the units will take
    const fa = G.input.mouse.arrow;
    if (fa) for (const [x, z] of fa.slots) R.add(x, z, 0.9, [125, 255, 106], 0.85, 'arrow');
    this.updateFlags(dt);
    this.decals.update((e) => !!(e.obj && e.obj.visible));
    for (const e of G.sel) if (e.alive && e.rally && G.canRally(e) && !this.flags.has(e)) R.add(e.rally[0], e.rally[1], 1.2 + 0.2 * Math.sin(G.world.time * 5), [255, 224, 112], 0.9, 'rally');
    R.flush();
    this.draw();
  }
  draw() {
    const G = this.G, ctx = this.ctx, W = this.canvas.width, Hh = this.canvas.height;
    ctx.clearRect(0, 0, W, Hh);
    const camera = G.camera, hover = G.input.hover, Hgt = G.world.height;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); right.y = 0;
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const toCam = new THREE.Vector3(-right.z, 0, right.x);          // horizontal, towards the camera
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    // the screen line of a horizontal segment of half length hl (m) through p, across the view; null when off screen
    const span = (p, hl) => {
      a.copy(p).addScaledVector(right, -hl); b.copy(p).addScaledVector(right, hl);
      const s0 = this.toScreen(a), s1 = this.toScreen(b);
      if (s0.z > 1 || s1.z > 1) return null;
      const x0 = Math.min(s0.x, s1.x), x1 = Math.max(s0.x, s1.x), y = Math.round((s0.y + s1.y) / 2);
      if (x1 < -60 || x0 > W + 60 || y < -60 || y > Hh + 60) return null;
      return { x0, x1, y };
    };
    // one bar: background, then the filled part; th = line thickness (px)
    const line = (L, f, fill, back = BAR_BACK, th = 2) => {
      const w = Math.max(14, L.x1 - L.x0), x = Math.round((L.x0 + L.x1) / 2 - w / 2), fw = Math.round(w * Math.max(0, Math.min(1, f)));
      ctx.fillStyle = back; ctx.fillRect(x - 1, L.y - 1, w + 2, th + 2);
      ctx.fillStyle = fill; ctx.fillRect(x, L.y, fw, th);
      return x;
    };
    const p = new THREE.Vector3();
    const byPlayer = G.settings && G.settings.hpBarColors === 'player';
    const lt = (v) => Math.round(v + (255 - v) * 0.4), dk = (v) => v * 0.12 | 0;
    // fill and background of an object's health bar
    const colours = (e, f) => {
      if (!byPlayer) return [hpGradient(f), BAR_BACK];
      const c = ringRgbOf(e);
      return [`rgb(${lt(c[0])},${lt(c[1])},${lt(c[2])})`, `rgba(${dk(c[0])},${dk(c[1])},${dk(c[2])},0.85)`];
    };
    const draw = (e) => {
      if (!e.alive || e.kind === 'res') return;
      const show = G.sel.has(e) || e === hover || e.hp < e.maxHp - 0.5 || G.input.keys.AltLeft;
      if (!show || !this.visibleToMe(e)) return;
      const f = e.hp / e.maxHp, r = this.ringR(e);
      if (e.kind === 'building') {
        // low across the front of the circle
        p.set(e.pos.x, 0, e.pos.z).addScaledVector(toCam, r * 0.7);
        p.y = Hgt(p.x, p.z) + 0.1;
        const L = span(p, r * 0.85);
        if (!L) return;
        const [fill, back] = colours(e, f);
        line(L, f, fill, back);
        if (!e.built && e.owner === G.me) line({ x0: L.x0, x1: L.x1, y: L.y + 5 }, e.progress, BAR_BUILD);
        else if (e.queue && e.queue.length && e.owner === G.me && G.sel.has(e)) line({ x0: L.x0, x1: L.x1, y: L.y + 5 }, e.queue[0].t / e.queue[0].total, BAR_QUEUE);
        return;
      }
      // a unit: over its head, as wide as its circle; the level emblem at the left end
      p.set(e.pos.x, e.pos.y + (e.height || 2) + 0.4, e.pos.z);
      const L = span(p, r);
      if (!L) return;
      const [fill, back] = colours(e, f);
      const x = line(L, f, fill, back);
      if (this.sheet && this.sheet.complete && this.sheet.naturalWidth && e.level >= 1) {
        const [sx, sy, sw, sh] = EMBLEM(e.level);
        ctx.drawImage(this.sheet, sx, sy, sw, sh, x - 2 - sw / 2, L.y + 1 - sh / 2, sw, sh);
      }
      if (e.queue && e.queue.length && e.owner === G.me && G.sel.has(e)) line({ x0: L.x0, x1: L.x1, y: L.y - 5 }, e.queue[0].t / e.queue[0].total, BAR_QUEUE);
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
