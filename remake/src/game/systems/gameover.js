// The end of a skirmish game (Server/misc/GameOverMgr.usl; DominationFlag.usl; docs/spec/ui_groups7_9.md §9):
// only on multiplayer maps (Base/MapType "multiplayer": every skirmish map), not in campaign missions.
//
//   * A player is out when it has no unit that counts in the unit limit and no building that produces units
//     (GOM:330-351) - or when its main building (hu_fireplace, ninigi_fireplace, aje_resource_collector,
//     seas_headquarters) is gone and the head quarter timer (5 min) runs out before a new one is finished (GOM:353-410;
//     not on maps with Base/LastManStanding = 1).
//   * The warp gate (systems/buildings.js): its countdown makes its owner and the owner's friends win.
//   * Domination: the flags (DOFL) go to who stands alone at them - a flag area of 20 m, every 2 s; a flag lowers and
//     rises in 10 s (DominationUpDownTimer) when it changes hands (DominationFlag.usl Tick / ChangeDominationOwner).
//     All flags of one team start the domination timer (10 min); flags of several teams pause it, none kill it; at 0
//     that team wins (GOM:676-805). Units in a flag area are unveiled. In the other game types the flags are removed.
//   * Defender: the player on head quarter 1 defends (team 1 against team 2) until the setup's minutes are over; when
//     all its defender objects are destroyed it loses and the others win (GOM:807-879).
//   * Who is out loses: its units that count in the limit and its producing buildings die (OnPlayerLose); the last
//     player - or the last team - standing wins (GOM:575-611; needs two players / teams at the start).
//   Timers (W.goTimers) are shown by the HUD as the original's ObjTime icons (hud_timers: "timer_<icon>").
import { AnimCtl } from '../anim.js';

const HQ = /^(hu_fireplace|ninigi_fireplace|aje_resource_collector|seas_headquarters)$/;
const HQ_MIN = 5, DOM_MIN = 10, FLAG_R = 20, FLAG_UPDOWN = 10;

export const GameOver = {
  gameOverInit(S, opts = {}) {
    if (!this.rules.multiplayer) return;
    const mode = this.rules.mode || 'deathmatch';
    const G = this.go = { on: true, mode, lms: !!(S.mp && S.mp.lastManStanding), state: new Map(), hq: new Map(), flags: [], dom: null, def: null, t: 0, flagT: 0 };
    for (const p of this.players) if (this.goUnits(p) > 0 || this.goProducer(p)) G.state.set(p, 'alive');
    G.started = [...G.state.keys()];
    G.teams = new Set(G.started.map((p) => p.team));
    if (mode === 'domination') for (const f of S.flags || []) this.addFlag(f);
    if (mode === 'defender') {
      const d = this.players.find((p) => p.hq === 0) || null;
      G.def = d ? { player: d, left: Math.max(1, opts.defenderMin || this.rules.defenderMin || 45) * 60 } : null;
    }
  },
  goUnits(p) { let n = 0; for (const u of this.units) if (u.alive && u.owner === p && u.countsInPop) n++; return n; },
  // a building that produces units (CPlayer.CanProduceUnit)
  goProducer(p) {
    for (const b of this.buildings) {
      if (!b.alive || b.owner !== p || !b.built) continue;
      if (b._producer === undefined) b._producer = this.data.actionsOf(p, b).some((a) => a.kind === 'Build' && a.cat !== 'Build/BLDG' && a.results && a.results[0]);
      if (b._producer) return true;
    }
    return false;
  },
  gameOverUpdate(dt) {
    const G = this.go;
    if (!G || !G.on) return;
    // timers
    for (const [p, h] of G.hq) { h.left -= dt; if (h.left <= 0) { G.hq.delete(p); if (G.state.get(p) === 'alive') G.state.set(p, 'killed'); } }
    if (G.dom && !G.dom.paused) { G.dom.left -= dt; if (G.dom.left <= 0) this.dominationWon(); }
    if (G.def && G.def.left > 0) { G.def.left -= dt; if (G.def.left <= 0) for (const [p, s] of G.state) if (s === 'alive') G.state.set(p, p === G.def.player ? 'win' : 'killed'); }
    if ((G.flagT -= dt) <= 0 && G.flags.length) { G.flagT = 2; for (const f of G.flags) this.flagTick(f); this.checkDomination(); }
    for (const f of G.flags) this.flagUpdate(f, dt);
    if ((G.t -= dt) > 0) return;
    G.t = 1;
    for (const [p, s] of G.state) {
      if (s !== 'alive') continue;
      // the head quarter (GOM:353-410): none of its class left -> the timer; a finished one again -> no timer
      if (!G.lms) {
        let any = false, done = false;
        for (const b of this.buildings) if (b.alive && b.owner === p && HQ.test(b.name)) { any = true; if (b.built) done = true; }
        for (const u of this.units) if (u.alive && u.owner === p && HQ.test(u.name)) { any = true; done = true; }
        if (any) p.hadHQ = true;
        if (!any && !G.hq.has(p) && p.hadHQ) G.hq.set(p, { left: HQ_MIN * 60 });
        if (done) G.hq.delete(p);
      }
      if (this.goUnits(p) === 0 && !this.goProducer(p)) G.state.set(p, 'killed');
    }
    // defender objects (CheckDefenderObjs)
    if (G.def && !this.buildings.some((b) => b.alive && b.name === 'defender_object')) {
      if (G.def.objects !== false) for (const [p, s] of G.state) if (s === 'alive') G.state.set(p, p === G.def.player ? 'killed' : 'win');
    } else if (G.def) G.def.objects = true;
    // a warp gate's countdown (systems/buildings.js W.victory) decided
    for (const p of this.players) { if (p.won && G.state.get(p) === 'alive') G.state.set(p, 'win'); if (p.defeated && G.state.get(p) === 'alive') G.state.set(p, 'killed'); }
    this.goResolve();
  },
  goResolve() {
    const G = this.go, alive = [];
    for (const [p, s] of G.state) {
      if (s === 'killed') { this.playerLost(p); G.state.set(p, 'out'); }
      else if (s === 'win') { this.playerWon(p); G.state.set(p, 'out'); }
      else if (s === 'alive') alive.push(p);
    }
    if (!G.on) return;
    if (alive.length === 1 && G.started.length > 1) { this.playerWon(alive[0]); return; }
    const teams = new Set(alive.map((p) => p.team));
    if (alive.length && teams.size === 1 && G.teams.size > 1) for (const p of alive) this.playerWon(p);
  },
  // OnPlayerWin: the game is decided (m_bEnabled = false)
  playerWon(p) {
    p.won = true;
    const G = this.go;
    G.on = false;
    for (const [q, s] of G.state) if (s === 'alive' && !p.isFriend(q) && q.team !== p.team) { q.defeated = true; G.state.set(q, 'out'); }
    this.emit('gameOver', { player: p, won: true });
  },
  // OnPlayerLose: its units that count in the limit and its producing buildings die; everybody is told
  playerLost(p) {
    p.defeated = true;
    this.go.hq.delete(p);
    for (const o of this.players) this.emit('msg', { player: o, key: '_NT_DiplPlayerKilled', text: '%1 has been defeated', arg: p.name, kind: 'bad' });
    for (const u of this.units) if (u.alive && u.owner === p && u.countsInPop) { u.invulnT = 0; this.kill(u, null); }
    for (const b of this.buildings) if (b.alive && b.owner === p && b.built && this.goProducer(p) && b._producer) this.kill(b, null);
    this.emit('gameOver', { player: p, won: false });
  },

  // ------------------------------------------------------------------ domination flags (DominationFlag.usl)
  addFlag(f) {
    const flag = { name: f.name, x: f.x, z: f.z, rot: f.rot || 0, model: f.model || 'domination_flag', owner: null, stack: [], dir: 'down', end: this.time, timer: null };
    this.flagLook(flag);
    this.go.flags.push(flag);
    return flag;
  },
  // the flag's model (not saved: made again after a saved game is loaded, game/save.js)
  flagLook(flag) {
    const tpl = this.template(flag.model, true);
    const obj = tpl ? this.cloneModel(tpl) : null;
    if (obj) { obj.position.set(flag.x, this.height(flag.x, flag.z), flag.z); obj.rotation.y = flag.rot; this.scene.add(obj); }
    const anim = obj && tpl.clips && tpl.clips.length ? new AnimCtl(obj, tpl.clips) : null;
    Object.defineProperty(flag, 'look', { value: { obj, anim }, enumerable: false, configurable: true, writable: true });
    if (anim) anim.play(flag.dir, { loop: false, restart: true, ts: 100 });
  },
  // who stands in the flag's area: units counting in the unit limit (not OTHR) -> {owners, teams, most}
  flagContent(f) {
    const n = new Map();
    this.uHash.query(f.x, f.z, FLAG_R + 4, (u) => {
      if (!u.alive || u.inside || !u.owner || !u.countsInPop || Math.hypot(u.pos.x - f.x, u.pos.z - f.z) > FLAG_R) return;
      n.set(u.owner, (n.get(u.owner) || 0) + 1);
      if (u.st && u.st.camo && u.st.camo.size) u.st.revealT = this.time + 2.5;               // (FindTraces: Reveal)
    });
    let most = null, m = 0;
    for (const [p, c] of n) if (c > m) { m = c; most = p; }
    return { owners: [...n.keys()], teams: new Set([...n.keys()].map((p) => p.team)), most };
  },
  flagTick(f) {
    const c = this.flagContent(f);
    // the owner who led the change left early: down again (DominationFlag.Tick)
    if (f.timer && f.stack.length && f.stack[0] && !c.owners.includes(f.stack[0])) { f.stack = [null]; this.flagStack(f); return; }
    if (!c.owners.length) return;
    if (!f.owner) {
      if (c.owners.length === 1) this.flagChange(f, c.owners[0]);
      else if (c.teams.size === 1) this.flagChange(f, c.most);
      return;
    }
    if (c.owners.includes(f.owner) || c.teams.has(f.owner.team)) return;
    if (c.teams.size === 1) this.flagChange(f, c.most);
  },
  flagChange(f, p) {
    const s = f.stack;
    if (!s.length && f.owner === p) return;
    if (s.length === 1 && s[0] === p) return;
    if (s.length === 2 && p && s[0] === null && s[1] === p) return;
    f.stack = [null];
    if (p) f.stack.push(p);
    this.flagStack(f);
  },
  // the flag goes down (to nobody) or up (to the next owner) over up to 10 s, by how far it is (CheckOwnerStack)
  flagStack(f) {
    if (!f.stack.length) { f.timer = null; return; }
    const now = this.time;
    let w = 0;
    if (now > f.end) w = f.dir === 'up' ? 1 : 0;
    else { w = Math.max(0, Math.min(1, (f.end - now) / FLAG_UPDOWN)); if (f.dir === 'up') w = 1 - w; }
    const next = f.stack[0], dur = next === null ? FLAG_UPDOWN * w : FLAG_UPDOWN * (1 - w);
    f.dir = next === null ? 'down' : 'up';
    f.end = now + dur;
    f.timer = now + dur;
    const a = f.look && f.look.anim;
    if (a && a.has(f.dir)) a.play(f.dir, { loop: false, restart: true, ts: (a.duration(f.dir) || 1) / Math.max(0.2, dur || 0.2) });
  },
  flagUpdate(f, dt) {
    if (f.look && f.look.anim) f.look.anim.update(dt);
    if (f.timer == null || this.time < f.timer) return;
    f.timer = null;
    const next = f.stack.shift();
    const last = f.owner;
    if (next !== undefined && next !== last) { f.owner = next; this.flagFeedback(f, last, next); this.checkDomination(); }
    if (f.stack.length) this.flagStack(f);
  },
  // the news of a flag (DominationFlag.DoFeedback)
  flagFeedback(f, last, now) {
    const lt = last ? last.team : null, nt = now ? now.team : null;
    this.emit('flag', { flag: f, owner: now, x: f.x, z: f.z });
    if (lt === nt) return;
    const all = this.go.flags.every((g) => g.owner && g.owner.team === nt);
    for (const p of this.players) {
      if (nt != null && p.team === nt) this.emit('msg', { player: p, key: all ? '_NT_Flag_WeAll' : '_NT_Flag_Captured', text: all ? 'We hold all flags!' : 'Flag captured', kind: 'good', x: f.x, z: f.z });
      else {
        if (lt != null && p.team === lt) this.emit('msg', { player: p, key: '_NT_Flag_Lost', text: 'Flag lost', kind: 'bad', x: f.x, z: f.z });
        if (all) this.emit('msg', { player: p, key: '_NT_Flag_EnemyAll', text: 'The enemy holds all flags!', kind: 'bad' });
        else if (nt != null) this.emit('msg', { player: p, key: '_NT_Flag_Enemy', text: 'The enemy captured a flag', kind: 'bad', x: f.x, z: f.z });
      }
    }
  },
  // CheckDominationPoints: all flags of one team -> its timer runs; several teams -> paused; none -> gone
  checkDomination() {
    const G = this.go, owners = G.flags.map((f) => f.owner);
    const teams = new Set(owners.filter(Boolean).map((p) => p.team));
    const one = owners.length && owners.every(Boolean) && teams.size === 1;
    if (one) {
      const cnt = new Map();
      for (const p of owners) cnt.set(p, (cnt.get(p) || 0) + 1);
      const most = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const team = most.team;
      if (G.dom && G.dom.team === team) { G.dom.paused = false; G.dom.owner = most; }
      else G.dom = { team, owner: most, left: DOM_MIN * 60, paused: false };
    } else if (!teams.size) G.dom = null;
    else if (G.dom) { if (!teams.has(G.dom.team)) G.dom = null; else G.dom.paused = true; }
  },
  dominationWon() {
    const G = this.go, team = G.dom.team;
    G.dom = null;
    for (const [p, s] of G.state) if (s === 'alive') G.state.set(p, p.team === team ? 'win' : 'killed');
    this.goResolve();
  },
  // the timers the HUD shows (ObjTime: icon, owner, seconds left, paused)
  goTimers() {
    const G = this.go, out = [];
    if (!G) return out;
    for (const [p, h] of G.hq) out.push({ icon: 'headquater', owner: p, left: h.left, tip: '_Timer_TT_HeadQuater' });
    for (const b of this.buildings) if (b.alive && b.warpT != null && !b.warpDone) out.push({ icon: 'warpgate', owner: b.owner, left: b.warpT, tip: '_Timer_TT_WarpGate' });
    if (G.dom) out.push({ icon: 'domination', owner: G.dom.owner, left: G.dom.left, paused: G.dom.paused, tip: '_Timer_TT_Domination' });
    if (G.def && G.def.left > 0) out.push({ icon: 'defender', owner: G.def.player, left: G.def.left, tip: '_Timer_TT_Defender' });
    return out;
  },
};
