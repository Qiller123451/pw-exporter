// Electricity in the sequel (game/sequel/power.js, docs/SEQUEL.md "Power"), mission 2: workers in the generating
// station make power only once a line of poles reaches the headquarters; a broken pole cuts it off; a windmill makes
// power by itself; the electric weapons stun and jump (Sequel.electric); power pays for things.
// python3 tests/evaljs.py tests/sequel_power.js "&sequel=2"
const M = G.sequel, W = G.world, me = G.me, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (n) => G.step(n, 0.1);
const st = M.state.station;
const hq = W.buildings.find((b) => b.alive && b.owner === me && /headquarters$/.test(b.name));
check('the station is a plant workers can work in', !!st && W.isFarm(st) && W.farmSlots(st) === 6, st && { farm: W.isFarm(st), slots: W.farmSlots(st) });
// three workers into the station
const wk = M.units('me', (u) => u.isWorker).slice(0, 3);
for (const u of wk) { W.teleport(u, st.pos.x + 14, st.pos.z + 12); W.startGather(u, st); }
run(200);
const p0 = me.res.power;
run(200);
check('the workers work in the station', wk.every((u) => u.task.type === 'gather' && u.task.farm === st), wk.map((u) => u.task.type));
check('without a line it makes nothing', !st.sqPowered && Math.abs(me.res.power - p0) < 0.01, { powered: st.sqPowered, gain: me.res.power - p0 });
// a pole line from the headquarters to the station
const poles = [];
const n = Math.ceil(Math.hypot(st.pos.x - hq.pos.x, st.pos.z - hq.pos.z) / 34);
for (let i = 1; i < n; i++) {
  const t = i / n, x = hq.pos.x + (st.pos.x - hq.pos.x) * t, z = hq.pos.z + (st.pos.z - hq.pos.z) * t;
  poles.push(M.building('sq_power_pole', 'me', x, z, 0));
}
run(10);
check('the line connects the station', st.sqPowered && poles.every((p) => p && p.sqPowered), { poles: poles.length, powered: poles.map((p) => p && p.sqPowered) });
check('the lines are drawn', M.grid.links.length >= poles.length, M.grid.links.length);
const p1 = me.res.power;
run(300);
const gain = me.res.power - p1;
check('now the workers make power (3 x 1.2 per s)', gain > 3 * 1.2 * 30 * 0.6, Math.round(gain));
check('the HUD rate', M.grid.rates().on > 100, M.grid.rates());
// cut the line
const mid = poles[Math.floor(poles.length / 2)];
W.damage(mid, 1e6, null);
run(20);
const p2 = me.res.power;
run(200);
check('a destroyed pole cuts the station off', !mid.alive && !st.sqPowered && me.res.power - p2 < 0.5, { gain: me.res.power - p2, rates: M.grid.rates() });
// a windmill next to the headquarters
const wm = M.building('sq_windmill', 'me', hq.pos.x + 22, hq.pos.z - 18, 0);
run(10);
const p3 = me.res.power;
run(200);
check('a windmill near the headquarters makes power by itself', wm && wm.sqPowered && me.res.power - p3 > 0.35 * 20 * 0.8, { powered: wm && wm.sqPowered, gain: me.res.power - p3 });
// power pays: a searchlight tower (the Tesla coil comes in mission 6: missions.js unlocks)
const coil = G.data.actionsOf(wk[0].rulesOwner(), wk[0]).find((a) => a.results[0] && a.results[0].obj === 'sq_searchlight');
check('the searchlight costs power', !!coil && coil.cost.power === 40, coil && coil.cost);
me.res.power = 10;
check('without the power it cannot be afforded', !me.canAfford(coil.cost));
me.res.power = 500; me.res.wood = 500;
check('with it, it can', me.canAfford(coil.cost));
// the electric weapons: a shock trooper's hit stuns, the coil's lightning jumps to the next creatures
const raptors = M.spawn('Velociraptor', 'outbreak', hq.pos.x - 40, hq.pos.z + 40, 3);
const tr = M.spawn('sq_shock_trooper', 'me', hq.pos.x - 60, hq.pos.z + 40, 1)[0];
check('a shock trooper exists', !!tr);
for (const r of raptors) W.order([r], { type: 'stop' });
M.arcs = [];
W.provideDmg(5, tr, raptors[0]);
check('its hit draws an arc and stuns', (M.arcs || []).length >= 1 && raptors[0].sqStunned > M.time, { arcs: (M.arcs || []).length });
const tc = M.building('sq_tesla_coil', 'me', hq.pos.x - 30, hq.pos.z + 30, 0);
M.arcs = [];
const hp = raptors.map((r) => r.hp);
W.provideDmg(20, tc, raptors[0]);
check('the coil\'s lightning jumps to the others', (M.arcs || []).length >= 2 && raptors.slice(1).some((r, i) => r.hp < hp[i + 1]), { arcs: (M.arcs || []).length, hp: raptors.map((r) => Math.round(r.hp)) });
return out.join('\n');
