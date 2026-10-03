// Construction: placing buildings, building them up, repairing, dismantling (Aje "BuildDown"), self-destruction,
// wall lines, and what happens when a building is destroyed.
//
// Reference: docs/spec/buildings.md sections 1.2-1.8 (BuildUp.usl, BuildUpBuilding.usl, Repair.usl,
// BuildDownBuilding.usl, Building.usl).
//
//   build time  = duration * slowest worker's time factor * (0.1 + 0.9 * 0.8^(N-1))      N = workers
//   repair      = (20 + 5 * level) hp/s per worker; a full repair costs 50 % of the build cost
//   BuildDown   = half the build time, then a 100 % refund of the build cost (capped by storage)
import { placeFootprint, WALL_BOXES } from '../entities.js';
import { RES } from '../rules.js';

const selfTF = (e) => (e && e.stats && e.stats.tf > 0 ? e.stats.tf : 2.0);
export const WALL_STEP = 8;        // wall segments sit on an 8 m grid (engine WallMap; see spec 2.1)

export const Construction = {
  // footprint of a building placed at (x, z): nav cells of its pathfinder boxes (plus a margin) and bounds
  footprint(name, x, z, rot = 0, margin = true, owner = null) {
    const st = this.data.stats(name, 1, owner);
    const tpl = this.template(st.gfx, true);
    const def = this.data.def(name, owner);
    const F = placeFootprint(tpl, x, z, rot, margin ? 2.2 : 0, def && def.wallKind === 'wall' ? WALL_BOXES : null);
    const cells = new Set();
    for (const [bx, bz, hx, hz] of F.boxes) for (const k of this.nav.rectCells(bx, bz, hx, hz, rot)) cells.add(k);
    return { fx: F.fx, fz: F.fz, hx: F.hx, hz: F.hz, boxes: F.boxes, cells: [...cells], radius: Math.max(F.hx, F.hz) * 0.85 };
  },
  inBoxes(boxes, rot, x, z, m = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [bx, bz, hx, hz] of boxes) {
      const dx = x - bx, dz = z - bz;
      if (Math.abs(dx * c - dz * s) < hx + m && Math.abs(dx * s + dz * c) < hz + m) return true;
    }
    return false;
  },
  // placement check (engine place check): inside the map, free cells, no enemy units or resources in the way
  canPlace(name, x, z, rot = 0, owner = null) {
    const def = this.data.def(name, owner);
    if (def && def.coastal) return this.coastalFree(name, x, z, rot, owner);   // harbours: see placement()
    const wallish = def && !!def.wallKind;
    const f = this.footprint(name, x, z, rot, !wallish, owner);
    const P = this.play;
    if (f.fx - f.hx < P.x0 + 6 || f.fx + f.hx > P.x1 - 6 || f.fz - f.hz < P.z0 + 6 || f.fz + f.hz > P.z1 - 6) return false;
    if (!this.nav.free(f.cells)) return false;
    for (const k of f.cells) if (this.reserved[k]) return false;
    let blocked = false;
    this.uHash.query(f.fx, f.fz, f.radius + 8, (u) => { if (u.alive && u.owner !== owner && this.inBoxes(f.boxes, rot, u.pos.x, u.pos.z, u.radius - 2.2)) blocked = true; });
    if (blocked) return false;
    this.rHash.query(f.fx, f.fz, f.radius + 8, (n) => { if (n.alive && this.inBoxes(f.boxes, rot, n.pos.x, n.pos.z, n.radius - 2.2)) blocked = true; });
    return !blocked;
  },
  // Where a building would really be placed for a click at (x, z): coastal buildings snap to the shore,
  // everything else stays where it is. -> {x, z, rot, ok}
  placement(name, x, z, rot = 0, owner = null) {
    const def = this.data.def(name, owner);
    const kind = def && def.wallKind;
    if (kind === 'gate' && !/^CGate|Gate$/.test(def.script || '')) return { x, z, rot, ok: false };
    if (kind === 'gate') {
      // gates go into an own straight wall run and replace one of its pieces (docs/spec/walls.md §5)
      const [i, j] = this.wallMap.tileOf(x, z);
      const fit = this.wallMap.gateFit(i, j, owner);
      const [cx, cz] = this.wallMap.centre(i, j);
      return fit ? { x: cx, z: cz, rot: fit.rot, ok: true, fit } : { x: cx, z: cz, rot: 0, ok: false, why: 'gate' };
    }
    if (kind === 'wall' || kind === 'tower' || kind === 'trap') {
      // the wall placer: tile centres, never rotated; a tower may replace an own wall piece (a joint of the line)
      const [i, j] = this.wallMap.tileOf(x, z);
      const [cx, cz] = this.wallMap.centre(i, j);
      const t = this.wallMap.at(i, j);
      if (t && (t.gate || t.tower || t.trap)) return { x: cx, z: cz, rot: 0, ok: false };
      if (t && t.wall) {
        const own = t.wall.owner === owner;
        return { x: cx, z: cz, rot: 0, ok: own && kind === 'tower', replace: own && kind === 'tower' ? t.wall : null, existing: own && kind === 'wall' ? t.wall : null };
      }
      return { x: cx, z: cz, rot: 0, ok: this.canPlace(name, cx, cz, 0, owner) };
    }
    if (def && def.coastal) {
      const s = this.coastalSnap(name, x, z, owner);
      return s ? { ...s, ok: true } : { x, z, rot, ok: false };
    }
    return { x, z, rot, ok: this.canPlace(name, x, z, rot, owner) };
  },
  // dock side of a coastal building model at rotation 0: link Do_1 (ships berth there), else Ex_1 / RE_1 / Spwn
  dockOffset(name, owner) {
    const st = this.data.stats(name, 1, owner);
    const tpl = st && this.template(st.gfx, true);
    if (!tpl) return { x: 0, z: 8 };
    if (!tpl.dockOffset) {
      tpl.scene.updateMatrixWorld(true);
      let o = null;
      for (const n of ['link_Do_1', 'link_Ex_1', 'link_RE_1', 'link_Spwn']) { o = tpl.scene.getObjectByName(n); if (o) break; }
      const v = new this.THREE.Vector3();
      if (o) o.getWorldPosition(v); else v.set(0, 0, 8);
      tpl.dockOffset = { x: v.x, z: v.z };
    }
    return tpl.dockOffset;
  },
  // Coastal snap (ServerApp.usl:1143 CheckGetCoastal [?engine], docs/spec/naval.md §1.2): the nearest spot around the
  // click (up to 24 m) and the rotation (45° steps) where the dock side lies in water at least 1.5 m deep and the
  // footprint is free; harbours need part of the footprint on land, floating harbours / carriers sit in the water.
  coastalSnap(name, x, z, owner) {
    if (!this.waterNav) return null;
    const dock = this.dockOffset(name, owner);
    for (let r = 0; r <= 24; r += 2) {
      let best = null, bd = 1e9;
      const n = r ? Math.max(8, Math.round(r * 1.5)) : 1;
      for (let a = 0; a < n; a++) {
        const cx = Math.round(x + Math.cos(a / n * 6.2832) * r), cz = Math.round(z + Math.sin(a / n * 6.2832) * r);
        for (let ri = 0; ri < 8; ri++) {
          const rot = ri * Math.PI / 4, c = Math.cos(rot), sn = Math.sin(rot);
          const dx = cx + dock.x * c + dock.z * sn, dz = cz - dock.x * sn + dock.z * c;    // three.js rotation.y
          if (this.waterLevel - this.height(dx, dz) < 1.5) continue;
          if (!this.coastalFree(name, cx, cz, rot, owner)) continue;
          const d = Math.hypot(cx - x, cz - z);
          if (d < bd) { bd = d; best = { x: cx, z: cz, rot }; }
        }
      }
      if (best) return best;
    }
    return null;
  },
  // footprint check for coastal buildings: water cells are allowed, anything else (buildings, trees, cliffs) is not
  coastalFree(name, x, z, rot, owner) {
    if (!this.waterNav || !this.wetCell) return false;
    const f = this.footprint(name, x, z, rot, false, owner);
    const P = this.play;
    if (f.fx - f.hx < P.x0 + 4 || f.fx + f.hx > P.x1 - 4 || f.fz - f.hz < P.z0 + 4 || f.fz + f.hz > P.z1 - 4) return false;
    let wet = 0;
    for (const k of f.cells) {
      if (this.reserved[k] || this.nav.block[k] - this.wetCell[k] > 0) return false;
      wet += this.wetCell[k];
    }
    const frac = wet / Math.max(1, f.cells.length);
    const floating = /floating|carrier/.test(name);
    if (floating ? frac < 0.6 : frac < 0.15 || frac > 0.85) return false;
    let blocked = false;
    this.uHash.query(f.fx, f.fz, f.radius + 8, (u) => { if (u.alive && u.owner !== owner && this.inBoxes(f.boxes, rot, u.pos.x, u.pos.z, u.radius - 2.2)) blocked = true; });
    this.rHash.query(f.fx, f.fz, f.radius + 8, (n2) => { if (n2.alive && !n2.water && this.inBoxes(f.boxes, rot, n2.pos.x, n2.pos.z, n2.radius - 2.2)) blocked = true; });
    return !blocked;
  },
  // move units out of a building footprint
  clearFootprint(b, except = []) {
    this.uHash.query(b.pos.x, b.pos.z, b.radius + 10, (u) => {
      if (!u.alive || except.includes(u) || u.kind !== 'unit' || u.inside) return;
      if (b.surfDist(u.pos.x, u.pos.z) < u.radius + 0.3) {
        const [ex, ez] = b.exitPoint(u.pos.x, u.pos.z);
        if (u.owner === b.owner && (u.task.type === 'idle' || u.task.type === 'hold')) this.order([u], { type: 'move', x: ex, z: ez });
        else { u.pos.x = ex; u.pos.z = ez; if (u.path.length && u.goal) u.setPath(u.goal[0], u.goal[1]); }
      }
    });
  },
  // CheckConditionsAndPay + PlaceObj: pay the whole cost up front, lay the foundation, send the workers
  startConstruction(p, action, x, z, rot, workers) {
    const why = this.data.check(p, action);
    if (why) return why === 'hidden' || why === 'disabled' ? 'req' : why;
    if (!p.canAfford(action.cost)) return 'cost';
    const name = action.results[0].obj;
    const at = this.placement(name, x, z, rot, p);
    if (!at.ok) return 'place';
    x = at.x; z = at.z; rot = at.rot;
    // one warp gate per player
    if (this.data.script(name) === 'CWarpGate' && this.buildings.some((b) => b.alive && b.owner === p && b.def.script === 'CWarpGate')) return 'unique';
    p.pay(action.cost);
    // a gate replaces the wall piece of its tile (its neighbours become its wings); a tower replaces an own piece
    const gone = at.fit ? at.fit.wall : at.replace;
    if (gone) this.removeWallPiece(gone);
    const b = this.placeBuilding(name, p, x, z, rot, false);
    b.action = action;
    b.paid = { ...action.cost };
    if (at.fit) { b.wings = at.fit.wings.filter((w) => w.alive); for (const w of b.wings) w.parentGate = b; }
    this.clearFootprint(b, workers);
    // debug mode: the building stands finished at once
    if (p.debug) { b.progress = 1; b.hp = b.maxHp; this.finishBuilding(b, []); }
    else if (workers.length) this.order(workers, { type: 'build', target: b });
    this.emit('placed', { building: b });
    if (b.onPlaced) b.onPlaced();
    return b;
  },
  // A wall line on the 8 m grid from (x0, z0) to (x1, z1), after the legs already held (Shift corners).
  // -> tiles [{i, j, x, z, rot: 0, state}] with state 'have' (own piece already there: joins, costs nothing), 'ok',
  // 'cost' (more than the player can pay - placed only as far as the resources go) or 'bad' (blocked).
  wallLine(p, action, x0, z0, x1, z1, held = []) {
    const WM = this.wallMap, name = action.results[0].obj;
    const a = WM.tileOf(x0, z0), b = WM.tileOf(x1, z1);
    const out = held.map((t) => ({ ...t }));
    const seen = new Set(out.map((t) => t.i + ',' + t.j));
    let afford = p.debug ? 1e9 : Math.min(1000, ...['food', 'wood', 'stone'].filter((r) => action.cost[r] > 0).map((r) => Math.floor((p.res[r] || 0) / action.cost[r])));
    for (const t of out) if (t.state === 'ok') afford--;
    const req = this.data.check(p, action) === null;
    for (const [i, j] of WM.line(a, b)) {
      const k = i + ',' + j;
      if (seen.has(k)) continue;
      seen.add(k);
      const [x, z] = WM.centre(i, j);
      const at = this.placement(name, x, z, 0, p);
      let state = at.existing ? 'have' : at.ok && req ? 'ok' : 'bad';
      if (state === 'ok' && afford-- <= 0) state = 'cost';
      out.push({ i, j, x, z, rot: 0, state });
    }
    return out;
  },
  // a wall piece disappears without a ruin and without a refund (a gate or tower takes its tile)
  removeWallPiece(w) {
    if (!w || !w.alive) return;
    w.silentDeath = true;
    this.kill(w, null);
  },
  // BuildUp.usl: the worker occupies the nearest free builder link (Bl_n), walks there and hammers
  startBuild(u, b) {
    if (!u.canBuild || !b || !b.alive || b.owner !== u.owner) return;
    if (b.built) { if (b.hp < b.maxHp) this.startRepair(u, b); return; }
    u.task = { type: 'build', building: b, phase: 'go', slot: b.occupySlot(u), user: u.task.user };
    b.builders.add(u);
    const [x, z] = u.task.slot ? [u.task.slot.x, u.task.slot.z] : this.approachPoint(u, b);
    u.setPath(x, z);
  },
  // a reachable point next to a building, towards the unit
  approachPoint(u, b) {
    const a = Math.atan2(u.pos.z - b.pos.z, u.pos.x - b.pos.x);
    for (let r0 = 0.8; r0 < 6; r0 += 1.5) {
      for (let k = 0; k < 24; k++) {
        const aa = a + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.27;
        for (let r = 0; r < b.radius * 2 + 10; r += 1) {
          const x = b.pos.x + Math.cos(aa) * r, z = b.pos.z + Math.sin(aa) * r;
          const sd = b.surfDist ? b.surfDist(x, z) : Math.hypot(x - b.pos.x, z - b.pos.z) - b.radius;
          if (sd >= r0 + u.radius) { if (this.nav.isFree(x, z)) return [x, z]; break; }
        }
      }
    }
    return [b.pos.x, b.pos.z];
  },
  buildUpdate(u, dt) {
    const t = u.task, b = t.building;
    if (t.repair) return this.repairUpdate(u, dt);
    if (!b || !b.alive || b.built) { const done = b; this.releaseTask(u); u.task = { type: 'idle' }; u.busyAnim = false; if (done && done.alive && done.built) this.autoWork(u, done); return; }
    if (t.phase === 'go') {
      const arrived = t.slot ? Math.hypot(u.pos.x - t.slot.x, u.pos.z - t.slot.z) < 1.2 : u.edgeDist(b) < 1.8;
      if (arrived || !u.path.length) { t.phase = 'work'; u.path = []; }
      else { const sp = u.steer(dt, u.speed, 0.5); u.moveAnim(sp); return; }
    }
    u.vel.set(0, 0, 0);
    u.face(b.pos.x, b.pos.z, dt);
    u.attachTool(this.hammerOf(u));
    u.anim.play(u.anim.pick('hammer', 'hacking'));
  },
  hammerOf(u) { const tr = (u.owner ? u.owner.tribe : u.def.tribe).toLowerCase(); return `${tr}_hammer`; },
  // the building's side of construction (CBuildUpBuilding): progress, hit points, construction levels, finish
  constructionUpdate(b, dt) {
    const active = [...b.builders].filter((w) => w.alive && w.task.type === 'build' && w.task.building === b && w.task.phase === 'work' && !w.task.repair);
    if (!active.length) return;
    const N = active.length;
    const act = b.action || this.buildActionOf(b);
    const D = act && act.time > 0 ? act.time : 10;
    const tf = Math.min(...active.map((w) => selfTF(w)));
    const S = 0.1 + 0.9 * Math.pow(0.8, N - 1);
    let rate = 1;
    // Tesla (level 2+) within 20 m doubles the speed, Babbage at level 5 anywhere doubles it again
    const heroes = this.units.filter((h) => h.alive && h.owner === b.owner && (h.name === 'tesla_s0' || h.name === 'babbage_s0'));
    for (const h of heroes) {
      if (h.name === 'tesla_s0' && h.level >= 2 && b.surfDist(h.pos.x, h.pos.z) < 20) rate *= 2;
      if (h.name === 'babbage_s0' && h.level >= 5) rate *= 2;
    }
    const total = D * tf * S * (b.owner && b.owner.aiMods ? b.owner.aiMods.buildTime || 1 : 1);     // AI handicap (Action.usl:346)
    const k = dt * rate / total;
    b.progress = Math.min(1, b.progress + k);
    b.hp = Math.max(1, Math.min(b.maxHp, b.hp + b.maxHp * k));
    // construction level 1 reached: the building starts blocking the pathfinder
    if (b.progress >= 0.25 && !b.blocking && !b.def.gate) { b.setBlocking(true); this.clearFootprint(b, active); }
    b.updateVisual();
    if (b.progress >= 1) this.finishBuilding(b, active);
  },
  finishBuilding(b, workers = []) {
    b.built = true; b.hp = Math.max(b.hp, b.maxHp * 0.999);
    if (!b.blocking && !b.def.gate) { b.setBlocking(true); this.clearFootprint(b, []); }
    b.updateVisual();
    this.entityFilters(b, true);
    // resultactions of the build action (e.g. aje_medium_farm = small farm + the "medium farm" mode)
    const act = b.action || this.buildActionOf(b);
    if (act) for (const r of act.results) for (const ra of r.resultActions || []) this.applyResultAction(b, ra);
    this.recomputeCaps(b.owner);
    this.emit('built', { building: b });
    if (b.onBuilt) b.onBuilt();
    for (const w of workers) { this.releaseTask(w); w.task = { type: 'idle' }; w.busyAnim = false; this.autoWork(w, b); }
  },
  buildActionOf(b) { return this.data.actions(b.owner).find((a) => a.cat === 'Build/BLDG' && a.results[0] && a.results[0].obj === b.name) || null; },
  // after finishing: continue with the next wall segment / unfinished building nearby, farm the new field, or gather
  autoWork(w, b) {
    // walls and gates: the nearest unfinished piece within 50 m of the worker (BuildUp.usl:413-440)
    let next = null, nd = 50;
    if (b.def.wallKind === 'wall' || b.def.wallKind === 'gate') {
      for (const x of this.buildings) {
        if (!x.alive || x.built || x.owner !== w.owner || x === b || (x.def.wallKind !== 'wall' && x.def.wallKind !== 'gate')) continue;
        const d = Math.hypot(x.pos.x - w.pos.x, x.pos.z - w.pos.z);
        if (d < nd) { nd = d; next = x; }
      }
    }
    if (!next) next = this.buildings.find((x) => x.alive && !x.built && x.owner === w.owner && x !== b && x.distTo(b) < 50 && (x.def.wallKind || x.builders.size === 0));
    if (next) { this.startBuild(w, next); return; }
    if (this.isFarm(b)) { this.startGather(w, b); if (w.task.type === 'gather') return; }
    if (b.isDropoff) for (const r of ['wood', 'stone', 'food']) {
      if (!b.def.delivery.includes(r)) continue;
      const n = this.nearestResource(b.pos.x, b.pos.z, r, 40);
      if (n) { this.startGather(w, n); return; }
    }
  },
  // ------------------------------------------------------------------ repair (Repair.usl)
  startRepair(u, b) {
    if (!u.canBuild || !b.alive || !b.built || b.hp >= b.maxHp || b.owner !== u.owner) return;
    u.task = { type: 'build', repair: true, building: b, phase: 'go', slot: b.occupySlot(u), user: u.task.user };
    b.builders.add(u);
    const [x, z] = u.task.slot ? [u.task.slot.x, u.task.slot.z] : this.approachPoint(u, b);
    u.setPath(x, z);
  },
  repairUpdate(u, dt) {
    const t = u.task, b = t.building;
    if (!b || !b.alive || b.hp >= b.maxHp) {
      this.releaseTask(u); u.task = { type: 'idle' }; u.busyAnim = false;
      // continue with the next damaged building (walls: next damaged segment) within 50 m
      const next = b && this.buildings.find((x) => x.alive && x.built && x.owner === u.owner && x.hp < x.maxHp && x.distTo(b) < 50);
      if (next) this.startRepair(u, next);
      return;
    }
    if (t.phase === 'go') {
      const arrived = t.slot ? Math.hypot(u.pos.x - t.slot.x, u.pos.z - t.slot.z) < 1.2 : u.edgeDist(b) < 1.8;
      if (arrived || !u.path.length) { t.phase = 'work'; u.path = []; }
      else { const sp = u.steer(dt, u.speed, 0.5); u.moveAnim(sp); return; }
    }
    u.vel.set(0, 0, 0);
    u.face(b.pos.x, b.pos.z, dt);
    u.attachTool(this.hammerOf(u));
    u.anim.play(u.anim.pick('hammer', 'hacking'));
    // cost per hit point: 50 % of the build cost spread over the building's hit points; stops when a resource runs out
    const hp = Math.min(b.maxHp - b.hp, (20 + 5 * (u.level - 1)) * dt);
    const cost = (b.paid || (b.action && b.action.cost) || (this.buildActionOf(b) || {}).cost || {});
    const p = u.owner;
    b.repairDebt = b.repairDebt || { food: 0, wood: 0, stone: 0 };
    for (const r of RES) {
      if (!cost[r]) continue;
      if (p.res[r] <= 0) { this.releaseTask(u); u.task = { type: 'idle' }; this.emit('msg', { player: p, text: 'Not enough resources to repair' }); return; }
      b.repairDebt[r] += 0.5 * cost[r] * hp / b.maxHp;
      const whole = Math.floor(b.repairDebt[r]);
      if (whole > 0) { p.res[r] -= whole; b.repairDebt[r] -= whole; }
    }
    b.hp += hp;
  },
  // ------------------------------------------------------------------ BuildDown (Aje) and self destruction
  startBuildDown(b) {
    if (!b.alive || !b.built || b.dismantling) return 'busy';
    const act = this.buildActionOf(b);
    b.dismantling = { t: 0, total: 0.5 * (act ? act.time : 20), cost: act ? act.cost : null };
    if (b.owner && b.owner.tt) b.owner.tt.enable(`${b.def.tribe}/Upgrades/${b.name}/BuildDown`);
    return null;
  },
  cancelBuildDown(b) {
    if (!b.dismantling) return;
    b.dismantling = null;
    if (b.owner && b.owner.tt) b.owner.tt.disable(`${b.def.tribe}/Upgrades/${b.name}/BuildDown`);
  },
  buildDownUpdate(b, dt) {
    const d = b.dismantling;
    d.t += dt;
    b.onWork(this.time);
    if (d.t < d.total) return;
    // GrantResources: the full build cost back (capped by storage), then the building vanishes without ruins
    if (b.owner && d.cost) b.owner.refund({ food: d.cost.food, wood: d.cost.wood, stone: d.cost.stone });
    if (b.owner && b.owner.tt) b.owner.tt.disable(`${b.def.tribe}/Upgrades/${b.name}/BuildDown`);
    b.dismantling = null;
    b.silentDeath = true;
    this.kill(b, null);
  },
  // "Kill" action on own buildings (DiePerHarakiri): no refund; unfinished sites give back what was paid
  selfDestruct(b) {
    if (!b.alive) return;
    if (!b.built && b.paid && b.owner) b.owner.refund(b.paid);
    b.silentDeath = !b.built;
    this.kill(b, null);
  },
  // ------------------------------------------------------------------ destruction (Die / Delete / BuildingCorpse)
  buildingDestroyed(e, att) {
    this.bHash.remove(e);
    this.emit('ground', { x: e.pos.x, z: e.pos.z, r: e.radius + 2 });
    e.setBlocking(false);
    this.reserve(e.cells, -1);
    e.removeCranes();
    for (const w of e.builders) if (w.task.building === e) { this.releaseTask(w); w.task = { type: 'idle' }; }
    const p = e.owner;
    if (p) for (const q of e.queue) { p.refund(q.action.cost); if (q.level) { p.queuedAtLevel[q.level - 1]--; p.queuedUnits--; } }
    e.queue = [];
    for (const w of e.workers) if (w.task.farm === e) w.task = { type: 'idle' };
    if (e.passengers && this.unloadAll) this.unloadAll(e, false);
    if (e.dismantling) this.cancelBuildDown(e);
    this.recomputeCaps(p);
    e.deadT = 0;
    // Ninigi buildings with the "Explode" invention blow up: 500 -> 100 damage in 20 m (FO:5578)
    if (e.localInvents && e.localInvents.has('Explode')) this.areaDamage(null, e.pos, 20, 500, 100, { owner: p, direct: true, size: 7 });
    // finished buildings (not walls) leave their ruin model "<gfx>_dest" for 8 s
    e.ruin = e.built && !e.silentDeath && e.def.wallKind !== 'wall' ? this.ruinOf(e) : null;
    // the wall grid: neighbours lose their arm towards it; a gate frees its wings
    if (e.tile) this.wallMap.remove(e);
    if (e.wings) { for (const w of e.wings) if (w.parentGate === e) w.parentGate = null; e.wings = null; }
    if (e.ruin) { this.scene.remove(e.obj); e.ruin.visible = e.obj.visible; }
    if (e.silentDeath) { this.scene.remove(e.obj); e.removed = true; }
    this.emit('destroyed', { entity: e, killer: att, silent: !!e.silentDeath });
  },
  ruinOf(b) {
    const tpl = this.template((b.stats.gfx + '_dest').toLowerCase(), true);
    if (!tpl) return null;
    const r = this.cloneModel(tpl);
    r.traverse((o) => { if (o.isMesh) this.applyFow(o.material); });
    r.position.copy(b.origin);
    r.rotation.y = b.rot;
    this.scene.add(r);
    return r;
  },
};
