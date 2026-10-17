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
  // what stands around a flag (SearchForDisturbance, DA:703-812): hostile wild animals within 90 m; else enemies
  // within 60 m (Dodo always, Giraffe from epoch 3, Schnecke from epoch 5); else enemy towers within 60 m
  disturbance(S, at) {
    const W = this.W, out = [];
    W.uHash.query(at.x, at.z, 90, (u) => { if (u.alive && u.wild && !u.naval && u.def.aggressive > 0 && d2(u.pos, at) < 90) out.push(u); });
    if (out.length) return { list: out, wild: true };
    const L = this.letter, age = S.age;
    if (L === 'D' || (L === 'G' && age >= 3) || (L === 'S' && age >= 5)) {
      const q = (e) => { if (e.alive && !e.inside && e.owner && this.p.isEnemy(e.owner) && d2(e.pos, at) < 60) out.push(e); };
      W.uHash.query(at.x, at.z, 60, q); W.bHash.query(at.x, at.z, 70, q);
      if (out.length) return { list: out, wild: false };
    }
    W.bHash.query(at.x, at.z, 70, (b) => { if (b.alive && b.owner && this.p.isEnemy(b.owner) && b.def.wallKind === 'tower' && d2(b.pos, at) < 60) out.push(b); });
    return { list: out, wild: false };
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
