import { headingTo, wrap } from '../entities.js';
// Water and naval gameplay (docs/spec/naval.md): fishing boats, harbours (fish delivery, the floating harbour's own
// fishing), water mines, the Aje torpedo turtle, the Ninigi submarine's stealth and the targeting rules of units
// that live in the water. Ships move on world.waterNav (see World.navFor); harbours snap to the coast
// (construction.js coastalSnap).
//
// Mixed into World. Everything here is a no-op on maps without water.

const FISH_LOAD = 50;            // CFishingBoat inventory (Ship.usl:24-93)
const FISH_STOP = 7;             // one load per fishing stop: net out, 7 s, net in (Fishing.usl)
const FISH_SEARCH = 400;         // next shoal within 400 m of the last delivery
const MINE_SPACING = 8;          // PlaceWaterMine.usl: no mine / water turret within 8 m
const MINE_TRIGGER = 10;         // CWaterMine personal region
const MINE_FUSE = 0.5;
const MINE_BLAST = [15, 1000];   // radius, flat damage
const TORPEDO_TURTLE = { life: 45, scan: 2, radius: 100, blast: [15, 250] };

// fishing boats: the only units that gather from fish shoals
export const isFisher = (u) => !!u && /fishing_boat$/.test(u.name);
const isHarbour = (b) => !!b && b.kind === 'building' && /harbour|carrier/.test(b.name) && !/rally_point/.test(b.name);
// units that fight only at the waterline (water melee: ram ship, cronosaurus, sea monsters) / below it (torpedo subs)
const waterMelee = (u) => u.naval && !u.amphib && u.weapons && u.weapons.long && (u.weapons.long.range || 0) < 1;
const torpedoUnit = (u) => /submarine$/.test(u.name);

export const Naval = {
  // ------------------------------------------------------------------ fishing (Fishing.usl, naval.md §4.2)
  startFishing(u, shoal) {
    if (!isFisher(u) || !shoal || !shoal.alive || !shoal.water) return false;
    this.releaseTask(u);
    shoal.workers.add(u);
    u.task = { type: 'fish', node: shoal, phase: 'go', user: u.task.user };
    u.setPath(shoal.pos.x, shoal.pos.z);
    return true;
  },
  fishUpdate(u, dt) {
    const t = u.task;
    if (!u.carry) u.carry = null;
    const carried = u.carry && u.carry.res === 'food' ? u.carry.amount : 0;
    if (t.phase === 'go') {
      if (!t.node || !t.node.alive) { this.nextShoal(u, carried); return; }
      const d = Math.hypot(t.node.pos.x - u.pos.x, t.node.pos.z - u.pos.z);
      if (d > 6 + t.node.radius) {
        if (!u.path.length) { u.setPath(t.node.pos.x, t.node.pos.z); if (!u.path.length) { u.task = { type: 'idle' }; return; } }
        u.moveAnim(u.steer(dt, u.speed));
        return;
      }
      u.path = []; u.vel.set(0, 0, 0);
      // net out: the load is filled at once, the boat waits 7 s
      const want = FISH_LOAD - carried;
      const got = Math.min(want, t.node.amount);
      t.node.amount -= got;
      u.carry = { res: 'food', amount: carried + got, look: null };
      if (t.node.amount <= 0.5) this.depleteNode(t.node);
      t.phase = 'net'; t.wait = FISH_STOP;
      u.anim.play(u.anim.pick('work', 'fishing', 'standanim') || u.idleAnim);
      return;
    }
    if (t.phase === 'net') {
      t.wait -= dt;
      if (t.wait > 0) return;
      t.phase = 'deliver'; t.drop = null;
      return;
    }
    if (t.phase === 'deliver') {
      if (!t.drop || !t.drop.alive) {
        t.drop = this.nearestFishDelivery(u);
        if (!t.drop) { u.task = { type: 'idle' }; return; }
        const [x, z] = this.dockPoint(t.drop);
        u.setPath(x, z); t.dock = [x, z];
      }
      // arrived when close to the harbour (its footprint blocks the berth cells on the water grid)
      const sd = t.drop.surfDist(u.pos.x, u.pos.z);
      if (sd > 8 && !(sd < 20 && !u.path.length)) {
        if (!u.path.length) { u.setPath(t.dock[0], t.dock[1]); if (!u.path.length) { u.task = { type: 'idle' }; return; } }
        u.moveAnim(u.steer(dt, u.speed));
        return;
      }
      u.vel.set(0, 0, 0);
      const left = u.owner.deliver('food', carried, this.time);
      if (left >= carried - 1e-6 && carried > 0) { t.fullT = (t.fullT || 0) + dt; return; }   // storage full: retry
      u.carry = left > 0 ? { res: 'food', amount: left, look: null } : null;
      t.lastDrop = [u.pos.x, u.pos.z];
      if (u.carry) return;
      if (t.node && t.node.alive) { t.phase = 'go'; u.setPath(t.node.pos.x, t.node.pos.z); } else this.nextShoal(u, 0);
    }
  },
  nextShoal(u, carried) {
    const t = u.task;
    if (carried > 0) { t.phase = 'deliver'; t.drop = null; return; }
    const from = t.lastDrop || [u.pos.x, u.pos.z];
    const n = this.nearestResource(from[0], from[1], 'food', FISH_SEARCH, t.node, Object.assign(() => true, { water: true }));
    if (n) { if (t.node) t.node.workers.delete(u); t.node = n; n.workers.add(u); t.phase = 'go'; u.setPath(n.pos.x, n.pos.z); } else u.task = { type: 'idle' };
  },
  nearestFishDelivery(u) {
    let best = null, bd = 1e9;
    for (const b of this.buildings) {
      if (!b.alive || !b.built || b.owner !== u.owner || !isHarbour(b)) continue;
      const d = u.distTo(b);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  },
  // berth of a harbour on the water grid (link Do_1, naval.md §1.3)
  dockPoint(b) {
    const nav = this.waterNav || this.nav;
    for (const ln of ['Do_1', 'Spwn', 'Ex_1']) {
      const p = b.linkWorld(ln);
      if (p && nav.isFree(p.x, p.z)) return [p.x, p.z];
    }
    const c = nav.nearestFree(nav.idx(b.pos.x, b.pos.z), 40);
    return nav.center(c);
  },

  // ------------------------------------------------------------------ moving harbours (naval.md §1.5)
  // CSwimmingHarbour (aje_floating_harbour) and CSeasCarrier: buildings that swim. Right-click moves them once
  // built (Shift+right-click sets the rally point instead, GIC:273). While sailing they don't block the water grid;
  // where they stop, their footprint is stamped again.
  isMovingHarbour(b) { return b && b.kind === 'building' && (b.def.script === 'CSeasCarrier' || b.def.script === 'CSwimmingHarbour'); },
  moveHarbour(b, x, z) {
    if (!this.isMovingHarbour(b) || !b.built || !this.waterNav || b.dismantling) return 'req';
    const nav = this.waterNav;
    if (!nav.isFree(x, z)) { const [cx, cz] = nav.center(nav.nearestFree(nav.idx(x, z), 30)); x = cx; z = cz; }
    const was = b.blocking;
    if (was) b.setBlocking(false);
    const path = nav.find(b.pos.x, b.pos.z, x, z, Math.min(4, b.radius * 0.5), 40000, b.owner);
    if (!path || !path.length) { if (was) b.setBlocking(true); return 'path'; }
    // speed: maxspeed index of the tech tree (2 = 5 m/s as for ships), a bit slower for the big hull
    const idx = Math.max(1, Math.round(b.stats.maxspeed || b.stats.speed || 2));
    b.sail = { path, speed: [0, 1.5, 4, 5.5, 7][Math.min(4, idx)] };
    if (b.anim) b.anim.play(b.anim.pick('swim_1', 'swim_2', 'standanim'), { fade: 0.4 });
    return null;
  },
  harbourSailUpdate(b, dt) {
    const s = b.sail;
    if (!s) return;
    if (!b.alive) { b.sail = null; return; }
    let [tx, tz] = s.path[0];
    let dx = tx - b.pos.x, dz = tz - b.pos.z, d = Math.hypot(dx, dz);
    if (d < (s.path.length === 1 ? 1.5 : 6)) {
      s.path.shift();
      if (!s.path.length) { this.harbourStop(b); return; }
      [tx, tz] = s.path[0]; dx = tx - b.pos.x; dz = tz - b.pos.z; d = Math.hypot(dx, dz);
    }
    // turn towards the next point (slowly - it's a big hull), slow down while turning
    const want = headingTo(dx, dz), diff = wrap(want - b.rot);
    b.rot = wrap(b.rot + Math.sign(diff) * Math.min(Math.abs(diff), 0.5 * dt));
    const sp = s.speed * Math.max(0.15, Math.cos(Math.min(Math.abs(diff), Math.PI / 2)));
    const step = Math.min(d, sp * dt);
    b.slide(-Math.sin(b.rot) * step, -Math.cos(b.rot) * step, b.rot);
    this.bHash.move(b);
  },
  harbourStop(b) {
    b.sail = null;
    b.relocate();
    if (!b.blocking) b.setBlocking(true);
    if (b.anim) b.anim.play(b.anim.pick('standanim', 'swim_1'), { fade: 0.5 });
  },

  // ------------------------------------------------------------------ harbours (naval.md §1.3 / §4.3)
  harbourUpdate(b, dt) {
    if (b.sail) this.harbourSailUpdate(b, dt);
    // Aje floating harbour: fishes a shoal within 40 m by itself, 10 food every 5 s straight into the stock
    if (b.name !== 'aje_floating_harbour' || !b.built || !b.owner) return;
    b.fishT = (b.fishT || 0) - dt;
    if (b.fishT > 0) return;
    b.fishT = 5;
    const n = this.nearestResource(b.pos.x, b.pos.z, 'food', b.radius + 40, null, Object.assign(() => true, { water: true }));
    if (!n) return;
    const got = Math.min(10, n.amount);
    const left = b.owner.deliver('food', got, this.time);
    n.amount -= got - left;
    if (n.amount <= 0.5) this.depleteNode(n);
  },

  // ------------------------------------------------------------------ targeting rules of sea units (FO:4792-4842)
  // can attacker u fight target e at all, given water and land?
  navalCanTarget(u, e) {
    if (this.waterLevel == null) return true;
    const ground = e.kind === 'building' ? null : this.height(e.pos.x, e.pos.z);
    // land melee units can't reach anything in the water
    if (!u.naval && !u.amphib && e.kind === 'unit' && (e.naval || ground < this.waterLevel - 0.5)) {
      const r = u.weapons && u.weapons.long ? u.weapons.long.range || 0 : 0;
      if (r < 1) return false;
    }
    if (u.kind === 'unit' && waterMelee(u)) {
      if (e.kind === 'building') return isHarbour(e) || this.height(e.pos.x, e.pos.z) <= this.waterLevel + 1.7;
      return ground <= this.waterLevel + 1.7;
    }
    if (u.kind === 'unit' && torpedoUnit(u)) {
      if (e.kind === 'building') return isHarbour(e);
      return ground < this.waterLevel - 0.5 || e.naval;
    }
    // wild sea monsters hunt only ships and buildings
    if (u.wild && u.naval && e.kind === 'unit' && !e.naval) return false;
    return true;
  },

  // ------------------------------------------------------------------ water mines (CWaterMine, PlaceWaterMine.usl)
  placeWaterThing(u, name, x, z) {
    if (this.waterLevel == null || this.height(x, z) > this.waterLevel) return 'place';
    for (const o of this.units) if (o.alive && /mineship_mine|water_turret/.test(o.name) && Math.hypot(o.pos.x - x, o.pos.z - z) < MINE_SPACING) return 'place';
    return null;
  },
  mineUpdate(m, dt) {
    if (m.fuse != null) { m.fuse -= dt; if (m.fuse <= 0) this.mineBlast(m); return; }
    m.scanT = (m.scanT || 0) - dt;
    if (m.scanT > 0) return;
    m.scanT = 0.25;
    this.uHash.query(m.pos.x, m.pos.z, MINE_TRIGGER + 4, (e) => {
      if (m.fuse != null || !e.alive || e === m || e.cls !== 'SHIP' || !e.owner || !m.owner || !m.owner.isEnemy(e.owner)) return;
      if (Math.hypot(e.pos.x - m.pos.x, e.pos.z - m.pos.z) < MINE_TRIGGER + e.radius) m.fuse = MINE_FUSE;
    });
  },
  mineBlast(m) {
    if (m.blasted) return;
    m.blasted = true;
    this.flatBlast(m, m.pos, MINE_BLAST[0], MINE_BLAST[1]);
    if (m.alive) { m.silentDeath = true; this.kill(m, null); }
  },
  // flat area damage (armour applies via takeDirectDmg's protection flag), no friendly fire, passengers are safe
  flatBlast(src, pos, r, dmg) {
    this.emit('impact', { pos: pos.clone(), splash: true, big: true });
    const hit = (e) => {
      if (!e.alive || e === src || e.inside) return;
      if (e.owner && src.owner && !src.owner.isEnemy(e.owner)) return;
      if (Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) - (e.radius || 1) > r) return;
      this.takeDirectDmg(e, dmg, 0, src.owner, true);
    };
    this.uHash.query(pos.x, pos.z, r + 10, hit);
    this.bHash.query(pos.x, pos.z, r + 30, hit);
  },

  // ------------------------------------------------------------------ Aje torpedo turtle (CTorpedoTurtle, naval.md §2.6)
  torpedoTurtleUpdate(u, dt) {
    u.life = (u.life ?? TORPEDO_TURTLE.life) - dt;
    if (u.life <= 0) { this.kill(u, null); return true; }
    u.scanT = (u.scanT || 0) - dt;
    if (u.scanT <= 0) {
      u.scanT = TORPEDO_TURTLE.scan;
      let best = null, bd = TORPEDO_TURTLE.radius;
      const test = (e) => {
        if (!e.alive || !e.owner || !u.owner || !u.owner.isEnemy(e.owner)) return;
        if (!(e.cls === 'SHIP' || isHarbour(e) && !/carrier/.test(e.name))) return;
        const d = Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z);
        if (d < bd) { bd = d; best = e; }
      };
      this.uHash.query(u.pos.x, u.pos.z, TORPEDO_TURTLE.radius, test);
      this.bHash.query(u.pos.x, u.pos.z, TORPEDO_TURTLE.radius + 20, test);
      if (best && best !== u.prey) { u.prey = best; u.setPath(best.pos.x, best.pos.z); }
      else if (!best && !u.path.length) {
        const a = u.heading + ((Math.floor(Math.random() * 4) - 2) * 0.3);
        u.setPath(u.pos.x - Math.sin(a) * 25, u.pos.z - Math.cos(a) * 25);
      }
    }
    const p = u.prey;
    if (p && p.alive && Math.hypot(p.pos.x - u.pos.x, p.pos.z - u.pos.z) < (p.radius || 2) + u.radius + 0.5) {
      this.flatBlast(u, u.pos, TORPEDO_TURTLE.blast[0], TORPEDO_TURTLE.blast[1]);
      u.silentDeath = true; this.kill(u, null);
      return true;
    }
    if (p && p.alive && (!u.path.length || (u.repathT = (u.repathT || 0) - dt) <= 0)) { u.setPath(p.pos.x, p.pos.z); u.repathT = 1; }
    u.moveAnim(u.steer(dt, u.speed));
    return true;
  },

  // minelayer / corsair: build a water mine / water turret at a point in the water (PlaceWaterMine.usl)
  layWaterThing(u, action, x, z) {
    const name = action.results[0] && action.results[0].obj;
    if (!name || !u.alive) return 'req';
    const why = this.data.check(u.rulesOwner(), action, u);
    if (why) return why === 'hidden' || why === 'disabled' ? 'req' : why;
    if (!u.owner.canAfford(action.cost)) return 'cost';
    const w = this.placeWaterThing(u, name, x, z);
    if (w) return w;
    this.releaseTask(u);
    u.task = { type: 'lay', action, name, x, z, phase: 'go', user: true };
    u.setPath(x, z);
    return null;
  },
  layUpdate(u, dt) {
    const t = u.task;
    if (t.phase === 'go') {
      if (Math.hypot(t.x - u.pos.x, t.z - u.pos.z) > u.radius + 4 && u.path.length) { u.moveAnim(u.steer(dt, u.runSpeed)); return; }
      u.path = []; u.vel.set(0, 0, 0);
      if (this.placeWaterThing(u, t.name, t.x, t.z) || !u.owner.canAfford(t.action.cost)) { u.task = { type: 'idle' }; return; }
      u.owner.pay(t.action.cost);
      t.phase = 'build'; t.left = Math.max(0.5, t.action.time || 5);
      return;
    }
    t.left -= dt;
    if (t.left > 0) return;
    const m = this.spawnUnit(t.name, u.owner, t.x, t.z, 1, u.heading, { stationary: true });
    if (m) { m.stance = /mine/.test(t.name) ? 3 : 0; this.emit('trained', { unit: m, producer: u }); }
    u.task = { type: 'idle' };
  },

  // ------------------------------------------------------------------ per-unit hook (called from World.unitUpdate)
  // returns true when the naval rules handled the unit this tick
  navalUnitUpdate(u, dt) {
    if (u.name === 'ninigi_mineship_mine') { this.mineUpdate(u, dt); return true; }
    if (u.name === 'aje_torpedo_turtle') return this.torpedoTurtleUpdate(u, dt);
    // Ninigi muraeno submarine: hidden unless fighting (and for 10 s after the last fight / hit)
    if (u.name === 'ninigi_muraeno_submarine') {
      if (u.task.type === 'attack') { if (u.st.camo.has('disg')) u.st.camo.delete('disg'); u.disgT = this.time + 10; }
      else if (!u.st.camo.has('disg') && this.time > (u.disgT || 0)) u.st.camo.add('disg');
    }
    if (u.task.type === 'fish') { this.fishUpdate(u, dt); return true; }
    if (u.task.type === 'lay') { this.layUpdate(u, dt); return true; }
    return false;
  },
};
