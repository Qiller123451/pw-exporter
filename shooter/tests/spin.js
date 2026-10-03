// Regression test: the aim twist of the spine must not accumulate (the torso used to wind round on a still pose).
// Stands still looking up for 3 s (and through a pause-like dt = 0 stretch) and reports how far the chest bone's
// world orientation drifts between frames; a healthy value is ~0.
(() => {
  const P = G.player, a = P.ch.anim, b = a.spine[a.spine.length - 1];
  const THREE_Q = b.quaternion.constructor;
  const q0 = new THREE_Q(), q1 = new THREE_Q();
  P.pitch = 0.6; P.yaw += 0.8;
  G.test.run(1.5);
  b.getWorldQuaternion(q0);
  let worst = 0;
  for (let i = 0; i < 90; i++) { G.test.run(1 / 30); b.getWorldQuaternion(q1); worst = Math.max(worst, q0.angleTo(q1)); }
  for (let i = 0; i < 60; i++) { P.animate(0); b.getWorldQuaternion(q1); worst = Math.max(worst, q0.angleTo(q1)); }
  return { spine: a.spine.length, worstDriftDeg: +(worst * 57.3).toFixed(2) };
})()
