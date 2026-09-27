// Title page, laid out like the contents page of a chess book.
import { APP_VERSION, BALANCE_VERSION, LEVELS, PIECE_NAMES, PRICES } from '../../config.js';
import { armyCost, armyFromPlacement, armyLabel } from '../../core/army.js';
import { levelStart } from '../../core/start.js';
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
        h('p', { class: 'lede' }, 'Chess where gold is your army. You start with a lone king and a purse, and you build your side one purchase at a time, in the middle of the fight.'),
        h(
          'ol',
          { class: 'loop' },
          h('li', {}, h('b', {}, 'Move or buy.'), ' Each turn, either make a chess move or buy one piece and drop it into your back two ranks.'),
          h('li', {}, h('b', {}, 'Capture to earn.'), ' Every enemy piece you take pays a bounty back into your purse.'),
          h('li', {}, h('b', {}, 'Mate to win.'), ' Normal chess rules otherwise. The enemy shops by the same rules.'),
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
          entry('I', `Level 1: ${level.name}`, `king + ${level.gold} g vs ${armyLabel(enemyArmy)} (${armyCost(enemyArmy)} g)${finished ? ` · won ${wins} of ${finished}` : ''}`, `menu-level-${level.id}`, () =>
            ctx.go('battle', {
              mode: 'level',
              levelId: level.id,
              opponent: 'ai',
              aiPreset: ctx.settings.get().campaignAI,
              playerSide: 'w',
              gold: level.gold,
              rules: ctx.settings.rules(),
              ...levelStart(level),
            }),
          ),
          entry('II', 'Free battle', 'two kings, two purses', 'menu-free', () => ctx.go('free', {})),
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
