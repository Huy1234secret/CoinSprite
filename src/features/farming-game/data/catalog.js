const { CARROT_GROWTH_DURATION_MS } = require('./growth');
const { ITEMS, getItem } = require('./items');
const { CARROT_STAGE_ASSET_PATHS } = require('../renderer/config');

const FARMING_CATALOG = Object.freeze(ITEMS.filter((item) => (
  item.itemTypes.includes('seed') && item.plantableCropId
)).map((seed) => Object.freeze({
  id: seed.plantableCropId,
  seed,
  crop: getItem(seed.plantableCropId),
  seedImagePath: CARROT_STAGE_ASSET_PATHS[0],
  cropImagePath: CARROT_STAGE_ASSET_PATHS[6],
  growTimeMs: CARROT_GROWTH_DURATION_MS,
  chanceNumerator: 1n,
  chanceDenominator: 1n,
  secretUntilDiscovered: false,
  outlineColor: '#94A3B8',
})));

function normalizedCatalogName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function catalogIndexForName(value, catalog = FARMING_CATALOG) {
  const normalized = normalizedCatalogName(value);
  if (!normalized) return -1;
  return catalog.findIndex((entry) => (
    normalizedCatalogName(entry.seed.name) === normalized
    || normalizedCatalogName(entry.crop.name) === normalized
  ));
}

module.exports = {
  FARMING_CATALOG,
  catalogIndexForName,
  normalizedCatalogName,
};
