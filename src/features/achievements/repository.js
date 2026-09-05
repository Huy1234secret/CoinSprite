const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { CATALOG, perks } = require('./catalog');

class AchievementRepository {
  constructor(db) {
    this.db = db;
    db.transaction(() => {
      db.exec('CREATE TABLE IF NOT EXISTS achievement_schema_migrations (version TEXT PRIMARY KEY)');
      if (!db.prepare('SELECT 1 FROM achievement_schema_migrations WHERE version=?').get('001')) {
        db.exec(fs.readFileSync(path.join(__dirname, 'migrations/001_achievements.sql'), 'utf8'));
        db.prepare('INSERT INTO achievement_schema_migrations VALUES (?)').run('001');
      }
      this.backfill('work');
      this.backfill('counting');
    }).immediate();
  }
  ensure(userId) { this.db.prepare('INSERT OR IGNORE INTO achievement_progress(user_id) VALUES (?)').run(userId); }
  snapshot(userId) {
    const progress = this.db.prepare('SELECT * FROM achievement_progress WHERE user_id=?').get(userId)
      || { work: 0n, expert: 0n, streak: 0n, best_streak: 0n, level: 1n, counts: 0n, jackpot: 0n, sixty_seven: 0n };
    const earned = Object.fromEntries(this.db.prepare('SELECT track, MAX(tier) AS tier FROM achievement_medals WHERE user_id=? GROUP BY track').all(userId)
      .map(row => [row.track, Number(row.tier)]));
    return { progress, earned };
  }
  perks(userId) { return perks(this.snapshot(userId).earned); }
  unlock(userId, event = null) {
    const { progress, earned } = this.snapshot(userId);
    for (const track of CATALOG) {
      const value = progress[track.metric === 'streak' ? 'best_streak' : track.metric];
      let highest = earned[track.id] || 0;
      for (const [i, tier] of track.tiers.entries()) {
        if (BigInt(value) < BigInt(tier.target)) break;
        this.db.prepare('INSERT OR IGNORE INTO achievement_medals VALUES (?,?,?)').run(userId, track.id, i + 1);
        highest = Math.max(highest, i + 1);
      }
      if (event && highest > (earned[track.id] || 0)) {
        const identity = JSON.stringify([event.id, userId, track.id, highest]);
        // A stable <=25-character nonce for Discord's supported recent-message deduplication.
        const id = createHash('sha256').update(identity).digest('hex').slice(0, 24);
        this.db.prepare(`INSERT INTO achievement_outbox
          (id,event_id,user_id,track,tier,upgraded,guild_id,channel_id,created_at,available_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, event.id, userId, track.id, highest,
          earned[track.id] ? 1 : 0, event.guildId, event.channelId, event.now, event.now);
      }
    }
  }
  work(session, profile, now) {
    this.ensure(session.userId);
    const success = session.status === 'succeeded' ? 1 : 0;
    this.db.prepare(`UPDATE achievement_progress SET work=work+?, expert=expert+?,
      streak=?, best_streak=MAX(best_streak,?), level=MAX(level,?) WHERE user_id=?`)
      .run(success, success && session.difficulty === 'expert' ? 1 : 0, profile.streak, profile.streak, profile.level, session.userId);
    this.unlock(session.userId, { id: `work:${session.sessionId}`, guildId: session.guildId, channelId: session.channelId, now });
  }
  count(attempt, now) {
    this.ensure(attempt.userId);
    this.db.prepare(`UPDATE achievement_progress SET counts=counts+1,
      jackpot=MAX(jackpot,?), sixty_seven=MAX(sixty_seven,?) WHERE user_id=?`)
      .run(BigInt(attempt.submittedValue) === 777n ? 1 : 0, BigInt(attempt.submittedValue) === 67n ? 1 : 0, attempt.userId);
    this.unlock(attempt.userId, { id: `counting:${attempt.messageId}`, guildId: attempt.guildId, channelId: attempt.channelId, now });
  }
  backfill(source) {
    const version = `002_backfill_${source}`;
    if (this.db.prepare('SELECT 1 FROM achievement_schema_migrations WHERE version=?').get(version)) return;
    const table = source === 'work' ? 'work_profiles' : 'counting_processed_messages';
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) return;
    if (source === 'work') {
      for (const row of this.db.prepare('SELECT * FROM work_profiles').all()) {
        this.ensure(row.user_id);
        this.db.prepare('UPDATE achievement_progress SET level=?,streak=?,best_streak=? WHERE user_id=?')
          .run(row.level, row.streak, row.streak, row.user_id);
      }
      const streaks = new Map();
      for (const row of this.db.prepare("SELECT * FROM work_sessions WHERE status IN ('succeeded','failed','timed_out') AND settled_at IS NOT NULL ORDER BY settled_at, created_at, session_id").all()) {
        this.ensure(row.user_id);
        const success = row.status === 'succeeded';
        const streak = success ? (streaks.get(row.user_id) || 0) + 1 : 0;
        streaks.set(row.user_id, streak);
        this.db.prepare('UPDATE achievement_progress SET work=work+?,expert=expert+?,best_streak=MAX(best_streak,?) WHERE user_id=?')
          .run(success ? 1 : 0, success && row.difficulty === 'expert' ? 1 : 0, streak, row.user_id);
      }
    } else {
      for (const row of this.db.prepare(`SELECT user_id,COUNT(*) AS total,
        MAX(CASE WHEN submitted_value='777' THEN 1 ELSE 0 END) AS jackpot,
        MAX(CASE WHEN submitted_value='67' THEN 1 ELSE 0 END) AS sixty_seven
        FROM counting_processed_messages WHERE outcome='correct' GROUP BY user_id`).all()) {
        this.ensure(row.user_id);
        this.db.prepare('UPDATE achievement_progress SET counts=?,jackpot=?,sixty_seven=? WHERE user_id=?')
          .run(row.total, row.jackpot, row.sixty_seven, row.user_id);
      }
    }
    for (const { user_id } of this.db.prepare('SELECT user_id FROM achievement_progress').all()) this.unlock(user_id);
    this.db.prepare('INSERT INTO achievement_schema_migrations VALUES (?)').run(version);
  }
}
module.exports = { AchievementRepository };
