const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/features/work/repositories/database');
const { TriviaRepository, DIFFICULTIES } = require('../src/features/trivia/repository');
const { createTriviaFeature, parseTriviaCommand } = require('../src/features/trivia');
const { menu, game } = require('../src/features/trivia/components');
const { BANK, question } = require('../src/features/trivia/questions');
const { messagePayloadErrors } = require('../src/features/shared/discordPayload');
const { featureCommandsForConfig } = require('../src/applicationCommands');
const { gameCommandAllowed, normalizeGamesConfig } = require('../src/serverConfig');
const USER = '323456789012345678';
const context = { guildId: '123456789012345678', channelId: '223456789012345678', messageId: '423456789012345678' };
function setup(t, random = () => 0) {
  const db = openDatabase({ databasePath: ':memory:' });
  let now = 100000;
  const repo = new TriviaRepository(db, { clock: () => now, random });
  t.after(() => db.close());
  return { db, repo, setNow: value => { now = value; }, unlock: level => db.prepare('INSERT OR REPLACE INTO trivia_profiles VALUES (?, ?, 0)').run(USER, level) };
}
test('commands register and respect game channel configuration', () => {
  assert.equal(parseTriviaCommand('cstrivia'), true);
  assert.equal(parseTriviaCommand('/cs-trivia'), true);
  assert.equal(parseTriviaCommand('cstrivia now'), false);
  assert.ok(featureCommandsForConfig({ enabled: true }).some(c => c.name === 'cs-trivia'));
  const config = normalizeGamesConfig({ commandSettings: [{ channelIds: [context.channelId], commands: ['cs-trivia'] }] });
  assert.equal(gameCommandAllowed({ games: config }, context.channelId, 'cs-trivia'), true);
  assert.equal(gameCommandAllowed({ games: config }, 'other', 'cs-trivia'), false);
});
test('difficulty locks and global single active game are enforced in storage', t => {
  const { repo, unlock } = setup(t);
  assert.throws(() => repo.start(USER, 'medium', context), /locked/);
  unlock(14); assert.throws(() => repo.start(USER, 'medium', context), /locked/);
  unlock(15); assert.throws(() => repo.start(USER, 'hard', context), /locked/);
  const s = repo.start(USER, 'medium', context);
  assert.equal(s.lives, 2); assert.equal(s.deadline, 130000);
  assert.throws(() => repo.start(USER, 'easy', { ...context, guildId: 'other' }), /current/);
});
for (const [difficulty, config] of Object.entries(DIFFICULTIES)) {
  test(`${difficulty}: rewards, lives, timer bonus and answer idempotency`, t => {
    const { repo, db, unlock, setNow } = setup(t); unlock(config.level);
    const s = repo.start(USER, difficulty, context);
    assert.equal(s.lives, config.lives);
    setNow(s.deadline - 5000);
    const correct = repo.answer(s.id, USER, 1, s.question.correct);
    assert.equal(correct.coins, String(config.coins[0]));
    assert.equal(correct.xp, config.xp[0]);
    assert.equal(correct.remaining, 5000 + config.bonus * 1000);
    assert.equal(repo.answer(s.id, USER, 1, s.question.correct), null);
    assert.equal(db.prepare('SELECT balance FROM counting_bronze_balances WHERE user_id=?').get(USER).balance, String(config.coins[0]));
    assert.equal(repo.advance(s.id), null);
    setNow(correct.revealUntil); const next = repo.advance(s.id);
    assert.equal(next.number, 2);
    assert.equal(repo.answer(s.id, USER, 1, next.question.correct), null);
    const wrong = repo.answer(s.id, USER, 2, (next.question.correct + 1) % 4);
    assert.equal(wrong.lives, config.lives - 1); assert.equal(wrong.coins, correct.coins);
    assert.equal(wrong.answered, 2); assert.equal(wrong.correctCount, 1);
    setNow(wrong.revealUntil);
    assert.equal(repo.advance(s.id).status, config.lives === 1 ? 'ended' : 'question');
  });
  test(`${difficulty}: inclusive maximum rewards and 60 second cap`, t => {
    const { repo, unlock } = setup(t, upper => upper - 1); unlock(config.level);
    const s = repo.start(USER, difficulty, context);
    const next = repo.answer(s.id, USER, 1, s.question.correct);
    assert.equal(next.coins, String(config.coins[1])); assert.equal(next.xp, config.xp[1]);
    assert.equal(next.remaining, Math.min(60000, (config.seconds + config.bonus) * 1000));
  });
}
test('timeouts consume one life, reject late correct answers, and end at zero', t => {
  const { repo, setNow } = setup(t);
  let s = repo.start(USER, 'easy', context);
  assert.equal(repo.answer(s.id, USER, 1, null), null);
  for (let lives = 2; lives >= 0; lives--) {
    setNow(s.deadline);
    s = repo.answer(s.id, USER, s.number, s.question.correct);
    assert.equal(s.lives, lives); assert.equal(s.coins, '0'); assert.equal(s.answered, 0);
    assert.equal(s.selected, null); assert.equal(s.remaining, 60000);
    setNow(s.revealUntil); s = repo.advance(s.id);
  }
  assert.equal(s.status, 'ended'); assert.equal(repo.active(USER), null);
  assert.equal(repo.answer(s.id, USER, s.number, 0), null);
});
test('XP levels, milestones and additive highest-tier bonuses persist atomically', t => {
  const { repo, db } = setup(t);
  db.prepare('INSERT INTO trivia_profiles VALUES (?,4,399)').run(USER);
  repo.achievements.ensure(USER);
  db.prepare('UPDATE achievement_progress SET trivia_easy=19 WHERE user_id=?').run(USER);
  const s = repo.start(USER, 'easy', context);
  repo.answer(s.id, USER, 1, s.question.correct);
  assert.deepEqual(repo.profile(USER), { level: 5, xp: 0, nextXp: 500 });
  const snapshot = repo.achievements.snapshot(USER);
  assert.equal(snapshot.earned.quick_thinker, 1); assert.equal(snapshot.earned.rising_scholar, 1);
  assert.equal(repo.achievements.perks(USER).trivia, 100n);
  db.prepare('UPDATE achievement_progress SET trivia_easy=1000,trivia_medium=1000,trivia_hard=1000,trivia_level=40 WHERE user_id=?').run(USER);
  repo.achievements.unlock(USER);
  assert.equal(repo.achievements.perks(USER).trivia, 8750n);
  assert.equal(repo.achievements.snapshot(USER).earned.living_encyclopedia, 1);
  const fresh = new TriviaRepository(db);
  assert.equal(fresh.get(s.id).coins, '5'); assert.equal(fresh.profile(USER).level, 5);
});
test('failed reward transaction does not consume answer or grant XP', t => {
  const { repo, db } = setup(t);
  const s = repo.start(USER, 'easy', context);
  db.exec("CREATE TRIGGER reject_trivia BEFORE INSERT ON trivia_profiles BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => repo.answer(s.id, USER, 1, s.question.correct), /test failure/);
  assert.equal(repo.get(s.id).status, 'question'); assert.equal(repo.profile(USER).xp, 0);
  assert.equal(db.prepare('SELECT * FROM counting_bronze_balances WHERE user_id=?').get(USER), undefined);
});
test('achievement coin bonuses apply to the next answer without boosting XP', t => {
  const { repo, db } = setup(t, upper => upper - 1);
  repo.achievements.ensure(USER);
  db.prepare('UPDATE achievement_progress SET trivia_easy=1000,trivia_medium=1000,trivia_hard=1000 WHERE user_id=?').run(USER);
  repo.achievements.unlock(USER);
  const s = repo.start(USER, 'easy', context);
  const next = repo.answer(s.id, USER, 1, s.question.correct);
  assert.equal(next.coins, '46'); // floor(25 * 1.875)
  assert.equal(next.xp, 5);
});
test('Back opens the updated menu and channel restrictions also block buttons', async t => {
  const { repo, db, unlock, setNow } = setup(t); unlock(40);
  let s = repo.start(USER, 'hard', context);
  s = repo.answer(s.id, USER, 1, (s.question.correct + 1) % 4);
  setNow(s.revealUntil); repo.advance(s.id);
  let allowed = true, payload;
  const feature = createTriviaFeature({ db, repository: repo, isCommandAllowed: () => allowed });
  t.after(() => feature.close());
  const interaction = { ...context, user: { id: USER }, message: { id: context.messageId },
    customId: `cstrivia:back:${USER}:${s.id}`, isButton: () => true,
    async deferUpdate() { this.deferred = true; }, async editReply(p) { payload = p; }, async followUp(p) { payload = p; } };
  await feature.handleInteraction(interaction);
  assert.match(payload.components[0].components[0].content, /Trivia level: 40/);
  assert.ok(payload.components[0].components.at(-1).components.every(b => !b.disabled));
  allowed = false;
  await feature.handleInteraction(interaction);
  assert.match(payload.components[0].components[0].content, /not enabled/);
});
test('all payload states fit Discord limits and reveal the right colors', t => {
  const { repo, setNow } = setup(t);
  for (const level of [1, 15, 40]) {
    const payload = menu(USER, { level, xp: 0, nextXp: level * 100 });
    assert.deepEqual(messagePayloadErrors(payload), []);
    assert.deepEqual(payload.components[0].components.at(-1).components.map(b => b.disabled), [false, level < 15, level < 40]);
  }
  const s = repo.start(USER, 'easy', context);
  assert.deepEqual(messagePayloadErrors(game(s)), []);
  const selected = (s.question.correct + 1) % 4;
  const reveal = repo.answer(s.id, USER, 1, selected);
  const payload = game(reveal); assert.deepEqual(messagePayloadErrors(payload), []);
  const buttons = payload.components[0].components.at(-1).components;
  assert.equal(buttons[selected].style, 4); assert.equal(buttons[s.question.correct].style, 3);
  assert.ok(buttons.every(b => b.disabled));
  assert.deepEqual(messagePayloadErrors(game({ ...reveal, status: 'ended' })), []);
});
test('question bank has four unique choices and avoids repeats until exhausted', () => {
  for (const difficulty of Object.keys(BANK)) {
    let seen = [];
    for (let i = 0; i < BANK[difficulty].length; i++) {
      const q = question(difficulty, seen, () => 0);
      assert.equal(new Set(q.answers).size, 4); assert.ok(q.answers.every(a => a.length <= 80));
      assert.equal(q.seen.length, i + 1); seen = q.seen;
    }
    assert.equal(question(difficulty, seen).seen.length, 1);
  }
});
test('Discord ownership, locked buttons, duplicate clicks and recovery timers', async t => {
  const { repo, db, setNow } = setup(t);
  const queued = new Map(); let timerId = 0; const updates = [];
  const feature = createTriviaFeature({ db, repository: repo, setTimeout: (fn, delay) => { queued.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => queued.delete(id), editRecovered: async (_, p) => updates.push(p) });
  t.after(() => feature.close());
  const interaction = (customId, userId = USER) => ({ customId, user: { id: userId }, ...context,
    message: { id: context.messageId, edit: async p => updates.push(p) }, isButton: () => true,
    deferUpdate: async () => {}, editReply: async p => updates.push(p), reply: async p => updates.push(p), followUp: async p => updates.push(p) });
  await feature.handleInteraction(interaction(`cstrivia:start:${USER}:easy`, 'another'));
  assert.equal(repo.active(USER), null);
  await feature.handleInteraction(interaction(`cstrivia:start:${USER}:hard`));
  assert.equal(repo.active(USER), null);
  await feature.handleInteraction(interaction(`cstrivia:start:${USER}:easy`));
  let s = repo.active(USER); assert.equal(queued.size, 1);
  const click = interaction(`cstrivia:answer:${s.id}:1:${s.question.correct}`);
  await Promise.all([feature.handleInteraction(click), feature.handleInteraction(click)]);
  s = repo.get(s.id); assert.equal(s.correctCount, 1); assert.equal(queued.size, 1);
  setNow(s.revealUntil);
  const [firedId, fired] = [...queued.entries()][0]; queued.delete(firedId); await fired.fn();
  assert.equal(repo.get(s.id).number, 2);
  feature.close(); assert.equal(queued.size, 0);
  const recovered = createTriviaFeature({ db, repository: repo, setTimeout: (fn, delay) => { queued.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => queued.delete(id), editRecovered: async (_, p) => updates.push(p) });
  await recovered.recover(); assert.equal(queued.size, 1); recovered.close();
});
