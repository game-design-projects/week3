// Leaderboard client: build a submission from a finished Match, POST it, and
// fetch a board. The server replays every submission with the same rules
// (src/core/scores.js), so all we send is the game itself: the ORIGINAL level
// start (Match.startFen — not the rebased segment FEN after a drop), the
// starting purses and the full move/drop list.
//
// Nothing here runs unless the player presses Submit (or opens the
// Leaderboard screen, which only reads). It is independent of telemetry consent.

import { BALANCE_VERSION, LEADERBOARD } from './config.js';
import { createLogger } from './lib/log.js';

const log = createLogger('leaderboard');

/** A leaderboard request that failed. `kind`: 'offline' | 'rejected' (4xx, don't retry as-is) | 'server'. */
export class LeaderboardError extends Error {
  constructor(kind, message, { status = 0, code = null } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {{match, reserve:{w,b}, levelId, aiPreset, rules, playerId, nickname}} p
 *   reserve = the purses the battle STARTED with (Match.reserve changes as gold is spent and earned)
 */
export function buildSubmission({ match, reserve, levelId, aiPreset, rules, playerId, nickname }) {
  return {
    playerId,
    nickname,
    levelId,
    balanceVersion: BALANCE_VERSION,
    aiPreset,
    startFen: match.startFen,
    reserve: { w: reserve.w, b: reserve.b },
    rules: { captureBounty: !!rules?.captureBounty },
    moves: match.historyUci(),
  };
}

async function request(url, init, { fetchImpl = globalThis.fetch, timeoutMs = LEADERBOARD.timeoutMs } = {}) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: ctrl?.signal });
  } catch (e) {
    log.warn('leaderboard unreachable', e?.name ?? '', e?.message ?? e);
    throw new LeaderboardError('offline', 'Could not reach the leaderboard. Check your connection and try again.');
  } finally {
    clearTimeout(timer);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.ok && body) return body;
  const message = body?.error ?? `The leaderboard answered ${res.status}.`;
  log.warn('leaderboard error', res.status, body?.code ?? '', message);
  if (res.status >= 400 && res.status < 500) throw new LeaderboardError('rejected', message, { status: res.status, code: body?.code ?? null });
  throw new LeaderboardError('server', 'The leaderboard is having trouble. Try again in a moment.', { status: res.status });
}

/** POST a submission. @returns {Promise<{rank:number,total:number,improved:boolean,best:object,submitted:object}>} */
export async function submitScore(submission, opts = {}) {
  const url = opts.endpoint ?? LEADERBOARD.endpoint;
  log.info(`submitting ${submission.levelId}/${submission.aiPreset}: ${submission.moves.length} plies`);
  // text/plain keeps it a CORS "simple request" (no preflight round trip).
  const result = await request(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(submission) }, opts);
  log.info(`submitted: #${result.rank} of ${result.total}${result.improved ? '' : ' (previous best kept)'}`);
  return result;
}

/** GET one board. @returns {Promise<{level, balance, ai, total, entries:object[], player:object|null}>} */
export async function fetchScores({ level = 'L1', balance = BALANCE_VERSION, ai = 'normal', limit = LEADERBOARD.limit, player = null } = {}, opts = {}) {
  const url = new URL(opts.endpoint ?? LEADERBOARD.endpoint);
  url.search = new URLSearchParams({ level, balance, ai, limit: String(limit), ...(player ? { player } : {}) }).toString();
  return request(url.toString(), { method: 'GET' }, opts);
}

/** The last nickname used on this device ('' if none or storage is blocked). */
export function loadNickname(storage) {
  try {
    const s = storage === undefined ? globalThis.localStorage : storage;
    return s?.getItem(LEADERBOARD.nicknameKey) ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(name, storage) {
  try {
    const s = storage === undefined ? globalThis.localStorage : storage;
    s?.setItem(LEADERBOARD.nicknameKey, name);
  } catch (e) {
    log.warn('could not remember nickname', e?.message ?? e);
  }
}
