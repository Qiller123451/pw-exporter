// Reader for original ParaWorld map files (.ula) - multiplayer maps, campaign maps and community maps.
// Format notes: docs/MAP_FORMAT.md of the toolkit (reverse engineered; the Python twin is pwexport/ula.py, the formal
// description pwexport/data/ksy/paraworld_surf.ksy).
//
//   container : u32 2, u32 total size, u32 block count N, u32 ?, N x {u32 ?, u32 size, u32 packed size, u32 1},
//               then N zlib streams (256 KB blocks)
//   'SURF'    : chunk directory - LInf (level info), Terr (terrain), Objs (placed objects), IOMG (landscape
//               decoration instances), PaFi, Rgns, Frst, GWFl{GrWa, Flck}, Trgr, Ques, DlgS, AI
//   Terr      : u32 1, u32 width, u32 height (metres), u32 blocks x, u32 blocks y, u32 setting, f32 water level,
//               u32 1, u8 0, u32 count, heights u16[count] (1/128 m, 2 m grid, stored in 16x16 blocks),
//               u32 count, materials u8[count] (4 m grid, 8x8 blocks; index into the setting's 8 ground materials)
//   PaFi      : the pathfinder's grids, 2 m cells (w/2 x h/2): u32 W, H, 2 numbers, then the land grid as
//               u32 W, H, words + words x u32 (one bit per cell, row-major, lowest bit first; 1 = walkable terrain),
//               then more grids (water, one per start location with the objects) - see pathing()
//
// parseUla(arrayBuffer) -> Promise<MapData>
//   MapData = { info:{key:value}, name, w, h, setting, water, hx, hy, heights(Float32Array, metres),
//               mx, my, mats(Uint8Array), objects:[{type,name,cls,x,y,z,rot,owner,attr}], plants:[{name,x,y,z,rot}],
//               forest:{w,h,blocks:[{x,y,b}]} (forest blocks, maps/forest.js),
//               walk:{w,h,cells(Uint8Array, 1 = walkable)} | null (the editor's land grid, PaFi) }
// Coordinates are map coordinates: x east 0..w, y south 0..h, z up (metres; left-handed, docs/MAP_FORMAT.md).

import { parseForest } from './forest.js';

export const SETTINGS = ['Northland', 'Savanna', 'Jungle', 'Icewaste', 'Ashvalley', 'TestSet', 'Cave1', 'Cave2', 'Cave3'];
// ground texture sets the remake has (tools/build_terrain.py); other settings fall back to the closest one
export const KNOWN_SETTINGS = { Northland: 'Northland', Savanna: 'Savanna', Jungle: 'Jungle', Icewaste: 'Icewaste', Ashvalley: 'Ashvalley',
  Cave1: 'Cave1', Cave2: 'Cave2', Cave3: 'Cave3', TestSet: 'Jungle' };     // (the caves have their own sets: Cave2 is the volcano)

const td = new TextDecoder('latin1');

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(await out);
}

// container -> one Uint8Array
export async function unpack(buf) {
  const dv = new DataView(buf);
  const total = dv.getUint32(4, true), n = dv.getUint32(8, true);
  const blocks = [];
  let o = 16;
  for (let i = 0; i < n; i++) { blocks.push([dv.getUint32(o + 4, true), dv.getUint32(o + 8, true)]); o += 16; }
  const out = new Uint8Array(total);
  let w = 0;
  const bytes = new Uint8Array(buf);
  for (const [size, packed] of blocks) {
    while (bytes[o] !== 0x78 && o < bytes.length) o++;            // zlib header
    const part = await inflate(bytes.subarray(o, o + packed));
    out.set(part.subarray(0, Math.min(size, total - w)), w);
    w += size; o += packed;
  }
  return out;
}

// SURF directory -> {tag: Uint8Array}
export function chunks(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const end = dv.getUint32(4, true), out = {};
  let o = 16;
  while (o + 16 <= end) {
    const tag = td.decode(b.subarray(o, o + 4)).replace(/\0+$/, '');
    if (dv.getUint32(o + 8, true) === 0x2a) {
      const size = dv.getUint32(o + 16, true), off = dv.getUint32(o + 20, true);
      out[tag] = b.subarray(off, off + size);
      o += 24;
    } else o += 16;                                                   // group header, children follow
  }
  return out;
}

// LInf (pwexport/ula.py level_info): u32 count + count x (key, value) length-prefixed strings; 8 slot numbers and 8
// player key/value lists; the 200 x 200 preview picture of the map list (stored B G R A; drawn by the engine's
// minimap renderer: docs/MINIMAP.md); the description tree ("Root/Base/DefaultCamera" ...). Strings: u32 length
// with the closing 0, then the characters.
function levelInfo(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 0;
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const str = () => { const l = u32(); const raw = b.subarray(o, o + l); o += l; const z = raw.indexOf(0); return td.decode(z >= 0 ? raw.subarray(0, z) : raw); };
  const kvs = () => { const n = u32(), kv = {}; for (let i = 0; i < n && o < b.length; i++) { const k = str(); kv[k] = str(); } return kv; };
  const kv = kvs(), out = { kv, preview: null, description: {} };
  try {
    o += 8 * 4;                                                    // slot numbers
    for (let i = 0; i < 8; i++) kvs();                             // player slots
    o += 1;
    const w = u32(), h = u32(), npix = u32(), nbytes = u32(), bpp = u32();
    if (w * h === npix && npix * bpp === nbytes && bpp === 4 && o + nbytes <= b.length) {
      const px = new Uint8ClampedArray(b.subarray(o, o + nbytes));
      for (let i = 0; i < px.length; i += 4) { const t = px[i]; px[i] = px[i + 2]; px[i + 2] = t; }
      out.preview = { w, h, rgba: px };
    }
    o += nbytes + 16;
    const tree = (prefix) => {
      const n = u32(), name = str(), value = str(), key = prefix ? prefix + '/' + name : name;
      if (value) out.description[key] = value;
      const node = { name, value, subs: [] };
      for (let i = 0; i < n; i++) node.subs.push(tree(key));
      return node;
    };
    if (o + 12 <= b.length) out.tree = tree('');
    for (const k of Object.keys(out.description)) { const s = k.split('/').pop(); if (!(s in out.description)) out.description[s] = out.description[k]; }
  } catch (e) { /* an older map without the rest: the key/values are enough */ }
  return out;
}

function terrain(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = dv.getUint32(4, true), h = dv.getUint32(8, true);
  const bx = dv.getUint32(12, true), by = dv.getUint32(16, true);
  const setting = dv.getUint32(20, true), water = dv.getFloat32(24, true);
  let o = 33;
  const hc = dv.getUint32(o, true); o += 4;
  const hx = bx * 16, hy = by * 16;
  if (hc !== hx * hy) throw new Error(`unexpected terrain size ${hc} (${hx}x${hy})`);
  // heights: 16x16 blocks, row-major blocks, row-major samples inside a block
  const heights = new Float32Array(hx * hy);
  for (let B = 0; B < bx * by; B++) {
    const X0 = (B % bx) * 16, Y0 = Math.floor(B / bx) * 16;
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) {
      heights[(Y0 + j) * hx + X0 + i] = dv.getUint16(o, true) / 128; o += 2;
    }
  }
  const mc = dv.getUint32(o, true); o += 4;
  const mx = bx * 8, my = by * 8;
  const mats = new Uint8Array(mx * my);
  if (mc === mx * my) {
    for (let B = 0; B < bx * by; B++) {
      const X0 = (B % bx) * 8, Y0 = Math.floor(B / bx) * 8;
      for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) mats[(Y0 + j) * mx + X0 + i] = b[o++];
    }
  }
  return { w, h, setting: SETTINGS[setting] || 'Jungle', water, hx, hy, heights, mx, my, mats };
}

// ---------------------------------------------------------------- pathfinding grid
// The map editor stores the pathfinder's grids with the map (chunk PaFi, docs/MAP_FORMAT.md). The first one says where
// the terrain alone can be walked on: not on steep slopes (mountains, cliffs), not in the water. Cell (i, j) covers
// map x 2i .. 2i + 2, y 2j .. 2j + 2. The per-start-location grids after it also leave out the placed objects (the
// game blocks those itself). null when the map has none or it does not fit the terrain.
export function pathing(b, w, h) {
  if (!b || b.length < 28) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const W = dv.getUint32(0, true), H = dv.getUint32(4, true), words = dv.getUint32(24, true);
  if (W !== Math.floor(w / 2) || H !== Math.floor(h / 2) || dv.getUint32(16, true) !== W || dv.getUint32(20, true) !== H) return null;
  if (words !== Math.ceil(W * H / 32) || 28 + words * 4 > b.length) return null;
  const cells = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) cells[k] = (b[28 + (k >> 3)] >> (k & 7)) & 1;
  return { w: W, h: H, cells };
}

// ---------------------------------------------------------------- objects (see tools/maps/objects.py)
function lstr(b, dv, o) {
  if (o + 4 > b.length) return null;
  const n = dv.getUint32(o, true);
  if (n < 1 || n > 200 || o + 4 + n > b.length || b[o + 3 + n] !== 0) return null;
  for (let k = o + 4; k < o + 3 + n; k++) if (b[k] < 32 || b[k] > 126) return null;
  return [td.decode(b.subarray(o + 4, o + 3 + n)), o + 4 + n];
}
function attrs(b, dv, a, z) {
  for (let o = a; o < Math.min(z, b.length - 8); o++) {
    const c = dv.getUint32(o, true);
    if (c < 1 || c > 300) continue;
    let p = o + 4; const kv = {}; let ok = 0;
    for (let i = 0; i < c; i++) {
      const k = lstr(b, dv, p); if (!k) break;
      p = k[1];
      let v = lstr(b, dv, p);
      if (!v) { if (p + 5 <= b.length && dv.getUint32(p, true) === 1 && b[p + 4] === 0) v = ['', p + 5]; else break; }
      kv[k[0]] = v[0]; p = v[1]; ok++;
    }
    if (ok === c) return kv;
  }
  return {};
}
function objects(b, w, h) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out = [];
  const up = (c) => c >= 65 && c <= 90;
  for (let i = 0; i + 45 < b.length; i++) {
    if (!(up(b[i]) && up(b[i + 1]) && up(b[i + 2]) && up(b[i + 3]))) continue;
    const x = dv.getFloat32(i + 9, true), y = dv.getFloat32(i + 13, true), z = dv.getFloat32(i + 17, true);
    if (!(x >= 0 && x <= w && y >= 0 && y <= h && z > -50 && z < 400)) continue;
    const qx = dv.getFloat32(i + 21, true), qy = dv.getFloat32(i + 25, true), qz = dv.getFloat32(i + 29, true), qw = dv.getFloat32(i + 33, true);
    if (Math.abs(qx * qx + qy * qy + qz * qz + qw * qw - 1) > 0.05) continue;
    const ln = dv.getUint32(i + 37, true);
    if (ln < 2 || ln > 80 || b[i + 40 + ln] !== 0) continue;
    let ok = true;
    for (let k = i + 41; k < i + 40 + ln; k++) if (b[k] < 32 || b[k] > 126) { ok = false; break; }
    if (!ok) continue;
    const name = td.decode(b.subarray(i + 41, i + 40 + ln));
    const owner = b[i + 8];
    // the engine applies the stored quaternion as its conjugate (Direct3D row vectors): the heading is -2 atan2(z, w)
    // counter-clockwise in map space; q = the stored quaternion (tilted landscape pieces need all of it)
    out.push({ type: td.decode(b.subarray(i, i + 4)), name, cls: name.replace(/_\d+$/, ''), x, y, z, rot: -2 * Math.atan2(qz, qw), q: [qx, qy, qz, qw],
      owner: owner === 0xff ? null : owner, at: i });
    i += 40 + ln;
  }
  for (let k = 0; k < out.length; k++) out[k].attr = attrs(b, dv, out[k].at + 41, k + 1 < out.length ? out[k + 1].at : b.length);
  return out;
}

// IOMG: u32 ?, u32 blocks x, u32 blocks y, u32 class count, class names, u32 block count,
//       per block: u32 n, n x {f32 x, y, z, quaternion x, y, z, w, u32 class}
function plants(b) {
  if (!b || b.length < 16) return [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const nc = dv.getUint32(12, true), names = [];
  let o = 16;
  for (let i = 0; i < nc; i++) { const l = dv.getUint32(o, true); names.push(td.decode(b.subarray(o + 4, o + 3 + l))); o += 4 + l; }
  const nb = dv.getUint32(o, true); o += 4;
  const out = [];
  for (let k = 0; k < nb && o + 4 <= b.length; k++) {
    const n = dv.getUint32(o, true); o += 4;
    for (let i = 0; i < n; i++, o += 32) {
      const qx = dv.getFloat32(o + 12, true), qy = dv.getFloat32(o + 16, true), qz = dv.getFloat32(o + 20, true), qw = dv.getFloat32(o + 24, true);
      out.push({ name: names[dv.getUint32(o + 28, true)] || '', x: dv.getFloat32(o, true), y: dv.getFloat32(o + 4, true), z: dv.getFloat32(o + 8, true), rot: -2 * Math.atan2(qz, qw), q: [qx, qy, qz, qw] });
    }
  }
  return out;
}

// Rgns (pwexport/triggers.py regions): u32 version, u32 n handles + n x 4 bytes, u32 n regions: {u32 flags, guid (16
// bytes), name, u32 colour, u32 n shapes: {u32 type (low byte 1 rect | 2 oval, bit 29 enabled), u32, f32 x y z w h d},
// note}. Shapes are map boxes x .. x+w, y .. y+h (an oval is the ellipse inscribed in its box). The nests' areas are
// regions "<nest>_ActionArea", "_SafeArea", "_HotspotArea" (Nest.usl).
export function regions(b) {
  const out = [];
  if (!b || b.length < 12) return out;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 0;
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const f32 = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
  const str = () => { const l = u32(); const raw = b.subarray(o, o + l); o += l; const z = raw.indexOf(0); return td.decode(z >= 0 ? raw.subarray(0, z) : raw); };
  try {
    u32();
    const handles = u32();
    o += 4 * handles;                          // (not "o += 4 * u32()": that adds to o as it was before the read)
    for (let n = u32(), i = 0; i < n; i++) {
      u32(); o += 16;
      const reg = { name: str(), shapes: [] };
      u32();
      for (let k = u32(), j = 0; j < k; j++) {
        const t = u32(); u32();
        const x = f32(), y = f32(); f32(); const w = f32(), h = f32(); f32();
        reg.shapes.push({ oval: (t & 0xff) === 2, enabled: !!(t & 0x20000000), x, y, w, h });
      }
      str();
      out.push(reg);
    }
  } catch (e) { /* a damaged tail: what was read */ }
  return out;
}

export function dayTime(v) {
  if (v == null || v === '') v = '12:0';
  const t = String(v).split(':');
  return t.length === 2 && Number.isFinite(+t[0]) && Number.isFinite(+t[1]) ? (+t[0]) * 3600 + (+t[1]) * 60 : 8.5 * 3600;
}
export async function parseUla(buf, fileName = '') {
  const blob = await unpack(buf);
  if (td.decode(blob.subarray(0, 4)) !== 'SURF') throw new Error('not a ParaWorld map');
  const c = chunks(blob);
  const li = c.LInf ? levelInfo(c.LInf) : { kv: {}, preview: null, description: {}, tree: null };
  const info = li.kv;
  const t = terrain(c.Terr);
  return {
    ...t, info, file: fileName, preview: li.preview, description: li.description, infoTree: li.tree || null,
    // the camera's angle the level starts with (radians; the minimap's diamond follows it: docs/MINIMAP.md)
    defaultCamera: Number.isFinite(+li.description.DefaultCamera) && li.description.DefaultCamera !== '' ? +li.description.DefaultCamera : 0.785,
    // the time of day the level starts at ("Root/Base/StartTime" = "12:0"; ServerApp.usl: 12:00 when missing, 8:30
    // when malformed), in seconds of the day
    startTime: dayTime(li.description.StartTime),
    // the level info names the setting ("Setting": "Cave1"); the number in the terrain header is the fallback
    setting: KNOWN_SETTINGS[info.Setting] || KNOWN_SETTINGS[t.setting] || 'Jungle',
    name: info.LevelName || info.MapName || fileName.replace(/\.ula$/i, ''),
    maxPlayers: +info.MaxPlayers || +info.StartLocations || 2,
    objects: c.Objs ? objects(c.Objs, t.w, t.h) : [],
    plants: plants(c.IOMG),
    forest: parseForest(c.Frst),
    walk: pathing(c.PaFi, t.w, t.h),
    regions: regions(c.Rgns),
    // the setting by its own name: forest kinds are per setting
    settingName: SETTINGS.includes(info.Setting) ? info.Setting : t.setting,
  };
}
