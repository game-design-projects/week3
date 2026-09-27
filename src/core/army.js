// Army = how many of each buyable piece a side owns. The king is implied
// (always exactly one, free) and never counted here.

import { CAPS, PIECE_NAMES, PIECE_TYPES, PRICES } from '../config.js';

/** @returns {{q:number,r:number,b:number,n:number,p:number}} */
export function emptyArmy() {
  return { q: 0, r: 0, b: 0, n: 0, p: 0 };
}

/** Total gold spent on an army. */
export function armyCost(army, prices = PRICES) {
  return PIECE_TYPES.reduce((sum, t) => sum + (army[t] ?? 0) * prices[t], 0);
}

/** Number of pieces excluding the king. */
export function pieceCount(army) {
  return PIECE_TYPES.reduce((sum, t) => sum + (army[t] ?? 0), 0);
}

/**
 * Can this army afford one more `type`?
 * Cap is reported before budget: "you already own the maximum" is the more useful explanation.
 * @returns {{ok: boolean, reason?: 'cap'|'budget'|'unknown-type'}}
 */
export function canBuy(army, type, budget, { prices = PRICES, caps = CAPS } = {}) {
  if (!PIECE_TYPES.includes(type)) return { ok: false, reason: 'unknown-type' };
  if ((army[type] ?? 0) >= caps[type]) return { ok: false, reason: 'cap' };
  if (armyCost(army, prices) + prices[type] > budget) return { ok: false, reason: 'budget' };
  return { ok: true };
}

/** Immutable add. Does not check budget or caps — callers use canBuy(). */
export function buy(army, type) {
  if (!PIECE_TYPES.includes(type)) throw new Error(`unknown piece type: ${type}`);
  return { ...army, [type]: (army[type] ?? 0) + 1 };
}

/** Immutable remove. Throws when there is none to sell. */
export function sell(army, type) {
  if (!PIECE_TYPES.includes(type)) throw new Error(`unknown piece type: ${type}`);
  if (!army[type]) throw new Error(`no ${PIECE_NAMES[type].toLowerCase()} to sell`);
  return { ...army, [type]: army[type] - 1 };
}

/** Piece types that can still be bought, in PIECE_TYPES order. */
export function affordableTypes(army, budget, opts = {}) {
  return PIECE_TYPES.filter((t) => canBuy(army, t, budget, opts).ok);
}

/** Canonical label: 'Q+2R+B+N+3P'; 'King only' for an empty army. */
export function armyLabel(army) {
  const parts = PIECE_TYPES.filter((t) => army[t] > 0).map(
    (t) => `${army[t] > 1 ? army[t] : ''}${t.toUpperCase()}`,
  );
  return parts.length ? parts.join('+') : 'King only';
}

/** Inverse of armyLabel. Tolerates spaces and lowercase. */
export function armyFromLabel(label) {
  const text = String(label).trim();
  const army = emptyArmy();
  if (/^king only$/i.test(text)) return army;
  for (const raw of text.split('+')) {
    const m = /^(\d*)([qrbnp])$/i.exec(raw.trim());
    if (!m) throw new Error(`bad army label: "${label}"`);
    const type = m[2].toLowerCase();
    army[type] += m[1] ? Number(m[1]) : 1;
  }
  return army;
}

/** Count the non-king pieces of a placement. */
export function armyFromPlacement(placement) {
  const army = emptyArmy();
  for (const { type } of placement) if (type in army) army[type] += 1;
  return army;
}

/**
 * Every army with minSpend <= cost <= budget within caps, in a deterministic
 * order (queens first, then rooks, … pawns). Used by the balance simulator.
 */
export function enumerateArmies(budget, { prices = PRICES, caps = CAPS, minSpend = 0 } = {}) {
  const out = [];
  const walk = (i, army, cost) => {
    if (i === PIECE_TYPES.length) {
      if (cost >= minSpend) out.push({ ...army });
      return;
    }
    const t = PIECE_TYPES[i];
    for (let n = 0; n <= caps[t] && cost + n * prices[t] <= budget; n++) {
      army[t] = n;
      walk(i + 1, army, cost + n * prices[t]);
    }
    army[t] = 0;
  };
  walk(0, emptyArmy(), 0);
  return out;
}
