// The in-game help (ui/helpbook.js; HelpMenu.usl): F1 opens it on the selected object's help item; links and Back.
//   python3 tests/evaljs.py tests/helpbook.js "&tribe=Hu&enemy=Aje"
const out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const w = G.world.units.find((u) => u.owner === G.me && /_worker$/.test(u.name));
G.select([w]);
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F1', key: 'F1', bubbles: true }));
await wait(1200);
const B = G.menu.book;
check('F1 opens the help at the selected unit', !!B && G.menuOpen && B.cur === 'h_hu_produkte.seml#_hu_worker', B && B.cur);
check('the game is paused meanwhile', G.paused);
check('the topics of index.txt', document.querySelectorAll('.helpbook .ht').length >= 13);
const link = document.querySelector('.helpbook .hlink');
link.click(); await wait(200);
check('a link goes to its topic', B.cur === link.dataset.ref, B.cur);
document.querySelector('[data-a="hback"]').click(); await wait(200);
check('Back returns', B.cur === 'h_hu_produkte.seml#_hu_worker', B.cur);
document.querySelector('[data-a="close"]').click(); await wait(200);
check('Close: the game runs again', !G.menuOpen && !G.paused);
return out.join('\n');
