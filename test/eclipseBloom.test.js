const assert = require('node:assert/strict');
const test = require('node:test');

const { createRngGameFeature } = require('../src/features/rng-game');
const {
  indexPayload,
  secretRollAnnouncementPayload,
} = require('../src/features/rng-game/components/builders');
const { CROP_EMOJIS, RARITY_EMOJIS } = require('../src/features/rng-game/data/emojis');
const { CHECKED_SEEDS, SEEDS, SEED_BY_ID } = require('../src/features/rng-game/data/seeds');
const { AUTO_SELL_RARITIES, normalizeAutoSellRarities } = require('../src/features/rng-game/services/autoRollService');
const {
  INDEX_MAX_PAGE,
  INDEX_PAGE_SIZE,
  OUTLINE_COLORS,
  indexDiscoveryCount,
  indexPageModels,
  indexSeedsForUser,
} = require('../src/features/rng-game/services/indexRenderer');
const {
  LUCK_PROMOTION_RARITY_ORDER,
  PROBABILITY_SCALE,
  RARITY_ORDER,
  applyLuckPromotions,
  baseRarityDistribution,
  cascadingRoll,
  generateInstance,
  luckProbabilityReport,
  rarityDistribution,
  valueForWeight,
  weightBounds,
} = require('../src/features/rng-game/services/rngService');
const {
  DEFAULT_SECRET_ROLL_CHANNEL_ID,
  createSecretRollAnnouncer,
} = require('../src/features/rng-game/services/secretRollAnnouncement');
const { filterInventory } = require('../src/features/rng-game/utils/normalize');

const ECLIPSE = SEED_BY_ID.get('eclipse_bloom');

function secretRng(options = {}) {
  const luckTier = options.luckTier || 0;
  const distribution = rarityDistribution(luckTier);
  const secretIndex = RARITY_ORDER.indexOf('Secret');
  const secretStart = RARITY_ORDER.slice(0, secretIndex)
    .reduce((sum, rarity) => sum + distribution[rarity], 0n);
  const draws = [Number(secretStart), 0, options.weightOffset || 0];
  if ((options.bigCropTier || 0) > 0) draws.push(options.bigDraw || 0);
  return (maximum) => {
    const value = draws.shift();
    assert.notEqual(value, undefined, `unexpected RNG call with maximum ${maximum}`);
    assert.ok(value >= 0 && value < maximum, `${value} must be in [0, ${maximum})`);
    return value;
  };
}

function waitForCallbacks() {
  return new Promise((resolve) => setImmediate(resolve));
}

function fakeIndexRenderer(log = []) {
  return {
    clear() {},
    invalidate(userId) { log.push({ type: 'invalidate', userId: String(userId) }); },
    async render(userId, discoveries, page) {
      log.push({ type: 'render', userId: String(userId), discoveries: [...discoveries], page });
      return Buffer.from(`index:${userId}:${discoveries.join(',')}:${page}`);
    },
  };
}

function feature(options = {}) {
  return createRngGameFeature({
    databasePath: ':memory:',
    indexRenderer: fakeIndexRenderer(),
    notifyAutoRoll: async () => {},
    secretRollAnnouncer: async () => {},
    ...options,
  });
}

function fund(game, userId, amount = 60n) {
  game.repository.ensurePlayer(userId, 1);
  game.db.prepare('UPDATE rng_players SET sheckle_balance = ? WHERE user_id = ?')
    .run(BigInt(amount), String(userId));
}

test('Eclipse Bloom has the exact Secret catalog data and is checked first', () => {
  assert.equal(SEEDS.length, 33);
  assert.equal(CHECKED_SEEDS[0], ECLIPSE);
  assert.deepEqual({
    id: ECLIPSE.id,
    displayName: ECLIPSE.displayName,
    rarity: ECLIPSE.rarity,
    chanceNumerator: ECLIPSE.chanceNumerator,
    chanceDenominator: ECLIPSE.chanceDenominator,
    minimumWeight: ECLIPSE.minimumWeight,
    maximumWeight: ECLIPSE.maximumWeight,
    minimumValue: ECLIPSE.minimumValue,
    maximumValue: ECLIPSE.maximumValue,
    secretUntilDiscovered: ECLIPSE.secretUntilDiscovered,
  }, {
    id: 'eclipse_bloom',
    displayName: 'Eclipse Bloom',
    rarity: 'Secret',
    chanceNumerator: 1,
    chanceDenominator: 1_000_000,
    minimumWeight: 6.3,
    maximumWeight: 9,
    minimumValue: 12_600_000,
    maximumValue: 18_000_000,
    secretUntilDiscovered: true,
  });
  assert.equal(ECLIPSE.emoji, '<:eclipsebloomfruit:1536043923816841296>');
  assert.equal(ECLIPSE.rarityEmoji, '<:RSecret:1536073173165146344>');
  assert.equal(ECLIPSE.rarityColor, 0xFACC15);
  assert.equal(CROP_EMOJIS.eclipse_bloom, ECLIPSE.emoji);
  assert.equal(RARITY_EMOJIS.Secret, ECLIPSE.rarityEmoji);
  assert.equal(OUTLINE_COLORS.Secret, '#FACC15');
});

test('the rollable rarity list is complete while the Luck chain excludes Secret', () => {
  assert.deepEqual(RARITY_ORDER, [
    'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Secret', 'Super',
  ]);
  assert.deepEqual(LUCK_PROMOTION_RARITY_ORDER, [
    'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Super',
  ]);
});

test('Secret remains exactly one in a million at every Luck tier', () => {
  for (let tier = 0; tier <= 20; tier += 1) {
    const distribution = rarityDistribution(tier);
    assert.equal(distribution.Secret, 1_000n, `tier ${tier}`);
    assert.equal(
      RARITY_ORDER.reduce((sum, rarity) => sum + distribution[rarity], 0n),
      PROBABILITY_SCALE,
      `tier ${tier}`,
    );
  }
  for (const row of luckProbabilityReport()) assert.equal(row.probabilities.Secret, 1_000n);
});

test('Luck never promotes Mythic or Super into Secret', () => {
  const initial = Object.fromEntries(RARITY_ORDER.map((rarity) => [rarity, 0n]));
  initial.Mythic = 400_000_000n;
  initial.Secret = 1_000n;
  initial.Super = 599_999_000n;
  const promoted = applyLuckPromotions(initial, 100);
  assert.equal(promoted.Secret, 1_000n);
  assert.ok(promoted.Super >= initial.Super);
  assert.equal(baseRarityDistribution().Secret, 1_000n);
});

test('Eclipse Bloom can be selected at tier zero and tier twenty', () => {
  for (const luckTier of [0, 20]) {
    const result = cascadingRoll({ rng: secretRng({ luckTier }), luckTier });
    assert.equal(result.seed, ECLIPSE);
    assert.deepEqual(result.effectiveChance, { numerator: 1, denominator: 1_000_000 });
    assert.equal(result.weightUnits, 630);
    assert.equal(result.value, 12_600_000n);
  }
});

test('Eclipse Bloom weight, interpolation, and BIG output use the normal item pipeline', () => {
  assert.deepEqual(weightBounds(ECLIPSE), { minimum: 630, maximum: 900 });
  assert.equal(valueForWeight(ECLIPSE, 630), 12_600_000n);
  assert.equal(valueForWeight(ECLIPSE, 765), 15_300_000n);
  assert.equal(valueForWeight(ECLIPSE, 900), 18_000_000n);
  const normal = generateInstance(ECLIPSE, (maximum) => maximum - 1);
  assert.equal(normal.weightUnits, 900);
  assert.equal(normal.value, 18_000_000n);
  const draws = [135, 0];
  const big = generateInstance(ECLIPSE, () => draws.shift(), { bigCropTier: 20 });
  assert.equal(big.baseWeightUnits, 765);
  assert.equal(big.weightUnits, 3_060);
  assert.equal(big.value, 61_200_000n);
  assert.equal(big.isBig, true);
});

test('Secret has no Index slot before personal discovery and is fully revealed afterward', () => {
  const before = indexSeedsForUser([]);
  const after = indexSeedsForUser(['eclipse_bloom']);
  assert.equal(INDEX_MAX_PAGE, 6);
  assert.equal(INDEX_PAGE_SIZE, 6);
  assert.equal(before.length, 32);
  assert.equal(after.length, 33);
  assert.equal(before.some((seed) => seed.id === 'eclipse_bloom'), false);
  assert.equal(after[0], ECLIPSE);
  assert.equal(after[1].rarity, 'Super');
  assert.equal(indexPageModels([], 6).length, 2);
  assert.equal(indexPageModels(['eclipse_bloom'], 6).length, 3);
  assert.equal(indexPageModels([], 1).some((model) => model.seed.id === 'eclipse_bloom'), false);
  const revealed = indexPageModels(['eclipse_bloom'], 1)[0];
  assert.equal(revealed.seed, ECLIPSE);
  assert.equal(revealed.discovered, true);
  assert.equal(revealed.displayName, 'Eclipse Bloom');
  assert.equal(revealed.chance, '0.0001%');
  assert.equal(revealed.averageValue, 15_300_000n);
});

test('Index discovery counts stay personal with a fixed denominator of 33', () => {
  const regularIds = SEEDS.filter((seed) => seed.id !== 'eclipse_bloom').map((seed) => seed.id);
  assert.equal(indexDiscoveryCount(regularIds), 32);
  assert.equal(indexDiscoveryCount([...regularIds, 'eclipse_bloom']), 33);
  assert.equal(indexSeedsForUser(regularIds).length, 32);
  assert.equal(indexSeedsForUser([]).length, 32, 'another user remains unaware of the Secret');
  const view = { id: 'index', page: 1, maxPage: 6 };
  const before = indexPayload('user', 32, view, Buffer.from('before'), { initial: false });
  const after = indexPayload('user', 33, view, Buffer.from('after'), { initial: false });
  assert.match(before.components[0].components[0].content, /32 \/ 33 crops/);
  assert.match(after.components[0].components[0].content, /33 \/ 33 crops/);
});

test('discovering Eclipse Bloom invalidates and refreshes only that user’s open Index', async () => {
  const log = [];
  const renderer = fakeIndexRenderer(log);
  const game = feature({
    indexRenderer: renderer,
    rng: secretRng(),
  });
  const edits = { roller: [], other: [] };
  for (const userId of Object.keys(edits)) {
    await game.handleMessage({
      content: 'c!index',
      author: { id: userId, username: userId, bot: false },
      async reply() {
        return { async edit(payload) { edits[userId].push(payload); } };
      },
    });
  }
  assert.equal(edits.roller.length, 1);
  assert.equal(edits.other.length, 1);
  const rolled = game.gameService.roll('roller');
  assert.equal(rolled.seed, ECLIPSE);
  await waitForCallbacks();
  assert.equal(edits.roller.length, 2);
  assert.equal(edits.other.length, 1);
  assert.match(edits.roller.at(-1).components[0].components[0].content, /1 \/ 33 crops/);
  assert.ok(log.some((entry) => entry.type === 'invalidate' && entry.userId === 'roller'));
  assert.equal(log.some((entry) => entry.type === 'invalidate' && entry.userId === 'other'), false);
  game.close();
});

test('Secret inventory filtering and Auto Sell use the existing rarity pipeline', () => {
  const secretItem = {
    id: 'secret', seedId: ECLIPSE.id, cropName: ECLIPSE.displayName,
    rarity: 'Secret', weightUnits: 630, value: 12_600_000n, rolledAt: 1,
  };
  const commonItem = {
    id: 'common', seedId: 'carrot', cropName: 'Carrot',
    rarity: 'Common', weightUnits: 10, value: 1n, rolledAt: 2,
  };
  assert.deepEqual(filterInventory([secretItem, commonItem], { rarities: ['Secret'] }), [secretItem]);
  assert.ok(AUTO_SELL_RARITIES.includes('Secret'));
  assert.deepEqual(normalizeAutoSellRarities(['Secret', 'Common']), ['Common', 'Secret']);
});

test('the Secret announcement payload is yellow, V2, exact, and pings only the roller', () => {
  const payload = secretRollAnnouncementPayload({
    userId: '123456789012345678',
    seed: ECLIPSE,
    isBig: true,
    finalWeightUnits: 3_060,
  });
  assert.equal(payload.flags & 32768, 32768);
  assert.equal(payload.components[0].accent_color, 0xFACC15);
  const section = payload.components[0].components[0];
  assert.equal(section.type, 9);
  assert.equal(
    section.components[0].content,
    '### <:RSecret:1536073173165146344> <@123456789012345678> has rolled **BIG Eclipse Bloom**, CONGRATS!\n'
      + '-# Chance: `1/1m`\n'
      + '-# Weight: 30.60 kg',
  );
  assert.equal(section.accessory.media.url, 'https://cdn.discordapp.com/emojis/1536043923816841296.png?size=256&quality=lossless');
  assert.deepEqual(payload.allowedMentions, {
    parse: [], users: ['123456789012345678'], roles: [], repliedUser: false,
  });
});

test('the centralized announcer uses the default channel and ignores non-Secret rolls', async () => {
  const sent = [];
  const fetched = [];
  const announce = createSecretRollAnnouncer({
    getClient: () => ({
      channels: {
        async fetch(channelId) {
          fetched.push(channelId);
          return { isTextBased: () => true, async send(payload) { sent.push(payload); } };
        },
      },
    }),
  });
  assert.equal(await announce({ userId: 'user', seed: ECLIPSE, finalWeightUnits: 630, isBig: false }), true);
  assert.equal(await announce({ userId: 'user', seed: SEED_BY_ID.get('carrot'), finalWeightUnits: 10 }), false);
  assert.deepEqual(fetched, [DEFAULT_SECRET_ROLL_CHANNEL_ID]);
  assert.equal(sent.length, 1);
});

test('slash and prefix Secret rolls each send exactly one announcement', async () => {
  for (const commandType of ['slash', 'prefix']) {
    const sent = [];
    const game = feature({
      secretRollAnnouncer: undefined,
      client: {
        channels: {
          async fetch(channelId) {
            assert.equal(channelId, DEFAULT_SECRET_ROLL_CHANNEL_ID);
            return { isTextBased: () => true, async send(payload) { sent.push(payload); } };
          },
        },
      },
      rng: secretRng(),
    });
    if (commandType === 'slash') {
      await game.handleInteraction({
        isChatInputCommand: () => true,
        commandName: 'roll',
        user: { id: 'slash-user' },
        async reply() {},
      });
    } else {
      await game.handleMessage({
        content: 'c!roll',
        author: { id: 'prefix-user', bot: false },
        async reply() { return {}; },
      });
    }
    await waitForCallbacks();
    assert.equal(sent.length, 1, commandType);
    game.close();
  }
});

test('an Auto Roll Secret sends exactly one announcement after persistence', async () => {
  const events = [];
  const game = feature({
    rng: secretRng(),
    secretRollAnnouncer: async (event) => { events.push(event); },
    clock: () => 1_000,
  });
  fund(game, 'auto-user');
  const preview = game.autoRollService.preview('1m', []);
  const started = game.autoRollService.start('auto-user', preview, { guildId: 'guild', channelId: 'channel' });
  const result = game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  await waitForCallbacks();
  assert.equal(result.item.seedId, 'eclipse_bloom');
  assert.equal(game.repository.inventoryState('auto-user').items[0].seedId, 'eclipse_bloom');
  assert.equal(events.length, 1);
  assert.equal(events[0].source, 'auto-roll');
  assert.equal(events[0].finalWeightUnits, result.item.weightUnits);
  game.close();
});

test('blocked and non-Secret outcomes do not announce', async () => {
  const events = [];
  const game = feature({
    rng: (maximum) => maximum - 1,
    secretRollAnnouncer: async (event) => { events.push(event); },
    clock: () => 1_000,
  });
  assert.equal(game.gameService.roll('ordinary').status, 'ok');
  assert.equal(game.gameService.roll('ordinary').status, 'cooldown');
  game.saleSessions.create('locked');
  assert.equal(game.gameService.roll('locked').status, 'locked');
  await waitForCallbacks();
  assert.equal(events.length, 0);
  game.close();
});

test('announcement delivery failure never changes a successful persisted roll', async () => {
  const errors = [];
  const game = feature({
    secretRollAnnouncer: undefined,
    client: { channels: { async fetch() { throw new Error('denied'); } } },
    onError: (error) => errors.push(error.message),
    rng: secretRng(),
  });
  const result = game.gameService.roll('failure-safe');
  assert.equal(result.status, 'ok');
  assert.equal(result.seed, ECLIPSE);
  assert.equal(game.repository.inventoryState('failure-safe').items[0].seedId, 'eclipse_bloom');
  await waitForCallbacks();
  assert.deepEqual(errors, ['denied']);
  game.close();
});
