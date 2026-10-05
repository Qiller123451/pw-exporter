// Draw a generated map as a picture (PPM): node tests/mapview.mjs frost out.ppm [scale]
// colours: the ground materials shaded by the slope, water blue, objects as dots
import fs from 'fs';
const [name, out, sc] = process.argv.slice(2);
const mod = await import('../web/src/game/maps/' + name + '.js');
const t0 = Date.now();
const md = mod.build();
const ms = Date.now() - t0;
const n = md.hx, m = md.mx, S = +(sc || 1);
const COL = [[96, 118, 40], [120, 112, 100], [128, 110, 84], [170, 160, 140], [92, 92, 96], [232, 238, 244], [150, 170, 150], [176, 186, 198]];
const W = n * S, buf = Buffer.alloc(W * W * 3);
const H = (i, j) => md.heights[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))];
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
  const i = Math.floor(x / S), jf = n - 1 - Math.floor(y / S);          // picture: north up -> file row from the top
  const h = H(i, jf), mat = md.mats[Math.min(m - 1, Math.floor(jf / 2)) * m + Math.min(m - 1, Math.floor(i / 2))] & 7;
  let c = COL[mat];
  const sh = 1 + Math.max(-0.5, Math.min(0.5, (H(i - 1, jf + 1) - H(i + 1, jf - 1)) * 0.12));
  let r = c[0] * sh, g = c[1] * sh, b = c[2] * sh;
  if (h < md.water) { const d = Math.min(1, (md.water - h) / 6); r = r * (1 - d) * 0.6 + 30 * d; g = g * (1 - d) * 0.6 + 70 * d; b = b * (1 - d) * 0.6 + 120 * d + 30; }
  else if (Math.floor(h / 10) !== Math.floor(H(i + 1, jf) / 10) || Math.floor(h / 10) !== Math.floor(H(i, jf + 1) / 10)) { r *= 0.7; g *= 0.7; b *= 0.7; }
  const o = (y * W + x) * 3; buf[o] = Math.min(255, r); buf[o + 1] = Math.min(255, g); buf[o + 2] = Math.min(255, b);
}
const dot = (mx, my, r, c) => { const px = Math.round(mx / 2 * S), py = Math.round((md.h - my) / 2 * S); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const x = px + dx, y = py + dy; if (x < 0 || y < 0 || x >= W || y >= W) continue; const o = (y * W + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; } };
const kinds = {};
for (const o of md.objects) {
  kinds[o.cls] = (kinds[o.cls] || 0) + 1;
  const c = o.type === 'TREE' ? [20, 70, 20] : o.type === 'VGTN' ? [60, 110, 40] : o.type === 'BLDG' ? [200, 40, 30] : [70, 60, 50];
  dot(o.x, o.y, o.type === 'BLDG' ? 2 : o.type === 'TREE' ? 1 : 0, c);
}
fs.writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${W} ${W}\n255\n`), buf]));
let lo = 1e9, hi = -1e9; for (const v of md.heights) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
console.log(JSON.stringify({ ms, size: md.w, heights: [lo.toFixed(1), hi.toFixed(1)], objects: md.objects.length, kinds: Object.keys(kinds).length }));
