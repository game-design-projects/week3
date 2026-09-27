// Starting positions. There is no recruiting phase: a side starts with its
// king (plus, for a level's enemy, a fixed garrison) and a purse of gold that
// it spends during the battle, one piece per turn.

import { KING_START } from '../config.js';
import { armyFromPlacement, emptyArmy } from './army.js';

export function kingOnly(side) {
  return [{ type: 'k', square: KING_START[side] }];
}

/** Level: lone white king with the level's gold vs the fixed enemy garrison. */
export function levelStart(level) {
  return {
    white: { army: emptyArmy(), placement: kingOnly('w'), reserve: level.gold },
    black: { army: armyFromPlacement(level.enemy), placement: level.enemy.map((p) => ({ ...p })), reserve: 0 },
  };
}

/** Free mode / demo: two kings, same purse each. */
export function freeStart(gold) {
  return {
    white: { army: emptyArmy(), placement: kingOnly('w'), reserve: gold },
    black: { army: emptyArmy(), placement: kingOnly('b'), reserve: gold },
  };
}
