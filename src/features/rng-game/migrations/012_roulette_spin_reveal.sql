ALTER TABLE rng_roulette_games ADD COLUMN spin_started_at INTEGER;
ALTER TABLE rng_roulette_games ADD COLUMN reveal_at INTEGER;

CREATE INDEX rng_roulette_games_reveal
  ON rng_roulette_games(state, reveal_at);
