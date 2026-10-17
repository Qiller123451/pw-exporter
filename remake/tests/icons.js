// Every button and portrait of the player's tribe has its icon (ui/atlas.js iconFor, ui/hud.js): each own object is
// selected alone, its menus opened (build, produce, special) and the cards without a picture listed; what those menus
// make (every building of the tribe, every unit they produce, any epoch) is placed next to the player's objects and
// gets the same treatment; then the portrait of every object on the map. Run per tribe, also in campaign missions
// made for another tribe:
//   python3 tests/evaljs.py tests/icons.js "&campaign=3&tribe=SEAS"
const W = G.world, H = G.hud, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const blank = (el) => !el || !/url\(/.test(el.getAttribute('style') || '');
const missing = new Map();                              // menu card / portrait -> the selected object
const seen = new Set(), makes = new Set();
let cards = 0;
function pass(list) {
  for (const e of list) {
    if (!e || !e.alive || seen.has(e.name)) continue;
    seen.add(e.name);
    G.select([e]);
    for (const m of ['build', 'produce', 'special']) {
      H.menu = m; H.cmdKey = null; H.flyKey = null;
      H.refreshCommands();
      if (H.menu !== m) continue;
      H.flyKey = null; H.refreshFlyout();
      const acts = m === 'build' ? G.buildActions() : m === 'produce' ? G.producerActions(e) : [];
      for (const a of acts) for (const r of a.results || []) if (r.obj) makes.add(r.obj);
      [...H.flyout.querySelectorAll('.card')].forEach((c, i) => {
        cards++;
        const ci = c.querySelector('.ci');
        if (ci && blank(ci)) missing.set(m + ' #' + i + ' ' + (c.title || ''), e.name);
      });
    }
    H.infoKey = null; H.refreshInfo();
    const por = H.infoBody.querySelector('.por');
    if (por && blank(por)) missing.set('portrait', e.name);
  }
}
const mine = [...W.units, ...W.buildings].filter((e) => e.alive && e.owner === G.me);
pass(mine);
const n0 = seen.size;
// what the menus make: placed next to the first own object (twice: the units of the buildings placed in round 1)
const at = mine[0] ? mine[0].pos : { x: 0, z: 0 };
const made = [];
for (let round = 0; round < 2; round++) {
  const todo = [...makes].filter((c) => !seen.has(c) && G.data.info(c));
  const list = todo.map((c, i) => W.spawn(c, G.me, at.x + (i % 8) * 3, at.z + Math.floor(i / 8) * 3, { built: true })).filter(Boolean);
  made.push(...list);
  pass(list);
}
H.menu = null; G.select([]);
check('the player has objects', mine.length > 0, { objects: mine.length, classes: n0, tribe: G.me.tribe });
check('what they make is checked too', seen.size > n0, { classes: seen.size, placed: made.length });
check('every card of their menus and every portrait has a picture', cards > 0 && !missing.size, { cards, missing: [...missing].slice(0, 30) });
for (const e of made) if (e.alive) W.remove ? W.remove(e) : (e.alive = false);
// the portraits of everything else on the map (selecting an enemy or an ally shows it too)
const noPic = new Set();
for (const e of [...W.units, ...W.buildings]) {
  if (!e.alive || seen.has(e.name)) continue;
  G.select([e]); H.infoKey = null; H.refreshInfo();
  const por = H.infoBody.querySelector('.por');
  if (por && blank(por)) noPic.add(e.name);
}
G.select([]);
check('every object on the map has a portrait', !noPic.size, [...noPic].slice(0, 30));
return out.join('\n');
