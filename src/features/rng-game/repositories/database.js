const fs = require('fs');
const path = require('path');
const { openSqliteDatabase } = require('../../shared/database');

const DEFAULT_DATABASE_PATH = path.join(__dirname, '..', '..', '..', '..', 'data', 'rng-game.sqlite');
const MIGRATIONS_PATH = path.join(__dirname, '..', 'migrations');

function migrate(db, migrationsPath = MIGRATIONS_PATH) {
  db.exec(`CREATE TABLE IF NOT EXISTS rng_schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(db.prepare('SELECT version FROM rng_schema_migrations').all().map((row) => row.version));
  const migrations = fs.readdirSync(migrationsPath).filter((name) => name.endsWith('.sql')).sort();
  const apply = db.transaction((name, sql) => {
    if (db.prepare('SELECT 1 FROM rng_schema_migrations WHERE version = ?').get(name)) return;
    db.exec(sql);
    db.prepare('INSERT INTO rng_schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(name, BigInt(Date.now()));
  }).immediate;
  for (const name of migrations) {
    if (!applied.has(name)) apply(name, fs.readFileSync(path.join(migrationsPath, name), 'utf8'));
  }
}

function openDatabase(options = {}) {
  const databasePath = options.databasePath || process.env.RNG_GAME_DATABASE_PATH || DEFAULT_DATABASE_PATH;
  const db = openSqliteDatabase(databasePath);
  migrate(db, options.migrationsPath);
  return db;
}

module.exports = { DEFAULT_DATABASE_PATH, MIGRATIONS_PATH, migrate, openDatabase };
