const { randomInt } = require('crypto');
const { CHECKED_SEEDS, FALLBACK_SEED } = require('../data/seeds');

function secureRandomInt(maximum) {
  return randomInt(maximum);
}

function weightBounds(seed) {
  return {
    minimum: Math.round(seed.minimumWeight * 100),
    maximum: Math.round(seed.maximumWeight * 100),
  };
}

function valueForWeight(seed, weightUnits) {
  const { minimum, maximum } = weightBounds(seed);
  const weight = Math.max(minimum, Math.min(maximum, Math.floor(Number(weightUnits))));
  const minimumValue = BigInt(seed.minimumValue);
  const maximumValue = BigInt(seed.maximumValue);
  if (maximum === minimum) return minimumValue;
  const progressUnits = BigInt(weight - minimum);
  const rangeUnits = BigInt(maximum - minimum);
  return minimumValue + (progressUnits * (maximumValue - minimumValue)) / rangeUnits;
}

function generateInstance(seed, rng = secureRandomInt) {
  const { minimum, maximum } = weightBounds(seed);
  const weightUnits = minimum + rng(maximum - minimum + 1);
  return { seed, weightUnits, value: valueForWeight(seed, weightUnits) };
}

function cascadingRoll(options = {}) {
  const rng = options.rng || secureRandomInt;
  const checkedSeeds = options.checkedSeeds || CHECKED_SEEDS;
  const fallbackSeed = options.fallbackSeed || FALLBACK_SEED;
  for (const seed of checkedSeeds) {
    const result = rng(seed.chanceDenominator);
    if (!Number.isSafeInteger(result) || result < 0 || result >= seed.chanceDenominator) {
      throw new RangeError(`Injected RNG returned ${result} for [0, ${seed.chanceDenominator}).`);
    }
    if (result < seed.chanceNumerator) return generateInstance(seed, rng);
  }
  return generateInstance(fallbackSeed, rng);
}

module.exports = { cascadingRoll, generateInstance, secureRandomInt, valueForWeight, weightBounds };
