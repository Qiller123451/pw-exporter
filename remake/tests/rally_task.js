// Rally points only on producers (flag model at the point) and worker task icons on the pyramid cards:
//   python3 tests/evaljs.py tests/rally_task.js "&tribe=Hu&enemy=Aje&debug"
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const h = G.homeEntity();
const age2 = G.producerActions(h).find((a) => a.id === 'age_2'); if (age2) { W.queueAction(h, age2); G.step(10); }
check('HQ can have a rally point', G.canRally(h));
const spot = (name) => { for (let r = 40; r < 300; r += 8) for (let a = 0; a < 24; a++) { const x = h.pos.x + Math.cos(a / 24 * 6.283) * r, z = h.pos.z + Math.sin(a / 24 * 6.283) * r; const p = W.placement(name, x, z, 0, me); if (p.ok) return p; } return null; };
const ts = spot('hu_small_tower'); const tower = W.placeBuilding('hu_small_tower', me, ts.x, ts.z, 0, true);
check('a tower has no rally point', !G.canRally(tower));
G.select([h]); h.rally = [h.pos.x + 20, h.pos.z + 5];
G.overlay.update(0.05);
const f = G.overlay.flags.get(h);
check('rally flag model shown', !!f && /rally_point/.test(f.name), f && f.name);
G.select([]); G.overlay.update(0.05);
check('flag removed when deselected', !G.overlay.flags.has(h));
// task icons
const w = W.units.find((u) => u.owner === me && u.isWorker);
const tree = W.resources.find((n) => n.alive && n.res === 'wood');
W.startGather(w, tree);
G.step(Math.ceil(30 / 0.05));
check('gathering worker shows the wood icon', G.hud.taskIcon(w) === 'wood', { task: w.task && w.task.type, res: w.task && w.task.res, icon: G.hud.taskIcon(w) });
const w2 = W.units.find((u) => u.owner === me && u.isWorker && u !== w);
W.order([w2], { type: 'idle' }); G.hud.taskIcon(w2); G.step(Math.ceil(3 / 0.05));
check('idle worker shows zzz after 2 s', G.hud.taskIcon(w2) === 'idle', G.hud.taskIcon(w2));
G.hud.pyrKey = null; G.hud.refreshPyramid();
check('task layer on a card', document.querySelectorAll('.pcard .ptask').length > 0, document.querySelectorAll('.pcard .ptask').length);
return out.join('\n');
