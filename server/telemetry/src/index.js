// Chess Battle Simulator — anonymous playtest telemetry collector.
//
// A tiny Cloudflare Worker + D1 database. It accepts the finished-session JSON
// the client already builds (src/telemetry/session.js) and stores it so the
// designer can pull playtest data from testers who never send a file by hand.
//
// ANONYMITY BY DESIGN: this worker never reads or stores the caller's IP
// address, User-Agent, or any Cloudflare geo/bot metadata (`request.cf`,
// `request.headers.get('cf-connecting-ip')`, etc. are never touched). The
// only identifier is the random `playerId` the client already generates and
// stores in localStorage (src/telemetry/store.js `randomId('p')`).
//
// Routes:
//   POST /v1/sessions            body = one session (text/plain or application/json) → 204
//   GET  /v1/sessions?since=&limit=   Bearer READ_TOKEN required → {schema, exportedAt, sessions}
//   GET  /health                 → 200 "ok"
//   OPTIONS *                    → CORS preflight
//
// Kept importable from plain Node (no `cloudflare:*` imports) so it can be
// unit-tested under `node --test` with a fake `env.DB` — see
// tests/telemetry-worker.test.js.

const MAX_BODY_BYTES = 128 * 1024; // 128 KB
const MODES = ['level', 'free'];
const PLAYER_ID_RE = /^p_[0-9a-f]{16}$/;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

// itch.io serves the game from CDN subdomains that vary per build
// (html-classic.itch.zone, *.hwcdn.net, ...), and sendBeacon's simple POST
// carries no preflight-able custom headers, so we allow any origin for the
// public write endpoint. The read endpoint is separately gated by a bearer
// token, so a permissive CORS policy on it is not a data leak.
function corsHeaders(request) {
  const origin = request.headers.get('origin') || '*';
  return {
    'access-control-allow-origin': origin,
    'vary': 'origin',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-max-age': '86400',
  };
}

function json(data, init, request) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json', ...corsHeaders(request), ...(init?.headers ?? {}) },
  });
}

function empty(status, request, extraHeaders) {
  return new Response(null, { status, headers: { ...corsHeaders(request), ...extraHeaders } });
}

/**
 * Structural check on an incoming session payload — deliberately narrow.
 * Anything shaped correctly is accepted; deep validation of every field is
 * the client's job (isValidSession in src/telemetry/store.js does the same
 * checks and refuses to even save a session that fails them).
 */
export function isValidIncoming(s) {
  return (
    !!s &&
    typeof s === 'object' &&
    !Array.isArray(s) &&
    s.schema === 1 &&
    typeof s.id === 'string' &&
    s.id.length > 0 &&
    MODES.includes(s.mode) &&
    typeof s.startedAt === 'string' &&
    typeof s.playerId === 'string' &&
    PLAYER_ID_RE.test(s.playerId)
  );
}

/** Extract the columns we index/query on; everything else stays in raw_json. */
function columnsFor(s, receivedAt) {
  return {
    id: s.id,
    player_id: s.playerId,
    mode: s.mode,
    level_id: s.levelId ?? null,
    result: s.result ?? null,
    end_reason: s.endReason ?? null,
    app_version: s.appVersion ?? null,
    balance_version: s.balanceVersion ?? null,
    started_at: s.startedAt,
    plies: Number.isFinite(s.plies) ? s.plies : null,
    received_at: receivedAt,
    raw_json: JSON.stringify(s),
  };
}

async function handleSubmit(request, env) {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) return empty(413, request);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return empty(413, request);

  let session;
  try {
    session = JSON.parse(text);
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 }, request);
  }

  if (!isValidIncoming(session)) {
    return json({ error: 'session failed structural validation' }, { status: 400 }, request);
  }

  const receivedAt = new Date().toISOString();
  const c = columnsFor(session, receivedAt);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO sessions
      (id, player_id, mode, level_id, result, end_reason, app_version, balance_version, started_at, plies, received_at, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(c.id, c.player_id, c.mode, c.level_id, c.result, c.end_reason, c.app_version, c.balance_version, c.started_at, c.plies, c.received_at, c.raw_json)
    .run();

  // No IP/UA/geo in this log line — anonymous by design (see file header).
  console.log(`[telemetry] stored session ${c.id} mode=${c.mode} result=${c.result ?? '-'} plies=${c.plies ?? '-'}`);
  return empty(204, request);
}

function isAuthorized(request, env) {
  const auth = request.headers.get('authorization') ?? '';
  const [scheme, token] = auth.split(' ');
  return scheme === 'Bearer' && !!token && !!env.READ_TOKEN && token === env.READ_TOKEN;
}

async function handleExport(request, env, url) {
  if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, { status: 401 }, request);

  const since = url.searchParams.get('since');
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT;

  const stmt = since
    ? env.DB.prepare('SELECT raw_json FROM sessions WHERE started_at >= ? ORDER BY started_at ASC LIMIT ?').bind(since, limit)
    : env.DB.prepare('SELECT raw_json FROM sessions ORDER BY started_at ASC LIMIT ?').bind(limit);

  const { results } = await stmt.all();
  const sessions = results.map((r) => JSON.parse(r.raw_json));
  console.log(`[telemetry] exported ${sessions.length} session(s)${since ? ` since ${since}` : ''}`);
  return json({ schema: 1, exportedAt: new Date().toISOString(), sessions }, { status: 200 }, request);
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return empty(204, request);
  if (request.method === 'GET' && url.pathname === '/health') return new Response('ok', { status: 200, headers: corsHeaders(request) });
  if (request.method === 'POST' && url.pathname === '/v1/sessions') return handleSubmit(request, env);
  if (request.method === 'GET' && url.pathname === '/v1/sessions') return handleExport(request, env, url);

  return json({ error: 'not found' }, { status: 404 }, request);
}

export default { fetch: handleRequest };
