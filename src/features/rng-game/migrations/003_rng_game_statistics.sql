CREATE TABLE rng_player_statistics (
  user_id TEXT PRIMARY KEY REFERENCES rng_players(user_id) ON DELETE CASCADE,
  total_rolls INTEGER NOT NULL DEFAULT 0 CHECK (total_rolls >= 0 AND typeof(total_rolls) = 'integer'),
  auto_rolls INTEGER NOT NULL DEFAULT 0 CHECK (auto_rolls >= 0 AND typeof(auto_rolls) = 'integer'),
  highest_weight_units INTEGER NOT NULL DEFAULT 0 CHECK (highest_weight_units >= 0 AND typeof(highest_weight_units) = 'integer'),
  total_sale_earnings INTEGER NOT NULL DEFAULT 0 CHECK (total_sale_earnings >= 0 AND typeof(total_sale_earnings) = 'integer'),
  highest_single_sale INTEGER NOT NULL DEFAULT 0 CHECK (highest_single_sale >= 0 AND typeof(highest_single_sale) = 'integer'),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE rng_crop_statistics (
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  seed_id TEXT NOT NULL,
  roll_count INTEGER NOT NULL DEFAULT 0 CHECK (roll_count >= 0 AND typeof(roll_count) = 'integer'),
  highest_weight_units INTEGER NOT NULL DEFAULT 0 CHECK (highest_weight_units >= 0 AND typeof(highest_weight_units) = 'integer'),
  first_rolled_at INTEGER NOT NULL,
  last_rolled_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, seed_id)
);

-- Older databases cannot reconstruct sold rolls or sales. Preserve only the
-- historical weights that are still provable from current inventory.
INSERT INTO rng_player_statistics (
  user_id, total_rolls, auto_rolls, highest_weight_units,
  total_sale_earnings, highest_single_sale, created_at, updated_at
)
SELECT
  players.user_id,
  0,
  0,
  COALESCE(MAX(items.weight_units), 0),
  0,
  0,
  players.created_at,
  players.updated_at
FROM rng_players AS players
LEFT JOIN rng_inventory_items AS items ON items.owner_user_id = players.user_id
GROUP BY players.user_id;

INSERT INTO rng_crop_statistics (
  user_id, seed_id, roll_count, highest_weight_units, first_rolled_at, last_rolled_at
)
SELECT
  owner_user_id,
  seed_id,
  0,
  MAX(weight_units),
  MIN(rolled_at),
  MAX(rolled_at)
FROM rng_inventory_items
GROUP BY owner_user_id, seed_id;
