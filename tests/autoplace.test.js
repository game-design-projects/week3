import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoPlace, addPieceAuto } from '../src/core/autoplace.js';
import { enumerateArmies, armyFromPlacement, armyLabel } from '../src/core/army.js';
import { validateMatch, validateSide, pieceAt } from '../src/core/placement.js';
import { createRng } from '../src/lib/rng.js';
import { LEVELS } from '../src/config.js';

const ENEMY = LEVELS[0].enemy;

test('autoPlace: every Level 1 army x seeds is valid against the enemy', () => {
  for (const army of enumerateArmies(12)) {
    for (let seed = 1; seed <= 6; seed++) {
      const pl = autoPlace('w', army, { rng: createRng(seed), opponent: ENEMY });
      assert.ok(validateMatch(pl, ENEMY).ok, `${armyLabel(army)} seed ${seed}`);
      assert.deepEqual(armyFromPlacement(pl), army);
    }
  }
});

test('autoPlace: full 39-gold armies for both sides, black placed after white', () => {
  const full = { q: 1, r: 2, b: 2, n: 2, p: 8 };
  for (let seed = 1; seed <= 10; seed++) {
    const w = autoPlace('w', full, { rng: createRng(seed) });
    const b = autoPlace('b', full, { rng: createRng(seed + 99), opponent: w });
    assert.ok(validateMatch(w, b).ok);
  }
});

test('autoPlace: deterministic for a seed; bishops on opposite colours', () => {
  const army = { q: 0, r: 0, b: 2, n: 0, p: 2 };
  const a = autoPlace('w', army, { rng: createRng(7) });
  assert.deepEqual(autoPlace('w', army, { rng: createRng(7) }), a);
  const [b1, b2] = a.filter((p) => p.type === 'b').map((p) => p.square);
  const dark = (sq) => ('abcdefgh'.indexOf(sq[0]) + Number(sq[1])) % 2 === 0;
  assert.notEqual(dark(b1), dark(b2));
});

test('addPieceAuto: places on a legal square, null when rank 2 is full for a pawn', () => {
  let pl = [{ type: 'k', square: 'e1' }];
  pl = addPieceAuto('w', pl, 'r', { opponent: ENEMY });
  assert.ok(validateSide('w', pl).ok);
  assert.equal(pl.length, 2);
  const full = [{ type: 'k', square: 'e1' }, ...'abcdefgh'.split('').map((f) => ({ type: 'p', square: `${f}2` }))];
  assert.equal(addPieceAuto('w', full, 'p'), null);
  assert.ok(addPieceAuto('w', full, 'n'));
});

test('addPieceAuto: never creates a starting check (rook vs Kg8 behind no pawns)', () => {
  const enemy = [{ type: 'k', square: 'e8' }];
  let pl = [{ type: 'k', square: 'a1' }];
  for (let i = 0; i < 2; i++) pl = addPieceAuto('w', pl, 'r', { opponent: enemy });
  assert.ok(validateMatch(pl, enemy).ok);
  assert.equal(pieceAt(pl, 'e1'), null);
});
