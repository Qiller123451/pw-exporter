# Particle source 3 (the models' emitters) - from PWClient.exe

Nearly every particle emitter of the models (10430 of 10439 in Base) is particle source type 3, a native class of
the client (types 0-2 are USL classes, `Data/Base/Scripts/gfx/particle.usl`). Reverse-engineered from PWClient.exe
(image base 0x400000) on 2026-10-18; the remake's port is `src/engine/particles.js`.

## Where
- `CParticleMgr::AllocSource` 0x7093d0: switch on the type (byte table 0x709620, jump table 0x709604); type 3 ->
  0x7094ec, object of 0x190 bytes, vtable 0x88b54c: Init 0x706c60, Process(dt) 0x704a10, InitPart(id, reInit)
  0x709740, ProcPart(id, dt) 0x707e30, parameters 0x7079e0.
- The emitter record of the model (GSF chunk 2): position E (`+0x10`), the vector (`+0x2c`, the file's "scale" -
  the scripts call it **m_vVel**), quaternion q (`+0x1c`, applied conjugated), max (`+0x38`), spread (`+0x3c`,
  `+0x48` when skinned).
- `FRand` 0x703bb0 (MS LCG, [0, 1)).

## InitPart (0x709740)
- Start: a point of a disk of radius `vel.x` in the emitter's plane (x, y; uniform: r = sqrt(u) * vel.x). `vel.y`
  is not read. Flags: 0x1 a sphere, 0x800000 the upper half sphere, 0x200 the ring's edge only.
- Velocity (emitter frame: z = its axis):
  - default: (h * k, 0.7 * vel.z) with h the start point's offset in the plane; k (constructor 0x707d06)
    = |(0.7 vel.z, max(vel.x, 0.01))| * sin(spread) / max(vel.x, 0.01) when spread > -pi/2, else no factor (the
    stored -1.5708 is just below -pi/2: "no spread"). So at the disk's edge the outward speed is
    |(0.7 vel.z, vel.x)| * sin(spread); a negative spread draws particles in. 0x8000000: every particle gets the
    edge's speed; 0x10000000: no y part.
  - 0x2: a random point of the sphere times 0.7 vel.z / vel.x; 0x40: that point's direction times vel.z; 0x10000: the
    horizontal direction times vel.z (these three along the model's axes, not turned by q). 0x20000: never down.
- life = life_time * (1 - FRand * life_time_var); 0x80: age 0, else (first start) a random age.
- size = size * (1 + FRand * size_var); colour = colour - Rand % colour_var (per channel); speed * (1 + FRand *
  speed_var); rotation 0 when `rotate` is 0, else random (or running by `emit_rot_inc` degrees).
- 0x80000: the particle lives in the world (position and velocity through the emitter's matrix), else in the
  emitter's frame - it moves with its model.

## ProcPart (0x707e30), in this order
- age += dt; at the end of its life it wraps and is hidden (InitPart starts it again).
- Unless 0x2000000 (still): velocity *= 1 - min(1, drag * dt); velocity += gravitation * dt **down in the world**
  (m/s², world units whatever the model's scale; 0x4000000: along the emitter's -z); center_suck: a spring to the
  emitter (velocity += center_suck * dt * (centre - pos - suck_vel * velocity)); position += velocity * dt.
- rotate > 0: rot += +-(rotate + random * rotation_var) * dt.
- size += dt * size_increase * (size_inc_exp ? age^size_inc_exp : 1)  - per second, not over the life.
- fade_in / fade_out are shares of the life. 0x8000 fades colour and alpha, 0x4000 alpha only, else colour only.
- Tile: tile_anim_speed cycles per life; 0x100 forward, 0x400 backward, 0x800 / 0x1000 ping-pong; else the start
  tile (first / last / random) stays.
- 0x20000000: the sprite points the way the particle flies on the screen (sparks, the rising rays of the healing
  aura), plus `rotate`.

## Process (0x704a10): emission
- Every slot (max) is processed each frame; a slot whose life ended starts again at once when the source may emit,
  else it stays hidden. Without 0x80 the slots start at random ages (a steady stream from the first frame); with
  0x80 they start together (a burst) and a hidden slot waits until emission is allowed, then all go together.
- emit_timer > 0: emission only on the frame the timer runs out (then it restarts at FRand * emit_timer_var *
  emit_timer): the stones' twinkle, bursts every few seconds.
- dt: real frame time, at most 1 s (the 25 fps tick of particle.usl is the script sources').
- emit_per_meter (ship wakes, arrow trails): one particle per 1 / emit_per_meter metres the emitter moved
  (moveDelta, SetMatrix 0x703f70: the emitter's movement since the last frame in its model's frame); the slots
  start hidden; distance left over carries to the next frame. New particles start somewhere along that movement
  (EmitPos 0x703ac0) unless flag 0x1000000.
- 0x80000 (world-space particles) also inherit half the model's speed (srcVel: the world movement smoothed with a
  0.08 s time constant), which fades with 1 - 0.5 dt per frame.

## More of ProcPart / the renderer
- src_rot_speed (rad/s): the particle turns about the emitter's axis - R = rotation by -theta about z; about the
  emitter pos' = E + 2e - R e (to first order +theta, slowly spiralling out), with 0x400000 R pos about the model's
  origin. With 0x20000000 the sprite then points along that motion.
- 0x40000000: the sprite lies flat in the world's ground plane at the particle's height, a square with the
  half-diagonal size / 8, turned by rot (with 0x20000000: the heading of its flight on the ground, + pi). Ship
  wakes, waterfall feet, the healing well.
- Level of detail (0x703e40): with d = the model origin's distance from the camera minus ParticleSrcOffset (config
  "Rendering", default 120 m), a source keeps all its slots for d <= 0, max * (1 - d / ParticleSrcDist (100 m)) *
  load + 2 of them below 100, none beyond; load = 1 - clamp((count / limit - 0.75) * 4) once the last frame drew
  at least half of ParticleLimit (5000).
- Fade (0x705191): a particle farther from the camera than the fog's start fades by (end - d) / (end - start) and
  is not drawn beyond its end - the scene's linear fog (the sky renderer sets it each frame from the sky colour,
  the view's tilt and ViewDepth; the remake: its fixed scene fog).
- Not ported: the 0x400000 orbit about the model's origin (no model uses it).
- "No emission while the emitter is below its model's origin (z < 0) without 0x40000" (Process 0x704a91): ported for
  emitters an animation drives. Their particle animation chunk (0x40000002: +8 the emitter's guid, +16 the offset of the
  positions, +20 the number of frames; one position per frame in the model's frame) moves them: the SEAS turret's muzzle flashes rest 4 m
  under the turret, and in its attack the keys put them at the barrel's end on the frames that fire and back inside
  the turret (z < 0) on the others - the flicker. pwexport/gsf.py exports the keys as the node's translation track.

## Before (the remake's guess, until 2026-10-18)
The vector was taken as the half sizes of an emitting box with random speeds. The hit sparks (vel.z 26.5) and the
blood spray (6.7) then filled a column 13-53 m high above a struck unit ("a pillar of light", user report).
