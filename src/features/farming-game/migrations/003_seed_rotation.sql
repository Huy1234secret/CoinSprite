ALTER TABLE farm_crop_instances
  ADD COLUMN seed_rotation_degrees INTEGER
  CHECK (seed_rotation_degrees BETWEEN 0 AND 359);
