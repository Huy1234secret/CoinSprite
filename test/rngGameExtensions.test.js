const assert = require('node:assert/strict');
const test = require('node:test');
const { GlobalFonts, createCanvas, loadImage } = require('@napi-rs/canvas');

const { createRngGameFeature } = require('../src/features/rng-game');
const { AutoRollScheduler } = require('../src/features/rng-game/services/autoRollService');
const {
  CropIndexRenderer,
  INDEX_CANVAS_HEIGHT,
  INDEX_CANVAS_WIDTH,
  INDEX_CARD_RADIUS,
  INDEX_CARD_SIZE,
  INDEX_MAX_PAGE,
  fitIndexText,
  indexPageModels,
} = require('../src/features/rng-game/services/indexRenderer');
const { INDEX_CANVAS_FONT_FAMILY } = require('../src/canvasFonts');
const {
  bigChance,
  cascadingRoll,
  effectiveChance,
  generateInstance,
  luckMultiplier,
  valueForWeight,
  valueFractionForWeight,
} = require('../src/features/rng-game/services/rngService');
const { bigUpgradeCost, luckUpgradeCost } = require('../src/features/rng-game/services/gameService');
const { CHECKED_SEEDS, FALLBACK_SEED, SEEDS } = require('../src/features/rng-game/data/seeds');
const {
  autoRollPlan,
  autoRollRefund,
  nextGlobalTick,
  parseDuration,
} = require('../src/features/rng-game/utils/autoRoll');
const { romanTier } = require('../src/features/rng-game/utils/upgrades');

function fakeIndexRenderer() {
  return { render: async () => Buffer.from('index'), invalidate() {}, clear() {} };
}

function feature(options = {}) {
  return createRngGameFeature({
    databasePath: ':memory:',
    rng: (maximum) => maximum - 1,
    indexRenderer: fakeIndexRenderer(),
    notifyAutoRoll: async () => {},
    ...options,
  });
}

function fund(game, userId, balance) {
  game.repository.ensurePlayer(userId, 1);
  game.db.prepare('UPDATE rng_players SET sheckle_balance = ? WHERE user_id = ?').run(BigInt(balance), String(userId));
}

function addItem(game, userId, options = {}) {
  const seed = options.seed || FALLBACK_SEED;
  game.repository.ensurePlayer(userId, 1);
  const result = game.db.prepare(`INSERT INTO rng_inventory_items
    (owner_user_id, seed_id, crop_name, rarity, weight_units, stored_value, is_big, rolled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    String(userId), seed.id, seed.displayName, seed.rarity, BigInt(options.weightUnits || 10),
    BigInt(options.value || 1), options.isBig ? 1 : 0, BigInt(options.rolledAt || 1),
  );
  return String(result.lastInsertRowid);
}

function startOneMinute(game, userId, rarities = [], location = {}) {
  const preview = game.autoRollService.preview('1m', rarities);
  return game.autoRollService.start(userId, preview, { guildId: 'guild', channelId: 'channel', ...location });
}

test('duration parsing normalizes combinations and enforces one-minute/one-day bounds', () => {
  assert.deepEqual(parseDuration('1m'), { durationMinutes: 1, normalized: '1m' });
  assert.deepEqual(parseDuration('4H 13M'), { durationMinutes: 253, normalized: '4h 13m' });
  assert.deepEqual(parseDuration('13m 4h'), { durationMinutes: 253, normalized: '4h 13m' });
  assert.deepEqual(parseDuration('1d'), { durationMinutes: 1_440, normalized: '1d' });
  for (const invalid of ['', '0m', '-1m', '30s', '1.5h', '1m junk', '1d 1m', '45h 13m']) {
    assert.throws(() => parseDuration(invalid), RangeError, invalid);
  }
});

test('Auto Roll pricing, refunding, and global three-second alignment are exact', () => {
  assert.deepEqual(autoRollPlan(1), { durationMinutes: 1, plannedRolls: 20, totalCost: 100n });
  assert.deepEqual(autoRollPlan(60), { durationMinutes: 60, plannedRolls: 1_200, totalCost: 6_000n });
  assert.deepEqual(autoRollPlan(1_440), { durationMinutes: 1_440, plannedRolls: 28_800, totalCost: 144_000n });
  assert.equal(autoRollRefund(200, 120), 400n);
  assert.equal(nextGlobalTick(0), 3_000);
  assert.equal(nextGlobalTick(3_001), 6_000);
});

test('all requested prefix commands and Auto Roll aliases use the shared command handlers', async () => {
  const aliases = ['c!roll', 'c!inventory', 'c!sell', 'c!balance', 'c!auto roll', 'c!auto-roll', 'c!upgrade', 'c!index'];
  for (const content of aliases) {
    const game = feature();
    let replies = 0;
    let edits = 0;
    const handled = await game.handleMessage({
      content,
      author: { id: `user-${content}`, username: 'Prefix', bot: false },
      reply: async () => {
        replies += 1;
        return { id: 'response', edit: async () => { edits += 1; } };
      },
    });
    assert.equal(handled, true, content);
    assert.equal(replies, 1, content);
    if (content === 'c!index') assert.equal(edits, 1);
    game.close();
  }
});

test('luck multiplier and effective chance formula preserve crop ordering and Carrot fallback', () => {
  assert.equal(luckMultiplier(0), 1);
  assert.equal(luckMultiplier(4), 5);
  assert.equal(luckMultiplier(20), 21);
  let prior = 0;
  for (const seed of CHECKED_SEEDS) {
    const chance = effectiveChance(seed, 20);
    const value = chance.numerator / chance.denominator;
    assert.ok(value >= prior, `${seed.id} broke chance ordering`);
    prior = value;
  }
  const result = cascadingRoll({ luckTier: 1, rng: (maximum) => maximum - 1 });
  assert.equal(result.seed, FALLBACK_SEED);
});

test('BIG chance, weight multiplier, and extended value curve match the Carrot example', () => {
  assert.deepEqual(bigChance(0), { numerator: 0, denominator: 200 });
  assert.deepEqual(bigChance(20), { numerator: 20, denominator: 200 });
  const draws = [20, 0];
  const instance = generateInstance(FALLBACK_SEED, () => draws.shift(), { bigCropTier: 20 });
  assert.equal(instance.baseWeightUnits, 30);
  assert.equal(instance.weightUnits, 120);
  assert.equal(instance.isBig, true);
  const fraction = valueFractionForWeight(FALLBACK_SEED, 120, { clamp: false });
  assert.equal(Number(fraction.numerator) / Number(fraction.denominator), 42.8);
  assert.equal(valueForWeight(FALLBACK_SEED, 120, { clamp: false }), 42n);
  assert.equal(instance.value, 42n);
});

test('upgrade prices and Roman tier formatting use exact formulas through tier XX', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(luckUpgradeCost), [1000n, 1300n, 1700n, 2200n, 2900n]);
  assert.deepEqual([0, 1, 2, 3, 4].map(bigUpgradeCost), [1000n, 1400n, 2000n, 2700n, 3800n]);
  assert.deepEqual([romanTier(0), romanTier(1), romanTier(4), romanTier(9), romanTier(20)], ['0', 'I', 'IV', 'IX', 'XX']);
});

test('power upgrade purchase is atomic, and idempotent', () => {
  const game = feature();
  fund(game, 'power', 1_000n);
  const first = game.repository.purchasePowerUpgrade('power', 'luck', 'power:one', luckUpgradeCost, 2);
  const replay = game.repository.purchasePowerUpgrade('power', 'luck', 'power:one', luckUpgradeCost, 3);
  assert.equal(first.status, 'ok');
  assert.equal(replay.duplicate, true);
  assert.equal(game.repository.getPlayer('power').luckTier, 1);
  assert.equal(game.repository.getPlayer('power').balance, 0n);
  game.db.prepare('UPDATE rng_players SET luck_tier = 20 WHERE user_id = ?').run('power');
  assert.equal(game.repository.purchasePowerUpgrade('power', 'luck', 'power:max', luckUpgradeCost, 4).status, 'insufficient');
  game.close();
});

test('manual and BIG rolls create the normal crop discovery exactly once', () => {
  let draws = 0;
  const game = feature({
    rng(maximum) {
      draws += 1;
      if (draws <= CHECKED_SEEDS.length) return maximum - 1;
      if (draws === CHECKED_SEEDS.length + 1) return 20;
      return 0;
    },
  });
  game.repository.ensurePlayer('discover');
  game.db.prepare('UPDATE rng_players SET big_crop_tier = 20 WHERE user_id = ?').run('discover');
  const rolled = game.gameService.roll('discover');
  assert.equal(rolled.status, 'ok');
  assert.equal(rolled.item.isBig, true);
  assert.deepEqual(game.repository.discoveries('discover').map((entry) => entry.seedId), ['carrot']);
  game.db.prepare('DELETE FROM rng_roll_cooldowns WHERE user_id = ?').run('discover');
  draws = 0;
  game.gameService.roll('discover');
  assert.equal(game.repository.discoveries('discover').length, 1);
  game.close();
});

test('Auto Roll rejects an existing job and an active selling session', () => {
  const game = feature({ clock: () => 1_000 });
  fund(game, 'auto', 200n);
  assert.equal(startOneMinute(game, 'auto').status, 'ok');
  assert.equal(startOneMinute(game, 'auto').status, 'already-active');
  fund(game, 'selling', 100n);
  game.saleSessions.create('selling');
  assert.equal(startOneMinute(game, 'selling').status, 'sale-active');
  assert.equal(game.gameService.roll('auto').status, 'auto-active');
  game.close();
});

test('scheduler tick idempotency and the database lease protect multiple processes', async () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  fund(game, 'scheduled', 100n);
  const started = startOneMinute(game, 'scheduled');
  assert.equal(started.status, 'ok');
  now = 3_000;
  assert.equal((await game.autoRollScheduler.runBoundary(now)).processed, 1);
  assert.equal(game.autoRollRepository.activeForUser('scheduled').completedRolls, 1);
  const competing = new AutoRollScheduler({
    service: game.autoRollService,
    repository: game.autoRollRepository,
    clock: () => now,
    ownerId: 'other-process',
  });
  assert.equal((await competing.runBoundary(now)).status, 'leased');
  assert.equal(game.db.prepare('SELECT COUNT(*) AS count FROM rng_auto_roll_ticks').get().count, 1n);
  game.close();
});

test('scheduler skips burst catch-up after downtime and uses only one global timer', async () => {
  let now = 1_000;
  let timers = 0;
  const game = feature({
    clock: () => now,
    setTimer: () => { timers += 1; return { unref() {} }; },
    clearTimer: () => {},
  });
  fund(game, 'late', 100n);
  startOneMinute(game, 'late');
  game.autoRollScheduler.start();
  assert.equal(timers, 1, 'one scheduler timer, not one timer per user');
  now = 9_000;
  await game.autoRollScheduler.runBoundary(now);
  const job = game.autoRollRepository.activeForUser('late');
  assert.equal(job.completedRolls, 1);
  assert.equal(job.nextTickAt, 12_000);
  game.close();
});

test('rolls missed through the purchased ending boundary remain unprocessed and are refunded', async () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  fund(game, 'downtime', 100n);
  const started = startOneMinute(game, 'downtime');
  assert.equal(started.job.endsAt, 63_000);
  now = 63_000;
  await game.autoRollScheduler.runBoundary(now);
  const job = game.db.prepare('SELECT * FROM rng_auto_roll_jobs WHERE user_id = ?').get('downtime');
  assert.equal(job.status, 'stopped');
  assert.equal(job.completed_rolls, 0n);
  assert.equal(job.refund_paid, 100n);
  assert.equal(game.repository.getPlayer('downtime').balance, 100n);
  game.close();
});

test('full inventory auto-sells all selected rarities before rolling', async () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  fund(game, 'seller', 100n);
  game.db.prepare('UPDATE rng_players SET inventory_capacity = 1 WHERE user_id = ?').run('seller');
  addItem(game, 'seller', { value: 7n });
  assert.equal(startOneMinute(game, 'seller', ['Common']).status, 'ok');
  now = 3_000;
  await game.autoRollScheduler.runBoundary(now);
  const state = game.repository.inventoryState('seller');
  assert.equal(state.items.length, 1);
  assert.equal(game.repository.getPlayer('seller').balance, 7n);
  assert.equal(game.autoRollRepository.activeForUser('seller').completedRolls, 1);
  game.close();
});

test('Auto Roll stops without consuming the roll and atomically refunds when nothing can be sold', async () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  fund(game, 'blocked', 100n);
  game.db.prepare('UPDATE rng_players SET inventory_capacity = 0 WHERE user_id = ?').run('blocked');
  assert.equal(startOneMinute(game, 'blocked').status, 'ok');
  assert.equal(game.repository.getPlayer('blocked').balance, 0n);
  now = 3_000;
  await game.autoRollScheduler.runBoundary(now);
  const row = game.db.prepare('SELECT * FROM rng_auto_roll_jobs WHERE user_id = ?').get('blocked');
  assert.equal(row.status, 'stopped');
  assert.equal(row.completed_rolls, 0n);
  assert.equal(row.refund_paid, 100n);
  assert.equal(game.repository.getPlayer('blocked').balance, 100n);
  await game.autoRollScheduler.runBoundary(now);
  assert.equal(game.repository.getPlayer('blocked').balance, 100n, 'refund is not duplicated');
  game.close();
});

test('automatic rolls aggregate summaries and create discoveries', async () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  fund(game, 'summary', 100n);
  startOneMinute(game, 'summary');
  now = 3_000;
  await game.autoRollScheduler.runBoundary(now);
  now = 6_000;
  await game.autoRollScheduler.runBoundary(now);
  const job = game.autoRollRepository.activeForUser('summary');
  assert.equal(job.summaryCounts.carrot, 2);
  assert.deepEqual(game.repository.discoveries('summary').map((entry) => entry.seedId), ['carrot']);
  game.close();
});

test('Index models use six canonical slots and hide undiscovered card details', () => {
  const models = indexPageModels(new Set([SEEDS[0].id]), 1);
  assert.equal(models.length, 6);
  assert.equal(INDEX_MAX_PAGE, 6);
  assert.equal(models[0].displayName, SEEDS[0].displayName);
  assert.ok(models[0].chance);
  assert.equal(models[1].displayName, '???');
  assert.equal(models[1].chance, '');
  assert.equal(models[1].averageValue, null);
});

test('Index uses rounded-square cards and a dedicated Unicode-safe text face', () => {
  assert.equal(INDEX_CANVAS_WIDTH, 1_200);
  assert.equal(INDEX_CANVAS_HEIGHT, 800);
  assert.equal(INDEX_CARD_SIZE, 360);
  assert.equal(INDEX_CARD_RADIUS, 24);
  assert.equal(GlobalFonts.has(INDEX_CANVAS_FONT_FAMILY), true);

  const context = createCanvas(500, 100).getContext('2d');
  assert.equal(fitIndexText(context, '???', 200).text, '???');
  assert.equal(fitIndexText(context, 'Dragon\u2019s Breath', 400).text, 'Dragon\u2019s Breath');
});

test('Index render cache is reused and invalidated only for the affected user', async () => {
  const image = createCanvas(16, 16);
  const renderer = new CropIndexRenderer({ loadImage: async () => image, studsPath: 'studs' });
  const first = await renderer.render('cache-user', [], 1);
  const decoded = await loadImage(first);
  assert.equal(decoded.width, INDEX_CANVAS_WIDTH);
  assert.equal(decoded.height, INDEX_CANVAS_HEIGHT);
  const second = await renderer.render('cache-user', [], 1);
  assert.equal(first, second);
  renderer.invalidate('other-user');
  assert.equal(await renderer.render('cache-user', [], 1), first);
  renderer.invalidate('cache-user');
  assert.notEqual(await renderer.render('cache-user', [], 1), first);
  renderer.clear();
});

test('Auto Roll components reject a user who does not own the server-side action', async () => {
  const game = feature();
  const action = game.actions.create('owner', { kind: 'auto-form' });
  let reply;
  await game.handleInteraction({
    isChatInputCommand: () => false,
    isButton: () => true,
    isRepliable: () => true,
    customId: `rng:auto:form:${action.id}`,
    user: { id: 'intruder' },
    reply: async (payload) => { reply = payload; },
  });
  assert.match(reply.components[0].components[0].content, /Only the command invoker/);
  game.close();
});
