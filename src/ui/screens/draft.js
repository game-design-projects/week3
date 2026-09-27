// Free mode: pick options, then an alternating draft (one piece per turn,
// pass = lock your army). Black drafts first. Hands the armies to 'setup'.

import { AI_PRESETS, FREE_MODE, PIECE_NAMES, PIECE_TYPES, PRICES } from '../../config.js';
import { armyLabel, canBuy } from '../../core/army.js';
import { createDraft, draftBuy, draftPass } from '../../core/draft.js';
import { chooseDraftPick } from '../../core/draftAI.js';
import { createRng, randomSeed } from '../../lib/rng.js';
import { fill, h, pieceImg } from '../dom.js';

const SIDE = { w: 'White', b: 'Black' };

export function mount(root, ctx) {
  let opts = { budget: FREE_MODE.defaultBudget, opponent: 'ai', aiPreset: 'normal' };
  let state = null;
  let alive = true;
  let launched = false;
  let aiTimer = null;
  const rng = createRng(randomSeed());
  const el = h('section', { class: 'draft' });
  root.append(el);

  const isHuman = (side) => opts.opponent === 'hotseat' || side === 'w';

  function choice(label, active, testid, onclick) {
    return h('button', { class: `choice${active ? ' on' : ''}`, type: 'button', 'aria-pressed': String(active), dataset: { testid }, onclick }, label);
  }

  function paintOptions() {
    fill(
      el,
      h(
        'div',
        { class: 'page narrow' },
        h('h1', {}, 'The Draft'),
        h(
          'p',
          { class: 'lede' },
          'Both sides start with the same purse and take turns buying one piece at a time. Passing locks your army; gold you keep can buy pieces during the battle. Black picks first, because White moves first.',
        ),
        h(
          'div',
          { class: 'form' },
          h('div', { class: 'field' }, h('span', { class: 'label' }, 'Budget'), h('div', { class: 'choices' }, FREE_MODE.budgets.map((b) => choice(`${b} gold`, opts.budget === b, `free-budget-${b}`, () => ((opts.budget = b), paintOptions()))))),
          h(
            'div',
            { class: 'field' },
            h('span', { class: 'label' }, 'Opponent'),
            h(
              'div',
              { class: 'choices' },
              choice('The computer', opts.opponent === 'ai', 'free-opponent-ai', () => ((opts.opponent = 'ai'), paintOptions())),
              choice('A friend on this device', opts.opponent === 'hotseat', 'free-opponent-hotseat', () => ((opts.opponent = 'hotseat'), paintOptions())),
            ),
          ),
          opts.opponent === 'ai'
            ? h(
                'div',
                { class: 'field' },
                h('span', { class: 'label' }, 'Computer'),
                h('div', { class: 'choices' }, Object.entries(AI_PRESETS).map(([k, p]) => choice(p.label, opts.aiPreset === k, `free-preset-${k}`, () => ((opts.aiPreset = k), paintOptions())))),
              )
            : null,
        ),
        h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', dataset: { testid: 'free-start' }, onclick: begin }, 'Begin the draft')),
      ),
    );
  }

  function begin() {
    ctx.recorder.begin({
      mode: 'free',
      levelId: null,
      opponent: opts.opponent,
      aiPreset: opts.opponent === 'ai' ? opts.aiPreset : null,
      budget: opts.budget,
      playerSide: opts.opponent === 'ai' ? 'w' : null,
      rules: ctx.settings.rules(),
    });
    state = createDraft({ budget: opts.budget });
    state.log.forEach((e) => ctx.recorder.draftStep(e));
    step();
  }

  function apply(next, played) {
    const fresh = next.log.slice(state.log.length);
    fresh.forEach((e) => ctx.recorder.draftStep(e));
    if (played) ctx.sound.play(played === 'pass' ? 'sell' : 'buy');
    state = next;
    step();
  }

  function step() {
    if (!alive) return;
    paintDraft();
    if (state.done) return;
    if (!isHuman(state.turn)) {
      aiTimer = setTimeout(() => {
        const pick = chooseDraftPick(state, state.turn, rng);
        apply(pick === 'pass' ? draftPass(state) : draftBuy(state, pick), pick);
      }, 550);
    }
  }

  function column(side) {
    const army = state.armies[side];
    const left = state.budget - state.spent[side];
    const active = state.turn === side;
    const who = opts.opponent === 'ai' ? (side === 'w' ? 'You, White' : `Computer, Black (${AI_PRESETS[opts.aiPreset].label})`) : SIDE[side];
    return h(
      'div',
      { class: `draft-col ${side === 'w' ? 'ally' : 'enemy'}${active ? ' active' : ''}${state.passed[side] ? ' locked' : ''}` },
      h('div', { class: 'section-head' }, h('span', {}, who), h('span', { class: 'num gold' }, `${left} g`)),
      h('div', { class: 'draft-army' }, pieceImg(side, 'k'), PIECE_TYPES.flatMap((t) => Array.from({ length: army[t] }, () => pieceImg(side, t, 'pop-in')))),
      h('p', { class: 'fine' }, state.passed[side] ? `Locked: ${armyLabel(army)}` : armyLabel(army)),
    );
  }

  function paintDraft() {
    const side = state.turn;
    const human = side && isHuman(side);
    const turnText = state.done ? 'The draft is over' : human ? (opts.opponent === 'ai' ? 'Your pick' : `${SIDE[side]} to pick`) : 'The computer is choosing…';
    const buttons = human
      ? PIECE_TYPES.map((t) => {
          const check = canBuy(state.armies[side], t, state.budget, { prices: state.prices, caps: state.caps });
          return h(
            'button',
            {
              class: 'pick',
              type: 'button',
              disabled: !check.ok,
              title: check.ok ? '' : check.reason === 'cap' ? 'You own the maximum' : 'Not enough gold',
              dataset: { testid: `draft-buy-${t}` },
              onclick: () => apply(draftBuy(state, t), t),
            },
            pieceImg(side, t),
            h('span', {}, PIECE_NAMES[t]),
            h('span', { class: 'num' }, `${PRICES[t]} g`),
          );
        })
      : [];
    fill(
      el,
      h(
        'div',
        { class: 'draft-board' },
        column('b'),
        h(
          'div',
          { class: 'draft-center' },
          h('p', { class: 'kicker' }, `${state.budget} gold each · ${opts.opponent === 'ai' ? 'against the computer' : 'two players'}`),
          h('h2', { class: `turn ${state.done ? '' : side === 'w' ? 'ally' : 'enemy'}` }, turnText),
          state.done
            ? h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'button', dataset: { testid: 'draft-deploy' }, onclick: deploy }, 'Deploy the armies'))
            : [
                h('div', { class: 'pick-grid' }, buttons),
                human ? h('div', { class: 'actions' }, h('button', { class: 'btn quiet', type: 'button', dataset: { testid: 'draft-pass' }, onclick: () => apply(draftPass(state), 'pass') }, 'Pass and lock my army')) : null,
              ],
          h('div', { class: 'section-head sub' }, h('span', {}, 'Picks so far')),
          h(
            'ol',
            { class: 'draft-log', reversed: true },
            state.log
              .slice()
              .reverse()
              .map((e) => h('li', { class: e.side === 'w' ? 'ally' : 'enemy' }, `${SIDE[e.side]} ${e.action === 'buy' ? `buys a ${PIECE_NAMES[e.type].toLowerCase()}` : e.auto ? 'has nothing left to buy' : 'passes'}`)),
          ),
        ),
        column('w'),
      ),
    );
  }

  function deploy() {
    launched = true;
    ctx.go('setup', {
      mode: 'free',
      budget: state.budget,
      opponent: opts.opponent,
      aiPreset: opts.opponent === 'ai' ? opts.aiPreset : null,
      armies: state.armies,
    });
  }

  paintOptions();
  return () => {
    alive = false;
    clearTimeout(aiTimer);
    if (state && !launched) ctx.recorder.abandon();
  };
}
