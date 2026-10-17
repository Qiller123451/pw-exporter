// Transporters (docs/GAMEPLAY_RULES.md "Transports"): the passengers of an open transporter ride on its build-up's
// free "Dri" links (game/compose.js syncPassengers, BuildUpBase.usl CBuildUpTransporterOpen), the passengers' menu
// shows a card per passenger and the empty places, a click on one lets it out (transport.js unloadOne).
// python3 tests/evaljs.py tests/passengers.js "&tribe=Hu&enemy=Aje"   (SEAS: "&tribe=SEAS&enemy=Hu" on MIRAGE's data)
const W = G.world, me = G.me, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const hq = W.buildings.find((b) => b.owner === me);
const x = hq.pos.x + 30, z = hq.pos.z + 10;
const [tName, pName] = me.tribe === 'SEAS' ? ['seas_triceratops_transporter', 'seas_marksman'] : ['hu_rhino_transporter', 'hu_archer'];
const t = W.spawnUnit(tName, me, x, z, 1);
check('the transporter has seats for its passengers', t && t.comp.seats.length >= W.capacity(t), t && { seats: t.comp.seats.length, cap: W.capacity(t) });
const pax = [];
for (let i = 0; i < W.capacity(t); i++) { const u = W.spawnUnit(pName, me, x + 4 + i, z + 4, 1); if (W.canBoard(u, t)) { W.enterTransport(u, t); pax.push(u); } }
G.step(10, 0.05);
const v = t.pos.clone(), up = [];
for (const r of t.comp.riding) { r.obj.getWorldPosition(v); up.push(+(v.y - t.pos.y).toFixed(1)); }
check('the passengers ride on its back', t.comp.riding.length === pax.length && up.every((y) => y > 2), { riding: t.comp.riding.length, up });
check('their own models stay hidden', pax.every((u) => !u.obj.visible));
// the passengers' menu
G.select([t]); G.hud.cmdKey = null; G.hud.refreshCommands(); G.hud.menu = 'slots'; G.hud.cmdKey = null; G.hud.refreshCommands();
const cards = G.hud.flyout.querySelectorAll('.card:not(.empty)');
check('the menu shows every passenger', cards.length === pax.length, cards.length);
if (cards[0]) cards[0].onclick();
G.step(5, 0.05);
check('a click lets that one out', (t.passengers || []).length === pax.length - 1 && !pax[0].inside && pax[0].obj.visible && t.comp.riding.length === pax.length - 1);
check('its place shows empty', G.hud.flyout.querySelectorAll('.card.empty').length >= 1);
return out.join('\n');
