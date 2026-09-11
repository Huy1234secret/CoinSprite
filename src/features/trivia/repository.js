const { randomUUID, randomInt } = require('node:crypto');
const { AchievementRepository } = require('../achievements/repository');
const { reward } = require('../achievements/catalog');
const { question } = require('./questions');

const DIFFICULTIES = Object.freeze({
  easy: { label: 'Easy', level: 1, lives: 3, seconds: 60, bonus: 8, coins: [5, 25], xp: [1, 5], color: 0x57F287 },
  medium: { label: 'Medium', level: 15, lives: 2, seconds: 30, bonus: 9, coins: [10, 50], xp: [3, 15], color: 0xFEE75C },
  hard: { label: 'Hard', level: 40, lives: 1, seconds: 15, bonus: 10, coins: [20, 100], xp: [9, 45], color: 0xED4245 },
});
class TriviaRepository {
  constructor(db, { clock = Date.now, random = randomInt } = {}) {
    this.db = db; this.clock = clock; this.random = random;
    this.achievements = new AchievementRepository(db);
    db.exec(`CREATE TABLE IF NOT EXISTS trivia_profiles (
      user_id TEXT PRIMARY KEY, level INTEGER NOT NULL DEFAULT 1, xp INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS trivia_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, state TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS trivia_active_user ON trivia_sessions(user_id)
        WHERE status IN ('question','feedback');`);
  }
  profile(userId) {
    const row = this.db.prepare('SELECT * FROM trivia_profiles WHERE user_id=?').get(userId);
    return { level: Number(row?.level || 1), xp: Number(row?.xp || 0), nextXp: 100 * Number(row?.level || 1) };
  }
  get(id) { const row = this.db.prepare('SELECT state FROM trivia_sessions WHERE id=?').get(id); return row ? JSON.parse(row.state) : null; }
  active(userId) {
    const row = this.db.prepare("SELECT state FROM trivia_sessions WHERE user_id=? AND status IN ('question','feedback')").get(userId);
    return row ? JSON.parse(row.state) : null;
  }
  pending() { return this.db.prepare("SELECT state FROM trivia_sessions WHERE status IN ('question','feedback')").all().map(r => JSON.parse(r.state)); }
  save(s) {
    this.db.prepare(`INSERT INTO trivia_sessions VALUES (?,?,?,?) ON CONFLICT(id)
      DO UPDATE SET status=excluded.status,state=excluded.state`).run(s.id, s.userId, s.status, JSON.stringify(s));
    return s;
  }
  start(userId, difficulty, context) {
    return this.db.transaction(() => {
      const config = DIFFICULTIES[difficulty];
      if (!config || this.profile(userId).level < config.level) throw new Error('This difficulty is locked.');
      if (this.active(userId)) throw new Error('Finish your current Trivia game first.');
      return this.save({ ...context, id: randomUUID(), userId, difficulty, status: 'question',
        lives: config.lives, number: 1, answered: 0, correctCount: 0, coins: '0', xp: 0,
        question: question(difficulty, [], this.random), deadline: this.clock() + config.seconds * 1000 });
    }).immediate();
  }
  answer(id, userId, number, selected) {
    return this.db.transaction(() => {
      const s = this.get(id);
      if (!s || s.userId !== userId || s.status !== 'question' || s.number !== number) return null;
      const now = this.clock();
      if (selected === null && now < s.deadline) return null;
      if (selected !== null && (!Number.isInteger(selected) || selected < 0 || selected > 3)) return null;
      const config = DIFFICULTIES[s.difficulty];
      const timedOut = now >= s.deadline;
      s.selected = timedOut ? null : selected;
      const correct = !timedOut && selected === s.question.correct;
      if (!timedOut) s.answered++;
      if (correct) {
        const roll = range => range[0] + this.random(range[1] - range[0] + 1);
        const coins = reward(roll(config.coins), this.achievements.perks(userId).trivia);
        const xp = roll(config.xp);
        const wallet = this.db.prepare('SELECT balance FROM counting_bronze_balances WHERE user_id=?').get(userId);
        this.db.prepare(`INSERT INTO counting_bronze_balances VALUES (?,?,?) ON CONFLICT(user_id)
          DO UPDATE SET balance=excluded.balance,updated_at=excluded.updated_at`).run(userId, String(BigInt(wallet?.balance || 0) + coins), now);
        const profile = this.profile(userId);
        profile.xp += xp;
        while (profile.xp >= profile.level * 100) { profile.xp -= profile.level * 100; profile.level++; }
        this.db.prepare(`INSERT INTO trivia_profiles VALUES (?,?,?) ON CONFLICT(user_id)
          DO UPDATE SET level=excluded.level,xp=excluded.xp`).run(userId, profile.level, profile.xp);
        this.achievements.ensure(userId);
        this.db.prepare(`UPDATE achievement_progress SET trivia_${s.difficulty}=trivia_${s.difficulty}+1,
          trivia_level=MAX(trivia_level,?) WHERE user_id=?`).run(profile.level, userId);
        this.achievements.unlock(userId, { id: `trivia:${s.id}:${s.number}`, guildId: s.guildId, channelId: s.channelId, now });
        s.coins = String(BigInt(s.coins) + coins); s.xp += xp; s.correctCount++;
      } else s.lives--;
      s.remaining = timedOut ? config.seconds * 1000 : Math.min(60000, Math.max(0, s.deadline - now) + (correct ? config.bonus * 1000 : 0));
      s.status = 'feedback'; s.revealUntil = now + 3500;
      return this.save(s);
    }).immediate();
  }
  advance(id) {
    return this.db.transaction(() => {
      const s = this.get(id);
      if (!s || s.status !== 'feedback' || this.clock() < s.revealUntil) return null;
      if (!s.lives) s.status = 'ended';
      else {
        s.status = 'question'; s.number++; s.selected = null;
        s.question = question(s.difficulty, s.question.seen, this.random);
        s.deadline = this.clock() + s.remaining;
      }
      return this.save(s);
    }).immediate();
  }
}
module.exports = { TriviaRepository, DIFFICULTIES };
