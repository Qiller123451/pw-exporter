import { UIA, spriteCss, entry, iconFor } from './atlas.js';
import { ttHtml, objectTip, actionTip, buttonTip, helpTip, TipWindow } from './tooltip.js';
import { visibleBuffs } from '../game/buffs.js';

// ParaWorld HUD rebuilt from the original textures: resource bar, minimap, info window, command bar, army pyramid.
export const PYR = (() => {
  const L5 = [[58, 14, 60, 57]], L4 = [[8, 89, 46, 45], [65, 89, 46, 45], [122, 89, 46, 45]], L3 = [], L2 = [], L1 = [];
  for (const y of [152, 195]) for (const x of [8, 50, 92, 134]) L3.push([x, y, 34, 34]);
  for (const y of [246, 282, 318]) for (const x of [8, 41, 74, 107, 140]) L2.push([x, y, 27, 27]);
  for (const y of [362, 398, 435, 471, 507]) for (const x of [8, 41, 74, 107, 140]) L1.push([x, y, 27, 27]);
  return [L1, L2, L3, L4, L5];
})();
export const ICON_LVL = [2, 2, 2, 3, 4];   // atlas level index per pyramid row (bigger cards higher up)
const RES_ICON = { food: 'resicon_food', wood: 'resicon_wood', stone: 'resicon_stone', skulls: 'resicon_scalps', units: 'resicon_unit' };

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
const img = (file) => `url(${UIA.base}${file})`;

const fmt = (n) => Math.floor(n).toString();
const REASON_DOWN = 'A unit keeps the level it has reached';

export class HUD {
  constructor(G) {
    this.G = G;
    this.root = el('div', 'hud', document.body);
    this.root.id = 'hud';
    this.buildTop();
    this.buildBottom();
    this.buildPyramid();
    // the right column under the menu buttons (IngameScreen.usl: the news ticker at x desktop - 235, y 37), down to
    // the minimap: the campaign's news ticker, the sequel's objectives and command powers (ui/mission.js, sequel_ui.js)
    this.rcol = el('div', 'rcol', this.root);
    this.msgs = el('div', 'msgs', this.root);
    this.flyout = el('div', 'flyout hidden', this.root);
    this.menu = null;
    this.hoverT = 0;
    this.scale();
    window.addEventListener('resize', () => this.scale());
    for (const e of ['mousedown', 'mouseup', 'click', 'contextmenu', 'wheel']) this.root.addEventListener(e, (ev) => { if (ev.target !== this.root) ev.stopPropagation(); });
  }
  scale() {
    const s = this.G.settings.uiScale || Math.max(1, Math.min(1.6, window.innerHeight / 780));
    this.s = s;
    for (const e of [this.tl, this.tr, this.bl, this.br, this.flyout]) e.style.transform = `scale(${s})`;
    // the army pyramid on the left (IngameScreen.usl: the tribe view at x 32), between the resource bar and the info window
    const ps = Math.min(s, (window.innerHeight - 74 - 205 * s) / 560);
    this.pyrWrap.style.transform = `scale(${ps})`;
    // the bottom-left dialogue boxes (.mdlg, .sqradio: x 212 right of the pyramid, 198 above the bottom, left of the
    // minimap); a window too narrow for that puts them above the minimap's top instead, as wide as the screen allows
    const room = (window.innerWidth - 490 * s) / s;
    this.root.style.setProperty('--s', s);
    this.root.style.setProperty('--dlgw', Math.round(room >= 300 ? Math.min(480, room) : Math.min(480, window.innerWidth / s - 220)) + 'px');
    this.root.style.setProperty('--dlgb', (room >= 300 ? 198 : 274) + 'px');
    this.rcol.style.transform = `scale(${s})`;
    this.rcol.style.top = Math.round(37 * s) + 'px';
    this.rcol.style.maxHeight = Math.max(80, Math.floor((window.innerHeight - 37 * s - 270 * s - 8) / s)) + 'px';
  }

  // ------------------------------------------------------------------ top: resources + menu
  // the top bar as IngameScreen.usl puts it: the group bar at x 11 (GroupBar.usl), the menu button at 235, the resource
  // bar at 295, then the quest (720), diplomacy (789) and chat (869) buttons
  buildTop() {
    this.tl = el('div', 'corner tl', this.root);
    this.groupBar = el('div', 'grpbar', this.tl);
    this.groupBtns = [];
    for (let i = 0; i < 10; i++) {
      const k = (i + 1) % 10, b = el('div', 'grpbtn', this.groupBar);       // 1 .. 9, then 0
      b.style.left = (i * 20) + 'px';
      b.onclick = () => this.G.input.groupButton(String(k), 'click');
      b.oncontextmenu = (ev) => { ev.preventDefault(); this.G.input.groupButton(String(k), 'assign'); };
      b.ondblclick = () => this.G.input.groupButton(String(k), 'double');
      this.groupBtns[k] = b;
    }
    const bar = el('div', 'resbar', this.tl);
    bar.style.backgroundImage = img('hud_resource_bar.png');
    this.resEls = {};
    ['units', 'skulls', 'food', 'wood', 'stone'].forEach((k, i) => {
      const v = el('div', 'rv', bar);
      v.style.left = (22 + i * 78) + 'px';
      v.innerHTML = '<b>0</b><i></i>';
      this.resEls[k] = v;
      v.addEventListener('mouseenter', () => this.showTip(v, this.resTip(k)));
      v.addEventListener('mouseleave', () => this.hideTip());
    });
    this.epochEl = el('div', 'epoch', bar, '');
    this.tr = el('div', 'corner tr', this.root);
    const mk = (tex, label, fn, x) => {
      const b = el('div', 'mbtn', this.tl);
      b.style.backgroundImage = img(tex);
      b.style.left = x + 'px';
      b.innerHTML = `<span>${label}</span>`;
      b.onclick = fn;
      return b;
    };
    const mb = mk('hud_menu_menubutton.png', 'Menu', () => this.G.openMenu(), 235);
    mb.classList.add('menu');
    const face = (f) => { mb.style.backgroundImage = img(`hud_menu_menubutton${f}.png`); };
    mb.onmouseenter = () => { face('_hover'); this.showTip(mb, buttonTip(this.G, '_tb_menu')); };
    mb.onmouseleave = () => { face(''); this.hideTip(); };
    mb.onmousedown = () => face('_down');
    mb.onmouseup = () => face('_hover');
    this.perfEl = el('div', 'perf hidden', this.root);
    // the game's timers (the engine's ObjTime icons, hud_timers "timer_<icon>" 65 x 25: head quarter, warp gate,
    // domination, defender) top right, one under the other (game/systems/gameover.js goTimers)
    this.timersEl = el('div', 'timers', this.root);
  }
  refreshTimers() {
    const W = this.G.world, list = W.goTimers ? W.goTimers() : [];
    const mmss = (t) => { t = Math.max(0, Math.ceil(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
    const key = list.map((t) => t.icon + mmss(t.left) + (t.paused ? 'p' : '') + (t.owner ? t.owner.id : '')).join('|');
    if (key === this.timerKey) return;
    this.timerKey = key;
    this.timersEl.innerHTML = list.map((t) => {
      const tip = (this.G.data.ui(t.tip, '%1') || '%1').replace('%1', t.owner ? t.owner.name : '');
      const col = t.owner ? '#' + (t.owner.color >>> 0).toString(16).padStart(6, '0') : '#e0b978';
      return `<div class="tm${t.paused ? ' paused' : ''}" data-tt="${tip.replace(/"/g, '&quot;')}" style="${spriteCss('timer_' + t.icon, -1, 65, 25) || spriteCss('timer_default', -1, 65, 25) || ''}"><b style="color:${col}">${mmss(t.left)}</b></div>`;
    }).join('');
    this.timersEl.querySelectorAll('[data-tt]').forEach((d) => { d.onmouseenter = () => this.showTip(d, `<b>${d.dataset.tt}</b>`); d.onmouseleave = () => this.hideTip(); });
  }
  // the top bar's Diplomacy (skirmish games, IngameScreen.usl:327-341, 737-757) and Chat buttons (IS:342-358: the
  // right click opens the history); hud_menu_alliesbutton 91 px, hud_menu_chatbutton 80 px
  buildTopButtons() {
    const G = this.G, D = G.data;
    const mk = (name, tex, w, label, fn, rfn, tip) => {
      const b = el('div', 'mbtn ' + name);
      b.style.backgroundImage = img(tex); b.style.width = w + 'px';
      b.innerHTML = `<span>${label}</span>`;
      b.onclick = fn;
      if (rfn) b.oncontextmenu = (ev) => { ev.preventDefault(); rfn(); };
      b.onmouseenter = () => this.showTip(b, `<b>${D.ui(tip, label)}</b>`);
      b.onmouseleave = () => this.hideTip();
      this.slot(name, b);
      return b;
    };
    if (G.world.rules.multiplayer && G.setup) mk('diplomacy', 'hud_menu_alliesbutton.png', 91, D.ui('_UI_IngaScre_Button_Diplomacy', 'Diplomacy'), () => G.diplomacy(), null, '_UI_IngaScre_Button_Diplomacy_TT');
    mk('chat', 'hud_menu_chatbutton.png', 80, D.ui('_UI_IngaScre_Button_Chat', 'Chat'), () => G.chat.open('all'), () => G.chat.showHistory(), '_UI_IngaScre_Button_Chat_TT');
  }
  // the top bar's buttons right of the resource bar: 'quest' (x 720), 'diplomacy' (789), 'chat' (869)
  slot(name, e) {
    e.style.left = ({ quest: 720, diplomacy: 789, chat: 869 })[name] + 'px';
    this.tl.appendChild(e);
  }
  // GroupBar.usl: a button per assigned group (its number), the selected one pressed; of the unassigned ones only the
  // first after the last assigned one shows (MODE_FREAKY, the default)
  refreshGroups() {
    const I = this.G.input, key = [...Array(10).keys()].map((k) => (I.groups[k] || []).some((x) => x.alive) ? 1 : 0).join('') + (I.selGroup ?? '');
    if (key === this.grpKey) return;
    this.grpKey = key;
    const used = (k) => (I.groups[k] || []).some((x) => x.alive);
    // (UpdateVisibility: from group 9 down to the first assigned one below an unassigned one; then the first
    // unassigned one above it - or button 0 when group 9 is assigned)
    let i = 9, empty = false;
    for (; i >= 0; i--) { if (used(i) && empty) break; if (!used(i)) empty = true; }
    let next = null;
    if (empty) {
      if (used(9)) next = 0;
      else { if (i === -1) i = 0; for (let j = i + 1; j < 10; j++) if (!used(j)) { next = j; break; } }
    }
    for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]) {
      const b = this.groupBtns[k], on = used(k);
      b.style.display = on || k === next ? '' : 'none';
      b.textContent = on ? String(k) : '';
      b.classList.toggle('sel', on && I.selGroup === String(k));
    }
  }
  // the resource bar: the help items of the top bar (H_ui "Topmenu": _tb_unitlimit, _tb_skulls, _tb_food ...) and the
  // numbers (the remake's bar shows no maximum)
  resTip(k) {
    const p = this.G.me;
    const key = { units: '_tb_unitlimit', skulls: '_tb_skulls' }[k] || '_tb_' + k;
    const n = k === 'units' ? `${p.units} / ${p.maxUnits}` : k === 'skulls' ? fmt(p.res.skulls) : `${fmt(p.res[k])} / ${p.caps[k]}`;
    const inc = k !== 'units' && k !== 'skulls' && p.incomePerMin(this.G.world.time)[k];
    return ttHtml({ ...helpTip(this.G, key), lines: [[n + (inc ? `  (+${inc} / min)` : '')]] });
  }

  // ------------------------------------------------------------------ bottom: info, commands (left), minimap (right)
  // (IngameScreen.usl: the info window at the bottom left, the minimap window in the bottom right corner and the
  // tooltip window above it)
  buildBottom() {
    this.bl = el('div', 'corner bl', this.root);
    this.br = el('div', 'corner br', this.root);
    const mm = el('div', 'minimap', this.br);
    this.tipWin = new TipWindow(this.br, this.root);
    this.tip = this.tipWin.box;
    const frame = el('div', 'mmframe', mm);
    frame.style.backgroundImage = img('hud_minimap_background.png');
    this.mmWin = mm;
    this.mmCanvas = el('canvas', 'mmc', mm);              // the 230 px control at (30, 32) (ui/minimap.js)
    this.mmCanvas.addEventListener('mousedown', (e) => this.G.input.minimapDown(e, this.mmCanvas));
    this.mmCanvas.addEventListener('mousemove', (e) => this.G.input.minimapMove(e, this.mmCanvas));
    this.mmCanvas.addEventListener('mouseup', (e) => this.G.input.minimapUp(e, this.mmCanvas));
    this.mmCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    const info = el('div', 'info', this.bl);
    info.style.backgroundImage = img('hud_infowin_bg_open.png');
    this.info = info;
    this.infoBody = el('div', 'ibody', info);

    const cmd = el('div', 'cmdbar', this.bl);
    this.cmd = cmd;
  }

  // ------------------------------------------------------------------ pyramid
  buildPyramid() {
    this.pyrWrap = el('div', 'pyrwrap', this.root);
    const p = el('div', 'pyramid', this.pyrWrap);
    p.style.backgroundImage = img('hud_pyramid_open.png');
    this.pyr = p;
    // a box dragged over the pyramid selects the cards in it (NewPyramid.usl sMLDown / sMMove / sMLUp: pressed beside
    // the cards - a card itself is dragged to another level -, without Shift the selection is cleared first)
    p.addEventListener('mousedown', (ev) => { if (ev.button === 0 && ev.target === p) this.pyrBoxStart(ev); });
    this.pyrCards = [];
    this.pyrHead = el('div', 'pyrhead', this.pyrWrap, '');
    // the epoch bar (IngameScreen.usl m_pxSmall, UpdatePyramidButton): four layers of hud_pyrabutton_all.png
    const bar = this.epBar = el('div', 'epbar', this.pyrWrap);
    this.epLayers = ['avail', 'nextage', 'noavail', 'ovl'].map((k) => el('i', 'ep-' + k, bar));
    // the strip opens / closes the pyramid: left click OnPyramidOpen, right click OnPyramidClose - both toggle
    // (IngameScreen.usl:936-952)
    bar.onmousedown = (ev) => { if (ev.button === 0 || ev.button === 2) { ev.preventDefault(); this.togglePyramid(); } };
    bar.oncontextmenu = (ev) => ev.preventDefault();
    bar.onmouseenter = () => { this.epHover = true; this.epKey = null; this.refreshEpochBar(); };
    bar.onmouseleave = () => { this.epHover = false; this.epKey = null; this.refreshEpochBar(); };
  }
  // the pyramid open (its cards, pyramid_open) or closed (the 11 px strip pyramid_closed, no cards): Tab, the strip
  // (CInGameScreen.TogglePyramidState, NewPyramid.usl SmallView / CollapsedView; starts open)
  togglePyramid(open) {
    const want = open === undefined ? !!this.pyrClosed : !!open;
    if (want === !this.pyrClosed) return;
    this.pyrClosed = !want;
    this.pyr.classList.toggle('closed', this.pyrClosed);
    this.pyr.style.backgroundImage = img(this.pyrClosed ? 'hud_pyramid_closed.png' : 'hud_pyramid_open.png');
    if (this.pyrHead) this.pyrHead.style.visibility = this.pyrClosed ? 'hidden' : '';
    if (this.G.feedback) this.G.feedback.ui(this.pyrClosed ? 'ui_pyramid_close' : 'ui_pyramid_open');
  }
  // UpdatePyramidButton (every second): the bar's rows are the pyramid's levels; from the top down to the current
  // epoch's line (BLEND: % of the height, by epoch) it is dark, below it lit. The next epoch, when the player can start
  // it, shows orange between the two lines; while it is being researched the lit part grows up into the orange.
  // (The original asks only the resources: its requirement path "/Actions/<tribe>/Upgrades/BLDG/..." does not exist,
  // so the requirements always pass, and the SEAS have no path at all. Here the age action's own check decides.)
  refreshEpochBar() {
    const G = this.G, p = G.me, D = G.data;
    if (!p || !this.epBar) return;
    const BLEND = [0, 65, 44, 26, 15, 0];
    const age = p.epoch();
    let next = false, prog = 0, res = false;
    if (age < 5) {
      const id = 'age_' + (age + 1);
      for (const b of G.world.buildings) if (b.alive && b.owner === p && b.queue) for (const q of b.queue) if (q.action && q.action.id === id) { next = true; res = true; prog = Math.max(prog, Math.min(1, q.t / q.total)); }
      if (!next) {
        const a = D.actions(p).find((x) => x.kind === 'Upgrades' && x.id === id);
        if (a && !D.check(p, a)) { next = true; res = p.canAfford(a.cost); }
      }
    }
    let blend = BLEND[age], noAvail = BLEND[age];
    if (next && res) blend = BLEND[age + 1];
    if (prog > 0 && age < 5) noAvail -= Math.round((BLEND[age] - BLEND[age + 1]) * prog);
    const v = this.epHover ? '_hover' : '';
    const key = `${blend}|${noAvail}|${v}`;
    if (key === this.epKey) return;
    this.epKey = key;
    const H = 545, [avail, nextage, noavail, ovl] = this.epLayers;
    const layer = (e, name, pct) => { e.style.cssText = (spriteCss(name, 16, 32, H) || '') + `height:${Math.round(H * pct / 100)}px;`; };
    layer(avail, 'pyramid_bg_avail' + v, 100);
    layer(nextage, 'pyramid_bg_nextage' + v, noAvail);
    layer(noavail, 'pyramid_bg_noavail' + v, blend);
    layer(ovl, 'pyramid_ovl_levelupable', 100);
  }

  // ------------------------------------------------------------------ per-frame update
  update(dt) {
    const G = this.G, p = G.me, W = G.world;
    // resources
    const inc = G.settings.showIncome ? p.incomePerMin(W.time) : null;
    const set = (k, v, extra) => {
      const e = this.resEls[k];
      const b = e.firstChild, i = e.lastChild;
      if (b.textContent !== v) b.textContent = v;
      const ex = extra || '';
      if (i.textContent !== ex) i.textContent = ex;
      e.classList.toggle('full', k !== 'units' && k !== 'skulls' && p.res[k] >= p.caps[k]);
    };
    set('units', `${p.units}/${p.maxUnits}`);
    set('skulls', fmt(p.res.skulls));
    for (const r of ['food', 'wood', 'stone']) set(r, fmt(p.res[r]), inc ? `+${inc[r]}` : '');
    const ep = p.epoch();
    const et = `Epoch ${['', 'I', 'II', 'III', 'IV', 'V'][ep]}` + (W.cheats ? '  ·  Debug options' : p.debug ? '  ·  Debug mode (free, instant)' : '');
    if (this.epochEl.textContent !== et) this.epochEl.textContent = et;
    this.hoverT -= dt;
    if (this.hoverT <= 0) { this.hoverT = 0.25; this.refreshInfo(); this.refreshPyramid(); this.refreshCommands(); this.epT = (this.epT || 0) - 0.25; if (this.epT <= 0) { this.epT = 1; this.refreshEpochBar(); } this.refreshGroups(); this.refreshTimers(); }
    if (!this.perfEl.classList.contains('hidden')) {
      const s = G.renderer.stats;
      // the frame's work on the processor (main.js G.prof): the whole, the simulation, the draw calls' submission, the
      // two slowest other steps
      const P = G.prof || {}, ms = (v) => (v || 0).toFixed(1);
      const top = Object.entries(P).filter(([k]) => !['frame', 'simulation', 'render'].includes(k)).sort((a, b) => b[1] - a[1]).slice(0, 2);
      this.perfEl.textContent = `${s.fps} fps  ·  frame ${ms(P.frame)} ms: simulation ${ms(P.simulation)}, drawing ${ms(P.render)}, ${top.map(([k, v]) => `${k} ${ms(v)}`).join(', ')}  ·  ${s.calls || 0} draw calls  ·  ${((s.tris || 0) / 1000).toFixed(0)}k tris  ·  units ${W.units.length}` +
        // frame spikes (main.js noteHitch): how many, and the last one
        (G.hitches && G.hitches.length ? `\nspikes ${G.hitches.length} · last ${G.hitches[G.hitches.length - 1].ms} ms: ${G.hitches[G.hitches.length - 1].steps.join(', ')}${G.hitches[G.hitches.length - 1].gpu.length ? ' · ' + G.hitches[G.hitches.length - 1].gpu.join(', ') : ''}` : '');
    }
  }

  // ------------------------------------------------------------------ info window
  refreshInfo() {
    const G = this.G, sel = [...G.sel].filter((e) => e.alive);
    // the buffs of the object the info window speaks for: the only one, or the first of the highest level of a group
    // (Info.usl:1338-1360)
    let lead = sel.length === 1 ? sel[0] : null;
    if (sel.length > 1) for (const e of sel) if (e.kind === 'unit' && (!lead || (e.level || 0) > (lead.level || 0))) lead = e;
    const buffs = lead && (lead.kind === 'unit' || lead.kind === 'building') ? visibleBuffs(G.world, lead, G.me) : [];
    const key = buffs.map((x) => x.attrib).join(',') + '/' + sel.map((e) => e.id + ':' + Math.round(e.hp || e.amount || (e.well ? e.well.fill : 0)) + ':' + (e.workers ? e.workers.size : '') + ':' + (e.level || 0) + ':' + (e.queue ? e.queue.map((q) => q.action.id + Math.floor(q.t)).join(',') : '') + ':' + (e.progress || 0).toFixed(2) + (e.carry ? e.carry.amount : '')).join('|');
    if (key === this.infoKey) return;
    this.infoKey = key;
    const b = this.infoBody;
    if (!sel.length) { b.innerHTML = ''; return; }
    if (sel.length > 1) {
      let h = '<div class="grp">';
      for (const e of sel.slice(0, 24)) {
        const ic = iconFor(e.name);
        const css = ic ? spriteCss(ic, 1, 31, 30) : '';
        const f = e.hp / e.maxHp;
        h += `<div class="gi" data-id="${e.id}"><div style="${css}"></div><i style="width:${Math.round(f * 100)}%;background:${f > 0.6 ? '#7c3' : f > 0.3 ? '#dc3' : '#d42'}"></i></div>`;
      }
      h += `</div><div class="gcount">${sel.length} selected</div>`;
      if (buffs.length) h += '<div class="buffs">' + buffs.slice(0, 5).map((x) => `<span data-tt="${x.tip}" style="${spriteCss(x.icon, -1, 16, 16) || ''}"></span>`).join('') + '</div>';
      b.innerHTML = h;
      b.querySelectorAll('.buffs [data-tt]').forEach((d) => { d.onmouseenter = () => this.showTip(d, buttonTip(G, d.dataset.tt)); d.onmouseleave = () => this.hideTip(); });
      b.querySelectorAll('.gi').forEach((d) => { d.onclick = (ev) => { const e = sel.find((x) => x.id === +d.dataset.id); if (e) { if (ev.shiftKey) G.deselect(e); else G.select([e]); } }; });
      return;
    }
    const e = sel[0];
    if (e.kind === 'item') {
      // an item (Info.usl ITEM): its help item - the name and what it does
      const t = G.data.text(e.name);
      b.innerHTML = `<div class="por" style="${spriteCss(e.name, 4, 64, 61) || ''}"></div><div class="nm">${t.name}</div><div class="hint">${t.medium || ''}</div>`;
      return;
    }
    if (e.kind === 'well') {
      // a healing well (Info.usl FNTN): its help title (_laerad_well, _healing_well_01) and what it holds as hit points
      const t = G.data.textKey(/laerad/.test(e.name) ? '_laerad_well' : '_healing_well_01') || {};
      const W = e.well, f = W.max ? W.fill / W.max : 0;
      b.innerHTML = `<div class="nm wide">${t.name || 'Healing well'}</div>` +
        `<div class="hp"><i style="width:${Math.round(f * 100)}%"></i><span>${Math.round(W.fill)} / ${Math.round(W.max)}</span></div>`;
      return;
    }
    if (e.kind === 'res') {
      // Info.usl:1404-1436: the resources' help titles (_wood, _stone, _fruit, _food, _fish), the amount _iw_resourceamount
      const key = e.type === 'bush' ? '_fruit' : e.type === 'fish' ? '_fish' : '_' + e.res;
      const label = (G.data.textKey(key) || {}).name || e.res;
      b.innerHTML = `<div class="nm wide">${label}</div><div class="carry big"><span style="${spriteCss(RES_ICON[e.res], undefined, 20, 20)}"></span>${Math.ceil(e.amount)}</div>` +
        `<div class="hint">${e.workers.size} worker${e.workers.size === 1 ? '' : 's'} gathering</div>`;
      const am = b.querySelector('.carry');
      am.onmouseenter = () => this.showTip(am, buttonTip(G, '_iw_resourceamount')); am.onmouseleave = () => this.hideTip();
      return;
    }
    const t = G.data.text(e.name, e.owner);
    const ic = iconFor(e.name);
    const f = Math.max(0, e.hp / e.maxHp);
    const lvl = e.level && e.kind === 'unit' ? `Level ${e.level}` : e.kind === 'building' ? 'Building' : '';
    const rel = e.owner && e.owner !== G.me ? G.me.relation(e.owner) : 2;
    const owner = e.owner ? (e.owner === G.me ? '' : ` · ${G.campaign ? e.owner.name + ' (' : ''}${rel === 2 ? 'ally' : rel === 1 ? 'neutral' : 'enemy'}${G.campaign ? ')' : ''}`) : (e.kind === 'unit' && e.wild ? ' · wild' : '');
    let h = `<div class="por" style="${ic ? spriteCss(ic, 4, 64, 61) : ''}"></div>
      <div class="nm">${t.name}</div><div class="lv">${lvl}${owner}</div>
      <div class="hp"><i style="width:${Math.round(f * 100)}%"></i><span>${Math.ceil(e.hp)} / ${Math.round(e.maxHp)}</span></div>`;
    const w = e.weapons && (e.weapons.long || e.weapons.short);
    const st = [];
    if (w) {
      // values after the tribe's upgrades (Damage / Defence / RangedDefence / Range modifiers)
      const cs = e.cs(w) || { dmg: w.dmg, prot: w.def, rprot: w.rdef, range: w.range };
      const icn = w.projectile ? (w.splash ? 'info_rangeattack_area' : 'info_rangeattack') : (w.splash ? 'info_attack_area' : 'info_attack');
      // the attack's help item: _iw_attack / _iw_rangeattack with _pierce, _poison, _area (Info.usl:563-613)
      const att = (w.projectile ? '_iw_rangeattack' : '_iw_attack') + (w.ap ? '_pierce' : '') + (w.poison ? '_poison' : '') + (w.splash ? '_area' : '');
      st.push([icn, `${Math.round(cs.dmg)}${w.splash ? ` (splash ${w.splash} m)` : ''}${w.poison ? ` +poison ${w.poison}×${w.poisonTicks}` : ''}`, att]);
      if (w.projectile) st.push(['info_range', `${w.minrange ? w.minrange + '–' : ''}${Math.round(cs.range)} m`, '_iw_range']);
      st.push(['info_armor', `${Math.round(cs.prot || 0)}`, '_iw_defense_melee'], ['info_shield', `${Math.round(cs.rprot || 0)}`, '_iw_defense_arrow']);
    }
    if (e.passengers && e.passengers.length) st.push(['resicon_unit', `${e.passengers.length} inside`]);
    if (e.def && e.def.gate && e.built) st.push(['info_armor', ['open', 'closed', 'automatic'][e.gateState] + (e.gateOpen ? ' (open)' : '')]);
    if (e.warpT != null) st.push(['info_skulls', `victory in ${Math.max(0, Math.ceil(e.warpT))} s`]);
    if (e.stats && e.stats.scalps && e.owner !== G.me) st.push(['info_skulls', `${e.stats.scalps}`, '_iw_skulls']);
    // [icon, value, help key, icon, value, help key]
    const stat = (ic, v, tt) => `<span${tt ? ` data-tt="${tt}"` : ''}><span style="${spriteCss(ic, undefined, 16, 16)}"></span>${v}</span>`;
    // what it carries: a row too
    if (e.carry && e.carry.amount > 0) st.push([RES_ICON[e.carry.res === 'food' ? 'food' : e.carry.res], `${e.carry.amount}`]);
    // Info.usl CInfo: one value per row of the window's frame, ATTR_BASE 117, 34, ATTR_OFFSET 17 (six rows)
    h += '<div class="st">' + st.slice(0, 6).map((s) => `<div title="${String(s[1]).replace(/"/g, '')}">${stat(s[0], s[1], s[2])}</div>`).join('') + '</div>';
    // its buffs (Info.usl CBuffIcon: five 16 x 16 icons at 31 + 17 i, 121 - the frame's circles - with the buff's help as tooltip)
    if (buffs.length) h += '<div class="buffs">' + buffs.slice(0, 5).map((x) => `<span data-tt="${x.tip}" style="${spriteCss(x.icon, -1, 16, 16) || ''}"></span>`).join('') + '</div>';
    // the item it carries (Info.usl: the item slot, with the item's help as its tooltip)
    if (e.item) h += `<div class="islot" data-tt="${e.item.name}" style="${spriteCss(e.item.name, 2, 20, 20) || ''}"></div>`;
    if (e.kind === 'building' && !e.built) h += `<div class="prog"><i style="width:${Math.round(e.progress * 100)}%"></i><span>Under construction ${Math.round(e.progress * 100)}%</span></div>`;
    if (e.kind === 'res') h += `<div class="carry">${e.amount} ${e.res}</div>`;
    if (e.queue && e.queue.length && e.owner === G.me) {
      h += '<div class="queue">';
      e.queue.forEach((q, i) => {
        const qi = (q.action.loc && q.action.loc.icon) || (q.buildDown ? 'actbtn_sym_recycle' : q.action.id);
        const k = Math.min(1, q.t / q.total);
        h += `<div class="qi" data-i="${i}" style="${spriteCss(qi, 1, 31, 30) || ''}"><i style="height:${Math.round((1 - k) * 100)}%"></i></div>`;
      });
      h += '</div>';
    }
    b.innerHTML = h;
    // the portrait's tooltip: what the unit does at each level (heroes), its strengths
    const por = b.querySelector('.por');
    if (por) { por.onmouseenter = () => this.showTip(por, objectTip(G, e.name, e.owner)); por.onmouseleave = () => this.hideTip(); }
    // the hit points and the attributes: the info window's own help items (Info.usl: _iw_hitpoints, _iw_attack ...)
    const hpb = b.querySelector('.hp');
    if (hpb) { hpb.onmouseenter = () => this.showTip(hpb, buttonTip(G, '_iw_hitpoints')); hpb.onmouseleave = () => this.hideTip(); }
    b.querySelectorAll('.st [data-tt]').forEach((d) => { d.onmouseenter = () => this.showTip(d, buttonTip(G, d.dataset.tt)); d.onmouseleave = () => this.hideTip(); });
    b.querySelectorAll('.buffs [data-tt]').forEach((d) => { d.onmouseenter = () => this.showTip(d, buttonTip(G, d.dataset.tt)); d.onmouseleave = () => this.hideTip(); });
    const is = b.querySelector('.islot');
    if (is) { is.onmouseenter = () => this.showTip(is, objectTip(G, is.dataset.tt)); is.onmouseleave = () => this.hideTip(); }
    b.querySelectorAll('.qi').forEach((d) => { d.onclick = () => G.world.cancelQueue(e, +d.dataset.i); });
  }

  // ------------------------------------------------------------------ command bar
  refreshCommands() {
    const G = this.G;
    const sel = [...G.sel].filter((e) => e.alive && e.owner === G.me);
    const key = sel.map((e) => e.id).join(',') + '|' + G.me.epoch() + '|' + (this.menu || '') + '|' + sel.map((e) => e.built ? 1 : 0).join('');
    if (key === this.cmdKey) { this.refreshFlyout(); return; }
    this.cmdKey = key;
    const c = this.cmd;
    c.innerHTML = '';
    if (!sel.length) { this.closeFlyout(); return; }
    const workers = sel.filter((e) => e.kind === 'unit' && e.isWorker && e.canBuild);     // (harvesting vehicles build nothing)
    const units = sel.filter((e) => e.kind === 'unit');
    const producer = sel.length === 1 && G.producerActions(sel[0]).some((a) => a.kind !== 'Moves') ? sel[0] : null;
    // a new selection opens its main menu: Build for workers, Produce for a building (or unit) that produces.
    // Closing it keeps it closed until the selection changes. Options: "Open the build menu on selection".
    const sig = sel.map((e) => e.id).join(',');
    if (sig !== this.selSig) {
      this.selSig = sig;
      if (G.settings.autoMenu !== false) {
        if (workers.length && workers.length === units.length && units.length === sel.length) this.menu = 'build';
        else if (producer) this.menu = 'produce';
        else this.menu = null;
      }
    }
    const menus = [];
    // (the tooltips: CommandBar.usl's cb_* help items)
    // Build for anything that can build (CommandBar.usl AvailableMenuButtons: can_build - the workers, Taslow, the
    // Dustriders' fighters); Produce only without it
    const builds = units.some((e) => e.canBuild);
    if (builds) menus.push(['build', 'menubtn_sym_build', 'cb_build']);
    if (producer && !builds) menus.push(['produce', 'menubtn_sym_produce', 'cb_produce']);
    if (G.moveActions(sel).length) menus.push(['special', 'menubtn_sym_special', 'cb_specials']);
    if (units.length) menus.push(['stances', 'menubtn_sym_stances', 'cb_set_stance']);
    // transporters and bunkers: who is inside (CommandBar.usl FLAG_HOLD_UNITS -> the "slots" menu)
    if (sel.some((e) => e.owner === G.me && G.world.capacity(e) > 0)) menus.push(['slots', 'menubtn_sym_slots', 'cb_unload']);
    for (const [id, sym, tt] of menus) {
      const b = el('div', 'menub' + (this.menu === id ? ' on' : ''), c);
      b.style.cssText += spriteCss(this.menu === id ? 'menubtn_back_down' : 'menubtn_back_idle', undefined, 53, 59);
      const s = el('div', 'sym', b); s.style.cssText = spriteCss(sym, undefined, 53, 59);
      b.onclick = () => this.toggleMenu(id);
      b.onmouseenter = () => this.showTip(b, buttonTip(G, tt));
      b.onmouseleave = () => this.hideTip();
    }
    if (menus.length) { const sp = el('div', 'spacer', c); sp.style.cssText = spriteCss('menubtn_back_leftspacer', undefined, 7, 59); }
    const acts = [];
    if (units.length) {
      acts.push(['actbtn_sym_walkto', 'cb_walk', () => G.input.setMode('move')]);
      acts.push(['actbtn_sym_attack', 'cb_attack', () => G.input.setMode('attack')]);
      acts.push(['actbtn_sym_agrwalk', 'cb_agressive_walk', () => G.input.setMode('amove')]);
      acts.push(['actbtn_sym_stop', 'cb_stop', () => G.order(units, { type: 'stop' })]);
      if (units.some((u) => u.passengers && u.passengers.length)) acts.push(['actbtn_sym_disemb', 'cb_dismount_all', () => G.order(units, { type: 'unload' })]);
      if (units.some((u) => u.canBuild)) acts.push(['actbtn_sym_repair', 'cb_repair', () => G.input.setMode('repair')]);
      if (units.some((u) => u.inside)) acts.push(['actbtn_sym_disemb', 'cb_dismount_all', () => G.order(units, { type: 'unload' })]);
      if (units.length === 1 && units[0].level < 5) {
        // CommandBar.usl:1031-1057: "No Level-Up possible" when it isn't, and the skulls it costs
        const u = units[0];
        const cost = G.data.levelupSkulls[u.level - 1];
        acts.push(['actbtn_sym_levelup', () => buttonTip(G, 'cb_level_up', {
          lines: G.world.canHaveLevel(u, u.level + 1) ? [] : [[G.data.ui('_ObjCommandBar_NoLevelUp')]],
          cost: { skulls: cost }, short: { skulls: G.me.res.skulls < cost } }), () => G.levelUp(u)]);
      }
    }
    if (!units.length && sel.some((e) => G.world.isMovingHarbour(e) && e.built)) acts.push(['actbtn_sym_walkto', 'cb_walk', () => G.input.setMode('move')]);
    if (!units.length && sel.some((e) => G.world.canAimTower(e))) acts.push(['actbtn_sym_attack', 'cb_attack', () => G.input.setMode('attack')]);
    if (sel.some((e) => G.canRally(e))) acts.push(['actbtn_sym_rallye', 'cb_set_rallypoint', () => G.input.setMode('rally')]);
    const bunker = sel.find((e) => e.kind === 'building' && e.passengers && e.passengers.length);
    if (bunker) acts.push(['actbtn_sym_disemb', 'cb_dismount_all', () => G.world.unloadAll(bunker, false)]);
    acts.push(['actbtn_sym_kill', 'cb_kill', () => G.killSelected()]);
    for (const [sym, tt, fn] of acts) {
      const b = el('div', 'actb', c);
      b.dataset.act = sym;
      b.style.cssText += spriteCss('actbtn_back_idle', undefined, 45, 59);
      const s = el('div', 'sym', b); s.style.cssText = spriteCss(sym, undefined, 45, 59);
      b.onclick = fn;
      b.onmouseenter = () => { b.style.cssText = b.style.cssText.replace('actbtn_back_idle', 'x'); this.showTip(b, typeof tt === 'function' ? tt() : buttonTip(G, tt)); };
      b.onmouseleave = () => this.hideTip();
    }
    const end = el('div', 'actb', c); end.style.cssText = spriteCss('actbtn_back_endpiece', undefined, 45, 59);
    if (this.menu && !menus.some((m) => m[0] === this.menu)) this.menu = null;
    if (this.menu) this.openFlyout(); else this.closeFlyout();
  }
  toggleMenu(id) {
    this.menu = this.menu === id ? null : id;
    this.cmdKey = null;
    this.refreshCommands();
  }
  closeFlyout() { this.flyout.classList.add('hidden'); this.flyKey = null; }
  openFlyout() { this.flyout.classList.remove('hidden'); this.flyKey = null; this.refreshFlyout(); }
  refreshFlyout() {
    if (!this.menu) return;
    const G = this.G;
    const sel = [...G.sel].filter((e) => e.alive && e.owner === G.me);
    if (this.menu === 'slots') { this.slotsFlyout(sel); return; }
    const groups = this.menuRows(sel);
    this.rows = groups;
    const cr = this.cmd.getBoundingClientRect();
    this.flyout.style.left = Math.round(cr.left) + 'px';
    this.flyout.style.bottom = Math.round(window.innerHeight - cr.top + 4) + 'px';
    const p = G.me;
    const why = (a) => (a.kind === 'Moves' ? G.moveState(sel, a) : G.world.canQueue(p, a, sel[0] || {}));
    const key = this.menu + '|' + (this.armed ? this.armed.row : '') + '|' + groups.map((g) => g[1].map((a) => a.id + ':' + (a.stance !== undefined ? '' : (why(a) || '') + (G.queueCount(sel[0], a)))).join(',')).join('/') + '|' + sel.map((u) => u.stance).join(',');
    if (key === this.flyKey) return;
    this.flyKey = key;
    const f = this.flyout;
    f.innerHTML = '';
    f.style.backgroundImage = img('hud_flyoutwin_centercenter.png');
    groups.forEach(([title, acts], ri) => {
      const armed = this.armed && this.armed.row === groups.length - 1 - ri;      // (rows count from the bottom)
      const row = el('div', 'frow' + (armed ? ' armed' : ''), f);
      el('div', 'ftitle', row, title);
      acts.forEach((a, ci) => {
        const card = el('div', 'card', row);
        const digit = () => { if (armed && ci < 10) el('div', 'hk', card, String((ci + 1) % 10)); };    // the digit that presses it
        if (a.stance !== undefined) {
          card.style.cssText = spriteCss(a.icon, undefined, 44, 49);
          card.classList.toggle('on', sel.every((u) => u.stance === a.stance));
          card.onclick = () => { for (const u of sel) u.stance = a.stance; this.flyKey = null; };
          card.onmouseenter = () => this.showTip(card, buttonTip(G, '_stance_' + a.stance));
          card.onmouseleave = () => this.hideTip();
          digit();
          return;
        }
        const icon = a.loc.icon || a.id;
        const FALLBACK = { Open: 'actbtn_sym_gtopen', Close: 'actbtn_sym_gtclose', Auto: 'actbtn_sym_gtauto', Kill: 'actbtn_sym_kill', BuildDown: 'actbtn_sym_recycle', buy_food: 'resicon_food', buy_wood: 'resicon_wood', buy_stone: 'resicon_stone' };
        // an epoch: the tribe's epoch card (hu_age_2 ...; the SEAS have none: their headquarters of that epoch)
        const age = /^age_(\d)$/.exec(a.id), tr = String(G.me.tribe || '').toLowerCase();
        const ageCard = age ? (entry(`${tr}_age_${age[1]}`) ? `${tr}_age_${age[1]}` : `${tr}_headquarters_${age[1]}`) : null;
        const css = spriteCss(icon, 3, 44, 43) || spriteCss(iconFor(a.results[0] && a.results[0].obj), 3, 44, 43) || (ageCard && spriteCss(ageCard, 3, 44, 43)) || (FALLBACK[a.id] ? spriteCss(FALLBACK[a.id], undefined, 44, 49) : '');
        card.innerHTML = `<div class="ci" style="${css || ''}"></div>`;
        // a unit's card: the level (tier) it comes out at, the original's card level badge (menucmd_lvl<n>_ovl: the
        // pyramid's level marks - the user asked for it)
        const made = a.kind === 'Build' && a.results[0] && a.results[0].obj, ix = made && G.data.info(made);
        if (ix && ix.type !== 'BLDG' && G.world.unitStartLevel) {
          const lv = Math.max(1, Math.min(5, G.world.unitStartLevel(a, G.me) || 1)), ov = spriteCss('menucmd_lvl' + lv + '_ovl', 2, 44, 43);
          if (ov) { const b = el('div', 'lvo', card); b.style.cssText = ov; }
        }
        const w = why(a);
        if (w === 'req' || w === 'done' || w === 'level' && a.kind === 'Moves') card.classList.add('locked');
        else if (w) card.classList.add('dim');
        if (w === 'cooldown') { const cd = el('div', 'cd', card); cd.textContent = Math.ceil(G.moveCooldown(sel, a)); }
        const n = G.queueCount(sel[0], a);
        if (n) el('div', 'qn', card, String(n));
        card.onclick = (ev) => { G.useAction(a, sel, ev); this.flyKey = null; };
        card.oncontextmenu = (ev) => { ev.preventDefault(); G.unqueue(sel[0], a); this.flyKey = null; };
        card.onmouseenter = () => this.showTip(card, actionTip(G, a, why(a), sel));
        card.onmouseleave = () => this.hideTip();
        digit();
      });
    });
  }
  // the rows of a menu, top to bottom: [title, actions] (CommandBar.usl SetCategory; Flyout.usl sorts a row by the
  // actions' uiposition menupos - a fixed place; -1: the first free places, -2: at the end)
  menuRows(sel) {
    const G = this.G, rows = [];
    const byPos = (acts) => acts.map((a, i) => [a, (a.loc && a.loc.ui) || {}, i]).sort(([, p, i], [, q, j]) => slot(p, i) - slot(q, j) || i - j).map(([a]) => a);
    const slot = (u, i) => { const m = parseInt(u.menupos, 10); return m >= 0 ? m : m === -2 ? 1e6 + i : 1e3 + i; };
    if (this.menu === 'build') {
      const acts = G.buildActions();
      // MIRAGE puts more in the build menu: subcat UNIT (the SEAS carrier, the launch pads, the floating harbour, the
      // final boss) - a row of its own, like any other subcat the remake doesn't know
      const BROWS = [['ECON', 'Economy'], ['COMB', 'Military'], ['DEFE', 'Defence'], ['UNIT', 'Special']];
      for (const [k, t] of BROWS) rows.push([t, byPos(acts.filter((a) => (a.loc.ui || {}).subcat === k))]);
      const brest = acts.filter((a) => !BROWS.some(([k]) => k === (a.loc.ui || {}).subcat));
      if (brest.length) rows.push(['More', byPos(brest)]);
    } else if (this.menu === 'produce') {
      // Dustriders: UMGR (the farms' modes), UPGR, UNIT; the others: UPGR, UNIT
      const acts = G.producerActions(sel[0]);
      const sub = (a) => (a.loc.ui || {}).subcat || (a.kind === 'Build' ? 'UNIT' : 'UPGR');
      // MIRAGE adds rows: ENTY (taverns: the heroes are split over UNIT and ENTY; the SEAS garage's dinosaurs, the Norse
      // animal farm's), EXTE / RESE (laboratory, weapons builder), CONV (the brachiosaurus' and catapult rex's
      // conversions); a subcat the remake doesn't know yet still gets a row rather than disappearing
      const ROWS = [['UMGR', 'Modes'], ['UPGR', 'Upgrades'], ['EXTE', 'Extensions'], ['RESE', 'Research'], ['CONV', 'Conversions'], ['UNIT', 'Units'], ['ENTY', 'Units']];
      const known = ROWS.map(([k]) => k);
      for (const [k, t] of ROWS) rows.push([t, byPos(acts.filter((a) => sub(a) === k))]);
      const rest = acts.filter((a) => !known.includes(sub(a)));
      if (rest.length) rows.push(['More', byPos(rest)]);
    } else if (this.menu === 'special') {
      // SPEC rows by subcat: "UNIT" (the heroes' moves), none (the units' moves), then any other (the Dustriders'
      // BuildDown ...); the building commands (gates, markets) above them
      const acts = G.moveActions(sel);
      const spec = acts.filter((a) => (a.loc.ui || {}).cat === 'SPEC' && G.world.MOVES[a.id]);
      rows.push(['Commands', byPos(acts.filter((a) => !spec.includes(a)))]);
      const subs = ['UNIT', ''];
      for (const a of spec) { const k = (a.loc.ui || {}).subcat || ''; if (!subs.includes(k)) subs.push(k); }
      for (const k of subs) rows.push([k === 'UNIT' ? 'Hero moves' : 'Special moves', byPos(spec.filter((a) => ((a.loc.ui || {}).subcat || '') === k))]);
    } else if (this.menu === 'stances') {
      // AggroState_0..2 (FightingObj.m_iAggressionState), in their menu places 0 / 1 / 2
      rows.push(['Stance', [0, 1, 2].map((n) => ({ stance: n, icon: 'menubtn_sym_stance_' + n }))]);
    }
    return rows.filter((g) => g[1].length);
  }
  // keyboard (Keys.srf CmdBar_Accel_*): a letter opens a menu and arms one of its rows - counted from the bottom
  // (Flyout.usl: category = rows - row - 1); then 1 .. 9, 0 press the row's buttons. Returns false if there is no such row.
  armRow(menu, row) {
    if (!this.G.sel.size) return false;
    if (this.menu !== menu) { this.menu = menu; this.cmdKey = null; this.refreshCommands(); }
    if (this.menu !== menu) return false;                  // (the selection has no such menu)
    const rows = this.rows || [];
    this.flyKey = null;
    if (row >= rows.length) { this.armed = null; this.refreshFlyout(); return false; }
    this.armed = { menu, row };
    this.refreshFlyout();
    return true;
  }
  disarm() { if (!this.armed) return; this.armed = null; this.flyKey = null; this.refreshFlyout(); }
  pressArmed(n) {
    const A = this.armed;
    this.armed = null; this.flyKey = null;
    const rows = this.rows || [];
    const r = A && rows[rows.length - 1 - A.row];
    const a = r && r[1][n];
    if (a) {
      const sel = [...this.G.sel].filter((e) => e.alive && e.owner === this.G.me);
      if (a.stance !== undefined) for (const u of sel) u.stance = a.stance; else this.G.useAction(a, sel, {});
    }
    this.refreshFlyout();
    return !!a;
  }
  // the passengers' menu (CommandBar.usl InitMenuCommands "SLOT"): a row per transporter, a card per passenger (a
  // click lets that one out) and the empty places up to its capacity
  slotsFlyout(sel) {
    const G = this.G, W = G.world;
    const ts = sel.filter((e) => W.capacity(e) > 0).slice(0, 4);
    const key = 'slots|' + ts.map((t) => t.id + ':' + (t.passengers || []).map((p) => p.id + '.' + p.level).join(',')).join('/');
    const cr = this.cmd.getBoundingClientRect();
    this.flyout.style.left = Math.round(cr.left) + 'px';
    this.flyout.style.bottom = Math.round(window.innerHeight - cr.top + 4) + 'px';
    if (key === this.flyKey) return;
    this.flyKey = key;
    const f = this.flyout;
    f.innerHTML = '';
    f.style.backgroundImage = img('hud_flyoutwin_centercenter.png');
    for (const t of ts) {
      const row = el('div', 'frow', f);
      el('div', 'ftitle', row, G.data.text(t.name).name || t.name);
      const pax = (t.passengers || []).filter((p) => p.alive);
      for (const p of pax) {
        const card = el('div', 'card', row);
        card.innerHTML = `<div class="ci" style="${spriteCss(iconFor(p.name), 3, 44, 43) || ''}"></div>`;
        el('div', 'qn', card, String(p.level || 1));
        card.onclick = () => { this.hideTip(); W.unloadOne(t, p); this.flyKey = null; this.refreshFlyout(); };
        // CommandBar.usl:1162-1171: the passenger's name and "Level: N"
        card.onmouseenter = () => this.showTip(card, ttHtml({ title: G.data.text(p.name).name, cls: G.data.text(p.name).cls, body: G.data.ui('_UI_CommandBar_Level', 'Level: %1').replace('%1', p.level || 1) }));
        card.onmouseleave = () => this.hideTip();
      }
      for (let i = pax.length; i < W.capacity(t); i++) {
        const card = el('div', 'card empty', row);
        card.style.cssText = spriteCss('slot_background', undefined, 44, 49);
      }
    }
  }
  // ------------------------------------------------------------------ pyramid cards
  // what a unit is doing, shown as a layer on its card like the original (FightingObj.SetTaskDescription ->
  // PyramidCard.usl "card_task_<desc>"): food / wood / stone while gathering, buildup, repair, fight, transport
  // (inside a transporter), and after 2 s without a task "idle" (zzz) for workers, carts and fishing boats, else "wait"
  taskIcon(u) {
    const G = this.G, t = u.task;
    if (u.kind !== 'unit') return null;
    if (u.inside) return 'transport';
    const idle = !t || t.type === 'idle' || t.type === 'hold';
    if (!idle) { u._idleSince = null; }
    if (idle) {
      if (u._idleSince == null) u._idleSince = G.world.time;
      if (G.world.time - u._idleSince < 2) return null;
      return /_worker|_cart|_fishing_boat|^aje_trade_dino$/.test(u.name) ? 'idle' : 'wait';
    }
    // (the sequel's workers at a power plant: their own icon, the power symbol - the original has none for it)
    if (t.type === 'gather' && (t.res === 'power' || t.farmKind === 'power')) return 'power';
    if (t.type === 'gather' || t.type === 'fish' || t.type === 'trade') return t.res === 'wood' || t.res === 'stone' ? t.res : 'food';
    if (t.type === 'build') return 'buildup';
    if (t.type === 'repair') return 'repair';
    if (t.type === 'attack' || (t.type === 'attackmove' && t.target)) return 'fight';
    return null;
  }
  refreshPyramid() {
    const G = this.G, p = G.me;
    const byLevel = [[], [], [], [], []];
    for (const u of G.world.units) if (u.alive && u.owner === p && u.countsInPop) byLevel[u.level - 1].push(u);
    for (const b of G.world.buildings) if (b.alive && b.owner === p && b.countsInPop) byLevel[b.level - 1].push(b);     // the floating harbour
    const queued = [[], [], [], [], []];
    for (const e of [...G.world.buildings, ...G.world.units]) if (e.alive && e.owner === p && e.queue) for (const q of e.queue) if (q.level) queued[q.level - 1].push(q);
    // the places of each row: the pyramid's own, more beside it when a debug option allows more (game/cheats.js)
    const lim = G.world.pyramidFor ? G.world.pyramidFor(p) : PYR.map((r) => r.length);
    this.rowN = [0, 1, 2, 3, 4].map((lv) => Math.max(PYR[lv].length, lim[lv] || 0, byLevel[lv].length + queued[lv].length));
    const key = this.rowN.join(',') + '|' + byLevel.map((l) => l.map((u) => u.id + (G.sel.has(u) ? 's' : '') + Math.round(u.hp / u.maxHp * 20) + ':' + (this.taskIcon(u) || '')).join(',')).join('/') + '#' + queued.map((q) => q.length).join(',') + '#' + Math.floor(p.res.skulls);
    if (key === this.pyrKey) return;
    this.pyrKey = key;
    this.pyr.innerHTML = '';
    this.cardUnits = [[], [], [], [], []];
    for (let lv = 0; lv < 5; lv++) {
      const slots = this.slotRects(lv, this.rowN[lv]);
      if (slots.compact) {
        // the compact row covers the pyramid picture's own (big) frames of the row
        const own = PYR[lv], top = Math.min(...own.map((r) => r[1])), bottom = Math.max(...own.map((r) => r[1] + r[3]));
        const bg = el('div', 'pxrow', this.pyr);
        Object.assign(bg.style, { left: '4px', top: (top - 3) + 'px', width: '167px', height: (bottom - top + 6) + 'px' });
      }
      const list = byLevel[lv].sort((a, b) => a.name.localeCompare(b.name));
      slots.forEach((r, i) => {
        const u = list[i];
        this.cardUnits[lv][i] = u || null;
        const q = !u ? queued[lv][i - list.length] : null;
        if (!u && !q) {
          // a free place beside the pyramid (it has no picture of its own)
          if (i >= PYR[lv].length || slots.compact) { const x = el('div', 'pxslot', this.pyr); Object.assign(x.style, { left: r[0] + 'px', top: r[1] + 'px', width: r[2] + 'px', height: r[3] + 'px' }); }
          return;
        }
        const d = el('div', 'pcard' + (u && G.sel.has(u) ? ' sel' : '') + (q ? ' queued' : ''), this.pyr);
        d.style.left = r[0] + 'px'; d.style.top = r[1] + 'px';
        const name = u ? u.name : q.action.results[0].obj;
        const ic = iconFor(name);
        d.style.cssText += ic ? spriteCss(ic, ICON_LVL[lv], r[2], r[3]) : '';
        // hit points on every card, like the original's pyramid: green, yellow below half, red below a quarter
        if (u) { const r = Math.max(0, Math.min(1, u.hp / u.maxHp)), hb = el('i', 'php' + (r <= 0.25 ? ' low' : r <= 0.5 ? ' mid' : ''), el('i', 'phb', d)); hb.style.width = Math.round(r * 100) + '%'; }
        const task = u && this.taskIcon(u);
        if (task === 'power') {
          // in the corner where the original's task layers have their symbol (bottom right, about a third of the card)
          const ti = el('i', 'ptask pwicon', d), n = Math.round(r[2] * 0.34);
          ti.style.cssText = `left:auto;top:auto;right:1px;bottom:2px;width:${n}px;height:${n}px;filter:drop-shadow(0 0 1px #000)`;
        } else if (task) { const ti = el('i', 'ptask', d); const css = spriteCss('card_task_' + task, ICON_LVL[lv], r[2], r[3]); if (css) ti.style.cssText = css; else ti.remove(); }
        if (u) {
          const canUp = u.kind === 'unit' && lv < 4 && p.res.skulls >= G.data.levelupSkulls[lv] && G.world.canHaveLevel(u, lv + 2);
          if (canUp) el('b', 'pup', d);
          d._u = u;
          d.onmousedown = (ev) => { if (ev.button === 0 && u.kind === 'unit') this.cardDragStart(ev, u, d); };
          d.onclick = (ev) => { if (this.dragDone) { this.dragDone = false; return; } this.cardClick(u, ev); };
          // a double-click centres the camera on it; Alt: selects every unit of its class on its row
          d.ondblclick = (ev) => { if (ev.altKey) G.select(this.cardUnits[lv].filter((x) => x && x.alive && x.name === u.name)); else G.centerOn(u); };
          // right-click: one level up; Alt: the right-click's order on it for the selection (heal, board, follow ..)
          d.oncontextmenu = (ev) => { ev.preventDefault(); if (ev.altKey) G.input.orderOn(u, { x: u.pos.x, z: u.pos.z }, ev.shiftKey, ev.ctrlKey); else if (u.kind === 'unit') G.levelUp(u); };
          d.onmouseenter = () => this.showTip(d, objectTip(G, u.name, u.owner));         // (PyramidCard.usl: the object's help item)
          d.onmouseleave = () => this.hideTip();
        }
      });
    }
    const n = byLevel.reduce((a, l) => a + l.length, 0);
    this.pyrHead.textContent = `${n} / ${p.maxUnits}`;
  }

  // a click on a card (PyramidCard.usl OnClick): buildings leave the selection; Shift adds the unit, Ctrl adds or
  // removes it, a plain click selects it alone
  cardClick(u, ev) {
    const G = this.G;
    G.feedback.ui('ui_click_pyramid');
    for (const x of [...G.sel]) if (x.kind === 'building' && x.name !== 'aje_floating_harbour') G.sel.delete(x);
    if (ev.shiftKey) G.sel.add(u);
    else if (ev.ctrlKey || ev.metaKey) { if (G.sel.has(u)) G.sel.delete(u); else G.sel.add(u); }
    else { G.select([u]); return; }
    G.selChanged();
  }

  // ------------------------------------------------------------------ pyramid drag & drop (NewPyramid.usl)
  // Drop on a free place of a higher row: level up (the skull costs of every level passed); never down, no swaps
  // (production.js changeLevel).
  // the places of row lv for n units: the pyramid's own, then more to the right of the pyramid on the row's lines
  // (a debug option's bigger pyramid, game/cheats.js)
  // Rows 3-5 (big cards): first more places inside the row itself, as cards of the first row's size (27 px, the
  // pyramid's five columns, as many lines as the row's height takes: row 3 2 x 5, row 4 1 x 5, row 5 2 x 5); only
  // what does not fit there goes beside the pyramid. The compact row has no picture of its own: every free place of
  // it gets a frame (out.compact).
  slotRects(lv, n) {
    const own = PYR[lv];
    if (!(n > own.length)) return own;
    let base = own;
    if (lv >= 2) {
      const S = PYR[0][0][2], COLS = [8, 41, 74, 107, 140];
      const top = Math.min(...own.map((r) => r[1])), bottom = Math.max(...own.map((r) => r[1] + r[3])), H = bottom - top;
      const lines = Math.max(1, Math.floor((H - S) / (S + 3)) + 1);
      const pitch = lines > 1 ? Math.min(36, (H - S) / (lines - 1)) : 0, y0 = top + (H - S - (lines - 1) * pitch) / 2;
      if (lines * COLS.length > own.length) {
        base = [];
        for (let l = 0; l < lines; l++) for (const x of COLS) base.push([x, Math.round(y0 + l * pitch), S, S]);
        base.compact = true;
      }
    }
    const out = base.slice(0, Math.min(n, base.length));
    out.compact = !!base.compact;
    if (n <= base.length) return out;
    const ys = [...new Set(base.map((r) => r[1]))], w = base[0][2], h = base[0][3];
    for (let j = 0; j < n - base.length; j++) out.push([184 + Math.floor(j / ys.length) * (w + 5), ys[j % ys.length], w, h]);
    return out;
  }
  pyramidSlotAt(cx, cy) {
    const r = this.pyr.getBoundingClientRect();
    const k = r.width / 177;
    const x = (cx - r.left) / k, y = (cy - r.top) / k;
    for (let lv = 0; lv < 5; lv++) {
      const i = this.slotRects(lv, (this.rowN || [])[lv] || 0).findIndex((s) => x >= s[0] - 3 && x <= s[0] + s[2] + 3 && y >= s[1] - 3 && y <= s[1] + s[3] + 3);
      if (i >= 0) return { lv, i };
    }
    return null;
  }
  pyrBoxStart(ev) {
    const G = this.G, p = this.pyr;
    ev.preventDefault();
    if (!ev.shiftKey) { G.sel.clear(); G.selChanged(true); }
    const W = this.pyrWrap, box = el('div', 'pyrbox', W);           // (in the wrap: the pyramid's cards are redrawn)
    const r0 = W.getBoundingClientRect(), k = r0.width / W.offsetWidth || 1;     // (the pyramid is scaled)
    const x0 = ev.clientX, y0 = ev.clientY;
    let rect = { l: x0, t: y0, r: x0 + 1, b: y0 + 1 };
    const draw = () => Object.assign(box.style, { left: (rect.l - r0.left) / k + 'px', top: (rect.t - r0.top) / k + 'px', width: (rect.r - rect.l) / k + 'px', height: (rect.b - rect.t) / k + 'px' });
    draw();
    const move = (e) => { rect = { l: Math.min(x0, e.clientX), r: Math.max(x0, e.clientX), t: Math.min(y0, e.clientY), b: Math.max(y0, e.clientY) }; draw(); };
    const up = (e) => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up, true);
      box.remove();
      const hit = [];
      for (const d of p.querySelectorAll('.pcard')) {
        const c = d.getBoundingClientRect();
        if (d._u && d._u.alive && c.left < rect.r && c.right > rect.l && c.top < rect.b && c.bottom > rect.t) hit.push(d._u);
      }
      if (!hit.length) return;
      for (const u of hit) G.sel.add(u);
      G.selChanged();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, true);
  }
  cardDragStart(ev, u, card) {
    const G = this.G;
    const sx = ev.clientX, sy = ev.clientY;
    let ghost = null, target = null;
    const move = (e) => {
      if (!ghost && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
      if (!ghost) {
        ghost = card.cloneNode(true);
        ghost.classList.add('dragghost');
        const r = card.getBoundingClientRect();
        ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
        document.body.appendChild(ghost);
        this.hideTip();
      }
      ghost.style.left = e.clientX - 14 + 'px'; ghost.style.top = e.clientY - 14 + 'px';
      target = this.pyramidSlotAt(e.clientX, e.clientY);
      let tip = '';
      // (up only, onto a free slot: NewPyramid.usl SwapSlotsAndCards)
      if (target && target.lv + 1 !== u.level) {
        const other = this.cardUnits[target.lv] && this.cardUnits[target.lv][target.i];
        const cost = target.lv + 1 > u.level ? G.world.skullCost(u.level, target.lv + 1) : 0;
        const ok = target.lv + 1 > u.level && !other && G.me.res.skulls >= cost;
        tip = target.lv + 1 < u.level ? REASON_DOWN : other ? 'That slot is taken' : `Level up to ${target.lv + 1}${cost ? ` · ${cost} skulls` : ''}`;
        ghost.classList.toggle('bad', !ok);
      } else ghost.classList.remove('bad');
      ghost.title = tip;
      ghost.dataset.tip = tip;
    };
    const up = (e) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up, true);
      if (!ghost) return;
      ghost.remove();
      this.dragDone = true;
      setTimeout(() => { this.dragDone = false; }, 0);
      target = this.pyramidSlotAt(e.clientX, e.clientY);
      if (!target || target.lv + 1 === u.level) return;
      const other = this.cardUnits[target.lv] && this.cardUnits[target.lv][target.i];
      if (other && other !== u) { if (target.lv + 1 > u.level) { G.hud.message('That slot is taken: drop the card on a free slot', 'bad'); G.feedback.error(); } else if (target.lv + 1 < u.level) G.changeLevel(u, target.lv + 1); return; }
      G.changeLevel(u, target.lv + 1);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, true);   // capture: the HUD root stops mouseup from bubbling
  }

  // ------------------------------------------------------------------ tooltips + messages
  keyTip(key) { return buttonTip(this.G, key); }
  actionTipHtml(a, why, sel) { return actionTip(this.G, a, why, sel); }     // (tests)
  // the original shows every tooltip in the one window above the minimap - where the remake's objectives and the
  // sequel's command powers are covered by it; so by default a tooltip goes next to what the mouse is over (anchor: an
  // element or a screen point; Options: "Tooltips next to what the mouse is over" off = the original window)
  showTip(anchor, html) {
    // a card of the army pyramid: right of the whole pyramid (not over its other cards), at the card's height
    if (anchor && anchor.getBoundingClientRect && this.pyrWrap.contains(anchor)) {
      const card = anchor, pyr = this.pyr;
      anchor = { getBoundingClientRect: () => { const c = card.getBoundingClientRect(), p = pyr.getBoundingClientRect(); return { left: p.left, right: p.right, top: c.top, bottom: c.bottom, width: p.width, height: c.height }; } };
    }
    this.tipWin.show(html, this.G.settings.tipNear !== false ? anchor : null, this.s || 1);
  }
  hideTip() { this.tipWin.hide(); }
  message(text, kind = '') {
    if (this.G.chat) this.G.chat.log(text, kind);                // (the chat button's history)
    const m = el('div', 'msg ' + kind, this.msgs, text);
    while (this.msgs.children.length > 4) this.msgs.firstChild.remove();
    setTimeout(() => m.classList.add('fade'), 3500);
    setTimeout(() => m.remove(), 4500);
  }
}
