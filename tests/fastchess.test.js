// Pins the behaviour of the chess.js PRIVATE internals that src/ai/fastchess.js
// wraps. If a chess.js upgrade changes any of them, these tests fail loudly
// instead of the AI silently playing illegal or nonsense moves.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../vendor/chess.js';
import {
  FastChess,
  toAlgebraic,
  fromAlgebraic,
  moveToUci,
  PIECE_VALUES,
} from '../src/ai/fastchess.js';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1';
const ROOKY = 'r3kb2/5ppp/8/8/8/8/PPPP4/RNB1K3 w - - 0 1';
// Level 1 style: White R+B+N+P (12 gold) vs "The Keep".
const LEVEL1 = '3r2k1/4bppp/8/8/8/8/4P3/R1B1K1N1 w - - 0 1';
// Position with en passant, promotions (both sides) and checks available.
const TRICKY = 'r3k3/1P4P1/8/3pP3/8/8/1p4p1/R3K3 w - d6 0 1';

function perftInternal(fc, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of fc.legalMoves()) {
    fc.make(m);
    n += perftInternal(fc, depth - 1);
    fc.undo();
  }
  return n;
}

// Same count, but via pseudo-legal generation + makeIfLegal (the search's path).
function perftPseudo(fc, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of fc.pseudoMoves()) {
    if (!fc.makeIfLegal(m)) continue;
    n += perftPseudo(fc, depth - 1);
    fc.undo();
  }
  return n;
}

function perftPublic(chess, depth) {
  if (depth === 0) return 1;
  let n = 0;
  for (const san of chess.moves()) {
    chess.move(san);
    n += perftPublic(chess, depth - 1);
    chess.undo();
  }
  return n;
}

test('fastchess: algebraic <-> 0x88 helpers', () => {
  assert.equal(fromAlgebraic('a8'), 0);
  assert.equal(fromAlgebraic('h8'), 7);
  assert.equal(fromAlgebraic('a1'), 112);
  assert.equal(fromAlgebraic('h1'), 119);
  assert.equal(fromAlgebraic('e4'), 68);
  for (const sq of ['a1', 'b7', 'e4', 'h8', 'd5']) assert.equal(toAlgebraic(fromAlgebraic(sq)), sq);
  assert.throws(() => fromAlgebraic('i9'));
});

test('fastchess: PIECE_VALUES are the classic centipawn values', () => {
  assert.deepEqual(PIECE_VALUES, { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 });
});

test('fastchess: internal perft(3) from the standard start is 8902', () => {
  const fc = new FastChess(START);
  assert.equal(perftInternal(fc, 3), 8902);
  assert.equal(perftPseudo(fc, 3), 8902);
  assert.equal(fc.fen(), START);
});

for (const fen of [ROOKY, LEVEL1, TRICKY]) {
  test(`fastchess: internal perft matches the public API (${fen})`, () => {
    const fc = new FastChess(fen);
    const expected = perftPublic(new Chess(fen), 3);
    assert.equal(perftInternal(fc, 3), expected);
    assert.equal(perftPseudo(fc, 3), expected);
    assert.equal(fc.fen(), fen, 'make/undo must restore the position exactly');
  });
}

test('fastchess: make/undo restores fen and hash exactly (captures, ep, promotion)', () => {
  const fc = new FastChess(TRICKY);
  const fen0 = fc.fen();
  const hash0 = fc.hash();
  for (const m of fc.legalMoves()) {
    fc.make(m);
    assert.notEqual(fc.hash(), hash0);
    fc.undo();
    assert.equal(fc.fen(), fen0);
    assert.equal(fc.hash(), hash0);
  }
});

test('fastchess: moves carry from/to/piece/captured/promotion/flags', () => {
  const fc = new FastChess(TRICKY);
  const ucis = fc.legalMoves().map(moveToUci);
  assert.ok(ucis.includes('e5d6'), 'en passant listed');
  assert.ok(ucis.includes('b7b8q') && ucis.includes('b7b8n'), 'underpromotions listed');
  const ep = fc.legalMoves().find((m) => moveToUci(m) === 'e5d6');
  assert.equal(ep.captured, 'p');
  assert.ok(fc.isEnPassant(ep));
  const promo = fc.legalMoves().find((m) => moveToUci(m) === 'b7a8q');
  assert.equal(promo.captured, 'r');
  assert.equal(promo.promotion, 'q');
  assert.equal(promo.piece, 'p');
  assert.equal(promo.color, 'w');
});

test('fastchess: hash() is a BigInt matching the public zobrist hash, equal for repeated positions', () => {
  const chess = new Chess(START);
  const fc = new FastChess(START);
  assert.equal(typeof fc.hash(), 'bigint');
  assert.equal(fc.hash().toString(16), chess.hash());
  const start = fc.hash();
  for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8']) {
    const m = fc.findMove(uci);
    assert.ok(m, uci);
    fc.make(m);
  }
  assert.equal(fc.hash(), start, 'same position + side to move => same hash');
});

test('fastchess: internal make/undo does NOT update chess.js repetition counters (search must track its own)', () => {
  // Investigation result pinned here: only the public move() calls
  // _incPositionCount(). The search therefore keeps its own hash stack.
  const fc = new FastChess(START);
  for (let i = 0; i < 3; i++) {
    for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8']) fc.make(fc.findMove(uci));
  }
  assert.equal(fc.chess.isThreefoldRepetition(), false);
});

test('fastchess: fromGame replays UCI history with the public API (keeps repetition + halfmove info)', () => {
  const ucis = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
  const { fc, hashes } = FastChess.fromGame(START, ucis);
  assert.equal(hashes.length, ucis.length + 1);
  assert.equal(hashes[0], hashes[4]);
  assert.equal(hashes[0], hashes[8]);
  assert.equal(fc.chess.isThreefoldRepetition(), true);
  assert.equal(fc.halfMoves(), 8);
  assert.throws(() => FastChess.fromGame(START, ['e2e5']), /illegal/i);
});

test('fastchess: turn, inCheck, kingSquare, pieceAt, forEachPiece', () => {
  const fc = new FastChess('4k3/8/8/8/8/8/8/4K2r w - - 0 1');
  assert.equal(fc.turn(), 'w');
  assert.equal(fc.inCheck(), true);
  assert.equal(toAlgebraic(fc.kingSquare('w')), 'e1');
  assert.equal(toAlgebraic(fc.kingSquare('b')), 'e8');
  assert.deepEqual(fc.pieceAt(fromAlgebraic('h1')), { type: 'r', color: 'b' });
  assert.equal(fc.pieceAt(fromAlgebraic('a1')), undefined);
  const seen = [];
  fc.forEachPiece((sq, type, color) => seen.push(`${color}${type}@${toAlgebraic(sq)}`));
  assert.deepEqual(seen.sort(), ['bk@e8', 'br@h1', 'wk@e1']);
});

test('fastchess: makeIfLegal rejects moves that leave the own king in check and leaves the position untouched', () => {
  const fc = new FastChess('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1');
  const fen0 = fc.fen();
  const pseudo = fc.pseudoMoves();
  const illegal = pseudo.find((m) => moveToUci(m) === 'e1e2'); // still attacked by the rook
  assert.ok(illegal);
  assert.equal(fc.makeIfLegal(illegal), false);
  assert.equal(fc.fen(), fen0);
  const legal = pseudo.find((m) => moveToUci(m) === 'e1d2');
  assert.equal(fc.makeIfLegal(legal), true);
  fc.undo();
  assert.equal(fc.fen(), fen0);
});

test('fastchess: throughput sanity (internal API is far faster than the SAN API)', () => {
  const fc = new FastChess(START);
  const t0 = performance.now();
  const n = perftPseudo(fc, 4); // 197281 leaves
  const ms = performance.now() - t0;
  assert.equal(n, 197281);
  // Generous bound so slow CI machines don't flake; ~0.3s on an M-series Mac.
  assert.ok(ms < 8000, `perft(4) took ${ms.toFixed(0)}ms`);
});
