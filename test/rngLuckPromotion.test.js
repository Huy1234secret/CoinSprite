const assert = require('node:assert/strict');
const test = require('node:test');

const { createRngGameFeature } = require('../src/features/rng-game');
const { CHECKED_SEEDS, FALLBACK_SEED } = require('../src/features/rng-game/data/seeds');
const {
  powerUpgradePayload,
  upgradePromptPayload,
} = require('../src/features/rng-game/components/builders');
const {
  MAX_LUCK_TIER,
  PROBABILITY_SCALE,
  RARITY_ORDER,
  applyLuckPromotions,
  baseCropDistribution,
  baseRarityDistribution,
  expectedValueForLuckTier,
  generateInstance,
  luckProbabilityReport,
  rarityDistribution,
  valueForWeight,
} = require('../src/features/rng-game/services/rngService');
const { bigUpgradeCost, luckUpgradeCost, upgradeCost } = require('../src/features/rng-game/services/gameService');

function percent(distribution, rarity) {
  return (Number(distribution[rarity]) * 100) / Number(PROBABILITY_SCALE);
}

function expectedRank(distribution) {
  return RARITY_ORDER.reduce(
    (total, rarity, index) => total + (Number(distribution[rarity]) * index),
    0,
  ) / Number(PROBABILITY_SCALE);
}

function feature(options = {}) {
  return createRngGameFeature({
    databasePath: ':memory:',
    indexRenderer: { render: async () => Buffer.from('index'), invalidate() {}, clear() {} },
    notifyAutoRoll: async () => {},
    ...options,
  });
}

test('Luck tier zero matches the exact cascading crop and rarity baseline', () => {
  const crops = baseCropDistribution();
  const baseline = rarityDistribution(0);
  assert.deepEqual(baseline, baseRarityDistribution(crops));
  assert.equal(crops.length, CHECKED_SEEDS.length + 1);
  assert.equal(crops.at(-1).seed, FALLBACK_SEED);
  const expectedApproximatePercentages = {
    Common: 81.4723,
    Uncommon: 14.6285,
    Rare: 3.6990,
    Epic: 0.1924,
    Legendary: 0.0059,
    Mythic: 0.0013,
    Super: 0.0006,
  };
  for (const rarity of RARITY_ORDER) {
    assert.ok(Math.abs(percent(baseline, rarity) - expectedApproximatePercentages[rarity]) < 0.0001, rarity);
  }
});

test('every Luck tier is normalized, non-negative, and moves expected rarity upward', () => {
  let priorRank = -1;
  for (let tier = 0; tier <= MAX_LUCK_TIER; tier += 1) {
    const distribution = rarityDistribution(tier);
    assert.equal(
      RARITY_ORDER.reduce((sum, rarity) => sum + distribution[rarity], 0n),
      PROBABILITY_SCALE,
      `tier ${tier}`,
    );
    assert.ok(RARITY_ORDER.every((rarity) => distribution[rarity] >= 0n), `tier ${tier}`);
    const rank = expectedRank(distribution);
    assert.ok(rank > priorRank, `expected rarity rank did not rise at tier ${tier}`);
    priorRank = rank;
  }
});

test('Common decreases, Super increases, and adjacent tiers remain smooth', () => {
  let prior = rarityDistribution(0);
  for (let tier = 1; tier <= MAX_LUCK_TIER; tier += 1) {
    const current = rarityDistribution(tier);
    assert.ok(current.Common <= prior.Common, `Common increased at tier ${tier}`);
    assert.ok(current.Super >= prior.Super, `Super decreased at tier ${tier}`);
    for (const rarity of RARITY_ORDER) {
      const pointChange = Math.abs(percent(current, rarity) - percent(prior, rarity));
      assert.ok(pointChange <= 5, `${rarity} jumped ${pointChange} points at tier ${tier}`);
    }
    prior = current;
  }
});

test('the promotion transition forms a rise-and-fall wave for intermediate rarities', () => {
  const baseline = baseRarityDistribution(baseCropDistribution());
  const extended = Array.from({ length: 401 }, (_, tier) => applyLuckPromotions(baseline, tier));
  for (const rarity of RARITY_ORDER.slice(1, -1)) {
    const values = extended.map((distribution) => distribution[rarity]);
    const peak = values.reduce((best, value, index) => (value > values[best] ? index : best), 0);
    assert.ok(peak > 0 && peak < values.length - 1, `${rarity} did not peak inside the modeled wave`);
    assert.ok(values[peak] > values[0], `${rarity} never rose`);
    assert.ok(values.at(-1) < values[peak], `${rarity} never declined after its peak`);
  }
});

test('Luck tier twenty stays inside every balancing target range', () => {
  const distribution = rarityDistribution(20);
  const ranges = {
    Common: [25, 45],
    Uncommon: [30, 45],
    Rare: [15, 25],
    Epic: [3, 9],
    Legendary: [0.5, 2.5],
    Mythic: [0.03, 0.40],
    Super: [0.003, 0.05],
  };
  for (const [rarity, [minimum, maximum]] of Object.entries(ranges)) {
    const actual = percent(distribution, rarity);
    assert.ok(actual >= minimum && actual <= maximum, `${rarity}: ${actual}%`);
  }
});

test('Luck preserves original relative crop weights inside every rarity', () => {
  const crops = baseCropDistribution();
  for (const rarity of RARITY_ORDER) {
    const entries = crops.filter((entry) => entry.seed.rarity === rarity);
    const total = entries.reduce((sum, entry) => sum + entry.units, 0n);
    const exactWeights = entries.map((entry) => Number(
      (entry.fraction.numerator * 1_000_000_000_000_000_000n) / entry.fraction.denominator,
    ) / 1e18);
    const exactTotal = exactWeights.reduce((sum, value) => sum + value, 0);
    for (const entry of entries) {
      const index = entries.indexOf(entry);
      const baseShare = Number(entry.units) / Number(total);
      const exactShare = exactWeights[index] / exactTotal;
      assert.ok(Math.abs(baseShare - exactShare) < 1e-5, `${entry.seed.id} changed within-rarity share`);
    }
  }
});

test('manual and automatic rolls use identical Luck sampling', () => {
  const rng = (maximum) => Math.min(maximum - 1, Math.floor(maximum * 0.42));
  const game = feature({ rng, clock: () => 1_000 });
  game.repository.ensurePlayer('manual');
  game.repository.ensurePlayer('automatic');
  game.db.prepare('UPDATE rng_players SET luck_tier = 10 WHERE user_id IN (?, ?)').run('manual', 'automatic');
  game.db.prepare('UPDATE rng_players SET sheckle_balance = 60 WHERE user_id = ?').run('automatic');
  const manual = game.gameService.roll('manual');
  const preview = game.autoRollService.preview('1m', []);
  const started = game.autoRollService.start('automatic', preview, { guildId: 'guild', channelId: 'channel' });
  const automatic = game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  assert.deepEqual(
    [automatic.item.seedId, automatic.item.weightUnits, automatic.item.value],
    [manual.item.seedId, manual.item.weightUnits, manual.item.value],
  );
  game.close();
});

test('BIG crops store exactly four times base weight and base-weight value', () => {
  const seed = FALLBACK_SEED;
  const draws = [20, 0];
  const instance = generateInstance(seed, () => draws.shift(), { bigCropTier: 20 });
  assert.equal(instance.baseWeightUnits, 30);
  assert.equal(instance.weightUnits, 120);
  assert.equal(instance.value, valueForWeight(seed, 30) * 4n);
  assert.equal(instance.value, 32n);
});

test('all three upgrade costs use the final exact BigInt polynomials', () => {
  assert.deepEqual([0, 1, 5, 10, 15, 19].map(upgradeCost), [
    1_000n, 6_100n, 28_500n, 61_000n, 98_500n, 132_100n,
  ]);
  assert.deepEqual([0, 1, 5, 10, 15, 19].map(luckUpgradeCost), [
    10_000n, 20_000n, 160_000n, 560_000n, 1_210_000n, 1_910_000n,
  ]);
  assert.deepEqual([0, 1, 5, 10, 15, 19].map(bigUpgradeCost), [
    5_000n, 8_000n, 30_000n, 80_000n, 155_000n, 233_000n,
  ]);
});

test('max-tier power purchases return max-tier without charging and replay safely', () => {
  const game = feature();
  game.repository.ensurePlayer('maxed');
  game.db.prepare(`UPDATE rng_players SET sheckle_balance = ?, luck_tier = 20,
    big_crop_tier = 20 WHERE user_id = ?`).run(999_999n, 'maxed');
  const luck = game.repository.purchasePowerUpgrade('maxed', 'luck', 'max:luck', luckUpgradeCost, 1);
  const luckReplay = game.repository.purchasePowerUpgrade('maxed', 'luck', 'max:luck', luckUpgradeCost, 2);
  const big = game.repository.purchasePowerUpgrade('maxed', 'big', 'max:big', bigUpgradeCost, 3);
  assert.equal(luck.status, 'max-tier');
  assert.equal(big.status, 'max-tier');
  assert.equal(luckReplay.duplicate, true);
  assert.equal(game.repository.getPlayer('maxed').balance, 999_999n);
  game.close();
});

test('upgrade UI explains Luck probabilities and disables maximum-tier purchases', () => {
  const payload = powerUpgradePayload(
    { id: 'user' },
    { balance: 10_000n, luckTier: 0, bigCropTier: 0 },
    { luckActionId: 'luck', bigActionId: 'big', luckCost: 10_000n, bigCost: 5_000n },
  );
  const luckCard = payload.components[0].components[1];
  assert.match(luckCard.components[0].content, /gradually promotes crop rolls into higher rarities/);
  assert.match(luckCard.components[0].content, /Current → next rarity probabilities/);
  assert.match(luckCard.components[0].content, /1 in [\d,]+/);
  assert.match(luckCard.components[0].content, /Upgrade cost: 10,000/);

  const maxed = powerUpgradePayload(
    { id: 'user' },
    { balance: 999_999n, luckTier: 20, bigCropTier: 20 },
    { luckActionId: null, bigActionId: null, luckCost: null, bigCost: null },
  );
  for (const card of maxed.components[0].components.slice(1)) {
    assert.equal(card.accessory.label, 'MAX');
    assert.equal(card.accessory.disabled, true);
  }

  const inventory = upgradePromptPayload(
    { id: 'inventory', cost: 1_000n },
    { balance: 1_000n },
  );
  assert.match(inventory.components[0].components[2].content, /\+10 capacity/);
});

test('probability report covers all tiers and expected income rises smoothly', () => {
  const report = luckProbabilityReport();
  assert.equal(report.length, 21);
  assert.deepEqual(report.map((entry) => entry.tier), Array.from({ length: 21 }, (_, tier) => tier));
  for (let tier = 1; tier < report.length; tier += 1) {
    assert.equal(report[tier].expectedValue, expectedValueForLuckTier(tier));
    assert.ok(report[tier].expectedValue > report[tier - 1].expectedValue, `income stalled at tier ${tier}`);
    assert.ok(report[tier].expectedValue / report[tier - 1].expectedValue < 1.2, `income jumped at tier ${tier}`);
  }
});
