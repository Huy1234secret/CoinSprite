function hydrate(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id, guildId: row.guild_id, channelId: row.channel_id,
    messageId: row.message_id, userId: row.user_id, job: row.job, difficulty: row.difficulty,
    deadline: Number(row.deadline), state: JSON.parse(row.state_json), status: row.status,
    xpAwarded: Number(row.xp_awarded), createdAt: Number(row.created_at),
    settledAt: row.settled_at == null ? null : Number(row.settled_at),
  };
}

class WorkRepository {
  constructor(db, options = {}) {
    this.db = db;
    this.clock = options.clock || Date.now;
    this.byId = db.prepare('SELECT * FROM work_sessions WHERE session_id = ?');
    this.activeFor = db.prepare("SELECT * FROM work_sessions WHERE guild_id = ? AND user_id = ? AND status = 'active'");
    this.cooldownFor = db.prepare('SELECT next_work_at FROM work_cooldowns WHERE guild_id = ? AND user_id = ?');
    this.insert = db.prepare(`INSERT INTO work_sessions
      (session_id,guild_id,channel_id,message_id,user_id,job,difficulty,deadline,state_json,status,created_at)
      VALUES (@sessionId,@guildId,@channelId,'',@userId,@job,@difficulty,@deadline,@stateJson,'active',@createdAt)`);
    this.attach = db.prepare("UPDATE work_sessions SET message_id = ? WHERE session_id = ? AND status = 'active'");
    this.updateState = db.prepare("UPDATE work_sessions SET state_json = ? WHERE session_id = ? AND status = 'active'");
    this.abort = db.prepare("UPDATE work_sessions SET status = 'aborted', settled_at = ? WHERE session_id = ? AND status = 'active'");
    this.settleStatement = db.prepare(`UPDATE work_sessions SET status = ?, xp_awarded = ?, settled_at = ?
      WHERE session_id = ? AND status = 'active'`);
    this.cooldown = db.prepare(`INSERT INTO work_cooldowns (guild_id,user_id,next_work_at) VALUES (?,?,?)
      ON CONFLICT(guild_id,user_id) DO UPDATE SET next_work_at=excluded.next_work_at`);
    this.settleTransaction = db.transaction((sessionId, status, xp, cooldownMs) => {
      const session = hydrate(this.byId.get(sessionId));
      if (!session || session.status !== 'active') return { changed: false, session };
      const settledAt = Number(this.clock());
      const nextWorkAt = settledAt + cooldownMs;
      const result = this.settleStatement.run(status, xp, settledAt, sessionId);
      if (!result.changes) return { changed: false, session: hydrate(this.byId.get(sessionId)) };
      this.cooldown.run(session.guildId, session.userId, nextWorkAt);
      return { changed: true, nextWorkAt, session: hydrate(this.byId.get(sessionId)) };
    }).immediate;
  }

  create(input) {
    const now = Number(this.clock());
    const active = hydrate(this.activeFor.get(input.guildId, input.userId));
    if (active) return { status: 'active', session: active };
    const nextWorkAt = Number(this.cooldownFor.get(input.guildId, input.userId)?.next_work_at || 0);
    if (nextWorkAt > now) return { status: 'cooldown', nextWorkAt };
    try {
      this.insert.run({ ...input, stateJson: JSON.stringify(input.state), createdAt: now });
    } catch (error) {
      if (!String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) throw error;
      const concurrent = hydrate(this.activeFor.get(input.guildId, input.userId));
      if (concurrent) return { status: 'active', session: concurrent };
      throw error;
    }
    return { status: 'created', session: hydrate(this.byId.get(input.sessionId)) };
  }

  get(sessionId) { return hydrate(this.byId.get(String(sessionId))); }
  getActive(guildId, userId) { return hydrate(this.activeFor.get(String(guildId), String(userId))); }
  listActive() { return this.db.prepare("SELECT * FROM work_sessions WHERE status = 'active'").all().map(hydrate); }
  attachMessage(sessionId, messageId) { this.attach.run(String(messageId), String(sessionId)); return this.get(sessionId); }
  saveState(sessionId, state) { this.updateState.run(JSON.stringify(state), String(sessionId)); return this.get(sessionId); }
  abortSend(sessionId) { this.abort.run(Number(this.clock()), String(sessionId)); return this.get(sessionId); }
  settle(sessionId, status, xp, cooldownMs) { return this.settleTransaction(String(sessionId), status, xp, cooldownMs); }
}

module.exports = { WorkRepository, hydrate };
