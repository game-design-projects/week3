import { PRICES, CAPS, LEVELS, PIECE_NAMES } from '../../config.js';
import { h, pieceImg } from '../dom.js';

export function mount(root, ctx) {
  const rows = ['q', 'r', 'b', 'n', 'p'].map((t) =>
    h('tr', {}, h('td', {}, pieceImg('w', t), ' ', PIECE_NAMES[t]), h('td', { class: 'num' }, PRICES[t]), h('td', { class: 'num' }, CAPS[t])),
  );
  root.append(
    h(
      'section',
      { class: 'page narrow howto' },
      h('h1', {}, 'How to play'),
      h(
        'ol',
        { class: 'steps' },
        h('li', {}, h('b', {}, 'Start with a king and gold. '), `There is no setup phase. In Level 1 you begin with only your king on e1 and ${LEVELS[0].gold} gold, facing a garrison that is already on the board.`),
        h('li', {}, h('b', {}, 'Move or buy. '), 'Each turn, either make a normal chess move, or buy one piece and drop it on an empty square of your back two ranks (pawns only on the second rank). Buying uses your turn. Drag a card from your war chest under the board, or click it and then click a gold square.'),
        h('li', {}, h('b', {}, 'Earn by capturing. '), 'Taking an enemy piece pays a bounty into your purse (pawn, knight or bishop 1 g, rook 2 g, queen 4 g).'),
        h('li', {}, h('b', {}, 'Checkmate to win. '), 'Otherwise it is normal chess without castling. A buy can block a check, so you are only mated when no move and no purchase saves the king. Stalemate and repetition are draws.'),
      ),
      h('table', { class: 'price-table' }, h('thead', {}, h('tr', {}, h('th', {}, 'Piece'), h('th', {}, 'Gold'), h('th', {}, 'Max on board'))), h('tbody', {}, rows)),
      h('h3', {}, 'Controls'),
      h('p', {}, 'Click a piece, then a highlighted square — or drag it. Keyboard: Tab to a square, Enter to select and again to move.'),
      h('h3', {}, 'Free battle'),
      h('p', {}, 'Two lone kings, the same purse each, against the computer or a friend on this device.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go('menu') }, 'Back to menu'),
    ),
  );
  return () => {};
}
