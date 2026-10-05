// Several pictures of one loaded game: node views.mjs <url> <out dir> <views.js>
//   views.js: a module  export default [{ name, js }, ...]   (js: evaluated in the page before the picture - put the
//   player or a free camera somewhere, start a fight ...; helpers: CAM(x, z, h, tx, tz, th) = free camera, heights
//   above the ground; HUD(false) hides the HUD; RUN(seconds, each) = G.test.run)
//   export const setup = '...'  is evaluated once after loading.
// The game is loaded once; pictures are saved as <out dir>/<name>.png.
import { createRequire } from 'module';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir, viewsFile] = process.argv.slice(2);
const mod = await import(path.resolve(viewsFile));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: +(process.env.W || 960), height: +(process.env.H || 540) } });
const logs = [];
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + (e.stack || e.message)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) logs.push('error: ' + m.text()); });
await page.goto(url);
await page.waitForFunction(() => window.G && (window.G.ready || window.G.error), null, { timeout: 600000 });
const pre = `window.CAM = (x, z, h, tx, tz, th) => { G.player.ch.actor.obj.visible = false; G.debugCam = (cam) => { cam.position.set(x, G.level.height(x, z) + h, z); cam.up.set(0, 1, 0); cam.lookAt(tx, G.level.height(tx, tz) + th, tz); }; };
  window.HUD = (on) => { for (const e of document.querySelectorAll('.hud, #hud')) e.style.display = on ? '' : 'none'; };
  window.RUN = (s, each) => G.test.run(s, each);`;
console.log(await page.evaluate(`(() => { ${pre}; ${mod.setup || ''}; return JSON.stringify({ nav: G.nav.cells, zones: G.zones.report.leaks, err: G.error || null }); })()`));
for (const v of mod.default) {
  let res = null;
  try { res = await page.evaluate(`(() => { window.__freeze = false; const r = (() => { ${v.js} })(); G.test.run(0.05); return r === undefined ? null : JSON.stringify(r); })()`); } catch (e) { console.log('EVAL', v.name, e.message.split('\n')[0]); }
  await page.waitForTimeout(+(process.env.WAIT || 1200));
  await page.evaluate(() => { window.__freeze = true; });
  await page.waitForTimeout(300);
  try { await page.screenshot({ path: `${outDir}/${v.name}.png`, timeout: 900000 }); console.log('saved', v.name, res || ''); } catch (e) { console.log('FAILED', v.name, e.message.split('\n')[0]); }
}
if (logs.length) console.log([...new Set(logs)].slice(0, 10).join('\n'));
await browser.close();
