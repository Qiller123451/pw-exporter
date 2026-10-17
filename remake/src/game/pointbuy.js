// The army budget ("point buy", docs/spec/pointbuy.md): a player starts with the units and resources bought for the
// game's points. Prices and default presets come from gamedata "pointBuy" (pipeline/build_data.py point_buy:
// NewPointBuyCosts.txt, DefPresets.txt), the computer players' armies from ai.json "pointBuy" (AiPBPreset*.txt).
//
// An army (JSON, kept in the skirmish setup and the campaign config):
//   { cards: { <slot>: class }, fixed: { <slot>: level } (cards that may only move up and are never sold: the
//     campaign's, the Aje resource collector), res: { food, wood, stone }, min: { food, wood, stone } (no selling
//     below), locked: { <res>: true } (no buying or selling: a mission's "-1") }
// Slots are those of the army pyramid: 0-24 level 1, 25-39 level 2, 40-47 level 3, 48-50 level 4, 51 level 5.

export const SLOT_LEVELS = [[0, 24], [25, 39], [40, 47], [48, 50], [51, 51]];
export const slotLevel = (slot) => (slot >= 51 ? 5 : slot >= 48 ? 4 : slot >= 40 ? 3 : slot >= 25 ? 2 : 1);
export const RES = ['food', 'wood', 'stone'];
export const GIFT = 30;                       // the multiplayer food gift (GIW:224-226, SL:640-658): free, and the least food
export const COLLECTOR_SLOT = 24;             // the Aje resource collector's card (PD:185-195)
const GENERIC = { worker: 'res', Resource: 'res', Technics: 'tec', Nature: 'nat' };
const DIFF = (d) => (d <= 2 ? 'Easy' : d <= 5 ? 'Medium' : 'Hard');            // AIC:159-187

export class PointBuy {
  constructor(D, aiData) {
    this.D = D;
    this.pb = (D.extra && D.extra.pointBuy) || { costs: {}, cats: {}, heroes: {}, rates: {}, presets: {} };
    this.ai = (aiData && aiData.pointBuy) || {};
  }
  get ready() { return Object.keys(this.pb.costs).length > 0; }

  // ------------------------------------------------------------ prices (CPointBuyMgr, PBM:231-303)
  // the class a card or preset entry creates: generic workers by caste, Stina rides her sabre-tooth (SL:506-524)
  resolve(name, tribe) {
    if (name in GENERIC) return { cls: tribe === 'SEAS' ? 'seas_worker' : tribe.toLowerCase() + '_worker', caste: tribe === 'SEAS' ? 'res' : GENERIC[name] };
    if (name === 'Stina_s0') return { cls: 'special_eusmilus', caste: 'nat' };
    return { cls: name, caste: null };
  }
  // the price of a class at a level (1..5); 0 = not at that level or unknown (heroes: the same for every tribe)
  price(name, level, tribe) {
    const row = (this.pb.costs[tribe] || {})[name] || this.pb.heroes[name] || (name === 'special_eusmilus' ? this.pb.heroes.Stina_s0 : null);
    return row ? row[level - 1] || 0 : 0;
  }
  cardCost(name, slot, tribe) { return this.price(name, slotLevel(slot), tribe); }
  rate(res, tribe) { return ((this.pb.rates[tribe] || this.pb.rates.Hu || {})[res]) || { food: 1, wood: 1.5, stone: 2 }[res]; }
  resCost(res, amount, tribe) { return Math.ceil(this.rate(res, tribe) * amount - 1e-9); }
  resFor(res, points, tribe) { return Math.max(0, Math.floor(points / this.rate(res, tribe) + 1e-9)); }
  isHero(name) { return name in this.pb.heroes || name === 'special_eusmilus'; }
  // the points a player has: the budget, the food gift of a multiplayer game and the price of the Aje collector card
  // (GIW:399-424) - credits -1 = the predefined start
  total(credits, tribe, { mp = true, buildings = true } = {}) {
    if (credits < 0) return -1;
    return credits + (mp ? GIFT : 0) + (tribe === 'Aje' && buildings ? this.price('aje_resource_collector', 1, 'Aje') : 0);
  }
  cost(army, tribe) {
    let n = 0;
    for (const s in army.cards) n += this.cardCost(army.cards[s], +s, tribe);
    for (const r of RES) n += this.resCost(r, (army.res && army.res[r]) || 0, tribe);
    return n;
  }
  left(army, total, tribe) { return total - this.cost(army, tribe); }

  // ------------------------------------------------------------ the shop (ShoppingList, SHL:240-421)
  // -> [{ cls, tab: 0 infantry | 1 cavalry | 2 heroes, prices: [5] }] in the price list's order; classes the game
  // doesn't know are left out; allowed: the map's Restrictions/Chars lists of the player (campaign) or null
  shop(tribe, allowed = null) {
    const out = [], D = this.D, ok = (c) => !allowed || allowed.has(c);
    const cats = this.pb.cats[tribe] || {};
    for (const [cls, cat] of Object.entries(cats)) {
      if (!D.exists(cls) || !ok(cls)) continue;
      out.push({ cls, tab: cat === 'Character' ? 0 : 1, prices: this.pb.costs[tribe][cls] });
    }
    for (const [h, prices] of Object.entries(this.pb.heroes)) {
      const cls = h === 'Stina_s0' ? 'special_eusmilus' : h;
      if (h === 'special_eusmilus' || !D.exists(cls) || (allowed && !allowed.has(h) && !allowed.has(cls))) continue;
      out.push({ cls, tab: 2, prices });
    }
    return out;
  }

  // ------------------------------------------------------------ the pyramid
  hasHero(army, name) {
    const same = (c) => c === name || (name === 'special_eusmilus' && c === 'Stina_s0') || (name === 'Stina_s0' && c === 'special_eusmilus');
    return Object.values(army.cards).some(same);
  }
  // the first free slot of a level (FindFreeSlot; the highest ids of a level are blocked first: NP:1950-1970)
  freeSlot(army, level, blocked = 0) {
    const [a, b] = SLOT_LEVELS[level - 1];
    for (let s = a; s <= b - blocked; s++) if (!(s in army.cards)) return s;
    return -1;
  }
  // buy a class at a level (PBM:110-136) -> the slot or null
  buy(army, name, level, total, tribe, blocked) {
    if (this.isHero(name) && this.hasHero(army, name)) return null;
    const price = this.price(name, level, tribe);
    if (!price) return null;
    const slot = this.freeSlot(army, level, blocked && blocked[level - 1]);
    if (slot < 0 || this.left(army, total, tribe) < price) return null;
    army.cards[slot] = name;
    return slot;
  }
  // a double-click in the shop: the lowest level with a price and a free slot (PBM:95-108)
  buyLowest(army, name, total, tribe, blocked) {
    for (let lv = 1; lv <= 5; lv++) {
      if (!this.price(name, lv, tribe) || this.freeSlot(army, lv, blocked && blocked[lv - 1]) < 0) continue;
      return this.buy(army, name, lv, total, tribe, blocked);
    }
    return null;
  }
  sell(army, slot) {
    if (army.fixed && slot in army.fixed) return false;
    delete army.cards[slot];
    return true;
  }
  // a card dragged to another slot (NewPyramid AcceptDropWindowPB / DropWindowPB, NP:1828-1941): never below its
  // fixed level, up only when the points allow the dearer price, down only to a level it has a price at; a card in
  // the target slot changes places with it
  canMove(army, from, to, total, tribe) {
    const name = army.cards[from];
    if (!name || from === to || to < 0 || to > 51) return false;
    const lf = slotLevel(from), lt = slotLevel(to), fx = army.fixed && army.fixed[from];
    if (fx && lt < fx) return false;
    if (lt === lf) return true;
    const other = army.cards[to];
    if (other && army.fixed && army.fixed[to] && lf < army.fixed[to]) return false;
    const now = this.cardCost(name, from, tribe), then = this.cardCost(name, to, tribe);
    if (!then) return false;
    // (the original checks only the moved card; the remake also keeps the swapped one affordable)
    const swap = other ? this.cardCost(other, from, tribe) - this.cardCost(other, to, tribe) : 0;
    if (other && !this.cardCost(other, from, tribe)) return false;
    return this.left(army, total, tribe) + now - then - swap >= 0;
  }
  move(army, from, to) {
    const a = army.cards[from], b = army.cards[to], fa = army.fixed && army.fixed[from], fb = army.fixed && army.fixed[to];
    delete army.cards[from]; delete army.cards[to];
    if (army.fixed) { delete army.fixed[from]; delete army.fixed[to]; }
    army.cards[to] = a; if (fa) army.fixed[to] = fa;
    if (b) { army.cards[from] = b; if (fb) army.fixed[from] = fb; }
  }
  // resources: + / - with the click's step (1, Shift 10, Ctrl 100, both 1000; PD:430-480)
  addRes(army, res, step, total, tribe) {
    if (army.locked && army.locked[res]) return 0;
    const cur = army.res[res] || 0;
    if (step > 0) {
      // never more than the points left buy (the rounding is per resource total)
      const left = this.left(army, total, tribe);
      const n = Math.max(0, Math.min(step, this.resFor(res, left + this.resCost(res, cur, tribe), tribe) - cur));
      army.res[res] = cur + n;
      return n;
    }
    const min = (army.min && army.min[res]) || 0;
    const n = Math.max(0, Math.min(-step, cur - min));
    army.res[res] = cur - n;
    return -n;
  }

  // ------------------------------------------------------------ presets
  // the default presets of a tribe for exactly this budget (PW:270-287), Standard first; a tribe without any (SEAS)
  // gets a made-up Standard: three workers and the rest as resources (the remake's own)
  presets(tribe, credits) {
    const list = (this.pb.presets[tribe] || []).filter((p) => p.cost === credits);
    list.sort((a, b) => (b.standard ? 1 : 0) - (a.standard ? 1 : 0));
    if (!list.length && credits >= 0) list.push(this.madeUp(tribe, credits));
    return list.map((p) => ({ ...p, kind: (/^_pb_([a-z]+)_/.exec(p.name) || [])[1] || 'standard' }));
  }
  preset(tribe, credits, kind) {
    const l = this.presets(tribe, credits);
    return l.find((p) => p.kind === kind) || l[0] || null;
  }
  madeUp(tribe, credits) {
    const w = this.resolve('worker', tribe).cls, units = { 0: w, 1: w, 2: w };          // (a generic "worker" card costs nothing)
    let left = credits + GIFT - 3 * this.price(w, 1, tribe);
    const res = {};
    for (const r of RES) { res[r] = this.resFor(r, Math.max(0, left) / (RES.length - RES.indexOf(r)), tribe); left -= this.resCost(r, res[r], tribe); }
    return { name: '_pb_standard_' + credits + '_' + tribe.toLowerCase(), cost: credits, standard: true, units, res };
  }
  empty() { return { cards: {}, fixed: {}, res: { food: 0, wood: 0, stone: 0 }, min: { food: 0, wood: 0, stone: 0 }, locked: {} }; }
  // LoadPreset (PD:145-239): the units in the preset's order, each only while the points last (fixed at their
  // level in a campaign), the Aje collector card, then the preset's resources as far as the points left buy them.
  // mp: the multiplayer minimum of 30 food; res -1 = that resource is locked (a mission's), given as `lockedRes`
  load(preset, tribe, total, { fixed = false, buildings = true, mp = true, lockedRes = null } = {}) {
    const army = this.empty();
    let left = total;
    for (const [k, name] of Object.entries((preset && preset.units) || {})) {
      const slot = +k;
      if (!(slot >= 0 && slot <= 51) || name === '' || name === 'Blocked') continue;
      const c = this.cardCost(name, slot, tribe);
      if (total >= 0 && c > left) continue;
      army.cards[slot] = name;
      if (fixed) army.fixed[slot] = slotLevel(slot);
      left -= c;
    }
    if (tribe === 'Aje' && buildings) { army.cards[COLLECTOR_SLOT] = 'aje_resource_collector'; army.fixed[COLLECTOR_SLOT] = 1; army.collector = true; }
    for (const r of RES) {
      let a = (preset && preset.res && preset.res[r]) || 0;
      if (a < 0 || (lockedRes && lockedRes[r] != null)) { army.locked[r] = true; a = lockedRes && lockedRes[r] != null ? lockedRes[r] : 0; army.res[r] = a; army.min[r] = a; continue; }
      if (total >= 0) { a = Math.min(a, this.resFor(r, left, tribe)); left -= this.resCost(r, a, tribe); }
      army.res[r] = a;
      army.min[r] = fixed ? a : 0;
    }
    if (mp) { army.min.food = Math.max(army.min.food, GIFT); army.res.food = Math.max(army.res.food, GIFT); }
    return army;
  }
  // Clear (PD:337-379): no cards but the Aje collector, 30 food
  clear(tribe, { buildings = true, mp = true } = {}) {
    const army = this.load(null, tribe, 0, { buildings, mp });
    return army;
  }

  // ------------------------------------------------------------ the computer player's army (AIC:148-155)
  // <Tribe>/AiPBPreset<sub><Easy|Medium|Hard>, then without the difficulty, then the generic files; the tier of the
  // budget (exactly, else the largest below it: [?engine])
  aiPreset(tribe, credits, sub, difficulty) {
    const d = DIFF(difficulty), sets = [this.ai[tribe], this.ai.generic].filter(Boolean);
    let file = null;
    for (const set of sets) { file = set[sub + d] || set[sub] || null; if (file) break; }
    if (!file) for (const set of sets) { file = set['G1' + d] || set.G1 || null; if (file) break; }
    if (!file) return null;
    const tiers = Object.keys(file).map(Number).filter((t) => t <= credits).sort((a, b) => b - a);
    const t = file[credits] ? credits : tiers[0];
    const e = t != null ? file[t] : null;
    if (!e) return null;
    const units = {};
    // the generic files number the units 1..n and name them warrior / scout: the tribe's own of that kind [?engine]
    for (const [k, v] of Object.entries(e.chars || {})) units[k] = this.genericClass(v, tribe);
    return { name: 'ai', cost: credits, units, res: e.resources || {} };
  }
  genericClass(name, tribe) {
    if (name !== 'warrior' && name !== 'scout') return name;
    const own = tribe.toLowerCase() + '_' + name;
    if (this.D.exists(own) && this.price(own, 1, tribe)) return own;
    const cats = name === 'warrior' ? ['Character'] : ['Animals', 'Vehicles'];
    const first = Object.entries(this.pb.cats[tribe] || {}).find(([c, k]) => cats.includes(k) && !/_worker$/.test(c) && this.price(c, 1, tribe) && this.D.exists(c));
    return first ? first[0] : this.resolve('worker', tribe).cls;
  }

  // ------------------------------------------------------------ the game start (StartLocation.usl:482-689)
  // -> the units created. Workers stand in three groups by caste (res 0°, tec 120°, nat / Stina 240°), the others
  // anywhere around the start; each at its slot's level, at least the class's least level (CorrectLevelToMinLevel).
  // check: a human player's army is checked against the points (SL:661-688): more than allowed or less than 30 food
  // -> no resources, one worker (and the Aje collector)
  place(W, p, army, x, z, { stand = 4, face = 0, total = -1, check = false } = {}) {
    const D = this.D, made = [];
    const tribe = p.tribe;
    if (check && total >= 0 && (this.cost(army, tribe) > total || (army.res.food || 0) < GIFT)) {
      army = { cards: { 0: 'worker' }, res: { food: 0, wood: 0, stone: 0 } };
      if (tribe === 'Aje') army.cards[COLLECTOR_SLOT] = 'aje_resource_collector';
      p.cheated = true;
    }
    let i = 0;
    for (const [k, name] of Object.entries(army.cards).sort((a, b) => +a[0] - +b[0])) {
      if (name === 'Blocked') continue;
      const { cls, caste } = this.resolve(name, tribe);
      if (!D.exists(cls)) { console.warn('point buy: unknown class', cls); continue; }
      const ang = caste === 'tec' ? 2.094 : caste === 'nat' ? 4.189 : caste === 'res' ? 0 : (i * 2.399) % 6.283;
      const r = stand + 2 + (i % 3) * 1.4;
      const gx = x + Math.cos(face + ang) * r, gz = z + Math.sin(face + ang) * r;
      const lv = Math.max(slotLevel(+k), D.minLevel(cls, p));
      try { made.push(W.spawnUnit(cls, p, gx, gz, lv, face)); } catch (e) { console.warn('point buy: not created', cls, e.message); }
      i++;
    }
    for (const r of RES) p.res[r] = (army.res && army.res[r]) || 0;
    p.res.skulls = 0;
    return made;
  }
}
