// Map list and previews for the skirmish menu.
//   listMaps()            -> [{path, size, folder, file}] from maps/index.json (server.ps1 lists the game's map folders:
//                            maps/<pack>/<sub folders>/<file>.ula; folder = "<pack> / <sub folders>")
//   loadMapInfo(src)      -> parsed map (maps/ula.js) for a path or an ArrayBuffer, cached
//   drawPreview(canvas, md, colors) -> top view: ground colours, water, start locations
import { parseUla } from '../game/maps/ula.js';

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

const settingColors = new Map();
export async function colorsOf(setting) {
  if (!settingColors.has(setting)) {
    settingColors.set(setting, fetch(`assets/terrain/${setting}/setting.json`).then((r) => r.json()).then((j) => j.minimap).catch(() => null));
  }
  return settingColors.get(setting);
}

// top view of the map (north up), start locations as numbered dots
export async function drawPreview(canvas, md) {
  const cols = (await colorsOf(md.setting)) || [[110, 140, 60], [190, 170, 120], [80, 130, 50], [150, 100, 60], [120, 120, 110], [200, 180, 130], [170, 150, 110], [140, 120, 90]];
  const S = canvas.width, ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const W2 = md.hx * 2, H2 = md.hy * 2, ext = Math.max(W2, H2);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const mx = (i + 0.5) / S * ext - (ext - W2) / 2, my = H2 - ((j + 0.5) / S * ext - (ext - H2) / 2);
    const k = (j * S + i) * 4;
    if (mx < 0 || my < 0 || mx >= W2 || my >= H2) { img.data[k + 3] = 0; continue; }
    const hgt = md.heights[Math.floor(my / 2) * md.hx + Math.floor(mx / 2)];
    const m = md.mats[Math.floor(my / 4) * md.mx + Math.floor(mx / 4)] & 7;
    let [r, g, b] = cols[m] || [128, 128, 128];
    const l = 0.75 + Math.min(0.5, hgt / 120);
    r *= l; g *= l; b *= l;
    if (hgt < md.water - 0.3) { const d = Math.min(1, (md.water - hgt) / 10); r = 40 - 25 * d; g = 105 - 50 * d; b = 140 - 40 * d; }
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.font = 'bold 11px Trebuchet MS'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  md.objects.filter((o) => o.type === 'SLOC').forEach((o, n) => {
    const x = (o.x + (ext - W2) / 2) / ext * S, y = (H2 - o.y + (ext - H2) / 2) / ext * S;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#ffd860'; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 6.29); ctx.fill();
    ctx.fillStyle = '#000'; ctx.fillText(String(n + 1), x, y + 0.5);
  });
}
