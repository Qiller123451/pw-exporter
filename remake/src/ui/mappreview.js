// Map list and previews for the skirmish menu.
//   listMaps()            -> [{path, size, folder, file}] from maps/index.json (server.ps1 lists the game's map folders:
//                            maps/<pack>/<sub folders>/<file>.ula; folder = "<pack> / <sub folders>")
//   loadMapInfo(src)      -> parsed map (maps/ula.js) for a path or an ArrayBuffer, cached
//   drawPreview(canvas, md)  -> the map's own preview picture (the original map list's)
import { parseUla } from '../game/maps/ula.js';
import { reliefCells, paintCells, snapDiamond } from './minimap.js';

const cache = new Map();

export async function listMaps() {
  try {
    const r = await fetch('maps/index.json');
    if (!r.ok) return [];
    const list = await r.json();
    return list.map((m) => {
      const parts = m.path.split('/');
      return { ...m, file: parts[parts.length - 1], folder: parts.slice(1, -1).join(' / ') };
    }).sort((a, b) => (a.folder.startsWith('Base') ? 0 : 1) - (b.folder.startsWith('Base') ? 0 : 1) || a.folder.localeCompare(b.folder) || a.file.localeCompare(b.file));
  } catch (e) { return []; }
}

export async function loadMapInfo(path, buf) {
  const key = path;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    if (!buf) {
      const r = await fetch(path.split('/').map(encodeURIComponent).join('/'));
      if (!r.ok) throw new Error('map not found');
      buf = await r.arrayBuffer();
    }
    return parseUla(buf, path.split('/').pop());
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

const tables = new Map();
function tableOf(setting) {
  if (!tables.has(setting)) {
    tables.set(setting, fetch(`assets/terrain/${setting}/setting.json`).then((r) => r.json()).then((j) => (Array.isArray(j.minimap) && j.minimap.length === 6 ? j.minimap : null)).catch(() => null));
  }
  return tables.get(setting);
}

// the map list's picture: the preview the map stores (LInf; drawn by the engine's minimap renderer when the map was
// saved: a diamond in the setting's minimap colours with the start locations), else one drawn the same way here
export async function drawPreview(canvas, md) {
  const S = canvas.width, ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  if (md.preview) {
    const c = document.createElement('canvas'); c.width = md.preview.w; c.height = md.preview.h;
    c.getContext('2d').putImageData(new ImageData(md.preview.rgba, md.preview.w, md.preview.h), 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c, 0, 0, S, S);
    return;
  }
  const table = await tableOf(md.setting);
  if (!table) return;
  // the playable area (the map minus 128 m on every side) in 4 m cells
  const W2 = md.hx * 2, H2 = md.hy * 2, gw = Math.max(1, Math.round((W2 - 256) / 4)), gh = Math.max(1, Math.round((H2 - 256) / 4));
  const hAt = (i, j) => md.heights[Math.min(md.hy - 1, Math.floor((128 + j * 4 + 2) / 2)) * md.hx + Math.min(md.hx - 1, Math.floor((128 + i * 4 + 2) / 2))];
  const col = reliefCells(gw, gh, hAt, md.water);
  const cells = document.createElement('canvas'); cells.width = gw; cells.height = gh;
  const img = cells.getContext('2d').createImageData(gw, gh);
  paintCells(img.data, col, null, table, () => 2);
  cells.getContext('2d').putImageData(img, 0, 0);
  const k = S / Math.hypot(gw, gh);
  ctx.save();
  ctx.translate(S / 2, S / 2); ctx.rotate(snapDiamond(Math.PI / 2 - md.defaultCamera)); ctx.scale(k, k);
  ctx.drawImage(cells, -gw / 2, -gh / 2);
  ctx.restore();
}
