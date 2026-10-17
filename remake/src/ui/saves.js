// Saved games in the browser (IndexedDB "pwr-saves"; the same store for every game data configuration of the
// page) and as files. A save is gzip-compressed JSON {meta, snap}: meta = {id, name, date, title, gameTime, mod, cfg,
// quick}, snap = game/save.js snapshot(). Files (.pwsave) hold the same thing.
const DB = 'pwr-saves', STORE = 'saves', QUICK = 'quick';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function run(mode, fn) {
  const db = await open();
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
      const r = fn(st);
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('the save store refused it (full?)'));
    });
  } finally { db.close(); }
}
async function gzip(text) {
  if (typeof CompressionStream === 'undefined') return new Blob([text], { type: 'application/json' });
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
async function gunzip(blob) {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return blob.text();          // plain JSON
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

// [{id, name, date, title, gameTime, mod, cfg, quick, size}] newest first
export async function listSaves() {
  const all = (await run('readonly', (st) => st.getAll())) || [];
  return all.map(({ data, ...meta }) => ({ ...meta, size: data ? data.size : 0 })).sort((a, b) => b.date - a.date);
}
// store a snapshot; meta: {name, title, gameTime, mod, cfg, quick}; the quick save has a fixed slot
export async function putSave(meta, snap) {
  const id = meta.quick ? QUICK : meta.id || 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const m = { ...meta, id, date: Date.now() };
  const data = await gzip(JSON.stringify({ meta: m, snap }));
  await run('readwrite', (st) => st.put({ ...m, data }));
  return m;
}
export async function getSave(id) {
  const e = await run('readonly', (st) => st.get(id));
  if (!e) throw new Error('the saved game is gone');
  return JSON.parse(await gunzip(e.data));
}
export async function deleteSave(id) { await run('readwrite', (st) => st.delete(id)); }
export const quickId = QUICK;

// the save as a file download
export async function exportSave(id) {
  const e = await run('readonly', (st) => st.get(id));
  if (!e) throw new Error('the saved game is gone');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(e.data);
  a.download = (e.name || 'paraworld').replace(/[^\w\- ]+/g, '_').trim() + '.pwsave';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// a .pwsave file into the store (a new slot); returns its meta
export async function importSave(file) {
  const doc = JSON.parse(await gunzip(file));
  if (!doc || !doc.meta || !doc.snap) throw new Error('not a saved game');
  const { id, quick, ...meta } = doc.meta;
  return putSave({ ...meta, name: meta.name || file.name.replace(/\.pwsave$/i, '') }, doc.snap);
}
