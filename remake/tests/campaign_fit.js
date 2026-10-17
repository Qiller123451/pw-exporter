// Buildings of the player's tribe in a mission made for another tribe (campaign/setup.js fit): no two buildings
// share a ground cell, whatever their sizes. Run per mission and tribe:
//   python3 tests/evaljs.py tests/campaign_fit.js "&campaign=3&tribe=SEAS"
const W = G.world, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const C = G.campaign;
check('the mission is set up', !!C && C.counts && C.counts.buildings > 0, C && C.counts);
const blds = W.buildings.filter((e) => e.alive && !(e.def && e.def.wallKind));
const owner = new Map();
const clash = [];
for (const b of blds) {
  for (const k of W.footprint(b.name, b.pos.x, b.pos.z, b.rot || 0, false, b.owner).cells) {
    const o = owner.get(k);
    if (o && o !== b) clash.push([o.name, b.name]); else owner.set(k, b);
  }
}
const pairs = [...new Set(clash.map((p) => p.join(' / ')))];
const mine = blds.filter((b) => b.owner === G.me);
check('the player has buildings', mine.length > 0, { buildings: mine.length, tribe: G.me.tribe, classes: [...new Set(mine.map((b) => b.name))].slice(0, 12) });
check('no two buildings overlap', !pairs.length, pairs.slice(0, 8));
return out.join('\n');
