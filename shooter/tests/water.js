// Water test (evaluated in the page, ?mission=assault): the player walks straight into a pond that is deep in the
// middle. He must stop where the water gets deep - not be thrown back ("teleported") by the rescue from the sea.
// Returns the largest jump of the position in one frame (a walk is < 1 u), how deep he got, and the rescue count.
(() => {
  const P = G.player, L = G.level, col = L.collision, W = L.water, out = {};
  G.mission.step = () => {};
  const god = () => { for (const c of Object.values(P.chars)) { c.health = c.def.health; c.alive = true; } };
  // the deepest spot within the pond at (-104, -520), and a place on the shore 26 u away from it
  let best = null, bh = 1e9;
  for (let z = -540; z <= -500; z += 2) for (let x = -124; x <= -84; x += 2) { const h = L.height(x, z); if (h < bh) { bh = h; best = [x, z]; } }
  out.pond = { at: best, depth: +(W - bh).toFixed(1) };
  let start = null;
  for (let a = 0; a < 6.283 && !start; a += 0.3) { const x = best[0] + Math.cos(a) * 26, z = best[1] + Math.sin(a) * 26; if (L.height(x, z) > W + 0.5 && G.nav.nearest(x, z, null, 1) >= 0) start = [x, z]; }
  P.pos.set(start[0], col.groundAt(start[0], start[1], 500), start[1]); P.vel.set(0, 0, 0);
  P.yaw = Math.atan2(-(best[0] - start[0]), -(best[1] - start[1]));
  let rescues = 0; const oh = P.hurt.bind(P); P.hurt = (a, f, raw) => { if (raw && a === 8) rescues++; return oh(a, f, raw); };
  let maxJump = 0, last = P.pos.clone(), deepest = 0;
  G.input.press('KeyW');
  G.test.run(6, () => { god(); maxJump = Math.max(maxJump, P.pos.distanceTo(last)); last.copy(P.pos); deepest = Math.max(deepest, W - col.groundAt(P.pos.x, P.pos.z, P.pos.y + 1)); });
  G.input.release('KeyW');
  out.walkedIn = { largestStep: +maxJump.toFixed(2), deepestWater: +deepest.toFixed(2), allowed: CFG_WADE(), stoppedShortOfTheMiddle: +Math.hypot(P.pos.x - best[0], P.pos.z - best[1]).toFixed(1), rescues };
  function CFG_WADE() { return 1.3; }
  // a jetpack jump across is still possible (and ends on land or in the rescue, never in a wall in the air)
  P.pos.set(start[0], col.groundAt(start[0], start[1], 500), start[1]); P.vel.set(0, 0, 0); G.input.press('KeyW'); G.input.press('KeyQ'); G.test.run(0.1, god); G.input.release('KeyQ');
  let far = 0; G.test.run(3, () => { god(); far = Math.max(far, Math.hypot(P.pos.x - start[0], P.pos.z - start[1])); }); G.input.release('KeyW');
  out.jetpackJump = { farthestFromStart: +far.toFixed(1), rescues };
  out.error = G.error || null;
  return out;
})()
