const assert = require('node:assert/strict');
const test = require('node:test');

const { createRngGameFeature } = require('../src/features/rng-game');
const { inventoryCropFields, inventoryPageData, salePageData } = require('../src/features/rng-game/components/builders');
const { CHECKED_SEEDS, FALLBACK_SEED, SEEDS } = require('../src/features/rng-game/data/seeds');
const { cascadingRoll, generateInstance, valueForWeight, weightBounds } = require('../src/features/rng-game/services/rngService');
const { upgradeCost } = require('../src/features/rng-game/services/gameService');
const { SaleSessionStore } = require('../src/features/rng-game/services/sessionStore');
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

test('cascading rolls check seeds in rarest-first registry order', () => {
  const calls = [];
  const result = cascadingRoll({
    rng(maximum) {
      calls.push(maximum);
      if (calls.length === 1) return CHECKED_SEEDS[0].chanceNumerator;
      if (calls.length === 2) return 0;
      return 0;
    },
  });
  assert.equal(result.seed.id, 'dragons_breath');
  assert.deepEqual(calls.slice(0, 2), [
    CHECKED_SEEDS[0].chanceDenominator,
    CHECKED_SEEDS[1].chanceDenominator,
  ]);
});

test('Star Fruit succeeds at the last integer inside its configured rational check', () => {
  const calls = [];
  const result = cascadingRoll({
    rng(maximum) {
      calls.push(maximum);
      return calls.length === 1 ? CHECKED_SEEDS[0].chanceNumerator - 1 : 0;
    },
  });
  assert.equal(result.seed.id, 'star_fruit');
  assert.equal(calls.filter((maximum) => maximum > 3_000).length, 1);
});

test('a failed check continues and a successful check stops immediately', () => {
  let checks = 0;
  const result = cascadingRoll({
    checkedSeeds: CHECKED_SEEDS.slice(0, 3),
    rng(maximum) {
      checks += 1;
      if (checks === 1) return CHECKED_SEEDS[0].chanceNumerator;
      if (checks === 2) return CHECKED_SEEDS[1].chanceNumerator - 1;
      assert.equal(maximum, weightBounds(CHECKED_SEEDS[1]).maximum - weightBounds(CHECKED_SEEDS[1]).minimum + 1);
      return 0;
    },
  });
  assert.equal(result.seed.id, 'dragons_breath');
  assert.equal(checks, 3, 'two chance checks plus one weight draw');
});

test('Carrot is the guaranteed fallback when every individual check fails', () => {
  const result = cascadingRoll({ rng: (maximum) => maximum - 1 });
  assert.equal(result.seed, FALLBACK_SEED);
});

test('rational checks use result < numerator exactly', () => {
  const rational = { ...SEEDS.at(-1), id: 'rational', fallback: false, chanceNumerator: 3, chanceDenominator: 25 };
  const succeeds = cascadingRoll({ checkedSeeds: [rational], fallbackSeed: FALLBACK_SEED, rng: (() => {
    const values = [2, 0];
    return () => values.shift();
  })() });
  const fails = cascadingRoll({ checkedSeeds: [rational], fallbackSeed: FALLBACK_SEED, rng: (() => {
    const values = [3, 0];
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
  game.db.prepare('UPDATE rng_players SET sheckle_balance = ? WHERE user_id = ?').run(49_999n, 'upgrade');
  const denied = game.repository.upgrade('upgrade', 'upgrade:denied', upgradeCost, 1);
  assert.equal(denied.status, 'insufficient');
  assert.equal(game.repository.getPlayer('upgrade').inventoryCapacity, 100);
  game.db.prepare('UPDATE rng_players SET sheckle_balance = ? WHERE user_id = ?').run(50_000n, 'upgrade');
  const upgraded = game.repository.upgrade('upgrade', 'upgrade:once', upgradeCost, 2);
  const replay = game.repository.upgrade('upgrade', 'upgrade:once', upgradeCost, 3);
  assert.equal(upgraded.status, 'ok');
  assert.equal(replay.duplicate, true);
  assert.equal(game.repository.getPlayer('upgrade').inventoryCapacity, 125);
  assert.equal(game.repository.getPlayer('upgrade').balance, 0n);
  game.close();
});

test('upgrade cost uses exact rational growth and nearest-100 rounding', () => {
  assert.equal(upgradeCost(0), 50_000n);
  assert.equal(upgradeCost(1), 87_500n);
  assert.equal(upgradeCost(2), 153_100n);
});

test('15-minute inactivity expiry releases the per-user sale lock', () => {
  let now = 1_000;
  const store = new SaleSessionStore({ clock: () => now });
  store.create('expiring');
  assert.equal(store.has('expiring'), true);
  now += 15 * 60 * 1_000;
  assert.equal(store.has('expiring'), false);
});
