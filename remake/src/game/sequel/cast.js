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
};
