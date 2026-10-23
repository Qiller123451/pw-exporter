// The scenarios (docs/SCENARIOS.md): five standalone missions in ParaWorld's own world, apart from both campaigns,
// each played as any of the four tribes. They run on the sequel's mission runtime (game/sequel/runtime.js, M) with
// the game's normal rules and data - the base game's or MIRAGE's, whichever is in use.
//
// A scenario is its texts plus make(tribe, difficulty): the rest of a mission definition (missions.js has the
// fields) made for the tribe played - its start, its enemies (always of other tribes), the classes its script puts
// down. make must give the same for the same arguments (a saved game makes the definition again).
// Class names may be lists: the first the data has is taken (M.cls) - the base game lacks a few of MIRAGE's.
// Coordinates: x east, z south, metres from the map's centre.

import * as THREE from 'three';

export const SCENARIO_TRIBES = ['Hu', 'Aje', 'Ninigi', 'SEAS'];
export const TRIBE_NAMES = { Hu: 'Norsemen', Aje: 'Dustriders', Ninigi: 'Dragon Clan', SEAS: 'SEAS' };

const T = 60;
const near = (u, x, z, r) => Math.hypot(u.pos.x - x, u.pos.z - z) <= r;
const alive = (e) => !!e && e.alive;
const fmt = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
// one more for each difficulty step above normal (one less on easy), at least 1
const more = (M, n, k = 1) => Math.max(1, n + (M.difficulty === 2 ? k : M.difficulty === 0 ? -k : 0));

// (the computer players' behaviours: ai/brain.js - Giraffe, Dodo, Schnecke, Turtle play; Mikrobe only sleeps)
// what each tribe fields: its main building (a unit for the Dustriders), worker, heroes and units by role
export const KIT = {
  Hu: { base: 'hu_fireplace', worker: 'hu_worker', hero: ['Bela_s0'], warrior: ['hu_warrior'], archer: ['hu_archer'], spear: ['hu_spearman'], beast: ['hu_rhino', 'hu_mammoth'],
    tower: ['hu_small_tower'], temple: ['hu_temple'], titan: ['hu_colossi', 'hu_mammoth'] },
  Aje: { base: 'aje_resource_collector', worker: 'aje_worker', hero: ['Tarna_s0', 'Cole_s0'], warrior: ['aje_warrior'], archer: ['aje_archer'], spear: ['aje_spearman'], beast: ['aje_stegosaurus', 'aje_triceratops_archer'],
    tower: ['aje_small_tower'], temple: ['aje_temple'], titan: ['aje_tyrannosaurus', 'aje_brachiosaurus'] },
  Ninigi: { base: 'ninigi_fireplace', worker: 'ninigi_worker', hero: ['Miyagi_s0', 'hermit_s0'], warrior: ['ninigi_warrior'], archer: ['ninigi_archer'], spear: ['ninigi_spearman'], beast: ['ninigi_triceratops', 'ninigi_sumo'],
    tower: ['ninigi_small_tower'], temple: ['ninigi_temple'], titan: ['ninigi_kong', 'ninigi_seismosaurus'] },
  SEAS: { base: 'seas_headquarters', worker: 'seas_worker', hero: ['lovelace_s0'], warrior: ['seas_warrior'], archer: ['seas_gunner'], spear: ['seas_marksman'], beast: ['seas_mobile_suit', 'seas_triceratops'],
    tower: ['seas_turret_tower'], temple: ['seas_laboratory', 'seas_barracks'], titan: ['seas_rex', 'seas_mobile_suit'] },
};
// the hero's voice on the radio (game/sequel/cast.js) by the class the data gave
const VOICE = { Bela_s0: 'bela', Tarna_s0: 'tarna', Cole_s0: 'cole', Miyagi_s0: 'miyagi', hermit_s0: 'hermit', lovelace_s0: 'ada' };
const UNDEAD = { warrior: ['hu_zombie_warrior', 'hu_undead_warrior'], archer: ['hu_zombie_archer', 'hu_undead_warrior'], brute: ['hu_zombie_killer', 'hu_undead_warrior'], king: ['schliemann_zombie', 'hu_undead_warrior'] };
// the enemy tribe of a scenario: the first of its order that is not the player's
const other = (tribe, order) => order.find((t) => t !== tribe);

// the player's start: the main building, workers, the tribe's hero and a few fighters
function camp(tribe, x, z, o = {}) {
  const K = KIT[tribe];
  const lv = o.level || 1;
  return {
    buildings: [...(tribe === 'Aje' ? [] : [[K.base, x, z, 0]]), ...(o.buildings || [])],
    units: [...(tribe === 'Aje' ? [[K.base, x, z, 1]] : []), [K.worker, x - 8, z - 16, o.workers ?? 6], [K.hero, x + 10, z - 18, 1, o.heroLevel || 2],
      [K.warrior, x + 16, z - 8, o.warriors ?? 4, lv], [K.archer, x + 20, z - 14, o.archers ?? 3, lv], ...(o.beasts ? [[K.beast, x - 16, z - 6, o.beasts, lv]] : []), ...(o.units || [])],
  };
}
// a computer player's settlement put down by the script: its main building, towers, workers, an army (none for a
// computer player that plays: an army it starts with it sends off at once - ai/brain.js "pyramid" attacks)
function settle(M, role, tribe, x, z, o = {}) {
  const K = KIT[tribe];
  const home = tribe === 'Aje' ? M.spawn(K.base, role, x, z, 1)[0] : M.building(K.base, role, x, z, o.rot || 0);
  for (const [dx, dz] of o.towers || [[24, 18], [-24, 18], [24, -18], [-24, -18]]) M.building(K.tower, role, x + dx, z + dz, 0);
  M.spawn(K.worker, role, x + 6, z + 14, o.workers ?? 6);
  M.spawn(K.warrior, role, x - 10, z + 22, o.warriors ?? 5, { level: o.level || 1 });
  M.spawn(K.archer, role, x + 10, z + 22, o.archers ?? 4, { level: o.level || 1 });
  if (o.beasts) M.spawn(K.beast, role, x, z + 30, o.beasts, { level: o.level || 1 });
  if (o.hero) M.spawn(K.hero, role, x, z + 10, 1, { level: o.level || 2 });
  return home;
}
// the fighters of a role, without workers and the Dustriders' resource collector
const army = (M, role) => M.units(role, (u) => !u.isWorker && !/resource_collector/.test(u.name) && !u.sqEnvoy);
// creatures that keep to a place (they take on what comes within r of it): M.state.big lists the drawn-bigger ones
function beast(M, cls, x, z, o = {}) {
  const u = M.spawn(cls, 'outbreak', x, z, 1)[0];
  if (!u) return null;
  if (o.hp) { u.maxHp *= o.hp; u.hp = u.maxHp; }
  if (o.scale) { u.sqScale = o.scale; (M.state.big = M.state.big || []).push(u); }
  u.sqHome = [x, z, o.r || 35];
  return u;
}
function guards(M, list, x, z, r, tag) {
  const out = [];
  for (const [cls, n] of list) for (const u of M.spawn(cls, 'outbreak', x + (Math.random() - 0.5) * 14, z + (Math.random() - 0.5) * 14, n)) { u.sqHome = [x, z, r]; u.sqTag = tag; out.push(u); }
  return out;
}
function scaleTick(M) {
  for (const b of M.state.big || []) if (b && b.alive && b.obj && b.sqScale && b.obj.scale.x !== b.sqScale) b.obj.scale.setScalar(b.sqScale);
}
// lost when the player's main building (the Dustriders' collector) is gone and no worker is left to start again
function homeLost(M) {
  if (M.time < 5) return false;
  return !M.home(M.me) && !M.units('me', (u) => u.isWorker).length;
}
function hero(M) { return M.units('me', (u) => u.name === M.state.heroCls)[0] || null; }
function startHero(M) {
  M.state.heroCls = M.cls(KIT[M.tribe].hero);
  M.state.v = VOICE[M.state.heroCls] || 'bela';
}
// a strike out of the sky (the volcano's): marked on the map, then it hits everybody within 8 m
function strike(M, x, z, dmg = 220) {
  const W = M.W, p = new THREE.Vector3(x, W.height(x, z), z);
  if (M.G.fx) { M.G.fx.explosion(p, 1.6); if (M.G.fx.dust) M.G.fx.dust(p.clone(), 3); }
  W.areaDamage(null, p, 9, dmg, dmg * 0.25, { owner: M.player('outbreak'), direct: true, size: 8 });
}

export const SCENARIOS = [
  // ============================================================================================ 1
  // A race: five legendary beasts keep to their lairs in the valley; the first tribe to bring down three wins. The
  // rival tribe builds up like a computer player and sends hunting parties after the beasts nearest to it.
  {
    id: 1, title: 'The Great Hunt', place: 'The Valley of Bones', setting: 'Savanna',
    briefing: [
      'Every hundred years the clans meet for the Great Hunt. Five legendary beasts roam the Valley of Bones: Old Tusk the mammoth, Threehorn, Whitefang and his pack, Skyneck the giant - and the King of Teeth.',
      'The tribe that brings down three of them first wins the valley for a hundred years. A rival tribe has made camp on the far side, and its hunters are already sharpening their spears.',
    ],
    make(tribe) {
      const foe = other(tribe, ['Ninigi', 'Hu', 'Aje', 'SEAS']);
      return {
        foeTribe: foe,
        foe: { tribe: foe, name: `The ${TRIBE_NAMES[foe]} hunters`, behaviour: 'Schnecke', res: { food: 2000, wood: 2000, stone: 1500 } },
        creatures: ['Mammoth', 'Woolly_Rhino', 'Triceratops', 'Smilodon', 'Brachiosaurus', 'Stegosaurus', 'Tarbosaurus', 'Velociraptor'],
        res: { food: 700, wood: 600, stone: 500 },
        epoch: 2,
        powers: [],
        map: {
          seed: 3101, setting: 'Savanna', size: 560, base: 6, noise: [[0.004, 7], [0.02, 1.4]], ground: [0, 1, 4, 3, 6, 5],
          clear: [[-200, 200, 30], [200, -200, 30], [0, 0, 26], [170, 170, 22], [-170, -170, 22], [-150, 40, 20], [40, -150, 20]],
          features: [{ type: 'flat', x: -200, z: 200, r: 60, h: 6 }, { type: 'flat', x: 200, z: -200, r: 60, h: 6 }, { type: 'mesa', x: -60, z: 90, r: 40, h: 16 }, { type: 'mesa', x: 90, z: -60, r: 40, h: 16 },
            { type: 'hill', x: 0, z: 0, r: 70, h: 8 }],
          places: [...[[-12, 6], [10, -14], [16, 12]].map(([dx, dz]) => ({ kind: 'model', model: 'sav_skeleton_01', x: dx, z: dz, rot: dx, r: 3, block: false })),
            { kind: 'model', model: 'graveyard_skull_01', x: 168, z: 160, rot: 0, r: 2, block: false }, { kind: 'model', model: 'graveyard_skull_02', x: -160, z: -168, rot: 0, r: 2, block: false }],
          forests: [{ x: -200, z: 60, r: 50, n: 30 }, { x: 60, z: -200, r: 50, n: 30 }, { x: -60, z: -60, r: 40, n: 20 }, { x: 110, z: 110, r: 40, n: 20 }],
          rocks: [{ x: -220, z: -40, r: 40, n: 14 }, { x: -40, z: -220, r: 40, n: 14 }],
          resources: [{ x: -200, z: 160, stone: 6, food: 8, wood: 20 }, { x: 160, z: -200, stone: 6, food: 8, wood: 20 }], shrubs: 300,
        },
        start: camp(tribe, -200, 200, { level: 2 }),
      };
    },
    on: {
      setup(M) {
        const S = M.state;
        startHero(M);
        S.home = settle(M, 'foe', M.def.foeTribe, 200, -200, { level: 2, hero: true, warriors: 0, archers: 0 });
        const B = (id, name, cls, x, z, o, g) => ({ id, name, x, z, e: beast(M, cls, x, z, o), g: g ? guards(M, g, x, z, 35, id) : [] });
        S.beasts = [
          B('tusk', 'Old Tusk', 'Mammoth', -170, -170, { hp: 4, scale: 1.4, r: 35 }, [['Woolly_Rhino', more(M, 2)]]),
          B('horn', 'Threehorn', 'Triceratops', -150, 40, { hp: 4, scale: 1.4 }, [['Triceratops', 1]]),
          B('fang', 'Whitefang', 'Smilodon', 40, -150, { hp: 5, scale: 1.5 }, [['Smilodon', more(M, 3)]]),
          B('neck', 'Skyneck', 'Brachiosaurus', 0, 0, { hp: 3, scale: 1.3, r: 30 }, [['Stegosaurus', more(M, 2)]]),
          B('king', 'the King of Teeth', 'Tarbosaurus', 170, 170, { hp: 5, scale: 1.5, r: 40 }, [['Velociraptor', more(M, 4)]]),
        ];
        for (const b of S.beasts) M.mark(b.x, b.z, b.name, 0xffb040);
        S.mine = 0; S.theirs = 0;
        M.objective('hunt', 'Bring down three of the five legendary beasts before the rivals do', { of: 3 });
        M.say('herald', `Hear me, hunters! Five beasts, two tribes, one valley. The ${TRIBE_NAMES[M.tribe]} and the ${TRIBE_NAMES[M.def.foeTribe]} - the first to bring down three takes it all!`);
        M.say(S.v, 'Threehorn grazes near our camp. Old Tusk lives in the north-west. Let them have the far ones - if they can.');
        M.say('scout', 'The beasts will not come to us. Each keeps to its lair, and the big ones do not go down easily. Bring the whole tribe.');
        M.after(4 * T, 'party');
        M.after(150, 'note');
      },
      note(M) { M.say('elder', 'A beast brought down feeds the whole tribe for a season. The hunters who strike the last blow carry the honour.'); },
      // the rivals' hunting parties: at the living beast nearest to their camp
      party(M) {
        const S = M.state, K = KIT[M.def.foeTribe];
        if (S.over) return;
        const left = S.beasts.filter((b) => alive(b.e)).sort((a, b) => Math.hypot(a.x - 200, a.z + 200) - Math.hypot(b.x - 200, b.z + 200));
        if (!left.length) return;
        const t = left[0], n = (S.parties = (S.parties || 0) + 1);
        const us = [...M.spawn(K.warrior, 'foe', 190, -180, more(M, 3 + n), { level: 2 }), ...M.spawn(K.archer, 'foe', 200, -175, more(M, 2 + Math.floor(n / 2)), { level: 2 }),
          ...(n >= 3 ? M.spawn(K.beast, 'foe', 205, -185, n >= 5 ? 2 : 1, { level: 2 }) : [])];
        M.send(us, [t.x, t.z]);
        M.say('scout', `A ${TRIBE_NAMES[M.def.foeTribe]} hunting party is out - heading for ${t.name}!`);
        M.mark(t.x, t.z, 'hunted', 0xff5030, 30);
        M.after([240, 200, 160][M.difficulty], 'party');
      },
      died(M, { e }) {
        const S = M.state, b = S.beasts && S.beasts.find((x) => x.e === e);
        if (!b || S.over) return;
        const by = e.lastDamager || null;                    // (the player whose blow was the last: combat.js)
        M.unmark(b.name);
        if (by === M.me || (by && M.me.isFriend(by))) {
          S.mine++;
          M.progress('hunt', S.mine);
          for (const r of ['food', 'wood', 'stone']) M.me.res[r] += 250;
          M.notify(`${b.name} has fallen to your hunters! (+250 of each resource)`, 'good');
          M.say(S.v, [`${b.name} is ours! One trophy for the fire.`, `${b.name} - two! One more and the valley is ours.`, `${b.name}! Three! Let the herald sing of us.`][Math.min(2, S.mine - 1)]);
        } else if (by === M.player('foe')) {
          S.theirs++;
          M.notify(`The rivals brought down ${b.name} (${S.theirs} of 3)`, 'bad');
          M.say('herald', `${b.name} has fallen to the ${TRIBE_NAMES[M.def.foeTribe]}! That is ${S.theirs}.`);
        } else M.notify(`${b.name} is dead - nobody claims it`, '');
      },
      tick(M) {
        const S = M.state;
        scaleTick(M);
        const o = M.objectives.find((x) => x.id === 'hunt');
        if (o) o.note = `You ${S.mine} · ${TRIBE_NAMES[M.def.foeTribe]} ${S.theirs} · ${S.beasts.filter((b) => alive(b.e)).length} beasts left`;
        if (S.over) return;
        if (homeLost(M)) { S.over = true; M.lose('Your camp has fallen.'); return; }
        if (S.theirs >= 3) { S.over = true; M.lose(`The ${TRIBE_NAMES[M.def.foeTribe]} brought down three beasts first.`); return; }
        // no beasts left for three: the valley goes to whoever has more, else (one each, the rest dead) it is lost
        if (S.mine < 3 && S.mine + S.beasts.filter((b) => alive(b.e)).length < 3) { S.over = true; M.lose('Too few beasts are left to win the Hunt.'); return; }
        if (S.mine >= 3) {
          S.over = true;
          M.say('herald', `The Hunt is over! The Valley of Bones belongs to the ${TRIBE_NAMES[M.tribe]}!`);
          M.after(8, 'end');
        }
      },
      end(M) { M.win(`The ${TRIBE_NAMES[M.tribe]} won the Great Hunt.`); },
    },
  },
  // ============================================================================================ 2
  // Ten waves of the dead out of the barrows in the north, through the only pass to the lowlands; a countdown to each
  // wave, the dead get more and nastier, night falls before the eighth, the Barrow King himself leads the tenth.
  {
    id: 2, title: 'The Last Pass', place: 'The Barrow Pass, Northland', setting: 'Northland',
    briefing: [
      'The old barrows north of the mountains have opened, and the dead are walking. Between them and every village in the lowlands stands one pass - and your people.',
      'Hold the pass against ten waves. Build between the waves: walls, towers, an army. The tenth wave will be led by the Barrow King himself.',
    ],
    make(tribe) {
      return {
        looks: { outbreak: { name: 'The Dead' } },
        creatures: ['Smilodon', 'Mammoth'],
        models: [...UNDEAD.warrior, ...UNDEAD.archer, ...UNDEAD.brute, ...UNDEAD.king],
        res: { food: 900, wood: 1000, stone: 800 },
        epoch: 2,
        powers: [],
        map: {
          seed: 3202, setting: 'Northland', size: 520, base: 6, noise: [[0.005, 5], [0.025, 1.2]], ground: [0, 1, 4, 3, 6, 2],
          clear: [[0, 190, 30], [-60, -95, 22], [60, -95, 22], [0, 30, 20]],
          // the mountains: two ranges with the pass between them at z = 30 (about 60 m wide at the bottom: a ridge's
          // flank reaches w beyond its end), the barrow field beyond
          features: [{ type: 'ridge', path: [[-320, 30], [-100, 30]], w: 70, h: 34 }, { type: 'ridge', path: [[100, 30], [320, 30]], w: 70, h: 34 },
            { type: 'flat', x: 0, z: 170, r: 90, h: 6 }, { type: 'flat', x: 0, z: -100, r: 90, h: 5 }],
          places: [...[[-60, -95], [60, -95], [0, -130], [-110, -120], [110, -120]].map(([x, z], i) => ({ kind: 'model', model: `northland_obelisk_0${(i % 7) + 1}`, x, z: z - 14, rot: i, r: 3 })),
            ...[[-40, -80], [30, -70], [80, -130], [-90, -130], [0, -60]].map(([x, z], i) => ({ kind: 'model', model: `graveyard_skeleton_0${(i % 7) + 1}`, x, z, rot: i * 1.3, r: 2, block: false })),
            { kind: 'model', model: 'hc_ruins_module_03', x: -24, z: 40, rot: 0, r: 6 }, { kind: 'model', model: 'hc_ruins_module_05', x: 26, z: 44, rot: 3.1, r: 6 }],
          forests: [{ x: -170, z: 180, r: 60, n: 50 }, { x: 170, z: 170, r: 60, n: 50 }, { x: -140, z: -200, r: 60, n: 30 }, { x: 140, z: -200, r: 60, n: 30 }],
          rocks: [{ x: -60, z: 110, r: 40, n: 12 }, { x: 70, z: 110, r: 40, n: 12 }],
          resources: [{ x: -60, z: 210, stone: 8, food: 8, wood: 10 }, { x: 70, z: 220, stone: 6, food: 6, wood: 10 }], shrubs: 260,
        },
        start: camp(tribe, 0, 190, { workers: 8, warriors: 6, archers: 4, level: 2 }),
      };
    },
    on: {
      setup(M) {
        const S = M.state;
        startHero(M);
        S.wave = 0; S.last = 10;
        S.clock = 3 * T;
        S.clockLabel = 'Wave 1 in';
        M.objective('waves', 'Hold the pass: survive ten waves of the dead', { of: 10 });
        M.mark(0, 30, 'the pass', 0x7dff6a);
        M.mark(-60, -95, 'barrow', 0x9a7aff); M.mark(60, -95, 'barrow', 0x9a7aff);
        M.say('elder', 'They come at the turn of every hour, and every time there are more of them. The barrows are in the north - the pass is the only way south.');
        M.say(M.state.v, 'Then the pass is where we stand. Walls across it, towers behind the walls, and every spear we have.');
        M.after(S.clock, 'wave');
      },
      wave(M) {
        const S = M.state;
        if (S.over) return;
        const n = ++S.wave, home = M.home(M.me), t = home ? [home.pos.x, home.pos.z] : [0, 190];
        const B = [[-60, -85], [60, -85]];
        // (the base game has no common dead: its undead warrior is a 3000-hit-point champion - held to the cap)
        const send = (cls, k, b, cap) => {
          const us = M.spawn(cls, 'outbreak', b[0], b[1], k, { level: Math.min(4, 1 + Math.floor(n / 3)) });
          if (cap) for (const u of us) if (u.maxHp > cap * M.diff) { u.maxHp = cap * M.diff; u.hp = u.maxHp; }
          M.send(us, t);
        };
        const both = (cls, k, cap) => { send(cls, Math.ceil(k / 2), B[0], cap); send(cls, Math.floor(k / 2), B[1], cap); };
        both(UNDEAD.warrior, more(M, 4 + n, 1 + Math.floor(n / 4)), 500 + 40 * n);
        if (n >= 2) both(UNDEAD.archer, more(M, 1 + Math.floor(n * 0.8)), 380 + 30 * n);
        if (n >= 4) both(UNDEAD.brute, more(M, Math.floor(n / 2)), 1100 + 60 * n);
        if (n === 3 || n === 7) { send('Smilodon', more(M, 4), B[n === 3 ? 0 : 1]); M.say('scout', 'Grave-cats with them this time - fast, and hungry!'); }
        if (n === 5) {
          const m = M.spawn('Mammoth', 'outbreak', 0, -110, 1)[0];
          if (m) { m.maxHp *= 5; m.hp = m.maxHp; m.sqScale = 1.5; (S.big = S.big || []).push(m); M.send([m], t); }
          M.say('scout', 'Something huge is walking with them - a dead mammoth, bones and all!');
        }
        if (n === 8) { M.setNight(true); M.say('elder', 'Night falls. The dead see in the dark. We do not.'); }
        if (n === 10) {
          const k = M.spawn(UNDEAD.king, 'outbreak', 0, -100, 1, { level: 3 })[0];
          if (k) { k.maxHp *= 8; k.hp = k.maxHp; k.sqScale = 1.6; (S.big = S.big || []).push(k); S.king = k; M.send([k], t); }
          M.objective('king', 'Destroy the Barrow King', {});
          M.say('warlord', 'Living things. You have held my door for nine hours. Now I hold it.');
          M.say(S.v, 'The Barrow King! Everything we have - now!');
        } else M.say('scout', [`Here they come! Wave ${n}!`, `Wave ${n} - from both barrows!`, `The dead are moving - wave ${n}!`][n % 3]);
        S.inWave = true; S.waveT = M.time;
        S.clock = n < 10 ? M.time + [150, 130, 110][M.difficulty] : 0;
        S.clockLabel = `Wave ${n + 1} in`;
        if (n < 10) M.after(S.clock - M.time, 'wave');
      },
      tick(M) {
        const S = M.state;
        scaleTick(M);
        if (S.over) return;
        if (homeLost(M)) { S.over = true; M.lose('The dead broke through the pass.'); return; }
        // a wave is beaten when none of the dead are left; the next comes when its countdown is up either way
        const dead = M.units('outbreak').length;
        if (S.inWave && !dead) {
          S.inWave = false;
          M.progress('waves', S.wave);
          if (S.wave < 10) M.notify(`Wave ${S.wave} beaten - the next comes in ${fmt(S.clock - M.time)}`, 'good');
          if (S.wave === 4) M.say('elder', 'Four. The barrows are still breathing. Use the time - mend the walls.');
        }
        const o = M.objectives.find((x) => x.id === 'waves');
        if (o) o.note = S.wave < 10 ? `${S.clockLabel} ${fmt(S.clock - M.time)}` + (dead ? ` · ${dead} of the dead still standing` : '') : (dead ? `${dead} of the dead still standing` : '');
        if (S.king && !S.king.alive) M.complete('king');
        // the last few of the dead (stuck somewhere): shown on the map, and after the King they crumble
        if (S.inWave && dead && dead <= 4 && M.time - (S.waveT || 0) > 90 && M.time - (S.markT || 0) > 30) {
          S.markT = M.time;
          M.units('outbreak').forEach((u, i) => M.mark(u.pos.x, u.pos.z, 'left:' + i, 0x9a7aff, 20));
        }
        if (S.wave >= 10 && S.king && !S.king.alive && dead && dead <= 4 && M.time - S.waveT > 120) for (const u of M.units('outbreak')) M.W.kill(u, null);
        if (S.wave >= 10 && !dead && !S.won) {
          S.won = true; S.over = true;
          M.complete('waves');
          M.say('elder', 'The barrows are closing. Listen - nothing. The pass held.');
          M.after(8, 'end');
        }
      },
      end(M) { M.win('The pass held. The dead sleep again.'); },
    },
  },
  // ============================================================================================ 3
  // King of the hill with three tribes: whoever stands alone on the volcano's summit gains time; the first to five
  // minutes wins. The mountain erupts now and then, marked a few seconds before the rocks come down.
  {
    id: 3, title: 'Fire Mountain', place: 'The Ash Valley', setting: 'Ashvalley',
    briefing: [
      'The fire mountain has woken, and the tribe that holds its summit when the spirits speak will be blessed for a generation. Two other tribes have come to take it.',
      'Hold the summit alone - no enemy beside you - for five minutes in all. Mind the mountain: when it rumbles, rocks of fire fall where the ground is marked.',
    ],
    make(tribe) {
      const [a, b] = ['Aje', 'Ninigi', 'SEAS', 'Hu'].filter((t) => t !== tribe);
      return {
        foeTribe: a, foe2Tribe: b,
        foe: { tribe: a, name: TRIBE_NAMES[a], behaviour: 'Schnecke', res: { food: 1500, wood: 1500, stone: 1200 } },
        foe2: { tribe: b, name: TRIBE_NAMES[b], behaviour: 'Schnecke', res: { food: 1500, wood: 1500, stone: 1200 } },
        res: { food: 800, wood: 700, stone: 600 },
        epoch: 2,
        powers: [],
        map: {
          seed: 3303, setting: 'Ashvalley', size: 540, base: 6, noise: [[0.005, 6], [0.025, 1.3]], ground: [0, 7, 2, 3, 4, 5],
          clear: [[0, 0, 30], [0, 210, 30], [-185, -110, 30], [185, -110, 30]],
          features: [{ type: 'hill', x: 0, z: 0, r: 150, h: 26 }, { type: 'flat', x: 0, z: 0, r: 26, h: 31, edge: 16 },
            { type: 'flat', x: 0, z: 210, r: 55, h: 6 }, { type: 'flat', x: -185, z: -110, r: 55, h: 6 }, { type: 'flat', x: 185, z: -110, r: 55, h: 6 }],
          places: [...[[-34, -8], [30, 16], [6, -36], [-14, 34]].map(([x, z], i) => ({ kind: 'model', model: ['ash_crater02_fire', 'ash_chimney_01_fire', 'ash_crater04_fire', 'ash_chimney_03_fire'][i], x, z, rot: i, r: 3, block: false })),
            ...[[-90, 60], [80, 70], [0, -110], [-120, -20], [120, -10]].map(([x, z], i) => ({ kind: 'model', model: `ash_rocktooth0${(i % 4) + 1}`, x, z, rot: i, r: 4 })),
            { kind: 'model', model: 'ash_lava_glow_01', x: 0, z: 0, rot: 0, r: 0, block: false }],
          forests: [{ x: -200, z: 120, r: 50, n: 28 }, { x: 200, z: 120, r: 50, n: 28 }, { x: 0, z: -230, r: 50, n: 28 }],
          rocks: [{ x: -100, z: 180, r: 40, n: 12 }, { x: 100, z: 180, r: 40, n: 12 }],
          resources: [{ x: 0, z: 240, stone: 8, food: 8, wood: 16 }, { x: -220, z: -140, stone: 6, food: 6, wood: 16 }, { x: 220, z: -140, stone: 6, food: 6, wood: 16 }], shrubs: 220,
        },
        start: camp(tribe, 0, 210, { level: 2 }),
      };
    },
    on: {
      setup(M) {
        const S = M.state;
        startHero(M);
        S.homes = { foe: settle(M, 'foe', M.def.foeTribe, -185, -110, { level: 2, warriors: 0, archers: 0 }), foe2: settle(M, 'foe2', M.def.foe2Tribe, 185, -110, { level: 2, warriors: 0, archers: 0 }) };
        S.held = { me: 0, foe: 0, foe2: 0 };
        S.need = 5 * T;
        M.zones.summit = { name: 'summit', x: 0, z: 0, r: 24 };
        M.mark(0, 0, 'summit', 0xffd040);
        M.objective('summit', 'Hold the summit alone for 5:00 in all - first to it wins', {});
        M.say('seer', 'The mountain speaks in five turns of the sand. Whoever stands on its crown alone, when the sand runs out, is chosen.');
        M.say(S.v, `The ${TRIBE_NAMES[M.def.foeTribe]} from the west, the ${TRIBE_NAMES[M.def.foe2Tribe]} from the east. They will fight each other as gladly as us.`);
        M.after(50, 'rumble');
        M.after(150, 'push');
      },
      // the rivals send their fighters up the mountain
      push(M) {
        const S = M.state;
        if (S.over) return;
        for (const r of ['foe', 'foe2']) { const a = army(M, r); M.send(a.slice(0, Math.ceil(a.length * 0.7)), [(Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16]); }
        if (!S.pushSaid) { S.pushSaid = true; M.say('scout', 'Both of them are marching on the summit!'); }
        M.after([150, 120, 95][M.difficulty], 'push');
      },
      // the mountain: a rumble, the marked ground, the rocks
      rumble(M) {
        const S = M.state;
        if (S.over) return;
        const big = (S.rumbles = (S.rumbles || 0) + 1) % 4 === 0;
        const n = big ? 9 : 5, spots = [];
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, r = (big ? 0 : 8) + Math.random() * (big ? 30 : 70);
          spots.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        spots.forEach(([x, z], i) => M.mark(x, z, 'fire:' + i, 0xff3010, 5));
        M.notify(big ? 'The summit itself is erupting - get off the crown!' : 'The mountain rumbles - fire is coming down!', 'bad');
        if (!S.fireSaid) { S.fireSaid = true; M.say('seer', 'The mountain shows where it will strike. Watch the red marks on the map, and step aside.'); }
        M.after(4, 'fall', { spots });
        M.after(big ? 60 : 40 + Math.random() * 25, 'rumble');
      },
      fall(M, { spots }) { for (const [x, z] of spots) strike(M, x, z); },
      tick(M) {
        const S = M.state;
        if (S.over) return;
        if (homeLost(M)) { S.over = true; M.lose('Your camp has fallen.'); return; }
        // who stands on the crown: the sides with units there (not the dead and the wild)
        const on = ['me', 'foe', 'foe2'].filter((r) => M.inZone('summit', r, (u) => !u.isWorker).length);
        if (on.length === 1) {
          const r = on[0];
          S.held[r] += 0.5;
          if (r !== S.holder) { S.holder = r; M.notify(r === 'me' ? 'You hold the summit!' : `The ${TRIBE_NAMES[M.def[r === 'foe' ? 'foeTribe' : 'foe2Tribe']]} hold the summit!`, r === 'me' ? 'good' : 'bad'); }
        } else S.holder = on.length ? 'contested' : null;
        const o = M.objectives.find((x) => x.id === 'summit');
        if (o) o.note = `You ${fmt(S.held.me)} · ${TRIBE_NAMES[M.def.foeTribe]} ${fmt(S.held.foe)} · ${TRIBE_NAMES[M.def.foe2Tribe]} ${fmt(S.held.foe2)}` + (S.holder === 'contested' ? ' · contested' : '');
        S.clock = S.holder === 'me' ? M.time + (S.need - S.held.me) : 0; S.clockLabel = 'Chosen in';
        for (const r of ['foe', 'foe2']) if (S.held[r] >= S.need) {
          S.over = true;
          M.lose(`The mountain chose the ${TRIBE_NAMES[M.def[r === 'foe' ? 'foeTribe' : 'foe2Tribe']]}.`);
          return;
        }
        if (S.held.me >= S.need) {
          S.over = true;
          M.complete('summit');
          M.say('seer', `The sand has run out. The mountain has chosen the ${TRIBE_NAMES[M.tribe]}!`);
          M.after(8, 'end');
        }
      },
      end(M) { M.win('The fire mountain has chosen your tribe.'); },
    },
  },
  // ============================================================================================ 4
  // A choice: two tribes at war send envoys to the player; the hero walks up to the one to side with. That tribe
  // becomes the ally, the other the enemy - whose main building has to fall. Ignore both and both turn on you.
  {
    id: 4, title: 'Two Banners', place: 'The Riverlands', setting: 'Northland',
    briefing: [
      'Two tribes have been at war across the Riverlands since the spring, and your village stands between them.',
      'Both want you on their side, and both are sending envoys. Hear them out - and then walk up to the one you will stand with. Choose quickly: they will take silence for an answer.',
    ],
    make(tribe) {
      const [a, b] = ['Hu', 'Ninigi', 'Aje', 'SEAS'].filter((t) => t !== tribe);
      return {
        foeTribe: a, foe2Tribe: b,
        foe: { tribe: a, name: TRIBE_NAMES[a], behaviour: 'Giraffe', relation: 1, res: { food: 2500, wood: 2500, stone: 2000 } },
        foe2: { tribe: b, name: TRIBE_NAMES[b], behaviour: 'Giraffe', relation: 1, res: { food: 2500, wood: 2500, stone: 2000 } },
        res: { food: 800, wood: 800, stone: 600 },
        epoch: 2,
        powers: [],
        map: {
          seed: 3404, setting: 'Northland', size: 560, base: 5, water: 0, noise: [[0.005, 6], [0.025, 1.2]], ground: [0, 1, 4, 3, 6, 2],
          clear: [[0, 200, 30], [-190, -170, 30], [190, -170, 30], [-60, 140, 12], [60, 140, 12]],
          // the river between the two tribes, with two fords
          features: [{ type: 'river', path: [[0, -280], [10, -150], [-10, -40], [0, 60]], w: 40, depth: 2, bank: 12 },
            { type: 'flat', x: 0, z: -95, r: 22, h: 3.5, edge: 8 }, { type: 'flat', x: -2, z: 20, r: 22, h: 3.5, edge: 8 },
            { type: 'flat', x: 0, z: 200, r: 70, h: 5 }, { type: 'flat', x: -190, z: -170, r: 60, h: 5 }, { type: 'flat', x: 190, z: -170, r: 60, h: 5 }],
          places: [{ kind: 'model', model: 'hu_statue', x: -60, z: 150, rot: 0, r: 3 }, { kind: 'model', model: 'hu_statue_02', x: 60, z: 150, rot: 0, r: 3 }],
          forests: [{ x: -200, z: 60, r: 60, n: 45 }, { x: 200, z: 60, r: 60, n: 45 }, { x: -100, z: -60, r: 40, n: 22 }, { x: 110, z: -70, r: 40, n: 22 }],
          rocks: [{ x: -220, z: 220, r: 40, n: 12 }, { x: 220, z: 220, r: 40, n: 12 }],
          resources: [{ x: 0, z: 240, stone: 8, food: 8, wood: 16 }, { x: -220, z: -210, stone: 6, food: 6, wood: 16 }, { x: 220, z: -210, stone: 6, food: 6, wood: 16 }], shrubs: 260,
        },
        start: camp(tribe, 0, 200, { level: 2 }),
      };
    },
    on: {
      setup(M) {
        const S = M.state;
        startHero(M);
        S.homes = { foe: settle(M, 'foe', M.def.foeTribe, -190, -170, { level: 2, warriors: 0, archers: 0 }), foe2: settle(M, 'foe2', M.def.foe2Tribe, 190, -170, { level: 2, warriors: 0, archers: 0 }) };
        // the two tribes at war with each other
        const A = M.player('foe'), B = M.player('foe2');
        A.setRelation(B, 0); B.setRelation(A, 0);
        M.objective('hear', 'Meet the envoys of both tribes at your village', {});
        M.say('elder', `The ${TRIBE_NAMES[M.def.foeTribe]} in the west, the ${TRIBE_NAMES[M.def.foe2Tribe]} in the east. They have burned each other's fields all summer. Now they both remember we exist.`);
        M.say(S.v, 'Then we listen. And we choose.');
        M.after(90, 'envoy', { r: 'foe', x: -60, z: 140, from: [-150, -120] });
        M.after(120, 'envoy', { r: 'foe2', x: 60, z: 140, from: [150, -120] });
      },
      envoy(M, { r, x, z, from }) {
        const S = M.state, tribe = M.def[r === 'foe' ? 'foeTribe' : 'foe2Tribe'], K = KIT[tribe];
        const e = M.spawn(K.hero, r, from[0], from[1], 1, { level: 3 })[0];
        const esc = M.spawn(K.warrior, r, from[0] + 6, from[1] - 6, 3, { level: 2 });
        if (!e) return;
        e.sqEnvoy = true;
        for (const u of [e, ...esc]) { u.sqEnvoy = true; M.W.order([u], { type: 'move', x: x + (u === e ? 0 : (Math.random() - 0.5) * 10), z: z - (u === e ? 0 : 8), auto: true }); }
        (S.envoys = S.envoys || {})[r] = e;
        // (their tribe's computer player leaves them alone: brain.locked, the campaigns' AILU)
        const br = M.G.brains && M.G.brains.get(M.player(r).id);
        if (br && br.locked) for (const u of [e, ...esc]) br.locked.add(u);
        M.mark(x, z, `envoy:${r}`, r === 'foe' ? 0xff6060 : 0xb080ff);
        M.say('scout', `An envoy of the ${TRIBE_NAMES[tribe]} is on the road to the village.`);
      },
      // what each envoy says when it arrives
      arrived(M, { r }) {
        const S = M.state, tribe = M.def[r === 'foe' ? 'foeTribe' : 'foe2Tribe'], enemy = M.def[r === 'foe' ? 'foe2Tribe' : 'foeTribe'];
        const who = r === 'foe' ? 'envoyA' : 'envoyB';
        M.say(who, r === 'foe'
          ? `Greetings from the ${TRIBE_NAMES[tribe]}. The ${TRIBE_NAMES[enemy]} are thieves and liars. Stand with us, and the river is yours when they are gone.`
          : `The ${TRIBE_NAMES[tribe]} send their respect. The ${TRIBE_NAMES[enemy]} want your land next - they always do. Join us before they come for it.`);
        S.met = (S.met || 0) + 1;
        if (S.met === 2) {
          M.complete('hear');
          S.deadline = M.time + [240, 180, 120][M.difficulty];
          S.clock = S.deadline; S.clockLabel = 'Choose within';
          M.objective('choose', 'Choose a side: walk your hero up to the envoy you will stand with', { secondary: true });
          M.say(S.v, 'Both of them want our spears. Whoever we choose, the other becomes our enemy.');
        }
      },
      choose(M, { r }) {
        const S = M.state;
        if (S.chosen) return;
        S.chosen = r; S.clock = 0;
        const other = r === 'foe' ? 'foe2' : 'foe';
        const F = M.player(r), E = M.player(other), me = M.me;
        F.setRelation(me, 2); me.setRelation(F, 2); E.setRelation(me, 0); me.setRelation(E, 0);
        S.allyHome = S.homes[r]; S.enemyHome = S.homes[other];
        const at = M.def[r === 'foe' ? 'foeTribe' : 'foe2Tribe'], et = M.def[other === 'foe' ? 'foeTribe' : 'foe2Tribe'];
        M.complete('choose');
        M.unmark('envoy:foe'); M.unmark('envoy:foe2');
        M.say(r === 'foe' ? 'envoyA' : 'envoyB', `The ${TRIBE_NAMES[at]} will not forget this. Our warriors march with yours!`);
        M.say(other === 'foe' ? 'envoyA' : 'envoyB', 'So be it. You will burn with them.');
        // the spurned envoy and his escort turn on the village
        for (const u of M.units(other, (q) => q.sqEnvoy)) { u.sqEnvoy = false; M.send([u], [0, 200]); }
        for (const u of M.units(r, (q) => q.sqEnvoy)) { u.sqEnvoy = false; }
        for (const k of ['foe', 'foe2']) { const br = M.G.brains && M.G.brains.get(M.player(k).id); if (br && br.locked) for (const u of M.units(k)) br.locked.delete(u); }
        M.objective('war', `Destroy the ${TRIBE_NAMES[et]}' main building`, {});
        M.objective('ally', `Keep your allies, the ${TRIBE_NAMES[at]}, in the war (their main building standing)`, { secondary: true });
        if (S.enemyHome) M.mark(S.enemyHome.pos.x, S.enemyHome.pos.z, 'enemy', 0xff5030);
        M.after(60, 'raid');
      },
      // nobody chosen in time: both tribes take it as an insult
      silence(M) {
        const S = M.state, me = M.me;
        S.chosen = 'none'; S.clock = 0;
        for (const r of ['foe', 'foe2']) { const p = M.player(r); p.setRelation(me, 0); me.setRelation(p, 0); }
        M.fail('choose');
        M.say('envoyA', 'Your silence is an answer.'); M.say('envoyB', 'Then you are nobody\'s friend.');
        M.say(S.v, 'Both of them. Well - we did not want their land anyway. Now we will take it.');
        M.unmark('envoy:foe'); M.unmark('envoy:foe2');
        for (const r of ['foe', 'foe2']) {
          const br = M.G.brains && M.G.brains.get(M.player(r).id);
          for (const u of M.units(r, (q) => q.sqEnvoy)) { u.sqEnvoy = false; if (br && br.locked) br.locked.delete(u); M.send([u], [0, 200]); }
        }
        M.objective('war', 'Destroy the main buildings of both tribes', { of: 2 });
        for (const r of ['foe', 'foe2']) if (S.homes[r]) M.mark(S.homes[r].pos.x, S.homes[r].pos.z, 'enemy:' + r, 0xff5030);
        M.after(60, 'raid');
      },
      // the enemy's war parties at the village
      raid(M) {
        const S = M.state;
        if (S.over) return;
        const foes = S.chosen === 'none' ? ['foe', 'foe2'] : [S.chosen === 'foe' ? 'foe2' : 'foe'];
        for (const r of foes) { const a = army(M, r); M.send(a.slice(0, Math.ceil(a.length * 0.6)), [0, 200]); }
        if (S.chosen && S.chosen !== 'none') { const a = army(M, S.chosen); M.send(a.slice(0, Math.ceil(a.length * 0.5)), S.enemyHome ? [S.enemyHome.pos.x, S.enemyHome.pos.z] : [0, 0]); }
        M.say('scout', 'War parties on the move!');
        M.after([200, 170, 140][M.difficulty], 'raid');
      },
      tick(M) {
        const S = M.state;
        if (S.over) return;
        if (homeLost(M)) { S.over = true; M.lose('Your village has fallen.'); return; }
        // the envoys at the village; the hero walking up to one
        for (const r of ['foe', 'foe2']) {
          const e = S.envoys && S.envoys[r];
          if (!e) continue;
          if (!e.alive && !S.chosen) { S.envoys[r] = null; M.notify('An envoy was killed!', 'bad'); M.call('silence'); return; }
          const ex = r === 'foe' ? -60 : 60;
          if (!S['at_' + r] && alive(e) && near(e, ex, 140, 12)) { S['at_' + r] = true; M.call('arrived', { r }); }
          if (!S.chosen && alive(e) && (e.task.type === 'idle' ? !near(e, ex, 140, 6) : !/move/.test(e.task.type))) M.W.order([e], { type: 'move', x: ex, z: 140, auto: true });
          const h = hero(M);
          if (S.met === 2 && !S.chosen && h && alive(e) && near(h, e.pos.x, e.pos.z, 9)) M.call('choose', { r });
        }
        if (S.deadline && !S.chosen && M.time >= S.deadline) M.call('silence');
        if (!S.chosen) return;
        // the war
        if (S.chosen === 'none') {
          const down = ['foe', 'foe2'].filter((r) => !alive(S.homes[r])).length;
          M.progress('war', down);
          if (down === 2) { S.over = true; M.after(8, 'end'); }
          return;
        }
        if (S.allyHome && !alive(S.allyHome)) M.fail('ally');
        if (!alive(S.enemyHome)) {
          S.over = true;
          M.complete('war'); if (!M.objectives.find((o) => o.id === 'ally').failed) M.complete('ally');
          M.say(S.chosen === 'foe' ? 'envoyA' : 'envoyB', 'The war is over. The river is yours, as we promised.');
          M.after(8, 'end');
        }
      },
      end(M) { M.win(M.state.chosen === 'none' ? 'You stood alone - and beat them both.' : 'The Riverlands are at peace, and your banner flies over them.'); },
    },
  },
  // ============================================================================================ 5
  // A countdown: the enemy tribe builds a Titan in its fortress, fed by three forges. Each forge brought down puts the
  // Titan back by three minutes and leaves it weaker. Won when the fortress falls (and the Titan, once it walks).
  {
    id: 5, title: 'The Forge of Giants', place: 'The Frozen Reach', setting: 'Icewaste',
    briefing: [
      'In the Frozen Reach an enemy warlord has found the old forges of the giants, and he is using them. His smiths are building a Titan - and when it walks, nothing in the north will stand against it.',
      'Three forges feed it. Every one you destroy sets the Titan back, and leaves it weaker. Break the forges, storm the fortress - or be ready when the Titan comes for you.',
    ],
    make(tribe, difficulty) {
      const foe = other(tribe, ['SEAS', 'Hu', 'Ninigi', 'Aje']);
      return {
        foeTribe: foe,
        foe: { tribe: foe, name: `The Warlord's ${TRIBE_NAMES[foe]}`, behaviour: 'Turtle' },
        models: [...KIT[foe].titan],
        creatures: ['Mammoth', 'Smilodon', 'Woolly_Rhino'],
        res: { food: 1000, wood: 1000, stone: 900 },
        epoch: 2,
        powers: [],
        map: {
          seed: 3505, setting: 'Icewaste', size: 560, base: 7, noise: [[0.005, 8], [0.025, 1.4]], ground: [0, 2, 4, 3, 6, 1],
          clear: [[-200, 200, 30], [190, -190, 40], [-150, -120, 20], [40, -20, 20], [140, 110, 20]],
          features: [{ type: 'flat', x: -200, z: 200, r: 60, h: 7 }, { type: 'flat', x: 185, z: -185, r: 80, h: 10 }, { type: 'ridge', path: [[-120, 40], [40, 160]], w: 40, h: 20 },
            { type: 'ridge', path: [[-40, -160], [80, -60]], w: 40, h: 18 }],
          places: [...[[-150, -120], [40, -20], [140, 110]].flatMap(([x, z], i) => [{ kind: 'model', model: `northland_obelisk_0${i + 2}`, x: x - 14, z: z - 12, rot: i, r: 3 }, { kind: 'model', model: `northland_obelisk_0${i + 4}`, x: x + 14, z: z - 12, rot: i, r: 3 }]),
            { kind: 'model', model: 'northland_skeleton', x: 0, z: 60, rot: 0, r: 4, block: false }],
          forests: [{ x: -220, z: 60, r: 50, n: 30 }, { x: 60, z: 220, r: 50, n: 30 }, { x: -60, z: -230, r: 40, n: 20 }, { x: 230, z: 40, r: 40, n: 20 }],
          rocks: [{ x: 0, z: 0, r: 50, n: 16 }],
          resources: [{ x: -220, z: 160, stone: 8, food: 8, wood: 20 }, { x: -120, z: 230, stone: 4, food: 4, wood: 10 }], shrubs: 220,
        },
        start: camp(tribe, -200, 200, { workers: 8, level: 2, beasts: 1 }),
        titanAt: [15, 15, 12][difficulty] * T,
      };
    },
    on: {
      setup(M) {
        const S = M.state, K = KIT[M.def.foeTribe];
        startHero(M);
        S.home = settle(M, 'foe', M.def.foeTribe, 185, -185, { level: 3, hero: true, workers: 8, warriors: 8, archers: 6, beasts: 2, towers: [[30, 24], [-30, 24], [30, -24], [-30, -24], [0, 40], [40, 0]] });
        S.forges = [[-150, -120], [40, -20], [140, 110]].map(([x, z], i) => {
          const b = M.building(K.temple, 'foe', x, z, 0);
          if (b) { b.maxHp *= 1.5; b.hp = b.maxHp; b.sqForge = i; }
          M.building(K.tower, 'foe', x + 16, z + 14, 0);
          M.spawn(K.warrior, 'foe', x, z + 18, more(M, 3), { level: 2 }); M.spawn(K.archer, 'foe', x + 6, z + 20, more(M, 2), { level: 2 });
          M.mark(x, z, 'forge:' + i, 0xff8030);
          return { x, z, b };
        });
        S.titanAt = M.def.titanAt;
        S.clock = S.titanAt; S.clockLabel = 'The Titan walks in';
        M.objective('forges', 'Destroy the three forges (each sets the Titan back 3:00 and weakens it)', { of: 3, secondary: true });
        M.objective('fortress', 'Destroy the warlord\'s fortress (his main building, north-east)', {});
        M.mark(185, -185, 'fortress', 0xff5030);
        M.say('seer', 'The forges glow day and night. When the last bolt is struck, the Titan will open its eyes.');
        M.say('warlord', 'Kneel now, and you may serve my giant. Stand, and you will be its first meal.');
        M.say(S.v, 'Three forges. We break them, or we break the giant. Either way - we break something.');
        M.after(5 * T, 'patrol');
      },
      patrol(M) {
        const S = M.state, K = KIT[M.def.foeTribe];
        if (S.over || !alive(S.home)) return;
        const home = M.home(M.me), t = home ? [home.pos.x, home.pos.z] : [-200, 200];
        M.send([...M.spawn(K.warrior, 'foe', 160, -160, more(M, 4), { level: 2 }), ...M.spawn(K.archer, 'foe', 165, -155, more(M, 2), { level: 2 })], t);
        M.say('scout', 'A war band left the fortress - coming our way!');
        M.after([240, 200, 160][M.difficulty], 'patrol');
      },
      died(M, { e }) {
        const S = M.state;
        if (e.sqForge != null && !S.titan) {
          const n = S.forges.filter((f) => !alive(f.b)).length;
          S.titanAt += 3 * T;
          S.clock = S.titanAt;
          M.unmark('forge:' + e.sqForge);
          M.progress('forges', n);
          M.say('seer', ['One forge is cold. The giant\'s heart beats slower.', 'Two forges dark. The giant will be lame.', 'The last forge is out! If it walks now, it walks half-made.'][n - 1]);
        }
        if (e === S.titan) { M.complete('titan'); M.say(S.v, 'The Titan is down!'); }
      },
      titan(M) {
        const S = M.state, K = KIT[M.def.foeTribe];
        if (S.titan || S.over) return;
        const lit = S.forges.filter((f) => alive(f.b)).length;
        const t = M.spawn(K.titan, 'foe', 165, -160, 1, { level: 4 })[0];
        if (!t) return;
        S.titan = t; S.clock = 0;
        t.maxHp *= 3 + 2 * lit; t.hp = t.maxHp; t.sqScale = 1.8; (S.big = S.big || []).push(t);
        const home = M.home(M.me);
        M.send([t, ...M.spawn(K.warrior, 'foe', 160, -150, more(M, 5), { level: 3 })], home ? [home.pos.x, home.pos.z] : [-200, 200]);
        M.objective('titan', 'Bring down the Titan', {});
        M.say('warlord', 'Rise, my giant. Walk.');
        M.say('scout', 'It is moving - the Titan is coming for our village!');
      },
      tick(M) {
        const S = M.state;
        scaleTick(M);
        if (S.over) return;
        if (homeLost(M)) { S.over = true; M.lose('Your village has fallen.'); return; }
        if (!S.titan && M.time >= S.titanAt && alive(S.home)) M.call('titan');
        // (the Titan keeps walking on the player)
        if (alive(S.titan) && S.titan.task.type === 'idle') { const h = M.home(M.me); if (h) M.send([S.titan], [h.pos.x, h.pos.z]); }
        if (!alive(S.home) && !M.isDone('fortress')) {
          M.complete('fortress');
          M.say('warlord', 'My forges... my giant...');
          if (!S.titan) M.say('seer', 'The fortress has fallen before the giant woke. It will sleep forever now.');
        }
        if (M.isDone('fortress') && !alive(S.titan)) {
          S.over = true;
          M.say(S.v, 'The Frozen Reach is free.');
          M.after(8, 'end');
        }
      },
      end(M) { M.win(M.state.titan ? 'The Titan has fallen, and the forges are cold.' : 'The fortress fell before the Titan could walk.'); },
    },
  },
];

// the models a scenario's script may need besides the tribes' own (game/sequel/runtime.js models: def.models): every
// tribe's heroes and titans, the dead - the heroes a tribe cannot hire in the data in use are not loaded with it
const SCRIPT_CLASSES = [...new Set([...Object.values(KIT).flatMap((K) => [...K.hero, ...K.titan, ...K.beast]), ...Object.values(UNDEAD).flat()])];
for (const sc of SCENARIOS) {
  const make = sc.make;
  sc.make = (tribe, difficulty) => { const o = make(tribe, difficulty); o.models = [...new Set([...(o.models || []).flat(), ...SCRIPT_CLASSES])]; return o; };
}
