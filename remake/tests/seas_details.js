// The SEAS details of delivery 45 (run: python3 tests/evaljs.py tests/seas_details.js "&tribe=SEAS&enemy=Hu"):
// units are never demoted (NewPyramid.usl SwapSlotsAndCards), the placement preview sprays nothing and its dots
// mark where the building fits, a click picks the unit under the cursor, wall construction stages, a tower onto
// a fence, the turret's muzzle flashes at its gun, the headquarters' name by epoch.
const W = G.world, me = G.me, out = [];
const ok = (c, m) => out.push((c ? 'ok   ' : 'FAIL ') + m);
// 1. no demotion
const u = W.units.find((x) => x.owner === me && x.alive && x.cls !== 'WORK' && !/worker/.test(x.name)) || W.spawnUnit('seas_warrior', me, G.homeEntity().pos.x + 10, G.homeEntity().pos.z + 10);
me.debug = true;
const up = W.changeLevel(u, 2);
const down = W.changeLevel(u, 1);
ok(up === null && down === 'down' && u.level === 2, `a unit goes up, never down (${up}, ${down}, level ${u.level})`);
// 2. the placement preview sprays nothing; 3. its dots
const act = G.buildActions().find((a) => a.results[0].obj === 'seas_steelwork');
G.input.makeGhost(act);
const gh = G.input.ghost;
const nodes = new Set(); gh.obj.traverse((o) => { if (o.userData.kind === 'particles') nodes.add(o); });
const live = G.particles.emitters.filter((x) => x.node && nodes.has(x.node) && !x.dead).length;
ok(nodes.size > 0 && live === 0, `the preview's emitters are dropped (${nodes.size} nodes, ${live} live)`);
const h = G.homeEntity();
gh.x = h.pos.x + 30; gh.z = h.pos.z + 30; gh.obj.visible = true;
G.input.updatePlaceGrid(gh);
const n = gh.grid.geometry.drawRange.count, col = gh.grid.geometry.attributes.color;
let green = 0, agree = 0, tested = 0;
for (let i = 0; i < n; i++) if (col.getY(i) > col.getX(i)) green++;
const pos = gh.grid.geometry.attributes.position;
for (let i = 0; i < n; i += 7) { const x = pos.getX(i), z = pos.getZ(i), g = col.getY(i) > col.getX(i); tested++; if (g === (W.canPlace('seas_steelwork', x, z, gh.rot, me) && G.fow.explored_(x, z))) agree++; }
ok(n > 100 && green > 0 && agree === tested, `placement dots: ${n}, ${green} green; a green dot = the building fits there (${agree}/${tested})`);
G.input.setMode(null);
// 4. picking: the unit under the cursor
G.rtscam.target.set(u.pos.x, u.pos.y, u.pos.z); G.drawNow(0.016);
const v = u.pos.clone(); v.y += u.height * 0.5; const s = G.input.toScreen(v);
ok(G.input.entityAt(s.x, s.y) === u, 'a click on a unit picks it');


// 5. a wall under construction shows its stages (the construction parts A, B, C of the pieces)
{
  const WM = W.wallMap, h2 = G.homeEntity();
  W.completeUpgrade(h2, G.data.actions(me).find((a) => a.id === 'age_2'));
  for (const r of ['food', 'wood', 'stone']) me.res[r] = 5000;
  me.debug = false;
  const fa = G.data.actions(me).find((a) => a.results && a.results[0] && a.results[0].obj === 'seas_fence');
  let ci = null, cj = null;
  for (let r = 50; r < 400 && ci === null; r += 16) for (let a = 0; a < 16 && ci === null; a++) {
    const [i0, j0] = WM.tileOf(h2.pos.x + Math.cos(a / 16 * 6.283) * r, h2.pos.z + Math.sin(a / 16 * 6.283) * r);
    let good = true;
    for (let i = 0; i <= 3; i++) { const [x, z] = WM.centre(i0 + i, j0); if (!W.canPlace('seas_fence', x, z, 0, me)) good = false; }
    if (good) { ci = i0; cj = j0; }
  }
  const [x0, z0] = WM.centre(ci, cj), [x1, z1] = WM.centre(ci + 3, cj);
  G.placeWall(fa, W.wallLine(me, fa, x0, z0, x1, z1, []), []);
  const piece = WM.at(ci + 1, cj) && WM.at(ci + 1, cj).wall;
  const seen = (L) => { piece.progress = L / 4 + 0.05; piece.updateVisual(); let c = 0; piece.model.traverse((o) => { if (o.isMesh && o.visible) { let v = true; for (let x = o.parent; x && x !== piece.obj; x = x.parent) if (!x.visible) v = false; if (v) c++; } }); return c; };
  const counts = piece && !piece.built ? [0, 1, 2, 3].map(seen) : null;
  ok(!!counts && counts.every((c) => c > 0), 'a wall piece under construction shows a stage at every level ' + JSON.stringify(counts));
  // a tower on the fence: its tile, from the ground beside the piece
  const [tx, tz] = WM.centre(ci + 2, cj);
  const pt = W.placement('seas_turret_tower', tx + 1.5, tz - 1.5, 0.5, me);
  ok(pt.ok && pt.x === tx && pt.z === tz, 'a SEAS tower goes onto a fence piece');
}
// 6. the turret's muzzle flashes follow its gun (gsf.py: the particle animation keys)
{
  const h3 = G.homeEntity();
  const tw = W.placeBuilding('seas_turret_tower', me, h3.pos.x - 40, h3.pos.z - 40, 0, true);
  G.step(5);
  const p = tw.turret;
  const node = (re) => { let n = null; p.obj.traverse((o) => { if (!n && re.test(o.name)) n = o; }); return n; };
  const fl = node(/muzzle_flash_01/), gun = node(/^bone_1d433446/);
  if (p.anim) { p.anim.play(p.attackAnim || 'attack_front', { restart: true }); for (let i = 0; i < 5; i++) p.anim.update(0.05); }
  const a = fl && fl.getWorldPosition(fl.position.clone()), b = gun && gun.getWorldPosition(gun.position.clone());
  ok(!!a && !!b && a.distanceTo(b) < 1.5, 'the turret\'s muzzle flash is at its gun while it fires ' + (a && b ? a.distanceTo(b).toFixed(2) : ''));
}
// 7. the SEAS headquarters is called after the epoch the player has reached
{
  const hq = W.buildings.find((b) => b.alive && b.owner === me && b.name === 'seas_headquarters');
  ok(!!hq && /2/.test(G.data.text(hq.name, me).name) && hq.age === 2, 'the headquarters: "' + (hq && G.data.text(hq.name, me).name) + '", epoch look ' + (hq && hq.age));
}
return out.join('\n');
