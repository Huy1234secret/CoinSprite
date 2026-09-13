CREATE TABLE IF NOT EXISTS beg_profiles (
  user_id TEXT PRIMARY KEY,
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  successes INTEGER NOT NULL DEFAULT 0 CHECK(successes >= 0),
  failures INTEGER NOT NULL DEFAULT 0 CHECK(failures >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK(losses >= 0),
  total_earned TEXT NOT NULL DEFAULT '0'
    CHECK(length(total_earned) > 0 AND total_earned NOT GLOB '*[^0-9]*'),
  total_lost TEXT NOT NULL DEFAULT '0'
    CHECK(length(total_lost) > 0 AND total_lost NOT GLOB '*[^0-9]*'),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS beg_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  approach_id TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','settled','expired')),
  outcome TEXT CHECK(outcome IS NULL OR outcome IN ('success','fail','loss')),
  amount TEXT NOT NULL DEFAULT '0'
    CHECK(length(amount) > 0 AND amount NOT GLOB '*[^0-9]*'),
  balance_after TEXT NOT NULL DEFAULT '0'
    CHECK(length(balance_after) > 0 AND balance_after NOT GLOB '*[^0-9]*'),
  cooldown_until INTEGER NOT NULL DEFAULT 0,
  bypass_cooldown INTEGER NOT NULL DEFAULT 0 CHECK(bypass_cooldown IN (0,1)),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE TABLE IF NOT EXISTS beg_session_options (
  session_id TEXT NOT NULL REFERENCES beg_sessions(session_id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK(slot BETWEEN 0 AND 3),
  approach_id TEXT NOT NULL,
  PRIMARY KEY(session_id, slot),
  UNIQUE(session_id, approach_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS beg_one_open_session_per_user
  ON beg_sessions(user_id) WHERE status='open';
CREATE INDEX IF NOT EXISTS beg_sessions_expiry ON beg_sessions(status, expires_at);
