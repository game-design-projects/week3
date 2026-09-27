// Pure aggregations over telemetry sessions, for the Playtest Data dashboard
// and for offline analysis of exported files.

import { PIECE_TYPES } from '../config.js';

const finished = (s) => s.result && s.result !== 'abandoned';
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rate = (wins, n) => (n ? wins / n : null);

export function filterSessions(sessions, { mode, levelId, balanceVersion, opponent } = {}) {
  return sessions.filter(
    (s) =>
      (!mode || s.mode === mode) &&
      (levelId === undefined || levelId === 'all' || s.levelId === levelId) &&
      (!balanceVersion || balanceVersion === 'all' || s.balanceVersion === balanceVersion) &&
      (!opponent || s.opponent === opponent),
  );
}

export function summarize(sessions) {
  const done = sessions.filter(finished);
  const count = (r) => sessions.filter((s) => s.result === r).length;
  return {
    sessions: sessions.length,
    finished: done.length,
    wins: count('win'),
    losses: count('loss'),
    draws: count('draw'),
    abandoned: count('abandoned'),
    winRate: rate(count('win'), done.length),
    avgPlies: avg(done.map((s) => s.plies ?? 0)),
    avgBuyMs: avg(sessions.filter((s) => Number.isFinite(s.buyMs) && s.battleStartedAt).map((s) => s.buyMs)),
    avgBattleMs: avg(done.filter((s) => Number.isFinite(s.battleMs)).map((s) => s.battleMs)),
  };
}

/** One row per army label of `side`, most played first. Only sessions that reached the battle. */
export function byArmy(sessions, side = 'w') {
  const key = side === 'w' ? 'white' : 'black';
  const rows = new Map();
  for (const s of sessions) {
    const label = s[key]?.label;
    if (!label) continue;
    const row = rows.get(label) ?? { label, spend: s[key].spend, plays: 0, wins: 0, losses: 0, draws: 0, abandoned: 0, plies: [] };
    row.plays += 1;
    if (s.result === 'win') row.wins += 1;
    else if (s.result === 'loss') row.losses += 1;
    else if (s.result === 'draw') row.draws += 1;
    else row.abandoned += 1;
    if (finished(s)) row.plies.push(s.plies ?? 0);
    rows.set(label, row);
  }
  return [...rows.values()]
    .map(({ plies, ...r }) => ({ ...r, winRate: rate(r.wins, r.wins + r.losses + r.draws), avgPlies: avg(plies) }))
    .sort((a, b) => b.plays - a.plays || a.label.localeCompare(b.label));
}

export function pieceStats(sessions, side = 'w') {
  const key = side === 'w' ? 'white' : 'black';
  const withArmy = sessions.filter((s) => s[key]?.army);
  return PIECE_TYPES.map((type) => ({
    type,
    avgCount: avg(withArmy.map((s) => s[key].army[type] ?? 0)) ?? 0,
    pickRate: withArmy.length ? withArmy.filter((s) => (s[key].army[type] ?? 0) > 0).length / withArmy.length : 0,
  }));
}

export function endReasons(sessions) {
  const out = {};
  for (const s of sessions) if (s.endReason) out[s.endReason] = (out[s.endReason] ?? 0) + 1;
  return out;
}

export function learningCurve(sessions) {
  const rows = new Map();
  for (const s of sessions.filter(finished)) {
    const a = s.attempt ?? 1;
    const row = rows.get(a) ?? { attempt: a, plays: 0, wins: 0 };
    row.plays += 1;
    if (s.result === 'win') row.wins += 1;
    rows.set(a, row);
  }
  return [...rows.values()].sort((a, b) => a.attempt - b.attempt).map((r) => ({ ...r, winRate: rate(r.wins, r.plays) }));
}

const CSV_COLUMNS = [
  ['id', (s) => s.id],
  ['playerId', (s) => s.playerId],
  ['startedAt', (s) => s.startedAt],
  ['mode', (s) => s.mode],
  ['levelId', (s) => s.levelId],
  ['opponent', (s) => s.opponent],
  ['aiPreset', (s) => s.aiPreset],
  ['balanceVersion', (s) => s.balanceVersion],
  ['budget', (s) => s.budget],
  ['attempt', (s) => s.attempt],
  ['reusedArmy', (s) => s.reusedArmy],
  ['battleShop', (s) => s.rules?.battleShop],
  ['captureBounty', (s) => s.rules?.captureBounty],
  ['whiteLabel', (s) => s.white?.label],
  ['whiteSpend', (s) => s.white?.spend],
  ['blackLabel', (s) => s.black?.label],
  ['blackSpend', (s) => s.black?.spend],
  ['whiteReserve', (s) => s.white?.reserve],
  ['blackReserve', (s) => s.black?.reserve],
  ['drops', (s) => s.drops?.map((d) => `${d.side}:${d.type}@${d.square}#${d.ply}`).join(' ')],
  ['result', (s) => s.result],
  ['winner', (s) => s.winner],
  ['endReason', (s) => s.endReason],
  ['plies', (s) => s.plies],
  ['buyMs', (s) => s.buyMs],
  ['battleMs', (s) => s.battleMs],
  ['phaseReached', (s) => s.phaseReached],
];

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const text = String(v);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV, one row per session. */
export function toCSV(sessions) {
  const lines = [CSV_COLUMNS.map(([name]) => name).join(',')];
  for (const s of sessions) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(s))).join(','));
  return lines.join('\r\n') + '\r\n';
}
