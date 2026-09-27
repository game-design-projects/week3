import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/telemetry/store.js';
import { createRecorder } from '../src/telemetry/session.js';
import { summarize, byArmy, pieceStats, endReasons, learningCurve, filterSessions, toCSV } from '../src/telemetry/stats.js';
import { LEVELS } from '../src/config.js';

function setup() {
  let t = Date.UTC(2026, 8, 26, 12, 0, 0);
  const clock = { now: () => t, tick: (ms) => (t += ms) };
  const store = createStore({ storage: null });
  const rec = createRecorder({ store, now: clock.now });
  return { store, rec, clock };
}
const WHITE = { army: { q: 0, r: 1, b: 1, n: 1, p: 1 }, placement: [{ type: 'k', square: 'e1' }] };
const BLACK = { army: { q: 0, r: 1, b: 1, n: 0, p: 3 }, placement: LEVELS[0].enemy };

function playLevel(rec, clock, winner, reason) {
  rec.begin({ mode: 'level', levelId: 'L1', opponent: 'ai', aiPreset: 'normal', budget: 12, playerSide: 'w' });
  rec.purchase('w', 'buy', 'r');
  clock.tick(30000);
  rec.startBattle({ white: WHITE, black: BLACK, startFen: 'fen0' });
  clock.tick(5000);
  rec.ply({ san: 'e4', materialDiff: 1 });
  rec.ply({ san: 'e5', materialDiff: 1 });
  clock.tick(5000);
  return rec.end({ winner, reason, pgn: '1. e4 e5', finalFen: 'fen1' });
}

test('recorder: full lifecycle produces a valid saved session', () => {
  const { store, rec, clock } = setup();
  const s = playLevel(rec, clock, 'w', 'checkmate');
  assert.equal(store.sessions().length, 1);
  const saved = store.sessions()[0];
  assert.equal(saved.id, s.id);
  assert.equal(saved.result, 'win');
  assert.equal(saved.winner, 'w');
  assert.equal(saved.endReason, 'checkmate');
  assert.equal(saved.buyMs, 30000);
  assert.equal(saved.battleMs, 10000);
  assert.equal(saved.totalMs, 40000);
  assert.equal(saved.plies, 2);
  assert.deepEqual(saved.materialTimeline, [1, 1]);
  assert.equal(saved.white.label, 'R+B+N+P');
  assert.equal(saved.white.spend, 12);
  assert.equal(saved.black.label, 'R+B+3P');
  assert.equal(saved.phaseReached, 'done');
  assert.equal(saved.attempt, 1);
  assert.equal(saved.purchases[0].type, 'r');
  assert.equal(rec.active(), null);
});

test('recorder: attempts count up (incl. abandoned); begin while active abandons; abandon no-op', () => {
  const { store, rec, clock } = setup();
  assert.equal(rec.abandon(), null);
  playLevel(rec, clock, 'b', 'checkmate');
  rec.begin({ mode: 'level', levelId: 'L1', budget: 12 });
  rec.begin({ mode: 'level', levelId: 'L1', budget: 12 }); // abandons the previous
  assert.equal(store.sessions().at(-1).result, 'abandoned');
  assert.equal(store.sessions().at(-1).phaseReached, 'buy');
  const last = playLevel(rec, clock, null, 'stalemate');
  assert.equal(last.attempt, 4);
  assert.equal(last.result, 'draw');
  assert.deepEqual(store.sessions().map((s) => s.attempt), [1, 2, 3, 4]);
});

test('recorder: hotseat result is from White’s view; free mode keeps the draft log', () => {
  const { store, rec } = setup();
  rec.begin({ mode: 'free', opponent: 'hotseat', budget: 20, playerSide: null });
  rec.draftStep({ side: 'b', action: 'buy', type: 'q' });
  rec.startBattle({ white: WHITE, black: BLACK, startFen: 'f' });
  rec.end({ winner: 'b', reason: 'resign', pgn: '', finalFen: 'f' });
  const s = store.sessions()[0];
  assert.equal(s.result, 'loss');
  assert.deepEqual(s.draft, [{ side: 'b', action: 'buy', type: 'q' }]);
});

test('recorder: records the game-feel level the session was played at (null when not given)', () => {
  const { store, rec } = setup();
  rec.begin({ mode: 'level', levelId: 'L1', budget: 12, feel: { effects: 'subtle', effective: 'off', sound: true } });
  rec.end({ winner: 'w', reason: 'checkmate', pgn: '', finalFen: 'f' });
  rec.begin({ mode: 'level', levelId: 'L1', budget: 12 });
  rec.abandon();
  const [a, b] = store.sessions();
  assert.deepEqual(a.feel, { effects: 'subtle', effective: 'off', sound: true });
  assert.equal(b.feel, null);
});

test('stats: summarize / byArmy / pieceStats / endReasons / learningCurve / filter', () => {
  const { store, rec, clock } = setup();
  playLevel(rec, clock, 'b', 'checkmate');
  playLevel(rec, clock, 'w', 'checkmate');
  playLevel(rec, clock, 'w', 'resign');
  rec.begin({ mode: 'free', budget: 20 });
  rec.abandon();
  const all = store.sessions();
  const sum = summarize(all);
  assert.equal(sum.sessions, 4);
  assert.equal(sum.finished, 3);
  assert.equal(sum.wins, 2);
  assert.equal(sum.abandoned, 1);
  assert.equal(sum.winRate, 2 / 3);
  assert.equal(sum.avgPlies, 2);
  // b4 rules: the balance view keys on what was BOUGHT during the battle (nothing here).
  const rows = byArmy(all);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].label, rows[0].plays, rows[0].wins, rows[0].losses], ['King only', 3, 2, 1]);
  assert.equal(pieceStats(all).find((p) => p.type === 'r').pickRate, 0);
  // Older sessions without a bought label fall back to the pre-battle army.
  const legacy = all.map((s) => ({ ...s, white: s.white && { ...s.white, bought: undefined } }));
  assert.equal(byArmy(legacy)[0].label, 'R+B+N+P');
  assert.equal(pieceStats(legacy).find((p) => p.type === 'r').pickRate, 1);
  assert.deepEqual(endReasons(all), { checkmate: 2, resign: 1, abandoned: 1 });
  assert.deepEqual(learningCurve(all).map((r) => [r.attempt, r.winRate]), [[1, 0], [2, 1], [3, 1]]);
  assert.equal(filterSessions(all, { mode: 'level', levelId: 'L1' }).length, 3);
  assert.equal(summarize([]).winRate, null);
});

test('recorder: reserve carried into battle and drops are recorded as plies', () => {
  const { store, rec } = setup();
  rec.begin({ mode: 'level', levelId: 'L1', budget: 12, playerSide: 'w' });
  rec.startBattle({ white: { ...WHITE, army: { q: 0, r: 1, b: 0, n: 0, p: 0 }, reserve: 7 }, black: BLACK, startFen: 'f' });
  rec.ply({ san: 'e4', materialDiff: -6 });
  rec.ply({ san: 'e5', materialDiff: -6 });
  rec.drop({ side: 'w', type: 'n', square: 'b1', cost: 3, san: 'N@b1', materialDiff: -3 });
  rec.end({ winner: 'b', reason: 'checkmate', pgn: '', finalFen: 'f' });
  const s = store.sessions()[0];
  assert.equal(s.white.reserve, 7);
  assert.equal(s.black.reserve, 0);
  assert.equal(s.plies, 3);
  assert.deepEqual(s.drops, [{ ply: 3, side: 'w', type: 'n', square: 'b1', cost: 3 }]);
  assert.equal(s.white.bought, 'N');
  assert.equal(s.white.boughtSpend, 3);
  assert.equal(s.black.bought, 'King only');
  assert.equal(byArmy([s])[0].label, 'N');
  assert.equal(pieceStats([s]).find((p) => p.type === 'n').pickRate, 1);
  assert.equal(s.purchases.at(-1).action, 'drop');
  assert.match(toCSV([s]), /w:n@b1#3/);
});

test('stats: toCSV escapes quotes, commas and newlines', () => {
  const csv = toCSV([{ id: 'a,"b"\nc', mode: 'level', white: { label: 'Q+3P', spend: 12 } }]);
  const [header, row] = csv.split('\r\n');
  assert.match(header, /^id,playerId,startedAt,mode/);
  assert.ok(row.startsWith('"a,""b""\nc"') || csv.includes('"a,""b""\nc"'));
  assert.ok(csv.includes('Q+3P,,,12'), csv);
});
