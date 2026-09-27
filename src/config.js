// Chess Battle Simulator — game configuration.
//
// This is THE file to edit when balancing. Every number the design depends on
// lives here. After changing prices, caps, levels or AI presets, bump
// BALANCE_VERSION so telemetry from different balance passes can be told apart.

export const APP_VERSION = '0.5.0'; // keep in sync with package.json + CHANGELOG.md
export const BALANCE_VERSION = 'b5'; // b2 mid-battle shop; b3 bounty + AI shops; b4 no recruit phase — start with a king and gold; b5 L1 16 g vs garrison + 5 g

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

// The shop: there is no recruiting phase. Each side starts with its king (and,
// in a level, the enemy starts with its garrison) plus a purse of gold. On
// your turn you either move or buy ONE piece and drop it on an empty square
// of your deployment zone (ZONES below). Capturing enemy pieces earns more
// gold (CAPTURE_BOUNTY). Players can switch the bounty off in Settings;
// sessions record which rules were in force.
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
  effects: 'full', // game-feel level: 'full' | 'subtle' | 'off' (see FEEL below; recorded with every session)
  campaignAI: 'normal', // AI preset for campaign levels
  captureBounty: true, // rule: earn CAPTURE_BOUNTY gold for captures
  telemetryConsent: 'unset', // 'unset' | 'granted' | 'denied' — opt-in to sending sessions to TELEMETRY.endpoint
};

// Where each side may drop bought pieces (ranks are 1..8).
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

// Where the kings start when a side has no fixed army.
export const KING_START = { w: 'e1', b: 'e8' };

// Campaign levels. The player starts with a lone king and `gold`; the enemy
// garrison is fixed and on the board from move one (perfect information — you
// see exactly what you are buying against), and has `enemyGold` of its own to
// buy reinforcements with during the battle (0 if omitted).
export const LEVELS = [
  {
    id: 'L1',
    name: 'The Keep',
    blurb:
      'A small garrison shelters its king behind three pawns, with a war chest of its own for reinforcements. You arrive with only your king and a purse of gold. Buy one piece per turn, drop it into your back ranks, earn more by capturing, and break through to checkmate.',
    gold: 16,
    enemyGold: 5, // the garrison can buy a rook, or a minor piece and pawns
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

// Free mode: both sides start with a king and the same purse.
export const FREE_MODE = {
  golds: [8, 12, 20, 39],
  defaultGold: 20,
};

// Game feel (Lecture 2: juice). Presentation only: none of this changes the
// rules, the AI or the economy, so BALANCE_VERSION does not move when you tune
// it. Every effect is scaled by the "Effects" setting: 'full' uses these
// numbers, 'subtle' scales motion by `subtle.scale` and drops the extras, 'off'
// (or Animations off, or the OS "reduce motion" preference) shows none of it.
// Piece "value" below is its price in PRICES (P 1 … Q 9); a mate counts as MATE_VALUE.
export const FEEL = {
  levels: ['full', 'subtle', 'off'],
  // A piece move: pull back (anticipation), travel (slow in/out), overshoot and settle (follow-through), squash on landing.
  move: { baseMs: 150, perSquareMs: 22, maxMs: 320, anticipation: 0.07, overshoot: 0.06, squash: 0.12, settleMs: 140 },
  // A purchase lands like a rubber stamp; a dragged piece just thuds (it is already over the square).
  land: { stampMs: 360, dragMs: 200, squash: 0.16 },
  // Screen shake: px grows with the captured piece's value, capped so the board never leaves its gutter (16px).
  shake: { minPx: 1.5, pxPerValue: 1.05, maxPx: 12, baseMs: 160, msPerValue: 22, rotateDeg: 0.7 },
  // Hit-stop: the capturing piece freezes on impact for a few frames. Only heavy captures and mate.
  hitStop: { minValue: 5, captureMs: 70, mateMs: 240 },
  // Coins fly between the board and the purse; each coin that lands ticks the counter.
  coins: { max: 9, staggerMs: 55, flightMs: 480, arcPx: 46 },
  // Dragging a card or piece: it lifts and tilts with the pointer's speed.
  drag: { lift: 1.12, tiltPerPx: 0.9, maxTiltDeg: 14, smoothing: 0.35, returnMs: 220 },
  // Forgiveness ("coyote time" for drops): a card released just off the board edge
  // snaps to the nearest legal square within this fraction of a square.
  forgiveness: 0.6,
  // End of game: the mate stamp, the king topples, then the result dialog.
  finale: { stampMs: 520, resultDelayMs: 1500, confetti: 44 },
  subtle: { scale: 0.4, maxCoins: 3 },
};
export const MATE_VALUE = 12;

export const TELEMETRY = {
  storageKey: 'cbs.telemetry.v1',
  maxSessions: 1000,
  // Collector URL (Cloudflare Worker + D1, server/telemetry/). Sessions are
  // POSTed here only when the player has opted in (settings.telemetryConsent
  // === 'granted') — see src/telemetry/store.js `canSend`. null = local only
  // (localStorage + export/import).
  endpoint: 'https://chass-telemetry.lishuyustevenli.workers.dev/v1/sessions',
};
