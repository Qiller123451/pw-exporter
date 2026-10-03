// Which parts of a model show, from the GSF attribute flags in the node extras ("attr"). JavaScript twin of
// pwexport/parts.py (and of the remake's src/engine/parts.js) - see there for the bit table.
export const DYNAMIC = ['Anim', 'Vehi', 'Char'];
export const WOUND_BITS = [20, 21, 22, 23, 24, 25, 26, 27];

export function staticSig(a) {
  let prog = ((a >>> 21) & 0xf) | (((a >>> 25) & 1) << 4);
  let cond = (a >>> 26) & 7, age = (a >>> 9) & 0x1f;
  return (prog || 0x1f) | ((cond || 7) << 5) | ((age || 0x1f) << 8);
}
export function sigVisible(sig, level, dmg, age) {
  return !!(((sig >> level) & 1) && ((sig >> (5 + dmg)) & 1) && ((sig >> (7 + age)) & 1));
}
// What the bits of a mesh chunk's attribute word mean, per model type (FourCC). The engine draws a chunk when its
// bits match the object's current render mask; the meaning of the bits comes from SEK's object class definitions
// (one per FourCC). Names as in the community table (docs/gsf/flags.jpg of Paraworld_gsf_viewer + Flags.xlsx);
// bit numbers here are the raw bits (bit 0 = LoD 0; the table's "Bit1..Bit32" count each byte from its top bit).
// Bits 0-4 are the LoD mask in every type.
const CON = { 21: 'Con 0', 22: 'Con 1', 23: 'Con 2', 24: 'Con 3', 25: 'Con 4 (finished)', 26: 'UseConFlags (intact)', 27: 'Dest 1', 28: 'Dest 2' };
const UNK = (from, to, what) => Object.fromEntries([...Array(to - from + 1).keys()].map((k) => [from + k, what]));
export const FLAGS = {
  Char: { 5: 'Head', 6: 'Body', 7: 'Legs', 18: 'SelVol' },
  Ress: { 5: 'res_1', 6: 'res_2', 7: 'res_3', 8: 'res_4', 9: 'res_5', 10: 'res_6', 18: 'SelVol' },
  Bldg: { 5: 'AnimateConStart', 6: 'AnimateConEnd', 7: 'Unknown (cloth?)', 8: 'Unknown (con flag)', 9: 'Age 1', 10: 'Age 2', 11: 'Age 3', 12: 'Age 4', 13: 'Age 5', 18: 'SelVol', 19: 'ShadowModel', 20: 'Night', ...CON },
  Wall: { 5: 'AnimateConStart', 6: 'AnimateConEnd', 15: 'Unknown', 18: 'Unknown', 19: 'Unknown (shadow?)', 29: 'Unknown', 30: 'Unknown', ...CON },
  Deko: { 5: 'Sequence', 18: 'SelVol', 19: 'ShadowModel', 20: 'Night' },
  Vehi: { 5: 'ram_low', 6: 'ram_high', 18: 'SelVol', 19: 'ShadowModel' },
  Fiel: { 5: 'AnimateConStart', 6: 'AnimateConEnd', 7: 'Unknown (cloth?)', 9: 'Unknown (hu_corn_field)', 18: 'SelVol', 19: 'ShadowModel', 20: 'Night', ...CON },
  Misc: { 5: 'Misc_Step0', 6: 'Misc_Step1', 7: 'Misc_Step2', 18: 'SelVol', 19: 'ShadowModel', 20: 'Night', ...UNK(21, 28, 'Unknown (hu_ruin_ws)') },
  Towe: { 5: 'Zinnen_1', 6: 'Zinnen_2', 7: 'Zinnen_3', 8: 'Zinnen_4', 9: 'Zinnen_5', 10: 'Zinnen_6', 11: 'Zinnen_7', 12: 'Zinnen_8', 13: 'Zinnen_9' },
  Anim: { 5: 'PartyCol', 6: 'Saddle', 7: 'Helmet', 8: 'Armor', 9: 'Standarte', 10: 'Armorsaddle', 11: 'Misc', 18: 'SelVol', 20: 'arm_li', 21: 'arm_re', 22: 'leg_li', 23: 'leg_re', 24: 'bauch_li', 25: 'bauch_re', 26: 'head', 27: 'tail' },
  Ship: { 5: 'ram_low', 6: 'ram_high', 19: 'ShadowModel', 20: 'Night', 25: 'Con 4 (finished)', 26: 'UseConFlags (intact)', 27: 'Dest 1', 28: 'Dest 2' },
  Vgtn: { 18: 'SelVol', 19: 'TreeBillboard' },
  RIVR: { 18: 'SelVol', 21: 'UseWaterShader', 31: 'Unknown (ice_river_1)' },
};
export function flagName(fourcc, b) { return b < 5 ? 'LOD' + b : (FLAGS[fourcc] || {})[b] || null; }
const SELVOL = new Set(['Char', 'Ress', 'Bldg', 'Deko', 'Vehi', 'Fiel', 'Misc', 'Anim', 'Vgtn', 'RIVR']);
const NIGHT = new Set(['Bldg', 'Deko', 'Fiel', 'Misc', 'Ship']);
const STATES = new Set(['Bldg', 'Wall', 'Fiel', 'Misc', 'Deko', 'Vgtn', 'Ship']);   // construction / damage bits 21-28
export function lodMask(a) { return a & 0x1f; }
// helper parts the game never draws as the object: selection volumes, shadow models, tree billboards, night lights
export function helper(a, fourcc) {
  if ((a >>> 18) & 1 && SELVOL.has(fourcc)) return 'pick';
  if ((a >>> 19) & 1 && fourcc === 'Vgtn') return 'billboard';
  if ((a >>> 19) & 1 && fourcc !== 'Anim' && fourcc !== 'Char') return 'shadow';
  if ((a >>> 20) & 1 && NIGHT.has(fourcc)) return 'night';
  return null;
}
// the objects of a loaded glTF scene that carry part flags (glTF mesh nodes: a Mesh, or a Group of Meshes)
export function flagged(root) {
  const out = [];
  root.traverse((o) => { if (o.userData && o.userData.attr !== undefined) out.push(o); });
  return out;
}
// flag-less low-poly hulls (whole-object pick / collision volumes, no part flags at all): helpers too
export function isHull(o) {
  if ((o.userData.attr >>> 5) !== 0) return false;
  let n = 0, skinned = false;
  const box = new THREE_Box();
  o.traverse((m) => { if (m.isMesh) { n += m.geometry.attributes.position.count; skinned = skinned || m.isSkinnedMesh; m.geometry.computeBoundingBox(); box.add(m.geometry.boundingBox); } });
  return !skinned && n > 0 && n <= 24 && box.size() > 8;
}
class THREE_Box {
  constructor() { this.min = [1e9, 1e9, 1e9]; this.max = [-1e9, -1e9, -1e9]; }
  add(b) { const a = [b.min.x, b.min.y, b.min.z], c = [b.max.x, b.max.y, b.max.z]; for (let i = 0; i < 3; i++) { this.min[i] = Math.min(this.min[i], a[i]); this.max[i] = Math.max(this.max[i], c[i]); } }
  size() { return Math.max(this.max[0] - this.min[0], this.max[1] - this.min[1], this.max[2] - this.min[2]); }
}
// sprite clouds of effects (smoke, dust, sparks: billboards with a particle_* texture), not part of the model
function isFx(o) {
  if (o.userData.kind !== 'foliage') return false;
  let fx = false;
  o.traverse((m) => { if (m.isMesh) for (const mt of [].concat(m.material)) if (/^particle/i.test(mt.name || '')) fx = true; });
  return fx;
}
// what a model offers to toggle
export function describe(root, fourcc) {
  const nodes = flagged(root);
  const flags = new Map(), ages = new Set(), bits = new Map(), res = new Set();
  let lods = 0;
  let stages = false, damage = false, night = false, helpers = false, fx = false;
  for (const n of nodes) {
    if (isFx(n)) fx = true;
    const a = n.userData.attr >>> 0;
    lods |= lodMask(a);
    for (let b = 5; b < 32; b++) if ((a >>> b) & 1) bits.set(b, (bits.get(b) || 0) + 1);
    if (DYNAMIC.includes(fourcc)) {
      for (let b = 5; b < 28; b++) if (b !== 18 && b !== 19 && (a >>> b) & 1) flags.set(b, (flags.get(b) || 0) + 1);
    } else {
      // bits 9-13: the epochs of buildings; other types with state bits use them alike (variants of walls, sequence
      // steps of decorations), so they keep the same "latest one" default
      if (STATES.has(fourcc)) for (let k = 0; k < 5; k++) if ((a >>> (9 + k)) & 1) ages.add(k + 1);
      if (STATES.has(fourcc) && (a >>> 21) & 0xf) stages = true;
      if (STATES.has(fourcc) && (a >>> 27) & 3) damage = true;
      if (fourcc === 'Ress') for (let k = 0; k < 6; k++) if ((a >>> (5 + k)) & 1) res.add(k + 1);
      if (NIGHT.has(fourcc) && (a >>> 20) & 1) night = true;
    }
    const h = helper(a, fourcc) || (isHull(n) ? 'pick' : null);
    if (h === 'pick' || h === 'shadow' || h === 'billboard') helpers = true;
  }
  // how many chunks have each of the 32 bits (the Visibility checkboxes show all of them)
  const all = new Array(32).fill(0);
  for (const n of nodes) { const a = n.userData.attr >>> 0; for (let k = 0; k < 32; k++) if ((a >>> k) & 1) all[k]++; }
  return { fourcc, dynamic: DYNAMIC.includes(fourcc), flags: [...flags.keys()].sort((x, y) => x - y), ages: [...ages].sort(), stages, damage, night, helpers, fx,
    res: [...res].sort(), lods: [0, 1, 2, 3, 4].filter((k) => (lods >> k) & 1), bits: [...bits.entries()].sort((x, y) => x[0] - y[0]), all, chunks: nodes.length };
}
// default state: the in-game look of an owned unit / a finished intact building of its latest epoch, LoD 0
export function defaultState(info) {
  const flags = {};
  for (const b of info.flags) flags[b] = b === 11 ? true : b === 8 || b === 10 || b === 16 || b >= 20 ? false : true;
  return { flags, level: 4, dmg: 0, age: info.ages.length ? Math.max(...info.ages) : 1, night: false, helpers: false, fx: false,
    res: info.res && info.res.length ? Math.max(...info.res) : 0, lod: 0, filter: {} };
}
// the game's rules (Model Parts) for one chunk
function gameVisible(n, a, fourcc, st) {
  let h = helper(a, fourcc) || (isHull(n) ? 'pick' : null);
  if (h === 'night' && st.night) h = null;
  if ((h === 'pick' || h === 'shadow' || h === 'billboard') && st.helpers) h = null;
  if (h || (!st.fx && isFx(n))) return false;
  if (DYNAMIC.includes(fourcc)) {
    if (!st.helpers && ((a >>> 18) & 3)) return false;
    for (let b = 5; b < 28; b++) if (b !== 18 && b !== 19 && (a >>> b) & 1 && st.flags[b] === false) return false;
    return true;
  }
  if (fourcc === 'Ress' && st.res && (a >>> 5) & 0x3f && !((a >>> (4 + st.res)) & 1)) return false;
  if (!STATES.has(fourcc)) return true;
  return sigVisible(staticSig(a), st.level, st.dmg, st.age);
}
// The mask of the ticked Visibility checkboxes (st.filter = {bit: true}); 0 = no filter.
export function filterMask(st) {
  let m = 0;
  for (const k in st.filter || {}) if (st.filter[k]) m |= (1 << k);
  return m >>> 0;
}
// Apply a state; returns the names of the hidden mesh nodes (sent to the exporter). Two ways to decide:
//  * the bit filter (Visibility checkboxes): with any of the 32 bits ticked, a chunk shows exactly when every ticked
//    bit is set in its flag field - nothing else counts (no grouping, no helper rules);
//  * else the in-game look (the preset controls): the game's rules for the chosen epoch / construction stage /
//    condition / equipment, at the level of detail st.lod.
export function apply(root, fourcc, st) {
  const hidden = [];
  const mask = filterMask(st), lod = st.lod || 0;
  for (const n of flagged(root)) {
    const a = n.userData.attr >>> 0;
    let ok;
    if (mask) ok = ((a & mask) >>> 0) === mask;
    else ok = gameVisible(n, a, fourcc, st) && !(lodMask(a) && !((a >>> lod) & 1));
    n.visible = ok;
    if (!ok && n.userData.nodeName) hidden.push(n.userData.nodeName);
  }
  return hidden;
}
