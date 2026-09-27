import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOUND_NAMES, recipe } from '../src/ui/sound.js';

const tone = (voices) => voices.filter((v) => v.wave !== 'noise');
const lowest = (voices) => Math.min(...tone(voices).map((v) => v.f2 ?? v.f));
const length = (voices) => Math.max(...voices.map((v) => v.t + v.d));
const loudest = (voices) => Math.max(...voices.map((v) => v.g));

test('sound recipes: every named effect is a list of sane voices; unknown names are silent', () => {
  for (const name of SOUND_NAMES) {
    const voices = recipe(name, { value: 3, index: 2 });
    assert.ok(voices.length > 0, name);
    for (const v of voices) {
      assert.ok(['sine', 'triangle', 'square', 'sawtooth', 'noise'].includes(v.wave), `${name} wave`);
      assert.ok(v.t >= 0 && v.d > 0 && v.g > 0 && v.g <= 1, `${name} timing/gain`);
      if (v.wave !== 'noise') assert.ok(v.f > 20 && v.f < 12000, `${name} freq`);
    }
  }
  assert.deepEqual(recipe('nope'), []);
});

test('sound recipes: a capture sounds heavier the more the piece was worth', () => {
  const pawn = recipe('capture', { value: 1 });
  const queen = recipe('capture', { value: 9 });
  assert.ok(lowest(queen) < lowest(pawn), 'lower thud');
  assert.ok(length(queen) > length(pawn), 'longer');
  assert.ok(loudest(queen) > loudest(pawn), 'louder');
});

test('sound recipes: coins counted out climb in pitch, then stop climbing', () => {
  const f = (i) => recipe('coin', { index: i })[0].f;
  assert.ok(f(0) < f(1) && f(1) < f(4));
  assert.equal(f(20), f(40), 'capped');
});
