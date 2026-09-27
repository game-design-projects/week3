// Title page, laid out like the contents page of a chess book.
import { APP_VERSION, BALANCE_VERSION, LEVELS, PIECE_NAMES, PRICES } from '../../config.js';
import { armyCost, armyFromPlacement, armyLabel } from '../../core/army.js';
import { h, pieceImg } from '../dom.js';

export function mount(root, ctx) {
  const level = LEVELS[0];
  const enemyArmy = armyFromPlacement(level.enemy);
  const past = ctx.store.sessions().filter((s) => s.mode === 'level' && s.levelId === level.id);
  const wins = past.filter((s) => s.result === 'win').length;
  const finished = past.filter((s) => s.result && s.result !== 'abandoned').length;

  const entry = (numeral, title, note, testid, go) =>
    h(
      'li',
      {},
      h(
        'button',
        { class: 'toc-entry', type: 'button', dataset: { testid }, onclick: go },
        h('span', { class: 'toc-n' }, numeral),
        h('span', { class: 'toc-title' }, title),
        h('span', { class: 'toc-dots', 'aria-hidden': 'true' }),
        h('span', { class: 'toc-note' }, note),
      ),
    );

  root.append(
    h(
      'section',
      { class: 'title-page' },
      h(
        'div',
        { class: 'title-block' },
        h('h1', {}, 'Chess Battle', h('br'), 'Simulator'),
        h('p', { class: 'lede' }, 'Chess where gold is a weapon. You buy your army instead of being handed one, and the shop stays open for the whole battle.'),
        h(
          'ol',
          { class: 'loop' },
          h('li', {}, h('b', {}, 'Recruit.'), ' Spend a purse of gold on pieces, knowing exactly what the enemy fields.'),
          h('li', {}, h('b', {}, 'Deploy.'), ' Arrange them in your back two ranks.'),
          h('li', {}, h('b', {}, 'Fight and buy.'), ' Every capture pays a bounty. On any turn you can spend gold to drop a new piece into your ranks instead of moving. The enemy can too.'),
        ),
        h(
          'table',
          { class: 'tariff', 'aria-label': 'Prices' },
          h('caption', {}, 'Price list'),
          h('tbody', {}, ['q', 'r', 'b', 'n', 'p'].map((t) => h('tr', {}, h('td', {}, pieceImg('w', t)), h('td', {}, PIECE_NAMES[t]), h('td', { class: 'num' }, `${PRICES[t]} g`)))),
          h('tfoot', {}, h('tr', {}, h('td', {}, pieceImg('w', 'k')), h('td', {}, 'King'), h('td', { class: 'num' }, 'free'))),
        ),
      ),
      h(
        'nav',
        { class: 'toc', 'aria-label': 'Main menu' },
        h('p', { class: 'toc-head' }, 'Contents'),
        h(
          'ol',
          {},
          entry('I', `Level 1: ${level.name}`, `${level.budget} g vs ${armyLabel(enemyArmy)} (${armyCost(enemyArmy)})${finished ? ` · won ${wins} of ${finished}` : ''}`, `menu-level-${level.id}`, () =>
            ctx.go('setup', { mode: 'level', levelId: level.id }),
          ),
          entry('II', 'The Draft', 'both sides buy, one piece at a time', 'menu-free', () => ctx.go('draft', {})),
          entry('III', 'Demo: AI vs AI', 'watch deeper thinking win', 'menu-demo', () => ctx.go('demo', {})),
          entry('IV', 'How to play', 'rules and controls', 'menu-howto', () => ctx.go('howto')),
          entry('V', 'Playtest data', `${ctx.store.sessions().length} sessions recorded`, 'menu-dashboard', () => ctx.go('dashboard')),
          entry('VI', 'Settings', 'sound, hints, house rules', 'menu-settings', () => ctx.go('settings')),
        ),
        h('p', { class: 'colophon' }, `Version ${APP_VERSION}, rules ${BALANCE_VERSION}. Pieces by Colin M.L. Burnett. Move rules by chess.js.`),
      ),
    ),
  );
  return () => {};
}
