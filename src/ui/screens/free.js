// Free mode: pick the purse and the opponent, then straight into battle.
// Both sides start with just a king and the same gold.

import { AI_PRESETS, FREE_MODE } from '../../config.js';
import { freeStart } from '../../core/start.js';
import { fill, h } from '../dom.js';

export function mount(root, ctx) {
  const opts = { gold: FREE_MODE.defaultGold, opponent: 'ai', aiPreset: 'normal' };
  const el = h('section', { class: 'page narrow' });
  root.append(el);

  const choice = (label, active, testid, onclick) =>
    h('button', { class: `choice${active ? ' on' : ''}`, type: 'button', 'aria-pressed': String(active), dataset: { testid }, onclick }, label);

  function start() {
    ctx.go('battle', {
      mode: 'free',
      levelId: null,
      opponent: opts.opponent,
      aiPreset: opts.opponent === 'ai' ? opts.aiPreset : null,
      playerSide: opts.opponent === 'ai' ? 'w' : null,
      gold: opts.gold,
      rules: ctx.settings.rules(),
      ...freeStart(opts.gold),
    });
  }

  function paint() {
    fill(
      el,
      h('h1', {}, 'Free battle'),
      h(
        'p',
        { class: 'lede' },
        'Both kings start alone on an empty board with the same purse. Each turn you either move or buy one piece and drop it into your back two ranks. Captures pay a bounty. Whoever spends better wins.',
      ),
      h(
        'div',
        { class: 'form' },
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Purse'), h('div', { class: 'choices' }, FREE_MODE.golds.map((g) => choice(`${g} gold`, opts.gold === g, `free-gold-${g}`, () => ((opts.gold = g), paint()))))),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'label' }, 'Opponent'),
          h(
            'div',
            { class: 'choices' },
            choice('The computer', opts.opponent === 'ai', 'free-opponent-ai', () => ((opts.opponent = 'ai'), paint())),
            choice('A friend on this device', opts.opponent === 'hotseat', 'free-opponent-hotseat', () => ((opts.opponent = 'hotseat'), paint())),
          ),
        ),
        opts.opponent === 'ai'
          ? h(
              'div',
              { class: 'field' },
              h('span', { class: 'label' }, 'Computer'),
              h('div', { class: 'choices' }, Object.entries(AI_PRESETS).map(([k, p]) => choice(p.label, opts.aiPreset === k, `free-preset-${k}`, () => ((opts.aiPreset = k), paint())))),
            )
          : null,
      ),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', dataset: { testid: 'free-start' }, onclick: start }, 'Start the battle'),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go('menu') }, 'Back'),
      ),
    );
  }
  paint();
  return () => {};
}
