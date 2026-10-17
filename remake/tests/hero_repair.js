// Heroes and other units that can build (can_build: Tesla / Taslov, every Dustrider) repair buildings like workers
// (Repair.usl asks CanBuild only): the command card offers Repair, a right-click on a damaged own building repairs it.
// python3 tests/evaljs.py tests/hero_repair.js "&tribe=Hu&enemy=Aje"
const W = G.world, me = G.me, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const hq = W.buildings.find((b) => b.alive && b.owner === me && b.def.script !== 'CWall');
const hero = W.spawnUnit('tesla_s0', me, hq.pos.x + hq.radius + 6, hq.pos.z, 1);
check('Tesla can build', !!hero && hero.canBuild && !hero.isWorker, hero && { canBuild: hero.canBuild, worker: hero.isWorker });
for (const u of W.units) if (u.owner === me && u.isWorker) W.order([u], { type: 'stop' });
Object.assign(me.res, { food: 9999, wood: 9999, stone: 9999 });
hq.hp = hq.maxHp * 0.5;
G.sel = new Set([hero]);
G.hud.cmdKey = null; G.hud.refreshCommands();
check('the command card offers Repair', !!G.hud.cmd.querySelector('[data-act="actbtn_sym_repair"]'));
// a right-click on the headquarters
const I = G.input, ea = I.entityAt, gp = I.groundPoint;
I.entityAt = () => hq; I.groundPoint = () => ({ x: hq.pos.x, z: hq.pos.z });
try { I.rightClick(0, 0, false); } finally { I.entityAt = ea; I.groundPoint = gp; }
check('a right-click orders the repair', hero.task.type === 'build' && hero.task.repair, hero.task.type);
const hp0 = hq.hp;
G.step(400, 0.05);
check('Tesla repairs the damaged headquarters', hq.hp > hp0 + 50, { from: Math.round(hp0), to: Math.round(hq.hp), task: hero.task.type });
return out.join('\n');
