-- Decimal text preserves arbitrary-size Counting balances without SQLite integer overflow.
CREATE TABLE bronze_wallet_upgrade (
  user_id TEXT PRIMARY KEY, balance TEXT NOT NULL DEFAULT '0' CHECK(length(balance)>0 AND balance NOT GLOB '*[^0-9]*'), updated_at INTEGER NOT NULL
);
INSERT INTO bronze_wallet_upgrade SELECT user_id,CAST(balance AS TEXT),updated_at FROM counting_bronze_balances;
DROP TABLE counting_bronze_balances;
ALTER TABLE bronze_wallet_upgrade RENAME TO counting_bronze_balances;
CREATE TABLE lottery_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT, draw_date TEXT NOT NULL UNIQUE,
  first TEXT NOT NULL, second_json TEXT NOT NULL, third_json TEXT NOT NULL, rolled_at INTEGER NOT NULL
);
CREATE TABLE lottery_tickets (
  id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT NOT NULL, draw_date TEXT NOT NULL,
  code TEXT NOT NULL, purchased_at INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0,
  rank INTEGER, earnings INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, draw_date, code)
);
CREATE INDEX lottery_tickets_due ON lottery_tickets(settled, draw_date);
CREATE INDEX lottery_tickets_owner ON lottery_tickets(user_id, draw_date, code);
CREATE TABLE shop_orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL,
  quantity INTEGER NOT NULL, created_at INTEGER NOT NULL, purchased_at INTEGER
);
CREATE TABLE lottery_deliveries (
  id TEXT PRIMARY KEY, draw_id INTEGER NOT NULL REFERENCES lottery_draws(id), kind TEXT NOT NULL,
  target_id TEXT NOT NULL, guild_id TEXT, sent_at INTEGER, lease_until INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE TABLE lottery_channels (guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL);
