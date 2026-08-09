CREATE TABLE IF NOT EXISTS rng_players (
  user_id TEXT PRIMARY KEY,
  sheckle_balance INTEGER NOT NULL DEFAULT 0 CHECK (sheckle_balance >= 0),
  inventory_capacity INTEGER NOT NULL DEFAULT 100 CHECK (inventory_capacity >= 0),
  inventory_upgrade_level INTEGER NOT NULL DEFAULT 0 CHECK (inventory_upgrade_level >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rng_inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  seed_id TEXT NOT NULL,
  crop_name TEXT NOT NULL,
  rarity TEXT NOT NULL,
  weight_units INTEGER NOT NULL CHECK (weight_units >= 0),
  stored_value INTEGER NOT NULL CHECK (stored_value >= 0),
  rolled_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS rng_inventory_owner_order
  ON rng_inventory_items(owner_user_id, rolled_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS rng_roll_cooldowns (
  user_id TEXT PRIMARY KEY REFERENCES rng_players(user_id) ON DELETE CASCADE,
  available_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rng_operations (
  operation_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  operation_kind TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
