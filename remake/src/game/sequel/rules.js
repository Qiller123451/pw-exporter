// The sequel campaign's own classes (docs/SEQUEL.md): copies of original classes with other models, values and
// weapons, written into the tech tree before the rules are read (sequelData). Each copy takes the original's level
// filters, weapons (copied under the new name: their Users list the copy), build action and moves, with the changes
// below; the rules the original's scripts keep by class name (hero auras, Taslow's building speed) hold for it too
// (Rules.kind).
// Only the sequel's games use these rules; the original campaign and the skirmish keep the original tree.
//
//   from     the original class it starts from
//   set      values of the object node (and of every level's bonus data): gfx, hitpoints, FOW, speeds ...
//   hp       hit points factor at every level
//   weapons  'none', or changes for the copied weapons {damage, range, level, only (ids to copy: a RegExp),
//            from: [other weapon ids to copy instead]}
//   build    {at, cost: {food, wood, stone, power}, time, menupos, age, icon} - its build action (else the original's;
//            at: the building that makes it)
//            (power: the sequel's electricity, game/sequel/power.js)
//   desc     the name shown in the game (its other texts: texts.js)
import { SEQUEL_TEXTS } from './texts.js';

// The sequel is played with the MIRAGE mod's game data: its SEAS (more units and buildings, the heroes' bonuses for
// SEAS, its fixed hero tooltips). ui/menu.js switches to that configuration, main.js refuses other data.
export const SEQUEL_MOD = 'MIRAGE';

const SEAS = 'SEAS';
export const SEQUEL_CLASSES = {
  // ---------------------------------------------------------------- infantry
  sq_trooper: { from: 'seas_gunner', desc: 'Containment Trooper', hp: 1.0, weapons: { damage: 1.0 }, build: { at: 'seas_barracks', cost: { food: 60, wood: 20 }, age: 1 } },
  sq_tranq: { from: 'seas_marksman', desc: 'Tranquilizer Marksman', weapons: { damage: 1.0, only: /_l$/ }, tags: ['tranq'], build: { at: 'seas_barracks', cost: { food: 60, wood: 30 }, age: 1 } },
  // Taslov's arc rifle: every hit also stuns for a moment (Sequel.damageHook); it runs on power
  sq_shock_trooper: { from: 'seas_gunner', desc: 'Shock Trooper', hp: 1.1, weapons: { damage: 1.15 }, tags: ['shock'], build: { at: 'seas_barracks', cost: { food: 60, power: 40 }, age: 1 } },
  // ---------------------------------------------------------------- machines (the garage)
  sq_jeep: { from: 'seas_mechanical_walker', desc: 'Recon Jeep', set: { gfx: 'sq_jeep', defaultspeed: '4', maxspeed: '4', FOW: '55.000000', can_harvest: '0', can_build: '0' }, hp: 0.7,
    weapons: { from: ['seas_helicopter_weapon_c', 'seas_helicopter_weapon_d', 'seas_helicopter_weapon_e'], damage: 0.8, level: 1 },
    build: { at: 'seas_garage', cost: { food: 40, wood: 80, stone: 40 }, time: 20, age: 1 } },
  sq_capture_truck: { from: 'seas_mechanical_walker', desc: 'Capture Truck', set: { gfx: 'sq_capture_truck', defaultspeed: '3', maxspeed: '3', can_harvest: '0', can_build: '0' }, hp: 1.4, weapons: 'none', tags: ['capture'],
    build: { at: 'seas_garage', cost: { food: 60, wood: 120, stone: 60 }, time: 25, age: 1 } },
  sq_aa_halftrack: { from: 'seas_mobile_suit', desc: 'Flak Halftrack', set: { gfx: 'sq_aa_halftrack', defaultspeed: '3', maxspeed: '3', FOW: '50.000000' }, hp: 0.9,
    weapons: { from: ['seas_hq_machinegun_nest_weapon'], damage: 1.6, range: 40, level: 1 }, build: { at: 'seas_garage', cost: { food: 80, wood: 150, stone: 120 }, time: 30, age: 2 } },
  sq_arc_halftrack: { from: 'seas_mobile_suit', desc: 'Arc Halftrack', set: { gfx: 'sq_arc_halftrack', defaultspeed: '3', maxspeed: '3', FOW: '45.000000' }, hp: 1.0, tags: ['shock', 'chain'],
    weapons: { from: ['aje_tesla_tower_weapon'], damage: 0.3, range: 32, level: 1 }, build: { at: 'seas_garage', cost: { wood: 100, stone: 100, power: 120 }, time: 30, age: 2 } },
  // ---------------------------------------------------------------- structures (the engineers' build menu)
  sq_stabilizer: { from: 'seas_turret_tower', desc: 'Rift Stabilizer', set: { gfx: 'sq_stabilizer', FOW: '30.000000' }, hp: 0.6, weapons: 'none', tags: ['stabilizer'],
    build: { cost: { wood: 150, stone: 200 }, time: 30, age: 1, menupos: 3 } },
  sq_searchlight: { from: 'seas_turret_tower', desc: 'Searchlight Tower', set: { gfx: 'sq_searchlight', FOW: '70.000000' }, hp: 0.3, weapons: 'none', tags: ['searchlight'],
    build: { cost: { wood: 60, power: 40 }, time: 15, age: 1, menupos: 4 } },
  sq_flak: { from: 'seas_turret_tower', desc: 'Gun Emplacement', set: { gfx: 'sq_flak', FOW: '45.000000' }, hp: 0.5,
    weapons: { from: ['seas_hq_machinegun_nest_weapon'], damage: 1.4, range: 38 }, build: { cost: { wood: 120, stone: 100 }, time: 20, age: 1, menupos: 5 } },
  sq_radar: { from: 'seas_turret_tower', desc: 'Radar Station', set: { gfx: 'sq_radar', FOW: '140.000000' }, hp: 0.4, weapons: 'none',
    build: { cost: { wood: 100, stone: 150 }, time: 25, age: 2, menupos: 6 } },
  sq_field_hq: { from: 'seas_turret_tower', desc: 'Field Command Post', set: { gfx: 'sq_field_hq', FOW: '45.000000' }, hp: 0.5, weapons: 'none', tags: ['commandpost'], build: false },
  // electricity (power.js): plants take workers (unlimited power: a worker's job, economy.js), poles carry the line
  sq_power_station: { from: 'seas_turret_tower', desc: 'Generating Station', set: { gfx: 'sq_power_station_b', FOW: '40.000000', unlimited: { power: '1' }, maxworkers: '6' }, hp: 2.5, weapons: 'none', build: false },
  sq_power_pole: { from: 'seas_turret_tower', desc: 'Power Pole', set: { gfx: 'sq_power_pole', FOW: '15.000000' }, hp: 0.12, weapons: 'none', tags: ['pole'],
    build: { cost: { wood: 40 }, time: 6, age: 1, menupos: 8 } },
  sq_generator: { from: 'seas_turret_tower', desc: 'Diesel Generator', set: { gfx: 'sq_generator', FOW: '20.000000', unlimited: { power: '1' }, maxworkers: '2' }, hp: 0.4, weapons: 'none',
    build: { cost: { wood: 120, stone: 60 }, time: 20, age: 1, menupos: 9 } },
  sq_windmill: { from: 'seas_turret_tower', desc: 'Wind Charger', set: { gfx: 'sq_windmill', FOW: '25.000000' }, hp: 0.3, weapons: 'none',
    build: { cost: { wood: 150, stone: 40 }, time: 25, age: 1, menupos: 10 } },
  sq_watermill: { from: 'seas_turret_tower', desc: 'Water Wheel', set: { gfx: 'sq_watermill', FOW: '25.000000', coastal: '1', unlimited: { power: '1' }, maxworkers: '2' }, hp: 0.6, weapons: 'none',
    build: { cost: { wood: 200, stone: 80 }, time: 30, age: 1, menupos: 11 } },
  sq_tesla_coil: { from: 'seas_turret_tower', desc: 'Tesla Coil', set: { gfx: 'sq_tesla_coil', FOW: '45.000000' }, hp: 0.7, tags: ['chain'],
    weapons: { from: ['aje_tesla_tower_weapon'], damage: 0.45, range: 40, level: 1 }, build: { cost: { stone: 120, power: 150 }, time: 25, age: 2, menupos: 12 } },
  sq_launch_pad: { from: 'seas_turret_tower', desc: 'Launch Complex 34', set: { gfx: 'sq_launch_pad', FOW: '40.000000' }, hp: 2.0, weapons: 'none', build: false },
  sq_gate_machine: { from: 'seas_turret_tower', desc: 'Gate Machine', set: { gfx: 'sq_gate_machine', FOW: '50.000000' }, hp: 4.0, weapons: 'none', build: false },
  sq_rift: { from: 'seas_turret_tower', desc: 'Rift', set: { gfx: 'sq_rift_b', FOW: '20.000000' }, hp: 5, weapons: 'none', tags: ['rift'], build: false },
  sq_electric_net: { from: 'seas_turret_tower', desc: 'Electrified Net', set: { gfx: 'sq_electric_net', FOW: '20.000000' }, hp: 0.5, weapons: 'none', tags: ['net'], build: { cost: { wood: 60, power: 80 }, time: 20, age: 1, menupos: 7 } },
  // ---------------------------------------------------------------- people and creatures of the story
  sq_civilian_1: { from: 'seas_worker', desc: 'Civilian', set: { gfx: 'hc_citizen_01', can_build: '0', can_harvest: '0' }, hp: 0.6, weapons: 'none', tags: ['civilian'], build: false },
  sq_civilian_2: { from: 'seas_worker', desc: 'Civilian', set: { gfx: 'hc_citizen_02', can_build: '0', can_harvest: '0' }, hp: 0.6, weapons: 'none', tags: ['civilian'], build: false },
  sq_civilian_3: { from: 'seas_worker', desc: 'Civilian', set: { gfx: 'hc_citizen_03', can_build: '0', can_harvest: '0' }, hp: 0.6, weapons: 'none', tags: ['civilian'], build: false },
  sq_civilian_4: { from: 'seas_worker', desc: 'Civilian', set: { gfx: 'hc_citizen_04', can_build: '0', can_harvest: '0' }, hp: 0.6, weapons: 'none', tags: ['civilian'], build: false },
  sq_big_tooth: { from: 'Gigantosaurus', tribe: 'World', desc: 'Big Tooth', hp: 9.0, weapons: { damage: 2.2 }, tags: ['boss'] },
};
// the heroes of the sequel: hero classes of the first game with the sequel's names and portraits (game/sequel/cast.js)
export const SEQUEL_HEROES = {
  sq_halloran: { from: 'lovelace_s0', desc: 'Col. Margaret Halloran', hp: 1.6, weapons: { damage: 1.3 } },
  sq_taslov: { from: 'tesla_s0', desc: 'Dr. Lev Taslov', hp: 1.0 },
  sq_booker: { from: 'Cole_s0', desc: 'Sgt. Elijah Booker', hp: 1.4, weapons: { damage: 1.2 } },
  sq_tala: { from: 'Stina_s0', desc: 'Tala of the Dustriders', hp: 1.3, weapons: { damage: 1.2 } },
  sq_crane: { from: 'babbage_s0', desc: 'Augustus Crane', hp: 2.5, weapons: { damage: 1.4 } },
};
const ALL = { ...SEQUEL_CLASSES, ...SEQUEL_HEROES };
export const tagsOf = (name) => (ALL[name] && ALL[name].tags) || [];
export const sourceOf = (name) => (ALL[name] ? ALL[name].from : null);

const TYPES = ['CHTR', 'ANML', 'VHCL', 'BLDG', 'SHIP'];
function findClass(O, name) {
  for (const tribe in O) for (const type of TYPES) { const n = O[tribe][type] && O[tribe][type][name]; if (n && typeof n === 'object') return { tribe, type, node: n }; }
  return null;
}
const f6 = (v) => Number(v).toFixed(6);
function applySet(node, spec) {
  if (spec.set) Object.assign(node, structuredClone(spec.set));
  if (spec.hp && node.hitpoints) node.hitpoints = f6(parseFloat(node.hitpoints) * spec.hp);
}

// the tech tree and game data with the sequel's classes (copies; the originals are not changed);
// locked: classes whose build actions are left out (not yet brought in by the campaign: missions.js lockedBefore)
export function sequelData(ttIn, extraIn, locked = new Set()) {
  const tt = structuredClone(ttIn), extra = structuredClone(extraIn || {});
  const O = tt.StartTT.Objects;
  extra.texts = extra.texts || {};
  extra.script = extra.script || {};
  extra.composites = extra.composites || {};
  extra.sameAs = extra.sameAs || {};
  for (const [name, spec0] of Object.entries(ALL)) {
    const spec = { ...spec0, name };
    const src = findClass(O, spec.from);
    if (!src) { console.warn('sequel: no class', spec.from); continue; }
    const tribe = spec.tribe || (src.tribe === 'World' || src.tribe === 'Special' ? src.tribe : SEAS);
    O[tribe] = O[tribe] || {};
    O[tribe][src.type] = O[tribe][src.type] || {};
    const node = structuredClone(src.node);
    applySet(node, spec);
    O[tribe][src.type][name] = node;
    // level filters: the original's bonus data with the same changes
    const FU = tt.Filters[src.tribe] && tt.Filters[src.tribe].Upgrades && tt.Filters[src.tribe].Upgrades[spec.from];
    if (FU) {
      tt.Filters[tribe] = tt.Filters[tribe] || {};
      tt.Filters[tribe].Upgrades = tt.Filters[tribe].Upgrades || {};
      const copy = {};
      for (const [k, f] of Object.entries(FU)) {
        if (!f || typeof f !== 'object') continue;
        const g = JSON.parse(JSON.stringify(f).split(`/${spec.from}/`).join(`/${name}/`).split(`/${spec.from}"`).join(`/${name}"`));
        if (g.LevelBonusData) applySet(g.LevelBonusData, spec);
        copy[k] = g;
      }
      tt.Filters[tribe].Upgrades[name] = copy;
    }
    // weapons
    const W = O[src.tribe].Weapons || {};
    const wsrc = spec.weapons && spec.weapons.from ? spec.weapons.from.map((id) => { for (const t in O) if (O[t].Weapons && O[t].Weapons[id]) return [id, O[t].Weapons[id]]; return null; }).filter(Boolean)
      : Object.entries(W).filter(([id, w]) => w && typeof w === 'object' && Object.values(w.Users || {}).includes(spec.from) && (!spec.weapons || !spec.weapons.only || spec.weapons.only.test(id)));
    if (spec.weapons !== 'none') {
      O[tribe].Weapons = O[tribe].Weapons || {};
      for (const [id, w] of wsrc) {
        const c = structuredClone(w);
        c.Users = { 0: name };
        const m = spec.weapons || {};
        if (m.damage && c.damage) c.damage = f6(parseFloat(c.damage) * m.damage);
        if (m.damage && c.enddamage) c.enddamage = f6(parseFloat(c.enddamage) * m.damage);
        if (m.range) c.range = f6(m.range);
        if (m.level) c.level = String(m.level);
        O[tribe].Weapons[`${id}__${name}`] = c;
      }
    }
    // build action
    const A = tt.StartTT.Actions[src.tribe] && tt.StartTT.Actions[src.tribe].Build;
    // the original's build action: the one at `at` (MIRAGE builds some SEAS units in other places, or in variants
    // its filters show), else a visible one, else the first
    const b0 = spec.build || {}, cands = [];
    if (A) for (const cat in A) for (const id in A[cat]) { const a = A[cat][id]; if (a && a.results && Object.values(a.results).some((r) => r && r._value && r._value.endsWith('/' + spec.from))) cands.push([cat, a]); }
    const locs = (a) => Object.values(a.locations || {}).filter((l) => l && typeof l === 'object');
    const act = (b0.at && cands.find(([, a]) => locs(a).some((l) => String(l._value).endsWith('/' + b0.at)))) ||
      cands.find(([, a]) => !['0', '-1'].includes(String(a.visibility))) || cands[0] || null;
    if (act && spec.build !== false && !locked.has(name)) {
      const [cat, a0] = act;
      const a = structuredClone(a0);
      for (const r of Object.values(a.results)) if (r && r._value) r._value = `/Objects/${tribe}/${src.type}/${name}`;
      const b = spec.build || {};
      a.visibility = '1';                                   // the campaign decides what can be built (missions.js unlocks)
      if (b.at) {
        const keep = locs(a).find((l) => String(l._value).endsWith('/' + b.at)) || { ...(locs(a)[0] || {}), _value: `/Objects/${SEAS}/BLDG/${b.at}` };
        a.locations = { 0: keep };
      }
      a.conditions = a.conditions || {};
      if (b.cost) a.conditions.rescosts = { units: '0', food: String(b.cost.food || 0), wood: String(b.cost.wood || 0), stone: String(b.cost.stone || 0), iron: '0', power: String(b.cost.power || 0) };
      if (b.age != null) a.conditions.inventobjects = b.age > 1 ? { 0: 'age_' + b.age } : {};
      if (b.time) a.duration = String(b.time);
      for (const l of Object.values(a.locations || {})) {
        if (!l || typeof l !== 'object') continue;
        if (b.menupos != null && l.uiposition) l.uiposition.menupos = String(b.menupos);
        l.iconpath = b.icon || name;           // its own card (pipeline/sequel_assets.py), else the hud falls back to the original's
      }
      tt.StartTT.Actions[tribe] = tt.StartTT.Actions[tribe] || {};
      tt.StartTT.Actions[tribe].Build = tt.StartTT.Actions[tribe].Build || {};
      tt.StartTT.Actions[tribe].Build[cat] = tt.StartTT.Actions[tribe].Build[cat] || {};
      tt.StartTT.Actions[tribe].Build[cat][name] = a;
    }
    // the original's moves (the heroes' special moves from level 3: Headshot, Shotgun, ...), unless it has no weapons
    if (spec.weapons !== 'none') {
      const from = `/Objects/${src.tribe}/${src.type}/${spec.from}`;
      for (const t in tt.StartTT.Actions) for (const cat in tt.StartTT.Actions[t].Moves || {}) for (const m of Object.values(tt.StartTT.Actions[t].Moves[cat] || {})) {
        const L = m && m.locations;
        const l = L && Object.values(L).find((x) => x && x._value === from);
        if (l) L[Object.keys(L).length] = { ...structuredClone(l), _value: `/Objects/${tribe}/${src.type}/${name}` };
      }
    }
    // what the scripts and the interface know of the original: script class, idle animations, the name
    const lc = spec.from.toLowerCase();
    if (extra.script[lc]) extra.script[name] = extra.script[lc];
    extra.sameAs[name] = spec.from;                                       // Rules.kind: the original's scripted rules
    if (!spec.weapons || spec.weapons !== 'none') { if (extra.composites[lc] && !/^sq_(stabilizer|searchlight|radar|field_hq|electric_net|flak|power_pole|generator|windmill|watermill|tesla_coil|power_station)$/.test(name)) extra.composites[name] = extra.composites[lc]; }
    if (extra.idle && extra.idle[lc]) extra.idle[name] = extra.idle[lc];
    // the texts: the sequel's own (texts.js), else the original's. (The description key stays the original's: a class
    // without a card of its own - pipeline/sequel_assets.py puts them in the atlas - shows the original's.)
    const dk = String(src.node.description || '').replace(/^_/, '').toLowerCase();        // the heroes' texts: by description key
    const t0 = extra.texts[lc] || extra.texts[spec.from] || extra.texts[dk] || { vs: {}, medium: '', long: '' }, t1 = SEQUEL_TEXTS[name] || {};
    extra.texts[name] = { ...structuredClone(t0), ...t1, vs: { ...t0.vs, ...t1.vs }, name: spec.desc || t0.name || name };
  }
  // the tranquilizer darts' debuff (runtime.js damageHook): an icon of the info window, seen by everybody
  extra.buffs = [...(extra.buffs || []).filter((b) => b.attrib !== 'sq_tranquilized'), { attrib: 'sq_tranquilized', tile: -1, vis: 1, icon: 'bufficon_poisoned', tip: '_iw_buff_sq_tranquilized' }];
  extra.texts.iw_buff_sq_tranquilized = { name: 'Tranquilized', cls: '', vs: {}, long: '',
    medium: 'A tranquilizer dart is working: a blow that would kill this creature puts it to sleep at 1 hit point instead. It wears off 30 seconds after the last dart.' };
  return { tt, extra };
}
