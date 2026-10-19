// Part visibility from the GSF chunk attributes (the engine's "render invisibility mask").
//
// Raw attribute bits of a mesh chunk (verified against the original models, see claude/gsf_format_notes.md):
//   0-8   LOD mask (bit 0 = full detail)            9-13  epoch variants I..V (buildings)
//   18    selection / pick volume                   19    shadow model
//   17    day-only parts (buildings, ships)         20    night-only lights (the glows and fireflies of lamps)
//   21-24 construction levels 0..3 (ConstructLevel = progress/25)
//   25    finished building                         26    intact   27 damage stage 1   28 damage stage 2
// Animals / vehicles use script flags instead (FightingObj.usl VIS_FLAG_ANML_*):
//   5 party colour, 6 saddle, 7 helmet, 8 armour, 9 standard, 10 armour saddle, 11 misc
//   20..27 wounds (arm l/r, leg l/r, belly l/r, head, tail) shown as hit points drop
export const BIT = { DAY: 17, PICK: 18, SHADOW: 19, NIGHT: 20, CL0: 21, FIN: 25, OK: 26, D1: 27, D2: 28, AGE1: 9 };
// the kinds of model whose bit 20 means "lit at night" (the exporter's parts.py NIGHT)
const NIGHT_KINDS = new Set(['Bldg', 'Deko', 'Fiel', 'Misc', 'Ship']);
// a part's time of day: 'night' = shown only at night, 'day' = only by day, null = always. Buildings and ships switch
// them (Building.usl / Ship.usl: SetRndInvMaskSingleFlagInv(VIS_FLAG_BLDG_NIGHTMODE = 20, night),
// (VIS_FLAG_BLDG_INIGHTMODE = 17, !night)); everything else keeps the default: the night lights off.
export function todOf(a, fourcc) {
  if (NIGHT_KINDS.has(fourcc) && (a >>> BIT.NIGHT) & 1) return 'night';
  if ((fourcc === 'Bldg' || fourcc === 'Ship') && (a >>> BIT.DAY) & 1) return 'day';
  return null;
}
export const VIS = { PARTYCOL: 5, SADDLE: 6, HELMET: 7, ARMOR: 8, STANDARTE: 9, ARMORSADDLE: 10, MISC: 11 };
const WOUNDS = [[20, 0.8], [21, 0.7], [22, 0.6], [23, 0.5], [24, 0.4], [25, 0.3], [27, 0.2]];   // Animal.usl UpdateHitpoints
const WOUND_ALL = 0x0ff00000;
const GEAR_ALL = 0x7e0;          // bits 5..10 (MISC 11 visible by default)

// progress/condition/epoch signature of a static part: visible iff all three masks contain the current state
export function staticSig(a) {
  let prog = ((a >>> 21) & 0xf) | (((a >>> 25) & 1) << 4);
  let cond = (a >>> 26) & 7;
  let age = (a >>> 9) & 0x1f;
  if (!prog) prog = 0x1f;
  if (!cond) cond = 7;
  if (!age) age = 0x1f;
  return (prog) | (cond << 5) | (age << 8);
}
export function sigVisible(sig, level, dmg, age) {
  return ((sig >> level) & 1) && ((sig >> (5 + dmg)) & 1) && ((sig >> (7 + age)) & 1);
}
// meshes that are never drawn as geometry
// additive: the chunk's material adds light (GSF material flag 0x4). On decorations the pick bit then marks the
// light shapes of an effect, which are what is shown (fx_heal_area, fx_holy_forest, ash_lava_glow_01)
export function helperPart(a, fourcc, additive = false) {
  if ((a >>> BIT.PICK) & 1 && fourcc !== 'Wall' && !(additive && fourcc === 'Deko')) return 'pick';
  if (fourcc !== 'Anim' && fourcc !== 'Char' && (a >>> BIT.SHADOW) & 1) return 'shadow';
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
  for (const b of opts.gear || []) show(b);                  // helmet, armour, armoured saddle, standard (compose.js GEAR)
  if (opts.noSaddle) hide |= 1 << VIS.SADDLE;
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
// root.userData.night: the model shows its night parts (applyNight); the default is day
export function applyState(root, level, dmg, age) {
  const mask = root.userData.armMask, pick = root.userData.variant, night = !!root.userData.night;
  const parts = root.userData.parts, ends = root.userData.gateEnds;
  root.userData.state = [level, dmg, age];
  root.traverse((o) => {
    const tod = o.userData.tod, todOk = tod === undefined || (tod === 'night') === night;
    const arm = o.userData.arm;
    let armOk = arm === undefined || arm < 0 || mask === undefined || ((mask >> arm) & 1) === 1;
    // wall pieces by part name (wallmap.js buildName, assets.js tagWallArms): only the parts the WallMap named
    if (o.userData.comp !== undefined) armOk = !!parts && parts.has(o.userData.comp);
    // a gate's end pieces (attr bits 0x80 / 0x800 = render flags 7, 11) only on a diagonal gate
    if (ends !== undefined && o.userData.attr !== undefined && ((o.userData.attr >>> 0) & 0x880)) armOk = armOk && ends;
    // one geometry variant per wall piece (assets.js tagWallArms): the tile's pick, different per arm
    // pick: [hub, arm 0..7] - each arm's pick comes from the edge it shares with its neighbour, so both halves of a
    // wall segment use the same variant and the top line is even
    if (armOk && o.userData.vcount > 1) armOk = ((pick ? pick[arm + 1] : 0) % o.userData.vcount) === o.userData.variant;
    if (o.userData.sig !== undefined) o.visible = armOk && todOk && !o.userData.trimmed && !!sigVisible(o.userData.sig, level, dmg, age);
    else if (arm !== undefined || o.userData.comp !== undefined || ends !== undefined) o.visible = armOk && todOk;
    else if (tod !== undefined) o.visible = todOk;
  });
}
// switch a building's or ship's model between day and night (its lights); true when it changed
export function applyNight(root, night) {
  if (!!root.userData.night === !!night) return false;
  root.userData.night = !!night;
  applyState(root, ...(root.userData.state || [4, 0, 1]));
  return true;
}
