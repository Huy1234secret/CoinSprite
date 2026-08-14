ALTER TABLE rng_inventory_items ADD COLUMN modifier_snapshot_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE rng_player_items (
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE rng_active_item_effects (
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  effect_group TEXT NOT NULL CHECK (effect_group IN ('mushroom', 'sprinkler')),
  ends_at INTEGER NOT NULL CHECK (ends_at >= 0),
  activated_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE UNIQUE INDEX rng_one_active_sprinkler
  ON rng_active_item_effects(user_id, effect_group)
  WHERE effect_group = 'sprinkler';
CREATE INDEX rng_active_effect_expiry
  ON rng_active_item_effects(ends_at, user_id);

CREATE TABLE rng_watering_can_charges (
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  charges INTEGER NOT NULL DEFAULT 0 CHECK (charges >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

CREATE TABLE rng_pet_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  pet_id TEXT NOT NULL,
  hatched_at INTEGER NOT NULL
);

CREATE INDEX rng_pet_owner_species
  ON rng_pet_instances(owner_user_id, pet_id, id);

CREATE TABLE rng_pet_slots (
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  slot_number INTEGER NOT NULL CHECK (slot_number BETWEEN 1 AND 3),
  unlocked INTEGER NOT NULL DEFAULT 0 CHECK (unlocked IN (0, 1)),
  pet_instance_id INTEGER REFERENCES rng_pet_instances(id) ON DELETE SET NULL,
  unlocked_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, slot_number),
  UNIQUE (pet_instance_id)
);

CREATE TABLE rng_shop_restocks (
  restock_epoch INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE rng_shop_stock (
  restock_epoch INTEGER NOT NULL REFERENCES rng_shop_restocks(restock_epoch) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  stock INTEGER NOT NULL CHECK (stock >= 0),
  PRIMARY KEY (restock_epoch, item_id)
);

CREATE INDEX rng_shop_stock_epoch
  ON rng_shop_stock(restock_epoch, item_id);
