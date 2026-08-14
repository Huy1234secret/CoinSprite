const {
  MAX_EFFECTIVE_BIG_CHANCE_BPS,
  MAX_VALUE_BONUS_BPS,
  MAX_WEIGHT_MULTIPLIER_BPS,
  PROBABILITY_SCALE,
  addRational,
  baseCropDistribution,
  baseRarityDistribution,
  bigChance,
  rarityDistribution,
  valueForWeight,
  weightBounds,
} = require('./rngService');

const PRICE_SCALE_BPS = 10_000n;
const ROLLS_PER_30_MINUTES = 360n;
const ROLLS_PER_HOUR = 720n;
const weightedAverageCache = new Map();

function greatestCommonDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function fraction(numerator, denominator = 1n) {
  const top = BigInt(numerator);
  const bottom = BigInt(denominator);
  if (bottom <= 0n) throw new RangeError('Pricing fraction denominator must be positive.');
  const divisor = greatestCommonDivisor(top, bottom);
  return Object.freeze({ numerator: top / divisor, denominator: bottom / divisor });
}

function multiplyFraction(value, numerator, denominator = 1n) {
  return fraction(value.numerator * BigInt(numerator), value.denominator * BigInt(denominator));
}

function subtractFraction(left, right) {
  return fraction(
    (left.numerator * right.denominator) - (right.numerator * left.denominator),
    left.denominator * right.denominator,
  );
}

function ceilFraction(value) {
  if (value.numerator <= 0n) return 0n;
  return (value.numerator + value.denominator - 1n) / value.denominator;
}

function fractionToNumber(value) {
  return Number(value.numerator) / Number(value.denominator);
}

function niceRoundUp(value) {
  const amount = BigInt(value);
  if (amount <= 0n) return 0n;
  let increment;
  if (amount < 100_000n) increment = 1_000n;
  else if (amount < 1_000_000n) increment = 10_000n;
  else if (amount < 10_000_000n) increment = 50_000n;
  else increment = 100_000n;
  return ((amount + increment - 1n) / increment) * increment;
}

function normalizedBps(value, fallback, maximum) {
  const supplied = Math.floor(Number(value));
  if (!Number.isFinite(supplied)) return fallback;
  return Math.max(0, Math.min(maximum, supplied));
}

function averageWeightedValueFractionForSeed(seed, weightMultiplierBps = 10_000, valueBonusBps = 0) {
  const multiplier = normalizedBps(weightMultiplierBps, 10_000, MAX_WEIGHT_MULTIPLIER_BPS);
  const bonus = normalizedBps(valueBonusBps, 0, MAX_VALUE_BONUS_BPS);
  const key = `${seed.id}:${multiplier}:${bonus}`;
  if (weightedAverageCache.has(key)) return weightedAverageCache.get(key);
  const { minimum, maximum } = weightBounds(seed);
  let total = 0n;
  for (let weight = minimum; weight <= maximum; weight += 1) {
    const adjusted = Math.floor((weight * multiplier) / 10_000);
    const weightedValue = valueForWeight(seed, adjusted, { clamp: false });
    total += (weightedValue * BigInt(10_000 + bonus)) / 10_000n;
  }
  const result = fraction(total, BigInt(maximum - minimum + 1));
  weightedAverageCache.set(key, result);
  return result;
}

function expectedRollValue(luckTier = 0, bigTier = 0, options = {}) {
  const weightMultiplierBps = normalizedBps(
    options.weightMultiplierBps,
    10_000,
    MAX_WEIGHT_MULTIPLIER_BPS,
  );
  const valueBonusBps = normalizedBps(options.valueBonusBps, 0, MAX_VALUE_BONUS_BPS);
  const crops = baseCropDistribution();
  const rarityUnits = rarityDistribution(luckTier, { rarityModifiers: options.rarityModifiers || [] });
  const rarityBase = baseRarityDistribution(crops);
  let expected = { numerator: 0n, denominator: 1n };
  for (const entry of crops) {
    const average = averageWeightedValueFractionForSeed(entry.seed, weightMultiplierBps, valueBonusBps);
    expected = addRational(expected, fraction(
      rarityUnits[entry.seed.rarity] * entry.units * average.numerator,
      PROBABILITY_SCALE * rarityBase[entry.seed.rarity] * average.denominator,
    ));
  }
  const permanentBig = bigChance(bigTier);
  const permanentBigBps = Math.floor((permanentBig.numerator * 10_000) / permanentBig.denominator);
  const effectiveBigChanceBps = Math.min(
    MAX_EFFECTIVE_BIG_CHANCE_BPS,
    Math.max(0, permanentBigBps + Math.floor(Number(options.bigBonusBps) || 0)),
  );
  expected = multiplyFraction(expected, 10_000n + (3n * BigInt(effectiveBigChanceBps)), 10_000n);
  return Object.freeze({
    fraction: expected,
    rarityUnits,
    permanentBigChanceBps: permanentBigBps,
    effectiveBigChanceBps,
    weightMultiplierBps,
    valueBonusBps,
  });
}

function effectOptionsForItem(item) {
  const effect = item.effect || {};
  if (effect.kind === 'rarity' || effect.kind === 'rarity-flat') {
    return { rarityModifiers: [{ ...effect, phase: 'item', sourceId: item.id }] };
  }
  if (effect.kind === 'sprinkler') {
    return { weightMultiplierBps: effect.weightBps, bigBonusBps: effect.bigBonusBps };
  }
  if (effect.kind === 'watering-can') return { weightMultiplierBps: effect.weightBps };
  return {};
}

function permanentTierScaleBps(luckTier, bigTier) {
  const luck = BigInt(Math.max(0, Math.floor(Number(luckTier) || 0)));
  const big = BigInt(Math.max(0, Math.floor(Number(bigTier) || 0)));
  return 10_000n + (60n * luck) + (30n * big);
}

function personalizedItemPrice(item, luckTier = 0, bigTier = 0, options = {}) {
  const pricedLuckTier = Math.max(0, Math.floor(Number(luckTier) || 0));
  const pricedBigTier = Math.max(0, Math.floor(Number(bigTier) || 0));
  const baseline = options.baseline || expectedRollValue(pricedLuckTier, pricedBigTier);
  const boosted = item.effect?.kind === 'egg'
    ? baseline
    : expectedRollValue(pricedLuckTier, pricedBigTier, effectOptionsForItem(item));
  const difference = subtractFraction(boosted.fraction, baseline.fraction);
  const upliftPerRoll = difference.numerator > 0n ? difference : fraction(0n);
  const affectedRolls = BigInt(item.affectedRolls || 0);
  const expectedUplift = multiplyFraction(upliftPerRoll, affectedRolls);
  const marginBps = BigInt(item.priceMarginBps);
  const upliftPrice = ceilFraction(multiplyFraction(expectedUplift, marginBps, PRICE_SCALE_BPS));
  const tierScaleBps = permanentTierScaleBps(pricedLuckTier, pricedBigTier);
  const progressionFloor = ceilFraction(fraction(item.minimumPrice * tierScaleBps, PRICE_SCALE_BPS));
  const unroundedPrice = progressionFloor > upliftPrice ? progressionFloor : upliftPrice;
  const price = niceRoundUp(unroundedPrice);
  if (price < item.minimumPrice) throw new Error(`Personalized price fell below minimum for ${item.id}.`);
  return Object.freeze({
    itemId: item.id,
    configVersion: item.configVersion,
    pricedLuckTier,
    pricedBigTier,
    minimumPrice: item.minimumPrice,
    tierScaleBps,
    progressionFloor,
    upliftPrice,
    unroundedPrice,
    price,
    affectedRolls,
    priceMarginBps: item.priceMarginBps,
    baseline,
    boosted,
    upliftPerRoll,
    expectedUplift,
  });
}

function personalizedCatalogue(items, luckTier = 0, bigTier = 0) {
  const baseline = expectedRollValue(luckTier, bigTier);
  return items.map((item) => personalizedItemPrice(item, luckTier, bigTier, { baseline }));
}

function combinedPetBonuses(pets, luckTier = 0, bigTier = 0) {
  let weightMultiplierBps = 10_000;
  let valueBonusBps = 0;
  let bigBonusBps = 0;
  const rarityModifiers = [];
  for (const pet of pets || []) {
    const effect = pet?.effect || {};
    if (effect.weightBps) {
      weightMultiplierBps = Math.min(
        MAX_WEIGHT_MULTIPLIER_BPS,
        Math.floor((weightMultiplierBps * Number(effect.weightBps)) / 10_000),
      );
    }
    if (effect.valueBonusBps) {
      valueBonusBps = Math.min(MAX_VALUE_BONUS_BPS, valueBonusBps + Number(effect.valueBonusBps));
    }
    if (effect.bigBonusBps) bigBonusBps += Number(effect.bigBonusBps);
    if (effect.kind === 'rarity' || effect.kind === 'rarity-group') {
      rarityModifiers.push({ ...effect, phase: 'pet', sourceId: pet.id });
    }
  }
  const baseline = expectedRollValue(luckTier, bigTier);
  const boosted = expectedRollValue(luckTier, bigTier, {
    rarityModifiers,
    weightMultiplierBps,
    valueBonusBps,
    bigBonusBps,
  });
  const rarityChanges = Object.keys(boosted.rarityUnits).filter((rarity) => (
    boosted.rarityUnits[rarity] !== baseline.rarityUnits[rarity] && rarity !== 'Common'
  )).map((rarity) => ({
    rarity,
    before: baseline.rarityUnits[rarity],
    after: boosted.rarityUnits[rarity],
  }));
  return Object.freeze({
    weightMultiplierBps: boosted.weightMultiplierBps,
    valueBonusBps: boosted.valueBonusBps,
    bigBonusBps: boosted.effectiveBigChanceBps - baseline.effectiveBigChanceBps,
    effectiveBigChanceBps: boosted.effectiveBigChanceBps,
    rarityChanges,
    baseline,
    boosted,
  });
}

module.exports = {
  PRICE_SCALE_BPS,
  ROLLS_PER_30_MINUTES,
  ROLLS_PER_HOUR,
  averageWeightedValueFractionForSeed,
  ceilFraction,
  combinedPetBonuses,
  effectOptionsForItem,
  expectedRollValue,
  fraction,
  fractionToNumber,
  multiplyFraction,
  niceRoundUp,
  permanentTierScaleBps,
  personalizedCatalogue,
  personalizedItemPrice,
  subtractFraction,
};
