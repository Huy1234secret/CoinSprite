const assert = require('node:assert/strict');
const test = require('node:test');

const { createFarmingGameFeature } = require('../src/features/farming-game');
const { catalogIndexForName } = require('../src/features/farming-game/data/catalog');
const {
  addFractions,
  farmingChanceDistribution,
  farmingChanceProfile,
  fraction,
  parsePreviewMultiplier,
} = require('../src/features/farming-game/services/chanceService');
const {
  MAX_FARMING_BIG_CROP_TIER,
  MAX_FARMING_LUCK_TIER,
  farmingBigCropChance,
  farmingLuckMultiplier,
} = require('../src/features/farming-game/services/upgradeService');

function catalogEntry(id, rarity, numerator, denominator, options = {}) {
  return Object.freeze({
    id,
    seed: Object.freeze({ id: `${id}-seed`, name: `${id} Seed`, rarity, value: 1n }),
    crop: Object.freeze({
      id,
      name: options.name || id,
      rarity,
      emoji: `<:IT${id.replace(/[^a-z]/gi, '')}:1536400519520583750>`,
      minimumValue: 1,
      maximumValue: 2,
    }),
    chanceNumerator: BigInt(numerator),
    chanceDenominator: BigInt(denominator),
    secretUntilDiscovered: options.secret === true,
    outlineColor: '#94A3B8',
    growTimeMs: 60_000,
    seedImagePath: 'seed.png',
    cropImagePath: 'crop.png',
  });
}

const TEST_CATALOG = Object.freeze([
  catalogEntry('common-crop', 'Common', 90, 100, { name: 'Common Crop' }),
  catalogEntry('rare-crop', 'Rare', 9, 100, { name: 'Rare Crop' }),
  catalogEntry('hidden-secret', 'Secret', 1, 100, { name: 'Hidden Secret', secret: true }),
]);

function byId(distribution, id) {
  return distribution.find((row) => row.entry.id === id);
}

function fakeRenderer() {
  return { render: async () => Buffer.from('image'), clear() {} };
}

test('Farming chance calculation is exact, normalized, Luck-aware, and keeps Secret fixed', () => {
  const base = farmingChanceDistribution(1n, { catalog: TEST_CATALOG });
  assert.deepEqual(
    base.map((row) => [row.entry.id, row.numerator, row.denominator]),
    [['common-crop', 9n, 10n], ['rare-crop', 9n, 100n], ['hidden-secret', 1n, 100n]],
  );
  const preview = farmingChanceDistribution(50n, { catalog: TEST_CATALOG });
  const total = preview.reduce((sum, row) => addFractions(sum, row), fraction(0n, 1n));
  assert.deepEqual(total, fraction(1n, 1n));
  assert.ok(
    byId(preview, 'rare-crop').numerator * byId(base, 'rare-crop').denominator
      > byId(base, 'rare-crop').numerator * byId(preview, 'rare-crop').denominator,
  );
  assert.deepEqual(
    fraction(byId(preview, 'hidden-secret').numerator, byId(preview, 'hidden-secret').denominator),
    fraction(1n, 100n),
  );

  const enormous = 10n ** 500n;
  const huge = farmingChanceDistribution(enormous, { catalog: TEST_CATALOG });
  assert.deepEqual(huge.reduce((sum, row) => addFractions(sum, row), fraction(0n, 1n)), fraction(1n, 1n));
  assert.ok(huge.every((row) => typeof row.numerator === 'bigint' && typeof row.denominator === 'bigint'));
});

test('preview validation accepts unlimited positive whole multipliers and rejects unsafe syntax', () => {
  assert.equal(parsePreviewMultiplier('51'), 51n);
  assert.equal(parsePreviewMultiplier(`1${'0'.repeat(999)}`).toString().length, 1_000);
  for (const value of ['', '0', '-1', '+2', '1.5', '1e9', 'abc']) {
    if (value === '') assert.equal(parsePreviewMultiplier(value, 7n), 7n);
    else assert.throws(() => parsePreviewMultiplier(value), /positive whole number/);
  }
  assert.throws(() => parsePreviewMultiplier(`1${'0'.repeat(1_000)}`), /1,000 digits/);
});

test('Farming chance profiles mask normal crops and omit undiscovered Secret crops server-side', () => {
  const discovered = new Set(['common-crop']);
  const calls = [];
  const repository = {
    ensureProfile(userId) { calls.push(['profile', userId]); return { luckTier: 4 }; },
    cropStatistics(userId, cropId) {
      calls.push(['stats', userId, cropId]);
      return {
        totalPlanted: discovered.has(cropId) ? 1n : 0n,
        totalHarvested: 0n,
        highestWeightUnits: 0,
      };
    },
  };
  const profile = farmingChanceProfile(repository, 'signed-farmer', 75n, { catalog: TEST_CATALOG, now: 1 });
  assert.equal(profile.currentMultiplier, '5');
  assert.equal(profile.previewMultiplier, '75');
  assert.equal(profile.visibleTotal, 2);
  assert.equal(profile.discoveredCount, 1);
  assert.deepEqual(Object.keys(profile.crops[1]).sort(), ['artworkUrl', 'discovered', 'slot']);
  const serialized = JSON.stringify(profile);
  assert.doesNotMatch(serialized, /Rare Crop|rare-crop|Hidden Secret|hidden-secret|Secret/);
  assert.ok(calls.every((call) => call[1] === 'signed-farmer'));

  discovered.add('hidden-secret');
  const revealed = farmingChanceProfile(repository, 'signed-farmer', 10n ** 200n, { catalog: TEST_CATALOG, now: 2 });
  const secret = revealed.crops.find((crop) => crop.name === 'Hidden Secret');
  assert.ok(secret);
  assert.deepEqual(secret.previewChance, secret.baseChance);
  assert.match(secret.secretNotice, /Luck does not affect/);
});

test('Farming Luck reaches exactly ×50 and BIG Crop Chance reaches exactly 5% without overcharging', () => {
  const game = createFarmingGameFeature({
    databasePath: ':memory:',
    farmRenderer: fakeRenderer(),
    indexRenderer: fakeRenderer(),
    rng: () => 0,
  });
  const userId = 'max-farming-upgrades';
  game.farmingService.ensureProfile(userId);
  game.db.prepare(`UPDATE farm_profiles SET coin_balance = ?, luck_tier = ?, big_crop_tier = ?
    WHERE user_id = ?`).run(10_000_000n, 48n, 49n, userId);

  const luck = game.farmingService.purchaseUpgrade(userId, 'luck', 'luck-final');
  assert.equal(luck.status, 'ok');
  assert.equal(luck.tier, MAX_FARMING_LUCK_TIER);
  assert.equal(farmingLuckMultiplier(luck.tier), 50n);
  const afterLuck = game.farmingService.profile(userId);
  const maxLuck = game.farmingService.purchaseUpgrade(userId, 'luck', 'luck-over-max');
  assert.equal(maxLuck.status, 'max-tier');
  assert.equal(game.farmingService.profile(userId).balance, afterLuck.balance);

  const big = game.farmingService.purchaseUpgrade(userId, 'big', 'big-final');
  assert.equal(big.status, 'ok');
  assert.equal(big.tier, MAX_FARMING_BIG_CROP_TIER);
  assert.deepEqual(farmingBigCropChance(big.tier), { numerator: 50n, denominator: 1_000n });
  const afterBig = game.farmingService.profile(userId);
  const maxBig = game.farmingService.purchaseUpgrade(userId, 'big', 'big-over-max');
  assert.equal(maxBig.status, 'max-tier');
  assert.equal(game.farmingService.profile(userId).balance, afterBig.balance);

  game.farmingService.plant(userId, [1], 'carrot_seed_package');
  const planted = game.repository.plantedCropInstancesForOwner(userId);
  assert.ok(planted.every((crop) => crop.isBig));
  assert.ok(planted.every((crop) => crop.weightUnits === 80));
  assert.ok(planted.every((crop) => crop.storedValue === 8n));
  assert.deepEqual(
    game.farmingService.chanceDistribution(50n),
    farmingChanceDistribution(50n),
  );
  game.close();
});

test('Farming Index search input cannot find an undiscovered Secret entry', () => {
  const game = createFarmingGameFeature({
    databasePath: ':memory:',
    farmRenderer: fakeRenderer(),
    indexRenderer: fakeRenderer(),
    farmingCatalog: TEST_CATALOG,
  });
  const userId = 'secret-index-farmer';
  const hidden = game.farmingService.indexState(userId).entries;
  assert.equal(catalogIndexForName('Hidden Secret', hidden), -1);
  game.db.prepare(`INSERT INTO farm_crop_statistics
    (owner_user_id, crop_id, total_planted, total_harvested, highest_weight_units, updated_at)
    VALUES (?, 'hidden-secret', 1, 0, 0, 1)`).run(userId);
  const revealed = game.farmingService.indexState(userId).entries;
  assert.ok(catalogIndexForName(' hidden secret ', revealed) >= 0);
  game.close();
});
