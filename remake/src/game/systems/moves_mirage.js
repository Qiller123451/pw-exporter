// The MIRAGE mod's special moves (its own heroes' moves, the moves its upgrades add to the four tribes) and what
// they need besides: timed unit filters, jetpack flight, Babbage's exo suit, the blinding storm, parasites.
//
// Reference: docs/spec/moves_mirage.md (from MIRAGE's Scripts/Server: Hero.usl, character.usl, Animal.usl,
// Vehicle.usl, mirage/Miracle.usl and Mirage.usl). The moves only exist in MIRAGE's tech tree, so with the official
// game's data none of this is ever used. Where MIRAGE's scripts have a bug the remake does what was meant; each of
// those is listed in docs/MIRAGE_BUGS.md (marked "fix:" below).
//
// Moves of MIRAGE that are not here on purpose:
//   Jumpjet_0, sand_trap_bfpw, bfpw_kick/quake/roar   only in MIRAGE's "BfPW" game mode, which the remake doesn't have
//   FeignDeath, tree_camouflage, Hu_Multi_Arrow         switched off by MIRAGE itself (no handler / never researchable)
//   RamAttack                                           no handler; the ram is a weapon swap of the "ram" research
import * as THREE from 'three';
import { MOVES, AUTO_ORDER, AUTO_INVENT, enemiesNear, play, bash, crowd, inFront, pct } from './moves.js';
import { active } from './effects.js';
import { DELAYED, PERIODIC } from '../delayed.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const F = {                                         // unit-local filters of the tech tree
  fright: 'Ninigi/Upgrades/xenage/frightening',      // attacks x1.5 slower
  valor: 'Ninigi/Upgrades/xenage/valor',             // attacks x0.9 (faster)
  stim: 'SEAS/Upgrades/seas_laboratory/marine_stimpack',
  jet: 'Hu/Upgrades/xenage/jet_flying',              // sky weapons, flying stand animation
  rounds: 'SEAS/Upgrades/xenage/explosives_rounds',
  pierce: 'Special/Upgrades/xenage/PiercingThrough', // the exo suit's guns: armour piercing 100
  sacrifice: 'Special/Upgrades/schliemann_s0/Sacrifice_Bonus',
};
// units of these owners count: the caster's own and its allies' / its enemies' (and neutral ones)
const friendsNear = (W, u, c, R, types) => {
  const out = [];
  W.uHash.query(c.x, c.z, R + 8, (v) => {
    if (!v.alive || v.inside || !v.owner || !u.owner || !u.owner.isFriend(v.owner)) return;
    if (types && !types.includes(v.cls)) return;
    if (Math.hypot(v.pos.x - c.x, v.pos.z - c.z) - v.radius <= R) out.push(v);
  });
  return out;
};
const hostile = (u, v) => !!v && v.alive && v !== u && (!v.owner || !u.owner || !u.owner.isFriend(v.owner));
const ownOrAllied = (u, v) => !!v && v.alive && !!v.owner && !!u.owner && u.owner.isFriend(v.owner);

export const MIRAGE_MOVES = {
  // ---------------------------------------------------------------- heroes
  // Miyagi (CSBaryonyx, Miracle.usl CPlunder): steals what the target's tech tree "UpdateLimits" allow, up to what
  // its owner has (FightingObj.StealResis). Enemy or neutral animals, buildings, characters, vehicles.
  plunder: { target: 'enemy', range: 5, run(W, u, t) {
    if (!hostile(u, t) || !['ANML', 'BLDG', 'CHTR', 'VHCL'].includes(t.cls) || !t.owner || !u.owner) return false;
    play(u, ['plunder', 'attack_front']);
    if (u.comp && u.comp.playCaptain) u.comp.playCaptain('victory_2');
    W.plunder(u, t);
    return true;
  } },
  // Larry (Hero.usl:491 CallTwins): Barry and Harry come for 60 s at his level and do what he does
  call_twins: { self: true, run(W, u) {
    play(u, ['follow_me', 'res_guarding']);
    for (const [cls, off] of [['Barry_s0', 4], ['Harry_s0', 6]]) {
      const a = u.heading + Math.random() * 3.14;
      const c = W.spawnUnit(cls, u.owner, u.pos.x + Math.cos(a) * off, u.pos.z + Math.sin(a) * off, u.level, u.heading, { temp: true });
      if (!c) continue;
      W.later(TWINS_TIME, 'vanish', { u: c });
      const t = u.task;
      if (t.type === 'build' && t.building) W.order([c], { type: 'build', target: t.building, auto: true });
      else if (t.type === 'gather' && t.node && t.node.alive) W.order([c], { type: 'gather', target: t.node, auto: true });
      else if (t.type === 'attack' && t.target && t.target.alive) W.order([c], { type: 'attack', target: t.target, auto: true });
    }
    return true;
  } },
  // Stina: hypnotises an enemy animal (the Base CMickDundeeMove: 20 s asleep). fix: MIRAGE's task casts Stina to an
  // animal and ends at once, so the move did nothing.
  MickDundee: { target: 'animal', range: 10, run(W, u, t) {
    if (t.cls !== 'ANML' || !hostile(u, t)) return false;
    play(u, ['sm_01', 'res_sm_jump']);
    W.later(2.6, 'hypnosis', { t });
    return true;
  } },
  // Tarna (Hero.usl:1053 -> CMirageReanim): brings back any player's spirit - an enemy's becomes hers. Prays for the
  // spirit's revival time (25 s; 80 % for her own player's spirits) + 1.5 s; the cooldown starts after the revival.
  reanimation: { target: 'spirit', anySpirit: true, range: 25, noCooldown: true, run(W, u, s) {
    if (!s || s.kind !== 'spirit' || !s.alive || s.busy || !u.owner) return false;
    if (u.owner.slotFree(s.level, W.pyramidFor(u.owner))) return false;
    const D = REANIM_TIME * (s.owner === u.owner ? 0.8 : 1.0) + 1.5;
    s.busy = true;
    u.owner.queuedAtLevel[s.level - 1]++; u.owner.queuedUnits++;
    W.cast(u, 'reanimate', D, { s }, ['praying_wall', 'heal_0']);
    return true;
  } },
  // Schliemann (Hero.usl:907 + KleemanDamageBoostStart :923): sacrifices one of his player's or an ally's units: its
  // hit points heal him, then x3 damage, +2000 hp and the zombie look for max(5, hp / 20) s
  schliemann_sacrifice: { target: 'own', range: 15, run(W, u, t) {
    if (t === u || !ownOrAllied(u, t) || t.kind !== 'unit') return false;
    play(u, 'aje_velo_strike_0');
    W.later(0.9, 'sacrificeBoost', { u, t });
    return true;
  } },
  // Babbage's exo suit (CSpecialMobileSuit). Minigun (CSpecialMinigun): 8 bursts into a 30° cone up to its attack
  // range; each hit 60 % of the victim's current hit points (300..3000) / 8, armour piercing 100 for 15 s.
  Babbage_ExoMinigun_0: { target: 'enemy', range: 30, rangeOf: (W, u) => W.attackRangeOf(u, u.cs()), run(W, u, t, pos) {
    if (t && !hostile(u, t)) return false;
    const c = t ? t.pos.clone() : pos.clone();
    W.timedFilter(u, F.pierce, 15);
    W.periodicEffect(u, 4, 0.5, 'exoMinigun', { c, n: 0 }, true);
    return true;
  } },
  // jump (CSpecialJumpjet): up to 300 m; the cooldown starts on landing
  Babbage_ExoJumpjet_0: { target: 'ground', range: 300, run(W, u, t, pos) { return W.jetJump(u, t ? t.pos : pos, 300, 'jumpjet'); } },
  seas_jumpjet: { target: 'ground', range: 300, run(W, u, t, pos) { return W.jetJump(u, t ? t.pos : pos, 300, 'jumpjet'); } },
  // ---------------------------------------------------------------- Hu
  // the mammoth's trumpet: the Base move (enemies within 30 m deal x0.8 damage for 15 s)
  mammoth_trumpet: { self: true, run(W, u) { return MOVES.Mammoth_Trumpet.run(W, u); } },
  // the boar's rage attack (MIRAGE Animal.usl:4480): 2+ enemies close by -> ShakeOff "rage": flat 10 in 8 m. The
  // official tech tree has a Wild_Boar_Rage move too, but no script for it (only the x1.5 damage of FightingObj.usl:
  // 5488, effects.js): with the official game's data nothing happens
  Wild_Boar_Rage: { auto: (W, u) => W.data.extra.mod === 'MIRAGE' && u.name === 'hu_wild_boar' && crowd(W, u, u.radius + 5, 2),
    run(W, u) { if (W.data.extra.mod !== 'MIRAGE') return false; bash(W, u, 'rage', u.radius + 8, 1.4, 0.1, [3, 6.9], 10, 10); return true; } },
  // jetpack warriors take off and land (Hu.usl:71 JetPackOn / :100 JetPackOff): 3.5 s up to 13 m, 3 s down
  jetfly_on: { self: true, noCooldown: true, run(W, u) { return W.setFlying(u, true); } },
  jetfly_off: { self: true, noCooldown: true, run(W, u) { return W.setFlying(u, false); } },
  // Tesla's level 4/5 lets the Norse infantry leap (the Base jetpack: up to 100 m)
  jetleap: { target: 'ground', range: 100, run(W, u, t, pos) { return !u.flying && W.jetJump(u, t ? t.pos : pos, 100, ['sm_jump_01', 'jump']); } },
  // the druid's meteor (CMeteor / CMeteorite): 7 s of prayer within 70 m, then a rock falls for 3 s and hits every
  // owner's objects within 30 m - 250, armour piercing 100, size class 10 throws. The cooldown starts with the fall.
  meteor: { target: 'ground', range: 70, noCooldown: true, run(W, u, t, pos) {
    const p = (t ? t.pos : pos).clone();
    W.cast(u, 'meteor', 7, { p }, ['NS2010_poor_beg', 'heal_0']);
    return true;
  } },
  // ---------------------------------------------------------------- Aje
  // the brachiosaurus charges (Animal.usl:2925 BrachioRageTo): every 3.5 s, 9 m area damage (its weapon, falling off
  // to a fifth) and characters within 7 m pushed aside, until it attacks (at most 60 s); the 30 s cooldown follows
  BrachioStampede: { noCooldown: true, chase: true,
    auto: (W, u, e) => u.name === 'aje_brachiosaurus' && !u.rageT && !!e && W.reach(u, e) >= 10 && W.reach(u, e) <= u.fow,
    run(W, u, e) { u.rageT = 60; W.periodicEffect(u, 60, 3.5, 'brachioRage', { e }, true); return true; } },
  // the shaman's blinding storm (CBlindingStorm / CSandStorm): a 20 m dust cloud for 15 s; inside it every owner's
  // units take no projectile, direct or tower damage and fight at melee range only
  blinding_storm: { target: 'ground', range: 21, run(W, u, t, pos) {
    play(u, ['thanking', 'heal_0']);
    W.spawnStorm((t ? t.pos : pos).clone());
    return true;
  } },
  // ---------------------------------------------------------------- Ninigi
  // the triceratops' frightening (CFrightening): enemies within 30 m attack x1.5 slower for 15 s
  frightening: { self: true, run(W, u) {
    play(u, 'sm_shake_off');
    for (const v of enemiesNear(W, u, u.pos, 30, { buildings: true })) W.timedFilter(v, F.fright, 15);
    return true;
  } },
  // the drums' song of valor (CSongOfValor): own and allied units within 30 m attack x0.9 faster for 10 s
  song_of_valor: { self: true, run(W, u) {
    play(u, 'menace');
    for (const v of friendsNear(W, u, u.pos, 30, ['ANML', 'CHTR', 'VHCL'])) W.timedFilter(v, F.valor, 10);
    return true;
  } },
  // the monk's peace gong (CPeaceGong): 3 s, then an own or allied unit or building can't be hurt, attacked or fight
  // for 10 s. fix: MIRAGE computes but doesn't check that the target is a friend.
  ceasefire: { target: 'own', range: 15, noCooldown: true, run(W, u, t) {
    if (!ownOrAllied(u, t)) return false;
    W.cast(u, 'ceasefire', 3, { t }, ['affirming_intense', 'heal_0']);
    return true;
  } },
  // the monk's curse (CDeplenish): enemy transporters within 30 m drop their passengers and can't load for 15 s
  // (not those on deep water)
  deplenish: { self: true, run(W, u) {
    play(u, ['heal_0']);
    for (const v of enemiesNear(W, u, u.pos, 30)) {
      if (!v.passengers && !W.capacity(v)) continue;
      if (W.deepWaterAt && W.deepWaterAt(v.pos.x, v.pos.z)) continue;
      if (v.passengers && v.passengers.length) W.unloadAll(v, false);
      v.st.t.cursed = W.time + 15;
    }
    W.sfx('FX_CUnboardCurse', u.pos);
    return true;
  } },
  // ---------------------------------------------------------------- SEAS
  // the cyborg rex roars (CCyborgRoar): own and allied units within 30 m (itself too) deal x1.5 damage for 15 s
  cyborg_roar: { self: true, run(W, u) { play(u, ['roaring', 'menace']); W.later(0.8, 'cyborgRoar', { u }); return true; } },
  // the rex's dynamite (ShakeOff "shake"): enemies within its radius + 20 m - characters thrown, 100 flat damage
  cyborg_tnt: { self: true, run(W, u) { bash(W, u, ['shake', 'sm_shake_off'], u.radius + 20, 0.1, 0.2, [3, 6.9], 100, 100); return true; } },
  triceratops_shake_off: { self: true, run(W, u) { bash(W, u, 'sm_shake_off', u.radius + 8, 0.4, 2.0, [3, 6.9], 50, 50); return true; } },
  // the triceratops' tusk (CTriceratopsHook): its enemy in front and in reach takes x3 damage, ignoring armour
  triceratops_tusk: { self: true, run(W, u) {
    const e = u.task.target || u.lastTarget;
    if (!e || !e.alive || !inFront(u, e) || W.rangeZone(u, e).zone === 0) return false;
    play(u, 'pawing');
    W.takeDmg(u, e, 3.0, 0, null, 100);
    if (e.cls === 'CHTR') W.knockback(e, u.pos, 10, 0.7);
    return true;
  } },
  // stimpack (CSEAS.Stimpack): -40 hit points, x0.75 attack time for 10 s (not the medic, not below 41 hp). The
  // carriers (CTransportObj.Stimpack) stim their ranged SEAS passengers. fix: the 5 s cooldown of the tech tree is
  // applied (MIRAGE never starts it).
  stimpack: { self: true, run(W, u) {
    if (u.cls !== 'CHTR') { let n = 0; for (const p of u.passengers || []) if (W.stim(p, true)) n++; return n > 0; }
    return W.stim(u);
  } },
  stimpack_rex: { self: true, run(W, u) { return MIRAGE_MOVES.stimpack.run(W, u); } },
  // the medic's blood infection (CHemoplague): an enemy character or animal can't be healed for 20 s, poison x2
  contamination: { target: 'enemy', range: 10, run(W, u, t) {
    if (!hostile(u, t) || (t.cls !== 'CHTR' && t.cls !== 'ANML')) return false;
    play(u, 'heal_0');
    t.st.t.noHeal = W.time + 20;
    return true;
  } },
  // the medic's deafening (DeafeningRoar): enemy units and buildings within 15 m take no orders for 15 s.
  // fix: queued with Shift it had radius 0.
  deafening: { self: true, run(W, u) {
    for (const v of enemiesNear(W, u, u.pos, 15, { buildings: true })) v.st.t.deaf = W.time + 15;
    return true;
  } },
  // the medic's parasite (CParasites / CParasite): her player sees what an enemy unit sees. fix: it lasts 480 s
  // (MIRAGE checks the wrong timer and it never ends).
  parasite: { target: 'enemy', range: 30, run(W, u, t) {
    if (!hostile(u, t) || !['ANML', 'CHTR', 'SHIP', 'VHCL'].includes(t.cls)) return false;
    play(u, ['tec_sm_cocktail', 'heal_0']);
    W.watchers.push({ player: u.owner, host: t, until: W.time + 480 });
    W.sfx('FX_CParasite', u.pos);
    return true;
  } },
  // the medic's walking bomb (CWalkingBomb / DarkRitual / MakeThemPay): one of her player's units explodes after
  // 10 s - its radius + 30 m, 45 % of its max hit points falling off to 25 %, every owner's objects, size 10 throws
  suicide: { target: 'own', range: 3, run(W, u, t) {
    if (!t || t === u || t.owner !== u.owner || t.kind !== 'unit') return false;
    play(u, ['tec_sm_cocktail', 'heal_0']);
    W.later(1.0, 'walkingBomb', { t });
    return true;
  } },
  // the exo suit's automatic moves (CExoBash / CExoKick; their inventions are made from the start)
  bash_exo: { auto: (W, u) => u.name === 'seas_mobile_suit' && crowd(W, u, u.radius + 5, 3),
    run(W, u) { const d = u.cs() ? u.cs().dmg : 0; bash(W, u, 'seas_mobile_suit_sm_0', u.radius + 5, 1.2, 0.1, [1, 3.9], 1.5 * d, 1.25 * d); return true; } },
  kick_down: { auto: (W, u, e) => u.name === 'seas_mobile_suit' && e && e.kind === 'unit' && inFront(u, e) && W.rangeZone(u, e).zone > 0,
    run(W, u, e) { play(u, 'seas_mobile_suit_fm_0'); W.takeDmg(u, e, 2.0, 0); if (e.cls === 'CHTR') W.knockback(e, u.pos, 10, 0.7); return true; } },
  // the exocutor's hand (CMKHand): enemy characters and animals within 10 m thrown (size class 10), no damage
  exocutor_hand: { self: true, run(W, u) {
    play(u, 'lumberjack_sm_0');
    for (const v of enemiesNear(W, u, u.pos, 10)) W.throwUnit(v, u.pos, 10);
    return true;
  } },
  // the minigun lumberjack's explosive rounds (ActivateExplosiveRounds): a switch. While on: better guns, no armour,
  // 15 damage to itself and 100..50 to enemies within 10 m every second. The cooldown starts when switched off.
  explosives_rounds: { self: true, noCooldown: true, run(W, u) { return W.explosiveRounds(u, !u.rounds); } },
  // any animal of the player: the clicked unit mounts it (FightingObj.MountThatUnit -> BoardTransport)
  MountThatUnit: { target: 'own', range: 1e9, noCooldown: true, run(W, u, t) {
    if (!t || t.kind !== 'unit' || t.owner !== u.owner || t === u || !W.canBoard(t, u)) return false;
    W.order([t], { type: 'board', target: u });
    return true;
  } },
};
const TWINS_TIME = 60;          // CTwins.STAYTIME
const REANIM_TIME = 25;         // a spirit's reanim_time (FightingObj.usl:12021)
Object.assign(MOVES, MIRAGE_MOVES);
AUTO_ORDER.push('Wild_Boar_Rage', 'BrachioStampede', 'bash_exo', 'kick_down');
Object.assign(AUTO_INVENT, { Wild_Boar_Rage: 'wild_boar_rage', BrachioStampede: 'brachiostampede', bash_exo: 'exo_bash', kick_down: 'exo_kick' });

// models these moves show (main.js loads them with the map)
export const MIRAGE_FX_MODELS = ['fx_dust_twister', 'rolling_stone', 'fire_molotov', 'hu_steam_jet_pack_off', 'fx_heal_passive'];

// what upgrades do besides switching filters (production.js completeUpgrade)
export const UPGRADE_HOOKS = {
  // Babbage's mechanization (Hero.usl:1169 HandleAction "special_mechanization"): he flies up and comes down as the exo suit
  special_mechanization: (W, e) => { if (e.kind === 'unit' && e.name === 'babbage_s0') W.mechanize(e); },
};

// ------------------------------------------------------------------------------------------------ world mixin
export const MirageMoves = {
  // a unit-local filter for `dur` seconds; casting it again restarts the time (SetFrighteningEffect & co.)
  timedFilter(e, path, dur) {
    if (!e.alive || !e.st || !this.data.base.filter(path)) return;
    const k = 'f:' + path;
    e.st.t[k] = this.time + dur;
    if (!(e.localTT && e.localTT.has(path))) this.localFilter(e, path, true);
    this.later(dur, 'filterEnd', { e, path });
  },
  sfx(name, pos) { this.emit('sfx', { name, pos: pos.clone() }); },
  // a cast that stands still for `sec` seconds (a new order breaks it): then CAST[kind](world, unit, args)
  cast(u, kind, sec, args, anims) {
    this.releaseTask(u);
    u.task = { type: 'cast', kind, until: this.time + sec, args };
    u.path = []; u.vel.set(0, 0, 0);
    const a = anims && u.anim.pick(...[].concat(anims));
    if (a) { u.busyAnim = true; u.anim.play(a, { fade: 0.2 }); }
  },
  // a new order or death broke the cast
  castCancel(u) {
    const t = u.task;
    u.busyAnim = false;
    if (t.kind === 'reanimate') { const { s } = t.args; u.owner.queuedAtLevel[s.level - 1]--; u.owner.queuedUnits--; s.busy = false; }
  },
  castUpdate(u) {
    const t = u.task;
    u.vel.set(0, 0, 0);
    if (this.time < t.until) return;
    u.busyAnim = false;
    u.task = { type: 'idle' };
    CAST[t.kind](this, u, t.args);
  },
  // a jetpack jump (Jetpack / CJumpjet / CSpecialJumpjet): the cooldown starts on landing
  jetJump(u, pos, max, anim) {
    if (!pos || u.flying) return false;
    this.jump(u, pos, max);
    if (anim) play(u, anim);
    return true;
  },
  // Miyagi's plunder (FightingObj.StealResis): the target's "UpdateLimits", at most what its owner has
  plunder(u, t) {
    const o = this.data.objectNode(t.name, t.owner), lim = o && o.UpdateLimits;
    if (!lim) return;
    const got = {};
    for (const r of ['food', 'wood', 'stone']) {
      const max = parseFloat(lim['max_' + r] && (lim['max_' + r]._value ?? lim['max_' + r])) || 0;
      const room = Math.max(0, (u.owner.caps[r] ?? 1e9) - u.owner.res[r]);
      const x = Math.floor(Math.max(0, Math.min(max, t.owner.res[r], room)));
      if (!x) continue;
      t.owner.res[r] -= x; u.owner.res[r] += x; got[r] = x;
    }
    const txt = Object.entries(got).map(([r, x]) => `${x} ${r}`).join(', ');
    if (!txt) return;
    this.emit('msg', { player: t.owner, text: `Resources stolen: ${txt}`, kind: 'bad' });
    this.emit('msg', { player: u.owner, text: `Plundered ${txt}` });
    this.emit('attacked', { entity: t, by: u });
  },
  // jetpack flight of the jetpack warrior (Hu.usl JetPackOn / JetPackOff)
  setFlying(u, on) {
    if (u.flyChange > this.time || !!u.flying === on || u.inside) return false;
    if (on) {
      this.releaseTask(u); u.task = { type: 'idle' }; u.path = [];
      this.localFilter(u, F.jet, true);
      u.flying = true;
      u.flyChange = this.time + 3.5;
      u.lift = { from: u.liftH || 0, to: FLY_HEIGHT, t: 0, T: 3.5 };
    } else {
      if (this.deepWaterAt && this.deepWaterAt(u.pos.x, u.pos.z)) return false;     // not over water (Hu.usl:180)
      this.releaseTask(u); u.task = { type: 'idle' }; u.path = [];
      u.flyChange = this.time + 3.0;
      u.lift = { from: u.liftH || 0, to: 0, t: 0, T: 3.0 };
      this.later(3.0, 'landed', { u });
    }
    play(u, ['sm_jump_01', 'jump']);
    return true;
  },
  // the minigun lumberjack's explosive rounds
  explosiveRounds(u, on) {
    if (on) {
      if ((u.cd.get('explosives_rounds') || 0) > this.time) return false;
      u.rounds = true;
      this.localFilter(u, F.rounds, true);
      this.periodicEffect(u, 1e9, 1, 'rounds', {});
      this.emit('fx', { entity: u, gfx: 'fire_molotov', until: 1e12, key: 'rounds', link: 'FIRE' });
    } else {
      u.rounds = false;
      this.localFilter(u, F.rounds, false);
      u.cd.set('explosives_rounds', this.time + 60);
      this.emit('fx', { entity: u, key: 'rounds', until: 0 });
    }
    return true;
  },
  stim(u, carried = false) {
    if (u.cls !== 'CHTR' || u.name === 'seas_medic' || active(u, 'stim', this.time) || u.hp <= 40) return false;
    if (carried && !((u.weapons.long && u.weapons.long.projectile) || u.name === 'seas_flamethrower')) return false;
    if (!/^seas_/.test(u.name) && this.data.info(u.name)?.tribe !== 'SEAS') return false;
    u.hp -= 40;
    u.st.t.stim = this.time + 10;
    this.timedFilter(u, F.stim, 10);
    return true;
  },
  // the blinding storm's cloud (CSandStorm): 20 m, 15 s
  spawnStorm(p) {
    const s = { pos: p, R: 20 };
    this.emit('fxAt', { pos: p.clone(), gfx: 'fx_dust_twister', until: this.time + 15, loop: true });
    this.periodicEffect(s, 15, 0.25, 'storm', { snd: 0 }, true);
  },
  // Babbage's mechanization: 12 s up into the sky, then the exo suit comes down where he was (Hero.usl:1169,
  // TransformationServo :1191; Mirage.usl CSpecialMobileSuit.Descent :1028)
  // deep water (terrain more than 5 m under the sea level): no landing, no curse, Babbage drowns
  deepWaterAt(x, z) { return this.waterLevel != null && this.height(x, z) + 5 < this.waterLevel; },
  // the exo suit is destroyed (CSpecialMobileSuit.Die / TIMER_BABBAGE): after its dying animation Babbage climbs out
  // with half his hit points and the minigun's cooldown - in deep water he drowns
  suitDestroyed(s) { if (s.driver && s.owner) this.later(2.5, 'driverOut', { s }); },
  mechanize(b) {
    if (b.suitT || !b.alive) return;
    this.releaseTask(b); b.task = { type: 'idle' }; b.path = [];
    b.suitT = this.time + 12;
    b.untargetable = true; b.unselectable = true;
    b.st.t.invul = this.time + 12;
    this.trap(b, 12, 'mechanize');
    b.lift = { from: 0, to: 150, t: 0, T: 12 };
    play(b, ['jetpack', 'sm_jump_01']);
    this.emit('removed', { entity: b });           // out of the selection and the groups
    this.later(12, 'suitDown', { b });
  },
};
const FLY_HEIGHT = 13;          // CHu FLYING_HEIGHT

// cast results (World.cast)
const CAST = {
  reanimate(W, u, { s }) {
    u.owner.queuedAtLevel[s.level - 1]--; u.owner.queuedUnits--;
    s.busy = false;
    if (!s.alive) return;
    s.alive = false;
    const r = W.spawnUnit(s.name, u.owner, s.pos.x, s.pos.z, s.level);
    if (r) W.emit('trained', { unit: r, producer: u });
    u.cd.set('reanimation', W.time + W.moveTime(u, 'reanimation'));
  },
  meteor(W, u, { p }) {
    u.cd.set('meteor', W.time + W.moveTime(u, 'meteor'));
    // the rock (CMeteorite): 3 s, then it falls from 65 m above the druid onto the point
    W.later(3, 'meteorFall', { p, from: u.pos.clone().setY(u.pos.y + 65), by: u.owner, u });
  },
  ceasefire(W, u, { t }) {
    u.cd.set('ceasefire', W.time + W.moveTime(u, 'ceasefire'));
    if (!t.alive) return;
    t.st.t.peace = W.time + 10;
    if (t.kind === 'unit' && t.task.type === 'attack') t.task = { type: 'idle' };
    W.emit('healfx', { to: t });
    W.sfx('FX_CPeace_Gong', u.pos);
  },
};

Object.assign(DELAYED, {
  filterEnd(W, { e, path }) { if (e.alive && (e.st.t['f:' + path] || 0) <= W.time + 1e-6 && e.localTT && e.localTT.has(path)) W.localFilter(e, path, false); },
  vanish(W, { u }) { if (u.alive) W.removeEntity(u); },
  sacrificeBoost(W, { u, t }) {
    if (!u.alive || !t.alive) return;
    const hp = t.hp;
    t.silentDeath = false;
    W.kill(t, null);
    u.hp = Math.min(u.maxHp, u.hp + hp);
    W.timedFilter(u, F.sacrifice, Math.max(5, hp / 20));
  },
  cyborgRoar(W, { u }) {
    if (!u.alive) return;
    for (const v of friendsNear(W, u, u.pos, 30, ['ANML', 'CHTR', 'VHCL'])) v.st.t.cyborg = W.time + 15;
  },
  walkingBomb(W, { t }) {
    if (!t.alive) return;
    t.st.t.bomb = W.time + 10;
    W.later(10, 'bombBlast', { t });
  },
  bombBlast(W, { t }) {
    if (!t.alive) return;
    const p = t.pos.clone();
    W.areaDamage(null, p, t.radius + 30, 0.45 * t.maxHp, 0.25 * t.maxHp, { direct: true, all: true, size: 10, owner: t.owner, skip: t });
    W.emit('blast', { pos: p, size: 'big' });
    t.silentDeath = true;
    W.removeEntity(t);
  },
  meteorFall(W, { p, from, u }) {
    W.emit('fxFly', { gfx: 'rolling_stone', from, to: p.clone(), T: 1.2 });
    W.later(1.2, 'meteorHit', { p, u });
  },
  meteorHit(W, { p, u }) {
    W.areaDamage(null, p, 30, 250, 250, { direct: true, all: true, ap: 100, size: 10, owner: u.owner });
    W.emit('blast', { pos: p, size: 'big' });
    W.sfx('FX_CMeteorite', p);
  },
  landed(W, { u }) {
    if (!u.alive) return;
    u.flying = false;
    W.localFilter(u, F.jet, false);
    const nav = W.navFor(u);
    if (!nav.isFree(u.pos.x, u.pos.z)) { const c = nav.nearestFree(nav.idx(u.pos.x, u.pos.z), 8); [u.pos.x, u.pos.z] = nav.center(c); }
    u.anchor.set(u.pos.x, u.pos.z);
  },
  driverOut(W, { s }) {
    if (W.deepWaterAt(s.pos.x, s.pos.z) || !s.owner) return;
    const b = W.spawnUnit(s.driver, s.owner, s.pos.x, s.pos.z, s.level, s.heading);
    if (!b) return;
    b.hp = b.maxHp / 2;
    const cd = s.cd.get('Babbage_ExoMinigun_0');
    if (cd) b.cd.set('Babbage_Minigun_0', cd);
    play(b, 'getting_up');
    W.emit('trained', { unit: b, producer: null });
  },
  // the exo suit lands where Babbage went up (it keeps his level, his kills and his minigun's cooldown)
  suitDown(W, { b }) {
    if (!b.alive) return;
    const p = b.owner;
    const cd = b.cd.get('Babbage_Minigun_0');
    b.silentDeath = true;
    W.removeEntity(b);
    const s = W.spawnUnit('special_mobile_suit', p, b.pos.x, b.pos.z, b.level, b.heading);
    if (!s) { W.spawnUnit('babbage_s0', p, b.pos.x, b.pos.z, b.level, b.heading); return; }
    s.driver = 'babbage_s0';
    if (cd) s.cd.set('Babbage_ExoMinigun_0', cd);
    s.liftH = 150; s.lift = { from: 150, to: 0, t: 0, T: 10 };
    s.st.t.invul = W.time + 10;
    W.trap(s, 10, 'descent');
    play(s, ['jumpjet']);
    W.emit('trained', { unit: s, producer: null });
  },
});

Object.assign(PERIODIC, {
  exoMinigun: { tick(W, { host: u, s }) {
    if (!u.alive) return false;
    play(u, ['attack_ranged', 'attack_front']);
    const R = W.attackRangeOf(u, u.cs()) + u.radius;
    const dir = Math.atan2(s.c.z - u.pos.z, s.c.x - u.pos.x);
    for (const v of enemiesNear(W, u, u.pos, R, { buildings: true })) {
      const a = Math.atan2(v.pos.z - u.pos.z, v.pos.x - u.pos.x) - dir;
      if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= Math.PI / 12) W.takeDirectDmg(v, pct(v, 0.6, 300, 3000) * 0.125, 100, u.owner, true, u);
    }
    return ++s.n < 8;
  } },
  brachioRage: {
    tick(W, { host: u, s }) {
      // it ends when the brachiosaurus attacks or has nobody to charge at (EndRageTo on AttackEnemy / OnActionEnd)
      const e = u.task.type === 'attack' ? u.task.target : null;
      if (!u.alive || !e || !e.alive || W.rangeZone(u, e).zone > 0) return false;
      const d = u.cs() ? u.cs().dmg : 0;
      W.areaDamage(u, u.pos, 9, d, d / 5, { direct: true, size: u.stats.size });
      for (const v of enemiesNear(W, u, u.pos, 7, { types: ['CHTR'] })) W.knockback(v, u.pos, 3, 0);
      return true;
    },
    end(W, { host: u }) { u.rageT = 0; u.cd.set('BrachioStampede', W.time + W.moveTime(u, 'BrachioStampede')); },
  },
  storm: { tick(W, { host: st, s }) {
    W.uHash.query(st.pos.x, st.pos.z, st.R + 8, (v) => {
      if (v.alive && !v.inside && Math.hypot(v.pos.x - st.pos.x, v.pos.z - st.pos.z) - v.radius < st.R) v.st.t.storm = W.time + 0.3;
    });
    if ((s.snd -= 0.25) <= 0) { s.snd = 6; W.sfx('FX_CBlinding_Storm', st.pos); }
    return true;
  } },
  rounds: { tick(W, { host: u }) {
    if (!u.alive || !u.rounds) return false;
    W.damage(u, 15, null);
    if (u.alive) W.areaDamage(u, u.pos, 10, 100, 50, { direct: true });
    return true;
  } },
});
