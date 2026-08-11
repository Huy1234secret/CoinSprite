const {
  addRational,
  bigChance,
  expectedValueFractionForLuckTier,
} = require('./rngService');

const MINIMUM_AUTO_ROLL_COST = 5n;
const DAILY_AUTO_ROLLS = 17_280n;

function fractionToNumber(value) {
  return Number(value.numerator) / Number(value.denominator);
}

function multiplyFraction(value, numerator, denominator = 1n) {
  const top = value.numerator * BigInt(numerator);
  const bottom = value.denominator * BigInt(denominator);
  if (bottom <= 0n) throw new RangeError('Economy fraction denominator must be positive.');
  return { numerator: top, denominator: bottom };
}

function grossExpectedValueFraction(luckTier = 0, bigTier = 0) {
  const base = expectedValueFractionForLuckTier(luckTier);
  const chance = bigChance(bigTier);
  return multiplyFraction(
    base,
    BigInt(chance.denominator + (3 * chance.numerator)),
    BigInt(chance.denominator),
  );
}

function grossExpectedValue(luckTier = 0, bigTier = 0) {
  return fractionToNumber(grossExpectedValueFraction(luckTier, bigTier));
}

function ceilPositiveFraction(numerator, denominator) {
  if (denominator <= 0n) throw new RangeError('Economy fraction denominator must be positive.');
  if (numerator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

function autoRollCostPerRoll(luckTier = 0, bigTier = 0) {
  const gross = grossExpectedValueFraction(luckTier, bigTier);
  const excess = gross.numerator - (30n * gross.denominator);
  if (excess <= 0n) return MINIMUM_AUTO_ROLL_COST;
  const calculated = ceilPositiveFraction(excess, 4n * gross.denominator);
  return calculated > MINIMUM_AUTO_ROLL_COST ? calculated : MINIMUM_AUTO_ROLL_COST;
}

function netExpectedValueFraction(luckTier = 0, bigTier = 0) {
  const gross = grossExpectedValueFraction(luckTier, bigTier);
  const cost = autoRollCostPerRoll(luckTier, bigTier);
  const net = addRational(gross, { numerator: -cost, denominator: 1n });
  return net.numerator < net.denominator ? { numerator: 1n, denominator: 1n } : net;
}

function targetHoursFraction(upgradeNumber) {
  const n = BigInt(upgradeNumber);
  if (n < 1n) throw new RangeError('Upgrade number must be positive.');
  return { numerator: 50n + (n * n * n), denominator: 1_000n };
}

function targetHours(upgradeNumber) {
  return fractionToNumber(targetHoursFraction(upgradeNumber));
}

function economySnapshot(luckTier = 0, bigTier = 0) {
  const grossFraction = grossExpectedValueFraction(luckTier, bigTier);
  const gross = fractionToNumber(grossFraction);
  const costPerRoll = autoRollCostPerRoll(luckTier, bigTier);
  const netPerRoll = Math.max(1, gross - Number(costPerRoll));
  return Object.freeze({
    luckTier,
    bigTier,
    grossExpectedValue: gross,
    costPerRoll,
    dailyCost: costPerRoll * DAILY_AUTO_ROLLS,
    grossDailyIncome: gross * Number(DAILY_AUTO_ROLLS),
    netDailyIncome: netPerRoll * Number(DAILY_AUTO_ROLLS),
  });
}

module.exports = {
  DAILY_AUTO_ROLLS,
  MINIMUM_AUTO_ROLL_COST,
  autoRollCostPerRoll,
  ceilPositiveFraction,
  economySnapshot,
  fractionToNumber,
  grossExpectedValue,
  grossExpectedValueFraction,
  multiplyFraction,
  netExpectedValueFraction,
  targetHours,
  targetHoursFraction,
};
