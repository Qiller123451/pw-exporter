// The original's tooltips: what they say and how they look.
//
// Reference: Game/UI/ToolTipWindow.usl (GenerateMsgScript: the line order and the icons), CommandBarEx/CmdButton.usl
// (Validate: the command bar's buttons), CommandBarEx/CommandBar.usl (the menu and action buttons, the requirement
// lines), Info.usl and PyramidCard.usl (objects). The texts are the encyclopedia's help items (Texts/Help/*.seml,
// gamedata.json "texts"), keyed by the tech tree's description of the action's location or object; the command bar's
// own lines come from the string table (main_uk.ltf, gamedata.json "ui").
//
// A tooltip, top to bottom: the title row with the class icon ("other" for upgrades, moves and buttons), the heroes'
// level rows (5 down to 1), the help text, the requirement lines, the row of strengths against infantry, animals,
// vehicles and buildings, and the cost row (skulls, food, wood, stone; light red what the player can't afford). No
// durations, cooldowns or keys: the original shows none. A key without a help item shows as it is, under an empty
// title (CmdButton.usl:154).
import { spriteCss } from './atlas.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const br = (s) => esc(String(s).trim()).replace(/\n/g, '<br>');
const icon = (name, w = 16, h = 16) => `<span class="ti" style="${spriteCss(name, undefined, w, h) || ''}"></span>`;
const Q = { '++': 'plusplus', '+': 'plus', '-': 'minus', '--': 'minusminus' };
// the tech tree's generic moves have no help item: the original's buttons for them use the command bar's keys
const GENERIC = { _attack: 'cb_attack', _walk: 'cb_walk', _stop: 'cb_stop', _kill: 'cb_kill', _open: 'cb_gate_open',
  _close: 'cb_gate_close', _auto_gate: 'cb_gate_auto', _aggressivetarget: 'cb_agressive_walk' };

// o: { title, cls, lvl {1..5}, body, lines [[text, bad]], vs {chtr, anml, vhcl, bldg}, cost {skulls, food, wood,
// stone, power}, short {res: true} }
export function ttHtml(o) {
  let h = '';
  if (o.title != null && o.title !== '') {
    h += `<div class="ttt" style="${spriteCss('tt_bgimage_title', undefined, 194, 16) || ''}">${icon('tt_class_' + (o.cls || 'other'))}<b>${esc(o.title)}</b></div>`;
  }
  const lvl = o.lvl || {};
  for (let n = 5; n >= 1; n--) {
    if (!lvl[n]) continue;
    h += `<div class="ttl">${icon('tt_level_' + (n - 1))}<div>${br(lvl[n])}</div></div>`;
  }
  if (o.body && o.body.trim() && o.body.trim() !== '%%') h += `<div class="ttb">${br(o.body)}</div>`;
  for (const [t, bad] of o.lines || []) h += `<div class="ttb${bad ? ' bad' : ''}">${br(t)}</div>`;
  const vs = o.vs || {};
  if (['chtr', 'anml', 'vhcl', 'bldg'].some((c) => Q[vs[c]])) {
    // the class icons are part of the row's picture; the qualities at its tabs (23, 72, 121, 169)
    h += `<div class="ttr" style="${spriteCss('tt_bgimage_value', undefined, 194, 16) || ''}">` +
      ['chtr', 'anml', 'vhcl', 'bldg'].map((c, i) => (Q[vs[c]] ? `<span style="left:${[23, 72, 121, 169][i]}px">${icon('tt_quality_' + Q[vs[c]])}</span>` : '')).join('') + '</div>';
  }
  if (o.cost) {
    const s = o.short || {};
    h += `<div class="ttr" style="${spriteCss('tt_bgimage_stats', undefined, 194, 16) || ''}">` +
      ['skulls', 'food', 'wood', 'stone'].map((r, i) => `<span class="v${s[r] ? ' bad' : ''}" style="left:${[19, 68, 117, 165][i]}px">${Math.round(o.cost[r] || 0)}</span>`).join('') + '</div>';
    if (o.cost.power) h += `<div class="ttb${s.power ? ' bad' : ''}"><span class="pwicon"></span> ${Math.round(o.cost.power)}</div>`;    // the sequel's electricity
  }
  return h;
}

// a help item by key: { title, cls, lvl, body, vs } (a missing key: the key itself as the text)
export function helpTip(G, key) {
  const t = G.data.textKey(GENERIC[key] || key);
  return t ? { title: t.name, cls: t.cls, lvl: t.lvl, body: t.medium, vs: t.vs } : { title: '', body: key || '' };
}

// an object (a unit, building, animal): its help item (HelpMenu.GetObjHelpitemKey: by its description key)
export function objectTip(G, name) {
  const t = G.data.text(name);
  return ttHtml({ title: t.name, cls: t.cls, lvl: t.lvl, body: t.medium, vs: t.vs });
}

// a button of the command bar's flyout: build, produce, upgrade, hire, special move (CmdButton.Validate). why: the
// remake's reason it can't be used now (production.js canQueue, main.js moveState)
export function actionTip(G, a, why, sel) {
  const D = G.data, p = G.me;
  // the help item of the location's description key (Rules.actionText: the sequel's copies their own); a key the game
  // has no help item for shows as it is
  const key = (a.loc && a.loc.desc) || (a.locs && a.locs[0] && a.locs[0].desc) || '';
  const r = a.kind === 'Build' && a.results[0] && a.results[0].obj, own = r && D.sameAs[r] && D.texts[r];
  const o = key && !own ? helpTip(G, key) : (() => { const t = D.actionText(a); return { title: t.name, cls: t.cls, lvl: t.lvl, body: t.medium, vs: t.vs }; })();
  // no free place in the army pyramid for the unit's level, or the unit limit reached (CommandBar.CheckCharacterConditions)
  if ((why === 'level' || why === 'housing') && a.kind !== 'Moves') { o.body = D.ui('_ObjCommandBar_UnitLevelReached'); o.lvl = null; }
  const lines = [];
  const caster = sel && sel[0];
  const owner = caster && caster.rulesOwner ? caster.rulesOwner() : p;
  const queuedElsewhere = a.kind === 'Upgrades' && !a.results.some((r) => r.cls === 'local') && G.world.anyQueued(p, a.id) &&
    !(caster && caster.queue && caster.queue.some((q) => q.action.id === a.id));
  if (queuedElsewhere) lines.push([D.ui('_ObjCommandBar_AlreadyInventing'), true]);
  else {
    const T = D.tree(owner), tribe = a.tribe === 'Special' ? T.tribe : a.tribe;
    const inv = a.req.filter((r) => !D.invented(owner, r, tribe, caster));
    if (inv.length) lines.push([D.ui('_ObjCommandBar_InventionsNeeded') + '\n' + inv.join(' '), true]);       // (the ids: the original doesn't translate them)
    const bld = owner && owner.debug ? [] : a.breq.filter((r) => !T.built(r, tribe));
    if (bld.length) lines.push([D.ui('_ObjCommandBar_BuildingsNeeded') + '\n' + bld.map((b) => (D.exists(b) ? D.text(b).name : `unknown (${b})`)).join(' '), true]);
  }
  // the cost row: every resource of the tribe, 0 included; not for moves without costs
  const c = a.cost || {};
  const paid = ['food', 'wood', 'stone', 'skulls', 'power'].some((r) => c[r]);
  const short = {};
  for (const r of ['food', 'wood', 'stone', 'skulls', 'power']) if ((c[r] || 0) > ((p.res && p.res[r]) || 0)) short[r] = true;
  // a move that needs a higher level than any of the selected has
  if (a.levelReq > 1 && !(sel || []).some((u) => (u.level || 1) >= a.levelReq)) lines.push([D.ui('_ObjCommandBar_RequiresLevel') + a.levelReq, true]);
  return ttHtml({ ...o, lines, cost: queuedElsewhere || (a.kind === 'Moves' && !paid) ? null : c, short });
}

// a single text (SetToolTipText(s): GenerateMsgScript takes its first line as the title)
export function textTip(s) {
  const [title, ...rest] = String(s || '').split('\n');
  return ttHtml({ title, body: rest.join('\n') });
}

// a menu or action button of the command bar (CommandBar.usl: title + help text of a "cb_*" key)
export function buttonTip(G, key, extra) {
  return ttHtml({ ...helpTip(G, key), ...(extra || {}) });
}

// the fixed tooltip window above the minimap (IngameScreen.usl:265-268, ToolTipWindow.usl): 235 px wide, its bottom
// left corner 35 px right of the minimap's left edge and 19 px below its top, growing upwards; the text area 200 px
// wide at (13, 7) in pale yellow. Hidden it shows the closed tab.
export class TipWindow {
  // home: the original's place (IngameScreen.usl: the window above the minimap); floatRoot: where a tooltip shown
  // next to what the mouse is over goes (Options: "Tooltips next to what the mouse is over")
  constructor(parent, floatRoot = null) {
    const el = (cls, p) => { const e = document.createElement('div'); e.className = cls; p.appendChild(e); return e; };
    this.home = parent;
    this.floatRoot = floatRoot;
    this.box = el('tipwin', parent);
    for (const k of ['topleft', 'topcenter', 'topright', 'centerleft', 'centercenter', 'centerright', 'bottomleft', 'bottomcenter', 'bottomright']) el('tw-' + k, this.box);
    this.text = el('tip', this.box);
    this.closed = el('tipclosed', parent);
    this.hide();
  }
  // at: an element or a screen point {x, y} to show it next to (s: the HUD scale), else the original window
  show(html, at = null, s = 1) {
    this.text.innerHTML = html;
    this.box.classList.remove('hidden');
    if (at && this.floatRoot) { this.closed.classList.remove('hidden'); this.float(at, s); } else { this.closed.classList.add('hidden'); this.dock(); }
  }
  dock() {
    const b = this.box;
    if (b.parentNode !== this.home) this.home.insertBefore(b, this.closed);
    b.classList.remove('float');
    b.style.left = b.style.top = b.style.transform = '';
  }
  // next to the element: below the top bar's things, above the bottom panels', right of what is on the left half of the
  // screen (the army pyramid), left of what is on the right half (the objectives, the command powers); always on screen
  float(at, s) {
    const b = this.box, vw = window.innerWidth, vh = window.innerHeight, g = 6;
    if (b.parentNode !== this.floatRoot) this.floatRoot.appendChild(b);
    b.classList.add('float');
    b.style.transform = `scale(${s})`;
    const w = b.offsetWidth * s, h = b.offsetHeight * s;
    let x, y;
    if (at.getBoundingClientRect) {
      const r = at.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (r.bottom < 80 * s) { x = cx - w / 2; y = r.bottom + g; }
      else if (r.top > vh - 215 * s) { x = cx - w / 2; y = r.top - g - h; }
      else if (cx < vw / 2) { x = r.right + g; y = cy - h / 2; }
      else { x = r.left - g - w; y = cy - h / 2; }
    } else {
      x = at.x + 16; y = at.y + 20;                     // a point (a question mark in the world): below right of the cursor
      if (x + w > vw - 4) x = at.x - 16 - w;
      if (y + h > vh - 4) y = at.y - 12 - h;
    }
    b.style.left = Math.round(Math.max(4, Math.min(vw - w - 4, x))) + 'px';
    b.style.top = Math.round(Math.max(4, Math.min(vh - h - 4, y))) + 'px';
  }
  hide() {
    this.box.classList.add('hidden');
    this.closed.classList.remove('hidden');
  }
  get shown() { return !this.box.classList.contains('hidden'); }
}
