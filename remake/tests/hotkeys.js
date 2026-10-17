// The original's keyboard accelerators (Scripts/Game/options/Keys.srf; ui/input.js onKey): W / Shift+W / Ctrl+W idle
// workers, Ctrl+A all units on screen, numpad game speed, PageUp zoom, Backspace hides the interface, the command
// bar rows (Q A Y / X / E D C, then digits), V B attack / move, H T building jumps, groups and camera views, Del.
// python3 tests/evaljs.py tests/hotkeys.js "&tribe=Hu&enemy=Aje"
const out = [];
const check = (name, ok, info) => out.push((ok ? 'ok   ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const key = (code, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, ...o }));
G.step(30, 0.1);
const idle = G.world.units.filter((u) => u.alive && u.owner === G.me && u.isWorker && u.task.type === 'idle').length;
G.sel.clear(); key('KeyW'); check('W picks an idle worker', G.sel.size === 1 && [...G.sel][0].isWorker);
key('KeyW', { shiftKey: true }); check('Shift+W adds one', G.sel.size === Math.min(2, idle), G.sel.size);
key('KeyW', { ctrlKey: true }); check('Ctrl+W takes them all', G.sel.size === idle, [G.sel.size, idle]);
G.sel.clear(); key('KeyA', { ctrlKey: true }); check('Ctrl+A selects the units on screen, no attack-move', G.sel.size > 0 && !G.input.mode, [G.sel.size, G.input.mode]);
const s0 = G.settings.speed || 1; key('NumpadAdd'); const s1 = G.settings.speed; key('NumpadMultiply');
check('numpad + speeds up, × back to normal', s1 > s0 && G.settings.speed === 1, [s0, s1, G.settings.speed]);
const d0 = G.rtscam.tDist; key('PageUp'); check('PageUp zooms out', G.rtscam.tDist > d0);
key('Backspace'); const hid = G.hud.root.classList.contains('hidden'); key('Backspace');
check('Backspace hides and shows the interface', hid && !G.hud.root.classList.contains('hidden'));
// command bar rows: workers -> Q / A / Y arm the build menu's economy / military / defence rows, a digit builds
const W = G.world, me = G.me;
const workers = W.units.filter((u) => u.alive && u.owner === me && u.isWorker);
G.select(workers.slice(0, 1)); G.hud.update(0.1);
key('KeyQ'); const rows = (G.hud.rows || []).map((r) => r[0]);
check('Q opens the build menu and arms its top row', G.hud.menu === 'build' && G.hud.armed && G.hud.armed.row === 2, { rows, armed: G.hud.armed });
const card = document.querySelector('.flyout .frow.armed .card .hk');
check('the armed row shows the digits', !!card && card.textContent === '1');
const free = [...document.querySelectorAll('.flyout .frow.armed .card')].findIndex((c) => !c.classList.contains('dim') && !c.classList.contains('locked'));
key('Digit' + ((free + 1) % 10)); check('its digit presses a button: placing a building', free >= 0 && G.input.mode === 'place' && !G.hud.armed, [free, G.input.mode]);
key('Escape'); key('Escape');
key('KeyY'); check('Y arms the bottom row (defence)', G.hud.armed && G.hud.armed.row === 0 && (G.hud.rows[G.hud.rows.length - 1] || [])[0] === 'Defence');
key('Escape'); check('Esc disarms', !G.hud.armed);
// stances: X then 1 = hold ground
const fighter = W.spawnUnit('hu_warrior', me, workers[0].pos.x + 3, workers[0].pos.z, 1);
G.select([fighter]); G.hud.update(0.1);
key('KeyX'); key('Digit1'); check('X 1: hold ground', fighter.stance === 0, fighter.stance);
key('KeyX'); key('Digit3'); check('X 3: aggressive', fighter.stance === 2, fighter.stance);
key('KeyV'); check('V: attack (choose a target)', G.input.mode === 'attack'); key('Escape');
key('KeyB'); check('B: move (choose a point)', G.input.mode === 'move'); key('Escape');
key('KeyN'); check('N: attack-move', G.input.mode === 'amove'); key('Escape');
// groups and camera views
key('Digit4', { ctrlKey: true }); G.sel.clear(); key('Digit4'); check('Ctrl+4 / 4: a group', G.sel.size === 1 && G.sel.has(fighter));
G.sel.clear(); G.rtscam.x = 11; G.rtscam.z = -7; key('Digit5', { ctrlKey: true }); G.rtscam.x = 0; G.rtscam.z = 0; G.input.lastGroupKey = { k: '', t: 0 }; key('Digit5');
check('Ctrl+5 with nothing selected keeps the view, a single 5 stays', G.rtscam.x === 0 && G.rtscam.z === 0, [G.rtscam.x, G.rtscam.z]);
key('Digit5');
check('5 pressed twice goes back to it (GetGroup: within 300 ms)', G.rtscam.x === 11 && G.rtscam.z === -7, [G.rtscam.x, G.rtscam.z]);
G.rtscam.x = 0; G.rtscam.z = 0; G.input.lastGroupKey = { k: '', t: 0 }; key('Digit4');
check('a single 4 selects the group, the camera stays', G.sel.has(fighter) && G.rtscam.x === 0, [G.rtscam.x, G.rtscam.z]);
key('Digit4');
check('4 twice: the camera to the group', Math.abs(G.rtscam.x - fighter.pos.x) < 1 && Math.abs(G.rtscam.z - fighter.pos.z) < 1, [G.rtscam.x, G.rtscam.z]);
G.input.lastGroupKey = { k: '', t: 0 }; key('Digit7');
check('an empty group\'s digit selects nothing', G.sel.size === 0, G.sel.size);
// H: the headquarters
G.sel.clear(); key('KeyH');
const hq = [...G.sel][0];
check('H selects the headquarters', !!hq && hq.name === 'hu_fireplace', hq && hq.name);
// the group bar (GroupBar.usl): a right click assigns, a click selects and stays pressed while the selection is the group
{
  G.select([fighter]); G.input.groupButton('6', 'assign'); G.hud.hoverT = 0; G.hud.update(0.05);
  const b6 = G.hud.groupBtns[6], b7 = G.hud.groupBtns[7];
  check('the group bar shows group 6 and the next free one', b6.style.display !== 'none' && b6.textContent === '6' && b7.style.display !== 'none' && b7.textContent === '', [b6.textContent, b7.style.display]);
  G.sel.clear(); G.selChanged();
  b6.click(); G.hud.update(0.05); G.hud.grpKey = ''; G.hud.refreshGroups();
  check('its button selects the group and stays pressed', G.sel.has(fighter) && b6.classList.contains('sel'));
  G.sel.clear(); G.selChanged(); G.hud.refreshGroups();
  check('another selection lets it come up', !b6.classList.contains('sel'));
}
// the army pyramid's cards (PyramidCard.usl OnClick / OnDoubleClick): Shift adds, Ctrl adds or removes, a plain click
// selects one alone, buildings leave the selection; Alt+double-click: the units of its class on its row
{
  const w2 = W.spawnUnit('hu_warrior', me, fighter.pos.x + 3, fighter.pos.z + 3, fighter.level);
  G.hud.pyrKey = ''; G.hud.refreshPyramid();
  const lv = fighter.level - 1, row = G.hud.cardUnits[lv], cards = [...G.hud.pyr.querySelectorAll('.pcard')];
  // the cards are rendered in cardUnits order, empty slots skipped
  const order = []; for (let l = 0; l < 5; l++) for (const x of G.hud.cardUnits[l]) if (x) order.push(x);
  const card = (u) => cards.filter((c) => !c.classList.contains('queued'))[order.indexOf(u)];
  const click = (u, o = {}) => card(u).dispatchEvent(new MouseEvent('click', { bubbles: true, ...o }));
  const hq = G.homeEntity();
  G.select([hq]); click(fighter, { shiftKey: true });
  check('Shift+click on a card adds it, a building leaves', G.sel.has(fighter) && !G.sel.has(hq), [...G.sel].map((x) => x.name));
  click(w2, { shiftKey: true }); check('Shift+click adds another', G.sel.has(w2) && G.sel.has(fighter));
  G.hud.pyrKey = ''; G.hud.refreshPyramid();
  click(w2, { ctrlKey: true }); check('Ctrl+click removes a selected one', !G.sel.has(w2) && G.sel.has(fighter), G.sel.size);
  click(w2, { ctrlKey: true }); check('Ctrl+click adds it again', G.sel.has(w2));
  click(w2); check('a click selects it alone', G.sel.size === 1 && G.sel.has(w2), G.sel.size);
  card(w2).dispatchEvent(new MouseEvent('dblclick', { bubbles: true, altKey: true }));
  const same = row.filter((x) => x && x.name === w2.name).length;
  check('Alt+double-click: every unit of its class on its row', G.sel.size === G.hud.cardUnits[lv].filter((x) => x && x.alive && x.name === w2.name).length && G.sel.size >= 2, [G.sel.size, same]);
  w2.hp = 0; W.kill(w2, null);
}
// Del: the first selected only
const a1 = W.spawnUnit('hu_warrior', me, fighter.pos.x + 2, fighter.pos.z, 1), a2 = W.spawnUnit('hu_warrior', me, fighter.pos.x + 4, fighter.pos.z, 1);
G.select([a1, a2]); key('Delete'); check('Del destroys the first selected', !a1.alive && a2.alive);
G.select([a2, fighter]); key('Delete', { shiftKey: true }); check('Shift+Del destroys all selected', !a2.alive && !fighter.alive);
return out.join('\n');
