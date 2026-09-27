// How the AI drafts in free mode. Every affordable piece gets a score =
// value-per-gold (≈1 for all pieces at classic prices) + what the army still
// needs (a mating piece, a pawn shield, the bishop pair) − diminishing returns,
// then seeded noise so drafts vary. It passes only when nothing is affordable.

import { PIECE_TYPES } from '../config.js';
import { draftOptions } from './draft.js';

const VALUE = { q: 9.5, r: 5, b: 3.25, n: 3, p: 1 };

/**
 * @returns {'q'|'r'|'b'|'n'|'p'|'pass'}
 */
export function chooseDraftPick(state, side, rng) {
  const options = draftOptions(state, side);
  if (!options.length) return 'pass';
  const army = state.armies[side];
  const opponent = state.armies[side === 'w' ? 'b' : 'w'];
  const hasHeavy = army.q + army.r > 0;
  const hasMate = hasHeavy || army.b + army.n >= 2;
  const pawnTarget = Math.max(2, Math.min(6, Math.round(state.budget / 4)));
  const heavyAffordable = options.some((t) => t === 'q' || t === 'r');

  let best = 'pass';
  let bestScore = -Infinity;
  for (const type of options) {
    let score = (VALUE[type] / state.prices[type]) * (1 + (rng() - 0.5) * 0.8);
    if (!hasHeavy && (type === 'q' || type === 'r')) score += 0.6; // mating material first
    if (!hasMate && type === 'p' && heavyAffordable) score -= 0.8; // don't fritter it away
    if (type === 'p' && army.p < pawnTarget) score += 0.45; // a pawn shield
    if (type === 'b' && army.b === 1) score += 0.3; // bishop pair
    if (type === 'n' && opponent.p >= 5) score += 0.15; // knights like closed boards
    if (type !== 'p') score -= 0.15 * army[type]; // diminishing returns
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }
  return PIECE_TYPES.includes(best) ? best : 'pass';
}
