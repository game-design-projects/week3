// Leaderboard routes of the Worker (server/telemetry/src/leaderboard.js via index.js).
// Same approach as tests/telemetry-worker.test.js: plain `node --test`, a tiny
// in-memory fake D1 that understands exactly the query shapes the worker
// issues (the real SQL is checked against SQLite on deploy; see README).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../server/telemetry/src/index.js';
import { BALANCE_VERSION, LEVELS } from '../src/config.js';
import { compareScores, officialStart } from '../src/core/scores.js';
import { NOT_OVER, WIN_17, WIN_7, WIN_9 } from './fixtures/l1-games.js';

const TOKEN = 'test-read-token';
const BASE = 'https://collector.example';
const P1 = 'p_1111111111111111';
const P2 = 'p_2222222222222222';
const P3 = 'p_3333333333333333';

/** In-memory `scores` table + the statements leaderboard.js prepares. */
function fakeD1() {
  const rows = new Map(); // id -> row
  const onBoard = (r, [level, balance, ai]) => r.level_id === level && r.balance_version === balance && r.ai_preset === ai;
  const asScore = (r) => ({ id: r.id, plies: r.plies, goldLeft: r.gold_left, createdAt: r.created_at });
  const sorted = (list) => [...list].sort((a, b) => compareScores(asScore(a), asScore(b)));
  const find = (playerId, board) => [...rows.values()].find((r) => r.player_id === playerId && onBoard(r, board)) ?? null;

  return {
    rows,
    insert(row) {
      rows.set(row.id, { gold_spent: 0, moves_json: '[]', pgn: '', app_version: null, ...row });
    },
    prepare(rawSql) {
      const sql = rawSql.replace(/\s+/g, ' ').trim();
      let args = [];
      const api = {
        bind(...a) {
          args = a;
          return api;
        },
        async first() {
          if (/^SELECT id, nickname, plies, gold_left, gold_spent, created_at FROM scores WHERE player_id = \?/.test(sql)) {
            const [playerId, ...board] = args;
            return find(playerId, board);
          }
          if (/^SELECT COUNT\(\*\) AS n FROM scores WHERE .* AND \(plies < \?/s.test(sql)) {
            const board = args.slice(0, 3);
            const [plies, , gold, , , createdAt, , , , id] = args.slice(3);
            const me = { id, plies, goldLeft: gold, createdAt };
            return { n: [...rows.values()].filter((r) => onBoard(r, board) && compareScores(asScore(r), me) < 0).length };
          }
          if (/^SELECT COUNT\(\*\) AS n FROM scores WHERE level_id = \? AND balance_version = \? AND ai_preset = \?$/.test(sql)) {
            return { n: [...rows.values()].filter((r) => onBoard(r, args)).length };
          }
          throw new Error(`fakeD1: unhandled first() for: ${sql}`);
        },
        async all() {
          if (/^SELECT id, nickname, plies, gold_left, gold_spent, created_at FROM scores WHERE level_id = \? .* ORDER BY plies ASC, gold_left DESC, created_at ASC, id ASC LIMIT \?$/.test(sql)) {
            const board = args.slice(0, 3);
            return { results: sorted([...rows.values()].filter((r) => onBoard(r, board))).slice(0, args[3]) };
          }
          throw new Error(`fakeD1: unhandled all() for: ${sql}`);
        },
        async run() {
          if (/^INSERT INTO scores .* ON CONFLICT \(player_id, level_id, balance_version, ai_preset\) DO UPDATE SET .* WHERE excluded\.plies < scores\.plies OR \(excluded\.plies = scores\.plies AND excluded\.gold_left > scores\.gold_left\)$/s.test(sql)) {
            const [id, player_id, nickname, level_id, balance_version, ai_preset, plies, gold_left, gold_spent, moves_json, pgn, app_version, created_at] = args;
            const row = { id, player_id, nickname, level_id, balance_version, ai_preset, plies, gold_left, gold_spent, moves_json, pgn, app_version, created_at };
            const old = find(player_id, [level_id, balance_version, ai_preset]);
            if (!old) rows.set(id, row);
            else if (plies < old.plies || (plies === old.plies && gold_left > old.gold_left)) rows.set(old.id, { ...row, id: old.id });
            return { meta: { changes: 1 } };
          }
          if (/^UPDATE scores SET nickname = \? WHERE player_id = \?/.test(sql)) {
            const [nickname, playerId, ...board] = args;
            const r = find(playerId, board);
            if (r) r.nickname = nickname;
            return { meta: { changes: r ? 1 : 0 } };
          }
          if (/^DELETE FROM scores WHERE id = \?$/.test(sql)) {
            const existed = rows.delete(args[0]);
            return { meta: { changes: existed ? 1 : 0 } };
          }
          throw new Error(`fakeD1: unhandled run() for: ${sql}`);
        },
      };
      return api;
    },
  };
}

const env = () => ({ DB: fakeD1(), READ_TOKEN: TOKEN });

function submission(moves, overrides = {}) {
  const { startFen, reserve } = officialStart(LEVELS[0]);
  return { playerId: P1, nickname: 'Ada', levelId: 'L1', balanceVersion: BALANCE_VERSION, aiPreset: 'normal', startFen, reserve, rules: { captureBounty: true }, moves, ...overrides };
}

const post = (body, headers = {}) =>
  new Request(`${BASE}/v1/scores`, { method: 'POST', headers: { 'content-type': 'text/plain', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const get = (qs = '', headers = {}) => new Request(`${BASE}/v1/scores${qs}`, { method: 'GET', headers });
const del = (id, headers = {}) => new Request(`${BASE}/v1/scores/${id}`, { method: 'DELETE', headers });
const tick = () => new Promise((r) => setTimeout(r, 3)); // distinct created_at timestamps

async function submit(e, body) {
  const res = await handleRequest(post(body), e);
  return { status: res.status, body: await res.json(), res };
}

test('POST /v1/scores: a real mate is replayed, scored by the server and ranked', async () => {
  const e = env();
  const { status, body, res } = await submit(e, submission(WIN_7));
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual({ rank: body.rank, total: body.total, improved: body.improved }, { rank: 1, total: 1, improved: true });
  assert.deepEqual({ moves: body.best.moves, goldLeft: body.best.goldLeft, nickname: body.best.nickname }, { moves: 4, goldLeft: 3, nickname: 'Ada' });
  assert.equal(body.best.id, undefined, 'no ids in the public reply');
  const [row] = [...e.DB.rows.values()];
  assert.equal(row.player_id, P1);
  assert.equal(row.plies, 7);
  assert.equal(row.gold_left, 3);
  assert.equal(row.gold_spent, 14);
  assert.deepEqual(JSON.parse(row.moves_json), WIN_7);
  assert.match(row.pgn, /Qh7# 1-0/);
  assert.match(row.id, /^sc_[0-9a-f]{16}$/);
  assert.deepEqual(Object.keys(row).sort(), ['ai_preset', 'app_version', 'balance_version', 'created_at', 'gold_left', 'gold_spent', 'id', 'level_id', 'moves_json', 'nickname', 'pgn', 'player_id', 'plies'].sort(), 'no IP/UA/geo columns');
});

test('POST /v1/scores: client-claimed numbers are ignored', async () => {
  const e = env();
  const { body } = await submit(e, { ...submission(WIN_17), plies: 1, goldLeft: 500, rank: 1 });
  assert.equal(body.best.plies, 17);
  assert.equal(body.best.goldLeft, 1);
});

test('POST /v1/scores: illegal move, non-mate, tampered start, bad nickname → 4xx and nothing stored', async () => {
  const e = env();
  const { startFen } = officialStart(LEVELS[0]);
  const cases = [
    [submission(['Q@c2', 'B@e8', 'R@h1', 'h7h5', 'h1h6', 'e7f8', 'c2h7']), 422, 'illegal-move'],
    [submission(NOT_OVER), 422, 'not-a-win'],
    [submission(WIN_7, { startFen: startFen.replace('4bppp', '5ppp') }), 422, 'bad-start'],
    [submission(WIN_7, { reserve: { w: 30, b: 5 } }), 422, 'bad-start'],
    [submission(WIN_7, { balanceVersion: 'b1' }), 422, 'stale-balance'],
    [submission(WIN_7, { rules: { captureBounty: false } }), 422, 'house-rules'],
    [submission(WIN_7, { nickname: '<img src=x>' }), 422, 'bad-nickname'],
    [submission(WIN_7, { nickname: 'xy' }), 422, 'bad-nickname'],
    [submission(WIN_7, { nickname: 'fuckface' }), 422, 'bad-nickname'],
    [submission(WIN_7, { playerId: 'someone' }), 400, 'bad-player'],
    [submission(Array(401).fill('e1e2')), 422, 'too-long'],
  ];
  for (const [body, status, code] of cases) {
    const r = await submit(e, body);
    assert.equal(r.status, status, `${code}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, code);
    assert.equal(typeof r.body.error, 'string');
  }
  const bad = await handleRequest(post('{nope'), e);
  assert.equal(bad.status, 400);
  assert.equal(e.DB.rows.size, 0);
});

test('POST /v1/scores: oversized body → 413 (by content-length and by actual size)', async () => {
  const e = env();
  let res = await handleRequest(post(submission(WIN_7), { 'content-length': String(65 * 1024) }), e);
  assert.equal(res.status, 413);
  const huge = JSON.stringify(submission(WIN_7, { pad: 'x'.repeat(70 * 1024) }));
  res = await handleRequest(new Request(`${BASE}/v1/scores`, { method: 'POST', body: huge }), e);
  assert.equal(res.status, 413);
  assert.equal(e.DB.rows.size, 0);
});

test('POST /v1/scores: a better game replaces the best; a worse one does not (but the nickname updates)', async () => {
  const e = env();
  let r = await submit(e, submission(WIN_17));
  assert.equal(r.body.best.moves, 9);
  const id = [...e.DB.rows.keys()][0];
  await tick();
  r = await submit(e, submission(WIN_7));
  assert.equal(r.body.improved, true);
  assert.equal(r.body.best.moves, 4);
  assert.equal(e.DB.rows.size, 1, 'one row per player and board');
  assert.equal([...e.DB.rows.keys()][0], id, 'the row id (moderation handle) is stable');
  const setAt = e.DB.rows.get(id).created_at;
  await tick();
  r = await submit(e, submission(WIN_9, { nickname: 'Ada L' }));
  assert.equal(r.body.improved, false);
  assert.equal(r.body.best.moves, 4, 'the best score stays');
  assert.equal(r.body.submitted.moves, 5);
  assert.equal(e.DB.rows.get(id).plies, 7);
  assert.equal(e.DB.rows.get(id).created_at, setAt, 'a worse game does not refresh the tiebreak time');
  assert.equal(e.DB.rows.get(id).nickname, 'Ada L');
  // same score again: not an improvement either
  r = await submit(e, submission(WIN_7));
  assert.equal(r.body.improved, false);
});

test('POST /v1/scores: boards are separate per AI preset', async () => {
  const e = env();
  await submit(e, submission(WIN_7, { aiPreset: 'normal' }));
  const r = await submit(e, submission(WIN_17, { aiPreset: 'hard' }));
  assert.deepEqual([r.body.rank, r.body.total, r.body.improved], [1, 1, true]);
  assert.equal(e.DB.rows.size, 2);
});

test('ranking: fewer moves first, then more gold left, then the earlier score', async () => {
  const e = env();
  const board = { level_id: 'L1', balance_version: BALANCE_VERSION, ai_preset: 'normal' };
  e.DB.insert({ ...board, id: 'sc_000000000000000a', player_id: 'p_aaaaaaaaaaaaaaaa', nickname: 'Slow', plies: 21, gold_left: 9, created_at: '2026-01-01T00:00:00.000Z' });
  e.DB.insert({ ...board, id: 'sc_000000000000000b', player_id: 'p_bbbbbbbbbbbbbbbb', nickname: 'Poor', plies: 7, gold_left: 0, created_at: '2026-01-01T00:00:00.000Z' });
  e.DB.insert({ ...board, id: 'sc_000000000000000c', player_id: 'p_cccccccccccccccc', nickname: 'Early', plies: 7, gold_left: 3, created_at: '2020-01-01T00:00:00.000Z' });
  // P1 ties "Early" on moves and gold but is later → just behind it
  let r = await submit(e, submission(WIN_7));
  assert.deepEqual([r.body.rank, r.body.total], [2, 4]);
  r = await submit(e, submission(WIN_9, { playerId: P2, nickname: 'Bea' }));
  assert.deepEqual([r.body.rank, r.body.total], [4, 5]);
  await tick();
  r = await submit(e, submission(WIN_7, { playerId: P3, nickname: 'Cyd' }));
  assert.equal(r.body.rank, 3, 'same score, later → after P1');

  const res = await handleRequest(get('?level=L1&ai=normal'), e);
  const body = await res.json();
  assert.deepEqual(body.entries.map((x) => x.nickname), ['Early', 'Ada', 'Cyd', 'Poor', 'Bea', 'Slow']);
  assert.deepEqual(body.entries.map((x) => x.rank), [1, 2, 3, 4, 5, 6]);
  assert.equal(body.total, 6);
});

test('GET /v1/scores: public, CORS *, top N, own entry and rank — and never any player id', async () => {
  const e = env();
  const board = { level_id: 'L1', balance_version: BALANCE_VERSION, ai_preset: 'normal' };
  for (let i = 0; i < 5; i++) e.DB.insert({ ...board, id: `sc_00000000000000${i}0`, player_id: `p_${'abcde'[i].repeat(16)}`, nickname: `Top${i}`, plies: 5 + i * 2, gold_left: 1, created_at: '2026-01-01T00:00:00.000Z' });
  await submit(e, submission(WIN_17)); // P1: 17 plies → 6th
  const res = await handleRequest(get(`?level=L1&balance=${BALANCE_VERSION}&ai=normal&limit=3&player=${P1}`), e);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const text = await res.text();
  assert.doesNotMatch(text, /p_[0-9a-f]{16}/, 'no player ids');
  assert.doesNotMatch(text, /sc_[0-9a-f]{16}/, 'no row ids without the token');
  assert.doesNotMatch(text, /player_id|playerId/);
  const body = JSON.parse(text);
  assert.equal(body.entries.length, 3);
  assert.deepEqual(Object.keys(body.entries[0]).sort(), ['createdAt', 'goldLeft', 'goldSpent', 'moves', 'nickname', 'plies', 'rank']);
  assert.deepEqual([body.player.rank, body.player.nickname, body.player.moves], [6, 'Ada', 9]);
  assert.equal(body.total, 6);
  assert.deepEqual([body.level, body.balance, body.ai], ['L1', BALANCE_VERSION, 'normal']);

  const other = await (await handleRequest(get('?ai=hard'), e)).json();
  assert.deepEqual([other.entries.length, other.total, other.player], [0, 0, null], 'an empty board');
  assert.equal((await handleRequest(get('?ai=godlike'), e)).status, 400);
  assert.equal((await handleRequest(get('?level=L7'), e)).status, 400);
});

test('GET /v1/scores with the READ_TOKEN adds row ids (for moderation), still no player ids', async () => {
  const e = env();
  await submit(e, submission(WIN_7));
  const body = await (await handleRequest(get('', { authorization: `Bearer ${TOKEN}` }), e)).json();
  assert.match(body.entries[0].id, /^sc_[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(body), /p_[0-9a-f]{16}/);
});

test('DELETE /v1/scores/:id needs the token; with it the row is gone', async () => {
  const e = env();
  await submit(e, submission(WIN_7));
  const id = [...e.DB.rows.keys()][0];
  assert.equal((await handleRequest(del(id), e)).status, 401);
  assert.equal((await handleRequest(del(id, { authorization: 'Bearer nope' }), e)).status, 401);
  assert.equal(e.DB.rows.size, 1);
  const ok = await handleRequest(del(id, { authorization: `Bearer ${TOKEN}` }), e);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { deleted: id });
  assert.equal(e.DB.rows.size, 0);
  assert.equal((await handleRequest(del(id, { authorization: `Bearer ${TOKEN}` }), e)).status, 404);
  assert.equal((await handleRequest(del('not-an-id', { authorization: `Bearer ${TOKEN}` }), e)).status, 400);
});

test('OPTIONS: /v1/scores allows GET/POST; only the per-row path lists DELETE (+ authorization)', async () => {
  const e = env();
  const list = await handleRequest(new Request(`${BASE}/v1/scores`, { method: 'OPTIONS', headers: { origin: 'https://html-classic.itch.zone' } }), e);
  assert.equal(list.status, 204);
  assert.equal(list.headers.get('access-control-allow-origin'), '*');
  assert.doesNotMatch(list.headers.get('access-control-allow-methods'), /DELETE/);
  const row = await handleRequest(new Request(`${BASE}/v1/scores/sc_0000000000000000`, { method: 'OPTIONS' }), e);
  assert.match(row.headers.get('access-control-allow-methods'), /DELETE/);
  assert.match(row.headers.get('access-control-allow-headers'), /authorization/);
  assert.equal((await handleRequest(new Request(`${BASE}/v1/scores`, { method: 'PUT', body: '{}' }), e)).status, 405);
});

test('telemetry routes are unchanged next to the leaderboard', async () => {
  const e = env();
  assert.equal((await handleRequest(new Request(`${BASE}/health`), e)).status, 200);
  const pre = await handleRequest(new Request(`${BASE}/v1/sessions`, { method: 'OPTIONS', headers: { origin: 'https://x.example' } }), e);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://x.example');
  assert.equal((await handleRequest(new Request(`${BASE}/v1/sessions`), e)).status, 401);
});
