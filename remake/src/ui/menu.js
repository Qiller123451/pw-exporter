// Menus built from the original interface art (Data/Base/UI/menue: window frame, buttons, checkboxes, sliders,
// tribe icons, victory/defeat pictures) with the original font and colours (UI/VisDef_GAM2.vis: Trebuchet MS bold,
// button text 224,185,120; title bar text 60,21,0).
//
// Screens: title -> skirmish setup | campaign (mission list) -> (game) -> pause menu -> settings / controls -> end of game.
// The menu never touches game state directly; it calls the hooks it was given (start, restart, quit, apply).

import { skirmishWindow } from './skirmish.js';
import { armyPage } from './pointbuy.js';
import { statsWindow } from './stats.js';
import { PointBuy, RES } from '../game/pointbuy.js';
import { TribeSwap } from '../game/campaign/tribes.js';
import { MISSIONS as SEQUEL_MISSIONS, SEQUEL_ORDER, migrateSettings } from '../game/sequel/missions.js';
import { SCENARIOS, SCENARIO_TRIBES, TRIBE_NAMES } from '../game/scenarios/missions.js';
import { SEQUEL_MOD, SEQUEL_CLASSES } from '../game/sequel/rules.js';
import { HelpBook } from './helpbook.js';
import { debugPage, debugRow, withCheats } from './debugopts.js';
import { raiseEpoch, spawnable, spawnObject, objectReport } from '../game/cheats.js';
import { copyText, shownProblems } from './diagnostics.js';

export const DEFAULT_SETTINGS = {
  showIncome: false, mentor: true, autosave: true, autosaveMin: 10, shadows: 'on', grass: 'on', particles: 'on', weather: true, warmup: true, fpsCap: 60, resScale: 1, uiScale: 0, perf: false, edgeScroll: true, autoMenu: true, tipNear: true, minimapRotate: true, minimapPlayerColors: true, antialias: true, speed: 1,
  sound: true, volMaster: 0.8, volSfx: 0.9, volVoice: 1, volMusic: 0.45, volAtmo: 0.8,
  // the two-player skirmish of the URL parameters (main.js quickConfig: tests) and the start of skirmishSetup
  skirmish: { me: 'SEAS', ai: 'Aje', aiLevel: 'normal', seed: 1234, warpgate: true, debug: false, meColor: 'blue', aiColor: 'red' },
  // the skirmish setup window's (ui/skirmish.js, game/skirmish.js); null = made from `skirmish` on first use
  skirmishSetup: null,
  // last mission chosen in the campaign menu; difficulty 0 easy, 1 medium, 2 hard; tribe: the player's tribe ('' = the
  // mission's own, game/campaign/tribes.js); mod: game data configuration ('' = official game);
  // credits: { <mission id>: the bonus points of the mission before, its army budget if more than MinCredits }
  campaign: { mission: 1, difficulty: 1, tribe: '', mod: '', credits: {} },
};
// The configuration of game data this page runs with: the toolkit serves the official game under /remake/ and a mod
// configuration (MIRAGE = Base + BoosterPack3 + MIRAGE ...) under /remake/mod/<id>/ (toolkit/remake.py).
export const CONFIG_MOD = decodeURIComponent((location.pathname.match(/\/mod\/([^/]+)\/[^/]*$/) || [])[1] || '');
export function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('pwr.settings') || '{}'); } catch (e) { s = {}; }
  // the minimap turns with the camera by default now (the user asked for it): an older saved "off" is dropped once
  if (!s.mmRotateV2) { delete s.minimapRotate; s.mmRotateV2 = true; }
  return { ...DEFAULT_SETTINGS, ...s, skirmish: { ...DEFAULT_SETTINGS.skirmish, ...(s.skirmish || {}) }, campaign: { ...DEFAULT_SETTINGS.campaign, ...(s.campaign || {}) } };
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

const esc = (t) => String(t == null ? '' : t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);

export class Menu {
  // hooks: { start(config), startCampaign(config) (from a running game: reloads), restart(), quit(), exit(), applySettings(s), sound(name) }
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
  // opts: title (the title screen's background), noPause (a window of the running game: diplomacy, chat history)
  open(title, html, opts = {}) {
    if (!this.G.menuOpen) this.wasPaused = this.G.paused;
    this.G.menuOpen = true;
    if (this.inGame && this.G.setPaused) this.G.setPaused(opts.noPause ? this.wasPaused : true);
    this.back.classList.toggle('title', !!opts.title);
    this.win.innerHTML = `<h2>${title}</h2>` + html;
    this.back.classList.remove('hidden');
  }
  bind(map) { this.win.querySelectorAll('[data-a]').forEach((b) => { b.onclick = () => map[b.dataset.a] && map[b.dataset.a](b); }); }
  btn(a, label, cls = '') { return `<button class="pwbtn ${cls}" data-a="${a}">${label}</button>`; }

  // ---------------------------------------------------------------- before the game
  title() {
    this.inGame = false;
    this.open('ParaWorld', `<h3>ParaWorld</h3><p>Remake${CONFIG_MOD ? ' · ' + CONFIG_MOD.replace(/[<>&"]/g, '') : ''}</p><div class="btns">
      ${this.btn('campaign', 'Campaign')}${this.btn('sequel', 'Containment (1964)')}${this.btn('scenarios', 'Scenarios')}${this.btn('skirmish', 'Skirmish')}${this.btn('load', 'Load game')}${this.btn('settings', 'Options')}${this.btn('book', 'Help')}${this.btn('help', 'Controls')}${this.btn('exit', 'Exit game')}</div>`, { title: true });
    this.bind({ campaign: () => this.campaign(), sequel: () => this.sequel(), scenarios: () => this.scenarios(), skirmish: () => this.skirmish(), load: () => this.loadWin(() => this.title()), settings: () => this.settings(() => this.title()), help: () => this.help(() => this.title()), book: () => this.helpBook(null, () => this.title()),
      exit: () => this.hooks.exit && this.hooks.exit() });
    this.versionLine();
  }
  // the game's version (the build time of game.js, main.js BUILD) at the bottom of the title and in-game menus; a
  // click copies it
  versionLine() {
    const b = String(this.G.build || 'dev'), m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)$/.exec(b);
    const text = `Version ${m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : b}${CONFIG_MOD ? ' · ' + CONFIG_MOD.replace(/[<>&"]/g, '') : ''}`;
    const v = document.createElement('div');
    v.className = 'pwver';
    v.textContent = text;
    v.title = 'Click to copy';
    v.onclick = () => { try { navigator.clipboard.writeText(`build ${b}${CONFIG_MOD ? ' ' + CONFIG_MOD : ''}`); v.textContent = text + ' · copied'; } catch (e) { /* no clipboard */ } };
    this.win.appendChild(v);
  }
  // Which campaign missions the menu offers. The trigger engine runs every mission, but only those listed here have
  // been played through and checked (docs/CAMPAIGN_RUNTIME.md "Mission status"); the others are greyed out.
  // 'ready' = played to the end by the scripted test; 'preview' = starts and plays part of the way. `?allmissions` in the address unlocks everything.
  static MISSIONS = { 0: 'ready', 1: 'ready', 2: 'ready', 3: 'ready', 4: 'ready', 5: 'ready', 6: 'ready', 7: 'ready', 8: 'ready', 9: 'ready', 10: 'ready', 11: 'ready', 12: 'ready', 13: 'ready', 14: 'ready', 15: 'ready', 16: 'ready' };
  static missionOpen(id) { return !!Menu.MISSIONS[id] || new URLSearchParams(location.search).has('allmissions'); }
  // the original single player campaign: the missions of the installation (campaign/index.json: id, title,
  // description, tribe), a difficulty, the tribe to play, start. The config of a mission is { campaign: id,
  // difficulty: 0 | 1 | 2 | 3 (Nightmare), tribe: '' | 'Hu' | 'Aje' | 'Ninigi' | 'SEAS' }.
  async campaign() {
    const s = this.G.settings, k = s.campaign;
    const esc = (t) => String(t || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
    this.open('Campaign', `<div class="pwgrp"><b>Mission</b><div class="missions"><div class="mlist" id="c_list"><div>Reading the missions…</div></div><div class="mtext" id="c_text"></div></div></div>
      <div class="pwgrp"><b>Your tribe</b><div class="tribes" id="c_tribe"><div class="tribe ${k.tribe ? '' : 'on'}" data-t=""><i style="background-position:0 -${4 * 21}px"></i>As in the mission</div>${Object.entries(TRIBE_INFO).map(([t, i]) =>
        `<div class="tribe ${t === k.tribe ? 'on' : ''}" data-t="${t}"><i style="background-position:0 -${i.icon * 21}px"></i>${i.name}</div>`).join('')}</div></div>
      <div class="pwgrp"><b>Difficulty</b><div class="set"><span>How strong the opponents are</span><select class="pwsel" id="c_diff">
        ${['Easy', 'Medium', 'Hard', 'Nightmare'].map((v, i) => `<option value="${i}" ${+k.difficulty === i ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <small>Easy, Medium and Hard are the original game's. Nightmare: Hard with the remake's bigger enemy raids.</small>
        <div class="set hidden" id="c_modrow"><span>Game data</span><select class="pwsel" id="c_mod"></select></div><small id="c_modnote"></small></div>
      ${debugRow(this)}
      <div class="btns row">${this.btn('back', 'Back', 'small')}${this.btn('start', 'Start mission', 'small')}</div>`, { title: true });
    const list = this.win.querySelector('#c_list'), text = this.win.querySelector('#c_text');
    let missions = [], shown = null;
    const show = (id) => {
      const m = missions.find((x) => x.id === id) || missions.find((x) => Menu.missionOpen(x.id)) || missions[0];
      if (!m) return;
      const open = Menu.missionOpen(m.id);
      if (open) k.mission = m.id;
      const start = this.win.querySelector('[data-a="start"]');
      if (start) start.classList.toggle('off', !open);
      list.querySelectorAll('div').forEach((d) => d.classList.toggle('on', +d.dataset.id === m.id));
      const own = TRIBE_INFO[m.tribe], pick = TRIBE_INFO[k.tribe];
      const tribe = pick && k.tribe !== m.tribe ? `You play the ${pick.name}${own ? ` (the mission was made for the ${own.name})` : ''}.` : own ? `You play the ${own.name}.` : '';
      const note = !open ? 'This mission is not adapted for the remake yet.' : Menu.MISSIONS[m.id] === 'preview' ? 'Preview: the first part of this mission plays; it cannot be finished yet.' : '';
      text.innerHTML = `<b>${esc(m.title || m.name)}</b>${esc(m.description).replace(/\n/g, '<br>')}<small>${tribe}</small>${note ? `<small class="mnote">${note}</small>` : ''}`;
      shown = m;
    };
    this.bind({
      back: () => this.title(),
      cheats: () => { k.difficulty = +this.win.querySelector('#c_diff').value; saveSettings(s); debugPage(this, () => this.campaign()); },
      start: () => {
        if (!missions.length || !shown || !Menu.missionOpen(shown.id) || this.busy) return;
        k.mission = shown.id;
        k.difficulty = +this.win.querySelector('#c_diff').value;
        saveSettings(s);
        const cfg = withCheats(s, { campaign: k.mission, difficulty: k.difficulty, tribe: k.tribe || '' });
        const conf = configs.find((c) => c.id === k.mod);
        const go = (c) => {
          if (conf && conf.id !== CONFIG_MOD) { this.campaign().then(() => this.switchConfig(conf, c)); return; }
          this.close();
          if (this.hooks.start) this.hooks.start(c);
        };
        // a mission with an army budget: the army screen first (CampaignMenu.usl:199-206)
        if (shown.point_buy) this.campaignArmy(shown, cfg, () => this.campaign(), go);
        else go(cfg);
      },
    });
    this.win.querySelectorAll('#c_tribe .tribe').forEach((t) => {
      t.onclick = () => {
        this.win.querySelectorAll('#c_tribe .tribe').forEach((x) => x.classList.remove('on'));
        t.classList.add('on'); k.tribe = t.dataset.t; saveSettings(s); this.click();
        if (shown) show(shown.id);
      };
    });
    // the game data configuration (official game or a mod): offered when the toolkit serves the remake
    let configs = [];
    this.busy = false;                    // a configuration's data is being built (switchConfig)
    this.configs().then((list) => {
      configs = list;
      const row = this.win.querySelector('#c_modrow'), sel = this.win.querySelector('#c_mod');
      if (!row || !configs.length) return;
      if (!configs.some((c) => c.id === k.mod)) k.mod = CONFIG_MOD;
      sel.innerHTML = configs.map((c) => `<option value="${esc(c.id)}" ${c.id === k.mod ? 'selected' : ''}>${esc(c.name)}${c.version ? ' ' + esc(c.version) : ''}</option>`).join('');
      row.classList.remove('hidden');
      const note = () => {
        const c = configs.find((x) => x.id === k.mod);
        this.win.querySelector('#c_modnote').textContent = !c ? '' : (c.id ? `Data folders: ${c.folders.join(' + ')}. ` : '') +
          (c.built || c.id === CONFIG_MOD ? '' : 'Its game data is built from your installation when the mission starts (several minutes, once).');
      };
      sel.onchange = () => { k.mod = sel.value; saveSettings(s); note(); };
      note();
    });
    try {
      const r = await fetch('campaign/index.json');
      if (!r.ok) throw new Error('not found');
      missions = await r.json();
    } catch (e) { missions = []; }
    if (this.win.querySelector('#c_list') !== list) return;           // the player went elsewhere meanwhile
    if (!missions.length) { list.innerHTML = '<div>No campaign missions were found in the game installation.</div>'; return; }
    list.innerHTML = missions.map((m) => `<div data-id="${m.id}"${Menu.missionOpen(m.id) ? '' : ' class="na" title="Not adapted for the remake yet"'}>${esc(m.title || m.name)}</div>`).join('');
    list.querySelectorAll('div').forEach((d) => { d.onclick = () => { show(+d.dataset.id); this.click(); }; d.ondblclick = () => this.win.querySelector('[data-a="start"]').click(); });
    show(+k.mission);
    const on = list.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  }
  // The army screen of a campaign mission (GameInfoWindow in GIWT_SINGLEPLAYER, GIW:343-397): the level's army preset
  // of the human player's tribe, fixed and paid from the budget max(Credits, MinCredits) - Credits = the bonus points
  // of the mission before (settings.campaign.credits, main.js G.endMission) - the shop limited to the units the level
  // allows, its resources (a "-1" one: the tribe's start stock, locked - the original gives 0 [?engine]).
  // go(cfg + army) starts it, back() returns.
  async campaignArmy(m, cfg, back, go) {
    const G = this.G, D = G.data, PB = new PointBuy(D, G.aiData), k = G.settings.campaign;
    let data = null;
    try { const r = await fetch(m.data); if (r.ok) data = await r.json(); } catch (e) { data = null; }
    const hp = data && (data.players || []).find((p) => p.type === 'human');
    if (!hp || !PB.ready) { go(cfg); return; }
    const mt = hp.tribe, tribe = cfg.tribe || mt;
    // another tribe than the mission's: its equivalents of the preset's and the shop's classes (campaign/tribes.js)
    const swap = tribe !== mt ? new TribeSwap(D, mt, tribe) : null;
    const conv = (c) => { if (!swap || /^(worker|Resource|Technics|Nature|Blocked)$/.test(c)) return c; const e = swap.equivalent(c); return e === undefined ? c : e; };
    const pb = hp.point_buy || {}, src = (pb.tribes || {})[tribe] || (pb.tribes || {})[mt] || {};
    const units = {};
    for (const [slot, c] of Object.entries(src)) { const x = conv(c); if (x) units[slot] = x; }
    const own = (hp.allowed_units && (hp.allowed_units.infantry || {})[tribe]) ? tribe : mt;
    const allowed = new Set([...((hp.allowed_units && hp.allowed_units.infantry || {})[own] || []), ...((hp.allowed_units && hp.allowed_units.cavalry || {})[own] || []),
      ...(((hp.heroes || {})._by_tribe || {})[own] || [])].map(conv).filter(Boolean));
    const res = hp.resources || {}, def = (D.start(tribe) || {}).res || {}, lockedRes = {};
    for (const r of RES) if (res[r] < 0) lockedRes[r] = def[r] || 0;
    const preset = { units, res: { food: res.food, wood: res.wood, stone: res.stone } };
    const buildings = hp.include_buildings !== false;
    const credits = Math.max((k.credits || {})[m.id] || 0, m.min_credits != null ? m.min_credits : PB.cost({ cards: units, res: {} }, tribe));
    const total = PB.total(credits, tribe, { mp: false, buildings });
    const load = () => PB.load(preset, tribe, total, { fixed: true, buildings, mp: false, lockedRes });
    armyPage(this, { tribe, credits, total, shown: credits, army: load(), mp: false, buildings, allowed, defaults: load, debugFree: true,
      limits: (hp.unit_limits || []).map((l) => (l && l.max != null ? l.max : null)), title: `${D.ui('_MyArmy', 'My Army')} · ${m.title || m.name}`,
      back, done: (army) => go({ ...cfg, army }) });
  }
  // the mod configuration of the game data this page runs on (gamedata.json "mod"; older data: the page's address)
  static dataMod(G) { const m = G.raw && G.raw.json && G.raw.json.mod; return m != null ? m : CONFIG_MOD; }
  // the configurations the toolkit offers ([] when the remake runs without the toolkit, e.g. the dev server)
  async configs() {
    try {
      const r = await fetch('/api/toolkit/remake/configs');
      return r.ok ? await r.json() : [];
    } catch (e) { return []; }
  }
  // start a mission with another configuration's data: build it if needed (progress in the window), then load the
  // page of that configuration, which starts the mission at once (main.js: pwr.autostart)
  async switchConfig(conf, cfg) {
    const note = this.win.querySelector('#c_modnote'), say = (t) => { if (note) note.textContent = t; };
    const go = () => {
      try { sessionStorage.setItem('pwr.autostart', JSON.stringify(cfg)); } catch (e) { /* ignore */ }
      location.href = conf.url;
    };
    const state = async () => (await fetch('/api/toolkit/remake/state?mod=' + encodeURIComponent(conf.id))).json();
    this.busy = true;
    try {
      let st = await state();
      if (st.ready) return go();
      if (!st.building) {
        const r = await (await fetch('/api/toolkit/remake/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mod: conf.id }) })).json();
        if (!r.ok) throw new Error(r.error || 'another build is running - try again when it is done');
      }
      for (;;) {
        await new Promise((res) => setTimeout(res, 1000));
        st = await state();
        if (st.building) { say(`Building the game data of ${conf.name}: ${st.stage} (${Math.round(100 * (st.frac || 0))} %)`); continue; }
        if (st.ready) return go();
        throw new Error(st.error || st.reason || 'the build failed');
      }
    } catch (e) {
      say(`The game data of ${conf.name} could not be built: ${e.message}`);
      this.busy = false;
    }
  }
  // the skirmish setup: ui/skirmish.js
  skirmish() { skirmishWindow(this); }

  // ---------------------------------------------------------------- in game
  main() {
    this.inGame = true;
    const dbg = this.G.world && this.G.world.cheats;
    this.open('Menu', `<div class="btns">${this.btn('resume', 'Resume game')}${dbg ? this.btn('debug', 'Debug tools') : ''}${this.btn('save', 'Save game')}${this.btn('load', 'Load game')}${this.btn('settings', 'Options')}${this.btn('book', 'Help')}${this.btn('help', 'Controls')}
      ${this.btn('restart', this.G.campaign ? 'Restart mission' : 'Restart skirmish')}${this.btn('quit', 'Quit to main menu')}${this.btn('exit', 'Exit game')}</div>`);
    this.bind({
      resume: () => this.close(), debug: () => this.debugTools(), save: () => this.saveWin(), load: () => this.loadWin(() => this.main()), settings: () => this.settings(() => this.main()), help: () => this.help(() => this.main()), book: () => this.helpBook(null, () => this.main()),
      restart: () => this.confirm(this.G.campaign ? 'Restart the mission?' : 'Restart the skirmish?', () => this.hooks.restart && this.hooks.restart(), () => this.main()),
      quit: () => this.confirm('Quit to the main menu?', () => this.hooks.quit && this.hooks.quit(), () => this.main()),
      exit: () => this.confirm('Exit the game?', () => this.hooks.exit && this.hooks.exit(), () => this.main()),
    });
    this.versionLine();
  }
  // the debug tools' objectives: the open ones of a campaign mission (shown quests) or a sequel / scenario mission, to
  // mark as done for testing (the user: "skip the destroying of the base and go straight for the boss")
  objectivesGroup() {
    const G = this.G, S = G.sequel, E = G.campaign && G.campaign.engine;
    let opts = [];
    if (S && S.objectives) opts = S.objectives.filter((o) => !o.done && !o.failed && !o.hidden).map((o) => [o.id, o.text]);
    else if (E) opts = (E.C.data.quests || []).filter((q) => q.visible && !q.accomplished && !q.unaccomplishable).map((q) => [q.name, (q.main ? '' : '(optional) ') + (q.headline || q.name)]);
    else return '';
    const pname = (p) => { const n = p.name || ''; const t = G.campaign && G.campaign.text ? G.campaign.text(n) : n; return `${t && t !== n ? t : n.replace(/^_PN_\w+?_/, '') || 'Player'} #${p.id}`; };
    return `<div class="pwgrp"><b>Objectives</b><div class="dbgspawn"><select class="pwsel" id="d_obj">${opts.length ? opts.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('') : '<option value="">(none open)</option>'}</select>
        ${this.btn('objdone', 'Mark as done', 'small')}</div><small>What the mission does when the objective is met happens too.</small>
      <div class="dbgspawn"><select class="pwsel" id="d_plr">${G.world.players.filter((p) => p !== G.me && !p.dead).map((p) => `<option value="${p.id}">${esc(pname(p) + ' (' + (G.me.isEnemy(p) ? 'enemy' : G.me.isFriend(p) ? 'ally' : 'neutral') + ')')}</option>`).join('')}</select>
        ${this.btn('wipe', 'Destroy all its units and buildings', 'small')}</div><small>For objectives like "destroy the base": the mission sees them destroyed (walls, gates and the Scorpion stay).</small></div>`;
  }
  // ---------------------------------------------------------------- debug tools (a game with debug options: game/cheats.js)
  // things to do at once in the running game; the window stays open, a line says what was done
  debugTools() {
    const G = this.G, W = G.world, me = G.me, D = G.data;
    const say = (t) => { const e = this.win.querySelector('#d_did'); if (e) e.textContent = t; };
    const mine = (f) => [...W.units, ...W.buildings].filter((e) => e.alive && e.owner === me && (!f || f(e)));
    this.open('Debug tools', `<div class="pwgrp"><b>Resources</b><div class="btns row">${this.btn('res', '+1000 food, wood, stone', 'small')}${this.btn('skulls', '+500 skulls', 'small')}</div></div>
      <div class="pwgrp"><b>You</b><div class="btns row">${this.btn('epoch', 'Next epoch', 'small')}${this.btn('free', me.debug ? 'Free and instant: on' : 'Free and instant: off', 'small')}${this.btn('heal', 'Heal everything', 'small')}</div>
        <div class="btns row">${this.btn('lvl', 'Selected: level up', 'small')}${this.btn('kill', 'Selected: destroy', 'small')}</div></div>
      <div class="pwgrp"><b>Put down an object</b><div class="dbgspawn"><input class="pwsel" id="d_cls" list="d_clslist" placeholder="class, e.g. hu_warrior" value="${esc(this.lastSpawn || '')}">
        <datalist id="d_clslist">${spawnable(D).map((o) => `<option value="${esc(o.name)}">${esc(o.tribe + ' ' + o.type)}</option>`).join('')}</datalist>
        <select class="pwsel" id="d_side"><option value="me">yours</option><option value="foe">enemy</option><option value="wild">wild</option></select>
        <select class="pwsel" id="d_lvl">${[1, 2, 3, 4, 5].map((l) => `<option value="${l}">level ${l}</option>`).join('')}</select>
        ${this.btn('spawn', 'Put down', 'small')}</div><small>At the middle of the screen. Your new Workshop objects are in the list too.</small></div>
      <div class="pwgrp"><b>World</b><div class="btns row">${this.btn('fog', G.fow && G.fow.revealAll ? 'Fog of war: off' : 'Fog of war: on', 'small')}${(G.campaign || G.sequel) ? this.btn('win', 'Win the mission', 'small') + this.btn('lose', 'Lose the mission', 'small') : ''}</div></div>
      ${this.objectivesGroup()}
      <div class="pwgrp"><b>Report</b><div class="btns row">${this.btn('report', 'Copy a report of the objects at the middle of the screen', 'small')}${this.btn('hitches', 'Copy the frame spikes', 'small')}</div><small>For bug reports: centre the camera on the objects (select your units too), then paste the copied text.</small></div>
      <p id="d_did"></p><div class="btns row">${this.btn('back', 'Back', 'small')}${this.btn('resume', 'Resume game', 'small')}</div>`);
    this.bind({
      res: () => { for (const r of ['food', 'wood', 'stone']) me.res[r] = (me.res[r] || 0) + 1000; say('+1000 food, wood and stone (above the storage limit too).'); },
      skulls: () => { me.res.skulls = (me.res.skulls || 0) + 500; say('+500 skulls.'); },
      epoch: () => { const e = me.epoch(); raiseEpoch(G, me, e + 1, me.maxEpoch || 0); say(me.epoch() > e ? `Epoch ${me.epoch()}.` : 'No further epoch (the highest, or the limit of the debug options).'); },
      free: () => { me.debug = !me.debug; this.debugTools(); say(me.debug ? 'Everything is free and instant for you now.' : 'Costs and times are back.'); },
      heal: () => { const l = mine((e) => e.hp < e.maxHp && (e.kind === 'unit' || e.built)); for (const e of l) e.hp = e.maxHp; say(`${l.length} healed or repaired.`); },
      lvl: () => { let n = 0; for (const u of [...G.sel]) if (u.alive && u.owner === me && u.kind === 'unit' && !W.levelUp(u)) n++; say(`${n} of the selected units levelled up${me.debug ? '' : ' (for skulls)'}.`); },
      kill: () => { let n = 0; for (const e of [...G.sel]) if (e.alive) { W.damage(e, e.hp + 1e6, null); n++; } say(`${n} destroyed.`); },
      spawn: () => {
        const n = this.win.querySelector('#d_cls').value.trim(), side = this.win.querySelector('#d_side').value, lv = +this.win.querySelector('#d_lvl').value;
        if (!n) return say('Type the class name of the object.');
        this.lastSpawn = n;
        const c = G.rtscam || { x: 0, z: 0 };
        const got = spawnObject(G, n, side, c.x, c.z, lv);
        say(typeof got === 'string' ? got : `${(D.text(n, got.owner) || {}).name || n} put down.`);
      },
      fog: () => { if (G.fow) G.fow.revealAll = !G.fow.revealAll; if (G.updateFow) G.updateFow(); this.debugTools(); say(G.fow && G.fow.revealAll ? 'The whole map is visible.' : 'The fog of war is back.'); },
      objdone: () => {
        const v = this.win.querySelector('#d_obj').value;
        if (!v) return say('No objective chosen.');
        const S = G.sequel, E = G.campaign && G.campaign.engine;
        if (S && S.complete) { S.complete(v); this.debugTools(); say('Objective marked as done.'); return; }
        if (E) { const q = E.quests.get(v), ran = E.skipQuest(q); this.debugTools(); say(ran.length ? `Done; the mission went on as if it had been met (${ran.join(', ')}).` : 'Marked as done (no trigger of the mission accomplishes it: only the mark changed).'); }
      },
      wipe: () => {
        const id = +this.win.querySelector('#d_plr').value, p = W.players.find((x) => x.id === id);
        if (!p) return say('No player chosen.');
        let n = 0;
        for (const e of [...W.units, ...W.buildings]) {
          if (!e.alive || e.owner !== p || (e.def && (e.def.wallKind || e.def.gate || /^CScorpion/.test(e.def.script || '')))) continue;
          W.damage(e, e.hp + 1e7, null); n++;
        }
        say(`${n} objects of player #${id} destroyed.`);
      },
      win: () => { this.close(); G.endMission(true, { text: 'Won with the debug tools.' }); },
      lose: () => { this.close(); G.endMission(false, { text: 'Lost with the debug tools.' }); },
      report: async () => {
        const c = G.rtscam || { x: 0, z: 0 };
        let text;
        try { text = objectReport(G, c.x, c.z, 25); } catch (e) { text = 'report failed: ' + e.message + '\n' + e.stack; }
        const errs = shownProblems().filter((k) => k.startsWith('err:'));
        text += '\n' + (errs.length ? 'errors shown: ' + errs.join(' | ') : 'no errors shown') + (G.build ? '\nbuild ' + G.build : '');
        say((await copyText(text)) ? 'The report is copied - paste it into the chat.' : 'Copying failed.');
      },
      // the frames that took far longer than usual (main.js noteHitch; counted in the F9 overlay)
      hitches: async () => {
        const text = G.hitchReport ? G.hitchReport() : '';
        if (!text) return say('No frame spikes so far.');
        say((await copyText(`frame spikes (game time, frame ms, slowest steps | first-time GPU work | world events)\n${text}\n${G.gpu || ''}${G.build ? '\nbuild ' + G.build : ''}`)) ? `${G.hitches.length} frame spikes copied - paste them into the chat.` : 'Copying failed.');
      },
      back: () => this.main(), resume: () => this.close(),
    });
  }
  // ---------------------------------------------------------------- the scenarios (docs/SCENARIOS.md)
  // five standalone missions in ParaWorld's world, each played as any tribe, with the data in use (base or MIRAGE)
  scenarios() {
    const s = this.G.settings;
    s.scenario = s.scenario || { mission: 1, tribe: 'Hu', difficulty: 1, won: {} };
    const k = s.scenario;
    k.won = k.won || {};
    this.open('Scenarios', `<div class="pwgrp"><b>Standalone missions in ParaWorld - play them as any tribe.</b><div class="missions"><div class="mlist" id="s_list">${SCENARIOS.map((m) =>
      `<div data-id="${m.id}">${m.id}. ${esc(m.title)}${(k.won[m.id] || []).length ? ' ✔' : ''}</div>`).join('')}</div><div class="mtext" id="s_text"></div></div></div>
      <div class="pwgrp"><b>Your tribe</b><div class="set"><span>The tribe you lead (the enemies are always of the others)</span><select class="pwsel" id="s_tribe">
        ${SCENARIO_TRIBES.map((t) => `<option value="${t}" ${k.tribe === t ? 'selected' : ''}>${TRIBE_NAMES[t]}</option>`).join('')}</select></div>
        <div class="set"><span>Difficulty</span><select class="pwsel" id="s_diff">
        ${['Easy', 'Medium', 'Hard'].map((t, i) => `<option value="${i}" ${+k.difficulty === i ? 'selected' : ''}>${t}</option>`).join('')}</select></div></div>
      ${debugRow(this)}
      <div class="btns row">${this.btn('back', 'Back', 'small')}${this.btn('start', 'Start mission', 'small')}</div>`, { title: true });
    const list = this.win.querySelector('#s_list'), text = this.win.querySelector('#s_text');
    const show = (id) => {
      const m = SCENARIOS.find((x) => x.id === id) || SCENARIOS[0];
      k.mission = m.id;
      list.querySelectorAll('div').forEach((d) => d.classList.toggle('on', +d.dataset.id === m.id));
      const won = (k.won[m.id] || []).map((t) => TRIBE_NAMES[t]).join(', ');
      text.innerHTML = `<b>${esc(m.title)}</b><small>${esc(m.place)}</small>${m.briefing.map((p) => esc(p)).join('<br><br>')}` + (won ? `<small class="mnote">Won as: ${esc(won)}</small>` : '');
    };
    list.querySelectorAll('div').forEach((d) => { d.onclick = () => { show(+d.dataset.id); this.click(); }; d.ondblclick = () => this.win.querySelector('[data-a="start"]').click(); });
    show(+k.mission || 1);
    const read = () => { k.tribe = this.win.querySelector('#s_tribe').value; k.difficulty = +this.win.querySelector('#s_diff').value; saveSettings(s); };
    this.bind({
      back: () => this.title(),
      cheats: () => { read(); debugPage(this, () => this.scenarios()); },
      start: () => {
        if (this.busy) return;
        read();
        const cfg = withCheats(s, { scenario: k.mission, tribe: k.tribe, difficulty: k.difficulty });
        this.close();
        if (this.hooks.start) this.hooks.start(cfg);
      },
    });
  }
  // ---------------------------------------------------------------- the sequel campaign (docs/SEQUEL.md)
  sequel() {
    const s = this.G.settings;
    s.sequel = s.sequel || { mission: 1, difficulty: 1, unlocked: 1, order: SEQUEL_ORDER };
    const k = s.sequel;
    if (migrateSettings(k)) saveSettings(s);        // (settings of the old numbering: a mission came in as 7)
    this.open('ParaWorld: Containment', `<div class="pwgrp"><b>1964. The dinosaurs have come to our world.</b><div class="missions"><div class="mlist" id="q_list">${SEQUEL_MISSIONS.map((m) =>
      // (the second chapter, missions_1966.js: a heading over its first mission)
      `${m.id === 12 ? '<p class="mch" style="margin:8px 0 2px;opacity:.7;font-size:12px;letter-spacing:.08em">1966</p>' : ''}<div data-id="${m.id}">${m.id}. ${esc(m.title)}${m.id < (k.unlocked || 1) ? ' ✔' : ''}</div>`).join('')}</div><div class="mtext" id="q_text"></div></div></div>
      <div class="pwgrp"><b>Difficulty</b><div class="set"><span>How strong the outbreak is</span><select class="pwsel" id="q_diff">
        ${['Easy', 'Medium', 'Hard'].map((t, i) => `<option value="${i}" ${+k.difficulty === i ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <small id="c_modnote">${Menu.dataMod(this.G) === SEQUEL_MOD ? '' : `Played with the ${SEQUEL_MOD} mod's game data (its SEAS).`}</small></div>
      ${debugRow(this)}
      <div class="btns row">${this.btn('back', 'Back', 'small')}${this.btn('start', 'Start mission', 'small')}</div>`, { title: true });
    const list = this.win.querySelector('#q_list'), text = this.win.querySelector('#q_text');
    const show = (id) => {
      const m = SEQUEL_MISSIONS.find((x) => x.id === id) || SEQUEL_MISSIONS[0];
      k.mission = m.id;
      list.querySelectorAll('div').forEach((d) => d.classList.toggle('on', +d.dataset.id === m.id));
      // what the mission brings in (missions.js unlocks)
      const news = (m.unlocks || []).map((u) => (SEQUEL_CLASSES[Array.isArray(u) ? u[0] : u] || {}).desc).filter(Boolean);
      text.innerHTML = `<b>${esc(m.title)}</b><small>${esc(m.place)} — ${esc(m.date)}</small>${m.briefing.map((p) => esc(p)).join('<br><br>')}` +
        (news.length ? `<small class="mnote">New: ${esc(news.join(', '))}</small>` : '');
    };
    list.querySelectorAll('div').forEach((d) => { d.onclick = () => { show(+d.dataset.id); this.click(); }; d.ondblclick = () => this.win.querySelector('[data-a="start"]').click(); });
    show(+k.mission || 1);
    this.bind({
      back: () => this.title(),
      cheats: () => { k.difficulty = +this.win.querySelector('#q_diff').value; saveSettings(s); debugPage(this, () => this.sequel()); },
      start: async () => {
        if (this.busy) return;
        k.difficulty = +this.win.querySelector('#q_diff').value;
        saveSettings(s);
        const cfg = withCheats(s, { sequel: k.mission, difficulty: k.difficulty });
        // the MIRAGE configuration's data (built from the installation the first time: switchConfig)
        if (Menu.dataMod(this.G) !== SEQUEL_MOD) {
          const conf = (await this.configs()).find((c) => c.id === SEQUEL_MOD);
          if (conf) { this.switchConfig(conf, cfg); return; }
          this.win.querySelector('#c_modnote').textContent = `ParaWorld: Containment needs the ${SEQUEL_MOD} mod: install it into your ParaWorld folder and start again.`;
          return;
        }
        this.close();
        if (this.hooks.start) this.hooks.start(cfg);
      },
    });
  }
  // ---------------------------------------------------------------- saved games (ui/saves.js, game/save.js)
  // the saves as a list: one row per save (name, what, game time, date); pick(meta) on a click
  async saveList(box, pick) {
    let list = [];
    try { list = await this.hooks.saves(); } catch (e) { box.innerHTML = `<div class="na">The saved games cannot be read: ${esc(e.message)}</div>`; return []; }
    const t = (s) => `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    box.innerHTML = list.length ? list.map((m, i) => `<div data-i="${i}"><b>${esc(m.name)}</b><span>${esc(m.title || '')}${m.mod ? ' · ' + esc(m.mod) : ''}</span>` +
      `<em>${t(m.gameTime || 0)} · ${new Date(m.date).toLocaleString()}</em></div>`).join('') : '<div class="na">No saved games yet</div>';
    box.querySelectorAll('[data-i]').forEach((d) => {
      d.onclick = () => { box.querySelectorAll('div').forEach((x) => x.classList.toggle('on', x === d)); pick(list[+d.dataset.i], false); this.click(); };
      d.ondblclick = () => pick(list[+d.dataset.i], true);
    });
    return list;
  }
  saveWin() {
    this.inGame = true;
    const name0 = this.hooks.saveName ? this.hooks.saveName() : 'Saved game';
    this.open('Save game', `<div class="pwgrp"><b>Name</b><input class="pwinput" id="sv_name" maxlength="60" value="${esc(name0)}"></div>
      <div class="pwgrp"><b>Saved games</b><div class="slist" id="sv_list"><div>…</div></div></div><small id="sv_note"></small>
      <div class="btns row">${this.btn('back', 'Back', 'small')}${this.btn('save', 'Save', 'small')}</div>`);
    const inp = this.win.querySelector('#sv_name'), note = this.win.querySelector('#sv_note');
    let over = null;           // the save picked in the list: saving replaces it
    this.saveList(this.win.querySelector('#sv_list'), (m, dbl) => { over = m.quick ? null : m; inp.value = m.name; if (dbl) this.win.querySelector('[data-a="save"]').click(); });
    inp.oninput = () => { if (over && inp.value !== over.name) over = null; };
    inp.focus(); inp.select();
    const save = async () => {
      if (this.busy) return;
      this.busy = true; note.textContent = 'Saving…';
      try { await this.hooks.save(inp.value.trim() || name0, over ? over.id : null); this.busy = false; this.close(); } catch (e) { this.busy = false; note.textContent = 'The game could not be saved: ' + e.message; }
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') save(); e.stopPropagation(); };
    this.bind({ back: () => this.main(), save });
  }
  loadWin(back) {
    this.open('Load game', `<div class="pwgrp"><b>Saved games</b><div class="slist" id="ld_list"><div>…</div></div></div><small id="ld_note"></small>
      <div class="btns row">${this.btn('back', 'Back', 'small')}${this.btn('del', 'Delete', 'small')}${this.btn('exp', 'Export', 'small')}${this.btn('imp', 'Import', 'small')}${this.btn('load', 'Load', 'small')}</div>
      <input type="file" id="ld_file" accept=".pwsave,application/gzip,application/json" style="display:none">`, { title: !this.inGame });
    const box = this.win.querySelector('#ld_list'), note = this.win.querySelector('#ld_note'), file = this.win.querySelector('#ld_file');
    let sel = null;
    const fill = () => { sel = null; return this.saveList(box, (m, dbl) => { sel = m; if (dbl) load(); }); };
    const load = () => {
      if (!sel || this.busy) return;
      const go = () => { note.textContent = 'Loading…'; this.hooks.load(sel).catch((e) => { note.textContent = 'The game could not be loaded: ' + e.message; }); };
      if (this.inGame && !this.G.over) this.confirm('Load this game? What is not saved of the running game is lost.', go, () => this.loadWin(back)); else go();
    };
    fill();
    file.onchange = async () => {
      const f = file.files && file.files[0];
      if (!f) return;
      try { const m = await this.hooks.importSave(f); note.textContent = `"${m.name}" was added.`; fill(); } catch (e) { note.textContent = 'This file is not a saved game: ' + e.message; }
      file.value = '';
    };
    this.bind({
      back, load,
      del: () => { if (!sel) return; const m = sel; this.confirm(`Delete "${esc(m.name)}"?`, async () => { await this.hooks.deleteSave(m.id); this.loadWin(back); }, () => this.loadWin(back)); },
      exp: () => { if (sel) this.hooks.exportSave(sel.id).catch((e) => { note.textContent = e.message; }); },
      imp: () => file.click(),
    });
  }
  // the page of another game data configuration (a mod), with a game to start there
  async openConfig(mod, cfg) {
    const conf = (await this.configs()).find((c) => c.id === mod);
    if (!conf) throw new Error(`this game was saved with ${mod || 'the official game data'}, which is not available here`);
    this.switchConfig(conf, cfg);
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
    // the original's option texts (main_uk.ltf, gamedata.json "ui") once the game data is loaded
    const ui = (k, d) => (this.G.data && this.G.data.ui ? this.G.data.ui(k, d) : d);
    this.open('Options', `<div class="pwgrp"><b>Game</b><div class="set">
        ${chk('s_income', s.showIncome, 'Show resource income per minute')}
        ${chk('s_edge', s.edgeScroll, 'Scroll at screen edges')}
        ${chk('s_automenu', s.autoMenu !== false, 'Open the build / produce menu when selecting workers or buildings')}
        ${chk('s_tipnear', s.tipNear !== false, 'Tooltips next to what the mouse is over (off: the original window above the minimap)')}
        ${chk('s_mentor', s.mentor !== false, 'Show the mentor\'s hints in campaign missions')}
        ${chk('s_mmrot', !!s.minimapRotate, ui('_UI_OptionsM_CheckBox_RotateMinimap', 'Rotate Minimap'))}
        ${chk('s_mmcol', s.minimapPlayerColors !== false, ui('_UI_OptionsM_CheckBox_UsePlayerColors', 'Use Player Colors'))}
        ${chk('s_autosave', s.autosave !== false, ui('_UI_OptionsM_AutoSave', 'Enable autosave'))}
        <span>Autosave every</span><select class="pwsel" id="s_autosavemin">${[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60].map((v) => opt(v, s.autosaveMin || 10, v + ' min')).join('')}</select>
        <span>Game speed</span><select class="pwsel" id="s_speed">${opt(0.5, s.speed, 'Slow')}${opt(1, s.speed, 'Normal')}${opt(1.5, s.speed, 'Fast')}${opt(2, s.speed, 'Very fast')}</select>
        <span>Interface size</span><select class="pwsel" id="s_ui">${opt(0, s.uiScale, 'Automatic')}${opt(1, s.uiScale, '100 %')}${opt(1.25, s.uiScale, '125 %')}${opt(1.5, s.uiScale, '150 %')}${opt(1.75, s.uiScale, '175 %')}</select>
      </div></div>
      <div class="pwgrp"><b>Graphics</b><div class="set">
        <span>Shadows</span><select class="pwsel" id="s_shadows">${opt('off', s.shadows, 'Off')}${opt('on', s.shadows, 'On')}${opt('high', s.shadows, 'High')}</select>
        <span>Grass</span><select class="pwsel" id="s_grass">${opt('off', s.grass, 'Off')}${opt('on', s.grass, 'On')}${opt('dense', s.grass, 'Dense')}</select>
        <span>Particle effects</span><select class="pwsel" id="s_particles">${opt('off', s.particles, 'Off')}${opt('low', s.particles, 'Low')}${opt('on', s.particles, 'On')}${opt('high', s.particles, 'High')}</select>
        ${chk('s_weather', s.weather !== false, 'Weather (snow, rain)')}
        <span>Frame rate limit</span><select class="pwsel" id="s_fps">${opt(30, s.fpsCap, '30 fps')}${opt(60, s.fpsCap, '60 fps')}${opt(120, s.fpsCap, '120 fps')}${opt(0, s.fpsCap, 'Unlimited')}</select>
        <span>Render resolution</span><select class="pwsel" id="s_res">${opt(0.5, s.resScale, '50 %')}${opt(0.67, s.resScale, '67 %')}${opt(0.75, s.resScale, '75 %')}${opt(1, s.resScale, '100 %')}</select>
        ${chk('s_aa', s.antialias, 'Anti-aliasing (after restart)')}
        ${chk('s_warm', s.warmup !== false, 'Prepare all graphics while loading (fewer stutters, longer loading)')}
        ${chk('s_perf', s.perf, 'Show performance (F9)')}
      </div></div>
      <div class="pwgrp"><b>Sound</b><div class="set">
        ${chk('s_sound', s.sound, 'Sound on')}
        <span>Master volume</span>${rng('s_vm', s.volMaster)}
        <span>Effects</span>${rng('s_vs', s.volSfx)}
        <span>Speech</span>${rng('s_vv', s.volVoice)}
        <span>Music</span>${rng('s_vmu', s.volMusic)}
        <span>Ambience</span>${rng('s_vat', s.volAtmo ?? 0.8)}
      </div></div>
      <div class="btns">${this.btn('ok', 'OK')}</div>`, { title: !this.inGame });
    const $ = (id) => this.win.querySelector('#' + id);
    const apply = () => {
      s.showIncome = $('s_income').checked; s.edgeScroll = $('s_edge').checked; s.autoMenu = $('s_automenu').checked; s.tipNear = $('s_tipnear').checked; s.mentor = $('s_mentor').checked; s.minimapRotate = $('s_mmrot').checked; s.minimapPlayerColors = $('s_mmcol').checked; s.speed = +$('s_speed').value; s.uiScale = +$('s_ui').value; s.autosave = $('s_autosave').checked; s.autosaveMin = +$('s_autosavemin').value;
      s.shadows = $('s_shadows').value; s.grass = $('s_grass').value; s.particles = $('s_particles').value; s.weather = $('s_weather').checked; s.fpsCap = +$('s_fps').value; s.resScale = +$('s_res').value; s.antialias = $('s_aa').checked; s.warmup = $('s_warm').checked; s.perf = $('s_perf').checked;
      s.sound = $('s_sound').checked; s.volMaster = $('s_vm').value / 100; s.volSfx = $('s_vs').value / 100; s.volVoice = $('s_vv').value / 100; s.volMusic = $('s_vmu').value / 100; s.volAtmo = $('s_vat').value / 100;
      saveSettings(s);
      if (this.hooks.applySettings) this.hooks.applySettings(s);
    };
    this.win.querySelectorAll('input,select').forEach((i) => { i.onchange = apply; i.oninput = apply; });
    this.bind({ ok: () => { apply(); back ? back() : this.close(); } });
  }
  // the in-game help (ui/helpbook.js): at a topic (file#key) or the start; F1 opens it on what is under the mouse,
  // being placed or selected (the game pauses while it is open, as the original's)
  helpBook(ref, back) { this.inGame = !!this.G.ready; (this.book = this.book || new HelpBook(this)).open(ref, back); }
  helpFor() { this.inGame = true; (this.book = this.book || new HelpBook(this)).openFor(this.G, null); }
  help(back) {
    this.open('Controls', `<table class="keys">
      <tr><td>Left click / drag</td><td>Select / box select (Shift adds) · double-click: all of that kind on screen (Ctrl: of that type, Shift: everything)</td></tr>
      <tr><td>F1</td><td>Help on what is under the mouse or selected</td></tr>
      <tr><td>Right click</td><td>Move, attack, gather, build, repair, deliver, heal (healers), enter a bunker / transport, set rally point</td></tr>
      <tr><td>Right drag</td><td>Draw an arrow: the group lines up there facing the arrow, the longer the arrow the wider the ranks</td></tr>
      <tr><td>Shift / Ctrl + right click</td><td>Add a waypoint · patrol between here and there</td></tr>
      <tr><td>Q · A · Y</td><td>Build menu (workers) or produce menu: top · middle · bottom row, then 1 – 0 for its buttons</td></tr>
      <tr><td>E · D · C · X</td><td>Special moves: top · middle · bottom row · stances (then 1 hold, 2 defensive, 3 aggressive)</td></tr>
      <tr><td>V · B · N · S</td><td>Attack · move · attack-move · stop</td></tr>
      <tr><td>H · T Z U I O P L K</td><td>Headquarters · next HQ, barracks, farm, machine maker, harbour, temple, weapon smith, tavern</td></tr>
      <tr><td>Walls</td><td>Click the start point, then the end point: a line of segments is placed</td></tr>
      <tr><td>Arrows · screen edge · wheel</td><td>Scroll · zoom · PgUp/PgDn zoom · End reset</td></tr>
      <tr><td>Middle drag · Alt + left / middle + right drag</td><td>Pan · turn the camera (Alt + right drag: pan)</td></tr>
      <tr><td>Army pyramid</td><td>Drag a card onto a free place of a higher row to level the unit up (the skulls of every level on the way); right-click a card: one level up</td></tr>
      <tr><td>Ctrl+U · right click on a card</td><td>Level up by one</td></tr>
      <tr><td>Ctrl+0–9 · 0–9</td><td>Assign / select group (double tap centres; Ctrl+digit with nothing selected keeps the view)</td></tr>
      <tr><td>W · Shift+W · Ctrl+W · .</td><td>Next idle worker · add one · all idle workers · next idle worker</td></tr>
      <tr><td>Space · Home</td><td>Last alert · centre on selection</td></tr>
      <tr><td>R · Del · Shift+Del</td><td>Rally point · destroy the first selected · destroy all selected</td></tr>
      <tr><td>Alt (hold)</td><td>Show all health bars</td></tr>
      <tr><td>J</td><td>Quest log (campaign) · cutscenes: click or Space = next line, Esc = skip</td></tr>
      <tr><td>Ctrl+A · F2 · F3</td><td>All your units on screen · camera follows the selected unit · free camera</td></tr>
      <tr><td>Numpad + − × ÷</td><td>Game speed faster · slower · normal · pause</td></tr>
      <tr><td>F5 / Ctrl+S · F8 · Backspace</td><td>Quick save · quick load · hide the interface</td></tr>
      <tr><td>Pause · F1 · F9 · Esc/F10</td><td>Pause · these controls · performance overlay · menu</td></tr>
      </table><div class="btns">${this.btn('back', 'Back')}</div>`, { title: !this.inGame });
    this.bind({ back: () => (back ? back() : this.close()) });
  }
  // The end of a game (the original's CEndScreen, EndScreen.usl 34-256; docs/spec/ui_groups7_9.md §5): the
  // victory / defeat picture, "You were victorious!" / "You have been defeated!" and why, the game paused, and the
  // buttons Retry (a won mission: Continue), Load Game, View Statistics, Back to Main menu, Quit. A won mission also
  // lists its quests and bonus points; a skirmish keeps "Keep playing" (the remake's: watch the game go on).
  // stats: { time, kills, lost, epoch, enemy (skirmish) | mission: { title, text (reason line of a defeat), points (bonus
  // points, optional), next (index entry | null), difficulty } }
  end(won, stats) {
    this.inGame = true;
    const m = stats.mission, C = this.G.campaign, D = this.G.data;
    const esc = (t) => String(t || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]);
    const ui = (k, d) => (D ? D.ui('_EndScreen_' + k, d) : d);
    const tx = (k, d) => (C && C.data && C.data.texts && C.data.texts[k]) || d;
    let body;
    if (m) {
      // a mission: its name, the result (the game's own "_GAOV_" lines), why it was lost, what the quests came to
      const quests = (C && C.data && C.data.quests || []).filter((q) => q.visible);
      const key = ['easy', 'medium', 'hard', 'hard'][m.difficulty] || 'medium', pts = (q) => +((q.bonus || {})[key] || 0);
      const earned = quests.reduce((a, q) => a + (q.accomplished ? pts(q) : 0), 0), max = quests.reduce((a, q) => a + pts(q), 0);
      const st = (q) => (q.accomplished ? 'done' : q.unaccomplishable ? 'failed' : 'open');
      const mark = { done: '✔', failed: '✘', open: '•' };
      body = `<h3 class="${won ? 'won' : 'lost'}">${esc(won ? tx('_GAOV_Accomplished', 'Mission successful!') : tx('_GAOV_Failed', 'Mission has failed.'))}</h3>
        <p>${esc(m.title)}</p>${m.text ? `<p class="${won ? 'points' : 'reason'}">${esc(m.text)}</p>` : ''}
        ${quests.length ? `<div class="endq">${quests.map((q) => `<div class="q ${st(q)}"><i>${mark[st(q)]}</i><span>${esc(q.headline || q.name)}</span><em>${q.accomplished && pts(q) ? '+' + pts(q) : ''}</em></div>`).join('')}</div>` : ''}
        ${m.points != null || max ? `<p class="points">Bonus points: ${m.points != null ? m.points : earned}${m.points == null && max ? ' of ' + max : ''}</p>` : ''}`;
    } else {
      body = `<h3 class="${won ? 'won' : 'lost'}">${esc(won ? ui('YouWin', 'You were victorious!') : ui('YouLose', 'You have been defeated!'))}</h3>
      ${stats.text ? `<p>${esc(stats.text)}</p>` : ''}`;
    }
    const cont = m && won;                                     // Continue: the next mission
    const canNext = cont && m.next && (m.sequel || Menu.missionOpen(m.next.id));
    const caption = m ? ui('Campaign', 'Campaign') : ui('Skirmish', 'Skirmish');
    this.open(caption, `<img class="gameover" src="assets/ui/menu/menue__decoration__gameover_${won ? 'victory' : 'defeat'}.png" alt="">
      ${body}
      <table class="keys"><tr><td>Time</td><td>${stats.time}</td></tr><tr><td>Enemies killed</td><td>${stats.kills}</td></tr>
      <tr><td>Units lost</td><td>${stats.lost}</td></tr>${m ? '' : `<tr><td>Epoch reached</td><td>${stats.epoch}</td></tr>`}</table>
      <div class="btns">${cont ? this.btn('next', ui('Continue', 'Continue'), canNext ? '' : 'off') : this.btn('restart', ui('Retry', 'Retry'))}
        ${this.btn('load', ui('LoadGame', 'Load Game'))}${this.G.world && this.G.world.stats ? this.btn('stats', ui('ViewStatistics', 'View Statistics')) : ''}
        ${m ? '' : this.btn('watch', 'Keep playing')}${this.btn('quit', ui('BackToMenu', 'Back to Main menu'))}${this.hooks.exit ? this.btn('exit', ui('QuitToWindows', 'Quit')) : ''}</div>`);
    this.bind({
      watch: () => this.close(), restart: () => this.hooks.restart && this.hooks.restart(), quit: () => this.hooks.quit && this.hooks.quit(),
      exit: () => this.hooks.exit && this.hooks.exit(),
      load: () => this.loadWin(() => this.end(won, stats)),
      stats: () => statsWindow(this.G, () => this.end(won, stats)),
      next: () => {
        if (!canNext) return;
        if (m.scenario) { if (this.hooks.startCampaign) this.hooks.startCampaign({ scenario: m.next.id, tribe: m.tribe, difficulty: m.difficulty }); return; }
        if (m.sequel) { if (this.hooks.startCampaign) this.hooks.startCampaign({ sequel: m.next.id, difficulty: m.difficulty }); return; }
        const s = this.G.settings; s.campaign.mission = m.next.id; saveSettings(s);
        const cfg = { campaign: m.next.id, difficulty: m.difficulty, tribe: (this.G.config || {}).tribe || '' };
        const go = (c) => { if (this.hooks.startCampaign) this.hooks.startCampaign(c); };
        if (m.next.point_buy) this.campaignArmy(m.next, cfg, () => this.end(won, stats), go); else go(cfg);
      },
    });
  }
}
