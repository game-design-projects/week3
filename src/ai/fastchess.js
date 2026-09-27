// Thin adapter over chess.js PRIVATE internals, used only by the AI search.
//
// Why: chess.js's public SAN API does ~25k nodes/s, its internal move
// generator ~1M nodes/s. This is the ONLY file allowed to touch `_moves`,
// `_makeMove`, `_undoMove`, `_board`, `_kings`, `_hash`, … — and
// tests/fastchess.test.js pins every behaviour relied on here, so a chess.js
// upgrade that changes them fails loudly instead of making the AI play nonsense.
//
// Squares are 0x88 indices (a8 = 0, h8 = 7, a1 = 112, h1 = 119).
// Internal moves: { color, from, to, piece, captured?, promotion?, flags(bitmask) }.
// NOTE: internal make/undo do NOT update chess.js's repetition counters —
// the search tracks its own hash stack (see fromGame()).

import { Chess } from '../../vendor/chess.js';

const BITS_EP_CAPTURE = 8;
const FILES = 'abcdefgh';

export const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export function fromAlgebraic(square) {
  if (!/^[a-h][1-8]$/.test(square)) throw new Error(`bad square: ${square}`);
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return (8 - rank) * 16 + file;
}

export function toAlgebraic(sq) {
  return `${FILES[sq & 7]}${8 - (sq >> 4)}`;
}

export function moveToUci(move) {
  return `${toAlgebraic(move.from)}${toAlgebraic(move.to)}${move.promotion ?? ''}`;
}

export class FastChess {
  /** @param {string|Chess} fenOrChess */
  constructor(fenOrChess) {
    this.chess = fenOrChess instanceof Chess ? fenOrChess : new Chess(fenOrChess);
  }

  /**
   * Replay a game through the PUBLIC API (so chess.js keeps its repetition and
   * 50-move bookkeeping), returning the adapter plus the zobrist hash after
   * every ply (index 0 = start position).
   */
  static fromGame(startFen, ucis = []) {
    const chess = new Chess(startFen);
    const hashes = [chess._hash];
    for (const uci of ucis) {
      try {
        chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      } catch {
        throw new Error(`illegal move in game history: ${uci}`);
      }
      hashes.push(chess._hash);
    }
    return { fc: new FastChess(chess), hashes };
  }

  fen() {
    return this.chess.fen();
  }

  /** Zobrist hash as a BigInt (same value as the public hex hash()). */
  hash() {
    return this.chess._hash;
  }

  turn() {
    return this.chess._turn;
  }

  halfMoves() {
    return this.chess._halfMoves;
  }

  inCheck() {
    return this.chess._isKingAttacked(this.chess._turn);
  }

  kingSquare(color) {
    return this.chess._kings[color];
  }

  /** @returns {{type, color}|undefined} */
  pieceAt(sq) {
    return this.chess._board[sq] ?? undefined;
  }

  /** cb(sq, type, color) for every piece on the board. */
  forEachPiece(cb) {
    const board = this.chess._board;
    for (let sq = 0; sq < 120; sq++) {
      if (sq & 0x88) {
        sq += 7;
        continue;
      }
      const p = board[sq];
      if (p) cb(sq, p.type, p.color);
    }
  }

  legalMoves() {
    return this.chess._moves({ legal: true });
  }

  /** Pseudo-legal moves (may leave the own king in check) — pair with makeIfLegal. */
  pseudoMoves() {
    return this.chess._moves({ legal: false });
  }

  make(move) {
    this.chess._makeMove(move);
  }

  undo() {
    this.chess._undoMove();
  }

  /** Make the move unless it leaves the mover's king attacked. Returns whether it was made. */
  makeIfLegal(move) {
    const us = this.chess._turn;
    this.chess._makeMove(move);
    if (this.chess._isKingAttacked(us)) {
      this.chess._undoMove();
      return false;
    }
    return true;
  }

  isEnPassant(move) {
    return (move.flags & BITS_EP_CAPTURE) !== 0;
  }

  findMove(uci) {
    return this.legalMoves().find((m) => moveToUci(m) === uci) ?? null;
  }
}
