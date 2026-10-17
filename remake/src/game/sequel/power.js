// Electricity, the sequel's fifth resource (docs/SEQUEL.md "Power"). Only the sequel uses it.
//
// Plants make it: the generating stations of the maps and the diesel generators and water wheels the player builds
// need workers (a worker's job at the plant: systems/economy.js, farmKind 'power', credited here through
// World.hooks.power); windmills turn by themselves. A plant delivers only while a line connects it to a hub (the
// headquarters or a field command post): power poles, each within RANGE of the next. Lines can be cut: a destroyed
// pole cuts off everything behind it. Power is stockpiled like skulls (no storage cap) and spent on the electric
// units and structures (game/sequel/rules.js).
import { tagsOf } from './rules.js';

export const RANGE = 40;                  // the longest span between two poles (m)
// per worker per second / per second without workers; slots = workers the plant takes (its maxworkers)
export const PLANTS = {
  sq_power_station: { perWorker: 1.2, base: 0 },
  sq_generator: { perWorker: 0.5, base: 0 },
  sq_watermill: { perWorker: 0.8, base: 0.15 },
  sq_windmill: { perWorker: 0, base: 0.35 },
};
// where the wires hang on each kind of node (height above its ground, m)
const ATTACH = { sq_power_pole: 10.8, sq_power_station: 9, sq_generator: 2.6, sq_watermill: 4.5, sq_windmill: 7, sq_field_hq: 4.5 };

export const isPlant = (b) => !!PLANTS[b.name];
export const isPole = (b) => tagsOf(b.name).includes('pole');
export const isHub = (b) => /headquarters$/.test(b.name) || tagsOf(b.name).includes('commandpost');
export const attachHeight = (b) => ATTACH[b.name] || 10;

export class Grid {
  constructor(M) {
    this.M = M;
    this.links = [];          // [a, b] pairs of the lines as drawn (sequel_ui.js)
    this.key = '';
    this.t = 0;
  }
  get W() { return this.M.W; }
  nodes(p) { return this.W.buildings.filter((b) => b.alive && b.built && b.owner === p && (isPlant(b) || isPole(b) || isHub(b))); }
  // which plants and poles reach a hub; the lines as a forest (every node hangs on its nearest reached neighbour)
  update(dt) {
    const M = this.M, me = M.me;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.5;
    const ns = this.nodes(me);
    const key = ns.map((b) => b.id).join(',');
    if (key !== this.key) {
      this.key = key;
      for (const b of ns) { b.sqPowered = false; b.sqLink = null; }
      const near = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) <= RANGE + (isHub(a) || isHub(b) ? 12 : 0);
      // a breadth-first walk from the hubs over poles (plants pass nothing on: a plant next to a plant is not a line)
      const queue = ns.filter(isHub);
      for (const h of queue) h.sqPowered = true;
      while (queue.length) {
        const a = queue.shift();
        if (isPlant(a)) continue;
        for (const b of ns) {
          if (b.sqPowered || isHub(b) || !near(a, b)) continue;
          b.sqPowered = true; b.sqLink = a; queue.push(b);
        }
      }
      // the dead ends: poles not reached still hang on their nearest pole (drawn, but carrying nothing)
      for (const b of ns) {
        if (b.sqPowered || isHub(b)) continue;
        let best = null, bd = RANGE;
        for (const c of ns) { if (c === b || isPlant(c) || isHub(c)) continue; const d = Math.hypot(b.pos.x - c.pos.x, b.pos.z - c.pos.z); if (d <= bd && (c.sqLink !== b)) { bd = d; best = c; } }
        b.sqLink = best;
      }
      this.links = ns.filter((b) => b.sqLink).map((b) => [b, b.sqLink]);
    }
    // windmills (and the trickle of a water wheel) make power without workers
    for (const b of ns) {
      const P = PLANTS[b.name];
      if (P && P.base && b.sqPowered) me.deliver('power', P.base * 0.5, this.W.time);
    }
  }
  // a worker's work loop at a plant (World.hooks.power)
  credit(u, b, sec) {
    const P = PLANTS[b.name];
    if (!P || !b.owner) return;
    if (b.sqPowered) b.owner.deliver('power', P.perWorker * sec, this.W.time);
  }
  // what the plants make now, per minute: connected and cut off (the HUD)
  rates() {
    const me = this.M.me;
    let on = 0, off = 0, plants = 0, cut = 0;
    for (const b of this.W.buildings) {
      if (!b.alive || !b.built || b.owner !== me || !isPlant(b)) continue;
      const P = PLANTS[b.name];
      const r = (P.base + P.perWorker * (b.workers ? b.workers.size : 0)) * 60;
      plants++;
      if (b.sqPowered) on += r; else { off += r; cut++; }
    }
    return { on: Math.round(on), off: Math.round(off), plants, cut };
  }
}
