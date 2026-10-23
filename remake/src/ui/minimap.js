// The minimap, drawn the way the original's engine draws it (docs/MINIMAP.md; CMiniMap in PWClient.exe, set up by
// Game/UI/MiniMap2.usl and IngameScreen.usl).
//
// * Area: the playable rectangle only - an original map minus its 128 m border - in 4 m cells, scaled into the 164
//   texel square (46..210) of a 256 x 256 texture that the 230 px control shows; the longer side fills it.
// * Orientation: a diamond. The texture is turned so that the level's default camera direction, snapped to the nearest
//   diagonal, points up; with the option "Rotate Minimap" it follows the camera. The background picture
//   hud/minimap_rotmap.tga (gold ring, frame, dark grid) turns with it.
// * Ground: not the painted textures but the setting's colour table Texture/Scape/<Setting>/minimap_colors.tga: one
//   of five relief shades by the slope to the south-east, shallow water within 0.5 m below the water level, deep water,
//   forest on top. Fog of war: unexplored cells are left out (the dark grid shows), explored ones are drawn half
//   transparent (table row 3), visible ones solid (row 0).
// * Dots: square texels of fixed size, turned with the map - resources (half transparent white, stones bigger),
//   buildings (the owner's colour lightened), units (the owner's colour); objects without an owner (wild animals) are
//   not drawn. "Use Player Colors" off: own green, allies blue, everyone else red. Buildings seen once and now in the
//   fog stay as dimmed dots.
// * The camera's ground footprint in white lines; markers ("pings") as pulsing squares: attacks (red, 3.2 s at
//   1.3 Hz), finished production or research (blue), the player's own map pings.
// * Buttons on the frame (MiniMap2.usl): landscape and resources (+ forest) on / off, map ping, zoom 1 .. 7.
import { spriteCss, UIA } from './atlas.js';

const TEX = 256, MAP0 = 46, MAPN = 164;      // the render texture, the map square inside it
const CELL = 4;                              // m per cell
const BORDER = 128;                          // m cut off an original map on every side
// (the user found units and buildings hard to see at the engine's sizes: units 3 texels and buildings at least 4 or
// their footprint, both with a dark rim)
const SIZE = { unit: 3, building: 4, resource: 3, stone: 5, marker: 18 };   // texels (the engine's 1, 1.2, 1.5, 2.5)
// marker types (MiniMap2.usl:238-262): colour, size (100 = full), seconds alive, pulses per second
export const MARKERS = {
  Attack: [[255, 0, 0], 80, 3.2, 1.3], Finished: [[100, 100, 255], 100, 1.2, 0.7], AIHelp: [[255, 255, 255], 100, 1.2, 0.7],
  Ping: [[255, 255, 255], 100, 3.2, 0.7],
};

// the relief shade of each cell (columns 0..4 of the colour table; 10 shallow, 11 deep water): s = ((h north - h
// south) + (h west - h east)) / 2 over the neighbouring cells; the light comes from the north-west
export function reliefCells(gw, gh, hAt, water) {
  const h = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) h[j * gw + i] = hAt(i, j);
  const col = new Uint8Array(gw * gh);
  const H = (i, j) => h[Math.max(0, Math.min(gh - 1, j)) * gw + Math.max(0, Math.min(gw - 1, i))];
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const v = h[j * gw + i];
    if (water != null && v <= water) { col[j * gw + i] = v <= water - 0.5 ? 11 : 10; continue; }
    const s = ((H(i, j - 1) - H(i, j + 1)) + (H(i - 1, j) - H(i + 1, j))) / 2;
    col[j * gw + i] = s < -3 ? 0 : s < -0.1 ? 1 : s > 3 ? 4 : s > 0.1 ? 3 : 2;
  }
  return col;
}

// the cells as RGBA: state(k) 0 unexplored (transparent), 1 explored (row 3), 2 visible (row 0); forest (column 12)
// over the ground
export function paintCells(data, col, forest, table, state, scape = true, woods = true) {
  for (let k = 0; k < col.length; k++) {
    const st = state(k), o = k * 4;
    if (!st) { data[o + 3] = 0; continue; }
    const row = table[st === 2 ? 0 : 3];
    let r = 0, g = 0, b = 0, a = 0;
    if (scape) { const c = row[col[k]]; r = c[0]; g = c[1]; b = c[2]; a = c[3] / 255; }
    if (woods && forest && forest[k]) {
      const f = row[12], fa = f[3] / 255, oa = fa + a * (1 - fa), ga = a * (1 - fa);      // forest over the ground
      r = (f[0] * fa + r * ga) / oa; g = (f[1] * fa + g * ga) / oa; b = (f[2] * fa + b * ga) / oa; a = oa;
    }
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = Math.round(a * 255);
  }
}

// fixed orientation: the angle snapped to the nearest odd multiple of 45 degrees (the engine's quadrant table)
export const snapDiamond = (a) => Math.PI / 4 + Math.round((a - Math.PI / 4) / (Math.PI / 2)) * Math.PI / 2;
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
// the fill styles of the dots, made once per colour and opacity (drawn 30 times a second: a string per dot was garbage)
const STYLES = new Map();
const styleOf = (r, g, b, a) => {
  const k = (((r | 0) << 16) | ((g | 0) << 8) | (b | 0)) * 128 + Math.round(a * 100);
  let st = STYLES.get(k);
  if (st === undefined) { st = `rgba(${r | 0},${g | 0},${b | 0},${Math.round(a * 100) / 100})`; STYLES.set(k, st); }
  return st;
};
const LIGHT = 255 * 106 / 256, DARK = 150 / 256;

export class Minimap {
  // canvas: the 256 x 256 control; S: the map source (rect, water, setting); table: the setting's colour table
  constructor(G, canvas, S, table) {
    this.G = G; this.canvas = canvas; this.S = S;
    canvas.width = canvas.height = TEX;
    this.ctx = canvas.getContext('2d');
    // the playable rectangle in 4 m cells
    const o = S.origin;
    const R = o ? { x0: -o[0] + BORDER, x1: o[0] - BORDER, z0: -o[1] + BORDER, z1: o[1] - BORDER } : S.play;
    this.rect = R;
    this.gw = Math.max(1, Math.round((R.x1 - R.x0) / CELL)); this.gh = Math.max(1, Math.round((R.z1 - R.z0) / CELL));
    this.k = MAPN / Math.max(R.x1 - R.x0, R.z1 - R.z0);                  // texels per metre at zoom 1
    this.cx = (R.x0 + R.x1) / 2; this.cz = (R.z0 + R.z1) / 2;
    this.table = table || null;
    this.cells = document.createElement('canvas'); this.cells.width = this.gw; this.cells.height = this.gh;
    this.img = this.cells.getContext('2d').createImageData(this.gw, this.gh);
    this.rotmap = new Image(); this.rotmap.src = UIA.base + 'hud_minimap_rotmap.png';
    this.zoom = 1;
    this.layers = { scape: true, resources: true };
    this.markers = [];
    this.phi = snapDiamond(G.rtscam.yaw);       // the level's default camera, snapped to a diagonal
    this.fowSeen = -1; this.forestSeen = -1; this.t = 0;
  }
  // per cell: relief shade and forest (buildBackground keeps the old name: main.js)
  buildBackground(height, water) {
    const R = this.rect;
    this.col = reliefCells(this.gw, this.gh, (i, j) => height(R.x0 + (i + 0.5) * CELL, R.z0 + (j + 0.5) * CELL), water);
    this.dirty = true;
  }
  // forest cells: those with a standing tree within 4 m of their centre (the engine's forest layer: a 4 m query of the
  // forest blocks and the trees)
  buildForest() {
    const R = this.rect, gw = this.gw, gh = this.gh, f = this.forest || (this.forest = new Uint8Array(gw * gh));
    f.fill(0);
    for (const r of this.G.world.resources) {
      if (!r.alive || r.type !== 'tree') continue;
      const fx = (r.pos.x - R.x0) / CELL - 0.5, fz = (r.pos.z - R.z0) / CELL - 0.5;
      for (let j = Math.ceil(fz - 1); j <= Math.floor(fz + 1); j++) for (let i = Math.ceil(fx - 1); i <= Math.floor(fx + 1); i++) {
        if (i >= 0 && j >= 0 && i < gw && j < gh && (i - fx) ** 2 + (j - fz) ** 2 <= 1) f[j * gw + i] = 1;
      }
    }
  }
  // ---------------------------------------------------------------- mapping
  get angle() { return this.G.settings.minimapRotate ? this.G.rtscam.yaw : this.phi; }
  // the point the zoomed map centres on: the camera's, kept so that the map still fills the square
  focus() {
    const Z = this.zoom, R = this.rect;
    if (Z <= 1) return [this.cx, this.cz];
    const e = MAPN / 2 / (this.k * Z), c = this.G.rtscam;
    const cl = (v, a, b) => (a > b ? (a + b) / 2 : Math.max(a, Math.min(b, v)));
    return [cl(c.x, R.x0 + e, R.x1 - e), cl(c.z, R.z0 + e, R.z1 - e)];
  }
  // world -> texture texel (before the turn)
  w2t(x, z, F = this.focus()) { const s = this.k * this.zoom; return [TEX / 2 + (x - F[0]) * s, TEX / 2 + (z - F[1]) * s]; }
  // world -> control pixel (after the turn): for the markers drawn by the campaign and the sequel
  w2m(x, z) {
    const [tx, ty] = this.w2t(x, z), a = this.angle, c = Math.cos(a), s = Math.sin(a), dx = tx - TEX / 2, dy = ty - TEX / 2;
    return [TEX / 2 + dx * c - dy * s, TEX / 2 + dx * s + dy * c];
  }
  m2w(mx, my) {
    const a = -this.angle, c = Math.cos(a), s = Math.sin(a), dx = mx - TEX / 2, dy = my - TEX / 2;
    const tx = dx * c - dy * s, ty = dx * s + dy * c, F = this.focus(), k = this.k * this.zoom, P = this.S.play || this.rect;
    return [Math.max(P.x0, Math.min(P.x1, F[0] + tx / k)), Math.max(P.z0, Math.min(P.z1, F[1] + ty / k))];
  }
  // ---------------------------------------------------------------- markers
  // a pulsing marker (MiniMap2.usl NewMarker / NewMarkerReuse: the Attack and Finished markers are reused)
  marker(type, x, z, color) {
    const M = MARKERS[type] || MARKERS.Ping, t = this.G.world.time;
    if (type === 'Attack' || type === 'Finished') this.markers = this.markers.filter((m) => m.type !== type);
    this.markers.push({ type, x, z, t, color: color || M[0], size: M[1], life: M[2], freq: M[3] });
  }
  // ---------------------------------------------------------------- drawing
  paint() {
    const G = this.G, f = G.fow, n = f.n, half = f.size / 2, R = this.rect;
    const st = new Uint8Array(this.gw * this.gh);
    if (f.revealAll) st.fill(2);
    else for (let j = 0; j < this.gh; j++) {
      const fj = Math.floor((R.z0 + (j + 0.5) * CELL + half) / f.cell);
      for (let i = 0; i < this.gw; i++) {
        const fi = Math.floor((R.x0 + (i + 0.5) * CELL + half) / f.cell);
        const q = fi >= 0 && fj >= 0 && fi < n && fj < n ? fj * n + fi : -1;
        st[j * this.gw + i] = q < 0 ? 0 : f.vis[q] ? 2 : f.explored[q] ? 1 : 0;
      }
    }
    paintCells(this.img.data, this.col, this.forest, this.table, (k) => st[k], this.layers.scape, this.layers.resources);
    this.cells.getContext('2d').putImageData(this.img, 0, 0);
  }
  update(dt, force) {
    this.t -= dt;
    if (this.t > 0 && !force) return;
    this.t = 1 / 30;
    const G = this.G, W = G.world, ctx = this.ctx, f = G.fow;
    if (!this.table || !this.col) return;
    if (this.forestSeen !== (W.forestVersion || 0) || !this.forest) { this.forestSeen = W.forestVersion || 0; this.buildForest(); this.dirty = true; }
    if (this.fowSeen !== f.version || this.dirty) { this.fowSeen = f.version; this.dirty = false; this.paint(); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, TEX, TEX);
    ctx.save();
    ctx.translate(TEX / 2, TEX / 2); ctx.rotate(this.angle); ctx.translate(-TEX / 2, -TEX / 2);
    if (this.rotmap.complete) ctx.drawImage(this.rotmap, 0, 0, TEX, TEX);
    ctx.beginPath(); ctx.rect(MAP0, MAP0, MAPN, MAPN); ctx.clip();
    const F = this.focus(), R = this.rect;
    const [ax, ay] = this.w2t(R.x0, R.z0, F), [bx, by] = this.w2t(R.x1, R.z1, F);
    ctx.imageSmoothingEnabled = this.zoom > 1;
    ctx.drawImage(this.cells, ax, ay, bx - ax, by - ay);
    this.drawDots(ctx, F);
    this.drawCamera(ctx, F);
    this.drawMarkers(ctx, F);
    ctx.restore();
    // campaign: the quest / hint markers of the mission (ui/mission.js), the sequel's
    if (G.mission && G.mission.drawMinimap) G.mission.drawMinimap(ctx, this);
    if (G.sequelUI) G.sequelUI.drawMinimap(ctx, this);
  }
  // the colour of an owner's objects: its minimap colour (the table's player colours by colour slot) or by relation
  ownerColor(p, row, e) {
    const G = this.G, T = this.table[row];
    if (G.settings.minimapPlayerColors === false) {
      if (p === G.me) return T[G.sel.has(e) ? 0 : 1];
      return T[G.me.isFriend && G.me.isFriend(p) && p.isFriend(G.me) ? 2 : 3];
    }
    if (p.colorSlot != null && p.colorSlot >= 0 && T[12 + p.colorSlot]) return T[12 + p.colorSlot];
    return [(p.color >> 16) & 255, (p.color >> 8) & 255, p.color & 255];
  }
  drawDots(ctx, F) {
    const G = this.G, W = G.world, f = G.fow;
    // (rims first, under every dot: a neighbour's rim never darkens a dot. The lists are kept between frames:
    // x, y, size, style in a row)
    const rims = this._rims || (this._rims = []), fills = this._fills || (this._fills = []);
    let nr = 0, nf = 0;
    const s0 = this.k * this.zoom, ox = TEX / 2 - F[0] * s0, oz = TEX / 2 - F[1] * s0;
    const dot = (x, z, size, c, a, rim, light) => {
      const tx = ox + x * s0, ty = oz + z * s0;
      const x0 = Math.round(tx - size / 2), y0 = Math.round(ty - size / 2), n = Math.round(size);
      if (rim) { rims[nr++] = x0 - 1; rims[nr++] = y0 - 1; rims[nr++] = n + 2; rims[nr++] = styleOf(0, 0, 0, 0.75 * a); }
      fills[nf++] = x0; fills[nf++] = y0; fills[nf++] = n;
      fills[nf++] = light ? styleOf(c[0] * DARK + LIGHT, c[1] * DARK + LIGHT, c[2] * DARK + LIGHT, a) : styleOf(c[0], c[1], c[2], a);
    };
    const [ax, ay] = this.w2t(0, 0, F), [bx, by] = this.w2t(10, 0, F), tpm = Math.hypot(bx - ax, by - ay) / 10;   // texels per metre
    const seen = (x, z) => (f.visible(x, z) ? 2 : f.explored_(x, z) ? 1 : 0);
    if (this.layers.resources) {
      const T = this.table;
      for (const r of W.resources) {
        if (!r.alive || r.type === 'tree' || r.amount <= 0) continue;
        const s = seen(r.pos.x, r.pos.z);
        if (!s) continue;
        const c = T[s === 2 ? 0 : 3][13];
        dot(r.pos.x, r.pos.z, r.type === 'stone' ? SIZE.stone : SIZE.resource, c, c[3] / 255);
      }
      for (const n of W.wildNests || []) {
        const s = seen(n.x, n.z);
        if (s) { const c = T[s === 2 ? 0 : 3][13]; dot(n.x, n.z, SIZE.resource, c, c[3] / 255); }
      }
    }
    for (const b of W.buildings) {
      if (!b.alive || b.parked || !b.owner) continue;
      const own = G.sees(b.owner), s = own ? 2 : seen(b.pos.x, b.pos.z);
      if (!s) continue;
      dot(b.pos.x, b.pos.z, Math.max(SIZE.building, Math.min(12, (b.radius || 0) * 1.4 * tpm)), this.ownerColor(b.owner, s === 2 ? 1 : 4, b), s === 2 ? 1 : 0.5, true, true);
    }
    for (const u of W.units) {
      if (!u.alive || u.parked || u.inside || !u.owner) continue;
      if (!G.sees(u.owner) && !f.visible(u.pos.x, u.pos.z)) continue;
      dot(u.pos.x, u.pos.z, SIZE.unit, this.ownerColor(u.owner, 2, u), 1, true);
    }
    for (let i = 0; i < nr; i += 4) { ctx.fillStyle = rims[i + 3]; ctx.fillRect(rims[i], rims[i + 1], rims[i + 2], rims[i + 2]); }
    for (let i = 0; i < nf; i += 4) { ctx.fillStyle = fills[i + 3]; ctx.fillRect(fills[i], fills[i + 1], fills[i + 2], fills[i + 2]); }
  }
  // the camera's ground footprint (white lines)
  drawCamera(ctx, F) {
    const corners = this.G.input.viewCorners();
    if (!corners) return;
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.beginPath();
    corners.forEach(([wx, wz], i) => { const [x, y] = this.w2t(wx, wz, F); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); ctx.stroke();
  }
  // the markers: a square in the marker's colour, growing and fading once per pulse (the original's textures
  // minimap_ping*.tga are not in the game's files)
  drawMarkers(ctx, F) {
    const now = this.G.world.time;
    this.markers = this.markers.filter((m) => now - m.t < m.life);
    for (const m of this.markers) {
      const age = now - m.t, ph = (age * m.freq) % 1, s = SIZE.marker * m.size / 100 * (0.35 + 0.65 * ph);
      const [x, y] = this.w2t(m.x, m.z, F);
      ctx.strokeStyle = rgba(m.color, 1 - ph); ctx.lineWidth = 2;
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    }
  }
}

// the frame's buttons (MiniMap2.usl:84-195; positions in the 270 px window, art hud/minimap_buttons.tga) and their
// tooltips (H_ui "Minimap": mm_show_landscape ...)
export function minimapButtons(G, frame, mm, tip) {
  const mk = (x, y, w, h, key, art, onClick) => {
    const b = document.createElement('div');
    b.className = 'mmbtn';
    b.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
    const look = (hover) => { const s = spriteCss(art(hover), undefined, w, h); if (s) b.style.cssText = `left:${x}px;top:${y}px;` + s; };
    look(false);
    b.onmouseenter = () => { look(true); tip(b, key); };
    b.onmouseleave = () => { look(false); G.hud.hideTip(); };
    b.onclick = (e) => { e.stopPropagation(); onClick(); look(true); G.feedback && G.feedback.ui && G.feedback.ui('UI_click'); };
    b.oncontextmenu = (e) => e.preventDefault();
    frame.appendChild(b);
    return b;
  };
  const tog = (name, layer) => (hover) => `cmd_btn_minmap_${name}_${mm.layers[layer] ? 'down' : 'up'}${hover ? 'hover' : ''}`;
  mk(8, 225, 30, 30, 'mm_show_landscape', tog('scape', 'scape'), () => { mm.layers.scape = !mm.layers.scape; mm.dirty = true; });
  mk(38, 225, 30, 30, 'mm_show_resources', tog('res', 'resources'), () => { mm.layers.resources = !mm.layers.resources; mm.dirty = true; });
  mk(226, 49, 30, 30, 'mm_show_mapping', (hover) => `cmd_btn_minmap_pingall_${G.input.mode === 'mapping' ? 'down' : 'up'}${hover ? 'hover' : ''}`,
    () => G.input.setMode(G.input.mode === 'mapping' ? null : 'mapping'));
  mk(219, 219, 42, 21, 'mm_zoom_in', (hover) => `cmd_btn_minmap_zoomin_${mm.zoom >= 7 ? 'dis' : hover ? 'hov' : 'std'}`, () => { mm.zoom = Math.min(7, mm.zoom + 1); });
  mk(219, 240, 42, 21, 'mm_zoom_out', (hover) => `cmd_btn_minmap_zoomout_${mm.zoom <= 1 ? 'dis' : hover ? 'hov' : 'std'}`, () => { mm.zoom = Math.max(1, mm.zoom - 1); });
}
