import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyArmy,
  armyCost,
  pieceCount,
  canBuy,
  buy,
  sell,
  affordableTypes,
  armyLabel,
  armyFromPlacement,
  armyFromLabel,
  enumerateArmies,
} from '../src/core/army.js';
import { PRICES, CAPS, LEVELS } from '../src/config.js';

test('emptyArmy has every buyable type at 0 and no king', () => {
  assert.deepEqual(emptyArmy(), { q: 0, r: 0, b: 0, n: 0, p: 0 });
  assert.notEqual(emptyArmy(), emptyArmy(), 'fresh object each call');
});

test('armyCost uses config prices; custom prices are honoured', () => {
  assert.equal(armyCost(emptyArmy()), 0);
  assert.equal(armyCost({ q: 1, r: 2, b: 2, n: 2, p: 8 }), 39);
  assert.equal(armyCost({ q: 0, r: 1, b: 1, n: 0, p: 3 }), PRICES.r + PRICES.b + 3 * PRICES.p);
  assert.equal(armyCost({ q: 1, r: 0, b: 0, n: 0, p: 0 }, { q: 4, r: 1, b: 1, n: 1, p: 1 }), 4);
});

test('pieceCount excludes the king', () => {
  assert.equal(pieceCount(emptyArmy()), 0);
  assert.equal(pieceCount({ q: 1, r: 2, b: 0, n: 1, p: 3 }), 7);
});

test('canBuy: ok when within cap and budget', () => {
  assert.deepEqual(canBuy(emptyArmy(), 'q', 9), { ok: true });
});

test('canBuy: budget reason when under cap but too expensive', () => {
  assert.deepEqual(canBuy(emptyArmy(), 'q', 8), { ok: false, reason: 'budget' });
  const army = { q: 0, r: 1, b: 1, n: 1, p: 0 }; // 11 spent
  assert.deepEqual(canBuy(army, 'p', 12), { ok: true });
  assert.deepEqual(canBuy(army, 'b', 12), { ok: false, reason: 'budget' });
});

test('canBuy: cap reason wins over budget when at the cap', () => {
  const army = { q: 1, r: 0, b: 0, n: 0, p: 0 };
  assert.deepEqual(canBuy(army, 'q', 100), { ok: false, reason: 'cap' });
  // At the cap AND over budget: cap is the more useful explanation.
  assert.deepEqual(canBuy(army, 'q', 9), { ok: false, reason: 'cap' });
  const pawns = { q: 0, r: 0, b: 0, n: 0, p: CAPS.p };
  assert.deepEqual(canBuy(pawns, 'p', 100), { ok: false, reason: 'cap' });
});

test('canBuy: unknown type (incl. the king) is rejected', () => {
  assert.deepEqual(canBuy(emptyArmy(), 'k', 100), { ok: false, reason: 'unknown-type' });
  assert.deepEqual(canBuy(emptyArmy(), 'x', 100), { ok: false, reason: 'unknown-type' });
});

test('canBuy: custom caps and prices', () => {
  assert.deepEqual(canBuy(emptyArmy(), 'q', 9, { caps: { ...CAPS, q: 0 } }), { ok: false, reason: 'cap' });
  assert.deepEqual(canBuy(emptyArmy(), 'q', 2, { prices: { ...PRICES, q: 2 } }), { ok: true });
});

test('buy/sell are immutable; sell throws at 0; buy does not check budget', () => {
  const a = emptyArmy();
  const b = buy(a, 'r');
  assert.deepEqual(a, emptyArmy());
  assert.equal(b.r, 1);
  const c = sell(b, 'r');
  assert.equal(b.r, 1);
  assert.equal(c.r, 0);
  assert.throws(() => sell(c, 'r'), /no rook/i);
  // buy ignores budget/caps (callers use canBuy)
  assert.equal(buy(buy({ q: 1, r: 0, b: 0, n: 0, p: 0 }, 'q'), 'q').q, 3);
  assert.throws(() => buy(a, 'k'), /unknown/i);
});

test('affordableTypes lists types in PIECE_TYPES order within budget and caps', () => {
  assert.deepEqual(affordableTypes(emptyArmy(), 20), ['q', 'r', 'b', 'n', 'p']);
  assert.deepEqual(affordableTypes(emptyArmy(), 4), ['b', 'n', 'p']);
  assert.deepEqual(affordableTypes({ q: 1, r: 2, b: 2, n: 2, p: 7 }, 100), ['p']);
  assert.deepEqual(affordableTypes({ q: 0, r: 0, b: 0, n: 0, p: 8 }, 8), []);
});

test('armyLabel canonical order and count prefixes', () => {
  assert.equal(armyLabel(emptyArmy()), 'King only');
  assert.equal(armyLabel({ q: 1, r: 2, b: 1, n: 1, p: 3 }), 'Q+2R+B+N+3P');
  assert.equal(armyLabel({ q: 0, r: 0, b: 0, n: 2, p: 1 }), '2N+P');
});

test('armyFromLabel parses labels, tolerates spaces, rejects junk', () => {
  assert.deepEqual(armyFromLabel('Q+2R+B+N+3P'), { q: 1, r: 2, b: 1, n: 1, p: 3 });
  assert.deepEqual(armyFromLabel('King only'), emptyArmy());
  assert.deepEqual(armyFromLabel(' 2r + p '), { q: 0, r: 2, b: 0, n: 0, p: 1 });
  assert.throws(() => armyFromLabel('Q+Z'), /army label/i);
  assert.throws(() => armyFromLabel('K'), /army label/i);
});

test('armyLabel / armyFromLabel round-trip over every army for budget 12', () => {
  const armies = enumerateArmies(12);
  assert.ok(armies.length > 50);
  for (const army of armies) {
    assert.deepEqual(armyFromLabel(armyLabel(army)), army, armyLabel(army));
  }
});

test('armyFromPlacement counts pieces and ignores the king', () => {
  assert.deepEqual(armyFromPlacement(LEVELS[0].enemy), { q: 0, r: 1, b: 1, n: 0, p: 3 });
  assert.deepEqual(armyFromPlacement([]), emptyArmy());
});

test('enumerateArmies respects budget, caps and minSpend; deterministic; unique', () => {
  const all = enumerateArmies(12);
  const labels = new Set(all.map(armyLabel));
  assert.equal(labels.size, all.length, 'no duplicates');
  for (const a of all) {
    assert.ok(armyCost(a) <= 12);
    for (const t of Object.keys(CAPS)) assert.ok(a[t] <= CAPS[t]);
  }
  assert.ok(labels.has('King only'));
  assert.ok(labels.has('Q+3P'));
  assert.ok(labels.has('2R+2P'));
  assert.deepEqual(enumerateArmies(12), all, 'deterministic');

  const rich = enumerateArmies(12, { minSpend: 11 });
  assert.ok(rich.length > 0);
  for (const a of rich) assert.ok(armyCost(a) >= 11 && armyCost(a) <= 12);

  assert.deepEqual(enumerateArmies(0), [emptyArmy()]);
  // budget 1 → king only, or one pawn
  assert.deepEqual(enumerateArmies(1).map(armyLabel).sort(), ['King only', 'P']);
  // full budget contains the full standard set exactly once
  assert.equal(enumerateArmies(39, { minSpend: 39 }).length, 1);
});
