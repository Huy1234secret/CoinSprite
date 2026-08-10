const { SEED_BY_ID } = require('../data/seeds');

const STAT_RARITY_ORDER = Object.freeze([
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic',
  'Super',
  'Secret',
]);
const STAT_RARITY_RANK = new Map(STAT_RARITY_ORDER.map((rarity, index) => [rarity, index]));

function seedAverageValue(seed) {
  return BigInt(seed.minimumValue) + BigInt(seed.maximumValue);
}

function compareBestSeeds(left, right) {
  const rankDifference = (STAT_RARITY_RANK.get(right.rarity) ?? -1)
    - (STAT_RARITY_RANK.get(left.rarity) ?? -1);
  if (rankDifference) return rankDifference;

  const leftChance = BigInt(left.chanceNumerator) * BigInt(right.chanceDenominator);
  const rightChance = BigInt(right.chanceNumerator) * BigInt(left.chanceDenominator);
  if (leftChance !== rightChance) return leftChance < rightChance ? -1 : 1;

  const leftAverage = seedAverageValue(left);
  const rightAverage = seedAverageValue(right);
  if (leftAverage !== rightAverage) return leftAverage > rightAverage ? -1 : 1;
  return left.id.localeCompare(right.id);
}

function bestDiscoveredSeed(discoveries) {
  const discoveredSeeds = [...new Set((discoveries || []).map((entry) => entry.seedId || entry))]
    .map((seedId) => SEED_BY_ID.get(String(seedId)))
    .filter(Boolean);
  discoveredSeeds.sort(compareBestSeeds);
  return discoveredSeeds[0] || null;
}

function statisticsModel(aggregate, discoveries, cropStatistics) {
  const bestSeed = bestDiscoveredSeed(discoveries);
  const cropBySeed = new Map((cropStatistics || []).map((entry) => [entry.seedId, entry]));
  return Object.freeze({
    totalRolls: BigInt(aggregate?.totalRolls || 0),
    autoRolls: BigInt(aggregate?.autoRolls || 0),
    highestRarity: bestSeed?.rarity || null,
    bestSeed,
    bestSeedHighestWeightUnits: Number(cropBySeed.get(bestSeed?.id)?.highestWeightUnits || 0),
    highestWeightUnits: Number(aggregate?.highestWeightUnits || 0),
    totalSaleEarnings: BigInt(aggregate?.totalSaleEarnings || 0),
    highestSingleSale: BigInt(aggregate?.highestSingleSale || 0),
  });
}

module.exports = {
  STAT_RARITY_ORDER,
  bestDiscoveredSeed,
  compareBestSeeds,
  statisticsModel,
};
