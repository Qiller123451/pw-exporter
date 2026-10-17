// Delayed calls and repeating effects of the simulation are data - a kind and its arguments - so that a saved game
// carries them (game/save.js). The systems register their kinds here:
//   DELAYED[kind](world, args)                        World.later(sec, kind, args)
//   PERIODIC[kind] = {tick(world, f) -> false: stop,  World.periodicEffect(host, dur, every, kind, s, now);
//                     end(world, f)}                   f = {host, end, every, next, kind, s}
//   JOBS[kind](engine, args, trigger)                 the campaign's TriggerEngine.after(sec, kind, args, trigger)
export const DELAYED = Object.create(null);
export const PERIODIC = Object.create(null);
export const JOBS = Object.create(null);
