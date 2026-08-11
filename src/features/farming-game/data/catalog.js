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
})));

function normalizedCatalogName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function catalogIndexForName(value) {
  const normalized = normalizedCatalogName(value);
  if (!normalized) return -1;
  return FARMING_CATALOG.findIndex((entry) => (
    normalizedCatalogName(entry.seed.name) === normalized
    || normalizedCatalogName(entry.crop.name) === normalized
  ));
}

module.exports = {
  FARMING_CATALOG,
  catalogIndexForName,
  normalizedCatalogName,
};
