// Wild animals look wild (game/compose.js updateMask, miscShown; MIRAGE Animal.OnInit / FightingObj.ShowAnmlMiscFlag):
// no saddle, party colour or tack - also when a player owns one (the sequel's outbreak, a captured animal) - and of
// their "misc" parts only those that belong to the beast (stegosaurus plates, the mammoth's coat). Tamed ones keep
// their harness. python3 tests/evaljs.py tests/wild_looks.js "&tribe=Hu&enemy=Aje"
const W = G.world, me = G.me, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const hq = W.buildings.find((b) => b.owner === me);
const enemy = W.players.find((p) => p !== me && p.tribe);
const shown = (u) => { const s = new Set(); u.model.traverse((o) => { if (o.isMesh && o.visible && o.userData.attr !== undefined) { const a = o.userData.attr >>> 0; for (const b of [5, 6, 7, 8, 9, 10, 11]) if ((a >>> b) & 1) s.add(b); } }); return [...s].sort((a, b) => a - b); };
let i = 0;
const at = (name, owner) => W.spawnUnit(name, owner, hq.pos.x + 30 + (i % 4) * 14, hq.pos.z - 20 + Math.floor(i++ / 4) * 18, 1);
const wild = ['Brachiosaurus', 'Parasaurolophus', 'Ankylosaurus', 'Triceratops'].map((n) => at(n, null));
const owned = ['Brachiosaurus', 'Parasaurolophus'].map((n) => at(n, enemy));
const beast = ['Stegosaurus', 'Mammoth'].map((n) => at(n, null));
const tamed = at('hu_mammoth', me);
G.step(5, 0.05);
const bad = [...wild, ...owned].filter((u) => shown(u).length).map((u) => u.name + (u.owner ? '(owned)' : '') + ':' + shown(u));
check('wild animals wear no tack, owned or not', !bad.length, bad);
check('nor riders', owned.every((u) => !u.comp.parts.length));
check('their own misc parts stay (stegosaurus plates, mammoth coat)', beast.every((u) => shown(u).includes(11)), beast.map((u) => u.name + ':' + shown(u)));
check('a tamed animal keeps its saddle and colours', shown(tamed).includes(6), shown(tamed));
return out.join('\n');
