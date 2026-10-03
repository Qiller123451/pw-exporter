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
    this.done = false; this.time = 0; this.totalKills = 0; this.score = 0;
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._v = new THREE.Vector3();
  }
  get boss() { return this.bosses.find((b) => b.alive) || null; }
  start() { this.next(); }
  next() {
    const G = this.g, list = CFG.mission.objectives;
    this.index++;
    if (this.index >= list.length) { this.done = true; this.obj = null; G.gameOver(true); return; }
    const o = this.obj = list[this.index];
    this.kills = 0; this.spawned = 0; this.timer = 1.5; this.bosses = []; this.targets = []; this.held = 0; this.inside = false;
    let opened = null;
    if (o.zone && G.zones) {
      const zi = G.zones.index(o.zone);
      if (zi > G.zones.open) { G.zones.setOpen(zi, this.index > 0); opened = G.zones.list[zi]; }
    }
    this.setGoal(o.pos[0], o.pos[1], o.radius || 12);
    this.showArea(o.type === 'hold' ? o : null);
    G.hud.banner(this.index === 0 ? CFG.mission.title : opened ? `The way to ${opened.name} is open` : 'Objective complete', o.text);
    G.log.add('OBJECT', `${this.index}: ${o.type} - ${o.text}  (t=${G.time.toFixed(1)}, kills ${this.totalKills}${opened ? ', opened ' + opened.id : ''})`);
    if (this.index > 0) this.relief();
    G.sfx(this.index === 0 ? 'quest' : 'success', 70, null);
    if (o.type === 'destroy') this.spawnTargets(o);
    if (o.type === 'boss') this.spawnBosses(o);
  }
  setGoal(x, z, radius) {
    const y = this.g.level.collision.groundAt(x, z, 500);
    this.goalPos = [x, z]; this.goalRadius = radius;
    this.marker.set(x, y + 5, z);
  }
  // the area of a "hold" objective: a low glowing band around it
  showArea(o) {
    const G = this.g;
    if (!this.area) {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 72, 1, true);
      geo.translate(0, 0.5, 0);
      const c = document.createElement('canvas'); c.width = 4; c.height = 64;
      const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
      this.area = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      this.area.renderOrder = 15;
      G.scene.add(this.area);
    }
    this.area.visible = !!o;
    if (o) { this.area.position.set(o.pos[0], G.level.collision.groundAt(o.pos[0], o.pos[1], 500) - 0.5, o.pos[1]); this.area.scale.set(o.radius, 3.5, o.radius); }
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

  onKill(e) {
    if (e.def.structure) { this.g.log.add('TARGET', `${e.def.name} destroyed`); return; }
    this.kills++; this.totalKills++; this.score += e.def.score || 1;
    if (this.bosses.includes(e)) { this.g.log.add('BOSS', e.def.name + ' killed'); this.g.hud.banner(e.def.name + ' is dead', ''); this.g.hud.boss(this.boss); }
  }

  step(dt) {
    const G = this.g, o = this.obj;
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
      done = this.targets.length > 0 && this.targets.every((t) => !t.alive);
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
    const room = CFG.swarm.max - G.enemies.alive;
    const n = Math.min(W.group, room, W.total - this.spawned);
    if (n <= 0) return;
    this.spawnGroup(n, W.mix);
  }

  // can the camera see this point? (inside the view and nothing in the way)
  seen(x, y, z) {
    const G = this.g, cam = G.engine.camera;
    this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._m);
    if (!this._frustum.containsPoint(this._v.set(x, y + 2, z))) return false;
    return G.level.collision.clear(cam.position.x, cam.position.y, cam.position.z, x, y + 3, z);
  }

  spawnGroup(n, mix) {
    const G = this.g, nav = G.nav, S = CFG.swarm;
    let anchor = nav.pickAtDistance(S.spawnMin, S.spawnMax, 50, (c) => !this.seen(nav.cx(c), nav.y[c], nav.cz(c)));
    if (anchor < 0) anchor = nav.pickAtDistance(S.spawnMax * 0.8, S.spawnMax * 1.6, 60);      // nothing hidden: further away
    if (anchor < 0) return 0;
    const ai = anchor % nav.n, aj = Math.floor(anchor / nav.n);
    let made = 0;
    for (let k = 0; k < n * 6 && made < n; k++) {
      const i = ai + Math.round((Math.random() * 2 - 1) * 4), j = aj + Math.round((Math.random() * 2 - 1) * 4);
      if (i < 0 || j < 0 || i >= nav.n || j >= nav.n) continue;
      const c = j * nav.n + i;
      if (!nav.walkable(c) || nav.distAt(c) === Infinity) continue;
      const type = pickWeighted(mix);
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
    G.log.add('TARGET', `${this.targets.length} targets placed`);
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
