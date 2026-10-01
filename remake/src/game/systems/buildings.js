// Special building behaviours, chosen by the building's script class (classes/buildings/*_buildings.txt).
//
// Reference: docs/spec/buildings.md (Building.usl CGate, CTrap family, CKennel, CNinigi_Dilophosaurus_Nest,
// CImpResinField, CWarpGate, CGrowingField ...).
//
// To give a building class new behaviour add an entry to BEHAVIOURS:
//   init(b, W)        when the building object is created
//   built(b, W)       when construction is finished
//   update(b, W, dt)  every simulation step while the building is finished and alive
//   destroyed(b, W)   when it dies
// Buildings without an entry are plain buildings (production, storage, housing and towers are handled elsewhere).

// ------------------------------------------------------------------------------------------------ gates
export const GATE = { OPEN: 0, CLOSED: 1, AUTO: 2 };
const AUTO_CLOSE = 8;            // AUTO gates close 8 s after the last unit passed
const gate = {
  init(b) { b.gateState = GATE.AUTO; b.gateOpen = false; },
  built(b, W) { W.setGateCells(b); },
  update(b, W, dt) {
    // AUTO: a gate opens for its owner's (and allies') units and closes again after 8 s
    if (b.gateState === GATE.AUTO) {
      let pass = false;
      W.uHash.query(b.pos.x, b.pos.z, b.radius + 6, (u) => { if (!pass && u.alive && u.owner && b.owner.isFriend(u.owner) && b.surfDist(u.pos.x, u.pos.z) < 3) pass = true; });
      if (pass) { b.autoT = AUTO_CLOSE; if (!b.gateOpen) setGateAnim(b, true); }
      else if (b.gateOpen && (b.autoT -= dt) <= 0) setGateAnim(b, false);
    }
    // lock picked (ninja): forced open for 30 s, then closed again if it was closed before
    if (b.brokenT > 0 && (b.brokenT -= dt) <= 0 && b.formerState === GATE.CLOSED) W.setGate(b, GATE.CLOSED);
  },
  destroyed(b, W) { W.clearGateCells(b); },
};
function setGateAnim(b, open) {
  b.gateOpen = open;
  if (b.anim) { const a = b.anim.pick(open ? 'open' : 'close'); if (a) b.anim.play(a, { loop: false, restart: true }); }
}

// ------------------------------------------------------------------------------------------------ traps (CTrap)
// radius: trigger radius, types: victim classes, once: one victim then re-arm, rearm: seconds
const TRAPS = {
  CPitfall: { radius: 5, types: ['CHTR', 'ANML', 'VHCL', 'SHIP'], once: true, rearm: 21,
    fire(b, v, W) { W.takeDmg(b, v, 1, 0); if (b.anim) b.anim.play(b.anim.pick('attack_front') || 'attack_front', { loop: false, restart: true }); } },
  CMinefield: { radius: 3, types: ['CHTR', 'ANML', 'VHCL', 'SHIP'], once: true, rearm: 20,
    fire(b, v, W) { const cs = b.cs(); W.areaDamage(b, b.pos, cs ? cs.splash : 10, cs ? cs.dmg : 350, cs ? cs.endDmg : 200); W.emit('impact', { pos: b.pos.clone(), weapon: b.weapons.long || {}, splash: true }); } },
  CSnareTrap: { radius: 3, types: ['CHTR'], once: true, rearm: 1, hold: true,
    fire(b, v, W) { b.held = v; W.trap(v, 1e6, 'snare'); if (b.anim) b.anim.play(b.anim.pick('catching', 'hanging') || 'catching', { loop: false, restart: true }); } },
  CPoisonDung: { radius: 5, types: ['CHTR', 'ANML', 'VHCL', 'SHIP'], once: false,
    fire(b, v, W) { W.takeDmg(b, v, 1, 0); } },
};
const trapBehaviour = (T) => ({
  init(b) { b.st.camo.add('trap'); b.untargetable = false; b.trap = { armed: true, ignore: new Set(), rearmT: 0 }; },
  update(b, W, dt) {
    const s = b.trap;
    // the snare holds its victim until it (or the trap) dies: 3 damage per second
    if (b.held) {
      if (!b.held.alive) { b.held = null; s.rearmT = T.rearm; s.armed = false; }
      else { W.takeDirectDmg(b.held, 3 * dt, 99, b.owner, false, b); b.held.path = []; b.held.vel.set(0, 0, 0); }
      return;
    }
    if (!s.armed) { if ((s.rearmT -= dt) <= 0) { s.armed = true; s.ignore.clear(); b.st.camo.add('trap'); } return; }
    const inside = new Set();
    W.uHash.query(b.pos.x, b.pos.z, T.radius + 4, (v) => {
      if (!v.alive || v.inside || !v.owner || !b.owner.isEnemy(v.owner) || !T.types.includes(v.cls)) return;
      if (Math.hypot(v.pos.x - b.pos.x, v.pos.z - b.pos.z) > T.radius + v.radius * 0.5) return;
      if (v.task && v.task.target === b) return;
      inside.add(v);
    });
    for (const v of [...s.ignore]) if (!inside.has(v)) s.ignore.delete(v);
    for (const v of inside) {
      if (s.ignore.has(v)) continue;
      s.ignore.add(v);
      T.fire(b, v, W);
      // a trap that caught someone is revealed to that player
      b.st.camo.delete('trap');
      W.emit('trap', { building: b, victim: v });
      if (T.once) { s.armed = false; s.rearmT = T.rearm; break; }
    }
  },
  destroyed(b, W) { if (b.held && b.held.alive) b.held.st.t.trapped = W.time; },
});

// ------------------------------------------------------------------------------------------------ resin field (Burn)
const resin = {
  init(b) { b.st.camo.add('trap'); },
  update(b, W, dt) {
    const f = b.burning;
    if (!f) return;
    f.t += dt; f.tick -= dt;
    if (f.tick <= 0) {
      f.tick += 1;
      // first second: the fire spreads to own resin fields within 13 m
      if (!f.spread) { f.spread = true; for (const o of W.buildings) if (o !== b && o.alive && o.built && o.owner === b.owner && o.name === b.name && o.distTo(b) < 13) W.burnResin(o); }
      const cs = b.cs();
      const R = cs && cs.splash ? cs.splash : 6;
      W.uHash.query(b.pos.x, b.pos.z, R + 8, (v) => { if (v.alive && !v.inside && v.owner && b.owner.isEnemy(v.owner) && Math.hypot(v.pos.x - b.pos.x, v.pos.z - b.pos.z) - v.radius < R) W.takeDmg(b, v, 1, 0); });
      if (W.fx && Math.random() < 0.8) W.fx.spawn('fire', b.pos.clone().setY(b.pos.y + 0.5), { size: 3, size1: 1, life: 1, vel: new W.THREE.Vector3(0, 2, 0) });
    }
    if (f.t >= 30) { b.burning = null; b.rehideT = 20; b.setGfxOverride && b.setGfxOverride(null); }
    if (b.rehideT > 0 && (b.rehideT -= dt) <= 0) b.st.camo.add('trap');
  },
};

// ------------------------------------------------------------------------------------------------ nests (kennel, dilophosaurus nest)
// two autonomous animals, one every 20 s, kept within 50 m of the building (Nest.usl)
const nest = (spawn) => ({
  built(b) { b.nest = { spawn, t: 20, members: [] }; },
  update(b, W, dt) {
    const n = b.nest; if (!n) return;
    n.members = n.members.filter((u) => u.alive);
    if (n.members.length < 2 && (n.t -= dt) <= 0) {
      n.t = 20;
      const [x, z] = b.exitPoint(b.pos.x + 5, b.pos.z + 5);
      const u = W.spawnUnit(spawn, b.owner, x, z, 1, 0, { autonomous: true });
      if (u) { u.home.set(b.pos.x, b.pos.z); u.homeRadius = 50; n.members.push(u); }
    }
    for (const u of n.members) if (u.task.type === 'idle' && Math.hypot(u.pos.x - b.pos.x, u.pos.z - b.pos.z) > 50) W.order([u], { type: 'move', x: b.pos.x, z: b.pos.z });
  },
  destroyed(b) { if (b.nest) for (const u of b.nest.members) if (u.alive) u.world.kill(u, null); },
});

// ------------------------------------------------------------------------------------------------ warp gate
// When finished a countdown starts (MPSettings WarpGateTimer, default 10 minutes); if the gate survives its
// owner wins. Only on maps / games that allow it (DimGateAvailable) - a skirmish option here.
const warpgate = {
  init(b, W) { if (!W.rules.warpgate) { b.disabled = true; } else W.emit('warpgate', { building: b, state: 'started' }); },
  built(b, W) { if (b.disabled) return; b.warpT = (W.rules.warpgateMinutes || 10) * 60; W.emit('warpgate', { building: b, state: 'finished' }); },
  update(b, W, dt) {
    if (b.warpT == null) return;
    b.warpT -= dt;
    if (b.warpT <= 0 && !b.warpDone) { b.warpDone = true; W.emit('warpgate', { building: b, state: 'won' }); W.victory(b.owner); }
  },
  destroyed(b, W) { if (b.warpT != null && !b.warpDone) W.emit('warpgate', { building: b, state: 'destroyed' }); },
};

// ------------------------------------------------------------------------------------------------ fields
// CGrowingField / CCornfield: the grow animation follows the workers' progress (GetCorn.usl)
const field = {
  built(b) { b.growStep = 0; if (b.anim && b.anim.has('grow')) { b.anim.play('grow', { loop: false }); if (b.anim.cur) b.anim.cur.paused = true; } },
};

export const BEHAVIOURS = {
  CGate: gate, CGateFOWVIsible: gate, CNinigi_Defense_Skewer_Gate: gate,
  CPitfall: trapBehaviour(TRAPS.CPitfall), CMinefield: trapBehaviour(TRAPS.CMinefield),
  CSnareTrap: trapBehaviour(TRAPS.CSnareTrap), CPoisonDung: trapBehaviour(TRAPS.CPoisonDung),
  CImpResinField: resin,
  CKennel: nest('hu_kennel_eusmilus'), CNinigi_Dilophosaurus_Nest: nest('ninigi_dilophosaurus'),
  CWarpGate: warpgate,
  CGrowingField: field, CCornfield: field,
};

// ------------------------------------------------------------------------------------------------ world mixin
export const BuildingBehaviours = {
  behaviourOf(b) { return BEHAVIOURS[b.def.script] || null; },
  // gates: path finding lets the owner's team through an AUTO gate, everybody through an OPEN one, nobody through a CLOSED one
  setGateCells(b) { for (const k of b.cells) this.nav.gateAt.set(k, b); this.nav.version++; },
  clearGateCells(b) { for (const k of b.cells) if (this.nav.gateAt.get(k) === b) this.nav.gateAt.delete(k); this.nav.version++; },
  setGate(b, state) {
    if (!b.def.gate) return;
    b.gateState = state;
    setGateAnim(b, state === GATE.OPEN);
    this.nav.version++;
  },
  // ninja lock picking: the gate is forced open for 30 s
  openViolently(b) {
    if (b.gateState === GATE.OPEN || b.brokenT > 0) return;
    b.formerState = b.gateState; b.brokenT = 30;
    this.setGate(b, GATE.OPEN);
  },
  burnResin(b) {
    if (!b.alive || !b.built || b.burning) return false;
    if ((b.burnCD || 0) > this.time) return false;
    b.burnCD = this.time + 40;
    b.burning = { t: 0, tick: 0, spread: false };
    b.st.camo.delete('trap');
    return true;
  },
};
