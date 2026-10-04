// The mission: a list of objectives (CFG.mission.objectives) and the "director" that feeds the swarm.
//
// Objective types:
//   reach    walk into the circle (pos, radius)
//   kill     kill `count` enemies
//   hold     stay inside the circle (pos, radius) for `seconds` - the clock only runs while the player is in it
//   destroy  destroy all `targets` [{type (a structure of CFG.enemies), pos: [x, z], yaw}]
//   boss     kill all `bosses` (types of CFG.enemies; they appear at `pos` or at their own `at` points)
// Every objective may name a `zone` that opens when it starts (zones.js blows the rubble away), and has `waves`.
//
// While an objective is active its `waves` keep groups of Dustriders coming: every few seconds a group is spawned on
// a spot that lies 55-120 u of walking away from the player and that the camera cannot see (around a corner, behind
// a house), so the enemies always arrive running. The number alive is capped (CFG.swarm.max).
import * as THREE from 'three';
import { CFG } from './config.js';
import { loadModel } from '../pw/engine/assets.js';

const pickWeighted = (mix) => {
  let total = 0;
  for (const k in mix) total += mix[k];
  let r = Math.random() * total;
  for (const k in mix) { r -= mix[k]; if (r <= 0) return k; }
  return Object.keys(mix)[0];
};

export class Mission {
  constructor(game) {
    this.g = game;
    this.index = -1; this.obj = null;
    this.kills = 0; this.spawned = 0; this.timer = 0; this.bosses = []; this.targets = []; this.held = 0; this.inside = false;
    this.marker = new THREE.Vector3(); this.goalPos = [0, 0]; this.goalRadius = 10;
    this.done = false; this.time = 0; this.totalKills = 0; this.ownKills = 0; this.score = 0;
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._v = new THREE.Vector3();
  }
  get boss() { return this.bosses.find((b) => b.alive) || null; }
  // Buildings that go up when an objective is done (objective.built = [{model, pos: [x, z], yaw, addon: [model,
  // link]}]): the models are loaded with the level, so that nothing stalls in the middle of the fight.
  async preload() {
    this.tpls = new Map();
    const names = new Set();
    for (const o of CFG.mission.objectives) for (const b of o.built || []) { names.add(b.model); if (b.addon) names.add(b.addon[0]); }
    await Promise.all([...names].map(async (n) => { try { this.tpls.set(n, await loadModel(n, { static: true })); } catch (e) { console.warn('building model missing', n, e); } }));
  }
  build(list, fx) {
    const G = this.g, items = [];
    for (const b of list) {
      const tpl = this.tpls && this.tpls.get(b.model);
      if (!tpl) continue;
      const c = G.nav.nearest(b.pos[0], b.pos[1], null, 6);
      items.push({ tpl, x: b.pos[0], z: b.pos[1], y: c >= 0 ? G.nav.y[c] : undefined, yaw: b.yaw, addon: b.addon && this.tpls.get(b.addon[0]) ? { tpl: this.tpls.get(b.addon[0]), link: b.addon[1] } : null });
    }
    if (!items.length) return;
    const placed = G.level.place(items, G.nav);
    if (G.navBig && G.nav.mask) G.navBig.mask = G.nav.mask;
    G.log.add('BUILT', `${placed.length} buildings`);
    if (!fx) return;
    // they rise out of the ground in a cloud of dust
    for (const p of placed) { p.obj.scale.y = 0.02; p.t = -Math.random() * 0.8; (this.rising = this.rising || []).push(p); }
  }
  _rise(dt) {
    for (let i = this.rising.length - 1; i >= 0; i--) {
      const p = this.rising[i];
      p.t += dt / 1.6;
      const k = Math.max(0, Math.min(1, p.t));
      p.obj.scale.y = 0.02 + 0.98 * (1 - (1 - k) * (1 - k));
      if (p.t > 0 && Math.random() < dt * 14) this.g.fx.dust(new THREE.Vector3(p.x + (Math.random() - 0.5) * p.r * 2, p.y + 0.5, p.z + (Math.random() - 0.5) * p.r * 2), 3, 2);
      if (k >= 1) { p.obj.scale.y = 1; this.rising.splice(i, 1); }
    }
  }
  // from > 0: at a checkpoint - the objectives before it count as done
  start(from = 0) { this.garrison(); if (from > 0) this.resume(from); this.next(); }
  // Checkpoints: an objective with `checkpoint: true` is one. Reaching it is remembered (in the browser, per
  // mission); after a defeat - or the next time the game is started - the mission can be taken up there: the
  // districts opened so far are open, what was destroyed is gone, both characters are fresh.
  static stored(id) { try { const c = JSON.parse(localStorage.getItem('pwshooter.checkpoint') || 'null'); return c && c.mission === id && CFG.mission.objectives[c.index] && CFG.mission.objectives[c.index].checkpoint ? c.index : 0; } catch (e) { return 0; } }
  static store(id, index) { try { if (index > 0) localStorage.setItem('pwshooter.checkpoint', JSON.stringify({ mission: id, index })); else localStorage.removeItem('pwshooter.checkpoint'); } catch (e) { /* private mode */ } }
  // where the player stands when he takes the mission up at objective `from`: [x, z, yaw in degrees]
  static place(from) {
    const list = CFG.mission.objectives, o = list[from], at = (o.checkpoint && o.checkpoint.at) || list[from - 1].pos;
    return [at[0], at[1], Math.atan2(-(o.pos[0] - at[0]), -(o.pos[1] - at[1])) * 180 / Math.PI];
  }
  resume(from) {
    const G = this.g, list = CFG.mission.objectives, Z = G.zones;
    let zi = 0;
    for (let i = 0; i < from; i++) if (list[i].zone) zi = Math.max(zi, Z.index(list[i].zone));
    Z.setOpen(zi, false);
    // what the objectives before it had destroyed is not there any more
    let gone = 0;
    for (let i = 0; i < from; i++) {
      if (list[i].type !== 'destroy') continue;
      this.targets = [];
      for (const t of list[i].targets) if (t.near || t.zone) this.pickStanding(t);
      for (const e of this.targets) { G.enemies.recycle(e); gone++; }
    }
    this.targets = [];
    for (let i = 0; i < from; i++) if (list[i].built) this.build(list[i].built, false);
    this.index = from - 1; this.resumed = from;
    // special troops that had joined by then are there again
    if (G.allies) for (let i = 0; i < from; i++) for (const t of [].concat(list[i].arrive || [])) G.allies.arrive(t, Mission.place(from), true);
    G.log.add('CHECKPOINT', `taken up at objective ${from} (zones open up to ${Z.list[zi].id}, ${gone} structures already gone)`);
  }
  // CFG.mission.garrison: structures that stand from the first moment on, wherever the map has them
  // ([{type, map: true}]) - the towers of the city, the boats in the harbour. A "destroy" objective picks its
  // targets among them with {type, zone} or {type, near: [x, z], within}.
  garrison() {
    const G = this.g;
    this.standing = [];
    for (const t of CFG.mission.garrison || []) {
      const models = CFG.enemies[t.type].models;
      for (const m of G.level.mapTargets || []) {
        if (!models.includes(m.model) && !(t.cls && t.cls.test(m.cls))) continue;
        const y = m.ship ? G.level.water - (CFG.enemies[t.type].draft ?? 0.4) : m.y;
        const e = G.enemies.spawn(t.type, m.x, y, m.z, m.rot);
        if (e) { this.standing.push(e); if (t.locked) e.locked = true; }
      }
    }
    if (this.standing.length) G.log.add('TARGET', `${this.standing.length} structures of the garrison placed`);
  }
  next() {
    const G = this.g, list = CFG.mission.objectives;
    // what the troops put up where the fight is over
    if (this.obj && this.obj.built) { this.build(this.obj.built, true); if (this.obj.builtNote) G.hud.note(this.obj.builtNote); }
    this.index++;
    if (this.index >= list.length) { this.done = true; this.obj = null; Mission.store(CFG.missionId, 0); G.gameOver(true); return; }
    const o = this.obj = list[this.index];
    this.kills = 0; this.spawned = 0; this.timer = 1.5; this.bosses = []; this.targets = []; this.held = 0; this.inside = false;
    let opened = null;
    if (o.zone && G.zones) {
      const zi = G.zones.index(o.zone);
      if (zi > G.zones.open) { G.zones.setOpen(zi, this.index > 0); opened = G.zones.list[zi]; }
    }
    this.setGoal(o.pos[0], o.pos[1], o.radius || 12);
    this.showArea(o.type === 'hold' ? o : null);
    const back = this.resumed === this.index;
    if (o.checkpoint && !back) { this.checkpoint = this.index; Mission.store(CFG.missionId, this.index); G.hud.note('Checkpoint reached'); G.log.add('CHECKPOINT', `reached at objective ${this.index}`); }
    if (back) this.checkpoint = this.index;
    G.hud.banner(this.index === 0 ? CFG.mission.title : back ? 'Back at the checkpoint' : opened ? `The way to ${opened.name} is open` : 'Objective complete', o.text);
    G.log.add('OBJECT', `${this.index}: ${o.type} - ${o.text}  (t=${G.time.toFixed(1)}, kills ${this.totalKills}${opened ? ', opened ' + opened.id : ''})`);
    if (this.index > 0) this.relief();
    G.sfx(this.index === 0 ? 'quest' : 'success', 70, null);
    if (o.type === 'destroy') this.spawnTargets(o);
    if (o.type === 'boss') this.spawnBosses(o);
    // fresh troops for this push, at a place of their own (the gate that was just blown, the pier)
    if (o.troops && G.allies) G.allies.reinforce(o.troops, o.rally || null);
    if (o.arrive && G.allies) for (const t of [].concat(o.arrive)) G.allies.arrive(t, o.rally || null);
    // defenders that stand at their places from the start of the objective: [{type, pos}]
    for (const gd of o.guards || []) {
      const big = CFG.enemies[gd.type].radius > CFG.nav.bigRadius && G.navBig, nav = big ? G.navBig : G.nav;
      const c = nav.nearest(gd.pos[0], gd.pos[1], null, 10);
      if (c < 0 || !G.enemies.spawn(gd.type, nav.cx(c), nav.y[c], nav.cz(c))) G.log.add('GUARD', gd.type + ' could not be placed at ' + gd.pos);
    }
  }
  setGoal(x, z, radius) {
    const y = this.g.level.collision.groundAt(x, z, 500);
    this.goalPos = [x, z]; this.goalRadius = radius;
    this.marker.set(x, y + 5, z);
  }
  // the area of a "hold" objective: a low glowing band around it, following the ground
  showArea(o) {
    const G = this.g;
    if (!this.area) {
      const c = document.createElement('canvas'); c.width = 4; c.height = 64;
      const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
      this.area = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      this.area.renderOrder = 15; this.area.frustumCulled = false;
      G.scene.add(this.area);
    }
    this.area.visible = !!o;
    if (!o) return;
    // a strip of quads around the circle, each post standing on the ground where it is
    const N = 96, H = 3.5, pos = [], uv = [], idx = [], col = G.level.collision;
    const yc = col.groundAt(o.pos[0], o.pos[1], 500);
    for (let k = 0; k <= N; k++) {
      const a = k / N * Math.PI * 2, x = o.pos[0] + Math.cos(a) * o.radius, z = o.pos[1] + Math.sin(a) * o.radius;
      let y = col.groundAt(x, z, yc + 12);
      if (!(y > -1e5) || Math.abs(y - yc) > 14) y = yc;                 // (over a drop or a wall: the centre's height)
      pos.push(x, y - 0.4, z, x, y + H, z); uv.push(k / N, 0, k / N, 1);
      if (k < N) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.area.geometry.dispose(); this.area.geometry = geo;
    this.area.position.set(0, 0, 0); this.area.scale.set(1, 1, 1);
  }
  // a breather after every objective: both characters are patched up, a fallen one comes back
  relief() {
    const G = this.g, R = CFG.relief;
    for (const c of Object.values(G.player.chars)) {
      if (!c.alive) { c.alive = true; c.health = c.def.health * R.revive; G.hud.note(c.def.name + ' is back in the fight'); }
      else c.health = Math.min(c.def.health, c.health + c.def.health * R.heal);
      c.armor = c.def.armor * c.def.armorPip;
    }
  }
  progressText() {
    const o = this.obj;
    if (!o) return '';
    switch (o.type) {
      case 'kill': return `${Math.min(this.kills, o.count)} / ${o.count}`;
      case 'hold': return this.inside ? `${Math.ceil(Math.max(0, o.seconds - this.held))} s` : 'get back into the marked area';
      case 'destroy': return `${this.targets.filter((t) => !t.alive).length} / ${this.targets.length}`;
      case 'boss': return this.bosses.length > 1 ? `${this.bosses.filter((b) => !b.alive).length} / ${this.bosses.length}` : '';
      default: return '';
    }
  }

  // (the objective counts every enemy that falls; `ownKills` are the player's own - the number on the screen)
  onKill(e, info) {
    if (e.def.structure) { this.g.log.add('TARGET', `${e.def.name} destroyed`); return; }
    this.kills++; this.totalKills++; this.score += e.def.score || 1;
    if (!(info && info.ally)) this.ownKills++;
    if (this.bosses.includes(e)) { this.g.log.add('BOSS', e.def.name + ' killed'); this.g.hud.banner(e.def.name + ' is dead', ''); this.g.hud.boss(this.boss); }
  }

  step(dt) {
    const G = this.g, o = this.obj;
    if (this.rising && this.rising.length) this._rise(dt);
    if (!o || this.done) return;
    this.time += dt;
    const P = G.player;
    const dist = Math.hypot(P.pos.x - o.pos[0], P.pos.z - o.pos[1]);
    // done?
    let done = false;
    if (o.type === 'reach') done = dist < o.radius;
    else if (o.type === 'kill') done = this.kills >= o.count;
    else if (o.type === 'hold') {
      this.inside = dist < o.radius && !P.dead;
      if (this.inside) this.held += dt;
      done = this.held >= o.seconds;
      this.area.material.color.setHex(this.inside ? 0x66ff88 : 0xff8844);
    }
    else if (o.type === 'destroy') {
      done = this.targets.every((t) => !t.alive);
      // the marker points at the nearest one still standing
      let best = null, bd = 1e9;
      for (const t of this.targets) { if (!t.alive) continue; const d = t.pos.distanceTo(P.pos); if (d < bd) { bd = d; best = t; } }
      if (best) { this.goalPos = [best.pos.x, best.pos.z]; this.goalRadius = best.def.radius + 16; this.marker.set(best.pos.x, best.pos.y + best.def.height + 2, best.pos.z); }
    } else if (o.type === 'boss') {
      done = this.bosses.every((b) => !b.alive);
      const b = this.boss;
      if (b) { this.goalPos = [b.pos.x, b.pos.z]; this.goalRadius = 40; this.marker.set(b.pos.x, b.pos.y + b.def.height + 2, b.pos.z); }
    }
    if (done) return this.next();
    // waves
    const W = o.waves;
    if (!W || P.dead) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = W.every;
    const room = CFG.swarm.max - G.enemies.fighting;
    const n = Math.min(W.group, room, W.total - this.spawned);
    if (n <= 0) return;
    this.spawnGroup(n, W.mix, W.heavy);
  }

  // can the camera see this point? (inside the view and nothing in the way)
  seen(x, y, z) {
    const G = this.g, cam = G.engine.camera;
    this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    if (!this._frustum.containsPoint(this._v.set(x, y + 2, z))) return false;
    return G.level.collision.clear(cam.position.x, cam.position.y, cam.position.z, x, y + 3, z);
  }

  spawnGroup(n, mix, heavy = null) {
    const G = this.g, nav = G.nav, S = CFG.swarm;
    // objective.from = [x, z]: the enemy only comes from that side - from places nearer to it than the player is
    const o = this.obj, P = G.player;
    const pd = o && o.from ? Math.hypot(P.pos.x - o.from[0], P.pos.z - o.from[1]) : 0;
    const side = o && o.from ? (c) => Math.hypot(nav.cx(c) - o.from[0], nav.cz(c) - o.from[1]) < pd + (o.fromSlack ?? -12) : () => true;      // (fromSlack: how much further than the player a place may be)
    let anchor = nav.pickAtDistance(S.spawnMin, S.spawnMax, 60, (c) => side(c) && !this.seen(nav.cx(c), nav.y[c], nav.cz(c)));
    if (anchor < 0) anchor = nav.pickAtDistance(S.spawnMax * 0.8, S.spawnMax * 1.6, 80, side);      // nothing hidden: further away
    if (anchor < 0) return 0;
    const ai = anchor % nav.n, aj = Math.floor(anchor / nav.n);
    // waves.heavy = {type: share of a wave}: the big beasts come on a count, not by the dice of the mix - as one
    // of some two hundred in the mix (0.12 of 21) not one Brachiosaurus turned up in a whole fight. 0.1 = one with
    // every tenth wave, the first after the third; never more at a time than their `maxAlive`.
    for (const type in heavy || {}) {
      const due = this.due || (this.due = {});
      due[type] = Math.min(1, (due[type] ?? 0.7) + heavy[type]);
      const cap = CFG.enemies[type].maxAlive;
      if (due[type] < 1 || (cap && G.enemies.list.reduce((t, e) => t + (e.alive && e.type === type ? 1 : 0), 0) >= cap)) continue;
      const wide = CFG.enemies[type].radius > CFG.nav.bigRadius && G.navBig;
      // they come from where the mission is heading (the next place it leads to), not out of the conquered streets
      // behind the player: there the first Brachiosaurus walked into the arriving SEAS troops and was dead before
      // anyone had seen it
      const list = CFG.mission.objectives, here = o && o.pos ? o.pos : this.goalPos;
      let far = here;
      for (let q = this.index + 1; q < list.length; q++) if (list[q].pos && Math.hypot(list[q].pos[0] - here[0], list[q].pos[1] - here[1]) > 60) { far = list[q].pos; break; }
      const fd = Math.hypot(P.pos.x - far[0], P.pos.z - far[1]);
      const ahead = (c) => far === here || Math.hypot(nav.cx(c) - far[0], nav.cz(c) - far[1]) < fd + 5;
      const fits = (c) => side(c) && ahead(c) && (!wide || G.navBig.walkable(c));
      let c = nav.pickAtDistance(S.spawnMin, S.spawnMax, 80, (c) => fits(c) && !this.seen(nav.cx(c), nav.y[c], nav.cz(c)));
      if (c < 0) c = nav.pickAtDistance(S.spawnMin, S.spawnMax * 1.4, 80, fits);
      if (c < 0) continue;
      if (G.enemies.spawn(type, nav.cx(c), nav.y[c], nav.cz(c))) { due[type] -= 1; this.spawned++; G.log.add('HEAVY', `${type} joins the wave at ${Math.round(nav.cx(c))}, ${Math.round(nav.cz(c))}`); }
    }
    let made = 0;
    for (let k = 0; k < n * 6 && made < n; k++) {
      const i = ai + Math.round((Math.random() * 2 - 1) * 4), j = aj + Math.round((Math.random() * 2 - 1) * 4);
      if (i < 0 || j < 0 || i >= nav.n || j >= nav.n) continue;
      const c = j * nav.n + i;
      if (!nav.walkable(c) || nav.distAt(c) === Infinity) continue;
      const type = pickWeighted(mix);
      // (never more of the big ones at a time than their `maxAlive`)
      const cap = CFG.enemies[type].maxAlive;
      if (cap && G.enemies.list.reduce((s, e) => s + (e.alive && e.type === type ? 1 : 0), 0) >= cap) continue;
      // the wide ones only where there is room for them
      if (CFG.enemies[type].radius > CFG.nav.bigRadius && G.navBig && !G.navBig.walkable(c)) continue;
      if (G.enemies.spawn(type, nav.cx(c) + (Math.random() - 0.5), nav.y[c], nav.cz(c) + (Math.random() - 0.5))) { made++; this.spawned++; }
    }
    return made;
  }

  // the things to destroy: structures standing at fixed places (on the ground, or on the water)
  spawnTargets(o) {
    const G = this.g, col = G.level.collision;
    // {type, map: true}: every object of that kind the map itself has (the camp's own tents), where the map has them
    const list = [];
    for (const t of o.targets) {
      // the garrison's own, near a place
      // the garrison's own: those of a district ({type, zone}) or near a place ({type, near, within}) - never one
      // that stands where the player cannot go yet
      if (t.near || t.zone) { this.pickStanding(t); continue; }
      if (!t.map) { list.push(t); continue; }
      const models = CFG.enemies[t.type].models;
      for (const m of G.level.mapTargets || []) {
        if (!models.includes(m.model) || (G.zones && G.zones.zoneAt(m.x, m.z) > G.zones.open)) continue;
        list.push({ type: t.type, pos: [m.x, m.z], yaw: m.rot * 180 / Math.PI });
      }
    }
    for (const t of list) {
      const ground = col.groundAt(t.pos[0], t.pos[1], 500);
      const y = ground < G.level.water ? G.level.water - 0.4 : ground;
      const e = G.enemies.spawn(t.type, t.pos[0], y, t.pos[1], (t.yaw || 0) * Math.PI / 180);
      if (e) this.targets.push(e); else G.log.add('TARGET', t.type + ' could not be placed');
    }
    G.log.add('TARGET', `${this.targets.length} targets`);
    if (!this.targets.length) G.log.add('TARGET', 'nothing left to destroy here - objective done');
  }

  pickStanding(t) {
    const G = this.g, Z = G.zones, zi = t.zone ? Z.index(t.zone) : -1;
    for (const e of this.standing || []) {
      if (!e.alive || e.type !== t.type) continue;
      e.locked = false;                                  // (its turn has come - wherever it stands)
      const ez = Z.zoneAt(e.pos.x, e.pos.z);
      if (ez > Z.open || (t.zone && ez !== zi) || (t.near && Math.hypot(e.pos.x - t.near[0], e.pos.z - t.near[1]) >= t.within)) continue;
      this.targets.push(e);
    }
  }

  spawnBosses(o) {
    const G = this.g, P = G.player;
    (o.bosses || []).forEach((type, k) => {
      const def = CFG.enemies[type];
      const big = def.radius > CFG.nav.bigRadius && G.navBig;
      const nav = big ? G.navBig : G.nav;                    // the big ones start on a wide street
      const at = (o.at && o.at[k]) || o.pos;
      // at its place; if the player already stands there, on the far side of it
      let dx = at[0] - P.pos.x, dz = at[1] - P.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      let c = -1;
      for (const d of l > 45 ? [0, 10, 20] : [34, 24, 44, 14, 0]) { c = nav.nearest(at[0] + dx * d, at[1] + dz * d, null, 8); if (c >= 0) break; }
      if (c < 0) c = nav.nearest(P.pos.x + dx * 40, P.pos.z + dz * 40, null, 12);
      const e = c >= 0 ? G.enemies.spawn(type, nav.cx(c), nav.y[c], nav.cz(c)) : null;
      if (!e) { G.log.add('BOSS', type + ' could not be spawned'); return; }
      G.log.add('BOSS', `${e.def.name} spawned at ${nav.cx(c).toFixed(0)},${nav.cz(c).toFixed(0)}`);
      this.bosses.push(e);
    });
    G.hud.boss(this.boss);
  }
}
