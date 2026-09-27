// Board component: 64 <button> squares in a CSS grid. Supports click-to-move
// (and keyboard via Enter/Space) and pointer drag-and-drop (mouse + touch),
// highlights (selection, legal targets, last move, check, deployment zone,
// problems) and a short slide animation for moves.

import { h, pieceUrl } from './dom.js';

const FILES = 'abcdefgh';
const NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

function squaresFor(orientation) {
  const out = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = orientation === 'w' ? col : 7 - col;
      const rank = orientation === 'w' ? 8 - row : row + 1;
      out.push(`${FILES[file]}${rank}`);
    }
  }
  return out;
}

// a1 is a dark square: light squares have an even file index + rank sum.
export const isLight = (sq) => (FILES.indexOf(sq[0]) + Number(sq[1])) % 2 === 0;

/** Pieces from a chess.js board() matrix. */
export function piecesFromBoard(board) {
  return board.flat().filter(Boolean).map(({ square, type, color }) => ({ square, type, color }));
}

/** Pieces from placements. */
export function piecesFromPlacements(white = [], black = []) {
  return [
    ...white.map((p) => ({ ...p, color: 'w' })),
    ...black.map((p) => ({ ...p, color: 'b' })),
  ];
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {'w'|'b'} [opts.orientation]
 * @param {(square: string) => void} [opts.onSquareClick]
 * @param {(from: string, to: string) => void} [opts.onDrop]
 * @param {(square: string) => boolean} [opts.canDrag]
 * @param {(square: string) => void} [opts.onDragStart]
 */
export function createBoard(container, opts = {}) {
  let orientation = opts.orientation ?? 'w';
  let pieces = [];
  let hl = {};
  const squareEls = new Map();
  const el = h('div', { class: 'board', dataset: { testid: 'board' }, role: 'grid', 'aria-label': 'Chess board' });
  container.append(el);

  function build() {
    el.replaceChildren();
    squareEls.clear();
    const order = squaresFor(orientation);
    order.forEach((sq, i) => {
      const row = Math.floor(i / 8);
      const col = i % 8;
      const btn = h('button', {
        class: `sq ${isLight(sq) ? 'light' : 'dark'}`,
        type: 'button',
        dataset: { square: sq },
      });
      if (row === 7) btn.append(h('span', { class: 'coord file' }, sq[0]));
      if (col === 0) btn.append(h('span', { class: 'coord rank' }, sq[1]));
      btn.addEventListener('click', (e) => {
        // Pointer clicks are handled in pointerup (so drags don't double-fire); keyboard clicks have detail 0.
        if (e.detail === 0) opts.onSquareClick?.(sq);
      });
      squareEls.set(sq, btn);
      el.append(btn);
    });
    paint();
  }

  function paint(animate) {
    const bySquare = new Map(pieces.map((p) => [p.square, p]));
    const targets = new Map((hl.targets ?? []).map((t) => [t.square, t]));
    const zone = new Set(hl.zone ?? []);
    const bad = new Set(hl.bad ?? []);
    for (const [sq, btn] of squareEls) {
      const p = bySquare.get(sq);
      btn.classList.toggle('selected', hl.selected === sq);
      btn.classList.toggle('last', !!hl.lastMove && (hl.lastMove.from === sq || hl.lastMove.to === sq));
      btn.classList.toggle('check', hl.check === sq);
      btn.classList.toggle('zone', zone.has(sq));
      btn.classList.toggle('bad', bad.has(sq));
      btn.classList.toggle('target', targets.has(sq) && !targets.get(sq).capture);
      btn.classList.toggle('capture-target', targets.has(sq) && !!targets.get(sq).capture);
      btn.classList.toggle('has-piece', !!p);
      btn.classList.toggle('draggable', !!p && !!opts.canDrag?.(sq));
      const label = p ? `${sq}, ${p.color === 'w' ? 'white' : 'black'} ${NAMES[p.type]}` : sq;
      btn.setAttribute('aria-label', label);
      const old = btn.querySelector('.piece');
      const want = p ? `${p.color}${p.type.toUpperCase()}` : null;
      if (old && old.dataset.piece === want) continue;
      old?.remove();
      if (p) {
        const img = h('img', {
          class: `piece ${p.color === 'w' ? 'white' : 'black'}`,
          src: pieceUrl(p.color, p.type),
          alt: '',
          draggable: 'false',
          dataset: { piece: want },
        });
        btn.append(img);
      }
    }
    if (animate) slide(animate.from, animate.to);
  }

  function slide(from, to) {
    const a = squareEls.get(from);
    const b = squareEls.get(to);
    const img = b?.querySelector('.piece');
    if (!a || !img || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    img.animate(
      [{ transform: `translate(${ra.left - rb.left}px, ${ra.top - rb.top}px)` }, { transform: 'translate(0, 0)' }],
      { duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }

  // ---- pointer drag & drop
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('.sq');
    if (!btn || e.button > 0) return;
    const sq = btn.dataset.square;
    drag = { from: sq, x: e.clientX, y: e.clientY, moved: false, ghost: null, id: e.pointerId };
    if (btn.querySelector('.piece') && opts.canDrag?.(sq)) {
      drag.canDrag = true;
      el.setPointerCapture?.(e.pointerId);
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || !drag.canDrag || e.pointerId !== drag.id) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      const src = squareEls.get(drag.from).querySelector('.piece');
      const size = squareEls.get(drag.from).getBoundingClientRect().width;
      drag.ghost = h('img', { class: 'drag-ghost', src: src.src, alt: '', style: { width: `${size}px`, height: `${size}px` } });
      document.body.append(drag.ghost);
      src.classList.add('dragging');
      opts.onDragStart?.(drag.from);
    }
    drag.ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
  });
  const endDrag = (e, cancel = false) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.moved) {
      d.ghost?.remove();
      squareEls.get(d.from)?.querySelector('.piece')?.classList.remove('dragging');
      if (cancel) return;
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.sq');
      const to = under && el.contains(under) ? under.dataset.square : null;
      if (to && to !== d.from) opts.onDrop?.(d.from, to);
      else opts.onSquareClick?.(d.from); // dropped back / off-board: treat as a click on the origin
    } else if (!cancel) {
      opts.onSquareClick?.(d.from);
    }
  };
  el.addEventListener('pointerup', (e) => endDrag(e));
  el.addEventListener('pointercancel', (e) => endDrag(e, true));

  build();

  return {
    el,
    /** @param {Array<{square,color,type}>} next @param {{from,to}} [animate] */
    render(next, animate) {
      pieces = next;
      paint(animate);
    },
    highlight(next) {
      hl = next ?? {};
      paint();
    },
    setOrientation(o) {
      if (o === orientation) return;
      orientation = o;
      build();
    },
    squareEl: (sq) => squareEls.get(sq),
    destroy() {
      drag?.ghost?.remove();
      el.remove();
    },
  };
}

/** Static, non-interactive thumbnail of a FEN position. */
export function renderMiniBoard(fen, { size = 160 } = {}) {
  const rows = fen.split(' ')[0].split('/');
  const grid = h('div', { class: 'mini-board', style: { width: `${size}px`, height: `${size}px` }, 'aria-label': `Position ${fen}` });
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) grid.append(h('div', { class: `msq ${(f++ + r) % 2 ? 'dark' : 'light'}` }));
      } else {
        const color = ch === ch.toUpperCase() ? 'w' : 'b';
        grid.append(
          h('div', { class: `msq ${(f++ + r) % 2 ? 'dark' : 'light'}` }, h('img', { src: pieceUrl(color, ch.toLowerCase()), alt: '' })),
        );
      }
    }
  });
  return grid;
}
