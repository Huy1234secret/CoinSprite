const fs = require('fs');
const path = require('path');
const { openSqliteDatabase } = require('../../shared/database');

const DEFAULT_FARMING_DATABASE_PATH = path.join(__dirname, '..', '..', '..', '..', 'data', 'farming-game.sqlite');
const FARMING_MIGRATIONS_PATH = path.join(__dirname, '..', 'migrations');

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
  migrateFarmingGame,
  openFarmingDatabase,
};
