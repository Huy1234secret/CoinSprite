const { getItem } = require('../data/items');
const { clampPage } = require('../../rng-game/utils/format');

const OTHER_INVENTORY_PAGE_SIZE = 6;

function normalizeItemName(value) {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function otherItemMatches(stack, filters = {}) {
  const item = stack?.item || getItem(stack?.itemId);
  if (!item) return false;
  const name = normalizeItemName(filters.name);
  if (name && !normalizeItemName(item.name).includes(name)) return false;
  if (filters.rarity && item.rarity !== filters.rarity) return false;
  if (filters.itemTypes?.length && !item.itemTypes.some((type) => filters.itemTypes.includes(type))) return false;
  return true;
}

function filterOtherItems(stacks, filters = {}) {
  return (stacks || []).filter((stack) => stack.quantity > 0n && otherItemMatches(stack, filters));
}

function otherInventoryPageData(stacks, view) {
  const filtered = filterOtherItems(stacks, view.otherFilters);
  const maxPage = Math.max(1, Math.ceil(filtered.length / OTHER_INVENTORY_PAGE_SIZE));
  view.otherPage = clampPage(view.otherPage, maxPage);
  const start = (view.otherPage - 1) * OTHER_INVENTORY_PAGE_SIZE;
  return { filtered, maxPage, pageItems: filtered.slice(start, start + OTHER_INVENTORY_PAGE_SIZE) };
}

module.exports = {
  OTHER_INVENTORY_PAGE_SIZE,
  filterOtherItems,
  normalizeItemName,
  otherInventoryPageData,
  otherItemMatches,
};
