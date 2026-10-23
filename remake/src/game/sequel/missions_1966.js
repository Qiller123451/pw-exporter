// The sequel's second chapter, "1966" (missions 12-16; docs/SEQUEL.md): a year after Containment. Crane is back:
// 12 the heroes alone in a town full of his old menagerie, 13 a convoy through the mountains at night, 14 his rift
// engines at Lake Mead, 15 the other side of the Door, 16 the Door itself. Same handlers and M as missions.js.

const T = 60;
const near = (u, x, z, r) => Math.hypot(u.pos.x - x, u.pos.z - z) <= r;
const alive = (e) => !!e && e.alive;
const CIVS = ['sq_civilian_1', 'sq_civilian_2', 'sq_civilian_3', 'sq_civilian_4'];
function civilians(M, x, z, n, spread = 20) {
  for (let i = 0; i < n; i++) for (const u of M.spawn(CIVS[i % 4], 'civilians', x + (Math.random() - 0.5) * spread, z + (Math.random() - 0.5) * spread, 1)) { u.untargetable = true; u.sqHiding = true; }
}
const BASE = (x, z, extra = {}) => {
  const [gx, gz] = extra.guard || [x + 12, z - 4];
  return {
    buildings: [['seas_headquarters', x, z, 0], ['seas_barracks', x + 32, z + 4, 0], ...(extra.garage ? [['seas_garage', x - 2, z + 38, 0]] : []), ...(extra.buildings || [])],
    units: [['sq_halloran', x - 12, z - 22, 1], ['seas_worker', x - 4, z - 18, 6], ['sq_trooper', gx - 2, gz - 16, 4, 2], ['seas_marksman', gx + 4, gz - 22, 2, 2], ...(extra.units || [])],
  };
};
// one more for each difficulty step above normal (0 on easy)
const more = (M, n, k = 1) => Math.max(1, n + (M.difficulty === 2 ? k : M.difficulty === 0 ? -1 : 0));
// creatures that keep to a place (they take on what comes within r of it)
function guards(M, list, x, z, r, tag) {
  const out = [];
  for (const [cls, n] of list) for (const u of M.spawn(cls, 'outbreak', x + (Math.random() - 0.5) * 16, z + (Math.random() - 0.5) * 16, n)) { u.sqHome = [x, z, r]; u.sqTag = tag; out.push(u); }
  return out;
}
// Crane's men holding a place
function post(M, list, x, z, r, extra = {}) {
  const out = [];
  for (const [cls, n, lv] of list) for (const u of M.spawn(cls, 'crane', x, z, n, { level: lv || 2, ...extra })) { if (r) u.sqHome = [x, z, r]; out.push(u); }
  return out;
}
// the field medics' work after a fight: the player's units within r (all with r null) get their hit points back
function heal(M, x, z, r) {
  for (const u of M.units('me', (q) => r == null || near(q, x, z, r))) u.hp = Math.max(u.hp, u.maxHp);
}
// the bosses are drawn bigger (missions.js 6 the same way)
function scaleTick(M) {
  for (const b of M.state.big || []) if (b && b.alive && b.obj && b.sqScale && b.obj.scale.x !== b.sqScale) b.obj.scale.setScalar(b.sqScale);
}
const heroAlive = (M, name) => M.units('me', (u) => u.name === name).length > 0;

export const MISSIONS_1966 = [
  // ============================================================================================ 12
  // A heroes' mission: no base, nothing to build. The three heroes clear the town district by district; who holds
  // out in each district comes out and joins them once it is clear (the Guard, the deputies, a walker crew, two
  // tame triceratops that only Booker can calm). Old Scar waits in the stockyards.
  {
    id: 12, title: 'Main Street', place: 'Pueblo, Colorado', date: 'April 9, 1966',
    briefing: [
      'A year of quiet. The rifts stayed shut, Tala\'s people have a valley of their own in Nevada, and the last animals of Crane\'s menagerie were going by rail to the federal pens in Kansas.',
      'At dawn the train came off the rails in Pueblo and the cages came open. The town is cut off, the Guard is pinned down, and there is no time to set up a base: Colonel Halloran, Sergeant Booker and Tala go in on foot.',
      'Clear the town district by district. Whoever is still holding out in there will fight beside you once you reach them.',
    ],
    creatures: ['Velociraptor', 'Deinonychus', 'Allosaurus', 'Carnotaurus', 'Smilodon', 'Triceratops', 'Atroxosaurus'],
    powers: ['recon', 'artillery'],
    res: { food: 0, wood: 0, stone: 0 },
    camera: [-205, 205],
    map: {
      seed: 4966, clear: [[-210, 205, 20], [-215, 160, 20], [200, 205, 30]], setting: 'Savanna', size: 520, base: 6, noise: [[0.004, 5], [0.02, 1.2]], ground: [0, 3, 4, 7, 6, 1],
      features: [{ type: 'flat', x: 0, z: 0, r: 210, h: 6 }, { type: 'mesa', x: -200, z: -190, r: 50, h: 16 }, { type: 'mesa', x: 30, z: -200, r: 45, h: 14 }],
      roads: [{ path: [[-260, 215], [-170, 170], [-120, 40], [-60, 20], [40, 0], [260, -20]], width: 9, kind: 'highway' }, { path: [[150, 120], [195, 195]], width: 6, kind: 'dirt' },
        { path: [[120, -20], [150, -110]], width: 6, kind: 'dirt' }],
      places: [
        { kind: 'town', x: -60, z: -60, rot: 0, blocks: 1, len: 150 },
        { kind: 'town', x: 120, z: 50, rot: 0, blocks: 1, len: 180, landmarks: false, empty: 0.25 },
        { kind: 'farm', x: 150, z: -135, rot: 0.2 }, { kind: 'farm', x: 200, z: 210, rot: Math.PI },
        // the freight depot by the line
        { kind: 'model', model: 'sq_quonset', x: -150, z: 125, rot: 0.4, r: 12 }, { kind: 'model', model: 'sq_quonset', x: -115, z: 135, rot: 0.4, r: 12 },
        { kind: 'model', model: 'sq_crates', x: -135, z: 100, rot: 0, r: 2 }, { kind: 'model', model: 'sq_drums', x: -128, z: 96, rot: 0, r: 1.5 },
        { kind: 'model', model: 'sq_army_truck', x: -165, z: 98, rot: 0.9, r: 4, block: false }, { kind: 'model', model: 'sq_water_tower', x: -100, z: 95, rot: 0, r: 6 },
        { kind: 'model', model: 'sq_sandbags', x: -152, z: 88, rot: 0, r: 3 }, { kind: 'model', model: 'sq_sandbags', x: -146, z: 86, rot: 0.3, r: 3 },
        // the stockyards: silos and fences round Old Scar's lair
        { kind: 'model', model: 'sq_silo', x: 225, z: 185, rot: 0, r: 4 }, { kind: 'model', model: 'sq_silo', x: 170, z: 230, rot: 0, r: 4 },
        { kind: 'model', model: 'sq_bus', x: -222, z: 152, rot: 1.2, r: 4 }, { kind: 'model', model: 'sq_bus', x: -208, z: 162, rot: 1.0, r: 4 },
      ],
      forests: [{ x: -200, z: 30, r: 40, n: 20 }, { x: 60, z: 200, r: 40, n: 18 }], rocks: [{ x: -200, z: -190, r: 60, n: 20 }], shrubs: 260,
    },
    start: { buildings: [], units: [['sq_halloran', -205, 205, 1, 3], ['sq_booker', -196, 212, 1, 3], ['sq_tala', -212, 198, 1, 3]] },
    zones: [{ name: 'buses', x: -215, z: 158, r: 16, kind: 'evac' }],
    on: {
      setup(M) {
        const S = M.state;
        S.districts = [
          { id: 'depot', name: 'the freight depot', x: -140, z: 110, r: 50, foes: [['Velociraptor', more(M, 6)], ['Deinonychus', more(M, 2)]],
            join: [['sq_trooper', 4, 2], ['seas_medic', 1, 2]], jx: -150, jz: 92, who: 'guard',
            lines: ['Colonel! Captain Ruiz, Colorado Guard. We\'ve been behind these sandbags since six. Four rifles and a medic - they\'re yours.', 'Doc - see to the Colonel\'s people first.'] },
          { id: 'old', name: 'Old Town', x: -60, z: -60, r: 60, foes: [['Deinonychus', more(M, 4)], ['Velociraptor', more(M, 3)], ['Allosaurus', 1]],
            join: [['seas_marksman', 3, 3]], jx: -60, jz: -60, who: 'deputy',
            lines: ['Deputy Alvarez. Three of us up in the bank tower, and we can still shoot straight. Point us at something.'] },
          { id: 'main', name: 'Main Street', x: 120, z: 50, r: 70, foes: [['Allosaurus', 1], ['Velociraptor', more(M, 5)], ...(M.difficulty === 2 ? [['Carnotaurus', 1]] : [])],
            join: [['seas_mobile_suit', 1, 2], ['sq_jeep', 2, 1]], jx: 120, jz: 50, who: 'driver',
            lines: ['Kowalski, motor pool. My walker threw a track at the crossing and we\'ve been sitting in it all morning. Track\'s fixed. Let\'s go hunting.'] },
          { id: 'grain', name: 'the grain elevator', x: 150, z: -135, r: 50, foes: [['Smilodon', more(M, 3)], ['Velociraptor', more(M, 4)], ['Allosaurus', 1]], tame: true },
        ];
        for (const d of S.districts) { d.us = guards(M, d.foes, d.x, d.z, Math.min(45, d.r), d.id); M.mark(d.x, d.z, d.id, 0xffb040); }
        // two of the menagerie's triceratops still penned in the stock car: Booker can talk them round, anybody else
        // they would trample
        S.tame = M.spawn('Triceratops', 'outbreak', 162, -120, 2);
        for (const u of S.tame) { u.untargetable = true; u.disarmed = true; M.W.trap(u, 1e6, 'penned'); }
        // Old Scar and her pack in the stockyards
        S.boss = M.spawn('sq_old_scar', 'outbreak', 200, 200, 1)[0];
        if (S.boss) { S.boss.sqScale = 1.4; S.boss.sqHome = [200, 200, 40]; S.big = [S.boss]; }
        guards(M, [['Velociraptor', more(M, 5)], ['Deinonychus', more(M, 3)]], 195, 190, 40, 'yard');
        civilians(M, -60, -60, 5, 70); civilians(M, 120, 50, 5, 90);
        M.objective('districts', 'Clear the four districts of the town (marked on the map)', { of: 4 });
        M.objective('people', 'Bring the townsfolk to the buses on the highway', { of: [5, 7, 8][M.difficulty], secondary: true, civ: true });
        M.mark(-215, 158, 'buses', 0x7dff6a);
        M.grant(4);
        M.say('radio', 'Colonel, the Guard is pinned down at the freight depot and the sheriff\'s office has gone quiet. Everything on that train is loose.');
        M.say('halloran', 'No time for a base. We walk in, we clear it a street at a time, and we pick up everybody who can still hold a rifle.');
        M.say('tala', 'I know these animals. I hunted their cousins before your world had a name for them. Stay behind me, Booker.');
        M.say('booker', 'Ma\'am, I\'ve fed half of these by hand. Some of \'em even like me.');
        M.after(150, 'patrol');
      },
      // packs out of the stockyards hunting the heroes, until Old Scar comes out herself
      patrol(M) {
        if (M.state.bossOut || !alive(M.state.boss)) return;
        const h = M.units('me', (u) => u.name === 'sq_halloran')[0];
        const t = h ? [h.pos.x, h.pos.z] : [-200, 200];
        M.spawn('Velociraptor', 'outbreak', 190, 180, more(M, 3), { target: t }); if (M.state.patrols = (M.state.patrols || 0) + 1, M.state.patrols % 2 === 0) M.spawn('Deinonychus', 'outbreak', 195, 185, more(M, 2), { target: t });
        if (!M.state.patrolSaid) { M.state.patrolSaid = true; M.say('kiko', 'Kiko here, flying top cover. A pack just broke out of the stockyards and they\'re coming your way.'); }
        M.after([180, 150, 120][M.difficulty], 'patrol');
      },
      evacuated(M, { n }) { M.progress('people', n); if (n === 3) M.say('guard', 'Buses are filling up. Keep \'em coming, Colonel.'); },
      tick(M) {
        const S = M.state;
        scaleTick(M);
        if (!heroAlive(M, 'sq_halloran') && M.time > 5) { M.lose('Colonel Halloran has fallen.'); return; }
        if (!M.units('me').length && M.time > 5) { M.lose('Nobody is left standing in Pueblo.'); return; }
        // a district is clear when its creatures are dead and SEAS stands in it: its holdouts come out, the medics
        // patch everybody up
        for (const d of S.districts) {
          if (d.done) continue;
          if (d.us.some(alive)) continue;
          if (!M.near(d.x, d.z, d.r, 'me').length) continue;
          if (d.tame) {
            const bk = M.units('me', (u) => u.name === 'sq_booker')[0];
            const pen = S.tame.filter(alive);
            if (pen.length && !(bk && near(bk, 162, -120, 22))) {
              if (!S.tameSaid) { S.tameSaid = true; M.say('booker', 'Hold your fire on the stock car! Those two are tame - or they were. Let me walk up to them. Just me.'); M.mark(162, -120, 'stock car', 0x7dff6a, 120); }
              continue;
            }
            for (const u of pen) { u.untargetable = false; u.disarmed = false; if (u.st) u.st.t.trapped = 0; M.W.setOwner(u, M.me); u.sqHome = null; }
            if (pen.length) { M.say('booker', 'Easy, girls. Easy. Remember me? There we go.'); M.say('booker', 'Colonel - meet the cavalry.'); }
          } else {
            for (const [cls, n, lv] of d.join) M.spawn(cls, 'me', d.jx, d.jz, n, { level: lv });
            d.lines.forEach((l, i) => M.say(i === 0 ? d.who : 'guard', l));
          }
          d.done = true;
          M.unmark(d.id);
          heal(M);
          M.grant(2);                     // (command points for the artillery)
          if (d.id === 'depot') M.say('halloran', 'Good. Every district we clear, the medics get a breather to patch everybody up. Between districts, we are on our own.');
          M.notify(`${d.name[0].toUpperCase() + d.name.slice(1)} is clear`, 'good');
          M.progress('districts', S.districts.filter((x) => x.done).length);
        }
        if (M.isDone('districts') && !S.bossOut) {
          S.bossOut = true;
          M.objective('scar', 'Kill Old Scar in the stockyards (south-east)', {});
          M.mark(200, 200, 'Old Scar', 0xff5030);
          M.say('booker', 'That leaves the stockyards. Colonel, the big one in there - Crane called her Old Scar. One eye, and she remembers every man who ever put a cage on her.');
          M.say('tala', 'Then she will remember me too. Together, all of us. Not one at a time.');
          if (alive(S.boss)) S.boss.sqHome = [200, 200, 70];
        }
        if (S.boss && !S.boss.alive && !S.won) {
          S.won = true;
          M.complete('scar');
          if (!M.isDone('districts')) M.progress('districts', 4);
          M.say('halloran', 'She\'s down. Booker - how did that train come off the rails?');
          M.say('booker', 'Didn\'t come off, Colonel. Somebody cut the couplings with a torch. And they left this on the last car - a little brass crane.');
          M.say('halloran', '...He wants us to know.');
          M.after(10, 'end');
        }
      },
      end(M) { M.win('Pueblo is safe - and Augustus Crane is back.'); },
    },
  },
  // ============================================================================================ 13
  // A convoy at night: five trucks with the parts of Taslov's Door drive the pass by themselves and stop whenever
  // something is near them (or no escort is). The escort keeps them moving. Ambushes along the road: raptors off the ridges,
  // Crane's roadblock on the second leg, cats and his walkers at the tail, rocket teams on the last ridge.
  {
    id: 13, title: 'The Long Haul', place: 'Raton Pass, New Mexico', date: 'May 16, 1966',
    unlocks: [],
    briefing: [
      'Taslov has spent a year building a Door: a Gate machine that opens one passage, slowly and on purpose, to Tala\'s world. Its last parts leave Los Alamos tonight in five Army trucks.',
      'Crane wants them. The road over Raton Pass is the only way north. Escort the convoy to the depot on the far side: the trucks drive themselves, but they stop dead whenever anything comes near them.',
    ],
    night: true,
    crane: { ai: false },
    creatures: ['Velociraptor', 'Deinonychus', 'Allosaurus', 'Carnotaurus'],
    powers: ['recon', 'airdrop', 'artillery'],
    res: { food: 0, wood: 0, stone: 0 },
    camera: [-250, 210],
    // the road climbs the pass in three long switchbacks between two ridges (west-east, back, and east again), then
    // drops to the depot in the south-east
    map: {
      seed: 5166, clear: [[-255, 210, 20], [240, -205, 22], [5, 70, 26]], setting: 'Northland', size: 600, base: 7, noise: [[0.005, 6], [0.025, 1.2]], ground: [0, 2, 4, 3, 6, 1],
      features: [{ type: 'ridge', path: [[-330, 135], [150, 135]], w: 52, h: 26 }, { type: 'ridge', path: [[-160, 5], [330, 5]], w: 52, h: 26 },
        { type: 'ridge', path: [[-330, -125], [170, -125]], w: 46, h: 22 }, { type: 'hill', x: 0, z: 270, r: 60, h: 14 }],
      roads: [{ path: [[-300, 205], [-250, 200], [-150, 205], [-40, 195], [80, 205], [200, 195], [235, 140], [200, 70], [80, 65], [-40, 75], [-160, 65], [-235, 10],
        [-200, -60], [-80, -55], [40, -65], [160, -55], [230, -110], [240, -200]], width: 9, kind: 'highway' }],
      places: [{ kind: 'camp', x: 250, z: -240, rot: Math.PI, tents: 2 }],
      forests: [{ x: 60, z: 105, r: 22, n: 16 }, { x: -120, z: 100, r: 20, n: 12 }, { x: -60, z: -90, r: 22, n: 14 }, { x: 120, z: -95, r: 20, n: 12 }, { x: -200, z: 255, r: 30, n: 20 }],
      rocks: [{ x: 120, z: 250, r: 40, n: 14 }, { x: -250, z: -200, r: 40, n: 14 }], shrubs: 220,
    },
    start: { buildings: [], units: [['sq_halloran', -262, 215, 1, 3], ['sq_booker', -255, 222, 1, 3], ['sq_trooper', -268, 222, 6, 2], ['seas_medic', -272, 214, 1, 2],
      ['sq_jeep', -230, 212, 2], ['sq_aa_halftrack', -262, 232, 2], ['sq_arc_halftrack', -278, 230, 1]] },
    zones: [{ name: 'depot', x: 240, z: -205, r: 20 }],
    on: {
      setup(M) {
        const S = M.state;
        S.route = [[-250, 200], [-150, 205], [-40, 195], [80, 205], [200, 195], [235, 140], [200, 70], [80, 65], [-40, 75], [-160, 65], [-235, 10], [-200, -60], [-80, -55], [40, -65], [160, -55], [230, -110], [240, -205]];
        S.need = [3, 3, 4][M.difficulty];
        // the trucks in a column on the first stretch (the front one first)
        const [ax, az] = S.route[0], [bx, bz] = S.route[1], L = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / L, dz = (bz - az) / L;
        S.trucks = [];
        for (let i = 0; i < 5; i++) { const d = 60 - i * 13; const t = M.spawn('sq_cargo_truck', 'me', ax + dx * d, az + dz * d, 1, { heading: Math.atan2(-dz, dx) })[0]; if (t) { t.sqWp = 1; t.sqOrd = -1; S.trucks.push(t); } }
        S.delivered = 0; S.lead = 1;
        // Crane's roadblock at the cut: two towers, men behind sandbags
        S.block = [M.building('seas_turret_tower', 'crane', 0, 52, 0), M.building('seas_turret_tower', 'crane', 10, 90, 0)].filter(Boolean);
        S.blockMen = post(M, [['seas_gunner', more(M, 4), 3], ['seas_rocketman', more(M, 2), 2]], 6, 70, 30);
        M.objective('convoy', `Get the trucks to the depot over the pass (at least ${S.need} of 5)`, { of: S.need });
        M.mark(240, -205, 'depot', 0x7dff6a);
        M.grant(6);
        M.say('radio', 'Convoy, you are cleared to roll. Sixty miles of mountain and no lights after the first bend.');
        M.say('halloran', 'Trucks keep to the road and stop if anything gets close. So nothing gets close. Jeeps up front, flak in the middle, everybody else on the flanks.');
        M.say('booker', 'Funny thing about mountains at night, Colonel. Sound carries. Whatever\'s out there already knows we\'re coming.');
      },
      // the ambushes, by how far the front truck has come
      leg(M, { wp }) {
        const S = M.state, fr = S.trucks.find(alive), at = fr ? [fr.pos.x, fr.pos.z] : S.route[wp];
        const back = S.trucks.filter(alive).pop(), tail = back ? [back.pos.x, back.pos.z] : at;
        if (wp === 3) {
          M.spawn('Velociraptor', 'outbreak', -20, 140, more(M, 4), { target: at });
          M.say('kiko', 'Movement on the ridge above you! They\'re coming down for the trucks!');
        } else if (wp === 5) {
          M.spawn('Deinonychus', 'outbreak', 270, 250, more(M, 3), { target: at });
          M.spawn('Velociraptor', 'outbreak', 280, 120, more(M, 2), { target: at });
          M.say('booker', 'The bend\'s a perfect ambush spot. Which is why there\'s an ambush in it.');
        } else if (wp === 7) {
          M.say('kiko', 'Lights on the second leg - sandbags and two towers across the road. That\'s no Army roadblock.');
          M.say('crane', 'Margaret. Leave the trucks and walk home. I would so hate to see your people hurt.');
          M.say('halloran', 'Clear the road. The trucks wait until those towers are down.');
        } else if (wp === 10) {
          M.spawn('Smilodon', 'outbreak', 60, 110, more(M, 3), { target: tail });
          M.say('booker', 'Cats in the trees behind us - they\'re after the tail of the column!');
        } else if (wp === 11) {
          M.say('kiko', 'Walkers behind you, coming down the road fast - they want the last truck! And something big ahead.');
          M.send(M.spawn('seas_mobile_suit', 'crane', -40, 75, more(M, 2), { level: 2 }), S.route[10]);
          M.send(M.spawn('seas_gunner', 'crane', -30, 80, more(M, 3), { level: 3 }), S.route[10]);
          M.spawn('Carnotaurus', 'outbreak', -150, -170, 1, { target: [-200, -60] });
          if (M.difficulty > 0) M.spawn('Allosaurus', 'outbreak', -60, -170, 1, { target: [-80, -55] });
        } else if (wp === 13) {
          M.setNight(false);
          M.say('halloran', 'Sun\'s coming up. Last leg - and then downhill.');
          M.send(M.spawn('seas_rocketman', 'crane', 40, -10, more(M, 3), { level: 3 }), [40, -65]);
          M.say('kiko', 'Rocket teams up on the ridge! They\'ll have a clear shot at the road!');
        } else if (wp === 15) {
          M.spawn('Velociraptor', 'outbreak', 150, -265, more(M, 4), { target: [230, -110] });
          M.say('booker', 'And one last welcome committee by the depot, by the look of it.');
        }
      },
      died(M, { e }) {
        if (e.name === 'sq_cargo_truck' && e.owner === M.me) {
          const left = M.state.trucks.filter(alive).length;
          M.notify(`A convoy truck was destroyed (${left} left)`, 'bad');
          if (!M.state.lostSaid) { M.state.lostSaid = true; M.say('radio', 'We lost a truck! Taslov says he can build around one missing part. Not two.'); }
        }
      },
      tick(M) {
        const S = M.state, R = S.route;
        if (!heroAlive(M, 'sq_halloran') && M.time > 5) { M.lose('Colonel Halloran has fallen.'); return; }
        const trucks = S.trucks.filter(alive);
        // into the depot
        for (const t of trucks) if (near(t, 240, -205, 20)) { M.W.removeEntity(t); S.delivered++; M.notify(`Truck in the depot (${S.delivered})`, 'good'); M.progress('convoy', S.delivered); }
        const moving = S.trucks.filter(alive);
        if (S.delivered + moving.length < S.need && !S.won) { M.lose('Too many trucks were lost.'); return; }
        // what stops the convoy: creatures or Crane's men within 30 m of a truck, a tower of his within 50 m
        const ob = M.player('outbreak'), cr = M.player('crane');
        const foes = M.W.units.filter((u) => u.alive && (u.owner === ob || u.owner === cr) && !u.untargetable && !u.parked);
        const towers = M.W.buildings.filter((b) => b.alive && b.owner === cr);
        const danger = moving.some((t) => foes.some((f) => near(f, t.pos.x, t.pos.z, 30)) || towers.some((b) => near(b, t.pos.x, t.pos.z, 50)));
        // ... and no escort: the trucks do not drive on without SEAS fighting units within 45 m of one of them
        const escort = moving.length && M.units('me', (u) => u.name !== 'sq_cargo_truck' && moving.some((t) => near(u, t.pos.x, t.pos.z, 45))).length > 0;
        const why = danger ? 'danger' : !escort ? 'escort' : '';
        if (why !== (S.halted || '')) {
          S.halted = why;
          M.notify(why === 'danger' ? 'The convoy has stopped - enemies near the trucks' : why === 'escort' ? 'The convoy waits for its escort' : 'The convoy is moving again', why ? 'bad' : 'good');
        }
        moving.forEach((t, i) => {
          while (t.sqWp < R.length - 1 && near(t, R[t.sqWp][0], R[t.sqWp][1], 10)) t.sqWp++;
          // a truck that should drive but has not moved for 15 s (pushed off the road, wedged): back onto the road
          if (!t.sqAt || Math.hypot(t.pos.x - t.sqAt[0], t.pos.z - t.sqAt[1]) > 2 || S.halted) t.sqAt = [t.pos.x, t.pos.z, M.time];
          else if (M.time - t.sqAt[2] > 15) {
            const [px, pz] = R[t.sqWp - 1], [qx, qz] = R[t.sqWp];
            const L = Math.hypot(qx - px, qz - pz) || 1, k = Math.max(0, Math.min(1, ((t.pos.x - px) * (qx - px) + (t.pos.z - pz) * (qz - pz)) / (L * L)));
            M.W.teleport(t, px + (qx - px) * k, pz + (qz - pz) * k);
            t.sqAt = null; t.sqOrd = -1;
          }
          const ahead = moving[i - 1];
          const close = ahead && Math.hypot(ahead.pos.x - t.pos.x, ahead.pos.z - t.pos.z) < 15;
          if (S.halted || close) { if (t.task.type !== 'idle') M.W.order([t], { type: 'stop', auto: true }); t.sqOrd = -1; return; }
          if (t.sqOrd !== t.sqWp || t.task.type === 'idle') { t.sqOrd = t.sqWp; M.W.order([t], { type: 'move', x: R[t.sqWp][0], z: R[t.sqWp][1], auto: true }); }
        });
        const lead = Math.max(S.lead, ...moving.map((t) => t.sqWp));
        for (let w = S.lead + 1; w <= lead; w++) M.call('leg', { wp: w });
        S.lead = lead;
        if (S.delivered >= S.need && S.needT == null) S.needT = M.time;
        // the last trucks in (or 90 s after enough of them are: the stragglers do not hold up the end)
        if (S.delivered >= S.need && (!moving.length || M.time - S.needT > 90) && !S.won) {
          S.won = true;
          M.say('radio', 'Depot reports the convoy in. Dr. Taslov is - well, he is hugging a crate, Colonel.');
          M.say('halloran', 'Crane didn\'t come himself. He sent men to die for some crates and stayed home. Where is home, Kiko?');
          M.say('kiko', 'His walkers came from the south-west. I followed the tracks as far as the Nevada line. Toward the lake.');
          M.after(10, 'end');
        }
      },
      end(M) { M.win(`${M.state.delivered} of 5 trucks made it over the pass. The Door can be finished.`); },
    },
  },
  // ============================================================================================ 14
  // Base against base: Crane has built three rift engines round Lake Mead, fed from a generating station on the
  // shore. Each engine holds a rift open that sends its creatures at the player's base. A smashed engine is rebuilt
  // while the station runs - unless SEAS holds the site; the station's fall silences them all.
  {
    id: 14, title: 'Power Play', place: 'Lake Mead, Nevada', date: 'June 24, 1966',
    briefing: [
      'The rifts are opening again - three of them, around Lake Mead, all in the same week. They are not natural. Kiko has photographed the machines beside them: crude copies of Taslov\'s Gate, with Crane\'s cables running to a generating station on the shore.',
      'Smash the engines and their rifts collapse. But Crane\'s engineers will raise a smashed engine again while the station feeds them - hold its site, or cut the power at the source.',
    ],
    crane: { behaviour: 'Turtle' },
    creatures: ['Velociraptor', 'Deinonychus', 'Allosaurus', 'Carnotaurus', 'Baryonyx', 'Spinosaurus', 'Smilodon'],
    powers: ['supply', 'recon', 'airdrop', 'artillery'],
    res: { food: 1200, wood: 1200, stone: 1100 },
    map: {
      seed: 6224, clear: [[-170, -120, 26], [10, 20, 26], [200, 60, 26], [175, -175, 40]], setting: 'Savanna', size: 540, base: 5, water: 0, noise: [[0.004, 7], [0.02, 1.4]], ground: [4, 0, 2, 3, 6, 7],
      features: [{ type: 'basin', x: 260, z: -270, r: 120, depth: 14 }, { type: 'flat', x: 165, z: -160, r: 80, h: 5 }, { type: 'flat', x: -185, z: 185, r: 70, h: 5 },
        { type: 'mesa', x: -40, z: -170, r: 50, h: 20 }, { type: 'mesa', x: 90, z: 170, r: 45, h: 18 }, { type: 'mesa', x: -170, z: 30, r: 40, h: 16 }],
      roads: [{ path: [[-260, 200], [-140, 140], [0, 60], [120, -60], [180, -150]], width: 9, kind: 'highway' }],
      places: [{ kind: 'camp', x: 120, z: -200, rot: 0, tents: 3 }],
      rocks: [{ x: 40, z: -90, r: 70, n: 30 }, { x: -60, z: 100, r: 60, n: 20 }], forests: [{ x: -220, z: 100, r: 40, n: 24 }],
      resources: [{ x: -180, z: 130, stone: 8, food: 8, wood: 26 }, { x: -90, z: 200, stone: 4, food: 4, wood: 10 }], shrubs: 300,
    },
    start: BASE(-190, 190, { garage: true, units: [['sq_taslov', -170, 165, 1], ['sq_booker', -160, 168, 1], ['sq_aa_halftrack', -150, 175, 2], ['sq_shock_trooper', -150, 160, 4, 2]] }),
    on: {
      setup(M) {
        const S = M.state, c = 'crane';
        S.hq = M.building('seas_headquarters', c, 165, -160, Math.PI);
        M.building('seas_barracks', c, 125, -160, Math.PI); M.building('seas_garage', c, 165, -120, Math.PI);
        for (const [x, z] of [[120, -120], [205, -120], [130, -205]]) M.building('seas_turret_tower', c, x, z, 0);
        S.station = M.building('sq_power_station', c, 205, -205, Math.PI / 4);
        M.spawn('sq_crane', c, 175, -180, 1);
        M.spawn('seas_gunner', c, 140, -140, 6, { level: 2 }); M.spawn('seas_marksman', c, 150, -145, 3, { level: 2 });
        S.sites = [
          { id: 'west', x: -170, z: -120, waves: [[['Velociraptor', 4]], [['Deinonychus', 3], ['Velociraptor', 2]], [['Allosaurus', 1], ['Velociraptor', 3]], [['Carnotaurus', 1], ['Deinonychus', 3]]] },
          { id: 'hill', x: 10, z: 20, waves: [[['Smilodon', 2]], [['Velociraptor', 4]], [['Smilodon', 2], ['Deinonychus', 3]], [['Allosaurus', 2]]] },
          { id: 'shore', x: 200, z: 60, waves: [[['Baryonyx', 2]], [['Velociraptor', 4]], [['Baryonyx', 2], ['Deinonychus', 2]], [['Spinosaurus', 1], ['Baryonyx', 1]]] },
        ];
        for (const s of S.sites) M.call('raise', { id: s.id, first: s.id === 'west' ? 260 : s.id === 'hill' ? 320 : 380 });
        M.objective('engines', 'Silence Crane\'s three rift engines - all at once, or by cutting the power at his station by the lake', { of: 3 });
        M.objective('hq', 'Destroy Crane\'s headquarters (south-east)', {});
        M.mark(205, -205, 'station', 0xffe070);
        M.say('taslov', 'He has copied my Gate - badly. Each engine tears a little hole and holds it open with brute current. Break the engine and the hole falls shut.');
        M.say('taslov', 'But it is his station that feeds them. While it runs, his engineers can raise a broken engine in two minutes.');
        M.say('halloran', 'Then we either sit on the wreckage or we pull the plug. Booker, find me a way to the lake.');
      },
      // an engine on its site, and its rift (again, after it was smashed: a new one)
      raise(M, { id, first }) {
        const S = M.state, s = S.sites.find((q) => q.id === id);
        if (!s || S.dark) return;
        if (!alive(S.station)) return;
        if (M.near(s.x, s.z, 40, 'me').length) { M.after(30, 'raise', { id }); return; }   // SEAS holds the site
        s.engine = M.building('sq_rift_engine', 'crane', s.x, s.z - 16, 0);
        if (s.engine) s.engine.sqSite = id;
        s.rift = M.rift(id, s.x, s.z, { every: [150, 120, 100][M.difficulty], first: first ?? 40, target: [-190, 190], cap: 12, waves: s.waves });
        if (s.raised) { M.notify('Crane\'s engineers have raised a rift engine again', 'bad'); post(M, [['seas_gunner', 3, 2]], s.x, s.z, 30); }
        s.raised = (s.raised || 0) + 1;
        if (s.raised > 1 && !S.rebuiltSaid) { S.rebuiltSaid = true; M.say('booker', 'They put it back up! Next time we leave somebody sitting on the pieces.'); }
        M.call('count');
      },
      count(M) {
        const S = M.state;
        const dark = S.sites.filter((s) => !s.rift || !s.rift.open).length;
        M.progress('engines', dark);
        if (dark === 3 && !S.dark) {
          S.dark = true;
          M.say('taslov', 'All three dark! Feel that? The air just got lighter.');
          M.say('crane', 'Very well, Margaret. This side of the door is getting crowded anyway.');
        }
      },
      died(M, { e }) {
        const S = M.state;
        if (e.sqSite) {
          const s = S.sites.find((q) => q.id === e.sqSite);
          if (s && s.rift) M.closeRift(s.rift);
          if (!S.firstSmash) { S.firstSmash = true; M.say('taslov', 'One engine down - and the rift with it.'); }
          M.call('count');
          if (!S.dark && alive(S.station)) M.after(120, 'raise', { id: e.sqSite });
        }
        if (e === S.station && !S.dark) {
          M.say('taslov', 'The station! Every engine just lost its current!');
          for (const s of S.sites) { if (alive(s.engine)) M.W.kill(s.engine, null); if (s.rift) M.closeRift(s.rift); }
          M.call('count');
        }
      },
      tick(M) {
        const S = M.state;
        if (!heroAlive(M, 'sq_halloran') && M.time > 5) { M.lose('Colonel Halloran has fallen.'); return; }
        if (!alive(S.hq) && !M.isDone('hq')) {
          M.complete('hq');
          M.say('kiko', 'Crane\'s headquarters is burning - and I\'ve lost him. He drove straight into the shore rift before it closed.');
          M.say('taslov', 'Into the rift? Then he is on the other side. In Tala\'s world.');
        }
        if (M.isDone('hq') && M.isDone('engines') && !S.won) {
          S.won = true;
          M.say('halloran', 'Lev. How soon can the Door open?');
          M.say('taslov', 'A month. Less, if nobody shoots at me.');
          M.say('halloran', 'Then we are going after him.');
          M.after(10, 'end');
        }
      },
      end(M) { M.win('The engines are silent. Crane has fled - to the other side.'); },
    },
  },
  // ============================================================================================ 15
  // Through the Door into Tala's valley: a small SEAS camp beside the Dustriders' village. Crane's men come through
  // his engine in waves until it falls; his cages hold Tala's riders - freed, they join the player.
  {
    id: 15, title: 'The Other Side', place: 'The Valley of Smoke, ParaWorld', date: 'July 30, 1966 (our calendar)',
    briefing: [
      'Taslov\'s Door works. For the first time a passage between the worlds stands open on purpose - and on the other side, Crane is waiting.',
      'He has built a camp in Tala\'s home valley, and an engine to bring his men across. His hunters have caged Tala\'s riders to sell on our side.',
      'Keep the Dustriders\' village standing, break the engine, open the cages, and burn the camp.',
    ],
    tribes: ['Aje'], aje: { behaviour: 'Mikrobe' }, crane: { ai: false }, ajeFriendly: true,     // (Crane's men: the posts and the waves)
    models: ['seas_jail_part_01'],
    creatures: ['Velociraptor', 'Allosaurus', 'Tarbosaurus', 'Triceratops', 'Brachiosaurus', 'Stegosaurus'],
    powers: ['supply', 'recon', 'airdrop', 'artillery'],
    res: { food: 900, wood: 800, stone: 700 },
    map: {
      seed: 7300, clear: [[-180, 190, 26], [-60, 60, 40], [130, -130, 30], [170, -175, 40], [-40, -150, 16], [60, 110, 16], [190, 40, 16]], setting: 'Jungle', size: 540, base: 6, noise: [[0.006, 8], [0.03, 1.5]], ground: [0, 1, 4, 3, 6, 2],
      features: [{ type: 'flat', x: -60, z: 60, r: 70, h: 7 }, { type: 'flat', x: 160, z: -160, r: 80, h: 9 }, { type: 'hill', x: 60, z: -30, r: 80, h: 14 }, { type: 'flat', x: -180, z: 190, r: 60, h: 6 }],
      forests: [{ x: -150, z: -90, r: 100, n: 120 }, { x: 140, z: 150, r: 90, n: 100 }, { x: 60, z: -30, r: 50, n: 30 }, { x: -230, z: 60, r: 40, n: 30 }],
      resources: [{ x: -170, z: 140, stone: 6, food: 8, wood: 26 }], shrubs: 300,
      herds: [{ species: 'Brachiosaurus', x: 0, z: 200, n: 3 }, { species: 'Stegosaurus', x: -200, z: -200, n: 3 }],
    },
    start: { buildings: [['seas_headquarters', -180, 190, 0], ['seas_barracks', -148, 194, 0]],
      units: [['sq_halloran', -170, 160, 1], ['sq_taslov', -176, 166, 1], ['sq_booker', -164, 166, 1], ['sq_tala', -158, 158, 1], ['seas_worker', -190, 162, 6], ['sq_trooper', -150, 150, 6, 2], ['sq_tranq', -140, 160, 2, 2]] },
    on: {
      setup(M) {
        const S = M.state, a = 'aje', c = 'crane';
        M.rift('door', -215, 215, { every: 1e9, first: 1e9 });           // (Taslov's Door: nothing comes out of it)
        S.heart = M.spawn('aje_resource_collector', a, -60, 60, 1)[0];
        M.building('aje_rodeo', a, -95, 50, 0); M.building('aje_tent', a, -30, 80, 0); M.building('aje_tent', a, -70, 95, 0); M.building('aje_tent', a, -30, 35, 0);
        M.spawn('aje_warrior', a, -50, 40, 6, { level: 3 }); M.spawn('aje_archer', a, -70, 70, 4, { level: 2 });
        S.hq = M.building('seas_headquarters', c, 175, -180, Math.PI);
        M.building('seas_barracks', c, 140, -185, Math.PI); M.building('seas_turret_tower', c, 140, -150, 0); M.building('seas_turret_tower', c, 200, -140, 0);
        S.engine = M.building('sq_rift_engine', c, 125, -125, 0);
        M.spawn('seas_gunner', c, 150, -160, 6, { level: 3 }); M.spawn('seas_wehrspinne', c, 170, -150, 1);
        // the cages of Tala's riders, each watched
        S.cages = [[-40, -150], [60, 110], [190, 40]].map(([x, z]) => ({ x, z, b: M.building('seas_jail_part_01', c, x, z, 0) }));
        for (const k of S.cages) { if (k.b) { M.W.setInvulnerable(k.b, true); k.b.untargetable = true; } post(M, [['seas_gunner', more(M, 3), 2], ['seas_marksman', 1, 2]], k.x + 10, k.z + 6, 28); M.building('seas_turret_tower', c, k.x - 12, k.z - 10, 0); M.mark(k.x, k.z, 'cage', 0xffd040); }
        M.objective('village', 'Keep the Dustriders\' village standing (their great beast lives)', {});
        M.objective('engine', 'Break Crane\'s engine - it brings his men across', {});
        M.objective('cages', 'Open Crane\'s cages: Tala\'s riders will fight for you', { of: 3, secondary: true });
        M.objective('camp', 'Burn Crane\'s camp (his headquarters, south-east)', {});
        M.say('tala', 'Home. It smells of smoke - that is not our smoke.');
        M.say('taslov', 'There, past the hill: the hum of an engine. Crane brought his own door. Every few minutes it will bring more of his men.');
        M.say('tala', 'And my riders are in his cages. Colonel, I will not ask twice.');
        M.say('halloran', 'You don\'t have to ask once.');
        M.after(4 * T, 'wave');
        M.after(10 * T, 'king');
      },
      // Crane's men through his engine, at the village
      wave(M) {
        const S = M.state;
        if (!alive(S.engine)) return;
        const t = alive(S.heart) ? [S.heart.pos.x, S.heart.pos.z] : [-60, 60];
        M.send(M.spawn('seas_gunner', 'crane', 125, -105, more(M, 4), { level: 3 }), t);
        M.send(M.spawn('seas_rocketman', 'crane', 130, -100, more(M, 1), { level: 2 }), t);
        if ((S.waves = (S.waves || 0) + 1) % 3 === 0) M.send(M.spawn('seas_mobile_suit', 'crane', 120, -100, 1, { level: 2 }), t);
        M.mark(125, -125, 'wave', 0xff5a3a, 8);
        if (S.waves === 1) M.say('kiko', 'Kiko - radio relay\'s up on our side. A column just walked out of Crane\'s engine, heading for the village!');
        M.after([200, 170, 140][M.difficulty], 'wave');
      },
      king(M) {
        M.say('tala', 'Listen. The ground. The King of Teeth smells the fighting - he will come for whatever is weakest.');
        const h = M.units('me', (u) => u.name === 'sq_halloran')[0];
        const k = M.spawn('Tarbosaurus', 'outbreak', 0, 240, 1, { target: h ? [h.pos.x, h.pos.z] : [-60, 60] })[0];
        if (k) { k.sqScale = 1.4; M.state.big = [k]; }
      },
      died(M, { e }) {
        const S = M.state;
        if (e === S.engine) {
          M.complete('engine');
          M.say('taslov', 'The engine is down! No more of them can come across.');
          M.say('crane', 'A pity. It was rather expensive.');
        }
        const k = S.cages.find((q) => q.b === e && !q.open);
        if (k) { k.lost = true; M.notify('A cage was destroyed - the riders in it are lost', 'bad'); }
      },
      tick(M) {
        const S = M.state, cr = M.player('crane');
        scaleTick(M);
        if (!heroAlive(M, 'sq_halloran') && M.time > 5) { M.lose('Colonel Halloran has fallen.'); return; }
        if (!alive(S.heart)) { M.fail('village'); return; }
        // a cage opens when SEAS stands at it and none of Crane's men are left by it
        for (const k of S.cages) {
          if (k.open || k.lost || !alive(k.b)) continue;
          if (!M.near(k.x, k.z, 16, 'me').length || M.near(k.x, k.z, 24, 'crane').length) continue;
          k.open = true;
          M.W.removeEntity(k.b);
          M.unmark('cage');
          for (const q of S.cages) if (!q.open && !q.lost) M.mark(q.x, q.z, 'cage', 0xffd040);
          M.spawn('aje_warrior', 'me', k.x, k.z + 6, 3, { level: 3 }); M.spawn('aje_archer', 'me', k.x + 6, k.z + 6, 2, { level: 3 });
          const n = S.cages.filter((q) => q.open).length;
          M.progress('cages', n);
          M.say('tala', ['My riders! Take up your spears - you fight with the sky-people now.', 'More of them! Crane will pay for every chain.', 'All of my people are free. Now we finish this.'][n - 1]);
        }
        if (S.cages.every((q) => q.open || q.lost) && !M.isDone('cages')) M.fail('cages');
        if (!alive(S.hq) && !M.isDone('camp')) {
          M.complete('camp');
          M.say('kiko', 'His camp is burning. No sign of Crane - his walker went into the jungle, east, before the roof came down.');
        }
        if (M.isDone('camp') && M.isDone('engine') && !S.won) {
          S.won = true;
          M.complete('village');
          M.say('tala', 'My valley is ours again. But a man like that does not run without a reason.');
          M.say('taslov', 'Colonel - the Door\'s instruments. Somebody on our side is drawing current from it. From Copper Basin.');
          M.say('halloran', 'He doubled back. Everybody home. Now.');
          M.after(10, 'end');
        }
      },
      end(M) { M.win('The Valley of Smoke is free. Crane has gone back through - to the Door.'); },
    },
  },
  // ============================================================================================ 16
  // The finale at the Door in Copper Basin. Tala's caravans come through and walk to the Dustriders' camp; Crane has
  // wired three relay masts into the Door: it spits creatures, and they shield his Behemoth. The masts down, the
  // Behemoth can be broken; Crane climbs out of the wreck and runs for the Door - a hero who reaches him takes him.
  {
    id: 16, title: 'Open Door', place: 'Copper Basin, Nevada', date: 'August 6, 1966',
    briefing: [
      'Today the Door opens for the first time in front of the whole world: Tala\'s people come through with their herds to trade, the newspapers are on the hill, and the President is listening on the radio.',
      'Crane is here too. He has wired relay masts into the Door\'s circuit on three mesas around the basin, and something very large is walking in from the south.',
      'Keep the Door standing, bring the caravans to the Dustriders\' camp, bring down the masts, and end Augustus Crane\'s career.',
    ],
    tribes: ['Aje'], aje: { behaviour: 'Mikrobe' }, crane: { ai: false }, ajeFriendly: true,
    creatures: ['Velociraptor', 'Deinonychus', 'Allosaurus', 'Carnotaurus', 'Atroxosaurus', 'Smilodon', 'Spinosaurus'],
    powers: ['supply', 'recon', 'airdrop', 'artillery'],
    res: { food: 1500, wood: 1500, stone: 1400, power: 100 },
    map: {
      seed: 8066, clear: [[0, 0, 30], [190, -170, 20], [-200, -180, 20], [200, 120, 20], [-60, 150, 30]], setting: 'Savanna', size: 520, base: 6, noise: [[0.004, 9], [0.02, 1.5]], ground: [0, 3, 4, 7, 6, 1],
      features: [{ type: 'mesa', x: 190, z: -170, r: 55, h: 18 }, { type: 'mesa', x: -200, z: -180, r: 50, h: 16 }, { type: 'mesa', x: 200, z: 120, r: 45, h: 16 }, { type: 'flat', x: -20, z: 20, r: 140, h: 6 }],
      roads: [{ path: [[-40, 260], [-40, 120], [-20, 40], [0, -40], [10, -260]], width: 9, kind: 'highway' }, { path: [[0, -40], [190, -150]], width: 6, kind: 'dirt' }],
      places: [{ kind: 'town', x: -10, z: -90, rot: 0, blocks: 1, len: 140, empty: 0.4 }, { kind: 'camp', x: -60, z: 160, rot: 0, tents: 4 },
        { kind: 'model', model: 'sq_bus', x: 60, z: 70, rot: 0.6, r: 4 }, { kind: 'model', model: 'sq_army_truck', x: 70, z: 60, rot: 0.2, r: 3 }],
      rocks: [{ x: 120, z: 40, r: 60, n: 20 }], resources: [{ x: -150, z: 150, stone: 8, food: 8, wood: 26 }], forests: [{ x: -180, z: 60, r: 50, n: 30 }], shrubs: 300,
    },
    start: BASE(-130, 140, { garage: true, buildings: [['sq_searchlight', 30, 30, 0], ['sq_flak', -30, -30, 0], ['sq_flak', 40, -20, 0]],
      units: [['sq_taslov', -10, 20, 1], ['sq_booker', -30, 40, 1], ['sq_tala', 20, 30, 1], ['seas_triceratops', -40, 60, 2], ['sq_aa_halftrack', 0, 60, 2], ['sq_arc_halftrack', 10, 50, 1]], guard: [0, 20] }),
    zones: [{ name: 'camp', x: -60, z: 160, r: 24, kind: 'evac' }],
    civName: 'A Dustrider',
    on: {
      setup(M) {
        const S = M.state;
        S.door = M.building('sq_gate_machine', 'me', 0, 0, 0);
        M.spawn('aje_warrior', 'aje', -50, 150, 4, { level: 2 });
        S.masts = [[190, -170], [-200, -180], [200, 120]].map(([x, z]) => M.building('sq_relay_mast', 'crane', x, z, 0)).filter(Boolean);
        for (const m of S.masts) { post(M, [['seas_gunner', more(M, 3), 3], ['seas_rocketman', 1, 2]], m.pos.x - 10, m.pos.z + 10, 30); M.building('seas_turret_tower', 'crane', m.pos.x + 12, m.pos.z + 12, 0); M.mark(m.pos.x, m.pos.z, 'mast', 0xff5030); }
        S.caravans = 0; S.arrived = 0; S.need = [6, 8, 10][M.difficulty];
        M.objective('door', 'Keep the Door standing', {});
        M.objective('caravans', `Bring Tala's caravans from the Door to the Dustriders' camp (${S.need} riders)`, { of: S.need, secondary: true });
        M.objective('masts', 'Bring down Crane\'s three relay masts on the mesas', { of: 3 });
        M.mark(-60, 160, 'camp', 0x7dff6a);
        M.say('radio', 'Copper Basin, this is Washington. The President is on the line. The Door may open when ready.');
        M.say('taslov', 'Opening... now. Ladies and gentlemen - the other world.');
        M.say('tala', 'My people are coming through. Walk them to the camp, Colonel. They have never seen a road.');
        M.after(20, 'caravan'); M.after(150, 'hijack'); M.after(4 * T, 'column'); M.after(8 * T, 'behemoth'); M.after(11 * T, 'column');
      },
      caravan(M) {
        const S = M.state;
        if (S.caravans >= 4 || S.over) return;
        S.caravans++;
        // (the civilians' side: they follow the first SEAS unit that reaches them to the camp - runtime civilianTick)
        const us = [...M.spawn('aje_warrior', 'civilians', 0, 22, 3, { level: 2 }), ...M.spawn('aje_archer', 'civilians', 4, 24, 1, { level: 2 })];
        for (const u of us) u.sqTag = 'caravan';
        M.notify(`A caravan has come through the Door (${S.caravans} of 4)`, 'good');
        M.after(140, 'caravan');
      },
      evacuated(M, { n }) { M.state.arrived = n; M.progress('caravans', n); if (n === 4) M.say('tala', 'They are in the camp - and staring at your trucks, Booker.'); },
      // Crane's masts take over the Door's circuit: it spits his creatures
      hijack(M) {
        const S = M.state;
        if (!S.masts.some(alive)) return;
        S.wild = M.rift('door', 0, -26, { every: [120, 100, 85][M.difficulty], first: 15, target: [-130, 140], cap: 14,
          waves: [[['Velociraptor', 4]], [['Deinonychus', 3], ['Velociraptor', 2]], [['Allosaurus', 1], ['Deinonychus', 3]], [['Carnotaurus', 1], ['Smilodon', 2]], [['Atroxosaurus', 1], ['Velociraptor', 4]], [['Spinosaurus', 1], ['Allosaurus', 1]]] });
        if (S.wild && S.wild.e) M.W.removeEntity(S.wild.e);       // (no second ring: it comes out of the Door itself)
        M.say('taslov', 'No - no, no! The Door is drawing current from outside. Something is pushing it wide open!');
        M.say('crane', 'Good afternoon, Margaret. Lev\'s Door is a lovely piece of work. I have simply added a few improvements.');
        M.say('taslov', 'The masts on the mesas - he is feeding the Door through them. Bring them down and it is mine again.');
      },
      column(M) {
        const t = [0, 0];
        M.send(M.spawn('seas_gunner', 'crane', 230, -60, more(M, 5), { level: 3 }), t); M.send(M.spawn('seas_mobile_suit', 'crane', 235, -40, more(M, 1), { level: 2 }), t);
        M.send(M.spawn('seas_rocketman', 'crane', -230, 30, more(M, 4), { level: 3 }), t);
        M.say('kiko', 'Columns from east and west, Colonel - Crane\'s men, going for the Door.');
      },
      behemoth(M) {
        const S = M.state;
        S.boss = M.spawn('sq_behemoth', 'crane', 10, -245, 1)[0];
        if (S.boss) M.send([S.boss], [0, 0]);
        if (!S.boss) return;
        S.boss.sqScale = 1.6; S.big = [S.boss];
        if (S.masts.some(alive)) M.W.setInvulnerable(S.boss, true);
        M.send(M.spawn('seas_gunner', 'crane', 0, -240, more(M, 4), { level: 3 }), [0, 0]);
        M.objective('behemoth', 'Break the Behemoth before it reaches the Door', {});
        M.mark(10, -245, 'Behemoth', 0xff5030, 20);
        M.say('kiko', 'Colonel... it\'s a walker. A walker the size of a church, coming up the south road!');
        M.say('crane', 'Meet the Behemoth. The Door will be mine, Margaret - and so will everything beyond it.');
        if (S.masts.some(alive)) M.say('taslov', 'There is a field round it - the same current from the masts! While one mast stands, nothing will scratch it.');
      },
      died(M, { e }) {
        const S = M.state;
        if (S.masts.includes(e)) {
          const n = S.masts.filter((m) => !m.alive).length;
          M.progress('masts', n);
          M.say('taslov', ['One mast down! The Door\'s current is dropping.', 'Two! One more, Colonel!', 'The last one! The Door is mine again!'][n - 1]);
          if (n === 3) {
            if (S.wild) M.closeRift(S.wild);
            if (alive(S.boss)) { M.W.setInvulnerable(S.boss, false); M.say('booker', 'And that big ugly thing just lost its shield. Everybody - shoot the legs!'); }
          }
        }
        if (e === S.boss) M.call('eject');
        if (e === S.crane && !S.over) {
          S.over = true;
          M.complete('crane');
          M.say('halloran', 'Augustus Crane is dead. It didn\'t have to end like that.');
          M.say('tala', 'For him, it did.');
          M.after(10, 'end');
        }
      },
      // Crane climbs out of the wreck and runs for the Door
      eject(M) {
        const S = M.state, b = S.boss;
        M.complete('behemoth');
        const x = b ? b.pos.x : 0, z = b ? b.pos.z : -100;
        S.crane = M.spawn('sq_crane', 'crane', x + 6, z, 1, { level: 3 })[0];
        if (!S.crane) { S.over = true; M.after(10, 'end'); return; }
        S.crane.hp = S.crane.maxHp * 0.5;
        M.W.order([S.crane], { type: 'move', x: 0, z: -10, auto: true });
        M.objective('crane', 'Crane is running for the Door: catch him - get a hero to him (Halloran, Booker or Tala)', {});
        M.say('kiko', 'Somebody just climbed out of the wreck - it\'s Crane! He\'s running for the Door!');
        M.say('halloran', 'He wants to disappear on the other side. Not today.');
      },
      tick(M) {
        const S = M.state;
        scaleTick(M);
        if (!alive(S.door)) { M.fail('door'); return; }
        if (!heroAlive(M, 'sq_halloran') && M.time > 5) { M.lose('Colonel Halloran has fallen.'); return; }
        // the caravans: lost when too few are left to reach the camp
        if (!M.isDone('caravans') && S.caravans >= 4) {
          const out = M.units('civilians', (u) => u.sqTag === 'caravan').length;
          if (S.arrived + out < S.need) M.fail('caravans');
        }
        // the Behemoth at the Door
        const b = S.boss;
        if (alive(b) && b.task.type === 'idle') M.send([b], [0, 0]);
        // Crane on the run
        const c = S.crane;
        if (alive(c) && !S.over) {
          if (c.task.type === 'idle') M.W.order([c], { type: 'move', x: 0, z: -10, auto: true });
          const hero = M.units('me', (u) => /^sq_(halloran|booker|tala)$/.test(u.name) && near(u, c.pos.x, c.pos.z, 8))[0];
          if (hero) {
            S.over = true;
            M.W.removeEntity(c);
            M.complete('crane');
            M.say('crane', 'Margaret. I suppose you will want me to say something gracious.');
            M.say('halloran', 'I want you to say nothing at all, all the way to Washington. Augustus Crane, you are under arrest.');
            M.after(10, 'end');
          } else if (near(c, 0, -10, 8)) {
            S.over = true;
            M.W.removeEntity(c);
            M.say('taslov', 'He is through! He went through the Door!');
            M.lose('Crane escaped through the Door.');
          }
        }
      },
      end(M) {
        const S = M.state;
        for (const u of M.units('outbreak')) M.W.kill(u, null);
        if (S.wild && S.wild.open) M.closeRift(S.wild);
        M.complete('door');
        M.say('taslov', 'The Door is steady. Open - and ours to close.');
        M.say('tala', 'Then leave it open a while, Lev. My people have come a long way to see your roads.');
        M.say('halloran', 'Washington, Copper Basin. The Door is open. Containment... has a new meaning.');
        M.win('The Door stands open, and Augustus Crane will never close it.');
      },
    },
  },
];
