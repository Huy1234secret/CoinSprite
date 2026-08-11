const {
  PROBABILITY_SCALE,
  RARITY_ORDER,
  luckProbabilityReport,
} = require('../src/features/rng-game/services/rngService');
const {
  DAILY_AUTO_ROLLS,
  economySnapshot,
  targetHours,
} = require('../src/features/rng-game/services/economyService');
const {
  bigUpgradeCost,
  luckUpgradeCost,
} = require('../src/features/rng-game/services/gameService');
const { MAX_BIG_CROP_TIER, MAX_LUCK_TIER } = require('../src/features/rng-game/config/upgrades');

function percent(units) {
  return `${((Number(units) * 100) / Number(PROBABILITY_SCALE)).toFixed(6)}%`;
}

function money(value) {
  return typeof value === 'bigint' ? value.toString() : value.toFixed(2);
}

function rngEconomyReport() {
  return luckProbabilityReport().map(({ tier, probabilities, expectedValue }) => {
    const bigTier = Math.min(tier, MAX_BIG_CROP_TIER);
    const economy = economySnapshot(tier, bigTier);
    const upgradeNumber = tier + 1;
    const hours = targetHours(upgradeNumber);
    return {
      Tier: tier,
      'BIG tier': bigTier,
      ...Object.fromEntries(RARITY_ORDER.map((rarity) => [rarity, percent(probabilities[rarity])])),
      'Expected base': expectedValue.toFixed(2),
      'BIG-adjusted expected': economy.grossExpectedValue.toFixed(2),
      'Auto cost/roll': economy.costPerRoll.toString(),
      '24h auto cost': economy.dailyCost.toString(),
      'Gross/day': economy.grossDailyIncome.toFixed(2),
      'Net/day': economy.netDailyIncome.toFixed(2),
      'Next Luck price': tier < MAX_LUCK_TIER ? money(luckUpgradeCost(tier)) : 'unavailable',
      'Next BIG price': tier < MAX_BIG_CROP_TIER ? money(bigUpgradeCost(tier)) : 'unavailable',
      'Target rolls': (hours * 720).toFixed(2),
      'Target hours': hours.toFixed(3),
      'Rolls/day': DAILY_AUTO_ROLLS.toString(),
    };
  });
}

if (require.main === module) console.table(rngEconomyReport());

module.exports = { rngEconomyReport };
