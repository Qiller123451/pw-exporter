// Walk-cycle test (evaluated in the page): while running, the legs must play the cycle part of the walk clip
// ("<clip>#l") and never pass through the standing pose. Reports for both characters which clip the legs play, its
// length, and how far a foot bone's height above the ground varies between the two halves of several cycles
// (a cycle that returns to the base pose shows a long stretch with both feet still).
(() => {
  const P = G.player, out = {};
  G.mission.step = () => {};
  for (const id of ['gunner', 'executioner']) {
    if (P.active !== id) { P.swapCd = 0; G.input.press('Tab'); G.test.run(0.3); }
    const a = P.ch.anim;
    P.yaw += Math.PI;                                       // back the way it came: free road
    G.input.press('KeyW'); G.test.run(1.0);
    const clip = a.lo.name, dur = a.duration(clip);
    // longest stretch (in s) during which the model's bones barely move while running
    const bones = []; P.ch.actor.model.traverse((o) => { if (o.isBone) bones.push(o); });
    let still = 0, worst = 0, prev = bones.map((b) => b.quaternion.clone());
    for (let i = 0; i < 240; i++) {
      G.test.run(1 / 30);
      let move = 0;
      bones.forEach((b, k) => { move = Math.max(move, prev[k].angleTo(b.quaternion)); prev[k].copy(b.quaternion); });
      if (move < 0.004) { still += 1 / 30; worst = Math.max(worst, still); } else still = 0;
    }
    G.input.release('KeyW'); G.test.run(0.5);
    out[id] = { legsClip: clip, seconds: +dur.toFixed(2), full: +a.duration(clip.replace('#l', '')).toFixed(2), longestStandstill: +worst.toFixed(2) };
  }
  return out;
})()
