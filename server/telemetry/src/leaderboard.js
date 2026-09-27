// Chess Battle Simulator — server-validated leaderboard (same Worker, same D1).
//
//   POST   /v1/scores              body = {playerId, nickname, levelId, balanceVersion, aiPreset,
//                                          startFen, reserve:{w,b}, rules, moves:[...]}
//                                   → 200 {rank, total, best, improved}
//   GET    /v1/scores?level=L1&balance=b5&ai=normal&limit=20&player=<id>
//                                   → 200 {level, balance, ai, total, entries:[{rank, nickname, moves, goldLeft, createdAt}], player}
//   DELETE /v1/scores/:id          Bearer READ_TOKEN → 200 {deleted}   (moderation)
//
// The client's numbers are never used: the game is replayed with the game's
// own rules code (src/core/scores.js → Match, chess.js) and scored from that.
// Rows keep only a player's BEST score per board (level, balance, AI preset).
// Like the telemetry collector, this never reads or stores IP/User-Agent/geo.
// Player ids are never returned by GET; with the READ_TOKEN it adds each row's
// score id, so a moderator can find what to DELETE.

import { AI_PRESETS, APP_VERSION, BALANCE_VERSION, LEVELS } from '../../../src/config.js';
import { cleanNickname, isBetterScore, replaySubmission } from '../../../src/core/scores.js';

export const MAX_SCORE_BODY_BYTES = 64 * 1024;
const PLAYER_ID_RE = /^p_[0-9a-f]{16}$/;
const SCORE_ID_RE = /^sc_[0-9a-f]{16}$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const BOARD_WHERE = 'level_id = ? AND balance_version = ? AND ai_preset = ?';
const ORDER = 'ORDER BY plies ASC, gold_left DESC, created_at ASC, id ASC';

/** CORS for the leaderboard: public (any origin, no credentials). DELETE is listed only on the per-row path and still needs the bearer token. */
export function scoresCors(path) {
  const row = path !== '/v1/scores';
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': row ? 'DELETE, OPTIONS' : 'GET, POST, OPTIONS',
    'access-control-allow-headers': row ? 'authorization' : 'content-type',
    'access-control-max-age': '86400',
  };
}

function reply(data, status, path) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...scoresCors(path) },
  });
}

function randomScoreId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `sc_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const rowToScore = (r) => ({ id: r.id, plies: r.plies, goldLeft: r.gold_left, createdAt: r.created_at });

function publicEntry(r, rank, withId) {
  const entry = { rank, nickname: r.nickname, moves: Math.ceil(r.plies / 2), plies: r.plies, goldLeft: r.gold_left, goldSpent: r.gold_spent, createdAt: r.created_at };
  return withId ? { id: r.id, ...entry } : entry;
}

async function ownRow(env, playerId, board) {
  return env.DB.prepare(`SELECT id, nickname, plies, gold_left, gold_spent, created_at FROM scores WHERE player_id = ? AND ${BOARD_WHERE}`)
    .bind(playerId, board.level, board.balance, board.ai)
    .first();
}

/** 1-based position of a row on its board (count of strictly better rows + 1). */
async function rankOf(env, board, row) {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM scores WHERE ${BOARD_WHERE} AND (plies < ? OR (plies = ? AND gold_left > ?) OR (plies = ? AND gold_left = ? AND created_at < ?) OR (plies = ? AND gold_left = ? AND created_at = ? AND id < ?))`,
  )
    .bind(board.level, board.balance, board.ai, row.plies, row.plies, row.gold_left, row.plies, row.gold_left, row.created_at, row.plies, row.gold_left, row.created_at, row.id)
    .first();
  return (r?.n ?? 0) + 1;
}

async function boardTotal(env, board) {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM scores WHERE ${BOARD_WHERE}`).bind(board.level, board.balance, board.ai).first();
  return r?.n ?? 0;
}

// ---------------------------------------------------------------- POST

export async function handleSubmitScore(request, env) {
  const path = '/v1/scores';
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_SCORE_BODY_BYTES) return reply({ error: 'Body too large.', code: 'too-large' }, 413, path);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_SCORE_BODY_BYTES) return reply({ error: 'Body too large.', code: 'too-large' }, 413, path);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return reply({ error: 'Invalid JSON body.', code: 'bad-json' }, 400, path);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Expected a JSON object.', code: 'bad-body' }, 400, path);
  if (typeof body.playerId !== 'string' || !PLAYER_ID_RE.test(body.playerId)) return reply({ error: 'Missing or malformed playerId.', code: 'bad-player' }, 400, path);

  const nick = cleanNickname(body.nickname);
  if (!nick.ok) return reply({ error: nick.error, code: nick.code }, nick.status, path);

  const t0 = Date.now();
  const score = replaySubmission(body);
  const replayMs = Date.now() - t0;
  if (!score.ok) {
    console.log(`[scores] rejected ${score.code} (${Array.isArray(body.moves) ? body.moves.length : '-'} plies, replay ${replayMs}ms)`);
    return reply({ error: score.error, code: score.code }, score.status, path);
  }

  const board = { level: score.levelId, balance: score.balanceVersion, ai: score.aiPreset };
  const before = await ownRow(env, body.playerId, board);
  const now = new Date().toISOString();
  const candidate = { plies: score.plies, goldLeft: score.goldLeft };
  const improved = !before || isBetterScore(candidate, rowToScore(before));

  // Atomic best-only upsert: the DO UPDATE fires only when the new score is strictly better.
  await env.DB.prepare(
    `INSERT INTO scores (id, player_id, nickname, level_id, balance_version, ai_preset, plies, gold_left, gold_spent, moves_json, pgn, app_version, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (player_id, level_id, balance_version, ai_preset) DO UPDATE SET
       nickname = excluded.nickname, plies = excluded.plies, gold_left = excluded.gold_left, gold_spent = excluded.gold_spent,
       moves_json = excluded.moves_json, pgn = excluded.pgn, app_version = excluded.app_version, created_at = excluded.created_at
     WHERE excluded.plies < scores.plies OR (excluded.plies = scores.plies AND excluded.gold_left > scores.gold_left)`,
  )
    .bind(randomScoreId(), body.playerId, nick.nickname, board.level, board.balance, board.ai, score.plies, score.goldLeft, score.goldSpent, JSON.stringify(body.moves), score.pgn, APP_VERSION, now)
    .run();
  // A worse game keeps the best score, but the player's chosen name still updates.
  if (before && !improved && before.nickname !== nick.nickname) {
    await env.DB.prepare(`UPDATE scores SET nickname = ? WHERE player_id = ? AND ${BOARD_WHERE}`).bind(nick.nickname, body.playerId, board.level, board.balance, board.ai).run();
  }

  const best = await ownRow(env, body.playerId, board);
  const [rank, total] = [await rankOf(env, board, best), await boardTotal(env, board)];
  // No IP/UA/geo and no nickname in the log line.
  console.log(`[scores] ${improved ? 'stored' : 'kept'} ${best.id} ${board.level}/${board.balance}/${board.ai} plies=${score.plies} gold=${score.goldLeft} rank ${rank}/${total} (replay ${replayMs}ms)`);
  return reply(
    {
      rank,
      total,
      improved,
      best: publicEntry(best, rank, false),
      submitted: { moves: score.moves, plies: score.plies, goldLeft: score.goldLeft, goldSpent: score.goldSpent },
    },
    200,
    path,
  );
}

// ---------------------------------------------------------------- GET

export async function handleListScores(request, env, url, { authorized = false } = {}) {
  const path = '/v1/scores';
  const q = url.searchParams;
  const board = { level: q.get('level') || LEVELS[0].id, balance: q.get('balance') || BALANCE_VERSION, ai: q.get('ai') || 'normal' };
  if (!LEVELS.some((l) => l.id === board.level)) return reply({ error: 'Unknown level.', code: 'bad-level' }, 400, path);
  if (!/^[\w.-]{1,16}$/.test(board.balance)) return reply({ error: 'Bad balance version.', code: 'bad-balance' }, 400, path);
  if (!Object.hasOwn(AI_PRESETS, board.ai)) return reply({ error: 'Unknown AI difficulty.', code: 'bad-ai' }, 400, path);
  const limitParam = Number(q.get('limit'));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;
  const player = q.get('player');

  const { results } = await env.DB.prepare(`SELECT id, nickname, plies, gold_left, gold_spent, created_at FROM scores WHERE ${BOARD_WHERE} ${ORDER} LIMIT ?`)
    .bind(board.level, board.balance, board.ai, limit)
    .all();
  const entries = results.map((r, i) => publicEntry(r, i + 1, authorized));
  const total = await boardTotal(env, board);

  let mine = null;
  if (player && PLAYER_ID_RE.test(player)) {
    const row = await ownRow(env, player, board);
    if (row) mine = publicEntry(row, await rankOf(env, board, row), authorized);
  }
  return reply({ level: board.level, balance: board.balance, ai: board.ai, total, entries, player: mine }, 200, path);
}

// ---------------------------------------------------------------- DELETE

export async function handleDeleteScore(request, env, path, { authorized }) {
  if (!authorized) return reply({ error: 'unauthorized' }, 401, path);
  const id = decodeURIComponent(path.slice('/v1/scores/'.length));
  if (!SCORE_ID_RE.test(id)) return reply({ error: 'Bad score id.' }, 400, path);
  const res = await env.DB.prepare('DELETE FROM scores WHERE id = ?').bind(id).run();
  const deleted = res?.meta?.changes ?? 0;
  console.log(`[scores] moderation delete ${id}: ${deleted ? 'removed' : 'not found'}`);
  if (!deleted) return reply({ error: 'not found' }, 404, path);
  return reply({ deleted: id }, 200, path);
}
