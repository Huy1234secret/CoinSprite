const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/features/work/repositories/database');
const { WorkRepository } = require('../src/features/work/repositories/workRepository');
const { migrate: countingMigrate } = require('../src/features/counting/repositories/database');
const { CountingRepository } = require('../src/features/counting/repositories/countingRepository');
const { LotteryRepository, ticketDate, cutoff, rankFor, TICKET_KEY, PRIZES, DAY } = require('../src/features/lottery/repository');
const { LotteryScheduler, rollPayload, winnerDm } = require('../src/features/lottery/scheduler');
const { createShopFeature, confirmation } = require('../src/features/shop');
const { inventorySnapshot } = require('../src/features/inventory/web');
const { messagePayloadErrors } = require('../src/features/shared/discordPayload');
const USER = '123456789012345678', OTHER = '123456789012345679', GUILD = '223456789012345678', CHANNEL = '323456789012345678';
function generator() { let seed = 9; return max => { seed = (seed * 1664525 + 1013904223) >>> 0; return Math.floor(seed / 4294967296 * max); }; }
function setup(t) {
  const db = openDatabase({ databasePath: ':memory:' }); countingMigrate(db); t.after(() => db.close());
  let now = cutoff('2026-09-07') - 1000;
  const options = { clock: () => now, rng: generator() }, repo = new LotteryRepository(db, options);
  db.prepare('INSERT INTO counting_bronze_balances VALUES(?,?,?)').run(USER, 1000000n, now);
  return { db, repo, options, setTime: value => { now = value; } };
}
function buy(repo, count = 1, user = USER) { const order = repo.createOrder(user, GUILD, CHANNEL, count); return { order, result: repo.purchase(order.id, user, GUILD, CHANNEL) }; }
test('cutoff uses UTC+7 and handles exact boundary, month and year transitions', () => {
  assert.equal(ticketDate(cutoff('2026-09-07') - 1), '2026-09-07');
  assert.equal(ticketDate(cutoff('2026-09-07')), '2026-09-08');
  assert.equal(ticketDate(cutoff('2026-12-31')), '2027-01-01');
  assert.equal(ticketDate(cutoff('2026-02-28')), '2026-03-01');
});
test('purchase atomically debits wallet, issues unique owner codes, and is idempotent', t => {
  const { db, repo } = setup(t);
  const { order } = buy(repo, 100);
  assert.equal(repo.balance(USER), 900000n);
  const tickets = repo.history(USER).tickets;
  assert.equal(tickets.length, 100); assert.equal(new Set(tickets.map(ticket => ticket.code)).size, 100);
  assert.ok(tickets.every(ticket => /^\d[A-Z]-\d[A-Z]-\d[A-Z]$/.test(ticket.code)));
  assert.equal(repo.purchase(order.id, USER, GUILD, CHANNEL).duplicate, true); assert.equal(repo.balance(USER), 900000n);
  assert.throws(() => repo.purchase(order.id, OTHER, GUILD, CHANNEL), /another user/);
  assert.throws(() => repo.purchase(order.id, USER, GUILD, 'other'), /another user/);
  assert.equal(db.prepare('SELECT quantity FROM inventory WHERE user_id=? AND item_key=?').get(USER, TICKET_KEY).quantity, 100n);
  const data = inventorySnapshot(db, USER); assert.equal(data.items[0].quantity, '100'); assert.ok(!JSON.stringify(data).includes(tickets[0].code));
  assert.deepEqual(inventorySnapshot(db, OTHER).items, []);
  assert.equal(repo.history(OTHER).total, 0);
});
test('purchase rechecks funds, validates quantity and expiry, and rolls back on ticket allocation failure', t => {
  const { db, repo, setTime } = setup(t);
  for (const amount of [0, -1, 1.5, 1001, NaN]) assert.throws(() => repo.createOrder(USER, GUILD, CHANNEL, amount));
  const order = repo.createOrder(USER, GUILD, CHANNEL, 1000);
  db.prepare('UPDATE counting_bronze_balances SET balance=999999 WHERE user_id=?').run(USER);
  assert.equal(repo.purchase(order.id, USER, GUILD, CHANNEL).status, 'insufficient');
  assert.equal(repo.history(USER).total, 0);
  db.prepare('UPDATE counting_bronze_balances SET balance=1000000 WHERE user_id=?').run(USER);
  db.exec("CREATE TRIGGER reject_ticket BEFORE INSERT ON lottery_tickets BEGIN SELECT RAISE(ABORT,'ticket failure'); END");
  assert.throws(() => repo.purchase(order.id, USER, GUILD, CHANNEL), /ticket failure/);
  assert.equal(repo.balance(USER), 1000000n); assert.equal(repo.order(order.id).purchased_at, null);
  db.exec('DROP TRIGGER reject_ticket');
  setTime(cutoff('2026-09-07') + 300001);
  assert.throws(() => repo.purchase(order.id, USER, GUILD, CHANNEL), /expired/);
});
test('draw pays exact prizes above the old cap once and consumes only its own date', t => {
  const { db, repo, setTime } = setup(t);
  buy(repo, 3);
  // Preview the deterministic draw on a separate empty database with the same generator state.
  const previewDb = openDatabase({ databasePath: ':memory:' });
  const rng = generator(); for (let i = 0; i < 18; i++) rng(i % 2 ? 26 : 10);
  const previewRepo = new LotteryRepository(previewDb, { clock: () => cutoff('2026-09-07'), rng });
  const expected = previewRepo.draw('2026-09-07'); previewDb.close();
  const ids = db.prepare('SELECT id FROM lottery_tickets ORDER BY id').all();
  const codes = [expected.first, `${expected.first.startsWith('0A') ? '1A' : '0A'}-${expected.second[0]}`,
    `${expected.first.startsWith('2A') ? '3A' : '2A'}-9Z-${expected.third[0]}`];
  // Avoid an accidental second-prize suffix in the third-prize fixture.
  for (let n = 0; expected.second.includes(codes[2].slice(3)); n++) codes[2] = `2A-${n}A-${expected.third[0]}`;
  ids.forEach((row, i) => db.prepare('UPDATE lottery_tickets SET code=? WHERE id=?').run(codes[i], row.id));
  setTime(cutoff('2026-09-07'));
  buy(repo, 1); // next-day ticket must survive the previous draw
  // The purchase consumed RNG; restore the draw RNG to match the preview.
  const drawRng = generator(); for (let i = 0; i < 18; i++) drawRng(i % 2 ? 26 : 10); repo.rng = drawRng;
  const before = repo.balance(USER), draw = repo.draw('2026-09-07', [{ guildId: GUILD, channelId: CHANNEL }]);
  assert.equal(draw.first, expected.first);
  assert.deepEqual(repo.winners(draw.id).map(row => Number(row.rank)), [1, 2, 3]);
  assert.equal(repo.balance(USER), before + PRIZES[1] + PRIZES[2] + PRIZES[3]);
  assert.equal(db.prepare('SELECT quantity FROM inventory WHERE user_id=? AND item_key=?').get(USER, TICKET_KEY).quantity, 1n);
  assert.equal(repo.history(USER, '2026-09-08').tickets[0].settled, false);
  assert.equal(repo.draw('2026-09-07').id, draw.id);
  assert.equal(repo.balance(USER), before + PRIZES[1] + PRIZES[2] + PRIZES[3]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lottery_deliveries').get().n, 2n);
  const count = new CountingRepository(db);
  assert.equal(count.processAttempt({ messageId: 'above-cap', guildId: GUILD, channelId: CHANNEL, userId: USER, submittedValue: '1' }).credited, 1n);
  const work = new WorkRepository(db, { clock: () => cutoff('2026-09-07') });
  work.create({ sessionId: 'above-cap', guildId: GUILD, channelId: CHANNEL, userId: USER, job: 'cashier', difficulty: 'easy', deadline: cutoff('2026-09-08'), state: {}, baseSalary: 100, xpReward: 0 });
  assert.equal(work.settle('above-cap', 'succeeded').session.salaryCredited, 100);
  assert.deepEqual(messagePayloadErrors(rollPayload(draw, repo.winners(draw.id), 'https://example.com/profile?tab=inventory')), []);
  assert.deepEqual(messagePayloadErrors(winnerDm(draw, repo.winners(draw.id), 'https://example.com/profile?tab=inventory')), []);
});
test('matching pays only the highest rank across either adjacent block and every single-pair position', () => {
  const draw = { first: '5A-1B-0F', second: ['1B-0F', '3C-2D'], third: ['0F', '2D', '9Z'] };
  assert.equal(rankFor('5A-1B-0F', draw), 1); assert.equal(rankFor('6A-1B-0F', draw), 2);
  assert.equal(rankFor('6A-4B-0F', draw), 3); assert.equal(rankFor('0F-1B-4A', draw), 3);
  const ticket = '5B-1E-0Y';
  for (const second of ['5B-1E', '1E-0Y']) assert.equal(rankFor(ticket, { first: '', second: [second], third: ['0Y'] }), 2);
  for (const third of ['5B', '1E', '0Y']) assert.equal(rankFor(ticket, { first: '', second: [], third: [third] }), 3);
  assert.equal(rankFor(ticket, { first: ticket, second: ['5B-1E'], third: ['5B'] }), 1);
  assert.equal(rankFor(ticket, { first: '', second: ['5B-1E', '1E-0Y'], third: ['5B', '1E', '0Y'] }), 2);
  for (const second of ['1E-5B', '0Y-1E', '5B-0Y']) assert.equal(rankFor(ticket, { first: '', second: [second], third: [] }), null);
  assert.equal(rankFor('5B-0Y-1E', { first: '', second: ['5B-1E'], third: [] }), null);
  assert.equal(rankFor(ticket, { first: '', second: [], third: ['0Z'] }), null);
});
test('draw failures roll back tickets, wallet, draw number and deliveries together', t => {
  const { db, repo, setTime } = setup(t); buy(repo, 1); setTime(cutoff('2026-09-07'));
  const before = repo.balance(USER);
  db.exec("CREATE TRIGGER draw_failure BEFORE UPDATE ON lottery_tickets BEGIN SELECT RAISE(ABORT,'draw failure'); END");
  assert.throws(() => repo.draw('2026-09-07'), /draw failure/);
  assert.equal(repo.balance(USER), before); assert.equal(repo.history(USER).tickets[0].settled, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lottery_draws').get().n, 0n);
  db.exec('DROP TRIGGER draw_failure'); assert.equal(repo.draw('2026-09-07').id, 1);
});
test('ticket codes can coincide for different owners; search, pagination and 30-day history stay private', t => {
  const { db, repo, setTime } = setup(t); buy(repo, 105);
  const ticket = repo.history(USER).tickets[0];
  db.prepare('INSERT INTO lottery_tickets(user_id,guild_id,draw_date,code,purchased_at) VALUES(?,?,?,?,?)').run(OTHER, GUILD, '2026-09-07', ticket.code, cutoff('2026-09-07') - 1);
  assert.equal(repo.history(USER).total, 105); assert.equal(repo.history(USER, null, '', 2).tickets.length, 5);
  assert.equal(repo.history(USER, null, ticket.code.toLowerCase()).total, 1);
  assert.equal(repo.history(OTHER).total, 1);
  setTime(cutoff('2026-10-07'));
  assert.throws(() => repo.history(USER, '2026-09-07'), /30 days/);
  assert.equal(repo.history(USER).total, 0);
});
test('scheduler recovers due tickets, selects fallback channel, retries delivery and does not reroll', async t => {
  const { db, repo, options, setTime } = setup(t); buy(repo, 1); setTime(cutoff('2026-09-07'));
  const priorUrl = process.env.ADMIN_PUBLIC_URL; process.env.ADMIN_PUBLIC_URL = 'https://example.com';
  t.after(() => { if (priorUrl === undefined) delete process.env.ADMIN_PUBLIC_URL; else process.env.ADMIN_PUBLIC_URL = priorUrl; });
  let sends = 0, fail = true;
  const client = { guilds: { cache: new Map([[GUILD, { id: GUILD }]]) }, channels: { fetch: async () => ({ guildId: GUILD, send: async payload => {
    assert.deepEqual(messagePayloadErrors(payload), []); if (fail) throw new Error('Missing permission'); sends++;
  } }) } };
  const settings = { ...options, isGuildEnabled: () => true, getGuildConfig: () => ({ games: { commandSettings: [{ commands: ['cs-shop'], channelIds: [CHANNEL] }] } }) };
  const scheduler = new LotteryScheduler(db, client, settings);
  assert.equal(scheduler.targets()[0].channelId, CHANNEL);
  await scheduler.tick(); assert.equal(sends, 0);
  const first = db.prepare('SELECT first FROM lottery_draws').get().first;
  fail = false; setTime(cutoff('2026-09-07') + 120001);
  await new LotteryScheduler(db, client, settings).tick(); await scheduler.tick();
  assert.equal(sends, 1); assert.equal(db.prepare('SELECT first FROM lottery_draws').get().first, first);
});
test('shop validates modal quantities, public confirmations, owner authorization and repeated clicks', async t => {
  const { db, options, repo } = setup(t); const feature = createShopFeature({ db, ...options });
  let payload;
  const base = { guildId: GUILD, channelId: CHANNEL, user: { id: USER }, reply: async p => { payload = p; } };
  for (const value of ['0', '-1', '1e2', '1.5', '1001']) {
    await feature.handleInteraction({ ...base, isModalSubmit: () => true, customId: 'csshop:quantity', fields: { getTextInputValue: () => value } });
    assert.equal(payload.flags & 64, 64);
  }
  await feature.handleInteraction({ ...base, isModalSubmit: () => true, customId: 'csshop:quantity', fields: { getTextInputValue: () => '2' } });
  assert.equal(payload.flags & 64, 0); assert.deepEqual(messagePayloadErrors(payload), []);
  const customId = payload.components[0].components[1].components[0].custom_id;
  await feature.handleInteraction({ ...base, user: { id: OTHER }, isButton: () => true, customId }); assert.equal(payload.flags & 64, 64);
  const buyInput = { ...base, isButton: () => true, customId, deferUpdate: async () => {}, editReply: async p => { payload = p; } };
  await feature.handleInteraction(buyInput); await feature.handleInteraction(buyInput);
  assert.equal(repo.balance(USER), 998000n); assert.equal(repo.history(USER).total, 2);
  const order = repo.createOrder(USER, GUILD, CHANNEL, 1000);
  const missing = confirmation(order, 0n); assert.equal(missing.components[0].components[1].components[0].disabled, true);
  assert.deepEqual(messagePayloadErrors(missing), []);
});

test('wallet migrations preserve old balances and arbitrary-precision values in either startup order', () => {
  const { openSqliteDatabase } = require('../src/features/shared/database');
  const { migrate: workMigrate } = require('../src/features/work/repositories/database');
  for (const first of ['counting', 'work']) {
    const db = openSqliteDatabase(':memory:');
    try {
      db.exec('CREATE TABLE counting_bronze_balances(user_id TEXT PRIMARY KEY,balance INTEGER NOT NULL CHECK(balance>=0 AND balance<=1000000),updated_at INTEGER NOT NULL)');
      db.prepare('INSERT INTO counting_bronze_balances VALUES(?,?,?)').run(USER, 999999, 1);
      (first === 'counting' ? countingMigrate : workMigrate)(db);
      assert.equal(new LotteryRepository(db).balance(USER), 999999n);
      const huge = 10n ** 80n + 7n;
      db.prepare('UPDATE counting_bronze_balances SET balance=? WHERE user_id=?').run(huge.toString(), USER);
      (first === 'counting' ? workMigrate : countingMigrate)(db);
      const repo = new LotteryRepository(db, { rng: generator() });
      assert.equal(repo.balance(USER), huge);
      buy(repo); assert.equal(repo.balance(USER), huge - 1000n);
      workMigrate(db); countingMigrate(db); assert.equal(repo.balance(USER), huge - 1000n);
    } finally { db.close(); }
  }
});

test('long winner lists continue in durable messages without dropping winners or exceeding text limits', async t => {
  const { db, repo, options, setTime } = setup(t); setTime(cutoff('2026-09-07'));
  const oldUrl = process.env.ADMIN_PUBLIC_URL; process.env.ADMIN_PUBLIC_URL = 'https://example.com';
  t.after(() => { if (oldUrl === undefined) delete process.env.ADMIN_PUBLIC_URL; else process.env.ADMIN_PUBLIC_URL = oldUrl; });
  const draw = repo.draw('2026-09-07', [{ guildId: GUILD, channelId: CHANNEL }]);
  const owners = Array.from({ length: 60 }, (_, i) => String(600000000000000000n + BigInt(i)));
  for (const userId of owners) db.prepare('INSERT INTO lottery_tickets(user_id,guild_id,draw_date,code,purchased_at,settled,rank,earnings) VALUES(?,?,?,?,?,1,1,1757000000)').run(userId, GUILD, draw.date, draw.first, 1);
  const sent = [], client = { guilds: { cache: new Map() }, channels: { fetch: async () => ({ guildId: GUILD, send: async p => { sent.push(p); } }) } };
  const scheduler = new LotteryScheduler(db, client, { ...options, isGuildEnabled: () => true });
  await scheduler.tick(); await scheduler.tick();
  assert.ok(sent.length > 1);
  const all = sent.map(p => JSON.stringify(p.components)).join('');
  for (const userId of owners) assert.ok(all.includes(`<@${userId}>`));
  for (const payload of sent) {
    assert.deepEqual(messagePayloadErrors(payload), []);
    const texts = payload.components.flatMap(c => c.components || []).filter(c => c.type === 10).map(c => c.content);
    assert.ok(texts.join('').length <= 4000);
  }
  const prior = sent.length; await scheduler.tick(); assert.equal(sent.length, prior);
});

test('a slow Discord send cannot hold up settlement at the next daily cutoff', async t => {
  const { db, options, setTime } = setup(t); setTime(cutoff('2026-09-07'));
  const oldUrl = process.env.ADMIN_PUBLIC_URL; process.env.ADMIN_PUBLIC_URL = 'https://example.com';
  t.after(() => { if (oldUrl === undefined) delete process.env.ADMIN_PUBLIC_URL; else process.env.ADMIN_PUBLIC_URL = oldUrl; });
  let release, started;
  const sending = new Promise(resolve => { started = resolve; });
  const client = { guilds: { cache: new Map([[GUILD, { id: GUILD, systemChannelId: CHANNEL }]]) }, channels: { fetch: async () => ({ guildId: GUILD, send: async () => {
    started(); await new Promise(resolve => { release = resolve; });
  } }) } };
  const scheduler = new LotteryScheduler(db, client, { ...options, isGuildEnabled: () => true, getGuildConfig: () => ({}) });
  const firstTick = scheduler.tick(); await sending;
  setTime(cutoff('2026-09-08')); await scheduler.tick();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM lottery_draws').get().n, 2n);
  release(); await firstTick;
});
