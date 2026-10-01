// Wrapper around gamedata.json (extracted from the original tech tree).
export const RES = ['food', 'wood', 'stone'];
export const SPEED_FALLBACK = [0, 1.5, 5, 7, 10];

export class GameData {
  constructor(json, roster) {
    this.j = json;
    this.roster = roster;
    this.objects = json.objects;
    this.weapons = json.weapons;
    this.texts = json.texts;
    this.pyramid = json.pyramid;               // [25,15,8,3,1]
    this.levelupSkulls = json.levelup_skulls;  // [25,50,100,300]
    this.actionsBy = {};
    for (const tribe in json.actions) {
      for (const a of json.actions[tribe]) {
        a.tribe = tribe;
        for (const l of a.locs) {
          const k = tribe + '|' + l.at;
          (this.actionsBy[k] = this.actionsBy[k] || []).push({ ...a, loc: l });
        }
      }
    }
    this.weaponCache = new Map();
  }
  obj(name) { return this.objects[name]; }
  stats(name, level) {
    const o = this.objects[name];
    if (!o) return null;
    for (let l = level; l >= 1; l--) if (o.levels[l] && o.levels[l].hp > 1) return o.levels[l];
    for (let l = level; l <= 5; l++) if (o.levels[l] && o.levels[l].hp > 1) return o.levels[l];
    return o.levels[1];
  }
  // weapons a unit can use at a level: {long, medium, short}
  weaponSet(name, level) {
    const key = name + '|' + level;
    if (this.weaponCache.has(key)) return this.weaponCache.get(key);
    const o = this.objects[name];
    const set = { long: null, medium: null, short: null };
    if (o && o.weapons) {
      const cand = o.weapons.map((w) => ({ id: w, ...this.weapons[w] }));
      const pick = (filter) => {
        let best = null;
        for (const w of cand) {
          if (!filter(w)) continue;
          if (w.level > level && w.level > 0) continue;
          if (!best || w.level > best.level) best = w;
        }
        if (!best) for (const w of cand) if (filter(w) && (!best || w.level < best.level)) best = w;   // nothing low enough: take the lowest
        return best;
      };
      set.long = pick((w) => w.secondary === 0 && !/_m$|_s$/.test(w.id));
      set.medium = pick((w) => /_m$/.test(w.id));
      set.short = pick((w) => /_s$/.test(w.id) || (w.secondary === 1 && !/_m$/.test(w.id)));
      if (!set.long) set.long = set.medium || set.short;
    }
    this.weaponCache.set(key, set);
    return set;
  }
  idleSet(name) { return (this.j.idle || {})[name.toLowerCase()] || null; }
  actionsAt(tribe, at) { return this.actionsBy[tribe + '|' + at] || []; }
  text(name) {
    const t = this.texts[name] || this.texts[name.toLowerCase()];
    return t || { name: prettify(name), medium: '', long: '', vs: {} };
  }
  startLevel(action) {
    let lv = 1;
    for (const r of action.results) if (r.level) lv = Math.max(lv, r.level);
    return lv;
  }
}

export function prettify(n) {
  return n.replace(/^(seas|aje|hu|ninigi)_/, '').replace(/_s\d$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
