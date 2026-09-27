import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/core/game.js';
import { chooseMove } from '../src/ai/search.js';
import { AI_PRESETS } from '../src/config.js';

const KEEP = '3r2k1/4bppp/8/8/8/8/4P3/4K3 w - - 0 1';

test('drop: costs gold, uses the turn, lands in the zone, recorded in history', () => {
  const m = new Match({ startFen: KEEP, reserve: { w: 11, b: 0 } });
  assert.deepEqual(m.droppableTypes(), ['q', 'r', 'b', 'n', 'p']);
  const r = m.drop('n', 'b1');
  assert.equal(r.san, 'N@b1');
  assert.equal(r.cost, 3);
  assert.equal(m.reserve.w, 8);
  assert.equal(m.turn(), 'b');
  assert.equal(m.chess.get('b1').type, 'n');
  assert.deepEqual(m.historyUci(), ['N@b1']);
  assert.deepEqual(m.aiRequest(), { startFen: m.fen(), moves: [] });
  assert.deepEqual(m.lastMove(), { from: null, to: 'b1' });
  assert.deepEqual(m.drops(), [{ ply: 1, color: 'w', type: 'n', square: 'b1', cost: 3 }]);
  // Black moves after the drop; the AI request replays from the post-drop position.
  m.move('d8d1');
  assert.deepEqual(m.aiRequest().moves, ['d8d1']);
  assert.match(m.pgn(), /1\. N@b1 Rd1\+/);
});

test('drop rules: budget, caps, zone, pawn rank, occupied, turn', () => {
  const m = new Match({ startFen: KEEP, reserve: { w: 4, b: 0 } });
  assert.equal(m.dropProblem('r', 'a1'), 'budget');
  assert.equal(m.dropProblem('n', 'd4'), 'out-of-zone');
  assert.equal(m.dropProblem('p', 'a1'), 'out-of-zone');
  assert.equal(m.dropProblem('n', 'e2'), 'occupied');
  assert.equal(m.dropProblem('n', 'a1', 'b'), 'not-your-turn');
  assert.equal(m.dropProblem('n', 'a1'), null);
  const full = new Match({ startFen: '4k3/8/8/8/8/8/PPPPPPPP/4K3 w - - 0 1', reserve: { w: 5, b: 0 } });
  assert.equal(full.dropProblem('p', 'a2'), 'cap'); // 8 pawns: the cap bites before the square check
  const capped = new Match({ startFen: '4k3/8/8/8/8/8/8/Q3K3 w - - 0 1', reserve: { w: 20, b: 0 } });
  assert.equal(capped.dropProblem('q', 'd1'), 'cap');
  assert.throws(() => capped.drop('q', 'd1'), /cap/);
  const none = new Match({ startFen: KEEP });
  assert.deepEqual(none.droppableTypes(), []);
});

test('drop must resolve a check; an interposing drop saves a "mated" king', () => {
  // Ra1+ against Ke1 walled in by its own pawns and bishop: only a drop on b1/c1/d1 blocks.
  const smothered = '4k3/8/8/8/8/8/3PPP2/r3KB2 w - - 0 1';
  const plain = new Match({ startFen: smothered });
  assert.equal(plain.status().reason, 'checkmate');
  const saved = new Match({ startFen: smothered, reserve: { w: 3, b: 0 } });
  assert.equal(saved.status().over, false, 'a knight drop can block, so it is not mate');
  assert.equal(saved.dropProblem('n', 'a2'), 'king-in-check');
  assert.equal(saved.dropProblem('n', 'd1'), null);
  saved.drop('n', 'd1');
  assert.equal(saved.status().over, false);
  assert.equal(saved.reserve.w, 0);
});

test('reserve prevents a stalemate and an insufficient-material draw', () => {
  const stale = '7k/8/8/8/8/8/5q2/7K w - - 0 1'; // white king h1: g1/g2/h2 covered → stalemate without reserve
  assert.equal(new Match({ startFen: stale }).status().reason, 'stalemate');
  const m = new Match({ startFen: stale, reserve: { w: 1, b: 0 } });
  assert.equal(m.status().over, false);
  assert.deepEqual(m.droppableTypes(), ['p']);
  const bare = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';
  assert.equal(new Match({ startFen: bare }).status().reason, 'insufficient');
  assert.equal(new Match({ startFen: bare, reserve: { w: 5, b: 0 } }).status().over, false);
});

test('a drop that gives check is marked with "+"', () => {
  // Black king on a5; a white rook dropped on a1 checks it up the open a-file.
  const m = new Match({ startFen: '8/8/8/k7/8/8/8/4K3 w - - 0 1', reserve: { w: 5, b: 0 } });
  const r = m.drop('r', 'a1');
  assert.equal(r.check, true);
  assert.equal(r.san, 'R@a1+');
  assert.equal(m.status().inCheck, true);
});

test('AI keeps working after a drop (search uses the post-drop segment)', () => {
  const m = new Match({ startFen: KEEP, reserve: { w: 5, b: 0 } });
  m.drop('r', 'a1');
  const req = m.aiRequest();
  const r = chooseMove({ ...req, preset: AI_PRESETS.normal, seed: 1 });
  m.move({ from: r.from, to: r.to, promotion: r.promotion });
  assert.equal(m.plies(), 2);
});
