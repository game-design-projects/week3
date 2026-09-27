// Leaderboard rules, shared by the game and the leaderboard server
// (server/telemetry/src/leaderboard.js imports this file by relative path).
//
// The server never trusts a number the client reports. A submission carries
// the official start and the full move/drop list, and replaySubmission() plays
// it again with a fresh Match (the same rules code the game uses). The score
// comes only from that replay: how many plies it took and how much gold White
// had left when the mate landed.
//
// Board key: (level, balance version, AI preset). Only the DEFAULT rules are
// ranked (captureBounty on). The bounty changes how much gold you end with, so
// games played with it off are rejected instead of getting boards of their own.
//
// Ranking: fewer plies first (White moves first and delivers the mate, so this
// is the same as fewer player moves), then more gold left, then the earlier
// score. compareScores() is that order, and the SQL in the server matches it.

import { AI_PRESETS, BALANCE_VERSION, LEVELS } from '../config.js';
import { Match } from './game.js';
import { buildFen } from './placement.js';
import { levelStart } from './start.js';

export const MAX_PLIES = 400;
export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const DROP_RE = /^([QRBNP])@([a-h][1-8])$/;

/** A clear, fixed-shape rejection. `status` is the HTTP status the server answers with. */
function reject(code, error, status = 422) {
  return { ok: false, code, error, status };
}

/** The official start of a level: the FEN and both purses, exactly as the game builds them. */
export function officialStart(level) {
  const start = levelStart(level);
  return {
    startFen: buildFen(start.white.placement, start.black.placement),
    reserve: { w: start.white.reserve ?? 0, b: start.black.reserve ?? 0 },
  };
}

// ---------------------------------------------------------------- nicknames

// A short blocklist of obvious slurs and profanity. It is not meant to be
// complete: moderation (DELETE /v1/scores/:id) handles the rest.
// ROOTS match anywhere in the squashed name; WORDS only as a whole word, since
// they hide inside ordinary words (grape, cockatoo, class).
const ROOTS = ['fuck', 'shit', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'bitch', 'hitler', 'kike', 'motherf'];
const WORDS = ['ass', 'asshole', 'cock', 'cum', 'cunt', 'dick', 'fag', 'nazi', 'penis', 'porn', 'pussy', 'rape', 'sex', 'slut', 'spic', 'chink', 'tits', 'twat', 'wank'];
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's' };

const unleet = (s) => s.toLowerCase().replace(/[0134578@$]/g, (c) => LEET[c]);

/** True when a (cleaned) nickname hits the blocklist. */
export function isBlockedNickname(name) {
  const plain = unleet(name);
  const squashed = plain.replace(/[\s_-]+/g, '');
  if (ROOTS.some((r) => squashed.includes(r))) return true;
  return plain.split(/[\s_-]+/).some((w) => WORDS.includes(w));
}

/**
 * Clean and check a nickname: trim, collapse whitespace, 3–16 characters from
 * letters (any script), digits, space, `_` and `-`, not on the blocklist.
 * @returns {{ok:true, nickname:string} | {ok:false, code:string, error:string, status:number}}
 */
export function cleanNickname(raw) {
  if (typeof raw !== 'string') return reject('bad-nickname', 'Pick a nickname.');
  if (/[<>&"'`/\\]/.test(raw)) return reject('bad-nickname', 'No HTML or symbols in the nickname, please.');
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  const length = [...name].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) return reject('bad-nickname', `Use ${NICKNAME_MIN} to ${NICKNAME_MAX} characters.`);
  if (!/^[\p{L}\p{M}\p{Nd} _-]+$/u.test(name)) return reject('bad-nickname', 'Letters, digits, spaces, _ and - only.');
  if (!/[\p{L}\p{Nd}]/u.test(name)) return reject('bad-nickname', 'Use at least one letter or digit.');
  if (isBlockedNickname(name)) return reject('bad-nickname', 'Please pick a different nickname.');
  return { ok: true, nickname: name };
}

// ---------------------------------------------------------------- replay

/**
 * Replay a submitted game and compute its score.
 * @param {{levelId, balanceVersion, aiPreset, startFen, reserve:{w,b}, rules, moves:string[]}} sub
 * @returns {{ok:true, levelId, balanceVersion, aiPreset, plies, moves, goldLeft, goldSpent, pgn} | {ok:false, code, error, status}}
 */
export function replaySubmission(sub) {
  if (!sub || typeof sub !== 'object' || Array.isArray(sub)) return reject('bad-body', 'Expected a JSON object.', 400);

  const level = LEVELS.find((l) => l.id === sub.levelId);
  if (!level) return reject('bad-level', `Unknown level ${String(sub.levelId).slice(0, 20)}.`);
  if (sub.balanceVersion !== BALANCE_VERSION) return reject('stale-balance', `This game was played under rules ${String(sub.balanceVersion).slice(0, 20)}; the leaderboard ranks ${BALANCE_VERSION} only.`);
  if (typeof sub.aiPreset !== 'string' || !Object.hasOwn(AI_PRESETS, sub.aiPreset)) return reject('bad-ai', 'Unknown AI difficulty.');
  if (!sub.rules || sub.rules.captureBounty !== true) return reject('house-rules', 'Only games with the standard rules (capture bounty on) are ranked.');

  const official = officialStart(level);
  const reserve = sub.reserve ?? {};
  if (sub.startFen !== official.startFen || reserve.w !== official.reserve.w || reserve.b !== official.reserve.b) {
    return reject('bad-start', `The game does not start from ${level.name}'s official position and purses.`);
  }

  const moves = sub.moves;
  if (!Array.isArray(moves) || moves.length === 0) return reject('no-moves', 'No moves to replay.', 400);
  if (moves.length > MAX_PLIES) return reject('too-long', `Games over ${MAX_PLIES} plies are not ranked.`);

  const match = new Match({ startFen: official.startFen, reserve: official.reserve, rules: {} });
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    const where = `ply ${i + 1}`;
    if (typeof mv !== 'string') return reject('illegal-move', `Move at ${where} is not a string.`);
    try {
      const drop = DROP_RE.exec(mv);
      if (drop) match.drop(drop[1].toLowerCase(), drop[2]);
      else if (UCI_RE.test(mv)) match.move(mv);
      else return reject('illegal-move', `Cannot read move "${mv.slice(0, 12)}" at ${where}.`);
    } catch (e) {
      return reject('illegal-move', `Illegal move "${mv}" at ${where} (${e.message}).`);
    }
  }

  const st = match.status();
  if (!(st.over && st.reason === 'checkmate' && st.winner === level.playerSide)) {
    return reject('not-a-win', 'The game does not end with your checkmate.');
  }
  const plies = match.plies();
  return {
    ok: true,
    levelId: level.id,
    balanceVersion: BALANCE_VERSION,
    aiPreset: sub.aiPreset,
    plies,
    moves: Math.ceil(plies / 2), // the player's own moves (White moves first and last)
    goldLeft: match.reserve[level.playerSide],
    goldSpent: match.drops().filter((d) => d.color === level.playerSide).reduce((sum, d) => sum + d.cost, 0),
    pgn: match.pgn(),
  };
}

/**
 * Leaderboard order: fewer plies, then more gold left, then earlier createdAt, then id.
 * Works on {plies, goldLeft, createdAt, id} objects.
 */
export function compareScores(a, b) {
  return a.plies - b.plies || b.goldLeft - a.goldLeft || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Is `a` a strictly better score than `b` (ignoring when it was set)? */
export function isBetterScore(a, b) {
  return a.plies < b.plies || (a.plies === b.plies && a.goldLeft > b.goldLeft);
}
