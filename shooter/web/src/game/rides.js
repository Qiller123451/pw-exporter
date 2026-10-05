// Rides: things the player controls for a stretch of a mission instead of walking - a war mammoth, a gunship.
//
// A mission lists them (CFG.rides = {id: def}); Player loads them (loadRides) and hands itself over while one is
// mounted: Player.step / animate / camera / hurt go to the ride, Player.pos / yaw / pitch / def stay what the rest of
// the game looks at (the enemies chase and shoot at Player.pos whatever stands there).
//
//   kind 'beast'    walks on the ground under the player's keys: it goes where it faces and turns slowly. Tusks (an
//                   arc in front), a stamp (everything around), a charge that tramples men and rams walls, a trumpet
//                   that stuns. Its blows are 'siege' blows: they count in full against armoured gates.
//   kind 'gunship'  flies a course the mission gives it (objective.flight, a closed loop it stays on until told to
//                   land); the player aims and fires its guns.
//
// A ride has its own health. A beast that falls throws its rider off (the player goes on on foot, the mission may
// bring another); a gunship that is shot down is the end.
import * as THREE from 'three';
import { CFG } from './config.js';
import { Actor, AnimCtl, loadActor, forward, wrapPi } from './actors.js';

const DEG = Math.PI / 180;
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const approach = (a, b, d) => (a < b ? Math.min(b, a + d) : Math.max(b, a - d));
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export async function loadRides(game) {
  const out = new Map();
  for (const [id, def] of Object.entries(CFG.rides || {})) {
    const tpl = await loadActor(def.model);
    const parts = [];
    for (const [m, link, clip] of def.held || []) parts.push({ tpl: await loadActor(m), link, clip, rider: false });
    for (const [m, link, clip] of def.riders || []) parts.push({ tpl: await loadActor(m), link, clip, rider: true });
    const proj = {};
    for (const w of Object.values(def.weapons || {})) if (w.projectile) proj[w.projectile] = await loadActor(w.projectile);
    out.set(id, def.kind === 'gunship' ? new Gunship(game, id, def, tpl, parts, proj) : new Beast(game, id, def, tpl, parts, proj));
  }
  return out;
}

class Ride {
  constructor(game, id, def, tpl, parts, proj) {
    this.g = game; this.id = id; this.def = def; this.tpl = tpl; this.proj = proj;
    this.actor = new Actor(tpl, { cullRadius: 0 });
    this.actor.model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    this.actor.model.scale.setScalar(def.scale || 1);
    this.anim = new AnimCtl(this.actor.model, tpl.clips);
    this.anim.setEvents && this.anim.setEvents(tpl.info.sounds, (ev) => game.audio.animEvent(ev, this.pos));
    this.riders = [];
    for (const p of parts) {
      const obj = this.actor.attach(p.link, p.tpl);
      if (obj && p.rider) { const an = new AnimCtl(obj, p.tpl.clips); const c = an.pick(p.clip, 'ride_idle_0', 'standanim'); if (c) an.play(c, { loop: true }); this.riders.push(an); }
    }
    this.actor.obj.visible = false;
    game.scene.add(this.actor.obj);
    this.pos = new THREE.Vector3(); this.yaw = 0;
    this.hp = def.health; this.mounted = false; this.dead = false; this.parked = false;
  }
  // stand somewhere in the world, waiting (the mammoth in its pen)
  park(x, z, yawDeg = 0) {
    const col = this.g.level.collision;
    this.pos.set(x, col.groundAt(x, z, this.g.level.height(x, z) + 3), z);
    this.yaw = yawDeg * DEG;
    this.hp = this.def.health; this.dead = false; this.parked = true; this.goneT = 0;
    this.actor.obj.visible = true; this.actor.obj.position.copy(this.pos); this.actor.obj.rotation.set(0, this.yaw, 0);
    this.anim.play(this.anim.pick(this.def.idle, 'standanim'), { loop: true });
  }
  mount(P) {
    this.P = P; this.mounted = true; this.dead = false; this.hp = this.def.health;
    if (!this.parked) { this.pos.copy(P.pos); this.yaw = P.yaw; }
    this.parked = false;
    P.pos.copy(this.pos); P.vel.set(0, 0, 0); P.onGround = true;
    this.actor.obj.visible = true;
  }
  // the player gets off: the ride stays where it is (stay) or is taken away
  dismount(stay = true) {
    this.mounted = false;
    if (stay && !this.dead) { this.parked = true; this.anim.play(this.anim.pick(this.def.idle, 'standanim'), { loop: true }); } else if (!this.dead) this.actor.obj.visible = false;
  }
  // animation of a ride nobody sits on (Player.animate calls it every frame for all rides)
  idle(dt) { if (!this.actor.obj.visible) return; this.anim.update(dt); for (const r of this.riders) r.update(dt); if (this.goneT > 0 && (this.goneT -= dt) <= 0) this.actor.obj.visible = false; }
  hurt(amount, from) {
    const G = this.g, P = this.P;
    if (this.dead || P.invulnerable > 0) return;
    amount *= this.def.resist ?? 1;
    // (def.budget = {perSecond, burst}: only so much gets through at a time, however many hack at its legs)
    const B = this.def.budget;
    if (B) {
      const now = G.time;
      this.bud = Math.min(B.burst, (this.bud ?? B.burst) + (now - (this.budT ?? now)) * B.perSecond); this.budT = now;
      amount = Math.min(amount, this.bud); this.bud -= amount;
      if (amount <= 0.01) return;
    }
    this.hp -= amount;
    P.stats.damageTaken += amount;
    G.hud.damage(from ? wrapPi(Math.atan2(-(from.x - P.pos.x), -(from.z - P.pos.z)) - P.yaw) : null, true);
    G.fx.shake(Math.min(0.35, 0.06 + amount / 160));
    if (this.hp <= 0) { this.hp = 0; this.die(); }
  }
  bar() { return `<div class="ch act"><b>${this.def.name}</b><div class="arm"></div><div class="hp"><s style="width:${(Math.max(0, this.hp) / this.def.health * 100).toFixed(0)}%"></s></div></div>`; }
}

// ---------------------------------------------------------------------------------------------------- the war mammoth
class Beast extends Ride {
  mount(P) {
    super.mount(P);
    this.busy = 0; this.pending = null; this.cool = 0; this.stampCd = 0; this.roarCd = 0; this.trod = new Map(); this.ramCd = 0; this.stride = 0;
    P.yaw = this.yaw; P.pitch = -0.12;
    this.g.hud.note(this.def.mountNote || 'You have the reins');
  }
  step(dt) {
    const G = this.g, P = this.P, d = this.def, I = P.intent, col = G.level.collision, Z = G.zones;
    P.invulnerable = Math.max(0, P.invulnerable - dt);
    this.busy = Math.max(0, this.busy - dt); this.cool = Math.max(0, this.cool - dt); this.stampCd = Math.max(0, this.stampCd - dt); this.roarCd = Math.max(0, this.roarCd - dt); this.ramCd = Math.max(0, this.ramCd - dt);
    if (this.pending && (this.pending.t -= dt) <= 0) { const p = this.pending; this.pending = null; p.fn(); }
    if (this.dead) { P.intent = {}; return; }
    // ---- where to
    const f = forward(P.yaw, v1), r = v2.set(-f.z, 0, f.x);
    let wx = f.x * (I.mz || 0) + r.x * (I.mx || 0), wz = f.z * (I.mz || 0) + r.z * (I.mx || 0);
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-3) { wx /= wl; wz /= wl; }
    const charging = !!I.sprint && wl > 0 && this.busy <= 0;
    this.charging = charging; P.sprinting = charging; P.aiming = false;
    // it turns towards where it is to go - or, striking, towards where the player looks - and walks where it faces
    const want = this.busy > 0 ? P.yaw : wl > 0 ? Math.atan2(-wx, -wz) : this.yaw;
    const turn = (this.busy > 0 ? d.turn * 1.6 : charging ? d.turn * 0.7 : d.turn) * dt;
    const off = wrapPi(want - this.yaw);
    this.yaw = wrapPi(this.yaw + Math.max(-turn, Math.min(turn, off)));
    const top = this.busy > 0 ? d.speed * 0.2 : charging ? d.charge : d.speed;
    const go = wl > 0 ? top * Math.max(0, Math.cos(off)) ** 0.6 : 0;
    const bf = forward(this.yaw, v3);
    const acc = (wl > 0 ? d.accel : d.accel * 1.6) * dt;
    P.vel.x = approach(P.vel.x, bf.x * go, acc); P.vel.z = approach(P.vel.z, bf.z * go, acc);
    // ---- move: walls, gates, the edge of the open country, deep water, slopes too steep for it
    const p = P.pos, v = P.vel, speed = Math.hypot(v.x, v.z), n = Math.max(1, Math.ceil(speed * dt / 1.2)), h = dt / n, x0 = p.x, z0 = p.z;
    let bumped = false;
    for (let i = 0; i < n; i++) {
      p.x += v.x * h; p.z += v.z * h;
      if (Z) Z.collide(p, d.radius * 0.7);
      const bx = p.x, bz = p.z;
      if (G.enemies) G.enemies.collide(p, d.radius * 0.8);
      if (Math.abs(p.x - bx) + Math.abs(p.z - bz) > 0.05) bumped = true;
      // (walls and houses stop it; what is lower than its belly - stones, fences, bushes - it walks over)
      if (col.pushOut(p, 1.6, p.y + 3.2, p.y + 6.5)) { const k = v.x * col.pushNx + v.z * col.pushNz; if (k < 0) { v.x -= col.pushNx * k; v.z -= col.pushNz * k; } }
    }
    const b = G.level.bounds;
    p.x = Math.max(b.x0, Math.min(b.x1, p.x)); p.z = Math.max(b.z0, Math.min(b.z1, p.z));
    const bad = (x, z) => (Z && !Z.walkAt(x, z)) || col.groundAt(x, z, p.y + 3) < G.level.water - 2.2 || (G.level.height(x, z) > G.level.height(x0, z0) + 0.05 && steep(G.level, x, z, CFG.physics.maxSlope ? CFG.physics.maxSlope * 0.8 : 0.8));
    if (bad(p.x, p.z) && !bad(x0, z0)) {
      if (!bad(x0, p.z)) { p.x = x0; v.x = 0; } else if (!bad(p.x, z0)) { p.z = z0; v.z = 0; } else { p.x = x0; p.z = z0; v.x = v.z = 0; }
      if (Z && !Z.walkAt(p.x, p.z)) Z.touch(p);
    }
    p.y += (col.groundAt(p.x, p.z, p.y + 2.5) - p.y) * Math.min(1, dt * 14);
    this.pos.copy(p);
    // ---- whatever is under its feet
    const now = G.time, T = d.trample;
    if (speed > 4) {
      for (const e of G.enemies.inRadius(p, d.radius + (charging ? T.reach + 1 : T.reach))) {
        if (e.def.structure) {
          // a charge into a wall or a tower: the ram
          if (!charging || this.ramCd > 0 || speed < d.speed) continue;
          this.ramCd = d.ram.every; v.x *= 0.2; v.z *= 0.2;
          e.damage(d.ram.damage, { kind: 'siege', from: p, point: v1.copy(e.pos).setY(e.pos.y + 4) });
          G.fx.shake(0.5); G.fx.dust(v1.copy(e.pos).lerp(p, 0.5), 6, 14); G.sfx('landBig', 95, p, 0.7); G.hitStop(0.05);
          continue;
        }
        if ((this.trod.get(e) || -9) > now - 0.7) continue;
        this.trod.set(e, now);
        const dx = e.pos.x - p.x, dz = e.pos.z - p.z, dl = Math.hypot(dx, dz) || 1;
        e.damage(charging ? T.charge : T.damage, { kind: 'slam', dir: v1.set(dx / dl * 0.6 + bf.x, 0, dz / dl * 0.6 + bf.z).normalize(), from: p, knock: charging ? T.knock : T.knock * 0.5 });
      }
      if (this.trod.size > 200) this.trod.clear();
    }
    void bumped;
    // ---- tusks, stamp, trumpet
    if ((I.fire || I.fireEdge) && this.cool <= 0 && this.busy <= 0) this._tusks();
    else if ((I.aim || I.jet || I.jump || I.melee) && this.stampCd <= 0 && this.busy <= 0) this._stamp();
    else if (I.ult && this.roarCd <= 0 && this.busy <= 0) this._trumpet();
    // footfalls
    if (speed > 2) { this.stride += speed * dt; if (this.stride > d.stepEvery) { this.stride = 0; G.sfx('landBig', charging ? 55 : 38, p, 1.1 + Math.random() * 0.2); if (charging) { G.fx.dust(p, d.radius, 3); G.fx.shake(0.06); } } }
    P.intent = { mx: I.mx, mz: I.mz, sprint: I.sprint, fire: I.fire, aim: I.aim };
  }
  _tusks() {
    const G = this.g, d = this.def, A = d.tusks, P = this.P;
    this.busy = A.time; this.cool = A.time + 0.05;
    this.anim.play(this.anim.pick(pick(A.clips), 'attack_front'), { loop: false, restart: true, cut: true, fade: 0.08, ts: A.ts || 1, onDone: () => {} });
    G.sfx(d.sounds.swing, 70, this.pos, 0.9 + Math.random() * 0.2);
    this.pending = { t: A.hitAt, fn: () => {
      const f = forward(this.yaw, new THREE.Vector3()), o = this.pos.clone().setY(this.pos.y + 3);
      let n = 0;
      for (const e of G.enemies.inCone(o, f, A.range + d.radius, Math.cos(A.arc * 0.5 * DEG), true)) { e.damage(e.def.structure ? A.siege : A.damage, { kind: 'siege', dir: f, from: this.pos, knock: A.knock, point: v1.copy(e.pos).setY(e.pos.y + 3) }); n++; }
      if (n) { G.hitStop(0.05); G.fx.shake(0.3); G.sfx('melee', 80, this.pos, 0.7); }
      G.fx.dust(o.addScaledVector(f, d.radius + 3).setY(this.pos.y), 4, 5);
      void P;
    } };
  }
  _stamp() {
    const G = this.g, d = this.def, S = d.stamp;
    this.busy = S.time; this.stampCd = S.cooldown;
    this.anim.play(this.anim.pick(S.clip, 'stomp', 'attack_front'), { loop: false, restart: true, cut: true, fade: 0.08, ts: S.ts || 1 });
    this.pending = { t: S.hitAt, fn: () => {
      G.fx.ring(this.pos, S.radius, [0.95, 0.9, 0.8, 0.9]); G.fx.dust(this.pos, S.radius * 0.6, 18); G.fx.shake(0.7); G.sfx('landBig', 100, this.pos, 0.6);
      for (const e of G.enemies.inRadius(this.pos, S.radius)) e.damage(e.def.structure ? S.siege : S.damage, { kind: 'siege', from: this.pos, knock: S.knock });
      G.hitStop(0.06);
    } };
  }
  _trumpet() {
    const G = this.g, d = this.def, R = d.trumpet;
    this.busy = R.time; this.roarCd = R.cooldown;
    this.anim.play(this.anim.pick(R.clip, 'trumpet', 'menace'), { loop: false, restart: true, cut: true, fade: 0.1 });
    G.sfx(d.sounds.roar, 100, this.pos);
    this.pending = { t: R.at, fn: () => {
      G.fx.ring(this.pos, R.radius, [1, 1, 1, 0.5]); G.fx.shake(0.3);
      let n = 0;
      for (const e of G.enemies.inRadius(this.pos, R.radius)) { if (e.def.structure || e.def.heavy || e.state === 'down') continue; e.hold(R.stun * (0.7 + Math.random() * 0.6)); n++; }
      if (n) G.hud.note(`${n} of them stand frozen with fear`);
    } };
  }
  die() {
    const G = this.g, P = this.P;
    this.dead = true; this.busy = 0; this.pending = null;
    this.anim.play(this.anim.pick('dying'), { loop: false, restart: true, cut: true, fade: 0.1 });
    for (const r of this.riders) { const c = r.pick('dying', 'die_simple'); if (c) r.play(c, { loop: false }); }
    G.sfx(this.def.sounds.roar, 90, this.pos, 0.8);
    G.fx.dust(this.pos, this.def.radius * 2, 14); G.fx.shake(0.5); G.slowMo(0.4, 0.6);
    G.log.add('RIDE', this.def.name + ' is down');
    this.goneT = 9;
    P.dismount(true);
  }
  animate(dt) {
    const d = this.def, P = this.P, speed = Math.hypot(P.vel.x, P.vel.z);
    if (!this.dead && this.busy <= 0) {
      if (speed > 1.2) this.anim.play(this.anim.pick(d.run, 'walk_2'), { loop: true, ts: Math.max(0.5, speed / d.runSpeed), cut: true });
      else this.anim.play(this.anim.pick(d.idle, 'standanim'), { loop: true });
    }
    this.actor.obj.position.copy(P.pos); this.actor.obj.rotation.set(0, this.yaw, 0);
    this.anim.update(dt);
    for (const r of this.riders) r.update(dt);
  }
  camera(dt, fx) { chase(this, dt, fx, this.def.camera, this.charging ? CFG.camera.fovSprint : CFG.camera.fov); }
  hud() {
    const d = this.def, cd = (t) => (t > 0 ? ' <b>' + Math.ceil(t) + ' s</b>' : '');
    return { gap: 14, melee: true, chars: this.bar(),
      weapon: `<div class="wn">${d.tusks.name}</div><div class="am"><b>&#8734;</b></div><div class="wl"><span class="on">LMB ${d.tusks.name}</span><span>Shift + W ${d.ram.name}</span></div>`,
      abil: `<div class="${this.stampCd > 0 ? 'cd' : ''}"><em>RMB</em> ${d.stamp.name}${cd(this.stampCd)}</div><div class="ult ${this.roarCd > 0 ? 'cd' : 'ready'}"><em>G</em> ${d.trumpet.name}${cd(this.roarCd)}</div>` };
  }
}
const steep = (level, x, z, max) => Math.hypot(level.height(x + 1.5, z) - level.height(x - 1.5, z), level.height(x, z + 1.5) - level.height(x, z - 1.5)) / 3 > max;

// a camera behind and above the ride, turned by the mouse, pulled in by walls
function chase(ride, dt, fx, C, fovT) {
  const G = ride.g, P = ride.P, cam = G.engine.camera, col = G.level.collision;
  const cp = Math.cos(P.pitch), sp = Math.sin(P.pitch);
  const dir = v1.set(-Math.sin(P.yaw) * cp, sp, -Math.cos(P.yaw) * cp), right = v2.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  P.fov += (fovT - P.fov) * Math.min(1, dt * 6);
  if (Math.abs(cam.fov - P.fov) > 0.05) { cam.fov = P.fov; cam.updateProjectionMatrix(); }
  const pivot = v3.copy(P.pos).setY(P.pos.y + C[1]).addScaledVector(right, C[0]);
  let back = C[2];
  const t = col.raycast(pivot.x, pivot.y, pivot.z, -dir.x, -dir.y, -dir.z, back + 0.8);
  if (t !== Infinity) back = Math.max(C[3] ?? 4, t - 0.8);
  P.camBack = back < P.camBack ? back : P.camBack + (back - P.camBack) * Math.min(1, dt * 5);
  cam.position.copy(pivot).addScaledVector(dir, -P.camBack).add(fx.shakeOffset);
  cam.rotation.set(P.pitch, P.yaw, fx.shakeRoll, 'YXZ');
  cam.updateMatrixWorld();
}

// ---------------------------------------------------------------------------------------------------- the gunship
// A smooth closed or open course through points [x, z, y]: sampled once, then walked by distance.
export class Course {
  constructor(pts, closed) {
    const P = pts.map((p) => new THREE.Vector3(p[0], p[2], p[1]));
    const curve = new THREE.CatmullRomCurve3(P, closed, 'centripetal');
    this.closed = closed;
    this.length = curve.getLength();
    this.n = Math.max(8, Math.ceil(this.length / 3));
    this.pts = curve.getSpacedPoints(this.n);
  }
  // position (out) at distance s along it; returns the direction of flight there (a shared vector)
  at(s, out) {
    const L = this.length;
    let u = this.closed ? ((s % L) + L) % L / L : Math.max(0, Math.min(0.9999, s / L));
    const f = u * this.n, i = Math.min(this.n - 1, Math.floor(f)), k = f - i;
    out.lerpVectors(this.pts[i], this.pts[i + 1], k);
    return Course._d.subVectors(this.pts[i + 1], this.pts[i]).normalize();
  }
}
Course._d = new THREE.Vector3();

// is (x, z) inside the closed line of points [[x, z] ...]?
function inPoly(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
  return c;
}

class Gunship extends Ride {
  // the mission gives the course: {speed, out: [[x, z, y] ...] from where it stands to the loop, loop: [...] (closed),
  // home: [...] from the first point of the loop to where it sets down}
  fly(F) {
    this.F = F;
    const start = [this.pos.x, this.pos.z, this.pos.y + 0.5];
    if (!F.free) this.legs = { out: new Course([start, [start[0], start[1], start[2] + 14], ...F.out, F.loop[0]], false), loop: new Course(F.loop, true), home: new Course([F.loop[0], ...F.home], false) };
    this.leg = 'out'; this.s = 0; this.landing = false; this.landed = false; this.speed = 0;
    // F.free = {area: [[x, z] ...], ceiling, floor, climb, boost}: after the lift-off the player flies it himself,
    // inside that field (a fence of the districts' energy wall stands round it)
    if (F.free) {
      this.legs = { out: new Course([start, [start[0], start[1], start[2] + 14], ...F.out], false) };
      this.vel = new THREE.Vector3();
      if (this.g.zones) this.g.zones.fence(F.free.area, this.g.level.water - 2, F.free.ceiling + 25);
    }
  }
  // free flight is over: a straight way home from where it is
  _home() {
    const p = this.P.pos, F = this.F, h = F.home[F.home.length - 1], top = Math.max(p.y, h[2] + 38);
    this.legs.home = new Course([[p.x, p.z, p.y], [(p.x * 2 + h[0]) / 3, (p.z * 2 + h[1]) / 3, top], [(p.x + h[0] * 2) / 3, (p.z + h[1] * 2) / 3, top], [h[0], h[1], h[2] + 24], h], false);
    this.leg = 'home'; this.s = 0;
    this.g.hud.note('The pilot takes her in');
    if (this.g.zones) this.g.zones.unfence();
  }
  // W A S D over the ground the way the camera looks, Space up, C / Q down, Shift faster. It cannot leave its field,
  // it stays above the ground (and above what lies ahead: no flying into a mountainside) and under the ceiling.
  _free(dt) {
    const G = this.g, P = this.P, F = this.F, A = F.free, I = P.intent, L = G.level, inp = G.input, V = this.vel, p = P.pos;
    const f = forward(P.yaw, v1), fx = f.x, fz = f.z;
    const sp = F.speed * (I.sprint ? A.boost || 1.5 : 1);
    const up = (inp.down('Space') ? 1 : 0) - (inp.down('KeyC') || inp.down('KeyQ') ? 1 : 0);
    const mz = I.mz || 0, mx = I.mx || 0;
    const wx = (fx * mz - fz * mx * 0.8) * sp, wz = (fz * mz + fx * mx * 0.8) * sp;
    const k = Math.min(1, dt * (A.agility || 2.2));
    V.x += (wx - V.x) * k; V.z += (wz - V.z) * k; V.y += (up * (A.climb || 14) - V.y) * Math.min(1, dt * 4);
    const x0 = p.x, z0 = p.z;
    let nx = x0 + V.x * dt, nz = z0 + V.z * dt;
    const inside = (x, z) => inPoly(A.area, x, z);
    if (!inside(nx, nz) && inside(x0, z0)) {
      if (inside(nx, z0)) { nz = z0; V.z = 0; } else if (inside(x0, nz)) { nx = x0; V.x = 0; } else { nx = x0; nz = z0; V.x = V.z = 0; }
      if (G.zones) G.zones.touch(p, A.note || 'The gunship stays over the cape');
    }
    p.x = nx; p.z = nz; p.y += V.y * dt;
    const gh = (x, z) => Math.max(L.height(x, z), L.water), fl = A.floor || 11;
    const lo = Math.max(gh(p.x, p.z), gh(p.x + V.x * 0.7, p.z + V.z * 0.7), gh(p.x + V.x * 1.5, p.z + V.z * 1.5) - 8) + fl;
    if (p.y < lo) { p.y = Math.min(lo, p.y + 30 * dt); if (V.y < 0) V.y = 0; }
    p.y = Math.max(p.y, gh(p.x, p.z) + 4);
    if (p.y > A.ceiling) { p.y = A.ceiling; if (V.y > 0) V.y = 0; }
    P.vel.copy(V); this.pos.copy(p);
    this.speed = Math.hypot(V.x, V.z);
    // the machine turns to where one looks, banks into the turn and to the side it slips, and puts its nose down with speed
    const dy = wrapPi(P.yaw - this.bodyYaw);
    this.bodyYaw = wrapPi(this.bodyYaw + dy * Math.min(1, dt * 2.6));
    const side = (-fz * V.x + fx * V.z) / F.speed, ahead = (fx * V.x + fz * V.z) / F.speed;
    this.roll += (Math.max(-0.5, Math.min(0.5, -dy * 1.2 - side * 0.3)) - this.roll) * Math.min(1, dt * 2.5);
    this.pitchB += (ahead * 0.17 - this.pitchB) * Math.min(1, dt * 2);
    this.yaw = this.bodyYaw;
  }
  // the work is done: at the end of this round it turns for home
  land() { this.landing = true; if (this.F.free && this.leg === 'free') this._home(); }
  // it comes in from afar and sets down (nobody on board yet): from [x, z, y] to [x, z], in `time` seconds
  arrive(from, at, time) {
    const col = this.g.level.collision;
    this.arr = { a: new THREE.Vector3(from[0], from[2], from[1]), b: new THREE.Vector3(at[0], col.groundAt(at[0], at[1], this.g.level.height(at[0], at[1]) + 3) + 0.3, at[1]), t: 0, time, yaw: at[2] || 0 };
    this.parked = false; this.dead = false; this.actor.obj.visible = true;
    this.anim.play(this.anim.pick(this.def.run, 'walk_2', 'walk_1'), { loop: true, ts: 1.4 });
  }
  idle(dt) {
    const A = this.arr;
    if (A) {
      A.t += dt;
      const k = Math.min(1, A.t / A.time), e = 1 - (1 - k) * (1 - k), o = this.actor.obj;
      this.pos.lerpVectors(A.a, A.b, e);
      this.pos.y = Math.max(this.pos.y, this.g.level.height(this.pos.x, this.pos.z) + (k < 0.85 ? this.def.clear : 0.3));
      const dx = A.b.x - A.a.x, dz = A.b.z - A.a.z;
      this.yaw = Math.atan2(-dx, -dz);
      o.position.copy(this.pos); o.rotation.set(-0.14 * (1 - k), this.yaw, 0, 'YXZ');
      if (k >= 1) { this.arr = null; this.park(A.b.x, A.b.z, this.yaw / DEG); this.g.fx.dust(this.pos, 10, 16); }
    }
    super.idle(dt);
  }
  mount(P) {
    super.mount(P);
    const W = this.def.weapons;
    this.gun = { cool: 0, heat: 0, jam: 0, soundT: 0, side: 1 }; this.rockets = { ammo: W.rockets.magazine, cool: 0, regen: 0, side: 1 };
    this.roll = 0; this.bodyYaw = this.yaw; this.pitchB = 0;
    P.yaw = this.yaw; P.pitch = -0.25; P.onGround = false;
    this.anim.play(this.anim.pick(this.def.run, 'walk_2', 'walk_1'), { loop: true, ts: 1.4 });
    this.g.hud.note(this.def.mountNote || 'You have the guns');
  }
  step(dt) {
    const G = this.g, P = this.P, d = this.def, I = P.intent, F = this.F;
    P.invulnerable = Math.max(0, P.invulnerable - dt);
    if (this.dead) { this._fall(dt); P.intent = {}; return; }
    // ---- free flight, or along the course
    const p = P.pos;
    if (this.leg === 'free') this._free(dt);
    else {
      const L = this.legs[this.leg];
      const slow = this.leg === 'home' ? Math.max(0.12, Math.min(1, (L.length - this.s) / 60)) : this.leg === 'out' ? Math.max(0.2, Math.min(1, this.s / 30)) : 1;
      this.speed = approach(this.speed, F.speed * slow, 14 * dt);
      this.s += this.speed * dt;
      if (this.leg === 'out' && this.s >= L.length && F.free) { this.leg = 'free'; this.vel.copy(L.at(L.length, v1)).multiplyScalar(this.speed); this.vel.y = 0; if (this.landing) this._home(); else G.hud.note(d.freeNote || 'She is yours: W A S D to fly, Space up, C down, Shift faster'); return this.step(0); }
      if (this.leg === 'out' && this.s >= L.length) { this.leg = 'loop'; this.s = 0; }
      else if (this.leg === 'loop' && this.s >= L.length) { this.s -= L.length; this.rounds = (this.rounds || 0) + 1; if (this.landing) { this.leg = 'home'; this.s = 0; G.hud.note('Going in to land'); } }
      else if (this.leg === 'home' && this.s >= L.length - 0.5 && !this.landed) { this.landed = true; G.fx.dust(P.pos, 10, 20); }
      const C = this.legs[this.leg], dir = C.at(this.s, v1);
      const old = v2.copy(p);
      C.at(this.s, p);
      // never into a mountain: keep clear of the ground, except where it sets down
      // (lifting off: the clearance grows with the first metres)
      const clr = this.leg === 'out' ? d.clear * Math.min(1, this.s / 50) : d.clear;
      if (this.leg !== 'home' || C.length - this.s > 40) p.y = Math.max(p.y, G.level.height(p.x, p.z) + clr, G.level.water + clr);
      else p.y = Math.max(p.y, G.level.collision.groundAt(p.x, p.z, p.y + 30) + 0.3);
      P.vel.copy(p).sub(old).multiplyScalar(1 / Math.max(dt, 1e-4));
      this.pos.copy(p);
      // the machine points along its course and leans into the turns
      const want = Math.atan2(-dir.x, -dir.z), dy = wrapPi(want - this.bodyYaw);
      this.bodyYaw = wrapPi(this.bodyYaw + dy * Math.min(1, dt * 3));
      this.roll += (Math.max(-0.45, Math.min(0.45, -dy * 1.6)) - this.roll) * Math.min(1, dt * 2.5);
      this.pitchB += ((this.speed / F.speed) * 0.16 - this.pitchB) * Math.min(1, dt * 2);
      this.yaw = this.bodyYaw;
    }
    // ---- guns: they shoot where the middle of the screen points
    const W = d.weapons, g = this.gun, R = this.rockets;
    g.cool = Math.max(0, g.cool - dt); g.jam = Math.max(0, g.jam - dt); R.cool = Math.max(0, R.cool - dt);
    if (R.ammo < W.rockets.magazine) { R.regen += dt; if (R.regen >= W.rockets.regenEvery) { R.regen = 0; R.ammo++; } }
    P.firing = false; P.aiming = false;
    const firing = !!I.fire && g.jam <= 0 && !this.landed;
    if (firing) {
      P.firing = true;
      g.heat = Math.min(1, g.heat + dt / W.gun.overheat);
      if (g.heat >= 1) { g.jam = W.gun.coolDown; G.hud.note('The guns are too hot'); G.sfx('error', 50, null); }
      while (g.cool <= 0 && g.jam <= 0) {
        g.cool += 1 / W.gun.rate;
        const target = P._aim(), m = this._muzzle(g, new THREE.Vector3());
        const sd = target.clone().sub(m).normalize();
        P.stats.shots++;
        P._bullet({ def: W.gun, ammo: 1e9 }, m, sd);
        g.soundT -= 1 / W.gun.rate;
        if (g.soundT <= 0) { g.soundT = W.gun.soundEvery || 0.12; G.sfx(pick(W.gun.sounds), W.gun.volume, null, 0.95 + Math.random() * 0.1); }
      }
    } else g.heat = Math.max(0, g.heat - dt / W.gun.coolDown);
    if ((I.aim || I.melee) && R.cool <= 0 && R.ammo >= 1 && !this.landed) {
      R.cool = 1 / W.rockets.rate; R.ammo--; R.regen = 0;
      const target = P._aim(), m = this._muzzle(R, new THREE.Vector3());
      const rd = target.clone().sub(m).normalize();
      G.fx.muzzle(m, rd, 2.2); G.sfx(pick(W.rockets.sounds), W.rockets.volume, null); G.fx.shake(0.1);
      G.projectiles.fire({ tpl: this.proj[W.rockets.projectile] || null, pos: m, vel: rd.multiplyScalar(W.rockets.speed), life: W.rockets.reach / W.rockets.speed, expire: true, owner: 'player', radius: 0.6,
        trail: (q) => G.fx.rocketTrail(q.pos),
        onHit: (hit) => this._burst(new THREE.Vector3(hit.x, hit.y, hit.z)) });
    }
    P.recoil = Math.max(0, P.recoil - dt * 6 * (0.2 + P.recoil));
    // smoke when it has taken a lot
    if (this.hp < d.health * 0.4 && Math.random() < dt * 12) G.fx.dust(v3.copy(p).setY(p.y + 2), 2.5, 1, [0.2, 0.2, 0.2, 0.6]);
    P.intent = { mx: I.mx, mz: I.mz, sprint: I.sprint, fire: I.fire, aim: I.aim };
  }
  // a rocket going off: like the player's own, but nothing of it comes back on the machine
  _burst(at) {
    const G = this.g, W = this.def.weapons.rockets;
    G.fx.explosion(at, W.radius); G.sfx('explode', 90, at, 0.9 + Math.random() * 0.2);
    for (const e of G.enemies.inRadius(at, W.radius)) {
      const dd = Math.hypot(e.pos.x - at.x, e.pos.z - at.z), f = 1 - 0.6 * Math.min(1, dd / W.radius);
      e.damage(W.damage * (e.def.structure ? W.vsStructure ?? 1 : f), { kind: 'explosion', from: at, knock: W.knock * f });
    }
  }
  // the guns sit left and right under the cabin (links psh1 / psh2), fired in turn
  _muzzle(w, out) {
    w.side = -w.side;
    const l = this.actor.links && (this.actor.links[w.side > 0 ? 'psh1' : 'psh2']);
    if (l) return l.getWorldPosition(out);
    const f = forward(this.bodyYaw, v3);
    return out.copy(this.P.pos).addScaledVector(f, 4).add(v1.set(-f.z, 0, f.x).multiplyScalar(2.2 * w.side)).setY(this.P.pos.y + 0.6);
  }
  die() {
    const G = this.g, P = this.P;
    this.dead = true; this.fallV = 0; this.spin = 2.5;
    G.fx.explosion(v1.copy(P.pos).setY(P.pos.y + 2), 9); G.sfx('explode', 100, null, 0.7); G.fx.shake(0.8);
    G.hud.note('The gunship is hit - going down');
    G.log.add('RIDE', this.def.name + ' shot down');
  }
  _fall(dt) {
    const G = this.g, P = this.P;
    if (this.crashed) return;
    this.fallV += 22 * dt; this.bodyYaw += this.spin * dt; this.roll += dt * 0.6;
    P.pos.y -= this.fallV * dt; P.pos.x += P.vel.x * 0.4 * dt; P.pos.z += P.vel.z * 0.4 * dt;
    if (Math.random() < dt * 20) G.fx.dust(v1.copy(P.pos).setY(P.pos.y + 2), 3, 1, [0.15, 0.15, 0.15, 0.7]);
    const ground = Math.max(G.level.height(P.pos.x, P.pos.z), G.level.water);
    if (P.pos.y <= ground + 1) {
      this.crashed = true; P.pos.y = ground;
      G.fx.explosion(v1.copy(P.pos).setY(ground + 2), 16); G.fx.dust(P.pos, 12, 24); G.sfx('explode', 100, null, 0.6); G.fx.shake(1);
      this.actor.obj.visible = false;
      P.dead = true; P.deathT = 1.6;
      for (const c of Object.values(P.chars)) c.alive = false;
    }
  }
  animate(dt) {
    const P = this.P, o = this.actor.obj;
    o.position.copy(P.pos);
    o.rotation.set(-this.pitchB, this.bodyYaw, this.roll, 'YXZ');
    this.anim.update(dt * (this.landed ? 0.4 : 1));
    for (const r of this.riders) r.update(dt);
  }
  camera(dt, fx) { chase(this, dt, fx, this.def.camera, CFG.camera.fov); }
  hud() {
    const W = this.def.weapons, g = this.gun, R = this.rockets;
    return { gap: 8 + g.heat * 10, chars: this.bar(),
      weapon: `<div class="wn">${W.gun.name}</div><div class="am"><div class="fuel"><s style="width:${((1 - g.heat) * 100).toFixed(0)}%"></s></div></div><div class="wl"><span class="${g.jam > 0 ? '' : 'on'}">LMB ${W.gun.name}${g.jam > 0 ? ' (cooling)' : ''}</span><span class="${R.ammo >= 1 ? 'on' : ''}">RMB ${W.rockets.name} ${R.ammo}</span></div>`,
      abil: `<div>${this.leg === 'home' ? 'Landing' : this.landing ? 'Last round' : this.leg === 'free' ? '<span class="key">W A S D</span> fly &nbsp; <span class="key">Space</span> up &nbsp; <span class="key">C</span> down &nbsp; <span class="key">Shift</span> faster' : this.F && this.F.free ? 'Lifting off' : 'The pilot holds the course - you have the guns'}</div>` };
  }
}
