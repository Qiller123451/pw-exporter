// MIRAGE's ACDO WeaponRemove (World.setDisarmed; campaign/actions.js): a disarmed tower stops shooting, a disarmed
// unit stops fighting, "Timer: s" arms them again after s seconds. python3 tests/evaljs.py tests/disarm.js "&tribe=SEAS&enemy=Hu"
const me = G.me, W = G.world, out = [];
const hq = W.buildings.find((b) => b.owner === me && /headquarters/.test(b.name));
const foe = W.players.find((p) => p !== me && me.isEnemy(p));
const tw = W.placeBuilding('hu_small_tower', foe, hq.pos.x + 50, hq.pos.z, 0, true);
tw.progress = 1; W.finishBuilding && W.finishBuilding(tw, []);
const u = W.spawnUnit('seas_gunner', me, hq.pos.x + 38, hq.pos.z, 3, 0); u.invulnT = 1e9;
let shots = 0, ushots = 0; const L = W.launch.bind(W); W.launch = (src, ...a) => { if (src === tw) shots++; if (src === u) ushots++; return L(src, ...a); };
const TD = W.takeDmg.bind(W); W.takeDmg = (A, ...a) => { if (A === u) ushots++; return TD(A, ...a); };   // (shots or blows)
W.setDisarmed(tw, true); W.setDisarmed(u, true, 6);
const engaged = W.engage(u, tw, { defend: true });
G.step(80);
const a = [shots, ushots, engaged ? 'fights' : 'no fight'];
G.step(80); G.order([u], { type: 'attack', target: tw }); G.step(120);
const b = [shots, ushots];
W.setDisarmed(tw, false); shots = 0; G.step(100);
W.launch = L; W.takeDmg = TD;
const ok = a[0] === 0 && a[1] === 0 && a[2] === 'no fight' && b[1] > 0 && shots > 0;
return (ok ? 'ok ' : 'FAIL ') + `disarmed 4 s: tower ${a[0]} unit ${a[1]} (${a[2]}) | unit's 6 s timer over, ordered: unit ${b[1]} | tower armed again: ${shots}`;
