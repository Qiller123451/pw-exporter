// The computer player's tables: lookups into ai.json (pipeline/build_ai.py, docs/spec/ai.md §12) with a built-in
// fallback for every table, so the AI also plays on game data built before the "ai" step existed and for tribes whose
// settings folder is missing from an installation (armies / unit mix: then derived from the tech tree by the callers).

let AI = null;
export function setAiData(json) { AI = json && typeof json === 'object' ? json : null; }
export const hasAiData = () => !!AI;

export const TICK = 0.2;                         // one AI tick in seconds (think waits are counted in ticks)
export const MENU_LEVELS = { easy: 1, normal: 4, hard: 8 };   // skirmish menu -> difficulty 0-9 (the campaign's defaults)

// ---------------------------------------------------------------- difficulty (CM:159-187 and the Server scripts)
const row = (cls, wait, gift, strength, gather, bt, rt, lim, wd, py) => ({ class: cls, wait, controlWait: Math.max(20, wait > 20 ? wait : 20), gift: { food: gift[0], wood: gift[1], stone: gift[2], skulls: gift[3] },
  attackStrength: strength, quickAttackStrength: Math.min(0.6, strength), pyramidAttackUnits: py, gather, buildTime: bt, researchTime: rt, unitLimit: { levels: lim.slice(0, 5), total: lim[5] }, weaponDuration: wd });
const Z = [0, 0, 0, 0, 0, 0];
const LEVELS = [
  row('Easy', 100, [0, 0, 0, 0], 0.2, 1, 1, 1, Z, 1, 2), row('Easy', 75, [0, 0, 0, 0], 0.25, 1, 1, 1, Z, 1, 3),
  row('Easy', 50, [1, 1, 0, 0], 0.3, 1, 1, 1, Z, 1, 4), row('Medium', 30, [2, 2, 1, 0], 0.35, 1, 1, 1, Z, 1, 5),
  row('Medium', 25, [3, 3, 1, 0], 0.4, 1, 1, 1, Z, 1, 6), row('Medium', 20, [4, 4, 1, 0], 0.45, 1.25, 0.95, 0.95, Z, 1, 7),
  row('Hard', 16, [5, 5, 2, 0], 0.5, 1.5, 0.9, 0.9, Z, 1, 8), row('Hard', 14, [7, 7, 2, 1], 0.55, 1.75, 0.8, 0.7, [2, 1, 1, 0, 0, 4], 1, 9),
  row('Hard', 12, [10, 10, 5, 1], 0.6, 2, 0.75, 0.6, [5, 3, 2, 0, 0, 10], 0.95, 10), row('Hard', 10, [50, 50, 20, 5], 0.65, 2.5, 0.5, 0.4, [10, 10, 7, 1, 0, 28], 0.9, 10),
];
const clampD = (d) => Math.max(0, Math.min(9, Math.round(Number.isFinite(+d) ? +d : 5)));
export function level(d) {
  d = clampD(d);
  const j = AI && AI.difficulty && AI.difficulty.levels && AI.difficulty.levels[d];
  return j ? { ...LEVELS[d], ...j } : LEVELS[d];
}
// what a control think really gives (CH:309-352): skirmish maps a fixed amount per listed resource by class
// (Easy 5, Medium 20 / 3 skulls, Hard as listed); other maps the listed amount + 10 (skulls as listed)
export function gift(d, multimap) {
  const lv = level(d), g = lv.gift, out = { food: 0, wood: 0, stone: 0, skulls: 0 };
  const G = (AI && AI.difficulty && AI.difficulty.gift) || { skirmish: { Easy: { food: 5, wood: 5, stone: 5, skulls: 0 }, Medium: { food: 20, wood: 20, stone: 20, skulls: 3 } }, campaignAdd: 10 };
  const fix = multimap ? G.skirmish[lv.class] : null;
  for (const r in out) {
    if (!g[r]) continue;                         // the script only calls SpawnResources for the listed ones
    out[r] = fix ? fix[r] || 0 : multimap ? g[r] : g[r] + (r === 'skulls' ? 0 : G.campaignAdd || 0);
  }
  return out;
}
const WORKERS = { Easy: [10, 11, 12, 13, 14], Medium: [13, 14, 15, 15, 15], Hard: [15, 15, 15, 15, 15] };
export function maxWorkers(cls, age) {
  const t = (AI && AI.difficulty && AI.difficulty.maxWorkersPerAge && AI.difficulty.maxWorkersPerAge[cls]) || WORKERS[cls] || WORKERS.Hard;
  return t[Math.max(1, Math.min(5, age)) - 1] || 15;
}
// pool units an attack goal adds to its squad: { min, max, bad } by class (the goals' Think)
const SQ = { Easy: { min: 1, max: 5, bad: 1 }, Medium: { min: 2, max: 12, bad: 1 }, Hard: { min: 3, max: 20, bad: 1 } };
const SQUAD = { suicide: SQ, pureviolence: SQ, stealth: SQ, siege: SQ, guerilla: SQ,
  blitz: { Easy: { min: 1, max: 2, bad: 1 }, Medium: { min: 2, max: 4, bad: 1 }, Hard: { min: 3, max: 6, bad: 1 } },
  quick: { Easy: { min: 1, max: 2, bad: 1 }, Medium: { min: 1, max: 2, bad: 1 }, Hard: { min: 1, max: 2, bad: 1 } },
  rider: { Easy: { min: 1, max: 5, bad: 1 }, Medium: { min: 2, max: 12, bad: 1 }, Hard: { min: 3, max: 20, bad: 1 } },
  singleplayer: { Easy: { min: 1, max: 4, bad: 1 }, Medium: { min: 1, max: 6, bad: 0.75 }, Hard: { min: 2, max: 8, bad: 0.5 } } };
export function squad(goal, cls) {
  const t = (AI && AI.difficulty && AI.difficulty.squad && AI.difficulty.squad[goal]) || SQUAD[goal] || SQUAD.suicide;
  return t[cls] || t.Hard || SQ.Hard;
}
export function squadTimeout(cls) { const t = (AI && AI.difficulty && AI.difficulty.squadTimeout) || { Easy: 500, Medium: 400, Hard: 300 }; return (t[cls] || 300) * TICK; }
export function kindergartenWait(cls) { const t = (AI && AI.difficulty && AI.difficulty.kindergartenWait) || { Easy: 500, Medium: 100, Hard: 10 }; return (t[cls] || 10) * TICK; }

// ---------------------------------------------------------------- behaviours (CM:285-552)
const B = (village, tactics, agg, walls, towers, close, risk, extra = {}) => ({ params: { village_level: village, tactics, aggressiveness: agg, riskiness: agg, upgrade_walls: walls,
  upgrade_towers: towers, close_start_location: close, attacks_risk_level: risk, guard_village: 1 }, paused: false, economyOff: false, brainWash: true, variants: 1, kindergarten: true, ...extra });
const BEHAVIOURS = {
  Dodo: B('D{n}', '{sub}', 100, 0, 1, 0, 1.0, { subStrategy: 'D{n}', variants: 4, personality: 'Dodo', valueTable: 'Dodo' }),
  Giraffe: B('G1', '{sub}', 50, 1, 1, 1, 1.0, { subStrategy: 'G{n}', variants: 4, personality: 'Giraffe', valueTable: 'Giraffe' }),
  Schnecke: B('S2', '{sub}', 10, 1, 1, 1, 1.3, { subStrategy: 'S{n}', variants: 4, personality: 'Schnecke', valueTable: 'Schnecke' }),
  Turtle: B('S2', '{sub}', 10, 1, 1, 1, 1.3, { subStrategy: 'S5', personality: 'Turtle', valueTable: 'Schnecke' }),
  FightOnly: B(null, 'D2', 100, 0, 0, 0, 1.0, { economyOff: true, brainWash: false, personality: 'Dodo', valueTable: 'Dodo' }),
  Mikrobe: { params: {}, paused: true, economyOff: false, brainWash: false, variants: 1, kindergarten: false, personality: 'Mikrobe', valueTable: null },
};
export function behaviour(name) {
  const j = AI && AI.behaviours && AI.behaviours[name];
  if (j) return j;
  if (BEHAVIOURS[name]) return BEHAVIOURS[name];
  // Singleplayer_L3_1 ... without ai.json: an attacking village on the Singleplayer tables
  return /^Singleplayer/.test(name) ? B('X1', 'X2', 100, 0, 1, 0, 1.0, { brainWash: true, personality: name, valueTable: 'Singleplayer', subStrategy: 'G1' }) : null;
}
export const behaviourNames = () => Object.keys((AI && AI.behaviours) || BEHAVIOURS);

// ---------------------------------------------------------------- conditions of table rows
// ctx: { tribe, letter, age, d, cls, multimap, levelName, player, tactic, harbour, watermap, warpgate, has(cls) }
const ATOM = [
  [/^m_bHarbour$/, (c) => !!c.harbour], [/^m_bWatermap$/, (c) => !!c.watermap], [/^m_bMapWarpgate$/, (c) => !!c.warpgate],
  [/^m_sDifficulty=="(\w+)"$/, (c, m) => c.cls === m[1]], [/^m_sDifficulty!="(\w+)"$/, (c, m) => c.cls !== m[1]],
  [/^m_iDifficulty(>=|>|<=|<|==)(\d+)$/, (c, m) => cmp(c.d, m[1], +m[2])],
  [/^!m_pxSensor\^\.GetWarpGate\(\)$/, (c) => !c.ownWarpgate], [/^has:(\w+)$/, (c, m) => !!(c.has && c.has(m[1]))], [/^!has:(\w+)$/, (c, m) => !(c.has && c.has(m[1]))],
];
const cmp = (a, op, b) => (op === '>=' ? a >= b : op === '>' ? a > b : op === '<=' ? a <= b : op === '<' ? a < b : a === b);
// raw script conditions the extractor could not turn into fields; unknown ones do not hold
export function when(list, ctx) {
  for (const w of list || []) {
    let ok = false, known = false;
    for (const [re, fn] of ATOM) { const m = re.exec(w); if (m) { known = true; ok = fn(ctx, m); break; } }
    if (!known || !ok) return false;
  }
  return true;
}
function fields(r, ctx) {
  if (r.tribe && r.tribe !== ctx.tribe) return false;
  if (r.behaviour && r.behaviour !== ctx.letter) return false;
  if (r.minAge && ctx.age < r.minAge) return false;
  if (r.age && ctx.age !== r.age) return false;
  if (r.multimap !== undefined && r.multimap !== !!ctx.multimap) return false;
  if (r.defenderGame !== undefined && r.defenderGame !== !!ctx.defenderGame) return false;
  if (r.defender !== undefined && r.defender !== !!ctx.defender) return false;
  if (r.level !== undefined && r.level !== ctx.levelName) return false;
  if (r.notLevel !== undefined && r.notLevel === ctx.levelName) return false;
  if (r.player !== undefined && r.player !== ctx.player) return false;
  if (r.tactic !== undefined && r.tactic !== ctx.tactic) return false;
  return true;
}
// a row holds when its own conditions hold and none of the earlier branches of its if-chains does (`not`)
export function matches(r, ctx) {
  if (!fields(r, ctx) || !when(r.when, ctx)) return false;
  for (const n of r.not || []) if (fields(n, ctx) && when(n.when, ctx)) return false;
  return true;
}

// ---------------------------------------------------------------- build orders (BV)
// legacy plans [building, minimum epoch, how many]: the build order without ai.json (and the export of the old AI)
export const PLANS = {
  Hu: [['hu_stone_cottage', 1, 2], ['hu_lumberjack_cottage', 1, 1], ['hu_stone_quarry', 1, 1], ['hu_arena', 1, 1], ['hu_small_animal_farm', 1, 1],
    ['hu_corn_field', 2, 2], ['hu_small_tower', 2, 1], ['hu_weapons_smith', 2, 1], ['hu_warehouse', 2, 1], ['hu_temple', 3, 1],
    ['hu_machine_maker', 3, 1], ['hu_arena', 3, 2], ['hu_tavern', 3, 1], ['hu_corn_field', 3, 3], ['hu_large_tower', 4, 1]],
  Aje: [['aje_rodeo', 1, 1], ['aje_small_farm', 1, 1], ['aje_temple', 2, 1], ['aje_small_tower', 2, 1],
    ['aje_slaughterhouse', 3, 2], ['aje_weapons_builder', 3, 1], ['aje_rodeo', 3, 2], ['aje_bazaar', 3, 1], ['aje_cook_house', 3, 1],
    ['aje_medium_tower', 4, 1], ['aje_small_farm', 4, 2]],
  Ninigi: [['ninigi_lumbermill', 1, 1], ['ninigi_stone_quarry', 1, 1], ['ninigi_hunting_lodge', 1, 1], ['ninigi_dojo', 1, 1],
    ['ninigi_small_tower', 1, 1], ['ninigi_engineer', 2, 1], ['ninigi_animal_farm', 2, 1], ['ninigi_temple', 2, 1], ['ninigi_paddy', 2, 2],
    ['ninigi_weapon_maker', 3, 1], ['ninigi_warehouse', 3, 1], ['ninigi_teahouse', 3, 1], ['ninigi_dojo', 3, 2], ['ninigi_bamboofarm', 4, 1]],
  SEAS: [['seas_barracks', 1, 1], ['seas_steelwork', 1, 1], ['seas_garage', 1, 1], ['seas_greenhouse', 2, 2],
    ['seas_turret_tower', 2, 1], ['seas_barracks', 2, 2], ['seas_greenhouse', 3, 3], ['seas_garage', 3, 2]],
};
function legacyOrders(tribe, age) {
  const out = [];
  for (let e = 1; e <= 5; e++) {
    for (const [name, min, n] of PLANS[tribe] || []) if (min === e && age >= e) out.push({ request: 'BLDG/' + name, objFlag: '', count: n, unique: true });
    if (e < 5 && age >= e) out.push({ request: 'age_' + (e + 1), objFlag: '', count: 1, unique: true });
  }
  return out;
}
// the build list for a tribe / behaviour letter in script order (UpdateBuildList, then CheckForFightUpgrades)
export function buildList(ctx) {
  if (!AI || !AI.buildOrders || !AI.buildOrders.some((r) => r.tribe === ctx.tribe)) return legacyOrders(ctx.tribe, ctx.age);
  const out = AI.buildOrders.filter((r) => matches(r, ctx));
  if (!(ctx.letter === 'G' && ctx.age < 4)) for (const r of AI.fightUpgrades || []) if (matches(r, ctx)) out.push(r);     // BV:1629
  return out;
}
export const heroRequests = (set) => ((AI && AI.heroRequests) || []).filter((r) => r.set === set);
export const housing = (tribe) => ((AI && AI.housing) || []).filter((r) => r.tribe === tribe);
export const counterShips = (ctx) => ((AI && AI.counterShips) || []).filter((r) => matches(r, ctx));

// ---------------------------------------------------------------- attack plans (DA:962-1530)
const P = (a) => a.split(' ');
const FALLBACK_PLANS = {      // skirmish rows / campaign rows by behaviour letter (the shipped tables, §5.1)
  Hu: { D: [P('pyramid violence suicide violence suicide'), P('blitz suicide violence suicide violence')], G: [P('none suicide violence suicide violence'), P('scout suicide violence suicide violence')], S: [P('none none none suicide violence'), P('scout none violence suicide violence')] },
  Aje: { D: [P('pyramid suicide violence suicide violence'), P('none suicide violence suicide violence')], G: [P('none suicide suicide violence violence'), P('none none none none none')], S: [P('none none none suicide violence'), P('scout none none suicide violence')] },
  Ninigi: { D: [P('pyramid stealth violence suicide violence'), P('blitz suicide stealth suicide violence')], G: [P('none stealth suicide suicide violence'), P('scout stealth suicide suicide violence')], S: [P('none none none suicide violence'), P('scout none violence suicide violence')] },
  SEAS: { D: [P('pyramid suicide violence suicide violence'), P('pyramid suicide violence suicide violence')], G: [P('none none violence suicide violence'), P('none suicide violence suicide violence')], S: [P('none none none suicide violence'), P('scout none violence suicide violence')] },
};
// -> { attacks: [5 entries by epoch], guerilla: % }
export function attackPlan(ctx) {
  const none = ['none', 'none', 'none', 'none', 'none'];
  if (AI && AI.attackPlans && AI.attackPlans.length) {
    for (const r of AI.attackPlans) {
      if (!matches(r, { ...ctx, defenderGame: false })) continue;
      // a list appended to the five defaults instead of replacing them (Aje Giraffe on campaign maps) stays "none"
      return { attacks: r.appended ? none.concat(r.attacks).slice(0, 5) : r.attacks.slice(0, 5), guerilla: r.guerilla || 0 };
    }
    return { attacks: none, guerilla: 0 };
  }
  if (ctx.letter === 'S' && ctx.tactic === 5) return { attacks: none, guerilla: 0 };
  if (ctx.letter === 'X') return { attacks: P(ctx.tactic === 1 ? 'scout scout scout scout scout' : 'suicide suicide suicide suicide suicide'), guerilla: 0 };
  const t = (FALLBACK_PLANS[ctx.tribe] || FALLBACK_PLANS.Hu)[ctx.letter] || FALLBACK_PLANS.Hu.G;
  return { attacks: t[ctx.multimap ? 0 : 1], guerilla: 0 };
}

// ---------------------------------------------------------------- armies, unit mix, levels
// army table of a tribe: 'Dodo' | 'Giraffe' | 'Schnecke' | 'Singleplayer'; -> [{min, max, alternatives[{cls, level, objFlag}]}] | null
export function army(tribe, table, name) {
  const T = AI && AI.armies && AI.armies[tribe];
  if (!T) return null;
  const a = (T[table] && T[table][name]) || (T.Singleplayer && T.Singleplayer[name]) || (T.Dodo && T.Dodo[name]) || null;
  return a ? a.filter((e) => !e.group) : null;
}
export const hasArmies = (tribe) => !!(AI && AI.armies && AI.armies[tribe]);
// any tribe's table that knows the army (a campaign wave is named by the level designer, the tribe by the map)
export function armyAny(name) {
  for (const t in (AI && AI.armies) || {}) for (const k in AI.armies[t]) if (AI.armies[t][k][name]) return AI.armies[t][k][name].filter((e) => !e.group);
  return null;
}
// the standing army's composition for an epoch: { Level_n: [{weight, units[{cls, npc, objFlag}]}] } | null
// (the script always loads Units.txt, never the UnitsEasy / Medium / Hard files: MOD:96)
export function unitMix(tribe, age) {
  const T = AI && AI.unitMix && AI.unitMix[tribe];
  const m = T && (T.default || T[Object.keys(T)[0]]);
  return (m && m['Age_' + age]) || null;
}
// Kindergarten: may a unit of this class at this level (1-based) be levelled up? (KG:255)
export function mayLevel(cls, lv) {
  const c = AI && AI.levelCaps && AI.levelCaps[cls];
  if (!c) return lv < 3 ? true : lv === 3 ? Math.random() < 0.25 : false;      // typical fighter row
  const i = lv - 1;
  if (i < c.free) return true;
  return !!(c.last && c.last[0] === i && Math.random() * 100 < c.last[1]);
}
// level (1-based) of a unit spawned for a scripted wave (CH GetProperLevel); 0 = unknown class
export function spawnLevel(cls) { const v = AI && AI.spawnLevels && AI.spawnLevels[cls]; return v === undefined ? 0 : v + 1; }
export function objectData(cls) { return (AI && AI.objectData && AI.objectData[cls]) || null; }
export function outpost(type, tribe) { return (AI && AI.outposts && AI.outposts[type] && AI.outposts[type][tribe]) || null; }
