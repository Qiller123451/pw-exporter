// The city in districts ("zones") that open one after the other.
//
// CFG.zones.list     the zones in the order they open: {id, name, seed: [x, z]}
// CFG.zones.cuts     lines across the streets where one zone ends: [x1, z1, x2, z2] (+ 'P' = never opens: the edge
//                    of the playing field)
//
// build(): every cell of the nav grid gets the zone it belongs to - flooded from the zones' seed points over the
// streets, stopping at the cut lines; the cells of a cut line belong to the later zone (so the wall stands on the
// near side), everything that is not street (roofs, water) to the nearest street's zone. 255 = never.
//
// What keeps the player in:
//   * allowedAt(x, z)   the player's position must stay in a cell of an open zone - at any height, so a jetpack
//                       jump ends at the border too (player.js asks every step)
//   * the wall          a faint energy wall is drawn along the border where a street crosses it; it lights up near
//                       the player and where it is touched
//   * rubble            where a cut crosses a street the map's own barricades stand (level.js hands those over
//                       instead of making them part of the static city) and more are heaped up to fill the gap.
//                       They are solid for the player (collide()). When both sides of a gap are open the rubble is
//                       blown away (setOpen()).
// The Dustriders are not held back: they come over the barricades (enemies.js lets them leap where closedAt()).
import * as THREE from 'three';
import { CFG } from './config.js';

const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const NEVER = 255;

export class Zones {
  constructor(game) {
    this.g = game;
    this.list = CFG.zones.list;
    this.cuts = CFG.zones.cuts.map((c) => ({ x1: c[0], z1: c[1], x2: c[2], z2: c[3], perm: c[4] === 'P', door: c[4] === 'D' }));
    this.open = 0;                       // zones 0 .. open are open
    this.gates = [];                     // gaps in the cuts: {cut, a, b (zones), x, z, props: [{obj, x, y, z, r, top}], closed}
    this.wall = null;
    this.touchT = 0; this.touchP = new THREE.Vector3();
    this.noteT = 0;
  }
  index(id) { const i = this.list.findIndex((z) => z.id === id); return i < 0 ? 0 : i; }

  // ---------------------------------------------------------------- the zone map
  build() {
    const nav = this.g.nav, n = nav.n, N = n * n, Y = nav.y, L = nav.links, cell = nav.cell, half = nav.half;
    const zone = this.zone = new Uint8Array(N).fill(254);          // 254 = not known yet
    const cutOf = this.cutOf = new Int16Array(N).fill(-1);
    // cells on the cut lines
    const thick = 1.6;
    this.cuts.forEach((c, k) => {
      const dx = c.x2 - c.x1, dz = c.z2 - c.z1, l2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(c.x1, c.x2) - 4 + half) / cell)), i1 = Math.min(n - 1, Math.floor((Math.max(c.x1, c.x2) + 4 + half) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(c.z1, c.z2) - 4 + half) / cell)), j1 = Math.min(n - 1, Math.floor((Math.max(c.z1, c.z2) + 4 + half) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * cell - half, z = (j + 0.5) * cell - half;
        const t = Math.max(0, Math.min(1, ((x - c.x1) * dx + (z - c.z1) * dz) / l2));
        if ((x - c.x1 - dx * t) ** 2 + (z - c.z1 - dz * t) ** 2 <= thick * thick) cutOf[j * n + i] = k;
      }
    });
    // flood the streets from every zone's seed
    const queue = new Int32Array(N);
    this.report = { zones: [], leaks: [] };
    this.list.forEach((z, zi) => {
      let s = nav.nearest(z.seed[0], z.seed[1], null, 8);
      if (s >= 0 && cutOf[s] >= 0) s = -1;
      if (s < 0) { this.report.leaks.push(`zone ${z.id}: no street at its seed`); this.report.zones.push(0); return; }
      if (zone[s] !== 254) { this.report.leaks.push(`zone ${z.id} is not separated from ${this.list[zone[s]].id}`); this.report.zones.push(0); return; }
      let qh = 0, qt = 0;
      queue[qt++] = s; zone[s] = zi;
      while (qh < qt) {
        const c = queue[qh++];
        for (let d = 0; d < 4; d++) {
          const i = c % n + DX[d], j = Math.floor(c / n) + DZ[d];
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const e = j * n + i;
          if (Y[e] !== Y[e] || zone[e] !== 254 || cutOf[e] >= 0) continue;
          if ((L[c] >> d) & 1 || (L[e] >> ((d + 2) & 3)) & 1) { zone[e] = zi; queue[qt++] = e; }
        }
      }
      this.report.zones.push(qt);
    });
    // cut cells: the later of the zones next to them; the edge of the field never opens
    const cutCells = [];
    for (let c = 0; c < N; c++) if (cutOf[c] >= 0) cutCells.push(c);
    const lab = new Uint8Array(cutCells.length);
    cutCells.forEach((c, k) => {
      if (this.cuts[cutOf[c]].perm) { lab[k] = NEVER; return; }
      const i0 = c % n, j0 = Math.floor(c / n);
      let m = -1;
      for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const e = j * n + i;
        if (cutOf[e] < 0 && zone[e] < 254 && zone[e] > m) m = zone[e];
      }
      lab[k] = m < 0 ? 254 : m;
    });
    cutCells.forEach((c, k) => { zone[c] = lab[k]; });
    // everything else: the zone of the nearest labelled cell
    let qh = 0, qt = 0;
    for (let c = 0; c < N; c++) if (zone[c] !== 254) queue[qt++] = c;
    while (qh < qt) {
      const c = queue[qh++];
      for (let d = 0; d < 4; d++) {
        const i = c % n + DX[d], j = Math.floor(c / n) + DZ[d];
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const e = j * n + i;
        if (zone[e] === 254) { zone[e] = zone[c]; queue[qt++] = e; }
      }
    }
    this._gates();
    this._wall();
    return this.report;
  }
  zoneAt(x, z) { const c = this.g.nav.index(x, z); return c < 0 ? NEVER : this.zone[c]; }
  allowedAt(x, z) { return this.zoneAt(x, z) <= this.open; }
  // a cell of a cut that is still shut (the Dustriders leap over these)
  closedAt(c) { return c >= 0 && this.cutOf[c] >= 0 && this.zone[c] > this.open; }

  // ---------------------------------------------------------------- rubble in the gaps
  _prop(model, x, y, z, rot, q = null) {
    const k = this.g.level.props.kinds.get(model);
    if (!k) return null;
    const quat = q ? new THREE.Quaternion(-q[0], -q[2], q[1], q[3]).normalize() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const obj = new THREE.Group();
    obj.position.set(x, y, z); obj.quaternion.copy(quat);
    for (const p of k.parts) {
      const m = new THREE.Mesh(p.geo, p.mat);
      m.matrixAutoUpdate = false; m.matrix.copy(p.matrix);
      m.castShadow = true; m.receiveShadow = true;
      obj.add(m);
    }
    this.g.scene.add(obj);
    const r = k.sphere.radius;
    return { obj, x, y, z, r: Math.min(5.5, Math.max(2.2, r * 0.55)), top: y + Math.min(9, r * 1.1), model };
  }
  _gates() {
    const G = this.g, nav = G.nav, n = nav.n, zone = this.zone, cutOf = this.cutOf, Y = nav.y;
    const models = CFG.zones.rubble.filter((m) => G.level.props.kinds.has(m));
    const own = G.level.gateProps || [];
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    this.cuts.forEach((c, k) => {
      if (c.perm) return;
      const dx = c.x2 - c.x1, dz = c.z2 - c.z1, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
      // where the cut crosses a street: runs of street cells along the line
      const ts = [];
      for (let cc = 0; cc < zone.length; cc++) if (cutOf[cc] === k && Y[cc] === Y[cc]) ts.push([(nav.cx(cc) - c.x1) * ux + (nav.cz(cc) - c.z1) * uz, cc]);
      ts.sort((a, b) => a[0] - b[0]);
      const runs = [];
      for (const [t, cc] of ts) { const r = runs[runs.length - 1]; if (r && t - r.t1 <= 4.5) { r.t1 = t; r.cells.push(cc); } else runs.push({ t0: t, t1: t, cells: [cc] }); }
      for (const r of runs) {
        // the zones on the two sides of the gap
        const tm = (r.t0 + r.t1) / 2, mx = c.x1 + ux * tm, mz = c.z1 + uz * tm;
        // (the zone most of the street cells a few steps to that side belong to)
        const side = (s) => {
          const votes = new Map();
          const w = Math.max(0, (r.t1 - r.t0) / 2 - 2);
          for (const d of [4, 6, 8, 10]) for (const tt of [tm, tm - w * 0.6, tm + w * 0.6]) {
            const cc = nav.index(c.x1 + ux * tt - uz * d * s, c.z1 + uz * tt + ux * d * s);
            if (cc >= 0 && cutOf[cc] < 0 && Y[cc] === Y[cc]) votes.set(zone[cc], (votes.get(zone[cc]) || 0) + 1);
          }
          let best = NEVER, bn = 0;
          for (const [z, v] of votes) if (v > bn) { bn = v; best = z; }
          return best;
        };
        const a = side(1), b = side(-1);
        if (a === b || a === NEVER || b === NEVER) continue;     // not a border between two districts (the end of a line, a dead corner)
        const g = { cut: k, a, b, need: Math.max(a, b), x: mx, z: mz, y: Y[r.cells[r.cells.length >> 1]], props: [], closed: true, width: r.t1 - r.t0 + 2, door: c.door, cells: r.cells };
        // a door: nobody passes while it is shut - the Dustriders' paths do not lead through it either
        if (c.door) {
          const mask = nav.mask || (nav.mask = new Uint8Array(zone.length));
          if (G.navBig) G.navBig.mask = mask;
          for (const cc of r.cells) mask[cc] = 1;
        }
        // heap rubble along the gap (not where the map already has a barricade)
        // (only in streets: a border across open country is just the wall)
        if (models.length && !c.door && r.t1 - r.t0 <= (CFG.zones.rubbleMax || 60)) {
          for (let t = r.t0 - 1; t <= r.t1 + 1.01; t += 5.2) {
            const x = c.x1 + ux * t + (rnd() - 0.5) * 1.2, z = c.z1 + uz * t + (rnd() - 0.5) * 1.2;
            if (own.some((o) => o.cut === k && Math.hypot(o.x - x, o.z - z) < 5.5)) continue;
            const cc = nav.nearest(x, z, null, 2);
            if (cc < 0) continue;
            const p = this._prop(models[Math.floor(rnd() * models.length)], x, Y[cc], z, Math.atan2(ux, uz) + (rnd() - 0.5) * 0.9 + (rnd() < 0.5 ? Math.PI : 0));
            if (p) g.props.push(p);
          }
        }
        this.gates.push(g);
      }
      // the map's own barricades near this cut go to the nearest gap
      for (const o of own) {
        if (o.cut !== k) continue;
        let best = null, bd = 1e9;
        for (const g of this.gates) { if (g.cut !== k) continue; const d = Math.hypot(g.x - o.x, g.z - o.z); if (d < bd) { bd = d; best = g; } }
        const p = this._prop(o.model, o.x, o.y, o.z, o.rot, o.q);
        if (p && best) best.props.push(p); else if (p && !best) { /* a cut without any street: leave it standing */ }
      }
    });
  }
  // the player against the rubble of shut gaps: pushes p (x, z) out of the heaps; true when it touched one
  collide(p, r) {
    let hit = false;
    for (const g of this.gates) {
      if (!g.closed) continue;
      if (Math.abs(g.x - p.x) > g.width + 14 || Math.abs(g.z - p.z) > g.width + 14) continue;
      for (const o of g.props) {
        if (p.y > o.top) continue;
        const dx = p.x - o.x, dz = p.z - o.z, rr = o.r + r, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        p.x += dx / d * (rr - d); p.z += dz / d * (rr - d);
        hit = true;
      }
    }
    return hit;
  }

  // ---------------------------------------------------------------- opening
  // open all zones up to index k; fx: blow the rubble away with a bang
  setOpen(k, fx = true) {
    const G = this.g;
    if (k <= this.open) return 0;
    this.open = k;
    let n = 0;
    for (const g of this.gates) {
      if (!g.closed || g.need > this.open) continue;
      g.closed = false; n++;
      if (g.door) {
        // the doors are blown out of the gate
        const nav = G.nav, D = G.level.doorGate;
        for (const cc of g.cells) nav.mask[cc] = 0;
        if (D && D.doors.some((m) => m.visible)) {
          for (const m of D.doors) m.visible = false;
          if (fx) {
            const p = new THREE.Vector3(g.x, g.y + 5, g.z);
            G.fx.explosion(p, 12); G.fx.dust(p, 9, 16); G.sfx('explode', 100, p, 0.7);
            for (let k2 = 0; k2 < 5; k2++) G.fx.sparks(new THREE.Vector3(g.x + (k2 - 2) * 2, g.y + 2 + k2, g.z), 12, 22, [1, 0.7, 0.3, 1]);
          }
        }
      }
      for (const o of g.props) {
        o.obj.removeFromParent();
        if (fx) {
          const p = new THREE.Vector3(o.x, o.y + 1.5, o.z);
          G.fx.explosion(p, 7);
          G.fx.dust(p, 6, 10);
          for (const e of G.enemies.inRadius(p, 9)) e.damage(160, { kind: 'explosion', from: p, knock: 22 });
        }
      }
      if (fx && g.props.length) G.sfx('explode', 95, new THREE.Vector3(g.x, g.y, g.z), 0.8 + Math.random() * 0.2);
      g.props.length = 0;
    }
    if (fx && n) G.fx.shake(0.5);
    this._wall();
    return n;
  }

  // ---------------------------------------------------------------- the wall
  _wall() {
    const G = this.g, nav = G.nav, n = nav.n, zone = this.zone, Y = nav.y, cell = nav.cell;
    const pos = [], uv = [];
    const H = CFG.zones.wallHeight;
    const quad = (x1, z1, x2, z2, y) => {
      const y0 = y - 1.5, y1 = y + H;
      pos.push(x1, y0, z1, x2, y0, z2, x2, y1, z2, x1, y0, z1, x2, y1, z2, x1, y1, z1);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    };
    for (let c = 0; c < zone.length; c++) {
      if (zone[c] > this.open || Y[c] !== Y[c]) continue;                 // an open street cell ...
      const i = c % n, j = (c - i) / n, x = nav.cx(c), z = nav.cz(c), h = cell / 2;
      for (let d = 0; d < 4; d++) {
        const ei = i + DX[d], ej = j + DZ[d];
        if (ei < 0 || ej < 0 || ei >= n || ej >= n) continue;
        if (zone[ej * n + ei] <= this.open) continue;                       // ... next to a shut cell
        const ex = x + DX[d] * h, ez = z + DZ[d] * h;
        quad(ex - DZ[d] * h, ez + DX[d] * h, ex + DZ[d] * h, ez - DX[d] * h, Y[c]);
      }
    }
    if (this.wall) { this.wall.geometry.dispose(); this.wall.removeFromParent(); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (!this.mat) {
      this.mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uPlayer: { value: new THREE.Vector3() }, uTouch: { value: new THREE.Vector4(0, 0, 0, 0) }, uTime: { value: 0 }, uColor: { value: new THREE.Color(CFG.zones.wallColor) }, uNear: { value: CFG.zones.wallNear } },
        vertexShader: 'varying vec3 vW; varying vec2 vUv; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `
          uniform vec3 uPlayer; uniform vec4 uTouch; uniform float uTime; uniform vec3 uColor; uniform float uNear;
          varying vec3 vW; varying vec2 vUv;
          void main() {
            float d = distance(vW.xz, uPlayer.xz);
            float near = 1.0 - smoothstep(uNear * 0.25, uNear, d);                       // only close to the player
            // a lattice that drifts upwards, fading with height
            vec2 g = vec2(vW.x + vW.z, vW.y) * 0.5;
            float lines = max(smoothstep(0.42, 0.5, abs(fract(g.x) - 0.5)), smoothstep(0.42, 0.5, abs(fract(g.y - uTime * 0.25) - 0.5)));
            float fade = 1.0 - smoothstep(0.15, 1.0, vUv.y);
            float a = near * (0.10 + 0.5 * lines) * fade;
            // where it was touched: a bright ring spreading from the place
            float t = uTouch.w;
            if (t > 0.0) { float r = distance(vW, uTouch.xyz); a += (1.0 - smoothstep(0.0, 1.5, abs(r - (1.0 - t) * 14.0))) * t * 0.7 * fade; }
            if (a < 0.004) discard;
            gl_FragColor = vec4(uColor, min(a, 0.85));
          }`,
      });
    }
    this.wall = new THREE.Mesh(geo, this.mat);
    this.wall.frustumCulled = false; this.wall.renderOrder = 20;
    G.scene.add(this.wall);
    this.wallQuads = pos.length / 18;
  }
  // the player ran into the border
  touch(p) {
    this.touchP.set(p.x, p.y + 3, p.z); this.touchT = 1;
    if (this.noteT <= 0) { this.noteT = 4; this.g.hud.note(CFG.zones.note || 'This part of the city is still held - finish the objective first'); this.g.sfx('error', 35, null); }
  }
  update(dt, time) {
    if (!this.mat) return;
    const u = this.mat.uniforms, P = this.g.player;
    u.uPlayer.value.copy(P.pos); u.uTime.value = time;
    this.touchT = Math.max(0, this.touchT - dt * 1.6); this.noteT -= dt;
    u.uTouch.value.set(this.touchP.x, this.touchP.y, this.touchP.z, this.touchT);
  }
}
