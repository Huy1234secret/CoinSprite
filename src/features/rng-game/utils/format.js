const { FALLBACK_THUMBNAIL_URL, customEmojiImageUrl } = require('../data/emojis');

const ALLOWED_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });

function formatInteger(value) {
  return BigInt(value ?? 0).toLocaleString('en-US');
}

function formatWeight(weightUnits) {
  const units = Math.max(0, Number(weightUnits) || 0);
  return `${Math.floor(units / 100)}.${String(units % 100).padStart(2, '0')}`;
}

function formatChance(seed, maximumDecimalPlaces = 12) {
  const numerator = BigInt(seed?.chanceNumerator || 0) * 100n;
  const denominator = BigInt(seed?.chanceDenominator || 1);
  const whole = numerator / denominator;
  let remainder = numerator % denominator;
  let decimals = '';
  for (let index = 0; remainder > 0n && index < maximumDecimalPlaces; index += 1) {
    remainder *= 10n;
    decimals += String(remainder / denominator);
    remainder %= denominator;
  }
  decimals = decimals.replace(/0+$/g, '');
  const percentage = decimals ? `${whole}.${decimals}%` : `${whole}%`;
  return percentage === '0%' && seed?.chanceNumerator > 0 ? '<0.000000000001%' : percentage;
}

function formatChanceWithRatio(seed) {
  const percent = formatChance(seed);
  if (seed?.fallback) return percent;
  if (seed.chanceNumerator === 1) return `${percent} • 1/${formatInteger(seed.chanceDenominator)}`;
  return percent;
}

function seedThumbnail(seed) {
  return seed?.emoji ? customEmojiImageUrl(seed.emoji) : FALLBACK_THUMBNAIL_URL;
}

function safeUsername(value) {
  return String(value || 'Member').replace(/[\r\n\0]/g, ' ').trim().slice(0, 80) || 'Member';
}

function clampPage(page, maximum) {
  const max = Math.max(1, Number(maximum) || 1);
  const parsed = Math.floor(Number(page) || 1);
  return Math.max(1, Math.min(max, parsed));
}

module.exports = {
  ALLOWED_MENTIONS,
  clampPage,
  formatChance,
  formatChanceWithRatio,
  formatInteger,
  formatWeight,
  safeUsername,
  seedThumbnail,
};
