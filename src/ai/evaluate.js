// Static evaluation in centipawns from the side-to-move's point of view.
//   material + piece-square tables (Michniewski's "simplified evaluation")
//   + bishop pair + endgame king activity + mop-up.
// Mop-up matters for this game: buy-your-army battles often end in K+R vs K or
// K+Q vs K, and a shallow search only converts those if the evaluation rewards
// driving the lone king to the edge and bringing its own king closer.

import { PIECE_VALUES } from './fastchess.js';

// Tables are written from White's view, a8 first (row 0 = rank 8).
// prettier-ignore
const PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
  kEnd: [
    -50,-40,-30,-20,-20,-30,-40,-50,
    -30,-20,-10,  0,  0,-10,-20,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 30, 40, 40, 30,-10,-30,
    -30,-10, 20, 30, 30, 20,-10,-30,
    -30,-30,  0,  0,  0,  0,-30,-30,
    -50,-30,-30,-30,-30,-30,-30,-50,
  ],
};

/** Index into a PST for a 0x88 square, mirrored for Black. */
function pstIndex(sq, color) {
  const row = sq >> 4;
  const col = sq & 7;
  return (color === 'w' ? row : 7 - row) * 8 + col;
}

const centerDistance = (sq) => {
  const row = sq >> 4;
  const col = sq & 7;
  return Math.max(3 - row, row - 4) + Math.max(3 - col, col - 4); // 0 (centre) .. 6 (corner)
};
const kingDistance = (a, b) => Math.abs((a >> 4) - (b >> 4)) + Math.abs((a & 7) - (b & 7));

/**
 * @param {import('./fastchess.js').FastChess} pos
 * @returns {number} centipawns, positive = good for the side to move
 */
export function evaluate(pos) {
  const score = { w: 0, b: 0 };
  const nonPawn = { w: 0, b: 0 };
  const pawns = { w: 0, b: 0 };
  const bishops = { w: 0, b: 0 };
  const kings = { w: -1, b: -1 };
  let queens = 0;

  pos.forEachPiece((sq, type, color) => {
    score[color] += PIECE_VALUES[type];
    if (type === 'k') kings[color] = sq;
    else score[color] += PST[type][pstIndex(sq, color)];
    if (type === 'p') pawns[color] += 1;
    else if (type !== 'k') nonPawn[color] += PIECE_VALUES[type];
    if (type === 'b') bishops[color] += 1;
    if (type === 'q') queens += 1;
  });

  const endgame = queens === 0 || nonPawn.w + nonPawn.b <= 1300;
  for (const c of ['w', 'b']) {
    if (bishops[c] >= 2) score[c] += 30;
    if (kings[c] >= 0) score[c] += (endgame ? PST.kEnd : PST.k)[pstIndex(kings[c], c)];
  }

  // Mop-up: the side that is clearly ahead herds the enemy king to the edge.
  const material = { w: nonPawn.w + pawns.w * 100, b: nonPawn.b + pawns.b * 100 };
  for (const [strong, weak] of [['w', 'b'], ['b', 'w']]) {
    if (material[strong] - material[weak] >= 300 && nonPawn[weak] <= 330 && kings.w >= 0 && kings.b >= 0) {
      score[strong] += 12 * centerDistance(kings[weak]) + 5 * (14 - kingDistance(kings.w, kings.b));
    }
  }

  const white = score.w - score.b;
  return pos.turn() === 'w' ? white : -white;
}
