CREATE TABLE rng_casino_active_players (
  user_id TEXT PRIMARY KEY REFERENCES rng_players(user_id) ON DELETE CASCADE,
  game_type TEXT NOT NULL CHECK (game_type IN ('rps', 'roulette')),
  game_id TEXT NOT NULL
);

INSERT INTO rng_casino_active_players (user_id, game_type, game_id)
SELECT user_id, 'rps', game_id FROM rng_rps_active_players;

DROP TABLE rng_rps_active_players;

CREATE TABLE rng_roulette_games (
  game_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL DEFAULT '',
  host_user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  mode TEXT CHECK (mode IN ('bot', 'human')),
  state TEXT NOT NULL CHECK (state IN (
    'CHOOSING_MODE', 'CHOOSING_OPPONENTS', 'LOBBY', 'BETTING', 'SPINNING',
    'FINISHED', 'CANCELED', 'EXPIRED'
  )),
  winning_number INTEGER CHECK (winning_number BETWEEN 0 AND 36),
  winning_color TEXT CHECK (winning_color IN ('green', 'red', 'black')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX rng_roulette_games_expiry ON rng_roulette_games(state, expires_at);

CREATE TABLE rng_roulette_participants (
  game_id TEXT NOT NULL REFERENCES rng_roulette_games(game_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 3),
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0, 1)),
  ready INTEGER NOT NULL DEFAULT 0 CHECK (ready IN (0, 1)),
  escrowed_total INTEGER NOT NULL DEFAULT 0 CHECK (escrowed_total BETWEEN 0 AND 1000),
  result_stake INTEGER NOT NULL DEFAULT 0 CHECK (result_stake >= 0),
  result_return INTEGER NOT NULL DEFAULT 0 CHECK (result_return >= 0),
  result_net INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, user_id),
  UNIQUE (game_id, seat)
);

CREATE TABLE rng_roulette_bets (
  bet_id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES rng_roulette_games(game_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  canonical_type TEXT NOT NULL,
  canonical_target TEXT NOT NULL,
  anchor_key TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 1000),
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'SETTLED', 'REFUNDED')),
  created_sequence INTEGER NOT NULL CHECK (created_sequence > 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (game_id, user_id) REFERENCES rng_roulette_participants(game_id, user_id) ON DELETE CASCADE,
  UNIQUE (game_id, user_id, canonical_type, canonical_target)
);

CREATE INDEX rng_roulette_bets_game_state ON rng_roulette_bets(game_id, state);

CREATE TABLE rng_roulette_bet_operations (
  operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_key TEXT NOT NULL UNIQUE,
  game_id TEXT NOT NULL REFERENCES rng_roulette_games(game_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES rng_players(user_id) ON DELETE CASCADE,
  bet_id INTEGER REFERENCES rng_roulette_bets(bet_id) ON DELETE SET NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('PLACE', 'UNDO', 'CLEAR', 'LEAVE', 'READY', 'REFUND')),
  delta_amount INTEGER NOT NULL CHECK (delta_amount >= 0),
  reversed INTEGER NOT NULL DEFAULT 0 CHECK (reversed IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE INDEX rng_roulette_operations_undo
  ON rng_roulette_bet_operations(game_id, user_id, operation_type, reversed, operation_id DESC);
