// A badly damaged enemy building is still picked under the cursor, and a selected tower takes the right-click on it
// as its target. python3 tests/evaljs.py tests/pick_damaged.js "&tribe=SEAS&enemy=Hu"
const I = G.input, me = G.me, W = G.world, out = [];
const hq = W.buildings.find((b) => b.owner === me && /headquarters/.test(b.name));
const foe = W.players.find((p) => p !== me && me.isEnemy(p));
const { spawnObject } = G.cheatsApi || {};
const put = (name, owner, dx, dz) => W.placeBuilding(name, owner, hq.pos.x + dx, hq.pos.z + dz, 0, true);
const tower = put('seas_turret_tower', me, 40, 0), enemy = put('hu_small_tower', foe, 62, 0), enemy2 = put('hu_small_tower', foe, 62, 22);
for (const b of [tower, enemy, enemy2]) { b.progress = 1; b.hp = b.maxHp; W.finishBuilding && W.finishBuilding(b, []); }
G.rtscam.x = hq.pos.x + 52; G.rtscam.z = hq.pos.z + 10; G.rtscam.dist = G.rtscam.tDist = 70;
const check = (label, b) => {
  G.step(10, 0.05); G.renderOnce && G.renderOnce();
  const r = I.pickRect(b); if (!r) return out.push(label + ': off screen');
  let hits = 0, tot = 0;
  for (let y = Math.round(r.y0); y < r.y1; y += 4) for (let x = Math.round(r.x0); x < r.x1; x += 4) { tot++; if (I.entityAt(x, y) === b) hits++; }
  out.push(`${label}: dmgStage ${b.dmgStage} hp ${Math.round(b.hp)}/${b.maxHp} picked on ${hits} of ${tot} cells of its box`);
  return hits;
};
const full = check('intact', enemy);
enemy.hp = enemy.maxHp * 0.4; enemy.updateVisual && enemy.updateVisual(); const half = check('40 %', enemy);
enemy.hp = enemy.maxHp * 0.1; enemy.updateVisual && enemy.updateVisual(); const low = check('10 %', enemy);
// the tower shoots at the building it was told to
G.select([tower]);
const r = I.pickRect(enemy), cx = (r.x0 + r.x1) / 2, cy = r.y0 + (r.y1 - r.y0) * 0.6;
const t = I.entityAt(cx, cy);
I.orderOn(t, I.groundPoint(cx, cy), false);
out.push(`right-click target: ${t && t.name} forced ${tower.forcedTarget && tower.forcedTarget.name}`);
const hp0 = enemy.hp; G.step(240, 0.05);
out.push(`after 12 s: enemy hp ${Math.round(hp0)} -> ${Math.round(enemy.hp)} alive ${enemy.alive}`);
const ok = low > 0 && half > 0 && (enemy.hp < hp0 || !enemy.alive);
return (ok ? 'ok ' : 'FAIL ') + out.join(' | ');
