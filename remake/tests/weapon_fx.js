// Weapon effects (emitters with attribute bit 16: muzzle flashes and shells of the turrets and guns, the gatlings',
// flamers' and staffs' effects) spray only while their wielder attacks: a SEAS turret tower without enemies shows no
// fire. python3 tests/evaljs.py tests/weapon_fx.js "&tribe=SEAS&enemy=Hu"
const W = G.world, me = G.me, P = G.particles, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const hq = W.buildings.find((b) => b.alive && b.owner === me && b.def.script !== 'CWall');
const x = hq.pos.x + hq.radius + 14, z = hq.pos.z;
const tw = W.placeBuilding('seas_turret_tower', me, x, z, 0, true);
G.rtscam.x = x; G.rtscam.z = z; G.rtscam.update(0);
const frames = (n) => { for (let i = 0; i < n; i++) { G.step(1, 0.05); P.update(0.05, G.camera, G.rtscam.target, 1); } };
frames(40);
const fx = P.emitters.filter((e) => e.fire && e.node && Particles_under(e.node, tw.obj));
function Particles_under(n, root) { for (let o = n; o; o = o.parent) if (o === root) return true; return false; }
const live = () => fx.reduce((a, e) => a + e.parts.length, 0);
check('the turret has weapon emitters', fx.length >= 8, fx.length);
check('no fire without an enemy', live() === 0, live());
// an enemy in range: the turret shoots and its muzzle flashes
const foe = W.players.find((p) => p !== me && !me.isFriend(p) && p.tribe);
const u = W.spawnUnit('hu_warrior', foe, x + 18, z, 1);
let seen = 0;
for (let i = 0; i < 160 && !seen; i++) { frames(1); seen = live(); }
check('it flashes while it shoots', seen > 0, { flashes: seen, foe: u && Math.round(u.hp) });
if (u) u.hp = 0;
frames(80);
check('and stops after', live() === 0, live());
return out.join('\n');
