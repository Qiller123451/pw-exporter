// Temples heal everyone of theirs in range and show the healing aura (docs/GAMEPLAY_RULES.md: Building.usl
// CTemple.SetReady AddFX "fx_heal_area"; game/entities.js READY_FX): the aura's light (an additive part with the
// pick bit: engine/parts.js helperPart) and its emitters.
// python3 tests/evaljs.py tests/heal_aura.js "&tribe=Hu&enemy=Aje"
const W = G.world, me = G.me, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const hq = W.buildings.find((b) => b.owner === me);
const name = { Hu: 'hu_temple', Aje: 'aje_temple', Ninigi: 'ninigi_temple' }[me.tribe] || 'hu_temple';
const b = W.placeBuilding(name, me, hq.pos.x + 40, hq.pos.z, 0, true);
G.step(10, 0.1);
let glow = 0; b.obj.traverse((o) => { if (o.isMesh && o.visible && o.material.userData && o.material.userData.glow) glow++; });
check('the finished temple shows the aura', b.fxShown && glow > 0, { fx: b.fxShown, glow });
const inside = (x) => { for (let o = x.node; o; o = o.parent) if (o === b.obj) return true; return false; };
const em = G.particles.emitters.filter((x) => x.node && inside(x) && /rays|particle_01/.test(x.T.tex));
check('with its emitters', em.length >= 2, em.length);
const u = W.spawnUnit(me.tribe === 'Hu' ? 'hu_warrior' : me.tribe === 'Aje' ? 'aje_warrior' : 'ninigi_warrior', me, b.pos.x + 10, b.pos.z + 10, 1);
const hp0 = u.maxHp * 0.4; u.hp = hp0;
G.step(100, 0.1);
check('a wounded unit in range heals', u.hp > hp0 + 20, { from: Math.round(hp0), to: Math.round(u.hp) });
return out.join('\n');
