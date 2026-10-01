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
export function helper(a, fourcc) {
  if ((a >>> 18) & 1 && fourcc !== 'Wall') return 'pick';
  if (fourcc !== 'Anim' && fourcc !== 'Char' && (a >>> 19) & 1) return 'shadow';
  if ((fourcc === 'Bldg' || fourcc === 'Misc' || fourcc === 'Deko') && (a >>> 20) & 1) return 'night';
  if ((a & 0x1f) && !(a & 1)) return 'lod';
  return null;
}
// the objects of a loaded glTF scene that carry part flags (glTF mesh nodes: a Mesh, or a Group of Meshes)
export function flagged(root) {
  const out = [];
  root.traverse((o) => { if (o.userData && o.userData.attr !== undefined) out.push(o); });
  return out;
}
// flag-less low-poly hulls (whole-object pick / collision volumes, no part flags at all): helpers too
function isHull(o) {
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
  const flags = new Map(), ages = new Set();
  let stages = false, damage = false, night = false, helpers = false, fx = false;
  for (const n of nodes) {
    if (isFx(n)) fx = true;
    const a = n.userData.attr >>> 0;
    if (DYNAMIC.includes(fourcc)) {
      for (let b = 5; b < 28; b++) if (b !== 18 && b !== 19 && (a >>> b) & 1) flags.set(b, (flags.get(b) || 0) + 1);
    } else {
      for (let k = 0; k < 5; k++) if ((a >>> (9 + k)) & 1) ages.add(k + 1);
      if ((a >>> 21) & 0xf) stages = true;
      if ((a >>> 27) & 3) damage = true;
      if ((fourcc === 'Bldg' || fourcc === 'Misc' || fourcc === 'Deko') && (a >>> 20) & 1) night = true;
    }
    const h = helper(a, fourcc) || (isHull(n) ? 'pick' : null);
    if (h === 'pick' || h === 'shadow') helpers = true;
  }
  return { dynamic: DYNAMIC.includes(fourcc), flags: [...flags.keys()].sort((x, y) => x - y), ages: [...ages].sort(), stages, damage, night, helpers, fx };
}
// default state: the in-game look of an owned unit / a finished intact building of its latest epoch
export function defaultState(info) {
  const flags = {};
  for (const b of info.flags) flags[b] = b === 11 ? true : b === 8 || b === 10 || b === 16 || b >= 20 ? false : true;
  return { flags, level: 4, dmg: 0, age: info.ages.length ? Math.max(...info.ages) : 1, night: false, helpers: false, fx: false };
}
// apply a state; returns the names of the hidden mesh nodes (sent to the exporter)
export function apply(root, fourcc, st) {
  const hidden = [];
  for (const n of flagged(root)) {
    const a = n.userData.attr >>> 0;
    let h = helper(a, fourcc) || (isHull(n) ? 'pick' : null);
    if (h === 'night' && st.night) h = null;
    if ((h === 'pick' || h === 'shadow') && st.helpers) h = null;
    let ok = !h && (st.fx || !isFx(n));
    if (ok) {
      if (DYNAMIC.includes(fourcc)) {
        if (!st.helpers && ((a >>> 18) & 3)) ok = false;
        for (let b = 5; b < 28 && ok; b++) if (b !== 18 && b !== 19 && (a >>> b) & 1 && st.flags[b] === false) ok = false;
      } else ok = sigVisible(staticSig(a), st.level, st.dmg, st.age);
    }
    n.visible = ok;
    if (!ok && n.userData.nodeName) hidden.push(n.userData.nodeName);
  }
  return hidden;
}
