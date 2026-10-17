// Items (artefacts: game/systems/items.js): the level's item spawns put them on the map, a right click sends a unit to
// take one (the "trade" cursor), the item's tech tree filter works while it is carried, one item per unit, the
// carrier's death drops it, the effects of the toolkit (repairs for free), the flowerpot (more skulls) and the
// ride cup (the transport's hit points); the info window's item slot.
//   python3 tests/evaljs.py tests/items.js "&tribe=Hu&enemy=Aje&map=maps/Base/Multiplayer/multi_2_nor_002.ula"
const W = G.world, me = G.me, S = G.mapSource, out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (sec, dt = 0.25) => G.step(Math.ceil(sec / dt), dt);
const spawnNear = (name, x, z, owner = me) => {
  for (let r = 0; r < 40; r += 2) for (let a = 0; a < 6.28; a += 0.5) {
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (W.nav.isFree(px, pz)) return W.spawnUnit(name, owner, px, pz, 1);
  }
  return null;
};
const warrior = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_warrior' }[me.tribe];
// ---- the spawns: MaxItems items, no class twice, at spawn places
const classes = W.items.map((i) => i.item.cls);
check('the item spawns put the level\'s items on the map (MaxItems, no class twice)', W.items.length > 0 && W.items.length <= S.itemPool.max && new Set(classes).size === classes.length
  && W.items.every((i) => S.itemSpawns.some((s) => Math.hypot(s.x - i.pos.x, s.z - i.pos.z) < 0.5)), [classes, S.itemPool.max, S.itemSpawns.length]);
const it = W.items.find((i) => W.itemDef(i.item.cls).globalTT);
const def = W.itemDef(it.item.cls), filter = def.globalTT.replace(/^\/?Filters\//, '');
// ---- picking it up
const u = spawnNear(warrior, it.pos.x + 20, it.pos.z);
G.select([u]);
check('over an item the cursor is "trade"', G.input.cursorFor(it, null, false) === 'trade', G.input.cursorFor(it, null, false));
G.input.orderOn(it, null, false);
check('a right click sends the unit to take it', u.task.type === 'pickup' && u.task.target === it, u.task.type);
let t = 0; while (!u.item && t < 40) { run(0.5); t += 0.5; }
check('it walks there and takes it', u.item === it && it.item.carrier === u && !it.visible, [t, it.item.cls]);
check('its filter works for the tribe while it is carried', (me.tt.enabled.get(filter) || 0) > 0, filter);
G.select([u]); G.hud.infoKey = null; G.hud.refreshInfo();
check('the info window shows the item in its slot', !!G.hud.infoBody.querySelector('.islot'), null);
// ---- a full inventory
const it2 = W.items.find((i) => i !== it && !i.item.carrier);
if (it2) {
  W.order([u], { type: 'pickup', target: it2 });
  run(1);
  check('one item per unit: a second one is not taken', u.item === it && !it2.item.carrier, [u.task.type]);
}
// ---- death drops it
const at = [u.pos.x, u.pos.z];
u.invulnT = 0; W.kill(u, null);
check('the carrier dies: the item falls where it stood', !it.item.carrier && it.visible && Math.hypot(it.pos.x - at[0], it.pos.z - at[1]) < 1, null);
check('and its filter is off', !(me.tt.enabled.get(filter) > 0), me.tt.enabled.get(filter));
const v = spawnNear(warrior, it.pos.x + 5, it.pos.z);
W.order([v], { type: 'pickup', target: it });
t = 0; while (!v.item && t < 20) { run(0.5); t += 0.5; }
check('another unit takes it', v.item === it, t);
// ---- effects: the flowerpot (skulls x 1.2), the toolkit (repairs cost nothing), the ride cup (the transport + 50 %)
const pot = W.placeItem('item_flowerpot_of_insanity', v.pos.x + 30, v.pos.z);
const w2 = spawnNear(warrior, v.pos.x + 30, v.pos.z + 3);
W.takeItem(w2, pot);
const foe = W.players.find((p) => p !== me && !me.isFriend(p));
const victim = spawnNear('aje_warrior', w2.pos.x + 6, w2.pos.z, foe);
const sk = me.res.skulls, sc = W.scalpValue(victim);
victim.lastDamager = me; victim.invulnT = 0; W.kill(victim, w2);
check('the flowerpot of insanity: 1.2 x the skulls', me.res.skulls - sk === Math.floor(Math.round(sc) * 1.2 + 0.5), [me.res.skulls - sk, sc]);
const b = W.buildings.find((x) => x.alive && x.owner === me && x.built && !x.def.wallKind);
const kit = W.placeItem('item_toolkit', b.pos.x + b.radius + 8, b.pos.z);
const worker = spawnNear(me.tribe === 'Hu' ? 'hu_worker' : me.tribe === 'Aje' ? 'aje_worker' : me.tribe === 'Ninigi' ? 'ninigi_worker' : 'seas_worker', b.pos.x + b.radius + 6, b.pos.z);
W.takeItem(worker, kit);
W.setHp(b, b.maxHp * 0.5);
const res0 = { ...me.res };
W.order([worker], { type: 'repair', target: b });
for (let k = 0; k < 12 && !(b.hp > b.maxHp * 0.5 + 50); k++) run(5);
check('the toolkit: repairing costs nothing', b.hp > b.maxHp * 0.5 && me.res.wood === res0.wood && me.res.stone === res0.stone, [Math.round(b.hp / b.maxHp * 100), res0.wood - me.res.wood]);
const cup = W.placeItem('item_ride_cup', v.pos.x, v.pos.z + 30);
const rider = spawnNear(warrior, v.pos.x, v.pos.z + 30);
W.takeItem(rider, cup);
const mount = W.data.exists('hu_mammoth') ? spawnNear('hu_mammoth', v.pos.x, v.pos.z + 34) : null;
if (mount && W.canBoard(rider, mount)) {
  const hp0 = mount.maxHp;
  W.enterTransport(rider, mount);
  check('the ride cup: its carrier\'s mount has half its hit points more', Math.abs(mount.maxHp - hp0 * 1.5) < 1, [hp0, mount.maxHp]);
  W.leaveTransport(rider);
  check('... until the carrier gets off', Math.abs(mount.maxHp - hp0) < 1, mount.maxHp);
}
return out.join('\n');
