// Game feel, the pure half: how big, how long and in what shape each effect is.
// No DOM here, so all of it is unit-tested (tests/feel.test.js). The DOM half
// that plays these numbers lives in fx.js and board.js. Tunables: FEEL in config.js.
//
// Lecture 2 vocabulary used below:
//   anticipation  — a piece pulls back a hair before it travels
//   slow in / out — travel eases in and out instead of moving linearly
//   follow-through— it overshoots its square and settles back
//   squash        — it flattens on landing, like a wooden piece set down hard
//   hit-stop      — on a heavy capture it freezes for a few frames at impact
//   screenshake   — scaled to what was captured, so the shake *means* something

import { FEEL, MATE_VALUE, PRICES } from '../config.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const n2 = (v) => +v.toFixed(2) || 0; // 2 decimals, and never "-0"
const T = (x, y, sx = 1, sy = sx) => `translate(${n2(x)}px, ${n2(y)}px) scale(${n2(sx)}, ${n2(sy)})`;

/** 'full' | 'subtle' | 'off' from the settings; Animations off or OS reduced motion force 'off'. */
export function resolveFeel(settings = {}, reducedMotion = false) {
  const { effects = 'full', animations = true } = settings ?? {};
  if (!animations || reducedMotion) return 'off';
  return FEEL.levels.includes(effects) ? effects : 'full';
}

/** How much a piece "weighs" for effects: its price; the king (i.e. mate) is heavier than a queen. */
export function pieceValue(type) {
  if (type === 'k') return MATE_VALUE;
  return PRICES[type] ?? 0;
}

/** Shake size for a captured piece value: { px, ms, rot } or null for no shake. */
export function shakeFor(value, level, cfg = FEEL.shake) {
  if (level === 'off' || !(value > 0)) return null;
  const k = level === 'subtle' ? FEEL.subtle.scale : 1;
  return {
    px: n2(clamp(cfg.minPx + value * cfg.pxPerValue, 0, cfg.maxPx) * k),
    ms: Math.round(cfg.baseMs + value * cfg.msPerValue),
    rot: level === 'full' ? n2((cfg.rotateDeg * Math.min(value, 9)) / 9) : 0,
  };
}

/** WAAPI keyframes for a decaying shake (random jitter, ends at rest). */
export function shakeKeyframes({ px, ms, rot }, rand = Math.random) {
  const n = Math.max(4, Math.round(ms / 35));
  const frames = [];
  for (let i = 0; i < n; i++) {
    const decay = 1 - i / n;
    const x = (rand() * 2 - 1) * px * decay;
    const y = (rand() * 2 - 1) * px * decay;
    const r = (rand() * 2 - 1) * rot * decay;
    frames.push({ transform: `translate(${n2(x)}px, ${n2(y)}px) rotate(${n2(r)}deg)` });
  }
  frames.push({ transform: 'translate(0px, 0px) rotate(0deg)' });
  return frames;
}

/** Freeze-on-impact length: heavy captures and mate only, and only at 'full'. */
export function hitStopMs(value, mate, level, cfg = FEEL.hitStop) {
  if (level !== 'full') return 0;
  if (mate) return cfg.mateMs;
  return value >= cfg.minValue ? cfg.captureMs : 0;
}

/**
 * Keyframes for a piece that just moved. The piece's img is already on its new
 * square; (dx, dy) is where it came from, relative to there.
 * @returns {{ keyframes: Keyframe[], duration: number, impactAt: number } | null}
 *   impactAt — ms after start when it lands (after any hit-stop): fire the reaction then.
 */
export function moveMotion({ dx, dy, squarePx, level, hitStop = 0, dragged = false }, cfg = FEEL.move) {
  if (level === 'off') return null;
  const sq = level === 'full' ? cfg.squash : cfg.squash * FEEL.subtle.scale;
  if (dragged) {
    // The player carried it here: no travel, just the thud (and the freeze, if earned).
    const lift = FEEL.drag.lift;
    const duration = hitStop + cfg.settleMs;
    const at = (ms) => ms / duration;
    const keyframes = [{ offset: 0, transform: T(0, 0, lift) }];
    if (hitStop) keyframes.push({ offset: at(hitStop), transform: T(0, 0, lift) });
    keyframes.push({ offset: at(hitStop + cfg.settleMs * 0.4), transform: T(0, 0, 1 + sq, 1 - sq) }, { offset: 1, transform: T(0, 0) });
    return { keyframes, duration, impactAt: hitStop };
  }
  const dist = Math.hypot(dx, dy) || 1;
  const travel = Math.round(Math.min(cfg.baseMs + cfg.perSquareMs * (dist / squarePx), cfg.maxMs));
  if (level === 'subtle') {
    return {
      keyframes: [
        { offset: 0, transform: T(dx, dy), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        { offset: 1, transform: T(0, 0) },
      ],
      duration: travel,
      impactAt: Math.round(travel * 0.8),
    };
  }
  const ux = dx / dist;
  const uy = dy / dist;
  const back = cfg.anticipation * squarePx;
  const over = cfg.overshoot * squarePx;
  const duration = travel + hitStop + cfg.settleMs;
  const at = (ms) => ms / duration;
  const keyframes = [
    { offset: 0, transform: T(dx, dy), easing: 'ease-out' },
    // anticipation: lift and pull back, away from where it is going
    { offset: at(travel * 0.2), transform: T(dx + ux * back, dy + uy * back, 1.08), easing: 'cubic-bezier(0.6, 0, 0.25, 1)' },
    // slow in/out travel, arriving slightly past the square (follow-through)
    { offset: at(travel), transform: T(-ux * over, -uy * over, 1.05) },
  ];
  if (hitStop) keyframes.push({ offset: at(travel + hitStop), transform: T(-ux * over, -uy * over, 1.05) });
  keyframes.push(
    { offset: at(travel + hitStop + cfg.settleMs * 0.45), transform: T(0, 0, 1 + sq, 1 - sq), easing: 'ease-out' },
    { offset: 1, transform: T(0, 0) },
  );
  return { keyframes, duration, impactAt: travel + hitStop };
}

/** A bought piece arriving: stamped down from above (or, if dragged, just the thud). */
export function landMotion({ level, dragged = false }, cfg = FEEL.land) {
  if (level === 'off') return null;
  if (level === 'subtle') {
    const duration = Math.round(cfg.stampMs * 0.7);
    return {
      keyframes: [
        { offset: 0, transform: 'translateY(-10%) scale(1.12)', opacity: dragged ? 1 : 0 },
        { offset: 1, transform: 'translateY(0) scale(1)', opacity: 1 },
      ],
      duration,
      impactAt: Math.round(duration * 0.6),
    };
  }
  const sq = cfg.squash;
  if (dragged) {
    const duration = cfg.dragMs;
    return {
      keyframes: [
        { offset: 0, transform: `scale(${FEEL.drag.lift})`, easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)' },
        { offset: 0.35, transform: `scale(${1 + sq}, ${1 - sq})`, easing: 'ease-out' },
        { offset: 0.7, transform: 'scale(0.97, 1.04)' },
        { offset: 1, transform: 'scale(1, 1)' },
      ],
      duration,
      impactAt: Math.round(duration * 0.35),
    };
  }
  const duration = cfg.stampMs;
  return {
    keyframes: [
      { offset: 0, transform: 'translateY(-34%) scale(1.4)', opacity: 0, easing: 'ease-out' },
      { offset: 0.3, transform: 'translateY(-24%) scale(1.32)', opacity: 1, easing: 'cubic-bezier(0.55, 0, 0.9, 0.4)' },
      { offset: 0.55, transform: `translateY(0) scale(${1 + sq}, ${1 - sq})`, opacity: 1, easing: 'ease-out' },
      { offset: 0.78, transform: 'translateY(0) scale(0.97, 1.04)', opacity: 1 },
      { offset: 1, transform: 'translateY(0) scale(1, 1)', opacity: 1 },
    ],
    duration,
    impactAt: Math.round(duration * 0.55),
  };
}

/**
 * Coins counted out between the board and a purse: one coin per gold up to a cap
 * (then the gold is shared out, bigger coins first). Each coin that lands ticks
 * the counter by its value, so the display always ends on the true total.
 * @returns {Array<{ value: number, delay: number, index: number }>}
 */
export function coinPlan(amount, level, cfg = FEEL.coins) {
  if (level === 'off' || !(amount > 0)) return [];
  const n = Math.min(amount, level === 'subtle' ? FEEL.subtle.maxCoins : cfg.max);
  const base = Math.floor(amount / n);
  const extra = amount - base * n;
  return Array.from({ length: n }, (_, i) => ({ value: base + (i < extra ? 1 : 0), delay: i * cfg.staggerMs, index: i }));
}

/** Tilt (degrees) of a dragged card/piece from its horizontal pointer movement, smoothed. */
export function nextTilt(prev, dx, level, cfg = FEEL.drag) {
  if (level !== 'full') return 0;
  const target = clamp(dx * cfg.tiltPerPx, -cfg.maxTiltDeg, cfg.maxTiltDeg);
  return prev + (target - prev) * cfg.smoothing;
}

/**
 * Drop forgiveness: the legal square whose rect is nearest to `point`, if within
 * `maxDist` px (0 when the point is inside it). rects: [{square,left,top,right,bottom}].
 */
export function nearestTarget(point, rects, maxDist) {
  let best = null;
  let bestD = Infinity;
  for (const r of rects) {
    const dx = Math.max(r.left - point.x, 0, point.x - r.right);
    const dy = Math.max(r.top - point.y, 0, point.y - r.bottom);
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = r.square;
    }
  }
  return bestD <= maxDist ? best : null;
}
