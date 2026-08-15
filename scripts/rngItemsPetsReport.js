const assert = require('node:assert/strict');
const { ITEMS } = require('../src/features/rng-game/data/items');
const { PETS } = require('../src/features/rng-game/data/pets');
const { MAX_BIG_CROP_TIER, MAX_LUCK_TIER, PROBABILITY_SCALE, rarityDistribution } = require('../src/features/rng-game/services/rngService');
const { economySnapshot } = require('../src/features/rng-game/services/economyService');

const tiers = [0, 10, 25, 'maximum'].map((label) => {
  const luckTier = label === 'maximum' ? MAX_LUCK_TIER : label;
  const bigTier = label === 'maximum' ? MAX_BIG_CROP_TIER : label;
  const snapshot = economySnapshot(luckTier, bigTier);
  const distribution = rarityDistribution(luckTier);
  assert.equal(Object.values(distribution).reduce((sum, units) => sum + units, 0n), PROBABILITY_SCALE);
  return {
    tier: label,
    luckTier,
    bigTier,
    grossExpectedValue: Number(snapshot.grossExpectedValue.toFixed(4)),
    autoRollCost: String(snapshot.costPerRoll),
    netExpectedValue: Number((snapshot.grossExpectedValue - Number(snapshot.costPerRoll)).toFixed(4)),
  };
});

assert.equal(PETS.reduce((sum, pet) => sum + pet.hatchWeight, 0), 10_000);
assert.equal(ITEMS.length, 14);
assert.ok(ITEMS.every((item) => item.price > 0n && item.restockChanceBps > 0));
assert.ok(PETS.every((pet) => pet.hatchWeight > 0 && pet.perk && pet.effect.kind));

console.log('CoinSprite RNG balance report');
console.table(tiers);
console.log(JSON.stringify({
  itemCount: ITEMS.length,
  petCount: PETS.length,
  petHatchWeightBps: PETS.reduce((sum, pet) => sum + pet.hatchWeight, 0),
  caps: {
    perRarityPetMultiplier: '1.50x',
    petValueBonus: '20%',
    combinedWeightMultiplier: '2.50x',
    effectiveBigChance: '15%',
    commonProbabilityFloor: '10%',
  },
  tiers,
}, null, 2));
