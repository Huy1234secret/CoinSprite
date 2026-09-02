const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { GlobalFonts, createCanvas, loadImage } = require('@napi-rs/canvas');

const { createRngGameFeature } = require('../src/features/rng-game');
const { autoRollPreviewPayload } = require('../src/features/rng-game/components/builders');
const { autoRollModal } = require('../src/features/rng-game/modals/builders');
const { AUTO_SELL_RARITIES, AutoRollScheduler } = require('../src/features/rng-game/services/autoRollService');
const { AutoRollRepository } = require('../src/features/rng-game/repositories/autoRollRepository');
const { MIGRATIONS_PATH, openDatabase } = require('../src/features/rng-game/repositories/database');
const { RngGameRepository } = require('../src/features/rng-game/repositories/gameRepository');
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
  generateInstance,
  valueForWeight,
} = require('../src/features/rng-game/services/rngService');
const {
  BIG_UPGRADE_PRICES,
  LUCK_UPGRADE_PRICES,
  bigUpgradeCost,
  luckUpgradeCost,
} = require('../src/features/rng-game/services/gameService');
const { FALLBACK_SEED, SEEDS } = require('../src/features/rng-game/data/seeds');
const {
  autoRollPlan,
  autoRollRefund,
  nextGlobalTick,
  parseDuration,
  SQLITE_INTEGER_MAX,
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
  const preview = game.autoRollService.preview(userId, '1m', rarities);
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

test('Auto Roll pricing, refunding, and global five-second alignment are exact', () => {
  assert.deepEqual(autoRollPlan(1), { durationMinutes: 1, plannedRolls: 12, costPerRoll: 5n, totalCost: 60n });
  assert.deepEqual(autoRollPlan(60, 24n), { durationMinutes: 60, plannedRolls: 720, costPerRoll: 24n, totalCost: 17_280n });
  assert.deepEqual(autoRollPlan(1_440, 204n), { durationMinutes: 1_440, plannedRolls: 17_280, costPerRoll: 204n, totalCost: 3_525_120n });
  assert.equal(autoRollRefund(120, 72, 24n), 1_152n);
  assert.equal(nextGlobalTick(0), 5_000);
  assert.equal(nextGlobalTick(5_001), 10_000);
  assert.throws(() => autoRollPlan(1_440, SQLITE_INTEGER_MAX), /SQLite signed 64-bit/);
});

test('Auto Sell lists Super immediately above Secret', () => {
  assert.deepEqual(AUTO_SELL_RARITIES.slice(-2), ['Super', 'Secret']);
  const modal = autoRollModal({ id: 'form', normalized: '4h', selectedAutoSellRarities: ['Super'] });
  const duration = modal.components.find((entry) => entry.component?.custom_id === 'duration').component;
  const rarities = modal.components.find((entry) => entry.component?.custom_id === 'rarities').component;
  assert.equal(duration.value, '4h');
  assert.deepEqual(rarities.options.slice(-2).map((option) => option.label), ['Super', 'Secret']);
  assert.equal(rarities.options.find((option) => option.value === 'Super').default, true);
});

test('Auto Roll preview always offers an enabled gray Change duration control', () => {
  const action = {
    id: 'preview',
    normalized: '1d',
    totalCost: 10_000n,
    costPerRoll: 5n,
    selectedAutoSellRarities: ['Super'],
  };
  const payload = autoRollPreviewPayload(action, 0n);
  const buttons = payload.components[0].components.flatMap((component) => component.components || []);
  const start = buttons.find((button) => button.custom_id === 'rng:auto:start:preview');
  const change = buttons.find((button) => button.custom_id === 'rng:auto:change:preview');
  assert.equal(start.disabled, true);
  assert.deepEqual(
    { label: change.label, style: change.style, disabled: change.disabled || false },
    { label: 'Change duration', style: 2, disabled: false },
  );
});

test('Change duration reopens a prefilled owner-only Auto Roll form', async () => {
  const game = feature();
  const preview = game.actions.create('owner', {
    kind: 'auto-preview',
    normalized: '4h 13m',
    selectedAutoSellRarities: ['Super', 'Secret'],
    durationMinutes: 253,
    plannedRolls: 3_036,
    costPerRoll: 5n,
    totalCost: 15_180n,
  });
  let modal;
  await game.handleInteraction({
    isChatInputCommand: () => false,
    isButton: () => true,
    customId: `rng:auto:change:${preview.id}`,
    user: { id: 'owner' },
    showModal: async (payload) => { modal = payload; },
  });
  const duration = modal.components.find((entry) => entry.component?.custom_id === 'duration').component;
  const rarities = modal.components.find((entry) => entry.component?.custom_id === 'rarities').component;
  assert.equal(duration.value, '4h 13m');
  assert.deepEqual(rarities.options.filter((option) => option.default).map((option) => option.value), ['Super', 'Secret']);
  assert.equal(game.actions.get(preview.id).kind, 'auto-preview', 'dismissing the modal keeps the prior quote usable');
  const formId = modal.custom_id.split(':').at(-1);
  assert.equal(game.actions.get(formId).kind, 'auto-form');
  assert.equal(game.actions.get(formId).previewId, preview.id);
  game.close();
});

test('migration defaults existing Auto Roll jobs to five per roll and preserves refunds', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-auto-price-'));
  const databasePath = path.join(directory, 'rng.sqlite');
  const legacyMigrations = path.join(directory, 'legacy-migrations');
  fs.mkdirSync(legacyMigrations);
  try {
    for (const name of fs.readdirSync(MIGRATIONS_PATH).filter((entry) => /^00[1-5]_.*\.sql$/.test(entry))) {
      fs.copyFileSync(path.join(MIGRATIONS_PATH, name), path.join(legacyMigrations, name));
    }
    let db = openDatabase({ databasePath, migrationsPath: legacyMigrations });
    let repository = new RngGameRepository(db);
    repository.ensurePlayer('legacy-job', 1);
    db.prepare('UPDATE rng_players SET inventory_capacity = 0, sheckle_balance = 0 WHERE user_id = ?').run('legacy-job');
    db.prepare(`INSERT INTO rng_auto_roll_jobs
      (user_id, guild_id, channel_id, status, duration_minutes, planned_rolls, completed_rolls,
       cost_paid, refund_paid, selected_auto_sell_rarities, started_at, next_tick_at, ends_at,
       finished_at, stopped_reason, summary_counts, created_at, updated_at)
      VALUES (?, 'g', 'c', 'active', 1, 12, 2, 60, 0, '[]', 1000, 10000, 65000,
       NULL, '', '{}', 1000, 1000)`).run('legacy-job');
    db.close();

    db = openDatabase({ databasePath });
    repository = new RngGameRepository(db);
    const autoRepository = new AutoRollRepository(db, repository);
    const migrated = autoRepository.activeForUser('legacy-job');
    assert.equal(migrated.costPerRoll, 5n);
    const ended = autoRepository.processTick(migrated.id, migrated.nextTickAt, () => {
      throw new Error('full inventory must stop before rolling');
    }, migrated.nextTickAt);
    assert.equal(ended.job.refundPaid, 50n);
    assert.equal(repository.getPlayer('legacy-job').balance, 50n);
    db.close();
  } finally {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EPERM') throw error;
      // Windows can retain the just-closed SQLite handle until the test worker
      // begins exiting. Retry then so the fixture is still cleaned up without
      // turning a successful migration assertion into a platform-only failure.
      process.once('exit', () => {
        try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* best effort at process teardown */ }
      });
    }
  }
});

test('all requested prefix commands and Auto Roll aliases use the shared command handlers', async () => {
  const aliases = [
    'c!roll', 'c!inventory', 'c!sell', 'c!balance', 'c!auto roll', 'c!auto-roll',
    'c!upgrade', 'c!index', 'c!stat',
  ];
  for (const content of aliases) {
    const game = feature();
    let replies = 0;
    let edits = 0;
    const handled = await game.handleMessage({
      content,
      author: {
        id: `user-${content}`,
        username: 'Prefix',
        bot: false,
        displayAvatarURL: () => 'https://cdn.example/prefix.png',
      },
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

test('normalized Luck sampling retains Carrot at the final tier-zero boundary', () => {
  let draw = 0;
  const result = cascadingRoll({
    luckTier: 0,
    rng: (maximum) => (draw++ === 0 ? 0 : maximum - 1),
  });
  assert.equal(result.seed, FALLBACK_SEED);
});

test('BIG chance is 0.1% per tier, capped at exactly 5%, and value is four times base', () => {
  assert.deepEqual(bigChance(0), { numerator: 0, denominator: 1_000 });
  assert.deepEqual(bigChance(1), { numerator: 1, denominator: 1_000 });
  assert.deepEqual(bigChance(10), { numerator: 10, denominator: 1_000 });
  assert.deepEqual(bigChance(20), { numerator: 20, denominator: 1_000 });
  assert.deepEqual(bigChance(50), { numerator: 50, denominator: 1_000 });
  assert.deepEqual(bigChance(51), { numerator: 50, denominator: 1_000 });
  const draws = [20, 0];
  const instance = generateInstance(FALLBACK_SEED, () => draws.shift(), { bigCropTier: 20 });
  assert.equal(instance.baseWeightUnits, 30);
  assert.equal(instance.weightUnits, 120);
  assert.equal(instance.isBig, true);
  assert.equal(instance.value, valueForWeight(FALLBACK_SEED, 30) * 4n);
  assert.equal(instance.value, 32n);
});

test('upgrade prices and Roman tier formatting use exact formulas through new maximums', () => {
  assert.deepEqual([0, 9, 19, 29, 39, 48].map(luckUpgradeCost), [2_000n, 69_000n, 1_316_000n, 7_825_000n, 25_858_000n, 53_935_000n]);
  assert.deepEqual([0, 9, 19, 29, 39, 48, 49].map(bigUpgradeCost), [1_000n, 41_000n, 790_000n, 4_695_000n, 15_515_000n, 32_361_000n, 34_500_000n]);
  assert.ok(LUCK_UPGRADE_PRICES.slice(2).every((price, index) => price >= LUCK_UPGRADE_PRICES[index + 1] + 1_000n));
  assert.ok(BIG_UPGRADE_PRICES.slice(2).every((price, index) => price >= BIG_UPGRADE_PRICES[index + 1] + 1_000n));
  assert.deepEqual([romanTier(0), romanTier(1), romanTier(20), romanTier(49), romanTier(50)], ['0', 'I', 'XX', 'XLIX', 'L']);
});

test('power upgrade purchase is atomic, and idempotent', () => {
  const game = feature();
  fund(game, 'power', luckUpgradeCost(0));
  const first = game.repository.purchasePowerUpgrade('power', 'luck', 'power:one', luckUpgradeCost, 2);
  const replay = game.repository.purchasePowerUpgrade('power', 'luck', 'power:one', luckUpgradeCost, 3);
  assert.equal(first.status, 'ok');
  assert.equal(replay.duplicate, true);
  assert.equal(game.repository.getPlayer('power').luckTier, 1);
  assert.equal(game.repository.getPlayer('power').balance, 0n);
  game.db.prepare('UPDATE rng_players SET luck_tier = 49 WHERE user_id = ?').run('power');
  assert.equal(game.repository.purchasePowerUpgrade('power', 'luck', 'power:max', luckUpgradeCost, 4).status, 'max-tier');
  game.close();
});

test('manual and BIG rolls create the normal crop discovery exactly once', () => {
  let draws = 0;
  const game = feature({
    rng(maximum) {
      draws += 1;
      if (draws === 1) return 0;
      if (draws === 2) return maximum - 1;
      if (draws === 3) return 20;
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
  fund(game, 'auto', 120n);
  assert.equal(startOneMinute(game, 'auto').status, 'ok');
  assert.equal(startOneMinute(game, 'auto').status, 'already-active');
  fund(game, 'selling', 60n);
  game.saleSessions.create('selling');
  assert.equal(startOneMinute(game, 'selling').status, 'sale-active');
  assert.equal(game.gameService.roll('auto').status, 'auto-active');
  game.close();
});

test('scheduler tick idempotency and the database lease protect multiple processes', async () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  fund(game, 'scheduled', 60n);
  const started = startOneMinute(game, 'scheduled');
  assert.equal(started.status, 'ok');
  now = 5_000;
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
  fund(game, 'late', 60n);
  startOneMinute(game, 'late');
  game.autoRollScheduler.start();
  assert.equal(timers, 1, 'one scheduler timer, not one timer per user');
  now = 15_000;
  await game.autoRollScheduler.runBoundary(now);
  const job = game.autoRollRepository.activeForUser('late');
  assert.equal(job.completedRolls, 1);
  assert.equal(job.nextTickAt, 20_000);
  game.close();
});

test('rolls missed through the purchased ending boundary remain unprocessed and are refunded', async () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  fund(game, 'downtime', 60n);
  const started = startOneMinute(game, 'downtime');
  assert.equal(started.job.endsAt, 65_000);
  now = 65_000;
  await game.autoRollScheduler.runBoundary(now);
  const job = game.db.prepare('SELECT * FROM rng_auto_roll_jobs WHERE user_id = ?').get('downtime');
  assert.equal(job.status, 'stopped');
  assert.equal(job.completed_rolls, 0n);
  assert.equal(job.refund_paid, 60n);
  assert.equal(game.repository.getPlayer('downtime').balance, 60n);
  game.close();
});

test('full inventory auto-sells all selected rarities before rolling', async () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  fund(game, 'seller', 60n);
  game.db.prepare('UPDATE rng_players SET inventory_capacity = 1 WHERE user_id = ?').run('seller');
  addItem(game, 'seller', { value: 7n });
  assert.equal(startOneMinute(game, 'seller', ['Common']).status, 'ok');
  now = 5_000;
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
  fund(game, 'blocked', 60n);
  game.db.prepare('UPDATE rng_players SET inventory_capacity = 0 WHERE user_id = ?').run('blocked');
  assert.equal(startOneMinute(game, 'blocked').status, 'ok');
  assert.equal(game.repository.getPlayer('blocked').balance, 0n);
  now = 5_000;
  await game.autoRollScheduler.runBoundary(now);
  const row = game.db.prepare('SELECT * FROM rng_auto_roll_jobs WHERE user_id = ?').get('blocked');
  assert.equal(row.status, 'stopped');
  assert.equal(row.completed_rolls, 0n);
  assert.equal(row.refund_paid, 60n);
  assert.equal(game.repository.getPlayer('blocked').balance, 60n);
  await game.autoRollScheduler.runBoundary(now);
  assert.equal(game.repository.getPlayer('blocked').balance, 60n, 'refund is not duplicated');
  game.close();
});

test('automatic rolls aggregate summaries and create discoveries', async () => {
  let now = 1_000;
  const game = feature({ clock: () => now });
  fund(game, 'summary', 60n);
  startOneMinute(game, 'summary');
  now = 5_000;
  await game.autoRollScheduler.runBoundary(now);
  now = 10_000;
  await game.autoRollScheduler.runBoundary(now);
  const job = game.autoRollRepository.activeForUser('summary');
  assert.equal(job.summaryCounts.moon_bloom, 2);
  assert.deepEqual(game.repository.discoveries('summary').map((entry) => entry.seedId), ['moon_bloom']);
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

test('Index cards confine studs above the divider and keep the image stage and crop on top', async () => {
  const studs = createCanvas(176, 176);
  const studsContext = studs.getContext('2d');
  studsContext.fillStyle = '#FFFFFF';
  studsContext.fillRect(0, 0, studs.width, studs.height);
  const crop = createCanvas(32, 32);
  const cropContext = crop.getContext('2d');
  cropContext.fillStyle = '#00FF00';
  cropContext.fillRect(0, 0, crop.width, crop.height);

  const renderer = new CropIndexRenderer({
    studsPath: 'synthetic-studs',
    loadImage: async (source) => (source === 'synthetic-studs' ? studs : crop),
  });
  const buffer = await renderer.render('textured-index', [SEEDS[0].id], 1);
  const image = await loadImage(buffer);
  assert.equal(image.width, INDEX_CANVAS_WIDTH);
  assert.equal(image.height, INDEX_CANVAS_HEIGHT);

  const rendered = createCanvas(image.width, image.height);
  const context = rendered.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixelAt = (x, y) => [...context.getImageData(x, y, 1, 1).data];

  const cardOrigins = [
    [40, 30], [420, 30], [800, 30],
    [40, 410], [420, 410], [800, 410],
  ];
  for (const [x, y] of cardOrigins) {
    assert.notDeepEqual(pixelAt(x + 20, y + 120), [18, 22, 29, 255], 'upper card background receives studs');
    assert.notDeepEqual(pixelAt(x + 180, y + 267), [18, 22, 29, 255], 'studs reach the row immediately above the divider');
    assert.deepEqual(pixelAt(x + 180, y + 270), [18, 22, 29, 255], 'the card is solid immediately below the divider');
    assert.deepEqual(pixelAt(x + 180, y + 350), [18, 22, 29, 255], 'the lower information area remains solid');
  }
  const texturedUpper = pixelAt(60, 150);
  const imageStage = pixelAt(110, 160);
  assert.ok(imageStage[0] < texturedUpper[0] && imageStage[1] < texturedUpper[1], 'image-stage fill is above the texture');
  assert.deepEqual(pixelAt(220, 164), [0, 255, 0, 255], 'opaque crop artwork is not covered by studs');
  assert.deepEqual(pixelAt(41, 31), pixelAt(20, 31), 'the rounded card corner clips the card texture');
  renderer.clear();
});

test('Secret Index cards use a black-to-white gradient outline', async () => {
  const renderer = new CropIndexRenderer({ loadImage: async () => { throw new Error('missing'); } });
  const buffer = await renderer.render('secret-outline', ['eclipse_bloom'], 1);
  const image = await loadImage(buffer);
  const rendered = createCanvas(image.width, image.height);
  const context = rendered.getContext('2d');
  context.drawImage(image, 0, 0);
  const pixelAt = (x, y) => [...context.getImageData(x, y, 1, 1).data];
  const dark = pixelAt(220, 31);
  const light = pixelAt(220, 389);
  assert.equal(dark[0], dark[1]);
  assert.equal(dark[1], dark[2]);
  assert.equal(light[0], light[1]);
  assert.equal(light[1], light[2]);
  assert.ok(light[0] > dark[0], 'the diagonal Secret outline fades from black toward white');
  renderer.clear();
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
