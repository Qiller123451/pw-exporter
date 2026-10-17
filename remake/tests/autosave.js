// Autosave (IngameScreen.usl UpdateAutosaveTimer / Game.usl OnAutosave): the game goes into the slot "Autosave"
// when its time comes, not while paused; the next one replaces it.
//   python3 tests/evaljs.py tests/autosave.js "&tribe=Hu&enemy=Aje"
const out = [];
const check = (n, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + n + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
G.paused = true; G.autosaveDue();
await wait(1500);
const list0 = await G.menu.hooks.saves();
check('not while paused', !list0.some((m) => m.id === 'autosave'), list0.map((m) => m.id));
G.paused = false; G.autosaveDue();
await wait(2500);
const list1 = await G.menu.hooks.saves();
const a = list1.find((m) => m.id === 'autosave');
check('saved into "Autosave"', !!a && a.name === 'Autosave', a && a.name);
G.autosaveDue();
await wait(2500);
const list2 = await G.menu.hooks.saves();
check('the next one replaces it', list2.filter((m) => m.id === 'autosave').length === 1 && list2.find((m) => m.id === 'autosave').date > a.date);
return out.join('\n');
