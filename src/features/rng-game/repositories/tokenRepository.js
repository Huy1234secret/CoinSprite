const { SQLITE_INTEGER_MAX } = require('./gameRepository');

const EXCHANGE_SHECKLES_PER_TOKEN = 1_000n;
const EXCHANGE_WINDOW_LIMIT = 100n;
const EXCHANGE_WINDOW_MS = 4 * 60 * 60 * 1_000;

function exchangeRow(row, duplicate = false) {
  if (!row) return null;
  return {
    status: 'ok',
    operationKey: row.operation_key,
    userId: row.user_id,
    tokenAmount: row.token_amount,
    sheckleCost: row.sheckle_cost,
    exchangedAt: Number(row.exchanged_at),
    duplicate,
  };
}

class TokenRepository {
  constructor(db, gameRepository) {
    this.db = db;
    this.gameRepository = gameRepository;
    this.statements = {
      priorExchange: db.prepare('SELECT * FROM rng_token_exchanges WHERE operation_key = ?'),
      usedInWindow: db.prepare(`SELECT COALESCE(SUM(token_amount), 0) AS total
        FROM rng_token_exchanges WHERE user_id = ? AND exchanged_at > ?`),
      updateWallet: db.prepare(`UPDATE rng_players
        SET sheckle_balance = ?, token_balance = ?, updated_at = ? WHERE user_id = ?`),
      insertExchange: db.prepare(`INSERT INTO rng_token_exchanges
        (operation_key, user_id, token_amount, sheckle_cost, exchanged_at)
        VALUES (?, ?, ?, ?, ?)`),
    };

    this.exchangeTransaction = db.transaction((userId, tokenAmount, operationKey, now) => {
      const prior = exchangeRow(this.statements.priorExchange.get(operationKey), true);
      if (prior) return prior;
      const amount = BigInt(tokenAmount);
      if (amount < 1n || amount > EXCHANGE_WINDOW_LIMIT) {
        return { status: 'invalid-amount', duplicate: false };
      }
      const player = this.gameRepository.ensurePlayer(userId, now);
      const cutoff = BigInt(now - EXCHANGE_WINDOW_MS);
      const used = this.statements.usedInWindow.get(userId, cutoff).total;
      const remaining = EXCHANGE_WINDOW_LIMIT - used;
      if (amount > remaining) {
        return { status: 'rate-limited', used, remaining: remaining > 0n ? remaining : 0n, duplicate: false };
      }
      const cost = amount * EXCHANGE_SHECKLES_PER_TOKEN;
      if (player.balance < cost) {
        return { status: 'insufficient', cost, missing: cost - player.balance, balance: player.balance, duplicate: false };
      }
      const tokenBalance = player.tokenBalance + amount;
      if (tokenBalance > SQLITE_INTEGER_MAX) throw new RangeError('Token balance exceeds the SQLite signed 64-bit range.');
      const balance = player.balance - cost;
      this.statements.updateWallet.run(balance, tokenBalance, BigInt(now), userId);
      this.statements.insertExchange.run(operationKey, userId, amount, cost, BigInt(now));
      return {
        status: 'ok', operationKey, userId, tokenAmount: amount, sheckleCost: cost,
        balance, tokenBalance, exchangedAt: now, used: used + amount, remaining: remaining - amount,
        duplicate: false,
      };
    }).immediate;
  }

  windowStatus(userId, now = Date.now()) {
    this.gameRepository.ensurePlayer(userId, now);
    const used = this.statements.usedInWindow.get(String(userId), BigInt(now - EXCHANGE_WINDOW_MS)).total;
    return { used, remaining: used >= EXCHANGE_WINDOW_LIMIT ? 0n : EXCHANGE_WINDOW_LIMIT - used };
  }

  exchange(userId, tokenAmount, operationKey, now = Date.now()) {
    return this.exchangeTransaction(String(userId), BigInt(tokenAmount), String(operationKey), Number(now));
  }
}

module.exports = {
  EXCHANGE_SHECKLES_PER_TOKEN,
  EXCHANGE_WINDOW_LIMIT,
  EXCHANGE_WINDOW_MS,
  TokenRepository,
};
