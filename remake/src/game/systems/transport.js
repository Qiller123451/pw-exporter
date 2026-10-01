// Transports and garrisons: the Hu bunker, closed transports (steam tank, hovercraft, siege tower, turtle) and
// open ones where passengers ride on the animal and keep shooting (triceratops, saltasaurus, rhino, chariot ...).
//
// Reference: docs/spec/units.md section 4 (TransportObj.usl, BoardTransport.usl, CBunker in Building.usl).
//   transport class 1 (land) carries characters only; class 2 (ships, hovercraft, turtle) also animals and vehicles.
//   Passengers can't be hit. When a land transport dies they get out; on a sinking ship they die.
const OPEN = new Set(['hu_chariot', 'hu_rhino_transporter', 'hu_triceratops', 'aje_triceratops_archer', 'aje_brachiosaurus',
  'aje_stegosaurus', 'ninigi_saltasaurus_archer', 'seas_triceratops_transporter']);

export const Transport = {
  capacity(t) {
    if (t.kind === 'building') return t.def.script === 'CBunker' ? 4 : 0;
    return t.stats.maxPassengers || t.def.maxPassengers || 0;
  },
  isOpenTransport(t) { return OPEN.has(t.name); },
  canBoard(u, t) {
    if (!u.alive || !t.alive || u === t || u.owner !== t.owner || u.inside || u.passengers && u.passengers.length) return false;
    const cap = this.capacity(t);
    if (!cap || (t.passengers || []).length >= cap) return false;
    if (t.kind === 'building') return t.built && u.cls === 'CHTR';
    const cls = t.def.transportClass || 1;
    if (cls === 1) return u.cls === 'CHTR';
    return u.cls !== 'SHIP' && !(u.def.transportClass >= 2);
  },
  // nearest walkable land point within r of a ship (GetShipBoardingPos [?engine], naval.md §2.5), or null
  shorePoint(t, r = 30, near = null) {
    const nav = this.nav, from = near || t.pos;
    const c = nav.nearestFree(nav.idx(from.x, from.z), Math.ceil((r + 20) / nav.cell));
    if (nav.block[c]) return null;
    const [x, z] = nav.center(c);
    return Math.hypot(x - t.pos.x, z - t.pos.z) <= r + t.radius ? [x, z] : null;
  },
  // boarding a ship: the passenger walks to the shore next to the ship, the ship comes to the shore near the passenger
  boardShipUpdate(u, t, dt) {
    const tk = u.task;
    tk.shipT = (tk.shipT || 0) - dt;
    if (tk.shipT <= 0) {
      tk.shipT = 1.5;
      // bring an idle ship to the waterline closest to the passenger
      if ((t.task.type === 'idle' || t.task.type === 'hold') && Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z) > 25 && this.waterNav) {
        const wn = this.waterNav, c = wn.nearestFree(wn.idx(u.pos.x, u.pos.z), 30);
        if (!wn.block[c]) { const [x, z] = wn.center(c); this.order([t], { type: 'move', x, z, auto: true }); }
      }
      tk.shore = this.shorePoint(t, 30, u.pos) || this.shorePoint(t, 30);
      if (tk.shore) u.setPath(tk.shore[0], tk.shore[1]);
    }
    const dShip = Math.hypot(t.pos.x - u.pos.x, t.pos.z - u.pos.z) - t.radius;
    const atShore = tk.shore ? Math.hypot(tk.shore[0] - u.pos.x, tk.shore[1] - u.pos.z) < 3.5 : false;
    if (dShip < 30 && (atShore || dShip < 3)) { this.enterTransport(u, t); return; }
    if (u.path.length) u.moveAnim(u.steer(dt, u.runSpeed, 0.5)); else { u.vel.set(0, 0, 0); u.anim.play(u.standAnim ? u.standAnim() : u.idleAnim); }
  },
  boardUpdate(u, dt) {
    const t = u.task.target;
    if (!t || !this.canBoard(u, t)) { u.task = { type: 'idle' }; return; }
    if (t.naval) { this.boardShipUpdate(u, t, dt); return; }
    const d = t.kind === 'building' ? t.surfDist(u.pos.x, u.pos.z) : u.distTo(t) - t.radius;
    // close enough: 2.5 m from the wall, or standing at the approach point (which can be a little farther)
    if (d > 2.5 && !(d < 4 && !u.path.length && u.task.walked)) {
      u.task.walked = true;
      u.repathT = (u.repathT || 0) - dt;
      if (u.repathT <= 0 || !u.path.length) { const [x, z] = t.kind === 'building' ? this.approachPoint(u, t) : [t.pos.x, t.pos.z]; u.setPath(x, z); u.repathT = 1; }
      const sp = u.steer(dt, u.runSpeed, 0.5); u.moveAnim(sp);
      return;
    }
    this.enterTransport(u, t);
  },
  enterTransport(u, t) {
    this.releaseTask(u);
    t.passengers = t.passengers || [];
    t.passengers.push(u);
    u.inside = t;
    u.task = { type: 'inside' };
    u.path = []; u.vel.set(0, 0, 0);
    u.obj.visible = false;
    this.uHash.remove(u);
    this.emit('boarded', { unit: u, transport: t });
  },
  leaveTransport(u, x, z) {
    const t = u.inside;
    if (!t) return;
    if (t.passengers) t.passengers = t.passengers.filter((p) => p !== u);
    u.inside = null;
    if (x === undefined) { const [ex, ez] = t.kind === 'building' ? t.exitPoint(t.pos.x + 5, t.pos.z + 5) : [t.pos.x + (Math.random() - 0.5) * 6, t.pos.z + (Math.random() - 0.5) * 6]; x = ex; z = ez; }
    if (!this.nav.isFree(x, z)) { const c = this.nav.nearestFree(this.nav.idx(x, z), 8); [x, z] = this.nav.center(c); }
    u.pos.set(x, this.height(x, z), z);
    if (u.alive) { u.obj.visible = true; this.uHash.insert(u); u.task = { type: 'idle' }; u.anchor.set(x, z); }
  },
  // everybody out (/DismountAll); on death of a ship the passengers die with it
  unloadAll(t, dying) {
    const list = [...(t.passengers || [])];
    // ships unload onto the shore within 30 m; on a sinking ship whoever can't reach the shore dies (Ship.usl:248)
    const shore = t.naval ? this.shorePoint(t, 30) : null;
    if (t.naval && !shore && !dying) { this.emit('msg', { player: t.owner, text: 'Too far from the shore to unload' }); return; }
    list.forEach((u, i) => {
      if (t.naval && !shore) { this.leaveTransport(u); u.silentDeath = true; this.kill(u, null); return; }
      const a = (i / Math.max(1, list.length)) * Math.PI * 2;
      const r = t.naval ? 1.5 + (i % 3) * 1.2 : (t.radius || 2) + 2;
      const [cx, cz] = shore || [t.pos.x, t.pos.z];
      this.leaveTransport(u, cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    });
    t.passengers = [];
  },
  // passengers of open transports shoot with their long-range weapon from the animal's back
  passengerUpdate(u, dt) {
    const t = u.inside;
    if (!t || !t.alive) return;
    u.pos.set(t.pos.x, t.pos.y, t.pos.z);
    if (!this.isOpenTransport(t) || !u.weapons.long || !u.weapons.long.projectile) return;
    const cs = u.cs(u.weapons.long);
    const R = this.attackRangeOf(u, cs) + t.radius;
    let e = u.task.target;
    if (!e || !this.canTarget(u, e) || this.reach(t, e) > R) {
      e = (t.task.type === 'attack' && t.task.target && this.canTarget(u, t.task.target) && this.reach(t, t.task.target) <= R) ? t.task.target : this.findTarget(t, R);
      u.task.target = e;
    }
    if (!e || this.time - u.lastHitDone <= this.attackDuration(u, cs)) return;
    u.lastHitDone = this.time;
    const from = t.pos.clone(); from.y += (t.height || 3) * 0.9;
    this.launch(u, from, e, u.weapons.long, cs);
  },
};
