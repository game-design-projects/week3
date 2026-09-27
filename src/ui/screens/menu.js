import { LEVELS, PRICES, APP_VERSION, BALANCE_VERSION } from '../../config.js';
import { armyCost, armyFromPlacement, armyLabel } from '../../core/army.js';
import { h, pieceImg } from '../dom.js';

export function mount(root, ctx) {
  const level = LEVELS[0];
  const enemyArmy = armyFromPlacement(level.enemy);
  const past = ctx.store.sessions().filter((s) => s.mode === 'level' && s.levelId === level.id);
  const wins = past.filter((s) => s.result === 'win').length;
  const finished = past.filter((s) => s.result && s.result !== 'abandoned').length;

  const priceRow = h(
    'div',
    { class: 'price-row' },
    ['q', 'r', 'b', 'n', 'p'].map((t) => h('span', { class: 'price-chip' }, pieceImg('w', t), h('b', { class: 'num' }, PRICES[t]))),
  );

  root.append(
    h(
      'section',
      { class: 'menu' },
      h(
        'div',
        { class: 'hero' },
        h('p', { class: 'eyebrow' }, 'A strategy prototype'),
        h('h1', {}, 'Chess Battle Simulator'),
        h('p', { class: 'lede' }, 'Recruit an army with a fixed purse of gold. Deploy it. Then play real chess until one king falls.'),
        priceRow,
      ),
      h(
        'div',
        { class: 'menu-cards' },
        h(
          'button',
          { class: 'menu-card feature', type: 'button', dataset: { testid: `menu-level-${level.id}` }, onclick: () => ctx.go('setup', { mode: 'level', levelId: level.id }) },
          h('span', { class: 'card-kicker' }, 'Campaign · Level 1'),
          h('span', { class: 'card-title' }, level.name),
          h('span', { class: 'card-body' }, level.blurb),
          h(
            'span',
            { class: 'card-stats' },
            h('span', {}, h('i', { class: 'coin' }), h('b', { class: 'num' }, level.budget), ' gold'),
            h('span', { class: 'enemy-tag' }, 'vs ', armyLabel(enemyArmy), ` (${armyCost(enemyArmy)})`),
            finished ? h('span', {}, `${wins}/${finished} won`) : null,
          ),
        ),
        h(
          'button',
          { class: 'menu-card wide', type: 'button', dataset: { testid: 'menu-free' }, onclick: () => ctx.go('draft', {}) },
          h('span', { class: 'card-kicker' }, 'Free mode'),
          h('span', { class: 'card-title' }, 'The Draft'),
          h('span', { class: 'card-body' }, 'Both sides buy. Take turns picking one piece at a time — against the AI or a friend on this device.'),
        ),
        h(
          'button',
          { class: 'menu-card slim', type: 'button', dataset: { testid: 'menu-howto' }, onclick: () => ctx.go('howto') },
          h('span', { class: 'card-title' }, 'How to play'),
          h('span', { class: 'card-body' }, 'Prices, deployment rules, controls.'),
        ),
        h(
          'button',
          { class: 'menu-card slim', type: 'button', dataset: { testid: 'menu-dashboard' }, onclick: () => ctx.go('dashboard') },
          h('span', { class: 'card-title' }, 'Playtest data'),
          h('span', { class: 'card-body' }, `${ctx.store.sessions().length} recorded session(s) · export & balance view`),
        ),
      ),
      h('footer', { class: 'menu-foot' }, `v${APP_VERSION} · balance ${BALANCE_VERSION} · pieces by Cburnett (BSD) · rules by chess.js`),
    ),
  );
  return () => {};
}
