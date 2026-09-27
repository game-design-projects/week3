// Session recorder: follows one play session through its lifecycle
//   begin → purchase*/draftStep* → startBattle → ply* → end | abandon
// and saves the finished record to the store (schema in PLAN / README).

import { APP_VERSION, BALANCE_VERSION } from '../config.js';
import { armyCost, armyLabel } from '../core/army.js';
import { createLogger } from '../lib/log.js';
import { randomId } from './store.js';

const log = createLogger('telemetry');

function sideSummary(side) {
  if (!side) return null;
  return {
    army: { ...side.army },
    label: armyLabel(side.army),
    spend: armyCost(side.army),
    reserve: side.reserve ?? 0, // unspent gold carried into battle for reinforcements
    placement: side.placement.map((p) => ({ ...p })),
  };
}

function resultFor(playerSide, winner) {
  if (winner === null || winner === undefined) return 'draw';
  const me = playerSide ?? 'w'; // hotseat: reported from White's point of view
  return winner === me ? 'win' : 'loss';
}

/**
 * @param {{ store: ReturnType<import('./store.js').createStore>, now?: () => number }} deps
 */
export function createRecorder({ store, now = () => Date.now() }) {
  let current = null;
  let t0 = 0;
  let battleT0 = 0;
  const iso = (ms) => new Date(ms).toISOString();

  const finish = (fields) => {
    const t = now();
    const s = current;
    Object.assign(s, fields);
    s.endedAt = iso(t);
    s.totalMs = t - t0;
    if (s.battleStartedAt) s.battleMs = t - battleT0;
    else s.buyMs = t - t0;
    store.save(s);
    log.info(`session ${s.id} ${s.result}${s.endReason ? ` (${s.endReason})` : ''}`);
    current = null;
    return s;
  };

  return {
    active() {
      return current ? JSON.parse(JSON.stringify(current)) : null;
    },

    begin({ mode, levelId = null, opponent = 'ai', aiPreset = null, budget, playerSide = 'w', reusedArmy = false }) {
      if (current) this.abandon();
      t0 = now();
      const previous = store
        .sessions()
        .filter((s) => s.playerId === store.playerId && s.mode === mode && (s.levelId ?? null) === levelId).length;
      current = {
        schema: 1,
        id: randomId('s'),
        playerId: store.playerId,
        appVersion: APP_VERSION,
        balanceVersion: BALANCE_VERSION,
        mode,
        levelId,
        opponent,
        aiPreset,
        budget,
        playerSide,
        attempt: previous + 1,
        reusedArmy,
        startedAt: iso(t0),
        battleStartedAt: null,
        endedAt: null,
        buyMs: null,
        battleMs: null,
        totalMs: null,
        phaseReached: 'buy',
        purchases: [],
        draft: mode === 'free' ? [] : null,
        white: null,
        black: null,
        startFen: null,
        finalFen: null,
        pgn: null,
        plies: 0,
        materialTimeline: [],
        drops: [], // mid-battle purchases: { ply, side, type, square, cost }
        winner: null,
        endReason: null,
        result: null,
      };
      log.debug('begin', current.id, mode, levelId, `attempt ${current.attempt}`);
      return current.id;
    },

    purchase(side, action, type) {
      if (!current) return;
      current.purchases.push({ t: now() - t0, side, action, type });
    },

    draftStep(entry) {
      if (!current) return;
      (current.draft ??= []).push({ ...entry });
    },

    startBattle({ white, black, startFen }) {
      if (!current) return;
      battleT0 = now();
      current.battleStartedAt = iso(battleT0);
      current.buyMs = battleT0 - t0;
      current.phaseReached = 'battle';
      current.white = sideSummary(white);
      current.black = sideSummary(black);
      current.startFen = startFen;
    },

    ply({ san, materialDiff }) {
      if (!current) return;
      current.plies += 1;
      current.materialTimeline.push(materialDiff);
      log.debug('ply', current.plies, san);
    },

    /** A mid-battle purchase (reinforcement drop); also counts as a ply. */
    drop({ side, type, square, cost, san, materialDiff }) {
      if (!current) return;
      current.plies += 1;
      current.materialTimeline.push(materialDiff);
      current.drops.push({ ply: current.plies, side, type, square, cost });
      current.purchases.push({ t: now() - t0, side, action: 'drop', type, ply: current.plies });
      log.debug('drop', current.plies, san);
    },

    end({ winner, reason, pgn, finalFen }) {
      if (!current) return null;
      return finish({
        winner: winner ?? null,
        endReason: reason,
        pgn,
        finalFen,
        phaseReached: 'done',
        result: resultFor(current.playerSide, winner),
      });
    },

    abandon() {
      if (!current) return null;
      return finish({ result: 'abandoned', endReason: 'abandoned' });
    },
  };
}
