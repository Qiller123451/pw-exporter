// The skirmish game types (systems/gameover.js): Domination - the map's flags go to who stands alone at them, all
// flags of one team start its 10 minute timer; Defender - the player on head quarter 1 holds out against the others
// for the setup's minutes or loses with its defender objects.
//   python3 tests/evaljs.py tests/skirmish_modes.js "&players=Hu,Aje&mode=domination&map=maps/Base/Base/Multiplayer/death_valley.ula"
//   python3 tests/evaljs.py tests/skirmish_modes.js "&players=Hu,Aje,Ninigi&mode=defender&hq=0,1,2&map=maps/Base/Base/Multiplayer/die_zitadelle.ula"
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const step = (s, dt = 0.1) => { for (let i = 0; i < s; i += 5) { G.step(Math.min(50, Math.round((s - i) / dt)), dt); if (G.fx) G.fx.update(5); } };
const GO = W.go, me = G.me, ai = W.players[1];
ok(GO && GO.on && GO.mode === W.rules.mode, 'the game type is on: ' + W.rules.mode);
ok(W.rules.diplomacyLocked, 'Domination and Defender lock the diplomacy');
if (W.rules.mode === 'domination') {
  ok(GO.flags.length >= 1 && GO.flags.every((f) => f.owner === null), 'the map\'s flags, nobody\'s', GO.flags.length);
  const fighter = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_warrior' }[me.tribe];
  // my soldiers at every flag: they go up in 10 s, then my team's timer runs
  for (const f of GO.flags) for (let i = 0; i < 2; i++) W.spawnUnit(fighter, me, f.x + i * 1.5, f.z + 2, 2);
  step(14);
  ok(GO.flags.every((f) => f.owner === me), 'alone at a flag: it is mine after its 10 s', GO.flags.map((f) => f.owner && f.owner.id));
  ok(GO.dom && GO.dom.team === me.team && !GO.dom.paused && GO.dom.left < 600, 'all flags: the domination timer runs', GO.dom && [GO.dom.team, Math.round(GO.dom.left), GO.dom.paused]);
  G.hud.refreshTimers();
  ok(W.goTimers().some((t) => t.icon === 'domination') && !!document.querySelector('.timers .tm'), 'the HUD shows the timer');
  // an enemy alone at one flag: it goes down and up to him, my timer pauses
  const f0 = GO.flags[0];
  for (const u of W.units) if (u.alive && u.owner === me && Math.hypot(u.pos.x - f0.x, u.pos.z - f0.z) < 25) W.kill(u, null);
  const efighter = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_warrior' }[ai.tribe];
  for (let i = 0; i < 2; i++) W.spawnUnit(efighter, ai, f0.x + i * 1.5, f0.z - 2, 2);
  step(GO.flags.length > 1 ? 24 : 24);
  ok(f0.owner === ai, 'the enemy took it (down and up again)', f0.owner && f0.owner.id);
  ok(GO.flags.length > 1 ? (GO.dom && GO.dom.paused) : (GO.dom && GO.dom.team === ai.team), GO.flags.length > 1 ? 'flags of two teams: the timer pauses' : 'his timer now', GO.dom && [GO.dom.team, GO.dom.paused]);
  // all flags mine again, nobody else at them; the timer runs out: my team wins
  for (const u of W.units) if (u.alive && u.owner === ai && Math.hypot(u.pos.x - f0.x, u.pos.z - f0.z) < 25) W.kill(u, null);
  for (const f of GO.flags) { f.owner = me; f.stack = []; f.timer = null; }
  W.checkDomination();
  GO.dom.left = 0.5;
  step(3);
  ok(GO.dom === null && me.won && ai.defeated, 'its timer at 0: that team wins', [me.won, ai.won]);
} else {
  const def = GO.def && GO.def.player;
  ok(def && def.hq === 0 && def.team === 1 && W.players.filter((p) => p !== def).every((p) => p.team === 2), 'head quarter 1 defends (team 1), the others attack (team 2)', W.players.map((p) => [p.hq, p.team]));
  const objs = W.buildings.filter((b) => b.alive && b.name === 'defender_object');
  ok(objs.length >= 1, 'the defender objects of the map', objs.length);
  ok(GO.def.left === W.rules.defenderMin * 60 && W.goTimers().some((t) => t.icon === 'defender'), 'the defender timer (the setup\'s minutes)', GO.def.left);
  step(3);
  for (const b of objs) W.kill(b, null);
  step(3);
  ok(def.defeated && W.players.filter((p) => p !== def).every((p) => p.won), 'all defender objects destroyed: the defender loses', W.players.map((p) => [p.won, p.defeated]));
}
return out.join('\n');
