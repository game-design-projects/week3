import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettings, sanitize, SETTINGS_KEY } from '../src/settings.js';
import { DEFAULT_SETTINGS } from '../src/config.js';

function mem() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m };
}

test('settings: defaults, persist, reload, reset', () => {
  const storage = mem();
  const s = createSettings({ storage });
  assert.deepEqual(s.get(), DEFAULT_SETTINGS);
  s.set({ showHints: false, campaignAI: 'hard' });
  const again = createSettings({ storage });
  assert.equal(again.get().showHints, false);
  assert.equal(again.get().campaignAI, 'hard');
  again.reset();
  assert.deepEqual(createSettings({ storage }).get(), DEFAULT_SETTINGS);
});

test('settings: sanitize drops junk, wrong types and unknown presets; survives corrupt storage', () => {
  assert.deepEqual(sanitize({ sound: 'yes', campaignAI: 'godlike', evil: 1 }), DEFAULT_SETTINGS);
  const storage = mem();
  storage.setItem(SETTINGS_KEY, '{not json');
  assert.deepEqual(createSettings({ storage }).get(), DEFAULT_SETTINGS);
  const blocked = createSettings({ storage: null });
  assert.equal(blocked.set({ captureBounty: false }).captureBounty, false);
  assert.deepEqual(blocked.rules(), { captureBounty: false });
});

test('settings: telemetryConsent defaults to unset, is whitelisted, and persists', () => {
  assert.equal(DEFAULT_SETTINGS.telemetryConsent, 'unset');
  assert.deepEqual(sanitize({ telemetryConsent: 'yes-please' }), DEFAULT_SETTINGS);
  assert.deepEqual(sanitize({ telemetryConsent: 42 }), DEFAULT_SETTINGS);
  assert.equal(sanitize({ telemetryConsent: 'granted' }).telemetryConsent, 'granted');
  assert.equal(sanitize({ telemetryConsent: 'denied' }).telemetryConsent, 'denied');

  const storage = mem();
  const s = createSettings({ storage });
  assert.equal(s.get().telemetryConsent, 'unset');
  s.set({ telemetryConsent: 'granted' });
  assert.equal(createSettings({ storage }).get().telemetryConsent, 'granted');
});

test('settings: effects level is one of full/subtle/off (junk → default) and is not a rule', () => {
  assert.equal(DEFAULT_SETTINGS.effects, 'full');
  assert.equal(sanitize({ effects: 'subtle' }).effects, 'subtle');
  assert.equal(sanitize({ effects: 'off' }).effects, 'off');
  assert.equal(sanitize({ effects: 'maximum' }).effects, 'full');
  const s = createSettings({ storage: null });
  s.set({ effects: 'off' });
  assert.equal(s.get().effects, 'off');
  assert.deepEqual(s.rules(), { captureBounty: true }, 'feel is recorded separately, never passed to Match');
});

test('settings: onChange listeners fire', () => {
  const s = createSettings({ storage: null });
  let seen = null;
  s.onChange((v) => (seen = v.showCoords));
  s.set({ showCoords: false });
  assert.equal(seen, false);
});
