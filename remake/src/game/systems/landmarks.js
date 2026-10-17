// The map's special places: healing wells (CFountain), lakes of healing and of damage (CLakeOfHealing /
// CLakeOfDamage) and the level's weather program (the client's CWeatherMgr).
//
// Reference: MiscObj.usl CFountain (2115-2260), CLakeOfDamage / CLakeOfHealing (153-260), task/FountainHeal.usl,
// FightingObj.usl FountainHeal / HealMe / TakeDirectMeleeDmg, GameInputController.usl (the "healing" cursor and
// the right click on a well), Game/mgr/WeatherMgr.usl, ActionFactory.usl CActionWeather (trigger WTHR).
//
// A well (W.wells: a Prop with .well = {max, fill, refill, refillT}) holds `maxhitpoints` of healing ("hitpoints" is
// what it holds now). A unit sent to it (the right click of characters, animals, vehicles, ships: order 'fountain')
// walks there at its walking pace; within 30 m of it when the walk ends it gets what it lacks - or what is left -
// and the well refills: every second refill_dur-th of its store, until it is full.
// A lake (W.lakes: {name, region, heal, amount, types}) every 3 s gives each fighting object in its region (a map
// region by name) the amount: damage (protection counts, not in a transport) or healing; `types` limits it to object
// types ("|CHTR|ANML|..."; empty: all).
// The weather (W.weather: {tracks [{dur, type, wind, strength, intensity}], loop, i, t0, over}): the tracks of the
// level's Root/WeatherData one after the other, each `Duration` minutes long; looped or, at the end, no weather.
// Type 0 none, 1 snow, 2 rain (PWClient.exe "Disabled Snow Rain"). engine/weather.js draws it.
import { Prop } from '../prop.js';

const WELL_REACH = 30;                         // FountainHeal: arrived when within 30 m (Abs2S > 900: walk again)
const LAKE_TICK = 3;                           // the lakes' TIMER_DAMAGE

export const Landmarks = {
  // ---------------------------------------------------------------- healing wells
  // a map's well: o = {model, cls, x, z, y, rot, q, attr} (maps/source.js)
  placeWell(o) {
    if (!this.templates(o.model, true)) return null;
    const p = new Prop(this, { model: o.model, x: o.x, z: o.z, y: o.y, rot: o.rot, q: o.q, block: true, blockRadius: 1.5 });
    return this.addWell(p, o.attr, o.cls);
  },
  // a Prop becomes a well; a = the object's attributes (hitpoints, maxhitpoints, refill_dur - missing ones have the
  // defaults of attribs_def.txt: 100, 100, 120), cls its class
  addWell(prop, a, cls = '') {
    const v = (k, d) => (a && a[k] != null && a[k] !== '' ? +a[k] || 0 : d);
    const max = v('maxhitpoints', 100);
    prop.well = { max, fill: Math.min(max, v('hitpoints', 100)), refill: v('refill_dur', 120), refillT: null };
    prop.kind = 'well';
    prop.id = 'well' + this.wells.length;
    prop.name = String(cls || prop.model).toLowerCase();
    prop.radius = this.propRadius(prop);
    this.wells.push(prop);
    return prop;
  },
  propRadius(p) {
    const t = p.tpl;
    if (!t) return 2;
    if (t.propR == null) { const b = new this.THREE.Box3().setFromObject(t.scene); t.propR = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2; }
    return Math.max(1, t.propR);
  },
  // who may be sent to a well (GameInputController GetAction "healing": characters, animals, vehicles, ships)
  canUseWell(u, w) { return !!(u && u.alive && u.kind === 'unit' && w && w.alive && w.visible && w.well && /^(CHTR|ANML|VHCL|SHIP)$/.test(u.cls)); },
  // task 'fountain' (CFountainHeal): walk to the well, at 30 m or less when the walk ends: drink
  fountainUpdate(u, dt) {
    const t = u.task, w = t.target;
    if (!w || !w.alive || !w.visible) { u.task = { type: 'idle' }; return; }
    if (!t.walking) {
      if (t.tries > 4) { u.task = { type: 'idle' }; return; }
      t.tries = (t.tries || 0) + 1;
      const [x, z] = this.approachWell(u, w);
      u.setPath(x, z);
      t.walking = true;
    }
    const near = Math.hypot(w.pos.x - u.pos.x, w.pos.z - u.pos.z) <= w.radius + 3;
    if (u.path.length && !near) { u.moveAnim(u.steer(dt, u.speed)); return; }
    u.path = []; u.vel.set(0, 0, 0);
    if (Math.hypot(w.pos.x - u.pos.x, w.pos.z - u.pos.z) > WELL_REACH) { t.walking = false; return; }
    this.drinkAt(w, u);
    u.task = { type: 'idle' };
    u.anchor.set(u.pos.x, u.pos.z);
  },
  // a free place next to the well (ObjMgr.GetFreePos on the well's position)
  approachWell(u, w) {
    const nav = this.navFor(u), dx = u.pos.x - w.pos.x, dz = u.pos.z - w.pos.z, d = Math.hypot(dx, dz) || 1;
    const x = w.pos.x + dx / d * (w.radius + 1.5), z = w.pos.z + dz / d * (w.radius + 1.5);
    if (nav.isFree(x, z)) return [x, z];
    const c = nav.nearestFree(nav.idx(x, z));
    return c != null && c >= 0 ? nav.center(c) : [x, z];
  },
  // CFountain.ObjArrived: the unit gets what it lacks (or what is left); the refill starts; "fill_anim" plays
  drinkAt(w, u) {
    const W = w.well, need = u.maxHp - u.hp;
    if (W.fill - need >= 0) { this.setHp(u, u.maxHp); W.fill -= need; } else { this.setHp(u, u.hp + W.fill); W.fill = 0; }
    if (W.refillT == null) W.refillT = 1;
    if (w.anim && w.anim.has('fill_anim')) w.playAnim('fill_anim', 1);       // (Game.usl event 23: CHealingWellState)
    this.emit('drink', { unit: u, well: w });
  },
  wellsUpdate(dt) {
    for (const w of this.wells) {
      const W = w.well;
      if (w.anim && !w.rec) w.update(dt);                                     // (a campaign's props: setup.js update)
      if (!w.alive || W.refillT == null) continue;
      if ((W.refillT -= dt) > 0) continue;
      W.refillT += 1;
      W.fill += W.max / Math.max(1, W.refill);                                // Refill(): every second 1 / refill_dur of the store
      if (W.fill >= W.max) { W.fill = W.max; W.refillT = null; }
    }
    if (this.wells.some((w) => !w.alive)) this.wells = this.wells.filter((w) => w.alive);
  },

  // ---------------------------------------------------------------- lakes of healing / damage
  // l: {name, region (its name), heal (bool), amount (damage_per_tick), types ("|CHTR|ANML" or "")}
  addLake(l) { this.lakes.push({ ...l, t: LAKE_TICK }); },
  lakesUpdate(dt) {
    for (const l of this.lakes) {
      if ((l.t -= dt) > 0) continue;
      l.t += LAKE_TICK;
      const r = this.regionOf ? this.regionOf(l.region) : null;
      if (!r || !r.enabled) continue;
      const b = r.bounds();
      if (!b) continue;
      const types = String(l.types || '');
      // (passengers are where their transport is: the healing reaches them, the damage does not)
      const hit = (e) => {
        const p = e.inside ? e.inside.pos : e.pos;
        if (!e.alive || e.parked || Math.hypot(p.x - b.x, p.z - b.z) > b.r + (e.radius || 0) || !r.contains(p.x, p.z)) return;
        if (types && !types.includes(e.cls)) return;
        if (l.heal) this.healMe(e, l.amount);
        else if (!e.inside) this.takeDirectDmg(e, l.amount, 0, null, false);
      };
      for (const u of this.units) hit(u);
      for (const e of this.buildings) hit(e);
    }
  },
  // FightingObj.HealMe: up to the full hit points; a unit glows for 2.5 s ("fx_heal_passive")
  healMe(e, amount) {
    if (e.hp >= e.maxHp) return;
    this.setHp(e, Math.min(e.maxHp, e.hp + amount));
    e.healedT = this.time;
    if (e.kind === 'unit') this.emit('healfx', { from: null, to: e });
  },

  // ---------------------------------------------------------------- weather (CWeatherMgr)
  // the program of the level (Root/WeatherData) or of a file (WTHR with chgtype 0: progpath - not in the game's data)
  startWeather(prog) {
    const tracks = (prog && prog.tracks || []).filter((t) => t.dur > 0);
    this.weather = tracks.length ? { tracks, loop: !!prog.loop, i: 0, t0: this.time, over: false } : null;
  },
  // WTHR with chgtype 1: the next track now
  nextWeatherTrack() {
    const w = this.weather;
    if (!w) return;
    if (w.i + 1 < w.tracks.length) { w.i++; w.t0 = this.time; }
    else if (w.loop) { w.i = 0; w.t0 = this.time; w.over = false; }
    else w.over = true;
  },
  weatherUpdate() {
    const w = this.weather;
    if (!w || w.over) return;
    if (this.time - w.t0 >= w.tracks[w.i].dur) this.nextWeatherTrack();
  },
  // what to draw now: {type 0 none | 1 snow | 2 rain, intensity, wind (degrees, 0 = north), strength}
  weatherNow() {
    const w = this.weather;
    if (!w || w.over) return null;
    const t = w.tracks[w.i];
    return t.type ? t : null;
  },
};

// the level's weather program from the level info's description tree (Root/WeatherData: Name, Loop, Tracks/Entry
// {Name, Duration (minutes), WindDir 0..7 (north, north-east ... clockwise: WeatherMgr's 0, 315, 270 ... degrees),
// WindStrength, Type, Intensity})
export function weatherProgram(tree) {
  const sub = (n, name) => (n && n.subs || []).find((s) => s.name === name);
  const wd = sub(tree, 'WeatherData');
  if (!wd) return null;
  const val = (n, k) => { const s = sub(n, k); return s ? s.value : ''; };
  const DIRS = [0, 315, 270, 225, 180, 135, 90, 45];
  const tracks = ((sub(wd, 'Tracks') || {}).subs || []).map((e) => ({
    dur: (+val(e, 'Duration') || 0) * 60, type: +val(e, 'Type') || 0, intensity: +val(e, 'Intensity') || 0,
    wind: DIRS[+val(e, 'WindDir') || 0] ?? 0, strength: +val(e, 'WindStrength') || 0,
  }));
  return { name: val(wd, 'Name'), loop: val(wd, 'Loop') === '1', tracks };
}
