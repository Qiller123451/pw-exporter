// Damage numbers test (evaluated in the page): hits on one enemy within a moment add up in one number, the number
// shows what was really taken (not the overkill), different enemies get their own, and the setting switches them off.
(() => {
  const P = G.player, E = G.enemies, H = G.hud, out = {};
  G.mission.step = () => {};
  for (const e of E.list.slice()) if (e.alive) E.recycle(e);
  const a = E.spawn('rammer', P.pos.x, P.pos.y, P.pos.z - 12), b = E.spawn('warrior', P.pos.x + 5, P.pos.y, P.pos.z - 12);
  a.cool = b.cool = 99;
  for (let k = 0; k < 5; k++) { a.damage(17, { kind: 'bullet' }); G.test.run(1 / 30); }
  out.fiveHitsOf17 = { numbers: H.nums.filter((n) => n.e === a).length, shows: H.nums.find((n) => n.e === a).el.textContent };
  b.damage(500, { kind: 'explosion' });
  G.test.run(1 / 30);
  const nb = H.nums.find((n) => n.e === b);
  out.overkill500OnWarrior = { shows: nb.el.textContent, health: 70, colour: nb.el.className };
  a.damage(30, { kind: 'bullet', head: true }); G.test.run(1 / 30);
  out.headShotColour = H.nums.find((n) => n.e === a).el.className;
  G.test.run(1.5); out.afterFading = H.nums.length;
  G.settings.numbers = false; a.damage(17, { kind: 'bullet' }); G.test.run(0.1); out.switchedOff = H.nums.length; G.settings.numbers = true;
  return out;
})()
