// Scenery stands in the way with its model's pathfinder boxes only; a model without any blocks nothing on an original
// map (its walk grid holds the rest): mission 8's ice arch is walked under (main.js decor, game/prop.js pfCells).
//   python3 tests/evaljs.py tests/scenery_block.js "&campaign=8&tribe=Ninigi"
const C = G.campaign, W = G.world, nav = W.nav, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const [ax, az] = C.toGame(278, 1149);                       // Ice_Bridge_01
const mine = W.units.filter((u) => u.alive && u.owner === G.me);
const u = mine.reduce((a, b) => (Math.hypot(b.pos.x - ax, b.pos.z - az) < Math.hypot(a.pos.x - ax, a.pos.z - az) ? b : a));
ok(nav.isFree(ax, az), 'the ground under the ice arch is free');
const vx = ax - u.pos.x, vz = az - u.pos.z, L = Math.hypot(vx, vz);
nav.find(u.pos.x, u.pos.z, ax + vx / L * 30, az + vz / L * 30, 0.7, 60000, G.me);
ok(nav.found, 'the heroes find the way through the arch', u.name);
// rocks keep blocking with their boxes
let blockedRocks = 0, rocks = 0;
for (const o of C.objects.all) if (o.prop && /rock|plateau/i.test(o.prop.model || '')) { rocks++; if (o.prop.cells && o.prop.cells.length) blockedRocks++; }
out.push(`   rocks placed as props: ${rocks}, blocking: ${blockedRocks}`);
return out.join('\n');
