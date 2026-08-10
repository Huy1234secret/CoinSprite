const { randomInt } = require('crypto');
const { CHECKED_SEEDS, FALLBACK_SEED } = require('../data/seeds');

const LUCK_SCALE = 1_000_000_000;

function secureRandomInt(maximum) {
  return randomInt(maximum);
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

function luckMultiplier(tier) {
  return 1 + Math.max(0, Math.floor(Number(tier) || 0));
}

function effectiveChance(seed, luckTier = 0) {
  if (seed.fallback || !luckTier) {
    return { numerator: seed.chanceNumerator, denominator: seed.chanceDenominator };
  }
  const baseChance = seed.chanceNumerator / seed.chanceDenominator;
  const chance = Math.min(1.0, baseChance * luckMultiplier(luckTier));
  const numerator = Math.max(1, Math.min(LUCK_SCALE, Math.floor(chance * LUCK_SCALE)));
  return { numerator, denominator: LUCK_SCALE };
}

function bigChance(tier) {
  const normalized = Math.max(0, Math.min(500, Math.floor(Number(tier) || 0)));
  return { numerator: normalized, denominator: 500 };
}

function generateInstance(seed, rng = secureRandomInt, options = {}) {
  const { minimum, maximum } = weightBounds(seed);
  const baseWeightUnits = minimum + rng(maximum - minimum + 1);
  const chance = bigChance(options.bigCropTier);
  const isBig = chance.numerator > 0 && rng(chance.denominator) < chance.numerator;
  const weightUnits = isBig ? baseWeightUnits * 4 : baseWeightUnits;
  return {
    seed,
    baseWeightUnits,
    weightUnits,
    isBig,
    value: valueForWeight(seed, weightUnits, { clamp: !isBig }),
  };
}

function cascadingRoll(options = {}) {
  const rng = options.rng || secureRandomInt;
  const checkedSeeds = options.checkedSeeds || CHECKED_SEEDS;
  const fallbackSeed = options.fallbackSeed || FALLBACK_SEED;
  for (const seed of checkedSeeds) {
    const chance = effectiveChance(seed, options.luckTier);
    const result = rng(chance.denominator);
    if (!Number.isSafeInteger(result) || result < 0 || result >= chance.denominator) {
      throw new RangeError(`Injected RNG returned ${result} for [0, ${chance.denominator}).`);
    }
    if (result < chance.numerator) {
      return { ...generateInstance(seed, rng, options), effectiveChance: chance };
    }
  }
  return {
    ...generateInstance(fallbackSeed, rng, options),
    effectiveChance: { numerator: fallbackSeed.chanceNumerator, denominator: fallbackSeed.chanceDenominator },
  };
}

module.exports = {
  LUCK_SCALE,
  bigChance,
  cascadingRoll,
  effectiveChance,
  generateInstance,
  luckMultiplier,
  secureRandomInt,
  valueForWeight,
  valueFractionForWeight,
  weightBounds,
};
