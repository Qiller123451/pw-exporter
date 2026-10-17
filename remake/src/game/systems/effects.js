// Status effects, auras and timed states of units and buildings.
//
// The original keeps these in several places (FightingObj.usl): ref-counted "effect flags" (warcry, warpaint,
// trumpet ...), flat "bonus buckets" (DAMAGE, DEFENSE, RANGEDDEFENSE, RANGE, BLDGDAMAGE), timers (trapped,
// invulnerable, animal immunity) and camouflage layers. Here every entity has one `st` object:
//
//   e.st.t[name]      game time until which a timed state lasts (trapped, invul, iced, trumpet, paw, doping, ...)
//   e.st.aura         aura values recomputed every AURA_TICK seconds from all aura sources (warcry tier, ...)
//   e.st.bonus        flat bonus buckets filled by auras (DAMAGE, MELEEDAMAGE, RANGEDAMAGE, DEFENSE, RANGEDDEFENSE,
//                     RANGE, BLDGDAMAGE)
//   e.st.camo         Set of camouflage layers: 'entr' (entrenched), 'disg' (ninja), 'aje' (shaman), 'hero' (vanish)
//   e.st.poison       active poison slots (see combat.js)
//
// Aura sources are listed in AURAS below - add a row to give a unit or building a new aura. The heroes' auras come
// from the data (hero auras, heroEffect): their RangeEffect ability and filter, so a mod's (MIRAGE's) heroes do what they do there.
// A copy of a class (the sequel's: Rules.kind) has its original's aura.
import { RES } from '../rules.js';
import { modsOf } from '../techtree.js';

export const AURA_TICK = 1.0;
const BOAR_RAGE_FILTER = 'Hu/Upgrades/xenage/wild_boar_rage';

export function newStatus() {
  return { t: {}, aura: {}, bonus: { DAMAGE: 0, MELEEDAMAGE: 0, RANGEDAMAGE: 0, DEFENSE: 0, RANGEDDEFENSE: 0, RANGE: 0, BLDGDAMAGE: 0 }, camo: new Set(), poison: null, poison2: null, revealT: -99 };
}
// is a timed state active?
export const active = (e, key, time) => !!e.st && (e.st.t[key] || 0) > time;

// CalcAttackBoni (FO:7812): multipliers first, then the flat DAMAGE bucket; MIRAGE also has buckets for melee and
// ranged weapons only (CalcMeleeAttackBoni / CalcRangeAttackBoni)
export function attackBoni(e, d, w = null) {
  const a = e.st ? e.st.aura : {};
  const t = e.world ? e.world.time : 0;
  if (active(e, 'trumpet', t)) d *= 0.8;
  if (active(e, 'paw', t)) d *= 0.8;
  if (a.warcry) d *= [1, 1, 1, 1.1, 1.15, 1.2][a.warcry];
  if (a.warpaint) d *= [1, 1, 1, 0.9, 0.85, 0.8][a.warpaint];
  if (a.drums) d *= 1.2;
  if (a.ninigiCauldron) d *= 1.25;
  if (a.boarRage) d *= 1.5;
  if (active(e, 'cyborg', t)) d *= 1.5;              // MIRAGE cyborg roar (SetCyborgEffect, FO:10054)
  if (!e.st) return d;
  const b = e.st.bonus;
  return d + b.DAMAGE + (w ? (w.projectile ? b.RANGEDAMAGE : b.MELEEDAMAGE) || 0 : 0);
}
// AddTemporaryDefenseBoni (FO:7894) / ranged (FO:7952)
export const tempDef = (e, p) => p + (e.st && e.st.aura.pennant && e.def && e.def.tribe !== 'Aje' ? 20 : 0) + (e.st ? e.st.bonus.DEFENSE : 0);
// (+ Defence_On_Wall for a unit on a wall's walkway: systems/wallwalk.js setOnWall, FO:7959)
export const tempRangedDef = (e, p) => p + (e.st ? e.st.bonus.RANGEDDEFENSE : 0) + (e.onWall ? e.wallDef || 0 : 0);
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
};

// ------------------------------------------------------------------------------------------------ hero auras
// A hero's aura (Hero.usl RangeEffect): its ability RangeEffect (switched on by its level-2 filter; radius, OnEnemy)
// says how far and on whom, its filter Filters/Special/Upgrades/<hero>/RangeEffect what it does to every unit in it -
// read here from the data (heroEffect), so the official game's and a mod's heroes each do what they do there:
//   /Objects/<tribe>/<type>/<class>/<x>_bonus = v   that class gets v in a bonus bucket (FightingObj OnTechTreeChange:
//                                                  bldgdamage, rangedamage, meleedamage, damage, rangeddefense,
//                                                  defense, range - checked in this order); one entry per name
//   /Modifications/<tribe>/<type>/WeaponDuration   units of that tribe and type attack that much slower (Ada)
//   /Modifications/<tribe>/<type>/Skulls           they are worth that many more skulls (Schliemann)
//   /Objects/<tribe>/InventObjects/damage_babbage_bonus   Babbit: BUILDING_DAMAGE_BONUS % more against buildings
// Scripted ones by class: Darwin (wild animals leave his people alone), Livingstone (drains life, not while vanished).
const BUCKETS = [['bldgdamage', 'BLDGDAMAGE'], ['rangedamage', 'RANGEDAMAGE'], ['meleedamage', 'MELEEDAMAGE'], ['damage', 'DAMAGE'],
  ['rangeddefense', 'RANGEDDEFENSE'], ['defense', 'DEFENSE'], ['range', 'RANGE']];
export function heroEffect(data, name) {
  const cache = data._heroFx || (data._heroFx = new Map());
  if (cache.has(name)) return cache.get(name);
  const f = data.base.filter(`Special/Upgrades/${name}/RangeEffect`) || data.base.filter(`Special/Upgrades/${data.kind(name)}/RangeEffect`);
  const fx = { bonus: new Map(), dur: new Map(), skulls: new Map(), invent: new Set() };
  for (const m of modsOf(f)) {
    const p = m.path.split('/').filter(Boolean), v = parseFloat(m.value);
    if (p[0] === 'Objects' && p[2] === 'InventObjects') fx.invent.add(p[1] + '/' + p[3]);
    else if (p[0] === 'Objects' && p.length === 5 && /_bonus$/.test(p[4])) {
      const key = p[4].replace('_bonus', ''), b = BUCKETS.find(([k]) => key.includes(k));
      if (b && v > 0) { if (!fx.bonus.has(p[3])) fx.bonus.set(p[3], []); fx.bonus.get(p[3]).push([b[1], key, v]); }
    } else if (p[0] === 'Modifications' && p[3] === 'WeaponDuration') fx.dur.set(p[1] + '/' + p[2], Math.max(fx.dur.get(p[1] + '/' + p[2]) || 1, v));
    else if (p[0] === 'Modifications' && p[3] === 'Skulls') fx.skulls.set(p[1] + '/' + p[2], Math.max(fx.skulls.get(p[1] + '/' + p[2]) || 1, v));
  }
  cache.set(name, fx);
  return fx;
}
const truthy = (v) => v === true || v === 1 || v === 'true' || v === '1';
function applyHero(W, fx, k, s, u) {
  const tribe = (u.owner && u.owner.tribe) || (u.def && u.def.tribe), a = u.st.aura;       // (the player's tribe's modifications)
  for (const cls of [u.name, W.data.kind(u.name)]) for (const [b, key, v] of fx.bonus.get(cls) || []) (a.bon || (a.bon = {}))[key] = [b, v];
  const t = tribe + '/' + u.cls;
  if (fx.dur.has(t)) a.slowhand = Math.max(a.slowhand || 1, fx.dur.get(t));
  if (fx.skulls.has(t)) a.kleemann = Math.max(a.kleemann || 1, fx.skulls.get(t));
  if (fx.invent.has(tribe + '/damage_babbage_bonus')) (a.bon || (a.bon = {})).babbage = ['BLDGDAMAGE', (W.data.extra.hero_consts || {}).BUILDING_DAMAGE_BONUS ?? 20];
  if (k === 'darwin_s0') a.noAnimalAggro = true;
  if (k === 'livingstone_s0') (a.drainBy || (a.drainBy = [])).push(s);
}
function baseDmg(u) { const cs = u.cs && u.cs(); return cs ? cs.dmg : 0; }

// ------------------------------------------------------------------------------------------------ world mixin
export const Effects = {
  heroEffect(name) { return heroEffect(this.data, name); },
  // every AURA_TICK: rebuild all auras from their sources; apply periodic effects (hero drain, building heal)
  auraUpdate() {
    const all = [...this.units, ...this.buildings];
    for (const e of all) if (e.st) { e.st.aura = {}; const b = e.st.bonus; for (const k in b) b[k] = 0; }
    for (const s of all) {
      if (!s.alive || !s.owner) continue;
      const A = AURAS[this.data.kind(s.name)];
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
    // the heroes' auras (heroEffect above)
    for (const s of this.units) {
      const ab = s.alive && s.owner && s.stats.abilities && s.stats.abilities.RangeEffect;
      if (!ab || !truthy(ab.enabled)) continue;
      const k = this.data.kind(s.name);
      if (k === 'livingstone_s0' && active(s, 'vanish', this.time)) continue;
      const fx = heroEffect(this.data, s.name), r = ab.radius || 20, onEnemy = truthy(ab.OnEnemy);
      this.uHash.query(s.pos.x, s.pos.z, r + 8, (u) => {
        if (!u.alive || u === s || !u.st || u.kind !== 'unit') return;
        if (u.owner && s.owner.isNeutral(u.owner)) return;
        if (onEnemy === !!(u.owner && s.owner.isFriend(u.owner))) return;
        // wild animals count as enemies only when aggressive (Hero.usl OnObjEnterRangedEffect; Schliemann: all of them)
        if (!u.owner && onEnemy && k !== 'schliemann_s0' && !(u.def && u.def.aggressive === 1)) return;
        if (Math.hypot(u.pos.x - s.pos.x, u.pos.z - s.pos.z) - (u.radius || 0) > r) return;
        applyHero(this, fx, k, s, u);
      });
    }
    // the bonus entries into the buckets (one entry per name: two Coles do not add up)
    for (const e of all) if (e.st && e.st.aura.bon) for (const [b, v] of Object.values(e.st.aura.bon)) e.st.bonus[b] += v;
    // wild boar rage (FightingObj.usl:5488): a boar at <= 25% hit points deals x1.5 damage once "wild_boar_rage" is
    // invented. MIRAGE (FO:7387 DoHPRelatedStuff) switches its own filter on at <= 3/7 of the hit points instead.
    const modRage = this.data.base.filter(BOAR_RAGE_FILTER);
    for (const u of this.units) {
      if (!u.alive || u.name !== 'hu_wild_boar' || !u.owner || !this.data.invented(u.owner, 'wild_boar_rage', u.owner.tribe)) continue;
      if (!modRage) { if (u.hp * 4 <= u.maxHp) u.st.aura.boarRage = true; continue; }
      const on = u.hp * 7 / 3 <= u.maxHp;
      if (on !== !!(u.localTT && u.localTT.has(BOAR_RAGE_FILTER))) this.localFilter(u, BOAR_RAGE_FILTER, on);
    }
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
      // Livingstone: every LIVINGSTONE_TICK_TIME s enemies in his aura take LIVINGSTONE_TICK_DAMAGE, he heals 25 % of it
      const drain = u.st.aura.drainBy;
      const HC = this.data.extra.hero_consts || {}, tick = HC.LIVINGSTONE_TICK_TIME || 3, dmg = HC.LIVINGSTONE_TICK_DAMAGE || 10;
      // (Hero.usl DoLivingstoneDamage: TakeDmg(this, TICK_DAMAGE / GetDmg()) - his attack bonuses and the victim's
      // armour apply; only enemies his owner sees)
      if (drain && Math.floor(t / tick) !== Math.floor((t - dt) / tick)) for (const s of drain) {
        if (!s.alive || (s.owner && (this.hiddenFrom(u, s.owner) || (s.owner.id === 0 && this.fow && !this.fow.visible(u.pos.x, u.pos.z))))) continue;
        const bd = baseDmg(s), got = bd > 0 ? this.takeDmg(s, u, dmg / bd) : (this.applyDamage(u, dmg, s), dmg);
        s.hp = Math.min(s.maxHp, s.hp + got * 0.25);
      }
      // self_heal ability: HealMe(amount) every second (FightingObj.usl:8208)
      const sh = u.stats.abilities && u.stats.abilities.self_heal;
      if (sh && u.hp < u.maxHp && !active(u, 'noHeal', t)) {
        u.hp = Math.min(u.maxHp, u.hp + (sh.amount || 0) * dt);
        u.healedT = t;
        if (Math.floor(t) !== Math.floor(t - dt)) this.emit('healfx', { to: u });      // (HealMe: the unit glows)
      }
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
