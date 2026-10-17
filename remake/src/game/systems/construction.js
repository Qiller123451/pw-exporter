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
  // (from: where the workers stand - a ladder goes to the side of the wall nearest them, systems/siege.js)
  placement(name, x, z, rot = 0, owner = null, from = null) {
    const def = this.data.def(name, owner);
    if (def && def.script === 'CLadder') return this.ladderPlacement(name, x, z, owner, from);
    const kind = def && def.wallKind;
    if (kind === 'gate' && !/^CGate|Gate$/.test(def.script || '')) return { x, z, rot, ok: false };
    if (kind === 'gate') {
      // CalcWall for a gate (wallmap.js calcGate, 0x7e26c0): the cursor's tile, the first axis d = 0..7 that fits;
      // the gate takes the stronger wall class of its tiles (gateName: the class's gate)
      const WM = this.wallMap;
      const [i, j] = WM.tileOf(x, z);
      const [cx, cz] = WM.centre(i, j);
      const w = WM.calcWall(owner, name, x, z, x, z);
      if (!w) return { x: cx, z: cz, rot: 0, ok: false, why: 'gate' };
      const t = WM.at(i, j);
      const fit = { d: w.d, rot: WM.gateRot(w.d), wings: WM.gateWings(i, j, w.d), wall: t && t.wall && t.wall.alive ? t.wall : null, cls: w.cls };
      return { x: cx, z: cz, rot: fit.rot, ok: true, fit, gateName: this.wallClassName(w.race, w.cls, 1) || name };
    }
    if (kind === 'wall' || kind === 'tower' || kind === 'trap') {
      // the wall placer: one tile (CalcWall with start = end); a tower may stand on an own wall piece, which stays
      const WM = this.wallMap;
      const [i, j] = WM.tileOf(x, z);
      const [cx, cz] = WM.centre(i, j);
      const w = WM.calcWall(owner, name, x, z, x, z);
      const t = w && w.tiles[w.tiles.length - 1];
      return { x: cx, z: cz, rot: 0, ok: !!w && !(t && t.existing), existing: t && t.existing ? (WM.at(i, j) || {})[kind] || null : null };
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
      if (this.reserved[k] || this.nav.block[k] - this.wetCell[k] - (this.steepCell ? this.steepCell[k] : 0) > 0) return false;   // the shore is not walkable either
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
    const from = workers.length ? [workers.reduce((s, w) => s + w.pos.x, 0) / workers.length, workers.reduce((s, w) => s + w.pos.z, 0) / workers.length] : null;
    const at = this.placement(name, x, z, rot, p, from);
    if (!at.ok) return 'place';
    x = at.x; z = at.z; rot = at.rot;
    // one warp gate per player
    if (this.data.script(name) === 'CWarpGate' && this.buildings.some((b) => b.alive && b.owner === p && b.def.script === 'CWarpGate')) return 'unique';
    // a gate of the stronger class of its wall (CalcWall's class rule): that class's gate and price
    let act = action;
    if (at.gateName && at.gateName !== name) {
      const a2 = this.data.actions(p).find((x) => x.kind === 'Build' && x.results[0] && x.results[0].obj === at.gateName);
      if (a2) { act = a2; if (!p.canAfford(a2.cost)) return 'cost'; }
    }
    p.pay(act.cost);
    // a gate replaces the wall piece of its tile (the server's tile update deletes it, no refund; its neighbours
    // become the wings); a tower stands on an own piece, which stays
    if (at.fit && at.fit.wall) this.removeWallPiece(at.fit.wall);
    // AdaptTerrain: the ground levels to the building and takes its brush's materials (not for walls, gates and
    // coastal buildings; game/ground.js)
    const def = this.data.def(name, p);
    if (this.adaptTerrain && def && !def.coastal && !def.wallKind && !at.dock) {      // (bWall: no AdaptTerrain, SA:1327)
      const st = this.data.stats(name, 1, p);
      if (st && st.gfx) this.adaptTerrain(st.gfx, x, z, rot);
    }
    if (act !== action) action = act;
    const b = this.placeBuilding(action.results[0].obj, p, x, z, rot, false);
    if (at.fit) { b.gateD = at.fit.d; }
    // the plants, trees and stumps within the building's radius go (ServerApp.usl PlaceObj "Vegetation")
    if (this.clearVegetation && b) this.clearVegetation(x, z, b.hx ? Math.hypot(b.hx, b.hz) : b.radius);      // (GetRadius: the bounding circle)
    b.action = action;
    b.paid = { ...action.cost };
    if (at.fit) { b.wings = at.fit.wings.filter((w) => w.alive); for (const w of b.wings) w.parentGate = b; }
    if (at.dock) this.ladderPlaced(b, at.dock);                // a ladder holds its wall piece (systems/siege.js)
    this.clearFootprint(b, workers);
    // debug mode: the building stands finished at once
    if (p.debug) { b.progress = 1; b.hp = b.maxHp; this.finishBuilding(b, []); }
    else if (workers.length) this.order(workers, { type: 'build', target: b });
    this.emit('placed', { building: b });
    if (b.onPlaced) b.onPlaced();
    return b;
  },
  // A wall line from (x0, z0) to (x1, z1) after the legs already held (Shift corners): the engine's CalcWall
  // (wallmap.js calcWall: a shortest path over placeable tiles, all or nothing). -> null when there is no line, else
  // tiles [{i, j, x, z, rot: 0, state, gateOK}]: state 'have' (an own piece is there already: no cost), 'ok' or
  // 'cost' (the k-th entry of the list is green while k < what the player can pay for, PreviewWall's numA - the
  // existing tiles count too, as in the original), the list's race / class / type in .wall
  wallLine(p, action, x0, z0, x1, z1, held = []) {
    const WM = this.wallMap, name = action.results[0].obj;
    const w = WM.calcWall(p, name, x0, z0, x1, z1, held.map((t) => ({ i: t.i, j: t.j, existing: t.state === 'have', gateOK: !!t.gateOK })));
    if (!w) return null;
    const afford = p.debug ? 1e9 : Math.min(1000, ...['food', 'wood', 'stone'].filter((r) => action.cost[r] > 0).map((r) => Math.floor((p.res[r] || 0) / action.cost[r])));
    const req = this.data.check(p, action) === null;
    const out = w.tiles.map((t, k) => {
      const [x, z] = WM.centre(t.i, t.j);
      return { i: t.i, j: t.j, x, z, rot: 0, gateOK: t.gateOK, state: t.existing ? 'have' : !req ? 'bad' : k + 1 <= afford ? 'ok' : 'cost' };
    });
    out.wall = w;
    return out;
  },
  // the class name for (race, class, type) of the wall class table (0x7df350)
  wallClassName(race, cls, type) {
    const T = this.wallMap.classes || {};
    for (const n in T) { const c = T[n]; if (c[0] === race && c[1] === cls && c[2] === type) return n; }
    return null;
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
    // (copies of them too: Rules.kind)
    for (const h of this.units) {
      if (!h.alive || h.owner !== b.owner || h.kind !== 'unit') continue;
      const k = this.data.kind(h.name);
      if (k === 'tesla_s0' && h.level >= 2 && b.surfDist(h.pos.x, h.pos.z) < 20) rate *= 2;
      if (k === 'babbage_s0' && h.level >= 5) rate *= 2;
    }
    const total = D * tf * S;          // (the computer player's time handicap is Action.usl's: production and research only)
    this.addProgress(b, dt * rate / total, active);
  },
  // CBuildUpBuilding.AddProgress: k of the whole (0..1), the hit points along with it
  addProgress(b, k, active = []) {
    if (b.built) return;
    b.progress = Math.min(1, b.progress + k);
    b.hp = Math.max(1, Math.min(b.maxHp, b.hp + b.maxHp * k));
    // construction level 1 reached: the building starts blocking the pathfinder
    if (b.progress >= 0.25 && !b.blocking && !b.def.gate) { b.setBlocking(true); this.clearFootprint(b, active); }
    b.updateVisual();
    if (b.progress >= 1) this.finishBuilding(b, active);
  },
  finishBuilding(b, workers = []) {
    b.built = true; b.hp = Math.max(b.hp, b.maxHp * 0.999);
    if (b.tile && this.wallMap) this.wallMap.setReady(b);              // (WallMap.SetReady: the built bits)
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
  // the action that puts the building up; a building of another tribe the player was given (mission 9's launch ramp,
  // played with another tribe) is put up as its own tribe does it
  buildActionOf(b) {
    const find = (list) => list.find((a) => a.cat === 'Build/BLDG' && a.results[0] && a.results[0].obj === b.name) || null;
    const ix = this.data.info(b.name);
    return find(this.data.actions(b.owner)) || (b.owner && ix && ix.tribe && ix.tribe !== b.owner.tribe ? find(this.data.foreignActions(b.owner, ix.tribe)) : null);
  },
  // after finishing (CCharacter.NextJob, character.usl:1234-1280): the next wall piece (BuildUp.usl:413-440); farm the
  // new field or slaughterhouse; quarries send their builders for stone (100 m), lumberjack cottages and lumber mills
  // for wood, the hunting lodge for food (100 m); MIRAGE's storehouses for the nearest resource they take; any
  // other building is repaired if damaged, else the builders look for an unfinished building within 50 m
  autoWork(w, b) {
    // the queued tiles of a wall line first (Q_Build, in list order: PlaceWall 0x490920)
    while (w.buildQueue && w.buildQueue.length) {
      const x = w.buildQueue.shift();
      if (x && x.alive && !x.built) { this.startBuild(w, x); return; }
    }
    w.buildQueue = null;
    if (b.def.wallKind === 'wall' || b.def.wallKind === 'gate') {
      let next = null, nd = 50;
      for (const x of this.buildings) {
        if (!x.alive || x.built || x.owner !== w.owner || x === b || (x.def.wallKind !== 'wall' && x.def.wallKind !== 'gate')) continue;
        const d = Math.hypot(x.pos.x - w.pos.x, x.pos.z - w.pos.z);
        if (d < nd) { nd = d; next = x; }
      }
      if (next) { this.startBuild(w, next); return; }
    }
    const own = b.owner === w.owner, k = this.data.kind(b.name), mirage = this.data.extra.mod === 'MIRAGE';
    const near = (res, r) => { const n = this.nearestResource(w.pos.x, w.pos.z, res, r); if (n) this.startGather(w, n); return !!n; };
    if (this.isFarm(b)) { if (own) this.startGather(w, b); return; }
    if (/^(hu|ninigi)_stone_quarry$/.test(k)) { near('stone', 100); return; }
    if (k === 'hu_lumberjack_cottage' || k === 'ninigi_lumbermill') { near('wood', 64); return; }
    if (k === 'ninigi_hunting_lodge') { near('food', 100); return; }
    if (mirage && b.isDropoff && /^(aje_bazaar|hu_marketplace|hu_warehouse|ninigi_warehouse|seas_small_tent|seas_steelwork|aje_resource_collector)$/.test(k)) {
      for (const r of ['wood', 'stone', 'food']) if (b.def.delivery.includes(r) && near(r, 40)) return;
      return;
    }
    if (b.hp < b.maxHp * 0.998) { this.startRepair(w, b); return; }      // (finishBuilding leaves at least 99.9 %)
    if (b.def.wallKind === 'wall') return;
    const next = this.buildings.find((x) => x.alive && !x.built && x.owner === w.owner && x !== b && x.distTo(b) < 50 && (x.def.wallKind || x.builders.size === 0));
    if (next) this.startBuild(w, next);
  },
  // the work a target means for a worker (CCharacter.NextJob): an unfinished own or friendly building - build it; a
  // finished one - what its builders do (autoWork); a resource - gather it. false: nothing to do
  nextJob(w, t) {
    if (!t || !t.alive || !w.isWorker) return false;
    if (t.kind === 'res') { this.startGather(w, t); return true; }
    if (t.kind !== 'building' || !t.owner || !w.owner.isFriend(t.owner)) return false;
    if (!t.built) this.startBuild(w, t); else this.autoWork(w, t);
    return true;
  },
  // a new worker that reached a rally point on open ground (CTheLite "exit"): a tree within 5 m, stone within 3 m,
  // fruit or a carcass within 10 m; else a building within 10 m - an unfinished one: the nearest unfinished building
  // to build, a finished one: the nearest damaged one to repair (SearchBuildingToBuildUp / SearchBuildingToRepair)
  rallyJob(w, x, z) {
    if (!w.isWorker) return;
    for (const [res, r] of [['wood', 5], ['stone', 3], ['food', 10]]) {
      const n = this.nearestResource(x, z, res, r);
      if (n) { this.startGather(w, n); return; }
    }
    let b = null, bd = 10;
    this.bHash.query(x, z, 10 + 40, (e) => { if (!e.alive) return; const d = e.surfDist(x, z); if (d < bd) { bd = d; b = e; } });
    if (!b) return;
    const own = (e) => e.alive && e.owner && w.owner.isFriend(e.owner);
    const pick = (ok) => this.buildings.filter((e) => own(e) && ok(e) && e.distTo(w) < 50).sort((a, c) => a.distTo(w) - c.distTo(w))[0];
    const t = !b.built ? pick((e) => !e.built) : pick((e) => e.built && e.hp < e.maxHp * 0.998);
    if (t && !t.built) this.startBuild(w, t); else if (t) this.startRepair(w, t);
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
    // the toolkit artefact: repairs cost its player nothing (Repair.usl, character.usl ms_iRepairNoCost)
    for (const r of (this.repairNoCost === p ? [] : RES)) {
      if (!cost[r]) continue;
      if (p.res[r] <= 0) { this.releaseTask(u); u.task = { type: 'idle' }; this.emit('msg', { player: p, text: 'Not enough resources to repair' }); return; }
      b.repairDebt[r] += 0.5 * cost[r] * hp / b.maxHp;
      const whole = Math.floor(b.repairDebt[r]);
      if (whole > 0) { p.res[r] -= whole; b.repairDebt[r] -= whole; }
    }
    b.hp += hp;
  },
  // ------------------------------------------------------------------ BuildDown (Aje) and self destruction
  // BuildDown (CBuildDownBuilding) is an item of the building's queue: it waits behind what is queued before it, shows
  // in the queue with its progress (CurProcess), and a click on it there cancels it (RemoveAction). From the moment
  // it is queued the filter /Filters/Aje/Upgrades/<class>/BuildDown takes away the building's other actions.
  // a: the BuildDown move action
  startBuildDown(b, a) {
    if (!b.alive || !b.built) return 'busy';
    if (b.queue.some((q) => q.buildDown)) return null;                // Building.BuildDown: once
    if (b.queue.length >= 6) return 'full';
    const act = this.buildActionOf(b);
    b.queue.push({ action: a, buildDown: true, t: 0, total: 0.5 * (act ? act.time : 20), cost: act ? act.cost : null, level: 0 });
    this.buildDownFilter(b, true);
    return null;
  },
  buildDownFilter(b, on) { this.localFilter(b, `${b.def.tribe}/Upgrades/${b.name}/BuildDown`, on); },
  // the BuildDown item at the front of the queue: GrantResources (the full build cost back, capped by storage), then
  // the building vanishes without ruins
  buildDownDone(b, item) {
    if (b.owner && item.cost) b.owner.refund({ food: item.cost.food, wood: item.cost.wood, stone: item.cost.stone });
    this.buildDownFilter(b, false);
    b.queue.splice(b.queue.indexOf(item), 1);
    b.silentDeath = true;
    this.kill(b, null);
  },
  // "Kill" action on own buildings (Building.usl Action "/Kill" -> DiePerHarakiri = OnKill(); Die()): no refund, an
  // unfinished site's cost is lost too
  selfDestruct(b) {
    if (!b.alive) return;
    b.silentDeath = !b.built;
    this.kill(b, null);
  },
  // ------------------------------------------------------------------ destruction (Die / Delete / BuildingCorpse)
  buildingDestroyed(e, att) {
    this.bHash.remove(e);
    if (e.behaviour && e.behaviour.destroyed) e.behaviour.destroyed(e, this);      // (systems/buildings.js: gates free their cells, a Scorpion panel)
    this.emit('ground', { x: e.pos.x, z: e.pos.z, r: e.radius + 2 });
    e.setBlocking(false);
    this.reserve(e.cells, -1);
    e.removeCranes();
    for (const w of e.builders) if (w.task.building === e) { this.releaseTask(w); w.task = { type: 'idle' }; }
    const p = e.owner;
    if (p) for (const q of e.queue) { if (!q.buildDown) p.refund(q.action.cost); if (q.level) { p.queuedAtLevel[q.level - 1]--; p.queuedUnits--; } }
    if (p && e.countsInPop) { p.units--; p.atLevel[e.level - 1]--; }
    e.queue = [];
    for (const w of e.workers) if (w.task.farm === e) w.task = { type: 'idle' };
    if (e.passengers && this.unloadAll) this.unloadAll(e, false);
    this.recomputeCaps(p);
    e.deadT = 0;
    // Ninigi buildings with the "Explode" invention blow up: 500 -> 100 damage in 20 m (FO:5578)
    if (e.localInvents && e.localInvents.has('Explode')) this.areaDamage(null, e.pos, 20, 500, 100, { owner: p, direct: true, size: 7 });
    // finished buildings (not walls) leave their ruin model "<gfx>_dest" for 8 s
    e.ruin = e.built && !e.silentDeath && e.def.wallKind !== 'wall' ? this.ruinOf(e) : null;
    // the wall grid: the characters on a piece fall, its siege object loses its hold, neighbours lose their arm
    // towards it; a gate frees its wings (systems/wallwalk.js, siege.js)
    if (e.tile && e.def.wallKind === 'wall') this.wallPieceGone(e);
    this.siegeGone(e);
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
