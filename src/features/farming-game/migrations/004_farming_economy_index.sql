ALTER TABLE farm_profiles
  ADD COLUMN coin_balance INTEGER NOT NULL DEFAULT 0 CHECK (coin_balance >= 0);

CREATE TABLE IF NOT EXISTS farm_operations (
  operation_key TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES farm_profiles(user_id) ON DELETE CASCADE,
  operation_kind TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS farm_operations_owner
  ON farm_operations(owner_user_id, created_at);

CREATE TABLE IF NOT EXISTS farm_crop_statistics (
  owner_user_id TEXT NOT NULL REFERENCES farm_profiles(user_id) ON DELETE CASCADE,
  crop_id TEXT NOT NULL,
  total_planted INTEGER NOT NULL DEFAULT 0 CHECK (total_planted >= 0),
  total_harvested INTEGER NOT NULL DEFAULT 0 CHECK (total_harvested >= 0),
  highest_weight_units INTEGER NOT NULL DEFAULT 0 CHECK (highest_weight_units >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, crop_id)
);
