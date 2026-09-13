const COOLDOWN_MS = 60_000;
const SESSION_TTL_MS = 60_000;

function number(value) { return Number(value ?? 0); }
function big(value) { return BigInt(value ?? 0); }

function hydrateSession(row, offeredApproachIds = []) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    offeredApproachIds: Object.freeze([...offeredApproachIds]),
    approachId: row.approach_id || null,
    status: row.status,
    outcome: row.outcome || null,
    amount: big(row.amount),
    balanceAfter: big(row.balance_after),
    cooldownUntil: number(row.cooldown_until),
    bypassCooldown: Boolean(row.bypass_cooldown),
    createdAt: number(row.created_at),
    expiresAt: number(row.expires_at),
    settledAt: row.settled_at == null ? null : number(row.settled_at),
  };
}

function hydrateProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    cooldownUntil: number(row.cooldown_until),
    attempts: number(row.attempts),
    successes: number(row.successes),
    failures: number(row.failures),
    losses: number(row.losses),
    totalEarned: big(row.total_earned),
    totalLost: big(row.total_lost),
    updatedAt: number(row.updated_at),
  };
}

function sameContext(session, input) {
  return Boolean(session?.messageId)
    && session.userId === String(input.userId || '')
    && session.guildId === String(input.guildId || '')
    && session.channelId === String(input.channelId || '')
    && session.messageId === String(input.messageId || '');
}

class BegRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.clock = options.clock || Date.now;
    this.cooldownMs = number(options.cooldownMs) || COOLDOWN_MS;
    this.sessionTtlMs = number(options.sessionTtlMs) || SESSION_TTL_MS;
    this.getSessionStatement = db.prepare('SELECT * FROM beg_sessions WHERE session_id=?');
    this.getOptionsStatement = db.prepare(
      'SELECT approach_id FROM beg_session_options WHERE session_id=? ORDER BY slot',
    );
    this.getOfferedStatement = db.prepare(
      'SELECT 1 FROM beg_session_options WHERE session_id=? AND approach_id=?',
    );
    this.getOpenStatement = db.prepare(
      "SELECT * FROM beg_sessions WHERE user_id=? AND status='open' ORDER BY created_at DESC LIMIT 1",
    );
    this.getProfileStatement = db.prepare('SELECT * FROM beg_profiles WHERE user_id=?');
    this.ensureProfileStatement = db.prepare(
      'INSERT OR IGNORE INTO beg_profiles (user_id,updated_at) VALUES(?,?)',
    );
    this.getBalanceStatement = db.prepare(
      'SELECT balance FROM counting_bronze_balances WHERE user_id=?',
    );
    this.setBalanceStatement = db.prepare(`INSERT INTO counting_bronze_balances(user_id,balance,updated_at)
      VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance,updated_at=excluded.updated_at`);

    this.openTransaction = db.transaction((input) => {
      const now = number(this.clock());
      db.prepare("UPDATE beg_sessions SET status='expired' WHERE user_id=? AND status='open' AND expires_at<=?")
        .run(input.userId, BigInt(now));
      this.ensureProfileStatement.run(input.userId, BigInt(now));
      const profile = hydrateProfile(this.getProfileStatement.get(input.userId));
      if (!input.bypassCooldown && profile.cooldownUntil > now) {
        return { status: 'cooldown', nextBegAt: profile.cooldownUntil, profile };
      }
      const open = this.getOpenStatement.get(input.userId);
      if (open) return { status: 'active', session: this.session(open.session_id), profile };
      db.prepare(`INSERT INTO beg_sessions
        (session_id,user_id,guild_id,channel_id,bypass_cooldown,created_at,expires_at)
        VALUES(?,?,?,?,?,?,?)`).run(
        input.sessionId, input.userId, input.guildId, input.channelId,
        input.bypassCooldown ? 1 : 0, BigInt(now), BigInt(now + this.sessionTtlMs),
      );
      const insertOption = db.prepare(
        'INSERT INTO beg_session_options(session_id,slot,approach_id) VALUES(?,?,?)',
      );
      input.approachIds.forEach((approachId, slot) => insertOption.run(input.sessionId, slot, approachId));
      return { status: 'opened', session: this.session(input.sessionId), profile };
    }).immediate;

    this.resolveTransaction = db.transaction((sessionId, input) => {
      let session = this.session(sessionId);
      if (!session || !sameContext(session, input)) return { status: 'denied', session };
      if (session.status === 'settled') {
        return { status: 'settled', replay: true, session, profile: this.profile(session.userId) };
      }
      const now = number(this.clock());
      if (session.status !== 'open' || session.expiresAt <= now) {
        if (session.status === 'open') {
          db.prepare("UPDATE beg_sessions SET status='expired' WHERE session_id=? AND status='open'")
            .run(sessionId);
        }
        return { status: 'expired', session: this.session(sessionId) };
      }
      if (!this.getOfferedStatement.get(sessionId, input.approachId)) {
        return { status: 'invalid-approach', session };
      }

      this.ensureProfileStatement.run(session.userId, BigInt(now));
      const oldProfile = hydrateProfile(this.getProfileStatement.get(session.userId));
      if (!session.bypassCooldown && oldProfile.cooldownUntil > now) {
        db.prepare("UPDATE beg_sessions SET status='expired' WHERE session_id=? AND status='open'")
          .run(sessionId);
        return {
          status: 'cooldown', nextBegAt: oldProfile.cooldownUntil,
          profile: oldProfile, session: this.session(sessionId),
        };
      }

      if (!['success', 'fail', 'loss'].includes(input.outcome)) {
        throw new TypeError('Invalid Beg outcome.');
      }
      const oldBalance = this.balance(session.userId);
      let amount = big(input.amount);
      if (amount < 0n) throw new RangeError('Beg amounts cannot be negative.');
      if (input.outcome === 'fail') amount = 0n;
      if (input.outcome === 'loss' && amount > oldBalance) amount = oldBalance;
      const earned = input.outcome === 'success' ? amount : 0n;
      const lost = input.outcome === 'loss' ? amount : 0n;
      const balanceAfter = oldBalance + earned - lost;
      if (balanceAfter < 0n) throw new RangeError('Beg settlement cannot make a wallet negative.');
      if (earned || lost) {
        this.setBalanceStatement.run(session.userId, balanceAfter.toString(), BigInt(now));
      }

      const cooldownUntil = now + this.cooldownMs;
      db.prepare(`UPDATE beg_profiles SET
        cooldown_until=?, attempts=attempts+1, successes=successes+?, failures=failures+?,
        losses=losses+?, total_earned=?, total_lost=?, updated_at=? WHERE user_id=?`).run(
        BigInt(cooldownUntil), input.outcome === 'success' ? 1 : 0,
        input.outcome === 'fail' ? 1 : 0, input.outcome === 'loss' ? 1 : 0,
        (oldProfile.totalEarned + earned).toString(),
        (oldProfile.totalLost + lost).toString(), BigInt(now), session.userId,
      );
      const changed = db.prepare(`UPDATE beg_sessions SET approach_id=?,status='settled',outcome=?,amount=?,
        balance_after=?,cooldown_until=?,settled_at=? WHERE session_id=? AND status='open'`).run(
        input.approachId, input.outcome, amount.toString(), balanceAfter.toString(),
        BigInt(cooldownUntil), BigInt(now), sessionId,
      );
      if (changed.changes !== 1) throw new Error('Beg session was not settled exactly once.');
      session = this.session(sessionId);
      return { status: 'settled', replay: false, session, profile: this.profile(session.userId) };
    }).immediate;
  }

  open(input) {
    const approachIds = Array.isArray(input.approachIds) ? input.approachIds.map(String) : [];
    if (approachIds.length !== 4 || new Set(approachIds).size !== 4) {
      throw new TypeError('A Beg session requires exactly four unique approaches.');
    }
    return this.openTransaction({
      sessionId: String(input.sessionId), userId: String(input.userId),
      guildId: String(input.guildId), channelId: String(input.channelId),
      approachIds, bypassCooldown: input.bypassCooldown === true,
    });
  }

  session(sessionId) {
    const id = String(sessionId);
    const options = this.getOptionsStatement.all(id).map(row => row.approach_id);
    return hydrateSession(this.getSessionStatement.get(id), options);
  }

  openForUser(userId) {
    const row = this.getOpenStatement.get(String(userId));
    return row ? this.session(row.session_id) : null;
  }

  profile(userId) {
    const id = String(userId);
    const now = number(this.clock());
    this.ensureProfileStatement.run(id, BigInt(now));
    return hydrateProfile(this.getProfileStatement.get(id));
  }

  balance(userId) { return big(this.getBalanceStatement.get(String(userId))?.balance); }

  attachMessage(sessionId, messageId) {
    this.db.prepare("UPDATE beg_sessions SET message_id=? WHERE session_id=? AND status='open' AND message_id=''")
      .run(String(messageId), String(sessionId));
    return this.session(sessionId);
  }

  abort(sessionId) {
    this.db.prepare("UPDATE beg_sessions SET status='expired' WHERE session_id=? AND status='open'")
      .run(String(sessionId));
    return this.session(sessionId);
  }

  resolve(sessionId, input) {
    return this.resolveTransaction(String(sessionId), {
      ...input,
      approachId: String(input.approachId || ''),
      userId: String(input.userId || ''), guildId: String(input.guildId || ''),
      channelId: String(input.channelId || ''), messageId: String(input.messageId || ''),
    });
  }
}

module.exports = {
  BegRepository, COOLDOWN_MS, SESSION_TTL_MS, hydrateProfile, hydrateSession, sameContext,
};
