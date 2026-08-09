function normalizeCropName(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function parseWeightThreshold(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  if (!/^\d+(?:\.\d+)?$/.test(input)) throw new Error('Weight must be a positive number.');
  const [whole, fraction = ''] = input.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction) * 100n;
  const units = (numerator + denominator - 1n) / denominator;
  if (units > 1_000_000n) throw new Error('Weight is too large.');
  return Number(units);
}

function inventoryMatches(item, filters = {}) {
  const name = normalizeCropName(filters.name);
  if (name && !normalizeCropName(item.cropName).includes(name)) return false;
  if (filters.minimumWeightUnits != null && item.weightUnits < filters.minimumWeightUnits) return false;
  if (filters.rarity && item.rarity !== filters.rarity) return false;
  if (filters.cropIds?.size && !filters.cropIds.has(item.seedId)) return false;
  return true;
}

function filterInventory(items, filters) {
  return (items || []).filter((item) => inventoryMatches(item, filters));
}

module.exports = { filterInventory, inventoryMatches, normalizeCropName, parseWeightThreshold };
