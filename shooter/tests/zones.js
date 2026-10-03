// Zones test (evaluated in the page): the districts as the game computed them. Returns for every zone the number of
// street cells, the zones that are not separated ("leaks"), every gap in the cut lines (position, width, the zones on
// both sides, pieces of rubble), and the zone of every nav cell (to draw a map: tests/zones_map.py).
(() => {
  const Z = G.zones, nav = G.nav;
  return {
    n: nav.n, cell: nav.cell, half: nav.half,
    zones: Z.list.map((z, i) => ({ id: z.id, cells: Z.report.zones[i] })), leaks: Z.report.leaks,
    gates: Z.gates.map((g) => ({ cut: g.cut, a: g.a, b: g.b, need: g.need, x: Math.round(g.x), z: Math.round(g.z), width: Math.round(g.width), rubble: g.props.length })),
    ownBarricades: (G.level.gateProps || []).length, wallQuads: Z.wallQuads,
    zone: Array.from(Z.zone), walk: Array.from(nav.y, (v) => (v === v ? 1 : 0)), cut: Array.from(Z.cutOf, (v) => (v >= 0 ? 1 : 0)),
  };
})()
