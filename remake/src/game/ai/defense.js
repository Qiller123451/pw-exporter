// Defense module of the computer player: danger detection (CAiGoalDefendOutpost), the village guard
// (CAiGoalGuardVillage), defend mode for the workers (CAiGoalDefendMode), towers (CAiGoalBuildTowers) and the
// defence areas of campaign triggers (AIDA). docs/spec/ai.md §7. TribeAI methods; S = the census.
//
// Differences to the original, on purpose: the original sends its whole pool at any enemy near its buildings; here
// as many defenders go as the threat needs (level score >= 1.5 x attackers + 2), so a scout does not empty the
// village. Workers hide only when an attacker comes close to them (22 m), not all at once.
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const P = (e) => ({ x: e.pos.x, z: e.pos.z });
const NEAR = 28;            // an enemy this close to one of the village's buildings is a danger
const HIDE = 22;            // workers take cover from attackers this close
const SAFE = 36;

export const Defense = {
  // what happened to this player since the last look (world events: deaths, hits)
  readEvents() {
    const ev = this.W.events, p = this.p;
    if (!ev.length) { this.evI = 0; this.evLast = null; return; }
    if (this.evI > ev.length || (this.evI > 0 && ev[this.evI - 1] !== this.evLast)) this.evI = 0;
    for (let i = this.evI || 0; i < ev.length; i++) {
      const e = ev[i];
      if (e.type === 'attacked') {
        const v = e.entity, by = e.by;
        if (!v || v.owner !== p || !by || !by.alive) continue;
        if (by.owner) {
          if (p.isEnemy(by.owner)) {
            this.lastAttacker = by.owner; this.hitT = this.W.time; this.hitAt = P(v);
            // who shoots at the village from beyond the alarm distance (a mortar, a catapult) is a threat too
            if (by.kind === 'unit' && (v.kind === 'building' || v.isWorker)) (this.hitters || (this.hitters = new Map())).set(by, this.W.time);
          }
        } else if (by.kind === 'unit') this.animalHit = { u: by, t: this.W.time };
      } else if (e.type === 'died') {
        const v = e.entity, k = e.killer;
        // a worker killed by a wild animal: pest patrol there on the next strategy think (DA:689)
        if (v && v.owner === p && v.isWorker && k && !k.owner && this.multimap) this.pest = P(v);
      }
    }
    this.evI = ev.length; this.evLast = ev[ev.length - 1];
  },
  nearOwnBuilding(x, z, r) {
    let hit = false;
    this.W.bHash.query(x, z, r + 24, (b) => { if (!hit && b.alive && b.owner === this.p && !b.def.wallKind && b.surfDist(x, z) < r) hit = true; });
    return hit;
  },
  // the village is also where its workers are: an enemy fighter next to a worker inside the base range (the
  // farthest building + 30 m, GV:734-770) is in the village
  nearOwnWorker(S, u) {
    if (u.isWorker || !S.home) return false;
    if (S.range === undefined) { let r = 60; for (const b of S.blds) r = Math.max(r, Math.hypot(b.pos.x - S.home.x, b.pos.z - S.home.z)); S.range = r + 30; }
    if (Math.hypot(u.pos.x - S.home.x, u.pos.z - S.home.z) > S.range) return false;
    let hit = false;
    this.W.uHash.query(u.pos.x, u.pos.z, 18, (w) => { if (!hit && w.alive && w.owner === this.p && w.isWorker && Math.hypot(w.pos.x - u.pos.x, w.pos.z - u.pos.z) < 18) hit = true; });
    return hit;
  },
  // where the idle army stands: the place a campaign script named, else between the village and the enemy
  guardPoint(S) {
    if (this.guardBase) return this.guardBase;
    const h = S.home, e = this.enemyHint(S);
    const a = Math.atan2(e.z - h.z, e.x - h.x);
    return { x: h.x + Math.cos(a) * 30, z: h.z + Math.sin(a) * 30 };
  },

  // ------------------------------------------------------------------ danger and defenders (DefendOutpost, GV:365-594)
  defenseThink(S) {
    const W = this.W, p = this.p;
    if (this.prm.noDefence) { this.alarm = null; this.defending = false; return; }
    const guard = this.guard || (this.guard = { units: new Set(), drop(u) { this.units.delete(u); } });
    const threats = [];
    let animals = [];
    for (const u of W.units) {
      if (!u.alive || u.inside || u.owner === p) continue;
      if (u.owner) { if (!p.isEnemy(u.owner) || u.naval || W.hiddenFrom(u, p)) continue; } else if (!(this.animalHit && this.animalHit.u === u && W.time - this.animalHit.t < 12)) continue;
      if (!this.nearOwnBuilding(u.pos.x, u.pos.z, NEAR) && !(u.owner && (this.nearOwnWorker(S, u) || (this.hitters && W.time - (this.hitters.get(u) || -99) < 15)))) continue;
      (u.owner ? threats : animals).push(u);
    }
    // hostile animals: fewer than seven fighters leave them alone (GV:530); never more than a handful go
    if (threats.length || S.fighters.length < 7) { if (!threats.length) animals = []; }
    const all = threats.length ? threats : animals;
    this.alarm = all.length ? { units: all, animal: !threats.length } : null;
    // attacks are refused while enemies are in the village (FM:211); the workers' defend mode
    this.defending = threats.some((u) => !u.isWorker);
    this.defendMode = this.defending && S.home && threats.some((u) => d2(P(u), S.home) < 45);
    this.protectWorkers(S, all);
    for (const u of [...guard.units]) if (!u.alive || this.locked.has(u)) { guard.units.delete(u); this.claims.delete(u); }
    if (this.hitters && this.hitters.size > 40) for (const [u, t] of this.hitters) if (!u.alive || W.time - t > 15) this.hitters.delete(u);
    if (!all.length) {
      if (guard.units.size) { this.release([...guard.units]); guard.units.clear(); }
      if (this.militiaSet && this.militiaSet.size) this.militia(S, [], 0, 0);
      return;
    }
    let cx = 0, cz = 0, need = 2;
    for (const u of all) { cx += u.pos.x; cz += u.pos.z; if (!u.isWorker) need += u.level * 1.5; else need += 0.5; }
    cx /= all.length; cz /= all.length;
    if (this.alarm.animal) need = Math.min(need, 5);
    let have = this.score(guard.units);
    if (have < need) {
      const cand = S.pool.filter((u) => !this.claims.has(u));
      // a squad that is still being put together in the village defends it too (its attack then fails or waits)
      if (!this.alarm.animal) for (const a of this.attacks) if (!a.scripted && !a.hunt && (a.state === 'build' || a.state === 'gather')) for (const u of a.units) if (u.alive && !u.inside) cand.push(u);
      cand.sort((a, b) => Math.hypot(a.pos.x - cx, a.pos.z - cz) - Math.hypot(b.pos.x - cx, b.pos.z - cz));
      const add = [];
      for (const u of cand) { if (have >= need || (this.alarm.animal && guard.units.size + add.length >= 2)) break; add.push(u); have += u.level + (u.def.unique ? 2 : 0); }
      for (const u of add) { const c = this.claims.get(u); if (c && c.drop) c.drop(u); guard.units.add(u); }
      this.claim(add, guard);
    }
    this.militia(S, threats, have, need);
    const moved = !guard.at || Math.hypot(guard.at.x - cx, guard.at.z - cz) > 12;
    if (moved) guard.at = { x: cx, z: cz };
    for (const u of guard.units) {
      const t = u.task.type;
      if (t === 'attack' && u.task.target && u.task.target.alive) continue;
      if (t === 'idle' || t === 'hold' || moved || t === 'move') {
        if (this.alarm.animal) W.order([u], { type: 'attack', target: all[0] });
        else W.order([u], { type: 'attackmove', x: cx, z: cz, auto: true });
      }
    }
  },
  // A village without fighters (or with fewer than a third of what it would need) is defended by its workers: the
  // ones near an attacker gang up on it. (CheckForWorkerSupport, GV:1142-1191 - in the scripts, but never called.)
  militia(S, threats, have, need) {
    const W = this.W;
    const m = this.militiaSet || (this.militiaSet = new Set());
    const foes = threats.filter((u) => !u.isWorker && u.cls !== 'VHCL');
    const on = foes.length > 0 && have < need / 3 && S.workers.length >= 2 * foes.length + 2;
    for (const w of [...m]) {
      if (w.alive && on && w.task.type === 'attack' && w.task.target && w.task.target.alive) continue;
      m.delete(w);
      if (w.alive && !on && w.task.type === 'attack') { W.releaseTask(w); w.task = { type: 'idle' }; w.path = []; }
    }
    if (!on) return;
    for (const f of foes) {
      let n = 0;
      for (const w of m) if (w.task.target === f) n++;
      const want = Math.min(6, 2 + f.level * 2);
      if (n >= want) continue;
      const near = S.workers.filter((w) => !m.has(w) && !w.inside && w.task.type !== 'build' && Math.hypot(w.pos.x - f.pos.x, w.pos.z - f.pos.z) < 45)
        .sort((a, b) => Math.hypot(a.pos.x - f.pos.x, a.pos.z - f.pos.z) - Math.hypot(b.pos.x - f.pos.x, b.pos.z - f.pos.z)).slice(0, want - n);
      for (const w of near) { m.add(w); if (this.hidden) this.hidden.delete(w); }
      if (near.length) W.order(near, { type: 'attack', target: f });
    }
  },
  // workers near an attacker take cover: Hu in bunkers (four each), Ninigi dig in, the others run to the main
  // building; they come back when the attacker is gone (DMo:118-291)
  protectWorkers(S, threats) {
    const W = this.W;
    const hid = this.hidden || (this.hidden = new Set());
    const fighters = threats.filter((u) => !u.isWorker);
    for (const w of [...hid]) {
      if (!w.alive) { hid.delete(w); continue; }
      if (fighters.some((u) => Math.hypot(u.pos.x - w.pos.x, u.pos.z - w.pos.z) < SAFE)) continue;
      if (W.time - (w.aiHidT || 0) < 6) continue;
      hid.delete(w);
      if (w.inside) W.leaveTransport(w);
      else if (w.st && w.st.camo.has('entr')) W.digOut(w);
      else if (w.task.type === 'entrench' || w.task.type === 'move') { W.releaseTask(w); w.task = { type: 'idle' }; w.path = []; }
    }
    if (!fighters.length) return;
    const tribe = this.p.tribe;
    const bunkers = tribe === 'Hu' ? S.blds.filter((b) => b.built && b.def.script === 'CBunker') : [];
    for (const w of S.workers) {
      if (hid.has(w) || w.inside || this.locked.has(w) || (this.militiaSet && this.militiaSet.has(w))) continue;
      const foe = fighters.find((u) => Math.hypot(u.pos.x - w.pos.x, u.pos.z - w.pos.z) < HIDE);
      if (!foe) continue;
      w.aiHidT = W.time;
      const bunker = bunkers.filter((b) => (b.passengers || []).length + (b.aiBooked || 0) < 4 && Math.hypot(b.pos.x - w.pos.x, b.pos.z - w.pos.z) < 100).sort((a, b) => a.distTo(w) - b.distTo(w))[0];
      if (bunker && W.canBoard(w, bunker)) { W.order([w], { type: 'board', target: bunker, auto: true }); hid.add(w); continue; }
      if (tribe === 'Ninigi') {
        const a = W.movesOf(w).find((x) => x.id === 'entrench');
        if (a && !W.moveCheck(w, a) && W.digIn(w)) { hid.add(w); continue; }
      }
      // away from the attacker, towards the main building
      if (S.home && d2(P(w), S.home) > 12 && w.task.type !== 'attack') { W.order([w], { type: 'move', x: S.home.x + (Math.random() - 0.5) * 10, z: S.home.z + (Math.random() - 0.5) * 10, auto: true }); hid.add(w); }
    }
  },

  // ------------------------------------------------------------------ the village guard, defence areas, towers
  guardThink(S) {
    const W = this.W;
    this.guardN = (this.guardN || 0) + 1;
    if (this.areas.size) this.areasThink(S);
    if (!this.economyOff && this.guardN % 10 === 3) this.towerThink(S);
    if (!this.prm.guard_village || this.prm.noDefence) return;
    // the idle army patrols to a building that was just hit, else it stands at the guard point (GV:399-428)
    let at = null;
    if (this.hitAt && W.time - this.hitT < 15 && !this.alarm) at = this.hitAt;
    const g = at || this.guardPoint(S);
    const changed = !this.guardAt || d2(this.guardAt, g) > 8;
    this.guardAt = g;
    const R = 30;                                         // SetGuardRange(30)
    for (const u of S.pool) {
      if (this.claims.has(u)) continue;
      const t = u.task.type;
      if (t === 'attack' || t === 'special' || t === 'heal') continue;
      if (Math.hypot(u.pos.x - g.x, u.pos.z - g.z) <= R) continue;
      if (t === 'idle' || t === 'hold' || (changed && (t === 'move' || t === 'attackmove') && !u.task.then)) {
        W.order([u], { type: 'attackmove', x: g.x + (Math.random() - 0.5) * 16, z: g.z + (Math.random() - 0.5) * 16, auto: true });
      }
    }
  },
  // AIDA {id, position, radius, max_units}: a guard of up to maxUnits pool units in a disc; maxUnits <= 0 removes it
  setDefenceArea(id, pos, radius, maxUnits) {
    id = String(id);
    const old = this.areas.get(id);
    if (!(maxUnits > 0) || !pos) {
      if (old) { this.release([...old.units]); this.areas.delete(id); }
      return;
    }
    const a = old || { id, units: new Set(), drop(u) { this.units.delete(u); } };
    a.x = pos.x; a.z = pos.z; a.r = Math.max(5, +radius || 20); a.max = Math.round(maxUnits);
    this.areas.set(id, a);
    this.next.guard = Math.min(this.next.guard || 0, this.W.time + 0.2);
  },
  areasThink(S) {
    const W = this.W;
    for (const a of this.areas.values()) {
      for (const u of [...a.units]) if (!u.alive || this.locked.has(u) || this.claims.get(u) !== a) a.units.delete(u);
      // four more units per think until the area is manned (AddDefensePool(.., 4, ..))
      if (a.units.size < a.max) {
        const cand = S.pool.filter((u) => !this.claims.has(u)).sort((x, y) => Math.hypot(x.pos.x - a.x, x.pos.z - a.z) - Math.hypot(y.pos.x - a.x, y.pos.z - a.z)).slice(0, Math.min(4, a.max - a.units.size));
        for (const u of cand) a.units.add(u);
        this.claim(cand, a);
      }
      let foe = null, fd = 1e9;
      W.uHash.query(a.x, a.z, a.r + 10, (e) => { if (!this.isEnemyEntity(e) || e.inside || W.hiddenFrom(e, this.p)) return; const d = Math.hypot(e.pos.x - a.x, e.pos.z - a.z); if (d < a.r + (e.radius || 0) && d < fd) { fd = d; foe = e; } });
      for (const u of a.units) {
        const t = u.task.type;
        if (t === 'attack' && u.task.target && u.task.target.alive) { if (Math.hypot(u.pos.x - a.x, u.pos.z - a.z) > a.r + 35) W.order([u], { type: 'move', x: a.x, z: a.z, auto: true }); continue; }
        if (foe) { if (t === 'idle' || t === 'hold') W.order([u], { type: 'attackmove', x: foe.pos.x, z: foe.pos.z, auto: true }); continue; }
        const d = Math.hypot(u.pos.x - a.x, u.pos.z - a.z);
        if ((t === 'idle' || t === 'hold') && d > Math.max(6, a.r * 0.6)) {
          const ang = Math.random() * 6.283, r = Math.random() * Math.min(a.r * 0.5, 12);
          W.order([u], { type: 'attackmove', x: a.x + Math.cos(ang) * r, z: a.z + Math.sin(ang) * r, auto: true });
        }
      }
    }
  },
  // the best tower the tribe can build now
  bestTower(S) {
    const p = this.p, D = this.D;
    let best = null, bc = -1;
    for (const a of D.actions(p)) {
      if (a.cat !== 'Build/BLDG' || !a.results[0] || D.check(p, a)) continue;
      const cls = a.results[0].obj, def = D.def(cls, p);
      if (!def || def.wallKind !== 'tower') continue;
      const ws = D.weaponSet(cls, 1, p);
      if (!ws || !ws.long || !ws.long.projectile) continue;
      const c = a.cost.food + a.cost.wood + a.cost.stone;
      if (c > bc) { bc = c; best = a; }
    }
    return best;
  },
  // towers where buildings are not covered by one (DM:752-823), and at a new stone site (CR:373); never next to
  // enemies. At most 1 + epoch of them (the original has no such limit: its planner's priorities do the limiting)
  towerThink(S) {
    const p = this.p, D = this.D, W = this.W;
    if (!this.prm.upgrade_towers || this.prm.noTowers || this.alarm) return;
    if ((this.extra || []).some((e) => e.tower) || S.blds.some((b) => !b.built && b.def.wallKind === 'tower')) return;
    const a = this.bestTower(S);
    if (!a) return;
    const towers = S.blds.filter((b) => b.def.wallKind === 'tower' && b.weapons && b.weapons.long);
    if (towers.length >= 1 + S.age + (this.letter === 'S' ? 1 : 0)) return;
    const cls = a.results[0].obj;
    const ws = D.weaponSet(cls, 1, p), cs = ws && ws.long ? D.weaponStats(ws.long, cls, p) : null;
    const reach = (cs ? cs.range : 24) * 1.2;
    let spot = this.towerAt && !this.dangerAt(this.towerAt.x, this.towerAt.z) ? this.towerAt : null;
    if (!spot) {
      let bv = 0;
      for (const b of S.blds) {
        if (!b.built || b.def.wallKind || towers.some((t) => t.distTo(b) < reach)) continue;
        if (this.regions.size && this.regionValue('DefensiveCoverage', b.pos.x, b.pos.z) < 0) continue;
        const v = (b === S.base ? 3 : b.queue ? 2 : 1) + Math.random() * 0.5;
        if (v > bv && !this.dangerAt(b.pos.x, b.pos.z)) { bv = v; spot = P(b); }
      }
    }
    if (!spot) return;
    this.towerAt = spot;
    if (!(this.extra || []).some((e) => e.R.cls === cls) && this.addOnTop('BLDG/' + cls, '', { unique: false })) this.extra[this.extra.length - 1].tower = true;
    void W;
  },
};
