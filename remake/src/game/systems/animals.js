// Wild animals: roaming around their home, feeding, hunting, fleeing and calling their herd for help.
// Also the autonomous animals of kennels and nests (they roam and hunt around their building).
//
// Reference: docs/spec/units.md section 7 (Animal.usl, Nest.usl, Flock.usl, Fight.usl CFlee).
//   aggressive -1: peaceful, always flees       0: neutral, fights back and alerts its herd       1: hunter

// wild animals alive at once on a map (performance guard; big community maps have 60+ nests)
export const WILD_CAP = 260;
export const Animals = {
  // ---------------------------------------------------------------- map nests (Nest.usl, docs/spec/units.md 7.4)
  // n = {species, x, z, max, rate, amount, swim}: one animal every `rate` s while fewer than `max` live and `amount`
  // (-1 = unlimited) is left; the timer restarts when a member dies. Pre-spawned animals are passed in `members`.
  addWildNest(n) {
    const nest = { ...n, members: n.members || [], t: 0, alive: (n.members || []).length };
    for (const u of nest.members) u.wildNest = nest;
    this.wildNests.push(nest);
    return nest;
  },
  spawnFromNest(nest) {
    const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
    const u = this.spawnUnit(nest.species, null, nest.x + Math.cos(a) * r, nest.z + Math.sin(a) * r, undefined, Math.random() * 6.28, nest.swim ? { swim: true } : {});
    if (!u) return null;
    u.home.set(nest.x, nest.z); u.wildNest = nest;
    nest.members.push(u);
    if (nest.amount > 0) nest.amount--;
    return u;
  },
  wildNestsUpdate(dt) {
    this.nestT = (this.nestT || 0) - dt;
    if (this.nestT > 0) return;
    const step = 1 - this.nestT; this.nestT = 1;                // once a second
    const wild = this.units.reduce((n, u) => n + (u.alive && u.wild ? 1 : 0), 0);
    for (const n of this.wildNests) {
      n.members = n.members.filter((u) => u.alive);
      if (n.members.length < n.alive) n.t = 0;                // a member died: restart the timer
      n.alive = n.members.length;
      if (n.alive >= n.max || n.amount === 0 || wild >= WILD_CAP) continue;
      n.t += step;
      if (n.t >= n.rate) { n.t = 0; if (this.spawnFromNest(n)) n.alive++; }
    }
  },
  roamUpdate(u, dt) {
    const t = u.task;
    const hunter = u.wild ? u.def.aggressive > 0 : true;
    const R = u.homeRadius || 60;
    if (u.tracker) return this.trackerUpdate(u, dt);
    if (hunter) {
      u.scanT = (u.scanT || Math.random() * 2) - dt;
      if (u.scanT <= 0) {
        u.scanT = 1.5 + Math.random();
        // hunters attack units near their territory; units in Darwin's aura are ignored
        const e = this.findTarget(u, 26, { animals: !u.wild, filter: (e) => e.kind === 'unit' && !(e.st && e.st.aura.noAnimalAggro) && Math.hypot(e.pos.x - u.home.x, e.pos.z - u.home.y) < R });
        if (e) { u.task = { type: 'attack', target: e }; u.repathT = 0; return; }
      }
    }
    if (!t.phase) { t.phase = 'wait'; t.wait = 2 + Math.random() * 8; }
    if (t.phase === 'wait') {
      t.wait -= dt;
      u.vel.set(0, 0, 0);
      if (!u.busyAnim) u.anim.play(t.feed ? u.anim.pick('feeding', 'standanim') || u.idleAnim : u.idleAnim);
      if (t.wait <= 0) {
        for (let i = 0; i < 8; i++) {
          const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * Math.min(28, R * 0.6);
          const x = u.home.x + Math.cos(a) * r, z = u.home.y + Math.sin(a) * r;
          if (this.navFor(u).isFree(x, z)) { u.setPath(x, z); t.phase = 'walk'; break; }
        }
        if (t.phase !== 'walk') t.wait = 3;
      }
      return;
    }
    const sp = u.steer(dt, u.speed);
    u.moveAnim(sp);
    if (!u.path.length) { t.phase = 'wait'; t.wait = 3 + Math.random() * 10; t.feed = Math.random() < 0.4; }
  },
  // tracker dino: CheckForNearbyEnemies every 2 s (50 m), otherwise AutoScout - random points ahead of its heading
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
  fleeUpdate(u, dt) {
    const t = u.task;
    t.t += dt;
    if (!t.path) { const a = Math.atan2(u.pos.z - t.from.pos.z, u.pos.x - t.from.pos.x); u.setPath(u.pos.x + Math.cos(a) * 30, u.pos.z + Math.sin(a) * 30); t.path = true; }
    const sp = u.steer(dt, u.runSpeed);
    u.moveAnim(sp, true);
    if (!u.path.length || t.t > 8) u.task = { type: 'roam' };
  },
  // Animal.OnDefend: peaceful animals flee, the others fight back and call animals of the same kind within sight
  animalHurt(u, att) {
    if (u.task.type === 'attack') return;
    if (u.def.aggressive < 0) { u.task = { type: 'flee', from: att, t: 0 }; return; }
    u.task = { type: 'attack', target: att }; u.repathT = 0;
    const R = 2 * Math.max(32, u.fow || 32);
    this.uHash.query(u.pos.x, u.pos.z, R, (o) => {
      if (o.alive && o.wild && o.name === u.name && o.task.type !== 'attack' && u.distTo(o) < R) { o.task = { type: 'attack', target: att }; o.repathT = 0; }
    });
  },
};
