// Effects the campaign triggers play (EFCT; game/campaign/engine.js playEffect): the model of the particle database
// (Scripts/Game/sequencer/particles.txt) stands at the spot for loop_value × its length and sprays, then goes.
// python3 tests/evaljs.py tests/trigger_effects.js "&campaign=1"
const out = [], E = G.campaign.engine, W = G.world;
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
check('the particle database is in the game data', Object.keys(G.data.extra.particles || {}).length > 100);
check('mission 1\'s effect model is loaded with it', !!W.template('fx_stina_convert', true));
const u = W.units.find((x) => x.alive && x.owner === G.me);
E.playEffect('/Particle/FX/Effects/fx_stina/', u.pos.x, u.pos.z, 1);
G.step(3, 0.1);
const f = [...E.fxObjs.values()][0];
check('the effect stands at the spot', !!f && f.obj.parent === W.scene && Math.hypot(f.obj.position.x - u.pos.x, f.obj.position.z - u.pos.z) < 0.1);
G.rtscam.x = u.pos.x; G.rtscam.z = u.pos.z; G.rtscam.dist = 30; G.rtscam.update(0.016); G.drawNow(0.05);
// (fx_stina_convert: a burst - flag 0x80 - every 4 s, each particle lives 2 s: look over the whole time)
let most = 0;
for (let i = 0; i < 30; i++) { G.particles.update(0.1, G.camera, G.rtscam.target, 1); most = Math.max(most, G.particles.drawn || 0); await new Promise((r) => setTimeout(r, 80)); }
check('and sprays', most > 0, most);
G.step(60, 0.1);
check('it goes after its time', E.fxObjs.size === 0 && E.effects.length === 0 && !f.obj.parent);
return out.join('\n');
