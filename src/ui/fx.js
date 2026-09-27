// Game feel, the DOM half: plays the shapes computed in feel.js. Everything is
// printed matter: ink rings and spatter, rubber stamps, brass coins and paper
// chips. No glows, no gradients. Every effect checks the feel level first and
// does nothing at 'off', so the game state is never waiting on an animation.
//
//   const fx = createFx(boardCol, { level: () => 'full' });
//   fx.shake(9); fx.ink(squareEl, 'ally'); fx.coins(fromEl, toEl, plan, {...});
//   fx.stamp('Checkmate', { at: boardEl, kind: 'ally', size: 'big' }); fx.destroy();

import { FEEL } from '../config.js';
import { createLogger } from '../lib/log.js';
import { h } from './dom.js';
import { nextTilt, resolveFeel, shakeFor, shakeKeyframes } from './feel.js';

const log = createLogger('fx');

export function reducedMotion() {
  try {
    return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/** The effective feel level right now, from a settings object ({ get() }). */
export function currentFeel(settings) {
  return resolveFeel(settings.get(), reducedMotion());
}

const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

// ---------------------------------------------------------------- drag ghosts (position: fixed on <body>)

/** A dragged card/piece lifts off the page: bigger, with the offset print shadow. */
export function liftGhost(ghost, level) {
  if (level !== 'off') ghost.classList.add('lifted');
}

/** Follow the pointer; at 'full' the ghost tilts with horizontal speed. st = { x, tilt } is kept by the caller. */
export function moveGhost(ghost, x, y, st, level) {
  st.tilt = nextTilt(st.tilt ?? 0, x - (st.x ?? x), level);
  st.x = x;
  const lift = level === 'off' ? 1 : FEEL.drag.lift;
  ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${st.tilt.toFixed(2)}deg) scale(${lift})`;
}

/** Rejected drop: the ghost flies back to where it came from, then disappears. */
export function returnGhost(ghost, homeRect, level, done) {
  const finish = () => {
    ghost.remove();
    done?.();
  };
  if (level === 'off' || !homeRect) return finish();
  const c = center(homeRect);
  const a = ghost.animate(
    [{ transform: ghost.style.transform }, { transform: `translate(${c.x}px, ${c.y}px) translate(-50%, -50%) rotate(0deg) scale(1)`, opacity: 0.35 }],
    { duration: FEEL.drag.returnMs, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)', fill: 'forwards' },
  );
  a.onfinish = finish;
  a.oncancel = finish;
}

// ---------------------------------------------------------------- effects over the board column

/**
 * @param {HTMLElement} host the board column (position: relative); it is what shakes
 * @param {{ level: () => 'full'|'subtle'|'off' }} opts
 */
export function createFx(host, { level }) {
  const layer = h('div', { class: 'fx-layer', 'aria-hidden': 'true' });
  host.append(layer);
  const timers = new Set();
  let shakeAnim = null;
  let alive = true;

  const later = (ms, fn) => {
    if (!alive) return;
    if (ms <= 0) return fn();
    const id = setTimeout(() => {
      timers.delete(id);
      if (alive) fn();
    }, ms);
    timers.add(id);
  };
  /** Centre of an element in layer coordinates. */
  const at = (el) => {
    const base = layer.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2, w: r.width, h: r.height };
  };
  const put = (el, p) => {
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
    layer.append(el);
    return el;
  };
  const vanish = (el, anim) => {
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
  };

  return {
    layer,
    later,
    level,

    /** Shake the whole board column, scaled by the value of what was captured. */
    shake(value) {
      const s = shakeFor(value, level());
      if (!s) return;
      shakeAnim?.cancel();
      shakeAnim = host.animate(shakeKeyframes(s), { duration: s.ms, easing: 'linear' });
      log.debug('shake', value, s);
    },

    /** Ink rings (+ spatter at 'full') from a square. kind: 'ally'|'enemy'|'ink'|'gold'. reg: add a printer's registration mark. */
    ink(el, kind = 'ink', { reg = false, big = false } = {}) {
      const lvl = level();
      if (lvl === 'off' || !el) return;
      const p = at(el);
      const rings = lvl === 'full' ? (big ? 2 : 1) : 1;
      for (let i = 0; i < rings; i++) {
        const ring = put(h('i', { class: `fx-ring ${kind}${reg && i === 0 ? ' reg' : ''}`, style: { width: `${p.w}px`, height: `${p.w}px` } }), p);
        vanish(
          ring,
          ring.animate(
            [
              { transform: 'translate(-50%, -50%) scale(0.55)', opacity: 0.95, borderWidth: '5px' },
              { transform: `translate(-50%, -50%) scale(${1.5 + i * 0.45})`, opacity: 0, borderWidth: '1px' },
            ],
            { duration: 460 + i * 140, delay: i * 70, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)', fill: 'backwards' },
          ),
        );
      }
      if (lvl !== 'full') return;
      const dots = big ? 9 : 6;
      for (let i = 0; i < dots; i++) {
        const ang = (i / dots) * Math.PI * 2 + Math.random() * 0.6;
        const dist = p.w * (0.5 + Math.random() * 0.45);
        const size = 3 + Math.random() * 5;
        const dot = put(h('i', { class: `fx-dot ${kind}`, style: { width: `${size}px`, height: `${size}px` } }), p);
        vanish(
          dot,
          dot.animate(
            [
              { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
              { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0.5)`, opacity: 0 },
            ],
            { duration: 380 + Math.random() * 160, easing: 'cubic-bezier(0.1, 0.8, 0.3, 1)' },
          ),
        );
      }
    },

    /**
     * Coins flying from one element to another along an arc (a burst up, then gravity).
     * tick: 'leave' → onCoin fires as each coin departs (paying out of a purse);
     *       'land'  → onCoin fires as each coin arrives (a bounty counted into a purse).
     */
    coins(from, to, plan, { tick = 'land', onCoin } = {}) {
      if (!plan.length) return;
      const cfg = FEEL.coins;
      // from/to: elements, or functions returning the current element (panels are re-rendered between coins)
      const resolve = (x) => (typeof x === 'function' ? x() : x);
      for (const c of plan) {
        later(c.delay, () => {
          const fromEl = resolve(from);
          const toEl = resolve(to);
          if (!fromEl?.isConnected || !toEl?.isConnected) {
            onCoin?.(c); // nothing to animate between, but the count must still arrive
            return;
          }
          const a = at(fromEl);
          const b = at(toEl);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const jitter = (Math.random() - 0.5) * a.w * 0.6;
          const coin = put(h('i', { class: 'fx-coin' }), a);
          if (tick === 'leave') onCoin?.(c);
          coin.animate(
            [
              { transform: 'translate(-50%, -50%) scale(0.6)', easing: 'cubic-bezier(0.2, 0.9, 0.4, 1)' },
              { offset: 0.35, transform: `translate(calc(-50% + ${dx * 0.3 + jitter}px), calc(-50% + ${dy * 0.3 - cfg.arcPx}px)) scale(1.15)`, easing: 'cubic-bezier(0.6, 0, 0.9, 0.6)' },
              { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.8)` },
            ],
            { duration: cfg.flightMs, fill: 'forwards' },
          );
          // Timer, not onfinish: the counter must reach the true total even if an animation is cancelled.
          later(cfg.flightMs, () => {
            coin.remove();
            if (tick === 'land') onCoin?.(c);
          });
        });
      }
    },

    /** A rubber stamp slammed onto an element (a square, or the whole board). ttl: ms before it lifts; null keeps it. */
    stamp(text, { at: el, kind = 'ink', size = 'big', ttl = null } = {}) {
      if (level() === 'off' || !el) return null;
      const c = at(el);
      const p = size === 'small' ? { ...c, y: c.y - c.h * 0.62 } : c; // a small stamp sits just above its square
      const rot = size === 'big' ? -8 : -6;
      const s = put(h('div', { class: `fx-stamp ${size} ${kind}`, dataset: { testid: 'fx-stamp' } }, h('span', {}, text)), p);
      s.animate(
        [
          { transform: `translate(-50%, -50%) rotate(${rot - 7}deg) scale(${size === 'big' ? 2.3 : 1.9})`, opacity: 0, easing: 'cubic-bezier(0.55, 0, 0.9, 0.45)' },
          { offset: 0.55, transform: `translate(-50%, -50%) rotate(${rot}deg) scale(0.93)`, opacity: 0.92, easing: 'ease-out' },
          { transform: `translate(-50%, -50%) rotate(${rot}deg) scale(1)`, opacity: 0.92 },
        ],
        { duration: size === 'big' ? FEEL.finale.stampMs : 300, fill: 'forwards' },
      );
      if (ttl) later(ttl, () => vanish(s, s.animate([{ opacity: 0.92 }, { opacity: 0 }], { duration: 260, fill: 'forwards' })));
      return s;
    },

    /** Paper chips fluttering down the board column (a win). */
    confetti(n = FEEL.finale.confetti) {
      if (level() !== 'full') return;
      const w = layer.clientWidth;
      const hgt = layer.clientHeight;
      const kinds = ['ink', 'ally', 'enemy', 'gold', 'paper'];
      for (let i = 0; i < n; i++) {
        const chip = put(h('i', { class: `fx-chip ${kinds[i % kinds.length]}` }), { x: Math.random() * w, y: -12 });
        const sway = (Math.random() - 0.5) * 120;
        const spin = (Math.random() - 0.5) * 900;
        vanish(
          chip,
          chip.animate(
            [
              { transform: 'translate(0, 0) rotate(0deg) rotateX(0deg)' },
              { transform: `translate(${sway}px, ${hgt * 0.5}px) rotate(${spin / 2}deg) rotateX(360deg)`, offset: 0.5 },
              { transform: `translate(${-sway / 2}px, ${hgt + 24}px) rotate(${spin}deg) rotateX(720deg)` },
            ],
            { duration: 1500 + Math.random() * 1100, delay: Math.random() * 450, easing: 'cubic-bezier(0.3, 0.1, 0.7, 1)', fill: 'backwards' },
          ),
        );
      }
    },

    /** The losing king tips over: a small wobble (anticipation), then falls with gravity and bounces. */
    topple(img) {
      if (level() === 'off' || !img) return;
      img.style.transformOrigin = '50% 90%';
      img.animate(
        [
          { transform: 'rotate(0deg)' },
          { offset: 0.2, transform: 'rotate(-9deg)', easing: 'cubic-bezier(0.6, 0, 1, 0.6)' },
          { offset: 0.68, transform: 'rotate(88deg)', easing: 'ease-out' },
          { offset: 0.84, transform: 'rotate(76deg)', easing: 'ease-in' },
          { transform: 'rotate(84deg)', opacity: 0.8 },
        ],
        { duration: 820, fill: 'forwards' },
      );
    },

    /** A quick "bump" on an element (e.g. the purse as a coin lands in it). */
    bump(el) {
      if (level() === 'off' || !el) return;
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 150, easing: 'ease-out' });
    },

    destroy() {
      alive = false;
      for (const id of timers) clearTimeout(id);
      timers.clear();
      shakeAnim?.cancel();
      layer.remove();
    },
  };
}
