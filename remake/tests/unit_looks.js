// What players reported (2026-10-18): a unit that levels up keeps its weapons in hand (the new model's links -
// entities.js buildModel; the new level's weapon), gear inventions show on the animal (compose.js GEAR: Animal.usl
// UpdateGfxFlags - the rhino's and mammoth's armour with the armoured saddle), and the log cannon sets up to shoot
// instead of looping its clips (compose.js DEPLOY: lies down, frame down, gun recoils once a shot; gets up to move).
//   python3 tests/evaljs.py tests/unit_looks.js "&tribe=Hu&enemy=Aje"
const W = G.world, me = G.me, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
me.res.skulls = 5000; me.debug = true;
const h = G.homeEntity(), en = W.players.find((p) => p !== me && p.tribe);
const under = (o, root) => { for (let x = o; x; x = x.parent) if (x === root) return true; return false; };
// 1. level up
const war = W.spawn('hu_warrior', me, h.pos.x + 20, h.pos.z + 10, { level: 1 });
const held = () => (war.weaponObjs || []).filter((o) => under(o, war.model) && o.visible).length;
const n1 = held();
W.levelUp(war); G.step(5, 0.05);
ok(n1 > 0 && held() === n1, 'a levelled-up warrior still holds its weapons', { before: n1, after: held(), weapon: war.weapon && war.weapon.path });
ok(war.weapon === war.weapons.long, 'and the new level\'s weapon');
// 2. armour
const vis = (u, b) => { let v = 0, n = 0; u.model.traverse((o) => { if (o.isMesh && o.userData.attr !== undefined && ((o.userData.attr >>> b) & 1)) { n++; if (o.visible) v++; } }); return [v, n]; };
const rh = W.spawn('hu_rhino', me, h.pos.x + 25, h.pos.z + 15, {});
G.step(5, 0.05);
const a0 = vis(rh, 8);
me.tt.enable('Hu/Upgrades/hu_weapons_smith/hu_rhino_armor');
G.step(40, 0.05);
const a1 = vis(rh, 8), s1 = vis(rh, 10), sd = vis(rh, 6);
ok(a0[1] > 0 && a0[0] === 0 && a1[0] === a1[1] && s1[0] === s1[1] && sd[0] === 0, 'the rhino armour shows (with its saddle) once invented', { before: a0, armour: a1, armourSaddle: s1, saddle: sd });
// 3. log cannon
const x = h.pos.x + 30, z = h.pos.z + 40;
const lc = W.spawn('hu_mammoth_log_cannon', me, x, z, {});
G.step(20, 0.05);
const frame = lc.comp.part('frame'), gun = lc.comp.part('gun');
const t0 = gun && gun.anim.cur ? gun.anim.cur.time : -1, f0 = frame && frame.anim.cur ? frame.anim.cur.time : -1;
G.step(20, 0.05);
ok(frame && gun && gun.anim.cur.time === t0 && frame.anim.cur.time === f0 && lc.deploy.state === 'walk', 'the log cannon stands still with its frame folded and the gun at rest (no looping clips)');
const tgt = W.placeBuilding('aje_small_farm', en, x + 40, z + 5, 0, true);
W.order([lc], { type: 'attack', target: tgt });
const hp0 = tgt.hp;
let sawDown = false, firedDown = true;
for (let i = 0; i < 40; i++) { G.step(1, 0.05); if (lc.deploy.state === 'down') { sawDown = true; if (tgt.hp < hp0) firedDown = false; } }
ok(sawDown && firedDown && lc.anim.curName === 'rest', 'it lies down and sets its frame before it shoots', { state: lc.deploy.state, anim: lc.anim.curName });
G.step(120, 0.05);
ok(lc.deploy.state === 'attack' && tgt.hp < hp0, 'then it shoots', { hp: Math.round(tgt.hp), from: Math.round(hp0) });
W.order([lc], { type: 'move', x: x - 20, z });
const p0 = [lc.pos.x, lc.pos.z];
G.step(10, 0.05);
const early = Math.hypot(lc.pos.x - p0[0], lc.pos.z - p0[1]);
G.step(40, 0.05);
ok(early < 0.1 && lc.deploy.state === 'walk' && Math.hypot(lc.pos.x - p0[0], lc.pos.z - p0[1]) > 1, 'to move it gets up first', { early: +early.toFixed(2), state: lc.deploy.state });
return out.join('\n');
