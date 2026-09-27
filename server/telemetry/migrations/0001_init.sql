-- Chess Battle Simulator telemetry: one row per finished play session.
-- No IP, User-Agent or geo columns on purpose — see src/index.js header.
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  level_id TEXT,
  result TEXT,
  end_reason TEXT,
  app_version TEXT,
  balance_version TEXT,
  started_at TEXT NOT NULL,
  plies INTEGER,
  received_at TEXT NOT NULL,
  raw_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_player_id ON sessions (player_id);
