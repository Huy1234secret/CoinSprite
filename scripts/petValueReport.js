const assert = require('node:assert/strict');
const { ITEM_BY_ID } = require('../src/features/rng-game/data/items');
const { PETS } = require('../src/features/rng-game/data/pets');
const {
  MAX_EFFECTIVE_BIG_CHANCE_BPS,
  MAX_VALUE_BONUS_BPS,
  MAX_WEIGHT_MULTIPLIER_BPS,
  MIN_COMMON_PROBABILITY_UNITS,
} = require('../src/features/rng-game/services/rngService');
const {
  combinedPetBonuses,
  fractionToNumber,
  personalizedItemPrice,
  subtractFraction,
} = require('../src/features/rng-game/services/shopPricingService');

const CHECKPOINTS = Object.freeze([
  { label: 'Tier 0', luckTier: 0, bigTier: 0 },
  { label: 'Midgame', luckTier: 25, bigTier: 25 },
  { label: 'Maximum', luckTier: 49, bigTier: 50 },
]);
const ROLL_COUNTS = Object.freeze([10_000, 50_000]);

const rows = [];
for (const checkpoint of CHECKPOINTS) {
  for (const pet of PETS) {
    const summary = combinedPetBonuses([pet], checkpoint.luckTier, checkpoint.bigTier);
    const uplift = subtractFraction(summary.boosted.fraction, summary.baseline.fraction);
    assert.ok(uplift.numerator >= 0n, `${pet.id} cannot have negative value`);
    for (const rolls of ROLL_COUNTS) {
      rows.push({
        checkpoint: checkpoint.label,
        pet: pet.displayName,
        rarity: pet.rarity,
        rolls,
        baselineEV: fractionToNumber(summary.baseline.fraction).toFixed(4),
        boostedEV: fractionToNumber(summary.boosted.fraction).toFixed(4),
        addedValue: (fractionToNumber(uplift) * rolls).toFixed(2),
      });
    }
  }
}

const tierZeroBaseline = combinedPetBonuses([], 0, 0).baseline.fraction;
for (const pet of PETS.filter((entry) => entry.rarity === 'Common')) {
  const summary = combinedPetBonuses([pet], 0, 0);
  const relative = fractionToNumber(summary.boosted.fraction) / fractionToNumber(tierZeroBaseline);
  assert.ok(relative < 1.05, `${pet.displayName} must remain a small Common permanent bonus.`);
}

const mythicWeight = PETS.filter((pet) => pet.rarity === 'Mythic')
  .reduce((sum, pet) => sum + pet.hatchWeight, 0);
const expectedEggsForMythic = Math.ceil(10_000 / mythicWeight);
const tierZeroEgg = personalizedItemPrice(ITEM_BY_ID.get('common_egg'), 0, 0);
const expectedMythicAcquisitionCost = tierZeroEgg.price * BigInt(expectedEggsForMythic);
assert.ok(expectedMythicAcquisitionCost >= 100_000_000n, 'Expected Mythic pet acquisition must remain expensive.');

let maximumThreePet = null;
for (const first of PETS) {
  for (const second of PETS) {
    for (const third of PETS) {
      const summary = combinedPetBonuses([first, second, third], 49, 50);
      assert.ok(summary.weightMultiplierBps <= MAX_WEIGHT_MULTIPLIER_BPS);
      assert.ok(summary.valueBonusBps <= MAX_VALUE_BONUS_BPS);
      assert.ok(summary.effectiveBigChanceBps <= MAX_EFFECTIVE_BIG_CHANCE_BPS);
      assert.ok(summary.boosted.rarityUnits.Common >= MIN_COMMON_PROBABILITY_UNITS);
      if (!maximumThreePet || summary.boosted.fraction.numerator * maximumThreePet.fraction.denominator
        > maximumThreePet.fraction.numerator * summary.boosted.fraction.denominator) {
        maximumThreePet = { pets: [first.displayName, second.displayName, third.displayName], fraction: summary.boosted.fraction };
      }
    }
  }
}

console.log('CoinSprite deterministic pet-value report');
console.table(rows);
console.table([{
  mythicHatchChance: `${mythicWeight / 100}%`,
  expectedEggsForMythic,
  tierZeroEggPrice: String(tierZeroEgg.price),
  expectedMythicAcquisitionCost: String(expectedMythicAcquisitionCost),
  maximumThreePetCombination: maximumThreePet.pets.join(' + '),
  maximumTierEV: fractionToNumber(maximumThreePet.fraction).toFixed(4),
}]);
console.log('PASS: Common pets remain small; Mythic acquisition is expensive; every three-slot combination respects all caps.');
