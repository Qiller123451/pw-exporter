// Mission 4, "Dragon Fire": the Dragon Clan on an island of the game's own making (maps/dragon.js).
//
// The Dragon Clan fights with powder and with cunning, and the mission is built on that:
//   smoke towers     keep a bank of smoke standing that hides what is inside it - the player's troops find no target
//                    there, the marker does not point there, until the tower is down (smoke)
//   mine fields      lie on the roads and between the paddies; whoever steps near sets them off - and whoever shoots
//                    them first blows them up under the Clan's own men (enemies.js mineStep / mineBlast)
//   gatlings         marksmen and the Parasaurolophus with the gatling on its back fire bursts (ranged.burst)
//   mortars, fire    lob their shot over whatever stands between (ranged.indirect); the guns turn to their target
//   cannons, ramps
//   flame trikes     burn what is in front of them while they drive (breath)
//   boats            corsairs and rocket boats sail up to the shore they shoot at (sail)
//   ninjas           fast, in packs, out of the bamboo, with throwing stars
// The enemy types have faction 'ninigi': only this mission loads them.
import { P } from './maps/dragon.js';

const NI = { faction: 'ninigi', die: ['dying', 'die_simple'], knock: 'hit_back', up: 'getting_up', flinch: 'hit_reaction', taunt: 'menace' };
const BEAST = { faction: 'ninigi', animal: true, die: ['dying'], knock: null, up: null, flinch: 'hit_reaction', taunt: 'menace' };
const BUILT = { faction: 'ninigi', structure: true, held: [], heavy: true, score: 0 };
const GATLING = ['02_battle/arm_gatling_gun_shot1.wav', '02_battle/arm_gatling_gun_shot2.wav', '02_battle/arm_gatling_gun_shot3.wav'];
const CANNON = ['02_battle/arm_cannon_shot1.wav', '02_battle/arm_cannon_shot2.wav', '02_battle/arm_cannon_shot3.wav'];
const ROCKET = ['02_battle/arm_rocket_shoot1.wav', '02_battle/arm_rocket_shoot2.wav'];
const GUNNER = ['ninigi_rider_a', 'Dri1', 'gatling_rider_standanim', 'gatling_rider_attack'];

export const DRAGON_CLAN = {
  // ---- on foot
  d_spear: { ...NI, name: 'Spearman', models: ['ninigi_spearman_s2', 'ninigi_spearman_s3'], held: [['ninigi_spear_c_l', 'HndR'], ['ninigi_buckler_c', 'Shld']],
    health: 60, speed: 9, radius: 0.85, height: 4, run: 'walk_3', runSpeed: 7, idle: 'nat_fight_standanim',
    attack: { range: 4.2, damage: 10, clips: ['nat_strike_0', 'nat_strike_1', 'nat_strike_4', 'nat_strike_7'], hitAt: 0.45, time: 1.05, ts: 1.2 },
    ranged: { range: 44, min: 12, damage: 11, clip: 'nat_throw', releaseAt: 0.75, time: 1.5, every: 3.4, projectile: 'ninigi_spear_c_arrow', speed: 46, arc: 0.12 },
    staggerAt: 26, executable: 0.3, score: 1 },
  d_archer: { ...NI, name: 'Archer', models: ['ninigi_archer_s2', 'ninigi_archer_s3'], held: [['ninigi_bow_c_l', 'HndL']],
    health: 40, speed: 8, radius: 0.85, height: 4, run: 'walk_3', runSpeed: 7, idle: 'standanim',
    attack: { range: 3, damage: 6, clips: ['all_strike_1', 'all_strike_2'], hitAt: 0.5, time: 1.1, ts: 1.2 },
    ranged: { range: 75, min: 22, damage: 9, clip: 'bow_1', releaseAt: 1.0, time: 1.9, every: 2.6, projectile: 'ninigi_arrow', speed: 72, arc: 0.06, keep: 34 },
    staggerAt: 20, executable: 0.3, score: 1 },
  // the sword of the Clan
  d_samurai: { ...NI, name: 'Samurai', models: ['ninigi_warrior_s3', 'ninigi_warrior_s4'], held: [['ninigi_katana_c', 'HndR']],
    health: 95, speed: 10.5, radius: 0.85, height: 4.1, run: 'walk_3', runSpeed: 7, idle: 'res_fight_standanim',
    attack: { range: 3.3, damage: 13, clips: ['res_strike_0', 'res_strike_2', 'res_strike_4', 'res_strike_6', 'res_strike_9'], hitAt: 0.42, time: 0.95, ts: 1.3 },
    staggerAt: 40, executable: 0.3, score: 2 },
  // out of the bamboo, in packs: the fastest thing on two legs, a throwing star while it closes, then it is on you
  d_ninja: { ...NI, name: 'Ninja', models: ['ninigi_ninja_s3', 'ninigi_ninja_s4'], held: [['ninigi_dagger', 'HndR'], ['ninigi_dagger', 'HndL']],
    health: 45, speed: 15.5, radius: 0.8, height: 4, run: 'walk_3_new', runSpeed: 7, idle: 'nat_fight_standanim',
    attack: { range: 3.1, damage: 11, clips: ['ninja_attack_0', 'ninigi_ninja_0', 'ninigi_ninja_1', 'all_strike_1'], hitAt: 0.35, time: 0.75, ts: 1.45, leap: 11 },
    ranged: { range: 34, min: 9, damage: 7, clip: 'tec_sm_cocktail', releaseAt: 0.4, time: 0.8, every: 3.6, projectile: 'ninigi_shuriken_arrow', speed: 64, arc: 0.02 },
    staggerAt: 20, executable: 0.3, score: 2 },
  // a hand gatling: six shots in a breath
  d_marksman: { ...NI, name: 'Gatling marksman', models: ['ninigi_marksman_s3', 'ninigi_marksman_s4'], held: [['ninigi_gatling_c_l', 'HndL']],
    health: 55, speed: 8, radius: 0.85, height: 4, run: 'walk_3_new', runSpeed: 7, idle: 'tec_fightpos_standanim',
    attack: { range: 3, damage: 6, clips: ['all_strike_1', 'all_strike_2'], hitAt: 0.5, time: 1.1, ts: 1.2 },
    ranged: { range: 72, min: 16, damage: 4, clip: 'marksman_gatling', releaseAt: 0.45, time: 1.9, every: 3.6, projectile: 'ninigi_bullet', speed: 150, arc: 0.01, keep: 40,
      burst: 6, burstGap: 0.11, sound: GATLING, volume: 45 },
    staggerAt: 22, executable: 0.3, score: 2 },
  // stands far back and lobs shells over everything
  d_mortar: { ...NI, name: 'Mortar man', models: ['ninigi_mortar_s3', 'ninigi_mortar_s4'], held: [],
    health: 60, speed: 7.5, radius: 0.9, height: 4, run: 'walk_3_new', runSpeed: 7, idle: 'tec_fightpos_standanim',
    attack: { range: 3, damage: 6, clips: ['all_strike_1', 'all_strike_2'], hitAt: 0.5, time: 1.1, ts: 1.2 },
    ranged: { range: 105, min: 26, damage: 20, clip: 'tec_crossbow', releaseAt: 0.9, time: 2.1, every: 5.2, projectile: 'ninigi_cannonball', speed: 44, gravity: 26, keep: 62, splash: 6.5, indirect: true,
      sound: CANNON, volume: 55 },
    staggerAt: 24, executable: 0.3, score: 3 },
  // a wall of a man with a staff
  d_sumo: { ...NI, name: 'Sumo', models: ['ninigi_sumo_s3', 'ninigi_sumo_s4'], held: [['ninigi_staff_c_m', 'HndR']],
    health: 400, speed: 8.5, radius: 1.25, height: 4.8, scale: 1.25, run: 'walk_3_new', runSpeed: 7, idle: 'tec_fightpos_standanim',
    attack: { range: 4.4, damage: 24, clips: ['tec_staff_strike_1', 'tec_staff_strike_2', 'tec_staff_strike_3', 'ninigi_sumo_0'], hitAt: 0.5, time: 1.25, ts: 1.1, knock: 22 },
    staggerAt: 170, executable: 0.22, score: 5 },
  d_monk: { ...NI, name: 'Warrior monk', models: ['ninigi_monk_s3', 'ninigi_monk_s4'], held: [['ninigi_staff_d_m', 'HndR']],
    health: 120, speed: 12, radius: 0.85, height: 4.1, run: 'walk_3', runSpeed: 7, idle: 'res_fight_standanim',
    attack: { range: 3.8, damage: 14, clips: ['res_strike_3', 'res_strike_7', 'res_strike_11', 'res_sm_kick', 'res_sm_jump'], hitAt: 0.42, time: 0.95, ts: 1.3, knock: 10, leap: 8 },
    staggerAt: 55, executable: 0.26, score: 3 },

  // ---- beasts and machines
  // spits from a distance, bites when one comes near
  d_dilo: { ...BEAST, name: 'Dilophosaurus', models: ['dilophosaurus'], held: [], owned: true, knock: 'hit_back', up: 'getting_up',
    health: 90, speed: 14, radius: 1.3, height: 3.8, scale: 1.15, run: 'walk_4', runSpeed: 9, idle: 'standanim',
    attack: { range: 3.6, damage: 12, clips: ['attack_front', 'attack_1', 'attack_2', 'attack_front_m'], hitAt: 0.4, time: 0.9, ts: 1.25, leap: 9 },
    ranged: { range: 42, min: 10, damage: 9, clip: 'threaten', releaseAt: 0.5, time: 1.1, every: 3.4, projectile: 'ninigi_bullet', speed: 48, arc: 0.1, link: 'Proj' },
    staggerAt: 34, executable: 0.25, score: 2 },
  // riders on sabre-tooths
  d_cat: { ...BEAST, name: 'Sabre-tooth rider', models: ['eusmilus'], held: [['ninigi_animal_flag_01', 'flag']], riders: [['ninigi_rider_a', 'Ride']], owned: true, knock: 'hit_back', up: 'getting_up',
    health: 210, speed: 16, radius: 1.5, height: 4.4, scale: 1.2, run: 'walk_4', runSpeed: 9, idle: 'standanim',
    attack: { range: 4.2, damage: 16, clips: ['attack_front', 'attack_1', 'attack_2', 'attack_m'], hitAt: 0.4, time: 0.9, ts: 1.25, knock: 12, leap: 12 },
    staggerAt: 90, executable: 0.22, score: 5 },
  // the Baryonyx: claws like sickles, and it comes at a run
  d_bary: { ...BEAST, name: 'Baryonyx rider', models: ['baryonyx'], held: [['ninigi_animal_flag_02', 'flag']], riders: [['ninigi_rider_a', 'Ride']], heavy: true, owned: true, maxAlive: 3,
    health: 950, speed: 11.5, charge: 17, radius: 2.6, height: 7, run: 'walk_3', runSpeed: 7, idle: 'standanim',
    attack: { range: 7, damage: 28, clips: ['attack_front', 'attack_front_up'], hitAt: 0.5, time: 1.3, ts: 1.05, knock: 24, arc: 100, start: 3, lunge: 16 },
    staggerAt: 300, executable: 0.15, score: 12 },
  // the Parasaurolophus with the gatling: long bursts while it walks
  d_gatling: { ...BEAST, name: 'Gatling Parasaurolophus', models: ['parasaurolophus'], held: [['ninigi_animal_flag_02', 'flag']], heavy: true, owned: true, maxAlive: 3,
    addon: { model: 'ninigi_parasaurolophus_gatling', link: 'con', clip: 'attack_front', crew: [GUNNER] },
    health: 850, speed: 9, charge: 12, radius: 2.8, height: 7.5, run: 'walk_2', runSpeed: 5, idle: 'standanim',
    attack: { range: 6.5, damage: 20, clips: ['attack_front', 'attack_1', 'attack_2'], hitAt: 0.5, time: 1.3, ts: 1.0, knock: 20, arc: 100, start: 3, lunge: 12 },
    ranged: { range: 90, min: 12, damage: 5, releaseAt: 0.3, time: 1.6, every: 3.2, projectile: 'ninigi_bullet', speed: 150, arc: 0.01, keep: 0, moving: true, burst: 9, burstGap: 0.1, sound: GATLING, volume: 55 },
    staggerAt: 300, executable: 0.15, score: 12 },
  // the flame-thrower trike: fast, and everything in front of it burns
  d_trike: { faction: 'ninigi', name: 'Flame trike', models: ['ninigi_flamethrower_trike'], held: [['ninigi_animal_flag_01', 'flag']], riders: [['ninigi_rider_a', 'Dri1']], heavy: true, machine: true, maxAlive: 3,
    health: 620, speed: 13, charge: 15, radius: 2.4, height: 4.6, run: 'walk_3', runSpeed: 7, idle: 'standanim',
    attack: { range: 5, damage: 14, clips: ['standanim'], hitAt: 0.5, time: 1.2, ts: 1.0, knock: 18, arc: 80, turn: 2.6 },
    breath: { range: 19, arc: 0.5, dps: 20, forward: 3 },
    die: ['trip'], knock: null, up: null, flinch: 'hit_back', taunt: 'standanim',
    staggerAt: 400, executable: 0.1, score: 12 },
  // the warlord of the town, on the greatest Baryonyx of the island
  d_warlord: { ...BEAST, name: 'The warlord', models: ['baryonyx'], held: [['ninigi_animal_flag_05', 'flag']], riders: [['ninigi_rider_b', 'Ride']], heavy: true, elite: true, boss: true, armor: true, owned: true,
    health: 7500, speed: 12.5, charge: 19, radius: 3.9, height: 10, scale: 1.5, run: 'walk_3', runSpeed: 7, idle: 'standanim',
    attack: { range: 10, damage: 36, clips: ['attack_front', 'attack_front_up'], hitAt: 0.55, time: 1.5, ts: 1.0, knock: 30, start: 4, lunge: 20, arc: 110, turn: 2.6,
      stomp: { clip: 'shake', time: 1.9, hitAt: 0.9, radius: 12, damage: 30, knock: 28, chance: 0.25 } },
    staggerAt: 900, executable: 0.07, score: 80 },
  // the Seismosaurus: a rocket launcher on its back and a gatling on either flank - the arsenal on four legs
  d_titan: { ...BEAST, name: 'Seismosaurus titan', models: ['seismosaurus'], held: [], heavy: true, elite: true, boss: true, armor: true, owned: true,
    addon: [{ model: 'ninigi_triceratops_launcher', link: 'con', clip: 'attack_front', crew: [['ninigi_rider_b', 'Dri1', 'gatling_rider_standanim', 'gatling_rider_attack']] },
      { model: 'ninigi_parasaurolophus_gatling', link: 'con2', clip: 'attack_front', crew: [['ninigi_rider_b', 'Dri1', 'gatling_rider_standanim', 'gatling_rider_attack']] },
      { model: 'ninigi_parasaurolophus_gatling', link: 'con3', clip: 'attack_front', crew: [['ninigi_rider_b', 'Dri1', 'gatling_rider_standanim', 'gatling_rider_attack']] }],
    health: 15000, speed: 8.5, charge: 14, radius: 6.5, height: 18, run: 'walk_3', runSpeed: 7, idle: 'standanim', taunt: 'menace',
    attack: { range: 14, damage: 44, clips: ['attack_front', 'attack_1', 'attack_2'], hitAt: 0.6, time: 1.9, ts: 1.0, knock: 36, start: 4, lunge: 16, arc: 120, turn: 1.8,
      stomp: { clip: 'sm_barrage', time: 2.4, hitAt: 1.1, radius: 17, damage: 42, knock: 32, chance: 0.3 } },
    ranged: { range: 120, min: 14, damage: 22, releaseAt: 0.4, time: 1.4, every: 1.9, projectile: 'ninigi_rb_projektil', speed: 70, gravity: 16, keep: 0, splash: 5.5, moving: true, sound: ROCKET, volume: 60 },
    staggerAt: 1400, executable: 0.06, score: 150 },

  // ---- what the Dragon Clan has built
  // the watchtower: archers
  d_tower: { ...BUILT, name: 'Watchtower', models: ['ninigi_small_tower'], health: 950, radius: 4.5, solid: 3.6, height: 15, fire: 1.8,
    ranged: { range: 66, damage: 7, every: 1.7, projectile: 'ninigi_arrow', speed: 85, link: 'Proj' } },
  // ... and the same tower with the rocket launcher on top (the game's upgrade): it turns to its target
  d_rtower: { ...BUILT, name: 'Rocket tower', models: ['ninigi_small_tower'], addon: { model: 'ninigi_small_tower_upgrade', link: 'we', muzzle: 'Do_1', aims: 1.6 }, health: 1250, radius: 4.5, solid: 3.6, height: 15, fire: 1.6,
    ranged: { range: 115, min: 14, damage: 20, every: 3.4, projectile: 'ninigi_rb_projektil', speed: 62, gravity: 10, splash: 5.5, indirect: true, sound: ROCKET, volume: 60 } },
  // the smoke tower: a bank of smoke round it that hides what the Clan has there (enemies.js smokeStep)
  d_smoke: { ...BUILT, name: 'Smoke tower', models: ['ninigi_smoke_tower'], health: 900, radius: 4.5, solid: 3.6, height: 14, fire: 1.8, smoke: { radius: 30, height: 12, rate: 36, size: 13 } },
  d_scope: { ...BUILT, name: 'Telescope tower', models: ['ninigi_telescope_tower'], idle: 'idle', health: 1100, radius: 4.5, solid: 3.6, height: 16, fire: 1.6 },
  // the fire cannon: a heavy shell over any wall, and it turns to whom it shoots at
  d_cannon: { ...BUILT, name: 'Fire cannon', models: ['ninigi_firecannon'], idle: 'standanim', addon: { model: 'ninigi_firecannon_top', link: 'we', clip: 'attack_front', aims: 1.1 }, health: 1300, radius: 3.6, solid: 3, height: 5, fire: 1.4,
    ranged: { range: 150, min: 24, damage: 28, every: 4.4, projectile: 'ninigi_cannonball', speed: 52, gravity: 22, splash: 7, indirect: true, sound: CANNON, volume: 70 } },
  // the rocket ramps of the volcano: they reach the whole way up the stairs
  d_ramp: { ...BUILT, name: 'Rocket ramp', models: ['ninigi_rocket_ramp'], addon: { model: 'ninigi_rb_top', link: 'RE_1', clip: 'attack_front', aims: 0.9 }, health: 1900, radius: 4.5, solid: 3.6, height: 9, fire: 1.3,
    ranged: { range: 230, min: 36, damage: 32, every: 5.5, projectile: 'ninigi_rb_projektil', speed: 60, gravity: 18, splash: 9, indirect: true, sound: ROCKET, volume: 75 }, lockedNote: 'Out of reach from here' },
  d_stakes: { ...BUILT, name: 'Gate of the stakes', models: ['ninigi_defense_skewer_gate'], health: 2000, radius: 9, height: 9, fire: 2.2, wall: { half: 11.5, thick: 1.8 }, lockedNote: 'The gate holds while its towers stand' },
  d_gate: { ...BUILT, name: 'Gate of the town', models: ['ninigi_palisade_gate'], health: 4200, radius: 9, height: 13, fire: 1.8, wall: { half: 11.5, thick: 1.8 }, lockedNote: 'The gate holds while its towers stand' },
  d_nest: { ...BUILT, name: 'Dilophosaurus nest', models: ['ninigi_dilophosaurus_nest'], health: 800, radius: 4.5, solid: 3.4, height: 7, fire: 2.4 },
  d_dojo: { ...BUILT, name: 'Dojo', models: ['ninigi_dojo'], health: 2000, radius: 8, solid: 7, height: 12, fire: 2.0 },
  d_smith: { ...BUILT, name: 'Weapon maker', models: ['ninigi_weapon_maker'], idle: 'idle', health: 1800, radius: 8.5, solid: 7, height: 12, fire: 2.0 },
  d_works: { ...BUILT, name: 'Engineers\' workshop', models: ['ninigi_engineer'], idle: 'idle', health: 1800, radius: 8.5, solid: 7, height: 9, fire: 2.2 },
  d_tea: { ...BUILT, name: 'Tea house', models: ['ninigi_teahouse'], idle: 'standanim', health: 1500, radius: 8.5, solid: 7, height: 13, fire: 2.5 },
  d_harbour: { ...BUILT, name: 'Harbour', models: ['ninigi_harbour'], health: 2400, radius: 9, solid: 7.5, height: 8, fire: 2.0 },
  d_temple: { ...BUILT, name: 'Temple of the dragon', models: ['ninigi_temple'], health: 4500, radius: 10, solid: 8.6, height: 10, fire: 1.3, lockedNote: 'First the titan' },
  // boats: they come for whoever stands on the shore
  d_corsair: { ...BUILT, name: 'Corsair', models: ['ninigi_corsair'], idle: 'standanim', health: 1500, radius: 6, solid: 0, height: 9, fire: 2.2, draft: 0.3,
    sail: { speed: 11, keep: 48, wake: 330, depth: 1.1, turn: 1.0, clip: 'walk_2', bow: Math.PI },
    ranged: { range: 115, min: 10, damage: 16, every: 3.2, projectile: 'ninigi_cannonball', speed: 70, gravity: 14, splash: 5, lead: 1, link: 'Proj', sound: CANNON, volume: 60 } },
  d_rocketboat: { ...BUILT, name: 'Rocket boat', models: ['ninigi_rocket_boat'], idle: 'standanim', health: 1300, radius: 6, solid: 0, height: 8, fire: 2.2, draft: 0.3,
    sail: { speed: 12, keep: 60, wake: 330, depth: 1.1, turn: 1.0, clip: 'walk_2', bow: Math.PI },
    ranged: { range: 150, min: 20, damage: 24, every: 4.2, clip: 'attack_front', projectile: 'ninigi_rocket_boat_arrow', speed: 64, gravity: 16, splash: 7, indirect: true, link: 'psh1', sound: ROCKET, volume: 65 } },
  d_turret: { ...BUILT, name: 'Water turret', models: ['ninigi_water_turret'], idle: 'standanim', addon: { model: 'ninigi_water_turret_cannon', link: 'we', clip: 'attack_front', aims: 1.1 }, health: 1200, radius: 4, solid: 0, height: 6, fire: 2.0, draft: 0.2,
    ranged: { range: 140, min: 14, damage: 20, every: 3.6, projectile: 'ninigi_cannonball', speed: 70, gravity: 14, splash: 5.5, indirect: true, sound: CANNON, volume: 60 } },
  // a mine field: steps near it set it off, a bullet does too
  d_mine: { ...BUILT, name: 'Mine field', models: ['ninigi_minefield'], health: 28, radius: 3.6, solid: 0, height: 1.4, fire: 0, mine: { trigger: 6.5, fuse: 0.75, radius: 11, damage: 48, knock: 24 } },
};

const W = (every, group, total, mix, heavy) => ({ every, group, total, mix, heavy: heavy || {} });
// n defenders standing around a place at the start of an objective
function guards(at, n, types) {
  const out = [];
  for (let k = 0; k < n; k++) { const a = k * 2.399963, r = 8 + 4.2 * Math.sqrt(k) * 2.2; out.push({ type: types[k % types.length], pos: [at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r] }); }
  return out;
}

export const DRAGON = {
  id: 'dragon', title: 'Dragon Fire',
  blurb: 'An island of the Dragon Clan, of the game\'s own making: through mined rice terraces and a bamboo forest full of ninjas into their walled town, down to the harbour of the rocket boats, and up a volcano under rocket fire to the Seismosaurus titan at the temple of the dragon.',
  map: 'gen:dragon',
  note: 'a map of the game\'s own making - needs nothing but the game',
  faction: 'ninigi', enemies: DRAGON_CLAN, enemyName: 'Dragon Clan', music: 'Ninigi',
  look: { sky: 0xc9d2c4, fogNear: 220, fogFar: 1000, sun: 2.3, sunColor: 0xfff0d8, sunDir: [0.45, 0.72, 0.5], hemi: 1.3, hemiSky: 0xe6eedc, hemiGround: 0x6c6a52 },
  // ash falls on the volcano
  weather: { ash: { from: 44, full: 66, count: 1100, color: 0x8a8580, size: 0.42, fall: 3.2, drift: 2.8 } },
  physics: { maxSlope: 0.95, leash: 10 },
  nav: { drop: 1.1 },
  allies: { count: 12 },
  swarm: { max: 130, spawnMin: 55, spawnMax: 115, corpseTime: 8, separation: 1.9, attackSlots: 7 },

  zones: {
    list: [
      { id: 'beach', name: 'the beach', seed: null },
      { id: 'paddies', name: 'the rice terraces', seed: [0, 232] },
      { id: 'grove', name: 'the bamboo forest', seed: [150, 22] },
      { id: 'town', name: 'the town', seed: [60, -230] },
      { id: 'harbour', name: 'the harbour', seed: [300, -260] },
      { id: 'stairs', name: 'the stairs of the volcano', seed: [-104, -340] },
      { id: 'court', name: 'the temple court', seed: [62, -548] },
    ],
    cuts: [
      [-120, 292, 140, 292],               // the stakes
      [44, 42, 134, 132],                  // the mouth of the bamboo canyon
      [36, -108, 164, -108],               // the palisade of the town
      [208, -290, 208, -168],              // the way down to the harbour
      [-120, -286, -50, -344],             // the foot of the stairs
      [-36, -494, 8, -412],                // the head of the stairs | the court
    ],
    rubble: [], gateRange: 13, wallHeight: 18, wallColor: 0x66ccff, wallNear: 34,
    note: 'The Dragon Clan still holds what lies beyond - finish the objective first',
  },

  mission: {
    reserved: /^(ninigi_small_tower|ninigi_smoke_tower|ninigi_telescope_tower|ninigi_firecannon|ninigi_rocket_ramp|ninigi_defense_skewer_gate|ninigi_palisade_gate|ninigi_dilophosaurus_nest|ninigi_dojo|ninigi_weapon_maker|ninigi_engineer|ninigi_teahouse|ninigi_harbour|ninigi_temple|ninigi_corsair|ninigi_rocket_boat|ninigi_water_turret|ninigi_minefield)$/,
    gfx: { ninigi_rocket_tower: 'ninigi_small_tower' },
    garrison: [{ type: 'd_tower', map: true, cls: /^ninigi_small_tower$/ }, { type: 'd_rtower', map: true, cls: /^ninigi_rocket_tower$/ }, { type: 'd_smoke', map: true }, { type: 'd_scope', map: true }, { type: 'd_cannon', map: true }, { type: 'd_ramp', map: true, locked: true },
      { type: 'd_stakes', map: true, locked: true }, { type: 'd_gate', map: true, locked: true }, { type: 'd_nest', map: true }, { type: 'd_dojo', map: true }, { type: 'd_smith', map: true },
      { type: 'd_works', map: true }, { type: 'd_tea', map: true }, { type: 'd_harbour', map: true }, { type: 'd_temple', map: true, locked: true },
      { type: 'd_corsair', map: true }, { type: 'd_rocketboat', map: true }, { type: 'd_turret', map: true }, { type: 'd_mine', map: true }],
    title: 'Dragon Fire', won: 'The arsenal of the Dragon Clan is taken', lost: 'The Dragon Clan keeps its island',
    intro: 'This island is the arsenal of the Dragon Clan: powder, rockets and the beasts that carry them, and at the top of the volcano the temple where their titan is kept. Take it apart, from the beach to the summit. Watch the ground - they have mined their own fields. A mine field that is shot goes up under whoever stands on it.',
    start: { x: 30, z: 418, yaw: 0 },
    objectives: [
      // ---------------------------------------------------------------- the beach
      { type: 'kill', zone: 'beach', text: 'Clear the beach', pos: [30, 376], radius: 50, count: 30, troops: 8, rally: [30, 420],
        waves: W(4, 9, 55, { d_spear: 5, d_archer: 3, d_samurai: 2 }) },
      { type: 'destroy', text: 'Pull down the towers on the shore and sink the corsair in the bay', pos: [30, 338], radius: 70,
        targets: [{ type: 'd_tower', near: [30, 344], within: 75 }, { type: 'd_smoke', near: [30, 344], within: 75 }, { type: 'd_corsair', zone: 'beach' }],
        waves: W(5, 9, 9999, { d_spear: 5, d_archer: 3, d_samurai: 2, d_ninja: 1 }) },
      { type: 'destroy', text: 'Break through the stakes: the towers behind them, then the gate', pos: P.stakes, radius: 60,
        targets: [{ type: 'd_tower', near: [12, 276], within: 45, any: true }, { type: 'd_stakes', near: P.stakes, within: 30, any: true }],
        waves: W(4.5, 10, 9999, { d_spear: 5, d_archer: 3, d_samurai: 3, d_marksman: 1 }) },
      // ---------------------------------------------------------------- the rice terraces
      { type: 'reach', zone: 'paddies', text: 'Into the rice terraces - mind the mine fields: shoot them before you walk', pos: [4, 244], radius: 13, troops: 6, rally: [14, 300], arrive: 'enforcer',
        waves: W(4.5, 10, 60, { d_spear: 4, d_archer: 2, d_samurai: 2, d_marksman: 2, d_dilo: 2 }) },
      { type: 'destroy', text: 'The fire cannons on the upper dike stand in the smoke of a smoke tower: bring it down, then the cannons and the rocket towers', pos: P.dike, radius: 60,
        targets: [{ type: 'd_smoke', zone: 'paddies' }, { type: 'd_cannon', zone: 'paddies' }, { type: 'd_rtower', near: P.dike, within: 70 }],
        waves: W(3.8, 11, 9999, { d_spear: 4, d_archer: 2, d_samurai: 3, d_marksman: 2, d_mortar: 1, d_dilo: 2 }) },
      { type: 'hold', text: 'Hold the dike against the counterattack', pos: [38, 158], radius: 30, seconds: 45,
        waves: W(3.2, 12, 9999, { d_spear: 4, d_archer: 2, d_samurai: 3, d_marksman: 2, d_ninja: 2, d_cat: 1 }, { d_gatling: 0.2 }) },
      // ---------------------------------------------------------------- the bamboo forest
      { type: 'reach', zone: 'grove', text: 'Into the bamboo', pos: [150, 22], radius: 12, troops: 6, rally: [40, 150],
        waves: W(4, 10, 60, { d_ninja: 5, d_archer: 2, d_dilo: 3 }) },
      { type: 'destroy', text: 'Burn out the nests of the Dilophosaurs', pos: P.grove, radius: 46, targets: [{ type: 'd_nest', zone: 'grove' }],
        guards: guards(P.grove, 10, ['d_dilo', 'd_dilo', 'd_ninja']),
        waves: W(3, 12, 9999, { d_ninja: 5, d_dilo: 5, d_samurai: 1, d_monk: 1 }) },
      { type: 'kill', text: 'The ninjas come out of the bamboo: break the ambush', pos: [150, -40], radius: 40, count: 55,
        waves: W(2.8, 13, 120, { d_ninja: 7, d_samurai: 2, d_monk: 2, d_dilo: 2, d_cat: 1 }) },
      { type: 'destroy', text: 'The palisade of the town: the smoke tower and the rocket towers behind it, then the gate', pos: P.townGate, radius: 60,
        targets: [{ type: 'd_smoke', near: [100, -126], within: 45, any: true }, { type: 'd_rtower', near: [100, -126], within: 45, any: true }, { type: 'd_gate', near: P.townGate, within: 30, any: true }],
        waves: W(3.6, 11, 9999, { d_spear: 3, d_archer: 2, d_samurai: 3, d_marksman: 2, d_mortar: 1, d_ninja: 2 }, { d_trike: 0.12 }) },
      // ---------------------------------------------------------------- the town
      // (checkpoint 1: the gate of the town is down)
      { type: 'reach', zone: 'town', text: 'Into the town', pos: [70, -196], radius: 14, checkpoint: { at: [100, -92] }, troops: 8, rally: [100, -92],
        waves: W(4, 10, 70, { d_spear: 3, d_archer: 2, d_samurai: 3, d_marksman: 2, d_sumo: 1 }) },
      { type: 'destroy', text: 'Burn the dojo, the weapon maker, the engineers\' workshop and the tea house', pos: P.town, radius: 110,
        targets: [{ type: 'd_dojo', zone: 'town' }, { type: 'd_smith', zone: 'town' }, { type: 'd_works', zone: 'town' }, { type: 'd_tea', zone: 'town' }],
        waves: W(3.2, 12, 9999, { d_spear: 3, d_archer: 2, d_samurai: 3, d_marksman: 2, d_mortar: 1, d_sumo: 1, d_monk: 2, d_ninja: 1 }, { d_trike: 0.14, d_gatling: 0.1 }) },
      { type: 'boss', text: 'The warlord of the town rides out: bring him down', pos: P.town, radius: 80, bosses: ['d_warlord'], troops: 6, rally: [100, -120],
        waves: W(4.5, 10, 9999, { d_spear: 3, d_archer: 2, d_samurai: 3, d_marksman: 1, d_monk: 1 }) },
      // ---------------------------------------------------------------- the harbour
      { type: 'reach', zone: 'harbour', text: 'Down to the harbour', pos: [282, -246], radius: 14,
        waves: W(4, 10, 60, { d_spear: 3, d_archer: 2, d_samurai: 2, d_marksman: 2, d_mortar: 1 }) },
      { type: 'destroy', text: 'Sink the fleet: the rocket boats, the corsair and the water turrets - and burn the harbour', pos: P.harbour, radius: 90,
        targets: [{ type: 'd_rocketboat', zone: 'harbour' }, { type: 'd_corsair', zone: 'harbour' }, { type: 'd_turret', zone: 'harbour' }, { type: 'd_harbour', zone: 'harbour' }, { type: 'd_tower', zone: 'harbour' }, { type: 'd_rtower', zone: 'harbour' }],
        waves: W(3.6, 11, 9999, { d_spear: 3, d_archer: 2, d_samurai: 3, d_marksman: 2, d_ninja: 2, d_sumo: 1 }, { d_trike: 0.12 }) },
      // ---------------------------------------------------------------- the volcano
      // (checkpoint 2: the fleet is sunk)
      { type: 'reach', zone: 'stairs', text: 'Back through the town and up the stairs of the volcano', pos: [-76, -304], radius: 13, checkpoint: { at: [-20, -246] }, troops: 10, rally: [-20, -246],
        waves: W(4, 10, 70, { d_spear: 3, d_archer: 2, d_samurai: 3, d_monk: 2, d_ninja: 2 }) },
      { type: 'destroy', text: 'Climb under the rockets and blow up the three rocket ramps', pos: P.stairs, radius: 110,
        targets: [{ type: 'd_ramp', zone: 'stairs' }, { type: 'd_smoke', zone: 'stairs' }, { type: 'd_tower', zone: 'stairs' }, { type: 'd_rtower', zone: 'stairs' }],
        waves: W(3.2, 12, 9999, { d_spear: 3, d_archer: 2, d_samurai: 3, d_marksman: 2, d_mortar: 1, d_monk: 3, d_sumo: 1, d_cat: 1 }, { d_bary: 0.12, d_gatling: 0.1 }) },
      // ---------------------------------------------------------------- the temple court
      { type: 'reach', zone: 'court', text: 'Into the court of the temple', pos: [40, -500], radius: 14, troops: 10, rally: [-14, -452],
        waves: W(4, 10, 70, { d_samurai: 4, d_archer: 2, d_marksman: 2, d_monk: 3 }),
        guards: guards(P.court, 18, ['d_samurai', 'd_monk', 'd_archer', 'd_marksman', 'd_sumo', 'd_spear']) },
      { type: 'destroy', text: 'Tear down the towers of the court', pos: P.court, radius: 90, targets: [{ type: 'd_smoke', zone: 'court' }, { type: 'd_tower', zone: 'court' }, { type: 'd_rtower', zone: 'court' }, { type: 'd_scope', zone: 'court' }],
        waves: W(3.2, 12, 9999, { d_samurai: 4, d_archer: 2, d_marksman: 2, d_mortar: 1, d_monk: 3, d_sumo: 1, d_ninja: 2 }, { d_trike: 0.1, d_bary: 0.1 }) },
      { type: 'boss', text: 'Bring down the Seismosaurus titan', pos: P.court, radius: 80, bosses: ['d_titan'], troops: 10, rally: [40, -492],
        waves: W(4.5, 10, 9999, { d_samurai: 4, d_archer: 2, d_marksman: 2, d_monk: 2 }) },
      { type: 'destroy', text: 'Burn the temple of the dragon', pos: [96, -566], radius: 40, targets: [{ type: 'd_temple', zone: 'court' }],
        waves: W(3.4, 12, 9999, { d_samurai: 4, d_archer: 2, d_marksman: 2, d_monk: 3, d_ninja: 2, d_sumo: 1 }) },
      { type: 'hold', text: 'Hold the dragon gate until the charges are set', pos: [40, -590], radius: 30, seconds: 60,
        waves: W(2.8, 14, 9999, { d_samurai: 4, d_archer: 2, d_marksman: 2, d_mortar: 1, d_monk: 3, d_ninja: 3, d_sumo: 1, d_cat: 1 }, { d_bary: 0.12, d_gatling: 0.1, d_trike: 0.1 }) },
    ],
  },
};
