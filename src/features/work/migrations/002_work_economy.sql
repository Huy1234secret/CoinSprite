-- Forward-only upgrade from the original session-only Work prototype.
CREATE TABLE IF NOT EXISTS counting_bronze_balances (
  user_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0 AND balance <= 1000000),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS work_profiles (
  user_id TEXT PRIMARY KEY,
  level INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  streak INTEGER NOT NULL DEFAULT 0 CHECK (streak >= 0),
  cooldown_until INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_until >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  user_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_key)
);

ALTER TABLE work_sessions ADD COLUMN normalized_d REAL NOT NULL DEFAULT 0;
ALTER TABLE work_sessions ADD COLUMN base_salary INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_sessions ADD COLUMN xp_reward INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_sessions ADD COLUMN salary_credited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_sessions ADD COLUMN levels_gained INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_sessions ADD COLUMN tokens_awarded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE work_sessions ADD COLUMN failure_reason TEXT;

DROP INDEX IF EXISTS work_one_active_member;
UPDATE work_sessions
SET status = 'aborted', settled_at = COALESCE(settled_at, created_at)
WHERE status = 'active'
  AND rowid NOT IN (SELECT MAX(rowid) FROM work_sessions WHERE status = 'active' GROUP BY user_id);
CREATE UNIQUE INDEX IF NOT EXISTS work_one_active_user
  ON work_sessions (user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS work_sessions_user_created
  ON work_sessions (user_id, created_at DESC);
