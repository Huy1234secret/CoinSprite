const fs = require('fs');
const path = require('path');
const { openSqliteDatabase } = require('../../shared/database');

// Work and Counting intentionally share the same SQLite file so salary updates
// are visible immediately to /cs-balance.
const DEFAULT_DATABASE_PATH = process.env.COUNTING_DATABASE_PATH
  || path.join(__dirname, '..', '..', '..', '..', 'data', 'counting.sqlite');
const MIGRATIONS_PATH = path.join(__dirname, '..', 'migrations');

function migrate(db, migrationsPath = MIGRATIONS_PATH) {
  db.exec('CREATE TABLE IF NOT EXISTS work_schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = new Set(db.prepare('SELECT version FROM work_schema_migrations').all().map((row) => row.version));
  const apply = db.transaction((name, sql) => {
    if (db.prepare('SELECT 1 FROM work_schema_migrations WHERE version = ?').get(name)) return;
    db.exec(sql);
    db.prepare('INSERT INTO work_schema_migrations (version, applied_at) VALUES (?, ?)').run(name, BigInt(Date.now()));
  }).immediate;
  for (const name of fs.readdirSync(migrationsPath).filter((entry) => entry.endsWith('.sql')).sort()) {
    if (!applied.has(name)) apply(name, fs.readFileSync(path.join(migrationsPath, name), 'utf8'));
  }
}

function openDatabase(options = {}) {
  const databasePath = options.databasePath || DEFAULT_DATABASE_PATH;
  const db = openSqliteDatabase(databasePath);
  migrate(db, options.migrationsPath);
  return db;
}

module.exports = { DEFAULT_DATABASE_PATH, MIGRATIONS_PATH, migrate, openDatabase };
