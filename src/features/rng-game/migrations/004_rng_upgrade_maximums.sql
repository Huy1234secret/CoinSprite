CREATE TABLE rng_players_with_upgrade_maximums (
  user_id TEXT PRIMARY KEY,
  sheckle_balance INTEGER NOT NULL DEFAULT 0 CHECK (sheckle_balance >= 0),
  inventory_capacity INTEGER NOT NULL DEFAULT 100 CHECK (inventory_capacity >= 0),
  inventory_upgrade_level INTEGER NOT NULL DEFAULT 0 CHECK (inventory_upgrade_level >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  luck_tier INTEGER NOT NULL DEFAULT 0 CHECK (luck_tier BETWEEN 0 AND 49),
  big_crop_tier INTEGER NOT NULL DEFAULT 0 CHECK (big_crop_tier BETWEEN 0 AND 50)
);

INSERT INTO rng_players_with_upgrade_maximums (
  user_id, sheckle_balance, inventory_capacity, inventory_upgrade_level,
  created_at, updated_at, luck_tier, big_crop_tier
)
SELECT
  user_id, sheckle_balance, inventory_capacity, inventory_upgrade_level,
  created_at, updated_at, luck_tier, big_crop_tier
FROM rng_players;

DROP TABLE rng_players;
ALTER TABLE rng_players_with_upgrade_maximums RENAME TO rng_players;
