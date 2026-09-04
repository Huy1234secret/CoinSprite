const MAX_BRONZE_BALANCE = 1_000_000n;
const WORK_COOLDOWN_MS = 10 * 60_000;
const WORK_TOKEN_KEY = 'work_token';

function number(value) { return Number(value ?? 0); }

function hydrate(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    userId: row.user_id,
    job: row.job,
    difficulty: row.difficulty,
    normalizedDifficulty: Number(row.normalized_d),
    deadline: number(row.deadline),
    state: JSON.parse(row.state_json),
    status: row.status,
    baseSalary: number(row.base_salary),
    xpReward: number(row.xp_reward),
    salaryCredited: number(row.salary_credited),
    xpAwarded: number(row.xp_awarded),
    levelsGained: number(row.levels_gained),
    tokensAwarded: number(row.tokens_awarded),
    failureReason: row.failure_reason || null,
    createdAt: number(row.created_at),
    settledAt: row.settled_at == null ? null : number(row.settled_at),
  };
}

function hydrateProfile(row) {
  return {
    userId: String(row?.user_id || ''),
    level: Math.max(1, number(row?.level) || 1),
    xp: Math.max(0, number(row?.xp)),
    streak: Math.max(0, number(row?.streak)),
    cooldownUntil: Math.max(0, number(row?.cooldown_until)),
  };
}

function requiredXp(level) {
  const offset = Math.max(0, Number(level) - 1);
  return 100 + 50 * offset + 10 * offset * offset;
}

function applyWorkXp(level, xp, amount) {
  let nextLevel = Math.max(1, Number(level) || 1);
  let nextXp = Math.max(0, Number(xp) || 0) + Math.max(0, Number(amount) || 0);
  let levelsGained = 0;
  while (nextXp >= requiredXp(nextLevel)) {
    nextXp -= requiredXp(nextLevel);
    nextLevel += 1;
    levelsGained += 1;
  }
  return { level: nextLevel, xp: nextXp, levelsGained };
}

class WorkRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.clock = options.clock || Date.now;
    this.byId = db.prepare('SELECT * FROM work_sessions WHERE session_id = ?');
    this.activeFor = db.prepare("SELECT * FROM work_sessions WHERE user_id = ? AND status = 'active'");
    this.insert = db.prepare(`INSERT INTO work_sessions
      (session_id,guild_id,channel_id,message_id,user_id,job,difficulty,normalized_d,deadline,state_json,status,base_salary,xp_reward,created_at)
      VALUES (@sessionId,@guildId,@channelId,'',@userId,@job,@difficulty,@normalizedDifficulty,@deadline,@stateJson,'active',@baseSalary,@xpReward,@createdAt)`);
    this.attach = db.prepare("UPDATE work_sessions SET message_id = ? WHERE session_id = ? AND status = 'active'");
    this.updateState = db.prepare("UPDATE work_sessions SET state_json = ? WHERE session_id = ? AND status = 'active'");
    this.abort = db.prepare("UPDATE work_sessions SET status = 'aborted', settled_at = ? WHERE session_id = ? AND status = 'active'");
    this.getProfileStatement = db.prepare('SELECT * FROM work_profiles WHERE user_id = ?');
    this.ensureProfileStatement = db.prepare(`INSERT OR IGNORE INTO work_profiles
      (user_id,level,xp,streak,cooldown_until,updated_at) VALUES (?,1,0,0,0,?)`);
    this.updateProfileStatement = db.prepare(`UPDATE work_profiles
      SET level=?, xp=?, streak=?, cooldown_until=?, updated_at=? WHERE user_id=?`);
    this.getBalanceStatement = db.prepare('SELECT balance FROM counting_bronze_balances WHERE user_id = ?');
    this.upsertBalanceStatement = db.prepare(`INSERT INTO counting_bronze_balances (user_id,balance,updated_at)
      VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance,updated_at=excluded.updated_at`);
    this.addInventoryStatement = db.prepare(`INSERT INTO inventory (user_id,item_key,quantity,updated_at)
      VALUES (?,?,?,?) ON CONFLICT(user_id,item_key) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=excluded.updated_at`);
    this.inventoryStatement = db.prepare('SELECT quantity FROM inventory WHERE user_id=? AND item_key=?');
    this.settleStatement = db.prepare(`UPDATE work_sessions SET
      status=@status, xp_awarded=@xpAwarded, salary_credited=@salaryCredited,
      levels_gained=@levelsGained, tokens_awarded=@tokensAwarded,
      failure_reason=@failureReason, settled_at=@settledAt
      WHERE session_id=@sessionId AND status='active'`);
    this.createTransaction = db.transaction((input) => {
      const now = number(this.clock());
      this.ensureProfileStatement.run(input.userId, BigInt(now));
      const active = hydrate(this.activeFor.get(input.userId));
      if (active) return { status: 'active', session: active, profile: this.profile(input.userId) };
      const profile = this.profile(input.userId);
      if (profile.cooldownUntil > now) return { status: 'cooldown', nextWorkAt: profile.cooldownUntil, profile };
      this.insert.run({ ...input, stateJson: JSON.stringify(input.state), createdAt: BigInt(now) });
      return { status: 'created', session: hydrate(this.byId.get(input.sessionId)), profile };
    }).immediate;
    this.settleTransaction = db.transaction((sessionId, status, failureReason) => {
      const session = hydrate(this.byId.get(sessionId));
      if (!session || session.status !== 'active') {
        return { changed: false, session, profile: session ? this.profile(session.userId) : null };
      }
      const now = number(this.clock());
      this.ensureProfileStatement.run(session.userId, BigInt(now));
      const oldProfile = this.profile(session.userId);
      const succeeded = status === 'succeeded';
      const streak = succeeded ? oldProfile.streak + 1 : 0;
      const finalSalary = succeeded ? Math.floor(session.baseSalary * (100 + streak) / 100) : 0;
      const oldBalance = BigInt(this.getBalanceStatement.get(session.userId)?.balance || 0);
      const room = oldBalance < MAX_BRONZE_BALANCE ? MAX_BRONZE_BALANCE - oldBalance : 0n;
      const creditedBigInt = succeeded ? (BigInt(finalSalary) < room ? BigInt(finalSalary) : room) : 0n;
      const salaryCredited = Number(creditedBigInt);
      if (succeeded) this.upsertBalanceStatement.run(session.userId, oldBalance + creditedBigInt, BigInt(now));
      const progression = succeeded
        ? applyWorkXp(oldProfile.level, oldProfile.xp, session.xpReward)
        : { level: oldProfile.level, xp: oldProfile.xp, levelsGained: 0 };
      const cooldownUntil = now + WORK_COOLDOWN_MS;
      this.updateProfileStatement.run(
        progression.level, progression.xp, streak, BigInt(cooldownUntil), BigInt(now), session.userId,
      );
      if (progression.levelsGained) {
        this.addInventoryStatement.run(session.userId, WORK_TOKEN_KEY, progression.levelsGained, BigInt(now));
      }
      const result = this.settleStatement.run({
        sessionId,
        status,
        xpAwarded: succeeded ? session.xpReward : 0,
        salaryCredited,
        levelsGained: progression.levelsGained,
        tokensAwarded: progression.levelsGained,
        failureReason: succeeded ? null : String(failureReason || 'The job was not completed.').slice(0, 500),
        settledAt: BigInt(now),
      });
      if (!result.changes) return { changed: false, session: hydrate(this.byId.get(sessionId)), profile: this.profile(session.userId) };
      return {
        changed: true,
        nextWorkAt: cooldownUntil,
        finalSalary,
        balance: oldBalance + creditedBigInt,
        session: hydrate(this.byId.get(sessionId)),
        profile: this.profile(session.userId),
      };
    }).immediate;
  }

  create(input) {
    try {
      return this.createTransaction({
        ...input,
        sessionId: String(input.sessionId), guildId: String(input.guildId), channelId: String(input.channelId),
        userId: String(input.userId), difficulty: String(input.difficulty || 'normal'),
        normalizedDifficulty: Math.max(0, Math.min(1, Number(input.normalizedDifficulty) || 0)),
        deadline: BigInt(input.deadline), baseSalary: Number(input.baseSalary), xpReward: Number(input.xpReward),
      });
    } catch (error) {
      if (!String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) throw error;
      const concurrent = hydrate(this.activeFor.get(String(input.userId)));
      if (concurrent) return { status: 'active', session: concurrent, profile: this.profile(input.userId) };
      throw error;
    }
  }

  get(sessionId) { return hydrate(this.byId.get(String(sessionId))); }
  getActive(_guildId, userId) { return hydrate(this.activeFor.get(String(userId))); }
  listActive() { return this.db.prepare("SELECT * FROM work_sessions WHERE status='active'").all().map(hydrate); }
  attachMessage(sessionId, messageId) { this.attach.run(String(messageId), String(sessionId)); return this.get(sessionId); }
  saveState(sessionId, state) { this.updateState.run(JSON.stringify(state), String(sessionId)); return this.get(sessionId); }
  abortSend(sessionId) { this.abort.run(BigInt(number(this.clock())), String(sessionId)); return this.get(sessionId); }
  settle(sessionId, status, failureReason) { return this.settleTransaction(String(sessionId), status, failureReason); }
  profile(userId) {
    const id = String(userId);
    this.ensureProfileStatement.run(id, BigInt(number(this.clock())));
    return hydrateProfile(this.getProfileStatement.get(id));
  }
  inventory(userId, itemKey = WORK_TOKEN_KEY) {
    return number(this.inventoryStatement.get(String(userId), String(itemKey))?.quantity);
  }
  balance(userId) { return BigInt(this.getBalanceStatement.get(String(userId))?.balance || 0); }
}

module.exports = {
  MAX_BRONZE_BALANCE, WORK_COOLDOWN_MS, WORK_TOKEN_KEY, WorkRepository,
  applyWorkXp, hydrate, hydrateProfile, requiredXp,
};
