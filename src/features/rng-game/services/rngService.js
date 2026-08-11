const { randomInt } = require('crypto');
const { CHECKED_SEEDS, FALLBACK_SEED } = require('../data/seeds');
const {
  BIG_CROP_CHANCE_DENOMINATOR,
  BIG_CROP_CHANCE_UNITS_PER_TIER,
  MAX_BIG_CROP_TIER,
  MAX_LUCK_TIER,
} = require('../config/upgrades');

const PROBABILITY_SCALE = 1_000_000_000n;
const LUCK_PROMOTION_RARITY_ORDER = Object.freeze([
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic',
  'Super',
]);
const RARITY_ORDER = Object.freeze([
  ...LUCK_PROMOTION_RARITY_ORDER.slice(0, -1),
  'Secret',
  LUCK_PROMOTION_RARITY_ORDER.at(-1),
]);
const RARITY_LUCK_SHARE = Object.freeze({
  Common: 0.50,
  Uncommon: 0.40,
  Rare: 0.35,
  Epic: 0.30,
  Legendary: 0.25,
  Mythic: 0.20,
  Super: 0.10,
});
const LUCK_PROMOTION_STRENGTH = 0.08;
const PROMOTION_RATE_SCALE = 1_000_000n;
const PROMOTION_RATE_UNITS = Object.freeze(Object.fromEntries(LUCK_PROMOTION_RARITY_ORDER.map((rarity) => [
  rarity,
  BigInt(Math.round(LUCK_PROMOTION_STRENGTH * RARITY_LUCK_SHARE[rarity] * Number(PROMOTION_RATE_SCALE))),
])));

function secureRandomInt(maximum) {
  return randomInt(maximum);
}

function normalizedTier(tier, maximum = MAX_LUCK_TIER) {
  return Math.max(0, Math.min(maximum, Math.floor(Number(tier) || 0)));
}

function greatestCommonDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function rational(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('Probability denominator must be positive.');
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function multiplyRational(left, numerator, denominator) {
  return rational(left.numerator * BigInt(numerator), left.denominator * BigInt(denominator));
}

function validateSeedChance(seed) {
  const numerator = Number(seed.chanceNumerator);
  const denominator = Number(seed.chanceDenominator);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)
    || numerator < 0 || denominator <= 0 || numerator > denominator) {
    throw new RangeError(`Invalid rational chance for ${seed.id}.`);
  }
}

function cascadingBaseFractions(checkedSeeds = CHECKED_SEEDS, fallbackSeed = FALLBACK_SEED) {
  let remaining = { numerator: 1n, denominator: 1n };
  const entries = [];
  for (const seed of checkedSeeds) {
    validateSeedChance(seed);
    entries.push({
      seed,
      fraction: multiplyRational(remaining, seed.chanceNumerator, seed.chanceDenominator),
    });
    remaining = multiplyRational(
      remaining,
      seed.chanceDenominator - seed.chanceNumerator,
      seed.chanceDenominator,
    );
  }
  entries.push({ seed: fallbackSeed, fraction: remaining });
  return entries;
}

function fixedPointCropDistribution(checkedSeeds = CHECKED_SEEDS, fallbackSeed = FALLBACK_SEED) {
  const allocated = cascadingBaseFractions(checkedSeeds, fallbackSeed).map((entry, index) => {
    const scaledNumerator = entry.fraction.numerator * PROBABILITY_SCALE;
    return {
      ...entry,
      index,
      units: scaledNumerator / entry.fraction.denominator,
      remainder: scaledNumerator % entry.fraction.denominator,
    };
  });
  let missing = PROBABILITY_SCALE - allocated.reduce((total, entry) => total + entry.units, 0n);
  const byRemainder = [...allocated].sort((left, right) => {
    const comparison = (right.remainder * left.fraction.denominator)
      - (left.remainder * right.fraction.denominator);
    if (comparison > 0n) return 1;
    if (comparison < 0n) return -1;
    return left.index - right.index;
  });
  for (let index = 0; missing > 0n; index += 1, missing -= 1n) {
    byRemainder[index % byRemainder.length].units += 1n;
  }
  return allocated.map(({ seed, fraction, units }) => Object.freeze({ seed, fraction, units }));
}

const BASE_CROP_DISTRIBUTION = Object.freeze(fixedPointCropDistribution());

function baseCropDistribution(options = {}) {
  if (!options.checkedSeeds && !options.fallbackSeed) return BASE_CROP_DISTRIBUTION;
  return fixedPointCropDistribution(
    options.checkedSeeds || CHECKED_SEEDS,
    options.fallbackSeed || FALLBACK_SEED,
  );
}

function baseRarityDistribution(cropDistribution = BASE_CROP_DISTRIBUTION) {
  const distribution = Object.fromEntries(RARITY_ORDER.map((rarity) => [rarity, 0n]));
  for (const entry of cropDistribution) {
    if (!(entry.seed.rarity in distribution)) throw new RangeError(`Unknown rarity: ${entry.seed.rarity}`);
    distribution[entry.seed.rarity] += entry.units;
  }
  return distribution;
}

const BASE_RARITY_DISTRIBUTION = Object.freeze(baseRarityDistribution());
const PROMOTION_STATES = new WeakMap();

function nextLuckPromotionState(current) {
  const next = { ...current };
  for (let index = 0; index < LUCK_PROMOTION_RARITY_ORDER.length - 1; index += 1) {
    const rarity = LUCK_PROMOTION_RARITY_ORDER[index];
    const nextRarity = LUCK_PROMOTION_RARITY_ORDER[index + 1];
    const promoted = (current[rarity] * PROMOTION_RATE_UNITS[rarity]) / PROMOTION_RATE_SCALE;
    next[rarity] -= promoted;
    next[nextRarity] += promoted;
  }
  return Object.freeze(next);
}

function promotionStates(distribution) {
  const cached = PROMOTION_STATES.get(distribution);
  if (cached) return cached;
  // The fixed-point model has finitely many monotonic states. Cache them once so
  // selecting an enormous preview multiplier never does work proportional to its value.
  const states = [Object.freeze({ ...distribution })];
  while (true) {
    const current = states.at(-1);
    const next = nextLuckPromotionState(current);
    if (RARITY_ORDER.every((rarity) => next[rarity] === current[rarity])) break;
    states.push(next);
  }
  const result = Object.freeze(states);
  PROMOTION_STATES.set(distribution, result);
  return result;
}

function promotionTier(value) {
  if (typeof value === 'bigint') return value > 0n ? value : 0n;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value > 0 ? BigInt(value) : 0n;
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return 0n;
}

function applyLuckPromotions(distribution, tiers) {
  const states = promotionStates(distribution);
  const tier = promotionTier(tiers);
  const finalIndex = BigInt(states.length - 1);
  return states[Number(tier >= finalIndex ? finalIndex : tier)];
}

function rarityDistribution(luckTier = 0, options = {}) {
  return applyLuckPromotions(
    options.checkedSeeds || options.fallbackSeed
      ? baseRarityDistribution(baseCropDistribution(options))
      : BASE_RARITY_DISTRIBUTION,
    normalizedTier(luckTier),
  );
}

function previewRarityDistribution(luckMultiplier = 1n, options = {}) {
  const multiplier = promotionTier(luckMultiplier);
  if (multiplier < 1n) throw new RangeError('Luck multiplier must be a positive whole number.');
  return applyLuckPromotions(
    options.checkedSeeds || options.fallbackSeed
      ? baseRarityDistribution(baseCropDistribution(options))
      : BASE_RARITY_DISTRIBUTION,
    multiplier - 1n,
  );
}

function checkedRandomInt(rng, maximum) {
  const limit = typeof maximum === 'bigint' ? Number(maximum) : maximum;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new RangeError(`Invalid RNG maximum: ${maximum}.`);
  const result = rng(limit);
  if (!Number.isSafeInteger(result) || result < 0 || result >= limit) {
    throw new RangeError(`Injected RNG returned ${result} for [0, ${limit}).`);
  }
  return result;
}

function weightedSelection(entries, weightForEntry, rng) {
  const total = entries.reduce((sum, entry) => sum + weightForEntry(entry), 0n);
  let draw = BigInt(checkedRandomInt(rng, total));
  for (const entry of entries) {
    const weight = weightForEntry(entry);
    if (draw < weight) return entry;
    draw -= weight;
  }
  throw new Error('Fixed-point probability selection failed.');
}

function weightBounds(seed) {
  return {
    minimum: Math.round(seed.minimumWeight * 100),
    maximum: Math.round(seed.maximumWeight * 100),
  };
}

function valueFractionForWeight(seed, weightUnits, options = {}) {
  const { minimum, maximum } = weightBounds(seed);
  const supplied = Math.floor(Number(weightUnits));
  const weight = options.clamp === false ? Math.max(0, supplied) : Math.max(minimum, Math.min(maximum, supplied));
  const minimumValue = BigInt(seed.minimumValue);
  const maximumValue = BigInt(seed.maximumValue);
  if (maximum === minimum) return { numerator: minimumValue, denominator: 1n };
  const progressUnits = BigInt(weight - minimum);
  const rangeUnits = BigInt(maximum - minimum);
  return {
    numerator: (minimumValue * rangeUnits) + (progressUnits * (maximumValue - minimumValue)),
    denominator: rangeUnits,
  };
}

function valueForWeight(seed, weightUnits, options = {}) {
  const fraction = valueFractionForWeight(seed, weightUnits, options);
  return fraction.numerator / fraction.denominator;
}

function effectiveChance(seed) {
  return { numerator: seed.chanceNumerator, denominator: seed.chanceDenominator };
}

function bigChance(tier) {
  return {
    numerator: normalizedTier(tier, MAX_BIG_CROP_TIER) * BIG_CROP_CHANCE_UNITS_PER_TIER,
    denominator: BIG_CROP_CHANCE_DENOMINATOR,
  };
}

function generateInstance(seed, rng = secureRandomInt, options = {}) {
  const { minimum, maximum } = weightBounds(seed);
  const baseWeightUnits = minimum + checkedRandomInt(rng, maximum - minimum + 1);
  const chance = bigChance(options.bigCropTier);
  const isBig = chance.numerator > 0 && checkedRandomInt(rng, chance.denominator) < chance.numerator;
  const baseValue = valueForWeight(seed, baseWeightUnits);
  return {
    seed,
    baseWeightUnits,
    weightUnits: isBig ? baseWeightUnits * 4 : baseWeightUnits,
    isBig,
    value: isBig ? baseValue * 4n : baseValue,
  };
}

function cascadingRoll(options = {}) {
  const rng = options.rng || secureRandomInt;
  const crops = baseCropDistribution(options);
  const rarityUnits = rarityDistribution(options.luckTier, options);
  const rarity = weightedSelection(
    RARITY_ORDER.filter((entry) => rarityUnits[entry] > 0n),
    (entry) => rarityUnits[entry],
    rng,
  );
  const candidates = crops.filter((entry) => entry.seed.rarity === rarity && entry.units > 0n);
  const selected = weightedSelection(candidates, (entry) => entry.units, rng);
  return {
    ...generateInstance(selected.seed, rng, options),
    effectiveChance: effectiveChance(selected.seed),
  };
}

function averageValueForSeed(seed) {
  const { minimum, maximum } = weightBounds(seed);
  let total = 0n;
  for (let weight = minimum; weight <= maximum; weight += 1) total += valueForWeight(seed, weight);
  return Number(total) / (maximum - minimum + 1);
}

function expectedValueForLuckTier(luckTier = 0, options = {}) {
  const crops = baseCropDistribution(options);
  const rarities = rarityDistribution(luckTier, options);
  const rarityBase = baseRarityDistribution(crops);
  return crops.reduce((expected, entry) => {
    const rarityProbability = Number(rarities[entry.seed.rarity]) / Number(PROBABILITY_SCALE);
    const withinRarity = Number(entry.units) / Number(rarityBase[entry.seed.rarity]);
    return expected + (rarityProbability * withinRarity * averageValueForSeed(entry.seed));
  }, 0);
}

function luckProbabilityReport() {
  return Array.from({ length: MAX_LUCK_TIER + 1 }, (_, tier) => ({
    tier,
    probabilities: rarityDistribution(tier),
    expectedValue: expectedValueForLuckTier(tier),
  }));
}

module.exports = {
  BASE_CROP_DISTRIBUTION,
  BASE_RARITY_DISTRIBUTION,
  LUCK_PROMOTION_RARITY_ORDER,
  LUCK_PROMOTION_STRENGTH,
  MAX_BIG_CROP_TIER,
  MAX_LUCK_TIER,
  PROBABILITY_SCALE,
  RARITY_LUCK_SHARE,
  RARITY_ORDER,
  applyLuckPromotions,
  averageValueForSeed,
  baseCropDistribution,
  baseRarityDistribution,
  bigChance,
  cascadingBaseFractions,
  cascadingRoll,
  effectiveChance,
  expectedValueForLuckTier,
  fixedPointCropDistribution,
  generateInstance,
  luckProbabilityReport,
  previewRarityDistribution,
  rarityDistribution,
  secureRandomInt,
  valueForWeight,
  valueFractionForWeight,
  weightBounds,
};
