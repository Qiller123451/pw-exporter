// Placement snaps to the nearest green dot (ui/input.js updateGhost, PLACE_SNAP_R): a cursor where the building does not
// fit, a few metres from where it does, puts the preview there. python3 tests/evaljs.py tests/place_snap.js "&tribe=SEAS&enemy=Hu"
const W = G.world, me = G.me, I = G.input, out = [];
const h = G.homeEntity();
G.rtscam.x = h.pos.x; G.rtscam.z = h.pos.z; G.rtscam.dist = G.rtscam.tDist = 80;
G.step(4); G.renderOnce();
const act = G.buildActions().find((a) => a.results[0].obj === 'seas_steelwork');
I.makeGhost(act);
const gh = I.ghost;
// a point just off the headquarters' footprint where the steelwork doesn't fit, with a fitting spot within 8 m
let probe = null;
for (let r = 6; r < 40 && !probe; r += 1) for (let a = 0; a < 6.28 && !probe; a += 0.3) {
  const x = Math.round(h.pos.x + Math.cos(a) * r), z = Math.round(h.pos.z + Math.sin(a) * r);
  if (W.canPlace('seas_steelwork', x, z, gh.rot, me)) continue;
  let near = false;
  const cx = Math.round(x / 2) * 2, cz = Math.round(z / 2) * 2;     // (the dots: a 2 m lattice)
  for (let dx = -6; dx <= 6 && !near; dx += 2) for (let dz = -6; dz <= 6 && !near; dz += 2) if (Math.hypot(cx + dx - x, cz + dz - z) <= 7 && W.canPlace('seas_steelwork', cx + dx, cz + dz, gh.rot, me)) near = true;
  if (near) probe = [x, z];
}
if (!probe) return 'FAIL no probe point';
const s = G.overlay.toScreen(h.pos.clone().set(probe[0], W.height(probe[0], probe[1]), probe[1]));
I.mouse.x = s.x; I.mouse.y = s.y;
I.updateGhost();
const d = Math.hypot(gh.x - probe[0], gh.z - probe[1]);
out.push(`cursor at (${probe}) does not fit; preview at (${gh.x},${gh.z}) ${d.toFixed(1)} m away, ok ${gh.ok}`);
const ok = gh.ok && d > 0 && d <= 8.5 && W.canPlace('seas_steelwork', gh.x, gh.z, gh.rot, me);
I.cancelGhost ? I.cancelGhost() : null;
return (ok ? 'ok ' : 'FAIL ') + out.join(' | ');
