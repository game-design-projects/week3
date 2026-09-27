// Demo: AI vs AI. Both sides get the SAME army in a mirrored position; only
// how far each AI looks ahead differs. A running series score shows the
// strategy ladder in action: more thinking → more wins.

import { AI_PRESETS } from '../../config.js';
import { armyCost, armyLabel } from '../../core/army.js';
import { autoPlace } from '../../core/autoplace.js';
import { createDraft, draftBuy, draftPass } from '../../core/draft.js';
import { chooseDraftPick } from '../../core/draftAI.js';
import { validateMatch } from '../../core/placement.js';
import { createRng, randomSeed } from '../../lib/rng.js';
import { fill, h } from '../dom.js';

const BUDGETS = [12, 20, 39];
const SPEEDS = { slow: 1100, normal: 500, fast: 120 };

/** Mirror a White placement onto Black's side (rank r → 9 − r). */
export function mirror(placement) {
  return placement.map((p) => ({ type: p.type, square: `${p.square[0]}${9 - Number(p.square[1])}` }));
}

/** Build one mirrored demo game: an AI-drafted army, auto-placed, mirrored for Black. */
export function makeDemoGame(budget, rng) {
  for (let attempt = 0; attempt < 20; attempt++) {
    let s = createDraft({ budget });
    while (!s.done) {
      const pick = chooseDraftPick(s, s.turn, rng);
      s = pick === 'pass' ? draftPass(s) : draftBuy(s, pick);
    }
    const army = s.armies.w;
    const white = autoPlace('w', army, { rng });
    const black = mirror(white);
    if (validateMatch(white, black).ok) {
      const reserve = budget - armyCost(army);
      return { white: { army, placement: white, reserve }, black: { army: { ...army }, placement: black, reserve } };
    }
  }
  throw new Error('could not build a mirrored demo game');
}

export function mount(root, ctx, params) {
  const rng = createRng(randomSeed());

  function launch(demo) {
    const game = makeDemoGame(demo.budget, rng);
    ctx.go('battle', {
      mode: 'demo',
      levelId: null,
      opponent: 'demo',
      aiPreset: null,
      playerSide: null,
      budget: demo.budget,
      rules: ctx.settings.rules(),
      white: game.white,
      black: game.black,
      demo,
    });
  }

  if (params.continue) {
    root.append(h('p', { class: 'fine center-note' }, 'Setting up the next game…'));
    setTimeout(() => launch(params.continue), 0);
    return () => {};
  }

  const opts = { w: 'hard', b: 'easy', budget: 20, speed: 'normal', autoNext: true };
  const el = h('section', { class: 'page narrow' });
  root.append(el);

  const choice = (label, active, testid, onclick) =>
    h('button', { class: `choice${active ? ' on' : ''}`, type: 'button', 'aria-pressed': String(active), dataset: { testid }, onclick }, label);

  function paint() {
    fill(
      el,
      h('h1', {}, 'Demo: AI vs AI'),
      h(
        'p',
        { class: 'lede' },
        'Two AIs get the same army, deployed as a mirror image. The only difference between them is how many moves ahead each one looks. Leave it running and watch the score: the deeper thinker should keep winning. Thinking further ahead pays off, which is what strategic depth means.',
      ),
      h(
        'div',
        { class: 'form' },
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'White'), h('div', { class: 'choices' }, Object.entries(AI_PRESETS).map(([k, p]) => choice(`${p.label} (${p.depth} ply)`, opts.w === k, `demo-w-${k}`, () => ((opts.w = k), paint()))))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Black'), h('div', { class: 'choices' }, Object.entries(AI_PRESETS).map(([k, p]) => choice(`${p.label} (${p.depth} ply)`, opts.b === k, `demo-b-${k}`, () => ((opts.b = k), paint()))))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Budget'), h('div', { class: 'choices' }, BUDGETS.map((b) => choice(`${b} gold`, opts.budget === b, `demo-budget-${b}`, () => ((opts.budget = b), paint()))))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Speed'), h('div', { class: 'choices' }, Object.keys(SPEEDS).map((k) => choice(k[0].toUpperCase() + k.slice(1), opts.speed === k, `demo-speed-${k}`, () => ((opts.speed = k), paint()))))),
        h(
          'label',
          { class: 'check' },
          h('input', { type: 'checkbox', checked: opts.autoNext, onchange: (e) => (opts.autoNext = e.target.checked) }),
          ' Keep playing games and keep score',
        ),
      ),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            dataset: { testid: 'demo-start' },
            onclick: () => launch({ presets: { w: opts.w, b: opts.b }, budget: opts.budget, speedMs: SPEEDS[opts.speed], autoNext: opts.autoNext, series: { games: 0, w: 0, d: 0, b: 0 } }),
          },
          'Start the demo',
        ),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go('menu') }, 'Back'),
      ),
      h('p', { class: 'fine' }, `Armies are drafted by the AI each game (example at ${opts.budget} gold: ${armyLabel(makeDemoGame(opts.budget, createRng(7)).white.army)}). Demo games are not recorded as playtest data.`),
    );
  }
  paint();
  return () => {};
}
