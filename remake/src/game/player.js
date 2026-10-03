// A player: resources, storage caps, population, the army pyramid and its own tech tree.
import { RES, COSTS } from './rules.js';

export class Player {
  constructor(id, tribe, opts = {}) {
    this.id = id;
    this.tribe = tribe;
    this.name = opts.name || tribe;
    this.ai = !!opts.ai;
    this.color = opts.color || 0x3080ff;          // minimap / UI colour
    this.partyColor = opts.partyColor ?? null;    // model tint (0xRRGGBB) or null = untinted
    this.team = opts.team != null ? opts.team : id;      // skirmish diplomacy: players of one team are friends
    // Diplomacy as the original keeps it (CDiplomacySrvMgr): rel[j] = this player's relation TOWARDS player j,
    // 0 hostile, 1 neutral, 2 friendly; one direction per pair (campaign maps: PlayerSettings/Player_<i>/Diplomacy,
    // ServerApp.usl:539-551). Without a table (skirmish) the teams decide; a slot the table does not cover is neutral.
    this.rel = opts.diplomacy ? opts.diplomacy.slice() : null;
    this.human = !opts.ai;
    this.res = { food: 0, wood: 0, stone: 0, skulls: 0 };
    this.caps = { food: 300, wood: 300, stone: 300 };    // rescap_* default 300 (player_attrib_def.txt)
    this.maxUnits = 0;
    this.units = 0;
    this.atLevel = [0, 0, 0, 0, 0];
    this.queuedAtLevel = [0, 0, 0, 0, 0];
    this.queuedUnits = 0;
    this.techs = new Set();        // completed upgrade/invention action ids (UI bookkeeping)
    this.tt = opts.rules ? opts.rules.newTree(tribe) : null;   // this player's tech tree (rules.js / techtree.js)
    this.log = [];                 // income: [time, res, amount]
    this.kills = 0; this.lost = 0;
    this.defeated = false;
    this.won = false;
    this.popMax = 52;              // PopulationMax (Player.usl: map "Population/Max", default 52)
    this.pyramid = null;           // unit slots per level [l1..l5] if the map restricts them (Restrictions/Chars/Level<n>/Max), else the standard 25/15/8/3/1
    this.capsFixed = false;        // storage limits set by a mission (PLCP): buildings no longer change them (economy.js recomputeCaps)
    this.animalsNeutral = 0;       // SNFA: bit 1 = nest animals leave this player alone, bit 2 = its units don't attack wild animals on their own
    this.heroes = new Set();       // unique hero classes this player owns (NPCMgr)
    // handicaps of a computer player by its difficulty 0-9 (game/ai/brain.js setDifficulty; docs/spec/ai.md §3), read by
    // the systems: { gather, buildTime, researchTime, weaponTime, attack, defense, pyramid: [+slots per level] | null, unitLimit }
    this.aiMods = null;
  }
  // relation towards p: 0 hostile, 1 neutral, 2 friendly
  relation(p) {
    if (!p) return 1;
    if (p === this) return 2;
    if (!this.rel) return p.team === this.team ? 2 : 0;
    const r = this.rel[p.id];
    return r != null ? r : this.relTeams ? (p.team === this.team ? 2 : 0) : 1;
  }
  setRelation(p, rel) {
    if (!p || p === this) return;
    if (!this.rel) { this.rel = []; this.relTeams = true; }     // skirmish: the other pairs keep their team relation
    this.rel[p.id] = rel;
  }
  isFriend(p) { return !!p && this.relation(p) === 2; }
  isEnemy(p) { return !!p && this.relation(p) === 0; }
  isNeutral(p) { return !!p && this.relation(p) === 1; }
  epoch() { let e = 1; for (let i = 2; i <= 5; i++) if (this.tt ? this.tt.invented('age_' + i) : this.techs.has('age_' + i)) e = i; return e; }
  // debug mode (skirmish option, or ?debug): everything is free and builds instantly (systems/production.js,
  // systems/construction.js check `debug` for the times). Nothing is paid, so nothing is refunded either.
  canAfford(cost) { return this.debug || COSTS.every((r) => (this.res[r] || 0) >= (cost[r] || 0)); }
  pay(cost) { if (this.debug) return; for (const r of COSTS) this.res[r] -= cost[r] || 0; }
  // give resources back (cancelled production); storage caps apply to food/wood/stone
  refund(cost, frac = 1) {
    if (this.debug) return;
    for (const r of COSTS) {
      const v = Math.floor((cost[r] || 0) * frac);
      if (!v) continue;
      this.res[r] = r === 'skulls' ? this.res[r] + v : Math.max(this.res[r], Math.min(this.caps[r], this.res[r] + v));
    }
  }
  // CPlayer.AddResource: add resources up to the storage cap; returns the amount that didn't fit
  deliver(r, amount, time) {
    if (r === 'skulls') { this.res.skulls += amount; return 0; }
    const space = Math.max(0, this.caps[r] - this.res[r]);
    const take = Math.floor(Math.min(space, amount));
    this.res[r] += take;
    if (take > 0) this.log.push([time, r, take]);
    return amount - take;
  }
  incomePerMin(time) {
    while (this.log.length && this.log[0][0] < time - 60) this.log.shift();
    const out = { food: 0, wood: 0, stone: 0 };
    for (const [, r, a] of this.log) out[r] += a;
    const span = Math.min(60, Math.max(10, time));
    for (const r of RES) out[r] = Math.round(out[r] * 60 / span);
    return out;
  }
  // pyramid / population check for one more unit at level lv (1..5)
  slotFree(lv, pyramid) {
    if (this.units + this.queuedUnits >= Math.min(this.maxUnits, this.popMax)) return 'housing';
    if (this.atLevel[lv - 1] + this.queuedAtLevel[lv - 1] >= (this.pyramid || pyramid)[lv - 1]) return 'level';
    return null;
  }
}
