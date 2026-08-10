const {
  PROBABILITY_SCALE,
  RARITY_ORDER,
  luckProbabilityReport,
} = require('../src/features/rng-game/services/rngService');

const rows = luckProbabilityReport().map(({ tier, probabilities, expectedValue }) => ({
  Tier: tier,
  ...Object.fromEntries(RARITY_ORDER.map((rarity) => [
    rarity,
    `${((Number(probabilities[rarity]) * 100) / Number(PROBABILITY_SCALE)).toFixed(6)}%`,
  ])),
  'Expected Sheckles': expectedValue.toFixed(2),
}));

console.table(rows);
