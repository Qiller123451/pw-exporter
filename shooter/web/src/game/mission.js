// The mission: a list of objectives (CFG.mission.objectives) and the "director" that feeds the swarm.
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
    this.kills = 0; this.spawned = 0; this.timer = 0; this.boss = null; this.bossDead = false;
    this.marker = new THREE.Vector3();
    this.done = false; this.time = 0; this.totalKills = 0; this.score = 0;
    this._frustum = new THREE.Frustum(); this._m = new THREE.Matrix4(); this._v = new THREE.Vector3();
  }
  start() { this.next(); }
  next() {
    const G = this.g, list = CFG.mission.objectives;
    this.index++;
    if (this.index >= list.length) { this.done = true; this.obj = null; G.gameOver(true); return; }
    const o = this.obj = list[this.index];
    this.kills = 0; this.spawned = 0; this.timer = 1.5; this.boss = null; this.bossDead = !o.boss;
    const y = G.level.collision.groundAt(o.pos[0], o.pos[1], 500);
    this.marker.set(o.pos[0], y + 5, o.pos[1]);
    G.hud.banner(this.index === 0 ? CFG.mission.title : 'Objective complete', o.text);
    G.log.add('OBJECT', `${this.index}: ${o.text}  (t=${G.time.toFixed(1)}, kills ${this.totalKills})`);
    if (this.index > 0) this.relief();
    G.sfx(this.index === 0 ? 'quest' : 'success', 70, null);
    if (o.boss) this.spawnBoss(o);
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
    if (o.type === 'reach') return '';
    if (o.bossOnly) return this.boss && this.boss.alive ? '' : '';
    return `${Math.min(this.kills, o.count)} / ${o.count}` + (o.boss && !this.bossDead ? '  +  ' + CFG.enemies[o.boss].name : '');
  }

  onKill(e) {
    this.kills++; this.totalKills++; this.score += e.def.score || 1;
    if (e === this.boss) { this.g.log.add('BOSS', e.def.name + ' killed'); this.bossDead = true; this.g.hud.banner(e.def.name + ' is dead', ''); }
  }

  step(dt) {
    const G = this.g, o = this.obj;
    if (!o || this.done) return;
    this.time += dt;
    const P = G.player;
    // done?
    if (o.type === 'reach') {
      if (Math.hypot(P.pos.x - o.pos[0], P.pos.z - o.pos[1]) < o.radius) return this.next();
    } else if (o.bossOnly ? this.bossDead : (this.kills >= o.count && this.bossDead)) return this.next();
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
      if (G.enemies.spawn(pickWeighted(mix), nav.cx(c) + (Math.random() - 0.5), nav.y[c], nav.cz(c) + (Math.random() - 0.5))) { made++; this.spawned++; }
    }
    return made;
  }

  spawnBoss(o) {
    const G = this.g, P = G.player;
    const big = CFG.enemies[o.boss].radius > CFG.nav.bigRadius && G.navBig;
    const nav = big ? G.navBig : G.nav;                    // the big ones start on a wide street
    // on the far side of the objective, seen from the player
    let dx = o.pos[0] - P.pos.x, dz = o.pos[1] - P.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    let c = -1;
    for (const d of [34, 24, 44, 14, 0]) { c = nav.nearest(o.pos[0] + dx * d, o.pos[1] + dz * d, null, 8); if (c >= 0) break; }
    if (c < 0) c = nav.nearest(P.pos.x + dx * 40, P.pos.z + dz * 40, null, 12);
    if (c < 0) { this.bossDead = true; return; }
    this.boss = G.enemies.spawn(o.boss, nav.cx(c), nav.y[c], nav.cz(c));
    if (!this.boss) { this.bossDead = true; G.log.add('BOSS', o.boss + ' could not be spawned'); return; }
    G.log.add('BOSS', `${this.boss.def.name} spawned at ${nav.cx(c).toFixed(0)},${nav.cz(c).toFixed(0)}`);
    G.hud.boss(this.boss);
  }
}
