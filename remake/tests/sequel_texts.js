// The sequel's own classes show their own texts (game/sequel/texts.js) - in the build card's tooltip too, although
// their build action is a copy of the original's (a SEAS tower's location and description key: Rules.actionText).
//   PWR_PORT=8412 python3 tests/evaljs.py tests/sequel_texts.js "&sequel=11"
const D = G.data, me = G.me, out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const text = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.innerText; };
const tower = D.text('seas_turret_tower');
const builds = D.actions(me).filter((a) => a.kind === 'Build' && a.results[0] && /^sq_/.test(a.results[0].obj));
check('the sequel\'s build actions', builds.length >= 5, builds.map((a) => a.results[0].obj));
const bad = [];
for (const a of builds) {
  const obj = a.results[0].obj, own = D.texts[obj], tip = text(G.hud.actionTipHtml({ ...a, loc: a.locs[0] }, null, []));
  const t = D.actionText(a);
  if (t !== own || !tip.includes(own.name) || (tower.medium && tip.includes(tower.medium.slice(0, 40))) || !tip.includes(own.medium.split('\n')[0].slice(0, 30))) bad.push([obj, t.name, tip.slice(0, 80)]);
}
check('each shows its own name and text, not the tower\'s', !bad.length, bad);
const o = D.text('sq_searchlight');
check('the object itself (info window): its own text', o.name === 'Searchlight Tower' && o.medium !== tower.medium, o.name);
return out.join('\n');
