// Norse walls with "falling stones" (systems/buildings.js wall.hit; Building.usl CWall.TakeDmg): a wall that is hit
// drops stones on the attackers around it, once per 10 s.   python3 tests/evaljs.py tests/falling_stones.js "&tribe=Hu&enemy=Aje"
const W = G.world, me = G.me, ai = G.ai, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const run = (s) => { for (let i = 0; i < s * 20; i++) G.step(1, 0.05); };
G.aiBrain.update = () => {}; if (G.meBrain) G.meBrain.update = () => {};
const X = -40, Z = 40;
const wall = W.placeBuilding('hu_palisade', me, X, Z, 0, true);
check('a palisade', !!wall);
const a = W.spawnUnit('aje_warrior', ai, X + 6, Z, 3);
a.stance = 3;
const hp0 = a.hp;
W.takeDmg(a, wall, 1, 0); run(1);
check('no stones before the upgrade', a.hp === hp0, { hp: a.hp, hp0 });
me.tt.enable('Hu/Upgrades/hu_palisade/hu_falling_stones');
run(1);
check('the wall has the stones weapon', !!(wall.weapons.long && wall.cs(wall.weapons.long).splash > 0), wall.weapons.long && wall.weapons.long.path);
W.takeDmg(a, wall, 1, 0); run(1);
const hit1 = hp0 - a.hp;
check('stones fall on the attacker', hit1 > 0, { dmg: hit1 });
W.takeDmg(a, wall, 1, 0); run(1);
check('not again within 10 s', hp0 - a.hp === hit1 || !a.alive, { dmg: hp0 - a.hp });
return out.join('\n');
