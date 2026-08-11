ALTER TABLE rng_auto_roll_jobs ADD COLUMN cost_per_roll INTEGER NOT NULL DEFAULT 5
  CHECK (cost_per_roll >= 5);
