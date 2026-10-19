// The "ranged buffs" of units and buildings: what the original's scripts mark with FightingObj.AddRangedBuff (the
// attribute BuffDecals) - the icons of the info window (Info.usl CBuffIcon: up to five, by the order of
// Scripts/Server/init/buffdecals.txt, shown to their owner and, by the buff's visibility, to everybody, enemies or
// allies) and the decals on the ground under the units (the buff's tile of Texture/Effects/UnitDecals).
//
// The remake works them out from the state of the unit (systems/effects.js: auras, bonus buckets, timed states):
//   more_damage / less_damage      CalcAttackBoni above / below the weapon's damage (FO:7880)
//   more_defense / less_defense    the temporary defence boni (AddTemporaryDefenseBoni)
//   more_range / less_range        the range bucket
//   more_bldg_damage               the building damage bucket (Babbage's aura: Hero.usl:169)
//   is_poisoned, is_held, is_camouflaged, is_invisible, is_getting_healed (2.5 s after a heal: HealMe)
//   no_animal_aggro                Darwin's aura (FO:1828), drain_life: in Livingstone's (Hero.usl:173)
//   faster_buildup                 a worker building near Tesla (BuildUpBuilding.usl:425)
//   sq_tranquilized                the sequel's dart debuff (game/sequel/rules.js adds it to the table)
//   owner_<...>                    the source of an aura: the heroes with their aura on (Hero.usl:300-320), the
//                                  buildings and units of systems/effects.js AURAS
// Data: gamedata.json "buffs" (pipeline/build_data.py buff_table): [{attrib, tile, vis, icon, tip}] in file order.
import { active, attackBoni, tempDef, rangeBonus, AURAS } from './systems/effects.js';

const HERO_OWNER = { cole_s0: 'owner_cole', bela_s0: 'owner_bela', tesla_s0: 'owner_faster_buildup', darwin_s0: 'owner_no_animal_aggro',
  hermit_s0: 'owner_healing', lovelace_s0: 'owner_less_attack_speed', babbage_s0: 'owner_more_bldg_damage', stina_s0: 'owner_stina',
  schliemann_s0: 'owner_schliemann', livingstone_s0: 'owner_livingstone' };
// the aura sources of effects.js: what their owner buff is
const AURA_OWNER = { hu_warrior: 'owner_more_damage', aje_warrior: 'owner_less_damage', mayor_s0: 'owner_less_damage', hu_magic_cauldron: 'owner_more_damage',
  ninigi_cauldron: 'owner_fire_arrows', ninigi_smoke_tower: 'owner_invisibility_bldg',
  ninigi_smokebomb_thrower: 'owner_invisibility_nobldg', ninigi_parasaurolophus_drums: 'owner_more_damage', hu_scout: 'owner_more_damage', hu_rhino: 'owner_more_defense' };

// buildings that mark themselves while they stand (Building.usl: CTemple 2795, CHarbour 5175, CPoisonDung 4526,
// CQuicksand 4746, CSnareTrap 4964); the scarecrow and the skull protector have none (Building.usl:6112 is commented out)
const BLDG_OWNER = { CTemple: 'owner_healing_temple', CHarbour: 'owner_healing_harbour', CPoisonDung: 'owner_poison', CQuicksand: 'owner_hold_units', CSnareTrap: 'owner_hold_units' };
// camouflage layers that are the buff "is_camouflaged" (FO:1731/1738 ninja, FO:1878 Aje shaman, Entrench.usl:88) -
// not Livingstone's vanishing nor a hidden trap
const CAMO_BUFF = new Set(['entr', 'disg', 'aje']);
const on = (v) => v === true || v === 1 || v === '1' || v === 'true';

export function buffsOf(W, e) {
  const out = [];
  if (!e || !e.alive || !e.st) return out;
  const t = W.time, a = e.st.aura || {}, b = e.st.bonus || {};
  const k = String(W.data.kind(e.name) || e.name).toLowerCase();
  // the sources
  // a hero marks itself once one of its special abilities is switched on (Hero.usl:282-321: any "special_abilities"
  // change - RangeEffect, self_heal, ranged_heal ...; never taken away)
  if (e.kind === 'unit' && HERO_OWNER[k]) { const ab = e.stats.abilities || {}; if (Object.values(ab).some((x) => x && on(x.enabled))) out.push(HERO_OWNER[k]); }
  if (k === 'darwin_s0') out.push('no_animal_aggro');                  // (he gives it to himself at his start, Hero.usl:61)
  const A = AURAS[k];
  if (A && e.owner && A.when(e, W) && A.radius(e)) out.push(AURA_OWNER[k] || 'owner_more_damage');
  if (e.kind === 'building' && e.built && e.owner) { const sc = W.data.script ? W.data.script(e.name) : null; if (BLDG_OWNER[sc]) out.push(BLDG_OWNER[sc]); }
  // what acts on it
  const w = e.weapon || (e.weapons && e.weapons.long);
  const cs = w && e.cs ? e.cs(w) : null;
  if (cs && cs.dmg > 0) { const d = attackBoni(e, cs.dmg, w); if (d > cs.dmg + 1e-6) out.push('more_damage'); else if (d < cs.dmg - 1e-6) out.push('less_damage'); }
  const def = tempDef(e, 0);                    // (standing on a wall gives no buff: AddTemporaryRangedDefenseBoni, FO:7952)
  if (def > 0) out.push('more_defense'); else if (def < 0) out.push('less_defense');
  if (a.slowhand && a.slowhand > 1) out.push('less_attack_speed');      // Ada's aura (EFFECT_ADA_SLOWHAND, FO:1826)
  const rg = rangeBonus(e);
  if (rg > 0) out.push('more_range'); else if (rg < 0) out.push('less_range');
  if (b.BLDGDAMAGE > 0) out.push('more_bldg_damage');
  if (a.noAnimalAggro) out.push('no_animal_aggro');
  if (a.drainBy && a.drainBy.length) out.push('drain_life');
  if (e.st.poison || e.st.poison2) out.push('is_poisoned');
  if (active(e, 'trapped', t)) out.push('is_held');
  if (e.st.camo && [...e.st.camo].some((l) => CAMO_BUFF.has(l))) out.push('is_camouflaged');
  if (a.invisible) out.push('is_invisible');
  if (e.healedT != null && t - e.healedT < 2.5) out.push('is_getting_healed');
  if (e.fasterBuild) out.push('faster_buildup');
  if (e.sqTranq > t) out.push('sq_tranquilized');                   // the sequel's tranquilizer darts (sequel/runtime.js)
  return out;
}

// the buffs of the table in its order that a viewer sees on e (Info.usl: own objects all of them; else by the
// buff's visibility 1 all, 2 enemies, 3 allies)
export function visibleBuffs(W, e, viewer) {
  const table = W.data.extra.buffs || [];
  const have = new Set(buffsOf(W, e));
  const own = e.owner === viewer;
  const rel = e.owner && viewer && !own ? viewer.relation(e.owner) : -1;
  return table.filter((x) => have.has(x.attrib) && (own || x.vis === 1 || (x.vis === 2 && rel === 0) || (x.vis === 3 && rel === 2)));
}
