ALTER TABLE rng_players ADD COLUMN token_balance INTEGER NOT NULL DEFAULT 0
  CHECK (token_balance >= 0);

CREATE TABLE rng_token_exchanges (
  operation_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  token_amount INTEGER NOT NULL CHECK (token_amount BETWEEN 1 AND 100),
  sheckle_cost INTEGER NOT NULL CHECK (sheckle_cost >= 0),
  exchanged_at INTEGER NOT NULL
);

CREATE INDEX rng_token_exchanges_user_time
  ON rng_token_exchanges(user_id, exchanged_at);

CREATE TABLE rng_rps_games (
  game_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  host_user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  mode TEXT CHECK (mode IN ('bot', 'human')),
  state TEXT NOT NULL CHECK (state IN (
    'CHOOSING_MODE', 'LOBBY', 'IN_PROGRESS', 'READY_TO_REVEAL',
    'FINISHED', 'CANCELED', 'EXPIRED'
  )),
  bet INTEGER NOT NULL DEFAULT 0 CHECK (bet BETWEEN 0 AND 1000),
  bot_choice TEXT CHECK (bot_choice IN ('rock', 'paper', 'scissors')),
  current_turn INTEGER NOT NULL DEFAULT 0 CHECK (current_turn >= 0),
  escrowed_tokens INTEGER NOT NULL DEFAULT 0 CHECK (escrowed_tokens >= 0),
  result_type TEXT CHECK (result_type IN ('winner', 'draw')),
  winner_user_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX rng_rps_games_expiry
  ON rng_rps_games(state, expires_at);

CREATE TABLE rng_rps_participants (
  game_id TEXT NOT NULL REFERENCES rng_rps_games(game_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
  choice TEXT CHECK (choice IN ('rock', 'paper', 'scissors')),
  stake_debited INTEGER NOT NULL DEFAULT 0 CHECK (stake_debited IN (0, 1)),
  result_status TEXT CHECK (result_status IN ('WIN', 'LOSE', 'DRAW')),
  PRIMARY KEY (game_id, user_id),
  UNIQUE (game_id, seat)
);

CREATE TABLE rng_rps_active_players (
  user_id TEXT PRIMARY KEY REFERENCES rng_players(user_id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES rng_rps_games(game_id) ON DELETE CASCADE
);
