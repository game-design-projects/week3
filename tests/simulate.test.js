import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSim, simulateGame } from '../tools/simulate.mjs';
import { freeStart } from '../src/core/start.js';
import { AI_PRESETS } from '../src/config.js';

test('simulateGame: two lone kings with gold — both sides buy, game ends by rule or cap', () => {
  const r = simulateGame({ ...freeStart(12), whitePreset: AI_PRESETS.easy, blackPreset: AI_PRESETS.easy, maxPlies: 24 });
  assert.ok(r.drops.some((d) => d.color === 'w'), 'white bought something');
  assert.ok(r.drops.some((d) => d.color === 'b'), 'black bought something');
  assert.ok(r.plies <= 24);
});

test('runSim: one row per gold with consistent counts', () => {
  const rows = runSim({ golds: [12], games: 1, preset: 'easy', playerPreset: 'easy', maxPlies: 16 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].wins + rows[0].draws + rows[0].losses, 1);
});
