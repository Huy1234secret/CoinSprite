CREATE TABLE rng_work_profiles (
  user_id TEXT PRIMARY KEY REFERENCES rng_players(user_id) ON DELETE CASCADE,
  total_xp INTEGER NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  completed_shifts INTEGER NOT NULL DEFAULT 0 CHECK (completed_shifts >= 0),
  failed_shifts INTEGER NOT NULL DEFAULT 0 CHECK (failed_shifts >= 0),
  total_token_salary INTEGER NOT NULL DEFAULT 0 CHECK (total_token_salary >= 0),
  last_shift_end_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE rng_work_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  game_id TEXT NOT NULL,
  customer_id INTEGER NOT NULL,
  game_message TEXT NOT NULL,
  expected_recipe_json TEXT NOT NULL,
  button_slots_json TEXT NOT NULL,
  consumed_slots_json TEXT NOT NULL DEFAULT '[]',
  current_progress INTEGER NOT NULL DEFAULT 0 CHECK (current_progress >= 0),
  base_reward INTEGER NOT NULL CHECK (base_reward > 0),
  salary_boost INTEGER NOT NULL CHECK (salary_boost >= 0),
  failed_slot_index INTEGER,
  state TEXT NOT NULL CHECK (state IN ('active', 'completed', 'failed', 'canceled', 'expired')),
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX rng_work_one_active_user
  ON rng_work_sessions(user_id) WHERE state = 'active';

CREATE INDEX rng_work_sessions_expiry
  ON rng_work_sessions(state, expires_at);
