CREATE TABLE IF NOT EXISTS counting_guild_state (
  guild_id TEXT PRIMARY KEY,
  next_expected TEXT NOT NULL DEFAULT '1',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS counting_bronze_balances (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0 AND balance <= 1000000),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS counting_processed_messages (
  message_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('correct', 'incorrect')),
  submitted_value TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS counting_processed_messages_guild
  ON counting_processed_messages (guild_id, created_at);
