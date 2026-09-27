import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TELEMETRY } from '../src/config.js';
import { setLogLevel } from '../src/lib/log.js';
import {
  BACKUP_SUFFIX,
  createStore,
  defaultSend,
  isQuotaError,
  isValidSession,
  randomId,
} from '../src/telemetry/store.js';

// Warnings are asserted through a console mock below; make sure they are emitted.
setLogLevel('warn');

const KEY = 'test.telemetry';

/** In-memory stand-in for window.localStorage. `limit` = max total chars (key + value) before QuotaExceededError. */
function memoryStorage({ limit = Infinity } = {}) {
  const map = new Map();
  const size = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) {
      const value = String(v);
      const next = size() - (map.has(k) ? k.length + map.get(k).length : 0) + k.length + value.length;
      if (next > limit) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      map.set(k, value);
    },
    removeItem: (k) => map.delete(k),
  };
}

/** Silence + record console.warn / console.error for one test. */
function captureConsole(t) {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const text = () =>
    [...warn.mock.calls, ...error.mock.calls].map((c) => c.arguments.map(String).join(' ')).join('\n');
  return { warn, error, text };
}

let seq = 0;
function session(overrides = {}) {
  seq += 1;
  return {
    schema: 1,
    id: `s_${seq}`,
    playerId: 'p_test',
    mode: 'level',
    levelId: 'L1',
    opponent: 'ai',
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString(),
    result: 'win',
    pgn: '1. e4 e5 *',
    ...overrides,
  };
}

test('randomId: prefixed, unique-ish, url-safe', () => {
  const ids = new Set(Array.from({ length: 200 }, () => randomId('s')));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^s_[0-9a-f]{16}$/);
});

test('isValidSession accepts a minimal session and rejects junk', () => {
  assert.equal(isValidSession(session()), true);
  assert.equal(isValidSession(null), false);
  assert.equal(isValidSession('x'), false);
  assert.equal(isValidSession(session({ schema: 2 })), false);
  assert.equal(isValidSession(session({ id: '' })), false);
  assert.equal(isValidSession(session({ mode: 'arcade' })), false);
  assert.equal(isValidSession(session({ result: 'maybe' })), false);
  assert.equal(isValidSession(session({ startedAt: 5 })), false);
});

test('isQuotaError recognises the browser variants', () => {
  assert.equal(isQuotaError(new DOMException('x', 'QuotaExceededError')), true);
  assert.equal(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' }), true);
  assert.equal(isQuotaError({ code: 22 }), true);
  assert.equal(isQuotaError(new DOMException('x', 'SecurityError')), false);
  assert.equal(isQuotaError(null), false);
});

test('fresh store: creates and persists an anonymous playerId', () => {
  const storage = memoryStorage();
  const store = createStore({ storage, key: KEY });
  assert.equal(store.available, true);
  assert.match(store.playerId, /^p_[0-9a-f]{16}$/);
  assert.deepEqual(store.sessions(), []);
  const saved = JSON.parse(storage.getItem(KEY));
  assert.deepEqual(saved, { schema: 1, playerId: store.playerId, sessions: [] });
  // Same browser → same player.
  assert.equal(createStore({ storage, key: KEY }).playerId, store.playerId);
});

test('save → persisted, reloaded by a new store, returned as copies', () => {
  const storage = memoryStorage();
  const store = createStore({ storage, key: KEY });
  const s = session();
  assert.equal(store.save(s), true);
  s.result = 'loss'; // mutating the caller's object must not change the stored one
  const again = createStore({ storage, key: KEY });
  assert.equal(again.sessions().length, 1);
  assert.equal(again.sessions()[0].result, 'win');
  // sessions() returns a new array each time
  again.sessions().pop();
  assert.equal(again.sessions().length, 1);
});

test('save with an existing id replaces it (upsert)', () => {
  const store = createStore({ storage: memoryStorage(), key: KEY });
  const s = session();
  store.save(s);
  store.save({ ...s, result: 'draw' });
  assert.equal(store.sessions().length, 1);
  assert.equal(store.sessions()[0].result, 'draw');
});

test('save rejects invalid sessions without throwing', (t) => {
  const logs = captureConsole(t);
  const store = createStore({ storage: memoryStorage(), key: KEY });
  assert.equal(store.save({ nope: true }), false);
  assert.equal(store.save(null), false);
  assert.equal(store.sessions().length, 0);
  assert.match(logs.text(), /invalid session/i);
});

test('(a) localStorage getter throws (sandboxed iframe / private mode) → memory-only, nothing throws', (t) => {
  const logs = captureConsole(t);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  try {
    const store = createStore({ key: KEY }); // default storage = globalThis.localStorage
    assert.equal(store.available, false);
    assert.match(store.playerId, /^p_/);
    assert.equal(store.save(session()), true);
    assert.equal(store.sessions().length, 1);
    const result = store.importJSON(JSON.stringify([session()]));
    assert.equal(result.added, 1);
    assert.equal(store.sessions().length, 2);
    store.clear();
    assert.deepEqual(store.sessions(), []);
    assert.match(logs.text(), /memory/i);
  } finally {
    delete globalThis.localStorage;
  }
});

test('(a) storage methods that throw SecurityError → memory-only, nothing throws', (t) => {
  captureConsole(t);
  const denied = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  const store = createStore({ storage: { getItem: denied, setItem: denied, removeItem: denied }, key: KEY });
  assert.equal(store.available, false);
  assert.equal(store.save(session()), true);
  assert.equal(store.sessions().length, 1);
});

test('(a) explicit storage: null → memory-only store', () => {
  const store = createStore({ storage: null, key: KEY });
  assert.equal(store.available, false);
  store.save(session());
  assert.equal(store.sessions().length, 1);
});

test('(a) setItem failing for a non-quota reason → switches to memory-only, keeps sessions', (t) => {
  const logs = captureConsole(t);
  const storage = memoryStorage();
  const store = createStore({ storage, key: KEY });
  storage.setItem = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  assert.equal(store.save(session()), true);
  assert.equal(store.available, false);
  assert.equal(store.sessions().length, 1);
  assert.match(logs.text(), /memory/i);
});

test('(b) QuotaExceededError → drops oldest sessions, retries, logs', (t) => {
  const logs = captureConsole(t);
  const storage = memoryStorage({ limit: 4000 });
  const store = createStore({ storage, key: KEY });
  const pad = 'x'.repeat(300);
  const all = [];
  for (let i = 0; i < 30; i++) {
    const s = session({ pgn: pad });
    all.push(s.id);
    assert.equal(store.save(s), true);
  }
  const kept = store.sessions().map((s) => s.id);
  assert.ok(kept.length < 30, 'some sessions were dropped');
  assert.ok(kept.length > 1, 'but not all of them');
  // What survived is exactly the newest tail, in order, and matches what is on disk.
  assert.deepEqual(kept, all.slice(all.length - kept.length));
  assert.deepEqual(
    JSON.parse(storage.getItem(KEY)).sessions.map((s) => s.id),
    kept,
  );
  assert.equal(store.available, true);
  assert.match(logs.text(), /quota|full/i);
});

test('(b) a single session bigger than the quota → memory-only, session kept in memory', (t) => {
  captureConsole(t);
  const storage = memoryStorage({ limit: 500 });
  const store = createStore({ storage, key: KEY });
  assert.equal(store.save(session({ pgn: 'y'.repeat(2000) })), true);
  assert.equal(store.available, false);
  assert.equal(store.sessions().length, 1);
});

test('(c) corrupted JSON → fresh start, corrupted blob kept under the backup key', (t) => {
  const logs = captureConsole(t);
  const storage = memoryStorage();
  storage.setItem(KEY, '{"schema":1,"sessions":[{broken');
  const store = createStore({ storage, key: KEY });
  assert.equal(store.available, true);
  assert.deepEqual(store.sessions(), []);
  assert.equal(storage.getItem(KEY + BACKUP_SUFFIX), '{"schema":1,"sessions":[{broken');
  assert.equal(JSON.parse(storage.getItem(KEY)).playerId, store.playerId);
  assert.match(logs.text(), /corrupt/i);
});

test('(c) wrong shape / unknown schema is treated as corrupt too', (t) => {
  captureConsole(t);
  for (const blob of ['[]', '42', '{"schema":2,"playerId":"p","sessions":[]}', '{"schema":1,"sessions":{}}']) {
    const storage = memoryStorage();
    storage.setItem(KEY, blob);
    const store = createStore({ storage, key: KEY });
    assert.deepEqual(store.sessions(), [], blob);
    assert.equal(storage.getItem(KEY + BACKUP_SUFFIX), blob);
  }
});

test('(c) valid file with a few bad entries keeps the good ones and the playerId', (t) => {
  captureConsole(t);
  const storage = memoryStorage();
  const good = session();
  storage.setItem(KEY, JSON.stringify({ schema: 1, playerId: 'p_keep', sessions: [good, { junk: 1 }, 7] }));
  const store = createStore({ storage, key: KEY });
  assert.equal(store.playerId, 'p_keep');
  assert.deepEqual(store.sessions().map((s) => s.id), [good.id]);
});

test('(d) maxSessions caps the list, dropping the oldest', (t) => {
  captureConsole(t);
  const storage = memoryStorage();
  const store = createStore({ storage, key: KEY, maxSessions: 3 });
  const ids = [];
  for (let i = 0; i < 5; i++) {
    const s = session();
    ids.push(s.id);
    store.save(s);
  }
  assert.deepEqual(store.sessions().map((s) => s.id), ids.slice(2));
  assert.equal(JSON.parse(storage.getItem(KEY)).sessions.length, 3);
});

test('(d) default cap comes from TELEMETRY.maxSessions', () => {
  // Loading more than the cap from storage trims on load.
  const storage = memoryStorage();
  const many = Array.from({ length: TELEMETRY.maxSessions + 5 }, () => session());
  storage.setItem(KEY, JSON.stringify({ schema: 1, playerId: 'p_x', sessions: many }));
  const store = createStore({ storage, key: KEY });
  assert.equal(store.sessions().length, TELEMETRY.maxSessions);
  assert.equal(store.sessions()[0].id, many[5].id);
});

test('(e) endpoint set → send(url, json) once per saved session; failures swallowed + logged', async (t) => {
  const logs = captureConsole(t);
  const calls = [];
  let mode = 'ok';
  const send = (url, body) => {
    calls.push({ url, body });
    if (mode === 'throw') throw new Error('network down');
    if (mode === 'reject') return Promise.reject(new Error('offline'));
    return true;
  };
  const store = createStore({ storage: memoryStorage(), key: KEY, endpoint: 'https://collect.example/cbs', send, canSend: () => true });
  const a = session();
  store.save(a);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://collect.example/cbs');
  assert.deepEqual(JSON.parse(calls[0].body), a);

  mode = 'throw';
  assert.equal(store.save(session()), true);
  mode = 'reject';
  assert.equal(store.save(session()), true);
  await new Promise((r) => setTimeout(r, 0)); // let the rejection be handled
  assert.equal(calls.length, 3);
  assert.equal(store.sessions().length, 3);
  assert.match(logs.text(), /network down/);
  assert.match(logs.text(), /offline/);

  // Imports never re-send other people's sessions.
  store.importJSON(JSON.stringify([session()]));
  assert.equal(calls.length, 3);
});

test('(e) endpoint null → send never called', () => {
  let called = 0;
  const store = createStore({ storage: memoryStorage(), key: KEY, endpoint: null, send: () => called++ });
  store.save(session());
  store.save(session());
  assert.equal(called, 0);
});

test('(e) canSend defaults to false: endpoint set but no consent → send never called', () => {
  let called = 0;
  const store = createStore({ storage: memoryStorage(), key: KEY, endpoint: 'https://collect.example/cbs', send: () => called++ });
  store.save(session());
  assert.equal(called, 0);
});

test('(e) canSend() false → send skipped even with an endpoint; sessions still saved locally', (t) => {
  const logs = captureConsole(t);
  let called = 0;
  const store = createStore({ storage: memoryStorage(), key: KEY, endpoint: 'https://collect.example/cbs', send: () => called++, canSend: () => false });
  const s = session();
  assert.equal(store.save(s), true);
  assert.equal(called, 0);
  assert.deepEqual(store.sessions().map((x) => x.id), [s.id]);
});

test('(e) canSend() is read fresh on every save — consent granted mid-session takes effect immediately', () => {
  let granted = false;
  const calls = [];
  const store = createStore({
    storage: memoryStorage(),
    key: KEY,
    endpoint: 'https://collect.example/cbs',
    send: (url, body) => calls.push(JSON.parse(body).id),
    canSend: () => granted,
  });
  const a = session();
  store.save(a);
  assert.deepEqual(calls, []);
  granted = true;
  const b = session();
  store.save(b);
  assert.deepEqual(calls, [b.id]);
});

test('defaultSend: sendBeacon with a text/plain Blob, fetch keepalive fallback', async (t) => {
  captureConsole(t);
  const beacons = [];
  const fetches = [];
  const hadNavigator = 'navigator' in globalThis;
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { sendBeacon: (url, blob) => (beacons.push({ url, blob }), true) },
    });
    globalThis.fetch = (url, init) => (fetches.push({ url, init }), Promise.resolve({ ok: true }));
    await defaultSend('https://c.example/x', '{"a":1}');
    assert.equal(beacons.length, 1);
    assert.equal(await beacons[0].blob.text(), '{"a":1}');
    assert.match(beacons[0].blob.type, /^text\/plain/);
    assert.equal(fetches.length, 0);

    // Beacon refused (payload too big / not queued) → fetch keepalive.
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon: () => false } });
    await defaultSend('https://c.example/x', '{"a":2}');
    assert.equal(fetches.length, 1);
    assert.equal(fetches[0].init.keepalive, true);
    assert.equal(fetches[0].init.method, 'POST');
    assert.equal(fetches[0].init.body, '{"a":2}');
  } finally {
    if (hadNavigator) Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
    else delete globalThis.navigator;
    globalThis.fetch = originalFetch;
  }
});

test('(f) importJSON: full export object, dedupe by id, invalid entries counted', (t) => {
  captureConsole(t);
  const source = createStore({ storage: memoryStorage(), key: KEY });
  const a = session();
  const b = session();
  source.save(a);
  source.save(b);
  const exported = source.exportJSON();

  const target = createStore({ storage: memoryStorage(), key: KEY });
  target.save(a); // already present → skipped
  const obj = JSON.parse(exported);
  obj.sessions.push({ id: 'bad' }, session({ schema: 3 }), b); // 2 invalid, 1 duplicate within the file
  const result = target.importJSON(JSON.stringify(obj));
  assert.deepEqual(result, { added: 1, skipped: 2, invalid: 2 });
  assert.deepEqual(target.sessions().map((s) => s.id).sort(), [a.id, b.id].sort());
});

test('(f) importJSON: bare Session[] accepted; result sorted by startedAt', () => {
  const store = createStore({ storage: memoryStorage(), key: KEY });
  const late = session({ startedAt: '2026-05-01T00:00:00.000Z' });
  const early = session({ startedAt: '2026-01-01T00:00:00.000Z' });
  store.save(late);
  const result = store.importJSON(JSON.stringify([early]));
  assert.deepEqual(result, { added: 1, skipped: 0, invalid: 0 });
  assert.deepEqual(store.sessions().map((s) => s.id), [early.id, late.id]);
});

test('(f) importJSON: schema !== 1, garbage, or wrong shapes are rejected with an error message', () => {
  const store = createStore({ storage: memoryStorage(), key: KEY });
  for (const text of [
    JSON.stringify({ schema: 2, sessions: [session()] }),
    'not json at all',
    '42',
    JSON.stringify({ schema: 1 }),
    '',
  ]) {
    const result = store.importJSON(text);
    assert.equal(result.added, 0, text);
    assert.equal(typeof result.error, 'string', text);
    assert.ok(result.error.length > 0);
  }
  assert.equal(store.sessions().length, 0);
});

test('(g) exportJSON round-trips through importJSON into an empty store', () => {
  const store = createStore({ storage: memoryStorage(), key: KEY });
  const sessions = [session(), session({ result: 'abandoned', mode: 'free', levelId: null }), session()];
  for (const s of sessions) store.save(s);
  const text = store.exportJSON();
  const parsed = JSON.parse(text);
  assert.equal(parsed.schema, 1);
  assert.equal(parsed.playerId, store.playerId);
  assert.equal(typeof parsed.exportedAt, 'string');
  assert.equal(typeof parsed.appVersion, 'string');

  const other = createStore({ storage: memoryStorage(), key: KEY });
  assert.deepEqual(other.importJSON(text), { added: 3, skipped: 0, invalid: 0 });
  assert.deepEqual(other.sessions(), store.sessions());
  // Importing the same file twice adds nothing.
  assert.deepEqual(other.importJSON(text), { added: 0, skipped: 3, invalid: 0 });
});

test('clear() empties sessions but keeps the playerId', () => {
  const storage = memoryStorage();
  const store = createStore({ storage, key: KEY });
  store.save(session());
  store.clear();
  assert.deepEqual(store.sessions(), []);
  const again = createStore({ storage, key: KEY });
  assert.equal(again.playerId, store.playerId);
  assert.deepEqual(again.sessions(), []);
});
