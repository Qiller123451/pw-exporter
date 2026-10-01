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
//
// parseUla(arrayBuffer) -> Promise<MapData>
//   MapData = { info:{key:value}, name, w, h, setting, water, hx, hy, heights(Float32Array, metres),
//               mx, my, mats(Uint8Array), objects:[{type,name,cls,x,y,z,rot,owner,attr}], plants:[{name,x,y,z,rot}] }
// Coordinates are map coordinates: x east 0..w, y north 0..h, z up (metres).

export const SETTINGS = ['Northland', 'Savanna', 'Jungle', 'Icewaste', 'Ashvalley', 'TestSet', 'Cave1', 'Cave2', 'Cave3'];
// ground texture sets the remake has (tools/build_terrain.py); other settings fall back to the closest one
export const KNOWN_SETTINGS = { Northland: 'Northland', Savanna: 'Savanna', Jungle: 'Jungle', Icewaste: 'Icewaste', Ashvalley: 'Ashvalley',
  Cave1: 'Cave1', Cave2: 'Cave1', Cave3: 'Cave1', TestSet: 'Jungle' };

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

// LInf: u32 count + count x (key, value) length-prefixed strings
function levelInfo(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(0, true), kv = {};
  let o = 4;
  const str = () => { const l = dv.getUint32(o, true); const s = td.decode(b.subarray(o + 4, o + 3 + l)); o += 4 + l; return s; };
  for (let i = 0; i < n && o < b.length; i++) { const k = str(); kv[k] = str(); }
  return kv;
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
    out.push({ type: td.decode(b.subarray(i, i + 4)), name, cls: name.replace(/_\d+$/, ''), x, y, z, rot: 2 * Math.atan2(qz, qw),
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
      const qz = dv.getFloat32(o + 20, true), qw = dv.getFloat32(o + 24, true);
      out.push({ name: names[dv.getUint32(o + 28, true)] || '', x: dv.getFloat32(o, true), y: dv.getFloat32(o + 4, true), z: dv.getFloat32(o + 8, true), rot: 2 * Math.atan2(qz, qw) });
    }
  }
  return out;
}

export async function parseUla(buf, fileName = '') {
  const blob = await unpack(buf);
  if (td.decode(blob.subarray(0, 4)) !== 'SURF') throw new Error('not a ParaWorld map');
  const c = chunks(blob);
  const info = c.LInf ? levelInfo(c.LInf) : {};
  const t = terrain(c.Terr);
  return {
    ...t, info, file: fileName,
    // the level info names the setting ("Setting": "Cave1"); the number in the terrain header is the fallback
    setting: KNOWN_SETTINGS[info.Setting] || KNOWN_SETTINGS[t.setting] || 'Jungle',
    name: info.LevelName || info.MapName || fileName.replace(/\.ula$/i, ''),
    maxPlayers: +info.MaxPlayers || +info.StartLocations || 2,
    objects: c.Objs ? objects(c.Objs, t.w, t.h) : [],
    plants: plants(c.IOMG),
  };
}
