// The original's tooltips (ui/tooltip.js, docs/TOOLTIPS.md) and minimap (ui/minimap.js, docs/MINIMAP.md).
//   python3 tests/evaljs.py tests/tooltips_minimap.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/the%20river.ula"
const W = G.world, me = G.me, D = G.data, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
G.step(2, 0.1);
const text = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

// ---------------------------------------------------------------- texts
check('help items of H_ui: cb_walk, _stance_0, _hu_drums', D.textKey('cb_walk').name === 'Move' && D.textKey('_stance_0').name === 'Hold position' && D.textKey('_hu_drums').name === 'Drums',
  [D.textKey('cb_walk'), D.textKey('_stance_0'), D.textKey('_hu_drums')].map((t) => t && t.name));
check('bullets without empty lines', !/\n\n/.test(D.textKey('_hu_warrior').medium), D.textKey('_hu_warrior').medium);
check('the string table: the command bar lines', D.ui('_ObjCommandBar_InventionsNeeded') === '• Inventions required:', D.ui('_ObjCommandBar_InventionsNeeded'));
check('an object by its description key: the heroes', D.text('Cole_s0').name === 'Anthony Cole' && /Shotgun/.test(D.text('Cole_s0').lvl[3]), D.text('Cole_s0').lvl);

// ---------------------------------------------------------------- action tooltips
const u = W.units.find((x) => x.owner === me && x.isWorker);
const acts = D.actions(me), act = (id) => { const a = acts.find((x) => x.id === id); return { ...a, loc: a.locs[0] }; };
const cole = text(G.hud.actionTipHtml(act('Cole_s0'), null, [u]));
check('hero: title row with the class icon, level rows 5 .. 1', cole.querySelector('.ttt b').textContent === 'Anthony Cole' && cole.querySelectorAll('.ttl').length === 5 && /Increases HP/.test(cole.querySelector('.ttl').textContent),
  [...cole.children].map((c) => c.className));
check('hero: strengths and the cost row (all four)', cole.querySelectorAll('.ttr').length === 2 && cole.querySelectorAll('.ttr .v').length === 4, cole.innerText);
const rhino = text(G.hud.actionTipHtml(act('hu_rhino'), W.canQueue(me, act('hu_rhino'), u), [u]));
check('requirements: the missing inventions (ids, as the original)', /Inventions required:\s*age_3/.test(rhino.innerText), rhino.innerText);
const short = rhino.querySelectorAll('.ttr .v.bad').length;
check('costs the player can\'t afford are red', short > 0, short);
const age = text(G.hud.actionTipHtml(act('age_2'), null, [u]));
check('epoch: the help item\'s title, the "other" class icon', age.querySelector('.ttt b').textContent === 'Epoch 2' && /tt_class_other|background/.test(age.querySelector('.ttt .ti').getAttribute('style')), age.innerText);

// ---------------------------------------------------------------- the window above the minimap
G.select([u]); G.hud.cmdKey = null; G.hud.update(1);
const walk = [...document.querySelectorAll('.actb')].find((b) => b.dataset.act === 'actbtn_sym_walkto');
// the original's place (Options: tooltips next to what the mouse is over - off)
G.settings.tipNear = false;
walk.onmouseenter();
const tw = G.hud.tip.getBoundingClientRect(), mm = G.hud.mmCanvas.getBoundingClientRect();
check('one window above the minimap, bottom right', tw.bottom <= mm.top + 40 && tw.right > window.innerWidth - 40 && Math.abs(tw.width - 235 * G.hud.s) < 2, { tw, mm });
// the default: next to what the mouse is over - above a button of the bottom bar, right of a pyramid card
G.settings.tipNear = true;
walk.onmouseenter();
const wb = walk.getBoundingClientRect(), t2 = G.hud.tip.getBoundingClientRect();
check('by default next to it: above the command button', t2.bottom <= wb.top + 1 && t2.bottom > wb.top - 40 && t2.left < wb.right && t2.right > wb.left && Math.abs(t2.width - 235 * G.hud.s) < 2, { t2, wb });
G.hud.refreshPyramid();
const card = document.querySelector('.pcard');
if (card) {
  card.onmouseenter();
  const cb = card.getBoundingClientRect(), pb = G.hud.pyr.getBoundingClientRect(), t3 = G.hud.tip.getBoundingClientRect();
  check('a pyramid card: right of the pyramid, by the card, on screen', t3.left >= pb.right && t3.left < pb.right + 20 && t3.top <= cb.bottom && t3.bottom >= cb.top && t3.bottom <= window.innerHeight, { t3, cb, pb });
}
walk.onmouseenter();
check('action button: cb_walk', /Move/.test(G.hud.tip.textContent) && /regardless of attacks/.test(G.hud.tip.textContent), G.hud.tip.textContent);
G.hud.hideTip();
check('hidden: the closed tab', G.hud.tipWin.closed.classList.contains('hidden') === false && G.hud.tip.classList.contains('hidden'));

// ---------------------------------------------------------------- minimap
const M = G.minimap, S = G.mapSource;
check('the playable area: the map minus 128 m', M.rect.x0 === -S.origin[0] + 128 && M.rect.z1 === S.origin[1] - 128 && M.gw === (2 * S.origin[0] - 256) / 4, M.rect);
check('a diamond: the default camera snapped to 45 degrees', Math.abs(M.angle - Math.PI / 4) < 1e-6, M.angle);
check('the table: 6 rows of 21', M.table.length === 6 && M.table[0].length === 21);
const [mx, my] = M.w2m(100, -50), [wx, wz] = M.m2w(mx, my);
check('w2m / m2w are inverse', Math.hypot(wx - 100, wz + 50) < 0.01, [wx, wz]);
M.update(1, true);
// a wild animal (no owner) is not drawn, an own unit is
const px = (x, z) => { const [a, b] = M.w2m(x, z); return [...M.ctx.getImageData(Math.round(a), Math.round(b), 1, 1).data]; };
const wild = W.units.find((x) => x.alive && !x.owner);
const mine = W.units.find((x) => x.alive && x.owner === me);
if (wild) {
  const a = px(wild.pos.x, wild.pos.z); wild.alive = false; M.update(1, true);
  const b = px(wild.pos.x, wild.pos.z); wild.alive = true; M.update(1, true);
  check('no dots for wild animals', a.join() === b.join(), { a, b });
}
const c = px(mine.pos.x, mine.pos.z), mc = M.ownerColor(me, 2);
check('own units in the player\'s minimap colour', Math.abs(c[0] - mc[0]) + Math.abs(c[1] - mc[1]) + Math.abs(c[2] - mc[2]) < 40, { c, mc });
// fog: unexplored cells transparent, explored half, visible solid
G.fow.revealAll = false; G.fow.explored.fill(0); G.fow.vis.fill(0); G.fow.version++; M.update(1, true);
const k = (M.gh >> 1) * M.gw + (M.gw >> 1);
check('fog: unexplored cells are left out', M.img.data[k * 4 + 3] === 0, M.img.data[k * 4 + 3]);
G.fow.explored.fill(1); G.fow.version++; M.update(1, true);
check('fog: explored cells half transparent', M.img.data[k * 4 + 3] > 100 && M.img.data[k * 4 + 3] < 160, M.img.data[k * 4 + 3]);
// markers: an attack on an own unit, gathered
W.emit && W.emit({ type: 'attacked', entity: mine, by: null });
G.feedback.handle([{ type: 'attacked', entity: mine, by: null }]);
W.time += 0.2; G.feedback.handle([]);
check('attack marker', M.markers.some((m) => m.type === 'Attack'), M.markers.map((m) => m.type));
// buttons
const bs = [...document.querySelectorAll('.mmbtn')];
check('five buttons on the frame', bs.length === 5);
bs[3].click(); check('zoom in', M.zoom === 2); bs[4].click(); check('zoom out', M.zoom === 1);
bs[0].click(); check('landscape off', M.layers.scape === false); bs[0].click();
bs[2].click(); check('map ping mode', G.input.mode === 'mapping'); G.input.modeClick(window.innerWidth / 2, window.innerHeight / 2); check('a ping', M.markers.some((m) => m.type === 'Ping') && !G.input.mode);
return out.join('\n');
