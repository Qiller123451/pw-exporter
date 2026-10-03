// Run a playthrough script (tests/campaign_play_NN.js) against the mock world instead of the game:
//   node tests/campaign_play_mock.mjs <mission number> [script] [folder with single_NN.json]
// The mock world has no fights and no obstacles (units walk straight, nobody dies unless the script's cheats kill
// it), so this checks the mission's TRIGGER CHAIN - can the story be walked from the first quest to QUIT - in a
// second, without a browser. What the real world adds (paths, combat, the computer player) needs the real test.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeGame } from './campaign_mock.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const n = String(process.argv[2] || '11').padStart(2, '0');
const script = process.argv[3] || path.join(here, `campaign_play_${n}.js`);
const dir = process.argv[4] || process.env.PW_CPN || path.join(here, '..', '..', '_notes', 'cpn');
if (!fs.existsSync(path.join(dir, `single_${n}.json`))) { console.log(`   (no mission dump single_${n}.json in ${dir}: skipped)`); process.exit(0); }
const data = JSON.parse(fs.readFileSync(path.join(dir, `single_${n}.json`), 'utf8'));
const G = makeGame(data, { id: +n });
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const out = await new AsyncFunction('G', 'location', fs.readFileSync(script, 'utf8'))(G, { search: '' });
console.log(out);
process.exit(/^FAIL/m.test(out) ? 1 : 0);
