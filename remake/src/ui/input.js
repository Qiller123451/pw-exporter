import * as THREE from 'three';
import { cloneModel } from '../engine/assets.js';
import { applyState } from '../engine/parts.js';
import { DIRS, DX as DXW, DZ as DZW } from '../game/wallmap.js';
import { WALL_ROT } from '../game/entities.js';
const REASON_PLACE = 'The wall cannot be built here';
import { formationSlots, SPACING } from '../game/formation.js';

// Mouse/keyboard: camera, selection, context orders, building placement, control groups.
// how tall the resources stand for picking (ResNode.type), metres
const RES_HEIGHT = { tree: 10, timber: 1.5, stone: 3, bush: 2, corpse: 1.5, farm: 0.6 };
// and how wide (their radius keeps the workers apart and can be much wider than the plant)
const RES_RADIUS = { tree: [1.2, 1.6], bush: [0.8, 2.2], stone: [1, 4] };
function resRadius(n) { const c = RES_RADIUS[n.type]; return c ? Math.min(c[1], Math.max(c[0], n.radius)) : Math.max(0.8, n.radius); }

// a key's letter like the original's virtual key (the letter on the key; other layouts: its position)
function letterOf(e) { const k = (e.key || '').toLowerCase(); return /^[a-z]$/.test(k) ? k : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : null; }
// building jumps (Keys.srf PickNext*; the SEAS - only the HQ in the original, not playable there - by their roles)
const HQS = ['hu_fireplace', 'aje_resource_collector', 'ninigi_fireplace', 'seas_headquarters'];
const PICK_KEYS = {
  h: HQS, t: HQS,
  z: ['hu_arena', 'aje_rodeo', 'ninigi_dojo', 'seas_barracks'],
  u: ['hu_small_animal_farm', 'aje_small_farm', 'ninigi_animal_farm', 'seas_garage'],
  i: ['hu_machine_maker', 'ninigi_engineer', 'seas_garage'],
  o: ['hu_harbour', 'aje_floating_harbour', 'ninigi_harbour', 'seas_carrier'],
  p: ['hu_temple', 'aje_temple', 'ninigi_temple'],
  l: ['hu_weapons_smith', 'aje_weapons_builder', 'ninigi_weapon_maker'],
  k: ['hu_tavern', 'aje_cook_house', 'ninigi_teahouse'],
};
// the formation arrow's spacing: close for a short arrow, open for a long one (the game's help; the engine's own
// formula is not in the scripts) - as wide as the arrow is long, at least the command bar's 2.7807
function arrowSpacing(len, n) { const cols = Math.ceil(Math.sqrt(n * 1.6)); return Math.max(SPACING, Math.min(8, len / Math.max(1, cols - 1))); }

// the placement grid: round dots over the ground, drawn over everything at a fixed size on the screen
// (ui/input.js updatePlaceGrid)
const PLACE_GRID_R = 24, PLACE_STEP = 2;
let dotTex = null;
function placeGrid() {
  if (!dotTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 32;
    const g = cv.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.85)'; g.beginPath(); g.arc(16, 16, 14, 0, Math.PI * 2); g.fill();      // a dark rim: visible on light ground
    g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 10.5, 0, Math.PI * 2); g.fill();
    dotTex = new THREE.CanvasTexture(cv);
  }
  const N = Math.ceil(Math.PI * (PLACE_GRID_R / PLACE_STEP + 1) ** 2) + 8;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setDrawRange(0, 0);
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, map: dotTex, vertexColors: true, transparent: true, alphaTest: 0.05,
    depthWrite: false, depthTest: false, fog: false }));
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return pts;
}

// where a unit's queued walks end
function lastWaypoint(u) {
  let t = u.task;
  if (!t || (t.type !== 'move' && t.type !== 'attackmove' && !(t.type === 'attack' && t.amove))) return [u.pos.x, u.pos.z];
  while (t.then && t.then.type !== 'patrol') t = t.then;
  return t.amove ? t.amove : t.x != null ? [t.x, t.z] : [u.pos.x, u.pos.z];
}

export class Input {
  constructor(G) {
    this.G = G;
    this.keys = {};
    // inside: false until the first mouse move - the position is unknown before that, and (0, 0) would edge-scroll
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2, sx: 0, sy: 0, down: false, dragging: false, inside: false, rot: false };
    this.mode = null;            // move | attack | amove | rally | place
    this.hover = null;
    this.hoverT = 0;
    this.groups = {};
    this.views = {};             // Ctrl+digit with nothing selected: a camera view (Keys.srf SetGroup)
    this.follow = null;          // F2: the camera follows this unit (LinkCameraToPath), F3 stops it
    this.lastGroupKey = { k: null, t: 0 };
    this.lastClick = { t: 0, e: null };
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.ghost = null;
    this.idleIdx = 0;
    const cv = G.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    // never the browser's own right-click menu in the game (HUD panels, labels, banners, the selection box ...);
    // capture phase, so it runs before the HUD stops the event. Text fields keep it (copy / paste).
    window.addEventListener('contextmenu', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
    }, { capture: true });
    cv.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => { this.mouse.inside = true; this.onMove(e); });
    // capture phase: the HUD stops mouseup from bubbling (its buttons must not click the world), but a box
    // selection released over the HUD still has to end here
    window.addEventListener('mouseup', (e) => this.onUp(e), { capture: true });
    cv.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    document.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    document.addEventListener('mouseenter', () => { this.mouse.inside = true; });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; });
  }

  // ------------------------------------------------------------------ picking
  ray(mx, my) {
    this.ndc.set((mx / window.innerWidth) * 2 - 1, -(my / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.G.camera);
    return this.raycaster.ray;
  }
  groundPoint(mx, my) {
    const r = this.ray(mx, my), H = this.G.world.height;
    const o = r.origin, d = r.direction;
    let t = 0, prev = 0;
    for (let i = 0; i < 400 && t < 1600; i++) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      const h = H(x, z);
      if (y <= h) {
        let a = prev, b = t;
        for (let k = 0; k < 8; k++) { const m = (a + b) / 2; const yy = o.y + d.y * m; if (yy <= H(o.x + d.x * m, o.z + d.z * m)) b = m; else a = m; }
        return new THREE.Vector3(o.x + d.x * b, o.y + d.y * b, o.z + d.z * b);
      }
      prev = t;
      t += Math.max(0.5, (y - h) * 0.6);
    }
    return null;
  }
  toScreen(p) { return this.G.overlay.toScreen(p); }
  // screen rectangle of an entity's pick volume (the GSF selection hull, raw attribute bit 18) or model bounds
  pickRect(e) {
    const tpl = e.tpl;
    if (!tpl) return null;
    if (!tpl._pickBox) {
      const bb = tpl.pick ? tpl.pick.clone() : new THREE.Box3().setFromObject(tpl.scene);
      tpl._pickBox = bb;
    }
    const bb = tpl._pickBox;
    const obj = e.kind === 'building' ? e.obj : e.obj;
    obj.updateWorldMatrix(true, false);              // the object only: its whole tree costs ms per call
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, zmin = 1e9;
    const v = this._pv || (this._pv = new THREE.Vector3());
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z).applyMatrix4(obj.matrixWorld);
      const s = this.toScreen(v);
      if (s.z > 1) return null;
      x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); y0 = Math.min(y0, s.y); y1 = Math.max(y1, s.y); zmin = Math.min(zmin, s.z);
    }
    return { x0, y0, x1, y1, z: zmin, area: (x1 - x0) * (y1 - y0) };
  }
  // distance along the mouse ray to a unit's pick volume (the model's pick parts, else its box; a little narrower than
  // the box so that the bodies of a clump don't overlap as much), or null
  unitRayHit(u, ray) {
    const tpl = u.tpl;
    if (!tpl || !u.obj) return null;
    if (!tpl._unitBox) {
      const bb = tpl.pick ? tpl.pick.clone() : new THREE.Box3().setFromObject(tpl.scene);
      const c = bb.getCenter(new THREE.Vector3()), h = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      h.x *= 0.8; h.z *= 0.8;
      tpl._unitBox = new THREE.Box3(c.clone().sub(h), c.clone().add(h));
    }
    const P = this._pk || (this._pk = { inv: new THREE.Matrix4(), ray: new THREE.Ray(), a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), hit: new THREE.Vector3() });
    u.obj.updateWorldMatrix(true, false);
    P.inv.copy(u.obj.matrixWorld).invert();
    if (!P.ray.copy(ray).applyMatrix4(P.inv).intersectBox(tpl._unitBox, P.hit)) return null;
    return P.hit.applyMatrix4(u.obj.matrixWorld).distanceTo(ray.origin);
  }
  // distance along the mouse ray to the box around a building's model (cheap; the order pickHit tries them in), or null
  boxHit(e, ray) {
    const tpl = e.tpl;
    if (!tpl || !e.obj) return null;
    if (!tpl._rayBox) { tpl._rayBox = new THREE.Box3().setFromObject(tpl.scene); if (tpl.pick) tpl._rayBox.union(tpl.pick); }
    const P = this._pk || (this._pk = { inv: new THREE.Matrix4(), ray: new THREE.Ray(), a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), hit: new THREE.Vector3() });
    e.obj.updateWorldMatrix(true, false);
    P.inv.copy(e.obj.matrixWorld).invert();
    if (!P.ray.copy(ray).applyMatrix4(P.inv).intersectBox(tpl._rayBox, P.hit)) return null;
    return P.hit.applyMatrix4(e.obj.matrixWorld).distanceTo(ray.origin);
  }
  // distance along the mouse ray to a building: its visible surfaces, as the player sees them (the flag-less hulls
  // and pick volumes of many models - SEAS above all - reach far beyond the building and swallowed the units and
  // trees around it). null = missed. Both sides of every triangle count: the models' mirrored frames turn the
  // winding around (a renderer-only fix). The triangles are read once per geometry (userData.tris).
  pickHit(e, ray) {
    const P = this._pk, L = P.ray, a = P.a, b = P.b, c = P.c, hit = P.hit;
    let best = null;
    const visit = (o) => {
      if (!o.visible) return;
      const g = o.geometry;
      if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && g && g.attributes.position && !o.userData.overlay) {
        P.inv.copy(o.matrixWorld).invert();
        L.copy(ray).applyMatrix4(P.inv);
        if (!g.boundingBox) g.computeBoundingBox();
        if (L.intersectsBox(g.boundingBox)) {
          let T = g.userData.tris;
          if (!T) {
            const pos = g.attributes.position, ix = g.index, n = ix ? ix.count : pos.count;
            T = g.userData.tris = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) { const v = ix ? ix.getX(i) : i; T[i * 3] = pos.getX(v); T[i * 3 + 1] = pos.getY(v); T[i * 3 + 2] = pos.getZ(v); }
          }
          for (let i = 0; i + 8 < T.length; i += 9) {
            a.set(T[i], T[i + 1], T[i + 2]); b.set(T[i + 3], T[i + 4], T[i + 5]); c.set(T[i + 6], T[i + 7], T[i + 8]);
            if (L.intersectTriangle(a, b, c, false, hit)) {
              const d = hit.applyMatrix4(o.matrixWorld).distanceTo(ray.origin);
              if (best === null || d < best) best = d;
            }
          }
        }
      }
      for (const ch of o.children) visit(ch);
    };
    visit(e.obj);
    return best;
  }
  // distance along the ray to a resource: a standing cylinder of its radius and the height of its kind
  resHit(n, ray) {
    const h = RES_HEIGHT[n.type] || 2, r = resRadius(n);
    const o = ray.origin, d = ray.direction, ox = o.x - n.pos.x, oz = o.z - n.pos.z;
    const A = d.x * d.x + d.z * d.z, B = 2 * (ox * d.x + oz * d.z), C = ox * ox + oz * oz - r * r;
    const D = B * B - 4 * A * C;
    if (A < 1e-9 || D < 0) return null;
    for (const t of [(-B - Math.sqrt(D)) / (2 * A), (-B + Math.sqrt(D)) / (2 * A)]) {
      const y = o.y + d.y * t;
      if (t > 0 && y >= n.pos.y - 0.5 && y <= n.pos.y + h) return t;
    }
    // looking straight down onto the top
    if (Math.abs(d.y) > 1e-6) { const t = (n.pos.y + h - o.y) / d.y; if (t > 0 && (o.x + d.x * t - n.pos.x) ** 2 + (o.z + d.z * t - n.pos.z) ** 2 <= r * r) return t; }
    return null;
  }
  // install the original cursors (dist/assets/ui/cur/*.png with hot spots) as CSS rules on body[data-cursor]
  static async loadCursors(base) {
    try {
      const hs = await fetch(base + 'cur/hotspots.json').then((r) => r.json());
      const css = Object.entries(hs).map(([k, [x, y]]) => `body[data-cursor="${k}"], body[data-cursor="${k}"] canvas { cursor: url(${base}cur/${k}.png) ${x} ${y}, auto; }`).join('\n');
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    } catch (e) { /* keep the system cursors */ }
  }
  // entity under the cursor: units first (smallest screen rectangle wins, so a soldier in front of a dinosaur
  // can be clicked), then the nearest along the mouse ray of the buildings (their visible surfaces) and the
  // resources (trees, stones ...)
  entityAt(mx, my) {
    const G = this.G;
    let best = null, ba = 1e12;
    const pad = 4;
    const shown = (u) => u.alive && u.obj && !u.inside && u.obj.visible && !u.unselectable && !(u.owner !== G.me && (!G.fow.visible(u.pos.x, u.pos.z) || G.world.hiddenFrom(u, G.me)));
    // as the original picks (the engine's ray against the objects' pick volumes): the unit whose volume the mouse
    // ray meets first - in a clump the one in front, exactly the one under the cursor
    const ray0 = this.ray(mx, my).clone();
    let ud = Infinity;
    for (const u of G.world.units) {
      if (!shown(u)) continue;
      const d = this.unitRayHit(u, ray0);
      if (d !== null && d < ud) { ud = d; best = u; }
    }
    if (best) return best;
    // nothing under the cursor itself: the nearest small figure around it (far zoom - a unit a few pixels tall)
    for (const u of G.world.units) {
      if (!shown(u)) continue;
      const r = this.pickRect(u);
      if (!r) continue;
      // tiny rectangles (far zoom) get a minimum click size
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      const hw = Math.max(10, (r.x1 - r.x0) / 2) + pad, hh = Math.max(12, (r.y1 - r.y0) / 2) + pad;
      if (Math.abs(mx - cx) > hw || Math.abs(my - cy) > hh) continue;
      const score = r.area + Math.hypot(mx - cx, my - cy) * 4;
      if (score < ba) { ba = score; best = u; }
    }
    if (best) return best;
    const g = this.groundPoint(mx, my);
    const ray = this.ray(mx, my).clone();
    const gate = (b) => (b.parentGate && b.parentGate.alive ? b.parentGate : b);   // a gate's wing selects the gate
    const far = g ? g.distanceTo(ray.origin) + 1 : 1600;
    let hit = null, hd = far;
    const cands = [];
    for (const b of G.world.buildings) {
      if (!b.alive || b.parked || b.unselectable || (b.owner !== G.me && (!G.fow.explored_(b.pos.x, b.pos.z) || G.world.hiddenFrom(b, G.me)))) continue;
      const d = this.boxHit(b, ray);
      if (d !== null && d < hd) cands.push([d, b]);
    }
    cands.sort((p, q) => p[0] - q[0]);
    for (const [d0, b] of cands) {                 // nearest box first; a hit nearer than the next box ends it
      if (d0 >= hd) break;
      const d = this.pickHit(b, ray);
      if (d !== null && d < hd) { hd = d; hit = b; }
    }
    // resources near the ray between the eye and the ground (tall trees in front of a building count)
    const seen = new Set(), o = ray.origin, dir = ray.direction;
    for (let t = Math.max(0, far - 160); t <= far; t += 6) {
      const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
      if (y - G.world.height(x, z) > 14) continue;
      G.world.rHash.query(x, z, 8, (n) => {
        if (seen.has(n)) return; seen.add(n);
        if (!n.alive || n.amount <= 0 || !G.fow.explored_(n.pos.x, n.pos.z)) return;
        const d = this.resHit(n, ray);
        if (d !== null && d < hd) { hd = d; hit = n; }
      });
    }
    // healing wells and items (their visible surfaces, like buildings)
    for (const w of [...G.world.wells, ...G.world.items]) {
      if (!w.alive || !w.visible || !G.fow.explored_(w.pos.x, w.pos.z)) continue;
      const d0 = this.boxHit(w, ray);
      if (d0 === null || d0 >= hd) continue;
      const d = this.pickHit(w, ray);
      if (d !== null && d < hd) { hd = d; hit = w; }
    }
    if (hit) return hit.kind === 'res' || hit.kind === 'well' || hit.kind === 'item' ? hit : gate(hit);
    if (g) {                                   // the ground right next to a small resource (bushes, stones in the grass)
      let rb = null, rd = 1;
      G.world.rHash.query(g.x, g.z, 6, (n) => {
        if (!n.alive || n.amount <= 0 || !G.fow.explored_(n.pos.x, n.pos.z)) return;
        const d = Math.hypot(n.pos.x - g.x, n.pos.z - g.z) - resRadius(n);
        if (d < rd) { rd = d; rb = n; }
      });
      if (rb) return rb;
    }
    return null;
  }
  viewCorners() {
    const G = this.G, cam = G.rtscam;
    if (!cam.target) return null;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -cam.target.y);
    const W = window.innerWidth, H = window.innerHeight;
    const out = [];
    for (const [x, y] of [[0, 0], [W, 0], [W, H], [0, H]]) {
      const r = this.ray(x, y);
      const p = new THREE.Vector3();
      if (!r.intersectPlane(plane, p) || p.distanceTo(r.origin) > 500) { p.copy(r.origin).addScaledVector(r.direction, 500); }
      out.push([p.x, p.z]);
    }
    return out;
  }

  // ------------------------------------------------------------------ mouse
  // camera (GameCameraModule.usl): middle drag pans, middle + right or Alt + left drag turns, Alt + right drag pans.
  // Right button: an order on release - dragged more than 2 m on the ground it draws the formation arrow
  // (GameInputController.usl:1474-1630: the group goes to the press point, facing the arrow).
  onDown(e) {
    const G = this.G, m = this.mouse;
    G.audio.init();
    m.x = e.clientX; m.y = e.clientY;
    if (e.button === 1) { e.preventDefault(); if (m.rdown) { m.rdown = false; m.arrow = null; m.rot = true; } else m.pan = true; m.px = e.clientX; m.py = e.clientY; m.rx = e.clientX; return; }
    if (e.button === 2) {
      if (m.pan) { m.pan = false; m.rot = true; m.rx = e.clientX; return; }
      if (e.altKey) { m.pan = true; m.px = e.clientX; m.py = e.clientY; return; }
      if (this.mode) { this.setMode(null); return; }
      G.hud.disarm();
      m.rdown = true; m.rsx = e.clientX; m.rsy = e.clientY; m.rg = this.groundPoint(e.clientX, e.clientY); m.arrow = null;
      return;
    }
    if (e.button !== 0) return;
    if (e.altKey) { m.rot = true; m.rx = e.clientX; return; }
    if (this.mode) { this.modeClick(e.clientX, e.clientY, e.shiftKey); return; }
    m.down = true; m.sx = e.clientX; m.sy = e.clientY; m.dragging = false;
  }
  onMove(e) {
    const m = this.mouse;
    m.x = e.clientX; m.y = e.clientY; m.inside = true;
    const cam = this.G.rtscam;
    if (m.rot) { cam.yaw -= (e.clientX - m.rx) * 0.006; m.rx = e.clientX; }
    else if (m.pan) { const k = cam.dist * 0.0016; cam.pan(-(e.clientX - m.px) * k, (e.clientY - m.py) * k); m.px = e.clientX; m.py = e.clientY; }
    if (m.rdown && m.rg) this.dragArrow(e.clientX, e.clientY);
    // the button was released where we never got the event (another window, a browser dialog): finish now
    if (m.down && !(e.buttons & 1)) { this.onUp({ button: 0, shiftKey: e.shiftKey, clientX: e.clientX, clientY: e.clientY }); return; }
    if (m.down && !m.dragging && Math.hypot(m.x - m.sx, m.y - m.sy) > 6) m.dragging = true;
  }
  onUp(e) {
    const G = this.G, m = this.mouse;
    if (e.button === 1) { m.rot = false; m.pan = false; return; }
    if (e.button === 2) {
      if (m.rot || m.pan) { m.rot = false; m.pan = false; return; }
      if (!m.rdown) return;
      m.rdown = false;
      const a = m.arrow;
      m.arrow = null;
      if (a) this.arrowOrder(a, e.shiftKey, e.ctrlKey); else this.rightClick(m.rsx, m.rsy, e.shiftKey, e.ctrlKey);
      return;
    }
    if (e.button === 0 && m.rot) { m.rot = false; return; }
    if (e.button === 0 && this.mode === 'place' && this.ghost && this.ghost.wall && this.ghost.pressed) {
      this.ghost.pressed = false;
      this.wallRelease(e.shiftKey, e.ctrlKey);
      return;
    }
    if (e.button !== 0 || !m.down) return;
    m.down = false;
    if (m.dragging) {
      m.dragging = false;
      const x0 = Math.min(m.sx, m.x), x1 = Math.max(m.sx, m.x), y0 = Math.min(m.sy, m.y), y1 = Math.max(m.sy, m.y);
      const list = [];
      const c = new THREE.Vector3();
      for (const u of G.world.units) {
        if (!u.alive || u.owner !== G.me || u.inside || u.autonomous || u.parked || u.unselectable) continue;
        const r = this.pickRect(u);
        let sx, sy;
        if (r) { sx = (r.x0 + r.x1) / 2; sy = (r.y0 + r.y1) / 2; } else { c.copy(u.pos); c.y += u.height * 0.4; const s = this.toScreen(c); if (s.z > 1) continue; sx = s.x; sy = s.y; }
        // a unit is inside when its centre or a good part of its rectangle is in the box
        const inside = (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) ||
          (r && Math.max(0, Math.min(x1, r.x1) - Math.max(x0, r.x0)) * Math.max(0, Math.min(y1, r.y1) - Math.max(y0, r.y0)) > 0.4 * r.area);
        if (inside) list.push(u);
      }
      if (e.shiftKey) { for (const u of list) G.sel.add(u); G.selChanged(); }
      else if (list.length) G.select(list);
      else G.select([]);
      return;
    }
    const t = this.entityAt(m.x, m.y);
    const now = performance.now();
    if (t && this.lastClick.e === t && now - this.lastClick.t < 350 && t.owner === G.me && t.kind !== 'res') {
      // double-click (GameInputController.usl:1353): the same class on screen - Ctrl: the same type (characters,
      // animals ...), Shift: all of them; on a hero: all heroes
      const all = [...G.world.units, ...G.world.buildings].filter((x) => x.alive && x.owner === G.me && !x.inside && !x.parked && !x.unselectable && this.onScreen(x));
      const same = e.shiftKey ? () => true : t.def && t.def.unique ? (x) => x.def && x.def.unique : e.ctrlKey ? (x) => x.kind === t.kind && x.cls === t.cls : (x) => x.name === t.name;
      G.select(all.filter(same));
    } else if (t) {
      if (e.shiftKey && t.owner === G.me && t.kind === 'unit') G.toggleSelect(t);
      else G.select([t]);
    } else if (!e.shiftKey) G.select([]);
    this.lastClick = { t: now, e: t };
  }
  onScreen(e) {
    const s = this.toScreen(e.pos);
    return s.z < 1 && s.x > 0 && s.y > 0 && s.x < window.innerWidth && s.y < window.innerHeight;
  }
  onWheel(e) {
    e.preventDefault();
    if (this.mode === 'place' && this.ghost) { this.ghost.rot += Math.sign(e.deltaY) * Math.PI / 8; return; }
    const cam = this.G.rtscam;
    cam.tDist = Math.max(cam.min, Math.min(cam.max, cam.tDist * (1 + Math.sign(e.deltaY) * 0.12)));
  }

  // ------------------------------------------------------------------ orders
  // ---- control groups (GroupMgr.usl, GroupBar.usl)
  // SetGroup: the own selection becomes group k; with nothing selected the camera view is kept instead (a view marker)
  assignGroup(k) {
    const G = this.G, list = [...G.sel].filter((x) => x.alive && x.owner === G.me);
    this.groups[k] = list;
    if (!list.length) { this.views[k] = { x: G.rtscam.x, z: G.rtscam.z, yaw: G.rtscam.yaw, d: G.rtscam.tDist }; G.hud.message(`View ${k} saved`); } else G.hud.message(`Group ${k} assigned`);
  }
  jumpToGroup(k, list) {
    const G = this.G;
    if (list.length) { let x = 0, z = 0; for (const u of list) { x += u.pos.x; z += u.pos.z; } G.rtscam.x = x / list.length; G.rtscam.z = z / list.length; }
    else { const v = this.views[k]; if (v) Object.assign(G.rtscam, { x: v.x, z: v.z, yaw: v.yaw, tDist: v.d }); }
  }
  // the group bar's buttons (CGroupButton): a click selects the group and keeps the button pressed while the
  // selection is the group; a right click assigns the selection; a double click takes the camera to the selection
  // (or the group's view)
  groupButton(k, how) {
    const G = this.G, list = (this.groups[k] || []).filter((x) => x.alive);
    if (how === 'assign') { this.assignGroup(k); return; }
    if (how === 'double') { if (list.length || this.views[k]) this.jumpToGroup(k, [...G.sel].filter((x) => x.alive).length ? [...G.sel].filter((x) => x.alive) : []); return; }
    if (this.selGroup === k || !list.length) return;
    G.select(list);
    this.selGroup = k;
    G.selChanged();
  }
  // GroupBar.OnChangeSelection: the pressed button comes up when the selection is no longer its group
  selectionChanged() {
    if (this.selGroup == null) return;
    const list = (this.groups[this.selGroup] || []).filter((x) => x.alive), G = this.G;
    if (list.length !== G.sel.size || list.some((x) => !G.sel.has(x))) this.selGroup = null;
  }
  myUnits() { return [...this.G.sel].filter((e) => e.alive && e.owner === this.G.me && e.kind === 'unit'); }
  // CSelectionInfo (GameInputController.usl): what the own part of the selection can do
  selectionInfo() {
    const G = this.G, W = G.world, own = [...G.sel].filter((e) => e.alive && e.owner === G.me);
    const I = { own, units: own.filter((e) => e.kind === 'unit'), types: new Set(), worker: false, fish: false, trade: [], attack: false,
      healers: [], harvest: { food: false, wood: false, stone: false }, build: false, minRange: 1e9, maxRange: 0, maxObj: null, area: 0 };
    for (const e of own) {
      I.types.add(e.cls);
      if (e.kind === 'unit' && e.cls === 'CHTR' && (/worker/.test(e.name) || W.data.kind(e.name) === 'tesla_s0')) I.worker = true;
      if ((e.naval && e.isWorker) || e.name === 'aje_floating_harbour') I.fish = true;
      if (/_cart$|^aje_trade_dino$/.test(e.name)) I.trade.push(e);
      if (e.kind === 'unit' && e.stats && e.stats.heal) I.healers.push(e);
      if (e.kind === 'unit' && e.isWorker && !e.naval && e.stats.carry) for (const r of ['food', 'wood', 'stone']) if (e.stats.carry[r] > 0) I.harvest[r] = true;
      if (e.kind === 'unit' && e.canBuild) I.build = true;
      const cs = e.weapons && e.weapons.long ? e.cs(e.weapons.long) : null;
      if (cs && cs.dmg > 0) {
        I.attack = true;
        I.area = Math.max(I.area, cs.splash || 0);
        I.minRange = Math.min(I.minRange, cs.minRange || 0);
        if (cs.range > I.maxRange) { I.maxRange = cs.range; I.maxObj = e; }
      }
    }
    return I;
  }
  // the cursor of a right click on h (or the ground point g) - GameInputController.usl GetAction, Game.usl CCursorMgr;
  // '' is the standard cursor (also over open ground: the original shows "walk" only while a move is armed)
  cursorFor(h, g, shift) {
    const G = this.G, W = G.world, S = G.mapSource;
    // the map's edge: no
    if (g && S && S.play && (g.x < S.play.x0 || g.x > S.play.x1 || g.z < S.play.z0 || g.z > S.play.z1)) return 'no';
    const I = this.selectionInfo();
    if (!I.own.length) return '';
    if (!h) return '';
    const can = (t) => I.types.has(t);
    // resources (trees, stone, fruit, carcasses, fish)
    if (h.kind === 'res') {
      if (!G.fow.visible(h.pos.x, h.pos.z) && h.res === 'wood') return '';
      if (h.water) return I.fish ? 'harvest_food' : '';
      if (I.fish && !I.harvest.food && !I.harvest.wood && !I.harvest.stone) return '';
      return I.harvest[h.res] ? 'harvest_' + h.res : '';
    }
    // an item: characters, animals and vehicles may take it (GetAction ITEM: the "trade" cursor)
    if (h.kind === 'item') return I.units.some((u) => W.canCarry(u)) ? 'trade' : '';
    // a healing well: characters, animals, vehicles and ships may drink (GetAction FNTN)
    if (h.kind === 'well') return I.units.some((u) => W.canUseWell(u, h)) ? 'healing' : '';
    // (a nest belongs to nobody: IsEnemy holds for it as for the wild animals - GetAction, GameInputController.usl:1111)
    const enemy = h.wild || h.isNest || (h.owner && W.hostileTo(G.me, h));
    if (enemy) {
      if (h.wild && h.cls === 'ANML' && I.worker) return 'attack_harvest';
      if (!I.attack) return '';
      if (I.maxObj) {
        const d = Math.hypot(h.pos.x - I.maxObj.pos.x, h.pos.z - I.maxObj.pos.z);
        if (d > I.maxObj.radius + (h.radius || 0) + I.maxRange) return 'attack_walk';
        if (I.area > 0 && d < I.minRange + I.maxObj.radius) return 'attack_area_weapon_invalid';
      }
      return 'attack';
    }
    if (h.owner && !G.me.isFriend(h.owner) && h.owner !== G.me) return '';
    // own and allied objects
    const usable = h.kind === 'building' && (/^(hu_bunker|hu_small_wall|hu_re_enforced_wall|aje_clay_wall|ninigi_palisade|ninigi_bamboofarm|ninigi_paddy|hu_corn_field|seas_greenhouse|aje_slaughterhouse)$/.test(h.name) || W.isFarm(h));
    if (I.healers.length && h.kind === 'unit' && (shift || !(W.capacity(h) > 0)) && h.hp < h.maxHp && (I.healers.length > 1 || !I.healers.includes(h))) return 'healing';
    if (W.capacity(h) > 0 && I.units.some((u) => u !== h && W.canBoard(u, h))) {
      if (h.kind === 'building' && I.build && (!h.built || ((shift || !usable) && h.hp < h.maxHp))) return 'build';
      if ((h.passengers ? h.passengers.length : 0) >= W.capacity(h)) return '';
      return 'load';
    }
    if (h.kind === 'building') {
      if (I.build && h.owner === G.me) {
        if (!h.built) return 'build';
        if ((shift || !usable) && h.hp < h.maxHp) return 'build';
        if (W.isFarm(h) && h.workers.size < W.farmSlots(h)) return h.name === 'ninigi_bamboofarm' ? (I.harvest.wood ? 'harvest_wood' : '') : (I.harvest.food ? 'harvest_food' : '');
      }
      if (I.trade.length && W.isTradeBuilding(h) && I.trade.some((u) => W.tradeHome(u) !== h)) return 'trade';
    }
    return '';
  }
  rightClick(mx, my, shift, ctrl = false) {
    if (this.mode) { this.setMode(null); return; }
    this.orderOn(this.entityAt(mx, my), this.groundPoint(mx, my), shift, ctrl);
  }
  // the right-click's order for the selection: on the object t (or nothing) at the ground point g; also Alt+right-click
  // on a card of the army pyramid (GameInputController.usl HandlePyramidAction: as if that object were clicked)
  orderOn(t, g, shift, ctrl = false) {
    const G = this.G;
    const units = this.myUnits();
    if (G.sequel && this.sequelClick(units, t)) return;
    // towers: right-click an enemy = shoot at it
    const towers = [...G.sel].filter((e) => e.alive && e.owner === G.me && G.world.canAimTower(e));
    if (towers.length && G.world.hostileTo(G.me, t) && G.world.aimTowers(towers, t)) {
      G.feedback.ui('UI_click');
      G.overlay.marker(t.pos.x, t.pos.z, 0xff3a2a);
      if (!units.length) return;
    }
    // moving harbours (SEAS carrier, Aje floating harbour): right-click sails there, Shift+right-click = rally point
    const harbours = [...G.sel].filter((e) => e.alive && e.owner === G.me && G.world.isMovingHarbour && G.world.isMovingHarbour(e) && e.built);
    if (harbours.length && !units.length && !shift && g) {
      let ok = 0;
      for (const b of harbours) if (!G.world.moveHarbour(b, g.x, g.z)) ok++;
      if (ok) { G.overlay.marker(g.x, g.z, 0x7dff6a); G.feedback.ui('UI_click'); }
      else { G.hud.message('It can only sail on water', 'bad'); G.feedback.error(); }
      return;
    }
    if (!units.length) {
      // rally point for selected production buildings / collector
      const prod = [...G.sel].filter((e) => G.canRally(e));
      if (prod.length && g) {
        for (const b of prod) { b.rally = t && t.kind === 'res' ? [t.pos.x, t.pos.z] : [g.x, g.z]; b.rallyTarget = t && t.kind === 'res' ? t : null; }
        G.overlay.marker(g.x, g.z, 0xffe070);
        G.feedback.ui('ui_rallypoint_land_set');
      }
      return;
    }
    // an item: the first selected unit that can carry it and has room goes for it - the last one even when its hands are
    // full, to hear that they are (GameInputController.usl HandleItem: "PickUp")
    if (t && t.kind === 'item') {
      const can = units.filter((u) => G.world.canCarry(u));
      const u = can.find((x) => !x.item) || can[can.length - 1];
      if (u) { G.order([u], { type: 'pickup', target: t }); G.feedback.ordered('move', [u]); G.overlay.marker(t.pos.x, t.pos.z, 0xffe070); return; }
    }
    // a healing well: who may drink there goes (GameInputController.usl: "/FountainHeal" for the selection)
    if (t && t.kind === 'well') {
      const ok = units.filter((u) => G.world.canUseWell(u, t));
      if (ok.length) { G.order(ok, { type: 'fountain', target: t }); G.feedback.ordered('heal', ok); G.overlay.marker(t.pos.x, t.pos.z, 0x7dff6a); return; }
    }
    // walls (GameInputController.usl HandleOwnBuilding): siege towers and brachiosaurs dock to a wall piece
    // ("Dock"; an enemy's: the attack order, VH:511), characters go up an own walkable wall ("Use") or climb a
    // ladder of their side ("ClimbLadder") - Shift on a damaged one repairs instead (game/systems/wallwalk.js, siege.js)
    if (t && t.alive && t.kind === 'building') {
      const W = G.world;
      const docks = units.filter((u) => W.canDock(u));
      if (docks.length && t.def.wallKind === 'wall' && t.tile) {
        G.order(docks, { type: 'dock', target: t });
        G.feedback.ordered('move', docks);
        G.overlay.marker(t.pos.x, t.pos.z, 0x7dff6a);
        if (docks.length === units.length) return;
      }
      const chars = units.filter((u) => u.cls === 'CHTR' && (W.canClimb(u) || u.onWall));
      const repair = shift && t.hp < t.maxHp && units.some((u) => u.canBuild);
      if (chars.length && t.built && !repair && ((t.owner === G.me && W.walkableWall(t)) || (W.isLadder(t) && G.me.isFriend(t.owner) && t.dockTile))) {
        G.order(chars, { type: W.isLadder(t) ? 'climb' : 'use', target: t });
        G.feedback.ordered('move', chars);
        G.overlay.marker(t.pos.x, t.pos.z, 0x7dff6a);
        return;
      }
    }
    // board a transport / enter a bunker
    if (t && t.alive && t.owner === G.me && t !== units[0] && G.world.capacity(t) > 0 && units.some((u) => G.world.canBoard(u, t))) {
      G.order(units.filter((u) => G.world.canBoard(u, t)), { type: 'board', target: t });
      G.feedback.ordered('move', units);
      G.overlay.marker(t.pos.x, t.pos.z, 0x7dff6a);
      return;
    }
    // trade carts: right-click another market
    const carts = units.filter((u) => /_cart$|trade_dino/.test(u.name));
    if (t && carts.length && G.world.isTradeBuilding(t) && G.me.isFriend(t.owner)) { G.order(carts, { type: 'trade', target: t }); G.overlay.marker(t.pos.x, t.pos.z, 0xffe070); return; }
    if (t && t.alive && units[0].isEnemy(t) && (t.kind === 'unit' || t.kind === 'building')) {
      G.order(units, { type: 'attack', target: t });
      G.feedback.ordered('attack', units);
      G.overlay.marker(t.pos.x, t.pos.z, 0xff3a2a);
      return;
    }
    // fish shoals are for fishing boats, everything else for land workers
    const workers = units.filter((u) => u.isWorker && (t && t.kind === 'res' ? !!t.water === !!u.naval : !u.naval)), others = units.filter((u) => !workers.includes(u));
    if (t && workers.length) {
      if (t.kind === 'res') {
        G.order(workers, { type: 'gather', target: t });
        G.feedback.ordered(t.res, workers);
        if (others.length) this.moveGroup(others, t.pos.x, t.pos.z, 'move');
        G.overlay.marker(t.pos.x, t.pos.z, 0xffe070);
        return;
      }
      if (t.kind === 'building' && t.owner === G.me && !t.built) {
        G.order(workers, { type: 'build', target: t });
        G.feedback.ordered('build', workers);
        if (others.length) this.moveGroup(others, t.pos.x, t.pos.z, 'move');
        G.overlay.marker(t.pos.x, t.pos.z, 0x7dff6a);
        return;
      }
      if (t.kind === 'building' && t.owner === G.me && t.built && G.world.isFarm(t)) {
        G.order(workers, { type: 'gather', target: t });
        G.feedback.ordered(t.def.unlimited[0] || 'food', workers);
        G.overlay.marker(t.pos.x, t.pos.z, 0xffe070);
        return;
      }
      if (t.kind === 'building' && t.owner === G.me && t.built && t.hp < t.maxHp && !(t.isDropoff && workers.some((w) => w.carry && w.carry.amount > 0))) {
        G.order(workers, { type: 'repair', target: t });
        G.feedback.ordered('build', workers);
        G.overlay.marker(t.pos.x, t.pos.z, 0x7dff6a);
        return;
      }
      if (t.owner === G.me && t.isDropoff) {
        const carrying = workers.filter((w) => w.carry && w.carry.amount > 0);
        if (carrying.length) {
          for (const w of carrying) { G.world.releaseTask(w); w.task = { type: 'gather', res: w.carry.res, phase: 'deliver', drop: t, node: null }; const [x, z] = G.world.approachPoint(w, t); w.setPath(x, z); }
          G.overlay.marker(t.pos.x, t.pos.z, 0x7dff6a);
          return;
        }
      }
    }
    // the others who can build (heroes like Tesla, the Dustriders' fighters: can_build - Repair.usl / BuildUp.usl
    // ask CanBuild only) build up or repair an own building
    const builders = units.filter((u) => u.canBuild);
    if (t && builders.length && t.kind === 'building' && t.owner === G.me && (!t.built || t.hp < t.maxHp)) {
      G.order(builders, { type: t.built ? 'repair' : 'build', target: t });
      G.feedback.ordered('build', builders);
      const rest = units.filter((u) => !builders.includes(u));
      if (rest.length) this.moveGroup(rest, t.pos.x, t.pos.z, 'move');
      G.overlay.marker(t.pos.x, t.pos.z, 0x7dff6a);
      return;
    }
    // medics: right-click on a wounded own unit heals it
    const healers = units.filter((u) => u.stats.heal);
    if (t && t.kind === 'unit' && t.owner === G.me && healers.length && t.hp < t.maxHp && !healers.includes(t)) {
      G.order(healers, { type: 'heal', target: t });
      G.feedback.ordered('heal', healers);
      const rest = units.filter((u) => !u.stats.heal);
      if (rest.length) this.moveGroup(rest, t.pos.x, t.pos.z, 'move');
      return;
    }
    if (!g) return;
    this.moveGroup(units, g.x, g.z, 'move', { queue: shift, patrol: ctrl });
    G.feedback.ordered('move', units);
    G.overlay.marker(g.x, g.z, 0x7dff6a);
  }
  // the formation arrow while the right button is held: from the press point to the cursor, with the places
  dragArrow(mx, my) {
    const m = this.mouse, g = this.groundPoint(mx, my);
    if (!g) return;
    const dx = g.x - m.rg.x, dz = g.z - m.rg.z, len = Math.hypot(dx, dz);
    if (!m.arrow && len <= 2.0) return;                       // (AbsSquare() > 4.0)
    const units = this.myUnits().filter((u) => !u.inside);
    if (!units.length) { m.arrow = null; return; }
    m.arrow = { x: m.rg.x, z: m.rg.z, dir: Math.atan2(dz, dx), len, spacing: arrowSpacing(len, units.length) };
    m.arrow.slots = formationSlots(this.G.world, units, m.arrow.x, m.arrow.z, m.arrow.dir, m.arrow.spacing).map(([, x, z]) => [x, z]);
    m.arrow.tip = [g.x, g.z];
  }
  arrowOrder(a, shift, ctrl) {
    const G = this.G, units = this.myUnits().filter((u) => !u.inside);
    if (!units.length) return;
    this.moveGroup(units, a.x, a.z, 'move', { dir: a.dir, spacing: a.spacing, queue: shift, patrol: ctrl });
    G.feedback.ordered('move', units);
    G.overlay.marker(a.x, a.z, 0x7dff6a);
  }
  // a group order to a point in formation (game/formation.js): opts.dir / spacing from the arrow, else facing from
  // the group to the point; queue (Shift): after the orders it has; patrol (Ctrl): to and fro from where it is
  moveGroup(units, x, z, type, opts = {}) {
    const G = this.G, n = units.length;
    let slots;
    if (n === 1) slots = [[units[0], x, z]];
    else {
      // facing from where the group will be: its last queued waypoint (Shift) or where it stands
      let cx = 0, cz = 0;
      for (const u of units) { const [qx, qz] = opts.queue ? lastWaypoint(u) : [u.pos.x, u.pos.z]; cx += qx; cz += qz; }
      cx /= n; cz /= n;
      slots = formationSlots(G.world, units, x, z, opts.dir ?? Math.atan2(z - cz, x - cx), opts.spacing ?? SPACING);
    }
    // one walk of the group: the first one to reach a waypoint takes the others on to the next (world.js moveDone)
    const wp = n > 1 ? { n } : null;
    for (const [u, px, pz] of slots) {
      const o = opts.patrol ? { type: 'patrol', pts: [[u.pos.x, u.pos.z], [px, pz]], i: 1 } : { type, x: px, z: pz, wp };
      if (opts.queue && G.world.queueOrder(u, o)) continue;
      G.order([u], o);
    }
  }
  // the sequel campaign: a capture truck sent to a sleeping animal (game/sequel/runtime.js)
  sequelClick(units, t) {
    const G = this.G;
    if (!t || t.kind !== 'unit' || !(t.sqAsleep > G.sequel.time)) return false;
    // a sleeping creature: the capture trucks drive up to load it; nobody else attacks it, they just go there
    const trucks = units.filter((u) => /capture/.test(u.name));
    G.order(trucks.length ? trucks : units, { type: 'move', x: t.pos.x, z: t.pos.z });
    G.overlay.marker(t.pos.x, t.pos.z, 0x7dff6a);
    return true;
  }
  setMode(m, data) {
    const G = this.G;
    if (this.mode === 'place' && m !== 'place') this.clearGhost();
    this.mode = m;
    this.modeData = data || null;
    document.body.dataset.mode = m || '';
    if (m === 'place') this.makeGhost(data);
  }
  modeClick(mx, my, shift) {
    const G = this.G;
    const units = this.myUnits();
    const g = this.groundPoint(mx, my);
    const t = this.entityAt(mx, my);
    const mode = this.mode;
    // the minimap's ping button: a click on the ground pings that point (SecondaryInputController.usl:329-337)
    if (mode === 'mapping') { if (g) G.mapPing(g.x, g.z); this.setMode(null); return; }
    if (mode === 'place' && this.ghost && this.ghost.wall) {
      // walls: press = the line starts here (after a Shift corner the line already follows the mouse)
      if (!g) return;
      if (!this.ghost.active) { this.ghost.active = true; this.ghost.start = { x: g.x, z: g.z }; this.ghost.held = []; }
      this.ghost.pressed = true;
      return;
    }
    if (mode === 'callback') {
      // a point for whoever asked (the sequel's command powers: ui/sequel_ui.js)
      const cb = this.modeData && this.modeData.onPoint;
      this.setMode(null);
      if (g && cb) cb(g.x, g.z, t);
      return;
    }
    if (mode === 'repair') {
      if (t && t.kind === 'building' && t.owner === G.me) { G.order(units.filter((u) => u.canBuild), { type: t.built ? 'repair' : 'build', target: t }); G.overlay.marker(t.pos.x, t.pos.z, 0x7dff6a); }
      if (!shift) this.setMode(null);
      return;
    }
    if (mode === 'target') {
      // special move that needs a target: the selected units that have the move use it on the clicked unit / point
      const a = this.modeData;
      const casters = [...G.sel].filter((e) => e.alive && e.owner === G.me && G.world.movesOf(e).some((x) => x.id === a.id));
      let used = 0;
      for (const c of casters) { const why = G.world.useMove(c, a, t && t.kind !== 'res' ? t : null, g); if (!why) { used++; if (!G.world.MOVES[a.id] || !G.world.MOVES[a.id].self) break; } else if (why !== 'cooldown') G.hud.message(G.reason(why), 'bad'); }
      if (used) G.feedback.ordered('attack', casters);
      if (!shift) this.setMode(null);
      return;
    }
    if (mode === 'lay') {
      // minelayer / corsair: the nearest selected ship that can build it goes there and lays it
      const a = this.modeData;
      const ships = [...G.sel].filter((e) => e.alive && e.owner === G.me && e.naval && G.data.actionsOf(e.rulesOwner(), e).some((x) => x.id === a.id));
      if (g && ships.length) {
        ships.sort((p, q) => Math.hypot(p.pos.x - g.x, p.pos.z - g.z) - Math.hypot(q.pos.x - g.x, q.pos.z - g.z));
        const why = G.world.layWaterThing(ships[0], a, g.x, g.z, shift);
        if (why) { G.hud.message(why === 'place' ? 'Must be in deep water, away from other mines' : G.reason(why), 'bad'); G.feedback.error(); }
        else { G.overlay.marker(g.x, g.z, 0x7dff6a); G.feedback.ordered('move', [ships[0]]); }
      }
      if (!shift) this.setMode(null);
      return;
    }
    if (mode === 'place') {
      if (!this.ghost || !this.ghost.ok) { G.hud.message('Cannot build here', 'bad'); G.feedback.error(); return; }
      if (this.ghost.action.freeMain) { if (G.placeFreeMain(this.ghost.action, this.ghost.x, this.ghost.z, this.ghost.rot)) this.setMode(null); return; }
      const ok = G.placeBuilding(this.ghost.action, this.ghost.x, this.ghost.z, this.ghost.rot, units.filter((u) => u.canBuild), shift);     // (Taslow and the Dustriders' fighters build too)
      if (ok && !shift) this.setMode(null);
      return;
    }
    if (mode === 'rally') {
      if (g) for (const e of G.sel) if (G.canRally(e)) { e.rally = [g.x, g.z]; e.rallyTarget = t && t.kind === 'res' ? t : null; }
      if (g) G.overlay.marker(g.x, g.z, 0xffe070);
    } else if (mode === 'move' && !units.length) {
      for (const b of G.sel) if (b.alive && b.owner === G.me && G.world.isMovingHarbour(b) && g) G.world.moveHarbour(b, g.x, g.z);
      if (g) G.overlay.marker(g.x, g.z, 0x7dff6a);
    } else if (mode === 'attack' && !units.length) {
      // towers only
      const towers = [...G.sel].filter((e) => e.alive && e.owner === G.me && G.world.canAimTower(e));
      if (G.world.hostileTo(G.me, t) && G.world.aimTowers(towers, t)) G.overlay.marker(t.pos.x, t.pos.z, 0xff3a2a);
      else { G.hud.message('Choose an enemy for the tower to shoot at', 'bad'); G.feedback.error(); }
    } else if (units.length) {
      // the Attack command also takes a neutral player's object (that means war, world.order); never a friend's
      if (mode === 'attack' && t && t.kind !== 'res' && t.owner && t.owner !== G.me && !units[0].isEnemy(t) && !G.world.attackAllowed(units[0], t)) { G.hud.message(`The ${t.owner.name} are your allies - you cannot attack them`, 'bad'); G.feedback.error(); }
      else if (mode === 'attack' && t && (units[0].isEnemy(t) || (t.kind !== 'res' && G.world.attackAllowed(units[0], t)))) { G.world.aimTowers([...G.sel], t); G.order(units, { type: 'attack', target: t }); G.overlay.marker(t.pos.x, t.pos.z, 0xff3a2a); }
      else if (g) { this.moveGroup(units, g.x, g.z, mode === 'move' ? 'move' : 'attackmove'); G.overlay.marker(g.x, g.z, mode === 'move' ? 0x7dff6a : 0xff3a2a); }
      G.feedback.ordered(mode === 'move' ? 'move' : mode === 'attack' ? 'attack' : 'amove', units);
    }
    if (!shift) this.setMode(null);
  }

  // ------------------------------------------------------------------ building placement ghost
  makeGhost(action) {
    const G = this.G;
    this.clearGhost();
    const name = action.results[0].obj;
    const st = G.data.stats(name, 1, G.me);
    const def = G.data.def(name, G.me);
    // the model the building will have (game/entities.js: the tech tree's, the class file's, a mission's stand-in);
    // none in the game data (data older than the game: the launcher's Prepare brings it up to date): a box
    const W = G.world, gfx = [st.gfx, W.data.classGfx(name), W.standIns && W.standIns.get(name.toLowerCase())].find((g) => g && W.template(g, true));
    const tpl = gfx ? W.template(gfx, true) : null;
    const obj = tpl ? cloneModel(tpl) : new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6).translate(0, 2, 0));
    if (G.particles) G.particles.untrack(obj);           // (a preview sprays no fire, smoke or fans)
    const mat = new THREE.MeshBasicMaterial({ color: 0x60ff60, transparent: true, opacity: 0.45, depthWrite: false, fog: false });
    obj.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; } });
    G.scene.add(obj);
    // wall pieces: one preview per tile of the line (wallTiles), coloured by state; the single ghost is hidden
    // (traps are dragged as lines too: CalcWall with type Trap, wallmap.js)
    const wall = !!(def && (def.wallKind === 'wall' || def.wallKind === 'trap'));
    this.ghost = { obj, mat, action, name, rot: 0, x: 0, z: 0, ok: false, wall, tpl, pool: [], active: false, held: [], tiles: [] };
    if (wall) obj.visible = false;
    // the placement grid (ObjPlaceChecker.EnableGridRendering, PlaceController.usl): not for walls, coastal buildings
    if (!wall && !(def && def.coastal)) { this.ghost.grid = placeGrid(); G.scene.add(this.ghost.grid); }
  }
  clearGhost() {
    if (!this.ghost) return;
    if (this.ghost.grid) { this.G.scene.remove(this.ghost.grid); this.ghost.grid.geometry.dispose(); }
    this.G.scene.remove(this.ghost.obj);
    for (const p of this.ghost.pool) this.G.scene.remove(p.obj);
    this.ghost = null;
  }
  // ---- wall lines (docs/spec/walls.md §3): hover = one tile under the cursor; press = start; drag = the line;
  // release = place (Shift: keep the line as a leg and go on from here; Ctrl: stay in build mode); right click = cancel
  wallPreview() {
    const gh = this.ghost, G = this.G, W = G.world, WM = W.wallMap;
    const g = this.groundPoint(this.mouse.x, this.mouse.y);
    if (!g) return;
    const s = gh.active ? gh.start : g;
    gh.tiles = W.wallLine(G.me, gh.action, s.x, s.z, g.x, g.z, gh.held);
    // no line (CalcWall false): nothing is shown (PlaceController AddWall: the grid off)
    const list = gh.tiles || [];
    // PreviewWall (C)0x4f9f70: the new tiles and the own wall pieces next to them, each with the parts it will have;
    // the first numA entries green, later ones yellow; tiles where a gate could go later cyan
    const ghosts = [];
    if (list.length) {
      const w = list.wall, me = WM.ownerId(G.me);
      WM.begin();
      for (const t of list) WM.write(t.i, t.j, me, w.race, w.cls, w.type);
      const seen = new Set();
      const add = (i, j, state, gateOK, name) => {
        const k = i + ',' + j;
        if (seen.has(k)) return;
        seen.add(k);
        const [x, z] = WM.centre(i, j);
        ghosts.push({ i, j, x, z, state, gateOK, name, parts: w.type === 0 ? WM.partsOf(i, j) : null, y: w.type === 3 ? W.height(x, z) : WM.zOf(i, j) });
      };
      for (const t of list) add(t.i, t.j, t.state, t.gateOK, null);
      if (w.type === 0) for (const t of list) for (let d = 0; d < 8; d++) {
        const ni = t.i + DXW[d], nj = t.j + DZW[d], o = WM.at(ni, nj);
        if (o && o.wall && o.wall.alive && o.wall.owner === G.me) add(ni, nj, 'ok', false, o.wall.name);
      }
      WM.restore();
    }
    const COL = { ok: 0x60ff60, have: 0x60ff60, cost: 0xffe060, bad: 0xff4040, gate: 0x00ffff };
    ghosts.forEach((t, k) => {
      let p = gh.pool[k];
      const tpl = t.name ? W.template(G.data.stats(t.name, 1, G.me).gfx, true) || gh.tpl : gh.tpl;
      if (!p || p.tpl !== tpl) {
        if (p) G.scene.remove(p.obj);
        const obj = tpl ? cloneModel(tpl) : gh.obj.clone();
        if (tpl && G.particles) G.particles.untrack(obj);
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        G.scene.add(obj);
        p = gh.pool[k] = { obj, mats: {}, tpl };
      }
      const st = t.gateOK && t.state === 'ok' ? 'gate' : t.state;
      if (!p.mats[st]) p.mats[st] = new THREE.MeshBasicMaterial({ color: COL[st], transparent: true, opacity: 0.5, depthWrite: false, fog: false });
      const m = p.mats[st];
      p.obj.traverse((o) => { if (o.isMesh) o.material = m; });
      if (t.parts) p.obj.userData.parts = new Set(t.parts);
      applyState(p.obj, 4, 0, G.me.epoch());
      p.obj.position.set(t.x, t.y, t.z);
      p.obj.rotation.y = t.parts ? WALL_ROT : 0;
      p.obj.visible = true;
    });
    for (let k = ghosts.length; k < gh.pool.length; k++) gh.pool[k].obj.visible = false;
  }
  wallRelease(shift, ctrl) {
    const gh = this.ghost, G = this.G;
    if (!gh || !gh.active) return;
    this.wallPreview();
    const tiles = gh.tiles, last = tiles && tiles[tiles.length - 1];
    // Shift: the line so far is frozen as a leg, the next one starts here (PlaceController: m_iNumTilesHold)
    if (shift && last) { gh.held = tiles.map((t) => ({ ...t })); gh.start = { x: last.x, z: last.z }; return; }
    if (!tiles) { G.hud.message(REASON_PLACE, 'bad'); G.feedback.error(); return; }
    const builders = this.myUnits().filter((u) => u.canBuild);
    const n = G.placeWall(gh.action, tiles, builders, ctrl);
    gh.active = false; gh.held = []; gh.start = null;
    if (n && !ctrl) this.setMode(null);
  }

  updateGhost() {
    const gh = this.ghost, G = this.G;
    if (!gh) return;
    if (gh.wall) { this.wallPreview(); return; }
    const g = this.groundPoint(this.mouse.x, this.mouse.y);
    if (!g) { gh.obj.visible = false; gh.ok = false; return; }
    gh.obj.visible = true;
    gh.x = Math.round(g.x); gh.z = Math.round(g.z);
    // towers and traps go onto wall tiles: pointing at a wall piece (whose top hides the ground behind it) means
    // its tile, not the ground point the ray reaches behind the wall
    const gdef = G.data.def(gh.name, G.me) || {}, kind = gdef.wallKind, ladder = gdef.script === 'CLadder';
    if (kind === 'tower' || kind === 'trap' || kind === 'gate' || ladder) {
      // (a ladder goes against any wall piece, an enemy's above all: game/systems/siege.js)
      const e = this.entityAt(this.mouse.x, this.mouse.y);
      let w = e && e.kind === 'building' && e.def && e.def.wallKind === 'wall' && (e.owner === G.me || ladder) ? e : null;
      // (as the original's CalcWall: the wall-map tile under the cursor - the ground just beside a piece counts too)
      if (!w && !ladder && G.world.wallMap) { const WM = G.world.wallMap, t = WM.at(...WM.tileOf(gh.x, gh.z)); if (t && t.wall && t.wall.alive && t.wall.owner === G.me) w = t.wall; }
      if (w) { gh.x = w.pos.x; gh.z = w.pos.z; }
    }
    gh.obj.position.set(gh.x, G.world.height(gh.x, gh.z), gh.z);
    gh.obj.rotation.y = gh.rot;
    // a waiting mobile base (main.js freeMainActions): where the ground is free (a waiting building: the building rules)
    if (gh.action.freeMain && gh.action.freeMain.kind === 'unit') { gh.ok = !!(G.campaign && G.campaign.freeMainOk(gh.action.freeMain, gh.x, gh.z)); gh.mat.color.setHex(gh.ok ? 0x60ff60 : 0xff4040); return; }
    // coastal buildings (harbours) snap to the shore: show the ghost where it will really stand
    const ws = this.myUnits().filter((u) => u.canBuild);
    const from = ws.length ? [ws.reduce((s, u) => s + u.pos.x, 0) / ws.length, ws.reduce((s, u) => s + u.pos.z, 0) / ws.length] : null;
    const at = G.world.placement(gh.name, gh.x, gh.z, gh.rot, G.me, from);
    if (at.x !== gh.x || at.z !== gh.z || at.rot !== gh.rot) {
      gh.x = at.x; gh.z = at.z; gh.rot = at.rot;
      gh.obj.position.set(gh.x, Math.max(G.world.height(gh.x, gh.z), G.world.waterLevel != null ? G.world.waterLevel + 1.5 : -1e9), gh.z);
      gh.obj.rotation.y = gh.rot;
    }
    // wall-map objects stand at the tile's quantised height; a gate shows its end pieces only on a diagonal
    if (kind === 'gate' || kind === 'tower') gh.obj.position.y = G.world.wallMap.zOf(...G.world.wallMap.tileOf(gh.x, gh.z));
    if (kind === 'gate' && at.fit) { gh.obj.userData.gateEnds = at.fit.d % 2 === 0; applyState(gh.obj, 4, 0, G.me.epoch()); }
    gh.ok = at.ok && G.fow.explored_(gh.x, gh.z);
    gh.mat.color.setHex(gh.ok ? 0x60ff60 : 0xff4040);
    if (gh.grid) this.updatePlaceGrid(gh);
  }
  // the dots of the placement grid around the ghost (ObjPlaceChecker.EnableGridRendering, PlaceController.usl): a dot
  // every 2 m, green where the building may be put down with its centre on that dot - any green dot is a place it
  // fits, turned as it is now - red where it may not (something in the way under its footprint, water, unexplored
  // ground, the map's border). Worked out again when the ghost moves to another 2 m cell or turns.
  updatePlaceGrid(gh) {
    const G = this.G, W = G.world, nav = W.nav, S = PLACE_STEP;
    const cx = Math.round(gh.x / S) * S, cz = Math.round(gh.z / S) * S;
    const key = cx + ',' + cz + ',' + gh.rot + ',' + nav.version + ',' + W.buildings.length;
    gh.grid.visible = gh.obj.visible;
    if (gh.gridKey === key) return;
    gh.gridKey = key;
    const R = PLACE_GRID_R;
    const pos = gh.grid.geometry.attributes.position, col = gh.grid.geometry.attributes.color;
    let n = 0;
    for (let dz = -R; dz <= R; dz += S) for (let dx = -R; dx <= R; dx += S) {
      const d = Math.hypot(dx, dz);
      if (d > R || n >= pos.count) continue;
      const x = cx + dx, z = cz + dz;
      const ok = G.fow.explored_(x, z) && !W.isWater(x, z, 0.1) && W.canPlace(gh.name, x, z, gh.rot, G.me);
      pos.setXYZ(n, x, W.height(x, z) + 0.4, z);
      const fade = Math.min(1, (R - d) / 6 + 0.25);    // fading towards the edge of the grid
      if (ok) col.setXYZ(n, 0.25 * fade, 1.0 * fade, 0.3 * fade); else col.setXYZ(n, 1.0 * fade, 0.2 * fade, 0.15 * fade);
      n++;
    }
    gh.grid.geometry.setDrawRange(0, n);
    pos.needsUpdate = true; col.needsUpdate = true;
  }

  // ------------------------------------------------------------------ keyboard
  // The original's accelerators (Scripts/Game/options/Keys.srf; docs/spec/formations.md §B), by letter like the
  // original's virtual keys: Q A Y build / produce rows, X stances, E D C special-move rows (then 1 .. 0 press the
  // row's buttons), V attack, B move, W idle worker, H headquarters, T Z U I O P L K the next HQ / barracks / farm /
  // machine maker / harbour / temple / weapon smith / tavern, Space the last event, Del self-destruct. The remake's
  // own: N attack-move, S stop, R rally point, Ctrl+U level up, J quest log, Home centre, F5 / F8 save / load.
  onKey(e) {
    const G = this.G;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    this.keys[e.code] = true;
    if (G.mission && G.mission.key(e)) return;        // campaign: cutscene keys, J = quest log (ui/mission.js)
    if (G.menuOpen) { if (e.code === 'Escape' || e.code === 'F10') G.closeMenu(); return; }
    // the chat (Keys: Enter to all, Ctrl+Enter to the allies, Shift+Enter to the enemies)
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && G.chat) { e.preventDefault(); G.chat.open(e.ctrlKey ? 'allies' : e.shiftKey ? 'enemies' : 'all'); return; }
    if (e.code === 'F1') { e.preventDefault(); G.menu.helpFor(); return; }      // ShowHelp (Keys.srf F1)
    // Tab / Ctrl+Tab: the army pyramid open or closed (Keys.srf SwitchPyramidForward / Backward - the same toggle)
    if (e.code === 'Tab') { e.preventDefault(); G.hud.togglePyramid(); return; }
    const units = this.myUnits();
    const digit = /^(Digit|Numpad)(\d)$/.exec(e.code);
    if (digit && !(digit[1] === 'Numpad' && !G.hud.armed)) {
      const k = digit[2];
      // a command bar row is armed: the digit presses its button (CmdBar_Accel_1 .. 0)
      if (G.hud.armed && !e.ctrlKey) { G.hud.pressArmed((+k + 9) % 10); e.preventDefault(); return; }
      if (e.ctrlKey) { this.assignGroup(k); e.preventDefault(); return; }
      const list = (this.groups[k] || []).filter((x) => x.alive);
      const now = performance.now(), again = this.lastGroupKey.k === k && now - this.lastGroupKey.t < 300;
      this.lastGroupKey = { k, t: now };
      // GameInputController.usl GetGroup: a press selects the group (an empty one: nothing); a second press within
      // 300 ms takes the camera to it - or to the view kept under the digit
      if (again) this.jumpToGroup(k, list);
      if (e.shiftKey) for (const x of list) G.sel.add(x); else G.select(list);
      G.selChanged();
      return;
    }
    const L = letterOf(e), plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (L && plain) {
      // command bar rows (CmdBar_Accel_R..): Q / A / Y the build menu (anyone who can build) or the produce menu,
      // X the stances, E / D / C the special moves; rows counted from the bottom
      const builds = units.some((u) => u.canBuild);
      const ROW = { q: [builds ? 'build' : 'produce', 2], a: [builds ? 'build' : 'produce', 1], y: [builds ? 'build' : 'produce', 0],
        x: ['stances', 0], e: ['special', 2], d: ['special', 1], c: ['special', 0] };
      if (ROW[L]) { if (!G.hud.armRow(...ROW[L])) G.hud.disarm(); return; }
      G.hud.disarm();
      const PICK = PICK_KEYS[L];
      if (PICK) { this.pickNext(PICK, L === 'h'); return; }
      switch (L) {
        case 'v': if (units.length || [...G.sel].some((x) => G.world.canAimTower(x))) this.setMode('attack'); return;     // CmdBar_Accel_R30: Attack
        case 'b': if (units.length || [...G.sel].some((x) => G.world.isMovingHarbour(x) && x.built)) this.setMode('move'); return;   // CmdBar_Accel_R40: Walk
        case 'n': if (units.length) this.setMode('amove'); return;
        case 's': if (units.length) G.order(units, { type: 'stop' }); return;
        case 'r': if ([...G.sel].some((x) => G.canRally(x))) this.setMode('rally'); return;
        case 'w': G.selectIdleWorker(e.shiftKey ? 'add' : 'next'); return;                                   // PickIdleWorker / AddIdleWorker
      }
    }
    if (L === 'w' && e.ctrlKey) { G.selectIdleWorker('all'); e.preventDefault(); return; }             // AllIdleWorker
    if (L === 'a' && e.ctrlKey) {                                                                       // AllUnitsOnScreen
      G.select(G.world.units.filter((u) => u.alive && u.owner === G.me && !u.inside && !u.parked && u.cls !== 'SHIP' && this.onScreen(u))); e.preventDefault(); return;
    }
    if (L === 's' && e.ctrlKey) { G.quickSave(); e.preventDefault(); return; }                         // Quicksave
    if (L === 'u' && e.ctrlKey) { if (units.length === 1) G.levelUp(units[0]); e.preventDefault(); return; }
    switch (e.code) {
      case 'Escape':
        if (G.hud.armed) G.hud.disarm();                                // CmdBar_Accel_Abort
        else if (this.mode) this.setMode(null); else if (G.hud.menu) G.hud.toggleMenu(G.hud.menu); else G.openMenu();
        break;
      case 'F1': G.menu.help(() => G.closeMenu()); G.menuOpen = true; e.preventDefault(); break;      // ShowHelp
      case 'F2': this.follow = [...G.sel].find((x) => x.alive && x.kind === 'unit') || null; e.preventDefault(); break;   // LinkCameraToPath
      case 'F3': this.follow = null; e.preventDefault(); break;                                         // FreeCamera
      case 'F10': G.openMenu(); e.preventDefault(); break;
      case 'F9': G.togglePerf(); e.preventDefault(); break;
      case 'F5': G.quickSave(); e.preventDefault(); break;          // quick save / quick load (game/save.js)
      case 'F8': G.quickLoad(); e.preventDefault(); break;
      case 'Pause': case 'NumpadDivide': G.togglePause(); e.preventDefault(); break;                 // TacticalPause / StopTime
      case 'Space': this.lastEvent(); e.preventDefault(); break;                                        // JumpToLastEvent
      case 'Home': { const f = [...G.sel].find((x) => x.alive); G.centerOn(f || G.homeEntity()); e.preventDefault(); break; }
      case 'Delete': if (e.shiftKey) G.killSelected(); else G.killSelected(1); break;                   // Kill (the first) / KillAll
      case 'Period': case 'NumpadDecimal': G.selectIdleWorker(); break;
      case 'PageUp': G.rtscam.tDist = Math.min(G.rtscam.max, G.rtscam.tDist + 15); e.preventDefault(); break;     // ZoomOut
      case 'PageDown': G.rtscam.tDist = Math.max(G.rtscam.min, G.rtscam.tDist - 15); e.preventDefault(); break;  // ZoomIn
      case 'End': G.rtscam.yaw = 0; G.rtscam.tDist = 70; break;                                                  // ResetCameraToDefaultView
      case 'Backspace': G.hud.root.classList.toggle('hidden'); e.preventDefault(); break;                       // HideUI
      case 'NumpadAdd': case 'NumpadSubtract': case 'NumpadMultiply': G.setSpeed(e.code); break;                 // AccTime / DecTime / ResetTime
    }
  }
  // the next own finished building (or Aje collector) of these classes, by distance from the camera's point, not one
  // already selected (PickNextFromObjQuery, Game.usl:2070); H (JumpToHQ) starts at the nearest headquarters
  pickNext(classes, hq) {
    const G = this.G, set = new Set(classes), cam = G.rtscam;
    const all = [...G.world.buildings.filter((b) => b.alive && b.built && b.owner === G.me && set.has(b.name)),
      ...G.world.units.filter((u) => u.alive && u.owner === G.me && set.has(u.name))];
    if (!all.length) return;
    all.sort((a, b) => Math.hypot(a.pos.x - cam.x, a.pos.z - cam.z) - Math.hypot(b.pos.x - cam.x, b.pos.z - cam.z));
    const cur = hq && !all.some((x) => G.sel.has(x)) ? null : all.find((x) => !G.sel.has(x));
    const t = cur || all[0];
    G.select([t]); G.centerOn(t);
    G.pings.push({ x: t.pos.x, z: t.pos.z, t: G.world.time });
    if (G.minimap) G.minimap.marker('Finished', t.pos.x, t.pos.z);         // (Game.usl:2109-2111)
  }
  // Space (JumpToLastEvent): where the last alert was (attack, warp gate ...), else the selection
  lastEvent() {
    const G = this.G, p = G.pings && G.pings[G.pings.length - 1];
    if (p && G.world.time - p.t < 120) { G.rtscam.x = p.x; G.rtscam.z = p.z; return; }
    const f = [...G.sel].find((x) => x.alive);
    G.centerOn(f || G.homeEntity());
  }

  // ------------------------------------------------------------------ minimap
  mmCoords(e, canvas) {
    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width * canvas.width, my = (e.clientY - r.top) / r.height * canvas.height;
    return this.G.minimap.m2w(mx, my);
  }
  // GameCameraModule.usl:639-667: the left button moves the camera there (also while an order waits for its target;
  // dragging keeps moving it), the right button's release gives the plain order of a right-click on bare ground -
  // walk / sail, a building's rally point, Shift queues - but never gathers; the ping button's mode pings the point
  minimapDown(e, canvas) {
    const G = this.G;
    e.preventDefault(); e.stopPropagation();
    const [x, z] = this.mmCoords(e, canvas);
    if (e.button === 0) {
      if (this.mode === 'mapping') return;
      G.rtscam.x = x; G.rtscam.z = z; this.mmDrag = true;
      const up = () => { this.mmDrag = false; window.removeEventListener('mouseup', up, true); };
      window.addEventListener('mouseup', up, true);    // capture: the HUD stops mouseup from bubbling
    }
  }
  minimapMove(e, canvas) {
    if (!this.mmDrag) return;
    const [x, z] = this.mmCoords(e, canvas);
    this.G.rtscam.x = x; this.G.rtscam.z = z;
  }
  minimapUp(e, canvas) {
    const G = this.G;
    e.preventDefault(); e.stopPropagation();
    const [x, z] = this.mmCoords(e, canvas);
    if (e.button === 0 && this.mode === 'mapping') { G.mapPing(x, z); this.setMode(null); return; }
    if (e.button !== 2) return;
    if (this.mode) { this.setMode(null); return; }
    const units = this.myUnits();
    if (units.length) { this.moveGroup(units, x, z, 'move', { queue: e.shiftKey }); G.feedback.ordered('move', units); }
    else for (const b of G.sel) if (G.canRally(b)) b.rally = [x, z];
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const G = this.G, cam = G.rtscam, k = this.keys, m = this.mouse;
    if (G.mission && G.mission.cine) { this.hover = null; return; }      // a cutscene: the player has no input (no scrolling)
    const sp = cam.dist * 1.1 * dt;
    let dx = 0, dz = 0;
    if (k.ArrowLeft) dx -= 1;
    if (k.ArrowRight) dx += 1;
    if (k.ArrowUp) dz += 1;
    if (k.ArrowDown) dz -= 1;
    if (G.settings.edgeScroll && m.inside && !m.down && !m.rot && document.hasFocus()) {
      const E = 4;
      if (m.x <= E) dx -= 1;
      if (m.x >= window.innerWidth - E - 1) dx += 1;
      if (m.y <= E) dz += 1;
      if (m.y >= window.innerHeight - E - 1) dz -= 1;
    }
    if (dx || dz) { cam.pan(dx * sp, dz * sp); this.follow = null; }
    if (this.follow) { if (this.follow.alive && !this.follow.inside) { cam.x = this.follow.pos.x; cam.z = this.follow.pos.z; } else this.follow = null; }
    if (k.PageUp) cam.tDist = Math.max(cam.min, cam.tDist - 60 * dt);
    if (k.PageDown) cam.tDist = Math.min(cam.max, cam.tDist + 60 * dt);
    this.hoverT -= dt;
    if (this.hoverT <= 0 && !m.dragging) {
      this.hoverT = 0.07;
      const overHud = document.elementFromPoint(m.x, m.y) !== G.canvas && document.elementFromPoint(m.x, m.y) !== G.overlay.canvas;
      this.hover = overHud ? null : this.entityAt(m.x, m.y);
      // the original mouse cursors (Data/Base/Cursors): what a right click would do here
      let cur = 'standard';
      if (this.mode) cur = { move: 'walk', rally: 'walk', amove: 'walk_aggro', attack: 'attack', place: 'build', lay: 'build', repair: 'build', target: 'special', mapping: 'mapping' }[this.mode] || 'standard';
      else if (!overHud) cur = this.cursorFor(this.hover, this.groundPoint(m.x, m.y), !!k.ShiftLeft || !!k.ShiftRight) || 'standard';
      if (cur === 'healing') cur = 'special';                // CCursorMgr: healing shows Special.cur
      if (m.x <= 4) cur = 'sm_left'; else if (m.x >= window.innerWidth - 5) cur = 'sm_right';
      if (m.y <= 4) cur = cur.startsWith('sm_') ? cur.replace('sm_', 'sm_up_') : 'sm_up'; else if (m.y >= window.innerHeight - 5) cur = cur.startsWith('sm_') ? cur.replace('sm_', 'sm_down_') : 'sm_down';
      if (!G.settings.edgeScroll && cur.startsWith('sm_')) cur = 'standard';
      if (document.body.dataset.cursor !== cur) document.body.dataset.cursor = cur;
    }
    if (this.mode === 'place') this.updateGhost();
  }
}
