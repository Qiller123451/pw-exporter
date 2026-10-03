// The swarm: Dustrider warriors, spearmen, archers, raptors and the big dinosaurs.
//
// Every enemy is a model instance with one animation player (the remake's AnimCtl) and a small state machine:
//   chase    run towards the player along the shared flow field (nav.js), keeping apart from the others
//   attack   melee swing: the hit lands `hitAt` seconds into the clip if the player is still in reach
//   shoot    spearmen / archers: stop, aim, release a projectile
//   flinch   short stagger after taking a lot of damage at once
//   down     knocked off the feet (thrown through the air, lands, gets up again if still alive)
//   dazed    nearly dead and reeling: can be executed (key E) for armour
//   burning  on fire and running around in panic
//   dead     the body stays for a while, then sinks into the ground
// The classes are data (CFG.enemies); nothing here knows about a specific unit.
import * as THREE from 'three';
import { CFG } from './config.js';
import { Actor, AnimCtl, loadActor, yawTo, wrapPi } from './actors.js';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const GRAV = 40;

class Enemy {
  constructor(sw, type, def) {
    this.sw = sw; this.type = type; this.def = def;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.alive = false;
  }
  init(actor, tpl, x, y, z, yaw = null) {
    const d = this.def;
    this.actor = actor; this.tpl = tpl;
    this.anim = actor.animCtl || (actor.animCtl = new AnimCtl(actor.model, tpl.clips));
    this.anim.setEvents(tpl.info.sounds, (ev) => this.sw.g.audio.animEvent(ev, this.pos));
    this.pos.set(x, y, z); this.vel.set(0, 0, 0);
    this.hp = this.maxHp = d.health * (this.sw.healthScale || 1);
    this.alive = true; this.state = 'chase'; this.t = 0; this.cool = rnd(0, 1); this.shootCool = rnd(0.5, d.ranged ? d.ranged.every : 1);
    this.stagger = 0; this.burn = 0; this.burnDps = 0; this.dazedOnce = false; this.onGround = true; this.held = 0;
    this.spin = 0; this.tilt = 0; this.struck = false; this.flowDir = new THREE.Vector3(); this.flowT = 0; this.stuckT = 0;
    this.probeT = Math.random(); this.probeX = x; this.probeZ = z; this.stuckN = 0; this.recenter = 0; this.vault = 0; this.bumped = false; this.lostT = 0;
    this.nav = d.radius > CFG.nav.bigRadius && this.sw.navBig ? this.sw.navBig : this.sw.nav;
    this.side = Math.random() < 0.5 ? -1 : 1; this.frame = Math.floor(Math.random() * 4);
    this.yaw = yawTo(this.sw.g.player.pos.x - x, this.sw.g.player.pos.z - z);
    actor.obj.position.copy(this.pos); actor.obj.rotation.set(0, this.yaw, 0); actor.obj.visible = true;
    actor.model.rotation.set(0, 0, 0); actor.model.position.set(0, 0, 0); actor.model.scale.setScalar(d.scale || 1);
    this.setTint(null);
    if (d.structure) {                       // a tent, a totem, a boat: stands where it is put and only takes damage
      this.state = 'structure'; this.yaw = yaw || 0; this.smokeT = 0;
      actor.obj.rotation.set(0, this.yaw, 0);
      return;
    }
    if (yaw != null) this.yaw = yaw;
    this.run();
    this.ride('ride_idle_0', true);
  }
  // the riders' animation (if the animal carries any)
  ride(clip, loop) {
    for (const r of this.actor.riders || []) {
      const c = r.pick(clip, 'ride_idle_0', 'standanim');
      if (c) r.play(c, { loop, restart: !loop, fade: 0.15 });
    }
  }
  run() { const d = this.def; this.anim.play(this.anim.pick(d.run, 'walk_2', 'walk_1'), { ts: d.speed / d.runSpeed, cut: true }); }
  setTint(c) {
    if (this.tint === c) return;
    this.tint = c;
    this.actor.model.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData.baseMat) o.userData.baseMat = o.material;
      if (c == null) { o.material = o.userData.baseMat; return; }
      const key = '_tint' + c;
      const b = o.userData.baseMat;
      if (!b[key]) { b[key] = b.clone(); b[key].color.multiplyScalar(0).add(new THREE.Color(c)); }
      o.material = b[key];
    });
  }
  hold(t) { this.held = t; this.state = 'dazed'; this.t = Math.max(this.t, t + 0.2); }

  // ---------------------------------------------------------------- taking damage
  // info: {kind: 'bullet' | 'fire' | 'explosion' | 'melee' | 'claw' | 'slam' | 'execute', dir, from, point, knock, stagger, head, burn, burnDps}
  damage(amount, info = {}) {
    if (!this.alive) return false;
    const G = this.sw.g, d = this.def, fx = G.fx;
    if (d.structure) {
      // wood and cloth: splinters and dust instead of blood, fire keeps burning it, nothing moves it
      const was = this.hp;
      this.hp -= amount * (info.kind === 'fire' ? d.fire || 1 : 1);
      G.hud.number(this, Math.min(was, was - this.hp), info.kind);
      if (info.kind === 'fire') { this.burn = Math.max(this.burn, (info.burn || 2) * 2); this.burnDps = (info.burnDps || 20) * (d.fire || 1); }
      else if (info.point && Math.random() < 0.5) fx.dust(info.point, 0.8, 1, [0.75, 0.62, 0.45, 0.5]);
      G.hud.hit(this.hp <= 0, false);
      G.hud.target(this);
      if (this.hp <= 0) this.die(info, v2.set(0, 0, 0));
      return this.hp <= 0;
    }
    G.hud.number(this, Math.min(this.hp, amount), info.head ? 'head' : info.kind);
    this.hp -= amount;
    this.stagger += amount;
    const mid = v1.copy(this.pos).setY(this.pos.y + d.height * 0.6);
    const dir = info.dir ? v2.copy(info.dir) : info.from ? v2.set(this.pos.x - info.from.x, 0, this.pos.z - info.from.z).normalize() : v2.set(0, 0, 0);
    if (info.kind === 'fire') { this.burn = Math.max(this.burn, info.burn || 2); this.burnDps = info.burnDps || 20; } else if (G.settings.blood) fx.blood(info.point || mid, dir, info.kind === 'bullet' ? 3 : 7, info.kind === 'bullet' ? 0.8 : 1.4);
    G.hud.hit(this.hp <= 0, !!info.head);
    if (this.hp <= 0) { this.die(info, dir); return true; }
    const knock = (info.knock || 0) * (d.heavy ? 0.1 : 1);
    if (knock >= 12 && d.knock) { this.knockDown(dir, knock); return false; }
    if (knock > 0) { this.vel.x += dir.x * knock; this.vel.z += dir.z * knock; }
    // nearly dead: reel, ready to be executed (always for the big ones, sometimes for the small fry)
    if (!this.dazedOnce && this.hp < this.maxHp * d.executable && this.state !== 'down' && (d.elite || Math.random() < 0.45)) {
      this.dazedOnce = true; this.state = 'dazed'; this.t = d.elite ? 6 : 4;
      this.anim.play(this.anim.pick(d.flinch, 'hit_reaction', d.idle), { restart: true });
      G.sfx('ping', 35, this.pos);
      return false;
    }
    if (this.stagger >= d.staggerAt && this.state !== 'down' && this.state !== 'dazed' && this.state !== 'burning') {
      this.stagger = 0; this.state = 'flinch'; this.t = d.heavy ? 0.5 : 0.32; this.struck = true;
      this.anim.play(this.anim.pick(d.flinch, 'hit_reaction'), { loop: false, restart: true, fade: 0.05 });
    }
    return false;
  }
  knockDown(dir, power) {
    this.state = 'down'; this.t = 0; this.onGround = false; this.struck = true;
    this.vel.set(dir.x * power, power * 0.45 + 4, dir.z * power);
    this.yaw = yawTo(-dir.x, -dir.z);                   // falls on its back, feet towards where the blow came from
    this.anim.play(this.def.knock, { loop: false, restart: true, fade: 0.05 });
  }
  die(info, dir) {
    const G = this.sw.g, d = this.def, fx = G.fx, sw = this.sw;
    if (d.structure) {
      this.alive = false; this.state = 'dead'; this.t = 0.05; sw.alive--;
      const p = v1.copy(this.pos).setY(this.pos.y + d.height * 0.4);
      fx.explosion(p, d.radius * 1.6); fx.dust(p, d.radius * 1.5, 14); fx.shake(0.45);
      for (let k = 0; k < 4; k++) fx.sparks(v3.copy(p).setY(p.y + k * d.height * 0.15), 10, 18, [1, 0.7, 0.3, 1]);
      G.sfx('explode', 90, this.pos, 0.75 + Math.random() * 0.2);
      this.actor.obj.visible = false;
      G.onKill(this, info);
      return;
    }
    this.alive = false; this.state = 'dead'; this.t = CFG.swarm.corpseTime; this.struck = true;
    this.rideT = 0; this.ride('dying', false);
    sw.alive--; sw.killed++;
    G.onKill(this, info);
    const kind = info.kind;
    const big = (info.knock || 0) >= 20 || kind === 'explosion' || kind === 'execute';
    // blown to pieces
    if (!d.heavy && G.settings.blood && (kind === 'explosion' && Math.random() < 0.55 || kind === 'execute' && Math.random() < 0.5 || kind === 'slam' && Math.random() < 0.3)) {
      fx.gibs(this.pos, 7, 1); fx.blood(v1.copy(this.pos).setY(this.pos.y + 2), dir, 14, 2); fx.bloodPool(this.pos, 4);
      this.actor.obj.visible = false; this.t = 0.1;
      return;
    }
    if (big && !d.heavy) {
      // thrown through the air, spinning
      this.flying = true; this.onGround = false;
      const p = Math.max(18, info.knock || 22) * rnd(0.8, 1.3);
      this.vel.set(dir.x * p + rnd(-4, 4), p * rnd(0.45, 0.8) + 6, dir.z * p + rnd(-4, 4));
      this.spin = rnd(5, 11) * (Math.random() < 0.5 ? -1 : 1);
      this.yaw = yawTo(-dir.x, -dir.z);
      this.anim.play(this.anim.pick(d.knock, d.die[0]), { loop: false, restart: true, fade: 0.05 });
    } else {
      this.flying = false;
      this.vel.set(dir.x * 3, 0, dir.z * 3);
      this.anim.play(this.anim.pick(info.head ? 'die_simple' : pick(d.die), d.die[0]), { loop: false, restart: true, fade: 0.08, ts: 1.15 });
    }
    if (this.burn > 0) this.setTint(0x1a1612);
    if (G.settings.blood && kind !== 'fire') fx.bloodPool(this.pos, d.heavy ? 8 : 3);
    if (d.elite) { fx.shake(0.6); G.slowMo(0.3, 1.0); }
  }

  // ---------------------------------------------------------------- one simulation step
  step(dt) {
    const sw = this.sw, G = sw.g, d = this.def, col = G.level.collision, P = G.player;
    this.stagger = Math.max(0, this.stagger - d.staggerAt * 0.6 * dt);
    this.cool -= dt; this.shootCool -= dt; this.t -= dt;
    if (this.state === 'dead') return this.stepDead(dt);
    if (d.structure) {
      if (this.burn > 0) {
        this.burn -= dt; G.hud.number(this, Math.min(this.hp, this.burnDps * dt), 'fire'); this.hp -= this.burnDps * dt;
        if (Math.random() < dt * 20) G.fx.burn(v1.set(this.pos.x + rnd(-1, 1) * d.radius * 0.6, this.pos.y + rnd(0.2, 0.8) * d.height, this.pos.z + rnd(-1, 1) * d.radius * 0.6), 2.5);
        if (this.hp <= 0) { this.die({ kind: 'fire' }, v2.set(0, 0, 0)); G.hud.hit(true, false); }
      } else if (this.hp < this.maxHp * 0.5 && (this.smokeT -= dt) <= 0) { this.smokeT = 0.25; G.fx.dust(v1.copy(this.pos).setY(this.pos.y + d.height * 0.8), 2.5, 1, [0.25, 0.23, 0.22, 0.5]); }
      return;
    }
    // burning
    if (this.burn > 0) {
      this.burn -= dt;
      if (Math.random() < dt * 14) G.fx.burn(this.pos, d.radius);
      G.hud.number(this, Math.min(this.hp, this.burnDps * dt), 'fire');
      this.hp -= this.burnDps * dt;
      if (this.hp <= 0) { this.setTint(0x1a1612); this.die({ kind: 'fire' }, v2.set(0, 0, 0)); G.hud.hit(true, false); return; }
      if (!d.heavy && this.state !== 'burning' && this.state !== 'down') {
        this.state = 'burning'; this.t = this.burn; this.panic = Math.random() * 6.283;
        this.anim.play(this.anim.pick(d.run), { ts: 1.6, cut: true });
      }
    }
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, dy = P.pos.y - this.pos.y;
    const dist = Math.hypot(dx, dz);
    const reach = d.attack.range + P.def.radius;
    let mvx = 0, mvz = 0, face = null;

    switch (this.state) {
      case 'chase': {
        if (P.dead) { this.anim.play(this.anim.pick(d.taunt, d.idle)); break; }
        const R = d.ranged;
        if (R && this.shootCool <= 0 && dist < R.range && dist > R.min && Math.abs(dy) < 30 && this.los()) { this.startShoot(); break; }
        if (dist < reach && Math.abs(dy) < d.height) {
          face = yawTo(dx, dz);
          if (this.cool <= 0 && sw.attackers < CFG.swarm.attackSlots) { this.startAttack(dist); break; }
          // waiting for a turn: shuffle sideways around the player
          mvx = -dz / (dist || 1) * this.side * d.speed * 0.25; mvz = dx / (dist || 1) * this.side * d.speed * 0.25;
          if (this.anim.curName !== d.idle && this.anim.has(d.idle)) this.anim.play(d.idle);
          break;
        }
        // archers hold their distance when they can see the player
        if (R && R.keep && dist < R.keep && this.los()) { face = yawTo(dx, dz); if (this.anim.curName !== d.idle && this.anim.has(d.idle)) this.anim.play(d.idle); break; }
        // straight at the player when close and nothing is in the way, else along the flow field
        this.flowT -= dt;
        if (this.flowT <= 0) {
          this.flowT = 0.2 + Math.random() * 0.15;
          // (after bumping into something: head for the middle of the very next cell of the path for a moment)
          // (the big dinosaurs keep to the wide streets; where those do not lead to the player they squeeze through)
          let left = this.nav.dir(this.pos.x, this.pos.z, this.flowDir, this.recenter > 0 ? 1 : 3);
          if (left === Infinity && this.nav !== sw.nav) left = sw.nav.dir(this.pos.x, this.pos.z, this.flowDir, this.recenter > 0 ? 1 : 3);
          const none = left === Infinity || (this.flowDir.x === 0 && this.flowDir.z === 0);
          // a barricade of a district that is still shut lies on the way: over it (the big ones push through)
          const Z = G.zones;
          if (Z && !none && this.onGround && this.vault <= 0 && !d.heavy) {
            let c = sw.nav.index(this.pos.x, this.pos.z);
            for (let k = 0; k < 3 && c >= 0; k++) { c = sw.nav._next(c); if (Z.closedAt(c)) { this.vaultOut(k + 4, 0.62); break; } }
          }
          // left behind with no way to the player (too far, or cut off): give the place back to the swarm
          this.lostT = left === Infinity && dist > 60 ? (this.lostT || 0) + 0.3 : 0;
          if (this.lostT > 6 && !d.elite && !G.mission.seen(this.pos.x, this.pos.y, this.pos.z)) { sw.recycle(this); return; }
          this.direct = this.recenter <= 0 && (none || (dist < 22 && Math.abs(dy) < 3 && col.clear(this.pos.x, this.pos.y + 2, this.pos.z, P.pos.x, P.pos.y + 2, P.pos.z)));
        }
        let ux, uz;
        if (this.direct) { ux = dx / (dist || 1); uz = dz / (dist || 1); } else { ux = this.flowDir.x; uz = this.flowDir.z; }
        mvx = ux * d.speed; mvz = uz * d.speed;
        if (this.anim.curName !== d.run || this.anim.phase === 'e') this.run();
        break;
      }
      case 'attack': {
        const A = d.attack;
        face = A.back ? wrapPi(yawTo(dx, dz) + Math.PI) : yawTo(dx, dz);       // a tail strike: back to the player
        if (A.leap && this.t > this.atkT - 0.25) { mvx = dx / (dist || 1) * A.leap; mvz = dz / (dist || 1) * A.leap; }
        if (!this.struckP && this.atkT - this.t >= this.hitAt) {
          this.struckP = true;
          if (dist < reach + 1.2 && Math.abs(dy) < d.height + 1 && !P.dead) {
            P.hurt(A.damage * (sw.damageScale || 1), this.pos);
            if (A.knock) P.shove(dx / (dist || 1), dz / (dist || 1), A.knock);
          }
        }
        if (this.t <= 0) { this.state = 'chase'; this.cool = rnd(0.5, 1.3); sw.attackers = Math.max(0, sw.attackers - 1); this.attacking = false; }
        break;
      }
      case 'shoot': {
        face = yawTo(dx, dz);
        const R = d.ranged;
        if (!this.struckP && this.atkT - this.t >= R.releaseAt) { this.struckP = true; this.release(); }
        if (this.t <= 0) { this.state = 'chase'; this.shootCool = R.every * rnd(0.8, 1.3); }
        break;
      }
      case 'flinch': if (this.t <= 0) this.state = 'chase'; break;
      case 'dazed': {
        if (this.held > 0) this.held -= dt;
        if (this.t <= 0) { this.state = 'chase'; }
        else if (this.anim.cur && !this.anim.cur.isRunning()) this.anim.play(this.anim.pick(d.flinch, 'hit_reaction'), { loop: false, restart: true });
        break;
      }
      case 'burning': {
        this.panic += rnd(-3, 3) * dt;
        mvx = Math.cos(this.panic) * d.speed * 1.2; mvz = Math.sin(this.panic) * d.speed * 1.2;
        if (this.t <= 0) { this.state = 'chase'; }
        break;
      }
      case 'down': {
        if (this.onGround) {
          if (this.getUp === undefined) this.getUp = 0.5 + Math.random() * 0.4;
          this.getUp -= dt;
          if (this.getUp <= 0 && !this.rising) { this.rising = true; this.t = this.anim.duration(d.up) || 0.8; this.anim.play(d.up, { loop: false, restart: true }); }
          if (this.rising && this.t <= 0) { this.rising = false; this.getUp = undefined; this.state = 'chase'; }
        }
        break;
      }
      default: break;
    }
    if (this.attacking && this.state !== 'attack') { this.attacking = false; sw.attackers = Math.max(0, sw.attackers - 1); }

    // ---- move: wanted velocity + keeping apart, then walls and ground
    const moving = this.state === 'chase' || this.state === 'burning' || (this.state === 'attack' && d.attack.leap);
    if (this.onGround) {
      const k = Math.min(1, dt * 10);
      this.vel.x += (mvx - this.vel.x) * k; this.vel.z += (mvz - this.vel.z) * k;
    }
    if (this.state !== 'down') sw.separate(this, dt);
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (this.vault > 0) this.vault -= dt;                     // vaulting over what it was stuck on: no walls
    else if (col.pushOut(this.pos, Math.min(d.radius * 0.9, CFG.nav.maxBody), this.pos.y + 1.2, this.pos.y + Math.min(d.height, 4))) { this.bumped = true; if (!this.onGround) { this.vel.x *= 0.3; this.vel.z *= 0.3; } }
    const ground = col.groundAt(this.pos.x, this.pos.z, this.pos.y + 1.3);
    if (this.onGround) {
      if (ground >= this.pos.y - 1.6) this.pos.y = ground; else { this.onGround = false; this.vel.y = 0; }
    } else {
      this.vel.y -= GRAV * dt; this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground && this.vel.y <= 0) { this.pos.y = ground; this.onGround = true; this.vel.set(0, 0, 0); if (this.state === 'down') G.fx.dust(this.pos, 1.5, 2); }
    }
    if (this.pos.y < G.level.water - 3) { this.hp = 0; this.die({ kind: 'drown' }, v2.set(0, 0, 0)); this.actor.obj.visible = false; this.t = 0.1; return; }
    // Stuck against something while chasing? Looked at once a second: wanted to run but got nowhere.
    // 1st time: steer for the middle of the next cell of the path (no straight-at-the-player, no looking ahead);
    // after that: vault over whatever it is onto the path, two cells on.
    this.recenter -= dt;
    if (this.state === 'chase' && this.onGround) {
      this.probeT += dt;
      if (Math.hypot(mvx, mvz) < d.speed * 0.5) { this.probeT = 0; this.probeX = this.pos.x; this.probeZ = this.pos.z; this.stuckN = 0; }
      else if (this.probeT >= 1) {
        const adv = Math.hypot(this.pos.x - this.probeX, this.pos.z - this.probeZ), bumped = this.bumped;
        this.probeT = 0; this.probeX = this.pos.x; this.probeZ = this.pos.z; this.bumped = false;
        // (held up by the crowd around the player is not stuck: there, only when scenery was in the way)
        if (adv < d.speed * 0.2 && (bumped || dist > 30)) { this.stuckN++; this.flowT = 0; this.recenter = 1.5; if (this.stuckN >= 2) this.vaultOut(); } else this.stuckN = 0;
      }
    }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (face == null && moving && sp > 1) face = yawTo(this.vel.x, this.vel.z);
    if (face != null) this.yaw = wrapPi(this.yaw + Math.max(-9 * dt, Math.min(9 * dt, wrapPi(face - this.yaw))));
  }
  // jump onto the path: to the middle of the cell two steps further along it
  vaultOut(hops = 2, T = 0.42) {
    let nav = this.nav;
    let c = nav.nearest(this.pos.x, this.pos.z, null, 4);
    if ((c < 0 || nav.distAt(c) === Infinity) && nav !== this.sw.nav) { nav = this.sw.nav; c = nav.nearest(this.pos.x, this.pos.z, null, 4); }
    if (c < 0 || nav.distAt(c) === Infinity) return;
    for (let k = 0; k < hops; k++) { const nx = nav._next(c); if (nx < 0) break; c = nx; }
    const tx = nav.cx(c), tz = nav.cz(c), ty = nav.y[c];
    this.vel.set((tx - this.pos.x) / T, (ty - this.pos.y) / T + 0.5 * GRAV * T, (tz - this.pos.z) / T);
    this.onGround = false; this.vault = T; this.stuckN = 0; this.sw.vaults = (this.sw.vaults || 0) + 1; if (this.sw.vaultLog) this.sw.vaultLog.push([Math.round(this.pos.x), Math.round(this.pos.z), this.def.name]);
  }
  stepDead(dt) {
    const G = this.sw.g, col = G.level.collision;
    if (!this.onGround) {
      this.vel.y -= GRAV * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.tilt += this.spin * dt;
      col.pushOut(this.pos, 0.6, this.pos.y + 1, this.pos.y + 3);
      const ground = col.groundAt(this.pos.x, this.pos.z, this.pos.y + 1.5);
      if (this.pos.y <= ground && this.vel.y <= 0) {
        this.pos.y = ground; this.onGround = true; this.tilt = 0; this.spin = 0;
        G.fx.dust(this.pos, 2, 3);
        if (G.settings.blood) G.fx.bloodPool(this.pos, 3);
      }
    } else {
      this.vel.x *= Math.max(0, 1 - dt * 6); this.vel.z *= Math.max(0, 1 - dt * 6);
      this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
      if (this.t < 1.5) this.pos.y -= dt * 1.8;                    // sink away
    }
    if (this.burn > 0) { this.burn -= dt; if (Math.random() < dt * 8) G.fx.burn(this.pos, 0.8); }
    if (this.t <= 0) this.sw.release(this);
  }
  los() {
    const G = this.sw.g, P = G.player, d = this.def;
    return G.level.collision.clear(this.pos.x, this.pos.y + d.height * 0.8, this.pos.z, P.pos.x, P.pos.y + P.def.height * 0.6, P.pos.z);
  }
  startAttack(dist) {
    const d = this.def, A = d.attack, sw = this.sw;
    this.state = 'attack'; this.attacking = true; sw.attackers++;
    const clip = this.anim.pick(pick(A.clips), A.clips[0], 'all_strike_1');
    const ts = A.ts || 1;
    this.atkT = this.t = A.time; this.hitAt = A.hitAt / ts; this.struckP = false;
    this.anim.play(clip, { loop: false, restart: true, ts, fade: 0.08, cut: true });
    this.ride('ride_attack_front', false); this.rideT = A.time;
  }
  startShoot() {
    const d = this.def, R = d.ranged;
    this.state = 'shoot'; this.atkT = this.t = R.time; this.struckP = false;
    this.anim.play(this.anim.pick(R.clip, 'all_slingshot'), { loop: false, restart: true, fade: 0.1, cut: true });
  }
  release() {
    const G = this.sw.g, d = this.def, R = d.ranged, P = G.player;
    const from = this.actor.linkPos('HndR', new THREE.Vector3(), d.height * 0.8);
    // lead the target a little, lob it in an arc
    const tgt = new THREE.Vector3(P.pos.x, P.pos.y + P.def.height * 0.6, P.pos.z);
    const flat = Math.hypot(tgt.x - from.x, tgt.z - from.z);
    const time = flat / R.speed;
    tgt.x += P.vel.x * time * 0.6; tgt.z += P.vel.z * time * 0.6;
    const grav = 18;
    const vel = new THREE.Vector3((tgt.x - from.x) / time, (tgt.y - from.y) / time + 0.5 * grav * time, (tgt.z - from.z) / time);
    vel.x += rnd(-2, 2); vel.z += rnd(-2, 2);
    const tpl = this.sw.templates.get(R.projectile);
    G.projectiles.fire({ tpl, pos: from, vel, gravity: grav, life: 5, owner: 'enemy', radius: 0.4,
      onHit: (hit) => {
        if (R.splash) {
          // a fire bottle: bursts where it lands and burns whoever stands there
          const at = new THREE.Vector3(hit.x, hit.y, hit.z);
          G.fx.explosion(at, R.splash * 0.7); G.sfx('explode', 55, at, 1.5);
          const dd = Math.hypot(P.pos.x - hit.x, P.pos.z - hit.z);
          if (dd < R.splash && Math.abs(P.pos.y - hit.y) < 6) P.hurt(R.damage * (this.sw.damageScale || 1) * (1 - 0.5 * dd / R.splash), at);
        } else if (hit.kind === 'player') P.hurt(R.damage * (this.sw.damageScale || 1), this.pos); else G.fx.impact(hit, hit.n, 'stone');
      } });
  }
  // model placement and animation (every rendered frame; `dt` already includes skipped frames for far enemies)
  animate(dt) {
    const o = this.actor.obj;
    o.position.copy(this.pos);
    o.rotation.y = this.yaw;
    if (this.tilt || this.actor.model.rotation.x) { this.actor.model.rotation.x = -this.tilt; this.actor.model.position.y = this.tilt ? 2 : 0; }
    this.anim.update(dt);
    if (this.def.structure) return;
    const riders = this.actor.riders;
    if (riders && riders.length) {
      if (this.rideT > 0 && (this.rideT -= dt) <= 0 && this.alive) this.ride('ride_idle_0', true);
      for (const r of riders) r.update(dt);
    }
  }
}

export class Enemies {
  constructor(game) {
    this.g = game;
    this.list = [];                     // active (alive or bodies)
    this.pool = new Map();              // model -> spare actors
    this.templates = new Map();
    this.alive = 0; this.killed = 0; this.attackers = 0;
    this.grid = new Map(); this.frame = 0;
    this.marks = [];
  }
  async load(progress = () => {}) {
    const names = new Set();
    for (const d of Object.values(CFG.enemies)) {
      for (const m of d.models) names.add(m);
      for (const h of d.held) names.add(h[0]);
      for (const h of d.riders || []) names.add(h[0]);
      if (d.ranged) names.add(d.ranged.projectile);
    }
    const all = [...names];
    let n = 0;
    await Promise.all(all.map(async (m) => {
      try { this.templates.set(m, await loadActor(m)); } catch (e) { console.warn('enemy model missing', m, e); }
      progress(++n / all.length, 'Loading the Dustriders');
    }));
    // ring shown above enemies that can be executed
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.strokeStyle = '#ff5a3c'; g.lineWidth = 7; g.beginPath(); g.arc(32, 32, 22, 0, 6.283); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('E', 32, 34);
    this.markTex = new THREE.CanvasTexture(c);
    this.markMat = new THREE.SpriteMaterial({ map: this.markTex, depthTest: false, transparent: true });
  }
  // report animation clips the config names but the models don't have (for the tests)
  check() {
    const out = [];
    for (const [type, d] of Object.entries(CFG.enemies)) {
      for (const m of d.models) {
        const t = this.templates.get(m);
        if (!t) { out.push(`${type}: model ${m} missing`); continue; }
        const has = new Set(t.clips.map((c) => c.name.toLowerCase()));
        if (d.structure) continue;
        const want = [d.run, d.idle, ...d.attack.clips, ...d.die, d.knock, d.up, d.flinch, d.taunt, d.ranged && d.ranged.clip].filter(Boolean);
        for (const w of want) if (!has.has(w.toLowerCase())) out.push(`${type}/${m}: no clip ${w}`);
      }
    }
    return out;
  }

  spawn(type, x, y, z, yaw = null) {
    const def = CFG.enemies[type];
    if (!def) return null;
    const model = pick(def.models);
    const tpl = this.templates.get(model);
    if (!tpl) return null;
    let free = this.pool.get(model);
    if (!free) this.pool.set(model, free = []);
    let actor = free.pop();
    if (!actor) {
      actor = new Actor(tpl, { cullRadius: def.height * 1.3 });
      for (const [gfx, link] of def.held) { const ht = this.templates.get(gfx); if (ht) actor.attach(link, ht); }
      // riders sit on their links and have their own animation
      actor.riders = [];
      for (const [gfx, link] of def.riders || []) {
        const rt = this.templates.get(gfx), obj = rt && actor.attach(link, rt);
        if (obj) actor.riders.push(new AnimCtl(obj, rt.clips));
      }
      actor.modelName = model;
      this.g.scene.add(actor.obj);
    }
    const e = new Enemy(this, type, def);
    e.init(actor, tpl, x, y, z, yaw);
    this.list.push(e);
    this.alive++;
    return e;
  }
  release(e) {
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    e.actor.obj.visible = false;
    e.setTint(null);
    this.pool.get(e.actor.modelName).push(e.actor);
  }
  // take a living enemy out of the game without a kill; the mission may send a replacement
  recycle(e) {
    if (e.attacking) this.attackers = Math.max(0, this.attackers - 1);
    e.alive = false; this.alive--;
    this.release(e);
    const M = this.g.mission;
    if (M.spawned > 0) M.spawned--;
  }
  clear() { for (const e of this.list.slice()) this.release(e); this.alive = 0; this.attackers = 0; }

  step(dt) {
    // neighbours
    this.grid.clear();
    for (const e of this.list) {
      if (!e.alive) continue;
      const k = (Math.floor(e.pos.x / 4) << 16) ^ (Math.floor(e.pos.z / 4) & 0xffff);
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, a = []);
      a.push(e);
    }
    this.big = 0;
    for (const e of this.list) if (e.alive && e.nav === this.navBig && !e.def.structure) this.big++;
    for (let i = this.list.length - 1; i >= 0; i--) this.list[i].step(dt);
  }
  separate(e, dt) {
    const cx = Math.floor(e.pos.x / 4), cz = Math.floor(e.pos.z / 4), k = CFG.swarm.separation;
    for (let j = cz - 1; j <= cz + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
      const a = this.grid.get((i << 16) ^ (j & 0xffff));
      if (!a) continue;
      for (const o of a) {
        if (o === e) continue;
        const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, r = e.def.radius + o.def.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), push = (r - d) / r * k * (o.def.heavy && !e.def.heavy ? 3 : 1);
        e.pos.x += dx / d * push * dt * 8; e.pos.z += dz / d * push * dt * 8;
      }
    }
    // not inside the player either
    const P = this.g.player, dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, r = e.def.radius + P.def.radius * 0.9;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-6 && Math.abs(e.pos.y - P.pos.y) < 4) { const d = Math.sqrt(d2); e.pos.x += dx / d * (r - d) * 0.5; e.pos.z += dz / d * (r - d) * 0.5; }
  }
  animate(dt, camera) {
    this.frame++;
    const cp = camera.position;
    let m = 0;
    for (const e of this.list) {
      // far enemies animate every 2nd / 4th frame
      const d2 = e.pos.distanceToSquared(cp);
      const every = d2 > 170 * 170 ? 4 : d2 > 90 * 90 ? 2 : 1;
      e.acc = (e.acc || 0) + dt;
      if ((this.frame + e.frame) % every === 0) { e.animate(e.acc); e.acc = 0; } else { e.actor.obj.position.copy(e.pos); e.actor.obj.rotation.y = e.yaw; }
      // execution marker
      if (e.alive && e.state === 'dazed' && e.held <= 0) {
        let s = this.marks[m];
        if (!s) { s = this.marks[m] = new THREE.Sprite(this.markMat); s.renderOrder = 50; this.g.scene.add(s); }
        s.visible = true;
        s.position.set(e.pos.x, e.pos.y + e.def.height + 1.2, e.pos.z);
        const sc = (1.6 + 0.25 * Math.sin(performance.now() / 90)) * Math.max(1, Math.sqrt(d2) / 22);
        s.scale.set(sc, sc, 1);
        m++;
      }
    }
    for (; m < this.marks.length; m++) this.marks[m].visible = false;
  }

  // ---------------------------------------------------------------- queries
  // first enemy hit by a ray: {enemy, t, head}. Enemies are upright capsules (radius, height).
  raycast(o, d, max, pad = 0, skip = null) {
    let best = null, bt = max;
    const dl = d.x * d.x + d.z * d.z;
    for (const e of this.list) {
      if (!e.alive || (skip && skip.has(e))) continue;
      const r = e.def.radius + pad, h = e.def.height;
      const px = e.pos.x - o.x, pz = e.pos.z - o.z;
      // nearest point of the ray to the enemy's axis (in plan), clamped to the ray
      let t = dl > 1e-6 ? (px * d.x + pz * d.z) / dl : 0;
      if (t < 0 || t - r > bt) continue;
      const x = o.x + d.x * t - e.pos.x, z = o.z + d.z * t - e.pos.z;
      const off2 = x * x + z * z;
      if (off2 > r * r) continue;
      // step back to where the ray enters the cylinder
      const back = dl > 1e-6 ? Math.sqrt((r * r - off2) / dl) : 0;
      const tin = Math.max(0, t - back);
      const y = o.y + d.y * tin;
      const y2 = o.y + d.y * Math.min(max, t + back);
      const lo = e.pos.y - 0.2, hi = e.pos.y + h + 0.3;
      if ((y < lo && y2 < lo) || (y > hi && y2 > hi)) continue;
      if (tin < bt) { bt = tin; best = { enemy: e, t: tin, head: Math.max(y, y2) > e.pos.y + h * 0.8 && Math.min(y, y2) > e.pos.y + h * 0.62 }; }
    }
    return best;
  }
  // the player against the structures (tents, totems): pushes p out of them
  collide(p, r) {
    for (const e of this.list) {
      if (!e.alive || !e.def.structure || !e.def.solid) continue;
      const dx = p.x - e.pos.x, dz = p.z - e.pos.z, rr = e.def.solid + r, d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-6 || p.y > e.pos.y + e.def.height) continue;
      const d = Math.sqrt(d2);
      p.x += dx / d * (rr - d); p.z += dz / d * (rr - d);
    }
  }
  inRadius(p, r) {
    const out = [];
    for (const e of this.list) {
      if (!e.alive) continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, rr = r + e.def.radius;
      if (dx * dx + dz * dz < rr * rr && Math.abs(e.pos.y - p.y) < r + e.def.height) out.push(e);
    }
    return out;
  }
  // flat: ignore height differences up to a body's height (melee)
  inCone(o, dir, range, cos, flat = false) {
    const out = [];
    for (const e of this.list) {
      if (!e.alive) continue;
      let dx = e.pos.x - o.x, dy = e.pos.y + e.def.height * 0.5 - o.y, dz = e.pos.z - o.z;
      if (flat) { if (Math.abs(dy) > e.def.height + 3) continue; dy = 0; }
      const d = Math.hypot(dx, dy, dz);
      if (d > range + e.def.radius) continue;
      const fl = flat ? Math.hypot(dir.x, dir.z) || 1 : 1;
      // wide bodies count from their edge: widen the cone for near, big targets
      const c = d < 1e-3 ? 1 : (dx * dir.x + dy * (flat ? 0 : dir.y) + dz * dir.z) / (d * fl);
      const widen = Math.min(0.5, e.def.radius / Math.max(d, 0.5));
      if (c >= cos - widen) out.push(e);
    }
    return out;
  }
  executable(p, f, range) {
    let best = null, bs = -Infinity;
    for (const e of this.list) {
      if (!e.alive || e.state !== 'dazed' || e.held > 0) continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d > range + e.def.radius || Math.abs(e.pos.y - p.y) > 5) continue;
      const s = (dx * f.x + dz * f.z) / (d || 1) - d * 0.05;
      if (s > bs && s > -0.2) { bs = s; best = e; }
    }
    return best;
  }
}
