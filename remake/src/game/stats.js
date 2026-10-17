// The game's statistics (the original's CStatisticMgr samples, docs/spec/ui_groups7_9.md §4): per player what
// it built, collected, lost and destroyed, when it reached each epoch, and every 10 s of game time a sample of its
// units, buildings and resources for the time line. Fed by the world's events (World.emit); ui/stats.js shows it.
//
//   counters per player: food wood stone skulls (collected: what fitted into storage, Player.gained) - workers,
//   infantry, animals, vehicles, ships (made) - tributeSent, tributeReceived - eco, mil, def (buildings finished, by
//   the build menu's row: ECON / COMB / DEFE; palisades no defence, as FightingObj.usl:3984-3995) - unitsLost,
//   buildingsLost, killed (enemies), razed (enemy buildings), animals (wild animals killed) - epochs [time of 2..5]
// The original counts no skulls (the sample is commented out, FightingObj.usl:3967): the remake does.

const SAMPLE = 10;                    // seconds of game time between two samples of the time line
const ZERO = () => ({ food: 0, wood: 0, stone: 0, skulls: 0, workers: 0, infantry: 0, animals: 0, vehicles: 0, ships: 0, tributeSent: 0, tributeReceived: 0,
  eco: 0, mil: 0, def: 0, unitsLost: 0, buildingsLost: 0, killed: 0, razed: 0, animalKills: 0, epochs: [null, null, null, null, null, null] });

export class Stats {
  constructor(W) {
    this.W = W;
    this.p = new Map();               // player id -> counters
    this.series = [];                 // [{ t, v: { <player id>: { units, civil, military, buildings, food, wood, stone, skulls, collected } } }]
    this.nextT = 0;
    this.cats = new Map();            // building class -> ECON | COMB | DEFE
  }
  of(p) {
    if (!p) return null;
    let s = this.p.get(p.id);
    if (!s) { s = ZERO(); this.p.set(p.id, s); }
    return s;
  }
  // the build menu row of a building class (the location's uiposition/subcat)
  cat(b) {
    if (this.cats.has(b.name)) return this.cats.get(b.name);
    const D = this.W.data;
    const a = (D.actions(b.owner) || []).find((x) => x.kind === 'Build' && x.results.some((r) => r.obj === b.name));
    const c = (a && a.loc && a.loc.ui && a.loc.ui.subcat) || null;
    this.cats.set(b.name, c);
    return c;
  }
  // one world event (World.emit)
  on(e) {
    switch (e.type) {
      case 'trained': {
        const u = e.unit, s = u && u.countsInPop && this.of(u.owner);
        if (!s) break;
        if (u.isWorker) s.workers++;
        else if (u.cls === 'SHIP' || u.naval) s.ships++;
        else if (u.cls === 'CHTR') s.infantry++;
        else if (u.cls === 'ANML') s.animals++;
        else s.vehicles++;
        break;
      }
      case 'built': {
        const b = e.building, s = b && this.of(b.owner);
        if (!s) break;
        const c = this.cat(b);
        if (c === 'ECON') s.eco++; else if (c === 'COMB') s.mil++; else if (c === 'DEFE' && !/palisade/.test(b.name)) s.def++;
        break;
      }
      case 'died': {
        const u = e.entity, k = e.killer && e.killer.owner;
        if (u && u.owner && u.countsInPop) this.of(u.owner).unitsLost++;
        if (k && u && k !== u.owner) { if (!u.owner && u.cls === 'ANML') this.of(k).animalKills++; else if (u.owner) this.of(k).killed++; }
        break;
      }
      case 'destroyed': {
        const b = e.entity, k = e.killer && e.killer.owner;
        if (b && b.owner && b.kind === 'building') this.of(b.owner).buildingsLost++;
        if (k && b && b.owner && k !== b.owner) this.of(k).razed++;
        break;
      }
      case 'upgrade': {
        const m = e.action && /^age_(\d)$/.exec(e.action.id), s = m && this.of(e.player);
        if (s && s.epochs[+m[1]] == null) s.epochs[+m[1]] = this.W.time;
        break;
      }
      case 'tribute': this.of(e.from).tributeSent += e.n; this.of(e.to).tributeReceived += e.n; break;
      default: break;
    }
  }
  // a sample of the time line every 10 s (World.update)
  update() {
    const W = this.W;
    if (W.time < this.nextT) return;
    this.nextT = W.time + SAMPLE;
    const v = {};
    for (const p of W.players) {
      const o = { units: 0, civil: 0, military: 0, buildings: 0, food: Math.floor(p.res.food || 0), wood: Math.floor(p.res.wood || 0), stone: Math.floor(p.res.stone || 0), skulls: Math.floor(p.res.skulls || 0) };
      for (const u of W.units) if (u.alive && u.owner === p && u.countsInPop) { o.units++; if (u.isWorker) o.civil++; else o.military++; }
      for (const b of W.buildings) if (b.alive && b.owner === p && b.built) o.buildings++;
      const g = p.gained || {};
      o.collected = { food: g.food || 0, wood: g.wood || 0, stone: g.stone || 0, skulls: g.skulls || 0 };
      v[p.id] = o;
    }
    this.series.push({ t: Math.round(W.time), v });
  }
  // the table values of a player (ui/stats.js)
  table(p) {
    const s = this.of(p), g = p.gained || {};
    return { ...s, food: Math.floor(g.food || 0), wood: Math.floor(g.wood || 0), stone: Math.floor(g.stone || 0), skulls: Math.floor(g.skulls || 0) };
  }
  // saved games (game/save.js)
  toJSON() { return { p: [...this.p.entries()], series: this.series, nextT: this.nextT }; }
  load(j) {
    if (!j) return;
    this.p = new Map((j.p || []).map(([k, v]) => [k, { ...ZERO(), ...v }]));
    this.series = j.series || [];
    this.nextT = j.nextT || 0;
  }
}
