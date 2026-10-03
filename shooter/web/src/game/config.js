// Everything that can be tuned without touching the game logic.
//
// Units: the models and maps of ParaWorld use their own unit ("u"): a soldier is about 4 u tall, a city wall 12 u,
// units walk 5 u/s and run 7 u/s in the original game. All distances below are in u, times in seconds, angles in
// degrees unless a comment says otherwise.
export const CFG = {
  map: 'data/maps/Base/Cpn_single_001/single_05.ula',     // campaign mission 5, "The Holy City"

  look: {
    sky: 0xa9c4d6, fogNear: 260, fogFar: 950,
    sun: 2.4, sunColor: 0xfff0d2, sunDir: [0.45, 0.8, -0.35],
    hemi: 1.2, hemiSky: 0xe6eef2, hemiGround: 0x6a5a3c,
  },
  quality: {
    low: { shadow: 0, shadowRange: 0, pixelRatio: 1 },
    medium: { shadow: 2048, shadowRange: 90, pixelRatio: 1 },
    high: { shadow: 4096, shadowRange: 120, pixelRatio: 2 },
  },

  collision: {
    cell: 2,                    // size of the look-up grid columns
    minFootprint: 2.0,          // scenery smaller than this (chairs, pots, lanterns) can be walked through
    trunkRadius: 0.35,          // trees collide as a thin trunk
    // never solid, whatever their size
    ignore: /clothesline|fishnet|lawn_strip|flower|grass|shrub|debris|waterfall|river|sav_water|chair|table|sleeper/,
  },
  // radius: half the width the paths are made for; wideCells: how many cells the big dinosaurs keep from walls;
  // meshNy: steepest built surface walked on (0.62 cut the whole east quarter off: its ramps are steeper)
  // bigRadius: bodies wider than this use the wide paths; maxBody: widest body tested against walls (a dinosaur
  // brushing through a lantern is better than one wedged in a street)
  nav: { cell: 2, step: 1.1, drop: 6, height: 3.6, meshNy: 0.5, radius: 0.8, wideCells: 1, bigRadius: 2.5, maxBody: 1.7 },

  camera: {
    fov: 70, fovSprint: 78, fovAim: 48,
    sensitivity: 0.0022,        // radians per pixel of mouse movement
    pitchMin: -70, pitchMax: 75,
  },

  physics: { gravity: 46, airControl: 0.35, groundAccel: 95, friction: 14, stepHeight: 1.1 },

  // ---------------------------------------------------------------- the two player characters
  // model: the body. clipsFrom: other models (same skeleton) whose animation clips are added.
  // upperRoot: the bone where the upper body starts; spine: bones the aim twist is spread over.
  // camera: third-person offset [right, up, back] from the feet, eye = first-person eye height.
  // dash: {speed, time, cooldown}; no damage is taken while dashing. ram: enemies touched during the dash are hit.
  classes: {
    gunner: {
      name: 'Gunner', model: 'seas_gunner_s4',
      clipsFrom: { seas_flamethrower_s2: ['seas_flamethrower_0'], seas_rocketman_s2: ['seas_rocketman_0'], hu_jetpack_warrior_s2: ['sm_jump_01', 'res_sm_jump', 'res_sm_kick', 'res_strike_3'] },
      upperRoot: 'bone_7abd585e', spine: ['bone_7abd585e', 'bone_f9c938e3', 'bone_e5a68e8c'],
      radius: 0.85, height: 4.1, eye: 3.55,
      camera: [1.5, 4.6, 8.2],
      speed: 10.5, sprint: 15, runClip: 'walk_3_new', runClipSpeed: 7, idleClip: 'tec_fightpos_standanim',
      health: 100, armor: 3, armorPip: 35,
      jump: 17,
      jet: { charges: 2, recharge: 5, up: 21, forward: 34, boost: 0.45, clip: 'sm_jump_01', slamRadius: 9, slamDamage: 90 },
      dash: { speed: 30, time: 0.22, cooldown: 0.9 },
      backpack: 'hu_steam_jet_pack_off',
      melee: { clip: 'tec_melee', hitAt: 0.42, time: 0.85, range: 4.6, arc: 110, damage: 70, knock: 14, model: 'seas_dagger' },
      weapons: ['mg', 'flamer', 'rocket'],
      aimFov: 48, aimSpeed: 0.65, aimSens: 0.6,           // right mouse button: zoom, walking speed, mouse speed
      fpGun: [-0.42, 0.52, 0.55],                         // first person: the eye relative to the gun's grip [right, up, back]
      death: 'dying', hurt: 'hit_reaction',
      steps: ['04_step/step_unit1.wav', '04_step/step_unit2.wav', '04_step/step_unit3.wav', '04_step/step_unit4.wav'], stepEvery: 5.2,
      voice: 'seas_gunner',
    },
    executioner: {
      name: 'Executioner MKII', model: 'seas_lumberjack_minigun',
      clipsFrom: {},
      upperRoot: 'bone_e5a68e8c', spine: ['bone_e5a68e8c', 'bone_e31beb93'],     // torso, gun-arm shoulder
      barrel: ['bone_765f52ce', 'bone_de76a4c9'],         // the minigun points from the elbow to the hand
      radius: 1.9, height: 9.2, eye: 8.3,
      fpBody: true, fpForward: 1.3, fpHead: ['bone_05069e98', -0.2],   // first person: the suit stays visible, the eye rides on the head bone (+ height)
      fpArms: { bones: ['bone_e31beb93', 'bone_3eec9867'], raise: 46, inward: 24 },   // ... and are raised and turned into view (shoulders, degrees)
      // no weapon switching: left button = claws; holding the right button aims the minigun, left button then fires
      aimToShoot: true, aimFov: 56, aimSpeed: 0.8, aimSens: 0.8,
      camera: [3.2, 9.6, 15.5],
      speed: 9.5, sprint: 13.5, runClip: 'walk_3', runClipSpeed: 7, idleClip: 'standanim',
      health: 220, armor: 4, armorPip: 45,
      jump: 15,
      jet: { charges: 2, recharge: 6, up: 20, forward: 32, boost: 0.5, clip: null, slamRadius: 14, slamDamage: 160 },
      // destroyed: the suit folds down (death clip), then its reactor goes up - enemies only, never the player
      deathBlast: { radius: 24, damage: 1200, knock: 36 },
      // the dash is a ram: a full second (27 u, more than four times the Gunner's), and whoever is in the way is hit once and thrown aside
      dash: { speed: 27, time: 1.0, cooldown: 2.0, ram: { damage: 130, knock: 26, reach: 1.4 } },
      backpack: null,
      melee: null,
      weapons: ['claws', 'minigun'],
      death: 'dying', hurt: 'hit_reaction',
      steps: ['04_step/step_med_robot1.wav', '04_step/step_med_robot2.wav', '04_step/step_med_robot3.wav', '04_step/step_med_robot4.wav'], stepEvery: 7.5,
      voice: 'seas_lumberjack',
    },
  },
  swapCooldown: 2.5,

  // ---------------------------------------------------------------- weapons
  // kind 'bullet': instant hit along the aim ray     kind 'flame': cone that sets things on fire
  // kind 'rocket': flying projectile that explodes   kind 'melee': swing in an arc in front
  // rate = shots per second; spread in degrees; clip = upper-body animation while firing (loop part "#l" if it has one)
  // barrel: the direction the weapon model shoots in, in its own frame (the upper body is turned until that points
  // where the player aims); barrelLen: from the grip to the muzzle
  weapons: {
    mg: {
      name: 'Machine gun', kind: 'bullet', model: 'seas_gun', hand: 'HndR', barrel: [-0.89, -0.09, 0.46], barrelLen: 2.5,
      rate: 13, damage: 17, spread: 1.1, spreadAim: 0.35, range: 260, magazine: 90, reload: 1.5, knock: 1.5, stagger: 0.12,
      clip: 'seas_gunner_0', tracer: 0xffd27a, kick: 0.05,
      sounds: ['02_battle/arm_gatling_gun_shot1.wav', '02_battle/arm_gatling_gun_shot2.wav', '02_battle/arm_gatling_gun_shot3.wav', '02_battle/arm_gatling_gun_shot4.wav'], volume: 55,
    },
    flamer: {
      name: 'Flamethrower', kind: 'flame', model: 'seas_flamer', hand: 'HndR', barrel: [0, 0, 1], barrelLen: 2.6,
      rate: 30, damage: 4, range: 24, cone: 16, fuel: 100, drain: 22, regen: 16, regenDelay: 1.0, burn: 3.0, burnDps: 22,
      clip: 'seas_flamethrower_0', kick: 0.008,
      sounds: ['02_battle/arm_flamethrower_shot1.wav'], soundEvery: 0.55, volume: 60,
    },
    rocket: {
      name: 'Rocket launcher', kind: 'rocket', model: 'seas_rpg', hand: 'HndR', projectile: 'seas_rocket', barrel: [-0.85, 0.51, 0.15], barrelLen: 1.2, fpGun: [-0.7, 0.75, 0.4],
      rate: 1.25, damage: 260, radius: 11, speed: 95, magazine: 6, regenEvery: 2.2, knock: 34,
      clip: 'seas_rocketman_0', clipAt: 0.95, kick: 0.5,
      sounds: ['02_battle/arm_rocket_shoot1.wav', '02_battle/arm_rocket_shoot2.wav'], volume: 80,
    },
    claws: {
      name: 'Claws', kind: 'melee',
      // a combo: each entry is one swing; the last one is the heavy finisher. All take the same time, so holding or
      // tapping the button swings without a pause (a click during a swing is remembered: `buffer` seconds)
      combo: [
        { clip: 'attack_front_s_0', time: 0.62, hitAt: 0.3, ts: 2.0, range: 9.5, arc: 150, damage: 110, knock: 20 },
        { clip: 'attack_front_s_2', time: 0.62, hitAt: 0.3, ts: 2.0, range: 9.5, arc: 150, damage: 120, knock: 22 },
        // (`attack_front` is not a claw swing at all - the arms hardly move. s_3 is the big one: its wind-up is skipped
        // with `at`, the claws come down 0.8 s of clip later)
        { clip: 'attack_front_s_3', at: 0.5, time: 0.64, hitAt: 0.34, ts: 2.3, range: 11, arc: 200, damage: 190, knock: 36, slam: true },
      ],
      comboWindow: 0.55, lunge: 16, buffer: 0.45,
      sounds: ['08_machines/huge_robot_attack1.wav'], volume: 85,
    },
    minigun: {
      name: 'Minigun', kind: 'bullet',
      rate: 18, damage: 30, spread: 1.6, spreadAim: 0.7, range: 280, magazine: 200, reload: 2.2, knock: 3, stagger: 0.2, pierce: 1, spinUp: 0.35,
      clip: 'attack_front_m_0', tracer: 0xffb060, kick: 0.07, barrelLen: 2.0,
      sounds: ['02_battle/arm_minigun_shot1.wav', '02_battle/arm_minigun_shot2.wav'], soundEvery: 0.16, volume: 70,
    },
  },
  execute: { range: 7, time: 0.9, armor: 1, heal: 6, invulnerable: 1.1 },
  headshot: 1.8,

  // ---------------------------------------------------------------- the Dustriders
  // models: one is picked at random. held: [model, link] things in the hands. scale: drawn bigger than the model is.
  // riders: [model, link] people sitting on the animal (they play ride_idle_0 / ride_attack_front).
  // attack: melee {range, damage, clips, hitAt (s into the clip), time; back: it strikes with the tail - turns its
  // back to the player to do so}; ranged adds {projectile, speed, range, arc}
  // stagger: damage taken at once that makes it flinch; executable: below this health share it stands dazed
  enemies: {
    warrior: {
      name: 'Warrior', models: ['aje_warrior_s2', 'aje_warrior_s3', 'aje_warrior_s4'], held: [['aje_sword_b', 'HndR'], ['aje_buckler_b', 'Shld']],
      health: 70, speed: 9.5, radius: 0.85, height: 4, run: 'walk_3', runSpeed: 7, idle: 'res_fight_standanim',
      attack: { range: 3.1, damage: 9, clips: ['res_strike_0', 'res_strike_1', 'res_strike_3', 'res_strike_5'], hitAt: 0.45, time: 1.0, ts: 1.25 },
      die: ['dying', 'die_simple'], knock: 'hit_back', up: 'getting_up', flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 30, executable: 0.3, score: 1,
    },
    spearman: {
      name: 'Spearman', models: ['aje_spearman_s1', 'aje_spearman_s2', 'aje_spearman_s3'], held: [['aje_spear_a_l', 'HndR']],
      health: 55, speed: 8.5, radius: 0.85, height: 4, run: 'walk_3', runSpeed: 7, idle: 'nat_fight_standanim',
      attack: { range: 4.2, damage: 11, clips: ['nat_strike_0', 'nat_strike_1', 'nat_strike_4'], hitAt: 0.45, time: 1.05, ts: 1.2 },
      ranged: { range: 46, min: 12, damage: 12, clip: 'nat_throw', releaseAt: 0.75, time: 1.5, every: 3.2, projectile: 'aje_spear_a_arrow', speed: 46, arc: 0.12 },
      die: ['dying', 'die_simple'], knock: 'hit_back', up: 'getting_up', flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 26, executable: 0.3, score: 1,
    },
    archer: {
      name: 'Archer', models: ['aje_archer_s1', 'aje_archer_s2', 'aje_archer_s3'], held: [['aje_bow_b_l', 'HndL']],
      health: 40, speed: 8, radius: 0.85, height: 4, run: 'walk_3', runSpeed: 7, idle: 'standanim',
      attack: { range: 3, damage: 6, clips: ['all_strike_1', 'all_strike_2'], hitAt: 0.5, time: 1.1, ts: 1.2 },
      ranged: { range: 75, min: 22, damage: 9, clip: 'bow_1', releaseAt: 1.0, time: 1.9, every: 2.6, projectile: 'aje_arrow', speed: 70, arc: 0.06, keep: 34 },
      die: ['dying', 'die_simple'], knock: 'hit_back', up: 'getting_up', flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 20, executable: 0.3, score: 1,
    },
    raptor: {
      name: 'Raptor', models: ['velociraptor'], held: [],
      health: 60, speed: 15.5, radius: 1.3, height: 3.6, scale: 1.5, run: 'walk_3', runSpeed: 7, idle: 'standanim', animal: true,
      attack: { range: 3.6, damage: 12, clips: ['attack_0', 'attack_1', 'attack_2'], hitAt: 0.4, time: 0.85, ts: 1.3, leap: 12 },
      die: ['dying'], knock: 'hit_back', up: 'getting_up', flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 30, executable: 0.25, score: 2,
    },
    assassin: {
      // fast and frail: is on you before the others
      name: 'Assassin', models: ['aje_assassin_s3', 'aje_assassin_s4', 'aje_assassin_s5'], held: [['aje_poison_dagger_c', 'HndR'], ['aje_dagger', 'HndL']],
      health: 42, speed: 14, radius: 0.8, height: 4, run: 'walk_3', runSpeed: 7, idle: 'tec_fightpos_standanim',
      attack: { range: 3.0, damage: 10, clips: ['all_strike_1', 'all_strike_2', 'aje_assassin_sm_0'], hitAt: 0.35, time: 0.75, ts: 1.5, leap: 8 },
      die: ['dying', 'die_simple'], knock: 'hit_back', up: 'getting_up', flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 20, executable: 0.3, score: 2,
    },
    rammer: {
      // a brute with a club: slow, takes a lot, hits hard and shoves
      name: 'Rammer', models: ['aje_rammer_s3', 'aje_rammer_s4', 'aje_rammer_s5'], held: [['aje_club_3', 'HndR']],
      health: 230, speed: 8, radius: 1.15, height: 5, scale: 1.25, run: 'walk_3', runSpeed: 7, idle: 'res_fight_standanim',
      attack: { range: 4.0, damage: 22, clips: ['res_strike_7', 'res_strike_9', 'res_strike_12', 'aje_rammer_sm_0'], hitAt: 0.5, time: 1.2, ts: 1.1, knock: 16 },
      die: ['dying'], knock: 'hit_back', up: 'getting_up', flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 90, executable: 0.25, score: 4,
    },
    thrower: {
      // lobs fire bottles in a high arc: keep moving
      name: 'Fire thrower', models: ['aje_thrower_s2', 'aje_thrower_s3', 'aje_thrower_s4'], held: [['aje_molotov_c_l', 'HndR']],
      health: 45, speed: 8, radius: 0.85, height: 4, run: 'walk_3', runSpeed: 7, idle: 'tec_fightpos_standanim',
      attack: { range: 3, damage: 6, clips: ['all_strike_1', 'all_strike_2'], hitAt: 0.5, time: 1.1, ts: 1.2 },
      ranged: { range: 44, min: 14, damage: 16, clip: 'tec_sm_cocktail', releaseAt: 0.8, time: 1.7, every: 4.2, projectile: 'aje_molotov', speed: 30, arc: 0.3, keep: 26, splash: 5.5 },
      die: ['dying', 'die_simple'], knock: 'hit_back', up: 'getting_up', flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 20, executable: 0.3, score: 2,
    },
    dilo: {
      // light cavalry: a rider on a dilophosaurus
      name: 'Dilophosaurus rider', models: ['dilophosaurus'], held: [['aje_animal_flag_01', 'flag']], riders: [['aje_rider_a', 'Ride']],
      health: 380, speed: 14, radius: 1.7, height: 5.5, run: 'walk_3', runSpeed: 7, idle: 'standanim', animal: true, heavy: true,
      attack: { range: 5.5, damage: 20, clips: ['attack_front', 'attack_1', 'attack_2'], hitAt: 0.45, time: 1.1, ts: 1.1, knock: 14, leap: 10 },
      die: ['dying'], knock: null, up: null, flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 160, executable: 0.2, score: 8,
    },
    stego: {
      // the Dustriders' armoured beast: it turns its back on you and strikes with the spiked tail
      name: 'Stegosaurus rider', models: ['stegosaurus'], held: [['aje_animal_flag_02', 'flag']], riders: [['aje_rider_a', 'Ride']],
      health: 1300, speed: 9.5, radius: 3.2, height: 7, run: 'walk_3', runSpeed: 7, idle: 'standanim', animal: true, heavy: true,
      attack: { range: 8, damage: 30, clips: ['attack_back', 'attack_back_left', 'attack_back_right', 'sm_attack_back'], hitAt: 0.55, time: 1.5, ts: 1.0, knock: 30, back: true },
      die: ['dying'], knock: null, up: null, flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 350, executable: 0.12, score: 15,
    },
    allosaurus: {
      // the Dustriders' war beast (aje_allosaurus): the animal with its rider and banner, not the wild one
      name: 'Allosaurus rider', models: ['allosaurus'], held: [['aje_animal_flag_03', 'flag']], riders: [['aje_rider_b', 'Ride']],
      health: 2400, speed: 11, radius: 3.4, height: 9, run: 'walk_3', runSpeed: 7, idle: 'standanim', animal: true, elite: true, heavy: true,
      attack: { range: 8.5, damage: 34, clips: ['attack_front', 'attack_front_s'], hitAt: 0.55, time: 1.5, ts: 1.0, knock: 26 },
      die: ['dying'], knock: null, up: null, flinch: 'hit_front', taunt: 'roaring',
      staggerAt: 400, executable: 0.12, score: 25,
    },
    trex: {
      // the T-Rex titan (aje_trex): three riders and the banner
      name: 'T-Rex titan', models: ['trex'], held: [['aje_animal_flag_05', 'flag']], riders: [['aje_rider_b', 'Ride'], ['aje_rider_a', 'Rid2'], ['aje_rider_a', 'Rid3']],
      health: 9000, speed: 10, radius: 4.6, height: 13, run: 'walk_3', runSpeed: 7, idle: 'standanim', animal: true, elite: true, heavy: true, boss: true,
      attack: { range: 11, damage: 48, clips: ['attack_front', 'attack_2', 'attack_3'], hitAt: 0.6, time: 1.7, ts: 1.0, knock: 34 },
      die: ['dying'], knock: null, up: null, flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 900, executable: 0.08, score: 100,
    },
    // ---- things to destroy (objective type "destroy"): they stand still and only take damage.
    // solid: radius the player cannot walk into; fire: how much more the flamethrower does to them
    tent: { name: 'War tent', structure: true, models: ['aje_tent'], held: [], health: 900, radius: 7, solid: 6, height: 9, fire: 2.5, heavy: true, score: 0 },
    bigtent: { name: 'Chieftain\'s tent', structure: true, models: ['aje_big_tent'], held: [], health: 1500, radius: 7, solid: 6, height: 10, fire: 2.5, heavy: true, score: 0 },
    totem: { name: 'Skull totem', structure: true, models: ['aje_skull_protector'], held: [], health: 800, radius: 5, solid: 4, height: 14, fire: 1.5, heavy: true, score: 0 },
    canoe: { name: 'War canoe', structure: true, models: ['aje_catamaran'], held: [], health: 1100, radius: 6, solid: 0, height: 8, fire: 2.5, heavy: true, score: 0 },
  },
  swarm: {
    max: 150,                   // enemies alive at the same time
    spawnMin: 55, spawnMax: 120, // spawn this far (walking distance) from the player, out of sight if possible
    corpseTime: 9,              // seconds a body stays
    separation: 1.9,            // how strongly they keep apart
    attackSlots: 7,             // how many may strike the player at the same time (the rest circle)
  },

  // ---------------------------------------------------------------- the districts of the city (zones.js)
  // list: in the order they open; seed = a point on a street inside. cuts: lines across the streets where a zone
  // ends [x1, z1, x2, z2]; 'P' = the edge of the playing field, never opens. Where a cut crosses a street, rubble is
  // heaped up (and the map's own barricades within gateRange of the line are taken over); it is blown away when the
  // zones on both sides are open. tests/zones.js draws the map and reports zones that are not separated.
  zones: {
    list: [
      { id: 'outskirts', name: 'the camp before the walls', seed: [-43, -262] },
      { id: 'gate', name: 'the gate square', seed: [-43, -222] },
      { id: 'harbour', name: 'the harbour', seed: [60, -215] },
      { id: 'lower', name: 'the lower city', seed: [-180, -170] },
      { id: 'midwest', name: 'the western terrace', seed: [-150, -80] },
      { id: 'arch', name: 'the triumphal arch', seed: [-43, -60] },
      { id: 'east', name: 'the eastern quarter', seed: [120, 20] },
      { id: 'plaza', name: 'the fountain plaza', seed: [-30, 40] },
      { id: 'temple', name: 'the temple forecourt', seed: [-37, 96] },
    ],
    cuts: [
      [-56, -246, -30, -246, 'D'],       // the city gate ('D': a door - shut for the Dustriders too, no rubble)
      [-162, -430, -162, -236, 'P'],     // the plain: west, east, north
      [105, -430, 105, -240, 'P'],
      [-162, -345, 105, -345, 'P'],
      [-66, -246, -66, -196],            // gate square: west, south
      [-66, -196, -22, -186],
      [-8, -246, -8, -120],              // harbour | gate square and lower city
      [-60, -104, -26, -104],            // the main avenue's ramp up to the arch
      [-190, -118, -160, -118],          // the west ramp
      [-290, -128, -225, -128],          // the far west ramp
      [-64, -104, -64, -46],             // western terrace | arch
      [62, -80, 92, -40],                // arch | eastern quarter (north entrance)
      [0, 22, 58, 78],                   // arch | the diagonal street down from the plaza
      [48, 90, 70, 68],                  // that street | eastern quarter (south entrance)
      [-75, -12, 5, -12],                // arch | fountain plaza
      [-100, 86, 20, 86],                // the temple steps
      [-340, -238, -135, -238, 'P'],     // gaps in the city wall
      [105, -248, 250, -248, 'P'],       // the shore east of the harbour
    ],
    door: { model: 'hc_gate', closed: /_f\w*(0200|0c00)$/ },   // the gate building and which of its meshes are the shut doors
    rubble: ['hc_barricade_01', 'hc_barricade_02', 'hc_barricade_03', 'hc_barricade_04'],
    gateRange: 13,                       // the map's barricades this close to a cut belong to it
    wallHeight: 18, wallColor: 0x66ccff, wallNear: 34,   // the energy wall: height, colour, visible within (u)
  },

  // ---------------------------------------------------------------- the mission
  // start: where the player stands at the beginning (yaw: 0 = facing north, 180 = south)
  // objectives, in order (mission.js):
  //   reach    walk into the circle (pos, radius)
  //   kill     kill `count` enemies
  //   hold     stay in the circle (pos, radius) for `seconds`
  //   destroy  destroy the `targets` [{type: a structure of `enemies`, pos, yaw}, or {type, map: true} = the map's own]
  //   boss     kill the `bosses` (they appear at `at[i]`, or at pos)
  // zone: the district that opens when the objective starts (zones.list). pos / radius: where the marker points
  // and, for hold / reach, the circle. waves: what attacks meanwhile - every `every` seconds a group of `group`
  // enemies of the mixed types, until `total` have come.
  mission: {
    // models that only ever stand as targets: the map's own ones are not placed as scenery (level.mapTargets);
    // an objective takes them over with {type, map: true}
    reserved: /^aje_(tent|big_tent|catamaran|skull_protector)$/,
    title: 'The Holy City',
    intro: 'The Dustriders hold the Holy City. Burn their camp before the walls, break through the gate and fight your way through the harbour, the lower city and the terraces up to the temple.',
    start: { x: -43, z: -263, yaw: 20 },
    objectives: [
      { type: 'destroy', zone: 'outskirts', text: 'Burn the Dustrider war camp before the gate', pos: [-53, -299], radius: 40,
        targets: [{ type: 'tent', map: true }, { type: 'tent', pos: [-55, -305], yaw: 180 }],
        waves: { every: 5, group: 9, total: 9999, mix: { warrior: 5, spearman: 3, archer: 1 } } },
      { type: 'reach', zone: 'gate', text: 'Through the gate into the city', pos: [-43, -221], radius: 10,
        waves: { every: 5, group: 8, total: 40, mix: { warrior: 5, spearman: 2, archer: 1 } } },
      { type: 'kill', text: 'Clear the gate square', pos: [-43, -221], radius: 30, count: 45,
        waves: { every: 3.5, group: 11, total: 70, mix: { warrior: 5, spearman: 2, archer: 2, assassin: 3 } } },
      { type: 'reach', zone: 'harbour', text: 'Take the harbour road', pos: [47, -219], radius: 12,
        waves: { every: 4.5, group: 10, total: 60, mix: { warrior: 4, spearman: 3, archer: 2, assassin: 2 } } },
      { type: 'destroy', text: 'Sink the war canoes at the pier', pos: [60, -135], radius: 45,
        targets: [{ type: 'canoe', map: true }, { type: 'canoe', pos: [28, -152], yaw: 90 }, { type: 'canoe', pos: [58, -153], yaw: 100 }, { type: 'canoe', pos: [88, -151], yaw: 80 }],
        waves: { every: 4, group: 11, total: 9999, mix: { warrior: 4, spearman: 3, archer: 3, assassin: 2, thrower: 2 } } },
      { type: 'reach', zone: 'lower', text: 'Break into the lower city', pos: [-41, -151], radius: 12,
        waves: { every: 4, group: 11, total: 70, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 3, thrower: 1 } } },
      { type: 'destroy', text: 'Topple the skull totems', pos: [-150, -180], radius: 90,
        targets: [{ type: 'totem', pos: [-101, -153] }, { type: 'totem', pos: [-109, -207], yaw: 90 }, { type: 'totem', pos: [-179, -167], yaw: 180 }, { type: 'totem', pos: [-245, -191], yaw: 270 }],
        waves: { every: 3.5, group: 12, total: 9999, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 3, assassin: 2, rammer: 1, thrower: 1 } } },
      { type: 'boss', text: 'Kill the Stegosaurus rider', pos: [-183, -163], radius: 40, bosses: ['stego'],
        waves: { every: 4.5, group: 10, total: 9999, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 3, rammer: 1 } } },
      { type: 'reach', zone: 'midwest', text: 'Climb to the western terrace', pos: [-171, -77], radius: 14,
        waves: { every: 4, group: 12, total: 80, mix: { warrior: 4, spearman: 3, archer: 2, assassin: 2, rammer: 1 } } },
      { type: 'hold', text: 'Hold the terrace', pos: [-171, -77], radius: 26, seconds: 60,
        waves: { every: 3.2, group: 13, total: 9999, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 3, assassin: 2, rammer: 2, thrower: 2, dilo: 1 } } },
      { type: 'destroy', text: 'Burn the chieftains\' tents on the terrace', pos: [-175, -63], radius: 70,
        targets: [{ type: 'bigtent', pos: [-117, -65], yaw: 200 }, { type: 'bigtent', pos: [-231, -61], yaw: 60 }],
        waves: { every: 3.5, group: 12, total: 9999, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 2, assassin: 2, rammer: 2, thrower: 1, dilo: 1 } } },
      { type: 'reach', zone: 'arch', text: 'On to the triumphal arch', pos: [-39, -67], radius: 12,
        waves: { every: 4, group: 12, total: 80, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 3, rammer: 1, dilo: 1 } } },
      { type: 'kill', text: 'Hold the arch', pos: [-39, -67], radius: 60, count: 80,
        waves: { every: 3, group: 14, total: 110, mix: { warrior: 4, spearman: 3, archer: 2, raptor: 3, assassin: 3, rammer: 2, thrower: 2, dilo: 2 } } },
      { type: 'boss', zone: 'east', text: 'Hunt down the two Allosaurus riders', pos: [135, 31], radius: 40, bosses: ['allosaurus', 'allosaurus'], at: [[135, 31], [133, 79]],
        waves: { every: 4, group: 12, total: 9999, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 4, assassin: 2, rammer: 1, thrower: 1 } } },
      { type: 'reach', zone: 'plaza', text: 'Up to the fountain plaza', pos: [-27, 23], radius: 14,
        waves: { every: 3.5, group: 13, total: 90, mix: { warrior: 4, spearman: 3, archer: 2, raptor: 3, assassin: 2, rammer: 2, dilo: 1 } } },
      { type: 'destroy', text: 'Burn the chieftains\' tents on the plaza', pos: [-40, 40], radius: 50,
        targets: [{ type: 'bigtent', pos: [-55, 19], yaw: 120 }, { type: 'bigtent', pos: [-7, 57], yaw: 300 }, { type: 'tent', pos: [-59, 51], yaw: 30 }],
        waves: { every: 3, group: 14, total: 9999, mix: { warrior: 4, spearman: 3, archer: 2, raptor: 3, assassin: 3, rammer: 2, thrower: 2, dilo: 2 } } },
      { type: 'boss', zone: 'temple', text: 'Bring down the T-Rex titan', pos: [-37, 97], radius: 60, bosses: ['trex'],
        waves: { every: 4.5, group: 11, total: 9999, mix: { warrior: 5, spearman: 2, archer: 2, raptor: 3, assassin: 2, rammer: 1 } } },
    ],
  },

  // sound files of the game (paths below Data/<mod>/Audio/Sound); a list = one is picked at random
  sounds: {
    click: '05_ui/ui_click_success.wav', error: '05_ui/ui_click_error.wav', weapon: '05_ui/ui_equipment_weapon_metal.wav',
    swap: '05_ui/ui_unit_transformed.wav', quest: '05_ui/ui_received_quest.wav', success: '05_ui/ui_quest_success.wav',
    warn: '05_ui/ui_warn_under_attack.wav', ping: '05_ui/ui_minimap_ping.wav', pickup: '05_ui/ui_pickup_treasure.wav',
    explode: ['02_battle/arm_rocket_explode1.wav', '02_battle/arm_rocket_explode2.wav', '02_battle/arm_rocket_explode3.wav', '02_battle/arm_rocket_explode4.wav'],
    hitFlesh: ['02_battle/proj_metal_small_hit_unit1.wav', '02_battle/proj_metal_small_hit_unit2.wav', '02_battle/proj_metal_small_hit_unit3.wav', '02_battle/proj_metal_small_hit_unit4.wav'],
    hitGround: ['02_battle/proj_metal_small_hit_soil1.wav', '02_battle/proj_metal_small_hit_soil2.wav', '02_battle/proj_metal_small_hit_soil3.wav'],
    melee: ['02_battle/arm_bloodbone1.wav', '02_battle/arm_bloodbone2.wav', '02_battle/arm_punch1.wav', '02_battle/arm_kick2.wav'],
    swing: ['02_battle/weapon_large_att1.wav', '02_battle/weapon_large_att2.wav', '02_battle/weapon_large_att3.wav'],
    land: '00_npc/npc_fall_medium.wav', landBig: '00_npc/npc_fall_huge.wav', jet: '02_battle/arm_jetpack_use.wav',
    armorBreak: '02_battle/proj_metal_big_hit_metal1.wav', hurt: ['02_battle/arm_punch1.wav', '02_battle/arm_punch3.wav'],
    deathVoice: /07_speech_acks\/aje\/.*_die_\d\.wav$/,       // every Dustrider death cry the game has
  },

  // difficulty: how hard the enemies hit and how much they take
  difficulty: {
    easy: { name: 'Easy', damage: 0.55, health: 0.8 },
    normal: { name: 'Normal', damage: 1, health: 1 },
    hard: { name: 'Hard', damage: 1.5, health: 1.25 },
  },
  // reward for every completed objective: share of the health given back; a fallen character returns with this much
  relief: { heal: 0.3, revive: 0.6 },
  // What keeps a swarm from killing the player in a moment (player.js hurt()):
  //   budget     the most damage that can be taken per second, as a share of the character's full health - however
  //              many enemies strike. `burst` is how much of that can be saved up for one moment (share of health).
  //   armourGate one hit never breaks more than one segment of armour and never goes through the armour into the
  //              health; when the last segment breaks nothing can hurt for `grace` seconds
  //   lastStand  a hit that would kill from above `above` (share of health) leaves 1 health and `time` s of immunity
  protect: {
    budget: { perSecond: 0.15, burst: 0.3 },
    armourGate: { grace: 0.6 },
    lastStand: { above: 0.25, time: 1.2 },
  },

  settings: { quality: 'high', difficulty: 'normal', sensitivity: 1, invertY: false, volume: 0.8, music: true, blood: true, numbers: true },
};
