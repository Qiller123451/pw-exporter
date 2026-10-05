// Mission 2: "The Assault" - the SEAS storm the Holy City.
//
// Map: "Holy City defender" (SEK & DryFun), a fan-made multiplayer map of the MIRAGE mod: the Holy City of campaign
// mission 5, whole again and garrisoned, with the country north of it - the savanna, a line of Dustrider towers
// and clay walls across the roads, and a SEAS pier on the north shore where two carriers lie.
// The city itself is the old one moved by (-32, +368), so its districts are the Holy City mission's, shifted.
//
// This time the player is not alone: SEAS troops land with him and keep coming (CFG.allies, allies.js).
const S = (x, z) => [x - 32, z + 368];                 // a place of the Holy City mission -> the same place on this map
const cut = (x1, z1, x2, z2, k) => { const a = S(x1, z1), b = S(x2, z2); return k ? [a[0], a[1], b[0], b[1], k] : [a[0], a[1], b[0], b[1]]; };

export const ASSAULT = {
  id: 'assault', title: 'The Assault',
  blurb: 'The SEAS storm the Holy City: land on the north shore, cross the savanna with the troops, break the tower line and the gate, and take the city district by district.',
  needs: 'needs the MIRAGE mod (its map "Holy City defender")',
  map: 'data/maps/MIRAGE/Multiplayer/holy_city_defender.ula',

  allies: { count: 16 },
  swarm: { max: 150, spawnMin: 60, spawnMax: 125, corpseTime: 8, separation: 1.9, attackSlots: 7 },

  zones: {
    list: [
      { id: 'shore', name: 'the north shore', seed: null },
      { id: 'savanna', name: 'the savanna', seed: [-60, -250] },
      { id: 'line', name: 'the tower line', seed: [-60, -100] },
      { id: 'gate', name: 'the gate square', seed: S(-43, -222) },
      { id: 'harbour', name: 'the harbour', seed: S(60, -215) },
      { id: 'lower', name: 'the lower city', seed: S(-180, -170) },
      { id: 'midwest', name: 'the western terrace', seed: S(-150, -80) },
      { id: 'arch', name: 'the triumphal arch', seed: S(-43, -60) },
      { id: 'east', name: 'the eastern quarter', seed: S(120, 20) },
      { id: 'plaza', name: 'the fountain plaza', seed: S(-30, 40) },
      { id: 'temple', name: 'the temple forecourt', seed: S(-37, 96) },
    ],
    cuts: [
      [-760, -330, 760, -330],             // the shore | the savanna
      [-760, -150, 760, -150],             // the savanna | the tower line
      cut(-56, -246, -30, -246, 'D'),      // the city gate
      cut(-66, -246, -66, -196),           // gate square: west, south
      cut(-66, -196, -22, -186),
      cut(-8, -246, -8, -120),             // harbour | gate square and lower city
      cut(-60, -104, -26, -104),           // the main avenue's ramp up to the arch
      cut(-190, -118, -160, -118),         // the west ramp
      cut(-290, -128, -225, -128),         // the far west ramp
      cut(-64, -104, -64, -46),            // western terrace | arch
      cut(62, -80, 92, -40),               // arch | eastern quarter (north entrance)
      cut(0, 22, 58, 78),                  // arch | the diagonal street down from the plaza
      cut(48, 90, 70, 68),                 // that street | eastern quarter (south entrance)
      cut(-75, -12, 5, -12),               // arch | fountain plaza
      cut(-100, 86, 20, 86),               // the temple steps
      cut(105, -248, 250, -248),           // the shore east of the harbour (open country on this map)
      [-112, 352, -112, 456],              // western terrace | fountain plaza (a street the ruined city did not have)
    ],
    door: { model: 'hcl13_gate', closed: /_f\w*(0200|0c00)$/ },
    rubble: ['hc_barricade_01', 'hc_barricade_02', 'hc_barricade_03', 'hc_barricade_04'],
    rubbleMax: 60,
    gateRange: 13,
    wallHeight: 18, wallColor: 0x66ccff, wallNear: 34,
    note: 'The Dustriders still hold what lies beyond - finish the objective first',
  },

  mission: {
    // the map's own towers, boats and the fountain stand as targets from the first moment on (garrison)
    reserved: /^(aje_small_tower|aje_medium_tower|aje_catamaran|macrolemys_water|defender_object|aje_tent|aje_big_tent|aje_skull_protector|aje_clay_wall_gate)$/,
    gfx: { seas_carrier_fake: 'seas_carrier' },
    // (the bone gates cannot be forced before the objective that names them: locked)
    garrison: [{ type: 'tower', map: true }, { type: 'bigtower', map: true }, { type: 'catamaran', map: true }, { type: 'turtle', map: true }, { type: 'heart', map: true }, { type: 'bonegate', map: true, locked: true }],
    title: 'The Assault',
    won: 'The Holy City has fallen',
    intro: 'The carriers lie off the north shore and the first wave is on the beach. Take the troops across the savanna, break the Dustriders\' tower line, blow the gate and storm the Holy City - district by district, up to the temple. You are one of many this time: the SEAS fight beside you, and more keep coming. <b>G</b> calls a bombardment down around the Gunner.',
    start: { x: 222, z: -646, yaw: 75 },
    objectives: [
      // ---------------------------------------------------------------- the north shore
      { type: 'kill', zone: 'shore', text: 'Hold the beachhead at the pier', pos: [215, -645], radius: 45, count: 35, troops: 10, rally: [240, -655],
        waves: { every: 4, group: 10, total: 60, mix: { warrior: 5, spearman: 3, archer: 2, raptor: 2 } } },
      { type: 'reach', text: 'Inland with the troops, along the beach', pos: [20, -600], radius: 18,
        waves: { every: 5, group: 9, total: 50, mix: { warrior: 4, spearman: 3, archer: 2, raptor: 3 } } },
      { type: 'destroy', text: 'Burn the siege camp before the SEAS fort', pos: [-98, -420], radius: 60,
        targets: [{ type: 'tent', pos: [-100, -442], yaw: 20 }, { type: 'tent', pos: [-125, -418], yaw: 110 }, { type: 'bigtent', pos: [-80, -415], yaw: 250 }, { type: 'tent', pos: [-88, -380], yaw: 180 }, { type: 'totem', pos: [-102, -402] }],
        // the siege is lifted: the fort becomes the assault's base (buildings inside its walls, two gun towers and
        // the rally flag where the camp stood)
        builtNote: 'The siege is lifted - the engineers make the fort the base of the assault',
        built: [
          { model: 'seas_headquarters', pos: [-250, -456], yaw: 200 }, { model: 'seas_barracks', pos: [-214, -488], yaw: 110 },
          { model: 'seas_garage', pos: [-286, -444], yaw: 160 }, { model: 'seas_steelwork', pos: [-216, -450], yaw: 250 },
          { model: 'seas_greenhouse', pos: [-206, -520], yaw: 20 }, { model: 'seas_small_tent', pos: [-262, -424], yaw: 80 }, { model: 'seas_small_tent', pos: [-246, -486], yaw: 170 },
          { model: 'seas_turret_tower', pos: [-124, -420], yaw: 60, addon: ['seas_turret', 'we'], gun: 'turret' }, { model: 'seas_turret_tower', pos: [-78, -404], yaw: 200, addon: ['seas_turret', 'we'], gun: 'turret' },
          { model: 'seas_rally_point', pos: [-100, -412], yaw: 0 },
        ],
        waves: { every: 4, group: 11, total: 9999, mix: { warrior: 5, spearman: 3, archer: 2, raptor: 2, assassin: 2, thrower: 1 } } },
      { type: 'reach', text: 'To the pass into the savanna', pos: [-61, -346], radius: 12,
        waves: { every: 5, group: 9, total: 40, mix: { warrior: 4, spearman: 3, archer: 2, raptor: 3 } } },
      // ---------------------------------------------------------------- the savanna
      { type: 'boss', zone: 'savanna', text: 'A Stegosaurus rider bars the pass - bring it down', pos: [-58, -250], radius: 40, bosses: ['stego'],
        waves: { every: 4.5, group: 10, total: 9999, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 4, assassin: 1 } } },
      { type: 'hold', text: 'Hold the crossroads until the Black Widows have come up', pos: [-8, -206], radius: 24, seconds: 45, allies: 20,
        waves: { every: 3.2, group: 13, total: 9999, mix: { warrior: 4, spearman: 3, archer: 2, raptor: 4, assassin: 2, rammer: 1, dilo: 1 } } },
      // (the siege spiders arrive through the pass: three at once, then one with every wave)
      { type: 'reach', text: 'The Black Widows are here - advance on the tower line', pos: [-14, -166], radius: 12, allies: 20, arrive: 'widow', rally: [-62, -272], from: [-73, 125],
        waves: { every: 4.5, group: 10, total: 50, mix: { warrior: 4, spearman: 3, archer: 3, raptor: 3, dilo: 1 } } },
      // ---------------------------------------------------------------- the tower line
      { type: 'destroy', zone: 'line', text: 'Storm the war towers of the outer line with the Black Widows', pos: [-20, -40], radius: 110, allies: 22, troops: 6, from: [-73, 125],
        guards: [{ type: 'ankylo', pos: [-36, -92] }, { type: 'ankylo', pos: [-14, -14] }, { type: 'ankylo', pos: [24, -4] }, { type: 'ankylo', pos: [40, 34] }],
        targets: [{ type: 'bigtower', near: [-20, -40], within: 105 }],
        waves: { every: 5, group: 10, total: 9999, mix: { warrior: 5, spearman: 3, archer: 2, raptor: 2, assassin: 2, rammer: 1, thrower: 1, ankylo: 0.2 } } },
      { type: 'destroy', text: 'The towers are down - break the bone gates', pos: [20, 0], radius: 110, allies: 22, from: [-73, 125],
        targets: [{ type: 'bonegate', near: [-20, -40], within: 140 }],
        waves: { every: 5, group: 10, total: 9999, mix: { warrior: 5, spearman: 3, archer: 2, raptor: 3, assassin: 2, rammer: 1, ankylo: 0.15 } } },
      { type: 'boss', text: 'Allosaurus riders sally from the city - kill them', pos: [-70, 45], radius: 45, bosses: ['allosaurus', 'allosaurus'], at: [[-74, 70], [-40, 52]], allies: 20, from: [-73, 125],
        waves: { every: 4.5, group: 10, total: 9999, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 4, rammer: 1 } } },
      { type: 'hold', text: 'Cover the sappers at the city gate', pos: [-75, 97], radius: 26, seconds: 40, allies: 22, from: [-73, 125], fromSlack: 42,
        waves: { every: 3, group: 13, total: 9999, mix: { warrior: 4, spearman: 3, archer: 3, raptor: 3, assassin: 2, rammer: 2, thrower: 2 } } },
      // ---------------------------------------------------------------- the city
      // (checkpoint 1: the country outside is won)
      { type: 'reach', zone: 'gate', text: 'The gate is down - into the city', pos: S(-43, -221), radius: 10, troops: 8, rally: [-75, 100], checkpoint: true, arrive: 'enforcer',
        waves: { every: 5, group: 9, total: 40, mix: { warrior: 5, spearman: 2, archer: 1 } } },
      { type: 'kill', text: 'Clear the gate square', pos: S(-43, -221), radius: 30, count: 50,
        waves: { every: 3.5, group: 12, total: 80, mix: { warrior: 5, spearman: 2, archer: 2, assassin: 3, rammer: 1 } } },
      { type: 'reach', zone: 'harbour', text: 'Take the harbour road', pos: S(47, -219), radius: 12,
        waves: { every: 4.5, group: 10, total: 60, mix: { warrior: 4, spearman: 3, archer: 2, assassin: 2 } } },
      { type: 'destroy', text: 'Sink the Dustrider fleet and the harbour tower', pos: [40, 215], radius: 70,
        targets: [{ type: 'catamaran', zone: 'harbour' }, { type: 'turtle', zone: 'harbour' }, { type: 'bigtower', zone: 'harbour' }],
        waves: { every: 4, group: 11, total: 9999, mix: { warrior: 4, spearman: 3, archer: 3, assassin: 2, thrower: 2 } } },
      { type: 'reach', zone: 'lower', text: 'Break into the lower city', pos: S(-41, -151), radius: 12,
        waves: { every: 4, group: 11, total: 70, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 3, thrower: 1 } } },
      { type: 'destroy', text: 'Tear down the towers of the lower city', pos: [-150, 210], radius: 110,
        targets: [{ type: 'tower', zone: 'lower' }],
        waves: { every: 3.5, group: 12, total: 9999, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 3, assassin: 2, rammer: 1, thrower: 1 } } },
      { type: 'reach', zone: 'midwest', text: 'Climb to the western terrace', pos: S(-171, -77), radius: 14,
        waves: { every: 4, group: 12, total: 80, mix: { warrior: 4, spearman: 3, archer: 2, assassin: 2, rammer: 1 } } },
      { type: 'hold', text: 'Hold the terrace', pos: S(-171, -77), radius: 26, seconds: 50,
        waves: { every: 3.2, group: 13, total: 9999, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 3, assassin: 2, rammer: 2, thrower: 2, dilo: 1 } } },
      // (checkpoint 2: the lower half of the city is taken)
      { type: 'reach', zone: 'arch', text: 'On to the triumphal arch', pos: S(-39, -67), radius: 12, checkpoint: true,
        waves: { every: 4, group: 12, total: 80, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 3, rammer: 1, dilo: 1 } } },
      { type: 'kill', text: 'Hold the arch', pos: S(-39, -67), radius: 60, count: 70,
        waves: { every: 3, group: 14, total: 110, mix: { warrior: 4, spearman: 3, archer: 2, raptor: 3, assassin: 3, rammer: 2, thrower: 2, dilo: 2 } } },
      { type: 'destroy', zone: 'east', text: 'Silence the towers of the eastern quarter', pos: [190, 400], radius: 90,
        targets: [{ type: 'tower', zone: 'east' }, { type: 'bigtower', zone: 'east' }],
        waves: { every: 4, group: 12, total: 9999, mix: { warrior: 4, spearman: 2, archer: 2, raptor: 4, assassin: 2, rammer: 1, thrower: 1 } } },
      { type: 'reach', zone: 'plaza', text: 'Up to the fountain plaza', pos: S(-27, 23), radius: 14,
        waves: { every: 3.5, group: 13, total: 90, mix: { warrior: 4, spearman: 3, archer: 2, raptor: 3, assassin: 2, rammer: 2, dilo: 1 } } },
      { type: 'destroy', text: 'Shatter the Heart of the City', pos: [-70, 401], radius: 50,
        targets: [{ type: 'heart', zone: 'plaza' }],
        waves: { every: 3, group: 14, total: 9999, mix: { warrior: 4, spearman: 3, archer: 2, raptor: 3, assassin: 3, rammer: 2, thrower: 2, dilo: 2 } } },
      { type: 'boss', zone: 'temple', text: 'Bring down the T-Rex titan', pos: S(-37, 97), radius: 60, bosses: ['trex'], troops: 8,
        waves: { every: 4.5, group: 11, total: 9999, mix: { warrior: 5, spearman: 2, archer: 2, raptor: 3, assassin: 2, rammer: 1 } } },
    ],
  },
};
// The big beasts come with the waves on a count (waves.heavy = {type: share of a wave}, mission.js):
// Ankylosaurus catapults at the war towers, Stegosaurus riders once the city gate has fallen, and in the upper city
// (from the arch on) the Brachiosaurus catapults.
{
  const list = ASSAULT.mission.objectives, k = list.findIndex((o) => o.zone === 'gate'), u = list.findIndex((o) => o.zone === 'arch');
  list.forEach((o, i) => {
    if (!o.waves) return;
    const H = o.waves.heavy = {};
    if (o.waves.mix.ankylo) { H.ankylo = 0.15; delete o.waves.mix.ankylo; }
    if (i >= k) H.stego = 0.12;
    if (i >= u) H.brachio = 0.12;
  });
}
