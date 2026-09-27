import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeStart, kingOnly, levelStart } from '../src/core/start.js';
import { validateMatch, buildFen } from '../src/core/placement.js';
import { Match } from '../src/core/game.js';
import { LEVELS } from '../src/config.js';

test('level start: lone white king with the level gold vs the garrison; legal position', () => {
  const s = levelStart(LEVELS[0]);
  assert.deepEqual(s.white.placement, kingOnly('w'));
  assert.equal(s.white.reserve, LEVELS[0].gold);
  assert.equal(s.black.reserve, LEVELS[0].enemyGold);
  assert.ok(LEVELS[0].enemyGold > 0, 'the garrison has a purse too');
  assert.equal(s.black.army.r, 1);
  assert.ok(validateMatch(s.white.placement, s.black.placement).ok);
  const m = new Match({ startFen: buildFen(s.white.placement, s.black.placement), reserve: { w: s.white.reserve, b: s.black.reserve } });
  assert.deepEqual(m.droppableTypes(), ['q', 'r', 'b', 'n', 'p'].filter((t) => ({ q: 9, r: 5, b: 3, n: 3, p: 1 })[t] <= LEVELS[0].gold));
});

test('free start: two kings, equal purses; not a draw by insufficient material', () => {
  const s = freeStart(20);
  assert.ok(validateMatch(s.white.placement, s.black.placement).ok);
  const m = new Match({ startFen: buildFen(s.white.placement, s.black.placement), reserve: { w: 20, b: 20 } });
  assert.equal(m.status().over, false);
});

test('level start: enemyGold defaults to 0 when a level omits it', () => {
  const { enemyGold, ...level } = LEVELS[0];
  assert.equal(levelStart(level).black.reserve, 0);
});
