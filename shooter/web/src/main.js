// ParaWorld shooter - start-up, the frame loop and the glue between the parts.
//
//   engine.js      renderer, sun, shadows            level.js       the map: ground, city, collision data
//   collision.js   what is solid                     nav.js         where the swarm can walk
//   player.js      the two player characters         enemies.js     the swarm
//   projectiles.js rockets, spears, arrows           mission.js     objectives and the spawn director
//   fx.js          particles, tracers, shake         hud.js         everything drawn over the view, menus
//   config.js      every number worth tuning
//
// The simulation runs in fixed steps of 1/60 s (player, enemies, projectiles, mission); drawing, animation and the
// camera run once per displayed frame. `game.timeScale` slows both (hit-stop, slow motion).
import * as THREE from 'three';
import { initAssets, Assets } from './pw/engine/assets.js';
import { Audio } from './pw/engine/audio.js';
import { CFG } from './game/config.js';
import { Engine } from './game/engine.js';
import { Input } from './game/input.js';
import { loadLevel } from './game/level.js';
import { NavGrid } from './game/nav.js';
import { FX } from './game/fx.js';
import { Player } from './game/player.js';
import { Enemies } from './game/enemies.js';
import { Projectiles } from './game/projectiles.js';
import { Mission } from './game/mission.js';
import { Hud } from './game/hud.js';
import { Log } from './game/log.js';
import { Zones } from './game/zones.js';
import { Allies } from './game/allies.js';
import { MISSIONS, useMission } from './game/missions.js';
import { Weather } from './game/weather.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const TEST = params.has('test');

class Game {
  constructor() {
    this.settings = { ...CFG.settings, showFps: false };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('pwshooter.settings') || '{}')); } catch (e) { /* first start */ }
    if (params.get('quality')) this.settings.quality = params.get('quality');
    if (params.get('difficulty')) this.settings.difficulty = params.get('difficulty');
    this.settings.test = TEST;
    this.state = 'loading';            // loading | menu | play | pause | end
    this.timeScale = 1; this.stop = 0; this.slow = null;
    this.time = 0; this.acc = 0; this.flowT = 0;
    this.log = new Log(!params.has('nolog'));
    this.hud = new Hud(this);
  }

  async load() {
    const hud = this.hud;
    const info = await (await fetch('api/info')).json();
    // which mission: ?mission=<id>, or asked first (tests: the Holy City unless told otherwise)
    let mid = params.get('mission');
    if (!mid && !TEST && info.ready) {
      const list = Object.values(MISSIONS);
      // (a mission whose map this installation does not have - a fan map of a mod - cannot be chosen)
      await Promise.all(list.map(async (m) => { try { m.available = m.map.startsWith('gen:') || (await fetch(m.map)).ok; } catch (e) { m.available = false; } }));
      this.previous = await this.log.previous();
      mid = await new Promise((res) => hud.missions(list, res));
    }
    this.missionDef = useMission(mid);
    this.missionObjectives = CFG.mission.objectives; this.missionReserved = CFG.mission.reserved;
    // ?from=<objective>: take the mission up at that checkpoint (only real checkpoints, except in tests)
    const f = +params.get('from') || 0, ob = CFG.mission.objectives[f];
    this.from = f > 0 && ob && (ob.checkpoint || TEST) ? f : 0;
    this.stored = TEST ? 0 : Mission.stored(CFG.missionId);
    hud.loading(0, 'Starting');
    this.logDir = info.logs || null;
    if (!info.ready) { this.log.add('STOP', info.reason); hud.error(info.reason); this.error = info.reason; return; }
    if (TEST) this.previous = null; else if (this.previous === undefined) this.previous = await this.log.previous();
    const canvas = document.getElementById('game');
    this.engine = new Engine(canvas, this.settings);
    this.scene = this.engine.scene;
    this.input = new Input(canvas);
    this.log.attach(this);
    THREE.Cache.enabled = true;          // one image per file, however many models use it (see engine.warm)
    await initAssets('data/assets/');
    Assets.maxAniso = Math.min(8, this.engine.renderer.capabilities.getMaxAnisotropy());
    const gamedata = await (await fetch('data/gamedata.json')).json();
    this.audio = new Audio('data/assets/');
    await this.audio.load();
    // lists for sound keys that are patterns
    this.soundLists = {};
    for (const [k, v] of Object.entries(CFG.sounds)) if (v instanceof RegExp) this.soundLists[k] = Object.keys(this.audio.db.files).filter((f) => v.test(f));

    this.level = await loadLevel(this.scene, { map: CFG.map, gamedata }, (f, t) => hud.loading(f * 0.6, t));
    hud.loading(0.62, 'Finding the streets');
    await new Promise((r) => setTimeout(r, 0));
    let S = CFG.mission.start;
    if (!S) { const o = this.level.objects.find((q) => q.type === 'SLOC'); S = CFG.mission.start = { x: o ? o.x : 0, z: o ? o.z : 0, yaw: 0 }; }
    for (const z of CFG.zones.list) if (!z.seed) z.seed = [S.x, S.z];
    const sy = this.level.collision.groundAt(S.x, S.z, this.level.height(S.x, S.z) + 3);
    this.nav = new NavGrid(this.level.collision, this.level.size, { ...CFG.nav, water: this.level.water });
    this.nav.build([{ x: S.x, y: sy, z: S.z }], this.level.bounds);
    this.navBig = this.nav.wide(CFG.nav.wideCells);        // for the big dinosaurs: keeps clear of walls
    this.zones = new Zones(this);
    const zr = this.zones.build();
    if (zr.leaks.length) console.error('zones: ' + zr.leaks.join('; '));

    this.fx = new FX(this.scene, this.engine.camera, 'data/assets/tex/', (x, z) => this.level.collision.groundAt(x, z, 1e9));
    this.projectiles = new Projectiles(this);
    this.player = new Player(this);
    await this.player.load((f, t) => hud.loading(0.66 + f * 0.14, t));
    this.enemies = new Enemies(this);
    this.enemies.nav = this.nav;
    this.enemies.navBig = this.navBig;
    await this.enemies.load((f, t) => hud.loading(0.8 + f * 0.2, t));
    if (CFG.allies && CFG.allies.count > 0) { this.allies = new Allies(this); await this.allies.load((f, t) => hud.loading(0.97 + f * 0.03, t)); }
    this.mission = new Mission(this);
    await this.mission.preload();
    if (CFG.weather) this.weather = new Weather(this);

    this.player.active = params.get('class') || 'gunner';
    this.player.spawn(S.x, S.z, S.yaw);
    this.nav.flowTo(this.player.pos.x, this.player.pos.y, this.player.pos.z);
    this.player.camera(1, this.fx);
    // the graphics card gets everything before the first frame, in small portions (engine.warm)
    this.engine.followSun(this.player.pos);
    const roots = [...this.enemies.templates.values(), ...(this.allies ? this.allies.templates.values() : [])].map((t) => t && t.scene);
    for (const r of this.player.rides.values()) roots.push(r.actor.obj);          // (what the player will ride: no hitch when he mounts)
    const warm = await this.engine.warm(roots, (f, t) => hud.loading(f, t));
    THREE.Cache.clear();                 // (the files themselves are not needed any more)
    this.log.add('WARM', `${warm.textures} textures of ${warm.images} images in ${warm.texMs} ms, on the card ${this.engine.renderer.info.memory.textures}, shaders ${warm.shaderMs} ms, first frame ${warm.frameMs} ms`);
    this.warm = warm;
    // if the driver gives up all the same, say so instead of leaving a white picture
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.state === 'play') { this.state = 'pause'; this.input.unlock(); }
      hud.screen(`<div class="panel"><h1>The picture is gone</h1><p>The graphics driver has reset the game's 3D context (it took too long over one frame, or ran out of video memory). Nothing is wrong with the game data.</p>
        <div class="pick one"><button data-a="reload"><b>Start again</b></button></div><p class="hint">If it happens again: choose Graphics "Medium" on the start screen, and close other programs that use the graphics card.</p>${hud.logNote()}</div>`, 'menu')
        .querySelector('[data-a=reload]').addEventListener('click', () => this.restart());
    });
    this.input.onLockChange = (locked) => { if (!locked && this.state === 'play' && !TEST) this.pause(); };
    this.state = 'menu';
    this.ready = true;
    this.log.add('LOADED', `map ${CFG.map}, ${this.level.objects.length} objects, nav ${this.nav.cells} cells, ${Math.round(performance.now() / 1000)} s after opening the page`);
    // Leaving the page in the middle of a fight (Ctrl+W, Alt+F4, a stray click on "back") asks first
    addEventListener('beforeunload', (e) => { if ((this.state === 'play' || this.state === 'pause') && !TEST && !this.leaving) { this.log.add('PAGE', 'the browser wants to close or leave the page - asking to confirm'); this.log.flush(); e.preventDefault(); e.returnValue = ''; } });
    if (TEST && params.has('autostart')) { hud.screen(''); this.begin(this.player.active, false); } else hud.start((cls) => this.begin(cls, true));
  }

  begin(cls, lock) {
    const P = this.player;
    if (P.active !== cls) { P.ch.actor.obj.visible = false; P.active = cls; P.ch.actor.obj.visible = true; P.ch.anim.legs(P.def.idleClip); }
    this.audio.init();
    this.applySettings();
    const D = CFG.difficulty[this.settings.difficulty] || CFG.difficulty.normal;
    this.enemies.damageScale = D.damage; this.enemies.healthScale = D.health;
    this.hud.screen('');
    if (lock) this.input.lock();
    this.state = 'play';
    this.log.add('BEGIN', `${cls}, difficulty ${this.settings.difficulty}, quality ${this.settings.quality}`);
    // at a checkpoint (?from=<objective>, set by "Continue from the checkpoint")
    const from = this.from || 0;
    if (from > 0) { let [x, z, yaw] = Mission.place(from); const c = this.nav.nearest(x, z, null, 10); if (c >= 0) { x = this.nav.cx(c); z = this.nav.cz(c); } P.spawn(x, z, yaw); this.nav.flowTo(P.pos.x, P.pos.y, P.pos.z); }
    else if (!TEST) Mission.store(CFG.missionId, 0);          // a new attempt from the beginning: the old checkpoint is gone
    this.mission.start(from);
    if (from > 0 && this.allies) this.allies.reinforce(CFG.allies.group * 2, [P.pos.x, P.pos.z]);
    this.music(this.mission.obj && this.mission.obj.type === 'boss' ? 'boss' : this.mission.obj && this.mission.obj.ride ? 'ride' : 'fight');
  }
  // the music for what is going on: 'fight' | 'boss' | 'ride' (CFG.tracks; the mission asks with every new objective)
  music(kind) {
    if (!this.settings.music) return;
    const T = CFG.tracks[CFG.music] || CFG.tracks.Aje;
    try { this.audio.playList(kind, T[kind] || T.fight); } catch (e) { /* no music files */ }
  }
  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    this.log.add('PAUSE', this.log.state());
    this.hud.pause(() => { this.hud.screen(''); this.input.lock(); this.state = 'play'; }, () => this.restart());
  }
  // again from the start of this mission (other = true: back to the choice of missions)
  // from: at that checkpoint (an objective's number)
  restart(other = false, from = 0) { this.leaving = true; this.log.add('RESTART', from ? 'at checkpoint ' + from : ''); location.href = location.pathname + (TEST ? location.search : other ? '' : '?mission=' + CFG.missionId + (from ? '&from=' + from : '')); }
  gameOver(win) {
    if (this.state === 'end') return;
    this.state = 'end';
    this.log.add('END', (win ? 'mission complete' : 'player dead') + ' | ' + this.log.state());
    this.input.unlock();
    const M = this.mission, P = this.player;
    this.sfx(win ? 'success' : 'warn', 80, null);
    setTimeout(() => this.hud.end(win, { kills: M.ownKills, executions: P.stats.executions, time: M.time, damage: P.stats.damageTaken, checkpoint: M.checkpoint || 0 }, () => this.restart()), win ? 1800 : 600);
  }
  applySettings() {
    const s = this.settings;
    try { localStorage.setItem('pwshooter.settings', JSON.stringify({ quality: s.quality, difficulty: s.difficulty, sensitivity: s.sensitivity, invertY: s.invertY, volume: s.volume, blood: s.blood, numbers: s.numbers, showFps: s.showFps, music: s.music })); } catch (e) { /* private mode */ }
    if (this.engine && s.quality !== this._q) { this._q = s.quality; this.engine.applyQuality(); }
    if (this.audio) { this.audio.vol.master = s.volume; this.audio.applyVolumes(); }
    if (this.hud) this.hud.fps.style.display = s.showFps ? '' : 'none';
  }

  // ---------------------------------------------------------------- helpers the parts call
  // play a sound: a key of CFG.sounds or a file path; pos = null plays it at full volume everywhere
  sfx(name, vol = 70, pos = null, rate = 1) {
    const A = this.audio;
    if (!A || !A.ctx) return;
    let v = this.soundLists[name] || CFG.sounds[name] || name;
    if (Array.isArray(v)) v = v[Math.floor(Math.random() * v.length)];
    const f = A.db.files[String(v).toLowerCase()];
    if (f) A.playFile(f, vol, pos, 90, 'sfx', rate);
  }
  hitStop(t) { this.stop = Math.max(this.stop, t); }
  slowMo(scale, time) { this.slow = { scale, t: time, max: time }; }
  explode(pos, radius, damage, knock) {
    const P = this.player;
    this.fx.explosion(pos, radius);
    this.sfx('explode', 95, pos, 0.9 + Math.random() * 0.2);
    for (const e of this.enemies.inRadius(pos, radius)) {
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      const f = 1 - 0.65 * Math.min(1, d / radius);
      e.damage(damage * f, { kind: 'explosion', from: pos, knock: knock * (0.5 + 0.5 * f) });
    }
    // too close to your own rocket
    const d = P.pos.distanceTo(pos);
    if (d < radius * 0.7) { P.hurt(damage * 0.12 * (1 - d / radius), pos); P.shove((P.pos.x - pos.x) / (d || 1), (P.pos.z - pos.z) / (d || 1), 14); }
  }
  onKill(e, info) {
    this.mission.onKill(e, info);
    if (!e.def.animal && Math.random() < 0.4) this.sfx('deathVoice', 55, e.pos, 0.95 + Math.random() * 0.15);
    if (info && (info.kind === 'bullet' || info.kind === 'fire')) this.sfx('hitFlesh', 45, e.pos);
  }

  // ---------------------------------------------------------------- simulation and frame
  sim(dt) {
    const P = this.player;
    P.step(dt);
    P.afterDeath(dt);
    if (this.state !== 'play') return;
    this.flowT -= dt;
    if (this.flowT <= 0) {
      this.flowT = 0.3;
      this.nav.flowTo(P.pos.x, P.onGround ? P.pos.y : null, P.pos.z);
      if (this.enemies.big > 0) this.navBig.flowTo(P.pos.x, P.onGround ? P.pos.y : null, P.pos.z);
    }
    this.enemies.step(dt);
    if (this.allies) this.allies.step(dt);
    this.projectiles.step(dt);
    this.mission.step(dt);
  }
  // one displayed frame: real = real seconds since the last one
  frame(real) {
    if (this.stop > 0) { this.stop -= real; this.timeScale = 0.02; } else if (this.slow) {
      const s = this.slow; s.t -= real;
      // ease back to normal speed at the end
      this.timeScale = s.t <= 0 ? 1 : s.scale + (1 - s.scale) * Math.max(0, 1 - s.t / (s.max * 0.4));
      if (s.t <= 0) this.slow = null;
    } else this.timeScale = 1;
    const playing = this.state === 'play';
    const dt = playing ? real * this.timeScale : 0;
    if (playing) {
      this.player.look(this.input, this.settings);
      this.acc += dt;
      let n = 0;
      while (this.acc >= STEP && n < 6) { this.sim(STEP); this.acc -= STEP; n++; }
      if (n === 6) this.acc = 0;
      this.time += dt;
    }
    this.input.endFrame();
    const cam = this.engine.camera;
    this.player.animate(dt);
    this.enemies.animate(dt, cam);
    if (this.allies) this.allies.animate(dt, cam);
    this.fx.update(dt, this.time);
    this.player.camera(real, this.fx);
    if (this.debugCam) this.debugCam(cam);                 // tests: look from somewhere else
    this.level.update(cam, this.time);
    if (this.weather) this.weather.update(cam, real);
    this.zones.update(real, performance.now() / 1000);
    this.engine.followSun(this.player.pos);
    this.audio.listener.copy(cam.position); this.audio.yaw = this.player.yaw;
    this.hud.update(real, this._fps);
  }
  render() { this.engine.render(); }
}

const game = window.G = new Game();
let last = 0, fc = 0, ft = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (!game.ready || window.__freeze) { last = now; return; }
  const elapsed = (now - last) / 1000 || 0.016;
  const real = Math.min(0.1, elapsed);              // a long hitch (tab in the background) must not become one huge step
  last = now;
  fc++; ft += elapsed;
  if (ft >= 0.5) { game._fps = Math.round(fc / ft); fc = 0; ft = 0; }
  try { game.frame(real); game.render(); game.log.frame(elapsed * 1000); } catch (e) { console.error(e); game.error = String(e && e.stack || e); game.ready = false; game.hud.error('The game stopped with an error:<br><code>' + String(e && e.stack || e).replace(/</g, '&lt;') + '</code>'); }
}
game.load().then(() => requestAnimationFrame(loop)).catch((e) => { console.error(e); game.error = String(e && e.stack || e); game.hud.error(String(e && e.message || e)); });

// ---------------------------------------------------------------- test hooks (tests/*.js drive the game through these)
// run(seconds, each): advance the game without drawing, in frames of 1/30 s; each(game) is called before every frame
game.test = {
  run(seconds, each) {
    const n = Math.round(seconds * 30);
    for (let i = 0; i < n; i++) { if (each) each(game, i / 30); game.frame(1 / 30); if (game.error) break; }
    return game.test.state();
  },
  state() {
    const P = game.player, M = game.mission, c = P.ch;
    return { state: game.state, class: P.active, pos: [P.pos.x, P.pos.y, P.pos.z].map((v) => +v.toFixed(2)), onGround: P.onGround, health: Math.round(c.health), armor: Math.round(c.armor),
      weapon: P.weapon.id, ammo: Math.round(P.weapon.ammo), alive: game.enemies.alive, bodies: game.enemies.list.length, kills: M.totalKills, objective: M.index, time: +game.time.toFixed(1),
      dead: P.dead, error: game.error || null };
  },
};
