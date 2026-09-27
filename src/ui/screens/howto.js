import { PRICES, CAPS, LEVELS, PIECE_NAMES } from '../../config.js';
import { h, pieceImg } from '../dom.js';

export function mount(root, ctx) {
  const rows = ['q', 'r', 'b', 'n', 'p'].map((t) =>
    h('tr', {}, h('td', {}, pieceImg('w', t), ' ', PIECE_NAMES[t]), h('td', { class: 'num' }, PRICES[t]), h('td', { class: 'num' }, CAPS[t])),
  );
  root.append(
    h(
      'section',
      { class: 'howto panel' },
      h('h2', {}, 'How to play'),
      h(
        'ol',
        { class: 'steps' },
        h('li', {}, h('b', {}, 'Recruit. '), `You get a purse of gold (Level 1: ${LEVELS[0].budget}). Buy pieces from the shop — the enemy army is shown so you can plan against it. Your king is free.`),
        h('li', {}, h('b', {}, 'Deploy. '), 'Pieces go in your back two ranks; pawns only on the second rank. Drag or click pieces to rearrange. Neither king may start in check.'),
        h('li', {}, h('b', {}, 'Battle. '), 'Normal chess from there (no castling). You move first. Checkmate the enemy king to win; stalemate and repetition are draws.'),
      ),
      h('table', { class: 'price-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Piece'), h('th', {}, 'Gold'), h('th', {}, 'Max'))), h('tbody', {}, rows)),
      h('h3', {}, 'Controls'),
      h('p', {}, 'Click a piece, then a highlighted square — or drag it. Keyboard: Tab to a square, Enter to select and again to move.'),
      h('h3', {}, 'Free mode'),
      h('p', {}, 'Both sides share the same budget and draft one piece per turn. Passing locks your army. Black picks first because White moves first.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('menu') }, 'Back to menu'),
    ),
  );
  return () => {};
}
