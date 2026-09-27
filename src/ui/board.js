// Board component: 64 <button> squares in a CSS grid. Supports click-to-move
// (and keyboard via Enter/Space) and pointer drag-and-drop (mouse + touch),
// highlights (selection, legal targets, last move, check, deployment zone,
// problems) and the game-feel motion of pieces (feel.js): moves with
// anticipation / overshoot / squash, a captured piece knocked off its square,
// bought pieces stamped down, dragged pieces that lift, tilt and snap back.

import { FEEL } from '../config.js';
import { h, pieceUrl } from './dom.js';
import { landMotion, moveMotion, nearestTarget, resolveFeel } from './feel.js';
import { liftGhost, moveGhost, reducedMotion, returnGhost } from './fx.js';

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
 * @param {(from: string, to: string) => boolean} [opts.onDrop] return false to reject (the piece snaps back)
 * @param {() => 'full'|'subtle'|'off'} [opts.feel] game-feel level (default: full unless reduced motion)
 * @param {(square: string) => boolean} [opts.canDrag]
 * @param {(square: string) => void} [opts.onDragStart]
 */
export function createBoard(container, opts = {}) {
  let orientation = opts.orientation ?? 'w';
  let pieces = [];
  let hl = {};
  let hovered = null;
  const squareEls = new Map();
  const timers = new Set();
  const feel = opts.feel ?? (() => resolveFeel({}, reducedMotion()));
  const later = (ms, fn) => {
    if (ms <= 0) return fn();
    const id = setTimeout(() => (timers.delete(id), fn()), ms);
    timers.add(id);
  };
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
    if (!animate) return 0;
    return animate.drop ? land(animate) : move(animate);
  }

  /**
   * Animate the piece that just arrived on `to`. Calls onImpact when it lands
   * (immediately when effects are off) and returns that delay in ms.
   * a: { from, to, dragged?, hitStop?, captured?: {color,type}, onImpact? }
   */
  function move(a) {
    const lvl = feel();
    const A = squareEls.get(a.from);
    const B = squareEls.get(a.to);
    const img = B?.querySelector('.piece');
    const ra = A?.getBoundingClientRect();
    const rb = B?.getBoundingClientRect();
    const m = img && ra && rb.width ? moveMotion({ dx: ra.left - rb.left, dy: ra.top - rb.top, squarePx: rb.width, level: lvl, hitStop: a.hitStop ?? 0, dragged: a.dragged }) : null;
    if (!m) {
      a.onImpact?.();
      return 0;
    }
    // The captured piece stays under the attacker until the hit, then is knocked off the board.
    let victim = null;
    if (a.captured) {
      // Not a `.piece`: paint() owns those and would "fix" the square by replacing it.
      victim = h('img', { class: 'victim', src: pieceUrl(a.captured.color, a.captured.type), alt: '', draggable: 'false' });
      B.insertBefore(victim, img); // same z-index as pieces, earlier in the DOM → under the attacker
    }
    img.animate(m.keyframes, { duration: m.duration });
    later(m.impactAt, () => {
      if (victim) knockOff(victim, Math.sign(rb.left - ra.left) || 1, lvl);
      a.onImpact?.();
    });
    return m.impactAt;
  }

  function knockOff(victim, dir, lvl) {
    const far = lvl === 'full' ? 1 : 0.4;
    const anim = victim.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
        { offset: 0.3, transform: `translate(${dir * 28 * far}%, -26%) rotate(${dir * 30 * far}deg)`, opacity: 1, easing: 'cubic-bezier(0.5, 0, 1, 0.5)' },
        { transform: `translate(${dir * 58 * far}%, 40%) rotate(${dir * 100 * far}deg)`, opacity: 0 },
      ],
      { duration: lvl === 'full' ? 460 : 260, fill: 'forwards' },
    );
    anim.onfinish = () => victim.remove();
    anim.oncancel = () => victim.remove();
  }

  /** A bought piece arriving on a.drop (stamped down; a quick thud if it was dragged there). */
  function land(a) {
    const img = squareEls.get(a.drop)?.querySelector('.piece');
    const m = img ? landMotion({ level: feel(), dragged: a.dragged }) : null;
    if (!m) {
      a.onImpact?.();
      return 0;
    }
    img.animate(m.keyframes, { duration: m.duration });
    later(m.impactAt, () => a.onImpact?.());
    return m.impactAt;
  }

  /** Preview where a dragged piece/card would land. */
  function hover(sq) {
    if (hovered === sq) return;
    squareEls.get(hovered)?.classList.remove('drop-hover');
    hovered = sq;
    squareEls.get(sq)?.classList.add('drop-hover');
  }

  function squareAt(x, y) {
    const hit = document.elementFromPoint(x, y)?.closest?.('.sq');
    return hit && el.contains(hit) ? hit.dataset.square : null;
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
      drag.lvl = feel();
      drag.tilt = { x: e.clientX, tilt: 0 };
      liftGhost(drag.ghost, drag.lvl);
      document.body.append(drag.ghost);
      src.classList.add('dragging');
      opts.onDragStart?.(drag.from);
    }
    moveGhost(drag.ghost, e.clientX, e.clientY, drag.tilt, drag.lvl);
    const over = squareAt(e.clientX, e.clientY);
    const btn = squareEls.get(over);
    hover(btn && (btn.classList.contains('target') || btn.classList.contains('capture-target')) ? over : null);
  });
  const endDrag = (e, cancel = false) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (d.moved) {
      hover(null);
      const src = squareEls.get(d.from)?.querySelector('.piece');
      const home = squareEls.get(d.from)?.getBoundingClientRect();
      const snapBack = () => returnGhost(d.ghost, home, d.lvl, () => src?.classList.remove('dragging'));
      if (cancel) return snapBack();
      const to = squareAt(e.clientX, e.clientY);
      if (to && to !== d.from && opts.onDrop?.(d.from, to) !== false) {
        d.ghost.remove();
        src?.classList.remove('dragging');
        return;
      }
      snapBack(); // rejected, dropped back or off-board: it flies home
      if (!to || to === d.from) opts.onSquareClick?.(d.from); // dropped back / off-board: treat as a click on the origin
    } else if (!cancel) {
      opts.onSquareClick?.(d.from);
    }
  };
  el.addEventListener('pointerup', (e) => endDrag(e));
  el.addEventListener('pointercancel', (e) => endDrag(e, true));

  build();

  return {
    el,
    /**
     * @param {Array<{square,color,type}>} next
     * @param {object} [animate] a move {from,to,dragged?,hitStop?,captured?,onImpact?} or a drop {drop,dragged?,onImpact?}
     * @returns {number} ms until the piece lands (when onImpact fires); 0 without animation
     */
    render(next, animate) {
      pieces = next;
      return paint(animate);
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
    /** Float a short label (e.g. '+2 g') up from a square. kind: 'gain' | 'spend'. */
    flash(sq, text, kind = 'gain') {
      const btn = squareEls.get(sq);
      if (!btn) return;
      const tag = h('span', { class: `flash ${kind}`, 'aria-hidden': 'true' }, text);
      btn.append(tag);
      setTimeout(() => tag.remove(), 1400);
    },
    /** Square under a viewport point, if it is on this board. */
    squareAt,
    /** Mark the square a dragged piece/card would land on (null clears). */
    hover,
    /**
     * Drop forgiveness: for a point just OFF the board, the nearest of `squares`
     * within `frac` of a square's width (FEEL.forgiveness). Points on the board never snap.
     */
    nearestSquare(x, y, squares, frac = FEEL.forgiveness) {
      if (squareAt(x, y) || !squares.length) return null;
      const rects = squares.map((sq) => {
        const r = squareEls.get(sq).getBoundingClientRect();
        return { square: sq, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      return nearestTarget({ x, y }, rects, frac * (rects[0].right - rects[0].left));
    },
    /** Rejected input on a square: it shudders and flashes red (the caller plays the sound). */
    buzz(sq) {
      const btn = squareEls.get(sq);
      if (!btn || feel() === 'off') return;
      btn.classList.remove('buzz');
      void btn.offsetWidth; // restart the CSS flash
      btn.classList.add('buzz');
      later(380, () => btn.classList.remove('buzz'));
      btn.querySelector('.piece')?.animate(
        [0, -5, 5, -4, 3, -1, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 260, easing: 'linear' },
      );
    },
    destroy() {
      for (const id of timers) clearTimeout(id);
      timers.clear();
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
