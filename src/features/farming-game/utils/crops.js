const { randomInt, randomUUID } = require('crypto');
const { farmingBigCropChance } = require('../services/upgradeService');

const CARROT_CONFIG = Object.freeze({
  minimumWeight: 0.20,
  maximumWeight: 0.80,
  minimumWeightUnits: 20,
  maximumWeightUnits: 80,
  minimumValue: 2,
  maximumValue: 12,
  rarity: 'Common',
});

function secureRandomInt(maximum) {
  return randomInt(maximum);
}

function injectedRandomInt(rng, maximum) {
  const value = Number(rng(maximum));
  if (!Number.isInteger(value) || value < 0 || value >= maximum) {
    throw new RangeError(`Injected Farming RNG must return an integer from 0 through ${maximum - 1}.`);
  }
  return value;
}

function carrotValueForWeight(weightUnits) {
  const weight = Number(weightUnits);
  const {
    minimumWeightUnits,
    maximumWeightUnits,
    minimumValue,
    maximumValue,
  } = CARROT_CONFIG;
  if (!Number.isInteger(weight) || weight < minimumWeightUnits || weight > maximumWeightUnits) {
    throw new RangeError(`Carrot weight must be between ${minimumWeightUnits} and ${maximumWeightUnits}.`);
  }
  return minimumValue + Math.floor(
    ((weight - minimumWeightUnits) * (maximumValue - minimumValue))
      / (maximumWeightUnits - minimumWeightUnits),
  );
}

function rollBigCrop(tier, rng = secureRandomInt) {
  const chance = farmingBigCropChance(tier);
  if (chance.numerator <= 0n) return false;
  return BigInt(injectedRandomInt(rng, Number(chance.denominator))) < chance.numerator;
}

function generateCarrot(rng = secureRandomInt, idGenerator = randomUUID, options = {}) {
  const range = CARROT_CONFIG.maximumWeightUnits - CARROT_CONFIG.minimumWeightUnits + 1;
  const offset = injectedRandomInt(rng, range);
  const baseWeightUnits = CARROT_CONFIG.minimumWeightUnits + offset;
  const baseStoredValue = carrotValueForWeight(baseWeightUnits);
  const seedRotationDegrees = injectedRandomInt(rng, 360);
  const isBig = rollBigCrop(options.bigCropTier, rng);
  return {
    id: String(idGenerator()),
    cropId: 'carrot',
    rarity: CARROT_CONFIG.rarity,
    weightUnits: isBig ? baseWeightUnits * 4 : baseWeightUnits,
    storedValue: isBig ? baseStoredValue * 4 : baseStoredValue,
    seedRotationDegrees,
    isBig,
  };
}

function carrotWeightScale(weightUnits) {
  const numericWeight = Number(weightUnits);
  const weight = Math.max(
    CARROT_CONFIG.minimumWeightUnits,
    Math.min(
      CARROT_CONFIG.maximumWeightUnits,
      Number.isFinite(numericWeight) ? numericWeight : CARROT_CONFIG.minimumWeightUnits,
    ),
  );
  const progress = (weight - CARROT_CONFIG.minimumWeightUnits)
    / (CARROT_CONFIG.maximumWeightUnits - CARROT_CONFIG.minimumWeightUnits);
  return 0.90 + (progress * 0.25);
}

function formatCarrotWeight(weightUnits) {
  return (Number(weightUnits) / 100).toFixed(2);
}

module.exports = {
  CARROT_CONFIG,
  carrotValueForWeight,
  carrotWeightScale,
  formatCarrotWeight,
  generateCarrot,
  injectedRandomInt,
  rollBigCrop,
};
