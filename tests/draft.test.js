import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDraft, draftBuy, draftPass, draftOptions, isDraftDone } from '../src/core/draft.js';
import { chooseDraftPick } from '../src/core/draftAI.js';
import { armyCost } from '../src/core/army.js';
import { CAPS } from '../src/config.js';
import { createRng } from '../src/lib/rng.js';

test('draft: black first by default, alternates, immutable', () => {
  const s0 = createDraft({ budget: 12 });
  assert.equal(s0.turn, 'b');
  const s1 = draftBuy(s0, 'r');
  assert.equal(s0.armies.b.r, 0);
  assert.equal(s1.armies.b.r, 1);
  assert.equal(s1.spent.b, 5);
  assert.equal(s1.turn, 'w');
  assert.throws(() => draftBuy(s1, 'q') && draftBuy(draftBuy(s1, 'q'), 'q'), /cannot buy/);
});

test('draft: pass locks a side; the other keeps picking; done when both passed', () => {
  let s = createDraft({ budget: 8, first: 'w' });
  s = draftPass(s); // white passes
  assert.equal(s.turn, 'b');
  s = draftBuy(s, 'r');
  assert.equal(s.turn, 'b', 'white locked, black keeps the turn');
  s = draftBuy(s, 'b');
  // 8 spent → black has nothing affordable → auto-pass → done
  assert.equal(isDraftDone(s), true);
  assert.equal(s.turn, null);
  assert.deepEqual(s.log.at(-1), { side: 'b', action: 'pass', auto: true });
  assert.throws(() => draftPass(s), /over/);
});

test('draft: budget 0 is done immediately', () => {
  const s = createDraft({ budget: 0 });
  assert.equal(s.done, true);
  assert.equal(s.log.length, 2);
});

test('draftAI: AI vs AI drafts always terminate within budget + caps, with mating material when affordable', () => {
  for (const budget of [8, 12, 20, 39]) {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = createRng(seed * 31 + budget);
      let s = createDraft({ budget });
      for (let guard = 0; !s.done; guard++) {
        assert.ok(guard < 100);
        const pick = chooseDraftPick(s, s.turn, rng);
        s = pick === 'pass' ? draftPass(s) : draftBuy(s, pick);
      }
      for (const side of ['w', 'b']) {
        const a = s.armies[side];
        assert.ok(armyCost(a) <= budget);
        for (const t of Object.keys(CAPS)) assert.ok(a[t] <= CAPS[t]);
        assert.ok(a.q + a.r > 0 || a.b + a.n >= 2, `budget ${budget} seed ${seed}: ${JSON.stringify(a)}`);
        assert.equal(draftOptions(s, side).length, 0);
      }
    }
  }
});

test('draftAI: different seeds give some variety', () => {
  const labels = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const rng = createRng(seed);
    let s = createDraft({ budget: 20 });
    while (!s.done) {
      const pick = chooseDraftPick(s, s.turn, rng);
      s = pick === 'pass' ? draftPass(s) : draftBuy(s, pick);
    }
    labels.add(JSON.stringify(s.armies.b));
  }
  assert.ok(labels.size >= 3, `only ${labels.size} distinct armies`);
});
