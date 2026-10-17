// "My Army": buying the start army with the game's points (the original's PointBuyMenu: PyramidDialog on the left,
// ShoppingList on the right, the PresetWindow's presets; docs/spec/pointbuy.md). Opened from the skirmish setup
// (ui/skirmish.js) and from the campaign menu for missions with an army budget (ui/menu.js).
//
//   armyPage(menu, opt)   opt = { tribe, credits (the game's points), total (points incl. gifts), shown (the budget the
//                         gauge names), army,
//                         mp (multiplayer rules: presets, Clear, 30 food), buildings, allowed (Set of classes or null),
//                         limits ([max per level] or null), defaults () => army (the Default button), title,
//                         done (army), back () }
// The army (game/pointbuy.js) is changed in place; done() gets it.

import { PYR, ICON_LVL } from './hud.js';
import { spriteCss, iconFor } from './atlas.js';
import { PointBuy, RES, SLOT_LEVELS, slotLevel } from '../game/pointbuy.js';

const esc = (t) => String(t == null ? '' : t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const MENU = 'assets/ui/menu/menue__controls__';
// pointbuy_resources.tga: per resource a "-" and a "+" button (rows: idle, down, disabled - 37 px each)
const RES_BTN = [[0, 35], [35, 33], [68, 33], [101, 33], [134, 33], [167, 35]];
// the "buy at level n" arrows beside the pyramid (PD:96-124: y 431 / 281 / 177 / 99 / 25 for the levels 1..5)
const ARROW_Y = [431, 281, 177, 99, 25];
const OWN_KEY = 'pwr.pbPresets';

function ownPresets() { try { return JSON.parse(localStorage.getItem(OWN_KEY) || '[]'); } catch (e) { return []; } }
function saveOwn(list) { try { localStorage.setItem(OWN_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ } }

export function armyPage(menu, opt) {
  const G = menu.G, D = G.data, PB = new PointBuy(D, G.aiData), tribe = opt.tribe;
  let army = opt.army;
  const ui = (k, d) => D.ui(k, d);
  const blocked = (opt.limits || [null, null, null, null, null]).map((m, i) => (m == null ? 0 : Math.max(0, (SLOT_LEVELS[i][1] - SLOT_LEVELS[i][0] + 1) - m)));
  const shop = PB.shop(tribe, opt.allowed || null);
  let tab = 0, sel = shop[0] ? shop[0].cls : null;
  const resBtns = RES.map((r, i) => `<div class="pbr" data-r="${r}">
      <b class="m" data-b="${2 * i}" title="${esc(ui('_UI_AC_PointBuy_Resource_Buy_' + 2 * i))}"></b><b class="p" data-b="${2 * i + 1}" title="${esc(ui('_UI_AC_PointBuy_Resource_Buy_' + (2 * i + 1)))}"></b><span></span></div>`).join('');
  menu.open(opt.title || ui('_MyArmy', 'My Army'), `<div class="pbpage">
    <div class="pbleft">
      <div class="pbpyr"><div class="pyramid"></div>${ARROW_Y.map((y, i) => `<div class="pbarrow" data-lv="${i + 1}" style="top:${y}px" title="${esc(ui('_UI_AC_PointBuy_Arrow_' + i + '_TT'))}"><span></span></div>`).join('')}</div>
      <div class="pbres">${resBtns}</div>
      <div class="pbtools">${opt.mp ? `<button class="pwbtn small" data-a="clear" title="${esc(ui('_UI_AC_PointBuy_Clear'))}">${esc(ui('_PointBuyMenu_Clear', 'Clear'))}</button>` : ''}
        ${opt.defaults ? `<button class="pwbtn small" data-a="defaults" title="${esc(ui('_UI_AC_PointBuy_Default_TT'))}">${esc(ui('_UI_PBMenu_Button_Default', 'Default'))}</button>` : ''}</div>
    </div>
    <div class="pbright">
      <div class="pbgauge" title="${esc(ui('_UI_PresWind_PointGauge_TT'))}"><i></i><span></span></div>
      <div class="pbtabs">${['Infantry', 'Cavalry', 'Heroes'].map((t, i) => `<div data-t="${i}" title="${esc(ui('_UI_Tab_' + t + '_TT'))}">${esc(ui('_UI_ShopList_Tab_' + t, t))}</div>`).join('')}</div>
      <div class="pblist" title="${esc(ui('_UI_AC_PointBuy_ShoppingList_Buy'))}"></div>
      <div class="pbdesc"></div>
      ${opt.mp ? `<div class="pbpre"><span>${esc(ui('_UI_PresWind_Label_Preset', 'Preset'))}</span><select class="pwsel" id="pb_pre"></select>
        <input class="pwsel" id="pb_name" maxlength="24" title="${esc(ui('_UI_PresWind_Edit_Name_TT'))}">
        <button class="pwbtn small" data-a="save" title="${esc(ui('_UI_PresWind_Button_Save_TT'))}">${esc(ui('_UI_PresWind_Button_Save', 'Save'))}</button>
        <button class="pwbtn small" data-a="del" title="${esc(ui('_UI_PresWind_Button_Delete_TT'))}">${esc(ui('_UI_PresWind_Button_Delete', 'Delete'))}</button></div>` : ''}
    </div></div>
    <div class="btns row">${menu.btn('back', 'Back', 'small')}${menu.btn('done', 'Done', 'small')}</div>`, { title: true });
  const W = menu.win, $ = (q) => W.querySelector(q);
  W.classList.add('wide');
  const pyr = $('.pbpyr .pyramid');
  pyr.style.backgroundImage = 'url(assets/ui/hud_pyramid_open.png)';
  const left = () => PB.left(army, opt.total, tribe);

  // ------------------------------------------------------------ the pyramid: slot ids in the order of the HUD's cells
  const cell = (slot) => { const lv = slotLevel(slot); return PYR[lv - 1][slot - SLOT_LEVELS[lv - 1][0]]; };
  const slotAt = (cx, cy) => {
    const r = pyr.getBoundingClientRect(), k = r.width / 177, x = (cx - r.left) / k, y = (cy - r.top) / k;
    for (let lv = 1; lv <= 5; lv++) {
      const i = PYR[lv - 1].findIndex((s) => x >= s[0] - 3 && x <= s[0] + s[2] + 3 && y >= s[1] - 3 && y <= s[1] + s[3] + 3);
      if (i >= 0) return SLOT_LEVELS[lv - 1][0] + i;
    }
    return x >= -10 && x <= 187 && y >= -10 && y <= 555 ? -2 : -1;          // -2: inside the pyramid, no slot
  };
  function drawPyramid() {
    pyr.innerHTML = '';
    for (let lv = 1; lv <= 5; lv++) {
      const [a, b] = SLOT_LEVELS[lv - 1];
      for (let s = a; s <= b; s++) {
        const r = cell(s);
        if (s > b - blocked[lv - 1] && !(s in army.cards)) { const x = el('div', 'pcard pbblock'); place(x, r); pyr.appendChild(x); continue; }
        const name = army.cards[s];
        if (!name) continue;
        const d = el('div', 'pcard' + (army.fixed[s] ? ' fixed' : ''));
        place(d, r);
        const ic = iconFor(PB.resolve(name, tribe).cls) || iconFor(name);
        d.style.cssText += ic ? spriteCss(ic, ICON_LVL[lv - 1], r[2], r[3]) || '' : '';
        if (army.fixed[s]) { const f = el('i', 'pfix'); f.style.cssText = spriteCss('card_fixed', ICON_LVL[lv - 1], r[2], r[3]) || ''; d.appendChild(f); }
        const t = D.text(PB.resolve(name, tribe).cls);
        d.title = `${t.name} · ${PB.cardCost(name, s, tribe)}\n${ui(army.fixed[s] ? '_UI_AC_PointBuy_Card_Locked' : '_UI_AC_PointBuy_Card')}`;
        d.onmousedown = (ev) => { if (ev.button === 0) drag(ev, s, d); };
        d.oncontextmenu = (ev) => { ev.preventDefault(); if (PB.sell(army, s)) { menu.click(); refresh(); } };
        d.onmouseenter = () => describe(PB.resolve(name, tribe).cls);
        pyr.appendChild(d);
      }
    }
  }
  function place(d, r) { d.style.left = r[0] + 'px'; d.style.top = r[1] + 'px'; d.style.width = r[2] + 'px'; d.style.height = r[3] + 'px'; }
  function el(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }
  // drag a card: onto another slot = move (or swap), out of the pyramid = sell (PBM:143-162, NP:1828-1941)
  function drag(ev, from, card) {
    const sx = ev.clientX, sy = ev.clientY;
    let ghost = null;
    const move = (e) => {
      if (!ghost && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
      if (!ghost) {
        ghost = card.cloneNode(true); ghost.classList.add('dragghost');
        const r = card.getBoundingClientRect(); ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
        document.body.appendChild(ghost);
      }
      ghost.style.left = e.clientX - 14 + 'px'; ghost.style.top = e.clientY - 14 + 'px';
      const to = slotAt(e.clientX, e.clientY);
      ghost.classList.toggle('bad', to >= 0 ? !PB.canMove(army, from, to, opt.total, tribe) && to !== from : to === -1 && !!army.fixed[from]);
    };
    const up = (e) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up, true);
      if (!ghost) return;
      ghost.remove();
      const to = slotAt(e.clientX, e.clientY);
      if (to >= 0 && PB.canMove(army, from, to, opt.total, tribe)) PB.move(army, from, to);
      else if (to === -1) PB.sell(army, from);
      else return;
      menu.click();
      refresh();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up, true);
  }

  // ------------------------------------------------------------ arrows, resources, gauge
  function drawArrows() {
    const e = shop.find((x) => x.cls === sel);
    W.querySelectorAll('.pbarrow').forEach((a) => {
      const lv = +a.dataset.lv, price = e ? e.prices[lv - 1] || 0 : 0;
      const can = price > 0 && price <= left() && PB.freeSlot(army, lv, blocked[lv - 1]) >= 0 && !(PB.isHero(sel) && PB.hasHero(army, sel));
      a.classList.toggle('hidden', !price);
      a.classList.toggle('off', !can);
      a.querySelector('span').textContent = price || '';
      a.onclick = () => { if (can && PB.buy(army, sel, lv, opt.total, tribe, blocked) != null) { menu.click(); refresh(); } };
    });
  }
  function drawRes() {
    W.querySelectorAll('.pbr').forEach((g) => {
      const r = g.dataset.r, lock = !!(army.locked && army.locked[r]);
      g.querySelector('span').textContent = army.res[r] || 0;
      g.querySelectorAll('b').forEach((b) => {
        const id = +b.dataset.b, plus = id % 2 === 1, [x, w] = RES_BTN[id];
        const off = lock || (plus ? PB.resFor(r, left() + PB.resCost(r, army.res[r] || 0, tribe), tribe) <= (army.res[r] || 0) : (army.res[r] || 0) <= ((army.min && army.min[r]) || 0));
        b.classList.toggle('off', off);
        b.style.cssText = `width:${w}px;background:url(${MENU}pointbuy_resources.png) ${-x}px ${off ? -74 : 0}px`;
        b.onmousedown = (ev) => { if (!off) b.style.backgroundPositionY = '-37px'; ev.preventDefault(); };
        b.onclick = (ev) => {
          if (off) return;
          const step = (ev.shiftKey ? 10 : 1) * (ev.ctrlKey || ev.metaKey ? 100 : 1);
          PB.addRes(army, r, plus ? step : -step, opt.total, tribe);
          menu.click();
          refresh();
        };
      });
    });
  }
  function drawGauge() {
    const l = left(), shown = opt.shown != null ? opt.shown : opt.total;
    $('.pbgauge i').style.width = Math.max(0, Math.min(1, l / Math.max(1, opt.total))) * 100 + '%';
    $('.pbgauge span').textContent = ui('_PointBuyMenu_PointGauge', '%1 of %2 points').replace('%1', l).replace('%2', shown);
  }

  // ------------------------------------------------------------ the shop list
  function describe(cls) {
    const t = D.text(cls), e = shop.find((x) => x.cls === cls);
    $('.pbdesc').innerHTML = `<b>${esc(t.name)}</b>${e ? `<small>${e.prices.map((p, i) => (p ? `L${i + 1}: ${p}` : '')).filter(Boolean).join(' · ')}</small>` : ''}${esc(t.medium || '')}`;
  }
  function drawList() {
    W.querySelectorAll('.pbtabs div').forEach((t) => { t.classList.toggle('on', +t.dataset.t === tab); t.onclick = () => { tab = +t.dataset.t; const f = shop.find((x) => x.tab === tab); if (f) sel = f.cls; menu.click(); refresh(); }; });
    const list = $('.pblist');
    list.innerHTML = '';
    for (const e of shop.filter((x) => x.tab === tab)) {
      const row = el('div', 'pbitem' + (e.cls === sel ? ' on' : '') + (PB.isHero(e.cls) && PB.hasHero(army, e.cls) ? ' had' : ''));
      const ic = iconFor(e.cls), lo = e.prices.findIndex((p) => p > 0);
      row.innerHTML = `<i style="${ic ? spriteCss(ic, 2, 26, 25) || '' : ''}"></i><span>${esc(D.text(e.cls).name)}</span><em>${lo >= 0 ? e.prices[lo] : ''}</em>`;
      row.onclick = () => { sel = e.cls; menu.click(); refresh(); };
      row.ondblclick = () => { if (PB.buyLowest(army, e.cls, opt.total, tribe, blocked) != null) { menu.click(); refresh(); } };
      row.onmouseenter = () => describe(e.cls);
      list.appendChild(row);
    }
    if (sel) describe(sel);
  }

  // ------------------------------------------------------------ presets (multiplayer: PresetWindow)
  function drawPresets() {
    const s = $('#pb_pre');
    if (!s) return;
    const defs = PB.presets(tribe, opt.credits).map((p) => ['d:' + p.kind, ui('_pb_' + p.kind, p.kind)]);
    const own = ownPresets().filter((p) => p.tribe === tribe && p.cost === opt.credits).map((p) => ['o:' + p.name, p.name]);
    s.innerHTML = '<option value="">—</option>' + [...defs, ...own].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    s.value = army.preset && [...s.options].some((o) => o.value === army.preset) ? army.preset : '';
    s.onchange = () => {
      const v = s.value;
      if (!v) return;
      const pre = v.startsWith('d:') ? PB.preset(tribe, opt.credits, v.slice(2)) : ownPresets().find((p) => p.tribe === tribe && p.cost === opt.credits && p.name === v.slice(2));
      if (!pre) return;
      army = PB.load(pre, tribe, opt.total, { mp: true, buildings: opt.buildings !== false });
      army.preset = v;
      menu.click();
      refresh();
    };
    $('[data-a="del"]').classList.toggle('off', !s.value.startsWith('o:'));
  }
  // an own preset: the cards (with the Aje collector) and the resources, for this tribe and budget (PW:379-461)
  const savePreset = () => {
    const name = ($('#pb_name').value || '').trim().replace(/\s+/g, '_');
    if (!name) return;
    const list = ownPresets().filter((p) => !(p.tribe === tribe && p.cost === opt.credits && p.name === name));
    list.push({ name, tribe, cost: opt.credits, units: { ...army.cards }, res: { ...army.res } });
    saveOwn(list);
    army.preset = 'o:' + name;
    refresh();
  };
  const deletePreset = () => {
    const v = $('#pb_pre').value;
    if (!v.startsWith('o:')) return;
    saveOwn(ownPresets().filter((p) => !(p.tribe === tribe && p.cost === opt.credits && p.name === v.slice(2))));
    army.preset = '';
    refresh();
  };

  function refresh() {
    drawPyramid();
    drawArrows();
    drawRes();
    drawGauge();
    drawList();
    drawPresets();
  }
  const leave = () => W.classList.remove('wide');
  menu.bind({
    back: () => { leave(); opt.back(); },
    done: () => { leave(); opt.done(army); },
    clear: () => { army = PB.clear(tribe, { buildings: opt.buildings !== false, mp: true }); refresh(); },
    defaults: () => { army = opt.defaults(); refresh(); },
    save: savePreset,
    del: deletePreset,
  });
  refresh();
}
