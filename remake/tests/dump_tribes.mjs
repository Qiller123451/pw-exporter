import fs from 'fs';
import { Rules } from '../src/game/rules.js';
const tt = JSON.parse(fs.readFileSync((process.env.PW_REMAKE_DATA || '.') + '/techtree.json'));
const gd = JSON.parse(fs.readFileSync((process.env.PW_REMAKE_DATA || '.') + '/gamedata.json'));
const R = new Rules(tt, gd);
for (const tribe of ['Hu','Aje','Ninigi','SEAS']) {
  const p = { tribe, tt: R.newTree(tribe) };
  console.log('=====', tribe, JSON.stringify(R.start(tribe)));
  const acts = R.actions(p);
  const builds = acts.filter(a => a.cat==='Build/BLDG');
  const workerLocs = new Set(builds.flatMap(a=>a.locs.map(l=>l.at)));
  console.log('build locs', [...workerLocs]);
  for (const a of builds) {
    const o = a.results[0]?.obj; const s = R.stats(o,1,p); const d = R.def(o,p);
    const at = R.actionsAt(p, o).map(x=>x.id+(x.visible?'':'(h)'));
    console.log(' ', a.id, o, JSON.stringify(a.cost), 'req', a.req.join(','), '| lim', JSON.stringify(s&&s.limits), 'del', d&&d.delivery.join(','), 'unl', d&&d.unlimited, '| acts', at.join(' '));
  }
}
