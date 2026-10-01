// Menus built from the original interface art (Data/Base/UI/menue: window frame, buttons, checkboxes, sliders,
// tribe icons, victory/defeat pictures) with the original font and colours (UI/VisDef_GAM2.vis: Trebuchet MS bold,
// button text 224,185,120; title bar text 60,21,0).
//
// Screens: title -> skirmish setup -> (game) -> pause menu -> settings / controls -> end of game.
// The menu never touches game state directly; it calls the hooks it was given (start, restart, quit, apply).

import { PLAYER_COLORS } from '../game/colors.js';
import { listMaps, loadMapInfo, drawPreview } from './mappreview.js';

export const DEFAULT_SETTINGS = {
  showIncome: false, shadows: 'on', grass: 'on', fpsCap: 60, resScale: 1, uiScale: 0, perf: false, edgeScroll: true, autoMenu: true, antialias: true, speed: 1,
  sound: true, volMaster: 0.8, volSfx: 0.9, volVoice: 1, volMusic: 0.45,
  skirmish: { me: 'SEAS', ai: 'Aje', aiLevel: 'normal', seed: 1234, warpgate: true, debug: false, meColor: 'blue', aiColor: 'red' },
};
export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('pwr.settings') || '{}'); } catch (e) { s = {}; }
  return { ...DEFAULT_SETTINGS, ...s, skirmish: { ...DEFAULT_SETTINGS.skirmish, ...(s.skirmish || {}) } };
}
export function saveSettings(s) { try { localStorage.setItem('pwr.settings', JSON.stringify(s)); } catch (e) { /* private mode */ } }

// tribe display names and their row in menu_tribeselecticons.tga (38 x 21 px per icon; rows: 0 Dustriders (sand),
// 1 Dragon Clan (green dragon), 2 Norsemen (blue), 3 SEAS (fist), 4 random)
export const TRIBE_INFO = {
  Hu: { name: 'Norsemen', icon: 2 }, Aje: { name: 'Dustriders', icon: 0 }, Ninigi: { name: 'Dragon Clan', icon: 1 }, SEAS: { name: 'SEAS', icon: 3 },
};

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export class Menu {
  // hooks: { start(config), restart(), quit(), exit(), applySettings(s), sound(name) }
  constructor(G, hooks = {}) {
    this.G = G;
    this.hooks = hooks;
    this.back = el('div', 'modal hidden', document.body);
    this.win = el('div', 'pwwin', this.back);
    this.back.addEventListener('mousedown', (e) => e.stopPropagation());
    this.back.addEventListener('click', (e) => { if (e.target.closest('.pwbtn')) this.click(); });
    this.inGame = false;
  }
  click() { if (this.hooks.sound) this.hooks.sound('UI_click'); }
  close() {
    this.back.classList.add('hidden');
    this.back.classList.remove('title');
    this.G.menuOpen = false;
    if (this.inGame && this.G.setPaused) this.G.setPaused(this.wasPaused);
  }
  open(title, html, opts = {}) {
    if (!this.G.menuOpen) this.wasPaused = this.G.paused;
    this.G.menuOpen = true;
    if (this.inGame && this.G.setPaused) this.G.setPaused(true);
    this.back.classList.toggle('title', !!opts.title);
    this.win.innerHTML = `<h2>${title}</h2>` + html;
    this.back.classList.remove('hidden');
  }
  bind(map) { this.win.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => map[b.dataset.a] && map[b.dataset.a](b); }); }
  btn(a, label, cls = '') { return `<button class="pwbtn ${cls}" data-a="${a}">${label}</button>`; }

  // ---------------------------------------------------------------- before the game
  title() {
    this.inGame = false;
    this.open('ParaWorld', `<h3>ParaWorld</h3><p>Remake</p><div class="btns">
      ${this.btn('skirmish', 'Skirmish')}${this.btn('settings', 'Options')}${this.btn('help', 'Controls')}${this.btn('exit', 'Exit game')}</div>`, { title: true });
    this.bind({ skirmish: () => this.skirmish(), settings: () => this.settings(() => this.title()), help: () => this.help(() => this.title()),
      exit: () => this.hooks.exit && this.hooks.exit() });
  }
  skirmish() {
    const s = this.G.settings, k = s.skirmish;
    const tribeRow = (id, cur) => `<div class="tribes" data-row="${id}">` + Object.entries(TRIBE_INFO).map(([t, i]) =>
      `<div class="tribe ${t === cur ? 'on' : ''}" data-t="${t}"><i style="background-position:0 -${i.icon * 21}px"></i>${i.name}</div>`).join('') + '</div>';
    // party colour swatches (ACColors.txt PlayerColor0..7) + "none" = untinted models
    const colorRow = (id, cur) => `<div class="pcolors" data-row="${id}"><span>Colour</span>` +
      [{ id: 'none', name: 'No colour' }, ...PLAYER_COLORS].map((c) => `<i class="pc ${c.id === (cur || 'none') ? 'on' : ''}" data-c="${c.id}" title="${c.name}"` +
        (c.light ? ` style="background:rgb(${c.light.join(',')})"` : '') + `></i>`).join('') + '</div>';
    this.open('Skirmish', `<div class="pwgrp"><b>Your tribe</b>${tribeRow('me', k.me)}${colorRow('meColor', k.meColor)}</div>
      <div class="pwgrp"><b>Computer opponent</b>${tribeRow('ai', k.ai)}${colorRow('aiColor', k.aiColor)}
        <div class="set" style="margin-top:10px"><span>Difficulty</span><select class="pwsel" id="k_lvl">
          ${['easy', 'normal', 'hard'].map((v) => `<option value="${v}" ${k.aiLevel === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select>
        <label class="pwcheck full"><input type="checkbox" id="k_warp" ${k.warpgate !== false ? 'checked' : ''}><i></i>Warp gate victory (epoch V: hold a finished warp gate for 10 minutes)</label>
        <label class="pwcheck full"><input type="checkbox" id="k_debug" ${k.debug ? 'checked' : ''}><i></i>Debug mode: everything is free and builds instantly (for you, not the computer)</label></div></div>
      <div class="pwgrp"><b>Map</b><div class="mapsel">
        <canvas id="k_prev" width="150" height="150"></canvas>
        <div class="mapinfo">
          <select class="pwsel" id="k_map"><option value="">Random jungle</option></select>
          <label class="pwbtn small mapfile">Open map file…<input type="file" id="k_file" accept=".ula" hidden></label>
          <div class="seedrow" id="k_seedrow"><span>Seed</span> <input class="pwsel" id="k_seed" type="number" value="${k.seed}" style="width:90px"></div>
          <div class="mapdesc" id="k_desc"></div>
        </div></div></div>
      <div class="btns row">${this.btn('back', 'Back', 'small')}${this.btn('start', 'Start game', 'small')}</div>`, { title: true });
    this.initMapPicker(k);
    this.win.querySelectorAll('.tribes').forEach((row) => row.querySelectorAll('.tribe').forEach((t) => {
      t.onclick = () => { row.querySelectorAll('.tribe').forEach((x) => x.classList.remove('on')); t.classList.add('on'); k[row.dataset.row] = t.dataset.t; this.click(); };
    }));
    this.win.querySelectorAll('.pcolors').forEach((row) => row.querySelectorAll('.pc').forEach((c) => {
      c.onclick = () => { row.querySelectorAll('.pc').forEach((x) => x.classList.remove('on')); c.classList.add('on'); k[row.dataset.row] = c.dataset.c; this.click(); };
    }));
    this.bind({
      back: () => this.title(),
      start: () => {
        k.aiLevel = this.win.querySelector('#k_lvl').value;
        k.seed = +this.win.querySelector('#k_seed').value || 1;
        if (this.mapError) { this.mapDesc(this.mapError, true); return; }
        k.warpgate = this.win.querySelector('#k_warp').checked;
        k.debug = this.win.querySelector('#k_debug').checked;
        saveSettings(s);
        this.close();
        if (this.hooks.start) this.hooks.start({ ...k });
      },
    });
  }

  // map list (maps/index.json) + "open file", preview and description of the chosen map
  async initMapPicker(k) {
    const sel = this.win.querySelector('#k_map'), file = this.win.querySelector('#k_file');
    const maps = await listMaps();
    let group = null, lastFolder = null;
    for (const m of maps) {
      if (m.folder !== lastFolder) { group = document.createElement('optgroup'); group.label = m.folder || 'Maps'; sel.appendChild(group); lastFolder = m.folder; }
      const o = document.createElement('option'); o.value = m.path; o.textContent = m.file.replace(/\.ula$/i, ''); group.appendChild(o);
    }
    if (k.map === 'file:' && k.mapName) {
      const o = document.createElement('option'); o.value = 'file:'; o.textContent = k.mapName + ' (file)'; sel.insertBefore(o, sel.options[1]);
    }
    sel.value = [...sel.options].some((o) => o.value === (k.map || '')) ? (k.map || '') : '';
    k.map = sel.value;
    sel.onchange = () => { k.map = sel.value; this.showMap(k); this.click(); };
    file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const buf = await f.arrayBuffer();
      try {
        // keep the file for "Restart" (the page reloads); maps are a few hundred KB
        let bin = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        sessionStorage.setItem('pwr.mapfile', btoa(bin));
      } catch (e) { /* too big for sessionStorage: restart will ask again */ }
      await loadMapInfo('file:' + f.name, buf);
      k.map = 'file:'; k.mapName = f.name;
      let o = [...sel.options].find((x) => x.value === 'file:');
      if (!o) { o = document.createElement('option'); o.value = 'file:'; sel.insertBefore(o, sel.options[1]); }
      o.textContent = f.name + ' (file)';
      sel.value = 'file:';
      this.showMap(k);
    };
    this.showMap(k);
  }
  mapDesc(html, bad) { const d = this.win.querySelector('#k_desc'); if (d) { d.innerHTML = html; d.classList.toggle('bad', !!bad); } }
  async showMap(k) {
    const cv = this.win.querySelector('#k_prev'), seedRow = this.win.querySelector('#k_seedrow');
    if (!cv) return;
    this.mapError = null;
    seedRow.style.display = k.map ? 'none' : '';
    const ctx = cv.getContext('2d');
    if (!k.map) {
      ctx.fillStyle = '#29401c'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#e0c890'; ctx.font = 'bold 13px Trebuchet MS'; ctx.textAlign = 'center'; ctx.fillText('random', cv.width / 2, cv.height / 2);
      this.mapDesc('A new jungle for every seed: two bases, forests, herds of dinosaurs.');
      return;
    }
    this.mapDesc('Reading the map…');
    try {
      const md = await loadMapInfo(k.map === 'file:' ? 'file:' + k.mapName : k.map);
      if (this.win.querySelector('#k_prev') !== cv) return;
      await drawPreview(cv, md);
      const i = md.info, starts = md.objects.filter((o) => o.type === 'SLOC').length;
      const esc = (t) => String(t || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
      this.mapDesc(`<b>${esc(md.name)}</b><br>${md.setting} · ${md.hx * 2} × ${md.hy * 2} m · ${starts} start locations` +
        (i.Author ? `<br>by ${esc(i.Author)}` : '') + (i.Description ? `<br><i>${esc(i.Description).slice(0, 160)}</i>` : '') +
        (starts < 2 ? '<br>No start locations - the bases are placed automatically.' : ''));
    } catch (e) {
      this.mapError = 'This map could not be read: ' + e.message;
      this.mapDesc(this.mapError, true);
    }
  }

  // ---------------------------------------------------------------- in game
  main() {
    this.inGame = true;
    this.open('Menu', `<div class="btns">${this.btn('resume', 'Resume game')}${this.btn('settings', 'Options')}${this.btn('help', 'Controls')}
      ${this.btn('restart', 'Restart skirmish')}${this.btn('quit', 'Quit to main menu')}${this.btn('exit', 'Exit game')}</div>`);
    this.bind({
      resume: () => this.close(), settings: () => this.settings(() => this.main()), help: () => this.help(() => this.main()),
      restart: () => this.confirm('Restart the skirmish?', () => this.hooks.restart && this.hooks.restart(), () => this.main()),
      quit: () => this.confirm('Quit to the main menu?', () => this.hooks.quit && this.hooks.quit(), () => this.main()),
      exit: () => this.confirm('Exit the game?', () => this.hooks.exit && this.hooks.exit(), () => this.main()),
    });
  }
  confirm(text, yes, no) {
    this.open('Question', `<p style="color:var(--pw-text)">${text}</p><div class="btns row">${this.btn('no', 'No', 'small')}${this.btn('yes', 'Yes', 'small')}</div>`);
    this.bind({ yes, no });
  }
  settings(back) {
    const s = this.G.settings;
    const opt = (v, cur, label) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
    const chk = (id, on, label) => `<label class="pwcheck full"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i>${label}</label>`;
    const rng = (id, v) => `<input type="range" class="pwrange" id="${id}" min="0" max="100" value="${Math.round(v * 100)}">`;
    this.open('Options', `<div class="pwgrp"><b>Game</b><div class="set">
        ${chk('s_income', s.showIncome, 'Show resource income per minute')}
        ${chk('s_edge', s.edgeScroll, 'Scroll at screen edges')}
        ${chk('s_automenu', s.autoMenu !== false, 'Open the build / produce menu when selecting workers or buildings')}
        <span>Game speed</span><select class="pwsel" id="s_speed">${opt(0.5, s.speed, 'Slow')}${opt(1, s.speed, 'Normal')}${opt(1.5, s.speed, 'Fast')}${opt(2, s.speed, 'Very fast')}</select>
        <span>Interface size</span><select class="pwsel" id="s_ui">${opt(0, s.uiScale, 'Automatic')}${opt(1, s.uiScale, '100 %')}${opt(1.25, s.uiScale, '125 %')}${opt(1.5, s.uiScale, '150 %')}${opt(1.75, s.uiScale, '175 %')}</select>
      </div></div>
      <div class="pwgrp"><b>Graphics</b><div class="set">
        <span>Shadows</span><select class="pwsel" id="s_shadows">${opt('off', s.shadows, 'Off')}${opt('on', s.shadows, 'On')}${opt('high', s.shadows, 'High')}</select>
        <span>Grass</span><select class="pwsel" id="s_grass">${opt('off', s.grass, 'Off')}${opt('on', s.grass, 'On')}${opt('dense', s.grass, 'Dense')}</select>
        <span>Frame rate limit</span><select class="pwsel" id="s_fps">${opt(30, s.fpsCap, '30 fps')}${opt(60, s.fpsCap, '60 fps')}${opt(120, s.fpsCap, '120 fps')}${opt(0, s.fpsCap, 'Unlimited')}</select>
        <span>Render resolution</span><select class="pwsel" id="s_res">${opt(0.5, s.resScale, '50 %')}${opt(0.67, s.resScale, '67 %')}${opt(0.75, s.resScale, '75 %')}${opt(1, s.resScale, '100 %')}</select>
        ${chk('s_aa', s.antialias, 'Anti-aliasing (after restart)')}
        ${chk('s_perf', s.perf, 'Show performance (F9)')}
      </div></div>
      <div class="pwgrp"><b>Sound</b><div class="set">
        ${chk('s_sound', s.sound, 'Sound on')}
        <span>Master volume</span>${rng('s_vm', s.volMaster)}
        <span>Effects</span>${rng('s_vs', s.volSfx)}
        <span>Speech</span>${rng('s_vv', s.volVoice)}
        <span>Music</span>${rng('s_vmu', s.volMusic)}
      </div></div>
      <div class="btns">${this.btn('ok', 'OK')}</div>`, { title: !this.inGame });
    const $ = (id) => this.win.querySelector('#' + id);
    const apply = () => {
      s.showIncome = $('s_income').checked; s.edgeScroll = $('s_edge').checked; s.autoMenu = $('s_automenu').checked; s.speed = +$('s_speed').value; s.uiScale = +$('s_ui').value;
      s.shadows = $('s_shadows').value; s.grass = $('s_grass').value; s.fpsCap = +$('s_fps').value; s.resScale = +$('s_res').value; s.antialias = $('s_aa').checked; s.perf = $('s_perf').checked;
      s.sound = $('s_sound').checked; s.volMaster = $('s_vm').value / 100; s.volSfx = $('s_vs').value / 100; s.volVoice = $('s_vv').value / 100; s.volMusic = $('s_vmu').value / 100;
      saveSettings(s);
      if (this.hooks.applySettings) this.hooks.applySettings(s);
    };
    this.win.querySelectorAll('input,select').forEach((i) => { i.onchange = apply; i.oninput = apply; });
    this.bind({ ok: () => { apply(); back ? back() : this.close(); } });
  }
  help(back) {
    this.open('Controls', `<table class="keys">
      <tr><td>Left click / drag</td><td>Select / box select (Shift adds, double-click selects all of a type)</td></tr>
      <tr><td>Right click</td><td>Move, attack, gather, build, repair, deliver, heal (healers), enter a bunker / transport, set rally point</td></tr>
      <tr><td>Special moves</td><td>Units with abilities (and gates, markets ...) show the star menu; targeted moves ask for a target</td></tr>
      <tr><td>Walls</td><td>Click the start point, then the end point: a line of segments is placed</td></tr>
      <tr><td>Arrows · screen edge</td><td>Scroll · Mouse wheel: zoom · Middle drag or Q/E: rotate</td></tr>
      <tr><td>A · M · S · H</td><td>Attack-move · Move · Stop · Hold position</td></tr>
      <tr><td>B</td><td>Build menu (workers)</td></tr>
      <tr><td>Army pyramid</td><td>Drag a card into a higher row to level the unit up (skulls), into a lower row to level it down; drop it on another card to swap</td></tr>
      <tr><td>U · right click on a card</td><td>Level up by one</td></tr>
      <tr><td>Ctrl+1–9 · 1–9</td><td>Assign / select group (double tap centres)</td></tr>
      <tr><td>. (period) · Space</td><td>Next idle worker · centre on selection</td></tr>
      <tr><td>R · Del</td><td>Rally point · destroy selected</td></tr>
      <tr><td>Alt (hold)</td><td>Show all health bars</td></tr>
      <tr><td>P · F9 · Esc/F10</td><td>Pause · performance overlay · menu</td></tr>
      </table><div class="btns">${this.btn('back', 'Back')}</div>`, { title: !this.inGame });
    this.bind({ back: () => (back ? back() : this.close()) });
  }
  end(won, stats) {
    this.inGame = true;
    this.open(won ? 'Victory' : 'Defeat', `<img class="gameover" src="assets/ui/menu/menue__decoration__gameover_${won ? 'victory' : 'defeat'}.png" alt="">
      <h3 class="${won ? 'won' : 'lost'}">${won ? 'Victory!' : 'Defeat'}</h3>
      <p>${won ? `The ${stats.enemy} have been defeated.` : 'Your settlement has fallen.'}</p>
      <table class="keys"><tr><td>Time</td><td>${stats.time}</td></tr><tr><td>Enemies killed</td><td>${stats.kills}</td></tr>
      <tr><td>Units lost</td><td>${stats.lost}</td></tr><tr><td>Epoch reached</td><td>${stats.epoch}</td></tr></table>
      <div class="btns row">${this.btn('watch', 'Keep playing', 'small')}${this.btn('restart', 'Play again', 'small')}${this.btn('quit', 'Main menu', 'small')}</div>`);
    this.bind({ watch: () => this.close(), restart: () => this.hooks.restart && this.hooks.restart(), quit: () => this.hooks.quit && this.hooks.quit() });
  }
}
