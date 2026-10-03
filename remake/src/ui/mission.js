// Mission UI of the campaign: quest log and news ticker, dialogue scenes, cutscenes (sequences), timers, the info bar,
// minimap markers and the question marks over quest givers. The trigger engine (game/campaign/engine.js) owns the
// STATE (which quest is visible, how long a timer has left ...) and tells this class what changed; this class only
// shows it. Created for campaign missions as G.mission (main.js).
//
// CONTRACT between the engine and the UI (keep the names and arguments; both sides are written against it):
//   questChanged(quest, change)   quest = the mission data's quest object (data.quests[i]: guid, name, group, main,
//                                 headline, description, bonus ...) whose flags `visible`, `accomplished`,
//                                 `unaccomplishable` the engine keeps up to date; change = 'shown' | 'done' |
//                                 'failed' | 'hidden'. The UI reads all quests from G.campaign.data.quests.
//   infoBar(text)                 the level's info bar line, already formatted; '' hides it
//   timers                        the UI reads engine timers from G.campaign.timers: Map<id, { id, left (s), show,
//                                 label (text), paused }> every frame - nothing to call
//   marker(m)                     minimap marker: { id, x, z (game coords), entity | null (follows it), color (0xRRGGBB),
//                                 kind ('SPMainQuest' | 'SPOptQuest' | 'SPHint' | 'Attack' | 'FixedColor'), extended,
//                                 ttl (s, 0 = until removed), repeats, interval (s) }
//   removeMarker(id)              all markers with that id
//   playDialog(scene, onEnd)      queue a dialogue scene (data.dialogs[path]: actors, frames[{actor, speaker, text,
//                                 audio}]); the game keeps running; scenes play one after another on GAME time
//                                 (tick(dt)); frame length = its sound, at least 0.25 s per vowel group of the text;
//                                 onEnd() exactly once when the scene is over or the player closed it
//   playSequence(seq, opts, onEnd) a cutscene: seq = data.sequences[path] ({lines[{speaker, text}]}) or null when the
//                                 file is unknown; opts = { camera: {x, z} | null, snapBack, title }. The simulation is
//                                 paused while it shows (the UI calls G.setPaused); onEnd() exactly once, also when
//                                 skipped. In ?manual test mode (no real-time loop) it ends on the next tick.
//   busy()                        true while a sequence is on screen (the engine does not start the next one)
//   tick(dt)                      game time, from the simulation step (dialogue timing)
//   update(dt)                    real time, once per drawn frame (layout, timers display, marker blinking)
//   skipAll()                     tests: end every running / queued scene and sequence now (calling their onEnd)
// World side effects (camera jumps, fog reveals, sounds, game over) are NOT here: the engine calls G.rtscam,
// world.revealArea, G.audio, G.endMission itself.
//
// BEYOND THE CONTRACT (docs/MISSION_UI.md): openLog() / closeLog() / toggleLog() (quest log, key L), news(text, kind,
// opts) (a ticker line), showTitle() (the mission title card), closeDialog() (the player's close button), next() /
// skip() (cutscene: next line / end it), key(e) (keyboard hook of ui/input.js), drawMinimap(ctx, minimap) (hook of
// ui/overlay.js Minimap), frameLength(text, soundSeconds), `manual` (true with ?manual: no cutscene presentation),
// `cine` (the cutscene on screen or null), `scene` (the dialogue scene playing or null), `log`.
//
// Originals: Game/UI/QuestWindow.usl (QW), NewsTicker.usl (NT), DialogScene.usl (DS), TimerWnd.usl (TW),
// MiniMap2.usl (MM), IngameScreen.usl (IS), Server/classes/misc/QuestionMark.usl; behaviour: docs/spec/triggers.md §5.2, §6.
import * as THREE from 'three';
import { UIA, spriteCss, iconFor, entry } from './atlas.js';

// minimap marker colours by type (MM:238-262); 'FixedColor' carries its own
const MARK_COLOR = { Attack: 0xff0000, SPMainQuest: 0xffc864, SPOptQuest: 0xc8c8c8, SPHint: 0x007800 };
// question marks: state -> glyph and colour (QuestionMark.usl: questionmark_red / _green / _yellow, exclamation_yellow)
const QMARK = {
  QM_STATE_RED: ['?', '#e8402a', '#5a0c04'], QM_STATE_GREEN: ['?', '#58d840', '#0c4a08'],
  QM_STATE_YELLOW: ['?', '#ffd428', '#6a4a00'], EC_STATE_YELLOW: ['!', '#ffd428', '#6a4a00'],
};
// news ticker: text key, icon and sound of a quest change (QW:492-507)
const QUEST_NEWS = {
  shown: ['_NT_QuestNew', 'New quest', 'nticon_quest_new_normal', 'ui_quest_new', 'new'],
  done: ['_NT_QuestAccomplished', 'Quest accomplished', 'nticon_quest_accomplished_normal', 'ui_quest_accomplished', 'good'],
  failed: ['_NT_QuestUnaccomplishable', 'Quest unaccomplishable', 'nticon_quest_unaccomplishable_normal', 'ui_quest_unaccomplishable', 'bad'],
};
const NEWS_TIME = 12;          // seconds a ticker line stays (real time)
const TITLE_TIME = 7;          // the mission title card
const CAM_EASE = 1.6;          // seconds the camera takes to the cutscene position

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
const esc = (t) => String(t == null ? '' : t).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
const clock = (s) => { s = Math.max(0, Math.ceil(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// "vowel groups" of the original's frame length rule (DS:419-436): a vowel counts when it differs from the last
// vowel counted, so "banana" is 1 and "Fight now" is 2
export function vowelGroups(text) {
  let n = 0, last = '';
  for (const ch of String(text || '').toLowerCase()) if ('aeiou'.includes(ch) && ch !== last) { last = ch; n++; }
  return n;
}

export class MissionUI {
  constructor(G) {
    this.G = G;
    this.markers = [];
    this.scenes = [];             // dialogue scenes: [0] is the one playing
    this.seqs = [];               // cutscenes: [0] is the one on screen
    this.log = [];                // what was asked, for tests: [kind, id, ...]
    this.bar = '';
    this.manual = typeof location !== 'undefined' && new URLSearchParams(location.search).has('manual');
    this.scene = null;            // the dialogue scene playing: { scene, onEnd, i, t, len, shown, hidden }
    this.cine = null;             // the cutscene on screen: { seq, opts, onEnd, i, t, len, cam ... }
    this.news_ = [];              // ticker lines: { el, t }
    this.read = new Map();        // quest guid -> state the player has seen in the log (QW "ReadStates")
    this.unread = false;
    this.marks = new Map();       // question mark -> sprite
    this.rings = [];              // in-world rings of the extended markers
    this.seq_ = 0;                // request counter (order of skipAll)
    this.time = 0;                // real seconds (animations)
    this.titleT = 0;
    this.hoverT = 0;
    this.s = 0;
    this.build();
    const C = G.campaign;
    if (C) {
      if (!C.timers) C.timers = new Map();
      for (const m of C.questionMarks || []) this.questionMark(m);
      if (C.on) C.on('questionmark', (m) => this.questionMark(m));
    }
    if (!this.manual) this.showTitle();
  }
  get dom() { return !!this.left; }
  // dialogue scenes and cutscenes waiting or running, in the order they were asked for
  get queue() { return [...this.scenes.map((q) => ({ ...q, kind: 'dialog' })), ...this.seqs.map((q) => ({ ...q, kind: 'sequence' }))].sort((a, b) => a.n - b.n); }
  text(key, fallback) { const C = this.G.campaign, t = C && C.data && C.data.texts; return t && key in t ? t[key] : fallback !== undefined ? fallback : key; }
  sound(name) { const A = this.G.audio; if (A && A.playFirst) A.playFirst([name]); }

  // ------------------------------------------------------------------ DOM
  build() {
    const G = this.G;
    if (typeof document === 'undefined' || !G.hud || !G.hud.root) return;
    const root = G.hud.root;
    // quest button next to "Menu" (IS:309-326: hud/menu_questbutton.tga, 69 px)
    this.qbtn = el('div', 'mbtn qbtn');
    this.qbtn.style.backgroundImage = `url(${UIA.base}hud_menu_questbutton.png)`;
    this.qbtn.innerHTML = `<span>${esc(this.text('_UI_IngaScre_Button_Quest', 'Quests'))}</span>`;
    this.qbtn.onclick = () => this.toggleLog();
    this.qbtn.onmouseenter = () => G.hud.showTip(this.qbtn, `<h4>${esc(this.text('_UI_QuestWin_Title_Quests', 'Quests'))}</h4><span class="sub">Quest log (L)</span>`);
    this.qbtn.onmouseleave = () => G.hud.hideTip();
    if (G.hud.tr) G.hud.tr.insertBefore(this.qbtn, G.hud.tr.firstChild);
    // left column under the resource bar: the dialogue box and the news ticker (NT: a 235 px column)
    this.left = el('div', 'mleft', root);
    this.dlg = el('div', 'dlg hidden', this.left, '<div class="dpor"></div><div class="dbody"><b class="dname"></b><span class="dtext"></span></div><i class="dclose" title="Close"></i>');
    this.dlg.querySelector('.dclose').style.backgroundImage = `url(${UIA.base}hud_closebutton.png)`;
    this.dlg.querySelector('.dclose').onclick = () => this.closeDialog();
    this.ticker = el('div', 'nticker', this.left);
    // top centre: info bar and timers (IS:281 the countdown window, IS:384 the timer)
    this.top = el('div', 'mtop', root);
    this.ibar = el('div', 'ibar hidden', this.top);
    this.timersEl = el('div', 'mtimers', this.top);
    this.timerEls = new Map();
    // cutscene: letterbox bars + subtitles; takes every click (the player has no input, Game.usl:1812-1858)
    this.cineEl = el('div', 'cine hidden', document.body, '<div class="cbar ctop"><span class="ctitle"></span></div>' +
      '<div class="cbar cbot"><div class="csub"><div class="cpor"></div><div class="cline"><b class="cname"></b><span class="ctext"></span></div></div>' +
      '<div class="chint">Click or Space: continue &nbsp;·&nbsp; Esc: skip</div></div>');
    for (const e of ['mousedown', 'mouseup', 'click', 'contextmenu', 'wheel', 'dblclick']) this.cineEl.addEventListener(e, (ev) => { ev.stopPropagation(); if (e === 'contextmenu') ev.preventDefault(); });
    this.cineEl.addEventListener('click', () => this.next());
    this.titleEl = el('div', 'mtitle hidden', document.body, '<h1></h1><p></p>');
    this.preload();
  }
  // the portrait sheets of everybody who speaks in this mission (else the first frame of a speaker shows an empty
  // box until the browser has decoded the sheet)
  preload() {
    const D = this.G.campaign && this.G.campaign.data, files = new Set(['hud_closebutton.png', 'hud_timers.png', 'hud_newstickericons.png']);
    const add = (name, lvl) => { const ic = iconFor(name), e = ic && entry(ic, lvl); if (e) files.add(e[0]); };
    for (const d of Object.values((D && D.dialogs) || {})) for (const a of Object.values(d.actors || {})) { add(a.icon, 4); if (!iconFor(a.icon)) add(a.class, 4); }
    for (const q of Object.values((D && D.sequences) || {})) for (const l of q.lines || []) add(l.speaker, 3);
    this.sheets = [...files].map((f) => { const im = new Image(); im.src = UIA.base + f; return im; });
  }
  layout() {
    const G = this.G, s = G.hud.s || 1;
    const key = s + ':' + window.innerWidth + ':' + window.innerHeight;
    if (key !== this.layoutKey) {
      this.layoutKey = key; this.s = s;
      this.left.style.transform = `scale(${s})`;
      this.left.style.top = Math.round(58 * s) + 'px';
      // the column ends above the minimap
      this.left.style.maxHeight = Math.max(80, Math.floor((window.innerHeight - 58 * s - 270 * s - 6) / s)) + 'px';
      this.top.style.transform = `translateX(-50%) scale(${s})`;
      this.top.style.top = Math.round(38 * s) + 'px';
      this.topKey = null;
    }
    // too many lines for the room above the minimap: the oldest ticker lines go
    while (this.news_.length > 1 && this.left.scrollHeight > this.left.clientHeight + 1) this.dropNews(this.news_[0]);
    // the HUD's own messages start below the info bar and the timers
    const tk = this.top.offsetHeight + ':' + this.s;
    if (tk !== this.topKey) {
      this.topKey = tk;
      const h = this.top.offsetHeight;
      if (G.hud.msgs) G.hud.msgs.style.top = h > 2 ? Math.round(38 * this.s + h * this.s + 6) + 'px' : '';
    }
  }

  // ------------------------------------------------------------------ quests: news ticker + log
  questChanged(quest, change) {
    if (!quest) return;
    this.log.push(['quest', quest.name, change]);
    const n = QUEST_NEWS[change];
    if (n) {
      this.news(`<b>${esc(this.text(n[0], n[1]))}</b><br>${esc(quest.headline || quest.name)}`, n[4], { icon: n[2], sound: n[3], quest: quest.guid, html: true });
      this.unread = true;                    // the quest button flashes until the log is opened (QW:509-523)
      if (this.qbtn) this.qbtn.classList.add('new');
    }
    if (this.logOpen) this.fillLog();
  }
  // a line in the news ticker; kind: '' | 'new' | 'good' | 'bad' | 'story'; opts: { icon, sound, quest, html, time }
  news(text, kind = '', opts = {}) {
    this.log.push(['news', opts.html ? String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : text, kind]);
    if (opts.sound !== null) this.sound(opts.sound || 'ui_message');     // NT:86
    if (!this.dom) return null;
    const e = el('div', 'nt ' + kind, this.ticker);
    const ic = spriteCss(opts.icon || 'nticon_info_normal', 24, 16, 16);
    e.innerHTML = `<i style="${ic || ''}"></i><span>${opts.html ? text : esc(text)}</span>`;
    const n = { el: e, t: opts.time || NEWS_TIME };
    // NT:230-262 a click on the icon goes where the message points, a right click removes it
    e.onclick = () => { if (opts.quest) this.openLog(opts.quest); this.dropNews(n); };
    e.oncontextmenu = (ev) => { ev.preventDefault(); this.dropNews(n); };
    this.news_.push(n);
    return n;
  }
  dropNews(n) { const i = this.news_.indexOf(n); if (i >= 0) this.news_.splice(i, 1); n.el.remove(); }

  questState(q) { return q.accomplished ? 'done' : q.unaccomplishable ? 'failed' : 'open'; }
  bonus(q) { const C = this.G.campaign, b = q.bonus || {}; return +(b[['easy', 'medium', 'hard'][C ? C.difficulty : 1]] || 0); }
  // the visible quests as the log lists them (QW:138-262): the groups of the main quests in order of appearance,
  // main quests without a group, then the side quests under "Subquests". Each group with its points got / possible.
  questGroups() {
    const C = this.G.campaign, all = (C && C.data && C.data.quests || []).filter((q) => q.visible);
    const groups = [], by = new Map();
    const add = (key, title, q) => {
      let g = by.get(key);
      if (!g) { g = { key, title, quests: [], got: 0, max: 0 }; by.set(key, g); groups.push(g); }
      g.quests.push(q); g.max += this.bonus(q); if (q.accomplished) g.got += this.bonus(q);
    };
    for (const q of all) if (q.main && q.group) add(q.group, q.group_title || this.text('_' + q.group, q.group), q);
    for (const q of all) if (q.main && !q.group) add('', '', q);
    for (const q of all) if (!q.main) add('SubQuestGroup', this.text('_SubQuestGroup', 'Subquests'), q);
    return groups;
  }
  get logOpen() { const G = this.G; return !!(G.menuOpen && G.menu && G.menu.win && G.menu.win.querySelector('.qlog')); }
  toggleLog() { if (this.logOpen) this.closeLog(); else this.openLog(); }
  closeLog() { if (this.logOpen) this.G.closeMenu(); }
  // the quest log: a modal window that pauses the game (QW:121-127), no log during a cutscene (IS:790-793)
  openLog(select) {
    const G = this.G;
    if (!G.menu || this.cine || G.over || (G.menuOpen && !this.logOpen)) return false;
    if (select) this.logSel = select;
    G.menu.inGame = true;
    G.menu.open(esc(this.text('_UI_QuestWin_Title_Quests', 'Quests')), `<div class="qlog"><div class="qcols"><div class="qlist"></div><div class="qtext"></div></div>
      <div class="qfoot"><span class="qtotal"></span>${G.menu.btn('close', esc(this.text('_UI_QuestWin_Button_Close', 'Close')), 'small')}</div></div>`);
    G.menu.bind({ close: () => this.closeLog() });
    if (G.hud) G.hud.hideTip();
    this.fillLog(true);
    this.unread = false;
    if (this.qbtn) this.qbtn.classList.remove('new');
    return true;
  }
  fillLog(first) {
    const G = this.G, win = G.menu.win, list = win.querySelector('.qlist');
    if (!list) return;
    const groups = this.questGroups(), flat = groups.flatMap((g) => g.quests);
    const icon = { open: 'nticon_quest_new_normal', done: 'nticon_quest_accomplished_normal', failed: 'nticon_quest_unaccomplishable_normal' };
    // what the player has not seen yet is shown as new (QW:300-318); opening the log marks it read
    if (first) this.fresh = new Set(flat.filter((q) => this.read.get(q.guid) !== this.questState(q)).map((q) => q.guid));
    for (const q of flat) this.read.set(q.guid, this.questState(q));
    let h = '', got = 0, max = 0;
    for (const g of groups) {
      got += g.got; max += g.max;
      if (g.title) h += `<div class="qg"><span>${esc(g.title)}</span><em>${g.got}/${g.max}</em></div>`;
      for (const q of g.quests) {
        const st = this.questState(q);
        h += `<div class="q ${st}${this.fresh.has(q.guid) && st === 'open' ? ' new' : ''}" data-g="${esc(q.guid)}"><i style="${spriteCss(icon[st], 24, 16, 16) || ''}"></i><span>${esc(q.headline || q.name)}</span><em>${this.bonus(q) || ''}</em></div>`;
      }
    }
    list.innerHTML = h || '<div class="qnone">No quests yet.</div>';
    win.querySelector('.qtotal').textContent = flat.length ? `Points: ${got} / ${max}` : '';
    const sel = flat.find((q) => q.guid === this.logSel) || flat.find((q) => this.fresh.has(q.guid) && this.questState(q) === 'open') || flat.find((q) => this.questState(q) === 'open') || flat[0];
    list.querySelectorAll('.q').forEach((d) => { d.onclick = () => { this.logSel = d.dataset.g; this.showQuest(flat.find((q) => q.guid === d.dataset.g)); if (G.menu.click) G.menu.click(); }; });
    this.showQuest(sel);
  }
  showQuest(q) {
    const win = this.G.menu.win, box = win.querySelector('.qtext');
    if (!box) return;
    win.querySelectorAll('.qlist .q').forEach((d) => d.classList.toggle('on', !!q && d.dataset.g === q.guid));
    if (!q) { box.innerHTML = ''; return; }
    this.logSel = q.guid;
    const st = this.questState(q), b = this.bonus(q);
    const state = { open: '', done: this.text('_NT_QuestAccomplished', 'Quest accomplished'), failed: this.text('_NT_QuestUnaccomplishable', 'Quest unaccomplishable') }[st];
    box.innerHTML = `<b>${esc(q.headline || q.name)}</b>${state ? `<div class="qstate ${st}">${esc(state)}</div>` : ''}` +
      `<div class="qdesc">${esc(q.description || '')}</div>${b ? `<small>${st === 'done' ? 'Points earned' : 'Points'}: ${b}</small>` : ''}`;
    box.scrollTop = 0;
  }

  // ------------------------------------------------------------------ info bar, timers
  infoBar(text) {
    this.bar = text || '';
    this.log.push(['infobar', this.bar]);
    if (!this.dom) return;
    this.ibar.textContent = this.bar;
    this.ibar.classList.toggle('hidden', !this.bar);
  }
  // the engine's timers that are to be seen: a pill with the time and the label under it (TW)
  showTimers() {
    const T = this.G.campaign && this.G.campaign.timers, seen = new Set();
    if (T && T.forEach) T.forEach((t, id) => {
      if (!t || !t.show) return;
      seen.add(id);
      let e = this.timerEls.get(id);
      if (!e) {
        e = el('div', 'mtimer', this.timersEl, '<div class="tpill"><b></b></div><span></span>');
        this.timerEls.set(id, e);
      }
      const b = e.firstChild.firstChild, s = e.lastChild, txt = clock(t.left), lab = t.label || '';
      if (b.textContent !== txt) b.textContent = txt;
      if (s.textContent !== lab) s.textContent = lab;
      e.classList.toggle('low', t.left <= 10);
      e.classList.toggle('paused', !!t.paused);
    });
    for (const [id, e] of this.timerEls) if (!seen.has(id)) { e.remove(); this.timerEls.delete(id); }
  }

  // ------------------------------------------------------------------ minimap markers
  marker(m) {
    if (!m) return;
    this.log.push(['marker', m.id, m.kind]);
    const e = m.entity || null;
    this.markers.push({ ...m, entity: e, x: e && e.pos ? e.pos.x : +m.x || 0, z: e && e.pos ? e.pos.z : +m.z || 0, age: 0, born: this.time,
      color: MARK_COLOR[m.kind] != null ? MARK_COLOR[m.kind] : m.color != null ? m.color : 0xff0000 });
    if (this.G.minimap) this.G.minimap.t = 0;
  }
  removeMarker(id) { this.log.push(['unmarker', id]); this.markers = this.markers.filter((m) => m.id !== id); if (this.G.minimap) this.G.minimap.t = 0; }
  // is the marker lit now? ttl 0: always. Else it shows for ttl seconds, `repeats` more times with `interval`
  // seconds of darkness between (MM:224 time_to_life, num_repeats, ms_between), then it is gone.
  markerOn(m) {
    if (!(m.ttl > 0)) return true;
    const cyc = m.ttl + Math.max(0, m.interval || 0);
    return m.age % cyc < m.ttl;
  }
  markerDone(m) { return m.ttl > 0 && m.age >= m.ttl + Math.max(0, m.repeats || 0) * (m.ttl + Math.max(0, m.interval || 0)); }
  // called by Minimap.update (ui/overlay.js) after the units, before the camera frame
  drawMinimap(ctx, mm) {
    for (const m of this.markers) {
      if (!this.markerOn(m)) continue;
      const [x, y] = mm.w2m(m.x, m.z), col = hex(m.color);
      const k = ((this.time - m.born) * 0.85) % 1;                 // a ring running outwards (MM: frequency 0.7)
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,' + (0.55 * (1 - k)).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(x, y, 4 + k * 9 + 1, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1 - k * 0.85; ctx.strokeStyle = col;
      ctx.beginPath(); ctx.arc(x, y, 4 + k * 9, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, 4.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  // extended markers also show in the world: a ring on the ground (triggers.md §5.2 MPNG `extended`)
  updateRings() {
    const G = this.G;
    if (!G.scene || !G.world) return;
    let n = 0;
    for (const m of this.markers) {
      if (!m.extended || !this.markerOn(m) || n >= 24) continue;
      let r = this.rings[n];
      if (!r) {
        r = new THREE.Mesh(RING(), new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
        r.renderOrder = 19;
        G.scene.add(r);
        this.rings[n] = r;
      }
      n++;
      const k = ((this.time - m.born) * 0.7) % 1;
      r.visible = true;
      r.position.set(m.x, G.world.height(m.x, m.z) + 0.4, m.z);
      r.scale.setScalar(2.2 + k * 4);
      r.material.color.setHex(m.color);
      r.material.opacity = 0.95 * (1 - k * 0.65);
    }
    for (let i = n; i < this.rings.length; i++) this.rings[i].visible = false;
  }

  // ------------------------------------------------------------------ question marks
  questionMark(m) {
    if (!m) return;
    this.log.push(['questionmark', m.name, m.state]);
    const G = this.G, def = QMARK[m.state];
    let sp = this.marks.get(m);
    if (!def) { if (sp) { sp.removeFromParent(); this.marks.delete(m); } return; }
    if (!G.scene || typeof document === 'undefined') return;
    if (!sp) {
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, fog: false, toneMapped: false, depthWrite: false }));
      sp.scale.set(3.4, 3.4, 1);
      sp.renderOrder = 18;
      G.scene.add(sp);
      this.marks.set(m, sp);
    }
    sp.material.map = markTexture(m.state);
    sp.material.needsUpdate = true;
    sp.userData.y = (G.world && G.world.height ? G.world.height(m.x, m.z) : 0) + 4.2;
    sp.position.set(m.x, sp.userData.y, m.z);
  }
  updateMarks(dt) {
    const G = this.G, f = G.fow;
    for (const [m, sp] of this.marks) {
      // a place the player has not seen yet does not show its mark (fog of war)
      sp.visible = !f || f.revealAll || !f.explored_ || !!f.explored_(m.x, m.z);
      sp.position.y = sp.userData.y + 0.35 * Math.sin(this.time * 2.2 + m.x);
    }
    // the tooltip of the mark under the mouse (IS:1084-1093 QuestionMarkToolTip)
    this.hoverT -= dt;
    if (this.hoverT > 0 || !G.input || !G.overlay || !G.hud) return;
    this.hoverT = 0.1;
    let hit = null;
    const mo = G.input.mouse;
    if (!this.cine && !G.menuOpen && mo && mo.inside !== false) {
      const top = document.elementFromPoint(mo.x, mo.y);
      if (top === G.canvas || top === G.overlay.canvas) {
        let best = 34 * (this.s || 1);
        for (const [m, sp] of this.marks) {
          if (!sp.visible || !m.tooltip) continue;
          const p = G.overlay.toScreen(sp.position);
          const d = Math.hypot(p.x - mo.x, p.y - mo.y);
          if (p.z < 1 && d < best) { best = d; hit = m; }
        }
      }
    }
    if (hit) {
      const r = { left: mo.x, right: mo.x, top: mo.y - 14, bottom: mo.y + 18, width: 0, height: 32 };
      G.hud.showTip({ getBoundingClientRect: () => r }, esc(this.text(hit.tooltip)));
    } else if (this.tipMark) G.hud.hideTip();
    this.tipMark = hit;
  }

  // ------------------------------------------------------------------ dialogue scenes
  playDialog(scene, onEnd) {
    this.log.push(['dialog', scene && scene.id]);
    this.scenes.push({ scene, onEnd, n: this.seq_++ });
  }
  // DS:419-465: a frame lasts as long as its sound, at least 0.25 s per vowel group. Without the sound file the
  // spoken length is estimated from the text (0.6 s + 0.065 s per letter fits the game's voice files: 46 letters =
  // 3.4 s, 16 letters = 1.6 s; at least 1.5 s), so that the mission keeps the pace of the original and the line can be read.
  frameLength(text, sound = 0) {
    const rule = 0.25 * vowelGroups(text);
    return sound > 0 ? Math.max(sound, rule) : Math.max(rule, 1.5, 0.6 + 0.065 * String(text || '').length);
  }
  mentorShown() { const G = this.G, C = G.campaign; return (G.settings && G.settings.mentor) !== false || !!(C && C.map && C.map.tutorial); }
  startScene() {
    const q = this.scenes[0], sc = q.scene || {};
    const frames = sc.frames || [];
    // mentor hints can be switched off, except in the tutorial; the scene still runs to its end (DS:396-403)
    this.scene = { ...q, q, frames, i: -1, t: 0, len: 0, hidden: !!sc.mentor && !this.mentorShown(), sound: null };
    this.duck(true);
    this.nextFrame();
  }
  nextFrame() {
    const S = this.scene;
    this.stopVoice(S);
    S.i++;
    if (S.i >= S.frames.length) { this.endScene(); return; }
    const f = S.frames[S.i], sc = S.scene || {};
    S.t = 0;
    S.playing = false;
    if (S.hidden) { S.len = 0.5; return; }          // DS:440: a frame that is not shown is over at the next check (0.5 s)
    S.len = this.frameLength(f.text);
    const actor = (sc.actors || {})[f.actor] || {};
    const name = f.speaker || actor.display || f.actor || '';
    this.log.push(['frame', sc.id, S.i]);
    this.sound('ui_message');                        // NT:113
    if (this.dom) {
      if (this.titleT > 1.2) this.titleT = 1.2;           // the title card makes room for the first line
      const d = this.dlg, ic = iconFor(actor.icon) || iconFor(actor.class);
      const por = d.querySelector('.dpor');
      por.style.cssText = ic ? spriteCss(ic, 4, 64, 61) : '';
      por.textContent = ic ? '' : (name[0] || '?').toUpperCase();     // no portrait in the game's card atlas: a framed initial
      por.classList.toggle('blank', !ic);
      d.querySelector('.dname').textContent = name + this.text('_NT_ACTOR_TEXT_SEPARATOR', ':');
      d.querySelector('.dtext').textContent = f.text || '';
      d.classList.toggle('mentor', !!sc.mentor);
      d.classList.remove('hidden');
    }
    this.speak(this.frameSound(sc, f), 'ds', S, S.i);
  }
  // the sound file of a dialogue frame, relative to Audio/Sound: the sound event `audio` of dialogsounds.txt if the
  // built sounds.json has it, else the rule that table follows ('../SeqSounds/Level_<n>/<scene>_<Actor>_<nn>.mp3',
  // mentor hints '../SeqSounds/Mentor/<L01B01>.mp3')
  frameSound(sc, f) {
    const A = this.G.audio, C = this.G.campaign;
    let a = f.audio || (sc.mentor && sc.id ? sc.id : '');
    if (!a) return null;
    const ev = A && A.db && A.db.events && A.db.events[a.toLowerCase()];
    if (ev && ev.s && ev.s.length) return ev.s[0][0];
    a = a.replace(/^ds_/i, '');
    const folder = sc.mentor || /^(l\d+b\d+|counselor_)/i.test(a) ? 'Mentor' : C && C.id > 0 ? 'Level_' + C.id : '0_Tut_Level';
    return `../SeqSounds/${folder}/${a}.mp3`;
  }
  // play a speech file on the voice channel; the frame / line it belongs to is lengthened to the sound when it has
  // loaded. Missing file, no audio yet (no click so far) or sound off: silence, the text length stands.
  async speak(file, kind, holder, index) {
    const A = this.G.audio;
    if (!file || !A || !A.ctx || A.muted || !A.buffer || (this.G.settings && this.G.settings.sound === false)) return;
    let buf = null;
    try { buf = await A.buffer(file); } catch (e) { buf = null; }
    if (!buf || holder.i !== index || (kind === 'ds' ? this.scene !== holder : this.cine !== holder)) return;
    const src = await A.playFile(file, 100, null, 0, 'voice');
    if (!src) return;
    if (holder.i !== index || (kind === 'ds' ? this.scene !== holder : this.cine !== holder)) { try { src.stop(); } catch (e) { /* not started */ } return; }
    holder.sound = src; holder.playing = true;
    src.addEventListener('ended', () => { if (holder.sound === src) holder.playing = false; });
    holder.len = kind === 'ds' ? Math.max(holder.t + buf.duration, 0.25 * vowelGroups(holder.frames[index].text)) : holder.t + buf.duration + 0.4;
  }
  stopVoice(h) { if (h && h.sound) { try { h.sound.stop(); } catch (e) { /* already over */ } h.sound = null; h.playing = false; } }
  // sound and music are turned down while somebody speaks (DS:164-166, 50 %)
  duck(on) {
    const A = this.G.audio;
    if (!A || !A.ctx || !A.bus || !A.bus.sfx) return;
    try {
      A.bus.sfx.gain.setTargetAtTime((A.vol.sfx || 0) * (on ? 0.5 : 1), A.ctx.currentTime, 0.15);
      if (A.music) A.music.volume = A.muted ? 0 : A.vol.music * A.vol.master * (on ? 0.5 : 1);
    } catch (e) { /* ignore */ }
  }
  endScene() {
    const S = this.scene;
    if (!S) return;
    this.stopVoice(S);
    this.scene = null;
    const i = this.scenes.indexOf(S.q); if (i >= 0) this.scenes.splice(i, 1);
    if (this.dom) this.dlg.classList.add('hidden');
    if (!this.scenes.length) this.duck(false);
    this.log.push(['dialogEnd', S.scene && S.scene.id]);
    if (S.onEnd) S.onEnd();
  }
  // the close button of the dialogue box: the scene is over (DS:340-352 OnClose)
  closeDialog() { if (this.scene) this.endScene(); }

  // ------------------------------------------------------------------ cutscenes
  playSequence(seq, opts, onEnd) {
    this.log.push(['sequence', seq && seq.id]);
    this.seqs.push({ seq, opts: opts || {}, onEnd, n: this.seq_++ });
  }
  busy() { return this.seqs.length > 0; }
  speakerName(sp) { const c = cap(String(sp || '')); return c ? this.text('_ds_ACTOR_' + c, c) : ''; }
  // start the cutscenes that wait. One without lines (or without a file) is over at once; with ?manual every one is.
  pump() {
    const G = this.G;
    while (!this.cine && this.seqs.length) {
      const q = this.seqs[0], lines = (q.seq && q.seq.lines || []).filter((l) => l && l.text);
      if (this.manual || !lines.length || !this.dom) { this.seqs.shift(); this.log.push(['sequenceEnd', q.seq && q.seq.id]); if (q.onEnd) q.onEnd(); continue; }
      if (G.menuOpen || G.over) return;            // not under an open menu
      const cam = G.rtscam, to = q.opts.camera && Number.isFinite(q.opts.camera.x) ? q.opts.camera : null;
      this.cine = { ...q, q, lines, frames: lines, i: -1, t: 0, len: 0, sound: null, wasPaused: !!G.paused,
        cam: cam ? { x0: cam.x, z0: cam.z, x1: to ? to.x : cam.x, z1: to ? to.z : cam.z, t: to ? 0 : CAM_EASE } : null };
      G.setPaused(true);
      document.body.classList.add('cine');
      if (G.hud) { G.hud.hideTip(); if (G.hud.closeFlyout && G.hud.menu) G.hud.toggleMenu(G.hud.menu); }
      if (G.input) { G.input.keys = {}; if (G.input.mode && G.input.setMode) G.input.setMode(null); }
      if (G.updateFow) G.updateFow();               // what the engine revealed for the scene shows although the game stands still
      this.cineEl.querySelector('.ctitle').textContent = q.opts.title || '';
      this.cineEl.classList.remove('hidden');
      this.cineEl.offsetHeight;                     // (reflow: the bars slide in)
      this.cineEl.classList.add('on');
      this.duck(true);
      this.nextLine();
    }
  }
  nextLine() {
    const c = this.cine;
    this.stopVoice(c);
    c.i++;
    if (c.i >= c.lines.length) { this.endCine(); return; }
    const l = c.lines[c.i], text = String(l.text).replace(/\s*\n\s*/g, ' ');
    c.t = 0;
    c.len = Math.max(2.4, 1.2 + 0.062 * text.length);       // reading time; replaced by the speech length if there is a file
    this.log.push(['line', c.seq.id, c.i]);
    const ic = iconFor(l.speaker), por = this.cineEl.querySelector('.cpor');
    por.style.cssText = ic ? spriteCss(ic, 3, 51, 49) : 'display:none';
    this.cineEl.querySelector('.cname').textContent = l.speaker ? this.speakerName(l.speaker) + this.text('_NT_ACTOR_TEXT_SEPARATOR', ':') : '';
    this.cineEl.querySelector('.ctext').textContent = text;
    this.speak(this.lineSound(c.seq, l), 'seq', c, c.i);
  }
  // the speech file of a subtitle line: the sequence's speech entry '<...>/SeqSounds/Level_1/1040/1040_Stina_01.lsd'
  // (lip data, the .mp3 lies next to it) whose name is the line's key '_seq_1040_stina_01'
  lineSound(seq, l) {
    const key = String(l.key || '').toLowerCase().replace(/^_seq_/, '');
    if (!key) return null;
    for (const p of seq.speech || []) {
      const m = /SeqSounds\/(.*)\.(lsd|mp3|wav)$/i.exec(String(p).replace(/\\/g, '/'));
      if (m && m[1].split('/').pop().toLowerCase() === key) return `../SeqSounds/${m[1]}.mp3`;
    }
    return null;
  }
  // cutscene: the next line (click, Space) / the end of the scene (Esc)
  next() { if (this.cine) { this.sound('ui_click'); this.nextLine(); } }
  skip() { if (this.cine) this.endCine(); }
  endCine() {
    const G = this.G, c = this.cine;
    if (!c) return;
    this.stopVoice(c);
    this.cine = null;
    const i = this.seqs.indexOf(c.q); if (i >= 0) this.seqs.splice(i, 1);
    // G:1835-1853: the camera returns to where it was (snap_cam_back) or stays at the scene's place
    if (c.cam && G.rtscam) { G.rtscam.x = c.opts.snapBack ? c.cam.x0 : c.cam.x1; G.rtscam.z = c.opts.snapBack ? c.cam.z0 : c.cam.z1; }
    this.cineEl.classList.remove('on');
    this.cineEl.classList.add('hidden');
    document.body.classList.remove('cine');
    if (!this.scenes.length) this.duck(false);
    if (G.menuOpen && G.menu) G.menu.wasPaused = c.wasPaused; else G.setPaused(c.wasPaused);
    this.log.push(['sequenceEnd', c.seq && c.seq.id]);
    if (c.onEnd) c.onEnd();
  }
  updateCine(dt) {
    const G = this.G, c = this.cine;
    if (!c || G.menuOpen) return;
    if (c.cam && G.rtscam && c.cam.t < CAM_EASE) {
      c.cam.t = Math.min(CAM_EASE, c.cam.t + dt);
      const k = c.cam.t / CAM_EASE, e = k * k * (3 - 2 * k);
      G.rtscam.x = c.cam.x0 + (c.cam.x1 - c.cam.x0) * e;
      G.rtscam.z = c.cam.z0 + (c.cam.z1 - c.cam.z0) * e;
    }
    c.t += dt;
    if (c.t >= c.len && !(c.playing && c.t < c.len + 20)) this.nextLine();
  }

  // ------------------------------------------------------------------ mission title card
  showTitle() {
    const C = this.G.campaign, map = C && C.map;
    if (!this.dom || !map) return;
    this.titleEl.firstChild.textContent = map.title || map.name || '';
    this.titleEl.lastChild.textContent = map.description || '';
    this.titleEl.classList.remove('hidden', 'out');
    this.titleT = TITLE_TIME;
    this.log.push(['title', map.title || map.name]);
  }

  // ------------------------------------------------------------------ keyboard (ui/input.js onKey)
  // true = the key is used up. During a cutscene the player has no input: Space / Enter = next line, Esc = skip.
  key(e) {
    const G = this.G;
    if (this.cine) {
      if (G.menuOpen) return false;
      if (e.code === 'Escape') this.skip();
      else if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') this.next();
      else if (e.code === 'F10' || e.code === 'F9') return false;
      if (G.input) G.input.keys = {};
      if (e.preventDefault && e.code === 'Space') e.preventDefault();
      return true;
    }
    if (e.code === 'KeyL' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (this.logOpen) { this.closeLog(); return true; }
      if (!G.menuOpen) { this.openLog(); return true; }
    }
    return false;
  }

  // ------------------------------------------------------------------ time
  // game time, from the simulation step
  tick(dt) {
    this.pump();
    // dialogue scenes: one at a time, in the order asked for (DS:19-45)
    let guard = 0;
    while (!this.scene && this.scenes.length && guard++ < 64) this.startScene();
    const S = this.scene;
    if (S) {
      S.t += dt;
      // the frame is over when its time is up and its sound has ended (DS:372-375); a sound that never reports
      // its end does not hold the scene for ever
      if (S.t >= S.len && !(S.playing && S.t < S.len + 20)) this.nextFrame();
    }
    if (this.markers.length) {
      let gone = false;
      for (const m of this.markers) {
        m.age += dt;
        if (m.entity && m.entity.pos && m.entity.alive !== false) { m.x = m.entity.pos.x; m.z = m.entity.pos.z; }
        if (this.markerDone(m)) gone = true;
      }
      if (gone) this.markers = this.markers.filter((m) => !this.markerDone(m));
    }
  }
  // real time, once per drawn frame
  update(dt) {
    this.time += dt;
    if (!this.dom) return;
    this.pump();                                   // also while the game is paused
    this.updateCine(dt);
    for (let i = this.news_.length - 1; i >= 0; i--) {
      const n = this.news_[i];
      n.t -= dt;
      if (n.t <= 0) this.dropNews(n); else if (n.t < 1) n.el.classList.add('fade');
    }
    if (this.titleT > 0) {
      this.titleT -= dt;
      if (this.titleT <= 0) this.titleEl.classList.add('hidden'); else if (this.titleT < 1.2) this.titleEl.classList.add('out');
    }
    this.showTimers();
    this.updateRings();
    this.updateMarks(dt);
    this.layout();
  }
  // tests: end every running / queued scene and sequence now, in the order they were asked for
  skipAll() {
    let guard = 0;
    while ((this.scenes.length || this.seqs.length) && guard++ < 1000) {
      const d = this.scenes[0], s = this.seqs[0];
      if (d && (!s || d.n < s.n)) {
        if (this.scene && this.scene.q === d) this.endScene();
        else { this.scenes.shift(); this.log.push(['dialogEnd', d.scene && d.scene.id]); if (d.onEnd) d.onEnd(); }
      } else if (this.cine && this.cine.q === s) this.endCine();
      else { this.seqs.shift(); this.log.push(['sequenceEnd', s.seq && s.seq.id]); if (s.onEnd) s.onEnd(); }
    }
  }
}

let ringGeo = null;
function RING() { return ringGeo || (ringGeo = new THREE.RingGeometry(0.86, 1.0, 48).rotateX(-Math.PI / 2)); }

// the floating mark, drawn once per state (the original models questionmark_* / exclamation_yellow are not in the
// built assets)
const markTex = {};
function markTexture(state) {
  if (markTex[state]) return markTex[state];
  const [glyph, fill, dark] = QMARK[state];
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 8, 64, 64, 62);
  g.addColorStop(0, fill + '66'); g.addColorStop(1, fill + '00');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  x.font = 'bold 112px Georgia, "Times New Roman", serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round';
  x.lineWidth = 14; x.strokeStyle = '#000'; x.strokeText(glyph, 64, 70);
  x.lineWidth = 7; x.strokeStyle = dark; x.strokeText(glyph, 64, 70);
  const f = x.createLinearGradient(0, 16, 0, 116);
  f.addColorStop(0, '#fff'); f.addColorStop(0.25, fill); f.addColorStop(1, dark);
  x.fillStyle = f; x.fillText(glyph, 64, 70);
  const t = new THREE.CanvasTexture(c);
  if ('colorSpace' in t && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  return (markTex[state] = t);
}
