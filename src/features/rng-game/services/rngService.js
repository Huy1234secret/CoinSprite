const { randomInt } = require('crypto');
const { CHECKED_SEEDS, FALLBACK_SEED } = require('../data/seeds');
const {
  BIG_CROP_CHANCE_DENOMINATOR,
  BIG_CROP_CHANCE_UNITS_PER_TIER,
  MAX_BIG_CROP_TIER,
  MAX_LUCK_TIER,
} = require('../config/upgrades');

const PROBABILITY_SCALE = 1_000_000_000n;
const BIG_CHANCE_BPS_DENOMINATOR = 10_000;
const MAX_EFFECTIVE_BIG_CHANCE_BPS = 1_000;
const MAX_WEIGHT_MULTIPLIER_BPS = 17_500;
const MAX_VALUE_BONUS_BPS = 2_000;
const RARITY_ORDER = Object.freeze([
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic',
  'Secret',
  'Super',
]);
const MAX_LUCK_RARITY_UNITS = Object.freeze({
  Common: 350_000_000n,
  Uncommon: 300_000_000n,
  Rare: 220_000_000n,
  Epic: 108_849_000n,
  Legendary: 20_000_000n,
  Mythic: 1_000_000n,
  Secret: 1_000n,
  Super: 150_000n,
});
const LUCK_INTERPOLATION_MAX_TIER = BigInt(MAX_LUCK_TIER);

if (RARITY_ORDER.reduce((sum, rarity) => sum + MAX_LUCK_RARITY_UNITS[rarity], 0n) !== PROBABILITY_SCALE) {
  throw new Error('Maximum Luck rarity units must total exactly PROBABILITY_SCALE.');
}

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

function addRational(left, right) {
  return rational(
    (left.numerator * right.denominator) + (right.numerator * left.denominator),
    left.denominator * right.denominator,
  );
}

const BASE_RARITY_DISTRIBUTION = Object.freeze(baseRarityDistribution());

function luckProgress(tier) {
  const supplied = typeof tier === 'bigint' ? tier : BigInt(normalizedTier(tier));
  // Preview inputs remain unbounded BigInts, while the canonical smoothstep curve
  // saturates at its explicitly defined tier-49 endpoint instead of extrapolating
  // into negative probability units beyond M.
  const t = supplied < 0n ? 0n : (supplied > LUCK_INTERPOLATION_MAX_TIER ? LUCK_INTERPOLATION_MAX_TIER : supplied);
  const maximum = LUCK_INTERPOLATION_MAX_TIER;
  return Object.freeze({
    numerator: t * t * ((3n * maximum) - (2n * t)),
    denominator: maximum * maximum * maximum,
  });
}

function directLuckDistribution(baseDistribution, tier) {
  const progress = luckProgress(tier);
  const allocated = RARITY_ORDER.map((rarity, index) => {
    const exactNumerator = (baseDistribution[rarity] * (progress.denominator - progress.numerator))
      + (MAX_LUCK_RARITY_UNITS[rarity] * progress.numerator);
    return {
      rarity,
      index,
      units: exactNumerator / progress.denominator,
      remainder: exactNumerator % progress.denominator,
    };
  });
  let missing = PROBABILITY_SCALE - allocated.reduce((sum, entry) => sum + entry.units, 0n);
  const byRemainder = [...allocated].sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    return left.index - right.index;
  });
  for (let index = 0; missing > 0n; index += 1, missing -= 1n) {
    byRemainder[index].units += 1n;
  }
  return Object.freeze(Object.fromEntries(allocated.map((entry) => [entry.rarity, entry.units])));
}

const LUCK_RARITY_DISTRIBUTIONS = Object.freeze(Array.from(
  { length: MAX_LUCK_TIER + 1 },
  (_, tier) => directLuckDistribution(BASE_RARITY_DISTRIBUTION, BigInt(tier)),
));

function rarityTargets(modifier) {
  if (modifier.kind === 'rarity' && RARITY_ORDER.includes(modifier.rarity)) return [modifier.rarity];
  if (modifier.kind !== 'rarity-group') return [];
  const gameplayOrder = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Super', 'Secret'];
  const minimum = gameplayOrder.indexOf(modifier.minimumRarity);
  if (minimum < 0) return [];
  return gameplayOrder.slice(minimum).filter((rarity) => !(modifier.excludeSecret && rarity === 'Secret'));
}

function applyRarityModifiers(distribution, modifiers = [], baseDistribution = BASE_RARITY_DISTRIBUTION) {
  const result = Object.fromEntries(RARITY_ORDER.map((rarity) => [rarity, BigInt(distribution[rarity] || 0n)]));
  const petBase = { ...result };
  for (const modifier of modifiers || []) {
    const numerator = BigInt(modifier.numerator || 1);
    const denominator = BigInt(modifier.denominator || 1);
    if (numerator <= denominator || denominator <= 0n) continue;
    for (const rarity of rarityTargets(modifier)) {
      if (rarity === 'Common') continue;
      const current = result[rarity];
      let desired;
      if (modifier.baseOnly) {
        desired = current + ((baseDistribution[rarity] * (numerator - denominator)) / denominator);
      } else {
        desired = (current * numerator) / denominator;
      }
      if (modifier.phase === 'pet') {
        const petCap = (petBase[rarity] * 150n) / 100n;
        if (desired > petCap) desired = petCap;
      }
      const requested = desired > current ? desired - current : 0n;
      const moved = requested < result.Common ? requested : result.Common;
      result[rarity] += moved;
      result.Common -= moved;
    }
  }
  if (RARITY_ORDER.reduce((sum, rarity) => sum + result[rarity], 0n) !== PROBABILITY_SCALE) {
    throw new Error('Modified rarity units must total exactly PROBABILITY_SCALE.');
  }
  return Object.freeze(result);
}

function rarityDistribution(luckTier = 0, options = {}) {
  const tier = normalizedTier(luckTier);
  const custom = options.checkedSeeds || options.fallbackSeed;
  const base = custom ? baseRarityDistribution(baseCropDistribution(options)) : BASE_RARITY_DISTRIBUTION;
  const luck = custom ? directLuckDistribution(base, BigInt(tier)) : LUCK_RARITY_DISTRIBUTIONS[tier];
  if (!options.rarityModifiers?.length) return luck;
  return applyRarityModifiers(luck, options.rarityModifiers, base);
}

function positiveWholeBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return BigInt(value);
  throw new RangeError('Luck multiplier must be a positive whole number.');
}

function previewRarityDistribution(luckMultiplier = 1n, options = {}) {
  const multiplier = positiveWholeBigInt(luckMultiplier);
  if (multiplier < 1n) throw new RangeError('Luck multiplier must be a positive whole number.');
  const tier = multiplier - 1n;
  const base = options.checkedSeeds || options.fallbackSeed
    ? baseRarityDistribution(baseCropDistribution(options))
    : BASE_RARITY_DISTRIBUTION;
  if (base === BASE_RARITY_DISTRIBUTION) {
    const bounded = tier > LUCK_INTERPOLATION_MAX_TIER ? LUCK_INTERPOLATION_MAX_TIER : tier;
    return LUCK_RARITY_DISTRIBUTIONS[Number(bounded)];
  }
  return directLuckDistribution(base, tier);
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
  const baseBigBps = Math.floor((chance.numerator * BIG_CHANCE_BPS_DENOMINATOR) / chance.denominator);
  const effectiveBigChanceBps = Math.min(
    MAX_EFFECTIVE_BIG_CHANCE_BPS,
    Math.max(0, baseBigBps + Math.floor(Number(options.bigBonusBps) || 0)),
  );
  const isBig = effectiveBigChanceBps > 0
    && checkedRandomInt(rng, BIG_CHANCE_BPS_DENOMINATOR) < effectiveBigChanceBps;
  const weightMultiplierBps = Math.max(0, Math.min(
    MAX_WEIGHT_MULTIPLIER_BPS,
    Math.floor(Number(options.weightMultiplierBps) || 10_000),
  ));
  const weightedBaseUnits = Math.max(0, Math.floor((baseWeightUnits * weightMultiplierBps) / 10_000));
  const valueBonusBps = Math.max(0, Math.min(
    MAX_VALUE_BONUS_BPS,
    Math.floor(Number(options.valueBonusBps) || 0),
  ));
  const weightedValue = valueForWeight(seed, weightedBaseUnits, { clamp: false });
  const baseValue = (weightedValue * BigInt(10_000 + valueBonusBps)) / 10_000n;
  const modifierSnapshot = Object.freeze({
    rarityModifiers: (options.rarityModifiers || []).map((entry) => ({ ...entry })),
    weightMultiplierBps,
    valueBonusBps,
    bigBonusBps: Math.floor(Number(options.bigBonusBps) || 0),
    effectiveBigChanceBps,
    wateringCanItemId: options.wateringCanItemId || null,
    equippedPetInstanceIds: [...(options.equippedPetInstanceIds || [])],
    activeItemIds: [...(options.activeItemIds || [])],
  });
  return {
    seed,
    baseWeightUnits,
    weightedBaseUnits,
    weightUnits: isBig ? weightedBaseUnits * 4 : weightedBaseUnits,
    isBig,
    value: isBig ? baseValue * 4n : baseValue,
    modifierSnapshot,
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

const AVERAGE_VALUE_FRACTIONS = new Map();

function averageValueFractionForSeed(seed) {
  const cached = AVERAGE_VALUE_FRACTIONS.get(seed.id);
  if (cached) return cached;
  const { minimum, maximum } = weightBounds(seed);
  let total = 0n;
  for (let weight = minimum; weight <= maximum; weight += 1) total += valueForWeight(seed, weight);
  const result = rational(total, BigInt(maximum - minimum + 1));
  AVERAGE_VALUE_FRACTIONS.set(seed.id, result);
  return result;
}

const EXPECTED_VALUE_FRACTIONS = new Map();

function expectedValueFractionForLuckTier(luckTier = 0, options = {}) {
  const tier = normalizedTier(luckTier);
  if (!options.checkedSeeds && !options.fallbackSeed && EXPECTED_VALUE_FRACTIONS.has(tier)) {
    return EXPECTED_VALUE_FRACTIONS.get(tier);
  }
  const crops = baseCropDistribution(options);
  const rarities = rarityDistribution(tier, options);
  const rarityBase = baseRarityDistribution(crops);
  const result = crops.reduce((expected, entry) => {
    const average = averageValueFractionForSeed(entry.seed);
    return addRational(expected, rational(
      rarities[entry.seed.rarity] * entry.units * average.numerator,
      PROBABILITY_SCALE * rarityBase[entry.seed.rarity] * average.denominator,
    ));
  }, { numerator: 0n, denominator: 1n });
  if (!options.checkedSeeds && !options.fallbackSeed) EXPECTED_VALUE_FRACTIONS.set(tier, result);
  return result;
}

function expectedValueForLuckTier(luckTier = 0, options = {}) {
  const expected = expectedValueFractionForLuckTier(luckTier, options);
  return Number(expected.numerator) / Number(expected.denominator);
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
  BIG_CHANCE_BPS_DENOMINATOR,
  LUCK_RARITY_DISTRIBUTIONS,
  MAX_BIG_CROP_TIER,
  MAX_LUCK_RARITY_UNITS,
  MAX_LUCK_TIER,
  PROBABILITY_SCALE,
  RARITY_ORDER,
  addRational,
  applyRarityModifiers,
  averageValueForSeed,
  averageValueFractionForSeed,
  baseCropDistribution,
  baseRarityDistribution,
  bigChance,
  cascadingBaseFractions,
  cascadingRoll,
  effectiveChance,
  expectedValueFractionForLuckTier,
  expectedValueForLuckTier,
  fixedPointCropDistribution,
  generateInstance,
  luckProbabilityReport,
  luckProgress,
  previewRarityDistribution,
  rarityDistribution,
  secureRandomInt,
  valueForWeight,
  valueFractionForWeight,
  weightBounds,
};
