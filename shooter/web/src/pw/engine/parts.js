// Part visibility from the GSF chunk attributes (the engine's "render invisibility mask").
//
// Raw attribute bits of a mesh chunk (verified against the original models, see claude/gsf_format_notes.md):
//   0-8   LOD mask (bit 0 = full detail)            9-13  epoch variants I..V (buildings)
//   18    selection / pick volume                   19    shadow model
//   20    night-only lights (buildings)             21-24 construction levels 0..3 (ConstructLevel = progress/25)
//   25    finished building                         26    intact   27 damage stage 1   28 damage stage 2
//   14    gate leaves, open                         15, 16 gate leaves, shut / moving
// Animals / vehicles use script flags instead (FightingObj.usl VIS_FLAG_ANML_*):
//   5 party colour, 6 saddle, 7 helmet, 8 armour, 9 standard, 10 armour saddle, 11 misc
//   20..27 wounds (arm l/r, leg l/r, belly l/r, head, tail) shown as hit points drop
export const BIT = { PICK: 18, SHADOW: 19, NIGHT: 20, CL0: 21, FIN: 25, OK: 26, D1: 27, D2: 28, AGE1: 9 };
export const VIS = { PARTYCOL: 5, SADDLE: 6, HELMET: 7, ARMOR: 8, STANDARTE: 9, ARMORSADDLE: 10, MISC: 11 };
const WOUNDS = [[20, 0.8], [21, 0.7], [22, 0.6], [23, 0.5], [24, 0.4], [25, 0.3], [27, 0.2]];   // Animal.usl UpdateHitpoints
const WOUND_ALL = 0x0ff00000;
const GEAR_ALL = 0x7e0;          // bits 5..10 (MISC 11 visible by default)

// progress/condition/epoch signature of a static part: visible iff all three masks contain the current state
// Gates (doors = the model has both kinds of leaves, hasDoors below): bit 14 = the leaves standing open (plain
// meshes), bits 15 / 16 = the leaves shut and swinging (skinned, the "open" / "close" animations move them). The
// signature carries them as bit 13 "only while open" and bit 14 "only while shut"; drawn together a gate is open and
// shut at once.
export function staticSig(a, doors) {
  let prog = ((a >>> 21) & 0xf) | (((a >>> 25) & 1) << 4);
  let cond = (a >>> 26) & 7;
  let age = (a >>> 9) & 0x1f;
  if (!prog) prog = 0x1f;
  if (!cond) cond = 7;
  if (!age) age = 0x1f;
  const d = doors ? (a >>> 14) & 7 : 0;
  return (prog) | (cond << 5) | (age << 8) | (d === 1 ? 1 << 13 : d ? 1 << 14 : 0);
}
export function sigVisible(sig, level, dmg, age, open) {
  if ((sig >> (open ? 14 : 13)) & 1) return 0;
  return ((sig >> level) & 1) && ((sig >> (5 + dmg)) & 1) && ((sig >> (7 + age)) & 1);
}
export function hasDoors(root) {
  let a = false, b = false;
  root.traverse((o) => { if (o.isMesh && o.userData.attr !== undefined) { const d = (o.userData.attr >>> 14) & 7; if (d === 1) a = true; else if (d) b = true; } });
  return a && b;
}
// meshes that are never drawn as geometry
export function helperPart(a, fourcc) {
  if ((a >>> BIT.PICK) & 1 && fourcc !== 'Wall') return 'pick';
  if (fourcc !== 'Anim' && fourcc !== 'Char' && (a >>> BIT.SHADOW) & 1) return 'shadow';
  if ((fourcc === 'Bldg' || fourcc === 'Misc' || fourcc === 'Deko') && (a >>> BIT.NIGHT) & 1) return 'night';
  if (!(a & 1)) return 'lod';
  return null;
}
export function isDynamicKind(fourcc) { return fourcc === 'Anim' || fourcc === 'Vehi' || fourcc === 'Char'; }

// hide mask for animals/vehicles: gear flags as set by the scripts, wounds by the hit point ratio
export function animalMask(opts) {
  let hide = GEAR_ALL | WOUND_ALL | (1 << BIT.PICK) | (1 << BIT.SHADOW);
  const show = (b) => { hide &= ~(1 << b); };
  if (opts.owned) { show(VIS.SADDLE); show(VIS.PARTYCOL); }
  if (opts.armor) show(VIS.ARMOR);
  if (opts.misc === false) hide |= 1 << VIS.MISC;
  const hr = opts.hp == null ? 1 : opts.hp;
  for (const [b, t] of WOUNDS) if (hr <= t) show(b);
  return hide;
}
export function woundStage(hr) { let n = 0; for (const [, t] of WOUNDS) if (hr <= t) n++; return n; }

// apply a hide mask to a model's dynamic parts (meshes carry userData.attr). Animals/vehicles/characters have a 5-bit
// LOD mask (bits 0-4); the script flags start at bit 5 (party colour, saddle ...). An earlier version ignored bits 0-8
// here, which also ignored the party colour / saddle / helmet / armour flags - wild animals then wore their harness.
export function applyMask(root, hide) {
  root.traverse((o) => { if (o.isMesh && o.userData.attr !== undefined) o.visible = !((o.userData.attr >>> 0) & hide & ~0x1f); });
}
// apply a building state to a model's static part groups (userData.sig)
// Wall pieces (userData.arm on their meshes): root.userData.armMask selects the arms shown (wallmap.js), and
// root.userData.variant one of the geometry variants of each piece (userData.variant / vcount).
export function applyState(root, level, dmg, age) {
  const mask = root.userData.armMask, pick = root.userData.variant, slope = root.userData.slope;
  const open = !!root.userData.doorOpen;                // a gate: its leaves open or (the default) shut
  root.traverse((o) => {
    const arm = o.userData.arm;
    let armOk = arm === undefined || arm < 0 || mask === undefined || ((mask >> arm) & 1) === 1;
    // one geometry variant per wall piece (assets.js tagWallArms): the tile's pick, different per arm
    // pick: [hub, arm 0..7] - each arm's pick comes from the edge it shares with its neighbour, so both halves of a
    // wall segment use the same variant and the top line is even
    // the slope of the arm (root.userData.slope[arm]: -1 down, 0 level, 1 up towards the neighbour; assets.js)
    if (armOk && o.userData.slope !== undefined) {
      const want = slope && arm >= 0 ? slope[arm] || 0 : 0;
      armOk = o.userData.slope === ((o.userData.slopes >> (want + 1)) & 1 ? want : 0);
    }
    if (armOk && o.userData.vcount > 1) armOk = ((pick ? pick[arm + 1] : 0) % o.userData.vcount) === o.userData.variant;
    if (o.userData.sig !== undefined) o.visible = armOk && !o.userData.trimmed && !!sigVisible(o.userData.sig, level, dmg, age, open);
    else if (arm !== undefined) o.visible = armOk;
  });
}
