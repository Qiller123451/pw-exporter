// Wild animals as the original's scripts run them (docs/spec/units.md section 7): nests and their areas, flocks,
// babies growing up, the idle loop (walk targets, sleep, hunger and feeding), hunters looking for prey, the reaction
// to an attack (fight, call for help, flee), the scare of a death, the threat when an enemy comes near.
// Also the autonomous animals of kennels and hatchlings (they roam and hunt around their home).
//
// Reference: Animal.usl (CAnimal), Nest.usl (CNest), Flock.usl, ScareMap.usl, task/Feed.usl, task/Sleep.usl,
// task/Fight.usl (CFlee, CAlarmed).
//   aggressive -1: peaceful, always flees       0: neutral, fights back and alerts its kind       1: hunter
//
// Times are game seconds (the original's virtual times: 144 virtual seconds a second, World.dayTime).
//   unit fields: wildNest (its nest), flock, born / growup (a nest's young: born at, grows up in growup s; grow =
//   the share of its strength 0.2 .. 1), fatigue (fleeing), fedT (last meal), food (cache) / foodT, nextWalk,
//   agilityT, alarmT

// wild animals alive at once on a map (performance guard; big community maps have 60+ nests)
export const WILD_CAP = 260;
const IDLE_TICK = 0.6;            // OnIdleTick: every 6th idle tick decides what to do
const SCARE_R = 60, SCARE_STR = 360, SCARE_DECAY = 0.1;     // Animal.OnKill: AddScareSource(pos, 60, 360); ScareMap: 0.1 a second
const FLEE_WALK = 15, FLEE_DIST = 40, FLEE_LEGS = 8;         // CFlee

// ---------------------------------------------------------------- areas (the nests' regions: Nest.usl)
// shapes [{oval, x0, z0, x1, z1}] in game coordinates; an oval is the ellipse inscribed in its box
export class Area {
  constructor(shapes) { this.shapes = shapes.filter((s) => s.x1 > s.x0 && s.z1 > s.z0); }
  get empty() { return !this.shapes.length; }
  contains(x, z) {
    for (const s of this.shapes) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      if (!s.oval) return true;
      const a = (s.x1 - s.x0) / 2, c = (s.z1 - s.z0) / 2;
      if (((x - s.x0 - a) / a) ** 2 + ((z - s.z0 - c) / c) ** 2 <= 1) return true;
    }
    return false;
  }
  // CRegion.GetRandomPointInside: a sub-shape (by size), a point in it
  randomPoint(rand = Math.random) {
    if (this.empty) return null;
    let tot = 0;
    for (const s of this.shapes) tot += (s.x1 - s.x0) * (s.z1 - s.z0);
    let r = rand() * tot, s = this.shapes[0];
    for (const t of this.shapes) { r -= (t.x1 - t.x0) * (t.z1 - t.z0); if (r <= 0) { s = t; break; } }
    for (let i = 0; i < 20; i++) {
      const x = s.x0 + rand() * (s.x1 - s.x0), z = s.z0 + rand() * (s.z1 - s.z0);
      if (!s.oval || this.contains(x, z)) return [x, z];
    }
    return [(s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2];
  }
  radius() { let r = 0; for (const s of this.shapes) r = Math.max(r, (s.x1 - s.x0) / 2, (s.z1 - s.z0) / 2); return r; }
  static circle(x, z, r) { return new Area([{ oval: true, x0: x - r, z0: z - r, x1: x + r, z1: z + r }]); }
}

const growup = (W, name) => { const d = W.data.def(name, null); return (d && d.growup) || 0; };
const isWildish = (u) => !u.owner || u.autonomous;

export const Animals = {
  // ---------------------------------------------------------------- nests (Nest.usl, docs/spec/units.md 7.4)
  // n = {name, species, x, z, max, rate, amount, swim, grown, areas: {action, safe, hotspot} (shapes), table (the
  // hotspots' day times [[sub area, from hour, to hour]]), agility, density}; members = animals already there
  // ([{u, born}] - pre-spawned by advance_time)
  addWildNest(n) {
    const def = this.data.def(n.species, null) || {};
    const nest = {
      ...n, members: [], t: 0, alive: 0, lastRandom: [n.x, n.z],
      action: n.areas && n.areas.action && n.areas.action.length ? new Area(n.areas.action) : Area.circle(n.x, n.z, 20),
      safe: n.areas && n.areas.safe && n.areas.safe.length ? new Area(n.areas.safe) : Area.circle(n.x, n.z, 10),
      hotspots: ((n.areas && n.areas.hotspot) || []).map((s) => new Area([s])),
      agility: def.agility > 0 ? def.agility : 30, density: def.density || 0,
      flockPos: [n.x, n.z], flockT: 0, checkT: 0, flock: null,
    };
    for (const m of n.members || []) if (m.u) this.joinNest(nest, m.u, m.born);
    // CNest.SpawnAnimal "Flocking": nests whose safe area holds another nest share that one's flock
    for (const o of this.wildNests) if (o.flock && nest.safe.contains(o.x, o.z)) { nest.flock = o.flock; break; }
    if (!nest.flock) nest.flock = { members: new Set(), pos: [n.x, n.z], size: 0 };
    for (const u of nest.members) this.flockAdd(nest.flock, u);
    nest.alive = nest.members.length;
    this.wildNests.push(nest);
    this.updateFlockPos(nest);
    return nest;
  },
  joinNest(nest, u, born) {
    u.wildNest = nest;
    u.home.set(nest.x, nest.z);
    nest.members.push(u);
    if (born != null) this.birth(u, born);
  },
  // Nest.SpawnAnimal: one animal at the nest; a baby unless the nest spawns them grown (born 2 days ago)
  spawnFromNest(nest) {
    const u = this.spawnUnit(nest.species, null, nest.x, nest.z, undefined, Math.random() * 6.28, nest.swim ? { swim: true } : {});
    if (!u) return null;
    this.joinNest(nest, u, nest.grown ? this.time - 2 * 600 : this.time);
    if (nest.flock) this.flockAdd(nest.flock, u);
    if (nest.amount > 0) nest.amount--;
    return u;
  },
  wildNestsUpdate(dt) {
    this.nestT = (this.nestT || 0) - dt;
    if (this.nestT > 0) return;
    const step = 1 - this.nestT; this.nestT = 1;                // once a second
    const wild = this.units.reduce((n, u) => n + (u.alive && u.wild ? 1 : 0), 0);
    for (const n of this.wildNests) {
      const before = n.members.length;
      n.members = n.members.filter((u) => u.alive && u.wildNest === n);
      if (n.members.length < before) n.t = 0;                   // a member died: the spawn timer starts again
      n.alive = n.members.length;
      if (n.alive < n.max && n.amount !== 0 && wild < WILD_CAP) {
        n.t += step;
        if (n.t >= n.rate) { n.t = 0; if (this.spawnFromNest(n)) n.alive++; }
      }
      // TIMER_UPDATEPOS: the flock's centre moves every `agility` s; TIMER_CHECK_AREA: every 2 s, members outside the
      // action area walk back
      if ((n.flockT -= step) <= 0) { n.flockT = n.agility; this.updateFlockPos(n); }
      if ((n.checkT -= step) <= 0) { n.checkT = 2; this.checkNestArea(n); }
    }
    // the flocks' centres (Flock.Update: every second)
    for (const f of new Set(this.wildNests.map((n) => n.flock))) this.updateFlock(f);
  },
  flockAdd(f, u) { u.flock = f; f.members.add(u); this.flockSize(f); },
  // Flock.UpdateSize: the sum of the members' sizes; UpdatePos: their centre
  flockSize(f) { let s = 0; for (const u of f.members) if (u.alive) s += 2 * Math.SQRT2 * u.radius; f.size = s; },
  updateFlock(f) {
    let x = 0, z = 0, n = 0;
    for (const u of [...f.members]) { if (!u.alive) { f.members.delete(u); continue; } x += u.pos.x; z += u.pos.z; n++; }
    if (n) f.pos = [x / n, z / n];
    this.flockSize(f);
  },
  // Nest.GetRandomPoint: babies anywhere in the safe area; else a point of the action area (not too near the last
  // one), moved along its direction from the flock centre (up to the nest's flock size) - or, ignoring the flock,
  // just the point
  nestPoint(n, baby, ignoreFlock) {
    if (baby) return n.safe.randomPoint();
    let p = null;
    const v = Math.min(10, n.action.radius() / 4);
    for (let i = 0; i < 100; i++) {
      const q = n.action.randomPoint();
      if (!q) break;
      p = q;
      if (Math.abs(q[0] - n.lastRandom[0]) + Math.abs(q[0] - n.lastRandom[1]) > v) break;     // (sic: the x twice)
    }
    if (!p) return null;
    n.lastRandom = p;
    if (ignoreFlock) return p;
    const size = 2 * Math.max(n.density, 5) * Math.sqrt(n.members.length / Math.PI);
    let dx = p[0] - n.flockPos[0], dz = p[1] - n.flockPos[1];
    let len = Math.hypot(dx, dz);
    if (!len) return p;
    dx /= len; dz /= len;
    if (len > size) len = Math.random() * size;
    return [p[0] + dx * len, p[1] + dz * len];
  },
  // Nest.AcceptablePos
  nestAccepts(n, x, z, baby, ignoreFlock) {
    if (baby) return n.safe.contains(x, z);
    if (!n.action.contains(x, z)) return false;
    if (ignoreFlock || !n.flock) return true;
    return Math.hypot(x - n.flockPos[0], z - n.flockPos[1]) <= n.flock.size;
  },
  // Nest.UpdateFlockPos: a hotspot of the time of day (60 %), else by day anywhere in the action area, at night in the
  // safe area; then every member gets a next walk target
  updateFlockPos(n) {
    let p = null;
    if (n.hotspots.length && Math.random() < 0.6) {
      const h = Math.floor(this.dayTime() / 3600) % 24;
      const e = (n.table || []).find(([, a, b]) => (a > b ? h >= a || h < b : h >= a && h < b));
      if (e && n.hotspots[e[0]]) p = n.hotspots[e[0]].randomPoint();
    }
    if (!p) p = !n.members.length || !this.sleepTime(n.members[0]) ? n.action.randomPoint() : n.safe.randomPoint();
    n.flockPos = p || [n.x, n.z];
    for (const u of n.members) if (u.alive) u.nextWalk = this.nestPoint(n, this.isBaby(u));
  },
  checkNestArea(n) {
    for (const u of n.members) {
      if (!u.alive || n.action.contains(u.pos.x, u.pos.z) || u.task.type === 'flee') continue;
      const t = u.task;
      if (t.type === 'roam' && t.phase === 'walk' && t.to && (n.action.contains(t.to[0], t.to[1]) || n.safe.contains(t.to[0], t.to[1]))) continue;
      if (t.type !== 'roam') continue;                         // (a fight leaves when its target goes: combat.js)
      const p = this.nestPoint(n, this.isBaby(u));
      if (p) this.animalWalk(u, p[0], p[1]);
    }
  },

  // ---------------------------------------------------------------- growing up (Animal.Birth, CalculateHitpointsFromGrowUpSize)
  // a nest's young: born at `born`; until it has grown up (the class's growup_duration) its hit points, damage and
  // skulls are a share of the grown animal's (strength = age / growup, at least 20 % of the hit points and damage) and
  // its model is smaller (the client blends the model's "growup" pose by 1 - age / growup)
  birth(u, born) {
    const g = growup(this, u.name);
    if (!(g > 0)) return;
    u.born = born; u.growup = g;
    this.growthUpdate(u);
  },
  isBaby(u) { return u.born != null && this.time - u.born < u.growup; },
  growthUpdate(u) {
    if (u.born == null) return;
    const age = this.time - u.born, k = age / u.growup;
    const grow = k >= 1 ? 1 : Math.max(0.2, k);
    if (grow !== u.grow) {
      const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 1;
      u.grow = grow;
      u.maxHp = u.stats.hp * grow;
      u.hp = Math.max(1, Math.min(u.maxHp, ratio * u.maxHp));
    }
    u.babyness = Math.max(0, 1 - k);
    if (u.obj && u.anim) {
      if (u.babyScale === undefined) u.babyScale = growupScale(u.anim);
      u.obj.scale.setScalar(1 - u.babyness * (1 - u.babyScale));
    }
    if (k >= 1) { u.born = null; u.babyness = 0; }
  },
  // its skulls (CalculateScalpsFromGrowUpSize: by the strength without the 20 % floor, at least 1)
  scalpValue(e) {
    const v = e.stats.scalps;
    if (e.born == null || !(e.growup > 0)) return v;
    const k = (this.time - e.born) / e.growup;
    return k >= 1 ? v : Math.max(Math.trunc(v * k + 0.5), 1);
  },

  // ---------------------------------------------------------------- the idle loop (Animal.OnIdleTick)
  sleepTime(u) { return this.isNight() !== !!(u.def && u.def.nightactive); },
  hungry(u) { return this.time - (u.fedT ?? -1e9) >= ((u.def && u.def.repletion) || 0); },
  roamUpdate(u, dt) {
    const t = u.task;
    if (u.tracker) return this.trackerUpdate(u, dt);
    if (u.born != null && (u.growT = (u.growT || 0) - dt) <= 0) { u.growT = Math.max(1, u.growup / 10); this.growthUpdate(u); }
    if (this.preCheckEnemies(u, dt)) return;
    // the agility timer (an animal without a nest): every `agility` s the next walk target
    if (!u.wildNest && (u.agilityT = (u.agilityT ?? Math.random() * 5) - dt) <= 0) {
      u.agilityT = (u.def && u.def.agility > 0) ? u.def.agility : 15;
      this.calcNextWalk(u);
    }
    switch (t.phase) {
      case 'walk': return this.walkUpdate(u, dt);
      case 'sleep': return this.sleepUpdate(u, dt);
      case 'feed': return this.feedUpdate(u, dt);
      case 'threat': return this.threatUpdate(u, dt);
      case 'wait':
        u.vel.set(0, 0, 0);
        if (!u.busyAnim) u.anim.play(u.idleAnim);
        if ((t.wait -= dt) > 0) return;
        t.phase = 'idle'; t.tick = 0;
        return;
      default: break;
    }
    // idle: what to do next
    u.vel.set(0, 0, 0);
    if (!u.busyAnim) u.anim.play(u.idleAnim);
    if ((t.tick = (t.tick ?? Math.random() * IDLE_TICK) - dt) > 0) return;
    t.tick = IDLE_TICK;
    if (this.startNextWalk(u)) return;
    // in its sleeping time (the night, by day for a night-active one) four of ten idle ticks put it to sleep
    const r = Math.random();
    if (this.sleepTime(u) && r > 0.6 && u.anim.has('rest')) { this.startSleep(u); return; }
    if (this.hungry(u) && r > 0.8 && this.findFood(u)) return;
    t.phase = 'wait'; t.wait = 5 + Math.random() * 5;
  },
  // CalcNextWalkTarget: a point of its nest (by the flock), else one up to 30 m away (5 m for a baby) where it may be
  calcNextWalk(u) {
    const baby = this.isBaby(u), n = u.wildNest;
    for (let i = 0; i < 30; i++) {
      let p = n ? this.nestPoint(n, baby) : null;
      if (!p) { const d = baby ? 5 : 30; p = [u.pos.x + (Math.random() * 2 - 1) * d, u.pos.z + (Math.random() * 2 - 1) * d]; }
      if (this.positionOk(u, p[0], p[1])) { u.nextWalk = p; return; }
    }
  },
  positionOk(u, x, z) {
    if (u.wildNest) return this.nestAccepts(u.wildNest, x, z, this.isBaby(u));
    if (u.flock) return Math.hypot(x - u.flock.pos[0], z - u.flock.pos[1]) <= 2 * u.flock.size;
    if (u.homeRadius) return Math.hypot(x - u.home.x, z - u.home.y) <= u.homeRadius;      // (kennels, hatchlings)
    return true;
  },
  // StartNewWalkTarget: to the next walk target - away from a scare if there is one (then the nest's limits do not count)
  startNextWalk(u) {
    if (!u.nextWalk) return false;
    let [x, z] = u.nextWalk;
    u.nextWalk = null;
    const un = this.unscare(u, x, z, 1);
    if (un) [x, z] = un;
    this.animalWalk(u, x, z);
    return true;
  },
  animalWalk(u, x, z, opts = {}) {
    const nv = this.navFor(u);
    if (!nv.isFree(x, z)) { const c = nv.nearestFree(nv.idx(x, z)); if (c != null && c >= 0) [x, z] = nv.center(c); }
    u.task = { type: 'roam', phase: 'walk', to: [x, z], run: !!opts.run };
    u.setPath(x, z);
  },
  walkUpdate(u, dt) {
    const t = u.task;
    const sp = u.steer(dt, t.run ? u.runSpeed : u.speed);
    u.moveAnim(sp, t.run);
    if (!u.path.length) { t.phase = 'idle'; t.tick = 0; }
  },
  startSleep(u) {
    const t = u.task, n = u.wildNest;
    t.phase = 'sleep';
    t.loops = 20 + Math.floor(Math.random() * 40);
    t.wait = 0;
    if (n) {
      const p = this.nestPoint(n, this.isBaby(u));
      if (p && this.navFor(u).isFree(p[0], p[1])) u.setPath(p[0], p[1]);
    }
  },
  sleepUpdate(u, dt) {
    const t = u.task;
    if (u.path.length) { u.moveAnim(u.steer(dt, u.speed)); return; }
    u.vel.set(0, 0, 0);
    if (!t.wait) t.wait = t.loops * (u.anim.duration('rest') || 2);
    if (!u.busyAnim) u.anim.play('rest');
    t.wait -= dt;
    if (t.wait <= 0) { t.phase = 'idle'; t.tick = 0; }
  },

  // ---------------------------------------------------------------- food (Animal.FindFood / UpdateFoodCache, task/Feed.usl)
  vegetarian(u) { return !((u.def && u.def.aggressive) === 1); },
  // what it eats around it: trees (and plants) for a vegetarian, carcasses for a hunter; in its nest's action area (a
  // baby: the safe area) or within 50 m. Every 60 s (hunters 30 s).
  updateFoodCache(u) {
    const veg = this.vegetarian(u), n = u.wildNest, baby = this.isBaby(u);
    const area = n ? (baby ? n.safe : n.action) : null;
    const R = area ? Math.max(20, area.radius()) + 5 : 50, cx = area ? n.x : u.pos.x, cz = area ? n.z : u.pos.z;
    const out = [];
    this.rHash.query(cx, cz, R, (r) => {
      if (!r.alive) return;
      if (veg ? r.type !== 'tree' : r.type !== 'corpse') return;
      if (area ? !area.contains(r.pos.x, r.pos.z) : Math.hypot(r.pos.x - u.pos.x, r.pos.z - u.pos.z) > 50) return;
      out.push(r);
    });
    u.food = out; u.foodT = this.time;
  },
  findFood(u) {
    if (!u.food || this.time - (u.foodT || -1e9) >= (this.vegetarian(u) ? 60 : 30)) this.updateFoodCache(u);
    let food = null;
    for (let i = 0; i < 5 && u.food.length; i++) {
      const k = Math.floor(Math.random() * u.food.length), f = u.food[k];
      if (!f.alive) { u.food.splice(k, 1); continue; }
      if (this.positionOk(u, f.pos.x, f.pos.z) && !this.scaredAt(u, f.pos.x, f.pos.z)) { food = f; break; }
    }
    if (food) { this.feed(u, food); return true; }
    if (this.vegetarian(u)) { this.feed(u, null); return true; }     // grazing where it stands
    return false;
  },
  // CFeed: walk to the food (a tree: 2 m short of it); too far from it then: wait 5 s; else 2 .. 6 bouts of 3 .. 10
  // "feeding" loops, each taking the animal's damage off a carcass and healing half of it
  feed(u, food, opts = {}) {
    let x = u.pos.x, z = u.pos.z;
    if (food) {
      x = food.pos.x; z = food.pos.z;
      if (food.type === 'tree') { const d = Math.hypot(u.pos.x - x, u.pos.z - z) || 1; x += (u.pos.x - x) / d * 2; z += (u.pos.z - z) / d * 2; }
    }
    u.task = { type: 'roam', phase: 'feed', food, at: [x, z], state: 'goto' };
    u.fedT = this.time;
    if (Math.hypot(x - u.pos.x, z - u.pos.z) > 1) u.setPath(x, z); else u.path = [];
    if (opts.afterFight) u.task.afterFight = true;
  },
  feedUpdate(u, dt) {
    const t = u.task;
    if (t.food && !t.food.alive) { t.phase = 'idle'; t.tick = 0; return; }
    if (t.state === 'goto') {
      if (u.path.length) { u.moveAnim(u.steer(dt, u.speed)); return; }
      u.vel.set(0, 0, 0);
      if (Math.hypot(t.at[0] - u.pos.x, t.at[1] - u.pos.z) > 5) { t.phase = 'wait'; t.wait = 5; return; }
      if (t.food) u.face(t.food.pos.x, t.food.pos.z, 1, 100);
      t.state = 'feed'; t.bouts = 2 + Math.floor(Math.random() * 5); t.loops = 3 + Math.floor(Math.random() * 8); t.loopT = 0;
      return;
    }
    u.vel.set(0, 0, 0);
    if (t.loops <= 0) {
      if (t.bouts <= 0) { t.phase = 'idle'; t.tick = 0; return; }
      t.bouts--; t.loops = 3 + Math.floor(Math.random() * 8); t.loopT = 0.5;
      if (!u.busyAnim) u.anim.play(u.idleAnim);
      return;
    }
    if ((t.loopT -= dt) > 0) return;
    const len = u.anim.duration('feeding') || 1.5;
    t.loopT = len; t.loops--;
    if (u.anim.has('feeding')) u.anim.play('feeding', { restart: true });
    // the food loses what the animal takes (a carcass: Food.Mine), the animal heals half of it
    let got = this.animalDmg(u);
    if (t.food && t.food.type === 'corpse') {
      got = Math.min(got, t.food.amount);
      t.food.amount -= got; t.food.rotT = 120;
      if (t.food.amount <= 0.5) this.depleteNode(t.food);
    }
    this.setHp(u, Math.min(u.maxHp, u.hp + got / 2));
  },
  // the damage of its weapon (Animal.GetDmg: by its strength)
  animalDmg(u) { const cs = u.weapons && u.weapons.long ? u.cs(u.weapons.long) : null; return (cs ? cs.dmg : 0) * (u.grow ?? 1); },
  // after it killed a wild animal a wild animal feeds on the carcass (Fight.usl "Feed", Animal.HandleEvent: within 20 m)
  feedOnKill(u, prey) {
    if (!u.alive || u.owner || !prey || prey.owner) return false;
    const c = prey.corpseNode;
    if (!c || !c.alive || Math.hypot(c.pos.x - u.pos.x, c.pos.z - u.pos.z) > 20) return false;
    this.feed(u, c, { afterFight: true });
    return true;
  },

  // ---------------------------------------------------------------- the scare of a death (ScareMap.usl)
  // any animal that dies frightens the wild animals that are not hunters within 60 m: they run away (to twice the
  // radius) and avoid the place while its strength (360, losing 0.1 a second) lasts
  addScare(x, z) {
    const targets = new Set();
    this.uHash.query(x, z, SCARE_R, (o) => {
      if (o.alive && !o.owner && o.cls === 'ANML' && (o.def && o.def.aggressive) !== 1 && Math.hypot(o.pos.x - x, o.pos.z - z) <= SCARE_R) targets.add(o);
    });
    if (!targets.size) return;
    const s = { x, z, r: SCARE_R, str: SCARE_STR, t: this.time, targets };
    (this.scares = this.scares || []).push(s);
    for (const o of targets) this.getScared(o);
  },
  scareOf(u, x, z) {
    let best = null, bs = 0;
    if (!this.scares) return null;
    this.scares = this.scares.filter((s) => s.str - SCARE_DECAY * (this.time - s.t) > 0);
    for (const s of this.scares) {
      if (!s.targets.has(u)) continue;
      const d2 = (x - s.x) ** 2 + (z - s.z) ** 2;
      if (d2 > s.r * s.r) continue;
      const str = (s.str - SCARE_DECAY * (this.time - s.t)) * (1 - d2 / (s.r * s.r));
      if (str > bs) { bs = str; best = s; }
    }
    return best;
  },
  scaredAt(u, x, z) { return (u.def && u.def.aggressive) !== 1 && !!this.scareOf(u, x, z); },
  // UnscarePos: a scared point moves out of the scare (with a nest: to a point of the nest outside it)
  unscare(u, x, z, factor) {
    if ((u.def && u.def.aggressive) === 1) return null;
    const s = this.scareOf(u, x, z);
    if (!s) return null;
    const r = s.r * factor, d = Math.hypot(x - s.x, z - s.z) || 1;
    const p = [s.x + (x - s.x) / d * r, s.z + (z - s.z) / d * r];
    const n = u.wildNest;
    if (!n || this.nestAccepts(n, p[0], p[1], this.isBaby(u), true)) return p;
    for (let i = 0; i < 30; i++) { const q = this.nestPoint(n, this.isBaby(u), true); if (q && !this.scareOf(u, q[0], q[1])) return q; }
    return p;
  },
  getScared(u) {
    if (u.task.type !== 'roam') return;
    const p = this.unscare(u, u.pos.x, u.pos.z, 2) || [u.pos.x, u.pos.z];
    this.animalWalk(u, p[0], p[1], { run: true });
  },

  // ---------------------------------------------------------------- hunters (Animal.PreCheckForEnemies, FillEnemyList)
  // A wild hunter (aggressive 1, grown up) looks around: the players' units and buildings - and other wild animals
  // while it knows no carcass - within its alarm range + 50 m (not of its own class or flock, not Darwin's protected,
  // with a nest only those inside the nest's action area). It attacks the nearest within max(attack range, 30 m); one
  // only within its alarm range alarms it (a threat). A wild prey only when its kind can take it: needed helpers =
  // floor(time to kill it / time to be killed), not more than 2 x maxhelpers, and twice that many of its kind near it.
  // Not while it feeds.
  preCheckEnemies(u, dt) {
    if ((u.scanT = (u.scanT ?? Math.random() * 2) - dt) > 0) return false;
    u.scanT = 1.5 + Math.random();
    const t = u.task;
    if (t.phase === 'feed' || t.phase === 'sleep') return false;
    const hunter = isWildish(u) && !u.owner ? (u.def && u.def.aggressive) === 1 : true;     // (kennel animals hunt)
    if (!hunter || this.isBaby(u)) return false;
    const n = u.wildNest;
    if (!u.food || this.time - (u.foodT || -1e9) >= 30) this.updateFoodCache(u);
    const noFood = !u.food.length;
    const avail = this.helpersNear(u);
    const ok = (e) => {
      if (e.kind !== 'unit' && e.kind !== 'building') return false;
      if (e.name === u.name && e.owner === u.owner) return false;
      if (u.flock && u.flock.members.has(e)) return false;
      if (this.data.kind(e.name) === 'darwin_s0' || (e.st && e.st.aura.noAnimalAggro)) return false;
      if (n && !n.action.contains(e.pos.x, e.pos.z)) return false;
      if (n && e.st && e.st.camo.size) return false;
      if (!e.owner) {
        if (!noFood || e.cls !== 'ANML') return false;
        const need = this.helperCount(u, e), max = (u.def && u.def.maxhelpers) || 0;
        if (2 * max < need || avail < 2 * need) return false;
      }
      if (u.homeRadius && Math.hypot(e.pos.x - u.home.x, e.pos.z - u.home.y) > u.homeRadius) return false;
      return true;
    };
    const direct = Math.max(this.attackRangeOf(u, u.cs(u.weapons.long)), 30);
    const e = this.findTarget(u, direct, { animals: true, filter: ok });
    if (e) { u.task = { type: 'attack', target: e }; u.repathT = 0; return true; }
    const a = this.findTarget(u, this.alarmRange(u), { animals: true, filter: ok });
    if (a) this.alarm(u, a);
    return false;
  },
  // Animal.GetHelperCount: floor(own time to kill the enemy / the enemy's time to kill it) (the scripts multiply
  // damage by the weapon duration)
  helperCount(u, e) {
    const ecs = e.weapons && e.weapons.long ? e.cs(e.weapons.long) : null;
    const fd = ecs ? ecs.dmg * (e.grow ?? 1) : 0;
    if (!fd) return 0;
    const foreign = Math.max(u.hp, 1) / (fd * Math.max(ecs.dur, 0.001));
    const od = this.animalDmg(u);
    if (!od) return 1000;
    const ocs = u.cs(u.weapons.long);
    if (!e.hp) return 0;
    const own = e.hp / (od * Math.max(ocs.dur, 0.001));
    return Math.floor(own / foreign);
  },
  // its kind within its sight (2 x the largest of alarm range, attack range, FOW)
  sightRange(u) { return 2 * Math.max(this.alarmRange(u), this.attackRangeOf(u, u.cs(u.weapons.long)), u.fow || 0); },
  helpersNear(u, call) {
    const R = this.sightRange(u);
    let n = 0;
    this.uHash.query(u.pos.x, u.pos.z, R, (o) => {
      if (o === u || !o.alive || o.name !== u.name || Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z) > R) return;
      n++;
      if (call && o.task.type !== 'attack' && o.task.type !== 'flee') { o.task = { type: 'attack', target: call }; o.repathT = 0; }
    });
    return n;
  },
  // SetAlarmed / CAlarmed: an enemy near but not in reach - the animal turns to it and threatens ("menace", not in
  // the water) - again at most every 10 s
  alarm(u, e) {
    if (this.time < (u.alarmT || 0)) return;
    u.alarmT = this.time + 10;
    const t = u.task;
    if (t.type !== 'roam' || (t.phase && t.phase !== 'idle' && t.phase !== 'wait' && t.phase !== 'walk')) return;
    if (!u.anim.has('menace') || u.swimming) return;
    u.task = { type: 'roam', phase: 'threat', target: e, t: 0 };
    u.path = [];
  },
  threatUpdate(u, dt) {
    const t = u.task;
    u.vel.set(0, 0, 0);
    if (!t.started) {
      t.started = true;
      if (t.target && t.target.alive) u.face(t.target.pos.x, t.target.pos.z, 1, 100);
      u.busyAnim = true;
      u.anim.play('menace', { loop: false, restart: true, onDone: () => { u.busyAnim = false; if (u.task === t) { t.phase = 'idle'; t.tick = 0; } } });
      t.until = this.time + (u.anim.duration('menace') || 2) + 0.2;
    }
    if (this.time > t.until) { u.busyAnim = false; t.phase = 'idle'; t.tick = 0; }
  },

  // ---------------------------------------------------------------- attacked (Animal.OnDefend, Nest.AnimalAttacked)
  // A peaceful animal flees. A neutral or hunting one fights and calls its kind within sight - unless the enemy is a
  // wild animal it cannot take with the help it has (hunters: half the threshold), the enemy stands outside its
  // nest's action area, or it is a water melee animal and the enemy on land: then it flees. A baby attacked: every
  // grown member of its nest that sees it attacks.
  animalHurt(u, att) {
    const n = u.wildNest;
    if (n && this.isBaby(u)) for (const o of n.members) {
      if (o === u || !o.alive || this.isBaby(o) || o.task.type === 'attack') continue;
      if (Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z) <= (o.fow || 32)) { o.task = { type: 'attack', target: att }; o.repathT = 0; }
    }
    if (u.owner) return;
    if (u.task.type === 'attack') return;
    const agg = (u.def && u.def.aggressive) || 0;
    let flee = agg < 0;
    if (!flee) {
      const max = (u.def && u.def.maxhelpers) || 0, need = this.helperCount(u, att), world = !att.owner;
      const k = agg === 1 ? 2 : 1;
      if (world && max * k < need) flee = true;
      else if (world && this.helpersNear(u) < need * k) flee = true;
      else this.helpersNear(u, att);
      if (!flee && n && !n.action.contains(att.pos.x, att.pos.z)) flee = true;
      if (!flee && u.swimOnly && this.attackRangeOf(u, u.cs(u.weapons.long)) < 1 && !att.naval && this.height(att.pos.x, att.pos.z) > (this.waterLevel ?? -1e9) - 0.5) flee = true;
    }
    if (flee) { this.flee(u, att); return; }
    u.task = { type: 'attack', target: att }; u.repathT = 0;
  },
  // CFlee: up to 8 legs of 15 m away from the enemy (or to points of its nest); over when the enemy can't reach it
  // and is more than 40 m away. Fatigue grows with the way run and is lost again at 0.02 a second; tired out it stops.
  // Hurt it runs slower (below 90 / 80 / 60 % of its hit points one, two, three gaits less), below 60 % hobbling.
  flee(u, from) {
    if (u.task.type === 'flee') return;
    if ((u.fatigue || 0) >= 1) { u.task = { type: 'roam', phase: 'wait', wait: 1 }; return; }
    u.task = { type: 'flee', from, legs: 0, last: null, slow: u.task.phase === 'sleep' ? 1 : 0 };
  },
  fleeUpdate(u, dt) {
    const t = u.task, e = t.from;
    if (!e || !e.alive) { u.task = { type: 'roam' }; return; }
    if (u.path.length) {
      const k = u.hp / u.maxHp, gaitDown = k < 0.6 ? 3 : k < 0.8 ? 2 : k < 0.9 ? 1 : 0;
      const g = Math.max(1, (u.stats.maxspeed || u.stats.speed || 2) - gaitDown);
      const sp = u.gaitSpeed ? u.gaitSpeed(g) : u.runSpeed;
      const s = u.steer(dt, sp * (1 - 0.5 * (t.slow || 0)));
      if (k < 0.6 && u.anim.has('hump_' + Math.min(3, g))) { u.anim.play('hump_' + Math.min(3, g), { ts: 1, cut: true }); } else u.moveAnim(s, true);
      return;
    }
    // a leg is over
    const d = Math.hypot(u.pos.x - e.pos.x, u.pos.z - e.pos.z);
    if (t.legs > FLEE_LEGS || (d > FLEE_DIST && this.reach(e, u) > this.attackRangeOf(e, e.cs(e.weapons.long)))) { u.task = { type: 'roam' }; return; }
    let walked = -1;
    if (t.legs > 0) walked = Math.hypot(u.pos.x - t.last[0], u.pos.z - t.last[1]);
    t.last = [u.pos.x, u.pos.z];
    if (t.legs > 0 && walked > 0) {
      const factor = 2 / Math.max(u.stats.maxspeed || 1, 1);
      u.fatigue = Math.min(1, (u.fatigue || 0) + walked / (factor * (FLEE_WALK + FLEE_DIST)));
      if (u.fatigue >= 1) { u.task = { type: 'roam' }; return; }
    }
    let p = u.wildNest ? this.nestPoint(u.wildNest, this.isBaby(u)) : null;
    if (!p) {
      if (t.legs > 0 && walked < 0.1) { u.task = { type: 'roam', phase: 'wait', wait: 1 }; return; }
      let a = Math.atan2(u.pos.z - e.pos.z, u.pos.x - e.pos.x);
      if (t.legs > 0 && walked < FLEE_WALK * 0.5) a += (Math.random() - 0.5) * Math.PI;
      const j = FLEE_WALK / 4;
      p = [u.pos.x + Math.cos(a) * FLEE_WALK + (Math.random() * 2 - 1) * j, u.pos.z + Math.sin(a) * FLEE_WALK + (Math.random() * 2 - 1) * j];
    }
    t.slow = Math.max(0, (t.slow || 0) - 0.25);
    t.legs++;
    u.setPath(p[0], p[1]);
    if (!u.path.length) { u.task = { type: 'roam', phase: 'wait', wait: 1 }; }
  },
  // the fatigue recovers 0.02 a second (TIMER_FATIGUE); called for the animals that have some
  fatigueUpdate(u, dt) { if (u.fatigue > 0 && u.task.type !== 'flee') u.fatigue = Math.max(0, u.fatigue - 0.02 * dt); },

  // ---------------------------------------------------------------- the tracker dino (CTrackerDino)
  // CheckForNearbyEnemies every 2 s (50 m), otherwise AutoScout - random points ahead of its heading
  trackerUpdate(u, dt) {
    const t = u.task;
    u.scanT = (u.scanT || 0) - dt;
    if (u.scanT <= 0) {
      u.scanT = 2;
      const e = this.findTarget(u, 50, { animals: true, filter: (e) => e.kind !== 'res' });
      if (e) { u.task = { type: 'attack', target: e }; u.repathT = 0; return; }
    }
    if (!u.path.length || t.phase !== 'walk') {
      for (let i = 0; i < 8; i++) {
        const a = u.heading + (Math.random() - 0.5) * (i < 4 ? 1.2 : 6.28), r = 25 + Math.random() * 20;
        const x = u.pos.x - Math.sin(a) * r, z = u.pos.z - Math.cos(a) * r;
        if (Math.abs(x) < this.nav.half - 4 && Math.abs(z) < this.nav.half - 4 && this.navFor(u).isFree(x, z)) { u.setPath(x, z); t.phase = 'walk'; break; }
      }
      if (!u.path.length) { u.vel.set(0, 0, 0); u.anim.play(u.idleAnim); return; }
    }
    const sp = u.steer(dt, u.speed);
    u.moveAnim(sp);
    if (!u.path.length) t.phase = 'wait';
  },
};

// the size of a newborn: the root's scale at the end of the model's "growup" pose (its two frames: grown, newborn)
function growupScale(anim) {
  const c = anim && anim.byName && anim.byName.get('growup');
  if (!c) return 0.5;
  for (const tr of c.tracks) {
    if (/\.scale$/.test(tr.name) && tr.values.length >= 3) { const v = tr.values; return Math.max(0.1, Math.min(1, v[v.length - 3])); }
  }
  return 0.5;
}
