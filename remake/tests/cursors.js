// The right-click cursors (GameInputController.usl GetAction on CSelectionInfo, Game.usl CCursorMgr; ui/input.js
// cursorFor): what a right click would do with the selection on the object under the mouse.
//   python3 tests/evaljs.py tests/cursors.js "&tribe=Hu&enemy=Aje"
const W = G.world, me = G.me, I = G.input, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const h = G.homeEntity(), X = h.pos.x, Z = h.pos.z;
const at = (x, z) => ({ x, z });
const worker = W.units.find((u) => u.alive && u.owner === me && u.isWorker);
G.select([worker]);
const tree = W.resources.filter((r) => r.alive !== false && r.res === 'wood').sort((a, b) => a.distTo ? 0 : 0)[0];
if (tree) { G.fow.revealAll = true; check('worker on a tree: harvest_wood', I.cursorFor(tree, at(tree.pos.x, tree.pos.z)) === 'harvest_wood', I.cursorFor(tree, at(tree.pos.x, tree.pos.z))); }
check('worker on open ground: the standard cursor', I.cursorFor(null, at(X + 5, Z + 5)) === '');
const wild = W.units.find((u) => u.alive && u.wild);
if (wild) check('worker on a wild animal: attack_harvest', I.cursorFor(wild, at(wild.pos.x, wild.pos.z)) === 'attack_harvest');
const site = W.placeBuilding('hu_stone_cottage', me, X + 30, Z + 30, 0, false);
check('worker on an own site: build', site && I.cursorFor(site, at(site.pos.x, site.pos.z)) === 'build');
const w = W.spawnUnit('hu_warrior', me, X + 6, Z, 1);
G.select([w]);
const enemyFar = W.spawnUnit('aje_warrior', W.players.find((p) => p !== me && !me.isFriend(p)), X + 60, Z, 1);
check('a warrior on an enemy out of reach: attack_walk', I.cursorFor(enemyFar, at(enemyFar.pos.x, enemyFar.pos.z)) === 'attack_walk', I.cursorFor(enemyFar, at(0, 0)));
enemyFar.pos.x = w.pos.x + 1; enemyFar.pos.z = w.pos.z;
check('in reach: attack', I.cursorFor(enemyFar, at(enemyFar.pos.x, enemyFar.pos.z)) === 'attack');
check('a warrior on an own site: nothing', I.cursorFor(site, at(site.pos.x, site.pos.z)) === '');
const S = G.mapSource;
check('beyond the map\'s playable edge: no', I.cursorFor(null, at(S.play.x1 + 5, 0)) === 'no');
// a healer on a hurt own unit
const druid = W.spawnUnit('hu_druid', me, X + 8, Z, 1);
if (druid && druid.stats.heal) { G.select([druid]); w.hp = w.maxHp / 2; check('a healer on a hurt unit: healing', I.cursorFor(w, at(w.pos.x, w.pos.z)) === 'healing'); w.hp = w.maxHp; check('on a healthy one: nothing', I.cursorFor(w, at(w.pos.x, w.pos.z)) === ''); }
else out.push('skip healer');
return out.join('\n');
