// The AI's move choice: negamax alpha-beta + quiescence, iterative deepening
// under a time cap, MVV-LVA move ordering, repetition/50-move = draw.
//
// Difficulty is NOT only depth: at the root every move within `windowCp` of
// the best is considered "good enough" and one is picked at random (seeded).
// That is what makes 'easy' human-beatable while never missing a mate.
//
// Shop: when the side to move has gold (req.shop.reserve), the root also
// considers buying a piece and dropping it into its zone. Drops are searched a
// little shallower, and each spent gold costs AI_GOLD_VALUE_CP — so the AI
// keeps its gold unless a drop is clearly worth it (blocking mate, defending,
// adding a piece where it matters).

import { AI_GOLD_VALUE_CP } from '../config.js';
import { Match } from '../core/game.js';
import { createLogger } from '../lib/log.js';
import { createRng } from '../lib/rng.js';
import { evaluate } from './evaluate.js';
import { FastChess, PIECE_VALUES, moveToUci, toAlgebraic } from './fastchess.js';

const log = createLogger('ai');

export const MATE = 100000;
const MATE_BOUND = MATE - 1000; // |score| above this = forced mate found
const INF = 10 * MATE;

class Timeout extends Error {}

/** Captures first (most valuable victim, least valuable attacker), then promotions. */
function orderMoves(moves) {
  const key = (m) =>
    (m.captured ? 10 * PIECE_VALUES[m.captured] - PIECE_VALUES[m.piece] + 10000 : 0) +
    (m.promotion ? PIECE_VALUES[m.promotion] + 5000 : 0);
  return moves.sort((a, b) => key(b) - key(a));
}

/**
 * @param {object} req
 * @param {string} req.startFen battle start position
 * @param {string[]} [req.moves] UCI history since the start
 * @param {{depth:number, quiescence:number, windowCp:number, maxMs:number}} req.preset
 * @param {number} [req.seed]
 * @param {{reserve:number, rules?:object}} [req.shop] gold the side to move may spend on a drop
 * @returns {{uci, from?, to?, promotion?, drop?: {type, square, cost}, score, depth, nodes, ms, mate: number|null}}
 */
export function chooseMove({ startFen, moves = [], preset, seed = 1, shop = null }) {
  const started = performance.now();
  const deadline = started + (preset.maxMs ?? 2000);
  const { fc, hashes } = FastChess.fromGame(startFen, moves);

  // Drop options (computed with the rules module so they match the UI exactly).
  let shopMatch = null;
  if (shop && shop.reserve > 0) {
    const side = fc.turn();
    shopMatch = new Match({
      startFen: fc.fen(),
      reserve: { w: side === 'w' ? shop.reserve : 0, b: side === 'b' ? shop.reserve : 0 },
      rules: { ...(shop.rules ?? {}), shop: true, bounty: null },
    });
  }
  const noMoves = fc.legalMoves().length === 0;
  const canDrop = shopMatch ? shopMatch.droppableTypes().length > 0 : false;
  const c = fc.chess;
  const over = noMoves
    ? !canDrop
    : c.isThreefoldRepetition() || c.isDrawByFiftyMoves() || (c.isInsufficientMaterial() && !canDrop);
  if (over) throw new Error('chooseMove called on a finished game');

  // Positions reachable only by repeating: the game history since the last irreversible move.
  let stack = hashes.slice(Math.max(0, hashes.length - 1 - fc.halfMoves()));
  let pos = fc; // position the recursive search works on (swapped when scoring drops)
  const rng = createRng(seed);
  let nodes = 0;

  const isRepetition = () => {
    const h = stack[stack.length - 1];
    for (let i = stack.length - 3; i >= 0; i -= 2) if (stack[i] === h) return true;
    return false;
  };

  const quiesce = (alpha, beta, qdepth) => {
    nodes += 1;
    const stand = evaluate(pos);
    if (stand >= beta) return stand;
    if (qdepth <= 0) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of orderMoves(pos.pseudoMoves().filter((x) => x.captured || x.promotion))) {
      if (!pos.makeIfLegal(m)) continue;
      const score = -quiesce(-beta, -alpha, qdepth - 1);
      pos.undo();
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  };

  const negamax = (depth, alpha, beta, ply) => {
    nodes += 1;
    if (completedDepth > 0 && (nodes & 1023) === 0 && performance.now() > deadline) throw new Timeout();
    if (ply > 0 && (isRepetition() || pos.halfMoves() >= 100)) return 0;
    if (depth <= 0) {
      // Leaves: a checked side with no legal reply is mated — quiescence alone can't see that.
      if (pos.inCheck() && pos.legalMoves().length === 0) return -(MATE - ply);
      return quiesce(alpha, beta, preset.quiescence ?? 0);
    }
    let best = -INF;
    let legal = 0;
    for (const m of orderMoves(pos.pseudoMoves())) {
      if (!pos.makeIfLegal(m)) continue;
      legal += 1;
      stack.push(pos.hash());
      let score;
      try {
        score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      } finally {
        stack.pop();
        pos.undo();
      }
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    if (legal === 0) return pos.inCheck() ? -(MATE - ply) : 0;
    return best;
  };

  const rootMoves = orderMoves(fc.legalMoves());
  let scored = rootMoves.map((m) => ({ move: m, score: 0 }));
  let completedDepth = 0;
  const window = preset.windowCp ?? 0;

  for (let depth = 1; depth <= preset.depth; depth++) {
    try {
      const results = [];
      let best = -INF;
      // Search the previous best first for better pruning.
      for (const { move } of scored) {
        // Moves that can't get within `window` of the best are only proven "worse".
        const alpha = best === -INF ? -INF : best - window - 1;
        fc.make(move);
        stack.push(fc.hash());
        let score;
        try {
          score = -negamax(depth - 1, -INF, -alpha, 1);
        } finally {
          stack.pop();
          fc.undo();
        }
        results.push({ move, score });
        if (score > best) best = score;
      }
      scored = results.sort((a, b) => b.score - a.score);
      completedDepth = depth;
      if (best >= MATE_BOUND) break; // found a forced mate — no need to look deeper
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      log.debug(`timeout at depth ${depth}, using depth ${completedDepth}`);
      break;
    }
  }

  // ---- shop: score drops (opponent to move after the drop), minus the gold spent
  if (canDrop) {
    const prices = shopMatch.rules.prices;
    // The two most valuable affordable types plus the pawn keep this cheap.
    const types = shopMatch.droppableTypes().sort((a, b) => prices[b] - prices[a]);
    const shortlist = [...new Set([...types.slice(0, 2), ...(types.includes('p') ? ['p'] : [])])];
    const dropDepth = Math.max(1, Math.min(2, preset.depth - 1));
    try {
      for (const type of shortlist) {
        for (const square of shopMatch.legalDropSquares(type)) {
          pos = new FastChess(shopMatch._fenAfterDrop(type, square));
          stack = [pos.hash()];
          const raw = -negamax(dropDepth, -INF, INF, 1);
          const cost = prices[type];
          const score = Math.abs(raw) >= MATE_BOUND ? raw : raw - cost * AI_GOLD_VALUE_CP;
          scored.push({ drop: { type, square, cost }, score });
        }
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      log.debug('timeout while scoring drops');
    }
    pos = fc;
    scored.sort((a, b) => b.score - a.score);
  }

  const best = scored[0].score;
  const mateInvolved = Math.abs(best) >= MATE_BOUND;
  const candidates = mateInvolved ? [scored[0]] : scored.filter((s) => s.score >= best - window);
  const choice = candidates[Math.floor(rng() * candidates.length)];
  const ms = Math.round(performance.now() - started);
  const mate = choice.score >= MATE_BOUND ? Math.ceil((MATE - choice.score) / 2) : choice.score <= -MATE_BOUND ? -Math.ceil((MATE + choice.score) / 2) : null;
  const m = choice.move;
  const result = {
    ...(choice.drop
      ? { uci: `${choice.drop.type.toUpperCase()}@${choice.drop.square}`, drop: choice.drop }
      : { uci: moveToUci(m), from: toAlgebraic(m.from), to: toAlgebraic(m.to), promotion: m.promotion }),
    score: choice.score,
    depth: completedDepth || 1,
    nodes,
    ms,
    mate,
    candidates: candidates.length,
  };
  log.debug('move', result);
  return result;
}
