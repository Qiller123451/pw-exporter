// Aim test (evaluated in the page): does the barrel of every weapon point where the camera looks - standing, strafing,
// looking up and down, ready and firing? Reports the yaw / pitch difference in degrees (a few degrees are expected:
// the gun is beside the camera and both lines meet 45 u away). Also checks the Executioner's controls: left button =
// claws, right button held = minigun raised, left button then fires it.
(() => {
  const P = G.player, out = {}, V = P.pos.constructor;
  G.mission.step = () => {};
  const yawOf = (v) => Math.atan2(-v.x, -v.z) * 57.3, pitOf = (v) => Math.asin(v.y) * 57.3;
  const measure = (tag) => {
    const from = new V(), d = new V();
    for (const pitch of [-0.5, 0, 0.5]) for (const fire of [0, 1]) for (const move of [0, 1]) {
      P.pitch = pitch; P.yaw = 0.7;
      if (fire) G.input.mouseDown(0); else G.input.mouseUp(0);
      if (move) G.input.press('KeyA'); else G.input.release('KeyA');
      G.test.run(0.7);
      P.ch.actor.obj.updateMatrixWorld(true);
      const ok = P.barrel(from, d);
      const aim = G.engine.camera.getWorldDirection(new V());
      let dy = yawOf(d) - yawOf(aim); dy = ((dy + 540) % 360) - 180;
      out[`${tag} p${pitch} f${fire} m${move}`] = ok ? `yawOff ${dy.toFixed(1)} pitchOff ${(pitOf(d) - pitOf(aim)).toFixed(1)} w=${P.weapon.id}` : 'no barrel';
    }
    G.input.mouseUp(0); G.input.release('KeyA');
  };
  for (let wi = 0; wi < 3; wi++) { G.input.press('Digit' + (wi + 1)); G.test.run(0.3); measure(P.weapon.id); }
  P.swapCd = 0; G.input.press('Tab'); G.test.run(0.3);
  out.exNoAim = P.weapon.id;
  G.input.mouseDown(0); G.test.run(0.3); out.exClaw = [P.weapon.id, P.busy > 0, P.chars.executioner.weapons[1].ammo];
  G.input.mouseUp(0); G.test.run(1.2);
  G.input.mouseDown(2); G.test.run(0.3); out.exAim = P.weapon.id;
  measure('ex');
  G.input.mouseDown(0); G.test.run(1.0); out.exShot = [P.weapon.id, P.chars.executioner.weapons[1].ammo];
  G.input.mouseUp(0); G.input.mouseUp(2); G.test.run(0.3); out.exBack = P.weapon.id;
  return out;
})()
