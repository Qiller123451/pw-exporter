// Claw rhythm test (evaluated in the page, &class=executioner): the time between swings while the button is held, and
// while it is tapped at different rhythms. No interval may be much longer than a swing takes.
(() => {
  const P = G.player, I = G.input, out = {};
  G.mission.step = () => {};
  const times = []; const orig = P._claws.bind(P); P._claws = () => { times.push(G.time); orig(); };
  const gaps = () => { const g = times.map((t, i) => (i ? +(t - times[i - 1]).toFixed(2) : 0)).slice(1); times.length = 0; return g; };
  const god = () => { for (const c of Object.values(P.chars)) c.health = c.def.health; };
  I.mouseDown(0); G.test.run(6, god); I.mouseUp(0); out.holding = gaps();
  for (const every of [0.25, 0.4, 0.55, 0.7]) {
    G.test.run(1.5, god); times.length = 0;
    let next = 0;
    G.test.run(7, (g, t) => { god(); if (t >= next) { next += every; I.mouseDown(0); } else I.mouseUp(0); });
    I.mouseUp(0);
    out['tapEvery' + every] = gaps();
  }
  const all = Object.values(out).flat();
  out.longestGap = Math.max(...all); out.swingTime = Math.max(...P.weapon.def.combo.map((s) => s.time));
  return out;
})()
