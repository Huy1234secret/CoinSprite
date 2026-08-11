const { getItem } = require('../data/items');
const { clampPage } = require('../../shared/format');

const CROP_INVENTORY_PAGE_SIZE = 12;
const OTHER_INVENTORY_PAGE_SIZE = 6;
const INVENTORY_PAGE_SIZE = CROP_INVENTORY_PAGE_SIZE;

function normalizeItemName(value) {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function inventoryEntryMatches(entry, filters = {}) {
  const item = entry?.item || getItem(entry?.itemId || entry?.cropId);
  if (!item) return false;
  const name = normalizeItemName(filters.name);
  if (name && !normalizeItemName(item.name).includes(name)) return false;
  if (filters.rarity && (entry.rarity || item.rarity) !== filters.rarity) return false;
  if (filters.itemTypes?.length && !item.itemTypes.some((type) => filters.itemTypes.includes(type))) return false;
  return true;
}

function inventoryStackMatches(stack, filters = {}) {
  return inventoryEntryMatches(stack, filters);
}

function filterInventoryStacks(stacks, category, filters = {}) {
  return (stacks || []).filter((stack) => {
    const item = stack?.item || getItem(stack?.itemId);
    return stack.quantity > 0n
      && item?.inventoryCategory === category
      && inventoryEntryMatches(stack, filters);
  });
}

function filterCropInstances(crops, filters = {}) {
  return (crops || []).filter((crop) => (
    crop.state === 'inventory'
      && (crop.item || getItem(crop.cropId))?.inventoryCategory === 'crops'
      && inventoryEntryMatches(crop, filters)
  ));
}

function inventoryPageData(inventory, view) {
  const category = view.type === 'other' ? 'other' : 'crops';
  const pageKey = category === 'other' ? 'otherPage' : 'cropPage';
  const filters = category === 'other' ? view.otherFilters : view.cropFilters;
  const source = Array.isArray(inventory) ? { crops: [], stacks: inventory } : (inventory || {});
  const filtered = category === 'other'
    ? filterInventoryStacks(source.stacks, 'other', filters)
    : filterCropInstances(source.crops, filters);
  const pageSize = category === 'other' ? OTHER_INVENTORY_PAGE_SIZE : CROP_INVENTORY_PAGE_SIZE;
  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  view[pageKey] = clampPage(view[pageKey], maxPage);
  const start = (view[pageKey] - 1) * pageSize;
  return { category, filtered, maxPage, pageItems: filtered.slice(start, start + pageSize), pageSize };
}

module.exports = {
  CROP_INVENTORY_PAGE_SIZE,
  INVENTORY_PAGE_SIZE,
  OTHER_INVENTORY_PAGE_SIZE,
  filterCropInstances,
  filterInventoryStacks,
  inventoryEntryMatches,
  inventoryPageData,
  inventoryStackMatches,
  normalizeItemName,
};
