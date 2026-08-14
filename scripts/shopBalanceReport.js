const assert = require('node:assert/strict');
const { ITEMS, ITEM_BY_ID } = require('../src/features/rng-game/data/items');
const { SEEDS } = require('../src/features/rng-game/data/seeds');
const {
  bigUpgradeCost,
  luckUpgradeCost,
} = require('../src/features/rng-game/services/gameService');
const {
  MAX_EFFECTIVE_BIG_CHANCE_BPS,
  MAX_WEIGHT_MULTIPLIER_BPS,
  MIN_COMMON_PROBABILITY_UNITS,
  PROBABILITY_SCALE,
} = require('../src/features/rng-game/services/rngService');
const {
  ceilFraction,
  expectedRollValue,
  fraction,
  fractionToNumber,
  personalizedCatalogue,
  subtractFraction,
} = require('../src/features/rng-game/services/shopPricingService');

const TIER_CHECKPOINTS = Object.freeze([
  { label: 'Tier 0', luckTier: 0, bigTier: 0 },
  { label: 'Midgame', luckTier: 25, bigTier: 25 },
  { label: 'Maximum', luckTier: 49, bigTier: 50 },
]);
const maximumCropValue = (rarity) => BigInt(Math.max(
  ...SEEDS.filter((seed) => seed.rarity === rarity).map((seed) => seed.maximumValue),
));
const NORMAL_SUPER_MAX = maximumCropValue('Super');
const BIG_SUPER_MAX = NORMAL_SUPER_MAX * 4n;
const NORMAL_SECRET_MAX = maximumCropValue('Secret');
const BIG_SECRET_MAX = NORMAL_SECRET_MAX * 4n;

function decimal(value, places = 4) {
  return fractionToNumber(value).toFixed(places);
}

function probability(units) {
  return `${(Number(units) / 10_000_000).toFixed(6)}%`;
}

function targetOdds(item, quote) {
  if (item.effect.kind === 'rarity' || item.effect.kind === 'rarity-flat') {
    const rarity = item.effect.rarity;
    return `${rarity}: ${probability(quote.baseline.rarityUnits[rarity])} -> ${probability(quote.boosted.rarityUnits[rarity])}`;
  }
  if (item.effect.kind === 'sprinkler') {
    return `weight ${(quote.boosted.weightMultiplierBps / 10_000).toFixed(2)}x; BIG ${(quote.baseline.effectiveBigChanceBps / 100).toFixed(2)}% -> ${(quote.boosted.effectiveBigChanceBps / 100).toFixed(2)}%`;
  }
  if (item.effect.kind === 'watering-can') {
    return `weight 1.00x -> ${(quote.boosted.weightMultiplierBps / 10_000).toFixed(2)}x`;
  }
  return '1 permanent pet';
}

function breakEvenRolls(quote) {
  if (quote.upliftPerRoll.numerator <= 0n) return 'n/a';
  return String(ceilFraction(fraction(
    quote.price * quote.upliftPerRoll.denominator,
    quote.upliftPerRoll.numerator,
  )));
}

function purchaseCounts(price) {
  return `N.Super ${NORMAL_SUPER_MAX / price}; BIG Super ${BIG_SUPER_MAX / price}; N.Secret ${NORMAL_SECRET_MAX / price}; BIG Secret ${BIG_SECRET_MAX / price}`;
}

const rows = [];
const upgradeRows = [];
for (const checkpoint of TIER_CHECKPOINTS) {
  const quotes = personalizedCatalogue(ITEMS, checkpoint.luckTier, checkpoint.bigTier);
  for (const quote of quotes) {
    const item = ITEM_BY_ID.get(quote.itemId);
    const probabilityTotal = Object.values(quote.boosted.rarityUnits).reduce((sum, units) => sum + units, 0n);
    assert.equal(probabilityTotal, PROBABILITY_SCALE, `${item.id} probabilities must total 100%`);
    assert.ok(quote.boosted.rarityUnits.Common >= MIN_COMMON_PROBABILITY_UNITS, `${item.id} Common chance floor`);
    assert.ok(quote.boosted.effectiveBigChanceBps <= MAX_EFFECTIVE_BIG_CHANCE_BPS, `${item.id} BIG cap`);
    assert.ok(quote.boosted.weightMultiplierBps <= MAX_WEIGHT_MULTIPLIER_BPS, `${item.id} weight cap`);
    assert.ok(quote.price >= item.minimumPrice, `${item.id} personalized minimum`);
    assert.ok(quote.price >= quote.upliftPrice, `${item.id} cannot underprice temporary expected uplift`);
    assert.ok(quote.expectedUplift.numerator >= 0n, `${item.id} uplift cannot be negative`);
    assert.ok(Number.isFinite(fractionToNumber(quote.baseline.fraction)), `${item.id} baseline EV must be finite`);
    assert.ok(Number.isFinite(fractionToNumber(quote.boosted.fraction)), `${item.id} boosted EV must be finite`);
    rows.push({
      checkpoint: checkpoint.label,
      item: item.displayName,
      price: String(quote.price),
      baselineEV: decimal(quote.baseline.fraction),
      boostedEV: decimal(quote.boosted.fraction),
      fullUplift: decimal(quote.expectedUplift, 2),
      odds: targetOdds(item, quote),
      restockHours: (5_000 / item.restockChanceBps).toFixed(2),
      maximumStacking: 'weight 2.50x; BIG 15%; Common 10%; pet value +20%',
      breakEvenRolls: breakEvenRolls(quote),
      jackpotsBuyingItem: purchaseCounts(quote.price),
    });
  }
  const secret = quotes.find((quote) => quote.itemId === 'secret_mushroom');
  assert.ok(secret.price > NORMAL_SUPER_MAX, 'A normal maximum-value Super must not buy a Secret Mushroom.');
  assert.ok(NORMAL_SUPER_MAX / secret.price <= 1n, 'A normal Super must never buy multiple Secret Mushrooms.');

  const baseline = expectedRollValue(checkpoint.luckTier, checkpoint.bigTier);
  for (const kind of ['Luck', 'BIG']) {
    const atMaximum = kind === 'Luck' ? checkpoint.luckTier >= 49 : checkpoint.bigTier >= 50;
    if (atMaximum) {
      upgradeRows.push({ checkpoint: checkpoint.label, upgrade: kind, cost: 'MAX', marginalEV: 'MAX', breakEvenRolls: 'MAX' });
      continue;
    }
    const upgraded = kind === 'Luck'
      ? expectedRollValue(checkpoint.luckTier + 1, checkpoint.bigTier)
      : expectedRollValue(checkpoint.luckTier, checkpoint.bigTier + 1);
    const marginal = subtractFraction(upgraded.fraction, baseline.fraction);
    const cost = kind === 'Luck'
      ? luckUpgradeCost(checkpoint.luckTier)
      : bigUpgradeCost(checkpoint.bigTier);
    assert.ok(marginal.numerator > 0n, `${kind} upgrade must retain positive permanent expected value.`);
    assert.ok(cost > 0n, `${kind} upgrade price must remain positive.`);
    upgradeRows.push({
      checkpoint: checkpoint.label,
      upgrade: kind,
      cost: String(cost),
      marginalEV: decimal(marginal, 6),
      breakEvenRolls: String(ceilFraction(fraction(
        cost * marginal.denominator,
        marginal.numerator,
      ))),
    });
  }
}

console.log('CoinSprite personalized shop balance report');
console.table(rows);
console.log('Permanent upgrade economy checkpoints');
console.table(upgradeRows);
console.log('PASS: every personalized price is at or above its minimum and its 135% expected-uplift price.');
console.log('PASS: Luck/BIG upgrades retain positive permanent EV while every temporary boost is priced above its full-duration expected value plus margin.');
console.log('PASS: all distributions total 100%; Common >=10%; BIG <=15%; weight <=2.50x.');
