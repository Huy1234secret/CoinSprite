const { randomInt, randomUUID } = require('crypto');

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

function generateCarrot(rng = secureRandomInt, idGenerator = randomUUID) {
  const range = CARROT_CONFIG.maximumWeightUnits - CARROT_CONFIG.minimumWeightUnits + 1;
  const offset = Number(rng(range));
  if (!Number.isInteger(offset) || offset < 0 || offset >= range) {
    throw new RangeError(`Injected Farming RNG must return an integer from 0 through ${range - 1}.`);
  }
  const weightUnits = CARROT_CONFIG.minimumWeightUnits + offset;
  return {
    id: String(idGenerator()),
    cropId: 'carrot',
    rarity: CARROT_CONFIG.rarity,
    weightUnits,
    storedValue: carrotValueForWeight(weightUnits),
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
};
