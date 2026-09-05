const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDatabase } = require('../src/features/work/repositories/database');
const { migrate: migrateCounting } = require('../src/features/counting/repositories/database');
const { WorkRepository } = require('../src/features/work/repositories/workRepository');
const { CountingRepository } = require('../src/features/counting/repositories/countingRepository');
const { AchievementRepository } = require('../src/features/achievements/repository');
const { AchievementOutbox } = require('../src/features/achievements/outbox');
const { createAchievementFeature, parseAchievementCommand } = require('../src/features/achievements');
const { AchievementService } = require('../src/features/achievements/service');
const { CATALOG, MEDALS, perks, reward } = require('../src/features/achievements/catalog');
const { resolveEmoji, announcementPayload, achievementPayload } = require('../src/features/achievements/components');
const { messagePayloadErrors } = require('../src/features/shared/discordPayload');
const { featureCommandsForConfig } = require('../src/applicationCommands');
const { normalizeGamesConfig, gameCommandAllowed } = require('../src/serverConfig');
const { createCountingFeature } = require('../src/features/counting');
const USER = '323456789012345678';
const GUILD = '123456789012345678';
const CHANNEL = '223456789012345678';
function setup(t, databasePath = ':memory:') {
  const db = openDatabase({ databasePath });
  migrateCounting(db);
  t.after(() => { if (db.open) db.close(); });
  const work = new WorkRepository(db, { clock: () => 1000000 });
  const counting = new CountingRepository(db, { clock: () => 1000000 });
  return { db, work, counting, achievements: work.achievements };
}
function job(work, id, overrides = {}, status = 'succeeded') {
  const input = { sessionId: id, guildId: GUILD, channelId: CHANNEL, userId: USER,
    job: 'burger', difficulty: 'easy', deadline: 2000000, state: {}, baseSalary: 200,
    xpReward: 0, bypassCooldown: true, ...overrides };
  assert.equal(work.create(input).status, 'created');
  return work.settle(id, status);
}
function count(db, counting, id, value, guildId = GUILD, userId = USER) {
  db.prepare(`INSERT INTO counting_guild_state(guild_id,next_expected,updated_at) VALUES (?,?,0)
    ON CONFLICT(guild_id) DO UPDATE SET next_expected=excluded.next_expected,last_user_id=NULL`).run(guildId, String(value));
  return counting.processAttempt({ messageId: id, guildId, channelId: CHANNEL, userId, submittedValue: String(value) });
}
function seed(achievements, values) {
  achievements.ensure(USER);
  const columns = Object.keys(values);
  achievements.db.prepare(`UPDATE achievement_progress SET ${columns.map(key => `${key}=?`).join(',')} WHERE user_id=?`)
    .run(...Object.values(values), USER);
  achievements.unlock(USER);
}
function text(payload) { return payload.components[0].components.filter(c => c.type === 10).map(c => c.content).join('\n'); }
// Test-only IDs; production resolves exact names from Discord caches.
function emoji(name) { const id = String(123456789012345670n + BigInt([...Object.values(MEDALS), 'CSEMedal'].indexOf(name))); return { mention: `<:${name}:${id}>`, url: `https://cdn.discordapp.com/emojis/${id}.png` }; }

test('every exact threshold unlocks permanent slots in order and perks replace lower tiers', t => {
  const { achievements, db } = setup(t);
  for (const track of CATALOG) {
    const user = track.id;
    achievements.ensure(user);
    const metric = track.metric === 'streak' ? 'best_streak' : track.metric;
    for (const [i, tier] of track.tiers.entries()) {
      db.prepare(`UPDATE achievement_progress SET ${metric}=? WHERE user_id=?`).run(tier.target - 1, user);
      achievements.unlock(user);
      assert.equal(achievements.snapshot(user).earned[track.id] || 0, i);
      db.prepare(`UPDATE achievement_progress SET ${metric}=? WHERE user_id=?`).run(tier.target, user);
      achievements.unlock(user);
      assert.equal(achievements.snapshot(user).earned[track.id], i + 1);
      assert.deepEqual(achievements.perks(user), perks({ [track.id]: i + 1 }));
    }
    db.prepare(`UPDATE achievement_progress SET ${metric}=0 WHERE user_id=?`).run(user);
    achievements.unlock(user);
    assert.equal(achievements.snapshot(user).earned[track.id], track.tiers.length);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM achievement_medals').get().n, 21n);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM achievement_outbox').get().n, 0n);
});

test('Work bonuses add exactly, filter Expert earnings, and start on the next job', t => {
  const { work, achievements, db } = setup(t);
  seed(achievements, { work: 49, best_streak: 9, streak: 9, expert: 10 });
  work.profile(USER);
  db.prepare('UPDATE work_profiles SET streak=9 WHERE user_id=?').run(USER);
  const first = job(work, 'threshold', { difficulty: 'expert' });
  assert.equal(first.finalSalary, 254); // 1 + .1 + .1 + .01 + .0625
  assert.equal(achievements.snapshot(USER).earned.career_worker, 2);
  const next = job(work, 'next', { difficulty: 'expert' });
  assert.equal(next.finalSalary, 271); // 200 * (1 + .11 + .11 + .075 + .0625)
  db.prepare('UPDATE work_profiles SET streak=9 WHERE user_id=?').run(USER);
  assert.equal(job(work, 'example', { difficulty: 'expert' }).finalSalary, 267);
  db.prepare('UPDATE work_profiles SET streak=9 WHERE user_id=?').run(USER);
  assert.equal(job(work, 'non-expert').finalSalary, 255);
  const before = achievements.snapshot(USER);
  assert.equal(work.settle('example', 'succeeded').changed, false);
  assert.deepEqual(achievements.snapshot(USER), before);
});

test('XP uses pre-event perks only; failed/time-out jobs reset live streak without revoking medals; aborted sends do not', t => {
  const { work, achievements, db } = setup(t);
  seed(achievements, { work: 249, best_streak: 20 });
  assert.equal(job(work, 'xp-threshold', { xpReward: 100 }).session.xpAwarded, 100);
  assert.equal(job(work, 'xp-next', { xpReward: 199 }).session.xpAwarded, 200);
  job(work, 'fail', {}, 'failed');
  assert.equal(achievements.snapshot(USER).progress.streak, 0n);
  assert.equal(achievements.snapshot(USER).earned.reliable_employee, 2);
  job(work, 'success');
  job(work, 'timeout', {}, 'timed_out');
  assert.equal(achievements.snapshot(USER).progress.streak, 0n);
  job(work, 'before-abort');
  const before = achievements.snapshot(USER);
  work.create({ sessionId: 'abort', guildId: GUILD, channelId: CHANNEL, userId: USER, job: 'burger', difficulty: 'easy',
    deadline: 2000000, state: {}, baseSalary: 100, xpReward: 1, bypassCooldown: true });
  work.abortSend('abort');
  assert.deepEqual(achievements.snapshot(USER), before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%leveling%'").get().n, 0n);
});

test('Counting accepted 67/777, global totals, cap and arbitrary-size exact additive rewards', t => {
  const { db, counting, achievements } = setup(t);
  assert.equal(count(db, counting, '67', 67).credited, 67n);
  assert.equal(count(db, counting, '777', 777, 'second-guild').credited, 829n);
  seed(achievements, { counts: 100 });
  assert.equal(count(db, counting, 'example', 100).credited, 204n);
  const bonus = achievements.perks(USER).counting;
  assert.equal(bonus, 10440n);
  const huge = 10n ** 100n + 67n;
  assert.equal(reward(huge, bonus), huge * 20440n / 10000n);
  assert.equal(count(db, counting, 'huge', huge).balance, 1000000n);
  const prior = achievements.snapshot(USER).progress.counts;
  assert.equal(count(db, counting, 'cap', 1).credited, 0n);
  assert.equal(achievements.snapshot(USER).progress.counts, prior + 1n);
  const snapshot = achievements.snapshot(USER);
  assert.equal(counting.processAttempt({ messageId: 'cap', guildId: GUILD, channelId: CHANNEL, userId: USER, submittedValue: '1' }).status, 'duplicate');
  assert.equal(counting.processAttempt({ messageId: 'wrong', guildId: GUILD, channelId: CHANNEL, userId: USER, submittedValue: '777' }).status, 'incorrect');
  count(db, counting, 'set66', 66, GUILD, 'other');
  assert.equal(counting.processAttempt({ messageId: 'same', guildId: GUILD, channelId: CHANNEL, userId: 'other', submittedValue: '67' }).reason, 'same-user');
  assert.deepEqual(achievements.snapshot(USER), snapshot);
  assert.equal(achievements.snapshot('other').earned['67'], undefined);
});

test('threshold Counting payout uses old perk, Work cap still advances Expert totals', t => {
  const { db, counting, work, achievements } = setup(t);
  seed(achievements, { counts: 24 });
  assert.equal(count(db, counting, '25th', 100).credited, 100n);
  assert.equal(count(db, counting, '26th', 100).credited, 110n);
  db.prepare('UPDATE counting_bronze_balances SET balance=999999 WHERE user_id=?').run(USER);
  const result = job(work, 'cap', { difficulty: 'expert' });
  assert.equal(result.session.salaryCredited, 1);
  assert.equal(achievements.snapshot(USER).progress.expert, 1n);
});

test('progress, rewards, medals, and outbox all roll back if enqueue fails', t => {
  const { db, work, counting, achievements } = setup(t);
  seed(achievements, { work: 9 });
  db.exec("CREATE TRIGGER break_enqueue BEFORE INSERT ON achievement_outbox BEGIN SELECT RAISE(ABORT, 'test failure'); END");
  assert.throws(() => job(work, 'atomic'), /test failure/);
  assert.equal(work.get('atomic').status, 'active');
  assert.equal(work.balance(USER), 0n);
  assert.equal(achievements.snapshot(USER).progress.work, 9n);
  assert.throws(() => count(db, counting, 'atomic-count', 777), /test failure/);
  assert.equal(counting.nextExpected(GUILD), '777');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM counting_processed_messages').get().n, 0n);
  db.exec('DROP TRIGGER break_enqueue');
  assert.equal(work.settle('atomic', 'succeeded').changed, true);
  assert.equal(count(db, counting, 'atomic-count', 777).status, 'correct');
});

test('menu renders five then two tracks, permanent medal summaries, omitted slots, next progress and MAX', t => {
  const { achievements } = setup(t);
  seed(achievements, { work: 50, best_streak: 20, streak: 2, level: 30, jackpot: 1, sixty_seven: 1 });
  const service = new AchievementService(achievements, emoji);
  const first = achievementPayload(USER, service.page(USER));
  const second = achievementPayload(USER, service.page(USER, 2));
  assert.deepEqual(messagePayloadErrors(first), []);
  assert.equal(service.page(USER).items.length, 5);
  assert.equal(service.page(USER, 2).items.length, 2);
  assert.match(text(first), /Career Worker\*\* II/);
  assert.match(text(first), /50 \/ 250/);
  assert.match(text(first), /2 \/ 50/);
  assert.match(text(first), /30 \/ 30` MAX/);
  assert.match(text(first), /`4`<:CSBMedal/);
  assert.match(text(first), /`3`<:CSSMedal/);
  assert.match(text(first), /`1`<:CSGMedal/);
  assert.match(text(first), /`1`<:CSDMedal/);
  const advancement = first.components[0].components.find(c => c.content?.startsWith('**Career Advancement'));
  assert.equal((advancement.content.match(/Medal:/g) || []).length, 3);
  assert.match(text(second), /JACKPOT\*\* I ─ <:CSDMedal/);
  assert.match(text(second), /\*\*67\*\* I ─ <:CSBMedal/);
  assert.ok(!text(second).includes('CSEMedal'));
  assert.deepEqual(first.allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
  assert.equal(first.flags & 64, 0);
});

test('commands register and obey Games restrictions; only owners paginate original messages, without announcements', async t => {
  const { db } = setup(t);
  const games = normalizeGamesConfig({ commandSettings: [{ id: 'a', channelIds: [CHANNEL], commands: ['cs-achievements'] }] });
  assert.equal(gameCommandAllowed({ games }, 'other', 'cs-achievements'), false);
  assert.ok(featureCommandsForConfig({ enabled: true }).some(c => c.name === 'cs-achievements'));
  for (const content of ['csachievements', ' CSACHIEVEMENTS\n']) assert.equal(parseAchievementCommand(content), true);
  for (const content of ['csachievements more', 'cs-achievements', 'xcsachievements']) assert.equal(parseAchievementCommand(content), false);
  let allowed = true;
  const feature = createAchievementFeature({ db, isCommandAllowed: () => allowed });
  let payload;
  const source = { guildId: GUILD, channelId: CHANNEL, author: { id: USER }, content: 'csachievements', async reply(p) { payload = p; } };
  await feature.handleMessage(source);
  assert.match(text(payload), /Achievements/);
  for (const change of [{ author: { id: USER, bot: true } }, { webhookId: 'hook' }, { system: true }, { guildId: null }]) {
    assert.equal(await feature.handleMessage({ ...source, ...change }), false);
  }
  allowed = false;
  await feature.handleMessage(source);
  assert.match(text(payload), /not enabled/);
  allowed = true;
  await feature.handleInteraction({ isChatInputCommand: () => true, commandName: 'cs-achievements', guildId: GUILD, channelId: CHANNEL, user: { id: USER }, async reply(p) { payload = p; } });
  assert.equal(payload.flags & 64, 0);
  let modal;
  const button = { isButton: () => true, customId: `csachievements:page:${USER}`, user: { id: USER }, async showModal(p) { modal = p; } };
  await feature.handleInteraction(button);
  assert.match(modal.custom_id, /^csachievements:modal:/);
  await feature.handleInteraction({ ...button, user: { id: 'other' }, async reply(p) { payload = p; }, showModal() { assert.fail(); } });
  assert.equal(payload.flags & 64, 64);
  const submit = value => ({ isModalSubmit: () => true, customId: modal.custom_id, user: { id: USER }, fields: { getTextInputValue: () => value },
    async reply(p) { payload = p; }, async deferUpdate() { this.deferred = true; }, async editReply(p) { payload = p; } });
  for (const value of ['', '0', '-1', '1.1', '1e0', '03', '3', '9'.repeat(10000)]) {
    await feature.handleInteraction({ ...submit(value), editReply() { assert.fail(); } });
    assert.equal(payload.flags & 64, 64);
  }
  await feature.handleInteraction({ ...submit('2'), user: { id: 'other' }, editReply() { assert.fail(); } });
  assert.equal(payload.flags & 64, 64);
  await feature.handleInteraction(submit('2'));
  assert.equal(payload.flags, undefined);
  assert.match(text(payload), /Page 2\/2/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM achievement_outbox').get().n, 0n);
});

test('announcements use each explicit medal image, animated URLs, correct titles and source channels', async t => {
  const { db, achievements, work, counting } = setup(t);
  for (const track of CATALOG) {
    for (const [i, tier] of track.tiers.entries()) {
      const payload = announcementPayload({ user_id: USER, track: track.id, tier: i + 1, upgraded: i > 0 }, emoji);
      assert.deepEqual(messagePayloadErrors(payload), []);
      const section = payload.components[0].components[0];
      assert.equal(section.accessory.media.url, emoji(MEDALS[tier.medal]).url);
      assert.match(section.accessory.description, /Medal for/);
      assert.equal(payload.flags & 64, 0);
      if (track.id === 'jackpot') assert.match(section.components[0].content, /Super Achievement Unlocked/);
      if (i > 0) assert.match(section.components[0].content, /Achievement Upgraded/);
    }
  }
  const clientEmoji = { emojis: { cache: { find: fn => [{ name: 'CSDMedal', id: USER, animated: true }].find(fn) } } };
  assert.match(resolveEmoji(clientEmoji, 'CSDMedal').url, /\.gif$/);
  assert.equal(resolveEmoji(clientEmoji, 'CSBMedal'), null);
  seed(achievements, { work: 9, best_streak: 4 });
  work.profile(USER);
  db.prepare('UPDATE work_profiles SET streak=4 WHERE user_id=?').run(USER);
  job(work, 'multiple', { guildId: 'work-guild', channelId: 'work-channel', xpReward: 2000 });
  count(db, counting, 'jackpot', 777, 'count-guild');
  const delivered = [];
  const client = { channels: { async fetch(id) { return { guildId: id === 'work-channel' ? 'work-guild' : 'count-guild',
    async send(payload) { delivered.push({ id, payload }); return { id: `message-${delivered.length}` }; } }; } } };
  const outbox = new AchievementOutbox(db, client, { resolveEmoji: emoji, clock: () => 1000000 });
  await Promise.all([outbox.drain(), outbox.drain()]);
  assert.equal(delivered.length, 4);
  assert.equal(delivered.filter(d => d.id === 'work-channel').length, 3);
  assert.ok(delivered.every(d => d.payload.enforceNonce && d.payload.nonce.length <= 25));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM achievement_outbox WHERE message_id IS NOT NULL').get().n, 4n);
  await outbox.drain();
  assert.equal(delivered.length, 4);
});

test('outbox retries missing emoji/permission failure, coordinates workers, and recovers durable pending records after restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-achievement-'));
  const file = path.join(dir, 'games.sqlite');
  const { db, counting } = setup(t, file);
  count(db, counting, 'pending', 777);
  let now = 1000000;
  let configured = false;
  let permitted = false;
  let sends = 0;
  const errors = [];
  const client = { channels: { async fetch(id) { assert.equal(id, CHANNEL); return { guildId: GUILD, async send() {
    if (!permitted) throw new Error('Missing permissions');
    sends++; await new Promise(resolve => setTimeout(resolve, 10)); return { id: 'delivered' };
  } }; } } };
  const options = { clock: () => now, resolveEmoji: name => configured ? emoji(name) : null, reportError: error => errors.push(error.message) };
  await new AchievementOutbox(db, client, options).drain();
  assert.match(errors[0], /CSDMedal/);
  assert.equal(counting.balance(USER), 777n);
  now += 60000; configured = true;
  await new AchievementOutbox(db, client, options).drain();
  assert.match(errors[1], /permissions/);
  assert.equal(sends, 0);
  db.close();
  const reopened = openDatabase({ databasePath: file });
  t.after(() => reopened.close());
  new AchievementRepository(reopened);
  now += 120000; permitted = true;
  const other = openDatabase({ databasePath: file });
  t.after(() => other.close());
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await Promise.all([new AchievementOutbox(reopened, client, options).drain(), new AchievementOutbox(other, client, options).drain()]);
  assert.equal(sends, 1);
  const row = reopened.prepare('SELECT * FROM achievement_outbox').get();
  assert.equal(row.message_id, 'delivered');
  assert.equal(row.last_error, null);
  // Expired claims from a crashed worker become eligible again.
  reopened.prepare('UPDATE achievement_outbox SET delivered_at=NULL,message_id=NULL,claim_token=?,lease_until=?').run('crashed', now + 100);
  await new AchievementOutbox(reopened, client, options).drain();
  assert.equal(sends, 1);
  now += 101;
  await new AchievementOutbox(reopened, client, options).drain();
  assert.equal(sends, 2);
});

test('backfill is versioned, silent, repeat-safe and based on settled history plus existing profile only', t => {
  const db = openDatabase({ databasePath: ':memory:' });
  migrateCounting(db);
  t.after(() => db.close());
  db.prepare('INSERT INTO work_profiles VALUES (?,30,0,7,0,0)').run(USER);
  const insert = db.prepare(`INSERT INTO work_sessions(session_id,guild_id,channel_id,user_id,job,difficulty,deadline,state_json,status,created_at,settled_at)
    VALUES (?, ?, ?, ?, 'burger','expert',1,'{}',?, ?, ?)`);
  for (let i = 0; i < 10; i++) insert.run(`old-${i}`, GUILD, CHANNEL, USER, 'succeeded', i, i + 1);
  insert.run('failed', GUILD, CHANNEL, USER, 'failed', 11, 12);
  insert.run('active', GUILD, CHANNEL, USER, 'active', 12, null);
  insert.run('aborted', GUILD, CHANNEL, USER, 'aborted', 13, 14);
  db.prepare("INSERT INTO counting_processed_messages VALUES ('old-count',?,?,?,'correct','777',0)").run(GUILD, CHANNEL, USER);
  db.prepare("INSERT INTO counting_processed_messages VALUES ('wrong-count',?,?,?,'incorrect','67',0)").run(GUILD, CHANNEL, USER);
  db.prepare('INSERT INTO counting_bronze_balances VALUES (?,1000000,0)').run('wallet-only');
  const a = new AchievementRepository(db);
  assert.deepEqual(a.snapshot(USER).progress, { user_id: USER, work: 10n, expert: 10n, streak: 7n, best_streak: 10n, level: 30n, counts: 1n, jackpot: 1n, sixty_seven: 0n });
  const snapshot = a.snapshot(USER);
  new AchievementRepository(db);
  assert.deepEqual(a.snapshot(USER), snapshot);
  assert.equal(a.snapshot('wallet-only').progress.work, 0n);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM achievement_outbox').get().n, 0n);
  const counting = new CountingRepository(db);
  count(db, counting, 'new67', 67);
  new AchievementRepository(db);
  assert.equal(a.snapshot(USER).progress.counts, 2n);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM achievement_outbox').get().n, 1n);
});

test('multiple newly eligible tiers produce one highest announcement; later upgrade is distinct; bots cannot affect Counting', async t => {
  const { db, achievements, counting } = setup(t);
  achievements.ensure(USER);
  db.prepare('UPDATE achievement_progress SET counts=299 WHERE user_id=?').run(USER);
  count(db, counting, 'jump', 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM achievement_medals').get().n, 3n);
  assert.equal(db.prepare('SELECT tier FROM achievement_outbox').get().tier, 3n);
  db.prepare('UPDATE achievement_progress SET counts=999 WHERE user_id=?').run(USER);
  count(db, counting, 'upgrade', 1);
  assert.equal(db.prepare('SELECT upgraded FROM achievement_outbox WHERE tier=4').get().upgraded, 1n);
  const feature = createCountingFeature({ db, getChannelId: () => CHANNEL });
  const before = counting.nextExpected(GUILD);
  assert.equal(await feature.handleMessage({ guildId: GUILD, channelId: CHANNEL, author: { id: USER, bot: true }, content: 'Achievement Unlocked!' }), false);
  assert.equal(counting.nextExpected(GUILD), before);
});
