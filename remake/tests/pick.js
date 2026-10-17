// Click range of buildings (ui/input.js pickHit): the SEAS headquarters is picked on its walls, not on the ground in
// front of it; units and bushes next to it stay clickable. python3 tests/evaljs.py tests/pick.js "&tribe=SEAS&enemy=Hu"
const I = G.input, me = G.me, W = G.world;
const hq = G.world.buildings.find((b) => b.owner === me && /headquarters/.test(b.name));
G.rtscam.x = hq.pos.x; G.rtscam.z = hq.pos.z; G.rtscam.dist = G.rtscam.tDist = 70;
G.step(5, 0.05);
G.renderOnce && G.renderOnce();
const r = I.pickRect(hq);
let hits = 0, other = {}, tot = 0;
for (let y = 0; y < window.innerHeight; y += 8) for (let x = 0; x < window.innerWidth; x += 8) {
  const e = I.entityAt(x, y);
  if (e === hq) hits++;
  else if (e) other[e.name || e.type] = (other[e.name || e.type] || 0) + 1;
  tot++;
}
// the middle of the house picks it; the ground 12 m in front of its door does not
const scr = (x, y, z) => { const v = hq.pos.clone(); v.set(x, y, z); return G.overlay.toScreen(v); };
const mid = scr(hq.pos.x, hq.pos.y + 6, hq.pos.z), front = scr(hq.pos.x, W.height(hq.pos.x, hq.pos.z + 13), hq.pos.z + 13);
const ok = I.entityAt(mid.x, mid.y) === hq && I.entityAt(front.x, front.y) !== hq && hits < r.area / 64 && Object.keys(other).length > 0;
return (ok ? 'ok' : 'FAIL') + ` pick: ${hq.name} on ${hits} of ${tot} screen cells (its screen box ${Math.round(r.area / 64)}), others ${JSON.stringify(other)}`;
