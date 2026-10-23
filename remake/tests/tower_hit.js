// A tower shoots at the building it was told to, at full and at low hit points (combat.js towerUpdate)
// python3 tests/evaljs.py tests/tower_hit.js "&tribe=SEAS&enemy=Hu"
const me = G.me, W = G.world, out = [];
const hq = W.buildings.find((b) => b.owner === me && /headquarters/.test(b.name));
const foe = W.players.find((p) => p !== me && me.isEnemy(p));
const put = (name, owner, dx, dz) => W.placeBuilding(name, owner, hq.pos.x + dx, hq.pos.z + dz, 0, true);
const tower = put('seas_turret_tower', me, 40, 0), enemy = put('hu_small_tower', foe, 62, 0);
for (const b of [tower, enemy]) { b.progress = 1; b.hp = b.maxHp; W.finishBuilding && W.finishBuilding(b, []); }
const w = tower.weapons.long, cs = tower.cs(w);
out.push(`range ${cs.range} radius ${tower.radius} reach ${W.reach(tower, enemy).toFixed(1)} dmg ${JSON.stringify(cs.dmg || cs.damage || null)}`);
let bad = false;
for (const pct of [1, 0.4, 0.1]) {
  enemy.hp = enemy.maxHp * pct; enemy.updateVisual();
  W.aimTowers([tower], enemy);
  let shots = 0; const h0 = enemy.hp;
  const L = W.launch.bind(W); W.launch = (...a) => { shots++; return L(...a); };
  G.step(160, 0.05);
  W.launch = L;
  if (!(enemy.hp < h0 || !enemy.alive)) bad = true;
  if (!enemy.alive) { out.push(`${pct * 100}%: destroyed after ${shots} shots`); break; }
  out.push(`${pct * 100}%: shots ${shots} hp ${Math.round(h0)} -> ${Math.round(enemy.hp)} forced ${tower.forcedTarget && tower.forcedTarget.name} target ${tower.towerTarget && tower.towerTarget.name}`);
}
return (bad ? 'FAIL ' : 'ok ') + out.join(' | ');
