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
  // bigRadius: bodies wider than this use the wide paths; maxBody: widest body tested against walls (a dinosaur
  // brushing through a lantern is better than one wedged in a street)
  nav: { cell: 2, step: 1.1, drop: 6, height: 3.6, radius: 0.8, wideCells: 1, bigRadius: 2.5, maxBody: 1.7 },

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
      dash: { speed: 27, time: 0.25, cooldown: 1.1 },
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
      // a combo: each entry is one swing; the last one is the heavy finisher
      combo: [
        { clip: 'attack_front_s_0', time: 0.62, hitAt: 0.3, ts: 2.0, range: 9.5, arc: 150, damage: 110, knock: 20 },
        { clip: 'attack_front_s_2', time: 0.62, hitAt: 0.3, ts: 2.0, range: 9.5, arc: 150, damage: 120, knock: 22 },
        { clip: 'attack_front', time: 0.9, hitAt: 0.45, ts: 1.5, range: 11, arc: 200, damage: 190, knock: 36, slam: true },
      ],
      comboWindow: 0.55, lunge: 16,
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
  // attack: melee {range, damage, clips, hitAt (s into the clip), time}; ranged adds {projectile, speed, range, arc}
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
      health: 6500, speed: 10, radius: 4.6, height: 13, run: 'walk_3', runSpeed: 7, idle: 'standanim', animal: true, elite: true, heavy: true, boss: true,
      attack: { range: 11, damage: 48, clips: ['attack_front', 'attack_2', 'attack_3'], hitAt: 0.6, time: 1.7, ts: 1.0, knock: 34 },
      die: ['dying'], knock: null, up: null, flinch: 'hit_reaction', taunt: 'menace',
      staggerAt: 900, executable: 0.08, score: 100,
    },
  },
  swarm: {
    max: 110,                   // enemies alive at the same time
    spawnMin: 55, spawnMax: 120, // spawn this far (walking distance) from the player, out of sight if possible
    corpseTime: 9,              // seconds a body stays
    separation: 1.9,            // how strongly they keep apart
    attackSlots: 7,             // how many may strike the player at the same time (the rest circle)
  },

  // ---------------------------------------------------------------- the mission
  // start: where the player stands at the beginning (yaw: 180 = facing south, into the city)
  // objectives, in order:
  //   reach  - walk into the circle (pos, radius)
  //   kill   - kill `count` enemies (of the waves that this objective starts)
  // waves: what attacks while the objective is active: every `every` seconds `groups` are spawned
  //   (each group: n enemies of the mixed types) until `total` have come; boss: spawned once at `pos`
  mission: {
    title: 'The Holy City',
    intro: 'The Dustriders hold the Holy City. Break through from the gate to the temple.',
    start: { x: -43.1, z: -212, yaw: 180 },
    objectives: [
      { type: 'reach', text: 'Fight your way up to the triumphal arch', pos: [-43, -72], radius: 14,
        waves: { every: 5, group: 9, total: 60, mix: { warrior: 5, spearman: 2, archer: 1 } } },
      { type: 'kill', text: 'Hold the arch', pos: [-43, -72], radius: 60, count: 60,
        waves: { every: 4, group: 12, total: 80, mix: { warrior: 5, spearman: 3, archer: 2, raptor: 2 } } },
      { type: 'reach', text: 'Push on to the fountain of the giants', pos: [-34, 30], radius: 16,
        waves: { every: 5, group: 10, total: 60, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 3 } } },
      { type: 'kill', text: 'Kill the Allosaurus rider and its pack', pos: [-34, 30], radius: 70, count: 50, boss: 'allosaurus',
        waves: { every: 4, group: 12, total: 70, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 4 } } },
      { type: 'reach', text: 'Storm the temple steps', pos: [-37, 82], radius: 14,
        waves: { every: 4, group: 12, total: 70, mix: { warrior: 5, spearman: 3, archer: 3, raptor: 2 } } },
      { type: 'kill', text: 'Bring down the T-Rex titan', pos: [-37, 82], radius: 80, count: 1, boss: 'trex', bossOnly: true,
        waves: { every: 5, group: 10, total: 9999, mix: { warrior: 5, spearman: 2, archer: 2, raptor: 3 } } },
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
  relief: { heal: 0.4, revive: 0.6 },

  settings: { quality: 'high', difficulty: 'normal', sensitivity: 1, invertY: false, volume: 0.8, music: true, blood: true },
};
