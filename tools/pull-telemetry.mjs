#!/usr/bin/env node
// Pull playtest sessions from the deployed telemetry collector and save them
// in the same {schema, exportedAt, sessions} shape the dashboard's Import
// button reads (src/ui/screens/dashboard.js / src/telemetry/store.js importJSON).
//
// Usage:
//   pnpm telemetry:pull                       # since=<7 days ago>
//   pnpm telemetry:pull -- --since 2026-01-01 # explicit start date
//   pnpm telemetry:pull -- --limit 2000
//
// Auth: reads the read token from (first match wins):
//   1. $CHASS_READ_TOKEN
//   2. .telemetry-read-token in the repo root (chmod 600, gitignored)
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const ENDPOINT = process.env.CHASS_TELEMETRY_URL ?? 'https://chass-telemetry.lishuyustevenli.workers.dev';
const TOKEN_FILE = resolve(ROOT, '.telemetry-read-token');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since') out.since = argv[++i];
    else if (argv[i] === '--limit') out.limit = argv[++i];
  }
  return out;
}

async function readToken() {
  if (process.env.CHASS_READ_TOKEN) return process.env.CHASS_READ_TOKEN.trim();
  try {
    return (await readFile(TOKEN_FILE, 'utf8')).trim();
  } catch {
    throw new Error(`No read token found. Set $CHASS_READ_TOKEN or create ${TOKEN_FILE} (chmod 600).`);
  }
}

export async function pull({ since, limit, endpoint = ENDPOINT, token } = {}) {
  const t = token ?? (await readToken());
  const since_ = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const url = new URL('/v1/sessions', endpoint);
  url.searchParams.set('since', since_);
  if (limit) url.searchParams.set('limit', String(limit));

  const res = await fetch(url, { headers: { authorization: `Bearer ${t}` } });
  if (!res.ok) throw new Error(`GET ${url.pathname} → ${res.status} ${await res.text()}`);
  return res.json();
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const data = await pull(args);
    const date = new Date().toISOString().slice(0, 10);
    const outFile = resolve(ROOT, `telemetry-export-${date}.json`);
    await writeFile(outFile, JSON.stringify(data, null, 1));
    console.log(`[telemetry:pull] ${data.sessions.length} session(s) → ${outFile}`);
  } catch (err) {
    console.error('[telemetry:pull] failed:', err.message);
    process.exit(1);
  }
}
