// Headless check: open the game, wait until it is ready, optionally run a script, save a screenshot.
//   node shot.mjs <url> <out.png> [js file to evaluate in the page | - ] [wait ms after]
// Needs playwright (NODE_PATH) and a Chromium with software WebGL.
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [url, out, jsFile, waitMs] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning' || process.env.LOG) logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + (e.stack || e.message)));
page.on('requestfailed', (r) => logs.push('REQFAILED: ' + r.url()));
page.on('response', (r) => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ': ' + r.url()); });
await page.goto(url);
try {
  await page.waitForFunction(() => window.G && (window.G.ready || window.G.error), null, { timeout: +(process.env.TIMEOUT || 180000) });
} catch (e) { logs.push('TIMEOUT waiting for G.ready'); }
let result = null;
if (jsFile && jsFile !== '-') {
  try { result = await page.evaluate(fs.readFileSync(jsFile, 'utf8')); } catch (e) { logs.push('EVAL: ' + e.message); }
}
await page.waitForTimeout(+(waitMs || 1500));
const err = await page.evaluate(() => window.G && window.G.error);
if (err) logs.push('G.error: ' + err);
// software WebGL renders slowly: stop the game's frame loop while the screenshot is taken (main.js honours __freeze)
await page.evaluate(() => { window.__freeze = true; });
await page.waitForTimeout(300);
if (out && out !== '-') { try { await page.screenshot({ path: out, timeout: +(process.env.SHOT_TIMEOUT || 120000) }); } catch (e) { logs.push('SCREENSHOT: ' + e.message.split('\n')[0]); } }
console.log(JSON.stringify({ result, logs: [...new Set(logs)].slice(0, 40) }, null, 1));
await browser.close();
