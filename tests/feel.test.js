import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEEL, MATE_VALUE, PRICES } from '../src/config.js';
import {
  coinPlan,
  hitStopMs,
  landMotion,
  moveMotion,
  nearestTarget,
  nextTilt,
  pieceValue,
  resolveFeel,
  shakeFor,
  shakeKeyframes,
} from '../src/ui/feel.js';

const parseT = (tf) => {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(tf);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
};

test('resolveFeel: the setting, overridden by Animations off and reduced motion; junk → full', () => {
  assert.equal(resolveFeel({ effects: 'full', animations: true }), 'full');
  assert.equal(resolveFeel({ effects: 'subtle', animations: true }), 'subtle');
  assert.equal(resolveFeel({ effects: 'off', animations: true }), 'off');
  assert.equal(resolveFeel({ effects: 'full', animations: false }), 'off');
  assert.equal(resolveFeel({ effects: 'full', animations: true }, true), 'off');
  assert.equal(resolveFeel({ effects: 'loud', animations: true }), 'full');
  assert.equal(resolveFeel(undefined), 'full');
});

test('pieceValue: price for pieces, MATE_VALUE for the king', () => {
  assert.equal(pieceValue('p'), PRICES.p);
  assert.equal(pieceValue('q'), PRICES.q);
  assert.equal(pieceValue('k'), MATE_VALUE);
  assert.equal(pieceValue(undefined), 0);
});

test('shakeFor: grows with the captured piece value, capped; subtle is smaller and flat; off/zero → none', () => {
  const pawn = shakeFor(PRICES.p, 'full');
  const rook = shakeFor(PRICES.r, 'full');
  const queen = shakeFor(PRICES.q, 'full');
  const mate = shakeFor(MATE_VALUE, 'full');
  assert.ok(pawn.px < rook.px && rook.px < queen.px, 'bigger piece, bigger shake');
  assert.ok(pawn.ms < queen.ms, 'bigger piece, longer shake');
  assert.ok(mate.px <= FEEL.shake.maxPx, 'never leaves the 16px gutter');
  assert.ok(queen.rot > 0);
  const subtle = shakeFor(PRICES.q, 'subtle');
  assert.ok(subtle.px < queen.px);
  assert.equal(subtle.rot, 0, 'subtle does not rotate the page');
  assert.equal(shakeFor(PRICES.q, 'off'), null);
  assert.equal(shakeFor(0, 'full'), null);
});

test('shakeKeyframes: decays to rest and stays inside the amplitude', () => {
  const s = shakeFor(PRICES.q, 'full');
  let i = 0;
  const rand = () => [0.9, 0.1, 0.7, 0.3][i++ % 4];
  const frames = shakeKeyframes(s, rand);
  assert.ok(frames.length >= 4);
  assert.equal(frames.at(-1).transform, 'translate(0px, 0px) rotate(0deg)');
  for (const f of frames) {
    const t = parseT(f.transform);
    assert.ok(Math.abs(t.x) <= s.px + 1e-9 && Math.abs(t.y) <= s.px + 1e-9);
  }
  const first = parseT(frames[0].transform);
  const late = parseT(frames.at(-2).transform);
  assert.ok(Math.hypot(late.x, late.y) < Math.hypot(first.x, first.y), 'amplitude decays');
});

test('hitStopMs: only heavy captures and mate, only at full', () => {
  assert.equal(hitStopMs(PRICES.p, false, 'full'), 0);
  assert.equal(hitStopMs(PRICES.r, false, 'full'), FEEL.hitStop.captureMs);
  assert.equal(hitStopMs(0, true, 'full'), FEEL.hitStop.mateMs);
  assert.equal(hitStopMs(PRICES.q, true, 'subtle'), 0);
  assert.equal(hitStopMs(PRICES.q, false, 'off'), 0);
});

test('moveMotion full: pulls back first, overshoots the target, holds for hit-stop, squashes, ends at rest', () => {
  // piece travels 3 squares to the right: it starts at dx = -300 relative to its new square
  const m = moveMotion({ dx: -300, dy: 0, squarePx: 100, level: 'full', hitStop: 70 });
  const frames = m.keyframes;
  const xs = frames.map((f) => parseT(f.transform).x);
  assert.equal(xs[0], -300);
  assert.ok(xs[1] < -300, 'anticipation: pulls back away from the target');
  assert.ok(Math.max(...xs) > 0, 'follow-through: overshoots past the target');
  assert.equal(xs.at(-1), 0);
  assert.equal(frames.at(-1).transform.includes('scale(1, 1)'), true, 'settles to scale 1');
  assert.ok(frames.some((f) => /scale\(1\.\d+, 0\.\d+\)/.test(f.transform)), 'landing squash');
  assert.ok(m.impactAt > 0 && m.impactAt < m.duration);
  const noStop = moveMotion({ dx: -300, dy: 0, squarePx: 100, level: 'full', hitStop: 0 });
  assert.equal(m.duration - noStop.duration, 70, 'hit-stop lengthens the move by exactly its hold');
  for (const f of frames) assert.ok(f.offset === undefined || (f.offset >= 0 && f.offset <= 1));
  const offs = frames.map((f) => f.offset).filter((o) => o !== undefined);
  assert.deepEqual(offs, [...offs].sort((a, b) => a - b), 'offsets ascend');
});

test('moveMotion: longer moves take longer (capped); subtle has no anticipation; off is null; dragged is a landing only', () => {
  const one = moveMotion({ dx: 0, dy: 100, squarePx: 100, level: 'full' });
  const seven = moveMotion({ dx: 0, dy: 700, squarePx: 100, level: 'full' });
  assert.ok(one.duration < seven.duration);
  assert.ok(seven.duration <= FEEL.move.maxMs + FEEL.move.settleMs);
  const subtle = moveMotion({ dx: -300, dy: 0, squarePx: 100, level: 'subtle' });
  const xs = subtle.keyframes.map((f) => parseT(f.transform).x);
  assert.ok(xs.every((x) => x >= -300 && x <= 0), 'no pull-back or overshoot when subtle');
  assert.equal(moveMotion({ dx: -300, dy: 0, squarePx: 100, level: 'off' }), null);
  const dragged = moveMotion({ dx: -300, dy: 0, squarePx: 100, level: 'full', dragged: true });
  assert.ok(dragged.keyframes.every((f) => parseT(f.transform).x === 0), 'a dropped piece does not fly back from its origin');
});

test('landMotion: a stamp from above that squashes on impact; dragged is quicker; off is null', () => {
  const stamp = landMotion({ level: 'full' });
  assert.ok(stamp.impactAt > 0 && stamp.impactAt < stamp.duration);
  assert.ok(stamp.keyframes.some((f) => /scale\(1\.\d+, 0\.\d+\)/.test(f.transform)), 'squash on impact');
  const drag = landMotion({ level: 'full', dragged: true });
  assert.ok(drag.duration < stamp.duration && drag.impactAt < stamp.impactAt);
  assert.equal(landMotion({ level: 'off' }), null);
});

test('coinPlan: one coin per gold up to the cap; values sum to the amount; staggered; subtle caps lower; off → none', () => {
  const four = coinPlan(4, 'full');
  assert.equal(four.length, 4);
  assert.deepEqual(four.map((c) => c.value), [1, 1, 1, 1]);
  assert.deepEqual(four.map((c) => c.delay), [0, 1, 2, 3].map((i) => i * FEEL.coins.staggerMs));
  const big = coinPlan(20, 'full');
  assert.equal(big.length, FEEL.coins.max);
  assert.equal(big.reduce((s, c) => s + c.value, 0), 20);
  const subtle = coinPlan(9, 'subtle');
  assert.equal(subtle.length, FEEL.subtle.maxCoins);
  assert.deepEqual(subtle.map((c) => c.value), [3, 3, 3]);
  assert.equal(coinPlan(5, 'subtle').reduce((s, c) => s + c.value, 0), 5);
  assert.deepEqual(coinPlan(3, 'off'), []);
  assert.deepEqual(coinPlan(0, 'full'), []);
});

test('nextTilt: follows horizontal pointer speed, smoothed and clamped; flat unless full', () => {
  const t1 = nextTilt(0, 10, 'full');
  assert.ok(t1 > 0 && t1 < 10 * FEEL.drag.tiltPerPx, 'smoothed toward the target');
  let t = 0;
  for (let i = 0; i < 50; i++) t = nextTilt(t, 200, 'full');
  assert.ok(Math.abs(t - FEEL.drag.maxTiltDeg) < 0.01, 'clamped');
  assert.ok(nextTilt(0, -10, 'full') < 0);
  assert.equal(nextTilt(5, 50, 'subtle'), 0);
  assert.equal(nextTilt(5, 50, 'off'), 0);
});

test('nearestTarget: inside a legal square wins; a near miss off the edge snaps; far away → null', () => {
  const rect = (square, left, top) => ({ square, left, top, right: left + 100, bottom: top + 100 });
  const rects = [rect('a1', 0, 700), rect('b1', 100, 700), rect('a2', 0, 600)];
  assert.equal(nearestTarget({ x: 150, y: 750 }, rects, 60), 'b1');
  assert.equal(nearestTarget({ x: 130, y: 840 }, rects, 60), 'b1', '40px below the board edge snaps up');
  assert.equal(nearestTarget({ x: 130, y: 900 }, rects, 60), null, 'too far');
  assert.equal(nearestTarget({ x: 50, y: 5 }, rects, 60), null);
  assert.equal(nearestTarget({ x: 10, y: 810 }, [], 60), null);
});
