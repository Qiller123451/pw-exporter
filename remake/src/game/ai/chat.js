// The computer player talking to the other players (docs/spec/ai_group6.md §5): the cry for help when its village
// is overrun (goals/AiGoalGuardVillage.usl:615-716) and the answers to "AI<n>: <word>" requests of the chat window
// and the diplomacy window (Modules/AiModuleControl.usl:614-731). Texts: newsticker _NT_AI_* (gamedata ui).
//
//   * CryForHelp: on skirmish maps, while defending, more than 3 attackers (no wild animal among them) and no more
//     defenders than attackers, not in "Single 15": "Help! My Base is attacked ..." to every friendly player, again
//     after 10 guard thinks (about 20-35 s).
//   * onPlayerRequest(from, word): help - up to 4 / 6 / 8 pool units (Easy / Medium / Hard) attack the enemies near
//     the asker's village when the pool holds more than 3 and the village is not defending; food / wood / stone -
//     100 of it when it has that much; gift - thanks; an enemy asking - refused; iron (skulls): no answer (the
//     original has no branch); other words: the original's Eliza chatbot is engine code [?engine] - no answer.
import { Attack } from './attack.js';

const SUPPORT = { Easy: 4, Medium: 6, Hard: 8 };
const RES_KEY = { food: 'FOOD', wood: 'WOOD', stone: 'STON' };

export const ChatAI = {
  say(to, key, arg = null, text = '') { this.W.emit('msg', { player: to, key, arg, text, kind: 'ai', from: this.p }); },
  cryForHelp(S, threats, defenders) {
    const W = this.W;
    if (!this.multimap || !this.defending || this.levelName === 'Single 15') return;
    if (threats.length <= 3 || defenders > threats.length || threats.some((u) => u.wild || !u.owner)) return;
    if (W.time < (this.helpT || 0)) return;
    this.helpT = W.time + 10 * (10 + 1 + Math.floor(Math.random() * (W.players.length + 1))) * 0.2;
    for (const o of W.players) if (o !== this.p && !o.defeated && this.p.isFriend(o)) this.say(o, '_NT_AI_HELPBASEATTACKED', null, 'Help! My Base is attacked by a superiority!');
    this.W.emit('aiHelp', { player: this.p, x: S.home ? S.home.x : 0, z: S.home ? S.home.z : 0 });
  },
  // a request of another player -> the reply key (also said to them)
  onPlayerRequest(from, word) {
    const W = this.W, p = this.p, w = String(word || '').trim().split(/\s+/)[0].toLowerCase();
    const reply = (key, arg = null) => { this.say(from, key, arg); return key; };
    if (w === 'gift') return reply('_NT_AI_THANKSFORHELP');
    if (w === 'iron' || !w) return null;
    if (!['help', 'food', 'wood', 'stone'].includes(w)) return null;          // (Eliza: not ported)
    if (from && p.isEnemy(from)) return reply('_NT_AI_DENIEHELPENEMY');
    if (RES_KEY[w]) {
      const reserve = (this.reserve && this.reserve[w]) || 0;
      if ((p.res[w] || 0) - reserve < 100) return reply('_NT_AI_CANTSEND' + RES_KEY[w]);
      p.res[w] -= 100;
      from.deliver ? from.deliver(w, 100, W.time) : (from.res[w] = (from.res[w] || 0) + 100);
      return reply('_NT_AI_SEND' + RES_KEY[w], 100);
    }
    // help: a support squad for the enemies near the asker's village (InitiateCoopSupportAttack, FM:978-1059)
    const S = this.census(true);
    const at = this.baseOf(from);
    if (!at || this.defending || S.pool.length <= 3) return reply('_NT_AI_CANTHELP');
    const targets = [];
    for (const u of W.units) if (u.alive && !u.inside && u.owner && p.isEnemy(u.owner) && !u.naval && Math.hypot(u.pos.x - at.x, u.pos.z - at.z) < 80) targets.push(u);
    if (!targets.length) return reply('_NT_AI_CANTHELP');
    const units = (this.queryPool(S, 1, SUPPORT[this.cls] || 6, null, true) || []).slice(0, SUPPORT[this.cls] || 6);
    if (!units.length) return reply('_NT_AI_CANTHELP');
    this.supportAttack(S, units, targets);
    return reply('_NT_AI_CONFIRMHELP', units.length);
  },
  // the CoopSupportAttack goal: not one of the plan's three attacks (priority 10^6)
  supportAttack(S, units, targets) {
    const a = new Attack(this, { type: 'coop', goal: 'quick', targets, hunt: true });
    this.attacks.push(a);
    this.launched.push({ id: a.id, t: Math.round(this.W.time), type: 'coop', goal: 'quick', scripted: false, hunt: true, n: units.length, go: Math.round(this.W.time) });
    a.add(units);
    a.startCount = units.length;
    this.attackGo(S, a, a.alive());
    return a;
  },
};
