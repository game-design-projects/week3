// Free-mode alternating draft. Pure and immutable: every action returns a new state.
// On your turn buy exactly one piece or pass; passing locks your army. A side
// with nothing affordable auto-passes. Done when both have passed.

import { CAPS, FREE_MODE, PRICES } from '../config.js';
import { affordableTypes, armyCost, buy, canBuy, emptyArmy } from './army.js';

const other = (side) => (side === 'w' ? 'b' : 'w');

export function createDraft({ budget, first = FREE_MODE.draftFirst, prices = PRICES, caps = CAPS }) {
  const state = {
    budget,
    armies: { w: emptyArmy(), b: emptyArmy() },
    spent: { w: 0, b: 0 },
    passed: { w: false, b: false },
    turn: first,
    log: [],
    done: false,
    prices,
    caps,
  };
  return settle(state);
}

export function draftOptions(state, side) {
  if (state.done || state.passed[side]) return [];
  return affordableTypes(state.armies[side], state.budget, { prices: state.prices, caps: state.caps });
}

export function draftBuy(state, type) {
  if (state.done) throw new Error('draft is over');
  const side = state.turn;
  const check = canBuy(state.armies[side], type, state.budget, { prices: state.prices, caps: state.caps });
  if (!check.ok) throw new Error(`cannot buy ${type}: ${check.reason}`);
  const army = buy(state.armies[side], type);
  return advance({
    ...state,
    armies: { ...state.armies, [side]: army },
    spent: { ...state.spent, [side]: armyCost(army, state.prices) },
    log: [...state.log, { side, action: 'buy', type }],
  });
}

export function draftPass(state) {
  if (state.done) throw new Error('draft is over');
  const side = state.turn;
  return advance({
    ...state,
    passed: { ...state.passed, [side]: true },
    log: [...state.log, { side, action: 'pass' }],
  });
}

export function isDraftDone(state) {
  return state.done;
}

function advance(state) {
  const next = other(state.turn);
  return settle({ ...state, turn: state.passed[next] ? state.turn : next });
}

/** Apply auto-passes, then work out whose turn it is (or that the draft is over). */
function settle(state) {
  let s = state;
  for (const side of [s.turn, other(s.turn)]) {
    if (!s.passed[side] && draftOptions(s, side).length === 0) {
      s = { ...s, passed: { ...s.passed, [side]: true }, log: [...s.log, { side, action: 'pass', auto: true }] };
    }
  }
  if (s.passed.w && s.passed.b) return { ...s, done: true, turn: null };
  if (s.passed[s.turn]) s = { ...s, turn: other(s.turn) };
  return s;
}
