const { itemMetadata } = require('../itemCatalog');

const PAGE_SIZE = 10;

function compareItems(left, right) {
  return left.sortOrder - right.sortOrder
    || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    || (left.itemKey < right.itemKey ? -1 : left.itemKey > right.itemKey ? 1 : 0);
}

function decorateStack(stack) {
  const metadata = itemMetadata(stack.itemKey);
  return { ...metadata, quantity: BigInt(stack.quantity) };
}

function paginateStacks(stacks, requestedPage = 1) {
  const items = stacks.filter((stack) => BigInt(stack.quantity) > 0n).map(decorateStack).sort(compareItems);
  const totalItemStacks = items.length;
  const maxPages = Math.max(1, Math.ceil(totalItemStacks / PAGE_SIZE));
  const page = Math.max(1, Math.min(maxPages, Number(requestedPage) || 1));
  return {
    items: items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    page,
    maxPages,
    totalItemStacks,
  };
}

class InventoryService {
  constructor(repository) { this.repository = repository; }
  page(userId, requestedPage = 1) { return paginateStacks(this.repository.list(userId), requestedPage); }
}

module.exports = { InventoryService, PAGE_SIZE, compareItems, decorateStack, paginateStacks };
