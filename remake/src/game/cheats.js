// Debug options of a game, chosen before it starts (the menu's "Debug options" page in the campaign, skirmish and
// sequel windows: ui/debugopts.js; tests: ?cheats=<json>). They are part of the game's config (G.config.cheats), so
// a saved game and "Restart" keep them. docs/DEBUG_OPTIONS.md.
//
// "You" is the human player. "Enemies" are the players hostile to you when the game starts (for damage: whoever is
// hostile at the moment of the hit) and everything without an owner (wild animals, neutral buildings). Allies and
// neutral players play by the normal rules.
//
//   on          the options apply at all (off: the game is played as normal, the choices are kept)
//   free        everything is free and builds, trains and researches at once (the older "debug mode": player.debug)
//   reveal      the whole map visible: no fog of war, every place explored
//   unlock      a campaign / sequel mission's bans are ignored: every unit, building and upgrade of your tribe
//   res         your start resources {food, wood, stone, skulls} (null = the game's)
//   storage     your storage limit per resource (null = the buildings')
//   pyramid     your army pyramid's places per level [l1..l5] (null = the game's / the mission's: 25 15 8 3 1)
//   popMax      your unit limit (null = the map's / the mission's, 52 in skirmish)
//   noHousing   your unit limit needs no houses
//   gather      your gathering × (each load is worth that much more)
//   speed       your construction, training and research speed ×
//   me / foe    { startEpoch: 0 | 2..5, maxEpoch: 0 | 1..5, dmg: damage dealt ×, def: defence ÷ damage taken }
//   ai          'normal' | 'passive': the computer players' own armies do not attack (skirmish brains; a mission's
//               scripted attacks still come)

export function defaultCheats() {
  return {
    on: false, free: false, reveal: false, unlock: false, noHousing: false,
    res: { food: null, wood: null, stone: null, skulls: null },
    storage: null, pyramid: [null, null, null, null, null], popMax: null,
    gather: 1, speed: 1, ai: 'normal',
    me: { startEpoch: 0, maxEpoch: 0, dmg: 1, def: 1 },
    foe: { startEpoch: 0, maxEpoch: 0, dmg: 1, def: 1 },
  };
}

const num = (v, lo, hi, dflt) => { const n = typeof v === 'string' ? (v.trim() === '' ? NaN : +v) : v == null ? NaN : +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
const int = (v, lo, hi) => { const n = num(v, lo, hi, null); return n == null ? null : Math.round(n); };

// a stored or URL-given set of options with every field present and in range
export function normCheats(c) {
  const d = defaultCheats();
  if (!c || typeof c !== 'object') return d;
  const side = (s, o = {}) => ({
    startEpoch: int(o.startEpoch, 0, 5) || 0, maxEpoch: int(o.maxEpoch, 0, 5) || 0,
    dmg: num(o.dmg, 0, 100, 1), def: num(o.def, 0.05, 100, 1),
  });
  return {
    on: !!c.on, free: !!c.free, reveal: !!c.reveal, unlock: !!c.unlock, noHousing: !!c.noHousing,
    res: Object.fromEntries(Object.keys(d.res).map((r) => [r, int((c.res || {})[r], 0, 1e7)])),
    storage: int(c.storage, 0, 1e7),
    pyramid: [0, 1, 2, 3, 4].map((i) => int((c.pyramid || [])[i], 0, 200)),
    popMax: int(c.popMax, 1, 2000),
    gather: num(c.gather, 0, 100, 1), speed: num(c.speed, 0.1, 100, 1),
    ai: c.ai === 'passive' ? 'passive' : 'normal',
    me: side('me', c.me), foe: side('foe', c.foe),
  };
}

// what differs from a normal game, as short phrases (the menus' summary line, the HUD) - [] when nothing does
export function cheatSummary(c) {
  if (!c || !c.on) return [];
  const out = [], x = (v) => `×${+v.toFixed(2)}`;
  if (c.free) out.push('free and instant');
  if (c.reveal) out.push('map revealed');
  if (c.unlock) out.push('no mission bans');
  const res = Object.entries(c.res || {}).filter(([, v]) => v != null);
  if (res.length) out.push('start ' + res.map(([r, v]) => `${v} ${r}`).join(', '));
  if (c.storage != null) out.push(`storage ${c.storage}`);
  if ((c.pyramid || []).some((v) => v != null)) out.push('pyramid ' + c.pyramid.map((v) => (v == null ? '·' : v)).join('/'));
  if (c.popMax != null) out.push(`unit limit ${c.popMax}`);
  if (c.noHousing) out.push('no housing');
  if (c.gather !== 1) out.push(`gathering ${x(c.gather)}`);
  if (c.speed !== 1) out.push(`build speed ${x(c.speed)}`);
  if (c.ai === 'passive') out.push('passive computer');
  for (const [k, who] of [['me', 'you'], ['foe', 'enemies']]) {
    const s = c[k] || {};
    if (s.startEpoch > 1) out.push(`${who} start in epoch ${s.startEpoch}`);
    if (s.maxEpoch) out.push(`${who} up to epoch ${s.maxEpoch}`);
    if (s.dmg !== 1) out.push(`${who} damage ${x(s.dmg)}`);
    if (s.def !== 1) out.push(`${who} defence ${x(s.def)}`);
  }
  return out;
}

// the options of a config: normalised, or null for a normal game
export function configCheats(cfg) {
  if (!cfg || !cfg.cheats) return null;
  const c = normCheats(cfg.cheats);
  return c.on ? c : null;
}

// which side a player is on: 'me' (the human), 'foe' (hostile to the human, or nobody's), null (allied / neutral)
export function sideOf(W, p) {
  const C = W.cheats;
  if (!C) return null;
  if (!p) return 'foe';
  if (p.id === C.human) return 'me';
  const me = W.players.find((q) => q.id === C.human);
  return me && (me.isEnemy(p) || p.isEnemy(me)) ? 'foe' : null;
}

// damage after the options: × the attacker's side's damage, ÷ the victim's side's defence (combat.js damage)
export function cheatDamage(W, d, A, V) {
  const C = W.cheats;
  if (!C) return d;
  const a = A ? sideOf(W, A.owner) : null, v = sideOf(W, V.owner);
  if (a) d *= C[a].dmg;
  if (v) d /= C[v].def;
  return d;
}

// set the options up in a game whose players and objects exist (main.js, before the computer players start)
export function applyCheats(G, c) {
  const W = G.world, D = G.data, me = G.me;
  if (!c || !me) { W.cheats = null; return; }
  W.cheats = { human: me.id, me: { ...c.me }, foe: { ...c.foe }, gather: c.gather, speed: c.speed, ai: c.ai };
  const foes = W.players.filter((p) => p !== me && (me.isEnemy(p) || p.isEnemy(me)));
  if (c.free) me.debug = true;
  // epochs: the highest an action may reach (rules.js check), the start epoch through the upgrades themselves
  me.maxEpoch = c.me.maxEpoch || 0;
  for (const p of foes) p.maxEpoch = c.foe.maxEpoch || 0;
  raiseEpoch(G, me, c.me.startEpoch, c.me.maxEpoch);
  for (const p of foes) raiseEpoch(G, p, c.foe.startEpoch, c.foe.maxEpoch);
  // (no "Epoch III reached!" messages for the epochs a game starts in)
  if (W.events) for (let i = W.events.length - 1; i >= 0; i--) { const e = W.events[i]; if (e.type === 'upgrade' && e.action && /^age_\d$/.test(e.action.id)) W.events.splice(i, 1); }
  // your economy and army
  for (const [r, v] of Object.entries(c.res)) if (v != null) me.res[r] = v;
  me.cheat = { storage: c.storage, popMax: c.popMax, noHousing: c.noHousing, gather: c.gather, speed: c.speed };
  if (c.popMax != null) me.popMax = c.popMax;
  if (c.pyramid.some((v) => v != null)) {
    const base = me.pyramid || D.pyramid;
    me.pyramid = base.map((v, i) => (c.pyramid[i] != null ? c.pyramid[i] : v));
    me.cheat.pyramid = me.pyramid.slice();
    // more places in the pyramid raise the unit limit with them (the game's 52 = 25 + 15 + 8 + 3 + 1): at least the
    // pyramid's sum, unless the limit is set itself
    if (c.popMax == null) { me.cheat.popFloor = me.pyramid.reduce((a, v) => a + (v || 0), 0); me.popMax = Math.max(me.popMax, me.cheat.popFloor); }
  }
  W.recomputeCaps(me);
  if (c.reveal && G.fow) G.fow.revealAll = true;
}

// give player p the epoch upgrades up to `epoch` (capped by `max`), as if researched at its headquarters
export function raiseEpoch(G, p, epoch, max = 0) {
  const W = G.world, D = G.data;
  const top = max ? Math.min(epoch, max) : epoch;
  for (let k = p.epoch() + 1; k <= top; k++) {
    const id = 'age_' + k;
    const a = D.actions(p).find((x) => x.kind === 'Upgrades' && x.id === id);
    if (!a) break;
    // the building that offers it (headquarters, fireplace, ...), else any of the player's objects
    const at = W.buildings.find((b) => b.alive && b.owner === p && D.actionsOf(b.rulesOwner(), b).some((x) => x.id === id)) ||
      W.buildings.find((b) => b.alive && b.owner === p) || W.units.find((u) => u.alive && u.owner === p) || null;
    W.completeUpgrade(at || { owner: p, kind: 'none', pos: null, refreshRules() {} }, a);
  }
}

// ---------------------------------------------------------------- objects put down on the map (debug tools; ?spawn=)
// the classes that can be put down: units, animals and buildings of the tech tree -> [{name, tribe, type}]
export function spawnable(D) {
  const out = [];
  for (const [name, ix] of D.index) if (['CHTR', 'ANML', 'VHCL', 'SHIP', 'BLDG'].includes(ix.type)) out.push({ name, tribe: ix.tribe, type: ix.type });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
// the models a class shows (for loading them before the game starts: main.js mapModels)
export function spawnModels(D, names) {
  const out = new Set();
  for (const n of names) {
    for (let l = 1; l <= 5; l++) { const s = D.stats(n, l, null); if (s && s.gfx) out.add(s.gfx.toLowerCase()); }
    const cg = D.classGfx && D.classGfx(n); if (cg) out.add(cg);
  }
  return out;
}
// put an object down at (x, z) for `side` ('me' | 'foe' | 'wild'): a unit, an animal, a finished building.
// -> the object, or a reason why not
export function spawnObject(G, name, side, x, z, level = 1) {
  const W = G.world, D = G.data;
  // MIRAGE's Stina is hired riding her sabre-tooth (Building.usl: Stina_s0 -> special_eusmilus); the missions ask for
  // that object ("Stina in region"), so the debug tool puts her down the same way
  if (/^stina_s0$/i.test(name) && D.extra && D.extra.mod === 'MIRAGE' && D.info('special_eusmilus')) name = 'special_eusmilus';
  const ix = D.info(name);
  if (!ix) return `${name}: no such object in this game's data`;
  const owner = side === 'wild' ? null : side === 'foe' ? (W.players.find((p) => p !== G.me && (G.me.isEnemy(p) || p.isEnemy(G.me))) || null) : G.me;
  if (side !== 'wild' && !owner) return 'no enemy player in this game';
  if (ix.type === 'BLDG') {
    const at = W.placement ? W.placement(name, x, z, 0, owner) : { ok: true, x, z, rot: 0 };
    if (at && at.ok === false) return `${name}: no room here`;
    return W.placeBuilding(name, owner, at.x ?? x, at.z ?? z, at.rot || 0, true) || `${name} could not be placed`;
  }
  const lv = Math.max(D.minLevel ? D.minLevel(name, owner) || 1 : 1, Math.min(5, level));
  const u = W.spawnUnit(name, owner, x, z, owner ? lv : undefined, Math.random() * 6.28);
  if (!u) return `${name} could not be placed (no model, or blocked ground)`;
  if (!owner && u.home) u.home.set(x, z);
  if (owner) W.recomputeCaps(owner);
  return u;
}

// the debug tools' object report: every object (alive or not) within r of (x, z) with what decides whether it can be
// hit and attacked, for bug reports ("a building became immune")
export function objectReport(G, x, z, r = 25) {
  const W = G.world, me = G.me, t = W.time, sel = [...(G.sel || [])].filter((e) => e.alive && e.kind === 'unit');
  const timers = (e) => Object.entries((e.st && e.st.t) || {}).filter(([, v]) => v > t).map(([k, v]) => `${k} ${(v - t).toFixed(0)}s`).join(' ');
  const lines = [`time ${t.toFixed(1)} at ${x.toFixed(0)},${z.toFixed(0)}; ${G.campaign ? 'mission ' + (G.config && G.config.campaign) : 'skirmish'}; me ${me && me.id} ${me && me.tribe}`];
  const hashed = new Set(); W.bHash.query(x, z, r + 30, (e) => hashed.add(e));
  const list = [...new Set([...W.buildings, ...W.units, ...(W.dead || [])])].filter((e) => e.pos && Math.hypot(e.pos.x - x, e.pos.z - z) <= r);
  for (const e of list) {
    const f = [];
    if (!e.alive) f.push('DEAD'); if (e.removed) f.push('removed'); if (e.obj && e.obj.parent) f.push('inScene'); if (e.obj && !e.obj.visible) f.push('hiddenObj');
    if (e.ruin) f.push('ruin' + (e.ruin.parent ? 'InScene' : ''));
    if (e.kind === 'building') { f.push(e.built ? 'built' : 'unbuilt ' + (e.progress || 0).toFixed(2)); if (!hashed.has(e)) f.push('NOT-IN-HASH'); if (!W.buildings.includes(e)) f.push('NOT-IN-LIST'); }
    if (W.invulnerable(e)) f.push('INVULNERABLE' + (e.invulnT > 0 ? ' invulnT' : ''));
    if (e.untargetable) f.push('untargetable'); if (e.unselectable) f.push('unselectable'); if (e.inside) f.push('inside'); if (e.parked) f.push('parked');
    if (me && W.hiddenFrom(e, me)) f.push('hiddenFromMe');
    if (e.parentGate) f.push('wingOf ' + e.parentGate.name);
    const rel = e.owner && me ? (me.isEnemy(e.owner) ? 'enemy' : me.isFriend(e.owner) ? 'friend' : 'neutral') + '/' + (e.owner.isEnemy(me) ? 'enemy' : e.owner.isFriend(me) ? 'friend' : 'neutral') : e.owner ? '' : 'ownerless';
    const tg = sel.length ? ' canTarget by selection ' + sel.slice(0, 3).map((u) => W.canTarget(u, e) ? 'yes' : 'no').join(',') : '';
    const tm = timers(e);
    lines.push(`${e.name} #${e.id ?? ''} ${e.kind} owner ${e.owner ? e.owner.id : '-'} ${rel} hp ${Math.round(e.hp)}/${e.maxHp} ${f.join(' ')}${tm ? ' timers ' + tm : ''}${tg}`);
  }
  return lines.join('\n');
}
