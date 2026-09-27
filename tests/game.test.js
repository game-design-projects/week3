import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/core/game.js';

test('Match: move by object and by uci; history, historyUci, plies', () => {
  const m = new Match({ startFen: '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1' });
  const r = m.move({ from: 'e2', to: 'e4' });
  assert.equal(r.san, 'e4');
  m.move('e8d7');
  assert.deepEqual(m.history(), ['e4', 'Kd7']);
  assert.deepEqual(m.historyUci(), ['e2e4', 'e8d7']);
  assert.equal(m.plies(), 2);
  assert.deepEqual(m.lastMove(), { from: 'e8', to: 'd7' });
  assert.throws(() => m.move('e4e6'), /illegal/);
});

test('Match: promotion listed once per target; needsPromotion; move with promotion', () => {
  const m = new Match({ startFen: '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1' });
  const moves = m.legalMovesFrom('b7');
  assert.deepEqual(moves.map((x) => x.to), ['b8']);
  assert.equal(moves[0].promotion, true);
  assert.equal(m.needsPromotion('b7', 'b8'), true);
  const r = m.move({ from: 'b7', to: 'b8', promotion: 'n' });
  assert.equal(r.promotion, 'n');
  assert.equal(m.material().w, 3);
});

test('Match: en passant capture is tracked in captured()', () => {
  const m = new Match({ startFen: '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1' });
  m.move('d7d5');
  const r = m.move('e5d6');
  assert.equal(r.captured, 'p');
  assert.deepEqual(m.captured(), { w: ['p'], b: [] });
});

test('Match: checkmate winner, stalemate, insufficient material', () => {
  const mate = new Match({ startFen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1' });
  const r = mate.move('a1a8');
  assert.equal(r.mate, true);
  assert.deepEqual(
    { over: mate.status().over, winner: mate.status().winner, reason: mate.status().reason },
    { over: true, winner: 'w', reason: 'checkmate' },
  );
  assert.deepEqual(mate.legalMovesFrom('g8'), []);
  assert.throws(() => mate.move('g8h8'), /over/);

  const st = new Match({ startFen: 'k7/8/2Q5/8/8/8/8/K7 w - - 0 1' });
  st.move('c6b6');
  assert.deepEqual([st.status().reason, st.status().winner], ['stalemate', null]);

  const ins = new Match({ startFen: '4k3/8/8/8/8/8/3q4/4K3 w - - 0 1' });
  ins.move('e1d2');
  assert.equal(ins.status().reason, 'insufficient');
});

test('Match: threefold repetition and fifty-move', () => {
  const m = new Match({ startFen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1' });
  for (let i = 0; i < 2; i++) for (const u of ['a1a2', 'e8d8', 'a2a1', 'd8e8']) m.move(u);
  assert.equal(m.status().reason, 'threefold');
  const f = new Match({ startFen: '4k3/8/8/8/8/8/8/R3K3 w - - 99 80' });
  f.move('a1a2');
  assert.equal(f.status().reason, 'fifty-move');
});

test('Match: resign, material, kingSquare', () => {
  const m = new Match({ startFen: '3r2k1/4bppp/8/8/8/8/4P3/R3K3 w - - 0 1' });
  assert.deepEqual(m.material(), { w: 6, b: 11, diff: -5 });
  assert.equal(m.kingSquare('b'), 'g8');
  m.resign('w');
  assert.deepEqual([m.status().over, m.status().winner, m.status().reason], [true, 'b', 'resign']);
});
