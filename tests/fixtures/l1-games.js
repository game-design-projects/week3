// Real Level 1 games (balance b5), found by letting a depth-3 AI play White
// against the Recruit AI with fixed seeds (no time cap, so reproducible).
// Each ends in White's checkmate. Used by the leaderboard tests; they re-check
// the result with Match before relying on it, so a rules change that breaks a
// line fails loudly instead of silently testing the wrong thing.

/** 7 plies (4 player moves), 3 gold left: Q@c2, R@h1, Rxh5 (+1 g), Qh7#. */
export const WIN_7 = ['Q@c2', 'B@e8', 'R@h1', 'h7h5', 'h1h5', 'e7f8', 'c2h7'];

/** 9 plies (5 player moves), 3 gold left. */
export const WIN_9 = ['Q@c2', 'e7b4', 'e1f1', 'R@h8', 'R@f2', 'd8d5', 'c2b3', 'd5d4', 'b3f7'];

/** 17 plies (9 player moves), 1 gold left. */
export const WIN_17 = ['Q@c2', 'B@e8', 'R@h1', 'e7f6', 'c2h7', 'g8f8', 'B@g2', 'P@d7', 'h7h8', 'f8e7', 'h8h5', 'P@h7', 'h5e2', 'e7f8', 'h1h7', 'f6d4', 'h7h8'];

/** 51 plies (26 player moves), 1 gold left — the long one, for the replay-cost check. */
export const WIN_51 = [
  'Q@c2', 'e7h4', 'B@f2', 'd8d4', 'f2h4', 'd4h4', 'c2c8', 'B@f8', 'R@g1', 'P@e7', 'c8d8', 'g7g5', 'g1g5', 'P@g7', 'P@g2', 'f7f6', 'd8d5',
  'g8h8', 'g5h5', 'h4f4', 'h5f5', 'g7g5', 'f5f4', 'g5f4', 'd5f7', 'N@d7', 'f7e8', 'h8g8', 'e8d7', 'g8f7', 'B@d2', 'f8g7', 'd2f4', 'h7h5',
  'P@c2', 'g7h8', 'f4d6', 'f7g7', 'd7e7', 'g7g6', 'e7e8', 'g6f5', 'e8h8', 'h5h4', 'h8h4', 'f5g6', 'B@b2', 'g6g7', 'h4f6', 'g7g8', 'f6g7',
];

/** WIN_7 without its last move: legal, but the game is not over (no mate yet). */
export const NOT_OVER = ['Q@c2', 'B@e8', 'R@h1', 'h7h5', 'h1h5', 'e7f8'];
