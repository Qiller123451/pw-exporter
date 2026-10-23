// Playing a campaign mission with another tribe than the one it was made for (campaign menu "Your tribe").
//
// Every object the player owns - placed on the map, in the start army, created for the player by a trigger or given
// to the player later (OCPY) - becomes the chosen tribe's object of the same role; heroes and the Special tribe stay
// as they are. Conditions and queries that name a class of the mission's tribe accept the equivalent class for the
// player's objects (Registry.classIs), and the tech tree filters of the level and of TECH actions are translated
// path by path (filter()).
//
// Which class stands in for which is chosen among everything the chosen tribe can make in the game data of the mod
// configuration (its Build actions: a mod's new buildings and units take part - MIRAGE's SEAS have tents, a pub, a
// wall, spearmen ...), by closeness (profile(), distance()): what the object is (building, character, animal,
// vehicle, ship), what it does (wall piece, gate, harbour, worker, healer, transport, population, which units it
// makes, which goods it takes in, whether it is armed, how far it shoots), how big, sturdy, dear and late it is, and
// its name (aje_tent and seas_small_tent are both tents). ROLES below is the hand-made table of the base game's
// roles (from its build menus and the script classes CFireplace, CRallyBuilding, CWall ...): its entry is preferred
// a little, and a role it leaves empty (null) stays empty unless something fits well. An objective that asks for a
// class the chosen tribe has nothing for, or only in a later epoch, is met at once (missing()).
//
import { nodeAt } from '../techtree.js';

// classes that stay what they are whatever the tribe: Taslow's towers (the Amazon water temple, single_07: the
// player's towers at the start, which its triggers count by class - the user: "they shouldn't change")
const KEEP = new Set(['aje_tesla_tower', 'aje_tesla_tower_canon']);

//            role               Hu                        Aje                          Ninigi                         SEAS
export const ROLES = [
  // buildings (the workers' build menu)
  ['main', 'hu_fireplace', 'aje_resource_collector', 'ninigi_fireplace', 'seas_headquarters'],
  ['house', 'hu_stone_cottage', 'aje_tent', null, 'seas_barracks'],            // population: SEAS barracks (+25), Ninigi fireplace
  ['barracks', 'hu_arena', 'aje_rodeo', 'ninigi_dojo', 'seas_barracks'],
  ['animal farm', 'hu_small_animal_farm', 'aje_small_farm', 'ninigi_animal_farm', 'seas_garage'],
  ['smith', 'hu_weapons_smith', 'aje_weapons_builder', 'ninigi_weapon_maker', 'seas_barracks'],
  ['machines', 'hu_machine_maker', null, 'ninigi_engineer', 'seas_garage'],
  ['harbour', 'hu_harbour', 'aje_floating_harbour', 'ninigi_harbour', 'seas_carrier'],
  ['lumber', 'hu_lumberjack_cottage', null, 'ninigi_lumbermill', 'seas_steelwork'],
  ['quarry', 'hu_stone_quarry', null, 'ninigi_stone_quarry', 'seas_steelwork'],
  ['hunting', null, null, 'ninigi_hunting_lodge', 'seas_steelwork'],
  ['warehouse', 'hu_warehouse', 'aje_bazaar', 'ninigi_warehouse', 'seas_steelwork'],
  ['field', 'hu_corn_field', 'aje_slaughterhouse', 'ninigi_paddy', 'seas_greenhouse'],
  ['tavern', 'hu_tavern', 'aje_cook_house', 'ninigi_teahouse', null],
  ['temple', 'hu_temple', 'aje_temple', 'ninigi_temple', null],
  ['warpgate', 'hu_warpgate', 'aje_warpgate', 'ninigi_warpgate', null],
  ['small tower', 'hu_small_tower', 'aje_small_tower', 'ninigi_small_tower', 'seas_turret_tower'],
  ['large tower', 'hu_large_tower', 'aje_medium_tower', 'ninigi_telescope_tower', 'seas_turret_tower'],
  ['palisade', 'hu_palisade', 'aje_bone_palisade', 'ninigi_palisade', 'seas_fence'],
  ['palisade gate', 'hu_palisade_gate', 'aje_bone_palisade_gate', 'ninigi_palisade_gate', 'seas_gate'],
  ['wall', 'hu_small_wall', 'aje_clay_wall', 'ninigi_defense_skewer', 'seas_fence'],
  ['wall gate', 'hu_small_wall_gate', 'aje_clay_wall_gate', 'ninigi_defense_skewer_gate', 'seas_gate'],
  ['strong wall', 'hu_re_enforced_wall', 'aje_clay_wall', 'ninigi_defense_skewer', 'seas_fence'],
  ['strong wall gate', 'hu_re_enforced_wall_gate', 'aje_clay_wall_gate', 'ninigi_defense_skewer_gate', 'seas_gate'],
  ['rally point', 'hu_rally_point', 'aje_rally_point', 'ninigi_rally_point', 'seas_rally_point'],
  ['harbour rally point', 'hu_rally_point_harbour', 'aje_rally_point_harbour', 'ninigi_rally_point_harbour', 'seas_rally_point_harbour'],
  // characters: main building, barracks (menu positions 0-4), smith and temple
  ['worker', 'hu_worker', 'aje_worker', 'ninigi_worker', 'seas_worker'],
  ['warrior', 'hu_warrior', 'aje_warrior', 'ninigi_warrior', 'seas_warrior'],
  ['spearman', 'hu_spearman', 'aje_spearman', 'ninigi_spearman', 'seas_gunner'],
  ['archer', 'hu_archer', 'aje_archer', 'ninigi_archer', 'seas_marksman'],
  ['marksman', 'hu_marksman', 'aje_thrower', 'ninigi_marksman', 'seas_marksman'],
  ['pikeman', 'hu_pikeman', 'aje_rammer', 'ninigi_icespearman', 'seas_rocketman'],
  ['berserker', 'hu_berserker', 'aje_assassin', 'ninigi_sumo', 'seas_gunner'],
  ['killer', 'hu_killer', 'aje_poisoner', 'ninigi_ninja', 'seas_rocketman'],
  ['flamethrower', 'hu_flamethrower', 'aje_flamethrower', 'ninigi_flamethrower', 'seas_flamethrower'],
  ['priest', 'hu_druid', 'aje_shaman', 'ninigi_monk', 'seas_medic'],
  // animals (the animal farm's menu) and vehicles
  ['scout', 'hu_scout', 'aje_tracker_dino', 'ninigi_scout', 'seas_mechanical_walker'],
  ['archer carrier', 'hu_chariot', 'aje_triceratops_archer', 'ninigi_saltasaurus_archer', 'seas_triceratops_transporter'],   // captain class: the archer
  ['ranged animal', 'hu_kentrosaurus', 'aje_dilophosaurus', 'ninigi_saltasaurus_archer', 'seas_mobile_suit'],
  ['charger', 'hu_wild_boar', 'aje_ankylosaurus', 'ninigi_baryonyx', 'seas_triceratops'],
  ['medium animal', 'hu_rhino', 'aje_stegosaurus', 'ninigi_parasaurolophus_drums', 'seas_triceratops'],
  ['animal transport', 'hu_rhino_transporter', 'aje_triceratops_archer', 'ninigi_saltasaurus_archer', 'seas_triceratops_transporter'],
  ['siege animal', 'hu_rhino_ballista', 'aje_ankylosaurus', 'ninigi_parasaurolophus_gatling', 'seas_mobile_suit_flamethrower'],
  ['heavy animal', 'hu_mammoth', 'aje_brachiosaurus', 'ninigi_seismosaurus', 'seas_wehrspinne'],
  ['big hunter', 'hu_triceratops', 'aje_allosaurus', 'ninigi_seismosaurus', 'seas_wehrspinne'],
  ['sabre-tooth', 'hu_eusmilus', 'aje_eusmilus', 'ninigi_eusmilus', 'seas_triceratops'],
  ['cart', 'hu_cart', 'aje_trade_dino', 'ninigi_cart', 'seas_triceratops_resource_collector'],
  ['ram', 'hu_steam_ram', 'aje_ankylosaurus', 'ninigi_siegetower', 'seas_mobile_suit'],
  ['tank', 'hu_steam_tank', 'aje_atroxosaurus', 'ninigi_firecannon', 'seas_mobile_suit'],
  // ships (the harbour's menu; SEAS: the carrier's)
  ['fishing boat', 'hu_fishing_boat', 'aje_catamaran', 'ninigi_fishing_boat', null],
  ['transport ship', 'hu_transport_ship', 'aje_transport_turtle', 'ninigi_transport_boat', 'seas_hovercraft'],
  ['warship', 'hu_dragon_boat', 'aje_cronosaurus', 'ninigi_fire_boat', 'seas_submarine'],
  ['heavy warship', 'hu_steam_boat', 'aje_torpedo_turtle', 'ninigi_rocket_boat', 'seas_submarine'],
  ['ram ship', 'hu_ram_ship', 'aje_torpedo_turtle', 'ninigi_corsair', 'seas_submarine'],
];
export const TRIBES = ['Hu', 'Aje', 'Ninigi', 'SEAS'];
const PREFIX = { hu: 'Hu', aje: 'Aje', ninigi: 'Ninigi', seas: 'SEAS' };

// class name (lower case) -> [row of ROLES, ...] (a class can have several roles: aje_clay_wall is wall and strong wall)
const BY_CLASS = new Map();
for (const row of ROLES) for (let t = 1; t <= 4; t++) if (row[t]) { const k = row[t]; if (!BY_CLASS.has(k)) BY_CLASS.set(k, row); }

// words of class names that say little about what an object is (sizes, grades, upgrade stages)
const MODIFIERS = new Set(['small', 'medium', 'large', 'big', 'huge', 'heavy', 'light', 'mini', 're', 'enforced', 'new', 'upgrade', 'lumber']);
// head nouns that say little about what an object is: the trade dino is no tracker dino, the pirate boss ship no ram ship
const GENERIC = new Set(['dino', 'ship', 'boat', 'machine', 'maker', 'nest', 'field', 'farm', 'house', 'part', 'box', 'builder']);
const words = (cls) => String(cls).toLowerCase().replace(/^[a-z]+_/, '').split('_').filter((w) => w && !/^\d+$|^s\d$|^lvl\d$/.test(w));
const ln1 = (a, b) => Math.abs(Math.log((a + 1) / (b + 1)));
const NAME_NOUN = 3, NAME_WORD = 1, NAME_MOD = 0.5;
// thresholds of distance(): a class outside the table of the same kind by name fits up to FITS, else up to FILLS;
// it takes a table role over when it is at most BETTER farther than the table's class
const FITS = 8, FILLS = 2, BETTER = 1;

// the tribe a class belongs to by its name (hu_, aje_, ninigi_, seas_), null for heroes, Special and World objects
export function tribeOfClass(name) { const m = /^([a-z]+)_/.exec(String(name).toLowerCase()); return m ? PREFIX[m[1]] || null : null; }

export class TribeSwap {
  // D = Rules (exact class names), from = the tribe the mission gives the player, to = the chosen one; given = the
  // classes (lower case) of the objects the mission gives the player by name (setup.js givenClasses), native = the
  // mission's conditions ask for the chosen tribe's own classes (setup.js asksFor)
  constructor(D, from, to, { given = new Set(), native = false, models = null } = {}) {
    this.D = D; this.from = from; this.to = to; this.given = given; this.native = native;
    this.models = models;                         // the asset manifest's models (footprints: pf), or null
    this.col = TRIBES.indexOf(to) + 1;
    this.memo = new Map();
    // the buildings the chosen tribe's epochs need (the Dragon Clan: lumber mill and dojo): a level that forbids their
    // equivalents until a later epoch (the tutorial: barracks after epoch 2) must not lock the chosen tribe out
    this.epochNeeds = new Set(D.parseActions(to, (t) => nodeAt(D.base.start, `/Actions/${t}`), false)
      .filter((a) => a.kind === 'Upgrades' && /^age_\d$/.test(a.id)).flatMap((a) => a.breq.map((b) => String(b).toLowerCase())));
  }
  // the chosen tribe's class for a class of another tribe: undefined = the class is no tribe class (hero, World,
  // Special, already the chosen tribe's), null = the role has nothing in the chosen tribe, else the rules' class name
  equivalent(cls) {
    const lc = String(cls || '').toLowerCase();
    if (this.memo.has(lc)) return this.memo.get(lc);
    let out;
    const t = tribeOfClass(lc);
    if (t && t !== this.to && !KEEP.has(lc)) {
      const row = BY_CLASS.get(lc);
      let table = row ? row[this.col] : undefined;
      const lost = !!table && !this.exact(table);                         // a mod without the role's class (MIRAGE: the SEAS cart)
      if (lost) table = undefined;
      const a = this.profile(this.exact(lc) || lc, t);
      // the table's classes are the base game's roles: other classes (a mod's, those of the base game outside the
      // table) compete with them only where a role is outside the table, empty or filled better
      const best = a && this.closest(a, table === undefined ? null : (c) => !BY_CLASS.has(c.toLowerCase()));
      if (table) {
        out = this.exact(table);
        const b = out && a && this.profile(out, this.to), dt = b ? this.distance(a, b) : Infinity;
        // a class of the same kind by name that the table's is not (the Dustriders' tent -> MIRAGE's SEAS small tent)
        // and about as close. An incompatible table class stands: the table knows roles the data does not show (the
        // Dustriders' main building is an animal, the resource collector)
        const n = best && best.named;
        if (n && !this.sharesNoun(a, b) && Number.isFinite(dt) && n.d < dt + BETTER) out = n.cls;
      } else if (table === null) {
        const m = best && (best.named && best.named.d <= FITS ? best.named : best.d <= FILLS ? best : null);
        out = m ? m.cls : null;
      } else {
        const same = this.exact(lc.replace(/^[a-z]+_/, this.to.toLowerCase() + '_'));       // hu_harbour -> ninigi_harbour
        const m = best && (best.named && best.named.d <= FITS ? best.named : lost && best.d <= FITS ? best : null);
        out = same || (m ? m.cls : null);
      }
    }
    this.memo.set(lc, out);
    return out;
  }
  // ---------------------------------------------------------------- matching by closeness
  owner(tribe) {
    if (!this.owners) this.owners = new Map();
    if (!this.owners.has(tribe)) this.owners.set(tribe, { tribe, tt: this.D.newTree(tribe) });
    return this.owners.get(tribe);
  }
  // what a tribe's Build actions make: {cls (exact) -> {epoch, cost}} and {producer class -> Set of object types}
  made(tribe) {
    if (!this.madeBy) this.madeBy = new Map();
    if (this.madeBy.has(tribe)) return this.madeBy.get(tribe);
    const D = this.D, pre = tribe.toLowerCase() + '_', objs = new Map(), prod = new Map();
    for (const a of D.parseActions(tribe, (t) => nodeAt(D.base.start, `/Actions/${t}`), false)) {
      if (a.kind !== 'Build') continue;
      let ep = 0;
      for (const r of a.req) { const g = /^age_(\d)$/.exec(r); ep = Math.max(ep, g ? +g[1] : /_s\d$/i.test(r) ? 99 : 0); }
      const cost = a.cost.food + a.cost.wood + a.cost.stone;
      for (const r of a.results) {
        const cls = this.exact(r.obj);
        if (!cls || !cls.toLowerCase().startsWith(pre)) continue;
        const e = objs.get(cls);
        if (!e || ep < e.epoch) objs.set(cls, { epoch: ep, cost: e ? Math.min(e.cost, cost) : cost });
        const ix = D.info(cls);
        // animals and vehicles are the same kind of product (the Norse animal farm, the SEAS garage)
        for (const l of a.locs) { const at = String(l.at).toLowerCase(); if (!prod.has(at)) prod.set(at, new Set()); if (ix) prod.get(at).add(ix.type === 'VHCL' ? 'ANML' : ix.type); }
      }
    }
    const out = { objs, prod };
    this.madeBy.set(tribe, out);
    return out;
  }
  // what a class is and does, for distance()
  profile(cls, tribe) {
    if (!this.profiles) this.profiles = new Map();
    const key = tribe + '|' + cls;
    if (this.profiles.has(key)) return this.profiles.get(key);
    const D = this.D, o = this.owner(tribe), ix = D.info(cls), d = ix && D.def(cls, o);
    const lv = d ? Object.keys(d.levels).map(Number).sort((x, y) => x - y).find((k) => d.levels[k] && d.levels[k].exists) : undefined;
    const s = lv !== undefined ? d.levels[lv] : null;                                          // its first level
    let p = null;
    if (s && s.exists) {
      const M = this.made(tribe), b = M.objs.get(cls) || { epoch: 0, cost: 0 };
      const ws = D.weaponSet(cls, lv, o), w = ws && ws.long && D.weaponStats(ws.long, cls, o);
      const mdl = this.models && [s.gfx, D.classGfx(cls)].map((g) => g && this.models[String(g).toLowerCase()]).find(Boolean);
      const pf = mdl ? mdl.pf : null;
      const prod = M.prod.get(cls.toLowerCase()) || new Set();
      p = {
        cls, type: ix.type, wall: d.wallKind || '', coastal: !!d.coastal, pop: s.limits.max_units || 0, prod,
        drop: new Set(d.delivery), unlimited: d.unlimited.length > 0, heal: !!s.heal,
        worker: d.can_build > 0 && d.can_harvest > 0, gatherer: !(d.can_build > 0) && d.can_harvest > 0,   // all Dustriders build
        transport: (d.maxPassengers || 0) > 0, armed: !!(w && w.dmg > 0), dps: w ? w.dmg / Math.max(0.3, w.dur) : 0, range: w ? w.range : 0,
        hp: s.hp, cost: b.cost, epoch: Math.min(b.epoch, 6),
        area: pf ? pf.filter((r) => r[0] === 1).reduce((a, r) => a + Math.abs(r[4] * r[5]), 0) : 0,
        words: words(cls),
        shown: !this.models || !!mdl,          // MIRAGE's SEAS spearmen and snipers name models the game does not have
      };
    }
    this.profiles.set(key, p);
    return p;
  }
  // how far apart two classes are (Infinity: one can never stand for the other)
  distance(a, b) {
    if ((a.type === 'BLDG') !== (b.type === 'BLDG') || (a.type === 'SHIP') !== (b.type === 'SHIP')) return Infinity;
    if (a.wall !== b.wall || a.coastal !== b.coastal || a.worker !== b.worker) return Infinity;
    const diff = (x, y) => { let n = 0; for (const k of x) if (!y.has(k)) n++; for (const k of y) if (!x.has(k)) n++; return n; };
    let d = 0;
    if (a.type !== b.type) d += a.type === 'CHTR' || b.type === 'CHTR' ? 6 : 1.5;        // animal <-> vehicle: close
    if (a.type === 'BLDG') {
      d += 3 * diff(a.prod, b.prod) + 0.5 * diff(a.drop, b.drop) + ((a.pop > 0) !== (b.pop > 0) ? 1.5 : 0) + 0.5 * ln1(a.pop, b.pop);
      if (a.unlimited !== b.unlimited) d += 3;
      if (a.armed !== b.armed) d += 3;
    } else {
      if (a.heal !== b.heal) d += 6;
      if (a.gatherer !== b.gatherer) d += 5;
      if (a.transport !== b.transport) d += 4;
      if (a.armed !== b.armed) d += 4;
      if ((a.range > 8) !== (b.range > 8)) d += 4;                                     // fights from afar or up close
      d += 0.7 * ln1(a.dps, b.dps) + 0.03 * Math.abs(a.range - b.range);
    }
    d += 0.7 * ln1(a.hp, b.hp) + 0.7 * ln1(a.cost, b.cost);
    if (a.area && b.area) d += 0.7 * ln1(a.area, b.area);
    d += b.epoch > a.epoch ? b.epoch - a.epoch : 0.25 * (a.epoch - b.epoch);           // not later in the game than the original
    let name = this.sharesNoun(a, b) ? NAME_NOUN : 0;
    for (const w of a.words.slice(0, -1)) if (b.words.includes(w)) name += MODIFIERS.has(w) || GENERIC.has(w) ? NAME_MOD : NAME_WORD;
    return d - Math.min(name, 1.5 * NAME_NOUN);
  }
  // the names end in the same telling noun (aje_tent, seas_small_tent)
  sharesNoun(a, b) {
    const x = a && a.words[a.words.length - 1], y = b && b.words[b.words.length - 1];
    return !!x && x === y && !MODIFIERS.has(x) && !GENERIC.has(x);
  }
  // the chosen tribe's closest class to the profile a among those that pass `only`, and the closest of those whose
  // name shares a noun with a's: {cls, d, named: {cls, d} | null} or null
  closest(a, only) {
    let best = null, named = null;
    for (const c of this.made(this.to).objs.keys()) {
      if (only && !only(c)) continue;
      const b = this.profile(c, this.to);
      const d = b && b.shown ? this.distance(a, b) : Infinity;
      if (!Number.isFinite(d)) continue;
      if (!best || d < best.d) best = { cls: c, d };
      if (this.sharesNoun(a, b) && (!named || d < named.d)) named = { cls: c, d };
    }
    return best && { ...best, named };
  }


  // the epoch a class can first be made in (its Build action's inventions: age_N; a hero's invention: never), 0 if
  // nothing is needed or it is not made at all
  epoch(cls, tribe) { const e = this.made(tribe).objs.get(this.exact(cls)); return e ? e.epoch : 0; }

  exact(lc) {
    const D = this.D;
    if (!this.lcIndex) { this.lcIndex = new Map(); for (const k of D.index.keys()) this.lcIndex.set(k.toLowerCase(), k); }
    return this.lcIndex.get(String(lc).toLowerCase()) || null;
  }
  // the class an object of the player becomes (the class itself when it has no equivalent)
  cls(name) { const e = this.equivalent(name); return e || name; }
  // the chosen tribe's class that an object query of the mission's tribe means (a condition counting the Norsemen's
  // workers counts the chosen tribe's). Classes of the other tribes are meant as they are, and nothing is translated
  // when the mission asks for the chosen tribe's classes itself (mission 14: the original's own tribe choice)
  standsFor(name) { return !this.native && tribeOfClass(name) === this.from ? this.equivalent(name) : undefined; }
  // a class the mission names that the chosen tribe has nothing for, or only later in the game (the Dragon Clan's
  // archer carrier needs epoch 3, the Dustriders' a hero's invention; the Norse chariot comes with epoch 2): an
  // objective about it is met at once (conditions.js). A class outside the table without a namesake whose object the
  // mission gives the player by name is not missing: the player has that very object (mission 12's telescope tower ruin)
  missing(name) {
    const lc = String(name || '').toLowerCase();
    if (tribeOfClass(lc) !== this.from) return false;
    const e = this.equivalent(lc);
    if (e === null) return BY_CLASS.has(lc) || !this.given.has(lc);
    return !!e && this.epoch(e, this.to) > this.epoch(lc, this.from);
  }
  // a tech tree filter path of the mission's tribe for the chosen tribe (null: drop it)
  //   /Filters/AntiActions/Hu/Build/CHTR/hu_warrior_2       -> .../SEAS/Build/CHTR/seas_warrior_2
  //   /Filters/AntiActions/Hu/Upgrades/hu_fireplace/age_3   -> .../SEAS/Upgrades/seas_headquarters/age_3 (ages only)
  //   /Filters/AntiActions/Hu/Build/CHTR/lovelace_s0        -> .../SEAS/Build/CHTR/lovelace_s0 (heroes: the tribe only)
  // the level's filters for the chosen tribe: each translated (filter); a ban of an equivalent that another class
  // of the level's tribe - one the level does not ban - turns into as well is dropped. The Dustriders' first mission
  // bans the clay wall and its gate but not the bone palisade and its gate: both pairs are the SEAS fence and gate,
  // which the ban took away altogether.
  filters(list) {
    const banned = new Set();
    for (const f of list) { const m = /AntiActions\/[A-Za-z]+\/Build\/[A-Za-z]+\/([^/\s]+)\s*$/.exec(String(f)); if (m) banned.add(m[1].toLowerCase()); }
    const sources = this.memo.get('#sources') || (() => {
      const r = this.D.parseActions(this.from, (t) => nodeAt(this.D.base.start, `/Actions/${t}`), false).filter((a) => a.kind === 'Build' && a.results[0]).map((a) => a.results[0].obj);
      this.memo.set('#sources', r);
      return r;
    })();
    const out = [];
    for (const f of list) {
      const g = this.filter(f);
      if (!g) continue;
      const m = /AntiActions\/[A-Za-z]+\/Build\/[A-Za-z]+\/([^/\s]+)\s*$/.exec(g);
      if (m) {
        const target = m[1].toLowerCase();
        const shared = sources.some((c) => !banned.has(c.toLowerCase()) && (this.equivalent(c) || '').toLowerCase() === target);
        if (shared) continue;
      }
      out.push(g);
    }
    return out;
  }
  filter(path) {
    const p = String(path).trim(), m = /^(\/?Filters\/(?:AntiActions\/)?)([A-Za-z]+)\/(.*)$/.exec(p);
    if (!m || m[2] !== this.from) return p;                     // another tribe's filter, Items, ...: as it is
    const [head, rest] = [m[1] + this.to + '/', m[3].split('/')];
    if (rest[0] === 'Build' && rest.length >= 3) {
      const lv = /^(.*?)(_\d)?$/.exec(rest[2]);
      if (!tribeOfClass(lv[1])) return head + rest.join('/');      // heroes
      const e = this.equivalent(lv[1]);
      if (!e || (/AntiActions/.test(m[1]) && this.epochNeeds.has(e.toLowerCase()))) return null;
      const ix = this.D.info(e);
      return head + ['Build', ix ? ix.type : rest[1], e.toLowerCase() + (lv[2] || '')].join('/');
    }
    if (rest[0] === 'Upgrades' && rest.length >= 3 && /^age_\d$/.test(rest[2])) {
      const e = this.equivalent(rest[1]);
      return e ? head + ['Upgrades', e.toLowerCase(), rest[2]].join('/') : null;
    }
    if (rest[0] === 'BuildObjects' && rest.length >= 2) {
      const e = this.equivalent(rest[1]);
      return e ? head + ['BuildObjects', e.toLowerCase()].join('/') : null;
    }
    return null;                                                 // tribe-specific upgrades: nothing to translate
  }
}
