const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { createRngGameFeature, RNG_GAME_COMMANDS } = require('../src/features/rng-game');
const { statPayload } = require('../src/features/rng-game/components/builders');
const { RARITY_EMOJIS, SHECKLES_EMOJI } = require('../src/features/rng-game/data/emojis');
const { SEED_BY_ID } = require('../src/features/rng-game/data/seeds');
const {
  MIGRATIONS_PATH,
  migrate,
  openDatabase,
} = require('../src/features/rng-game/repositories/database');
const { RngGameRepository } = require('../src/features/rng-game/repositories/gameRepository');
const { compareBestSeeds, statisticsModel } = require('../src/features/rng-game/services/statisticsService');
const { bigUpgradeCost } = require('../src/features/rng-game/services/gameService');

const CARROT = SEED_BY_ID.get('carrot');
const BRIAR = SEED_BY_ID.get('briar_rose');
const POISON_APPLE = SEED_BY_ID.get('poison_apple');
const STAR = SEED_BY_ID.get('star_fruit');
const ECLIPSE = SEED_BY_ID.get('eclipse_bloom');

function fakeIndexRenderer() {
  return { render: async () => Buffer.from('index'), invalidate() {}, clear() {} };
}

function feature(options = {}) {
  return createRngGameFeature({
    databasePath: ':memory:',
    indexRenderer: fakeIndexRenderer(),
    notifyAutoRoll: async () => {},
    secretRollAnnouncer: async () => {},
    rng: (maximum) => maximum - 1,
    ...options,
  });
}

function persistedInstance(seed = CARROT, weightUnits = 10, value = 1n, isBig = false) {
  return {
    seed,
    weightUnits,
    value: BigInt(value),
    isBig,
    effectiveChance: { numerator: seed.chanceNumerator, denominator: seed.chanceDenominator },
  };
}

function rollSeed(repository, userId, seed = CARROT, options = {}) {
  return repository.roll(
    userId,
    () => persistedInstance(
      seed,
      options.weightUnits ?? 10,
      options.value ?? 1n,
      options.isBig === true,
    ),
    {
      now: options.now ?? Date.now(),
      cooldownMs: 5_000,
      bypassCooldown: options.bypassCooldown !== false,
      isLocked: options.isLocked,
    },
  );
}

function insertItem(game, userId, options = {}) {
  const seed = options.seed || CARROT;
  game.repository.ensurePlayer(userId, options.rolledAt || 1);
  const result = game.db.prepare(`INSERT INTO rng_inventory_items
    (owner_user_id, seed_id, crop_name, rarity, weight_units, stored_value, is_big, rolled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    String(userId),
    seed.id,
    seed.displayName,
    seed.rarity,
    BigInt(options.weightUnits ?? 10),
    BigInt(options.value ?? 1),
    options.isBig ? 1 : 0,
    BigInt(options.rolledAt ?? 1),
  );
  return String(result.lastInsertRowid);
}

function fund(game, userId, amount) {
  game.repository.ensurePlayer(userId, 1);
  game.db.prepare('UPDATE rng_players SET sheckle_balance = ? WHERE user_id = ?')
    .run(BigInt(amount), String(userId));
}

function discover(repository, userId, seed, at = 1) {
  repository.ensurePlayer(userId, at);
  repository.db.prepare(`INSERT OR IGNORE INTO rng_crop_discoveries
    (user_id, seed_id, discovered_at) VALUES (?, ?, ?)`).run(String(userId), seed.id, BigInt(at));
}

test('new players return a complete zeroed statistics model', () => {
  const game = feature();
  assert.deepEqual(game.gameService.statistics('new-player'), {
    totalRolls: 0n,
    autoRolls: 0n,
    highestRarity: null,
    bestSeed: null,
    bestSeedHighestWeightUnits: 0,
    highestWeightUnits: 0,
    totalSaleEarnings: 0n,
    highestSingleSale: 0n,
  });
  game.close();
});

test('a successful repository manual roll increments total rolls once', () => {
  const game = feature();
  assert.equal(rollSeed(game.repository, 'manual').status, 'ok');
  assert.deepEqual(
    [game.repository.statistics('manual').totalRolls, game.repository.statistics('manual').autoRolls],
    [1n, 0n],
  );
  game.close();
});

test('a successful slash roll increments total rolls once', async () => {
  const game = feature();
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'roll',
    user: { id: 'slash-roll' },
    async reply() {},
  });
  assert.equal(game.repository.statistics('slash-roll').totalRolls, 1n);
  game.close();
});

test('a successful prefix roll increments total rolls once', async () => {
  const game = feature();
  await game.handleMessage({
    content: 'c!roll',
    author: { id: 'prefix-roll', bot: false },
    async reply() { return {}; },
  });
  assert.equal(game.repository.statistics('prefix-roll').totalRolls, 1n);
  game.close();
});

test('a successful Auto Roll increments total and Auto Roll counts once', () => {
  const game = feature({ clock: () => 1_000 });
  fund(game, 'auto-count', 60n);
  const preview = game.autoRollService.preview('auto-count', '1m', []);
  const started = game.autoRollService.start('auto-count', preview, { guildId: 'g', channelId: 'c' });
  game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  const statistics = game.repository.statistics('auto-count');
  assert.deepEqual([statistics.totalRolls, statistics.autoRolls], [1n, 1n]);
  game.close();
});

test('manual and Auto Roll crops combine into total rolls', () => {
  const game = feature({ clock: () => 1_000 });
  rollSeed(game.repository, 'combined', CARROT, { now: 1 });
  fund(game, 'combined', 60n);
  const preview = game.autoRollService.preview('combined', '1m', []);
  const started = game.autoRollService.start('combined', preview, { guildId: 'g', channelId: 'c' });
  game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  const statistics = game.repository.statistics('combined');
  assert.deepEqual([statistics.totalRolls, statistics.autoRolls], [2n, 1n]);
  game.close();
});

test('cooldown attempts do not increment statistics', () => {
  const game = feature({ clock: () => 1_000 });
  assert.equal(game.gameService.roll('cooldown').status, 'ok');
  assert.equal(game.gameService.roll('cooldown').status, 'cooldown');
  assert.equal(game.repository.statistics('cooldown').totalRolls, 1n);
  game.close();
});

test('inventory-full attempts do not increment statistics', () => {
  const game = feature();
  game.repository.ensurePlayer('full');
  game.db.prepare('UPDATE rng_players SET inventory_capacity = 0 WHERE user_id = ?').run('full');
  assert.equal(game.gameService.roll('full').status, 'full');
  assert.equal(game.repository.statistics('full').totalRolls, 0n);
  game.close();
});

test('sale-locked rolls do not increment statistics', () => {
  const game = feature();
  game.saleSessions.create('locked');
  assert.equal(game.gameService.roll('locked').status, 'locked');
  assert.equal(game.repository.statistics('locked').totalRolls, 0n);
  game.close();
});

test('a failed roll transaction rolls back inventory, discovery, and statistics', () => {
  const game = feature();
  game.repository.ensurePlayer('transaction-failure');
  game.db.exec(`CREATE TRIGGER rng_test_fail_statistics
    BEFORE UPDATE ON rng_player_statistics
    BEGIN SELECT RAISE(ABORT, 'statistics failure'); END;`);
  assert.throws(() => rollSeed(game.repository, 'transaction-failure'), /statistics failure/);
  game.db.exec('DROP TRIGGER rng_test_fail_statistics');
  assert.equal(game.repository.inventoryState('transaction-failure').items.length, 0);
  assert.equal(game.repository.discoveries('transaction-failure').length, 0);
  assert.equal(game.repository.statistics('transaction-failure').totalRolls, 0n);
  game.close();
});

test('duplicate Auto Roll ticks do not increment statistics twice', () => {
  const game = feature({ clock: () => 1_000 });
  fund(game, 'duplicate-tick', 60n);
  const preview = game.autoRollService.preview('duplicate-tick', '1m', []);
  const started = game.autoRollService.start('duplicate-tick', preview, { guildId: 'g', channelId: 'c' });
  const first = game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  const duplicate = game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  assert.equal(first.status, 'rolled');
  assert.ok(['duplicate', 'not-due'].includes(duplicate.status));
  assert.deepEqual(
    [game.repository.statistics('duplicate-tick').totalRolls, game.repository.statistics('duplicate-tick').autoRolls],
    [1n, 1n],
  );
  game.close();
});

test('statistics persist when the database and repository are recreated', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-rng-stat-'));
  const databasePath = path.join(directory, 'rng.sqlite');
  try {
    let db = openDatabase({ databasePath });
    let repository = new RngGameRepository(db);
    rollSeed(repository, 'persistent', CARROT, { weightUnits: 42, now: 1 });
    db.close();
    db = openDatabase({ databasePath });
    repository = new RngGameRepository(db);
    const statistics = repository.statistics('persistent');
    assert.deepEqual([statistics.totalRolls, statistics.highestWeightUnits], [1n, 42]);
    db.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('migration preserves known inventory weights without fabricating legacy totals', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.defaultSafeIntegers(true);
  db.exec(`CREATE TABLE rng_schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  for (const name of ['001_rng_game.sql', '002_rng_game_extensions.sql']) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_PATH, name), 'utf8'));
    db.prepare('INSERT INTO rng_schema_migrations (version, applied_at) VALUES (?, ?)').run(name, 1n);
  }
  db.prepare(`INSERT INTO rng_players
    (user_id, sheckle_balance, inventory_capacity, inventory_upgrade_level,
     luck_tier, big_crop_tier, created_at, updated_at)
    VALUES ('legacy', 999, 100, 0, 0, 0, 1, 1)`).run();
  db.prepare(`INSERT INTO rng_inventory_items
    (owner_user_id, seed_id, crop_name, rarity, weight_units, stored_value, is_big, rolled_at)
    VALUES ('legacy', 'carrot', 'Carrot', 'Common', 240, 80, 1, 2)`).run();
  db.prepare(`INSERT INTO rng_crop_discoveries (user_id, seed_id, discovered_at)
    VALUES ('legacy', 'carrot', 2)`).run();
  migrate(db, MIGRATIONS_PATH);
  const repository = new RngGameRepository(db);
  const statistics = repository.statistics('legacy');
  assert.deepEqual(
    [statistics.totalRolls, statistics.autoRolls, statistics.totalSaleEarnings, statistics.highestSingleSale],
    [0n, 0n, 0n, 0n],
  );
  assert.deepEqual(
    [statistics.highestWeightUnits, statistics.bestSeedHighestWeightUnits],
    [240, 240],
  );
  assert.deepEqual(repository.cropStatistics('legacy')[0].rollCount, 0n);
  db.close();
});

test('per-crop roll totals and highest weights retain their maxima', () => {
  const game = feature();
  rollSeed(game.repository, 'crop-max', CARROT, { weightUnits: 20, now: 1 });
  rollSeed(game.repository, 'crop-max', CARROT, { weightUnits: 15, now: 2 });
  rollSeed(game.repository, 'crop-max', CARROT, { weightUnits: 60, now: 3 });
  assert.deepEqual(game.repository.cropStatistics('crop-max'), [{
    userId: 'crop-max',
    seedId: 'carrot',
    rollCount: 3n,
    highestWeightUnits: 60,
    firstRolledAt: 1,
    lastRolledAt: 3,
  }]);
  game.close();
});

test('highest overall weight retains the maximum across crops', () => {
  const game = feature();
  rollSeed(game.repository, 'overall-max', CARROT, { weightUnits: 60, now: 1 });
  rollSeed(game.repository, 'overall-max', STAR, { weightUnits: 500, now: 2 });
  rollSeed(game.repository, 'overall-max', CARROT, { weightUnits: 20, now: 3 });
  assert.equal(game.repository.statistics('overall-max').highestWeightUnits, 500);
  game.close();
});

test('BIG crops record their final multiplied weight', () => {
  const game = feature();
  rollSeed(game.repository, 'big-weight', CARROT, { weightUnits: 240, isBig: true, now: 1 });
  const statistics = game.repository.statistics('big-weight');
  assert.equal(statistics.highestWeightUnits, 240);
  assert.equal(statistics.bestSeedHighestWeightUnits, 240);
  game.close();
});

test('Best Plant highest weight comes from that crop rather than the overall maximum', () => {
  const game = feature();
  rollSeed(game.repository, 'best-crop-weight', CARROT, { weightUnits: 2_000, now: 1 });
  rollSeed(game.repository, 'best-crop-weight', STAR, { weightUnits: 500, now: 2 });
  const statistics = game.repository.statistics('best-crop-weight');
  assert.equal(statistics.bestSeed, STAR);
  assert.equal(statistics.bestSeedHighestWeightUnits, 500);
  assert.equal(statistics.highestWeightUnits, 2_000);
  game.close();
});

test('selling the highest-weight item does not erase historical weight', () => {
  const game = feature();
  const rolled = rollSeed(game.repository, 'sold-weight', CARROT, { weightUnits: 60, value: 20n, now: 1 });
  game.repository.sell('sold-weight', [rolled.item.id], 'sale:sold-weight', 2);
  assert.equal(game.repository.inventoryState('sold-weight').items.length, 0);
  assert.equal(game.repository.statistics('sold-weight').highestWeightUnits, 60);
  assert.equal(game.repository.statistics('sold-weight').bestSeedHighestWeightUnits, 60);
  game.close();
});

test('highest rarity follows the canonical ranking', () => {
  const game = feature();
  discover(game.repository, 'rarity', CARROT, 1);
  discover(game.repository, 'rarity', BRIAR, 2);
  assert.equal(game.repository.statistics('rarity').highestRarity, 'Mythic');
  game.close();
});

test('Super ranks above Mythic for highest rarity and Best Plant', () => {
  const game = feature();
  discover(game.repository, 'super-rank', BRIAR, 1);
  discover(game.repository, 'super-rank', STAR, 2);
  const statistics = game.repository.statistics('super-rank');
  assert.equal(statistics.highestRarity, 'Super');
  assert.equal(statistics.bestSeed, STAR);
  game.close();
});

test('Secret ranks above Super when present in the catalog', () => {
  const game = feature();
  discover(game.repository, 'secret-rank', STAR, 1);
  discover(game.repository, 'secret-rank', ECLIPSE, 2);
  const statistics = game.repository.statistics('secret-rank');
  assert.equal(statistics.highestRarity, 'Secret');
  assert.equal(statistics.bestSeed, ECLIPSE);
  game.close();
});

test('Best Plant uses rarity before crop chance or value', () => {
  const game = feature();
  discover(game.repository, 'rarity-first', STAR, 1);
  discover(game.repository, 'rarity-first', BRIAR, 2);
  assert.equal(game.repository.statistics('rarity-first').bestSeed, STAR);
  game.close();
});

test('equal-rarity Best Plants use the rarer base chance', () => {
  const game = feature();
  discover(game.repository, 'chance-rank', POISON_APPLE, 1);
  discover(game.repository, 'chance-rank', BRIAR, 2);
  assert.equal(game.repository.statistics('chance-rank').bestSeed, BRIAR);
  game.close();
});

test('Best Plant chance ties use average value and then stable crop ID', () => {
  const base = {
    rarity: 'Rare', chanceNumerator: 1, chanceDenominator: 100,
    minimumValue: 10, maximumValue: 20,
  };
  assert.ok(compareBestSeeds({ ...base, id: 'valuable', maximumValue: 30 }, { ...base, id: 'plain' }) < 0);
  assert.ok(compareBestSeeds({ ...base, id: 'alpha' }, { ...base, id: 'beta' }) < 0);
});

test('selling a crop does not remove it from Best Plant consideration', () => {
  const game = feature();
  const rolled = rollSeed(game.repository, 'sold-best', STAR, { weightUnits: 500, value: 100n, now: 1 });
  game.repository.sell('sold-best', [rolled.item.id], 'sale:sold-best', 2);
  assert.equal(game.repository.statistics('sold-best').bestSeed, STAR);
  game.close();
});

test('no discoveries produce no highest rarity or Best Plant', () => {
  const model = statisticsModel({}, [], []);
  assert.equal(model.highestRarity, null);
  assert.equal(model.bestSeed, null);
  assert.equal(model.bestSeedHighestWeightUnits, 0);
});

test('manual sales increase earnings exactly once across replays', () => {
  const game = feature();
  const itemId = insertItem(game, 'manual-sale', { value: 25n });
  const sold = game.repository.sell('manual-sale', [itemId], 'sale:once', 2);
  const replay = game.repository.sell('manual-sale', [itemId], 'sale:once', 3);
  assert.equal(sold.total, 25n);
  assert.equal(replay.duplicate, true);
  const statistics = game.repository.statistics('manual-sale');
  assert.deepEqual([statistics.totalSaleEarnings, statistics.highestSingleSale], [25n, 25n]);
  game.close();
});

test('one manual multi-item sale is aggregated as one earning event', () => {
  const game = feature();
  const itemIds = [
    insertItem(game, 'batch-sale', { value: 7n, rolledAt: 1 }),
    insertItem(game, 'batch-sale', { value: 8n, rolledAt: 2 }),
  ];
  game.repository.sell('batch-sale', itemIds, 'sale:batch', 3);
  const statistics = game.repository.statistics('batch-sale');
  assert.deepEqual([statistics.totalSaleEarnings, statistics.highestSingleSale], [15n, 15n]);
  game.close();
});

test('Auto Roll auto-sale batches increase earnings exactly once', () => {
  const game = feature({ clock: () => 1_000 });
  fund(game, 'auto-sale', 60n);
  game.db.prepare('UPDATE rng_players SET inventory_capacity = 2 WHERE user_id = ?').run('auto-sale');
  insertItem(game, 'auto-sale', { value: 7n, rolledAt: 1 });
  insertItem(game, 'auto-sale', { value: 8n, rolledAt: 2 });
  const preview = game.autoRollService.preview('auto-sale', '1m', ['Common']);
  const started = game.autoRollService.start('auto-sale', preview, { guildId: 'g', channelId: 'c' });
  game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  const statistics = game.repository.statistics('auto-sale');
  assert.deepEqual([statistics.totalSaleEarnings, statistics.highestSingleSale], [15n, 15n]);
  game.close();
});

test('highest single sale retains the largest completed transaction', () => {
  const game = feature();
  const first = insertItem(game, 'sale-max', { value: 10n, rolledAt: 1 });
  game.repository.sell('sale-max', [first], 'sale:large', 2);
  const second = insertItem(game, 'sale-max', { value: 4n, rolledAt: 3 });
  game.repository.sell('sale-max', [second], 'sale:small', 4);
  const statistics = game.repository.statistics('sale-max');
  assert.deepEqual([statistics.totalSaleEarnings, statistics.highestSingleSale], [14n, 10n]);
  game.close();
});

test('failed sales do not update earnings', () => {
  const game = feature();
  const result = game.repository.sell('failed-sale', ['999'], 'sale:failed', 1);
  assert.equal(result.status, 'invalid-items');
  assert.deepEqual(
    [game.repository.statistics('failed-sale').totalSaleEarnings, game.repository.statistics('failed-sale').highestSingleSale],
    [0n, 0n],
  );
  game.close();
});

test('starting balance, refunds, and purchases are excluded from earnings', () => {
  const game = feature({ clock: () => 1_000 });
  fund(game, 'non-sale-money', 2_000n);
  game.gameService.purchasePowerUpgrade('non-sale-money', 'big', 'purchase');
  const preview = game.autoRollService.preview('non-sale-money', '1m', []);
  const started = game.autoRollService.start('non-sale-money', preview, { guildId: 'g', channelId: 'c' });
  game.autoRollService.processTick(started.job.id, started.job.endsAt, started.job.endsAt);
  assert.equal(bigUpgradeCost(0), 1_000n);
  assert.equal(game.repository.statistics('non-sale-money').totalSaleEarnings, 0n);
  game.close();
});

test('/stat is registered only as an RNG slash command with the exact description', () => {
  const command = RNG_GAME_COMMANDS.find((entry) => entry.data.name === 'stat');
  assert.ok(command);
  assert.equal(command.data.description, 'View your all-time RNG rolling statistics.');
});

test('the stat payload uses the exact V2 layout, avatar, formatters, and safe mentions', () => {
  const avatarCalls = [];
  const user = {
    id: '123456789012345678',
    displayAvatarURL(options) {
      avatarCalls.push(options);
      return 'https://cdn.example/avatar.png';
    },
  };
  const payload = statPayload(user, {
    totalRolls: 12_345n,
    autoRolls: 67n,
    highestRarity: 'Secret',
    bestSeed: ECLIPSE,
    bestSeedHighestWeightUnits: 3_060,
    highestWeightUnits: 4_500,
    totalSaleEarnings: 123_456_789n,
    highestSingleSale: 18_000_000n,
  });
  assert.deepEqual(avatarCalls, [{ extension: 'png', size: 256 }]);
  assert.equal(payload.flags & 32768, 32768);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
  const container = payload.components[0];
  assert.equal(container.accent_color, 0xFFFFFF);
  assert.deepEqual(container.components.map((component) => component.type), [9, 14, 10, 14, 10]);
  assert.equal(container.components[0].accessory.media.url, 'https://cdn.example/avatar.png');
  for (const component of [container.components[0].components[0], container.components[2], container.components[4]]) {
    assert.doesNotMatch(component.content, /\n\n/, 'stat rows should render without blank-line gaps');
  }
  assert.equal(
    container.components[0].components[0].content,
    `### <@123456789012345678>'s Rollin stats\n* Has done 12,345 rolls\n-# 67 auto-rolls`,
  );
  assert.match(container.components[2].content, new RegExp(`Highest rarity discovered: ${RARITY_EMOJIS.Secret}`));
  assert.match(container.components[2].content, new RegExp(`${ECLIPSE.emoji} Eclipse Bloom`));
  assert.match(container.components[2].content, /Best Plant's Highest weight: 30\.60 kg/);
  assert.match(container.components[2].content, /Highest weight discovered: 45\.00 kg/);
  assert.equal(
    container.components[4].content,
    `- Earning all time: 123,456,789 ${SHECKLES_EMOJI}\n`
      + `* Highest earning in one sale: 18,000,000 ${SHECKLES_EMOJI}`,
  );
});

test('/stat returns the exact empty state and works during Auto Roll', async () => {
  const game = feature({ clock: () => 1_000 });
  fund(game, 'stat-empty', 60n);
  const preview = game.autoRollService.preview('stat-empty', '1m', []);
  game.autoRollService.start('stat-empty', preview, { guildId: 'g', channelId: 'c' });
  let payload;
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'stat',
    user: {
      id: 'stat-empty',
      displayAvatarURL: () => 'https://cdn.example/empty.png',
    },
    async reply(value) { payload = value; },
  });
  const content = payload.components[0].components;
  assert.match(content[0].components[0].content, /Has done 0 rolls[\s\S]*0 auto-rolls/);
  assert.match(content[2].content, /Highest rarity discovered: None/);
  assert.match(content[2].content, /Best plant discovered: None/);
  assert.match(content[2].content, /Best Plant's Highest weight: 0\.00 kg/);
  assert.match(content[2].content, /Highest weight discovered: 0\.00 kg/);
  assert.match(content[4].content, /Earning all time: 0/);
  assert.match(content[4].content, /Highest earning in one sale: 0/);
  game.close();
});

test('/stat follows configured RNG access channels and the existing sale lock', async () => {
  const game = feature({
    getGuildPolicy: () => ({
      unlocked: true,
      enabled: true,
      gameChannelIds: ['rng-channel'],
      cooldownBypassRoleIds: [],
    }),
  });
  let payload;
  const user = { id: 'stat-access', displayAvatarURL: () => 'https://cdn.example/stat.png' };
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'stat',
    guildId: 'guild',
    channelId: 'wrong-channel',
    member: { roles: [] },
    user,
    async reply(value) { payload = value; },
  });
  assert.match(payload.components[0].components[0].content, /Command unavailable/);
  game.saleSessions.create('stat-access');
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'stat',
    guildId: 'guild',
    channelId: 'rng-channel',
    member: { roles: [] },
    user,
    async reply(value) { payload = value; },
  });
  assert.match(payload.components[0].components[0].content, /Sale in progress/);
  game.close();
});
