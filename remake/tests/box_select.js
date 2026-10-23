// Box selection (ui/input.js onUp): own units in the box are selected; a box with no units takes the own buildings
// (not wall pieces). python3 tests/evaljs.py tests/box_select.js "&tribe=SEAS&enemy=Hu"
const I = G.input, me = G.me, W = G.world, out = [];
const hq = W.buildings.find((b) => b.owner === me && /headquarters/.test(b.name));
for (const u of W.units) if (u.owner === me) { u.setPath && u.setPath(hq.pos.x - 60, hq.pos.z - 60); }
const put = (name, dx, dz) => { const b = W.placeBuilding(name, me, hq.pos.x + dx, hq.pos.z + dz, 0, true); b.progress = 1; W.finishBuilding && W.finishBuilding(b, []); return b; };
const t1 = put('seas_turret_tower', 30, 0), t2 = put('seas_turret_tower', 30, 14);
for (const u of W.units) if (u.owner === me) { u.pos.x = hq.pos.x - 60; u.pos.z = hq.pos.z - 60; u.obj && u.obj.position.copy(u.pos); }
G.rtscam.x = hq.pos.x + 30; G.rtscam.z = hq.pos.z + 7; G.rtscam.dist = G.rtscam.tDist = 70;
G.step(10); G.renderOnce();
const cv = G.canvas || document.querySelector('canvas');
const r1 = I.pickRect(t1), r2 = I.pickRect(t2);
const x0 = Math.min(r1.x0, r2.x0) - 10, y0 = Math.min(r1.y0, r2.y0) - 10, x1 = Math.max(r1.x1, r2.x1) + 10, y1 = Math.max(r1.y1, r2.y1) + 10;
const drag = (a, b, c, d) => {
  cv.dispatchEvent(new MouseEvent('mousedown', { button: 0, buttons: 1, clientX: a, clientY: b, bubbles: true }));
  for (let k = 1; k <= 5; k++) window.dispatchEvent(new MouseEvent('mousemove', { buttons: 1, clientX: a + (c - a) * k / 5, clientY: b + (d - b) * k / 5 }));
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: c, clientY: d }));
};
drag(x0, y0, x1, y1);
const sel = [...G.sel];
out.push(`buildings box: ${sel.map((e) => e.name).join(',')}`);
const ok1 = sel.includes(t1) && sel.includes(t2) && sel.every((e) => e.kind === 'building');
// a unit in the box: only units
const u = W.spawnUnit('seas_gunner', me, (t1.pos.x + t2.pos.x) / 2 - 6, (t1.pos.z + t2.pos.z) / 2, 1, 0);
G.step(4); G.renderOnce();
drag(x0, y0, x1, y1);
const sel2 = [...G.sel];
out.push(`with a unit: ${sel2.map((e) => e.name).join(',')}`);
const ok2 = sel2.length >= 1 && sel2.every((e) => e.kind === 'unit');
return (ok1 && ok2 ? 'ok ' : 'FAIL ') + out.join(' | ');
