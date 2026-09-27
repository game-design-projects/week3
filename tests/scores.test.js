// Leaderboard rules (src/core/scores.js): replay validation, scoring, nicknames, order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE_VERSION, LEVELS } from '../src/config.js';
import { Match } from '../src/core/game.js';
import { cleanNickname, compareScores, isBetterScore, isBlockedNickname, MAX_PLIES, officialStart, replaySubmission } from '../src/core/scores.js';
import { buildSubmission } from '../src/leaderboard.js';
import { NOT_OVER, WIN_17, WIN_51, WIN_7, WIN_9 } from './fixtures/l1-games.js';

const L1 = LEVELS[0];

function sub(moves, overrides = {}) {
  const { startFen, reserve } = officialStart(L1);
  return { levelId: 'L1', balanceVersion: BALANCE_VERSION, aiPreset: 'normal', startFen, reserve, rules: { captureBounty: true }, moves, ...overrides };
}

test('fixtures: every WIN_* line really is a White checkmate from the official L1 start', () => {
  for (const line of [WIN_7, WIN_9, WIN_17, WIN_51]) {
    const { startFen, reserve } = officialStart(L1);
    const m = new Match({ startFen, reserve });
    for (const mv of line) {
      const drop = /^([QRBNP])@(..)$/.exec(mv);
      if (drop) m.drop(drop[1].toLowerCase(), drop[2]);
      else m.move(mv);
    }
    assert.deepEqual([m.status().reason, m.status().winner], ['checkmate', 'w'], line.join(' '));
  }
});

test('officialStart: the L1 FEN and purses the game itself starts from', () => {
  const s = officialStart(L1);
  assert.equal(s.startFen, '3r2k1/4bppp/8/8/8/8/8/4K3 w - - 0 1');
  assert.deepEqual(s.reserve, { w: L1.gold, b: L1.enemyGold });
});

test('replaySubmission: a real mate is scored from the replay (plies, moves, gold left/spent, PGN)', () => {
  const r = replaySubmission(sub(WIN_7));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.plies, 7);
  assert.equal(r.moves, 4);
  assert.equal(r.goldLeft, 3); // 16 − Q 9 − R 5 + pawn bounty 1
  assert.equal(r.goldSpent, 14);
  assert.match(r.pgn, /Qh7# 1-0$/);
  assert.equal(replaySubmission(sub(WIN_17)).goldLeft, 1);
});

test('replaySubmission: ignores any score the client claims', () => {
  const r = replaySubmission(sub(WIN_9, { plies: 1, goldLeft: 999, moves: WIN_9 }));
  assert.equal(r.plies, 9);
  assert.equal(r.goldLeft, 3);
});

test('replaySubmission: rejects illegal moves and drops, unreadable moves, and moves after the mate', () => {
  const cases = [
    ['e1e3', ...WIN_7.slice(1)], // king two squares
    ['Q@c5', ...WIN_7.slice(1)], // out of the drop zone
    ['Q@c2', 'B@e8', 'Q@d1', ...WIN_7.slice(3)], // second queen: over the cap (and budget)
    ['Q@c2', 'K@e7'], // kings are not for sale
    ['xyz'],
    [42],
    [...WIN_7, 'g8h8'], // the game is already over
  ];
  for (const moves of cases) {
    const r = replaySubmission(sub(moves));
    assert.equal(r.ok, false, JSON.stringify(moves));
    assert.equal(r.code, 'illegal-move', JSON.stringify(moves));
    assert.equal(r.status, 422);
  }
});

test('replaySubmission: rejects a game that is not White’s checkmate', () => {
  const r = replaySubmission(sub(NOT_OVER));
  assert.equal(r.code, 'not-a-win');
});

test('replaySubmission: rejects a tampered start, purse, level, balance, AI or house rules', () => {
  const { startFen } = officialStart(L1);
  const expect = (s, code) => assert.equal(replaySubmission(s).code, code, JSON.stringify(s).slice(0, 120));
  expect(sub(WIN_7, { startFen: startFen.replace('3r2k1', '6k1') }), 'bad-start'); // no enemy rook
  expect(sub(WIN_7, { reserve: { w: 99, b: 5 } }), 'bad-start');
  expect(sub(WIN_7, { reserve: { w: 16, b: 0 } }), 'bad-start');
  expect(sub(WIN_7, { reserve: undefined }), 'bad-start');
  expect(sub(WIN_7, { levelId: 'L9' }), 'bad-level');
  expect(sub(WIN_7, { balanceVersion: 'b4' }), 'stale-balance');
  expect(sub(WIN_7, { aiPreset: 'godlike' }), 'bad-ai');
  expect(sub(WIN_7, { aiPreset: 'toString' }), 'bad-ai');
  expect(sub(WIN_7, { rules: { captureBounty: false } }), 'house-rules');
  expect(sub(WIN_7, { rules: undefined }), 'house-rules');
});

test('replaySubmission: rejects empty and over-long move lists before replaying', () => {
  assert.equal(replaySubmission(sub([])).code, 'no-moves');
  assert.equal(replaySubmission(sub('e2e4')).code, 'no-moves');
  const long = replaySubmission(sub(Array(MAX_PLIES + 1).fill('e1e2')));
  assert.equal(long.code, 'too-long');
  assert.equal(replaySubmission(null).status, 400);
});

test('replaySubmission: the long 51-ply game replays quickly (Worker CPU budget)', () => {
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) assert.equal(replaySubmission(sub(WIN_51)).ok, true);
  const perGame = (performance.now() - t0) / 5;
  assert.ok(perGame < 100, `replay took ${perGame.toFixed(1)} ms`);
});

test('buildSubmission: from a live Match with drops, sends the ORIGINAL start and the full list, and it replays', () => {
  const { startFen, reserve } = officialStart(L1);
  const m = new Match({ startFen, reserve });
  for (const mv of WIN_9) {
    const drop = /^([QRBNP])@(..)$/.exec(mv);
    if (drop) m.drop(drop[1].toLowerCase(), drop[2]);
    else m.move(mv);
  }
  assert.notEqual(m.segmentFen, startFen, 'drops rebased chess.js');
  const s = buildSubmission({ match: m, reserve, levelId: 'L1', aiPreset: 'hard', rules: { captureBounty: true }, playerId: 'p_0123456789abcdef', nickname: 'Ada' });
  assert.equal(s.startFen, startFen);
  assert.deepEqual(s.reserve, reserve);
  assert.deepEqual(s.moves, WIN_9);
  assert.equal(s.balanceVersion, BALANCE_VERSION);
  const r = replaySubmission(JSON.parse(JSON.stringify(s)));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.aiPreset, 'hard');
});

test('cleanNickname: trims, collapses whitespace, allows any script', () => {
  assert.deepEqual(cleanNickname('  Ada   Lovelace '), { ok: true, nickname: 'Ada Lovelace' });
  assert.equal(cleanNickname('棋手小王').nickname, '棋手小王');
  assert.equal(cleanNickname('Łukasz_99').nickname, 'Łukasz_99');
  assert.equal(cleanNickname('knight-rider').ok, true);
  assert.equal(cleanNickname('abc').ok, true);
  assert.equal(cleanNickname('a'.repeat(16)).ok, true);
});

test('cleanNickname: rejects length, symbols, HTML and non-strings', () => {
  for (const bad of ['ab', '  a  ', 'a'.repeat(17), '<b>bold</b>', 'Bob<script>', 'a&b c', 'rock "n" roll', 'emoji🙂ok', 'zero​width', '___', '---', '', null, 42, undefined]) {
    const r = cleanNickname(bad);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.code, 'bad-nickname');
  }
});

test('nickname blocklist: catches obvious profanity (incl. leetspeak), not innocent words', () => {
  for (const bad of ['fuck you', 'Sh1tHead', 'big_b1tch', 'ass', 'the-nazi', 'n1gger']) assert.equal(isBlockedNickname(bad), true, bad);
  for (const ok of ['Cassandra', 'grape', 'peacock', 'Scunthorpe fan', 'class act', 'Dickens']) assert.equal(isBlockedNickname(ok), false, ok);
  assert.equal(cleanNickname('fuck you').ok, false);
});

test('compareScores / isBetterScore: fewer plies, then more gold, then earlier', () => {
  const rows = [
    { id: 'd', plies: 9, goldLeft: 5, createdAt: '2026-01-01' },
    { id: 'c', plies: 7, goldLeft: 1, createdAt: '2026-01-01' },
    { id: 'b', plies: 7, goldLeft: 3, createdAt: '2026-01-05' },
    { id: 'a', plies: 7, goldLeft: 3, createdAt: '2026-01-02' },
  ];
  assert.deepEqual([...rows].sort(compareScores).map((r) => r.id), ['a', 'b', 'c', 'd']);
  assert.equal(isBetterScore({ plies: 7, goldLeft: 0 }, { plies: 9, goldLeft: 9 }), true);
  assert.equal(isBetterScore({ plies: 7, goldLeft: 4 }, { plies: 7, goldLeft: 3 }), true);
  assert.equal(isBetterScore({ plies: 7, goldLeft: 3 }, { plies: 7, goldLeft: 3 }), false, 'a tie is not an improvement');
  assert.equal(isBetterScore({ plies: 9, goldLeft: 9 }, { plies: 7, goldLeft: 0 }), false);
});
