// The "Debug options" page of the campaign, skirmish and sequel windows: what the next game starts with (game/cheats.js,
// docs/DEBUG_OPTIONS.md). The choices are kept in the settings (settings.cheats) and handed to the game in its config
// (cfg.cheats) when "Use the debug options" is ticked.
//
//   debugPage(menu, back)        opens the page in the menu's window; back() returns to the window it came from
//   debugRow(menu, onOpen)       the line for those windows: what is on, and the button that opens the page
//   withCheats(settings, cfg)    the config with the chosen options (or without any)

import { defaultCheats, normCheats, cheatSummary } from '../game/cheats.js';
import { saveSettings } from './menu.js';

const esc = (t) => String(t == null ? '' : t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const STD_PYRAMID = [25, 15, 8, 3, 1];

export function cheatsOf(settings) { return (settings.cheats = normCheats(settings.cheats)); }
export function withCheats(settings, cfg) {
  const c = cheatsOf(settings);
  return c.on ? { ...cfg, cheats: JSON.parse(JSON.stringify(c)), debug: !!(cfg.debug || c.free) } : cfg;
}

// the summary line and the "Debug options…" button (data-a="cheats")
export function debugRow(menu) {
  const c = cheatsOf(menu.G.settings), list = cheatSummary(c);
  return `<div class="dbgrow"><span>${c.on ? `<b>Debug options on:</b> ${esc(list.length ? list.join(' · ') : 'nothing changed')}` : 'Debug options: off'}</span>${menu.btn('cheats', 'Debug options…', 'small')}</div>`;
}

export function debugPage(menu, back) {
  const G = menu.G, s = G.settings;
  let c = cheatsOf(s);
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), c);
  const put = (path, v) => { const ks = path.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], c)[last] = v; };
  const box = (k, label, tip = '') => `<label class="pwcheck full" title="${esc(tip)}"><input type="checkbox" data-k="${k}"><i></i>${label}</label>`;
  // a number field; empty = the game's own value (nullable) or the default (factors)
  const numIn = (k, ph, w = 74, step = 'any') => `<input class="pwsel dbgnum" type="number" min="0" step="${step}" data-k="${k}" data-n="1" placeholder="${esc(ph)}" style="width:${w}px">`;
  const sel = (k, list) => `<select class="pwsel" data-k="${k}" data-n="1">${list.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>`;
  const EPOCHS = [[0, 'as the game'], [2, 'II'], [3, 'III'], [4, 'IV'], [5, 'V']];
  const MAXEP = [[0, 'no limit'], [1, 'I'], [2, 'II'], [3, 'III'], [4, 'IV'], [5, 'V']];
  const res = (r, label) => `<span>${label}</span>${numIn('res.' + r, 'game', 90, 1)}`;

  menu.open('Debug options', `<div class="dbgopts">
    <div class="pwgrp"><b>Debug options</b><div class="set">
      ${box('on', '<b>Use the debug options</b> in the next game (campaign, skirmish and Containment)', 'Off: the game is played as normal; the choices below are kept')}
      <small class="full" id="d_sum"></small></div></div>
    <div class="dbgcols">
    <div class="pwgrp"><b>Game</b><div class="set">
      ${box('free', 'Everything free and instant (you)', 'Buildings stand, units are trained and upgrades researched at once, nothing costs anything, level-ups need no skulls')}
      ${box('reveal', 'Whole map visible (no fog of war)')}
      ${box('unlock', 'Ignore the mission\'s bans (every unit, building and upgrade of your tribe)', 'Campaign and Containment missions forbid some things; with this nothing is forbidden for you')}
      <span>Computer players</span>${sel('ai', [['normal', 'attack as usual'], ['passive', 'do not attack you']])}
      <small class="full">Passive computer players still defend themselves; a mission's scripted attacks still come.</small>
    </div></div>
    <div class="pwgrp"><b>Your start and economy</b><div class="set">
      ${res('food', 'Food')}${res('wood', 'Wood')}${res('stone', 'Stone')}${res('skulls', 'Skulls (level-ups)')}
      <span>Storage limit per resource</span>${numIn('storage', 'buildings', 90, 1)}
      <span>Gathering ×</span>${numIn('gather', '1', 74)}
      <span>Construction, training, research speed ×</span>${numIn('speed', '1', 74)}
    </div></div>
    <div class="pwgrp"><b>Your army</b><div class="set">
      <span>Unit limit (population)</span>${numIn('popMax', 'map', 90, 1)}
      ${box('noHousing', 'No houses needed (the unit limit is all yours from the start)')}
      <span class="full">Places in the army pyramid per level (empty: the game's or the mission's)</span>
      <div class="full dbgpyr">${[5, 4, 3, 2, 1].map((lv) => `<label>Level ${lv} ${numIn('pyramid.' + (lv - 1), STD_PYRAMID[lv - 1], 64, 1)}</label>`).join('')}</div>
    </div></div>
    <div class="pwgrp"><b>Epochs and fighting</b><table class="dbgtab"><thead><tr><th></th><th>You</th><th>Enemies</th></tr></thead><tbody>
      <tr><td>Start in epoch</td><td>${sel('me.startEpoch', EPOCHS)}</td><td>${sel('foe.startEpoch', EPOCHS)}</td></tr>
      <tr><td>Highest epoch</td><td>${sel('me.maxEpoch', MAXEP)}</td><td>${sel('foe.maxEpoch', MAXEP)}</td></tr>
      <tr><td title="0: no damage at all">Damage dealt ×</td><td>${numIn('me.dmg', '1')}</td><td>${numIn('foe.dmg', '1')}</td></tr>
      <tr><td title="2: half the damage taken">Defence ×</td><td>${numIn('me.def', '1')}</td><td>${numIn('foe.def', '1')}</td></tr>
    </tbody></table><small>Enemies: the players hostile to you and the wild animals. Damage 0 = no damage dealt; defence 2 = half the damage taken.</small></div>
    </div></div>
    <div class="btns row">${menu.btn('reset', 'Defaults', 'small')}${menu.btn('done', 'Done', 'small')}</div>`, { title: true });
  const W = menu.win;
  W.classList.add('wide');
  const leave = () => { W.classList.remove('wide'); saveSettings(s); back(); };
  const fill = () => {
    W.querySelectorAll('[data-k]').forEach((e) => {
      const v = get(e.dataset.k);
      if (e.type === 'checkbox') e.checked = !!v;
      else e.value = v == null || (e.dataset.n && e.type === 'number' && v === 1 && /dmg|def|gather|speed/.test(e.dataset.k)) ? '' : String(v);
    });
    W.querySelector('#d_sum').textContent = c.on ? (cheatSummary(c).join(' · ') || 'Nothing is changed yet.') : 'Off: the next game is played as normal.';
  };
  W.querySelectorAll('[data-k]').forEach((e) => {
    e.onchange = () => {
      const k = e.dataset.k;
      let v;
      if (e.type === 'checkbox') v = e.checked;
      else if (e.tagName === 'SELECT') v = /^\d+$/.test(e.value) ? +e.value : e.value;
      else v = e.value.trim() === '' ? null : +e.value;
      put(k, v);
      // a change turns the options on (what else would it be for)
      if (k !== 'on') c.on = true;
      c = s.cheats = normCheats(c);
      saveSettings(s);
      fill();
    };
  });
  menu.bind({
    reset: () => { c = s.cheats = { ...defaultCheats(), on: c.on }; saveSettings(s); fill(); },
    done: leave,
  });
  fill();
}
