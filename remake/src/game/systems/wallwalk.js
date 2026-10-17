// Walking on walls: characters on the walkway of the walkable walls (wallclassconfig "Walkable": hu_small_wall,
// hu_re_enforced_wall, aje_clay_wall, ninigi_palisade), getting up and down, fighting from there, falling when the
// piece under them is destroyed - and the siege objects that dock to a wall (systems/siege.js: ladders, the siege
// tower).
//
// Reference: docs/spec/walls_walk.md (character.usl, FightingObj.usl, task/misc.usl, task/DockWall.usl,
// GameInputController.usl; PWServer.exe CActWallWalk: a unit gets on and off a wall with a jump, anim "jump_wall",
// speed 20).
//
//   * The walkway: the built walkable wall pieces of the wall grid (game/wallmap.js), connected as their arms are
//     (towers and gates are not part of it). The top is WALL_TOP above the ground at the tile centre.
//   * Only characters go up ("SetCanUseSiege", CH:640). A right click on an own walkable wall ("Use", GIC:841) sends
//     them up: they walk to a free side of the piece and jump on it; on the walkway they walk along the pieces.
//     Any order to the ground takes them along the walkway to the piece nearest the goal and down with a jump.
//     Enemy walls are entered only through a docked ladder (systems/siege.js).
//   * On the wall: +Defence_On_Wall ranged protection (tech tree MiscValues, 50; FO:7959), no knockback (FO:4383),
//     no walk back to the post (FO:2393); melee fighters can't reach across the wall's height (the height rule of
//     combat.js rangeZone), shooters can.
//   * A destroyed piece drops the characters on it: their order ends, they fall (hit_front, getting_up) and take
//     (height x 5) damage, reduced by melee protection (CH:2165-2174).
//
// Unit state: u.onWall = {i, j} (the tile it is on) while on the walkway; u.wpath = the tile centres it walks to;
// u.wjump = {from, to, y0, y1, t, T, then} while jumping up or down.
import { DIRS } from '../wallmap.js';

export const WALL_TOP = 7.8;          // the walkway above the ground at the tile centre (the models: 7.6 .. 7.9 m)
const FALL_DMG = 5;                   // per metre of the fall (CH:2170)
const SIDE = 4.5;                     // a ground point beside a piece: 4 m from its centre (DW:614) and a little more
const STAY = new Set(['idle', 'hold', 'wall', 'attack', 'finish', 'special', 'cast', 'heal', 'entrench', 'climb']);

export const WallWalk = {
  walkableNames() {
    if (!this._walkable) this._walkable = new Set((this.data.extra.walkableWalls || []).map((s) => String(s).toLowerCase()));
    return this._walkable;
  },
  // a wall piece units walk on: a finished piece of a walkable class
  walkableWall(b) {
    return !!(b && b.alive && b.built && b.def && b.def.wallKind === 'wall' && (this.walkableNames().has(b.name.toLowerCase()) || this.walkableNames().has(String(b.stats.gfx || '').toLowerCase())));
  },
  canClimb(u) { return !!(u && u.alive && u.kind === 'unit' && u.cls === 'CHTR' && !u.inside && !u.flying && !u.naval && !u.parked); },
  // the walkway piece of tile (i, j) or null
  walkway(i, j) {
    const t = this.wallMap.at(i, j);
    return t && t.wall && !t.gate && !t.tower && this.walkableWall(t.wall) ? t.wall : null;
  },
  // the walkway tiles next to (i, j): along the piece's arms
  walkwayNext(i, j) {
    const out = [], m = this.wallMap.mask(i, j);
    for (let d = 0; d < 8; d++) if ((m >> d) & 1) { const [di, dj] = DIRS[d]; if (this.walkway(i + di, j + dj)) out.push([i + di, j + dj]); }
    return out;
  },
  wallTop(i, j) { const [x, z] = this.wallMap.centre(i, j); return this.height(x, z) + WALL_TOP; },
  // the height of the walkway under a unit on it: between the tops of the two tile centres it walks between
  wallY(u) {
    const WM = this.wallMap, w = u.onWall;
    const [i, j] = this.walkway(...WM.tileOf(u.pos.x, u.pos.z)) ? WM.tileOf(u.pos.x, u.pos.z) : [w.i, w.j];
    const [cx, cz] = WM.centre(i, j), ox = u.pos.x - cx, oz = u.pos.z - cz, o = Math.hypot(ox, oz);
    const y0 = this.wallTop(i, j);
    if (o < 0.3) return y0;
    const d = ((Math.round(Math.atan2(-oz, ox) / (Math.PI / 4)) % 8) + 8) % 8, [di, dj] = DIRS[d];
    if (!this.walkway(i + di, j + dj)) return y0;
    const L = Math.hypot(di, dj) * 8;
    return y0 + (this.wallTop(i + di, j + dj) - y0) * Math.min(1, o / L);
  },
  // the walkway tiles from a to b (breadth first; null: not connected)
  wallRoute(a, b) {
    const key = (t) => t[0] + ',' + t[1], goal = key(b);
    if (key(a) === goal) return [a];
    const prev = new Map([[key(a), null]]), q = [a];
    while (q.length) {
      const t = q.shift();
      for (const n of this.walkwayNext(t[0], t[1])) {
        const k = key(n);
        if (prev.has(k)) continue;
        prev.set(k, t);
        if (k === goal) {
          const out = [n];
          for (let p = t; p; p = prev.get(key(p))) out.unshift(p);
          return out;
        }
        q.push(n);
      }
    }
    return null;
  },
  // all walkway tiles connected to tile a
  walkwayOf(a) {
    const key = (t) => t[0] + ',' + t[1], seen = new Map([[key(a), a]]), q = [a];
    while (q.length) { const t = q.shift(); for (const n of this.walkwayNext(t[0], t[1])) if (!seen.has(key(n))) { seen.set(key(n), n); q.push(n); } }
    return [...seen.values()];
  },
  // the free ground points beside a piece (its sides without an arm), nearest to (x, z) first
  wallSides(i, j, x, z) {
    const [cx, cz] = this.wallMap.centre(i, j), m = this.wallMap.mask(i, j), out = [];
    for (let d = 0; d < 8; d++) {
      if ((m >> d) & 1) continue;
      const [di, dj] = DIRS[d], L = Math.hypot(di, dj), px = cx + di / L * SIDE, pz = cz + dj / L * SIDE;
      if (this.nav.isFree(px, pz)) out.push([px, pz]);
    }
    return out.sort((p, q) => Math.hypot(p[0] - x, p[1] - z) - Math.hypot(q[0] - x, q[1] - z));
  },
  // may u get onto the walkway of piece w on its own (no ladder): own walls only (GIC:826-836 "Use")
  mayUseWall(u, w) { return this.canClimb(u) && this.walkableWall(w) && w.owner === u.owner; },

  // ------------------------------------------------------------------ orders
  // world.order for a unit on the walkway: true = handled here
  wallOrder(u, o) {
    switch (o.type) {
      case 'stop': case 'hold':
        u.task = { type: o.type }; u.wpath = []; u.path = []; u.vel.set(0, 0, 0);
        return true;
      case 'use': {
        const w = o.target;
        if (!this.walkableWall(w) || !w.tile) return true;
        const route = this.wallRoute([u.onWall.i, u.onWall.j], w.tile);
        if (route) { u.task = { type: 'wall', phase: 'walk', user: !o.auto }; u.wpath = route.map(([i, j]) => this.wallMap.centre(i, j)); return true; }
        u.task = { type: 'wall', phase: 'leave', dest: [w.pos.x, w.pos.z], then: o, user: !o.auto };
        return true;
      }
      case 'climb': {
        // down the ladder of a piece of this walkway
        const s = o.target, route = s && s.dockTile && this.mayUseSiege(u, s) && this.wallRoute([u.onWall.i, u.onWall.j], s.dockTile);
        if (!route) return true;
        u.task = { type: 'wall', phase: 'leave', exit: { ladder: s, tile: s.dockTile, route }, dest: [s.pos.x, s.pos.z], user: !o.auto };
        u.wpath = route.map(([i, j]) => this.wallMap.centre(i, j));
        return true;
      }
      case 'attack': return false;           // fights from the wall (attackUpdate: wallChase)
      case 'unload': case 'kill': case 'rallyJob': return false;
    }
    // everything else happens on the ground: down first, then the order
    u.task = { type: 'wall', phase: 'leave', dest: this.orderDest(u, o), then: o, user: !o.auto };
    u.wpath = [];
    return true;
  },
  orderDest(u, o) {
    if (o.x != null) return [o.x, o.z];
    if (o.pts) return o.pts[o.i % o.pts.length];
    const t = o.target;
    return t && t.pos ? [t.pos.x, t.pos.z] : [u.pos.x, u.pos.z];
  },
  // "Use" on an own walkable wall from the ground: up there
  useWall(u, w, user = true) {
    if (!this.mayUseWall(u, w)) return false;
    u.task = { type: 'wall', phase: 'up', wall: w, user };
    u.wpath = [];
    return true;
  },

  // ------------------------------------------------------------------ the task 'wall'
  // phases: 'up' (walk to a side of the piece, jump), 'walk' (along the walkway), 'leave' (along the walkway to the
  // piece nearest the goal, jump down, then the order)
  wallUpdate(u, dt) {
    const t = u.task;
    if (u.wjump) return;
    if (t.phase === 'up') {
      const w = t.wall;
      if (!this.mayUseWall(u, w)) { u.task = { type: 'idle' }; return; }
      if (!t.side) {
        t.side = this.wallSides(w.tile[0], w.tile[1], u.pos.x, u.pos.z)[0];
        if (!t.side) { u.task = { type: 'idle' }; return; }
        u.setPath(t.side[0], t.side[1]);
      }
      const d = Math.hypot(t.side[0] - u.pos.x, t.side[1] - u.pos.z);
      if (d > 1.2 && u.path.length) { u.moveAnim(u.steer(dt, t.user ? u.runSpeed : u.speed, 0.5), t.user); return; }
      if (d > 3) { u.task = { type: 'idle' }; return; }        // no way there
      const [cx, cz] = this.wallMap.centre(w.tile[0], w.tile[1]);
      this.wallJump(u, cx, cz, true, { i: w.tile[0], j: w.tile[1] });
      t.phase = 'walk';
      return;
    }
    if (!u.onWall) { u.task = { type: 'idle' }; return; }
    if (t.phase === 'walk') {
      if (!u.wpath.length) {
        const then = t.then;
        u.task = { type: 'idle' }; u.vel.set(0, 0, 0);
        if (!u.busyAnim) u.anim.play(u.standAnim());
        if (then) this.order([u], then);
        return;
      }
      u.moveAnim(this.wallSteer(u, dt, t.user ? u.runSpeed : u.speed), t.user);
      return;
    }
    if (t.phase === 'leave') {
      if (!t.exit) {
        t.exit = this.wallExit(u, t.dest);
        if (!t.exit) { u.task = { type: 'idle' }; return; }       // no way down (an enemy's wall without a ladder)
        u.wpath = t.exit.route.map(([i, j]) => this.wallMap.centre(i, j));
      }
      if (u.wpath.length) { u.moveAnim(this.wallSteer(u, dt, t.user ? u.runSpeed : u.speed), t.user); return; }
      const e = t.exit, then = t.then || (t.resume && this.taskOrder(t.resume, t.dest));
      if (e.ladder) { this.climbDown(u, e.ladder, then); return; }
      this.wallJump(u, e.ground[0], e.ground[1], false, null, then);
    }
  },
  // the order that starts a task again (a ground task begun on the wall, resumed after the way down)
  taskOrder(t, dest) {
    const auto = !t.user;
    switch (t.type) {
      case 'move': case 'attackmove': return { type: t.type, x: t.x, z: t.z, then: t.then, auto };
      case 'gather': return t.node ? { type: 'gather', target: t.node, auto } : { type: 'deliver', target: t.drop || null, auto };
      case 'build': return t.building ? { type: t.building.built ? 'repair' : 'build', target: t.building, auto } : null;
      case 'board': case 'fountain': case 'pickup': case 'trade': return t.target ? { type: t.type, target: t.target, auto } : null;
    }
    return dest ? { type: 'move', x: dest[0], z: dest[1], auto } : null;
  },
  // the way down to the ground near dest: along the walkway to a piece with a free side (own walls) or a ladder of
  // the unit's side, the one that leaves the shortest walk -> {route, ground, ladder} | null
  wallExit(u, dest) {
    const here = [u.onWall.i, u.onWall.j];
    const tiles = this.walkwayOf(here);
    let best = null, bd = Infinity;
    const own = (w) => w && w.owner === u.owner;
    for (const [i, j] of tiles) {
      const w = this.walkway(i, j);
      const [cx, cz] = this.wallMap.centre(i, j);
      const cand = [];
      if (own(w)) { const s = this.wallSides(i, j, dest[0], dest[1])[0]; if (s) cand.push({ ground: s }); }
      for (const l of this.laddersAt ? this.laddersAt(i, j) : []) if (this.mayUseSiege(u, l)) cand.push({ ladder: l, ground: l.foot || [l.pos.x, l.pos.z] });
      for (const c of cand) {
        const walk = Math.hypot(cx - u.pos.x, cz - u.pos.z) * 0.5 + Math.hypot(c.ground[0] - dest[0], c.ground[1] - dest[1]);
        if (walk < bd) { bd = walk; best = { ...c, tile: [i, j] }; }
      }
    }
    if (!best) return null;
    best.route = this.wallRoute(here, best.tile) || [best.tile];
    return best;
  },
  // straight to the next tile centre of u.wpath (no path finding on the walkway)
  wallSteer(u, dt, speed) {
    const [tx, tz] = u.wpath[0];
    const dx = tx - u.pos.x, dz = tz - u.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.3) {
      u.wpath.shift();
      const [i, j] = this.wallMap.tileOf(tx, tz);
      if (this.walkway(i, j)) u.onWall = { i, j };
      if (!u.wpath.length) { u.vel.set(0, 0, 0); return 0; }
      return this.wallSteer(u, dt, speed);
    }
    u.face(tx, tz, dt, 9);
    const sp = Math.min(speed, d / dt);
    u.vel.set(dx / d * sp, 0, dz / d * sp);
    u.pos.x += u.vel.x * dt; u.pos.z += u.vel.z * dt;
    const [i, j] = this.wallMap.tileOf(u.pos.x, u.pos.z);
    if ((i !== u.onWall.i || j !== u.onWall.j) && this.walkway(i, j)) u.onWall = { i, j };
    return sp;
  },
  // a jump on or off a wall (CActWallWalk: "jump_wall"; down "jump_of_wall"); onto = {i, j} on the walkway at the
  // end, null on the ground; then = the order after landing
  wallJump(u, x, z, up, onto, then = null) {
    const anim = up ? 'jump_wall' : u.anim.has('jump_of_wall') ? 'jump_of_wall' : 'jump_wall';
    const T = Math.max(0.5, (u.anim.has(anim) && u.anim.duration(anim)) || 1.2);
    const y0 = u.pos.y, y1 = up ? this.wallTop(onto.i, onto.j) : this.height(x, z);
    u.path = []; u.wpath = []; u.vel.set(0, 0, 0);
    u.face(x, z, 1, 100);
    u.wjump = { from: [u.pos.x, u.pos.z], to: [x, z], y0, y1, t: 0, T, onto, then };
    if (u.anim.has(anim)) { u.busyAnim = true; u.anim.play(anim, { loop: false, restart: true, fade: 0.1 }); }
    if (up) u.onWall = onto;                 // (its height comes from the jump until it lands)
  },
  // the jump in flight; called from unitUpdate before the task
  wallJumpUpdate(u, dt) {
    const j = u.wjump;
    j.t += dt;
    const f = Math.min(1, j.t / j.T);
    u.pos.x = j.from[0] + (j.to[0] - j.from[0]) * f;
    u.pos.z = j.from[1] + (j.to[1] - j.from[1]) * f;
    u.wallH = j.y0 + (j.y1 - j.y0) * f + Math.sin(f * Math.PI) * 1.2;
    if (f < 1) return;
    u.wjump = null; u.wallH = null; u.busyAnim = false;
    if (j.onto) { u.onWall = j.onto; this.setOnWall(u, true); }
    else { this.setOnWall(u, false); u.onWall = null; }
    u.anchor.set(u.pos.x, u.pos.z);
    if (!j.onto) u.task = { type: 'idle' };
    if (j.then) { if (j.onto) u.task = { type: 'idle' }; this.order([u], j.then); }
  },
  // SetOnWall (FO:1979): the ranged protection of the wall (Defence_On_Wall of the player's tribe)
  setOnWall(u, on) { u.wallDef = on ? this.data.miscValue(u.rulesOwner(), 'Defence_On_Wall', 0) : 0; },

  // ------------------------------------------------------------------ unitUpdate hooks
  // before the task: a jump in flight, or a ground task of a unit on the walkway (it goes down first). true = done
  wallPreUpdate(u, dt) {
    if (u.wjump) { this.wallJumpUpdate(u, dt); return true; }
    if (!u.onWall) return false;
    if (!this.walkway(u.onWall.i, u.onWall.j)) { this.wallFall(u, false); return false; }
    const t = u.task;
    if (STAY.has(t.type)) return false;
    // a ground task started on the wall (a resumed job, a script): down first, then the task again
    u.task = { type: 'wall', phase: 'leave', dest: t.x != null ? [t.x, t.z] : t.target ? [t.target.pos.x, t.target.pos.z] : t.node ? [t.node.pos.x, t.node.pos.z] : t.building ? [t.building.pos.x, t.building.pos.z] : [u.pos.x, u.pos.z], resume: t, user: !!t.user };
    return false;
  },
  // the attack of a unit on the walkway with its target out of reach: along the walkway to a target on it, down
  // after it on an order of the player, else the fight ends (no chasing from a wall: CheckPatrol, FO:2393)
  wallChase(u, t, tgt, dt) {
    if (tgt.onWall) {
      const route = this.wallRoute([u.onWall.i, u.onWall.j], [tgt.onWall.i, tgt.onWall.j]);
      if (route) {
        if (route.length > 1 || Math.hypot(tgt.pos.x - u.pos.x, tgt.pos.z - u.pos.z) > 1.5) {
          u.wpath = route.slice(route.length > 1 ? 1 : 0).map(([i, j]) => this.wallMap.centre(i, j));
          if (route.length === 1) u.wpath = [[tgt.pos.x, tgt.pos.z]];
          u.moveAnim(this.wallSteer(u, dt, u.runSpeed), true);
          return;
        }
      }
    }
    if (t.user && !t.hold) { u.task = { type: 'wall', phase: 'leave', dest: [tgt.pos.x, tgt.pos.z], then: { type: 'attack', target: tgt }, user: true }; return; }
    this.endAttack(u);
  },
  // a ground unit after a target on the walkway: melee fighters go up where they may (their own wall, a ladder of
  // their side) - else the target is out of their reach
  wallReach(u, tgt) {
    if (!tgt.onWall || u.onWall || !this.canClimb(u)) return null;
    const tiles = this.walkwayOf([tgt.onWall.i, tgt.onWall.j]);
    let best = null, bd = Infinity;
    for (const [i, j] of tiles) {
      const w = this.walkway(i, j);
      const [cx, cz] = this.wallMap.centre(i, j), d = Math.hypot(cx - u.pos.x, cz - u.pos.z);
      if (w && w.owner === u.owner && d < bd) { bd = d; best = { wall: w }; }
      for (const l of this.laddersAt ? this.laddersAt(i, j) : []) if (this.mayUseSiege(u, l) && d < bd) { bd = d; best = { ladder: l }; }
    }
    return best;
  },

  // ------------------------------------------------------------------ falling
  // the piece under them is gone (WCT_Destroyed, CH:2165-2174): the order ends, they fall and take (height x 5)
  // melee damage; hurt = false when the piece only stopped being walkway (replaced by a gate or a tower)
  wallFall(u, hurt = true) {
    if (!u.onWall && !u.climbing) return;
    const h = u.pos.y - this.height(u.pos.x, u.pos.z);
    u.onWall = null; u.wpath = []; u.wallDef = 0; u.climbing = false; u.wallH = null;
    this.releaseTask(u);
    u.task = { type: 'idle' }; u.path = [];
    const k = this.nav.nearestFree(this.nav.idx(u.pos.x, u.pos.z), 6), [fx, fz] = this.nav.center(k);
    u.wjump = { from: [u.pos.x, u.pos.z], to: [fx, fz], y0: u.pos.y, y1: this.height(fx, fz), t: 0, T: 0.6, onto: null, then: null };
    if (u.anim.has('hit_front')) {
      u.busyAnim = true;
      u.anim.play('hit_front', { loop: false, restart: true, onDone: () => { if (u.alive && u.anim.has('getting_up')) u.anim.play('getting_up', { loop: false, restart: true, onDone: () => { u.busyAnim = false; } }); else u.busyAnim = false; } });
    }
    if (hurt && h > 0.5) this.takeDirectDmg(u, h * FALL_DMG, 0, null, false);
  },
  // a wall piece is destroyed (or replaced): the characters on its tile fall
  wallPieceGone(b) {
    if (!b.tile) return;
    const [i, j] = b.tile;
    for (const u of this.units) if (u.alive && u.onWall && u.onWall.i === i && u.onWall.j === j && !u.wjump) this.wallFall(u, !b.silentDeath);
  },
};
