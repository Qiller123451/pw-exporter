// The Aje's floating harbour counts in the unit limit and has a card in the army pyramid (CSwimmingHarbour.
// DoesCountInUnitLimit, Building.OnInit AddUnit); the card can't be levelled or dragged.
//   python3 tests/evaljs.py tests/pyramid_harbour.js "&tribe=Aje&enemy=Hu"
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const n0 = me.units, l0 = me.atLevel[0];
const h = G.homeEntity();
const b = W.placeBuilding('aje_floating_harbour', me, h.pos.x + 40, h.pos.z + 40, 0, false);
check('a floating harbour site counts in the unit limit', !!b && b.countsInPop && me.units === n0 + 1 && me.atLevel[0] === l0 + 1, [n0, me.units]);
G.hud.pyrKey = ''; G.hud.refreshPyramid();
check('it has a card on the first row of the pyramid', G.hud.cardUnits[0].includes(b));
const other = W.placeBuilding('aje_tent', me, h.pos.x - 40, h.pos.z - 40, 0, true);
check('other buildings do not count', !other.countsInPop && me.units === n0 + 1);
W.kill(b, null);
check('destroyed: out of the count', me.units === n0 && me.atLevel[0] === l0, me.units);
return out.join('\n');
