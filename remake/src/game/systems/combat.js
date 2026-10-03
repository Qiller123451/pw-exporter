// Combat: target choice, weapon ranges, the attack loop, the original damage formula, projectiles, splash,
// penetration, poison, knockback, towers and bunkers, death and skulls.
//
// Reference: docs/spec/combat.md (FightingObj.usl TakeDmg / ProvideDmg / Damage, Fight.usl, WeaponMgr.usl, Product.usl).
// All functions are World methods (installed by world.js); `u` = attacker, `v` = victim.
//
// Damage in one line (TakeDmg):
//   raw = factor * attackBoni(dmg) * (1 + AttackBonus[victim type]/100)
//   dmg = raw * (1 - clamp(protection% / 100, 0, 0.99))        protection = armour - armour piercing (+ buffs)
//   hit points lost = max(ceil(dmg), 1)
import * as THREE from 'three';
import { Projectile, headingTo, wrap } from '../entities.js';
import { attackBoni, tempDef, tempRangedDef, rangeBonus, active } from './effects.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// knockback by size-class difference 3..9 (FO:4383): chance and throw distance
const KNOCK_CHANCE = [0, 0, 0, 0.02, 0.04, 0.06, 0.08, 0.10, 0.20, 0.30];
const KNOCK_DIST = [0, 0, 0, 1, 1.5, 2, 2.5, 3, 4, 5];
const SPLASH_DIST = [0, 0, 0, 2, 3.5, 4, 5.5, 6, 7, 8];
const POISON_TICK = 3.0;
// target type rank (SortEnemyList): normal attackers prefer units, siege units prefer towers and buildings
const isTower = (e) => e.kind === 'building' && !!(e.weapons && e.weapons.long && e.weapons.long.projectile);
// only wall pieces (CWall) are "walls" here: towers, gates and traps count as normal buildings (FO:752-772, FO:4819)
const isWall = (e) => e.kind === 'building' && e.def.wallKind === 'wall';
function typeRank(u, e) {
  const r = e.kind === 'unit' ? 0 : isTower(e) ? 1 : isWall(e) ? 3 : 2;
  if (!u.def || u.def.attackType !== 1) return r;
  return r === 0 ? 3 : r - 1;
}

// SNFA (ActionFactory.usl:5520-5592): player.animalsNeutral bit 1 = wild animals do not pick this player's objects
// (Animal.usl:361), bit 2 = the player's units do not attack wild animals on their own. Whoever was attacked fights back.
const wildTruce = (u, e) => {
  if (u.owner && !e.owner) return !!(u.owner.animalsNeutral & 2) && !(u.attackers && u.attackers.has(e));
  if (!u.owner && e.owner) return !!(e.owner.animalsNeutral & 1) && !(u.attackers && u.attackers.has(e));
  return false;
};
export const Combat = {
  // ------------------------------------------------------------------ ranges (FightingObj.IsInCombatRange / GetAttackRange)
  // distance from u's centre to v's surface
  reach(u, v) {
    if (v.kind === 'building' && v.surfDist) return Math.max(0, v.surfDist(u.pos.x, u.pos.z));
    return Math.max(0, Math.hypot(v.pos.x - u.pos.x, v.pos.z - u.pos.z) - (v.radius || 0));
  },
  // attack range of a weapon: range + 2 (characters) / own radius (others); projectile weapons add nothing
  attackRangeOf(u, cs) {
    if (!cs) return 0;
    const proj = !!cs.w.projectile;
    const r = proj ? 0 : u.cls === 'CHTR' ? 2 : u.radius;
    return cs.range + r + rangeBonus(u);
  },
  // AlarmRange = clamp(AttackRange + 8, 32, FOW)
  alarmRange(u) {
    const cs = u.cs(u.weapons.long);
    return clamp(this.attackRangeOf(u, cs) + 8, 32, Math.max(32, u.fow || 32));
  },
  leash(u) { const cs = u.cs(u.weapons.long); return 2 * this.alarmRange(u) + this.attackRangeOf(u, cs); },
  // which weapon zone the victim is in: 0 = out of range, 1 = short, 2 = medium, 3 = primary
  rangeZone(u, v) {
    const W = u.weapons;
    const pcs = u.cs(W.long);
    if (!pcs) return { zone: 0 };
    const d = this.reach(u, v);
    const proj = !!pcs.w.projectile, inner = u.radius * 0.5;
    const rt = u.cls === 'CHTR' ? 1.5 : u.radius;
    const secS = W.short ? W.short.range + rt + u.radius + 2 : -1e9;
    let secM = W.medium ? W.medium.range + rt + u.radius + 2 : -1e9;
    let atk = this.attackRangeOf(u, pcs);
    if (proj) atk += inner;
    else if (pcs.w.penetration && pcs.range > 5) atk += inner;
    else { atk += u.radius + 2; if (atk > 0 && atk < 4) atk = 4; }
    const minR = pcs.minRange > 0 ? pcs.minRange + u.radius : 0;
    if (minR > 0) secM = minR;
    if (d <= secS) return { zone: 1, w: W.short, d };
    if (d <= secM) return minR > 0 && !W.medium ? { zone: 2, min: true, w: W.short, d } : { zone: 2, w: W.medium || W.short, d };
    if (d <= atk) return { zone: 3, w: W.long, d };
    return { zone: 0, w: W.long, d };
  },
  // FollowEnemy: stop at this surface distance when chasing
  approachDist(u, w) {
    const cs = u.cs(w);
    if (!cs) return 1;
    if (!cs.w.projectile) return cs.w.range < 1 ? u.radius * 0.6 : cs.range;
    return Math.max(1, this.attackRangeOf(u, cs) - 2);
  },
  // seconds between attacks (Duration, x1.2 in Lovelace's aura)
  // a computer player's units strike a little faster at difficulty 8 / 9 (FightingObj.GetAICheatModifier)
  attackDuration(u, cs) { return (cs ? cs.dur : 2) * (u.st && u.st.aura.slowhand ? 1.2 : 1) * (u.owner && u.owner.aiMods ? u.owner.aiMods.weaponTime || 1 : 1); },

  // ------------------------------------------------------------------ targets
  canTarget(u, e) {
    if (!e || !e.alive || e === u || e.inside) return false;
    if (e.kind !== 'unit' && e.kind !== 'building') return false;
    if (!u.isEnemy(e)) return false;
    if (e.untargetable) return false;
    if (u.owner && this.hiddenFrom(e, u.owner)) return false;
    if (this.waterLevel != null && !this.navalCanTarget(u, e)) return false;   // water / land reach (naval.md §6)
    return true;
  },
  // ExamineEnemies / SortEnemyList: best enemy within r of u (units first, then towers, buildings, walls)
  findTarget(u, r, opts = {}) {
    let best = null, bv = 1e18;
    const cur = u.task && u.task.target;
    const leash = opts.leash ? this.leash(u) : 0;
    const test = (e) => {
      if (!this.canTarget(u, e)) return;
      if (opts.filter && !opts.filter(e)) return;
      // wild animals: only aggressive ones or those that attacked us
      if (!e.owner && e.def && e.def.aggressive !== 1 && !(u.attackers && u.attackers.has(e)) && !opts.animals) return;
      if (wildTruce(u, e)) return;                 // missions: a player the wildlife leaves alone / who leaves it alone (SNFA)
      if (e.isNest && e !== cur) return;           // a nest of a campaign map (campaign/setup.js) is only attacked on an order
      if (isWall(e) && e !== cur && !opts.walls) return;
      // the human player's units don't see through the fog of war
      if (u.owner && u.owner.id === 0 && this.fow && e.kind === 'unit' && !this.fow.visible(e.pos.x, e.pos.z)) return;
      const d = this.reach(u, e);
      if (d > r) return;
      if (leash && u.anchor && Math.hypot(e.pos.x - u.anchor.x, e.pos.z - u.anchor.y) > leash) return;
      const v = typeRank(u, e) * 10000 + (e === cur ? 0 : 500) + d;
      if (v < bv) { bv = v; best = e; }
    };
    this.uHash.query(u.pos.x, u.pos.z, r + 6, test);
    if (!best || best.kind !== 'unit' || (u.def && u.def.attackType === 1)) this.bHash.query(u.pos.x, u.pos.z, r + 20, test);
    return best;
  },
  // kept for older callers
  nearestEnemy(u, r, filter) { return this.findTarget(u, r, { filter }); },
  validTarget(u, t, task) {
    if (!t || !t.alive || t.inside) return false;
    if (!u.isEnemy(t) && !(task && task.forceAttack)) return false;
    if (u.owner && this.hiddenFrom(t, u.owner) && !(task && task.user)) return false;
    if (t.kind === 'unit' && u.owner && u.owner.id === 0 && t.owner !== u.owner && this.fow && !this.fow.visible(t.pos.x, t.pos.z) && !(task && task.user)) return false;
    return true;
  },
  // start fighting (Fight(): automatic fights never replace an order of the player)
  engage(u, target, opts = {}) {
    if (!u.alive || u.inside || !target) return false;
    if (u.task.user && !opts.user && u.task.type !== 'idle' && u.task.type !== 'hold') return false;
    if ((u.stance === 3 || u.stance === -1) && !opts.user) return false;
    if (!u.weapons.long) return false;
    if (u.cannotFight && !u.isWorker && !opts.user) return false;     // transports, hovercraft, carts ... don't pick fights
    if (u.isWorker && !opts.user && !opts.defend && u.task.type !== 'idle') { u.prevTask = u.task; }
    this.releaseTask(u);
    u.task = { type: 'attack', target, user: !!opts.user, auto: !opts.user, hold: !!opts.hold, amove: opts.amove || null };
    u.repathT = 0;
    if (!opts.user) this.shout(u, target, false, true);
    return true;
  },
  // SetAggressionState of the campaign action AIAM and of the computer player (FightingObj.usl:1058, 7094, 8696):
  // 0 stand ground, 1 defensive (follows an enemy inside a 20 m circle around its post, then returns), 2 aggressive,
  // -1 passive (never fights). Berserkers ignore it and state 3 (never fights on its own: poisoner) is frozen.
  setAggro(units, state) {
    for (const u of units) {
      if (!u || !u.alive || u.kind !== 'unit' || u.stance === 3 || /berserker/.test(u.name)) continue;
      u.stance = state;
      u.guard20 = state === 1;
      if (u.anchor && (u.task.type === 'idle' || u.task.type === 'hold')) u.anchor.set(u.pos.x, u.pos.z);
    }
  },
  // ShoutForHelp (FO:6641): own fighters within 1.1 x AlarmRange join (7 s throttle, 3 s when hurt)
  shout(u, enemy, defend, forced) {
    if (!u.owner || !enemy || !enemy.alive) return;
    const t = this.time;
    if (!forced && t - (u.shoutT || -99) < (u.hp < u.maxHp ? 3 : 7)) return;
    if (u.task && u.task.user && u.task.type === 'attack' && !defend) return;
    u.shoutT = t;
    const R = u.kind === 'unit' ? 1.1 * this.alarmRange(u) : 40;
    this.uHash.query(u.pos.x, u.pos.z, R + 4, (o) => {
      if (o === u || !o.alive || o.owner !== u.owner || o.inside || !o.weapons.long) return;
      if (o.isWorker || o.task.user && o.task.type !== 'idle' && o.task.type !== 'hold') return;
      if (o.stance === 3 || o.task.type === 'attack' || o.task.type === 'heal') return;
      if (!defend && o.stance === 1) return;
      if (Math.hypot(o.pos.x - u.pos.x, o.pos.z - u.pos.z) > R) return;
      if (o.stats.heal && this.healScan(o)) return;
      this.later(0.1, () => { if (o.alive && (o.task.type === 'idle' || o.task.type === 'hold' || o.task.type === 'roam')) this.engage(o, enemy, { defend, hold: o.stance === 0 }); });
    });
  },

  // ------------------------------------------------------------------ the attack task (Fight.usl)
  attackUpdate(u, dt) {
    const t = u.task;
    const tgt = t.target;
    if (!this.validTarget(u, tgt, t)) return this.endAttack(u);
    if (active(u, 'trapped', this.time)) { u.vel.set(0, 0, 0); return; }
    // wild animals give up when the target leaves their territory
    if (u.wild && Math.hypot(u.pos.x - u.home.x, u.pos.z - u.home.y) > 70) { u.task = { type: 'roam', back: true }; u.setPath(u.home.x, u.home.y); return; }
    let z = this.rangeZone(u, tgt);
    // too close for a weapon with a minimum range and no short weapon: look for another target
    if (z.min && !u.weapons.short) {
      const other = this.findTarget(u, u.fow, { filter: (e) => this.rangeZone(u, e).zone === 3 });
      if (other && other !== tgt) { t.target = other; return; }
      if (!t.user) return this.endAttack(u);
    }
    // out of range: chase (FollowEnemy). The unit walks up to the weapon's approach distance and then fights as long
    // as the victim stays inside the (larger) combat range - so it doesn't step after every small move of the victim.
    if (z.zone === 0 || z.min) { if (!t.chasing) { t.chaseT = 0; t.bestD = undefined; t.noProg = 0; } t.chasing = true; }
    const approach = this.approachDist(u, z.w || u.weapons.long);
    if (t.chasing) {
      t.chaseT = (t.chaseT || 0) + dt;
      // stop chasing when close enough, when stuck, or when a moving victim is inside the combat range (hit it now)
      const fleeing = tgt.vel && tgt.vel.lengthSq() > 0.25;
      // no progress inside the attack range: the attacker is pressed against the victim (big bodies can't get as
      // close as the approach distance - units push each other apart), so it fights from here
      if (z.zone > 0 && t.bestD !== undefined && z.d > t.bestD - 0.05) t.noProg = (t.noProg || 0) + dt; else t.noProg = 0;
      t.bestD = Math.min(t.bestD ?? Infinity, z.d);
      const pressed = t.noProg > 0.4;
      if (z.zone > 0 && !z.min && (z.d <= approach + 0.3 || fleeing || pressed || t.chaseT > 1.5 && u.vel.lengthSq() < 0.05)) { t.chasing = false; t.bestD = undefined; t.noProg = 0; }
    }
    if (t.chasing) {
      // turrets that can't move (water turret ...): an ordered target is kept until it comes into range
      if (u.stationary) { if (!t.user) return this.endAttack(u); u.vel.set(0, 0, 0); return; }
      if (t.hold || (u.stance === 0 && !t.user && !t.amove)) return this.endAttack(u);
      if (!u.canWalk) return this.endAttack(u);
      if (!t.user && !t.amove && u.anchor && !u.wild) {
        const L = this.leash(u);
        if (Math.hypot(tgt.pos.x - u.anchor.x, tgt.pos.z - u.anchor.y) > L) return this.endAttack(u, true);
      }
      u.repathT = (u.repathT || 0) - dt;
      if (u.repathT <= 0 || !u.path.length) {
        const d = z.d;
        if (d < 30 && this.nav.los(u.pos.x, u.pos.z, tgt.pos.x, tgt.pos.z)) { u.path = [[tgt.pos.x, tgt.pos.z]]; u.goal = [tgt.pos.x, tgt.pos.z]; }
        else if (tgt.kind === 'building') { const [x, z2] = this.approachPoint(u, tgt); u.setPath(x, z2); }
        else u.setPath(tgt.pos.x, tgt.pos.z);
        u.repathT = d < 30 ? 0.3 : 1.2;
        // follow counter: give up on targets we can't reach (Fight.usl:527)
        if (!u.path.length) { t.fails = (t.fails || 0) + 1; if (t.fails > 3) return this.endAttack(u); } else t.fails = 0;
      }
      const sp = u.steer(dt, u.runSpeed, 0.3);
      u.moveAnim(sp, u.wild);
      u.busyAnim = false;
      return;
    }
    // in range
    u.path = [];
    u.vel.set(0, 0, 0);
    const w = z.w || u.weapons.long;
    u.useWeapon(w);
    u.lastTarget = tgt;
    const cs = u.cs(w);
    const proj = !!w.projectile;
    let off = u.face(tgt.pos.x, tgt.pos.z, dt, 7);
    if (u.comp && u.comp.top) off = u.comp.aim(tgt.pos.x, tgt.pos.z, dt);
    const dur = this.attackDuration(u, cs);
    if (this.time - u.lastHitDone > dur && off < (proj ? (w.penetration ? Math.PI / 16 : Math.PI / 4) : Math.PI)) {
      u.lastHitDone = this.time;
      // automatic special moves replace the normal hit (CheckSpecialMoves)
      if (this.autoMove && this.autoMove(u, tgt)) return;
      const anims = w.anims && w.anims.length ? w.anims : [{ name: 'attack_front', delay: 0.4, shootdelay: 0.3 }];
      const pick = anims.filter((a) => !a.combo)[Math.floor(Math.random() * anims.filter((a) => !a.combo).length)] || anims[0];
      const clip = u.anim.pick(pick.name, 'attack_front', 'attack_1', 'res_strike_3', 'nat_strike_0');
      if (clip) {
        const len = u.anim.duration(clip);
        const ts = len > dur ? len / dur : 1;
        u.busyAnim = true;
        u.anim.play(clip, { loop: false, restart: true, fade: 0.08, ts, onDone: () => { u.busyAnim = false; } });
      }
      const delay = proj ? (pick.shootdelay || 0.3) : (pick.delay || 0.4);
      u.pending = { t: Math.min(delay, dur * 0.9), w, target: tgt };
      if (!t.user) this.shout(u, tgt, false, false);
    } else if (!u.busyAnim) {
      u.anim.play(u.fightStand() || u.idleAnim);
    }
  },
  // the fight is over: resume work (workers), look for the next enemy, or go back to the post
  endAttack(u, leashed) {
    const t = u.task;
    if (u.prevTask && u.prevTask.type) {
      const pt = u.prevTask; u.prevTask = null;
      if (pt.node && pt.node.alive) return this.startGather(u, pt.node);
      if (pt.farm && pt.farm.alive) return this.startGather(u, pt.farm);
      if (pt.building && pt.building.alive) return this.startBuild(u, pt.building);
    }
    if (!leashed && (u.stance === 2 || t.amove || u.wild)) {
      const next = this.findTarget(u, t.amove ? u.fow : this.alarmRange(u), { leash: !t.amove && !u.wild });
      if (next) { u.task = { type: 'attack', target: next, amove: t.amove, auto: true, user: false }; return; }
    }
    if (t.amove) { u.task = { type: 'attackmove', x: t.amove[0], z: t.amove[1], user: true }; u.setPath(t.amove[0], t.amove[1]); return; }
    u.task = { type: u.wild ? 'roam' : t.hold ? 'hold' : 'idle' }; u.path = []; u.busyAnim = false;
    u.fightStandT = 4;
    // characters after an automatic fight walk back to their post (CheckPatrol)
    if (!u.wild && u.anchor && !t.user && Math.hypot(u.pos.x - u.anchor.x, u.pos.z - u.anchor.y) > 3) { u.task = { type: 'move', x: u.anchor.x, z: u.anchor.y, back: true }; u.setPath(u.anchor.x, u.anchor.y); }
  },
  // the delayed part of an attack: melee hit, area hit, cone hit or projectile launch
  fire(u, w, tgt) {
    if (!u.alive || !tgt.alive) return;
    const cs = u.cs(w);
    // the ninja loses its disguise when it attacks; it comes back 10 s later (FightingObj.usl CAMO_TIMER)
    if (u.st.camo.has('disg')) { u.st.camo.delete('disg'); u.disgT = this.time + 10; }
    if (!w.projectile) {
      if (w.penetration) this.penetrate(u, tgt, cs, w.penAngle || 30);
      else if (cs.splash > 0) this.areaDamage(u, tgt.pos, cs.splash, cs.dmg, cs.endDmg, { size: w.size });
      else {
        if (this.reach(u, tgt) > this.attackRangeOf(u, cs) + u.radius + 3.5) return;   // the victim got away during the swing
        this.takeDmg(u, tgt, 1, 0);
      }
      this.emit('hit', { attacker: u, target: tgt, melee: true, weapon: w });
      if (u.name === 'aje_poisoner') this.kill(u, null);     // the poisoner dies with its attack (Fight.usl)
      return;
    }
    const from = u.pos.clone();
    from.y += Math.min(u.height * 0.7, 2.5);
    const link = this.muzzle(u);
    if (link) { u.obj.updateMatrixWorld(true); link.getWorldPosition(from); }
    this.launch(u, from, tgt, w, cs);
  },
  // where a shot leaves the unit: a turret/top part's projectile link (the Black widow's arm tip is an unnamed link at
  // the end of its bone chain), else the body's own Proj link (a ridden Dilophosaurus spits from its mouth, not from
  // the rider), else the rider's (a rider holding the gun), else the unit's right hand (characters)
  muzzle(u) {
    const c = u.comp;
    if (c && c.top) { const l = c.top.links.Proj || c.top.links.unnamed; if (l) return l; }
    if (u.turretPart && u.turretPart.links) { const l = u.turretPart.links.Proj; if (l) return l; }
    const skip = c ? new Set(c.parts.map((q) => q.obj)) : null;
    let own = null;
    const walk = (o) => { if (own || (skip && skip.has(o))) return; if (o.name === 'link_Proj') { own = o; return; } for (const ch of o.children) walk(ch); };
    walk(u.model);
    if (own) return own;
    if (c && c.rider) { const l = c.rider.links.Proj || c.rider.links.HndR; if (l) return l; }
    return u.findLink('HndR');
  },
  // CArrow.Set/Shoot (Product.usl:618): snapshot of the attacker's values; jitter moves the aim of area shots
  launch(src, from, tgt, w, cs, extraDelay = 0) {
    let aim = null;
    if (w.jitter && cs.splash > 0) {
      const L = (Math.floor(Math.random() * Math.max(1, w.jitter * 20)) / 10) - w.jitter, th = Math.random() * 3.14;
      aim = tgt.pos.clone(); aim.x += Math.cos(th) * L; aim.z += Math.sin(th) * L;
    }
    const p = new Projectile(this, from, tgt, w, src, aim);
    p.snap = { dmg: cs.dmg, endDmg: cs.endDmg, splash: cs.splash, ap: cs.ap, size: w.size };
    p.delay = extraDelay;
    this.projectiles.push(p);
    this.emit('shoot', { attacker: src, weapon: w, pos: from });
  },
  projectileUpdate(p, dt) {
    if (p.delay > 0) { p.delay -= dt; if (p.obj) p.obj.visible = false; return; }
    if (p.obj) p.obj.visible = true;
    p.t += dt;
    const k = Math.min(1, p.t / p.T);
    if (p.target && p.target.alive && !p.fixedAim) { p.aim.x = p.target.pos.x; p.aim.z = p.target.pos.z; p.aim.y = p.target.pos.y + Math.min(2, (p.target.height || 2) * 0.5); }
    p.prev.copy(p.pos);
    p.pos.lerpVectors(p.from, p.aim, k);
    p.pos.y += Math.sin(k * Math.PI) * p.arc;
    if (p.obj) {
      p.obj.position.copy(p.pos);
      const dir = p.pos.clone().sub(p.prev);
      if (dir.lengthSq() > 1e-6) { dir.normalize(); p.obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir); }
    }
    if (k < 1) return;
    p.alive = false;
    if (p.obj) this.scene.remove(p.obj);
    const w = p.weapon, A = p.owner, s = p.snap || { dmg: w.dmg, endDmg: w.enddmg, splash: w.splash, ap: w.ap };
    // Aje ankylosaurus catapult "dino ammo": the egg hatches a velociraptor that fights for 30 s (CDinoAmmoEgg)
    if ((w.projectile || '').toLowerCase() === 'aje_ammo_dino' && (A ? A.owner : p.ownerPlayer)) {
      const r = this.spawnUnit('aje_velociraptor', A ? A.owner : p.ownerPlayer, p.aim.x, p.aim.z, 1, 0, { autonomous: true });
      if (r) { r.home.set(p.aim.x, p.aim.z); r.homeRadius = 60; this.later(30, () => { if (r.alive) { r.silentDeath = true; this.kill(r, null); } }); }
    }
    // OnDoDmg (Product.usl:535): area weapons hit the (jittered) aim point, others always hit their target
    if (s.splash > 0) {
      if (A && A.alive) this.areaDamage(A, p.aim, s.splash, A.cs(w) ? A.cs(w).dmg : s.dmg, s.endDmg, { size: s.size });
      else this.areaDamage(null, p.aim, s.splash, s.dmg, s.endDmg, { owner: p.ownerPlayer, size: s.size });
      this.emit('impact', { pos: p.aim.clone(), weapon: w, splash: true });
      return;
    }
    const V = p.target;
    if (V && V.alive) {
      if (A && A.alive) this.takeDmg(A, V, 1, 0, w);
      else this.takeDirectDmg(V, s.dmg, s.ap, p.ownerPlayer, true);
      if (p.onHit) p.onHit(V);
      this.emit('hit', { attacker: A, target: V, weapon: w });
      this.emit('impact', { pos: p.aim.clone(), weapon: w, splash: false, target: V });
      return;
    }
    this.emit('impact', { pos: p.aim.clone(), weapon: w, splash: false });
  },

  // ------------------------------------------------------------------ damage (FightingObj.usl)
  // TakeDmg: the attacker's weapon hits the victim with `factor` (splash falloff); the hit lands after hitDelay
  takeDmg(A, V, factor = 1, hitDelay = 0, weapon = null) {
    if (!V.alive || V.inside) return 0;
    if (V.st && V.st.camo.has('aje')) this.setCamo(V, 'aje', false);
    if (A.cls === 'ANML' && active(V, 'anmlImmune', this.time)) return 0;
    const w = weapon || A.weapon || A.weapons.long;
    if (!w) return 0;
    const cs = A.cs(w);
    let raw = factor * attackBoni(A, cs.dmg) * (1 + ((w.bonus && (w.bonus[V.cls] || 0) + (w.bonus[V.name] || 0)) || 0) / 100);
    if (V.cls === 'BLDG' && A.st && A.st.bonus.BLDGDAMAGE > 0) {
      const t = Math.trunc(raw); raw *= 1 + A.st.bonus.BLDGDAMAGE * 0.01; if (Math.trunc(raw) === t) raw += 0.5;
    }
    const vcs = V.cs ? V.cs() : null;
    let pct;
    if (!w.projectile) {
      const vm = V.kind === 'unit' ? this.data.defenceVs(V.name, V.owner, A.cls) : { rel: 1, abs: 0 };
      const vw = V.weapon || (V.weapons && V.weapons.long);
      const db = vw && vw.defBonus ? (vw.defBonus[A.cls] || 0) + (vw.defBonus[A.name] || 0) : 0;
      pct = tempDef(V, Math.max(0, (vcs ? vcs.prot : 0) - cs.ap)) + db * vm.rel + (db ? vm.abs : 0);
    } else pct = tempRangedDef(V, Math.max(0, (vcs ? vcs.rprot : 0) - cs.ap));
    let dmg = raw - raw * clamp(pct * 0.01, 0, 0.99);
    // AttackFactor / DefenseFactor of computer players (CAiCheatMgr.UpdateFightFactors; docs/spec/ai.md §3)
    if (A.owner && A.owner.aiMods) dmg *= A.owner.aiMods.attack || 1;
    if (V.owner && V.owner.aiMods) dmg *= V.owner.aiMods.defense || 1;
    // the ice spearman freezes its victims for 2.5 s (SetIced)
    if (A.name === 'ninigi_icespearman' && V.kind === 'unit') this.trap(V, 2.5, 'iced');
    const go = () => this.provideDmg(dmg, A, V, !!w.projectile, cs.poison, cs.poisonTicks, w);
    if (hitDelay > 0) this.later(hitDelay, go); else go();
    return dmg;
  },
  // ProvideDmg (FO:4324): invulnerability, knockback, life drain, poison, then Damage()
  provideDmg(dmg, A, V, isProj, poison, ticks, w) {
    if (!V.alive) return;
    if (!isProj && A && !A.alive) return;
    if (this.invulnerable(V)) return;
    V.lastAttacker = A; V.lastHit = this.time;
    if (A && A.owner) V.lastDamager = A.owner;
    if (V.attackers) V.attackers.add(A);
    // knockback when the attacker is at least 3 size classes bigger (characters and animals only)
    if (A && A.alive && V.kind === 'unit' && (V.cls === 'CHTR' || V.cls === 'ANML') && dmg >= 1) {
      const diff = (A.stats.size || 0) - (V.stats.size || 0);
      if ((A.stats.size || 0) > 0 && (V.stats.size || 0) > 0 && diff >= 3) {
        const i = Math.min(9, diff);
        if (Math.random() < KNOCK_CHANCE[i]) this.knockback(V, A.pos, KNOCK_DIST[i] * (1 + Math.random() * 0.2), 0.4);
      }
    }
    const drain = A && A.stats && A.stats.abilities && A.stats.abilities.drain_life;
    if (drain && A.alive) A.hp = Math.min(A.maxHp, A.hp + dmg * (drain.amount || 0));
    // BLDG_res_back: the killer's player gets the build cost of a destroyed building
    if (V.hp - Math.max(Math.ceil(dmg), 1) <= 0 && A && A.owner && (V.kind === 'building' || V.name === 'aje_resource_collector') && this.data.invented(A.owner, 'BLDG_res_back', A.owner.tribe)) this.grantBuildCost(V, A.owner);
    if (poison > 0 && ticks > 0 && V.kind === 'unit' && V.cls !== 'VHCL' && V.cls !== 'SHIP') this.applyPoison(V, poison, ticks, A);
    this.damage(V, dmg, A);
  },
  // Damage(): hit points lost = max(ceil(dmg), 1); ignored while invulnerable after a level up / doping
  damage(V, d, A) {
    if (V.parentGate && V.parentGate.alive) V = V.parentGate;      // a gate's wing passes all damage to the gate (B:2266)
    if (!V.alive) return;
    if (this.invulnerable(V, true)) return;
    V.hp -= Math.max(Math.ceil(d), 1);
    this.afterDamage(V, A);
  },
  // TakeDirectDmg / TakeDirectMeleeDmg (FO:4554): fixed damage reduced by (ranged) protection only
  takeDirectDmg(V, d, ap = 0, byPlayer = null, ranged = true, A = null) {
    if (!V.alive || V.inside || this.invulnerable(V)) return;
    const vcs = V.cs ? V.cs() : null;
    const p = ranged ? tempRangedDef(V, (vcs ? vcs.rprot : 0) - ap) : tempDef(V, (vcs ? vcs.prot : 0) - ap);
    if (byPlayer) V.lastDamager = byPlayer;
    if (A) V.lastAttacker = A;
    this.damage(V, d - d * clamp(p / 100, 0, 0.99), A);
  },
  // legacy name used by effects and moves: fixed damage without protection
  applyDamage(V, dmg, A) { if (A && A.owner) V.lastDamager = A.owner; this.damage(V, dmg, A); },
  afterDamage(V, A) {
    V.lastHit = this.time;
    if (A && A.alive) V.lastAttacker = A;
    if (V.owner) this.emit('attacked', { entity: V, by: A });
    if (V.hp <= 0) { this.kill(V, A); return; }
    if (V.kind === 'building') { if (A && A.alive && !isWall(V)) this.shout(V, A, true, false); return; }
    if (V.st && V.st.camo.has('entr') && this.digOut) this.digOut(V);
    if (V.name === 'ninigi_ninja') V.disgT = this.time + 10;
    this.onHurt(V, A);
  },
  invulnerable(V, damageOnly) {
    const t = this.time;
    if (active(V, 'levelInvul', t) || active(V, 'doping', t)) return true;
    if (!damageOnly && active(V, 'invul', t)) return true;
    return V.invulnT > 0;
  },
  // retaliation (OnDefend / AddEnemy(defend=true)): fight back unless busy with an order or passive
  onHurt(u, att) {
    if (!att || !att.alive || !u.alive || u.inside) return;
    if (u.wild) return this.animalHurt(u, att);
    if (u.stance === 3 || u.stance === -1) return;
    if (!u.weapons.long || u.cs().dmg <= 0 || u.cannotFight) { this.shout(u, att, true, false); return; }
    const t = u.task.type;
    if (t === 'attack' || t === 'heal') return;
    if (u.task.user && t !== 'idle' && t !== 'hold' && !(u.isWorker && (t === 'gather' || t === 'build'))) return;
    if (t === 'hold' || u.stance === 0) { if (this.rangeZone(u, att).zone === 0) return; }
    if (u.isWorker && (t === 'gather' || t === 'build') && (att.kind !== 'unit' || u.distTo(att) > 8)) return;
    this.engage(u, att, { defend: true, hold: t === 'hold' || u.stance === 0 });
  },
  // area damage (CAreaDamage FO:9431): enemies and neutral units within R; linear falloff from dmg to endDmg
  areaDamage(A, center, R, dmg, endDmg, opts = {}) {
    if (R <= 0) R = 1;
    const owner = A ? A.owner : opts.owner || null;
    const victims = [];
    const test = (V) => {
      if (!V.alive || V.inside || V === A) return;
      if (owner && V.owner && !owner.isEnemy(V.owner)) return;      // hostile players and ownerless objects only (FO:9443)
      if (!owner && !V.owner) return;
      const d = V.kind === 'building' ? Math.max(0, V.surfDist(center.x, center.z)) : Math.max(0, Math.hypot(V.pos.x - center.x, V.pos.z - center.z) - V.radius);
      if (d >= R) return;
      victims.push([V, d]);
    };
    this.uHash.query(center.x, center.z, R + 20, test);
    this.bHash.query(center.x, center.z, R + 30, test);
    const e = dmg !== 0 ? endDmg / dmg : 0;
    for (const [V, d] of victims) {
      const f = (1 - e) * (R - d) / R + e;
      if (A && A.alive && !opts.direct) this.takeDmg(A, V, f, 0, opts.weapon);
      else this.takeDirectDmg(V, dmg * f, opts.ap || 0, owner, true, A);
      if (opts.size > 0 && V.kind === 'unit' && (V.cls === 'CHTR' || V.cls === 'ANML')) {
        const diff = opts.size - (V.stats.size || 0);
        if (diff >= 3) this.knockback(V, center, SPLASH_DIST[Math.min(9, diff)] * (1 + Math.random() * 0.3), 0);
      }
    }
    return victims.length;
  },
  // Penetrate (FO:5866): cone weapons (flamethrowers, lances) hit every enemy in the cone
  penetrate(A, tgt, cs, angleDeg) {
    const R = this.attackRangeOf(A, cs) + A.radius + 2;
    const dir = Math.atan2(tgt.pos.z - A.pos.z, tgt.pos.x - A.pos.x);
    const half = (angleDeg || 30) * Math.PI / 360;
    const test = (V) => {
      if (!V.alive || V.inside || !A.isEnemy(V)) return;
      const dx = V.pos.x - A.pos.x, dz = V.pos.z - A.pos.z;
      const d = Math.hypot(dx, dz) - (V.kind === 'building' ? 0 : V.radius * 0.5);
      if (d > R + (V.kind === 'building' ? V.radius : 0)) return;
      if (Math.abs(wrap(Math.atan2(dz, dx) - dir)) > half && V !== tgt) return;
      this.takeDmg(A, V, 1, 0);
    };
    this.uHash.query(A.pos.x, A.pos.z, R + 6, test);
    this.bHash.query(A.pos.x, A.pos.z, R + 20, test);
  },
  // poison: two slots, only the stronger one ticks (every 3 s, poison_tick_count times) - FO:223-335
  applyPoison(V, p, n, A) {
    const st = V.st;
    const cur = st.poison;
    if (!cur || cur.dmg <= p) {
      if (cur && (!st.poison2 || cur.left >= st.poison2.left)) st.poison2 = { ...cur };
      st.poison = { dmg: p, left: n, next: cur ? cur.next : this.time + POISON_TICK, by: A };
    } else if (!st.poison2 || st.poison2.left <= n) st.poison2 = { dmg: p, left: n, next: this.time + POISON_TICK, by: A };
  },
  poisonUpdate(V) {
    const st = V.st, t = this.time;
    if (st.poison2 && st.poison2.next <= t) { st.poison2.left--; st.poison2.next += POISON_TICK; if (st.poison2.left <= 0) st.poison2 = null; }
    const P = st.poison;
    if (!P || P.next > t) return;
    P.left--; P.next += POISON_TICK;
    if (P.by && P.by.owner) V.lastDamager = P.by.owner;
    this.damage(V, P.dmg, null);
    if (P.left <= 0) { st.poison = st.poison2 ? { ...st.poison2, next: t + POISON_TICK } : null; st.poison2 = null; }
  },
  // short stun + push (hit_back / getting_up)
  knockback(V, from, dist, delay) {
    if (!V.alive || V.kind !== 'unit' || V.inside) return;
    const dx = V.pos.x - from.x, dz = V.pos.z - from.z, d = Math.hypot(dx, dz) || 1;
    this.later(delay, () => {
      if (!V.alive) return;
      V.knock = { vx: dx / d * dist / 0.4, vz: dz / d * dist / 0.4, t: 0.4 };
      this.trap(V, 1.2, 'knock');
      const a = V.anim.pick('hit_back');
      if (a) { V.busyAnim = true; V.anim.play(a, { loop: false, restart: true, onDone: () => { const g = V.anim.pick('getting_up'); if (g && V.alive) V.anim.play(g, { loop: false, restart: true, onDone: () => { V.busyAnim = false; } }); else V.busyAnim = false; } }); }
    });
  },
  // SetTrapped(seconds): the unit can't act
  trap(V, sec, why = 'trapped') {
    if (!V.st) return;
    V.st.t.trapped = Math.max(V.st.t.trapped || 0, this.time + sec);
    V.st.trapWhy = why;
    if (V.kind === 'unit') { V.path = []; V.vel.set(0, 0, 0); }
  },
  grantBuildCost(V, p) {
    const a = this.data.actions(V.owner).find((x) => x.kind === 'Build' && x.results[0] && x.results[0].obj === V.name);
    if (a) p.refund({ food: a.cost.food, wood: a.cost.wood, stone: a.cost.stone });
  },

  // ------------------------------------------------------------------ towers and bunkers (CTower / CBunker)
  // towers the player can aim: built, own, with a ranged weapon (bunkers too - their garrison shoots)
  canAimTower(b) { return b.kind === 'building' && b.built && !!(b.weapons && b.weapons.long && b.weapons.long.projectile); },
  // can player p order an attack on t? Enemies, and wild (ownerless) animals
  hostileTo(p, t) { return !!(p && t && t.alive && t.kind !== 'res' && (t.owner ? p.isEnemy(t.owner) : t.kind === 'unit')); },
  aimTowers(list, target) {
    let n = 0;
    for (const b of list) if (this.canAimTower(b) && b.owner && this.hostileTo(b.owner, target) && this.canTarget(b, target)) { b.forcedTarget = target; b.towerTarget = target; n++; }
    return n;
  },
  towerUpdate(b, dt) {
    const w = b.weapons.long;
    if (!w || !w.projectile || !b.owner || !b.built || b.dismantling) return;
    const cs = b.cs(w);
    const R = cs.range + b.radius * 0.5;
    b.cool -= dt;
    if (b.cool > 0) return;
    // bunkers only shoot with characters inside (one arrow per character)
    const shots = b.def.script === 'CBunker' ? (b.passengers ? b.passengers.length : 0) : 1;
    if (!shots) { b.cool = 0.5; return; }
    // a target the player ordered (right-click / Attack): kept while it lives, shot whenever it is in range
    const f = b.forcedTarget;
    if (f && (!f.alive || !this.canTarget(b, f))) b.forcedTarget = null;
    const inReach = (x) => this.reach(b, x) <= R && !(w.minrange && this.reach(b, x) < w.minrange);
    let e = b.forcedTarget && inReach(b.forcedTarget) ? b.forcedTarget : b.towerTarget;
    if (!e || !e.alive || !this.canTarget(b, e) || !inReach(e)) {
      e = this.findTarget(b, R, { filter: (x) => !w.minrange || this.reach(b, x) >= w.minrange });
    }
    b.towerTarget = e;
    if (!e) { b.cool = 0.5; return; }
    // the turret turns first (SecRotAction 0.8 s), then fires on the next tick
    if (b.turret && b.aimTurret(e.pos.x, e.pos.z, dt) > 0.25) { b.cool = 0; return; }
    b.cool = this.attackDuration(b, cs);
    const from = b.pos.clone(); from.y += b.ht * 0.8;
    if (b.turret) {
      b.turret.obj.updateMatrixWorld(true);
      const pl = b.turret.links.Proj || b.turret.obj; pl.getWorldPosition(from);
      if (b.turret.anim) b.turret.anim.play(b.turret.anim.pick(b.turret.attackAnim || 'attack_front', 'attack_front', 'gun_shoot') || 'attack_front', { loop: false, restart: true });
    }
    const sd = (w.anims[0] && w.anims[0].shootdelay) || 0;
    for (let i = 0; i < shots; i++) this.launch(b, from, e, w, cs, i ? sd * (1 + 0.1 * i) : 0);
  },

  // ------------------------------------------------------------------ death
  kill(e, att) {
    if (e.name === 'ninigi_mineship_mine' && !e.blasted && e.alive && this.mineBlast) { this.mineBlast(e); return; }   // a destroyed mine goes off
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    // skulls for the player who damaged it last (OnKill FO:3950); skull protector aura: none, Kleemann aura: +15 %
    const killer = e.lastDamager || (att && att.owner) || null;
    if (killer && killer !== e.owner && e.stats && e.stats.scalps && (e.owner || e.kind === 'unit')) {
      let v = e.stats.scalps;
      if (e.st && e.st.aura.skullProtect) v = 0;
      if (e.st && e.st.aura.kleemann) v *= 1.15;
      killer.res.skulls += Math.round(v);
      if (e.owner || e.cls === 'ANML') killer.kills++;
    }
    this.entityFilters(e, false);
    if (e.onDeath) e.onDeath(att);
    if (e.kind === 'unit') this.unitDied(e, att);
    else if (e.kind === 'building') this.buildingDestroyed(e, att);
    this.dead.push(e);
  },
  unitDied(e, att) {
    this.releaseTask(e);
    this.uHash.remove(e);
    if (e.passengers && this.unloadAll) this.unloadAll(e, true);
    if (e.inside && this.leaveTransport) this.leaveTransport(e);
    if (e.owner) {
      const p = e.owner;
      if (e.countsInPop !== false) { p.units--; p.atLevel[e.level - 1]--; }
      p.lost++;
      if (e.def.unique) p.heroes.delete(e.name);
      for (const q of e.queue) { p.refund(q.action.cost); if (q.level) { p.queuedAtLevel[q.level - 1]--; p.queuedUnits--; } }
      e.queue = [];
      this.recomputeCaps(p);
    }
    e.path = []; e.task = { type: 'dead' };
    e.deadT = 0;
    e.anim.play(e.anim.pick('dying', 'die_simple', 'hit_die_simple') || e.idleAnim, { loop: false, fade: 0.1 });
    e.attachTool(null);
    // owned characters and animals leave a spirit that an Aje shaman can resurrect (not heroes, illusions, summons)
    if (e.owner && (e.cls === 'CHTR' || e.cls === 'ANML') && !e.illusion && !e.autonomous && !e.def.unique && !e.silentDeath) {
      this.spirits.push({ kind: 'spirit', name: e.name, level: e.level, owner: e.owner, pos: e.pos.clone(), alive: true, radius: 1, until: this.time + 60 });
    }
    // animals leave a carcass: wild kills can be eaten for 120 s (Resource.usl CDino_Food)
    if (e.cls === 'ANML' && e.wild) {
      const food = this.data.corpseFood(e.name);
      const n = this.addResource('corpse', 'food', e.pos.x, e.pos.z, food, { radius: Math.max(1.5, e.radius), rotT: 120, corpseOf: e, maxWorkers: 5, hunt: e.name });
      e.corpseNode = n;
    }
    this.emit('died', { entity: e, killer: att });
  },
};
export { headingTo };
