const assert = require('node:assert/strict');
const { ITEMS, ITEM_BY_ID } = require('../src/features/rng-game/data/items');
const { PETS } = require('../src/features/rng-game/data/pets');
const { SEEDS } = require('../src/features/rng-game/data/seeds');
const { AUTO_ROLL_INTERVAL_MS } = require('../src/features/rng-game/utils/autoRoll');
const { economySnapshot } = require('../src/features/rng-game/services/economyService');
const { bigUpgradeCost, luckUpgradeCost } = require('../src/features/rng-game/services/gameService');
const {
  MAX_BIG_CROP_TIER,
  MAX_EFFECTIVE_BIG_CHANCE_BPS,
  MAX_LUCK_TIER,
  MAX_VALUE_BONUS_BPS,
  MAX_WEIGHT_MULTIPLIER_BPS,
  MIN_COMMON_PROBABILITY_UNITS,
  PROBABILITY_SCALE,
  addRational,
  valueForWeight,
  weightBounds,
} = require('../src/features/rng-game/services/rngService');
const {
  balanceCatalogue,
  ceilFraction,
  combinedPetBonuses,
  expectedRollValue,
  fraction,
  fractionToNumber,
  multiplyFraction,
  subtractFraction,
} = require('../src/features/rng-game/services/shopPricingService');

const TIER_CHECKPOINTS = Object.freeze([
  { label: 'Luck/BIG 0/0', luckTier: 0, bigTier: 0 },
  { label: 'Luck/BIG 10/10', luckTier: 10, bigTier: 10 },
  { label: 'Luck/BIG 25/25', luckTier: 25, bigTier: 25 },
  { label: 'Maximum permanent tiers', luckTier: MAX_LUCK_TIER, bigTier: MAX_BIG_CROP_TIER },
]);

const maximumCropValue = (rarity) => BigInt(Math.max(
  ...SEEDS.filter((seed) => seed.rarity === rarity).map((seed) => seed.maximumValue),
));
const NORMAL_SUPER_MAX = maximumCropValue('Super');
const warnings = new Map();

function warn(key, evidence) {
  if (!warnings.has(key)) warnings.set(key, evidence);
}

function decimal(value, places = 2) {
  return fractionToNumber(value).toFixed(places);
}

function probability(units) {
  return `${(Number(units) / 10_000_000).toFixed(6)}%`;
}

function percentBps(bps) {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

function relevantStats(item, quote) {
  if (item.effect.kind === 'rarity' || item.effect.kind === 'rarity-flat') {
    const rarity = item.effect.rarity;
    return {
      current: `${rarity} ${probability(quote.baseline.rarityUnits[rarity])}`,
      boosted: `${rarity} ${probability(quote.boosted.rarityUnits[rarity])}`,
    };
  }
  if (item.effect.kind === 'sprinkler') {
    return {
      current: `weight ×${(quote.baseline.weightMultiplierBps / 10_000).toFixed(2)}; BIG ${percentBps(quote.baseline.effectiveBigChanceBps)}`,
      boosted: `weight ×${(quote.boosted.weightMultiplierBps / 10_000).toFixed(2)}; BIG ${percentBps(quote.boosted.effectiveBigChanceBps)}`,
    };
  }
  if (item.effect.kind === 'watering-can') {
    return {
      current: `next-roll weight ×${(quote.baseline.weightMultiplierBps / 10_000).toFixed(2)}`,
      boosted: `next-roll weight ×${(quote.boosted.weightMultiplierBps / 10_000).toFixed(2)}`,
    };
  }
  return {
    current: 'No pet hatch',
    boosted: '1 random permanent pet (fixed 100% distribution)',
  };
}

function maximumStacking(item) {
  if (item.effect.kind === 'sprinkler') {
    return `one active sprinkler; weight cap ×${(MAX_WEIGHT_MULTIPLIER_BPS / 10_000).toFixed(2)}; BIG cap ${percentBps(MAX_EFFECTIVE_BIG_CHANCE_BPS)}`;
  }
  if (item.effect.kind === 'watering-can') {
    return `charges accumulate; one strength per roll; weight cap ×${(MAX_WEIGHT_MULTIPLIER_BPS / 10_000).toFixed(2)}`;
  }
  if (item.effect.kind === 'egg') {
    return `3 equipped pets; weight cap ×${(MAX_WEIGHT_MULTIPLIER_BPS / 10_000).toFixed(2)}; value cap +${percentBps(MAX_VALUE_BONUS_BPS)}; BIG cap ${percentBps(MAX_EFFECTIVE_BIG_CHANCE_BPS)}`;
  }
  if (item.effect.kind === 'rarity-flat') {
    return 'same item extends duration only; +0.025 percentage points is not multiplied by Luck; Common floor 10%';
  }
  return 'same item extends duration only; one strength multiplier per target rarity; Common floor 10%';
}

function priceToExpectedAddedValue(price, expectedAddedValue) {
  if (expectedAddedValue.numerator <= 0n) return 'n/a';
  return (Number(price) / fractionToNumber(expectedAddedValue)).toFixed(4);
}

function expectedEggPetUpliftPerRoll(luckTier, bigTier) {
  let expected = fraction(0n);
  for (const pet of PETS) {
    const summary = combinedPetBonuses([pet], luckTier, bigTier);
    const uplift = subtractFraction(summary.boosted.fraction, summary.baseline.fraction);
    expected = addRational(expected, multiplyFraction(uplift, BigInt(pet.hatchWeight), 10_000n));
  }
  return expected;
}

function minimumAddedValuePerRoll(item) {
  if (item.effect.kind !== 'sprinkler') return 0n;
  let minimum = null;
  for (const seed of SEEDS) {
    const bounds = weightBounds(seed);
    for (let weight = bounds.minimum; weight <= bounds.maximum; weight += 1) {
      const boostedWeight = Math.floor((weight * item.effect.weightBps) / 10_000);
      const added = valueForWeight(seed, boostedWeight, { clamp: false })
        - valueForWeight(seed, weight, { clamp: false });
      if (minimum == null || added < minimum) minimum = added;
      if (minimum === 0n) return 0n;
    }
  }
  return minimum || 0n;
}

function expectedRestockHours(item) {
  return (5_000 / item.restockChanceBps).toFixed(2);
}

const rows = [];
const upgradeRows = [];
for (const checkpoint of TIER_CHECKPOINTS) {
  const quotes = balanceCatalogue(ITEMS, checkpoint.luckTier, checkpoint.bigTier);
  const economy = economySnapshot(checkpoint.luckTier, checkpoint.bigTier);
  for (const quote of quotes) {
    const item = ITEM_BY_ID.get(quote.itemId);
    const stats = relevantStats(item, quote);
    const probabilityTotal = Object.values(quote.boosted.rarityUnits).reduce((sum, units) => sum + units, 0n);
    if (probabilityTotal !== PROBABILITY_SCALE) {
      warn(`probability:${checkpoint.label}:${item.id}`, `${item.displayName} at ${checkpoint.label}: total ${probabilityTotal}, expected ${PROBABILITY_SCALE}.`);
    }
    if (quote.boosted.rarityUnits.Common < MIN_COMMON_PROBABILITY_UNITS) {
      warn(`common:${checkpoint.label}:${item.id}`, `${item.displayName} at ${checkpoint.label}: Common ${probability(quote.boosted.rarityUnits.Common)} is below ${probability(MIN_COMMON_PROBABILITY_UNITS)}.`);
    }
    if (quote.boosted.effectiveBigChanceBps > MAX_EFFECTIVE_BIG_CHANCE_BPS) {
      warn(`big:${checkpoint.label}:${item.id}`, `${item.displayName} at ${checkpoint.label}: BIG ${percentBps(quote.boosted.effectiveBigChanceBps)} exceeds ${percentBps(MAX_EFFECTIVE_BIG_CHANCE_BPS)}.`);
    }
    if (quote.boosted.weightMultiplierBps > MAX_WEIGHT_MULTIPLIER_BPS) {
      warn(`weight:${checkpoint.label}:${item.id}`, `${item.displayName} at ${checkpoint.label}: weight ×${quote.boosted.weightMultiplierBps / 10_000} exceeds ×${MAX_WEIGHT_MULTIPLIER_BPS / 10_000}.`);
    }
    const derivedAffectedRolls = item.durationMs > 0
      ? Math.floor(item.durationMs / AUTO_ROLL_INTERVAL_MS)
      : item.effect.kind === 'watering-can' ? 1 : 0;
    assert.equal(item.affectedRolls, derivedAffectedRolls, `${item.id} affected rolls must follow Auto Roll frequency`);

    const guaranteedUplift = minimumAddedValuePerRoll(item) * quote.affectedRolls;
    if (item.durationMs > 0 && guaranteedUplift >= item.price) {
      warn(
        `loop:${checkpoint.label}:${item.id}`,
        `${item.displayName} at ${checkpoint.label}: conservative guaranteed uplift ${guaranteedUplift} >= fixed price ${item.price}.`,
      );
    }
    const expectedAddedValue = item.effect.kind === 'egg'
      ? expectedEggPetUpliftPerRoll(checkpoint.luckTier, checkpoint.bigTier)
      : quote.expectedUplift;
    rows.push({
      checkpoint: checkpoint.label,
      item: item.displayName,
      currentStat: stats.current,
      boostedStat: stats.boosted,
      expectedAffectedRolls: item.effect.kind === 'egg' ? 'per equipped roll (permanent)' : String(quote.affectedRolls),
      expectedAddedCropValue: item.effect.kind === 'egg'
        ? `${decimal(expectedAddedValue, 6)} per equipped roll`
        : decimal(expectedAddedValue),
      fixedPrice: String(item.price),
      priceDividedByExpectedAddedValue: priceToExpectedAddedValue(item.price, expectedAddedValue),
      expectedRestockHours: expectedRestockHours(item),
      maximumPossibleStacking: maximumStacking(item),
      autoRollCostPerRoll: String(economy.costPerRoll),
    });
  }

  const baseline = expectedRollValue(checkpoint.luckTier, checkpoint.bigTier);
  for (const kind of ['Luck', 'BIG']) {
    const atMaximum = kind === 'Luck'
      ? checkpoint.luckTier >= MAX_LUCK_TIER
      : checkpoint.bigTier >= MAX_BIG_CROP_TIER;
    if (atMaximum) {
      upgradeRows.push({ checkpoint: checkpoint.label, upgrade: kind, cost: 'MAX', marginalEV: 'MAX', breakEvenRolls: 'MAX' });
      continue;
    }
    const upgraded = kind === 'Luck'
      ? expectedRollValue(checkpoint.luckTier + 1, checkpoint.bigTier)
      : expectedRollValue(checkpoint.luckTier, checkpoint.bigTier + 1);
    const marginal = subtractFraction(upgraded.fraction, baseline.fraction);
    const cost = kind === 'Luck'
      ? luckUpgradeCost(checkpoint.luckTier)
      : bigUpgradeCost(checkpoint.bigTier);
    assert.ok(marginal.numerator > 0n, `${kind} upgrade must retain positive permanent expected value.`);
    assert.ok(cost > 0n, `${kind} upgrade price must remain positive.`);
    upgradeRows.push({
      checkpoint: checkpoint.label,
      upgrade: kind,
      cost: String(cost),
      marginalEV: decimal(marginal, 6),
      breakEvenRolls: String(ceilFraction(fraction(
        cost * marginal.denominator,
        marginal.numerator,
      ))),
    });
  }
}

const secret = ITEM_BY_ID.get('secret_mushroom');
if (NORMAL_SUPER_MAX >= secret.price) {
  warn('normal-super-secret', `Normal maximum-value Super crop ${NORMAL_SUPER_MAX} can buy Secret Mushroom ${secret.price}.`);
}

const superMushroom = ITEM_BY_ID.get('super_mushroom');
const legendaryMushroom = ITEM_BY_ID.get('legendary_mushroom');
if (superMushroom.price <= legendaryMushroom.price
  || superMushroom.effect.numerator / superMushroom.effect.denominator
    <= legendaryMushroom.effect.numerator / legendaryMushroom.effect.denominator
  || superMushroom.restockChanceBps >= legendaryMushroom.restockChanceBps) {
  warn('super-mushroom-order', `Super Mushroom price/effect/restock ${superMushroom.price}/${superMushroom.effect.numerator}x/${superMushroom.restockChanceBps}bps is not strictly above/stronger/scarcer than Legendary ${legendaryMushroom.price}/${legendaryMushroom.effect.numerator}x/${legendaryMushroom.restockChanceBps}bps.`);
}

const superSprinkler = ITEM_BY_ID.get('super_sprinkler');
const legendarySprinkler = ITEM_BY_ID.get('legendary_sprinkler');
if (superSprinkler.price <= legendarySprinkler.price
  || superSprinkler.effect.weightBps <= legendarySprinkler.effect.weightBps
  || superSprinkler.effect.bigBonusBps <= legendarySprinkler.effect.bigBonusBps
  || superSprinkler.restockChanceBps >= legendarySprinkler.restockChanceBps) {
  warn('super-sprinkler-order', `Super Sprinkler price/weight/BIG/restock ${superSprinkler.price}/${superSprinkler.effect.weightBps}/${superSprinkler.effect.bigBonusBps}/${superSprinkler.restockChanceBps}bps is not strictly above/stronger/scarcer than Legendary ${legendarySprinkler.price}/${legendarySprinkler.effect.weightBps}/${legendarySprinkler.effect.bigBonusBps}/${legendarySprinkler.restockChanceBps}bps.`);
}

const petRarityWeights = PETS.reduce((totals, pet) => {
  totals[pet.rarity] = (totals[pet.rarity] || 0) + pet.hatchWeight;
  return totals;
}, {});
const expectedPetRarityWeights = { Common: 6_000, Uncommon: 1_800, Rare: 1_600, Legendary: 400, Mythic: 200 };
const petWeightTotal = PETS.reduce((sum, pet) => sum + pet.hatchWeight, 0);
if (petWeightTotal !== 10_000) warn('pet-total', `Pet hatch weights total ${petWeightTotal}bps, expected 10,000bps.`);
for (const [rarity, expected] of Object.entries(expectedPetRarityWeights)) {
  if (petRarityWeights[rarity] !== expected) {
    warn(`pet-rarity:${rarity}`, `${rarity} hatch weight is ${petRarityWeights[rarity]}bps, expected ${expected}bps.`);
  }
}

const eggPrice = ITEM_BY_ID.get('common_egg').price;
const eggAcquisitionRows = Object.entries({ Rare: 1_600n, Legendary: 400n, Mythic: 200n }).map(([rarity, weight]) => ({
  rarity,
  aggregateChance: `${Number(weight) / 100}%`,
  theoreticalAveragePurchaseCost: String((eggPrice * 10_000n) / weight),
}));
assert.deepEqual(
  eggAcquisitionRows.map((row) => row.theoreticalAveragePurchaseCost),
  ['12500000', '50000000', '100000000'],
  'Common Egg theoretical acquisition costs must match the fixed 2,000,000-Sheckle price',
);

console.log('CoinSprite fixed-price Shop balance report');
console.table(rows);
console.log('Permanent upgrade economy checkpoints');
console.table(upgradeRows);
console.log('Common Egg fixed-point rarity acquisition averages (averages, not guarantees; no pity)');
console.table(eggAcquisitionRows);
console.log(`Normal maximum-value Super crop: ${NORMAL_SUPER_MAX}; Secret Mushroom fixed price: ${secret.price}.`);
if (warnings.size) {
  console.error(`WARNINGS: ${warnings.size}`);
  for (const evidence of warnings.values()) console.error(`- ${evidence}`);
  process.exitCode = 1;
} else {
  console.log('WARNINGS: none');
  console.log('PASS: fixed prices, tier ordering, restock scarcity, probabilities, Common floor, BIG cap, weight cap, and conservative money-loop checks are valid.');
}
