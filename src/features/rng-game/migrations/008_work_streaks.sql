ALTER TABLE rng_work_profiles ADD COLUMN work_streak INTEGER NOT NULL DEFAULT 0
  CHECK (work_streak BETWEEN 0 AND 1000);

ALTER TABLE rng_work_profiles ADD COLUMN streak_failures INTEGER NOT NULL DEFAULT 0
  CHECK (streak_failures BETWEEN 0 AND 4);

ALTER TABLE rng_work_sessions ADD COLUMN streak_boost INTEGER NOT NULL DEFAULT 0
  CHECK (streak_boost BETWEEN 0 AND 1000);
