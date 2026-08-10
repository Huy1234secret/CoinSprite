const { getItem } = require('../data/items');
const { clampPage } = require('../../shared/format');

const INVENTORY_PAGE_SIZE = 6;

function normalizeItemName(value) {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function inventoryStackMatches(stack, filters = {}) {
  const item = stack?.item || getItem(stack?.itemId);
  if (!item) return false;
  const name = normalizeItemName(filters.name);
  if (name && !normalizeItemName(item.name).includes(name)) return false;
  if (filters.rarity && item.rarity !== filters.rarity) return false;
  if (filters.itemTypes?.length && !item.itemTypes.some((type) => filters.itemTypes.includes(type))) return false;
  return true;
}

function filterInventoryStacks(stacks, category, filters = {}) {
  return (stacks || []).filter((stack) => {
    const item = stack?.item || getItem(stack?.itemId);
    return stack.quantity > 0n
      && item?.inventoryCategory === category
      && inventoryStackMatches(stack, filters);
  });
}

function inventoryPageData(stacks, view) {
  const category = view.type === 'other' ? 'other' : 'crops';
  const pageKey = category === 'other' ? 'otherPage' : 'cropPage';
  const filters = category === 'other' ? view.otherFilters : view.cropFilters;
  const filtered = filterInventoryStacks(stacks, category, filters);
  const maxPage = Math.max(1, Math.ceil(filtered.length / INVENTORY_PAGE_SIZE));
  view[pageKey] = clampPage(view[pageKey], maxPage);
  const start = (view[pageKey] - 1) * INVENTORY_PAGE_SIZE;
  return { category, filtered, maxPage, pageItems: filtered.slice(start, start + INVENTORY_PAGE_SIZE) };
}

module.exports = {
  INVENTORY_PAGE_SIZE,
  filterInventoryStacks,
  inventoryPageData,
  inventoryStackMatches,
  normalizeItemName,
};
