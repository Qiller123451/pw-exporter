// The fixes of delivery 48 for the tribe of the game (run once per tribe: "&tribe=Hu|Aje|Ninigi|SEAS&enemy=..."): the wall
// placer's towers / gates / traps, the gate hints of the wall preview, towers shooting at buildings, box selection
// of buildings, and that the production / build menus show every action they offer (no subcategory without a row).
const me = G.me, W = G.world, D = G.data, WM = W.wallMap, out = [];
const ok = (c, m) => out.push((c ? 'ok   ' : 'FAIL ') + m);
const h = G.homeEntity();
const acts = G.buildActions();
const kindOf = (a) => (D.def(a.results[0].obj, me) || {}).wallKind;
const wallA = acts.find((a) => kindOf(a) === 'wall' && !/ladder|stair/i.test(a.results[0].obj));
const towers = acts.filter((a) => kindOf(a) === 'tower');
const ladders = acts.filter((a) => (D.def(a.results[0].obj, me) || {}).ladder);
const traps = acts.filter((a) => kindOf(a) === 'trap');
out.push(`tribe ${me.tribe}: wall ${wallA && wallA.results[0].obj}, towers ${towers.map((a) => a.results[0].obj).join(',') || '-'}, traps ${traps.map((a) => a.results[0].obj).join(',') || '-'}, ladders ${ladders.map((a) => a.results[0].obj).join(',') || '-'}`);
// a free straight run of 8 tiles near the headquarters
let ci = null, cj = null;
for (let r = 30; r < 90 && ci === null; r += 6) for (let a = 0; a < 16 && ci === null; a++) {
  const [i0, j0] = WM.tileOf(h.pos.x + Math.cos(a / 16 * 6.283) * r, h.pos.z + Math.sin(a / 16 * 6.283) * r);
  let good = true;
  for (let i = -1; i <= 8; i++) { const [x, z] = WM.centre(i0 + i, j0); if (!wallA || !W.canPlace(wallA.results[0].obj, x, z, 0, me)) good = false; }
  if (good) { ci = i0; cj = j0; }
}
if (!wallA) ok(false, 'a wall build action');
else if (ci === null) ok(false, 'a free run for a wall');
else {
  const [x0, z0] = WM.centre(ci, cj), [x1, z1] = WM.centre(ci + 7, cj);
  const line = W.wallLine(me, wallA, x0, z0, x1, z1, []) || [];
  const hints = line.filter((t) => t.gateOK).length;
  ok(line.length >= 8 && hints > 0, `the wall preview shows gate places: ${hints} of ${line.length} tiles`);
  G.placeWall(wallA, line, []);
  for (const tA of towers) {
    const n = tA.results[0].obj, [tx, tz] = WM.centre(ci + 3, cj);
    const pt = W.placement(n, tx + 1.2, tz - 1.2, 0.5, me);
    ok(pt.ok && pt.x === tx && pt.z === tz, `${n} goes onto a wall piece (snaps to its tile)`);
    // and stands on free ground too (a tower is a joint of the wall map, not only part of a wall)
    let free = null;
    for (let r = 20; r < 80 && !free; r += 5) for (let a = 0; a < 12 && !free; a++) { const x = h.pos.x - Math.cos(a / 12 * 6.283) * r, z = h.pos.z - Math.sin(a / 12 * 6.283) * r; const p = W.placement(n, x, z, 0, me); if (p.ok) free = p; }
    ok(!!free, `${n} also stands on free ground`);
  }
  // a ladder / siege staircase goes against a wall piece
  for (const lA of ladders) {
    const n = lA.results[0].obj; let li = ci; for (let i = ci; i <= ci + 7; i++) { const t = WM.at(i, cj); if (t && t.wall && t.wall.alive && !t.tower) { li = i; } }
    const [lx, lz] = WM.centre(li, cj);
    const pl = W.placement(n, lx, lz + 3, 0, me);
    ok(pl.ok && !!pl.dock, `${n} goes against a wall piece (${JSON.stringify(pl).slice(0, 80)}, piece ${!!(WM.at(li, cj) || {}).wall})`);
  }
  // traps go down as lines on the wall map
  for (const tA of traps.slice(0, 1)) {
    const n = tA.results[0].obj, [ax, az] = WM.centre(ci, cj + 4), [bx, bz] = WM.centre(ci + 2, cj + 4);
    const tl = W.wallLine(me, tA, ax, az, bx, bz, []) || [];
    ok(tl.length >= 1 && tl.some((t) => t.state === 'ok' || t.state === 'cost'), `${n} goes down as a line (${tl.length} tiles: ${[...new Set(tl.map((t) => t.state))].join(',')})`);
  }
}
// a tower shoots at an enemy building it was told to
const foe = W.players.find((p) => p !== me && me.isEnemy(p));
// (a bunker shoots only with characters inside: CBunker)
const shooter = towers.map((a) => a.results[0].obj).find((n) => { const d = D.def(n, me); return d && d.script !== 'CBunker' && D.stats(n, 1, me); });
if (shooter && foe) {
  const put = (name, owner, dx, dz) => { for (let k = 0; k < 30; k++) { const b = W.placeBuilding(name, owner, h.pos.x + dx + k * 3, h.pos.z + dz, 0, true); if (b) return b; } return null; };
  const tw = put(shooter, me, 40, -30), en = put(foe.tribe === 'Hu' ? 'hu_small_tower' : 'hu_small_tower', foe, 60, -30);
  if (tw && en) {
    tw.progress = 1; W.finishBuilding(tw, []); en.progress = 1; W.finishBuilding(en, []);
    const aimed = W.canAimTower(tw) && W.aimTowers([tw], en);
    const h0 = en.hp; G.step(300);
    ok(!W.canAimTower(tw) || (aimed && en.hp < h0), `${shooter} told to shoot an enemy building: aimed ${!!aimed}, hp ${Math.round(h0)} -> ${Math.round(en.hp)} (can aim ${W.canAimTower(tw)})`);
    // box selection of the two own buildings (no units in the box)
    G.select([]);
    const r1 = G.input.pickRect(tw);
    if (r1) {
      const cv = G.canvas || document.querySelector('canvas');
      const drag = (a, b, c, d) => { cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, clientX: a, clientY: b, bubbles: true })); for (let k = 1; k <= 5; k++) window.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: a + (c - a) * k / 5, clientY: b + (d - b) * k / 5 })); window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: c, clientY: d })); };
      for (const u of W.units) if (u.owner === me && Math.hypot(u.pos.x - tw.pos.x, u.pos.z - tw.pos.z) < 30) { u.pos.x += 200; u.syncObj && u.syncObj(); }
      G.rtscam.x = tw.pos.x; G.rtscam.z = tw.pos.z; G.rtscam.dist = G.rtscam.tDist = 70; G.step(4); G.renderOnce();
      const r = G.input.pickRect(tw);
      if (r) { drag(r.x0 - 15, r.y0 - 15, r.x1 + 15, r.y1 + 15); ok([...G.sel].includes(tw), `box selection takes the own ${shooter} (${[...G.sel].map((e) => e.name).join(',')})`); }
    }
  } else out.push(`(no room for the tower test: ${!!tw} ${!!en})`);
}
// every action of a producing building / of the workers shows in a row of the menu
const missing = [];
for (const name of new Set(D.actions(me).flatMap((a) => (a.locs || []).map((l) => l.at)))) {
  const def = D.def(name, me);
  if (!def || def.type !== 'BLDG') continue;
  const e = { alive: true, built: true, owner: me, kind: 'building', name, def, cls: 'BLDG', rulesOwner: () => me, queue: [], pos: h.pos };
  let shown = 0, offered = 0;
  try { offered = G.producerActions(e).length; G.hud.menu = 'produce'; shown = G.hud.menuRows([e]).reduce((s, [, l]) => s + l.length, 0); } catch (x) { missing.push(name + ' ' + x.message); continue; }
  if (shown < offered) missing.push(`${name} ${shown}/${offered}`);
}
const ba = G.buildActions().length; G.hud.menu = 'build';
const w0 = W.units.find((u) => u.alive && u.owner === me && u.canBuild);
const bs = w0 ? G.hud.menuRows([w0]).reduce((s, [, l]) => s + l.length, 0) : ba;
ok(!missing.length && bs >= ba, `every production / build action has a row (${missing.join('; ') || 'all'}; build ${bs}/${ba})`);
return out.join('\n');
