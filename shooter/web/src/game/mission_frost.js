// Mission 3: "Iron Winter" - on a map of the game's own making (maps/frost.js), against the Norsemen.
//
// The SEAS land on a northern island to seize the rune gate of the Norsemen. The way there: the beach, the palisade,
// the fishing village, the war mammoths in the pens (the player rides one against the wall of the pass), the pass
// up into the snow, the frozen lake (a steam tank), and - by helicopter round the cape - the fortress on the cliffs.
//
// Two stretches are not fought on foot (objective.ride, rides.js):
//   the war mammoth   a beast of the Norsemen: tusks, a charge and a stamp that shakes the ground
//   the gunship       the SEAS helicopter: the player flies it and has its guns, over the cape of the fortress
import { P } from './maps/frost.js';

// ---------------------------------------------------------------- the Norsemen
// (the same fields as the Dustriders in config.js; faction: only the mission that names it loads them)
const HU = { faction: 'hu', die: ['dying', 'die_simple'], knock: 'hit_back', up: 'getting_up', flinch: 'hit_reaction', taunt: 'menace' };
const BEAST = { faction: 'hu', animal: true, die: ['dying'], knock: null, up: null, flinch: 'hit_reaction', taunt: 'menace' };
const BUILT = { faction: 'hu', structure: true, held: [], heavy: true, score: 0 };
export const NORSE = {
  swordsman: { ...HU, name: 'Swordsman', models: ['hu_warrior_s3', 'hu_warrior_s4'], held: [['hu_sword_c', 'HndR'], ['hu_buckler_c', 'Shld']],
    health: 75, speed: 9.5, radius: 0.85, height: 4, run: 'walk_3', runSpeed: 7, idle: 'res_fight_standanim',
    attack: { range: 3.1, damage: 9, clips: ['res_strike_0', 'res_strike_1', 'res_strike_3', 'res_strike_5'], hitAt: 0.45, time: 1.0, ts: 1.25 },
    staggerAt: 30, executable: 0.3, score: 1 },
  javelin: { ...HU, name: 'Spear thrower', models: ['hu_spearman_s3'], held: [['hu_spear_c_l', 'HndR']],
    health: 55, speed: 8.5, radius: 0.85, height: 4, run: 'walk_3', runSpeed: 7, idle: 'nat_fight_standanim',
    attack: { range: 4.2, damage: 11, clips: ['nat_strike_0', 'nat_strike_1', 'nat_strike_4'], hitAt: 0.45, time: 1.05, ts: 1.2 },
    ranged: { range: 46, min: 12, damage: 12, clip: 'nat_throw', releaseAt: 0.75, time: 1.5, every: 3.2, projectile: 'hu_spear_c_arrow', speed: 46, arc: 0.12 },
    staggerAt: 26, executable: 0.3, score: 1 },
  bowman: { ...HU, name: 'Bowman', models: ['hu_archer_s3'], held: [['hu_bow_c_l', 'HndL']],
    health: 40, speed: 8, radius: 0.85, height: 4, run: 'walk_3', runSpeed: 7, idle: 'standanim',
    attack: { range: 3, damage: 6, clips: ['all_strike_1', 'all_strike_2'], hitAt: 0.5, time: 1.1, ts: 1.2 },
    ranged: { range: 75, min: 22, damage: 9, clip: 'bow_1', releaseAt: 1.0, time: 1.9, every: 2.6, projectile: 'hu_arrow', speed: 70, arc: 0.06, keep: 34 },
    staggerAt: 20, executable: 0.3, score: 1 },
  // slow to load, hits hard and far
  crossbow: { ...HU, name: 'Crossbowman', models: ['hu_marksman_s3'], held: [['hu_crossbow_c_l', 'HndL']],
    health: 50, speed: 7.5, radius: 0.85, height: 4, run: 'walk_3', runSpeed: 7, idle: 'standanim',
    attack: { range: 3, damage: 6, clips: ['all_strike_1', 'all_strike_2'], hitAt: 0.5, time: 1.1, ts: 1.2 },
    ranged: { range: 95, min: 24, damage: 20, clip: 'tec_crossbow', releaseAt: 0.9, time: 2.0, every: 4.6, projectile: 'hu_bolt', speed: 110, arc: 0.02, keep: 46 },
    staggerAt: 22, executable: 0.3, score: 2 },
  // a wall of pikes: long reach, takes a lot
  pikeman: { ...HU, name: 'Pikeman', models: ['hu_pikeman_s3'], held: [['hu_lance_c_m', 'HndR']],
    health: 130, speed: 8, radius: 0.9, height: 4.2, run: 'walk_3', runSpeed: 7, idle: 'hu_pikeman_idle_0',
    attack: { range: 5.6, damage: 15, clips: ['hu_pikeman_strike_0', 'hu_pikeman_strike_1', 'hu_pikeman_strike_2', 'hu_pikeman_strike_3'], hitAt: 0.5, time: 1.2, ts: 1.15, knock: 8 },
    staggerAt: 55, executable: 0.28, score: 2 },
  // two axes and no fear: runs in fast and keeps swinging
  berserker: { ...HU, name: 'Berserker', models: ['hu_berserker_s4'], held: [['hu_axe_berserk_c_r2', 'HR_2'], ['hu_axe_berserk_c_l2', 'HL_2']],
    health: 150, speed: 12.5, radius: 0.95, height: 4.4, scale: 1.12, run: 'walk_3', runSpeed: 7, idle: 'res_fight_standanim',
    attack: { range: 3.6, damage: 17, clips: ['res_strike_7', 'res_strike_9', 'res_strike_12', 'res_strike_14'], hitAt: 0.4, time: 0.9, ts: 1.35, knock: 12, leap: 9 },
    staggerAt: 70, executable: 0.25, score: 3 },
  killer: { ...HU, name: 'Cutthroat', models: ['hu_killer_s4'], held: [['hu_dagger', 'HndR'], ['hu_dagger', 'HndL']],
    health: 42, speed: 14, radius: 0.8, height: 4, run: 'walk_3', runSpeed: 7, idle: 'res_fight_standanim',
    attack: { range: 3.0, damage: 10, clips: ['all_strike_1', 'all_strike_2', 'hu_killer_sm_0'], hitAt: 0.35, time: 0.75, ts: 1.5, leap: 8 },
    staggerAt: 20, executable: 0.3, score: 2 },
  // the kennels' sabre-tooths: the fastest thing on the island
  sabretooth: { ...BEAST, name: 'Sabre-tooth', models: ['smilodon'], held: [], knock: 'hit_back', up: 'getting_up',
    health: 65, speed: 16, radius: 1.3, height: 3.4, scale: 1.25, run: 'walk_4', runSpeed: 9, idle: 'standanim',
    attack: { range: 3.6, damage: 13, clips: ['attack_front', 'attack_1', 'attack_2', 'attack_m'], hitAt: 0.4, time: 0.85, ts: 1.3, leap: 12 },
    staggerAt: 30, executable: 0.25, score: 2 },
  // cavalry on war boars
  boar: { ...BEAST, name: 'Boar rider', models: ['wild_boar'], held: [['hu_animal_flag_01', 'flag']], riders: [['hu_rider_a', 'Ride']], heavy: true,
    health: 380, speed: 14, radius: 1.7, height: 5, scale: 1.25, run: 'walk_3', runSpeed: 7, idle: 'standanim',
    attack: { range: 5.5, damage: 20, clips: ['attack_front', 'attack_front_s', 'attack_1', 'attack_2'], hitAt: 0.45, time: 1.1, ts: 1.1, knock: 16, leap: 10 },
    staggerAt: 160, executable: 0.2, score: 8 },
  // the woolly rhinoceros with the ballista on its back: a bolt that goes through a man and the one behind him
  rhino: { ...BEAST, name: 'Rhino ballista', models: ['woolly_rhino'], held: [['hu_animal_flag_02', 'flag'], ['hu_rhino_ballista_buildup_bottom', 'con']], riders: [['hu_rider_a', 'Ride']], heavy: true, maxAlive: 4,
    addon: { model: 'hu_rhino_ballista_buildup_top', link: 'we', clip: 'attack_front', crew: [['hu_rider_b', 'Dri1', 'rhino_ballista_loop', 'rhino_ballista_shoot']] },
    health: 1100, speed: 8, charge: 12, radius: 3.0, height: 7.5, run: 'walk_2', runSpeed: 5, idle: 'standanim',
    attack: { range: 7, damage: 28, clips: ['attack_front', 'attack_left', 'attack_right', 'attack_01'], hitAt: 0.5, time: 1.4, ts: 1.0, knock: 24, arc: 110, start: 3, lunge: 15 },
    ranged: { range: 100, min: 16, damage: 34, releaseAt: 0.8, time: 2.2, every: 6, projectile: 'hu_ballista_arrow', speed: 95, arc: 0.03, keep: 55 },
    staggerAt: 320, executable: 0.15, score: 12 },
  // the war mammoth with the log cannon: tree trunks from afar, and woe to whoever stands under its feet
  mammoth: { ...BEAST, name: 'War mammoth', models: ['mammoth'], held: [['hu_animal_flag_03', 'flag'], ['hu_mammoth_log_cannon_buildup_bottom', 'con']], heavy: true, maxAlive: 2, owned: true,
    addon: { model: 'hu_mammoth_log_cannon_buildup_top', link: 'we', clip: 'attack_front', crew: [['hu_rider_b', 'Dri1', 'standanim', 'rhino_ballista_shoot']] },
    health: 4000, speed: 7, charge: 11, radius: 4.2, height: 12, run: 'walk_2', runSpeed: 5, idle: 'standanim',
    attack: { range: 9, damage: 32, clips: ['attack_front', 'attack_1', 'attack_2'], hitAt: 0.9, time: 2.2, ts: 1.0, knock: 28, arc: 120,
      stomp: { clip: 'stomp', time: 2.4, hitAt: 1.1, radius: 13, damage: 34, knock: 28, chance: 0.5 } },
    ranged: { range: 115, min: 22, damage: 32, releaseAt: 1.0, time: 2.6, every: 7, projectile: 'hu_trunk', speed: 46, gravity: 24, keep: 0, splash: 8, stone: true },
    staggerAt: 900, executable: 0.1, score: 30 },
  // ---- bosses
  // the steam tank: iron on wheels with a cannon. Bullets do little to its front - go round it, or use rockets.
  steamtank: { faction: 'hu', name: 'Steam tank', models: ['hu_steam_tank'], held: [['hu_animal_flag_04', 'flag'], ['hu_rhino_ballista_buildup_bottom', 'we']], heavy: true, elite: true, boss: true, machine: true,
    health: 8000, speed: 8.5, charge: 15, radius: 4.6, height: 7, scale: 1.35, run: 'walk_2', runSpeed: 6, idle: 'standanim',
    attack: { range: 7.5, damage: 40, clips: ['attack_front'], hitAt: 0.5, time: 1.5, ts: 1.0, knock: 34, arc: 100, start: 5, lunge: 22, turn: 2.2 },
    ranged: { range: 110, min: 18, damage: 36, clip: 'attack_front', releaseAt: 0.5, time: 1.6, every: 4.2, projectile: 'hu_ballista_arrow', speed: 80, gravity: 14, keep: 0, splash: 7, link: 'psh3', moving: true },
    // the ballista on its roof and the man at it (the game's composite of hu_steam_tank)
    addon: { model: 'hu_rhino_ballista_buildup_top', link: 'we', clip: 'attack_front', crew: [['hu_rider_b', 'Dri1', 'hu_balista_steamtank_sitpos', 'hu_balista_steamtank_attack']] },
    die: ['trip'], knock: null, up: null, flinch: 'hit_back', taunt: 'standanim',
    staggerAt: 1500, executable: 0.06, score: 60 },
  // the Triceratops titan: the fortress on four legs
  titan: { ...BEAST, name: 'Triceratops titan', models: ['titan_triceratops'], held: [['hu_animal_flag_05', 'flag'], ['hu_titan_transporter_buildup', 'con']], heavy: true, elite: true, boss: true, armor: true, owned: true,
    health: 11500, speed: 10, charge: 18, radius: 5.2, height: 11, run: 'walk_3', runSpeed: 7, idle: 'standanim', taunt: 'titan_rage',
    attack: { range: 12, damage: 40, clips: ['attack_front', 'attack_1', 'attack_2', 'attack_3'], hitAt: 0.6, time: 1.7, ts: 1.0, knock: 34, start: 4, lunge: 19, arc: 110, turn: 2.4,
      stomp: { clip: 'pawing', time: 2.2, hitAt: 1.0, radius: 15, damage: 40, knock: 30, chance: 0.3 } },
    // its two ballistas (links con2 / con3, the game's composite of hu_triceratops): they shoot in turn while it walks
    addon: [{ model: 'hu_rhino_ballista_buildup_top', link: 'con2', clip: 'attack_front', crew: [['hu_rider_b', 'Dri1', 'hu_balista_steamtank_sitpos', 'hu_balista_steamtank_attack']] },
      { model: 'hu_rhino_ballista_buildup_top', link: 'con3', clip: 'attack_front', crew: [['hu_rider_b', 'Dri1', 'hu_balista_steamtank_sitpos', 'hu_balista_steamtank_attack']] }],
    ranged: { range: 100, min: 16, damage: 26, releaseAt: 0.5, time: 1.4, every: 2.6, projectile: 'hu_ballista_arrow', speed: 85, gravity: 14, keep: 0, splash: 5, moving: true },
    staggerAt: 1100, executable: 0.07, score: 120 },

  // ---- what the Norsemen have built (targets; towers shoot back)
  n_tower: { ...BUILT, name: 'Watchtower', models: ['hu_small_tower'], health: 1000, radius: 5, solid: 4, height: 18, fire: 1.8,
    ranged: { range: 64, damage: 7, every: 1.8, projectile: 'hu_arrow', speed: 85, link: 'Proj' } },
  n_bigtower: { ...BUILT, name: 'Stone tower', models: ['hu_large_tower'], health: 2200, radius: 6, solid: 5, height: 22, fire: 1.2,
    ranged: { range: 78, damage: 9, every: 1.6, projectile: 'hu_arrow', speed: 90, link: 'Proj' } },
  // the ballista towers: their bolts reach far - and up
  n_ballista: { ...BUILT, name: 'Ballista tower', models: ['hu_large_tower_upgrade'], health: 2600, radius: 6.5, solid: 5.5, height: 20, fire: 1.2,
    addon: { model: 'hu_large_tower_upgrade_balista', link: 'we', clip: 'attack_front' },
    ranged: { range: 135, min: 10, damage: 22, every: 3.2, projectile: 'hu_ballista_arrow', speed: 130, gravity: 6, lead: 1, link: 'Proj' } },
  n_gate: { ...BUILT, name: 'Palisade gate', models: ['hu_palisade_gate'], health: 2400, radius: 9, height: 11, fire: 2.2, wall: { half: 12.5, thick: 1.8 }, lockedNote: 'The gate holds while its towers stand' },
  n_stonegate: { ...BUILT, name: 'Gate of the pass', models: ['hu_re_enforced_wall_gate'], health: 9000, radius: 11, height: 16, fire: 0.6, wall: { half: 17, thick: 2.4 },
    armour: 0.08, lockedNote: 'Stone and iron - nothing you carry will force this gate' },
  // (the same gate in the wall of the fortress: the gunship's rockets open it)
  n_fortgate: { ...BUILT, name: 'Gate of the fortress', models: ['hu_re_enforced_wall_gate'], health: 5200, radius: 11, height: 16, fire: 0.6, wall: { half: 17, thick: 2.4 },
    lockedNote: 'The gate of the fortress - it will take more than this' },
  smithy: { ...BUILT, name: 'Weapon smithy', models: ['hu_weapons_smith'], health: 1600, radius: 9, solid: 8, height: 11, fire: 2.2 },
  kennel: { ...BUILT, name: 'Kennels', models: ['hu_kennel'], health: 1200, radius: 7, solid: 6, height: 8, fire: 2.5 },
  tavern: { ...BUILT, name: 'Mead hall', models: ['hu_tavern'], health: 1800, radius: 10, solid: 9, height: 13, fire: 2.5 },
  dragonboat: { ...BUILT, name: 'Dragon boat', models: ['hu_dragon_boat'], idle: 'standanim', health: 1300, radius: 6, solid: 0, height: 9, fire: 2.5, draft: 0.4,
    // it does not lie at anchor: it comes for whoever is on the shore, as close as the water lets it
    sail: { speed: 11, keep: 45, wake: 330, depth: 1.1, turn: 1.0, clip: 'walk_2', bow: Math.PI },
    ranged: { range: 120, min: 10, damage: 10, every: 2.2, clip: 'attack_front', projectile: 'hu_dragon_boat_arrow', speed: 110, gravity: 8, lead: 1, link: 'Proj' } },
  temple: { ...BUILT, name: 'Temple of the gate', models: ['hu_temple'], health: 4200, radius: 12, solid: 11, height: 20, fire: 1.2, lockedNote: 'The towers, the boats, the gate - the rest is work for the ground' },
  bunker: { ...BUILT, name: 'Longhouse of the guard', models: ['hu_bunker'], health: 3200, radius: 11, solid: 10, height: 12, fire: 1.6,
    ranged: { range: 70, damage: 8, every: 1.4, projectile: 'hu_arrow', speed: 85, link: 'Proj' }, lockedNote: 'The towers, the boats, the gate - the rest is work for the ground' },
};

// ---------------------------------------------------------------- what the player rides (rides.js)
const RIDES = {
  // the war mammoth of the pens: slow to turn, and nothing on the island stands in its way
  mammoth: { kind: 'beast', name: 'War mammoth', model: 'mammoth', held: [['hu_animal_flag_03', 'flag']], riders: [['seas_rider_a', 'Ride', 'ride_idle_0']],
    health: 2600, resist: 0.75, budget: { perSecond: 110, burst: 260 }, radius: 4.4, height: 12, eye: 10,
    speed: 11, charge: 19, accel: 30, turn: 2.5, run: 'walk_2', runSpeed: 5.5, idle: 'standanim', stepEvery: 7,
    camera: [0, 13, 23, 9],
    tusks: { name: 'Tusks', clips: ['attack_front', 'attack_1', 'attack_2'], time: 0.95, hitAt: 0.45, ts: 1.6, range: 9, arc: 150, damage: 260, siege: 520, knock: 34 },
    stamp: { name: 'Stamp', clip: 'stomp', time: 1.5, hitAt: 0.75, ts: 1.5, radius: 17, damage: 300, siege: 700, knock: 36, cooldown: 7 },
    ram: { name: 'Charge', damage: 900, every: 1.1 },
    trample: { reach: 1.2, damage: 60, charge: 170, knock: 26 },
    trumpet: { name: 'Trumpet', clip: 'trumpet', time: 1.6, at: 0.6, radius: 38, stun: 4, cooldown: 22 },
    sounds: { swing: '00_npc/npc_mammoth_att2.wav', roar: '00_npc/npc_mammoth_att1.wav' },
    keys: 'left button tusks, right button stamp, Shift charge, G trumpet',
    mountNote: 'The mammoth is yours: LMB tusks, RMB stamp, Shift charge, G trumpet' },
  // the SEAS helicopter: the pilot flies, the player has the guns
  gunship: { kind: 'gunship', name: 'SEAS gunship', model: 'seas_helicopter', riders: [['seas_rider_a', 'Dri1', 'standanim']],
    health: 1200, resist: 1, radius: 4.5, height: 5, eye: 2, run: 'walk_2', idle: 'standanim', clear: 15,
    camera: [0, 5.5, 25, 10],
    weapons: {
      gun: { name: 'Twin guns', kind: 'bullet', rate: 20, damage: 26, spread: 1.2, spreadAim: 1.2, range: 200, knock: 3, stagger: 0.2, pierce: 1, tracer: 0xffc070, kick: 0.015, barrelLen: 1,
        overheat: 6.5, coolDown: 2.4, sounds: ['02_battle/arm_minigun_shot1.wav', '02_battle/arm_minigun_shot2.wav'], soundEvery: 0.16, volume: 62 },
      rockets: { name: 'Rockets', projectile: 'seas_rocket', rate: 2.4, magazine: 8, regenEvery: 1.4, damage: 300, vsStructure: 1.5, radius: 11, speed: 125, reach: 280, knock: 32,
        sounds: ['02_battle/arm_rocket_shoot1.wav', '02_battle/arm_rocket_shoot2.wav'], volume: 75 },
    },
    keys: 'W A S D fly, Space up, C down, Shift faster; left button twin guns, right button rockets',
    mountNote: 'Lifting off - then she is yours: LMB twin guns, RMB rockets' },
};

const W = (every, group, total, mix, heavy) => ({ every, group, total, mix, heavy: heavy || {} });
// n defenders standing around a place at the start of an objective
function guards(at, n, types) {
  const out = [];
  for (let k = 0; k < n; k++) { const a = k * 2.399963, r = 8 + 4.2 * Math.sqrt(k) * 2.2; out.push({ type: types[k % types.length], pos: [at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r] }); }
  return out;
}
// the gunship's course round the fortress: [x, z, height]
// The flight: it lifts off towards the cape, then the player flies it himself inside `area` (a fence of the
// districts' energy wall, from the lake to the open sea north of the cape); when the targets are gone the pilot
// takes it in to `home`, the yard of the fortress.
const FLIGHT = {
  speed: 27,
  out: [[168, -268, 92]],
  free: { area: [[262, -150], [330, -400], [290, -620], [120, -690], [-170, -690], [-345, -600], [-385, -430], [-300, -290], [-140, -236], [40, -150]],
    ceiling: 150, floor: 11, climb: 15, boost: 1.55, agility: 2.2, note: 'No further: the gunship stays over the cape' },
  home: [[-30, -414, 57.2]],
};

export const FROST = {
  id: 'frost', title: 'Iron Winter',
  blurb: 'A northern island of the game\'s own making, held by the Norsemen: land on the beach, take the village and the war mammoths, break the wall of the pass, climb into the snow - and storm the fortress of the rune gate from the air.',
  map: 'gen:frost',
  note: 'a map of the game\'s own making - needs nothing but the game',
  faction: 'hu', enemies: NORSE, enemyName: 'Norsemen', music: 'Hu', rides: RIDES,
  look: { sky: 0xb9c9d6, fogNear: 240, fogFar: 1050, sun: 2.1, sunColor: 0xfff4e0, sunDir: [0.5, 0.7, 0.45], hemi: 1.35, hemiSky: 0xdfe9f2, hemiGround: 0x6f6a60 },
  // snow from the pass upwards (weather.js: by the height of the ground under the camera)
  weather: { snow: { from: 30, full: 52, count: 1600 } },
  // the mountains are the edge of the field: too steep to walk up (and one slides off them)
  // mountains are the border: no walking up steep ground, and never further than 10 m from ground one can walk on
  physics: { maxSlope: 0.95, leash: 10 },
  // nobody jumps down ledges here: what one cannot walk back up is not part of the field (the city's 6 m would
  // make every mountainside above a shore a one-way street)
  nav: { drop: 1.1 },
  allies: { count: 12 },
  swarm: { max: 130, spawnMin: 55, spawnMax: 115, corpseTime: 8, separation: 1.9, attackSlots: 7 },

  zones: {
    list: [
      { id: 'beach', name: 'the beach', seed: null },
      { id: 'village', name: 'the village', seed: [-4, 200] },
      { id: 'pens', name: 'the mammoth pens', seed: [262, 190] },
      { id: 'pass', name: 'the pass', seed: [-116, -30] },
      { id: 'lake', name: 'the frozen lake', seed: [130, -215] },
      { id: 'fort', name: 'the fortress', seed: [-48, -416] },
    ],
    cuts: [
      [-150, 284, 160, 284],               // the palisade
      [150, 100, 150, 220],                // the lane to the pens
      [-110, 60, 44, 60],                  // the wall of the pass
      [16, -196, 74, -96],                 // the head of the pass | the lake
      [-44, -308, 92, -308],               // the wall of the fortress
    ],
    rubble: [], gateRange: 13, wallHeight: 18, wallColor: 0x66ccff, wallNear: 34,
    note: 'The Norsemen still hold what lies beyond - finish the objective first',
  },

  mission: {
    reserved: /^(hu_small_tower|hu_large_tower|hu_large_tower_upgrade|hu_palisade_gate|hu_re_enforced_wall_gate|hu_weapons_smith|hu_kennel|hu_tavern|hu_dragon_boat|hu_temple|hu_bunker)$/,
    // (the gate of the fortress is the pass's gate once more: the map calls it fort_wall_gate to tell the two apart)
    gfx: { fort_wall_gate: 'hu_re_enforced_wall_gate' },
    garrison: [{ type: 'n_tower', map: true }, { type: 'n_bigtower', map: true }, { type: 'n_ballista', map: true }, { type: 'n_gate', map: true, locked: true },
      { type: 'n_stonegate', map: true, locked: true, cls: /^hu_re_enforced_wall_gate$/ }, { type: 'n_fortgate', map: true, locked: true, cls: /^fort_wall_gate$/ },
      { type: 'smithy', map: true }, { type: 'kennel', map: true }, { type: 'tavern', map: true }, { type: 'dragonboat', map: true }, { type: 'temple', map: true, locked: true }, { type: 'bunker', map: true, locked: true }],
    title: 'Iron Winter', won: 'The rune gate is ours', lost: 'The Norsemen hold their island',
    intro: 'The hovercraft are on the beach of a northern island. Somewhere above, behind a pass and a wall of ice, the Norsemen keep a gate of runes that the SEAS mean to have. Take the village, take their war mammoths - you will need one for the wall of the pass - and climb. The helicopter will be waiting at the frozen lake.',
    start: { x: 4, z: 408, yaw: 0 },
    // the war mammoth stands in its pen from the start
    parked: [{ ride: 'mammoth', pos: P.pens, yaw: 80 }],
    objectives: [
      // ---------------------------------------------------------------- the beach
      { type: 'kill', zone: 'beach', text: 'Clear the beach', pos: [0, 372], radius: 50, count: 30, troops: 8, rally: [0, 414],
        waves: W(4, 9, 55, { swordsman: 5, javelin: 3, bowman: 2 }) },
      { type: 'destroy', text: 'Bring down the watchtowers on the shore and sink the dragon boat in the bay', pos: [2, 334], radius: 70,
        targets: [{ type: 'n_tower', near: [2, 334], within: 75 }, { type: 'dragonboat', zone: 'beach' }],
        waves: W(5, 9, 9999, { swordsman: 5, javelin: 3, bowman: 2, killer: 1 }) },
      { type: 'destroy', text: 'Break the palisade: its towers, then the gate', pos: P.palisade, radius: 60, targets: [{ type: 'n_tower', near: [4, 300], within: 45 }, { type: 'n_gate', near: P.palisade, within: 30, any: true }],
        waves: W(4.5, 10, 9999, { swordsman: 5, javelin: 3, bowman: 3, killer: 1 }) },
      // ---------------------------------------------------------------- the village
      { type: 'reach', zone: 'village', text: 'Into the village', pos: [-4, 200], radius: 14, troops: 6, rally: [2, 300], arrive: 'enforcer',
        waves: W(4.5, 10, 60, { swordsman: 4, javelin: 2, bowman: 2, pikeman: 2, sabretooth: 2 }) },
      { type: 'destroy', text: 'Burn the smithy, the kennels and the mead hall, and pull down the towers', pos: P.village, radius: 100,
        targets: [{ type: 'smithy', zone: 'village' }, { type: 'kennel', zone: 'village' }, { type: 'tavern', zone: 'village' }, { type: 'n_bigtower', zone: 'village' }],
        waves: W(3.6, 11, 9999, { swordsman: 4, javelin: 2, bowman: 2, pikeman: 2, sabretooth: 3, berserker: 1, killer: 1 }) },
      { type: 'hold', text: 'Hold the village square against the counterattack', pos: [-4, 190], radius: 30, seconds: 50,
        waves: W(3.2, 12, 9999, { swordsman: 4, javelin: 2, crossbow: 2, pikeman: 2, berserker: 2, sabretooth: 2, boar: 1 }, { rhino: 0.2 }) },
      // ---------------------------------------------------------------- the pens and the wall of the pass
      // (checkpoint 1: the village is taken)
      { type: 'reach', zone: 'pens', text: 'The gate of the pass will not yield to guns: take a war mammoth from the pens', pos: P.pens, radius: 11, checkpoint: { at: [60, 180] },
        waves: W(4.5, 10, 70, { swordsman: 4, javelin: 2, bowman: 2, pikeman: 2, boar: 1 }) },
      { type: 'destroy', ride: 'mammoth', text: 'On the mammoth: break the ballista towers and the gate of the pass', pos: P.passGate, radius: 60,
        targets: [{ type: 'n_ballista', near: P.passGate, within: 60 }, { type: 'n_stonegate', near: P.passGate, within: 30, any: true }],
        waves: W(3.2, 12, 9999, { swordsman: 5, javelin: 2, bowman: 2, pikeman: 3, berserker: 2, killer: 1, boar: 1 }, { rhino: 0.15 }) },
      // ---------------------------------------------------------------- the pass
      { type: 'reach', zone: 'pass', text: 'Up the pass', pos: [-104, -4], radius: 12, rideLeft: 'The mammoth has done its work - on foot again', troops: 8, rally: [-20, 100],
        waves: W(4.2, 10, 70, { swordsman: 4, javelin: 2, crossbow: 2, pikeman: 2, killer: 2 }) },
      { type: 'kill', text: 'Break the ambush at the old ruins', pos: P.ambush, radius: 40, count: 55,
        waves: W(3, 13, 120, { swordsman: 4, javelin: 2, crossbow: 3, pikeman: 2, berserker: 3, killer: 2, sabretooth: 2 }, { rhino: 0.12 }) },
      { type: 'destroy', text: 'Pull down the watchtowers of the pass', pos: [-30, -112], radius: 80, targets: [{ type: 'n_tower', zone: 'pass' }],
        waves: W(3.8, 11, 9999, { swordsman: 4, javelin: 2, crossbow: 2, pikeman: 2, berserker: 2, sabretooth: 3 }) },
      // ---------------------------------------------------------------- the frozen lake
      { type: 'reach', zone: 'lake', text: 'On to the frozen lake', pos: [104, -190], radius: 14,
        waves: W(4.5, 10, 50, { swordsman: 4, javelin: 2, crossbow: 2, berserker: 2 }) },
      { type: 'boss', text: 'Destroy the steam tank', pos: P.lake, radius: 70, bosses: ['steamtank'], troops: 6,
        waves: W(5, 9, 9999, { swordsman: 4, javelin: 2, crossbow: 2, berserker: 1 }) },
      { type: 'hold', text: 'Hold the landing zone until the helicopter is down', pos: [150, -236], radius: 28, seconds: 45,
        arrives: { ride: 'gunship', from: [420, -60, 150], at: [150, -236, 60], lead: 13 },
        waves: W(3, 13, 9999, { swordsman: 4, javelin: 2, crossbow: 2, pikeman: 2, berserker: 3, killer: 2, sabretooth: 2, boar: 1 }, { mammoth: 0.12 }) },
      // ---------------------------------------------------------------- the fortress, from the air
      // (checkpoint 2: the helicopter has come)
      { type: 'destroy', zone: 'fort', ride: 'gunship', rideAt: [150, -236, 60], flight: FLIGHT, checkpoint: { at: [146, -232] },
        text: 'From the air: destroy the ballista towers, the dragon boats and the gate of the fortress', pos: P.fortress, radius: 120,
        targets: [{ type: 'n_ballista', zone: 'fort' }, { type: 'dragonboat', zone: 'fort' }, { type: 'n_fortgate', near: P.fortGate, within: 30, any: true }],
        guards: guards(P.fortress, 26, ['swordsman', 'pikeman', 'javelin', 'bowman', 'crossbow', 'berserker']),
        waves: W(5, 10, 80, { swordsman: 4, javelin: 2, bowman: 2, pikeman: 2, berserker: 1 }) },
      { type: 'destroy', text: 'Tear down the temple and the longhouse of the guard', pos: P.fortress, radius: 80, rideLeft: 'Down in the fortress - on foot again', troops: 10, rally: P.fortGate,
        targets: [{ type: 'temple', zone: 'fort' }, { type: 'bunker', zone: 'fort' }],
        waves: W(3.2, 12, 9999, { swordsman: 4, javelin: 2, crossbow: 2, pikeman: 3, berserker: 3, killer: 2 }, { rhino: 0.1 }) },
      { type: 'boss', text: 'Bring down the Triceratops titan', pos: [-48, -410], radius: 70, bosses: ['titan'], troops: 8, rally: P.fortGate,
        waves: W(4.5, 10, 9999, { swordsman: 4, javelin: 2, crossbow: 2, pikeman: 2, berserker: 2 }) },
      { type: 'hold', text: 'Hold the rune gate while the engineers make it ours', pos: [-52, -436], radius: 30, seconds: 60,
        waves: W(2.8, 14, 9999, { swordsman: 4, javelin: 2, crossbow: 2, pikeman: 3, berserker: 3, killer: 2, sabretooth: 3, boar: 1 }, { rhino: 0.12, mammoth: 0.1 }) },
    ],
  },
};
