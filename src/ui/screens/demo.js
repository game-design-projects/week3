// Demo: AI vs AI. Both sides start with a lone king and the same purse and
// build their armies during the game; only how far each AI looks ahead
// differs. A running series score shows the strategy ladder in action: more
// thinking → better purchases and better moves → more wins.

import { AI_PRESETS } from '../../config.js';
import { freeStart } from '../../core/start.js';
import { fill, h } from '../dom.js';

const GOLDS = [12, 20, 39];
const SPEEDS = { slow: 1100, normal: 500, fast: 120 };

export function mount(root, ctx, params) {
  function launch(demo) {
    ctx.go('battle', {
      mode: 'demo',
      levelId: null,
      opponent: 'demo',
      aiPreset: null,
      playerSide: null,
      gold: demo.gold,
      rules: ctx.settings.rules(),
      ...freeStart(demo.gold),
      demo,
    });
  }

  if (params.continue) {
    root.append(h('p', { class: 'fine center-note' }, 'Setting up the next game…'));
    setTimeout(() => launch(params.continue), 0);
    return () => {};
  }

  const opts = { w: 'hard', b: 'easy', gold: 20, speed: 'normal', autoNext: true };
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
        'Two AIs start with nothing but a king and the same purse. Each turn they decide whether to move or to buy, and what to buy. The only difference between them is how many moves ahead they look. Leave it running and watch the score: the deeper thinker should keep winning. Thinking further ahead pays off, which is what strategic depth means.',
      ),
      h(
        'div',
        { class: 'form' },
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'White'), h('div', { class: 'choices' }, Object.entries(AI_PRESETS).map(([k, p]) => choice(`${p.label} (${p.depth} ply)`, opts.w === k, `demo-w-${k}`, () => ((opts.w = k), paint()))))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Black'), h('div', { class: 'choices' }, Object.entries(AI_PRESETS).map(([k, p]) => choice(`${p.label} (${p.depth} ply)`, opts.b === k, `demo-b-${k}`, () => ((opts.b = k), paint()))))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Purse'), h('div', { class: 'choices' }, GOLDS.map((g) => choice(`${g} gold`, opts.gold === g, `demo-gold-${g}`, () => ((opts.gold = g), paint()))))),
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
            onclick: () => launch({ presets: { w: opts.w, b: opts.b }, gold: opts.gold, speedMs: SPEEDS[opts.speed], autoNext: opts.autoNext, series: { games: 0, w: 0, d: 0, b: 0 } }),
          },
          'Start the demo',
        ),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go('menu') }, 'Back'),
      ),
      h('p', { class: 'fine' }, 'Demo games are not recorded as playtest data.'),
    );
  }
  paint();
  return () => {};
}
