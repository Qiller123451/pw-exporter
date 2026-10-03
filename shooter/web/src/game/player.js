// The player: one body in the world that is either the Gunner or the Executioner MKII (swap any time).
//
// Each frame:   look(input)   mouse -> aim direction, key presses -> intents
// Fixed steps:  step(dt)      movement and collision, jetpack, dash, weapons, melee, executions, damage
// Each frame:   animate(dt)   legs / upper body animation, aim twist, model placement
//               camera(dt)    third-person shoulder camera (pulled in by walls) or first person
//
// Movement model: a capsule (radius, height) that stands on CollisionWorld.groundAt() and is pushed out of walls.
// The body turns towards the direction of travel (within 90 degrees of the aim, backwards = walking backwards) and the
// upper body twists back towards the aim, so every character can run and shoot in any direction with the single
// forward walk cycle the ParaWorld models have.
import * as THREE from 'three';
import { CFG } from './config.js';
import { Actor, BodyAnim, loadActor, borrowClips, forward, wrapPi } from './actors.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const approach = (a, b, d) => (a < b ? Math.min(b, a + d) : Math.max(b, a - d));

export class Player {
  constructor(game) {
    this.g = game;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;               // aim (radians); yaw 0 looks north (-z)
    this.bodyYaw = 0; this.twist = 0; this.legDir = 1;
    this.onGround = true; this.airTime = 0;
    this.chars = {}; this.active = 'gunner';
    this.firstPerson = false; this.shoulder = 1;
    this.intent = {};
    this.safe = new THREE.Vector3();            // last place on solid ground (rescue from water / the void)
    this.recoil = 0; this.fov = CFG.camera.fov; this.camBack = 0;
    this.invulnerable = 0; this.swapCd = 0; this.busy = 0; this.dead = false; this.aimPoint = new THREE.Vector3();
    this.stats = { shots: 0, executions: 0, damageTaken: 0, swaps: 0, jumps: 0 };
  }
  get ch() { return this.chars[this.active]; }
  get def() { return this.ch.def; }

  async load(progress = () => {}) {
    const G = this.g;
    let k = 0;
    for (const id of Object.keys(CFG.classes)) {
      const def = CFG.classes[id];
      progress(k++ / 2, 'Loading ' + def.name);
      const tpl = await loadActor(def.model);
      const actor = new Actor(tpl, { cullRadius: 0 });
      actor.model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
      const anim = new BodyAnim(actor.model, tpl.clips, def.upperRoot);
      for (const src in def.clipsFrom) {
        const st = await loadActor(src);
        anim.addClips(borrowClips(tpl, st, def.clipsFrom[src]));
      }
      anim.setSpine(def.spine);
      if (def.fpArms) anim.setExtra(def.fpArms.bones);
      if (def.backpack) actor.attach('Back', await loadActor(def.backpack));
      const weapons = [];
      for (const wid of def.weapons) {
        const w = CFG.weapons[wid];
        const st = { id: wid, def: w, ammo: w.magazine ?? w.fuel ?? 0, reload: 0, cool: 0, regen: 0, spin: 0, soundT: 0, tpl: w.model ? await loadActor(w.model) : null,
          proj: w.projectile ? await loadActor(w.projectile) : null };
        weapons.push(st);
      }
      const meleeTpl = def.melee && def.melee.model ? await loadActor(def.melee.model) : null;
      actor.obj.visible = false;
      G.scene.add(actor.obj);
      const find = (n) => { let b = null; actor.model.traverse((o) => { if (o.name === n) b = o; }); return b; };
      const barrel = def.barrel ? def.barrel.map(find) : null;
      this.chars[id] = { id, def, actor, anim, weapons, head: def.fpHead ? find(def.fpHead[0]) : null, barrel: barrel && barrel[0] && barrel[1] ? barrel : null, wi: 0, health: def.health, armor: def.armor * def.armorPip, armorDelay: 0, alive: true,
        jet: def.jet.charges, jetTimer: 0, dashCd: 0, meleeTpl, combo: 0, comboT: 0, stepDist: 0 };
    }
    for (const c of Object.values(this.chars)) this._equip(c);
  }

  _equip(c) {
    const w = c.weapons[c.wi];
    for (const link of ['HndR', 'HndL']) c.actor.attach(link, null);
    if (w.tpl) c.actor.attach(w.def.hand || 'HndR', w.tpl);
    this._fp = null;                      // first-person visibility is applied again
  }

  spawn(x, z, yawDeg) {
    const col = this.g.level.collision;
    this.pos.set(x, col.groundAt(x, z, this.g.level.height(x, z) + 3), z);
    this.safe.copy(this.pos);
    this.yaw = this.bodyYaw = yawDeg * DEG; this.pitch = 0;
    this.vel.set(0, 0, 0);
    this.ch.actor.obj.visible = true;
    this.ch.anim.legs(this.def.idleClip);
    this._place();
  }

  // ---------------------------------------------------------------- input (once per frame)
  look(input, settings) {
    const s = CFG.camera.sensitivity * settings.sensitivity * (this.aiming ? this.def.aimSens ?? 0.6 : 1);
    this.yaw = wrapPi(this.yaw - input.dx * s);
    this.pitch = Math.max(CFG.camera.pitchMin * DEG, Math.min(CFG.camera.pitchMax * DEG, this.pitch - input.dy * s * (settings.invertY ? -1 : 1)));
    const I = this.intent;
    I.mx = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    I.mz = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    I.sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    I.fire = input.mouse(0);
    I.aim = input.mouse(2);
    if (input.hit('Space')) I.jump = true;
    if (input.hit('KeyQ')) I.jet = true;
    // (not Ctrl: Ctrl+W closes the browser tab and no page can prevent that)
    if (input.hit('KeyC') || input.hit('AltLeft')) I.dash = true;
    if (input.hit('KeyF') || input.click(1)) I.melee = true;
    if (input.hit('KeyE')) I.execute = true;
    if (input.hit('KeyR')) I.reload = true;
    if (input.hit('Tab')) I.swap = true;
    if (input.hit('KeyV')) this.firstPerson = !this.firstPerson;
    if (input.hit('KeyX')) this.shoulder = -this.shoulder;
    if (input.click(0)) I.fireEdge = true;
    for (let k = 0; k < 3; k++) if (input.hit('Digit' + (k + 1))) I.weapon = k;
    if (input.wheel) I.cycle = input.wheel;
  }

  // ---------------------------------------------------------------- simulation step
  step(dt) {
    const G = this.g, c = this.ch, def = c.def, I = this.intent, P = CFG.physics, col = G.level.collision;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.swapCd = Math.max(0, this.swapCd - dt);
    this.busy = Math.max(0, this.busy - dt);
    // an upper-body action (knife, rocket shot) never holds the arms longer than this
    if (this.upperHold && (this.upperHoldT -= dt) <= 0) { if (this.upperHold === 'melee') this._equip(this.ch); this.upperHold = null; }
    c.dashCd = Math.max(0, c.dashCd - dt);
    this.recoil = Math.max(0, this.recoil - dt * 6 * (0.2 + this.recoil));
    for (const ch of Object.values(this.chars)) this._regen(ch, dt);
    if (this.dead) { this._physics(dt, 0, 0, false); return; }

    if (I.swap) this.swap();
    if (def.aimToShoot) {
      // no switching by hand: the gun while the aim button is held, the claws otherwise
      const want = c.weapons.findIndex((w) => (w.def.kind === 'melee') === !I.aim);
      if (want >= 0 && want !== c.wi && this.busy <= 0) { c.wi = want; c.combo = 0; c.comboT = 0; }
    } else {
      if (I.weapon != null) this.setWeapon(I.weapon);
      if (I.cycle) this.setWeapon((c.wi + (I.cycle > 0 ? 1 : c.weapons.length - 1)) % c.weapons.length);
    }

    // --- movement intent in world space
    const f = forward(this.yaw, v1), r = v2.set(-f.z, 0, f.x);
    let wx = f.x * I.mz + r.x * I.mx, wz = f.z * I.mz + r.z * I.mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-3) { wx /= wl; wz /= wl; }
    this.aiming = !!I.aim && !this.firstPersonLock;
    const firing = !!I.fire && this.busy <= 0;
    const sprinting = I.sprint && I.mz > 0 && !firing && !this.aiming && this.onGround;
    this.sprinting = sprinting && wl > 0;
    let top = sprinting ? def.sprint : def.speed;
    if (this.aiming) top *= def.aimSpeed ?? 0.65;
    if (this.lockMove > 0) { this.lockMove -= dt; top *= 0.15; }

    // --- special moves
    if (I.dash && c.dashCd <= 0 && this.busy <= 0) {
      c.dashCd = def.dash.cooldown;
      const dx = wl > 0 ? wx : f.x, dz = wl > 0 ? wz : f.z;
      this.dashT = def.dash.time; this.dashDir = [dx, dz];
      this.invulnerable = Math.max(this.invulnerable, def.dash.time + 0.08);
      G.fx.dust(this.pos, def.radius * 2, 4);
      G.sfx('swing', 40, this.pos);
    }
    if (I.jump && this.onGround && this.busy <= 0) { this.vel.y = def.jump; this.onGround = false; this.airTime = 0; }
    if (I.jet && c.jet >= 1 && this.busy <= 0) this._jet(wl > 0 ? wx : f.x, wl > 0 ? wz : f.z);
    if (I.execute && this.busy <= 0) this._execute();
    if (I.melee && this.busy <= 0) {
      if (!this.onGround && this.jetting) this.slamming = true;          // dive from a jetpack jump
      else if (def.melee) this._melee();
    }

    this._physics(dt, wx * top, wz * top, wl > 0);
    this._weapons(dt, firing);
    if (this.pending && (this.pending.t -= dt) <= 0) { const p = this.pending; this.pending = null; p.fn(); }

    // footsteps
    if (this.onGround && wl > 0) {
      c.stepDist += Math.hypot(this.vel.x, this.vel.z) * dt;
      if (c.stepDist > def.stepEvery) { c.stepDist = 0; G.sfx(def.steps[Math.floor(Math.random() * def.steps.length)], 30, this.pos); }
    }
    this.intent = { mx: I.mx, mz: I.mz, sprint: I.sprint, fire: I.fire, aim: I.aim };
  }

  _regen(ch, dt) {
    const d = ch.def;
    // jetpack charges
    if (ch.jet < d.jet.charges) { ch.jetTimer += dt; if (ch.jetTimer >= d.jet.recharge) { ch.jetTimer = 0; ch.jet++; } }
    // armour: comes back by itself only slowly and only after a while without being hit
    if (ch.alive && ch.armor < d.armor * d.armorPip) { ch.armorDelay -= dt; if (ch.armorDelay <= 0) ch.armor = Math.min(d.armor * d.armorPip, ch.armor + dt * d.armorPip / 4); }
    for (const w of ch.weapons) {
      const wd = w.def;
      w.cool = Math.max(0, w.cool - dt);
      if (w.reload > 0) { w.reload -= dt; if (w.reload <= 0) w.ammo = wd.magazine; }
      if (wd.kind === 'flame') { w.regen -= dt; if (w.regen <= 0) w.ammo = Math.min(wd.fuel, w.ammo + wd.regen * dt); }
      if (wd.kind === 'rocket' && w.ammo < wd.magazine) { w.regen += dt; if (w.regen >= wd.regenEvery) { w.regen = 0; w.ammo++; } }
    }
  }

  _physics(dt, tx, tz, moving) {
    const G = this.g, def = this.def, P = CFG.physics, col = G.level.collision, v = this.vel;
    if (this.dashT > 0) {
      this.dashT -= dt;
      v.x = this.dashDir[0] * def.dash.speed; v.z = this.dashDir[1] * def.dash.speed;
    } else if (this.onGround) {
      const acc = (moving ? P.groundAccel : P.friction * Math.hypot(v.x, v.z) + 6) * dt;
      v.x = approach(v.x, tx, acc * (Math.abs(tx - v.x) / (Math.hypot(tx - v.x, tz - v.z) || 1)));
      v.z = approach(v.z, tz, acc * (Math.abs(tz - v.z) / (Math.hypot(tx - v.x, tz - v.z) || 1)));
    } else if (moving) {
      const acc = P.groundAccel * P.airControl * dt;
      // in the air the speed already gained is kept; steering only bends it
      const sp = Math.max(Math.hypot(v.x, v.z), def.speed);
      const nx = v.x + tx / def.speed * acc, nz = v.z + tz / def.speed * acc, nl = Math.hypot(nx, nz);
      if (nl > sp) { v.x = nx / nl * sp; v.z = nz / nl * sp; } else { v.x = nx; v.z = nz; }
    }
    // sub-steps so a fast body can't skip through a thin wall
    const speed = Math.hypot(v.x, v.z);
    const n = Math.max(1, Math.ceil(speed * dt / (def.radius * 0.6)));
    const h = dt / n;
    const p = this.pos;
    for (let i = 0; i < n; i++) {
      p.x += v.x * h; p.z += v.z * h;
      if (col.pushOut(p, def.radius, p.y + P.stepHeight, p.y + def.height)) {
        // slide: remove the part of the velocity that runs into the wall
        const d = v.x * col.pushNx + v.z * col.pushNz;
        if (d < 0) { v.x -= col.pushNx * d; v.z -= col.pushNz * d; }
      }
    }
    const b = G.level.bounds;
    p.x = Math.max(b.x0, Math.min(b.x1, p.x)); p.z = Math.max(b.z0, Math.min(b.z1, p.z));
    const ground = col.groundAt(p.x, p.z, p.y + P.stepHeight);
    if (this.onGround) {
      if (ground >= p.y - 1.4) { p.y = ground; v.y = 0; } else { this.onGround = false; this.airTime = 0; }
    }
    if (!this.onGround) {
      this.airTime += dt;
      let g = P.gravity;
      if (this.jetT > 0) { this.jetT -= dt; g *= 0.25; this._jetFx(); }
      if (this.slamming) g *= 3.2;
      v.y -= g * dt;
      if (v.y > 0) { const cl = col.ceilingAt(p.x, p.z, p.y + def.height - 0.6, p.y + def.height + v.y * dt + 0.3); if (cl !== Infinity) v.y = 0; }
      p.y += v.y * dt;
      if (p.y <= ground && v.y <= 0) { p.y = ground; this._land(-v.y); }
    }
    if (this.onGround && col.groundKind !== undefined && p.y > G.level.water + 0.5) { this.safeT = (this.safeT || 0) + dt; if (this.safeT > 0.8) { this.safeT = 0; this.safe.copy(p); } }
    // fell into the sea or out of the world: back to the last safe spot
    if (p.y < G.level.water - 2.5) { p.copy(this.safe); v.set(0, 0, 0); this.onGround = true; this.hurt(8, null, true); }
  }

  _jet(dx, dz) {
    const c = this.ch, j = c.def.jet, G = this.g;
    c.jet--; this.stats.jumps++;
    this.vel.set(dx * j.forward, j.up, dz * j.forward);
    this.onGround = false; this.airTime = 0; this.jetT = j.boost; this.jetting = true; this.slamming = false;
    if (j.clip && c.anim.has(j.clip)) c.anim.full(j.clip, { free: true, ts: 1.4 });
    G.fx.dust(this.pos, c.def.radius * 3, 8);
    G.fx.ring(this.pos, c.def.radius * 3, [1, 0.8, 0.5, 0.6]);
    G.sfx('jet', 75, this.pos);
    G.fx.shake(0.15);
  }
  _jetFx() {
    const c = this.ch;
    const p = c.actor.linkPos('Back', v3, c.def.height * 0.6);
    this.g.fx.jet(p, v1.set(-this.vel.x * 0.2, -14, -this.vel.z * 0.2));
  }
  _land(speed) {
    const G = this.g, c = this.ch, def = c.def;
    this.onGround = true; this.vel.y = 0;
    if (this.jetting || speed > 26) {
      G.fx.dust(this.pos, def.radius * 3, 10);
      G.fx.shake(this.slamming ? 0.5 : 0.2);
      G.sfx(def.radius > 1.5 ? 'landBig' : 'land', 70, this.pos);
      // the landing of a jetpack jump knocks down what stands there; a dive (attack pressed in the air) hits hard
      const j = def.jet, slam = this.slamming;
      const r = slam ? j.slamRadius : j.slamRadius * 0.55;
      G.fx.ring(this.pos, r, [1, 0.85, 0.6, 0.9]);
      for (const e of G.enemies.inRadius(this.pos, r)) e.damage(slam ? j.slamDamage : j.slamDamage * 0.25, { kind: 'slam', from: this.pos, knock: slam ? 26 : 14 });
      if (slam) { G.hitStop(0.06); this.busy = 0.25; }
      c.anim.unlock();
    }
    this.jetting = false; this.slamming = false; this.jetT = 0;
  }

  // ---------------------------------------------------------------- weapons
  setWeapon(i) {
    const c = this.ch;
    if (i < 0 || i >= c.weapons.length || i === c.wi || this.busy > 0) return;
    c.wi = i; c.combo = 0;
    this._equip(c);
    c.anim.upperClip(null);
    this.g.sfx('weapon', 45, null);
  }
  get weapon() { return this.ch.weapons[this.ch.wi]; }

  // where the shots go: what the middle of the screen points at
  _aim() {
    const G = this.g, cam = G.engine.camera;
    const o = cam.getWorldPosition(v1), d = cam.getWorldDirection(v2);
    // start a little in front of the camera so the player's own back is never hit
    const skip = this.firstPerson ? 0.5 : this.camBack + 1;
    const col = G.level.collision;
    let t = col.raycast(o.x + d.x * skip, o.y + d.y * skip, o.z + d.z * skip, d.x, d.y, d.z, 400);
    const e = G.enemies.raycast(v3.copy(o).addScaledVector(d, skip), d, Math.min(t, 400), 0);
    if (e) t = e.t;
    if (t === Infinity) t = 400;
    return this.aimPoint.copy(o).addScaledVector(d, skip + t);
  }
  // where the weapon is held (out) and which way its barrel points (dir), in the world; false if there is none
  barrel(out, dir) {
    const c = this.ch, w = this.weapon.def;
    if (c.barrel) {                                   // a gun that is part of the body: along two bones
      c.barrel[1].getWorldPosition(out);
      dir.copy(out).sub(c.barrel[0].getWorldPosition(v3)).normalize();
      return true;
    }
    const held = c.actor.held.get(w.hand || 'HndR');
    if (!held || !w.barrel) return false;
    held.getWorldPosition(out);
    dir.set(w.barrel[0], w.barrel[1], w.barrel[2]).transformDirection(held.matrixWorld);
    return true;
  }
  muzzle(out) {
    const c = this.ch, w = this.weapon.def, d = this._bd || (this._bd = new THREE.Vector3());
    if (this.barrel(out, d)) return out.addScaledVector(d, w.barrelLen || 1.5);
    return out.copy(this.pos).setY(this.pos.y + c.def.eye * 0.85);
  }

  _weapons(dt, firing) {
    const G = this.g, c = this.ch, w = this.weapon, wd = w.def, I = this.intent;
    c.comboT = Math.max(0, c.comboT - dt);
    // (R reloads the gun even while the claws are out)
    for (const x of c.weapons) if (I.reload && x.def.magazine && x.def.reload && x.ammo < x.def.magazine && x.reload <= 0 && (x === w || c.def.aimToShoot)) this._reload(x);
    this.firing = false;
    if (wd.kind === 'melee') {
      this._upper(wd);
      if ((I.fireEdge || (I.fire && c.comboT > 0 && this.busy <= 0)) && this.busy <= 0) this._claws();
      return;
    }
    const can = w.reload <= 0 && w.ammo >= 1;
    this.firing = firing && can;
    this._upper(wd);
    if (!firing || w.reload > 0) { w.spin = Math.max(0, w.spin - dt * 2); return; }
    if (!can) { if (wd.reload && w.reload <= 0) this._reload(w); else if (I.fireEdge) G.sfx('error', 40, null); return; }
    if (wd.spinUp) { w.spin = Math.min(1, w.spin + dt / wd.spinUp); if (w.spin < 1) return; }
    if (w.cool > 0) return;
    w.cool = 1 / wd.rate;
    this.stats.shots++;
    const target = this._aim();
    const m = this.muzzle(new THREE.Vector3());
    const dir = target.clone().sub(m);
    const dist = dir.length();
    dir.divideScalar(dist || 1);
    // sound
    w.soundT -= 1 / wd.rate;
    if (!wd.soundEvery || w.soundT <= 0) { w.soundT = wd.soundEvery || 0; G.sfx(wd.sounds[Math.floor(Math.random() * wd.sounds.length)], wd.volume, m, 0.94 + Math.random() * 0.12); }
    this.recoil = Math.min(1, this.recoil + wd.kick);
    if (wd.kind === 'bullet') this._bullet(w, m, dir);
    else if (wd.kind === 'flame') this._flame(w, m, dir, dt);
    else if (wd.kind === 'rocket') this._rocket(w, m, dir);
  }
  // upper body: weapon held ready (the first frame of its firing clip), firing, or - sprinting / claws - nothing special
  _upper(wd) {
    const a = this.ch.anim;
    if (this.upperHold || a.locked) return;
    const clip = wd.clip && wd.kind !== 'melee' && !this.sprinting ? a.pick(wd.clip + '#l', wd.clip) : null;
    if (!clip) { if (a.upperName()) a.upperClip(null, { fade: 0.2 }); return; }
    if (wd.kind === 'rocket') {
      // shouldered; each shot plays the rest of the clip once (see _rocket), then back to the shouldered frame
      if (a.upperName() !== wd.clip) a.upperClip(wd.clip, { ts: 0, at: wd.clipAt, fade: 0.2, hold: true });
      return;
    }
    a.upperClip(clip, { ts: this.firing ? 1.2 : 0, fade: 0.15, hold: true });
  }
  _reload(w) {
    w.reload = w.def.reload;
    this.g.sfx('click', 50, null);
    this.g.hud.note('Reloading');
  }
  _spread(dir, deg) {
    const a = Math.random() * 6.283, r = Math.tan(deg * DEG) * Math.sqrt(Math.random());
    const side = v1.crossVectors(dir, UP).normalize(), up = v2.crossVectors(side, dir);
    return dir.clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
  }
  _bullet(w, m, dir) {
    const G = this.g, wd = w.def, col = G.level.collision;
    w.ammo--;
    const d = this._spread(dir, (this.aiming ? wd.spreadAim : wd.spread) * (1 + this.recoil));
    let reach = col.raycast(m.x, m.y, m.z, d.x, d.y, d.z, wd.range);
    const wall = reach !== Infinity ? { x: col.hit.x, y: col.hit.y, z: col.hit.z, n: new THREE.Vector3(col.hit.nx, col.hit.ny, col.hit.nz) } : null;
    if (reach === Infinity) reach = wd.range;
    let from = m.clone(), left = reach, pierce = wd.pierce || 0, end = reach, hitEnemy = false;
    const skip = new Set();
    for (;;) {
      const e = G.enemies.raycast(from, d, left, 0.15, skip);
      if (!e) break;
      hitEnemy = true;
      const hp = from.clone().addScaledVector(d, e.t);
      const head = e.head && !e.enemy.def.animal;
      e.enemy.damage(wd.damage * (head ? CFG.headshot : 1), { kind: 'bullet', dir: d, knock: wd.knock, stagger: wd.stagger, point: hp, head });
      if (pierce-- <= 0) { end = reach - left + e.t; break; }
      skip.add(e.enemy);
      from = hp; left -= e.t;
    }
    const endP = m.clone().addScaledVector(d, end);
    G.fx.tracer(m, endP, wd.tracer, wd.pierce ? 0.14 : 0.09);
    G.fx.muzzle(m, d, wd.pierce ? 1.6 : 1);
    if (Math.random() < 0.5) G.fx.shell(m, v1.set(-d.z, 0, d.x));
    if (!hitEnemy || (wd.pierce && end === reach)) { if (wall) G.fx.impact(wall, wall.n, 'stone'); }
    if (w.ammo <= 0 && wd.reload) this._reload(w);
  }
  _flame(w, m, dir, dt) {
    const G = this.g, wd = w.def;
    w.ammo = Math.max(0, w.ammo - wd.drain / wd.rate);
    w.regen = wd.regenDelay;
    for (let i = 0; i < 3; i++) G.fx.flame(m, v1.copy(dir).multiplyScalar(wd.range * (1.0 + Math.random() * 1.6)).add(this.vel), 1);
    if (Math.random() < 0.3) G.fx.light(m.clone().addScaledVector(dir, 6), 0xff8030, 3, 0.12, 50);
    // everything in the cone that is not behind a wall catches fire
    for (const e of G.enemies.inCone(m, dir, wd.range, Math.cos(wd.cone * DEG))) {
      if (!G.level.collision.clear(m.x, m.y, m.z, e.pos.x, e.pos.y + e.def.height * 0.5, e.pos.z)) continue;
      e.damage(wd.damage, { kind: 'fire', dir, burn: wd.burn, burnDps: wd.burnDps });
    }
  }
  _rocket(w, m, dir) {
    const G = this.g, wd = w.def, c = this.ch;
    w.ammo--; w.regen = 0;
    this.upperHold = 'shot';
    c.anim.upperClip(wd.clip, { loop: false, restart: true, at: wd.clipAt, fade: 0.05, hold: true, onDone: () => { if (this.upperHold === 'shot') this.upperHold = null; c.anim.upperClip(wd.clip, { ts: 0, at: wd.clipAt, restart: true, fade: 0.25, hold: true }); } });
    this.upperHoldT = 1.2;
    G.fx.muzzle(m, dir, 2.2);
    G.fx.dust(m, 1.5, 3, [0.9, 0.9, 0.9, 0.5]);
    G.fx.shake(0.18);
    G.projectiles.fire({ tpl: w.proj, pos: m, vel: dir.clone().multiplyScalar(wd.speed), life: 5, owner: 'player', radius: 0.5,
      trail: (p) => G.fx.rocketTrail(p.pos),
      onHit: (hit) => G.explode(new THREE.Vector3(hit.x, hit.y, hit.z), wd.radius, wd.damage, wd.knock) });
  }

  // the Gunner's knife: a quick swing that shoves enemies back
  _melee() {
    const G = this.g, c = this.ch, m = c.def.melee;
    this.busy = m.time; this.upperHold = 'melee';
    // as in the original's close-combat set: the gun goes to the left hand, the knife into the right
    if (c.meleeTpl) { const w = this.weapon; c.actor.attach('HndR', c.meleeTpl); c.actor.attach('HndL', w.tpl); }
    c.anim.upperClip(m.clip, { loop: false, restart: true, ts: c.anim.duration(m.clip) / m.time * 0.9, fade: 0.06, onDone: () => { this.upperHold = null; this._equip(c); } });
    G.sfx('swing', 60, this.pos);
    this.pending = { t: m.hitAt, fn: () => { if (this._strike(m.range, m.arc, m.damage, m.knock, 'melee')) G.hitStop(0.04); } };
    this.upperHoldT = m.time + 0.3;
  }
  // the Executioner's claws: a three-hit combo, each swing cleaves everything in front
  _claws() {
    const G = this.g, c = this.ch, wd = this.weapon.def;
    if (c.comboT <= 0) c.combo = 0;
    const s = wd.combo[c.combo % wd.combo.length];
    c.combo = (c.combo + 1) % wd.combo.length;
    c.comboT = s.time + wd.comboWindow;
    this.busy = s.time; this.lockMove = s.time * 0.8;
    this.bodyYaw = this.yaw;
    c.anim.full(s.clip, { ts: s.ts, fade: 0.08, onDone: () => {} });
    // step into the swing
    const f = forward(this.yaw, v1);
    this.vel.x = f.x * wd.lunge; this.vel.z = f.z * wd.lunge;
    G.sfx(wd.sounds[0], wd.volume, this.pos, 0.9 + Math.random() * 0.2);
    this.pending = { t: s.hitAt, fn: () => {
      const n = this._strike(s.range, s.arc, s.damage, s.knock, 'claw');
      if (n) { G.hitStop(s.slam ? 0.09 : 0.05); G.fx.shake(s.slam ? 0.45 : 0.2); }
      if (s.slam) { const p = this.pos.clone().addScaledVector(forward(this.yaw, v1), 5); G.fx.ring(p, 9); G.fx.dust(p, 5, 8); G.fx.shake(0.3); G.sfx('landBig', 70, p); }
    } };
  }
  // hit everything within `range` in an arc in front; returns the number of enemies hit
  _strike(range, arcDeg, damage, knock, kind) {
    const G = this.g, f = forward(this.yaw, new THREE.Vector3());
    const o = this.pos.clone().setY(this.pos.y + this.def.height * 0.5);
    let n = 0;
    for (const e of G.enemies.inCone(o, f, range + 1, Math.cos(arcDeg * 0.5 * DEG), true)) {
      e.damage(damage, { kind, dir: f, from: this.pos, knock });
      n++;
    }
    if (n) G.sfx('melee', 70, this.pos, 0.9 + Math.random() * 0.2);
    return n;
  }

  // finish a dazed enemy: restores a pip of armour
  _execute() {
    const G = this.g, c = this.ch, X = CFG.execute;
    const e = G.enemies.executable(this.pos, forward(this.yaw, v1), X.range + c.def.radius);
    if (!e) return;
    this.stats.executions++;
    this.busy = X.time; this.lockMove = X.time; this.invulnerable = Math.max(this.invulnerable, X.invulnerable);
    this.yaw = this.bodyYaw = Math.atan2(-(e.pos.x - this.pos.x), -(e.pos.z - this.pos.z));
    const clip = c.id === 'gunner' ? c.anim.pick('res_sm_kick', 'tec_melee') : c.anim.pick('attack_front_s_1', 'attack_front');
    c.anim.full(clip, { ts: c.anim.duration(clip) / X.time, fade: 0.06 });
    e.hold(X.time);
    G.slowMo(0.35, 0.45);
    this.pending = { t: X.time * 0.5, fn: () => {
      e.damage(1e6, { kind: 'execute', dir: forward(this.yaw, new THREE.Vector3()), from: this.pos, knock: 30 });
      c.armor = Math.min(c.def.armor * c.def.armorPip, c.armor + X.armor * c.def.armorPip);
      c.health = Math.min(c.def.health, c.health + X.heal);
      G.fx.shake(0.4); G.hitStop(0.08);
      G.hud.note('EXECUTION  +armour');
    } };
  }

  swap() {
    const G = this.g;
    const ids = Object.keys(this.chars), other = this.chars[ids[(ids.indexOf(this.active) + 1) % ids.length]];
    if (!other.alive || (this.swapCd > 0 && !this.dead) || this.busy > 0) return false;
    const cur = this.ch;
    cur.actor.obj.visible = false;
    cur.anim.unlock(); cur.anim.upperClip(null);
    this.active = other.id;
    other.actor.obj.visible = true;
    other.anim.unlock(); other.anim.legs(other.def.idleClip, { restart: true });
    this.swapCd = CFG.swapCooldown; this.stats.swaps++;
    this.jetting = false; this.slamming = false; this.dashT = 0; this.upperHold = null; this.pending = null;
    // a bigger body needs room: push it out of the walls it may now stand in
    G.level.collision.pushOut(this.pos, other.def.radius, this.pos.y + CFG.physics.stepHeight, this.pos.y + other.def.height);
    G.fx.ring(this.pos, other.def.radius * 4, [0.6, 0.85, 1, 0.9]);
    G.fx.sparks(this.pos.clone().setY(this.pos.y + other.def.height * 0.5), 16, 16, [0.6, 0.85, 1, 1]);
    G.sfx('swap', 60, null);
    this.invulnerable = Math.max(this.invulnerable, 0.4);
    this._place();
    return true;
  }

  // ---------------------------------------------------------------- damage
  // closest hit of a ray on the player's body (for enemy projectiles): distance or Infinity
  rayHit(o, d, max, pad = 0) {
    if (this.dead) return Infinity;
    const def = this.def, r = def.radius + pad;
    // closest approach of the ray to the body's upright axis
    const px = this.pos.x - o.x, pz = this.pos.z - o.z;
    const dl = d.x * d.x + d.z * d.z;
    let t = dl > 1e-6 ? (px * d.x + pz * d.z) / dl : 0;
    t = Math.max(0, Math.min(max, t));
    const x = o.x + d.x * t - this.pos.x, z = o.z + d.z * t - this.pos.z, y = o.y + d.y * t;
    if (x * x + z * z > r * r || y < this.pos.y - 0.3 || y > this.pos.y + def.height + 0.3) return Infinity;
    return Math.max(0, t - r);
  }
  hurt(amount, from = null, raw = false) {
    const G = this.g, c = this.ch;
    if (this.dead || (!raw && this.invulnerable > 0)) return;
    this.stats.damageTaken += amount;
    c.armorDelay = 5;
    let left = amount;
    if (c.armor > 0) { const a = Math.min(c.armor, left); c.armor -= a; left -= a; if (c.armor <= 0) G.sfx('armorBreak', 70, null); else if (Math.random() < 0.5) G.sfx('hurt', 45, null); }
    c.health -= left;
    G.hud.damage(from ? wrapPi(Math.atan2(-(from.x - this.pos.x), -(from.z - this.pos.z)) - this.yaw) : null, left > 0);
    G.fx.shake(Math.min(0.5, 0.12 + amount / 80));
    if (left > 0 && this.busy <= 0 && !this.firing) c.anim.upperClip(c.def.hurt, { loop: false, restart: true, fade: 0.05 });
    if (c.health <= 0) this._die();
  }
  // shoved by a big hit
  shove(dx, dz, speed) { this.vel.x += dx * speed; this.vel.z += dz * speed; if (this.onGround && speed > 20) { this.vel.y = 9; this.onGround = false; } }
  _die() {
    const G = this.g, c = this.ch;
    c.alive = false; c.health = 0; this.dead = true; this.busy = 0; this.pending = null;
    G.log.add('DOWN', c.def.name + ' | ' + G.log.state());
    c.anim.unlock();
    c.anim.full(c.def.death, { fade: 0.1 });
    G.slowMo(0.3, 1.2);
    const other = Object.values(this.chars).find((x) => x.alive);
    G.hud.note(other ? `${c.def.name} is down - ${other.def.name} takes over` : 'You are dead');
    this.pending = null;
    this.deathT = 2.2;
  }
  // called every step while dead: after a moment the other character takes over, or the game ends
  afterDeath(dt) {
    if (!this.dead) return;
    this.deathT -= dt;
    if (this.deathT > 0) return;
    const other = Object.values(this.chars).find((x) => x.alive);
    if (!other) { this.g.gameOver(false); return; }
    this.dead = false;
    this.swapCd = 0;
    this.swap();
    this.invulnerable = 2.5;
  }

  // ---------------------------------------------------------------- per frame
  animate(dt) {
    const c = this.ch, def = c.def, a = c.anim, v = this.vel;
    const speed = Math.hypot(v.x, v.z);
    if (!this.dead && this.busy <= 0 || (this.busy > 0 && !a.locked)) {
      // direction of travel relative to the aim: 0 forward, +90 deg left
      let off = 0, dir = 1;
      if (speed > 1.2) {
        off = wrapPi(Math.atan2(-v.x, -v.z) - this.yaw);
        if (Math.abs(off) > 100 * DEG) { off = wrapPi(off + Math.PI); dir = -1; }
        off = Math.max(-80 * DEG, Math.min(80 * DEG, off));
      }
      if (this.sprinting) { off = wrapPi(Math.atan2(-v.x, -v.z) - this.yaw); dir = 1; }
      this.legDir = dir;
      const target = wrapPi(this.yaw + off);
      this.bodyYaw = wrapPi(this.bodyYaw + Math.max(-14 * dt, Math.min(14 * dt, wrapPi(target - this.bodyYaw))));
      if (!a.locked) {
        if (!this.onGround && this.airTime > 0.15 && !this.jetting) a.legs(def.runClip, { ts: 0.35, fade: 0.2 });
        else if (speed > 1.2) a.legs(def.runClip, { ts: Math.max(0.5, speed / def.runClipSpeed) * dir, fade: 0.15 });
        else a.legs(def.idleClip, { fade: 0.2 });
      }
    } else if (!this.dead) this.bodyYaw = wrapPi(this.bodyYaw + Math.max(-14 * dt, Math.min(14 * dt, wrapPi(this.yaw - this.bodyYaw))));
    const twist = a.locked ? 0 : Math.max(-95 * DEG, Math.min(95 * DEG, wrapPi(this.yaw - this.bodyYaw)));
    this.twist += (twist - this.twist) * Math.min(1, dt * 16);
    // lean the upper body up / down with the aim while shooting or aiming
    const lean = a.locked || this.dead ? 0 : this.pitch * (this.firing || this.aiming ? 0.75 : 0.3);
    this._place();
    // A gun held ready or firing is pointed where the player aims: the firing poses of the models hold it across
    // the body (the original turns the whole unit instead), so the upper body is turned until the barrel points
    // along the line from the gun to what the middle of the screen shows.
    const wd = this.weapon.def;
    const ready = !this.dead && !a.locked && wd.kind !== 'melee' && this.upperHold !== 'melee' && !this.sprinting && !!a.upperName() && a.upperName() !== def.hurt;
    this.aimW = approach(this.aimW || 0, ready ? 1 : 0, dt * 7);
    const w = this.aimW * this.aimW * (3 - 2 * this.aimW);
    a.update(dt, this.twist * (1 - w), lean * (1 - w));
    if (w > 0.001) {
      const from = this._af || (this._af = new THREE.Vector3()), want = this._aw || (this._aw = new THREE.Vector3()), tmp = this._at || (this._at = new THREE.Vector3());
      c.actor.obj.updateMatrixWorld(true);
      if (this.barrel(from, tmp)) {
        const cp = Math.cos(this.pitch), cam = this.g.engine.camera.position;
        want.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).multiplyScalar(45).add(cam).sub(from).normalize();
        a.aim((out) => { this.barrel(tmp, out); }, want, w);
      }
    }
    // first person with a body that has no gun up: the arms are raised into the picture (the claws at both sides)
    if (def.fpArms) {
      const up = this.firstPerson && !this.dead && !a.locked ? 1 - w : 0;
      this.armsW = approach(this.armsW || 0, up, dt * 6);
      if (this.armsW > 0.001) {
        const axis = v1.set(Math.cos(this.bodyYaw), 0, -Math.sin(this.bodyYaw));
        for (let i = 0; i < def.fpArms.bones.length; i++) {
          a.turn(i, axis, def.fpArms.raise * DEG * this.armsW);
          a.turn(i, UP, (i ? -1 : 1) * def.fpArms.inward * DEG * this.armsW);       // right arm first, then the left
        }
      }
    }
  }
  _place() {
    const o = this.ch.actor.obj;
    o.position.copy(this.pos);
    o.rotation.y = this.bodyYaw;
    // first person: the body is hidden, the weapon in the hands stays
    const fp = this.firstPerson && !this.dead;
    if (fp !== this._fp) {
      this._fp = fp;
      // a body that stays visible in first person loses its head (shrunk to nothing): the eye sits inside it
      for (const ch of Object.values(this.chars)) if (ch.head) ch.head.scale.setScalar(fp ? 0.001 : 1);
      for (const ch of Object.values(this.chars)) {
        const keep = new Set();
        for (const [link, h] of ch.actor.held) if (link !== 'Back') h.traverse((x) => keep.add(x));
        ch.actor.model.traverse((x) => {
          if (!x.isMesh) return;
          if (x.userData.shown === undefined) x.userData.shown = x.visible;       // parts the model hides stay hidden
          x.visible = fp && !ch.def.fpBody ? x.userData.shown && keep.has(x) : x.userData.shown;
        });
      }
    }
  }

  camera(dt, fx) {
    const G = this.g, cam = G.engine.camera, def = this.def, C = CFG.camera, col = G.level.collision;
    const pitch = this.pitch + this.recoil * 0.05;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const dir = v1.set(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
    const right = v2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fovT = this.aiming ? def.aimFov ?? C.fovAim : this.sprinting ? C.fovSprint : C.fov;
    this.fov += (fovT - this.fov) * Math.min(1, dt * 9);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    if (this.firstPerson && !this.dead) {
      cam.position.copy(this.pos).setY(this.pos.y + def.eye).addScaledVector(dir, def.fpForward ?? def.radius * 0.5);
      // a body that stays visible: the eye rides on the head, or a claw swing would put the suit's back in the picture
      const hb = this.ch.head;
      if (hb) {
        const h = hb.getWorldPosition(this._fh || (this._fh = new THREE.Vector3())).sub(this.pos);
        const hs = this._fhs || (this._fhs = h.clone());
        if (this._fhFor !== this.ch) { hs.copy(h); this._fhFor = this.ch; } else hs.lerp(h, Math.min(1, dt * 14));
        cam.position.copy(this.pos).add(hs).addScaledVector(dir, def.fpForward || 0);
        cam.position.y += def.fpHead[1];
      }
      // With a gun in the hands the view sits just behind, above and beside it, so the weapon is always in the
      // lower corner of the picture wherever the animation holds it (the place is smoothed: no shaking with the arms).
      const fg = this.weapon.def.fpGun || def.fpGun, a = this._fa || (this._fa = new THREE.Vector3()), b = this._fb || (this._fb = new THREE.Vector3());
      if (fg && (this.aimW || 0) > 0.01 && this.barrel(a, b)) {
        a.sub(this.pos);
        const want = this._fw || (this._fw = new THREE.Vector3()), s = this._fs || (this._fs = new THREE.Vector3());
        want.set(a.dot(right), a.y, a.x * dir.x + a.z * dir.z);              // where the grip is: right, up, forward (flat)
        if (!this._fsOn) { s.copy(want); this._fsOn = true; } else s.lerp(want, Math.min(1, dt * 10));
        const fl = Math.hypot(dir.x, dir.z) || 1;
        b.copy(this.pos).addScaledVector(right, s.x + fg[0]).addScaledVector(v3.set(dir.x / fl, 0, dir.z / fl), s.z).setY(this.pos.y + s.y);
        b.addScaledVector(dir, -fg[2]).addScaledVector(v3.crossVectors(right, dir), fg[1]);
        cam.position.lerp(b, this.aimW);
      } else this._fsOn = false;
      this.camBack = 0;
    } else {
      const [cr, cu, cb] = def.camera;
      const k = this.aiming ? 0.62 : 1;
      const pivot = v3.copy(this.pos).setY(this.pos.y + cu * (this.aiming ? 0.93 : 1));
      // shoulder offset, pulled in if a wall is beside the character
      let side = cr * this.shoulder * (this.aiming ? 1.15 : 1);
      const ts = col.raycast(pivot.x, pivot.y, pivot.z, right.x * Math.sign(side), 0, right.z * Math.sign(side), Math.abs(side) + 0.6);
      if (ts !== Infinity) side = Math.sign(side) * Math.max(0, ts - 0.6);
      pivot.addScaledVector(right, side);
      let back = cb * k;
      const t = col.raycast(pivot.x, pivot.y, pivot.z, -dir.x, -dir.y, -dir.z, back + 0.8);
      if (t !== Infinity) back = Math.max(0.6, t - 0.8);
      // come closer at once, move away smoothly
      this.camBack = back < this.camBack ? back : this.camBack + (back - this.camBack) * Math.min(1, dt * 6);
      cam.position.copy(pivot).addScaledVector(dir, -this.camBack);
    }
    cam.position.add(fx.shakeOffset);
    cam.rotation.set(pitch, this.yaw, fx.shakeRoll, 'YXZ');
    cam.updateMatrixWorld();
  }
}
