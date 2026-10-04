// Everything drawn over the 3D view: crosshair, health and armour, weapon and ammunition, abilities, the objective
// with its marker, kill counter, hit markers, damage flashes, the boss bar, messages and the menu screens.
// Plain DOM elements (style.css); update() is called once per frame.
import * as THREE from 'three';
import { CFG } from './config.js';

const RANK = { '': 0, fire: 1, big: 2, head: 3 };          // which colour a damage number gets when hits of several kinds add up
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const KEYS = [
  ['W A S D', 'move'], ['Mouse', 'aim'], ['Left button', 'Gunner: fire &nbsp; Executioner: claw combo'], ['Right button', 'Gunner: aim down the sights &nbsp; Executioner: raise the minigun (left button then fires)'], ['1 2 3 / wheel', 'change weapon (Gunner)'],
  ['Tab', 'swap Gunner / Executioner'], ['Q', 'jetpack jump (F in the air: dive)'], ['Space', 'jump'], ['Shift', 'sprint'], ['Ctrl', 'dash (no damage taken; the Executioner rams what is in the way)'],
  ['F', 'knife (Gunner)'], ['G', 'Gunner: bombardment all around (once a minute)'], ['E', 'execute a reeling enemy: restores armour'], ['R', 'reload'], ['V', 'first / third person'], ['X', 'camera over the other shoulder'], ['Esc', 'pause'],
];

export class Hud {
  constructor(game) {
    this.g = game;
    const root = this.root = document.getElementById('hud');
    root.innerHTML = '';
    this.cross = root.appendChild(el('div', 'cross', '<i></i><i></i><i></i><i></i><b></b>'));
    this.hitm = root.appendChild(el('div', 'hitm', '<i></i><i></i><i></i><i></i>'));
    this.vign = root.appendChild(el('div', 'vign'));
    this.dmgDir = root.appendChild(el('div', 'dmgdir'));
    this.objective = root.appendChild(el('div', 'objective'));
    this.marker = root.appendChild(el('div', 'marker', '<span></span><em></em>'));
    this.kills = root.appendChild(el('div', 'kills'));
    this.chars = root.appendChild(el('div', 'chars'));
    this.weapon = root.appendChild(el('div', 'weapon'));
    this.abil = root.appendChild(el('div', 'abil'));
    this.notes = root.appendChild(el('div', 'notes'));
    // damage numbers: a pool of labels that rise from where an enemy was hit
    this.numsEl = root.appendChild(el('div', 'nums'));
    this.nums = []; this.numOf = new Map(); this.numPool = [];
    this.bannerEl = root.appendChild(el('div', 'banner'));
    this.bossEl = root.appendChild(el('div', 'boss', '<span></span><div><i></i></div>'));
    this.prompt = root.appendChild(el('div', 'prompt'));
    this.fps = root.appendChild(el('div', 'fps'));
    this.overlay = document.getElementById('overlay');
    this.hitT = 0; this.vignT = 0; this.combo = 0; this.comboT = 0; this.bossRef = null; this.bannerT = 0;
    this._v = new THREE.Vector3();
    this.charEls = {};
  }

  // ---------------------------------------------------------------- events
  note(text) {
    const n = el('div', null, text);
    this.notes.appendChild(n);
    setTimeout(() => n.classList.add('out'), 1400);
    setTimeout(() => n.remove(), 2000);
    while (this.notes.children.length > 4) this.notes.firstChild.remove();
  }
  hit(kill, head) {
    this.hitT = kill ? 0.28 : 0.12;
    this.hitm.className = 'hitm on' + (kill ? ' kill' : '') + (head ? ' head' : '');
    if (kill) { this.combo++; this.comboT = 3.5; }
  }
  damage(angle, healthHit) {
    this.vignT = healthHit ? 0.6 : 0.3;
    this.vign.className = 'vign on' + (healthHit ? ' hp' : '');
    if (angle != null) {
      const a = el('i');
      a.style.transform = `rotate(${-angle * 180 / Math.PI}deg)`;
      this.dmgDir.appendChild(a);
      setTimeout(() => a.remove(), 700);
    }
  }
  banner(title, sub) {
    this.bannerEl.innerHTML = `<h2>${title}</h2><p>${sub || ''}</p>`;
    this.bannerEl.classList.add('on');
    this.bannerT = 3.2;
  }
  boss(e) { this.bossRef = e; }
  // Damage dealt to an enemy, shown as a number above it. Hits on the same enemy within a moment add up in one
  // number (a machine gun would otherwise bury the screen); kind: 'head' | 'fire' | 'explosion' | ...
  number(e, amount, kind) {
    const G = this.g;
    if (!(amount > 0) || !G.settings.numbers) return;
    let n = this.numOf.get(e);
    if (!n || n.age > 0.4) {
      if (this.nums.length >= 60) return;
      const div = this.numPool.pop() || this.numsEl.appendChild(el('div'));
      n = { e, el: div, sum: 0, age: 0, life: 0.85, x: e.pos.x, y: e.pos.y + e.def.height * (e.def.structure ? 0.7 : 1) + 0.6, z: e.pos.z, dx: (Math.random() - 0.5) * 46, shown: -1, kind: '' };
      this.nums.push(n); this.numOf.set(e, n);
    } else { n.age = Math.min(n.age, 0.12); n.x = e.pos.x; n.z = e.pos.z; }       // still counting: stays put a little longer
    n.sum += amount;
    const k = kind === 'head' ? 'head' : kind === 'fire' ? 'fire' : kind === 'explosion' || kind === 'slam' || kind === 'claw' || kind === 'execute' || kind === 'melee' ? 'big' : '';
    if (RANK[k] > RANK[n.kind]) n.kind = k;
  }
  _numbers(dt, cam) {
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.age += dt;
      if (n.age >= n.life) { n.el.style.display = 'none'; this.numPool.push(n.el); this.nums.splice(i, 1); if (this.numOf.get(n.e) === n) this.numOf.delete(n.e); continue; }
      const v = this._v.set(n.x, n.y + n.age * 3.2, n.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { n.el.style.display = 'none'; continue; }
      const val = Math.max(1, Math.round(n.sum));
      if (val !== n.shown) { n.shown = val; n.el.textContent = val; n.el.className = n.kind || ''; n.el.style.fontSize = Math.round(15 + Math.min(17, Math.log10(val + 1) * 6.5)) + 'px'; }
      const k = n.age / n.life;
      n.el.style.display = '';
      n.el.style.opacity = k < 0.6 ? 1 : (1 - k) / 0.4;
      n.el.style.transform = `translate(${((v.x * 0.5 + 0.5) * innerWidth + n.dx).toFixed(0)}px, ${((-v.y * 0.5 + 0.5) * innerHeight).toFixed(0)}px) translate(-50%, -50%) scale(${(k < 0.12 ? 1.35 - k * 2.9 : 1).toFixed(2)})`;
    }
  }
  target(e) { this.targetRef = e; this.targetT = 3; }

  // ---------------------------------------------------------------- every frame
  update(dt, fps) {
    const G = this.g, P = G.player, M = G.mission, cam = G.engine.camera;
    if (!P || !P.ch) return;
    const c = P.ch;
    // the Executioner has no weapon switching: the panel always shows the minigun and its ammunition
    const gun = c.def.aimToShoot ? c.weapons.find((x) => x.def.kind !== 'melee') : null;
    const w = P.weapon, wd = w.def;
    // crosshair: opens with the weapon's spread
    const spread = wd.kind === 'bullet' ? (P.aiming ? wd.spreadAim : wd.spread) * (1 + P.recoil) : wd.kind === 'flame' ? 3 : wd.kind === 'melee' ? 2.5 : 0.6;
    const px = 6 + spread * 7 + (P.sprinting ? 10 : 0);
    this.cross.style.setProperty('--gap', px.toFixed(1) + 'px');
    this.cross.classList.toggle('melee', wd.kind === 'melee');
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.hitm.className = 'hitm'; }
    if (this.vignT > 0) { this.vignT -= dt; if (this.vignT <= 0) this.vign.className = 'vign'; }
    this.vign.classList.toggle('low', c.health < c.def.health * 0.3);
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    if (this.bannerT > 0) { this.bannerT -= dt; if (this.bannerT <= 0) this.bannerEl.classList.remove('on'); }

    // characters: the active one large, the other small
    let html = '';
    for (const ch of Object.values(P.chars)) {
      const d = ch.def, act = ch === c;
      const pips = [];
      for (let i = 0; i < d.armor; i++) { const f = Math.max(0, Math.min(1, ch.armor / d.armorPip - i)); pips.push(`<u><s style="width:${(f * 100).toFixed(0)}%"></s></u>`); }
      html += `<div class="ch${act ? ' act' : ''}${ch.alive ? '' : ' dead'}"><b>${d.name}</b><div class="arm">${pips.join('')}</div>` +
        `<div class="hp"><s style="width:${(Math.max(0, ch.health) / d.health * 100).toFixed(0)}%"></s></div>${act ? '' : `<small>${ch.alive ? 'Tab' + (P.swapCd > 0 ? ' ' + P.swapCd.toFixed(1) : '') : 'down'}</small>`}</div>`;
    }
    if (html !== this._chars) { this.chars.innerHTML = html; this._chars = html; }

    // weapon
    let ammo;
    if (gun) ammo = gun.reload > 0 ? '<b class="rel">reloading</b>' : `<b>${Math.floor(gun.ammo)}</b><small>/ ${gun.def.magazine}</small>`;
    else if (wd.kind === 'melee') ammo = '<b>&#8734;</b>';
    else if (wd.kind === 'flame') ammo = `<div class="fuel"><s style="width:${(w.ammo / wd.fuel * 100).toFixed(0)}%"></s></div>`;
    else ammo = w.reload > 0 ? '<b class="rel">reloading</b>' : `<b>${Math.floor(w.ammo)}</b><small>/ ${wd.magazine}</small>`;
    const list = gun
      ? `<span class="${wd.kind === 'melee' ? 'on' : ''}">LMB Claws</span><span class="${wd.kind === 'melee' ? '' : 'on'}">RMB + LMB Minigun</span>`
      : c.weapons.map((x, i) => `<span class="${i === c.wi ? 'on' : ''}">${i + 1} ${x.def.name}</span>`).join('');
    const wh = `<div class="wn">${gun ? gun.def.name : wd.name}</div><div class="am">${ammo}</div><div class="wl">${list}</div>`;
    if (wh !== this._weapon) { this.weapon.innerHTML = wh; this._weapon = wh; }

    // abilities
    const jet = [];
    for (let i = 0; i < c.def.jet.charges; i++) jet.push(`<u class="${i < c.jet ? 'on' : ''}"></u>`);
    const U = c.def.ultimate, ucd = Math.ceil(c.ultCd || 0);
    const ah = `<div><em>Q</em> Jetpack ${jet.join('')}</div><div class="${c.dashCd > 0 ? 'cd' : ''}"><em>Ctrl</em> Dash</div>`
      + (U ? `<div class="ult ${ucd > 0 ? 'cd' : 'ready'}"><em>G</em> ${U.name}${ucd > 0 ? ' <b>' + ucd + ' s</b>' : ''}</div>` : '');
    if (ah !== this._abil) { this.abil.innerHTML = ah; this._abil = ah; }

    // objective + marker
    if (M && M.obj) {
      const o = M.obj;
      const d = Math.hypot(P.pos.x - M.goalPos[0], P.pos.z - M.goalPos[1]);
      const oh = `<small>OBJECTIVE</small><div>${o.text}</div><em>${M.progressText()}</em>`;
      if (oh !== this._obj) { this.objective.innerHTML = oh; this._obj = oh; }
      const show = o.type === 'reach' || o.type === 'destroy' || d > M.goalRadius;
      this.marker.style.display = show ? '' : 'none';
      if (show) {
        const v = this._v.copy(M.marker).project(cam);
        let x = v.x, y = v.y;
        const behind = v.z > 1;
        if (behind) { x = -x; y = -y; }
        const edge = behind || Math.abs(x) > 0.92 || Math.abs(y) > 0.86;
        if (edge) { const k = Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.86, 1e-3); x /= k; y /= k; if (behind) y = Math.min(y, -0.5) ; }
        this.marker.style.transform = `translate(${((x * 0.5 + 0.5) * innerWidth).toFixed(0)}px, ${((-y * 0.5 + 0.5) * innerHeight).toFixed(0)}px)`;
        this.marker.lastChild.textContent = Math.round(d) + ' m';
        this.marker.classList.toggle('edge', edge);
      }
    } else { this.objective.innerHTML = ''; this._obj = ''; this.marker.style.display = 'none'; }

    const AL = this.g.allies;
    const kh = `<b>${M ? M.ownKills : 0}</b><small>KILLS</small>${this.combo > 2 ? `<em>x${this.combo}</em>` : ''}${AL ? `<i>SEAS troops <b>${AL.alive}</b></i>` : ''}`;
    if (kh !== this._kills) { this.kills.innerHTML = kh; this._kills = kh; }

    this._numbers(dt, cam);
    // boss bar
    // (a boss, or else the tent / totem / boat that was hit last: so it shows that the damage counts)
    if (this.targetT > 0) this.targetT -= dt;
    const b = this.bossRef && this.bossRef.alive ? this.bossRef : this.targetT > 0 ? this.targetRef : null;
    if (b && b.alive) {
      this.bossEl.classList.add('on');
      this.bossEl.firstChild.textContent = b.def.name;
      this.bossEl.querySelector('i').style.width = (Math.max(0, b.hp) / b.maxHp * 100).toFixed(1) + '%';
    } else this.bossEl.classList.remove('on');

    // execution prompt
    const ex = !P.dead && G.enemies.executable(P.pos, { x: -Math.sin(P.yaw), z: -Math.cos(P.yaw) }, CFG.execute.range + c.def.radius);
    this.prompt.textContent = ex ? 'E  Execute' : '';
    if (fps != null && G.settings.showFps) this.fps.textContent = fps + ' fps  ' + G.enemies.alive + ' enemies';
  }
  show(on) { this.root.style.display = on ? '' : 'none'; }

  // ---------------------------------------------------------------- screens
  screen(html, cls = '') {
    this.overlay.className = html ? 'on ' + cls : '';
    this.overlay.innerHTML = html || '';
    return this.overlay;
  }
  loading(f, text) {
    if (!this._load) { this.screen(`<div class="panel load"><h1>ParaWorld Shooter</h1><p class="sub">${CFG.mission.title}</p><div class="bar"><i></i></div><p class="st"></p></div>`); this._load = true; }
    this.overlay.querySelector('.bar i').style.width = Math.round(f * 100) + '%';
    this.overlay.querySelector('.st').textContent = text || '';
  }
  keysTable() { return '<table class="keys">' + KEYS.map(([k, t]) => `<tr><th>${k}</th><td>${t}</td></tr>`).join('') + '</table>'; }
  settingsHtml() {
    const s = this.g.settings;
    const opt = (v, cur, t) => `<option value="${v}"${v === cur ? ' selected' : ''}>${t}</option>`;
    return `<div class="set">
      <label>Graphics <select data-k="quality">${opt('low', s.quality, 'Low (no shadows)')}${opt('medium', s.quality, 'Medium')}${opt('high', s.quality, 'High')}</select></label>
      <label>Difficulty <select data-k="difficulty">${opt('easy', s.difficulty, 'Easy')}${opt('normal', s.difficulty, 'Normal')}${opt('hard', s.difficulty, 'Hard')}</select></label>
      <label>Mouse speed <input type="range" min="0.3" max="2.5" step="0.05" value="${s.sensitivity}" data-k="sensitivity"></label>
      <label>Volume <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></label>
      <label><input type="checkbox" data-k="invertY"${s.invertY ? ' checked' : ''}> Invert mouse up / down</label>
      <label><input type="checkbox" data-k="blood"${s.blood ? ' checked' : ''}> Blood</label>
      <label><input type="checkbox" data-k="numbers"${s.numbers ? ' checked' : ''}> Damage numbers</label>
      <label><input type="checkbox" data-k="showFps"${s.showFps ? ' checked' : ''}> Show frames per second</label>
    </div>`;
  }
  bindSettings() {
    for (const i of this.overlay.querySelectorAll('[data-k]')) {
      i.addEventListener('input', () => {
        const k = i.dataset.k;
        this.g.settings[k] = i.type === 'checkbox' ? i.checked : i.type === 'range' ? +i.value : i.value;
        this.g.applySettings();
      });
    }
  }
  // the first screen: which mission (missions whose map the installation does not have are greyed out)
  missions(list, onPick) {
    const o = this.screen(`<div class="panel"><h1>ParaWorld Shooter</h1><p class="sub">Choose the mission</p>
      <div class="pick missions">${list.map((m) => `<button data-m="${m.id}"${m.available === false ? ' disabled' : ''}><b>${m.title}</b><span>${m.blurb}</span>${m.needs ? `<small>${m.available === false ? 'Not available: ' : ''}${m.needs}</small>` : ''}</button>`).join('')}</div>
      ${this.logNote(this.g.previous)}</div>`, 'menu');
    this.show(false);                         // nothing of the game is there yet
    for (const b of o.querySelectorAll('[data-m]')) b.addEventListener('click', () => { this.show(true); onPick(b.dataset.m); });
    return o;
  }
  start(onStart) {
    this._load = false;
    const o = this.screen(`<div class="panel"><h1>ParaWorld Shooter</h1><p class="sub">${CFG.mission.title}</p><p>${CFG.mission.intro}</p>
      <div class="pick"><button data-c="gunner"><b>Gunner</b><span>Machine gun, flamethrower, rocket launcher. Fast.</span></button>
      <button data-c="executioner"><b>Executioner MKII</b><span>Claws and minigun. Big and tough.</span></button></div>
      ${this.g.from ? `<p class="cp">You start at the checkpoint: <b>${CFG.mission.objectives[this.g.from].text}</b> &nbsp; <a href="#" data-a="scratch">from the beginning instead</a></p>` : this.g.stored ? `<p class="cp">A checkpoint is saved: <b>${CFG.mission.objectives[this.g.stored].text}</b> &nbsp; <a href="#" data-a="cp">continue there</a></p>` : ''}
      <p class="hint">Pick who goes in first. Tab swaps between them at any time. &nbsp; <a href="#" data-a="other">Another mission</a></p>
      <div class="cols">${this.keysTable()}${this.settingsHtml()}</div>${this.logNote(this.g.previous)}</div>`, 'menu');
    this.bindSettings();
    for (const b of o.querySelectorAll('[data-c]')) b.addEventListener('click', () => onStart(b.dataset.c));
    o.querySelector('[data-a=other]').addEventListener('click', (e) => { e.preventDefault(); this.g.restart(true); });
    const cp = o.querySelector('[data-a=cp]'), sc = o.querySelector('[data-a=scratch]');
    if (cp) cp.addEventListener('click', (e) => { e.preventDefault(); this.g.restart(false, this.g.stored); });
    if (sc) sc.addEventListener('click', (e) => { e.preventDefault(); this.g.restart(false); });
  }
  pause(onResume, onRestart) {
    const o = this.screen(`<div class="panel"><h1>Paused</h1><div class="pick one"><button data-a="resume"><b>Continue</b></button><button data-a="restart"><b>Restart the mission</b></button>${this.g.mission.checkpoint ? '<button data-a="cp"><b>Back to the checkpoint</b></button>' : ''}<button data-a="other"><b>Another mission</b></button></div>
      <div class="cols">${this.keysTable()}${this.settingsHtml()}</div>${this.logNote()}</div>`, 'menu');
    this.bindSettings();
    o.querySelector('[data-a=resume]').addEventListener('click', onResume);
    const cpb = o.querySelector('[data-a=cp]');
    if (cpb) cpb.addEventListener('click', () => this.g.restart(false, this.g.mission.checkpoint));
    o.querySelector('[data-a=other]').addEventListener('click', () => this.g.restart(true));
    o.querySelector('[data-a=restart]').addEventListener('click', onRestart);
  }
  end(win, stats, onRestart) {
    const t = Math.round(stats.time);
    const o = this.screen(`<div class="panel"><h1>${win ? (CFG.mission.won || 'The Holy City is taken') : 'You have fallen'}</h1>
      <p class="sub">${win ? 'Mission complete' : 'The Dustriders hold the city'}</p>
      <table class="keys stats"><tr><th>Kills</th><td>${stats.kills}</td></tr><tr><th>Executions</th><td>${stats.executions}</td></tr>
      <tr><th>Time</th><td>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</td></tr><tr><th>Damage taken</th><td>${Math.round(stats.damage)}</td></tr></table>
      <div class="pick one">${!win && stats.checkpoint ? `<button data-a="cp"><b>Continue from the checkpoint</b><span>${CFG.mission.objectives[stats.checkpoint].text}</span></button>` : ''}<button data-a="restart"><b>${win ? 'Play again' : 'From the beginning'}</b></button><button data-a="other"><b>Another mission</b></button></div></div>`, 'menu');
    o.querySelector('[data-a=restart]').addEventListener('click', onRestart);
    const cp = o.querySelector('[data-a=cp]');
    if (cp) cp.addEventListener('click', () => this.g.restart(false, stats.checkpoint));
    o.querySelector('[data-a=other]').addEventListener('click', () => this.g.restart(true));
  }
  error(text) { this.screen(`<div class="panel"><h1>Cannot start</h1><p>${text}</p>${this.logNote()}</div>`, 'menu'); }
  // where the log is; on the start screen also how the session before ended
  logNote(previous = null) {
    const G = this.g, esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let h = '';
    if (previous && previous.file && !previous.closed) {
      h += `<p class="hint warn">The last session did not close normally (crash, frozen or killed window). Its log:<br><code>${esc(previous.file)}</code></p>`;
    }
    const where = (G.log && G.log.file) || G.logDir;
    if (where) h += `<p class="hint">Log of this session: <code>${esc(where)}</code></p>`;
    return h;
  }
}
