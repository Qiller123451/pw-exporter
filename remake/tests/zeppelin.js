// The trader's zeppelin of the campaign (missions 3, 4, 13; Vehicle.usl CFlyingTraderObj): it flies at its map height,
// cannot be selected, hit nor damaged, is not in the unit limit, flies straight to a walk's point and its height at the
// walk's speed (m/s) and always plays its stand animation.
//   python3 tests/evaljs.py tests/zeppelin.js "&campaign=3&notriggers"   (no mission script: its own walks would cut in)
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const z = W.units.find((u) => /flyingtrader/i.test(u.name));
ok(!!z, 'mission 3 has the zeppelin', z && z.name);
if (!z) return out.join('\n');
const alt = () => W.height(z.pos.x, z.pos.z) + (z.liftH || 0);
ok(Math.abs(alt() - 21.47) < 1, 'it starts at its map height', +alt().toFixed(1));
ok(z.flying && z.unselectable && z.untargetable && !z.countsInPop, 'flies, not selectable, not a target, not in the unit limit');
const hp = z.hp; W.damage(z, 1000, null); ok(z.hp === hp, 'takes no damage', z.hp);
// a walk of the mission: to a point 40 m away, 30 m higher, at 3 m/s
const x = z.pos.x + 40, zz = z.pos.z, a1 = alt() + 30;
G.order([z], { type: 'move', x, z: zz, auto: true, alt: a1, flySpeed: 3 });
const p0 = z.pos.clone();
G.step(50, 0.1);
const v = Math.hypot(z.pos.x - p0.x, z.pos.z - p0.z) / 5;
ok(v > 2.5 && v < 3.3 && z.anim.curName === z.idleAnim, 'flies at the walk\'s speed, playing its stand animation', { v: +v.toFixed(2), anim: z.anim.curName });
G.step(150, 0.1);
ok(Math.hypot(z.pos.x - x, z.pos.z - zz) < 1.5 && Math.abs(alt() - a1) < 1, 'arrives at the point and its height', { d: +Math.hypot(z.pos.x - x, z.pos.z - zz).toFixed(2), alt: +alt().toFixed(1), want: +a1.toFixed(1) });
return out.join('\n');
