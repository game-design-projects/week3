import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseMove } from '../src/ai/search.js';
import { createAIClient } from '../src/ai/client.js';
import { AI_PRESETS, LEVELS } from '../src/config.js';
import { Chess } from '../vendor/chess.js';
import { autoPlace } from '../src/core/autoplace.js';
import { buildFen } from '../src/core/placement.js';
import { createRng } from '../src/lib/rng.js';

const MATE_IN_ONE = [
  ['6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', 'a1a8'], // back rank
  ['7k/8/6K1/8/8/8/8/5Q2 w - - 0 1', 'f1f8'],
  ['k7/8/1K6/8/8/8/8/7R w - - 0 1', 'h1h8'],
  ['r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w - - 0 1', 'h5f7'], // scholar's mate
  ['3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', 'd8d1'], // black mates on the back rank
];

for (const [name, preset] of Object.entries(AI_PRESETS)) {
  test(`search(${name}): finds mate in one every time, whatever the seed`, () => {
    for (const [fen, uci] of MATE_IN_ONE) {
      for (const seed of [1, 2, 3]) {
        const r = chooseMove({ startFen: fen, preset, seed });
        const c = new Chess(fen);
        c.move({ from: r.from, to: r.to, promotion: r.promotion });
        assert.ok(c.isCheckmate(), `${name} ${fen}: played ${r.uci}, expected mate like ${uci}`);
      }
    }
  });
}

test('search(hard): finds a mate in two', () => {
  // 1. Qg7+?? no: Rook ladder — 1. Rb7 Kg8 2. Ra8#
  const fen = '7k/8/8/8/8/8/R7/1R4K1 w - - 0 1';
  const r = chooseMove({ startFen: fen, preset: AI_PRESETS.hard, seed: 1 });
  assert.equal(r.mate, 2, JSON.stringify(r));
});

test('search: takes a hanging queen and does not hang its own (normal)', () => {
  const take = chooseMove({ startFen: '4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1', preset: AI_PRESETS.normal, seed: 1 });
  assert.equal(take.uci, 'd2d5');
  // Black queen attacked by a pawn: must move it (or trade favourably), not ignore it.
  const fen = '4k3/8/8/3q4/4P3/8/8/4K3 b - - 0 1';
  for (const seed of [1, 2, 3, 4]) {
    const r = chooseMove({ startFen: fen, preset: AI_PRESETS.normal, seed });
    const c = new Chess(fen);
    c.move({ from: r.from, to: r.to });
    const qSafe = !c.moves({ verbose: true }).some((m) => m.captured === 'q');
    assert.ok(qSafe, `normal hung its queen with ${r.uci}`);
  }
});

test('search: always legal over random Level 1 games; throws on finished games', () => {
  const rng = createRng(42);
  for (let g = 0; g < 12; g++) {
    const white = autoPlace('w', { q: 0, r: 1, b: 1, n: 1, p: 1 }, { rng, opponent: LEVELS[0].enemy });
    const start = buildFen(white, LEVELS[0].enemy);
    const c = new Chess(start);
    const moves = [];
    for (let ply = 0; ply < 30 && !c.isGameOver(); ply++) {
      if (ply % 3 === 0) {
        const r = chooseMove({ startFen: start, moves, preset: AI_PRESETS.easy, seed: g * 100 + ply });
        const m = c.move({ from: r.from, to: r.to, promotion: r.promotion });
        moves.push(`${m.from}${m.to}${m.promotion ?? ''}`);
      } else {
        const legal = c.moves({ verbose: true });
        const m = c.move(legal[Math.floor(rng() * legal.length)]);
        moves.push(`${m.from}${m.to}${m.promotion ?? ''}`);
      }
    }
  }
  assert.throws(() => chooseMove({ startFen: '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1', moves: ['a1a8'], preset: AI_PRESETS.easy }), /finished/);
});

test('search: deterministic per seed; big window gives variety', () => {
  const fen = '3r2k1/4bppp/8/8/8/8/4P3/RNB1K3 w - - 0 1';
  const a = chooseMove({ startFen: fen, preset: AI_PRESETS.easy, seed: 9 });
  assert.equal(chooseMove({ startFen: fen, preset: AI_PRESETS.easy, seed: 9 }).uci, a.uci);
  const seen = new Set();
  for (let s = 1; s <= 20; s++) seen.add(chooseMove({ startFen: fen, preset: AI_PRESETS.easy, seed: s }).uci);
  assert.ok(seen.size >= 3);
});

function selfPlay(fen, preset, maxPlies) {
  const c = new Chess(fen);
  const moves = [];
  while (!c.isGameOver() && moves.length < maxPlies) {
    const r = chooseMove({ startFen: fen, moves, preset, seed: moves.length + 1 });
    const m = c.move({ from: r.from, to: r.to, promotion: r.promotion });
    moves.push(`${m.from}${m.to}${m.promotion ?? ''}`);
  }
  return c;
}

test('search: converts K+Q vs K and K+R vs K (mop-up) without stalemating', () => {
  for (const [fen, preset] of [
    ['8/8/8/4k3/8/8/8/3QK3 w - - 0 1', AI_PRESETS.normal],
    ['8/8/8/4k3/8/8/8/3QK3 w - - 0 1', AI_PRESETS.hard],
    ['8/8/3k4/8/8/8/8/R3K3 w - - 0 1', AI_PRESETS.hard],
  ]) {
    const c = selfPlay(fen, preset, 80);
    assert.ok(c.isCheckmate(), `${fen} not mated: ${c.fen()} (${c.history().length} plies)`);
  }
});

test('search: every preset stays within its time cap on a busy middlegame', () => {
  const fen = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R2QKB1R w - - 0 1';
  for (const preset of Object.values(AI_PRESETS)) {
    const r = chooseMove({ startFen: fen, preset, seed: 1 });
    assert.ok(r.ms <= preset.maxMs + 300, `${preset.label} took ${r.ms}ms`);
  }
});

test('client: inline fallback in Node (no Worker global)', async () => {
  const ai = createAIClient();
  assert.equal(ai.mode, 'inline');
  const r = await ai.chooseMove({ startFen: MATE_IN_ONE[0][0], preset: AI_PRESETS.normal, seed: 1 });
  assert.equal(r.uci, 'a1a8');
  ai.dispose();
});

test('shop: the AI drops a blocker when that is the only way out of check', () => {
  const fen = '4k3/8/8/8/8/8/3PPP2/r3KB2 w - - 0 1'; // Ra1+; only b1/c1/d1 drops block
  for (const preset of Object.values(AI_PRESETS)) {
    const r = chooseMove({ startFen: fen, preset, seed: 3, shop: { reserve: 3 } });
    assert.ok(r.drop, `${preset.label} should drop, got ${r.uci}`);
    assert.ok(['b1', 'c1', 'd1'].includes(r.drop.square));
  }
  assert.throws(() => chooseMove({ startFen: fen, preset: AI_PRESETS.easy }), /finished/);
});

test('shop: with gold and a quiet position the AI still plays sensibly and returns a legal action', () => {
  const fen = '3r2k1/4bppp/8/8/8/8/4P3/R3K3 b - - 0 1';
  const r = chooseMove({ startFen: fen, preset: AI_PRESETS.normal, seed: 2, shop: { reserve: 5 } });
  if (r.drop) {
    assert.ok(['r', 'b', 'n', 'p', 'q'].includes(r.drop.type));
    assert.ok(['7', '8'].includes(r.drop.square[1]));
  } else {
    assert.ok(r.from && r.to);
  }
  assert.ok(r.ms < AI_PRESETS.normal.maxMs + 800, `${r.ms}ms`);
});
