// The computer player's chat (ai/chat.js): answers to "AI<n>: help / food / wood / stone / gift" of a friend, the
// refusal of an enemy, the cry for help when its village is overrun.
//   python3 tests/evaljs.py tests/ai_chat.js "&tribe=Hu&enemy=Aje&aid=6"
const W = G.world, out = [];
const ok = (c, m, info) => out.push(`${c ? 'ok  ' : 'FAIL'} ${m}` + (info !== undefined ? '  ' + JSON.stringify(info) : ''));
const B = (G.brains && G.brains.get ? G.brains.get(G.ai.id) : null) || G.aiBrain, p = B.p, me = G.me;
const step = (s, dt = 0.1) => { for (let i = 0; i < s; i += 5) { G.step(Math.min(50, Math.round((s - i) / dt)), dt); if (G.fx) G.fx.update(5); } };
const said = [];
const emit0 = W.emit.bind(W);
W.emit = (type, d) => { if (type === 'msg' && d.from === p) said.push([d.player === me ? 'me' : d.player && d.player.id, d.key, d.arg]); return emit0(type, d); };
B.setBehaviour('Giraffe');
B.prm.noFight = true;
step(10);
ok(B.onPlayerRequest(me, 'Food') === '_NT_AI_DENIEHELPENEMY', 'an enemy asking: refused');
me.setRelation(p, 2); p.setRelation(me, 2);
p.res.food = 500;
const f0 = me.res.food;
ok(B.onPlayerRequest(me, 'Food 100') === '_NT_AI_SENDFOOD' && me.res.food - f0 === 100 && p.res.food === 400, 'a friend asking for food: 100 sent', me.res.food - f0);
p.res.stone = 50;
ok(B.onPlayerRequest(me, 'stone') === '_NT_AI_CANTSENDSTON', 'not enough stone: sorry');
ok(B.onPlayerRequest(me, 'Gift wood 100') === '_NT_AI_THANKSFORHELP', 'a gift: thanks');
ok(B.onPlayerRequest(me, 'Iron') === null, 'skulls: no answer (the original has none)');
ok(said.length >= 4 && said.every((s) => s[0] === 'me'), 'the answers go to the asker', said);
const txt = G.feedback.ticker({ key: '_NT_AI_SENDFOOD', arg: 100, from: p });
ok(/100/.test(txt) && txt.startsWith(p.name || ''), 'the line shows the sender and the amount', txt);
// help: nobody to fight at the asker's village -> sorry (a support squad needs a third player: group 9's skirmish)
let S = B.census(true);
const fighter = { Hu: 'hu_warrior', Aje: 'aje_warrior', Ninigi: 'ninigi_warrior', SEAS: 'seas_marine' }[p.tribe];
const gp = B.guardPoint(S);
for (let i = 0; i < 8; i++) W.spawnUnit(fighter, p, gp.x + (i % 4) * 2, gp.z + Math.floor(i / 4) * 2);
ok(B.onPlayerRequest(me, 'Help') === '_NT_AI_CANTHELP', 'help with no enemy at the asker\'s village: sorry');
// the cry for help: overrun (more than 3 attackers, no more defenders) -> to every friend
said.length = 0;
B.multimap = true; B.defending = true; B.helpT = 0;
const fake = [0, 1, 2, 3].map(() => ({ owner: { id: 9 }, wild: false }));
B.cryForHelp(S, fake, 2);
ok(said.some((x) => x[0] === 'me' && x[1] === '_NT_AI_HELPBASEATTACKED'), 'overrun: "Help! My Base is attacked" to its friend', said);
said.length = 0;
B.cryForHelp(S, fake, 2);
ok(!said.length, 'not again at once (20-35 s)');
B.helpT = 0;
B.cryForHelp(S, fake.slice(0, 3), 0);
ok(!said.length, 'three attackers: no cry');
return out.join('\n');
