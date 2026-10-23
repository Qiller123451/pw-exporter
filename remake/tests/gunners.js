// Gunner turrets (run: python3 tests/evaljs.py tests/gunners.js "&tribe=Hu&enemy=SEAS"): the titan's two ballistas
// shoot by themselves with the weapons of their weapon class (Animal.usl CTitanTriceratops: SetWeaponClass
// "hu_titan_ballista", SetAdditionalWeapon) - also while the titan stands idle; the Workshop's gunner turrets work
// the same way (workshop/addons.py). A turret turned with compose.turnPart (in its link's frame: links the
// Workshop turned) faces the target as the old aim does on a plain link.
const W = G.world, me = G.me, out = [];
const ok = (c, m) => out.push((c ? 'ok   ' : 'FAIL ') + m);
const D = G.data;
// game data built before the weapon classes were passed on: as the pipeline writes them now
const spec = D.composites('hu_triceratops');
let patched = false;
for (const s of spec) if (s.kind === 'turret' && /^con[23]$/.test(s.link) && !s.weapon_class) { s.weapon_class = 'hu_titan_ballista'; patched = true; }
ok(spec.filter((s) => s.weapon_class === 'hu_titan_ballista').length === 2, `the titan's two ballistas have their weapon class${patched ? ' (old game data: set here)' : ''}`);
const h = G.homeEntity();
const foe = W.players.find((p) => p !== me && me.isEnemy(p));
const x0 = h.pos.x + 40, z0 = h.pos.z + 40;
const t = W.spawnUnit('hu_triceratops', me, x0, z0, 4, 0);   // (its ballista weapons are of levels 4 and 5)
ok(!!t, 'a titan');
t.comp && t.comp.build();
ok(t.comp && t.comp.gunners.length === 2 && !t.comp.top, `two gunners, no main turret (${t.comp && t.comp.gunners.length})`);
const ws = D.weaponSet('hu_titan_ballista', 4, me);
ok(ws && ws.long && ws.long.projectile, 'their weapon: ' + (ws && ws.long && ws.long.id));
const r = D.weaponStats(ws.long, t.name, me).range;
const e = W.spawnUnit({ Aje: 'aje_warrior', SEAS: 'seas_warrior', Ninigi: 'ninigi_warrior', Hu: 'hu_warrior' }[foe.tribe] || 'hu_warrior', foe, x0 + Math.min(18, r * 0.6), z0, 1, 0);
e.task = { type: 'hold' };
const hp0 = e.hp, rot0 = t.comp.gunners.map((g) => g.obj.rotation.z);
let shots = 0;
const launch = W.launch;
W.launch = function (src, ...a) { if (src === t) shots++; return launch.call(this, src, ...a); };
t.stance = 0; t.task = { type: 'hold' };          // (the titan holds its ground: only the ballistas reach the warrior)
for (let i = 0; i < 160 && e.alive; i++) G.step(1, 0.05);
W.launch = launch;
ok(Math.hypot(t.pos.x - x0, t.pos.z - z0) < 2, 'the titan held its ground: ' + t.task.type);
ok(t.comp.gunners.every((g, k) => Math.abs(g.obj.rotation.z - rot0[k]) > 0.05 || !e.alive), 'both ballistas turned to the target ' + JSON.stringify(t.comp.gunners.map((g) => +g.obj.rotation.z.toFixed(2))));
ok(shots > 0 && (e.hp < hp0 || !e.alive), `they shot (${shots}) and hit: ${hp0} -> ${Math.round(e.hp)}`);
ok(t.comp.gunners.every((g) => g.shotT >= 0), 'each of them fired');

// turnPart = the old aim on a plain link (the Black widow's top on "we")
const wd = W.spawnUnit('seas_wehrspinne', foe, x0 - 30, z0 - 30, 1, 1.1);       // (the SEAS opponent: its models are loaded)
wd.comp && wd.comp.build();
const top = wd.comp && wd.comp.top;
ok(!!top, 'the widow\'s turret');
if (top) {
  const tx = wd.pos.x + 25, tz = wd.pos.z - 7;
  const V3 = top.obj.position.constructor;
  const fwd = () => { top.obj.updateMatrixWorld(true); const a = new V3().setFromMatrixPosition(top.obj.matrixWorld); const m = top.links.Proj || top.links.unnamed; const b = new V3(); m.getWorldPosition(b); return Math.atan2(b.x - a.x, b.z - a.z); };
  const goal = Math.atan2(tx - wd.pos.x, tz - wd.pos.z);
  // the old aim (before turnPart): the angle from the world positions and the unit's heading
  top.obj.rotation.z = 0;
  for (let i = 0; i < 100; i++) {
    top.obj.updateMatrixWorld(true);
    const p = new V3(); top.obj.getWorldPosition(p);
    const want = Math.atan2(-(tx - p.x), -(tz - p.z)) - wd.heading, cur = -top.obj.rotation.z;
    let diff = want - cur; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    top.obj.rotation.z = -(cur + Math.sign(diff) * Math.min(Math.abs(diff), 3 * 0.05));
  }
  const a1 = top.obj.rotation.z, d1 = fwd();
  top.obj.rotation.z = 0;
  const tp = W.turnPart && W.turnPart.bind(W);
  if (tp) {
    for (let i = 0; i < 100; i++) tp(top, tx, tz, 0.05, 3);
    const a2 = top.obj.rotation.z, d2 = fwd();
    const diff = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
    ok(diff < 0.02, `turnPart turns the widow's top as aim does (${a1.toFixed(3)} / ${a2.toFixed(3)}; muzzle ${d1.toFixed(2)} / ${d2.toFixed(2)}, target ${goal.toFixed(2)})`);
  } else ok(false, 'turnPart reachable from the page');
}
return out.join('\n');
