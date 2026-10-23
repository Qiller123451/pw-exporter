// Siege objects at a wall (task/DockWall.usl; docs/spec/walls_walk.md §4, §5): the Hu ladder (hu_ladder, CLadder),
// the Ninigi siege tower (ninigi_siegetower, CSiegeTower) and the siege brachiosaurus (aje_brachiosaurus with the
// build-up aje_brachiosaurus_siege). The Base tech tree hides all three (visibility -1); mods such as MIRAGE offer
// them.
//
//   * One siege object per wall piece (GetWallSiege, DW:385-391): this.sieges "i,j" -> the ladder or the docked
//     vehicle (an unfinished ladder holds its piece too).
//   * Ladder (CBuildLadder, DW:328-455): a Hu worker puts it against the piece under the cursor, on the side nearest
//     the worker, facing the wall, without the place check; it is an ordinary building (20 wood, 1000 hp, no
//     timer). Finished, it is an entrance of the wall (AddAdditionalEntrance, DW:49-57): its owner's and allies'
//     characters climb it (right click: "ClimbLadder", GIC:852) - from its foot (link Wo_1) up to its top (Wo_2) at
//     3.65 m/s, then onto the walkway (walkable walls) or over the wall: a jump to 4 m past the wall's centre on the
//     far side (CClimbLadder DW:458-631; the climb animations as named, not the original's swapped ones).
//     Characters on the walkway leave by it too (systems/wallwalk.js wallExit).
//   * Siege tower (CDockWall, DW:79-326): an attack order on a wall piece (or "Dock" on an own one) docks it -
//     to a free side of the piece, its back to the wall, "opengate_moveup" (low walls: "opengate"), docked after
//     2 s. Its passengers' "Dismount" puts them on the far side of the wall (CLeaveSiegeTower, DW:1011-1107). (The
//     climb over a docked tower, CClimbSiegeTower DW:846-1009, is started by the engine's path finder for ground
//     paths across the wall [?engine]: not done.) A new order undocks it first ("closegate", 2 s).
//   * Siege brachiosaurus: docks the same way facing the wall ("siege_down" of its siege build-up); it is an
//     entrance like the ladder, from the build-up's psh1 to psh2 (CClimbBrachio, DW:633-844; "climb_up_brachio").
import * as THREE from 'three';
import { DIRS } from '../wallmap.js';
import { WALL_TOP } from './wallwalk.js';

const DOCK_T = 2;          // docking / undocking (DW:247-259, 280-291)
const CLIMB = 3.65;        // up the ladder / tower (DW:571-583)
const TRIP = 5;            // the steps to the foot and from the top (DW:554-562)
const FAR = 4;             // the far side: 4 m past the wall's centre (DW:614)
const LADDER_OUT = 5.3;    // the ladder's foot from the piece's centre: its top (4.27 m out, 7.61 m up) on the walkway
const _v = new THREE.Vector3();

export const Siege = {
  isLadder(b) { return !!(b && b.kind === 'building' && b.def && b.def.ladder); },
  isSiegeTower(u) { return !!(u && u.kind === 'unit' && u.def && (u.def.script === 'CSiegeTower' || u.name === 'ninigi_siegetower')); },
  isSiegeBrachio(u) { return !!(u && u.kind === 'unit' && u.name === 'aje_brachiosaurus' && u.comp && u.comp.parts.some((p) => p.spec.gfx === 'aje_brachiosaurus_siege')); },
  canDock(u) { return this.isSiegeTower(u) || this.isSiegeBrachio(u); },
  siegeAt(i, j) { return (this.sieges && this.sieges.get(i + ',' + j)) || null; },
  setSiege(tile, s) {
    if (!this.sieges) this.sieges = new Map();
    const k = tile[0] + ',' + tile[1];
    if (s) this.sieges.set(k, s); else this.sieges.delete(k);
  },
  // the entrances of the walkway at piece (i, j): a finished ladder, a docked brachiosaurus
  laddersAt(i, j) {
    const s = this.siegeAt(i, j);
    if (!s || !s.alive) return [];
    if (this.isLadder(s) && s.built) return [s];
    if (this.isSiegeBrachio(s) && s.docked) return [s];
    return [];
  },
  // may u climb siege object s (its owner's and allies' characters; a ready ladder, a docked brachiosaurus - the
  // siege tower is boarded: its passengers get out beyond the wall)
  mayUseSiege(u, s) {
    if (!this.canClimb(u) || !s || !s.alive || !s.dockTile || !u.owner || !s.owner) return false;
    if (s.owner !== u.owner && !u.owner.isFriend(s.owner)) return false;
    return this.isLadder(s) ? s.built : this.isSiegeBrachio(s) && !!s.docked;
  },
  // where a siege object is climbed: foot and top (world), the piece, and whether the climb ends on the walkway or
  // goes over the wall (a wall without a walkway, the siege tower)
  siegeEntry(s) {
    const [i, j] = s.dockTile, [cx, cz] = this.wallMap.centre(i, j);
    let foot, top;
    if (this.isLadder(s)) {
      foot = s.linkWorld('Wo_1', new THREE.Vector3()) || s.pos.clone();
      top = s.linkWorld('Wo_2', new THREE.Vector3()) || new THREE.Vector3(cx, s.pos.y + WALL_TOP, cz);
    } else if (this.isSiegeTower(s)) {
      foot = s.pos.clone();
      top = s.pos.clone(); top.y += WALL_TOP;                     // (DW:914: the entry + 7.8 m)
    } else {
      const p = s.comp && s.comp.parts.find((q) => q.spec.gfx === 'aje_brachiosaurus_siege');
      s.obj.updateMatrixWorld(true);
      foot = p && p.links.psh1 ? p.links.psh1.getWorldPosition(new THREE.Vector3()) : s.pos.clone();
      top = p && p.links.psh2 ? p.links.psh2.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(cx, s.pos.y + WALL_TOP, cz);
      foot.y = this.height(foot.x, foot.z);
    }
    const nx = cx - foot.x, nz = cz - foot.z, L = Math.hypot(nx, nz) || 1;
    return { foot, top, tile: [i, j], centre: [cx, cz], n: [nx / L, nz / L], over: this.isSiegeTower(s) || !this.walkway(i, j) };
  },

  // ------------------------------------------------------------------ ladders
  // the ladder model's links at rotation 0: foot Wo_1 and top Wo_2 relative to its origin
  ladderLinks(name, owner) {
    const st = this.data.stats(name, 1, owner), tpl = st && this.template(st.gfx, true);
    if (!tpl) return { top: [0, LADDER_OUT - 1] };
    if (!tpl.ladderTop) {
      tpl.scene.updateMatrixWorld(true);
      const o = tpl.scene.getObjectByName('link_Wo_2');
      if (o) o.getWorldPosition(_v); else _v.set(0, 7.6, 4.3);
      tpl.ladderTop = [_v.x, _v.z];
    }
    return { top: tpl.ladderTop };
  },
  // placement of a ladder for a click at (x, z) by workers standing at `from`: the side of the wall piece there that
  // is nearest the workers, turned to the wall; one siege object per piece
  ladderPlacement(name, x, z, owner, from) {
    const WM = this.wallMap, [i, j] = WM.tileOf(x, z), [cx, cz] = WM.centre(i, j);
    const t = WM.at(i, j);
    if (!t || !t.wall || !t.wall.alive || t.gate || t.tower || this.siegeAt(i, j)) return { x: cx, z: cz, rot: 0, ok: false };
    const f = from || [x, z], m = WM.mask(i, j);
    let best = null, bd = Infinity;
    for (let d = 0; d < 8; d++) {
      if ((m >> d) & 1) continue;
      const [di, dj] = DIRS[d], L = Math.hypot(di, dj), px = cx + di / L * LADDER_OUT, pz = cz + dj / L * LADDER_OUT;
      if (!this.nav.isFree(px, pz)) continue;
      const dd = Math.hypot(px - f[0], pz - f[1]);
      if (dd < bd) { bd = dd; best = [px, pz]; }
    }
    if (!best) return { x: cx, z: cz, rot: 0, ok: false };
    // turn it so that its top points at the wall: rotation.y maps the angle atan2(x, z) of a vector by + rot
    const [tx, tz] = this.ladderLinks(name, owner).top;
    const rot = Math.atan2(cx - best[0], cz - best[1]) - Math.atan2(tx, tz);
    const P = this.play;
    const ok = best[0] > P.x0 + 6 && best[0] < P.x1 - 6 && best[1] > P.z0 + 6 && best[1] < P.z1 - 6;
    return { x: best[0], z: best[1], rot, ok, dock: [i, j] };
  },
  // a ladder was placed: it holds its piece and doesn't block the way to its foot
  ladderPlaced(b, tile) {
    b.dockTile = tile;
    this.setSiege(tile, b);
    b.setBlocking(false);
  },
  // a building is gone: a ladder frees its piece; a wall piece's ladder or docked vehicle loses its hold
  siegeGone(e) {
    if (e.dockTile && this.siegeAt(...e.dockTile) === e) this.setSiege(e.dockTile, null);
    if (e.tile && e.def && e.def.wallKind === 'wall') {
      const s = this.siegeAt(e.tile[0], e.tile[1]);
      if (s) {
        this.setSiege(e.tile, null);
        s.dockTile = null;
        if (s.kind === 'unit' && (s.docked || s.task.type === 'dock')) this.undock(s, null);      // (DW:168-172, AN:1887)
      }
    }
  },

  // ------------------------------------------------------------------ climbing (CClimbLadder, CClimbBrachio)
  climbSiege(u, s, user = true) {
    if (!this.mayUseSiege(u, s)) return false;
    u.task = { type: 'climb', siege: s, phase: 'go', user };
    return true;
  },
  // down a ladder / brachiosaurus from the walkway, then the order
  climbDown(u, s, then) {
    u.task = { type: 'climb', siege: s, phase: 'down', user: !!(then && !then.auto), then };
    u.wpath = [];
  },
  climbUpdate(u, dt) {
    const t = u.task, s = t.siege;
    if (!s || !s.alive || !s.dockTile || (!this.isLadder(s) && !s.docked)) {
      // the ladder is gone under it: down to the ground where it is
      if (u.climbing) this.wallFall(u, true);
      else u.task = { type: 'idle' };
      return;
    }
    const E = this.siegeEntry(s);
    const move = (to, y1, speed, anim) => {
      if (!t.mv) {
        const from = [u.pos.x, u.pos.z], y0 = u.wallH ?? u.pos.y, d = Math.hypot(to[0] - from[0], to[1] - from[1], y1 - y0);
        t.mv = { from, to, y0, y1, t: 0, T: Math.max(0.2, d / speed) };
        if (anim && u.anim.has(anim)) { u.busyAnim = true; u.anim.play(anim, { restart: true, ts: Math.max(0.3, (u.anim.duration(anim) || 1) / t.mv.T * (anim === 'trip' ? 0.25 : 1)) }); }
      }
      const m = t.mv;
      m.t += dt;
      const f = Math.min(1, m.t / m.T);
      u.pos.x = m.from[0] + (m.to[0] - m.from[0]) * f; u.pos.z = m.from[1] + (m.to[1] - m.from[1]) * f;
      u.wallH = m.y0 + (m.y1 - m.y0) * f;
      u.vel.set(0, 0, 0);
      if (f < 1) return false;
      t.mv = null;
      return true;
    };
    switch (t.phase) {
      case 'go': {
        const d = Math.hypot(E.foot.x - u.pos.x, E.foot.z - u.pos.z), reach = this.isLadder(s) ? 1.2 : s.radius + 1.5;
        if (d > reach) {
          if (!t.walking || (!u.path.length && (t.tries = (t.tries || 0) + 1) < 4)) { u.setPath(E.foot.x, E.foot.z); t.walking = true; }
          if (!u.path.length && d > reach + 2) { u.task = { type: 'idle' }; return; }
          u.moveAnim(u.steer(dt, t.user ? u.runSpeed : u.speed, 0.4), t.user);
          return;
        }
        u.path = []; u.climbing = true; u.wallH = u.pos.y;
        u.heading = Math.atan2(-E.n[0], -E.n[1]);
        t.phase = 'foot';
      }
      // falls through
      case 'foot': if (!move([E.foot.x, E.foot.z], E.foot.y, TRIP, 'trip')) return; t.phase = 'up'; // falls through
      case 'up': {
        const anim = this.isLadder(s) ? 'hu_high_ladder_climb_up' : this.isSiegeTower(s) ? 'climb_up_ladder' : 'climb_up_brachio';
        if (!move([E.top.x, E.top.z], E.top.y, CLIMB, anim)) return;
        t.phase = E.over ? 'over' : 'top';
        return;
      }
      case 'top': {
        // the steps onto the walkway (DW:595 trip_end)
        const [i, j] = E.tile;
        if (!move(E.centre, this.wallTop(i, j), TRIP, 'trip')) return;
        u.climbing = false; u.busyAnim = false;
        u.onWall = { i, j }; u.wallH = null;
        this.setOnWall(u, true);
        const then = t.then;
        u.task = { type: 'idle' };
        if (then) this.order([u], then);
        return;
      }
      case 'over': {
        // over the wall: a jump to 4 m past its centre on the far side (DW:588-593, "climb_up_ladder", speed 20)
        const gx = E.centre[0] + E.n[0] * FAR, gz = E.centre[1] + E.n[1] * FAR;
        const k = this.nav.nearestFree(this.nav.idx(gx, gz), 6), [fx, fz] = this.nav.center(k);
        u.climbing = false; u.busyAnim = false; u.wallH = null;
        u.onWall = null;
        u.pos.y = E.top.y;
        u.wjump = { from: [u.pos.x, u.pos.z], to: [fx, fz], y0: E.top.y, y1: this.height(fx, fz), t: 0, T: 1.2, onto: null, then: t.then || null };
        u.wallH = E.top.y;
        if (u.anim.has('climb_up_ladder')) { u.busyAnim = true; u.anim.play('climb_up_ladder', { loop: false, restart: true }); }
        return;
      }
      // from the walkway: to the top of the ladder, down to its foot
      case 'down': {
        if (!u.climbing) { u.climbing = true; u.wallH = u.pos.y; this.setOnWall(u, false); u.onWall = null; }
        if (!move([E.top.x, E.top.z], E.top.y, TRIP, 'trip')) return;
        t.phase = 'down2';
        return;
      }
      case 'down2': {
        const anim = this.isLadder(s) ? 'climb_down_ladder' : 'climb_down_brachio';
        if (!move([E.foot.x, E.foot.z], this.height(E.foot.x, E.foot.z), CLIMB, anim)) return;
        u.climbing = false; u.busyAnim = false; u.wallH = null;
        // a step away from the foot, so the next one can come down
        const k = this.nav.nearestFree(this.nav.idx(E.foot.x - E.n[0] * 1.5, E.foot.z - E.n[1] * 1.5), 6), [fx, fz] = this.nav.center(k);
        if (Math.hypot(fx - u.pos.x, fz - u.pos.z) < 4) { u.pos.x = fx; u.pos.z = fz; }
        u.anchor.set(u.pos.x, u.pos.z);
        const then = t.then;
        u.task = { type: 'idle' };
        if (then) this.order([u], then);
      }
    }
  },

  // ------------------------------------------------------------------ docking (CDockWall)
  dockOrder(u, wall, user = true) {
    if (!this.canDock(u) || !wall || !wall.alive || !wall.tile || wall.def.wallKind !== 'wall') return false;
    u.task = { type: 'dock', wall, phase: 'find', tries: 0, user };
    return true;
  },
  dockUpdate(u, dt) {
    const t = u.task, w = t.wall;
    if (t.phase === 'undock') {
      u.vel.set(0, 0, 0);
      if ((t.t -= dt) > 0) return;
      u.busyAnim = false;
      const then = t.then;
      u.task = { type: 'idle' };
      if (then) this.order([u], then);
      return;
    }
    if (!w || !w.alive || !w.tile) { if (u.docked) this.undock(u, null); else u.task = { type: 'idle' }; return; }
    const [i, j] = w.tile, [cx, cz] = this.wallMap.centre(i, j);
    const brachio = this.isSiegeBrachio(u);
    switch (t.phase) {
      case 'find': {
        const other = this.siegeAt(i, j);
        if ((other && other !== u) || ++t.tries > 3) { u.task = { type: 'idle' }; return; }
        // GetFreeDockPos: a free side of the piece nearest the vehicle (a brachiosaurus 2 m further back, DW:183)
        const m = this.wallMap.mask(i, j), out = 1.6 + u.radius + 0.5 + (brachio ? 2 : 0) + (w.pfMask & 0x4000 ? 1.6 : 0);   // (an end piece: its big hub box, wallmap.js pfMask)
        let best = null, bd = Infinity;
        for (let d = 0; d < 8; d++) {
          if ((m >> d) & 1) continue;
          const [di, dj] = DIRS[d], L = Math.hypot(di, dj), px = cx + di / L * out, pz = cz + dj / L * out;
          if (!this.nav.isFree(px, pz)) continue;
          const dd = Math.hypot(px - u.pos.x, pz - u.pos.z);
          if (dd < bd) { bd = dd; best = [px, pz]; }
        }
        if (!best) { u.task = { type: 'idle' }; return; }
        t.dest = best;
        u.setPath(best[0], best[1]);
        t.phase = 'go';
        return;
      }
      case 'go': {
        if (u.path.length) { u.moveAnim(u.steer(dt, u.speed, 0.6)); return; }
        if (Math.hypot(t.dest[0] - u.pos.x, t.dest[1] - u.pos.z) > 2) { t.phase = 'find'; return; }     // (DW:203-207)
        t.phase = 'turn';
        return;
      }
      case 'turn': {
        // the siege tower turns its back to the wall, the brachiosaurus faces it (DW:208-219)
        const fx = brachio ? cx : 2 * u.pos.x - cx, fz = brachio ? cz : 2 * u.pos.z - cz;
        u.vel.set(0, 0, 0);
        if (u.face(fx, fz, dt, 2) > 0.05) { u.moveAnim(0); return; }
        if (this.siegeAt(i, j) && this.siegeAt(i, j) !== u) { u.task = { type: 'idle' }; return; }
        this.setSiege([i, j], u);
        u.dockTile = [i, j];
        t.t = DOCK_T;
        t.phase = 'docking';
        u.busyAnim = true;
        if (brachio) {
          const p = u.comp && u.comp.parts.find((q) => q.spec.gfx === 'aje_brachiosaurus_siege');
          if (p && p.anim) p.anim.play('siege_down', { loop: false, restart: true });
          if (u.anim.has('siege')) u.anim.play('siege', { loop: false, restart: true });
        } else {
          const low = /palisade|skewer/.test(w.name) && w.name !== 'ninigi_palisade';
          const a = low ? 'opengate' : 'opengate_moveup';
          if (u.anim.has(a)) u.anim.play(a, { loop: false, restart: true });
        }
        return;
      }
      case 'docking':
        u.vel.set(0, 0, 0);
        if ((t.t -= dt) > 0) return;
        u.docked = { wall: w, tile: [i, j] };
        t.phase = 'docked';
        return;
      case 'docked': u.vel.set(0, 0, 0); return;
    }
  },
  // a docked (or docking) vehicle gets a new order: it undocks first (2 s), then the order (DW:300-316)
  undock(u, then) {
    if (u.dockTile && this.siegeAt(...u.dockTile) === u) this.setSiege(u.dockTile, null);
    u.dockTile = null; u.docked = null;
    u.task = { type: 'dock', phase: 'undock', t: DOCK_T, then };
    u.busyAnim = true;
    if (this.isSiegeBrachio(u)) {
      const p = u.comp && u.comp.parts.find((q) => q.spec.gfx === 'aje_brachiosaurus_siege');
      if (p && p.anim) p.anim.play('siege_up', { loop: false, restart: true });
    } else if (u.anim.has('closegate')) u.anim.play('closegate', { loop: false, restart: true });
  },
  // CLeaveSiegeTower: a passenger of a docked tower gets out on the far side of the wall (DW:1090-1100) -> [x, z]
  siegeExitPoint(t) {
    if (!t.docked || !t.dockTile) return null;
    const [cx, cz] = this.wallMap.centre(...t.dockTile);
    const nx = cx - t.pos.x, nz = cz - t.pos.z, L = Math.hypot(nx, nz) || 1, r = 1.6 + FAR;
    const k = this.nav.nearestFree(this.nav.idx(cx + nx / L * r, cz + nz / L * r), 6);
    return this.nav.center(k);
  },
};
