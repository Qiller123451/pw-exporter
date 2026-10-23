// An enemy building with units standing at its foot (the player's attackers, the enemy's repairers) stays clickable:
// on its visible surface it is picked unless a unit is drawn in front of it there (ui/input.js entityAt).
// python3 tests/evaljs.py tests/pick_crowd.js "&tribe=SEAS&enemy=Hu"
const I = G.input, me = G.me, W = G.world, out = [];
const hq = W.buildings.find((b) => b.owner === me && /headquarters/.test(b.name));
const foe = W.players.find((p) => p !== me && me.isEnemy(p));
const t = W.placeBuilding('hu_small_tower', foe, hq.pos.x + 50, hq.pos.z, 0, true);
t.progress = 1; W.finishBuilding && W.finishBuilding(t, []); t.hp = t.maxHp * 0.12; t.updateVisual();
for (let k = 0; k < 6; k++) { const a = k / 6 * 6.28; const u = W.spawnUnit('seas_gunner', me, t.pos.x + Math.cos(a) * (t.radius + 1.5), t.pos.z + Math.sin(a) * (t.radius + 1.5), 1, 0); if (u) { u.stance = -1; u.invulnT = 1e9; } }
let ok = true;
for (const dist of [60, 110]) {
  G.rtscam.x = t.pos.x; G.rtscam.z = t.pos.z + 8; G.rtscam.dist = G.rtscam.tDist = dist;
  G.step(2, 0.05); G.renderOnce();
  const r = I.pickRect(t); let self = 0, tot = 0;
  for (let y = Math.round(r.y0); y < r.y1; y += 3) for (let x = Math.round(r.x0); x < r.x1; x += 3) {
    const ray = I.ray(x, y).clone(); if (I.boxHit(t, ray) === null || I.pickHit(t, ray) === null) continue;
    tot++; if (I.entityAt(x, y) === t) self++;
  }
  const pct = Math.round(100 * self / Math.max(1, tot));
  if (pct < 60) ok = false;
  out.push(`zoom ${dist}: the tower picked on ${pct} % of its surface`);
}
return (ok ? 'ok ' : 'FAIL ') + out.join(' | ');
