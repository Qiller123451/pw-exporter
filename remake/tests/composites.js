// Attached parts from the composites table (game/compose.js): run with
//   python3 tests/evaljs.py tests/composites.js "&tribe=Hu&enemy=Aje"
// spawns units / buildings with multi-part looks and lists the parts they show.
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const h = G.homeEntity();
const x0 = h.pos.x + 30, z0 = h.pos.z + 30;
const partsOf = (u) => (u.comp ? u.comp.parts : u.parts || []).map((p) => p.spec.gfx + '@' + p.spec.link);
const want = {
  Hu: { hu_triceratops: ['hu_rhino_ballista_buildup_top@con2', 'hu_rhino_ballista_buildup_top@con3', 'hu_titan_transporter_buildup@con'],
        hu_rhino_ballista: ['hu_rhino_ballista_buildup_top@we'], hu_mammoth_log_cannon: ['hu_mammoth_log_cannon_buildup_top@con'],
        hu_steam_tank: ['hu_rhino_ballista_buildup_top@we'], hu_mammoth: ['hu_rider_b@Ride'] },
  Aje: { aje_resource_collector: ['aje_resource_collector_drawbar@Db_1'], aje_allosaurus: ['aje_rider_b@Ride'] },
  SEAS: { seas_wehrspinne: ['seas_wehrspinne_top@we', 'seas_rider_b@Dri1'] },
  Ninigi: { ninigi_seismosaurus: ['ninigi_parasaurolophus_gatling@con2', 'ninigi_parasaurolophus_gatling@con3'] },
}[me.tribe] || {};
let i = 0;
for (const [n, parts] of Object.entries(want)) {
  const u = W.spawnUnit(n, me, x0 + (i % 4) * 14, z0 + Math.floor(i / 4) * 14, 1); i++;
  if (!u) { check(n + ' spawns', false); continue; }
  const got = partsOf(u);
  check(n + ' parts', parts.every((p) => got.some((g) => g.startsWith(p.split('@')[0]) && g.endsWith('@' + p.split('@')[1]))), got);
}
if (me.tribe === 'Hu') {
  // ballista tower: the large tower after hu_ballista_upgrade shows the ballista on "we"
  const b = W.placeBuilding('hu_large_tower', me, x0 + 60, z0, 0, true);
  W.entityFilters && W.entityFilters(b, true);
  check('large tower: no ballista before the upgrade', !partsOf(b).length, partsOf(b));
  me.tt.enable('Hu/Upgrades/hu_large_tower/hu_ballista_upgrade');
  b.refreshRules();
  check('ballista tower shows the ballista', partsOf(b).some((p) => p.startsWith('hu_large_tower_upgrade_balista@we')), { gfx: b.gfx, parts: partsOf(b) });
  check('ballista tower aims with its turret', !!b.turret);
}
G.step(20);
return out.join('\n');
