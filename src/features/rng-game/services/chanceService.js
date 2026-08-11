const { customEmojiImageUrl } = require('../data/emojis');
const { SEEDS } = require('../data/seeds');
const {
  PROBABILITY_SCALE,
  baseCropDistribution,
  baseRarityDistribution,
  rarityDistribution,
} = require('./rngService');

function greatestCommonDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function fraction(numerator, denominator) {
  const top = BigInt(numerator);
  const bottom = BigInt(denominator);
  if (bottom <= 0n) throw new RangeError('Probability denominator must be positive.');
  const divisor = greatestCommonDivisor(top, bottom);
  return Object.freeze({ numerator: top / divisor, denominator: bottom / divisor });
}

function cropProbabilityDistribution(luckTier = 0, options = {}) {
  const crops = baseCropDistribution(options);
  const baseRarities = baseRarityDistribution(crops);
  const adjustedRarities = rarityDistribution(luckTier, options);
  return Object.freeze(crops.map((entry) => {
    const rarityBase = baseRarities[entry.seed.rarity];
    if (rarityBase <= 0n) return Object.freeze({ seed: entry.seed, ...fraction(0n, 1n) });
    return Object.freeze({
      seed: entry.seed,
      ...fraction(
        adjustedRarities[entry.seed.rarity] * entry.units,
        PROBABILITY_SCALE * rarityBase,
      ),
    });
  }));
}

function cropProbabilityForSeed(seedId, luckTier = 0, options = {}) {
  return cropProbabilityDistribution(luckTier, options)
    .find((entry) => entry.seed.id === String(seedId)) || null;
}

function formatBigInteger(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function roundedDivide(numerator, denominator) {
  return (numerator + (denominator / 2n)) / denominator;
}

function percentageText(probability, decimals = 10) {
  if (probability.numerator <= 0n) return '0%';
  const places = Math.max(1, Math.min(12, Math.floor(Number(decimals) || 10)));
  const decimalScale = 10n ** BigInt(places);
  const scaled = roundedDivide(probability.numerator * 100n * decimalScale, probability.denominator);
  if (scaled === 0n) return `<0.${'0'.repeat(places - 1)}1%`;
  const whole = scaled / decimalScale;
  const decimal = String(scaled % decimalScale).padStart(places, '0').replace(/0+$/, '');
  return `${whole}${decimal ? `.${decimal}` : ''}%`;
}

function oneInText(probability) {
  if (probability.numerator <= 0n) return 'Never';
  const oneIn = roundedDivide(probability.denominator, probability.numerator);
  return `1 in ${formatBigInteger(oneIn > 0n ? oneIn : 1n)}`;
}

function probabilityDisplay(probability) {
  return Object.freeze({
    oneIn: oneInText(probability),
    percentage: percentageText(probability),
  });
}

function changeDisplay(base, current) {
  if (base.numerator <= 0n) return '';
  const numerator = current.numerator * base.denominator;
  const denominator = current.denominator * base.numerator;
  const scaled = roundedDivide(numerator * 100n, denominator);
  const whole = scaled / 100n;
  const decimal = String(scaled % 100n).padStart(2, '0').replace(/0+$/, '');
  return `×${whole}${decimal ? `.${decimal}` : ''}`;
}

function visibleSeed(seed) {
  return seed.secretUntilDiscovered !== true && seed.rarity !== 'Secret';
}

function cropChanceProfile(repository, userId) {
  if (!repository?.getPlayer || !repository?.discoveries) {
    throw new TypeError('RNG repository is required for crop chance profiles.');
  }
  const id = String(userId);
  const player = repository.getPlayer(id);
  const luckTier = Math.max(0, Math.floor(Number(player?.luckTier) || 0));
  const discoveredIds = new Set(repository.discoveries(id).map((entry) => entry.seedId));
  const baseById = new Map(cropProbabilityDistribution(0).map((entry) => [entry.seed.id, entry]));
  const currentById = new Map(cropProbabilityDistribution(luckTier).map((entry) => [entry.seed.id, entry]));
  const seeds = SEEDS.filter(visibleSeed);
  const crops = seeds.map((seed, index) => {
    const discovered = discoveredIds.has(seed.id);
    const common = {
      slot: `slot-${index + 1}`,
      discovered,
      artworkUrl: customEmojiImageUrl(seed.emoji),
    };
    if (!discovered) return Object.freeze(common);
    const base = baseById.get(seed.id);
    const current = currentById.get(seed.id);
    return Object.freeze({
      ...common,
      name: seed.displayName,
      rarity: seed.rarity,
      outlineColor: `#${seed.rarityColor.toString(16).padStart(6, '0')}`,
      rainbowOutline: seed.rarity === 'Super',
      baseChance: probabilityDisplay(base),
      currentChance: probabilityDisplay(current),
      change: changeDisplay(base, current),
    });
  });
  return Object.freeze({
    luckTier,
    discoveredCount: crops.filter((crop) => crop.discovered).length,
    visibleTotal: crops.length,
    crops: Object.freeze(crops),
  });
}

module.exports = {
  changeDisplay,
  cropChanceProfile,
  cropProbabilityDistribution,
  cropProbabilityForSeed,
  fraction,
  oneInText,
  percentageText,
  probabilityDisplay,
  visibleSeed,
};
