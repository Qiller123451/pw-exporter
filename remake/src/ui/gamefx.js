// The original game's own effects for world events: projectile and melee hits, deaths, spawns, level-ups,
// building placement / completion / damage, inventions, poison and ice, felled trees - and the effects of the
// MIRAGE moves (game/systems/moves_mirage.js). They are effect models (engine/modelfx.js) chosen the way the
// original client scripts choose them.
//
// Reference: docs/GAME_EFFECTS.md, from Data/Base/Scripts/Game/misc/Effects.usl (E), Game.usl (G) and the server's
// FightingObj.usl. The particle database (sequencer/particles.txt) is only for mission scripts (campaign/engine.js).
import * as THREE from 'three';

// map setting -> the key in the effect names (E:49-62; anything else is Savanna)
const LAND = { Northland: 'nor', Savanna: 'sav', Jungle: 'jng', Icewaste: 'ice', Ashvalley: 'ash' };
// EvaluateProjectile (E:164-274): the first prefix of the projectile's model name that matches gives the hit type
const PROJ_TYPE = [
  ['ninigi_muraeno_submarine_arrow', 'sharp_med'], ['tesla_revolvercrossbow_arrow', 'sharp_sml'], ['tesla_crazy_machine_arrow', 'explo_sml'],
  ['ninigi_rocket_boat_arrow', 'explo_big'], ['seas_wehrspinne_bullet', 'explo_big'], ['ninigi_shuriken_arrow', 'sharp_sml'],
  ['ninigi_spear_b_arrow', 'sharp_med'], ['ninigi_spear_c_arrow', 'sharp_med'], ['ninigi_spear_d_arrow', 'sharp_med'], ['ninigi_spear_e_arrow', 'sharp_med'],
  ['babbage_pistol_arrow', 'sharp_sml'], ['seas_carrier_bullet', 'sharp_med'], ['ninigi_mortar_arrow', 'explo_sml'], ['hu_slingshot_stone', 'blunt_sml'],
  ['druid_staff_arrow', 'sharp_med'], ['aje_spear_a_arrow', 'sharp_med'], ['aje_spear_b_arrow', 'sharp_med'], ['aje_spear_c_arrow', 'sharp_med'],
  ['aje_spear_d_arrow', 'sharp_med'], ['aje_spear_e_arrow', 'sharp_med'], ['hu_spear_b_arrow', 'sharp_med'], ['hu_spear_c_arrow', 'sharp_med'],
  ['hu_spear_d_arrow', 'sharp_med'], ['hu_spear_e_arrow', 'sharp_med'], ['hu_cannonball', 'blunt_big'], ['ninigi_bullet', 'gatling'],
  ['ninigi_arrow', 'sharp_sml'], ['aje_molotov', 'poison_med'], ['seas_rocket', 'explo_med'], ['hu_arrow', 'sharp_sml'], ['hu_bolt', 'sharp_sml'],
  ['seas_hq_big_cannon_projectile', 'big_bertha'], ['schliemann_flintlock_arrow', 'sharp_sml'], ['bela_knickknackbow_arrow', 'sharp_sml'],
  ['ninigi_icespear_c_arrow', 'sharp_med'], ['ninigi_icespear_d_arrow', 'sharp_med'], ['ninigi_icespear_e_arrow', 'sharp_med'],
  ['aje_ammo_dilo_spittle', 'poison_sml'], ['lovelace_musket_arrow', 'sharp_sml'], ['hu_dragon_boat_arrow', 'sharp_big'],
  ['ninigi_gatling_arrow', 'gatling'], ['ninigi_rb_projektil', 'explo_big'], ['ninigi_small_rocket', 'explo_med'], ['seas_turret_bullet', 'gatling'],
  ['hu_ballista_arrow', 'sharp_big'], ['ninigi_cannonball', 'explo_big'], ['aje_ammo_stone', 'poison_big'], ['aje_ammo_dino', 'blunt_sml'],
  ['ninigi_rocket', 'explo_big'], ['seas_torpedo', 'explo_big'], ['seas_bullet', 'sharp_sml'], ['aje_arrow', 'sharp_sml'], ['hu_trunk', 'blunt_big'],
];
export function projectileType(gfx) {
  const n = String(gfx || '').toLowerCase();
  for (const [p, t] of PROJ_TYPE) if (n.startsWith(p)) return t;
  return 'blunt_sml';
}
const TRIBES = new Set(['hu', 'aje', 'ninigi', 'seas']);
// camera shakes (Effects.usl ShakeCameraTheGundlachStyle calls): [duration s, strength, fade-out %, range m]
export const SHAKES = {
  CPlaceBuildingFX: [1.0, 5, 100, 60],        // a building placed (Building.usl:174 -> Game.usl:972); the mammoth's stomp
  CBrachioDying: [1.0, 40, 75, 60],          // the brachiosaurus falls (dying, frame 58)
  CBrachioWalking: [0.5, 5, 75, 30],         // its footfalls (walk_1 / walk_2 / walk_left / walk_right)
  CVehicleExplosion: [0.5, 5, 100, 60],      // the torpedo turtle explodes (Ship.usl:1540)
  CDestructionHit: [0.5, 5, 100, 30],        // an object drops below 50 % and 25 % (FightingObj.usl:3054)
  CCamShakeHarvestTrees: [1.0, 5, 100, 20],  // a felled tree hits the ground
  CBigBuildingExplosion: [1.0, 40, 75, 60],
};
// the effect models used here (main.js loads them with the map)
export const GAME_FX_MODEL = /^(hit_|fx_impact_|spawnping_|readyping_|placeping_|deathping_animal_|levelup_char_fx$|leave_blast$|vehicle_explosion$|explo_logcannon_building$|fx_poison|fx_ice_freeze$|hu_wallstones$)/;
const CASTE_SPAWN = { res: 'spawnping_char_res_fx', nat: 'spawnping_char_nat_fx', tec: 'spawnping_char_tec_fx' };

export class GameFx {
  constructor(G, mfx) {
    this.G = G;
    this.m = mfx;
    this.statusT = 0;
  }
  get W() { return this.G.world; }
  land() { return LAND[this.W.setting] || 'sav'; }
  tribeOf(e) { const t = String((e.def && e.def.tribe) || (e.owner && e.owner.tribe) || '').toLowerCase(); return TRIBES.has(t) ? t : ''; }
  // OnProjectileImpact (E:27-162): "hit_" + where + [tribe_] + type at the projectile, 4 s; a flash on units
  impactName(gfx, target, pos) {
    const type = projectileType(gfx), gat = type === 'gatling';
    if (!target) {
      const water = !gat && this.W.waterLevel != null && this.W.height(pos.x, pos.z) < this.W.waterLevel;
      return { names: [water ? `hit_water_${type}` : `hit_land_${this.land()}_${type}`, `hit_land_ash_${type}`, 'hit_water_blunt_big'], flash: false };
    }
    const c = target.cls;
    if (c === 'CHTR' || c === 'ANML') {
      const t = c === 'CHTR' && !gat && type !== 'big_bertha' ? type.slice(0, -3) + 'sml' : type;
      return { names: [`hit_creature_${t}`], flash: true };
    }
    if (c === 'VHCL' || c === 'SHIP' || c === 'BLDG') {
      const tr = !gat && this.tribeOf(target);
      return { names: [tr ? `hit_object_${tr}_${type}` : `hit_object_${type}`, `hit_object_${type}`, `hit_object_hu_${type}`], flash: c === 'VHCL' };
    }
    return { names: [`hit_land_${this.land()}_${type}`], flash: false };
  }
  first(names) { return names.find((n) => this.m.has(n)) || null; }
  impact(e) {
    const gfx = e.weapon && (e.weapon.projectileGfx || e.weapon.projectile);
    if (!gfx) return false;
    const { names, flash } = this.impactName(gfx, e.target, e.pos);
    const n = this.first(names);
    if (!n) return false;
    this.m.at(n, e.pos, 4.0);
    if (flash) this.m.at(Math.random() < 0.5 ? 'fx_impact_proj_01' : 'fx_impact_proj_02', e.pos, 2.5);
    const A = this.G.audio;
    if (A) A.play('FX_' + n, e.pos);
    return true;
  }
  // a melee hit on a character or animal (EID_HitReactionOVLAnim -> CBloodHit + CHitFlash, E:422-538)
  melee(t, from) {
    if (!t || t.kind !== 'unit' || t.cls === 'VHCL' || t.cls === 'SHIP' || !t.obj) return false;
    const W = this.W;
    if ((t.st && (t.st.t.trapped || 0) > W.time) || t.knock) return true;
    const p = new THREE.Vector3();
    const l = t.cls === 'CHTR' && t.findLink ? t.findLink('Blfa') : null;
    if (l) { l.updateWorldMatrix(true, false); l.getWorldPosition(p); } else {
      // others: half the body's width to the side the blow came from, 3 m up
      const a = from ? Math.atan2(from.x - t.pos.x, from.z - t.pos.z) : 0;
      p.set(t.pos.x + Math.sin(a) * t.radius * 0.5, t.pos.y + Math.min(3, (t.height || 2) * 0.6), t.pos.z + Math.cos(a) * t.radius * 0.5);
    }
    this.m.at(t.cls === 'CHTR' ? 'hit_creature_sharp_sml' : 'hit_creature_sharp_med', p, 2.0);
    this.m.at('fx_impact_0' + (1 + Math.floor(Math.random() * 6)), p, 2.5);
    return true;
  }
  // DoLevelUpAnim -> CLevelUpFX_Transport / CLevelUpFX (E:792-807): the owner-coloured ring, its clip
  levelUp(u) {
    const p = u.pos.clone();
    if (u.cls !== 'CHTR') p.y += 0.75 * (u.height || 2);
    return !!this.m.at('levelup_char_fx', p, this.clipLen('levelup_char_fx', 2.0), { party: u.party });
  }
  // a unit leaves its building (CTheLite: by caste for characters, Spawnping_Animal_Fx for animals)
  spawned(u) {
    if (u.cls === 'CHTR') {
      const caste = this.G.data.column(u.name, u.owner);
      return !!this.m.at(CASTE_SPAWN[caste] || CASTE_SPAWN.tec, u.pos, 1.2, { party: u.party });
    }
    if (u.cls === 'ANML') return !!this.m.at('spawnping_animal_fx', u.pos, 2.85);
    return false;
  }
  placed(b) { const ok = !!this.m.at('placeping_building_fx', b.pos, 1.55); this.camShake('CPlaceBuildingFX', b.pos); return ok; }
  built(b) { return !!this.m.at('readyping_building_fx', b.pos, 1.8, { party: b.party }); }
  invented(b) { return !!b && !!this.m.at('readyping_invent_fx', b.pos, 1.5, { party: b.party }); }
  // death pings (character.usl:2281, Animal.usl:945): characters small, animals by radius; vehicles explode
  died(u) {
    if (u.cls === 'VHCL') return !!this.m.at('vehicle_explosion', u.pos, 2.5);
    if (u.cls !== 'CHTR' && u.cls !== 'ANML') return false;
    const r = u.cls === 'CHTR' ? 0 : u.radius;
    return !!this.m.at(r <= 3.5 ? 'deathping_animal_small_fx' : r <= 5 ? 'deathping_animal_med_fx' : 'deathping_animal_big_fx', u.pos, 3.0, { party: u.party });
  }
  // a building or ship crossed 50 % / 25 % hit points (UpdateDestructionFlags -> CDestructionHit, E:1372)
  damaged(b) {
    const p = b.pos.clone(); p.y += (b.ht || 4) * 0.5;
    const n = b.cls === 'BLDG' ? 'explo_logcannon_building' : `hit_object_${this.tribeOf(b) || 'hu'}_blunt_big`;
    const ok = !!this.m.at(n, p, 2.5);
    this.camShake('CDestructionHit', b.pos);
    return ok;
  }
  // a felled tree's crown hits the ground (CCamShakeHarvestTrees, ui/logs.js): a cloud of leaves and the shake
  leafBlast(p) {
    this.camShake('CCamShakeHarvestTrees', p);
    return !!this.m.at('leave_blast', p, 2.4);
  }
  // an explosion on the ground (MIRAGE's meteor and walking bomb)
  blast(pos) {
    const n = this.first(this.impactName('ninigi_rocket', null, pos).names);
    if (!n) return false;
    this.m.at(n, pos, 4.0);
    this.camShake('CBigBuildingExplosion', pos);       // (the MIRAGE blasts: a guess - no client script of MIRAGE)
    return true;
  }
  // the camera shakes of the original's effect classes (Effects.usl: duration s, strength, fade-out %, range m)
  camShake(cls, pos) {
    const k = SHAKES[cls];
    if (k && this.G.rtscam && this.G.rtscam.addShake) this.G.rtscam.addShake(k[0], k[1], k[2], pos, k[3]);
  }
  clipLen(gfx, d) { const tpl = this.W.template(gfx, true); const c = tpl && tpl.clips && tpl.clips.find((x) => x.name.toLowerCase() === 'anim'); return c ? c.duration : d; }
  // poison (CPoisonEffect, linked while poisoned) and ice (CIcedEffect, 5 s) - checked a few times a second
  status(dt) {
    this.statusT -= dt;
    if (this.statusT > 0) return;
    this.statusT = 0.25;
    const W = this.W, m = this.m;
    for (const u of W.units) {
      if (!u.alive || u.inside || !u.obj || !u.obj.visible) continue;
      if (u.st.poison) {
        const k = 'poison:' + u.id, e = m.keyed.get(k);
        if (e) e.until = W.time + 0.5; else m.attach(u, u.radius < 8 ? 'fx_poison' : 'fx_poison_big', 0.5, { key: k });
      }
      if (u.st.trapWhy === 'iced' && (u.st.t.trapped || 0) > W.time && !m.keyed.has('ice:' + u.id)) m.attach(u, 'fx_ice_freeze', 5.0, { key: 'ice:' + u.id });
    }
  }
}
