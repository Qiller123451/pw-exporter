// Status effects, auras and timed states of units and buildings.
//
// The original keeps these in several places (FightingObj.usl): ref-counted "effect flags" (warcry, warpaint,
// trumpet ...), flat "bonus buckets" (DAMAGE, DEFENSE, RANGEDDEFENSE, RANGE, BLDGDAMAGE), timers (trapped,
// invulnerable, animal immunity) and camouflage layers. Here every entity has one `st` object:
//
//   e.st.t[name]      game time until which a timed state lasts (trapped, invul, iced, trumpet, paw, doping, ...)
//   e.st.aura         aura values recomputed every AURA_TICK seconds from all aura sources (warcry tier, ...)
//   e.st.bonus        flat bonus buckets filled by auras
//   e.st.camo         Set of camouflage layers: 'entr' (entrenched), 'disg' (ninja), 'aje' (shaman), 'hero' (vanish)
//   e.st.poison       active poison slots (see combat.js)
//
// Aura sources are listed in AURAS below - add a row to give a unit or building a new aura.
import { RES } from '../rules.js';

export const AURA_TICK = 1.0;

export function newStatus() {
  return { t: {}, aura: {}, bonus: { DAMAGE: 0, DEFENSE: 0, RANGEDDEFENSE: 0, RANGE: 0, BLDGDAMAGE: 0 }, camo: new Set(), poison: null, poison2: null, revealT: -99 };
}
// is a timed state active?
export const active = (e, key, time) => !!e.st && (e.st.t[key] || 0) > time;

// CalcAttackBoni (FO:7812): multipliers first, then the flat DAMAGE bucket
export function attackBoni(e, d) {
  const a = e.st ? e.st.aura : {};
  const t = e.world ? e.world.time : 0;
  if (active(e, 'trumpet', t)) d *= 0.8;
  if (active(e, 'paw', t)) d *= 0.8;
  if (a.warcry) d *= [1, 1, 1, 1.1, 1.15, 1.2][a.warcry];
  if (a.warpaint) d *= [1, 1, 1, 0.9, 0.85, 0.8][a.warpaint];
  if (a.drums) d *= 1.2;
  if (a.ninigiCauldron) d *= 1.25;
  if (a.boarRage) d *= 1.5;
  return d + (e.st ? e.st.bonus.DAMAGE : 0);
}
// AddTemporaryDefenseBoni (FO:7894) / ranged (FO:7952)
export const tempDef = (e, p) => p + (e.st && e.st.aura.pennant && e.def && e.def.tribe !== 'Aje' ? 20 : 0) + (e.st ? e.st.bonus.DEFENSE : 0);
export const tempRangedDef = (e, p) => p + (e.st ? e.st.bonus.RANGEDDEFENSE : 0);
export const rangeBonus = (e) => (e.st ? e.st.bonus.RANGE : 0);

// ------------------------------------------------------------------------------------------------ aura table
// who:   'friend' | 'enemy'       units of the source owner's team, or its enemies (wild animals count as enemies)
// when:  (src, world) -> bool     source condition (invention, level, finished building ...)
// match: (unit) -> bool           optional target filter
// bldg:  true                     the aura also affects buildings
// apply: (unit, src) -> void      writes into unit.st.aura / unit.st.bonus
const inv = (src, w, name) => !!src.owner && w.data.invented(src.owner, name, src.owner.tribe, src);
const built = (src) => src.kind !== 'building' || src.built;
const lvl = (src, n) => (src.level || 1) >= n;
const isUnit = (u) => u.kind === 'unit';
const ARCHERS = new Set(['ninigi_archer', 'ninigi_marksman', 'aje_archer', 'hu_archer', 'hu_marksman', 'Bela_s0']);
const COLE = new Set(['hu_worker', 'hu_warrior', 'hu_jetpack_warrior', 'hu_berserker', 'hu_killer', 'aje_worker', 'aje_warrior', 'aje_rammer', 'ninigi_worker', 'ninigi_warrior', 'ninigi_ninja', 'ninigi_sumo']);
const SPEARS = new Set(['hu_spearman', 'hu_pikeman', 'aje_spearman', 'ninigi_spearman', 'ninigi_icespearman']);
const BELA = new Set(['hu_archer', 'hu_marksman', 'aje_archer', 'aje_thrower', 'ninigi_ninja', 'ninigi_archer', 'ninigi_marksman', 'seas_marksman', 'seas_gunner', 'ninigi_mortar', 'hu_killer']);
export const AURAS = {
  // warcry (character.usl:769): friends get damage x1.10 / x1.15 / x1.20 by the warrior's level 3/4/5
  hu_warrior: { who: 'friend', radius: (s) => [0, 0, 0, 10, 15, 20][s.level], when: (s, w) => lvl(s, 3) && inv(s, w, 'warcry'), match: (u) => u.kind === 'unit', apply: (u, s) => { u.st.aura.warcry = Math.max(u.st.aura.warcry || 0, s.level); } },
  // warpaint: enemies deal x0.90 / x0.85 / x0.80
  aje_warrior: { who: 'enemy', radius: (s) => [0, 0, 0, 10, 15, 20][s.level], when: (s, w) => lvl(s, 3) && inv(s, w, 'warpaint'), match: isUnit, apply: (u, s) => { u.st.aura.warpaint = Math.max(u.st.aura.warpaint || 0, s.level); } },
  mayor_s0: { who: 'enemy', radius: () => 20, when: (s) => lvl(s, 2), match: isUnit, apply: (u) => { u.st.aura.warpaint = 5; } },
  // buildings (Building.usl region buildings)
  hu_magic_cauldron: { who: 'friend', radius: () => 30, when: built, match: isUnit, apply: (u) => { u.st.bonus.DAMAGE += 0.1 * baseDmg(u); } },
  aje_scarecrow: { who: 'enemy', radius: () => 50, when: built, match: (u) => u.cls === 'ANML', apply: (u) => { u.st.bonus.DAMAGE -= 0.2 * baseDmg(u); } },
  ninigi_cauldron: { who: 'friend', radius: () => 35, when: built, match: (u) => ARCHERS.has(u.name), apply: (u) => { u.st.aura.ninigiCauldron = true; } },
  aje_skull_protector: { who: 'friend', bldg: true, radius: () => 30, when: built, match: (u) => u.name !== 'aje_skull_protector', apply: (u) => { u.st.aura.skullProtect = true; } },
  ninigi_smoke_tower: { who: 'friend', bldg: true, radius: () => 35, when: built, match: (u) => u.kind === 'building' && u.name !== 'ninigi_smoke_tower', apply: (u) => { u.st.aura.invisible = true; } },
  ninigi_smokebomb_thrower: { who: 'friend', radius: () => 15, when: () => true, match: isUnit, apply: (u) => { u.st.aura.invisible = true; } },
  ninigi_parasaurolophus_drums: { who: 'friend', radius: () => 50, when: () => true, match: (u) => isUnit(u) && !u.isWorker, apply: (u) => { u.st.aura.drums = true; } },
  hu_scout: { who: 'friend', radius: () => 20, when: (s, w) => inv(s, w, 'drums'), match: (u) => isUnit(u) && !u.isWorker, apply: (u) => { u.st.aura.drums = true; } },
  hu_rhino: { who: 'friend', radius: () => 20, when: (s, w) => inv(s, w, 'pennant'), match: isUnit, apply: (u) => { u.st.aura.pennant = true; } },
  // hero auras from level 2 (Hero.usl RangeEffect)
  Cole_s0: { who: 'friend', radius: () => 20, when: (s) => lvl(s, 2), match: (u) => COLE.has(u.name), apply: (u) => { u.st.bonus.DAMAGE += 5; } },
  Stina_s0: { who: 'friend', radius: () => 20, when: (s) => lvl(s, 2), match: (u) => SPEARS.has(u.name), apply: (u) => { u.st.bonus.DEFENSE += 20; u.st.bonus.RANGEDDEFENSE += 20; } },
  special_eusmilus: { who: 'friend', radius: () => 20, when: (s) => lvl(s, 2), match: (u) => SPEARS.has(u.name), apply: (u) => { u.st.bonus.DEFENSE += 20; u.st.bonus.RANGEDDEFENSE += 20; } },
  Bela_s0: { who: 'friend', radius: () => 25, when: (s) => lvl(s, 2), match: (u) => BELA.has(u.name), apply: (u) => { u.st.bonus.RANGE += 5; } },
  babbage_s0: { who: 'friend', radius: () => 20, when: (s) => lvl(s, 2), match: isUnit, apply: (u) => { u.st.bonus.BLDGDAMAGE += 20; } },
  lovelace_s0: { who: 'enemy', radius: () => 20, when: (s) => lvl(s, 2), match: isUnit, apply: (u) => { u.st.aura.slowhand = true; } },
  schliemann_s0: { who: 'enemy', radius: () => 20, when: (s) => lvl(s, 2), match: isUnit, apply: (u) => { u.st.aura.kleemann = true; } },
  darwin_s0: { who: 'friend', radius: () => 20, when: (s) => lvl(s, 2), match: isUnit, apply: (u) => { u.st.aura.noAnimalAggro = true; } },
  livingstone_s0: { who: 'enemy', radius: () => 20, when: (s, w) => lvl(s, 2) && !active(s, 'vanish', w.time), match: (u) => isUnit(u), apply: (u, s) => { (u.st.aura.drainBy || (u.st.aura.drainBy = [])).push(s); } },
};
function baseDmg(u) { const cs = u.cs && u.cs(); return cs ? cs.dmg : 0; }

// ------------------------------------------------------------------------------------------------ world mixin
export const Effects = {
  // every AURA_TICK: rebuild all auras from their sources; apply periodic effects (hero drain, building heal)
  auraUpdate() {
    const all = [...this.units, ...this.buildings];
    for (const e of all) if (e.st) { e.st.aura = {}; const b = e.st.bonus; b.DAMAGE = 0; b.DEFENSE = 0; b.RANGEDDEFENSE = 0; b.RANGE = 0; b.BLDGDAMAGE = 0; }
    for (const s of all) {
      if (!s.alive || !s.owner) continue;
      const A = AURAS[s.name];
      if (!A || !A.when(s, this)) continue;
      const r = A.radius(s);
      if (!r) continue;
      const visit = (u) => {
        if (!u.alive || u === s || !u.st) return;
        const friend = u.owner && s.owner.isFriend(u.owner);
        if (u.owner && s.owner.isNeutral(u.owner)) return;       // auras help friends and harm enemies, not neutral players
        if ((A.who === 'friend') !== !!friend) return;
        if (A.match && !A.match(u)) return;
        if (Math.hypot(u.pos.x - s.pos.x, u.pos.z - s.pos.z) - (u.radius || 0) > r) return;
        A.apply(u, s);
      };
      this.uHash.query(s.pos.x, s.pos.z, r + 8, visit);
      if (A.bldg) this.bHash.query(s.pos.x, s.pos.z, r + 20, visit);     // aura also affects buildings
    }
    // wild boar rage (FightingObj.usl:5488): a boar at <= 25% hit points deals x1.5 damage once "wild_boar_rage" is invented
    for (const u of this.units) if (u.alive && u.name === 'hu_wild_boar' && u.owner && this.data.invented(u.owner, 'wild_boar_rage', u.owner.tribe) && u.hp * 4 <= u.maxHp) u.st.aura.boarRage = true;
  },
  // timed effects: poison ticks, hero damage-over-time, self heal (1 s), passive regeneration abilities
  effectsTick(dt) {
    this.auraT = (this.auraT || 0) - dt;
    if (this.auraT <= 0) { this.auraT = AURA_TICK; this.auraUpdate(); this.periodic(AURA_TICK); }
  },
  periodic(dt) {
    const t = this.time;
    for (const u of this.units) {
      if (!u.alive) continue;
      // Livingstone: every 3 s enemies in his aura take ~10 damage, he heals 25 % of it (drain_life)
      const drain = u.st.aura.drainBy;
      if (drain && Math.floor(t / 3) !== Math.floor((t - dt) / 3)) for (const s of drain) if (s.alive) { this.applyDamage(u, 10, s); s.hp = Math.min(s.maxHp, s.hp + 2.5); }
      // self_heal ability: HealMe(amount) every second (FightingObj.usl:8208)
      const sh = u.stats.abilities && u.stats.abilities.self_heal;
      if (sh && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + (sh.amount || 0) * dt);
    }
    this.buildingHeal(dt);
  },
  // is e hidden from player p? (smoke tower / smoke bomb invisibility, camouflage, entrenchment)
  hiddenFrom(e, p) {
    if (!e.st || !p || (e.owner && p.isFriend(e.owner))) return false;
    if (this.time < e.st.revealT) return false;
    if (e.st.aura.invisible || e.st.camo.size) return true;
    return false;
  },
};
export { RES };
