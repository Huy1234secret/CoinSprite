function trimTrailingZeros(text) {
  return text.replace(/\.0+$|(\.\d*[1-9])0+$/, '$1');
}

function formatCompactNumber(value, options = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }

  const safe = Math.max(0, numeric);
  const {
    minimumFractionDigits = 0,
    maximumFractionDigits = safe >= 1000 ? 1 : safe >= 100 ? 0 : safe >= 10 ? 1 : 2,
  } = options;

  const formatter = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    minimumFractionDigits,
    maximumFractionDigits,
  });

  return trimTrailingZeros(formatter.format(safe)).toUpperCase();
}

module.exports = {
  formatCompactNumber,
};
