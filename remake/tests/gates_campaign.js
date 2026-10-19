// Gates of the campaign maps: the old two-tile gates (on a tile edge or corner) take both tiles of the wall grid and
// the walls on both sides reach into them; a gate model shows only its leaves the open / close clips move (render flag
// 16; the flag-14 leaves modelled standing open are the level editor's); walls and gates handed over in a mission
// played with another tribe become that tribe's in the same places, a gate with its state.
//   python3 tests/evaljs.py tests/gates_campaign.js "&campaign=1&notriggers&tribe=SEAS"
const C = G.campaign, W = G.world, M = W.wallMap, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const gates = W.buildings.filter((b) => b.alive && b.name === 'hu_palisade_gate');
ok(gates.length >= 3, 'mission 1 has its Norse gates', gates.length);
const g = gates[0];
let f14 = 0;
g.obj.traverse((o) => { if (o.isMesh && o.visible && o.userData.attr !== undefined && ((o.userData.attr >>> 14) & 1) && !((o.userData.attr >>> 16) & 1)) f14++; });
ok(f14 === 0, 'no leaf standing open on a gate (render flag 14)', f14);
ok(gates.every((b) => b.tile && b.tile2 && M.at(...b.tile).gate === b && M.at(...b.tile2).gate === b), 'each old gate takes two tiles', gates.map((b) => [b.tile, b.tile2]));
// the wall pieces next to a gate reach into it
let arms = 0, next = 0;
for (const b of gates) for (const [i, j] of [b.tile, b.tile2]) for (let d = 0; d < 8; d++) {
  const DX = [-1, 0, 1, 1, 1, 0, -1, -1], DZ = [-1, -1, -1, 0, 1, 1, 1, 0];
  const t = M.at(i + DX[d], j + DZ[d]);
  if (!t || !t.wall) continue;
  next++;
  const rel = M.visualRel(i + DX[d], j + DZ[d]);
  if (rel && rel[(d + 4) & 7] !== 255 && rel[(d + 4) & 7] != null && rel[(d + 4) & 7] >= 0) arms++;
}
ok(next > 0 && arms === next, 'the walls beside a gate reach into it', { next, arms });
// handed over in a mission played as SEAS: the prison village (OCPY in "bela_worker_ready")
const reg = C.regions.find('prison_complete_area');
let slot = 0; for (let s = 0; s < 8; s++) if (C.player(s) === C.human) { slot = s; break; }
const inReg = gates.filter((b) => reg.contains(b.pos.x, b.pos.z));
W.setGate(inReg[0], 0);
const before = inReg.map((b) => ({ x: b.origin.x, z: b.origin.z, rot: b.rot, st: b.gateState }));
for (const r of [...C.objects.guids.values()]) { const e = r.entity; if (e && e.alive && e.kind === 'building' && reg.contains(e.pos.x, e.pos.z)) C.setOwner(r, slot); }
const sg = W.buildings.filter((b) => b.alive && b.name === 'seas_gate');
const match = before.filter((o) => sg.some((b) => Math.hypot(b.origin.x - o.x, b.origin.z - o.z) < 0.5 && Math.abs(Math.cos(b.rot - o.rot)) > 0.99 && b.gateState === o.st));
ok(sg.length === before.length && match.length === before.length, 'the gates became SEAS gates in the same places and turns, with their state', sg.map((b) => [Math.round(b.origin.x), Math.round(b.origin.z), +b.rot.toFixed(2), b.gateState]));
const used = new Map();
let clash = 0;
for (const b of W.buildings) if (b.alive && b.def.wallKind && b.tile) { for (const t of [b.tile, b.tile2]) { if (!t) continue; const k = t + '|' + b.def.wallKind; if (used.has(k)) clash++; used.set(k, b); } }
ok(clash === 0, 'no two wall pieces or gates on one tile', clash);
// a gate the player builds lets units through (its passable cells: the built hook)
const site = W.buildings.find((b) => b.alive && b.name === 'seas_gate');
const cells = [...W.nav.gateAt.entries()].filter(([, b]) => b === site).length;
ok(cells > 0, 'the converted gate has its passable cells', cells);
return out.join('\n');
