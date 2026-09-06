-- Counting can start before Work, including in separate processes.
CREATE TABLE bronze_wallet_upgrade (
  user_id TEXT PRIMARY KEY, balance TEXT NOT NULL DEFAULT '0' CHECK(length(balance)>0 AND balance NOT GLOB '*[^0-9]*'), updated_at INTEGER NOT NULL
);
INSERT INTO bronze_wallet_upgrade SELECT user_id,CAST(balance AS TEXT),updated_at FROM counting_bronze_balances;
DROP TABLE counting_bronze_balances;
ALTER TABLE bronze_wallet_upgrade RENAME TO counting_bronze_balances;
