-- Chess Battle Simulator leaderboard: each player's BEST replay-validated win
-- per board (level, balance version, AI preset). The score columns are
-- computed by the server's own replay (src/core/scores.js), never taken from
-- the client. No IP, User-Agent or geo columns on purpose (see src/index.js).
CREATE TABLE IF NOT EXISTS scores (
  id TEXT PRIMARY KEY,               -- 'sc_' + 16 hex; stable across improvements (moderation handle)
  player_id TEXT NOT NULL,           -- the client's random telemetry id ('p_' + 16 hex); never returned by GET
  nickname TEXT NOT NULL,
  level_id TEXT NOT NULL,
  balance_version TEXT NOT NULL,
  ai_preset TEXT NOT NULL,
  plies INTEGER NOT NULL,            -- half-moves to mate (player moves = ceil(plies / 2))
  gold_left INTEGER NOT NULL,
  gold_spent INTEGER NOT NULL,
  moves_json TEXT NOT NULL,          -- the submitted UCI/drop list ('N@b1')
  pgn TEXT NOT NULL,                 -- PGN from the server's replay
  app_version TEXT,
  created_at TEXT NOT NULL,          -- when this best score was set (ISO 8601)
  UNIQUE (player_id, level_id, balance_version, ai_preset)
);

CREATE INDEX IF NOT EXISTS idx_scores_board ON scores (level_id, balance_version, ai_preset, plies, gold_left DESC, created_at, id);
