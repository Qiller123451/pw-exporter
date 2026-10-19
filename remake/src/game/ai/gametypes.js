// The computer player in the skirmish game types Defender and Domination ("KingOfTheHill" in the scripts;
// docs/spec/ai_gametypes.md). TribeAI methods; S = the census.
//
//   * The game type and the defender role are read once when the brain starts (UM:61-79, 324-342): the defender is
//     the player owning a defender_object (the crystal of head quarter 1).
//   * Defender, the defending player: always Schnecke (CM:292), no plan attacks (the attack tables' defender rows),
//     its idle army guards the first damaged crystal, else the last one (GV:399-428, 985-1011). Nobody builds walls
//     in a Defender game (DM:675); the attackers build no towers (DM:148) and take on a crystal first (AO:1314).
//   * Domination: every strategy think goes through the flags, the nearest first (DA:866-941): a neutral flag gets a
//     "KotH Pyramid" attack (one flag on the map) or "KotH Violence", an enemy one "KotH Siege" when a building of
//     the enemy stands near it, else "KotH Suicide" and "KotH Violence" by turns; nothing else is attacked. Units
//     within 30 m of the flag stay there when such an attack is over (GA:414-461).
//   * The last 5 minutes of a domination or defender timer: a pyramid attack on what the timer's holder has near the
//     flag / the crystal (FM:1126-1180). The original also "attacks" its own or an ally's units and starts it again on
//     every fight think [bug]: here only an enemy holder, one such attack at a time.
const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const TYPE = { deathmatch: 'Deathmatch', domination: 'KingOfTheHill', defender: 'Defender' };
// the towers SearchForDisturbance looks for (DA:788-798)
const TOWERS = new Set(['hu_small_tower', 'hu_large_tower', 'aje_small_tower', 'aje_medium_tower', 'aje_tesla_tower', 'ninigi_small_tower',
  'ninigi_large_tower', 'ninigi_telescope_tower', 'ninigi_smoke_tower', 'seas_turret_tower']);

export const GameTypesAI = {
  gameTypeInit() {
    const G = this.W.go;
    this.gameType = (G && TYPE[G.mode]) || 'Deathmatch';
    this.isDefender = this.W.buildings.some((b) => b.alive && b.owner === this.p && b.name === 'defender_object');
  },
  // the domination flags, the nearest to the start first (GetKothSectors, UM:17-58)
  kothFlags(S) {
    const G = this.W.go, at = this.start || S.home;
    const list = (G && G.flags) || [];
    return at ? list.slice().sort((a, b) => d2(a, at) - d2(b, at)) : list.slice();
  },
  // SearchForDisturbance (DA:703-812): what stands around a spot (a flag, a pest patrol's place). Hostile wild animals
  // within 90 m, sorted from the start location -> "suicide" on them, unless the first is an allosaurus and the
  // epoch is 3 or lower (then nothing, found false - the list stays as the original leaves it); else enemies within
  // 60 m (Dodo always, Giraffe from epoch 3, Schnecke from epoch 5) -> "blitz"; else the enemy towers of the
  // script's list within 60 m -> "blitz" in epochs 1 and 2, "towersiege" later. {found, type, list, pos (their
  // centre), wild}. (Nests are no objects in the remake: the original's NEST entries are left out.)
  disturbance(S, at) {
    const W = this.W, from = this.start || S.home || at, age = S.age;
    const centre = (l) => ({ x: l.reduce((n, e) => n + e.pos.x, 0) / l.length, z: l.reduce((n, e) => n + e.pos.z, 0) / l.length });
    const wild = [];
    W.uHash.query(at.x, at.z, 90, (u) => { if (u.alive && u.wild && !u.naval && u.def.aggressive > 0 && d2(u.pos, at) < 90) wild.push(u); });
    if (wild.length) {
      wild.sort((a, b) => d2(a.pos, from) - d2(b.pos, from));
      if (/_allosaurus/.test(wild[0].name) && age <= 3) return { found: false, list: wild, wild: true };
      return { found: true, type: 'suicide', list: wild, pos: centre(wild), wild: true };
    }
    const out = [], L = this.letter;
    if (L === 'D' || (L === 'G' && age >= 3) || (L === 'S' && age >= 5)) {
      const q = (e) => { if (e.alive && !e.inside && e.owner && this.p.isEnemy(e.owner) && d2(e.pos, at) < 60) out.push(e); };
      W.uHash.query(at.x, at.z, 60, q); W.bHash.query(at.x, at.z, 70, q);
      if (out.length) return { found: true, type: 'blitz', list: out, pos: centre(out), wild: false };
    }
    W.bHash.query(at.x, at.z, 70, (b) => { if (b.alive && b.owner && this.p.isEnemy(b.owner) && TOWERS.has(b.name) && d2(b.pos, at) < 60) out.push(b); });
    if (!out.length) return { found: false, list: out, wild: false };
    out.sort((a, b) => d2(a.pos, from) - d2(b.pos, from));
    return { found: true, type: age <= 2 ? 'blitz' : 'towersiege', list: out, pos: centre(out), wild: false };
  },
  kothThink(S) {
    const flags = this.kothFlags(S);
    if (!flags.length) return;
    for (const f of flags) {
      const pos = { x: f.x, z: f.z }, owner = f.owner;
      if (!owner) {
        const d = this.disturbance(S, pos);
        // an aggressive animal at a flag in the first epoch: nothing this think
        if (d.wild && S.age < 2 && d.list.some((u) => u.def.aggressive > 0)) return;
        this.requestAttack(S, flags.length === 1 ? 'KotH Pyramid' : 'KotH Violence', null, d.list, pos);
      } else if (this.p.isEnemy(owner)) {
        const d = this.disturbance(S, pos);
        let type;
        if (d.list.some((e) => e.kind === 'building')) type = 'KotH Siege';
        else { type = this.kothCount ? 'KotH Violence' : 'KotH Suicide'; this.kothCount = this.kothCount ? 0 : 1; }
        this.requestAttack(S, type, owner, d.list, pos);
      }
    }
  },
  // the defender's guard point: the first damaged crystal, else the last one (CheckForDefenseObj)
  crystalGuard() {
    if (this.gameType !== 'Defender' || !this.isDefender) return null;
    const own = this.W.buildings.filter((b) => b.alive && b.owner === this.p && b.name === 'defender_object');
    if (!own.length) return null;
    const c = own.find((b) => b.hp < b.maxHp) || own[own.length - 1];
    return { x: c.pos.x, z: c.pos.z };
  },
  // CheckForTimers (FM:1126-1180), on the fight think
  timerThink(S) {
    const G = this.W.go;
    if (!G || this.gameType === 'Deathmatch' || this.attacks.some((a) => a.timer && a.state !== 'over')) return;
    let holder = null, at = null, left = -1;
    if (this.gameType === 'KingOfTheHill') {
      const f = this.kothFlags(S)[0];
      if (!f || !f.owner || !G.dom || G.dom.paused) return;
      holder = f.owner; at = { x: f.x, z: f.z }; left = G.dom.left;
    } else {
      const c = this.W.buildings.find((b) => b.alive && b.name === 'defender_object');
      if (!c || !G.def) return;
      holder = c.owner; at = { x: c.pos.x, z: c.pos.z }; left = G.def.left;
    }
    if (!(left >= 0 && left < 300) || !holder || !this.p.isEnemy(holder)) return;
    const W = this.W, targets = [];
    const q = (e) => { if (e.alive && e.owner === holder && !e.inside && d2(e.pos, at) < 60) targets.push(e); };
    W.uHash.query(at.x, at.z, 60, q); W.bHash.query(at.x, at.z, 70, q);
    if (!targets.length) return;
    const a = this.requestAttack(S, 'pyramid', holder, targets, at, true);
    if (a) a.timer = true;
  },
};
