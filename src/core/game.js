// Match = one battle. A thin, UI-friendly wrapper around chess.js that adds
// resignation, end-reason mapping, material and captured-piece bookkeeping.

import { Chess } from '../../vendor/chess.js';
import { PRICES } from '../config.js';

const other = (side) => (side === 'w' ? 'b' : 'w');

function parseUci(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}

export class Match {
  /** @param {{ startFen: string }} opts */
  constructor({ startFen }) {
    this.startFen = startFen;
    this.chess = new Chess(startFen); // throws on invalid FEN
    this.resigned = null; // side that resigned
    this._captured = { w: [], b: [] };
    this._last = null;
  }

  fen() {
    return this.chess.fen();
  }

  turn() {
    return this.chess.turn();
  }

  board() {
    return this.chess.board();
  }

  history() {
    return this.chess.history();
  }

  historyUci() {
    return this.chess.history({ verbose: true }).map((m) => `${m.from}${m.to}${m.promotion ?? ''}`);
  }

  plies() {
    return this.chess.history().length;
  }

  pgn() {
    return this.chess.pgn();
  }

  /** Legal destinations from a square. Promotions are listed once per target (with promotion: true). */
  legalMovesFrom(square) {
    if (this.status().over) return [];
    const seen = new Map();
    for (const m of this.chess.moves({ square, verbose: true })) {
      if (seen.has(m.to)) continue;
      seen.set(m.to, {
        to: m.to,
        san: m.san,
        promotion: !!m.promotion,
        captured: m.captured,
        flags: m.flags,
      });
    }
    return [...seen.values()];
  }

  needsPromotion(from, to) {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
  }

  /**
   * @param {{from:string,to:string,promotion?:string}|string} input object or UCI ('e7e8q')
   */
  move(input) {
    if (this.status().over) throw new Error('game is over');
    const req = typeof input === 'string' ? parseUci(input) : input;
    let m;
    try {
      m = this.chess.move({ from: req.from, to: req.to, promotion: req.promotion });
    } catch {
      throw new Error(`illegal move: ${req.from}${req.to}${req.promotion ?? ''}`);
    }
    if (m.captured) this._captured[m.color].push(m.captured);
    this._last = { from: m.from, to: m.to };
    return {
      san: m.san,
      from: m.from,
      to: m.to,
      color: m.color,
      piece: m.piece,
      captured: m.captured,
      promotion: m.promotion,
      check: this.chess.inCheck(),
      mate: this.chess.isCheckmate(),
      fen: this.chess.fen(),
    };
  }

  resign(side) {
    if (this.status().over) return;
    this.resigned = side;
  }

  /** @returns {{over:boolean, winner:'w'|'b'|null, reason:string|null, inCheck:boolean, turn:'w'|'b'}} */
  status() {
    const c = this.chess;
    const turn = c.turn();
    const inCheck = c.inCheck();
    const done = (winner, reason) => ({ over: true, winner, reason, inCheck, turn });
    if (this.resigned) return done(other(this.resigned), 'resign');
    if (c.isCheckmate()) return done(other(turn), 'checkmate');
    if (c.isStalemate()) return done(null, 'stalemate');
    if (c.isInsufficientMaterial()) return done(null, 'insufficient');
    if (c.isThreefoldRepetition()) return done(null, 'threefold');
    if (c.isDrawByFiftyMoves()) return done(null, 'fifty-move');
    return { over: false, winner: null, reason: null, inCheck, turn };
  }

  /** Material in gold (config prices), kings excluded. */
  material() {
    const total = { w: 0, b: 0 };
    for (const row of this.chess.board()) {
      for (const p of row) if (p && p.type !== 'k') total[p.color] += PRICES[p.type];
    }
    return { w: total.w, b: total.b, diff: total.w - total.b };
  }

  /** Piece types captured BY each side. */
  captured() {
    return { w: [...this._captured.w], b: [...this._captured.b] };
  }

  kingSquare(side) {
    return this.chess.findPiece({ type: 'k', color: side })[0] ?? null;
  }

  lastMove() {
    return this._last;
  }
}
