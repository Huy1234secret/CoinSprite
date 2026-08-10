const ITEMS = Object.freeze([
  Object.freeze({
    id: 'carrot_seed_package',
    name: 'Carrot Seed Package',
    emoji: '<:ITcarrotseedpackage:1536400521718407338>',
    rarity: 'Common',
    value: 10n,
    itemTypes: Object.freeze(['seed']),
    plantableCropId: 'carrot',
  }),
  Object.freeze({
    id: 'carrot',
    name: 'Carrot',
    emoji: '<:ITcarrotcrop:1536400519520583750>',
    rarity: 'Common',
    value: 4n,
    itemTypes: Object.freeze(['consumable', 'ingredient']),
    plantableCropId: null,
  }),
]);

const ITEM_BY_ID = Object.freeze(Object.fromEntries(ITEMS.map((item) => [item.id, item])));
const ITEM_TYPES = Object.freeze([...new Set(ITEMS.flatMap((item) => item.itemTypes))]);
const ITEM_RARITIES = Object.freeze([...new Set(ITEMS.map((item) => item.rarity))]);
const STARTER_ITEM_ID = 'carrot_seed_package';
const STARTER_ITEM_QUANTITY = 6_767n;

function getItem(itemId) {
  return ITEM_BY_ID[String(itemId || '')] || null;
}

module.exports = {
  ITEMS,
  ITEM_BY_ID,
  ITEM_RARITIES,
  ITEM_TYPES,
  STARTER_ITEM_ID,
  STARTER_ITEM_QUANTITY,
  getItem,
};
