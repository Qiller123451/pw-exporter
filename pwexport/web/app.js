// ParaWorld Model & Map Exporter - the browser side. Talks to the local Python server (pwexport/app.py) over /api/*.
import { Viewer } from './viewer.js';
import { STRINGS } from './i18n.js';
import * as P from './parts.js';
import { MapView } from './mapview.js';

const $ = (s) => document.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const api = {
  get: async (u) => { const r = await fetch(u); const j = await r.json(); if (j && j.error) throw new Error(j.error); return j; },
  raw: async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + ': ' + r.status); return { data: await r.arrayBuffer(), grid: (r.headers.get('X-Grid') || '0 0').split(' ').map(Number) }; },
  post: async (u, d) => { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d || {}) }); return r.json(); },
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// player colours of the game (Scripts/Game/misc/ACColors.txt, the "light" set)
const PARTY = [[255, 232, 128], [225, 85, 85], [115, 229, 229], [121, 161, 242], [121, 242, 121], [153, 102, 204], [242, 121, 202], [242, 161, 121]];
const TRIBE_ORDER = ['Hu', 'Aje', 'Ninigi', 'SEAS', 'World', 'Special'];
const TYPE_ORDER = ['CHTR', 'ANML', 'VHCL', 'SHIP', 'BLDG'];
const KIND_ORDER = ['rider', 'turret', 'buildup', 'drawbar', 'wagon', 'other', 'weapon', 'tool', 'container'];

let S = STRINGS.en;
let ST = null;                  // /api/state
let CAT = null;                 // /api/catalog
let MODELS = null;              // /api/models (raw list)
let MAPS = null;                // /api/maps
let mapView = null;             // the map shown (mapview.js)
const modelInfo = new Map();    // "name|archive" -> /api/model result
let viewer = null;
const cur = {
  mode: 'units', tribe: null, type: null, archive: '', q: '',
  entry: null, raw: null, level: 1, modelIdx: 0,
  addons: new Map(),            // addon id -> {on, variant}
  state: null,                  // parts state of the main model
  party: null, anim: null, partAnim: {}, seamless: true,
  exp: { format: 'glb', animations: 'all', name: '' },
  map: null,                    // /api/map result of the map shown
  mapLayers: { objects: true, plants: false, water: true, markers: false, tiles: true },
  mapExp: { format: 'glb', objects: true, plants: false, step: 2, extras: ['heightmap', 'csv'] },
};

// ------------------------------------------------------------------ start
async function init() {
  ST = await api.get('/api/state');
  setUiLang(ST.settings.ui_lang || 'en');
  viewer = new Viewer($('#view'));
  viewer.onTime = onTime;
  window.PWX = { get viewer() { return viewer; }, get map() { return mapView; }, get cur() { return cur; } };   // for tests and the console
  wireStatic();
  if (!ST.configured) return showSetup();
  if (!ST.progress.ready) return showLoading();
  await loadCatalog();
}

function setUiLang(l) {
  S = STRINGS[l] || STRINGS.en;
  document.documentElement.lang = l;
  document.title = S.title;
  $('#t-title').textContent = S.title;
  $('#tab-units').textContent = S.units; $('#tab-models').textContent = S.allModels; $('#tab-maps').textContent = S.maps;
  $('#btn-home').title = S.launcher;
  $('#search').placeholder = S.search;
  $('#tb-frame').textContent = S.frame; $('#tb-shot').textContent = S.shot;
  $('#tb-grid-l').textContent = S.grid; $('#tb-wire-l').textContent = S.wire; $('#tb-bones-l').textContent = S.bones;
  for (const k of ['tex', 'cloth', 'links', 'coll', 'normals']) { $('#tb-' + k + '-l').textContent = S['tb_' + k]; $('#tb-' + k).parentNode.title = S['tb_' + k + '_t']; }
  $('#tb-rot-l').textContent = S.autorotate; $('#tb-bg-l').textContent = S.bg;
  $('#pl-loop-l').textContent = S.loop; $('#pl-seam-l').textContent = S.seamless;
  $('#hint').textContent = S.help; $('#empty').textContent = S.pick;
  $('#btn-settings').title = S.settings; $('#btn-about').title = S.about;
  const q = $('#lang-quick');
  q.innerHTML = '';
  for (const [id, name] of [['en', 'English'], ['de', 'Deutsch']]) q.append(el('option', { value: id, selected: id === l }, name));
}

function wireStatic() {
  $('#lang-quick').onchange = async (e) => {
    const l = e.target.value;
    const names = l === 'de' ? 'de' : 'uk';
    await api.post('/api/settings', { ui_lang: l, lang: ST.langs.some((x) => x.id === names) ? names : ST.settings.lang });
    ST = await api.get('/api/state');
    setUiLang(l);
    await loadCatalog(true);
  };
  for (const b of document.querySelectorAll('.tabs button')) b.onclick = async () => { cur.mode = b.dataset.tab; if (cur.mode === 'maps' && !MAPS) await loadMaps(); renderExplorer(); };
  if (ST.launcher) $('#btn-home').classList.remove('hidden');
  $('#search').oninput = (e) => { cur.q = e.target.value.trim().toLowerCase(); renderList(); };
  $('#f-archive').onchange = (e) => { cur.archive = e.target.value; renderList(); };
  $('#tb-frame').onclick = () => viewer.frame();
  $('#tb-grid').onchange = (e) => viewer.setGrid(e.target.checked);
  $('#tb-wire').onchange = (e) => viewer.wire(e.target.checked);
  $('#tb-bones').onchange = (e) => viewer.bones(e.target.checked);
  $('#tb-tex').onchange = (e) => viewer.setOpt('texture', e.target.checked);
  $('#tb-cloth').onchange = (e) => viewer.setOpt('cloth', e.target.checked);
  $('#tb-links').onchange = (e) => viewer.setOpt('links', e.target.checked);
  $('#tb-coll').onchange = (e) => viewer.setOpt('coll', e.target.checked);
  $('#tb-normals').onchange = (e) => viewer.setOpt('normals', e.target.checked);
  $('#tb-rot').onchange = (e) => { viewer.autoRotate = e.target.checked; if (!e.target.checked) viewer.root.rotation.y = 0; };
  $('#tb-bg').onchange = (e) => viewer.setBackground(e.target.checked);
  $('#tb-shot').onclick = () => { const a = el('a', { href: viewer.screenshot(), download: (cur.exp.name || 'paraworld') + '.png' }); a.click(); };
  $('#pl-play').onclick = () => { viewer.playing = !viewer.playing; $('#pl-play').textContent = viewer.playing ? '❚❚' : '▶'; };
  $('#pl-time').oninput = (e) => { viewer.playing = false; $('#pl-play').textContent = '▶'; viewer.seek(+e.target.value * viewer.duration); };
  $('#pl-speed').onchange = (e) => { viewer.speed = +e.target.value; };
  $('#pl-loop').onchange = (e) => viewer.setLoop(e.target.checked);
  $('#pl-seam').onchange = (e) => { cur.seamless = e.target.checked; playMain(cur.anim); };
  $('#btn-settings').onclick = showSettings;
  $('#btn-about').onclick = showAbout;
}

function onTime(t, d) {
  const r = $('#pl-time');
  if (d > 0) { if (document.activeElement !== r) r.value = String(t / d); $('#pl-clock').textContent = `${t.toFixed(2)} / ${d.toFixed(2)} s`; }
  else { $('#pl-clock').textContent = S.restPose; }
}

// ------------------------------------------------------------------ setup / loading
function showSetup(err) {
  const m = $('#setup'), c = $('#setup-card');
  m.classList.remove('hidden');
  let lang = ST.settings.ui_lang || 'en';
  let path = ST.settings.install || (ST.candidates[0] || '');
  const draw = () => {
    setUiLang(lang);
    c.innerHTML = '';
    c.append(el('h1', {}, el('img', { src: 'icon.svg', alt: '' }), S.welcome));
    c.append(el('p', { text: S.welcomeText }));
    c.append(el('h4', { text: S.chooseLang }), el('p', { class: 'note', text: S.langHint }));
    const langs = el('div', { class: 'langs' });
    for (const [id, name] of [['en', 'English'], ['de', 'Deutsch']]) langs.append(el('button', { class: id === lang ? 'on' : '', onclick: () => { lang = id; draw(); } }, name));
    c.append(langs);
    c.append(el('h4', { text: S.chooseFolder }), el('p', { class: 'note', text: S.folderHint }));
    const inp = el('input', { type: 'text', value: path, spellcheck: 'false', oninput: (e) => { path = e.target.value; } });
    c.append(el('div', { class: 'pathrow' }, inp, el('button', { onclick: async () => {
      const r = await api.post('/api/browse', { title: S.chooseFolder, initial: path });
      if (r.path) { path = r.path; inp.value = path; }
    } }, S.browse)));
    if (ST.candidates.length) {
      c.append(el('p', { class: 'note', text: S.found }));
      const cs = el('div', { class: 'cands' });
      for (const p of ST.candidates) cs.append(el('button', { onclick: () => { path = p; inp.value = p; } }, p));
      c.append(cs);
    }
    const er = el('div', { class: 'err', text: err || '' });
    c.append(er);
    c.append(el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: async () => {
      const r = await api.post('/api/setup', { install: path, ui_lang: lang, lang: lang === 'de' ? 'de' : 'uk' });
      if (!r.ok) { er.textContent = S.notParaworld; return; }
      ST = await api.get('/api/state');
      showLoading();
    } }, S.continue)));
  };
  draw();
}

async function showLoading() {
  const m = $('#setup'), c = $('#setup-card');
  m.classList.remove('hidden');
  c.innerHTML = '';
  const bar = el('div'), txt = el('p', { class: 'note' });
  c.append(el('h1', {}, el('img', { src: 'icon.svg', alt: '' }), S.loading), el('div', { class: 'progress' }, bar), txt, el('p', { class: 'note', text: S.loadingFirst }));
  for (;;) {
    const st = await api.get('/api/state');
    const p = st.progress;
    bar.style.width = Math.round((p.frac || 0) * 100) + '%';
    txt.textContent = p.stage || '';
    if (p.error) { ST = st; return showSetup(p.error); }
    if (p.ready) { ST = st; break; }
    await new Promise((r) => setTimeout(r, 400));
  }
  m.classList.add('hidden');
  await loadCatalog();
}

async function loadCatalog(keepSelection) {
  CAT = await api.get('/api/catalog');
  if (!CAT.ready) return showLoading();
  if (!MODELS) MODELS = await api.get('/api/models');
  renderExplorer();
  if (keepSelection && cur.entry) { const e = CAT.entries.find((x) => x.id === cur.entry.id); if (e) { cur.entry = e; renderDetails(); } }
}

// ------------------------------------------------------------------ explorer
function renderExplorer() {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === cur.mode);
  const ft = $('#f-tribe'), fy = $('#f-type'), fa = $('#f-archive');
  ft.innerHTML = ''; fy.innerHTML = '';
  if (cur.mode === 'units') {
    fa.classList.add('hidden'); ft.classList.remove('hidden'); fy.classList.remove('hidden');
    ft.append(chip(S.all, !cur.tribe, () => { cur.tribe = null; renderExplorer(); }));
    for (const t of TRIBE_ORDER) ft.append(chip(tribeName(t), cur.tribe === t, () => { cur.tribe = t; renderExplorer(); }, 't-' + t));
    fy.append(chip(S.all, !cur.type, () => { cur.type = null; renderExplorer(); }));
    for (const t of TYPE_ORDER) fy.append(chip(S.types[t], cur.type === t, () => { cur.type = t; renderExplorer(); }));
  } else if (cur.mode === 'maps') {
    ft.classList.add('hidden'); fy.classList.add('hidden'); fa.classList.add('hidden');
  } else {
    ft.classList.add('hidden'); fy.classList.add('hidden'); fa.classList.remove('hidden');
    const arch = [...new Set(MODELS.map((m) => m.archive))].sort();
    fa.innerHTML = '';
    fa.append(el('option', { value: '' }, S.all + ` (${MODELS.length})`));
    for (const a of arch) fa.append(el('option', { value: a, selected: a === cur.archive }, a));
  }
  renderList();
}
function chip(label, on, fn, dot) {
  const b = el('button', { class: on ? 'on' : '', onclick: fn });
  if (dot) b.append(el('span', { class: 'dot ' + dot, style: 'display:inline-block;margin-right:5px;vertical-align:middle' }));
  b.append(label);
  return b;
}
function tribeName(t) { return S.tribes[t] || t; }

function renderList() {
  const ul = $('#list');
  ul.innerHTML = '';
  const q = cur.q;
  if (cur.mode === 'units') {
    const all = CAT.entries;
    const list = all.filter((e) => (!cur.tribe || e.tribe === cur.tribe) && (!cur.type || e.type === cur.type) &&
      (!q || [e.name, e.id, ...Object.values(e.names || {})].some((s) => String(s).toLowerCase().includes(q))));
    $('#count').textContent = S.showing(list.length, all.length);
    for (const e of list.slice(0, 1500)) {
      const li = el('li', { class: cur.entry && cur.entry.id === e.id && !cur.raw ? 'on' : '', onclick: () => selectEntry(e) },
        el('span', { class: 'dot t-' + e.tribe }),
        el('div', { class: 'nm' }, el('b', { text: e.name }), el('small', { text: e.id })),
        el('span', { class: 'badge', text: S.typeOne[e.type] || e.type }));
      ul.append(li);
    }
  } else if (cur.mode === 'maps') {
    const all = MAPS || [];
    const list = all.filter((m) => !q || [m.name, m.rel, m.pack].some((x) => String(x || '').toLowerCase().includes(q)));
    $('#count').textContent = S.showing(list.length, all.length);
    for (const m of list) {
      const li = el('li', { class: cur.map && cur.map.id === m.id ? 'on' : '', onclick: () => selectMap(m) },
        el('span', { class: 'dot t-none' }),
        el('div', { class: 'nm' }, el('b', { text: m.name || m.rel }), el('small', { text: `${m.pack} · ${m.rel}` })),
        el('span', { class: 'badge', text: m.error ? '!' : `${m.players || '?'}P · ${m.w}×${m.h}` }));
      ul.append(li);
    }
  } else {
    const list = MODELS.filter((m) => (!cur.archive || m.archive === cur.archive) && (!q || m.name.toLowerCase().includes(q)));
    $('#count').textContent = S.showing(Math.min(list.length, 2000), list.length);
    for (const m of list.slice(0, 2000)) {
      const li = el('li', { class: cur.raw && cur.raw.name === m.name && cur.raw.archive === m.archive ? 'on' : '', onclick: () => selectRaw(m) },
        el('span', { class: 'dot t-none' }),
        el('div', { class: 'nm' }, el('b', { text: m.name }), el('small', { text: m.archive + (m.mod !== 'Base' ? ' · ' + m.mod : '') + (m.anims ? ` · ${m.anims} anim.` : '') })),
        el('span', { class: 'badge', text: m.fourcc }));
      ul.append(li);
    }
  }
}

// ------------------------------------------------------------------ selection
function selectEntry(e) {
  leaveMap();
  cur.entry = e; cur.raw = null; cur.modelIdx = 0; cur.level = 1; cur.anim = null; cur.partAnim = {}; cur.state = null;
  cur.addons = new Map(e.addons.map((a) => [a.id, { on: a.default, variant: null }]));
  cur.exp.name = e.id;
  renderList();
  refresh(false);
}
function selectRaw(m) {
  leaveMap();
  cur.raw = m; cur.entry = null; cur.anim = null; cur.partAnim = {}; cur.state = null; cur.addons = new Map();
  cur.exp.name = m.name;
  renderList();
  refresh(false);
}

async function info(name, archive) {
  const k = name + '|' + (archive || '');
  if (!modelInfo.has(k)) modelInfo.set(k, api.get('/api/model?name=' + encodeURIComponent(name) + (archive ? '&archive=' + encodeURIComponent(archive) : '')));
  return modelInfo.get(k);
}

// the parts to show: main model + active add-ons, each {model, archive, parent, link, anim, addon}
function wantedParts() {
  if (cur.raw) return [{ model: cur.raw.name, archive: cur.raw.archive, parent: null, link: null }];
  const e = cur.entry;
  const main = e.models[Math.min(cur.modelIdx, e.models.length - 1)];
  const out = [{ model: main.gfx, parent: null, link: null }];
  const placed = new Map();
  for (const a of e.addons) {
    const st = cur.addons.get(a.id);
    if (!st || !st.on) continue;
    if (a.pi >= 0 && !placed.has(a.pi)) continue;
    out.push({ model: addonGfx(a, st), parent: a.pi >= 0 ? placed.get(a.pi) : 0, link: a.link, addon: a });
    placed.set(a.id, out.length - 1);
  }
  return out;
}
function addonGfx(a, st) {
  if (st && st.variant) return st.variant;
  const v = a.variants || [];
  if ((a.by === 'level' || (a.kind === 'rider' && v.length > 1)) && v.length) return v[Math.min(cur.level, v.length) - 1];
  return a.gfx;
}

let refreshing = 0;
async function refresh(keepCamera = true) {
  const my = ++refreshing;
  $('#empty').classList.add('hidden');
  const parts = wantedParts();
  $('#busy').classList.remove('hidden'); $('#busy-text').textContent = S.converting;
  let infos;
  try { infos = await Promise.all(parts.map((p) => info(p.model, p.archive))); } catch (err) {
    $('#busy').classList.add('hidden'); toast(String(err.message || err)); return;
  }
  if (my !== refreshing) return;
  parts.forEach((p, i) => { p.info = infos[i]; p.url = infos[i].url; });
  // keep the state of the main model's parts while only add-ons change
  const keepState = cur.state && cur.stateFor === parts[0].model;
  await viewer.show(parts.map((p, i) => ({ url: p.url, parent: p.parent, link: p.link, state: i === 0 && keepState ? cur.state : null })), keepCamera && cur.lastMain === parts[0].model);
  $('#busy').classList.add('hidden');
  cur.lastMain = parts[0].model;
  cur.parts = parts;
  if (!keepState) { cur.state = viewer.parts[0].state; cur.stateFor = parts[0].model; }
  if (cur.party) viewer.setParty(cur.party.map((x) => x / 255));
  // animations: keep the current one if the model has it
  const names = infos[0].anims.map((a) => a.name);
  if (!cur.anim || !names.includes(cur.anim)) cur.anim = ['standanim', 'idle', 'standing', 'swim_1', 'walk_1'].find((n) => names.includes(n)) || null;
  playMain(cur.anim);
  parts.forEach((p, i) => { if (i) viewer.play(i, partAnimName(i, p)); });
  renderDetails();
}
function partAnimName(i, p) {
  const names = p.info.anims.map((a) => a.name);
  const want = cur.partAnim[p.model] || (p.addon && p.addon.anim);
  return [want, 'ride_idle_0', 'balista_stand', 'standanim', 'swim_1', 'idle'].find((n) => n && names.includes(n)) || null;
}
function playMain(name) {
  cur.anim = name;
  const inf = cur.parts && cur.parts[0].info;
  const loop = name && cur.seamless && inf && inf.loops && inf.loops[name] ? inf.loops[name] : null;
  viewer.play(0, name, loop);
  $('#player').classList.toggle('hidden', !inf);
  $('#pl-seam-w').classList.toggle('hidden', !(name && inf && inf.loops && inf.loops[name]));
  viewer.playing = true; $('#pl-play').textContent = '❚❚';
  for (const b of document.querySelectorAll('.anims button')) b.classList.toggle('on', b.dataset.name === (name || ''));
}

// ------------------------------------------------------------------ details panel
function renderDetails() {
  const e = cur.entry, inf = cur.parts && cur.parts[0].info;
  const head = $('#d-head');
  head.innerHTML = '';
  if (e) {
    head.append(el('h2', { text: e.name }));
    head.append(el('div', { class: 'sub' }, el('span', { class: 'dot t-' + e.tribe }), tribeName(e.tribe), ' · ', S.typeOne[e.type] || e.type, ' · ', el('code', { text: e.id })));
    const others = Object.entries(e.names || {}).filter(([, n]) => n !== e.name).map(([, n]) => n);
    if (others.length) head.append(el('div', { class: 'sub', text: '= ' + [...new Set(others)].join(' / ') }));
    if (e.desc) head.append(el('p', { text: e.desc.replace(/\n\s*\n/g, '\n') }));
  } else if (cur.raw) {
    head.append(el('h2', { text: cur.raw.name }));
    head.append(el('div', { class: 'sub', text: `${cur.raw.archive}.gsf · ${cur.raw.mod} · ${cur.raw.fourcc}` }));
  }
  renderModelSect(); renderAddons(); renderParts(); renderAnims(); renderExport();
}

function renderModelSect() {
  const s = $('#s-model'); s.innerHTML = '';
  const e = cur.entry;
  if (!e) return;
  s.append(el('h3', { text: S.model }));
  if (e.models.length > 1) {
    const sel = el('select', { onchange: (ev) => {
      cur.modelIdx = +ev.target.value;
      const m = /level (\d)/.exec(e.models[cur.modelIdx].label || ''); if (m) cur.level = +m[1]; else if (!cur.modelIdx) cur.level = 1;
      refresh();
    } });
    e.models.forEach((m, i) => sel.append(el('option', { value: i, selected: i === cur.modelIdx }, modelLabel(m, i))));
    s.append(el('div', { class: 'row' }, el('label', { text: S.model }), sel));
  } else s.append(el('div', { class: 'row' }, el('label', { text: S.model }), el('code', { text: e.models[0].gfx })));
  const hasLevels = e.addons.some((a) => a.by === 'level' || a.kind === 'rider' && a.variants.length > 1 || a.level);
  if (hasLevels) {
    const lv = el('select', { onchange: (ev) => {
      cur.level = +ev.target.value;
      // weapons follow the level: the best weapon the unit has at that level, per hand
      const best = new Map();
      for (const a of e.addons) if (a.kind === 'weapon' && a.level && a.level <= cur.level && !/wild/i.test(a.when)) best.set(a.slot, a);
      for (const a of e.addons) if (a.kind === 'weapon' && a.level) cur.addons.get(a.id).on = best.get(a.slot) === a;
      const mi = e.models.findIndex((m) => m.label === 'level ' + cur.level);
      cur.modelIdx = mi >= 0 ? mi : (cur.level === 1 ? 0 : cur.modelIdx);
      refresh();
    } });
    for (let l = 1; l <= 5; l++) lv.append(el('option', { value: l, selected: l === cur.level }, String(l)));
    s.append(el('div', { class: 'row' }, el('label', { text: S.level }), lv));
  }
}
function modelLabel(m, i) {
  const lv = /level (\d)/.exec(m.label || '');
  if (lv) return `${S.level} ${lv[1]} – ${m.gfx}`;
  if (!m.label) return (cur.entry.models.length > 1 ? `${S.level} 1 – ` : '') + m.gfx;
  return `${m.label} – ${m.gfx}`;
}

function renderAddons() {
  const s = $('#s-addons'); s.innerHTML = '';
  const e = cur.entry;
  if (!e) return;
  s.append(el('h3', { text: S.addons }));
  if (!e.addons.length) { s.append(el('div', { class: 'note', text: S.noAddons })); return; }
  for (const kind of KIND_ORDER) {
    const list = e.addons.filter((a) => a.kind === kind);
    if (!list.length) continue;
    s.append(el('div', { class: 'grp', text: S.kinds[kind] || kind }));
    for (const a of list) {
      const st = cur.addons.get(a.id);
      const cb = el('input', { type: 'checkbox', checked: st.on, onchange: (ev) => {
        st.on = ev.target.checked;
        if (st.on && a.needs_model) { const mi = e.models.findIndex((m) => m.gfx.toLowerCase() === a.needs_model.toLowerCase()); if (mi >= 0) cur.modelIdx = mi; }
        if (st.on) for (const b of e.addons) if (b !== a && b.slot === a.slot && b.kind !== 'rider') cur.addons.get(b.id).on = false;   // one part per attachment point
        if (a.kind === 'buildup') {
          // parts that depend on the mounted build-up (its rider seat, its flag) follow it, like in the game
          const on = new Set(e.addons.filter((b) => b.kind === 'buildup' && cur.addons.get(b.id).on).map((b) => b.id));
          for (const b of e.addons) {
            if (b.cond === 'buildup') cur.addons.get(b.id).on = (b.arg || []).some((i) => on.has(i));
            else if (b.cond === 'unless') cur.addons.get(b.id).on = !(b.arg || []).some((i) => on.has(i));
          }
        }
        refresh();
      } });
      const lab = el('label', { class: 'chk', title: S.when + a.when + (a.parent ? ` (→ ${a.parent})` : '') + ` @ ${a.link}` }, cb, el('span', {}, a.gfx, ' ', el('small', { text: '@' + a.link })));
      if (a.variants.length > 1) {
        const sel = el('select', { onclick: (ev) => ev.stopPropagation(), onchange: (ev) => { st.variant = ev.target.value || null; if (!st.on) { st.on = true; } refresh(); } });
        sel.append(el('option', { value: '' }, a.by === 'level' || a.kind === 'rider' ? `${S.level} ${cur.level}` : a.by === 'epoch' ? S.epoch + ' I' : 'auto'));
        for (const v of a.variants) sel.append(el('option', { value: v, selected: st.variant === v }, v));
        lab.append(sel);
      }
      s.append(lab);
    }
  }
}

function renderParts() {
  const s = $('#s-parts'); s.innerHTML = '';
  const vp = viewer.parts[0];
  if (!vp) return;
  const inf = vp.info, st = vp.state;
  const upd = () => { viewer.applyState(0); cur.state = st; renderVis(); };
  const body = [];
  if (inf.dynamic) {
    for (const b of inf.flags.filter((x) => x < 20)) {
      const label = (vp.fourcc === 'Anim' && S.flags[b]) || P.flagName(vp.fourcc, b) || S.flags[b] || `Flag ${b}`;
      body.push(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: st.flags[b] !== false, onchange: (ev) => { st.flags[b] = ev.target.checked; upd(); } }), el('span', { text: label })));
    }
    const w = inf.flags.filter((x) => x >= 20);
    if (w.length) body.push(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: w.some((b) => st.flags[b]), onchange: (ev) => { for (const b of w) st.flags[b] = ev.target.checked; upd(); } }), el('span', { text: `${S.wounds} (${w.length})` })));
  } else {
    if (inf.stages) {
      const sel = el('select', { onchange: (ev) => { st.level = +ev.target.value; upd(); } });
      S.stages.forEach((n, i) => sel.append(el('option', { value: i, selected: i === st.level }, n)));
      body.push(el('div', { class: 'row' }, el('label', { text: S.stage }), sel));
    }
    if (inf.damage) {
      const sel = el('select', { onchange: (ev) => { st.dmg = +ev.target.value; upd(); } });
      S.conditions.forEach((n, i) => sel.append(el('option', { value: i, selected: i === st.dmg }, n)));
      body.push(el('div', { class: 'row' }, el('label', { text: S.condition }), sel));
    }
    if (inf.ages.length > 1) {
      const sel = el('select', { onchange: (ev) => { st.age = +ev.target.value; upd(); } });
      for (const a of inf.ages) sel.append(el('option', { value: a, selected: a === st.age }, ['I', 'II', 'III', 'IV', 'V'][a - 1]));
      body.push(el('div', { class: 'row' }, el('label', { text: S.epoch }), sel));
    }
    if (inf.res && inf.res.length > 1) {
      const sel = el('select', { onchange: (ev) => { st.res = +ev.target.value; upd(); } });
      for (const r of inf.res) sel.append(el('option', { value: r, selected: r === st.res }, `${r} / ${Math.max(...inf.res)}`));
      body.push(el('div', { class: 'row' }, el('label', { text: S.resLeft }), sel));
    }
    if (inf.night) body.push(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: st.night, onchange: (ev) => { st.night = ev.target.checked; upd(); } }), el('span', { text: S.night })));
  }
  if (inf.fx) body.push(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: st.fx, onchange: (ev) => { st.fx = ev.target.checked; upd(); } }), el('span', { text: S.fx })));
  if (inf.helpers) body.push(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: st.helpers, onchange: (ev) => { st.helpers = ev.target.checked; upd(); } }), el('span', { text: S.helpers })));
  // player colour
  const sw = el('div', { class: 'swatches' });
  sw.append(el('button', { class: 'none' + (!cur.party ? ' on' : ''), title: S.none, onclick: () => { cur.party = null; viewer.setParty(null); renderParts(); } }));
  for (const c of PARTY) sw.append(el('button', { class: cur.party === c ? 'on' : '', style: `background:rgb(${c})`, onclick: () => { cur.party = c; viewer.setParty(c.map((x) => x / 255)); renderParts(); } }));
  body.push(el('div', { class: 'row' }, el('label', { text: S.party }), sw));
  s.append(el('h3', { text: S.parts }), ...body);
  renderVis();
}

// Visibility: the raw attribute bits of the main model's mesh chunks, named per model type (parts.js FLAGS), and the
// level of detail. Overrides on top of Model Parts: unticking hides every chunk with that bit, ticking shows them.
function renderVis() {
  const s = $('#s-vis'); s.innerHTML = '';
  const vp = viewer.parts[0];
  if (!vp || cur.map) return;
  const inf = vp.info, st = vp.state;
  st.vis = st.vis || {};
  const upd = () => { viewer.applyState(0); cur.state = st; renderVis(); };
  const head = el('h3', {}, el('span', { text: S.visibility }));
  if (Object.keys(st.vis).length || st.lod) head.append(el('button', { class: 'link', text: S.reset, onclick: () => { st.vis = {}; st.lod = 0; upd(); } }));
  s.append(head);
  if (inf.lods.length > 1) {
    const row = el('div', { class: 'lods' });
    for (const k of inf.lods) row.append(el('button', { class: (st.lod || 0) === k ? 'on' : '', text: String(k), title: S.lodTip(k), onclick: () => { st.lod = k; upd(); } }));
    s.append(el('div', { class: 'row' }, el('label', { text: S.lod }), row));
  }
  // which chunks with each bit are shown now
  const shown = new Map();
  for (const n of P.flagged(vp.obj)) {
    const a = n.userData.attr >>> 0;
    for (const [b] of inf.bits) if ((a >>> b) & 1) { const e = shown.get(b) || [0, 0]; e[0]++; if (n.visible) e[1]++; shown.set(b, e); }
  }
  for (const [b, count] of inf.bits) {
    const [tot, on] = shown.get(b) || [count, 0];
    const forced = st.vis[b];
    const cb = el('input', { type: 'checkbox', checked: forced !== undefined ? forced : on > 0, onchange: (ev) => { st.vis[b] = ev.target.checked; upd(); } });
    if (forced === undefined && on > 0 && on < tot) cb.indeterminate = true;
    const name = P.flagName(vp.fourcc, b) || S.unknownBit;
    s.append(el('label', { class: 'chk' + (forced !== undefined ? ' forced' : ''), title: S.visTip(b, tot, on) }, cb, el('span', { text: name }), el('small', { text: `bit ${b} · ${tot}` })));
  }
  if (!inf.bits.length && inf.lods.length <= 1) s.append(el('div', { class: 'note', text: S.visNone }));
  s.append(el('div', { class: 'note', text: S.visNote(vp.fourcc || '?') }));
}

function renderAnims() {
  const s = $('#s-anims'); s.innerHTML = '';
  const parts = cur.parts;
  if (!parts) return;
  const anims = parts[0].info.anims;
  s.append(el('h3', {}, S.animations, el('small', { text: anims.length ? String(anims.length) : '' })));
  if (!anims.length) s.append(el('div', { class: 'note', text: S.noAnims }));
  else {
    const filter = el('input', { type: 'search', placeholder: S.filterAnims, style: 'width:100%' });
    const box = el('div', { class: 'anims' });
    const draw = () => {
      box.innerHTML = '';
      const q = filter.value.toLowerCase();
      box.append(el('button', { 'data-name': '', class: !cur.anim ? 'on' : '', onclick: () => playMain(null) }, el('i', { text: S.restPose })));
      for (const a of anims) if (!q || a.name.toLowerCase().includes(q)) box.append(el('button', { 'data-name': a.name, class: a.name === cur.anim ? 'on' : '', onclick: () => playMain(a.name) }, a.name, el('small', { text: a.duration.toFixed(2) + ' s' })));
    };
    filter.oninput = draw; draw();
    s.append(filter, box);
  }
  // what the add-ons play
  parts.forEach((p, i) => {
    if (!i || !p.info.anims.length) return;
    const sel = el('select', { onchange: (ev) => { cur.partAnim[p.model] = ev.target.value; viewer.play(i, ev.target.value || null); } });
    const now = partAnimName(i, p);
    sel.append(el('option', { value: '' }, S.restPose));
    for (const a of p.info.anims) sel.append(el('option', { value: a.name, selected: a.name === now }, a.name));
    s.append(el('div', { class: 'row' }, el('label', { text: p.model, title: p.model, style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px' }), sel));
  });
}

function renderExport() {
  const s = $('#s-export'); s.innerHTML = '';
  if (!cur.parts) return;
  const X = cur.exp;
  s.append(el('h3', { text: S.export }));
  const fmt = el('select', { onchange: (ev) => { X.format = ev.target.value; renderExport(); } });
  for (const f of CAT.formats) {
    const off = f.blender && !ST.blender;
    fmt.append(el('option', { value: f.id, selected: f.id === X.format, disabled: off }, f.label + (off ? ` (${S.blenderNeeded})` : '')));
  }
  s.append(el('div', { class: 'row' }, el('label', { text: S.format }), fmt));
  const F = CAT.formats.find((f) => f.id === X.format) || {};
  if (F.animated) {
    const an = el('select', { onchange: (ev) => { X.animations = ev.target.value; } });
    for (const [v, l] of [['all', S.animAll], ['selected', S.animSel], ['none', S.animNone]]) an.append(el('option', { value: v, selected: v === X.animations }, l));
    s.append(el('div', { class: 'row' }, el('label', { text: S.anims }), an));
  } else s.append(el('div', { class: 'note', text: S.staticNote }));
  s.append(el('div', { class: 'row' }, el('label', { text: S.fileName }), el('input', { type: 'text', value: X.name, style: 'flex:1', oninput: (ev) => { X.name = ev.target.value; } })));
  const folder = el('span', { class: 'folder', text: ST.settings.export_dir || '' });
  s.append(el('div', { class: 'row' }, el('label', { text: S.folder }), folder, el('button', { onclick: async () => {
    const r = await api.post('/api/browse', { title: S.folder, initial: ST.settings.export_dir });
    if (r.path) { await api.post('/api/settings', { export_dir: r.path }); ST.settings.export_dir = r.path; folder.textContent = r.path; }
  } }, S.change)));
  const res = el('div', { class: 'result' });
  const go = el('button', { class: 'primary', id: 'exp-go', onclick: async () => {
    go.disabled = true; go.textContent = S.exporting; res.className = 'result'; res.textContent = '';
    const parts = cur.parts.map((p, i) => ({ model: p.model, archive: p.info.archive, parent: p.parent, link: p.link,
      hide: viewer.parts[i] ? viewer.parts[i].hidden : [], anim: i ? (viewer.parts[i] && viewer.parts[i].clipName) : null }));
    const inf = cur.parts[0].info;
    const r = await api.post('/api/export', { parts, format: X.format, animations: F.animated ? X.animations : 'selected', anim: cur.anim,
      time: viewer.time, loop: cur.anim && cur.seamless && inf.loops && inf.loops[cur.anim] && X.animations === 'selected' ? inf.loops[cur.anim] : null,
      party: cur.party ? cur.party.map((x) => x / 255) : null, folder: ST.settings.export_dir, name: X.name || 'model' });
    go.disabled = false; go.textContent = S.exportBtn;
    if (r.ok) {
      res.className = 'result ok';
      res.append(S.exported(r.files.length), el('button', { onclick: () => api.post('/api/open', { path: r.files[0] }) }, S.openFolder));
      res.append(el('div', { class: 'note', text: r.files[0] }));
      ST.settings.export_dir = r.folder;
    } else { res.className = 'result bad'; res.textContent = S.failed + (r.error || '?'); }
  } }, S.exportBtn);
  s.append(go, res);
}

// ------------------------------------------------------------------ maps
async function loadMaps() {
  $('#busy').classList.remove('hidden'); $('#busy-text').textContent = S.readingMaps;
  try { MAPS = await api.get('/api/maps'); } catch (e) { toast(String(e.message || e)); MAPS = []; }
  $('#busy').classList.add('hidden');
}
function leaveMap() {
  if (mapView) { mapView.dispose(); mapView = null; }
  if (cur.map) { cur.map = null; viewer.setGrid($('#tb-grid').checked); viewer.mapMode(false); document.body.classList.remove('mapmode'); }
}
let mapToken = 0;
async function selectMap(m) {
  const my = ++mapToken;
  cur.entry = null; cur.raw = null; cur.parts = null;
  if (mapView) { mapView.dispose(); mapView = null; }
  viewer.clear();
  $('#player').classList.add('hidden'); $('#empty').classList.add('hidden');
  $('#busy').classList.remove('hidden'); $('#busy-text').textContent = S.loadingMap;
  let info;
  try { info = await api.get('/api/map?id=' + encodeURIComponent(m.id)); } catch (e) { $('#busy').classList.add('hidden'); toast(String(e.message || e)); return; }
  if (my !== mapToken) return;
  cur.map = info;
  cur.mapExp.name = (m.rel.split('/').pop() || 'map').replace(/\.ula$/i, '');
  renderList();
  const mv = mapView = new MapView(api);
  await mv.load(info);
  if (my !== mapToken) { mv.dispose(); return; }
  viewer.mapMode(true); document.body.classList.add('mapmode');
  viewer.showGroup(mv.group);
  applyMapLayers();
  $('#busy').classList.add('hidden');
  renderMapDetails();
  if (cur.mapLayers.objects) loadMapModels('objects', my);
  if (cur.mapLayers.plants) loadMapModels('plants', my);
}
async function loadMapModels(which, my) {
  const mv = mapView;
  if (!mv || mv['loaded_' + which]) return;
  mv['loaded_' + which] = true;
  const bar = $('#map-progress');
  const r = await mv.models(which, (f, name) => {
    if (my !== mapToken) return;
    const b = $('#map-progress'); if (b) { b.classList.remove('hidden'); b.querySelector('i').style.width = Math.round(f * 100) + '%'; b.querySelector('span').textContent = S.loadingModels + ' ' + name; }
  });
  if (my !== mapToken) return;
  const b = $('#map-progress'); if (b) b.classList.add('hidden');
  if (which === 'objects' && r.missing) toast(S.mapMissing(r.missing));
}
function applyMapLayers() {
  const mv = mapView; if (!mv) return;
  const L = cur.mapLayers;
  mv.layers.objects.visible = L.objects;
  mv.layers.plants.visible = L.plants;
  mv.layers.markers.visible = L.markers || !L.objects;
  if (mv.layers.water) mv.layers.water.visible = L.water;
  mv.setTiles(L.tiles);
}
function renderMapDetails() {
  const M = cur.map;
  const head = $('#d-head'); head.innerHTML = '';
  $('#details').scrollTop = 0;
  for (const id of ['#s-model', '#s-addons', '#s-parts', '#s-vis', '#s-anims', '#s-export']) $(id).innerHTML = '';
  if (!M) return;
  head.append(el('h2', { text: M.name }));
  head.append(el('div', { class: 'sub', text: `${M.id}` }));
  if (M.preview) head.append(el('img', { class: 'preview', src: '/api/map/preview?id=' + encodeURIComponent(M.id), alt: '' }));
  const facts = el('div', { class: 'facts' });
  const fact = (k, v) => { if (v !== '' && v != null) facts.append(el('div', {}, el('span', { text: k }), el('b', { text: String(v) }))); };
  fact(S.mapSize, `${M.w} × ${M.h} m`); fact(S.mapSetting, M.setting); fact(S.mapPlayers, M.players); fact(S.mapWater, M.water + ' m');
  fact(S.mapAuthor, M.author); fact(S.mapGameType, M.game_type); fact(S.mapObjects, M.objects); fact(S.mapPlants, M.plants);
  head.append(facts);
  if (M.description) head.append(el('p', { text: M.description }));
  const types = Object.entries(M.types || {}).sort((a, b) => b[1] - a[1]);
  if (types.length) head.append(el('div', { class: 'note', text: types.map(([t, n]) => `${S.objTypes[t] || t} ${n}`).join(' · ') }));
  // layers
  const s = $('#s-parts');
  s.append(el('h3', { text: S.mapShow }));
  const L = cur.mapLayers;
  const cb = (k, label, after) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: L[k], onchange: (ev) => {
    L[k] = ev.target.checked; applyMapLayers(); if (after) after(L[k]);
  } }), el('span', { text: label }));
  s.append(cb('objects', S.mapLayerObjects, (on) => { if (on) loadMapModels('objects', mapToken); }));
  s.append(cb('plants', S.mapLayerPlants, (on) => { if (on) loadMapModels('plants', mapToken); }));
  s.append(cb('water', S.mapLayerWater));
  s.append(cb('tiles', S.mapLayerTiles));
  s.append(cb('markers', S.mapLayerMarkers));
  s.append(el('div', { id: 'map-progress', class: 'mapprog hidden' }, el('div', { class: 'progress' }, el('i')), el('span', { class: 'note' })));
  renderMapExport();
}
function renderMapExport() {
  const s = $('#s-export'); s.innerHTML = '';
  const X = cur.mapExp;
  s.append(el('h3', { text: S.export }));
  const fmt = el('select', { onchange: (ev) => { X.format = ev.target.value; } });
  fmt.append(el('option', { value: 'none', selected: X.format === 'none' }, S.mapNo3d));
  for (const f of CAT.formats.filter((f) => !f.blender)) fmt.append(el('option', { value: f.id, selected: f.id === X.format }, f.label));
  s.append(el('div', { class: 'row' }, el('label', { text: S.format }), fmt));
  const step = el('select', { onchange: (ev) => { X.step = +ev.target.value; } });
  for (const [v, l] of [[1, '2 m'], [2, '4 m'], [4, '8 m'], [8, '16 m']]) step.append(el('option', { value: v, selected: v === X.step }, l));
  s.append(el('div', { class: 'row' }, el('label', { text: S.mapDetail }), step));
  const ck = (k, label) => el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: X[k], onchange: (ev) => { X[k] = ev.target.checked; } }), el('span', { text: label }));
  s.append(ck('objects', S.mapExpObjects), ck('plants', S.mapExpPlants));
  s.append(el('div', { class: 'grp', text: S.mapAlso }));
  for (const [k, l] of [['heightmap', S.mapExHeight], ['materials', S.mapExMats], ['csv', S.mapExCsv], ['json', S.mapExJson], ['preview', S.mapExPreview],
    ['surf', S.mapExSurf], ['ksy', S.mapExKsy], ['ula', S.mapExUla]]) {
    s.append(el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: X.extras.includes(k), onchange: (ev) => {
      X.extras = X.extras.filter((x) => x !== k); if (ev.target.checked) X.extras.push(k);
    } }), el('span', { text: l })));
  }
  s.append(el('div', { class: 'row' }, el('label', { text: S.fileName }), el('input', { type: 'text', value: X.name, style: 'flex:1', oninput: (ev) => { X.name = ev.target.value; } })));
  const folder = el('span', { class: 'folder', text: ST.settings.export_dir || '' });
  s.append(el('div', { class: 'row' }, el('label', { text: S.folder }), folder, el('button', { onclick: async () => {
    const r = await api.post('/api/browse', { title: S.folder, initial: ST.settings.export_dir });
    if (r.path) { await api.post('/api/settings', { export_dir: r.path }); ST.settings.export_dir = r.path; folder.textContent = r.path; }
  } }, S.change)));
  const res = el('div', { class: 'result' });
  const go = el('button', { class: 'primary', id: 'map-go', onclick: async () => {
    go.disabled = true; go.textContent = S.exporting; res.className = 'result'; res.textContent = '';
    const r = await api.post('/api/map/export', { id: cur.map.id, format: X.format, objects: X.objects, plants: X.plants, step: X.step,
      extras: X.extras, folder: ST.settings.export_dir, name: X.name || 'map' });
    go.disabled = false; go.textContent = S.exportBtn;
    if (r.ok) {
      res.className = 'result ok';
      res.append(S.exported(r.files.length), el('button', { onclick: () => api.post('/api/open', { path: r.files[0] }) }, S.openFolder));
      res.append(el('div', { class: 'note', text: r.files.join('\n') }));
      ST.settings.export_dir = r.folder;
    } else { res.className = 'result bad'; res.textContent = S.failed + (r.error || '?'); }
  } }, S.exportBtn);
  s.append(go, res);
}

// ------------------------------------------------------------------ dialogs
function dialog(build) {
  const m = $('#dialog'), c = $('#dialog-card');
  c.innerHTML = '';
  build(c, () => m.classList.add('hidden'));
  m.classList.remove('hidden');
  m.onclick = (ev) => { if (ev.target === m) m.classList.add('hidden'); };
}
function showSettings() {
  dialog((c, close) => {
    c.append(el('h1', { text: S.settings }));
    let inst = ST.settings.install, blender = ST.settings.blender || '';
    const ii = el('input', { type: 'text', value: inst, oninput: (e) => { inst = e.target.value; } });
    c.append(el('h4', { text: S.install }), el('div', { class: 'pathrow' }, ii, el('button', { onclick: async () => { const r = await api.post('/api/browse', { title: S.install, initial: inst }); if (r.path) { inst = r.path; ii.value = inst; } } }, S.browse)));
    const nl = el('select');
    for (const l of ST.langs) nl.append(el('option', { value: l.id, selected: l.id === ST.settings.lang }, l.name));
    c.append(el('h4', { text: S.namesLang }), nl);
    const bi = el('input', { type: 'text', value: blender, placeholder: ST.blender || '', oninput: (e) => { blender = e.target.value; } });
    c.append(el('h4', { text: S.blender }), el('p', { class: 'note', text: ST.blender ? S.blenderFound + ST.blender : S.blenderMissing }), bi);
    c.append(el('div', { class: 'actions' }, el('button', { onclick: close }, S.close), el('button', { class: 'primary', onclick: async () => {
      const r = await api.post('/api/settings', { install: inst, lang: nl.value, blender });
      close();
      ST = await api.get('/api/state');
      if (r && r.ok && !ST.progress.ready) return showLoading();
      await loadCatalog(true);
    } }, S.save)));
  });
}
function showAbout() {
  dialog((c, close) => {
    c.innerHTML = `<h1><img src="icon.svg" alt="">${esc(S.title)}</h1>
      <p>Version ${esc(ST.version)} · <a href="https://unlicense.org" target="_blank">Unlicense</a> (public domain – do anything you like with it)</p>
      <h4>Credits</h4>
      <p>The GSF format research this tool builds on: <b>Zidell</b> (GSF documentation) and <b>arceusVen1</b>'s
      <a href="https://github.com/arceusVen1/Paraworld_gsf_viewer" target="_blank">Paraworld_gsf_viewer</a>.</p>
      <p>3D view: <a href="https://threejs.org" target="_blank">three.js</a> (MIT). ParaWorld © SEK / Sunflowers / Ubisoft – this tool
      only reads the files of your own installation; the models stay the property of their owners.</p>
      <h4>Files</h4><p class="note">Settings and the conversion cache: ${esc(ST.home)}</p>`;
    c.append(el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: close }, S.close)));
  });
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 4000);
}

init().catch((e) => { console.error(e); toast(String(e.message || e)); });
