CREATE TABLE IF NOT EXISTS farm_crop_instances (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES farm_profiles(user_id) ON DELETE CASCADE,
  crop_id TEXT NOT NULL,
  rarity TEXT NOT NULL,
  weight_units INTEGER NOT NULL CHECK (weight_units BETWEEN 20 AND 80),
  stored_value INTEGER NOT NULL CHECK (stored_value BETWEEN 2 AND 12),
  state TEXT NOT NULL CHECK (state IN ('planted', 'inventory')),
  plot_number INTEGER,
  anchor_x INTEGER,
  anchor_y INTEGER,
  planted_at INTEGER NOT NULL,
  harvested_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (plot_number IS NULL OR plot_number BETWEEN 1 AND 9),
  CHECK (
    (state = 'planted' AND plot_number IS NOT NULL AND anchor_x IS NOT NULL AND anchor_y IS NOT NULL AND harvested_at IS NULL)
    OR (state = 'inventory' AND plot_number IS NULL AND anchor_x IS NULL AND anchor_y IS NULL AND harvested_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS farm_crop_instances_owner_state
  ON farm_crop_instances(owner_user_id, state);

CREATE INDEX IF NOT EXISTS farm_crop_instances_owner_plot_state
  ON farm_crop_instances(owner_user_id, plot_number, state);
