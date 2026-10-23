// The ParaWorld Workshop: a mod with new objects, made step by step (docs/WORKSHOP.md). The server side is
// workshop/api.py; the 3D view is the Model & Map Exporter's viewer.
import { Viewer } from '/exporter/viewer.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};
const api = {
  async get(u) { const r = await fetch(u); const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.statusText); return j; },
  async post(u, d) {
    const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d || {}) });
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.statusText); return j;
  },
  async upload(project, file) {
    const r = await fetch(`/api/workshop/upload?project=${enc(project)}&name=${enc(file.name)}`, { method: 'POST', body: file });
    const j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.statusText); return j;
  },
};
const enc = encodeURIComponent;
let toastT = 0;
function toast(text, bad = false) {
  const t = $('#toast'); t.textContent = text; t.className = bad ? 'bad' : ''; clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.add('hidden'), bad ? 7000 : 3500);
}
const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message, true); console.error(e); } };

const KIND_INFO = {
  unit: ['Unit', 'Trained in a building of its tribe; fights, levels up in the army pyramid'],
  building: ['Building', 'Built by the workers of its tribe'],
  animal: ['Wild animal', 'Lives in the wild: grazes, hunts, flees, can be hunted for food'],
  decoration: ['Decoration', 'A scenery object for maps (rocks, ruins, plants)'],
};
// the model kinds (GSF four-character codes) each kind of object usually has
const FOURCC = { unit: ['Char', 'Anim', 'Vehi', 'Ship'], building: ['Bldg', 'Wall', 'Fiel'], animal: ['Anim'], decoration: ['Deko', 'Misc', 'Vgtn', 'Ress', 'Bldg'] };
const STEPS = [['what', 'What it is'], ['model', 'Model'], ['anims', 'Animations'], ['numbers', 'Numbers'], ['texts', 'Name & icon'], ['check', 'Check']];

const S = { state: null, project: null, obj: null, step: 'what', tpl: {}, templates: {}, gameModels: {}, saveT: 0, preview: null };
let viewer = null;

// ---------------------------------------------------------------------------- start
async function boot() {
  viewer = new Viewer($('#view'));
  $('#anim').onchange = () => { viewer.play(0, $('#anim').value || null); };
  $('#snap').onclick = guard(snapIcon);
  $('#new-project').onclick = newProjectDialog;
  $('#new-object').onclick = () => newObjectDialog();
  $('#mod-page').onclick = () => { S.obj = null; render(); };
  S.state = await api.get('/api/workshop/state');
  const want = new URLSearchParams(location.search).get('mod') || localStorage.getItem('pww.mod');
  renderProjects();
  if (want && S.state.projects.some((p) => p.id === want)) await openProject(want);
  else render();
}

function renderProjects() {
  const box = $('#projects'); box.innerHTML = '';
  for (const p of S.state.projects) {
    box.append(el('div', { class: 'item' + (S.project && S.project.id === p.id ? ' on' : ''), onclick: guard(() => openProject(p.id)) },
      p.title || p.id, el('small', { text: `${p.id} · ${p.objects} object${p.objects === 1 ? '' : 's'}${p.base ? ' · on ' + p.base : ''}` })));
  }
  if (!S.state.projects.length) box.append(el('div', { class: 'note', text: 'No mods yet.' }));
}

function renderObjects() {
  const P = S.project, box = $('#objects');
  $('#objects-box').classList.toggle('hidden', !P);
  if (!P) return;
  $('#objects-title').textContent = `Objects of ${P.id}`;
  box.innerHTML = '';
  for (const o of P.objects) {
    box.append(el('div', { class: 'item' + (S.obj === o.id ? ' on' : ''), onclick: () => { S.obj = o.id; S.step = S.step || 'what'; render(); } },
      (o.texts && o.texts.name) || o.id, el('small', { text: `${KIND_INFO[o.kind][0]} · like ${o.template}` })));
  }
  if (!P.objects.length) box.append(el('div', { class: 'note', text: 'No objects yet.' }));
}

async function openProject(id) {
  S.project = await api.get(`/api/workshop/project?id=${enc(id)}`);
  S.obj = null;
  localStorage.setItem('pww.mod', id);
  renderProjects();
  render();
}

const cur = () => S.project && S.obj ? S.project.objects.find((o) => o.id === S.obj) : null;

// every change is saved a moment later; whatever asks the server about the project saves first (saveNow)
let dirty = false, saving = Promise.resolve();
function changed(rerender = false) {
  dirty = true;
  clearTimeout(S.saveT);
  S.saveT = setTimeout(guard(saveNow), 400);
  if (rerender) render();
}
function saveNow() {
  clearTimeout(S.saveT);
  if (!dirty || !S.project) return saving;
  dirty = false;
  const P = S.project;
  saving = saving.then(async () => {
    await api.post('/api/workshop/project/save', { id: P.id, title: P.title, version: P.version, lang: P.lang, objects: P.objects });
    const fresh = await api.get(`/api/workshop/project?id=${enc(P.id)}`);
    P.problems = fresh.problems; P.installed = fresh.installed; P.built = fresh.built;
    const row = (S.state.projects || []).find((x) => x.id === P.id);
    if (row) { row.objects = P.objects.length; row.title = P.title; renderProjects(); }
  });
  return saving;
}

// ---------------------------------------------------------------------------- the main column
function render() {
  renderObjects();
  const m = $('#main'); m.innerHTML = '';
  if (!S.project) return m.append(welcome());
  const o = cur();
  if (!o) return m.append(modPage());
  m.append(el('h1', { text: (o.texts && o.texts.name) || o.id }),
    el('p', { class: 'lead', html: `<code>${o.id}</code> · ${KIND_INFO[o.kind][0]} that behaves like <code>${o.template}</code>` }));
  const steps = el('div', { class: 'steps' });
  STEPS.forEach(([k, t], i) => steps.append(el('button', { class: (S.step === k ? 'on ' : '') + (stepDone(o, k) ? 'ok' : ''), onclick: () => { S.step = k; render(); } }, el('span', { class: 'n', text: i + 1 }), t)));
  m.append(steps);
  const page = { what: stepWhat, model: stepModel, anims: stepAnims, numbers: stepNumbers, texts: stepTexts, check: stepCheck }[S.step] || stepWhat;
  const body = el('div');
  m.append(body);
  guard(async () => { body.append(await page(o)); })();
  const i = STEPS.findIndex(([k]) => k === S.step);
  m.append(el('div', { class: 'actions' },
    i > 0 ? el('button', { onclick: () => { S.step = STEPS[i - 1][0]; render(); } }, '← Back') : null,
    i < STEPS.length - 1 ? el('button', { class: 'primary', onclick: () => { S.step = STEPS[i + 1][0]; render(); } }, 'Next →')
      : el('button', { class: 'primary', onclick: () => { S.obj = null; render(); } }, 'Build & install the mod →')));
  showModel(o);
}

function stepDone(o, k) {
  const m = o.model || {};
  if (k === 'what') return !!o.template;
  if (k === 'model') return m.source === 'game' || (m.file && m.name);
  if (k === 'texts') return !!(o.texts && o.texts.name);
  return false;
}

function welcome() {
  return el('div', {},
    el('h1', { text: 'Welcome to the Workshop' }),
    el('p', { class: 'lead', text: 'Make new units, buildings, wild animals and decorations for ParaWorld - and play them in the remake.' }),
    el('div', { class: 'card' }, el('h3', { text: 'How it works' }), el('ol', {},
      el('li', { text: 'Make a mod (left: "New mod…"). It builds on the game as you play it - the official game or a mod like MIRAGE.' }),
      el('li', { text: 'Add objects. Each one copies the behaviour of an object of the game (the template): a new warrior can fight like the Norsemen\'s warrior, a new dinosaur graze like a stegosaurus.' }),
      el('li', { text: 'Give it a model: one you made in Blender with the ParaWorld GSF add-on, or a model of the game (to change it in Blender, download it here first).' }),
      el('li', { text: 'Match its animations to the ones the template\'s scripts play, set its numbers, name, texts and icon.' }),
      el('li', { text: 'Build the mod and install it: ParaWorld starts it with "-enable <mod>", the remake offers it in its menu ("Game data").' }))),
    el('p', { class: 'note', html: 'The <a href="/workshop/guide.html" target="_blank">guide</a> explains every step.' }),
    S.state && S.state.error ? el('p', { class: 'bad', text: S.state.error }) : null);
}

// ---------------------------------------------------------------------------- dialogs
function modal(title, body, ok, okText = 'Create') {
  const err = el('div', { class: 'bad' });
  const box = el('div', { class: 'modal' }, el('div', { class: 'card' }, el('h3', { text: title }), body, err,
    el('div', { class: 'actions' }, el('button', { onclick: () => box.remove() }, 'Cancel'),
      el('button', { class: 'primary', onclick: async () => { try { await ok(); box.remove(); } catch (e) { err.textContent = e.message; } } }, okText))));
  document.body.append(box);
  const f = box.querySelector('input'); if (f) f.focus();
}

function newProjectDialog() {
  const id = el('input', { type: 'text', placeholder: 'MyCreatures', value: '' });
  const title = el('input', { type: 'text', placeholder: 'My creatures' });
  const base = el('select', {}, (S.state.configs || []).map((c) => el('option', { value: c.id }, c.id ? `${c.name} (${c.folders.join(' + ')})` : 'ParaWorld (official game)')));
  const lang = el('select', {}, (S.state.langs || ['uk']).map((l) => el('option', { value: l }, l)));
  modal('New mod', el('div', { class: 'grid' },
    el('label', { text: 'Mod id' }), id, el('span', { class: 'note wide', text: 'Its folder name in the game (Data\\<id>) and the name to start it with: letters, digits, "_".' }),
    el('label', { text: 'Title' }), title,
    el('label', { text: 'Builds on' }), base, el('span', { class: 'note wide', text: 'The game configuration the mod adds to. Its objects can be templates.' }),
    el('label', { text: 'Language of the texts' }), lang), async () => {
    const r = await api.post('/api/workshop/project/new', { id: id.value.trim(), title: title.value.trim(), base: base.value, lang: lang.value });
    S.state = await api.get('/api/workshop/state');
    await openProject(r.project.id);
  });
}

async function templatesOf(base) {
  if (!S.templates[base]) S.templates[base] = await api.get(`/api/workshop/templates?base=${enc(base)}`);
  return S.templates[base];
}
async function templateInfo(base, id) {
  const k = base + '|' + id;
  if (!S.tpl[k]) S.tpl[k] = await api.get(`/api/workshop/template?base=${enc(base)}&id=${enc(id)}`);
  return S.tpl[k];
}

// a template picker: kind tiles, tribe filter, search, list
async function templatePicker(kind, chosen, onPick) {
  const P = S.project, all = await templatesOf(P.base || '');
  const wrap = el('div');
  let tribe = '', q = '';
  const search = el('input', { type: 'search', placeholder: 'Search: name or class' });
  const tribes = el('select', {}, el('option', { value: '' }, 'every tribe'), ...['Hu', 'Aje', 'Ninigi', 'SEAS'].map((t) => el('option', { value: t }, { Hu: 'Norsemen', Aje: 'Dustriders', Ninigi: 'Dragon Clan', SEAS: 'SEAS' }[t])));
  const table = el('div', { class: 'table' });
  const fill = () => {
    const rows = all.filter((t) => t.kind === kind() && (!tribe || t.tribe === tribe) && (!q || (t.id + ' ' + (t.title || '')).toLowerCase().includes(q)));
    const tb = el('tbody');
    for (const t of rows.slice(0, 400)) {
      tb.append(el('tr', { class: 'click' + (t.id === chosen() ? ' sel' : ''), onclick: () => { onPick(t); fill(); } },
        el('td', { text: t.title || '' }), el('td', {}, el('code', { text: t.id })), el('td', { text: t.tribe }), el('td', { class: 'note', text: t.script })));
    }
    table.innerHTML = '';
    table.append(el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: 'Class' }), el('th', { text: 'Tribe' }), el('th', { text: 'Script' }))), tb));
    if (!rows.length) table.append(el('div', { class: 'note', text: 'Nothing matches.' }));
  };
  search.oninput = () => { q = search.value.trim().toLowerCase(); fill(); };
  tribes.onchange = () => { tribe = tribes.value; fill(); };
  wrap.append(el('div', { class: 'pick' }, search, kind() === 'unit' || kind() === 'building' ? tribes : null), table);
  wrap.refill = fill;
  fill();
  return wrap;
}

function kindTiles(get, set) {
  const box = el('div', { class: 'kinds' });
  const draw = () => {
    box.innerHTML = '';
    for (const [k, [t, d]] of Object.entries(KIND_INFO)) box.append(el('div', { class: 'k' + (get() === k ? ' on' : ''), onclick: () => { set(k); draw(); } }, el('b', { text: t }), el('span', { text: d })));
  };
  draw();
  return box;
}

async function newObjectDialog() {
  const P = S.project;
  let kind = 'unit', tpl = null;
  const id = el('input', { type: 'text', value: `${P.id.toLowerCase()}_` });
  const holder = el('div');
  const pickT = async () => { holder.innerHTML = ''; holder.append(await templatePicker(() => kind, () => tpl && tpl.id, (t) => { tpl = t; })); };
  const tiles = kindTiles(() => kind, (k) => { kind = k; tpl = null; pickT(); });
  modal('New object', el('div', {}, el('p', { class: 'note', text: 'What should it be, and which object of the game should it behave like?' }), tiles,
    el('h3', { text: 'Behaves like (template)' }), holder,
    el('div', { class: 'grid' }, el('label', { text: 'Class name' }), id, el('span', { class: 'note wide', text: 'The object\'s name in the game\'s files: lower case letters, digits, "_" (the mod\'s id in front keeps it apart from other mods).' }))),
  async () => {
    if (!tpl) throw new Error('Pick the template in the list.');
    const oid = id.value.trim();
    if (!/^[a-z][a-z0-9_]{2,47}$/.test(oid)) throw new Error('The class name: 3-48 lower case letters, digits or "_", starting with a letter.');
    if (P.objects.some((o) => o.id === oid)) throw new Error('The mod has an object of that name already.');
    P.objects.push({ id: oid, kind, template: tpl.id, model: { source: 'game', name: null, anims: {} }, texts: { name: '', short: '', long: '' },
      stats: {}, cost: {}, duration: null, producer: null, weapon: {}, icon: null, textures: {} });
    S.obj = oid; S.step = 'model';
    changed(true);
  }, 'Add');
  await pickT();
}

// ---------------------------------------------------------------------------- steps of an object
async function stepWhat(o) {
  const P = S.project;
  const holder = el('div');
  const pick = async () => { holder.innerHTML = ''; holder.append(await templatePicker(() => o.kind, () => o.template, (t) => { o.template = t.id; o.model.anims = {}; changed(); toast(`Behaves like ${t.title || t.id} now`); })); };
  const t = await templateInfo(P.base || '', o.template);
  await pick();
  return el('div', {},
    el('div', { class: 'card' }, el('h3', { text: 'Kind' }), kindTiles(() => o.kind, (k) => { if (k !== o.kind) { o.kind = k; changed(); pick(); } })),
    el('div', { class: 'card' }, el('h3', { text: 'Behaves like' }),
      el('p', { class: 'note', html: `The template gives the object its script (<code>${t.script}</code>), its rules (hit points, weapons, what it costs, where it is made), its level-ups and its upgrades. Its model only matters for the animations: yours should have the ones it has.` }),
      holder),
    el('div', { class: 'card' }, el('h3', { text: 'Class name' }), el('div', { class: 'grid' }, el('label', { text: 'Id' }),
      el('input', { type: 'text', value: o.id, onchange: (e) => {
        const v = e.target.value.trim();
        if (!/^[a-z][a-z0-9_]{2,47}$/.test(v) || P.objects.some((x) => x !== o && x.id === v)) { toast('3-48 lower case letters, digits or "_"; not used yet', true); e.target.value = o.id; return; }
        o.id = v; S.obj = v; changed(true);
      } }))),
    el('div', { class: 'actions' }, el('button', { onclick: () => { if (confirm(`Remove ${o.id} from the mod?`)) { P.objects = P.objects.filter((x) => x !== o); S.obj = null; changed(true); } } }, 'Remove this object')));
}

async function stepModel(o) {
  const P = S.project, t = await templateInfo(P.base || '', o.template), m = o.model;
  const box = el('div');
  const src = el('div', { class: 'kinds' });
  const drawSrc = () => {
    src.innerHTML = '';
    src.append(el('div', { class: 'k' + (m.source !== 'upload' ? ' on' : ''), onclick: () => { m.source = 'game'; changed(true); } }, el('b', { text: 'A model of the game' }), el('span', { text: 'The template\'s own, or any other model of the game' })),
      el('div', { class: 'k' + (m.source === 'upload' ? ' on' : ''), onclick: () => { m.source = 'upload'; changed(true); } }, el('b', { text: 'My model' }), el('span', { text: 'A .gsf archive the Blender add-on wrote' })));
  };
  drawSrc();
  box.append(el('div', { class: 'card' }, el('h3', { text: 'Where the model comes from' }), src));
  if (m.source === 'upload') {
    const file = el('input', { type: 'file', accept: '.gsf' });
    const list = el('div');
    const showModels = (models) => {
      list.innerHTML = '';
      const tb = el('tbody');
      for (const x of models) {
        const ok = FOURCC[o.kind].includes(x.fourcc.trim());
        tb.append(el('tr', { class: 'click' + (x.name === m.name ? ' sel' : ''), onclick: () => { m.name = x.name; changed(true); } },
          el('td', {}, el('code', { text: x.name })), el('td', { class: ok ? '' : 'warn', text: x.fourcc + (ok ? '' : ' (unusual for a ' + KIND_INFO[o.kind][0].toLowerCase() + ')') }),
          el('td', { text: `${x.anims.length} animations` })));
      }
      list.append(el('div', { class: 'table' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Model' }), el('th', { text: 'Kind' }), el('th', { text: '' }))), tb)));
    };
    file.onchange = guard(async () => {
      const f = file.files[0]; if (!f) return;
      toast('Reading the archive…');
      const r = await api.upload(P.id, f);
      m.file = r.file; m.name = (r.models[0] || {}).name || null; m.anims = {};
      changed(true);
    });
    if (m.file) guard(async () => showModels(await api.get(`/api/workshop/models?project=${enc(P.id)}&file=${enc(m.file)}`)))();
    box.append(el('div', { class: 'card' }, el('h3', { text: 'Your archive' }),
      el('p', { class: 'note', html: 'In Blender: <i>File → Export → ParaWorld GSF</i> (the add-on is in the toolkit\'s <code>blender</code> folder). An archive can hold several models; pick the one for this object.' }),
      el('div', { class: 'pick' }, file, m.file ? el('code', { text: m.file }) : null), list));
  } else {
    const all = S.gameModels[P.base || ''] || (S.gameModels[P.base || ''] = await api.get(`/api/workshop/gamemodels?base=${enc(P.base || '')}`));
    const search = el('input', { type: 'search', placeholder: 'Search the game\'s models' });
    const table = el('div', { class: 'table' });
    const name = m.name || t.gfx;
    const fill = () => {
      const q = search.value.trim().toLowerCase();
      const now = (m.name || t.gfx || '').toLowerCase(), kinds = FOURCC[o.kind];
      const rank = (x) => (x.name.toLowerCase() === now ? 0 : kinds.includes(x.fourcc) ? 1 : 2);
      const rows = all.filter((x) => !q || (x.name + ' ' + x.archive).toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b)).slice(0, 300);
      const tb = el('tbody');
      for (const x of rows) tb.append(el('tr', { class: 'click' + (x.name.toLowerCase() === (m.name || t.gfx || '').toLowerCase() ? ' sel' : ''), onclick: () => { m.name = x.name; m.anims = {}; changed(true); } },
        el('td', {}, el('code', { text: x.name })), el('td', { text: x.fourcc }), el('td', { class: 'note', text: x.archive })));
      table.innerHTML = '';
      table.append(el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Model' }), el('th', { text: 'Kind' }), el('th', { text: 'Archive' }))), tb));
    };
    search.oninput = fill;
    search.value = '';
    fill();
    box.append(el('div', { class: 'card' }, el('h3', { text: 'The model of the game' }),
      el('p', { class: 'note', html: `Now: <code>${name}</code>${m.name ? '' : ' (the template\'s)'}. To change it, download it, open it in Blender with the ParaWorld GSF add-on, export it and choose "My model".` }),
      el('div', { class: 'pick' }, search, el('a', { class: 'button', href: `/api/workshop/extract?base=${enc(P.base || '')}&name=${enc(name)}` }, '⬇ Download for Blender')), table));
    if (o.kind === 'unit') {
      box.append(el('div', { class: 'card' }, el('h3', { text: 'Higher levels' }),
        el('label', {}, el('input', { type: 'checkbox', checked: m.levels === 'template', onchange: (e) => { m.levels = e.target.checked ? 'template' : null; changed(); } }),
          ' Keep the template\'s own models for levels 2-5 (the Norsemen\'s warrior looks different on each level); unticked, every level shows this model')));
    }
  }
  return box;
}

async function stepAnims(o) {
  const P = S.project, t = await templateInfo(P.base || '', o.template), m = o.model;
  const prev = await preview(o).catch(() => null);
  if (!prev) return el('div', { class: 'card' }, el('p', { text: 'Choose the model first.' }));
  // the animations of play first (stand, walk, run, attack, hit, die ...), the cutscenes' (NS1060_..., "ns" + number)
  // behind a switch
  const ORDER = [/^standanim/, /^idle|_idle/, /^walk/, /^run/, /^attack|_attack/, /^hit|_hit/, /^die|dying|^death/, /^work|^build|^harvest|^chop|^dig/, /^level_up|^levelup/];
  const rank = (a) => { const i = ORDER.findIndex((r) => r.test(a)); return i < 0 ? ORDER.length : i; };
  const cut = (a) => /^ns\d/i.test(a);
  const all = ((t.model && t.model.anims) || []).slice().sort((x, y) => rank(x) - rank(y) || x.localeCompare(y));
  const want = all.filter((a) => S.showCut || !cut(a));
  const nCut = all.filter(cut).length;
  const have = prev.anims;
  const tb = el('tbody');
  let missing = 0;
  for (const a of want) {
    const own = have.includes(a);
    const sel = el('select', { onchange: (e) => { if (e.target.value) m.anims[a] = e.target.value; else delete m.anims[a]; changed(); } },
      el('option', { value: '' }, own ? '(its own)' : '— none —'), ...have.map((x) => el('option', { value: x, selected: m.anims[a] === x }, x)));
    const ok = own || m.anims[a];
    if (!ok) missing++;
    tb.append(el('tr', {}, el('td', {}, el('code', { text: a })), el('td', { class: ok ? 'good' : 'warn', text: ok ? '✓' : 'missing' }), el('td', {}, sel),
      el('td', {}, el('button', { class: 'small', onclick: () => viewer.play(0, m.anims[a] || (own ? a : null)) }, '▶'))));
  }
  const links = (t.model && t.model.links) || [], hl = prev.links || [];
  const lmiss = links.filter((l) => !hl.includes(l));
  return el('div', {},
    el('div', { class: 'card' }, el('h3', { text: 'Animations the template\'s scripts play' }),
      el('p', { class: 'note', text: `The game plays animations by name (walk, standanim, attack ...). ${want.length} names; ${missing ? missing + ' your model does not have - map one of its own animations to each, or leave it (the object stands still then).' : 'your model has them all.'}` }),
      nCut ? el('label', { class: 'note' }, el('input', { type: 'checkbox', checked: !!S.showCut, onchange: (e) => { S.showCut = e.target.checked; render(); } }), ` also the ${nCut} animations of the campaign's cutscenes (NS…)`) : null,
      el('div', { class: 'table', style: 'max-height:420px' }, el('table', {}, el('thead', {}, el('tr', {}, el('th', { text: 'Name' }), el('th', { text: '' }), el('th', { text: 'Your model\'s animation' }), el('th', { text: '' }))), tb))),
    el('div', { class: 'card' }, el('h3', { text: 'Links' }),
      el('p', { class: 'note', text: links.length ? `The template's model has the links ${links.join(', ')} (where the scripts attach weapons, riders, flags, effects). ${lmiss.length ? 'Your model lacks: ' + lmiss.join(', ') + ' - add these empties in Blender (GSF Link) if the object should carry them.' : 'Your model has them all.'}` : 'The template\'s model has no links.' })));
}

const pretty = (v) => (v == null || v === '' || isNaN(+v) ? v : String(+(+v).toFixed(3)));
function numField(label, get, set, was, step = 'any') {
  was = pretty(was);
  return [el('label', { text: label }), el('input', { type: 'number', min: 0, step, value: get() ?? '', placeholder: was ?? '', onchange: (e) => { set(e.target.value === '' ? null : +e.target.value); changed(); } }),
    el('span', { class: 'was', text: was != null && was !== '' ? `template: ${was}` : '' })];
}

async function stepNumbers(o) {
  const P = S.project, t = await templateInfo(P.base || '', o.template);
  if (o.kind === 'decoration') return el('div', { class: 'card' }, el('p', { text: 'A decoration has no numbers: it stands on the map as the template does (with or without collision).' }));
  const st = o.stats || (o.stats = {}), cost = o.cost || (o.cost = {}), w = o.weapon || (o.weapon = {}), ts = t.stats || {};
  const g = el('div', { class: 'nums' });
  const STAT = { hitpoints: 'Hit points (level 1)', defaultspeed: 'Speed (walking)', maxspeed: 'Speed (running)', FOW: 'Sight (m)', scalps: 'Skulls it is worth' };
  for (const [k, label] of Object.entries(STAT)) {
    if (o.kind === 'building' && /speed|scalps/.test(k)) continue;
    g.append(...numField(label, () => st[k], (v) => { if (v == null) delete st[k]; else st[k] = v; }, ts[k]));
  }
  const cards = [el('div', { class: 'card' }, el('h3', { text: 'The object' }), g,
    o.kind === 'unit' ? el('p', { class: 'note', text: 'Higher levels keep the template\'s bonuses; their hit points grow in the same proportion.' }) : null)];
  if (o.kind === 'unit' || o.kind === 'building') {
    const c = el('div', { class: 'nums' });
    for (const r of ['food', 'wood', 'stone']) c.append(...numField(`Cost: ${r}`, () => cost[r], (v) => { if (v == null) delete cost[r]; else cost[r] = v; }, t.cost && t.cost[r], 1));
    c.append(...numField(o.kind === 'unit' ? 'Training time (s)' : 'Construction time (s)', () => o.duration, (v) => { o.duration = v; }, t.duration));
    const prods = t.producers || [];
    if (o.kind === 'unit' && prods.length) {
      c.append(el('label', { text: 'Trained in' }), el('select', { onchange: (e) => { o.producer = e.target.value || null; changed(); } },
        el('option', { value: '' }, `as the template (${t.producer})`), ...prods.filter((p) => p !== t.producer).map((p) => el('option', { value: p, selected: o.producer === p }, p))), el('span'));
    }
    cards.push(el('div', { class: 'card' }, el('h3', { text: o.kind === 'unit' ? 'Training' : 'Construction' }), c));
  }
  if (t.weapon) {
    const c = el('div', { class: 'nums' });
    c.append(...numField('Damage (level 1)', () => w.damage, (v) => { if (v == null) delete w.damage; else w.damage = v; }, t.weapon.damage));
    c.append(...numField('Range (m)', () => w.range, (v) => { if (v == null) delete w.range; else w.range = v; }, t.weapon.range));
    c.append(...numField('Attacks per minute', () => w.frequency, (v) => { if (v == null) delete w.frequency; else w.frequency = v; }, t.weapon.frequency));
    cards.push(el('div', { class: 'card' }, el('h3', { text: 'Weapon' }), c, el('p', { class: 'note', text: 'The weapons of the higher levels keep their ratio to level 1.' })));
  }
  cards.push(el('p', { class: 'note', text: 'Empty fields keep the template\'s value.' }));
  return el('div', {}, ...cards);
}

async function stepTexts(o) {
  const P = S.project, tx = o.texts || (o.texts = {});
  const field = (k, label, area) => [el('label', { text: label }), area
    ? el('textarea', { rows: k === 'long' ? 5 : 3, onchange: (e) => { tx[k] = e.target.value; changed(); } }, tx[k] || '')
    : el('input', { type: 'text', value: tx[k] || '', onchange: (e) => { tx[k] = e.target.value; changed(true); } })];
  const cards = [el('div', { class: 'card' }, el('h3', { text: 'In the game\'s encyclopedia and tooltips' }), el('div', { class: 'grid' },
    ...field('name', 'Name'), ...field('short', 'Bullet points (one per line, "• …")', true), ...field('long', 'Description', true)),
  el('p', { class: 'note', text: 'Empty texts keep the template\'s.' }))];
  if (o.kind !== 'decoration') {
    const ic = el('span', { class: 'icon-prev' });
    if (o.icon) ic.style.backgroundImage = `url(/api/workshop/file/${enc(P.id)}/${o.icon})`;
    const file = el('input', { type: 'file', accept: 'image/*', onchange: guard(async (e) => { const f = e.target.files[0]; if (!f) return; const r = await api.upload(P.id, f); o.icon = r.file; changed(true); }) });
    cards.push(el('div', { class: 'card' }, el('h3', { text: 'Icon' }),
      el('div', { class: 'pick' }, ic, o.icon ? el('span', { text: 'your picture' }) : el('span', { class: 'note', text: 'the template\'s icon' }), file,
        o.icon ? el('button', { class: 'small', onclick: () => { o.icon = null; changed(true); } }, 'Use the template\'s') : null),
      el('p', { class: 'note', text: 'A square picture; it is made into the five card sizes of the pyramid and the command bar. "📷 Icon from this view" (under the 3D view) takes the view as it is.' })));
  }
  await saveNow();
  const texList = await api.get(`/api/workshop/textures?project=${enc(P.id)}&obj=${enc(o.id)}`).catch(() => []);
  if (texList.length) {
    const tb = el('tbody');
    for (const x of texList) {
      const f = el('input', { type: 'file', accept: 'image/*', onchange: guard(async (e) => { const fl = e.target.files[0]; if (!fl) return; const r = await api.upload(P.id, fl); (o.textures || (o.textures = {}))[x.name] = r.file; changed(true); }) });
      tb.append(el('tr', {}, el('td', {}, el('code', { text: x.name })), el('td', { class: x.file ? 'good' : x.game ? '' : 'bad', text: x.file ? 'your picture' : x.game ? 'the game has it' : 'missing' }), el('td', {}, f)));
    }
    cards.push(el('div', { class: 'card' }, el('h3', { text: 'Textures' }),
      el('p', { class: 'note', text: 'The pictures the model\'s materials name. A missing one (a texture you painted for your model) needs a picture here; it is written as the game\'s .dds. A picture you give also replaces one the game has, for this mod.' }),
      el('div', { class: 'table' }, el('table', {}, tb))));
  }
  return el('div', {}, ...cards);
}

async function stepCheck(o) {
  const P = S.project, t = await templateInfo(P.base || '', o.template);
  const prev = await preview(o).catch((e) => ({ error: e.message }));
  const items = [];
  const add = (ok, text) => items.push(el('li', { class: ok === true ? 'good' : ok === 'warn' ? 'warn' : 'bad', text }));
  add(!!o.template, `Behaves like ${t.title || t.id} (${t.script})`);
  add(!prev.error, prev.error ? 'Model: ' + prev.error : `Model: ${(o.model.source === 'upload' ? o.model.name : (o.model.name || t.gfx))} (${prev.fourcc})`);
  if (!prev.error) {
    if (!FOURCC[o.kind].includes((prev.fourcc || '').trim())) add('warn', `The model is a "${prev.fourcc}" model; ${KIND_INFO[o.kind][0].toLowerCase()}s usually have ${FOURCC[o.kind].join(' / ')}`);
    const miss = ((t.model && t.model.anims) || []).filter((a) => !prev.anims.includes(a) && !(o.model.anims || {})[a]);
    add(miss.length ? 'warn' : true, miss.length ? `${miss.length} animations the scripts play are missing: ${miss.slice(0, 8).join(', ')}${miss.length > 8 ? ' …' : ''}` : 'Every animation the scripts play is there');
  }
  add(o.texts && o.texts.name ? true : 'warn', o.texts && o.texts.name ? `Name: ${o.texts.name}` : 'No name yet (the template\'s is used)');
  for (const p of (S.project.problems || []).filter((x) => x.startsWith(o.id + ':'))) add(false, p);
  return el('div', { class: 'card' }, el('h3', { text: 'Ready?' }), el('ul', {}, items),
    el('p', { class: 'note', text: 'Then build and install the mod (below) - all of its objects together.' }));
}

// ---------------------------------------------------------------------------- the mod's page: build, install, play
function modPage() {
  const P = S.project;
  const out = el('div', { class: 'files hidden' });
  const status = el('div', { class: 'note' });
  const setStatus = () => { status.innerHTML = ''; status.append(P.installed ? el('span', { class: 'good', text: '✓ installed in the game' }) : el('span', { text: 'not installed' }), P.built ? ' · built' : ''); };
  setStatus();
  const langs = el('input', { type: 'checkbox', checked: true });
  const zipBox = el('span');
  const zipLink = () => { if (!zipBox.childElementCount) zipBox.append(el('a', { class: 'button', href: `/api/workshop/zip?id=${enc(P.id)}` }, '⬇ Download as zip')); };
  if (P.built) zipLink();
  const run = (label, fn) => el('button', { onclick: guard(async (e) => { e.target.disabled = true; try { await fn(); } finally { e.target.disabled = false; } }) }, label);
  const build = async () => {
    await saveNow();
    toast('Building…');
    const r = await api.post('/api/workshop/build', { id: P.id });
    out.classList.remove('hidden');
    if (!r.ok) { out.textContent = 'Not built:\n' + r.problems.join('\n'); return false; }
    out.textContent = (r.warnings.length ? 'Warnings:\n' + r.warnings.join('\n') + '\n\n' : '') + 'Files:\n' + r.files.join('\n');
    zipLink();
    P.built = true; setStatus(); toast(`Built: ${r.objects.length} objects`);
    return true;
  };
  const remake = el('div', { class: 'note' });
  const tryRemake = async (start = true) => {
    const r = await api.post('/api/workshop/remake', { id: P.id, start: start !== false });
    if (r.ready) {
      const first = P.objects.find((o) => o.kind !== 'decoration');
      const tribe = (first && (S.tpl[(P.base || '') + '|' + first.template] || {}).tribe) || 'Hu';
      const spawn = P.objects.filter((o) => o.kind !== 'decoration').map((o) => o.id).join(',');
      const url = `${r.url}index.html?quick&tribe=${['Hu', 'Aje', 'Ninigi', 'SEAS'].includes(tribe) ? tribe : 'Hu'}&spawn=${enc(spawn)}&cheats=${enc(JSON.stringify({ free: true }))}`;
      remake.innerHTML = '';
      remake.append(el('a', { class: 'button primary', href: url, target: '_blank' }, '▶ Play in the remake'), ' a skirmish with your objects beside your start (debug: everything free and instant)');
      return;
    }
    remake.textContent = `The remake prepares the game data of ${P.id}… ${Math.round(((r.state && r.state.frac) || 0) * 100)}% (the first time several minutes)`;
    setTimeout(guard(() => tryRemake(false)), 3000);
  };
  return el('div', {},
    el('h1', { text: P.title || P.id }),
    el('p', { class: 'lead', html: `Mod <code>${P.id}</code> · builds on ${P.base || 'the official game'} · ${P.objects.length} object${P.objects.length === 1 ? '' : 's'}` }),
    el('div', { class: 'card' }, el('h3', { text: 'The mod' }), el('div', { class: 'grid' },
      el('label', { text: 'Title' }), el('input', { type: 'text', value: P.title || '', onchange: (e) => { P.title = e.target.value; changed(); } }),
      el('label', { text: 'Version' }), el('input', { type: 'text', value: P.version || '1.0', onchange: (e) => { P.version = e.target.value; changed(); } }))),
    el('div', { class: 'card' }, el('h3', { text: '1. Build' }),
      el('p', { class: 'note', text: 'Writes the mod\'s files: the models into one archive, the tech tree, the class lists, the texts, the icons.' }),
      el('div', { class: 'actions' }, run('Build the mod', build), zipBox), out),
    el('div', { class: 'card' }, el('h3', { text: '2. Install into ParaWorld' }),
      el('p', { class: 'note', html: `Copies <code>Data\\${P.id}</code> and <code>Data\\Info\\${P.id}.info</code> into your game folder. Uninstall removes them again.` }),
      el('label', {}, langs, ' Also let the game read the mod\'s texts (adds one line to Data\\Info\\Locale_<language>.info; a copy of the file is kept)'),
      el('div', { class: 'actions' },
        run('Build & install', async () => { if (!(await build())) return; await api.post('/api/workshop/install', { id: P.id, langs: langs.checked }); P.installed = true; setStatus(); toast('Installed'); }),
        run('Uninstall', async () => { await api.post('/api/workshop/uninstall', { id: P.id }); P.installed = false; setStatus(); toast('Removed from the game'); }), status)),
    el('div', { class: 'card' }, el('h3', { text: '3. Play' }),
      el('p', { class: 'note', html: `ParaWorld starts a mod with <code>PWClient.exe -enable ${P.id}</code>. Units and buildings are made where their template is made; wild animals and decorations go onto maps with the level editor (or the remake's debug tools: "Put down an object").` }),
      el('div', { class: 'actions' }, run('▶ Start ParaWorld with the mod', async () => { const r = await api.post('/api/workshop/launch', { id: P.id }); toast(r.ok ? 'ParaWorld starts…' : r.error, !r.ok); }),
        run('Try it in the remake', () => tryRemake(true))), remake),
    el('div', { class: 'card' }, el('h3', { text: 'Objects' }), el('ul', {}, P.objects.map((o) => el('li', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); S.obj = o.id; S.step = 'what'; render(); } }, (o.texts && o.texts.name) || o.id), ` - ${KIND_INFO[o.kind][0]} like ${o.template}`))),
      el('div', { class: 'actions' }, el('button', { onclick: () => newObjectDialog() }, 'New object…'),
        el('button', { onclick: guard(async () => { if (!confirm(`Delete the project ${P.id} (not what is installed in the game)?`)) return; await api.post('/api/workshop/project/delete', { id: P.id }); S.project = null; S.state = await api.get('/api/workshop/state'); renderProjects(); render(); }) }, 'Delete the project'))));
}

// ---------------------------------------------------------------------------- the 3D view
async function preview(o) {
  await saveNow();
  return api.get(`/api/workshop/preview?project=${enc(S.project.id)}&obj=${enc(o.id)}`);
}
let shownKey = '';
async function showModel(o) {
  const key = JSON.stringify([S.project.id, o.id, o.model.source, o.model.file, o.model.name, o.template]);
  if (key === shownKey) return;
  shownKey = key;
  $('#view-note').textContent = 'Loading the model…';
  try {
    const p = await preview(o);
    if (shownKey !== key) return;
    await viewer.show([{ url: p.url + '?v=' + Date.now() }]);
    const sel = $('#anim'); sel.innerHTML = '';
    sel.append(el('option', { value: '' }, 'rest pose'), ...p.anims.map((a) => el('option', { value: a }, a)));
    const idle = p.anims.find((a) => a === 'standanim') || p.anims.find((a) => /^standanim|^idle/.test(a)) || p.anims.find((a) => /idle/.test(a) && !/^ns\d/i.test(a));
    if (idle) { sel.value = idle; viewer.play(0, idle); }
    $('#view-note').textContent = `${p.fourcc} · ${p.anims.length} animations · ${p.links.length} links`;
  } catch (e) {
    $('#view-note').textContent = e.message;
    viewer.clear();
  }
}

// the 3D view as the object's icon
async function snapIcon() {
  const o = cur();
  if (!o) return toast('Pick an object first', true);
  const c = viewer.renderer.domElement, s = Math.min(c.width, c.height);
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  cv.getContext('2d').drawImage(c, (c.width - s) / 2, (c.height - s) / 2, s, s, 0, 0, 128, 128);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const r = await api.upload(S.project.id, new File([blob], `${o.id}_icon.png`, { type: 'image/png' }));
  o.icon = r.file; changed(true); toast('Icon taken from the view');
}

boot().catch((e) => { $('#main').textContent = 'The Workshop could not start: ' + e.message; });
