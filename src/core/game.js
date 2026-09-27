// Match = one battle. A UI-friendly wrapper around chess.js that adds
// resignation, end-reason mapping, material/captures bookkeeping and
// MID-BATTLE PURCHASES ("reinforcements").
//
// Reinforcements: gold a side did not spend before the battle is its reserve.
// On its turn a side may, instead of moving, buy a piece and drop it on an
// empty square of its deployment zone (pawns: pawn rank). That uses the turn.
// chess.js has no notion of drops, so a drop "rebases" the engine: we build
// the post-drop FEN and start a fresh chess.js game from it. Match keeps the
// whole history itself (SAN like "N@b1"), and exposes the current segment
// (segmentFen + moves since the last drop) for the AI, which replays it.

import { Chess } from '../../vendor/chess.js';
import { CAPS, PIECE_TYPES, PRICES, ZONES } from '../config.js';
import { isAllowedSquare } from './placement.js';

const other = (side) => (side === 'w' ? 'b' : 'w');

function parseUci(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}

const SQUARES = [];
for (const r of [8, 7, 6, 5, 4, 3, 2, 1]) for (const f of 'abcdefgh') SQUARES.push(`${f}${r}`);

export class Match {
  /**
   * @param {object} opts
   * @param {string} opts.startFen
   * @param {{w:number,b:number}} [opts.reserve] gold available for reinforcements
   * @param {{prices?:object, caps?:object, zones?:object}} [opts.rules]
   */
  constructor({ startFen, reserve = { w: 0, b: 0 }, rules = {} }) {
    this.startFen = startFen;
    this.segmentFen = startFen;
    this.chess = new Chess(startFen); // throws on invalid FEN
    this.reserve = { w: reserve.w ?? 0, b: reserve.b ?? 0 };
    this.rules = { prices: PRICES, caps: CAPS, zones: ZONES, ...rules };
    this.resigned = null; // side that resigned
    this._captured = { w: [], b: [] };
    this._last = null;
    this._san = [];
    this._uci = []; // full history; drops look like 'N@b1'
    this._segmentUci = []; // moves since the last drop (plain UCI only)
    this._drops = [];
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
    return [...this._san];
  }

  /** Full history in UCI; drops are written 'N@b1'. */
  historyUci() {
    return [...this._uci];
  }

  /** What the AI needs to reconstruct the current position (and its repetition history). */
  aiRequest() {
    return { startFen: this.segmentFen, moves: [...this._segmentUci] };
  }

  plies() {
    return this._san.length;
  }

  drops() {
    return this._drops.map((d) => ({ ...d }));
  }

  /** PGN with a FEN header; drops appear as e.g. "N@b1". */
  pgn() {
    const startTurn = this.startFen.split(' ')[1];
    const startNo = Number(this.startFen.split(' ')[5] ?? 1);
    const parts = [];
    this._san.forEach((san, i) => {
      const plyColor = (startTurn === 'w') === (i % 2 === 0) ? 'w' : 'b';
      const no = startNo + Math.floor((i + (startTurn === 'b' ? 1 : 0)) / 2);
      if (plyColor === 'w') parts.push(`${no}. ${san}`);
      else parts.push(i === 0 ? `${no}... ${san}` : san);
    });
    const st = this.status();
    const result = !st.over ? '*' : st.winner === 'w' ? '1-0' : st.winner === 'b' ? '0-1' : '1/2-1/2';
    return `[SetUp "1"]\n[FEN "${this.startFen}"]\n[Result "${result}"]\n\n${parts.join(' ')}${parts.length ? ' ' : ''}${result}`;
  }

  /** Legal destinations from a square. Promotions are listed once per target (with promotion: true). */
  legalMovesFrom(square) {
    if (this.status().over) return [];
    const seen = new Map();
    for (const m of this.chess.moves({ square, verbose: true })) {
      if (seen.has(m.to)) continue;
      seen.set(m.to, { to: m.to, san: m.san, promotion: !!m.promotion, captured: m.captured, flags: m.flags });
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
    const uci = `${m.from}${m.to}${m.promotion ?? ''}`;
    if (m.captured) this._captured[m.color].push(m.captured);
    this._last = { from: m.from, to: m.to };
    this._san.push(m.san);
    this._uci.push(uci);
    this._segmentUci.push(uci);
    return {
      san: m.san,
      from: m.from,
      to: m.to,
      color: m.color,
      piece: m.piece,
      captured: m.captured,
      promotion: m.promotion,
      check: this.chess.inCheck(),
      mate: this.status().reason === 'checkmate',
      fen: this.chess.fen(),
    };
  }

  // ---------------------------------------------------------------- reinforcements

  /** How many of `type` `side` has on the board (promoted pieces count). */
  onBoard(side, type) {
    return this.chess.findPiece({ type, color: side }).length;
  }

  /** FEN after dropping `type` on `square` for the side to move (turn passes). */
  _fenAfterDrop(type, square) {
    const side = this.chess.turn();
    const probe = new Chess(this.chess.fen(), { skipValidation: true });
    probe.put({ type, color: side }, square);
    const [placement, , , , , fullmove] = probe.fen().split(' ');
    const next = other(side);
    const moveNo = Number(fullmove) + (side === 'b' ? 1 : 0);
    return `${placement} ${next} - - 0 ${moveNo}`;
  }

  /** Why `side` can't drop `type` on `square` right now, or null if it can. */
  dropProblem(type, square, side = this.chess.turn()) {
    const { prices, caps, zones } = this.rules;
    if (this.status().over) return 'game-over';
    if (side !== this.chess.turn()) return 'not-your-turn';
    if (!PIECE_TYPES.includes(type)) return 'bad-type';
    if (this.reserve[side] < prices[type]) return 'budget';
    if (this.onBoard(side, type) >= caps[type]) return 'cap';
    if (!isAllowedSquare(side, type, square, zones)) return 'out-of-zone';
    if (this.chess.get(square)) return 'occupied';
    // The drop must not leave (or keep) the dropper's own king in check.
    const probe = new Chess(this._fenAfterDrop(type, square), { skipValidation: true });
    const king = probe.findPiece({ type: 'k', color: side })[0];
    if (king && probe.isAttacked(king, other(side))) return 'king-in-check';
    return null;
  }

  /** Every legal drop square for `type` (side to move). */
  legalDropSquares(type) {
    if (this.status().over) return [];
    return SQUARES.filter((sq) => this.dropProblem(type, sq) === null);
  }

  /** Piece types the side to move can drop somewhere right now. */
  droppableTypes() {
    return PIECE_TYPES.filter((t) => this.legalDropSquares(t).length > 0);
  }

  /**
   * Buy a piece from the reserve and drop it. Uses the turn.
   * @returns {{san, type, square, color, cost, check, mate, fen}}
   */
  drop(type, square) {
    const side = this.chess.turn();
    const problem = this.dropProblem(type, square, side);
    if (problem) throw new Error(`illegal drop ${type}@${square}: ${problem}`);
    const cost = this.rules.prices[type];
    const fen = this._fenAfterDrop(type, square);
    this.chess = new Chess(fen);
    this.segmentFen = fen;
    this._segmentUci = [];
    this.reserve = { ...this.reserve, [side]: this.reserve[side] - cost };
    this._last = { from: null, to: square };
    const st = this.status();
    const san = `${type.toUpperCase()}@${square}${st.reason === 'checkmate' ? '#' : this.chess.inCheck() ? '+' : ''}`;
    this._san.push(san);
    this._uci.push(`${type.toUpperCase()}@${square}`);
    this._drops.push({ ply: this._san.length, color: side, type, square, cost });
    return { san, type, square, color: side, cost, check: this.chess.inCheck(), mate: st.reason === 'checkmate', fen };
  }

  // ---------------------------------------------------------------- status

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
    const noMoves = c.moves().length === 0;
    // A side with no piece moves may still be saved by a reinforcement drop.
    const canDrop = noMoves && this._anyDrop();
    if (noMoves && !canDrop) return inCheck ? done(other(turn), 'checkmate') : done(null, 'stalemate');
    if (!canDrop && c.isInsufficientMaterial() && !this._canBuyAnything('w') && !this._canBuyAnything('b')) {
      return done(null, 'insufficient');
    }
    if (c.isThreefoldRepetition()) return done(null, 'threefold');
    if (c.isDrawByFiftyMoves()) return done(null, 'fifty-move');
    return { over: false, winner: null, reason: null, inCheck, turn };
  }

  _canBuyAnything(side) {
    return PIECE_TYPES.some((t) => this.reserve[side] >= this.rules.prices[t] && this.onBoard(side, t) < this.rules.caps[t]);
  }

  /** Is any drop legal for the side to move? (Ignores game-over to avoid recursion.) */
  _anyDrop() {
    const side = this.chess.turn();
    if (!this._canBuyAnything(side)) return false;
    const { prices, caps, zones } = this.rules;
    for (const type of PIECE_TYPES) {
      if (this.reserve[side] < prices[type] || this.onBoard(side, type) >= caps[type]) continue;
      for (const sq of SQUARES) {
        if (!isAllowedSquare(side, type, sq, zones) || this.chess.get(sq)) continue;
        const probe = new Chess(this._fenAfterDrop(type, sq), { skipValidation: true });
        const king = probe.findPiece({ type: 'k', color: side })[0];
        if (!king || !probe.isAttacked(king, other(side))) return true;
      }
    }
    return false;
  }

  /** Material on the board in gold (config prices), kings excluded. */
  material() {
    const total = { w: 0, b: 0 };
    for (const row of this.chess.board()) {
      for (const p of row) if (p && p.type !== 'k') total[p.color] += this.rules.prices[p.type];
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
