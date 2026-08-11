ALTER TABLE farm_profiles
  ADD COLUMN luck_tier INTEGER NOT NULL DEFAULT 0 CHECK (luck_tier BETWEEN 0 AND 49);

ALTER TABLE farm_profiles
  ADD COLUMN big_crop_tier INTEGER NOT NULL DEFAULT 0 CHECK (big_crop_tier BETWEEN 0 AND 50);

ALTER TABLE farm_crop_instances
  ADD COLUMN is_big INTEGER NOT NULL DEFAULT 0 CHECK (is_big IN (0, 1));
