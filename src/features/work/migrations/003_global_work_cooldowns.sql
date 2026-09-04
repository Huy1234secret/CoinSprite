-- Consolidate the obsolete per-guild cooldown table into the global Work profile.
-- The migration runner applies this file and its schema-version record atomically.
INSERT INTO work_profiles (user_id, level, xp, streak, cooldown_until, updated_at)
SELECT
  user_id,
  1,
  0,
  0,
  MAX(next_work_at),
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM work_cooldowns
WHERE user_id <> ''
  AND typeof(next_work_at) = 'integer'
  AND next_work_at >= 0
GROUP BY user_id
ON CONFLICT(user_id) DO UPDATE SET
  cooldown_until = MAX(work_profiles.cooldown_until, excluded.cooldown_until),
  updated_at = CASE
    WHEN excluded.cooldown_until > work_profiles.cooldown_until THEN excluded.updated_at
    ELSE work_profiles.updated_at
  END;

DROP TABLE work_cooldowns;
