import { UIA, spriteCss, entry, iconFor } from './atlas.js';

// ParaWorld HUD rebuilt from the original textures: resource bar, minimap, info window, command bar, army pyramid.
const PYR = (() => {
  const L5 = [[58, 14, 60, 57]], L4 = [[8, 89, 46, 45], [65, 89, 46, 45], [122, 89, 46, 45]], L3 = [], L2 = [], L1 = [];
  for (const y of [152, 195]) for (const x of [8, 50, 92, 134]) L3.push([x, y, 34, 34]);
  for (const y of [246, 282, 318]) for (const x of [8, 41, 74, 107, 140]) L2.push([x, y, 27, 27]);
  for (const y of [362, 398, 435, 471, 507]) for (const x of [8, 41, 74, 107, 140]) L1.push([x, y, 27, 27]);
  return [L1, L2, L3, L4, L5];
})();
const ICON_LVL = [2, 2, 2, 3, 4];   // atlas level index per pyramid row (bigger cards higher up)
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

export class HUD {
  constructor(G) {
    this.G = G;
    this.root = el('div', 'hud', document.body);
    this.root.id = 'hud';
    this.buildTop();
    this.buildBottom();
    this.buildPyramid();
    this.tip = el('div', 'tip hidden', document.body);
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
    for (const e of [this.tl, this.tr, this.bl, this.flyout]) e.style.transform = `scale(${s})`;
    const ps = Math.min(s, (window.innerHeight - 70 * s - 150) / 560);
    this.pyrWrap.style.transform = `scale(${ps})`;
  }

  // ------------------------------------------------------------------ top: resources + menu
  buildTop() {
    this.tl = el('div', 'corner tl', this.root);
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
    this.epochEl = el('div', 'epoch', this.tl, '');
    this.tr = el('div', 'corner tr', this.root);
    const mk = (tex, label, fn) => {
      const b = el('div', 'mbtn', this.tr);
      b.style.backgroundImage = img(tex);
      b.innerHTML = `<span>${label}</span>`;
      b.onclick = fn;
      return b;
    };
    mk('hud_menu_menubutton.png', 'Menu', () => this.G.openMenu());
    this.perfEl = el('div', 'perf hidden', this.root);
  }
  resTip(k) {
    const p = this.G.me;
    if (k === 'units') return `<h4>Army</h4>Units: ${p.units} of ${p.maxUnits} (population limit)<br>Queued: ${p.queuedUnits}<br><small>Build headquarters, barracks and garages to raise the limit (max 52).</small>`;
    if (k === 'skulls') return `<h4>Skulls</h4>${fmt(p.res.skulls)}<br><small>Earned by killing enemies and wild animals. Spend them in the army pyramid to level up units (25 / 50 / 100 / 300).</small>`;
    const inc = p.incomePerMin(this.G.world.time)[k];
    return `<h4>${k[0].toUpperCase() + k.slice(1)}</h4>${fmt(p.res[k])} of ${p.caps[k]} (storage)<br>Income: ${inc} per minute`;
  }

  // ------------------------------------------------------------------ bottom: minimap, info, commands
  buildBottom() {
    this.bl = el('div', 'corner bl', this.root);
    const mm = el('div', 'minimap', this.bl);
    const frame = el('div', 'mmframe', mm);
    frame.style.backgroundImage = img('hud_minimap_background.png');
    this.mmCanvas = el('canvas', 'mmc', mm);
    this.mmCanvas.width = this.mmCanvas.height = 216;
    this.mmCanvas.addEventListener('mousedown', (e) => this.G.input.minimapDown(e, this.mmCanvas));
    this.mmCanvas.addEventListener('mousemove', (e) => this.G.input.minimapMove(e, this.mmCanvas));
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
    this.pyrCards = [];
    this.pyrHead = el('div', 'pyrhead', this.pyrWrap, '');
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
    const et = `Epoch ${['', 'I', 'II', 'III', 'IV', 'V'][ep]}` + (p.debug ? '  ·  Debug mode (free, instant)' : '');
    if (this.epochEl.textContent !== et) this.epochEl.textContent = et;
    this.hoverT -= dt;
    if (this.hoverT <= 0) { this.hoverT = 0.25; this.refreshInfo(); this.refreshPyramid(); this.refreshCommands(); }
    if (!this.perfEl.classList.contains('hidden')) {
      const s = G.renderer.stats;
      this.perfEl.textContent = `${s.fps} fps  ·  cpu ${(s.cpu || 0).toFixed(1)} ms  ·  ${s.calls || 0} draw calls  ·  ${((s.tris || 0) / 1000).toFixed(0)}k tris  ·  units ${W.units.length}`;
    }
  }

  // ------------------------------------------------------------------ info window
  refreshInfo() {
    const G = this.G, sel = [...G.sel].filter((e) => e.alive);
    const key = sel.map((e) => e.id + ':' + Math.round(e.hp || e.amount || 0) + ':' + (e.workers ? e.workers.size : '') + ':' + (e.level || 0) + ':' + (e.queue ? e.queue.map((q) => q.action.id + Math.floor(q.t)).join(',') : '') + ':' + (e.progress || 0).toFixed(2) + (e.carry ? e.carry.amount : '')).join('|');
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
      b.innerHTML = h;
      b.querySelectorAll('.gi').forEach((d) => { d.onclick = (ev) => { const e = sel.find((x) => x.id === +d.dataset.id); if (e) { if (ev.shiftKey) G.deselect(e); else G.select([e]); } }; });
      return;
    }
    const e = sel[0];
    if (e.kind === 'res') {
      const label = { tree: 'Tree', timber: 'Felled tree', stone: 'Stone deposit', bush: 'Fruit bush', corpse: 'Carcass' }[e.type] || 'Resource';
      b.innerHTML = `<div class="nm wide">${label}</div><div class="carry big"><span style="${spriteCss(RES_ICON[e.res], undefined, 20, 20)}"></span>${Math.ceil(e.amount)} ${e.res}</div>` +
        `<div class="hint">${e.workers.size} worker${e.workers.size === 1 ? '' : 's'} gathering</div>`;
      return;
    }
    const t = G.data.text(e.name);
    const ic = iconFor(e.name);
    const f = Math.max(0, e.hp / e.maxHp);
    const lvl = e.level && e.kind === 'unit' ? `Level ${e.level}` : e.kind === 'building' ? 'Building' : '';
    const owner = e.owner ? (e.owner === G.me ? '' : ' · enemy') : (e.kind === 'unit' ? ' · wild' : '');
    let h = `<div class="por" style="${ic ? spriteCss(ic, 4, 64, 61) : ''}"></div>
      <div class="nm">${t.name}</div><div class="lv">${lvl}${owner}</div>
      <div class="hp"><i style="width:${Math.round(f * 100)}%"></i><span>${Math.ceil(e.hp)} / ${Math.round(e.maxHp)}</span></div>`;
    const w = e.weapons && (e.weapons.long || e.weapons.short);
    const st = [];
    if (w) {
      // values after the tribe's upgrades (Damage / Defence / RangedDefence / Range modifiers)
      const cs = e.cs(w) || { dmg: w.dmg, prot: w.def, rprot: w.rdef, range: w.range };
      const icn = w.projectile ? (w.splash ? 'info_rangeattack_area' : 'info_rangeattack') : (w.splash ? 'info_attack_area' : 'info_attack');
      st.push([icn, `${Math.round(cs.dmg)}${w.splash ? ` (splash ${w.splash} m)` : ''}${w.poison ? ` +poison ${w.poison}×${w.poisonTicks}` : ''}`]);
      if (w.projectile) st.push(['info_range', `${w.minrange ? w.minrange + '–' : ''}${Math.round(cs.range)} m`]);
      st.push(['info_armor', `${Math.round(cs.prot || 0)}`, 'info_shield', `${Math.round(cs.rprot || 0)}`]);
    }
    if (e.passengers && e.passengers.length) st.push(['resicon_unit', `${e.passengers.length} inside`]);
    if (e.def && e.def.gate && e.built) st.push(['info_armor', ['open', 'closed', 'automatic'][e.gateState] + (e.gateOpen ? ' (open)' : '')]);
    if (e.warpT != null) st.push(['info_skulls', `victory in ${Math.max(0, Math.ceil(e.warpT))} s`]);
    if (e.dismantling) st.push(['info_armor', `dismantling ${Math.round(e.dismantling.t / e.dismantling.total * 100)}%`]);
    if (e.stats && e.stats.scalps && e.owner !== G.me) st.push(['info_skulls', `${e.stats.scalps}`]);
    h += '<div class="st">' + st.map((s) => `<div><span style="${spriteCss(s[0], undefined, 16, 16)}"></span>${s[1]}${s[2] ? `&nbsp;&nbsp;<span style="${spriteCss(s[2], undefined, 16, 16)}"></span>${s[3]}` : ''}</div>`).join('') + '</div>';
    if (e.carry && e.carry.amount > 0) h += `<div class="carry"><span style="${spriteCss(RES_ICON[e.carry.res === 'food' ? 'food' : e.carry.res], undefined, 16, 16)}"></span>${e.carry.amount}</div>`;
    if (e.kind === 'building' && !e.built) h += `<div class="prog"><i style="width:${Math.round(e.progress * 100)}%"></i><span>Under construction ${Math.round(e.progress * 100)}%</span></div>`;
    if (e.kind === 'res') h += `<div class="carry">${e.amount} ${e.res}</div>`;
    if (e.queue && e.queue.length && e.owner === G.me) {
      h += '<div class="queue">';
      e.queue.forEach((q, i) => {
        const qi = q.action.loc.icon || q.action.id;
        const k = Math.min(1, q.t / q.total);
        h += `<div class="qi" data-i="${i}" style="${spriteCss(qi, 1, 31, 30) || ''}"><i style="height:${Math.round((1 - k) * 100)}%"></i></div>`;
      });
      h += '</div>';
    }
    b.innerHTML = h;
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
    const workers = sel.filter((e) => e.kind === 'unit' && e.isWorker);
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
    if (workers.length) menus.push(['build', 'menubtn_sym_build', 'Build (B)']);
    if (producer) menus.push(['produce', 'menubtn_sym_produce', 'Produce']);
    if (G.moveActions(sel).length) menus.push(['special', 'menubtn_sym_special', 'Special moves and commands']);
    if (units.length) menus.push(['stances', 'menubtn_sym_stances', 'Stance']);
    for (const [id, sym, label] of menus) {
      const b = el('div', 'menub' + (this.menu === id ? ' on' : ''), c);
      b.style.cssText += spriteCss(this.menu === id ? 'menubtn_back_down' : 'menubtn_back_idle', undefined, 53, 59);
      const s = el('div', 'sym', b); s.style.cssText = spriteCss(sym, undefined, 53, 59);
      b.onclick = () => this.toggleMenu(id);
      b.onmouseenter = () => this.showTip(b, `<h4>${label}</h4>`);
      b.onmouseleave = () => this.hideTip();
    }
    if (menus.length) { const sp = el('div', 'spacer', c); sp.style.cssText = spriteCss('menubtn_back_leftspacer', undefined, 7, 59); }
    const acts = [];
    if (units.length) {
      acts.push(['actbtn_sym_walkto', 'Move', 'M', () => G.input.setMode('move')]);
      acts.push(['actbtn_sym_attack', 'Attack', '', () => G.input.setMode('attack')]);
      acts.push(['actbtn_sym_agrwalk', 'Attack-move (A)', 'A', () => G.input.setMode('amove')]);
      acts.push(['actbtn_sym_stop', 'Stop (S)', 'S', () => G.order(units, { type: 'stop' })]);
      if (units.some((u) => u.passengers && u.passengers.length)) acts.push(['actbtn_sym_disemb', 'Unload passengers', '', () => G.order(units, { type: 'unload' })]);
      if (workers.length) acts.push(['actbtn_sym_repair', 'Repair a building', '', () => G.input.setMode('repair')]);
      if (units.some((u) => u.inside)) acts.push(['actbtn_sym_disemb', 'Leave', '', () => G.order(units, { type: 'unload' })]);
      if (units.length === 1 && units[0].level < 5) {
        const u = units[0];
        const cost = G.data.levelupSkulls[u.level - 1];
        acts.push(['actbtn_sym_levelup', `Level up to ${u.level + 1}: ${cost} skulls`, 'U', () => G.levelUp(u)]);
      }
    }
    if (!units.length && sel.some((e) => G.world.isMovingHarbour(e) && e.built)) acts.push(['actbtn_sym_walkto', 'Sail (right-click on the water; Shift+right-click sets the rally point)', 'M', () => G.input.setMode('move')]);
    if (!units.length && sel.some((e) => G.world.canAimTower(e))) acts.push(['actbtn_sym_attack', 'Attack (towers shoot at the chosen enemy)', '', () => G.input.setMode('attack')]);
    if (sel.some((e) => G.canRally(e))) acts.push(['actbtn_sym_rallye', 'Set rally point', 'R', () => G.input.setMode('rally')]);
    const bunker = sel.find((e) => e.kind === 'building' && e.passengers && e.passengers.length);
    if (bunker) acts.push(['actbtn_sym_disemb', 'Let everybody out', '', () => G.world.unloadAll(bunker, false)]);
    acts.push(['actbtn_sym_kill', 'Destroy (Del)', 'Del', () => G.killSelected()]);
    for (const [sym, label, key, fn] of acts) {
      const b = el('div', 'actb', c);
      b.style.cssText += spriteCss('actbtn_back_idle', undefined, 45, 59);
      const s = el('div', 'sym', b); s.style.cssText = spriteCss(sym, undefined, 45, 59);
      b.onclick = fn;
      b.onmouseenter = () => { b.style.cssText = b.style.cssText.replace('actbtn_back_idle', 'x'); this.showTip(b, `<h4>${label}</h4>`); };
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
    let groups = [];
    if (this.menu === 'build') {
      const acts = G.buildActions();
      const rows = { ECON: 'Economy', COMB: 'Military', DEFE: 'Defence' };
      for (const k in rows) groups.push([rows[k], acts.filter((a) => (a.loc.ui || {}).subcat === k)]);
    } else if (this.menu === 'produce') {
      const acts = G.producerActions(sel[0]);
      groups.push(['Units', acts.filter((a) => a.kind === 'Build')]);
      groups.push(['Upgrades', acts.filter((a) => a.kind === 'Upgrades')]);
    } else if (this.menu === 'special') {
      const acts = G.moveActions(sel);
      groups.push(['Special moves', acts.filter((a) => G.world.MOVES[a.id])]);
      groups.push(['Commands', acts.filter((a) => !G.world.MOVES[a.id])]);
    } else if (this.menu === 'stances') {
      // AggroState_0..2 (FightingObj.m_iAggressionState)
      groups.push(['Stance', [{ stance: 2, icon: 'menubtn_sym_stance_2', label: 'Aggressive: attack every enemy in sight' },
        { stance: 1, icon: 'menubtn_sym_stance_1', label: 'Defensive: fight back when attacked' },
        { stance: 0, icon: 'menubtn_sym_stance_0', label: 'Hold ground: only fight what is in range, never chase' }]]);
    }
    groups = groups.filter((g) => g[1].length);
    const cr = this.cmd.getBoundingClientRect();
    this.flyout.style.left = Math.round(cr.left) + 'px';
    this.flyout.style.bottom = Math.round(window.innerHeight - cr.top + 4) + 'px';
    const p = G.me;
    const why = (a) => (a.kind === 'Moves' ? G.moveState(sel, a) : G.world.canQueue(p, a, sel[0] || {}));
    const key = this.menu + '|' + groups.map((g) => g[1].map((a) => a.id + ':' + (a.stance !== undefined ? '' : (why(a) || '') + (G.queueCount(sel[0], a)))).join(',')).join('/') + '|' + sel.map((u) => u.stance).join(',');
    if (key === this.flyKey) return;
    this.flyKey = key;
    const f = this.flyout;
    f.innerHTML = '';
    f.style.backgroundImage = img('hud_flyoutwin_centercenter.png');
    for (const [title, acts] of groups) {
      const row = el('div', 'frow', f);
      el('div', 'ftitle', row, title);
      for (const a of acts) {
        const card = el('div', 'card', row);
        if (a.stance !== undefined) {
          card.style.cssText = spriteCss(a.icon, undefined, 44, 49);
          card.classList.toggle('on', sel.every((u) => u.stance === a.stance));
          card.onclick = () => { for (const u of sel) u.stance = a.stance; this.flyKey = null; };
          card.onmouseenter = () => this.showTip(card, `<h4>${a.label}</h4>`);
          card.onmouseleave = () => this.hideTip();
          continue;
        }
        const icon = a.loc.icon || a.id;
        const FALLBACK = { Open: 'actbtn_sym_gtopen', Close: 'actbtn_sym_gtclose', Auto: 'actbtn_sym_gtauto', Kill: 'actbtn_sym_kill', BuildDown: 'actbtn_sym_recycle', buy_food: 'resicon_food', buy_wood: 'resicon_wood', buy_stone: 'resicon_stone' };
        const css = spriteCss(icon, 3, 44, 43) || spriteCss(iconFor(a.results[0] && a.results[0].obj), 3, 44, 43) || (FALLBACK[a.id] ? spriteCss(FALLBACK[a.id], undefined, 44, 49) : '');
        card.innerHTML = `<div class="ci" style="${css || ''}"></div>`;
        const w = why(a);
        if (w === 'req' || w === 'done' || w === 'level' && a.kind === 'Moves') card.classList.add('locked');
        else if (w) card.classList.add('dim');
        if (w === 'cooldown') { const cd = el('div', 'cd', card); cd.textContent = Math.ceil(G.moveCooldown(sel, a)); }
        const n = G.queueCount(sel[0], a);
        if (n) el('div', 'qn', card, String(n));
        card.onclick = (ev) => { G.useAction(a, sel, ev); this.flyKey = null; };
        card.oncontextmenu = (ev) => { ev.preventDefault(); G.unqueue(sel[0], a); this.flyKey = null; };
        card.onmouseenter = () => this.showTip(card, this.actionTip(a, why(a)));
        card.onmouseleave = () => this.hideTip();
      }
    }
  }
  actionTip(a, why) {
    const G = this.G;
    const obj = a.results[0] && a.results[0].obj;
    const t = G.data.text(a.kind === 'Upgrades' ? a.id : obj || a.id);
    let name = t.name;
    if (/^age_\d$/.test(a.id)) name = `Epoch ${['', 'I', 'II', 'III', 'IV', 'V'][+a.id.slice(4)]}`;
    const costs = ['food', 'wood', 'stone'].filter((r) => a.cost[r]).map((r) => `<span class="c ${G.me.res[r] < a.cost[r] ? 'bad' : ''}"><span style="${spriteCss(RES_ICON[r], undefined, 16, 16)}"></span>${a.cost[r]}</span>`).join(' ');
    const sk = a.cost.skulls ? ` <span class="c ${G.me.res.skulls < a.cost.skulls ? 'bad' : ''}"><span style="${spriteCss(RES_ICON.skulls, undefined, 16, 16)}"></span>${a.cost.skulls}</span>` : '';
    let h = `<h4>${name}</h4><div class="cost">${costs}${sk} <span class="c">${a.kind === 'Moves' ? (a.time ? '↻ ' + a.time + 's' : '') : '⏱ ' + a.time + 's'}</span></div>`;
    if (why === 'cooldown') h += '<div class="bad">Recharging</div>';
    if (why === 'level' && a.kind === 'Moves') h += `<div class="bad">Needs level ${a.levelReq}</div>`;
    if (why === 'unique') h += '<div class="bad">You already have this hero</div>';
    if (a.kind === 'Build' && a.cat !== 'Build/BLDG') h += `<div class="sub">Starts at level ${G.data.startLevel(a)}</div>`;
    if (t.medium) h += `<div class="med">${t.medium.replace(/\n+/g, '<br>')}</div>`;
    if (why === 'req') h += `<div class="bad">Requires ${a.req.map((r) => /^age_/.test(r) ? 'Epoch ' + ['', 'I', 'II', 'III', 'IV', 'V'][+r.slice(4)] : G.data.text(r).name).join(', ')}</div>`;
    if (why === 'level') h += '<div class="bad">No free slot at this level in the army pyramid</div>';
    if (why === 'housing') h += '<div class="bad">Population limit reached – build more housing</div>';
    if (why === 'done') h += '<div class="sub">Already researched</div>';
    if (t.long) h += `<div class="long">${t.long}</div>`;
    return h;
  }

  // ------------------------------------------------------------------ pyramid cards
  // what a unit is doing, shown as a layer on its card like the original (FightingObj.SetTaskDescription ->
  // PyramidCard.usl "card_task_<desc>"): food / wood / stone while gathering, buildup, repair, fight, transport
  // (inside a transporter), and after 2 s without a task "idle" (zzz) for workers, carts and fishing boats, else "wait"
  taskIcon(u) {
    const G = this.G, t = u.task;
    if (u.inside) return 'transport';
    const idle = !t || t.type === 'idle' || t.type === 'hold';
    if (!idle) { u._idleSince = null; }
    if (idle) {
      if (u._idleSince == null) u._idleSince = G.world.time;
      if (G.world.time - u._idleSince < 2) return null;
      return /_worker|_cart|_fishing_boat|^aje_trade_dino$/.test(u.name) ? 'idle' : 'wait';
    }
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
    const queued = [[], [], [], [], []];
    for (const e of [...G.world.buildings, ...G.world.units]) if (e.alive && e.owner === p && e.queue) for (const q of e.queue) if (q.level) queued[q.level - 1].push(q);
    const key = byLevel.map((l) => l.map((u) => u.id + (G.sel.has(u) ? 's' : '') + (u.hp < u.maxHp ? Math.round(u.hp / u.maxHp * 10) : '') + ':' + (this.taskIcon(u) || '')).join(',')).join('/') + '#' + queued.map((q) => q.length).join(',') + '#' + Math.floor(p.res.skulls);
    if (key === this.pyrKey) return;
    this.pyrKey = key;
    this.pyr.innerHTML = '';
    this.cardUnits = [[], [], [], [], []];
    for (let lv = 0; lv < 5; lv++) {
      const slots = PYR[lv];
      const list = byLevel[lv].sort((a, b) => a.name.localeCompare(b.name));
      slots.forEach((r, i) => {
        const u = list[i];
        this.cardUnits[lv][i] = u || null;
        const q = !u ? queued[lv][i - list.length] : null;
        if (!u && !q) return;
        const d = el('div', 'pcard' + (u && G.sel.has(u) ? ' sel' : '') + (q ? ' queued' : ''), this.pyr);
        d.style.left = r[0] + 'px'; d.style.top = r[1] + 'px';
        const name = u ? u.name : q.action.results[0].obj;
        const ic = iconFor(name);
        d.style.cssText += ic ? spriteCss(ic, ICON_LVL[lv], r[2], r[3]) : '';
        if (u && u.hp < u.maxHp) { const hb = el('i', 'php', d); hb.style.width = Math.round(u.hp / u.maxHp * 100) + '%'; }
        const task = u && this.taskIcon(u);
        if (task) { const ti = el('i', 'ptask', d); const css = spriteCss('card_task_' + task, ICON_LVL[lv], r[2], r[3]); if (css) ti.style.cssText = css; else ti.remove(); }
        if (u) {
          const canUp = lv < 4 && p.res.skulls >= G.data.levelupSkulls[lv] && G.world.canHaveLevel(u, lv + 2);
          if (canUp) el('b', 'pup', d);
          d.onmousedown = (ev) => { if (ev.button === 0) this.cardDragStart(ev, u, d); };
          d.onclick = (ev) => { if (this.dragDone) { this.dragDone = false; return; } if (ev.shiftKey) G.toggleSelect(u); else G.select([u]); };
          d.ondblclick = () => G.centerOn(u);
          d.oncontextmenu = (ev) => { ev.preventDefault(); G.levelUp(u); };
          d.onmouseenter = () => this.showTip(d, `<h4>${G.data.text(u.name).name}</h4>Level ${u.level} · ${Math.ceil(u.hp)}/${Math.round(u.maxHp)} HP` + (lv < 4 ? `<div class="sub">Drag the card to a higher row (or right-click) to level up: ${G.data.levelupSkulls[lv]} skulls per level</div>` : ''));
          d.onmouseleave = () => this.hideTip();
        }
      });
    }
    const n = byLevel.reduce((a, l) => a + l.length, 0);
    this.pyrHead.textContent = `${n} / ${p.maxUnits}`;
  }

  // ------------------------------------------------------------------ pyramid drag & drop (NewPyramid.usl)
  // Drop on an empty slot of another row: level up (sum of the skull costs of every level passed) or down (free).
  // Drop on another unit's card: the two units swap levels (the lower one pays for its rise).
  pyramidSlotAt(cx, cy) {
    const r = this.pyr.getBoundingClientRect();
    const k = r.width / 177;
    const x = (cx - r.left) / k, y = (cy - r.top) / k;
    for (let lv = 0; lv < 5; lv++) {
      const i = PYR[lv].findIndex((s) => x >= s[0] - 3 && x <= s[0] + s[2] + 3 && y >= s[1] - 3 && y <= s[1] + s[3] + 3);
      if (i >= 0) return { lv, i };
    }
    return null;
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
      if (target && target.lv + 1 !== u.level) {
        const other = this.cardUnits[target.lv] && this.cardUnits[target.lv][target.i];
        let cost = target.lv + 1 > u.level ? G.world.skullCost(u.level, target.lv + 1) : 0;
        if (other && target.lv + 1 < u.level) cost += G.world.skullCost(target.lv + 1, u.level);
        const ok = G.me.res.skulls >= cost;
        tip = `${target.lv + 1 > u.level ? 'Level up' : 'Level down'} to ${target.lv + 1}${other ? ' (swap)' : ''}${cost ? ` · ${cost} skulls` : ''}`;
        ghost.classList.toggle('bad', !ok);
      }
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
      G.changeLevel(u, target.lv + 1, other && other !== u ? other : null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, true);   // capture: the HUD root stops mouseup from bubbling
  }

  // ------------------------------------------------------------------ tooltips + messages
  showTip(anchor, html) {
    const t = this.tip;
    t.innerHTML = html;
    t.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const tw = t.offsetWidth, th = t.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2, y = r.top - th - 8;
    if (y < 4) y = r.bottom + 8;
    x = Math.max(4, Math.min(window.innerWidth - tw - 4, x));
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  hideTip() { this.tip.classList.add('hidden'); }
  message(text, kind = '') {
    const m = el('div', 'msg ' + kind, this.msgs, text);
    while (this.msgs.children.length > 4) this.msgs.firstChild.remove();
    setTimeout(() => m.classList.add('fade'), 3500);
    setTimeout(() => m.remove(), 4500);
  }
}
