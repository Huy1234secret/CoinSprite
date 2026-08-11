const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { openSqliteDatabase } = require('../../shared/database');
const { fallbackAnchors } = require('../utils/anchors');
const { anchorBounds } = require('../renderer/config');
const { CARROT_CONFIG, carrotValueForWeight } = require('../utils/crops');

const DEFAULT_FARMING_DATABASE_PATH = path.join(__dirname, '..', '..', '..', '..', 'data', 'farming-game.sqlite');
const FARMING_MIGRATIONS_PATH = path.join(__dirname, '..', 'migrations');

function legacyInstanceId(...parts) {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);
  return `farm_${digest}`;
}

function legacyWeightUnits(id) {
  const sample = Number.parseInt(createHash('sha256').update(id).digest('hex').slice(0, 8), 16);
  return CARROT_CONFIG.minimumWeightUnits
    + (sample % (CARROT_CONFIG.maximumWeightUnits - CARROT_CONFIG.minimumWeightUnits + 1));
}

function stableSeedRotationDegrees(id) {
  const sample = Number.parseInt(
    createHash('sha256').update(`seed-rotation\u0000${String(id)}`).digest('hex').slice(0, 8),
    16,
  );
  return sample % 360;
}

function legacyAnchors(plotNumber, json) {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.length === 5 && parsed.every((anchor) => (
      Number.isInteger(Number(anchor?.x)) && Number.isInteger(Number(anchor?.y))
    ))) {
      return parsed.map((anchor) => ({ x: Number(anchor.x), y: Number(anchor.y) }));
    }
  } catch {
    // Damaged legacy anchors are replaced with the renderer's deterministic safe layout.
  }
  return fallbackAnchors(anchorBounds(plotNumber));
}

function backfillCropInstances(db) {
  const table = db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'farm_crop_instances'`).get();
  if (!table) return;
  const insert = db.prepare(`INSERT OR IGNORE INTO farm_crop_instances
    (id, owner_user_id, crop_id, rarity, weight_units, stored_value, seed_rotation_degrees, state,
      plot_number, anchor_x, anchor_y, planted_at, harvested_at, created_at, updated_at)
    VALUES (?, ?, 'carrot', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const migrate = db.transaction(() => {
    const occupiedPlots = db.prepare(`SELECT owner_user_id, plot_number, planted_at, anchors_json, updated_at
      FROM farm_plots WHERE crop_id = 'carrot' ORDER BY owner_user_id, plot_number`).all();
    for (const row of occupiedPlots) {
      const plotNumber = Number(row.plot_number);
      const anchors = legacyAnchors(plotNumber, row.anchors_json);
      anchors.forEach((anchor, index) => {
        const id = legacyInstanceId('planted', row.owner_user_id, plotNumber, index);
        const weightUnits = legacyWeightUnits(id);
        insert.run(
          id,
          row.owner_user_id,
          CARROT_CONFIG.rarity,
          BigInt(weightUnits),
          BigInt(carrotValueForWeight(weightUnits)),
          BigInt(stableSeedRotationDegrees(id)),
          'planted',
          BigInt(plotNumber),
          BigInt(anchor.x),
          BigInt(anchor.y),
          row.planted_at,
          null,
          row.planted_at,
          row.updated_at,
        );
      });
    }

    const carrotStacks = db.prepare(`SELECT owner_user_id, quantity, updated_at
      FROM farm_item_stacks WHERE item_id = 'carrot' AND quantity > 0 ORDER BY owner_user_id`).all();
    for (const row of carrotStacks) {
      for (let index = 0n; index < row.quantity; index += 1n) {
        const id = legacyInstanceId('inventory', row.owner_user_id, index);
        const weightUnits = legacyWeightUnits(id);
        insert.run(
          id,
          row.owner_user_id,
          CARROT_CONFIG.rarity,
          BigInt(weightUnits),
          BigInt(carrotValueForWeight(weightUnits)),
          BigInt(stableSeedRotationDegrees(id)),
          'inventory',
          null,
          null,
          null,
          row.updated_at,
          row.updated_at,
          row.updated_at,
          row.updated_at,
        );
      }
    }

    db.prepare(`UPDATE farm_plots SET crop_id = NULL, planted_at = NULL, anchors_json = NULL
      WHERE crop_id = 'carrot'`).run();
    db.prepare(`DELETE FROM farm_item_stacks WHERE item_id = 'carrot'`).run();
    const missingRotations = db.prepare(`SELECT id FROM farm_crop_instances
      WHERE seed_rotation_degrees IS NULL ORDER BY id`).all();
    const setRotation = db.prepare(`UPDATE farm_crop_instances SET seed_rotation_degrees = ?
      WHERE id = ? AND seed_rotation_degrees IS NULL`);
    for (const row of missingRotations) {
      setRotation.run(BigInt(stableSeedRotationDegrees(row.id)), row.id);
    }
  }).immediate;
  migrate();
}

function backfillCropStatistics(db) {
  const table = db.prepare(`SELECT 1 FROM sqlite_master
    WHERE type = 'table' AND name = 'farm_crop_statistics'`).get();
  if (!table) return;
  db.prepare(`INSERT OR IGNORE INTO farm_crop_statistics
    (owner_user_id, crop_id, total_planted, total_harvested, highest_weight_units, updated_at)
    SELECT owner_user_id, crop_id, COUNT(*),
      SUM(CASE WHEN state = 'inventory' THEN 1 ELSE 0 END),
      MAX(CASE WHEN state = 'inventory' THEN weight_units ELSE 0 END), MAX(updated_at)
    FROM farm_crop_instances
    GROUP BY owner_user_id, crop_id`).run();
}

function migrateFarmingGame(db, migrationsPath = FARMING_MIGRATIONS_PATH) {
  db.exec(`CREATE TABLE IF NOT EXISTS farm_schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(db.prepare('SELECT version FROM farm_schema_migrations').all().map((row) => row.version));
  const migrations = fs.readdirSync(migrationsPath).filter((name) => name.endsWith('.sql')).sort();
  const apply = db.transaction((name, sql) => {
    if (db.prepare('SELECT 1 FROM farm_schema_migrations WHERE version = ?').get(name)) return;
    db.exec(sql);
    db.prepare('INSERT INTO farm_schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(name, BigInt(Date.now()));
  }).immediate;
  for (const name of migrations) {
    if (!applied.has(name)) apply(name, fs.readFileSync(path.join(migrationsPath, name), 'utf8'));
  }
  backfillCropInstances(db);
  backfillCropStatistics(db);
}

function openFarmingDatabase(options = {}) {
  const databasePath = options.databasePath
    || process.env.FARMING_GAME_DATABASE_PATH
    || DEFAULT_FARMING_DATABASE_PATH;
  const db = openSqliteDatabase(databasePath);
  migrateFarmingGame(db, options.migrationsPath);
  return db;
}

module.exports = {
  DEFAULT_FARMING_DATABASE_PATH,
  FARMING_MIGRATIONS_PATH,
  backfillCropInstances,
  backfillCropStatistics,
  migrateFarmingGame,
  openFarmingDatabase,
  stableSeedRotationDegrees,
};
