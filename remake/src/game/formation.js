// Group walk formations: where each unit of a group goes when the group is sent somewhere.
//
// Reference: docs/spec/formations.md (from the original scripts). The player draws an arrow with the right mouse
// button (GameInputController.usl: the order goes to the press point, facing the arrow, the spacing grows with its
// length); a plain right-click and the command bar's orders face from the group to the target with the spacing
// 2.7807 (SecondaryInputController.usl). The layout itself is the engine's (not in the scripts); its inputs are the
// units' formation attributes (FightingObj.UpdateFormationAttribs): "ranged weapons are placed in the rear and close
// combat units to the fore" (the game's help), the toughest units in the middle.
export const SPACING = 2.7807;             // FrmSpc of the command bar's walk and attack orders
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// formation_y: 0 front .. 1 rear by the reach of the unit's weapon (the tech tree's formation_pos overrides it:
// workers 1, healers 0.2, jetpack warriors / ice spearmen / Stina 0); formation_x: 0 centre .. 1 side, tougher
// (hit points through protection) nearer the centre
export function formationAttribs(W, u) {
  const cs = u.cs && u.cs(u.weapons.long);
  let y = (cs ? W.attackRangeOf(u, cs) + 1 : 1) / 75 - (cs ? cs.dmg : 0) / 10000;
  const fp = u.def && u.def.formationPos;
  if (fp >= 0) y = fp;
  const eff = 100 * u.maxHp / clamp(100 - (cs ? cs.prot : 0), 1, 100);
  return { x: 1 - Math.min(eff / 3000, 1), y: clamp(y, 0, 1) };
}

// the places of `units` around (x, z), facing `dir` (radians, atan2(dz, dx) of the direction the group looks to),
// `spacing` metres apart: [[unit, x, z], ...]. Rows across the facing, the front row first; in a row the toughest
// in the middle, and of two places left and right of it the unit that stands more to that side takes it (so the
// paths don't cross).
export function formationSlots(W, units, x, z, dir, spacing = SPACING) {
  const n = units.length;
  if (!n) return [];
  const fx = Math.cos(dir), fz = Math.sin(dir), rx = -fz, rz = fx;
  const sp = Math.max(spacing, Math.max(...units.map((u) => u.radius)) * 2 + 0.6);
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const att = new Map(units.map((u) => [u, formationAttribs(W, u)]));
  const sorted = [...units].sort((a, b) => att.get(a).y - att.get(b).y || att.get(a).x - att.get(b).x);
  const rows = [];
  for (let i = 0; i < n; i += cols) rows.push(sorted.slice(i, i + cols));
  const side = (u) => (u.pos.x - x) * rx + (u.pos.z - z) * rz;
  const out = [];
  rows.forEach((row, r) => {
    const lon = ((rows.length - 1) / 2 - r) * sp;             // the front row ahead of the point
    const m = row.length;
    const offs = [];
    for (let c = 0; c < m; c++) offs.push(c - (m - 1) / 2);
    offs.sort((a, b) => Math.abs(a) - Math.abs(b) || a - b);
    const byX = [...row].sort((a, b) => att.get(a).x - att.get(b).x);
    for (let i = 0; i < m;) {
      const o = offs[i];
      if (i + 1 < m && Math.abs(offs[i + 1]) === Math.abs(o) && o !== 0) {
        // a pair of places -o / +o: the unit more to the left takes the left one
        let [p, q] = [byX[i], byX[i + 1]];
        if (side(p) > side(q)) [p, q] = [q, p];
        out.push([p, -Math.abs(o), lon], [q, Math.abs(o), lon]);
        i += 2;
      } else { out.push([byX[i], o, lon]); i++; }
    }
  });
  const nav = W.nav;
  return out.map(([u, lat, lon]) => {
    let px = x + rx * lat * sp + fx * lon, pz = z + rz * lat * sp + fz * lon;
    const nv = W.navFor ? W.navFor(u) : nav;
    if (!nv.isFree(px, pz)) { const k = nv.nearestFree(nv.idx(px, pz), 6); [px, pz] = nv.center(k); }
    return [u, px, pz];
  });
}
