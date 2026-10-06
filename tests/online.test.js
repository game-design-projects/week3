import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaderboardOnline, telemetryOnline } from '../src/online.js';
import { LEADERBOARD, TELEMETRY } from '../src/config.js';

test('telemetryOnline: only a non-empty endpoint string counts', () => {
  assert.equal(telemetryOnline({ endpoint: null }), false);
  assert.equal(telemetryOnline({ endpoint: '' }), false);
  assert.equal(telemetryOnline({}), false);
  assert.equal(telemetryOnline({ endpoint: 'https://collector.example/v1/sessions' }), true);
});

test('leaderboardOnline: only a non-empty endpoint string counts', () => {
  assert.equal(leaderboardOnline({ endpoint: null }), false);
  assert.equal(leaderboardOnline({ endpoint: '' }), false);
  assert.equal(leaderboardOnline({}), false);
  assert.equal(leaderboardOnline({ endpoint: 'https://collector.example/v1/scores' }), true);
});

// The chass-telemetry Worker was deleted on 2026-10-06. If the collector
// ever comes back, set COLLECTOR in src/config.js and update this test.
test('shipped config: no collector, so telemetry and the leaderboard are off', () => {
  assert.equal(TELEMETRY.endpoint, null);
  assert.equal(LEADERBOARD.endpoint, null);
  assert.equal(telemetryOnline(), false);
  assert.equal(leaderboardOnline(), false);
});
