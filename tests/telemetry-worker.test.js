// Unit tests for the Cloudflare Worker telemetry collector (server/telemetry/src/index.js).
// Runs under plain `node --test` (node 20) against a tiny fake D1 — no wrangler,
// no network — so it's part of the same `pnpm test` suite as the rest of the game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, isValidIncoming } from '../server/telemetry/src/index.js';

const TOKEN = 'test-read-token';

/** Minimal in-memory stand-in for a D1 database, matching the three query
 * shapes index.js actually issues (upsert by id, select ordered by started_at). */
function fakeD1() {
  const rows = new Map(); // id -> row
  return {
    rows,
    prepare(sql) {
      const bound = { sql, args: [] };
      const api = {
        bind(...args) {
          bound.args = args;
          return api;
        },
        async run() {
          if (/INSERT OR REPLACE INTO sessions/.test(sql)) {
            const [id, player_id, mode, level_id, result, end_reason, app_version, balance_version, started_at, plies, received_at, raw_json] = bound.args;
            rows.set(id, { id, player_id, mode, level_id, result, end_reason, app_version, balance_version, started_at, plies, received_at, raw_json });
            return { success: true };
          }
          throw new Error(`fakeD1: unhandled run() for: ${sql}`);
        },
        async all() {
          let list = [...rows.values()];
          if (/WHERE started_at >= \?/.test(sql)) {
            const [since, limit] = bound.args;
            list = list.filter((r) => r.started_at >= since).slice(0, limit);
          } else if (/ORDER BY started_at ASC LIMIT \?/.test(sql)) {
            const [limit] = bound.args;
            list = list.slice(0, limit);
          } else {
            throw new Error(`fakeD1: unhandled all() for: ${sql}`);
          }
          list.sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
          return { results: list };
        },
      };
      return api;
    },
  };
}

function env(overrides = {}) {
  return { DB: fakeD1(), READ_TOKEN: TOKEN, ...overrides };
}

function session(overrides = {}) {
  return {
    schema: 1,
    id: 's_aaaaaaaaaaaaaaaa',
    playerId: 'p_0123456789abcdef',
    mode: 'level',
    levelId: 'L1',
    result: 'win',
    endReason: 'checkmate',
    appVersion: '0.5.0',
    balanceVersion: 'b4',
    startedAt: '2026-01-01T00:00:00.000Z',
    plies: 12,
    ...overrides,
  };
}

function post(body, headers = {}) {
  return new Request('https://collector.example/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'text/plain', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function get(path, headers = {}) {
  return new Request(`https://collector.example${path}`, { method: 'GET', headers });
}

test('isValidIncoming: accepts a minimal well-formed session, rejects junk', () => {
  assert.equal(isValidIncoming(session()), true);
  assert.equal(isValidIncoming(null), false);
  assert.equal(isValidIncoming('nope'), false);
  assert.equal(isValidIncoming(session({ schema: 2 })), false);
  assert.equal(isValidIncoming(session({ id: '' })), false);
  assert.equal(isValidIncoming(session({ mode: 'arcade' })), false);
  assert.equal(isValidIncoming(session({ startedAt: 123 })), false);
  assert.equal(isValidIncoming(session({ playerId: 'not-shaped-right' })), false);
  assert.equal(isValidIncoming(session({ playerId: 'p_short' })), false);
});

test('GET /health → 200 ok, CORS allowed', async () => {
  const res = await handleRequest(get('/health'), env());
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ok');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('OPTIONS any path → 204 with CORS headers reflecting the origin', async () => {
  const req = new Request('https://collector.example/v1/sessions', { method: 'OPTIONS', headers: { origin: 'https://html-classic.itch.zone' } });
  const res = await handleRequest(req, env());
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://html-classic.itch.zone');
  assert.match(res.headers.get('access-control-allow-methods'), /POST/);
});

test('POST /v1/sessions: valid session → 204, stored with extracted columns + raw_json', async () => {
  const e = env();
  const s = session();
  const res = await handleRequest(post(s), e);
  assert.equal(res.status, 204);
  assert.equal(e.DB.rows.size, 1);
  const row = e.DB.rows.get(s.id);
  assert.equal(row.player_id, s.playerId);
  assert.equal(row.mode, 'level');
  assert.equal(row.level_id, 'L1');
  assert.equal(row.result, 'win');
  assert.equal(row.plies, 12);
  assert.equal(typeof row.received_at, 'string');
  assert.deepEqual(JSON.parse(row.raw_json), s);
});

test('POST /v1/sessions: upserts by id (INSERT OR REPLACE) — resend replaces, does not duplicate', async () => {
  const e = env();
  const s = session();
  await handleRequest(post(s), e);
  await handleRequest(post({ ...s, result: 'loss', plies: 20 }), e);
  assert.equal(e.DB.rows.size, 1);
  assert.equal(e.DB.rows.get(s.id).result, 'loss');
  assert.equal(e.DB.rows.get(s.id).plies, 20);
});

test('POST /v1/sessions: malformed JSON → 400, nothing stored', async () => {
  const e = env();
  const res = await handleRequest(post('{not json'), e);
  assert.equal(res.status, 400);
  assert.equal(e.DB.rows.size, 0);
});

test('POST /v1/sessions: structurally invalid session → 400, nothing stored', async () => {
  const e = env();
  for (const bad of [
    session({ schema: 2 }),
    session({ mode: 'campaign' }),
    session({ id: '' }),
    session({ playerId: 'garbage' }),
    { foo: 'bar' },
  ]) {
    const res = await handleRequest(post(bad), e);
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  assert.equal(e.DB.rows.size, 0);
});

test('POST /v1/sessions: body over the size limit → 413 via content-length', async () => {
  const e = env();
  const req = post(session(), { 'content-length': String(200 * 1024) });
  const res = await handleRequest(req, e);
  assert.equal(res.status, 413);
  assert.equal(e.DB.rows.size, 0);
});

test('POST /v1/sessions: oversized body without a trustworthy content-length is still rejected', async () => {
  const e = env();
  const huge = JSON.stringify(session({ pgn: 'x'.repeat(200 * 1024) }));
  const req = new Request('https://collector.example/v1/sessions', { method: 'POST', body: huge });
  const res = await handleRequest(req, e);
  assert.equal(res.status, 413);
  assert.equal(e.DB.rows.size, 0);
});

test('GET /v1/sessions: no Authorization header → 401', async () => {
  const res = await handleRequest(get('/v1/sessions'), env());
  assert.equal(res.status, 401);
});

test('GET /v1/sessions: wrong token → 401', async () => {
  const res = await handleRequest(get('/v1/sessions', { authorization: 'Bearer wrong' }), env());
  assert.equal(res.status, 401);
});

test('GET /v1/sessions: valid token → {schema, exportedAt, sessions} shaped for store.importJSON', async () => {
  const e = env();
  const a = session({ id: 's_a', startedAt: '2026-01-01T00:00:00.000Z' });
  const b = session({ id: 's_b', startedAt: '2026-02-01T00:00:00.000Z' });
  await handleRequest(post(a), e);
  await handleRequest(post(b), e);
  const res = await handleRequest(get('/v1/sessions', { authorization: `Bearer ${TOKEN}` }), e);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.schema, 1);
  assert.equal(typeof body.exportedAt, 'string');
  assert.deepEqual(body.sessions.map((s) => s.id).sort(), ['s_a', 's_b']);
  assert.deepEqual(body.sessions.find((s) => s.id === 'ardu')?.id, undefined);
});

test('GET /v1/sessions?since= filters by startedAt', async () => {
  const e = env();
  await handleRequest(post(session({ id: 's_old', startedAt: '2025-01-01T00:00:00.000Z' })), e);
  await handleRequest(post(session({ id: 's_new', startedAt: '2026-06-01T00:00:00.000Z' })), e);
  const res = await handleRequest(get('/v1/sessions?since=2026-01-01T00:00:00.000Z', { authorization: `Bearer ${TOKEN}` }), e);
  const body = await res.json();
  assert.deepEqual(body.sessions.map((s) => s.id), ['s_new']);
});

test('GET /v1/sessions?limit= caps the number returned', async () => {
  const e = env();
  for (let i = 0; i < 5; i++) {
    await handleRequest(post(session({ id: `s_${i}`, startedAt: `2026-01-0${i + 1}T00:00:00.000Z` })), e);
  }
  const res = await handleRequest(get('/v1/sessions?limit=2', { authorization: `Bearer ${TOKEN}` }), e);
  const body = await res.json();
  assert.equal(body.sessions.length, 2);
});

test('unknown route → 404', async () => {
  const res = await handleRequest(get('/nope'), env());
  assert.equal(res.status, 404);
});

test('response never carries an IP/UA/geo column — anonymity check on the stored row', async () => {
  const e = env();
  const s = session();
  const req = post(s, { 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'TotallyIdentifiable/1.0' });
  await handleRequest(req, e);
  const row = e.DB.rows.get(s.id);
  const cols = Object.keys(row);
  assert.deepEqual(
    cols.sort(),
    ['app_version', 'balance_version', 'end_reason', 'id', 'level_id', 'mode', 'player_id', 'plies', 'raw_json', 'received_at', 'result', 'started_at'].sort(),
  );
  assert.doesNotMatch(row.raw_json, /203\.0\.113\.9|TotallyIdentifiable/);
});
