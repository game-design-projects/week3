// Placement = where one side's pieces start: Array<{ type, square }> incl. the king.
// This module owns the placement rules (zones, one king, no starting checks)
// and conversion to/from FEN.

import { Chess } from '../../vendor/chess.js';
import { PIECE_NAMES, ZONES } from '../config.js';

const FILES = 'abcdefgh';
const TYPES = ['k', 'q', 'r', 'b', 'n', 'p'];
const SIDE_NAME = { w: 'White', b: 'Black' };

export function isSquare(square) {
  return typeof square === 'string' && /^[a-h][1-8]$/.test(square);
}

const rankOf = (square) => Number(square[1]);

/** All squares where `side` may put a piece of `type`, a1→h8 order by rank then file. */
export function allowedSquares(side, type, zones = ZONES) {
  const zone = zones[side];
  const ranks = type === 'p' ? zone.pawnRanks : zone.ranks;
  const out = [];
  for (const r of ranks.slice().sort((a, b) => a - b)) {
    for (const f of FILES) out.push(`${f}${r}`);
  }
  return out;
}

export function isAllowedSquare(side, type, square, zones = ZONES) {
  if (!isSquare(square)) return false;
  const zone = zones[side];
  return (type === 'p' ? zone.pawnRanks : zone.ranks).includes(rankOf(square));
}

function err(code, message, extra = {}) {
  return { code, message, ...extra };
}

/** Rules that only involve one side. */
export function validateSide(side, placement, zones = ZONES) {
  const errors = [];
  const seen = new Set();
  let kings = 0;
  for (const { type, square } of placement) {
    if (!TYPES.includes(type)) {
      errors.push(err('bad-type', `Unknown piece type "${type}".`, { square }));
      continue;
    }
    if (!isSquare(square)) {
      errors.push(err('bad-square', `"${square}" is not a board square.`, { square }));
      continue;
    }
    if (seen.has(square)) {
      errors.push(err('duplicate-square', `Two pieces are on ${square}.`, { square }));
      continue;
    }
    seen.add(square);
    if (type === 'k') kings += 1;
    if (!isAllowedSquare(side, type, square, zones)) {
      // A pawn inside the zone but on a non-pawn rank gets the more specific message.
      if (type === 'p' && zones[side].ranks.includes(rankOf(square))) {
        const allowed = zones[side].pawnRanks.join(' or ');
        errors.push(err('pawn-rank', `Pawns must start on rank ${allowed} (not ${square}).`, { square }));
      } else {
        errors.push(err('out-of-zone', `The ${PIECE_NAMES[type].toLowerCase()} on ${square} is outside your deployment zone.`, { square }));
      }
    }
  }
  if (kings === 0) errors.push(err('no-king', `${SIDE_NAME[side]} needs a king on the board.`));
  if (kings > 1) errors.push(err('extra-king', `${SIDE_NAME[side]} can only have one king.`));
  return { ok: errors.length === 0, errors };
}

/** Rules for both sides together: zones, overlaps, and no king may start attacked. */
export function validateMatch(white, black, zones = ZONES) {
  const errors = [
    ...validateSide('w', white, zones).errors.map((e) => ({ ...e, side: 'w' })),
    ...validateSide('b', black, zones).errors.map((e) => ({ ...e, side: 'b' })),
  ];
  const whiteSquares = new Set(white.map((p) => p.square));
  for (const { square } of black) {
    if (whiteSquares.has(square)) errors.push(err('overlap', `Both armies have a piece on ${square}.`, { square }));
  }
  // Attack checks only make sense on a well-formed board.
  if (errors.length === 0) {
    const chess = new Chess(buildFen(white, black), { skipValidation: true });
    for (const [side, placement, code] of [
      ['w', white, 'white-king-attacked'],
      ['b', black, 'black-king-attacked'],
    ]) {
      const king = placement.find((p) => p.type === 'k').square;
      const enemy = side === 'w' ? 'b' : 'w';
      const attackers = chess.attackers(king, enemy);
      if (attackers.length) {
        const described = attackers
          .map((sq) => `the ${PIECE_NAMES[chess.get(sq).type].toLowerCase()} on ${sq}`)
          .join(' and ');
        const whose = side === 'w' ? 'Your king' : 'The enemy king';
        errors.push(err(code, `${whose} would start in check (from ${described}).`, { square: king, side, attackers }));
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

/** FEN for a battle start: no castling, no en passant, move 1. */
export function buildFen(white, black, turn = 'w') {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
  const put = (list, color) => {
    for (const { type, square } of list) {
      const f = FILES.indexOf(square[0]);
      const r = 8 - rankOf(square);
      grid[r][f] = color === 'w' ? type.toUpperCase() : type;
    }
  };
  put(white, 'w');
  put(black, 'b');
  const rows = grid.map((row) => {
    let s = '';
    let empty = 0;
    for (const cell of row) {
      if (cell) {
        if (empty) s += empty;
        s += cell;
        empty = 0;
      } else empty += 1;
    }
    return s + (empty || '');
  });
  return `${rows.join('/')} ${turn} - - 0 1`;
}

export function placementsFromFen(fen) {
  const white = [];
  const black = [];
  const rows = fen.split(' ')[0].split('/');
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        f += Number(ch);
        continue;
      }
      const square = `${FILES[f]}${8 - i}`;
      const piece = { type: ch.toLowerCase(), square };
      (ch === ch.toUpperCase() ? white : black).push(piece);
      f += 1;
    }
  });
  return { white, black };
}

export function pieceAt(placement, square) {
  return placement.find((p) => p.square === square) ?? null;
}

export function removeAt(placement, square) {
  if (!pieceAt(placement, square)) return placement;
  return placement.filter((p) => p.square !== square);
}

/** Move a piece; moving onto another own piece swaps the two. */
export function movePiece(placement, from, to) {
  if (from === to) return placement;
  if (!pieceAt(placement, from)) throw new Error(`no piece on ${from}`);
  return placement.map((p) => {
    if (p.square === from) return { ...p, square: to };
    if (p.square === to) return { ...p, square: from };
    return p;
  });
}
