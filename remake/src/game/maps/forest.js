// Forest blocks of original maps: the trees a map stores as 32 m squares of forest instead of placed objects
// (toolkit docs/MAP_FORMAT.md "Forest blocks"; the Python twin is pwexport/forest.py).
//
// The map's Frst chunk has one record per forest square: 31 item bytes (15 trees, 16 undergrowth plants; bits 5-6 =
// state, 2 = standing; bits 0-4 = amount). Where the items stand is not in the map: the engine picks one of 32
// built-in layouts per square. forest.json (pipeline step "forest") holds that table, copied from the player's own
// PWServer.exe / PWClient.exe, and the tree kinds of every setting (Forest_<Setting>.txt).
//
//   setForestData(json)               forest.json, or null (then maps have no forest trees)
//   forestItems(md) -> {trees: [{x, y, rot, kind, amount}], deco: [{x, y, kind}]}     map coordinates (x east, y north)
//   forestKinds(setting) -> {trees: [{standard, stump, timber} | null x 5], deco: [model | null x 8]} | null
const CELL = 32, TREES = 15, ITEMS = 31, PATTERNS = 32, PWORDS = 156;
export const FOREST_MIN_HEIGHT = 16;      // the engine shows nothing of a forest block at or below the water level

let DATA = null;       // {words: Uint32Array(4992), floats: Float32Array(4992), settings}

export function setForestData(json) {
  DATA = null;
  if (!json || !json.patterns) return;
  try {
    const bin = atob(json.patterns);
    if (bin.length !== PATTERNS * PWORDS * 4) return;
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    DATA = { words: new Uint32Array(u8.buffer), floats: new Float32Array(u8.buffer), settings: json.settings || {} };
  } catch (e) { DATA = null; }
}
export const hasForestData = () => !!DATA;
export function forestKinds(setting) {
  if (!DATA) return null;
  return DATA.settings[setting] || null;
}
// the layout the engine uses for square (cx, cy)
const patternOf = (cx, cy) => DATA.words[(2317 * cy + 13 * cx) % DATA.words.length] & 31;

// Frst chunk -> {w, h, blocks: [{x, y, b: Uint8Array(31)}]}
export function parseForest(b) {
  const out = { w: 0, h: 0, blocks: [] };
  if (!b || b.length < 12) return out;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = dv.getUint32(0, true), h = dv.getUint32(4, true);
  if (!(w > 0 && w <= 4096 && h > 0 && h <= 4096)) return out;
  out.w = w; out.h = h;
  for (let o = 8; o + 4 <= b.length;) {
    const i = dv.getUint32(o, true); o += 4;
    if (i === 0xffffffff || o + 32 > b.length) break;
    if (i < w * h) out.blocks.push({ x: i % w, y: Math.floor(i / w), b: b.subarray(o + 1, o + 32) });
    o += 32;
  }
  return out;
}

// every standing tree and undergrowth plant of the map's forest blocks. heightAt(x, y) = terrain height in map
// coordinates: nothing stands at or below 16 m (under water).
export function forestItems(md, heightAt) {
  const out = { trees: [], deco: [] };
  if (!DATA || !md.forest || !md.forest.blocks.length) return out;
  const { words, floats } = DATA;
  for (const blk of md.forest.blocks) {
    const p = patternOf(blk.x, blk.y) * PWORDS;
    for (let i = 0; i < ITEMS; i++) {
      const v = blk.b[i], state = (v >> 5) & 3;
      if (state !== 2 && state !== 3) continue;
      const x = blk.x * CELL + floats[p + 1 + i], y = blk.y * CELL + floats[p + 32 + i];
      if (heightAt && heightAt(x, y) <= FOREST_MIN_HEIGHT) continue;
      const r = words[p + 94 + i];
      if (i < TREES) {
        if (!(v & 31)) continue;
        out.trees.push({ x, y, rot: -((r >>> 4) & 7) * Math.PI / 4, kind: ((r >>> 1) & 0x3fffffff) % 5, amount: v & 31 });
      } else out.deco.push({ x, y, kind: r & 7 });
    }
  }
  return out;
}
