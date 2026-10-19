// The ten missions of "ParaWorld: Containment" (docs/SEQUEL.md). Each is data plus named handlers that the runtime
// (game/sequel/runtime.js, M) calls: setup, tick (every 0.5 s), died, evacuated, rescued, captured, asleep, loaded,
// riftClosed, done_<objective>, and the mission's own timer names (M.after(sec, name, args)).
// unlocks: the sequel's units and buildings the mission brings in (game/sequel/rules.js): buildable from then on, each
// introduced on the radio with what it does (texts.js `intro`) a few seconds into the mission - or, as [name, 'later'],
// when the script calls M.introduce(name). Before its mission a class cannot be built (lockedBefore).
// Coordinates are game coordinates: x east, z south, metres from the map's centre.
// Pace (the user: "like the original's normal"): in the original campaign's defence missions the first real attack
// comes some minutes after the start (13 The Rush: 10 min, 15: 4-6, 3: 8-13, 7: 5-7 after epoch 2), then every
// 2-6 minutes, growing; difficulty changes how many come, not when. So the defence missions (2, 5, 10) open their
// rifts after a build-up of about four minutes, waves come every two minutes or so (faster towards the end), and a
// garrison by the objective can hold the first wave by itself.

const T = 60;                        // a minute
const near = (u, x, z, r) => Math.hypot(u.pos.x - x, u.pos.z - z) <= r;
const alive = (e) => !!e && e.alive;
const CIVS = ['sq_civilian_1', 'sq_civilian_2', 'sq_civilian_3', 'sq_civilian_4'];
// townsfolk holed up in their houses: safe until a SEAS unit finds them, then they run for the evacuation point
function civilians(M, x, z, n, spread = 20) {
  for (let i = 0; i < n; i++) for (const u of M.spawn(CIVS[i % 4], 'civilians', x + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread, 1)) { u.untargetable = true; u.sqHiding = true; }
}
// the standard SEAS start: headquarters, barracks, six workers (they start on food, wood and stone: runtime.js
// startWork), troopers (and the colonel). guard: [x, z] - the troopers
// and marksmen start there instead, by what the mission has them defend
const BASE = (x, z, extra = {}) => {
  const [gx, gz] = extra.guard || [x + 12, z - 4];
  return {
    buildings: [['seas_headquarters', x, z, 0], ['seas_barracks', x + 32, z + 4, 0], ...(extra.garage ? [['seas_garage', x - 2, z + 38, 0]] : []), ...(extra.buildings || [])],
    units: [['sq_halloran', x - 12, z - 22, 1], ['seas_worker', x - 4, z - 18, 6], ['sq_trooper', gx - 2, gz - 16, 4, 2], ['seas_marksman', gx + 4, gz - 22, 2, 2], ...(extra.units || [])],
  };
};

export const MISSIONS = [
  // ============================================================================================ 1
  {
    id: 1, title: 'The Copper Basin Rift', place: 'Copper Basin, Nevada', date: 'June 14, 1964',
    unlocks: ['sq_trooper', 'sq_flak', ['sq_stabilizer', 'later']],
    briefing: [
      'At 04:10 this morning the Copper Basin seismograph station recorded a tremor with no epicentre. At 04:40 the sheriff radioed that "lizards the size of a truck" were in the streets.',
      'SEAS has seen this once before - sixty years ago, in the papers of a man named Taslov. A tear between our world and another. Get the townsfolk out, hold the line, and wait for the scientist.',
    ],
    creatures: ['Velociraptor', 'Deinonychus', 'Allosaurus'],
    powers: ['supply', 'recon'],
    res: { food: 500, wood: 450, stone: 350 },
    map: {
      seed: 1964, clear: [[170, -60, 22], [-110, 200, 14]], setting: 'Savanna', size: 480, base: 6, noise: [[0.004, 9], [0.02, 1.5]], ground: [0, 3, 4, 7, 6, 1],
      features: [{ type: 'mesa', x: 170, z: -150, r: 60, h: 18 }, { type: 'mesa', x: -190, z: -170, r: 50, h: 14 }, { type: 'flat', x: -20, z: -40, r: 120, h: 6 }, { type: 'flat', x: -40, z: 150, r: 60, h: 6 }],
      roads: [{ path: [[-40, 240], [-40, 120], [-20, 40], [0, -40], [10, -240]], width: 9, kind: 'highway' }, { path: [[0, -40], [160, -40], [190, -90]], width: 6, kind: 'dirt' }],
      places: [{ kind: 'town', x: -20, z: -40, rot: 0, blocks: 1, len: 150 }, { kind: 'farm', x: -170, z: 60, rot: 0.6 }, { kind: 'strip', x: -40, z: 70, rot: Math.PI },
        { kind: 'model', model: 'sq_bus', x: -96, z: 196, rot: 1.2, r: 4 }, { kind: 'model', model: 'sq_bus', x: -84, z: 206, rot: 1.0, r: 4 }, { kind: 'model', model: 'sq_army_truck', x: -100, z: 214, rot: 0.6, r: 3 }],
      forests: [{ x: -150, z: 170, r: 50, n: 30 }, { x: 140, z: 160, r: 40, n: 20 }], rocks: [{ x: 160, z: -60, r: 50, n: 22 }],
      resources: [{ x: -40, z: 170, stone: 5, food: 6, wood: 26 }], shrubs: 320,
    },
    start: BASE(-8, 186),
    zones: [{ name: 'buses', x: -90, z: 200, r: 16, kind: 'evac' }],
    on: {
      setup(M) {
        M.state.need = [8, 12, 14][M.difficulty];
        civilians(M, -40, -60, 7, 60); civilians(M, 10, -20, 5, 40); civilians(M, -170, 60, 3, 20); civilians(M, -40, 70, 3, 20);
        M.spawn('Velociraptor', 'outbreak', 60, -90, 3); M.spawn('Velociraptor', 'outbreak', -100, -20, 2);
        M.building('sq_field_hq', 'me', -110, 200, 0.4);
        M.mark(-90, 200, 'buses', 0x7dff6a);
        M.objective('evac', 'Lead the townsfolk to the buses', { of: M.state.need, civ: true });
        M.say('radio', 'Colonel, the town is dark and the sheriff stopped answering twenty minutes ago.');
        M.say('halloran', 'Then we go in. Troopers, find the townsfolk - they will follow a uniform. Buses are waiting by the field post.');
        M.say('sheriff', '...anybody hear me? We are holed up all over Main Street. Those things are fast!');
        M.after(70, 'rift');
        M.after(150, 'taslov');
      },
      rift(M) {
        M.rift('mine', 170, -60, { every: 50, first: 5, waves: [[['Velociraptor', 3]], [['Velociraptor', 4]], [['Deinonychus', 3], ['Velociraptor', 2]], [['Allosaurus', 1], ['Velociraptor', 4]]] });
        M.say('kiko', 'Command, Kiko. I see it from up here - a ring of light by the old copper mine. Things are coming out of it.');
        M.say('halloran', 'Then that is where they come from. Hold the town.');
      },
      taslov(M) {
        M.spawn('sq_taslov', 'me', -40, 230, 1);
        M.say('taslov', 'Taslov, Lev. My grandfather built the machine that tore the first hole. I built the thing that can stitch it.');
        M.say('taslov', 'Have your engineers raise a Rift Stabilizer close to it - thirty metres - and keep the beasts off it for a minute.');
        M.introduce('sq_stabilizer', true);
        M.objective('seal', 'Build a Rift Stabilizer at the rift by the mine and keep it standing until the rift closes', {});
        if (M.rifts.length && !M.rifts[0].open) M.complete('seal');
      },
      riftClosed(M) { M.complete('seal'); },
      evacuated(M, { n }) { M.progress('evac', n); if (n === 4) M.say('sheriff', 'Bless you, soldier. The Hendersons are still in the gas station!'); },
      tick(M) {
        const lost = M.counters.civLost || 0;
        if (lost > [8, 6, 4][M.difficulty]) M.lose('Too many townsfolk were lost.');
        if (!M.units('me', (u) => u.name === 'sq_halloran').length && M.time > 5) M.lose('Colonel Halloran has fallen.');
        if (M.isDone('evac') && M.isDone('seal') && !M.state.won) {
          M.state.won = true;
          M.say('taslov', 'There. Closed - for now. But listen to the ground, Colonel. It is still humming.');
          M.say('halloran', 'Then we will be back. Pack up.');
          M.after(10, 'end');
        }
      },
      end(M) { M.win('Copper Basin is safe. For now.'); },
    },
  },
  // ============================================================================================ 2
  {
    id: 2, title: 'Lights Out', place: 'Black Canyon Generating Station', date: 'June 21, 1964',
    unlocks: ['sq_power_pole', 'sq_generator', 'sq_windmill', 'sq_searchlight', 'sq_shock_trooper'],
    briefing: [
      'Taslov\'s stabilizers need power - more than any field generator can give. The Black Canyon station feeds half of Nevada, and tonight two rifts opened in the canyon above it.',
      'Hold the generating station until dawn. The creatures hate light: searchlight towers will dazzle anything that walks into the beam.',
      'And put the station to work for us: workers in the turbine hall, and a line of power poles to the base. Searchlights, nets and Taslov\'s new toys all run on electricity.',
    ],
    night: true, creatures: ['Velociraptor', 'Deinonychus', 'Allosaurus', 'Carnotaurus', 'Smilodon'],
    powers: ['supply', 'recon', 'airdrop'],
    res: { food: 600, wood: 700, stone: 500, power: 60 },
    map: {
      seed: 2121, clear: [[20, 40, 28], [-120, -150, 22], [130, -160, 22]], setting: 'Savanna', size: 440, base: 4, noise: [[0.005, 6], [0.025, 1.2]], ground: [7, 0, 4, 3, 6, 2],
      features: [{ type: 'ridge', path: [[-220, -40], [-60, -60]], w: 70, h: 30 }, { type: 'ridge', path: [[60, -60], [220, -30]], w: 70, h: 30 },
        { type: 'mesa', x: -150, z: 140, r: 60, h: 20 }, { type: 'mesa', x: 170, z: 150, r: 50, h: 22 }, { type: 'flat', x: 0, z: 40, r: 90, h: 4 }],
      roads: [{ path: [[0, 220], [0, 60], [-10, -60], [0, -220]], width: 8, kind: 'highway' }],
      places: [{ kind: 'industry', x: 20, z: 40, rot: 0 }, { kind: 'camp', x: -60, z: 120, rot: 0 }],
      rocks: [{ x: -140, z: -120, r: 70, n: 30 }, { x: 140, z: -120, r: 70, n: 30 }], resources: [{ x: -40, z: 170, stone: 6, food: 6, wood: 26 }],
      forests: [{ x: 120, z: 180, r: 40, n: 20 }], shrubs: 200,
    },
    start: BASE(-70, 170, { guard: [16, 92], units: [['sq_taslov', -60, 150, 1]] }),
    on: {
      setup(M) {
        M.state.station = M.building('sq_power_station', 'me', 20, 40, 0);
        M.objective('hold', 'Keep the generating station standing until dawn (12:00)', {});
        M.objective('power', 'Power the base: workers in the station, a line of Power Poles (at most 40 m apart) to the headquarters', { secondary: true });
        M.objective('lights', 'Build three Searchlight Towers', { of: 3, secondary: true });
        M.mark(20, 40, 'station', 0xffe070, 90);
        M.rift('west', -120, -150, { every: 120, first: 240, target: M.state.station, waves: [[['Velociraptor', 4]], [['Deinonychus', 4]], [['Velociraptor', 4], ['Allosaurus', 1]], [['Carnotaurus', 1], ['Deinonychus', 4]], [['Allosaurus', 2], ['Velociraptor', 5]]] });
        M.rift('east', 130, -160, { every: 130, first: 300, target: M.state.station, waves: [[['Smilodon', 2]], [['Velociraptor', 5]], [['Smilodon', 3], ['Deinonychus', 2]], [['Carnotaurus', 2]]] });
        M.state.dawn = 12 * T;
        M.say('taslov', 'That station is the only thing in this desert that can feed my stabilizers. If it goes dark, the rifts stay open.');
        M.say('halloran', 'Lights on the canyon road. Nothing gets to those turbines.');
        M.say('taslov', 'And Colonel - a few engineers in that turbine hall and a pole line to camp, and we have all the current we want. My lightning guns are very thirsty.');
        M.after(6 * T, 'midnight');
        M.after(9 * T, 'last');
      },
      midnight(M) { M.say('kiko', 'More of them on the ridge. A big one. Your searchlights are the only thing I can see from up here.'); M.spawn('Allosaurus', 'outbreak', -40, -200, 1, { target: M.state.station }); },
      last(M) { M.say('radio', 'Three hours to sunrise, Colonel. Barometers are going crazy around the rifts.'); for (const r of M.rifts) r.every = 80; },
      tick(M) {
        const n = M.W.buildings.filter((b) => b.alive && b.built && b.owner === M.me && b.name === 'sq_searchlight').length;
        M.progress('lights', n);
        const st = M.state.station;
        if (alive(st) && st.sqPowered && st.workers && st.workers.size && !M.isDone('power')) {
          M.complete('power');
          M.say('taslov', 'Do you hear it? Half of Nevada\'s current, and now some of it is ours. Build me a coil and I will show you what it does to a raptor.');
        }
        if (!alive(M.state.station)) M.fail('hold');
        if (M.time >= M.state.dawn && !M.state.day) {
          M.state.day = true;
          M.setNight(false);
          M.complete('hold');
          M.say('halloran', 'Sunrise. Every creature in that canyon just went to ground.');
          M.say('taslov', 'And the station is still humming. Good. Now I can build you something bigger.');
          M.after(8, 'end');
        }
      },
      end(M) { M.win('The lights stayed on.'); },
    },
  },
  // ============================================================================================ 3
  {
    id: 3, title: 'Stampede on Route 66', place: 'Route 66, east of Flagstaff, Arizona', date: 'July 2, 1964',
    unlocks: ['sq_tranq', 'sq_capture_truck', 'sq_jeep'],
    briefing: [
      'A rift in the Painted Desert has spilled a herd of horned giants onto Route 66, and they are walking west - straight into Flagstaff.',
      'Sergeant Booker of the handlers\' corps has a better idea than shooting them: tranquilizer marksmen put them to sleep, capture trucks haul them to the pens. A tame triceratops is worth a platoon.',
    ],
    creatures: ['Triceratops', 'Pentaceratops', 'Styracosaurus', 'Velociraptor'],
    powers: ['supply', 'recon', 'airdrop'],
    res: { food: 700, wood: 700, stone: 500 },
    map: {
      seed: 6666, clear: [[-170, 140, 22], [230, -60, 22]], setting: 'Savanna', size: 520, base: 5, noise: [[0.004, 7], [0.02, 1.5]], ground: [1, 0, 4, 3, 6, 5],
      features: [{ type: 'mesa', x: 60, z: -170, r: 70, h: 20 }, { type: 'mesa', x: 160, z: 170, r: 60, h: 18 }, { type: 'flat', x: -200, z: 0, r: 70, h: 5 }],
      roads: [{ path: [[-260, 0], [-120, 10], [0, -10], [120, 10], [260, 0]], width: 10, kind: 'highway' }],
      places: [{ kind: 'town', x: -220, z: 10, rot: Math.PI / 2, blocks: 1, len: 90, landmarks: false }, { kind: 'strip', x: 40, z: 30, rot: Math.PI }, { kind: 'farm', x: -60, z: 140, rot: 0.3 }],
      rocks: [{ x: 120, z: -90, r: 60, n: 26 }], forests: [{ x: -120, z: -150, r: 50, n: 26 }], resources: [{ x: -140, z: 80, stone: 6, food: 6, wood: 26 }], shrubs: 300,
    },
    start: BASE(-150, 70, { garage: true, units: [['sq_booker', -130, 40, 1], ['sq_tranq', -130, 50, 4, 2], ['sq_capture_truck', -100, 60, 2]] }),
    zones: [{ name: 'pen', x: -170, z: 150, r: 12, kind: 'pen' }, { name: 'town', x: -230, z: 10, r: 45 }],
    on: {
      setup(M) {
        M.state.need = [3, 5, 6][M.difficulty];
        M.state.through = 0;
        M.pen('pen', -150, 70);
        M.mark(-170, 150, 'pen', 0x7dff6a);
        M.objective('capture', 'Capture horned dinosaurs: tranquilize them, haul them to the pen', { of: M.state.need });
        M.objective('town', 'Keep the herd out of Flagstaff (no more than 6 may reach it)', {});
        M.rift('desert', 230, -60, { every: 45, first: 20, target: [-230, 10], cap: 14, waves: [[['Triceratops', 2]], [['Pentaceratops', 2], ['Triceratops', 1]], [['Styracosaurus', 3]], [['Triceratops', 2], ['Velociraptor', 3]]] });
        M.say('booker', 'Colonel. Don\'t kill the big ones - dart \'em first. Once a dart\'s in, shoot all you like: when it should die, it goes to sleep instead.');
        M.say('booker', 'Then a truck pulls up, we winch \'em aboard and drive \'em to the pen. Gentle as you please.');
        M.say('halloran', 'And if one wakes up in the truck?');
        M.say('booker', 'Then you\'ll hear about it, ma\'am.');
      },
      asleep(M) { if (!M.state.tip) { M.state.tip = true; M.say('booker', 'One\'s down! Get a capture truck next to it - right-click the sleeping animal with the truck.'); } },
      captured(M, { n }) { M.progress('capture', n); if (n === 1) M.say('booker', 'That\'s one. She\'s yours now, Colonel - a tame triceratops fights for whoever feeds her.'); },
      tick(M) {
        const ob = M.player('outbreak'), town = M.zones.town;
        for (const u of M.W.units) if (u.alive && u.owner === ob && u.cls === 'ANML' && !u.sqInTown && near(u, town.x, town.z, town.r)) {
          u.sqInTown = true; M.state.through++;
          M.notify(`A dinosaur reached Flagstaff (${M.state.through})`, 'bad');
        }
        if (M.state.through > 6) M.fail('town');
        if (M.isDone('capture') && !M.state.won) {
          M.state.won = true;
          M.complete('town');
          M.say('booker', 'Pen\'s full. These girls will pull a howitzer by Christmas.');
          M.after(8, 'end');
        }
      },
      end(M) { M.win('The herd is in SEAS hands.'); },
    },
  },
  // ============================================================================================ 4
  {
    id: 4, title: 'The Bayou', place: 'Atchafalaya Basin, Louisiana', date: 'August 9, 1964',
    unlocks: ['sq_watermill', 'sq_radar'],
    briefing: [
      'Three rifts have opened in the swamp, and whatever comes out of them swims. Fishermen tell of a jaw "as long as a pirogue" in the channels.',
      'Hovercraft can carry your engineers across the water. Seal the three rifts. Mind the water.',
    ],
    creatures: ['Baryonyx', 'Velociraptor', 'Deinonychus', 'Mosasaurus', 'Liopleurodon', 'Spinosaurus'],
    powers: ['supply', 'recon', 'airdrop', 'artillery'],
    res: { food: 800, wood: 900, stone: 700 },
    map: {
      seed: 4409, clear: [[160, -150, 22], [170, 180, 22], [-170, -160, 22]], setting: 'Jungle', size: 520, base: 3, water: 0, noise: [[0.008, 5], [0.03, 1.2]], ground: [0, 2, 4, 3, 6, 1],
      features: [{ type: 'river', path: [[-260, -80], [-80, -40], [40, 60], [260, 120]], w: 46, depth: 3 }, { type: 'river', path: [[-60, -260], [-30, -100], [60, 60], [80, 260]], w: 36, depth: 3 },
        { type: 'flat', x: -170, z: 170, r: 70, h: 3.5 }, { type: 'hill', x: 160, z: -150, r: 70, h: 5 }],
      roads: [{ path: [[-260, 196], [-205, 186]], width: 7, kind: 'dirt' }],
      places: [{ kind: 'farm', x: -150, z: 80, rot: 1.2 }, { kind: 'camp', x: -200, z: 210, rot: 0.2, tents: 3 }],
      forests: [{ x: 150, z: -150, r: 70, n: 50 }, { x: -170, z: -150, r: 60, n: 40 }, { x: 160, z: 190, r: 50, n: 30 }, { x: -60, z: 200, r: 40, n: 24 }],
      resources: [{ x: -170, z: 170, stone: 6, food: 6, wood: 26 }], shrubs: 260,
    },
    start: BASE(-170, 170, { garage: true, units: [['seas_hovercraft', -120, 140, 2], ['sq_booker', -150, 150, 1]] }),
    on: {
      setup(M) {
        M.objective('rifts', 'Seal the three rifts of the swamp', { of: 3 });
        M.objective('village', 'Get the people of the farm to safety (to the camp)', { of: 4, secondary: true, civ: true });
        M.zones.camp = { name: 'camp', x: -200, z: 210, r: 18, kind: 'evac' };
        civilians(M, -150, 80, 4, 14);
        // (the user: "aggression on mission 4 is too big" - was every 55-65 s from 30 s on, 18 a rift, hunting the base:
        // now the rifts' creatures guard them, fewer and slower)
        const G4 = { sealTime: 70, cap: 8, guard: 75 };
        M.rift('north', 160, -150, { ...G4, every: 100, first: 120, waves: [[['Deinonychus', 3]], [['Baryonyx', 2]], [['Velociraptor', 3], ['Baryonyx', 1]]] });
        M.rift('south', 170, 180, { ...G4, every: 110, first: 180, waves: [[['Baryonyx', 2]], [['Velociraptor', 4]], [['Spinosaurus', 1], ['Deinonychus', 2]]] });
        M.rift('west', -170, -160, { ...G4, every: 120, first: 240, waves: [[['Velociraptor', 3]], [['Baryonyx', 2]], [['Spinosaurus', 1], ['Velociraptor', 2]]] });
        // the swimmers keep to their stretch of the channels (90 m)
        for (const [cls, x, z] of [['Mosasaurus', 0, -10], ['Liopleurodon', 120, 90]]) for (const u of M.spawn(cls, 'outbreak', x, z, 1, { unit: { swim: true } })) u.sqHome = [x, z, 90];
        M.say('booker', 'Gators I can handle. Whatever made that wake is not a gator.');
        M.say('taslov', 'Three tears. Each needs its own stabilizer. Put your engineers on the hovercraft - they float over anything.');
      },
      evacuated(M, { n }) { M.progress('village', n); },
      riftClosed(M) {
        const n = M.rifts.filter((r) => !r.open).length;
        M.progress('rifts', n);
        if (n === 1) M.say('kiko', 'One down! The water around the north island just went flat calm.');
        if (n === 3 && !M.state.won) { M.state.won = true; M.say('taslov', 'Three for three. The swamp can go back to being merely unpleasant.'); M.after(8, 'end'); }
      },
      end(M) { M.win('The bayou is quiet again.'); },
    },
  },
  // ============================================================================================ 5
  {
    id: 5, title: 'Countdown at the Cape', place: 'Cape Canaveral, Florida', date: 'September 30, 1964',
    unlocks: ['sq_aa_halftrack'],
    briefing: [
      'Dr. Imai\'s team has put one of Taslov\'s stabilizers into the nose of a rocket. In orbit it can find every rift on the continent - but it has to get there first.',
      'The launch window opens in fifteen minutes. Rifts have opened on the beach. Protect Launch Complex 34 until lift-off.',
    ],
    creatures: ['Baryonyx', 'Spinosaurus', 'Velociraptor', 'Carnotaurus', 'Kronosaurus', 'Dunkleosteus'],
    powers: ['supply', 'recon', 'airdrop', 'artillery'],
    res: { food: 900, wood: 900, stone: 800 },
    map: {
      seed: 1930, clear: [[10, 0, 30], [120, -130, 22], [120, 140, 22]], setting: 'Jungle', size: 480, base: 4, water: 0, noise: [[0.006, 3], [0.03, 0.8]], ground: [6, 5, 4, 3, 6, 0],
      features: [{ type: 'basin', x: 260, z: 0, r: 220, depth: 12 }, { type: 'flat', x: -60, z: 30, r: 110, h: 4 }],
      roads: [{ path: [[-240, 30], [-60, 30], [20, 10]], width: 9, kind: 'highway' }, { path: [[-60, 30], [-60, 200]], width: 7, kind: 'street' }],
      places: [{ kind: 'launch', x: 10, z: 0, rot: 0, pad: false }, { kind: 'camp', x: -120, z: 120, rot: 0 }],
      forests: [{ x: -180, z: -150, r: 60, n: 40 }, { x: -170, z: 170, r: 50, n: 30 }], resources: [{ x: -120, z: 60, stone: 6, food: 6, wood: 26 }], shrubs: 200,
    },
    start: BASE(-130, 84, { garage: true, units: [['sq_taslov', -90, 20, 1], ['sq_aa_halftrack', -80, 40, 2]], guard: [50, 16] }),
    on: {
      setup(M) {
        M.state.pad = M.building('sq_launch_pad', 'me', 10, 0, 0);
        M.state.launch = 15 * T;
        M.objective('pad', 'Protect Launch Complex 34 until lift-off', {});
        M.rift('beachN', 120, -130, { every: 120, first: 240, target: M.state.pad, waves: [[['Velociraptor', 4]], [['Baryonyx', 2]], [['Carnotaurus', 1], ['Velociraptor', 3]], [['Spinosaurus', 1], ['Baryonyx', 2]]] });
        M.rift('beachS', 120, 140, { every: 130, first: 300, target: M.state.pad, waves: [[['Baryonyx', 2]], [['Velociraptor', 5]], [['Spinosaurus', 1], ['Carnotaurus', 1]]] });
        M.spawn('Kronosaurus', 'outbreak', 190, 0, 1, { unit: { swim: true } });
        M.spawn('Dunkleosteus', 'outbreak', 200, 60, 1, { unit: { swim: true } });
        M.say('scientist', 'Imai, flight control. Fifteen minutes, Colonel. We cannot hold the count - the window closes with the sun.');
        M.say('halloran', 'You fly the rocket, Doctor. We will keep the beach.');
        M.after(5 * T, 'ten'); M.after(10 * T, 'five'); M.after(14 * T, 'one');
      },
      ten(M) { M.say('scientist', 'T minus ten. Fuelling complete.'); },
      five(M) { M.say('scientist', 'T minus five. Gantry retracting. Please keep them off my rocket!'); for (const r of M.rifts) r.every = 90; },
      one(M) { M.say('scientist', 'T minus sixty seconds...'); },
      tick(M) {
        if (!alive(M.state.pad)) M.fail('pad');
        if (M.time >= M.state.launch && !M.state.won) {
          M.state.won = true;
          M.complete('pad');
          M.say('scientist', 'Lift-off! We have lift-off!');
          M.say('taslov', 'Now she sees all of them. And so do we.');
          M.state.flight = 0;
          M.after(12, 'end');
        }
      },
      end(M) { M.win('The stabilizer satellite is in orbit.'); },
    },
  },
  // ============================================================================================ 6
  {
    id: 6, title: 'Big Tooth', place: 'Bellingham, Washington', date: 'October 18, 1964',
    unlocks: ['sq_electric_net', 'sq_tesla_coil'],
    briefing: [
      'The satellite found a rift under a lumber town - and something came through it that the newspapers are calling Big Tooth. Bullets bounce off it. Artillery annoys it.',
      'Taslov has built electrified nets. Build them in its path, lure it onto one, and when it is stunned, put it to sleep. Then it is Booker\'s problem.',
    ],
    creatures: ['Velociraptor', 'Deinonychus', 'Allosaurus', 'Gigantosaurus'],
    powers: ['supply', 'recon', 'airdrop', 'artillery'],
    res: { food: 1000, wood: 1000, stone: 900 },
    map: {
      seed: 1018, clear: [[190, -190, 22], [-200, 120, 22], [160, -170, 16]], setting: 'Northland', size: 500, base: 6, noise: [[0.005, 8], [0.025, 1.2]], ground: [0, 2, 4, 3, 6, 1],
      features: [{ type: 'flat', x: 0, z: 0, r: 150, h: 6 }, { type: 'hill', x: 180, z: -170, r: 80, h: 18 }],
      roads: [{ path: [[-250, 170], [-100, 120], [0, 100], [250, 90]], width: 9, kind: 'highway' }],
      places: [{ kind: 'town', x: 10, z: -10, rot: 0, blocks: 2, len: 200 }, { kind: 'industry', x: 170, z: 150, rot: 0 }],
      forests: [{ x: -180, z: -170, r: 70, n: 60 }, { x: 190, z: -40, r: 50, n: 40 }, { x: -200, z: 40, r: 50, n: 30 }], resources: [{ x: -150, z: 190, stone: 6, food: 6, wood: 26 }], shrubs: 260,
    },
    start: BASE(-160, 186, { garage: true, units: [['sq_taslov', -140, 160, 1], ['sq_booker', -130, 165, 1], ['sq_tranq', -120, 170, 4, 2], ['sq_capture_truck', -110, 190, 2]] }),
    zones: [{ name: 'pen', x: -200, z: 120, r: 16, kind: 'pen' }, { name: 'shelter', x: -190, z: 210, r: 16, kind: 'evac' }],
    on: {
      setup(M) {
        M.pen('pen', -160, 186);
        M.mark(-200, 120, 'pen', 0x7dff6a);
        civilians(M, 10, -10, 10, 120);
        M.state.boss = M.spawn('sq_big_tooth', 'outbreak', 160, -170, 1)[0];
        if (M.state.boss) M.state.boss.sqScale = 1.6;
        M.rift('hill', 190, -190, { every: 70, first: 60, waves: [[['Velociraptor', 4]], [['Deinonychus', 3]], [['Allosaurus', 1], ['Velociraptor', 3]]] });
        M.objective('nets', 'Build Electrified Nets (Taslov can build them)', { of: 2, secondary: true });
        M.objective('boss', 'Stun Big Tooth on a net, put it to sleep and haul it to the pen', {});
        M.objective('people', 'Bring the townsfolk to the shelter', { of: 6, secondary: true, civ: true });
        M.say('kiko', 'I\'ve got eyes on it. It\'s - Colonel, it\'s taller than the water tower.');
        M.say('taslov', 'My nets will hold it for fifteen seconds. In those fifteen seconds every dart you have goes into it.');
        M.after(60, 'roam');
      },
      roam(M) { const b = M.state.boss; if (alive(b) && !b.sqAsleep) M.send([b], [0, 0]); M.after(45, 'roam'); },   // (not while she sleeps)
      evacuated(M, { n }) { M.progress('people', n); },
      tick(M) {
        const b = M.state.boss;
        if (b && b.obj && b.sqScale && b.obj.scale.x !== b.sqScale) b.obj.scale.setScalar(b.sqScale);
        const nets = M.W.buildings.filter((x) => x.alive && x.built && x.owner === M.me && x.name === 'sq_electric_net');
        M.progress('nets', nets.length);
        if (b && !b.alive && !M.state.dead) { M.state.dead = true; M.say('booker', 'Well. That\'s one way.'); M.complete('boss'); M.after(8, 'end'); }
      },
      netted(M, { u }) { if (u === M.state.boss) { M.notify('Big Tooth is caught in the net!', 'good'); M.say('taslov', 'Now! Darts, now!'); } },
      asleep(M, { u }) { if (u === M.state.boss) M.say('booker', 'She\'s down! Trucks, go go go!'); },
      captured(M, { u }) { if (u === M.state.boss) { M.complete('boss'); M.say('booker', 'Biggest pet in the State of Washington.'); M.after(8, 'end'); } },
      end(M) { M.win('Big Tooth will never bite again.'); },
    },
  },
  // ============================================================================================ 7
  {
    id: 7, title: 'Crane\'s Ark', place: 'Kuskokwim Mountains, Alaska', date: 'December 3, 1964',
    unlocks: ['sq_arc_halftrack'],
    briefing: [
      'Dr. Taslov is gone. His car was found on the Seattle highway; the men who took him wore the badges of Crane Industrial Security.',
      'Augustus Crane, once a director of SEAS, has built a fortress in the Alaskan snow - and he has been collecting dinosaurs. Find Taslov. Break the Ark.',
    ],
    models: ['seas_jail_part_01'],
    creatures: ['Smilodon', 'Mammoth', 'Woolly_Rhino', 'Velociraptor'],
    crane: { behaviour: 'Turtle' },
    powers: ['supply', 'recon', 'airdrop', 'artillery'],
    res: { food: 1000, wood: 1000, stone: 900 },
    map: {
      seed: 1203, clear: [[150, -150, 44], [190, -180, 14], [60, -60, 14], [40, -100, 14], [90, -40, 14]], setting: 'Icewaste', size: 520, base: 8, noise: [[0.005, 10], [0.025, 1.5]], ground: [0, 2, 4, 3, 6, 1],
      features: [{ type: 'flat', x: 150, z: -150, r: 90, h: 8 }, { type: 'flat', x: -170, z: 170, r: 70, h: 8 }, { type: 'ridge', path: [[-240, -20], [-40, -40]], w: 50, h: 22 }],
      roads: [{ path: [[-250, 190], [-60, 120], [60, 0], [150, -110]], width: 7, kind: 'dirt' }],
      places: [{ kind: 'camp', x: 200, z: -60, rot: Math.PI }],
      forests: [{ x: -170, z: -150, r: 70, n: 50 }, { x: 60, z: 180, r: 60, n: 40 }], resources: [{ x: -170, z: 170, stone: 6, food: 6, wood: 26 }, { x: 150, z: -150, stone: 4, food: 4 }], shrubs: 200,
    },
    start: BASE(-185, 200, { garage: true, units: [['sq_booker', -150, 150, 1], ['sq_jeep', -120, 160, 3], ['seas_mobile_suit', -110, 170, 2]] }),
    on: {
      setup(M) {
        const c = 'crane';
        M.state.hq = M.building('seas_headquarters', c, 150, -150, Math.PI);
        M.building('seas_barracks', c, 110, -150, Math.PI); M.building('seas_garage', c, 150, -110, Math.PI);
        for (const [x, z] of [[100, -110], [190, -110], [100, -190], [80, -140]]) M.building('seas_turret_tower', c, x, z, 0);
        M.state.jail = M.building('seas_jail_part_01', c, 190, -180, 0);
        M.spawn('sq_crane', c, 160, -170, 1);
        M.spawn('seas_gunner', c, 120, -120, 6, { level: 2 });
        M.spawn('seas_marksman', c, 130, -125, 4, { level: 2 });
        // the Ark's cages: animals Crane lets loose when the alarm goes
        M.state.cages = [[60, -60], [40, -100], [90, -40]];
        M.objective('taslov', 'Reach Crane\'s prison and free Dr. Taslov', {});
        M.objective('hq', 'Destroy Crane\'s headquarters', {});
        M.say('booker', 'Thermal scope shows a hundred heartbeats in that compound. Most of them are not human.');
        M.say('halloran', 'Then we go in fast and we go in loud. Taslov first.');
        M.after(4 * T, 'release');
      },
      release(M) {
        if (M.state.released) return;
        M.state.released = true;
        M.say('crane', 'Margaret. You were always too sentimental for this job. Meet my menagerie.');
        for (const [x, z] of M.state.cages) { M.spawn('Smilodon', 'outbreak', x, z, 2, { target: [-170, 180] }); M.spawn('Woolly_Rhino', 'outbreak', x + 8, z, 1, { target: [-170, 180] }); }
        M.spawn('Mammoth', 'outbreak', 60, -60, 2, { target: [-170, 180] });
        M.after(5 * T, 'release2');
      },
      release2(M) { M.spawn('Mammoth', 'outbreak', 90, -40, 2, { target: [-170, 180] }); M.spawn('Smilodon', 'outbreak', 40, -100, 4, { target: [-170, 180] }); },
      tick(M) {
        if (!M.state.freed && alive(M.state.jail)) {
          const here = M.near(190, -180, 18, 'me');
          if (here.length) {
            M.state.freed = true;
            M.spawn('sq_taslov', 'me', 180, -170, 1);
            M.complete('taslov');
            M.say('taslov', 'Colonel! He wants the Gate machine. He wants to open them all, permanently. He thinks he can sell dinosaurs to the Army!');
            M.say('crane', 'Not sell, Lev. Lease.');
          }
        }
        if (!M.state.freed && M.state.jail && !M.state.jail.alive) M.fail('taslov');
        if (M.state.freed && !alive(M.state.hq) && !M.state.won) {
          M.state.won = true;
          M.complete('hq');
          M.say('kiko', 'A plane just took off from behind the compound - heading south. Crane is getting away!');
          M.say('halloran', 'Let him run. We have Taslov.');
          M.after(10, 'end');
        }
        if (!M.state.released && M.near(120, -130, 80, 'me').length) M.call('release');
      },
      end(M) { M.win('The Ark is broken. Crane is on the run.'); },
    },
  },
  // ============================================================================================ 8
  {
    id: 8, title: 'The Dustriders', place: 'Monument Valley, Arizona', date: 'February 11, 1965',
    briefing: [
      'The satellite has found something new: a rift that stayed open, and a camp beside it. Not of dinosaurs - of people. Riders in bone armour, with war-dinosaurs and a chieftain called Tala.',
      'Crane\'s hunters are on their way to capture them. Decide for yourself who the enemy is.',
    ],
    tribes: ['Aje'], aje: { behaviour: 'Turtle' }, crane: { behaviour: 'Giraffe' },
    creatures: ['Velociraptor', 'Allosaurus'],
    powers: ['supply', 'recon', 'airdrop', 'artillery'],
    res: { food: 1000, wood: 1000, stone: 1000 },
    map: {
      seed: 2111, clear: [[170, -160, 44], [180, 190, 44]], setting: 'Savanna', size: 540, base: 6, noise: [[0.004, 7], [0.02, 1.4]], ground: [4, 0, 2, 3, 6, 7],
      features: [{ type: 'mesa', x: 0, z: -40, r: 50, h: 34, edge: 6 }, { type: 'mesa', x: 120, z: 120, r: 40, h: 30, edge: 6 }, { type: 'mesa', x: -120, z: -160, r: 45, h: 32, edge: 6 },
        { type: 'flat', x: 170, z: -170, r: 80, h: 6 }, { type: 'flat', x: -180, z: 180, r: 70, h: 6 }, { type: 'flat', x: 180, z: 190, r: 60, h: 6 }],
      roads: [{ path: [[-270, 200], [-120, 120], [60, 200], [270, 190]], width: 8, kind: 'dirt' }],
      places: [], rocks: [{ x: 0, z: 100, r: 120, n: 50 }], resources: [{ x: -180, z: 180, stone: 6, food: 6, wood: 26 }], forests: [{ x: -220, z: 60, r: 40, n: 24 }], shrubs: 300,
    },
    start: BASE(-180, 190, { garage: true, units: [['sq_taslov', -160, 160, 1], ['sq_booker', -150, 160, 1], ['seas_triceratops', -140, 150, 2]] }),
    on: {
      setup(M) {
        const a = 'aje';
        M.state.ajeHq = M.spawn('aje_resource_collector', a, 170, -170, 1)[0];
        M.building('aje_rodeo', a, 130, -170, 0); M.building('aje_tent', a, 200, -130, 0); M.building('aje_tent', a, 140, -130, 0);
        M.spawn('sq_tala', a, 160, -140, 1);
        M.spawn('aje_warrior', a, 150, -120, 6, { level: 2 }); M.spawn('aje_archer', a, 170, -120, 4, { level: 2 });
        M.state.craneHq = M.building('seas_headquarters', 'crane', 180, 190, Math.PI);
        M.building('seas_barracks', 'crane', 140, 200, 0); M.building('seas_turret_tower', 'crane', 150, 160, 0);
        M.spawn('seas_gunner', 'crane', 160, 160, 5, { level: 2 });
        M.objective('meet', 'Find the Dustriders\' camp (north-east)', {});
        M.say('taslov', 'They came through a rift, the same as the animals. They are as lost as we would be over there.');
        M.say('booker', 'Lost people with spears pointed at us, Doc.');
      },
      tick(M) {
        if (!M.state.met && M.near(170, -160, 90, 'me').length) {
          M.state.met = true;
          M.complete('meet');
          M.say('tala', 'Sky-riders. You smell like the men who chained my hunters.');
          M.say('halloran', 'Those men are no friends of ours. They are coming for you. We can stand with you, or watch.');
          M.say('tala', 'Then stand. If you lie, my raptors will know.');
          const a = M.player('aje');
          a.setRelation(M.me, 2); M.me.setRelation(a, 2);
          M.objective('defend', 'Keep Tala\'s camp standing', {});
          M.objective('hunters', 'Destroy the hunters\' base in the south-east', {});
          M.after(40, 'raid');
        }
        if (M.state.met && !alive(M.state.ajeHq)) M.fail('defend');
        if (M.state.met && !alive(M.state.craneHq) && !M.state.won) {
          M.state.won = true; M.complete('hunters'); M.complete('defend');
          M.say('tala', 'You did not lie. My riders will go where you go, sky-woman.');
          M.after(10, 'end');
        }
      },
      raid(M) { M.say('kiko', 'Trucks on the south road. Crane\'s hunters, with cages!'); M.spawn('seas_gunner', 'crane', 200, 220, 6, { level: 2, target: [170, -150] }); M.spawn('seas_mobile_suit', 'crane', 210, 230, 2, { target: [170, -150] }); M.after(3 * T, 'raid'); },
      end(M) { M.win('SEAS has new allies.'); },
    },
  },
  // ============================================================================================ 9
  {
    id: 9, title: 'Through the Rift', place: 'ParaWorld', date: 'March 20, 1965 (our calendar)',
    briefing: [
      'The rifts all lead to one place. Taslov believes the root is the old Gate machine of Babbit\'s Society, still humming in a temple of the other world - and that its core can be turned around.',
      'Tala will guide the expedition. Crane got there first.',
    ],
    tribes: ['Aje'], aje: { behaviour: 'Mikrobe' }, crane: { behaviour: 'Turtle' }, ajeFriendly: true,
    creatures: ['Brachiosaurus', 'Atroxosaurus', 'Triceratops', 'Velociraptor', 'Allosaurus', 'Stegosaurus'],
    powers: ['supply', 'recon', 'airdrop'],
    res: { food: 800, wood: 600, stone: 600 },
    map: {
      seed: 1490, clear: [[160, -160, 30], [-210, 210, 22], [120, -120, 40]], setting: 'Jungle', size: 520, base: 6, noise: [[0.006, 9], [0.03, 1.5]], ground: [0, 1, 4, 3, 6, 2],
      features: [{ type: 'flat', x: 160, z: -160, r: 70, h: 10 }, { type: 'hill', x: 0, z: 0, r: 90, h: 12 }, { type: 'flat', x: -180, z: 180, r: 60, h: 6 }],
      places: [{ kind: 'model', model: 'livingstone_old_seas_tempel_part_01', x: 160, z: -160, r: 12 }],
      forests: [{ x: -100, z: -100, r: 120, n: 160 }, { x: 120, z: 120, r: 110, n: 140 }, { x: 0, z: 0, r: 60, n: 40 }],
      resources: [{ x: -180, z: 180, stone: 6, food: 8, wood: 26 }], shrubs: 300,
      herds: [{ species: 'Brachiosaurus', x: 40, z: 150, n: 3 }, { species: 'Stegosaurus', x: -80, z: 40, n: 3 }],
    },
    start: { buildings: [['seas_headquarters', -180, 190, 0]], units: [['sq_halloran', -170, 160, 1], ['sq_taslov', -175, 165, 1], ['sq_booker', -165, 165, 1], ['seas_worker', -190, 160, 6], ['sq_trooper', -160, 150, 6, 2], ['sq_tranq', -150, 160, 2, 2]] },
    on: {
      setup(M) {
        M.rift('home', -210, 210, { every: 1e9, first: 1e9 });
        M.spawn('sq_tala', 'aje', -150, 170, 1); M.spawn('aje_warrior', 'aje', -140, 175, 5, { level: 2 });
        const c = 'crane';
        M.building('seas_headquarters', c, 120, -120, 0); M.building('seas_turret_tower', c, 140, -100, 0); M.building('seas_turret_tower', c, 100, -140, 0);
        M.spawn('seas_gunner', c, 130, -130, 6, { level: 3 }); M.spawn('seas_wehrspinne', c, 150, -130, 1);
        M.spawn('Atroxosaurus', 'outbreak', 30, -60, 1); M.spawn('Allosaurus', 'outbreak', -40, -150, 2); M.spawn('Velociraptor', 'outbreak', 60, 60, 4);
        M.objective('temple', 'Bring Dr. Taslov to the temple of the Gate (north-east)', {});
        M.say('taslov', 'Remarkable. The air is thicker. Everything is greener. Colonel - everything is hungrier.');
        M.say('tala', 'The temple is past the hill. The men in grey are already there. And the King of Teeth walks the valley.');
      },
      tick(M) {
        const tas = M.units('me', (u) => u.name === 'sq_taslov')[0];
        if (!tas && M.time > 5) M.lose('Dr. Taslov has fallen.');
        if (!M.state.at && tas && near(tas, 160, -160, 18)) {
          M.state.at = true; M.complete('temple');
          M.state.extract = M.time + 3 * T;
          M.objective('core', 'Hold the temple while Taslov extracts the core (3:00)', {});
          M.say('taslov', 'It is here. Babbit\'s old machine - still turning. Three minutes. Do not let anything near me.');
          M.spawn('Atroxosaurus', 'outbreak', 60, -40, 1, { target: [160, -160] }); M.spawn('Velociraptor', 'outbreak', 80, -200, 6, { target: [160, -160] });
          M.after(90, 'surge');
        }
        if (M.state.at && !M.isDone('core') && tas && !near(tas, 160, -160, 30)) M.notify('Taslov must stay at the temple!', 'bad');
        if (M.state.at && !M.isDone('core') && M.time >= M.state.extract) {
          M.complete('core');
          M.say('taslov', 'I have it. Now - home, before the door slams.');
          M.objective('home', 'Return Taslov to the rift you came through (south-west)', {});
        }
        if (M.isDone('core') && !M.state.won && tas && near(tas, -210, 210, 25)) {
          M.state.won = true; M.complete('home');
          M.say('halloran', 'Everyone through. Tala - you too. You have a place with us.');
          M.after(8, 'end');
        }
      },
      surge(M) { M.spawn('Allosaurus', 'outbreak', 220, -60, 3, { target: [160, -160] }); M.spawn('Triceratops', 'outbreak', 220, -220, 2, { target: [160, -160] }); },
      end(M) { M.win('The core of the Gate is in SEAS hands.'); },
    },
  },
  // ============================================================================================ 10
  {
    id: 10, title: 'Containment', place: 'Copper Basin, Nevada', date: 'April 1, 1965',
    briefing: [
      'Back where it began. Taslov has built a new Gate machine around the stolen core. When it reaches full charge it will pull every rift on Earth shut at once.',
      'Every rift is opening wider in protest - and Crane is coming for the machine with everything he has left. Hold for twenty minutes.',
    ],
    tribes: ['Aje'], aje: { behaviour: 'Mikrobe' }, crane: { behaviour: 'Giraffe' }, ajeFriendly: true,
    creatures: ['Velociraptor', 'Deinonychus', 'Allosaurus', 'Carnotaurus', 'Atroxosaurus', 'Triceratops', 'Smilodon', 'Spinosaurus'],
    powers: ['supply', 'recon', 'airdrop', 'artillery'],
    res: { food: 1500, wood: 1500, stone: 1500 },
    map: {
      seed: 1965, clear: [[0, 0, 30], [0, -210, 22], [210, -20, 22], [-210, -40, 22], [120, 210, 22]], setting: 'Savanna', size: 520, base: 6, noise: [[0.004, 9], [0.02, 1.5]], ground: [0, 3, 4, 7, 6, 1],
      features: [{ type: 'mesa', x: 190, z: -170, r: 60, h: 18 }, { type: 'mesa', x: -200, z: -180, r: 50, h: 14 }, { type: 'flat', x: -20, z: 0, r: 140, h: 6 }],
      roads: [{ path: [[-40, 260], [-40, 120], [-20, 40], [0, -40], [10, -260]], width: 9, kind: 'highway' }],
      places: [{ kind: 'town', x: -20, z: -60, rot: 0, blocks: 1, len: 150, empty: 0.4 }],
      rocks: [{ x: 160, z: 40, r: 60, n: 24 }], resources: [{ x: -60, z: 150, stone: 8, food: 8, wood: 26 }], forests: [{ x: -170, z: 170, r: 50, n: 30 }], shrubs: 300,
    },
    start: BASE(-100, 150, { garage: true, buildings: [['sq_searchlight', 30, 40, 0], ['sq_flak', -70, 50, 0]], units: [['sq_taslov', -10, 20, 1], ['sq_booker', -30, 40, 1], ['seas_triceratops', -40, 60, 3], ['sq_aa_halftrack', 0, 70, 2]], guard: [0, -14] }),
    on: {
      setup(M) {
        M.state.machine = M.building('sq_gate_machine', 'me', 0, 0, 0);
        M.state.full = 20 * T;
        M.spawn('sq_tala', 'aje', 40, 60, 1); M.spawn('aje_warrior', 'aje', 50, 60, 6, { level: 3 }); M.spawn('aje_archer', 'aje', 60, 70, 4, { level: 3 });
        const t = M.state.machine;
        const waves = [[['Velociraptor', 5]], [['Deinonychus', 4], ['Allosaurus', 1]], [['Carnotaurus', 2], ['Velociraptor', 4]], [['Atroxosaurus', 1], ['Deinonychus', 4]], [['Spinosaurus', 1], ['Allosaurus', 2]], [['Triceratops', 3], ['Smilodon', 3]]];
        M.rift('north', 0, -210, { every: 120, first: 240, target: t, waves });
        M.rift('east', 210, -20, { every: 130, first: 300, target: t, waves });
        M.rift('west', -210, -40, { every: 140, first: 360, target: t, waves });
        M.objective('machine', 'Protect the Gate machine until it is fully charged (20:00)', {});
        M.say('taslov', 'It is charging. Every rift on Earth can feel it. They will all come here.');
        M.say('tala', 'Let them come. My riders have not had a good fight since the jungle.');
        M.after(9 * T, 'crane'); M.after(15 * T, 'crane2'); M.after(12 * T, 'faster');
      },
      faster(M) { for (const r of M.rifts) r.every *= 0.75; M.rift('south', 120, 210, { every: 100, first: 30, target: M.state.machine, waves: [[['Allosaurus', 2], ['Velociraptor', 4]], [['Atroxosaurus', 1], ['Carnotaurus', 2]]] }); M.say('kiko', 'A fourth one just opened - south, by the farms!'); },
      crane(M) {
        M.say('crane', 'Margaret! Hand me the machine and I will make you rich. Refuse and I will take it anyway.');
        M.say('halloran', 'Come and take it.');
        M.spawn('sq_crane', 'crane', 220, 200, 1, { target: [0, 0] });
        M.spawn('seas_gunner', 'crane', 230, 210, 8, { level: 3, target: [0, 0] }); M.spawn('seas_mobile_suit', 'crane', 240, 190, 3, { target: [0, 0] }); M.spawn('seas_wehrspinne', 'crane', 220, 230, 1, { target: [0, 0] });
      },
      crane2(M) { M.spawn('seas_rocketman', 'crane', -230, 210, 8, { level: 3, target: [0, 0] }); M.spawn('seas_wehrspinne', 'crane', -220, 220, 2, { target: [0, 0] }); M.say('kiko', 'Crane\'s second column from the south-west!'); },
      tick(M) {
        if (!alive(M.state.machine)) M.fail('machine');
        const left = M.state.full - M.time;
        if (left <= 0 && !M.state.won) {
          M.state.won = true;
          M.complete('machine');
          for (const r of M.rifts) M.closeRift(r);
          for (const u of M.units('outbreak')) M.W.kill(u, null);
          M.say('taslov', 'Full charge... and - closed. All of them. Every single one.');
          M.say('halloran', 'Containment achieved. Somebody tell Washington the dinosaurs are going home.');
          M.say('tala', 'And my people? Our door is closed too.');
          M.say('taslov', 'Doors can be opened carefully, my friend. That is a different machine. Give me a year.');
          M.after(14, 'end');
        }
      },
      end(M) { M.win('The rifts are closed. The world has a new neighbour - and a door it can knock on.'); },
    },
  },
];

// the classes of the sequel a mission lets the player build: those of its own and the earlier missions' unlocks; the
// others are locked (sequelData leaves their build actions out)
export function unlockedBy(id) {
  const out = new Set();
  for (const m of MISSIONS) if (m.id <= id) for (const u of m.unlocks || []) out.add(Array.isArray(u) ? u[0] : u);
  return out;
}
export function lockedBefore(id) {
  const all = new Set(), open = unlockedBy(id);
  for (const m of MISSIONS) for (const u of m.unlocks || []) all.add(Array.isArray(u) ? u[0] : u);
  return new Set([...all].filter((n) => !open.has(n)));
}
