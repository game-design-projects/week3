// Player settings, persisted per browser (localStorage, guarded).
// Rule settings (captureBounty) change the game and are recorded
// with every telemetry session so data from different rules can be separated.

import { AI_PRESETS, DEFAULT_SETTINGS } from './config.js';
import { createLogger } from './lib/log.js';

const log = createLogger('settings');
export const SETTINGS_KEY = 'cbs.settings.v1';
const TELEMETRY_CONSENT_VALUES = ['unset', 'granted', 'denied'];

/** Merge stored values over defaults, dropping unknown keys / wrong types. */
export function sanitize(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof raw[k] === typeof def) out[k] = raw[k];
  }
  if (!(out.campaignAI in AI_PRESETS)) out.campaignAI = DEFAULT_SETTINGS.campaignAI;
  if (!TELEMETRY_CONSENT_VALUES.includes(out.telemetryConsent)) out.telemetryConsent = DEFAULT_SETTINGS.telemetryConsent;
  return out;
}

export function createSettings({ storage } = {}) {
  let store = storage;
  if (store === undefined) {
    try {
      store = globalThis.localStorage ?? null;
    } catch {
      store = null;
    }
  }
  let values = { ...DEFAULT_SETTINGS };
  try {
    const raw = store?.getItem(SETTINGS_KEY);
    if (raw) values = sanitize(JSON.parse(raw));
  } catch (e) {
    log.warn('could not read settings, using defaults', e?.message ?? e);
  }
  const listeners = new Set();
  return {
    get() {
      return { ...values };
    },
    set(patch) {
      values = sanitize({ ...values, ...patch });
      try {
        store?.setItem(SETTINGS_KEY, JSON.stringify(values));
      } catch (e) {
        log.warn('could not save settings', e?.message ?? e);
      }
      log.info('settings', patch);
      for (const fn of listeners) fn(values);
      return { ...values };
    },
    reset() {
      return this.set({ ...DEFAULT_SETTINGS });
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** The rule subset recorded in telemetry and passed to Match. */
    rules() {
      return { captureBounty: values.captureBounty };
    },
  };
}
