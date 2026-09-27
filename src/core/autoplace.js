// Heuristic army placement, shared by the AI (placing its own army) and the
// player's UX (buying a piece drops it on a sensible square; "Auto-arrange").
//
// Heuristic, per piece type, as preferred files on the back rank / pawn rank:
//   king in the centre-ish, pawns shielding it first, rooks towards the
//   corners, bishops on opposite colours, knights b/g, queen next to the king.
// Candidate placements are scored; any that fail validateMatch are skipped.

import { ZONES } from '../config.js';
import { createRng, shuffle } from '../lib/rng.js';
import { allowedSquares, pieceAt, validateMatch, validateSide } from './placement.js';

const FILES = 'abcdefgh';
const fileOf = (sq) => FILES.indexOf(sq[0]);
const isDark = (sq) => (fileOf(sq) + Number(sq[1])) % 2 === 0;

// Preferred files (0 = a) by piece type, best first.
const PREFERRED_FILES = {
  k: [4, 3, 5, 6, 2, 1, 7, 0],
  q: [3, 4, 2, 5, 1, 6, 0, 7],
  r: [0, 7, 3, 4, 1, 6, 2, 5],
  b: [2, 5, 1, 6, 3, 4, 0, 7],
  n: [1, 6, 2, 5, 3, 4, 0, 7],
  p: [4, 3, 5, 2, 6, 1, 7, 0],
};
const ORDER = ['k', 'q', 'r', 'b', 'n', 'p'];

function backRank(side, zones) {
  const ranks = zones[side].ranks;
  return side === 'w' ? Math.min(...ranks) : Math.max(...ranks);
}

/** Squares for `type` sorted best-first given the current placement. */
function rankedSquares(side, type, placement, zones) {
  const back = backRank(side, zones);
  const king = placement.find((p) => p.type === 'k');
  const bishops = placement.filter((p) => p.type === 'b');
  const pref = PREFERRED_FILES[type];
  const score = (sq) => {
    const f = fileOf(sq);
    let s = -pref.indexOf(f) * 10;
    const onBack = Number(sq[1]) === back;
    if (type !== 'p') s += onBack ? 30 : 0; // pieces behind pawns
    if (type === 'p' && king) s -= Math.abs(f - fileOf(king.square)) * 6; // pawns shield the king
    if (type === 'q' && king) s -= Math.abs(f - fileOf(king.square)) * 4;
    if (type === 'b' && bishops.length) s += isDark(sq) !== isDark(bishops[0].square) ? 60 : -60;
    return s;
  };
  return allowedSquares(side, type, zones)
    .filter((sq) => !pieceAt(placement, sq))
    .sort((a, b) => score(b) - score(a));
}

/**
 * Put ONE new piece on the best free legal square, or return null when there is none.
 * Never creates a starting check against `opponent`.
 */
export function addPieceAuto(side, placement, type, { opponent = [], zones = ZONES } = {}) {
  for (const square of rankedSquares(side, type, placement, zones)) {
    const next = [...placement, { type, square }];
    if (safe(side, next, opponent, zones)) return next;
  }
  return null;
}

const CONFLICTS = ['overlap', 'white-king-attacked', 'black-king-attacked'];

/** Is a (possibly partial, possibly king-less) placement acceptable so far? */
function safe(side, placement, opponent, zones) {
  const sideErrors = validateSide(side, placement, zones).errors.filter((e) => e.code !== 'no-king');
  if (sideErrors.length) return false;
  const hasKing = placement.some((p) => p.type === 'k');
  if (!hasKing || !opponent.some((p) => p.type === 'k')) return true;
  const [white, black] = side === 'w' ? [placement, opponent] : [opponent, placement];
  return !validateMatch(white, black, zones).errors.some((e) => CONFLICTS.includes(e.code));
}

/**
 * Full placement (king included) for `army`. Deterministic for a given rng.
 * Tries the greedy heuristic first, then shuffled piece orders until valid.
 */
export function autoPlace(side, army, { rng = createRng(1), opponent = [], zones = ZONES } = {}) {
  const pieces = ORDER.flatMap((t) => (t === 'k' ? ['k'] : Array(army[t] ?? 0).fill(t)));
  for (let attempt = 0; attempt < 60; attempt++) {
    const order = attempt === 0 ? pieces : ['k', ...shuffle(rng, pieces.slice(1))];
    let placement = [];
    let failed = false;
    for (const type of order) {
      const squares = rankedSquares(side, type, placement, zones);
      // Later attempts sample among the top few squares for variety.
      const candidates = attempt === 0 ? squares : shuffle(rng, squares.slice(0, 3)).concat(squares.slice(3));
      const pick = candidates.find((sq) => safe(side, [...placement, { type, square: sq }], opponent, zones));
      if (!pick) {
        failed = true;
        break;
      }
      placement = [...placement, { type, square: pick }];
    }
    if (failed) continue;
    const [white, black] = side === 'w' ? [placement, opponent] : [opponent, placement];
    const ok = opponent.length ? validateMatch(white, black, zones).ok : validateSide(side, placement, zones).ok;
    if (ok) return placement;
  }
  throw new Error(`autoPlace: no legal placement for ${side} army ${JSON.stringify(army)}`);
}
