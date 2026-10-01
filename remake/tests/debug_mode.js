// Debug mode and the auto-opening menus (run with tests/evaljs.py tests/debug_mode.js "&tribe=Hu&enemy=Aje&debug").
const W = G.world, me = G.me, ai = G.ai, D = G.data, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (sec) => G.step(Math.ceil(sec / 0.05));
check('player is in debug mode, the computer is not', me.debug === true && !ai.debug);
me.res.food = me.res.wood = me.res.stone = 0;
const res0 = { ...me.res };
// a building: placed finished, nothing paid
const h = G.homeEntity();
const ba = G.buildActions().find((a) => /farm|cottage|tent|house/.test(a.id) && !D.check(me, a)) || G.buildActions()[0];
let spot = null;
for (let r = 25; r < 120 && !spot; r += 6) for (let a = 0; a < 16 && !spot; a++) { const at = W.placement(ba.results[0].obj, h.pos.x + Math.cos(a) * r, h.pos.z + Math.sin(a) * r, 0, me); if (at.ok) spot = at; }
const workers = W.units.filter((u) => u.alive && u.owner === me && u.isWorker);
const b = spot && W.startConstruction(me, ba, spot.x, spot.z, spot.rot, workers.slice(0, 1));
check('building stands finished at once', b && typeof b === 'object' && b.built && b.progress === 1, { id: ba.id, b: typeof b === 'string' ? b : b && b.built });
check('nothing was paid', me.res.food === res0.food && me.res.wood === res0.wood && me.res.stone === res0.stone, me.res);
// a unit from the headquarters: instant
const ua = G.producerActions(h).find((a) => a.kind === 'Build');
const why = ua && W.queueAction(h, ua);
const n0 = W.units.filter((u) => u.alive && u.owner === me).length;
run(1);
check('unit trained instantly and for free', !why && W.units.filter((u) => u.alive && u.owner === me).length === n0 + 1 && me.res.food === 0, { why, id: ua && ua.id });
// an upgrade: instant
const up = G.producerActions(h).find((a) => a.kind === 'Upgrades' && !W.canQueue(me, a, h));
if (up) { const w = W.queueAction(h, up); run(1); check('research is instant', !w && !h.queue.length, { id: up.id, w, q: h.queue.length }); }
// level up with no skulls
me.res.skulls = 0;
const u = W.units.find((x) => x.alive && x.owner === me && x.level === 1 && !x.isWorker) || workers[0];
const lw = W.levelUp(u);
check('level up without skulls', !lw && u.level === 2, { lw, lvl: u.level });
// the computer still pays
ai.res.wood = 0;
check('the computer still needs resources', !ai.canAfford({ wood: 50 }));
// menus open by themselves
G.select(workers.slice(0, 2)); G.hud.refreshCommands();
check('workers open the build menu', G.hud.menu === 'build' && !G.hud.flyout.classList.contains('hidden'), G.hud.menu);
G.hud.toggleMenu('build');
G.hud.refreshCommands();
check('closing keeps it closed for the same selection', G.hud.menu === null, G.hud.menu);
G.select([h]); G.hud.refreshCommands();
check('a building opens the produce menu', G.hud.menu === 'produce', G.hud.menu);
const sold = W.units.filter((x) => x.alive && x.owner === me && !x.isWorker);
if (sold.length) { G.select(sold); G.hud.refreshCommands(); check('soldiers open no menu', G.hud.menu === null, G.hud.menu); }
// epoch upgrades: free and without the buildings they need (Dragon Clan: lumber mill + dojo), also after a local
// upgrade of the headquarters (Explode gives it its own tree)
const ex = G.producerActions(h).find((a) => a.id === 'Explode');
if (ex) { W.queueAction(h, ex); run(1); }
for (let k = 2; k <= 5; k++) {
  if (me.epoch() >= k) continue;
  const ep = G.producerActions(h).find((a) => a.id === 'age_' + k);
  const w = ep ? W.queueAction(h, ep) : 'missing';
  run(1.5);
  check('epoch ' + k + ' upgrade in debug mode', !w && me.epoch() === k, { w, epoch: me.epoch() });
}
return out.join('\n');
