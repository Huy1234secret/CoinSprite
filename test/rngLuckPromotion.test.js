const assert = require('node:assert/strict');
const test = require('node:test');

const { createRngGameFeature } = require('../src/features/rng-game');
const { CHECKED_SEEDS, FALLBACK_SEED } = require('../src/features/rng-game/data/seeds');
const {
  powerUpgradePayload,
  upgradePromptPayload,
} = require('../src/features/rng-game/components/builders');
const {
  BASE_RARITY_DISTRIBUTION,
  MAX_LUCK_RARITY_UNITS,
  PROBABILITY_SCALE,
  RARITY_ORDER,
  baseCropDistribution,
  bigChance,
  expectedValueForLuckTier,
  generateInstance,
  luckProbabilityReport,
  previewRarityDistribution,
  rarityDistribution,
  valueForWeight,
} = require('../src/features/rng-game/services/rngService');
const {
  autoRollCostPerRoll,
  grossExpectedValueFraction,
} = require('../src/features/rng-game/services/economyService');
const {
  BIG_UPGRADE_PRICES,
  LUCK_UPGRADE_PRICES,
  bigUpgradeCost,
  luckUpgradeCost,
  upgradeCost,
} = require('../src/features/rng-game/services/gameService');
const {
  MAX_BIG_CROP_CHANCE,
  MAX_BIG_CROP_TIER,
  MAX_LUCK_MULTIPLIER,
  MAX_LUCK_TIER,
} = require('../src/features/rng-game/config/upgrades');

function percent(distribution, rarity) {
  return (Number(distribution[rarity]) * 100) / Number(PROBABILITY_SCALE);
}

function feature(options = {}) {
  return createRngGameFeature({
    databasePath: ':memory:',
    indexRenderer: { render: async () => Buffer.from('index'), invalidate() {}, clear() {} },
    notifyAutoRoll: async () => {},
    ...options,
  });
}

function fund(game, userId, balance) {
  game.repository.ensurePlayer(userId, 1);
  game.db.prepare('UPDATE rng_players SET sheckle_balance = ? WHERE user_id = ?')
    .run(BigInt(balance), String(userId));
}

test('Luck tier zero is exactly the cascading baseline and tier 49 is exactly the target', () => {
  assert.deepEqual(rarityDistribution(0), BASE_RARITY_DISTRIBUTION);
  assert.deepEqual(rarityDistribution(MAX_LUCK_TIER), MAX_LUCK_RARITY_UNITS);
  assert.equal(baseCropDistribution().length, CHECKED_SEEDS.length + 1);
  assert.equal(baseCropDistribution().at(-1).seed, FALLBACK_SEED);
  const expectedBaseline = {
    Common: 81.4723,
    Uncommon: 14.6285,
    Rare: 3.6990,
    Epic: 0.1924,
    Legendary: 0.0059,
    Mythic: 0.0013,
    Secret: 0.0001,
    Super: 0.0006,
  };
  for (const rarity of RARITY_ORDER) {
    assert.ok(Math.abs(percent(BASE_RARITY_DISTRIBUTION, rarity) - expectedBaseline[rarity]) < 0.0001, rarity);
  }
});

test('every direct Luck distribution totals one billion units with no negative rarity', () => {
  for (let tier = 0; tier <= MAX_LUCK_TIER; tier += 1) {
    const distribution = rarityDistribution(tier);
    assert.equal(RARITY_ORDER.reduce((sum, rarity) => sum + distribution[rarity], 0n), PROBABILITY_SCALE, `tier ${tier}`);
    assert.ok(RARITY_ORDER.every((rarity) => distribution[rarity] >= 0n), `tier ${tier}`);
    assert.equal(distribution.Secret, BASE_RARITY_DISTRIBUTION.Secret, `Secret tier ${tier}`);
  }
});

test('smoothstep checkpoints match the target probability and expected-value curve', () => {
  const checkpoints = new Map([
    [0, [0.005899, 0.001290, 0.000644, 47.37]],
    [10, [0.221158, 0.011946, 0.002194, 121.56]],
    [20, [0.731341, 0.037200, 0.005867, 297.39]],
    [30, [1.333051, 0.066985, 0.010198, 504.77]],
    [40, [1.822894, 0.091233, 0.013725, 673.59]],
    [49, [2.000000, 0.100000, 0.015000, 734.63]],
  ]);
  for (const [tier, [legendary, mythic, superChance, expectedValue]] of checkpoints) {
    const distribution = rarityDistribution(tier);
    assert.ok(Math.abs(percent(distribution, 'Legendary') - legendary) < 0.000001, `Legendary tier ${tier}`);
    assert.ok(Math.abs(percent(distribution, 'Mythic') - mythic) < 0.000001, `Mythic tier ${tier}`);
    assert.ok(Math.abs(percent(distribution, 'Super') - superChance) < 0.000001, `Super tier ${tier}`);
    assert.ok(Math.abs(expectedValueForLuckTier(tier) - expectedValue) < 0.01, `EV tier ${tier}`);
  }
});

test('expected value rises smoothly and strictly at every purchasable Luck tier', () => {
  let previous = expectedValueForLuckTier(0);
  for (let tier = 1; tier <= MAX_LUCK_TIER; tier += 1) {
    const current = expectedValueForLuckTier(tier);
    assert.ok(current > previous, `expected value did not rise at tier ${tier}`);
    assert.ok(current - previous < 25, `expected value jumped at tier ${tier}`);
    previous = current;
  }
});

test('Luck preserves the canonical relative crop weights inside each rarity', () => {
  const crops = baseCropDistribution();
  for (const rarity of RARITY_ORDER) {
    const entries = crops.filter((entry) => entry.seed.rarity === rarity);
    const total = entries.reduce((sum, entry) => sum + entry.units, 0n);
    const shares = entries.map((entry) => ({ id: entry.seed.id, numerator: entry.units, denominator: total }));
    for (const tier of [0, 10, 20, 30, 40, 49]) {
      assert.ok(rarityDistribution(tier)[rarity] >= 0n);
      assert.deepEqual(
        entries.map((entry) => ({ id: entry.seed.id, numerator: entry.units, denominator: total })),
        shares,
      );
    }
  }
});

test('unlimited preview accepts huge whole numbers safely and clamps to the canonical maximum curve', () => {
  const huge = '9'.repeat(2_000);
  assert.deepEqual(previewRarityDistribution(huge), MAX_LUCK_RARITY_UNITS);
  assert.deepEqual(previewRarityDistribution(50n), MAX_LUCK_RARITY_UNITS);
  for (const invalid of ['0', '-1', '1.5', '1e6', 'abc', '', 0, -1, 1.5]) {
    assert.throws(() => previewRarityDistribution(invalid), RangeError, String(invalid));
  }
});

test('manual and automatic rolls consume identical canonical Luck sampling', () => {
  const rng = (maximum) => Math.min(maximum - 1, Math.floor(maximum * 0.42));
  const game = feature({ rng, clock: () => 1_000 });
  game.repository.ensurePlayer('manual');
  game.repository.ensurePlayer('automatic');
  game.db.prepare('UPDATE rng_players SET luck_tier = 10, big_crop_tier = 10 WHERE user_id IN (?, ?)').run('manual', 'automatic');
  fund(game, 'automatic', 288n);
  const manual = game.gameService.roll('manual');
  const preview = game.autoRollService.preview('automatic', '1m', []);
  assert.equal(preview.costPerRoll, 24n);
  const started = game.autoRollService.start('automatic', preview, { guildId: 'guild', channelId: 'channel' });
  const automatic = game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  assert.deepEqual(
    [automatic.item.seedId, automatic.item.weightUnits, automatic.item.value],
    [manual.item.seedId, manual.item.weightUnits, manual.item.value],
  );
  game.close();
});

test('BIG probability and crop output remain exact, and expected value uses the canonical 4x multiplier', () => {
  assert.deepEqual(bigChance(50), { numerator: 50, denominator: 1_000 });
  const seed = FALLBACK_SEED;
  const draws = [20, 0];
  const instance = generateInstance(seed, () => draws.shift(), { bigCropTier: 20 });
  assert.equal(instance.weightUnits, instance.baseWeightUnits * 4);
  assert.equal(instance.value, valueForWeight(seed, instance.baseWeightUnits) * 4n);
  const base = grossExpectedValueFraction(20, 0);
  const withBig = grossExpectedValueFraction(20, 20);
  assert.equal(withBig.numerator * base.denominator * 1_000n, base.numerator * withBig.denominator * 1_060n);
});

test('expected-income prices are exact at checkpoints and strictly increase by at least 1,000', () => {
  const checkpoints = [
    [1, 2_000n, 1_000n],
    [10, 69_000n, 41_000n],
    [20, 1_316_000n, 790_000n],
    [30, 7_825_000n, 4_695_000n],
    [40, 25_858_000n, 15_515_000n],
    [49, 53_935_000n, 32_361_000n],
  ];
  for (const [number, luck, big] of checkpoints) {
    assert.equal(luckUpgradeCost(number - 1), luck);
    assert.equal(bigUpgradeCost(number - 1), big);
  }
  assert.equal(bigUpgradeCost(49), 34_500_000n);
  assert.throws(() => luckUpgradeCost(49), /maximum/);
  assert.throws(() => bigUpgradeCost(50), /maximum/);
  for (let n = 2; n < LUCK_UPGRADE_PRICES.length; n += 1) {
    assert.ok(LUCK_UPGRADE_PRICES[n] >= LUCK_UPGRADE_PRICES[n - 1] + 1_000n, `Luck ${n}`);
  }
  for (let n = 2; n < BIG_UPGRADE_PRICES.length; n += 1) {
    assert.ok(BIG_UPGRADE_PRICES[n] >= BIG_UPGRADE_PRICES[n - 1] + 1_000n, `BIG ${n}`);
  }
  assert.equal(upgradeCost(49), 486_100n);
});

test('Auto Roll preview and refund retain the stored tier-10 snapshot after player tiers change', () => {
  const game = feature({ clock: () => 1_000, rng: (maximum) => maximum - 1 });
  fund(game, 'snapshot', 10_000n);
  game.db.prepare('UPDATE rng_players SET luck_tier = 10, big_crop_tier = 10, inventory_capacity = 1 WHERE user_id = ?')
    .run('snapshot');
  const preview = game.autoRollService.preview('snapshot', '1m', []);
  assert.deepEqual([preview.costPerRoll, preview.totalCost], [24n, 288n]);
  const started = game.autoRollService.start('snapshot', preview, { guildId: 'g', channelId: 'c' });
  assert.deepEqual([started.job.costPerRoll, started.job.costPaid], [24n, 288n]);
  game.autoRollService.processTick(started.job.id, started.job.nextTickAt, started.job.nextTickAt);
  game.db.prepare('UPDATE rng_players SET luck_tier = 49, big_crop_tier = 50 WHERE user_id = ?').run('snapshot');
  const ended = game.autoRollService.processTick(started.job.id, started.job.nextTickAt + 5_000, started.job.nextTickAt + 5_000);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.job.costPerRoll, 24n);
  assert.equal(ended.job.refundPaid, 11n * 24n);
  assert.equal(game.repository.getPlayer('snapshot').balance, 10_000n - 24n);
  game.close();
});

test('Auto Roll re-previews without charging when tiers change before purchase', () => {
  const game = feature({ clock: () => 1_000 });
  fund(game, 'repriced', 10_000n);
  const preview = game.autoRollService.preview('repriced', '1m', []);
  assert.equal(preview.costPerRoll, 5n);
  game.db.prepare('UPDATE rng_players SET luck_tier = 10, big_crop_tier = 10 WHERE user_id = ?').run('repriced');
  const result = game.autoRollService.start('repriced', preview, { guildId: 'g', channelId: 'c' });
  assert.equal(result.status, 'price-changed');
  assert.deepEqual([result.preview.costPerRoll, result.preview.totalCost], [24n, 288n]);
  assert.equal(game.repository.getPlayer('repriced').balance, 10_000n);
  game.close();
});

test('real Luck stops at x50 and BIG stops at exactly 5% without another deduction', () => {
  const game = feature();
  fund(game, 'maxed', 100_000_000n);
  game.db.prepare('UPDATE rng_players SET luck_tier = 48, big_crop_tier = 49 WHERE user_id = ?').run('maxed');
  const luck = game.repository.purchasePowerUpgrade('maxed', 'luck', 'last:luck', luckUpgradeCost, 1);
  const big = game.repository.purchasePowerUpgrade('maxed', 'big', 'last:big', bigUpgradeCost, 2);
  assert.equal(luck.status, 'ok');
  assert.equal(luck.luckTier + 1, MAX_LUCK_MULTIPLIER);
  assert.equal(big.status, 'ok');
  assert.equal(big.bigCropTier, MAX_BIG_CROP_TIER);
  assert.equal(bigChance(big.bigCropTier).numerator / bigChance(big.bigCropTier).denominator, MAX_BIG_CROP_CHANCE);
  const balanceAtMaximum = game.repository.getPlayer('maxed').balance;
  assert.equal(game.repository.purchasePowerUpgrade('maxed', 'luck', 'max:luck', luckUpgradeCost, 3).status, 'max-tier');
  assert.equal(game.repository.purchasePowerUpgrade('maxed', 'big', 'max:big', bigUpgradeCost, 4).status, 'max-tier');
  assert.equal(game.repository.getPlayer('maxed').balance, balanceAtMaximum);
  game.close();
});

test('upgrade UI remains compact and disables maximum-tier purchases', () => {
  const payload = powerUpgradePayload(
    { id: 'user' },
    { balance: 10_000n, luckTier: 0, bigCropTier: 0 },
    { luckActionId: 'luck', bigActionId: 'big', luckCost: 2_000n, bigCost: 1_000n },
  );
  assert.match(payload.components[0].components[1].components[0].content, /Current luck: .1/);
  assert.match(payload.components[0].components[2].components[0].content, /Current: 0%/);

  const maxed = powerUpgradePayload(
    { id: 'user' },
    { balance: 999_999n, luckTier: MAX_LUCK_TIER, bigCropTier: MAX_BIG_CROP_TIER },
    { luckActionId: null, bigActionId: null, luckCost: null, bigCost: null },
  );
  assert.match(maxed.components[0].components[1].components[0].content, /50/);
  assert.match(maxed.components[0].components[2].components[0].content, /Current: 5%/);
  for (const card of maxed.components[0].components.slice(1)) {
    assert.equal(card.accessory.label, 'MAX');
    assert.equal(card.accessory.disabled, true);
  }
  const inventory = upgradePromptPayload({ id: 'inventory', cost: 1_000n }, { balance: 1_000n });
  assert.match(inventory.components[0].components[2].content, /\+10 capacity/);
});

test('probability report covers every tier and uses the same expected values', () => {
  const report = luckProbabilityReport();
  assert.equal(report.length, MAX_LUCK_TIER + 1);
  for (const entry of report) {
    assert.equal(entry.expectedValue, expectedValueForLuckTier(entry.tier));
    assert.equal(entry.probabilities, rarityDistribution(entry.tier));
    assert.ok(autoRollCostPerRoll(entry.tier, Math.min(entry.tier, MAX_BIG_CROP_TIER)) >= 5n);
  }
});
