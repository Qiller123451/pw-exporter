// What heroes give by level (docs/spec/moves.md §5, units.md §2): the aura from level 2 (as the data has it), the special move from
// level 3, the chief bonus at level 5 (FightingObj.SetLevelFilter enables it for heroes too), and the tooltip lines.
// A skirmish uses the original heroes; the sequel ("&sequel=1", MIRAGE data) its copies (game/sequel/rules.js, Rules.kind).
// python3 tests/evaljs.py tests/hero_levels.js "&tribe=Hu&enemy=Aje"      python3 tests/evaljs.py tests/hero_levels.js "&sequel=1"
const W = G.world, me = G.me, D = G.data, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const B = W.buildings.find((b) => b.owner === me) || { pos: { x: 0, z: 0 } };
const at = (dx, dz) => [B.pos.x + dx, B.pos.z + dz];
const foeP = W.players.find((p) => p !== me && !me.isFriend(p) && !me.isNeutral(p));
const ada = G.sequel ? 'sq_halloran' : 'lovelace_s0', taslow = G.sequel ? 'sq_taslov' : 'tesla_s0', cole = G.sequel ? 'sq_booker' : 'Cole_s0';
const spawn = (n, p, dx, dz) => W.spawnUnit(n, p, ...at(dx, dz), 1);
const a = spawn(ada, me, 30, 30), t = spawn(taslow, me, 34, 30), c = spawn(cole, me, 26, 30);
const foe = spawn(G.sequel ? 'Velociraptor' : 'aje_warrior', foeP, 36, 36);
check('the heroes are there', a && t && c && foe, [ada, taslow, cole]);
const moves = (u) => D.actionsOf(me, u).filter((x) => x.kind === 'Moves' && !/^(Attack|AggroState)/.test(x.id)).map((x) => x.id + '@' + x.levelReq);
W.setLevel(a, 2); W.auraUpdate();
check('level 2: Ada slows the enemies near her', !!foe.st.aura.slowhand);
for (const u of [a, t, c]) W.setLevel(u, 3);
check('level 3: their special moves', moves(a).includes('Ada_DeathShoot@3') && moves(t).includes('Tesla_DstrVhcl_0@3') && moves(c).includes('Shotgun@3'), [moves(a), moves(t), moves(c)]);
// level 5: the chief bonus
const act = D.actionsOf(me, W.buildings.find((b) => b.owner === me && D.actionsOf(me, b).some((x) => x.kind === 'Build' && x.type === 'CHTR')) || B).find((x) => x.kind === 'Build' && x.type === 'CHTR');
const before = act ? W.productionTime(act, me) : 0;
for (const u of [a, t]) W.setLevel(u, 5);
check('level 5: the chief bonus is on', me.tt.has(`${a.def.tribe}/Upgrades/${ada}/Chief_Bonus`) && me.tt.has(`${t.def.tribe}/Upgrades/${taslow}/Chief_Bonus`));
// (Taslow's chief bonus: the build cost of destroyed buildings in the official game, faster building in MIRAGE)
const tchief = JSON.stringify(D.base.filter(`${t.def.tribe}/Upgrades/${taslow}/Chief_Bonus`) || {});
if (tchief.includes(`/${me.tribe}/InventObjects/BLDG_res_back`)) check("level 5: Taslow's player gets the build cost of the buildings it destroys", D.invented(me, 'BLDG_res_back', me.tribe));
if (!G.sequel && act) check("level 5: Ada's people train in half the time", Math.abs(W.productionTime(act, me) - before / 2) < 0.6, { action: act.id, before, after: W.productionTime(act, me) });
W.setLevel(a, 4);
check('below level 5 the chief bonus is off again', !me.tt.has(`${a.def.tribe}/Upgrades/${ada}/Chief_Bonus`));
// the tooltip: the original's level lines (the help item's %/lvl1:..% .. %/lvl5:..%, ui/tooltip.js)
const txt = D.text(ada);
check('the hero has its level lines', !!(txt.lvl && txt.lvl[2] && txt.lvl[5]), { name: txt.name, lvl: txt.lvl });
// the heroes' auras as the data has them (systems/effects.js heroEffect): Cole's bonus for the infantry of the player's
// tribe, if his aura names it (MIRAGE's does for SEAS)
const fx = W.heroEffect(cole), cls = [...fx.bonus.keys()].find((k) => k.startsWith(me.tribe.toLowerCase() + '_') && D.exists(k));
if (cls) {
  W.setLevel(c, 2);
  const u = W.spawnUnit(cls, me, c.pos.x + 3, c.pos.z, 1);
  W.auraUpdate();
  const got = Object.entries(u.st.bonus).filter(([, v]) => v > 0);
  check(`level 2: Cole's aura strengthens the ${cls}`, got.length > 0, got);
}
return out.join('\n');
