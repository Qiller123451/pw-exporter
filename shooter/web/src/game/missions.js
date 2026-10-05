// The missions. Each one is a map plus its own districts (zones) and objectives; everything else in config.js is
// shared. useMission() puts the chosen one into CFG before anything is loaded.
import { CFG } from './config.js';
import { ASSAULT } from './mission_assault.js';
import { FROST } from './mission_frost.js';

export const MISSIONS = {
  holycity: { id: 'holycity', title: CFG.mission.title, blurb: 'Alone against the Dustriders: burn their camp before the walls, break through the gate and fight through the ruined city up to the temple.', map: CFG.map, zones: CFG.zones, mission: CFG.mission },
  assault: ASSAULT,
  frost: FROST,
};
export function useMission(id) {
  const m = MISSIONS[id] || MISSIONS.holycity;
  CFG.missionId = m.id; CFG.map = m.map; CFG.zones = m.zones; CFG.mission = m.mission;
  for (const k of ['look', 'nav', 'swarm', 'allies', 'physics']) if (m[k]) CFG[k] = { ...(CFG[k] || {}), ...m[k] };
  // a mission may bring its own enemy (types added to CFG.enemies; only the faction it names is loaded) and what
  // the player may ride for a stretch (CFG.rides, rides.js)
  if (m.enemies) Object.assign(CFG.enemies, m.enemies);
  CFG.faction = m.faction || 'aje'; CFG.enemyName = m.enemyName || 'Dustriders'; CFG.music = m.music || 'Aje';
  CFG.rides = m.rides || null; CFG.weather = m.weather || null;
  return m;
}
