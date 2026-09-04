CREATE TABLE IF NOT EXISTS work_sessions (
  session_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL,
  job TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  deadline INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'succeeded', 'failed', 'timed_out', 'aborted')),
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS work_one_active_member
  ON work_sessions (guild_id, user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS work_active_deadlines ON work_sessions (status, deadline);

CREATE TABLE IF NOT EXISTS work_cooldowns (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  next_work_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
