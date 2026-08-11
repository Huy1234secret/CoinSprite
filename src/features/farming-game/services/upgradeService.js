const MAX_FARMING_LUCK_TIER = 49;
const MAX_FARMING_BIG_CROP_TIER = 50;
const BIG_CROP_CHANCE_DENOMINATOR = 1_000n;

function normalizedTier(value, maximum) {
  const tier = Math.floor(Number(value) || 0);
  return Math.max(0, Math.min(maximum, tier));
}

function farmingLuckMultiplier(tier) {
  return BigInt(normalizedTier(tier, MAX_FARMING_LUCK_TIER) + 1);
}

function farmingBigCropChance(tier) {
  return {
    numerator: BigInt(normalizedTier(tier, MAX_FARMING_BIG_CROP_TIER)),
    denominator: BIG_CROP_CHANCE_DENOMINATOR,
  };
}

function farmingLuckUpgradeCost(tier) {
  const current = BigInt(normalizedTier(tier, MAX_FARMING_LUCK_TIER));
  return 10n * ((13n * current * current) + (13n * current) + 10n);
}

function farmingBigCropUpgradeCost(tier) {
  const current = BigInt(normalizedTier(tier, MAX_FARMING_BIG_CROP_TIER));
  return 20n * ((27n * current * current) + (20n * current) + 25n);
}

function farmingUpgradeState(profile = {}) {
  const luckTier = normalizedTier(profile.luckTier, MAX_FARMING_LUCK_TIER);
  const bigCropTier = normalizedTier(profile.bigCropTier, MAX_FARMING_BIG_CROP_TIER);
  return Object.freeze({
    luckTier,
    luckMultiplier: farmingLuckMultiplier(luckTier),
    luckMaximum: luckTier >= MAX_FARMING_LUCK_TIER,
    luckCost: luckTier >= MAX_FARMING_LUCK_TIER ? null : farmingLuckUpgradeCost(luckTier),
    bigCropTier,
    bigCropChance: farmingBigCropChance(bigCropTier),
    bigCropMaximum: bigCropTier >= MAX_FARMING_BIG_CROP_TIER,
    bigCropCost: bigCropTier >= MAX_FARMING_BIG_CROP_TIER ? null : farmingBigCropUpgradeCost(bigCropTier),
  });
}

module.exports = {
  BIG_CROP_CHANCE_DENOMINATOR,
  MAX_FARMING_BIG_CROP_TIER,
  MAX_FARMING_LUCK_TIER,
  farmingBigCropChance,
  farmingBigCropUpgradeCost,
  farmingLuckMultiplier,
  farmingLuckUpgradeCost,
  farmingUpgradeState,
  normalizedTier,
};
