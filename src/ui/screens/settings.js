// Settings: presentation preferences and two house rules.

import { AI_PRESETS, CAPTURE_BOUNTY } from '../../config.js';
import { fill, h } from '../dom.js';

export function mount(root, ctx) {
  const el = h('section', { class: 'page narrow' });
  root.append(el);

  function toggle(key, label, help) {
    const v = ctx.settings.get()[key];
    return h(
      'div',
      { class: 'setting' },
      h('div', {}, h('b', {}, label), h('p', { class: 'fine' }, help)),
      h(
        'button',
        {
          class: `switch${v ? ' on' : ''}`,
          type: 'button',
          role: 'switch',
          'aria-checked': String(v),
          'aria-label': label,
          dataset: { testid: `setting-${key}` },
          onclick: () => {
            ctx.settings.set({ [key]: !v });
            paint();
          },
        },
        v ? 'On' : 'Off',
      ),
    );
  }

  function paint() {
    const s = ctx.settings.get();
    const bounty = Object.entries(CAPTURE_BOUNTY)
      .map(([t, g]) => `${t.toUpperCase()} ${g}`)
      .join(', ');
    fill(
      el,
      h('h1', {}, 'Settings'),
      h('h2', { class: 'rule-head' }, 'Play'),
      h(
        'div',
        { class: 'setting' },
        h('div', {}, h('b', {}, 'Campaign opponent'), h('p', { class: 'fine' }, 'How far ahead the enemy looks in the campaign. Captain is the intended difficulty.')),
        h(
          'div',
          { class: 'choices' },
          Object.entries(AI_PRESETS).map(([k, p]) =>
            h(
              'button',
              { class: `choice${s.campaignAI === k ? ' on' : ''}`, type: 'button', 'aria-pressed': String(s.campaignAI === k), dataset: { testid: `setting-ai-${k}` }, onclick: () => (ctx.settings.set({ campaignAI: k }), paint()) },
              p.label,
            ),
          ),
        ),
      ),
      toggle('sound', 'Sound', 'Short clicks for moves, captures and purchases.'),
      toggle('showHints', 'Show legal moves', 'Dots on the squares the selected piece can reach.'),
      toggle('showCoords', 'Board coordinates', 'Files a–h and ranks 1–8 along the edges.'),
      toggle('animations', 'Animations', 'Pieces slide when they move.'),
      h('h2', { class: 'rule-head' }, 'House rules'),
      h('p', { class: 'fine' }, 'These change the game, so every recorded session notes which rules were on.'),
      toggle('captureBounty', 'Capture bounty', `Capturing an enemy piece earns gold: ${bounty}.`),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('menu') }, 'Done'),
        h('button', { class: 'btn quiet', type: 'button', dataset: { testid: 'settings-reset' }, onclick: () => (ctx.settings.reset(), paint()) }, 'Reset to defaults'),
      ),
    );
  }
  paint();
  return () => {};
}
