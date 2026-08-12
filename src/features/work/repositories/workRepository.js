const { SQLITE_INTEGER_MAX } = require('../../rng-game/repositories/gameRepository');
const { boostedReward } = require('../ranks');

function jsonArray(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // The database invariant error below is more useful than a JSON parser error.
  }
  throw new Error(`Stored work ${label} is invalid.`);
}

function workProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    totalXp: row.total_xp,
    completedShifts: row.completed_shifts,
    failedShifts: row.failed_shifts,
    totalTokenSalary: row.total_token_salary,
    lastShiftEndAt: row.last_shift_end_at === null ? null : Number(row.last_shift_end_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function workSession(row) {
  if (!row) return null;
  return {
    id: row.session_id,
    userId: row.user_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    gameId: row.game_id,
    customerId: Number(row.customer_id),
    gameMessage: row.game_message,
    expectedRecipe: jsonArray(row.expected_recipe_json, 'recipe'),
    buttonSlots: jsonArray(row.button_slots_json, 'button slots'),
    consumedSlots: jsonArray(row.consumed_slots_json, 'consumed slots').map(Number),
    currentProgress: Number(row.current_progress),
    baseReward: row.base_reward,
    salaryBoost: Number(row.salary_boost),
    failedSlotIndex: row.failed_slot_index === null ? null : Number(row.failed_slot_index),
    state: row.state,
    startedAt: Number(row.started_at),
    expiresAt: Number(row.expires_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
    updatedAt: Number(row.updated_at),
  };
}

function sqliteSafe(value, label) {
  const integer = BigInt(value);
  if (integer < 0n || integer > SQLITE_INTEGER_MAX) {
    throw new RangeError(`${label} exceeds the SQLite signed 64-bit range.`);
  }
  return integer;
}

class WorkRepository {
  constructor(db, playerRepository) {
    this.db = db;
    this.playerRepository = playerRepository;
    this.statements = {
      ensureProfile: db.prepare(`INSERT OR IGNORE INTO rng_work_profiles
        (user_id, total_xp, completed_shifts, failed_shifts, total_token_salary,
         created_at, updated_at) VALUES (?, 0, 0, 0, 0, ?, ?)`),
      profile: db.prepare('SELECT * FROM rng_work_profiles WHERE user_id = ?'),
      session: db.prepare('SELECT * FROM rng_work_sessions WHERE session_id = ?'),
      setMessage: db.prepare(`UPDATE rng_work_sessions SET message_id = ?, updated_at = ?
        WHERE session_id = ?`),
      activeForUser: db.prepare(`SELECT * FROM rng_work_sessions
        WHERE user_id = ? AND state = 'active' LIMIT 1`),
      insertSession: db.prepare(`INSERT INTO rng_work_sessions
        (session_id, user_id, guild_id, channel_id, message_id, game_id, customer_id,
         game_message, expected_recipe_json, button_slots_json, consumed_slots_json,
         current_progress, base_reward, salary_boost, state, started_at, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?, 'active', ?, ?, ?)`),
      advanceSession: db.prepare(`UPDATE rng_work_sessions SET consumed_slots_json = ?,
        current_progress = ?, updated_at = ? WHERE session_id = ? AND state = 'active'`),
      resolveSession: db.prepare(`UPDATE rng_work_sessions SET state = ?, consumed_slots_json = ?,
        current_progress = ?, failed_slot_index = ?, completed_at = ?, updated_at = ?
        WHERE session_id = ? AND state = 'active'`),
      expireSession: db.prepare(`UPDATE rng_work_sessions SET state = 'expired', completed_at = ?, updated_at = ?
        WHERE session_id = ? AND state = 'active'`),
      failProfile: db.prepare(`UPDATE rng_work_profiles SET failed_shifts = ?,
        last_shift_end_at = ?, updated_at = ? WHERE user_id = ?`),
      completeProfile: db.prepare(`UPDATE rng_work_profiles SET total_xp = ?, completed_shifts = ?,
        total_token_salary = ?, last_shift_end_at = ?, updated_at = ? WHERE user_id = ?`),
      cooldownProfile: db.prepare(`UPDATE rng_work_profiles SET last_shift_end_at = ?,
        updated_at = ? WHERE user_id = ?`),
      playerWallet: db.prepare('SELECT token_balance FROM rng_players WHERE user_id = ?'),
      updateWallet: db.prepare('UPDATE rng_players SET token_balance = ?, updated_at = ? WHERE user_id = ?'),
    };

    this.startTransaction = db.transaction((definition, now, ttlMs, cooldownMs) => {
      const userId = String(definition.userId);
      this.ensureProfile(userId, now);
      const activeRow = this.statements.activeForUser.get(userId);
      if (activeRow) {
        if (Number(activeRow.expires_at) > now) return { status: 'already-active', session: workSession(activeRow) };
        this.statements.expireSession.run(BigInt(now), BigInt(now), activeRow.session_id);
      }
      const profile = workProfile(this.statements.profile.get(userId));
      const availableAt = profile.lastShiftEndAt === null ? 0 : profile.lastShiftEndAt + cooldownMs;
      if (availableAt > now) return { status: 'cooldown', availableAt };
      this.statements.insertSession.run(
        definition.id,
        userId,
        String(definition.guildId || ''),
        String(definition.channelId || ''),
        String(definition.messageId || ''),
        definition.gameId,
        BigInt(definition.customerId),
        definition.gameMessage,
        JSON.stringify(definition.expectedRecipe),
        JSON.stringify(definition.buttonSlots),
        BigInt(definition.baseReward),
        BigInt(definition.salaryBoost),
        BigInt(now),
        BigInt(now + ttlMs),
        BigInt(now),
      );
      return { status: 'ok', session: workSession(this.statements.session.get(definition.id)) };
    }).immediate;

    this.pressTransaction = db.transaction((sessionId, userId, slotIndex, now) => {
      const row = this.statements.session.get(sessionId);
      if (!row) return { status: 'missing' };
      const session = workSession(row);
      if (session.userId !== userId) return { status: 'unauthorized', session };
      if (session.state !== 'active') return { status: 'resolved', session };
      if (session.expiresAt <= now) {
        this.statements.expireSession.run(BigInt(now), BigInt(now), session.id);
        return { status: 'expired', session: workSession(this.statements.session.get(session.id)) };
      }
      const slot = session.buttonSlots.find((candidate) => Number(candidate.index) === slotIndex);
      if (!slot) return { status: 'invalid-slot', session };
      if (session.consumedSlots.includes(slotIndex)) return { status: 'consumed', session };
      const expectedIngredient = session.expectedRecipe[session.currentProgress];
      if (slot.ingredient !== expectedIngredient) {
        this.ensureProfile(userId, now);
        const profile = workProfile(this.statements.profile.get(userId));
        const failedShifts = sqliteSafe(profile.failedShifts + 1n, 'Failed shift count');
        this.statements.resolveSession.run(
          'failed', JSON.stringify(session.consumedSlots), BigInt(session.currentProgress),
          BigInt(slotIndex), BigInt(now), BigInt(now), session.id,
        );
        this.statements.failProfile.run(failedShifts, BigInt(now), BigInt(now), userId);
        return {
          status: 'failed',
          expectedIngredient,
          selectedIngredient: slot.ingredient,
          session: workSession(this.statements.session.get(session.id)),
        };
      }
      const consumedSlots = [...session.consumedSlots, slotIndex];
      const progress = session.currentProgress + 1;
      if (progress < session.expectedRecipe.length) {
        this.statements.advanceSession.run(JSON.stringify(consumedSlots), BigInt(progress), BigInt(now), session.id);
        return { status: 'advanced', session: workSession(this.statements.session.get(session.id)) };
      }

      this.ensureProfile(userId, now);
      const profile = workProfile(this.statements.profile.get(userId));
      const finalReward = boostedReward(session.baseReward, session.salaryBoost);
      const player = this.statements.playerWallet.get(userId);
      const tokenBalance = sqliteSafe(player.token_balance + finalReward, 'Token balance');
      const totalXp = sqliteSafe(profile.totalXp + session.baseReward, 'Work XP');
      const completedShifts = sqliteSafe(profile.completedShifts + 1n, 'Completed shift count');
      const totalTokenSalary = sqliteSafe(profile.totalTokenSalary + finalReward, 'Total token salary');
      this.statements.resolveSession.run(
        'completed', JSON.stringify(consumedSlots), BigInt(progress), null,
        BigInt(now), BigInt(now), session.id,
      );
      this.statements.updateWallet.run(tokenBalance, BigInt(now), userId);
      this.statements.completeProfile.run(
        totalXp, completedShifts, totalTokenSalary, BigInt(now), BigInt(now), userId,
      );
      return {
        status: 'completed',
        finalReward,
        previousXp: profile.totalXp,
        totalXp,
        session: workSession(this.statements.session.get(session.id)),
      };
    }).immediate;

    this.cancelTransaction = db.transaction((sessionId, userId, now) => {
      const row = this.statements.session.get(sessionId);
      if (!row) return { status: 'missing' };
      const session = workSession(row);
      if (session.userId !== userId) return { status: 'unauthorized', session };
      if (session.state !== 'active') return { status: 'resolved', session };
      if (session.expiresAt <= now) {
        this.statements.expireSession.run(BigInt(now), BigInt(now), session.id);
        return { status: 'expired', session: workSession(this.statements.session.get(session.id)) };
      }
      this.ensureProfile(userId, now);
      this.statements.resolveSession.run(
        'canceled', JSON.stringify(session.consumedSlots), BigInt(session.currentProgress),
        null, BigInt(now), BigInt(now), session.id,
      );
      this.statements.cooldownProfile.run(BigInt(now), BigInt(now), userId);
      return { status: 'canceled', session: workSession(this.statements.session.get(session.id)) };
    }).immediate;

    this.expireTransaction = db.transaction((sessionId, now) => {
      const row = this.statements.session.get(sessionId);
      if (!row) return { status: 'missing' };
      const session = workSession(row);
      if (session.state !== 'active') return { status: 'resolved', session };
      if (session.expiresAt > now) return { status: 'active', session };
      this.statements.expireSession.run(BigInt(now), BigInt(now), session.id);
      return { status: 'expired', session: workSession(this.statements.session.get(session.id)) };
    }).immediate;
  }

  ensureProfile(userId, now = Date.now()) {
    const id = String(userId);
    this.playerRepository.ensurePlayer(id, now);
    this.statements.ensureProfile.run(id, BigInt(now), BigInt(now));
    return workProfile(this.statements.profile.get(id));
  }

  profile(userId, now = Date.now()) {
    return this.ensureProfile(userId, now);
  }

  session(sessionId) {
    return workSession(this.statements.session.get(String(sessionId)));
  }

  setMessage(sessionId, messageId, now = Date.now()) {
    this.statements.setMessage.run(String(messageId || ''), BigInt(now), String(sessionId));
    return this.session(sessionId);
  }

  start(definition, options = {}) {
    return this.startTransaction(
      definition,
      Number(options.now ?? Date.now()),
      Number(options.ttlMs),
      Number(options.cooldownMs),
    );
  }

  press(sessionId, userId, slotIndex, now = Date.now()) {
    return this.pressTransaction(String(sessionId), String(userId), Number(slotIndex), Number(now));
  }

  cancel(sessionId, userId, now = Date.now()) {
    return this.cancelTransaction(String(sessionId), String(userId), Number(now));
  }

  expire(sessionId, now = Date.now()) {
    return this.expireTransaction(String(sessionId), Number(now));
  }
}

module.exports = { WorkRepository, sqliteSafe, workProfile, workSession };
