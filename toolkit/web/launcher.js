// The ParaWorld Toolkit launcher: asks where the game is, then offers the Model & Map Exporter and the remake.
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
  get: async (u) => (await fetch(u)).json(),
  post: async (u, d) => (await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d || {}) })).json(),
};

const T = {
  en: {
    title: 'ParaWorld Toolkit',
    hello: 'Welcome to the ParaWorld Toolkit',
    lead: 'Explore and export the models and maps of your ParaWorld installation, or play the remake.',
    where: 'Where is ParaWorld installed?',
    whereHint: 'The folder that contains "Data" (for example C:\\Program Files (x86)\\Sunflowers\\ParaWorld). The toolkit reads the game files from there; nothing is copied anywhere else or sent anywhere.',
    found: 'Found on this computer:',
    browse: 'Browse…', go: 'Continue', notPw: 'This folder does not look like a ParaWorld installation (Data\\Base\\GSF is missing).',
    lang: 'Language',
    exporter: 'Model & Map Exporter',
    exporterText: 'Every unit, building, animal and map of the game in 3D.',
    exporterList: ['Animations, add-ons (riders, turrets, build-ups), player colours', 'Export as GLB, glTF, OBJ, Collada, STL, PLY (FBX & Blender via Blender)', 'Map viewer: terrain, objects, export to 3D files, height maps and Kaitai Struct data'],
    open: 'Open',
    loadingExp: (s, p) => `Reading the game files… ${p}% ${s || ''}`,
    remake: 'ParaWorld Remake',
    remakeText: 'The game rebuilt for the browser, with the models, sounds, maps and rules of your installation.',
    remakeList: ['The campaign\'s 17 missions, playable with any tribe and with a mod', 'Skirmish against the computer on the original maps or random maps', 'Containment (1964): a new SEAS campaign of ten missions (needs MIRAGE)'],
    play: 'Play', prepare: 'Prepare the game data', rebuild: 'Rebuild game data',
    ready: 'Ready', notReady: 'Game data not prepared yet', building: 'Preparing…', failed: 'Preparing failed',
    reasons: { 'not built': 'The first start converts the models, textures and rules of your installation (about 5–15 minutes, once).',
      'toolkit updated': 'The toolkit was updated: the parts of the game data it affects have to be prepared again.', 'game files changed': 'Your game files changed: the parts of the game data they affect have to be prepared again.',
      'last build failed': 'The last attempt failed. Try again, or look at the log.', 'no installation': 'Choose the game folder first.' },
    noCode: 'The remake\'s game code (remake/game/game.js) is missing from this copy of the toolkit.',
    stage: { rules: 'Reading the rules', models: 'Converting models', assets: 'Collecting models', ui: 'Interface', menu: 'Menu art', cursors: 'Cursors', terrain: 'Ground textures', sounds: 'Sounds', done: 'Done', failed: 'Failed', starting: 'Starting' },
    elapsed: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`,
    gameAt: 'Game folder:', change: 'Change', dataAt: 'Toolkit data:', github: 'About & help',
    builtIn: (s) => `prepared in ${Math.round(s / 60)} min`,
    dataTip: 'The converted models and the remake\'s game data (several GB). Change moves them to another folder, e.g. onto another drive.',
    dataPick: 'Where should the toolkit keep its data?',
    dataAsk: (size, to) => `Move the toolkit's data (${size}) to\n${to}?\n\nThe game data can't be prepared while it moves.`,
    dataMoving: (p) => `Moving the toolkit's data… ${p}%`, dataWait: 'Waiting for the film conversion to stop…',
    dataWhere: (p) => `It is stored in ${p} (Toolkit data, below: Change moves it, e.g. onto another drive).`,
    dataEnv: '(set by PWTOOLKIT_DATA)', dataFailed: 'Could not move the data:',
  },
  de: {
    title: 'ParaWorld Toolkit',
    hello: 'Willkommen beim ParaWorld Toolkit',
    lead: 'Modelle und Karten deiner ParaWorld-Installation ansehen und exportieren – oder das Remake spielen.',
    where: 'Wo ist ParaWorld installiert?',
    whereHint: 'Der Ordner, in dem „Data“ liegt (zum Beispiel C:\\Programme (x86)\\Sunflowers\\ParaWorld). Das Toolkit liest die Spieldateien von dort; nichts wird woandershin kopiert oder verschickt.',
    found: 'Auf diesem Computer gefunden:',
    browse: 'Durchsuchen…', go: 'Weiter', notPw: 'Dieser Ordner sieht nicht wie eine ParaWorld-Installation aus (Data\\Base\\GSF fehlt).',
    lang: 'Sprache',
    exporter: 'Modell- & Karten-Exporter',
    exporterText: 'Alle Einheiten, Gebäude, Tiere und Karten des Spiels in 3D.',
    exporterList: ['Animationen, Anbauteile (Reiter, Türme, Aufbauten), Spielerfarben', 'Export als GLB, glTF, OBJ, Collada, STL, PLY (FBX & Blender über Blender)', 'Karten-Ansicht: Gelände, Objekte, Export als 3D-Datei, Höhenkarte und Kaitai-Struct-Daten'],
    open: 'Öffnen',
    loadingExp: (s, p) => `Spieldateien werden gelesen… ${p}% ${s || ''}`,
    remake: 'ParaWorld Remake',
    remakeText: 'Das Spiel für den Browser nachgebaut – mit den Modellen, Klängen, Karten und Regeln deiner Installation.',
    remakeList: ['Die 17 Missionen der Kampagne, mit jedem Volk und mit einer Mod spielbar', 'Gefechte gegen den Computer auf den Originalkarten oder Zufallskarten', 'Containment (1964): eine neue SEAS-Kampagne mit zehn Missionen (braucht MIRAGE)'],
    play: 'Spielen', prepare: 'Spieldaten vorbereiten', rebuild: 'Spieldaten neu erstellen',
    ready: 'Bereit', notReady: 'Spieldaten noch nicht vorbereitet', building: 'Wird vorbereitet…', failed: 'Vorbereitung fehlgeschlagen',
    reasons: { 'not built': 'Beim ersten Start werden Modelle, Texturen und Regeln deiner Installation umgewandelt (etwa 5–15 Minuten, einmalig).',
      'toolkit updated': 'Das Toolkit wurde aktualisiert: die betroffenen Teile der Spieldaten müssen neu vorbereitet werden.', 'game files changed': 'Deine Spieldateien haben sich geändert: die betroffenen Teile der Spieldaten müssen neu vorbereitet werden.',
      'last build failed': 'Der letzte Versuch ist fehlgeschlagen. Versuche es erneut oder sieh ins Protokoll.', 'no installation': 'Wähle zuerst den Spielordner.' },
    noCode: 'Der Spielcode des Remakes (remake/game/game.js) fehlt in dieser Kopie des Toolkits.',
    stage: { rules: 'Regeln lesen', models: 'Modelle umwandeln', assets: 'Modelle sammeln', ui: 'Oberfläche', menu: 'Menügrafik', cursors: 'Mauszeiger', terrain: 'Bodentexturen', sounds: 'Klänge', done: 'Fertig', failed: 'Fehlgeschlagen', starting: 'Start' },
    elapsed: (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} Min.`,
    gameAt: 'Spielordner:', change: 'Ändern', dataAt: 'Toolkit-Daten:', github: 'Info & Hilfe',
    builtIn: (s) => `in ${Math.round(s / 60)} Min. vorbereitet`,
    dataTip: 'Die umgewandelten Modelle und die Spieldaten des Remakes (mehrere GB). „Ändern“ verschiebt sie in einen anderen Ordner, z. B. auf ein anderes Laufwerk.',
    dataPick: 'Wo soll das Toolkit seine Daten ablegen?',
    dataAsk: (size, to) => `Die Toolkit-Daten (${size}) nach\n${to}\nverschieben?\n\nSolange sie verschoben werden, können keine Spieldaten vorbereitet werden.`,
    dataMoving: (p) => `Toolkit-Daten werden verschoben… ${p}%`, dataWait: 'Warte, bis die Filmumwandlung anhält…',
    dataWhere: (p) => `Sie werden in ${p} abgelegt (Toolkit-Daten, unten: „Ändern“ verschiebt sie, z. B. auf ein anderes Laufwerk).`,
    dataEnv: '(durch PWTOOLKIT_DATA festgelegt)', dataFailed: 'Die Daten konnten nicht verschoben werden:',
  },
};
let L = T.en;
let ST = null;
let editing = false;
let dataErr = '';
let timer = null;
const later = (ms) => { if (!timer) timer = setTimeout(() => { timer = null; refresh(); }, ms); };   // one poll at a time

async function refresh() {
  ST = await api.get('/api/toolkit/state');
  const lang = (ST.settings && ST.settings.ui_lang) || 'en';
  L = T[lang] || T.en;
  $('#lang').value = lang;
  document.title = L.title; $('#t-title').textContent = L.title;
  if (!ST.configured || editing) setup(); else home();
  footer();
}

function setup(err) {
  const m = $('#main');
  m.innerHTML = '';
  let path = ST.settings.install || (ST.candidates || [])[0] || '';
  const inp = el('input', { type: 'text', value: path, spellcheck: 'false', oninput: (e) => { path = e.target.value; } });
  const er = el('div', { class: 'err', text: err || '' });
  const card = el('div', { class: 'card' },
    el('h2', { text: L.where }), el('p', { text: L.whereHint }),
    el('div', { class: 'row' }, inp, el('button', { onclick: async () => {
      const r = await api.post('/api/browse', { title: L.where, initial: path });
      if (r.path) { path = r.path; inp.value = path; }
    } }, L.browse)));
  if ((ST.candidates || []).length) {
    const cs = el('div', { class: 'cands' });
    for (const p of ST.candidates) cs.append(el('button', { onclick: () => { path = p; inp.value = p; } }, p));
    card.append(el('div', { class: 'note', text: L.found }), cs);
  }
  card.append(er, el('div', { class: 'actions' }, el('button', { class: 'primary', onclick: async () => {
    const lang = $('#lang').value;
    const r = await api.post('/api/setup', { install: path, ui_lang: lang, lang: lang === 'de' ? 'de' : 'uk' });
    if (!r.ok) { er.textContent = L.notPw; return; }
    editing = false;
    refresh();
  } }, L.go)));
  m.append(el('div', { class: 'setup' }, el('h1', { text: L.hello }), el('p', { class: 'lead', text: L.lead }), card));
}

function home() {
  const m = $('#main');
  m.innerHTML = '';
  m.append(el('h1', { text: L.hello }), el('p', { class: 'lead', text: L.lead }));
  const P = ST.progress || {};
  // exporter card
  const expStatus = P.ready ? el('span', { class: 'status ok', text: L.ready })
    : P.error ? el('span', { class: 'status bad', text: P.error }) : el('span', { class: 'status warn', text: L.loadingExp(P.stage, Math.round((P.frac || 0) * 100)) });
  const exp = el('div', { class: 'card' },
    el('h2', {}, el('span', { class: 'ico', text: '🦕' }), L.exporter),
    el('p', { text: L.exporterText }), el('ul', {}, L.exporterList.map((t) => el('li', { text: t }))),
    el('div', { class: 'actions' }, el('a', { class: 'button primary', href: '/exporter/', id: 'open-exporter' }, L.open), expStatus));
  // remake card
  const R = ST.remake || {};
  const rem = el('div', { class: 'card', id: 'remake-card' },
    el('h2', {}, el('span', { class: 'ico', text: '⚔' }), L.remake),
    el('p', { text: L.remakeText }), el('ul', {}, L.remakeList.map((t) => el('li', { text: t }))));
  const act = el('div', { class: 'actions' });
  if (!R.code) rem.append(el('p', { class: 'err', text: L.noCode }));
  if (R.building) {
    const f = Math.round((R.frac || 0) * 100);
    rem.append(el('div', { class: 'note', text: `${L.building} ${f}% · ${L.stage[R.stage] || R.stage} · ${L.elapsed(R.elapsed || 0)}` }),
      el('div', { class: 'progress' }, el('i', { style: `width:${f}%` })), el('div', { class: 'log', text: (R.log || []).join('\n') }));
  } else if (R.ready) {
    act.append(el('a', { class: 'button primary', href: '/remake/', id: 'play' }, L.play),
      el('span', { class: 'status ok', text: L.ready + (R.built && R.built.seconds >= 30 ? ' · ' + L.builtIn(R.built.seconds) : '') }),
      el('button', { onclick: () => build(true), title: L.rebuild }, '↻'));
  } else {
    rem.append(el('p', { class: 'note', text: (L.reasons[R.reason] || R.reason || '') + (ST.data ? ' ' + L.dataWhere(ST.data.path) : '') }));
    if (R.error) rem.append(el('div', { class: 'log', text: R.error + '\n' + (R.log || []).slice(-12).join('\n') }));
    act.append(el('button', { class: 'primary', id: 'prepare', onclick: () => build(false), disabled: !R.code || !ST.install_path }, L.prepare),
      el('span', { class: 'status ' + (R.error ? 'bad' : 'warn'), text: R.error ? L.failed : L.notReady }));
  }
  rem.append(act);
  m.append(el('div', { class: 'cards' }, exp, rem));
  if (R.building || !P.ready) later(1200);
}

// the "prepare" button redoes only what is out of date, the rebuild button (↻) everything
async function build(force) {
  await api.post('/api/toolkit/remake/build', { force: !!force });
  refresh();
}

function footer() {
  const f = $('#foot');
  f.innerHTML = '';
  if (ST.install_path) {
    f.append(el('span', {}, L.gameAt + ' ', el('code', { text: ST.install_path })), el('button', { onclick: () => { editing = true; setup(); } }, L.change));
  }
  const D = ST.data || { path: ST.home };
  const data = el('span', { title: L.dataTip }, L.dataAt + ' ', el('code', { text: D.path || '' }));
  if (D.moving) {
    const pc = D.moving.total ? Math.floor(100 * D.moving.done / D.moving.total) : 0;
    data.append(' ', el('span', { class: 'status warn', text: D.moving.stage === 'waiting' ? L.dataWait : L.dataMoving(pc) }));
    later(1000);
  } else if (D.env) data.append(' ' + L.dataEnv);
  else data.append(' ', el('button', { onclick: moveData }, L.change));
  const err = dataErr || D.error;
  if (err) data.append(' ', el('span', { class: 'status bad', text: L.dataFailed + ' ' + err }));
  f.append(data);
  f.append(el('span', { text: `v${ST.toolkit || ''}` }));
}

// "Toolkit data: Change": a folder from the native dialog, then the data moves there (toolkit/datadir.py)
async function moveData() {
  const r = await api.post('/api/browse', { title: L.dataPick, initial: (ST.data && ST.data.path) || '' });
  if (!r.path) return;
  const D = await api.get('/api/toolkit/data?size=1');
  const gb = D.size >= 1e9 ? (D.size / 1e9).toFixed(1) + ' GB' : Math.round(D.size / 1e6) + ' MB';
  if (!confirm(L.dataAsk(gb, r.path))) return;
  const m = await api.post('/api/toolkit/data', { path: r.path });
  dataErr = m.ok ? '' : m.error || 'failed';
  refresh();
}

$('#lang').onchange = async (e) => {
  const lang = e.target.value;
  await api.post('/api/settings', { ui_lang: lang });
  refresh();
};
refresh();
