const MAX_BRONZE_BALANCE = 1_000_000n;

class CountingRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.clock = options.clock || Date.now;
    this.getStateStatement = db.prepare('SELECT next_expected FROM counting_guild_state WHERE guild_id = ?');
    this.insertStateStatement = db.prepare(`
      INSERT OR IGNORE INTO counting_guild_state (guild_id, next_expected, updated_at)
      VALUES (?, '1', ?)
    `);
    this.updateStateStatement = db.prepare(`
      UPDATE counting_guild_state SET next_expected = ?, updated_at = ? WHERE guild_id = ?
    `);
    this.getBalanceStatement = db.prepare('SELECT balance FROM counting_bronze_balances WHERE user_id = ?');
    this.upsertBalanceStatement = db.prepare(`
      INSERT INTO counting_bronze_balances (user_id, balance, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at
    `);
    this.processedStatement = db.prepare('SELECT outcome FROM counting_processed_messages WHERE message_id = ?');
    this.insertProcessedStatement = db.prepare(`
      INSERT INTO counting_processed_messages
        (message_id, guild_id, channel_id, user_id, outcome, submitted_value, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.processTransaction = db.transaction((attempt) => {
      if (this.processedStatement.get(attempt.messageId)) return { status: 'duplicate' };

      const now = BigInt(this.clock());
      this.insertStateStatement.run(attempt.guildId, now);
      const expected = BigInt(this.getStateStatement.get(attempt.guildId).next_expected);
      const submitted = attempt.submittedValue === null ? null : BigInt(attempt.submittedValue);
      const correct = submitted !== null && submitted === expected;
      let credited = 0n;
      let balance = this.balance(attempt.userId);

      if (correct) {
        const remaining = MAX_BRONZE_BALANCE - balance;
        credited = submitted < remaining ? submitted : remaining;
        if (credited < 0n) credited = 0n;
        balance += credited;
        this.upsertBalanceStatement.run(attempt.userId, balance, now);
        this.updateStateStatement.run((submitted + 1n).toString(), now, attempt.guildId);
      } else {
        this.updateStateStatement.run('1', now, attempt.guildId);
      }

      const outcome = correct ? 'correct' : 'incorrect';
      this.insertProcessedStatement.run(
        attempt.messageId,
        attempt.guildId,
        attempt.channelId,
        attempt.userId,
        outcome,
        submitted?.toString() ?? null,
        now,
      );
      return {
        status: outcome,
        expected: expected.toString(),
        nextExpected: correct ? (submitted + 1n).toString() : '1',
        credited,
        balance,
      };
    }).immediate;
  }

  nextExpected(guildId) {
    return String(this.getStateStatement.get(String(guildId))?.next_expected || '1');
  }

  balance(userId) {
    return BigInt(this.getBalanceStatement.get(String(userId))?.balance || 0);
  }

  processAttempt(attempt) {
    return this.processTransaction({
      messageId: String(attempt.messageId),
      guildId: String(attempt.guildId),
      channelId: String(attempt.channelId),
      userId: String(attempt.userId),
      submittedValue: attempt.submittedValue == null ? null : String(attempt.submittedValue),
    });
  }
}

module.exports = { CountingRepository, MAX_BRONZE_BALANCE };
