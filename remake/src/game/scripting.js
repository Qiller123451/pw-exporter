// World methods for mission scripting (the trigger engine of the campaign calls these; nothing here is specific to
// one trigger). Game coordinates, Player objects and 1-based levels like everywhere in the world code; the campaign
// layer (game/campaign/setup.js) wraps them for map coordinates, player slots and 0-based levels.
const RES_NAME = { food: 'food', wood: 'wood', stone: 'stone', iron: 'skulls', skulls: 'skulls' };
const warned = new Set();
const warnOnce = (msg) => { if (!warned.has(msg)) { warned.add(msg); console.warn(msg); } };

export const Scripting = {
  // ------------------------------------------------------------------ diplomacy (CDiplomacySrvMgr)
  // relation of player a towards player b: 0 hostile, 1 neutral, 2 friendly. One direction per call, as the DIPL
  // action does it (ActionFactory.usl:3291-3295); mutual = both directions.
  setDiplomacy(a, b, rel, mutual = false) {
    if (!a || !b || a === b) return;
    const was = a.relation(b);
    a.setRelation(b, rel);
    if (mutual) b.setRelation(a, rel);
    if (was !== rel || mutual) this.emit('diplomacy', { a, b, rel, mutual: !!mutual });
  },
  // may unit / tower u be ORDERED to attack t? Hostile and ownerless targets: yes. A neutral player's object: yes -
  // the order makes both players hostile (declareWar). Never if either player is a friend of the other
  // (FightingObj.usl:6594-6603, single player).
  attackAllowed(u, t) {
    if (!u || !t || !t.alive || t === u || t.kind === 'res') return false;
    const a = u.owner, b = t.owner;
    if (!a || !b) return true;
    if (a === b) return false;
    return !(a.isFriend(b) || b.isFriend(a));
  },
  // an attack order on a non-hostile player's object: both sides become hostile (FightingObj.usl:6613-6614)
  declareWar(a, b) {
    if (!a || !b || a === b || (a.isEnemy(b) && b.isEnemy(a))) return false;
    a.setRelation(b, 0); b.setRelation(a, 0);
    this.emit('diplomacy', { a, b, rel: 0, mutual: true, attacked: true });
    return true;
  },

  // ------------------------------------------------------------------ objects
  // create an object by class name: a unit (level 1-based, default the class's lowest) or a finished building.
  // Returns the entity, or null (unknown class, model not loaded, a second unique hero).
  spawn(cls, owner, x, z, opts = {}) {
    const ix = this.data.info(cls);
    if (!ix) { warnOnce('spawn: unknown class ' + cls); return null; }
    if (ix.type === 'BLDG') return this.placeBuilding(cls, owner, x, z, opts.heading || 0, opts.built !== false);
    const u = this.spawnUnit(cls, owner, x, z, opts.level || undefined, opts.heading || 0, opts.unit || {});
    if (u && !owner && ix.type !== 'ANML') { u.wild = false; u.stance = 3; }      // an ownerless soldier / ship just stands there
    return u;
  },
  // the model a unit class would get (tech tree gfx, class file gfx, or the mission's stand-in), null if none is loaded
  unitModel(name, level, owner) {
    const s = this.data.statsAt(name, level || this.data.minLevel(name, owner), owner);
    if (s && s.gfx && this.templates(s.gfx, true)) return s.gfx;
    const cg = this.data.classGfx(name);
    if (cg && this.templates(cg, true)) return cg;
    const si = this.standIns && this.standIns.get(String(name).toLowerCase());
    return si && this.templates(si, true) ? si : null;
  },
  // a free ground (or water) cell near (x, z): [x, z]
  freeSpot(x, z, opts = {}) {
    const nav = opts.water ? (this.waterNav || this.nav) : opts.unit ? this.navFor(opts.unit) : this.nav;
    if (nav.isFree(x, z)) return [x, z];
    return nav.center(nav.nearestFree(nav.idx(x, z), opts.radius || 40));
  },
  // delete without death: no animation, no corpse, no spirit, no skulls, not counted as a loss. Emits 'removed'.
  removeEntity(e) {
    if (!e || !e.alive) return false;
    if (e.inside && this.leaveTransport) this.leaveTransport(e);
    e.silentDeath = true; e.lastDamager = null; e.blasted = true;
    const n = this.events.length, lost = e.owner ? e.owner.lost : 0;
    this.kill(e, null);
    for (let i = this.events.length - 1; i >= n; i--) { const ev = this.events[i]; if ((ev.type === 'died' || ev.type === 'destroyed') && ev.entity === e) this.events.splice(i, 1); }
    if (e.owner) e.owner.lost = lost;
    if (e.corpseNode && e.corpseNode.alive) this.depleteNode(e.corpseNode);
    if (e.kind === 'unit' && e.obj) e.obj.visible = false;
    this.emit('removed', { entity: e });
    return true;
  },
  // change the owner of a unit or building (null = nobody). Population, pyramid, heroes, tech tree filters and
  // storage follow; the model is rebuilt in the new party colour; orders and production are dropped.
  setOwner(e, p) {
    if (!e || !e.alive || e.owner === p) return false;
    const from = e.owner;
    if (e.kind === 'unit') {
      this.releaseTask(e);
      for (const q of e.queue) { if (from) { from.refund(q.action.cost); if (q.level) { from.queuedAtLevel[q.level - 1]--; from.queuedUnits--; } } }
      e.queue = [];
      if (from) {
        this.entityFilters(e, false);
        if (e.countsInPop) { from.units--; from.atLevel[e.level - 1]--; }
        if (e.def.unique) from.heroes.delete(e.name);
      }
      e.owner = p; e._ro = null;
      e.wild = !p && e.cls === 'ANML';
      if (!p && e.cls !== 'ANML') e.stance = 3;
      if (p) {
        if (e.countsInPop) { p.units++; p.atLevel[e.level - 1]++; }
        if (e.def.unique) p.heroes.add(e.name);
        this.entityFilters(e, true);
      }
      const ratio = e.hp / e.maxHp;
      e.readRules();
      e.hp = Math.max(1, Math.min(e.maxHp, ratio * e.maxHp));
      e.buildModel();
      if (e.inside || e.parked) e.obj.visible = false;
      e.task = e.inside ? { type: 'inside' } : { type: 'idle' };
      e.path = []; e.attackers.clear(); e.autoMovesCache = null;
      e.anchor.set(e.pos.x, e.pos.z);
      for (const q of e.passengers || []) this.setOwner(q, p);
    } else if (e.kind === 'building') {
      if (from) { for (const q of e.queue) { from.refund(q.action.cost); if (q.level) { from.queuedAtLevel[q.level - 1]--; from.queuedUnits--; } } }
      e.queue = [];
      if (from && e.built) this.entityFilters(e, false);
      e.owner = p; e._ro = null;
      if (p && e.built) this.entityFilters(e, true);
      e.partsKey = null;
      e.refreshRules();
      e.swapModel(e.gfx);
      e.forcedTarget = e.towerTarget = null;
      for (const q of e.passengers || []) this.setOwner(q, p);
    } else return false;
    this.recomputeCaps(from); this.recomputeCaps(p);
    this.emit('owner', { entity: e, from, to: p });
    return true;
  },
  // hit points: an absolute value (clamped to 1 .. maximum); 0 or less kills
  setHp(e, hp) {
    if (!e || !e.alive) return;
    if (hp <= 0) { this.kill(e, null); return; }
    e.hp = Math.max(1, Math.min(e.maxHp, hp));
    if (e.kind === 'building') e.updateVisual();
  },
  // the level designer's invulnerability (SetLDInvulnerable): on / off, or on for `seconds`
  setInvulnerable(e, on, seconds = 0) {
    if (!e) return;
    e.invulnT = on ? 1e12 : 0;
    e.invulnUntil = on && seconds > 0 ? this.time + seconds : 0;
    if (e.invulnUntil) this.later(seconds, () => { if (e.invulnUntil && this.time >= e.invulnUntil - 1e-6) { e.invulnT = 0; e.invulnUntil = 0; } });
  },
  // set a unit's level (1..5) without paying skulls or playing the level-up (SetLevelClean); full hit points
  setLevel(u, level) {
    if (!u || !u.alive || u.kind !== 'unit') return false;
    let nl = Math.max(1, Math.min(5, Math.round(level)));
    while (nl > 1 && !(this.data.stats(u.name, nl, u.owner) || {}).exists) nl--;
    nl = Math.max(nl, this.data.minLevel(u.name, u.owner));
    if (nl === u.level) return true;
    const p = u.owner, ol = u.level;
    if (p && u.countsInPop) { p.atLevel[ol - 1]--; p.atLevel[nl - 1]++; }
    this.levelFilters(u, ol, false);
    const task = u.task;
    u.applyLevel(nl);
    u.hp = u.maxHp;
    this.levelFilters(u, nl, true);
    u.task = task;
    if (u.inside || u.parked) u.obj.visible = false;
    return true;
  },
  // move a unit to (x, z) at once: the current order ends, it leaves its transport
  teleport(e, x, z, heading) {
    if (!e || !e.alive || e.kind !== 'unit') return false;
    if (e.inside && this.leaveTransport) this.leaveTransport(e, x, z);
    this.releaseTask(e);
    const nav = this.navFor(e);
    if (!nav.isFree(x, z)) [x, z] = nav.center(nav.nearestFree(nav.idx(x, z)));
    e.task = { type: 'idle' }; e.path = []; e.vel.set(0, 0, 0); e.busyAnim = false;
    e.pos.set(x, 0, z); e.pos.y = this.groundY(e);
    if (heading != null) e.heading = heading;
    e.anchor.set(x, z); e.home.set(x, z);
    e.syncObj();
    if (!e.parked) this.uHash.move(e);
    return true;
  },
  // take an object out of the world without deleting it (OBAP without the "visible" flag: hidden reinforcements,
  // scenery that appears later): not drawn, not found, not hit, does nothing. parked = false brings it back.
  setParked(e, parked) {
    if (!e || !e.alive || !!e.parked === !!parked) return;
    e.parked = !!parked;
    if (e.kind === 'unit') {
      if (parked) { this.releaseTask(e); e.task = { type: 'idle' }; e.path = []; e.vel.set(0, 0, 0); if (!e.inside) this.uHash.remove(e); if (e.obj) e.obj.visible = false; }
      else if (!e.inside) { this.uHash.insert(e); e.anchor.set(e.pos.x, e.pos.z); }
    } else if (e.kind === 'building') {
      if (parked) { this.bHash.remove(e); if (e.built) e.setBlocking(false); e.obj.visible = false; }
      else { this.bHash.insert(e); if (e.built) e.setBlocking(true); }
    }
  },

  // ------------------------------------------------------------------ players
  // RSRC: res = food | wood | stone | iron (= skulls); mod = '+n' | '-n' | '=n' | 'n' (set). cap: limit the result to
  // the storage (not for skulls); never below 0 (ActionFactory.usl:334-511).
  setResource(p, res, mod, cap = false) {
    const r = RES_NAME[String(res).toLowerCase()];
    if (!p || !r) return;
    const m = String(mod).trim(), n = parseInt(m.replace(/^[+=]/, ''), 10) || 0;
    let v = m[0] === '+' ? p.res[r] + n : m[0] === '-' ? p.res[r] + n : n;
    if (cap && r !== 'skulls') v = Math.min(v, p.caps[r]);
    p.res[r] = Math.max(0, v);
  },
  // PLCP: fixed storage limits (rescap_food / wood / stone); buildings no longer change them
  setCaps(p, caps) {
    if (!p) return;
    for (const r of ['food', 'wood', 'stone']) if (caps[r] != null && Number.isFinite(+caps[r])) p.caps[r] = +caps[r];
    p.capsFixed = true;
  },
  // tech tree filters of a player (TECH action, the players' start filters). path as in the data:
  // "/Filters/AntiActions/Hu/Build/CHTR/hu_archer" - an enabled AntiAction FORBIDS that build / upgrade.
  // A filter is on or off (no counting): enabling twice and disabling once leaves it off.
  setFilter(p, path, on) {
    if (!p || !p.tt || !path) return false;
    const f = String(path).replace(/^\/?Filters\//, '');
    const key = 'script:' + f;
    p.scriptFilters = p.scriptFilters || new Set();
    if (on && !p.scriptFilters.has(key)) { p.scriptFilters.add(key); p.tt.enable(f); }
    else if (!on && p.scriptFilters.has(key)) { p.scriptFilters.delete(key); p.tt.disable(f); }
    return true;
  },
  hasFilter(p, path) { return !!(p && p.tt && p.tt.has(String(path).replace(/^\/?Filters\//, ''))); },

  // ------------------------------------------------------------------ fog of war (SFOW: ShowFOW_Obj)
  // player p sees a circle of radius r around (x, z) for `seconds` (0 or less = until hideArea), or around the
  // entity `follow` for as long as it lives. Returns a handle for hideArea.
  revealArea(p, x, z, r, seconds = 0, follow = null) {
    const h = { player: p, x, z, r, until: seconds > 0 ? this.time + seconds : Infinity, follow: follow || null, alive: true };
    this.reveals.push(h);
    return h;
  },
  hideArea(h) { if (h) h.alive = false; },
  // the reveal circles a viewer set sees now: [[x, z, r], ...]; sees(player) -> bool
  revealsFor(sees) {
    const out = [];
    let dead = false;
    for (const h of this.reveals) {
      if (!h.alive || h.until <= this.time || (h.follow && !h.follow.alive)) { h.alive = false; dead = true; continue; }
      if (!sees(h.player)) continue;
      const f = h.follow;
      out.push(f ? [f.pos.x, f.pos.z, h.r] : [h.x, h.z, h.r]);
    }
    if (dead) this.reveals = this.reveals.filter((h) => h.alive);
    return out;
  },
};
