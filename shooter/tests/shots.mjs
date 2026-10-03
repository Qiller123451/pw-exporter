// Several screenshots in one page session.
//   node shots.mjs <url> <out dir> <steps.mjs>
// steps.mjs exports default [{ name, js (string evaluated in the page), wait (ms, default 400) }, ...]
import { createRequire } from 'module';
import path from 'path';
import { pathToFileURL } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, outDir, stepsFile] = process.argv.slice(2);
const steps = (await import(pathToFileURL(path.resolve(stepsFile)))).default;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) logs.push('error: ' + m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + (e.stack || e.message)));
await page.goto(url);
await page.waitForFunction(() => window.G && (window.G.ready || window.G.error), null, { timeout: 240000 });
const results = {};
for (const s of steps) {
  await page.evaluate(() => { window.__freeze = true; });
  try { results[s.name] = await page.evaluate(s.js); } catch (e) { results[s.name] = 'EVAL: ' + e.message.split('\n')[0]; }
  await page.evaluate(() => { window.__freeze = false; });
  await page.waitForTimeout(s.wait ?? 400);
  await page.evaluate(() => { window.__freeze = true; });
  await page.waitForTimeout(250);
  if (!s.noshot) try { await page.screenshot({ path: path.join(outDir, s.name + '.png'), timeout: 120000 }); } catch (e) { logs.push('SCREENSHOT ' + s.name + ': ' + e.message.split('\n')[0]); }
}
const err = await page.evaluate(() => window.G && window.G.error);
if (err) logs.push('G.error: ' + err);
console.log(JSON.stringify({ results, logs: [...new Set(logs)].slice(0, 30) }, null, 1));
await browser.close();
