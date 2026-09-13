const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_PATH = path.join(__dirname, 'migrations');

function migrateBeg(db, migrationsPath = MIGRATIONS_PATH) {
  db.exec(`CREATE TABLE IF NOT EXISTS beg_schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(db.prepare('SELECT version FROM beg_schema_migrations').all().map(row => row.version));
  const apply = db.transaction((name, sql) => {
    if (db.prepare('SELECT 1 FROM beg_schema_migrations WHERE version=?').get(name)) return;
    db.exec(sql);
    db.prepare('INSERT INTO beg_schema_migrations(version,applied_at) VALUES(?,?)')
      .run(name, BigInt(Date.now()));
  }).immediate;
  for (const name of fs.readdirSync(migrationsPath).filter(name => name.endsWith('.sql')).sort()) {
    if (!applied.has(name)) apply(name, fs.readFileSync(path.join(migrationsPath, name), 'utf8'));
  }
}

module.exports = { MIGRATIONS_PATH, migrateBeg };
