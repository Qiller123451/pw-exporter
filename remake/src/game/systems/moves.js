// Special moves (tech tree "Moves" actions): unit abilities such as Kick, Tornado, Shotgun, and the commands of
// buildings (open/close gates, buy resources, dismantle, self-destruct, burn).
//
// Reference: docs/spec/moves.md. A move's tech tree "duration" is its cooldown (not a cast time). Moves are offered
// where the action's "locations" list the unit class; they appear once the enabling upgrade made them visible.
//
// Adding a move: add an entry to MOVES keyed by the action id.
//   auto(W, u, enemy)      -> bool   automatic move: checked on every attack opportunity (replaces that hit)
//   self: true                       instant move without a target
//   target: 'unit' | 'enemy' | 'own' | 'building' | 'ground' | 'animal' | 'vehicle' | 'gate'
//   range: metres                    the unit walks this close to the target first
//   run(W, u, target, pos) -> bool   the effect; returning false means "not done" (no cooldown)
//   noCooldown: true                 (original quirks: stampede, lockpicking)
import * as THREE from 'three';
import { GATE } from './buildings.js';
import { active } from './effects.js';
import { DELAYED, PERIODIC } from '../delayed.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const enemiesNear = (W, u, c, R, opts = {}) => {
  const out = [];
  const test = (v) => {
    if (!v.alive || v.inside || !u.isEnemy(v)) return;
    if (opts.types && !opts.types.includes(v.cls)) return;
    const d = v.kind === 'building' ? v.surfDist(c.x, c.z) : Math.hypot(v.pos.x - c.x, v.pos.z - c.z) - v.radius;
    if (d <= R) out.push(v);
  };
  W.uHash.query(c.x, c.z, R + 8, test);
  if (opts.buildings) W.bHash.query(c.x, c.z, R + 20, test);
  return out;
};
export const play = (u, name, cb) => {
  const a = u.anim.pick(...[].concat(name));
  if (!a) { if (cb) cb(); return 0; }
  u.busyAnim = true;
  u.anim.play(a, { loop: false, restart: true, fade: 0.1, onDone: () => { u.busyAnim = false; if (cb) cb(); } });
  return u.anim.duration(a);
};
// CharacterBash / ShakeOff: knock back characters around, then flat area damage (the unit's own weapon damage)
// (dmg: a fixed damage instead of the unit's weapon damage - MIRAGE's ShakeOff calls pass one)
export function bash(W, u, anim, R, delay, spread = 0.1, force = [1, 3.9], dmg = null, endDmg = dmg) {
  play(u, anim);
  W.later(delay, 'bash', { u, R, spread, force, dmg, endDmg });
}
export const crowd = (W, u, R, n) => enemiesNear(W, u, u.pos, R).filter((v) => v.kind === 'unit').length >= n;
export const inFront = (u, e, ang = 0.39) => Math.abs(Math.atan2(Math.sin(Math.atan2(-(e.pos.x - u.pos.x), -(e.pos.z - u.pos.z)) - u.heading), Math.cos(Math.atan2(-(e.pos.x - u.pos.x), -(e.pos.z - u.pos.z)) - u.heading))) <= ang;
export const pct = (v, p, lo, hi) => clamp(v.hp * p, lo, hi);

export const MOVES = {
  // ---------------------------------------------------------------- Hu
  Kick: { auto: (W, u, e) => e && e.kind === 'unit' && inFront(u, e) && W.rangeZone(u, e).zone > 0,
    run(W, u, e) { play(u, 'res_sm_kick'); W.takeDmg(u, e, 2.0, 0.4); if (e.cls === 'CHTR') W.knockback(e, u.pos, 3, 0.7); return true; } },
  Roar: { auto: (W, u) => crowd(W, u, u.radius + 4, 3), run(W, u) { bash(W, u, 'res_sm_jump', u.radius + 4, 1.2); return true; } },
  Quake: { auto: (W, u) => crowd(W, u, u.radius + 5, 3), run(W, u) { bash(W, u, 'res_sm_jump', u.radius + 5, 1.2); return true; } },
  defensive_mode_on: { self: true, noCooldown: true, run(W, u) { W.localFilter(u, 'Hu/Upgrades/hu_warrior/hu_defensive_mode', true); u.defensive = true; return true; } },
  defensive_mode_off: { self: true, noCooldown: true, run(W, u) { W.localFilter(u, 'Hu/Upgrades/hu_warrior/hu_defensive_mode', false); u.defensive = false; return true; } },
  jetpack: { target: 'ground', range: 100, run(W, u, t, pos) { return W.jump(u, pos, 100); } },
  reveal: { self: true, run(W, u) { play(u, 'res_guarding'); W.reveal(u.owner, u.pos, 30, 5); return true; } },
  oracle: { target: 'ground', range: 1e9, run(W, u, t, pos) { const p = t ? t.pos : pos; W.reveal(u.owner, p, 20, 10, true); play(u, 'heal_0'); return true; } },
  insects: { target: 'building', range: 20, run(W, u, b) {
    const ok = ['hu_corn_field', 'hu_lumberjack_cottage', 'hu_fireplace', 'hu_warehouse', 'aje_bazaar', 'aje_slaughterhouse', 'aje_resource_collector', 'ninigi_fireplace', 'ninigi_hunting_lodge', 'ninigi_paddy'];
    if (!ok.includes(b.name) || !b.owner) return false;
    play(u, 'nat_throw');
    // every second the building's owner loses 20 food, for 180 s
    W.periodicEffect(b, 180, 1, 'insects');
    return true;
  } },
  illusion: { self: true, run(W, u) {
    play(u, 'heal_0');
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * 3.13;
      const c = W.spawnUnit(u.name, u.owner, u.pos.x + Math.cos(a) * 4, u.pos.z + Math.sin(a) * 4, u.level, u.heading, { illusion: true });
      if (c) W.later(60, 'expire', { u: c });
    }
    return true;
  } },
  Mammoth_Stampede: { noCooldown: true, chase: true, auto: (W, u, e) => !u.rageT && e && W.reach(u, e) >= 10 && W.reach(u, e) <= u.fow,
    run(W, u) {
      u.rageT = 30;
      W.periodicEffect(u, 30, 2, 'stampede');
      return true;
    } },
  Mammoth_Trumpet: { self: true, run(W, u) { play(u, 'trumpet'); for (const v of enemiesNear(W, u, u.pos, 30)) v.st.t.trumpet = W.time + 15; return true; } },
  titan_paw: { self: true, run(W, u) { play(u, 'pawing'); for (const v of enemiesNear(W, u, u.pos, 30)) v.st.t.paw = W.time + 15; return true; } },
  titan_shake_off: { self: true, run(W, u) { bash(W, u, 'titan_rage', u.radius + 5, 0.1, 1.8, [3, 6.9]); return true; } },
  rhino_shake_off: { self: true, run(W, u) { bash(W, u, 'sm_shake_off', u.radius + 5, 0.4, 2.0, [3, 6.9]); return true; } },
  // ---------------------------------------------------------------- Aje
  // Resurrect (Resurrect.usl): walk to a spirit, pray, and the unit comes back at its level if the pyramid has room
  Resurrect: { target: 'spirit', range: 20, run(W, u, s) {
    if (!s || s.kind !== 'spirit' || !s.alive || s.owner !== u.owner || s.busy) return false;
    if (u.owner.slotFree(s.level, W.pyramidFor(u.owner))) return false;
    s.busy = true;
    u.owner.queuedAtLevel[s.level - 1]++; u.owner.queuedUnits++;
    u.busyAnim = true; u.anim.play(u.anim.pick('praying_wall', 'heal_0') || u.idleAnim);
    // pray 6.5 s (praying_wall), then 1.5 s wait, then the unit returns
    W.trap(u, 8, 'resurrect');
    W.later(8, 'resurrect', { u, s });
    return true;
  } },
  Twister: { auto: (W, u) => crowd(W, u, u.radius + 4, 3), run(W, u) { bash(W, u, 'nat_sm_twister', u.radius + 4, 0.6, 0.2); return true; } },
  Matrix: { auto: (W, u) => crowd(W, u, u.radius + 6, 3), run(W, u) { bash(W, u, 'nat_sm_matrix', u.radius + 6, 1.0, 0.6); return true; } },
  termites: { target: 'building', range: 20, run(W, u, b) {
    if (!b.owner || b.owner === u.owner) return false;
    play(u, 'termites');
    W.periodicEffect(b, 120, 1, 'termites', { by: u.owner });
    return true;
  } },
  camouflage: { self: true, noCooldown: true, run(W, u) {
    if (u.st.camo.has('aje')) { W.setCamo(u, 'aje', false); return true; }
    if ((u.cd.get('camouflage') || 0) > W.time) return false;
    W.setCamo(u, 'aje', true);
    return true;
  } },
  quicksand: { target: 'ground', range: 30, run(W, u, t, pos) { play(u, 'heal_0'); W.spawnQuicksand(u.owner, t ? t.pos : pos); return true; } },
  tornado: { target: 'ground', range: 30, run(W, u, t, pos) {
    const p = (t ? t.pos : pos).clone();
    play(u, 'tornado');
    const victims = enemiesNear(W, u, p, 10, { buildings: true });
    for (const v of victims) if (v.kind === 'unit') W.trap(v, 11, 'tornado');
    W.periodicEffect(u, 11, 1, 'tornado', { victims, p, n: 0 }, true);
    return true;
  } },
  AlloScrunch: { self: true, run(W, u) {
    const e = u.task.target || u.lastTarget;
    if (!e || !e.alive || !inFront(u, e) || W.rangeZone(u, e).zone === 0) return false;
    play(u, 'sm_scrunch'); W.takeDmg(u, e, 2.0, 0.4); if (e.cls === 'CHTR') W.knockback(e, u.pos, 3, 0.7); return true;
  } },
  BrachioStomp: { self: true, run(W, u) {
    play(u, 'stomp_harvest');
    W.later(1.8, 'stomp', { u });
    return true;
  } },
  StegoBash: { auto: (W, u) => crowd(W, u, u.radius + 5, 4), run(W, u) { bash(W, u, 'sm_attack_back', u.radius + 5, 1.4, 0.1, [3, 6.9]); return true; } },
  trex_scrunch: { self: true, run(W, u) { bash(W, u, 'trex_fm_2', u.radius + 5, 2.0, 0.2, [3, 6.9]); return true; } },
  trex_roar: { self: true, run(W, u) { play(u, 'menace'); W.later(0.8, 'roar', { u }); return true; } },
  // ---------------------------------------------------------------- Ninigi
  entrench: { self: true, noCooldown: true, run(W, u) { return u.st.camo.has('entr') ? W.digOut(u) : W.digIn(u); } },
  lockpicking: { target: 'gate', range: 4, noCooldown: true, run(W, u, g) {
    if (!g.def.gate || g.gateState === GATE.OPEN || !g.owner || !u.owner.isEnemy(g.owner)) return false;
    W.setCamo(u, 'disg', false);
    u.busyAnim = true; u.anim.play(u.anim.pick('potter') || u.idleAnim);
    W.trap(u, 15, 'lockpicking');
    W.later(15, 'lockpick', { u, g });
    return true;
  } },
  fireworks: { self: true, run(W, u) { play(u, 'potter_ground'); W.reveal(u.owner, u.pos, 100, 10, true); for (let i = 0; i < 6; i++) W.later(i * 0.4, 'firework', { u, i }); return true; } },
  burst_arrow: { auto: (W, u, e) => e && enemiesNear(W, u, e.pos, e.radius + 5).length >= 3,
    run(W, u, e) { play(u, 'tec_sm_burst_arrow'); W.later(0.4, 'burstArrow', { u, e, w: u.weapons.long }); return true; } },
  multishot: { auto: (W, u, e) => !!e, run(W, u, e) { play(u, 'tec_sm_multishot'); W.later(0.4, 'multishot', { u, e }); return true; } },
  doping: { self: true, run(W, u) { u.st.t.doping = W.time + 7; return true; } },
  barrage: { self: true, run(W, u) { bash(W, u, 'idle_1', u.radius + 25, 1.0, 2.0); return true; } },
  enchain: { target: 'enemy', range: 30, run(W, u, v) { if (v.kind !== 'unit') return false; W.trap(v, 20, 'enchain'); return true; } },
  lacerate: { self: true, run(W, u) {
    const e = u.task.target || u.lastTarget;
    if (!e || !e.alive) return false;
    play(u, 'harvest');
    W.later(0.6, 'lacerate', { u, e });
    return true;
  } },
  // ---------------------------------------------------------------- heroes (level 3+)
  Shotgun: { target: 'enemy', range: 15, run(W, u, t, pos) {
    const c = t ? t.pos : pos;
    play(u, 'shotgun');
    const hits = t ? [t, ...enemiesNear(W, u, c, 8, { buildings: true }).filter((v) => v !== t)] : enemiesNear(W, u, c, 8, { buildings: true });
    for (const v of hits) { W.takeDirectDmg(v, pct(v, v.kind === 'building' ? 0.1 : 0.5, 200, 2000), 0, u.owner, true, u); if (v.cls === 'CHTR') W.knockback(v, u.pos, 6 + Math.random() * 3, 0.3); }
    if (t && t.alive && t.kind === 'unit') W.engage(t, u, { defend: true });
    return true;
  } },
  Snipershot: { target: 'enemy', range: 50, run(W, u, t) { play(u, 'throwdownshot'); W.later(0.6, 'snipershot', { u, t }); return true; } },
  Tesla_DstrVhcl_0: { target: 'vehicle', range: 2, run(W, u, t) { if (t.cls !== 'VHCL') return false; play(u, 'potter'); W.takeDirectDmg(t, 999999.9, 0, u.owner, false, u); return true; } },
  Druid_HealAnml_0: { self: true, run(W, u) { play(u, 'heal_0'); W.uHash.query(u.pos.x, u.pos.z, 46, (a) => { if (a.alive && a.owner === u.owner && a.cls === 'ANML' && u.distTo(a) <= 40) a.hp = a.maxHp; }); return true; } },
  Babbage_Minigun_0: { target: 'enemy', range: 30, run(W, u, t, pos) {
    const c = t ? t.pos.clone() : pos.clone();
    play(u, 'babbage_minigun');
    W.periodicEffect(u, 4, 0.5, 'minigun', { c, n: 0 }, true);
    return true;
  } },
  Mayor_Specialmove_0: { self: true, run(W, u) { play(u, 'res_sm_jump'); for (const v of enemiesNear(W, u, u.pos, 6)) { W.takeDirectDmg(v, pct(v, 0.25, 300, 2000), 0, u.owner, false, u); if (v.cls === 'CHTR') W.knockback(v, u.pos, 1 + Math.random() * 3.9, 0.1 + Math.random() * 1.5); } return true; } },
  warden_spec: { self: true, run(W, u) { play(u, 'warden_spec'); W.uHash.query(u.pos.x, u.pos.z, 26, (o) => { if (o.alive && o.owner && u.owner.isFriend(o.owner) && u.distTo(o) <= 20) o.st.t.anmlImmune = W.time + 7; }); return true; } },
  Ada_DeathShoot: { target: 'enemy', range: 40, run(W, u, t) { play(u, 'lovelace_musket'); W.later(0.8, 'deathShot', { u, t }); return true; } },
  schliemann_deathshoot: { target: 'enemy', range: 40, run(W, u, t) { return MOVES.Ada_DeathShoot.run(W, u, t); } },
  schliemann_special_move_1: { target: 'own', range: 15, run(W, u, t) {
    if (t === u || t.owner !== u.owner || t.kind !== 'unit') return false;
    play(u, 'aje_velo_strike_0');
    W.later(0.9, 'sacrifice', { u, t });
    return true;
  } },
  livingstone_special_move_1: { self: true, run(W, u) { const T = (W.data.extra.hero_consts || {}).LIVINGSTONE_VANISH_TIME || 10; W.setCamo(u, 'hero', true); u.st.t.vanish = W.time + T; W.later(T, 'unvanish', { u }); return true; } },
  Hypnosis: { target: 'animal', range: 10, run(W, u, t) { if (t.cls !== 'ANML') return false; play(u, 'sm_01'); W.later(2.6, 'hypnosis', { t }); return true; } },
};
// order in which automatic moves are tried (character.usl:200, Animal.usl:64)
export const AUTO_ORDER = ['Matrix', 'Quake', 'Roar', 'Twister', 'Kick', 'burst_arrow', 'multishot', 'Mammoth_Stampede', 'StegoBash'];
// automatic moves have no button (tech tree visibility 0); the server checks the invention of the same name instead
export const AUTO_INVENT = { Kick: 'kick', Roar: 'roar', Quake: 'quake', Twister: 'twister', Matrix: 'matrix', burst_arrow: 'burst_arrow',
  multishot: 'multishot', Mammoth_Stampede: 'mammoth_stampede', StegoBash: 'stegosaurus_caudal_bash' };

// ------------------------------------------------------------------------------------------------ world mixin
export const Moves = {
  // moves a unit or building offers (visible ones only)
  movesOf(e) {
    if (!e.owner) return [];
    return this.data.actionsOf(e.rulesOwner(), e).filter((a) => a.kind === 'Moves');
  },
  // why a move can't be used now (null = ok)
  moveCheck(e, a) {
    if (e.illusion) return 'illusion';
    const why = this.data.check(e.rulesOwner(), a, e);
    if (why) return why;
    const M = MOVES[a.id];
    if (M && !M.noCooldown && (e.cd.get(a.id) || 0) > this.time) return 'cooldown';
    return null;
  },
  // a move's cooldown (its tech tree duration) for this unit
  moveTime(e, id) { const a = this.movesOf(e).find((x) => x.id === id); return a ? a.time : 0; },
  cooldownLeft(e, a) { return Math.max(0, (e.cd.get(a.id) || 0) - this.time); },
  // use a move: instant ones happen now, targeted ones start a task that walks into range first
  useMove(e, a, target, pos) {
    if (a.kind !== 'Moves') return 'req';
    const generic = this.genericMove(e, a, target, pos);
    if (generic !== undefined) return generic;
    const M = MOVES[a.id];
    if (!M) return 'req';
    const why = this.moveCheck(e, a);
    if (why) return why;
    if (M.self) {
      const ok = M.run(this, e, null, null);
      if (ok === false) return 'target';
      if (!M.noCooldown) e.cd.set(a.id, this.time + a.time);
      if (a.id !== 'camouflage' && e.st.camo.has('aje')) this.setCamo(e, 'aje', false);
      return null;
    }
    if (M.target === 'spirit') {
      // (Tarna's reanimation takes any player's spirit: GetBestSpiritToResurrect(pos, 60) - the nearest one)
      target = !pos ? null : M.anySpirit ? this.nearestSpirit(null, pos.x, pos.z, 60) : this.nearestSpirit(e.owner, pos.x, pos.z);
      if (!target) return 'target';
    }
    if (!target && !pos) return 'target';
    if (target && M.target === 'ground') pos = target.pos.clone();
    this.releaseTask(e);
    e.task = { type: 'special', move: M, action: a, target, pos: pos ? pos.clone() : null, user: true, prev: e.task };
    e.path = [];
    return null;
  },
  specialUpdate(u, dt) {
    const t = u.task, M = t.move;
    const tgt = t.target;
    if (tgt && !tgt.alive) { u.task = { type: 'idle' }; return; }
    const p = tgt ? tgt.pos : t.pos;
    const d = tgt && tgt.kind !== 'spirit' ? this.reach(u, tgt) : Math.hypot(p.x - u.pos.x, p.z - u.pos.z);
    const range = M.rangeOf ? M.rangeOf(this, u) : M.range;
    if (d > range + (tgt ? 0 : 0.5) && M.target !== 'ground' || (M.target === 'ground' && d > range)) {
      if (!u.path.length || (t.repathT = (t.repathT || 0) - dt) <= 0) { u.setPath(p.x, p.z); t.repathT = 1; if (!u.path.length) { u.task = { type: 'idle' }; return; } }
      const sp = u.steer(dt, u.runSpeed, 0.5);
      u.moveAnim(sp, true);
      return;
    }
    u.path = []; u.vel.set(0, 0, 0);
    if (u.face(p.x, p.z, dt, 8) > 0.3 && M.target !== 'ground') return;
    const ok = M.run(this, u, tgt, t.pos);
    if (ok !== false && !M.noCooldown) u.cd.set(t.action.id, this.time + t.action.time);
    if (u.task === t) u.task = { type: 'idle' };          // (a move may start a task of its own: World.cast)
    if (u.st.camo.has('aje')) this.setCamo(u, 'aje', false);
  },
  // CheckSpecialMoves: the first automatic move whose condition holds replaces this hit
  // (chasing: the unit is following its enemy - only moves marked `chase` then)
  autoMove(u, enemy, chasing = false) {
    if (!u.owner || u.illusion || u.inside) return false;
    const avail = u.autoMovesCache;
    if (!avail || avail.v !== (u.rulesOwner().tt || {}).version) {
      const list = this.movesOf(u).filter((a) => MOVES[a.id] && MOVES[a.id].auto);
      u.autoMovesCache = { v: (u.rulesOwner().tt || {}).version, list: AUTO_ORDER.map((id) => list.find((a) => a.id === id)).filter(Boolean) };
    }
    for (const a of u.autoMovesCache.list) {
      const inv = AUTO_INVENT[a.id];
      if (inv && !this.data.invented(u.rulesOwner(), inv, a.tribe === 'Special' ? u.owner.tribe : a.tribe, u)) continue;
      if (!inv && this.moveCheck(u, a)) continue;
      if ((u.cd.get(a.id) || 0) > this.time) continue;
      const M = MOVES[a.id];
      if (chasing && !M.chase) continue;
      if (!M.auto(this, u, enemy)) continue;
      if (M.run(this, u, enemy) === false) continue;
      if (!M.noCooldown) u.cd.set(a.id, this.time + a.time);
      return true;
    }
    return false;
  },
  // commands that aren't special moves: gates, markets, dismantling, self-destruction, fire
  genericMove(e, a, target, pos) {
    switch (a.id) {
      case 'Open': return e.def.gate ? (this.setGate(e, GATE.OPEN), null) : 'req';
      case 'Close': return e.def.gate ? (e.brokenT > 0 ? 'busy' : (this.setGate(e, GATE.CLOSED), null)) : 'req';
      case 'Auto': return e.def.gate ? (this.setGate(e, GATE.AUTO), null) : 'req';
      case 'buy_food': case 'buy_wood': case 'buy_stone': {
        const why = this.data.check(e.rulesOwner(), a, e);
        return why || this.buyResource(e.owner, a.id.slice(4));
      }
      case 'BuildDown': return e.kind === 'building' ? this.startBuildDown(e, a) : 'req';
      case 'Kill': if (e.kind === 'building') { this.selfDestruct(e); return null; } this.kill(e, null); return null;
      case 'Burn': return e.kind === 'building' ? (this.burnResin(e) ? null : 'cooldown') : 'req';
      case 'Attack': case 'Walk': case 'Stop': case 'AggressiveTarget': case 'AggroState_0': case 'AggroState_1': case 'AggroState_2':
      case 'Formation_1': case 'Formation_2': case 'Formation_3': return null;
    }
    return undefined;
  },
  // ------------------------------------------------------------------ helpers used by moves
  // a repeating effect: fn() every `every` s for `dur` s (stops early when fn returns false)
  // (kind: an entry of PERIODIC; s: its state)
  periodicEffect(host, dur, every, kind, s = {}, now = false) {
    if (!PERIODIC[kind]) throw new Error('unknown periodic effect ' + kind);
    this.effects.push({ host, end: this.time + dur, every, next: this.time + (now ? 0 : every), kind, s });
  },
  effectsUpdate() {
    if (!this.effects.length) return;
    const keep = [];
    for (const f of this.effects) {
      let alive = true;
      const K = PERIODIC[f.kind];
      while (alive && f.next <= this.time && f.next <= f.end) { f.next += f.every; alive = K.tick(this, f) !== false; }
      if (alive && this.time < f.end) keep.push(f); else if (K.end) K.end(this, f);
    }
    this.effects = keep;
  },
  // reveal camouflaged enemies and traps around a point (reveal / oracle / fireworks)
  reveal(p, c, R, dur, fow) {
    const test = (v) => {
      if (!v.alive || !v.st || !v.owner || p.isFriend(v.owner)) return;
      if (Math.hypot(v.pos.x - c.x, v.pos.z - c.z) > R + (v.radius || 0)) return;
      v.st.revealT = this.time + dur;
      if (v.st.camo.has('trap')) v.st.camo.delete('trap');
      if (v.st.camo.has('entr') || v.st.camo.has('disg')) { v.st.camo.delete('disg'); }
    };
    this.uHash.query(c.x, c.z, R + 8, test);
    this.bHash.query(c.x, c.z, R + 20, test);
    if (fow) this.emit('revealarea', { player: p, x: c.x, z: c.z, r: R, until: this.time + dur });
  },
  setCamo(u, layer, on) {
    if (!u.st) return;
    if (on) u.st.camo.add(layer); else u.st.camo.delete(layer);
    if (layer === 'aje') {
      if (u.setCamoLook) u.setCamoLook(on);
      if (!on) u.cd.set('camouflage', this.time + 15);    // the cooldown starts when the camouflage ends
    }
    if (on) for (const o of this.units) if (o.alive && o.task.type === 'attack' && o.task.target === u && !o.task.user) o.task = { type: 'idle' };
  },
  // Entrench.usl: dig in (3 s), hidden and frozen; digs out on a new command or when hit (3 s), then 30 s cooldown
  digIn(u) {
    if ((u.cd.get('entrench') || 0) > this.time || u.st.camo.has('entr')) return false;
    this.releaseTask(u); u.task = { type: 'entrench' }; u.path = [];
    play(u, 'digandhide');
    this.trap(u, 3, 'dig');
    this.later(3, 'dugIn', { u });
    return true;
  },
  digOut(u) {
    if (!u.st.camo.has('entr')) return false;
    this.setCamo(u, 'entr', false);
    u.cd.set('entrench', this.time + 30);
    play(u, 'hideandstand');
    this.trap(u, 3, 'dig');
    if (u.task.type === 'entrench') u.task = { type: 'idle' };
    return true;
  },
  // jetpack jump to a point up to `max` metres away
  jump(u, pos, max) {
    let tx = pos.x, tz = pos.z;
    const d = Math.hypot(tx - u.pos.x, tz - u.pos.z);
    if (d > max) { tx = u.pos.x + (tx - u.pos.x) * max / d; tz = u.pos.z + (tz - u.pos.z) * max / d; }
    if (!this.nav.isFree(tx, tz)) { const c = this.nav.nearestFree(this.nav.idx(tx, tz), 6); [tx, tz] = this.nav.center(c); }
    play(u, ['sm_jump_01', 'jump']);
    u.jumpFx = { from: u.pos.clone(), to: new THREE.Vector3(tx, this.height(tx, tz), tz), t: 0, T: Math.max(0.8, Math.min(2, Math.hypot(tx - u.pos.x, tz - u.pos.z) / 40)) };
    this.trap(u, u.jumpFx.T, 'jump');
    return true;
  },
  // (CBrachioHarvest, ANMLSpec.usl:480-545: every tree falls away from the brachio)
  fellTreesAround(c, R) {
    this.rHash.query(c.x, c.z, R + 4, (n) => {
      if (!n.alive || n.type !== 'tree' || Math.hypot(n.pos.x - c.x, n.pos.z - c.z) > R) return;
      const a = Math.atan2(n.pos.z - c.z, n.pos.x - c.x);
      this.fellTree(n, ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8);
    });
  },
  // Aje quicksand: 30 s, radius 8, holds every enemy unit that walks in for 5 s
  spawnQuicksand(owner, p) {
    const q = { owner, pos: p.clone(), held: new Map() };
    if (this.fx) this.fx.dust(p.clone(), 8);
    this.periodicEffect(q, 30, 0.25, 'quicksand', {}, true);
  },
  activeState(e, k) { return active(e, k, this.time); },
};

// the delayed parts of the moves (World.later)
Object.assign(DELAYED, {
  bash(W, { u, R, spread, force, dmg, endDmg }) {
    if (!u.alive) return;
    for (const v of enemiesNear(W, u, u.pos, R, { types: ['CHTR'] })) W.knockback(v, u.pos, force[0] + Math.random() * force[1], Math.random() * spread);
    const d = dmg ?? (u.cs() ? u.cs().dmg : 0);
    W.areaDamage(u, u.pos, R, d, endDmg ?? d, { direct: true });
  },
  expire(W, { u }) { if (u.alive) W.kill(u, null); },                   // illusions, tracker dinos
  resurrect(W, { u, s }) {
    u.busyAnim = false;
    u.owner.queuedAtLevel[s.level - 1]--; u.owner.queuedUnits--;
    s.alive = false;
    if (!u.alive) return;
    const r = W.spawnUnit(s.name, s.owner, s.pos.x, s.pos.z, s.level);
    if (r) W.emit('trained', { unit: r, producer: u });
  },
  stomp(W, { u }) {
    if (!u.alive) return;
    W.fellTreesAround(u.pos, 15);
    // the original's damage grows with distance: 0 at the centre, 100 at 20 m (kept as in the game)
    for (const v of enemiesNear(W, u, u.pos, 20)) { const d = Math.hypot(v.pos.x - u.pos.x, v.pos.z - u.pos.z); W.takeDirectDmg(v, 100 * d / 20, 0, u.owner, false); if ((v.stats.size || 0) <= 7) W.knockback(v, u.pos, 3, 0); }
  },
  roar(W, { u }) { for (const v of enemiesNear(W, u, u.pos, u.radius + 10)) W.trap(v, 7, 'roar'); },
  lockpick(W, { u, g }) { u.busyAnim = false; if (u.alive && g.alive) W.openViolently(g); },
  firework(W, { u, i }) { if (W.fx) W.fx.spawn('glow', u.pos.clone().setY(u.pos.y + 20 + Math.random() * 20), { size: 6, size1: 16, life: 1.2, color: [0xff5030, 0x40ff60, 0x4080ff][i % 3] }); },
  burstArrow(W, { u, e, w }) {
    if (!u.alive || !e.alive) return;
    const cs = u.cs(w);
    W.areaDamage(u, e.pos, 5 + e.radius, cs.dmg, cs.endDmg || 0, { size: w.size });    // CBurstArrow: CAreaDamage(fighter) - its damage down to its enddamage at the edge
    W.emit('impact', { pos: e.pos.clone(), weapon: w, splash: true });
  },
  multishot(W, { u, e }) { if (u.alive && e.alive) { W.penetrate(u, e, u.cs(), 10); W.fire(u, u.weapons.long, e); } },
  lacerate(W, { u, e }) {
    if (!u.alive) return;
    const dir = Math.atan2(e.pos.z - u.pos.z, e.pos.x - u.pos.x);
    for (const v of enemiesNear(W, u, u.pos, u.radius + 4, { buildings: true })) { const a = Math.atan2(v.pos.z - u.pos.z, v.pos.x - u.pos.x) - dir; if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= Math.PI / 3) W.takeDirectDmg(v, 200, 0, u.owner, false); }
  },
  snipershot(W, { u, t }) { if (t.alive) W.takeDirectDmg(t, pct(t, 0.5, 500, 2000), 0, u.owner, true, u); },
  deathShot(W, { u, t }) { if (t.alive) W.takeDirectDmg(t, pct(t, 0.9, 1500, 5500), u.cs() ? u.cs().ap : 0, u.owner, true, u); },
  sacrifice(W, { u, t }) {
    if (!u.alive || !t.alive) return;
    u.hp = Math.min(u.maxHp, u.hp + t.hp);
    W.kill(t, null);
    W.localFilter(u, 'Special/Upgrades/schliemann_s0/Sacrifice_Bonus', true);
    W.later(10, 'localFilterOff', { u, path: 'Special/Upgrades/schliemann_s0/Sacrifice_Bonus' });
  },
  localFilterOff(W, { u, path }) { W.localFilter(u, path, false); },
  unvanish(W, { u }) { W.setCamo(u, 'hero', false); },
  hypnosis(W, { t }) { if (t.alive) { W.trap(t, 20, 'hypnosis'); const r = t.anim.pick('rest'); if (r) t.anim.play(r); } },
  dugIn(W, { u }) { if (u.alive && u.task.type === 'entrench') W.setCamo(u, 'entr', true); },
});
// the repeating effects of the moves (World.periodicEffect): f = {host, end, every, next, kind, s}
Object.assign(PERIODIC, {
  // every second the building's owner loses 20 food, for 180 s
  insects: { tick(W, { host: b }) { if (b.owner) b.owner.res.food = Math.max(0, b.owner.res.food - 20); return b.alive && b.owner.res.food > 0; } },
  // Animal.usl RageTo (every 2 s for 30 s): area damage 7 m around the mammoth, and the characters within 7 m thrown
  // 10 m to the side they are on (SetHitReactionTimer: unless something else already throws them); the stampede ends
  // with the mammoth's first real attack (AttackEnemy -> EndRageTo)
  stampede: {
    tick(W, { host: u }) {
      if (!u.alive || u.rageHit) { u.rageHit = false; return false; }
      const d = u.cs() ? u.cs().dmg : 0;
      W.areaDamage(u, u.pos, 7, d, 10, { direct: true, size: u.stats.size });
      const hx = -Math.sin(u.heading), hz = -Math.cos(u.heading);
      for (const v of enemiesNear(W, u, u.pos, 7)) {
        if (v.cls !== 'CHTR' || v.knock || !v.alive || v.inside) continue;
        const side = Math.sign(hx * (v.pos.z - u.pos.z) - hz * (v.pos.x - u.pos.x)) || 1;
        W.later(0, 'knock', { V: v, vx: -hz * side * 10 / 0.4, vz: hx * side * 10 / 0.4 });
      }
      return true;
    },
    end(W, { host: u }) { u.rageT = 0; },
  },
  termites: { tick(W, { host: b, s }) { if (!b.alive) return false; W.takeDirectDmg(b, 25, 0, s.by, false); return true; } },
  tornado: { tick(W, { host: u, s }) {
    for (const v of s.victims) if (v.alive) W.takeDirectDmg(v, v.kind === 'unit' ? clamp(v.hp * 0.05, 30, 200) : clamp(v.hp * 0.025, 30, 200), 0, u.owner, false);
    if (W.fx) W.fx.dust(s.p.clone(), 6);
    return ++s.n < 11;
  } },
  minigun: { tick(W, { host: u, s }) {
    const c = s.c, dir = Math.atan2(c.z - u.pos.z, c.x - u.pos.x);
    for (const v of enemiesNear(W, u, u.pos, 35, { buildings: true })) { const a = Math.atan2(v.pos.z - u.pos.z, v.pos.x - u.pos.x) - dir; if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= Math.PI / 12) W.takeDirectDmg(v, pct(v, 0.3, 150, 2000) * 0.125, 0, u.owner, true, u); }
    return ++s.n < 8 && u.alive;
  } },
  // Aje quicksand: holds every enemy unit that walks in for 5 s (host: {owner, pos, held: Map unit -> time})
  quicksand: { tick(W, { host: q }) {
    const p = q.pos;
    W.uHash.query(p.x, p.z, 12, (v) => {
      if (!v.alive || v.inside || !v.owner || !q.owner.isEnemy(v.owner) || q.held.has(v)) return;
      if (Math.hypot(v.pos.x - p.x, v.pos.z - p.z) > 8) return;
      q.held.set(v, W.time); W.trap(v, 5, 'quicksand');
    });
    return true;
  } },
});
