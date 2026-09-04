const ITEM_CATALOG = Object.freeze([
  Object.freeze({
    itemKey: 'work_token',
    name: 'Work Token',
    emoji: '<:CSWorkToken:1545303925907918938>',
    rarity: 'C',
    type: 'Currency',
    sortOrder: 100,
  }),
]);

const ITEM_BY_KEY = new Map(ITEM_CATALOG.map((item) => [item.itemKey, item]));

function humanizeItemKey(itemKey) {
  const words = String(itemKey || '')
    .replace(/[^a-zA-Z0-9_-]+/g, ' ')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  return words.length
    ? words.map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase()).join(' ').slice(0, 100)
    : 'Unknown Item';
}

function itemMetadata(itemKey) {
  return ITEM_BY_KEY.get(String(itemKey)) || Object.freeze({
    itemKey: String(itemKey),
    name: humanizeItemKey(itemKey),
    emoji: '📦',
    rarity: 'Unknown',
    type: 'Item',
    sortOrder: Number.MAX_SAFE_INTEGER,
  });
}

module.exports = { ITEM_BY_KEY, ITEM_CATALOG, humanizeItemKey, itemMetadata };
