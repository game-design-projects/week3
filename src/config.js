// Chess Battle Simulator — game configuration.
//
// This is THE file to edit when balancing. Every number the design depends on
// lives here. After changing prices, caps, levels or AI presets, bump
// BALANCE_VERSION so telemetry from different balance passes can be told apart.

export const APP_VERSION = '0.3.1'; // keep in sync with package.json + CHANGELOG.md
export const BALANCE_VERSION = 'b3'; // b2: mid-battle purchases; b3: capture bounty + AI shops too

// Buyable piece types, in display order. The king is free and mandatory.
export const PIECE_TYPES = ['q', 'r', 'b', 'n', 'p'];

export const PIECE_NAMES = {
  k: 'King',
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
  p: 'Pawn',
};

// Gold cost per piece (classic point values).
export const PRICES = { q: 9, r: 5, b: 3, n: 3, p: 1 };

// Max copies of each piece one side may own — a standard chess set.
// Stops queen spam in free mode and bounds army size (15 + king = 16 squares).
export const CAPS = { q: 1, r: 2, b: 2, n: 2, p: 8 };

// Mid-battle purchases ("the shop"): gold left unspent after recruiting is
// kept, and capturing enemy pieces earns more (CAPTURE_BOUNTY). On your turn
// you may, instead of moving, buy a piece and drop it on an empty square of
// your deployment zone (same ZONES as below). Both rules can be switched off
// by players in Settings; sessions record which rules were in force.
export const CAPTURE_BOUNTY = { p: 1, n: 1, b: 1, r: 2, q: 4 };

// Gold held in reserve is worth this many centipawns per gold to the AI when it
// weighs "drop a piece now" against "keep the gold" (below 100 so it prefers
// to spend when a drop is useful).
export const AI_GOLD_VALUE_CP = 80;

// Player settings and their defaults (persisted per browser).
export const DEFAULT_SETTINGS = {
  sound: true,
  showHints: true, // legal-move dots
  showCoords: true,
  animations: true,
  campaignAI: 'normal', // AI preset for campaign levels
  battleShop: true, // rule: buy + drop pieces during the battle
  captureBounty: true, // rule: earn CAPTURE_BOUNTY gold for captures
};

// Where each side may place pieces before the battle (ranks are 1..8).
// Non-pawns may use any rank in `ranks`; pawns only `pawnRanks`.
export const ZONES = {
  w: { ranks: [1, 2], pawnRanks: [2] },
  b: { ranks: [7, 8], pawnRanks: [7] },
};

// AI difficulty presets.
//   depth      — full-width alpha-beta plies
//   quiescence — max extra capture-only plies at the leaves (0 = off)
//   windowCp   — picks uniformly among moves scoring within this many
//                centipawns of the best move (0 = always best). Never applied
//                when a forced mate is on the board.
//   maxMs      — hard time cap per move (iterative deepening stops early)
export const AI_PRESETS = {
  easy: { label: 'Recruit', depth: 1, quiescence: 2, windowCp: 150, maxMs: 800 },
  normal: { label: 'Captain', depth: 2, quiescence: 4, windowCp: 40, maxMs: 1500 },
  hard: { label: 'Warlord', depth: 4, quiescence: 6, windowCp: 0, maxMs: 2500 },
};

// Minimum time the UI waits before showing an AI move, so replies don't feel instant.
export const AI_MIN_THINK_MS = 450;

// Campaign levels. The enemy army is fixed and shown to the player during the
// buy phase (perfect information — a deliberate design choice so that thinking
// harder about the matchup pays off).
export const LEVELS = [
  {
    id: 'L1',
    name: 'The Keep',
    blurb:
      'A small garrison shelters its king behind three pawns. Hire an army with 12 gold, keep some back or earn more by capturing, and buy reinforcements mid-battle until you deliver checkmate.',
    budget: 12,
    playerSide: 'w',
    aiPreset: 'normal',
    enemy: [
      { type: 'k', square: 'g8' },
      { type: 'r', square: 'd8' },
      { type: 'b', square: 'e7' },
      { type: 'p', square: 'f7' },
      { type: 'p', square: 'g7' },
      { type: 'p', square: 'h7' },
    ],
  },
];

// Free mode: both sides draft an army from the same budget, one piece at a time.
export const FREE_MODE = {
  budgets: [8, 12, 20, 39],
  defaultBudget: 20,
  // Black drafts first to offset White moving first in the battle.
  draftFirst: 'b',
};

export const TELEMETRY = {
  storageKey: 'cbs.telemetry.v1',
  maxSessions: 1000,
  // Optional collector URL. null = local only (localStorage + export/import).
  // When set, each finished session is POSTed there as JSON via sendBeacon.
  endpoint: null,
};
