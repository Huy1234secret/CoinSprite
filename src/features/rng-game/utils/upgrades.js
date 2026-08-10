const ROMAN_VALUES = Object.freeze([
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]);

function romanTier(tier) {
  let remaining = Math.max(0, Math.min(20, Math.floor(Number(tier) || 0)));
  if (!remaining) return '0';
  let result = '';
  for (const [value, numeral] of ROMAN_VALUES) {
    while (remaining >= value) {
      result += numeral;
      remaining -= value;
    }
  }
  return result;
}

function formatMultiplier(value) {
  return Number(value).toFixed(2).replace(/\.0+$|(?<=\.[0-9])0$/g, '');
}

function formatPercent(value) {
  return Number(value).toFixed(1).replace(/\.0$/g, '');
}

module.exports = { formatMultiplier, formatPercent, romanTier };
