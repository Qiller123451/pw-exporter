// Player ("party") colours of the original game: Data/Base/Scripts/Game/misc/ACColors.txt, PlayerColor0..7.
//   light - used to tint the party-colour parts of models (materials with GSF flag 0x1000: banners, cloth, shields)
//   dark  - used on the minimap and for selection rings / health bars
// "none" keeps the models untinted (the look of the remake before colours were added).
export const PLAYER_COLORS = [
  { id: 'yellow', name: 'Yellow', light: [255, 232, 128], dark: [229, 198, 60] },
  { id: 'red', name: 'Red', light: [225, 85, 85], dark: [204, 51, 51] },
  { id: 'cyan', name: 'Cyan', light: [115, 229, 229], dark: [48, 191, 191] },
  { id: 'blue', name: 'Blue', light: [121, 161, 242], dark: [51, 102, 204] },
  { id: 'green', name: 'Green', light: [121, 242, 121], dark: [67, 191, 67] },
  { id: 'purple', name: 'Purple', light: [153, 102, 204], dark: [102, 51, 153] },
  { id: 'pink', name: 'Pink', light: [242, 121, 202], dark: [204, 51, 153] },
  { id: 'orange', name: 'Orange', light: [242, 161, 121], dark: [204, 102, 51] },
];
// minimap / UI colours when a player has no party colour
export const NEUTRAL_UI = { me: 0x3a8cff, ai: 0xe0402a };

export const hex = (rgb) => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
export function colorById(id) { return PLAYER_COLORS.find((c) => c.id === id) || null; }

// GSF material flag "use player colour" (attr1 bit 12, see claude/gsf_format_notes.md)
export const PARTY_FLAG = 0x1000;
export function isPartyMaterial(mat) {
  const f = mat && mat.userData && mat.userData.gsf_flags;
  return !!f && (parseInt(String(f).split('/')[0], 16) & PARTY_FLAG) !== 0;
}
