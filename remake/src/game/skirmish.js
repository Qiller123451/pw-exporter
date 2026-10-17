// The skirmish game's setup (the original's pre-game window in skirmish mode: PlayerListWindow / PlayerInfoSlot /
// LobbySettingsPage, ServerApp.usl game start; docs/spec/ui_groups7_9.md §10). ui/skirmish.js edits it, main.js
// starts the game from it.
//
//   setup = { map, seed, mode: 'deathmatch' | 'domination' | 'defender', defenderMin, points (-1 predefined, 1000,
//     3000, 10000), warpgate, fog, lockDiplomacy, handicap, chooseHQ, teams, debug,
//     slots: [{ type: 'human' | 'ai' | 'closed', tribe | 'Random', personality: 'Random' | 'Defensive' | 'Balanced' |
//              'Offensive' | 'Passive', level 0..9, team 1..8, color (colors.js id), hp 50..150, hq 0..7 }] }
//   Slot 0 is the human player. A new AI slot: level 5, team (slot % teams) + 1 (PIS:755-777).
import { PLAYER_COLORS } from './colors.js';

export const MAX_SLOTS = 8;
export const MODES = { deathmatch: 'Deathmatch', domination: 'Domination', defender: 'Defender' };
// the map's game type strings (LobbySettingsPage.usl:269-283: "KingOfTheHill" is the old name of Domination)
export const MODE_OF_TYPE = { Deathmatch: 'deathmatch', Domination: 'domination', KingOfTheHill: 'domination', Defender: 'defender' };
// the "Army" column of an AI slot = its personality (PIS:601-642; ServerApp: ai_Random picks Dodo, Giraffe or Schnecke)
export const PERSONALITIES = { Random: null, Defensive: 'Schnecke', Balanced: 'Giraffe', Offensive: 'Dodo', Passive: 'Mikrobe' };
export const TRIBES = ['Hu', 'Aje', 'Ninigi', 'SEAS'];
export const POINTS = [-1, 1000, 3000, 10000];

const rnd = (n) => Math.floor(Math.random() * n);

export function defaultSetup(old = {}) {
  const slots = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    slots.push({ type: i === 0 ? 'human' : i === 1 ? 'ai' : 'closed', tribe: i === 0 ? old.me || 'Hu' : i === 1 ? old.ai || 'Aje' : 'Random',
      personality: 'Random', level: i === 1 && old.aiLevel ? { easy: 1, normal: 4, hard: 8 }[old.aiLevel] ?? 5 : 5, team: (i % 2) + 1,
      color: i === 0 ? old.meColor || 'blue' : i === 1 ? old.aiColor || 'red' : null, hp: 100, hq: i });
  }
  // every slot a colour of its own, the closed ones too (ready when they are opened)
  for (const sl of slots) if (!sl.color) sl.color = (PLAYER_COLORS.find((c) => !slots.some((o) => o.color === c.id)) || PLAYER_COLORS[0]).id;
  return { map: old.map || '', mapName: old.mapName, seed: old.seed || 1234, mode: 'deathmatch', defenderMin: 45, points: 1000, warpgate: old.warpgate !== false,
    fog: true, lockDiplomacy: false, handicap: false, chooseHQ: false, teams: 2, debug: !!old.debug, slots };
}

// the first party colour no other slot has (ACColors.txt order)
export function freeColor(slots, except = null) {
  const used = new Set(slots.filter((s) => s !== except && s.type !== 'closed').map((s) => s.color));
  const c = PLAYER_COLORS.find((x) => !used.has(x.id)) || PLAYER_COLORS[0];
  return c.id;
}

// a slot switched to "AI" (PIS:755-777): level 5, team (slot % teams) + 1, a colour of its own
export function openSlot(setup, i) {
  const sl = setup.slots[i];
  Object.assign(sl, { type: 'ai', level: 5, personality: 'Random', team: (i % Math.max(1, setup.teams)) + 1, hp: 100 });
  if (setup.slots.some((o, k) => k !== i && o.type !== 'closed' && o.color === sl.color)) sl.color = freeColor(setup.slots, sl);
}

// the rules a game type forces (LobbySettingsPage.usl:311-352): Domination and Defender lock diplomacy and switch
// the warp gate off by default, Defender lets the players choose head quarters (the one on the first defends)
export function applyMode(setup, mode) {
  setup.mode = mode;
  setup.warpgate = mode === 'deathmatch';
  if (mode !== 'deathmatch') setup.lockDiplomacy = true;
  if (mode === 'defender') setup.chooseHQ = true;
}

// the setup stored in the settings (older ones: filled up to the current form)
export function loadSetup(stored, old) {
  const d = defaultSetup(old);
  if (!stored || !Array.isArray(stored.slots)) return d;
  const s = { ...d, ...stored, slots: d.slots.map((sl, i) => ({ ...sl, ...(stored.slots[i] || {}) })) };
  s.slots[0].type = 'human';
  for (const sl of s.slots.slice(1)) if (sl.type === 'human') sl.type = 'ai';
  return s;
}

// the slots that play
export const activeSlots = (setup) => setup.slots.map((s, i) => ({ ...s, index: i })).filter((s) => s.type !== 'closed');

// what the start screen refuses (PlayerListWindow.usl:334-456) -> a message or null
export function validate(setup, maxPlayers) {
  const act = activeSlots(setup);
  if (act.length > maxPlayers) return `This map has room for ${maxPlayers} players.`;
  const cols = act.map((s) => s.color).filter((c) => c && c !== 'none');
  if (new Set(cols).size !== cols.length) return 'Every player needs a colour of their own.';
  if (setup.chooseHQ) {
    const hq = act.map((s) => s.hq);
    if (new Set(hq).size !== hq.length) return 'Every player needs a headquarters position of their own.';
    if (hq.some((h) => h >= maxPlayers)) return `This map has ${maxPlayers} headquarters positions.`;
  }
  if (setup.mode === 'defender' && setup.chooseHQ && !act.some((s) => s.hq === 0)) return 'Somebody has to defend: headquarters position 1.';
  if (setup.lockDiplomacy && setup.mode !== 'defender' && new Set(act.map((s) => s.team)).size < 2) return 'With locked diplomacy there must be at least two teams.';
  return null;
}

// the slots as they are played: tribe "Random" resolved (from the map's tribes of that start location), the start
// location (head quarter) of each - chosen, or random and distinct (ServerApp.usl:346-398) - Defender: the slot on
// head quarter 0 defends (team 1), the others attack (team 2) (ServerApp.usl:503-517), the AI personality resolved
// (ai_Random: Dodo / Giraffe / Schnecke - never the Passive one, ServerApp.usl:441-453)
export function resolveSetup(setup, S) {
  const act = activeSlots(setup);
  const hqs = (S.startSlots && S.startSlots.length ? S.startSlots : S.starts.map((s, i) => i)).slice();
  let free = hqs.slice();
  const out = [];
  for (const s of act) {
    let hq = setup.chooseHQ ? s.hq : null;
    if (hq == null || !hqs.includes(hq)) { hq = free.length ? free.splice(rnd(free.length), 1)[0] : hqs[out.length % hqs.length]; } else free = free.filter((h) => h !== hq);
    out.push({ ...s, hq });
  }
  for (const s of out) {
    const allowed = ((S.mp && S.mp.slots[s.hq] && S.mp.slots[s.hq].tribes) || TRIBES).filter((t) => TRIBES.includes(t));
    if (s.tribe === 'Random' || !TRIBES.includes(s.tribe)) s.tribe = allowed[rnd(allowed.length)] || 'Hu';
    if (s.type === 'ai') s.behaviour = PERSONALITIES[s.personality] || ['Dodo', 'Giraffe', 'Schnecke'][rnd(3)];
    if (setup.mode === 'defender') s.team = s.hq === 0 ? 1 : 2;
    const i = hqs.indexOf(s.hq);
    const p = S.starts[i >= 0 ? i : 0];
    s.pos = Array.isArray(p) ? p : [p.x, p.z];
  }
  return out;
}

// the setup of the old two-player cfg ({me, ai, aiLevel, meColor, aiColor}: tests' URL parameters, older saves)
export function legacySetup(cfg) {
  const s = defaultSetup(cfg);
  s.legacy = true;
  s.points = -1;
  return s;
}
