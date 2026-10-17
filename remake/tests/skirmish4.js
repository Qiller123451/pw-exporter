// A skirmish of four (game/skirmish.js, main.js skirmishPlayers, systems/gameover.js) with the interface of the
// running game (ui/diplomacy.js, ui/chat.js, game/stats.js, ui/stats.js, the end screen): two teams, the start
// relations, one brain per computer player, diplomacy and tribute, the chat's "AI<n>:" requests, the statistics,
// the last team standing wins.
//   python3 tests/evaljs.py tests/skirmish4.js "&players=Hu,Aje,Ninigi,SEAS&teams=1,2,1,2&levels=5,5,5"
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const step = (s, dt = 0.1) => { for (let i = 0; i < s; i += 5) { G.step(Math.min(50, Math.round((s - i) / dt)), dt); if (G.fx) G.fx.update(5); } };
const P = W.players, me = G.me;
ok(P.length === 4 && P.map((p) => p.tribe).join() === 'Hu,Aje,Ninigi,SEAS', 'four players with the chosen tribes', P.map((p) => p.tribe));
ok(new Set(P.map((p) => p.hq)).size === 4 && new Set(P.map((p) => `${Math.round(p.slot.pos[0])},${Math.round(p.slot.pos[1])}`)).size === 4, 'four different head quarters');
ok(me.isFriend(P[2]) && P[2].isFriend(me) && me.isEnemy(P[1]) && me.isEnemy(P[3]) && P[1].isFriend(P[3]), 'same team: friends, the others: enemies');
ok(G.brains.size === 3 && [1, 2, 3].every((i) => G.brains.has(P[i].id)), 'a brain for every computer player');
ok(new Set(P.map((p) => p.colorSlot)).size === 4, 'every player its own colour');
for (const p of P) ok(W.units.some((u) => u.alive && u.owner === p) && (W.buildings.some((b) => b.alive && b.owner === p) || W.units.some((u) => u.alive && u.owner === p && /collector/.test(u.name))), `${p.name}: its start (base, workers)`);
step(5);
// the top bar: Diplomacy and Chat
const btns = [...document.querySelectorAll('.corner.tl .mbtn span')].map((s) => s.textContent);
ok(btns.includes('Diplomacy') && btns.includes('Chat'), 'the top bar has Diplomacy and Chat', btns);
// diplomacy: the window, my opinion of a player, the announcement, tribute
G.diplomacy();
await new Promise((r) => setTimeout(r, 100));
const rows = document.querySelectorAll('.dipl tr[data-p]');
ok(rows.length === 3 && G.menuOpen && !G.paused, 'the diplomacy window: a row per other player, the game runs on', rows.length);
const said = [];
const emit0 = W.emit.bind(W);
W.emit = (type, d) => { if (type === 'msg' && d.player === me) said.push(G.feedback.ticker(d)); return emit0(type, d); };
const r3 = document.querySelector(`.dipl tr[data-p="${P[3].id}"] input[value="1"]`);
r3.checked = true; r3.dispatchEvent(new Event('change'));
ok(me.relation(P[3]) === 1 && P[3].relation(me) === 0, 'neutral towards the SEAS: only my opinion changes');
ok(said.some((t) => /neutral position/.test(t) && t.includes(P[3].name)), 'everybody is told', said);
me.res.wood = 500;
const w2 = P[2].res.wood;
const row2 = document.querySelector(`.dipl tr[data-p="${P[2].id}"]`);
row2.querySelector('[data-res]').value = 'wood';
row2.querySelector('[data-n]').value = '700';
row2.querySelector('[data-send]').click();
ok(me.res.wood === 0 && P[2].res.wood === w2 + 500, 'tribute: at most what you have, the receiver\'s storage limit does not apply', [me.res.wood, P[2].res.wood - w2]);
ok(said.some((t) => /THANKS|Thank/i.test(t)) || said.some((t) => t.startsWith(P[2].name)), 'the computer player thanks', said.slice(-2));
ok(W.stats.table(me).tributeSent === 500 && W.stats.table(P[2]).tributeReceived === 500, 'statistics: tribute sent and received');
document.querySelector('[data-a="close"]').click();
// locked diplomacy: the radios are off
W.rules.diplomacyLocked = true;
G.diplomacy();
await new Promise((r) => setTimeout(r, 50));
ok([...document.querySelectorAll('.dipl input[type=radio]')].every((x) => x.disabled), 'locked diplomacy: no changes');
document.querySelector('[data-a="close"]').click();
W.rules.diplomacyLocked = false;
// the chat: Enter opens it, "AI2: food" asks the Dragon Clan (a friend)
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter' }));
ok(G.chat.isOpen && G.chat.sel.value === 'all', 'Enter opens the chat to all');
P[2].res.food = 600;
const f0 = me.res.food;
G.chat.input.value = `AI${P[2].id}: food`;
G.chat.send();
ok(!G.chat.isOpen && me.res.food - f0 === 100, 'AI<n>: food - the friend sends 100', me.res.food - f0);
ok(G.chat.history.some((h) => h.text === `${me.name}: AI${P[2].id}: food`), 'the line is in the history');
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', ctrlKey: true }));
ok(G.chat.sel.value === 'allies', 'Ctrl+Enter: to the allies');
G.chat.input.value = 'hello';
G.chat.send();
ok(G.chat.history.some((h) => /announced to your allies: hello/.test(h.text)), 'to the allies: "You announced to your allies"');
// statistics: kills, the time line
step(25);
ok(W.stats.series.length >= 2 && W.stats.series[0].v[me.id].units > 0, 'the time line samples every 10 s', W.stats.series.length);
// team 2 loses everything: team 1 wins
for (const p of [P[1], P[3]]) {
  for (const u of W.units) if (u.alive && u.owner === p) W.kill(u, null);
  for (const b of W.buildings) if (b.alive && b.owner === p) W.kill(b, null);
}
step(3);
ok(P[1].defeated && P[3].defeated && me.won && P[2].won, 'the last team standing wins', P.map((p) => [p.won, p.defeated]));
step(3);
await new Promise((r) => setTimeout(r, 1700));
const end = document.querySelector('.pwwin');
const t = end ? end.textContent : '';
ok(G.over && /victorious/.test(t) && /Retry/.test(t) && /Load Game/.test(t) && /View Statistics/.test(t) && /Keep playing/.test(t) && G.paused, 'the end screen: Retry, Load Game, View Statistics, Keep playing; the game paused', t.slice(0, 200));
document.querySelector('[data-a="stats"]').click();
await new Promise((r) => setTimeout(r, 100));
const tabs = [...document.querySelectorAll('.sttabs div')].map((d) => d.textContent);
ok(tabs.includes('Overview') && tabs.includes('Fights') && tabs.includes('TimeLine') && document.querySelectorAll('.sttable tbody tr').length === 4, 'the statistics: tabs, a row per player', tabs);
[...document.querySelectorAll('.sttabs div')].find((d) => d.textContent === 'TimeLine').click();
ok(!!document.querySelector('.stgraph canvas'), 'the time line graph');
document.querySelector('[data-a="ok"]').click();
ok(/victorious/.test(document.querySelector('.pwwin').textContent), 'OK: back to the end screen');
return out.join('\n');
