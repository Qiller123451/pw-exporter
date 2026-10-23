// The people of the sequel campaign (docs/SEQUEL.md): their names, the radio box colour and their portrait - a card
// of the game's own portraits (the HUD card atlas, ui/atlas.js), as the original campaign's dialogues show their
// speakers (ui/mission.js). The heroes are copies of the first game's and look like them in the game, so they have
// those heroes' portraits; the others a SEAS soldier's or another character's face.
export const CAST = {
  halloran: { name: 'Col. Halloran', color: '#3a6ea8', card: 'lovelace' },
  taslov: { name: 'Dr. Taslov', color: '#6a8a5a', card: 'tesla' },
  booker: { name: 'Sgt. Booker', color: '#8a6a3a', card: 'cole' },
  tala: { name: 'Tala', color: '#b07830', card: 'stina' },
  crane: { name: 'Augustus Crane', color: '#5a5a5a', card: 'babbage' },
  kiko: { name: 'Kiko Arakawa', color: '#a85a7a', card: 'seas_worker' },          // the pilot: flying cap and goggles
  radio: { name: 'SEAS Command', color: '#4a5a6a', card: 'seas_marksman' },       // an officer's cap
  sheriff: { name: 'Sheriff Doyle', color: '#8a7a4a', card: 'harry' },
  scientist: { name: 'Dr. Ruth Imai', color: '#5a7a8a', card: 'tarna' },
  guard: { name: 'Capt. Ruiz', color: '#6a7a4a', card: 'seas_gunner' },            // the National Guard (mission 12)
  deputy: { name: 'Deputy Alvarez', color: '#8a7a4a', card: 'seas_marksman' },
  driver: { name: 'Cpl. Kowalski', color: '#7a6a5a', card: 'seas_worker' },
  // the scenarios (game/scenarios/missions.js): the heroes of the tribe played, the other voices
  bela: { name: 'Bela', color: '#8a5a3a', card: 'bela' },
  tarna: { name: 'Tarna', color: '#b07830', card: 'tarna' },
  cole: { name: 'Cole', color: '#8a6a3a', card: 'cole' },
  miyagi: { name: 'Miyagi', color: '#a83a3a', card: 'miyagi' },
  hermit: { name: 'The Hermit', color: '#a83a3a', card: 'hermit' },
  ada: { name: 'Ada', color: '#3a6ea8', card: 'lovelace' },
  elder: { name: 'The Elder', color: '#7a7a5a', card: 'mayor' },
  scout: { name: 'Scout', color: '#5a7a5a', card: 'hu_scout' },
  herald: { name: 'Herald of the Hunt', color: '#9a7a3a', card: 'darwin' },
  envoyA: { name: 'Envoy', color: '#9a2a2a', card: 'cole' },
  envoyB: { name: 'Envoy', color: '#6a3a9a', card: 'livingstone' },
  warlord: { name: 'The Warlord', color: '#5a2a2a', card: 'babbage' },
  seer: { name: 'The Seer', color: '#6a5a8a', card: 'tesla' },
};
