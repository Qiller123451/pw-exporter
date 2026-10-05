// The player's side: SEAS soldiers who fight alongside (missions with CFG.allies.count > 0).
//
// They are not an escort that waits for orders - they are the assault. Every soldier
//   * heads for a place a little ahead of the player on the way to the objective (the "front"), along the same
//     flow field the Dustriders use when the way is not a straight line;
//   * stops and fires at the nearest enemy he can see within his weapon's range (riflemen, marksmen, rocket men,
//     flamethrowers, walkers - the classes are data: CFG.allies.types);
//   * is hunted by the Dustriders exactly like the player (enemies.js picks whoever is nearer), can be hit by
//     spears, arrows and fire bottles, and dies.
// Losses are replaced: every few seconds a group of reinforcements arrives from behind (from where the assault came
// from), running to the front - so the stream of troops never stops, but the line only moves when the player pushes.
// Nothing the player does can hurt them (bullets, rockets, the bombardment and the Executioner's blast only ever
// look for enemies), and they cannot hurt the player.
//
// An ally has the same shape as the player where the enemies need it: pos, vel, def {radius, height}, dead,
// hurt(amount, from), shove(dx, dz, speed).
import * as THREE from 'three';
import { CFG } from './config.js';
import { Actor, AnimCtl, loadActor, addAddon, yawTo, wrapPi } from './actors.js';

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const GRAV = 40;

class Ally {
  constructor(sys, type, def) {
    this.sys = sys; this.type = type; this.def = def; this.ally = true;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.flow = new THREE.Vector3();
    this.yaw = 0; this.alive = false;
  }
  get dead() { return !this.alive; }
  init(actor, tpl, x, y, z) {
    const d = this.def, G = this.sys.g;
    this.actor = actor; this.tpl = tpl;
    this.anim = actor.animCtl || (actor.animCtl = new AnimCtl(actor.model, tpl.clips));
    this.anim.setEvents(null, null);
    this.pos.set(x, y, z); this.vel.set(0, 0, 0);
    this.hp = this.maxHp = d.health;
    this.alive = true; this.state = 'move'; this.t = 0; this.onGround = true;
    this.target = null; this.lookT = Math.random() * 0.4; this.shotT = rnd(0.2, 1); this.burst = 0;
    this.flowT = 0; this.direct = false; this.lostT = 0; this.stuckT = 0; this.px = x; this.pz = z; this.vault = 0;
    // his own place in the line: an offset from the front point
    const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * CFG.allies.spread;
    this.ox = Math.cos(a) * r; this.oz = Math.sin(a) * r;
    this.yaw = yawTo(G.player.pos.x - x, G.player.pos.z - z);
    this.frame = Math.floor(Math.random() * 4); this.acc = 0;
    actor.obj.position.copy(this.pos); actor.obj.rotation.set(0, this.yaw, 0); actor.obj.visible = true;
    actor.model.rotation.set(0, 0, 0); actor.model.position.set(0, 0, 0); actor.model.scale.setScalar(d.scale || 1);
    this.play(d.run, { ts: d.speed / d.runSpeed });
    for (const r2 of actor.riders || []) { const c = r2.pick('balista_stand', 'ride_idle_0', 'standanim'); if (c) r2.play(c, { loop: true }); }
  }
  play(name, o = {}) {
    const c = this.anim.pick(name, 'standanim');
    if (c) this.anim.play(c, { cut: true, fade: 0.12, ...o });
  }

  // ---------------------------------------------------------------- being hit
  hurt(amount, from = null) {
    if (!this.alive) return;
    const G = this.sys.g, d = this.def;
    this.hp -= amount * (CFG.allies.damageTaken || 1);
    if (G.settings.blood && !d.machine) G.fx.blood(v1.copy(this.pos).setY(this.pos.y + d.height * 0.6), from ? v2.set(this.pos.x - from.x, 0, this.pos.z - from.z).normalize() : v2.set(0, 0, 0), 3, 0.8);
    else if (d.machine) G.fx.sparks(v1.copy(this.pos).setY(this.pos.y + d.height * 0.6), 4, 10);
    if (this.hp <= 0) this.die();
  }
  shove(dx, dz, speed) { if (!this.def.heavy) { this.vel.x += dx * speed * 0.6; this.vel.z += dz * speed * 0.6; } }
  die() {
    const G = this.sys.g, d = this.def;
    this.alive = false; this.state = 'dead'; this.t = CFG.allies.corpseTime; this.target = null;
    this.sys.alive--; this.sys.lost++;
    this.anim.play(this.anim.pick(pick(d.die), 'dying'), { loop: false, restart: true, fade: 0.08 });
    if (d.machine) { G.fx.explosion(v1.copy(this.pos).setY(this.pos.y + d.height * 0.4), 5); G.sfx('explode', 60, this.pos, 1.2); }
    else if (Math.random() < 0.5) G.sfx('allyDeath', 50, this.pos, 0.95 + Math.random() * 0.1);
    if (G.settings.blood && !d.machine) G.fx.bloodPool(this.pos, 3);
  }

  // ---------------------------------------------------------------- one simulation step
  step(dt) {
    const sys = this.sys, G = sys.g, d = this.def, col = G.level.collision, P = G.player, A = CFG.allies;
    this.t -= dt;
    if (this.state === 'dead') {
      if (this.t < 1.5) this.pos.y -= dt * 1.8;
      if (this.t <= 0) sys.release(this);
      return;
    }
    // ---- who to shoot at: the nearest enemy in range that can be seen (looked for a few times a second)
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 0.35 + Math.random() * 0.2;
      this.target = this.findTarget();
    }
    let T = this.target;
    if (T && !T.alive) T = this.target = null;
    let mvx = 0, mvz = 0, face = null;
    const W = d.weapon;
    if (T) {
      const dx = T.pos.x - this.pos.x, dz = T.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
      face = yawTo(dx, dz);
      if (W.kind === 'melee') {
        // close combat: run at it, swing when it is in reach (the swing hits everything in its arc)
        const reach = W.reach + T.def.radius + d.radius;
        this.shotT -= dt;
        if (this.swing && (this.swing.t -= dt) <= 0) {
          this.swing = null;
          const dir = v3.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
          if (W.sounds) G.sfx(pick(W.sounds), W.volume || 40, this.pos, 1.1);
          for (const e of G.enemies.inCone(v1.copy(this.pos).setY(this.pos.y + d.height * 0.5), dir, reach + 1, Math.cos(W.arc * Math.PI / 360), true)) {
            if (e.locked) continue;
            e.damage(W.damage * (e.def.structure ? W.vsStructure ?? 1 : 1), { kind: 'melee', from: this.pos, ally: true, heavy: true, knock: W.knock || 0 });
          }
        }
        if (this.shotT > W.time * 0.35) { /* in the middle of a swing: stand */ }
        else if (dist > reach) { mvx = dx / dist * d.speed; mvz = dz / dist * d.speed; this.play(d.run, { ts: d.speed / d.runSpeed }); }
        else if (this.shotT <= 0) { this.shotT = W.time; this.swing = { t: W.hitAt }; this.anim.play(this.anim.pick(pick(W.clips), W.clip), { loop: false, restart: true, fade: 0.08, cut: true }); }
      } else {
      // too close for comfort: back off while firing (not the flamethrowers and the walkers)
      if (W.keep && dist < W.keep && !T.def.structure) { mvx = -dx / (dist || 1) * d.speed * 0.6; mvz = -dz / (dist || 1) * d.speed * 0.6; this.play(d.run, { ts: 0.6 * d.speed / d.runSpeed }); }
      else this.play(W.clip, { loop: true });
      // a machine that has to set itself up first (the Black Widow curls up before it fires)
      if (!this.aiming) { this.aiming = true; if (W.setup) this.shotT = Math.max(this.shotT, W.setup); }
      this.shotT -= dt;
      if (this.shotT <= 0 && Math.abs(wrapPi(face - this.yaw)) < 0.5) this.fire(T, dist);
      }
    } else {
      this.aiming = false; this.swing = null;
      // ---- to the front: a little ahead of the player towards the objective, each at his own place in the line
      const M = G.mission;
      let gx = M.goalPos[0] - P.pos.x, gz = M.goalPos[1] - P.pos.z;
      const gl = Math.hypot(gx, gz);
      if (gl > 18) { gx /= gl; gz /= gl; } else { gx = 0; gz = 0; }
      const lead = Math.min(d.lead ?? A.lead, Math.max(0, gl - 10));          // (a type may push further ahead: `lead`)
      const tx = P.pos.x + gx * lead + this.ox, tz = P.pos.z + gz * lead + this.oz;
      const dx = tx - this.pos.x, dz = tz - this.pos.z, dist = Math.hypot(dx, dz);
      if (dist > (this.state === 'hold' ? A.slack * 2 : A.slack)) {
        this.state = 'move';
        this.flowT -= dt;
        if (this.flowT <= 0) {
          this.flowT = 0.25 + Math.random() * 0.15;
          const left = sys.nav.dir(this.pos.x, this.pos.z, this.flow, 3);
          const none = left === Infinity || (this.flow.x === 0 && this.flow.z === 0);
          this.direct = none || (dist < 30 && Math.abs(P.pos.y - this.pos.y) < 4 && col.clear(this.pos.x, this.pos.y + 2, this.pos.z, tx, this.pos.y + 2, tz));
          // cut off from the player for good (he jumped somewhere the others cannot follow): come in again from behind
          this.lostT = left === Infinity && dist > 70 ? this.lostT + 0.3 : 0;
          if (this.lostT > 5 && !G.mission.seen(this.pos.x, this.pos.y, this.pos.z)) { sys.recycle(this); return; }
        }
        const far = dist > 45 ? 1.3 : 1;                           // the ones behind run to catch up
        if (this.direct) { mvx = dx / dist * d.speed * far; mvz = dz / dist * d.speed * far; } else { mvx = this.flow.x * d.speed * far; mvz = this.flow.z * d.speed * far; }
        this.play(d.run, { ts: far * d.speed / d.runSpeed });
      } else { this.state = 'hold'; this.play(d.idle, { loop: true }); face = gl > 18 ? yawTo(gx, gz) : null; }
    }

    // ---- move: wanted velocity, keeping apart, walls and ground
    if (this.onGround) { const k = Math.min(1, dt * 10); this.vel.x += (mvx - this.vel.x) * k; this.vel.z += (mvz - this.vel.z) * k; }
    sys.separate(this, dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (this.vault > 0) this.vault -= dt;
    else col.pushOut(this.pos, Math.min(d.radius * 0.9, CFG.nav.maxBody), this.pos.y + 1.2, this.pos.y + Math.min(d.height, 4));
    const ground = col.groundAt(this.pos.x, this.pos.z, this.pos.y + 1.3);
    if (this.onGround) {
      if (ground >= this.pos.y - 1.6) this.pos.y = ground; else { this.onGround = false; this.vel.y = 0; }
    } else {
      this.vel.y -= GRAV * dt; this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground && this.vel.y <= 0) { this.pos.y = ground; this.onGround = true; this.vel.set(0, 0, 0); }
    }
    if (this.pos.y < G.level.water - 3) { sys.recycle(this); return; }
    // stuck on something on the way: hop onto the path (as the Dustriders do)
    if (this.state === 'move' && !T && this.onGround) {
      this.stuckT += dt;
      if (this.stuckT >= 1.2) {
        if (Math.hypot(this.pos.x - this.px, this.pos.z - this.pz) < d.speed * 0.25) this.hop();
        this.stuckT = 0; this.px = this.pos.x; this.pz = this.pos.z;
      }
    } else { this.stuckT = 0; this.px = this.pos.x; this.pz = this.pos.z; }
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (face == null && sp > 1) face = yawTo(this.vel.x, this.vel.z);
    if (face != null) this.yaw = wrapPi(this.yaw + Math.max(-8 * dt, Math.min(8 * dt, wrapPi(face - this.yaw))));
  }
  hop() {
    const nav = this.sys.nav;
    let c = nav.nearest(this.pos.x, this.pos.z, null, 4);
    if (c < 0 || nav.distAt(c) === Infinity) return;
    for (let k = 0; k < 2; k++) { const nx = nav._next(c); if (nx < 0) break; c = nx; }
    const T = 0.42, tx = nav.cx(c), tz = nav.cz(c), ty = nav.y[c];
    this.vel.set((tx - this.pos.x) / T, (ty - this.pos.y) / T + 0.5 * GRAV * T, (tz - this.pos.z) / T);
    this.onGround = false; this.vault = T;
  }
  findTarget() {
    const G = this.sys.g, d = this.def, W = d.weapon, col = G.level.collision;
    let best = null, bs = Infinity;
    const ey = this.pos.y + d.height * 0.8;
    for (const e of G.enemies.list) {
      if (!e.alive || e.locked) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
      if (dist > W.range || (W.min && dist < W.min) || Math.abs(e.pos.y - this.pos.y) > 25) continue;
      // living things first, the one already aimed at a little preferred
      // (the siege machines go for the towers first)
      const s = dist + (e.def.structure ? (W.prefers === 'structure' ? -60 : 40) : 0) - (e === this.target ? 6 : 0);
      if (s >= bs) continue;
      if (!col.clear(this.pos.x, ey, this.pos.z, e.pos.x, e.pos.y + e.def.height * 0.6, e.pos.z)) continue;
      bs = s; best = e;
    }
    return best;
  }
  // one shot (or one burst round) at the target
  fire(T, dist) {
    const G = this.sys.g, d = this.def, W = d.weapon;
    const from = this.actor.addon ? this.actor.addon.muzzle(v1) : this.actor.linkPos(W.link || 'HndR', v1, d.height * 0.75);
    if (this.actor.addon) this.actor.addon.fire();
    if (W.forward) { from.x -= Math.sin(this.yaw) * W.forward; from.z -= Math.cos(this.yaw) * W.forward; }
    const to = v2.set(T.pos.x + rnd(-0.4, 0.4), T.pos.y + T.def.height * rnd(0.4, 0.75), T.pos.z + rnd(-0.4, 0.4));
    const info = { kind: W.kind === 'flame' ? 'fire' : 'bullet', from: this.pos, ally: true, knock: W.knock || 0, burn: W.burn, burnDps: W.burnDps };
    if (W.kind === 'bullet') {
      // bursts: `burst` rounds `1 / rate` apart, then a pause
      if (this.burst <= 0) this.burst = W.burst || 1;
      this.burst--;
      this.shotT = this.burst > 0 ? 1 / W.rate : W.pause * rnd(0.7, 1.3);
      const hit = Math.random() < (W.accuracy ?? 0.7);
      if (!hit) { to.x += rnd(-2.5, 2.5); to.y += rnd(0, 2.5); to.z += rnd(-2.5, 2.5); }
      G.fx.tracer(from, to, W.tracer || 0xffd27a, 0.07);
      G.fx.muzzle(from, v3.copy(to).sub(from).normalize(), 0.7);
      if (hit) T.damage(W.damage * (T.def.structure ? W.vsStructure ?? 1 : 1), { ...info, point: to.clone(), dir: v3.clone() });
      if (W.sounds && this.sys.soundT <= 0) { this.sys.soundT = 0.07; G.sfx(pick(W.sounds), W.volume || 35, this.pos, 0.95 + Math.random() * 0.1); }
    } else if (W.kind === 'rocket') {
      this.shotT = W.pause * rnd(0.8, 1.25);
      const dir = to.sub(from).normalize();
      this.play(W.clip, { loop: true, restart: true, fade: 0.05 });
      G.fx.muzzle(from, dir, 1.6);
      G.sfx(pick(W.sounds), W.volume || 50, this.pos);
      G.projectiles.fire({ tpl: this.sys.templates.get(W.projectile), pos: from, vel: dir.multiplyScalar(W.speed), life: 4, owner: 'player', radius: 0.5,
        trail: (p) => G.fx.rocketTrail(p.pos),
        onHit: (h) => this.sys.blast(new THREE.Vector3(h.x, h.y, h.z), W.radius, W.damage, W.knock || 20, W.vsStructure ?? 1) });
    } else if (W.kind === 'flame') {
      this.shotT = 1 / W.rate;
      const dir = v3.copy(to).sub(from).normalize();
      G.fx.flame(from, v2.copy(dir).multiplyScalar(W.range * (1.2 + Math.random())), 1);
      for (const e of G.enemies.inCone(from, dir, W.range, Math.cos(W.cone * Math.PI / 180))) e.damage(W.damage * (e.def.structure ? W.vsStructure ?? 1 : 1), info);
      if (W.sounds && this.sys.flameT <= 0) { this.sys.flameT = 0.55; G.sfx(pick(W.sounds), W.volume || 40, this.pos); }
    }
  }
  animate(dt) {
    const o = this.actor.obj;
    o.position.copy(this.pos); o.rotation.y = this.yaw;
    this.anim.update(dt);
    for (const r of this.actor.riders || []) r.update(dt);
    if (this.actor.addon) this.actor.addon.update(dt);
  }
}

export class Allies {
  constructor(game) {
    this.g = game;
    this.list = []; this.pool = new Map(); this.templates = new Map();
    this.alive = 0; this.lost = 0; this.sent = 0; this.timer = 2; this.want = CFG.allies.count; this.soundT = 0; this.flameT = 0; this.frame = 0;
    this.nav = game.nav;
    this.special = new Set();           // special types that have arrived (CFG.allies.special)
  }
  // A special unit joins the assault (objective.arrive = its type): `first` of them come at once, at `at`; from
  // then on every group of reinforcements brings `perWave` more, up to `max` alive.
  arrive(type, at = null, quiet = false) {
    const S = (CFG.allies.special || {})[type];
    if (!S || this.special.has(type)) return;
    this.special.add(type);
    const n = this.reinforce(S.first, at, type);
    if (!quiet && S.note) this.g.hud.note(S.note);
    this.g.log.add('TROOPS', `${n} x ${type} arrived`);
  }
  async load(progress = () => {}) {
    const names = new Set();
    for (const d of Object.values(CFG.allies.types)) {
      for (const m of d.models) names.add(m);
      for (const h of d.held || []) names.add(h[0]);
      for (const h of d.riders || []) names.add(h[0]);
      for (const A of [].concat(d.addon || [])) { names.add(A.model); for (const c of A.crew || []) names.add(c[0]); }
      if (d.weapon.projectile) names.add(d.weapon.projectile);
    }
    const all = [...names];
    let n = 0;
    await Promise.all(all.map(async (m) => {
      try { this.templates.set(m, await loadActor(m)); } catch (e) { console.warn('ally model missing', m, e); }
      progress(++n / all.length, 'Loading the SEAS troops');
    }));
  }
  // clips the config names but the models do not have (tests)
  check() {
    const out = [];
    for (const [type, d] of Object.entries(CFG.allies.types)) for (const m of d.models) {
      const t = this.templates.get(m);
      if (!t) { out.push(`${type}: model ${m} missing`); continue; }
      const has = new Set(t.clips.map((c) => c.name.toLowerCase().split('#')[0]));
      for (const w of [d.run, d.idle, d.weapon.clip, ...d.die]) if (w && !has.has(w.toLowerCase())) out.push(`${type}/${m}: no clip ${w}`);
    }
    return out;
  }
  spawn(type, x, y, z) {
    const def = CFG.allies.types[type];
    if (!def) return null;
    const model = pick(def.models), tpl = this.templates.get(model);
    if (!tpl) return null;
    let free = this.pool.get(model);
    if (!free) this.pool.set(model, free = []);
    let actor = free.pop();
    if (!actor) {
      actor = new Actor(tpl, { cullRadius: def.height * 1.3 });
      for (const [gfx, link] of def.held || []) { const ht = this.templates.get(gfx); if (ht) actor.attach(link, ht); }
      actor.riders = [];
      for (const [gfx, link] of def.riders || []) { const rt = this.templates.get(gfx), obj = rt && actor.attach(link, rt); if (obj) actor.riders.push(new AnimCtl(obj, rt.clips)); }
      if (def.addon) actor.addon = addAddon(actor, def.addon, this.templates);
      actor.modelName = model;
      this.g.scene.add(actor.obj);
    }
    const a = new Ally(this, type, def);
    a.init(actor, tpl, x, y, z);
    this.list.push(a); this.alive++;
    return a;
  }
  release(a) {
    const i = this.list.indexOf(a);
    if (i >= 0) this.list.splice(i, 1);
    a.actor.obj.visible = false;
    this.pool.get(a.actor.modelName).push(a.actor);
  }
  // take a living one out without a death (lost his way): a replacement comes with the next group
  recycle(a) { a.alive = false; this.alive--; this.release(a); }

  // a rocket of our own side: enemies only
  blast(pos, radius, damage, knock, vsStructure = 1) {
    const G = this.g;
    G.fx.explosion(pos, radius);
    G.sfx('explode', 70, pos, 1 + Math.random() * 0.2);
    for (const e of G.enemies.inRadius(pos, radius)) {
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z), f = 1 - 0.6 * Math.min(1, d / radius);
      e.damage(damage * (e.def.structure ? vsStructure : f), { kind: 'explosion', from: pos, knock: knock * f, ally: true, heavy: true });
    }
  }

  // ---------------------------------------------------------------- reinforcements
  // a group of n at one place: behind the player (further from the objective than he is), out of sight if possible
  reinforce(n, at = null, only = null) {
    const G = this.g, nav = this.nav, A = CFG.allies, P = G.player, M = G.mission;
    let anchor = -1;
    if (at) anchor = nav.nearest(at[0], at[1], null, 8);
    else {
      const pd = Math.hypot(P.pos.x - M.goalPos[0], P.pos.z - M.goalPos[1]);
      const behind = (c) => Math.hypot(nav.cx(c) - M.goalPos[0], nav.cz(c) - M.goalPos[1]) > pd + 15;
      const open = (c) => !G.zones || G.zones.zone[c] <= G.zones.open;
      anchor = nav.pickAtDistance(A.spawnMin, A.spawnMax, 60, (c) => open(c) && behind(c) && !M.seen(nav.cx(c), nav.y[c], nav.cz(c)));
      if (anchor < 0) anchor = nav.pickAtDistance(A.spawnMin, A.spawnMax, 60, (c) => open(c) && behind(c));
      if (anchor < 0) anchor = nav.pickAtDistance(A.spawnMin * 0.6, A.spawnMax, 60, (c) => open(c) && !M.seen(nav.cx(c), nav.y[c], nav.cz(c)));
    }
    if (anchor < 0) return 0;
    const ai = anchor % nav.n, aj = Math.floor(anchor / nav.n);
    let made = 0;
    for (let k = 0; k < n * 8 && made < n; k++) {
      const i = ai + Math.round(rnd(-4, 4)), j = aj + Math.round(rnd(-4, 4));
      if (i < 0 || j < 0 || i >= nav.n || j >= nav.n) continue;
      const c = j * nav.n + i;
      if (!nav.walkable(c)) continue;
      // one of the heavy ones now and then, never more than `heavyMax` at a time
      let type = only || this.pickType();
      if (!only) {
        // the special units that have arrived: `perWave` of them with every group
        let sp = null;
        for (const t of this.special) { const S = A.special[t]; if (made < S.perWave && this.count(t) < S.max) sp = t; }
        if (sp) type = sp;
        else if (CFG.allies.types[type].heavy && this.list.filter((a) => a.alive && a.def.heavy && !this.special.has(a.type)).length >= A.heavyMax) type = A.basic;
      }
      // (the wide ones only where there is room for them)
      if (CFG.allies.types[type].radius > CFG.nav.bigRadius && G.navBig && !G.navBig.walkable(c)) continue;
      if (this.spawn(type, nav.cx(c) + rnd(-0.5, 0.5), nav.y[c], nav.cz(c) + rnd(-0.5, 0.5))) { made++; this.sent++; }
    }
    return made;
  }
  count(type) { let n = 0; for (const a of this.list) if (a.alive && a.type === type) n++; return n; }
  pickType() {
    const mix = CFG.allies.mix;
    let total = 0;
    for (const k in mix) total += mix[k];
    let r = Math.random() * total;
    for (const k in mix) { r -= mix[k]; if (r <= 0) return k; }
    return CFG.allies.basic;
  }

  step(dt) {
    const G = this.g, A = CFG.allies;
    this.soundT -= dt; this.flameT -= dt;
    // the objective may ask for more or fewer troops
    const o = G.mission.obj;
    this.want = o && o.allies != null ? o.allies : A.count;
    this.timer -= dt;
    if (this.timer <= 0 && !G.player.dead) {
      this.timer = A.every;
      const n = Math.min(A.group, this.want - this.alive);
      if (n > 0) this.reinforce(n);
    }
    for (let i = this.list.length - 1; i >= 0; i--) this.list[i].step(dt);
  }
  // keep apart from each other and from the player
  separate(a, dt) {
    const P = this.g.player;
    for (const o of this.list) {
      if (o === a || !o.alive) continue;
      const dx = a.pos.x - o.pos.x, dz = a.pos.z - o.pos.z, r = a.def.radius + o.def.radius + 0.6, d2 = dx * dx + dz * dz;
      if (d2 >= r * r || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), push = (r - d) / r * 2 * (o.def.heavy && !a.def.heavy ? 3 : 1);
      a.pos.x += dx / d * push * dt * 8; a.pos.z += dz / d * push * dt * 8;
    }
    if (!(a.vault > 0)) for (const o of this.g.enemies.solids || []) this.g.enemies.pushFrom(o, a.pos, a.def.radius * 0.6);
    const dx = a.pos.x - P.pos.x, dz = a.pos.z - P.pos.z, r = a.def.radius + P.def.radius + 0.4, d2 = dx * dx + dz * dz;
    if (d2 < r * r && d2 > 1e-6 && Math.abs(a.pos.y - P.pos.y) < 4) { const d = Math.sqrt(d2); a.pos.x += dx / d * (r - d) * 0.5; a.pos.z += dz / d * (r - d) * 0.5; }
  }
  animate(dt, camera) {
    this.frame++;
    const cp = camera.position;
    for (const a of this.list) {
      const d2 = a.pos.distanceToSquared(cp);
      const every = d2 > 170 * 170 ? 4 : d2 > 90 * 90 ? 2 : 1;
      a.acc += dt;
      if ((this.frame + a.frame) % every === 0) { a.animate(a.acc); a.acc = 0; } else { a.actor.obj.position.copy(a.pos); a.actor.obj.rotation.y = a.yaw; }
    }
  }

  // ---------------------------------------------------------------- queries (for the enemies)
  // the nearest living ally within r of a point
  nearest(p, r) {
    let best = null, bd = r * r;
    for (const a of this.list) {
      if (!a.alive) continue;
      const dx = a.pos.x - p.x, dz = a.pos.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 < bd && Math.abs(a.pos.y - p.y) < 12) { bd = d2; best = a; }
    }
    return best;
  }
  // first ally hit by a ray (upright capsules): {ally, t} or null
  rayHit(o, d, max, pad = 0) {
    let best = null, bt = max;
    const dl = d.x * d.x + d.z * d.z;
    for (const a of this.list) {
      if (!a.alive) continue;
      const r = a.def.radius + pad, px = a.pos.x - o.x, pz = a.pos.z - o.z;
      const t = dl > 1e-6 ? (px * d.x + pz * d.z) / dl : 0;
      if (t < 0 || t - r > bt) continue;
      const x = o.x + d.x * t - a.pos.x, z = o.z + d.z * t - a.pos.z;
      if (x * x + z * z > r * r) continue;
      const y = o.y + d.y * t;
      if (y < a.pos.y - 0.2 || y > a.pos.y + a.def.height + 0.3) continue;
      if (t < bt) { bt = t; best = { ally: a, t: Math.max(0, t) }; }
    }
    return best;
  }
  inRadius(p, r) {
    const out = [];
    for (const a of this.list) { if (!a.alive) continue; const dx = a.pos.x - p.x, dz = a.pos.z - p.z; if (dx * dx + dz * dz < r * r && Math.abs(a.pos.y - p.y) < r + 4) out.push(a); }
    return out;
  }
}
