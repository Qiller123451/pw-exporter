import * as THREE from 'three';
import { cloneModel } from '../engine/assets.js';
import { applyState } from '../engine/parts.js';
import { DIRS } from '../game/wallmap.js';

// Mouse/keyboard: camera, selection, context orders, building placement, control groups.
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
    obj.updateMatrixWorld();
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
  // install the original cursors (dist/assets/ui/cur/*.png with hot spots) as CSS rules on body[data-cursor]
  static async loadCursors(base) {
    try {
      const hs = await fetch(base + 'cur/hotspots.json').then((r) => r.json());
      const css = Object.entries(hs).map(([k, [x, y]]) => `body[data-cursor="${k}"], body[data-cursor="${k}"] canvas { cursor: url(${base}cur/${k}.png) ${x} ${y}, auto; }`).join('\n');
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    } catch (e) { /* keep the system cursors */ }
  }
  // entity under the cursor: units first (smallest screen rectangle wins, so a soldier in front of a dinosaur
  // can be clicked), then buildings (footprint under the ground point or their pick volume), then resources
  entityAt(mx, my) {
    const G = this.G;
    let best = null, ba = 1e12;
    const pad = 4;
    for (const u of G.world.units) {
      if (!u.alive || !u.obj || u.inside || !u.obj.visible || u.unselectable || (u.owner !== G.me && (!G.fow.visible(u.pos.x, u.pos.z) || G.world.hiddenFrom(u, G.me)))) continue;
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
    let bb = null, bbd = 1e12;
    for (const b of G.world.buildings) {
      if (!b.alive || b.parked || b.unselectable || (b.owner !== G.me && (!G.fow.explored_(b.pos.x, b.pos.z) || G.world.hiddenFrom(b, G.me)))) continue;
      if (g && b.surfDist(g.x, g.z) < 0.5) return b.parentGate && b.parentGate.alive ? b.parentGate : b;   // a gate's wing selects the gate
      const r = this.pickRect(b);
      if (r && mx >= r.x0 && mx <= r.x1 && my >= r.y0 && my <= r.y1 && r.area < bbd) { bbd = r.area; bb = b; }
    }
    if (bb) return bb.parentGate && bb.parentGate.alive ? bb.parentGate : bb;
    if (g) {
      let rb = null, rd = 4;
      G.world.rHash.query(g.x, g.z, 6, (n) => {
        if (!n.alive || n.amount <= 0 || !G.fow.explored_(n.pos.x, n.pos.z)) return;
        const d = Math.hypot(n.pos.x - g.x, n.pos.z - g.z) - n.radius;
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
  onDown(e) {
    const G = this.G, m = this.mouse;
    G.audio.init();
    m.x = e.clientX; m.y = e.clientY;
    if (e.button === 1) { m.rot = true; m.rx = e.clientX; e.preventDefault(); return; }
    if (e.button === 2) { this.rightClick(e.clientX, e.clientY, e.shiftKey); return; }
    if (e.button !== 0) return;
    if (this.mode) { this.modeClick(e.clientX, e.clientY, e.shiftKey); return; }
    m.down = true; m.sx = e.clientX; m.sy = e.clientY; m.dragging = false;
  }
  onMove(e) {
    const m = this.mouse;
    m.x = e.clientX; m.y = e.clientY; m.inside = true;
    if (m.rot) { this.G.rtscam.yaw -= (e.clientX - m.rx) * 0.006; m.rx = e.clientX; }
    // the button was released where we never got the event (another window, a browser dialog): finish now
    if (m.down && !(e.buttons & 1)) { this.onUp({ button: 0, shiftKey: e.shiftKey, clientX: e.clientX, clientY: e.clientY }); return; }
    if (m.down && !m.dragging && Math.hypot(m.x - m.sx, m.y - m.sy) > 6) m.dragging = true;
  }
  onUp(e) {
    const G = this.G, m = this.mouse;
    if (e.button === 1) { m.rot = false; return; }
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
    if (t && this.lastClick.e === t && now - this.lastClick.t < 350 && t.owner === G.me && t.kind === 'unit') {
      // double-click: all of this type on screen
      const list = G.world.units.filter((u) => u.alive && u.owner === G.me && u.name === t.name && this.onScreen(u));
      G.select(list);
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
  myUnits() { return [...this.G.sel].filter((e) => e.alive && e.owner === this.G.me && e.kind === 'unit'); }
  rightClick(mx, my, shift) {
    const G = this.G;
    if (this.mode) { this.setMode(null); return; }
    const units = this.myUnits();
    const t = this.entityAt(mx, my);
    const g = this.groundPoint(mx, my);
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
    this.moveGroup(units, g.x, g.z, 'move');
    G.feedback.ordered('move', units);
    G.overlay.marker(g.x, g.z, 0x7dff6a);
  }
  moveGroup(units, x, z, type) {
    const G = this.G;
    const n = units.length;
    if (n === 1) { G.order(units, { type, x, z }); return; }
    let cx = 0, cz = 0;
    for (const u of units) { cx += u.pos.x; cz += u.pos.z; }
    cx /= n; cz /= n;
    const a = Math.atan2(z - cz, x - cx);
    const fx = Math.cos(a), fz = Math.sin(a), rx = -fz, rz = fx;
    const sp = Math.max(...units.map((u) => u.radius)) * 2.4 + 0.6;
    const cols = Math.ceil(Math.sqrt(n * 1.6));
    // sort units by their lateral position so paths don't cross
    const sorted = [...units].sort((p, q) => ((p.pos.x - cx) * rx + (p.pos.z - cz) * rz) - ((q.pos.x - cx) * rx + (q.pos.z - cz) * rz));
    const rows = Math.ceil(n / cols);
    sorted.forEach((u, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, n - r * cols);
      const lat = (c - (inRow - 1) / 2) * sp, lon = -(r - (rows - 1) / 2) * sp;
      let px = x + rx * lat + fx * lon, pz = z + rz * lat + fz * lon;
      if (!G.world.nav.isFree(px, pz)) { const k = G.world.nav.nearestFree(G.world.nav.idx(px, pz), 6); [px, pz] = G.world.nav.center(k); }
      G.order([u], { type, x: px, z: pz });
    });
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
    if (mode === 'place' && this.ghost && this.ghost.wall) {
      // walls: press = the line starts here (after a Shift corner the line already follows the mouse)
      if (!g) return;
      if (!this.ghost.active) { this.ghost.active = true; this.ghost.start = { x: g.x, z: g.z }; this.ghost.held = []; }
      this.ghost.pressed = true;
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
        const why = G.world.layWaterThing(ships[0], a, g.x, g.z);
        if (why) { G.hud.message(why === 'place' ? 'Must be in deep water, away from other mines' : G.reason(why), 'bad'); G.feedback.error(); }
        else { G.overlay.marker(g.x, g.z, 0x7dff6a); G.feedback.ordered('move', [ships[0]]); }
      }
      if (!shift) this.setMode(null);
      return;
    }
    if (mode === 'place') {
      if (!this.ghost || !this.ghost.ok) { G.hud.message('Cannot build here', 'bad'); G.feedback.error(); return; }
      const ok = G.placeBuilding(this.ghost.action, this.ghost.x, this.ghost.z, this.ghost.rot, units.filter((u) => u.isWorker), shift);
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
    const tpl = G.world.template(st.gfx, true);
    const obj = cloneModel(tpl);
    const mat = new THREE.MeshBasicMaterial({ color: 0x60ff60, transparent: true, opacity: 0.45, depthWrite: false, fog: false });
    obj.traverse((o) => { if (o.isMesh) { o.material = mat; o.castShadow = false; o.receiveShadow = false; } });
    G.scene.add(obj);
    // wall pieces: one preview per tile of the line (wallTiles), coloured by state; the single ghost is hidden
    const wall = !!(def && def.wallKind === 'wall');
    this.ghost = { obj, mat, action, name, rot: 0, x: 0, z: 0, ok: false, wall, tpl, pool: [], active: false, held: [], tiles: [] };
    if (wall) obj.visible = false;
  }
  clearGhost() {
    if (!this.ghost) return;
    this.G.scene.remove(this.ghost.obj);
    for (const p of this.ghost.pool) this.G.scene.remove(p.obj);
    this.ghost = null;
  }
  // ---- wall lines (docs/spec/walls.md §3): hover = one tile under the cursor; press = start; drag = the line;
  // release = place (Shift: keep the line as a leg and go on from here; Ctrl: stay in build mode); right click = cancel
  wallPreview() {
    const gh = this.ghost, G = this.G;
    const g = this.groundPoint(this.mouse.x, this.mouse.y);
    if (!g) return;
    const s = gh.active ? gh.start : g;
    gh.tiles = G.world.wallLine(G.me, gh.action, s.x, s.z, g.x, g.z, gh.held);
    const COL = { ok: 0x60ff60, have: 0x9fd8ff, cost: 0xffe060, bad: 0xff4040 };
    const set = new Set(gh.tiles.map((t) => t.i + ',' + t.j));
    const has = (i, j) => set.has(i + ',' + j) || !!G.world.wallMap.joint(i, j, G.me);
    gh.tiles.forEach((t, k) => {
      let p = gh.pool[k];
      if (!p) {
        const obj = cloneModel(gh.tpl);
        const mats = {};
        obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
        G.scene.add(obj);
        p = gh.pool[k] = { obj, mats };
      }
      if (!p.mats[t.state]) p.mats[t.state] = new THREE.MeshBasicMaterial({ color: COL[t.state], transparent: true, opacity: t.state === 'have' ? 0.25 : 0.5, depthWrite: false, fog: false });
      const m = p.mats[t.state];
      p.obj.traverse((o) => { if (o.isMesh) o.material = m; });
      // arms towards the neighbours the piece will have (WallMap rules: no arm across an L corner)
      let mask = 0;
      for (let d = 0; d < 8; d++) {
        const [di, dj] = DIRS[d];
        if (!has(t.i + di, t.j + dj)) continue;
        if (d % 2 && (has(t.i + di, t.j) || has(t.i, t.j + dj))) continue;
        mask |= 1 << d;
      }
      p.obj.userData.armMask = mask;
      applyState(p.obj, 4, 0, G.me.epoch());
      p.obj.position.set(t.x, G.world.height(t.x, t.z), t.z);
      p.obj.visible = true;
    });
    for (let k = gh.tiles.length; k < gh.pool.length; k++) gh.pool[k].obj.visible = false;
  }
  wallRelease(shift, ctrl) {
    const gh = this.ghost, G = this.G;
    if (!gh || !gh.active) return;
    this.wallPreview();
    const last = gh.tiles[gh.tiles.length - 1];
    if (shift && last) { gh.held = gh.tiles.map((t) => ({ ...t })); gh.start = { x: last.x, z: last.z }; return; }   // a corner
    const builders = this.myUnits().filter((u) => u.canBuild);
    const n = G.placeWall(gh.action, gh.tiles, builders);
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
    const kind = (G.data.def(gh.name, G.me) || {}).wallKind;
    if (kind === 'tower' || kind === 'trap' || kind === 'gate') {
      const e = this.entityAt(this.mouse.x, this.mouse.y);
      const w = e && e.kind === 'building' && e.def && e.def.wallKind === 'wall' && e.owner === G.me ? e : null;
      if (w) { gh.x = w.pos.x; gh.z = w.pos.z; }
    }
    gh.obj.position.set(gh.x, G.world.height(gh.x, gh.z), gh.z);
    gh.obj.rotation.y = gh.rot;
    // coastal buildings (harbours) snap to the shore: show the ghost where it will really stand
    const at = G.world.placement(gh.name, gh.x, gh.z, gh.rot, G.me);
    if (at.x !== gh.x || at.z !== gh.z || at.rot !== gh.rot) {
      gh.x = at.x; gh.z = at.z; gh.rot = at.rot;
      gh.obj.position.set(gh.x, Math.max(G.world.height(gh.x, gh.z), G.world.waterLevel != null ? G.world.waterLevel + 1.5 : -1e9), gh.z);
      gh.obj.rotation.y = gh.rot;
    }
    gh.ok = at.ok && G.fow.explored_(gh.x, gh.z);
    gh.mat.color.setHex(gh.ok ? 0x60ff60 : 0xff4040);
  }

  // ------------------------------------------------------------------ keyboard
  onKey(e) {
    const G = this.G;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    this.keys[e.code] = true;
    if (G.mission && G.mission.key(e)) return;        // campaign: cutscene keys, L = quest log (ui/mission.js)
    if (G.menuOpen) { if (e.code === 'Escape' || e.code === 'F10') G.closeMenu(); return; }
    const units = this.myUnits();
    const digit = /^Digit(\d)$/.exec(e.code);
    if (digit) {
      const k = digit[1];
      if (e.ctrlKey) { this.groups[k] = [...G.sel].filter((x) => x.alive && x.owner === G.me); G.hud.message(`Group ${k} assigned`); e.preventDefault(); return; }
      const list = (this.groups[k] || []).filter((x) => x.alive);
      if (!list.length) return;
      const now = performance.now();
      if (this.lastGroupKey.k === k && now - this.lastGroupKey.t < 400) G.centerOn(list[0]);
      this.lastGroupKey = { k, t: now };
      if (e.shiftKey) for (const x of list) G.sel.add(x); else G.select(list);
      G.selChanged();
      return;
    }
    switch (e.code) {
      case 'Escape': if (this.mode) this.setMode(null); else if (G.hud.menu) G.hud.toggleMenu(G.hud.menu); else G.openMenu(); break;
      case 'F10': G.openMenu(); e.preventDefault(); break;
      case 'F9': G.togglePerf(); e.preventDefault(); break;
      case 'Pause': case 'KeyP': G.togglePause(); break;
      case 'Space': case 'Home': { const f = [...G.sel].find((x) => x.alive); if (f) G.centerOn(f); else G.centerOn(G.homeEntity()); e.preventDefault(); break; }
      case 'KeyA': if (units.length) this.setMode('amove'); break;
      case 'KeyM': if (units.length) this.setMode('move'); break;
      case 'KeyS': if (units.length) G.order(units, { type: 'stop' }); break;
      case 'KeyH': if (units.length) G.order(units, { type: 'hold' }); break;
      case 'KeyU': if (units.length === 1) G.levelUp(units[0]); break;
      case 'KeyR': if ([...G.sel].some((e) => G.canRally(e))) this.setMode('rally'); break;
      case 'KeyB': if (units.some((u) => u.isWorker)) G.hud.toggleMenu('build'); break;
      case 'Delete': G.killSelected(); break;
      case 'Period': case 'NumpadDecimal': G.selectIdleWorker(); break;
      case 'KeyQ': this.G.rtscam.yaw += Math.PI / 8; break;
      case 'KeyE': this.G.rtscam.yaw -= Math.PI / 8; break;
    }
  }

  // ------------------------------------------------------------------ minimap
  mmCoords(e, canvas) {
    const r = canvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) / r.width * canvas.width, my = (e.clientY - r.top) / r.height * canvas.height;
    return this.G.minimap.m2w(mx, my);
  }
  minimapDown(e, canvas) {
    const G = this.G;
    e.preventDefault(); e.stopPropagation();
    const [x, z] = this.mmCoords(e, canvas);
    if (e.button === 0) {
      if (this.mode && this.mode !== 'place') {
        const units = this.myUnits();
        if (this.mode === 'rally') { for (const b of G.sel) if (G.canRally(b)) b.rally = [x, z]; }
        else if (units.length) this.moveGroup(units, x, z, this.mode === 'move' ? 'move' : 'attackmove');
        this.setMode(null);
        return;
      }
      G.rtscam.x = x; G.rtscam.z = z; this.mmDrag = true;
      const up = () => { this.mmDrag = false; window.removeEventListener('mouseup', up, true); };
      window.addEventListener('mouseup', up, true);    // capture: the HUD stops mouseup from bubbling
    } else if (e.button === 2) {
      const units = this.myUnits();
      if (units.length) { this.moveGroup(units, x, z, 'move'); G.overlay.marker(x, z, 0x7dff6a); G.feedback.ordered('move', units); }
      else for (const b of G.sel) if (G.canRally(b)) b.rally = [x, z];
    }
  }
  minimapMove(e, canvas) {
    if (!this.mmDrag) return;
    const [x, z] = this.mmCoords(e, canvas);
    this.G.rtscam.x = x; this.G.rtscam.z = z;
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
    if (dx || dz) cam.pan(dx * sp, dz * sp);
    if (k.PageUp) cam.tDist = Math.max(cam.min, cam.tDist - 60 * dt);
    if (k.PageDown) cam.tDist = Math.min(cam.max, cam.tDist + 60 * dt);
    this.hoverT -= dt;
    if (this.hoverT <= 0 && !m.dragging) {
      this.hoverT = 0.07;
      const overHud = document.elementFromPoint(m.x, m.y) !== G.canvas && document.elementFromPoint(m.x, m.y) !== G.overlay.canvas;
      this.hover = overHud ? null : this.entityAt(m.x, m.y);
      // the original mouse cursors (UI/cursor): what a right click would do here
      let cur = 'standard';
      const units = this.myUnits();
      if (this.mode) cur = { move: 'walk', rally: 'walk', amove: 'walk_aggro', attack: 'attack', place: 'build', lay: 'build', repair: 'build', target: 'special' }[this.mode] || 'standard';
      else if (this.hover && units.length) {
        const h = this.hover, W = G.world;
        if (h.kind !== 'res' && units[0].isEnemy(h)) cur = 'attack';
        else if (h.kind === 'res' && units.some((u) => u.isWorker)) cur = 'harvest_' + (h.res === 'food' ? 'food' : h.res);
        else if (h.kind === 'building' && h.owner === G.me && !h.built && units.some((u) => u.canBuild)) cur = 'build';
        else if (h.kind === 'building' && h.owner === G.me && W.isFarm(h) && units.some((u) => u.isWorker)) cur = 'harvest_food';
        else if (h.owner === G.me && W.capacity(h) > 0 && units.some((u) => W.canBoard(u, h))) cur = 'load';
        else if (W.isTradeBuilding(h) && units.some((u) => /_cart$|trade_dino/.test(u.name))) cur = 'trade';
        else cur = 'walk';
      } else if (units.length) cur = 'walk';
      else if (G.world.hostileTo(G.me, this.hover) && [...G.sel].some((e) => e.alive && e.owner === G.me && G.world.canAimTower(e))) cur = 'attack';
      if (m.x <= 4) cur = 'sm_left'; else if (m.x >= window.innerWidth - 5) cur = 'sm_right';
      if (m.y <= 4) cur = cur.startsWith('sm_') ? cur.replace('sm_', 'sm_up_') : 'sm_up'; else if (m.y >= window.innerHeight - 5) cur = cur.startsWith('sm_') ? cur.replace('sm_', 'sm_down_') : 'sm_down';
      if (!G.settings.edgeScroll && cur.startsWith('sm_')) cur = 'standard';
      if (document.body.dataset.cursor !== cur) document.body.dataset.cursor = cur;
    }
    if (this.mode === 'place') this.updateGhost();
  }
}
