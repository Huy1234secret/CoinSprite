const { randomBytes } = require('crypto');
const { FARMING_CATALOG } = require('../data/catalog');
const { farmingLuckMultiplier } = require('./upgradeService');

const RARITY_LUCK_RANK = Object.freeze({
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
  Mythic: 5,
  Super: 6,
});
const MAX_PREVIEW_DIGITS = 1_000;

function greatestCommonDivisor(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function leastCommonMultiple(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return (a / greatestCommonDivisor(a, b)) * b;
}

function fraction(numerator, denominator) {
  const top = BigInt(numerator);
  const bottom = BigInt(denominator);
  if (bottom <= 0n) throw new RangeError('Probability denominator must be positive.');
  if (top < 0n) throw new RangeError('Probability numerator cannot be negative.');
  const divisor = greatestCommonDivisor(top, bottom);
  return Object.freeze({ numerator: top / divisor, denominator: bottom / divisor });
}

function addFractions(left, right) {
  return fraction(
    (left.numerator * right.denominator) + (right.numerator * left.denominator),
    left.denominator * right.denominator,
  );
}

function multiplyFractions(left, right) {
  return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

function compareFractions(left, right) {
  const difference = (left.numerator * right.denominator) - (right.numerator * left.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function parsePreviewMultiplier(value, fallback = 1n) {
  if (value == null || value === '') return BigInt(fallback);
  const source = String(value).trim();
  if (!/^[1-9]\d*$/.test(source)) {
    throw new RangeError('Luck multiplier must be a positive whole number.');
  }
  if (source.length > MAX_PREVIEW_DIGITS) {
    throw new RangeError(`Luck multiplier cannot exceed ${MAX_PREVIEW_DIGITS.toLocaleString('en-US')} digits.`);
  }
  return BigInt(source);
}

function isSecretEntry(entry) {
  return entry?.secretUntilDiscovered === true || entry?.crop?.rarity === 'Secret';
}

function entryBaseChance(entry) {
  return fraction(entry.chanceNumerator ?? 1n, entry.chanceDenominator ?? 1n);
}

function farmingChanceDistribution(multiplier = 1n, options = {}) {
  const catalog = options.catalog || FARMING_CATALOG;
  const luck = parsePreviewMultiplier(multiplier);
  const entries = catalog.map((entry) => ({ entry, base: entryBaseChance(entry) }));
  const totalBase = entries.reduce((sum, row) => addFractions(sum, row.base), fraction(0n, 1n));
  if (compareFractions(totalBase, fraction(1n, 1n)) !== 0) {
    throw new RangeError('Farming crop base chances must sum exactly to one.');
  }

  const secretRows = entries.filter((row) => isSecretEntry(row.entry));
  const normalRows = entries.filter((row) => !isSecretEntry(row.entry));
  const secretTotal = secretRows.reduce((sum, row) => addFractions(sum, row.base), fraction(0n, 1n));
  const remaining = fraction(
    secretTotal.denominator - secretTotal.numerator,
    secretTotal.denominator,
  );
  let commonDenominator = 1n;
  for (const row of normalRows) commonDenominator = leastCommonMultiple(commonDenominator, row.base.denominator);
  const adjusted = normalRows.map((row) => {
    const rank = RARITY_LUCK_RANK[row.entry.crop?.rarity] ?? 0;
    const baseUnits = row.base.numerator * (commonDenominator / row.base.denominator);
    return { ...row, units: baseUnits * (luck ** BigInt(rank)) };
  });
  const adjustedTotal = adjusted.reduce((sum, row) => sum + row.units, 0n);
  if (normalRows.length && adjustedTotal <= 0n) throw new RangeError('Farming chance weights must be positive.');

  const normalResults = adjusted.map((row) => ({
    entry: row.entry,
    ...multiplyFractions(remaining, fraction(row.units, adjustedTotal)),
  }));
  const secretResults = secretRows.map((row) => ({ entry: row.entry, ...row.base }));
  const byId = new Map([...normalResults, ...secretResults].map((row) => [row.entry.id, Object.freeze(row)]));
  return Object.freeze(catalog.map((entry) => byId.get(entry.id)));
}

function randomBigIntBelow(maximum) {
  const max = BigInt(maximum);
  if (max <= 0n) throw new RangeError('Random maximum must be positive.');
  const byteLength = Math.max(1, Math.ceil(max.toString(2).length / 8));
  const ceiling = 1n << BigInt(byteLength * 8);
  const accepted = ceiling - (ceiling % max);
  while (true) {
    const value = BigInt(`0x${randomBytes(byteLength).toString('hex')}`);
    if (value < accepted) return value % max;
  }
}

function selectFarmingCrop(multiplier = 1n, options = {}) {
  const distribution = farmingChanceDistribution(multiplier, options);
  if (distribution.length === 1) return distribution[0].entry;
  let commonDenominator = 1n;
  for (const row of distribution) commonDenominator = leastCommonMultiple(commonDenominator, row.denominator);
  const weights = distribution.map((row) => row.numerator * (commonDenominator / row.denominator));
  const total = weights.reduce((sum, weight) => sum + weight, 0n);
  let draw;
  if (options.rng) {
    const supplied = options.rng(total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : total);
    draw = BigInt(supplied);
    if (draw < 0n || draw >= total) throw new RangeError('Injected Farming chance RNG returned an out-of-range value.');
  } else {
    draw = randomBigIntBelow(total);
  }
  for (let index = 0; index < distribution.length; index += 1) {
    if (draw < weights[index]) return distribution[index].entry;
    draw -= weights[index];
  }
  return distribution.at(-1).entry;
}

function formatBigInteger(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function roundedDivide(numerator, denominator) {
  return (numerator + (denominator / 2n)) / denominator;
}

function probabilityDisplay(probability, decimals = 10) {
  if (probability.numerator <= 0n) return Object.freeze({ oneIn: 'Never', percentage: '0%' });
  const places = Math.max(1, Math.min(12, Math.floor(Number(decimals) || 10)));
  const scale = 10n ** BigInt(places);
  const percent = roundedDivide(probability.numerator * 100n * scale, probability.denominator);
  const percentage = percent === 0n
    ? `<0.${'0'.repeat(places - 1)}1%`
    : `${percent / scale}${percent % scale ? `.${String(percent % scale).padStart(places, '0').replace(/0+$/, '')}` : ''}%`;
  const oneIn = roundedDivide(probability.denominator, probability.numerator);
  return Object.freeze({ oneIn: `1 in ${formatBigInteger(oneIn > 0n ? oneIn : 1n)}`, percentage });
}

function changeDisplay(base, preview) {
  if (base.numerator <= 0n) return '';
  const scaled = roundedDivide(
    preview.numerator * base.denominator * 10_000n,
    preview.denominator * base.numerator,
  );
  const whole = scaled / 10_000n;
  const decimal = String(scaled % 10_000n).padStart(4, '0').replace(/0+$/, '');
  return `×${whole}${decimal ? `.${decimal}` : ''}`;
}

function emojiArtworkUrl(emoji) {
  const match = String(emoji || '').match(/^<a?:[^:]+:(\d{16,20})>$/);
  return match ? `https://cdn.discordapp.com/emojis/${match[1]}.png?size=256&quality=lossless` : '';
}

function farmingChanceProfile(repository, userId, previewMultiplier, options = {}) {
  if (!repository?.ensureProfile || !repository?.cropStatistics) {
    throw new TypeError('Farming repository is required for crop chance profiles.');
  }
  const id = String(userId);
  const catalog = options.catalog || FARMING_CATALOG;
  const profile = repository.ensureProfile(id, options.now || Date.now());
  const currentMultiplier = farmingLuckMultiplier(profile.luckTier);
  const preview = parsePreviewMultiplier(previewMultiplier, currentMultiplier);
  const baseById = new Map(farmingChanceDistribution(1n, { catalog }).map((row) => [row.entry.id, row]));
  const previewById = new Map(farmingChanceDistribution(preview, { catalog }).map((row) => [row.entry.id, row]));
  const crops = [];
  catalog.forEach((entry, index) => {
    const statistics = repository.cropStatistics(id, entry.crop.id, options.now || Date.now());
    const discovered = statistics.totalPlanted > 0n || statistics.totalHarvested > 0n;
    const secret = isSecretEntry(entry);
    if (secret && !discovered) return;
    const common = {
      slot: `slot-${index + 1}`,
      discovered,
      artworkUrl: emojiArtworkUrl(entry.crop.emoji),
    };
    if (!discovered) {
      crops.push(Object.freeze(common));
      return;
    }
    const base = baseById.get(entry.id);
    const calculated = secret ? base : previewById.get(entry.id);
    crops.push(Object.freeze({
      ...common,
      name: entry.crop.name,
      rarity: entry.crop.rarity,
      outlineColor: entry.outlineColor || '#94A3B8',
      rainbowOutline: entry.crop.rarity === 'Super',
      baseChance: probabilityDisplay(base),
      previewChance: probabilityDisplay(calculated),
      change: changeDisplay(base, calculated),
      secretNotice: secret ? 'Secret Crop — Luck does not affect this chance.' : '',
    }));
  });
  return Object.freeze({
    luckTier: profile.luckTier,
    currentMultiplier: String(currentMultiplier),
    previewMultiplier: String(preview),
    discoveredCount: crops.filter((crop) => crop.discovered).length,
    visibleTotal: crops.length,
    crops: Object.freeze(crops),
  });
}

module.exports = {
  MAX_PREVIEW_DIGITS,
  RARITY_LUCK_RANK,
  addFractions,
  changeDisplay,
  compareFractions,
  entryBaseChance,
  farmingChanceDistribution,
  farmingChanceProfile,
  fraction,
  isSecretEntry,
  parsePreviewMultiplier,
  probabilityDisplay,
  selectFarmingCrop,
};
