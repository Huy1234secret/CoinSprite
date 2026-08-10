const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

function openSqliteDatabase(databasePath) {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (databasePath !== ':memory:') db.pragma('journal_mode = WAL');
  db.defaultSafeIntegers(true);
  return db;
}

module.exports = { openSqliteDatabase };
