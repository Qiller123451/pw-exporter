// A destroyed ship leaves its wreck (Ship.usl Die -> CreateShipCorpse, MiscObj.usl CUniversalCorpse): the model
// "<gfx>_dest" at destruction level 2 plays its sink animation "destroy" once and is gone after 10 s; the ship itself is
// out at once. A turtle (a ship that is an animal) keeps its own model and dying animation.
//   python3 tests/evaljs.py tests/ship_wreck.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/multi_2_jun_001.ula"
const W = G.world, me = G.me, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const h = G.homeEntity();
let sx = null, sz = null;
for (let r = 20; r < 500 && sx === null; r += 6) for (let a = 0; a < 32; a++) { const x = h.pos.x + Math.cos(a / 32 * 6.283) * r, z = h.pos.z + Math.sin(a / 32 * 6.283) * r; if (W.waterNav && !W.waterNav.block[W.waterNav.idx(x, z)]) { sx = x; sz = z; break; } }
ok(sx !== null, 'open water near the village');
const ship = W.spawnUnit('hu_transport_ship', me, sx, sz, 1, 0);
ok(!!ship, 'a Norse transport ship');
if (ship) {
  G.step(5, 0.05);
  W.kill(ship, null);
  const wr = ship.wreck;
  ok(!!wr && !!wr.obj.parent && !ship.obj.visible, 'its wreck stands in for it (hu_transport_ship_dest)', wr && { anim: wr.anim && wr.anim.curName });
  ok(!!wr && !!wr.anim && wr.anim.curName === 'destroy', 'playing the sink animation "destroy"', wr && wr.anim && wr.anim.curName);
  for (let i = 0; i < 6; i++) G.step(20, 0.05);
  ok(!!wr && !!wr.obj.parent && !ship.removed, 'still there after 6 s');
  for (let i = 0; i < 6; i++) G.step(20, 0.05);
  ok(ship.removed && (!wr || !wr.obj.parent), 'gone after 10 s');
}
const turtle = W.spawnUnit('aje_transport_turtle', W.players.find((p) => p !== me && p.tribe === 'Aje') || me, sx, sz, 1, 0);
if (turtle) { G.step(5, 0.05); W.kill(turtle, null); ok(!turtle.wreck && turtle.obj.visible !== false, 'a transport turtle dies with its own model', turtle.anim && turtle.anim.curName); }
return out.join('\n');
