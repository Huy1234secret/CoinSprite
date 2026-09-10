const { AchievementRepository } = require('../../achievements/repository');
const { reward } = require('../../achievements/catalog');
const { CAREERS, DAY_MS, BOOST_GOALS } = require('../data/careers');
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
    careerId: number(row?.career_id) || null,
    dayStart: number(row?.career_day_start), dailyCompleted: number(row?.daily_completed),
    dailyBoostTier: number(row?.daily_boost_tier), salaryBoost: number(row?.salary_boost),
    jobChangeUntil: number(row?.job_change_until),
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
    this.achievements = new AchievementRepository(db);
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
      const employment = this.refreshEmployment(input.userId, now);
      const profile = this.profile(input.userId);
      if (employment.fired || (!profile.careerId && profile.jobChangeUntil > now)) return { status: 'fired', profile };
      if (!input.bypassCooldown && profile.cooldownUntil > now) {
        return { status: 'cooldown', nextWorkAt: profile.cooldownUntil, profile };
      }
      this.insert.run({ ...input, baseSalary: profile.career?.salary ?? input.baseSalary, stateJson: JSON.stringify(input.state), createdAt: BigInt(now) });
      return { status: 'created', session: hydrate(this.byId.get(input.sessionId)), profile };
    }).immediate;
    this.settleTransaction = db.transaction((sessionId, status, failureReason) => {
      const session = hydrate(this.byId.get(sessionId));
      if (!session || session.status !== 'active') {
        return { changed: false, session, profile: session ? this.profile(session.userId) : null };
      }
      const now = number(this.clock());
      this.ensureProfileStatement.run(session.userId, BigInt(now));
      if (this.refreshEmployment(session.userId, now).fired) {
        status = 'failed';
        failureReason = 'Your boss fired you for missing the daily work requirement.';
      }
      const oldProfile = this.profile(session.userId);
      if (!oldProfile.careerId && oldProfile.jobChangeUntil > now) {
        status = 'failed';
        failureReason = 'Your boss fired you for missing the daily work requirement.';
      }
      const succeeded = status === 'succeeded';
      const streak = succeeded ? oldProfile.streak + 1 : 0;
      const perks = this.achievements.perks(session.userId);
      const salaryBase = session.baseSalary;
      const boost = oldProfile.career ? BigInt(oldProfile.salaryBoost * 100) + perks.salaryBoost : 0n;
      const salary = succeeded ? BigInt(salaryBase) * (10000n + boost)
        * (10000n + perks.work + (session.difficulty === 'expert' ? perks.expert : 0n)) / 100000000n : 0n;
      let boostIncreased = false;
      if (succeeded && oldProfile.career) {
        const completed = oldProfile.dailyCompleted + 1;
        const tier = BOOST_GOALS.filter(goal => completed >= oldProfile.career.dailyRequired + goal).length;
        boostIncreased = tier > oldProfile.dailyBoostTier;
        this.db.prepare('UPDATE work_profiles SET daily_completed=?,daily_boost_tier=?,salary_boost=salary_boost+? WHERE user_id=?')
          .run(completed, tier, Math.max(0, tier - oldProfile.dailyBoostTier) * 10, session.userId);
      }
      const finalSalary = Number(salary);
      const xpAwarded = succeeded ? Number(reward(session.xpReward, perks.xp)) : 0;
      const oldBalance = BigInt(this.getBalanceStatement.get(session.userId)?.balance || 0);
      const creditedBigInt = salary;
      const salaryCredited = Number(creditedBigInt);
      if (succeeded) this.upsertBalanceStatement.run(session.userId, (oldBalance + creditedBigInt).toString(), BigInt(now));
      const progression = succeeded
        ? applyWorkXp(oldProfile.level, oldProfile.xp, xpAwarded)
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
        xpAwarded,
        salaryCredited,
        levelsGained: progression.levelsGained,
        tokensAwarded: progression.levelsGained,
        failureReason: succeeded ? null : String(failureReason || 'The job was not completed.').slice(0, 500),
        settledAt: BigInt(now),
      });
      if (!result.changes) return { changed: false, session: hydrate(this.byId.get(sessionId)), profile: this.profile(session.userId) };
      this.achievements.work({ ...session, status }, { ...progression, streak }, BigInt(now));
      return {
        changed: true,
        nextWorkAt: cooldownUntil,
        finalSalary, boostIncreased,
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
        bypassCooldown: input.bypassCooldown === true,
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
  getActive(userId) { return hydrate(this.activeFor.get(String(userId))); }
  listActive() { return this.db.prepare("SELECT * FROM work_sessions WHERE status='active'").all().map(hydrate); }
  attachMessage(sessionId, messageId) { this.attach.run(String(messageId), String(sessionId)); return this.get(sessionId); }
  saveState(sessionId, state) { this.updateState.run(JSON.stringify(state), String(sessionId)); return this.get(sessionId); }
  abortSend(sessionId) { this.abort.run(BigInt(number(this.clock())), String(sessionId)); return this.get(sessionId); }
  settle(sessionId, status, failureReason) { return this.settleTransaction(String(sessionId), status, failureReason); }
  profile(userId) {
    const id = String(userId);
    this.ensureProfileStatement.run(id, BigInt(number(this.clock())));
    return { ...hydrateProfile(this.getProfileStatement.get(id)),
      career: CAREERS[number(this.getProfileStatement.get(id)?.career_id) - 1] || null,
      totalCompleted: Number(this.achievements.snapshot(id).progress.work),
      salaryBoostBonus: Number(this.achievements.perks(id).salaryBoost) / 100 };
  }
  refreshEmployment(userId, now = number(this.clock())) {
    const profile = this.profile(userId);
    if (!profile.career || now < profile.dayStart + DAY_MS) return { fired: false };
    const elapsed = Math.floor((now - profile.dayStart) / DAY_MS);
    if (profile.dailyCompleted < profile.career.dailyRequired || elapsed > 1) {
      // Start the lock when the missed requirement is detected, so the firing notice always grants 24 hours.
      this.db.prepare('UPDATE work_profiles SET career_id=NULL,salary_boost=0,daily_completed=0,daily_boost_tier=0,job_change_until=? WHERE user_id=?')
        .run(BigInt(now + DAY_MS), String(userId));
      return { fired: true };
    }
    this.db.prepare('UPDATE work_profiles SET career_day_start=?,daily_completed=0,daily_boost_tier=0 WHERE user_id=?')
      .run(BigInt(profile.dayStart + DAY_MS), String(userId));
    return { fired: false };
  }
  employment(userId) {
    return this.db.transaction(() => { this.refreshEmployment(String(userId)); return this.profile(userId); }).immediate();
  }
  applyCareer(userId, careerId) {
    return this.db.transaction(() => {
      const id = String(userId), now = number(this.clock());
      this.refreshEmployment(id, now);
      const profile = this.profile(id), career = CAREERS[Number(careerId) - 1];
      if (!career || profile.level < career.level || profile.totalCompleted < career.totalRequired)
        return { status: 'requirements', profile };
      if (profile.careerId === career.id) return { status: 'applied', profile };
      if (this.getActive(id)) return { status: 'active', profile };
      if (profile.jobChangeUntil > now) return { status: 'cooldown', profile };
      this.db.prepare('UPDATE work_profiles SET career_id=?,career_day_start=?,daily_completed=0,daily_boost_tier=0,job_change_until=? WHERE user_id=?')
        .run(career.id, BigInt(now), BigInt(now + DAY_MS), id);
      return { status: 'applied', profile: this.profile(id) };
    }).immediate();
  }
  inventory(userId, itemKey = WORK_TOKEN_KEY) {
    return number(this.inventoryStatement.get(String(userId), String(itemKey))?.quantity);
  }
  balance(userId) { return BigInt(this.getBalanceStatement.get(String(userId))?.balance || 0); }
}

module.exports = {
  WORK_COOLDOWN_MS, WORK_TOKEN_KEY, WorkRepository,
  applyWorkXp, hydrate, hydrateProfile, requiredXp,
};
