// Bundle the remake: src/main.js -> game/game.js, index.src.html -> game/index.html.
// Run `npm install` once, then `npm run build` (or `node build.mjs`). Whitespace/syntax minified only: function
// names stay readable in the stack traces players copy from error messages.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
mkdirSync(join(here, 'game'), { recursive: true });
await build({
  entryPoints: [join(here, 'src', 'main.js')], bundle: true, format: 'iife', minifyWhitespace: true, minifySyntax: true,
  target: 'es2020', outfile: join(here, 'game', 'game.js'), logLevel: 'warning', define: { __BUILD__: JSON.stringify(stamp) },
});
copyFileSync(join(here, 'index.src.html'), join(here, 'game', 'index.html'));
if (existsSync(join(here, 'game', 'game.js'))) console.log('game/game.js built', stamp);
