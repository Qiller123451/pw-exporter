// The effect events of the models' animations - from the GSF header 1 "dusttrail" table (gsf.ksy dusttrail_table:
// model, animation, effect class, frame), the camera shakes among them; ui/gamefx.js SHAKES has their values.
// (Read once from the game's GSF files with a scratch decoder; the converter does not export the table yet.)
// model (or the model whose animations it uses) -> clip -> [[frame at 25 fps, class]]
export const ANIM_FX = {
  brachiosaurus: {
    walk_1: [[24, 'CBrachioWalking'], [38, 'CBrachioWalking'], [60, 'CBrachioWalking'], [84, 'CBrachioWalking']],
    walk_2: [[21, 'CBrachioWalking'], [37, 'CBrachioWalking'], [45, 'CBrachioWalking'], [57, 'CBrachioWalking']],
    walk_left: [[24, 'CBrachioWalking']], walk_right: [[24, 'CBrachioWalking']],
    dying: [[58, 'CBrachioDying']],
  },
  mammoth: { stomp: [[52, 'CPlaceBuildingFX']] },
};
