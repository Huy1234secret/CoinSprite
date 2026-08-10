ALTER TABLE rng_players ADD COLUMN luck_tier INTEGER NOT NULL DEFAULT 0
  CHECK (luck_tier BETWEEN 0 AND 20);
ALTER TABLE rng_players ADD COLUMN big_crop_tier INTEGER NOT NULL DEFAULT 0
  CHECK (big_crop_tier BETWEEN 0 AND 20);

ALTER TABLE rng_inventory_items ADD COLUMN is_big INTEGER NOT NULL DEFAULT 0
  CHECK (is_big IN (0, 1));

CREATE TABLE rng_crop_discoveries (
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  seed_id TEXT NOT NULL,
  discovered_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, seed_id)
);

CREATE TABLE rng_auto_roll_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'stopped')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  planned_rolls INTEGER NOT NULL CHECK (planned_rolls > 0),
  completed_rolls INTEGER NOT NULL DEFAULT 0 CHECK (completed_rolls >= 0),
  cost_paid INTEGER NOT NULL CHECK (cost_paid >= 0),
  refund_paid INTEGER NOT NULL DEFAULT 0 CHECK (refund_paid >= 0),
  selected_auto_sell_rarities TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  next_tick_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  finished_at INTEGER,
  stopped_reason TEXT NOT NULL DEFAULT '',
  summary_counts TEXT NOT NULL DEFAULT '{}',
  notified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX rng_auto_roll_one_active_user
  ON rng_auto_roll_jobs(user_id) WHERE status = 'active';
CREATE INDEX rng_auto_roll_due_jobs
  ON rng_auto_roll_jobs(status, next_tick_at, id);

CREATE TABLE rng_auto_roll_ticks (
  job_id INTEGER NOT NULL REFERENCES rng_auto_roll_jobs(id) ON DELETE CASCADE,
  scheduled_tick INTEGER NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, scheduled_tick)
);

CREATE TABLE rng_scheduler_leases (
  lease_name TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
