const assert = require('node:assert/strict');
const test = require('node:test');

const { createRngGameFeature } = require('../src/features/rng-game');
const {
  balancePayload,
  inventoryCropFields,
  inventoryPageData,
  rollPayload,
  salePageData,
  salePayload,
} = require('../src/features/rng-game/components/builders');
const { CROP_EMOJIS, RARITY_EMOJIS, SHECKLES_EMOJI } = require('../src/features/rng-game/data/emojis');
const { CHECKED_SEEDS, FALLBACK_SEED, SEEDS } = require('../src/features/rng-game/data/seeds');
const {
  PROBABILITY_SCALE,
  baseCropDistribution,
  cascadingRoll,
  generateInstance,
  valueForWeight,
  weightBounds,
} = require('../src/features/rng-game/services/rngService');
const { upgradeCost } = require('../src/features/rng-game/services/gameService');
const { SaleSessionStore } = require('../src/features/rng-game/services/sessionStore');
const { evaluateRngGameAccess } = require('../src/features/rng-game/services/accessPolicy');
const { formatChanceWithRatio } = require('../src/features/rng-game/utils/format');
const { filterInventory, normalizeCropName } = require('../src/features/rng-game/utils/normalize');

function feature(options = {}) {
  return createRngGameFeature({ databasePath: ':memory:', rng: (maximum) => maximum - 1, ...options });
}

function addItem(game, userId, seed = SEEDS.at(-1), options = {}) {
  game.repository.ensurePlayer(userId, options.rolledAt || 1);
  const bounds = weightBounds(seed);
  const weightUnits = options.weightUnits ?? bounds.minimum;
  const result = game.db.prepare(`INSERT INTO rng_inventory_items
    (owner_user_id, seed_id, crop_name, rarity, weight_units, stored_value, rolled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    String(userId), seed.id, seed.displayName, seed.rarity, BigInt(weightUnits),
    options.value ?? valueForWeight(seed, weightUnits), BigInt(options.rolledAt ?? 1),
  );
  return String(result.lastInsertRowid);
}

function item(id, seed = SEEDS.at(-1), weightUnits = 10, value = 1n, rolledAt = 1) {
  return {
    id: String(id), ownerUserId: 'user', seedId: seed.id, cropName: seed.displayName,
    rarity: seed.rarity, weightUnits, value, rolledAt,
  };
}

test('tier-zero crop weights are derived from the rarest-first cascade and sum exactly', () => {
  const distribution = baseCropDistribution();
  assert.deepEqual(distribution.map((entry) => entry.seed.id), SEEDS.map((seed) => seed.id));
  assert.equal(distribution.reduce((sum, entry) => sum + entry.units, 0n), PROBABILITY_SCALE);
  const eclipse = distribution.find((entry) => entry.seed.id === 'eclipse_bloom');
  const star = distribution.find((entry) => entry.seed.id === 'star_fruit');
  const dragon = distribution.find((entry) => entry.seed.id === 'dragons_breath');
  assert.equal(eclipse.units, 1_000n, 'Eclipse Bloom keeps its exact 0.0001% baseline');
  assert.deepEqual(eclipse.fraction, { numerator: 1n, denominator: 1_000_000n });
  assert.deepEqual(star.fraction, { numerator: 999_999n, denominator: 1_000_000_000_000n });
  const actualDragonChance = Number(dragon.fraction.numerator) / Number(dragon.fraction.denominator);
  const expectedDragonChance = (1 - (1 / 1_000_000)) ** 2 * (111 / 100_000_000);
  assert.ok(Math.abs(actualDragonChance - expectedDragonChance) < Number.EPSILON);
});

test('Star Fruit succeeds at the last fixed-point unit assigned to it', () => {
  const distribution = baseCropDistribution();
  const superUnits = distribution
    .filter((entry) => entry.seed.rarity === 'Super')
    .reduce((sum, entry) => sum + entry.units, 0n);
  const star = distribution.find((entry) => entry.seed.id === 'star_fruit');
  const draws = [Number(PROBABILITY_SCALE - superUnits), Number(star.units - 1n), 0];
  const result = cascadingRoll({ rng: () => draws.shift() });
  assert.equal(result.seed.id, 'star_fruit');
  assert.equal(draws.length, 0, 'rarity, crop, and weight are sampled once each');
});

test('within-rarity sampling continues after a failed crop boundary and then stops', () => {
  const distribution = baseCropDistribution();
  const superUnits = distribution
    .filter((entry) => entry.seed.rarity === 'Super')
    .reduce((sum, entry) => sum + entry.units, 0n);
  const star = distribution.find((entry) => entry.seed.id === 'star_fruit');
  const draws = [Number(PROBABILITY_SCALE - superUnits), Number(star.units), 0];
  const result = cascadingRoll({ rng: () => draws.shift() });
  assert.equal(result.seed.id, 'dragons_breath');
  assert.equal(draws.length, 0);
});

test('Carrot is the guaranteed fallback when every individual check fails', () => {
  let draw = 0;
  const result = cascadingRoll({ rng: (maximum) => (draw++ === 0 ? 0 : maximum - 1) });
  assert.equal(result.seed, FALLBACK_SEED);
  assert.equal(CHECKED_SEEDS.includes(FALLBACK_SEED), false);
  assert.equal(formatChanceWithRatio(FALLBACK_SEED), '50%');
});

test('rational checks become exact fixed-point crop weights', () => {
  const rational = { ...SEEDS.at(-1), id: 'rational', fallback: false, chanceNumerator: 3, chanceDenominator: 25 };
  const distribution = baseCropDistribution({ checkedSeeds: [rational], fallbackSeed: FALLBACK_SEED });
  assert.equal(distribution[0].units, 120_000_000n);
  assert.equal(distribution[1].units, 880_000_000n);
  const succeeds = cascadingRoll({ checkedSeeds: [rational], fallbackSeed: FALLBACK_SEED, rng: (() => {
    const values = [0, 119_999_999, 0];
    return () => values.shift();
  })() });
  const fails = cascadingRoll({ checkedSeeds: [rational], fallbackSeed: FALLBACK_SEED, rng: (() => {
    const values = [0, 120_000_000, 0];
    return () => values.shift();
  })() });
  assert.equal(succeeds.seed.id, 'rational');
  assert.equal(fails.seed.id, 'carrot');
});

test('secure integer weight generation stays inside every configured bound', () => {
  for (const seed of SEEDS) {
    const bounds = weightBounds(seed);
    assert.equal(generateInstance(seed, () => 0).weightUnits, bounds.minimum);
    assert.equal(generateInstance(seed, (maximum) => maximum - 1).weightUnits, bounds.maximum);
  }
});

test('stored value is monotonic with weight and reaches configured endpoints', () => {
  for (const seed of SEEDS) {
    const bounds = weightBounds(seed);
    let previous = -1n;
    for (let weight = bounds.minimum; weight <= bounds.maximum; weight += 1) {
      const value = valueForWeight(seed, weight);
      assert.ok(value >= previous, `${seed.id} decreased at ${weight}`);
      previous = value;
    }
    assert.equal(valueForWeight(seed, bounds.minimum), BigInt(seed.minimumValue));
    assert.equal(valueForWeight(seed, bounds.maximum), BigInt(seed.maximumValue));
  }
});

test('seed registry uses the revised maximum crop values', () => {
  const expectedMaximums = [
    18_000_000,
    4_000_000, 2_500_000, 1_800_000, 1_250_000, 850_000, 550_000, 350_000, 250_000,
    170_000, 120_000, 85_000, 60_000, 40_000, 26_000, 18_000, 12_500, 8_500, 5_500,
    3_500, 2_250, 1_500, 1_000, 700, 450, 300, 200, 120, 80, 60, 40, 30, 20,
  ];
  assert.deepEqual(SEEDS.map((entry) => entry.maximumValue), expectedMaximums);
  assert.equal(CROP_EMOJIS.briar_rose, '<:BriarRoseFruit:1536254839263068200>');
});

test('prefix and slash roll paths share one five-second cooldown', async () => {
  let now = 10_000;
  const game = feature({ clock: () => now });
  let slashReply;
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'roll',
    user: { id: 'shared' },
    reply: async (payload) => { slashReply = payload; },
    customId: '',
  });
  assert.match(slashReply.components[0].components[0].components[0].content, /You have rolled/);
  let prefixReply;
  await game.handleMessage({
    content: 'c!roll',
    author: { id: 'shared', bot: false },
    reply: async (payload) => { prefixReply = payload; },
  });
  assert.match(prefixReply.components[0].components[0].content, /Roll cooldown/);
  now += 5_000;
  await game.handleMessage({ content: 'c!roll', author: { id: 'shared', bot: false }, reply: async (payload) => { prefixReply = payload; } });
  assert.match(prefixReply.components[0].components[0].components[0].content, /You have rolled/);
  game.close();
});

test('configured game channels and forum posts are enforced for slash and prefix economy commands', async () => {
  const game = feature({
    getGuildPolicy: () => ({ unlocked: true, enabled: true, gameChannelIds: ['game', 'side-game', 'game-forum'], cooldownBypassRoleIds: [] }),
  });
  let slashReply;
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'balance',
    guildId: 'guild',
    channelId: 'elsewhere',
    member: { roles: [] },
    user: { id: 'channel-user' },
    reply: async (payload) => { slashReply = payload; },
  });
  assert.match(slashReply.components[0].components[0].content, /only available in <#game>, <#side-game>, <#game-forum>/);
  let prefixReply;
  await game.handleMessage({
    content: 'c!roll',
    guildId: 'guild',
    channelId: 'elsewhere',
    member: { roles: [] },
    author: { id: 'channel-user', bot: false },
    reply: async (payload) => { prefixReply = payload; },
  });
  assert.match(prefixReply.components[0].components[0].content, /only available in <#game>, <#side-game>, <#game-forum>/);
  assert.equal(game.repository.inventoryState('channel-user').items.length, 0);
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'balance',
    guildId: 'guild',
    channelId: 'slash-forum-post',
    channel: { parentId: 'game-forum' },
    member: { roles: [] },
    user: { id: 'slash-forum-user' },
    reply: async (payload) => { slashReply = payload; },
  });
  assert.match(slashReply.components[0].components[0].content, /Balance/);
  await game.handleMessage({
    content: 'c!balance',
    guildId: 'guild',
    channelId: 'prefix-forum-post',
    channel: { parentId: 'game-forum' },
    member: { roles: [] },
    author: { id: 'prefix-forum-user', bot: false },
    reply: async (payload) => { prefixReply = payload; },
  });
  assert.match(prefixReply.components[0].components[0].content, /Balance/);
  game.close();
});

test('any configured bypass role skips the shared slash and prefix roll cooldown', async () => {
  let now = 20_000;
  const game = feature({
    clock: () => now,
    getGuildPolicy: () => ({ unlocked: true, enabled: true, gameChannelId: 'game', cooldownBypassRoleIds: ['vip', 'booster'] }),
  });
  let reply;
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'roll',
    guildId: 'guild',
    channelId: 'game',
    member: { roles: [] },
    user: { id: 'bypass-user' },
    reply: async (payload) => { reply = payload; },
  });
  assert.match(reply.components[0].components[0].components[0].content, /You have rolled/);
  await game.handleMessage({
    content: 'c!roll',
    guildId: 'guild',
    channelId: 'game',
    member: { roles: ['vip'] },
    author: { id: 'bypass-user', bot: false },
    reply: async (payload) => { reply = payload; },
  });
  assert.match(reply.components[0].components[0].components[0].content, /You have rolled/);
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'roll',
    guildId: 'guild',
    channelId: 'game',
    member: { roles: [] },
    user: { id: 'bypass-user' },
    reply: async (payload) => { reply = payload; },
  });
  assert.match(reply.components[0].components[0].content, /Roll cooldown/);
  assert.equal(game.repository.inventoryState('bypass-user').items.length, 2);
  game.close();
});

test('RNG access policy rejects locked, disabled, and unconfigured servers', () => {
  const source = { guildId: 'guild', channelId: 'game', member: { roles: [] } };
  assert.match(evaluateRngGameAccess(source, () => ({ unlocked: false })).reason, /locked/);
  assert.match(evaluateRngGameAccess(source, () => ({ unlocked: true, enabled: false })).reason, /disabled/);
  assert.match(evaluateRngGameAccess(source, () => ({ unlocked: true, enabled: true })).reason, /game channel/);
  const allowed = evaluateRngGameAccess({
    ...source,
    member: { roles: { cache: new Map([['vip', {}], ['member', {}]]) } },
  }, () => ({ unlocked: true, enabled: true, gameChannelIds: ['other-game', 'game'], cooldownBypassRoleIds: ['vip', 'booster'] }));
  assert.deepEqual(allowed, { allowed: true, bypassCooldown: true });
  const legacyAllowed = evaluateRngGameAccess(source, () => ({
    unlocked: true,
    enabled: true,
    gameChannelId: 'game',
  }));
  assert.deepEqual(legacyAllowed, { allowed: true, bypassCooldown: false });
});

test('full inventory rejects before RNG and does not consume cooldown', () => {
  let randomCalls = 0;
  const game = feature({ rng: (maximum) => { randomCalls += 1; return maximum - 1; } });
  game.repository.ensurePlayer('full');
  game.db.prepare('UPDATE rng_players SET inventory_capacity = 0 WHERE user_id = ?').run('full');
  const result = game.gameService.roll('full');
  assert.equal(result.status, 'full');
  assert.equal(randomCalls, 0);
  assert.equal(game.db.prepare('SELECT COUNT(*) AS count FROM rng_roll_cooldowns').get().count, 0n);
  game.close();
});

test('inventory pagination and AND filters are stable', () => {
  const carrot = SEEDS.at(-1);
  const apples = SEEDS.find((seed) => seed.id === 'apple');
  const items = Array.from({ length: 13 }, (_, index) => item(index + 1, carrot, 10 + index, 1n, 100 - index));
  items.push(item(99, apples, 200, 10n, 1));
  const view = { page: 2, filters: {} };
  const state = { items };
  const page = inventoryPageData(state, view);
  assert.equal(page.maxPage, 2);
  assert.equal(page.pageItems.length, 2);
  const filtered = filterInventory(items, { name: 'app-le', minimumWeightUnits: 150, rarity: 'Uncommon' });
  assert.deepEqual(filtered.map((entry) => entry.id), ['99']);
});

test('inventory fields intentionally insert a desktop spacer after every two crops', () => {
  const fields = inventoryCropFields([item(1), item(2), item(3), item(4)]);
  assert.equal(fields.length, 6);
  assert.deepEqual([fields[2].name, fields[5].name], ['\u200b', '\u200b']);
  assert.ok(fields.every((field) => field.inline));
  assert.ok(fields[0].value.includes(RARITY_EMOJIS.Common));
  assert.doesNotMatch(fields[0].value, /\bCommon\b/);
});

test('rarity registry uses the configured custom Discord badges', () => {
  assert.deepEqual(RARITY_EMOJIS, {
    Common: '<:RCommon:1536072829148336128>',
    Uncommon: '<:RUncommon:1536072831299747951>',
    Rare: '<:RRare:1536072820826570955>',
    Epic: '<:REpic:1536072823687348244>',
    Legendary: '<:RLegendary:1536072819237060650>',
    Mythic: '<:RMythic:1536072827105443871>',
    Super: '<a:RSUPER:1536072842800537600>',
    Secret: '<:RSecret:1536073173165146344>',
  });
});

test('rolled crop thumbnails omit Discord image-description alt text', () => {
  const seed = SEEDS.at(-1);
  const payload = rollPayload('123456789012345678', {
    seed,
    item: { weightUnits: weightBounds(seed).minimum },
  });
  const thumbnail = payload.components[0].components[0].accessory;
  assert.equal(thumbnail.type, 11);
  assert.ok(thumbnail.media.url);
  assert.equal(Object.hasOwn(thumbnail, 'description'), false);
  const content = payload.components[0].components[0].components[0].content;
  assert.match(content, new RegExp(`Rarity: ${seed.rarityEmoji} .*50%`));
  assert.doesNotMatch(content, /Rarity: Common/);
});

test('balance uses a white text-only container with a non-pinging user mention', () => {
  const payload = balancePayload({ id: '123456789012345678' }, 12_345n);
  const container = payload.components[0];
  assert.equal(container.type, 17);
  assert.equal(container.accent_color, 0xFFFFFF);
  assert.deepEqual(container.components, [{
    type: 10,
    content: `### <@123456789012345678>'s Balance\n- Sheckles: 12,345 ${SHECKLES_EMOJI}`,
  }]);
  assert.deepEqual(payload.allowedMentions.parse, []);
  assert.deepEqual(payload.allowedMentions.users, []);
});

test('crop normalization accepts spaces, no spaces, hyphens, and underscores', () => {
  const expected = 'dragonfruit';
  for (const name of ['Dragon Fruit', 'dragon fruit', 'dragonfruit', 'dragon-fruit', 'dragon_fruit']) {
    assert.equal(normalizeCropName(name), expected);
  }
});

test('sell selections survive page changes because the backend set is authoritative', () => {
  const items = Array.from({ length: 30 }, (_, index) => item(index + 1));
  const session = { selectedItemIds: new Set(['1']), currentPage: 1, filters: {} };
  const state = { items };
  assert.equal(salePageData(state, session).pageItems.length, 25);
  session.currentPage = 2;
  session.selectedItemIds.add('26');
  salePageData(state, session);
  assert.deepEqual([...session.selectedItemIds], ['1', '26']);
});

test('sell navigation buttons use valid text labels instead of punctuation emoji', () => {
  const state = { items: [item(1)] };
  const session = { id: 'session', selectedItemIds: new Set(), currentPage: 1, filters: {} };
  const payload = salePayload(state, session);
  const navigation = payload.components[0].components[3].components;
  assert.equal(navigation[0].label, 'Previous');
  assert.equal(navigation[2].label, 'Next');
  assert.equal(Object.hasOwn(navigation[0], 'emoji'), false);
  assert.equal(Object.hasOwn(navigation[2], 'emoji'), false);
});

test('an active sell session locks rolls and other economy commands without consuming cooldown', async () => {
  const game = feature();
  game.saleSessions.create('locked');
  const result = game.gameService.roll('locked');
  assert.equal(result.status, 'locked');
  assert.equal(game.db.prepare('SELECT COUNT(*) AS count FROM rng_roll_cooldowns').get().count, 0n);
  let reply;
  await game.handleInteraction({
    isChatInputCommand: () => true,
    commandName: 'balance',
    user: { id: 'locked' },
    reply: async (payload) => { reply = payload; },
    customId: '',
  });
  assert.match(reply.components[0].components[0].content, /Sale in progress/);
  game.close();
});

test('Deny clears the sale session and disables the old sale controls', async () => {
  const game = feature();
  addItem(game, 'deny');
  const session = game.saleSessions.create('deny');
  let updated;
  await game.handleInteraction({
    isChatInputCommand: () => false,
    isButton: () => true,
    isRepliable: () => true,
    customId: `rng:sale:deny:${session.id}`,
    user: { id: 'deny' },
    update: async (payload) => { updated = payload; },
    reply: async () => {},
  });
  assert.equal(game.saleSessions.has('deny'), false);
  assert.match(updated.components[0].components[0].content, /Sale cancelled/);
  assert.equal(updated.components[0].components.length, 1);
  game.close();
});

test('selling is atomic and an operation replay cannot credit twice', () => {
  const game = feature();
  const first = addItem(game, 'seller', SEEDS.at(-1), { value: 2n, rolledAt: 1 });
  const second = addItem(game, 'seller', SEEDS.at(-1), { value: 2n, rolledAt: 2 });
  const sold = game.repository.sell('seller', [first, second], 'sale:atomic', 3);
  const replay = game.repository.sell('seller', [first, second], 'sale:atomic', 4);
  assert.deepEqual({ count: sold.itemCount, total: sold.total, balance: sold.balance }, { count: 2, total: 4n, balance: 4n });
  assert.equal(replay.duplicate, true);
  assert.equal(game.repository.inventoryState('seller').items.length, 0);
  assert.equal(game.repository.getPlayer('seller').balance, 4n);
  game.close();
});

test('upgrade affordability is rechecked transactionally and duplicate operations are idempotent', () => {
  const game = feature();
  game.repository.ensurePlayer('upgrade');
  game.db.prepare('UPDATE rng_players SET sheckle_balance = ? WHERE user_id = ?').run(999n, 'upgrade');
  const denied = game.repository.upgrade('upgrade', 'upgrade:denied', upgradeCost, 1);
  assert.equal(denied.status, 'insufficient');
  assert.equal(game.repository.getPlayer('upgrade').inventoryCapacity, 100);
  game.db.prepare('UPDATE rng_players SET sheckle_balance = ? WHERE user_id = ?').run(1_000n, 'upgrade');
  const upgraded = game.repository.upgrade('upgrade', 'upgrade:once', upgradeCost, 2);
  const replay = game.repository.upgrade('upgrade', 'upgrade:once', upgradeCost, 3);
  assert.equal(upgraded.status, 'ok');
  assert.equal(replay.duplicate, true);
  assert.equal(game.repository.getPlayer('upgrade').inventoryCapacity, 110);
  assert.equal(game.repository.getPlayer('upgrade').balance, 0n);
  game.close();
});

test('inventory upgrade cost uses the exact polynomial formula', () => {
  assert.equal(upgradeCost(0), 1_000n);
  assert.equal(upgradeCost(1), 6_100n);
  assert.equal(upgradeCost(5), 28_500n);
  assert.equal(upgradeCost(10), 61_000n);
  assert.equal(upgradeCost(20), 141_000n);
});

test('15-minute inactivity expiry releases the per-user sale lock', () => {
  let now = 1_000;
  const store = new SaleSessionStore({ clock: () => now });
  store.create('expiring');
  assert.equal(store.has('expiring'), true);
  now += 15 * 60 * 1_000;
  assert.equal(store.has('expiring'), false);
});
