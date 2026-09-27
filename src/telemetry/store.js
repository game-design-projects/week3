// Playtest telemetry storage. Local-first: sessions live in localStorage as
//   { schema: 1, playerId, sessions: Session[] }
// and survive refreshes. When storage is unavailable (sandboxed itch.io
// iframe, Safari private mode, quota) the store keeps working in memory for
// the page lifetime — use Export so the data isn't lost.
// If TELEMETRY.endpoint is set AND the player has opted in (`canSend()`
// returns true — wired to settings.telemetryConsent === 'granted' in
// src/main.js), every saved session is also POSTed there. Nothing is ever
// sent before that consent is granted.

import { APP_VERSION, TELEMETRY } from '../config.js';
import { createLogger } from '../lib/log.js';

const log = createLogger('telemetry');

export const SCHEMA = 1;
export const BACKUP_SUFFIX = '.corrupt-backup';
const MODES = ['level', 'free'];
const RESULTS = ['win', 'loss', 'draw', 'abandoned', null];

/** Random url-safe id: `${prefix}_` + 16 hex chars. */
export function randomId(prefix) {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Minimal structural check; enough to reject junk on load/import. */
export function isValidSession(s) {
  return (
    !!s &&
    typeof s === 'object' &&
    !Array.isArray(s) &&
    s.schema === SCHEMA &&
    typeof s.id === 'string' &&
    s.id.length > 0 &&
    MODES.includes(s.mode) &&
    RESULTS.includes(s.result ?? null) &&
    typeof s.startedAt === 'string'
  );
}

export function isQuotaError(e) {
  if (!e) return false;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
}

/** Fire-and-forget POST: sendBeacon (survives page unload), fetch keepalive fallback. */
export async function defaultSend(url, body) {
  const nav = globalThis.navigator;
  if (nav?.sendBeacon) {
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
    if (nav.sendBeacon(url, blob)) return true;
  }
  await globalThis.fetch(url, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } });
  return true;
}

const byStart = (a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0);
const clone = (x) => JSON.parse(JSON.stringify(x));

function resolveStorage(opts) {
  if ('storage' in opts) return opts.storage ?? null;
  try {
    return globalThis.localStorage ?? null;
  } catch (e) {
    log.warn('localStorage is blocked — telemetry is memory-only for this tab', e?.name ?? e);
    return null;
  }
}

/**
 * @param {object} [opts]
 * @param {Storage|null} [opts.storage] defaults to globalThis.localStorage
 * @param {string} [opts.key]
 * @param {number} [opts.maxSessions]
 * @param {string|null} [opts.endpoint]
 * @param {(url: string, body: string) => any} [opts.send]
 * @param {() => boolean} [opts.canSend] consent gate: sendRemote is a no-op unless this returns true
 */
export function createStore(opts = {}) {
  const {
    key = TELEMETRY.storageKey,
    maxSessions = TELEMETRY.maxSessions,
    endpoint = TELEMETRY.endpoint,
    send = defaultSend,
    canSend = () => false,
  } = opts;
  let storage = resolveStorage(opts);
  let available = !!storage;
  let playerId = null;
  let sessions = [];

  const goMemoryOnly = (why) => {
    if (available) log.warn(`telemetry storage unavailable (${why}) — keeping data in memory only; use Export`);
    available = false;
    storage = null;
  };

  // ---- load
  if (storage) {
    let raw = null;
    try {
      raw = storage.getItem(key);
    } catch (e) {
      goMemoryOnly(e?.name ?? 'read failed');
    }
    if (raw !== null && raw !== undefined) {
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch {
        data = null;
      }
      const wellFormed =
        data && typeof data === 'object' && !Array.isArray(data) && data.schema === SCHEMA && Array.isArray(data.sessions);
      if (wellFormed) {
        if (typeof data.playerId === 'string' && data.playerId) playerId = data.playerId;
        const good = data.sessions.filter(isValidSession);
        if (good.length !== data.sessions.length) {
          log.warn(`dropped ${data.sessions.length - good.length} invalid stored session(s)`);
        }
        sessions = good.sort(byStart);
      } else {
        log.warn('stored telemetry is corrupt — starting fresh; old blob kept under', key + BACKUP_SUFFIX);
        try {
          storage?.setItem(key + BACKUP_SUFFIX, raw);
        } catch {
          /* best effort */
        }
      }
    }
  }
  if (!playerId) playerId = randomId('p');
  if (sessions.length > maxSessions) {
    log.info(`trimming ${sessions.length - maxSessions} oldest session(s) (cap ${maxSessions})`);
    sessions = sessions.slice(sessions.length - maxSessions);
  }

  const write = (list) => storage.setItem(key, JSON.stringify({ schema: SCHEMA, playerId, sessions: list }));

  /** Persist; on quota errors drop the oldest sessions (never the newest one). */
  const persist = () => {
    if (!storage) return;
    try {
      write(sessions);
      return;
    } catch (e) {
      if (!isQuotaError(e)) {
        goMemoryOnly(e?.name ?? 'write failed');
        return;
      }
    }
    for (let drop = 1; drop < sessions.length; drop++) {
      const kept = sessions.slice(drop);
      try {
        write(kept);
        log.warn(`storage full (quota) — dropped ${drop} oldest session(s)`);
        sessions = kept;
        return;
      } catch (e) {
        if (!isQuotaError(e)) {
          goMemoryOnly(e?.name ?? 'write failed');
          return;
        }
      }
    }
    goMemoryOnly('quota exceeded even for one session');
  };

  const trim = () => {
    if (sessions.length > maxSessions) sessions = sessions.slice(sessions.length - maxSessions);
  };

  persist(); // makes sure the playerId is written on first run

  const sendRemote = (session) => {
    if (!endpoint) return;
    if (!canSend()) {
      log.debug('telemetry upload skipped (no consent)', session.id);
      return;
    }
    const body = JSON.stringify(session);
    try {
      Promise.resolve(send(endpoint, body)).catch((e) => log.warn('telemetry upload failed:', e?.message ?? e));
    } catch (e) {
      log.warn('telemetry upload failed:', e?.message ?? e);
    }
  };

  return {
    get playerId() {
      return playerId;
    },
    get available() {
      return available;
    },
    sessions() {
      return clone(sessions);
    },
    /** Insert or replace (by id). Returns false for invalid sessions. */
    save(session) {
      if (!isValidSession(session)) {
        log.warn('refusing to save invalid session', session?.id ?? session);
        return false;
      }
      const copy = clone(session);
      const i = sessions.findIndex((s) => s.id === copy.id);
      if (i >= 0) sessions[i] = copy;
      else sessions.push(copy);
      sessions.sort(byStart);
      trim();
      persist();
      log.debug('session saved', copy.id, copy.result);
      sendRemote(copy);
      return true;
    },
    clear() {
      sessions = [];
      persist();
      log.info('telemetry cleared');
    },
    exportJSON() {
      return JSON.stringify(
        { schema: SCHEMA, playerId, exportedAt: new Date().toISOString(), appVersion: APP_VERSION, sessions },
        null,
        1,
      );
    },
    /** Merge sessions from an export file (or a bare array). Never re-sends to the endpoint. */
    importJSON(text) {
      const fail = (error) => ({ added: 0, skipped: 0, invalid: 0, error });
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return fail('Not a JSON file.');
      }
      let entries;
      if (Array.isArray(data)) entries = data;
      else if (data && typeof data === 'object' && data.schema === SCHEMA && Array.isArray(data.sessions)) entries = data.sessions;
      else if (data && typeof data === 'object' && 'schema' in data && data.schema !== SCHEMA) return fail(`Unsupported schema ${data.schema}.`);
      else return fail('No sessions found in this file.');

      const ids = new Set(sessions.map((s) => s.id));
      let added = 0;
      let skipped = 0;
      let invalid = 0;
      for (const s of entries) {
        if (!isValidSession(s)) invalid += 1;
        else if (ids.has(s.id)) skipped += 1;
        else {
          ids.add(s.id);
          sessions.push(clone(s));
          added += 1;
        }
      }
      sessions.sort(byStart);
      trim();
      persist();
      log.info(`import: ${added} added, ${skipped} duplicates, ${invalid} invalid`);
      return { added, skipped, invalid };
    },
  };
}
