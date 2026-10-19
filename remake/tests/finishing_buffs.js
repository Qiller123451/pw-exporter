// Finishing moves (game/systems/finishing.js) and buffs (game/buffs.js, ui/hud.js icons, ui/decals.js decals).
//   python3 tests/evaljs.py tests/finishing_buffs.js "&tribe=Hu&enemy=Aje&debug"
const W = G.world, me = G.me, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (s) => G.step(Math.ceil(s / 0.05));
for (const u of W.units) if (u.alive && u.wild) W.kill(u, null);
W.wildNests.length = 0;
const foe = W.players.find((p) => p !== me && me.isEnemy(p));
const h = G.homeEntity();
const spawn = (name, x, z, owner = me) => { const c = W.nav.nearestFree(W.nav.idx(x, z), 8); const [fx, fz] = W.nav.center(c); return W.spawnUnit(name, owner, fx, fz, Math.max(1, W.data.minLevel(name, owner))); };
try {
// ---- finishing moves: a fighter of my tribe with a move against a unit of the enemy's
const FM = W.data.extra.finishing || {};
check('the finishing move table is there', Object.keys(FM).length > 20, Object.keys(FM).length);
let pair = null;
for (const [f, moves] of Object.entries(FM)) {
  if (!W.data.exists(f) || !f.startsWith(me.tribe.toLowerCase() + '_')) continue;
  for (const m of moves) for (const v of m.e) if (v.startsWith(foe.tribe.toLowerCase() + '_') && W.data.exists(v) && !pair) pair = [f, v];
}
check('a fighter and a victim of the two tribes', !!pair, pair);
if (pair) {
  const x = h.pos.x + 40, z = h.pos.z + 40;
  let done = false, tries = 0;
  const seen = [];
  const emit0 = W.emit.bind(W);
  W.emit = (type, d) => { if (type === 'finishingMove') seen.push(d); return emit0(type, d); };
  while (!done && tries++ < 6) {
    const A = spawn(pair[0], x + tries * 12, z), V = spawn(pair[1], x + tries * 12 + 2.5, z, foe);
    if (!A || !V) break;
    A.maxHp = A.hp = 1e5;                                  // (the victim must not finish the fighter)
    V.hp = 1;
    W.order([A], { type: 'attack', target: V });
    V.task = { type: 'attack', target: A, user: true };
    for (let k = 0; k < 40 && V.alive; k++) run(0.25);
    if (seen.length) {
      done = true;
      check('a blow that kills an enemy fighting back: a finishing move', !V.alive && seen.some((e) => e.victim === V && e.unit === A), seen.map((e) => [e.unit.name, e.victim.name]));
      check('the fighter can\'t be hurt during it', W.invulnerable(A) || !A.finishing, null);
      run(6);
      check('the move ends: the fighter is free again, the victim lies on the ground', !A.finishing && !V.finish && Math.abs(V.pos.y - W.height(V.pos.x, V.pos.z)) < 1.5, { task: A.task.type });
    }
  }
  W.emit = emit0;
  if (!done) check('a finishing move happened (6 tries)', false, seen.length);
}
// ---- buffs
const u = spawn(me.tribe === 'Hu' ? 'hu_warrior' : 'aje_warrior', h.pos.x - 40, h.pos.z - 40);
u.st.poison = { dmg: 0.01, left: 100, next: W.time + 100, by: null };
const b = W.data.extra.buffs || [];
check('the buff table is there (buffdecals.txt)', b.length > 10 && b.some((x) => x.attrib === 'is_poisoned'), b.length);
G.select([u]); G.hud.infoKey = null; G.hud.refreshInfo();
const icons = G.hud.infoBody.querySelectorAll('.buffs span');
check('the info window shows its icon', icons.length >= 1, icons.length);
u.healedT = W.time;
G.hud.infoKey = null; G.hud.refreshInfo();
check('getting healed: another icon', G.hud.infoBody.querySelectorAll('.buffs span').length >= 2, G.hud.infoBody.querySelectorAll('.buffs span').length);
G.overlay.decals.cache.clear(); G.overlay.decals.update((e) => e === u);
check('poisoned (a buff without a tile): no decal - untiled buffs never get one (PWClient 0x484abf)', G.overlay.decals.used.hero === 0 && G.overlay.decals.used.buff === 0, G.overlay.decals.used);
u.st.bonus.DEFENSE = 20;
G.overlay.decals.cache.clear(); G.overlay.decals.update((e) => e === u);
check('more defence comes first in the table: its decal tile', G.overlay.decals.used.buff === 1 && G.overlay.decals.used.hero === 0, G.overlay.decals.used);
u.st.bonus.DEFENSE = 0;
// a group: the info window shows the buffs of its highest level unit (Info.usl:1338-1360)
const u2 = spawn(me.tribe === 'Hu' ? 'hu_warrior' : 'aje_warrior', h.pos.x - 42, h.pos.z - 40);
G.select([u, u2]); G.hud.infoKey = null; G.hud.refreshInfo();
check('a group shows the buffs of its highest-level unit', G.hud.infoBody.querySelectorAll('.buffs span').length >= 1, G.hud.infoBody.querySelectorAll('.buffs span').length);
// Ada's aura slows the attacks: less_attack_speed; a wall gives no buff
u.st.aura.slowhand = 1.5;
G.overlay.decals.cache.clear(); G.overlay.decals.update((e) => e === u);
check('Ada\'s slow hand shows "less attack speed" (decal tile 1)', G.overlay.decals.used.buff === 1 && G.overlay.decals.cache.get(u).tile === 1, G.overlay.decals.cache.get(u));
u.st.aura.slowhand = 0;
const hero = W.units.find((x) => x.alive && x.owner === me && /_s0$/.test(x.name));
if (hero) { G.overlay.decals.cache.clear(); G.overlay.decals.update((e) => e === hero); check('a hero stands on its ring', G.overlay.decals.used.hero === 1, hero.name); }
} catch (e) { out.push('FAIL exception ' + e.message + ' ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')); }
return out.join('\n');
