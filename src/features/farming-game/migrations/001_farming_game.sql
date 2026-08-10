CREATE TABLE IF NOT EXISTS farm_profiles (
  user_id TEXT PRIMARY KEY,
  starter_granted INTEGER NOT NULL DEFAULT 0 CHECK (starter_granted IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS farm_item_stacks (
  owner_user_id TEXT NOT NULL REFERENCES farm_profiles(user_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, item_id)
);

CREATE INDEX IF NOT EXISTS farm_item_stacks_owner
  ON farm_item_stacks(owner_user_id, item_id);

CREATE TABLE IF NOT EXISTS farm_plots (
  owner_user_id TEXT NOT NULL REFERENCES farm_profiles(user_id) ON DELETE CASCADE,
  plot_number INTEGER NOT NULL CHECK (plot_number BETWEEN 1 AND 9),
  crop_id TEXT,
  planted_at INTEGER,
  anchors_json TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, plot_number),
  CHECK (
    (crop_id IS NULL AND planted_at IS NULL AND anchors_json IS NULL)
    OR (crop_id IS NOT NULL AND planted_at IS NOT NULL AND anchors_json IS NOT NULL)
  )
);
