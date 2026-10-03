// The computer player. The code lives in ai/ (a port of the original's script AI: docs/COMPUTER_PLAYER.md,
// docs/spec/ai.md); this file keeps the old import path working.
//
//   new TribeAI(G, player, { difficulty: 0..9, behaviour: 'Dodo' | 'Giraffe' | 'Schnecke' | 'Turtle' | 'FightOnly' |
//                            'Mikrobe', mapOptions, multimap, levelName })
//   new TribeAI(G, player, enemyPlayer, 'easy' | 'normal' | 'hard' | 0..9)        the skirmish opponent
export { TribeAI } from './ai/brain.js';
export { Attack } from './ai/attack.js';
export { PLANS, setAiData, MENU_LEVELS } from './ai/data.js';
