#!/usr/bin/env node
// Headless AI-vs-AI balance simulator for Level 1 (b4 rules: no recruit phase).
// White starts with a lone king and `gold`, Black is the level's garrison;
// both sides shop during the battle. White is played by an AI preset as a
// stand-in for a decent human — treat results as a prior, not a verdict.
//
//   pnpm sim -- --gold 10,12,14,16 --games 6
//   pnpm sim -- --gold 12 --games 20 --player-preset hard --json out.json
//
// Flags: --gold list  --games N  --preset normal (enemy)  --player-preset normal
//        --seed 1  --max-plies 160  --json out.json
import { writeFile } from 'node:fs/promises';
import { AI_PRESETS, LEVELS } from '../src/config.js';
import { Match } from '../src/core/game.js';
import { buildFen } from '../src/core/placement.js';
import { levelStart } from '../src/core/start.js';
import { chooseMove } from '../src/ai/search.js';

/** Play one AI-vs-AI game from a start ({white, black} with placements + reserves). */
export function simulateGame({ white, black, whitePreset, blackPreset, seed = 1, maxPlies = 160 }) {
  const startFen = buildFen(white.placement, black.placement);
  const match = new Match({ startFen, reserve: { w: white.reserve ?? 0, b: black.reserve ?? 0 } });
  while (!match.status().over && match.plies() < maxPlies) {
    const side = match.turn();
    const r = chooseMove({
      ...match.aiRequest(),
      preset: side === 'w' ? whitePreset : blackPreset,
      seed: seed * 1000 + match.plies(),
      shop: match.reserve[side] > 0 ? { reserve: match.reserve[side] } : null,
    });
    if (r.drop) match.drop(r.drop.type, r.drop.square);
    else match.move({ from: r.from, to: r.to, promotion: r.promotion });
  }
  const st = match.status();
  const base = { plies: match.plies(), pgn: match.pgn(), drops: match.drops(), earned: match.earned() };
  return st.over ? { ...base, winner: st.winner, reason: st.reason } : { ...base, winner: null, reason: 'max-plies' };
}

/** For each starting gold, play `games` games of Level 1. */
export function runSim({ golds = [LEVELS[0].gold], games = 4, preset = 'normal', playerPreset = 'normal', seed = 1, maxPlies = 160, level = LEVELS[0], onRow } = {}) {
  const rows = [];
  for (const gold of golds) {
    const row = { gold, games: 0, wins: 0, draws: 0, losses: 0, plies: 0, reasons: {}, firstBuys: {} };
    for (let g = 0; g < games; g++) {
      const start = levelStart({ ...level, gold });
      const r = simulateGame({ ...start, whitePreset: AI_PRESETS[playerPreset], blackPreset: AI_PRESETS[preset], seed: seed + g * 7 + gold, maxPlies });
      row.games += 1;
      row.plies += r.plies;
      row.reasons[r.reason] = (row.reasons[r.reason] ?? 0) + 1;
      const first = r.drops.find((d) => d.color === 'w');
      if (first) row.firstBuys[first.type] = (row.firstBuys[first.type] ?? 0) + 1;
      if (r.winner === 'w') row.wins += 1;
      else if (r.winner === 'b') row.losses += 1;
      else row.draws += 1;
    }
    row.winRate = row.wins / row.games;
    row.avgPlies = row.plies / row.games;
    rows.push(row);
    onRow?.(row);
  }
  return rows;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i].length > 2) out[argv[i].slice(2)] = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i];
  }
  return out;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  const level = LEVELS[0];
  const golds = String(a.gold ?? level.gold).split(',').map(Number);
  const games = Number(a.games ?? 4);
  console.log(`[sim] Level ${level.id} "${level.name}": gold ${golds.join('/')} × ${games} games, enemy=${a.preset ?? 'normal'}, player=${a['player-preset'] ?? 'normal'}`);
  const t0 = Date.now();
  const rows = runSim({
    golds,
    games,
    preset: a.preset ?? 'normal',
    playerPreset: a['player-preset'] ?? 'normal',
    seed: Number(a.seed ?? 1),
    maxPlies: Number(a['max-plies'] ?? 160),
    onRow: (r) => console.log(`[sim] gold ${r.gold}: W${r.wins} D${r.draws} L${r.losses}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`),
  });
  console.log('\ngold  games   W   D   L   win%  avg plies  first buy');
  for (const r of rows) {
    const first = Object.entries(r.firstBuys).map(([t, n]) => `${t.toUpperCase()}×${n}`).join(' ');
    console.log(`${String(r.gold).padStart(4)} ${String(r.games).padStart(6)} ${String(r.wins).padStart(3)} ${String(r.draws).padStart(3)} ${String(r.losses).padStart(3)}  ${(r.winRate * 100).toFixed(0).padStart(4)}%  ${r.avgPlies.toFixed(0).padStart(9)}  ${first}`);
  }
  if (a.json) await writeFile(a.json, JSON.stringify(rows, null, 1));
}
