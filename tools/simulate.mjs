#!/usr/bin/env node
// Headless AI-vs-AI balance simulator for Level 1.
// The player's side is played by an AI preset as a stand-in for a decent human,
// so treat results as a rough prior before real playtest data exists.
//
//   pnpm sim -- --games 4 --armies "Q+3P,2R+2P"
//   pnpm sim -- --min-spend 12 --games 2 --json docs/sim.json
//
// Flags: --games N  --preset normal (enemy)  --player-preset normal
//        --armies all|"A,B"  --min-spend 11  --seed 1  --max-plies 160  --json out.json
import { writeFile } from 'node:fs/promises';
import { AI_PRESETS, LEVELS } from '../src/config.js';
import { armyCost, armyFromLabel, armyFromPlacement, armyLabel, enumerateArmies } from '../src/core/army.js';
import { autoPlace } from '../src/core/autoplace.js';
import { Match } from '../src/core/game.js';
import { buildFen } from '../src/core/placement.js';
import { chooseMove } from '../src/ai/search.js';
import { createRng } from '../src/lib/rng.js';

/** Play one AI-vs-AI game. */
export function simulateGame({ white, black, whitePreset, blackPreset, seed = 1, maxPlies = 160 }) {
  const startFen = buildFen(white.placement, black.placement);
  const match = new Match({ startFen });
  while (!match.status().over && match.plies() < maxPlies) {
    const preset = match.turn() === 'w' ? whitePreset : blackPreset;
    const r = chooseMove({ startFen, moves: match.historyUci(), preset, seed: seed * 1000 + match.plies() });
    match.move({ from: r.from, to: r.to, promotion: r.promotion });
  }
  const st = match.status();
  return st.over
    ? { winner: st.winner, reason: st.reason, plies: match.plies(), pgn: match.pgn() }
    : { winner: null, reason: 'max-plies', plies: match.plies(), pgn: match.pgn() };
}

/** Run every army `games` times against the Level 1 enemy. */
export function runSim({ armies, games = 2, preset = 'normal', playerPreset = 'normal', seed = 1, maxPlies = 160, level = LEVELS[0], onRow } = {}) {
  const enemy = { army: armyFromPlacement(level.enemy), placement: level.enemy };
  const rows = [];
  for (const army of armies) {
    const row = { label: armyLabel(army), spend: armyCost(army), games: 0, wins: 0, draws: 0, losses: 0, plies: 0, reasons: {} };
    for (let g = 0; g < games; g++) {
      const rng = createRng(seed * 7919 + g * 104729 + row.spend);
      const white = { army, placement: autoPlace('w', army, { rng, opponent: level.enemy }) };
      const r = simulateGame({ white, black: enemy, whitePreset: AI_PRESETS[playerPreset], blackPreset: AI_PRESETS[preset], seed: seed + g, maxPlies });
      row.games += 1;
      row.plies += r.plies;
      row.reasons[r.reason] = (row.reasons[r.reason] ?? 0) + 1;
      if (r.winner === 'w') row.wins += 1;
      else if (r.winner === 'b') row.losses += 1;
      else row.draws += 1;
    }
    row.winRate = row.wins / row.games;
    row.avgPlies = row.plies / row.games;
    rows.push(row);
    onRow?.(row);
  }
  return rows.sort((a, b) => b.winRate - a.winRate || a.avgPlies - b.avgPlies);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
  }
  return out;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  const level = LEVELS[0];
  const armies =
    !a.armies || a.armies === 'all'
      ? enumerateArmies(level.budget, { minSpend: Number(a['min-spend'] ?? level.budget - 1) })
      : String(a.armies).split(',').map(armyFromLabel);
  const games = Number(a.games ?? 2);
  console.log(`[sim] Level ${level.id} "${level.name}": ${armies.length} armies × ${games} games, enemy=${a.preset ?? 'normal'}, player=${a['player-preset'] ?? 'normal'}`);
  const t0 = Date.now();
  const rows = runSim({
    armies,
    games,
    preset: a.preset ?? 'normal',
    playerPreset: a['player-preset'] ?? 'normal',
    seed: Number(a.seed ?? 1),
    maxPlies: Number(a['max-plies'] ?? 160),
    onRow: (r) => console.log(`[sim] ${r.label.padEnd(14)} W${r.wins} D${r.draws} L${r.losses}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`),
  });
  console.log('\narmy            gold  games   W   D   L   win%  avg plies');
  for (const r of rows) {
    console.log(`${r.label.padEnd(15)} ${String(r.spend).padStart(4)} ${String(r.games).padStart(6)} ${String(r.wins).padStart(3)} ${String(r.draws).padStart(3)} ${String(r.losses).padStart(3)}  ${(r.winRate * 100).toFixed(0).padStart(4)}%  ${r.avgPlies.toFixed(0).padStart(9)}`);
  }
  if (a.json) await writeFile(a.json, JSON.stringify(rows, null, 1));
}
