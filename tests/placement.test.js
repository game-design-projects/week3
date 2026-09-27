import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedSquares,
  isAllowedSquare,
  validateSide,
  validateMatch,
  buildFen,
  placementsFromFen,
  movePiece,
  removeAt,
  pieceAt,
} from '../src/core/placement.js';
import { LEVELS } from '../src/config.js';
import { Chess } from '../vendor/chess.js';

const codes = (res) => res.errors.map((e) => e.code).sort();
const K = (square) => ({ type: 'k', square });
const P = (type, square) => ({ type, square });

test('allowedSquares: white pieces ranks 1-2, white pawns rank 2 only', () => {
  const rook = allowedSquares('w', 'r');
  assert.equal(rook.length, 16);
  assert.ok(rook.includes('a1') && rook.includes('h2'));
  assert.ok(!rook.includes('a3'));
  const pawn = allowedSquares('w', 'p');
  assert.deepEqual(pawn, ['a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2']);
});

test('allowedSquares: black pieces ranks 7-8, black pawns rank 7 only', () => {
  const king = allowedSquares('b', 'k');
  assert.equal(king.length, 16);
  assert.ok(king.includes('e8') && king.includes('a7'));
  assert.deepEqual(allowedSquares('b', 'p'), ['a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7']);
});

test('isAllowedSquare', () => {
  assert.equal(isAllowedSquare('w', 'k', 'e1'), true);
  assert.equal(isAllowedSquare('w', 'p', 'e1'), false);
  assert.equal(isAllowedSquare('w', 'n', 'e3'), false);
  assert.equal(isAllowedSquare('b', 'p', 'e7'), true);
  assert.equal(isAllowedSquare('b', 'q', 'd1'), false);
  assert.equal(isAllowedSquare('w', 'q', 'z9'), false);
  // custom zones
  const zones = { w: { ranks: [1, 2, 3], pawnRanks: [2, 3] }, b: { ranks: [8], pawnRanks: [] } };
  assert.equal(isAllowedSquare('w', 'p', 'e3', zones), true);
  assert.equal(isAllowedSquare('b', 'p', 'e7', zones), false);
});

test('validateSide: a legal side passes', () => {
  const res = validateSide('w', [K('e1'), P('r', 'a1'), P('p', 'e2'), P('n', 'g2')]);
  assert.deepEqual(res, { ok: true, errors: [] });
});

test('validateSide: missing and extra king', () => {
  assert.deepEqual(codes(validateSide('w', [P('r', 'a1')])), ['no-king']);
  assert.deepEqual(codes(validateSide('w', [K('e1'), K('d1')])), ['extra-king']);
  assert.deepEqual(codes(validateSide('w', [])), ['no-king']);
});

test('validateSide: out-of-zone, pawn rank, duplicate, bad square, bad type', () => {
  assert.deepEqual(codes(validateSide('w', [K('e1'), P('q', 'd4')])), ['out-of-zone']);
  assert.deepEqual(codes(validateSide('w', [K('e1'), P('p', 'a1')])), ['pawn-rank']);
  assert.deepEqual(codes(validateSide('b', [K('e8'), P('p', 'a8')])), ['pawn-rank']);
  assert.deepEqual(codes(validateSide('w', [K('e1'), P('p', 'e5')])), ['out-of-zone']);
  assert.deepEqual(codes(validateSide('w', [K('e1'), P('n', 'b1'), P('b', 'b1')])), ['duplicate-square']);
  assert.deepEqual(codes(validateSide('w', [K('e1'), P('n', 'j1')])), ['bad-square']);
  assert.deepEqual(codes(validateSide('w', [K('e1'), P('x', 'b1')])), ['bad-type']);
  const err = validateSide('w', [K('e1'), P('p', 'a1')]).errors[0];
  assert.equal(err.square, 'a1');
  assert.equal(typeof err.message, 'string');
  assert.ok(err.message.length > 5);
});

test('validateMatch: Level 1 enemy vs a sensible white army is ok', () => {
  const white = [K('e1'), P('r', 'a1'), P('p', 'd2'), P('p', 'e2'), P('p', 'f2')];
  assert.deepEqual(validateMatch(white, LEVELS[0].enemy), { ok: true, errors: [] });
});

test('validateMatch: rook on an open file checks the white king', () => {
  // White Kd1 vs black Rd8, d-file empty → white king starts in check.
  const res = validateMatch([K('d1')], [K('g8'), P('r', 'd8')]);
  assert.equal(res.ok, false);
  assert.deepEqual(codes(res), ['white-king-attacked']);
  const err = res.errors[0];
  assert.equal(err.square, 'd1');
  assert.deepEqual(err.attackers, ['d8']);
  assert.match(err.message, /rook on d8/i);
  // A pawn on d2 blocks it.
  assert.equal(validateMatch([K('d1'), P('p', 'd2')], [K('g8'), P('r', 'd8')]).ok, true);
});

test('validateMatch: white rook on an open file checks the black king', () => {
  const res = validateMatch([K('a1'), P('r', 'e1')], [K('e8')]);
  assert.deepEqual(codes(res), ['black-king-attacked']);
  assert.deepEqual(res.errors[0].attackers, ['e1']);
  assert.equal(res.errors[0].square, 'e8');
});

test('validateMatch: both kings attacked, diagonal and queen attacks', () => {
  const res = validateMatch([K('a1'), P('r', 'h1')], [K('h8'), P('b', 'h7')]);
  // Rh1 hits h8? no — h7 bishop blocks. Bishop h7 hits b1..? h7-g6-...-b1, not a1.
  assert.equal(res.ok, true);
  const both = validateMatch([K('d1'), P('r', 'e1')], [K('e8'), P('q', 'd8')]);
  assert.deepEqual(codes(both), ['black-king-attacked', 'white-king-attacked']);
  const diag = validateMatch([K('a1')], [K('e8'), P('b', 'h8')]);
  assert.deepEqual(codes(diag), ['white-king-attacked']);
});

test('validateMatch: overlap, and side errors are included', () => {
  const res = validateMatch([K('e1'), P('r', 'a1')], [K('e8'), P('r', 'a1')]);
  assert.ok(codes(res).includes('overlap'));
  assert.ok(codes(res).includes('out-of-zone'));
  const noKing = validateMatch([P('r', 'a1')], [K('e8')]);
  assert.deepEqual(codes(noKing), ['no-king']);
  assert.equal(noKing.errors[0].side, 'w');
  const extra = validateMatch([K('e1')], [K('e8'), K('d8')]);
  assert.deepEqual(codes(extra), ['extra-king']);
  assert.equal(extra.errors[0].side, 'b');
  const pawnRank1 = validateMatch([K('e1'), P('p', 'a1')], [K('e8')]);
  assert.deepEqual(codes(pawnRank1), ['pawn-rank']);
  const dup = validateMatch([K('e1'), P('n', 'b1'), P('b', 'b1')], [K('e8')]);
  assert.deepEqual(codes(dup), ['duplicate-square']);
});

test('buildFen: castling "-" and standard counters; chess.js accepts it', () => {
  const fen = buildFen([K('e1'), P('p', 'e2'), P('r', 'a1')], LEVELS[0].enemy);
  assert.equal(fen, '3r2k1/4bppp/8/8/8/8/4P3/R3K3 w - - 0 1');
  assert.doesNotThrow(() => new Chess(fen));
  assert.match(buildFen([K('e1')], [K('e8')], 'b'), / b - - 0 1$/);
});

test('buildFen / placementsFromFen round-trip', () => {
  const white = [K('e1'), P('q', 'd1'), P('p', 'a2'), P('n', 'g2')];
  const black = LEVELS[0].enemy;
  const back = placementsFromFen(buildFen(white, black));
  const sortSq = (pl) => pl.slice().sort((a, b) => a.square.localeCompare(b.square));
  assert.deepEqual(sortSq(back.white), sortSq(white));
  assert.deepEqual(sortSq(back.black), sortSq(black));
  assert.equal(buildFen(back.white, back.black), buildFen(white, black));
});

test('pieceAt / removeAt / movePiece are immutable helpers', () => {
  const pl = [K('e1'), P('r', 'a1'), P('p', 'e2')];
  assert.deepEqual(pieceAt(pl, 'a1'), P('r', 'a1'));
  assert.equal(pieceAt(pl, 'h1'), null);

  const removed = removeAt(pl, 'a1');
  assert.equal(removed.length, 2);
  assert.equal(pl.length, 3);
  assert.deepEqual(removeAt(pl, 'h8'), pl);

  const moved = movePiece(pl, 'a1', 'b1');
  assert.deepEqual(pieceAt(moved, 'b1'), P('r', 'b1'));
  assert.equal(pieceAt(moved, 'a1'), null);
  assert.deepEqual(pieceAt(pl, 'a1'), P('r', 'a1'), 'original untouched');

  // Moving onto an own piece swaps the two.
  const swapped = movePiece(pl, 'a1', 'e1');
  assert.deepEqual(pieceAt(swapped, 'e1'), P('r', 'e1'));
  assert.deepEqual(pieceAt(swapped, 'a1'), K('a1'));
  assert.equal(swapped.length, 3);

  assert.throws(() => movePiece(pl, 'h1', 'h2'), /no piece/i);
  assert.deepEqual(movePiece(pl, 'a1', 'a1'), pl);
});
