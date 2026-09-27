import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSim, simulateGame } from '../tools/simulate.mjs';
import { AI_PRESETS } from '../src/config.js';

test('simulateGame ends by rule or by the ply cap', () => {
  const white = { army: {}, placement: [{ type: 'k', square: 'e1' }, { type: 'q', square: 'd1' }] };
  const black = { army: {}, placement: [{ type: 'k', square: 'e8' }] };
  const r = simulateGame({ white, black, whitePreset: AI_PRESETS.normal, blackPreset: AI_PRESETS.easy, maxPlies: 80 });
  assert.equal(r.winner, 'w');
  assert.equal(r.reason, 'checkmate');
});

test('runSim returns one row per army with consistent counts', () => {
  const rows = runSim({ armies: [{ q: 1, r: 0, b: 0, n: 0, p: 3 }], games: 1, preset: 'easy', playerPreset: 'easy', maxPlies: 20 });
  assert.equal(rows.length, 1);
  const [r] = rows;
  assert.equal(r.label, 'Q+3P');
  assert.equal(r.wins + r.draws + r.losses, 1);
});
