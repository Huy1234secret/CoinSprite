CREATE TABLE IF NOT EXISTS achievement_progress (
  user_id TEXT PRIMARY KEY,
  work INTEGER NOT NULL DEFAULT 0, expert INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0, best_streak INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1, counts INTEGER NOT NULL DEFAULT 0,
  jackpot INTEGER NOT NULL DEFAULT 0, sixty_seven INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS achievement_medals (
  user_id TEXT NOT NULL, track TEXT NOT NULL, tier INTEGER NOT NULL,
  PRIMARY KEY (user_id, track, tier)
);
CREATE TABLE IF NOT EXISTS achievement_outbox (
  id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL,
  track TEXT NOT NULL, tier INTEGER NOT NULL, upgraded INTEGER NOT NULL,
  guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
  created_at INTEGER NOT NULL, available_at INTEGER NOT NULL,
  claim_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  message_id TEXT, delivered_at INTEGER,
  UNIQUE(event_id, user_id, track, tier)
);
CREATE INDEX IF NOT EXISTS achievement_pending ON achievement_outbox(delivered_at, available_at, lease_until);
